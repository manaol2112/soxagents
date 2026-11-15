"""The D&I workpaper's assembled view (docs/design-workpaper.md, section 2): the pure
part, with synthetic records only. No database, no model, no file.

Audit integrity:

- an attribute's state comes from the current checks alone; across requests the most
  cautious reading stands (an exception, then what any check leaves open, then shown), and
  a failed comparison never sits beside "shown";
- a tickmark never claims more than the state: agreed or compared only for an attribute
  shown by the records of an instance, on files whose reliability the check's review leaves
  no question about, with no check of it open and no comparison failed;
- a check that is out of date, failed, queued, running, held whole or never made gives no
  state, mark, procedure or follow-up, whatever it holds;
- a file is marked as showing an attribute, or an exception, only by a current check's own
  passages; an annotation stands by its request's check or by a person, never by the run
  that first proposed it;
- a procedure is listed only where the records show it was done;
- a conclusion is signed only from the D&I conclusion's own sign-off record;
- an engine 1 check gives states and SHOWS marks, never a comparison or a follow-up.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest

from ai_workforce_api import design_workpaper as view
from ai_workforce_api.attribute_dispositions import Disposition
from ai_workforce_api.design_conclusions import DesignConclusionBody, SignoffRecord
from ai_workforce_api.design_workpaper import (
    MAX_EVIDENCE,
    MAX_MATTERS,
    ONLY_OUT_OF_DATE,
    SEPARATE_NOTE,
    STATE_BASIS,
    STATE_WORDS,
    TICKMARKS,
    AnnotationRecord,
    AttributeRecord,
    CheckRecord,
    FileRecord,
    FindingRecord,
    HeldFile,
    Reading,
    RequestRecord,
    StoredOutcome,
    annotations_standing,
    attribute_notes,
    attributes_of,
    can_edit_sections,
    conclusion_of,
    evidence_index,
    first_date,
    legend,
    marks_of,
    matters_of,
    named_files,
    procedures_of,
    readings_of,
    reports_inspected,
    reports_of,
    row_refs,
    row_when,
    standing,
    tickmark_of,
    walkthrough_of,
)
from ai_workforce_api.evidence_assurance import (
    CompletenessBody,
    ConsiderationBody,
    FileReviewBody,
    PassageBody,
    ReviewBody,
    ReviewFollowUpBody,
)
from ai_workforce_api.workpaper_fill import Section

A, B, C, D = (UUID(int=number) for number in (1, 2, 3, 4))
R1, R2 = UUID(int=20), UUID(int=21)
F1, F2, F3 = UUID(int=30), UUID(int=31), UUID(int=32)
RUN1, RUN2, OLD_RUN = UUID(int=40), UUID(int=41), UUID(int=42)
ATTRIBUTES = [
    AttributeRecord(A, "A", "Access is approved before it is granted."),
    AttributeRecord(B, "B", "The approver is the user's line manager."),
    AttributeRecord(C, "C", "Access granted matches what was approved."),
    AttributeRecord(D, "D", "Access is removed within one day of leaving."),
]
TICKET = FileRecord(F1, "ticket REQ-1041.txt", "walkthrough", "text/plain")
LOG = FileRecord(F2, "sap change log.txt", "change_history", "text/plain")
SCREEN = FileRecord(F3, "role screen.png", "configuration", "image/png")
REQUESTS = [
    RequestRecord(R1, "Walkthrough instance", (TICKET, LOG), frozenset({A, B, C})),
    RequestRecord(R2, "Role configuration", (SCREEN, TICKET), frozenset({C, D})),
]
_DEFAULT: Any = object()


def _item(
    attribute: UUID,
    verdict: str = "SUPPORTED",
    *,
    assessment: str | None = "SATISFIED",
    expected: bool = True,
    result: str | None = "MET",
    summary: str = "",
    files: tuple[UUID, ...] = (F1,),
    element: str | None = "MET",
    deviation: bool = False,
    checks: tuple[tuple[str, str], ...] = (),
    shows: str | None = "IMPLEMENTATION",
) -> StoredOutcome:
    """One attribute of a finished check, as the run's record keeps it."""
    passages = [{"quote": "the file's own words", "file_id": str(file)} for file in files]
    return StoredOutcome.model_validate(
        {
            "attribute_id": str(attribute),
            "code": "A",
            "expected": expected,
            "verdict": verdict,
            "result": result,
            "summary": summary,
            "shows": shows,
            "passages": passages,
            "elements": [
                {"key": "wording", "text": "the element", "result": element,
                 "passages": passages, "absent": [], "deviation": deviation}
            ],
            "assessment": assessment,
            "checks": [
                {"element": "wording", "test": "NOT_AFTER", "status": status, "sentence": said}
                for status, said in checks
            ],
            "views": [{"role": "ASSESSOR", "result": "MET", "reason": "a reading's own words"}],
        }
    )  # fmt: skip


def _said(file: UUID, source: str = "SYSTEM_RECORD", basis: str = "NOT_A_REPORT") -> FileReviewBody:
    """What a check's review says a file is."""
    return FileReviewBody(
        file_id=file, relevance="RELEVANT", source=source, legibility="CLEAR",  # type: ignore[arg-type]
        report_basis=basis,  # type: ignore[arg-type]
    )  # fmt: skip


def _review(state: str = "COMPLETE", reasons: tuple[str, ...] = (), **parts: Any) -> ReviewBody:
    """An engine 2 check's review: every file a system's own record, unless said."""
    parts.setdefault("files", [_said(F1), _said(F2), _said(F3)])
    return ReviewBody(
        overall="SUFFICIENT", explanation="",
        completeness=CompletenessBody(state=state, reasons=list(reasons)),  # type: ignore[arg-type]
        **parts,
    )  # fmt: skip


def _check(
    *items: StoredOutcome,
    requirement: UUID = R1,
    status: str = "REVIEWED",
    engine: int = 2,
    run: UUID = RUN1,
    files: tuple[UUID, ...] = (F1, F2),
    partial: tuple[UUID, ...] = (),
    held: tuple[HeldFile, ...] = (),
    review: Any = _DEFAULT,
    out_of_date: tuple[str, ...] = (),
) -> CheckRecord:
    """The latest check of a request. An engine 2 check has a review; an engine 1 none."""
    if review is _DEFAULT:
        review = _review() if engine >= 2 else None
    return CheckRecord(
        requirement_id=requirement,
        status=status,  # type: ignore[arg-type]
        run_id=run,
        engine=engine,
        file_ids=files,
        partial=partial,
        held=held,
        outcome=items,
        review=review,
        out_of_date=out_of_date,
    )


def _annotation(
    number: int,
    kind: str,
    *attributes: UUID,
    file: UUID = F1,
    requirement: UUID = R1,
    status: str = "PROPOSED",
    origin: str = "AGENT",
    run: UUID | None = RUN1,
) -> AnnotationRecord:
    return AnnotationRecord(
        id=UUID(int=500 + number + file.int * 10 + requirement.int * 100),
        requirement_id=requirement,
        file_id=file,
        kind=kind,  # type: ignore[arg-type]
        status=status,
        origin=origin,
        attribute_ids=attributes,
        assessment_id=run,
        number=number,
    )


def _index(
    requests: list[RequestRecord] | None = None,
    checks: dict[UUID, CheckRecord] | None = None,
    annotations: list[AnnotationRecord] | None = None,
) -> list[view.EvidenceBody]:
    return evidence_index(requests or REQUESTS, checks or {}, annotations or [])[0]


def _walk(steps: int = 0, source: str = "AGENT") -> view.WalkthroughBody:
    """A walkthrough of so many recorded steps."""
    return view.WalkthroughBody(
        columns=STANDARD,
        steps=[
            view.StepBody(number=n, when="", step=f"Step {n}", who="", evidence="", result="")
            for n in range(1, steps + 1)
        ],
        source=source,  # type: ignore[arg-type]
    )


def _attribute(code: str, checks: dict[UUID, CheckRecord]) -> view.AttributeBody:
    shown, _readings = attributes_of(ATTRIBUTES, REQUESTS, checks, [], _index(checks=checks), None)
    return next(attribute for attribute in shown if attribute.code == code)


STANDARD = ["Step", "Who", "Evidence inspected", "Result"]


# --- An attribute's state ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("assessment", "state"),
    [
        ("CONTRADICTED", "EXCEPTION"),
        ("SATISFIED", "SHOWN"),
        ("PARTIALLY_SUPPORTED", "SHOWN_IN_PART"),
        ("NOT_DEMONSTRATED", "NOT_SHOWN"),
        ("INDETERMINATE", "NOT_CONCLUDED"),
    ],
)
def test_a_current_check_gives_each_state_with_its_own_sentence(
    assessment: str, state: str
) -> None:
    said = "The check's own sentence for attribute A."
    found = readings_of(_check(_item(A, assessment=assessment, summary=said)))
    assert (found[A].state, found[A].basis) == (state, said)
    # Where the check stored no sentence, one is written here from the state alone.
    bare = readings_of(_check(_item(A, assessment=assessment)))
    assert bare[A].basis == STATE_BASIS[state]  # type: ignore[index]
    assert set(STATE_WORDS) == set(STATE_BASIS) == set(view._PRECEDENCE)


def test_no_current_check_is_not_tested_and_says_so() -> None:
    assert standing([]) == ("NOT_TESTED", "No current check covers this attribute.")
    shown, _readings = attributes_of(ATTRIBUTES, REQUESTS, {}, [], _index(), None)
    assert {a.state for a in shown} == {"NOT_TESTED"}
    assert {a.state_words for a in shown} == {"Not tested yet"}
    assert all(a.tickmark == "NONE" and a.marks == {} and a.refs == [] for a in shown)


@pytest.mark.parametrize(
    "status", ["OUT_OF_DATE", "FAILED", "QUEUED", "CHECKING", "HELD", "NOT_CHECKED"]
)
def test_a_check_that_is_not_current_contributes_nothing_whatever_it_holds(status: str) -> None:
    """Even handed the full result of a reviewed run, a check in any other status gives no
    state, no mark, no procedure, no completeness matter and no follow-up."""
    review = _review(
        "INCOMPLETE", ("sap change log.txt is long and was read only in part.",),
        files=[_said(F1), _said(F2, basis="SHOWN")],
        follow_ups=[ReviewFollowUpBody(key=f"{A}:wording", request="Provide the grant record.",
                                       kind="EVIDENCE", priority="HIGH")],
        considerations=[ConsiderationBody(text="The screenshot is undated.")],
    )  # fmt: skip
    check = _check(
        _item(A, summary="Shown.", checks=(("PASSED", "Approved before granted."),)),
        _item(B, verdict="ISSUE", assessment="CONTRADICTED", result="NOT_MET", deviation=True,
              element="NOT_MET"),
        status=status, review=review, partial=(F2,),
        out_of_date=("A file was added to this request.",),
    )  # fmt: skip
    assert readings_of(check) == {}
    checks = {R1: check}
    evidence = _index(checks=checks)
    annotations = [_annotation(1, "IDENTIFIES", A), _annotation(2, "SOURCE")]
    shown, readings = attributes_of(ATTRIBUTES, REQUESTS, checks, annotations, evidence, None)
    assert {a.state for a in shown} == {"NOT_TESTED"}
    assert all(a.marks == {} and a.refs == [] and a.checks == [] for a in shown)
    assert all(a.tickmark == "NONE" for a in shown)
    assert procedures_of(REQUESTS, checks, ATTRIBUTES, _walk()) == []
    assert reports_inspected(REQUESTS, checks) == []
    matters = matters_of(REQUESTS, checks, ATTRIBUTES, readings, [], evidence)
    assert not [m for m in matters if m.kind in ("FOLLOW_UP", "CONSIDERATION", "COMPLETENESS")]
    by_code = {a.code: a for a in shown}
    if status == "OUT_OF_DATE":
        # The views are told, first: the only checks are out of date.
        assert by_code["A"].basis == ONLY_OUT_OF_DATE
        assert by_code["D"].basis == STATE_BASIS["NOT_TESTED"]
        told = matters[0]
        assert (told.kind, told.state) == ("UNSETTLED", "OPEN") and "out of date" in told.text
        assert "A file was added to this request." in told.text
        assert told.refs == ["E1", "E2"]
    else:
        assert by_code["A"].basis == STATE_BASIS["NOT_TESTED"]
        assert not [m for m in matters if m.kind == "UNSETTLED"]


