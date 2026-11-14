"""What a check of a request's evidence amounts to (docs/evidence-assurance.md, 10.4, 10.6).

The check answers "has sufficient appropriate evidence been obtained for what this request
tests?" on two dimensions that are kept apart:

- what each attribute's evidence shows (its `assessment`): satisfied, shown in part,
  contradicted by the records, not demonstrated, or not concluded;
- how complete and reliable the evidence itself is (`completeness`): every file read, a
  file left out or read in part, a file that could not be read, or support that rests on
  a file whose source or basis is not established.

From the two, one outcome is proposed with a short explanation. Two rules hold throughout:
an exception the records show is never hidden because another file could not be read, and
evidence that is missing is never called a failure.

Everything here is decided in code from results the engine already has; no model writes a
word of it. It proposes; a person decides the audit conclusion.

The module is pure: no database, no network, and no import of evidence_assurance.py, which
imports this.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, Literal, get_args
from uuid import UUID

from ai_workforce_api.inbound import clean_line

Assessment = Literal[
    "SATISFIED", "PARTIALLY_SUPPORTED", "CONTRADICTED", "NOT_DEMONSTRATED", "INDETERMINATE"
]  # fmt: skip
Completeness = Literal["COMPLETE", "INCOMPLETE", "PARTLY_UNREADABLE", "RELIABILITY_UNRESOLVED"]
Overall = Literal[
    "SUFFICIENT", "ADDITIONAL_EVIDENCE", "CLARIFICATION", "POTENTIAL_EXCEPTION",
    "UNABLE_TO_CONCLUDE",
]  # fmt: skip
Relevance = Literal["RELEVANT", "PARTLY_RELEVANT", "NOT_RELEVANT", "CANNOT_TELL"]
Source = Literal["SYSTEM_RECORD", "MANAGEMENT_PREPARED", "DOCUMENT", "UNKNOWN"]
Legibility = Literal["CLEAR", "PARTLY_UNREADABLE", "UNREADABLE"]
ReportBasis = Literal["SHOWN", "PARTLY_SHOWN", "NOT_SHOWN", "NOT_A_REPORT"]

NOTE_LIMIT = 300
_NAME_LIMIT = 200
_CODE_LIMIT = 40


# --- One attribute -------------------------------------------------------------------


def assessment_of(
    *,
    verdict: str,
    result: str | None,
    expected: bool,
    deviation: bool = False,
    check_failed: bool = False,
    exception_unchecked: bool = False,
) -> Assessment | None:
    """What an attribute's evidence shows, from the comparison's verdict and result.

    `check_failed` is a comparison made in code that failed on both readings;
    `exception_unchecked` an exception both readings show beside a file not read;
    `deviation` an issue that rests on a record of the deviation, not on an absence.

    An attribute the request does not ask for has no assessment (None), with one
    exception: an exception the records show stands whether or not the request asks for
    it, so it is CONTRADICTED there too.
    """
    found = _assessment(verdict, result, deviation, check_failed, exception_unchecked)
    if expected:
        return found
    return "CONTRADICTED" if found == "CONTRADICTED" else None


def _assessment(
    verdict: str,
    result: str | None,
    deviation: bool,
    check_failed: bool,
    exception_unchecked: bool,
) -> Assessment:
    """The table of 10.6, for an attribute the request asks for."""
    # These two come first: a check of the records that fails stands against two readings
    # that both say MET, and an exception shown beside an unread file keeps a person's
    # verdict (UNSETTLED) while its assessment still says what the records show.
    if check_failed or exception_unchecked:
        return "CONTRADICTED"
    if verdict == "SUPPORTED":
        return "SATISFIED"
    if verdict == "PARTLY_SUPPORTED":
        return "PARTIALLY_SUPPORTED"
    if verdict == "ISSUE":
        if deviation or result == "CONTRADICTED":
            return "CONTRADICTED"
        if result == "PARTLY_MET":
            return "PARTIALLY_SUPPORTED"
        if result in ("NOT_MET", "NOT_ADDRESSED"):
            # An issue that rests on absence: nothing shows the attribute, and nothing
            # shows a failure. Missing evidence is not an exception.
            return "NOT_DEMONSTRATED"
        return "INDETERMINATE"
    if verdict == "NOT_ADDRESSED":
        return "NOT_DEMONSTRATED"
    return "INDETERMINATE"


# --- The files, as the two readings describe them ------------------------------------


@dataclass(frozen=True)
class FileSaid:
    """What one reading said of one file. The defaults are a reading that said nothing."""

    file_id: UUID
    relevance: Relevance = "CANNOT_TELL"
    relevance_reason: str = ""
    source: Source = "UNKNOWN"
    legibility: Legibility = "CLEAR"
    legibility_note: str = ""
    report_basis: ReportBasis = "NOT_A_REPORT"


@dataclass(frozen=True)
class FileReview:
    """The two readings' views of one file, reconciled.

    `legibility_notes` are the notes of `notes` that say what could not be read, kept
    apart so a sentence about legibility never quotes a remark about relevance. They are
    part of `notes` already and are not stored a second time.
    """

    file_id: UUID
    relevance: Relevance
    source: Source
    legibility: Legibility
    report_basis: ReportBasis
    notes: tuple[str, ...]
    legibility_notes: tuple[str, ...] = ()

    def as_json(self) -> dict[str, Any]:
        """The entry of `review.files` (10.7)."""
        return {
            "file_id": str(self.file_id),
            "relevance": self.relevance,
            "source": self.source,
            "legibility": self.legibility,
            "report_basis": self.report_basis,
            "notes": list(self.notes),
        }


# Each vocabulary, least cautious first where the order matters.
_RELEVANCE_RANK: dict[str, int] = {
    "RELEVANT": 0, "PARTLY_RELEVANT": 1, "CANNOT_TELL": 2, "NOT_RELEVANT": 3
}  # fmt: skip
_LEGIBILITY_RANK: dict[str, int] = {"CLEAR": 0, "PARTLY_UNREADABLE": 1, "UNREADABLE": 2}
_BASIS_RANK: dict[str, int] = {"SHOWN": 0, "PARTLY_SHOWN": 1, "NOT_SHOWN": 2}
_RELEVANCES: dict[str, Relevance] = {value: value for value in get_args(Relevance)}
_SOURCES: dict[str, Source] = {value: value for value in get_args(Source)}
_LEGIBILITIES: dict[str, Legibility] = {value: value for value in get_args(Legibility)}
_BASES: dict[str, ReportBasis] = {value: value for value in get_args(ReportBasis)}


def _checked(said: FileSaid) -> FileSaid:
    """One reading's entry with each answer in its vocabulary. A value outside it is a
    reading's output that was not checked: it is taken as not said, never passed on."""
    return replace(
        said,
        relevance=_RELEVANCES.get(said.relevance, "CANNOT_TELL"),
        source=_SOURCES.get(said.source, "UNKNOWN"),
        legibility=_LEGIBILITIES.get(said.legibility, "CLEAR"),
        report_basis=_BASES.get(said.report_basis, "NOT_A_REPORT"),
    )


