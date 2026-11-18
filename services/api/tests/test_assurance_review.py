"""The two dimensions of an evidence check and the outcome proposed from them
(docs/evidence-assurance.md, 10.4 and 10.6; ai_workforce_api/assurance_review.py).

Pure: no database, no model, synthetic names only. Each rule of the module has its test,
and the product owner's named cases are here by name: an exception shown despite a file
that could not be read is still a potential exception, an attribute nothing shows is not
demonstrated and never contradicted, sufficient evidence asks for nothing more, a report
that does not show its basis needs corroboration only where an attribute rests on it, a
spreadsheet a person prepared likewise, a failed reading and an incomplete screenshot make
the evidence partly unreadable, one reading alone never makes a file irrelevant, and an
exception on an attribute the request does not ask for still stands.
"""

from itertools import product
from typing import get_args
from uuid import UUID

import pytest

from ai_workforce_api.assurance_review import (
    CONTEXT_THIN,
    Assessment,
    AttributeLine,
    Completeness,
    FileReview,
    FileSaid,
    LeftOut,
    Legibility,
    Overall,
    Relevance,
    ReportBasis,
    Source,
    assessment_of,
    completeness_of,
    overall_of,
    reconcile_files,
)

TICKET = UUID("00000000-0000-4000-8000-000000000001")
LISTING = UUID("00000000-0000-4000-8000-000000000002")
SCREENSHOT = UUID("00000000-0000-4000-8000-000000000003")
STRANGER = UUID("00000000-0000-4000-8000-000000000099")
NAMES = {
    TICKET: "ticket-1001.pdf",
    LISTING: "access-listing.xlsx",
    SCREENSHOT: "role-screen.png",
}
VERDICTS = ("SUPPORTED", "PARTLY_SUPPORTED", "ISSUE", "UNSETTLED", "NOT_ADDRESSED")
RESULTS = (
    "MET", "SHOWN_IN_PART", "PARTLY_MET", "NOT_MET", "CONTRADICTED", "CANNOT_TELL",
    "NOT_ADDRESSED", None,
)  # fmt: skip


def review(
    file_id: UUID,
    *,
    relevance: Relevance = "RELEVANT",
    source: Source = "SYSTEM_RECORD",
    legibility: Legibility = "CLEAR",
    report_basis: ReportBasis = "NOT_A_REPORT",
    notes: tuple[str, ...] = (),
    legibility_notes: tuple[str, ...] = (),
) -> FileReview:
    return FileReview(file_id, relevance, source, legibility, report_basis, notes, legibility_notes)


# --- assessment_of -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("verdict", "result", "deviation", "assessment"),
    [
        ("SUPPORTED", "MET", False, "SATISFIED"),
        ("PARTLY_SUPPORTED", "SHOWN_IN_PART", False, "PARTIALLY_SUPPORTED"),
        ("ISSUE", "CONTRADICTED", False, "CONTRADICTED"),
        ("ISSUE", "NOT_MET", True, "CONTRADICTED"),
        ("ISSUE", "PARTLY_MET", False, "PARTIALLY_SUPPORTED"),
        ("ISSUE", "NOT_MET", False, "NOT_DEMONSTRATED"),
        ("ISSUE", "NOT_ADDRESSED", False, "NOT_DEMONSTRATED"),
        ("UNSETTLED", None, False, "INDETERMINATE"),
        ("UNSETTLED", "CANNOT_TELL", False, "INDETERMINATE"),
        ("NOT_ADDRESSED", "NOT_ADDRESSED", False, "NOT_DEMONSTRATED"),
        ("NOT_ADDRESSED", None, False, "NOT_DEMONSTRATED"),
    ],
)
def test_an_asked_attribute_is_assessed_from_its_verdict_and_result(
    verdict: str, result: str | None, deviation: bool, assessment: Assessment
) -> None:
    found = assessment_of(verdict=verdict, result=result, expected=True, deviation=deviation)
    assert found == assessment


def test_an_attribute_not_demonstrated_is_never_called_contradicted() -> None:
    """Named case: nothing shows the attribute, and nothing shows a failure."""
    for verdict, result in product(VERDICTS, RESULTS):
        if result == "CONTRADICTED":
            continue
        for expected in (True, False):
            found = assessment_of(verdict=verdict, result=result, expected=expected)
            assert found != "CONTRADICTED", (verdict, result, expected)
    assert assessment_of(verdict="ISSUE", result="NOT_MET", expected=True) == "NOT_DEMONSTRATED"


@pytest.mark.parametrize("verdict", VERDICTS)
@pytest.mark.parametrize("expected", [True, False])
def test_a_check_that_failed_in_code_contradicts_whatever_the_verdict(
    verdict: str, expected: bool
) -> None:
    """Two readings that both say MET do not stand against a failed comparison."""
    found = assessment_of(verdict=verdict, result="MET", expected=expected, check_failed=True)
    assert found == "CONTRADICTED"


@pytest.mark.parametrize("expected", [True, False])
def test_an_exception_shown_beside_a_file_not_read_is_contradicted(expected: bool) -> None:
    """The verdict stays a person's (UNSETTLED); the assessment says what the records show."""
    found = assessment_of(
        verdict="UNSETTLED", result=None, expected=expected, exception_unchecked=True
    )
    assert found == "CONTRADICTED"


@pytest.mark.parametrize(
    ("verdict", "result"),
    [
        ("SUPPORTED", "MET"),
        ("PARTLY_SUPPORTED", "SHOWN_IN_PART"),
        ("ISSUE", "PARTLY_MET"),
        ("ISSUE", "NOT_MET"),
        ("ISSUE", "NOT_ADDRESSED"),
        ("UNSETTLED", None),
        ("UNSETTLED", "CONTRADICTED"),
        ("NOT_ADDRESSED", "NOT_ADDRESSED"),
        ("NOT_ADDRESSED", None),
    ],
)
def test_an_attribute_the_request_does_not_ask_for_has_no_assessment(
    verdict: str, result: str | None
) -> None:
    assert assessment_of(verdict=verdict, result=result, expected=False) is None


