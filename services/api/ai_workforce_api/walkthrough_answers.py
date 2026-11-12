"""Walkthrough answers (decided by the product owner on 11 November 2026; migration 0147).

The walkthrough question bank (walkthrough_questions.py) holds what a senior IT auditor asks
to understand a control; this module holds the client's answers to it, one row per control
and question (control_walkthrough_answers):

- A person's answer is CONFIRMED (source PERSON), saved through `save`, which checks every
  answer against its question: an offered option for a choice, "Yes" or "No", a plain-text
  answer of at most 1,000 characters with no credential in it. An optional question may be
  marked not applicable, with no value; a required one may not. A choice that allows it also
  takes one answer its options do not offer, "Other: <text>" (the last part of a MULTI
  answer; product owner, 11 November 2026), kept with its prefix in the bank's spelling and
  confirmed, counted, narrated and given to the agents like any other answer.
- The engagement planner's reading of walkthrough notes is PROPOSED (source AGENT), with the
  exact words of the notes it rests on (`propose`). A proposal never replaces a confirmed
  answer, and a proposal is never counted as an answer: a person confirms it by saving it.
- Which questions are asked (`asked`, `questions_asked`): the bank's questions for the
  control's library key, nature and frequency, with a follow-up asked only once its parent's
  CONFIRMED answer contains the value it follows. Decided here: only confirmed answers reveal
  follow-ups, everywhere (the review, the gate, the save's check), so the questions the
  review lists are always the ones the gate counts. A proposed parent answer shows its
  follow-ups once a person confirms it. A save may answer a parent and its follow-ups
  together: the answers being saved count as confirmed for that check.
- A follow-up whose parent's answer changed so that it no longer applies keeps its row (the
  answer stays on record, with its audit trail), but it is no longer asked, counted by the
  gate, or given to the agents.
- Only REQUIRED asked questions hold "Control Understanding complete"
  (phase_release.understanding_waits, through `unanswered_required`); optional ones are
  asked but can be left.
- The confirmed answers are the control environment the planner and the tester read
  (`for_agents`), as client-provided data, never instructions.
- The questions are asked in the bank's asking order (`questions_for`: chronological, a
  follow-up after its parent), and everything here keeps it: the review, the agents' inputs
  and the understanding's narrative (`confirmed_answers`, read by walkthrough_questions.narrate;
  product owner, 11 November 2026).
- An answer on record to a question the bank no longer has (a question removed when the
  bank was trimmed) keeps its row, with its audit trail, but is read nowhere: everything
  reads answers through the questions asked now, so it is not asked, counted by the gate,
  given to the agents or narrated.
- One rule says whether an answer on record stands (`stands`, read by every path: what is
  asked, the gate, the review, the narrative, the agents; 11 November 2026): it is
  CONFIRMED, its question is in the bank, and it is still a valid answer to that question
  as the bank asks it now. A confirmed answer under an option the bank has since reworded
  (or a required question marked not applicable) does not stand: it is MISSING in the
  review (its old value shown for context), counted unanswered by the gate, opens no
  follow-up, and is neither narrated nor given to the agents. Its row stays, with its
  audit trail, until a person answers the question again.
- A save may carry a follow-up the same save closes (the web sends a topic's answers at
  once, and a person may change the parent after typing the follow-up): a follow-up whose
  parent this save answers with a value that does not open it, or whose parent is itself
  so ignored, is ignored (not saved, not an error), and the save says how many were
  (`ignored`). Every other answer to a question not asked still refuses the whole save.
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any
from uuid import UUID

import psycopg
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.control_context import ContextState
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.walkthrough_questions import (
    ANSWER_LIMIT,
    JOIN,
    KEY,
    OTHER,
    OTHER_MAX,
    OTHER_MIN,
    YES_NO,
    Question,
    applicable,
    is_other,
    other_text,
    question,
    questions_for,
    valid_answer,
)

QUOTE_LIMIT = 500
# The most of one answer an agent's prompt carries.
PROMPT_ANSWER_LIMIT = 500
MAX_ANSWERS = 40
AGENT = "engagement-planner"


class AnswerRefused(Exception):
    """A 422: an answer does not fit its question. The detail says why, in a sentence."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True)
