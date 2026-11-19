"""A person's decision on a file's reliability (docs/evidence-assurance.md, section 10.14,
part B; migration 0163).

The check proposes; a person concludes. Where the finished, current check of a D&I request
says a file's reliability is not established (its review: a source prepared by a person,
or not shown; a report that does not show its source, run date or parameters, or shows
them in part; or a file the review does not describe: assurance_review._reliability), a
person who may decide evidence records that they established the file's reliability on
their own review, saying what they relied on (ESTABLISHED_ON_REVIEW), or that the
conclusion does not rest on the file (NOT_RELIED_ON).

Rules held here, whatever is asked:

- One decision stands per request and file. Recording another ends the earlier one as
  REPLACED; a person reopens one with a reason. Nothing is deleted or rewritten: a row
  takes one change, its ending (the guard of migration 0163 refuses any other). An act
  names the decision the person saw by its id (reopen: `id`; record: `replaces`, null for
  none): where what stands is not that, the page is stale and the act is refused.
- A decision never changes what the check found. Nothing here writes a run, its review,
  a finding, a follow-up, an annotation, a request's acceptance or a conclusion.
- It is refused where the request has no finished, current check, where the file is not
  in force on the request, and where the check raises no question about the file's
  reliability.
- A later check never ends a decision: the file's content is unchanged. A decision ends
  (FILE_GONE, naming nobody) once its file is no longer in force on its request
  (`end_with_files`): it is called by evidence_assurance.reconcile, which every change to
  what is in force on a control's requests runs (a file withdrawn, replaced or restored,
  a link made or removed, a plan reshaped), in that change's transaction where the
  change queues the chain itself (withdraw, replace) and right after it otherwise. Since
  E1 (18 November 2026) a person cannot withdraw, replace, move, unlink or remove from
  its request a file a standing decision rests on (evidence_reliance): the decision is
  reopened first. FILE_GONE then ends a decision whose file left by a record from before
  E1, or a change the chain follows that is not a person's act on the file. Until
  then the D&I list shows no decision on a file that is not in force, and a request
  whose files changed has no current check, so nothing of it is read as standing.

Every act is an audit event with the person as its actor; the file's going ends a
decision with one event per decision that names nobody.

Where the code runs before migration 0163 is applied there is no record to read or to
end: the D&I list and the workpaper give none, the chain's reconciling works as before,
and only recording or reopening fails (`_where_recorded`).

The first part is pure (no database). This module is imported by evidence_assurance, so
it imports that module only inside the functions that need it.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal, cast
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field

from ai_workforce_api.assurance_review import _file_name, _reliability
from ai_workforce_api.attribute_dispositions import NotCurrent, _scope, current_run
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.settings import Settings

if TYPE_CHECKING:
    from ai_workforce_api.evidence_assurance import RequestBody, ReviewBody

logger = logging.getLogger(__name__)

Kind = Literal["ESTABLISHED_ON_REVIEW", "NOT_RELIED_ON"]
EndedAs = Literal["REPLACED", "REOPENED", "FILE_GONE"]

KINDS: tuple[Kind, ...] = ("ESTABLISHED_ON_REVIEW", "NOT_RELIED_ON")
KIND_WORDS: dict[Kind, str] = {
    "ESTABLISHED_ON_REVIEW": "Reliability established on my review",
    "NOT_RELIED_ON": "Not relied on",
}
REASON_MIN = 10
REASON_MAX = 1000
RELIED_ON_MIN = 10
RELIED_ON_MAX = 600
HISTORY_MAX = 10
# The most a body's text may be before it is read at all (beyond it the body is not valid).
_RAW_MAX = 4000

RECORDED = "evidence.file_reliability_recorded"
REOPENED = "evidence.file_reliability_reopened"
ENDED_WITH_FILE = "evidence.file_reliability_ended_with_file"

# Each refusal, in one plain sentence.
NOT_CHECKED = "This request has not been checked yet, so there is no result to decide a file on."
STILL_CHECKING = (
    "The check of this request has not finished, so a file's reliability waits for its result."
)
CHECK_HELD = (
    "The check of this request was held before anything was read, so there is no result yet."
)
CHECK_FAILED = (
    "The check of this request did not finish, so there is no result to decide a file on."
)
CHECK_OUT_OF_DATE = (
    "The check of this request is out of date, so a file waits until it is checked again."
)
FILE_NOT_IN_FORCE = (
    "This file is not in force on this request, so its reliability is not decided here."
)
NO_QUESTION = (
    "The check raises no question about this file's reliability, so there is nothing to decide."
)
REASON_TOO_SHORT = f"Give the reason for the decision in at least {REASON_MIN} characters."
REASON_TOO_LONG = f"The reason for the decision can be at most {REASON_MAX} characters."
RELIED_ON_NEEDED = (
    f"Say what was relied on to establish it, in at least {RELIED_ON_MIN} characters."
)
RELIED_ON_TOO_LONG = (
    f"What was relied on to establish it can be at most {RELIED_ON_MAX} characters."
)
RELIED_ON_NOT_TAKEN = (
    "What was relied on is recorded only with “Reliability established on my review”."
)
STALE = "This decision changed since the page loaded, so refresh and try again."
NOTHING_STANDS = "No decision on this file's reliability stands for this request."
RECORDED_SINCE = (
    "A decision was recorded on this file since the page loaded, so refresh and try again."
)

_NOT_CURRENT: dict[str, str] = {
    "NOT_CHECKED": NOT_CHECKED,
    "QUEUED": STILL_CHECKING,
    "CHECKING": STILL_CHECKING,
    "HELD": CHECK_HELD,
    "FAILED": CHECK_FAILED,
    "OUT_OF_DATE": CHECK_OUT_OF_DATE,
}

# Why the file's going ended a decision: written here.
FILE_GONE_REASON = "The file is no longer in force on this request."


class ReliabilityState(Exception):
    """A refusal a person can read: answered as 409 with its one sentence."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# --- The bodies --------------------------------------------------------------------------