@pytest.mark.parametrize(
    ("verdict", "result", "deviation"),
    [("ISSUE", "CONTRADICTED", False), ("ISSUE", "NOT_MET", True)],
)
def test_an_exception_on_an_attribute_not_asked_for_is_still_contradicted(
    verdict: str, result: str, deviation: bool
) -> None:
    """Named case: an exception shown stands whether or not the request asks for it."""
    found = assessment_of(verdict=verdict, result=result, expected=False, deviation=deviation)
    assert found == "CONTRADICTED"


def test_a_deviation_contradicts_only_as_an_agreed_issue() -> None:
    """Readings that both show a deviation and still disagree are a person's to settle:
    an attribute not asked for is not judged more harshly than one that is."""
    asked = assessment_of(verdict="UNSETTLED", result=None, expected=True, deviation=True)
    assert asked == "INDETERMINATE"
    assert assessment_of(verdict="UNSETTLED", result=None, expected=False, deviation=True) is None


def test_a_deviation_outweighs_a_part_shown() -> None:
    found = assessment_of(verdict="ISSUE", result="PARTLY_MET", expected=True, deviation=True)
    assert found == "CONTRADICTED"


@pytest.mark.parametrize(
    ("verdict", "result"),
    [("ISSUE", None), ("ISSUE", "MET"), ("ISSUE", "CANNOT_TELL"), ("SOMETHING_ELSE", "MET")],
)
def test_a_verdict_or_result_the_table_does_not_know_is_indeterminate(
    verdict: str, result: str | None
) -> None:
    assert assessment_of(verdict=verdict, result=result, expected=True) == "INDETERMINATE"
    assert assessment_of(verdict=verdict, result=result, expected=False) is None


def test_every_assessment_is_in_the_vocabulary() -> None:
    known = set(get_args(Assessment))
    for verdict, result, deviation, failed, unchecked in product(
        VERDICTS, RESULTS, (False, True), (False, True), (False, True)
    ):
        asked = assessment_of(
            verdict=verdict,
            result=result,
            expected=True,
            deviation=deviation,
            check_failed=failed,
            exception_unchecked=unchecked,
        )
        other = assessment_of(
            verdict=verdict,
            result=result,
            expected=False,
            deviation=deviation,
            check_failed=failed,
            exception_unchecked=unchecked,
        )
        assert asked in known
        # Not asked for: the same exception, or nothing.
        assert other == ("CONTRADICTED" if asked == "CONTRADICTED" else None)


# --- reconcile_files -----------------------------------------------------------------


def test_readings_that_agree_are_taken_as_said_in_the_order_of_the_files() -> None:
    first = [
        FileSaid(TICKET, "RELEVANT", "The approval ticket.", "SYSTEM_RECORD", "CLEAR", "", "SHOWN"),
        FileSaid(LISTING, "PARTLY_RELEVANT", "Lists other users too.", "MANAGEMENT_PREPARED"),
    ]
    second = [
        FileSaid(LISTING, "PARTLY_RELEVANT", "Lists other users too.", "MANAGEMENT_PREPARED"),
        FileSaid(TICKET, "RELEVANT", "It is the ticket.", "SYSTEM_RECORD", "CLEAR", "", "SHOWN"),
    ]
    reviews = reconcile_files(first, second, [LISTING, TICKET])
    assert reviews == (
        FileReview(
            LISTING,
            "PARTLY_RELEVANT",
            "MANAGEMENT_PREPARED",
            "CLEAR",
            "NOT_A_REPORT",
            ("Lists other users too.",),
        ),
        # A reason for finding a file relevant is not a note.
        FileReview(TICKET, "RELEVANT", "SYSTEM_RECORD", "CLEAR", "SHOWN", ()),
    )


def test_each_file_is_reviewed_once_and_a_file_not_of_the_request_is_ignored() -> None:
    first = [
        FileSaid(STRANGER, "NOT_RELEVANT", "Not this request's."),
        FileSaid(TICKET, "RELEVANT"),
    ]
    second = [FileSaid(TICKET, "RELEVANT"), FileSaid(STRANGER, "NOT_RELEVANT")]
    reviews = reconcile_files(first, second, [TICKET, TICKET])
    assert [entry.file_id for entry in reviews] == [TICKET]
    assert reconcile_files(first, second, []) == ()


def test_a_reading_that_describes_a_file_twice_is_taken_at_its_first() -> None:
    first = [FileSaid(TICKET, "RELEVANT"), FileSaid(TICKET, "NOT_RELEVANT", "No.")]
    second = [FileSaid(TICKET, "RELEVANT")]
    (only,) = reconcile_files(first, second, [TICKET])
    assert only.relevance == "RELEVANT"
    assert only.notes == ()


@pytest.mark.parametrize(
    ("one", "two", "stands"),
    [
        ("RELEVANT", "RELEVANT", "RELEVANT"),
        ("RELEVANT", "PARTLY_RELEVANT", "PARTLY_RELEVANT"),
        ("RELEVANT", "CANNOT_TELL", "CANNOT_TELL"),
        ("PARTLY_RELEVANT", "PARTLY_RELEVANT", "PARTLY_RELEVANT"),
        ("PARTLY_RELEVANT", "CANNOT_TELL", "CANNOT_TELL"),
        ("CANNOT_TELL", "CANNOT_TELL", "CANNOT_TELL"),
        ("NOT_RELEVANT", "NOT_RELEVANT", "NOT_RELEVANT"),
        # Named case: one reading alone calling a file not relevant settles nothing.
        ("NOT_RELEVANT", "RELEVANT", "CANNOT_TELL"),
        ("NOT_RELEVANT", "PARTLY_RELEVANT", "CANNOT_TELL"),
        ("NOT_RELEVANT", "CANNOT_TELL", "CANNOT_TELL"),
    ],
)
def test_the_more_cautious_relevance_stands(
    one: Relevance, two: Relevance, stands: Relevance
) -> None:
    for first, second in ((one, two), (two, one)):
        (only,) = reconcile_files([FileSaid(TICKET, first)], [FileSaid(TICKET, second)], [TICKET])
        assert only.relevance == stands


def test_a_file_only_one_reading_calls_not_relevant_cannot_be_told() -> None:
    """Named case, with the other reading silent on the file."""
    said = [FileSaid(TICKET, "NOT_RELEVANT", "It is about another system.")]
    for first, second in ((said, []), ([], said)):
        (only,) = reconcile_files(first, second, [TICKET])
        assert only.relevance == "CANNOT_TELL"
        assert only.notes == ("It is about another system.",)


