"""Completing, reopening, and deleting engagements (Milestone 8.14)."""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Json
from support import Database, approve_evidence_plans
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _choose_methodology, _complete_setup, _new_engagement
from test_outbound import _session, migrated
from test_projects import _edit

from ai_workforce_api.control_conclusions import CONCLUSION_CHANGED
from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _project(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _launched(migrated: Database, slug: str) -> dict[str, Any]:
    team = _new_engagement(migrated, slug)
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert launched.status_code == 200, launched.text
    # Nothing is requested before a person approves each control's evidence plan.
    approve_evidence_plans(migrated, team["project"])
    return team


def _finish_the_work(migrated: Database, team: dict[str, Any]) -> UUID:
    """One control left in scope and final as the register counts it; every request
    settled. Returns that control.

    Rewritten 19 November 2026 (FO-8, D&I sign-off integrity). Old: a SIGNED_OFF test sheet
    and a SIGNED_OFF review row were inserted, and those rows alone completed the
    engagement. New: completion reads finality (control_conclusions.concluded), so the one
    control is made final: its D&I conclusion signed off (approve_evidence_plans signs it,
    as support.sign_off_design does), the roll-forward decided not applicable, the interim
    sheet signed under the approved plan revision, and the review signed after it with the
    coverage a review records (that sheet version, the prepared design workpaper's version,
    and the verdict the records propose: Effective). Why: Completed must mean every
    in-scope control is final, as the register counts it; signed rows alone also completed
    an engagement whose review no longer covered its testing."""
    with connect(migrated.url) as connection, connection.transaction():
        control = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND included "
            "ORDER BY control_ref LIMIT 1",
            (team["project"],),
        ).fetchone()
        assert control is not None
        control_id = control[0]
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE project_id = %s AND id <> %s",
            (team["project"], control_id),
        )
        connection.execute(
            "UPDATE evidence_plan_phases SET applicability = 'NOT_APPLICABLE' "
            "WHERE engagement_control_id = %s AND phase = 'ROLLFORWARD'",
            (control_id,),
        )
        sheet = connection.execute(
            """
            INSERT INTO test_sheets (
                organization_id, project_id, engagement_control_id, method, attributes,
                requested_by, status, run_status, conclusion, signed_by, signed_at
            )
            VALUES (%s, %s, %s, 'TEST_OF_ONE', %s, %s, 'SIGNED_OFF', 'IDLE', 'EFFECTIVE',
                    %s, clock_timestamp())
            RETURNING version
            """,
            (team["org"], team["project"], control_id, Json(["Approved"]), team["owner_id"],
             team["owner_id"]),
        ).fetchone()  # fmt: skip
        assert sheet is not None
        papers = [
            {"stage": str(stage), "version": int(version)}
            for stage, version in connection.execute(
                "SELECT stage, prepared_version FROM workpapers "
                "WHERE engagement_control_id = %s AND status = 'PREPARED'",
                (control_id,),
            ).fetchall()
        ]
        assert [paper["stage"] for paper in papers] == ["DESIGN"]
        connection.execute(
            """
            INSERT INTO control_reviews (
                organization_id, project_id, engagement_control_id, opened_by, status,
                reperform_status, signed_by, signed_at, coverage
            )
            VALUES (%s, %s, %s, %s, 'SIGNED_OFF', 'IDLE', %s, clock_timestamp(), %s)
            """,
            (team["org"], team["project"], control_id, team["owner_id"], team["owner_id"],
             Json({"sheet_version": sheet[0], "workpapers": papers, "conclusion": "EFFECTIVE",
                   "verdict_recorded": True})),
        )  # fmt: skip
        connection.execute(
            "UPDATE pbc_requests SET status = 'CANCELLED', cancellation_reason = 'Test' "
            "WHERE project_id = %s AND status NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')",
            (team["project"],),
        )
    return UUID(str(control_id))


def _member(migrated: Database, team: dict[str, Any], role: str) -> TestClient:
    with connect(migrated.url) as connection:
        user_id = _add_user(
            connection, team["org"], f"{role.lower()}-{uuid4().hex[:6]}@x.test", role
        )
        _add_project_member(connection, team["org"], team["project"], user_id)
    return _session(migrated, user_id)


