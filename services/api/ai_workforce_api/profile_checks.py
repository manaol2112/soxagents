"""Whether an engagement's period agrees with how the engagement describes itself.

The period end is a record; the name, the scope narrative, and the fiscal year label are
words. When the words name another year (or another year end), the records and the words
disagree, and a person settles it: by correcting one, or by confirming the period as
recorded. Nothing here changes a date. A name never decides the period: the checks only
point out the disagreement.

Only strong signals count, so an ordinary narrative is not flagged: a year named in the
engagement's name; a fiscal year named in the narrative; a full date in the narrative on
the period end's day and month in another year (an interim date is not a period end); the
fiscal year label; and the period's order and length.
"""

import hashlib
import re
from datetime import UTC, date, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel

from ai_workforce_api.setup_suggest import fiscal_year_of, with_fiscal_year

Kind = Literal[
    "NAME_YEAR", "SCOPE_DATE", "SCOPE_YEAR", "FISCAL_YEAR", "PERIOD_ORDER", "PERIOD_LENGTH"
]

_MONTHS = {
    name: number
    for number, names in enumerate(
        [
            ("january", "jan"), ("february", "feb"), ("march", "mar"), ("april", "apr"),
            ("may",), ("june", "jun"), ("july", "jul"), ("august", "aug"),
            ("september", "sep", "sept"), ("october", "oct"), ("november", "nov"),
            ("december", "dec"),
        ],
        start=1,
    )
    for name in names
}  # fmt: skip
_MONTH = r"(" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\.?"
_ISO = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
_MONTH_FIRST = re.compile(rf"\b{_MONTH}\s+(\d{{1,2}}),?\s+(20\d{{2}})\b", re.I)
_DAY_FIRST = re.compile(rf"\b(\d{{1,2}})\s+{_MONTH}\s+(20\d{{2}})\b", re.I)
_FISCAL = re.compile(r"\b(?:FY|fiscal\s+year)\s*'?(\d{4}|\d{2})\b", re.I)


class PeriodConflict(BaseModel):
    kind: Kind
    message: str
    # Blocking holds launch until fixed or confirmed; the rest are worth knowing.
    blocking: bool
    # For a name that points at another year: the period end moved to that year, and the
    # name with its year changed to the period's (decided by the product owner: the
    # conflict is corrected where it is shown). None where they do not apply.
    period_end_fix: date | None = None
    name_fix: str | None = None
    # For a scope or fiscal year label that names another year: the same words with that
    # year changed to the period's (decided by the product owner on 27 October 2026: the
    # conflict is corrected, with confirming as recorded the exception).
    scope_fix: str | None = None
    fiscal_year_fix: str | None = None


def _dates(text: str) -> list[date]:
    found: list[date] = []
    for year, month, day in _ISO.findall(text):
        found += _date(int(year), int(month), int(day))
    for month, day, year in _MONTH_FIRST.findall(text):
        found += _date(int(year), _MONTHS[month.lower().rstrip(".")], int(day))
    for day, month, year in _DAY_FIRST.findall(text):
        found += _date(int(year), _MONTHS[month.lower().rstrip(".")], int(day))
    return found


def _date(year: int, month: int, day: int) -> list[date]:
    try:
        return [date(year, month, day)]
    except ValueError:
        return []


def _fiscal_years(text: str) -> list[int]:
    return [int(raw) + (2000 if len(raw) == 2 else 0) for raw in _FISCAL.findall(text)]


def _in_year(value: date, year: int) -> date:
    """The same day of the year in another year; 29 February becomes the 28th."""
    try:
        return value.replace(year=year)
    except ValueError:
        return value.replace(year=year, day=28)


def _with_year(match: re.Match[str], group: int, year: str) -> str:
    """The matched words with one group, the year, written as another."""
    start, end = match.span(group)
    offset = match.start()
    whole = match.group(0)
    return whole[: start - offset] + year + whole[end - offset :]


def _fiscal_in_year(text: str, year: int) -> str:
    """Each fiscal year named in the words moved to a year, written as it was (FY26 stays
    two digits)."""

    def moved(match: re.Match[str]) -> str:
        raw = match.group(1)
        return _with_year(match, 1, str(year) if len(raw) == 4 else f"{year % 100:02d}")

    return _FISCAL.sub(moved, text)


def _scope_in_year(scope: str, period_end: date) -> str:
    """The scope with each year end on the period end's day in another year, and each
    fiscal year it names, moved to the period's year; the rest as written."""
    year = str(period_end.year)

    def dated(year_group: int, month_of: Any, day_of: Any) -> Any:
        def moved(match: re.Match[str]) -> str:
            month, day = month_of(match), day_of(match)
            if (month, day) == (period_end.month, period_end.day):
                return _with_year(match, year_group, year)
            return match.group(0)

        return moved

    text = _ISO.sub(dated(1, lambda m: int(m.group(2)), lambda m: int(m.group(3))), scope)
    text = _MONTH_FIRST.sub(
        dated(3, lambda m: _MONTHS[m.group(1).lower().rstrip(".")], lambda m: int(m.group(2))),
        text,
    )
    text = _DAY_FIRST.sub(
        dated(3, lambda m: _MONTHS[m.group(2).lower().rstrip(".")], lambda m: int(m.group(1))),
        text,
    )
    return _fiscal_in_year(text, period_end.year)