def _by_file(said: Sequence[FileSaid]) -> dict[UUID, FileSaid]:
    """A reading's entry per file: the first, where it describes one file twice."""
    found: dict[UUID, FileSaid] = {}
    for entry in said:
        found.setdefault(entry.file_id, entry)
    return found


def _distinct(lines: Iterable[str]) -> tuple[str, ...]:
    """The lines that say something, each once, in order."""
    seen: dict[str, str] = {}
    for line in lines:
        if line:
            seen.setdefault(line.casefold(), line)
    return tuple(seen.values())


def _relevance(one: Relevance, two: Relevance) -> Relevance:
    worse = max(one, two, key=_RELEVANCE_RANK.__getitem__)
    # One reading alone settles nothing: a file is not relevant only when both say so.
    if worse == "NOT_RELEVANT" and one != two:
        return "CANNOT_TELL"
    return worse


def _report_basis(one: ReportBasis, two: ReportBasis) -> ReportBasis:
    # A reading that takes the file for a report and names its basis is not undone by one
    # that does not take it for a report: the question of its basis stays open.
    named = [basis for basis in (one, two) if basis != "NOT_A_REPORT"]
    if not named:
        return "NOT_A_REPORT"
    return max(named, key=_BASIS_RANK.__getitem__)


def reconcile_files(
    first: Sequence[FileSaid], second: Sequence[FileSaid], file_ids: Sequence[UUID]
) -> tuple[FileReview, ...]:
    """One review per file of `file_ids`, in that order (each id once).

    Where the readings differ the more cautious stands: the less relevant (NOT_RELEVANT
    only when both say so, otherwise CANNOT_TELL), the source only when both name the
    same one, the worse legibility, and the worse report basis of those a reading names.
    A reading that does not mention a file said nothing of it, so a file neither mentions
    is CANNOT_TELL, UNKNOWN, CLEAR, NOT_A_REPORT. An entry for a file not in `file_ids`
    is ignored.
    """
    one, two = _by_file(first), _by_file(second)
    reviews: list[FileReview] = []
    for file_id in dict.fromkeys(file_ids):
        mine, theirs = (
            _checked(entry) if entry is not None else FileSaid(file_id)
            for entry in (one.get(file_id), two.get(file_id))
        )
        # Each reading's reason is kept where that reading has a reservation; a reason
        # given for finding a file relevant and clear explains nothing a person needs.
        relevance_notes = _distinct(
            clean_line(entry.relevance_reason, NOTE_LIMIT)
            for entry in (mine, theirs)
            if entry.relevance != "RELEVANT"
        )
        legibility_notes = _distinct(
            clean_line(entry.legibility_note, NOTE_LIMIT)
            for entry in (mine, theirs)
            if entry.legibility != "CLEAR"
        )
        reviews.append(
            FileReview(
                file_id=file_id,
                relevance=_relevance(mine.relevance, theirs.relevance),
                source=mine.source if mine.source == theirs.source else "UNKNOWN",
                legibility=max(
                    mine.legibility, theirs.legibility, key=_LEGIBILITY_RANK.__getitem__
                ),
                report_basis=_report_basis(mine.report_basis, theirs.report_basis),
                notes=_distinct((*relevance_notes, *legibility_notes)),
                legibility_notes=legibility_notes,
            )
        )
    return tuple(reviews)


