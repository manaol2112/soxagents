"""The D&I workpaper as its three views read it (docs/design-workpaper.md, section 2).

One read-only route assembles, in code and from the records alone, what the Document,
Matrix and Evidence views of a control's design workpaper are built from: the control, the
workpaper's own sections, the evidence index (`E1`, `E2`, ...), the approved attributes
with what the current checks of the control's D&I requests find, the walkthrough row by
row, the reports relied on, the matters for the reviewer and the conclusion.

Rules held here, whatever the records hold:

- No model is called and nothing is written, queued or sent: the route's work runs in a
  read-only transaction. No file's bytes or stored text are read.
- A check counts only while it is current: reviewed, and not out of date. One that is out
  of date, failed, cancelled, queued or running gives no state, mark, procedure or
  follow-up; the views are told so in a matter.
- Across requests the most cautious reading stands: an exception the records show, then
  what any current check leaves open, then shown. A tickmark never claims more than the
  state: agreed or compared only for an attribute that is shown by the records of an
  instance, on files whose reliability the check's review leaves no question about, with
  no check of it open and no comparison failed.
- A file is marked as showing an attribute, or an exception, only by a current check's
  own passages, never by an annotation alone.
- A sentence is the check's, the workpaper section's or the annotation's own stored
  words, or it is written here from a state or a count. A procedure is listed only where
  the records show it was done.
- A conclusion is signed only where the D&I conclusion's own sign-off record stands
  (design_conclusions). Nothing here signs, prepares or decides.
- A person's disposition of an attribute (docs/evidence-assurance.md, section 10.13) is
  read only on a request whose check is current, and only where the checks do not show
  the attribute themselves: an exception a check shows wins over every disposition, what
  another request's check leaves open still waits, and an attribute a check shows stays
  "Shown". An attribute that reads by a disposition is never marked as agreed or compared,
  never counted as shown by the records, and every disposition is a matter for the
  reviewer with the person, the date and the reason.

The first part is pure (no database): the records as plain values in, the response's
parts out. The loader then reads each kind of record once for the control.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, cast
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ai_workforce_api import assurance_facts, design_conclusions, workpaper_service
from ai_workforce_api import evidence_assurance as assurance
from ai_workforce_api.assurance_facts import OutcomeStatus
from ai_workforce_api.assurance_review import Assessment, _reliability, assessment_of
from ai_workforce_api.attribute_dispositions import CLOSING, Disposition, standing_for
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
    permits,
)
from ai_workforce_api.engagement_close import CLOSED
from ai_workforce_api.evidence_annotations import _order as annotation_order
from ai_workforce_api.evidence_classify import KIND_LABELS as FILE_KIND_WORDS
from ai_workforce_api.evidence_findings import OPEN as FINDING_OPEN
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.settings import Settings
from ai_workforce_api.workpaper_fill import _ACTIVITY_ROLES, Content, Section
from ai_workforce_api.workpapers import (
    BY_KEY,
    KIND_LABELS,
    PERIOD_CODES,
    default_template,
    workpaper_reference,
)

logger = logging.getLogger(__name__)

# --- The vocabulary of the response (docs/design-workpaper.md, section 2) --------------

# The last three are a person's disposition of the attribute (docs/evidence-assurance.md,
# section 10.13), read only where the checks do not show the attribute themselves.
AttributeState = Literal[
    "EXCEPTION", "SHOWN", "SHOWN_IN_PART", "NOT_SHOWN", "NOT_CONCLUDED", "NOT_TESTED",
    "SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE",
]  # fmt: skip
# REVIEWED: the file holds the person's annotation a "Shown, auditor's judgment" rests on.
Mark = Literal["EXCEPTION", "SHOWS", "REVIEWED", "IDENTIFIES", "SOURCE"]
Tickmark = Literal["COMPARED", "AGREED", "REVIEWED", "EXCEPTION", "NONE"]
LegendMark = Literal["AGREED", "COMPARED", "INSPECTED", "REVIEWED", "EXCEPTION"]
MatterState = Literal["OPEN", "NOTED"]
MatterKind = Literal[
    "FINDING", "FOLLOW_UP", "CONSIDERATION", "UNSETTLED", "FILE", "COMPLETENESS",
    "DISPOSITION", "NOTE",
]  # fmt: skip
SectionSource = Literal["RECORDS", "AGENT", "PERSON"]
WorkpaperStatus = Literal["DRAFT", "PREPARED"]
CheckStatus = assurance.RequestStatus

MAX_EVIDENCE = 60
MAX_MATTERS = 12
MAX_PROCEDURES = 8
MAX_REPORTS = 20
MAX_FACTS = 60
MAX_REFS = 8
MAX_CHECKS = 6
MAX_FINDINGS = 60
SENTENCE_LIMIT = 600
# A sentence that carries a person's own reason for a disposition (at most 1,000
# characters) and what was relied on instead (600).
DISPOSITION_LIMIT = 2000
NAME_LIMIT = 200
CELL_LIMIT = 1000

# Across requests the most cautious reading stands (section 2): an exception the records
# show on any check; then what any current check of a request that asks for the attribute
# leaves open, even where another request shows it; then shown, shown in part, not shown.
_PRECEDENCE: tuple[AttributeState, ...] = (
    "EXCEPTION", "NOT_CONCLUDED", "SHOWN", "SHOWN_IN_PART", "NOT_SHOWN", "NOT_TESTED",
)  # fmt: skip
STATE_WORDS: dict[AttributeState, str] = {
    "EXCEPTION": "Exception shown",
    "SHOWN": "Shown",
    "SHOWN_IN_PART": "Shown in part",
    "NOT_SHOWN": "Not shown",
    "NOT_CONCLUDED": "Not concluded",
    "NOT_TESTED": "Not tested yet",
}
# The sentence for a state where the check stored none: written here, from the state.
STATE_BASIS: dict[AttributeState, str] = {
    "EXCEPTION": "The records show this attribute is not met.",
    "SHOWN": "The evidence checked shows this attribute.",
    "SHOWN_IN_PART": "Part of this attribute is shown; the rest is not in the files checked.",
    "NOT_SHOWN": "The evidence checked does not show this attribute.",
    "NOT_CONCLUDED": "The check leaves this attribute to a person.",
    "NOT_TESTED": "No current check covers this attribute.",
}
ONLY_OUT_OF_DATE = "The only check that covers this attribute is out of date."
_FROM_ASSESSMENT: dict[Assessment, AttributeState] = {
    "CONTRADICTED": "EXCEPTION",
    "SATISFIED": "SHOWN",
    "PARTIALLY_SUPPORTED": "SHOWN_IN_PART",
    "NOT_DEMONSTRATED": "NOT_SHOWN",
    "INDETERMINATE": "NOT_CONCLUDED",
}
# A person's disposition as the attribute's state, in words. Never the plain "Shown".
DISPOSITION_WORDS: dict[str, str] = {
    "SHOWN_ON_REVIEW": "Shown, auditor's judgment",
    "NOT_APPLICABLE": "Not applicable to this instance",
    "NOT_AVAILABLE": "Evidence not available, accepted",
}
# Where an attribute has dispositions of several kinds on its requests, it reads by the
# most cautious: an accepted limitation, then not applicable, then the person's own
# reading of the evidence.
_DISPOSITION_PRECEDENCE: tuple[str, ...] = ("NOT_AVAILABLE", "NOT_APPLICABLE", "SHOWN_ON_REVIEW")
# The checks' states a disposition never stands against: an exception a check shows, what
# a check of another request leaves open, and an attribute the checks show themselves.
_OVER_A_DISPOSITION: frozenset[str] = frozenset({"EXCEPTION", "NOT_CONCLUDED", "SHOWN"})
_MARK_RANK: dict[Mark, int] = {
    "EXCEPTION": 0, "SHOWS": 1, "REVIEWED": 2, "IDENTIFIES": 3, "SOURCE": 4,
}  # fmt: skip
VERDICT_WORDS: dict[str, str] = {"EFFECTIVE": "Effective", "NOT_EFFECTIVE": "Not effective"}
NOT_CONCLUDED_WORDS = "Not concluded yet"
SEPARATE_NOTE = (
    "Operating effectiveness is tested separately; this workpaper covers design and "
    "implementation only."
)
# The gate's codes a person has nothing to do about: the file is left out by purpose.
_LEFT_OUT_BY_PURPOSE = frozenset({"POPULATION"})


class ControlBody(BaseModel):
    id: UUID
    ref: str
    title: str
    # The application the control is tested on; "" where it has none.
    system: str
    engagement: str
    # The control's area in words ("IT general controls"); "" where it is not known.
    area: str


class WorkpaperRefBody(BaseModel):
    id: UUID
    reference: str
    status: WorkpaperStatus
    drafting: bool
    # The record's version, as the existing actions take it.
    version: int
    shown_version: int
    current_version: int
    prepared_by: str | None
    prepared_at: datetime | None


class ReviewStateBody(BaseModel):
    """The D&I conclusion's sign-off as design_conclusions reads it."""

    status: design_conclusions.Status
    proposed: design_conclusions.Verdict | None
    # The sign-off that stands, current or out of date; null where none stands.
    signed_verdict: design_conclusions.Verdict | None
    signed_by: str | None
    signed_at: datetime | None
    out_of_date: list[str] = Field(default_factory=list)


class FactBody(BaseModel):
    label: str
    value: str


class EvidenceBody(BaseModel):
    ref: str
    file_id: UUID
    file_name: str
    kind: str
    kind_words: str
    requirement_id: UUID
    requirement_title: str
    # The annotations listed for the file on that request, and how many a person reviewed.
    annotations: int
    reviewed: int
    # The gate's sentence where the request's current check left the file out.
    left_out: str | None
    image: bool