class Row:
    key: str
    value: str
    not_applicable: bool
    status: str
    source: str
    quote: str
    version: int


class AnswerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str = Field(max_length=ANSWER_LIMIT)
    not_applicable: bool = False


QuestionKey = Annotated[str, StringConstraints(pattern=KEY.pattern)]


class AnswersBody(BaseModel):
    """The answers of one save: a topic's at once, with room for follow-ups."""

    model_config = ConfigDict(extra="forbid")

    answers: dict[QuestionKey, AnswerIn] = Field(min_length=1, max_length=MAX_ANSWERS)


class SavedBody(BaseModel):
    # How many answers are on record as given (unchanged ones included).
    saved: int
    # How many follow-ups of this save were ignored: the save's own answer to their parent
    # does not open them (they no longer apply), so they are not saved.
    ignored: int = 0


# Reading


def answers_of(connection: psycopg.Connection[Any], control_id: UUID) -> dict[str, Row]:
    """Every answer on record for the control, confirmed or proposed, by question key."""
    return {
        str(row[0]): Row(
            key=str(row[0]),
            value=str(row[1]),
            not_applicable=bool(row[2]),
            status=str(row[3]),
            source=str(row[4]),
            quote=str(row[5]),
            version=int(row[6]),
        )
        for row in connection.execute(
            "SELECT question_key, value, not_applicable, status, source, source_quote, version "
            "FROM control_walkthrough_answers WHERE engagement_control_id = %s",
            (control_id,),
        ).fetchall()
    }


def stands(row: Row | None, item: Question | None = None) -> bool:
    """Whether an answer on record stands as the answer to its question (`item`, or the
    bank's question of the row's key): the one rule every reader applies. It stands when a
    person confirmed it, its question is in the bank, and it is still valid for that
    question as the bank asks it now (walkthrough_questions.valid_answer): a confirmed
    answer under an option since reworded does not. Not applicable stands only for an
    optional question. A proposal never stands."""
    if row is None or row.status != "CONFIRMED":
        return False
    question_now = item if item is not None else question(row.key)
    if question_now is None or question_now.key != row.key:
        return False
    if row.not_applicable:
        return not question_now.required
    return valid_answer(question_now, row.value)


def confirmed_values(rows: Mapping[str, Row]) -> dict[str, str]:
    """The answers that stand, by key, as `applicable` reads them ("" when not applicable)."""
    return {key: row.value for key, row in rows.items() if stands(row)}


@lru_cache(maxsize=1024)
def _bank(library_key: str, nature: str, frequency: str) -> tuple[Question, ...]:
    return questions_for(library_key, nature, frequency)


def asked(
    library_key: str, nature: str, frequency: str, confirmed: Mapping[str, str]
) -> list[Question]:
    """The questions asked for a control with these facts, given its confirmed answers."""
    return applicable(_bank(library_key, nature, frequency), confirmed)


def _facts(
    connection: psycopg.Connection[Any], control_id: UUID, *, lock: bool = False
) -> tuple[str, str, str] | None:
    row = connection.execute(
        "SELECT coalesce(library_key, ''), coalesce(nature, ''), coalesce(frequency, '') "
        "FROM engagement_controls WHERE id = %s" + (" FOR UPDATE" if lock else ""),
        (control_id,),
    ).fetchone()
    return None if row is None else (str(row[0]), str(row[1]), str(row[2]))


def questions_asked(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    rows: Mapping[str, Row] | None = None,
) -> list[Question]:
    """The walkthrough questions asked for the control now, in the bank's asking order."""
    facts = _facts(connection, control_id)
    if facts is None:
        return []
    held = answers_of(connection, control_id) if rows is None else rows
    return asked(*facts, confirmed_values(held))


def confirmed_answers(questions: Sequence[Question], rows: Mapping[str, Row]) -> dict[str, str]:
    """The answers that stand to these questions (those asked now), by key, in their order:
    "" for a question marked not applicable. A proposal is not an answer, an answer no
    longer valid for its question does not stand (`stands`), and an answer on record to a
    question not asked (a follow-up whose parent changed, a question the bank no longer
    has) is left out."""
    return {
        item.key: rows[item.key].value for item in questions if stands(rows.get(item.key), item)
    }


