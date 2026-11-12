"""The confirmed Control Understanding is the authority (decided by the product owner on 12
November 2026; docs/control-workflow-plan.md, B1e: "since I've finalized the control
understanding, shouldn't the attribute just follow what control understanding says so I
won't get any conflict like this?"; and, on two answers inside it that disagree: "Yes. Newer
answer wins.").

What the understanding is: every confirmed walkthrough answer that stands
(walkthrough_answers.stands), every client value of the control's statement
(control_parameters), and every answer to an agent's earlier question (a resolved or
dismissed control_context_issues row; its note is the answer). Each is a fact with when it
was confirmed and by what kind of actor (`facts`), given to the agents newest first, each
with a ref the agent's answer can name, and marked `older` when a newer fact exists
(`for_agents`).

The rules the agents and the server apply:

1. Where the RCM record, a library attribute's wording or an approved attribute's wording or
   criteria differ from the understanding, the agents follow the understanding and raise no
   issue.
2. Where two confirmed facts disagree, the one confirmed later holds; the older is treated
   as replaced. No row is deleted or rewritten: the older answer stays on record.
3. An agent that follows a fact over something else says so in structured output (`Follows`):
   the fact's ref, what it says, what was set aside, one plain sentence. The server checks it
   (`recorded`): the ref must be a fact on record, every older answer set aside must be a
   fact on record and not newer than the one followed (an agent that follows an older answer
   over a newer one has its proposal left out), and the dates and kinds come from the
   records, never from the agent. The record is kept on the attribute it explains
   (control_attributes.understanding_basis, migration 0150) with a mark of the wording and
   criteria it explains, so it is never shown for words that changed after it (`current`).
4. A CONFLICT is raised only for two sources that disagree on a matter the understanding
   does not speak to (`not_raised`, a guard with no model in it).
5. A missing or ambiguous fact is still raised when no confirmed fact covers it.

Everything here reads; the writes are in control_attributes.generate.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel, Field, ValidationError

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.control_context import (
    NARRATIVE_SOURCE,
    AnswerIssue,
    Source,
    check_quote,
    line,
)

FactKind = Literal["WALKTHROUGH_ANSWER", "CONTROL_VALUE", "ANSWERED_QUESTION"]
ConfirmedBy = Literal["PERSON", "RECORDS"]
SetAsideKind = Literal["OLDER_ANSWER", "RCM_RECORD", "LIBRARY_WORDING", "APPROVED_ATTRIBUTE"]

# The most facts an agent's prompt carries: the newest.
MAX_FACTS = 80
QUESTION_LIMIT = 220
ANSWER_LIMIT = 500
STATEMENT_LIMIT = 200
# The note on an open question the agent's next run closes because these rules settle it.
SETTLED_NOTE = (
    "Settled by the confirmed understanding: the agents follow it, and where two confirmed "
    "answers disagree the newer answer holds."
)
DEFAULT_SUMMARY = "The attribute follows the confirmed understanding over what it sets aside."

# The paragraph every agent that reads the understanding is given (rule 8): the attribute
# agent, the reviewer of its drafts, the reviewer of the set, the planner, and the
# narrative's drafter and reviewer.
PRECEDENCE = (
    "confirmed_understanding is how this control runs at this client, as a person confirmed "
    "it: every confirmed walkthrough answer, client value and answer to an earlier question, "
    "each with a ref, its kind and when it was confirmed (confirmed_at), newest first. It is "
    "the authority. Where the control's RCM record, a library standard's wording, or an "
    "approved attribute's wording or criteria say something else (another system, record, "
    "approver or timing), follow confirmed_understanding. Where two of its facts disagree, "
    "the one confirmed later holds and the earlier one (marked older) is treated as "
    "replaced. Neither difference is a conflict, an ambiguity, a concern or a question for "
    "anyone: never raise one, and never correct something back to what was set aside."
)


@dataclass(frozen=True)
class Fact:
    """One confirmed fact of the understanding."""

    # U1 is the newest; the agents name a fact by it.
    ref: str
    kind: FactKind
    # The walkthrough question's key, the value's slot key, or the answered question's id.
    key: str
    question: str
    answer: str
    confirmed_at: datetime | None
    confirmed_by: ConfirmedBy
    # A newer confirmed fact exists: where the two disagree, the newer one holds.
    older: bool


def iso(at: datetime | None) -> str | None:
    return None if at is None else at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def facts(connection: psycopg.Connection[Any], control_id: UUID) -> tuple[Fact, ...]:
    """The confirmed understanding of the control, newest first: the walkthrough answers that
    stand to the questions asked now (as walkthrough_answers.for_agents), the client values
    of its statement, and the answers to the agents' earlier questions."""
    from ai_workforce_api.control_design import design_for
    from ai_workforce_api.walkthrough_answers import answers_of, questions_asked, stands

    found: list[tuple[FactKind, str, str, str, datetime | None, ConfirmedBy]] = []
    rows = answers_of(connection, control_id)
    answered = {
        str(key): at
        for key, at in connection.execute(
            "SELECT question_key, answered_at FROM control_walkthrough_answers "
            "WHERE engagement_control_id = %s AND status = 'CONFIRMED'",
            (control_id,),
        ).fetchall()
    }
    for item in questions_asked(connection, control_id, rows):
        row = rows.get(item.key)
        if row is None or not stands(row, item) or row.not_applicable:
            continue
        found.append(
            ("WALKTHROUGH_ANSWER", item.key, item.text, row.value, answered.get(item.key),
             "PERSON")
        )  # fmt: skip
    design = design_for(connection, control_id)
    if design is not None:
        for slot in design.slots:
            if slot.automatic or not slot.value.strip():
                continue
            found.append(
                ("CONTROL_VALUE", slot.key, slot.question or slot.label, slot.value,
                 slot.filled_at, "PERSON" if slot.filled_by is not None else "RECORDS")
            )  # fmt: skip
    for issue_id, question, topic, status, note, at, by in connection.execute(
        "SELECT id, question, topic, status, resolution_note, resolved_at, resolved_by "
        "FROM control_context_issues WHERE engagement_control_id = %s "
        "AND status IN ('RESOLVED', 'DISMISSED') ORDER BY resolved_at",
        (control_id,),
    ).fetchall():
        answer = str(note) if status == "RESOLVED" else f"Not applicable: {note}"
        found.append(
            ("ANSWERED_QUESTION", str(issue_id), str(question) or str(topic), answer, at,
             "PERSON" if by is not None else "RECORDS")
        )  # fmt: skip
    oldest = datetime.min.replace(tzinfo=UTC)
    # Newest first; facts confirmed at the same moment keep the order they were read in.
    ordered = sorted(found, key=lambda item: item[4] or oldest, reverse=True)[:MAX_FACTS]
    newest = next((item[4] for item in ordered if item[4] is not None), None)
    return tuple(
        Fact(
            ref=f"U{index}",
            kind=kind,
            key=key,
            question=line(question, QUESTION_LIMIT),
            answer=line(answer, ANSWER_LIMIT),
            confirmed_at=at,
            confirmed_by=by,
            older=newest is not None and (at is None or at < newest),
        )
        for index, (kind, key, question, answer, at, by) in enumerate(ordered, start=1)
    )