class StepBody(BaseModel):
    number: int
    when: str
    step: str
    who: str
    evidence: str
    result: str
    refs: list[str] = Field(default_factory=list)


class WalkthroughBody(BaseModel):
    columns: list[str] = Field(default_factory=list)
    steps: list[StepBody] = Field(default_factory=list)
    source: SectionSource = "RECORDS"


class AttributeRefBody(BaseModel):
    ref: str
    annotation_ids: list[UUID] = Field(default_factory=list)
    numbers: list[int] = Field(default_factory=list)


class AttributeBody(BaseModel):
    id: UUID
    code: str
    text: str
    state: AttributeState
    state_words: str
    basis: str
    tickmark: Tickmark
    refs: list[AttributeRefBody] = Field(default_factory=list)
    marks: dict[str, Mark] = Field(default_factory=dict)
    checks: list[str] = Field(default_factory=list)
    notes: str = ""


class ReportBody(BaseModel):
    # The evidence entry the row names; "" where it names none of the files in force.
    ref: str
    report: str
    source: str
    procedure: str


class MatterBody(BaseModel):
    state: MatterState
    kind: MatterKind
    text: str
    refs: list[str] = Field(default_factory=list)


class ConclusionBody(BaseModel):
    text: str
    source: SectionSource
    proposed: design_conclusions.Verdict | None
    # The signed verdict in words where a sign-off stands, else the proposed one's.
    words: str
    # True only from the D&I conclusion's own sign-off record, while it holds.
    signed: bool


class TickmarkBody(BaseModel):
    mark: LegendMark
    symbol: str
    meaning: str


class DesignWorkpaperBody(BaseModel):
    control: ControlBody
    workpaper: WorkpaperRefBody | None
    review: ReviewStateBody
    risk: str
    activity: str
    facts: list[FactBody] = Field(default_factory=list)
    understanding: str
    procedures: list[str] = Field(default_factory=list)
    evidence: list[EvidenceBody] = Field(default_factory=list)
    walkthrough: WalkthroughBody
    attributes: list[AttributeBody] = Field(default_factory=list)
    reports: list[ReportBody] = Field(default_factory=list)
    matters: list[MatterBody] = Field(default_factory=list)
    conclusion: ConclusionBody
    tickmarks: list[TickmarkBody] = Field(default_factory=list)
    can_edit: bool


# The legend, fixed in code. The entry for a report's parameters is given only where a
# procedure of the same response says they were inspected (`legend`).
TICKMARKS: tuple[TickmarkBody, ...] = (
    TickmarkBody(
        mark="AGREED",
        symbol="✓",
        meaning="Agreed to the system's own record without exception.",
    ),
    TickmarkBody(
        mark="COMPARED",
        symbol="≡",
        meaning="Dates or values compared in code, within what the attribute allows.",
    ),
    TickmarkBody(mark="INSPECTED", symbol="◊", meaning="Report parameters inspected."),
    TickmarkBody(mark="EXCEPTION", symbol="✗", meaning="Exception shown."),
)
# The mark of an attribute that reads "Shown, auditor's judgment". Its legend entry is
# given only where an attribute of the same response carries it (`legend`).
REVIEWED_TICKMARK = TickmarkBody(
    mark="REVIEWED",
    symbol="†",
    meaning="On the auditor's review, with the reason recorded.",
)


# --- The records, as plain values ------------------------------------------------------


class _Lenient(BaseModel):
    model_config = ConfigDict(extra="ignore")


class StoredPassage(_Lenient):
    file_id: UUID


class StoredElement(_Lenient):
    key: str = ""
    result: str | None = None
    passages: list[StoredPassage] = Field(default_factory=list)
    # Both readings rest the element's shortfall on the same record: an exception shown.
    deviation: bool = False


class StoredCheck(_Lenient):
    status: OutcomeStatus
    sentence: str = ""


class StoredOutcome(_Lenient):
    """One attribute of a finished check, as evidence_assessments.outcome keeps it
    (evidence_assurance.Outcome.as_json): only what this view reads of it."""

    attribute_id: UUID
    expected: bool = False
    verdict: assurance.Verdict
    result: str | None = None
    summary: str = ""
    # For a supported attribute: DESIGN (a document requires it) or IMPLEMENTATION (the
    # records of an instance show it).
    shows: assurance.Shows | None = None
    passages: list[StoredPassage] = Field(default_factory=list)
    elements: list[StoredElement] = Field(default_factory=list)
    assessment: Assessment | None = None
    checks: list[StoredCheck] = Field(default_factory=list)


@dataclass(frozen=True)
class FileRecord:
    file_id: UUID
    file_name: str
    kind: str
    content_type: str = ""


@dataclass(frozen=True)
class RequestRecord:
    """A D&I request of the control with the files in force on it, in the list's order."""

    requirement_id: UUID
    title: str
    files: tuple[FileRecord, ...]
    # The approved attributes the request asks for.
    asks: frozenset[UUID] = frozenset()


@dataclass(frozen=True)
class HeldFile:
    file_id: UUID
    code: str
    reason: str


@dataclass(frozen=True)
class CheckRecord:
    """The latest check of one request, as the D&I evidence list reads it."""

    requirement_id: UUID
    status: CheckStatus
    run_id: UUID | None = None
    engine: int = 2
    # The files its readings included, those of them read only in part, and those its
    # gate left out.
    file_ids: tuple[UUID, ...] = ()
    partial: tuple[UUID, ...] = ()
    held: tuple[HeldFile, ...] = ()
    outcome: tuple[StoredOutcome, ...] = ()
    review: assurance.ReviewBody | None = None
    out_of_date: tuple[str, ...] = ()

    @property
    def current(self) -> bool:
        """Whether its result may be used: reviewed, and not out of date. Anything else
        (out of date, failed, stopped, queued, running, held whole) gives no result."""
        return self.status == "REVIEWED"

    @property
    def gated(self) -> bool:
        """Whether its gate's word on the files stands: a current check, or one its gate
        held whole."""
        return self.status in ("REVIEWED", "HELD")


@dataclass(frozen=True)
class AnnotationRecord:
    id: UUID
    requirement_id: UUID
    file_id: UUID
    kind: Mark
    status: str
    origin: str
    attribute_ids: tuple[UUID, ...]
    # The run that proposed it; None for a person's own.
    assessment_id: UUID | None
    # Its place in the list of its file on its request, from 1, as the viewer numbers it.
    number: int


@dataclass(frozen=True)
class FindingRecord:
    id: UUID
    title: str
    file_id: UUID | None = None


@dataclass(frozen=True)
class AttributeRecord:
    id: UUID
    code: str
    text: str


# --- One check's word on one attribute --------------------------------------------------


@dataclass(frozen=True)
class Reading:
    """What one current check finds of one attribute."""

    requirement_id: UUID
    state: AttributeState
    basis: str
    # The check leaves it to a person.
    open: bool = False
    # The files holding the verified passages of what is shown, and of an exception.
    shows: tuple[UUID, ...] = ()
    exceptions: tuple[UUID, ...] = ()
    # A comparison made in code passed for it; one failed, on both readings or on one.
    compared: bool = False
    failed: bool = False
    # The sentences of the comparisons code made for it: those that passed, and the rest.
    checks: tuple[str, ...] = ()
    failed_checks: tuple[str, ...] = ()
    # What is shown is the implementation (the records of an instance), not only what a
    # document requires.
    implementation: bool = False
    # The check's review leaves a reliability question open on the files it rests on.
    unreliable: bool = False


def _distinct[T](items: Iterable[T]) -> tuple[T, ...]:
    return tuple(dict.fromkeys(items))


def _sentence(text: str, limit: int = SENTENCE_LIMIT) -> str:
    return clean_line(text, limit).strip()


def _stored_assessment(item: StoredOutcome) -> Assessment | None:
    """What the attribute's evidence shows: as the check recorded it (engine 2), else
    from the check's own verdict, result and element results by the same table
    (assurance_review.assessment_of), which is how an engine 1 check is read."""
    if item.assessment is not None:
        return item.assessment
    deviation = any(element.deviation for element in item.elements)
    return assessment_of(
        verdict=item.verdict,
        result=item.result,
        expected=item.expected,
        deviation=item.verdict == "ISSUE" and deviation,
        exception_unchecked=item.verdict == "UNSETTLED" and deviation,
    )


def reliability_open(check: CheckRecord, files: Iterable[UUID]) -> bool:
    """Whether a check's review leaves a reliability question open on the files a showing
    rests on: its completeness says reliability is unresolved, or one of the files is
    described as prepared by a person, of a source not shown, or a report that does not
    show its basis (assurance_review._reliability), or is not described at all. An engine
    1 check made no such review, so the question was never answered and stays open (it
    earns no tickmark); so does an engine 2 check whose review cannot be read."""
    if check.engine < 2:
        return True
    if check.review is None or check.review.completeness.state == "RELIABILITY_UNRESOLVED":
        return True
    said = {file.file_id: file for file in check.review.files}
    for file_id in files:
        found = said.get(file_id)
        if found is None or _reliability("", found.source, found.report_basis):
            return True
    return False


