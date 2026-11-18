"""Population checks and reproducible sample selection. Deterministic: no model.

A population is a stored evidence file (a workbook or CSV). The checks say whether it
looks complete for the period: enough rows for the control's frequency, a unique key,
no blank keys, and dates inside the audit period. The sampling frame is every row dated
in the period (every row when there is no date column). Samples are drawn at random
from the frame with a recorded seed, so anyone can draw the same items again from the
same file. A person approves the selection and can replace items with a reason.
"""

import random
import re
import secrets
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from ai_workforce_api.evidence_extraction import Table

CheckResult = Literal["OK", "ISSUE", "INFO"]
# The order of a slashed date's parts: month first (03/04/2027 is 4 March) or day first.
SlashOrder = Literal["mdy", "dmy"]
# How many instances a periodic control should show in a year. A daily control runs on
# working days, about 250 a year by typical practice (bug hunt, 9 November 2026). A
# recurring or event-driven control has no expected count: it runs when the events come.
EXPECTED_OCCURRENCES = {"ANNUAL": 1, "QUARTERLY": 4, "MONTHLY": 12, "WEEKLY": 50, "DAILY": 250}
MAX_SAMPLE = 200

_KEY = re.compile(
    r"(?i)\b(id|no|number|num|ref|reference|ticket|change|request|user ?id|employee|"
    r"invoice|order|document|doc|journal|je|case|incident|job)\b|#"
)
_DATE_HEADER = re.compile(r"(?i)date|time|when|day|granted|approved|created|closed|resolved")
_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$")
_US = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?: .*)?$")
_TEXT_DATE = re.compile(r"^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})$")
# A value that looks like a date even when it cannot be read as one: digits in a date's
# shape, or a month's name beside a number.
_DATE_LIKE = re.compile(
    r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|(?i:\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
    r"[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))"
)
_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1
)}  # fmt: skip


@dataclass(frozen=True)
class PopulationCheck:
    check: str
    result: CheckResult
    detail: str


@dataclass(frozen=True)
class Frame:
    key_column: int | None
    date_column: int | None
    checks: tuple[PopulationCheck, ...]
    # Indexes into table.rows, in file order.
    rows: tuple[int, ...]
    excluded: int
    # The last instance date in the frame, so a roll-forward starts after it.
    covered_to: date | None = None


def period_bounds(period_end: date) -> tuple[date, date]:
    """A twelve-month period ending on the period end."""
    try:
        start = period_end.replace(year=period_end.year - 1) + timedelta(days=1)
    except ValueError:  # 29 February
        start = period_end.replace(year=period_end.year - 1, day=28) + timedelta(days=1)
    return start, period_end


def parse_date(text: str, order: SlashOrder = "mdy") -> date | None:
    """A date as written. A slashed date is read month first unless the order says the
    column writes the day first (slash_order)."""
    value = text.strip()
    for pattern, kind in ((_ISO, "ymd"), (_US, order)):
        match = pattern.match(value)
        if match:
            parts = [int(part) for part in match.groups()]
            year, month, day = (
                (parts[0], parts[1], parts[2])
                if kind == "ymd"
                else (parts[2], parts[0], parts[1])
                if kind == "mdy"
                else (parts[2], parts[1], parts[0])
            )
            try:
                return date(year, month, day)
            except ValueError:
                return None
    match = _TEXT_DATE.match(value)
    if match:
        named = _MONTHS.get(match.group(2).lower())
        if named is not None:
            try:
                return date(int(match.group(3)), named, int(match.group(1)))
            except ValueError:
                return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None


def slash_order(values: list[str]) -> SlashOrder:
    """Whether a column writes its slashed dates day first. A part over 12 can only be the
    day, so the column is read in the order most of those values show, consistently for
    every row: 05/01/2027 in a column that also holds 25/01/2027 is 5 January, not 1 May
    (bug hunt, 9 November 2026). With nothing to tell, month first, as before."""
    day_first = month_first = 0
    for value in values:
        match = _US.match(value.strip())
        if match is None:
            continue
        first, second = int(match.group(1)), int(match.group(2))
        if first > 12 >= second:
            day_first += 1
        elif second > 12 >= first:
            month_first += 1
    return "dmy" if day_first > month_first else "mdy"


