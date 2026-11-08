"""The sample of one, traced across a design item's files (migration 0139; decided by the
product owner on 31 October 2026).

The reader judges each file alone, so a population, two system extracts and a ticket that
together walk one leaver through the control each read as not covering the item. The trace
reads them together:

- it recognizes the sample from the evidence: a ticket or document that names a person,
  account or ticket number found in one of the item's listings. Identifiers are matched
  whole (an employee ID, a user name, a full name, a ticket number), never a surname
  alone, and only from columns whose values tell rows apart;
- it proposes the sample with its reasons, and a person confirms it or picks another
  (walkthrough_instances); when nothing names the sample, or several fit, it lists the
  likely rows to pick from, and the person can search the listing;
- it finds the sample in every file and lines up the dates: the event (a termination),
  each system's removal with the business days after the event, set against the limit the
  control states, and activity after the event;
- once a person confirms the sample, what it observes (a removal over the limit, a file
  with no record of the sample, activity after the event) becomes findings with a drafted
  follow-up a person sends; a later pick leaves the earlier pick's findings stale.

Matching and dates are deterministic: no model reads the files here, and the uploaded text
is data, never instructions. The trace never accepts an item: a full trace says the item
is ready for a person to accept. Business days are weekdays; holidays are not known.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.authorization import Action, Principal, _call, _session_principal, authorize
from ai_workforce_api.evidence_extraction import Table, read_table
from ai_workforce_api.evidence_findings import (
    _citation,
    _Draft,
    _fingerprint,
    _mark_stale,
    _plan_revision,
    _record_drafts,
)
from ai_workforce_api.evidence_withdrawn import in_force
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.sampling import key_column, parse_date
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import ObjectStore, StoreError, digest_of, open_store
from ai_workforce_api.walkthrough_instances import (
    InstancesBody,
    InstanceState,
    PickBody,
    _visible,
    pick,
)
from ai_workforce_api.walkthrough_instances import read as read_instances

MAX_FILES = 12
MAX_TABLE_BYTES = 25_000_000
MAX_SUBJECT_VALUES = 24
MAX_ROWS_PER_FILE = 5
MAX_CANDIDATES = 6

Role = Literal["EVENT", "REMOVAL", "ACTIVITY", "OPENED", "CLOSED"]
FileState = Literal[
    "FOUND", "SEVERAL", "NOT_FOUND", "NAMED", "NOT_NAMED", "GENERAL", "READING", "UNREADABLE"
]
TraceStatus = Literal["NO_LISTING", "CHOOSE", "PROPOSED", "CONFIRMED"]
ObservationKind = Literal["LATE", "NOT_TRACED", "ACTIVITY"]

# --- Reading identifiers ---------------------------------------------------------------

_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_ID_HEADER = re.compile(
    r"\b(id|no|number|num|ref|reference|ticket|change|request|incident|case|employee|"
    r"worker|user|username|account|login|logon|sam|email|upn|name|person|requester|"
    r"associate|badge|personnel)\b"
)
_NOT_ID_HEADER = re.compile(
    r"\b(manager|supervisor|department|dept|title|job|reason|type|status|state|description|"
    r"group|role|roles|responsibility|responsibilities|ou|location|company|division|cost|"
    r"approver|assigned|by|date|time|when|day|enabled)\b"
)
_ID_VALUE = re.compile(r"^[a-z0-9._@\\-]{4,}$")
_TOKEN = re.compile(r"[a-z0-9][a-z0-9._@\\-]*")
_NOT_VALUES = frozenset({"true", "false", "yes", "no", "n/a", "none", "null", "active"})


def header_words(header: str) -> str:
    """A column's name as plain lower-case words: "SamAccountName" is "sam account name"."""
    spaced = _CAMEL.sub(" ", header)
    return " ".join(re.sub(r"[^A-Za-z0-9]+", " ", spaced).lower().split())


def normal(value: str) -> str:
    """A value as it is compared: folded, its words joined by one space, a "Last, First"
    name turned round, and stray punctuation at the ends dropped."""
    text = unicodedata.normalize("NFKC", value).casefold().strip()
    parts = [part.strip() for part in text.split(",")]
    if len(parts) == 2 and all(re.fullmatch(r"[^\W\d_]+(?: [^\W\d_]+)*", p) for p in parts):
        text = f"{parts[1]} {parts[0]}"
    tokens = [token.strip("._-@\\") for token in _TOKEN.findall(text)]
    return " ".join(token for token in tokens if token)


def _usable(value: str) -> bool:
    if len(value) < 3 or value in _NOT_VALUES or _date_of(value) is not None:
        return False
    return not (value.isdigit() and len(value) < 4)


def identifier_columns(table: Table) -> list[int]:
    """The columns whose values tell one row from another: named as an identifier (or
    shaped like one), mostly distinct, and not dates."""
    found: list[int] = []
    for index, header in enumerate(table.columns):
        words = header_words(header)
        if _NOT_ID_HEADER.search(words):
            continue
        values = [normal(row[index]) for row in table.rows if row[index].strip()]
        values = [value for value in values if value]
        if not values:
            continue
        if sum(1 for value in values if _date_of(value) is not None) >= 0.6 * len(values):
            continue
        if len(values) >= 3 and len(set(values)) < 0.9 * len(values):
            continue
        named = _ID_HEADER.search(words) is not None
        shaped = sum(
            1 for value in values if _ID_VALUE.match(value) and any(c.isdigit() for c in value)
        ) >= 0.8 * len(values)
        if named or shaped:
            found.append(index)
    return found


