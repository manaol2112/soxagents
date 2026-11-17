"""What an agent assumed once the understanding was completed (docs/control-workflow-plan.md,
B1j; the product owner, 16 November 2026, asked how a gap an agent finds after the
understanding is finished is handled: "On the attribute").

Once a control's Control Understanding is completed (understanding_once), no agent writes an
open question on it: the person is never sent back. Where the attribute agent, the
narrative's agents, their late points or another agent find a fact missing, unclear or
contradicted, they state the assumption they tailored the attributes on, on the attributes
it bears on (`attribute_codes`; none: the set as a whole), in attribute_assumptions
(migration 0172). The attribute shows "The agent assumed: ..." with That's right and
Change...:

- CONFIRMED (`confirm`): a person said it is right. It is a confirmed fact of the
  understanding, a PERSON fact newest first, as B1e reads the answers to the agents' earlier
  questions (understanding_authority.facts).
- CHANGED (`change`): a person gave the fact in their own words (10 to 1,000 characters).
  It is a PERSON fact too, and it starts one update of the attributes the assumption names,
  limited to them (evidence_plans.queue_assumption_update).
- ACCEPTED_WITH_ATTRIBUTE (`accept_with`): a person accepted an attribute it names while it
  was open. Recorded as accepted with the attribute, never as the person's own answer: it is
  not a fact of the understanding.
- SUPERSEDED (`supersede_gone`): nothing it names is approved any more.

B1k and B1l (16 November 2026). A question a person leaves as "Not known yet, proceed" is
closed as not known and becomes an assumption on the attributes it bears on (kind NOT_KNOWN,
its source question kept), and a question the specialist's review did not ask (beyond the
seven, or after its second read) becomes one keyed as the question would have been (asks_code,
asks_fact), so it is assumed once. A CONFLICT holds its attributes' acceptance until a person
decides it (understanding_review.held_codes): it is never accepted with its attribute. One
accepted with its attribute is a point of the D&I workpaper to settle before the preparer
signs (design_points, kind ASSUMPTION), settled by That's right or Change... (once more,
keeping who had accepted it) or by a consideration with a reason. The API says each one's
`kind`: ASSUMPTION (a missing or unclear fact), CONFLICT or NOT_KNOWN (migration 0173).

Agent output is never a person's: an assumption is the agent's (its model call) until a
person confirms or changes it. A matter is assumed once on a control, whatever became of it,
and never when it was asked as a question there. Everything an agent wrote here is data:
shown as words, never read as instructions.
"""

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.control_context import ContextState, Issue, line, matter_key

AssumptionStatus = Literal["OPEN", "CONFIRMED", "CHANGED", "ACCEPTED_WITH_ATTRIBUTE", "SUPERSEDED"]
AssumptionKind = Literal["MISSING", "AMBIGUOUS", "CONFLICT", "NOT_KNOWN"]
# What the API calls a kind (B1l): a missing or unclear fact is an ASSUMPTION.
ShownKind = Literal["ASSUMPTION", "CONFLICT", "NOT_KNOWN"]

MATTER_LIMIT = 300
ASSUMED_LIMIT = 500
ANSWER_MIN = 10
ANSWER_LIMIT = 1000
MAX_CODES = 12
# How many an attribute shows: the open ones, and the decided ones of the last 30 days,
# newest first.
SHOWN = 10
SHOWN_DAYS = 30
_CODE = re.compile(r"^A[0-9]{1,3}$")

STALE = "The assumption changed; read it again."
DECIDED = "The assumption is already decided."


class DecidedBy(BaseModel):
    id: UUID
    name: str


class AssumptionBody(BaseModel):
    """One assumption as the API gives it (ContextBody.set_assumptions, each attribute's
    `assumptions`)."""

    id: UUID
    matter: str
    assumed: str
    status: AssumptionStatus
    # The person's own words, for CHANGED; "" otherwise.
    answer: str
    decided_by: DecidedBy | None
    decided_at: datetime | None
    attribute_codes: list[str]
    version: int
    # B1l (16 November 2026): ASSUMPTION, CONFLICT (holds its attributes' acceptance until
    # decided) or NOT_KNOWN (from a question a person left as not known).
    kind: ShownKind = "ASSUMPTION"


def shown_kind(kind: str) -> ShownKind:
    """The API's kind of a recorded one: MISSING and AMBIGUOUS read as ASSUMPTION."""
    if kind == "CONFLICT":
        return "CONFLICT"
    if kind == "NOT_KNOWN":
        return "NOT_KNOWN"
    return "ASSUMPTION"


