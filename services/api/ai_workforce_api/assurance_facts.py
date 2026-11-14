"""Facts and comparisons made in code (docs/evidence-assurance.md, sections 10.4 and 10.5).

A reading names the facts the records state ("approved at X", "performed at Y") and the
comparison an element calls for. It never makes the comparison: this module parses the
values and makes it, so two readings that both say "approved before provisioning" cannot
stand against dates that say otherwise.

The rules, each enforced whatever a model says:

1. a date is read only when it is certain. A numeric date whose day and month could be
   read either way (03/04/2027) is not compared; a year, a month or a time is never
   guessed, and a two-digit year is refused;
2. an order is told from the times only when both records show one on the same footing
   (both with a UTC offset, or neither); otherwise the dates decide, and two records of the
   same day with a time missing are not put in an order;
3. two values are the same only when they are the same once case, spacing, punctuation and
   the order of a "Last, First" name are set aside. Initials and partial names never make
   two people the same, and never make them different either: such a pair is not matched;
4. a fact's value must be in the quote it is read from, and a date must be written there
   the way the reading gave it, so a reading cannot turn 03/04/2027 into 3 April;
5. a comparison that fails on both readings, on values that agree, is a failure shown by
   the records. One that fails on one reading only is a person's to settle. One that passes
   supports nothing by itself.

WITHIN_DAYS counts calendar days between the two dates as they are written. Business
days, weekends and holidays are not this module's job: an element that allows "one
business day" is a person's or a later rule's to judge.

Everything a fact holds is untrusted data (a model's reading of a file). Nothing here
follows it, and what is put in a sentence is cut to one plain line first.

The module is pure: no database, no network, no model call.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, get_args
from uuid import UUID

from ai_workforce_api.inbound import clean_line

FactKind = Literal[
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
]
FACT_KINDS: tuple[FactKind, ...] = get_args(FactKind)
CheckTest = Literal["NOT_AFTER", "BEFORE", "SAME", "DIFFERENT", "WITHIN_DAYS", "IN_PERIOD"]
CHECK_TESTS: tuple[CheckTest, ...] = get_args(CheckTest)
RunStatus = Literal["PASS", "FAIL", "NOT_RUN"]
OutcomeStatus = Literal["FAILED", "FAILED_ONE", "PASSED", "NOT_RUN"]
ConcernCode = Literal["WRONG_SYSTEM", "DIFFERENT_SUBJECT", "OUTSIDE_PERIOD"]
Match = Literal["SAME", "DIFFERENT", "UNSURE"]
Period = tuple[date | None, date | None]

# The kinds that hold a date. An order test is made only on these.
TIME_KINDS: frozenset[FactKind] = frozenset(
    {"APPROVED_AT", "PERFORMED_AT", "TRIGGER_AT", "EXTRACTED_AT", "PERIOD_FROM", "PERIOD_TO"}
)
ORDER_TESTS: frozenset[CheckTest] = frozenset({"NOT_AFTER", "BEFORE", "WITHIN_DAYS", "IN_PERIOD"})
# The dates an audit period is held against: when the control was approved, performed or
# set off. An extraction date or a report's own period is expected to fall elsewhere.
_PERIOD_KINDS: tuple[FactKind, ...] = ("APPROVED_AT", "PERFORMED_AT", "TRIGGER_AT")

VALUE_LIMIT = 80
NAME_LIMIT = 120


@dataclass(frozen=True)
class Fact:
    """A fact a reading stated, already located in its file by the caller."""

    id: str
    kind: FactKind
    value: str
    file_id: UUID
    quote: str
    start: int
    end: int


@dataclass(frozen=True)
class CheckAsk:
    """The comparison a reading names for an element. Code makes it (`run_check`)."""

    attribute: str
    element: str
    test: CheckTest
    left: str
    right: str = ""
    days: int | None = None


@dataclass(frozen=True)
class CheckRun:
    """One reading's comparison, made in code on that reading's own facts."""

    attribute: str
    element: str
    test: CheckTest
    status: RunStatus
    sentence: str
    left: Fact | None
    right: Fact | None


@dataclass(frozen=True)
class CheckOutcome:
    """The two readings' runs of one comparison, reconciled."""

    attribute: str
    element: str
    test: CheckTest
    status: OutcomeStatus
    sentence: str
    facts: tuple[Fact, ...]

    def as_json(self) -> dict[str, Any]:
        return {
            "element": self.element,
            "test": self.test,
            "status": self.status,
            "sentence": self.sentence,
        }


@dataclass(frozen=True)
class Concern:
    """Something code found in facts both readings state alike."""

    code: ConcernCode
    sentence: str
    file_ids: tuple[UUID, ...]

    def as_json(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "sentence": self.sentence,
            "file_ids": [str(file_id) for file_id in self.file_ids],
        }


# --------------------------------------------------------------------------------------
# Dates and times
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class When:
    """A date a record states, with its time and UTC offset where the record shows them.

    `zone` holds a time zone the record names that is not resolved to an offset (an
    abbreviation such as CST means more than one zone). A time with such a zone is put in
    an order only with a time that names the same one. `to_second` says the record writes
    its time to the second: a time written to the minute stands for the whole minute.
    """

    day: date
    clock: time | None = None
    offset: timedelta | None = None
    zone: str = ""
    to_second: bool = False


@dataclass(frozen=True)
class _Found:
    """One date found in a text: as written, and as read when it can be read."""

    written: str
    when: When | None
    ambiguous: bool
    # Part of a longer run of numbers or of a range (2027-01-10/2027-01-12): not one date.
    joined: bool
    # Where the date, and a time written after it, end in the text.
    reach: int