def identity(
    columns: Iterable[str], values: Iterable[str], picked: Iterable[int]
) -> dict[str, tuple[str, str]]:
    """A row's identifiers: each compared value, with the column it came from and the
    value as written."""
    headers = list(columns)
    cells = list(values)
    out: dict[str, tuple[str, str]] = {}
    for index in picked:
        if index >= len(cells):
            continue
        value = normal(cells[index])
        if _usable(value):
            out.setdefault(
                value,
                (headers[index] if index < len(headers) else "", clean_line(cells[index], 120)),
            )
    return out


def text_index(text: str) -> frozenset[str]:
    """Every run of one to four words in the text, to look identifiers up whole."""
    tokens = [token.strip("._-@\\") for token in _TOKEN.findall(normal_text(text))]
    tokens = [token for token in tokens if token]
    grams: set[str] = set()
    for size in range(1, 5):
        for start in range(len(tokens) - size + 1):
            grams.add(" ".join(tokens[start : start + size]))
    return frozenset(grams)


def normal_text(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


# --- Dates -----------------------------------------------------------------------------

_COMPACT = re.compile(r"^(20\d{2})(\d{2})(\d{2})(?:\D.*)?$")
_DATE_TOKEN = re.compile(
    r"(?<![\d/-])("
    r"\d{4}-\d{1,2}-\d{1,2}"
    r"|\d{1,2}/\d{1,2}/\d{4}"
    r"|\d{1,2}-[A-Za-z]{3}-\d{4}"
    r"|\d{1,2} [A-Za-z]{3,9} \d{4}"
    r"|[A-Za-z]{3,9} \d{1,2}, \d{4}"
    r"|20\d{6}"
    r")(?![\d/])"
)
_MONTH_FIRST = re.compile(r"^([A-Za-z]{3,9}) (\d{1,2}), (\d{4})$")


def _date_of(value: str) -> date | None:
    text = value.strip()
    if not text:
        return None
    for candidate in (text, text.split(" ")[0]):
        found = parse_date(candidate)
        if found is not None:
            return found
    compact = _COMPACT.match(text)
    if compact:
        try:
            return date(int(compact.group(1)), int(compact.group(2)), int(compact.group(3)))
        except ValueError:
            return None
    first = _MONTH_FIRST.match(text)
    if first:
        return parse_date(f"{first.group(2)} {first.group(1)} {first.group(3)}")
    return None


_EVENT_HEADER = re.compile(
    r"terminat|separat|last (working )?day|leav(e|ing) date|exit date|end of employment"
)
_REMOVAL_HEADER = re.compile(
    r"disabl|deactivat|\bend ?dat|revok|remov|delet|deprovision|\block(ed)?\b|\bwhen changed\b"
)
_ACTIVITY_HEADER = re.compile(r"logon|login|sign ?in|last (activity|access|used|use)")
_OFF = re.compile(r"(?i)^(false|disabled|inactive|no|n|0|end[- ]?dated|terminated)$")


def _spoken(header: str) -> str:
    """A column's name as words: "DisabledDateTime" reads "Disabled date time"."""
    words = header_words(header)
    return words[:1].upper() + words[1:] if words else header


def row_dates(columns: list[str], values: list[str]) -> list[tuple[str, date, Role]]:
    """A listing row's dates that the trace reads: the event, removals, activity. A
    "when changed" date is a removal only where the row says the account is off."""
    words = [header_words(header) for header in columns]
    off = any(
        re.search(r"\b(enabled|status|state)\b", header) and _OFF.match(values[i].strip())
        for i, header in enumerate(words)
        if i < len(values)
    )
    found: list[tuple[str, date, Role]] = []
    for index, header in enumerate(words):
        if index >= len(values):
            continue
        when = _date_of(values[index])
        if when is None:
            continue
        role: Role | None = None
        if _EVENT_HEADER.search(header) and "reason" not in header:
            role = "EVENT"
        elif _REMOVAL_HEADER.search(header):
            role = "REMOVAL" if "when changed" not in header or off else None
        elif _ACTIVITY_HEADER.search(header):
            role = "ACTIVITY"
        if role is not None:
            found.append((_spoken(columns[index]), when, role))
    return found


_TEXT_ROLES: tuple[tuple[Role, re.Pattern[str]], ...] = (
    (
        "EVENT",
        re.compile(
            r"(?i)\b(termination(?: effective)? date|last working day|separation date|"
            r"effective date|leave date)\b"
        ),
    ),
    ("OPENED", re.compile(r"(?i)\b(opened|created|submitted|requested on)\b")),
    ("CLOSED", re.compile(r"(?i)\b(closed|resolved|completed)\b")),
    ("REMOVAL", re.compile(r"(?i)\b(disabled on|deactivated on|access removed on|end[- ]dated)\b")),
)


# A glyph from a PDF font's private area between digits stands for a hyphen or a colon.
_PRIVATE_BETWEEN_DIGITS = re.compile(r"(?<=\d)[\ue000-\uf8ff](?=\d)")


def text_dates(text: str) -> list[tuple[str, date, Role]]:
    """A document's labelled dates: a label, at most two words, then the date."""
    found: list[tuple[str, date, Role]] = []
    for line in _PRIVATE_BETWEEN_DIGITS.sub("-", text).splitlines():
        for role, pattern in _TEXT_ROLES:
            if any(existing[2] == role for existing in found):
                continue
            for label in pattern.finditer(line):
                rest = line[label.end() :]
                gap = re.match(r"^[\s:·|-]*(?:[A-Za-z]+\s+){0,2}", rest)
                after = rest[gap.end() if gap else 0 :]
                token = _DATE_TOKEN.match(after)
                when = None if token is None else _date_of(token.group(1))
                if when is not None:
                    found.append((label.group(1)[:1].upper() + label.group(1)[1:], when, role))
                    break
    return found


def business_days(start: date, end: date) -> int:
    """Weekdays after start up to and including end; negative when end is earlier."""
    if end == start:
        return 0
    step = 1 if end > start else -1
    count = 0
    day = start
    for _ in range(800):
        day += timedelta(days=step)
        if day.weekday() < 5:
            count += step
        if day == end:
            break
    return count


_LIMIT = re.compile(
    r"(?i)\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\d{1,2}\)\s*)?"
    r"-?\s*(business|working)[\s-]+days?\b"
)
_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}  # fmt: skip


