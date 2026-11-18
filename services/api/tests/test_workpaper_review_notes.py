"""Workpaper review notes (docs/workpaper-review.md, sections 1 to 5; migration 0166).
Synthetic data only.

Audit integrity:

- a note is a person's (never an agent's), raised by someone who may update or review the
  engagement's work, on a workpaper of their own organization and engagement, on a version
  it has; the highlighted words are stored exactly as sent;
- every write adds one event row and one audit event (never more than 200 characters of
  text) and moves the note's version on, and a stale page changes nothing;
- the resolution owner or the workpaper's preparer responds; only the person who raised a
  note, or a reviewer who is not and never was its owner and who did not prepare the
  workpaper, clears, reopens, dismisses or re-rates it: a preparer cannot clear or dismiss
  a reviewer's note, even holding the reviewer role, and an owner does not close a note
  addressed to them by handing it on first;
- a field note keeps the field's text as the person saw it, where the page sends it
  (migration 0167), and what it kept never changes;
- what a note records never changes and a note or an event is never deleted (the tables
  refuse it), and an archived engagement's notes are read-only;
- the D&I sign-off is refused while a note of the design workpaper is urgent and open or
  responded to, and never held by another note; where migration 0166 is not applied the
  sign-off works as before.
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Json
from support import Database
from test_design_conclusion_choice import _Draft
from test_execution import _ready
from test_outbound import migrated
from test_workpaper_drafts import _Desk

from ai_workforce_api import workpaper_review_notes as review_notes
from ai_workforce_api import workpaper_service
from ai_workforce_api.authorization import AccessDenied, NotVisible, Principal, PrincipalKind
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.engagement_close import closed_detail
from ai_workforce_api.inbound import clean_text
from ai_workforce_api.workpaper_review_notes import (
    ALREADY_RESPONDED,
    AROUND_LONG,
    DECIDE_FORBIDDEN,
    FIELD_NEEDED,
    FIELD_NOT_TAKEN,
    FIELD_TEXT_LONG,
    FIELD_TEXT_MAX,
    FIELD_TEXT_NOT_TAKEN,
    NO_SUCH_VERSION,
    OWNER_FORBIDDEN,
    OWNER_NOT_MEMBER,
    QUOTE_NEEDED,
    QUOTE_NOT_TAKEN,
    RAISE_FORBIDDEN,
    REASON_LONG,
    REASON_SHORT,
    REPLY_FORBIDDEN,
    REPLY_LONG,
    REPLY_SHORT,
    RESPOND_FORBIDDEN,
    SAME_OWNER,
    STALE,
    TEXT_LONG,
    TEXT_SHORT,
    signoff_refusal,
    urgent_open,
)

__all__ = ["migrated"]

NOTE = "The understanding does not say who approves the access."
REASON = "Raised on the wrong control; nothing to change here."
ACTS = ("reply", "respond", "clear", "reopen", "dismiss", "criticality", "owner")
NO_COUNTS = {"open": 0, "responded": 0, "cleared": 0, "dismissed": 0, "urgent_open": 0}


def _refused(answer: Any, status: int, detail: str) -> None:
    assert (answer.status_code, answer.json()["detail"]) == (status, detail), answer.text


def _can(note: dict[str, Any]) -> set[str]:
    assert set(note["can"]) == set(ACTS)
    return {act for act, allowed in note["can"].items() if allowed}


class _Notes:
    """The review notes of one workpaper of a desk (its design workpaper unless another is
    named), as the routes give them, and as the tables hold them."""

    def __init__(self, desk: _Desk, paper_id: str | None = None) -> None:
        self.desk = desk
        self.database = desk.database
        self.paper_id = paper_id or desk.paper_id
        self.url = f"{desk.base}/{self.paper_id}/review-notes"
        self.owner_id: UUID = desk.team["owner_id"]

    def rows(self, query: str, *params: Any) -> list[tuple[Any, ...]]:
        with connect(self.database.url) as connection:
            return list(connection.execute(query, params).fetchall())

    def name(self, user_id: Any) -> str:
        return str(self.rows("SELECT display_name FROM users WHERE id = %s", user_id)[0][0])

    def person(self, user_id: Any) -> dict[str, str]:
        return {"id": str(user_id), "name": self.name(user_id)}

    def version(self) -> int:
        [(current,)] = self.rows(
            "SELECT current_version FROM workpapers WHERE id = %s", self.paper_id
        )
        return int(current)

    def reviewer(self, role: str = "CONTRIBUTOR") -> tuple[UUID, TestClient]:
        """A member of the engagement who is its reviewer."""
        user, client = self.desk.member(role)
        with connect(self.database.url) as connection:
            connection.execute(
                "UPDATE project_memberships SET engagement_role = 'REVIEWER' "
                "WHERE project_id = %s AND user_id = %s",
                (self.desk.team["project"], user),
            )
        return user, client

    def prepare(self) -> None:
        """The engagement's owner prepares the design workpaper: its preparer of record. A
        conclusion is recorded on it first, as preparing it needs (docs/design-workpaper.md,
        section 3.7)."""
        self.desk.conclude()
        paper = self.desk.paper()
        prepared = self.desk.owner.post(
            f"{self.desk.base}/{self.desk.paper_id}/prepare", json={"version": paper["version"]}
        )
        assert prepared.status_code == 200, prepared.text

    def read(self, client: TestClient | None = None) -> dict[str, Any]:
        found = (client or self.desk.owner).get(self.url)
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    def note(self, note_id: str, client: TestClient | None = None) -> dict[str, Any]:
        found: dict[str, Any] = next(n for n in self.read(client)["notes"] if n["id"] == note_id)
        return found

    def body(self, **over: Any) -> dict[str, Any]:
        return {
            "anchor_kind": "FIELD",
            "field": "understanding",
            "workpaper_version": self.version(),
            "text": NOTE,
            "criticality": "NORMAL",
            "owner_id": str(self.owner_id),
        } | over

    def post(self, client: TestClient | None = None, **over: Any) -> Any:
        return (client or self.desk.owner).post(self.url, json=self.body(**over))

    def raised(self, client: TestClient | None = None, **over: Any) -> dict[str, Any]:
        answer = self.post(client, **over)
        assert answer.status_code == 200, answer.text
        body: dict[str, Any] = answer.json()
        return body

    def act(self, note_id: str, action: str, client: TestClient | None = None, **body: Any) -> Any:
        """One act on a note, sent with the version the note has now unless one is given."""
        if "version" not in body:
            body["version"] = self.note(note_id)["version"]
        return (client or self.desk.owner).post(f"{self.url}/{note_id}/{action}", json=body)

    def done(
        self, note_id: str, action: str, client: TestClient | None = None, **body: Any
    ) -> dict[str, Any]:
        answer = self.act(note_id, action, client, **body)
        assert answer.status_code == 200, answer.text
        found: dict[str, Any] = answer.json()
        # The answer is the note as the same person reads it afterwards.
        assert found == self.note(note_id, client)
        return found

    def trail(self, note_id: str) -> list[tuple[Any, ...]]:
        """The note's events on record, oldest first: kind, who, text, what changed."""
        return self.rows(
            "SELECT kind, by, text, data FROM workpaper_review_note_events "
            "WHERE note_id = %s ORDER BY at, id",
            note_id,
        )

    def audited(self, note_id: str) -> list[tuple[Any, ...]]:
        """The note's audit events, oldest first: action, who, payload."""
        return self.rows(
            "SELECT action, actor_user_id, payload FROM audit_events "
            "WHERE target_type = 'workpaper_review_note' AND target_id = %s "
            "ORDER BY occurred_at, id",
            note_id,
        )

    def state(self) -> tuple[Any, ...]:
        """Everything a refused write must leave alone: every note, event and audit event."""
        [row] = self.rows(
            """
            SELECT (SELECT array_agg(n::text ORDER BY n.id) FROM workpaper_review_notes n),
                   (SELECT count(*) FROM workpaper_review_note_events),
                   (SELECT count(*) FROM audit_events WHERE action LIKE 'workpaper_review_note.%%')
            """
        )
        return tuple(row)


