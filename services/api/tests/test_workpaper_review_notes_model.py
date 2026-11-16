"""Workpaper review notes: the rules (docs/workpaper-review.md, sections 2 to 4).

Pure: no database. The highlighted words are kept exactly as sent, less only control and
invisible characters; who may respond, clear, dismiss and hand a note on, as a table; the
statuses each act is taken from; and the sentence that holds a sign-off. Synthetic data
only.
"""

from datetime import UTC, datetime
from typing import Any, get_args
from uuid import UUID

import pytest
from pydantic import ValidationError

from ai_workforce_api.workpaper_review_notes import (
    ALREADY_RESPONDED,
    AROUND_LONG,
    FIELD_NEEDED,
    FIELD_NOT_TAKEN,
    QUOTE_NEEDED,
    QUOTE_NOT_TAKEN,
    REASON_LONG,
    REASON_SHORT,
    REPLY_LONG,
    REPLY_SHORT,
    TEXT_LONG,
    TEXT_SHORT,
    Act,
    Anchor,
    CanBody,
    ClearBody,
    NoteBody,
    NoteInvalid,
    PersonRef,
    RaiseBody,
    ReplyBody,
    Standing,
    Viewer,
    allowed,
    anchor_of,
    can_of,
    clean_note,
    clean_quote,
    clean_reason,
    clean_reply,
    counts_of,
    is_preparer,
    may_change_owner,
    may_decide,
    may_raise,
    may_respond,
    signoff_refusal,
    status_after,
    transition_refusal,
)

ACTS: tuple[Act, ...] = get_args(Act)
STATUSES = ("OPEN", "RESPONDED", "CLEARED", "DISMISSED")

RAISER, OWNER, PREPARER, OTHER = (UUID(int=n) for n in (1, 2, 3, 4))


def test_the_highlighted_words_are_kept_exactly_less_control_and_invisible_characters() -> None:
    # Leading and trailing spaces, runs of spaces, tabs and line breaks are the words.
    for kept in (
        "  two  spaces kept  ",
        " ",
        "a\tb",
        "line one\nline two\n",
        "carriage\r\nreturn",
        "<b>not markup here</b> &amp;",
        "password: synthetic-value",
        "caf\u00e9 and cafe\u0301",  # composed and decomposed, as sent: never normalized
        "\u00a0non-breaking\u00a0",
        "\u4e2d\u6587 \U0001f600",
    ):
        assert clean_quote(kept) == kept
    # Zero-width, joiner, direction-override and control characters are removed, and
    # nothing around them moves.
    assert clean_quote(" a\u200bb ") == " ab "
    assert clean_quote("\u202eevil\u202c  x") == "evil  x"
    assert clean_quote("\ufeffstart") == "start"
    assert clean_quote("a\u2066b\u2069c\u200d\u200e\u200f") == "abc"
    assert clean_quote("nul\x00 bell\x07 esc\x1b del\x7f c1\x85\x9f") == "nul bell esc del c1"
    assert clean_quote("lone\ud800 surrogate\udfff") == "lone surrogate"
    assert clean_quote("") == ""
    # Cleaning what is clean changes nothing.
    hostile = " \u200b a\x00  b\u202e \n"
    assert clean_quote(clean_quote(hostile)) == clean_quote(hostile) == "  a  b \n"