class RecordBody(BaseModel):
    """A person's decision on one file's reliability. The texts are read and bounded in
    code (`clean_reason`, `clean_relied_on`), so that each refusal is one plain sentence.

    `replaces` is the id of the decision the person saw standing on the file, or null where
    they saw none, and is always sent (the contract's `replaces: uuid | null`): where what
    stands now is not that, the page is stale and nothing is recorded (`stale_refusal`)."""

    model_config = ConfigDict(extra="forbid")

    kind: Kind
    reason: str = Field(max_length=_RAW_MAX)
    relied_on: str | None = Field(default=None, max_length=_RAW_MAX)
    replaces: UUID | None


class ReopenBody(BaseModel):
    """A person reopens the decision they saw standing, named by its `id`, with a reason."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    reason: str = Field(max_length=_RAW_MAX)


class DecisionBody(BaseModel):
    """The decision that stands on a file of a request."""

    id: UUID
    kind: Kind
    reason: str
    relied_on: str
    recorded_by_name: str
    recorded_at: datetime


class EndedDecisionBody(DecisionBody):
    """One that no longer stands, with how it ended. `ended_by_name` is null where the
    file's going ended it."""

    ended_at: datetime
    ended_by_name: str | None
    ended_as: EndedAs
    ended_reason: str


class FileReliabilityBody(BaseModel):
    """One file of a request's current check, as the D&I list gives it: the check's own
    sentence about its reliability ("" where the check's review says it but the request's
    reasons do not, as for a file no supported attribute rests on), the decision that
    stands (null for none) and the ended ones, newest first, at most 10."""

    file_id: UUID
    question: str
    decision: DecisionBody | None = None
    history: list[EndedDecisionBody] = Field(default_factory=list)


# --- Pure helpers ------------------------------------------------------------------------


def clean_reason(raw: str) -> str:
    """The person's reason as it is kept: one bounded line, cleaned as other person text
    is; refused where it is too short or too long."""
    reason = clean_line(raw, REASON_MAX + 1).strip()
    if len(reason) < REASON_MIN:
        raise ReliabilityState(REASON_TOO_SHORT)
    if len(reason) > REASON_MAX:
        raise ReliabilityState(REASON_TOO_LONG)
    return reason