def test_a_note_is_raised_on_a_field_on_highlighted_words_and_on_the_workpaper(
    migrated: Database,
) -> None:
    desk = _Desk(migrated, "wrn-raise")
    notes = _Notes(desk)
    owner_id, current = notes.owner_id, desk.current

    # Nothing yet: who can own a note (the engagement's members, by name, each with their
    # role in words), and what the engagement's owner may do.
    start = notes.read()
    assert (start["notes"], start["counts"]) == ([], NO_COUNTS)
    assert (start["can_raise"], start["can_review"]) == (True, False)
    team = notes.rows(
        "SELECT pm.user_id::text, u.display_name, initcap(pm.engagement_role) "
        "FROM project_memberships pm JOIN users u ON u.id = pm.user_id "
        "WHERE pm.project_id = %s ORDER BY u.display_name, u.id",
        desk.team["project"],
    )
    assert start["members"] == [{"id": i, "name": n, "role": r} for i, n, r in team]
    assert str(owner_id) in {member["id"] for member in start["members"]}
    assert {member["role"] for member in start["members"]} <= {"Lead", "Preparer", "Reviewer"}
    # The draft has no preparer of record and nobody edited it: who opened it owns a new
    # note by default.
    assert start["default_owner_id"] == str(owner_id)

    # Highlighted words: stored exactly as sent (leading and trailing spaces, a run of
    # spaces, a line break), less only the invisible and control characters; the text
    # around them and which match it was.
    typed = (
        "<p>Who <b>approves</b> the access?</p>\r\n\r\n\r\n\r\n"
        "password: synthetic-hunter2\u200b on the screen"
    )
    words = notes.raised(
        anchor_kind="TEXT",
        field="walkthrough.2.3",
        quote="  two  spaces\u200b kept \n and\x00 a line ",
        prefix="before  ",
        suffix="  after\u202e",
        occurrence=2,
        criticality="URGENT",
        text=typed,
    )
    assert words["number"] == 1
    assert (words["anchor_kind"], words["field"]) == ("TEXT", "walkthrough.2.3")
    assert words["quote"] == "  two  spaces kept \n and a line "
    assert (words["prefix"], words["suffix"], words["occurrence"]) == ("before  ", "  after", 2)
    # The note's text is a person's untrusted text, cleaned as text is.
    assert words["text"] == clean_text(typed, 2000).text
    assert "<" not in words["text"] and "hunter2" not in words["text"]
    assert "Who approves the access?" in words["text"] and "\r" not in words["text"]
    assert "password: [redacted]" in words["text"] and "\u200b" not in words["text"]
    assert (words["criticality"], words["status"], words["version"]) == ("URGENT", "OPEN", 1)
    assert words["workpaper_version"] == current
    assert words["owner"] == words["raised_by"] == notes.person(owner_id)
    assert (words["cleared_by"], words["cleared_at"]) == (None, None)
    assert (words["dismissed_by"], words["dismissed_at"], words["dismiss_reason"]) == (
        None, None, "",
    )  # fmt: skip
    [raised] = words["events"]
    assert (raised["kind"], raised["by"], raised["text"], raised["data"]) == (
        "RAISED", notes.person(owner_id), "", {},
    )  # fmt: skip
    assert set(raised) == {"id", "kind", "by", "at", "text", "data"}
    # field_text: a field note's copy of the field's text (migration 0167); null here.
    assert words["field_text"] is None
    assert set(words) == {
        "id", "number", "anchor_kind", "field", "quote", "prefix", "suffix", "occurrence",
        "field_text", "workpaper_version", "text", "criticality", "status", "owner",
        "raised_by", "raised_at", "cleared_by", "cleared_at", "dismissed_by", "dismissed_at",
        "dismiss_reason", "version", "events", "can",
    }  # fmt: skip
    # The table holds the same characters.
    [(stored,)] = notes.rows("SELECT quote FROM workpaper_review_notes WHERE id = %s", words["id"])
    assert stored == "  two  spaces kept \n and a line "

    # A field, and the workpaper as a whole; numbered in the order they were raised. An
    # earlier version of the workpaper takes a note too.
    field = notes.raised(field="attributes.0193a5f0-7c1e-7000-8000-000000000001.result")
    whole = notes.raised(
        anchor_kind="WORKPAPER", field="", criticality="FOLLOW_UP", workpaper_version=1,
        quote="", prefix="", suffix="", occurrence=0,
    )  # fmt: skip
    assert [(n["number"], n["anchor_kind"]) for n in (field, whole)] == [
        (2, "FIELD"), (3, "WORKPAPER"),
    ]  # fmt: skip
    for plain in (field, whole):
        assert (plain["quote"], plain["prefix"], plain["suffix"], plain["occurrence"]) == (
            "", "", "", 0,
        )  # fmt: skip
    assert (whole["field"], whole["workpaper_version"], whole["criticality"]) == (
        "", 1, "FOLLOW_UP",
    )  # fmt: skip
    listed = notes.read()
    assert listed["notes"] == [words, field, whole]
    assert listed["counts"] == NO_COUNTS | {"open": 3, "urgent_open": 1}

    # Each is one event row and one audit event of the person, with what it is about and
    # no more than 200 characters of its text. The highlighted words are not in it.
    long = notes.raised(text="The walkthrough does not show the approval. " * 12)
    assert len(long["text"]) > 400
    assert notes.trail(long["id"]) == [("RAISED", owner_id, "", {})]
    [(action, actor, payload)] = notes.audited(long["id"])
    assert (action, actor) == ("workpaper_review_note.raised", owner_id)
    assert payload == {
        "workpaper_id": desk.paper_id,
        "note_id": long["id"],
        "event_id": long["events"][0]["id"],
        "number": 4,
        "kind": "RAISED",
        "anchor_kind": "FIELD",
        "field": "understanding",
        "workpaper_version": current,
        "criticality": "NORMAL",
        "status": "OPEN",
        "owner_id": str(owner_id),
        "text": long["text"][:200],
    }
    [(_action, _actor, first)] = notes.audited(words["id"])
    assert "quote" not in first and "two  spaces" not in str(first)
    assert first["text"] == words["text"]

    # What is not a note is refused with a sentence, and nothing is written.
    before = notes.state()
    for over, sentence in (
        ({"text": "Too short"}, TEXT_SHORT),
        ({"text": "   \n   "}, TEXT_SHORT),
        ({"text": "x" * 2001}, TEXT_LONG),
        ({"field": ""}, FIELD_NEEDED),
        ({"field": "has space"}, FIELD_NEEDED),
        ({"field": ".starts-with-a-dot"}, FIELD_NEEDED),
        ({"anchor_kind": "TEXT"}, QUOTE_NEEDED),
        ({"anchor_kind": "TEXT", "quote": ""}, QUOTE_NEEDED),
        ({"anchor_kind": "TEXT", "quote": "\u200b"}, QUOTE_NEEDED),
        ({"anchor_kind": "TEXT", "quote": "q" * 501}, QUOTE_NEEDED),
        ({"anchor_kind": "TEXT", "quote": "q", "prefix": "p" * 61}, AROUND_LONG),
        ({"anchor_kind": "TEXT", "quote": "q", "suffix": "s" * 61}, AROUND_LONG),
        ({"anchor_kind": "TEXT", "quote": "q", "field": ""}, FIELD_NEEDED),
        ({"quote": "words"}, QUOTE_NOT_TAKEN),
        ({"occurrence": 1}, QUOTE_NOT_TAKEN),
        ({"anchor_kind": "WORKPAPER"}, FIELD_NOT_TAKEN),
        ({"anchor_kind": "WORKPAPER", "field": "", "quote": "words"}, QUOTE_NOT_TAKEN),
        ({"workpaper_version": current + 1}, NO_SUCH_VERSION),
        ({"owner_id": str(uuid4())}, OWNER_NOT_MEMBER),
    ):
        _refused(notes.post(**over), 422, sentence)
    unread: tuple[dict[str, Any], ...] = (
        {"anchor_kind": "CELL"},
        {"criticality": "HIGH"},
        {"workpaper_version": 0},
        {"occurrence": -1},
        {"owner_id": "nobody"},
        {"owner_id": None},
        {"text": None},
        {"text": "x" * 8001},
        {"field": "f" * 121},
        # What the server decides is never taken from the request.
        {"status": "CLEARED"},
        {"number": 9},
        {"raised_by": str(uuid4())},
    )
    for unread_body in unread:
        assert notes.post(**unread_body).status_code == 422, unread_body
    for missing in ("anchor_kind", "workpaper_version", "text", "criticality", "owner_id"):
        body = {k: v for k, v in notes.body().items() if k != missing}
        assert desk.owner.post(notes.url, json=body).status_code == 422, missing
    # A person of the firm who is not on the engagement owns no note of it.
    stranger_id, _stranger = desk.member("CONTRIBUTOR", on_project=False)
    _refused(notes.post(owner_id=str(stranger_id)), 422, OWNER_NOT_MEMBER)
    # A workpaper with no version yet takes no note.
    undrafted = _Notes(desk, desk.undrafted_id)
    assert undrafted.read()["can_raise"] is False
    _refused(undrafted.post(workpaper_version=1), 422, NO_SUCH_VERSION)
    assert notes.state() == before
    assert [n["number"] for n in notes.read()["notes"]] == [1, 2, 3, 4]


