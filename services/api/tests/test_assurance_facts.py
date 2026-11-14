"""Facts and comparisons made in code (docs/evidence-assurance.md, sections 10.4 and 10.5).

Audit integrity: an objective comparison is made by code on the values the records state,
never by a model, and never on a guess.

- a date is read only when it is certain: 03/04/2027 is not compared, 13/04/2027 is
  13 April, a two-digit year is refused, a time is taken only next to its date;
- an order is told from times only when both show one on the same footing; the same day
  with a time missing is not put in an order (and is still "not after");
- initials and partial names never make two people the same, nor different;
- a value that is not in its quote, or a date its reading rewrote, is not compared;
- a comparison failing on both readings alike is FAILED whatever else is known; failing
  on one, or on values that disagree, is FAILED_ONE; a pass supports nothing by itself;
- code's own concerns come only from facts both readings state alike.

Pure: synthetic names and files, no database, no model.
"""

from __future__ import annotations

import ast
from datetime import date, time, timedelta
from pathlib import Path
from uuid import UUID

import pytest

from ai_workforce_api import assurance_facts
from ai_workforce_api.assurance_facts import (
    CHECK_TESTS,
    FACT_KINDS,
    CheckAsk,
    CheckRun,
    CheckTest,
    Fact,
    FactKind,
    When,
    ambiguous_date,
    compare_values,
    concerns,
    date_text,
    different_value,
    fact_stands,
    parse_when,
    reconcile_checks,
    run_check,
    run_checks,
    same_value,
    value_in_quote,
    when_text,
)

TICKET = UUID(int=1)
LOG = UUID(int=2)
EXPORT = UUID(int=3)
NAMES = {TICKET: "ticket.png", LOG: "disable-log.png", EXPORT: "access-export.png"}
PERIOD = (date(2027, 1, 1), date(2027, 12, 31))
NO_PERIOD: tuple[date | None, date | None] = (None, None)


def fact(
    fact_id: str,
    kind: FactKind,
    value: str,
    *,
    quote: str | None = None,
    file_id: UUID = TICKET,
) -> Fact:
    text = f"Recorded: {value}" if quote is None else quote
    return Fact(fact_id, kind, value, file_id, text, 0, len(text))


def table(*facts: Fact) -> dict[str, Fact]:
    return {item.id: item for item in facts}


def ask(
    test: CheckTest,
    left: str = "F1",
    right: str = "F2",
    *,
    days: int | None = None,
    attribute: str = "C",
    element: str = "pass",
) -> CheckAsk:
    return CheckAsk(attribute, element, test, left, right, days)


def order(test: CheckTest, approved: str, performed: str, *, days: int | None = None) -> CheckRun:
    facts = table(fact("F1", "APPROVED_AT", approved), fact("F2", "PERFORMED_AT", performed))
    return run_check(ask(test, days=days), facts, PERIOD)


def match(
    test: CheckTest, left: str, right: str, kinds: tuple[FactKind, FactKind] | None = None
) -> CheckRun:
    left_kind, right_kind = kinds or ("APPROVER", "PERFORMER")
    facts = table(fact("F1", left_kind, left), fact("F2", right_kind, right))
    return run_check(ask(test), facts, PERIOD)


def run(status: str, left: str, right: str, *, test: CheckTest = "NOT_AFTER") -> CheckRun:
    """A reading's run of the approval-before-performance comparison, made by the code."""
    made = order(test, left, right)
    assert made.status == status
    return made


# --------------------------------------------------------------------------------------
# The interface
# --------------------------------------------------------------------------------------


def test_the_kinds_and_tests_are_the_contracts() -> None:
    assert FACT_KINDS == (
        "SUBJECT",
        "REFERENCE",
        "REQUESTED",
        "PERFORMED",
        "APPROVER",
        "PERFORMER",
        "APPROVED_AT",
        "PERFORMED_AT",
        "TRIGGER_AT",
        "SYSTEM",
        "EXTRACTED_AT",
        "PERIOD_FROM",
        "PERIOD_TO",
        "VALUE",
    )
    assert CHECK_TESTS == ("NOT_AFTER", "BEFORE", "SAME", "DIFFERENT", "WITHIN_DAYS", "IN_PERIOD")


def test_the_module_is_pure() -> None:
    """No database, no network, no model, and nothing of the chain that imports it."""
    source = Path(assurance_facts.__file__).read_text(encoding="utf-8")
    imported: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
    assert imported == {
        "__future__",
        "re",
        "unicodedata",
        "collections.abc",
        "dataclasses",
        "datetime",
        "decimal",
        "typing",
        "uuid",
        "ai_workforce_api.inbound",
    }


# --------------------------------------------------------------------------------------
# Rule 1: dates and times
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        "2027-01-10",
        "2027/01/10",
        "10 Jan 2027",
        "10 January 2027",
        "10-Jan-2027",
        "January 10, 2027",
        "Jan 10, 2027",
        "10th of January, 2027",
        "Monday, January 10, 2027",
    ],
)
def test_a_date_is_read_in_each_accepted_form(value: str) -> None:
    assert parse_when(value) == When(date(2027, 1, 10))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2027-01-10 16:20:05", When(date(2027, 1, 10), time(16, 20, 5), to_second=True)),
        ("2027-01-10T16:20:05Z", When(date(2027, 1, 10), time(16, 20, 5), timedelta(0), "", True)),
        (
            "2027-01-10T16:20:05+08:00",
            When(date(2027, 1, 10), time(16, 20, 5), timedelta(hours=8), "", True),
        ),
        (
            "2027-01-10 16:20:05 +0800",
            When(date(2027, 1, 10), time(16, 20, 5), timedelta(hours=8), "", True),
        ),
        (
            "2027-01-10T09:00-05:00",
            When(date(2027, 1, 10), time(9, 0), timedelta(hours=-5)),
        ),
        ("Jan 10, 2027 4:20 PM", When(date(2027, 1, 10), time(16, 20))),
        ("10 Jan 2027 12:15 AM", When(date(2027, 1, 10), time(0, 15))),
        ("10 Jan 2027 12:15 pm", When(date(2027, 1, 10), time(12, 15))),
        ("10 Jan 2027, 16:20 UTC", When(date(2027, 1, 10), time(16, 20), timedelta(0))),
        ("10 Jan 2027 16:20 UTC+8", When(date(2027, 1, 10), time(16, 20), timedelta(hours=8))),
        ("10:04:22 11-Jan-2027", When(date(2027, 1, 11), time(10, 4, 22), to_second=True)),
        ("Monday, January 10, 2027 at 4:20 p.m.", When(date(2027, 1, 10), time(16, 20))),
    ],
)
def test_a_time_is_read_with_its_offset_when_written_by_the_date(
    value: str, expected: When
) -> None:
    assert parse_when(value) == expected


