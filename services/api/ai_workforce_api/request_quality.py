"""Is an evidence request ready to approve? (master test plans, milestone D)

The checks a request passes before a person approves it, on top of request_details'
(title, type, recipient, due date, scope, planning gate):

- its wording asks for something specific, in the client's terms: no catch-all phrases
  ("all relevant supporting documentation"), no internal codes or testing terms;
- every item that evidences an attribute (a sample's, an execution's, a configuration)
  maps to an approved attribute of the control's plan;
- each item's period lies within its phase's window;
- its phase still applies under the plan;
- nothing on it waits for a decision (a proposed change to one of its items);
- it is not a duplicate of another open request of the same control and phase.

Each check says, in plain words, what to fix. The same wording rules reject a model's draft
(pbc_drafting.check_draft), so the drafter never offers what approval would refuse.
"""

import re
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

import psycopg

# A catch-all request instead of a specific one: "all relevant documentation", "any
# necessary evidence", "supporting documentation as needed". A list that ends "and any other
# filters applied" names what it wants and is not one.
_GENERIC = re.compile(
    r"(?i)\b(?:all|any)\s+(?:other\s+)?(?:relevant|necessary|applicable|appropriate)\s+"
    r"(?:supporting\s+)?(?:documentation|documents|evidence|information|records)\b"
    r"|\bsupporting\s+(?:documentation|evidence)\s+as\s+(?:needed|required|appropriate|"
    r"applicable)\b"
    r"|\bwhatever\s+(?:documentation|evidence|information)\b"
)
# The audit team's own vocabulary, which the client does not need: the plan's codes, its
# testing terms, the agents, and standards.
_INTERNAL = re.compile(
    r"\b(?:test\s+attributes?|attribute\s+[A-Z]?\d+|master\s+test\s+plan|test\s+plan\s+"
    r"revision|planner\s+agent|planning\s+agent|evidence\s+coordinator\s+agent|"
    r"PCAOB|AS\s?\d{4})\b"
    r"|\b[ADEIR]\d{1,2}(?:\s*,\s*[ADEIR]\d{1,2})+\b",
    re.IGNORECASE,
)
_CODES_LIST = re.compile(r"\b[ADEIR]\d{1,2}(?:\s*,\s*[ADEIR]\d{1,2})+\b")
# The categories whose evidence shows an attribute directly (master_plans findings).
EVIDENCES_ATTRIBUTES = frozenset({"SAMPLE", "CONTROL_EXECUTION", "CONFIGURATION"})
_OPEN = ("CANCELLED", "CLOSED")


def wording_problems(text: str) -> list[str]:
    """What in a request's client-facing wording is not specific or not the client's."""
    found: list[str] = []
    generic = _GENERIC.search(text)
    if generic is not None:
        found.append(f'Ask for something specific instead of "{generic.group(0).strip()}".')
    internal = _CODES_LIST.search(text) or _INTERNAL.search(text)
    if internal is not None:
        found.append(
            f'Leave out the audit team\'s own terms ("{internal.group(0).strip()}"): the '
            "client reads this."
        )
    return found


@dataclass(frozen=True)
class Check:
    key: str
    label: str
    ok: bool
    detail: str


def _day(value: date) -> str:
    return f"{value.day} {value:%B %Y}"


