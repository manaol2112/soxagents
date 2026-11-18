"""Tickmarks: a person's disposition of an attribute (docs/evidence-assurance.md, section
10.13; migration 0162).

The check proposes; a person concludes. On a D&I request whose check is finished and
current, a person who may decide evidence records, for one attribute, that the evidence
shows it on their own review (SHOWN_ON_REVIEW, resting on an annotation a person made,
confirmed or edited), that it does not apply to what was inspected (NOT_APPLICABLE), that
the evidence cannot be produced and this is accepted (NOT_AVAILABLE), or that the evidence
shows the control did not work (EXCEPTION, which closes nothing).

Rules held here, whatever is asked:

- One disposition stands per request and attribute. Recording another ends the earlier one
  as REPLACED; a person reopens one with a reason. Nothing is deleted or rewritten: a row
  takes one change, its ending (the guard of migration 0162 refuses any other). So every
  standing row has version 1, and an act names the disposition the person saw by its id
  (reopen: `id`; record: `replaces`, null for none): where what stands is not that, the
  page is stale and the act is refused. Nothing is reopened or replaced unseen.
- "Shown, on my review" rests only on an annotation of kind SHOWS: never one that marks
  an exception, identifies a person or names a source.
- A disposition never changes what the check found. Nothing here writes a run, a finding,
  a follow-up, an annotation, a request's acceptance or a conclusion.
- It is refused where the request has no finished, current check, where the attribute is
  not an approved attribute of the control, and, for the three kinds that close an
  attribute, where the current check finds the records contradict it: only EXCEPTION is
  taken there. A person can never tick an exception away.
- When a later check of the request finishes (`end_by_check`, called in the transaction
  that saves the run): a disposition that closes an attribute ends as SUPERSEDED_BY_CHECK
  where the check finds the attribute supported, and as OVERTAKEN_BY_CHECK where it finds
  the records contradict it; otherwise it stands. A person's EXCEPTION is never ended by
  a check: only a person reopens or replaces it.
- A SHOWN_ON_REVIEW stands only while its annotation does. It ends as ANNOTATION_GONE in
  the transaction that removes the annotation or takes the attribute off it
  (`end_for_annotation`, called by evidence_annotations), and, for a file no longer in
  force on the request, when the next check of the request finishes (until then the
  request has no current check, so nothing of it is shown as standing). The loader also
  leaves out one whose annotation no longer stands, however that came about.

Every act is an audit event with the person as its actor; what a check ends is one event
per disposition with nobody as its actor.

Where the code runs before migration 0162 is applied there is no record to read or to
end: the D&I list and the workpaper give none, a check finishes and an annotation is
removed as before, and only recording or reopening fails (`_where_recorded`).

The first part is pure (no database). This module is imported by evidence_assurance (the
response's two fields, the loader and `end_by_check`), so it imports that module only
inside the functions that need it.
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

from ai_workforce_api.assurance_review import assessment_of
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
    from ai_workforce_api.evidence_assurance import RequestBody

logger = logging.getLogger(__name__)

Kind = Literal["SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE", "EXCEPTION"]
EndedAs = Literal[
    "REPLACED", "REOPENED", "SUPERSEDED_BY_CHECK", "OVERTAKEN_BY_CHECK", "ANNOTATION_GONE"
]  # fmt: skip
# What a finished check finds of one attribute, as the rules here read it.
Finds = Literal["SUPPORTED", "CONTRADICTED", "OTHER"]
# A request's check as the D&I list reads it (evidence_assurance.RequestStatus).
CheckStatus = Literal[
    "NOT_CHECKED", "QUEUED", "CHECKING", "HELD", "REVIEWED", "FAILED", "OUT_OF_DATE"
]  # fmt: skip

KINDS: tuple[Kind, ...] = ("SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE", "EXCEPTION")
# The kinds after which the attribute no longer waits on the person. EXCEPTION closes
# nothing.
CLOSING: frozenset[str] = frozenset({"SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE"})
KIND_WORDS: dict[Kind, str] = {
    "SHOWN_ON_REVIEW": "Shown, on my review",
    "NOT_APPLICABLE": "Not applicable to this instance",
    "NOT_AVAILABLE": "Evidence not available, accepted",
    "EXCEPTION": "Exception",
}
REASON_MIN = 10
REASON_MAX = 1000
RELIED_ON_MAX = 600
HISTORY_MAX = 10
# The most a body's text may be before it is read at all (beyond it the body is not valid).
_RAW_MAX = 4000
_SENTENCE_MAX = 600

RECORDED = "evidence.attribute_disposition_recorded"
REOPENED = "evidence.attribute_disposition_reopened"
ENDED_BY_CHECK = "evidence.attribute_disposition_ended_by_check"
ANNOTATION_GONE_EVENT = "evidence.attribute_disposition_annotation_gone"

# Each refusal, in one plain sentence.
NOT_CHECKED = "This request has not been checked yet, so there is no result to put a tickmark on."
STILL_CHECKING = (
    "The check of this request has not finished, so a tickmark waits until its result is in."
)
CHECK_HELD = (
    "The check of this request was held before anything was read, so there is no result to "
    "put a tickmark on."
)
CHECK_FAILED = (
    "The check of this request did not finish, so there is no result to put a tickmark on."
)
CHECK_OUT_OF_DATE = (
    "The check of this request is out of date, so a tickmark waits until it is checked again."
)
NOT_AN_ATTRIBUTE = "This attribute is not an approved attribute of this control."
REASON_TOO_SHORT = f"Give the reason in a sentence of at least {REASON_MIN} characters."
REASON_TOO_LONG = f"The reason can be at most {REASON_MAX} characters."
RELIED_ON_TOO_LONG = f"What was relied on instead can be at most {RELIED_ON_MAX} characters."
RELIED_ON_NOT_TAKEN = (
    "What was relied on instead is recorded only with “Evidence not available, accepted”."
)
ANNOTATION_NOT_TAKEN = "An annotation is recorded only with “Shown, on my review”."
ANNOTATION_NEEDED = (
    "“Shown, on my review” needs an annotation on the evidence that names this attribute."
)
ANNOTATION_ELSEWHERE = "The annotation chosen is not an annotation of this request."
ANNOTATION_REMOVED = "The annotation chosen is no longer in the list of its file."
ANNOTATION_UNREVIEWED = (
    "The annotation chosen is the agent's proposal and no person has reviewed it yet."
)
ANNOTATION_OTHER_ATTRIBUTE = "The annotation chosen does not name this attribute."
ANNOTATION_NOT_SHOWS = (
    "“Shown, on my review” needs an annotation that shows the attribute, not one that marks "
    "an exception, a person or source."
)
ANNOTATION_FILE_GONE = (
    "The annotation chosen is on a file that is no longer in force on this request."
)
ONLY_EXCEPTION = (
    "The check finds the records contradict this attribute, so only “Exception” can be "
    "recorded here."
)
STALE = "This tickmark changed since the page loaded, so refresh and try again."
NOTHING_STANDS = "No tickmark stands on this attribute for this request."
RECORDED_SINCE = (
    "A tickmark was recorded on this attribute since the page loaded, so refresh and try again."
)

_NOT_CURRENT: dict[str, str] = {
    "NOT_CHECKED": NOT_CHECKED,
    "QUEUED": STILL_CHECKING,
    "CHECKING": STILL_CHECKING,
    "HELD": CHECK_HELD,
    "FAILED": CHECK_FAILED,
    "OUT_OF_DATE": CHECK_OUT_OF_DATE,
}

# Why a check, or the loss of an annotation, ended a disposition: written here.
SUPERSEDED_REASON = "A later check of the request found this attribute supported."
OVERTAKEN_REASON = "A later check of the request found the records contradict this attribute."
ANNOTATION_REMOVED_REASON = "The annotation it rests on was removed."
ANNOTATION_RENAMED_REASON = "The annotation it rests on no longer names this attribute."
FILE_GONE_REASON = "The file its annotation is on is no longer in force on this request."


class DispositionState(Exception):
    """A refusal a person can read: answered as 409 with its one sentence."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# --- The bodies --------------------------------------------------------------------------