@pytest.mark.parametrize(
    ("one", "two", "stands"),
    [
        ("SYSTEM_RECORD", "SYSTEM_RECORD", "SYSTEM_RECORD"),
        ("MANAGEMENT_PREPARED", "MANAGEMENT_PREPARED", "MANAGEMENT_PREPARED"),
        ("DOCUMENT", "DOCUMENT", "DOCUMENT"),
        ("UNKNOWN", "UNKNOWN", "UNKNOWN"),
        ("SYSTEM_RECORD", "MANAGEMENT_PREPARED", "UNKNOWN"),
        ("SYSTEM_RECORD", "DOCUMENT", "UNKNOWN"),
        ("DOCUMENT", "UNKNOWN", "UNKNOWN"),
    ],
)
def test_a_source_stands_only_when_both_readings_name_it(
    one: Source, two: Source, stands: Source
) -> None:
    for first, second in ((one, two), (two, one)):
        (only,) = reconcile_files(
            [FileSaid(TICKET, source=first)], [FileSaid(TICKET, source=second)], [TICKET]
        )
        assert only.source == stands


def test_a_source_only_one_reading_names_is_unknown() -> None:
    (only,) = reconcile_files([FileSaid(TICKET, source="SYSTEM_RECORD")], [], [TICKET])
    assert only.source == "UNKNOWN"


@pytest.mark.parametrize(
    ("one", "two", "stands"),
    [
        # Rewritten after the independent review of 14 November 2026. Old expectation: the
        # worse legibility of the two stands. New: what both readings find stands (section
        # 10.6: "one both readings find partly unreadable"); one reading alone made an
        # all-satisfied request read "a file was not read" though every file was read.
        ("CLEAR", "CLEAR", "CLEAR"),
        ("CLEAR", "PARTLY_UNREADABLE", "CLEAR"),
        ("CLEAR", "UNREADABLE", "CLEAR"),
        ("PARTLY_UNREADABLE", "PARTLY_UNREADABLE", "PARTLY_UNREADABLE"),
        ("PARTLY_UNREADABLE", "UNREADABLE", "PARTLY_UNREADABLE"),
        ("UNREADABLE", "UNREADABLE", "UNREADABLE"),
    ],
)
def test_the_legibility_both_readings_find_stands(
    one: Legibility, two: Legibility, stands: Legibility
) -> None:
    for first, second in ((one, two), (two, one)):
        (only,) = reconcile_files(
            [FileSaid(TICKET, legibility=first)], [FileSaid(TICKET, legibility=second)], [TICKET]
        )
        assert only.legibility == stands


@pytest.mark.parametrize(
    ("one", "two", "stands"),
    [
        ("NOT_A_REPORT", "NOT_A_REPORT", "NOT_A_REPORT"),
        ("SHOWN", "SHOWN", "SHOWN"),
        ("SHOWN", "PARTLY_SHOWN", "PARTLY_SHOWN"),
        ("SHOWN", "NOT_SHOWN", "NOT_SHOWN"),
        ("PARTLY_SHOWN", "PARTLY_SHOWN", "PARTLY_SHOWN"),
        ("PARTLY_SHOWN", "NOT_SHOWN", "NOT_SHOWN"),
        ("NOT_SHOWN", "NOT_SHOWN", "NOT_SHOWN"),
        # One reading does not take it for a report: the other's basis stands.
        ("NOT_A_REPORT", "SHOWN", "SHOWN"),
        ("NOT_A_REPORT", "PARTLY_SHOWN", "PARTLY_SHOWN"),
        ("NOT_A_REPORT", "NOT_SHOWN", "NOT_SHOWN"),
    ],
)
def test_the_worse_report_basis_a_reading_names_stands(
    one: ReportBasis, two: ReportBasis, stands: ReportBasis
) -> None:
    for first, second in ((one, two), (two, one)):
        (only,) = reconcile_files(
            [FileSaid(TICKET, report_basis=first)],
            [FileSaid(TICKET, report_basis=second)],
            [TICKET],
        )
        assert only.report_basis == stands


def test_a_file_neither_reading_mentions_is_not_described() -> None:
    reviews = reconcile_files([FileSaid(TICKET, "RELEVANT")], [], [TICKET, LISTING])
    assert reviews[1] == FileReview(LISTING, "CANNOT_TELL", "UNKNOWN", "CLEAR", "NOT_A_REPORT", ())


def test_notes_are_the_reservations_cleaned_once_each_and_capped() -> None:
    long = "The lower half of the page is cut off " + "x" * 400
    first = [
        FileSaid(
            SCREENSHOT,
            "PARTLY_RELEVANT",
            "Shows the role,\n not who​ granted it.",
            "SYSTEM_RECORD",
            "PARTLY_UNREADABLE",
            long,
        )
    ]
    second = [
        FileSaid(
            SCREENSHOT,
            "PARTLY_RELEVANT",
            "shows the role, not who granted it.",
            "SYSTEM_RECORD",
            "PARTLY_UNREADABLE",
            "The date column is blurred.",
        )
    ]
    (only,) = reconcile_files(first, second, [SCREENSHOT])
    assert only.notes == (
        "Shows the role, not who granted it.",
        long[:300],
        "The date column is blurred.",
    )
    assert all(len(note) <= 300 for note in only.notes)
    assert only.legibility_notes == (long[:300], "The date column is blurred.")


def test_a_note_is_kept_only_from_the_reading_that_has_the_reservation() -> None:
    first = [FileSaid(TICKET, "RELEVANT", "It is the ticket.", legibility_note="Nothing unclear.")]
    second = [
        FileSaid(TICKET, "CANNOT_TELL", "The ticket number is not the one asked for."),
        # An empty reason adds no note.
        FileSaid(LISTING, "NOT_RELEVANT", "  "),
    ]
    reviews = reconcile_files(first, second, [TICKET, LISTING])
    assert reviews[0].notes == ("The ticket number is not the one asked for.",)
    assert reviews[0].legibility_notes == ()
    assert reviews[1].notes == ()