def test_across_requests_the_most_cautious_reading_stands() -> None:
    """Rewritten 14 November 2026 after the independent review (the contract's section 2
    was tightened with it). Old expectation
    (`test_an_exception_wins_over_every_other_state`): the order was EXCEPTION, SHOWN,
    SHOWN_IN_PART, NOT_SHOWN, NOT_CONCLUDED, so an attribute one request showed read
    "Shown" while another request's check left it open. New: EXCEPTION, then
    NOT_CONCLUDED where any current check leaves it open, then SHOWN, SHOWN_IN_PART,
    NOT_SHOWN. Kept as it was: an exception wins over everything, with its own sentence,
    its files marked and never "shown"."""
    order = ["EXCEPTION", "NOT_CONCLUDED", "SHOWN", "SHOWN_IN_PART", "NOT_SHOWN"]
    readings = [Reading(R1, state, f"basis of {state}") for state in order]  # type: ignore[arg-type]
    # Whatever order the checks come in, the most cautious state stands with its sentence.
    for start in range(len(order)):
        for some in (readings[start:], list(reversed(readings[start:]))):
            assert standing(some) == (order[start], f"basis of {order[start]}")
    # One request shows the attribute, another's records contradict it: never "shown".
    checks = {
        R1: _check(_item(C, summary="Both readings find this instance shows attribute C.")),
        R2: _check(
            _item(C, verdict="ISSUE", assessment="CONTRADICTED", result="NOT_MET", files=(F3,),
                  element="NOT_MET", deviation=True,
                  summary="Both readings find the evidence does not show attribute C."),
            requirement=R2, run=RUN2, files=(F3, F1),
        ),
    }  # fmt: skip
    evidence = _index(checks=checks)
    shown, _readings = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None)
    found = next(a for a in shown if a.code == "C")
    assert (found.state, found.state_words, found.tickmark) == (
        "EXCEPTION", "Exception shown", "EXCEPTION",
    )  # fmt: skip
    assert found.basis == "Both readings find the evidence does not show attribute C."
    # The file with the record of the exception is marked so; the other still shows it.
    assert found.marks == {"E1": "SHOWS", "E3": "EXCEPTION"}
    assert [ref.ref for ref in found.refs] == ["E1", "E3"]


def test_a_check_that_leaves_an_attribute_open_stands_over_another_that_shows_it() -> None:
    open_ = "The two readings do not agree. Your judgment is needed."
    checks = {
        R1: _check(_item(C, summary="Both readings find this instance shows attribute C.",
                         checks=(("PASSED", "Approved before granted."),))),
        R2: _check(
            _item(C, verdict="UNSETTLED", assessment="INDETERMINATE", result=None, element=None,
                  summary=open_, files=()),
            requirement=R2, run=RUN2, files=(F3, F1),
        ),
    }  # fmt: skip
    found = _attribute("C", checks)
    assert (found.state, found.state_words, found.basis) == (
        "NOT_CONCLUDED",
        "Not concluded",
        open_,
    )
    # Nothing is marked as agreed or compared while a check of it is open.
    assert found.tickmark == "NONE"
    # What the first request's files do for it is still said, file by file.
    assert found.marks == {"E1": "SHOWS"} and [r.ref for r in found.refs] == ["E1"]
    # The same whichever request comes first.
    swapped = {R1: checks[R1], R2: checks[R2]}
    turned = [REQUESTS[1], REQUESTS[0]]
    shown, _readings = attributes_of(ATTRIBUTES, turned, swapped, [], _index(turned), None)
    assert next(a for a in shown if a.code == "C").state == "NOT_CONCLUDED"


def test_shown_on_one_request_and_not_on_another_stays_shown_and_is_a_matter() -> None:
    late = "Performed 4 March 2026, approved 5 March 2026: the performance is before."
    checks = {
        R1: _check(_item(C, summary="Both readings find this instance shows attribute C.",
                         checks=(("PASSED", "Approved before granted."),))),
        R2: _check(
            # Not demonstrated here; a comparison named for it failed on a file for
            # another system, which the check does not take for an exception.
            _item(C, verdict="ISSUE", assessment="NOT_DEMONSTRATED", result="NOT_MET",
                  element="NOT_MET", files=(), checks=(("FAILED", late),),
                  summary="Both readings find the evidence does not show attribute C."),
            requirement=R2, run=RUN2, files=(F3, F1),
        ),
    }  # fmt: skip
    evidence = _index(checks=checks)
    shown, readings = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None)
    found = next(a for a in shown if a.code == "C")
    assert found.state == "SHOWN"
    assert found.basis == "Both readings find this instance shows attribute C."
    # The sentence of a comparison that failed is never listed under "shown", and no
    # mark is given while a current check of the attribute holds one.
    assert found.checks == ["Approved before granted."] and late not in found.checks
    assert found.tickmark == "NONE"
    [told] = [
        m for m in matters_of(REQUESTS, checks, ATTRIBUTES, readings, [], evidence)
        if m.kind == "UNSETTLED"
    ]  # fmt: skip
    assert (told.state, told.refs) == ("OPEN", ["E1"])
    assert told.text == (
        "Attribute C is shown by the evidence for \u201cWalkthrough instance\u201d and not "
        "shown by the evidence for \u201cRole configuration\u201d, which also asks for it."
    )
    # Where the attribute is not shown, the failed comparison's sentence is listed.
    alone = {R2: checks[R2]}
    assert _attribute("C", alone).checks == [late]


def test_an_attribute_a_request_does_not_ask_for_is_given_only_where_contradicted() -> None:
    aside = _item(A, expected=False, assessment=None, verdict="SUPPORTED")
    assert readings_of(_check(aside)) == {}
    against = _item(
        A, expected=False, assessment="CONTRADICTED", verdict="ISSUE", result="CONTRADICTED",
        element=None,
    )  # fmt: skip
    found = readings_of(_check(against))[A]
    # Two records that disagree: both are the exception's files; nothing "shows" it.
    assert (found.state, found.exceptions, found.shows) == ("EXCEPTION", (F1,), ())
    # A comparison that failed for it is kept, with no state of its own: nothing is
    # marked as agreed beside it on another request.
    held = _item(A, expected=False, assessment=None, verdict="NOT_ADDRESSED",
                 checks=(("FAILED_ONE", "One reading's values differ."),))  # fmt: skip
    kept = readings_of(_check(held, requirement=R2, run=RUN2))[A]
    assert (kept.state, kept.failed, kept.open) == ("NOT_TESTED", True, False)
    checks = {R1: _check(_item(A)), R2: _check(held, requirement=R2, run=RUN2)}
    both = _attribute("A", checks)
    assert (both.state, both.tickmark, both.checks) == ("SHOWN", "NONE", [])
    assert _attribute("A", {R1: checks[R1]}).tickmark == "AGREED"


def test_a_failed_comparison_never_sits_beside_shown() -> None:
    """Never expected of the check (it takes support away itself); held here as well."""
    for status in ("FAILED", "FAILED_ONE"):
        said = "Approved 11 January 2027, performed 10 January 2027."
        found = readings_of(_check(_item(A, checks=((status, said),))))[A]
        assert (found.state, found.open, found.failed) == ("NOT_CONCLUDED", True, True)
        assert (found.compared, found.checks, found.failed_checks) == (False, (), (said,))
    passed = readings_of(_check(_item(A, checks=(("PASSED", "Approved before granted."),))))[A]
    assert (passed.state, passed.compared, passed.failed) == ("SHOWN", True, False)
    # A comparison that was not made is no comparison: not listed, no tickmark.
    not_run = readings_of(_check(_item(A, checks=(("NOT_RUN", "It could not be compared."),))))[A]
    assert (not_run.state, not_run.compared, not_run.checks) == ("SHOWN", False, ())
    assert (not_run.failed, not_run.failed_checks) == (False, ())


def test_an_engine_1_check_gives_states_and_shows_marks_and_nothing_else() -> None:
    """Section 3: its state from the check's own element results, its SHOWS marks from
    their verified passages; no comparison, so no COMPARED tickmark."""
    supported = _item(A, assessment=None, checks=(("PASSED", "A comparison it never had."),))
    deviation = _item(
        B, verdict="ISSUE", assessment=None, result="NOT_MET", element="NOT_MET",
        deviation=True, files=(F2,),
    )  # fmt: skip
    absent = _item(C, verdict="ISSUE", assessment=None, result="NOT_MET", element="NOT_MET",
                   files=())  # fmt: skip
    part = _item(D, verdict="PARTLY_SUPPORTED", assessment=None, result="SHOWN_IN_PART")
    found = readings_of(_check(supported, deviation, absent, part, engine=1))
    assert {key: reading.state for key, reading in found.items()} == {
        A: "SHOWN", B: "EXCEPTION", C: "NOT_SHOWN", D: "SHOWN_IN_PART",
    }  # fmt: skip
    assert (found[A].compared, found[A].checks) == (False, ())
    assert found[A].shows == (F1,) and found[B].exceptions == (F2,)
    # It made no review of its files, so their reliability was never answered: shown, and
    # no tickmark (before 14 November 2026 review: AGREED, which claimed a review that
    # was not made).
    assert found[A].unreliable is True
    assert tickmark_of("SHOWN", [found[A]]) == "NONE"
    design = readings_of(_check(_item(A, assessment=None, shows="DESIGN"), engine=1))[A]
    assert tickmark_of("SHOWN", [design]) == "NONE"
    # Left to a person: unsettled, and an exception shown beside a file not read.
    unsettled = _item(A, verdict="UNSETTLED", assessment=None, result=None, element=None)
    beside = _item(B, verdict="UNSETTLED", assessment=None, result=None, element="NOT_MET",
                   deviation=True)  # fmt: skip
    found = readings_of(_check(unsettled, beside, engine=1))
    assert (found[A].state, found[A].open) == ("NOT_CONCLUDED", True)
    assert (found[B].state, found[B].open) == ("EXCEPTION", True)
    # An engine 1 check has no review: no follow-up and no consideration comes of it.
    checks = {R1: _check(supported, engine=1)}
    evidence = _index(checks=checks)
    _shown, readings = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None)
    kinds = {m.kind for m in matters_of(REQUESTS, checks, ATTRIBUTES, readings, [], evidence)}
    assert kinds == {"NOTE"}
    procedures = procedures_of(REQUESTS, checks, ATTRIBUTES, _walk())
    assert not any("Compared" in line for line in procedures)