def test_a_numeric_date_that_reads_two_ways_is_not_read() -> None:
    for value in ("03/04/2027", "10/01/2027", "01-10-2027", "3.4.2027"):
        assert parse_when(value) is None
        assert ambiguous_date(value) == value


def test_a_numeric_date_with_one_reading_is_read() -> None:
    assert parse_when("13/04/2027") == When(date(2027, 4, 13))
    assert parse_when("04/13/2027") == When(date(2027, 4, 13))
    # Day and month equal: either reading is the same date.
    assert parse_when("05/05/2027") == When(date(2027, 5, 5))
    assert ambiguous_date("13/04/2027") is None


@pytest.mark.parametrize(
    "value",
    [
        "10/01/27",  # a two-digit year is refused
        "10 Jan 27",
        "10 Jan",  # a year is never guessed
        "Jan 2027",  # nor a day
        "2027",
        "31 Feb 2027",  # not a date
        "2027-13-01",  # year, day, month is not guessed
        "10 Jan 2027 - 12 Jan 2027",  # two dates
        "2027-01-10/2027-01-12",  # a range
        "10/01/27 and 2027-01-11",  # a refused date beside a readable one
        "CHG-2027-01-10",  # part of a reference
        "last Tuesday",
        "",
    ],
)
def test_what_is_not_one_certain_date_is_not_read(value: str) -> None:
    assert parse_when(value) is None
    assert ambiguous_date(value) is None


def test_a_date_is_read_from_the_words_around_it() -> None:
    assert parse_when("Approved on 11 Jan 2027 by J. Cruz") == When(date(2027, 1, 11))


def test_a_time_away_from_the_date_is_not_taken() -> None:
    assert parse_when("Approved on 11 Jan 2027 by J. Cruz at 10:04") == When(date(2027, 1, 11))


def test_a_time_that_cannot_be_read_is_left_out() -> None:
    assert parse_when("10 Jan 2027 25:00") == When(date(2027, 1, 10))
    assert parse_when("10 Jan 2027 16:20 PM") == When(date(2027, 1, 10))
    # A window is not the time of the event; "-10:30" is not taken for a UTC offset.
    assert parse_when("10 Jan 2027 09:00-10:30") == When(date(2027, 1, 10))
    assert parse_when("2027-01-10 09:00-10:30") == When(date(2027, 1, 10))
    # A time on each side of the date: which is meant would be a guess.
    assert parse_when("09:00 10 Jan 2027 17:00") == When(date(2027, 1, 10))


def test_a_zone_abbreviation_is_kept_and_never_resolved() -> None:
    assert parse_when("10 Jan 2027 16:20 PST") == When(date(2027, 1, 10), time(16, 20), None, "PST")
    assert parse_when("10 Jan 2027 16:20 by J. Cruz") == When(date(2027, 1, 10), time(16, 20))


def test_dates_are_written_in_plain_words() -> None:
    assert date_text(date(2027, 1, 1)) == "1 January 2027"
    assert when_text(When(date(2027, 1, 11))) == "11 January 2027"
    assert when_text(When(date(2027, 1, 11), time(10, 4))) == "11 January 2027 10:04"
    assert when_text(When(date(2027, 1, 11), time(10, 4, 22))) == "11 January 2027 10:04:22"
    assert (
        when_text(When(date(2027, 1, 11), time(10, 4), timedelta(0))) == "11 January 2027 10:04 UTC"
    )
    assert (
        when_text(When(date(2027, 1, 11), time(10, 4), timedelta(hours=-5, minutes=-30)))
        == "11 January 2027 10:04 UTC-05:30"
    )
    assert when_text(When(date(2027, 1, 11), time(10, 4), None, "PST")) == (
        "11 January 2027 10:04 PST"
    )


# --------------------------------------------------------------------------------------
# Rule 2: order
# --------------------------------------------------------------------------------------


def test_approval_before_provisioning_passes() -> None:
    made = order("NOT_AFTER", "9 Jan 2027", "10 Jan 2027")
    assert made.status == "PASS"
    assert made.sentence == "Approved 9 January 2027, performed 10 January 2027: in order."
    assert order("BEFORE", "9 Jan 2027", "10 Jan 2027").status == "PASS"


def test_approval_after_provisioning_fails_with_the_values() -> None:
    made = order("NOT_AFTER", "11 Jan 2027", "2027-01-10")
    assert made.status == "FAIL"
    assert made.sentence == (
        "Approved 11 January 2027, performed 10 January 2027: the approval is after."
    )
    assert made.left is not None and made.left.id == "F1"
    assert made.right is not None and made.right.id == "F2"
    assert (made.attribute, made.element, made.test) == ("C", "pass", "NOT_AFTER")
    assert order("BEFORE", "11 Jan 2027", "2027-01-10").status == "FAIL"


def test_the_same_day_without_times_is_not_ordered_but_is_not_after() -> None:
    before = order("BEFORE", "10 Jan 2027", "2027-01-10")
    assert before.status == "NOT_RUN"
    assert before.sentence == (
        "Both are dated 10 January 2027 and a time is not shown for one, "
        "so the order cannot be told."
    )
    not_after = order("NOT_AFTER", "10 Jan 2027", "2027-01-10")
    assert not_after.status == "PASS"
    assert not_after.sentence == (
        "Approved 10 January 2027, performed 10 January 2027: the same day."
    )


def test_the_same_day_with_one_time_missing_is_not_ordered() -> None:
    assert order("BEFORE", "10 Jan 2027 09:00", "10 Jan 2027").status == "NOT_RUN"
    assert order("BEFORE", "10 Jan 2027", "10 Jan 2027 09:00").status == "NOT_RUN"
    assert order("NOT_AFTER", "10 Jan 2027 23:59", "10 Jan 2027").status == "PASS"


def test_the_same_day_is_ordered_by_its_times() -> None:
    late = order("NOT_AFTER", "10 Jan 2027 16:20", "10 Jan 2027 10:04")
    assert late.status == "FAIL"
    assert late.sentence == (
        "Approved 10 January 2027 16:20, performed 10 January 2027 10:04: the approval is after."
    )
    assert order("NOT_AFTER", "10 Jan 2027 10:04", "10 Jan 2027 16:20").status == "PASS"
    assert order("BEFORE", "10 Jan 2027 10:04", "10 Jan 2027 16:20").status == "PASS"


def test_the_same_time_is_not_after_and_is_not_put_in_an_order() -> None:
    not_after = order("NOT_AFTER", "10 Jan 2027 10:04", "10 Jan 2027 10:04")
    assert not_after.status == "PASS"
    assert not_after.sentence == (
        "Approved 10 January 2027 10:04, performed 10 January 2027 10:04: at the same time."
    )
    # Which came first within the minute, or the second, the records do not show.
    same = order("BEFORE", "10 Jan 2027 10:04", "10 Jan 2027 10:04")
    assert same.status == "NOT_RUN"
    assert same.sentence == (
        "Approved 10 January 2027 10:04, performed 10 January 2027 10:04: "
        "at the same time, so the order cannot be told."
    )
    assert order("BEFORE", "2027-01-10 10:04:05", "2027-01-10 10:04:05").status == "NOT_RUN"