def quality_checks(
    connection: psycopg.Connection[Any],
    request_id: UUID,
    project_id: UUID,
    control_id: UUID | None,
    phase: str | None,
    wording: str,
    status: str,
) -> list[Check]:
    """The checks above, for one request. A request a person wrote with no control gets the
    wording check only."""
    checks: list[Check] = []
    problems = wording_problems(wording)
    checks.append(
        Check(
            key="wording",
            label="Clear and specific",
            ok=not problems,
            detail=problems[0] if problems else "Asks for specific items, in the client's terms.",
        )
    )
    if control_id is None:
        return checks
    items = connection.execute(
        """
        SELECT q.id, q.code, q.title, q.categories, q.period_start, q.period_end,
               q.pending_change IS NOT NULL,
               EXISTS (SELECT 1 FROM evidence_requirement_attributes l
                       JOIN control_attributes a ON a.id = l.attribute_id
                       WHERE l.requirement_id = q.id AND a.status = 'APPROVED')
        FROM evidence_requirements q
        WHERE q.pbc_request_id = %s AND q.status = 'REQUESTED'
        ORDER BY q.code
        """,
        (request_id,),
    ).fetchall()
    # Every item that evidences an attribute names one the plan approved.
    unmapped = [
        f"{row[1]} ({row[2]})" for row in items if set(row[3]) & EVIDENCES_ATTRIBUTES and not row[7]
    ]
    checks.append(
        Check(
            key="mapping",
            label="Mapped to the test plan",
            ok=not unmapped,
            detail=(
                f"{unmapped[0]} evidences no approved attribute of the test plan. Link it in "
                "the test plan first."
                if unmapped
                else f"{len(items)} planned item{'s' if len(items) != 1 else ''}, each traced "
                "to the test plan."
                if items
                else "Written request: no planned item."
            ),
        )
    )
    # Its phase still applies, and each item's period lies within the phase's window.
    window = None
    if phase in ("DESIGN", "INTERIM", "ROLLFORWARD"):
        window = connection.execute(
            """
            SELECT ph.applicability, ph.period_start, ph.period_end
            FROM evidence_plan_phases ph JOIN evidence_plans p ON p.id = ph.plan_id
            WHERE p.engagement_control_id = %s AND ph.phase = %s
            """,
            (control_id, phase),
        ).fetchone()
    if window is not None and status in ("DRAFT", "APPROVAL_PENDING"):
        applies = str(window[0]) in ("APPLICABLE", "CONDITIONAL")
        checks.append(
            Check(
                key="phase_applies",
                label="Phase applies",
                ok=applies,
                detail="The test plan says this phase applies."
                if applies
                else "The test plan no longer has this phase apply: cancel the request or "
                "decide the phase again.",
            )
        )
    outside: list[str] = []
    if window is not None and window[1] is not None and window[2] is not None:
        start, end = window[1], window[2]
        for row in items:
            if row[4] is not None and row[4] < start or row[5] is not None and row[5] > end:
                outside.append(f"{row[1]} ({row[2]})")
    checks.append(
        Check(
            key="period",
            label="Period",
            ok=not outside,
            detail=(
                f"{outside[0]} asks for a period outside the phase's window"
                f" ({_day(window[1])} to {_day(window[2])})."
                if outside and window is not None
                else f"Within {_day(window[1])} to {_day(window[2])}."
                if window is not None and window[1] is not None and window[2] is not None
                else "As at the date requested."
            ),
        )
    )
    pending = [f"{row[1]} ({row[2]})" for row in items if row[6]]
    checks.append(
        Check(
            key="decisions",
            label="Nothing undecided",
            ok=not pending,
            detail=f"A proposed change to {pending[0]} waits for a decision on the test plan."
            if pending
            else "No proposed change waits on its items.",
        )
    )
    # Another open request of the same control and phase asking for the same thing.
    duplicate = connection.execute(
        """
        SELECT r.id FROM pbc_requests r
        WHERE r.project_id = %s AND r.engagement_control_id = %s AND r.id <> %s
          AND r.testing_phase IS NOT DISTINCT FROM %s::text AND r.status <> ALL(%s::text[])
          AND lower(regexp_replace(btrim(r.evidence_description), '\\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(%s), '\\s+', ' ', 'g'))
        LIMIT 1
        """,
        (project_id, control_id, request_id, phase, list(_OPEN), wording),
    ).fetchone()
    checks.append(
        Check(
            key="duplicate",
            label="Not a duplicate",
            ok=duplicate is None,
            detail="Another open request of this control and phase asks for the same items."
            if duplicate is not None
            else "No other open request asks for the same items.",
        )
    )
    return checks


def supports(
    connection: psycopg.Connection[Any], request_id: UUID
) -> list[tuple[str, str, list[str]]]:
    """The approved attributes the request's items evidence: (code, wording, item codes),
    for the reviewer to see before approving. Never shown to the client."""
    rows = connection.execute(
        """
        SELECT a.code, a.text, array_agg(DISTINCT q.code ORDER BY q.code)
        FROM evidence_requirements q
        JOIN evidence_requirement_attributes l ON l.requirement_id = q.id
        JOIN control_attributes a ON a.id = l.attribute_id AND a.status = 'APPROVED'
        WHERE q.pbc_request_id = %s AND q.status = 'REQUESTED'
        GROUP BY a.code, a.text, a.position
        ORDER BY a.position, a.code
        """,
        (request_id,),
    ).fetchall()
    return [(str(row[0] or ""), str(row[1]), [str(item) for item in row[2]]) for row in rows]