def readings_of(check: CheckRecord) -> dict[UUID, Reading]:
    """Each attribute a current check has a word on. A check that is not current gives
    nothing, whatever it holds. An attribute the request does not ask for is given only
    where the records contradict it; a comparison that failed for it is kept all the
    same, with no state, so that nothing is marked as agreed beside it. An engine 1 check
    has no comparisons."""
    if not check.current:
        return {}
    found: dict[UUID, Reading] = {}
    for item in check.outcome:
        made = [c for c in item.checks if c.status != "NOT_RUN"] if check.engine >= 2 else []
        passed = [c for c in made if c.status == "PASSED"]
        other = [c for c in made if c.status != "PASSED"]
        fell = _distinct(s for c in other if (s := _sentence(c.sentence, 400)))
        assessment = _stored_assessment(item)
        if assessment is None:
            if other:
                found[item.attribute_id] = Reading(
                    requirement_id=check.requirement_id,
                    state="NOT_TESTED",
                    basis=STATE_BASIS["NOT_TESTED"],
                    failed=True,
                    failed_checks=fell,
                )
            continue
        state = _FROM_ASSESSMENT[assessment]
        # Never expected: the check takes support away where a comparison fails. Held
        # here too, so a failed comparison can never sit beside "shown".
        if state in ("SHOWN", "SHOWN_IN_PART") and other:
            state = "NOT_CONCLUDED"
        exceptions: tuple[UUID, ...] = ()
        if state == "EXCEPTION":
            exceptions = _distinct(
                [
                    *(p.file_id for e in item.elements if e.deviation for p in e.passages),
                    *(p.file_id for p in item.passages if item.result == "CONTRADICTED"),
                ]
            )
        shows: tuple[UUID, ...] = ()
        if item.expected:
            shows = _distinct(
                p.file_id
                for e in item.elements
                if e.result == "MET" and not e.deviation
                for p in e.passages
            )
            if not item.elements and item.verdict in ("SUPPORTED", "PARTLY_SUPPORTED"):
                shows = _distinct(p.file_id for p in item.passages)
        found[item.attribute_id] = Reading(
            requirement_id=check.requirement_id,
            state=state,
            basis=_sentence(item.summary) or STATE_BASIS[state],
            open=item.verdict == "UNSETTLED" or state == "NOT_CONCLUDED",
            shows=shows,
            exceptions=exceptions,
            compared=bool(passed),
            failed=bool(other),
            checks=_distinct(s for c in passed if (s := _sentence(c.sentence, 400))),
            failed_checks=fell,
            implementation=item.shows == "IMPLEMENTATION",
            unreliable=reliability_open(check, shows),
        )
    return found


def standing(readings: Sequence[Reading]) -> tuple[AttributeState, str]:
    """The state that stands across the current checks, the most cautious first, and the
    first check's sentence for it: an exception on any check; then what a check leaves
    open, even where another request shows the attribute; then shown, shown in part, not
    shown. NOT_TESTED where none covers the attribute."""
    for state in _PRECEDENCE:
        for reading in readings:
            if reading.state == state:
                return state, reading.basis
    return "NOT_TESTED", STATE_BASIS["NOT_TESTED"]


def tickmark_of(state: AttributeState, readings: Sequence[Reading]) -> Tickmark:
    """The mark never claims more than the state. EXCEPTION for an exception. COMPARED or
    AGREED only where the attribute is shown, a check that shows it shows the
    implementation (not only what a document requires), that check's review leaves no
    reliability question open on the files it rests on, and no current check of the
    attribute is open or holds a comparison that failed: COMPARED where a comparison made
    in code passed on that check, AGREED otherwise. NONE in every other case."""
    if state == "EXCEPTION":
        return "EXCEPTION"
    if state != "SHOWN" or any(reading.open or reading.failed for reading in readings):
        return "NONE"
    resting = [
        reading
        for reading in readings
        if reading.state == "SHOWN" and reading.implementation and not reading.unreliable
    ]
    if not resting:
        return "NONE"
    return "COMPARED" if any(reading.compared for reading in resting) else "AGREED"


# --- The evidence index -----------------------------------------------------------------


def _is_image(content_type: str) -> bool:
    return content_type.strip().lower().startswith("image/")


def _listed(annotation: AnnotationRecord) -> bool:
    return annotation.status not in ("REMOVED", "SUPERSEDED")


def evidence_index(
    requests: Sequence[RequestRecord],
    checks: Mapping[UUID, CheckRecord],
    annotations: Sequence[AnnotationRecord],
) -> tuple[list[EvidenceBody], int]:
    """Every file in force on a D&I request, once each under its first request, in the
    order of the list, numbered E1 on; and how many more there are than are listed."""
    counted: dict[tuple[UUID, UUID], list[AnnotationRecord]] = {}
    for annotation in annotations:
        if _listed(annotation):
            counted.setdefault((annotation.requirement_id, annotation.file_id), []).append(
                annotation
            )
    seen: set[UUID] = set()
    found: list[EvidenceBody] = []
    more = 0
    for request in requests:
        check = checks.get(request.requirement_id)
        held = {h.file_id: h.reason for h in check.held} if check and check.gated else {}
        for file in request.files:
            if file.file_id in seen:
                continue
            seen.add(file.file_id)
            if len(found) >= MAX_EVIDENCE:
                more += 1
                continue
            mine = counted.get((request.requirement_id, file.file_id), [])
            reason = held.get(file.file_id)
            found.append(
                EvidenceBody(
                    ref=f"E{len(found) + 1}",
                    file_id=file.file_id,
                    file_name=clean_line(file.file_name, NAME_LIMIT),
                    kind=file.kind,
                    kind_words=FILE_KIND_WORDS.get(file.kind, FILE_KIND_WORDS["other"]),
                    requirement_id=request.requirement_id,
                    requirement_title=clean_line(request.title, 300),
                    annotations=len(mine),
                    reviewed=sum(1 for a in mine if a.status in ("CONFIRMED", "EDITED")),
                    left_out=None if reason is None else _sentence(reason),
                    image=_is_image(file.content_type),
                )
            )
    return found, more


def _refs(file_ids: Iterable[UUID], evidence: Sequence[EvidenceBody]) -> list[str]:
    """The entries of the index for some files, in the index's order."""
    wanted = set(file_ids)
    return [entry.ref for entry in evidence if entry.file_id in wanted][:MAX_REFS]


# --- The attributes ---------------------------------------------------------------------


def _stands(
    annotation: AnnotationRecord, current: frozenset[UUID], in_force: frozenset[UUID]
) -> bool:
    """Whether an annotation stands: listed, on a file still in force, and either a
    person made, confirmed or edited it, or it is the agent's proposal and the check of
    its own request is current (`current`: the requests whose check is). The run that
    first proposed it does not decide: a later run that still cites a passage keeps the
    annotation, with the earlier run's id, and supersedes the proposals it no longer
    cites (evidence_annotations._write_proposals)."""
    if not _listed(annotation) or annotation.file_id not in in_force:
        return False
    return (
        annotation.origin == "PERSON"
        or annotation.status in ("CONFIRMED", "EDITED")
        or annotation.requirement_id in current
    )


def annotations_standing(
    annotations: Sequence[AnnotationRecord],
    requests: Sequence[RequestRecord],
    checks: Mapping[UUID, CheckRecord],
) -> list[AnnotationRecord]:
    """The annotations that stand (`_stands`), of those on record for the control."""
    current = frozenset(requirement_id for requirement_id, check in checks.items() if check.current)
    in_force = frozenset(file.file_id for request in requests for file in request.files)
    return [a for a in annotations if _stands(a, current, in_force)]


def marks_of(
    attribute_id: UUID,
    readings: Sequence[Reading],
    standing_annotations: Sequence[AnnotationRecord],
    requests: Sequence[RequestRecord],
    evidence: Sequence[EvidenceBody],
    reviewed: Sequence[AnnotationRecord] = (),
) -> dict[str, Mark]:
    """Per file of the index, the strongest thing it does for the attribute. The record of
    an exception and a passage that shows it come only from the current checks' own
    passages, never from an annotation alone. What identifies the right system, person or
    date, and where the file comes from, come from the annotations that stand
    (`annotations_standing`); one that names no attribute (a file's source) bears on the
    attributes its request asks for. `reviewed` are the person's annotations a standing
    "Shown, auditor's judgment" of the attribute rests on (`reviewed_annotations`): their
    files are marked REVIEWED, never as shown by a check."""
    asks = {request.requirement_id: request.asks for request in requests}
    best: dict[UUID, Mark] = {}

    def give(file_id: UUID, mark: Mark) -> None:
        held = best.get(file_id)
        if held is None or _MARK_RANK[mark] < _MARK_RANK[held]:
            best[file_id] = mark

    for reading in readings:
        for file_id in reading.exceptions:
            give(file_id, "EXCEPTION")
        for file_id in reading.shows:
            give(file_id, "SHOWS")
    for annotation in reviewed:
        give(annotation.file_id, "REVIEWED")
    for annotation in standing_annotations:
        if annotation.kind not in ("IDENTIFIES", "SOURCE"):
            continue
        bears = (
            attribute_id in annotation.attribute_ids
            if annotation.attribute_ids
            else attribute_id in asks.get(annotation.requirement_id, frozenset())
        )
        if bears:
            give(annotation.file_id, annotation.kind)
    return {entry.ref: best[entry.file_id] for entry in evidence if entry.file_id in best}


def attribute_refs(
    attribute_id: UUID,
    readings: Sequence[Reading],
    standing_annotations: Sequence[AnnotationRecord],
    evidence: Sequence[EvidenceBody],
    reviewed: Sequence[AnnotationRecord] = (),
) -> list[AttributeRefBody]:
    """The files the attribute's verified passages are in, each with the annotations on
    it that stand and name the attribute, numbered as the annotation viewer numbers them
    (the list of the file on the request its entry is under). A proposal of a check that
    is no longer current is never cited. The files of the person's annotations a standing
    "Shown, auditor's judgment" rests on (`reviewed`) are listed too."""
    files = {file_id for reading in readings for file_id in (*reading.shows, *reading.exceptions)}
    files.update(annotation.file_id for annotation in reviewed)
    found: list[AttributeRefBody] = []
    for entry in evidence:
        if entry.file_id not in files:
            continue
        naming = sorted(
            (
                a
                for a in standing_annotations
                if a.file_id == entry.file_id
                and a.requirement_id == entry.requirement_id
                and attribute_id in a.attribute_ids
            ),
            key=lambda a: a.number,
        )
        found.append(
            AttributeRefBody(
                ref=entry.ref,
                annotation_ids=[a.id for a in naming],
                numbers=[a.number for a in naming],
            )
        )
    return found