def clean_relied_on(kind: str, raw: str | None) -> str:
    """What the person relied on: required with ESTABLISHED_ON_REVIEW (one bounded line),
    never kept with NOT_RELIED_ON."""
    relied_on = clean_line(raw or "", RELIED_ON_MAX + 1).strip()
    if kind != "ESTABLISHED_ON_REVIEW":
        if relied_on:
            raise ReliabilityState(RELIED_ON_NOT_TAKEN)
        return ""
    if len(relied_on) < RELIED_ON_MIN:
        raise ReliabilityState(RELIED_ON_NEEDED)
    if len(relied_on) > RELIED_ON_MAX:
        raise ReliabilityState(RELIED_ON_TOO_LONG)
    return relied_on


def not_current(status: str) -> str | None:
    """The refusal for a request whose check is not finished and current; None for one
    that is (REVIEWED)."""
    if status == "REVIEWED":
        return None
    return _NOT_CURRENT.get(status, CHECK_FAILED)


def stale_refusal(standing: UUID | None, seen: UUID | None) -> str | None:
    """Why an act is refused because the page is stale; None where what stands on the
    file (`standing`) is what the person saw (`seen`; None for nothing)."""
    if standing == seen:
        return None
    return STALE if standing is None else RECORDED_SINCE


def question_sentences(
    review: ReviewBody | None, read: Sequence[UUID], names: Mapping[UUID, str]
) -> dict[UUID, tuple[str, ...]]:
    """The files of a check's review whose reliability it leaves not established, each
    with the sentences the review's rule writes of it (assurance_review._reliability, by
    its name as the check wrote it), in the review's order: a file it describes as
    prepared by a person, of a source not shown, or a report that shows its basis only in
    part or not at all; then a file the check read (`read`) that the review does not
    describe. None for a check without a review (the first engine's made none, so it
    raises no question a person could decide)."""
    if review is None:
        return {}
    said = {file.file_id: file for file in review.files}
    found: dict[UUID, tuple[str, ...]] = {}
    for file_id in dict.fromkeys([*said, *read]):
        entry = said.get(file_id)
        sentences = _reliability(
            _file_name(names.get(file_id, "")),
            "UNKNOWN" if entry is None else entry.source,
            "NOT_A_REPORT" if entry is None else entry.report_basis,
        )
        if sentences:
            found[file_id] = sentences
    return found


def questions(
    review: ReviewBody | None, read: Sequence[UUID], names: Mapping[UUID, str]
) -> dict[UUID, str]:
    """Each file whose reliability the check leaves not established (`question_sentences`)
    with the check's own sentence about it: those of its sentences the review's reasons
    give, or "" where they give none (no supported attribute rests on the file)."""
    if review is None:
        return {}
    reasons = set(review.completeness.reasons)
    return {
        file_id: " ".join(sentence for sentence in sentences if sentence in reasons)
        for file_id, sentences in question_sentences(review, read, names).items()
    }


# --- The records -------------------------------------------------------------------------


@dataclass(frozen=True)
class Decision:
    """A decision as recorded, with the names of who recorded and who ended it."""

    id: UUID
    requirement_id: UUID
    file_id: UUID
    kind: Kind
    reason: str
    relied_on: str
    assessment_id: UUID
    recorded_by_name: str
    recorded_at: datetime
    version: int
    ended_at: datetime | None = None
    ended_by_name: str | None = None
    ended_as: EndedAs | None = None
    ended_reason: str = ""

    def body(self) -> DecisionBody:
        return DecisionBody(
            id=self.id,
            kind=self.kind,
            reason=self.reason,
            relied_on=self.relied_on,
            recorded_by_name=self.recorded_by_name,
            recorded_at=self.recorded_at,
        )

    def ended_body(self) -> EndedDecisionBody | None:
        if self.ended_at is None or self.ended_as is None:
            return None
        return EndedDecisionBody(
            **self.body().model_dump(),
            ended_at=self.ended_at,
            ended_by_name=self.ended_by_name,
            ended_as=self.ended_as,
            ended_reason=self.ended_reason,
        )


