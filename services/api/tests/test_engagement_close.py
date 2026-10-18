"""Completing, reopening, and deleting engagements (Milestone 8.14)."""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Json
from support import Database, approve_evidence_plans
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _complete_setup, _new_engagement
from test_outbound import _session, migrated
from test_projects import _edit

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
    """One control left in scope, tested and reviewed and signed off; every request
    settled. Returns that control."""
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
            """
            INSERT INTO test_sheets (
                organization_id, project_id, engagement_control_id, method, attributes,
                requested_by, status, run_status, conclusion, signed_by, signed_at
            )
            VALUES (%s, %s, %s, 'TEST_OF_ONE', %s, %s, 'SIGNED_OFF', 'IDLE', 'EFFECTIVE',
                    %s, clock_timestamp())
            """,
            (team["org"], team["project"], control_id, Json(["Approved"]), team["owner_id"],
             team["owner_id"]),
        )  # fmt: skip
        connection.execute(
            """
            INSERT INTO control_reviews (
                organization_id, project_id, engagement_control_id, opened_by, status,
                reperform_status, signed_by, signed_at
            )
            VALUES (%s, %s, %s, %s, 'SIGNED_OFF', 'IDLE', %s, clock_timestamp())
            """,
            (team["org"], team["project"], control_id, team["owner_id"], team["owner_id"]),
        )
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
    held = owner.get(f"{project}/completion").json()
    assert [item["kind"] for item in held["open_items"]] == ["DEFICIENCY"]
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
    assert owner.post(f"{base}/applications", json={"name": "Workday"}).status_code == 200
    # Completed again, it can be archived; archived stays closed for good.
    body = owner.post(f"{project}/complete", json={"version": body["version"]}).json()
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
