"""Engagement integrity (Milestone 8.13): one system or control ID however it is cased, a
launch that happens once, and a tested control that does not change silently."""

from typing import Any
from uuid import UUID

import pytest
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from support import Database
from test_manual_controls import _body
from test_onboarding import _base, _complete_setup, _control_fields, _new_engagement
from test_outbound import migrated
from test_projects import _edit

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def test_a_system_is_in_scope_once_however_it_is_written(migrated: Database) -> None:
    team = _new_engagement(migrated, "dup-system")
    owner, base = team["owner"], _base(team["org"], team["project"])
    assert owner.post(f"{base}/applications", json={"name": "SAP ERP"}).status_code == 200
    for name in ("SAP ERP", "sap erp", "  Sap   Erp "):
        again = owner.post(f"{base}/applications", json={"name": name})
        assert again.status_code == 409, name
        assert again.json()["detail"] == "system is already in scope"
    # A known system already in scope is refused; one picked beside it is still added.
    assert owner.post(f"{base}/applications/known", json={"names": ["Okta"]}).status_code == 200
    only_taken = owner.post(f"{base}/applications/known", json={"names": ["Okta"]})
    assert only_taken.status_code == 409
    custom_taken = owner.post(
        f"{base}/applications/known",
        json={"custom": [{"name": "OKTA", "layer": "INFRASTRUCTURE"}]},
    )
    assert custom_taken.status_code == 409
    mixed = owner.post(f"{base}/applications/known", json={"names": ["Okta", "Workday"]})
    assert mixed.status_code == 200, mixed.text
    names = sorted(a["name"] for a in mixed.json()["applications"])
    assert names == ["Okta", "SAP ERP", "Workday"]
    # The database refuses a second one written any other way.
    with connect(migrated.url) as connection, pytest.raises(UniqueViolation):
        connection.execute(
            "INSERT INTO engagement_applications (organization_id, project_id, name) "
            "VALUES (%s, %s, %s)",
            (team["org"], team["project"], " workday"),
        )


def test_a_control_id_is_taken_however_it_is_cased(migrated: Database) -> None:
    team = _new_engagement(migrated, "dup-control")
    owner, base = team["owner"], _base(team["org"], team["project"])
    assert owner.post(f"{base}/controls/new", json=_body()).status_code == 200
    again = owner.post(f"{base}/controls/new", json=_body(control_ref="rev-09"))
    assert again.status_code == 409
    assert again.json()["detail"] == "control ID exists"
    refs = [c["control_ref"] for c in owner.get(base).json()["controls"]]
    assert refs.count("REV-09") == 1 and "rev-09" not in refs
    # The database refuses the same ID cased another way on the same system.
    with connect(migrated.url) as connection:
        columns = [
            row[0]
            for row in connection.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'engagement_controls' "
                "AND column_name NOT IN ('id', 'control_ref', 'created_at', 'updated_at')"
            ).fetchall()
        ]
        listed = ", ".join(columns)
        with pytest.raises(UniqueViolation):
            connection.execute(
                f"INSERT INTO engagement_controls (control_ref, {listed}) "  # noqa: S608
                f"SELECT 'Rev-09', {listed} FROM engagement_controls "
                "WHERE project_id = %s AND control_ref = 'REV-09'",
                (team["project"],),
            )


def test_an_engagement_launches_once(migrated: Database) -> None:
    team = _new_engagement(migrated, "launch-once")
    owner, base = team["owner"], _base(team["org"], team["project"])
    # Not before setup is complete.
    early = owner.post(f"{base}/plan/launch", json={"fingerprint": "0" * 64})
    assert early.status_code == 409
    _complete_setup(owner, team)
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    first = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert first.status_code == 200, first.text
    second = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert second.status_code == 409
    assert second.json()["detail"] == "engagement has started"
    with connect(migrated.url) as connection:
        tasks = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s", (team["project"],)
        ).fetchone()
        plans = connection.execute(
            "SELECT count(*) FROM engagement_plans WHERE project_id = %s AND status = 'APPROVED'",
            (team["project"],),
        ).fetchone()
    assert tasks is not None and tasks[0] == 125
    assert plans is not None and plans[0] == 1
    # The engagement is active and its setup locked; it cannot be made a draft again.
    state = owner.get(base).json()
    assert state["started"] is True and state["project_status"] == "ACTIVE"
    project = f"/organizations/{team['org']}/projects/{team['project']}"
    detail = owner.get(project).json()
    back = owner.patch(
        project, json={**_edit(detail), "status": "DRAFT", "version": detail["version"]}
    )
    assert back.status_code == 409
    assert owner.get(project).json()["status"] == "ACTIVE"


def test_a_tested_control_changes_only_when_the_team_says_so(migrated: Database) -> None:
    team = _new_engagement(migrated, "tested-edit")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    control = next(c for c in owner.get(base).json()["controls"] if c["frequency"] != "DAILY")
    assert control["tested"] is False
    _test_sheet(migrated, team, UUID(control["id"]))
    assert _find(owner.get(base).json(), control["id"])["tested"] is True
    # A change that testing does not rest on goes through.
    owner_only = {**_control_fields(control), "owner_name": "New owner"}
    plain = owner.patch(f"{base}/controls/{control['id']}", json=owner_only)
    assert plain.status_code == 200, plain.text
    control = _find(plain.json(), control["id"])
    # A change to its frequency needs the team to say it knows the testing is affected.
    changed = {**_control_fields(control), "frequency": "DAILY"}
    refused = owner.patch(f"{base}/controls/{control['id']}", json=changed)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "control has testing on record"
    assert _find(owner.get(base).json(), control["id"])["frequency"] == control["frequency"]
    accepted = owner.patch(
        f"{base}/controls/{control['id']}", json={**changed, "acknowledge_testing": True}
    )
    assert accepted.status_code == 200, accepted.text
    assert _find(accepted.json(), control["id"])["frequency"] == "DAILY"
    with connect(migrated.url) as connection:
        issues = connection.execute(
            "SELECT topic, kind, status FROM control_context_issues "
            "WHERE engagement_control_id = %s",
            (control["id"],),
        ).fetchall()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'onboarding.control' AND payload ? 'after_testing'",
            (team["project"],),
        ).fetchall()
    assert len(issues) == 1
    topic, kind, status = issues[0]
    assert topic.startswith("Changed after testing: Frequency from ") and topic.endswith("daily")
    assert (kind, status) == ("CONFLICT", "OPEN")
    assert [row[0]["after_testing"] for row in audit] == [["frequency"]]


def _find(body: dict[str, Any], control_id: str) -> dict[str, Any]:
    return next(c for c in body["controls"] if c["id"] == control_id)


def _test_sheet(database: Database, team: dict[str, Any], control_id: UUID) -> None:
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO test_sheets (
                organization_id, project_id, engagement_control_id, method, attributes,
                requested_by
            )
            VALUES (%s, %s, %s, 'TEST_OF_ONE', %s, %s)
            """,
            (team["org"], team["project"], control_id, Json(["Approved"]), team["owner_id"]),
        )
        connection.commit()
