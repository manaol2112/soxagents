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
# How many instances a periodic control should show in a year.
EXPECTED_OCCURRENCES = {"ANNUAL": 1, "QUARTERLY": 4, "MONTHLY": 12, "WEEKLY": 50}
MAX_SAMPLE = 200

_KEY = re.compile(
    r"(?i)\b(id|no|number|num|ref|reference|ticket|change|request|user ?id|employee|"
    r"invoice|order|document|doc|journal|je|case|incident|job)\b|#"
)
_DATE_HEADER = re.compile(r"(?i)date|time|when|day|granted|approved|created|closed|resolved")
_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$")
_US = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?: .*)?$")
_TEXT_DATE = re.compile(r"^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})$")
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


def parse_date(text: str) -> date | None:
    value = text.strip()
    for pattern, order in ((_ISO, "ymd"), (_US, "mdy")):
        match = pattern.match(value)
        if match:
            parts = [int(part) for part in match.groups()]
            year, month, day = (
                (parts[0], parts[1], parts[2]) if order == "ymd" else (parts[2], parts[0], parts[1])
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
        parsed = sum(1 for value in values if parse_date(value) is not None) / len(values)
        if parsed >= 0.6 and (best is None or parsed > best[0]):
            best = (parsed, index)
    return None if best is None else best[1]


def build_frame(
    table: Table,
    period_end: date | None,
    frequency: str,
    *,
    key: int | None = None,
    when: int | None = None,
    window: tuple[date, date] | None = None,
) -> Frame:
    """Check the population and decide which rows can be sampled.

    A roll-forward or retest round samples only inside its window, not the whole year.
    """
    key = key_column(table) if key is None else key
    when = date_column(table) if when is None else when
    checks: list[PopulationCheck] = []
    count = len(table.rows)
    if count == 0:
        checks.append(PopulationCheck("rows", "ISSUE", "The population has no data rows."))
        return Frame(key, when, tuple(checks), (), 0)
    expected = None if window is not None else EXPECTED_OCCURRENCES.get(frequency)
    if expected is not None and count < expected:
        checks.append(
            PopulationCheck(
                "rows",
                "ISSUE",
                f"{count:,} rows, but a {frequency.lower()} control should show about "
                f"{expected} in a year. Ask whether the population is complete.",
            )
        )
    else:
        checks.append(PopulationCheck("rows", "OK", f"{count:,} data rows."))
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
    frame = list(range(count))
    excluded = 0
    if when is None:
        checks.append(
            PopulationCheck(
                "period",
                "INFO",
                "No date column was found, so the period could not be checked. Every row "
                "is in the sampling frame.",
            )
        )
    elif period_end is None and window is None:
        checks.append(PopulationCheck("period", "INFO", "The engagement has no period end yet."))
    else:
        start, end = window if window is not None else period_bounds(period_end)  # type: ignore[arg-type]
        dates = [parse_date(row[when]) for row in table.rows]
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
        checks.append(PopulationCheck("period", result, detail))
        frame = inside
        excluded = count - len(inside)
        kept = [value for value in dates if value is not None and start <= value <= end]
        covered = max(kept) if kept else None
        return Frame(key, when, tuple(checks), tuple(frame), excluded, covered)
    return Frame(key, when, tuple(checks), tuple(frame), excluded)


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