def test_an_anchor_is_a_field_highlighted_words_or_the_workpaper() -> None:
    assert anchor_of("WORKPAPER", "", None, None, None, None) == Anchor(
        "WORKPAPER", "", "", "", "", 0
    )
    assert anchor_of("WORKPAPER", "", "", "", "", 0).kind == "WORKPAPER"
    assert anchor_of("FIELD", "walkthrough.2.3", None, None, None, None) == Anchor(
        "FIELD", "walkthrough.2.3", "", "", "", 0
    )
    words = anchor_of("TEXT", "understanding", "  the  words ", " before", "after ", 3)
    assert words == Anchor("TEXT", "understanding", "  the  words ", " before", "after ", 3)
    # The occurrence is the first where none is sent; the surroundings may be empty.
    assert anchor_of("TEXT", "conclusion", "x", None, None, None) == Anchor(
        "TEXT", "conclusion", "x", "", "", 0
    )
    # What is stored is cleaned of invisible characters only, and measured afterwards.
    cleaned = anchor_of("TEXT", "conclusion", "a\u200b" * 500, "\u200b" * 61 + "p", None, None)
    assert (cleaned.quote, cleaned.prefix) == ("a" * 500, "p")
    assert anchor_of("TEXT", "conclusion", " ", None, None, None).quote == " "

    # A field's key: letters, digits, dots and hyphens, up to 120, starting with one of
    # the first two.
    for key in (
        "understanding",
        "conclusion.choice",
        "attributes.0193a5f0-7c1e-7000-8000-000000000001.result",
        "matters.12",
        "A",
        "a" * 120,
    ):
        assert anchor_of("FIELD", key, None, None, None, None).field == key
    for key in (
        "",
        ".start",
        "-start",
        "has space",
        "under_score",
        "a/b",
        "a" * 121,
        "a\n",
        "\u00e9",
    ):
        for kind in ("FIELD", "TEXT"):
            with pytest.raises(NoteInvalid) as refused:
                anchor_of(kind, key, "words", None, None, None)
            assert refused.value.detail == FIELD_NEEDED

    refusals: tuple[tuple[tuple[Any, ...], str], ...] = (
        (("WORKPAPER", "understanding", None, None, None, None), FIELD_NOT_TAKEN),
        (("WORKPAPER", "", "words", None, None, None), QUOTE_NOT_TAKEN),
        (("WORKPAPER", "", None, None, None, 1), QUOTE_NOT_TAKEN),
        (("FIELD", "understanding", "words", None, None, None), QUOTE_NOT_TAKEN),
        (("FIELD", "understanding", None, "before", None, None), QUOTE_NOT_TAKEN),
        (("FIELD", "understanding", None, None, "after", None), QUOTE_NOT_TAKEN),
        (("FIELD", "understanding", None, None, None, 2), QUOTE_NOT_TAKEN),
        (("TEXT", "understanding", None, None, None, None), QUOTE_NEEDED),
        (("TEXT", "understanding", "", None, None, None), QUOTE_NEEDED),
        (("TEXT", "understanding", "\u200b\x00", None, None, None), QUOTE_NEEDED),
        (("TEXT", "understanding", "a" * 501, None, None, None), QUOTE_NEEDED),
        (("TEXT", "understanding", "words", "p" * 61, None, None), AROUND_LONG),
        (("TEXT", "understanding", "words", None, "s" * 61, None), AROUND_LONG),
    )
    for sent, sentence in refusals:
        with pytest.raises(NoteInvalid) as refused:
            anchor_of(*sent)
        assert refused.value.detail == sentence, sent
    assert anchor_of("TEXT", "understanding", "a" * 500, "p" * 60, "s" * 60, 0).occurrence == 0