def test_a_notes_thread_its_statuses_and_who_may_do_what(migrated: Database) -> None:
    desk = _Desk(migrated, "wrn-thread")
    notes = _Notes(desk)
    preparer_id, preparer = notes.owner_id, desk.owner
    reviewer_id, reviewer = notes.reviewer()
    second_id, second = notes.reviewer()
    colleague_id, colleague = desk.member("CONTRIBUTOR")
    people = {"preparer": preparer, "reviewer": reviewer, "second": second, "colleague": colleague}

    def can(note_id: str) -> dict[str, set[str]]:
        return {who: _can(notes.note(note_id, client)) for who, client in people.items()}

    # While the workpaper is a draft it has no preparer of record: anyone who may update
    # the work responds. Prepared, its preparer is the person who prepared it.
    early = notes.raised(reviewer, criticality="URGENT")
    assert "respond" in _can(notes.note(early["id"], colleague))
    notes.prepare()
    assert notes.read()["default_owner_id"] == str(preparer_id)
    assert "respond" not in _can(notes.note(early["id"], colleague))
    assert "respond" in _can(notes.note(early["id"], preparer))

    # A reviewer raises an urgent note on the prepared workpaper, for its preparer.
    note = notes.raised(reviewer, criticality="URGENT", owner_id=str(preparer_id))
    note_id = note["id"]
    assert (note["raised_by"], note["owner"]) == (
        notes.person(reviewer_id), notes.person(preparer_id),
    )  # fmt: skip
    assert (notes.read(reviewer)["can_review"], notes.read(preparer)["can_review"]) == (
        True, False,
    )  # fmt: skip
    decide = {"reply", "clear", "dismiss", "criticality", "owner"}
    assert can(note_id) == {
        "preparer": {"reply", "respond", "owner"},
        "reviewer": decide,
        "second": decide,
        "colleague": {"reply"},
    }

    # The preparer cannot clear, dismiss, reopen or re-rate a reviewer's note; a colleague
    # who is neither its owner nor the preparer does not respond to it or hand it on.
    before = notes.state()
    for client in (preparer, colleague):
        _refused(notes.act(note_id, "clear", client), 403, DECIDE_FORBIDDEN)
        _refused(notes.act(note_id, "dismiss", client, reason=REASON), 403, DECIDE_FORBIDDEN)
        _refused(notes.act(note_id, "reopen", client, text="Open again."), 403, DECIDE_FORBIDDEN)
        _refused(
            notes.act(note_id, "criticality", client, criticality="NORMAL"), 403, DECIDE_FORBIDDEN
        )
    _refused(
        notes.act(note_id, "reply", colleague, text="Done.", responds=True), 403,
        RESPOND_FORBIDDEN,
    )  # fmt: skip
    _refused(
        notes.act(note_id, "reply", reviewer, text="Done.", responds=True), 403, RESPOND_FORBIDDEN
    )
    _refused(
        notes.act(note_id, "owner", colleague, owner_id=str(colleague_id)), 403, OWNER_FORBIDDEN
    )
    assert notes.state() == before

    # A reply: one event, the status as it was, the version moved on.
    said = "  I can <b>look</b> at this\u200b.  "
    replied = notes.done(note_id, "reply", colleague, text=said)
    assert (replied["status"], replied["version"]) == ("OPEN", 2)
    assert [(e["kind"], e["by"], e["text"], e["data"]) for e in replied["events"]] == [
        ("RAISED", notes.person(reviewer_id), "", {}),
        ("REPLIED", notes.person(colleague_id), clean_text(said, 2000).text, {}),
    ]
    assert "<" not in replied["events"][1]["text"] and "look" in replied["events"][1]["text"]
    # A page that read the note before the reply is told to read it again.
    stale = notes.state()
    _refused(notes.act(note_id, "clear", reviewer, version=1), 409, STALE)
    _refused(
        notes.act(note_id, "reply", preparer, text="Done.", responds=True, version=1), 409, STALE
    )
    _refused(notes.act(note_id, "dismiss", second, reason=REASON, version=3), 409, STALE)
    assert notes.state() == stale
    # What is not a reply, a reason or a criticality: 422.
    _refused(notes.act(note_id, "reply", preparer, text="  \n "), 422, REPLY_SHORT)
    _refused(notes.act(note_id, "reply", preparer, text="y" * 2001), 422, REPLY_LONG)
    _refused(notes.act(note_id, "dismiss", reviewer, reason="Too short"), 422, REASON_SHORT)
    _refused(notes.act(note_id, "dismiss", reviewer, reason="z" * 501), 422, REASON_LONG)
    _refused(notes.act(note_id, "reopen", reviewer, text=""), 422, REPLY_SHORT)
    assert notes.act(note_id, "criticality", reviewer, criticality="HIGH").status_code == 422
    assert notes.act(note_id, "clear", reviewer, version=0).status_code == 422
    assert desk.owner.post(f"{notes.url}/{note_id}/clear", json={}).status_code == 422
    assert notes.act(note_id, "clear", reviewer, cleared_by=str(preparer_id)).status_code == 422
    assert notes.state() == stale

    # The preparer responds: RESPONDED, once.
    responded = notes.done(
        note_id, "reply", preparer, text="The approver is named now.", responds=True
    )
    assert (responded["status"], responded["version"]) == ("RESPONDED", 3)
    assert responded["events"][-1]["data"] == {"from": "OPEN", "to": "RESPONDED"}
    assert can(note_id) == {
        "preparer": {"reply", "owner"},
        "reviewer": decide | {"reopen"},
        "second": decide | {"reopen"},
        "colleague": {"reply"},
    }
    _refused(
        notes.act(note_id, "reply", preparer, text="Again.", responds=True), 409,
        ALREADY_RESPONDED,
    )  # fmt: skip
    assert notes.done(note_id, "reply", preparer, text="And the date.")["status"] == "RESPONDED"

    # Not enough: the reviewer opens it again, saying why; the preparer responds again.
    reopened = notes.done(note_id, "reopen", reviewer, text="The approver's role is missing.")
    assert (reopened["status"], reopened["events"][-1]["data"]) == (
        "OPEN", {"from": "RESPONDED", "to": "OPEN"},
    )  # fmt: skip
    _refused(notes.act(note_id, "reopen", reviewer, text="Again."), 409, "the note is already open")
    notes.done(note_id, "reply", preparer, text="The role is added.", responds=True)

    # Another reviewer clears it: who and when are on the note; nothing more is taken
    # until it is reopened.
    cleared = notes.done(note_id, "clear", second)
    assert (cleared["status"], cleared["cleared_by"]) == ("CLEARED", notes.person(second_id))
    assert cleared["cleared_at"] is not None and cleared["dismissed_by"] is None
    assert cleared["events"][-1]["data"] == {"from": "RESPONDED", "to": "CLEARED"}
    assert can(note_id) == {
        "preparer": set(), "reviewer": {"reopen"}, "second": {"reopen"}, "colleague": set(),
    }  # fmt: skip
    closed = notes.state()
    first = "the note is cleared; reopen it first"
    _refused(notes.act(note_id, "clear", reviewer), 409, "the note is already cleared")
    _refused(notes.act(note_id, "dismiss", reviewer, reason=REASON), 409, first)
    _refused(notes.act(note_id, "reply", preparer, text="Thanks."), 409, first)
    _refused(notes.act(note_id, "reply", preparer, text="Thanks.", responds=True), 409, first)
    _refused(notes.act(note_id, "criticality", reviewer, criticality="NORMAL"), 409, first)
    _refused(notes.act(note_id, "owner", reviewer, owner_id=str(colleague_id)), 409, first)
    _refused(notes.act(note_id, "reopen", preparer, text="Not done."), 403, DECIDE_FORBIDDEN)
    assert notes.state() == closed

    # Reopened from cleared: open again, and who cleared it stays in its events only.
    again = notes.done(note_id, "reopen", reviewer, text="One more thing to add.")
    assert (again["status"], again["cleared_by"], again["cleared_at"]) == ("OPEN", None, None)

    # The criticality: from and to, never to what it already is.
    rated = notes.done(note_id, "criticality", second, criticality="FOLLOW_UP")
    assert (rated["criticality"], rated["status"]) == ("FOLLOW_UP", "OPEN")
    assert rated["events"][-1]["data"] == {"from": "URGENT", "to": "FOLLOW_UP"}
    _refused(
        notes.act(note_id, "criticality", second, criticality="FOLLOW_UP"), 409,
        "the note is already Follow-up",
    )  # fmt: skip

    # The owner hands it on, to a member of the engagement only, and is then no longer
    # the one who may.
    _stranger_id, _stranger = desk.member("CONTRIBUTOR", on_project=False)
    _refused(
        notes.act(note_id, "owner", preparer, owner_id=str(_stranger_id)), 422, OWNER_NOT_MEMBER
    )
    _refused(notes.act(note_id, "owner", preparer, owner_id=str(preparer_id)), 409, SAME_OWNER)
    handed = notes.done(note_id, "owner", preparer, owner_id=str(colleague_id))
    assert handed["owner"] == notes.person(colleague_id)
    assert handed["events"][-1]["data"] == {
        "from": str(preparer_id),
        "to": str(colleague_id),
        "from_name": notes.name(preparer_id),
        "to_name": notes.name(colleague_id),
    }
    assert can(note_id) == {
        # Still the preparer of record, so they respond; no longer its owner.
        "preparer": {"reply", "respond"},
        "reviewer": decide,
        "second": decide,
        "colleague": {"reply", "respond", "owner"},
    }
    _refused(notes.act(note_id, "owner", preparer, owner_id=str(preparer_id)), 403, OWNER_FORBIDDEN)

    # Dismissed with its reason, by the person who raised it; reopened by a reviewer.
    dismissed = notes.done(note_id, "dismiss", reviewer, reason=f"  {REASON}  ")
    assert (dismissed["status"], dismissed["dismissed_by"], dismissed["dismiss_reason"]) == (
        "DISMISSED", notes.person(reviewer_id), REASON,
    )  # fmt: skip
    assert dismissed["dismissed_at"] is not None and dismissed["cleared_by"] is None
    assert can(note_id)["colleague"] == set() and can(note_id)["second"] == {"reopen"}
    _refused(notes.act(note_id, "dismiss", reviewer, reason=REASON), 409,
             "the note is already dismissed")  # fmt: skip
    _refused(notes.act(note_id, "clear", reviewer), 409, "the note is dismissed; reopen it first")
    last = notes.done(note_id, "reopen", second, text="It is this control after all.")
    assert (last["status"], last["dismissed_by"], last["dismissed_at"], last["dismiss_reason"]) == (
        "OPEN", None, None, "",
    )  # fmt: skip

    # The thread is the events on record, one per write, and each write is one audit
    # event of the person who made it, naming its event.
    kinds = [
        "RAISED", "REPLIED", "RESPONDED", "REPLIED", "REOPENED", "RESPONDED", "CLEARED",
        "REOPENED", "CRITICALITY", "OWNER", "DISMISSED", "REOPENED",
    ]  # fmt: skip
    assert [e["kind"] for e in last["events"]] == kinds
    assert last["version"] == len(kinds)
    trail = notes.trail(note_id)
    assert [(kind, str(by), text, data) for kind, by, text, data in trail] == [
        (e["kind"], e["by"]["id"], e["text"], e["data"]) for e in last["events"]
    ]
    assert [(kind, by, text) for kind, by, text, _data in trail][-2:] == [
        ("DISMISSED", reviewer_id, REASON),
        ("REOPENED", second_id, "It is this control after all."),
    ]
    audited = notes.audited(note_id)
    assert [action for action, _actor, _payload in audited] == [
        f"workpaper_review_note.{kind.lower()}" for kind in kinds
    ]
    assert [actor for _action, actor, _payload in audited] == [by for _k, by, _t, _d in trail]
    for (_action, _actor, payload), event in zip(audited, last["events"], strict=True):
        assert (payload["note_id"], payload["event_id"], payload["kind"]) == (
            note_id, event["id"], event["kind"],
        )  # fmt: skip
        assert payload["workpaper_id"] == desk.paper_id and payload["number"] == note["number"]
        # The audit payload carries at most 200 characters of the text written: for a
        # raised note its own text (its RAISED event carries none), else the event's.
        written = last["text"] if event["kind"] == "RAISED" else event["text"]
        assert payload["text"] == written[:200]
        if event["kind"] in ("RAISED", "REPLIED"):
            assert "from" not in payload
        else:
            assert (payload["from"], payload["to"]) == (event["data"]["from"], event["data"]["to"])
    assert [(p["status"], p["criticality"]) for _a, _b, p in audited][-4:] == [
        ("OPEN", "FOLLOW_UP"), ("OPEN", "FOLLOW_UP"), ("DISMISSED", "FOLLOW_UP"),
        ("OPEN", "FOLLOW_UP"),
    ]  # fmt: skip
    # No more than 200 characters of a reply reach the audit trail.
    wordy = notes.done(note_id, "reply", reviewer, text="The evidence shows the approval. " * 20)
    assert len(wordy["events"][-1]["text"]) > 400
    assert notes.audited(note_id)[-1][2]["text"] == wordy["events"][-1]["text"][:200]

    # A reviewer does not close a note addressed to them unless they raised it: they
    # respond, and the reviewer who raised it clears it.
    theirs = notes.raised(reviewer, owner_id=str(second_id))["id"]
    assert _can(notes.note(theirs, second)) == {"reply", "respond", "owner"}
    _refused(notes.act(theirs, "clear", second), 403, DECIDE_FORBIDDEN)
    _refused(notes.act(theirs, "dismiss", second, reason=REASON), 403, DECIDE_FORBIDDEN)
    notes.done(theirs, "reply", second, text="Looked at it.", responds=True)
    assert notes.done(theirs, "clear", reviewer)["status"] == "CLEARED"
    # A person who is not a reviewer decides the note they raised, and nobody else's.
    own = notes.raised(colleague, owner_id=str(preparer_id))["id"]
    assert _can(notes.note(own, colleague)) == {"reply", "clear", "dismiss", "criticality", "owner"}
    _refused(notes.act(own, "clear", preparer), 403, DECIDE_FORBIDDEN)
    assert notes.done(own, "dismiss", colleague, reason=REASON)["status"] == "DISMISSED"

    # A note of another workpaper, or one there is not, is not found under this one.
    other = _Notes(desk, desk.undrafted_id)
    wrong = f"{other.url}/{note_id}/clear"
    assert reviewer.post(wrong, json={"version": notes.note(note_id)["version"]}).status_code == 404
    assert notes.act(str(uuid4()), "clear", reviewer, version=1).status_code == 404
    counts = notes.read()["counts"]
    assert counts == {"open": 2, "responded": 0, "cleared": 1, "dismissed": 1, "urgent_open": 1}