def for_agents(found: tuple[Fact, ...], answer_limit: int = ANSWER_LIMIT) -> list[dict[str, Any]]:
    """The facts as an agent's prompt carries them, newest first. Client-provided data."""
    return [
        {
            "ref": fact.ref,
            "kind": fact.kind,
            "question": fact.question,
            "answer": fact.answer[:answer_limit],
            "confirmed_at": iso(fact.confirmed_at),
            "confirmed_by": fact.confirmed_by,
            "older": fact.older,
        }
        for fact in found
    ]


def narrative_confirmed_at(
    connection: psycopg.Connection[Any], control_id: UUID
) -> datetime | None:
    """When a person approved the process narrative, or None when none is approved."""
    row = connection.execute(
        "SELECT confirmed_at FROM process_understandings WHERE engagement_control_id = %s "
        "AND status = 'CONFIRMED'",
        (control_id,),
    ).fetchone()
    return None if row is None else row[0]


def packaged(
    package: dict[str, Any], found: tuple[Fact, ...], narrative_at: datetime | None = None
) -> dict[str, Any]:
    """The control context package with the understanding in it once, dated: the undated
    walkthrough answers a caller put there are the same answers and are left out. An
    approved narrative says when it was approved, so a fact confirmed after it holds."""
    kept = {key: value for key, value in package.items() if key != "walkthrough_answers"}
    kept["confirmed_understanding"] = for_agents(found)
    if narrative_at is not None and "approved_process_narrative" in kept:
        kept["approved_process_narrative_confirmed_at"] = iso(narrative_at)
    return kept


# What an agent says it followed


class SetAsideSaid(BaseModel):
    kind: SetAsideKind
    # The older answer's ref, for OLDER_ANSWER; empty otherwise.
    fact: str = Field(default="", max_length=8)
    statement: str = Field(default="", max_length=300)