def test_an_engagement_completes_only_when_its_work_is_done(migrated: Database) -> None:
    team = _launched(migrated, "complete")
    owner, project = team["owner"], _project(team)
    state = owner.get(f"{project}/completion").json()
    assert state["status"] == "ACTIVE" and state["can_complete"] is False
    kinds = {item["kind"] for item in state["open_items"]}
    assert {"TEST", "REQUEST"} <= kinds
    assert state["open_count"] >= len(state["open_items"]) > 0
    refused = owner.post(f"{project}/complete", json={"version": state["version"]})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "work is still open"
    control_id = _finish_the_work(migrated, team)
    # A deficiency still open holds it.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO deficiencies (
                organization_id, project_id, reference, engagement_control_id, title,
                deficiency_type, identified_by
            )
            VALUES (%s, %s, 'D-001', %s, 'Late review', 'OPERATING', %s)
            """,
            (team["org"], team["project"], control_id, team["owner_id"]),
        )
    # Rewritten 19 November 2026 (FO-8). Old: the open deficiency was the only item. New: it
    # is listed, and the control is held too, because an open deficiency moves the verdict
    # the records propose to Not effective while the review signed Effective, so the review
    # is outstanding (control_conclusions.concluded). Why: completion reads finality.
    held = owner.get(f"{project}/completion").json()
    assert [item["kind"] for item in held["open_items"]] == ["REVIEW", "DEFICIENCY"]
    assert held["open_items"][0]["control_id"] == str(control_id)
    assert held["open_items"][0]["label"].endswith(CONCLUSION_CHANGED)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE deficiencies SET status = 'CLOSED', closed_at = clock_timestamp() "
            "WHERE project_id = %s",
            (team["project"],),
        )
    ready = owner.get(f"{project}/completion").json()
    assert ready["can_complete"] is True and ready["open_items"] == []
    stale = owner.post(f"{project}/complete", json={"version": ready["version"] - 1})
    assert stale.status_code == 409
    done = owner.post(f"{project}/complete", json={"version": ready["version"]})
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["status"] == "COMPLETED" and body["completed_at"] is not None
    # The agents' open tasks are cancelled; a second completion is refused.
    with connect(migrated.url) as connection:
        open_tasks = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s AND status NOT IN "
            "('CANCELLED', 'SUCCEEDED', 'FAILED')",
            (team["project"],),
        ).fetchone()
        reason = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s "
            "AND cancellation_reason = 'Engagement completed'",
            (team["project"],),
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'project.completed'",
            (team["project"],),
        ).fetchall()
    assert open_tasks is not None and open_tasks[0] == 0
    assert reason is not None and reason[0] > 0
    assert audit[0][0]["tasks_cancelled"] == reason[0]
    again = owner.post(f"{project}/complete", json={"version": body["version"]})
    assert again.status_code == 409


def test_a_completed_engagement_is_read_only_until_an_owner_reopens_it(
    migrated: Database,
) -> None:
    team = _launched(migrated, "reopen")
    owner, project = team["owner"], _project(team)
    _finish_the_work(migrated, team)
    version = owner.get(f"{project}/completion").json()["version"]
    assert owner.post(f"{project}/complete", json={"version": version}).status_code == 200
    # Every change is refused, in setup and the workspace alike; reading still works.
    base = _base(team["org"], team["project"])
    for path, payload in (
        (f"{base}/applications", {"name": "Workday"}),
        (f"{project}/deficiencies", {"title": "x"}),
        (f"{project}/tasks", {"title": "x"}),
    ):
        refused = owner.post(path, json=payload)
        assert refused.status_code == 409, path
        assert refused.json()["detail"] == "engagement is not active: it is completed and read-only"
    assert owner.get(base).status_code == 200
    detail = owner.get(project).json()
    assert detail["status"] == "COMPLETED"
    edited = owner.patch(
        project, json={**_edit(detail), "name": "Renamed", "version": detail["version"]}
    )
    assert edited.status_code == 409
    assert edited.json()["detail"] == "the engagement is completed; reopen it to change it"
    # Only an owner or admin reopens, and only with a reason.
    manager = _member(migrated, team, "PROJECT_MANAGER")
    assert manager.post(f"{project}/reopen", json={"version": detail["version"],
                        "reason": "Retest AC-01"}).status_code == 403  # fmt: skip
    short = owner.post(f"{project}/reopen", json={"version": detail["version"], "reason": "x"})
    assert short.status_code == 422
    # The database refuses a reopening that skips the record of why.
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.CheckViolation):
        connection.execute(
            "UPDATE projects SET status = 'ACTIVE' WHERE id = %s", (team["project"],)
        )
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.CheckViolation):
        connection.execute(
            "UPDATE projects SET status = 'PAUSED' WHERE id = %s", (team["project"],)
        )
    reopened = owner.post(
        f"{project}/reopen",
        json={"version": detail["version"], "reason": "  Client sent a corrected listing  "},
    )
    assert reopened.status_code == 200, reopened.text
    body = reopened.json()
    assert body["status"] == "ACTIVE" and body["completed_at"] is None
    assert [r["reason"] for r in body["reopenings"]] == ["Client sent a corrected listing"]
    added = owner.post(f"{base}/applications", json={"name": "Workday"})
    assert added.status_code == 200
    # Rewritten 19 November 2026 (FO-8, C3). Old: the engagement was completed again at once
    # with Workday added, and the result was never checked (it was refused: Workday's new
    # control instance was untested, so the archive below ran on a running engagement).
    # New: Workday's control holds completion until a person marks the system out of scope
    # with a reason; then it completes, and that is checked. Why: completion reads finality,
    # and a refused completion must not pass unseen.
    held = owner.get(f"{project}/completion").json()
    assert held["can_complete"] is False
    assert any("Workday" in item["label"] for item in held["open_items"])
    workday = next(a for a in added.json()["applications"] if a["name"] == "Workday")
    marked = owner.post(
        f"{base}/applications/{workday['id']}/remove",
        json={"reason": "Workday is not used for financial reporting."},
    )
    assert marked.status_code == 200, marked.text
    # Workday's evidence request drafts are settled as _finish_the_work settles the others.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'CANCELLED', cancellation_reason = 'Test' "
            "WHERE project_id = %s AND status NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')",
            (team["project"],),
        )
    # Completed again, it can be archived; archived stays closed for good.
    ready = owner.get(f"{project}/completion").json()
    assert ready["can_complete"] is True, ready["open_items"]
    again = owner.post(f"{project}/complete", json={"version": ready["version"]})
    assert again.status_code == 200, again.text
    body = again.json()
    assert body["status"] == "COMPLETED"
    detail = owner.get(project).json()
    archived = owner.patch(
        project, json={**_edit(detail), "status": "ARCHIVED", "version": detail["version"]}
    )
    assert archived.status_code == 200, archived.text
    closed = owner.post(f"{project}/reopen", json={"version": archived.json()["version"],
                        "reason": "Reopen it"})  # fmt: skip
    assert closed.status_code == 409
    archived_write = owner.post(f"{base}/applications", json={"name": "Okta"})
    assert (
        archived_write.json()["detail"] == "engagement is not active: it is archived and read-only"
    )


def test_the_closed_check_tells_nothing_to_another_firm(migrated: Database) -> None:
    team = _launched(migrated, "closed-leak")
    _finish_the_work(migrated, team)
    owner, project = team["owner"], _project(team)
    version = owner.get(f"{project}/completion").json()["version"]
    assert owner.post(f"{project}/complete", json={"version": version}).status_code == 200
    stranger = _new_engagement(migrated, "stranger")["owner"]
    probe = stranger.post(f"{_base(team['org'], team['project'])}/applications",
                          json={"name": "Workday"})  # fmt: skip
    assert probe.status_code in (403, 404)


def spellings(value: Any) -> list[str]:
    """Every spelling of an id that the routes accept (pydantic's UUID parsing) besides
    the hyphenated one: 32 hex digits, braced, `urn:uuid:`, and upper case 32 digits."""
    plain = UUID(str(value))
    return [plain.hex, f"{{{plain}}}", f"urn:uuid:{plain}", plain.hex.upper()]


def test_no_spelling_of_the_ids_writes_to_a_completed_engagement(migrated: Database) -> None:
    """Security sweep, 17 November 2026: the closed-engagement gate matched only the
    36-character hyphenated spelling of the ids, so the same write sent with the ids
    spelled as 32 hex digits, braced, or as `urn:uuid:` reached the route ungated."""
    team = _launched(migrated, "spelled")
    owner, project = team["owner"], _project(team)
    _finish_the_work(migrated, team)
    version = owner.get(f"{project}/completion").json()["version"]
    assert owner.post(f"{project}/complete", json={"version": version}).status_code == 200
    before = owner.get(f"{project}/tasks").json()
    for org, proj in zip(spellings(team["org"]), spellings(team["project"]), strict=True):
        refused = owner.post(f"/organizations/{org}/projects/{proj}/tasks", json={"title": "x"})
        assert refused.status_code == 409, (org, refused.text)
        assert refused.json()["detail"] == "engagement is not active: it is completed and read-only"
    assert owner.get(f"{project}/tasks").json() == before
    # A segment that is no id at all is refused by the route itself.
    assert owner.post(f"/organizations/{team['org']}/projects/not-an-id/tasks",
                      json={"title": "x"}).status_code in (404, 422)  # fmt: skip
    # Reopened with a reason, any spelling writes again.
    detail = owner.get(project).json()
    reopened = owner.post(
        f"/organizations/{spellings(team['org'])[0]}/projects/{spellings(team['project'])[2]}"
        "/reopen",
        json={"version": detail["version"], "reason": "Client sent a corrected listing"},
    )
    assert reopened.status_code == 200, reopened.text
    org, proj = spellings(team["org"])[1], spellings(team["project"])[0]
    written = owner.post(f"/organizations/{org}/projects/{proj}/tasks", json={"title": "x"})
    assert written.status_code != 409, written.text


def test_a_draft_that_never_launched_is_deleted_by_an_owner(migrated: Database) -> None:
    team = _new_engagement(migrated, "delete")
    owner, project = team["owner"], _project(team)
    _complete_setup(owner, team)
    detail = owner.get(project).json()
    assert owner.get(f"{project}/completion").json()["deletable"] is True
    manager = _member(migrated, team, "PROJECT_MANAGER")
    denied = manager.post(f"{project}/delete", json={"version": detail["version"],
                          "name": detail["name"]})  # fmt: skip
    assert denied.status_code == 403
    wrong = owner.post(f"{project}/delete", json={"version": detail["version"], "name": "SOX"})
    assert wrong.status_code == 422
    deleted = owner.post(
        f"{project}/delete", json={"version": detail["version"], "name": f" {detail['name']} "}
    )
    assert deleted.status_code == 200, deleted.text
    # Gone from every view, and its name is free again.
    assert owner.get(project).status_code == 404
    assert owner.get(_base(team["org"], team["project"])).status_code == 404
    listed = owner.get(f"/organizations/{team['org']}/projects").json()
    assert all(item["id"] != str(team["project"]) for item in listed)
    again = owner.post(
        f"/organizations/{team['org']}/projects",
        json={"name": detail["name"], "slug": detail["slug"], "scope": "",
              "owner_user_id": str(team["owner_id"]), "status": "DRAFT"},
    )  # fmt: skip
    assert again.status_code == 201, again.text
    with connect(migrated.url) as connection:
        left = {
            table: connection.execute(
                f"SELECT count(*) FROM {table} WHERE project_id = %s",  # noqa: S608
                (team["project"],),
            ).fetchone()
            for table in (
                "engagement_settings", "engagement_applications", "engagement_controls",
                "control_attributes", "project_memberships",
            )
        }  # fmt: skip
        audit = [
            row[0]
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE project_id = %s ORDER BY occurred_at",
                (team["project"],),
            ).fetchall()
        ]
        row = connection.execute(
            "SELECT deleted_at IS NOT NULL, scope, slug FROM projects WHERE id = %s",
            (team["project"],),
        ).fetchone()
    assert all(count is not None and count[0] == 0 for count in left.values()), left
    assert "project.created" in audit and audit[-1] == "project.deleted"
    assert row is not None and row[0] is True and row[1] == "" and row[2].startswith("deleted-")
    # The placeholder does not change again.
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.CheckViolation):
        connection.execute("UPDATE projects SET name = 'x' WHERE id = %s", (team["project"],))


def test_a_launched_engagement_is_not_deleted_and_an_archived_draft_is(
    migrated: Database,
) -> None:
    team = _launched(migrated, "no-delete")
    owner, project = team["owner"], _project(team)
    detail = owner.get(project).json()
    assert owner.get(f"{project}/completion").json()["deletable"] is False
    refused = owner.post(f"{project}/delete", json={"version": detail["version"],
                         "name": detail["name"]})  # fmt: skip
    assert refused.status_code == 409
    assert refused.json()["detail"] == "a launched engagement is not deleted"
    draft = _new_engagement(migrated, "archived-draft")
    owner, project = draft["owner"], _project(draft)
    detail = owner.get(project).json()
    archived = owner.patch(
        project, json={**_edit(detail), "status": "ARCHIVED", "version": detail["version"]}
    ).json()
    gone = owner.post(f"{project}/delete", json={"version": archived["version"],
                      "name": archived["name"]})  # fmt: skip
    assert gone.status_code == 200, gone.text
    assert owner.get(project).status_code == 404


# FO-8 and C3 (D&I sign-off integrity, 19 November 2026): completion reads finality, and an
# engagement with nothing in scope, or with a system in scope that has no control in scope,
# is not completed. Audit invariants I1 (nothing is final, and nothing completes, unless
# its whole basis is current) and I16 (completion agrees with the register).

NOTHING_SCOPED = (
    "No control is in scope, so nothing has been tested. Archive the engagement instead of "
    "completing it."
)


def _register_row(team: dict[str, Any], control_id: UUID) -> dict[str, Any]:
    rows = team["owner"].get(f"{_project(team)}/workspace/controls").json()
    row: dict[str, Any] = next(r for r in rows if r["id"] == str(control_id))
    return row


def test_an_engagement_is_not_completed_while_a_control_is_not_final(
    migrated: Database,
) -> None:
    """Before, completion checked that a signed sheet and a signed review existed. A sheet
    signed again after the review (every row still SIGNED_OFF) left the control not final
    in the register, and the engagement still completed, cancelling its open tasks. Now
    completion holds on the register's own reason, and the POST is refused."""
    team = _launched(migrated, "not-final")
    owner, project = team["owner"], _project(team)
    control_id = _finish_the_work(migrated, team)
    assert _register_row(team, control_id)["final"] is True
    assert owner.get(f"{project}/completion").json()["can_complete"] is True
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE test_sheets SET signed_at = clock_timestamp() + interval '1 minute', "
            "version = version + 1 WHERE engagement_control_id = %s",
            (control_id,),
        )
        statuses = connection.execute(
            "SELECT (SELECT status FROM test_sheets WHERE engagement_control_id = %s), "
            "(SELECT status FROM control_reviews WHERE engagement_control_id = %s)",
            (control_id, control_id),
        ).fetchone()
    assert statuses == ("SIGNED_OFF", "SIGNED_OFF")
    row = _register_row(team, control_id)
    assert row["final"] is False
    state = owner.get(f"{project}/completion").json()
    assert state["can_complete"] is False
    [item] = state["open_items"]
    assert (item["kind"], item["control_id"]) == ("REVIEW", str(control_id))
    # The completion card says the register's leading reason, word for word.
    assert item["label"].endswith(": " + row["not_final"][0]["text"])
    assert "review outstanding" in item["label"]
    refused = owner.post(f"{project}/complete", json={"version": state["version"]})
    assert refused.status_code == 409
    assert owner.get(project).json()["status"] == "ACTIVE"