class RecordBody(BaseModel):
    """A person's disposition of one attribute. The texts are read and bounded in code
    (`clean_reason`, `clean_relied_on`), so that each refusal is one plain sentence.

    `replaces` is the id of the disposition the person saw standing on the attribute, or
    null (or left out) where they saw none: where what stands now is not that, the page
    is stale and nothing is recorded (`stale_refusal`). A standing disposition changes
    only by ending, so its version cannot tell it from the one that replaced it."""

    model_config = ConfigDict(extra="forbid")

    kind: Kind
    reason: str = Field(max_length=_RAW_MAX)
    relied_on: str | None = Field(default=None, max_length=_RAW_MAX)
    annotation_id: UUID | None = None
    replaces: UUID | None = None


class ReopenBody(BaseModel):
    """A person reopens the disposition they saw standing, named by its `id`. `version`
    is accepted as the first contract sent it, and checked where given; it never tells
    one standing disposition from another (each that stands has version 1)."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    version: int | None = Field(default=None, ge=1)
    reason: str = Field(max_length=_RAW_MAX)


class DispositionBody(BaseModel):
    """A disposition of an attribute of a request, as recorded."""

    id: UUID
    kind: Kind
    reason: str
    relied_on: str
    annotation_id: UUID | None
    recorded_by_name: str
    recorded_at: datetime
    version: int


class StandingDispositionBody(DispositionBody):
    """The disposition that stands for an attribute of a request. `on_current_check` is
    whether it was recorded on the request's current check (section 10.15, item 9): false
    where it stands through a later check, so the screen asks the person to confirm it
    still holds."""

    on_current_check: bool


class EndedDispositionBody(DispositionBody):
    """One that no longer stands, with how it ended. `ended_by_name` is null where a check
    ended it."""

    ended_at: datetime
    ended_by_name: str | None
    ended_as: EndedAs
    ended_reason: str


# --- Pure helpers ------------------------------------------------------------------------


def clean_reason(raw: str) -> str:
    """The person's reason as it is kept: one bounded line, cleaned as other person text
    is; refused where it is too short or too long."""
    reason = clean_line(raw, REASON_MAX + 1).strip()
    if len(reason) < REASON_MIN:
        raise DispositionState(REASON_TOO_SHORT)
    if len(reason) > REASON_MAX:
        raise DispositionState(REASON_TOO_LONG)
    return reason


def clean_relied_on(kind: str, raw: str | None) -> str:
    """What was relied on instead: kept only with NOT_AVAILABLE, one bounded line."""
    relied_on = clean_line(raw or "", RELIED_ON_MAX + 1).strip()
    if not relied_on:
        return ""
    if kind != "NOT_AVAILABLE":
        raise DispositionState(RELIED_ON_NOT_TAKEN)
    if len(relied_on) > RELIED_ON_MAX:
        raise DispositionState(RELIED_ON_TOO_LONG)
    return relied_on


def check_finds(item: Mapping[str, Any] | None) -> Finds:
    """What a finished check finds of one attribute, from the run's own record of it
    (evidence_assessments.outcome). CONTRADICTED where the records show it is not met: an
    issue resting on a deviation, a contradiction or a comparison that failed, or an
    exception shown beside a file not read (the assessment of section 10.6, which the
    workpaper reads as "Exception shown"; worked out by the same table for a run of the
    first engine, which recorded none). SUPPORTED only for the check's own SUPPORTED."""
    if item is None:
        return "OTHER"
    verdict = str(item.get("verdict") or "")
    assessment = item.get("assessment")
    if assessment is None:
        deviation = any(
            isinstance(element, dict) and element.get("deviation")
            for element in item.get("elements") or []
        )
        assessment = assessment_of(
            verdict=verdict,
            result=None if item.get("result") is None else str(item.get("result")),
            expected=bool(item.get("expected")),
            deviation=verdict == "ISSUE" and deviation,
            exception_unchecked=verdict == "UNSETTLED" and deviation,
        )
    if assessment == "CONTRADICTED":
        return "CONTRADICTED"
    return "SUPPORTED" if verdict == "SUPPORTED" else "OTHER"