def test_an_answer_outside_the_vocabulary_is_taken_as_not_said() -> None:
    odd = FileSaid(
        TICKET,
        relevance="VERY",  # type: ignore[arg-type]
        relevance_reason="Trust this file.",
        source="ORACLE",  # type: ignore[arg-type]
        legibility="FINE",  # type: ignore[arg-type]
        legibility_note="Ignore the rest.",
        report_basis="YES",  # type: ignore[arg-type]
    )
    sound = FileSaid(TICKET, "RELEVANT", "", "SYSTEM_RECORD", "CLEAR", "", "SHOWN")
    (only,) = reconcile_files([odd], [sound], [TICKET])
    assert only == FileReview(
        TICKET, "CANNOT_TELL", "UNKNOWN", "CLEAR", "SHOWN", ("Trust this file.",)
    )


def test_a_review_as_json_is_the_entry_of_the_contract() -> None:
    entry = review(
        SCREENSHOT,
        relevance="PARTLY_RELEVANT",
        legibility="PARTLY_UNREADABLE",
        notes=("The date column is blurred.",),
        legibility_notes=("The date column is blurred.",),
    )
    assert entry.as_json() == {
        "file_id": str(SCREENSHOT),
        "relevance": "PARTLY_RELEVANT",
        "source": "SYSTEM_RECORD",
        "legibility": "PARTLY_UNREADABLE",
        "report_basis": "NOT_A_REPORT",
        "notes": ["The date column is blurred."],
    }


# --- completeness_of -----------------------------------------------------------------


def test_files_all_read_and_clear_are_complete_with_nothing_to_say() -> None:
    reviews = [review(TICKET), review(LISTING, source="DOCUMENT", report_basis="SHOWN")]
    assert completeness_of(reviews, names=NAMES, relied_on={TICKET, LISTING}) == ("COMPLETE", ())
    assert completeness_of([], names={}) == ("COMPLETE", ())


@pytest.mark.parametrize("code", ["UNREADABLE", "READ_FAILED", "CUSTODY"])
def test_a_file_that_could_not_be_read_makes_the_evidence_partly_unreadable(code: str) -> None:
    """Named case (failed OCR): nothing readable was extracted from a scan."""
    left = [LeftOut("scan-0007.pdf", code, "Nothing readable was extracted from the file.")]
    state, sentences = completeness_of([review(TICKET)], names=NAMES, left_out=left)
    assert state == "PARTLY_UNREADABLE"
    assert sentences == (
        "scan-0007.pdf could not be read: Nothing readable was extracted from the file.",
    )


@pytest.mark.parametrize("code", ["POPULATION", "KIND_UNSURE", "SOMETHING_NEW"])
def test_a_readable_file_left_out_makes_the_evidence_incomplete(code: str) -> None:
    left = [LeftOut("all-users.csv", code, "a population shows who is in scope")]
    state, sentences = completeness_of([review(TICKET)], names=NAMES, left_out=left)
    assert state == "INCOMPLETE"
    assert sentences == (
        "all-users.csv was not part of the check: a population shows who is in scope.",
    )


def test_a_file_left_out_with_no_reason_is_still_named() -> None:
    left = [
        LeftOut("scan-0007.pdf", "READ_FAILED", ""),
        LeftOut("all-users.csv", "POPULATION", " "),
    ]
    assert completeness_of([], names={}, left_out=left) == (
        "PARTLY_UNREADABLE",
        ("scan-0007.pdf could not be read.", "all-users.csv was not part of the check."),
    )


def test_a_file_read_only_in_part_makes_the_evidence_incomplete() -> None:
    state, sentences = completeness_of(
        [review(TICKET)], names=NAMES, read_in_part=["change-log-2027.txt"]
    )
    assert state == "INCOMPLETE"
    assert sentences == ("change-log-2027.txt is long and was read only in part.",)


def test_an_incomplete_screenshot_both_readings_find_partly_unreadable() -> None:
    """Named case, from the readings through to the state."""
    said = FileSaid(
        SCREENSHOT,
        "RELEVANT",
        "",
        "SYSTEM_RECORD",
        "PARTLY_UNREADABLE",
        "The right edge is cut off.",
    )
    reviews = reconcile_files([said], [said], [SCREENSHOT])
    assert completeness_of(reviews, names=NAMES, relied_on={SCREENSHOT}) == (
        "PARTLY_UNREADABLE",
        ("role-screen.png is partly unreadable: The right edge is cut off.",),
    )


def test_an_incomplete_screenshot_only_one_reading_finds_partly_unreadable() -> None:
    """Named case, rewritten after the independent review of 14 November 2026 (old: one
    reading is enough to call the evidence partly unreadable). One reading alone settles
    nothing: the file stays clear, its note is kept, and completeness is not touched."""
    clear = FileSaid(SCREENSHOT, "RELEVANT", "", "SYSTEM_RECORD")
    partly = FileSaid(
        SCREENSHOT,
        "RELEVANT",
        "",
        "SYSTEM_RECORD",
        "PARTLY_UNREADABLE",
        "The right edge is cut off.",
    )
    for first, second in (([clear], [partly]), ([partly], [clear])):
        reviews = reconcile_files(first, second, [SCREENSHOT])
        assert reviews[0].legibility == "CLEAR"
        assert reviews[0].notes == ("The right edge is cut off.",)
        assert completeness_of(reviews, names=NAMES, relied_on={SCREENSHOT}) == ("COMPLETE", ())
    both = reconcile_files([partly], [partly], [SCREENSHOT])
    assert completeness_of(both, names=NAMES, relied_on={SCREENSHOT}) == (
        "PARTLY_UNREADABLE",
        ("role-screen.png is partly unreadable: The right edge is cut off.",),
    )


def test_a_file_a_reading_could_not_read_is_said_plainly() -> None:
    reviews = [
        review(SCREENSHOT, legibility="UNREADABLE", legibility_notes=("The image is black.",)),
        review(TICKET, legibility="UNREADABLE"),
        review(LISTING, legibility="PARTLY_UNREADABLE"),
    ]
    assert completeness_of(reviews, names=NAMES) == (
        "PARTLY_UNREADABLE",
        (
            "role-screen.png could not be read: The image is black.",
            "ticket-1001.pdf could not be read.",
            "access-listing.xlsx is partly unreadable.",
        ),
    )


def test_a_remark_on_relevance_is_never_quoted_as_what_could_not_be_read() -> None:
    entry = review(SCREENSHOT, legibility="PARTLY_UNREADABLE", notes=("It shows another system.",))
    _state, sentences = completeness_of([entry], names=NAMES)
    assert sentences == ("role-screen.png is partly unreadable.",)