def standing_answers(
    library_key: str, nature: str, frequency: str, rows: Mapping[str, Row]
) -> dict[str, str]:
    """The answers that stand to the questions a control with these facts is asked now, by
    key, in the asking order ("" for a question marked not applicable): what that control's
    walkthrough offers another system's same control to start from (11 November 2026). A
    read only, from rows already fetched."""
    return confirmed_answers(asked(library_key, nature, frequency, confirmed_values(rows)), rows)


def unanswered_required(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    controls: Iterable[tuple[UUID, str, str, str]],
    control_id: UUID | None = None,
) -> dict[UUID, int]:
    """How many required walkthrough questions each control (id, library key, nature,
    frequency) has without a confirmed answer; a control with none is left out. One query
    for the whole engagement (or the one control)."""
    params = {"p": project_id, "c": control_id}
    which = " AND engagement_control_id = %(c)s" if control_id is not None else ""
    held: dict[UUID, dict[str, Row]] = {}
    for cid, key, value, not_applicable in connection.execute(
        "SELECT engagement_control_id, question_key, value, not_applicable "
        "FROM control_walkthrough_answers WHERE project_id = %(p)s AND status = 'CONFIRMED'"
        + which,
        params,
    ).fetchall():
        held.setdefault(UUID(str(cid)), {})[str(key)] = Row(
            str(key), str(value), bool(not_applicable), "CONFIRMED", "PERSON", "", 1
        )
    found: dict[UUID, int] = {}
    for control, library_key, nature, frequency in controls:
        rows = held.get(control, {})
        count = sum(
            1
            for item in asked(library_key, nature, frequency, confirmed_values(rows))
            if item.required and not stands(rows.get(item.key), item)
        )
        if count:
            found[control] = count
    return found


def for_agents(
    connection: psycopg.Connection[Any], control_id: UUID
) -> tuple[tuple[str, str], ...]:
    """The answers that stand to the questions asked now, as (question, answer), in the
    asking order: how the control operates at this client, for the planner and the tester.
    A question marked not applicable, and an answer no longer valid for its question, are
    left out."""
    rows = answers_of(connection, control_id)
    return tuple(
        (item.text, rows[item.key].value[:PROMPT_ANSWER_LIMIT])
        for item in questions_asked(connection, control_id, rows)
        if stands(rows.get(item.key), item) and not rows[item.key].not_applicable
    )


# Checking an answer


# An Other part as a person or the planner may write it: the prefix in any case, with any
# spacing around the colon.
_OTHER_WRITTEN = re.compile(r"^other\s*:\s*", re.IGNORECASE)


def normalized(item: Question, raw: str) -> str:
    """The answer as it is kept: an option in the question's own words (case aside), the
    options of a MULTI answer joined with "; ", a plain-text answer on one line. An Other
    part of a choice is kept as "Other: <text>", its prefix in the bank's spelling and its
    text on one line (valid_answer then decides whether the question takes it)."""
    if item.kind == "TEXT":
        return clean_line(raw, ANSWER_LIMIT).strip()
    options = YES_NO if item.kind == "YES_NO" else item.options
    by_word = {option.casefold(): option for option in options}

    def one(part: str) -> str:
        part = " ".join(clean_line(part, ANSWER_LIMIT).split())
        if item.kind != "YES_NO" and part.casefold() not in by_word:
            written = _OTHER_WRITTEN.match(part)
            if written is not None:
                return OTHER + part[written.end() :]
        return by_word.get(part.casefold(), part)

    if item.kind == "MULTI":
        return JOIN.join(one(part) for part in raw.split(";"))
    return one(raw)


def _invalid(item: Question) -> str:
    other = f'"{OTHER}<text>" of {OTHER_MIN} to {OTHER_MAX} characters without ";"'
    if item.kind == "CHOICE":
        either = f", or one {other}" if item.allows_other else ""
        return f'the answer to "{item.text}" must be one of its options{either}'
    if item.kind == "MULTI":
        last = f", and at most one {other}, last" if item.allows_other else ""
        return f'the answer to "{item.text}" must be one or more of its options, each once{last}'
    if item.kind == "YES_NO":
        return f'the answer to "{item.text}" must be Yes or No'
    return f'the answer to "{item.text}" must be 1 to {ANSWER_LIMIT:,} characters'


# Saving a person's answers