def test_a_preparer_who_reviews_never_closes_a_reviewers_note_on_their_own_workpaper(
    migrated: Database,
) -> None:
    """Review of 16 November 2026, finding 2 (docs/workpaper-review.md, section 4: "a
    preparer cannot clear a reviewer's note"). The workpaper's preparer of record also holds
    the engagement's reviewer role, as the D&I sign-off allows (another reviewer signs). A
    reviewer raises an urgent note: whether its owner is someone else, or the preparer who
    hands it on, the preparer never clears, dismisses, reopens or re-rates it, so the
    sign-off's hold is not lifted by the person it waits on. A reviewer who did not prepare
    it, and the person who raised it, still do; the preparer decides a note they raised."""
    desk = _Desk(migrated, "wrn-preparer-reviews")
    notes = _Notes(desk)
    preparer_id, preparer = notes.owner_id, desk.owner
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO project_memberships (organization_id, project_id, user_id, "
            "engagement_role) VALUES (%s, %s, %s, 'REVIEWER') "
            "ON CONFLICT (project_id, user_id) DO UPDATE SET engagement_role = 'REVIEWER'",
            (desk.team["org"], desk.team["project"], preparer_id),
        )
    notes.prepare()
    assert notes.read(preparer)["can_review"] is True
    raiser_id, raiser = notes.reviewer()
    other_id, other = notes.reviewer()
    colleague_id, _colleague = desk.member("CONTRIBUTOR")

    def refused_to(note_id: str, client: TestClient) -> None:
        before = notes.state()
        _refused(notes.act(note_id, "clear", client), 403, DECIDE_FORBIDDEN)
        _refused(notes.act(note_id, "dismiss", client, reason=REASON), 403, DECIDE_FORBIDDEN)
        _refused(notes.act(note_id, "reopen", client, text="Open again."), 403, DECIDE_FORBIDDEN)
        _refused(
            notes.act(note_id, "criticality", client, criticality="NORMAL"), 403, DECIDE_FORBIDDEN
        )
        assert notes.state() == before

    # Path 1: the reviewer names a colleague the note's owner; the preparer, who is not
    # its owner and holds the reviewer role, still does not decide it.
    named = notes.raised(raiser, criticality="URGENT", owner_id=str(colleague_id))["id"]
    assert _can(notes.note(named, preparer)) == {"reply", "respond", "owner"}
    refused_to(named, preparer)

    # Path 2: the note is the preparer's by default; they hand it on, which they may, and
    # then still do not decide it.
    assert notes.read(raiser)["default_owner_id"] == str(preparer_id)
    theirs = notes.raised(raiser, criticality="URGENT", owner_id=str(preparer_id))["id"]
    handed = notes.done(theirs, "owner", preparer, owner_id=str(colleague_id))
    assert handed["owner"] == notes.person(colleague_id)
    assert _can(handed) == {"reply", "respond", "owner"}
    refused_to(theirs, preparer)
    assert notes.read()["counts"]["urgent_open"] == 2

    # Another reviewer, who neither prepared it nor owned the note, clears it; the person
    # who raised the other dismisses it. Then nothing holds the sign-off.
    assert notes.done(theirs, "clear", other)["cleared_by"] == notes.person(other_id)
    assert notes.done(named, "dismiss", raiser, reason=REASON)["status"] == "DISMISSED"
    assert notes.read()["counts"]["urgent_open"] == 0
    # The preparer reopens neither.
    refused_to(theirs, preparer)
    # A note the preparer raised themselves is theirs to decide.
    own = notes.raised(preparer, owner_id=str(raiser_id))["id"]
    assert notes.done(own, "clear", preparer)["cleared_by"] == notes.person(preparer_id)