@pytest.mark.parametrize(
    ("basis", "sentence"),
    [
        (
            "NOT_SHOWN",
            "access-listing.xlsx is a report or listing that does not show its source, run date "
            "or parameters, so its completeness and accuracy are not established.",
        ),
        (
            "PARTLY_SHOWN",
            "access-listing.xlsx is a report or listing that shows only part of its source, run "
            "date and parameters, so its completeness and accuracy are not established.",
        ),
    ],
)
def test_a_report_relied_on_that_does_not_show_its_basis_is_unresolved(
    basis: ReportBasis, sentence: str
) -> None:
    """Named case (incomplete or unreliable IPE)."""
    reviews = [review(TICKET), review(LISTING, report_basis=basis)]
    assert completeness_of(reviews, names=NAMES, relied_on={LISTING}) == (
        "RELIABILITY_UNRESOLVED",
        (sentence,),
    )


@pytest.mark.parametrize("basis", ["NOT_SHOWN", "PARTLY_SHOWN"])
@pytest.mark.parametrize("source", ["MANAGEMENT_PREPARED", "UNKNOWN", "SYSTEM_RECORD"])
def test_the_same_report_not_relied_on_raises_nothing(basis: ReportBasis, source: Source) -> None:
    """Named case: a file nobody rests on needs no such procedure."""
    reviews = [review(TICKET), review(LISTING, source=source, report_basis=basis)]
    assert completeness_of(reviews, names=NAMES, relied_on={TICKET}) == ("COMPLETE", ())
    assert completeness_of(reviews, names=NAMES) == ("COMPLETE", ())


def test_a_spreadsheet_a_person_prepared_and_relied_on_is_unresolved() -> None:
    """Named case (a management-prepared spreadsheet relied on)."""
    reviews = [review(LISTING, source="MANAGEMENT_PREPARED")]
    assert completeness_of(reviews, names=NAMES, relied_on=[LISTING]) == (
        "RELIABILITY_UNRESOLVED",
        (
            "access-listing.xlsx was prepared by a person, not produced by a system: what it "
            "shows needs corroboration.",
        ),
    )


def test_a_file_relied_on_whose_source_is_not_shown_is_unresolved() -> None:
    reviews = [review(SCREENSHOT, source="UNKNOWN")]
    assert completeness_of(reviews, names=NAMES, relied_on={SCREENSHOT}) == (
        "RELIABILITY_UNRESOLVED",
        ("The source of role-screen.png is not shown, so what it shows needs corroboration.",),
    )


def test_a_file_relied_on_can_be_unresolved_on_its_source_and_its_basis() -> None:
    reviews = [review(LISTING, source="MANAGEMENT_PREPARED", report_basis="NOT_SHOWN")]
    state, sentences = completeness_of(reviews, names=NAMES, relied_on={LISTING})
    assert state == "RELIABILITY_UNRESOLVED"
    assert len(sentences) == 2
    assert "prepared by a person" in sentences[0]
    assert "does not show its source" in sentences[1]


@pytest.mark.parametrize("source", ["SYSTEM_RECORD", "DOCUMENT"])
@pytest.mark.parametrize("basis", ["NOT_A_REPORT", "SHOWN"])
def test_a_system_record_or_document_with_its_basis_shown_raises_nothing(
    source: Source, basis: ReportBasis
) -> None:
    reviews = [review(TICKET, source=source, report_basis=basis)]
    assert completeness_of(reviews, names=NAMES, relied_on={TICKET}) == ("COMPLETE", ())


def test_support_that_rests_on_a_file_no_review_describes_is_unresolved() -> None:
    state, sentences = completeness_of([review(TICKET)], names=NAMES, relied_on={LISTING})
    assert state == "RELIABILITY_UNRESOLVED"
    assert sentences == (
        "The source of access-listing.xlsx is not shown, so what it shows needs corroboration.",
    )


def test_the_worst_state_applies_and_every_sentence_is_kept() -> None:
    reviews = [
        review(SCREENSHOT, legibility="PARTLY_UNREADABLE"),
        review(LISTING, source="MANAGEMENT_PREPARED"),
    ]
    population = LeftOut("all-users.csv", "POPULATION", "It is a population.")
    scan = LeftOut("scan-0007.pdf", "UNREADABLE", "Nothing readable was extracted.")
    unresolved = (
        "access-listing.xlsx was prepared by a person, not produced by a system: what it "
        "shows needs corroboration."
    )
    # Rewritten after the independent review of 14 November 2026. Old expectation:
    # unreadable is worse than incomplete, which is worse than unresolved reliability. New,
    # as section 10.6 orders them: unresolved reliability is the worst, so a file left out
    # never hides it (it did, and an all-satisfied request then read as sufficient).
    assert completeness_of(
        reviews,
        names=NAMES,
        left_out=[population, scan],
        read_in_part=["change-log-2027.txt"],
        relied_on={LISTING},
    ) == (
        "RELIABILITY_UNRESOLVED",
        (
            "scan-0007.pdf could not be read: Nothing readable was extracted.",
            "role-screen.png is partly unreadable.",
            "all-users.csv was not part of the check: It is a population.",
            "change-log-2027.txt is long and was read only in part.",
            unresolved,
        ),
    )
    assert completeness_of(
        reviews[1:], names=NAMES, left_out=[population], relied_on={LISTING}
    ) == (
        "RELIABILITY_UNRESOLVED",
        ("all-users.csv was not part of the check: It is a population.", unresolved),
    )
    # With nothing resting on the listing, unreadable is worse than incomplete.
    assert completeness_of(reviews, names=NAMES, left_out=[population, scan])[0] == (
        "PARTLY_UNREADABLE"
    )
    assert completeness_of(reviews[1:], names=NAMES, left_out=[population])[0] == "INCOMPLETE"
    assert completeness_of(reviews[1:], names=NAMES, relied_on={LISTING}) == (
        "RELIABILITY_UNRESOLVED",
        (unresolved,),
    )