def test_a_time_written_to_the_minute_stands_for_the_whole_minute() -> None:
    # 10:04:30 is not shown to be after "10:04", which may be any second of that minute.
    assert order("NOT_AFTER", "2027-01-10 10:04:30", "10 Jan 2027 10:04").status == "PASS"
    assert order("BEFORE", "10 Jan 2027 10:04", "2027-01-10 10:04:30").status == "NOT_RUN"
    assert order("NOT_AFTER", "2027-01-10 10:05:00", "10 Jan 2027 10:04").status == "FAIL"
    # Both written to the second: the seconds decide.
    late = order("NOT_AFTER", "2027-01-10 10:04:30", "2027-01-10 10:04:05")
    assert late.status == "FAIL"
    assert late.sentence == (
        "Approved 10 January 2027 10:04:30, performed 10 January 2027 10:04:05: "
        "the approval is after."
    )
    assert order("BEFORE", "2027-01-10 10:04:05", "2027-01-10 10:04:30").status == "PASS"
    assert order("BEFORE", "2027-01-10T10:04:05Z", "2027-01-10T10:04:05.250Z").status == "PASS"


def test_different_dates_decide_whatever_the_times() -> None:
    assert order("BEFORE", "9 Jan 2027 23:00", "10 Jan 2027").status == "PASS"
    assert order("BEFORE", "9 Jan 2027", "10 Jan 2027 01:00").status == "PASS"
    assert order("NOT_AFTER", "11 Jan 2027", "10 Jan 2027 23:00").status == "FAIL"


def test_times_with_offsets_are_compared_in_utc() -> None:
    # 23:30 at UTC+8 is 15:30 UTC: before 16:00 UTC, though the clock reads later.
    made = order("BEFORE", "2027-01-10T23:30:00+08:00", "2027-01-10T16:00:00Z")
    assert made.status == "PASS"
    assert made.sentence == (
        "Approved 10 January 2027 23:30 UTC+08:00, performed 10 January 2027 16:00 UTC: in order."
    )
    # 09:00 at UTC-5 is 14:00 UTC: after 13:00 UTC, though the clock reads earlier.
    assert order("NOT_AFTER", "2027-01-10T09:00:00-05:00", "2027-01-10T13:00:00Z").status == (
        "FAIL"
    )
    # The instants decide across midnight too: 01:00 on the 11th at UTC+8 is 17:00 UTC on the 10th.
    assert order("BEFORE", "2027-01-11T01:00:00+08:00", "2027-01-10T18:00:00Z").status == "PASS"


def test_a_time_with_an_offset_is_not_ordered_against_one_without() -> None:
    mixed = order("BEFORE", "2027-01-10T09:00:00Z", "2027-01-10 10:00:00")
    assert mixed.status == "NOT_RUN"
    assert mixed.sentence == (
        "Both are dated 10 January 2027 and their times are not shown in the same time zone, "
        "so the order cannot be told."
    )
    assert order("NOT_AFTER", "2027-01-10T09:00:00Z", "2027-01-10 10:00:00").status == "PASS"
    # On different dates the date decides.
    assert order("BEFORE", "2027-01-09T09:00:00Z", "2027-01-10 10:00:00").status == "PASS"


def test_times_in_zones_that_are_not_resolved_are_ordered_only_within_one_zone() -> None:
    assert order("BEFORE", "10 Jan 2027 09:00 PST", "10 Jan 2027 10:00 EST").status == "NOT_RUN"
    assert order("BEFORE", "10 Jan 2027 09:00 PST", "10 Jan 2027 10:00").status == "NOT_RUN"
    assert order("BEFORE", "10 Jan 2027 09:00 PST", "10 Jan 2027 10:00 PST").status == "PASS"


def test_an_ambiguous_date_is_not_compared() -> None:
    for test in ("NOT_AFTER", "BEFORE", "WITHIN_DAYS"):
        made = order(test, "03/04/2027", "10 Apr 2027", days=30)
        assert made.status == "NOT_RUN"
        assert made.sentence == "The date 03/04/2027 can be read two ways, so it is not compared."
    assert order("NOT_AFTER", "1 Mar 2027", "03/04/2027").status == "NOT_RUN"
    assert order("NOT_AFTER", "13/04/2027", "14 Apr 2027").status == "PASS"


def test_a_date_that_cannot_be_read_is_not_compared() -> None:
    made = order("NOT_AFTER", "last Tuesday", "10 Jan 2027")
    assert made.status == "NOT_RUN"
    assert made.sentence == (
        "The approval date (last Tuesday) is not a date that can be read, so it is not compared."
    )
    assert order("NOT_AFTER", "10/01/27", "10 Jan 2027").status == "NOT_RUN"


def test_within_days_counts_calendar_days() -> None:
    def within(trigger: str, performed: str, days: int | None) -> CheckRun:
        facts = table(fact("F1", "TRIGGER_AT", trigger), fact("F2", "PERFORMED_AT", performed))
        return run_check(ask("WITHIN_DAYS", days=days), facts, PERIOD)

    next_day = within("5 Jan 2027", "6 Jan 2027", 1)
    assert next_day.status == "PASS"
    assert next_day.sentence == (
        "Trigger date 5 January 2027, performed 6 January 2027: "
        "1 day apart, within the 1 day allowed."
    )
    same_day = within("5 Jan 2027", "5 Jan 2027", 1)
    assert same_day.status == "PASS"
    assert same_day.sentence.endswith("the same day, within the 1 day allowed.")
    # The same day answers it whatever the times: calendar days, by the dates as written.
    assert within("5 Jan 2027 17:00", "5 Jan 2027 09:00", 0).status == "PASS"
    assert within("5 Jan 2027", "5 Jan 2027", 0).status == "PASS"

    late = within("5 Jan 2027", "8 Jan 2027", 2)
    assert late.status == "FAIL"
    assert late.sentence == (
        "Trigger date 5 January 2027, performed 8 January 2027: "
        "3 days apart, more than the 2 days allowed."
    )
    # A Friday to the Monday after is three calendar days: business days are not counted.
    assert date(2027, 1, 8).weekday() == 4
    assert within("8 Jan 2027", "11 Jan 2027", 1).status == "FAIL"

    earlier = within("5 Jan 2027", "4 Jan 2027", 1)
    assert earlier.status == "FAIL"
    assert earlier.sentence == (
        "Trigger date 5 January 2027, performed 4 January 2027: "
        "the second date is earlier than the first."
    )

    unsaid = within("5 Jan 2027", "6 Jan 2027", None)
    assert unsaid.status == "NOT_RUN"
    assert unsaid.sentence == (
        "The comparison does not say how many days are allowed, so it is not made."
    )
    assert within("5 Jan 2027", "6 Jan 2027", -1).status == "NOT_RUN"