def contradicted(item: Mapping[str, Any] | None) -> bool:
    """Whether the current check finds the records contradict the attribute, so that
    only EXCEPTION is taken there: the rule `record` refuses by, given to the screen on
    each attribute of the D&I list (which sends no element's deviation, so the screen
    could not work it out for a run of the first engine)."""
    return check_finds(item) == "CONTRADICTED"


def stale_refusal(standing: UUID | None, seen: UUID | None) -> str | None:
    """Why an act is refused because the page is stale; None where what stands on the
    attribute (`standing`) is what the person saw (`seen`; None for nothing). Another
    recorded since: RECORDED_SINCE. The one seen ended since, and none stands: STALE."""
    if standing == seen:
        return None
    return STALE if standing is None else RECORDED_SINCE


def ending_by_check(kind: str, finds: Finds, annotation_in_force: bool = True) -> EndedAs | None:
    """How a later finished check of the request ends a standing disposition; None where
    it stands. A kind that closes an attribute is superseded where the check finds the
    attribute supported (it is no longer needed) and overtaken where the check finds the
    records contradict it (the attribute waits on the person again). A SHOWN_ON_REVIEW
    whose annotation is on a file no longer in force on the request no longer stands. A
    person's EXCEPTION is never ended by a check."""
    if kind not in CLOSING:
        return None
    if finds == "SUPPORTED":
        return "SUPERSEDED_BY_CHECK"
    if finds == "CONTRADICTED":
        return "OVERTAKEN_BY_CHECK"
    if kind == "SHOWN_ON_REVIEW" and not annotation_in_force:
        return "ANNOTATION_GONE"
    return None


def annotation_refusal(
    *,
    found: bool,
    status: str,
    kind: str,
    names_attribute: bool,
    file_in_force: bool,
) -> str | None:
    """Why an annotation cannot carry "Shown, on my review", in one sentence; None where
    it can: an annotation of this request (`found`), still in the list of its file, that a
    person made, confirmed or edited, that shows the attribute (kind SHOWS: never one that
    marks an exception, identifies a person or names a source), naming the attribute, on
    a file in force on the request. An annotation's kind never changes once made."""
    if not found:
        return ANNOTATION_ELSEWHERE
    if status in ("REMOVED", "SUPERSEDED"):
        return ANNOTATION_REMOVED
    if status not in ("CONFIRMED", "EDITED"):
        return ANNOTATION_UNREVIEWED
    if kind != "SHOWS":
        return ANNOTATION_NOT_SHOWS
    if not names_attribute:
        return ANNOTATION_OTHER_ATTRIBUTE
    if not file_in_force:
        return ANNOTATION_FILE_GONE
    return None


def not_current(status: str) -> str | None:
    """The refusal for a request whose check is not finished and current; None for one
    that is (REVIEWED)."""
    if status == "REVIEWED":
        return None
    return _NOT_CURRENT.get(status, CHECK_FAILED)


# --- The records -------------------------------------------------------------------------


@dataclass(frozen=True)
class Disposition:
    """A disposition as recorded, with the names of who recorded and who ended it."""

    id: UUID
    requirement_id: UUID
    attribute_id: UUID
    kind: Kind
    reason: str
    relied_on: str
    annotation_id: UUID | None
    assessment_id: UUID
    recorded_by_name: str
    recorded_at: datetime
    version: int
    ended_at: datetime | None = None
    ended_by_name: str | None = None
    ended_as: EndedAs | None = None
    ended_reason: str = ""

    def body(self) -> DispositionBody:
        return DispositionBody(
            id=self.id,
            kind=self.kind,
            reason=self.reason,
            relied_on=self.relied_on,
            annotation_id=self.annotation_id,
            recorded_by_name=self.recorded_by_name,
            recorded_at=self.recorded_at,
            version=self.version,
        )

    def ended_body(self) -> EndedDispositionBody | None:
        if self.ended_at is None or self.ended_as is None:
            return None
        return EndedDispositionBody(
            **self.body().model_dump(),
            ended_at=self.ended_at,
            ended_by_name=self.ended_by_name,
            ended_as=self.ended_as,
            ended_reason=self.ended_reason,
        )