# --- Tickmarks and marks ----------------------------------------------------------------


def test_a_tickmark_never_claims_more_than_the_state() -> None:
    shown = Reading(R1, "SHOWN", "shown", implementation=True)
    compared = Reading(R2, "SHOWN", "shown", implementation=True, compared=True)
    assert tickmark_of("SHOWN", [shown]) == "AGREED"
    assert tickmark_of("SHOWN", [shown, compared]) == "COMPARED"
    assert tickmark_of("EXCEPTION", [compared, Reading(R2, "EXCEPTION", "no")]) == "EXCEPTION"
    # Only what a document requires: the design, not the implementation.
    design = Reading(R1, "SHOWN", "shown", implementation=False, compared=True)
    assert tickmark_of("SHOWN", [design]) == "NONE"
    # A reliability question open on the files the showing rests on.
    doubted = Reading(R1, "SHOWN", "shown", implementation=True, unreliable=True, compared=True)
    assert tickmark_of("SHOWN", [doubted]) == "NONE"
    # The comparison counts only on a check the mark can rest on.
    assert tickmark_of("SHOWN", [shown, doubted]) == "AGREED"
    assert tickmark_of("SHOWN", [shown, design]) == "AGREED"
    # Any current check of the attribute open, or holding a comparison that failed.
    waiting = Reading(R2, "NOT_SHOWN", "no", open=True)
    failed = Reading(R2, "NOT_SHOWN", "no", failed=True)
    assert tickmark_of("SHOWN", [compared, waiting]) == "NONE"
    assert tickmark_of("SHOWN", [compared, failed]) == "NONE"
    # A comparison that passes supports nothing by itself: no mark unless it is shown.
    for state in ("SHOWN_IN_PART", "NOT_SHOWN", "NOT_CONCLUDED", "NOT_TESTED"):
        assert tickmark_of(state, [compared]) == "NONE"


def test_the_mark_rests_on_what_the_stored_check_and_its_review_say() -> None:
    passed = (("PASSED", "Approved before granted."),)

    def mark(review: Any = _DEFAULT, **item: Any) -> str:
        return _attribute("A", {R1: _check(_item(A, **item), review=review)}).tickmark

    assert mark() == "AGREED" and mark(checks=passed) == "COMPARED"
    # The stored outcome says what is shown: a document's requirement is not the
    # system's own record, whatever comparison passed.
    assert mark(shows="DESIGN", checks=passed) == "NONE"
    assert mark(shows=None) == "NONE"
    # The review says reliability is unresolved for the request.
    assert mark(_review("RELIABILITY_UNRESOLVED", ("The source of a file is not shown.",))) == (
        "NONE"
    )
    # The file the showing rests on was prepared by a person, is of a source not shown,
    # is a report that does not show its basis, or is not described at all.
    for said in (
        _said(F1, source="MANAGEMENT_PREPARED"),
        _said(F1, source="UNKNOWN"),
        _said(F1, basis="NOT_SHOWN"),
        _said(F1, basis="PARTLY_SHOWN"),
    ):
        assert mark(_review(files=[said, _said(F2)]), checks=passed) == "NONE"
    assert mark(_review(files=[_said(F2)])) == "NONE"
    # A review that cannot be read leaves the question open.
    assert mark(None) == "NONE"
    # A file the showing does not rest on raises nothing for it.
    other = _review(files=[_said(F1), _said(F2, source="MANAGEMENT_PREPARED")])
    assert mark(other, checks=passed) == "COMPARED"
    # A report that shows its basis is no question.
    assert mark(_review(files=[_said(F1, basis="SHOWN")])) == "AGREED"


def test_the_legend_names_report_parameters_only_where_a_procedure_says_so() -> None:
    assert [(t.mark, t.symbol) for t in TICKMARKS] == [
        ("AGREED", "\u2713"), ("COMPARED", "\u2261"), ("INSPECTED", "\u25ca"),
        ("EXCEPTION", "\u2717"),
    ]  # fmt: skip
    assert [t.mark for t in legend(False)] == ["AGREED", "COMPARED", "EXCEPTION"]
    assert legend(True) == list(TICKMARKS)
    shown = {R1: _check(_item(A), review=_review(files=[_said(F1), _said(F2, basis="SHOWN")]))}
    part = {
        R1: _check(_item(A), review=_review(files=[_said(F1), _said(F2, basis="PARTLY_SHOWN")]))
    }
    assert reports_inspected(REQUESTS, shown) == ["sap change log.txt"]
    assert reports_inspected(REQUESTS, part) == [] and reports_inspected(REQUESTS, {}) == []
    # The entry and the procedure go together.
    for checks in (shown, part):
        said = any("parameters" in p for p in procedures_of(REQUESTS, checks, ATTRIBUTES, _walk()))
        assert said == bool(reports_inspected(REQUESTS, checks))


def test_a_mark_is_the_strongest_thing_a_file_does_for_the_attribute() -> None:
    checks = {R1: _check(_item(A, files=(F1,)))}
    evidence = _index(checks=checks)
    readings = [readings_of(checks[R1])[A]]
    annotations = [
        _annotation(1, "IDENTIFIES", A, file=F1),  # weaker than the passage that shows it
        _annotation(1, "IDENTIFIES", A, file=F2),
        _annotation(2, "SOURCE", file=F2),  # weaker than what identifies
        _annotation(1, "SOURCE", file=F3, requirement=R2, run=None, origin="PERSON",
                    status="CONFIRMED"),
    ]  # fmt: skip
    stand = annotations_standing(annotations, REQUESTS, checks)
    assert stand == annotations
    found = marks_of(A, readings, stand, REQUESTS, evidence)
    # E3's source names no attribute: it bears on what its request asks for (C and D).
    assert found == {"E1": "SHOWS", "E2": "IDENTIFIES"}
    assert marks_of(C, [], stand, REQUESTS, evidence) == {"E2": "SOURCE", "E3": "SOURCE"}
    assert marks_of(B, [], stand, REQUESTS, evidence) == {"E2": "SOURCE"}
    # An exception's record outranks everything on the same file.
    worst = [*readings, Reading(R1, "EXCEPTION", "no", exceptions=(F1, F2))]
    assert marks_of(A, worst, stand, REQUESTS, evidence) == {"E1": "EXCEPTION", "E2": "EXCEPTION"}


def test_shows_and_exception_marks_come_only_from_a_current_checks_passages() -> None:
    """An annotation alone never marks a file as showing an attribute or an exception,
    whoever confirmed it: only the passages of a current check do."""
    checks = {R1: _check(_item(A, files=()))}
    evidence = _index(checks=checks)
    for kind in ("SHOWS", "EXCEPTION"):
        for annotation in (
            _annotation(1, kind, A),
            _annotation(1, kind, A, status="CONFIRMED"),
            _annotation(1, kind, A, run=None, origin="PERSON", status="CONFIRMED"),
        ):
            stand = annotations_standing([annotation], REQUESTS, checks)
            assert stand == [annotation]
            assert marks_of(A, [], stand, REQUESTS, evidence) == {}
    shown = _attribute("A", {R1: _check(_item(A, files=(F2,)))})
    assert shown.marks == {"E2": "SHOWS"}


def test_an_annotation_stands_by_its_requests_check_or_by_a_person() -> None:
    """Rewritten 14 November 2026 after the independent review. Old expectation
    (`test_only_an_annotation_that_stands_marks_a_file`): an agent's proposal stood where
    the run that proposed it (its assessment_id) was the current run, so a proposal a
    later run still cites, which keeps the earlier run's id
    (evidence_annotations._write_proposals), stood for nothing; and a confirmed SHOWS
    annotation marked a file by itself. New: a proposal stands while the check of its own
    request is current, whichever run first wrote it; a person's own, confirmed or edited
    annotation stands while its file is in force; and only IDENTIFIES and SOURCE marks
    come from annotations. Kept: a proposal of a check that is no longer current marks
    nothing, and a removed or superseded annotation is listed nowhere."""
    current = {R1: _check(_item(A, files=()))}
    stale = {R1: _check(_item(A, files=()), status="OUT_OF_DATE")}

    def marks(annotation: AnnotationRecord, checks: dict[UUID, CheckRecord]) -> dict[str, str]:
        stand = annotations_standing([annotation], REQUESTS, checks)
        return dict(marks_of(A, [], stand, REQUESTS, _index(checks=checks)))

    # Proposed, and its request's check is current: it stands, whichever run wrote it.
    assert marks(_annotation(1, "IDENTIFIES", A), current) == {"E1": "IDENTIFIES"}
    assert marks(_annotation(1, "IDENTIFIES", A, run=OLD_RUN), current) == {"E1": "IDENTIFIES"}
    # Its request's check is out of date, and nobody reviewed it: nothing.
    assert marks(_annotation(1, "IDENTIFIES", A), stale) == {}
    assert marks(_annotation(1, "IDENTIFIES", A), {}) == {}
    # Another request's check being current does not make it stand.
    elsewhere = {**stale, R2: _check(_item(C), requirement=R2, run=RUN2, files=(F3, F1))}
    assert marks(_annotation(1, "IDENTIFIES", A), elsewhere) == {}
    # A person confirmed or edited it, or made it: it is theirs, and stands.
    assert marks(_annotation(1, "IDENTIFIES", A, status="CONFIRMED"), stale) == {"E1": "IDENTIFIES"}
    assert marks(_annotation(1, "SOURCE", A, status="EDITED"), stale) == {"E1": "SOURCE"}
    own = _annotation(1, "IDENTIFIES", A, run=None, origin="PERSON", status="CONFIRMED")
    assert marks(own, {}) == {"E1": "IDENTIFIES"}
    # On a file that is no longer in force, nothing stands, whoever confirmed it.
    gone = _annotation(1, "IDENTIFIES", A, file=UUID(int=999), status="CONFIRMED")
    assert annotations_standing([gone], REQUESTS, current) == []
    # Removed and superseded annotations are listed nowhere.
    for status in ("REMOVED", "SUPERSEDED"):
        assert marks(_annotation(1, "IDENTIFIES", A, status=status), current) == {}
    # One that names another attribute bears on that one alone.
    assert marks(_annotation(1, "IDENTIFIES", B), current) == {}