def _column(columns: Sequence[str], *names: str, starts: bool = False) -> int | None:
    for index, column in enumerate(columns):
        head = " ".join(column.split()).casefold()
        if any(head.startswith(name) if starts else head == name for name in names):
            return index
    return None


_LETTERED = re.compile(r"^([a-z]{1,2})[.)]\s*(.*)$")


def attribute_notes(section: Section | None, code: str, text: str) -> str:
    """The preparer's own note for an attribute: the "Notes" cell of its row in the
    workpaper's attribute section, as stored. The row is the attribute's by its wording:
    where the first cell carries wording (after a letter or alone), the wording must be
    the attribute's own, whatever letter stands before it (the attributes may have been
    put in another order since). Only a cell that is a letter alone is taken by its
    letter. "" where the section has no such column or no such row."""
    if section is None or section.kind != "table":
        return ""
    at = _column(section.columns, "notes")
    if at is None:
        return ""
    letter = code.strip().casefold()
    wording = " ".join(text.split()).casefold()
    for row in section.rows:
        first = " ".join((row[0] if row else "").split()).casefold()
        lettered = _LETTERED.match(first)
        if lettered is not None:
            given, rest = lettered.group(1), lettered.group(2)
        elif first == letter:
            given, rest = first, ""
        else:
            given, rest = "", first
        mine = rest == wording if rest else bool(given) and given == letter
        if mine and wording:
            return row[at][:CELL_LIMIT] if at < len(row) else ""
    return ""


# --- A person's dispositions (docs/evidence-assurance.md, section 10.13) -----------------


def dispositions_applying(
    dispositions: Sequence[Disposition],
    checks: Mapping[UUID, CheckRecord],
    standing_annotations: Sequence[AnnotationRecord],
) -> dict[UUID, list[Disposition]]:
    """The standing dispositions that are read, by attribute. Only one on a request whose
    check is current: a check that is out of date, failed, queued, running, held or never
    made gives nothing, and neither does a disposition recorded on it. A "Shown, on my
    review" only while the annotation it rests on stands (`annotations_standing`), a
    person made, confirmed or edited it, and it names the attribute."""
    resting = {
        (annotation.id, attribute_id)
        for annotation in standing_annotations
        if annotation.status in ("CONFIRMED", "EDITED")
        for attribute_id in annotation.attribute_ids
    }
    found: dict[UUID, list[Disposition]] = {}
    for disposition in dispositions:
        check = checks.get(disposition.requirement_id)
        if check is None or not check.current or disposition.ended_at is not None:
            continue
        if (
            disposition.kind == "SHOWN_ON_REVIEW"
            and (disposition.annotation_id, disposition.attribute_id) not in resting
        ):
            continue
        found.setdefault(disposition.attribute_id, []).append(disposition)
    return found


def reviewed_annotations(
    dispositions: Sequence[Disposition], standing_annotations: Sequence[AnnotationRecord]
) -> list[AnnotationRecord]:
    """The person's annotations that an attribute's "Shown, on my review" dispositions
    (of `dispositions_applying`) rest on."""
    wanted = {d.annotation_id for d in dispositions if d.kind == "SHOWN_ON_REVIEW"}
    return [annotation for annotation in standing_annotations if annotation.id in wanted]


def read_by(closing: Sequence[Disposition]) -> Disposition:
    """Of an attribute's dispositions that close it, the one it reads by: the most
    cautious kind, and of one kind the earliest recorded."""
    return min(
        closing,
        key=lambda d: (_DISPOSITION_PRECEDENCE.index(d.kind), d.recorded_at, str(d.id)),
    )


def _day(when: datetime) -> str:
    return f"{when.day} {when:%B %Y}"


def _closed(text: str) -> str:
    """A person's text ended as a sentence."""
    text = text.strip()
    return text if not text or text[-1] in ".!?" else f"{text}."


def _recorded(disposition: Disposition) -> str:
    """Who recorded a disposition and when: "by Dana Lee on 14 November 2026"."""
    name = clean_line(disposition.recorded_by_name, 120).strip() or "a person"
    return f"by {name} on {_day(disposition.recorded_at)}"


def disposition_basis(disposition: Disposition, found: str = "") -> str:
    """The sentence of an attribute that reads by a person's disposition: who recorded it
    and when, the person's own reason, what was relied on instead, and beside it what the
    check of that request itself found (`found`, the check's own sentence), which a
    disposition never changes."""
    parts = [f"Recorded {_recorded(disposition)}: {_closed(disposition.reason)}"]
    if disposition.relied_on:
        parts.append(f"Relied on instead: {_closed(disposition.relied_on)}")
    if found:
        parts.append(f"The check found: {_closed(found)}")
    return _sentence(" ".join(parts), DISPOSITION_LIMIT)


def disposition_matters(
    attributes: Sequence[AttributeRecord],
    applying: Mapping[UUID, Sequence[Disposition]],
    standing_annotations: Sequence[AnnotationRecord],
    evidence: Sequence[EvidenceBody],
) -> list[MatterBody]:
    """Each disposition that is read, as a matter for the reviewer, with the person, the
    date and the reason: noted, but for an exception a person recorded, which closes
    nothing and stays open until it is evaluated."""
    files = {annotation.id: annotation.file_id for annotation in standing_annotations}
    found: list[MatterBody] = []
    for attribute in attributes:
        for disposition in applying.get(attribute.id, ()):
            if disposition.kind == "EXCEPTION":
                text = (
                    f"Attribute {attribute.code}: an exception recorded "
                    f"{_recorded(disposition)}, still to be evaluated. "
                    f"Reason: {_closed(disposition.reason)}"
                )
            else:
                text = (
                    f"Attribute {attribute.code}: "
                    f"“{DISPOSITION_WORDS[disposition.kind]}”, recorded "
                    f"{_recorded(disposition)}. Reason: {_closed(disposition.reason)}"
                )
                if disposition.relied_on:
                    text += f" Relied on instead: {_closed(disposition.relied_on)}"
            on = files.get(disposition.annotation_id) if disposition.annotation_id else None
            found.append(
                MatterBody(
                    state="OPEN" if disposition.kind == "EXCEPTION" else "NOTED",
                    kind="DISPOSITION",
                    text=_sentence(text, DISPOSITION_LIMIT),
                    refs=_refs([] if on is None else [on], evidence),
                )
            )
    return found


def attributes_of(
    attributes: Sequence[AttributeRecord],
    requests: Sequence[RequestRecord],
    checks: Mapping[UUID, CheckRecord],
    annotations: Sequence[AnnotationRecord],
    evidence: Sequence[EvidenceBody],
    section: Section | None,
    dispositions: Sequence[Disposition] = (),
) -> tuple[list[AttributeBody], dict[UUID, list[Reading]]]:
    """Each approved attribute with what the current checks find across the control's D&I
    requests, in the list's order; and the checks' words on each, for the matters.

    A person's disposition (`dispositions`: those standing on the control) stands in for
    the check of its own request, unless that check shows the attribute or an exception.
    Across requests the most cautious reading still stands: an exception on any check,
    then what a check of another request leaves open, then shown by a check; only then
    does the attribute read by the disposition, in its own state and words, with the mark
    REVIEWED for "Shown, auditor's judgment" and none for the others. The checks' words
    given back for the matters leave out what a disposition stands in for."""
    by_attribute: dict[UUID, list[Reading]] = {}
    for request in requests:
        check = checks.get(request.requirement_id)
        if check is None:
            continue
        for attribute_id, reading in readings_of(check).items():
            by_attribute.setdefault(attribute_id, []).append(reading)
    stale = {
        attribute_id
        for request in requests
        if (check := checks.get(request.requirement_id)) is not None
        and check.status == "OUT_OF_DATE"
        for attribute_id in request.asks
    }
    stand = annotations_standing(annotations, requests, checks)
    applying = dispositions_applying(dispositions, checks, stand)
    left_to_checks = dict(by_attribute)
    found: list[AttributeBody] = []
    for attribute in attributes:
        readings = by_attribute.get(attribute.id, [])
        mine = applying.get(attribute.id, [])
        closing = [d for d in mine if d.kind in CLOSING]
        closed_on = {d.requirement_id for d in closing}
        # What the checks still say for themselves: a disposition stands in for the check
        # of its own request, never for one that shows the attribute or an exception.
        left = [
            reading
            for reading in readings
            if reading.requirement_id not in closed_on or reading.state in ("EXCEPTION", "SHOWN")
        ]
        if closing:
            left_to_checks[attribute.id] = left
        state, basis = standing(left)
        if state == "NOT_TESTED" and attribute.id in stale:
            basis = ONLY_OUT_OF_DATE
        words = STATE_WORDS[state]
        tickmark: Tickmark
        if closing and state not in _OVER_A_DISPOSITION:
            by = read_by(closing)
            stood_in = next(
                (
                    reading.basis
                    for reading in readings
                    if reading.requirement_id == by.requirement_id and reading not in left
                ),
                "",
            )
            state = cast(AttributeState, by.kind)
            words = DISPOSITION_WORDS[by.kind]
            basis = disposition_basis(by, stood_in)
            # Never agreed or compared: the person's reading is not the system's record.
            tickmark = "REVIEWED" if by.kind == "SHOWN_ON_REVIEW" else "NONE"
        else:
            # Over every check of the attribute, also one a disposition stands in for: a
            # check left open or a comparison that failed still takes the mark away, and
            # so does an exception a person recorded.
            tickmark = tickmark_of(state, readings)
            if tickmark in ("AGREED", "COMPARED") and any(d.kind == "EXCEPTION" for d in mine):
                tickmark = "NONE"
        # The sentence of a comparison that failed is never listed under "shown".
        said = _distinct(
            sentence
            for reading in readings
            for sentence in (
                reading.checks if state == "SHOWN" else (*reading.checks, *reading.failed_checks)
            )
        )
        reviewed = reviewed_annotations(mine, stand)
        found.append(
            AttributeBody(
                id=attribute.id,
                code=attribute.code,
                text=attribute.text,
                state=state,
                state_words=words,
                basis=basis,
                tickmark=tickmark,
                refs=attribute_refs(attribute.id, readings, stand, evidence, reviewed),
                marks=marks_of(attribute.id, readings, stand, requests, evidence, reviewed),
                checks=list(said)[:MAX_CHECKS],
                notes=attribute_notes(section, attribute.code, attribute.text),
            )
        )
    return found, left_to_checks