def _closed_here(
    checked: Mapping[str, tuple[Question, str, bool]], open_keys: set[str]
) -> set[str]:
    """The follow-ups of a save that the same save closes, so they are ignored: a follow-up
    not asked whose parent this save answers with a value that does not open it, or whose
    parent this save carries but is itself ignored so. Anything else not asked is not here
    (the save refuses it)."""
    ignored: set[str] = set()
    grew = True
    while grew:
        grew = False
        for key, (item, _value, _not_applicable) in checked.items():
            if key in open_keys or key in ignored or item.when is None:
                continue
            parent, opens = item.when
            if parent not in checked:
                continue
            parent_value = checked[parent][1]
            parts = [part.strip() for part in parent_value.split(";") if part.strip()]
            if parent in ignored or opens not in parts:
                ignored.add(key)
                grew = True
    return ignored


def save(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: AnswersBody,
) -> SavedBody:
    """Record a person's answers, all or none, each CONFIRMED and audited. Returns how many
    answers are on record as given, and how many follow-ups the same save closed and so
    ignored (`_closed_here`). An answer equal to the one confirmed already is not written
    again. Raises AnswerRefused (422) for an answer that does not fit its question,
    ContextState (409) for any other question not asked for this control now."""
    checked: dict[str, tuple[Question, str, bool]] = {}
    for key, answer in body.answers.items():
        item = question(key)
        if item is None:
            raise AnswerRefused(f"{key} is not a walkthrough question")
        if contains_secret({key: answer.value}):
            raise AnswerRefused(
                "an answer cannot hold a password or key; record how the control works"
            )
        if answer.not_applicable:
            if item.required:
                raise AnswerRefused(
                    f'"{item.text}" is required: it cannot be marked not applicable'
                )
            if answer.value.strip():
                raise AnswerRefused("an answer marked not applicable has no value")
            checked[key] = (item, "", True)
            continue
        value = normalized(item, answer.value)
        if not valid_answer(item, value):
            raise AnswerRefused(_invalid(item))
        checked[key] = (item, value, False)
    with transaction(connection) as cursor:
        # One save at a time per control: what is asked depends on the answers on record.
        facts = _facts(cursor.connection, control_id, lock=True)
        if facts is None:
            raise ContextState("this control is not in the engagement")
        rows = answers_of(cursor.connection, control_id)
        merged = confirmed_values(rows) | {key: value for key, (_i, value, _n) in checked.items()}
        open_keys = {item.key for item in asked(*facts, merged)}
        ignored = _closed_here(checked, open_keys)
        not_asked = [key for key in checked if key not in open_keys and key not in ignored]
        if not_asked:
            count = len(not_asked)
            raise ContextState(
                f"{count} of these question{' is' if count == 1 else 's are'} not asked for "
                "this control now (a follow-up applies only to its parent's answer)"
            )
        for key, (item, value, not_applicable) in checked.items():
            if key in ignored:
                continue
            held = rows.get(key)
            if (
                held is not None
                and held.status == "CONFIRMED"
                and held.value == value
                and held.not_applicable == not_applicable
            ):
                continue
            as_proposed = held is not None and held.status == "PROPOSED" and held.value == value
            written = cursor.execute(
                """
                INSERT INTO control_walkthrough_answers (
                    organization_id, project_id, engagement_control_id, question_key, value,
                    not_applicable, status, source, source_quote, answered_by, answered_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'CONFIRMED', 'PERSON', '', %s,
                        clock_timestamp())
                ON CONFLICT (engagement_control_id, question_key) DO UPDATE
                SET value = EXCLUDED.value,
                    not_applicable = EXCLUDED.not_applicable,
                    status = 'CONFIRMED',
                    source = 'PERSON',
                    -- A proposal confirmed as proposed keeps the words it rests on.
                    source_quote = CASE
                        WHEN control_walkthrough_answers.status = 'PROPOSED'
                         AND control_walkthrough_answers.value = EXCLUDED.value
                        THEN control_walkthrough_answers.source_quote ELSE '' END,
                    answered_by = EXCLUDED.answered_by,
                    answered_at = EXCLUDED.answered_at,
                    version = control_walkthrough_answers.version + 1
                RETURNING version
                """,
                (organization_id, project_id, control_id, key, value, not_applicable, actor),
            ).fetchone()
            payload: dict[str, Any] = {
                "key": key,
                "not_applicable": not_applicable,
                "required": item.required,
                "version": None if written is None else int(written[0]),
                "as_proposed": as_proposed,
            }
            if held is not None and held.status == "PROPOSED":
                payload["proposed_by"] = held.source
            # An offered option is kept in the record; free text is not copied into it, an
            # Other part's text included (its length only).
            if item.kind == "TEXT":
                payload["length"] = len(value)
            else:
                parts = [part.strip() for part in value.split(";") if part.strip()]
                payload["value"] = JOIN.join(part for part in parts if not is_other(part))
                if parts and is_other(parts[-1]):
                    payload["other_length"] = len(other_text(parts[-1]))
            _audit(
                cursor, organization_id, project_id, actor, "control_walkthrough.answered",
                control_id, payload,
            )  # fmt: skip
    return SavedBody(saved=len(checked) - len(ignored), ignored=len(ignored))