def test_references_carry_the_numbers_the_annotation_viewer_shows() -> None:
    checks = {
        R1: _check(_item(A, files=(F1, F2))),
        R2: _check(_item(C, files=(F1, F3)), requirement=R2, run=RUN2, files=(F3, F1)),
    }
    annotations = [
        # Kept from an earlier run that a later run still cites: it stands all the same.
        _annotation(4, "SHOWS", A, B, run=OLD_RUN), _annotation(2, "IDENTIFIES", A),
        _annotation(3, "SOURCE"), _annotation(1, "SHOWS", B),
        _annotation(5, "SHOWS", A, status="SUPERSEDED"),
        # The ticket also serves the second request; its list there is numbered apart.
        _annotation(1, "SHOWS", C, requirement=R2, run=RUN2),
        _annotation(1, "SHOWS", C, file=F3, requirement=R2, run=RUN2),
    ]  # fmt: skip
    evidence = _index(checks=checks, annotations=annotations)
    shown, _readings = attributes_of(ATTRIBUTES, REQUESTS, checks, annotations, evidence, None)
    by_code = {a.code: a for a in shown}
    [ticket, log] = by_code["A"].refs
    assert (ticket.ref, ticket.numbers) == ("E1", [2, 4])
    assert ticket.annotation_ids == [annotations[1].id, annotations[0].id]
    assert (log.ref, log.numbers, log.annotation_ids) == ("E2", [], [])
    # C's passage in the ticket is annotated on the second request: the ticket is listed
    # under its first, whose list is the one the viewer opens, so no number is given.
    assert [(r.ref, r.numbers) for r in by_code["C"].refs] == [("E1", []), ("E3", [1])]
    # The index counts what is listed for the file on its own request.
    assert [(e.ref, e.annotations, e.reviewed) for e in evidence] == [
        ("E1", 4, 0), ("E2", 0, 0), ("E3", 1, 0),
    ]  # fmt: skip


def test_a_stale_checks_proposals_are_never_cited_as_the_basis() -> None:
    """The first request's check is out of date; the second's is current and shows C in
    the ticket, which is listed under the first. The first's unreviewed proposals on the
    ticket are still listed for review, and are not numbered as C's basis."""
    checks = {
        R1: _check(_item(C), status="OUT_OF_DATE"),
        R2: _check(_item(C, files=(F1,)), requirement=R2, run=RUN2, files=(F3, F1)),
    }
    proposed = _annotation(1, "SHOWS", C)
    evidence = _index(checks=checks, annotations=[proposed])
    assert [(e.ref, e.annotations) for e in evidence][0] == ("E1", 1)

    def refs(annotation: AnnotationRecord) -> list[tuple[str, list[int]]]:
        shown, _r = attributes_of(ATTRIBUTES, REQUESTS, checks, [annotation], evidence, None)
        found = next(a for a in shown if a.code == "C")
        assert found.state == "SHOWN"
        return [(ref.ref, ref.numbers) for ref in found.refs]

    assert refs(proposed) == [("E1", [])]
    # Once a person has confirmed it, it is theirs, and is cited.
    assert refs(_annotation(1, "SHOWS", C, status="CONFIRMED")) == [("E1", [1])]


# --- The evidence index -----------------------------------------------------------------


def test_a_file_serving_two_requests_is_listed_once_under_its_first() -> None:
    held = HeldFile(F2, "UNREADABLE", "Nothing readable was extracted from the file.")
    checks = {R1: _check(_item(A), held=(held,))}
    annotations = [
        _annotation(1, "SHOWS", A, status="CONFIRMED"), _annotation(2, "SOURCE"),
        _annotation(3, "SHOWS", B, status="EDITED"), _annotation(4, "SHOWS", C, status="REMOVED"),
    ]  # fmt: skip
    evidence, more = evidence_index(REQUESTS, checks, annotations)
    assert more == 0
    assert [(e.ref, e.file_id, e.requirement_id) for e in evidence] == [
        ("E1", F1, R1), ("E2", F2, R1), ("E3", F3, R2),
    ]  # fmt: skip
    ticket, log, screen = evidence
    assert (ticket.kind, ticket.kind_words) == ("walkthrough", "Walkthrough evidence")
    assert (ticket.requirement_title, ticket.annotations, ticket.reviewed) == (
        "Walkthrough instance", 3, 2,
    )  # fmt: skip
    assert (ticket.left_out, ticket.image) == (None, False)
    # The gate's own sentence where the current check left a file out.
    assert log.left_out == "Nothing readable was extracted from the file."
    assert (screen.image, screen.kind_words) == (True, "Configuration or settings")
    # A check that is out of date says nothing of the files either.
    stale = {R1: _check(_item(A), held=(held,), status="OUT_OF_DATE")}
    assert [e.left_out for e in evidence_index(REQUESTS, stale, [])[0]] == [None, None, None]
    # A kind nobody defined reads as "Other".
    odd = [RequestRecord(R1, "Request", (FileRecord(F1, "x.bin", "mystery"),))]
    assert evidence_index(odd, {}, [])[0][0].kind_words == "Other"


def test_the_index_is_bounded_and_says_how_many_more_there_are() -> None:
    files = tuple(
        FileRecord(UUID(int=1000 + number), f"file {number:03d}.txt", "other")
        for number in range(MAX_EVIDENCE + 3)
    )
    requests = [RequestRecord(R1, "Everything", files)]
    evidence, more = evidence_index(requests, {}, [])
    assert (len(evidence), more) == (MAX_EVIDENCE, 3)
    assert (evidence[0].ref, evidence[-1].ref) == ("E1", f"E{MAX_EVIDENCE}")
    matters = matters_of(requests, {}, [], {}, [], evidence, more)
    assert [(m.kind, m.state, m.text) for m in matters][:1] == [
        ("FILE", "NOTED", "3 more files on the evidence list are not listed here.")
    ]


# --- The walkthrough --------------------------------------------------------------------


def _table(columns: list[str], rows: list[list[str]], **over: Any) -> Section:
    return Section(
        key="walkthrough-of-one-instance", title="Walkthrough of one instance", kind="table",
        columns=columns, rows=rows, **over,
    )  # fmt: skip


@pytest.mark.parametrize(
    ("text", "found"),
    [
        ("", ""),
        ("The line manager approved the request.", ""),
        ("Approved on 2027-01-11 09:15 by the line manager", "2027-01-11 09:15"),
        ("Approved on 2027-01-11 by the line manager", "2027-01-11"),
        (
            "Granted 10 January 2027 at 16:20, then confirmed 12 January 2027",
            "10 January 2027 at 16:20",
        ),
        ("Disabled on Jan 5, 2027", "Jan 5, 2027"),
        # As written: a numeric date that could be read either way is not reformatted.
        ("Reviewed 03/04/2027", "03/04/2027"),
        # A date inside a reference is not a date; the next one is.
        ("Change CHG-2027-01-10 was approved on 2027-01-12", "2027-01-12"),
        # A two-digit year and a date that does not exist are not dates.
        ("Signed 11/01/27", ""),
        ("Dated 2027-02-31", ""),
        # The offset or the zone written after the time is kept, as written.
        ("Logged 2027-01-11T09:15:00Z by the system", "2027-01-11T09:15:00Z"),
        ("Granted Jan 10, 2027 4:20 PM CST by the administrator", "Jan 10, 2027 4:20 PM CST"),
        ("Saved 2027-01-10 16:20:05+08:00 in the log", "2027-01-10 16:20:05+08:00"),
        ("Run at 2027-01-10 16:20 UTC+8", "2027-01-10 16:20 UTC+8"),
        # A user id after a time is not a zone, and a time range is not an offset.
        ("2027-01-11 09:15 WD_SECURITY disabled the account", "2027-01-11 09:15"),
        ("Window 2027-01-10 09:00-10:30", "2027-01-10 09:00"),
    ],
)
def test_the_first_date_a_text_states_is_returned_as_written(text: str, found: str) -> None:
    assert first_date(text) == found


def test_a_rows_when_is_its_own_cell_or_the_first_date_its_cells_state() -> None:
    row = ["Access approved", "Priya Shah", "ticket REQ-1041.txt: approved 2027-01-11 09:15",
           "Approved on 2027-01-12"]  # fmt: skip
    # The standard template has no "When" column: the first date the cells state.
    assert row_when(STANDARD, row) == "2027-01-11 09:15"
    assert row_when(STANDARD, ["Access approved", "Priya Shah", "The ticket", "Approved"]) == ""
    # A firm's template with the column: the cell as written, nothing parsed or reformatted.
    for head in ("When", "Date", " when "):
        columns = ["Step", head, "Who", "Evidence inspected", "Result"]
        assert row_when(columns, ["Access approved", "11 Jan, morning", "Priya", *row[2:]]) == (
            "11 Jan, morning"
        )
        # An empty cell stays empty: the other cells' dates are not put in its place.
        assert row_when(columns, ["Access approved", "", "Priya", *row[2:]]) == ""


def test_names_are_found_whole_and_the_longest_first() -> None:
    names = ["log.txt", "sap change log.txt", "ticket REQ-1041.txt", "a"]
    assert named_files("Inspected SAP Change Log.txt, line 3", names) == [1]
    assert named_files("Inspected log.txt and sap change log.txt", names) == [0, 1]
    assert named_files("See catalog.txt", names) == []
    assert named_files("ticket  REQ-1041.txt: \u201cApproved by\u201d", names) == [2]
    # A name too short to tell is never found.
    assert named_files("a b c", names) == []
    # Ordinary punctuation around a name does not hide it.
    assert named_files("See (log.txt). Then ticket req-1041.txt, at last.", names) == [0, 2]


@pytest.mark.parametrize(
    ("text", "names", "found"),
    [
        # The end of a longer name: "report.pdf" is not named by another file's name.
        ("user_access_report.pdf", ["report.pdf"], []),
        ("user_access_report.pdf", ["report.pdf", "user_access_report.pdf"], [1]),
        ("FY27-access-review.xlsx", ["access-review.xlsx"], []),
        ("FY27-access-review.xlsx", ["access-review.xlsx", "FY27-access-review.xlsx"], [1]),
        ("old.ticket.png", ["ticket.png"], []),
        ("wd_ticket.png", ["ticket.png"], []),
        ("evidence/ticket.png and C:\\files\\ticket.png", ["ticket.png"], []),
        # The start of a longer name.
        ("report.pdf.bak", ["report.pdf"], []),
        ("report.pdfx", ["report.pdf"], []),
        # Named whole beside the longer names.
        ("wd_ticket.png, then ticket.png. And report.pdf", ["ticket.png", "report.pdf"], [0, 1]),
    ],
)
def test_a_name_that_is_part_of_a_longer_name_is_not_named(
    text: str, names: list[str], found: list[int]
) -> None:
    assert named_files(text, names) == found


def test_a_name_two_files_carry_names_neither() -> None:
    """Rewritten 14 November 2026 after the independent review. Old expectation: a row
    naming "ticket REQ-1041.txt" referred to both in-force files of that name. New: the
    name tells neither apart, so the row refers to neither (a wrong reference is worse
    than none). The other names in the row are still found."""
    names = ["ticket REQ-1041.txt", "sap change log.txt", "Ticket req-1041.TXT"]
    assert named_files("ticket REQ-1041.txt and sap change log.txt", names) == [1]
    twice = [
        RequestRecord(R1, "One", (TICKET, LOG)),
        RequestRecord(R2, "Two", (FileRecord(F3, "Ticket REQ-1041.txt", "walkthrough"),)),
    ]
    evidence = _index(twice)
    assert row_refs(["Approved", "", "ticket REQ-1041.txt", ""], [], evidence) == []
    assert row_refs(["Granted", "", "sap change log.txt", ""], [], evidence) == ["E2"]
    # A citation tells them apart.
    cited = [{"number": 1, "evidence_file_id": str(F3)}]
    assert row_refs(["Approved [^1]", "", "ticket REQ-1041.txt", ""], cited, evidence) == ["E3"]


