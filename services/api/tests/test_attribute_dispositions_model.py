"""Tickmarks: a person's disposition of an attribute (docs/evidence-assurance.md, section
10.13): the pure part, with synthetic values only. No database, no model, no file.

Audit integrity:

- a reason is always given, as one bounded line; what was relied on instead is kept only
  with "Evidence not available, accepted";
- a check finds a contradiction exactly where the workpaper reads "Exception shown" (the
  assessment of section 10.6, for either engine), and supported only by its own SUPPORTED;
- a later check supersedes a disposition that closes an attribute where it finds the
  attribute supported, overtakes it where it finds a contradiction, and otherwise leaves
  it standing; a person's EXCEPTION is never ended by a check;
- "Shown, on my review" rests only on an annotation of the request that a person made,
  confirmed or edited, still listed, naming the attribute, on a file in force;
- a disposition is taken only on a finished, current check, and each other state has its
  own plain sentence;
- no sentence written here says "the client".
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from pydantic import ValidationError

from ai_workforce_api import attribute_dispositions as dispositions
from ai_workforce_api.attribute_dispositions import (
    CLOSING,
    KIND_WORDS,
    KINDS,
    REASON_MAX,
    RELIED_ON_MAX,
    Disposition,
    Dispositions,
    DispositionState,
    RecordBody,
    ReopenBody,
    annotation_refusal,
    check_finds,
    clean_reason,
    clean_relied_on,
    ending_by_check,
    not_current,
)

A, R1, RUN = UUID(int=1), UUID(int=20), UUID(int=40)


def _refused(call: Any, *args: Any) -> str:
    with pytest.raises(DispositionState) as refusal:
        call(*args)
    return refusal.value.detail


def test_the_kinds_and_their_words_are_the_contracts() -> None:
    assert KINDS == ("SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE", "EXCEPTION")
    assert KIND_WORDS == {
        "SHOWN_ON_REVIEW": "Shown, on my review",
        "NOT_APPLICABLE": "Not applicable to this instance",
        "NOT_AVAILABLE": "Evidence not available, accepted",
        "EXCEPTION": "Exception",
    }
    # An exception closes nothing.
    assert CLOSING == {"SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE"}
    assert (dispositions.REASON_MIN, REASON_MAX, RELIED_ON_MAX) == (10, 1000, 600)
    assert dispositions.HISTORY_MAX == 10


def test_a_reason_is_one_bounded_line_and_always_given() -> None:
    assert clean_reason("  The ticket system\n was retired in 2026.  ") == (
        "The ticket system was retired in 2026."
    )
    assert clean_reason("x" * 10) == "x" * 10 and clean_reason("x" * 1000) == "x" * 1000
    for short in ("", "   ", "too short", "x" * 9, " \n x x x \n "):
        assert _refused(clean_reason, short) == dispositions.REASON_TOO_SHORT
    assert _refused(clean_reason, "x" * 1001) == dispositions.REASON_TOO_LONG
    assert dispositions.REASON_TOO_SHORT == (
        "Give the reason in a sentence of at least 10 characters."
    )
    assert dispositions.REASON_TOO_LONG == "The reason can be at most 1000 characters."
    # Cleaned as other person text is: a secret is never kept.
    kept = clean_reason("Seen on the admin console, password: Hunter2-Zebra!")
    assert "Hunter2" not in kept and "[redacted]" in kept


def test_what_was_relied_on_is_kept_only_with_evidence_not_available() -> None:
    assert clean_relied_on("NOT_AVAILABLE", "  The HR leaver\n report. ") == "The HR leaver report."
    assert clean_relied_on("NOT_AVAILABLE", None) == ""
    for kind in ("SHOWN_ON_REVIEW", "NOT_APPLICABLE", "EXCEPTION"):
        assert clean_relied_on(kind, None) == "" and clean_relied_on(kind, "  ") == ""
        assert _refused(clean_relied_on, kind, "The HR leaver report.") == (
            dispositions.RELIED_ON_NOT_TAKEN
        )
    assert clean_relied_on("NOT_AVAILABLE", "x" * 600) == "x" * 600
    assert _refused(clean_relied_on, "NOT_AVAILABLE", "x" * 601) == (
        dispositions.RELIED_ON_TOO_LONG
    )


def test_the_bodies_are_strict() -> None:
    body = RecordBody.model_validate({"kind": "NOT_APPLICABLE", "reason": "No leaver here."})
    assert (body.relied_on, body.annotation_id) == (None, None)
    for refused in (
        {"kind": "ACCEPTED", "reason": "No leaver in the period."},
        {"kind": "NOT_APPLICABLE"},
        {"kind": "NOT_APPLICABLE", "reason": "No leaver here.", "status": "CLOSED"},
        {"kind": "NOT_APPLICABLE", "reason": "x" * 4001},
        {"kind": "SHOWN_ON_REVIEW", "reason": "It is on the ticket.", "annotation_id": "no"},
    ):
        with pytest.raises(ValidationError):
            RecordBody.model_validate(refused)
    # What the person saw standing: nothing, unless they say which one (review fix 1).
    assert body.replaces is None
    seen = RecordBody.model_validate(
        {"kind": "EXCEPTION", "reason": "No leaver here.", "replaces": str(UUID(int=900))}
    )
    assert seen.replaces == UUID(int=900)
    with pytest.raises(ValidationError):
        RecordBody.model_validate({"kind": "EXCEPTION", "reason": "x" * 12, "replaces": "no"})
    # A reopening names the disposition the person saw (review fix 1). Rewritten: the
    # first contract took `{version, reason}` alone, and every standing row has version 1,
    # so the version could never tell one disposition from the one that replaced it. The
    # version is still accepted, and never needed.
    reopening = ReopenBody.model_validate({"id": str(UUID(int=900)), "reason": "In error here."})
    assert (reopening.id, reopening.version) == (UUID(int=900), None)
    assert ReopenBody.model_validate(
        {"id": str(UUID(int=900)), "version": 1, "reason": "Recorded in error."}
    ).version == 1  # fmt: skip
    unreadable: list[dict[str, Any]] = [
        {"reason": "Recorded in error."},
        {"version": 0, "reason": "Recorded in error."},
        {"version": 1},
        {"version": 1, "reason": "Recorded in error."},
        {"id": "not-an-id", "reason": "Recorded in error."},
        {"id": str(UUID(int=900)), "version": 0, "reason": "Recorded in error."},
        {"id": str(UUID(int=900))},
        {"id": str(UUID(int=900)), "reason": "Recorded in error.", "kind": "EXCEPTION"},
    ]
    for unread in unreadable:
        with pytest.raises(ValidationError):
            ReopenBody.model_validate(unread)


def _item(verdict: str, **over: Any) -> dict[str, Any]:
    return {"attribute_id": str(A), "verdict": verdict, "expected": True, **over}


def test_what_a_check_finds_of_an_attribute() -> None:
    # Engine 2 records the assessment; the verdict says supported.
    assert check_finds(_item("SUPPORTED", assessment="SATISFIED", result="MET")) == "SUPPORTED"
    assert check_finds(_item("ISSUE", assessment="CONTRADICTED", result="NOT_MET")) == (
        "CONTRADICTED"
    )
    # An exception shown beside a file not read stays a person's, and is still one.
    assert check_finds(_item("UNSETTLED", assessment="CONTRADICTED")) == "CONTRADICTED"
    for verdict, assessment in (
        ("PARTLY_SUPPORTED", "PARTIALLY_SUPPORTED"), ("ISSUE", "NOT_DEMONSTRATED"),
        ("ISSUE", "PARTIALLY_SUPPORTED"), ("UNSETTLED", "INDETERMINATE"),
        ("NOT_ADDRESSED", None),
    ):  # fmt: skip
        assert check_finds(_item(verdict, assessment=assessment)) == "OTHER"
    # A run of the first engine recorded no assessment: the same table gives it.
    deviation = [{"key": "wording", "result": "NOT_MET", "deviation": True}]
    absent = [{"key": "wording", "result": "NOT_MET", "deviation": False}]
    assert check_finds(_item("ISSUE", result="NOT_MET", elements=deviation)) == "CONTRADICTED"
    assert check_finds(_item("ISSUE", result="CONTRADICTED", elements=absent)) == "CONTRADICTED"
    assert check_finds(_item("ISSUE", result="NOT_MET", elements=absent)) == "OTHER"
    assert check_finds(_item("UNSETTLED", elements=deviation)) == "CONTRADICTED"
    assert check_finds(_item("SUPPORTED", result="MET")) == "SUPPORTED"
    # An attribute the request does not ask for: only a contradiction is a finding of it.
    assert check_finds(_item("SUPPORTED", expected=False, result="MET")) == "SUPPORTED"
    assert check_finds(
        _item("ISSUE", expected=False, result="NOT_MET", elements=deviation)
    ) == "CONTRADICTED"  # fmt: skip
    # An attribute the run has no word on.
    assert check_finds(None) == "OTHER"


@pytest.mark.parametrize("kind", ["SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE"])
def test_a_later_check_ends_what_closed_an_attribute(kind: str) -> None:
    assert ending_by_check(kind, "SUPPORTED") == "SUPERSEDED_BY_CHECK"
    assert ending_by_check(kind, "CONTRADICTED") == "OVERTAKEN_BY_CHECK"
    assert ending_by_check(kind, "OTHER") is None
    # A file no longer in force matters only to what rests on an annotation, and what the
    # check found comes first.
    gone = ending_by_check(kind, "OTHER", annotation_in_force=False)
    assert gone == ("ANNOTATION_GONE" if kind == "SHOWN_ON_REVIEW" else None)
    assert ending_by_check(kind, "SUPPORTED", annotation_in_force=False) == "SUPERSEDED_BY_CHECK"
    assert ending_by_check(kind, "CONTRADICTED", annotation_in_force=False) == (
        "OVERTAKEN_BY_CHECK"
    )


def test_a_persons_exception_is_never_ended_by_a_check() -> None:
    for finds in ("SUPPORTED", "CONTRADICTED", "OTHER"):
        assert ending_by_check("EXCEPTION", finds) is None
        assert ending_by_check("EXCEPTION", finds, annotation_in_force=False) is None


def test_shown_on_my_review_rests_only_on_a_reviewed_annotation_of_the_request() -> None:
    def refusal(**over: Any) -> str | None:
        facts: dict[str, Any] = {
            "found": True, "status": "CONFIRMED", "kind": "SHOWS", "names_attribute": True,
            "file_in_force": True,
        }  # fmt: skip
        return annotation_refusal(**(facts | over))

    assert refusal() is None and refusal(status="EDITED") is None
    # Only an annotation that shows the attribute carries it (review fix 3): never one
    # that marks an exception, identifies a person or names a source, reviewed or not.
    for kind in ("EXCEPTION", "IDENTIFIES", "SOURCE"):
        for status in ("CONFIRMED", "EDITED"):
            assert refusal(kind=kind, status=status) == dispositions.ANNOTATION_NOT_SHOWS
    assert dispositions.ANNOTATION_NOT_SHOWS == (
        "“Shown, on my review” needs an annotation that shows the attribute, not one that "
        "marks an exception, a person or source."
    )
    # An agent's proposal nobody reviewed is said so first.
    assert refusal(kind="EXCEPTION", status="PROPOSED") == dispositions.ANNOTATION_UNREVIEWED
    assert refusal(found=False) == dispositions.ANNOTATION_ELSEWHERE
    assert refusal(status="PROPOSED") == dispositions.ANNOTATION_UNREVIEWED
    assert refusal(status="REMOVED") == dispositions.ANNOTATION_REMOVED
    assert refusal(status="SUPERSEDED") == dispositions.ANNOTATION_REMOVED
    assert refusal(names_attribute=False) == dispositions.ANNOTATION_OTHER_ATTRIBUTE
    assert refusal(file_in_force=False) == dispositions.ANNOTATION_FILE_GONE
    # An annotation of another request is said so, whatever else is true of it.
    assert refusal(found=False, status="PROPOSED", names_attribute=False) == (
        dispositions.ANNOTATION_ELSEWHERE
    )


def test_only_a_finished_current_check_takes_a_disposition() -> None:
    assert not_current("REVIEWED") is None
    assert {status: not_current(status) for status in (
        "NOT_CHECKED", "QUEUED", "CHECKING", "HELD", "FAILED", "OUT_OF_DATE",
    )} == {
        "NOT_CHECKED": dispositions.NOT_CHECKED,
        "QUEUED": dispositions.STILL_CHECKING,
        "CHECKING": dispositions.STILL_CHECKING,
        "HELD": dispositions.CHECK_HELD,
        "FAILED": dispositions.CHECK_FAILED,
        "OUT_OF_DATE": dispositions.CHECK_OUT_OF_DATE,
    }  # fmt: skip
    # A status this module does not know is never taken as finished.
    assert not_current("CANCELLED") == dispositions.CHECK_FAILED


def test_each_refusal_is_one_plain_sentence_that_never_says_the_client() -> None:
    sentences = [
        dispositions.NOT_CHECKED, dispositions.STILL_CHECKING, dispositions.CHECK_HELD,
        dispositions.CHECK_FAILED, dispositions.CHECK_OUT_OF_DATE, dispositions.NOT_AN_ATTRIBUTE,
        dispositions.REASON_TOO_SHORT, dispositions.REASON_TOO_LONG,
        dispositions.RELIED_ON_TOO_LONG, dispositions.RELIED_ON_NOT_TAKEN,
        dispositions.ANNOTATION_NOT_TAKEN, dispositions.ANNOTATION_NEEDED,
        dispositions.ANNOTATION_ELSEWHERE, dispositions.ANNOTATION_REMOVED,
        dispositions.ANNOTATION_UNREVIEWED, dispositions.ANNOTATION_OTHER_ATTRIBUTE,
        dispositions.ANNOTATION_FILE_GONE, dispositions.ONLY_EXCEPTION, dispositions.STALE,
        dispositions.NOTHING_STANDS, dispositions.RECORDED_SINCE,
        dispositions.ANNOTATION_NOT_SHOWS,
    ]  # fmt: skip
    written = [
        *sentences, *KIND_WORDS.values(), dispositions.SUPERSEDED_REASON,
        dispositions.OVERTAKEN_REASON, dispositions.ANNOTATION_REMOVED_REASON,
        dispositions.ANNOTATION_RENAMED_REASON, dispositions.FILE_GONE_REASON,
    ]  # fmt: skip
    assert len(set(sentences)) == len(sentences)
    for text in written:
        assert "client" not in text.lower(), text
    for text in sentences:
        # One sentence: it ends once, and nothing follows a full stop.
        assert text.endswith(".") and ". " not in text, text
        assert len(text) <= 120, text
    assert dispositions.ONLY_EXCEPTION == (
        "The check finds the records contradict this attribute, so only “Exception” can be "
        "recorded here."
    )


def test_an_act_is_refused_where_what_stands_is_not_what_the_person_saw() -> None:
    """Review fix 1: a standing disposition changes only by ending, so its version is
    always 1 and cannot tell it from the one that replaced it. What the person saw is
    named by its id: nothing (None), or the disposition they saw standing."""
    seen, other = UUID(int=900), UUID(int=901)
    assert dispositions.stale_refusal(None, None) is None
    assert dispositions.stale_refusal(seen, seen) is None
    # Another was recorded since the page loaded: in place of the one seen, or where the
    # person saw none.
    assert dispositions.stale_refusal(other, seen) == dispositions.RECORDED_SINCE
    assert dispositions.stale_refusal(other, None) == dispositions.RECORDED_SINCE
    # The one seen has ended since, and none stands now.
    assert dispositions.stale_refusal(None, seen) == dispositions.STALE
    assert dispositions.RECORDED_SINCE == (
        "A tickmark was recorded on this attribute since the page loaded, so refresh and try again."
    )


def test_what_the_list_says_is_contradicted_is_what_recording_refuses() -> None:
    """Review fix 2: the D&I list gives `contradicted` by the same rule recording refuses
    a closing kind by, for either engine. A run of the first engine names no assessment
    and the list sends no deviation, so the screen cannot work it out for itself."""
    deviation = [{"key": "wording", "result": "NOT_MET", "deviation": True}]
    absent = [{"key": "wording", "result": "NOT_MET", "deviation": False}]
    items: list[dict[str, Any] | None] = [
        _item("SUPPORTED", assessment="SATISFIED", result="MET"),
        _item("PARTLY_SUPPORTED", assessment="PARTIALLY_SUPPORTED"),
        _item("ISSUE", assessment="NOT_DEMONSTRATED", result="NOT_MET"),
        _item("ISSUE", assessment="CONTRADICTED", result="NOT_MET"),
        _item("UNSETTLED", assessment="INDETERMINATE"),
        _item("UNSETTLED", assessment="CONTRADICTED"),
        _item("ISSUE", result="NOT_MET", elements=deviation),
        _item("ISSUE", result="NOT_MET", elements=absent),
        _item("ISSUE", result="CONTRADICTED", elements=absent),
        _item("UNSETTLED", elements=deviation),
        _item("SUPPORTED", result="MET"),
        _item("ISSUE", expected=False, result="NOT_MET", elements=deviation),
        None,
    ]
    for item in items:
        assert dispositions.contradicted(item) == (check_finds(item) == "CONTRADICTED"), item
    assert dispositions.contradicted(_item("ISSUE", result="NOT_MET", elements=deviation))
    assert not dispositions.contradicted(_item("ISSUE", result="NOT_MET", elements=absent))


def _disposition(**over: Any) -> Disposition:
    values: dict[str, Any] = {
        "id": UUID(int=900),
        "requirement_id": R1,
        "attribute_id": A,
        "kind": "NOT_AVAILABLE",
        "reason": "The ticket system was retired in 2026.",
        "relied_on": "The HR leaver report.",
        "annotation_id": None,
        "assessment_id": RUN,
        "recorded_by_name": "Dana Lee",
        "recorded_at": datetime(2026, 11, 14, 9, 30, tzinfo=UTC),
        "version": 1,
    }
    return Disposition(**(values | over))


def test_what_stands_and_what_ended_are_given_as_the_contract_shapes_them() -> None:
    standing = _disposition()
    ended = _disposition(
        id=UUID(int=901), kind="EXCEPTION", relied_on="", version=2,
        ended_at=datetime(2026, 11, 14, 10, 0, tzinfo=UTC), ended_by_name="Dana Lee",
        ended_as="REOPENED", ended_reason="Recorded on the wrong attribute.",
    )  # fmt: skip
    by_check = _disposition(
        id=UUID(int=902), version=2, ended_at=datetime(2026, 11, 14, 11, 0, tzinfo=UTC),
        ended_as="SUPERSEDED_BY_CHECK", ended_reason=dispositions.SUPERSEDED_REASON,
    )  # fmt: skip
    found = Dispositions({(R1, A): standing}, {(R1, A): [by_check, ended]})
    body = found.standing(R1, A, RUN)
    assert body is not None
    # Rewritten for section 10.15, item 9 (the shape grew). Old expectation: the standing
    # disposition is exactly the eight fields below, and an ended one is those and its
    # four ending fields. New: the standing one also says `on_current_check`; an ended one
    # is unchanged (it never carries it). Why: a tickmark that stands through a later
    # check says so.
    assert body.model_dump(mode="json") == {
        "id": str(standing.id),
        "kind": "NOT_AVAILABLE",
        "reason": "The ticket system was retired in 2026.",
        "relied_on": "The HR leaver report.",
        "annotation_id": None,
        "recorded_by_name": "Dana Lee",
        "recorded_at": "2026-11-14T09:30:00Z",
        "version": 1,
        "on_current_check": True,
    }
    assert found.standing(R1, UUID(int=2)) is None and found.history(R1, UUID(int=2)) == []
    history = [item.model_dump(mode="json") for item in found.history(R1, A)]
    assert [item["id"] for item in history] == [str(by_check.id), str(ended.id)]
    assert set(history[0]) == (set(body.model_dump()) - {"on_current_check"}) | {
        "ended_at", "ended_by_name", "ended_as", "ended_reason",
    }  # fmt: skip
    # Nobody is named where a check ended it.
    assert (history[0]["ended_as"], history[0]["ended_by_name"]) == ("SUPERSEDED_BY_CHECK", None)
    assert (history[1]["ended_as"], history[1]["ended_by_name"]) == ("REOPENED", "Dana Lee")
    assert history[1]["ended_reason"] == "Recorded on the wrong attribute."
    # What stands is never given as ended.
    assert standing.ended_body() is None


def test_a_standing_tickmark_says_which_check_it_is_on_and_a_request_how_many_it_keeps() -> None:
    """Section 10.15, items 8 and 9: `on_current_check` is true only where the disposition
    was recorded on the run given as the request's current one (never where no run is
    given), and `kept` counts what stands on a request, whatever its check's state."""
    later = UUID(int=77)
    other = _disposition(id=UUID(int=903), attribute_id=UUID(int=3), kind="EXCEPTION")
    elsewhere = _disposition(id=UUID(int=904), requirement_id=UUID(int=55))
    ended = _disposition(
        id=UUID(int=905), version=2, ended_at=datetime(2026, 11, 14, 10, 0, tzinfo=UTC),
        ended_as="REOPENED", ended_by_name="Dana Lee", ended_reason="Recorded in error.",
    )  # fmt: skip
    found = Dispositions(
        {(R1, A): _disposition(), (R1, UUID(int=3)): other, (UUID(int=55), A): elsewhere},
        {(R1, A): [ended]},
    )
    on_it, earlier, unknown = (found.standing(R1, A, run) for run in (RUN, later, None))
    assert on_it is not None and earlier is not None and unknown is not None
    assert (on_it.on_current_check, earlier.on_current_check, unknown.on_current_check) == (
        True, False, False,
    )  # fmt: skip
    # Nothing else of the disposition differs by the run it is read against.
    assert on_it.model_dump(exclude={"on_current_check"}) == earlier.model_dump(
        exclude={"on_current_check"}
    )
    # What stands on the request, never what ended and never another request's.
    assert (found.kept(R1), found.kept(UUID(int=55)), found.kept(UUID(int=56))) == (2, 1, 0)
    assert Dispositions({}, {(R1, A): [ended]}).kept(R1) == 0