def test_a_notes_text_a_reply_and_a_reason_are_cleaned_and_bounded() -> None:
    assert clean_note("  Ten chars.  ") == "Ten chars."
    assert clean_note("<p>Who <b>approves</b> the access?</p>") == "Who approves the access?"
    assert clean_note("a\u200bb" + "c" * 8) == "ab" + "c" * 8
    assert "synthetic-0000" not in clean_note("The file shows api_key=synthetic-0000 in a cell.")
    assert clean_note("x" * 2000) == "x" * 2000
    assert clean_reply("k") == "k"
    assert clean_reply("y" * 2000) == "y" * 2000
    assert clean_reason("Not an issue.") == "Not an issue."
    assert clean_reason("z" * 500) == "z" * 500
    for clean, raw, sentence in (
        (clean_note, "Too short", TEXT_SHORT),
        (clean_note, "   \n  ", TEXT_SHORT),
        (clean_note, "\u200b" * 30, TEXT_SHORT),
        (clean_note, "x" * 2001, TEXT_LONG),
        (clean_reply, "", REPLY_SHORT),
        (clean_reply, " \n\t ", REPLY_SHORT),
        (clean_reply, "y" * 2001, REPLY_LONG),
        (clean_reason, "Too short", REASON_SHORT),
        (clean_reason, "z" * 501, REASON_LONG),
    ):
        with pytest.raises(NoteInvalid) as refused:
            clean(raw)
        assert refused.value.detail == sentence, raw[:20]


def test_the_bodies_take_only_what_a_note_is() -> None:
    note = {
        "anchor_kind": "FIELD", "field": "understanding", "workpaper_version": 1,
        "text": "Who approves the access?", "criticality": "URGENT", "owner_id": str(OWNER),
    }  # fmt: skip
    assert RaiseBody.model_validate(note).occurrence is None
    for wrong in (
        {**note, "anchor_kind": "CELL"},
        {**note, "criticality": "HIGH"},
        {**note, "criticality": "urgent"},
        {**note, "workpaper_version": 0},
        {**note, "occurrence": -1},
        {**note, "owner_id": "nobody"},
        {**note, "status": "CLEARED"},
        {**note, "raised_by": str(OTHER)},
        {**note, "number": 7},
        {**note, "field": "a" * 121},
        {k: v for k, v in note.items() if k != "owner_id"},
        {k: v for k, v in note.items() if k != "criticality"},
        {k: v for k, v in note.items() if k != "text"},
        {k: v for k, v in note.items() if k != "workpaper_version"},
    ):
        with pytest.raises(ValidationError):
            RaiseBody.model_validate(wrong)
    assert ReplyBody.model_validate({"text": "ok", "version": 1}).responds is False
    for body, sent in (
        (ReplyBody, {"text": "ok"}),
        (ReplyBody, {"text": "ok", "version": 0}),
        (ReplyBody, {"text": "ok", "version": 1, "status": "CLEARED"}),
        (ClearBody, {}),
        (ClearBody, {"version": 1, "cleared_by": str(OTHER)}),
    ):
        with pytest.raises(ValidationError):
            body.model_validate(sent)


