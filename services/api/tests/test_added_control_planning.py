"""A control added to a system after launch (decided by the product owner on 28 October
2026, "I already asked that agent should be able to fix this when it's planning"): its copy
keeps what its source's attributes say about testing them, and the planner agent plans it,
as at launch, so a person reviews and approves rather than writing criteria by hand."""

from typing import Any
from uuid import UUID

import psycopg
from support import Database
from test_onboarding import _base
from test_outbound import migrated
from test_scope_changes import _launch

from ai_workforce_api.control_attributes import _write_list
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.onboarding import schedule_started_work
from ai_workforce_api.settings import Settings

__all__ = ["migrated"]

REWORDED = "Each ticketing-system approval time-stamp is earlier than the grant time"


def test_a_control_added_to_a_system_keeps_its_criteria_and_is_planned_by_the_agent(
    migrated: Database,
) -> None:
    owner, org, project = _launch(migrated, "added-planning")
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        family = [
            UUID(str(row[0]))
            for row in cursor.execute(
                "SELECT id FROM engagement_controls WHERE project_id = %s "
                "AND control_ref = 'ITGC-AC-01'",
                (project,),
            ).fetchall()
        ]
        assert family
        # As on the product owner's Active Directory control: the agent reworded an
        # attribute and wrote its criteria, which a person accepted.
        for control_id in family:
            cursor.execute(
                """
                INSERT INTO control_attributes (
                    organization_id, project_id, engagement_control_id, position, text, status,
                    basis, source_kind, condition, pass_criteria, fail_criteria,
                    judgment_required, criteria_origin, decided_at
                )
                SELECT organization_id, project_id, id, 50, %s, 'APPROVED', 'DOCUMENTED',
                       'AGENT', 'Approval time against grant time', 'Approved before granted',
                       'Granted before approval, or no approval', false, 'AGENT',
                       clock_timestamp()
                FROM engagement_controls WHERE id = %s
                """,
                (REWORDED, control_id),
            )
            _write_list(cursor, control_id)
    base = _base(org, project)
    added = owner.post(f"{base}/applications", json={"name": "Workday", "description": ""})
    assert added.status_code == 200, added.text
    workday = next(a for a in added.json()["applications"] if a["name"] == "Workday")
    copy = next(
        c for c in added.json()["controls"]
        if c["application_id"] == workday["id"] and c["control_ref"] == "ITGC-AC-01"
    )  # fmt: skip
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT condition, pass_criteria, fail_criteria, judgment_required, "
            "criteria_origin, criteria_accepted_by FROM control_attributes "
            "WHERE engagement_control_id = %s AND status = 'APPROVED' AND text = %s",
            (UUID(copy["id"]), REWORDED),
        ).fetchone()
        plan = connection.execute(
            "SELECT source, run_status FROM evidence_plans WHERE engagement_control_id = %s",
            (UUID(copy["id"]),),
        ).fetchone()
    # The copy keeps the criteria, not the acceptance: they are reviewed for its system.
    assert row is not None
    assert row[:5] == (
        "Approval time against grant time", "Approved before granted",
        "Granted before approval, or no approval", False, "AGENT",
    )  # fmt: skip
    assert row[5] is None
    # The rules plan it now. Without a model nothing more is queued, so a person can
    # approve it at once.
    assert plan == ("RULES", "IDLE")
    # With a model, once the change commits, the planner agent is handed the plans the
    # rules drew up and it never refined: this copy's among them.
    scheduled: list[list[UUID]] = []

    class Scheduler:
        def schedule_drafts(self, ids: list[UUID]) -> None:
            del ids

        def schedule_plan_runs(self, ids: list[UUID]) -> None:
            scheduled.append(ids)

    live = Settings(database_url=migrated.url, model_provider="anthropic", model_api_key="k")
    schedule_started_work(live, Scheduler(), project)
    with connect(migrated.url) as connection:
        queued = connection.execute(
            "SELECT id, run_status FROM evidence_plans WHERE engagement_control_id = %s",
            (UUID(copy["id"]),),
        ).fetchone()
    assert queued is not None and queued[1] == "PENDING"
    assert scheduled and UUID(str(queued[0])) in scheduled[0]
    # Without a model, the same step queues nothing.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'IDLE' WHERE project_id = %s", (project,)
        )
    scheduled.clear()
    schedule_started_work(Settings(database_url=migrated.url), Scheduler(), project)
    with connect(migrated.url) as connection:
        assert queue_count(connection, project) == 0
    assert scheduled == []


def queue_count(connection: psycopg.Connection[Any], project: UUID) -> int:
    row = connection.execute(
        "SELECT count(*) FROM evidence_plans WHERE project_id = %s AND run_status = 'PENDING'",
        (project,),
    ).fetchone()
    return int(row[0]) if row else 0