# --- How complete and reliable the evidence is ---------------------------------------


@dataclass(frozen=True)
class LeftOut:
    """A file of the request the readings were not given, with the gate's code
    (CUSTODY, READ_FAILED, UNREADABLE, POPULATION, KIND_UNSURE) and its sentence."""

    name: str
    code: str
    reason: str


# The gate's codes for a file that could not be read at all. Any other code is a file
# that was readable and left out of this check (a population; KIND_UNSURE should not
# occur for engine 2, whose gate reads such a file, and counts the same way if given).
_NOT_READABLE = frozenset({"UNREADABLE", "READ_FAILED", "CUSTODY"})
_NO_NAME = "a file"


def _file_name(raw: str) -> str:
    return clean_line(raw, _NAME_LIMIT) or _NO_NAME


def _opening(name: str) -> str:
    """A file's name where it begins a sentence. A real name is never re-cased."""
    return "A file" if name == _NO_NAME else name


def _clause(raw: str, limit: int = NOTE_LIMIT) -> str:
    """One line with no closing full stop, to end a sentence with."""
    return clean_line(raw, limit).rstrip(" .")


def _closed(text: str) -> str:
    return text if text.endswith(("!", "?")) else f"{text}."


def _with(statement: str, raw: str) -> str:
    """The statement as a sentence, with its reason after a colon where there is one."""
    reason = _clause(raw)
    return _closed(f"{statement}: {reason}") if reason else f"{statement}."