class ConfirmBody(BaseModel):
    version: int = Field(ge=1)


class ChangeBody(BaseModel):
    text: str = Field(min_length=ANSWER_MIN, max_length=ANSWER_LIMIT)
    version: int = Field(ge=1)


@dataclass(frozen=True)
class Draft:
    """An assumption an agent stated, before it is recorded."""

    kind: AssumptionKind
    matter: str
    assumed: str
    codes: tuple[str, ...] = ()
    # B1l: the key of a question the specialist did not ask, and the question a person left
    # as not known (migration 0173).
    asks_code: str | None = None
    asks_fact: str | None = None
    source_issue: UUID | None = None


def drafted(
    kind: str, matter: str, assumed: str, codes: list[str] | tuple[str, ...] = ()
) -> Draft | None:
    """An agent's assumption as it may be recorded, or None: its matter and its assumption
    each one line within their limits, no credential, its kind one of the three (anything
    else reads as MISSING), and only well-formed attribute codes, once each, in order. The
    words are kept as the agent wrote them, as data."""
    clean_matter = line(matter, MATTER_LIMIT)
    clean_assumed = line(assumed, ASSUMED_LIMIT)
    if not clean_matter or not clean_assumed or not matter_key(clean_matter):
        return None
    if contains_secret({"matter": clean_matter, "assumed": clean_assumed}):
        return None
    chosen: AssumptionKind = (
        "AMBIGUOUS" if kind == "AMBIGUOUS" else "CONFLICT" if kind == "CONFLICT" else "MISSING"
    )
    kept = tuple(dict.fromkeys(code.strip() for code in codes if _CODE.match(code.strip())))[
        :MAX_CODES
    ]
    return Draft(chosen, clean_matter, clean_assumed, kept)


def from_issue(issue: Issue, codes: tuple[str, ...] = ()) -> Draft | None:
    """What an agent's question would have asked, as its assumption: the statement it
    proposed to confirm where it gave one, otherwise what it found (its detail). A conflict
    is stated as found: the agent's own statement of each side is not a fact."""
    assumed = issue.proposal if issue.kind != "CONFLICT" and issue.proposal else issue.detail
    return drafted(issue.kind, issue.topic, assumed, codes)


def shaped(drafts: list[Draft | None], approved_codes: set[str]) -> list[Draft]:
    """The drafts to record: each matter once (matter_key), and only the codes of attributes
    the control has approved (an assumption naming none of them bears on the set)."""
    seen: set[str] = set()
    found: list[Draft] = []
    for draft in drafts:
        if draft is None:
            continue
        key = matter_key(draft.matter)
        if key in seen:
            continue
        seen.add(key)
        found.append(
            Draft(
                draft.kind,
                draft.matter,
                draft.assumed,
                tuple(code for code in draft.codes if code in approved_codes),
                draft.asks_code,
                draft.asks_fact,
                draft.source_issue,
            )
        )
    return found


def approved_codes(
    executor: psycopg.Cursor[Any] | psycopg.Connection[Any], control_id: UUID
) -> set[str]:
    return {
        str(row[0])
        for row in executor.execute(
            "SELECT code FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' AND code IS NOT NULL",
            (control_id,),
        ).fetchall()
    }