def test_an_engagement_with_nothing_in_scope_is_not_completed(migrated: Database) -> None:
    """C3. Before, an engagement launched with no control in scope had nothing open, so it
    completed with nothing tested. Now it is held with one item that says to archive it."""
    team = _new_engagement(migrated, "empty-scope")
    owner, project = team["owner"], _project(team)
    base = _base(team["org"], team["project"])
    scoped = owner.patch(
        f"{base}/scope", json={"scope": "ITGCs FY2027", "period_end": "2027-12-31"}
    )
    assert scoped.status_code == 200
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        added = owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
        assert added.status_code == 200, added.text
    _choose_methodology(owner, base)
    preview = owner.get(base).json()["plan_preview"]
    assert preview is not None and preview["items"] == []
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": preview["fingerprint"]})
    assert launched.status_code == 200, launched.text
    state = owner.get(f"{project}/completion").json()
    assert state["status"] == "ACTIVE" and state["can_complete"] is False
    assert state["open_items"] == [{"kind": "SCOPE", "label": NOTHING_SCOPED, "control_id": None}]
    assert state["nothing_in_scope"] is True
    refused = owner.post(f"{project}/complete", json={"version": state["version"]})
    assert refused.status_code == 409
    assert owner.get(project).json()["status"] == "ACTIVE"