# --- The walkthrough and the reports ----------------------------------------------------

_WHEN_HEADS = ("when", "date")
# A citation's mark in a cell. No section holds a citation numbered beyond six digits.
_MARKER = re.compile(r"\[\^(\d{1,6})\]")
# What a record may write after a time: UTC by name (with an offset, or without), an
# offset alone, or a zone by its abbreviation (only real zone names, as assurance_facts
# reads them: a user id after a time is not one).
_UTC_AFTER = re.compile(
    r"\s?(?:Z|UTC|GMT)(?![A-Za-z])(?:\s?[+-]\d{1,2}(?::?\d{2})?(?![\d:]))?",
    re.IGNORECASE | re.ASCII,
)
_OFFSET_AFTER = re.compile(r"\s?([+-])\d{2}(?::?\d{2})?(?![\d:])", re.ASCII)
_ZONE_AFTER = re.compile(
    rf"\s?\(?(?:{assurance_facts._ZONE_NAMES})\)?(?![A-Za-z])", re.IGNORECASE | re.ASCII
)


def _zone_end(plain: str, at: int, *, iso: bool, exact: bool) -> int:
    """Where the offset or zone written after a time ends; `at` where there is none. An
    offset alone is taken as assurance_facts takes it: only after a year-first date, and
    a negative one only when the time is written to the second or joined by "T" (a bare
    "-10:30" after a time is as likely the end of a time range)."""
    named = _UTC_AFTER.match(plain, at)
    if named is not None:
        return named.end()
    bare = _OFFSET_AFTER.match(plain, at)
    if bare is not None and iso and (bare.group(1) == "+" or exact):
        return bare.end()
    zone = _ZONE_AFTER.match(plain, at)
    return at if zone is None else zone.end()


def first_date(text: str) -> str:
    """The first date a text states, as written, with its time where one follows and the
    offset or zone written after that time; "" where it states none. A date that is part
    of a longer number or reference, one with a two-digit year and one that does not
    exist are not dates. Nothing is reformatted."""
    plain = assurance_facts._plain(text)
    for found in assurance_facts._scan(text):
        if found.joined or (found.when is None and not found.ambiguous):
            continue
        start = plain.rfind(found.written, 0, found.reach)
        if start < 0:
            continue
        end = found.reach
        timed = plain[start + len(found.written) : end]
        if timed:
            end = _zone_end(
                plain,
                end,
                iso=found.written[:4].isdigit(),
                exact=timed[:1] in "Tt" or timed.count(":") >= 2,
            )
        return plain[start:end].strip()
    return ""


def row_when(columns: Sequence[str], row: Sequence[str]) -> str:
    """A walkthrough row's `when` (section 3): its own "When" or "Date" cell where the
    section has that column, otherwise the first date its cells state, as written."""
    at = _column(columns, *_WHEN_HEADS)
    if at is not None:
        return row[at][:CELL_LIMIT] if at < len(row) else ""
    for cell in row:
        found = first_date(cell)
        if found:
            return found[:NAME_LIMIT]
    return ""


# Before a name, these mean it is the end of a longer name or of a path.
_JOINS_BEFORE = frozenset("_-./\\")


def named_files(text: str, names: Sequence[str]) -> list[int]:
    """Which of the names a text states, by their place in `names`. Case and spacing are
    set aside. A name is found whole: never inside a longer word, never as the end of a
    longer name or path (a letter, a digit or one of _ - . / \\ directly before it),
    never as the start of a longer name (a letter or a digit directly after it, or a
    full stop followed by one, as in "report.pdf.bak"), and never inside a longer name
    that is itself found (the longest is looked for first). A name two of the files
    carry tells neither apart, so it names neither."""
    low = " ".join(text.split()).casefold()
    by_name: dict[str, list[int]] = {}
    for index, name in enumerate(names):
        key = " ".join(name.split()).casefold()
        if len(key) >= 3:
            by_name.setdefault(key, []).append(index)
    found: list[int] = []
    for key in sorted(by_name, key=len, reverse=True):
        start, hit = 0, False
        while (at := low.find(key, start)) >= 0:
            end = at + len(key)
            before = low[at - 1] if at else " "
            after = low[end : end + 2].ljust(2)
            longer = (
                before.isalnum()
                or before in _JOINS_BEFORE
                or after[0].isalnum()
                or (after[0] == "." and after[1].isalnum())
            )
            if not longer:
                hit = True
                low = f"{low[:at]}{' ' * len(key)}{low[end:]}"
            start = end
        if hit and len(by_name[key]) == 1:
            found.extend(by_name[key])
    return sorted(found)


def row_refs(
    row: Sequence[str], citations: Sequence[Mapping[str, Any]], evidence: Sequence[EvidenceBody]
) -> list[str]:
    """The evidence entries a row names: a file's name written in one of its cells, or a
    citation of the section whose mark the row carries."""
    text = " \n ".join(row)
    files = {
        evidence[index].file_id for index in named_files(text, [e.file_name for e in evidence])
    }
    marked = {int(number) for number in _MARKER.findall(text)}
    for citation in citations:
        if citation.get("number") in marked:
            try:
                files.add(UUID(str(citation.get("evidence_file_id"))))
            except ValueError:
                continue
    return _refs(files, evidence)


def _cell(row: Sequence[str], at: int | None) -> str:
    return row[at][:CELL_LIMIT] if at is not None and at < len(row) else ""


def walkthrough_of(section: Section | None, evidence: Sequence[EvidenceBody]) -> WalkthroughBody:
    """The workpaper's own walkthrough section, row by row, with the columns it was
    drafted with. A row with nothing in it is not a step."""
    if section is None or section.kind != "table":
        return WalkthroughBody()
    columns = list(section.columns)
    when = _column(columns, *_WHEN_HEADS)
    named = {
        "step": _column(columns, "step"),
        "who": _column(columns, "who"),
        "evidence": _column(columns, "evidence", starts=True),
        "result": _column(columns, "result"),
    }
    # A column the template names differently is taken by its place among the others.
    free = [i for i in range(len(columns)) if i != when and i not in named.values()]
    for key in named:
        if named[key] is None and free:
            named[key] = free.pop(0)
    steps: list[StepBody] = []
    for row in section.rows:
        if not any(cell.strip() for cell in row):
            continue
        steps.append(
            StepBody(
                number=len(steps) + 1,
                when=row_when(columns, row),
                step=_cell(row, named["step"]),
                who=_cell(row, named["who"]),
                evidence=_cell(row, named["evidence"]),
                result=_cell(row, named["result"]),
                refs=row_refs(row, section.citations, evidence),
            )
        )
    return WalkthroughBody(columns=columns, steps=steps, source=section.source)


def reports_of(section: Section | None, evidence: Sequence[EvidenceBody]) -> list[ReportBody]:
    """The reports relied on: the rows of the workpaper's "Information produced by the
    entity" section, as stored, each with the evidence entry its report cell names."""
    if section is None or section.kind != "table":
        return []
    columns = list(section.columns)
    source = _column(columns, "source", starts=True)
    procedure = _column(columns, "completeness", "procedure", starts=True)
    report = _column(columns, "report", starts=True)
    report = report if report is not None else 0
    source = source if source is not None else 1
    procedure = procedure if procedure is not None else 2
    names = [entry.file_name for entry in evidence]
    found: list[ReportBody] = []
    for row in section.rows[:MAX_REPORTS]:
        if not any(cell.strip() for cell in row):
            continue
        named = named_files(_cell(row, report), names)
        found.append(
            ReportBody(
                ref=evidence[named[0]].ref if named else "",
                report=_cell(row, report),
                source=_cell(row, source),
                procedure=_cell(row, procedure),
            )
        )
    return found


# --- Procedures and matters -------------------------------------------------------------


def _count(number: int, one: str, many: str | None = None) -> str:
    return f"{number} {one if number == 1 else many or one + 's'}"


def _listed_names(names: Sequence[str], most: int = 3) -> str:
    shown = [f"“{clean_line(name, 120)}”" for name in names[:most]]
    if len(names) > most:
        shown.append(f"{len(names) - most} more")
    if len(shown) <= 1:
        return "".join(shown)
    return f"{', '.join(shown[:-1])} and {shown[-1]}"