_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_MONTH_OF = {name[:3].lower(): number for number, name in enumerate(_MONTHS, start=1)}
_MON = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_YEAR = r"(?:19|20|21)\d\d"
_ORDINAL = r"(?:st|nd|rd|th)?"
# The last alternative finds a date with a two-digit year so that it is refused as a date,
# rather than passed over while another date in the same value is taken for the only one.
_DATE = re.compile(
    rf"""
    (?<![^\W_])
    (?:
        (?P<iy>{_YEAR})(?P<isep>[-/.])(?P<im>\d{{1,2}})(?P=isep)(?P<id>\d{{1,2}})
      | (?P<dd>\d{{1,2}}){_ORDINAL}(?:\s*-\s*|\s+(?:of\s+)?)(?P<dmon>{_MON})\b\.?
        (?:\s*-\s*|,?\s+)(?P<dy>{_YEAR})
      | (?P<mmon>{_MON})\b\.?(?:\s*-\s*|\s+)(?P<md>\d{{1,2}}){_ORDINAL}
        (?:\s*-\s*|,?\s+)(?P<my>{_YEAR})
      | (?P<na>\d{{1,2}})(?P<nsep>[-/.])(?P<nb>\d{{1,2}})(?P=nsep)(?P<ny>{_YEAR})
      | (?P<short>
            \d{{1,2}}[-/.]\d{{1,2}}[-/.]\d{{2}}
          | \d{{1,2}}{_ORDINAL}[\s-]+{_MON}\b\.?[\s-]+\d{{2}}
          | {_MON}\b\.?\s+\d{{1,2}},?\s+\d{{2}}
        )(?![\d:])
    )
    (?!\d)
    """,
    re.IGNORECASE | re.VERBOSE | re.ASCII,
)
_CLOCK = (
    r"(?P<h>\d{1,2}):(?P<mi>\d{2})(?::(?P<s>\d{2})(?:[.,](?P<f>\d{1,9}))?)?(?![\d:])"
    r"(?:\s*(?P<ap>[ap])\.?m\.?(?![A-Za-z]))?"
)
# Zone abbreviations a record may print after a time. They are kept as written and never
# turned into an offset: several of them (CST, IST, BST) name more than one zone.
_ZONE_NAMES = (
    "ACDT|ACST|AEDT|AEST|AKDT|AKST|AWST|BST|CDT|CEST|CET|CST|CT|EDT|EEST|EET|EST|ET|HKT"
    "|HST|ICT|IST|JST|KST|MDT|MSK|MST|MT|MYT|NZDT|NZST|PDT|PHT|PKT|PST|PT|SAST|SGT|WEST"
    "|WET|WIB"
)
_TIME_AFTER = re.compile(
    rf"(?P<sep>T|\s*,\s*(?:at\s+)?|\s+(?:at\s+)?|\s*@\s*|\s+-\s+){_CLOCK}",
    re.IGNORECASE | re.ASCII,
)
_TIME_BEFORE = re.compile(
    rf"(?<![\d:.]){_CLOCK}(?:\s*(?P<zone>Z|UTC|GMT|{_ZONE_NAMES})(?![A-Za-z]))?"
    rf"(?:\s*,\s*|\s+(?:on\s+)?|\s+-\s+)\Z",
    re.IGNORECASE | re.ASCII,
)
_OFFSET = re.compile(
    r"\s*(?:(?P<utc>Z|UTC|GMT)(?![A-Za-z])\s?)?"
    r"(?P<off>(?P<sign>[+-])(?P<oh>\d{1,2})(?::?(?P<om>\d{2}))?(?![\d:]))?",
    re.IGNORECASE | re.ASCII,
)
_ZONE = re.compile(rf"\s*\(?(?P<zone>{_ZONE_NAMES})(?![A-Za-z])", re.IGNORECASE | re.ASCII)
# A date that runs on from a number or a reference (CHG-2027-01-10), or into one, is part
# of something longer and is not read as a date.
_JOINED_BEFORE = re.compile(r"(?:\d[-/.]|[^\W\d_][-/])\Z")
_JOINED_AFTER = re.compile(r"[-/.]\d")
# A time that opens a range (09:00-10:30) is a window, not the time of the event.
_RANGE_AFTER = re.compile(r"\s*(?:[-\u2013\u2014]|to\b)\s*\d{1,2}:\d{2}", re.IGNORECASE)
# No real UTC offset is further from UTC than this.
_MAX_OFFSET = timedelta(hours=14)
# A time written before its date ends within this many characters of it.
_TIME_WINDOW = 48


def _plain(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def _date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _clock(match: re.Match[str]) -> time | None:
    """The time a clock match holds, or None when it is not a real time."""
    hour, minute = int(match["h"]), int(match["mi"])
    second = int(match["s"]) if match["s"] else 0
    micro = int(match["f"][:6].ljust(6, "0")) if match["f"] else 0
    if match["ap"]:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if match["ap"].lower() == "p" else 0)
    if hour > 23 or minute > 59 or second > 59:
        return None
    return time(hour, minute, second, micro)


def _zone_after(
    text: str, position: int, *, iso: bool, exact: bool
) -> tuple[timedelta | None, str]:
    """The UTC offset, or the unresolved zone, written after a time.

    A bare "-10:30" after a time is as likely the end of a time range as an offset, so a
    bare offset is read only after a year-first date, and a negative one only when the time
    is written to the second or joined to its date by "T".
    """
    match = _OFFSET.match(text, position)
    if match is None:
        return None, ""
    named = match["utc"] is not None
    if match["off"] is not None:
        bare_allowed = iso and len(match["oh"]) == 2 and (match["sign"] == "+" or exact)
        if named or bare_allowed:
            offset = timedelta(hours=int(match["oh"]), minutes=int(match["om"] or 0))
            if offset > _MAX_OFFSET or int(match["om"] or 0) > 59:
                # A zone is shown but it is not one that can be read: kept as written, so
                # the time is not ordered against a time in another zone.
                return None, " ".join(match.group(0).split()).upper()
            return (-offset if match["sign"] == "-" else offset), ""
    if named:
        return timedelta(0), ""
    zone = _ZONE.match(text, position)
    return None, zone["zone"].upper() if zone else ""


