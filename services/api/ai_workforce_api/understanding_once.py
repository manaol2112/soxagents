"""The understanding is asked once; after it, the agents never send the person back
(docs/control-workflow-plan.md, B1j; the product owner, 16 November 2026, on ITGC-CM-06:
"This is so annoying. Keeps going back and forth to the control understanding and
attributes ... This could be a never ending loop so I want you to really address the issue
here."). It supersedes the rule of 4 November 2026 that a later agent question reopens Control
Understanding, and B1e's rule 5 ("a missing or ambiguous fact is always asked") for any
question raised after the understanding is complete.

The question pass. Rewritten for B1k and B1l (16 November 2026). Before, the attribute
agent's first run was the question pass: its ATTRIBUTES stage could ask, and the pass had run
once that stage, begun after the latest value or walkthrough answer, ended with the agent's
answer used (evidence_plans.questions_checked_at, migration 0172; the column stays, unread).
Now the pass is the IT audit specialist's review of the questions asked
(understanding_review): the attribute agent never asks before completion, and the two
question sources never run together.

Complete once (`complete`). The understanding is completed when (understanding_review.
may_complete):
- the control's attributes are accepted (control_context.attributes_accepted): it counts as
  completed with no review, and no review or question is started on it (B1l point 2);
- or nothing in Control Understanding is still to answer (a question left as not known is
  closed), no attribute or narrative run is at work, and the latest read of the specialist
  is READY on its budget: it asked nothing, or the one follow-up read was made (B1l point 3);
- or, without a model, by the rules alone (B1k "Without a model");
- or a person proceeded without a review that could not be used (B1l point 7,
  understanding_review.proceed).
The time is recorded once, as engagement_controls.understanding_completed_at, and never
cleared or moved (migration 0172's guard), with an audit record saying by which rule. A
copied understanding is never copied as completed: the column is never copied, so a control
whose answers were copied from another is reviewed where it lands. It is checked wherever it
can become true: after every save on the control (context_routes.changed), inside the plan
run once the review is read (understanding_review.perform), at the end of a plan run
(run_plan) and of a narrative run (run_narrative), and, since the review of B1k (16 November
2026), in the same step as an acceptance that leaves the attributes accepted
(record_accepted); the controls accepted before that release were completed by migration
0173's backfill.

From then on no agent writes an open question on the control (control_context.raise_issues;
and the database refuses one, migration 0173): a gap is an assumption on the attribute
(attribute_assumptions). A person may still change any answer in Control Understanding; the
agents then follow it, an answer re-tailoring only the attributes its question informs
(understanding_review.informed_update), stating assumptions instead of asking. The Attributes
step no longer waits on the understanding (phase_release.attribute_waits); the D&I release
reads the understanding as before.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from ai_workforce_api.understanding_review import QuestionPass as QuestionPass

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
# A narrative run of the control is queued or at work. SQL over engagement_controls as `c`.
_NARRATIVE_LIVE_SQL = """
    EXISTS (SELECT 1 FROM process_narrative_runs r
            WHERE r.engagement_control_id = c.id
              AND (r.run_status = 'PENDING'
                   OR (r.run_status = 'WORKING'
                       AND (r.run_lease_until IS NULL
                            OR r.run_lease_until >= clock_timestamp()))))
"""
# By which rule the understanding was completed, as the audit record says it.
COMPLETED_BY = ("ATTRIBUTES_ACCEPTED", "REVIEW", "RULES", "PROCEEDED_WITHOUT_REVIEW")


def completed_at(
    executor: psycopg.Cursor[Any] | psycopg.Connection[Any], control_id: UUID
) -> datetime | None:
    row = executor.execute(
        "SELECT understanding_completed_at FROM engagement_controls WHERE id = %s",
        (control_id,),
    ).fetchone()
    return None if row is None else row[0]


def question_pass(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> QuestionPass:
    """What Control Understanding says of the review (understanding_review.pass_state)."""
    from ai_workforce_api.understanding_review import question_pass as read

    return read(connection, project_id, control_id)


def complete(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    reviewing: bool = True,
    in_run: bool = False,
) -> bool:
    """Record that the control's understanding is completed, once, when it is
    (understanding_review.may_complete). `reviewing`: a model and a worker can run the
    specialist's review (False: completed by the rules alone). `in_run`: the caller is the
    plan run that just read the review, whose own lease is no other run at work. True when it
    was recorded now. An archived engagement's control is never written."""
    from ai_workforce_api.understanding_review import may_complete, standing

    state = standing(connection, project_id, control_id, in_run=in_run)
    if not may_complete(state, reviewing):
        return False
    by = (
        "ATTRIBUTES_ACCEPTED"
        if state.accepted
        else "REVIEW"
        if reviewing and state.latest == "READY"
        else "RULES"
    )
    return record_completion(
        connection, project_id, control_id, by, None,
        check_live=not in_run and not state.accepted, narrative_only=in_run,
    )  # fmt: skip


