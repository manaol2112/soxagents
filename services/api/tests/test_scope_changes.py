"""Scope changes after launch: a control that joins gets its work, one that leaves has
its open work cancelled, and a system that leaves takes its controls with it."""

from typing import Any
from uuid import UUID

from support import Database, approve_control_plan
from test_onboarding import _base, _complete_setup, _new_engagement
from test_outbound import migrated

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _launch(migrated: Database, slug: str) -> tuple[Any, UUID, UUID]:
    team = _new_engagement(migrated, slug)
    owner, org, project = team["owner"], team["org"], team["project"]
    _complete_setup(owner, team)
    preview = owner.get(_base(org, project)).json()["plan_preview"]
    started = owner.post(
        f"{_base(org, project)}/plan/launch", json={"fingerprint": preview["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    return owner, org, project


def _work(database: Database, project: UUID, control_id: str) -> dict[str, Any]:
    with connect(database.url) as connection:
        tasks = connection.execute(
            "SELECT plan_kind, status FROM tasks WHERE project_id = %s "
            "AND engagement_control_id = %s ORDER BY plan_kind",
            (project, control_id),
        ).fetchall()
        requests = connection.execute(
            "SELECT status FROM pbc_requests WHERE project_id = %s "
            "AND engagement_control_id = %s ORDER BY created_at",
            (project, control_id),
        ).fetchall()
        drafts = connection.execute(
            "SELECT count(*) FROM pbc_drafts WHERE project_id = %s AND engagement_control_id = %s",
            (project, control_id),
        ).fetchone()
        report_waits = connection.execute(
            """
            SELECT count(*) FROM task_dependencies d
            JOIN tasks r ON r.id = d.task_id AND r.plan_kind = 'report'
            JOIN tasks t ON t.id = d.depends_on_task_id
            WHERE d.project_id = %s AND t.engagement_control_id = %s
            """,
            (project, control_id),
        ).fetchone()
    return {
        "tasks": [(str(kind), str(status)) for kind, status in tasks],
        "requests": [str(status) for (status,) in requests],
        "drafts": int(drafts[0]) if drafts else 0,
        "report_waits": int(report_waits[0]) if report_waits else 0,
    }


def test_a_control_added_after_launch_gets_its_work(migrated: Database) -> None:
    owner, org, project = _launch(migrated, "scope-add")
    base = _base(org, project)
    body = owner.get(base).json()
    assert body["started"] is True
    # Setup stays locked for the scope narrative, but the controls can still change.
    assert owner.patch(f"{base}/scope", json={"scope": "x", "period_end": None}).status_code == 409
    # A control the team writes, with no evidence items named: its request still asks
    # for evidence, from the test attributes.
    added = owner.post(
        f"{base}/controls/new",
        json={
            "control_ref": "REV-77",
            "title": "Credit notes are approved",
            "activity": "The finance manager approves every credit note.",
            "domain": "ORDER_TO_CASH",
            "frequency": "WEEKLY",
            "nature": "MANUAL",
            "test_attributes": ["Approval is by the finance manager"],
            "pbc_items": [],
        },
    )
    assert added.status_code == 200, added.text
    control = next(c for c in added.json()["controls"] if c["control_ref"] == "REV-77")
    work = _work(migrated, project, control["id"])
    assert work["tasks"] == [
        ("evidence", "READY"),
        ("review", "READY"),
        ("test", "READY"),
        ("walkthrough", "READY"),
    ]
    # Its evidence is planned by phase and waits for a person. Approving the plan
    # requests the design and the interim evidence, and drafts both.
    assert work["requests"] == []
    released = approve_control_plan(migrated, control["id"])
    assert len(released) == 2
    work = _work(migrated, project, control["id"])
    assert work["requests"] == ["DRAFT", "DRAFT"]
    assert work["drafts"] == 2
    assert work["report_waits"] == 1
    # Taking it out of scope cancels the open work and the unsent requests.
    out = owner.post(f"{base}/controls/{control['id']}/scope", json={"included": False})
    assert out.status_code == 200, out.text
    work = _work(migrated, project, control["id"])
    assert {status for _kind, status in work["tasks"]} == {"CANCELLED"}
    assert work["requests"] == ["CANCELLED", "CANCELLED"]
    # Back in scope, it gets fresh work; the cancelled work stays on record, and its plan
    # is requested again rather than duplicated.
    back = owner.post(f"{base}/controls/{control['id']}/scope", json={"included": True})
    assert back.status_code == 200, back.text
    work = _work(migrated, project, control["id"])
    assert sorted(status for _kind, status in work["tasks"]) == ["CANCELLED"] * 4 + ["READY"] * 4
    assert work["requests"] == ["CANCELLED", "CANCELLED", "DRAFT", "DRAFT"]
    with connect(migrated.url) as connection:
        plans = connection.execute(
            "SELECT count(*) FROM evidence_plans WHERE engagement_control_id = %s",
            (control["id"],),
        ).fetchone()
        live = connection.execute(
            """
            SELECT count(*) FROM evidence_requirements q
            JOIN pbc_requests r ON r.id = q.pbc_request_id
            WHERE q.engagement_control_id = %s AND r.status = 'CANCELLED'
            """,
            (control["id"],),
        ).fetchone()
    assert plans == (1,)
    assert live == (0,)


def test_a_system_added_or_dropped_after_launch_moves_its_controls(migrated: Database) -> None:
    owner, org, project = _launch(migrated, "scope-system")
    base = _base(org, project)
    before = owner.get(base).json()
    tasks_before = _count_tasks(migrated, project)
    # A new system brings an instance of every system-bound control, each with its work.
    added = owner.post(f"{base}/applications", json={"name": "Workday", "description": ""})
    assert added.status_code == 200, added.text
    workday = next(a for a in added.json()["applications"] if a["name"] == "Workday")
    instances = [
        c
        for c in added.json()["controls"]
        if c["application_id"] == workday["id"] and c["included"]
    ]
    assert instances
    assert _count_tasks(migrated, project) == tasks_before + 4 * len(instances)
    # Dropping a system after launch keeps it on record and takes its controls out of scope.
    dropped = owner.post(f"{base}/applications/{workday['id']}/remove")
    assert dropped.status_code == 200, dropped.text
    assert any(a["id"] == workday["id"] for a in dropped.json()["applications"])
    assert all(
        not c["included"]
        for c in dropped.json()["controls"]
        if c["application_id"] == workday["id"]
    )
    for control in instances:
        assert {status for _kind, status in _work(migrated, project, control["id"])["tasks"]} == {
            "CANCELLED"
        }
    assert len(before["applications"]) + 1 == len(dropped.json()["applications"])


def _count_tasks(database: Database, project: UUID) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s AND status <> 'CANCELLED'",
            (project,),
        ).fetchone()
    return int(row[0]) if row else 0