_COLUMNS = """
    d.id, d.requirement_id, d.evidence_file_id, d.kind, d.reason, d.relied_on,
    d.assessment_id, u.display_name, d.recorded_at, d.version, d.ended_at, e.display_name,
    d.ended_as, d.ended_reason
"""
_JOINS = """
    FROM file_reliability_decisions d
    JOIN users u ON u.id = d.recorded_by
    LEFT JOIN users e ON e.id = d.ended_by
"""


def _decision(row: Sequence[Any]) -> Decision:
    return Decision(
        id=UUID(str(row[0])),
        requirement_id=UUID(str(row[1])),
        file_id=UUID(str(row[2])),
        kind=cast(Kind, str(row[3])),
        reason=str(row[4]),
        relied_on=str(row[5] or ""),
        assessment_id=UUID(str(row[6])),
        recorded_by_name=str(row[7] or ""),
        recorded_at=row[8],
        version=int(row[9]),
        ended_at=row[10],
        ended_by_name=None if row[11] is None else str(row[11]),
        ended_as=None if row[12] is None else cast(EndedAs, str(row[12])),
        ended_reason=str(row[13] or ""),
    )


Key = tuple[UUID, UUID]


def _where_recorded[T](connection: psycopg.Connection[Any], work: Callable[[], T], none: T) -> T:
    """What `work` reads or ends of the decisions on record; `none` where there is no such
    record at all, because migration 0163 is not applied yet. The savepoint leaves the
    caller's transaction as it was. Any other error is the caller's, as raised."""
    try:
        with connection.transaction():
            return work()
    except psycopg.errors.UndefinedTable:
        logger.warning(
            "file reliability decisions are not on record: migration 0163 is not applied"
        )
        return none


def _only(requirement_ids: Collection[UUID] | None) -> list[UUID] | None:
    return None if requirement_ids is None else list(requirement_ids)


def _standing(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    requirement_ids: Collection[UUID] | None,
) -> dict[Key, Decision]:
    only = _only(requirement_ids)
    rows = connection.execute(
        f"""
        SELECT {_COLUMNS} {_JOINS}
        WHERE d.engagement_control_id = %s AND d.ended_at IS NULL
          AND (%s::uuid[] IS NULL OR d.requirement_id = ANY(%s::uuid[]))
        ORDER BY d.recorded_at, d.id
        """,  # noqa: S608
        (control_id, only, only),
    ).fetchall()
    found = (_decision(row) for row in rows)
    return {(item.requirement_id, item.file_id): item for item in found}


def _history(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    requirement_ids: Collection[UUID] | None,
    most: int,
) -> dict[Key, list[Decision]]:
    only = _only(requirement_ids)
    rows = connection.execute(
        f"""
        SELECT * FROM (
            SELECT {_COLUMNS},
                   row_number() OVER (
                       PARTITION BY d.requirement_id, d.evidence_file_id
                       ORDER BY d.ended_at DESC, d.id DESC
                   ) AS place
            {_JOINS}
            WHERE d.engagement_control_id = %s AND d.ended_at IS NOT NULL
              AND (%s::uuid[] IS NULL OR d.requirement_id = ANY(%s::uuid[]))
        ) ended
        WHERE place <= %s
        ORDER BY requirement_id, evidence_file_id, place
        """,  # noqa: S608
        (control_id, only, only, most),
    ).fetchall()
    found: dict[Key, list[Decision]] = {}
    for row in rows:
        item = _decision(row)
        found.setdefault((item.requirement_id, item.file_id), []).append(item)
    return found


def standing_for(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    requirement_ids: Collection[UUID] | None = None,
) -> dict[Key, Decision]:
    """The decisions that stand on a control's requests, by request and file, in one
    query. Whether a request has a finished, current check, and whether the file is in
    force on it, is the caller's to say: a decision applies only there."""
    return _where_recorded(
        connection, lambda: _standing(connection, control_id, requirement_ids), {}
    )


