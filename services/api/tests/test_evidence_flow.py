"""The evidence workflow's integrity: planning before requesting, a kickoff draft settled by
a person against the plan, a rejected request back to draft, and one next step that says
which of these a control waits for."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import pytest
from support import Database, approve_evidence_plans, settle_attributes
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _complete_setup, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api import onboarding
from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _project(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _launch(owner: Any, team: dict[str, Any]) -> None:
    base = _base(team["org"], team["project"])
    preview = owner.get(base).json()["plan_preview"]
    started = owner.post(f"{base}/plan/launch", json={"fingerprint": preview["fingerprint"]})
    assert started.status_code == 200, started.text
    # Nothing is requested before a person approves each control's evidence plan.
    approve_evidence_plans(Database(owner.app.state.settings.database_url), team["project"])


def _drafted(migrated: Database, team: dict[str, Any]) -> None:
    """Run the evidence coordinator's pending drafts (by the rules, as no model is set): a
    request still showing its placeholder wording cannot be submitted or approved."""
    from ai_workforce_api.pbc_drafting import run_draft

    with connect(migrated.url) as connection:
        for row in connection.execute(
            "SELECT id FROM pbc_drafts WHERE project_id = %s AND status = 'PENDING'",
            (team["project"],),
        ).fetchall():
            run_draft(connection, None, row[0])


def _approve_plan(owner: Any, path: str) -> None:
    """A person approves the control's evidence plan (the planning gate)."""
    plan = owner.get(path).json()
    approved = owner.post(f"{path}/approve", json={"version": plan["version"]})
    assert approved.status_code == 200, approved.text