def test_in_period_is_told_by_the_date() -> None:
    def in_period(value: str, period: tuple[date | None, date | None] = PERIOD) -> CheckRun:
        return run_check(
            ask("IN_PERIOD", right=""), table(fact("F1", "PERFORMED_AT", value)), period
        )

    inside = in_period("10 Jan 2027 23:59")
    assert inside.status == "PASS"
    assert inside.sentence == (
        "Performed 10 January 2027 23:59: within the audit period "
        "(1 January 2027 to 31 December 2027)."
    )
    assert inside.right is None
    assert in_period("1 Jan 2027").status == "PASS"
    assert in_period("31 Dec 2027").status == "PASS"

    outside = in_period("3 March 2028")
    assert outside.status == "FAIL"
    assert outside.sentence == (
        "Performed 3 March 2028: outside the audit period (1 January 2027 to 31 December 2027)."
    )
    assert in_period("31 Dec 2026").status == "FAIL"

    for period in ((None, date(2027, 12, 31)), (date(2027, 1, 1), None), NO_PERIOD):
        unset = in_period("10 Jan 2027", period)
        assert unset.status == "NOT_RUN"
        assert unset.sentence == (
            "The audit period is not set, so the date performed is not compared with it."
        )
    # A period that ends before it starts is not a period to hold a date against.
    assert in_period("10 Jan 2027", (date(2027, 12, 31), date(2027, 1, 1))).status == "NOT_RUN"
    assert in_period("03/04/2027").status == "NOT_RUN"


def test_in_period_needs_no_second_fact() -> None:
    facts = table(fact("F1", "APPROVED_AT", "10 Jan 2027"))
    assert run_check(ask("IN_PERIOD", "F1", "F9"), facts, PERIOD).status == "PASS"


# --------------------------------------------------------------------------------------
# Rule 3: the same, different, or not matched
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("one", "other"),
    [
        ("Jordan Reyes", "jordan  REYES"),
        ("Reyes, Jordan", "Jordan Reyes"),
        ("Reyes, Jordan A.", "Jordan A Reyes"),
        ("jreyes@corp.example", "jreyes"),
        ("JREYES", "jreyes@corp.example"),
        ("CORP\\jreyes", "jreyes"),
        ("CHG-0012345", "chg 0012345"),
        ("O'Brien", "OBrien"),
        ("SAP_FI_DISPLAY", "SAP FI Display"),
        ("1,000", "1000"),
    ],
)
def test_values_that_are_the_same(one: str, other: str) -> None:
    assert compare_values(one, other) == "SAME"
    assert same_value(one, other) and same_value(other, one)
    assert not different_value(one, other)


@pytest.mark.parametrize(
    ("one", "other"),
    [
        ("J. Reyes", "Jordan Reyes"),  # an initial
        ("Reyes, J.", "Jordan Reyes"),
        ("Reyes", "Jordan Reyes"),  # a partial name
        ("Jordan Reyes", "Jordan A. Reyes"),
        ("Jordan Reyes", "Jordan Reyes-Santiago"),
        ("jreyes", "Jordan Reyes"),  # a user id made from a name
        ("JR", "Jordan Reyes"),
        ("Reyes Jordan", "Jordan Reyes"),  # no comma: which is the surname is not shown
        ("jreyes@corp.example", "jreyes@other.example"),  # one id under two domains
        ("AP Clerk", "Accounts Payable Clerk"),  # an abbreviation
        ("Admin", "SAP Admin"),  # an extra word
        ("8", "08"),
        ("", "Jordan Reyes"),
    ],
)
def test_values_that_are_neither_the_same_nor_provably_different(one: str, other: str) -> None:
    assert compare_values(one, other) == "UNSURE"
    assert compare_values(other, one) == "UNSURE"
    assert not same_value(one, other)
    assert not different_value(one, other)


@pytest.mark.parametrize(
    ("one", "other"),
    [
        ("Jordan Reyes", "Jordan Lee"),  # different surnames are different
        ("Jordan Reyes", "Dana Lee"),
        ("Jordan Reyes", "Dana Reyes"),
        ("J. Reyes", "D. Reyes"),
        ("dlee", "Jordan Reyes"),
        ("jreyes@corp.example", "dlee@corp.example"),
        ("CHG0012345", "CHG0012346"),
        ("Display role", "Admin role"),
        ("1.5", "15"),  # a decimal point is not punctuation
        ("8 16", "816"),  # two numbers are not one
    ],
)
def test_values_that_are_provably_different(one: str, other: str) -> None:
    assert compare_values(one, other) == "DIFFERENT"
    assert different_value(one, other) and different_value(other, one)
    assert not same_value(one, other)


@pytest.mark.parametrize(
    ("one", "other", "expected"),
    [
        ("Workday", "Workday HCM", "SAME"),
        ("workday", "WORKDAY", "SAME"),
        ("Workday", "Workday Production", "SAME"),
        ("SAP ERP", "Workday", "DIFFERENT"),
        ("SAP ERP", "Oracle ERP", "DIFFERENT"),  # "ERP" names no system
        ("ERP", "SAP ERP", "UNSURE"),
        ("SAP ECC", "SAP S/4HANA", "UNSURE"),  # a shared name: not provably different
        ("WD", "Workday", "UNSURE"),  # could be its abbreviation
        ("AD", "Active Directory", "UNSURE"),
    ],
)
def test_system_names(one: str, other: str, expected: str) -> None:
    assert compare_values(one, other, system=True) == expected
    assert compare_values(other, one, system=True) == expected


def test_a_crafted_value_is_left_unmatched_without_a_long_search() -> None:
    """The values are a model's words: the search for a short form is bounded."""
    assert compare_values("a" * 24, " ".join(["a" * 12] * 10)) == "UNSURE"
    assert compare_values(" ".join(["ab" * 6] * 9), " ".join(["ab" * 7] * 10)) == "UNSURE"
    assert compare_values("a b " * 5000, "c d " * 5000) == "DIFFERENT"


def test_a_last_first_name_is_the_same_person() -> None:
    made = match("SAME", "Reyes, Jordan", "Jordan Reyes")
    assert made.status == "PASS"
    assert made.sentence == 'Approver "Reyes, Jordan", performer Jordan Reyes: the same.'
    assert match("DIFFERENT", "Reyes, Jordan", "Jordan Reyes").status == "FAIL"


