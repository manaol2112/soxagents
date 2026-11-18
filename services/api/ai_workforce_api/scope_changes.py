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

The scope is never finalized (the product owner, 17 November 2026: "Remove the requirement
to finalize the scope. Scope keeps changing so it will never be finalized."). This reverses
SP6 (24 October 2026), under which a launched engagement's scope changes created no work
until a person pressed Review and finalize. Now a control's work starts as soon as it is in
scope on a running engagement, and the engagement's report task is created with the first
control's work when the engagement launched without controls. Engagements whose scope was
selected under SP6 and never finalized catch up when the worker starts
(start_waiting_scope).
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from uuid import UUID

import psycopg
from pydantic import BaseModel

from ai_workforce_api.db import transaction
from ai_workforce_api.schedule import KIND_PHASES

if TYPE_CHECKING:
    from ai_workforce_api.onboarding import ControlBody

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


def _controls_of(connection: psycopg.Connection[Any], project_id: UUID) -> list[ControlBody]:
    from ai_workforce_api.onboarding import _controls

    return list(_controls(connection, project_id))


def _live_controls(connection: psycopg.Connection[Any], project_id: UUID) -> set[UUID]:
    """The engagement's controls with work that is not cancelled."""
    return {
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


def reconcile_scope(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    source: str = "scope_change",
) -> list[UUID]:
    """Bring the running engagement's work in line with its scope. Returns the evidence
    drafts queued for the coordinator, for the caller to schedule once committed.

    Rewritten 17 November 2026 (the product owner: "Remove the requirement to finalize the
    scope"). Old: before a person finalized the scope (SP6), scope changes created no work.
    New: every scope change of a running engagement is reconciled at once, and the report
    task is created with the first control's work when the engagement launched without
    controls. Idempotent: a control that already has live work gets none again, and the
    engagement's settings row is locked first, so two changes at once cannot both create
    the same control's work."""
    if not started(connection, project_id):
        return []
    # Cheap check first: most changes leave the work as it is.
    controls = _controls_of(connection, project_id)
    live = _live_controls(connection, project_id)
    if not any(
        (c.included and c.id not in live) or (not c.included and c.id in live) for c in controls
    ):
        return []
    from ai_workforce_api.evidence_plans import plan_and_issue
    from ai_workforce_api.library_definitions import link_definitions
    from ai_workforce_api.onboarding import (
        _audit,
        _audit_target,
        _instances,
        _settings,
        build_plan,
    )
    from ai_workforce_api.pbc_drafting import queue_kickoff_drafts

    settings = _settings(connection, project_id)
    instances = _instances(connection, organization_id, project_id)
    due_at = datetime.combine(
        datetime.now(UTC).date() + timedelta(days=settings.pbc_due_days),
        datetime.min.time().replace(hour=23, minute=59),
        tzinfo=UTC,
    )
    drafts: list[UUID] = []
    with transaction(connection) as cursor:
        # One reconciliation at a time per engagement; the work is read again under the lock.
        cursor.execute(
            "SELECT 1 FROM engagement_settings WHERE project_id = %s FOR UPDATE", (project_id,)
        )
        controls = _controls_of(connection, project_id)
        live = _live_controls(connection, project_id)
        joining = [c for c in controls if c.included and c.id not in live]
        leaving = [c for c in controls if not c.included and c.id in live]
        if not joining and not leaving:
            return []
        report = cursor.execute(
            """
            SELECT id FROM tasks WHERE project_id = %s AND plan_kind = 'report'
              AND status <> 'CANCELLED' ORDER BY created_at LIMIT 1
            """,
            (project_id,),
        ).fetchone()
        if report is None and joining:
            # Launched with no controls, the engagement has no report task yet: it is created
            # with the first control's work, and waits for every review already open.
            report = cursor.execute(
                """
                INSERT INTO tasks (
                    organization_id, project_id, title, description, status, priority,
                    agent_instance_id, phase_key, plan_kind
                )
                VALUES (%s, %s, %s, %s, 'READY', 'NORMAL', %s, %s, 'report')
                RETURNING id
                """,
                (organization_id, project_id, "Draft findings and the engagement report",
                 "Summarize exceptions and deficiencies from reviewed work only.",
                 instances.get("reporting-analyst"), KIND_PHASES["report"]),
            ).fetchone()  # fmt: skip
            assert report is not None
            cursor.execute(
                """
                INSERT INTO task_dependencies (
                    organization_id, project_id, task_id, depends_on_task_id
                )
                SELECT %s, %s, %s, id FROM tasks
                WHERE project_id = %s AND plan_kind = 'review' AND status <> 'CANCELLED'
                ON CONFLICT DO NOTHING
                """,
                (organization_id, project_id, report[0], project_id),
            )
            _audit_target(
                cursor, organization_id, project_id, actor_id, "task.created", "task",
                report[0], {"status": "READY", "source": source},
            )  # fmt: skip
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
                    row[0], {"status": "READY", "source": source},
                )  # fmt: skip
            # As at kickoff: attributes follow their testing definitions, and the evidence
            # is planned by phase.
            link_definitions(cursor, control.id, actor_id)
            # The rules plan it now; once the change commits, the planner agent refines the
            # plan when a model is configured (onboarding.schedule_started_work).
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


# How many engagements one worker start catches up at most; the rest follow at the next.
CATCH_UP_LIMIT = 50


def start_waiting_scope(
    connection: psycopg.Connection[Any], refine: bool = False, limit: int = CATCH_UP_LIMIT
) -> list[UUID]:
    """At the worker's start: a running engagement with controls in scope and no work for
    them gets their work now (the product owner, 17 November 2026: the scope is never
    finalized). Under SP6 (24 October to 17 November 2026) controls selected after launch
    waited, with no work, for a person to finalize the scope; an engagement never finalized
    still holds them. Each is reconciled as for any scope change, recorded as made by the
    person who launched the engagement (who authorized its work), with the source
    `scope_catch_up`. With `refine` (a model is configured), the planner agent is queued on
    the plans the rules drew up, as after a scope change (onboarding.schedule_started_work).
    Idempotent: a control with live work is left alone, so a second start creates nothing.
    Returns the engagements whose work was started; the caller schedules the drafts and plan
    runs they queued (they are open drafts and open plan runs, read after this)."""
    try:
        rows = _waiting(connection, limit)
        connection.commit()
    except psycopg.Error:
        connection.rollback()
        logger.warning("engagements waiting for their scope work could not be read")
        return []
    started_now: list[UUID] = []
    for organization_id, project_id, actor_id in rows:
        try:
            reconcile_scope(
                connection, organization_id, project_id, actor_id, source="scope_catch_up"
            )
            connection.commit()
        except Exception:  # noqa: BLE001 - one engagement's failure leaves the others
            connection.rollback()
            logger.warning("an engagement's scope work could not be started at the worker start")
            continue
        if refine:
            from ai_workforce_api.evidence_plans import queue_unrefined_plans

            try:
                queue_unrefined_plans(connection, project_id)
                connection.commit()
            except psycopg.Error:
                connection.rollback()
        started_now.append(UUID(str(project_id)))
    return started_now


def _waiting(connection: psycopg.Connection[Any], limit: int) -> list[tuple[Any, ...]]:
    """Running engagements with a control in scope and no live work for it, oldest first."""
    return connection.execute(
        """
        SELECT s.organization_id, s.project_id, s.kicked_off_by
        FROM engagement_settings s
        JOIN projects j ON j.id = s.project_id
        WHERE s.kicked_off_at IS NOT NULL AND s.kicked_off_by IS NOT NULL
          AND j.status = 'ACTIVE' AND j.deleted_at IS NULL
          AND EXISTS (
              SELECT 1 FROM engagement_controls c
              WHERE c.project_id = s.project_id AND c.included
                AND NOT EXISTS (
                    SELECT 1 FROM tasks t
                    WHERE t.engagement_control_id = c.id AND t.status <> 'CANCELLED'))
        ORDER BY s.kicked_off_at
        LIMIT %s
        """,
        (limit,),
    ).fetchall()
