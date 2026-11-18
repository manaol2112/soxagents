"""Workpaper review notes (docs/workpaper-review.md, sections 1 to 5; migrations 0166, 0167).

A person raises a review note on a workpaper: on one of its fields, on highlighted words
inside a field, or on the workpaper as a whole. A note has a criticality, a status, a
resolution owner, its text and a thread of events. Notes are records of the review: never
deleted, and what a note records never changes (the table refuses it). Every write is a
person's, adds one row to the note's events and one audit event, and moves the note's
`version` on by one, so a page that read the note before the change is told to read it
again.

Who may do what is decided here, by the functions the read uses for its `can` flags:

- read: a person who may read the engagement's work (TASK_READ), for a workpaper of the
  organization and engagement named; not found otherwise, as the workpaper routes answer;
- raise, reply: a person who may update the engagement's work (TASK_UPDATE) or who is its
  reviewer (control_reviews._is_reviewer, the rule the sign-offs use);
- respond (a reply that sets RESPONDED, from OPEN only): the note's resolution owner, or
  the workpaper's preparer: the person who prepared it while it is prepared, and anyone who
  may update the engagement's work while it is a draft;
- clear, reopen, dismiss, change the criticality: the person who raised the note, or a
  reviewer who is not, and has never been, its resolution owner and who did not prepare
  the workpaper (nobody closes a note addressed to them unless they raised it, handing it
  on first included, and a preparer cannot clear a reviewer's note);
- change the owner: the person who raised it, a reviewer, or the current owner, and only
  to a member of the engagement.

An agent is never a principal here: the central layer refuses it before anything is read.
Note text is a person's untrusted text: cleaned as text is, never logged. The highlighted
words are kept exactly as sent, less only control and invisible characters, so that the
page finds the same characters again.

The D&I sign-off is refused while a note of the design workpaper is URGENT and OPEN or
RESPONDED (`urgent_open`, `signoff_refusal`; design_conclusions.sign_off).
"""

import logging
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    authorize,
    permits,
)
from ai_workforce_api.control_reviews import _is_reviewer
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import _CONTROL, _INVISIBLE, clean_text

logger = logging.getLogger(__name__)

AnchorKind = Literal["FIELD", "TEXT", "WORKPAPER"]
Criticality = Literal["URGENT", "NORMAL", "FOLLOW_UP"]
Status = Literal["OPEN", "RESPONDED", "CLEARED", "DISMISSED"]
EventKind = Literal[
    "RAISED", "REPLIED", "RESPONDED", "CLEARED", "REOPENED", "DISMISSED", "CRITICALITY", "OWNER"
]
# What a person does to a note that exists.
Act = Literal["reply", "respond", "clear", "reopen", "dismiss", "criticality", "owner"]

CRITICALITY_WORDS: dict[str, str] = {
    "URGENT": "Urgent",
    "NORMAL": "Normal",
    "FOLLOW_UP": "Follow-up",
}
ROLE_WORDS: dict[str, str] = {"LEAD": "Lead", "PREPARER": "Preparer", "REVIEWER": "Reviewer"}
_STATUS_WORDS: dict[str, str] = {
    "OPEN": "open",
    "RESPONDED": "responded to",
    "CLEARED": "cleared",
    "DISMISSED": "dismissed",
}

TEXT_MIN = 10
TEXT_MAX = 2000
REPLY_MIN = 1
REPLY_MAX = 2000
REASON_MIN = 10
REASON_MAX = 500
QUOTE_MAX = 500
AROUND_MAX = 60
FIELD_MAX = 120
# A field note's copy of the field's text as the person saw it (migration 0167): as long as
# a workpaper section's text can be.
FIELD_TEXT_MAX = 12_000
OCCURRENCE_MAX = 100_000
# How much of a note's, a reply's or a reason's text an audit event carries.
AUDIT_TEXT = 200
# A field's key: letters, digits, dots and hyphens (section 3); opaque to the server.
FIELD_KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9.-]{0,119}")
# A lone surrogate is no character at all, and the database cannot hold one.
_SURROGATE = re.compile("[\ud800-\udfff]")

NOT_MIGRATED = "workpaper review notes are not on record: migration 0166 is not applied"

STALE = "the note changed; read it again"
RAISE_FORBIDDEN = (
    "only a person who may update or review the engagement's work raises a review note"
)
REPLY_FORBIDDEN = (
    "only a person who may update or review the engagement's work replies to a review note"
)
RESPOND_FORBIDDEN = "only the note's resolution owner or the workpaper's preparer responds to it"
DECIDE_FORBIDDEN = (
    "only the person who raised the note, or a reviewer who neither prepared the workpaper "
    "nor is or was its resolution owner, can do this"
)
OWNER_FORBIDDEN = (
    "only the person who raised the note, a reviewer or its resolution owner changes its owner"
)
ALREADY_RESPONDED = "the note already has a response; reply to add to it"
SAME_OWNER = "that person is already the note's resolution owner"
OWNER_NOT_MEMBER = "the resolution owner must be a member of the engagement"
NO_SUCH_VERSION = "the workpaper has no such version"
TEXT_SHORT = f"write the note in at least {TEXT_MIN} characters"
TEXT_LONG = f"the note can be at most {TEXT_MAX} characters"
REPLY_SHORT = "write the reply"
REPLY_LONG = f"the reply can be at most {REPLY_MAX} characters"
REASON_SHORT = f"give the reason in at least {REASON_MIN} characters"
REASON_LONG = f"the reason can be at most {REASON_MAX} characters"
FIELD_NEEDED = "name the field the note is about"
FIELD_NOT_TAKEN = "a note on the workpaper as a whole names no field"
QUOTE_NEEDED = f"a note on highlighted words carries the words, 1 to {QUOTE_MAX} characters"
QUOTE_NOT_TAKEN = "only a note on highlighted words carries the words and where they were"
AROUND_LONG = f"the text around the highlighted words can be at most {AROUND_MAX} characters"
FIELD_TEXT_LONG = f"the field's text can be at most {FIELD_TEXT_MAX} characters"
FIELD_TEXT_NOT_TAKEN = "only a note on a field carries the field's text"