def completeness_of(
    reviews: Sequence[FileReview],
    *,
    names: Mapping[UUID, str],
    left_out: Sequence[LeftOut] = (),
    read_in_part: Sequence[str] = (),
    relied_on: Collection[UUID] = (),
) -> tuple[Completeness, tuple[str, ...]]:
    """How complete and reliable the request's evidence is, with its sentences.

    Every condition that applies gives its sentences; the state is the worst that
    applies, worst first: PARTLY_UNREADABLE (a file that could not be read, or one a
    reading finds partly unreadable), INCOMPLETE (a file left out of the check or read
    only in part), RELIABILITY_UNRESOLVED (a supported attribute rests on a file whose
    source is a person or not shown, or on a report that does not show its basis),
    COMPLETE (no sentence).

    `relied_on` are the files a supported attribute rests on. A file nobody rests on
    never raises reliability, and passing custody is never mentioned as reliability.
    """
    unreadable: list[str] = []
    incomplete: list[str] = []
    unresolved: list[str] = []
    for file in left_out:
        name = _opening(_file_name(file.name))
        if file.code in _NOT_READABLE:
            unreadable.append(_with(f"{name} could not be read", file.reason))
        else:
            incomplete.append(_with(f"{name} was not part of the check", file.reason))
    for review in reviews:
        name = _opening(_file_name(names.get(review.file_id, "")))
        note = review.legibility_notes[0] if review.legibility_notes else ""
        if review.legibility == "UNREADABLE":
            unreadable.append(_with(f"{name} could not be read", note))
        elif review.legibility == "PARTLY_UNREADABLE":
            unreadable.append(_with(f"{name} is partly unreadable", note))
    incomplete.extend(
        f"{_opening(_file_name(name))} is long and was read only in part." for name in read_in_part
    )
    reviewed = {review.file_id for review in reviews}
    for review in reviews:
        if review.file_id in relied_on:
            unresolved.extend(
                _reliability(
                    _file_name(names.get(review.file_id, "")), review.source, review.report_basis
                )
            )
    # Support that rests on a file no review describes: its source is not shown. Sorted,
    # so the sentences do not depend on the order of a set.
    unresolved.extend(
        sentence
        for name in sorted(
            _file_name(names.get(file_id, "")) for file_id in relied_on if file_id not in reviewed
        )
        for sentence in _reliability(name, "UNKNOWN", "NOT_A_REPORT")
    )
    state: Completeness = (
        "PARTLY_UNREADABLE"
        if unreadable
        else "INCOMPLETE"
        if incomplete
        else "RELIABILITY_UNRESOLVED"
        if unresolved
        else "COMPLETE"
    )
    return state, _distinct((*unreadable, *incomplete, *unresolved))


def _reliability(name: str, source: Source, basis: ReportBasis) -> tuple[str, ...]:
    """What is not established about a file an attribute rests on. A system's own record
    or a document, with nothing open about a report's basis, gives nothing."""
    sentences: list[str] = []
    if source == "MANAGEMENT_PREPARED":
        sentences.append(
            f"{_opening(name)} was prepared by a person, not produced by a system: what it "
            "shows needs corroboration."
        )
    elif source == "UNKNOWN":
        sentences.append(
            f"The source of {name} is not shown, so what it shows needs corroboration."
        )
    if basis == "NOT_SHOWN":
        sentences.append(
            f"{_opening(name)} is a report or listing that does not show its source, run "
            "date or parameters, so its completeness and accuracy are not established."
        )
    elif basis == "PARTLY_SHOWN":
        sentences.append(
            f"{_opening(name)} is a report or listing that shows only part of its source, "
            "run date and parameters, so its completeness and accuracy are not established."
        )
    return tuple(sentences)


# --- The outcome proposed for the request --------------------------------------------


@dataclass(frozen=True)
class AttributeLine:
    """One attribute the request asks for, as assessed. `note` is its first open element
    or what is missing: one clause, no full stop."""

    code: str
    assessment: Assessment
    note: str = ""


NO_ATTRIBUTE = "This request names no attribute to test, so there is nothing to conclude on."
POTENTIAL = "This is a potential exception for the auditor to investigate, not a conclusion."
NEEDS_CORROBORATION = "What it rests on needs corroboration before it is relied on."
NOTHING_MORE = "No further evidence is needed for this request."
FILE_NOT_READ = "A file was not read; what the read files show still stands."
FILE_AWAITED = "A file is still to be read before this can be concluded."
JUDGMENT = "A person's judgment is needed to conclude."
CONTEXT_THIN = (
    "The control's understanding is not confirmed yet, so the evidence was judged against "
    "the attributes alone."
)
# The line the explanation names: the first of the most serious kind that is open.
_OPEN: dict[str, str] = {
    "CONTRADICTED": "is contradicted by the records",
    "NOT_DEMONSTRATED": "is not demonstrated",
    "PARTIALLY_SUPPORTED": "is shown only in part",
    "INDETERMINATE": "could not be concluded",
}
_OPEN_ORDER = tuple(_OPEN)