def limit_of(texts: Iterable[str]) -> tuple[int | None, str]:
    """The removal limit the control states in business days, and the words it rests on."""
    for text in texts:
        found = _LIMIT.search(text)
        if found:
            word = found.group(1).lower()
            days = int(word) if word.isdigit() else _NUMBERS[word]
            return days, clean_line(found.group(0), 80)
    return None, ""


# --- The trace, from the files as read -------------------------------------------------


@dataclass(frozen=True)
class Listing:
    file_id: str
    file_name: str
    table: Table | None
    # The system the listing says it was run on ("System | Oracle EBS HALPRD"), if any.
    system: str = ""


@dataclass(frozen=True)
class Document:
    file_id: str
    file_name: str
    text: str | None
    reading: bool


@dataclass
class Subject:
    # Each compared value: the column it came from and the value as written.
    values: dict[str, tuple[str, str]]
    rows: dict[str, list[int]]
    weight: float = 0.0
    named_in: list[tuple[str, list[str]]] = field(default_factory=list)


def _expand(
    seed: dict[str, tuple[str, str]], listings: list[Listing], columns: dict[str, list[int]]
) -> Subject:
    """The subject's rows in every listing, gathering the identifiers each row adds (an
    ID in one listing, the user name in the next)."""
    values = dict(seed)
    rows: dict[str, list[int]] = {}
    for _ in range(3):
        grew = False
        for listing in listings:
            if listing.table is None:
                continue
            hits: list[int] = []
            for number, row in enumerate(listing.table.rows):
                own = identity(listing.table.columns, row, columns[listing.file_id])
                if own.keys() & values.keys():
                    hits.append(number)
                    if len(hits) <= 1:
                        for value, entry in own.items():
                            if value not in values and len(values) < MAX_SUBJECT_VALUES:
                                values[value] = entry
                                grew = True
                if len(hits) > MAX_ROWS_PER_FILE:
                    break
            rows[listing.file_id] = hits
        if not grew:
            break
    return Subject(values=values, rows=rows)


def _mentions(index: frozenset[str], subject: Subject) -> list[str]:
    """The subject's values the text names, names first."""
    found = [value for value in subject.values if value in index]
    return sorted(found, key=lambda value: (" " not in value, found.index(value)))


def as_written(subject: Subject, values: list[str]) -> list[str]:
    """Compared values as the files write them."""
    return [subject.values[value][1] if value in subject.values else value for value in values]


def find_subjects(listings: list[Listing], documents: list[Document]) -> list[Subject]:
    """Every subject a document names that a listing holds, weighed by how much of what
    each document names is about it: a ticket naming one leaver weighs one."""
    columns = {
        listing.file_id: ([] if listing.table is None else identifier_columns(listing.table))
        for listing in listings
    }
    indexes = [(document, text_index(document.text)) for document in documents if document.text]
    if not indexes:
        return []
    subjects: list[Subject] = []
    seen: set[str] = set()
    for listing in listings:
        if listing.table is None:
            continue
        for row in listing.table.rows:
            own = identity(listing.table.columns, row, columns[listing.file_id])
            if not own or own.keys() & seen:
                continue
            if not any(value in index for _d, index in indexes for value in own):
                continue
            subject = _expand(own, listings, columns)
            seen |= subject.values.keys()
            subjects.append(subject)
            if len(subjects) >= 40:
                break
    for document, index in indexes:
        named = [(subject, _mentions(index, subject)) for subject in subjects]
        total = sum(len(values) for _s, values in named)
        for subject, values in named:
            if values:
                subject.weight += len(values) / total
                subject.named_in.append((document.file_id, values))
    subjects.sort(key=lambda subject: -subject.weight)
    return subjects


def subject_of(
    listings: list[Listing],
    seed_file: str,
    seed_row: int,
    columns_hint: list[str],
    values_hint: list[str],
) -> Subject:
    """The subject a person picked: from the row in its listing when the listing is still
    on the item, else from the row as recorded at the pick."""
    columns = {
        listing.file_id: ([] if listing.table is None else identifier_columns(listing.table))
        for listing in listings
    }
    for listing in listings:
        if listing.file_id == seed_file and listing.table is not None:
            if 1 <= seed_row <= len(listing.table.rows):
                own = identity(
                    listing.table.columns, listing.table.rows[seed_row - 1], columns[seed_file]
                )
                if own:
                    return _expand(own, listings, columns)
    picked = [
        index
        for index, header in enumerate(columns_hint)
        if _ID_HEADER.search(header_words(header))
        and not _NOT_ID_HEADER.search(header_words(header))
    ]
    return _expand(identity(columns_hint, values_hint, picked), listings, columns)


def label_of(subject: Subject) -> str:
    """How the trace names the subject: "Farah Navarro (101398)", a full name and an ID
    where it has them, as the files write them."""
    name = next(
        (raw for value, (header, raw) in subject.values.items()
         if "name" in header_words(header) and " " in value),
        "",
    )  # fmt: skip
    key = next(
        (raw for _v, (header, raw) in subject.values.items()
         if re.search(r"\b(id|number|no|ticket)\b", header_words(header))),
        "",
    )  # fmt: skip
    if name and key:
        return f"{name} ({key})"
    first = next(iter(subject.values.values()), ("", ""))[1]
    return name or key or first