def test_taking_every_control_out_holds_completion(migrated: Database) -> None:
    """C3. Every control taken out of scope through the API, with a reason: nothing is in
    scope, so completion is held and the engagement is to be archived. Rewritten (design
    review, 20 November 2026). Old: held by both "nothing is in scope" and "SAP ERP: no
    control in scope; mark the system out of scope". New: held by "nothing is in scope"
    only. Why: with nothing in scope the engagement is archived, never completed, so
    marking a system out of scope cannot lead to completion and the card contradicted
    itself."""
    team = _launched(migrated, "all-out")
    owner, project = team["owner"], _project(team)
    base = _base(team["org"], team["project"])
    with connect(migrated.url) as connection:
        controls = [
            row[0]
            for row in connection.execute(
                "SELECT id FROM engagement_controls WHERE project_id = %s AND included",
                (team["project"],),
            ).fetchall()
        ]
    assert controls
    for control in controls:
        out = owner.post(
            f"{base}/controls/{control}/scope",
            json={"included": False, "reason": "Covered by the vendor's SOC 1 report."},
        )
        assert out.status_code == 200, out.text
    state = owner.get(f"{project}/completion").json()
    assert state["can_complete"] is False
    scope = [item for item in state["open_items"] if item["kind"] == "SCOPE"]
    assert [item["label"] for item in scope] == [NOTHING_SCOPED]
    assert state["nothing_in_scope"] is True
    refused = owner.post(f"{project}/complete", json={"version": state["version"]})
    assert refused.status_code == 409