@dataclass(frozen=True)
class Decisions:
    """A control's decisions as the D&I list gives them, read once for the control."""

    standing_by: Mapping[Key, Decision]
    history_by: Mapping[Key, Sequence[Decision]]

    def standing(self, requirement_id: UUID, file_id: UUID) -> DecisionBody | None:
        found = self.standing_by.get((requirement_id, file_id))
        return None if found is None else found.body()

    def history(self, requirement_id: UUID, file_id: UUID) -> list[EndedDecisionBody]:
        return [
            body
            for item in self.history_by.get((requirement_id, file_id), ())
            if (body := item.ended_body()) is not None
        ]

    def entries(
        self,
        requirement_id: UUID,
        asked: Mapping[UUID, str],
        order: Sequence[UUID],
        in_force: Collection[UUID],
    ) -> list[FileReliabilityBody]:
        """A request's `file_reliability`: one entry per file of its current check's
        review (`order`, the review's files then the other files the check read) whose
        reliability the check leaves not established (`asked`: the check's own sentence
        for each), or that carries a decision or a history. A decision is given as
        standing only on a file in force on the request (`in_force`)."""
        found: list[FileReliabilityBody] = []
        for file_id in dict.fromkeys(order):
            decision = self.standing(requirement_id, file_id) if file_id in in_force else None
            history = self.history(requirement_id, file_id)
            if file_id not in asked and decision is None and not history:
                continue
            found.append(
                FileReliabilityBody(
                    file_id=file_id,
                    question=asked.get(file_id, ""),
                    decision=decision,
                    history=history,
                )
            )
        return found


def load(
    connection: psycopg.Connection[Any], control_id: UUID, requirement_id: UUID | None = None
) -> Decisions:
    """What stands and what ended on a control's requests (or on one of them): two
    queries, whatever the number of requests and files."""
    only = None if requirement_id is None else [requirement_id]
    return _where_recorded(
        connection,
        lambda: Decisions(
            _standing(connection, control_id, only),
            _history(connection, control_id, only, HISTORY_MAX),
        ),
        Decisions({}, {}),
    )


def changed_since(
    connection: psycopg.Connection[Any], control_id: UUID, when: datetime
) -> list[str]:
    """The names of the files on which a decision on the file's reliability of the control
    was recorded or ended after `when`, each once, in name order: what puts a D&I sign-off
    made at that time out of date, and what the conclusion then names
    (design_conclusions; docs/evidence-assurance.md, section 10.15, item 5). Empty where
    none was."""
    return _where_recorded(
        connection,
        lambda: [
            str(row[0] or "")
            for row in connection.execute(
                """
                SELECT DISTINCT f.file_name FROM evidence_files f
                WHERE f.id IN (SELECT d.evidence_file_id FROM file_reliability_decisions d
                               WHERE d.engagement_control_id = %s
                                 AND (d.recorded_at > %s OR d.ended_at > %s))
                ORDER BY f.file_name
                """,
                (control_id, when, when),
            ).fetchall()
        ],
        [],
    )


def review_order(review: ReviewBody | None, read: Sequence[UUID]) -> list[UUID]:
    """The files of a check's review in its order, then the other files it read."""
    if review is None:
        return []
    return list(dict.fromkeys([*(file.file_id for file in review.files), *read]))