def test_a_row_names_evidence_by_a_file_name_or_by_a_citation() -> None:
    evidence = _index()
    citations = [
        {"number": 1, "evidence_file_id": str(F3), "file_name": "role screen.png"},
        {"number": 2, "evidence_file_id": str(UUID(int=999)), "file_name": "gone.txt"},
        {"number": 3, "evidence_file_id": "not an id"},
        {"number": 1234567, "evidence_file_id": str(F2)},
    ]
    by_name = ["Granted", "", "sap change log.txt, line 3: \u201cgranted role\u201d", "Granted"]
    assert row_refs(by_name, citations, evidence) == ["E2"]
    by_mark = ["Role checked [^1]", "", "The role's screen [^2] [^3]", ""]
    assert row_refs(by_mark, citations, evidence) == ["E3"]
    both = ["Approved [^1]", "", "ticket REQ-1041.txt and sap change log.txt", ""]
    assert row_refs(both, citations, evidence) == ["E1", "E2", "E3"]
    assert row_refs(["Approved", "Priya", "The ticket", "Approved"], citations, evidence) == []
    # A mark is a number of at most six digits: a longer run of digits is not one.
    assert row_refs(["Approved [^1234567]", "", "", ""], citations, evidence) == []
    assert view._MARKER.findall("[^1] [^123456] [^1234567] [^]") == ["1", "123456"]


def test_the_walkthrough_is_the_sections_own_rows_with_its_columns() -> None:
    evidence = _index()
    section = _table(
        STANDARD,
        [
            ["Access requested", "Dana Lee", "ticket REQ-1041.txt: requested 2027-01-08", "Raised"],
            ["", "", "", ""],
            ["Access granted", "SAP Security", "sap change log.txt", ""],
        ],
        source="AGENT",
    )
    found = walkthrough_of(section, evidence)
    assert (found.columns, found.source) == (STANDARD, "AGENT")
    assert [step.model_dump() for step in found.steps] == [
        {"number": 1, "when": "2027-01-08", "step": "Access requested", "who": "Dana Lee",
         "evidence": "ticket REQ-1041.txt: requested 2027-01-08", "result": "Raised",
         "refs": ["E1"]},
        {"number": 2, "when": "", "step": "Access granted", "who": "SAP Security",
         "evidence": "sap change log.txt", "result": "", "refs": ["E2"]},
    ]  # fmt: skip
    # A firm's template: its own columns, the "When" cell, the others by name or place.
    firm = _table(
        ["When", "Activity", "Who", "Evidence", "Result"],
        [["8 Jan 2027", "Access requested", "Dana Lee", "role screen.png", "Raised"]],
        source="PERSON",
    )
    [step] = walkthrough_of(firm, evidence).steps
    assert (step.when, step.step, step.who, step.evidence, step.result, step.refs) == (
        "8 Jan 2027", "Access requested", "Dana Lee", "role screen.png", "Raised", ["E3"],
    )  # fmt: skip
    # No workpaper, or no such section: an empty walkthrough.
    assert walkthrough_of(None, evidence).model_dump() == {
        "columns": [], "steps": [], "source": "RECORDS",
    }  # fmt: skip


def test_reports_come_from_the_workpapers_own_section() -> None:
    evidence = _index()
    reports = Section(
        key="information-produced-by-the-entity", title="Information produced by the entity",
        kind="table", columns=["Report", "Source system", "Completeness and accuracy procedure"],
        rows=[["sap change log.txt", "SAP ERP", "Agreed the row count to the system."],
              ["", "", ""], ["User listing", "Workday", ""]],
    )  # fmt: skip
    assert [r.model_dump() for r in reports_of(reports, evidence)] == [
        {"ref": "E2", "report": "sap change log.txt", "source": "SAP ERP",
         "procedure": "Agreed the row count to the system."},
        {"ref": "", "report": "User listing", "source": "Workday", "procedure": ""},
    ]  # fmt: skip
    assert reports_of(None, evidence) == []


def test_a_note_is_the_attributes_by_its_wording() -> None:
    def matrix(*rows: list[str]) -> Section:
        return Section(
            key="design-attributes", title="Design attributes", kind="table",
            columns=["Attribute", "Designed to address the risk", "Notes"], rows=list(rows),
        )  # fmt: skip

    a, b, c = ATTRIBUTES[0], ATTRIBUTES[1], ATTRIBUTES[2]
    drafted = matrix([f"A. {a.text}", "Yes", "Seen in the ticket."], [f"B. {b.text}", "", ""])
    assert attribute_notes(drafted, "A", a.text) == "Seen in the ticket."
    assert attribute_notes(drafted, "B", b.text) == ""
    assert attribute_notes(drafted, "C", c.text) == ""
    assert attribute_notes(None, "A", a.text) == ""
    shown, _readings = attributes_of(ATTRIBUTES, REQUESTS, {}, [], _index(), drafted)
    assert [x.notes for x in shown] == ["Seen in the ticket.", "", "", ""]
    # The attributes were put in another order since the note was written: the note
    # stays with the wording it was written for, never with the letter.
    moved = matrix([f"A. {b.text}", "", "About the approver."], [f"B. {a.text}", "", "Timing."])
    assert attribute_notes(moved, "A", a.text) == "Timing."
    assert attribute_notes(moved, "B", b.text) == "About the approver."
    # The wording was changed since: the note of the old wording is no longer this one's.
    reworded = matrix(["A. Access is approved.", "", "About the old wording."])
    assert attribute_notes(reworded, "A", a.text) == ""
    # The wording alone, and a letter alone (the only case taken by the letter).
    assert (
        attribute_notes(matrix([a.text.upper(), "", "By wording."]), "C", a.text) == "By wording."
    )
    alone = matrix(["A", "", "First."], ["B.", "", "Second."], ["c)", "", "Third."])
    assert [attribute_notes(alone, x.code, x.text) for x in (a, b, c)] == [
        "First.", "Second.", "Third.",
    ]  # fmt: skip
    assert attribute_notes(alone, "D", ATTRIBUTES[3].text) == ""
    # A wording that begins with a short word is not read as a letter.
    it = AttributeRecord(D, "D", "It is reviewed monthly.")
    assert attribute_notes(matrix(["It is reviewed monthly.", "", "Yes."]), "D", it.text) == "Yes."


# --- Procedures and matters -------------------------------------------------------------


def test_a_procedure_is_listed_only_where_the_records_show_it_was_done() -> None:
    # Files in force and nothing checked, no walkthrough: nothing was done.
    assert procedures_of(REQUESTS, {}, ATTRIBUTES, _walk()) == []
    # A walkthrough a person or the agent recorded, and nothing else.
    walked = "Walked one instance of the control through 3 steps, recorded in the walkthrough."
    assert procedures_of(REQUESTS, {}, ATTRIBUTES, _walk(3, "AGENT")) == [walked]
    assert procedures_of(REQUESTS, {}, ATTRIBUTES, _walk(3, "PERSON")) == [walked]
    # A template's starter rows are not a walkthrough.
    assert procedures_of(REQUESTS, {}, ATTRIBUTES, _walk(3, "RECORDS")) == []
    # A current check read two files: inspected, and no comparison or report is claimed.
    plain = {R1: _check(_item(A))}
    assert procedures_of(REQUESTS, plain, ATTRIBUTES, _walk(1)) == [
        "Inspected 2 files received for 1 request: \u201cWalkthrough instance\u201d.",
        "Walked one instance of the control through 1 step, recorded in the walkthrough.",
    ]
    # A comparison that was named and not made is no comparison.
    not_run = {R1: _check(_item(A, checks=(("NOT_RUN", "It could not be compared."),)))}
    assert len(procedures_of(REQUESTS, not_run, ATTRIBUTES, _walk())) == 1

    full = {
        R1: _check(
            _item(A, checks=(("PASSED", "Approved before granted."), ("NOT_RUN", "No."))),
            _item(C, checks=(("FAILED_ONE", "One reading's values differ."),)),
            review=_review(files=[_said(F1), _said(F2, basis="SHOWN")]),
        ),
        R2: _check(
            _item(D), requirement=R2, run=RUN2, files=(F3, F1),
            # A report whose parameters are only partly shown was not "inspected".
            review=_review(files=[_said(F3, basis="PARTLY_SHOWN"), _said(F1, basis="NOT_SHOWN")]),
        ),
    }  # fmt: skip
    assert procedures_of(REQUESTS, full, ATTRIBUTES, _walk()) == [
        "Inspected 3 files received for 2 requests: \u201cWalkthrough instance\u201d and "
        "\u201cRole configuration\u201d.",
        "Compared dates and values in code for attributes A and C: 2 comparisons made.",
        "Inspected the source, run date and parameters shown on 1 report: "
        "\u201csap change log.txt\u201d.",
    ]
    assert len(procedures_of(REQUESTS, full, ATTRIBUTES, _walk(2))) <= view.MAX_PROCEDURES


def test_a_file_read_only_in_part_is_said_so_and_never_counted_as_inspected() -> None:
    part = {R1: _check(_item(A), partial=(F2,))}
    assert procedures_of(REQUESTS, part, ATTRIBUTES, _walk()) == [
        "Inspected 1 file received for 1 request: \u201cWalkthrough instance\u201d.",
        "Read 1 file only in part: \u201csap change log.txt\u201d.",
    ]
    # Every file of the request read in part: nothing is said to be inspected.
    both = {R1: _check(_item(A), partial=(F1, F2))}
    assert procedures_of(REQUESTS, both, ATTRIBUTES, _walk()) == [
        "Read 2 files only in part: \u201cticket REQ-1041.txt\u201d and "
        "\u201csap change log.txt\u201d.",
    ]
    # A check that is not current says neither.
    stale = {R1: _check(_item(A), partial=(F2,), status="OUT_OF_DATE")}
    assert procedures_of(REQUESTS, stale, ATTRIBUTES, _walk()) == []