def test_a_system_with_no_control_in_scope_holds_completion_until_it_is_marked_out(
    migrated: Database,
) -> None:
    """C3. A system added after launch whose control instances are all taken out of scope
    holds completion, on its own item, until a person marks the system out of scope with a
    reason; then it completes."""
    team = _launched(migrated, "system-gap")
    owner, project = team["owner"], _project(team)
    base = _base(team["org"], team["project"])
    _finish_the_work(migrated, team)
    added = owner.post(f"{base}/applications", json={"name": "Workday"})
    assert added.status_code == 200, added.text
    workday = next(a for a in added.json()["applications"] if a["name"] == "Workday")
    # Its control instances leave scope, each with a reason; the system stays in scope.
    with connect(migrated.url) as connection:
        instances = [
            row[0]
            for row in connection.execute(
                "SELECT id FROM engagement_controls WHERE engagement_application_id = %s "
                "AND included",
                (workday["id"],),
            ).fetchall()
        ]
    for instance in instances:
        out = owner.post(
            f"{base}/controls/{instance}/scope",
            json={"included": False, "reason": "Workday access is tested next year."},
        )
        assert out.status_code == 200, out.text
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'CANCELLED', cancellation_reason = 'Test' "
            "WHERE project_id = %s AND status NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')",
            (team["project"],),
        )
    state = owner.get(f"{project}/completion").json()
    assert state["can_complete"] is False
    assert state["open_items"] == [
        {
            "kind": "SCOPE",
            "label": "Workday: no control in scope; mark the system out of scope with your reason",
            "control_id": None,
        }
    ]
    # One SCOPE item with no control, yet something is in scope: not "nothing in scope".
    assert state["nothing_in_scope"] is False
    assert owner.post(f"{project}/complete", json={"version": state["version"]}).status_code == 409
    marked = owner.post(
        f"{base}/applications/{workday['id']}/remove",
        json={"reason": "Workday is not used for financial reporting."},
    )
    assert marked.status_code == 200, marked.text
    ready = owner.get(f"{project}/completion").json()
    assert ready["can_complete"] is True and ready["open_items"] == []
    done = owner.post(f"{project}/complete", json={"version": ready["version"]})
    assert done.status_code == 200, done.text