# --- A person's acts ---------------------------------------------------------------------


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID | None,
    action: str,
    requirement_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'evidence_requirement', %s, %s)
        """,
        (organization_id, project_id, actor, action, requirement_id, Json(payload)),
    )


def record(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    file_id: UUID,
    body: RecordBody,
    actor: UUID,
) -> UUID:
    """A person records a decision on one file's reliability on one request. The one that
    stood there, if any, is kept and ended as REPLACED, but only where it is the one the
    person saw (`body.replaces`; none where they saw none). Refused, with nothing changed,
    by each rule of section 10.14. The request's current run is locked first, then the
    standing decision, as a disposition locks them (attribute_dispositions.record)."""
    from ai_workforce_api import evidence_assurance as assurance

    organization_id = _scope(connection, project_id, control_id, requirement_id)
    reason = clean_reason(body.reason)
    relied_on = clean_relied_on(body.kind, body.relied_on)
    with transaction(connection) as cursor:
        try:
            request, run, _attributes = current_run(cursor, project_id, control_id, requirement_id)
        except NotCurrent as state:
            raise ReliabilityState(not_current(state.status) or CHECK_FAILED) from None
        names = {file.file_id: file.file_name for file in request.files}
        if file_id not in names:
            raise ReliabilityState(FILE_NOT_IN_FORCE)
        review = assurance._review_body(run, request)
        if file_id not in question_sentences(review, run.file_ids, names):
            raise ReliabilityState(NO_QUESTION)
        # What stands now, locked until the act commits, against what the person saw.
        standing = cursor.execute(
            """
            SELECT id, kind FROM file_reliability_decisions
            WHERE requirement_id = %s AND evidence_file_id = %s AND ended_at IS NULL
            FOR UPDATE
            """,
            (requirement_id, file_id),
        ).fetchone()
        refusal = stale_refusal(None if standing is None else UUID(str(standing[0])), body.replaces)
        if refusal is not None:
            raise ReliabilityState(refusal)
        if standing is not None:
            cursor.execute(
                """
                UPDATE file_reliability_decisions
                SET ended_at = clock_timestamp(), ended_by = %s, ended_as = 'REPLACED',
                    version = version + 1
                WHERE id = %s AND ended_at IS NULL
                """,
                (actor, standing[0]),
            )
        row = cursor.execute(
            """
            INSERT INTO file_reliability_decisions (
                organization_id, project_id, engagement_control_id, requirement_id,
                evidence_file_id, kind, reason, relied_on, assessment_id, recorded_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id, project_id, control_id, requirement_id, file_id, body.kind,
                reason, relied_on, run.id, actor,
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
        new = UUID(str(row[0]))
        _audit(
            cursor, organization_id, project_id, actor, RECORDED, requirement_id,
            {
                "control_id": str(control_id),
                "file_id": str(file_id),
                "decision_id": str(new),
                "kind": body.kind,
                "reason": reason,
                "relied_on": relied_on,
                "assessment_id": str(run.id),
                "replaced": None if standing is None else str(standing[0]),
                "replaced_kind": None if standing is None else str(standing[1]),
            },
        )  # fmt: skip
    return new


def reopen(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    file_id: UUID,
    body: ReopenBody,
    actor: UUID,
) -> UUID:
    """A person reopens the decision they saw standing on a file of a request (`body.id`),
    with a reason: it is kept, ended as REOPENED, and no longer stands. Refused where none
    stands, and where the one that stands is not the one the person saw."""
    organization_id = _scope(connection, project_id, control_id, requirement_id)
    reason = clean_reason(body.reason)
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            SELECT id, kind FROM file_reliability_decisions
            WHERE requirement_id = %s AND evidence_file_id = %s
              AND engagement_control_id = %s AND project_id = %s AND ended_at IS NULL
            FOR UPDATE
            """,
            (requirement_id, file_id, control_id, project_id),
        ).fetchone()
        if row is None:
            raise ReliabilityState(NOTHING_STANDS)
        found = UUID(str(row[0]))
        if found != body.id:
            raise ReliabilityState(STALE)
        cursor.execute(
            """
            UPDATE file_reliability_decisions
            SET ended_at = clock_timestamp(), ended_by = %s, ended_as = 'REOPENED',
                ended_reason = %s, version = version + 1
            WHERE id = %s AND ended_at IS NULL
            """,
            (actor, reason, found),
        )
        _audit(
            cursor, organization_id, project_id, actor, REOPENED, requirement_id,
            {
                "control_id": str(control_id),
                "file_id": str(file_id),
                "decision_id": str(found),
                "kind": str(row[1]),
                "reason": reason,
            },
        )  # fmt: skip
    return found


# --- What ends a decision without the person asking --------------------------------------


def end_with_files(
    cursor: psycopg.Cursor[Any],
    control_id: UUID,
    in_force: Mapping[UUID, Collection[UUID]],
    *,
    only_requirement: UUID | None = None,
    changed_by: UUID | None = None,
) -> int:
    """Called by evidence_assurance.reconcile, in its transaction, with what is in force
    now on each of the control's D&I requests (`in_force`, by request; a request missing
    has nothing in force): each standing decision whose file is no longer in force on its
    request ends as FILE_GONE, naming nobody, with one audit event (`changed_by`, the
    person whose change it follows where known, is kept in the event). A later check
    never ends a decision. How many it ended."""
    only = None if only_requirement is None else [only_requirement]
    standing: list[tuple[Any, ...]] = _where_recorded(
        cursor.connection,
        lambda: cursor.execute(
            """
            SELECT id, organization_id, project_id, requirement_id, evidence_file_id, kind
            FROM file_reliability_decisions
            WHERE engagement_control_id = %s AND ended_at IS NULL
              AND (%s::uuid[] IS NULL OR requirement_id = ANY(%s::uuid[]))
            ORDER BY recorded_at, id
            FOR UPDATE
            """,
            (control_id, only, only),
        ).fetchall(),
        [],
    )
    ended = 0
    for decision_id, organization, project, requirement_id, file_id, kind in standing:
        held = {str(item) for item in in_force.get(UUID(str(requirement_id)), ())}
        if str(file_id) in held:
            continue
        cursor.execute(
            """
            UPDATE file_reliability_decisions
            SET ended_at = clock_timestamp(), ended_as = 'FILE_GONE', ended_reason = %s,
                version = version + 1
            WHERE id = %s AND ended_at IS NULL
            """,
            (FILE_GONE_REASON, decision_id),
        )
        _audit(
            cursor, UUID(str(organization)), UUID(str(project)), None, ENDED_WITH_FILE,
            UUID(str(requirement_id)),
            {
                "control_id": str(control_id),
                "file_id": str(file_id),
                "decision_id": str(decision_id),
                "kind": str(kind),
                "ended_as": "FILE_GONE",
                "changed_by": None if changed_by is None else str(changed_by),
            },
        )  # fmt: skip
        ended += 1
    return ended


# --- The routes --------------------------------------------------------------------------


def register_file_reliability(app: FastAPI, settings: Settings) -> None:
    from ai_workforce_api import evidence_assurance as assurance

    base = (
        "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"
        "/evidence-assurance/{requirement_id}/files/{file_id}/reliability"
    )

    def run(
        request: Request,
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        requirement_id: UUID,
        act: Callable[[psycopg.Connection[Any], Principal], None],
    ) -> RequestBody:
        """A person who may decide evidence acts, and is answered with the request's entry
        as the D&I list gives it (as `rerun` answers)."""
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> RequestBody:
            authorize(connection, principal=principal, action=Action.TASK_UPDATE,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            if principal.kind is not PrincipalKind.USER:
                raise NotVisible()
            act(connection, principal)
            body = assurance.read_assurance(connection, project_id, control_id, requirement_id)
            if not body.requests:
                raise ReliabilityState(NOT_CHECKED)
            return body.requests[0]

        try:
            return _call(settings, work)
        except ReliabilityState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    @app.post(base, response_model=assurance.RequestBody)
    def record_file_reliability(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        file_id: UUID, body: RecordBody, request: Request,
    ) -> RequestBody:  # fmt: skip
        def act(connection: psycopg.Connection[Any], principal: Principal) -> None:
            record(
                connection, project_id, control_id, requirement_id, file_id, body,
                principal.id,
            )  # fmt: skip

        return run(request, organization_id, project_id, control_id, requirement_id, act)

    @app.post(f"{base}/reopen", response_model=assurance.RequestBody)
    def reopen_file_reliability(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        file_id: UUID, body: ReopenBody, request: Request,
    ) -> RequestBody:  # fmt: skip
        def act(connection: psycopg.Connection[Any], principal: Principal) -> None:
            reopen(
                connection, project_id, control_id, requirement_id, file_id, body,
                principal.id,
            )  # fmt: skip

        return run(request, organization_id, project_id, control_id, requirement_id, act)


__all__ = [
    "KINDS",
    "KIND_WORDS",
    "Decision",
    "DecisionBody",
    "Decisions",
    "EndedDecisionBody",
    "FileReliabilityBody",
    "RecordBody",
    "ReliabilityState",
    "ReopenBody",
    "changed_since",
    "clean_reason",
    "clean_relied_on",
    "end_with_files",
    "load",
    "not_current",
    "question_sentences",
    "questions",
    "record",
    "register_file_reliability",
    "reopen",
    "review_order",
    "stale_refusal",
    "standing_for",
]