def test_matters_come_from_each_source_in_the_order_a_reviewer_needs() -> None:
    review = _review(
        "RELIABILITY_UNRESOLVED",
        (
            "sap change log.txt was not part of the check: The file could not be read.",
            "ticket REQ-1041.txt is long and was read only in part.",
            "The source of ticket REQ-1041.txt is not shown, so what it shows needs "
            "corroboration.",
        ),
        follow_ups=[ReviewFollowUpBody(
            key=f"{B}:wording", request="Provide the record that shows who the line manager is.",
            kind="EVIDENCE", priority="HIGH",
        )],
        considerations=[ConsiderationBody(
            text="The screenshot shows the current state, not the state on the day.",
            passages=[PassageBody(quote="Role: FI_AP_CLERK", file_id=F2, location={})],
        )],
    )  # fmt: skip
    checks = {
        R1: _check(
            _item(A, summary="Both readings find this instance shows attribute A."),
            _item(B, verdict="UNSETTLED", assessment="INDETERMINATE", result=None, element=None,
                  summary="The two readings do not agree. Your judgment is needed.", files=()),
            review=review, files=(F1,), partial=(F1,),
            held=(HeldFile(F2, "READ_FAILED", "The file could not be read this time."),),
        ),
        R2: _check(
            requirement=R2, run=RUN2, status="HELD",
            held=(HeldFile(F3, "POPULATION", "This file is a population."),), files=(),
        ),
    }  # fmt: skip
    evidence = _index(checks=checks)
    _shown, readings = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None)
    findings = [FindingRecord(UUID(int=70), "Attribute C not shown: ticket REQ-1041.txt", F1)]
    matters = matters_of(REQUESTS, checks, ATTRIBUTES, readings, findings, evidence)
    assert [(m.kind, m.state, m.refs) for m in matters] == [
        ("FINDING", "OPEN", ["E1"]),
        ("UNSETTLED", "OPEN", []),
        ("FILE", "OPEN", ["E2"]),
        ("COMPLETENESS", "OPEN", ["E1"]),
        ("COMPLETENESS", "OPEN", ["E1"]),
        ("FOLLOW_UP", "OPEN", ["E1"]),
        ("FILE", "NOTED", ["E3"]),
        ("CONSIDERATION", "NOTED", ["E2"]),
        ("NOTE", "NOTED", []),
    ]
    texts = [m.text for m in matters]
    assert texts[0] == "Attribute C not shown: ticket REQ-1041.txt"
    assert texts[1] == (
        "Attribute B is not concluded. The two readings do not agree. Your judgment is needed."
    )
    assert texts[2] == (
        "sap change log.txt is not part of the check. The file could not be read this time."
    )
    # What the check's review says is incomplete or not yet reliable, in its own
    # sentences. The file left out is already said, with the gate's own sentence.
    assert texts[3:5] == list(review.completeness.reasons[1:])
    assert texts[5] == "Provide the record that shows who the line manager is."
    assert texts[6] == "role screen.png is not part of the check. This file is a population."
    assert texts[7] == "The screenshot shows the current state, not the state on the day."
    assert texts[8] == SEPARATE_NOTE


def test_what_a_review_says_is_incomplete_is_said_once() -> None:
    same = "ticket REQ-1041.txt is long and was read only in part."
    checks = {
        R1: _check(_item(A), review=_review("INCOMPLETE", (same, same)), partial=(F1,)),
        R2: _check(
            _item(D), requirement=R2, run=RUN2, files=(F3, F1), partial=(F1,),
            review=_review("INCOMPLETE", (same, "A file is partly unreadable: page 2.")),
        ),
    }  # fmt: skip
    evidence = _index(checks=checks)
    matters = matters_of(REQUESTS, checks, ATTRIBUTES, {}, [], evidence)
    assert [(m.kind, m.state, m.text, m.refs) for m in matters if m.kind == "COMPLETENESS"] == [
        ("COMPLETENESS", "OPEN", same, ["E1"]),
        ("COMPLETENESS", "OPEN", "A file is partly unreadable: page 2.", []),
    ]
    # An engine 1 check has no review, and a complete one has nothing to say.
    quiet = {R1: _check(_item(A), engine=1), R2: _check(_item(D), requirement=R2, run=RUN2)}
    kinds = [m.kind for m in matters_of(REQUESTS, quiet, ATTRIBUTES, {}, [], evidence)]
    assert kinds == ["NOTE"]


IN_PART = "ticket REQ-1041.txt is long and was read only in part."


def test_a_check_that_is_out_of_date_is_said_first() -> None:
    checks = {
        R1: _check(
            _item(B, verdict="UNSETTLED", assessment="INDETERMINATE", result=None, element=None,
                  files=()),
            review=_review("INCOMPLETE", (IN_PART,)),
        ),
        R2: _check(requirement=R2, status="OUT_OF_DATE", out_of_date=("A file was withdrawn.",)),
    }  # fmt: skip
    evidence = _index(checks=checks)
    _shown, readings = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None)
    findings = [FindingRecord(UUID(int=70), "Attribute C not shown", F1)]
    matters = matters_of(REQUESTS, checks, ATTRIBUTES, readings, findings, evidence)
    assert [m.kind for m in matters] == [
        "UNSETTLED", "FINDING", "UNSETTLED", "COMPLETENESS", "NOTE",
    ]  # fmt: skip
    first = matters[0]
    assert (first.state, first.refs) == ("OPEN", ["E1", "E3"])
    assert first.text == (
        "The check of \u201cRole configuration\u201d is out of date, so nothing of it is used "
        "here. A file was withdrawn. Check the request again."
    )
    # Two requests out of date are one matter.
    stale = {
        R1: _check(status="OUT_OF_DATE", out_of_date=("A file was added to this request.",)),
        R2: _check(requirement=R2, status="OUT_OF_DATE", out_of_date=("A file was withdrawn.",)),
    }
    [told, note] = matters_of(REQUESTS, stale, ATTRIBUTES, {}, [], evidence)
    assert (told.kind, told.state, note.kind) == ("UNSETTLED", "OPEN", "NOTE")
    assert told.text == (
        "The checks of 2 requests are out of date, so nothing of them is used here. "
        "Check the requests again."
    )


def test_matters_are_bounded_and_the_last_line_counts_what_is_not_listed() -> None:
    findings = [
        FindingRecord(UUID(int=100 + number), f"Finding {number}", F1) for number in range(30)
    ]
    stale = {R1: _check(status="OUT_OF_DATE", out_of_date=("A file was withdrawn.",))}
    matters = matters_of(REQUESTS, stale, ATTRIBUTES, {}, findings, _index())
    assert len(matters) == MAX_MATTERS
    # The out-of-date notice is first and is never among what is dropped.
    assert [m.kind for m in matters] == ["UNSETTLED"] + ["FINDING"] * 9 + ["NOTE", "NOTE"]
    assert "out of date" in matters[0].text
    count, note = matters[-2], matters[-1]
    assert (count.state, count.text) == (
        "OPEN", "21 more matters are not listed here; 21 of them wait on a person.",
    )  # fmt: skip
    assert (note.state, note.text) == ("NOTED", SEPARATE_NOTE)
    # Exactly as many as fit: nothing is dropped and no line counts.
    fits = matters_of(REQUESTS, {}, ATTRIBUTES, {}, findings[: MAX_MATTERS - 1], _index())
    assert [m.kind for m in fits] == ["FINDING"] * (MAX_MATTERS - 1) + ["NOTE"]
    # One more than fits: the line says so in the singular.
    over = matters_of(REQUESTS, {}, ATTRIBUTES, {}, findings[:MAX_MATTERS], _index())
    assert len(over) == MAX_MATTERS
    assert over[-2].text == "2 more matters are not listed here; 2 of them wait on a person."
    one = view._not_listed([view.MatterBody(state="NOTED", kind="CONSIDERATION", text="x")])
    assert (one.state, one.text) == ("NOTED", "1 more matter is not listed here.")
    waits = view._not_listed([view.MatterBody(state="OPEN", kind="FINDING", text="x")])
    assert (waits.state, waits.text) == (
        "OPEN", "1 more matter is not listed here; it waits on a person.",
    )  # fmt: skip
    # With nothing on record there is still the one note.
    assert [m.kind for m in matters_of([], {}, [], {}, [], [])] == ["NOTE"]


# --- The conclusion and who may edit ----------------------------------------------------


def _conclusion(status: str, proposed: str | None, signed: str | None) -> DesignConclusionBody:
    record = (
        None
        if signed is None
        else SignoffRecord(
            id=UUID(int=90), verdict=signed, workpaper_version=1, deficiencies=[],  # type: ignore[arg-type]
            signed_by="Rhea Reviewer", signed_at=datetime(2027, 2, 1, tzinfo=UTC),
            signoff_note="", reopened_at=None, reopened_by=None, reopen_reason="",
            reopened_from=None,
        )
    )  # fmt: skip
    return DesignConclusionBody(
        control_id=UUID(int=91), status=status, proposed=proposed, workpaper=None,  # type: ignore[arg-type]
        deficiencies=[], signed=record, out_of_date=[], blocking=[], viewer_is_reviewer=False,
        viewer_prepared=False, independence_required=True, can_sign=False, history=[],
    )  # fmt: skip


def test_a_conclusion_is_signed_only_from_its_sign_off_record() -> None:
    section = Section(
        key="design-conclusion", title="Design conclusion", kind="text", narrative=True,
        text="The evidence supports an effective design. [^1]", source="AGENT",
    )  # fmt: skip
    # A proposed verdict is never presented as signed.
    proposed = conclusion_of(section, _conclusion("TO_SIGN", "EFFECTIVE", None))
    assert proposed.model_dump() == {
        "text": "The evidence supports an effective design. [^1]", "source": "AGENT",
        "proposed": "EFFECTIVE", "words": "Effective", "signed": False,
    }  # fmt: skip
    signed = conclusion_of(section, _conclusion("SIGNED_OFF", "EFFECTIVE", "EFFECTIVE"))
    assert (signed.signed, signed.words) == (True, "Effective")
    # A sign-off that no longer holds is not a signed conclusion: the words are the
    # records' proposal now.
    stale = conclusion_of(section, _conclusion("OUT_OF_DATE", "NOT_EFFECTIVE", "EFFECTIVE"))
    assert (stale.signed, stale.proposed, stale.words) == (False, "NOT_EFFECTIVE", "Not effective")
    # A status that says signed with no record behind it is not signed.
    assert conclusion_of(section, _conclusion("SIGNED_OFF", "EFFECTIVE", None)).signed is False
    # No workpaper yet, nothing proposed.
    none = conclusion_of(None, _conclusion("NOT_READY", None, None))
    assert none.model_dump() == {
        "text": "", "source": "RECORDS", "proposed": None, "words": "Not concluded yet",
        "signed": False,
    }  # fmt: skip


def test_sections_are_editable_by_the_section_editors_own_rule() -> None:
    yes = {"may_update": True, "engagement_open": True, "status": "DRAFT", "drafting": False,
           "current_version": 2}  # fmt: skip
    assert can_edit_sections(**yes) is True  # type: ignore[arg-type]
    for change in (
        {"may_update": False}, {"engagement_open": False}, {"status": "PREPARED"},
        {"status": None}, {"drafting": True}, {"current_version": 0},
    ):  # fmt: skip
        assert can_edit_sections(**{**yes, **change}) is False  # type: ignore[arg-type]


def test_the_words_written_here_never_say_the_client() -> None:
    written = [
        *STATE_WORDS.values(), *STATE_BASIS.values(), ONLY_OUT_OF_DATE, SEPARATE_NOTE,
        *(t.meaning for t in TICKMARKS), *view.VERDICT_WORDS.values(), view.NOT_CONCLUDED_WORDS,
    ]  # fmt: skip
    assert all("client" not in text.lower() for text in written)
    # A stored record that cannot be read as an attribute's outcome is refused, not guessed.
    with pytest.raises(ValueError):
        StoredOutcome.model_validate({"attribute_id": str(A), "verdict": "PASSED"})


# --- A person's dispositions (docs/evidence-assurance.md, section 10.13) -----------------

RECORDED_AT = datetime(2026, 11, 14, 9, 30, tzinfo=UTC)
REASON = "The ticket system was retired in 2026"
NOT_SHOWN_B = "Both readings find the evidence does not show attribute B."
OPEN_C = "The two readings do not agree. Your judgment is needed."


