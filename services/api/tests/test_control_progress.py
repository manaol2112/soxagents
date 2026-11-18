"""Each control's stage in the work, who its next step belongs to, and whether it is the
person asking's (the Controls register): from the records, by role and assignment."""

from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from support import Database
from test_engagement_data import _engagement, _requests, _set
from test_evidence_intake import _client, _Scheduler
from test_evidence_review import _base
from test_execution import _add_project_member, _add_user
from test_outbound import migrated

from ai_workforce_api.db import connect

_ = migrated


def _controls(client: Any, team: dict[str, Any]) -> dict[str, dict[str, Any]]:
    response = client.get(f"{_base(team['org'], team['project'])}/workspace/controls")
    assert response.status_code == 200, response.text
    return {row["id"]: row for row in response.json()}


def _control_of(connection: Any, request_id: UUID) -> str:
    row = connection.execute(
        "SELECT engagement_control_id FROM pbc_requests WHERE id = %s", (request_id,)
    ).fetchone()
    assert row is not None
    return str(row[0])


def test_the_stages_add_up_to_the_controls_in_scope(migrated: Database) -> None:
    team, client = _engagement(migrated, "stages")
    with connect(migrated.url) as connection:
        ids = _requests(connection, team["project"])
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE id = %s",
            (_control_of(connection, ids[-1]),),
        )
        connection.commit()
    rows = list(_controls(client, team).values())
    in_scope = [row for row in rows if row["included"]]
    stages = Counter(row["progress"] for row in in_scope)
    # One stage each: the stages add up to the controls in scope, nothing counted twice.
    assert sum(stages.values()) == len(in_scope) < len(rows)
    assert set(stages) <= {
        "TO_REQUEST", "AWAITING_EVIDENCE", "EVIDENCE_RECEIVED", "READY_FOR_TESTING",
        "AGENT_TESTING", "RESULTS_TO_CONFIRM", "AWAITING_REVIEW", "REVIEW_NOTES", "CONCLUDED",
    }  # fmt: skip
    # Every in-scope control lists its evidence by testing phase, and the counts agree.
    for row in in_scope:
        phases = row["evidence_phases"]
        assert sum(p["requests"] for p in phases) == len(
            [r for r in row["requests"] if r["status"] != "CANCELLED"]
        )


def test_drafted_requests_are_no_ones_control_step(migrated: Database) -> None:
    team, client = _engagement(migrated, "drafts")
    rows = _controls(client, team)
    drafted = [row for row in rows.values() if row["drafted"]]
    assert drafted, "the fixture drafts evidence requests for its controls"
    for row in drafted:
        assert row["next_step"].startswith("Submit the")
        assert row["actor"] == "PREPARER"
        # Submitting drafts is done together, so it is no one control's action.
        assert row["yours"] is False
        # Its stage is where its evidence stands: still to request, unless another of its
        # requests is already out with the client.
        out = any(
            r["status"] in ("SENT", "WAITING_FOR_RESPONSE", "OVERDUE", "ESCALATED")
            for r in row["requests"]
        )
        assert row["progress"] == ("AWAITING_EVIDENCE" if out else "TO_REQUEST")