def noun_of(listings: list[Listing]) -> str:
    """What one sample is, from the listings' identifying column: a person or a ticket."""
    for listing in listings:
        if listing.table is None:
            continue
        key = key_column(listing.table)
        words = "" if key is None else header_words(listing.table.columns[key])
        if re.search(r"\b(ticket|change|request|incident|case|number)\b", words):
            return "ticket"
        if re.search(r"\b(employee|worker|user|account|person|name|login|sam)\b", words):
            return "person"
    return "record"


def anchor_of(subject: Subject, listings: list[Listing]) -> tuple[str, int] | None:
    """The listing row a confirmation records: one with the event date first, then the
    longest listing the subject is in once."""
    best: tuple[tuple[int, int], str, int] | None = None
    for listing in listings:
        found = subject.rows.get(listing.file_id, [])
        if listing.table is None or len(found) != 1:
            continue
        row = list(listing.table.rows[found[0]])
        has_event = any(
            role == "EVENT" for _l, _d, role in row_dates(list(listing.table.columns), row)
        )
        score = (1 if has_event else 0, len(listing.table.rows))
        if best is None or score > best[0]:
            best = (score, listing.file_id, found[0] + 1)
    return None if best is None else (best[1], best[2])


# --- The API's answer -------------------------------------------------------------------


class DateBody(BaseModel):
    label: str
    date: date
    role: Role
    # Business days after the event; None when no event date is known.
    days: int | None = None
    over: bool = False


class TraceFileBody(BaseModel):
    file_id: UUID
    file_name: str
    # The system a listing says it was run on, when it says so.
    system: str = ""
    listing: bool
    state: FileState
    row_number: int | None = None
    summary: str = ""
    dates: list[DateBody] = Field(default_factory=list)


class CandidateBody(BaseModel):
    label: str
    file_id: UUID
    file_name: str
    row_number: int
    reason: str


class ObservationBody(BaseModel):
    kind: ObservationKind
    file_id: UUID
    title: str
    observation: str
    question: str
    expected: str
    recorded: bool = False


class EventBody(BaseModel):
    label: str
    date: date
    file_name: str


class SubjectBody(BaseModel):
    label: str
    identifiers: list[str]
    file_id: UUID
    file_name: str
    row_number: int
    origin: Literal["PROPOSED", "PICKED", "CONFIRMED"]
    named_in_file_id: UUID | None = None
    confirmed_by: str = ""
    confirmed_at: str | None = None


class ListingBody(BaseModel):
    file_id: UUID
    file_name: str
    rows: int


class TraceBody(BaseModel):
    requirement_id: UUID
    status: TraceStatus
    # What one sample is here, for the question: "person", "ticket" or "record".
    noun: str
    subject: SubjectBody | None = None
    reasons: list[str] = Field(default_factory=list)
    candidates: list[CandidateBody] = Field(default_factory=list)
    listings: list[ListingBody] = Field(default_factory=list)
    files: list[TraceFileBody] = Field(default_factory=list)
    event: EventBody | None = None
    limit_days: int | None = None
    limit_words: str = ""
    observations: list[ObservationBody] = Field(default_factory=list)
    ready: bool = False


@dataclass(frozen=True)
class Picked:
    instance_id: UUID
    file_id: str
    row_number: int
    columns: list[str]
    values: list[str]
    origin: str
    named_in: str | None
    by: str
    at: str


def _line_naming(text: str, values: list[str]) -> str:
    """The first line of the document that names the subject, by its name first."""
    lines = text.splitlines()
    for value in values:
        for line in lines:
            if f" {value} " in f" {normal(line)} ":
                return clean_line(line, 160)
    return ""


def build(
    requirement_id: UUID,
    listings: list[Listing],
    documents: list[Document],
    limit: tuple[int | None, str],
    picked: Picked | None,
) -> tuple[TraceBody, Subject | None]:
    """The trace as the files stand: the subject (picked, or proposed), every file's part
    in it, the dates against the event and the limit, and what a person should look at."""
    names = {listing.file_id: listing.file_name for listing in listings}
    names.update({document.file_id: document.file_name for document in documents})
    body = TraceBody(
        requirement_id=requirement_id,
        status="NO_LISTING",
        noun=noun_of(listings),
        limit_days=limit[0],
        limit_words=limit[1],
        listings=[
            ListingBody(
                file_id=UUID(listing.file_id),
                file_name=listing.file_name,
                rows=len(listing.table.rows),
            )
            for listing in listings
            if listing.table is not None
        ],
    )
    subjects = find_subjects(listings, documents)
    subject: Subject | None = None
    if picked is not None:
        subject = subject_of(
            listings, picked.file_id, picked.row_number, picked.columns, picked.values
        )
        named = {document.file_id: document for document in documents}
        for document_id, document in named.items():
            if document.text:
                values = _mentions(text_index(document.text), subject)
                if values:
                    subject.named_in.append((document_id, values))
        body.status = "CONFIRMED"
        body.subject = SubjectBody(
            label=label_of(subject),
            identifiers=sorted(subject.values)[:8],
            file_id=UUID(picked.file_id),
            file_name=names.get(picked.file_id, "the listing"),
            row_number=picked.row_number,
            origin="CONFIRMED" if picked.origin == "CONFIRMED" else "PICKED",
            named_in_file_id=None if picked.named_in is None else UUID(picked.named_in),
            confirmed_by=picked.by,
            confirmed_at=picked.at,
        )
    elif not body.listings:
        body.status = "NO_LISTING"
    else:
        top = subjects[0] if subjects else None
        second = subjects[1].weight if len(subjects) > 1 else 0.0
        anchor = None if top is None else anchor_of(top, listings)
        if (
            top is not None
            and anchor is not None
            and top.weight >= 0.5
            and top.weight >= 2 * second
        ):
            subject = top
            body.status = "PROPOSED"
            named_in = top.named_in[0][0] if top.named_in else None
            body.subject = SubjectBody(
                label=label_of(top),
                identifiers=sorted(top.values)[:8],
                file_id=UUID(anchor[0]),
                file_name=names.get(anchor[0], ""),
                row_number=anchor[1],
                origin="PROPOSED",
                named_in_file_id=None if named_in is None else UUID(named_in),
            )
        else:
            body.status = "CHOOSE"
            for candidate in subjects[:MAX_CANDIDATES]:
                place = anchor_of(candidate, listings)
                if place is None:
                    continue
                where = ", ".join(names.get(file_id, "") for file_id, _v in candidate.named_in[:2])
                body.candidates.append(
                    CandidateBody(
                        label=label_of(candidate),
                        file_id=UUID(place[0]),
                        file_name=names.get(place[0], ""),
                        row_number=place[1],
                        reason=f"Named in {where}" if where else "",
                    )
                )
    if subject is None:
        body.files = [
            TraceFileBody(
                file_id=UUID(document.file_id),
                file_name=document.file_name,
                listing=False,
                state="READING"
                if document.reading
                else ("UNREADABLE" if not document.text else "NOT_NAMED"),
            )
            for document in documents
            if document.reading or not document.text
        ]
        return body, None
    _trace(body, subject, listings, documents, subjects, names)
    return body, subject


