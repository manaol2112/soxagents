"""Roll-forward and remediation retests (Milestone 8.4).

Interim testing is a control's first round. Two more kinds follow once its results are
known:

- **Roll-forward.** Interim testing signed off effective covers the population up to the
  last instance it saw. A roll-forward round covers the rest of the period: the owner is
  asked to confirm nothing changed and for the population from then to period end, and
  the tester tests an update sample sized for that remaining period (a control tested
  once is tested once again, from current evidence).
- **Retest.** A deficiency marked ready for retest names the date the fix took effect. A
  retest round samples only from after that date, once the control has operated long
  enough to test, sized by the remediation table. Signing it off decides the deficiency:
  effective marks it remediated, not effective sends it back to remediation.

A logged deficiency on a control also drafts a remediation request to the owner for the
plan and, later, evidence of the fix. Every request is drafted only; it waits for the
usual approval before anything is sent.

Each round owns its request, its task, its test plan, and its test sheet. A file filed
against a round's request (or its sample request) is tested on the round's sheet; other
files of the control stay with interim testing.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel

from ai_workforce_api.authorization import (
    Action,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.schedule import interim_cutoff
from ai_workforce_api.settings import Settings

RoundKind = Literal["ROLLFORWARD", "RETEST"]

# Roll-forward: an update sample for the months left after interim testing.
ROLLFORWARD_SIZES = {
    "ANNUAL": 1,
    "QUARTERLY": 1,
    "MONTHLY": 1,
    "WEEKLY": 2,
    "DAILY": 5,
    "RECURRING": 10,
    "EVENT_DRIVEN": 10,
}

# Remediation retest: the sample size, and how many days the fixed control must have
# operated before it can be tested (two quarters, two months, five weeks, 20 days...).
RETEST_RULES: dict[str, tuple[int, int]] = {
    "ANNUAL": (1, 0),
    "QUARTERLY": (2, 180),
    "MONTHLY": (2, 60),
    "WEEKLY": (5, 35),
    "DAILY": (20, 28),
    "RECURRING": (25, 20),
    "EVENT_DRIVEN": (25, 30),
}

OPEN = ("REQUESTED", "TESTING")
# The testing phase each kind of round request serves.
_PHASE_OF_SOURCE = {
    "rollforward": "ROLLFORWARD",
    "retest": "RETEST",
    "remediation": "REMEDIATION",
}


@dataclass(frozen=True)
class RoundRef:
    id: UUID
    kind: str
    number: int
    control_id: UUID
    method: str
    window_start: date
    window_end: date
    test_from: date
    sample_size: int
    deficiency_id: UUID | None


class RoundBody(BaseModel):
    id: UUID
    control_id: UUID
    control_ref: str
    kind: RoundKind
    number: int
    status: str
    method: str
    window_start: date
    window_end: date
    test_from: date
    sample_size: int
    deficiency_id: UUID | None
    deficiency_reference: str | None
    request_id: UUID | None
    request_status: str | None
    task_id: UUID | None
    test_id: UUID | None
    sheet_id: UUID | None
    conclusion: str | None
    cancel_reason: str
    created_at: datetime
    application_name: str = ""
    # The round's own independent review (workflow integrity W2): OPEN, SIGNED_OFF, or
    # None while it has not opened (the round is not signed off, or predates W2).
    review_status: str | None = None
    # Whether the round may be sampled and tested now, and what holds it
    # (round_readiness.py, W4).
    readiness_state: str | None = None
    readiness_blockers: list[str] = []


def rollforward_size(frequency: str, nature: str) -> tuple[str, int]:
    if nature == "AUTOMATED":
        return "TEST_OF_ONE", 1
    return "SAMPLE", ROLLFORWARD_SIZES.get(frequency, 10)


def retest_rule(frequency: str, nature: str) -> tuple[str, int, int]:
    """Method, sample size, and minimum days of operation before the retest."""
    if nature == "AUTOMATED":
        return "TEST_OF_ONE", 1, 0
    size, days = RETEST_RULES.get(frequency, (25, 30))
    return "SAMPLE", size, days


def _control(cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID) -> tuple[Any, ...]:
    row = cursor.execute(
        """
        SELECT c.control_ref, c.title, c.frequency, c.nature, c.agent_key, c.owner_email,
               c.pbc_items, s.period_end, s.client_coordinator_email, s.pbc_due_days,
               s.pbc_follow_up_days, s.pbc_max_follow_ups
        FROM engagement_controls c JOIN engagement_settings s ON s.project_id = c.project_id
        WHERE c.id = %s AND c.project_id = %s AND c.included
        """,
        (control_id, project_id),
    ).fetchone()
    if row is None:
        raise ValueError("control is not in scope")
    return tuple(row)


def _due(days: int, not_before: date) -> datetime:
    start = max(datetime.now(UTC).date(), not_before)
    return datetime.combine(
        start + timedelta(days=days),
        datetime.min.time().replace(hour=23, minute=59),
        tzinfo=UTC,
    )


def _draft_request(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    control: tuple[Any, ...],
    operation_key: str,
    text: str,
    due_at: datetime,
    requester: UUID,
    source: str,
) -> UUID | None:
    """A request to the control's owner, as a draft that needs the usual approval."""
    from ai_workforce_api.onboarding import pbc_reference

    recipient = str(control[5]) if "@" in str(control[5]) else str(control[8])
    if "@" not in recipient:
        return None
    row = cursor.execute(
        """
        INSERT INTO pbc_requests (
            organization_id, project_id, operation_key, control_ref, owner_user_id,
            recipient, due_at, evidence_description, follow_up_after_days, max_follow_ups,
            engagement_control_id, testing_phase, drafted_by
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'AGENT')
        ON CONFLICT (project_id, operation_key) DO NOTHING
        RETURNING id
        """,
        (
            organization_id,
            project_id,
            operation_key,
            pbc_reference(str(control[0])),
            requester,
            recipient,
            due_at,
            text[:4000],
            int(control[10]),
            int(control[11]),
            control_id,
            _PHASE_OF_SOURCE[source],
        ),
    ).fetchone()
    if row is None:
        return None
    _audit(
        cursor, organization_id, project_id, requester, "pbc.updated", "pbc_request", row[0],
        {"status": "DRAFT", "source": source},
    )  # fmt: skip
    return UUID(str(row[0]))