def test_initials_never_match_and_never_differ() -> None:
    same = match("SAME", "J. Reyes", "Jordan Reyes")
    assert same.status == "NOT_RUN"
    assert same.sentence == (
        "Approver J. Reyes, performer Jordan Reyes: these cannot be matched with certainty."
    )
    different = match("DIFFERENT", "J. Reyes", "Jordan Reyes")
    assert different.status == "NOT_RUN"
    assert different.sentence == (
        "Approver J. Reyes, performer Jordan Reyes: these cannot be told apart with certainty."
    )


def test_different_surnames_are_different() -> None:
    different = match("DIFFERENT", "Jordan Reyes", "Dana Lee")
    assert different.status == "PASS"
    assert different.sentence == "Approver Jordan Reyes, performer Dana Lee: different."
    same = match("SAME", "Jordan Reyes", "Jordan Lee")
    assert same.status == "FAIL"
    assert same.sentence == "Approver Jordan Reyes, performer Jordan Lee: not the same."


def test_the_approver_who_is_the_performer_fails_a_different_check() -> None:
    made = match("DIFFERENT", "jreyes@corp.example", "JREYES")
    assert made.status == "FAIL"
    assert made.sentence == "Approver jreyes@corp.example, performer JREYES: the same."


def test_what_was_done_is_set_against_what_was_asked_for() -> None:
    kinds: tuple[FactKind, FactKind] = ("REQUESTED", "PERFORMED")
    assert match("SAME", "SAP_FI_DISPLAY", "SAP FI Display", kinds).status == "PASS"
    differs = match("SAME", "Display role", "Admin role", kinds)
    assert differs.status == "FAIL"
    assert differs.sentence == "Asked for Display role, done Admin role: not the same."


def test_two_systems_are_matched_as_systems() -> None:
    kinds: tuple[FactKind, FactKind] = ("SYSTEM", "SYSTEM")
    assert match("SAME", "Workday", "Workday HCM", kinds).status == "PASS"
    assert match("SAME", "Workday", "SAP ERP", kinds).status == "FAIL"
    # Not systems: an extra word leaves the two unmatched.
    assert match("SAME", "Workday", "Workday HCM", ("VALUE", "VALUE")).status == "NOT_RUN"


def test_two_dates_are_the_same_by_their_day() -> None:
    kinds: tuple[FactKind, FactKind] = ("EXTRACTED_AT", "PERIOD_TO")
    same = match("SAME", "2027-12-31", "31 December 2027", kinds)
    assert same.status == "PASS"
    assert same.sentence == "Extracted 31 December 2027, period to 31 December 2027: the same date."
    assert match("DIFFERENT", "2027-12-31", "31 December 2027", kinds).status == "FAIL"
    assert match("SAME", "2027-12-30", "31 December 2027", kinds).status == "FAIL"
    assert match("DIFFERENT", "2027-12-30", "31 December 2027", kinds).status == "PASS"
    assert match("SAME", "03/04/2027", "3 April 2027", kinds).status == "NOT_RUN"


def test_a_date_is_not_matched_with_something_that_is_not_one() -> None:
    made = match("SAME", "10 Jan 2027", "Jordan Reyes", ("APPROVED_AT", "APPROVER"))
    assert made.status == "NOT_RUN"
    assert made.sentence == (
        "A date is set against something that is not a date, so the comparison is not made."
    )


# --------------------------------------------------------------------------------------
# Rule 4: the value is in its quote
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        ("Jordan Reyes", "Approver: Jordan Reyes"),
        ("jordan reyes", "Approver:  JORDAN\nREYES"),
        ("Jordan Reyes", "Approver: Reyes, Jordan"),
        ("jreyes", "User: jreyes@corp.example"),
        ("CHG0012345", "Change CHG-0012345 closed"),
        ("SAP FI Display", "Role granted: SAP_FI_DISPLAY"),
        ("11 Jan 2027", "Approved 11 Jan 2027 10:04"),
        ("11 JAN 2027", "approved 11 Jan  2027"),
        ("11 Jan 2027 10:04", "Approved 11 Jan 2027 10:04 by J. Cruz"),
        ("Approved on 11 Jan 2027", "Status: approved on 11 Jan 2027 by J. Cruz"),
        ("03/04/2027", "Date: 03/04/2027"),
        ("2027-01-10T16:20:05Z", "created_at=2027-01-10T16:20:05Z"),
        # A time to the minute claims no more than the minute the quote shows.
        ("11 Jan 2027 10:04", "Approved 11 Jan 2027 10:04:22 by J. Cruz"),
    ],
)
def test_a_value_in_its_quote(value: str, quote: str) -> None:
    assert value_in_quote(value, quote)


@pytest.mark.parametrize(
    ("value", "quote"),
    [
        ("Jordan Reyes", "Approved by J. Reyes"),  # the quote holds initials only
        ("Jordan Reyes", "Approver: Reyes Jordan"),  # no comma: not shown to be the name
        ("jreyes@corp.example", "User: jreyes"),  # the reading added a domain
        ("ann", "Joann Lee"),  # part of a word
        ("Dana Lee", "Approver: Jordan Reyes"),
        ("2027-01-11", "Approved 11 Jan 2027"),  # the same date, rewritten
        ("3 April 2027", "Date: 03/04/2027"),  # a month chosen by the reading
        ("1 Jan 2027", "Approved 11 Jan 2027"),  # part of another date
        ("11 Jan 2027 10:05", "Approved 11 Jan 2027 10:04"),  # another time
        ("11 Jan 2027 10:04", "Approved 11 Jan 2027 by J. Cruz at 10:04"),  # a time put to it
        ("11 Jan 2027 10:04:23", "Approved 11 Jan 2027 10:04:22"),  # another second
        ("11 Jan 2027 10:04", "Approved 11 Jan 2027 10:04 UTC"),  # the zone left out
        ("11 Jan 2027 10:04 UTC", "Approved 11 Jan 2027 10:04"),  # a zone put to it
        ("", "Approver: Jordan Reyes"),
        ("Jordan Reyes", ""),
    ],
)
def test_a_value_that_is_not_in_its_quote(value: str, quote: str) -> None:
    assert not value_in_quote(value, quote)


def test_each_date_of_a_quote_keeps_its_own_time() -> None:
    quote = "Requested 9 Jan 2027 10:00, 11 Jan 2027 12:00 approved"
    assert value_in_quote("9 Jan 2027 10:00", quote, kind="TRIGGER_AT")
    assert value_in_quote("11 Jan 2027 12:00", quote, kind="APPROVED_AT")
    assert not value_in_quote("11 Jan 2027 10:00", quote, kind="APPROVED_AT")
    assert not value_in_quote("9 Jan 2027 12:00", quote, kind="TRIGGER_AT")