def _trace(
    body: TraceBody,
    subject: Subject,
    listings: list[Listing],
    documents: list[Document],
    subjects: list[Subject],
    names: dict[str, str],
) -> None:
    label = label_of(subject)
    reasons: list[str] = []
    for document_id, values in subject.named_in[:3]:
        reasons.append(
            f"{names.get(document_id, 'A document')} names "
            + ", ".join(as_written(subject, values[:3]))
            + "."
        )
    event: tuple[str, date, str] | None = None
    files: list[TraceFileBody] = []
    for listing in listings:
        if listing.table is None:
            files.append(
                TraceFileBody(
                    file_id=UUID(listing.file_id), file_name=listing.file_name, listing=True,
                    system=listing.system,
                    state="UNREADABLE", summary="The listing could not be read as a table.",
                )
            )  # fmt: skip
            continue
        found = subject.rows.get(listing.file_id, [])
        if len(found) == 1:
            row = list(listing.table.rows[found[0]])
            columns = list(listing.table.columns)
            dates = row_dates(columns, row)
            key = key_column(listing.table)
            keyed = f"{columns[key]} {row[key]}" if key is not None else ""
            files.append(
                TraceFileBody(
                    file_id=UUID(listing.file_id), file_name=listing.file_name, listing=True,
                    system=listing.system,
                    state="FOUND", row_number=found[0] + 1,
                    summary=clean_line(
                        f"Row {found[0] + 1}" + (f": {keyed}" if keyed else ""), 200
                    ),
                    dates=[DateBody(label=lbl, date=when, role=role) for lbl, when, role in dates],
                )
            )  # fmt: skip
            if len(reasons) < 6:
                reasons.append(f"Found in {listing.file_name}, row {found[0] + 1}.")
            if event is None:
                event = next(
                    (
                        (lbl, when, listing.file_name)
                        for lbl, when, role in dates
                        if role == "EVENT"
                    ),
                    None,
                )
        else:
            files.append(
                TraceFileBody(
                    file_id=UUID(listing.file_id), file_name=listing.file_name, listing=True,
                    system=listing.system,
                    state="SEVERAL" if found else "NOT_FOUND",
                    summary=(
                        f"{len(found)} rows match {label}." if found else f"No row for {label}."
                    ),
                )
            )  # fmt: skip
    for document in documents:
        if document.reading or not document.text:
            files.append(
                TraceFileBody(
                    file_id=UUID(document.file_id), file_name=document.file_name, listing=False,
                    state="READING" if document.reading else "UNREADABLE",
                    summary="Being read." if document.reading else "The file could not be read.",
                )
            )  # fmt: skip
            continue
        values = _mentions(text_index(document.text), subject)
        if values:
            dates = text_dates(document.text)
            files.append(
                TraceFileBody(
                    file_id=UUID(document.file_id), file_name=document.file_name, listing=False,
                    state="NAMED", summary=_line_naming(document.text, values) or f"Names {label}.",
                    dates=[DateBody(label=lbl, date=when, role=role) for lbl, when, role in dates],
                )
            )  # fmt: skip
            if event is None:
                event = next(
                    (
                        (lbl, when, document.file_name)
                        for lbl, when, role in dates
                        if role == "EVENT"
                    ),
                    None,
                )
        else:
            index = text_index(document.text)
            others = [
                label_of(other)
                for other in subjects
                if other is not subject and _mentions(index, other)
            ]
            # A document about another instance is a point to settle; one that names no
            # one in the listings (a walkthrough memo, a policy) is about no instance.
            files.append(
                TraceFileBody(
                    file_id=UUID(document.file_id), file_name=document.file_name, listing=False,
                    state="NOT_NAMED" if others else "GENERAL",
                    summary=(
                        f"Names {others[0]}, not {label}." if others
                        else "Names no one in the listings: not about a single instance."
                    ),
                )
            )  # fmt: skip
    if event is not None:
        body.event = EventBody(label=event[0], date=event[1], file_name=event[2])
        for entry in files:
            for when in entry.dates:
                when.days = business_days(event[1], when.date)
                when.over = (
                    when.role == "REMOVAL"
                    and body.limit_days is not None
                    and when.days > body.limit_days
                )
    body.files = files
    body.reasons = [clean_line(reason, 240) for reason in reasons[:8]]
    body.observations = _observations(body, label)
    body.ready = (
        body.status == "CONFIRMED"
        and not body.observations
        and not any(entry.state in ("READING", "UNREADABLE") for entry in files)
        and sum(1 for entry in files if entry.state in ("FOUND", "NAMED")) >= 2
    )