def _task(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    agent_key: str,
    title: str,
    description: str,
    phase: str,
    kind: str,
    requester: UUID,
) -> UUID:
    from ai_workforce_api.onboarding import _instances

    instance = _instances(cursor.connection, organization_id, project_id).get(agent_key)
    deadline = cursor.execute(
        "SELECT planned_end FROM engagement_phases WHERE project_id = %s AND phase_key = %s",
        (project_id, phase),
    ).fetchone()
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
            title[:200],
            description[:4000],
            instance,
            None
            if deadline is None
            else datetime.combine(
                deadline[0], datetime.min.time().replace(hour=23, minute=59), tzinfo=UTC
            ),
            phase,
            kind,
            control_id,
        ),
    ).fetchone()
    assert row is not None
    _audit(
        cursor, organization_id, project_id, requester, "task.created", "task", row[0],
        {"status": "READY", "source": kind},
    )  # fmt: skip
    return UUID(str(row[0]))


def _insert_round(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    kind: RoundKind,
    method: str,
    window: tuple[date, date],
    test_from: date,
    size: int,
    deficiency_id: UUID | None,
    requester: UUID,
) -> tuple[UUID, int] | None:
    number = cursor.execute(
        "SELECT coalesce(max(number), 0) + 1 FROM test_rounds "
        "WHERE project_id = %s AND engagement_control_id = %s AND kind = %s",
        (project_id, control_id, kind),
    ).fetchone()
    row = cursor.execute(
        """
        INSERT INTO test_rounds (
            organization_id, project_id, engagement_control_id, kind, number, method,
            window_start, window_end, test_from, sample_size, deficiency_id, requested_by
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        RETURNING id, number
        """,
        (
            organization_id,
            project_id,
            control_id,
            kind,
            int(number[0]) if number else 1,
            method,
            window[0],
            window[1],
            test_from,
            size,
            deficiency_id,
            requester,
        ),
    ).fetchone()
    return None if row is None else (UUID(str(row[0])), int(row[1]))