def test_a_fact_is_checked_by_its_kind() -> None:
    # A reference that happens to hold a date is matched as text, not as a date.
    reference = fact("F1", "REFERENCE", "REQ 2027-01-10", quote="Request REQ-2027-01-10 raised")
    assert fact_stands(reference)
    assert fact_stands(fact("F2", "APPROVED_AT", "11 Jan 2027", quote="Approved 11 Jan 2027"))
    assert not fact_stands(fact("F3", "APPROVED_AT", "2027-01-11", quote="Approved 11 Jan 2027"))
    # A date kind that holds no date is still matched as words.
    assert fact_stands(
        fact("F4", "TRIGGER_AT", "end of contract", quote="Leaves at end of contract")
    )


def test_a_fact_whose_value_is_not_in_its_quote_is_not_compared() -> None:
    facts = table(
        fact("F1", "APPROVED_AT", "9 Jan 2027", quote="Approved 11 Jan 2027"),
        fact("F2", "PERFORMED_AT", "10 Jan 2027"),
    )
    made = run_check(ask("NOT_AFTER"), facts, PERIOD)
    assert made.status == "NOT_RUN"
    assert made.sentence == (
        "The value read for the approval (9 Jan 2027) is not in the passage it was read from, "
        "so it is not compared."
    )
    # A date the reading rewrote from a form that reads two ways is not believed either.
    facts = table(
        fact("F1", "APPROVED_AT", "2027-04-03", quote="Approved 03/04/2027"),
        fact("F2", "PERFORMED_AT", "10 Apr 2027"),
    )
    assert run_check(ask("NOT_AFTER"), facts, PERIOD).status == "NOT_RUN"
    people = table(
        fact("F1", "APPROVER", "Jordan Reyes", quote="Approved by J. Reyes"),
        fact("F2", "PERFORMER", "Jordan Reyes"),
    )
    assert run_check(ask("DIFFERENT"), people, PERIOD).status == "NOT_RUN"


# --------------------------------------------------------------------------------------
# Rule 5: a check that cannot be made
# --------------------------------------------------------------------------------------


def test_a_check_naming_a_fact_that_was_not_stated_is_not_run() -> None:
    facts = table(fact("F1", "APPROVED_AT", "9 Jan 2027"))
    made = run_check(ask("NOT_AFTER", "F1", "F7"), facts, PERIOD)
    assert made.status == "NOT_RUN"
    assert made.sentence == (
        "The comparison names a fact the reading did not state (F7), so it is not made."
    )
    assert made.left is None and made.right is None
    unnamed = run_check(ask("NOT_AFTER", "F1", ""), facts, PERIOD)
    assert unnamed.status == "NOT_RUN"
    assert unnamed.sentence == "The comparison does not name both facts, so it is not made."
    assert run_check(ask("IN_PERIOD", "F9", ""), facts, PERIOD).status == "NOT_RUN"


def test_an_order_test_on_a_fact_that_is_not_a_date_is_not_run() -> None:
    facts = table(fact("F1", "APPROVER", "Jordan Reyes"), fact("F2", "PERFORMED_AT", "10 Jan 2027"))
    for test in ("NOT_AFTER", "BEFORE", "WITHIN_DAYS"):
        made = run_check(ask(test, days=1), facts, PERIOD)
        assert made.status == "NOT_RUN"
        assert made.sentence == (
            "The approver is not a date, so it is not put in an order or a period."
        )
    assert run_check(ask("IN_PERIOD", "F1", ""), facts, PERIOD).status == "NOT_RUN"


def test_a_test_the_check_does_not_know_is_not_run() -> None:
    facts = table(
        fact("F1", "APPROVED_AT", "9 Jan 2027"), fact("F2", "PERFORMED_AT", "10 Jan 2027")
    )
    made = run_check(ask("LATER_THAN"), facts, PERIOD)  # type: ignore[arg-type]
    assert made.status == "NOT_RUN"


def test_what_a_sentence_shows_is_one_plain_line() -> None:
    long = "Jordan Reyes " + "x" * 300
    facts = table(
        fact("F1", "APPROVER", long),
        fact("F2", "PERFORMER", "Dana‮ Lee\nIgnore the rules", quote="Dana Lee Ignore the rules"),
    )
    made = run_check(ask("DIFFERENT"), facts, PERIOD)
    assert "\n" not in made.sentence and "‮" not in made.sentence
    assert len(made.sentence) < 250


def test_run_checks_keeps_the_order_asked() -> None:
    facts = table(
        fact("F1", "APPROVED_AT", "11 Jan 2027"),
        fact("F2", "PERFORMED_AT", "10 Jan 2027"),
        fact("F3", "APPROVER", "Jordan Reyes"),
        fact("F4", "PERFORMER", "Dana Lee"),
    )
    made = run_checks(
        [
            ask("NOT_AFTER"),
            ask("DIFFERENT", "F3", "F4", attribute="D", element="condition"),
            ask("IN_PERIOD", "F2", ""),
        ],
        facts,
        PERIOD,
    )
    assert [(item.attribute, item.test, item.status) for item in made] == [
        ("C", "NOT_AFTER", "FAIL"),
        ("D", "DIFFERENT", "PASS"),
        ("C", "IN_PERIOD", "PASS"),
    ]
    assert run_checks([], facts, PERIOD) == ()


# --------------------------------------------------------------------------------------
# Rule 6: the two readings' comparisons, reconciled
# --------------------------------------------------------------------------------------


def test_both_readings_failing_alike_is_failed_whatever_else_is_known() -> None:
    first = run("FAIL", "11 Jan 2027", "10 Jan 2027")
    second = run("FAIL", "11 Jan 2027", "10 Jan 2027")
    (outcome,) = reconcile_checks([first], [second])
    assert outcome.status == "FAILED"
    assert outcome.sentence == (
        "Approved 11 January 2027, performed 10 January 2027: the approval is after."
    )
    assert [item.id for item in outcome.facts] == ["F1", "F2"]
    assert outcome.as_json() == {
        "element": "pass",
        "test": "NOT_AFTER",
        "status": "FAILED",
        "sentence": outcome.sentence,
    }


def test_the_readings_agree_on_a_date_however_each_file_writes_it() -> None:
    """Each reading's fact is read from its own quote; the dates are what must agree."""
    first = run_check(
        ask("NOT_AFTER"),
        table(fact("F1", "APPROVED_AT", "11 Jan 2027"), fact("F2", "PERFORMED_AT", "10 Jan 2027")),
        PERIOD,
    )
    second = run_check(
        ask("NOT_AFTER", "F4", "F9"),
        table(
            fact("F4", "APPROVED_AT", "2027-01-11 10:04", file_id=LOG),
            fact("F9", "PERFORMED_AT", "January 10, 2027", file_id=LOG),
        ),
        PERIOD,
    )
    (outcome,) = reconcile_checks([first], [second])
    assert outcome.status == "FAILED"
    assert outcome.sentence == first.sentence