class Follows(BaseModel):
    """An agent's statement that it followed a confirmed fact over something else."""

    fact: str = Field(default="", max_length=8)
    statement: str = Field(default="", max_length=300)
    sets_aside: list[SetAsideSaid] = Field(default_factory=list, max_length=3)
    why: str = Field(default="", max_length=400)


FOLLOWS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "fact": {"type": "string", "maxLength": 8},
        "statement": {"type": "string", "maxLength": STATEMENT_LIMIT},
        "sets_aside": {
            "type": "array",
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": [
                            "OLDER_ANSWER",
                            "RCM_RECORD",
                            "LIBRARY_WORDING",
                            "APPROVED_ATTRIBUTE",
                        ],
                    },  # fmt: skip
                    "fact": {"type": "string", "maxLength": 8},
                    "statement": {"type": "string", "maxLength": STATEMENT_LIMIT},
                },
                "required": ["kind", "fact", "statement"],
                "additionalProperties": False,
            },
        },
        "why": {"type": "string", "maxLength": 300},
    },
    "required": ["fact", "statement", "sets_aside", "why"],
    "additionalProperties": False,
}


class FollowedFact(BaseModel):
    kind: FactKind
    # What the fact says, as the agent's one plain sentence.
    statement: str = Field(min_length=1, max_length=STATEMENT_LIMIT)
    key: str = Field(default="", max_length=80)
    question: str = Field(default="", max_length=QUESTION_LIMIT)
    answer: str = Field(default="", max_length=ANSWER_LIMIT)
    confirmed_at: datetime | None = None
    confirmed_by: ConfirmedBy = "PERSON"


class SetAside(BaseModel):
    kind: SetAsideKind
    statement: str = Field(min_length=1, max_length=STATEMENT_LIMIT)
    # For OLDER_ANSWER: which kind of fact it is and when it was confirmed.
    fact_kind: FactKind | None = None
    key: str = Field(default="", max_length=80)
    confirmed_at: datetime | None = None


class Followed(BaseModel):
    """What an agent followed and what it set aside, checked against the records."""

    follows: FollowedFact
    sets_aside: list[SetAside] = Field(min_length=1, max_length=3)
    summary: str = Field(min_length=1, max_length=300)


class StoredBasis(Followed):
    """control_attributes.understanding_basis, as written and as read: the record, the agent
    and the model call it came from, and a mark of the wording and criteria it explains."""

    by: str = Field(max_length=60)
    model_call: UUID | None = None
    prompt_version: str = Field(default="", max_length=60)
    recorded_at: datetime
    mark: str = Field(pattern=r"^[0-9a-f]{64}$")


class UnderstandingBasis(Followed):
    """The record as the attribute API gives it: agent output, never a person's decision."""

    by: str
    recorded_at: datetime


def mark(text: Any, condition: Any, passes: Any, fails: Any, judgment: Any) -> str:
    """A hash of an attribute's wording and criteria (as attribute_review._mark)."""
    data = json.dumps(
        [str(text or ""), str(condition or ""), str(passes or ""), str(fails or ""),
         bool(judgment)],
        ensure_ascii=False,
    )  # fmt: skip
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def recorded(said: Follows | None, found: tuple[Fact, ...]) -> tuple[Followed | None, bool]:
    """The agent's statement checked against the records: the record to keep (None when it
    names no fact on record, sets nothing aside, or holds a secret), and whether it follows
    an older answer over a newer one, which rule 2 forbids."""
    if said is None:
        return None, False
    by_ref = {fact.ref: fact for fact in found}
    fact = by_ref.get(said.fact.strip())
    if fact is None:
        return None, False
    aside: list[SetAside] = []
    for item in said.sets_aside[:3]:
        statement = line(item.statement, STATEMENT_LIMIT)
        if item.kind != "OLDER_ANSWER":
            if statement:
                aside.append(SetAside(kind=item.kind, statement=statement))
            continue
        older = by_ref.get(item.fact.strip())
        if older is None or older.ref == fact.ref:
            continue
        if (
            older.confirmed_at is not None
            and fact.confirmed_at is not None
            and older.confirmed_at > fact.confirmed_at
        ) or (older.confirmed_at is not None and fact.confirmed_at is None):
            return None, True
        aside.append(
            SetAside(
                kind="OLDER_ANSWER",
                statement=statement or line(older.answer, STATEMENT_LIMIT),
                fact_kind=older.kind,
                key=older.key,
                confirmed_at=older.confirmed_at,
            )
        )
    if not aside:
        return None, False
    statement = line(said.statement, STATEMENT_LIMIT) or line(fact.answer, STATEMENT_LIMIT)
    summary = line(said.why, 300) or DEFAULT_SUMMARY
    texts = {"statement": statement, "summary": summary,
             "aside": " ".join(item.statement for item in aside)}  # fmt: skip
    if not statement or contains_secret(texts):
        return None, False
    return (
        Followed(
            follows=FollowedFact(
                kind=fact.kind,
                statement=statement,
                key=fact.key,
                question=fact.question,
                answer=fact.answer,
                confirmed_at=fact.confirmed_at,
                confirmed_by=fact.confirmed_by,
            ),
            sets_aside=aside,
            summary=summary,
        ),
        False,
    )