def _current(
    requests: Sequence[RequestRecord], checks: Mapping[UUID, CheckRecord]
) -> list[tuple[RequestRecord, CheckRecord]]:
    return [
        (request, check)
        for request in requests
        if (check := checks.get(request.requirement_id)) is not None and check.current
    ]


def reports_inspected(
    requests: Sequence[RequestRecord], checks: Mapping[UUID, CheckRecord]
) -> list[str]:
    """The names of the reports whose source, run date and parameters a current check's
    review says are shown. One whose basis is shown only in part, or not at all, was not
    inspected."""
    names = {file.file_id: file.file_name for request in requests for file in request.files}
    found = _distinct(
        said.file_id
        for _request, check in _current(requests, checks)
        if check.review is not None
        for said in check.review.files
        if said.report_basis == "SHOWN" and said.file_id in names
    )
    return [names[file_id] for file_id in found]


def legend(inspected: bool, reviewed: bool = False) -> list[TickmarkBody]:
    """The tickmark legend. The entry for a report's parameters is given only where a
    procedure of the same response says they were inspected, and the entry for the
    auditor's own review only where an attribute of the same response carries that mark
    (`reviewed`), before the exception's."""
    found = [mark for mark in TICKMARKS if inspected or mark.mark != "INSPECTED"]
    if reviewed:
        at = next((i for i, mark in enumerate(found) if mark.mark == "EXCEPTION"), len(found))
        found.insert(at, REVIEWED_TICKMARK)
    return found


def procedures_of(
    requests: Sequence[RequestRecord],
    checks: Mapping[UUID, CheckRecord],
    attributes: Sequence[AttributeRecord],
    walkthrough: WalkthroughBody,
) -> list[str]:
    """What was done and is on record, each a sentence written here from a count: the
    files the current checks read in full and for which requests, the files they read
    only in part (said so, never counted as inspected), the instance walked through where
    a person or the agent recorded its steps (a template's starter rows are not a
    walkthrough), the comparisons code made, and the reports whose source, run date and
    parameters a check's review says are shown. Never a procedure the records do not
    show."""
    found: list[str] = []
    current = _current(requests, checks)
    names = {file.file_id: file.file_name for request in requests for file in request.files}
    partial = _distinct(file_id for _request, check in current for file_id in check.partial)
    whole = _distinct(
        file_id
        for _request, check in current
        for file_id in check.file_ids
        if file_id not in partial
    )
    asked = [
        request.title
        for request, check in current
        if any(file_id not in partial for file_id in check.file_ids)
    ]
    if whole:
        found.append(
            f"Inspected {_count(len(whole), 'file')} received for "
            f"{_count(len(asked), 'request')}: {_listed_names(asked)}."
        )
    if partial:
        found.append(
            f"Read {_count(len(partial), 'file')} only in part: "
            f"{_listed_names([names.get(file_id, 'a file') for file_id in partial])}."
        )
    steps = len(walkthrough.steps)
    if steps > 0 and walkthrough.source != "RECORDS":
        found.append(
            f"Walked one instance of the control through {_count(steps, 'step')}, "
            "recorded in the walkthrough."
        )
    codes = {attribute.id: attribute.code for attribute in attributes}
    made = 0
    compared: list[str] = []
    for _request, check in current:
        if check.engine < 2:
            continue
        for item in check.outcome:
            count = sum(1 for c in item.checks if c.status != "NOT_RUN")
            if count and item.attribute_id in codes:
                made += count
                compared.append(codes[item.attribute_id])
    if made:
        letters = sorted(set(compared))
        named = letters[0] if len(letters) == 1 else f"{', '.join(letters[:-1])} and {letters[-1]}"
        found.append(
            f"Compared dates and values in code for "
            f"{'attribute' if len(letters) == 1 else 'attributes'} {named}: "
            f"{_count(made, 'comparison')} made."
        )
    reports = reports_inspected(requests, checks)
    if reports:
        found.append(
            f"Inspected the source, run date and parameters shown on "
            f"{_count(len(reports), 'report')}: {_listed_names(reports)}."
        )
    return found[:MAX_PROCEDURES]


def _not_listed(dropped: Sequence[MatterBody]) -> MatterBody:
    """The line that counts the matters the list has no room for."""
    waits = sum(1 for matter in dropped if matter.state == "OPEN")
    text = (
        f"{_count(len(dropped), 'more matter')} {'is' if len(dropped) == 1 else 'are'} "
        "not listed here"
    )
    if waits == 0:
        text += "."
    elif len(dropped) == 1:
        text += "; it waits on a person."
    else:
        text += f"; {waits} of them {'waits' if waits == 1 else 'wait'} on a person."
    return MatterBody(state="OPEN" if waits else "NOTED", kind="NOTE", text=text)


def matters_of(
    requests: Sequence[RequestRecord],
    checks: Mapping[UUID, CheckRecord],
    attributes: Sequence[AttributeRecord],
    readings: Mapping[UUID, Sequence[Reading]],
    findings: Sequence[FindingRecord],
    evidence: Sequence[EvidenceBody],
    more_files: int = 0,
    dispositions: Sequence[MatterBody] = (),
) -> list[MatterBody]:
    """What a reviewer should see first, from the records. First, a check that is out of
    date. Then what waits on a person: open findings, an exception a person recorded,
    attributes a check leaves to a person, an attribute one request shows and another
    that asks for it does not, files left out, what each current check's review says is
    incomplete or not yet reliable, and the checks' follow-ups. Then what is noted (each
    disposition a person recorded, files left out by purpose, considerations), and one
    note that operating effectiveness is tested separately. At most MAX_MATTERS: where
    there are more, the last line before the note counts them. `readings` are the checks'
    words left to the checks (`attributes_of`), and `dispositions` the matters of the
    dispositions that are read (`disposition_matters`)."""
    waiting: list[MatterBody] = []
    noted: list[MatterBody] = [matter for matter in dispositions if matter.state == "NOTED"]
    names = {file.file_id: file.file_name for request in requests for file in request.files}
    titles = {request.requirement_id: clean_line(request.title, 120) for request in requests}
    stale = [
        (request, check)
        for request in requests
        if (check := checks.get(request.requirement_id)) is not None
        and check.status == "OUT_OF_DATE"
    ]
    if stale:
        files = [file.file_id for request, _check in stale for file in request.files]
        if len(stale) == 1:
            request, check = stale[0]
            why = check.out_of_date[0] if check.out_of_date else ""
            text = (
                f"The check of \u201c{clean_line(request.title, 200)}\u201d is out of date, "
                f"so nothing of it is used here. {why} Check the request again."
            )
        else:
            text = (
                f"The checks of {len(stale)} requests are out of date, so nothing of them "
                "is used here. Check the requests again."
            )
        waiting.append(
            MatterBody(
                state="OPEN", kind="UNSETTLED", text=_sentence(text), refs=_refs(files, evidence)
            )
        )
    for finding in findings:
        waiting.append(
            MatterBody(
                state="OPEN",
                kind="FINDING",
                text=_sentence(finding.title, 300),
                refs=_refs([finding.file_id] if finding.file_id else [], evidence),
            )
        )
    waiting.extend(matter for matter in dispositions if matter.state == "OPEN")
    for attribute in attributes:
        mine = readings.get(attribute.id, [])
        left = next((r for r in mine if r.open), None)
        if left is not None:
            waiting.append(
                MatterBody(
                    state="OPEN",
                    kind="UNSETTLED",
                    text=_sentence(f"Attribute {attribute.code} is not concluded. {left.basis}"),
                    refs=_refs([*left.exceptions, *left.shows], evidence),
                )
            )
    for attribute in attributes:
        mine = readings.get(attribute.id, [])
        if standing(mine)[0] != "SHOWN":
            continue
        shown = next(r for r in mine if r.state == "SHOWN")
        short = next((r for r in mine if r.state == "NOT_SHOWN"), None)
        if short is not None:
            waiting.append(
                MatterBody(
                    state="OPEN",
                    kind="UNSETTLED",
                    text=_sentence(
                        f"Attribute {attribute.code} is shown by the evidence for "
                        f"\u201c{titles.get(shown.requirement_id, '')}\u201d and not shown by "
                        f"the evidence for \u201c{titles.get(short.requirement_id, '')}\u201d, "
                        "which also asks for it."
                    ),
                    refs=_refs(shown.shows, evidence),
                )
            )
    listed = {entry.file_id for entry in evidence}
    told: set[UUID] = set()
    for request in requests:
        check = checks.get(request.requirement_id)
        if check is None or not check.gated:
            continue
        for held in check.held:
            if held.file_id in told or held.file_id not in listed:
                continue
            told.add(held.file_id)
            name = clean_line(names.get(held.file_id, "A file"), NAME_LIMIT)
            matter = MatterBody(
                state="NOTED" if held.code in _LEFT_OUT_BY_PURPOSE else "OPEN",
                kind="FILE",
                text=_sentence(f"{name} is not part of the check. {held.reason}"),
                refs=_refs([held.file_id], evidence),
            )
            (noted if matter.state == "NOTED" else waiting).append(matter)
    current = [
        (request, check)
        for request, check in _current(requests, checks)
        if check.review is not None and check.engine >= 2
    ]
    said: set[str] = set()
    for request, check in current:
        assert check.review is not None
        mine_names = [file.file_name for file in request.files]
        for reason in check.review.completeness.reasons:
            text = _sentence(reason)
            about = [request.files[i].file_id for i in named_files(text, mine_names)]
            # A file left out is already said, with the gate's own sentence.
            if not text or text in said or (about and all(f in told for f in about)):
                continue
            said.add(text)
            waiting.append(
                MatterBody(
                    state="OPEN", kind="COMPLETENESS", text=text, refs=_refs(about, evidence)
                )
            )
    for _request, check in current:
        assert check.review is not None
        for follow_up in check.review.follow_ups:
            waiting.append(
                MatterBody(
                    state="OPEN",
                    kind="FOLLOW_UP",
                    text=_sentence(follow_up.request, 500),
                    refs=_refs(check.file_ids, evidence),
                )
            )
        for remark in check.review.considerations:
            noted.append(
                MatterBody(
                    state="NOTED",
                    kind="CONSIDERATION",
                    text=_sentence(remark.text),
                    refs=_refs([passage.file_id for passage in remark.passages], evidence),
                )
            )
    if more_files > 0:
        noted.append(
            MatterBody(
                state="NOTED",
                kind="FILE",
                text=(
                    f"{_count(more_files, 'more file')} on the evidence list "
                    f"{'is' if more_files == 1 else 'are'} not listed here."
                ),
            )
        )
    kept = [matter for matter in (*waiting, *noted) if matter.text]
    room = MAX_MATTERS - 1
    if len(kept) > room:
        kept = [*kept[: room - 1], _not_listed(kept[room - 1 :])]
    return [*kept, MatterBody(state="NOTED", kind="NOTE", text=SEPARATE_NOTE)]