# Roll-forward


def rollforward_window(
    cursor: psycopg.Cursor[Any], sheet_id: UUID, period_end: date | None
) -> tuple[date, date] | None:
    """The days interim testing did not cover, or None when it covered the period."""
    if period_end is None:
        return None
    row = cursor.execute(
        """
        SELECT s.method, s.signed_at, t.covered_to
        FROM test_sheets s LEFT JOIN control_tests t ON t.id = s.control_test_id
        WHERE s.id = %s
        """,
        (sheet_id,),
    ).fetchone()
    if row is None:
        return None
    signed = row[1].date() if row[1] is not None else datetime.now(UTC).date()
    if row[2] is not None:
        covered: date = row[2]
    elif row[0] == "TEST_OF_ONE":
        covered = signed
    else:
        # A plan from before populations recorded their dates: the interim date.
        covered = min(interim_cutoff(period_end), signed)
    start = covered + timedelta(days=1)
    if start > period_end:
        return None
    return start, period_end


def start_rollforward(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    sheet_id: UUID,
    control_id: UUID,
    requester: UUID,
) -> UUID | None:
    """Interim testing was signed off effective: plan the rest of the period."""
    control = _control(cursor, project_id, control_id)
    window = rollforward_window(cursor, sheet_id, control[7])
    if window is None:
        return None
    method, size = rollforward_size(str(control[2]), str(control[3]))
    created = _insert_round(
        cursor, organization_id, project_id, control_id, "ROLLFORWARD", method, window,
        window[0], size, None, requester,
    )  # fmt: skip
    if created is None:
        return None
    round_id, number = created
    start, end = (item.isoformat() for item in window)
    items = [str(item) for item in control[6]]
    population = items[0] if items else "the population of instances of the control"
    if method == "TEST_OF_ONE":
        ask = (
            f"current evidence of the configuration (a screenshot or export dated as near "
            f"to {end} as you can), so we can confirm it is unchanged"
        )
    else:
        ask = f"{population.rstrip('.').lower()} from {start} to {end}"
    text = "\n".join(
        [
            f"Roll-forward for {control[0]}: {control[1]}",
            "",
            f"Our interim testing covered the control up to {window[0] - timedelta(days=1)}. "
            f"To cover the rest of the period, please:",
            f"1. Confirm whether the control, who performs it, or the systems it relies on "
            f"changed between {start} and {end}, and describe any change.",
            f"2. Provide {ask}.",
            "",
            "Thank you.",
        ]
    )
    request_id = _draft_request(
        cursor, organization_id, project_id, control_id, control,
        f"rollforward-{round_id.hex}", text, _due(int(control[9]), window[1]), requester,
        "rollforward",
    )  # fmt: skip
    task_id = _task(
        cursor, organization_id, project_id, control_id, str(control[4]),
        f"Roll-forward {control[0]} to period end",
        f"Confirm nothing changed from {start} to {end} and test an update sample of "
        f"{size}.",
        "ROLLFORWARD", "rollforward", requester,
    )  # fmt: skip
    cursor.execute(
        "UPDATE test_rounds SET request_id = %s, task_id = %s WHERE id = %s",
        (request_id, task_id, round_id),
    )
    # The evidence plan's roll-forward phase now applies, for this round's window: its
    # requirements go out on the round's request, in place of the text above.
    from ai_workforce_api.evidence_plans import on_rollforward_started

    on_rollforward_started(cursor, organization_id, project_id, control_id, request_id, requester)
    _audit(
        cursor, organization_id, project_id, requester, "testing.round_started", "test_round",
        round_id, {"kind": "ROLLFORWARD", "number": number, "window": [start, end],
                   "sample_size": size},
    )  # fmt: skip
    return round_id