_COLUMNS = """
    d.id, d.requirement_id, d.attribute_id, d.kind, d.reason, d.relied_on, d.annotation_id,
    d.assessment_id, u.display_name, d.recorded_at, d.version, d.ended_at, e.display_name,
    d.ended_as, d.ended_reason
"""
_JOINS = """
    FROM attribute_dispositions d
    JOIN users u ON u.id = d.recorded_by
    LEFT JOIN users e ON e.id = d.ended_by
"""


def _disposition(row: Sequence[Any]) -> Disposition:
    return Disposition(
        id=UUID(str(row[0])),
        requirement_id=UUID(str(row[1])),
        attribute_id=UUID(str(row[2])),
        kind=cast(Kind, str(row[3])),
        reason=str(row[4]),
        relied_on=str(row[5] or ""),
        annotation_id=None if row[6] is None else UUID(str(row[6])),
        assessment_id=UUID(str(row[7])),
        recorded_by_name=str(row[8] or ""),
        recorded_at=row[9],
        version=int(row[10]),
        ended_at=row[11],
        ended_by_name=None if row[12] is None else str(row[12]),
        ended_as=None if row[13] is None else cast(EndedAs, str(row[13])),
        ended_reason=str(row[14] or ""),
    )


Key = tuple[UUID, UUID]


def _where_recorded[T](connection: psycopg.Connection[Any], work: Callable[[], T], none: T) -> T:
    """What `work` reads or ends of the dispositions on record; `none` where there is no
    such record at all, because migration 0162 is not applied yet (the code released
    before the migration). There is then no disposition to read or to end, and neither the
    D&I list nor a check that finishes fails for it: the savepoint leaves the caller's
    transaction as it was. Any other error is the caller's, as raised."""
    try:
        with connection.transaction():
            return work()
    except psycopg.errors.UndefinedTable:
        logger.warning("attribute dispositions are not on record: migration 0162 is not applied")
        return none


def standing_for(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    requirement_ids: Collection[UUID] | None = None,
) -> dict[Key, Disposition]:
    """The dispositions that stand on a control's requests, by request and attribute, in
    one query. A SHOWN_ON_REVIEW whose annotation no longer stands (removed, or no longer
    naming the attribute) is left out, however that came about. Whether a request has a
    finished, current check is the caller's to say: a disposition applies only there."""
    return _where_recorded(
        connection, lambda: _standing(connection, control_id, requirement_ids), {}
    )


def history_for(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    requirement_ids: Collection[UUID] | None = None,
    most: int = HISTORY_MAX,
) -> dict[Key, list[Disposition]]:
    """The ended dispositions of a control's requests, by request and attribute, newest
    first and at most `most` of each, in one query."""
    return _where_recorded(
        connection, lambda: _history(connection, control_id, requirement_ids, most), {}
    )


def _standing(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    requirement_ids: Collection[UUID] | None,
) -> dict[Key, Disposition]:
    rows = connection.execute(
        f"""
        SELECT {_COLUMNS} {_JOINS}
        LEFT JOIN evidence_annotations a ON a.id = d.annotation_id
        WHERE d.engagement_control_id = %s AND d.ended_at IS NULL
          AND (%s::uuid[] IS NULL OR d.requirement_id = ANY(%s::uuid[]))
          AND (d.annotation_id IS NULL
               OR (a.status IN ('CONFIRMED', 'EDITED') AND d.attribute_id = ANY(a.attribute_ids)))
        ORDER BY d.recorded_at, d.id
        """,  # noqa: S608
        (
            control_id,
            None if requirement_ids is None else list(requirement_ids),
            None if requirement_ids is None else list(requirement_ids),
        ),
    ).fetchall()
    found = (_disposition(row) for row in rows)
    return {(item.requirement_id, item.attribute_id): item for item in found}


def _history(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    requirement_ids: Collection[UUID] | None,
    most: int,
) -> dict[Key, list[Disposition]]:
    rows = connection.execute(
        f"""
        SELECT * FROM (
            SELECT {_COLUMNS},
                   row_number() OVER (
                       PARTITION BY d.requirement_id, d.attribute_id
                       ORDER BY d.ended_at DESC, d.id DESC
                   ) AS place
            {_JOINS}
            WHERE d.engagement_control_id = %s AND d.ended_at IS NOT NULL
              AND (%s::uuid[] IS NULL OR d.requirement_id = ANY(%s::uuid[]))
        ) ended
        WHERE place <= %s
        ORDER BY requirement_id, attribute_id, place
        """,  # noqa: S608
        (
            control_id,
            None if requirement_ids is None else list(requirement_ids),
            None if requirement_ids is None else list(requirement_ids),
            most,
        ),
    ).fetchall()
    found: dict[Key, list[Disposition]] = {}
    for row in rows:
        item = _disposition(row)
        found.setdefault((item.requirement_id, item.attribute_id), []).append(item)
    return found