def test_an_owner_does_not_close_a_note_addressed_to_them_by_handing_it_on_first(
    migrated: Database,
) -> None:
    """Review of 16 November 2026, finding 3 (docs/workpaper-review.md, section 4: "never
    the resolution owner on their own note to themselves unless they raised it"). A
    reviewer the note is addressed to does not clear it; handing it on, which a reviewer
    may, does not change that: whoever the note was ever addressed to does not clear,
    dismiss, reopen or re-rate it, the next time or later. The person who raised it, and a
    reviewer it was never addressed to, still do."""
    desk = _Desk(migrated, "wrn-handed-on")
    notes = _Notes(desk)
    notes.prepare()
    raiser_id, raiser = notes.reviewer()
    owner_id, owner = notes.reviewer()
    third_id, third = notes.reviewer()
    colleague_id, colleague = desk.member("CONTRIBUTOR")

    note_id = notes.raised(raiser, criticality="URGENT", owner_id=str(owner_id))["id"]
    _refused(notes.act(note_id, "clear", owner), 403, DECIDE_FORBIDDEN)
    # Handed on to a colleague, then on to the third reviewer, by the owner.
    notes.done(note_id, "owner", owner, owner_id=str(colleague_id))
    assert _can(notes.note(note_id, owner)) == {"reply", "owner"}
    before = notes.state()
    _refused(notes.act(note_id, "clear", owner), 403, DECIDE_FORBIDDEN)
    _refused(notes.act(note_id, "dismiss", owner, reason=REASON), 403, DECIDE_FORBIDDEN)
    _refused(notes.act(note_id, "criticality", owner, criticality="NORMAL"), 403, DECIDE_FORBIDDEN)
    _refused(notes.act(note_id, "reopen", owner, text="Open again."), 403, DECIDE_FORBIDDEN)
    assert notes.state() == before
    assert notes.read()["counts"]["urgent_open"] == 1
    # The colleague, now its owner, hands it to the third reviewer: the note was addressed
    # to them too, so they do not close it either; the first owner still does not.
    notes.done(note_id, "owner", colleague, owner_id=str(third_id))
    notes.done(note_id, "owner", third, owner_id=str(colleague_id))
    for client in (owner, third):
        _refused(notes.act(note_id, "clear", client), 403, DECIDE_FORBIDDEN)
    assert notes.read()["counts"]["urgent_open"] == 1
    # Each refusal changed nothing: the note's thread is the raise and its three hand-ons.
    assert [kind for kind, *_rest in notes.trail(note_id)] == ["RAISED", "OWNER", "OWNER", "OWNER"]
    # The person who raised it clears it.
    assert notes.done(note_id, "clear", raiser)["cleared_by"] == notes.person(raiser_id)
    # A reviewer the note was never addressed to decides it: here, on a second note.
    again = notes.raised(raiser, criticality="URGENT", owner_id=str(owner_id))["id"]
    notes.done(again, "owner", owner, owner_id=str(colleague_id))
    assert notes.done(again, "dismiss", third, reason=REASON)["status"] == "DISMISSED"
    assert notes.read()["counts"]["urgent_open"] == 0


def test_a_field_note_keeps_the_fields_text_as_it_was_when_raised(migrated: Database) -> None:
    """Review of 16 November 2026, finding 4 (migration 0167). A field keyed by its place in
    a list (procedures.2) names other text once the workpaper changes. A field note keeps
    the field's text as the page sent it, as highlighted words are kept, so that the page
    can say the field changed since; null where none was sent. Never on another note, never
    longer than a section's text, and never changed afterwards."""
    desk = _Desk(migrated, "wrn-field-text")
    notes = _Notes(desk)
    seen = "  Inspect the ticket\nfor the approver.\u200b "
    field = notes.raised(field="procedures.2", field_text=seen)
    assert (field["anchor_kind"], field["field"]) == ("FIELD", "procedures.2")
    assert field["field_text"] == "  Inspect the ticket\nfor the approver. "
    assert notes.note(field["id"])["field_text"] == field["field_text"]
    [(stored,)] = notes.rows(
        "SELECT field_text FROM workpaper_review_notes WHERE id = %s", field["id"]
    )
    assert stored == field["field_text"]
    # An empty field is kept as empty; none sent is none recorded.
    assert notes.raised(field="matters.1", field_text="")["field_text"] == ""
    assert notes.raised(field="matters.2")["field_text"] is None
    longest = notes.raised(field="reports.1.2", field_text="r" * FIELD_TEXT_MAX)
    assert longest["field_text"] == "r" * FIELD_TEXT_MAX
    # The audit event says what the note is about, not the field's text.
    [(_action, _actor, payload)] = notes.audited(field["id"])
    assert "field_text" not in payload and "Inspect the ticket" not in str(payload)

    before = notes.state()
    wrong: tuple[tuple[dict[str, Any], str], ...] = (
        ({"field_text": "r" * (FIELD_TEXT_MAX + 1)}, FIELD_TEXT_LONG),
        ({"anchor_kind": "TEXT", "quote": "the", "field_text": "the field"}, FIELD_TEXT_NOT_TAKEN),
        ({"anchor_kind": "WORKPAPER", "field": "", "field_text": ""}, FIELD_TEXT_NOT_TAKEN),
    )
    for over, sentence in wrong:
        _refused(notes.post(**over), 422, sentence)
    assert notes.post(field_text="r" * (4 * FIELD_TEXT_MAX + 1)).status_code == 422
    assert notes.state() == before

    # The table keeps it: never changed, on a field note only, and bounded.
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.RaiseException, match="never changes"),
    ):
        connection.execute(
            "UPDATE workpaper_review_notes SET field_text = 'Other text.', "
            "version = version + 1 WHERE id = %s",
            (field["id"],),
        )
    words = notes.raised(anchor_kind="TEXT", quote="the words")
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.RaiseException, match="never changes"),
    ):
        connection.execute(
            "UPDATE workpaper_review_notes SET field_text = '', version = version + 1 "
            "WHERE id = %s",
            (words["id"],),
        )
    for anchor, field_key, quote, text in (
        ("TEXT", "understanding", "the words", "the field"),
        ("WORKPAPER", "", "", ""),
        ("FIELD", "procedures.3", "", "r" * (FIELD_TEXT_MAX + 1)),
    ):
        with (
            connect(migrated.url) as connection,
            pytest.raises(psycopg.errors.CheckViolation, match="workpaper_review_notes_field_text"),
        ):
            connection.execute(
                """
                INSERT INTO workpaper_review_notes (
                    organization_id, project_id, workpaper_id, number, anchor_kind, field,
                    quote, field_text, workpaper_version, text, criticality, owner_id,
                    raised_by
                )
                VALUES (%s, %s, %s, 99, %s, %s, %s, %s, 1, 'A note written directly.',
                        'NORMAL', %s, %s)
                """,
                (desk.team["org"], desk.team["project"], desk.paper_id, anchor, field_key,
                 quote, text, notes.owner_id, notes.owner_id),
            )  # fmt: skip
    assert notes.rows(
        "SELECT field_text FROM workpaper_review_notes WHERE id = %s", field["id"]
    ) == [(field["field_text"],)]


