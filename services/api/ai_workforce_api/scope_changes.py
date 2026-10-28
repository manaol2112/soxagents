"""Scope changes after launch.

An engagement's scope keeps moving after kickoff: a system is added or dropped, a
control comes into scope or leaves it. Before launch these are plain setup edits. After
launch each one has consequences in the running work, and this module applies them so
the setup pages and the engagement never disagree:

- A control that is in scope and has no live work gets the same work the kickoff plan
  gives every control: a walkthrough, an evidence request, a test, and an independent
  review, each assigned to its agent in dependency order, with the review feeding the
  engagement report. Its evidence request is drafted by the evidence coordinator in the
  background and, as always, sent only once an approver confirms it.
- A control that leaves scope has its open tasks cancelled and its unsent evidence
  requests cancelled. Work already done (testing, workpapers, sent requests) is kept.

Nothing here runs before launch; the kickoff creates the first round of work.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
from pydantic import BaseModel

from ai_workforce_api.db import transaction
from ai_workforce_api.schedule import KIND_PHASES

logger = logging.getLogger(__name__)

# Task states that still count as open work; the rest are finished or already cancelled.
OPEN_TASKS = ("DRAFT", "READY", "QUEUED", "WAITING", "BLOCKED", "REVIEW")
# Requests that were never sent; a sent request stays with its owner.
UNSENT_REQUESTS = ("DRAFT", "APPROVAL_PENDING")


class ScopeImpact(BaseModel):
    """What taking controls out of scope would do, from the records, before it is done:
    what is cancelled (open tasks, requests never sent) and what is kept (requests with
    their owners, testing, workpapers, reviews, findings)."""

    controls: int
    open_tasks: int
    unsent_requests: int
    sent_requests: int
    tested: int
    workpapers: int
    reviews: int
    deficiencies: int
    # Work is on record that the change keeps, so it needs a reason.
    material: bool


def scope_impact(
    connection: psycopg.Connection[Any], project_id: UUID, control_ids: list[UUID]
) -> ScopeImpact:
    ids = list(dict.fromkeys(control_ids))
    row = connection.execute(
        """
        SELECT
          (SELECT count(*) FROM engagement_controls
           WHERE project_id = %(p)s AND id = ANY(%(ids)s) AND included),
          (SELECT count(*) FROM tasks
           WHERE project_id = %(p)s AND engagement_control_id = ANY(%(ids)s)
             AND status::text = ANY(%(open)s)),
          (SELECT count(*) FROM pbc_requests
           WHERE project_id = %(p)s AND engagement_control_id = ANY(%(ids)s)
             AND status = ANY(%(unsent)s)),
          (SELECT count(*) FROM pbc_requests
           WHERE project_id = %(p)s AND engagement_control_id = ANY(%(ids)s)
             AND NOT status = ANY(%(unsent)s) AND status <> 'CANCELLED'),
          (SELECT count(DISTINCT engagement_control_id) FROM test_sheets
           WHERE project_id = %(p)s AND engagement_control_id = ANY(%(ids)s)),
          (SELECT count(*) FROM workpapers
           WHERE project_id = %(p)s AND engagement_control_id = ANY(%(ids)s)
             AND current_version > 0),
          (SELECT count(*) FROM control_reviews
           WHERE project_id = %(p)s AND engagement_control_id = ANY(%(ids)s)),
          (SELECT count(*) FROM deficiencies
           WHERE project_id = %(p)s AND engagement_control_id = ANY(%(ids)s))
        """,
        {
            "p": project_id,
            "ids": ids,
            "open": list(OPEN_TASKS),
            "unsent": list(UNSENT_REQUESTS),
        },
    ).fetchone()
    assert row is not None
    controls, tasks, unsent, sent, tested, papers, reviews, findings = (int(v) for v in row)
    return ScopeImpact(
        controls=controls,
        open_tasks=tasks,
        unsent_requests=unsent,
        sent_requests=sent,
        tested=tested,
        workpapers=papers,
        reviews=reviews,
        deficiencies=findings,
        material=sent + tested + papers + reviews + findings > 0,
    )


def started(connection: psycopg.Connection[Any], project_id: UUID) -> bool:
    row = connection.execute(
        "SELECT kicked_off_at IS NOT NULL FROM engagement_settings WHERE project_id = %s",
        (project_id,),
    ).fetchone()
    return row is not None and bool(row[0])


def scope_finalized(connection: psycopg.Connection[Any], project_id: UUID) -> bool:
    """Whether a person has reviewed and finalized the engagement's scope (SP6): its work
    starts then. An engagement launched with controls is final from its launch."""
    row = connection.execute(
        "SELECT scope_finalized_at IS NOT NULL FROM engagement_settings WHERE project_id = %s",
        (project_id,),
    ).fetchone()
    return row is not None and bool(row[0])


def reconcile_scope(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
) -> list[UUID]:
    """Bring the running engagement's work in line with its scope. Returns the evidence
    drafts queued for the coordinator, for the caller to schedule once committed. Before
    the scope is finalized (decided by the product owner, SP6), scope changes create no
    work: Review and finalize creates it for everything in scope at once."""
    if not started(connection, project_id) or not scope_finalized(connection, project_id):
        return []
    from ai_workforce_api.evidence_plans import plan_and_issue
    from ai_workforce_api.library_definitions import link_definitions
    from ai_workforce_api.onboarding import (
        _audit,
        _audit_target,
        _controls,
        _instances,
        _settings,
        build_plan,
    )
    from ai_workforce_api.pbc_drafting import queue_kickoff_drafts

    controls = _controls(connection, project_id)
    settings = _settings(connection, project_id)
    live = {
        UUID(str(row[0]))
        for row in connection.execute(
            """
            SELECT DISTINCT engagement_control_id FROM tasks
            WHERE project_id = %s AND engagement_control_id IS NOT NULL
              AND status <> 'CANCELLED'
            """,
            (project_id,),
        ).fetchall()
    }
    joining = [c for c in controls if c.included and c.id not in live]
    leaving = [c for c in controls if not c.included and c.id in live]
    if not joining and not leaving:
        return []
    instances = _instances(connection, organization_id, project_id)
    due_at = datetime.combine(
        datetime.now(UTC).date() + timedelta(days=settings.pbc_due_days),
        datetime.min.time().replace(hour=23, minute=59),
        tzinfo=UTC,
    )
    drafts: list[UUID] = []
    with transaction(connection) as cursor:
        report = cursor.execute(
            """
            SELECT id FROM tasks WHERE project_id = %s AND plan_kind = 'report'
              AND status <> 'CANCELLED' ORDER BY created_at LIMIT 1
            """,
            (project_id,),
        ).fetchone()
        for control in joining:
            items = [
                item for item in build_plan([control]) if item.kind != "report" and item.control_id
            ]
            task_ids: dict[str, UUID] = {}
            for item in items:
                row = cursor.execute(
                    """
                    INSERT INTO tasks (
                        organization_id, project_id, title, description, status, priority,
                        agent_instance_id, deadline, phase_key, plan_kind, engagement_control_id
                    )
                    VALUES (%s, %s, %s, %s, 'READY', 'NORMAL', %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        organization_id,
                        project_id,
                        item.title,
                        item.description,
                        instances.get(item.agent_key),
                        due_at if item.kind == "evidence" else None,
                        KIND_PHASES[item.kind],
                        item.kind,
                        item.control_id,
                    ),
                ).fetchone()
                assert row is not None
                task_ids[item.key] = row[0]
                for predecessor in item.depends_on:
                    cursor.execute(
                        """
                        INSERT INTO task_dependencies (
                            organization_id, project_id, task_id, depends_on_task_id
                        )
                        VALUES (%s, %s, %s, %s)
                        """,
                        (organization_id, project_id, row[0], task_ids[predecessor]),
                    )
                # The report waits for this control's review, as for every other control.
                if item.kind == "review" and report is not None:
                    cursor.execute(
                        """
                        INSERT INTO task_dependencies (
                            organization_id, project_id, task_id, depends_on_task_id
                        )
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (organization_id, project_id, report[0], row[0]),
                    )
                _audit_target(
                    cursor, organization_id, project_id, actor_id, "task.created", "task",
                    row[0], {"status": "READY", "source": "scope_change"},
                )  # fmt: skip
            # As at kickoff: attributes follow their testing definitions, and the evidence
            # is planned by phase.
            link_definitions(cursor, control.id, actor_id)
            created = plan_and_issue(
                cursor, organization_id, project_id, control.id, actor_id, "scope_change"
            )
            drafts.extend(
                queue_kickoff_drafts(
                    cursor,
                    organization_id,
                    project_id,
                    actor_id,
                    [(request_id, control.id) for request_id in created],
                )
            )
            _audit(
                cursor, organization_id, project_id, actor_id, "scope.control_added",
                {"control_id": str(control.id), "tasks": len(task_ids)},
            )  # fmt: skip
        for control in leaving:
            cancelled = cursor.execute(
                """
                UPDATE tasks
                SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
                    cancellation_reason = 'Taken out of scope', version = version + 1,
                    updated_at = clock_timestamp()
                WHERE project_id = %s AND engagement_control_id = %s AND status = ANY(%s)
                RETURNING id
                """,
                (project_id, control.id, list(OPEN_TASKS)),
            ).fetchall()
            withdrawn = cursor.execute(
                """
                UPDATE pbc_requests
                SET status = 'CANCELLED', cancellation_reason = 'Taken out of scope',
                    version = version + 1, updated_at = clock_timestamp()
                WHERE project_id = %s AND engagement_control_id = %s AND status = ANY(%s)
                RETURNING id
                """,
                (project_id, control.id, list(UNSENT_REQUESTS)),
            ).fetchall()
            _audit(
                cursor, organization_id, project_id, actor_id, "scope.control_removed",
                {
                    "control_id": str(control.id),
                    "tasks_cancelled": len(cancelled),
                    "requests_cancelled": len(withdrawn),
                },
            )  # fmt: skip
    return drafts