def _disposed(
    kind: str,
    attribute: UUID,
    requirement: UUID = R1,
    *,
    annotation: UUID | None = None,
    **over: Any,
) -> Disposition:
    """A disposition a person recorded, standing unless said otherwise."""
    values: dict[str, Any] = {
        "id": UUID(int=900 + attribute.int + requirement.int * 10),
        "requirement_id": requirement,
        "attribute_id": attribute,
        "kind": kind,
        "reason": REASON,
        "relied_on": "",
        "annotation_id": annotation,
        "assessment_id": RUN1,
        "recorded_by_name": "Dana Lee",
        "recorded_at": RECORDED_AT,
        "version": 1,
    }
    return Disposition(**(values | over))


def _gap(attribute: UUID = B) -> StoredOutcome:
    """An attribute a check finds not demonstrated."""
    return _item(
        attribute, verdict="ISSUE", assessment="NOT_DEMONSTRATED", result="NOT_MET",
        element="NOT_MET", files=(), summary=NOT_SHOWN_B,
    )  # fmt: skip


def _open(attribute: UUID = C) -> StoredOutcome:
    """An attribute a check leaves to a person."""
    return _item(
        attribute, verdict="UNSETTLED", assessment="INDETERMINATE", result=None, element=None,
        files=(), summary=OPEN_C,
    )  # fmt: skip


def _read(
    code: str,
    checks: dict[UUID, CheckRecord],
    dispositions: list[Disposition],
    annotations: list[AnnotationRecord] | None = None,
) -> view.AttributeBody:
    shown, _left = attributes_of(
        ATTRIBUTES, REQUESTS, checks, annotations or [], _index(checks=checks), None, dispositions
    )
    return next(attribute for attribute in shown if attribute.code == code)


def test_an_attribute_reads_by_a_persons_disposition_where_the_checks_do_not_show_it() -> None:
    checks = {R1: _check(_item(A), _gap())}
    assert _read("B", checks, []).state == "NOT_SHOWN"
    accepted = _read("B", checks, [_disposed("NOT_AVAILABLE", B, relied_on="The HR leaver report")])
    assert (accepted.state, accepted.state_words, accepted.tickmark) == (
        "NOT_AVAILABLE", "Evidence not available, accepted", "NONE",
    )  # fmt: skip
    # Who, when and the person's own reason; and, beside it, what the check found.
    assert accepted.basis == (
        f"Recorded by Dana Lee on 14 November 2026: {REASON}. Relied on instead: The HR "
        f"leaver report. The check found: {NOT_SHOWN_B}"
    )
    assert (accepted.marks, accepted.refs) == ({}, [])
    aside = _read("B", checks, [_disposed("NOT_APPLICABLE", B)])
    assert (aside.state, aside.state_words, aside.tickmark) == (
        "NOT_APPLICABLE", "Not applicable to this instance", "NONE",
    )  # fmt: skip
    assert aside.basis == (
        f"Recorded by Dana Lee on 14 November 2026: {REASON}. The check found: {NOT_SHOWN_B}"
    )
    # An exception a person records closes nothing: the attribute reads as the check
    # left it.
    excepted = _read("B", checks, [_disposed("EXCEPTION", B)])
    assert (excepted.state, excepted.basis, excepted.tickmark) == (
        "NOT_SHOWN", NOT_SHOWN_B, "NONE",
    )  # fmt: skip
    # Another attribute of the same check is as it was.
    assert _read("A", checks, [_disposed("NOT_AVAILABLE", B)]) == _read("A", checks, [])
    # A disposition on a request whose check has no word on the attribute is read too.
    unasked = _read("D", checks, [_disposed("NOT_APPLICABLE", D)])
    assert (unasked.state, unasked.tickmark) == ("NOT_APPLICABLE", "NONE")
    assert unasked.basis == f"Recorded by Dana Lee on 14 November 2026: {REASON}."
    # The states and their words are the contract's; none is the plain "Shown".
    assert view.DISPOSITION_WORDS == {
        "SHOWN_ON_REVIEW": "Shown, auditor's judgment",
        "NOT_APPLICABLE": "Not applicable to this instance",
        "NOT_AVAILABLE": "Evidence not available, accepted",
    }
    assert "Shown" not in view.DISPOSITION_WORDS.values()
    assert set(view.DISPOSITION_WORDS) == set(view._DISPOSITION_PRECEDENCE)
    assert not set(view.DISPOSITION_WORDS) & set(STATE_WORDS)


def test_shown_on_review_carries_the_reviewed_mark_from_the_persons_annotation() -> None:
    checks = {R1: _check(_item(A), _gap())}
    mine = _annotation(3, "SHOWS", B, file=F2, status="CONFIRMED", origin="PERSON", run=None)
    annotations = [_annotation(1, "IDENTIFIES", B, file=F2), mine]
    on_review = _disposed("SHOWN_ON_REVIEW", B, annotation=mine.id)
    found = _read("B", checks, [on_review], annotations)
    assert (found.state, found.state_words) == ("SHOWN_ON_REVIEW", "Shown, auditor's judgment")
    # Never agreed or compared: the person's reading is not the system's own record.
    assert found.tickmark == "REVIEWED"
    # The file is marked by the person's review, never as shown by a check, and is
    # referenced with the annotations on it that stand and name the attribute.
    assert found.marks == {"E2": "REVIEWED"}
    [ref] = found.refs
    assert (ref.ref, ref.numbers) == ("E2", [1, 3]) and mine.id in ref.annotation_ids
    # A passage of a current check on the same file outranks it; what only identifies
    # does not.
    rank = view._MARK_RANK
    assert rank["SHOWS"] < rank["REVIEWED"] < rank["IDENTIFIES"] < rank["SOURCE"]
    # The legend names the mark only where an attribute carries it, before the exception's.
    assert [t.mark for t in legend(False, True)] == ["AGREED", "COMPARED", "REVIEWED", "EXCEPTION"]
    assert [t.mark for t in legend(True, True)] == [
        "AGREED", "COMPARED", "INSPECTED", "REVIEWED", "EXCEPTION",
    ]  # fmt: skip
    assert legend(False) == legend(False, False) and legend(True) == list(TICKMARKS)
    assert view.REVIEWED_TICKMARK.meaning == "On the auditor's review, with the reason recorded."
    assert view.REVIEWED_TICKMARK.symbol not in {t.symbol for t in TICKMARKS}

    # It stands only while its annotation does: no longer listed (removed), still the
    # agent's unreviewed proposal, or no longer naming the attribute, it is not read.
    for listed in (
        [],
        [_annotation(3, "SHOWS", B, file=F2)],
        [_annotation(3, "SHOWS", A, file=F2, status="CONFIRMED", origin="PERSON", run=None)],
    ):
        back = _read("B", checks, [on_review], listed)
        assert (back.state, back.tickmark, back.marks, back.refs) == ("NOT_SHOWN", "NONE", {}, [])
    # On a file that is no longer in force on any request, the annotation does not stand.
    elsewhere = _annotation(
        3, "SHOWS", B, file=UUID(int=39), status="CONFIRMED", origin="PERSON", run=None
    )
    lost = _read(
        "B", checks, [_disposed("SHOWN_ON_REVIEW", B, annotation=elsewhere.id)], [elsewhere]
    )
    assert (lost.state, lost.tickmark) == ("NOT_SHOWN", "NONE")


def _on_first_request(item: StoredOutcome) -> StoredOutcome:
    """The same finding with its passages on a file of the first request."""
    passages = [view.StoredPassage(file_id=F1)]
    return item.model_copy(
        update={
            "passages": passages,
            "elements": [e.model_copy(update={"passages": passages}) for e in item.elements],
        }
    )


def test_an_exception_a_check_shows_wins_over_every_disposition() -> None:
    exception = _item(
        C, verdict="ISSUE", assessment="CONTRADICTED", result="NOT_MET", files=(F3,),
        element="NOT_MET", deviation=True, summary="The records show attribute C is not met.",
    )  # fmt: skip
    mine = _annotation(3, "SHOWS", C, file=F2, status="EDITED", run=None, origin="PERSON")
    for kind in ("SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE", "EXCEPTION"):
        disposed = _disposed(kind, C, annotation=mine.id if kind == "SHOWN_ON_REVIEW" else None)
        # On another request of the control.
        apart = {
            R1: _check(_open()),
            R2: _check(exception, requirement=R2, run=RUN2, files=(F3, F1)),
        }
        found = _read("C", apart, [disposed], [mine])
        assert (found.state, found.state_words, found.tickmark) == (
            "EXCEPTION", "Exception shown", "EXCEPTION",
        )  # fmt: skip
        assert found.basis == "The records show attribute C is not met."
        assert found.marks["E3"] == "EXCEPTION"
        # On the very request the disposition is on (never recorded there, and a later
        # check overtakes it: held here as well).
        same = {R1: _check(_on_first_request(exception))}
        again = _read("C", same, [disposed], [mine])
        assert (again.state, again.tickmark) == ("EXCEPTION", "EXCEPTION")


def test_a_disposition_never_stands_against_what_the_checks_show_or_leave_open() -> None:
    shows = "Both readings find this instance shows attribute C."
    # The check of its own request shows the attribute: it stays "Shown", by the check.
    own = {R1: _check(_item(C, summary=shows))}
    kept = _read("C", own, [_disposed("NOT_APPLICABLE", C)])
    assert (kept.state, kept.state_words, kept.basis, kept.tickmark) == (
        "SHOWN", "Shown", shows, "AGREED",
    )  # fmt: skip
    # Another request shows it: "Shown" by that check, and never agreed or compared while
    # the check the disposition stands in for left it open.
    other = {
        R1: _check(_open()),
        R2: _check(_item(C, summary=shows, files=(F3,)), requirement=R2, run=RUN2, files=(F3, F1)),
    }
    assert _read("C", other, []).state == "NOT_CONCLUDED"
    by_check = _read("C", other, [_disposed("NOT_AVAILABLE", C)])
    assert (by_check.state, by_check.basis, by_check.tickmark) == ("SHOWN", shows, "NONE")
    # Another request's check leaves it open, and nobody disposed of that: it still waits.
    both_open = {
        R1: _check(_open()),
        R2: _check(_open(), requirement=R2, run=RUN2, files=(F3, F1)),
    }
    waits = _read("C", both_open, [_disposed("NOT_APPLICABLE", C)])
    assert (waits.state, waits.state_words, waits.basis) == (
        "NOT_CONCLUDED", "Not concluded", OPEN_C,
    )  # fmt: skip
    # Disposed of on both: it reads by the more cautious of the two.
    mine = _annotation(
        3, "SHOWS", C, file=F3, requirement=R2, status="CONFIRMED", origin="PERSON", run=None
    )
    on_review = _disposed("SHOWN_ON_REVIEW", C, R2, annotation=mine.id)
    settled = _read("C", both_open, [on_review, _disposed("NOT_AVAILABLE", C)], [mine])
    assert (settled.state, settled.tickmark) == ("NOT_AVAILABLE", "NONE")
    assert settled.marks == {"E3": "REVIEWED"}
    milder = _read("C", both_open, [on_review, _disposed("NOT_APPLICABLE", C)], [mine])
    assert (milder.state, milder.tickmark) == ("NOT_APPLICABLE", "NONE")
    # A gap another request's check finds does not outrank a person's disposition: as an
    # attribute one request shows stays "Shown" beside another that does not.
    gap = {
        R1: _check(_open()),
        R2: _check(_gap(C), requirement=R2, run=RUN2, files=(F3, F1)),
    }
    assert _read("C", gap, [_disposed("NOT_APPLICABLE", C)]).state == "NOT_APPLICABLE"
    # An exception a person recorded takes "agreed" away, whatever a check shows.
    assert _read("C", own, [_disposed("EXCEPTION", C)]).tickmark == "NONE"
    assert _read("C", own, []).tickmark == "AGREED"