# The planner's proposals from walkthrough notes


def notes_questions(
    connection: psycopg.Connection[Any], control_id: UUID
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """The walkthrough questions the notes may answer: those asked with no confirmed answer,
    each with its kind and offered answers, and the proposals on record by key."""
    rows = answers_of(connection, control_id)
    questions: list[dict[str, Any]] = []
    current: dict[str, str] = {}
    for item in questions_asked(connection, control_id, rows):
        held = rows.get(item.key)
        if held is not None and held.status == "CONFIRMED":
            continue
        proposed = "" if held is None else held.value
        current[item.key] = proposed
        questions.append(
            {
                "key": item.key,
                "question": item.text,
                "answer_kind": item.kind,
                "offered_answers": list(YES_NO if item.kind == "YES_NO" else item.options),
                "allows_other": item.allows_other,
                "answer_on_record": proposed,
            }
        )
    return questions, current


def propose(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requester: UUID,
    answers: Sequence[tuple[str, str, str]],
    source: str,
) -> int:
    """Record the planner's answers from the notes, each (key, value, quote), as PROPOSED
    with the words they rest on. An answer that does not fit its question is dropped, and a
    confirmed answer is never replaced. Returns how many proposals were recorded."""
    kept: list[tuple[str, str, str]] = []
    for key, raw, quote in answers:
        item = question(key)
        if item is None or any(key == done for done, _v, _q in kept):
            continue
        value = normalized(item, raw)
        # The words as read too: normalizing redacts a credential rather than refusing it.
        if (
            not valid_answer(item, value)
            or contains_secret({key: raw})
            or contains_secret({key: value})
        ):
            continue
        kept.append((key, value, clean_line(quote, QUOTE_LIMIT).strip()))
    if not kept:
        return 0
    recorded: list[str] = []
    with transaction(connection) as cursor:
        for key, value, quote in kept:
            row = cursor.execute(
                """
                INSERT INTO control_walkthrough_answers (
                    organization_id, project_id, engagement_control_id, question_key, value,
                    status, source, source_quote, answered_at
                )
                VALUES (%s, %s, %s, %s, %s, 'PROPOSED', 'AGENT', %s, clock_timestamp())
                ON CONFLICT (engagement_control_id, question_key) DO UPDATE
                SET value = EXCLUDED.value,
                    not_applicable = false,
                    status = 'PROPOSED',
                    source = 'AGENT',
                    source_quote = EXCLUDED.source_quote,
                    answered_by = NULL,
                    answered_at = EXCLUDED.answered_at,
                    version = control_walkthrough_answers.version + 1
                WHERE control_walkthrough_answers.status <> 'CONFIRMED'
                RETURNING question_key
                """,
                (organization_id, project_id, control_id, key, value, quote),
            ).fetchone()
            if row is not None:
                recorded.append(key)
        if recorded:
            _audit(
                cursor, organization_id, project_id, requester, "control_walkthrough.proposed",
                control_id, {"keys": recorded, "agent": AGENT, "read_by": source},
            )  # fmt: skip
    return len(recorded)


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
        VALUES (%s, %s, %s, %s, 'engagement_control', %s, %s)
        """,
        (organization_id, project_id, actor, action, target, Json(payload)),
    )