def test_a_file_with_no_name_is_still_a_sentence_and_a_name_is_cleaned() -> None:
    reviews = [
        review(TICKET, legibility="PARTLY_UNREADABLE"),
        review(LISTING, source="UNKNOWN"),
    ]
    names = {LISTING: "access\n listing.xlsx"}
    assert completeness_of(reviews, names=names, relied_on={LISTING}) == (
        "RELIABILITY_UNRESOLVED",
        (
            "A file is partly unreadable.",
            "The source of access listing.xlsx is not shown, so what it shows needs corroboration.",
        ),
    )
    assert completeness_of([review(TICKET, source="UNKNOWN")], names={}, relied_on={TICKET}) == (
        "RELIABILITY_UNRESOLVED",
        ("The source of a file is not shown, so what it shows needs corroboration.",),
    )


def test_the_same_sentence_is_said_once() -> None:
    left = [
        LeftOut("scan-0007.pdf", "UNREADABLE", "No text."),
        LeftOut("scan-0007.pdf", "UNREADABLE", "No text."),
    ]
    _state, sentences = completeness_of([], names={}, left_out=left)
    assert sentences == ("scan-0007.pdf could not be read: No text.",)


def test_custody_is_never_mentioned_as_reliability() -> None:
    """A file that passed its custody check is not thereby reliable, and none of the
    sentences this module writes says so."""
    reviews = [
        review(TICKET),
        review(LISTING, source="MANAGEMENT_PREPARED", report_basis="NOT_SHOWN"),
        review(SCREENSHOT, source="UNKNOWN", legibility="PARTLY_UNREADABLE"),
    ]
    _state, sentences = completeness_of(
        reviews,
        names=NAMES,
        left_out=[LeftOut("all-users.csv", "POPULATION", "It is a population.")],
        read_in_part=["change-log-2027.txt"],
        relied_on={TICKET, LISTING, SCREENSHOT},
    )
    assert sentences
    assert not any("custody" in sentence.lower() for sentence in sentences)


# --- overall_of ----------------------------------------------------------------------

A = AttributeLine("A", "SATISFIED")
B = AttributeLine("B", "SATISFIED")
POTENTIAL = "This is a potential exception for the auditor to investigate, not a conclusion."


def test_a_contradiction_shown_despite_an_unreadable_file_is_a_potential_exception() -> None:
    """Named case: the exception is not hidden by the file that could not be read, and it
    is proposed as potential, not concluded."""
    lines = [A, AttributeLine("C", "CONTRADICTED", "access was granted before the approval")]
    overall, explanation = overall_of(
        lines, completeness="PARTLY_UNREADABLE", follow_up_kinds=["EVIDENCE"], waiting_on_file=True
    )
    assert overall == "POTENTIAL_EXCEPTION"
    assert explanation == (
        "1 of 2 requested attributes is supported. C is contradicted by the records: access "
        f"was granted before the approval. {POTENTIAL}"
    )


@pytest.mark.parametrize("completeness", get_args(Completeness))
@pytest.mark.parametrize("kinds", [(), ("EVIDENCE",), ("CLARIFICATION",)])
@pytest.mark.parametrize("waiting", [False, True])
def test_a_contradicted_attribute_outweighs_everything_else(
    completeness: Completeness, kinds: tuple[str, ...], waiting: bool
) -> None:
    lines = [AttributeLine("B", "NOT_DEMONSTRATED"), AttributeLine("C", "CONTRADICTED"), A]
    overall, explanation = overall_of(
        lines, completeness=completeness, follow_up_kinds=kinds, waiting_on_file=waiting
    )
    assert overall == "POTENTIAL_EXCEPTION"
    assert explanation == (
        f"1 of 3 requested attributes is supported. C is contradicted by the records. {POTENTIAL}"
    )


def test_an_attribute_not_demonstrated_asks_for_additional_evidence() -> None:
    """Named case: missing evidence is a follow-up, never a failure."""
    assessment = assessment_of(verdict="ISSUE", result="NOT_MET", expected=True)
    assert assessment == "NOT_DEMONSTRATED"
    lines = [
        A,
        B,
        AttributeLine("C", assessment, "the provisioning record is not among the files"),
        AttributeLine("D", "SATISFIED"),
    ]
    overall, explanation = overall_of(lines, completeness="COMPLETE", follow_up_kinds=["EVIDENCE"])
    assert overall == "ADDITIONAL_EVIDENCE"
    assert explanation == (
        "3 of 4 requested attributes are supported. C is not demonstrated: the provisioning "
        "record is not among the files. 1 follow-up would resolve what is open."
    )
    assert "exception" not in explanation
    assert "contradicted" not in explanation


def test_sufficient_evidence_asks_for_nothing_more() -> None:
    """Named case: sufficient evidence, no follow-up."""
    lines = [A, B, AttributeLine("C", "SATISFIED"), AttributeLine("D", "SATISFIED")]
    assert overall_of(lines, completeness="COMPLETE", follow_up_kinds=[]) == (
        "SUFFICIENT",
        "All 4 requested attributes are supported. No further evidence is needed for this request.",
    )


@pytest.mark.parametrize(
    ("completeness", "said"),
    [
        ("INCOMPLETE", "A file was not read; what the read files show still stands."),
        # Its own sentence (the independent review of 14 November 2026): "a file was not
        # read" was said where every file was read and part of one could not be.
        (
            "PARTLY_UNREADABLE",
            "Part of the evidence could not be read; what was read still stands.",
        ),
    ],
)
def test_a_file_not_read_does_not_undo_what_the_read_files_show(
    completeness: Completeness, said: str
) -> None:
    overall, explanation = overall_of(
        [A, B], completeness=completeness, follow_up_kinds=[], waiting_on_file=True
    )
    assert overall == "SUFFICIENT"
    assert explanation == (
        "All 2 requested attributes are supported. No further evidence is needed for this "
        f"request. {said}"
    )


def test_unresolved_reliability_is_never_hidden_by_a_file_left_out() -> None:
    """The false pass the independent review reproduced: support rests on a file prepared
    by a person, and a population left out by the gate made the state INCOMPLETE and the
    outcome SUFFICIENT."""
    reviews = [review(LISTING, source="MANAGEMENT_PREPARED")]
    state, _reasons = completeness_of(
        reviews,
        names=NAMES,
        left_out=[LeftOut("all-users.csv", "POPULATION", "It is a population.")],
        relied_on={LISTING},
    )
    assert state == "RELIABILITY_UNRESOLVED"
    overall, explanation = overall_of([A, B], completeness=state, follow_up_kinds=[])
    assert overall == "ADDITIONAL_EVIDENCE"
    assert "No further evidence is needed" not in explanation