# Remediation and retest


def draft_remediation_request(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    deficiency_id: UUID,
    requester: UUID,
) -> UUID | None:
    """A logged deficiency on a control: ask its owner for the plan and the fix."""
    row = cursor.execute(
        """
        SELECT reference, title, condition, engagement_control_id, remediation_request_id
        FROM deficiencies WHERE id = %s AND project_id = %s
        """,
        (deficiency_id, project_id),
    ).fetchone()
    if row is None or row[3] is None or row[4] is not None:
        return None
    try:
        control = _control(cursor, project_id, row[3])
    except ValueError:
        return None
    condition = clean_line(str(row[2]), 600)
    text = "\n".join(
        [
            f"Remediation of {row[0]} on {control[0]}: {clean_line(str(row[1]), 200)}",
            "",
            *([f"What we found: {condition}", ""] if condition else []),
            "Please send:",
            "1. Your remediation plan: what will change, who owns it, and the date you "
            "expect the fix to be in place.",
            "2. Once it is in place: evidence of the change (for example the updated "
            "configuration, policy, or procedure) and the date it took effect.",
            "",
            "Once the fixed control has operated for a while, we will test it again. Thank you.",
        ]
    )
    request_id = _draft_request(
        cursor, organization_id, project_id, row[3], control,
        f"remediation-{deficiency_id.hex}", text, _due(int(control[9]), date.min),
        requester, "remediation",
    )  # fmt: skip
    if request_id is None:
        return None
    _task(
        cursor, organization_id, project_id, row[3], "evidence-coordinator",
        f"Follow up the remediation of {row[0]}",
        f"Collect the remediation plan and evidence of the fix for {control[0]}.",
        "REMEDIATION", "remediation", requester,
    )  # fmt: skip
    cursor.execute(
        "UPDATE deficiencies SET remediation_request_id = %s WHERE id = %s",
        (request_id, deficiency_id),
    )
    return request_id


def start_retest(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    deficiency_id: UUID,
    remediated_on: date,
    requester: UUID,
) -> UUID | None:
    """A deficiency is ready for retest: sample from after the fix, once it has run."""
    row = cursor.execute(
        "SELECT reference, engagement_control_id FROM deficiencies WHERE id = %s",
        (deficiency_id,),
    ).fetchone()
    if row is None or row[1] is None:
        return None
    control = _control(cursor, project_id, row[1])
    method, size, days = retest_rule(str(control[2]), str(control[3]))
    test_from = remediated_on + timedelta(days=days)
    period_end: date | None = control[7]
    window_end = max(test_from, period_end) if period_end is not None else test_from
    created = _insert_round(
        cursor, organization_id, project_id, row[1], "RETEST", method,
        (remediated_on, window_end), test_from, size, deficiency_id, requester,
    )  # fmt: skip
    if created is None:
        return None
    round_id, number = created
    items = [str(item) for item in control[6]]
    population = items[0] if items else "the population of instances of the control"
    ask = (
        "current evidence of the configuration, dated after the fix"
        if method == "TEST_OF_ONE"
        else f"{population.rstrip('.').lower()} from {remediated_on} to the date you send it"
    )
    text = "\n".join(
        [
            f"Remediation retest for {control[0]} ({row[0]}): {control[1]}",
            "",
            f"The fix took effect on {remediated_on}. "
            + (
                f"Once the control has operated until {test_from}, please provide:"
                if days
                else "Please provide:"
            ),
            f"1. {ask[0].upper()}{ask[1:]}.",
            "2. A short note of what changed, if anything, since the remediation plan.",
            "",
            "Thank you.",
        ]
    )
    request_id = _draft_request(
        cursor, organization_id, project_id, row[1], control,
        f"retest-{round_id.hex}", text, _due(int(control[9]), test_from), requester, "retest",
    )  # fmt: skip
    task_id = _task(
        cursor, organization_id, project_id, row[1], str(control[4]),
        f"Retest {control[0]} after remediation of {row[0]}",
        f"Test {size} instance{'s' if size != 1 else ''} from after {remediated_on}, "
        f"from {test_from}.",
        "REMEDIATION", "retest", requester,
    )  # fmt: skip
    cursor.execute(
        "UPDATE test_rounds SET request_id = %s, task_id = %s WHERE id = %s",
        (request_id, task_id, round_id),
    )
    _audit(
        cursor, organization_id, project_id, requester, "testing.round_started", "test_round",
        round_id, {"kind": "RETEST", "number": number, "deficiency": str(row[0]),
                   "test_from": test_from.isoformat(), "sample_size": size},
    )  # fmt: skip
    return round_id