def stored(
    record: Followed, by: str, call_id: UUID | None, prompt_version: str, marked: str
) -> dict[str, Any]:
    """The record as it is kept on the attribute it explains."""
    return StoredBasis(
        **record.model_dump(),
        by=by,
        model_call=call_id,
        prompt_version=prompt_version,
        recorded_at=datetime.now(UTC),
        mark=marked,
    ).model_dump(mode="json")


def read(raw: Any) -> StoredBasis | None:
    if not isinstance(raw, dict):
        return None
    try:
        return StoredBasis.model_validate(raw)
    except ValidationError:
        return None


def current(raw: Any, marked: str) -> UnderstandingBasis | None:
    """The stored record, only while the attribute still reads as it did when the record was
    written: a wording or criteria changed since (by a person or another agent) is no longer
    explained by it."""
    held = read(raw)
    if held is None or held.mark != marked:
        return None
    return UnderstandingBasis(
        follows=held.follows,
        sets_aside=held.sets_aside,
        summary=held.summary,
        by=held.by,
        recorded_at=held.recorded_at,
    )


def audit_entry(record: Followed) -> dict[str, Any]:
    """The record as the run's audit event carries it: which fact (its kind, key and date),
    the agent's statements and its sentence. The client's own words for the question and the
    answer stay in their rows and are not copied into the audit trail (as
    walkthrough_answers' own audit records do not copy a free-text answer)."""
    entry = record.model_dump(mode="json")
    entry["follows"].pop("question", None)
    entry["follows"].pop("answer", None)
    return entry


def confirmed_by_a_person(found: tuple[Fact, ...]) -> bool:
    """Whether a confirmed understanding is on record: a person confirmed at least one fact.
    Values the records filled in by themselves are not a person's understanding yet."""
    return any(fact.confirmed_by == "PERSON" for fact in found)


# The guard on what the attribute agent raises (rules 4 and 5). No model in it.

# The issue's own words name the understanding as a side.
_CITES = re.compile(
    r"\bcontrol understanding\b|\bconfirmed understanding\b"
    r"|\bwalkthrough (answer|question|response)s?\b"
    r"|\b(team|client|auditor|person|owner)(['’]s)? (earlier |later |confirmed )?answers?\b"
    r"|\b(answered|earlier|older|newer) (question|answer)s?\b"
    r"|\bconfirmed (answer|value|fact)s?\b"
    r"|\bconfirmed_understanding\b|\banswered_questions\b|\bwalkthrough_answers\b",
    re.IGNORECASE,
)
# "The walkthrough says" names the understanding, unless walkthrough notes are a quoted source.
_WALKTHROUGH_SAYS = re.compile(
    r"\b(the )?walkthrough (says|said|states|stated|confirms|confirmed|shows|showed|records"
    r"|recorded|indicates|indicated)\b",
    re.IGNORECASE,
)
_DISAGREES = re.compile(
    r"\b(conflict|contradict|disagree|inconsisten|differ|whereas|does not match"
    r"|do not match|mismatch)",
    re.IGNORECASE,
)
# An answer long enough that finding its words in an issue means the issue is about it. A
# client value is never read this way: it is often the name of a policy, a tool or a role,
# which a conflict between two documents may name too.
_QUOTED_ANSWER, _QUOTED_WORDS = 25, 4