def test_whose_step_follows_role_assignment_and_the_requester_rule(
    migrated: Database,
) -> None:
    team, owner = _engagement(migrated, "yours")
    now = datetime.now(UTC)
    with connect(migrated.url) as connection:
        contributor_id = _add_user(
            connection, team["org"], f"contrib-{team['project'].hex[:6]}@example.com",
            "CONTRIBUTOR",
        )  # fmt: skip
        _add_project_member(connection, team["org"], team["project"], contributor_id)
        ids = _requests(connection, team["project"])
        # An approval to give, evidence in with the population to confirm, an overdue
        # request, and a request still out with the client.
        approving = _control_of(connection, ids[0])
        _set(connection, ids[0], status="APPROVAL_PENDING")
        confirming = _control_of(connection, ids[2])
        for request in ids:
            if _control_of(connection, request) == confirming:
                _set(connection, request, status="RECEIVED", received_at=now)
        late = _control_of(connection, ids[4])
        for request in ids:
            if _control_of(connection, request) == late:
                _set(connection, request, status="SENT", due_at=now - timedelta(days=4))
        connection.commit()
    reviewer = _client(migrated, team["reviewer_id"], _Scheduler())
    contributor = _client(migrated, contributor_id, _Scheduler())
    as_owner, as_reviewer, as_contributor = (
        _controls(owner, team), _controls(reviewer, team), _controls(contributor, team)
    )  # fmt: skip
    # Approving an outbound request needs project.update: owner and admin, not a
    # contributor.
    assert as_owner[approving]["actor"] == "APPROVER"
    assert as_owner[approving]["yours"] is True
    assert as_reviewer[approving]["yours"] is True
    assert as_contributor[approving]["yours"] is False
    # A preparer's step is an engagement lead's or preparer's (the contributor joined the
    # team as a preparer); the engagement reviewer and an organization admin who is not
    # on the team have the permission but not the role, so it is not theirs (M1d).
    assert as_owner[confirming]["next_step"] == "Confirm the population"
    assert as_owner[confirming]["progress"] == "EVIDENCE_RECEIVED"
    assert as_contributor[confirming]["yours"] is True
    assert as_owner[confirming]["yours"] is True
    assert as_reviewer[confirming]["yours"] is False
    assert as_owner[confirming]["assignees"] == []
    # Overdue by the due date, and the team's to chase.
    assert as_owner[late]["overdue"] is True
    assert as_owner[late]["next_step"] == "Chase the overdue evidence request"
    assert as_owner[late]["yours"] is True
    # Once the control's work is assigned to someone, it is theirs alone.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE tasks SET assignee_user_id = %s "
            "WHERE engagement_control_id = %s AND plan_kind = 'evidence'",
            (contributor_id, confirming),
        )
        connection.commit()
    assert _controls(owner, team)[confirming]["yours"] is False
    assert _controls(contributor, team)[confirming]["yours"] is True
    # The row names who it waits on, for everyone else.
    assert _controls(owner, team)[confirming]["assignees"] == [
        f"contrib-{team['project'].hex[:6]}@example.com"
    ]
    # The requester of an approval never approves it: the reviewer submits a draft.
    with connect(migrated.url) as connection:
        drafts = [
            request
            for request in ids
            if connection.execute(
                "SELECT status FROM pbc_requests WHERE id = %s", (request,)
            ).fetchone()
            == ("DRAFT",)
        ]
        submitting = drafts[0]
        version = connection.execute(
            "SELECT version FROM pbc_requests WHERE id = %s", (submitting,)
        ).fetchone()
        control = _control_of(connection, submitting)
        # Leave that control one request, so its next step is this approval.
        connection.execute(
            "UPDATE pbc_requests SET status = 'CANCELLED', "
            "cancellation_reason = 'Not needed for this test' "
            "WHERE engagement_control_id = %s AND id <> %s",
            (control, submitting),
        )
        connection.commit()
    assert version is not None
    path = f"/organizations/{team['org']}/projects/{team['project']}/pbc-requests"
    submitted = reviewer.post(f"{path}/{submitting}/submit", json={"version": version[0]})
    assert submitted.status_code == 200, submitted.text
    assert _controls(reviewer, team)[control]["actor"] == "APPROVER"
    assert _controls(reviewer, team)[control]["yours"] is False
    assert _controls(owner, team)[control]["yours"] is True


def test_an_admin_off_the_team_is_not_the_preparer(migrated: Database) -> None:
    """Broad organization permissions never make a preparer's step the viewer's: an
    admin who is not on the engagement's team sees whose it is, not "needs you"."""
    team, owner = _engagement(migrated, "yours-admin")
    with connect(migrated.url) as connection:
        admin_id = _add_user(
            connection, team["org"], f"admin-{team['project'].hex[:6]}@example.com", "ADMIN"
        )
        ids = _requests(connection, team["project"])
        confirming = _control_of(connection, ids[2])
        for request in ids:
            if _control_of(connection, request) == confirming:
                _set(connection, request, status="RECEIVED", received_at=datetime.now(UTC))
        connection.commit()
    admin = _client(migrated, admin_id, _Scheduler())
    assert _controls(owner, team)[confirming]["actor"] == "PREPARER"
    assert _controls(owner, team)[confirming]["yours"] is True
    assert _controls(admin, team)[confirming]["yours"] is False


def test_automation_status_says_whether_queued_runs_will_start(migrated: Database) -> None:
    from ai_workforce_api.settings import Settings
    from ai_workforce_api.workspace import automation_of

    team, owner = _engagement(migrated, "automation")
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    found = owner.get(f"{base}/workspace/automation")
    assert found.status_code == 200, found.text
    # Tests run without a worker or workflow engine: automation is unavailable, and the
    # web may not say anything is running.
    assert found.json()["available"] is False and found.json()["provider"] == "none"
    assert "No agent worker is configured" in found.json()["detail"]
    local = automation_of(Settings(database_url="postgresql://x", local_worker_enabled=True))
    assert (local.available, local.provider) == (True, "local")
    durable = automation_of(Settings(database_url="postgresql://x", workflow_address="t:7233"))
    assert (durable.available, durable.provider) == (True, "workflow")
    # A stranger to the organization is refused, as for every workspace read.
    with connect(migrated.url) as connection:
        from test_execution import _seed_org

        stranger = _seed_org(connection, "automation-stranger")
    other = _client(migrated, stranger["user_id"], _Scheduler())
    assert other.get(f"{base}/workspace/automation").status_code in (403, 404)