def test_only_a_person_on_the_engagement_who_may_update_or_review_writes_a_note(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    _other_firm, _other_project, outsider = _ready(migrated, "wrn-other-firm")
    desk = _Desk(migrated, "wrn-roles")
    notes = _Notes(desk)
    owner_id = notes.owner_id
    note_id = notes.raised(criticality="URGENT")["id"]
    version = notes.note(note_id)["version"]
    before = notes.state()

    def asks(client: TestClient | None) -> list[int]:
        """The read, then every write."""
        send = client or desk.owner
        url = f"{notes.url}/{note_id}"
        return [
            send.get(notes.url).status_code,
            send.post(notes.url, json=notes.body()).status_code,
            send.post(f"{url}/reply", json={"text": "A reply.", "version": version}).status_code,
            send.post(
                f"{url}/reply", json={"text": "Done.", "responds": True, "version": version}
            ).status_code,
            send.post(f"{url}/clear", json={"version": version}).status_code,
            send.post(f"{url}/reopen", json={"text": "Again.", "version": version}).status_code,
            send.post(f"{url}/dismiss", json={"reason": REASON, "version": version}).status_code,
            send.post(
                f"{url}/criticality", json={"criticality": "NORMAL", "version": version}
            ).status_code,
            send.post(
                f"{url}/owner", json={"owner_id": str(owner_id), "version": version}
            ).status_code,
        ]

    # A member who only reads the work (the firm's Reviewer role, not the engagement's
    # reviewer) reads the notes and writes none.
    _reader_id, reader = desk.member("REVIEWER")
    found = notes.read(reader)
    assert (found["can_raise"], found["can_review"]) == (False, False)
    assert _can(found["notes"][0]) == set()
    assert asks(reader) == [200, *[403] * 8]
    _refused(notes.post(reader), 403, RAISE_FORBIDDEN)
    _refused(notes.act(note_id, "reply", reader, text="A reply."), 403, REPLY_FORBIDDEN)
    # A person of the firm who is not on the engagement, and another firm's person: not
    # found, as the workpaper routes answer them. No session: not signed in.
    _stranger_id, stranger = desk.member("CONTRIBUTOR", on_project=False)
    assert asks(stranger) == [404] * 9
    assert asks(outsider) == [404] * 9
    assert asks(TestClient(desk.owner.app)) == [401] * 9
    # The workpaper under another engagement of the firm, and one there is not.
    with connect(migrated.url) as connection:
        other = connection.execute(
            "SELECT id FROM projects WHERE organization_id = %s AND id <> %s LIMIT 1",
            (desk.team["org"], desk.team["project"]),
        ).fetchone()
    assert other is not None
    elsewhere = f"/organizations/{desk.team['org']}/projects/{other[0]}/workpapers"
    for url in (
        f"{elsewhere}/{desk.paper_id}/review-notes",
        f"{desk.base}/{uuid4()}/review-notes",
    ):
        assert desk.owner.get(url).status_code == 404
        assert desk.owner.post(url, json=notes.body()).status_code == 404
        assert (
            desk.owner.post(f"{url}/{note_id}/clear", json={"version": version}).status_code == 404
        )
    # The routes take their principal from the session, always a person's. An agent
    # principal reaching them is refused on the read and on every write.
    agent = Principal(kind=PrincipalKind.AGENT, id=owner_id)
    with monkeypatch.context() as patched:
        patched.setattr(workpaper_service, "_session_principal", lambda _request: agent)
        refused = asks(None)
    assert len(set(refused)) == 1 and refused[0] in (403, 404)
    where = (desk.team["org"], desk.team["project"], UUID(desk.paper_id))
    target = (*where, UUID(note_id))
    raised = review_notes.RaiseBody.model_validate(notes.body())
    for call in (
        lambda c: review_notes.read(c, agent, *where),
        lambda c: review_notes.raise_note(c, agent, *where, raised),
        lambda c: review_notes.reply(
            c, agent, *target, review_notes.ReplyBody(text="A reply.", version=version)
        ),
        lambda c: review_notes.reply(
            c, agent, *target,
            review_notes.ReplyBody(text="Done.", responds=True, version=version),
        ),
        lambda c: review_notes.clear(c, agent, *target, review_notes.ClearBody(version=version)),
        lambda c: review_notes.reopen(
            c, agent, *target, review_notes.ReopenBody(text="Again.", version=version)
        ),
        lambda c: review_notes.dismiss(
            c, agent, *target, review_notes.DismissBody(reason=REASON, version=version)
        ),
        lambda c: review_notes.set_criticality(
            c, agent, *target, review_notes.CriticalityBody(criticality="NORMAL", version=version)
        ),
        lambda c: review_notes.set_owner(
            c, agent, *target, review_notes.OwnerBody(owner_id=owner_id, version=version)
        ),
    ):  # fmt: skip
        with connect(migrated.url) as connection, pytest.raises((NotVisible, AccessDenied)):
            call(connection)
    assert notes.state() == before

    # The engagement's reviewer raises, replies and decides without the firm's leave to
    # update the work: reviewing is theirs.
    reviewer_id, reviewer = notes.reviewer("REVIEWER")
    found = notes.read(reviewer)
    assert (found["can_raise"], found["can_review"]) == (True, True)
    theirs = notes.raised(reviewer, owner_id=str(owner_id))
    assert theirs["raised_by"]["id"] == str(reviewer_id)
    assert _can(theirs) == {"reply", "clear", "dismiss", "criticality", "owner"}
    notes.done(theirs["id"], "reply", reviewer, text="See the second step.")
    assert notes.done(note_id, "clear", reviewer)["status"] == "CLEARED"

    # An archived engagement is read-only: the middleware refuses every write, the notes
    # are still read, and nobody is offered anything.
    kept = notes.state()
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (desk.team["project"],)
        )
    assert asks(reviewer) == [200, *[409] * 8]
    _refused(notes.post(reviewer), 409, closed_detail("ARCHIVED"))
    archived = notes.read(reviewer)
    assert archived["can_raise"] is False and len(archived["notes"]) == 2
    assert all(_can(note) == set() for note in archived["notes"])
    # A write that reaches the service or the tables there is refused by the tables.
    reviewing = Principal(kind=PrincipalKind.USER, id=reviewer_id)
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.CheckViolation, match="archived"),
    ):
        review_notes.reopen(
            connection, reviewing, *target,
            review_notes.ReopenBody(text="Too late.", version=notes.note(note_id)["version"]),
        )  # fmt: skip
    for statement in (
        "UPDATE workpaper_review_notes SET criticality = 'NORMAL', version = version + 1",
        "DELETE FROM workpaper_review_notes",
        "UPDATE workpaper_review_note_events SET text = ''",
        "DELETE FROM workpaper_review_note_events",
        "INSERT INTO workpaper_review_note_events (organization_id, project_id, note_id, kind, by) "
        "SELECT organization_id, project_id, id, 'CLEARED', raised_by FROM workpaper_review_notes",
    ):
        with (
            connect(migrated.url) as connection,
            pytest.raises(psycopg.errors.CheckViolation, match="archived"),
        ):
            connection.execute(statement)
    assert notes.state() == kept