@dataclass(frozen=True)
class Dispositions:
    """A control's dispositions as the D&I list gives them, read once for the control."""

    standing_by: Mapping[Key, Disposition]
    history_by: Mapping[Key, Sequence[Disposition]]

    def standing(
        self, requirement_id: UUID, attribute_id: UUID, run_id: UUID | None = None
    ) -> StandingDispositionBody | None:
        """The disposition that stands on the attribute for the request, saying whether it
        was recorded on `run_id`, the request's current check (never on no check)."""
        found = self.standing_by.get((requirement_id, attribute_id))
        if found is None:
            return None
        return StandingDispositionBody(
            **found.body().model_dump(),
            on_current_check=run_id is not None and found.assessment_id == run_id,
        )

    def kept(self, requirement_id: UUID) -> int:
        """How many dispositions stand on the request, whatever the state of its check
        (section 10.15, item 8): a request whose check is not current shows none of them,
        and says how many are kept."""
        return sum(1 for request, _attribute in self.standing_by if request == requirement_id)

    def history(self, requirement_id: UUID, attribute_id: UUID) -> list[EndedDispositionBody]:
        return [
            body
            for item in self.history_by.get((requirement_id, attribute_id), ())
            if (body := item.ended_body()) is not None
        ]


def load(
    connection: psycopg.Connection[Any], control_id: UUID, requirement_id: UUID | None = None
) -> Dispositions:
    """What stands and what ended on a control's requests (or on one of them): two
    queries, whatever the number of requests and attributes."""
    only = None if requirement_id is None else [requirement_id]
    return _where_recorded(
        connection,
        lambda: Dispositions(
            _standing(connection, control_id, only),
            _history(connection, control_id, only, HISTORY_MAX),
        ),
        Dispositions({}, {}),
    )


def signoff_facts(
    connection: psycopg.Connection[Any], control_id: UUID, since: datetime | None
) -> tuple[tuple[UUID, ...], bool]:
    """What the D&I conclusion reads of a control's dispositions (design_conclusions;
    section 10.15, item 5), in one query, whatever the state of its requests' checks:

    - the attributes on which one was recorded or ended after `since`, the time of the
      sign-off that stands (none, where none stands): that puts the sign-off out of date,
      and the conclusion names them;
    - whether a person's EXCEPTION stands on any request, so that only a control with one
      pays for reading them and their checks (design_workpaper.load_exceptions).
    """

    def read() -> tuple[tuple[UUID, ...], bool]:
        row = connection.execute(
            """
            SELECT (SELECT coalesce(array_agg(DISTINCT attribute_id), '{}'::uuid[])
                    FROM attribute_dispositions
                    WHERE engagement_control_id = %s
                      AND (recorded_at > %s OR ended_at > %s)),
                   EXISTS (SELECT 1 FROM attribute_dispositions
                           WHERE engagement_control_id = %s
                             AND ended_at IS NULL AND kind = 'EXCEPTION')
            """,
            (control_id, since, since, control_id),
        ).fetchone()
        if row is None:
            return (), False
        return tuple(UUID(str(item)) for item in (row[0] or [])), bool(row[1])

    nothing: tuple[tuple[UUID, ...], bool] = ((), False)
    return _where_recorded(connection, read, nothing)


def exceptions_on_record(
    connection: psycopg.Connection[Any], control_id: UUID
) -> list[Disposition]:
    """Every EXCEPTION a person recorded that stands on a D&I request of the control that
    is not removed, as recorded, whatever the state of the request's check and whatever
    the request's own state (waiting, requested, set aside as not applicable): what the
    D&I conclusion is never signed over (design_conclusions; independent review of
    section 10.15, 15 November 2026). An exception stands until a person reopens or
    replaces it: no check ends it, and neither does its request's check going out of date,
    failing or being held. One on a removed request is not read: the request is no longer
    part of the control's evidence."""

    def read() -> list[Disposition]:
        rows = connection.execute(
            f"""
            SELECT {_COLUMNS} {_JOINS}
            JOIN evidence_requirements q ON q.id = d.requirement_id
            WHERE d.engagement_control_id = %s AND d.ended_at IS NULL
              AND d.kind = 'EXCEPTION' AND q.phase = 'DESIGN' AND q.status <> 'REMOVED'
            ORDER BY d.recorded_at, d.id
            """,  # noqa: S608
            (control_id,),
        ).fetchall()
        return [_disposition(row) for row in rows]

    return _where_recorded(connection, read, [])


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