def test_support_that_rests_on_an_unreliable_report_needs_corroboration() -> None:
    """Named case (incomplete or unreliable IPE): every attribute is satisfied, and the
    report it rests on does not show its basis."""
    reviews = [review(LISTING, report_basis="NOT_SHOWN")]
    completeness, _sentences = completeness_of(reviews, names=NAMES, relied_on={LISTING})
    assert completeness == "RELIABILITY_UNRESOLVED"
    assert overall_of([A, B], completeness=completeness, follow_up_kinds=[]) == (
        "ADDITIONAL_EVIDENCE",
        "All 2 requested attributes are supported. What it rests on needs corroboration "
        "before it is relied on.",
    )
    # The same report with nothing resting on it: the evidence is sufficient.
    completeness, _sentences = completeness_of(reviews, names=NAMES)
    overall, _explanation = overall_of([A, B], completeness=completeness, follow_up_kinds=[])
    assert overall == "SUFFICIENT"


def test_a_file_waited_for_with_no_follow_up_cannot_be_concluded() -> None:
    lines = [A, AttributeLine("B", "INDETERMINATE", "it waits on scan-0007.pdf")]
    assert overall_of(
        lines, completeness="PARTLY_UNREADABLE", follow_up_kinds=[], waiting_on_file=True
    ) == (
        "UNABLE_TO_CONCLUDE",
        "1 of 2 requested attributes is supported. B could not be concluded: it waits on "
        "scan-0007.pdf. A file is still to be read before this can be concluded.",
    )


def test_a_follow_up_is_asked_even_while_a_file_is_waited_for() -> None:
    lines = [AttributeLine("A", "NOT_DEMONSTRATED"), AttributeLine("B", "INDETERMINATE")]
    overall, explanation = overall_of(
        lines,
        completeness="INCOMPLETE",
        follow_up_kinds=["EVIDENCE", "CLARIFICATION"],
        waiting_on_file=True,
    )
    assert overall == "ADDITIONAL_EVIDENCE"
    assert explanation == (
        "None of the 2 requested attributes is supported yet. A is not demonstrated. "
        "2 follow-ups would resolve what is open."
    )


def test_follow_ups_that_are_all_clarifications_ask_for_clarification_only() -> None:
    """Named case: clarification only."""
    lines = [A, AttributeLine("B", "PARTIALLY_SUPPORTED", "who approved it is not named")]
    assert overall_of(lines, completeness="COMPLETE", follow_up_kinds=["CLARIFICATION"]) == (
        "CLARIFICATION",
        "1 of 2 requested attributes is supported. B is shown only in part: who approved it "
        "is not named. 1 clarification would resolve what is open.",
    )
    overall, explanation = overall_of(
        lines, completeness="COMPLETE", follow_up_kinds=["CLARIFICATION", "CLARIFICATION"]
    )
    assert overall == "CLARIFICATION"
    assert explanation.endswith("2 clarifications would resolve what is open.")


@pytest.mark.parametrize(
    "kinds", [("EVIDENCE",), ("CLARIFICATION", "EVIDENCE"), ("EVIDENCE", "SOMETHING_ELSE")]
)
def test_any_follow_up_that_is_not_a_clarification_asks_for_evidence(
    kinds: tuple[str, ...],
) -> None:
    overall, explanation = overall_of(
        [AttributeLine("A", "NOT_DEMONSTRATED")], completeness="COMPLETE", follow_up_kinds=kinds
    )
    assert overall == "ADDITIONAL_EVIDENCE"
    noun = "follow-up" if len(kinds) == 1 else "follow-ups"
    assert explanation == (
        "The requested attribute is not supported yet. A is not demonstrated. "
        f"{len(kinds)} {noun} would resolve what is open."
    )


@pytest.mark.parametrize("assessment", ["INDETERMINATE", "NOT_DEMONSTRATED", "PARTIALLY_SUPPORTED"])
def test_nothing_to_ask_for_and_nothing_waited_for_is_unable_to_conclude(
    assessment: Assessment,
) -> None:
    """Named case: unable to conclude (the readings disagree, and no follow-up closes it)."""
    overall, explanation = overall_of(
        [A, AttributeLine("B", assessment)], completeness="COMPLETE", follow_up_kinds=[]
    )
    assert overall == "UNABLE_TO_CONCLUDE"
    assert explanation.startswith("1 of 2 requested attributes is supported. B ")
    assert explanation.endswith(" A person's judgment is needed to conclude.")


def test_a_request_that_names_no_attribute_has_nothing_to_conclude_on() -> None:
    nothing = "This request names no attribute to test, so there is nothing to conclude on."
    for completeness in get_args(Completeness):
        assert overall_of(
            [], completeness=completeness, follow_up_kinds=["EVIDENCE"], waiting_on_file=True
        ) == ("UNABLE_TO_CONCLUDE", nothing)
    assert overall_of([], completeness="COMPLETE", follow_up_kinds=[], context_thin=True) == (
        "UNABLE_TO_CONCLUDE",
        f"{nothing} {CONTEXT_THIN}",
    )


@pytest.mark.parametrize(
    ("assessments", "sentence"),
    [
        (("SATISFIED",), "The requested attribute is supported."),
        (("INDETERMINATE",), "The requested attribute is not supported yet."),
        (("SATISFIED", "SATISFIED"), "All 2 requested attributes are supported."),
        (("SATISFIED", "INDETERMINATE"), "1 of 2 requested attributes is supported."),
        (
            ("SATISFIED", "SATISFIED", "INDETERMINATE"),
            "2 of 3 requested attributes are supported.",
        ),
        (
            ("INDETERMINATE", "PARTIALLY_SUPPORTED"),
            "None of the 2 requested attributes is supported yet.",
        ),
    ],
)
def test_the_count_is_said_in_the_right_number(
    assessments: tuple[Assessment, ...], sentence: str
) -> None:
    lines = [AttributeLine(f"A{index}", assessment) for index, assessment in enumerate(assessments)]
    _overall, explanation = overall_of(lines, completeness="COMPLETE", follow_up_kinds=[])
    assert explanation.startswith(f"{sentence} ")