def _with_time(
    text: str, start: int, end: int, day: date, *, iso: bool, floor: int
) -> tuple[When, int]:
    """The date at text[start:end] with the time written directly after or before it, and
    where the two end in the text.

    A time elsewhere in the value is not this date's time for certain, so it is not taken.
    A time on both sides leaves none: which one is meant would be a guess. Neither is a
    time that is not a real one, nor one that opens a range. Nothing before `floor` is
    looked at: there the date before this one, and its own time, end.
    """
    after = _TIME_AFTER.match(text, end)
    before = _TIME_BEFORE.search(text[max(floor, start - _TIME_WINDOW) : start])
    reach = after.end() if after is not None else end
    if after is not None and before is None:
        clock = _clock(after)
        if clock is None:
            return When(day), reach
        exact = after["s"] is not None or after["sep"].upper() == "T"
        offset, zone = _zone_after(text, after.end(), iso=iso, exact=exact)
        if offset is None and _RANGE_AFTER.match(text, after.end()):
            return When(day), reach
        return When(day, clock, offset, zone, after["s"] is not None), reach
    if before is not None and after is None:
        clock = _clock(before)
        if clock is None:
            return When(day), reach
        named = (before["zone"] or "").upper()
        to_second = before["s"] is not None
        if named in {"Z", "UTC", "GMT"}:
            return When(day, clock, timedelta(0), "", to_second), reach
        return When(day, clock, None, named, to_second), reach
    return When(day), reach


def _found(text: str, match: re.Match[str], floor: int) -> _Found:
    written = match.group(0)
    joined = bool(
        _JOINED_BEFORE.search(text[max(0, match.start() - 2) : match.start()])
        or _JOINED_AFTER.match(text, match.end())
    )
    day: date | None = None
    ambiguous = False
    if match["short"]:
        day = None
    elif match["iy"]:
        day = _date(int(match["iy"]), int(match["im"]), int(match["id"]))
    elif match["dd"]:
        day = _date(int(match["dy"]), _MONTH_OF[match["dmon"][:3].lower()], int(match["dd"]))
    elif match["mmon"]:
        day = _date(int(match["my"]), _MONTH_OF[match["mmon"][:3].lower()], int(match["md"]))
    else:
        first, second, year = int(match["na"]), int(match["nb"]), int(match["ny"])
        day_first = _date(year, second, first)
        month_first = _date(year, first, second)
        if day_first is not None and month_first is not None and first != second:
            ambiguous = True
        else:
            day = day_first or month_first
    if day is None or joined:
        return _Found(written, None, ambiguous and not joined, joined, match.end())
    when, reach = _with_time(
        text, match.start(), match.end(), day, iso=bool(match["iy"]), floor=floor
    )
    return _Found(written, when, False, False, reach)


def _scan(text: str) -> tuple[_Found, ...]:
    """Every date written in a text, in order."""
    plain = _plain(text)
    found: list[_Found] = []
    for match in _DATE.finditer(plain):
        found.append(_found(plain, match, found[-1].reach if found else 0))
    return tuple(found)


def _one_date(value: str) -> _Found | None:
    """The one date a value holds, or None when it holds none or more than one."""
    found = _scan(value)
    return found[0] if len(found) == 1 else None


def parse_when(value: str) -> When | None:
    """Return the date a value states, or None when it cannot be read with certainty.

    Read: ISO 8601 (2027-01-10, 2027-01-10T16:20:05Z, 2027-01-10 16:20:05+08:00),
    2027/01/10, 10 Jan 2027, 10 January 2027, 10-Jan-2027, January 10, 2027,
    Jan 10, 2027 4:20 PM, and numeric day and month forms (13/04/2027, 04-13-2027) when
    only one reading is a real date. A value with other words around its date is read from
    the date when it holds exactly one.

    None: a numeric date that could be read two ways (`ambiguous_date` says so), a
    two-digit year, a missing day, month or year, a date that does not exist, more than
    one date, a range. The time is taken only when it is written next to the date.
    """
    found = _one_date(value)
    return found.when if found is not None else None


def ambiguous_date(value: str) -> str | None:
    """Return the date as written when its day and month could be read either way."""
    found = _one_date(value)
    return found.written if found is not None and found.ambiguous else None


def date_text(day: date) -> str:
    """A date in plain words: 11 January 2027."""
    return f"{day.day} {_MONTHS[day.month - 1]} {day.year}"


def when_text(when: When) -> str:
    """A date in plain words, with its time and zone where the record shows them."""
    text = date_text(when.day)
    if when.clock is None:
        return text
    text += " " + when.clock.strftime("%H:%M:%S" if when.clock.second else "%H:%M")
    if when.offset is not None:
        return f"{text} {_offset_text(when.offset)}"
    return f"{text} {when.zone}" if when.zone else text