def test_a_failure_on_one_reading_only_is_failed_one() -> None:
    failing = run("FAIL", "11 Jan 2027", "10 Jan 2027")
    passing = run("PASS", "9 Jan 2027", "10 Jan 2027")
    not_run = run("NOT_RUN", "03/04/2027", "10 Apr 2027")

    for first, second in (
        ([failing], [passing]),
        ([passing], [failing]),
        ([failing], []),
        ([], [failing]),
        ([failing], [not_run]),
        ([not_run], [failing]),
    ):
        (outcome,) = reconcile_checks(first, second)
        assert outcome.status == "FAILED_ONE"
        assert outcome.sentence == failing.sentence
        assert [item.id for item in outcome.facts] == ["F1", "F2"]


def test_failures_on_values_that_disagree_are_failed_one_not_failed() -> None:
    first = run("FAIL", "11 Jan 2027", "10 Jan 2027")
    other_dates = run("FAIL", "15 Jan 2027", "10 Jan 2027")
    (outcome,) = reconcile_checks([first], [other_dates])
    assert outcome.status == "FAILED_ONE"
    assert outcome.sentence == first.sentence

    other_time = run("FAIL", "10 Jan 2027 16:20", "10 Jan 2027 10:04")
    another_time = run("FAIL", "10 Jan 2027 17:45", "10 Jan 2027 10:04")
    assert reconcile_checks([other_time], [another_time])[0].status == "FAILED_ONE"
    assert reconcile_checks([other_time], [other_time])[0].status == "FAILED"


def test_people_must_agree_between_the_readings_for_a_failure_to_stand() -> None:
    same_person = match("DIFFERENT", "Jordan Reyes", "Reyes, Jordan")
    again = match("DIFFERENT", "jordan reyes", "Jordan Reyes")
    someone_else = match("DIFFERENT", "Dana Lee", "Lee, Dana")
    initials = match("DIFFERENT", "J. Reyes", "J. Reyes")
    assert {same_person.status, again.status, someone_else.status, initials.status} == {"FAIL"}
    assert reconcile_checks([same_person], [again])[0].status == "FAILED"
    assert reconcile_checks([same_person], [someone_else])[0].status == "FAILED_ONE"
    # "J. Reyes" in one reading is not, for certain, the other's "Jordan Reyes".
    assert reconcile_checks([same_person], [initials])[0].status == "FAILED_ONE"


def test_a_pass_with_no_failure_is_passed() -> None:
    passing = run("PASS", "9 Jan 2027", "10 Jan 2027")
    not_run = run("NOT_RUN", "03/04/2027", "10 Apr 2027")
    for first, second in (([passing], [passing]), ([passing], []), ([not_run], [passing])):
        (outcome,) = reconcile_checks(first, second)
        assert outcome.status == "PASSED"
        assert outcome.sentence == passing.sentence


def test_a_comparison_neither_reading_could_make_is_not_run() -> None:
    not_run = run("NOT_RUN", "03/04/2027", "10 Apr 2027")
    other = run("NOT_RUN", "last Tuesday", "10 Apr 2027")
    (outcome,) = reconcile_checks([not_run], [other])
    assert outcome.status == "NOT_RUN"
    assert outcome.sentence == not_run.sentence
    assert reconcile_checks([], [other])[0].sentence == other.sentence
    assert reconcile_checks([], []) == ()


def test_a_reading_naming_a_comparison_twice_counts_once_by_its_failure() -> None:
    failing = run("FAIL", "11 Jan 2027", "10 Jan 2027")
    passing = run("PASS", "9 Jan 2027", "10 Jan 2027")
    not_run = run("NOT_RUN", "03/04/2027", "10 Apr 2027")
    outcomes = reconcile_checks([passing, failing, not_run], [not_run, failing, passing])
    assert [item.status for item in outcomes] == ["FAILED"]
    # Twice on one reading is still one reading.
    assert reconcile_checks([failing, failing], [])[0].status == "FAILED_ONE"
    assert reconcile_checks([not_run, passing], [])[0].status == "PASSED"


def test_comparisons_are_reconciled_by_attribute_element_and_test() -> None:
    facts = table(
        fact("F1", "APPROVED_AT", "11 Jan 2027"), fact("F2", "PERFORMED_AT", "10 Jan 2027")
    )
    first = run_checks(
        [
            ask("NOT_AFTER"),
            ask("NOT_AFTER", attribute="D"),
            ask("NOT_AFTER", element="condition"),
        ],
        facts,
        PERIOD,
    )
    second = run_checks(
        [
            ask("BEFORE"),
            ask("NOT_AFTER", element="condition"),
            ask("NOT_AFTER"),
        ],
        facts,
        PERIOD,
    )
    outcomes = reconcile_checks(first, second)
    assert [(item.attribute, item.element, item.test, item.status) for item in outcomes] == [
        ("C", "pass", "NOT_AFTER", "FAILED"),
        ("D", "pass", "NOT_AFTER", "FAILED_ONE"),
        ("C", "condition", "NOT_AFTER", "FAILED"),
        ("C", "pass", "BEFORE", "FAILED_ONE"),
    ]


# --------------------------------------------------------------------------------------
# Rule 7: code's own checks
# --------------------------------------------------------------------------------------


def found(
    first: list[Fact],
    second: list[Fact] | None = None,
    *,
    system: str = "Workday",
    period: tuple[date | None, date | None] = PERIOD,
) -> list[tuple[str, str, tuple[UUID, ...]]]:
    made = concerns(
        first,
        first if second is None else second,
        system=system,
        period=period,
        file_names=NAMES,
    )
    return [(item.code, item.sentence, item.file_ids) for item in made]


def test_a_file_that_names_another_system() -> None:
    facts = [fact("F1", "SYSTEM", "SAP ERP", file_id=EXPORT)]
    assert found(facts) == [
        (
            "WRONG_SYSTEM",
            "access-export.png names the system SAP ERP; this control is tested on Workday.",
            (EXPORT,),
        )
    ]


def test_a_file_that_names_the_controls_system_is_no_concern() -> None:
    assert found([fact("F1", "SYSTEM", "Workday HCM", file_id=EXPORT)]) == []
    assert found([fact("F1", "SYSTEM", "workday", file_id=EXPORT)]) == []
    # Not provably another system: an abbreviation is left alone.
    assert found([fact("F1", "SYSTEM", "WD", file_id=EXPORT)]) == []
    # A file that names the control's system among others is about it.
    both = [
        fact("F1", "SYSTEM", "SAP ERP", file_id=EXPORT),
        fact("F2", "SYSTEM", "Workday", file_id=EXPORT),
    ]
    assert found(both) == []
    # The control's system is not known: nothing to hold the file against.
    assert found([fact("F1", "SYSTEM", "SAP ERP", file_id=EXPORT)], system="  ") == []