class NoteState(Exception):
    """The note's state does not allow the act: a 409 with a sentence."""

    def __init__(self, detail: str) -> None:
        self.detail = detail


class NoteInvalid(Exception):
    """What was sent is not a note, a reply or a reason: a 422 with a sentence."""

    def __init__(self, detail: str) -> None:
        self.detail = detail


class NoteForbidden(Exception):
    """The person may read the note and may not do this to it: a 403 with a sentence."""

    def __init__(self, detail: str) -> None:
        self.detail = detail


# --- The rules (pure) --------------------------------------------------------------------


@dataclass(frozen=True)
class Viewer:
    """The person acting: who they are, whether they may update the engagement's work
    (TASK_UPDATE), and whether they are its reviewer."""

    id: UUID
    may_update: bool
    reviewer: bool


@dataclass(frozen=True)
class Standing:
    """What the rules read of a note as it stands. `owned_before` is everyone the note was
    handed from or to (its OWNER events): with `owner_id`, everyone it was ever addressed
    to."""

    status: str
    raised_by: UUID
    owner_id: UUID
    owned_before: frozenset[UUID] = frozenset()

    def ever_owned_by(self, person: UUID) -> bool:
        return person == self.owner_id or person in self.owned_before


def clean_quote(raw: str) -> str:
    """The highlighted characters (or the text around them) as sent, less only control and
    invisible characters: zero-width, joiner and direction-override characters, the C0 and
    C1 controls other than tab, line feed and carriage return, and lone surrogates.
    Nothing is trimmed, collapsed or normalized: the page must find the same characters
    again in the field's text."""
    return _CONTROL.sub("", _INVISIBLE.sub("", _SURROGATE.sub("", raw)))


def may_raise(viewer: Viewer) -> bool:
    """Raise a note, or reply to one: a person who may update or review the work."""
    return viewer.may_update or viewer.reviewer


def is_preparer(viewer: Viewer, prepared_by: UUID | None) -> bool:
    """The workpaper's preparer: the person who prepared it while it is prepared
    (`prepared_by`); while it is a draft, anyone who may update the engagement's work."""
    if prepared_by is not None:
        return viewer.id == prepared_by
    return viewer.may_update


def may_respond(viewer: Viewer, note: Standing, prepared_by: UUID | None) -> bool:
    return viewer.id == note.owner_id or is_preparer(viewer, prepared_by)


def may_decide(viewer: Viewer, note: Standing, prepared_by: UUID | None) -> bool:
    """Clear, reopen, dismiss, change the criticality: the person who raised the note, or
    a reviewer who is not, and has never been, its resolution owner (handing a note on does
    not let its owner close it) and who is not the workpaper's preparer of record (a
    preparer who also holds the reviewer role cannot clear a reviewer's note on their own
    workpaper, which would lift the sign-off's hold)."""
    if viewer.id == note.raised_by:
        return True
    return (
        viewer.reviewer
        and not note.ever_owned_by(viewer.id)
        and (prepared_by is None or viewer.id != prepared_by)
    )


def may_change_owner(viewer: Viewer, note: Standing) -> bool:
    return viewer.reviewer or viewer.id in (note.raised_by, note.owner_id)


def allowed(act: Act, viewer: Viewer, note: Standing, prepared_by: UUID | None) -> bool:
    """Whether the person may do this to the note, whatever its status."""
    if act == "reply":
        return may_raise(viewer)
    if act == "respond":
        return may_respond(viewer, note, prepared_by)
    if act == "owner":
        return may_change_owner(viewer, note)
    return may_decide(viewer, note, prepared_by)


_FORBIDDEN: dict[Act, str] = {
    "reply": REPLY_FORBIDDEN,
    "respond": RESPOND_FORBIDDEN,
    "clear": DECIDE_FORBIDDEN,
    "reopen": DECIDE_FORBIDDEN,
    "dismiss": DECIDE_FORBIDDEN,
    "criticality": DECIDE_FORBIDDEN,
    "owner": OWNER_FORBIDDEN,
}
# The statuses each act is taken from. A cleared or dismissed note takes nothing until it
# is reopened.
_FROM: dict[Act, frozenset[str]] = {
    "reply": frozenset({"OPEN", "RESPONDED"}),
    "respond": frozenset({"OPEN"}),
    "clear": frozenset({"OPEN", "RESPONDED"}),
    "reopen": frozenset({"RESPONDED", "CLEARED", "DISMISSED"}),
    "dismiss": frozenset({"OPEN", "RESPONDED"}),
    "criticality": frozenset({"OPEN", "RESPONDED"}),
    "owner": frozenset({"OPEN", "RESPONDED"}),
}
# The status an act leaves the note in, where it changes it.
_TO: dict[Act, Status] = {
    "respond": "RESPONDED",
    "clear": "CLEARED",
    "reopen": "OPEN",
    "dismiss": "DISMISSED",
}


def status_after(act: Act, status: str) -> str:
    return _TO.get(act, status)


