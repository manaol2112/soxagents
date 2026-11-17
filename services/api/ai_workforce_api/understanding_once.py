"""The understanding is asked once; after it, the agents never send the person back
(docs/control-workflow-plan.md, B1j; the product owner, 16 November 2026, on ITGC-CM-06:
"This is so annoying. Keeps going back and forth to the control understanding and
attributes ... This could be a never ending loop so I want you to really address the issue
here."). It supersedes the rule of 4 November 2026 that a later agent question reopens Control
Understanding, and B1e's rule 5 ("a missing or ambiguous fact is always asked") for any
question raised after the understanding is complete.

One pass. Once the walkthrough's required answers and the statement's values are in, the
attribute agent's first run is the question pass (`pass_due`; evidence_plans.
queue_for_understanding). Its ATTRIBUTES stage may raise questions (`asked_since`); then the
run stops there, before any criteria are tailored or the set is reviewed
(evidence_plans._plan_pass). The pass
has run when an attribute run's ATTRIBUTES stage, begun after the latest value or confirmed
walkthrough answer, ended with the attribute agent's answer used
(evidence_plans.questions_checked_at, migration 0172; `ran`).

Complete once. The understanding is completed (`complete`) when nothing in Control
Understanding is open (phase_release.understanding_waits has no entry for the control), the
question pass has run, and no attribute run or narrative run is queued or at work. The time
is recorded once, as engagement_controls.understanding_completed_at, and never cleared or
moved (the migration's guard). It is checked wherever it can become true: after every save
on the control (context_routes.changed), at the end of an attribute run (run_plan) and at
the end of a narrative run (run_narrative).

From then on no agent writes an open question on the control (control_context.raise_issues):
a gap is an assumption on the attribute (attribute_assumptions). A person may still change
any answer in Control Understanding; the agents then follow it as before (B1d), stating
assumptions instead of asking. The Attributes step no longer waits on the understanding
(phase_release.attribute_waits); the D&I release reads the understanding as before.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg

QuestionPass = Literal["WAITING", "CHECKING", "DONE"]

# When a person last changed what the walkthrough and the statement say: a client value or a
# confirmed walkthrough answer (the question pass must have read both). SQL over
# evidence_plans as `p`.
ANSWERS_CHANGED_SQL = """
    (SELECT max(changed.at) FROM (
         SELECT max(v.updated_at) AS at FROM control_parameters v
         WHERE v.engagement_control_id = p.engagement_control_id
         UNION ALL
         SELECT max(w.updated_at) FROM control_walkthrough_answers w
         WHERE w.engagement_control_id = p.engagement_control_id
           AND w.status = 'CONFIRMED'
     ) AS changed)
"""
# The question pass has read every value and walkthrough answer as they stand. SQL over
# evidence_plans as `p`.
PASS_RAN_SQL = f"""
    (p.questions_checked_at IS NOT NULL
     AND p.questions_checked_at >= coalesce({ANSWERS_CHANGED_SQL}, '-infinity'::timestamptz))
"""
# An attribute run (one with a stage) or a narrative run is queued, or at work under a live
# lease. SQL over evidence_plans as `p`.
RUN_LIVE_SQL = """
    ((p.run_stage <> ''
      AND (p.run_status = 'PENDING'
           OR (p.run_status = 'WORKING' AND p.run_lease_until >= clock_timestamp())))
     OR EXISTS (SELECT 1 FROM process_narrative_runs r
                WHERE r.engagement_control_id = p.engagement_control_id
                  AND (r.run_status = 'PENDING'
                       OR (r.run_status = 'WORKING'
                           AND (r.run_lease_until IS NULL
                                OR r.run_lease_until >= clock_timestamp())))))