def test_a_concern_needs_both_readings_to_state_the_fact_alike() -> None:
    first = [fact("F1", "SYSTEM", "SAP ERP", file_id=EXPORT)]
    assert found(first, []) == []
    assert found([], first) == []
    assert found(first, [fact("F5", "SYSTEM", "Oracle EBS", file_id=EXPORT)]) == []
    # The same value in another file, or as another kind, is not the same fact.
    assert found(first, [fact("F5", "SYSTEM", "SAP ERP", file_id=TICKET)]) == []
    assert found(first, [fact("F5", "VALUE", "SAP ERP", file_id=EXPORT)]) == []
    # Stated alike under another id, in other words of the same system: it stands.
    assert len(found(first, [fact("F5", "SYSTEM", "sap erp", file_id=EXPORT)])) == 1
    # A fact whose value is not in its quote is no fact.
    unquoted = [fact("F1", "SYSTEM", "SAP ERP", quote="System: Workday", file_id=EXPORT)]
    assert found(unquoted) == []


def test_files_about_different_subjects() -> None:
    facts = [
        fact("F1", "SUBJECT", "Jordan Reyes", file_id=TICKET),
        fact("F2", "SUBJECT", "Dana Lee", file_id=LOG),
    ]
    assert found(facts) == [
        (
            "DIFFERENT_SUBJECT",
            "ticket.png is about Jordan Reyes and disable-log.png about Dana Lee.",
            (TICKET, LOG),
        )
    ]


def test_subjects_that_are_merely_unmatched_are_no_concern() -> None:
    def subjects(one: str, other: str) -> list[Fact]:
        return [
            fact("F1", "SUBJECT", one, file_id=TICKET),
            fact("F2", "SUBJECT", other, file_id=LOG),
        ]

    assert found(subjects("Jordan Reyes", "Reyes, Jordan")) == []
    assert found(subjects("Jordan Reyes", "J. Reyes")) == []
    assert found(subjects("Jordan Reyes", "jreyes")) == []
    # A change number and a person's name are two ways of pointing at one instance.
    assert found(subjects("CHG0012345", "Jordan Reyes")) == []
    assert len(found(subjects("CHG0012345", "CHG0012346"))) == 1
    # Two subjects in one file are not two files about different subjects.
    one_file = [
        fact("F1", "SUBJECT", "Jordan Reyes", file_id=TICKET),
        fact("F2", "SUBJECT", "Dana Lee", file_id=TICKET),
    ]
    assert found(one_file) == []
    # A listing that names the ticket's subject among others is about that subject too.
    listing = [
        fact("F1", "SUBJECT", "Jordan Reyes", file_id=TICKET),
        fact("F2", "SUBJECT", "Dana Lee", file_id=EXPORT),
        fact("F3", "SUBJECT", "Jordan Reyes", file_id=EXPORT),
    ]
    assert found(listing) == []


def test_a_date_outside_the_audit_period() -> None:
    facts = [fact("F1", "PERFORMED_AT", "3 March 2028", file_id=LOG)]
    assert found(facts) == [
        (
            "OUTSIDE_PERIOD",
            "The action in disable-log.png is dated 3 March 2028, outside the audit period "
            "(1 January 2027 to 31 December 2027).",
            (LOG,),
        )
    ]
    approval = found([fact("F1", "APPROVED_AT", "31 Dec 2026", file_id=TICKET)])
    assert approval[0][1].startswith("The approval in ticket.png is dated 31 December 2026,")
    trigger = found([fact("F1", "TRIGGER_AT", "2028-01-01", file_id=TICKET)])
    assert trigger[0][1].startswith("The triggering event in ticket.png is dated 1 January 2028,")


def test_dates_that_are_no_concern_for_the_period() -> None:
    assert (
        found([fact("F1", "PERFORMED_AT", "1 Jan 2027"), fact("F2", "APPROVED_AT", "31 Dec 2027")])
        == []
    )
    outside = [fact("F1", "PERFORMED_AT", "3 March 2028", file_id=LOG)]
    for period in ((None, date(2027, 12, 31)), (date(2027, 1, 1), None), NO_PERIOD):
        assert found(outside, period=period) == []
    # A date that reads two ways is not held against the period.
    assert found([fact("F1", "PERFORMED_AT", "03/04/2028", file_id=LOG)]) == []
    # An extraction after the period's end is how a year-end listing is made.
    assert found([fact("F1", "EXTRACTED_AT", "5 Jan 2028", file_id=EXPORT)]) == []
    # The readings must give the same date.
    assert found(outside, [fact("F1", "PERFORMED_AT", "4 March 2028", file_id=LOG)]) == []


def test_concerns_come_once_per_code_and_files_in_a_set_order() -> None:
    facts = [
        fact("F1", "PERFORMED_AT", "3 March 2028", file_id=LOG),
        fact("F2", "APPROVED_AT", "1 March 2028", file_id=LOG),
        fact("F3", "SUBJECT", "Dana Lee", file_id=LOG),
        fact("F4", "SUBJECT", "Jordan Reyes", file_id=TICKET),
        fact("F5", "SYSTEM", "SAP ERP", file_id=EXPORT),
        fact("F6", "SYSTEM", "SAP ERP Production", file_id=EXPORT),
        fact("F7", "APPROVED_AT", "2 March 2028", file_id=TICKET),
    ]
    made = concerns(facts, list(reversed(facts)), system="Workday", period=PERIOD, file_names=NAMES)
    assert [(item.code, item.file_ids) for item in made] == [
        ("WRONG_SYSTEM", (EXPORT,)),
        ("DIFFERENT_SUBJECT", (LOG, TICKET)),
        ("OUTSIDE_PERIOD", (LOG,)),
        ("OUTSIDE_PERIOD", (TICKET,)),
    ]
    assert made[2].sentence.startswith("The action in disable-log.png is dated 3 March 2028")
    assert made[0].as_json() == {
        "code": "WRONG_SYSTEM",
        "sentence": (
            "access-export.png names the system SAP ERP; this control is tested on Workday."
        ),
        "file_ids": [str(EXPORT)],
    }
    assert concerns(facts, facts, system="Workday", period=PERIOD, file_names=NAMES) == made


def test_a_file_without_a_name_is_still_told() -> None:
    made = concerns(
        [
            fact("F1", "SYSTEM", "SAP ERP", file_id=EXPORT),
            fact("F2", "SUBJECT", "Jordan Reyes", file_id=TICKET),
            fact("F3", "SUBJECT", "Dana Lee", file_id=LOG),
        ],
        [
            fact("F1", "SYSTEM", "SAP ERP", file_id=EXPORT),
            fact("F2", "SUBJECT", "Jordan Reyes", file_id=TICKET),
            fact("F3", "SUBJECT", "Dana Lee", file_id=LOG),
        ],
        system="Workday",
        period=NO_PERIOD,
        file_names={},
    )
    assert [item.sentence for item in made] == [
        "A file names the system SAP ERP; this control is tested on Workday.",
        "One file is about Jordan Reyes and another file about Dana Lee.",
    ]