def cancel_retest(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    deficiency_id: UUID,
    requester: UUID,
    reason: str,
) -> None:
    """The deficiency went back to remediation before its retest was tested."""
    rows = cursor.execute(
        """
        UPDATE test_rounds SET status = 'CANCELLED', cancel_reason = %s, version = version + 1
        WHERE deficiency_id = %s AND status IN ('REQUESTED', 'TESTING')
        RETURNING id, request_id, task_id
        """,
        (reason[:500], deficiency_id),
    ).fetchall()
    for round_id, request_id, task_id in rows:
        _cancel_parts(cursor, request_id, task_id)
        _audit(
            cursor, organization_id, project_id, requester, "testing.round_cancelled",
            "test_round", round_id, {"reason": reason[:200]},
        )  # fmt: skip


def cancel_unstarted_rollforward(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requester: UUID,
) -> None:
    """Interim testing was reopened: a roll-forward with no sheet yet is withdrawn."""
    rows = cursor.execute(
        """
        UPDATE test_rounds SET status = 'CANCELLED',
               cancel_reason = 'Interim testing was reopened.', version = version + 1
        WHERE project_id = %s AND engagement_control_id = %s AND kind = 'ROLLFORWARD'
          AND status = 'REQUESTED'
          AND NOT EXISTS (SELECT 1 FROM test_sheets s WHERE s.test_round_id = test_rounds.id)
        RETURNING id, request_id, task_id
        """,
        (project_id, control_id),
    ).fetchall()
    for round_id, request_id, task_id in rows:
        _cancel_parts(cursor, request_id, task_id)
        _audit(
            cursor, organization_id, project_id, requester, "testing.round_cancelled",
            "test_round", round_id, {"reason": "interim reopened"},
        )  # fmt: skip


def _cancel_parts(cursor: psycopg.Cursor[Any], request_id: Any, task_id: Any) -> None:
    """A cancelled round's draft request and open task are withdrawn with it."""
    if request_id is not None:
        cursor.execute(
            "UPDATE pbc_requests SET status = 'CANCELLED', "
            "cancellation_reason = 'The testing round it was for was cancelled.', "
            "version = version + 1, updated_at = clock_timestamp() "
            "WHERE id = %s AND status = 'DRAFT'",
            (request_id,),
        )
    if task_id is not None:
        cursor.execute(
            "UPDATE tasks SET status = 'CANCELLED', cancelled_at = clock_timestamp(), "
            "version = version + 1 "
            "WHERE id = %s AND status NOT IN ('SUCCEEDED', 'CANCELLED')",
            (task_id,),
        )


# A round's evidence and sheets


def round_of(connection: Any, round_id: UUID) -> RoundRef | None:
    row = connection.execute(
        """
        SELECT id, kind, number, engagement_control_id, method, window_start, window_end,
               test_from, sample_size, deficiency_id
        FROM test_rounds WHERE id = %s
        """,
        (round_id,),
    ).fetchone()
    return None if row is None else RoundRef(*row)


def round_for_request(connection: Any, request_id: UUID | None) -> RoundRef | None:
    """The open round a request belongs to: its own request, or its sample request."""
    if request_id is None:
        return None
    row = connection.execute(
        """
        SELECT r.id FROM test_rounds r
        LEFT JOIN control_tests t ON t.test_round_id = r.id
        WHERE r.status IN ('REQUESTED', 'TESTING')
          AND (r.request_id = %s OR t.sample_request_id = %s)
        LIMIT 1
        """,
        (request_id, request_id),
    ).fetchone()
    return None if row is None else round_of(connection, UUID(str(row[0])))