# --- The workpaper's own sections -------------------------------------------------------

_HEADER_LABELS = frozenset({"engagement", "control", "risk", "control activity"})


def _section(content: Content | None, key: str) -> Section | None:
    if content is None:
        return None
    return next((section for section in content.sections if section.key == key), None)


def _field(section: Section | None, label: str) -> str | None:
    if section is None:
        return None
    return next((f.value for f in section.fields if f.label.strip().casefold() == label), None)


def _text_section(content: Content | None, wanted: Iterable[str], word: str = "") -> Section | None:
    """The first text section of the workpaper with one of the keys, else, where `word`
    is given, the first whose key holds it (a firm's template may name it otherwise)."""
    if content is None:
        return None
    keys = set(wanted)
    texts = [section for section in content.sections if section.kind == "text"]
    return next((s for s in texts if s.key in keys), None) or (
        next((s for s in texts if word in s.key), None) if word else None
    )


def can_edit_sections(
    *,
    may_update: bool,
    engagement_open: bool,
    status: str | None,
    drafting: bool,
    current_version: int,
) -> bool:
    """Whether the viewer may edit the workpaper's sections: the rule of the section
    editor (workpaper_service._edit and the workpaper card): a person who may update the
    engagement's work, on an open engagement, a draft the agent is not drafting."""
    return (
        may_update
        and engagement_open
        and status == "DRAFT"
        and not drafting
        and current_version >= 1
    )


def conclusion_of(
    section: Section | None, conclusion: design_conclusions.DesignConclusionBody
) -> ConclusionBody:
    """The workpaper's conclusion section with the D&I conclusion's verdict: proposed
    until a reviewer signs, and signed only while that sign-off record holds."""
    signed = conclusion.status == "SIGNED_OFF" and conclusion.signed is not None
    verdict = conclusion.signed.verdict if signed and conclusion.signed else conclusion.proposed
    return ConclusionBody(
        text="" if section is None else section.text,
        source="RECORDS" if section is None else section.source,
        proposed=conclusion.proposed,
        words=VERDICT_WORDS.get(verdict or "", NOT_CONCLUDED_WORDS),
        signed=signed,
    )


# --- The loader: each kind of record once for the control -------------------------------


@dataclass(frozen=True)
class _ControlRow:
    organization_id: UUID
    control_ref: str
    title: str
    risk: str
    activity: str
    domain: str
    template_key: str
    system: str
    engagement: str
    project_status: str