def _observations(body: TraceBody, label: str) -> list[ObservationBody]:
    out: list[ObservationBody] = []
    event = body.event
    for entry in body.files:
        if entry.state == "NOT_FOUND":
            out.append(
                ObservationBody(
                    kind="NOT_TRACED", file_id=entry.file_id,
                    title=clean_line(f"No record of {label} in {entry.file_name}", 200),
                    observation=(
                        f"{entry.file_name}"
                        + (f" ({entry.system})" if entry.system else "")
                        + f" has no row for {label}."
                    ),
                    question=(
                        f"Please confirm whether {label} held an account in "
                        f"{entry.system or 'the system ' + entry.file_name + ' covers'}; "
                        "if so, provide the record of its removal."
                    ),
                    expected="The removal record, or confirmation that no account existed",
                )
            )  # fmt: skip
        elif entry.state == "SEVERAL":
            out.append(
                ObservationBody(
                    kind="NOT_TRACED", file_id=entry.file_id,
                    title=clean_line(f"Several rows for {label} in {entry.file_name}", 200),
                    observation=entry.summary,
                    question=(
                        f"Please confirm which record in {entry.file_name} belongs to {label}."
                    ),
                    expected="The record that belongs to the sample",
                )
            )  # fmt: skip
        elif entry.state == "NOT_NAMED":
            out.append(
                ObservationBody(
                    kind="NOT_TRACED", file_id=entry.file_id,
                    title=clean_line(f"{entry.file_name} does not name {label}", 200),
                    observation=f"{entry.file_name}: {entry.summary}",
                    question=(
                        f"Please confirm which instance {entry.file_name} relates to, or provide "
                        f"the document for {label}."
                    ),
                    expected="The document for the sample",
                )
            )  # fmt: skip
        if event is None:
            continue
        removals = [when for when in entry.dates if when.role == "REMOVAL"]
        latest = max(removals, key=lambda when: when.date) if removals else None
        if latest is not None and latest.over:
            out.append(
                ObservationBody(
                    kind="LATE", file_id=entry.file_id,
                    title=clean_line(f"Removal after the limit in {entry.file_name}", 200),
                    observation=(
                        f"{event.label} {event.date:%d %b %Y}; {entry.file_name} shows "
                        f"{latest.label} {latest.date:%d %b %Y}, {latest.days} business days "
                        f"later, over the limit of {body.limit_days}."
                    ),
                    question=(
                        f"Please explain why {label}'s access "
                        + (
                            f"in {entry.system}"
                            if entry.system
                            else f"shown in {entry.file_name}"
                        )
                        + f" was removed {latest.days} business days after the "
                        f"{event.label.lower()}, and provide any escalation for the delay."
                    ),
                    expected="The reason for the delay and its escalation",
                )
            )  # fmt: skip
        used = [when for when in entry.dates if when.role == "ACTIVITY" and when.date > event.date]
        if used:
            when = max(used, key=lambda each: each.date)
            out.append(
                ObservationBody(
                    kind="ACTIVITY", file_id=entry.file_id,
                    title=clean_line(f"Activity after the event in {entry.file_name}", 200),
                    observation=(
                        f"{entry.file_name} shows {when.label} {when.date:%d %b %Y}, after the "
                        f"{event.label.lower()} on {event.date:%d %b %Y}."
                    ),
                    question=(
                        f"Please explain the activity on {when.date:%d %b %Y} after {label}'s "
                        f"{event.label.lower()}, and provide its investigation."
                    ),
                    expected="The investigation of the activity",
                )
            )  # fmt: skip
    return out


# --- The records ------------------------------------------------------------------------