"""


def pass_state(completed: bool, answers_waiting: bool, ran: bool, live: bool) -> QuestionPass:
    """What Control Understanding says of the question pass (ContextBody.question_pass):
    DONE once the understanding is completed, or once the pass ran on the answers as they
    stand; WAITING while the required walkthrough answers or values are not in; CHECKING
    while the pass's run is queued or at work. Anything else (no run yet, or one that
    stopped before the agent answered) is WAITING: nothing is checking."""
    if completed:
        return "DONE"
    if answers_waiting:
        return "WAITING"
    if ran:
        return "DONE"
    return "CHECKING" if live else "WAITING"


def may_complete(waits: bool, ran: bool, live: bool, completed: bool) -> bool:
    """Whether the understanding is completed now: not completed yet, nothing open in it,
    the question pass ran, and no attribute or narrative run is queued or at work."""
    return not completed and not waits and ran and not live


def completed_at(
    executor: psycopg.Cursor[Any] | psycopg.Connection[Any], control_id: UUID
) -> datetime | None:
    row = executor.execute(
        "SELECT understanding_completed_at FROM engagement_controls WHERE id = %s",
        (control_id,),
    ).fetchone()
    return None if row is None else row[0]


def _facts(connection: psycopg.Connection[Any], control_id: UUID) -> tuple[bool, bool, bool]:
    """Whether the understanding is completed, the pass ran, and a run is live."""
    row = connection.execute(
        f"""
        SELECT c.understanding_completed_at IS NOT NULL,
               coalesce((SELECT {PASS_RAN_SQL} FROM evidence_plans p
                         WHERE p.engagement_control_id = c.id), false),
               coalesce((SELECT {RUN_LIVE_SQL} FROM evidence_plans p
                         WHERE p.engagement_control_id = c.id), false)
        FROM engagement_controls c WHERE c.id = %s
        """,
        (control_id,),
    ).fetchone()
    if row is None:
        return False, False, False
    return bool(row[0]), bool(row[1]), bool(row[2])


def answers_waiting(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> bool:
    """Whether the statement's client values or the walkthrough's required answers are not
    all in (phase_release.answers_waiting)."""
    from ai_workforce_api.phase_release import answers_waiting as waiting

    return waiting(connection, project_id, control_id)


def question_pass(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> QuestionPass:
    completed, ran, live = _facts(connection, control_id)
    if completed:
        return "DONE"
    return pass_state(False, answers_waiting(connection, project_id, control_id), ran, live)


def pass_due(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> bool:
    """Whether the question pass should run now: the understanding is not completed, the
    values and required walkthrough answers are in, and no pass has read them as they
    stand. (Whether a run may be queued, the caller decides.)"""
    completed, ran, _live = _facts(connection, control_id)
    if completed or ran:
        return False
    return not answers_waiting(connection, project_id, control_id)


def asked_since(connection: psycopg.Connection[Any], control_id: UUID, since: datetime) -> bool:
    """Whether an agent raised a question on the control since `since` that is still open:
    the question pass asked something, so the run stops before the criteria."""
    row = connection.execute(
        "SELECT EXISTS (SELECT 1 FROM control_context_issues WHERE engagement_control_id = %s "
        "AND raised_by = 'AGENT' AND status = 'OPEN' AND created_at >= %s)",
        (control_id, since),
    ).fetchone()
    return bool(row is not None and row[0])


def record_pass(connection: psycopg.Connection[Any], control_id: UUID, began: datetime) -> None:
    """The attribute agent's question pass, begun at `began`, read the understanding and
    answered: what was confirmed before it is checked."""
    from ai_workforce_api.db import transaction

    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE evidence_plans SET questions_checked_at = %s WHERE engagement_control_id = %s "
            "AND (questions_checked_at IS NULL OR questions_checked_at < %s)",
            (began, control_id, began),
        )


def complete(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> bool:
    """Record that the control's understanding is completed, once, when it is (`may_complete`).
    True when it was recorded now. An archived engagement's control is never written."""
    completed, ran, live = _facts(connection, control_id)
    if completed or not ran or live:
        return False
    from ai_workforce_api.db import transaction
    from ai_workforce_api.phase_release import understanding_waits

    if not may_complete(
        control_id in understanding_waits(connection, project_id, control_id), ran, live, completed
    ):
        return False
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE engagement_controls c SET understanding_completed_at = clock_timestamp()
            WHERE c.id = %s AND c.project_id = %s AND c.understanding_completed_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM projects j
                              WHERE j.id = c.project_id AND j.status = 'ARCHIVED')
              AND EXISTS (SELECT 1 FROM evidence_plans p
                          WHERE p.engagement_control_id = c.id AND {PASS_RAN_SQL}
                            AND NOT {RUN_LIVE_SQL})
            RETURNING c.organization_id
            """,
            (control_id, project_id),
        ).fetchone()
        if row is None:
            return False
        from psycopg.types.json import Json

        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, NULL, 'control.understanding_completed', 'engagement_control', %s,
                    %s)
            """,
            (row[0], project_id, control_id, Json({"by": "RULES"})),
        )
    return True


def after_agents(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> UUID | None:
    """After an agent run on the control ended (a narrative run, in the local worker): the
    understanding may be complete now, and what the attributes follow may be due. Returns
    the plan run queued, for the worker to take."""
    from ai_workforce_api.evidence_plans import queue_for_understanding

    complete(connection, project_id, control_id)
    return queue_for_understanding(connection, project_id, control_id)