def _offset_text(offset: timedelta) -> str:
    minutes = int(offset.total_seconds() // 60)
    if minutes == 0:
        return "UTC"
    sign = "+" if minutes > 0 else "-"
    hours, rest = divmod(abs(minutes), 60)
    return f"UTC{sign}{hours:02d}:{rest:02d}"


def _moment(when: When, *, fine: bool) -> datetime:
    """The date and time as one value, cut to the minute unless `fine`."""
    clock = when.clock or time()
    if not fine:
        clock = clock.replace(second=0, microsecond=0)
    zone = timezone(when.offset) if when.offset is not None else None
    return datetime.combine(when.day, clock, tzinfo=zone)


def _order(left: When, right: When) -> int | None:
    """-1, 0 or 1 as left is before, at or after right; None when it cannot be told.

    The times decide when both records show one on the same footing: both with a UTC
    offset (compared in UTC), or neither and no differing zone named. Otherwise the dates
    decide when they differ, and the same date leaves the order untold.

    A time written to the minute stands for the whole minute, so unless both are written
    to the second they are compared to the minute: 10:04:30 is not after 10:04.
    """
    if left.clock is not None and right.clock is not None:
        zoned = left.offset is not None and right.offset is not None
        plain = left.offset is None and right.offset is None and left.zone == right.zone
        if zoned or plain:
            fine = left.to_second and right.to_second
            first, second = _moment(left, fine=fine), _moment(right, fine=fine)
            return (first > second) - (first < second)
    if left.day != right.day:
        return 1 if left.day > right.day else -1
    return None


def _same_moment(first: When, second: When) -> bool:
    """Whether two readings' dates agree: the same day, and the same time where both show one."""
    if first.clock is None or second.clock is None:
        return first.day == second.day
    if first.offset is not None and second.offset is not None:
        return _moment(first, fine=True) == _moment(second, fine=True)
    return (first.day, first.clock, first.zone) == (second.day, second.clock, second.zone)


# --------------------------------------------------------------------------------------
# People, users, references, roles, systems, values
# --------------------------------------------------------------------------------------

_APOSTROPHES = re.compile(r"['‘’`´]")
# A comma that groups thousands (1,000) is spacing. A comma or point between other digits
# (1.5) is part of the number and is kept, so 1.5 is never read as 15.
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")
_TOKEN = re.compile(r"\d+(?:[.,]\d+)+|[^\W_]+")
_EMAIL = re.compile(r"([^\s@<>\\]+)@([^\s@<>\\]+\.[^\s@<>\\]+)")
_DOWN_LEVEL = re.compile(r"([^\s@<>\\]+)\\([^\s@<>\\]+)")
# Above this many words the exhaustive match is not worth its cost; a simpler test that
# errs towards "not matched" is used instead.
_MATCH_LIMIT = 10
_MATCH_STEPS = 5000
# Words that say a thing is a system without saying which one.
_GENERIC_SYSTEM_WORDS = frozenset(
    {
        "app",
        "application",
        "cloud",
        "database",
        "db",
        "environment",
        "erp",
        "instance",
        "module",
        "platform",
        "portal",
        "prod",
        "production",
        "server",
        "service",
        "system",
        "systems",
        "the",
        "tool",
    }
)


def _norm(text: str) -> str:
    folded = _APOSTROPHES.sub("", _plain(text).casefold())
    return _THOUSANDS.sub("", folded)


def _spans(text: str) -> tuple[str, list[tuple[str, int, int]]]:
    """The normalised text and its words, each with where it sits in that text."""
    normal = _norm(text)
    return normal, [(m.group(0), m.start(), m.end()) for m in _TOKEN.finditer(normal)]


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(_TOKEN.findall(_norm(text)))


def _numeric(token: str) -> bool:
    return token.replace(".", "").replace(",", "").isdigit()


def _reordered(text: str) -> str:
    """Put a "Last, First" name in the order "First Last"."""
    if text.count(",") != 1 or any(char.isdigit() for char in text):
        return text
    last, first = (part.strip() for part in text.split(","))
    if not last or not first or len(last.split()) > 3 or len(first.split()) > 3:
        return text
    return f"{first} {last}"


def _identity(value: str) -> tuple[str, str]:
    """A user id without its domain, and the domain (empty when it has none)."""
    text = _plain(value).strip()
    if match := _EMAIL.fullmatch(text):
        return match[1], match[2].casefold().rstrip(".")
    if match := _DOWN_LEVEL.fullmatch(text):
        return match[2], match[1].casefold()
    return text, ""


def _compatible(one: str, other: str) -> bool:
    """Whether two words could be the same word written short: an initial, a cut name."""
    if one == other:
        return True
    if one.isalpha() and other.isalpha():
        return one.startswith(other) or other.startswith(one)
    if _numeric(one) and _numeric(other):
        try:
            return Decimal(one.replace(",", ".")) == Decimal(other.replace(",", "."))
        except InvalidOperation:
            return False
    return False


def _covers(short: Sequence[str], long: Sequence[str]) -> bool:
    """Whether every word of `short` could be a word, or a short form of words, of `long`.

    When it is, one value may be a shorter way of writing the other ("J. Reyes" and
    "Jordan Reyes", "jreyes" and "Jordan Reyes", "AP Clerk" and "Accounts Payable Clerk"):
    the two are not provably different, and are not the same either.

    A word matches a word of `long` it is compatible with, or two or more of them whose
    starts spell it in some order ("jreyes" from "jordan" and "reyes", "ap" from
    "accounts" and "payable"). Each word of `long` is used once.

    The values are a model's words, so the search is bounded: one that runs out of steps
    answers "could be", the answer that proves nothing either way.
    """
    if len(short) > len(long):
        return False
    if len(long) > _MATCH_LIMIT:
        return all(any(_compatible(word, token) for token in long) for word in short)
    steps = 0

    def spent() -> bool:
        nonlocal steps
        steps += 1
        return steps > _MATCH_STEPS

    def place(position: int, used: int) -> bool:
        if position == len(short) or spent():
            return True
        word = short[position]
        for index, token in enumerate(long):
            if used >> index & 1 or not _compatible(word, token):
                continue
            if place(position + 1, used | 1 << index):
                return True
        return word.isalpha() and spell(position, 0, used, 0)

    def spell(position: int, at: int, used: int, count: int) -> bool:
        word = short[position]
        if at == len(word):
            return count >= 2 and place(position + 1, used)
        if spent():
            return True
        for index, token in enumerate(long):
            if used >> index & 1 or not token.isalpha():
                continue
            for length in range(1, min(len(token), len(word) - at) + 1):
                if word[at : at + length] != token[:length]:
                    break
                if spell(position, at + length, used | 1 << index, count + 1):
                    return True
        return False

    return place(0, 0)


def _joined_same(one: Sequence[str], other: Sequence[str]) -> bool:
    """Whether two values differ only in where they are split (CHG-0012345, CHG0012345).

    Two numbers side by side are never joined: "8 16" is not 816.
    """
    for tokens in (one, other):
        if any(_numeric(a) and _numeric(b) for a, b in zip(tokens, tokens[1:], strict=False)):
            return False
    return "".join(one) == "".join(other)


def _abbreviates(short: Sequence[str], long: Sequence[str]) -> bool:
    """Whether a short system name could be an abbreviation of a longer one (AD, WD)."""
    if len(short) != 1 or not 2 <= len(short[0]) <= 6:
        return False
    word = short[0]
    if word == "".join(token[0] for token in long):
        return True
    for token in long:
        if token[0] != word[0]:
            continue
        rest = iter(token)
        if all(char in rest for char in word):
            return True
    return False


def _compare_systems(one: str, other: str) -> Match:
    mine, theirs = _tokens(one), _tokens(other)
    if not mine or not theirs:
        return "UNSURE"
    if mine == theirs or "".join(mine) == "".join(theirs):
        return "SAME"
    small, large = sorted((set(mine), set(theirs)), key=len)
    if small <= large:
        # "Workday" and "Workday HCM" are one system. "ERP" inside "SAP ERP" names none.
        return "SAME" if small - _GENERIC_SYSTEM_WORDS else "UNSURE"
    named_mine = set(mine) - _GENERIC_SYSTEM_WORDS
    named_theirs = set(theirs) - _GENERIC_SYSTEM_WORDS
    if not named_mine or not named_theirs:
        return "UNSURE"
    if any(_compatible(a, b) for a in named_mine for b in named_theirs):
        return "UNSURE"
    if _abbreviates(mine, theirs) or _abbreviates(theirs, mine):
        return "UNSURE"
    packed_mine, packed_theirs = "".join(mine), "".join(theirs)
    if min(len(packed_mine), len(packed_theirs)) >= 3 and (
        packed_mine in packed_theirs or packed_theirs in packed_mine
    ):
        return "UNSURE"
    return "DIFFERENT"


def compare_values(a: str, b: str, *, system: bool = False) -> Match:
    """Compare two values a record states: SAME, DIFFERENT, or UNSURE.

    SAME: the same once case, spacing, punctuation and the order of a "Last, First" name
    are set aside ("Reyes, Jordan" and "Jordan Reyes"; "CHG-0012345" and "chg 0012345"),
    or a user id against the same id with a domain ("jreyes@corp.example" and "jreyes").

    UNSURE: one could be a shorter way of writing the other (an initial, a partial name, a
    user id made from a name, an abbreviation, an extra word), the same words in another
    order, or the same id under two domains. Never taken as the same, never as different.

    DIFFERENT: each value names something the other does not ("Jordan Reyes" and
    "Jordan Lee"; "Display role" and "Admin role").

    With `system`, a name that holds all the words of the other is the same system
    ("Workday" and "Workday HCM"), and two names that share a word are UNSURE.
    """
    if system:
        return _compare_systems(a, b)
    (text_a, domain_a), (text_b, domain_b) = _identity(a), _identity(b)
    mine, theirs = _tokens(_reordered(text_a)), _tokens(_reordered(text_b))
    if not mine or not theirs:
        return "UNSURE"
    if mine == theirs or _joined_same(mine, theirs):
        return "UNSURE" if domain_a and domain_b and domain_a != domain_b else "SAME"
    if _covers(mine, theirs) or _covers(theirs, mine):
        return "UNSURE"
    return "DIFFERENT"


def same_value(a: str, b: str, *, system: bool = False) -> bool:
    """Whether two values are the same for certain (see `compare_values`)."""
    return compare_values(a, b, system=system) == "SAME"


def different_value(a: str, b: str, *, system: bool = False) -> bool:
    """Whether two values are provably different, not merely unmatched."""
    return compare_values(a, b, system=system) == "DIFFERENT"


# --------------------------------------------------------------------------------------
# The value is in its quote
# --------------------------------------------------------------------------------------


def _squash(text: str) -> str:
    return "".join(_plain(text).casefold().split())


def _date_in_quote(found: _Found, quote: str) -> bool:
    """Whether the quote holds the same date, written the same way.

    The dates of the quote are found the way the value's was, so "1 Jan 2027" is not found
    inside "11 Jan 2027". A time the value gives must be the time written by that date, in
    the same zone or none; a value may leave out the seconds the quote shows, since a time
    to the minute claims no more than its minute.
    """
    written = _squash(found.written)
    mine = found.when
    for candidate in _scan(quote):
        if _squash(candidate.written) != written:
            continue
        if mine is None or mine.clock is None:
            return True
        theirs = candidate.when
        if theirs is None or theirs.clock is None:
            continue
        if (theirs.offset, theirs.zone) != (mine.offset, mine.zone):
            continue
        shown = theirs.clock if mine.to_second else theirs.clock.replace(second=0, microsecond=0)
        if shown == mine.clock:
            return True
    return False


def _text_in_quote(value: str, quote: str) -> bool:
    words = _tokens(value)
    normal, spans = _spans(quote)
    if not words or not spans:
        return False
    quoted = [word for word, _start, _end in spans]
    packed = "".join(words)
    # The value's words in a row, however the quote splits them (CHG-0012345, CHG 0012345).
    for start in range(len(quoted)):
        run = ""
        for index in range(start, len(quoted)):
            run += quoted[index]
            if len(run) >= len(packed):
                break
        if run == packed:
            return True
    # A name the quote writes "Last, First": the value's words turned about a comma.
    size = len(words)
    for turn in range(1, size):
        turned = list(words[turn:] + words[:turn])
        for start in range(len(quoted) - size + 1):
            if quoted[start : start + size] != turned:
                continue
            last_of_surname = spans[start + size - turn - 1]
            first_of_given = spans[start + size - turn]
            if "," in normal[last_of_surname[2] : first_of_given[1]]:
                return True
    return False


def value_in_quote(value: str, quote: str, *, kind: FactKind | None = None) -> bool:
    """Whether a fact's value is in the quote it is read from.

    A date (a fact of a date kind or, when no kind is given, a value that holds one date)
    must be written in the quote the way the value writes it, case and spacing aside: a
    reading that restates 03/04/2027 as 2027-04-03 has chosen a month, and is not believed.
    Any other value must appear in the quote as whole words, with case, spacing and
    punctuation set aside; a name may be written "Last, First" there. Initials in the quote
    are not the full name.
    """
    if not value.strip() or not quote.strip():
        return False
    if kind is None or kind in TIME_KINDS:
        found = _one_date(value)
        if found is not None:
            return _date_in_quote(found, quote)
    return _text_in_quote(value, quote)


def fact_stands(fact: Fact) -> bool:
    """Whether a fact's value is in its own quote (`value_in_quote`, by the fact's kind)."""
    return value_in_quote(fact.value, fact.quote, kind=fact.kind)


# --------------------------------------------------------------------------------------
# One comparison, made in code
# --------------------------------------------------------------------------------------

_LEAD: dict[FactKind, str] = {
    "SUBJECT": "subject",
    "REFERENCE": "reference",
    "REQUESTED": "asked for",
    "PERFORMED": "done",
    "APPROVER": "approver",
    "PERFORMER": "performer",
    "APPROVED_AT": "approved",
    "PERFORMED_AT": "performed",
    "TRIGGER_AT": "trigger date",
    "SYSTEM": "system",
    "EXTRACTED_AT": "extracted",
    "PERIOD_FROM": "period from",
    "PERIOD_TO": "period to",
    "VALUE": "value",
}
_NOUN: dict[FactKind, str] = {
    "SUBJECT": "the subject",
    "REFERENCE": "the reference",
    "REQUESTED": "what was asked for",
    "PERFORMED": "what was done",
    "APPROVER": "the approver",
    "PERFORMER": "the performer",
    "APPROVED_AT": "the approval",
    "PERFORMED_AT": "the performance",
    "TRIGGER_AT": "the trigger date",
    "SYSTEM": "the system",
    "EXTRACTED_AT": "the extraction",
    "PERIOD_FROM": "the period's start",
    "PERIOD_TO": "the period's end",
    "VALUE": "the value",
}
_DATE_NOUN: dict[FactKind, str] = {
    "APPROVED_AT": "the approval date",
    "PERFORMED_AT": "the date performed",
    "TRIGGER_AT": "the trigger date",
    "EXTRACTED_AT": "the extraction date",
    "PERIOD_FROM": "the period's start",
    "PERIOD_TO": "the period's end",
}


_EVENT: dict[FactKind, str] = {
    "APPROVED_AT": "the approval",
    "PERFORMED_AT": "the action",
    "TRIGGER_AT": "the triggering event",
}


def _capital(sentence: str) -> str:
    return sentence[:1].upper() + sentence[1:]


def _shown(value: str) -> str:
    """A value as a sentence shows it: one plain line, in quotation marks when it holds a
    comma or a colon that would otherwise read as the sentence's own."""
    text = clean_line(value, VALUE_LIMIT).strip() or "nothing"
    return f'"{text}"' if "," in text or ":" in text else text


def _days(count: int) -> str:
    return "1 day" if count == 1 else f"{count} days"


def _period_text(start: date, end: date) -> str:
    return f"the audit period ({date_text(start)} to {date_text(end)})"


def _period_of(period: Period) -> tuple[date, date] | None:
    start, end = period
    if start is None or end is None or start > end:
        return None
    return start, end


def _read_date(fact: Fact) -> When | str:
    """The fact's date, or the sentence that says why it is not compared."""
    found = _one_date(fact.value)
    if found is not None and found.ambiguous:
        written = clean_line(found.written, VALUE_LIMIT)
        return f"The date {written} can be read two ways, so it is not compared."
    if found is None or found.when is None:
        return _capital(
            f"{_DATE_NOUN[fact.kind]} ({_shown(fact.value)}) is not a date that can be read, "
            "so it is not compared."
        )
    return found.when


def _pair(left: Fact, left_text: str, right: Fact, right_text: str) -> str:
    return _capital(f"{_LEAD[left.kind]} {left_text}, {_LEAD[right.kind]} {right_text}")


def _earlier_noun(left: Fact, right: Fact) -> str:
    return _NOUN[left.kind] if left.kind != right.kind else "the first"


def _untold(left: When, right: When) -> str:
    day = date_text(left.day)
    if left.clock is None or right.clock is None:
        return f"Both are dated {day} and a time is not shown for one, so the order cannot be told."
    return (
        f"Both are dated {day} and their times are not shown in the same time zone, "
        "so the order cannot be told."
    )


def _order_check(
    ask: CheckAsk, left: Fact, right: Fact, first: When, second: When
) -> tuple[RunStatus, str]:
    stated = _pair(left, when_text(first), right, when_text(second))
    if ask.test == "WITHIN_DAYS":
        allowed = ask.days
        if allowed is None or allowed < 0:
            return (
                "NOT_RUN",
                "The comparison does not say how many days are allowed, so it is not made.",
            )
        # Calendar days between the dates as written; the times do not enter into it.
        apart = (second.day - first.day).days
        if apart < 0:
            return "FAIL", f"{stated}: the second date is earlier than the first."
        gap = "the same day" if apart == 0 else f"{_days(apart)} apart"
        if apart <= allowed:
            return "PASS", f"{stated}: {gap}, within the {_days(allowed)} allowed."
        return "FAIL", f"{stated}: {gap}, more than the {_days(allowed)} allowed."
    order = _order(first, second)
    if order is None:
        if ask.test == "NOT_AFTER":
            # The same day is not after, whatever the time that is not shown.
            return "PASS", f"{stated}: the same day."
        return "NOT_RUN", _untold(first, second)
    if order < 0:
        return "PASS", f"{stated}: in order."
    if order == 0:
        if ask.test == "NOT_AFTER":
            return "PASS", f"{stated}: at the same time."
        # The records show the same time; which came first within it is not shown.
        return "NOT_RUN", f"{stated}: at the same time, so the order cannot be told."
    return "FAIL", f"{stated}: {_earlier_noun(left, right)} is after."


def _period_check(left: Fact, when: When, period: Period) -> tuple[RunStatus, str]:
    bounds = _period_of(period)
    if bounds is None:
        return (
            "NOT_RUN",
            _capital(
                f"the audit period is not set, so {_DATE_NOUN[left.kind]} is not compared with it."
            ),
        )
    stated = _capital(f"{_LEAD[left.kind]} {when_text(when)}")
    if bounds[0] <= when.day <= bounds[1]:
        return "PASS", f"{stated}: within {_period_text(*bounds)}."
    return "FAIL", f"{stated}: outside {_period_text(*bounds)}."


def _match_check(ask: CheckAsk, left: Fact, right: Fact) -> tuple[RunStatus, str]:
    dated = (left.kind in TIME_KINDS, right.kind in TIME_KINDS)
    if dated == (True, True):
        # Two dates are the same when they are the same day: a time is not asked of them.
        first = _read_date(left)
        if isinstance(first, str):
            return "NOT_RUN", first
        second = _read_date(right)
        if isinstance(second, str):
            return "NOT_RUN", second
        stated = _pair(left, when_text(first), right, when_text(second))
        same = first.day == second.day
        words = "the same date" if same else "different dates"
        if ask.test == "SAME" and not same:
            words = "not the same date"
        return ("PASS" if same == (ask.test == "SAME") else "FAIL"), f"{stated}: {words}."
    if dated != (False, False):
        return (
            "NOT_RUN",
            "A date is set against something that is not a date, so the comparison is not made.",
        )
    stated = _pair(left, _shown(left.value), right, _shown(right.value))
    both_systems = left.kind == "SYSTEM" and right.kind == "SYSTEM"
    match = compare_values(left.value, right.value, system=both_systems)
    if match == "UNSURE":
        if ask.test == "SAME":
            return "NOT_RUN", f"{stated}: these cannot be matched with certainty."
        return "NOT_RUN", f"{stated}: these cannot be told apart with certainty."
    if ask.test == "SAME":
        if match == "SAME":
            return "PASS", f"{stated}: the same."
        return "FAIL", f"{stated}: not the same."
    if match == "DIFFERENT":
        return "PASS", f"{stated}: different."
    return "FAIL", f"{stated}: the same."


def run_check(ask: CheckAsk, facts: Mapping[str, Fact], period: Period) -> CheckRun:
    """Make the comparison a reading named, on that reading's own facts.

    NOT_RUN, with the reason, when a fact it names was not stated, a fact's value is not in
    its quote, a fact is of the wrong kind for the test (an order needs dates), a date
    cannot be read or could be read two ways, two records of the same day cannot be put in
    an order, or two values cannot be matched with certainty. PASS or FAIL otherwise, with
    one sentence that states the values.

    Order tests (rule 2 of the module): NOT_AFTER (left at or before right; the same day
    is not after), BEFORE (left strictly before right), WITHIN_DAYS (right is 0 to `days`
    calendar days after left, by the dates as written; right before left fails), IN_PERIOD
    (left's date within the audit period, both bounds known).
    """
    left: Fact | None = None
    right: Fact | None = None

    def result(status: RunStatus, sentence: str) -> CheckRun:
        return CheckRun(ask.attribute, ask.element, ask.test, status, sentence, left, right)

    if ask.test not in CHECK_TESTS:
        return result("NOT_RUN", "This is not a comparison the check makes.")
    paired = ask.test != "IN_PERIOD"
    named = (ask.left, ask.right) if paired else (ask.left,)
    for fact_id in named:
        if not fact_id.strip():
            return result("NOT_RUN", "The comparison does not name both facts, so it is not made.")
        if fact_id not in facts:
            return result(
                "NOT_RUN",
                "The comparison names a fact the reading did not state "
                f"({clean_line(fact_id, 12)}), so it is not made.",
            )
    left = facts[ask.left]
    right = facts[ask.right] if paired else None
    stated = (left, right) if right is not None else (left,)
    if ask.test in ORDER_TESTS:
        for fact in stated:
            if fact.kind not in TIME_KINDS:
                return result(
                    "NOT_RUN",
                    _capital(
                        f"{_NOUN[fact.kind]} is not a date, so it is not put in an order "
                        "or a period."
                    ),
                )
    for fact in stated:
        if not fact_stands(fact):
            return result(
                "NOT_RUN",
                f"The value read for {_NOUN[fact.kind]} ({_shown(fact.value)}) is not in the "
                "passage it was read from, so it is not compared.",
            )
    if right is None:
        when = _read_date(left)
        if isinstance(when, str):
            return result("NOT_RUN", when)
        return result(*_period_check(left, when, period))
    if ask.test not in ORDER_TESTS:
        return result(*_match_check(ask, left, right))
    first = _read_date(left)
    if isinstance(first, str):
        return result("NOT_RUN", first)
    second = _read_date(right)
    if isinstance(second, str):
        return result("NOT_RUN", second)
    return result(*_order_check(ask, left, right, first, second))


def run_checks(
    asks: Sequence[CheckAsk], facts: Mapping[str, Fact], period: Period
) -> tuple[CheckRun, ...]:
    """Make every comparison one reading named, in the order it named them."""
    return tuple(run_check(ask, facts, period) for ask in asks)


# --------------------------------------------------------------------------------------
# The two readings' comparisons, reconciled
# --------------------------------------------------------------------------------------

_RUN_RANK: dict[RunStatus, int] = {"FAIL": 0, "PASS": 1, "NOT_RUN": 2}
_Key = tuple[str, str, CheckTest]


def _facts_agree(one: Fact | None, other: Fact | None) -> bool:
    """Whether two readings' facts hold the same value: the same date, or `same_value`."""
    if one is None or other is None:
        return one is None and other is None
    if (one.kind in TIME_KINDS) != (other.kind in TIME_KINDS):
        return False
    if one.kind in TIME_KINDS:
        first, second = parse_when(one.value), parse_when(other.value)
        if first is not None and second is not None:
            return _same_moment(first, second)
        return _squash(one.value) == _squash(other.value)
    both_systems = one.kind == "SYSTEM" and other.kind == "SYSTEM"
    return same_value(one.value, other.value, system=both_systems)


def _run_facts(run: CheckRun) -> tuple[Fact, ...]:
    return tuple(fact for fact in (run.left, run.right) if fact is not None)


def reconcile_checks(
    first: Sequence[CheckRun], second: Sequence[CheckRun]
) -> tuple[CheckOutcome, ...]:
    """Reconcile the two readings' runs, by attribute, element and test.

    FAILED: both readings ran the comparison, it fails on both, and their values agree: a
    failure shown by the records, whatever either reading answered. FAILED_ONE: it fails
    on a reading and the other passed it, did not run it, or failed it on other values.
    PASSED: a reading passes it and none fails it. NOT_RUN otherwise.

    A reading that names the same comparison twice counts once, by its failure first. The
    sentence and the facts are the failing run's (the first reading's when both fail).
    The outcomes keep the order the comparisons were first named in.
    """
    keys: list[_Key] = []
    chosen: tuple[dict[_Key, CheckRun], dict[_Key, CheckRun]] = ({}, {})
    for runs, mine in zip((first, second), chosen, strict=True):
        for run in runs:
            key: _Key = (run.attribute, run.element, run.test)
            if key not in chosen[0] and key not in chosen[1]:
                keys.append(key)
            held = mine.get(key)
            if held is None or _RUN_RANK[run.status] < _RUN_RANK[held.status]:
                mine[key] = run
    outcomes: list[CheckOutcome] = []
    for key in keys:
        one, other = chosen[0].get(key), chosen[1].get(key)
        present = [run for run in (one, other) if run is not None]
        failed = [run for run in present if run.status == "FAIL"]
        passed = [run for run in present if run.status == "PASS"]
        status: OutcomeStatus
        if failed:
            agreed = (
                len(failed) == 2
                and _facts_agree(failed[0].left, failed[1].left)
                and _facts_agree(failed[0].right, failed[1].right)
            )
            status, told = ("FAILED" if agreed else "FAILED_ONE"), failed[0]
        elif passed:
            status, told = "PASSED", passed[0]
        else:
            status, told = "NOT_RUN", present[0]
        outcomes.append(CheckOutcome(*key, status, told.sentence, _run_facts(told)))
    return tuple(outcomes)


# --------------------------------------------------------------------------------------
# Code's own checks
# --------------------------------------------------------------------------------------


def _agreed(first: Sequence[Fact], second: Sequence[Fact]) -> tuple[Fact, ...]:
    """The first reading's facts that the second states alike: kind, file and value."""
    standing = [fact for fact in second if fact_stands(fact)]
    return tuple(
        fact
        for fact in first
        if fact_stands(fact)
        and any(
            other.kind == fact.kind and other.file_id == fact.file_id and _facts_agree(fact, other)
            for other in standing
        )
    )


def _by_file(facts: Sequence[Fact], kinds: Sequence[FactKind]) -> dict[UUID, list[Fact]]:
    """Facts of the given kinds by file, the files in the order they are first named."""
    grouped: dict[UUID, list[Fact]] = {}
    for fact in facts:
        if fact.kind in kinds:
            grouped.setdefault(fact.file_id, []).append(fact)
    return grouped


def _file_name(file_names: Mapping[UUID, str], file_id: UUID, fallback: str) -> str:
    return clean_line(file_names.get(file_id, ""), NAME_LIMIT).strip() or fallback


def _unlike_form(one: str, other: str) -> bool:
    """Whether one value is a number or reference and the other a name.

    A change number in one file and a person's name in another are not two subjects:
    they are two ways of pointing at an instance, and nothing shows they differ.
    """
    return any(char.isdigit() for char in one) != any(char.isdigit() for char in other)


def concerns(
    first: Sequence[Fact],
    second: Sequence[Fact],
    *,
    system: str,
    period: Period,
    file_names: Mapping[UUID, str],
) -> tuple[Concern, ...]:
    """Code's own checks, made only on facts both readings state alike.

    WRONG_SYSTEM: every system a file names is provably not the control's system (none when
    the control's system is not known). DIFFERENT_SUBJECT: two files whose subjects are
    all provably different, not merely unmatched. OUTSIDE_PERIOD: a file's approval,
    performance or trigger date outside the audit period (none unless both bounds are
    known). One concern per code and set of files, in that order of code and in the order
    the first reading named the files.
    """
    agreed = _agreed(first, second)
    found: list[Concern] = []

    control_system = clean_line(system, VALUE_LIMIT).strip()
    if control_system:
        for file_id, named in _by_file(agreed, ("SYSTEM",)).items():
            if all(different_value(fact.value, system, system=True) for fact in named):
                found.append(
                    Concern(
                        "WRONG_SYSTEM",
                        f"{_file_name(file_names, file_id, 'A file')} names the system "
                        f"{_shown(named[0].value)}; this control is tested on {control_system}.",
                        (file_id,),
                    )
                )

    subjects = list(_by_file(agreed, ("SUBJECT",)).items())
    for index, (file_id, mine) in enumerate(subjects):
        for other_id, theirs in subjects[index + 1 :]:
            if all(
                not _unlike_form(a.value, b.value) and different_value(a.value, b.value)
                for a in mine
                for b in theirs
            ):
                found.append(
                    Concern(
                        "DIFFERENT_SUBJECT",
                        f"{_file_name(file_names, file_id, 'One file')} is about "
                        f"{_shown(mine[0].value)} and "
                        f"{_file_name(file_names, other_id, 'another file')} about "
                        f"{_shown(theirs[0].value)}.",
                        (file_id, other_id),
                    )
                )

    bounds = _period_of(period)
    if bounds is not None:
        for file_id, dated in _by_file(agreed, _PERIOD_KINDS).items():
            for fact in dated:
                when = parse_when(fact.value)
                if when is None or bounds[0] <= when.day <= bounds[1]:
                    continue
                found.append(
                    Concern(
                        "OUTSIDE_PERIOD",
                        _capital(
                            f"{_EVENT[fact.kind]} in "
                            f"{_file_name(file_names, file_id, 'a file')} is dated "
                            f"{date_text(when.day)}, outside {_period_text(*bounds)}."
                        ),
                        (file_id,),
                    )
                )
                break
    return tuple(found)