def test_who_may_raise_respond_decide_and_hand_on() -> None:
    def viewer(who: UUID, may_update: bool = True, reviewer: bool = False) -> Viewer:
        return Viewer(who, may_update, reviewer)

    note = Standing(status="OPEN", raised_by=RAISER, owner_id=OWNER)

    # Raise and reply: update the work, or review it.
    assert may_raise(viewer(OTHER, True, False)) is True
    assert may_raise(viewer(OTHER, False, True)) is True
    assert may_raise(viewer(OTHER, False, False)) is False

    # The preparer: who prepared it while it is prepared; while it is a draft, anyone who
    # may update the work.
    assert is_preparer(viewer(PREPARER), PREPARER) is True
    assert is_preparer(viewer(OTHER), PREPARER) is False
    assert is_preparer(viewer(PREPARER, may_update=False), PREPARER) is True
    assert is_preparer(viewer(OTHER, may_update=True), None) is True
    assert is_preparer(viewer(OTHER, may_update=False, reviewer=True), None) is False

    # (who, may update, reviewer, prepared by) -> respond, decide, change owner
    table: tuple[tuple[str, UUID, bool, bool, UUID | None, tuple[bool, bool, bool]], ...] = (
        ("the raiser, a reviewer", RAISER, True, True, PREPARER, (False, True, True)),
        ("the raiser, not a reviewer", RAISER, True, False, PREPARER, (False, True, True)),
        ("the raiser, read-only now", RAISER, False, False, PREPARER, (False, True, True)),
        ("the owner", OWNER, True, False, PREPARER, (True, False, True)),
        ("the owner, read-only", OWNER, False, False, PREPARER, (True, False, True)),
        # Nobody closes a note addressed to them unless they raised it, a reviewer included.
        ("the owner, a reviewer", OWNER, True, True, PREPARER, (True, False, True)),
        ("the preparer", PREPARER, True, False, PREPARER, (True, False, False)),
        ("the preparer, a reviewer", PREPARER, True, True, PREPARER, (True, True, True)),
        ("another reviewer", OTHER, True, True, PREPARER, (False, True, True)),
        ("a reviewer who only reads", OTHER, False, True, PREPARER, (False, True, True)),
        ("a colleague", OTHER, True, False, PREPARER, (False, False, False)),
        ("a reader", OTHER, False, False, PREPARER, (False, False, False)),
        # A draft has no preparer of record: anyone who may update it responds.
        ("a colleague, on a draft", OTHER, True, False, None, (True, False, False)),
        ("a reader, on a draft", OTHER, False, False, None, (False, False, False)),
        ("a reviewer who reads, draft", OTHER, False, True, None, (False, True, True)),
    )
    for name, who, may_update, reviewer, prepared_by, expected in table:
        person = viewer(who, may_update, reviewer)
        found = (
            may_respond(person, note, prepared_by),
            may_decide(person, note),
            may_change_owner(person, note),
        )
        assert found == expected, name
        # `allowed` is the same rules by act; clearing, reopening, dismissing and the
        # criticality are one rule.
        assert allowed("respond", person, note, prepared_by) is expected[0], name
        for act in ("clear", "reopen", "dismiss", "criticality"):
            assert allowed(act, person, note, prepared_by) is expected[1], (name, act)
        assert allowed("owner", person, note, prepared_by) is expected[2], name
        assert allowed("reply", person, note, prepared_by) is (may_update or reviewer), name

    # A person who raised a note to themselves decides it.
    own = Standing(status="OPEN", raised_by=OWNER, owner_id=OWNER)
    assert may_decide(viewer(OWNER, True, False), own) is True
    # The rules read who the person is, never the note's status.
    for status in STATUSES:
        closed = Standing(status=status, raised_by=RAISER, owner_id=OWNER)
        assert may_decide(viewer(PREPARER, True, False), closed) is False
        assert may_decide(viewer(RAISER, True, False), closed) is True


def test_each_act_is_taken_from_its_statuses_only() -> None:
    taken: dict[str, tuple[str, ...]] = {
        "reply": ("OPEN", "RESPONDED"),
        "respond": ("OPEN",),
        "clear": ("OPEN", "RESPONDED"),
        "reopen": ("RESPONDED", "CLEARED", "DISMISSED"),
        "dismiss": ("OPEN", "RESPONDED"),
        "criticality": ("OPEN", "RESPONDED"),
        "owner": ("OPEN", "RESPONDED"),
    }
    assert set(taken) == set(ACTS)
    for act in ACTS:
        for status in STATUSES:
            refusal = transition_refusal(act, status)
            assert (refusal is None) is (status in taken[act]), (act, status)
    assert transition_refusal("respond", "RESPONDED") == ALREADY_RESPONDED
    assert transition_refusal("reopen", "OPEN") == "the note is already open"
    assert transition_refusal("clear", "CLEARED") == "the note is already cleared"
    assert transition_refusal("dismiss", "DISMISSED") == "the note is already dismissed"
    assert transition_refusal("clear", "DISMISSED") == "the note is dismissed; reopen it first"
    assert transition_refusal("dismiss", "CLEARED") == "the note is cleared; reopen it first"
    assert transition_refusal("reply", "CLEARED") == "the note is cleared; reopen it first"
    assert transition_refusal("respond", "DISMISSED") == "the note is dismissed; reopen it first"
    assert transition_refusal("owner", "CLEARED") == "the note is cleared; reopen it first"
    assert transition_refusal("criticality", "DISMISSED") == (
        "the note is dismissed; reopen it first"
    )
    # What each act leaves: a reply, the criticality and the owner leave the status.
    assert [status_after(act, "OPEN") for act in ACTS] == [
        "OPEN", "RESPONDED", "CLEARED", "OPEN", "DISMISSED", "OPEN", "OPEN",
    ]  # fmt: skip
    assert status_after("reply", "RESPONDED") == "RESPONDED"
    assert status_after("reopen", "CLEARED") == "OPEN"