def followup_requests(connection: Any, project_id: UUID, control_id: UUID) -> set[UUID]:
    """Requests that are not interim evidence: rounds, their samples, and remediation."""
    rows = connection.execute(
        """
        SELECT r.request_id FROM test_rounds r
        WHERE r.project_id = %s AND r.engagement_control_id = %s AND r.request_id IS NOT NULL
        UNION
        SELECT t.sample_request_id FROM control_tests t
        WHERE t.project_id = %s AND t.engagement_control_id = %s
          AND t.test_round_id IS NOT NULL AND t.sample_request_id IS NOT NULL
        UNION
        SELECT d.remediation_request_id FROM deficiencies d
        WHERE d.project_id = %s AND d.engagement_control_id = %s
          AND d.remediation_request_id IS NOT NULL
        """,
        (project_id, control_id, project_id, control_id, project_id, control_id),
    ).fetchall()
    return {UUID(str(row[0])) for row in rows}


def round_requests(connection: Any, round_id: UUID) -> set[UUID]:
    rows = connection.execute(
        """
        SELECT request_id FROM test_rounds WHERE id = %s AND request_id IS NOT NULL
        UNION
        SELECT sample_request_id FROM control_tests
        WHERE test_round_id = %s AND sample_request_id IS NOT NULL
        """,
        (round_id, round_id),
    ).fetchall()
    return {UUID(str(row[0])) for row in rows}


def round_signed_off(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    round_id: UUID,
    conclusion: str,
    requester: UUID,
) -> None:
    """A round's sheet was signed off: close the round, record a retest's result, and open
    the round's own independent review (workflow integrity W2). A retest that failed
    sends its deficiency back to remediation now; one that passed remediates it only once
    the round's review is signed off (round_reviewed, owner's decision 2)."""
    row = cursor.execute(
        """
        UPDATE test_rounds SET status = 'SIGNED_OFF', conclusion = %s, version = version + 1
        WHERE id = %s AND status IN ('REQUESTED', 'TESTING')
        RETURNING kind, deficiency_id, task_id, engagement_control_id
        """,
        (conclusion, round_id),
    ).fetchone()
    if row is None:
        return
    kind, deficiency_id, task_id, control_id = row
    if task_id is not None:
        cursor.execute(
            "UPDATE tasks SET status = 'SUCCEEDED', version = version + 1 "
            "WHERE id = %s AND status NOT IN ('SUCCEEDED', 'CANCELLED')",
            (task_id,),
        )
    if kind == "RETEST" and deficiency_id is not None:
        passed = conclusion == "EFFECTIVE"
        moved = cursor.execute(
            """
            UPDATE deficiencies
            SET status = CASE WHEN %s THEN status ELSE 'REMEDIATION_IN_PROGRESS' END,
                retest_result = %s, retested_at = current_date,
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND status = 'READY_FOR_RETEST'
            RETURNING reference
            """,
            (passed, "PASSED" if passed else "FAILED", deficiency_id),
        ).fetchone()
        if moved is not None:
            _audit(
                cursor, organization_id, project_id, requester, "deficiency.progress",
                "deficiency", deficiency_id,
                {
                    "retest": "PASSED" if passed else "FAILED",
                    "round": str(round_id),
                    "remediated": False,
                    "awaiting": "round review" if passed else None,
                },
            )  # fmt: skip
    _audit(
        cursor, organization_id, project_id, requester, "testing.round_signed_off",
        "test_round", round_id, {"conclusion": conclusion},
    )  # fmt: skip
    from ai_workforce_api.control_reviews import open_review

    open_review(cursor, organization_id, project_id, control_id, requester, round_id)