@pytest.mark.parametrize("status", ["OUT_OF_DATE", "FAILED", "QUEUED", "CHECKING", "HELD"])
def test_a_disposition_on_a_check_that_is_not_current_is_not_read(status: str) -> None:
    checks = {R1: _check(_gap(), status=status)}
    disposed = [_disposed("NOT_AVAILABLE", B), _disposed("EXCEPTION", A)]
    found = _read("B", checks, disposed)
    assert (found.state, found.tickmark) == ("NOT_TESTED", "NONE")
    assert view.dispositions_applying(disposed, checks, []) == {}
    assert view.dispositions_applying(disposed, {}, []) == {}
    # One that has ended is never read, whatever is passed.
    ended = _disposed("NOT_AVAILABLE", B, ended_at=RECORDED_AT, ended_as="REOPENED")
    assert view.dispositions_applying([ended], {R1: _check(_gap())}, []) == {}


def test_each_disposition_is_a_matter_and_an_exception_recorded_is_open() -> None:
    checks = {R1: _check(_item(A), _gap(), _open())}
    evidence = _index(checks=checks)
    mine = _annotation(3, "SHOWS", C, file=F2, status="CONFIRMED", origin="PERSON", run=None)
    disposed = [
        _disposed("EXCEPTION", A, reason="The approval is dated after the grant."),
        _disposed("NOT_AVAILABLE", B, relied_on="The HR leaver report"),
        _disposed("SHOWN_ON_REVIEW", C, annotation=mine.id, recorded_by_name=""),
    ]
    shown, left = attributes_of(ATTRIBUTES, REQUESTS, checks, [mine], evidence, None, disposed)
    stand = annotations_standing([mine], REQUESTS, checks)
    recorded = view.disposition_matters(
        ATTRIBUTES, view.dispositions_applying(disposed, checks, stand), stand, evidence
    )
    assert [(m.kind, m.state, m.refs) for m in recorded] == [
        ("DISPOSITION", "OPEN", []), ("DISPOSITION", "NOTED", []), ("DISPOSITION", "NOTED", ["E2"]),
    ]  # fmt: skip
    assert [m.text for m in recorded] == [
        "Attribute A: an exception recorded by Dana Lee on 14 November 2026, still to be "
        "evaluated. Reason: The approval is dated after the grant.",
        "Attribute B: “Evidence not available, accepted”, recorded by Dana Lee on "
        f"14 November 2026. Reason: {REASON}. Relied on instead: The HR leaver report.",
        "Attribute C: “Shown, auditor's judgment”, recorded by a person on "
        f"14 November 2026. Reason: {REASON}.",
    ]
    findings = [FindingRecord(UUID(int=70), "Attribute B not shown: ticket REQ-1041.txt", F1)]
    matters = matters_of(REQUESTS, checks, ATTRIBUTES, left, findings, evidence, 0, recorded)
    # The exception a person recorded waits, straight after the findings. What a person
    # disposed of no longer waits as "not concluded": it is noted, with the person.
    assert [(m.kind, m.state) for m in matters] == [
        ("FINDING", "OPEN"), ("DISPOSITION", "OPEN"), ("DISPOSITION", "NOTED"),
        ("DISPOSITION", "NOTED"), ("NOTE", "NOTED"),
    ]  # fmt: skip
    assert matters[-1].text == SEPARATE_NOTE
    # Without the dispositions the check's own open attribute is the matter, as before.
    _plain, readings = attributes_of(ATTRIBUTES, REQUESTS, checks, [mine], evidence, None)
    before = matters_of(REQUESTS, checks, ATTRIBUTES, readings, findings, evidence)
    assert [(m.kind, m.state) for m in before] == [
        ("FINDING", "OPEN"), ("UNSETTLED", "OPEN"), ("NOTE", "NOTED"),
    ]  # fmt: skip
    assert before[1].text == f"Attribute C is not concluded. {OPEN_C}"
    # The attribute a person marked as an exception, which the check shows, is never
    # "Shown": it reads as an exception recorded, with no mark of agreement beside it.
    # Rewritten for review fix 4. Old expectation: ("SHOWN", "NONE"), so the workpaper's
    # tile counted it as shown ("Every attribute is shown") beside the open exception. New:
    # ("EXCEPTION_RECORDED", "NONE"). Why: a person's exception says the control did not
    # work, and an exception found is evaluated, never set aside because a check shows
    # the attribute: it cannot be counted as shown while it is open.
    by_code = {attribute.code: attribute for attribute in shown}
    assert (by_code["A"].state, by_code["A"].tickmark) == ("EXCEPTION_RECORDED", "NONE")
    assert (by_code["B"].state, by_code["C"].state) == ("NOT_AVAILABLE", "SHOWN_ON_REVIEW")
    # Where a check of another request still leaves it open, that still waits.
    two = {**checks, R2: _check(_open(), requirement=R2, run=RUN2, files=(F3, F1))}
    _two, left_two = attributes_of(ATTRIBUTES, REQUESTS, two, [mine], evidence, None, disposed)
    still = matters_of(REQUESTS, two, ATTRIBUTES, left_two, [], evidence, 0, recorded)
    assert [(m.kind, m.state) for m in still][:2] == [
        ("DISPOSITION", "OPEN"), ("UNSETTLED", "OPEN"),
    ]  # fmt: skip
    assert still[1].text == f"Attribute C is not concluded. {OPEN_C}"


def test_an_exception_a_person_recorded_is_never_counted_as_shown() -> None:
    """Review fix 4: with a person's EXCEPTION on an attribute a check shows, the state
    was "SHOWN", and the attributes tile said "Every attribute is shown" beside the open
    exception. It now reads EXCEPTION_RECORDED, above shown and above what a person's
    other dispositions close; an exception a check shows still stands above it."""
    shows = "Both readings find this instance shows attribute C."
    reason = "The approval is dated after the grant."
    excepted = _disposed("EXCEPTION", C, reason=reason)
    own = {R1: _check(_item(C, summary=shows))}
    assert (_read("C", own, []).state, _read("C", own, []).tickmark) == ("SHOWN", "AGREED")
    found = _read("C", own, [excepted])
    assert (found.state, found.state_words, found.tickmark) == (
        "EXCEPTION_RECORDED", "Exception recorded by the auditor", "NONE",
    )  # fmt: skip
    assert view.EXCEPTION_RECORDED_WORDS == "Exception recorded by the auditor"
    # Who, when and the person's reason; and, beside it, what the check found.
    assert found.basis == (
        f"Recorded by Dana Lee on 14 November 2026: {reason} The check found: {shows}"
    )
    # The files are marked by the check's own passages, as before: nothing is hidden.
    assert found.marks == _read("C", own, []).marks and found.refs == _read("C", own, []).refs
    # Shown by another request's check, beside a person's closing disposition: the same.
    other = {
        R1: _check(_gap(C)),
        R2: _check(_item(C, summary=shows, files=(F3,)), requirement=R2, run=RUN2, files=(F3, F1)),
    }
    on_r2 = _disposed("EXCEPTION", C, R2, reason=reason)
    assert _read("C", other, [_disposed("NOT_AVAILABLE", C)]).state == "SHOWN"
    apart = _read("C", other, [on_r2, _disposed("NOT_AVAILABLE", C)])
    assert (apart.state, apart.tickmark) == ("EXCEPTION_RECORDED", "NONE")
    # Above a person's own closing disposition on another request.
    gap = {
        R1: _check(_gap(C)),
        R2: _check(_gap(C), requirement=R2, run=RUN2, files=(F3, F1)),
    }
    mine = _annotation(
        3, "SHOWS", C, file=F3, requirement=R2, status="CONFIRMED", origin="PERSON", run=None
    )
    for kind in ("SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE"):
        closing = _disposed(kind, C, R2, annotation=mine.id if kind == "SHOWN_ON_REVIEW" else None)
        assert _read("C", gap, [closing], [mine]).state == kind
        above = _read("C", gap, [excepted, closing], [mine])
        assert (above.state, above.tickmark) == ("EXCEPTION_RECORDED", "NONE"), kind
    # An exception a check shows still stands above it.
    exception = _item(
        C, verdict="ISSUE", assessment="CONTRADICTED", result="NOT_MET", files=(F3,),
        element="NOT_MET", deviation=True, summary="The records show attribute C is not met.",
    )  # fmt: skip
    shown_by_check = {
        R1: _check(_item(C, summary=shows)),
        R2: _check(exception, requirement=R2, run=RUN2, files=(F3, F1)),
    }
    held = _read("C", shown_by_check, [excepted])
    assert (held.state, held.state_words, held.tickmark) == (
        "EXCEPTION", "Exception shown", "EXCEPTION",
    )  # fmt: skip
    # Elsewhere it still reads as the checks leave it (the rule of section 10.13): not
    # shown, not concluded, as before.
    assert _read("C", {R1: _check(_gap(C))}, [excepted]).state == "NOT_SHOWN"
    assert _read("C", {R1: _check(_open())}, [excepted]).state == "NOT_CONCLUDED"
    # It stays an open matter for the reviewer.
    checks = {R1: _check(_item(A), _gap(), _item(C, summary=shows))}
    evidence = _index(checks=checks)
    [matter] = view.disposition_matters(
        ATTRIBUTES, view.dispositions_applying([excepted], checks, []), [], evidence
    )
    assert (matter.kind, matter.state) == ("DISPOSITION", "OPEN")
    # Never inside the precedence of the checks' own states, nor among the dispositions
    # that close an attribute.
    assert "EXCEPTION_RECORDED" not in STATE_WORDS
    assert "EXCEPTION_RECORDED" not in view.DISPOSITION_WORDS
    assert "client" not in view.EXCEPTION_RECORDED_WORDS.lower()


def test_the_words_written_for_a_disposition_never_say_the_client() -> None:
    written = [
        *view.DISPOSITION_WORDS.values(), view.REVIEWED_TICKMARK.meaning,
        view.disposition_basis(_disposed("NOT_AVAILABLE", B, relied_on="A report"), NOT_SHOWN_B),
    ]  # fmt: skip
    assert all("client" not in text.lower() for text in written)
    # A long reason is kept whole, and the sentence stays bounded.
    long = view.disposition_basis(
        _disposed("NOT_AVAILABLE", B, reason="r" * 1000, relied_on="o" * 600), "c" * 600
    )
    assert "r" * 1000 in long and "o" * 600 in long and len(long) <= view.DISPOSITION_LIMIT