def test_what_a_person_can_do_is_the_rules_and_the_status_together() -> None:
    reviewer = Viewer(RAISER, True, True)
    preparer = Viewer(PREPARER, True, False)

    def can(viewer: Viewer, status: str, open_: bool = True) -> set[str]:
        note = Standing(status=status, raised_by=RAISER, owner_id=PREPARER)
        found = can_of(viewer, note, PREPARER, open_)
        assert set(CanBody.model_fields) == set(ACTS)
        return {act for act, allowed_ in found.model_dump().items() if allowed_}

    assert can(reviewer, "OPEN") == {"reply", "clear", "dismiss", "criticality", "owner"}
    assert can(preparer, "OPEN") == {"reply", "respond", "owner"}
    assert can(reviewer, "RESPONDED") == {
        "reply", "clear", "reopen", "dismiss", "criticality", "owner",
    }  # fmt: skip
    assert can(preparer, "RESPONDED") == {"reply", "owner"}
    for closed in ("CLEARED", "DISMISSED"):
        assert can(reviewer, closed) == {"reopen"}
        assert can(preparer, closed) == set()
    # A completed or archived engagement takes nothing.
    for status in STATUSES:
        assert can(reviewer, status, open_=False) == set()
        assert can(preparer, status, open_=False) == set()


def test_only_urgent_notes_open_or_responded_hold_a_sign_off() -> None:
    assert signoff_refusal(0) is None
    assert signoff_refusal(-1) is None
    assert signoff_refusal(1) == "clear or dismiss the urgent review notes first (1)"
    assert signoff_refusal(12) == "clear or dismiss the urgent review notes first (12)"

    person = PersonRef(id=RAISER, name="Rhea Reviewer")
    nothing = can_of(Viewer(OTHER, False, False), Standing("OPEN", RAISER, OWNER), None, True)

    def note(number: int, criticality: str, status: str) -> NoteBody:
        return NoteBody(
            id=UUID(int=100 + number), number=number, anchor_kind="WORKPAPER", field="",
            quote="", prefix="", suffix="", occurrence=0, workpaper_version=1,
            text="A synthetic review note.", criticality=criticality, status=status,  # type: ignore[arg-type]
            owner=person, raised_by=person, raised_at=datetime(2027, 2, 1, tzinfo=UTC),
            cleared_by=None, cleared_at=None, dismissed_by=None, dismissed_at=None,
            dismiss_reason="", version=1, events=[], can=nothing,
        )  # fmt: skip

    assert counts_of([]).model_dump() == {
        "open": 0, "responded": 0, "cleared": 0, "dismissed": 0, "urgent_open": 0,
    }  # fmt: skip
    notes = [
        note(1, "URGENT", "OPEN"),
        note(2, "URGENT", "RESPONDED"),
        note(3, "URGENT", "CLEARED"),
        note(4, "URGENT", "DISMISSED"),
        note(5, "NORMAL", "OPEN"),
        note(6, "FOLLOW_UP", "RESPONDED"),
        note(7, "NORMAL", "CLEARED"),
    ]
    assert counts_of(notes).model_dump() == {
        "open": 2, "responded": 2, "cleared": 2, "dismissed": 1, "urgent_open": 2,
    }  # fmt: skip