def test_the_tables_keep_what_a_note_records_and_never_lose_a_note_or_an_event(
    migrated: Database,
) -> None:
    """The tables' own rules, for a write that does not come through the routes."""
    desk = _Desk(migrated, "wrn-table")
    notes = _Notes(desk)
    owner_id = notes.owner_id
    note = notes.raised(anchor_kind="TEXT", quote="the words", criticality="URGENT")
    note_id = note["id"]
    notes.done(note_id, "reply", text="A reply on record.")
    before = notes.state()

    def refused(statement: str, error: type[psycopg.Error], message: str, *params: Any) -> None:
        with connect(migrated.url) as connection, pytest.raises(error, match=message):
            connection.execute(statement, params)

    # What a note records never changes, whatever else the statement does.
    another, _client = desk.member("CONTRIBUTOR")
    with connect(migrated.url) as connection:
        elsewhere = connection.execute(
            "SELECT id FROM projects WHERE organization_id = %s AND id <> %s LIMIT 1",
            (desk.team["org"], desk.team["project"]),
        ).fetchone()
    assert elsewhere is not None
    other_project = elsewhere[0]
    for change, value in (
        ("text = 'Another note entirely, written later.'", None),
        ("quote = 'other words'", None),
        ("prefix = 'before'", None),
        ("suffix = 'after'", None),
        ("occurrence = occurrence + 1", None),
        ("field = 'conclusion'", None),
        ("anchor_kind = 'FIELD', quote = ''", None),
        ("workpaper_version = workpaper_version + 1", None),
        ("number = number + 98", None),
        ("raised_at = raised_at - interval '1 day'", None),
        ("id = uuidv7()", None),
        ("raised_by = %s", another),
        ("workpaper_id = %s", desk.undrafted_id),
        ("project_id = %s", other_project),
    ):
        refused(
            f"UPDATE workpaper_review_notes SET {change}, version = version + 1 "  # noqa: S608
            "WHERE id = %s",
            psycopg.errors.RaiseException, "never changes",
            *([note_id] if value is None else [value, note_id]),
        )  # fmt: skip
    # What may change moves the version on by exactly one, along a note's transitions.
    for change in ("criticality = 'NORMAL'", "criticality = 'NORMAL', version = version + 2",
                   "owner_id = owner_id, version = version - 1"):  # fmt: skip
        refused(
            f"UPDATE workpaper_review_notes SET {change} WHERE id = %s",  # noqa: S608
            psycopg.errors.RaiseException, "moves on by one", note_id,
        )  # fmt: skip
    # Cleared and dismissed name who and when together, exactly while the status says so;
    # a dismissal gives its reason.
    for change, constraint in (
        ("status = 'CLEARED'", "workpaper_review_notes_cleared"),
        ("status = 'CLEARED', cleared_at = clock_timestamp()", "workpaper_review_notes_cleared"),
        ("cleared_by = raised_by, cleared_at = clock_timestamp()",
         "workpaper_review_notes_cleared"),
        ("status = 'DISMISSED', dismissed_by = raised_by, dismissed_at = clock_timestamp()",
         "workpaper_review_notes_dismissed"),
        ("status = 'DISMISSED', dismissed_by = raised_by, dismissed_at = clock_timestamp(), "
         "dismiss_reason = 'Too short'", "workpaper_review_notes_dismissed"),
        ("dismiss_reason = 'A reason on a note that is not dismissed.'",
         "workpaper_review_notes_dismissed"),
        ("criticality = 'HIGH'", "workpaper_review_notes_criticality"),
    ):  # fmt: skip
        refused(
            f"UPDATE workpaper_review_notes SET {change}, version = version + 1 "  # noqa: S608
            "WHERE id = %s",
            psycopg.errors.CheckViolation, f'"{constraint}"', note_id,
        )  # fmt: skip
    # A status a note does not have is no transition of one.
    refused(
        "UPDATE workpaper_review_notes SET status = 'WITHDRAWN', version = version + 1 "
        "WHERE id = %s",
        psycopg.errors.RaiseException, "does not go from OPEN to WITHDRAWN", note_id,
    )  # fmt: skip
    # Never deleted; an event is written once.
    refused(
        "DELETE FROM workpaper_review_notes WHERE id = %s", psycopg.errors.RaiseException,
        "never deleted", note_id,
    )  # fmt: skip
    for statement in (
        "UPDATE workpaper_review_note_events SET text = 'Rewritten.' WHERE kind = 'REPLIED'",
        "UPDATE workpaper_review_note_events SET at = at",
        "DELETE FROM workpaper_review_note_events",
    ):
        refused(statement, psycopg.errors.RaiseException, "written once")
    assert notes.state() == before

    # A cleared note goes back to open only: never straight to dismissed.
    notes.done(note_id, "clear")
    refused(
        "UPDATE workpaper_review_notes SET status = 'DISMISSED', cleared_by = NULL, "
        "cleared_at = NULL, dismissed_by = raised_by, dismissed_at = clock_timestamp(), "
        "dismiss_reason = 'Dismissed without being reopened.', version = version + 1 "
        "WHERE id = %s",
        psycopg.errors.RaiseException, "does not go from CLEARED to DISMISSED", note_id,
    )  # fmt: skip

    def insert(error: type[psycopg.Error], message: str, **over: Any) -> None:
        values: dict[str, Any] = {
            "organization_id": desk.team["org"], "project_id": desk.team["project"],
            "workpaper_id": desk.paper_id, "number": 50, "anchor_kind": "FIELD",
            "field": "understanding", "quote": "", "prefix": "", "suffix": "", "occurrence": 0,
            "workpaper_version": 1, "text": NOTE, "criticality": "NORMAL", "owner_id": owner_id,
            "raised_by": owner_id,
        } | over  # fmt: skip
        columns = ", ".join(values)
        marks = ", ".join(["%s"] * len(values))
        refused(
            f"INSERT INTO workpaper_review_notes ({columns}) VALUES ({marks})",  # noqa: S608
            error, message, *values.values(),
        )  # fmt: skip

    check = psycopg.errors.CheckViolation
    unheld: tuple[tuple[dict[str, Any], str], ...] = (
        ({"anchor_kind": "CELL", "field": ""}, "workpaper_review_notes_anchor_kind"),
        ({"field": "has space"}, "workpaper_review_notes_field"),
        ({"field": "f" * 121}, "workpaper_review_notes_field"),
        ({"field": ""}, "workpaper_review_notes_anchor"),
        ({"quote": "words"}, "workpaper_review_notes_anchor"),
        ({"prefix": "before"}, "workpaper_review_notes_anchor"),
        ({"occurrence": 1}, "workpaper_review_notes_anchor"),
        ({"anchor_kind": "TEXT"}, "workpaper_review_notes_anchor"),
        ({"anchor_kind": "TEXT", "quote": "q" * 501}, "workpaper_review_notes_anchor"),
        ({"anchor_kind": "TEXT", "quote": "q", "field": ""}, "workpaper_review_notes_anchor"),
        ({"anchor_kind": "TEXT", "quote": "q", "prefix": "p" * 61},
         "workpaper_review_notes_around"),
        ({"anchor_kind": "TEXT", "quote": "q", "occurrence": -1},
         "workpaper_review_notes_occurrence"),
        ({"anchor_kind": "WORKPAPER"}, "workpaper_review_notes_anchor"),
        ({"anchor_kind": "WORKPAPER", "field": "", "quote": "q"}, "workpaper_review_notes_anchor"),
        ({"text": "Too short"}, "workpaper_review_notes_text"),
        ({"text": "x" * 2001}, "workpaper_review_notes_text"),
        ({"criticality": "HIGH"}, "workpaper_review_notes_criticality"),
        ({"number": 0}, "workpaper_review_notes_number"),
        ({"workpaper_version": 0}, "workpaper_review_notes_workpaper_version"),
    )  # fmt: skip
    for columns, constraint in unheld:
        insert(check, f'"{constraint}"', **columns)
    # One number per workpaper; raised open, at version 1, on a version the workpaper
    # has, in the workpaper's own engagement.
    insert(psycopg.errors.UniqueViolation, "workpaper_review_notes_number_key", number=1)
    raise_ = psycopg.errors.RaiseException
    insert(raise_, "raised open", status="RESPONDED")
    insert(raise_, "raised open", version=2)
    insert(raise_, "a version the workpaper has", workpaper_version=desk.current + 1)
    insert(raise_, "its workpaper's engagement", project_id=other_project)
    insert(psycopg.errors.ForeignKeyViolation, "workpaper_review_notes_workpaper_fk",
           workpaper_id=uuid4())  # fmt: skip
    insert(psycopg.errors.ForeignKeyViolation, "workpaper_review_notes_owner_fk",
           owner_id=uuid4())  # fmt: skip

    def event(error: type[psycopg.Error], message: str, **over: Any) -> None:
        values: dict[str, Any] = {
            "organization_id": desk.team["org"], "project_id": desk.team["project"],
            "note_id": note_id, "kind": "REPLIED", "by": owner_id, "text": "A reply.",
            "data": Json({}),
        } | over  # fmt: skip
        columns = ", ".join(values)
        marks = ", ".join(["%s"] * len(values))
        refused(
            f"INSERT INTO workpaper_review_note_events ({columns}) VALUES ({marks})",  # noqa: S608
            error, message, *values.values(),
        )  # fmt: skip

    unwritten: tuple[tuple[dict[str, Any], str], ...] = (
        ({"kind": "EDITED"}, "workpaper_review_note_events_kind"),
        ({"text": ""}, "workpaper_review_note_events_text"),
        ({"text": "y" * 2001}, "workpaper_review_note_events_text"),
        ({"kind": "DISMISSED", "text": "Too short"}, "workpaper_review_note_events_text"),
        ({"kind": "DISMISSED", "text": "z" * 501}, "workpaper_review_note_events_text"),
        ({"kind": "CLEARED"}, "workpaper_review_note_events_text"),
        ({"kind": "RAISED"}, "workpaper_review_note_events_text"),
        ({"data": Json([])}, "workpaper_review_note_events_data"),
        ({"data": Json({"from": "x" * 1000})}, "workpaper_review_note_events_data"),
    )
    for columns, constraint in unwritten:
        event(check, f'"{constraint}"', **columns)
    # An event names a note of its own engagement, and a person.
    event(psycopg.errors.ForeignKeyViolation, "workpaper_review_note_events_note_fk",
          project_id=other_project)  # fmt: skip
    event(psycopg.errors.ForeignKeyViolation, "workpaper_review_note_events_note_fk",
          note_id=uuid4())  # fmt: skip
    event(psycopg.errors.ForeignKeyViolation, "workpaper_review_note_events_by_fk", by=uuid4())
    # Nothing a note or an event names is deleted from under it: every foreign key of
    # the two tables restricts, and the workpaper stays.
    keys = notes.rows(
        "SELECT conname, confdeltype::text, confupdtype::text FROM pg_constraint "
        "WHERE contype = 'f' AND conrelid IN ('workpaper_review_notes'::regclass, "
        "'workpaper_review_note_events'::regclass)"
    )
    assert len(keys) == 9 and {(deleted, updated) for _n, deleted, updated in keys} == {("r", "r")}
    # The workpaper is never deleted under its notes: refused by a restricting key
    # (workpaper_versions' own key may answer first, so any integrity refusal counts).
    refused(
        "DELETE FROM workpapers WHERE id = %s", psycopg.errors.IntegrityError,
        "workpaper", desk.paper_id,
    )  # fmt: skip
    assert [n["number"] for n in notes.read()["notes"]] == [1]
    assert len(notes.trail(note_id)) == 3