def test_only_a_satisfied_attribute_counts_as_supported() -> None:
    lines = [A, AttributeLine("B", "PARTIALLY_SUPPORTED"), AttributeLine("C", "NOT_DEMONSTRATED")]
    _overall, explanation = overall_of(lines, completeness="COMPLETE", follow_up_kinds=[])
    assert explanation.startswith("1 of 3 requested attributes is supported. ")


def test_the_explanation_names_the_first_line_of_the_most_serious_kind() -> None:
    lines = [
        AttributeLine("A", "INDETERMINATE", "the readings disagree"),
        AttributeLine("B", "PARTIALLY_SUPPORTED", "the date is not shown"),
        AttributeLine("C", "NOT_DEMONSTRATED", "no approval is among the files."),
        AttributeLine("D", "NOT_DEMONSTRATED", "no review is among the files"),
        AttributeLine("E", "CONTRADICTED", "the approver is the requester"),
    ]

    def named(upto: int) -> str:
        _overall, explanation = overall_of(
            lines[:upto], completeness="COMPLETE", follow_up_kinds=["EVIDENCE"]
        )
        return explanation

    assert "A could not be concluded: the readings disagree. " in named(1)
    assert "B is shown only in part: the date is not shown. " in named(2)
    # The note's own full stop is not doubled, and the first of two of a kind is named.
    assert "C is not demonstrated: no approval is among the files. " in named(4)
    assert "E is contradicted by the records: the approver is the requester. " in named(5)
    for upto in range(1, 6):
        assert ".." not in named(upto)


def test_a_line_without_a_note_is_named_without_a_colon() -> None:
    for assessment, words in (
        ("CONTRADICTED", "C is contradicted by the records."),
        ("NOT_DEMONSTRATED", "C is not demonstrated."),
        ("PARTIALLY_SUPPORTED", "C is shown only in part."),
        ("INDETERMINATE", "C could not be concluded."),
    ):
        _overall, explanation = overall_of(
            [AttributeLine("C", assessment)],  # type: ignore[arg-type]
            completeness="COMPLETE",
            follow_up_kinds=[],
        )
        assert f" {words} " in explanation
        assert ":" not in explanation


def test_a_note_is_cleaned_before_it_is_written() -> None:
    line = AttributeLine("C\n", "NOT_DEMONSTRATED", "the record\r\n is​ not among the files. ")
    _overall, explanation = overall_of([line], completeness="COMPLETE", follow_up_kinds=[])
    assert "C is not demonstrated: the record is not among the files. " in explanation


SCENARIOS: tuple[
    tuple[tuple[Assessment, ...], Completeness, tuple[str, ...], bool, Overall], ...
] = (
    (("SATISFIED", "CONTRADICTED"), "PARTLY_UNREADABLE", (), True, "POTENTIAL_EXCEPTION"),
    (("SATISFIED", "SATISFIED"), "COMPLETE", (), False, "SUFFICIENT"),
    (("SATISFIED", "SATISFIED"), "INCOMPLETE", (), True, "SUFFICIENT"),
    (("SATISFIED", "SATISFIED"), "RELIABILITY_UNRESOLVED", (), False, "ADDITIONAL_EVIDENCE"),
    (("SATISFIED", "NOT_DEMONSTRATED"), "COMPLETE", ("EVIDENCE",), False, "ADDITIONAL_EVIDENCE"),
    (("SATISFIED", "PARTIALLY_SUPPORTED"), "COMPLETE", ("CLARIFICATION",), False, "CLARIFICATION"),
    (("SATISFIED", "INDETERMINATE"), "INCOMPLETE", (), True, "UNABLE_TO_CONCLUDE"),
    (("SATISFIED", "INDETERMINATE"), "COMPLETE", (), False, "UNABLE_TO_CONCLUDE"),
)


@pytest.mark.parametrize(("assessments", "completeness", "kinds", "waiting", "expected"), SCENARIOS)
def test_a_thin_understanding_is_said_as_one_more_sentence_on_any_outcome(
    assessments: tuple[Assessment, ...],
    completeness: Completeness,
    kinds: tuple[str, ...],
    waiting: bool,
    expected: Overall,
) -> None:
    """Named case: the control's understanding is not confirmed yet."""
    lines = [
        AttributeLine(f"A{index}", assessment, "" if assessment == "SATISFIED" else "it is open")
        for index, assessment in enumerate(assessments)
    ]
    overall, explanation = overall_of(
        lines, completeness=completeness, follow_up_kinds=kinds, waiting_on_file=waiting
    )
    thin_overall, thin = overall_of(
        lines,
        completeness=completeness,
        follow_up_kinds=kinds,
        waiting_on_file=waiting,
        context_thin=True,
    )
    assert overall == thin_overall == expected
    # The outcome and what is said of it do not change; one sentence is added.
    assert thin == f"{explanation} {CONTEXT_THIN}"
    assert CONTEXT_THIN not in explanation
    assert CONTEXT_THIN == (
        "The control's understanding is not confirmed yet, so the evidence was judged "
        "against the attributes alone."
    )
    # At most three sentences without it. A semicolon joins the two halves of the
    # sentence about a file not read.
    assert explanation.count(". ") + 1 <= 3
    assert explanation.endswith(".")


def test_every_outcome_is_in_the_vocabulary_and_no_sentence_names_the_client() -> None:
    outcomes: set[str] = set()
    for assessments, completeness, kinds, waiting, thin in product(
        product(get_args(Assessment), repeat=2),
        get_args(Completeness),
        ((), ("EVIDENCE",), ("CLARIFICATION",)),
        (False, True),
        (False, True),
    ):
        lines = [
            AttributeLine(code, assessment)
            for code, assessment in zip(("A", "B"), assessments, strict=True)
        ]
        overall, explanation = overall_of(
            lines,
            completeness=completeness,
            follow_up_kinds=kinds,
            waiting_on_file=waiting,
            context_thin=thin,
        )
        outcomes.add(overall)
        assert "client" not in explanation.lower()
        # A contradiction always surfaces, and nothing else is ever called an exception.
        contradicted = "CONTRADICTED" in assessments
        assert (overall == "POTENTIAL_EXCEPTION") == contradicted
        assert ("exception" in explanation) == contradicted
        # Sufficient only when every asked attribute is satisfied.
        if overall == "SUFFICIENT":
            assert set(assessments) == {"SATISFIED"}
            assert completeness != "RELIABILITY_UNRESOLVED"
    assert outcomes == set(get_args(Overall))