def transition_refusal(act: Act, status: str) -> str | None:
    """Why the note's status does not take the act, in a sentence; None where it does."""
    if status in _FROM[act]:
        return None
    if act == "respond" and status == "RESPONDED":
        return ALREADY_RESPONDED
    words = _STATUS_WORDS.get(status, status.lower())
    if _TO.get(act) == status:
        return f"the note is already {words}"
    return f"the note is {words}; reopen it first"


class CanBody(BaseModel):
    """What the caller may do to the note now."""

    reply: bool
    respond: bool
    clear: bool
    reopen: bool
    dismiss: bool
    criticality: bool
    owner: bool


def can_of(
    viewer: Viewer, note: Standing, prepared_by: UUID | None, engagement_open: bool
) -> CanBody:
    """The acts the person may take on the note as it stands, by the rules the writes
    apply; none on a completed or archived engagement."""

    def can(act: Act) -> bool:
        return (
            engagement_open
            and allowed(act, viewer, note, prepared_by)
            and transition_refusal(act, note.status) is None
        )

    return CanBody(
        reply=can("reply"),
        respond=can("respond"),
        clear=can("clear"),
        reopen=can("reopen"),
        dismiss=can("dismiss"),
        criticality=can("criticality"),
        owner=can("owner"),
    )


def signoff_refusal(urgent: int) -> str | None:
    """What keeps a sign-off waiting on the workpaper's urgent notes; None where none is
    open or responded to."""
    if urgent < 1:
        return None
    return f"clear or dismiss the urgent review notes first ({urgent})"


def _cleaned(raw: str, least: int, most: int, short: str, long: str) -> str:
    cleaned = clean_text(raw, most)
    if cleaned.truncated:
        raise NoteInvalid(long)
    if len(cleaned.text) < least:
        raise NoteInvalid(short)
    return cleaned.text


def clean_note(raw: str) -> str:
    return _cleaned(raw, TEXT_MIN, TEXT_MAX, TEXT_SHORT, TEXT_LONG)


def clean_reply(raw: str) -> str:
    return _cleaned(raw, REPLY_MIN, REPLY_MAX, REPLY_SHORT, REPLY_LONG)


def clean_reason(raw: str) -> str:
    return _cleaned(raw, REASON_MIN, REASON_MAX, REASON_SHORT, REASON_LONG)


@dataclass(frozen=True)
class Anchor:
    kind: AnchorKind
    field: str
    quote: str
    prefix: str
    suffix: str
    occurrence: int
    # FIELD only: the field's text when the note was raised, as the page sent it; None where
    # it sent none.
    field_text: str | None = None


def anchor_of(
    kind: AnchorKind,
    field: str,
    quote: str | None,
    prefix: str | None,
    suffix: str | None,
    occurrence: int | None,
    field_text: str | None = None,
) -> Anchor:
    """What the note is about, as it is stored; NoteInvalid where it is not one of the
    three: highlighted words name their field and the words, a field names itself and no
    words, the workpaper as a whole names neither. A field note may carry the field's text
    as the person saw it, kept as highlighted words are (`clean_quote`), so that the page
    can say the field changed since: a field keyed by its place (procedures.2) is otherwise
    moved silently to other text (migration 0167)."""
    if kind == "WORKPAPER":
        if field != "":
            raise NoteInvalid(FIELD_NOT_TAKEN)
    elif FIELD_KEY.fullmatch(field) is None:
        raise NoteInvalid(FIELD_NEEDED)
    if kind != "FIELD" and field_text is not None:
        raise NoteInvalid(FIELD_TEXT_NOT_TAKEN)
    if kind != "TEXT":
        if quote or prefix or suffix or occurrence:
            raise NoteInvalid(QUOTE_NOT_TAKEN)
        seen = None if field_text is None else clean_quote(field_text)
        if seen is not None and len(seen) > FIELD_TEXT_MAX:
            raise NoteInvalid(FIELD_TEXT_LONG)
        return Anchor(kind, field, "", "", "", 0, seen)
    words = clean_quote(quote or "")
    if not 1 <= len(words) <= QUOTE_MAX:
        raise NoteInvalid(QUOTE_NEEDED)
    before, after = clean_quote(prefix or ""), clean_quote(suffix or "")
    if len(before) > AROUND_MAX or len(after) > AROUND_MAX:
        raise NoteInvalid(AROUND_LONG)
    return Anchor(kind, field, words, before, after, occurrence or 0)


# --- The bodies --------------------------------------------------------------------------


class RaiseBody(BaseModel):
    """A new note. The texts are read and bounded in code, so that each refusal is one
    plain sentence; the limits here only keep a request small."""

    model_config = ConfigDict(extra="forbid")

    anchor_kind: AnchorKind
    field: str = Field(default="", max_length=FIELD_MAX)
    quote: str | None = Field(default=None, max_length=4 * QUOTE_MAX)
    prefix: str | None = Field(default=None, max_length=4 * AROUND_MAX)
    suffix: str | None = Field(default=None, max_length=4 * AROUND_MAX)
    occurrence: int | None = Field(default=None, ge=0, le=OCCURRENCE_MAX)
    # A field note's copy of the field's text as the person saw it (FIELD only; optional).
    field_text: str | None = Field(default=None, max_length=4 * FIELD_TEXT_MAX)
    workpaper_version: int = Field(ge=1)
    text: str = Field(max_length=4 * TEXT_MAX)
    criticality: Criticality
    owner_id: UUID


class ReplyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(max_length=4 * REPLY_MAX)
    # A response: the note goes from OPEN to RESPONDED.
    responds: bool = False
    version: int = Field(ge=1)


class ClearBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)


class ReopenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(max_length=4 * REPLY_MAX)
    version: int = Field(ge=1)


class DismissBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(max_length=4 * REASON_MAX)
    version: int = Field(ge=1)


class CriticalityBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criticality: Criticality
    version: int = Field(ge=1)


class OwnerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_id: UUID
    version: int = Field(ge=1)


class PersonRef(BaseModel):
    id: UUID
    name: str


class EventBody(BaseModel):
    """One thing that happened to a note. `text` is the person's own (a reply, a reason);
    `data` is what changed: {from, to}, with the two people's names for an owner."""

    id: UUID
    kind: EventKind
    by: PersonRef
    at: datetime
    text: str
    data: dict[str, Any]


class NoteBody(BaseModel):
    id: UUID
    number: int
    anchor_kind: AnchorKind
    field: str
    quote: str
    prefix: str
    suffix: str
    occurrence: int
    # FIELD only: the field's text when the note was raised; null where it was not sent
    # (or the note predates migration 0167). The page compares it with the field's text now
    # and says where the field changed since.
    field_text: str | None = None
    workpaper_version: int
    text: str
    criticality: Criticality
    status: Status
    owner: PersonRef
    raised_by: PersonRef
    raised_at: datetime
    cleared_by: PersonRef | None
    cleared_at: datetime | None
    dismissed_by: PersonRef | None
    dismissed_at: datetime | None
    dismiss_reason: str
    version: int
    events: list[EventBody]
    can: CanBody


class MemberBody(BaseModel):
    """A person who can own a note: a member of the engagement. `role` is their role on
    it in words (Lead, Preparer, Reviewer)."""

    id: UUID
    name: str
    role: str


class CountsBody(BaseModel):
    open: int
    responded: int
    cleared: int
    dismissed: int
    # The urgent notes that are open or responded to: what holds a sign-off.
    urgent_open: int


class NotesBody(BaseModel):
    notes: list[NoteBody]
    members: list[MemberBody]
    can_raise: bool
    # Whether the caller is the engagement's reviewer.
    can_review: bool
    counts: CountsBody
    # The workpaper's preparer where they can own a note, for the form's first choice:
    # who prepared it, else who last edited it, else who opened it. Null where none of
    # them is a member of the engagement.
    default_owner_id: UUID | None = None


def counts_of(notes: list[NoteBody]) -> CountsBody:
    def count(status: str) -> int:
        return sum(1 for note in notes if note.status == status)

    return CountsBody(
        open=count("OPEN"),
        responded=count("RESPONDED"),
        cleared=count("CLEARED"),
        dismissed=count("DISMISSED"),
        urgent_open=sum(
            1
            for note in notes
            if note.criticality == "URGENT" and note.status in ("OPEN", "RESPONDED")
        ),
    )


# --- Reading -----------------------------------------------------------------------------


@dataclass(frozen=True)
class _Paper:
    id: UUID
    organization_id: UUID
    current_version: int
    prepared_by: UUID | None