def _plain(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _names_understanding(text: str, quoted: list[Source], found: tuple[Fact, ...]) -> bool:
    if _CITES.search(text):
        return True
    notes_quoted = any(source.kind == "WALKTHROUGH" for source in quoted)
    if not notes_quoted and _WALKTHROUGH_SAYS.search(text):
        return True
    plain = f" {_plain(text)} "
    for fact in found:
        if fact.kind == "CONTROL_VALUE":
            continue
        answer = _plain(fact.answer)
        if (
            len(answer) >= _QUOTED_ANSWER
            and len(answer.split()) >= _QUOTED_WORDS
            and f" {answer} " in plain
        ):
            return True
    return False


def not_raised(item: AnswerIssue, sources: list[Source], found: tuple[Fact, ...]) -> str:
    """Why an issue the attribute agent returned is not raised, or "" when it is.

    A CONFLICT is raised only when it quotes two distinct sources, in their own words, and
    no side of it is the understanding: no confirmed fact is named as covering it
    (covered_by), its own words do not cite the understanding or repeat a confirmed answer,
    and it does not quote the approved narrative (which a person approved as how the control
    runs). With a confirmed understanding on record, a conflict that cannot point to two
    sources is a source against the understanding, which rule 1 settles. A MISSING or
    AMBIGUOUS fact is not raised when a confirmed fact is named as covering it, or (for
    AMBIGUOUS) when it describes a disagreement with the understanding."""
    refs = {fact.ref for fact in found}
    covered = [ref.strip() for ref in item.covered_by if ref.strip() in refs]
    cited = [
        quote
        for raw in item.quotes[:3]
        if (quote := check_quote(sources, raw.source, raw.quote)) is not None
    ]
    distinct = {quote.source for quote in cited}
    quoted = [source for source in sources if source.key in distinct]
    text = " ".join([item.topic, item.detail, item.why, item.resolve])
    if covered:
        return (
            f"A confirmed fact covers it ({', '.join(covered[:3])}): the agents follow the "
            "understanding."
        )
    if item.kind != "CONFLICT":
        if (
            item.kind == "AMBIGUOUS"
            and _DISAGREES.search(text)
            and _names_understanding(text, quoted, found)
        ):
            return "It is a difference with the confirmed understanding, which holds."
        return ""
    if NARRATIVE_SOURCE in distinct:
        return "One side is the approved narrative, which is the understanding: it holds."
    if _names_understanding(text, quoted, found):
        return "One side is a confirmed answer: the understanding holds, the newer answer first."
    if len(distinct) >= 2:
        return ""
    if confirmed_by_a_person(found):
        return (
            "It does not quote two distinct sources: with a confirmed understanding on "
            "record, the difference is with the understanding, which holds."
        )
    return ""


def is_conflict(item: AnswerIssue, sources: list[Source]) -> bool:
    """Whether a CONFLICT that is raised stands as one: it quotes two distinct sources."""
    return (
        len(
            {
                quote.source
                for raw in item.quotes[:3]
                if (quote := check_quote(sources, raw.source, raw.quote)) is not None
            }
        )
        >= 2
    )


def side_statements(item: AnswerIssue, sources: list[Source]) -> tuple[str, ...]:
    """One plain statement per side of a conflict, for a person to pick (rule 6): the
    agent's, when it gave one per side; otherwise each quoted source in its own words."""
    said = [
        text
        for text in (line(value, STATEMENT_LIMIT) for value in item.suggestions[:3])
        if text and not contains_secret({"statement": text})
    ]
    said = list(dict.fromkeys(said))
    if len(said) >= 2:
        return tuple(said)
    sides: dict[str, str] = {}
    for raw in item.quotes[:3]:
        quote = check_quote(sources, raw.source, raw.quote)
        if quote is not None and quote.source not in sides:
            words = quote.quote.rstrip(". ")
            sides[quote.source] = line(f"{quote.title} says: {words}.", STATEMENT_LIMIT)
    return tuple(sides.values())


def settled_before(
    kind: str, topic: str, detail: str, why: str, resolve: str, quotes: Any,
    found: tuple[Fact, ...],
) -> bool:  # fmt: skip
    """Whether an open CONFLICT an earlier run raised is one these rules would not raise,
    read from the stored row alone: it quotes fewer than two distinct sources while a
    confirmed understanding is on record, it quotes the approved narrative, or its own words
    name the understanding as a side. Understanding on record means a person confirmed at
    least one fact (confirmed_by_a_person)."""
    if kind != "CONFLICT":
        return False
    distinct = {
        str(quote.get("source", ""))
        for quote in (quotes if isinstance(quotes, list) else [])
        if isinstance(quote, dict)
    }
    if NARRATIVE_SOURCE in distinct:
        return True
    if _names_understanding(" ".join([topic, detail, why, resolve]), [], found):
        return True
    return len(distinct) < 2 and confirmed_by_a_person(found)