def record_completion(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    by: str,
    person: UUID | None,
    check_live: bool = True,
    narrative_only: bool = False,
) -> bool:
    """Write the completion once, with its audit record: by which rule, and the person for a
    proceed without the review. With `check_live` no attribute or narrative run may be at
    work as it is written (`narrative_only`: no narrative run, the plan run being the
    caller)."""
    from psycopg.types.json import Json

    from ai_workforce_api.db import transaction

    live = (
        f"AND NOT EXISTS (SELECT 1 FROM evidence_plans p WHERE p.engagement_control_id = c.id "
        f"AND {RUN_LIVE_SQL})"
        if check_live
        else f"AND NOT {_NARRATIVE_LIVE_SQL}"
        if narrative_only
        else ""
    )
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE engagement_controls c SET understanding_completed_at = clock_timestamp()
            WHERE c.id = %s AND c.project_id = %s AND c.understanding_completed_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM projects j
                              WHERE j.id = c.project_id AND j.status = 'ARCHIVED')
              {live}
            RETURNING c.organization_id
            """,
            (control_id, project_id),
        ).fetchone()
        if row is None:
            return False
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'control.understanding_completed', 'engagement_control', %s,
                    %s)
            """,
            (row[0], project_id, person, control_id, Json({"by": by})),
        )
    return True


def record_accepted(cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID) -> bool:
    """A person's decision just left the control's attributes accepted: the understanding
    counts as completed (B1l point 2), recorded in the caller's transaction, the same step as
    the acceptance (control_attributes.close_questions_once_accepted, master_plans.
    set_criteria), so no review or question is ever started on the control afterwards, even
    once its acceptance lapses. Decided by the product owner after the review of B1k (16
    November 2026): before, it was recorded only at the next save or run, so a control whose
    acceptance lapsed first could be reviewed. True when it was recorded now."""
    from psycopg.types.json import Json

    row = cursor.execute(
        """
        UPDATE engagement_controls c SET understanding_completed_at = clock_timestamp()
        WHERE c.id = %s AND c.project_id = %s AND c.understanding_completed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM projects j
                          WHERE j.id = c.project_id AND j.status = 'ARCHIVED')
        RETURNING c.organization_id
        """,
        (control_id, project_id),
    ).fetchone()
    if row is None:
        return False
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, 'control.understanding_completed', 'engagement_control', %s, %s)
        """,
        (row[0], project_id, control_id, Json({"by": "ATTRIBUTES_ACCEPTED"})),
    )
    return True


def complete_if_accepted(cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID) -> bool:
    """record_accepted, when the control's attributes are accepted now."""
    from ai_workforce_api.control_context import attributes_accepted

    return attributes_accepted(cursor, control_id) and record_accepted(
        cursor, project_id, control_id
    )


def after_agents(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    requeue: bool = False,
) -> UUID | None:
    """After an agent run on the control ended (a narrative run, in the local worker, with a
    model; a plan run that failed, in the local worker and the durable one): the
    understanding may be complete now, and the review or what the attributes follow may be
    due (B1l point 1: a read that fell due while the run was busy is queued now, never left
    unqueued; one nothing could queue ends FAILED, understanding_review.follow_or_fail).
    `requeue` (a failed plan run) queues a follow-on run, with its own attempts, within the
    chain's bound (evidence_plans.PLAN_RUN_FOLLOWS), so runs that keep failing always end.
    Returns the plan run queued, for the worker to take."""
    from ai_workforce_api.understanding_review import follow_or_fail

    complete(connection, project_id, control_id)
    return follow_or_fail(connection, project_id, control_id, requeue=requeue)