def _long(value: date) -> str:
    return f"{value.day} {value.strftime('%B %Y')}"


def period_conflicts(
    name: str,
    scope: str,
    period_start: date | None,
    period_end: date | None,
    fiscal_year: str,
    today: date,
) -> list[PeriodConflict]:
    """Where the period and the engagement's own words disagree."""
    conflicts: list[PeriodConflict] = []
    if period_end is None:
        return conflicts
    ends = _long(period_end)
    corrected = _scope_in_year(scope, period_end)
    scope_fix = corrected if corrected != scope else None
    named = fiscal_year_of(name, today)
    if named is not None and named != period_end.year:
        conflicts.append(
            PeriodConflict(
                kind="NAME_YEAR",
                message=f"The engagement's name points to {named}, but the period ends {ends}.",
                blocking=True,
                period_end_fix=_in_year(period_end, named),
                name_fix=with_fiscal_year(name, period_end.year),
            )
        )
    year_ends = sorted(
        {
            found
            for found in _dates(scope)
            if (found.month, found.day) == (period_end.month, period_end.day)
            and found != period_end
        }
    )
    if year_ends:
        conflicts.append(
            PeriodConflict(
                kind="SCOPE_DATE",
                message=f"The scope says the period ends {_long(year_ends[0])}, but the "
                f"period end is {ends}.",
                blocking=True,
                scope_fix=scope_fix,
            )
        )
    scope_years = sorted({year for year in _fiscal_years(scope) if year != period_end.year})
    if scope_years and not year_ends:
        conflicts.append(
            PeriodConflict(
                kind="SCOPE_YEAR",
                message=f"The scope names fiscal year {scope_years[0]}, but the period ends "
                f"{ends}.",
                blocking=True,
                scope_fix=scope_fix,
            )
        )
    labelled = _fiscal_years(fiscal_year) or [
        int(match) for match in re.findall(r"\b(20\d{2})\b", fiscal_year)
    ]
    if labelled and labelled[0] != period_end.year:
        label = fiscal_year.strip()
        fixed = _fiscal_in_year(label, period_end.year)
        if fixed == label:
            fixed = re.sub(r"\b20\d{2}\b", str(period_end.year), label, count=1)
        conflicts.append(
            PeriodConflict(
                kind="FISCAL_YEAR",
                message=f"The fiscal year is {label}, but the period ends {ends}.",
                blocking=True,
                fiscal_year_fix=fixed if fixed != label else None,
            )
        )
    if period_start is not None:
        if period_start >= period_end:
            conflicts.append(
                PeriodConflict(
                    kind="PERIOD_ORDER",
                    message="The period starts on or after it ends.",
                    blocking=True,
                )
            )
        else:
            days = (period_end - period_start).days + 1
            if not 350 <= days <= 380:
                conflicts.append(
                    PeriodConflict(
                        kind="PERIOD_LENGTH",
                        message=f"The period is {days} days long; a SOX period is usually "
                        "twelve months. Fine for a short or transition period.",
                        blocking=False,
                    )
                )
    return conflicts


def basis(
    name: str, scope: str, period_start: date | None, period_end: date | None, fiscal_year: str
) -> str:
    """What a confirmation was checked against: any change to these asks again."""
    text = "\n".join(
        [
            " ".join(name.split()),
            " ".join(scope.split()),
            "" if period_start is None else period_start.isoformat(),
            "" if period_end is None else period_end.isoformat(),
            " ".join(fiscal_year.split()),
        ]
    )
    return hashlib.sha256(text.encode()).hexdigest()[:32]


class PeriodState(BaseModel):
    """The period's checks as of now, and whether a person confirmed it as recorded."""

    conflicts: list[PeriodConflict]
    basis: str
    # The confirmation counts only for what it was checked against.
    confirmed: bool
    confirmed_by: str | None = None
    confirmed_at: datetime | None = None

    @property
    def open(self) -> list[PeriodConflict]:
        """The blocking conflicts no person has confirmed."""
        return [] if self.confirmed else [c for c in self.conflicts if c.blocking]


def period_state(connection: psycopg.Connection[Any], project_id: UUID) -> PeriodState:
    row = connection.execute(
        """
        SELECT p.name, p.scope, s.period_start, s.period_end, s.fiscal_year,
               s.period_confirmed_basis, u.display_name, s.period_confirmed_at
        FROM projects p
        JOIN engagement_settings s ON s.project_id = p.id
        LEFT JOIN users u ON u.id = s.period_confirmed_by
        WHERE p.id = %s
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        return PeriodState(conflicts=[], basis="", confirmed=False)
    name, scope, start, end, fiscal = str(row[0]), str(row[1]), row[2], row[3], str(row[4])
    now = basis(name, scope, start, end, fiscal)
    confirmed = row[5] == now and now != ""
    return PeriodState(
        conflicts=period_conflicts(name, scope, start, end, fiscal, datetime.now(UTC).date()),
        basis=now,
        confirmed=confirmed,
        confirmed_by=None if not confirmed or row[6] is None else str(row[6]),
        confirmed_at=row[7] if confirmed else None,
    )
