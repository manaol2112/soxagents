"""A person's decision on a file's reliability (docs/evidence-assurance.md, section 10.14,
part B): the pure part, with synthetic values only. No database, no model, no file.

Audit integrity:

- a reason is always given, as one bounded line; what was relied on is required with
  "Reliability established on my review" and never kept with "Not relied on";
- a file has a reliability question exactly where the check's review rule says its
  reliability is not established (assurance_review._reliability), or the review does not
  describe a file the check read; the question's words are the check's own;
- a decision is given as standing only on a file in force, and the history is kept;
- each refusal is one plain sentence; nothing says "the client";
- in the workpaper: a file established on review counts as reliable for the tickmark rule,
  its report row carries the inspected mark with who, when and what was relied on, and a
  procedure says so; a file not relied on is said so in the evidence index, an attribute
  shown only on files not relied on never carries an agreed or compared mark and is a
  point (section 3.9; it was an open matter), and is never counted as more shown; each
  decision is said at its place (the report row, the file's line; it was a noted matter);
  a decision on a check that is not current, or on a file not in force, is never read.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from pydantic import ValidationError
from test_design_workpaper_model import (
    ATTRIBUTES,
    F1,
    F2,
    F3,
    R1,
    R2,
    REQUESTS,
    RUN1,
    A,
    B,
    _check,
    _index,
    _item,
    _review,
    _said,
    _walk,
)

from ai_workforce_api import design_workpaper as view
from ai_workforce_api import file_reliability as reliability
from ai_workforce_api.design_points import points_of
from ai_workforce_api.design_workpaper import (
    attributes_of,
    decisions_applying,
    evidence_index,
    legend,
    procedures_of,
    readings_of,
    reliability_open,
    reports_of,
)
from ai_workforce_api.file_reliability import (
    KIND_WORDS,
    KINDS,
    REASON_MAX,
    RELIED_ON_MAX,
    Decision,
    Decisions,
    RecordBody,
    ReliabilityState,
    ReopenBody,
    clean_reason,
    clean_relied_on,
    not_current,
    question_sentences,
    questions,
    stale_refusal,
)
from ai_workforce_api.workpaper_fill import Section

RECORDED_AT = datetime(2026, 11, 14, 9, 30, tzinfo=UTC)
REASON = "The owner ran the report with me and I inspected its parameters."
RELIED = "Watched the report run in Workday on 3 March 2026, parameters all users."
NAMES = {F1: "ticket REQ-1041.txt", F2: "sap change log.txt", F3: "role screen.png"}
NOT_SHOWN_F2 = (
    "sap change log.txt is a report or listing that does not show its source, run date or "
    "parameters, so its completeness and accuracy are not established."
)


def _refused(call: Any, *args: Any) -> str:
    with pytest.raises(ReliabilityState) as refusal:
        call(*args)
    return refusal.value.detail


def _decided(
    kind: str = "ESTABLISHED_ON_REVIEW",
    file: UUID = F1,
    requirement: UUID = R1,
    **over: Any,
) -> Decision:
    values: dict[str, Any] = {
        "id": UUID(int=800 + file.int + requirement.int * 10),
        "requirement_id": requirement,
        "file_id": file,
        "kind": kind,
        "reason": REASON,
        "relied_on": RELIED if kind == "ESTABLISHED_ON_REVIEW" else "",
        "assessment_id": RUN1,
        "recorded_by_name": "Dana Lee",
        "recorded_at": RECORDED_AT,
        "version": 1,
    }
    return Decision(**(values | over))


# --- The bodies and the texts -------------------------------------------------------------


def test_the_kinds_and_their_words_are_the_contracts() -> None:
    assert KINDS == ("ESTABLISHED_ON_REVIEW", "NOT_RELIED_ON")
    assert KIND_WORDS == {
        "ESTABLISHED_ON_REVIEW": "Reliability established on my review",
        "NOT_RELIED_ON": "Not relied on",
    }


def test_a_reason_is_one_bounded_line_and_always_given() -> None:
    for short in ("", "   ", "too short", "x" * 9, " \n x x x \n "):
        assert _refused(clean_reason, short) == reliability.REASON_TOO_SHORT
    assert _refused(clean_reason, "x" * (REASON_MAX + 1)) == reliability.REASON_TOO_LONG
    assert clean_reason("  The owner\n confirmed it.  ") == "The owner confirmed it."
    assert clean_reason("x" * REASON_MAX) == "x" * REASON_MAX


def test_what_was_relied_on_is_required_to_establish_and_never_kept_otherwise() -> None:
    kind = "ESTABLISHED_ON_REVIEW"
    for short in (None, "", "   ", "x" * 9):
        assert _refused(clean_relied_on, kind, short) == reliability.RELIED_ON_NEEDED
    assert _refused(clean_relied_on, kind, "x" * (RELIED_ON_MAX + 1)) == (
        reliability.RELIED_ON_TOO_LONG
    )
    assert clean_relied_on(kind, "x" * 10) == "x" * 10
    assert clean_relied_on(kind, "x" * RELIED_ON_MAX) == "x" * RELIED_ON_MAX
    assert clean_relied_on(kind, "  Watched it\n run.  Twice. ") == "Watched it run. Twice."
    assert clean_relied_on("NOT_RELIED_ON", None) == ""
    assert clean_relied_on("NOT_RELIED_ON", "  ") == ""
    assert _refused(clean_relied_on, "NOT_RELIED_ON", "The owner's word.") == (
        reliability.RELIED_ON_NOT_TAKEN
    )


def test_the_bodies_are_strict() -> None:
    body = RecordBody.model_validate(
        {"kind": "NOT_RELIED_ON", "reason": "Not needed here.", "replaces": None}
    )
    assert (body.relied_on, body.replaces) == (None, None)
    seen = RecordBody.model_validate(
        {"kind": "ESTABLISHED_ON_REVIEW", "reason": "x" * 12, "relied_on": "y" * 12,
         "replaces": str(UUID(int=900))}
    )  # fmt: skip
    assert seen.replaces == UUID(int=900)
    for refused in (
        # `replaces` is always sent: the id the person saw, or null.
        {"kind": "NOT_RELIED_ON", "reason": "Not needed here."},
        {"kind": "TRUSTED", "reason": "Not needed here.", "replaces": None},
        {"kind": "NOT_RELIED_ON", "replaces": None},
        {"kind": "NOT_RELIED_ON", "reason": "Not needed here.", "replaces": "no"},
        {"kind": "NOT_RELIED_ON", "reason": "x" * 4001, "replaces": None},
        {"kind": "NOT_RELIED_ON", "reason": "Not needed here.", "replaces": None, "file_id": "x"},
        {"kind": "NOT_RELIED_ON", "reason": "Not needed here.", "replaces": None, "version": 1},
    ):
        with pytest.raises(ValidationError):
            RecordBody.model_validate(refused)
    reopening = ReopenBody.model_validate({"id": str(UUID(int=900)), "reason": "In error here."})
    assert reopening.id == UUID(int=900)
    for unread in (
        {"reason": "Recorded in error."},
        {"id": "not-an-id", "reason": "Recorded in error."},
        {"id": str(UUID(int=900))},
        {"id": str(UUID(int=900)), "reason": "Recorded in error.", "version": 1},
        {"id": str(UUID(int=900)), "reason": "Recorded in error.", "kind": "NOT_RELIED_ON"},
    ):
        with pytest.raises(ValidationError):
            ReopenBody.model_validate(unread)


def test_only_a_finished_current_check_takes_a_decision() -> None:
    assert not_current("REVIEWED") is None
    assert {status: not_current(status) for status in (
        "NOT_CHECKED", "QUEUED", "CHECKING", "HELD", "FAILED", "OUT_OF_DATE", "ANYTHING",
    )} == {
        "NOT_CHECKED": reliability.NOT_CHECKED,
        "QUEUED": reliability.STILL_CHECKING,
        "CHECKING": reliability.STILL_CHECKING,
        "HELD": reliability.CHECK_HELD,
        "FAILED": reliability.CHECK_FAILED,
        "OUT_OF_DATE": reliability.CHECK_OUT_OF_DATE,
        "ANYTHING": reliability.CHECK_FAILED,
    }  # fmt: skip


def test_an_act_is_refused_where_what_stands_is_not_what_the_person_saw() -> None:
    seen, other = UUID(int=900), UUID(int=901)
    assert stale_refusal(None, None) is None and stale_refusal(seen, seen) is None
    assert stale_refusal(other, seen) == reliability.RECORDED_SINCE
    assert stale_refusal(other, None) == reliability.RECORDED_SINCE
    assert stale_refusal(None, seen) == reliability.STALE


def test_each_refusal_is_one_plain_sentence_that_never_says_the_client() -> None:
    sentences = [
        reliability.NOT_CHECKED, reliability.STILL_CHECKING, reliability.CHECK_HELD,
        reliability.CHECK_FAILED, reliability.CHECK_OUT_OF_DATE, reliability.FILE_NOT_IN_FORCE,
        reliability.NO_QUESTION, reliability.REASON_TOO_SHORT, reliability.REASON_TOO_LONG,
        reliability.RELIED_ON_NEEDED, reliability.RELIED_ON_TOO_LONG,
        reliability.RELIED_ON_NOT_TAKEN, reliability.STALE, reliability.NOTHING_STANDS,
        reliability.RECORDED_SINCE,
    ]  # fmt: skip
    assert len(set(sentences)) == len(sentences)
    for text in [*sentences, *KIND_WORDS.values(), reliability.FILE_GONE_REASON]:
        assert "client" not in text.lower(), text
    for text in sentences:
        # One sentence: it ends once, and nothing follows a full stop.
        assert text.endswith(".") and ". " not in text, text
        assert len(text) <= 120, text
    assert reliability.NO_QUESTION == (
        "The check raises no question about this file's reliability, so there is nothing to decide."
    )


# --- Which files carry a question, in the check's own words --------------------------------


def test_a_file_has_a_question_exactly_where_the_reviews_rule_says_reliability_is_open() -> None:
    open_files = [
        _said(F1, source="MANAGEMENT_PREPARED"),
        _said(F2, basis="NOT_SHOWN"),
        _said(F3, source="UNKNOWN", basis="PARTLY_SHOWN"),
    ]
    found = question_sentences(_review(files=open_files), (F1, F2, F3), NAMES)
    assert list(found) == [F1, F2, F3]
    assert found[F1] == (
        "ticket REQ-1041.txt was prepared by a person, not produced by a system: what it shows "
        "needs corroboration.",
    )
    assert found[F2] == (NOT_SHOWN_F2,)
    assert len(found[F3]) == 2
    # A system's own record, a document, a report that shows its basis: no question.
    settled = [_said(F1), _said(F2, source="DOCUMENT"), _said(F3, basis="SHOWN")]
    assert question_sentences(_review(files=settled), (F1, F2, F3), NAMES) == {}
    # A file the check read and the review does not describe: its source is not shown.
    found = question_sentences(_review(files=[_said(F1)]), (F1, F2), NAMES)
    assert found == {
        F2: ("The source of sap change log.txt is not shown, so what it shows needs "
             "corroboration.",),
    }  # fmt: skip
    # A check without a review (the first engine's) raises no question a person decides.
    assert question_sentences(None, (F1,), NAMES) == {} and questions(None, (F1,), NAMES) == {}


def test_the_question_is_the_checks_own_sentence_or_nothing() -> None:
    review = _review(
        "RELIABILITY_UNRESOLVED",
        (NOT_SHOWN_F2,),
        files=[_said(F1, source="MANAGEMENT_PREPARED"), _said(F2, basis="NOT_SHOWN")],
    )
    # The reasons give the sentence about F2 (a supported attribute rests on it); none
    # about F1, whose reliability the review leaves open all the same.
    assert questions(review, (F1, F2), NAMES) == {F1: "", F2: NOT_SHOWN_F2}


def test_the_entries_are_shaped_as_the_contract_shapes_them() -> None:
    standing = _decided()
    replaced = _decided(
        id=UUID(int=901), kind="NOT_RELIED_ON", relied_on="", version=2,
        ended_at=datetime(2026, 11, 14, 10, 0, tzinfo=UTC), ended_by_name="Dana Lee",
        ended_as="REPLACED",
    )  # fmt: skip
    gone = _decided(
        id=UUID(int=902), file=F3, version=2, ended_at=datetime(2026, 11, 14, 11, 0, tzinfo=UTC),
        ended_as="FILE_GONE", ended_reason=reliability.FILE_GONE_REASON,
    )  # fmt: skip
    found = Decisions({(R1, F1): standing}, {(R1, F1): [replaced], (R1, F3): [gone]})
    entries = found.entries(R1, {F1: "", F2: NOT_SHOWN_F2}, [F1, F2, F3, UUID(int=99)], {F1, F2})
    assert [entry.model_dump(mode="json") for entry in entries] == [
        {
            "file_id": str(F1),
            "question": "",
            "decision": {
                "id": str(standing.id), "kind": "ESTABLISHED_ON_REVIEW", "reason": REASON,
                "relied_on": RELIED, "recorded_by_name": "Dana Lee",
                "recorded_at": "2026-11-14T09:30:00Z",
            },
            "history": [{
                "id": str(replaced.id), "kind": "NOT_RELIED_ON", "reason": REASON,
                "relied_on": "", "recorded_by_name": "Dana Lee",
                "recorded_at": "2026-11-14T09:30:00Z", "ended_at": "2026-11-14T10:00:00Z",
                "ended_by_name": "Dana Lee", "ended_as": "REPLACED", "ended_reason": "",
            }],
        },
        {"file_id": str(F2), "question": NOT_SHOWN_F2, "decision": None, "history": []},
        # No question now, no decision standing (its file is not in force), but a history:
        # still listed, and the ending names nobody.
        {
            "file_id": str(F3), "question": "", "decision": None,
            "history": [{
                "id": str(gone.id), "kind": "ESTABLISHED_ON_REVIEW", "reason": REASON,
                "relied_on": RELIED, "recorded_by_name": "Dana Lee",
                "recorded_at": "2026-11-14T09:30:00Z", "ended_at": "2026-11-14T11:00:00Z",
                "ended_by_name": None, "ended_as": "FILE_GONE",
                "ended_reason": "The file is no longer in force on this request.",
            }],
        },
    ]  # fmt: skip
    # A standing decision on a file not in force is never given as standing.
    assert found.entries(R1, {}, [F1], set())[0].decision is None
    # A file with no question, no decision and no history is not listed.
    assert found.entries(R2, {}, [F1, F2], {F1, F2}) == []
    assert standing.ended_body() is None
    assert reliability.review_order(None, (F1,)) == []
    assert reliability.review_order(_review(files=[_said(F2)]), (F1, F2)) == [F2, F1]


# --- The workpaper -------------------------------------------------------------------------


def _unresolved(*files: Any, reasons: tuple[str, ...] = (NOT_SHOWN_F2,)) -> Any:
    return _review("RELIABILITY_UNRESOLVED", reasons, files=list(files))


def test_a_decision_is_read_only_on_a_current_check_for_a_file_in_force() -> None:
    standing = [_decided(), _decided(file=F3, requirement=R2), _decided(file=F2, requirement=R2)]
    checks = {R1: _check(_item(A)), R2: _check(_item(A), requirement=R2, status="OUT_OF_DATE")}
    assert decisions_applying(standing, checks, REQUESTS) == [standing[0]]
    current = {R1: checks[R1], R2: _check(_item(A), requirement=R2)}
    # F2 is not in force on R2.
    assert decisions_applying(standing, current, REQUESTS) == standing[:2]
    ended = _decided(ended_at=RECORDED_AT, ended_as="REOPENED", version=2)
    assert decisions_applying([ended], current, REQUESTS) == []
    for status in ("QUEUED", "CHECKING", "HELD", "FAILED", "NOT_CHECKED"):
        assert decisions_applying(standing[:1], {R1: _check(status=status)}, REQUESTS) == []


def test_a_file_established_on_review_counts_as_reliable_for_the_tickmark() -> None:
    passed = (("PASSED", "Approved before granted."),)
    review = _unresolved(_said(F1, basis="NOT_SHOWN"), _said(F2))
    check = _check(_item(A, checks=passed), review=review)
    assert reliability_open(check, (F1,))
    established = [_decided("ESTABLISHED_ON_REVIEW", F1)]
    assert not reliability_open(check, (F1,), established)
    # Another request's decision is not this check's.
    assert reliability_open(check, (F1,), [_decided(requirement=R2)])

    def mark(decisions: list[Decision]) -> str:
        checks = {R1: check}
        shown, _left = attributes_of(
            ATTRIBUTES, REQUESTS, checks, [], _index(checks=checks), None, (), decisions
        )
        return next(a for a in shown if a.code == "A").tickmark

    assert mark([]) == "NONE"
    assert mark(established) == "COMPARED"
    # Not relied on settles the question, but the showing rests only on that file: no mark.
    assert mark([_decided("NOT_RELIED_ON", F1)]) == "NONE"
    # A question left open on another file the review raises keeps the mark away while
    # the review says reliability is unresolved, until that file is decided too.
    both = _check(
        _item(A, checks=passed),
        review=_unresolved(_said(F1, basis="NOT_SHOWN"), _said(F2, source="UNKNOWN")),
    )
    assert reliability_open(both, (F1,), established)
    assert not reliability_open(both, (F1,), [*established, _decided("NOT_RELIED_ON", F2)])
    # An engine 1 check made no review: the question was never answered.
    assert reliability_open(_check(_item(A), engine=1), (F1,), established)


def test_a_file_not_relied_on_takes_the_mark_away_and_is_a_point() -> None:
    review = _unresolved(_said(F1), _said(F2, basis="NOT_SHOWN"))
    checks = {R1: _check(_item(A, files=(F2,)), _item(B, files=(F1, F2)), review=review)}
    decisions = [_decided("NOT_RELIED_ON", F2)]
    readings = readings_of(checks[R1], decisions)
    # Rewritten 19 November 2026 (D3, product owner: a showing that rests in any part on a
    # file not relied on does not count). Old: B, shown on F1 and F2 with F2 not relied on,
    # was not discounted: SHOWN with an AGREED mark, and no point. New: B is discounted
    # like A: SHOWN, no mark, and a point naming only the file not relied on (F2, "sap
    # change log.txt"), never F1. Why: the readings judge an element on its files
    # together, so the showing cannot be split between a relied and an excluded file.
    assert readings[A].not_relied and readings[B].not_relied
    evidence = _index(checks=checks)
    shown, left = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None, (), decisions)
    by_code = {a.code: a for a in shown}
    # It reads as the check found it, never more shown and never agreed, also where the
    # showing rests in part on a file relied on.
    assert (by_code["A"].state, by_code["A"].tickmark) == ("SHOWN", "NONE")
    assert (by_code["B"].state, by_code["B"].tickmark) == ("SHOWN", "NONE")
    assert (by_code["A"].shown_by, by_code["B"].shown_by) == ("NOT_RELIED", "NOT_RELIED")
    plain, _ = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None)
    assert [(a.state, a.basis) for a in plain] == [(a.state, a.basis) for a in shown]
    # Before the decision, the question on the log keeps every mark away.
    assert [a.tickmark for a in plain[:2]] == ["NONE", "NONE"]
    # Rewritten for section 3.9 (16 November 2026). Old: an UNSETTLED, OPEN matter for
    # attribute A, then the decision as a NOTED DISPOSITION matter ("sap change log.txt:
    # “Not relied on”, recorded by ..."). New: attribute A is a NOT_RELIED point at its row,
    # settled by a decision on the file (or a consideration); the decision itself is no
    # point: the evidence index says it on the file's line (below). Why: the product owner
    # removed the matters; each item is at its place.
    points = points_of(REQUESTS, checks, ATTRIBUTES, left, [], evidence, decisions)
    assert [(p.kind, p.text, p.refs, p.place.at, p.place.attribute_id) for p in points] == [
        ("NOT_RELIED", "Attribute A rests on a file not relied on: "
         "“sap change log.txt”.", ["E2"], "ATTRIBUTE", A),
        ("NOT_RELIED", "Attribute B rests on a file not relied on: "
         "“sap change log.txt”.", ["E2"], "ATTRIBUTE", B),
    ]  # fmt: skip
    assert points[0].settle == ["RELIABILITY", "CONSIDER"]
    # In the evidence index, said so with the reason; another file is not.
    index, _more = evidence_index(REQUESTS, checks, [], decisions)
    assert [(e.ref, e.not_relied_on) for e in index] == [
        ("E1", None),
        ("E2", f"Not relied on, recorded by Dana Lee on 14 November 2026. Reason: {REASON}"),
        ("E3", None),
    ]
    assert [e.not_relied_on for e in evidence_index(REQUESTS, checks, [])[0]] == [None] * 3


def test_an_established_report_carries_the_mark_the_procedure_and_its_index_line() -> None:
    review = _unresolved(_said(F1), _said(F2, basis="NOT_SHOWN"))
    checks = {R1: _check(_item(A, files=(F2,)), review=review)}
    decisions = [_decided("ESTABLISHED_ON_REVIEW", F2)]
    evidence = _index(checks=checks)
    section = Section(
        key="information-produced-by-the-entity", title="Information produced by the entity",
        kind="table", columns=["Report", "Source system", "Completeness and accuracy procedure"],
        rows=[["sap change log.txt", "SAP ERP", ""], ["User listing", "Workday", ""]],
    )  # fmt: skip
    assert [r.model_dump() for r in reports_of(section, evidence, decisions)] == [
        {"ref": "E2", "report": "sap change log.txt", "source": "SAP ERP", "procedure": "",
         "mark": "INSPECTED",
         "established": "Reliability established on review by Dana Lee on 14 November 2026. "
                        f"Relied on: {RELIED}"},
        {"ref": "", "report": "User listing", "source": "Workday", "procedure": "",
         "mark": None, "established": ""},
    ]  # fmt: skip
    assert [r.mark for r in reports_of(section, evidence)] == [None, None]
    procedures = procedures_of(REQUESTS, checks, ATTRIBUTES, _walk(), decisions)
    assert procedures[-1] == "Established the reliability of 1 report on review, as recorded."
    assert not any("Established" in p for p in procedures_of(REQUESTS, checks, ATTRIBUTES, _walk()))
    two = [*decisions, _decided("ESTABLISHED_ON_REVIEW", F1, id=UUID(int=899))]
    assert procedures_of(REQUESTS, checks, ATTRIBUTES, _walk(), two)[-1] == (
        "Established the reliability of 2 reports on review, as recorded."
    )
    # The legend's entry for the mark goes with it.
    assert "INSPECTED" in [t.mark for t in legend(True)]
    _shown, left = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None, (), decisions)
    # Rewritten for section 3.9 (16 November 2026). Old: the decision was a NOTED
    # DISPOSITION matter ("sap change log.txt: “Reliability established on the auditor's
    # review”, recorded by ..."), and the check's sentence a COMPLETENESS matter only
    # without it. New: the check's sentence is a COMPLETENESS point at the file, settled by
    # a decision on it, and gone once one is recorded; the decision is said on the report
    # row naming the file (above) and on the file's line in the evidence index, so a file
    # no row names still shows it. Why: each item at its place, nothing repeated.
    points = points_of(REQUESTS, checks, ATTRIBUTES, left, [], evidence, decisions)
    # The check's own sentence about the file no longer waits: the decision settles it.
    assert NOT_SHOWN_F2 not in [p.text for p in points]
    index, _more = evidence_index(REQUESTS, checks, [], decisions)
    assert [(e.ref, e.established) for e in index] == [
        ("E1", ""),
        ("E2", "Reliability established on review by Dana Lee on 14 November 2026. "
               f"Relied on: {RELIED}"),
        ("E3", ""),
    ]  # fmt: skip
    assert [e.established for e in evidence_index(REQUESTS, checks, [])[0]] == [""] * 3
    # Without the decision, the sentence waits on a person as before, at the file, and a
    # decision on the file settles it.
    [waits] = points_of(REQUESTS, checks, ATTRIBUTES, left, [], evidence)
    assert (waits.kind, waits.text, waits.refs) == ("COMPLETENESS", NOT_SHOWN_F2, ["E2"])
    assert (waits.place.at, waits.place.file_id, waits.place.requirement_id) == ("FILE", F2, R1)
    assert waits.settle == ["RELIABILITY", "CONSIDER"]


def test_the_words_written_for_a_decision_never_say_the_client() -> None:
    decided = [_decided(), _decided("NOT_RELIED_ON", F2)]
    texts = [
        *view.RELIABILITY_WORDS.values(),
        view.not_relied_sentence(decided[1]),
        view.established_sentence(decided[0]),
    ]
    for text in texts:
        assert "client" not in text.lower(), text