def column_order(table: Table, index: int) -> SlashOrder:
    return slash_order([row[index] for row in table.rows if index < len(row)])


def key_column(table: Table) -> int | None:
    """The column that identifies each item: a named ID with the most distinct values."""
    best: tuple[float, int] | None = None
    for index, header in enumerate(table.columns):
        values = [row[index] for row in table.rows if row[index].strip()]
        if not values:
            continue
        distinct = len(set(values)) / len(table.rows)
        named = _KEY.search(header) is not None
        score = distinct + (1.0 if named else 0.0)
        if (named or distinct >= 0.95) and (best is None or score > best[0]):
            best = (score, index)
    return None if best is None else best[1]


def date_column(table: Table) -> int | None:
    """A column named like a date in which most values are dates."""
    best: tuple[float, int] | None = None
    for index, header in enumerate(table.columns):
        if not _DATE_HEADER.search(header):
            continue
        values = [row[index] for row in table.rows if row[index].strip()]
        if not values:
            continue
        order = slash_order(values)
        parsed = sum(1 for value in values if parse_date(value, order) is not None) / len(values)
        if parsed >= 0.6 and (best is None or parsed > best[0]):
            best = (parsed, index)
    return None if best is None else best[1]


def _unreadable_date_column(table: Table) -> str | None:
    """A column named like a date whose values look like dates but cannot be read."""
    for index, header in enumerate(table.columns):
        if not _DATE_HEADER.search(header):
            continue
        values = [row[index] for row in table.rows if index < len(row) and row[index].strip()]
        if values and sum(1 for value in values if _DATE_LIKE.search(value)) * 2 >= len(values):
            return header
    return None