def record(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    drafts: list[Draft | None],
    agent: str,
    call_id: UUID | None,
) -> int:
    """Record what an agent assumed, OPEN, as the agent's (its model call). A matter already
    assumed on the control (whatever its status) or already asked there as a question (any
    issue's topic, whatever its status) is not recorded again: the asked-once rule. Since B1l
    a keyed one (asks_fact) is recorded once per key, and one from a question left as not
    known once per question, whose own topic it carries (migration 0173's indexes).
    Returns how many were recorded."""
    asked = {
        matter_key(str(row[0]))
        for row in cursor.execute(
            "SELECT topic FROM control_context_issues WHERE engagement_control_id = %s",
            (control_id,),
        ).fetchall()
    }
    recorded = 0
    for draft in shaped(drafts, approved_codes(cursor, control_id)):
        if draft.source_issue is None and matter_key(draft.matter) in asked:
            continue
        if (draft.kind == "NOT_KNOWN") != (draft.source_issue is not None):
            continue
        row = cursor.execute(
            """
            INSERT INTO attribute_assumptions (
                organization_id, project_id, engagement_control_id, matter, assumed, kind,
                attribute_codes, raised_by_agent, model_call_id, asks_code, asks_fact,
                source_issue_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (organization_id, project_id, control_id, draft.matter, draft.assumed, draft.kind,
             Json(list(draft.codes)), line(agent, 60) or "agent", call_id,
             None if draft.asks_code is None else line(draft.asks_code, 80) or None,
             draft.asks_fact, draft.source_issue),
        ).fetchone()  # fmt: skip
        if row is not None:
            recorded += 1
    return recorded


# What the API gives


def _bodies(rows: list[Any]) -> list[AssumptionBody]:
    return [
        AssumptionBody(
            id=row[0],
            matter=str(row[1]),
            assumed=str(row[2]),
            status=row[3],
            answer=str(row[4]),
            decided_by=None if row[5] is None else DecidedBy(id=row[5], name=str(row[6] or "")),
            decided_at=row[7],
            attribute_codes=[str(code) for code in (row[8] or []) if isinstance(code, str)],
            version=int(row[9]),
            kind=shown_kind(str(row[10])),
        )
        for row in rows
    ]


def shown(
    connection: psycopg.Connection[Any], control_id: UUID
) -> tuple[dict[str, list[AssumptionBody]], list[AssumptionBody]]:
    """The control's assumptions as the Attributes step shows them: per attribute code, and
    those that name no attribute (the set's). Each list holds the open ones and those decided
    in the last 30 days, newest first, at most 10."""
    rows = connection.execute(
        f"""
        SELECT s.id, s.matter, s.assumed, s.status, s.answer, s.decided_by, u.display_name,
               s.decided_at, s.attribute_codes, s.version, s.kind
        FROM attribute_assumptions s
        LEFT JOIN users u ON u.id = s.decided_by
        WHERE s.engagement_control_id = %s
          AND (s.status IN ('OPEN', 'ACCEPTED_WITH_ATTRIBUTE')
               OR s.decided_at >= clock_timestamp() - interval '{SHOWN_DAYS} days')
        ORDER BY s.created_at DESC, s.id DESC
        """,
        (control_id,),
    ).fetchall()
    return arranged(_bodies(rows))


def arranged(
    bodies: list[AssumptionBody],
) -> tuple[dict[str, list[AssumptionBody]], list[AssumptionBody]]:
    """Per attribute code and for the set, in the order given (newest first), at most SHOWN
    each."""
    by_code: dict[str, list[AssumptionBody]] = {}
    for_set: list[AssumptionBody] = []
    for body in bodies:
        if not body.attribute_codes:
            if len(for_set) < SHOWN:
                for_set.append(body)
            continue
        for code in body.attribute_codes:
            held = by_code.setdefault(code, [])
            if len(held) < SHOWN:
                held.append(body)
    return by_code, for_set


# A person's decision

# Who had accepted it with its attribute, and when, kept beside a later confirmation or change
# (migration 0173's guard requires it): the right-hand side reads the row as it was.
_KEEP_ACCEPTANCE = (
    "accepted_by = CASE WHEN status = 'ACCEPTED_WITH_ATTRIBUTE' THEN decided_by END, "
    "accepted_at = CASE WHEN status = 'ACCEPTED_WITH_ATTRIBUTE' THEN decided_at END"
)


def _open_one(
    cursor: psycopg.Cursor[Any], control_id: UUID, assumption_id: UUID, version: int
) -> tuple[str, str, list[str]]:
    """The assumption a person decides, locked: its matter, what it assumed and its codes.
    404 when it is not this control's; 409 when it is decided or changed. One accepted with
    its attribute may still be confirmed or changed, once (B1l: the D&I workpaper's point)."""
    from ai_workforce_api.authorization import NotVisible

    row = cursor.execute(
        "SELECT status, version, matter, assumed, attribute_codes FROM attribute_assumptions "
        "WHERE id = %s AND engagement_control_id = %s FOR UPDATE",
        (assumption_id, control_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    if str(row[0]) not in ("OPEN", "ACCEPTED_WITH_ATTRIBUTE"):
        raise ContextState(DECIDED)
    if int(row[1]) != version:
        raise ContextState(STALE)
    return str(row[2]), str(row[3]), [str(code) for code in (row[4] or [])]


def confirm(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    assumption_id: UUID,
    actor: UUID,
    body: ConfirmBody,
) -> None:
    """That's right: the person confirms what the agent assumed. From now on it is a
    confirmed fact of the understanding (understanding_authority.facts), the person's."""
    from ai_workforce_api.db import transaction

    with transaction(connection) as cursor:
        matter, _assumed, codes = _open_one(cursor, control_id, assumption_id, body.version)
        cursor.execute(
            f"UPDATE attribute_assumptions SET status = 'CONFIRMED', {_KEEP_ACCEPTANCE}, "
            "decided_by = %s, decided_at = clock_timestamp(), version = version + 1 "
            "WHERE id = %s",
            (actor, assumption_id),
        )
        _audit(cursor, organization_id, project_id, actor, "attribute_assumption.confirmed",
               assumption_id, {"matter": matter, "codes": codes})  # fmt: skip


def change(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    assumption_id: UUID,
    actor: UUID,
    body: ChangeBody,
) -> tuple[str, list[str]]:
    """Change...: the person states the fact in their own words, which become a confirmed
    fact of the understanding. Returns the matter and the codes of the approved attributes it
    names, for the one update that follows (only those attributes may change). Plain text of
    10 to 1,000 characters with no credential, else 422."""
    from ai_workforce_api.db import transaction

    answer = line(body.text, ANSWER_LIMIT)
    if len(answer) < ANSWER_MIN:
        raise ValueError("the answer is too short")
    if contains_secret({"answer": answer}):
        raise ValueError("an answer must be plain text")
    with transaction(connection) as cursor:
        matter, _assumed, codes = _open_one(cursor, control_id, assumption_id, body.version)
        cursor.execute(
            "UPDATE attribute_assumptions SET status = 'CHANGED', answer = %s, "
            f"{_KEEP_ACCEPTANCE}, decided_by = %s, decided_at = clock_timestamp(), "
            "version = version + 1 WHERE id = %s",
            (answer, actor, assumption_id),
        )
        # The person's words stay in their row: the audit record keeps how long they were.
        _audit(
            cursor, organization_id, project_id, actor, "attribute_assumption.changed",
            assumption_id, {"matter": matter, "codes": codes, "length": len(answer)},
        )  # fmt: skip
        named = approved_codes(cursor, control_id)
    return matter, [code for code in codes if code in named]


def accept_with(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    code: str | None,
    actor: UUID,
) -> int:
    """A person accepted an attribute (its code) while assumptions naming it were open, or,
    with no code, the whole set while the set's assumptions were open: each is recorded as
    accepted with the attribute, never as the person's own answer. Returns how many. A
    CONFLICT is never accepted with its attribute (B1l point 6): it holds the attribute's
    acceptance until a person decides it."""
    if code is None:
        rows = cursor.execute(
            "UPDATE attribute_assumptions SET status = 'ACCEPTED_WITH_ATTRIBUTE', "
            "decided_by = %s, decided_at = clock_timestamp(), version = version + 1 "
            "WHERE engagement_control_id = %s AND status = 'OPEN' AND kind <> 'CONFLICT' "
            "AND attribute_codes = '[]'::jsonb RETURNING id",
            (actor, control_id),
        ).fetchall()
    else:
        rows = cursor.execute(
            "UPDATE attribute_assumptions SET status = 'ACCEPTED_WITH_ATTRIBUTE', "
            "decided_by = %s, decided_at = clock_timestamp(), version = version + 1 "
            "WHERE engagement_control_id = %s AND status = 'OPEN' AND kind <> 'CONFLICT' "
            "AND attribute_codes ? %s RETURNING id",
            (actor, control_id, code),
        ).fetchall()
    if rows:
        _audit_control(
            cursor, organization_id, project_id, actor,
            "attribute_assumption.accepted_with_attribute", control_id,
            {"code": code, "assumptions": [str(row[0]) for row in rows]},
        )  # fmt: skip
    return len(rows)


def supersede_gone(cursor: psycopg.Cursor[Any], control_id: UUID) -> int:
    """An open assumption none of whose attributes is approved any more (retired) stands for
    nothing: superseded, by no person."""
    rows = cursor.execute(
        """
        UPDATE attribute_assumptions s
        SET status = 'SUPERSEDED', decided_at = clock_timestamp(), version = s.version + 1
        WHERE s.engagement_control_id = %s AND s.status = 'OPEN'
          AND s.attribute_codes <> '[]'::jsonb
          AND NOT EXISTS (
              SELECT 1 FROM control_attributes a
              WHERE a.engagement_control_id = s.engagement_control_id
                AND a.status = 'APPROVED' AND s.attribute_codes ? a.code)
        RETURNING s.id
        """,
        (control_id,),
    ).fetchall()
    return len(rows)


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    action: str,
    target: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'attribute_assumption', %s, %s)
        """,
        (organization_id, project_id, actor, action, target, Json(payload)),
    )


def _audit_control(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    action: str,
    control_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'engagement_control', %s, %s)
        """,
        (organization_id, project_id, actor, action, control_id, Json(payload)),
    )