def _viewer(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> Viewer:
    """The person, once the central layer allows them to read the engagement's work. An
    agent is refused there, before anything is read."""
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    may_update = permits(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    return Viewer(principal.id, may_update, _is_reviewer(connection, project_id, principal.id))


def _paper(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    lock: bool = False,
) -> _Paper:
    """The workpaper, of the organization and engagement named; not found otherwise.
    Locked where a note is raised, so that its notes are numbered one at a time."""
    row = connection.execute(
        "SELECT organization_id, current_version, prepared_by FROM workpapers "
        "WHERE id = %s AND project_id = %s AND organization_id = %s"
        + (" FOR UPDATE" if lock else ""),
        (workpaper_id, project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _Paper(
        workpaper_id,
        UUID(str(row[0])),
        int(row[1]),
        None if row[2] is None else UUID(str(row[2])),
    )


def _engagement_open(connection: psycopg.Connection[Any], project_id: UUID) -> bool:
    """Whether the engagement takes changes: not completed or archived (engagement_close,
    whose middleware refuses every change under one that is)."""
    from ai_workforce_api.engagement_close import CLOSED

    row = connection.execute("SELECT status FROM projects WHERE id = %s", (project_id,)).fetchone()
    return row is not None and str(row[0]) not in CLOSED


def members(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> list[MemberBody]:
    """The people who can own a note: the engagement's members who can read its work (an
    active person with an active membership of the firm, as the task assignees are
    listed; a demo identity only on a demo engagement), by name."""
    rows = connection.execute(
        """
        SELECT u.id, u.display_name, pm.engagement_role
        FROM project_memberships AS pm
        JOIN projects AS p ON p.id = pm.project_id AND p.organization_id = pm.organization_id
        JOIN users AS u ON u.id = pm.user_id
        JOIN memberships AS m
          ON m.organization_id = pm.organization_id AND m.user_id = pm.user_id
        WHERE pm.organization_id = %s
          AND pm.project_id = %s
          AND p.deleted_at IS NULL
          AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
          AND (u.demo_organization_id IS NULL OR p.demo)
        ORDER BY u.display_name, u.id
        """,
        (organization_id, project_id),
    ).fetchall()
    return [
        MemberBody(
            id=UUID(str(row[0])),
            name=str(row[1]),
            role=ROLE_WORDS.get(str(row[2]), str(row[2]).capitalize()),
        )
        for row in rows
    ]


def _default_owner(
    connection: psycopg.Connection[Any], workpaper_id: UUID, people: list[MemberBody]
) -> UUID | None:
    """The workpaper's preparer for a new note's owner: who prepared it, else the person
    who last edited it, else who opened it; the first of them who can own a note."""
    row = connection.execute(
        """
        SELECT w.prepared_by,
               (SELECT v.created_by FROM workpaper_versions v
                WHERE v.workpaper_id = w.id AND v.source = 'PERSON' AND v.created_by IS NOT NULL
                ORDER BY v.number DESC LIMIT 1),
               w.requested_by
        FROM workpapers w WHERE w.id = %s
        """,
        (workpaper_id,),
    ).fetchone()
    if row is None:
        return None
    able = {person.id for person in people}
    for candidate in row:
        if candidate is not None and UUID(str(candidate)) in able:
            return UUID(str(candidate))
    return None


_NOTES = """
    SELECT n.id, n.number, n.anchor_kind, n.field, n.quote, n.prefix, n.suffix, n.occurrence,
           n.workpaper_version, n.text, n.criticality, n.status,
           n.owner_id, o.display_name, n.raised_by, r.display_name, n.raised_at,
           n.cleared_by, c.display_name, n.cleared_at,
           n.dismissed_by, d.display_name, n.dismissed_at, n.dismiss_reason, n.version,
           n.field_text
    FROM workpaper_review_notes AS n
    JOIN users AS o ON o.id = n.owner_id
    JOIN users AS r ON r.id = n.raised_by
    LEFT JOIN users AS c ON c.id = n.cleared_by
    LEFT JOIN users AS d ON d.id = n.dismissed_by
    WHERE n.workpaper_id = %s AND n.project_id = %s AND n.organization_id = %s
      AND (%s::uuid IS NULL OR n.id = %s::uuid)
    ORDER BY n.number
"""


def handed(owner_events: Iterable[Any]) -> frozenset[UUID]:
    """Everyone a note was handed from or to, read from its OWNER events' data ({from,
    to}); what is not a person's id is passed over."""
    people: set[UUID] = set()
    for data in owner_events:
        if not isinstance(data, dict):
            continue
        for key in ("from", "to"):
            try:
                people.add(UUID(str(data[key])))
            except KeyError, ValueError:
                continue
    return frozenset(people)


def _person(user_id: Any, name: Any) -> PersonRef | None:
    return None if user_id is None else PersonRef(id=UUID(str(user_id)), name=str(name or ""))


def _notes(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    paper: _Paper,
    viewer: Viewer,
    engagement_open: bool,
    only: UUID | None = None,
) -> list[NoteBody]:
    """The workpaper's notes in their order (or the one named), each with its events,
    oldest first, and what the viewer may do to it now."""
    rows = connection.execute(
        _NOTES, (paper.id, project_id, paper.organization_id, only, only)
    ).fetchall()
    events: dict[UUID, list[EventBody]] = {UUID(str(row[0])): [] for row in rows}
    if events:
        for event in connection.execute(
            """
            SELECT e.note_id, e.id, e.kind, e.by, u.display_name, e.at, e.text, e.data
            FROM workpaper_review_note_events AS e
            JOIN users AS u ON u.id = e.by
            WHERE e.note_id = ANY(%s)
            ORDER BY e.at, e.id
            """,
            (list(events),),
        ).fetchall():
            events[UUID(str(event[0]))].append(
                EventBody(
                    id=UUID(str(event[1])),
                    kind=event[2],
                    by=PersonRef(id=UUID(str(event[3])), name=str(event[4])),
                    at=event[5],
                    text=str(event[6]),
                    data=event[7] if isinstance(event[7], dict) else {},
                )
            )
    found: list[NoteBody] = []
    for row in rows:
        note_id, owner, raised_by = UUID(str(row[0])), UUID(str(row[12])), UUID(str(row[14]))
        standing = Standing(
            status=str(row[11]),
            raised_by=raised_by,
            owner_id=owner,
            owned_before=handed(event.data for event in events[note_id] if event.kind == "OWNER"),
        )
        found.append(
            NoteBody(
                id=note_id,
                number=int(row[1]),
                anchor_kind=row[2],
                field=str(row[3]),
                quote=str(row[4]),
                prefix=str(row[5]),
                suffix=str(row[6]),
                occurrence=int(row[7]),
                field_text=None if row[25] is None else str(row[25]),
                workpaper_version=int(row[8]),
                text=str(row[9]),
                criticality=row[10],
                status=row[11],
                owner=PersonRef(id=owner, name=str(row[13])),
                raised_by=PersonRef(id=raised_by, name=str(row[15])),
                raised_at=row[16],
                cleared_by=_person(row[17], row[18]),
                cleared_at=row[19],
                dismissed_by=_person(row[20], row[21]),
                dismissed_at=row[22],
                dismiss_reason=str(row[23]),
                version=int(row[24]),
                events=events[note_id],
                can=can_of(viewer, standing, paper.prepared_by, engagement_open),
            )
        )
    return found


def read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
) -> NotesBody:
    """The workpaper's notes, the people who can own one, and what the caller may do."""
    viewer = _viewer(connection, principal, organization_id, project_id)
    paper = _paper(connection, organization_id, project_id, workpaper_id)
    engagement_open = _engagement_open(connection, project_id)
    notes = _notes(connection, project_id, paper, viewer, engagement_open)
    people = members(connection, organization_id, project_id)
    return NotesBody(
        notes=notes,
        members=people,
        can_raise=engagement_open and paper.current_version >= 1 and may_raise(viewer),
        can_review=viewer.reviewer,
        counts=counts_of(notes),
        default_owner_id=_default_owner(connection, workpaper_id, people),
    )


def urgent_open(connection: psycopg.Connection[Any], workpaper_id: UUID) -> int:
    """How many notes of the workpaper are URGENT and OPEN or RESPONDED: what holds its
    sign-off. Where migration 0166 is not applied yet there is no note on record, so none
    holds it: the savepoint leaves the caller's transaction as it was."""
    try:
        with connection.transaction():
            row = connection.execute(
                "SELECT count(*) FROM workpaper_review_notes WHERE workpaper_id = %s "
                "AND criticality = 'URGENT' AND status IN ('OPEN', 'RESPONDED')",
                (workpaper_id,),
            ).fetchone()
    except psycopg.errors.UndefinedTable:
        logger.warning(NOT_MIGRATED)
        return 0
    return 0 if row is None else int(row[0])


# --- Writing -----------------------------------------------------------------------------


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    note_id: UUID,
    kind: EventKind,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'workpaper_review_note', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor,
            f"workpaper_review_note.{kind.lower()}",
            note_id,
            Json(payload),
        ),
    )


def _event(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    note_id: UUID,
    kind: EventKind,
    actor: UUID,
    text: str,
    data: dict[str, Any],
) -> UUID:
    row = cursor.execute(
        """
        INSERT INTO workpaper_review_note_events (
            organization_id, project_id, note_id, kind, by, text, data
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (organization_id, project_id, note_id, kind, actor, text, Json(data)),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def raise_note(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    body: RaiseBody,
) -> NoteBody:
    """A person raises a note on the workpaper, on any version it has, prepared or draft.
    The workpaper's row is locked while the note takes the next number."""
    viewer = _viewer(connection, principal, organization_id, project_id)
    _paper(connection, organization_id, project_id, workpaper_id)
    if not may_raise(viewer):
        raise NoteForbidden(RAISE_FORBIDDEN)
    anchor = anchor_of(
        body.anchor_kind, body.field, body.quote, body.prefix, body.suffix, body.occurrence,
        body.field_text,
    )  # fmt: skip
    text = clean_note(body.text)
    with transaction(connection) as cursor:
        paper = _paper(connection, organization_id, project_id, workpaper_id, lock=True)
        if not 1 <= body.workpaper_version <= paper.current_version:
            raise NoteInvalid(NO_SUCH_VERSION)
        if body.owner_id not in {person.id for person in members(connection, organization_id,
                                                                 project_id)}:  # fmt: skip
            raise NoteInvalid(OWNER_NOT_MEMBER)
        row = cursor.execute(
            """
            INSERT INTO workpaper_review_notes (
                organization_id, project_id, workpaper_id, number, anchor_kind, field, quote,
                prefix, suffix, occurrence, field_text, workpaper_version, text, criticality,
                owner_id, raised_by
            )
            SELECT %s, %s, %s,
                   coalesce((SELECT max(n.number) FROM workpaper_review_notes n
                             WHERE n.workpaper_id = %s), 0) + 1,
                   %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            RETURNING id, number
            """,
            (
                paper.organization_id, project_id, workpaper_id, workpaper_id, anchor.kind,
                anchor.field, anchor.quote, anchor.prefix, anchor.suffix, anchor.occurrence,
                anchor.field_text, body.workpaper_version, text, body.criticality,
                body.owner_id, viewer.id,
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
        note_id, number = UUID(str(row[0])), int(row[1])
        event_id = _event(
            cursor, paper.organization_id, project_id, note_id, "RAISED", viewer.id, "", {}
        )
        _audit(
            cursor, paper.organization_id, project_id, viewer.id, note_id, "RAISED",
            {
                "workpaper_id": str(workpaper_id),
                "note_id": str(note_id),
                "event_id": str(event_id),
                "number": number,
                "kind": "RAISED",
                "anchor_kind": anchor.kind,
                "field": anchor.field,
                "workpaper_version": body.workpaper_version,
                "criticality": body.criticality,
                "status": "OPEN",
                "owner_id": str(body.owner_id),
                "text": text[:AUDIT_TEXT],
            },
        )  # fmt: skip
    return _one(connection, project_id, paper, viewer, note_id)


def _one(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    paper: _Paper,
    viewer: Viewer,
    note_id: UUID,
) -> NoteBody:
    """The note as it stands after a write, as the read gives it."""
    found = _notes(
        connection, project_id, paper, viewer, _engagement_open(connection, project_id), note_id
    )
    if not found:
        raise NotVisible()
    return found[0]


@dataclass(frozen=True)
class _Locked:
    """A note as it stands, locked until the act commits."""

    id: UUID
    number: int
    status: str
    criticality: str
    owner_id: UUID
    owner_name: str
    raised_by: UUID
    version: int
    owned_before: frozenset[UUID]

    @property
    def standing(self) -> Standing:
        return Standing(
            status=self.status,
            raised_by=self.raised_by,
            owner_id=self.owner_id,
            owned_before=self.owned_before,
        )


def _locked(cursor: psycopg.Cursor[Any], project_id: UUID, paper: _Paper, note_id: UUID) -> _Locked:
    row = cursor.execute(
        """
        SELECT n.number, n.status, n.criticality, n.owner_id, o.display_name, n.raised_by,
               n.version
        FROM workpaper_review_notes AS n
        JOIN users AS o ON o.id = n.owner_id
        WHERE n.id = %s AND n.workpaper_id = %s AND n.project_id = %s AND n.organization_id = %s
        FOR UPDATE OF n
        """,
        (note_id, paper.id, project_id, paper.organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    # Who the note was ever handed from or to: its OWNER events, written only under this
    # lock, so none is added before the act commits.
    owners = cursor.execute(
        "SELECT data FROM workpaper_review_note_events WHERE note_id = %s AND kind = 'OWNER'",
        (note_id,),
    ).fetchall()
    return _Locked(
        id=note_id,
        number=int(row[0]),
        status=str(row[1]),
        criticality=str(row[2]),
        owner_id=UUID(str(row[3])),
        owner_name=str(row[4]),
        raised_by=UUID(str(row[5])),
        version=int(row[6]),
        owned_before=handed(owner[0] for owner in owners),
    )


def _act[T](
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    note_id: UUID,
    act: Act,
    version: int,
    prepare: Callable[[_Locked], T],
    record: Callable[[T, _Locked], tuple[EventKind, str, dict[str, Any], dict[str, Any]]],
) -> NoteBody:
    """One act on a note that exists, in one transaction: the note locked; refused where
    the page's copy is stale, where the person may not, where what was sent is not valid
    (`prepare`) and where the note's status does not take it, in that order; then the
    note's row, its event and the audit event. `record` gives the event's kind, its text,
    what changed (`data`), and the columns that change (criticality, owner_id); it refuses
    a change to what the note already has."""
    viewer = _viewer(connection, principal, organization_id, project_id)
    paper = _paper(connection, organization_id, project_id, workpaper_id)
    with transaction(connection) as cursor:
        note = _locked(cursor, project_id, paper, note_id)
        if note.version != version:
            raise NoteState(STALE)
        if not allowed(act, viewer, note.standing, paper.prepared_by):
            raise NoteForbidden(_FORBIDDEN[act])
        sent = prepare(note)
        refusal = transition_refusal(act, note.status)
        if refusal is not None:
            raise NoteState(refusal)
        kind, text, data, changes = record(sent, note)
        status = status_after(act, note.status)
        criticality = str(changes.get("criticality", note.criticality))
        owner_id = changes.get("owner_id", note.owner_id)
        changed = cursor.execute(
            """
            UPDATE workpaper_review_notes
            SET status = %(status)s::text, criticality = %(criticality)s, owner_id = %(owner)s,
                cleared_by = CASE WHEN %(status)s::text = 'CLEARED' THEN %(actor)s::uuid END,
                cleared_at = CASE WHEN %(status)s::text = 'CLEARED' THEN clock_timestamp() END,
                dismissed_by = CASE WHEN %(status)s::text = 'DISMISSED' THEN %(actor)s::uuid END,
                dismissed_at = CASE WHEN %(status)s::text = 'DISMISSED'
                                    THEN clock_timestamp() END,
                dismiss_reason = CASE WHEN %(status)s::text = 'DISMISSED'
                                      THEN %(reason)s::text ELSE '' END,
                version = version + 1
            WHERE id = %(id)s AND version = %(version)s
            """,
            {
                "status": status,
                "criticality": criticality,
                "owner": owner_id,
                "actor": viewer.id,
                "reason": text if act == "dismiss" else "",
                "id": note.id,
                "version": note.version,
            },
        ).rowcount
        if changed != 1:
            raise NoteState(STALE)
        event_id = _event(
            cursor, paper.organization_id, project_id, note.id, kind, viewer.id, text, data
        )
        payload: dict[str, Any] = {
            "workpaper_id": str(workpaper_id),
            "note_id": str(note.id),
            "event_id": str(event_id),
            "number": note.number,
            "kind": kind,
            "criticality": criticality,
            "status": status,
            "text": text[:AUDIT_TEXT],
        }
        if data:
            payload["from"], payload["to"] = data.get("from"), data.get("to")
        _audit(cursor, paper.organization_id, project_id, viewer.id, note.id, kind, payload)
    return _one(connection, project_id, paper, viewer, note.id)


def reply(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    note_id: UUID,
    body: ReplyBody,
) -> NoteBody:
    """A reply on the note's thread. With `responds`, the resolution owner's or the
    preparer's response: the note goes from OPEN to RESPONDED."""

    def record(text: str, note: _Locked) -> tuple[EventKind, str, dict[str, Any], dict[str, Any]]:
        if body.responds:
            return "RESPONDED", text, {"from": note.status, "to": "RESPONDED"}, {}
        return "REPLIED", text, {}, {}

    return _act(
        connection, principal, organization_id, project_id, workpaper_id, note_id,
        "respond" if body.responds else "reply", body.version,
        lambda _note: clean_reply(body.text), record,
    )  # fmt: skip


def clear(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    note_id: UUID,
    body: ClearBody,
) -> NoteBody:
    return _act(
        connection, principal, organization_id, project_id, workpaper_id, note_id,
        "clear", body.version, lambda _note: None,
        lambda _sent, note: ("CLEARED", "", {"from": note.status, "to": "CLEARED"}, {}),
    )  # fmt: skip


def reopen(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    note_id: UUID,
    body: ReopenBody,
) -> NoteBody:
    """Back to OPEN, saying why: from CLEARED, DISMISSED or RESPONDED."""
    return _act(
        connection, principal, organization_id, project_id, workpaper_id, note_id,
        "reopen", body.version, lambda _note: clean_reply(body.text),
        lambda text, note: ("REOPENED", text, {"from": note.status, "to": "OPEN"}, {}),
    )  # fmt: skip


def dismiss(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    note_id: UUID,
    body: DismissBody,
) -> NoteBody:
    return _act(
        connection, principal, organization_id, project_id, workpaper_id, note_id,
        "dismiss", body.version, lambda _note: clean_reason(body.reason),
        lambda reason, note: (
            "DISMISSED", reason, {"from": note.status, "to": "DISMISSED"}, {},
        ),
    )  # fmt: skip


def set_criticality(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    note_id: UUID,
    body: CriticalityBody,
) -> NoteBody:
    def record(_sent: None, note: _Locked) -> tuple[EventKind, str, dict[str, Any], dict[str, Any]]:
        if note.criticality == body.criticality:
            raise NoteState(f"the note is already {CRITICALITY_WORDS[body.criticality]}")
        return (
            "CRITICALITY", "", {"from": note.criticality, "to": body.criticality},
            {"criticality": body.criticality},
        )  # fmt: skip

    return _act(
        connection, principal, organization_id, project_id, workpaper_id, note_id,
        "criticality", body.version, lambda _note: None, record,
    )  # fmt: skip


def set_owner(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    note_id: UUID,
    body: OwnerBody,
) -> NoteBody:
    """The note is handed to another member of the engagement."""

    def named(_note: _Locked) -> str:
        people = {person.id: person.name for person in members(connection, organization_id,
                                                               project_id)}  # fmt: skip
        if body.owner_id not in people:
            raise NoteInvalid(OWNER_NOT_MEMBER)
        return people[body.owner_id]

    def record(name: str, note: _Locked) -> tuple[EventKind, str, dict[str, Any], dict[str, Any]]:
        if body.owner_id == note.owner_id:
            raise NoteState(SAME_OWNER)
        return (
            "OWNER", "",
            {"from": str(note.owner_id), "to": str(body.owner_id),
             "from_name": note.owner_name, "to_name": name},
            {"owner_id": body.owner_id},
        )  # fmt: skip

    return _act(
        connection, principal, organization_id, project_id, workpaper_id, note_id,
        "owner", body.version, named, record,
    )  # fmt: skip


# --- The routes --------------------------------------------------------------------------


class Run(Protocol):
    """The workpaper routes' own runner: the session's principal, and the central layer's
    answers for not visible and not allowed."""

    def __call__[T](
        self, request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]
    ) -> T: ...


def register_workpaper_review_notes(app: FastAPI, base: str, run: Run) -> None:
    """The routes of section 5, registered with the workpaper routes (workpaper_service)."""
    notes = f"{base}/{{workpaper_id}}/review-notes"
    note = f"{notes}/{{note_id}}"

    def answered[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        try:
            return run(request, work)
        except NoteState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except NoteInvalid as error:
            raise HTTPException(status_code=422, detail=error.detail) from None
        except NoteForbidden as error:
            raise HTTPException(status_code=403, detail=error.detail) from None

    @app.get(notes, response_model=NotesBody)
    def review_notes(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, request: Request
    ) -> NotesBody:
        return answered(request, lambda c, p: read(c, p, organization_id, project_id, workpaper_id))

    @app.post(notes, response_model=NoteBody)
    def raise_review_note(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, body: RaiseBody,
        request: Request,
    ) -> NoteBody:  # fmt: skip
        return answered(
            request,
            lambda c, p: raise_note(c, p, organization_id, project_id, workpaper_id, body),
        )

    @app.post(f"{note}/reply", response_model=NoteBody)
    def reply_to_review_note(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, note_id: UUID,
        body: ReplyBody, request: Request,
    ) -> NoteBody:  # fmt: skip
        return answered(
            request,
            lambda c, p: reply(c, p, organization_id, project_id, workpaper_id, note_id, body),
        )

    @app.post(f"{note}/clear", response_model=NoteBody)
    def clear_review_note(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, note_id: UUID,
        body: ClearBody, request: Request,
    ) -> NoteBody:  # fmt: skip
        return answered(
            request,
            lambda c, p: clear(c, p, organization_id, project_id, workpaper_id, note_id, body),
        )

    @app.post(f"{note}/reopen", response_model=NoteBody)
    def reopen_review_note(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, note_id: UUID,
        body: ReopenBody, request: Request,
    ) -> NoteBody:  # fmt: skip
        return answered(
            request,
            lambda c, p: reopen(c, p, organization_id, project_id, workpaper_id, note_id, body),
        )

    @app.post(f"{note}/dismiss", response_model=NoteBody)
    def dismiss_review_note(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, note_id: UUID,
        body: DismissBody, request: Request,
    ) -> NoteBody:  # fmt: skip
        return answered(
            request,
            lambda c, p: dismiss(c, p, organization_id, project_id, workpaper_id, note_id, body),
        )

    @app.post(f"{note}/criticality", response_model=NoteBody)
    def change_review_note_criticality(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, note_id: UUID,
        body: CriticalityBody, request: Request,
    ) -> NoteBody:  # fmt: skip
        return answered(
            request,
            lambda c, p: set_criticality(
                c, p, organization_id, project_id, workpaper_id, note_id, body
            ),
        )

    @app.post(f"{note}/owner", response_model=NoteBody)
    def change_review_note_owner(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, note_id: UUID,
        body: OwnerBody, request: Request,
    ) -> NoteBody:  # fmt: skip
        return answered(
            request,
            lambda c, p: set_owner(c, p, organization_id, project_id, workpaper_id, note_id, body),
        )


__all__ = [
    "CRITICALITY_WORDS",
    "STALE",
    "Anchor",
    "CanBody",
    "NoteBody",
    "NoteForbidden",
    "NoteInvalid",
    "NoteState",
    "NotesBody",
    "Standing",
    "Viewer",
    "allowed",
    "anchor_of",
    "can_of",
    "clean_note",
    "clean_quote",
    "clean_reason",
    "clean_reply",
    "clear",
    "counts_of",
    "dismiss",
    "handed",
    "is_preparer",
    "may_change_owner",
    "may_decide",
    "may_raise",
    "may_respond",
    "members",
    "raise_note",
    "read",
    "register_workpaper_review_notes",
    "reopen",
    "reply",
    "set_criticality",
    "set_owner",
    "signoff_refusal",
    "status_after",
    "transition_refusal",
    "urgent_open",
]