def _item(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any],
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
) -> tuple[str, UUID | None, list[str]]:
    row = connection.execute(
        """
        SELECT q.phase, q.pbc_request_id, q.description, q.objective, c.activity, c.title
        FROM evidence_requirements q
        JOIN engagement_controls c ON c.id = q.engagement_control_id
        WHERE q.id = %s AND q.project_id = %s AND q.engagement_control_id = %s
        """,
        (requirement_id, project_id, control_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    attributes = connection.execute(
        "SELECT coalesce(string_agg(text || ' ' || pass_criteria, ' '), '') "
        "FROM control_attributes WHERE engagement_control_id = %s AND status = 'APPROVED'",
        (control_id,),
    ).fetchone()
    # Where the limit is stated: the control's activity first, then the item, then the
    # approved attributes.
    texts = [
        str(row[4] or ""),
        str(row[2] or ""),
        str(row[3] or ""),
        str(attributes[0] if attributes else ""),
    ]
    return str(row[0]), row[1], texts


def _files(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any],
    project_id: UUID,
    requirement_id: UUID,
    request_id: UUID | None,
) -> list[tuple[Any, ...]]:
    """The item's files: on its request and not filed for another item, or linked to it by
    a person; never a withdrawn file."""
    return connection.execute(
        f"""
        SELECT f.id, f.file_name, f.content_type, f.object_key, f.content_sha256, f.size_bytes,
               a.status, a.extracted_text
        FROM evidence_files f
        LEFT JOIN LATERAL (
            SELECT x.status, x.extracted_text FROM evidence_analyses x
            WHERE x.evidence_file_id = f.id ORDER BY x.created_at DESC LIMIT 1
        ) a ON true
        WHERE f.project_id = %(project)s AND NOT {in_force("f")} AND (
            EXISTS (
                SELECT 1 FROM evidence_file_links l
                WHERE l.evidence_file_id = f.id AND l.pbc_request_id = %(request)s
                  AND NOT EXISTS (
                      SELECT 1 FROM evidence_matches m
                      WHERE m.evidence_file_id = f.id AND m.status = 'FILED'
                        AND m.requirement_id IS NOT NULL AND m.requirement_id <> %(item)s))
            OR EXISTS (
                SELECT 1 FROM evidence_requirement_files ef
                WHERE ef.evidence_file_id = f.id AND ef.requirement_id = %(item)s
                  AND ef.status = 'LINKED')
        )
        ORDER BY f.created_at, f.id
        LIMIT {MAX_FILES}
        """,  # noqa: S608 (constants only)
        {"project": project_id, "request": request_id, "item": requirement_id},
    ).fetchall()


_SYSTEM_LINE = re.compile(r"(?im)^\s*system\s*\|\s*([^|\n]+?)\s*$")


def _load(store: ObjectStore, rows: list[tuple[Any, ...]]) -> tuple[list[Listing], list[Document]]:
    listings: list[Listing] = []
    documents: list[Document] = []
    for file_id, name, content_type, key, sha256, size, status, text in rows:
        spreadsheet = re.search(r"(?i)\.(xlsx|xlsm|xls|csv|tsv)$", str(name)) is not None
        if spreadsheet and int(size or 0) <= MAX_TABLE_BYTES:
            table: Table | None = None
            try:
                content = store.get(str(key))
                if digest_of(content) == sha256:
                    table = read_table(content, str(name), str(content_type or ""))
            except StoreError:
                table = None
            if table is not None and table.rows:
                system = _SYSTEM_LINE.search(str(text or ""))
                listings.append(
                    Listing(
                        str(file_id),
                        str(name),
                        table,
                        "" if system is None else clean_line(system.group(1), 80),
                    )
                )
                continue
        reading = status in (None, "PENDING", "RUNNING")
        documents.append(
            Document(
                str(file_id), str(name), None if reading else (str(text or "") or None), reading
            )
        )
    return listings, documents


def _picked(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any], requirement_id: UUID
) -> Picked | None:
    row = connection.execute(
        """
        SELECT w.id, w.population_file_id, w.row_number, w.columns, w.row_values, w.origin,
               w.named_in_file_id, coalesce(u.display_name, ''), w.created_at
        FROM walkthrough_instances w LEFT JOIN users u ON u.id = w.selected_by
        WHERE w.requirement_id = %s AND w.superseded_at IS NULL
        """,
        (requirement_id,),
    ).fetchone()
    if row is None:
        return None
    return Picked(
        instance_id=UUID(str(row[0])),
        file_id=str(row[1]),
        row_number=int(row[2]),
        columns=[str(c) for c in row[3]],
        values=[str(v) for v in row[4]],
        origin=str(row[5]),
        named_in=None if row[6] is None else str(row[6]),
        by=str(row[7]),
        at=row[8].isoformat(),
    )


def _recorded(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any], instance_id: UUID
) -> set[str]:
    rows = connection.execute(
        "SELECT fingerprint FROM evidence_findings WHERE walkthrough_instance_id = %s",
        (instance_id,),
    ).fetchall()
    return {str(row[0]) for row in rows}


def _print(instance_id: UUID, observation: ObservationBody) -> str:
    return _fingerprint(
        "TRACE", observation.kind, str(instance_id), str(observation.file_id), observation.title
    )


def compute(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any],
    store: ObjectStore,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
) -> tuple[TraceBody, Picked | None, list[Document]]:
    phase, request_id, texts = _item(connection, project_id, control_id, requirement_id)
    rows = _files(connection, project_id, requirement_id, request_id)
    listings, documents = _load(store, rows)
    picked = _picked(connection, requirement_id) if phase == "DESIGN" else None
    body, _subject = build(requirement_id, listings, documents, limit_of(texts), picked)
    if picked is not None:
        recorded = _recorded(connection, picked.instance_id)
        for observation in body.observations:
            observation.recorded = _print(picked.instance_id, observation) in recorded
    return body, picked, documents