def _control_row(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, control_id: UUID
) -> _ControlRow:
    row = connection.execute(
        """
        SELECT c.organization_id, c.control_ref, c.title, c.risk, c.activity, c.domain,
               c.template_key, coalesce(a.name, ''), p.name, p.status::text
        FROM engagement_controls c
        JOIN projects p ON p.id = c.project_id
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.id = %s AND c.project_id = %s AND c.organization_id = %s
        """,
        (control_id, project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _ControlRow(
        organization_id=UUID(str(row[0])),
        control_ref=str(row[1]),
        title=str(row[2] or ""),
        risk=str(row[3] or ""),
        activity=str(row[4] or ""),
        domain=str(row[5] or ""),
        template_key=str(row[6] or ""),
        system=str(row[7] or ""),
        engagement=str(row[8] or ""),
        project_status=str(row[9] or ""),
    )


def _list_order(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[UUID]:
    """The control's D&I requirements in the order of the D&I list (the plan's own order,
    evidence_plans._requirements)."""
    return [
        UUID(str(row[0]))
        for row in connection.execute(
            """
            SELECT q.id FROM evidence_requirements q
            JOIN evidence_plans p ON p.id = q.plan_id
            WHERE p.engagement_control_id = %s AND p.project_id = %s
              AND q.phase = 'DESIGN' AND q.status <> 'REMOVED'
            ORDER BY CASE q.necessity WHEN 'REQUIRED' THEN 0 WHEN 'CONDITIONAL' THEN 1
                     ELSE 2 END, q.created_at, q.requirement_key
            """,
            (control_id, project_id),
        ).fetchall()
    ]


def _content_types(
    connection: psycopg.Connection[Any], project_id: UUID, file_ids: Sequence[UUID]
) -> dict[UUID, str]:
    if not file_ids:
        return {}
    return {
        UUID(str(row[0])): str(row[1] or "")
        for row in connection.execute(
            "SELECT id, content_type FROM evidence_files WHERE id = ANY(%s) AND project_id = %s",
            (list(file_ids), project_id),
        ).fetchall()
    }


def _stored_outcome(run: assurance._Run) -> tuple[StoredOutcome, ...] | None:
    """A finished run's outcome as this view reads it; None where it cannot be read as
    recorded (never expected: the check writes it), and then nothing of it is used."""
    try:
        return tuple(StoredOutcome.model_validate(item) for item in run.outcome)
    except ValidationError:
        logger.warning("an evidence check's outcome could not be read as recorded")
        return None


def _stored_review(run: assurance._Run) -> assurance.ReviewBody | None:
    if run.review is None:
        return None
    try:
        return assurance.ReviewBody.model_validate(run.review)
    except ValidationError:
        logger.warning("an evidence check's review could not be read as recorded")
        return None


def load_checks(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    control: assurance._Control,
    requests: Sequence[assurance._Request],
    attributes: assurance.Attributes,
    links: assurance._Links,
) -> dict[UUID, CheckRecord]:
    """The latest check of each request with a file in force, with the status the D&I
    evidence list gives it (evidence_assurance.read_assurance: the newest run that is not
    marked out of date, else the newest; out of date where its basis no longer matches
    what would be read now, as its own engine reads it; failed where its worker stopped).
    Only a reviewed run keeps its outcome and its review."""
    if not requests:
        return {}
    latest = {
        run.requirement_id: run
        for run in (
            assurance._run(row)
            for row in connection.execute(
                f"""
                SELECT DISTINCT ON (requirement_id) {assurance._RUN_COLUMNS}
                FROM evidence_assessments
                WHERE engagement_control_id = %s AND project_id = %s
                ORDER BY requirement_id, (stale_at IS NULL) DESC, created_at DESC, id DESC
                """,  # noqa: S608
                (control_id, project_id),
            ).fetchall()
        )
    }
    contexts = assurance._Contexts(connection, project_id, control_id)
    found: dict[UUID, CheckRecord] = {}
    for request in requests:
        run = latest.get(request.requirement_id)
        if run is None:
            found[request.requirement_id] = CheckRecord(request.requirement_id, "NOT_CHECKED")
            continue
        reasons: list[str] = []
        if run.stale_at is not None:
            reasons = [part for part in run.stale_reason.split("\n") if part.strip()]
            reasons = reasons or ["What the check reads changed."]
        elif run.status in ("HELD", "READY", "FAILED"):
            reasons = assurance._changed(
                connection,
                run,
                assurance._basis(
                    request,
                    control,
                    attributes,
                    links,
                    run.engine_version,
                    contexts.sha256(request) if run.engine_version >= 2 else "",
                ),
            )
        status: CheckStatus = (
            "OUT_OF_DATE"
            if reasons
            else "FAILED"
            if run.stopped
            else assurance._STATUS.get(run.status, "FAILED")
        )
        outcome: tuple[StoredOutcome, ...] = ()
        review: assurance.ReviewBody | None = None
        if status == "REVIEWED":
            read = _stored_outcome(run)
            if read is None:
                status = "FAILED"
            else:
                outcome, review = read, _stored_review(run)
        included = {str(file_id) for file_id in run.file_ids}
        found[request.requirement_id] = CheckRecord(
            requirement_id=request.requirement_id,
            status=status,
            run_id=run.id,
            engine=run.engine_version,
            file_ids=tuple(run.file_ids),
            partial=tuple(
                UUID(str(file["file_id"]))
                for file in run.files
                if file.get("truncated") and str(file.get("file_id")) in included
            ),
            held=tuple(
                HeldFile(held.file_id, held.code, held.reason)
                for held in assurance._held_files(run)
            ),
            outcome=outcome,
            review=review,
            out_of_date=tuple(clean_line(reason, 300) for reason in reasons),
        )
    return found


def load_annotations(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[AnnotationRecord]:
    """The control's listed annotations, each numbered by its place in the list of its
    file on its request, in the annotation viewer's own order
    (evidence_annotations._order: the row carries the same columns in the same places,
    without the words). REMOVED and SUPERSEDED annotations are not listed."""
    rows = connection.execute(
        """
        SELECT a.id, a.kind, NULL, NULL, NULL, NULL, a.attribute_ids, a.page, a.rects, NULL,
               a.origin, a.status, NULL, NULL, NULL, a.position, a.created_at,
               a.requirement_id, a.evidence_file_id, a.assessment_id
        FROM evidence_annotations a
        JOIN evidence_requirements q ON q.id = a.requirement_id
        WHERE a.engagement_control_id = %s AND a.project_id = %s AND q.phase = 'DESIGN'
          AND a.status NOT IN ('REMOVED', 'SUPERSEDED')
        """,
        (control_id, project_id),
    ).fetchall()
    grouped: dict[tuple[UUID, UUID], list[tuple[Any, ...]]] = {}
    for row in rows:
        grouped.setdefault((UUID(str(row[17])), UUID(str(row[18]))), []).append(row)
    found: list[AnnotationRecord] = []
    for (requirement_id, file_id), mine in grouped.items():
        for number, row in enumerate(sorted(mine, key=annotation_order), start=1):
            found.append(
                AnnotationRecord(
                    id=UUID(str(row[0])),
                    requirement_id=requirement_id,
                    file_id=file_id,
                    kind=cast(Mark, str(row[1])),
                    status=str(row[11]),
                    origin=str(row[10]),
                    attribute_ids=tuple(UUID(str(item)) for item in (row[6] or [])),
                    assessment_id=None if row[19] is None else UUID(str(row[19])),
                    number=number,
                )
            )
    return found


def load_findings(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    requirement_ids: Sequence[UUID],
    file_ids: Sequence[UUID],
) -> list[FindingRecord]:
    """The control's open evidence findings on its D&I evidence: on a D&I request, or on
    a file in force with no request named. Never one that is out of date."""
    rows = connection.execute(
        """
        SELECT id, title, evidence_file_id FROM evidence_findings
        WHERE engagement_control_id = %s AND project_id = %s AND NOT stale
          AND status = ANY(%s)
          AND (requirement_id = ANY(%s)
               OR (requirement_id IS NULL AND evidence_file_id = ANY(%s)))
        ORDER BY created_at, id
        LIMIT %s
        """,
        (
            control_id,
            project_id,
            list(FINDING_OPEN),
            list(requirement_ids),
            list(file_ids),
            MAX_FINDINGS,
        ),
    ).fetchall()
    return [
        FindingRecord(
            id=UUID(str(row[0])),
            title=str(row[1] or ""),
            file_id=None if row[2] is None else UUID(str(row[2])),
        )
        for row in rows
    ]


def _design_workpaper(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> workpaper_service.WorkpaperBody | None:
    row = connection.execute(
        "SELECT id FROM workpapers WHERE project_id = %s AND engagement_control_id = %s "
        "AND stage = 'DESIGN'",
        (project_id, control_id),
    ).fetchone()
    if row is None:
        return None
    return workpaper_service._body(connection, project_id, UUID(str(row[0])))


def _area(row: _ControlRow, content: Content | None) -> str:
    """The control's area in words, from the kind of its workpaper's template."""
    kind = content.kind if content is not None else ""
    if not kind:
        template = BY_KEY.get(row.template_key)
        if template is None:
            try:
                template = BY_KEY.get(default_template(row.domain))
            except KeyError, ValueError:
                template = None
        kind = "" if template is None else template.kind
    return KIND_LABELS.get(kind, "")


def read_design_workpaper(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
) -> DesignWorkpaperBody:
    """The D&I workpaper of a control as its views read it. The caller has authorized the
    read; a control of another engagement or organization is not found."""
    row = _control_row(connection, organization_id, project_id, control_id)
    control = assurance._Control(
        row.organization_id, row.control_ref, row.title, row.activity, row.domain
    )
    order = _list_order(connection, project_id, control_id)
    place = {requirement_id: index for index, requirement_id in enumerate(order)}
    loaded = sorted(
        assurance._requests(connection, project_id, control_id),
        key=lambda request: place.get(request.requirement_id, len(place)),
    )
    approved = assurance._approved(connection, control_id)
    links = assurance._linked(connection, control_id)
    checks = load_checks(connection, project_id, control_id, control, loaded, approved, links)
    file_ids = list(_distinct(file.file_id for request in loaded for file in request.files))
    types = _content_types(connection, project_id, file_ids)
    known = {attribute[0] for attribute in approved}
    requests = [
        RequestRecord(
            requirement_id=request.requirement_id,
            title=request.title,
            files=tuple(
                FileRecord(file.file_id, file.file_name, file.kind, types.get(file.file_id, ""))
                for file in request.files
            ),
            asks=frozenset(links.get(request.requirement_id) & known),
        )
        for request in loaded
    ]
    annotations = load_annotations(connection, project_id, control_id)
    findings = load_findings(connection, project_id, control_id, order, file_ids)
    paper = _design_workpaper(connection, project_id, control_id)
    content = None if paper is None else paper.content
    conclusion = design_conclusions._body(connection, project_id, control_id, principal.id)
    may_update = principal.kind is PrincipalKind.USER and permits(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )

    attributes = [AttributeRecord(a[0], a[1], a[2]) for a in approved]
    evidence, more = evidence_index(requests, checks, annotations)
    walkthrough = walkthrough_of(_section(content, "walkthrough-of-one-instance"), evidence)
    # A person's dispositions of the attributes (docs/evidence-assurance.md, section
    # 10.13): those standing on the control, read once.
    dispositions = list(standing_for(connection, control_id).values())
    shown, readings = attributes_of(
        attributes,
        requests,
        checks,
        annotations,
        evidence,
        _section(content, "design-attributes"),
        dispositions,
    )
    stand = annotations_standing(annotations, requests, checks)
    recorded = disposition_matters(
        attributes, dispositions_applying(dispositions, checks, stand), stand, evidence
    )
    header = _section(content, "control")
    understanding = _text_section(content, _ACTIVITY_ROLES)
    signed = conclusion.signed
    reference = (
        content.reference
        if content is not None
        else workpaper_reference(
            row.control_ref, (row.system,) if row.system else (), PERIOD_CODES["design"]
        )
    )
    return DesignWorkpaperBody(
        control=ControlBody(
            id=control_id,
            ref=row.control_ref,
            title=row.title,
            system=row.system,
            engagement=row.engagement,
            area=_area(row, content),
        ),
        workpaper=None
        if paper is None
        else WorkpaperRefBody(
            id=paper.id,
            reference=reference,
            status=paper.status,
            drafting=paper.drafting,
            version=paper.version,
            shown_version=paper.shown_version,
            current_version=paper.current_version,
            prepared_by=paper.prepared_by,
            prepared_at=paper.prepared_at,
        ),
        review=ReviewStateBody(
            status=conclusion.status,
            proposed=conclusion.proposed,
            signed_verdict=None if signed is None else signed.verdict,
            signed_by=None if signed is None else signed.signed_by,
            signed_at=None if signed is None else signed.signed_at,
            out_of_date=list(conclusion.out_of_date),
        ),
        risk=_field(header, "risk") or row.risk,
        activity=_field(header, "control activity") or row.activity,
        facts=[
            FactBody(label=field.label, value=field.value)
            for field in (header.fields if header is not None else [])
            if field.label.strip().casefold() not in _HEADER_LABELS
        ][:MAX_FACTS],
        understanding="" if understanding is None else understanding.text,
        procedures=procedures_of(requests, checks, attributes, walkthrough),
        evidence=evidence,
        walkthrough=walkthrough,
        attributes=shown,
        reports=reports_of(_section(content, "information-produced-by-the-entity"), evidence),
        matters=matters_of(
            requests, checks, attributes, readings, findings, evidence, more, recorded
        ),
        conclusion=conclusion_of(
            _text_section(content, ("design-conclusion",), "conclusion"), conclusion
        ),
        tickmarks=legend(
            bool(reports_inspected(requests, checks)),
            any(attribute.tickmark == "REVIEWED" for attribute in shown),
        ),
        can_edit=can_edit_sections(
            may_update=may_update,
            engagement_open=row.project_status not in CLOSED,
            status=None if paper is None else paper.status,
            drafting=paper is not None and paper.drafting,
            current_version=0 if paper is None else paper.current_version,
        ),
    )


def register_design_workpaper(app: FastAPI, settings: Settings) -> None:
    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"
        "/design-workpaper",
        response_model=DesignWorkpaperBody,
    )
    def read(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> DesignWorkpaperBody:
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> DesignWorkpaperBody:
            authorize(connection, principal=principal, action=Action.PROJECT_READ,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            # Nothing is written by this route: the database refuses a write from here on.
            connection.execute("SET TRANSACTION READ ONLY")
            return read_design_workpaper(
                connection, principal, organization_id, project_id, control_id
            )

        return _call(settings, work)


__all__ = [
    "AnnotationRecord",
    "AttributeRecord",
    "CheckRecord",
    "DesignWorkpaperBody",
    "FileRecord",
    "FindingRecord",
    "HeldFile",
    "Reading",
    "RequestRecord",
    "StoredOutcome",
    "annotations_standing",
    "attribute_notes",
    "attributes_of",
    "can_edit_sections",
    "conclusion_of",
    "disposition_basis",
    "disposition_matters",
    "dispositions_applying",
    "evidence_index",
    "first_date",
    "legend",
    "marks_of",
    "matters_of",
    "named_files",
    "procedures_of",
    "read_design_workpaper",
    "readings_of",
    "register_design_workpaper",
    "reliability_open",
    "reports_inspected",
    "reports_of",
    "row_refs",
    "row_when",
    "standing",
    "tickmark_of",
    "walkthrough_of",
]