def test_notes_raised_at_the_same_moment_are_numbered_one_after_another(
    migrated: Database,
) -> None:
    desk = _Desk(migrated, "wrn-number")
    notes = _Notes(desk)
    where = (desk.team["org"], desk.team["project"], UUID(desk.paper_id))
    person = Principal(kind=PrincipalKind.USER, id=notes.owner_id)
    body = review_notes.RaiseBody.model_validate(notes.body())

    def raise_some(_: int) -> list[int]:
        numbers: list[int] = []
        for _again in range(4):
            with connect(migrated.url) as connection:
                numbers.append(review_notes.raise_note(connection, person, *where, body).number)
        return numbers

    with ThreadPoolExecutor(max_workers=3) as pool:
        raised = [number for numbers in pool.map(raise_some, range(3)) for number in numbers]
    assert sorted(raised) == list(range(1, 13))
    assert [n["number"] for n in notes.read()["notes"]] == list(range(1, 13))
    assert len(notes.rows("SELECT 1 FROM workpaper_review_note_events")) == 12


def test_notes_on_a_testing_workpaper_work_the_same(migrated: Database) -> None:
    desk = _Desk(migrated, "wrn-testing")
    # The effectiveness workpaper, given a first version from the records (synthetic: the
    # notes read nothing of a workpaper's content).
    paper_id = UUID(desk.undrafted_id)
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        content = workpaper_service._content(connection, UUID(desk.paper_id), desk.current)
        assert content is not None
        workpaper_service._save(cursor, paper_id, content, "RECORDS", None, "Synthetic.")
        cursor.execute("UPDATE workpapers SET draft_status = 'IDLE' WHERE id = %s", (paper_id,))
    assert desk.paper(desk.undrafted_id)["stage"] == "EFFECTIVENESS"
    notes = _Notes(desk, desk.undrafted_id)
    design = _Notes(desk)
    reviewer_id, reviewer = notes.reviewer()
    assert notes.read()["can_raise"] is True

    words = notes.raised(
        reviewer, anchor_kind="TEXT", field="procedures.2", quote=" sample of  25 ",
        prefix="a ", suffix=" items", occurrence=1, criticality="URGENT",
    )  # fmt: skip
    whole = notes.raised(reviewer, anchor_kind="WORKPAPER", field="")
    assert [(n["number"], n["quote"]) for n in (words, whole)] == [(1, " sample of  25 "), (2, "")]
    assert words["raised_by"] == notes.person(reviewer_id)
    _refused(notes.act(words["id"], "clear"), 403, DECIDE_FORBIDDEN)
    notes.done(words["id"], "reply", text="The sample is 25 of 400.", responds=True)
    notes.done(words["id"], "reopen", reviewer, text="Say how it was selected.")
    notes.done(words["id"], "reply", text="Selected at random; added.", responds=True)
    assert notes.done(words["id"], "clear", reviewer)["status"] == "CLEARED"
    assert notes.done(whole["id"], "dismiss", reviewer, reason=REASON)["status"] == "DISMISSED"
    assert [kind for kind, _by, _text, _data in notes.trail(words["id"])] == [
        "RAISED", "RESPONDED", "REOPENED", "RESPONDED", "CLEARED",
    ]  # fmt: skip
    assert notes.read()["counts"] == NO_COUNTS | {"cleared": 1, "dismissed": 1}
    # Each workpaper has its own notes and its own numbers.
    assert design.read()["notes"] == []
    assert design.raised()["number"] == 1
    assert [n["number"] for n in notes.read()["notes"]] == [1, 2]


def test_the_design_sign_off_waits_for_urgent_notes_and_no_others(migrated: Database) -> None:
    case = _Draft(migrated, "wrn-sign")
    bench = case.bench
    owner, reviewer = bench.owner, case.reviewer
    url = f"{bench.base}/workpapers/{case.paper_id}/review-notes"
    case.chosen("EFFECTIVE")

    def raised(client: TestClient, criticality: str) -> dict[str, Any]:
        answer = client.post(
            url,
            json={
                "anchor_kind": "FIELD", "field": "conclusion", "workpaper_version": 1,
                "text": NOTE, "criticality": criticality,
                "owner_id": str(bench.team["owner_id"]),
            },
        )  # fmt: skip
        assert answer.status_code == 200, answer.text
        body: dict[str, Any] = answer.json()
        return body

    def act(client: TestClient, note: dict[str, Any], action: str, **body: Any) -> dict[str, Any]:
        current = next(n for n in client.get(url).json()["notes"] if n["id"] == note["id"])
        answer = client.post(
            f"{url}/{note['id']}/{action}", json={"version": current["version"], **body}
        )
        assert answer.status_code == 200, answer.text
        found: dict[str, Any] = answer.json()
        return found

    def held(count: int) -> None:
        sentence = signoff_refusal(count)
        assert sentence == f"clear or dismiss the urgent review notes first ({count})"
        body = case.body(reviewer)
        assert body["urgent_review_notes"] == count
        assert sentence in body["blocking"] and body["can_sign"] is False
        answer = case.sign_as("EFFECTIVE")
        assert (answer.status_code, answer.json()["detail"]) == (409, sentence), answer.text

    # An urgent note on the draft: the conclusion says so before the workpaper is
    # prepared, and preparing it is not held by notes.
    first = raised(reviewer, "URGENT")
    assert case.body(reviewer)["urgent_review_notes"] == 1
    case.prepare()
    held(1)
    # Responded to is not cleared: still held.
    act(owner, first, "reply", text="The conclusion names the approver now.", responds=True)
    held(1)
    # A normal note and a follow-up never hold it; a second urgent one is counted.
    normal, follow_up = raised(reviewer, "NORMAL"), raised(reviewer, "FOLLOW_UP")
    held(1)
    second = raised(reviewer, "URGENT")
    held(2)
    assert case.rows("SELECT count(*) FROM design_conclusions") == [(0,)]
    # Cleared, and dismissed: nothing urgent is open, whatever else is.
    act(reviewer, first, "clear")
    held(1)
    act(reviewer, second, "dismiss", reason=REASON)
    body = case.body(reviewer)
    assert (body["urgent_review_notes"], body["blocking"], body["can_sign"]) == (0, [], True)
    counts = reviewer.get(url).json()["counts"]
    assert counts == {"open": 2, "responded": 0, "cleared": 1, "dismissed": 1, "urgent_open": 0}
    assert {normal["status"], follow_up["status"]} == {"OPEN"}
    signed = case.sign_as("EFFECTIVE")
    assert signed.status_code == 200, signed.text
    assert (signed.json()["status"], signed.json()["urgent_review_notes"]) == ("SIGNED_OFF", 0)

    # Raised to urgent, or reopened, the note is counted again; the sign-off made stands.
    act(reviewer, normal, "criticality", criticality="URGENT")
    act(reviewer, second, "reopen", text="It does apply to this control.")
    body = case.body(reviewer)
    assert (body["status"], body["urgent_review_notes"]) == ("SIGNED_OFF", 2)
    assert signoff_refusal(2) in body["blocking"]
    with connect(migrated.url) as connection:
        assert urgent_open(connection, UUID(case.paper_id)) == 2
        assert urgent_open(connection, uuid4()) == 0


def test_where_the_migration_is_not_applied_the_sign_off_works_as_before(
    migrated: Database,
) -> None:
    """The code released before migration 0166: there is no note on record, so none
    holds the sign-off, and the conclusion is read and signed as before."""
    case = _Draft(migrated, "wrn-unmigrated")
    case.chosen("EFFECTIVE")
    case.prepare()
    with connect(migrated.url) as connection:
        connection.execute("DROP TABLE workpaper_review_note_events")
        connection.execute("DROP TABLE workpaper_review_notes")
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            # The savepoint leaves the caller's transaction usable.
            assert urgent_open(connection, UUID(case.paper_id)) == 0
            assert cursor.execute("SELECT 1").fetchone() == (1,)
    body = case.body(case.reviewer)
    assert (body["urgent_review_notes"], body["blocking"], body["can_sign"]) == (0, [], True)
    signed = case.sign_as("EFFECTIVE")
    assert signed.status_code == 200, signed.text
    assert signed.json()["status"] == "SIGNED_OFF"
    # The notes themselves are not there to read or raise until it is applied.
    url = f"{case.bench.base}/workpapers/{case.paper_id}/review-notes"
    assert case.reviewer.get(url).status_code == 503