def _legacy(
    migrated: Database, slug: str, monkeypatch: pytest.MonkeyPatch
) -> tuple[dict[str, Any], str, UUID]:
    """An engagement launched before evidence planning existed: no plans, and one control
    with the request the kickoff drafted for it."""
    team = _new_engagement(migrated, slug)
    owner = team["owner"]
    _complete_setup(owner, team)
    monkeypatch.setattr(onboarding, "plan_and_issue", lambda *args, **kwargs: [])
    _launch(owner, team)
    monkeypatch.undo()
    control = next(
        c for c in owner.get(_base(team["org"], team["project"])).json()["controls"]
        if c["included"] and c["control_ref"] == "ITGC-AC-01"
    )  # fmt: skip
    with connect(migrated.url) as connection:
        row = connection.execute(
            """
            INSERT INTO pbc_requests (
                organization_id, project_id, operation_key, control_ref, owner_user_id,
                recipient, due_at, evidence_description, engagement_control_id, testing_phase,
                drafted_by
            )
            VALUES (%s, %s, %s, 'ITGC-AC-01', %s, 'iam@client.example', %s,
                    '- The access request for each new user, as edited by the team', %s,
                    'INTERIM', 'AGENT')
            RETURNING id
            """,
            (
                team["org"], team["project"], f"kickoff-legacy-{control['id']}",
                team["owner_id"], datetime.now(UTC) + timedelta(days=10), control["id"],
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
    return team, str(control["id"]), UUID(str(row[0]))


def _row(owner: Any, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    rows = owner.get(f"{_project(team)}/workspace/controls").json()
    found: dict[str, Any] = next(r for r in rows if r["id"] == control_id)
    return found


def _request(migrated: Database, request_id: UUID) -> tuple[str, str]:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT status, evidence_description FROM pbc_requests WHERE id = %s", (request_id,)
        ).fetchone()
    assert row is not None
    return str(row[0]), str(row[1])


# Scenario B and C: no plan, and a request drafted before planning.


def test_a_control_launched_before_planning_says_to_plan_first(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team, control_id, legacy = _legacy(migrated, "flow-unplanned", monkeypatch)
    owner = team["owner"]
    row = _row(owner, team, control_id)
    assert row["evidence_plan"] == "NONE"
    assert row["next_step"] == "Plan the evidence (request drafted before planning)"
    assert row["actor"] == "PREPARER"
    kickoff = next(r for r in row["requests"] if r["id"] == str(legacy))
    assert kickoff["kickoff"] is True and kickoff["status"] == "DRAFT"
    plan = owner.get(f"{_project(team)}/controls/{control_id}/evidence-plan").json()
    assert plan["status"] == "NOT_PLANNED"
    assert plan["reconcile"]["request_id"] == str(legacy)
    assert plan["reconcile"]["waiting_items"] == 0
    dashboard = owner.get(f"{_project(team)}/workspace/dashboard").json()
    included = sum(1 for c in owner.get(_base(team["org"], team["project"])).json()["controls"]
                   if c["included"])  # fmt: skip
    assert dashboard["unplanned_controls"] == included
    # The inbox does not offer it for submission: it waits for planning.
    waiting = owner.get(f"{_project(team)}/console/inbox").json()["waiting"]
    assert not any(item["kind"] == "drafts" for item in waiting)
    planning = [item for item in waiting if item["kind"] == "planning"]
    # One item per drafted request (the engagement's one queue), held for planning.
    assert len(planning) == 1 and "Plan the evidence" in planning[0]["detail"]
    # Submitting around the plan is refused by the API, not only hidden on the page.
    refused = owner.post(f"{_project(team)}/pbc-requests/{legacy}/submit", json={"version": 1})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "plan the evidence first"


def test_planning_never_replaces_a_kickoff_draft_on_its_own(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team, control_id, legacy = _legacy(migrated, "flow-hold", monkeypatch)
    owner = team["owner"]
    planned = owner.post(f"{_project(team)}/controls/{control_id}/evidence-plan/generate")
    assert planned.status_code == 200, planned.text
    body = planned.json()
    # The plan waits for a person; the kickoff draft is still a person's to settle.
    assert body["status"] == "PROPOSED" and body["approved_automatically"] is False
    # The draft stands, as written, and the plan's design and interim items wait on it.
    assert _request(migrated, legacy) == (
        "DRAFT", "- The access request for each new user, as edited by the team",
    )  # fmt: skip
    assert body["reconcile"]["request_id"] == str(legacy)
    assert body["reconcile"]["waiting_items"] > 0
    with connect(migrated.url) as connection:
        made = connection.execute(
            "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s "
            "AND operation_key LIKE 'plan-%%' AND testing_phase IN ('DESIGN', 'INTERIM')",
            (control_id,),
        ).fetchone()
    assert made == (0,)
    row = _row(owner, team, control_id)
    # Proposed; the kickoff draft is settled against the plan before anything is asked.
    assert row["evidence_plan"] == "PROPOSED" and row["reconcile"] is True
    assert row["next_step"] == "Reconcile the kickoff draft with the evidence plan"
    refused = owner.post(f"{_project(team)}/pbc-requests/{legacy}/submit", json={"version": 1})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "settle the kickoff draft against the plan first"


def test_replacing_the_kickoff_draft_keeps_it_on_record(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team, control_id, legacy = _legacy(migrated, "flow-replace", monkeypatch)
    owner = team["owner"]
    path = f"{_project(team)}/controls/{control_id}/evidence-plan"
    owner.post(f"{path}/generate")
    _approve_plan(owner, path)
    unexplained = owner.post(
        f"{path}/reconcile", json={"action": "REPLACE", "request_version": 1, "reason": ""}
    )
    assert unexplained.status_code == 422
    stale = owner.post(
        f"{path}/reconcile",
        json={"action": "REPLACE", "request_version": 9, "reason": "The plan asks better."},
    )
    assert stale.status_code == 409
    replaced = owner.post(
        f"{path}/reconcile",
        json={"action": "REPLACE", "request_version": 1, "reason": "The plan asks better."},
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["reconcile"] is None
    status, _ = _request(migrated, legacy)
    assert status == "CANCELLED"
    with connect(migrated.url) as connection:
        reason = connection.execute(
            "SELECT cancellation_reason FROM pbc_requests WHERE id = %s", (legacy,)
        ).fetchone()
        made = connection.execute(
            "SELECT status FROM pbc_requests WHERE engagement_control_id = %s "
            "AND operation_key LIKE 'plan-%%'",
            (control_id,),
        ).fetchall()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE target_id = %s "
            "AND action = 'evidence_plan.reconciled'",
            (legacy,),
        ).fetchone()
    assert reason is not None and "The plan asks better." in str(reason[0])
    assert made and all(row[0] == "DRAFT" for row in made)
    assert audit is not None and audit[0]["action"] == "REPLACE"
    row = _row(owner, team, control_id)
    assert row["reconcile"] is False
    assert row["next_step"] == "Submit the evidence request"


def test_keeping_the_kickoff_draft_links_the_plan_items_without_rewording_it(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team, control_id, legacy = _legacy(migrated, "flow-keep", monkeypatch)
    owner = team["owner"]
    path = f"{_project(team)}/controls/{control_id}/evidence-plan"
    waiting = owner.post(f"{path}/generate").json()["reconcile"]["waiting_items"]
    _approve_plan(owner, path)
    kept = owner.post(f"{path}/reconcile", json={"action": "KEEP", "request_version": 1})
    assert kept.status_code == 200, kept.text
    body = kept.json()
    assert body["reconcile"] is None
    carried = [
        q for phase in body["phases"] for q in phase["requirements"]
        if q["request_id"] == str(legacy)
    ]  # fmt: skip
    assert len(carried) == waiting
    assert _request(migrated, legacy) == (
        "DRAFT", "- The access request for each new user, as edited by the team",
    )  # fmt: skip
    assert _row(owner, team, control_id)["next_step"] == "Submit the evidence request"
    again = owner.post(f"{path}/reconcile", json={"action": "KEEP", "request_version": 1})
    assert again.status_code == 409
    # Settled, and its operating evidence follows settled attributes: the kept draft goes
    # for approval like any other.
    settle_attributes(migrated, team["project"])
    submitted = owner.post(f"{_project(team)}/pbc-requests/{legacy}/submit", json={"version": 1})
    assert submitted.status_code == 200, submitted.text


def test_unplanned_controls_are_planned_when_asked_and_only_once(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team, control_id, legacy = _legacy(migrated, "flow-missing", monkeypatch)
    owner = team["owner"]
    before = owner.get(f"{_project(team)}/workspace/dashboard").json()["unplanned_controls"]
    first = owner.post(f"{_project(team)}/evidence-plans/plan-missing")
    assert first.status_code == 200, first.text
    assert first.json() == {"planned": before, "requested": 0, "failed": [], "remaining": 0}
    second = owner.post(f"{_project(team)}/evidence-plans/plan-missing")
    assert second.json() == {"planned": 0, "requested": 0, "failed": [], "remaining": 0}
    # The kickoff draft still waits for a person.
    assert _request(migrated, legacy)[0] == "DRAFT"
    assert _row(owner, team, control_id)["reconcile"] is True


# Scenario E and H: approval, rejection, and who may decide.


def test_a_rejected_request_returns_to_draft_and_an_approved_one_waits_to_be_sent(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "flow-approval")
    owner = team["owner"]
    _complete_setup(owner, team)
    _launch(owner, team)
    _drafted(migrated, team)
    row = next(r for r in owner.get(f"{_project(team)}/workspace/controls").json()
               if r["included"] and r["requests"])  # fmt: skip
    drafts = [r for r in row["requests"] if r["status"] == "DRAFT"]
    request = drafts[0]
    requests = f"{_project(team)}/pbc-requests/{request['id']}"
    whole = owner.get(requests)
    assert whole.status_code == 200 and whole.json()["evidence_description"] != ""
    # It names its control, so the Evidence page opens it for review on the control.
    assert whole.json()["engagement_control_id"] == row["id"]
    # Every draft on the control goes for approval; the first is the one followed here.
    approvals: list[str] = []
    for draft in drafts:
        submitted = owner.post(
            f"{_project(team)}/pbc-requests/{draft['id']}/submit",
            json={"version": draft["version"]},
        )
        assert submitted.status_code == 200, submitted.text
        approvals.append(submitted.json()["approval"]["id"])
    decide = f"{_project(team)}/approvals/{approvals[0]}/decision"
    # The person who asked cannot approve; someone without the right cannot either.
    own = owner.post(decide, json={"decision": "APPROVED", "reason": "Looks right."})
    assert own.status_code == 409
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "flow-member@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    refused = _session(migrated, member).post(
        decide, json={"decision": "APPROVED", "reason": "Looks right."}
    )
    assert refused.status_code == 403
    after = _row(owner, team, row["id"])
    pending = next(r for r in after["requests"] if r["id"] == request["id"])
    assert pending["approval_decision"] == "PENDING"
    # The page offers the decision only to someone who may make it.
    assert pending["viewer_can_decide"] is False
    seen = _row(_session(migrated, team["reviewer_id"]), team, row["id"])
    assert next(r for r in seen["requests"] if r["id"] == request["id"])["viewer_can_decide"]
    assert after["next_step"] == "Approve the evidence request" and after["actor"] == "APPROVER"
    reviewer = _session(migrated, team["reviewer_id"])
    rejected = reviewer.post(
        decide, json={"decision": "REJECTED", "reason": "Ask for the approver's name too."}
    )
    assert rejected.status_code == 200, rejected.text
    with connect(migrated.url) as connection:
        status = connection.execute(
            "SELECT status FROM pbc_requests WHERE id = %s", (request["id"],)
        ).fetchone()
        audit = connection.execute(
            "SELECT actor_user_id, payload FROM audit_events WHERE target_id = %s "
            "AND action = 'pbc.returned_for_revision'",
            (request["id"],),
        ).fetchone()
    assert status == ("DRAFT",)
    assert audit is not None and str(audit[0]) == str(team["reviewer_id"])
    assert audit[1]["reason"] == "Ask for the approver's name too."
    returned = _row(owner, team, row["id"])
    back = next(r for r in returned["requests"] if r["id"] == request["id"])
    assert back["approval_decision"] == "REJECTED"
    assert back["approval_reason"] == "Ask for the approver's name too."
    assert returned["next_step"] == "Submit the evidence request"
    # Submitted again and every request approved: they wait for the preparer to send.
    again = owner.post(f"{requests}/submit", json={"version": back["version"]})
    assert again.status_code == 200, again.text
    for approval in [again.json()["approval"]["id"], *approvals[1:]]:
        approved = reviewer.post(
            f"{_project(team)}/approvals/{approval}/decision",
            json={"decision": "APPROVED", "reason": "Complete."},
        )
        assert approved.status_code == 200, approved.text
    ready = _row(owner, team, row["id"])
    assert ready["next_step"] == "Send the approved evidence request"
    assert ready["actor"] == "PREPARER"


def test_a_request_is_read_only_inside_its_engagement(migrated: Database) -> None:
    team = _new_engagement(migrated, "flow-read")
    other = _new_engagement(migrated, "flow-read-other")
    owner = team["owner"]
    _complete_setup(owner, team)
    _launch(owner, team)
    request = next(
        r for row in owner.get(f"{_project(team)}/workspace/controls").json()
        for r in row["requests"]
    )  # fmt: skip
    elsewhere = other["owner"].get(f"{_project(other)}/pbc-requests/{request['id']}")
    assert elsewhere.status_code == 404


def test_replacing_needs_someone_to_send_the_plans_requests_to(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """As in engagements launched with no coordinator and no owner emails: replacing
    would cancel the draft and draft nothing, so it is refused; keeping still works."""
    team, control_id, legacy = _legacy(migrated, "flow-nobody", monkeypatch)
    owner = team["owner"]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_coordinator_email = '' WHERE project_id = %s",
            (team["project"],),
        )
        connection.execute(
            "UPDATE engagement_controls SET owner_email = '' WHERE id = %s", (control_id,)
        )
    path = f"{_project(team)}/controls/{control_id}/evidence-plan"
    assert owner.post(f"{path}/generate").status_code == 200
    refused = owner.post(
        f"{path}/reconcile",
        json={"action": "REPLACE", "request_version": 1, "reason": "The plan asks better."},
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "set the evidence coordinator or the owner's email first"
    assert _request(migrated, legacy)[0] == "DRAFT"
    kept = owner.post(f"{path}/reconcile", json={"action": "KEEP", "request_version": 1})
    assert kept.status_code == 200, kept.text


def _nobody(migrated: Database, team: dict[str, Any]) -> None:
    """No evidence coordinator and no owner emails, as on the dev engagements."""
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_coordinator_email = '', "
            "client_coordinator_name = '' WHERE project_id = %s",
            (team["project"],),
        )
        connection.execute(
            "UPDATE engagement_controls SET owner_email = '' WHERE project_id = %s",
            (team["project"],),
        )


def test_a_launch_with_no_one_to_send_to_still_drafts_its_requests(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "flow-unaddressed")
    owner = team["owner"]
    _complete_setup(owner, team)
    _nobody(migrated, team)
    _launch(owner, team)
    _drafted(migrated, team)
    with connect(migrated.url) as connection:
        made = connection.execute(
            "SELECT id, recipient, status, version FROM pbc_requests WHERE project_id = %s",
            (team["project"],),
        ).fetchall()
    # Every control's design and interim requests exist, addressed to no one yet.
    assert made and all(row[1] == "" and row[2] == "DRAFT" for row in made)
    dashboard = owner.get(f"{_project(team)}/workspace/dashboard").json()
    assert dashboard["unaddressed_requests"] == len(made)
    assert dashboard["unrequested_controls"] == 0
    # The inbox does not call them ready to submit: they wait for a recipient.
    inbox = owner.get(f"{_project(team)}/console/inbox").json()["waiting"]
    assert not any(item["kind"] == "drafts" for item in inbox)
    # One item per drafted request (the engagement's one queue), each without a recipient.
    assert len([item for item in inbox if item["kind"] == "contacts"]) == len(made)
    refused = owner.post(
        f"{_project(team)}/pbc-requests/{made[0][0]}/submit", json={"version": made[0][3]}
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "set who the request goes to first"
    # Naming the evidence coordinator addresses them all.
    contacts = owner.patch(
        f"{_base(team['org'], team['project'])}/evidence-contacts",
        json={
            "client_coordinator_name": "Pat Lee",
            "client_coordinator_email": "pbc@client.example",
            "client_domains": ["client.example"],
        },
    )
    assert contacts.status_code == 200, contacts.text
    assert owner.get(f"{_project(team)}/workspace/dashboard").json()["unaddressed_requests"] == 0
    with connect(migrated.url) as connection:
        version = connection.execute(
            "SELECT version FROM pbc_requests WHERE id = %s", (made[0][0],)
        ).fetchone()
    assert version is not None
    submitted = owner.post(
        f"{_project(team)}/pbc-requests/{made[0][0]}/submit", json={"version": version[0]}
    )
    assert submitted.status_code == 200, submitted.text


def test_planned_evidence_never_requested_is_requested_when_asked(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """As an engagement launched while unaddressed requests were skipped: plans, and no
    requests. The dashboard counts them, and asking requests them, once."""
    from ai_workforce_api import evidence_plans

    team = _new_engagement(migrated, "flow-unrequested")
    owner = team["owner"]
    _complete_setup(owner, team)
    _nobody(migrated, team)
    monkeypatch.setattr(
        evidence_plans, "issue", lambda *args, **kwargs: evidence_plans.Issued([], [])
    )
    _launch(owner, team)
    monkeypatch.undo()
    with connect(migrated.url) as connection:
        none = connection.execute(
            "SELECT count(*) FROM pbc_requests WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert none == (0,)
    dashboard = owner.get(f"{_project(team)}/workspace/dashboard").json()
    included = sum(
        1 for c in owner.get(_base(team["org"], team["project"])).json()["controls"]
        if c["included"]
    )  # fmt: skip
    assert dashboard["unplanned_controls"] == 0
    assert dashboard["unrequested_controls"] == included
    first = owner.post(f"{_project(team)}/evidence-plans/plan-missing")
    assert first.status_code == 200, first.text
    assert first.json() == {"planned": 0, "requested": included, "failed": [], "remaining": 0}
    with connect(migrated.url) as connection:
        made = connection.execute(
            "SELECT count(*) FROM pbc_requests WHERE project_id = %s AND status = 'DRAFT'",
            (team["project"],),
        ).fetchone()
    assert made is not None and made[0] >= included
    again = owner.post(f"{_project(team)}/evidence-plans/plan-missing")
    assert again.json() == {"planned": 0, "requested": 0, "failed": [], "remaining": 0}


def test_the_reviewer_approves_an_agent_draft_without_a_second_person(
    migrated: Database,
) -> None:
    """The agent drafted it, so the agent asked; the person who reviews it approves it.
    It then waits to be sent. A request a person wrote still needs someone else."""
    team = _new_engagement(migrated, "flow-approve-draft")
    owner = team["owner"]
    _complete_setup(owner, team)
    _launch(owner, team)
    _drafted(migrated, team)
    row = next(r for r in owner.get(f"{_project(team)}/workspace/controls").json()
               if r["included"] and r["requests"])  # fmt: skip
    draft = next(r for r in row["requests"] if r["status"] == "DRAFT")
    path = f"{_project(team)}/pbc-requests/{draft['id']}"
    # Someone who prepares requests but may not approve them cannot.
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "approve-member@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    refused = _session(migrated, member).post(f"{path}/approve", json={"version": draft["version"]})
    assert refused.status_code == 403
    approved = owner.post(
        f"{path}/approve",
        json={"version": draft["version"], "reason": "Read it; asks for the right items."},
    )
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["request"]["status"] == "APPROVAL_PENDING"
    assert body["approval"]["decision"] == "APPROVED"
    assert body["approval"]["requesting_agent_id"] is not None
    assert str(body["approval"]["approver_user_id"]) == str(team["owner_id"])
    assert body["approval"]["decision_reason"] == "Read it; asks for the right items."
    after = _row(owner, team, row["id"])
    mine = next(r for r in after["requests"] if r["id"] == draft["id"])
    assert mine["approval_decision"] == "APPROVED"
    # Approving twice is refused: it is no longer a draft.
    again = owner.post(f"{path}/approve", json={"version": body["request"]["version"]})
    assert again.status_code == 409
    # A request written by a person is not approved by its own author this way.
    manual = owner.post(
        f"{_project(team)}/pbc-requests",
        json={
            "operation_key": "manual-flow-1",
            "control_ref": "ITGC-AC-01",
            "recipient": "pbc@client.example",
            "due_at": (datetime.now(UTC) + timedelta(days=5)).isoformat(),
            "evidence_description": "- The access listing",
        },
    )
    assert manual.status_code in (200, 201), manual.text
    own = owner.post(
        f"{_project(team)}/pbc-requests/{manual.json()['id']}/approve", json={"version": 1}
    )
    assert own.status_code == 409
    assert own.json()["detail"] == "only an agent's draft is approved by its reviewer"