def _scope(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, requirement_id: UUID
) -> UUID:
    """The firm of a D&I request of this control in this engagement; not found otherwise."""
    row = connection.execute(
        """
        SELECT c.organization_id
        FROM engagement_controls c
        JOIN evidence_requirements q ON q.engagement_control_id = c.id
        WHERE c.id = %s AND c.project_id = %s AND q.id = %s AND q.project_id = %s
          AND q.phase = 'DESIGN'
        """,
        (control_id, project_id, requirement_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return UUID(str(row[0]))


@dataclass(frozen=True)
class _Current:
    """The finished, current check of a request, locked for the person's act."""

    run_id: UUID
    outcome: Sequence[Mapping[str, Any]]
    approved: frozenset[UUID]
    in_force: frozenset[UUID]

    def item(self, attribute_id: UUID) -> Mapping[str, Any] | None:
        return next(
            (item for item in self.outcome if str(item.get("attribute_id")) == str(attribute_id)),
            None,
        )


class NotCurrent(Exception):
    """The request has no finished, current check: `status` is its state as the D&I list
    reads it (NOT_CHECKED, QUEUED, CHECKING, HELD, FAILED, OUT_OF_DATE)."""

    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


def current_run(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, requirement_id: UUID
) -> tuple[Any, Any, Any]:
    """The request (evidence_assurance._Request), its finished, current run (_Run) and the
    control's approved attributes, as the D&I list reads them
    (evidence_assurance.read_assurance); NotCurrent, with its state, where the request was
    never checked, its check is queued, working, held or failed, or what it read has
    changed since. The run's row is locked until the act commits, so the run cannot go out
    of date under it and two acts on one request take their turn. Shared with a person's
    decision on a file's reliability (file_reliability, section 10.14)."""
    from ai_workforce_api import evidence_assurance as assurance

    connection = cursor.connection
    control = assurance._control(connection, project_id, control_id)
    if control is None:
        raise NotVisible()
    request = next(
        (
            item
            for item in assurance._requests(connection, project_id, control_id)
            if item.requirement_id == requirement_id
        ),
        None,
    )
    if request is None:
        raise NotCurrent("NOT_CHECKED")
    row = cursor.execute(
        f"SELECT {assurance._RUN_COLUMNS} FROM evidence_assessments "  # noqa: S608
        "WHERE requirement_id = %s AND stale_at IS NULL FOR UPDATE",
        (requirement_id,),
    ).fetchone()
    if row is None:
        on_record = cursor.execute(
            "SELECT 1 FROM evidence_assessments WHERE requirement_id = %s LIMIT 1",
            (requirement_id,),
        ).fetchone()
        raise NotCurrent("NOT_CHECKED" if on_record is None else "OUT_OF_DATE")
    run = assurance._run(row)
    attributes = assurance._approved(connection, control_id)
    status: str
    if run.status in ("HELD", "READY", "FAILED") and assurance._changed(
        connection,
        run,
        assurance._basis(
            request,
            control,
            attributes,
            assurance._linked(connection, control_id),
            run.engine_version,
            assurance._Contexts(connection, project_id, control_id).sha256(request)
            if run.engine_version >= 2
            else "",
        ),
    ):
        status = "OUT_OF_DATE"
    elif run.stopped:
        status = "FAILED"
    else:
        status = assurance._STATUS.get(run.status, "FAILED")
    if status != "REVIEWED":
        raise NotCurrent(status)
    return request, run, attributes


def _current_check(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, requirement_id: UUID
) -> _Current:
    """The request's finished, current check (`current_run`): refused, with the sentence
    for its state, where it has none."""
    try:
        request, run, attributes = current_run(cursor, project_id, control_id, requirement_id)
    except NotCurrent as state:
        raise DispositionState(not_current(state.status) or CHECK_FAILED) from None
    return _Current(
        run_id=run.id,
        outcome=run.outcome,
        approved=frozenset(attribute[0] for attribute in attributes),
        in_force=frozenset(file.file_id for file in request.files),
    )


def _annotation_refusal(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    attribute_id: UUID,
    annotation_id: UUID,
    in_force: Collection[UUID],
) -> str | None:
    """Why the annotation cannot carry "Shown, on my review"; None where it can. Its row
    is locked against a removal until the act commits."""
    row = cursor.execute(
        """
        SELECT evidence_file_id, status, attribute_ids, kind FROM evidence_annotations
        WHERE id = %s AND project_id = %s AND engagement_control_id = %s
          AND requirement_id = %s
        FOR SHARE
        """,
        (annotation_id, project_id, control_id, requirement_id),
    ).fetchone()
    if row is None:
        return annotation_refusal(
            found=False, status="", kind="", names_attribute=False, file_in_force=False
        )
    return annotation_refusal(
        found=True,
        status=str(row[1]),
        kind=str(row[3]),
        names_attribute=str(attribute_id) in {str(item) for item in (row[2] or [])},
        file_in_force=UUID(str(row[0])) in in_force,
    )


def record(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    attribute_id: UUID,
    body: RecordBody,
    actor: UUID,
) -> UUID:
    """A person records a disposition of one attribute on one request. The one that stood
    there, if any, is kept and ended as REPLACED, but only where it is the one the person
    saw (`body.replaces`; none where they saw none). Refused, with nothing changed, by
    each rule of section 10.13."""
    organization_id = _scope(connection, project_id, control_id, requirement_id)
    reason = clean_reason(body.reason)
    relied_on = clean_relied_on(body.kind, body.relied_on)
    if body.kind == "SHOWN_ON_REVIEW" and body.annotation_id is None:
        raise DispositionState(ANNOTATION_NEEDED)
    if body.kind != "SHOWN_ON_REVIEW" and body.annotation_id is not None:
        raise DispositionState(ANNOTATION_NOT_TAKEN)
    with transaction(connection) as cursor:
        current = _current_check(cursor, project_id, control_id, requirement_id)
        if attribute_id not in current.approved:
            raise DispositionState(NOT_AN_ATTRIBUTE)
        if body.kind in CLOSING and contradicted(current.item(attribute_id)):
            raise DispositionState(ONLY_EXCEPTION)
        if body.annotation_id is not None:
            refusal = _annotation_refusal(
                cursor, project_id, control_id, requirement_id, attribute_id,
                body.annotation_id, current.in_force,
            )  # fmt: skip
            if refusal is not None:
                raise DispositionState(refusal)
        # What stands now, locked until the act commits, against what the person saw: one
        # the list leaves out (its annotation no longer stands) was never seen.
        standing = cursor.execute(
            """
            SELECT d.id,
                   d.annotation_id IS NULL
                   OR (a.status IN ('CONFIRMED', 'EDITED')
                       AND d.attribute_id = ANY(a.attribute_ids))
            FROM attribute_dispositions d
            LEFT JOIN evidence_annotations a ON a.id = d.annotation_id
            WHERE d.requirement_id = %s AND d.attribute_id = %s AND d.ended_at IS NULL
            FOR UPDATE OF d
            """,
            (requirement_id, attribute_id),
        ).fetchone()
        shown = None if standing is None or not standing[1] else UUID(str(standing[0]))
        refusal = stale_refusal(shown, body.replaces)
        if refusal is not None:
            raise DispositionState(refusal)
        replaced = None
        if standing is not None:
            replaced = cursor.execute(
                """
                UPDATE attribute_dispositions
                SET ended_at = clock_timestamp(), ended_by = %s, ended_as = 'REPLACED',
                    version = version + 1
                WHERE id = %s AND ended_at IS NULL
                RETURNING id, kind
                """,
                (actor, standing[0]),
            ).fetchone()
        row = cursor.execute(
            """
            INSERT INTO attribute_dispositions (
                organization_id, project_id, engagement_control_id, requirement_id,
                attribute_id, kind, reason, relied_on, annotation_id, assessment_id,
                recorded_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id, project_id, control_id, requirement_id, attribute_id,
                body.kind, reason, relied_on, body.annotation_id, current.run_id, actor,
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
        new = UUID(str(row[0]))
        _audit(
            cursor, organization_id, project_id, actor, RECORDED, requirement_id,
            {
                "control_id": str(control_id),
                "attribute_id": str(attribute_id),
                "disposition_id": str(new),
                "kind": body.kind,
                "reason": reason,
                "relied_on": relied_on,
                "annotation_id": None if body.annotation_id is None else str(body.annotation_id),
                "assessment_id": str(current.run_id),
                "replaced": None if replaced is None else str(replaced[0]),
                "replaced_kind": None if replaced is None else str(replaced[1]),
            },
        )  # fmt: skip
    return new


def reopen(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    attribute_id: UUID,
    body: ReopenBody,
    actor: UUID,
) -> UUID:
    """A person reopens the disposition they saw standing on an attribute of a request
    (`body.id`), with a reason: it is kept, ended as REOPENED, and no longer stands.
    Refused where none stands, and where the one that stands is not the one the person
    saw (another replaced it since the page loaded: never reopened unseen)."""
    organization_id = _scope(connection, project_id, control_id, requirement_id)
    reason = clean_reason(body.reason)
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            SELECT id, version, kind FROM attribute_dispositions
            WHERE requirement_id = %s AND attribute_id = %s AND engagement_control_id = %s
              AND project_id = %s AND ended_at IS NULL
            FOR UPDATE
            """,
            (requirement_id, attribute_id, control_id, project_id),
        ).fetchone()
        if row is None:
            raise DispositionState(NOTHING_STANDS)
        found = UUID(str(row[0]))
        if found != body.id or (body.version is not None and int(row[1]) != body.version):
            raise DispositionState(STALE)
        cursor.execute(
            """
            UPDATE attribute_dispositions
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
                "attribute_id": str(attribute_id),
                "disposition_id": str(found),
                "kind": str(row[2]),
                "reason": reason,
            },
        )  # fmt: skip
    return found


# --- What ends a disposition without the person asking ------------------------------------


def end_by_check(
    cursor: psycopg.Cursor[Any],
    *,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    run_id: UUID,
    outcome: Sequence[Mapping[str, Any]],
    in_force: Collection[UUID],
) -> int:
    """Called in the transaction that saves a finished run of a request (its outcome, the
    files in force on the request as the run read them): ends the dispositions standing on
    the request that the run's result no longer leaves standing (`ending_by_check`), each
    with its reason and one audit event with nobody as its actor. The run itself is not
    read again and nothing of it changes. How many it ended.

    Unlike the annotations a run proposes, this is not best effort: where it cannot end
    what the result no longer leaves standing, the run is not saved (a disposition must
    never stand against a contradiction the check on record shows). The one exception is
    a database without the table, where there is nothing to end."""
    standing: list[tuple[Any, ...]] = _where_recorded(
        cursor.connection,
        lambda: cursor.execute(
            """
            SELECT d.id, d.attribute_id, d.kind, a.evidence_file_id
            FROM attribute_dispositions d
            LEFT JOIN evidence_annotations a ON a.id = d.annotation_id
            WHERE d.requirement_id = %s AND d.ended_at IS NULL
            ORDER BY d.recorded_at, d.id
            FOR UPDATE OF d
            """,
            (requirement_id,),
        ).fetchall(),
        [],
    )
    if not standing:
        return 0
    by_attribute = {
        str(item.get("attribute_id")): item for item in outcome if isinstance(item, Mapping)
    }
    held = {str(file_id) for file_id in in_force}
    ended = 0
    for disposition_id, attribute_id, kind, file_id in standing:
        item = by_attribute.get(str(attribute_id))
        finds = check_finds(item)
        how = ending_by_check(str(kind), finds, file_id is None or str(file_id) in held)
        if how is None:
            continue
        reason = SUPERSEDED_REASON
        if how == "OVERTAKEN_BY_CHECK":
            # With the check's own stored sentence for the attribute.
            said = clean_line(str((item or {}).get("summary") or ""), _SENTENCE_MAX).strip()
            reason = f"{OVERTAKEN_REASON} {said}".strip()
        elif how == "ANNOTATION_GONE":
            reason = FILE_GONE_REASON
        cursor.execute(
            """
            UPDATE attribute_dispositions
            SET ended_at = clock_timestamp(), ended_as = %s, ended_reason = %s,
                version = version + 1
            WHERE id = %s AND ended_at IS NULL
            """,
            (how, reason[:REASON_MAX], disposition_id),
        )
        _audit(
            cursor, organization_id, project_id, None, ENDED_BY_CHECK, requirement_id,
            {
                "control_id": str(control_id),
                "attribute_id": str(attribute_id),
                "disposition_id": str(disposition_id),
                "kind": str(kind),
                "ended_as": how,
                "run_id": str(run_id),
                "finds": finds,
            },
        )  # fmt: skip
        ended += 1
    return ended


def end_for_annotation(
    cursor: psycopg.Cursor[Any], annotation_id: UUID, actor: UUID | None = None
) -> int:
    """Called in the transaction that removes an annotation or changes the attributes it
    names: a SHOWN_ON_REVIEW resting on it no longer stands once the annotation is out of
    its file's list or no longer names the attribute. It is kept, ended as ANNOTATION_GONE
    by the person who changed the annotation, with one audit event. How many it ended."""
    rows: list[tuple[Any, ...]] = _where_recorded(
        cursor.connection,
        lambda: cursor.execute(
            """
            UPDATE attribute_dispositions d
            SET ended_at = clock_timestamp(), ended_by = %s, ended_as = 'ANNOTATION_GONE',
                ended_reason = CASE WHEN a.status IN ('CONFIRMED', 'EDITED') THEN %s ELSE %s END,
                version = d.version + 1
            FROM evidence_annotations a
            WHERE d.annotation_id = %s AND d.ended_at IS NULL AND a.id = d.annotation_id
              AND NOT (a.status IN ('CONFIRMED', 'EDITED')
                       AND d.attribute_id = ANY(a.attribute_ids))
            RETURNING d.id, d.organization_id, d.project_id, d.engagement_control_id,
                      d.requirement_id, d.attribute_id, d.kind, d.ended_reason
            """,
            (actor, ANNOTATION_RENAMED_REASON, ANNOTATION_REMOVED_REASON, annotation_id),
        ).fetchall(),
        [],
    )
    for row in rows:
        _audit(
            cursor, UUID(str(row[1])), UUID(str(row[2])), actor, ANNOTATION_GONE_EVENT,
            UUID(str(row[4])),
            {
                "control_id": str(row[3]),
                "attribute_id": str(row[5]),
                "disposition_id": str(row[0]),
                "kind": str(row[6]),
                "ended_as": "ANNOTATION_GONE",
                "annotation_id": str(annotation_id),
                "reason": str(row[7]),
            },
        )  # fmt: skip
    return len(rows)


# --- The routes --------------------------------------------------------------------------


def register_attribute_dispositions(app: FastAPI, settings: Settings) -> None:
    from ai_workforce_api import evidence_assurance as assurance

    base = (
        "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"
        "/evidence-assurance/{requirement_id}/attributes/{attribute_id}/disposition"
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
                raise DispositionState(NOT_CHECKED)
            return body.requests[0]

        try:
            return _call(settings, work)
        except DispositionState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    @app.post(base, response_model=assurance.RequestBody)
    def record_disposition(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        attribute_id: UUID, body: RecordBody, request: Request,
    ) -> RequestBody:  # fmt: skip
        def act(connection: psycopg.Connection[Any], principal: Principal) -> None:
            record(
                connection, project_id, control_id, requirement_id, attribute_id, body,
                principal.id,
            )  # fmt: skip

        return run(request, organization_id, project_id, control_id, requirement_id, act)

    @app.post(f"{base}/reopen", response_model=assurance.RequestBody)
    def reopen_disposition(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        attribute_id: UUID, body: ReopenBody, request: Request,
    ) -> RequestBody:  # fmt: skip
        def act(connection: psycopg.Connection[Any], principal: Principal) -> None:
            reopen(
                connection, project_id, control_id, requirement_id, attribute_id, body,
                principal.id,
            )  # fmt: skip

        return run(request, organization_id, project_id, control_id, requirement_id, act)


__all__ = [
    "CLOSING",
    "KINDS",
    "KIND_WORDS",
    "Disposition",
    "DispositionBody",
    "DispositionState",
    "Dispositions",
    "EndedDispositionBody",
    "NotCurrent",
    "RecordBody",
    "ReopenBody",
    "StandingDispositionBody",
    "annotation_refusal",
    "check_finds",
    "clean_reason",
    "clean_relied_on",
    "contradicted",
    "current_run",
    "end_by_check",
    "end_for_annotation",
    "ending_by_check",
    "exceptions_on_record",
    "history_for",
    "load",
    "not_current",
    "record",
    "register_attribute_dispositions",
    "reopen",
    "signoff_facts",
    "stale_refusal",
    "standing_for",
]