def record(
    cursor: psycopg.Cursor[Any],
    store: ObjectStore,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    instance_id: UUID,
    superseded: UUID | None,
) -> int:
    """The confirmed sample's observations as findings, in the pick's transaction; the
    earlier pick's open findings are stale."""
    if superseded is not None:
        for finding_id, status in cursor.execute(
            "SELECT id, status FROM evidence_findings WHERE walkthrough_instance_id = %s "
            "AND NOT stale AND status IN ('PROPOSED', 'ACCEPTED', 'ANSWERED', 'MORE_NEEDED')",
            (superseded,),
        ).fetchall():
            _mark_stale(
                cursor, UUID(str(finding_id)), str(status), "The sample was picked again.",
                {"walkthrough_instance_id": str(instance_id)},
            )  # fmt: skip
    body, picked, documents = compute(cursor, store, project_id, control_id, requirement_id)
    if picked is None or picked.instance_id != instance_id:
        return 0
    texts = {document.file_id: document.text or "" for document in documents}
    sha = {
        str(row[0]): str(row[1])
        for row in cursor.execute(
            "SELECT id, content_sha256 FROM evidence_files WHERE id = ANY(%s)",
            ([entry.file_id for entry in body.files],),
        ).fetchall()
    }
    drafts: list[_Draft] = []
    for observation in body.observations:
        quote = next(
            (entry.summary for entry in body.files
             if entry.file_id == observation.file_id and entry.state == "NAMED"),
            "",
        )  # fmt: skip
        file_name = next(
            (entry.file_name for entry in body.files if entry.file_id == observation.file_id), ""
        )
        drafts.append(
            _Draft(
                source="TRACE", kind=observation.kind,
                fingerprint=_print(instance_id, observation), title=observation.title,
                observation=observation.observation, question=observation.question,
                expected=observation.expected,
                citation=_citation(
                    texts.get(str(observation.file_id), ""), quote, observation.file_id, file_name
                ),
                requirement_id=requirement_id, file_id=observation.file_id,
            )
        )  # fmt: skip
    request = cursor.execute(
        "SELECT pbc_request_id FROM evidence_requirements WHERE id = %s", (requirement_id,)
    ).fetchone()
    created = 0
    for draft in drafts:
        created += len(
            _record_drafts(
                cursor, organization_id, project_id, control_id, [draft],
                analysis_id=None, mapping_run_id=None,
                request_id=None if request is None else request[0],
                plan_revision=_plan_revision(cursor, control_id),
                digest=sha.get(str(draft.file_id), ""), instance_id=instance_id,
            )
        )  # fmt: skip
    return created


def read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    store: ObjectStore,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
) -> TraceBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    _visible(connection, project_id, control_id)
    body, _picked_now, _documents = compute(
        connection, store, project_id, control_id, requirement_id
    )
    return body


class ConfirmBody(BaseModel):
    """A person's sample: the listing row, and, when it is the agent's proposal, the file
    that named it. The reasons recorded are the server's own, never the caller's."""

    file_id: UUID
    row_number: int = Field(ge=1, le=1_000_000)
    proposed: bool = False
    note: str = Field(default="", max_length=500)

    @field_validator("note")
    @classmethod
    def plain(cls, value: str) -> str:
        return clean_line(value, 500)


def confirm(
    connection: psycopg.Connection[Any],
    principal: Principal,
    store: ObjectStore,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    body: ConfirmBody,
) -> TraceBody:
    """Record the sample a person settles on, and its observations as findings. It is the
    agent's proposal only when the row is the one the trace proposes right now."""
    origin: Literal["PICKED", "CONFIRMED"] = "PICKED"
    named: tuple[UUID, str] | None = None
    reasons: list[str] = []
    if body.proposed:
        _visible(connection, project_id, control_id)
        current, _p, _d = compute(connection, store, project_id, control_id, requirement_id)
        subject = current.subject
        if (
            current.status != "PROPOSED"
            or subject is None
            or subject.file_id != body.file_id
            or subject.row_number != body.row_number
        ):
            raise InstanceState("the proposal changed; look at the sample again")
        origin = "CONFIRMED"
        reasons = current.reasons
        if subject.named_in_file_id is not None:
            sha = connection.execute(
                "SELECT content_sha256 FROM evidence_files WHERE id = %s",
                (subject.named_in_file_id,),
            ).fetchone()
            if sha is not None:
                named = (subject.named_in_file_id, str(sha[0]))

    def after(cursor: psycopg.Cursor[Any], instance_id: UUID, superseded: UUID | None) -> None:
        record(
            cursor, store, organization_id, project_id, control_id, requirement_id,
            instance_id, superseded,
        )  # fmt: skip

    pick(
        connection, principal, store, organization_id, project_id, control_id, requirement_id,
        PickBody(file_id=body.file_id, row_number=body.row_number, note=body.note),
        origin=origin, named_in=named, reasons=reasons, after=after,
    )  # fmt: skip
    return read(
        connection, principal, store, organization_id, project_id, control_id, requirement_id
    )


def recorder(
    store: ObjectStore,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
) -> Callable[[psycopg.Cursor[Any], UUID, UUID | None], None]:
    """The findings step for a pick made elsewhere (the evidence dialog's row picker)."""

    def after(cursor: psycopg.Cursor[Any], instance_id: UUID, superseded: UUID | None) -> None:
        record(
            cursor, store, organization_id, project_id, control_id, requirement_id,
            instance_id, superseded,
        )  # fmt: skip

    return after


def register_sample_traces(app: FastAPI, settings: Settings) -> None:
    base = (
        "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"
        "/evidence-requirements/{requirement_id}/sample-trace"
    )

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except InstanceState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None

    @app.get(base, response_model=TraceBody)
    def traced(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        requirement_id: UUID,
        request: Request,
    ) -> TraceBody:
        return run(
            request,
            lambda c, p: read(
                c, p, open_store(settings, c), organization_id, project_id, control_id,
                requirement_id,
            ),
        )  # fmt: skip

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"
        "/evidence-requirements/{requirement_id}/walkthrough-instance",
        response_model=InstancesBody,
    )
    def picked(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        requirement_id: UUID,
        body: PickBody,
        request: Request,
    ) -> InstancesBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> InstancesBody:
            store = open_store(settings, c)
            pick(
                c, p, store, organization_id, project_id, control_id, requirement_id, body,
                after=recorder(store, organization_id, project_id, control_id, requirement_id),
            )  # fmt: skip
            return read_instances(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.post(base, response_model=TraceBody)
    def confirmed(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        requirement_id: UUID,
        body: ConfirmBody,
        request: Request,
    ) -> TraceBody:
        return run(
            request,
            lambda c, p: confirm(
                c, p, open_store(settings, c), organization_id, project_id, control_id,
                requirement_id, body,
            ),
        )  # fmt: skip
