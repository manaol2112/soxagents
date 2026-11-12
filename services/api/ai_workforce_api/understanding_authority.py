"""The confirmed Control Understanding is the authority (decided by the product owner on 12
November 2026; docs/control-workflow-plan.md, B1e: "since I've finalized the control
understanding, shouldn't the attribute just follow what control understanding says so I
won't get any conflict like this?"; and, on two answers inside it that disagree: "Yes. Newer
answer wins.").

What the understanding is: every confirmed walkthrough answer that stands
(walkthrough_answers.stands), every client value of the control's statement
(control_parameters), and every answer to an agent's earlier question (a resolved or
dismissed control_context_issues row; its note is the answer). Each is a fact with when it
was confirmed and by what (`facts`): PERSON when a person confirmed it, RECORDS when the
records filled it in or the system settled it by itself (never presented as a person's
confirmation). The agents are given them newest first, each under a ref their answer can
name (`for_agents`).

The rules the agents are told, and what the server checks:

1. Where the RCM record, a library attribute's wording or an approved attribute's wording or
   criteria differ from the understanding, the agents follow the understanding.
2. Where two confirmed facts disagree on the same matter, the one confirmed later holds; a
   RECORDS fact never overrides a PERSON fact. No row is deleted or rewritten.
3. An agent that follows a fact over something else says so in structured output (`Follows`).
   The server checks it (`recorded`): the ref must be a fact on record, something must be
   set aside, every older answer set aside must be a fact on record that the followed fact
   holds over (a proposal that follows the weaker fact is left out, and listed), and the
   kinds, dates and the answer as recorded come from the records, never from the agent. The
   record is kept on the attribute it explains (control_attributes.understanding_basis,
   migration 0149) with a mark of the attribute's words and of each fact it names, and is
   given back only while both still read that way (`current`). It is a statement by the
   agent that wrote it; it buys no exemption from any reviewer or check.
4. A CONFLICT the attribute agent returns is left unraised only in three narrow cases
   (`not_raised`, no model in it); anything else is raised, and a missing or ambiguous fact
   always is. Nothing left unraised is lost: the run's audit record keeps it whole.

Everything here reads; the writes are in control_attributes.generate.
"""

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel, Field, ValidationError

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.control_context import (
    CONTROL_SOURCE,
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
# The note on an open conflict the agent's next run closes because these rules settle it.
SETTLED_NOTE = (
    "Settled by the confirmed understanding: the agents follow it, and where two confirmed "
    "answers disagree the newer answer holds."
)
DEFAULT_SUMMARY = "The attribute follows the confirmed understanding over what it sets aside."

# The paragraph every agent that reads the understanding is given (rule 8): the attribute
# agent, the reviewer of its drafts, the reviewer of the set, the planner, and the
# narrative's drafter and reviewer. It states the precedence and nothing else: it takes no
# check away from any reviewer.
PRECEDENCE = (
    "confirmed_understanding is how this control runs at this client, as it was confirmed: "
    "every confirmed walkthrough answer, client value and answer to an earlier question, each "
    "with a ref, its kind, when it was confirmed (confirmed_at) and by what (confirmed_by: "
    "PERSON, or RECORDS when the records filled it in and no person confirmed it), newest "
    "first. It is the authority. Where the control's RCM record, a library standard's "
    "wording, or an approved attribute's wording or criteria say something else (another "
    "system, record, approver or timing), follow confirmed_understanding. Where two of its "
    "facts disagree on the same matter, the one with the later confirmed_at holds and the "
    "earlier one is treated as replaced; a RECORDS fact is never a person's confirmation and "
    "never overrides a PERSON fact, whatever its date. Such a difference is not, by itself, a "
    "conflict or a question for a person."
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
    # PERSON: a person gave or confirmed it. RECORDS: the records filled it in, or the
    # system settled the question by itself (no person is recorded).
    confirmed_by: ConfirmedBy


def iso(at: datetime | None) -> str | None:
    return None if at is None else at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def facts(connection: psycopg.Connection[Any], control_id: UUID) -> tuple[Fact, ...]:
    """The confirmed understanding of the control, newest first: the walkthrough answers that
    stand to the questions asked now (as walkthrough_answers.for_agents), the client values
    of its statement, and the answers to the agents' earlier questions.

    PERSON is said only where a person is on record: a walkthrough answer a person saved
    (source PERSON; a confirmed answer always names who), a client value with filled_by, an
    issue with resolved_by. A value the records filled in and an issue the system resolved by
    itself (library_definitions' settled design confirmations, the migrations' backfills)
    have no person and are RECORDS."""
    from ai_workforce_api.control_design import design_for
    from ai_workforce_api.walkthrough_answers import answers_of, questions_asked, stands

    found: list[tuple[FactKind, str, str, str, datetime | None, ConfirmedBy]] = []
    rows = answers_of(connection, control_id)
    answered = {
        str(key): (at, by is not None)
        for key, at, by in connection.execute(
            "SELECT question_key, answered_at, answered_by FROM control_walkthrough_answers "
            "WHERE engagement_control_id = %s AND status = 'CONFIRMED'",
            (control_id,),
        ).fetchall()
    }
    for item in questions_asked(connection, control_id, rows):
        row = rows.get(item.key)
        if row is None or not stands(row, item) or row.not_applicable:
            continue
        at, named = answered.get(item.key, (None, False))
        found.append(
            ("WALKTHROUGH_ANSWER", item.key, item.text, row.value, at,
             "PERSON" if row.source == "PERSON" and named else "RECORDS")
        )  # fmt: skip
    design = design_for(connection, control_id)
    if design is not None:
        filled = {
            str(key)
            for (key,) in connection.execute(
                "SELECT slot_key FROM control_parameters WHERE engagement_control_id = %s "
                "AND filled_by IS NOT NULL",
                (control_id,),
            ).fetchall()
        }
        for slot in design.slots:
            if slot.automatic or not slot.value.strip():
                continue
            found.append(
                ("CONTROL_VALUE", slot.key, slot.question or slot.label, slot.value,
                 slot.filled_at, "PERSON" if slot.key in filled else "RECORDS")
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
    ordered = sorted(found, key=lambda item: item[4] or oldest, reverse=True)
    return tuple(
        Fact(
            ref=f"U{index}",
            kind=kind,
            key=key,
            question=line(question, QUESTION_LIMIT),
            answer=line(answer, ANSWER_LIMIT),
            confirmed_at=at,
            confirmed_by=by,
        )
        for index, (kind, key, question, answer, at, by) in enumerate(ordered, start=1)
    )


def for_agents(found: tuple[Fact, ...], answer_limit: int = ANSWER_LIMIT) -> list[dict[str, Any]]:
    """The facts as an agent's prompt carries them, newest first (the newest MAX_FACTS).
    Client-provided data."""
    return [
        {
            "ref": fact.ref,
            "kind": fact.kind,
            "question": fact.question,
            "answer": fact.answer[:answer_limit],
            "confirmed_at": iso(fact.confirmed_at),
            "confirmed_by": fact.confirmed_by,
        }
        for fact in found[:MAX_FACTS]
    ]


def confirmed_by_a_person(found: tuple[Fact, ...]) -> bool:
    """Whether a person confirmed at least one fact. Values the records filled in by
    themselves are not a person's understanding."""
    return any(fact.confirmed_by == "PERSON" for fact in found)


def holds_over(fact: Fact, other: Fact) -> bool:
    """Whether `fact` holds where the two disagree: a person's fact over one the records
    filled in; otherwise the one confirmed later (an undated fact is the oldest)."""
    if fact.confirmed_by != other.confirmed_by:
        return fact.confirmed_by == "PERSON"
    oldest = datetime.min.replace(tzinfo=UTC)
    return (fact.confirmed_at or oldest) >= (other.confirmed_at or oldest)


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


def source_times(
    connection: psycopg.Connection[Any], control_id: UUID, sources: list[Source]
) -> dict[str, datetime]:
    """When each source last changed, by its key: the control's record (its last update),
    and each document (created, updated, or linked to this control, whichever is latest). A
    source with no time on record is left out, and is then never taken to be older than
    anything."""
    times: dict[str, datetime] = {}
    row = connection.execute(
        "SELECT updated_at FROM engagement_controls WHERE id = %s", (control_id,)
    ).fetchone()
    if row is not None and row[0] is not None:
        times[CONTROL_SOURCE] = row[0]
    ids: list[UUID] = []
    for source in sources:
        try:
            ids.append(UUID(source.key))
        except ValueError:
            continue
    if ids:
        for document_id, created, updated, linked in connection.execute(
            """
            SELECT d.id, d.created_at, d.updated_at,
                   (SELECT max(l.linked_at) FROM source_document_controls l
                    WHERE l.document_id = d.id AND l.engagement_control_id = %s)
            FROM source_documents d WHERE d.id = ANY(%s)
            """,
            (control_id, ids),
        ).fetchall():
            known = [at for at in (created, updated, linked) if at is not None]
            if known:
                times[str(document_id)] = max(known)
    return times


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


def follows_said(raw: Any) -> Follows | None:
    """An agent's `follows` as it gave it, or None when it does not fit (a ref too long, more
    than three things set aside, another shape): only the statement is discarded, never the
    proposal it came with or anything else of the agent's answer."""
    if isinstance(raw, Follows):
        return raw
    if not isinstance(raw, dict):
        return None
    try:
        return Follows.model_validate(raw)
    except ValidationError:
        return None


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
                    },
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


class BasisFact(BaseModel):
    """The confirmed fact an attribute follows, as the records hold it."""

    kind: FactKind
    key: str = Field(default="", max_length=80)
    question: str = Field(default="", max_length=QUESTION_LIMIT)
    # The answer as recorded: what was confirmed. Never the agent's words.
    answer: str = Field(default="", max_length=ANSWER_LIMIT)
    confirmed_at: datetime | None = None
    confirmed_by: ConfirmedBy = "PERSON"
    # The agent's own summary of the fact; may be empty.
    statement: str = Field(default="", max_length=STATEMENT_LIMIT)


class BasisSetAside(BaseModel):
    """One thing set aside. For OLDER_ANSWER the older fact as the records hold it; for the
    RCM record, the library wording or the approved attribute, the agent's words for it."""

    kind: SetAsideKind
    # The agent's words for what was set aside; may be empty for an OLDER_ANSWER.
    statement: str = Field(default="", max_length=STATEMENT_LIMIT)
    fact_kind: FactKind | None = None
    key: str = Field(default="", max_length=80)
    question: str = Field(default="", max_length=QUESTION_LIMIT)
    answer: str = Field(default="", max_length=ANSWER_LIMIT)
    confirmed_at: datetime | None = None
    confirmed_by: ConfirmedBy | None = None


class UnderstandingBasis(BaseModel):
    """What the attribute API gives: what an agent followed and set aside. The agent's
    statement, checked against the records; never a person's decision."""

    follows: BasisFact
    sets_aside: list[BasisSetAside]
    # The agent's one sentence.
    summary: str
    # The agent that wrote it (its roster key), and when.
    by: str
    recorded_at: datetime


class _StoredFact(BasisFact):
    # A mark of the fact as it was on record (fact_mark): its kind, key, date and answer.
    fact_mark: str = Field(pattern=r"^[0-9a-f]{64}$")


class _StoredSetAside(BasisSetAside):
    fact_mark: str = Field(default="", pattern=r"^([0-9a-f]{64})?$")


class Followed(BaseModel):
    """What an agent followed and what it set aside, checked against the records."""

    follows: _StoredFact
    sets_aside: list[_StoredSetAside] = Field(min_length=1, max_length=3)
    summary: str = Field(min_length=1, max_length=300)


class StoredBasis(Followed):
    """control_attributes.understanding_basis, as written and as read: the record, the agent
    and the model call that wrote it, and a mark of the wording and criteria it explains."""

    by: str = Field(max_length=60)
    model_call: UUID | None = None
    prompt_version: str = Field(default="", max_length=60)
    recorded_at: datetime
    mark: str = Field(pattern=r"^[0-9a-f]{64}$")


def mark(text: Any, condition: Any, passes: Any, fails: Any, judgment: Any) -> str:
    """A hash of an attribute's wording and criteria (as attribute_review._mark)."""
    data = json.dumps(
        [str(text or ""), str(condition or ""), str(passes or ""), str(fails or ""),
         bool(judgment)],
        ensure_ascii=False,
    )  # fmt: skip
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def fact_mark(fact: Fact) -> str:
    """A hash of a fact as it is on record: its kind, key, confirmation time and answer. A
    fact answered again, at another time or with another answer, has another mark."""
    at = "" if fact.confirmed_at is None else fact.confirmed_at.astimezone(UTC).isoformat()
    data = json.dumps([fact.kind, fact.key, at, fact.answer], ensure_ascii=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def recorded(said: Follows | None, found: tuple[Fact, ...]) -> tuple[Followed | None, bool]:
    """The agent's statement checked against the records: the record to keep (None when it
    names no fact on record, sets nothing aside, or holds a secret), and whether it follows
    the weaker of two confirmed facts (an older answer over a newer one, or a fact the
    records filled in over a person's), which rule 2 forbids. The fact, its date, who
    confirmed it and its answer are taken from the records."""
    if said is None:
        return None, False
    by_ref = {fact.ref: fact for fact in found}
    fact = by_ref.get(said.fact.strip())
    if fact is None:
        return None, False
    aside: list[_StoredSetAside] = []
    for item in said.sets_aside[:3]:
        statement = line(item.statement, STATEMENT_LIMIT)
        if item.kind != "OLDER_ANSWER":
            if statement:
                aside.append(_StoredSetAside(kind=item.kind, statement=statement))
            continue
        older = by_ref.get(item.fact.strip())
        if older is None or older.ref == fact.ref:
            continue
        if not holds_over(fact, older):
            return None, True
        aside.append(
            _StoredSetAside(
                kind="OLDER_ANSWER",
                statement=statement,
                fact_kind=older.kind,
                key=older.key,
                question=older.question,
                answer=older.answer,
                confirmed_at=older.confirmed_at,
                confirmed_by=older.confirmed_by,
                fact_mark=fact_mark(older),
            )
        )
    if not aside:
        return None, False
    statement = line(said.statement, STATEMENT_LIMIT)
    summary = line(said.why, 300) or DEFAULT_SUMMARY
    texts = {"statement": statement, "summary": summary,
             "aside": " ".join(item.statement for item in aside)}  # fmt: skip
    if contains_secret(texts):
        return None, False
    return (
        Followed(
            follows=_StoredFact(
                kind=fact.kind,
                key=fact.key,
                question=fact.question,
                answer=fact.answer,
                confirmed_at=fact.confirmed_at,
                confirmed_by=fact.confirmed_by,
                statement=statement,
                fact_mark=fact_mark(fact),
            ),
            sets_aside=aside,
            summary=summary,
        ),
        False,
    )


def weaker_followed(said: Follows | None, found: tuple[Fact, ...]) -> dict[str, Any]:
    """For the audit record of a proposal left out because it followed the weaker fact:
    which fact it followed and which it set aside, each by kind, key, date and who."""
    by_ref = {fact.ref: fact for fact in found}

    def identity(ref: str) -> dict[str, Any] | None:
        fact = by_ref.get(ref.strip())
        if fact is None:
            return None
        return {"kind": fact.kind, "key": fact.key, "confirmed_at": iso(fact.confirmed_at),
                "confirmed_by": fact.confirmed_by}  # fmt: skip

    if said is None:
        return {}
    return {
        "followed": identity(said.fact),
        "over": [
            found_fact
            for item in said.sets_aside[:3]
            if item.kind == "OLDER_ANSWER" and (found_fact := identity(item.fact)) is not None
        ],
    }


def stored(
    record: Followed, by: str, call_id: UUID | None, prompt_version: str, marked: str
) -> dict[str, Any]:
    """The record as it is kept on the attribute it explains, with the agent and the model
    call that wrote the statement it rests on."""
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


def current(raw: Any, marked: str, found: tuple[Fact, ...]) -> UnderstandingBasis | None:
    """The stored record, only while it is still true: the attribute reads as it did when
    the record was written (its wording and criteria), the fact it follows still stands as
    it was recorded (not withdrawn, not answered again at another time or with another
    answer), and so does every older answer it sets aside, which the followed fact must
    still hold over. Otherwise None: nothing is shown for words or facts that changed."""
    held = read(raw)
    if held is None or held.mark != marked:
        return None
    standing = {(fact.kind, fact.key): fact for fact in found}
    fact = standing.get((held.follows.kind, held.follows.key))
    if fact is None or fact_mark(fact) != held.follows.fact_mark:
        return None
    for item in held.sets_aside:
        if item.kind != "OLDER_ANSWER" or item.fact_kind is None:
            continue
        older = standing.get((item.fact_kind, item.key))
        if older is None or fact_mark(older) != item.fact_mark or not holds_over(fact, older):
            return None
    return UnderstandingBasis(
        follows=BasisFact(**held.follows.model_dump(exclude={"fact_mark"})),
        sets_aside=[
            BasisSetAside(**item.model_dump(exclude={"fact_mark"})) for item in held.sets_aside
        ],
        summary=held.summary,
        by=held.by,
        recorded_at=held.recorded_at,
    )


def audit_entry(record: Followed) -> dict[str, Any]:
    """The record as the run's audit event carries it: which fact (its kind, key, date, who
    confirmed it and its mark), the agent's statements and its sentence. The client's own
    words for the questions and the answers stay in their rows and are not copied into the
    audit trail (as walkthrough_answers' own audit records do not copy a free-text answer);
    the mark says which answer it was."""
    entry = record.model_dump(mode="json")
    for item in (entry["follows"], *entry["sets_aside"]):
        item.pop("question", None)
        item.pop("answer", None)
    return entry


# The guard on what the attribute agent raises (rule 4). No model in it.

# The issue's own words name the understanding as a side. Read only for a conflict that
# cannot point to two sources (see not_raised): never a reason to drop one that can.
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
# An answer long enough that finding its words in an issue means the issue is about it. A
# client value is never read this way: it is often the name of a policy, a tool or a role.
_QUOTED_ANSWER, _QUOTED_WORDS = 25, 4


def _plain(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _names_understanding(text: str, quoted_kinds: set[str], found: tuple[Fact, ...]) -> bool:
    """Whether the issue's own words show a confirmed fact is one of its sides: they cite
    the understanding, or repeat a person's confirmed answer word for word."""
    if _CITES.search(text):
        return True
    if "WALKTHROUGH" not in quoted_kinds and _WALKTHROUGH_SAYS.search(text):
        return True
    plain = f" {_plain(text)} "
    for fact in found:
        if fact.kind == "CONTROL_VALUE" or fact.confirmed_by != "PERSON":
            continue
        answer = _plain(fact.answer)
        if (
            len(answer) >= _QUOTED_ANSWER
            and len(answer.split()) >= _QUOTED_WORDS
            and f" {answer} " in plain
        ):
            return True
    return False


def _conflict_dropped(
    text: str,
    distinct: set[str],
    covered: list[str],
    sources: list[Source],
    found: tuple[Fact, ...],
    narrative_at: datetime | None,
    times: Mapping[str, datetime],
) -> str:
    """Why a CONFLICT with these verified sources is left unraised, or "" when it is raised.
    One rule for what the agent returns now (not_raised) and for what an earlier run left
    open (settled_before)."""
    # With nothing confirmed there is no understanding to prefer: nothing is dropped.
    if not found:
        return ""
    if covered:
        return (
            f"The agent named a confirmed fact that settles it ({', '.join(covered[:3])}): "
            "the understanding holds."
        )
    others = distinct - {NARRATIVE_SOURCE}
    # Two sources, each quoted in its own words: always raised, whatever its wording.
    if len(others) >= 2:
        return ""
    if NARRATIVE_SOURCE in distinct and len(others) == 1:
        # The approved narrative against one source. The narrative holds over a source that
        # has not changed since a person approved it; a source added or changed after the
        # approval is a later fact, and the conflict is raised.
        changed = times.get(next(iter(others)))
        if narrative_at is not None and changed is not None and changed <= narrative_at:
            return (
                "One side is the approved narrative, approved after the other source last "
                "changed: the narrative holds."
            )
        return ""
    # It cannot point to two sources. It is a difference with the understanding only when
    # its own words show a confirmed fact is one of its sides; otherwise it is not dropped.
    kinds = {source.kind for source in sources if source.key in distinct}
    if confirmed_by_a_person(found) and _names_understanding(text, kinds, found):
        return (
            "It quotes fewer than two sources and its own words name a confirmed answer as "
            "the other side: the understanding holds."
        )
    return ""


def verified_sources(item: AnswerIssue, sources: list[Source]) -> set[str]:
    """The distinct sources the issue quotes in words found in them."""
    return {
        quote.source
        for raw in item.quotes[:3]
        if (quote := check_quote(sources, raw.source, raw.quote)) is not None
    }


def not_raised(
    item: AnswerIssue,
    sources: list[Source],
    found: tuple[Fact, ...],
    narrative_at: datetime | None = None,
    times: Mapping[str, datetime] | None = None,
) -> str:
    """Why an issue the attribute agent returned is not raised, or "" when it is.

    A MISSING or AMBIGUOUS fact is always raised: an agent that believes a confirmed fact
    settles the matter does not raise the issue, and if it raised one a person sees it.

    A CONFLICT is left unraised in three cases only, and never when nothing is confirmed:
    the agent named, in covered_by, a fact a person confirmed that settles it; it quotes the
    approved narrative against one source that has not changed since the narrative was
    approved; or it quotes fewer than two sources and its own words name a confirmed answer
    as the other side (a person having confirmed at least one fact). A conflict that quotes
    two sources other than the narrative is always raised, whatever its wording, unless the
    agent named the fact that settles it. One that quotes fewer than two and is not dropped
    is raised as ambiguity by the caller."""
    if item.kind != "CONFLICT":
        return ""
    by_person = {fact.ref for fact in found if fact.confirmed_by == "PERSON"}
    covered = list(
        dict.fromkeys(ref.strip() for ref in item.covered_by if ref.strip() in by_person)
    )
    return _conflict_dropped(
        " ".join([item.topic, item.detail, item.why, item.resolve]),
        verified_sources(item, sources),
        covered,
        sources,
        found,
        narrative_at,
        times or {},
    )


def is_conflict(item: AnswerIssue, sources: list[Source]) -> bool:
    """Whether a CONFLICT that is raised stands as one: it quotes two distinct sources."""
    return len(verified_sources(item, sources)) >= 2


def side_statements(item: AnswerIssue, sources: list[Source]) -> tuple[str, ...]:
    """One plain statement per side of a conflict, for a person to pick (rule 6): the
    agent's, only when it gave exactly one per source the conflict quotes; otherwise each
    quoted source in its own words."""
    sides: dict[str, str] = {}
    for raw in item.quotes[:3]:
        quote = check_quote(sources, raw.source, raw.quote)
        if quote is not None and quote.source not in sides:
            words = quote.quote.rstrip(". ")
            sides[quote.source] = line(f"{quote.title} says: {words}.", STATEMENT_LIMIT)
    said = list(
        dict.fromkeys(
            text
            for text in (line(value, STATEMENT_LIMIT) for value in item.suggestions[:3])
            if text and not contains_secret({"statement": text})
        )
    )
    if sides and len(said) == len(sides):
        return tuple(said)
    return tuple(sides.values())


def settled_before(
    kind: str,
    text: str,
    quotes: Any,
    sources: list[Source],
    found: tuple[Fact, ...],
    narrative_at: datetime | None,
    times: Mapping[str, datetime],
) -> str:
    """Why an open CONFLICT an earlier run raised is one these rules leave unraised, read
    from the stored row alone (its words and the sources it quotes), or "" when the rules
    would raise it. The same test as for a conflict returned now; an agent's covered_by is
    not on the row, so it is not read here."""
    if kind != "CONFLICT":
        return ""
    distinct = {
        str(quote.get("source", ""))
        for quote in (quotes if isinstance(quotes, list) else [])
        if isinstance(quote, dict) and quote.get("source")
    }
    return _conflict_dropped(text, distinct, [], sources, found, narrative_at, times)