def build_frame(
    table: Table,
    period_end: date | None,
    frequency: str,
    *,
    key: int | None = None,
    when: int | None = None,
    window: tuple[date, date] | None = None,
    size: int | None = None,
) -> Frame:
    """Check the population and decide which rows can be sampled.

    A roll-forward or retest round samples only inside its window, not the whole year.
    The count is judged on the rows in the period, and against the sample size when it is
    known.
    """
    key = key_column(table) if key is None else key
    when = date_column(table) if when is None else when
    checks: list[PopulationCheck] = []
    count = len(table.rows)
    if count == 0:
        checks.append(PopulationCheck("rows", "ISSUE", "The population has no data rows."))
        return Frame(key, when, tuple(checks), (), 0)
    frame = list(range(count))
    excluded = 0
    covered: date | None = None
    period: PopulationCheck
    dated = False
    if when is None:
        unreadable_column = _unreadable_date_column(table)
        if unreadable_column is not None:
            # A date column the checks cannot read is for a person to look at, not a
            # population without dates (bug hunt, 9 November 2026).
            period = PopulationCheck(
                "period",
                "ISSUE",
                f"'{unreadable_column}' looks like a date column, but its values could not be "
                "read as dates, so the period could not be checked. Every row is in the "
                "sampling frame; confirm the rows are in the period.",
            )
        else:
            period = PopulationCheck(
                "period",
                "INFO",
                "No date column was found, so the period could not be checked. Every row "
                "is in the sampling frame.",
            )
    elif period_end is None and window is None:
        period = PopulationCheck("period", "INFO", "The engagement has no period end yet.")
    else:
        dated = True
        start, end = window if window is not None else period_bounds(period_end)  # type: ignore[arg-type]
        order = column_order(table, when)
        dates = [parse_date(row[when], order) for row in table.rows]
        unreadable = sum(1 for value in dates if value is None)
        outside = [
            i for i, value in enumerate(dates) if value is not None and not start <= value <= end
        ]
        inside = [i for i, value in enumerate(dates) if value is not None and start <= value <= end]
        found = [value for value in dates if value is not None]
        name = table.columns[when]
        span = (
            f"'{name}' runs from {min(found).isoformat()} to {max(found).isoformat()}"
            if found
            else f"'{name}' has no dates"
        )
        result: CheckResult = "ISSUE" if outside or unreadable else "OK"
        detail = f"{span}. The period is {start.isoformat()} to {end.isoformat()}."
        if outside:
            plural = "s" if len(outside) != 1 else ""
            detail += f" {len(outside)} row{plural} outside it are left out of the frame."
        if unreadable:
            plural = "s" if unreadable != 1 else ""
            detail += f" {unreadable} row{plural} without a readable date are left out."
        period = PopulationCheck("period", result, detail)
        frame = inside
        excluded = count - len(inside)
        kept = [value for value in dates if value is not None and start <= value <= end]
        covered = max(kept) if kept else None
    # The completeness count is the rows in the period, not every row in the file: a file
    # of two years holds enough rows while the period holds too few (bug hunt, 9 November
    # 2026).
    expected = None if window is not None else EXPECTED_OCCURRENCES.get(frequency)
    if expected is not None and len(frame) < expected:
        counted = f"{len(frame):,} rows in the period" if dated else f"{count:,} rows"
        checks.append(
            PopulationCheck(
                "rows",
                "ISSUE",
                f"{counted}, but a {frequency.lower()} control should show about "
                f"{expected} in a year. Ask whether the population is complete.",
            )
        )
    else:
        checks.append(PopulationCheck("rows", "OK", f"{count:,} data rows."))
    if size is not None and len(frame) < size:
        checks.append(
            PopulationCheck(
                "size",
                "ISSUE",
                f"{len(frame):,} item{'s' if len(frame) != 1 else ''} in the sampling frame, "
                f"fewer than the sample size of {size}. Every item is tested; ask whether "
                "the population is complete.",
            )
        )
    if table.note:
        checks.append(PopulationCheck("read", "ISSUE", table.note))
    if key is None:
        checks.append(
            PopulationCheck(
                "key",
                "INFO",
                "No column identifies each item, so items are listed by row number.",
            )
        )
    else:
        values = [row[key].strip() for row in table.rows]
        blanks = sum(1 for value in values if not value)
        seen: set[str] = set()
        duplicates = 0
        for value in values:
            if value and value in seen:
                duplicates += 1
            seen.add(value)
        name = table.columns[key]
        if duplicates or blanks:
            parts = []
            if duplicates:
                parts.append(f"{duplicates} repeated")
            if blanks:
                parts.append(f"{blanks} blank")
            checks.append(
                PopulationCheck(
                    "key",
                    "ISSUE",
                    f"'{name}' has {' and '.join(parts)} values. Ask the owner to explain "
                    "them, or confirm the population is not duplicated.",
                )
            )
        else:
            checks.append(PopulationCheck("key", "OK", f"'{name}' is unique for every row."))
    checks.append(period)
    return Frame(key, when, tuple(checks), tuple(frame), excluded, covered)


def new_seed() -> int:
    return secrets.randbelow(10**12)


def select(frame: tuple[int, ...], size: int, seed: int) -> list[int]:
    """The same frame, size, and seed always give the same rows, in file order."""
    count = min(size, len(frame), MAX_SAMPLE)
    return sorted(random.Random(seed).sample(list(frame), count))


def explanation(
    *,
    file_name: str,
    sha256: str,
    table: Table,
    frame: Frame,
    size: int,
    selected: int,
    seed: int,
    frequency: str,
    nature: str,
) -> str:
    how_often = frequency.lower().replace("_", "-")
    article = "an" if how_often[:1] in "aeiou" else "a"
    basis = f"{size} for {article} {how_often} {nature.lower().replace('_', '-')} control"
    # A CSV has one unnamed sheet, so only a workbook's sheet is worth naming.
    sheet = "" if table.sheet == "Sheet" else f"sheet {table.sheet}, "
    text = (
        f"Selected {selected} of {len(frame.rows):,} items at random from '{file_name}' "
        f"({sheet}SHA-256 {sha256[:12]}), with seed {seed}. "
        f"The sample size is {basis}."
    )
    if frame.excluded:
        text += (
            f" {frame.excluded} of {len(table.rows):,} rows were left out of the frame "
            "(see the checks)."
        )
    if selected < size:
        text += " The frame has fewer items than the sample size, so every item is tested."
    return text[:2000]