def _count(total: int, supported: int) -> str:
    if total == 1:
        return (
            "The requested attribute is supported."
            if supported
            else "The requested attribute is not supported yet."
        )
    if supported == total:
        return f"All {total} requested attributes are supported."
    if not supported:
        return f"None of the {total} requested attributes is supported yet."
    verb = "is" if supported == 1 else "are"
    return f"{supported} of {total} requested attributes {verb} supported."


def _first_open(lines: Sequence[AttributeLine]) -> str:
    """The sentence for the first line that is not satisfied, or "" when all are."""
    for kind in _OPEN_ORDER:
        for line in lines:
            if line.assessment == kind:
                code = clean_line(line.code, _CODE_LIMIT) or "An attribute"
                return _with(f"{code} {_OPEN[kind]}", line.note)
    return ""


def _several(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'} would resolve what is open."


def overall_of(
    lines: Sequence[AttributeLine],
    *,
    completeness: Completeness,
    follow_up_kinds: Sequence[str],
    waiting_on_file: bool = False,
    context_thin: bool = False,
) -> tuple[Overall, str]:
    """The outcome proposed for the request, and its explanation. Never a conclusion.

    In this order: an asked attribute CONTRADICTED is a POTENTIAL_EXCEPTION, whatever
    else is open or unread; every asked attribute SATISFIED is SUFFICIENT, or
    ADDITIONAL_EVIDENCE where what it rests on needs corroboration (a file left out or
    unreadable does not undo what the read files show); a file waited for with no
    follow-up is UNABLE_TO_CONCLUDE; follow-ups that are all clarifications are
    CLARIFICATION, any other follow-up ADDITIONAL_EVIDENCE; anything else, and a request
    that asks for no attribute, is UNABLE_TO_CONCLUDE.

    The explanation is at most three sentences, written from the counts: how many asked
    attributes are supported, the first that is not and why, and what would close it. A
    fourth says so where the control's understanding is thin.
    """
    thin = (CONTEXT_THIN,) if context_thin else ()
    if not lines:
        return "UNABLE_TO_CONCLUDE", " ".join((NO_ATTRIBUTE, *thin))
    supported = sum(1 for line in lines if line.assessment == "SATISFIED")
    follow_ups = len(follow_up_kinds)
    overall: Overall
    if any(line.assessment == "CONTRADICTED" for line in lines):
        overall, closing = "POTENTIAL_EXCEPTION", POTENTIAL
    elif supported == len(lines):
        if completeness == "RELIABILITY_UNRESOLVED":
            overall, closing = "ADDITIONAL_EVIDENCE", NEEDS_CORROBORATION
        elif completeness in ("INCOMPLETE", "PARTLY_UNREADABLE"):
            overall, closing = "SUFFICIENT", f"{NOTHING_MORE} {FILE_NOT_READ}"
        else:
            overall, closing = "SUFFICIENT", NOTHING_MORE
    elif waiting_on_file and not follow_ups:
        # The file is the next step: asking for more before it is read would ask for
        # what it may already hold.
        overall, closing = "UNABLE_TO_CONCLUDE", FILE_AWAITED
    elif follow_ups and all(kind == "CLARIFICATION" for kind in follow_up_kinds):
        overall, closing = "CLARIFICATION", _several(follow_ups, "clarification")
    elif follow_ups:
        overall, closing = "ADDITIONAL_EVIDENCE", _several(follow_ups, "follow-up")
    else:
        overall, closing = "UNABLE_TO_CONCLUDE", JUDGMENT
    sentences = (_count(len(lines), supported), _first_open(lines), closing, *thin)
    return overall, " ".join(sentence for sentence in sentences if sentence)