def round_reviewed(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    round_id: UUID,
    reviewer: UUID,
) -> None:
    """The round's independent review signed off. A retest that passed now remediates its
    deficiency; the reviewer's sign-off alone never does so when the retest found
    continuing exceptions (owner's decision 2)."""
    row = cursor.execute(
        "SELECT kind, conclusion, deficiency_id FROM test_rounds WHERE id = %s", (round_id,)
    ).fetchone()
    if row is None or row[0] != "RETEST" or row[1] != "EFFECTIVE" or row[2] is None:
        return
    moved = cursor.execute(
        """
        UPDATE deficiencies
        SET status = 'REMEDIATED', version = version + 1, updated_at = clock_timestamp()
        WHERE id = %s AND status = 'READY_FOR_RETEST' AND retest_result = 'PASSED'
        RETURNING reference
        """,
        (row[2],),
    ).fetchone()
    if moved is not None:
        _audit(
            cursor, organization_id, project_id, reviewer, "deficiency.progress",
            "deficiency", row[2], {"status": "REMEDIATED", "round": str(round_id),
                                   "on": "round review signed off"},
        )  # fmt: skip


def mark_testing(cursor: psycopg.Cursor[Any], round_id: UUID) -> None:
    cursor.execute(
        "UPDATE test_rounds SET status = 'TESTING', version = version + 1 "
        "WHERE id = %s AND status = 'REQUESTED'",
        (round_id,),
    )


# The API


def rounds(connection: Any, project_id: UUID) -> list[RoundBody]:
    rows = connection.execute(
        """
        SELECT r.id, r.engagement_control_id, c.control_ref, r.kind, r.number, r.status,
               r.method, r.window_start, r.window_end, r.test_from, r.sample_size,
               r.deficiency_id, d.reference, r.request_id, q.status, r.task_id,
               (SELECT t.id FROM control_tests t WHERE t.test_round_id = r.id),
               (SELECT s.id FROM test_sheets s WHERE s.test_round_id = r.id),
               r.conclusion, r.cancel_reason, r.created_at,
               (SELECT a.name FROM engagement_applications a
                WHERE a.id = c.engagement_application_id),
               (SELECT v.status FROM control_reviews v WHERE v.test_round_id = r.id)
        FROM test_rounds r
        JOIN engagement_controls c ON c.id = r.engagement_control_id
        LEFT JOIN deficiencies d ON d.id = r.deficiency_id
        LEFT JOIN pbc_requests q ON q.id = r.request_id
        WHERE r.project_id = %s
        ORDER BY c.control_ref, r.created_at
        """,
        (project_id,),
    ).fetchall()
    found = [
        RoundBody(
            id=row[0],
            control_id=row[1],
            control_ref=str(row[2]),
            kind=row[3],
            number=int(row[4]),
            status=str(row[5]),
            method=str(row[6]),
            window_start=row[7],
            window_end=row[8],
            test_from=row[9],
            sample_size=int(row[10]),
            deficiency_id=row[11],
            deficiency_reference=None if row[12] is None else str(row[12]),
            request_id=row[13],
            request_status=None if row[14] is None else str(row[14]),
            task_id=row[15],
            test_id=row[16],
            sheet_id=row[17],
            conclusion=None if row[18] is None else str(row[18]),
            cancel_reason=str(row[19]),
            created_at=row[20],
            application_name="" if row[21] is None else str(row[21]),
            review_status=None if row[22] is None else str(row[22]),
        )
        for row in rows
    ]
    from ai_workforce_api.round_readiness import round_readiness_states

    states = round_readiness_states(connection, project_id)
    for item in found:
        state = states.get(item.id)
        if state is not None:
            item.readiness_state, item.readiness_blockers = state.state, list(state.blockers)
    return found


def register_test_rounds(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/test-rounds")
    def list_rounds(organization_id: UUID, project_id: UUID, request: Request) -> list[RoundBody]:
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> list[RoundBody]:
            authorize(
                connection,
                principal=principal,
                action=Action.TASK_READ,
                organization_id=organization_id,
                project_id=project_id,
            )
            return rounds(connection, project_id)

        try:
            return _call(settings, work)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    action: str,
    target_type: str,
    target: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, actor, action, target_type, target, Json(payload)),
    )
