"""Working copies of a workpaper's sections (docs/design-workpaper.md, section 3.4).

What a person types is kept as their own working copy, replaced as they type and deleted
when they save the section, discard it, or the workpaper is prepared. It is never another
person's to read, replace or delete, it is kept only where an edit would be accepted, and
keeping it changes nothing of the workpaper and writes no audit event. Synthetic data only.
"""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Json
from support import Database, record_design_choice
from test_evidence_intake import _engagement
from test_execution import _add_project_member, _add_user, _ready
from test_outbound import _session, migrated
from test_testing_engine import _base

from ai_workforce_api import workpaper_drafts as drafts
from ai_workforce_api import workpaper_service
from ai_workforce_api.authorization import AccessDenied, NotVisible, Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.engagement_close import closed_detail
from ai_workforce_api.inbound import clean_line, clean_text
from ai_workforce_api.workpaper_service import run_draft

_ = migrated

PREPARED = "the workpaper is prepared; reopen it to change it"
DRAFTING = "the agent is drafting it"
NO_DRAFT = "the workpaper has no draft yet"
NO_SUCH_VERSION = "the workpaper has no such version yet; refresh and edit the latest version"


class _Desk:
    """One engagement with a control's design workpaper drafted from the records (a
    draft, version 1 or later, not being drafted) and its effectiveness workpaper opened
    and not drafted yet (no version)."""

    def __init__(self, database: Database, slug: str) -> None:
        self.database = database
        # The design work itself: no D&I conclusion in the setup.
        self.team, self.owner, _scheduler = _engagement(database, slug, design=False)
        self.root = _base(self.team)
        self.base = f"{self.root}/workpapers"
        controls = self.owner.get(f"{self.root}/workspace/controls").json()
        self.control_id = next(c["id"] for c in controls if c["control_ref"] == "ITGC-AC-02")
        opened = self.owner.post(f"{self.base}/draft", json={"control_id": self.control_id})
        assert opened.status_code == 200, opened.text
        papers = {w["stage"]: w for w in opened.json()}
        self.paper_id = str(papers["DESIGN"]["id"])
        self.undrafted_id = str(papers["EFFECTIVENESS"]["id"])
        with connect(database.url) as connection:
            run_draft(connection, None, UUID(self.paper_id))
        paper = self.paper()
        assert (paper["status"], paper["drafting"]) == ("DRAFT", False)
        assert paper["current_version"] >= 1
        sections = paper["content"]["sections"]
        self.text = str(next(s["key"] for s in sections if s["kind"] == "text"))
        table = next(s for s in sections if s["kind"] == "table" and len(s["columns"]) >= 2)
        self.table, self.width = str(table["key"]), len(table["columns"])
        self.fields = str(next(s["key"] for s in sections if s["kind"] == "fields"))

    def paper(self, paper_id: str | None = None) -> dict[str, Any]:
        listed = self.owner.get(self.base, params={"control_id": self.control_id})
        assert listed.status_code == 200, listed.text
        found: dict[str, Any] = next(
            w for w in listed.json() if w["id"] == (paper_id or self.paper_id)
        )
        return found

    @property
    def current(self) -> int:
        return int(self.paper()["current_version"])

    def conclude(self) -> None:
        """The preparer records a conclusion on the draft design workpaper, as preparing it
        needs (docs/design-workpaper.md, section 3.7). It moves the workpaper's version on:
        read the workpaper again before preparing."""
        record_design_choice(self.owner, self.root, self.control_id)

    def url(self, key: str, paper_id: str | None = None, root: str | None = None) -> str:
        base = self.base if root is None else f"{root}/workpapers"
        return f"{base}/{paper_id or self.paper_id}/sections/{key}/draft"

    def keep(self, key: str, client: TestClient | None = None, **body: Any) -> Any:
        return (client or self.owner).put(self.url(key), json=body)

    def discard(self, key: str, client: TestClient | None = None) -> Any:
        return (client or self.owner).delete(self.url(key))

    def mine(self, client: TestClient | None = None) -> Any:
        return (client or self.owner).get(f"{self.base}/{self.paper_id}/drafts")

    def edit(self, key: str, client: TestClient | None = None, **body: Any) -> Any:
        """The existing section edit: what a working copy's rules mirror."""
        return (client or self.owner).post(f"{self.base}/{self.paper_id}/sections/{key}", json=body)

    def member(self, role: str, on_project: bool = True) -> tuple[UUID, TestClient]:
        with connect(self.database.url) as connection:
            user = _add_user(
                connection, self.team["org"], f"{role.lower()}-{uuid4().hex[:6]}@example.com", role
            )
            if on_project:
                _add_project_member(connection, self.team["org"], self.team["project"], user)
        return user, _session(self.database, user)

    def kept(self) -> list[tuple[Any, ...]]:
        """Every working copy on record: whose, of which section, from which version."""
        with connect(self.database.url) as connection:
            return list(
                connection.execute(
                    "SELECT workpaper_id::text, section_key, user_id, based_on, content "
                    "FROM workpaper_section_drafts ORDER BY workpaper_id, section_key, user_id"
                ).fetchall()
            )

    def audited(self) -> list[str]:
        """The design workpaper's audit events, oldest first."""
        with connect(self.database.url) as connection:
            return [
                str(row[0])
                for row in connection.execute(
                    "SELECT action FROM audit_events WHERE target_type = 'workpaper' "
                    "AND target_id = %s ORDER BY occurred_at, id",
                    (self.paper_id,),
                ).fetchall()
            ]

    def state(self) -> tuple[Any, ...]:
        """Everything a working copy must leave alone: each workpaper's row (its status,
        `current_version`, `version` counter and timestamps), its versions, and the audit
        trail."""
        with connect(self.database.url) as connection:
            row = connection.execute(
                """
                SELECT (SELECT array_agg(w::text ORDER BY w.id) FROM workpapers w),
                       (SELECT array_agg(v.workpaper_id::text || ':' || v.number
                                         ORDER BY v.workpaper_id, v.number)
                        FROM workpaper_versions v),
                       (SELECT count(*) FROM audit_events)
                """
            ).fetchone()
        assert row is not None
        return tuple(row)


def test_a_working_copy_is_kept_replaced_and_read_back_and_changes_nothing_of_the_workpaper(
    migrated: Database,
) -> None:
    desk = _Desk(migrated, "wc-keep")
    current = desk.current
    before = desk.state()
    assert desk.mine().json() == []

    # Kept, and read back as it was kept: the text with its marks, the version it was
    # started from, and when.
    first = desk.keep(desk.text, based_on=current, text="HR records each **termination**.")
    assert first.status_code == 200, first.text
    assert set(first.json()) == {"updated_at"}
    # Rewritten 16 November 2026 (docs/design-workpaper.md, section 3.11: agent output is
    # never recorded as a person's). Old: a working copy read back as {section, based_on,
    # text, rows, updated_at}. New: it also says which agent's draft its text came from,
    # `proposal_id`, None for text the person typed (test_workpaper_redraft covers one
    # that names a draft). Every other field is as before.
    assert desk.mine().json() == [
        {
            "section": desk.text,
            "based_on": current,
            "text": "HR records each **termination**.",
            "rows": None,
            "proposal_id": None,
            "updated_at": first.json()["updated_at"],
        }
    ]
    # Replaced as the person types: still one row, kept later.
    second = desk.keep(desk.text, based_on=current, text="HR records each one.\n\n- a list")
    assert second.status_code == 200, second.text
    assert second.json()["updated_at"] > first.json()["updated_at"]
    (only,) = desk.mine().json()
    assert (only["text"], only["updated_at"]) == (
        "HR records each one.\n\n- a list",
        second.json()["updated_at"],
    )
    with connect(migrated.url) as connection:
        stamps = connection.execute(
            "SELECT count(*), bool_and(updated_at > created_at) FROM workpaper_section_drafts"
        ).fetchone()
    assert stamps == (1, True)

    # What is stored is cleaned as an edit cleans what it stores: markup removed, a value
    # that reads as a credential redacted, hidden characters and extra blank lines gone.
    typed = (
        "<p>Access is <b>removed</b> within 1 day.</p>\r\n\r\n\r\n\r\n"
        "password: synthetic-hunter2​ and ''this'' stays"
    )
    cleaned = desk.keep(desk.text, based_on=current, text=typed)
    assert cleaned.status_code == 200, cleaned.text
    stored = desk.mine().json()[0]["text"]
    assert stored == clean_text(typed, 12_000).text
    assert "<" not in stored and "hunter2" not in stored and "​" not in stored
    assert "password: [redacted]" in stored and "''this'' stays" in stored
    assert "\r" not in stored and "\n\n\n" not in stored

    # A table's rows: each cell one cleaned line cut at 1,000 characters, each row padded
    # or cut to the section's columns.
    rows = [
        ["a" * 1_001, "two\nlines", *["more"] * desk.width],
        ["only one"],
        ["api_key=synthetic-0000", "<b>kept as typed in a cell</b>"],
    ]
    tabled = desk.keep(desk.table, based_on=current, rows=rows)
    assert tabled.status_code == 200, tabled.text
    mine = {copy["section"]: copy for copy in desk.mine().json()}
    assert list(mine) == sorted([desk.text, desk.table])
    assert mine[desk.table]["text"] is None
    stored_rows = mine[desk.table]["rows"]
    assert stored_rows == [
        [clean_line(cell, 1000) for cell in (row + [""] * desk.width)[: desk.width]] for row in rows
    ]
    assert all(len(row) == desk.width for row in stored_rows)
    assert stored_rows[0][0] == "a" * 1_000 and stored_rows[0][1] == "two lines"
    assert stored_rows[1] == ["only one", *[""] * (desk.width - 1)]
    assert stored_rows[2][0] == "api_key=[redacted]"

    # The limits of an edit: 12,000 characters and 300 rows are kept; one more is refused.
    assert desk.keep(desk.text, based_on=current, text="a" * 12_000).status_code == 200
    assert desk.keep(desk.table, based_on=current, rows=[["r"]] * 300).status_code == 200
    held = desk.kept()
    for body in (
        {"based_on": current, "text": "a" * 12_001},
        {"based_on": current, "rows": [["r"]] * 301},
        # Exactly one of the text and the rows.
        {"based_on": current},
        {"based_on": current, "text": None, "rows": None},
        {"based_on": current, "text": "both", "rows": [["both"]]},
        {"based_on": current, "fields": [{"label": "a", "value": "b"}]},
        # The version it was started from: 1 or later, always given.
        {"based_on": 0, "text": "x"},
        {"text": "x"},
        {"based_on": current, "rows": "not rows"},
        {"based_on": current, "rows": [[1, 2]]},
        # The agent's draft a text came from: an id, and never beside rows.
        {"based_on": current, "text": "x", "proposal_id": "not an id"},
        {"based_on": current, "rows": [["x"]], "proposal_id": str(uuid4())},
    ):
        refused = desk.owner.put(desk.url(desk.text), json=body)
        assert refused.status_code == 422, (body.keys(), refused.text)
    # Refused with a sentence where an edit would not be accepted either.
    for key, body, sentence in (
        (desk.text, {"based_on": current + 1, "text": "x"}, NO_SUCH_VERSION),
        (desk.text, {"based_on": current, "rows": [["x"]]}, "a text section takes text"),
        (desk.table, {"based_on": current, "text": "x"}, "a table section takes rows"),
        (desk.fields, {"based_on": current, "text": "x"}, "a fields section keeps no working copy"),
        (desk.fields, {"based_on": current, "rows": [["x"]]},
         "a fields section keeps no working copy"),
        # An agent's draft there is not (test_workpaper_redraft covers the others).
        (desk.text, {"based_on": current, "text": "x", "proposal_id": str(uuid4())},
         "The agent's draft changed; read it again."),
    ):  # fmt: skip
        refused = desk.owner.put(desk.url(key), json=body)
        assert (refused.status_code, refused.json()["detail"]) == (409, sentence)
    # A workpaper with no version yet has no section to keep a working copy of.
    early = desk.owner.put(
        desk.url(desk.text, desk.undrafted_id), json={"based_on": 1, "text": "x"}
    )
    assert (early.status_code, early.json()["detail"]) == (409, NO_DRAFT)
    # A section the workpaper does not have, a workpaper there is not, and a workpaper
    # asked for under another engagement of the firm: not found, as an edit answers.
    unknown = desk.keep("no-such-section", based_on=current, text="x")
    assert unknown.status_code == 404
    assert desk.edit("no-such-section", based_on=current, text="x").status_code == 404
    nowhere = str(uuid4())
    with connect(migrated.url) as connection:
        other = connection.execute(
            "SELECT id FROM projects WHERE organization_id = %s AND id <> %s LIMIT 1",
            (desk.team["org"], desk.team["project"]),
        ).fetchone()
    assert other is not None
    elsewhere = f"/organizations/{desk.team['org']}/projects/{other[0]}"
    for paper_id, root in ((nowhere, None), (desk.paper_id, elsewhere)):
        url = desk.url(desk.text, paper_id, root)
        assert desk.owner.put(url, json={"based_on": 1, "text": "x"}).status_code == 404
        assert desk.owner.delete(url).status_code == 404
        assert desk.owner.get(url.rsplit("/sections/", 1)[0] + "/drafts").status_code == 404
    assert desk.kept() == held

    # Discarded: the person's own, of that section; 204 whether or not there was one.
    assert desk.discard(desk.text).status_code == 204
    assert [copy["section"] for copy in desk.mine().json()] == [desk.table]
    assert desk.discard(desk.text).status_code == 204
    assert desk.discard("no-such-section").status_code == 204
    assert desk.discard(desk.table).status_code == 204
    assert desk.mine().json() == [] and desk.kept() == []

    # Nothing of the workpaper changed through all of it: not its row, its
    # `current_version` or its `version` counter, not a version, not an audit event.
    assert desk.state() == before
    assert desk.current == current


def test_a_working_copy_is_its_persons_alone_and_kept_only_by_who_may_edit(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    _other_firm, _other_project, outsider = _ready(migrated, "wc-other-firm")
    desk = _Desk(migrated, "wc-roles")
    current = desk.current
    owner_id = desk.team["owner_id"]
    assert desk.keep(desk.text, based_on=current, text="The owner's typing.").status_code == 200
    mine = (desk.paper_id, desk.text, owner_id, current, {"text": "The owner's typing."})
    assert desk.kept() == [mine]
    before = desk.state()

    # A colleague on the engagement who may edit: never reads mine, keeps their own
    # beside it, and discards only their own.
    colleague_id, colleague = desk.member("CONTRIBUTOR")
    assert desk.mine(colleague).json() == []
    theirs = desk.keep(desk.text, colleague, based_on=current, text="The colleague's typing.")
    assert theirs.status_code == 200, theirs.text
    assert [copy["text"] for copy in desk.mine(colleague).json()] == ["The colleague's typing."]
    assert [copy["text"] for copy in desk.mine().json()] == ["The owner's typing."]
    also = (desk.paper_id, desk.text, colleague_id, current, {"text": "The colleague's typing."})
    assert sorted(desk.kept(), key=str) == sorted([mine, also], key=str)
    assert desk.discard(desk.text, colleague).status_code == 204
    assert desk.discard(desk.text, colleague).status_code == 204
    assert desk.kept() == [mine]

    def asks(client: TestClient | None) -> list[int]:
        """Read, keep and discard, then the edit the rules mirror (stale, so it never
        saves where it is allowed)."""
        return [
            desk.mine(client).status_code,
            desk.keep(desk.text, client, based_on=current, text="Not theirs to keep.").status_code,
            desk.discard(desk.text, client).status_code,
            desk.edit(desk.text, client, based_on=current + 5, text="x").status_code,
        ]

    # A Reviewer reads the workpaper and may not edit it: no working copy is kept (as the
    # edit is refused), their own list is empty, and discarding their none changes nothing.
    _reviewer_id, reviewer = desk.member("REVIEWER")
    assert asks(reviewer) == [200, 403, 204, 403]
    assert desk.mine(reviewer).json() == []
    # A person of the firm who is not on the engagement, and another firm's person: not
    # found, as the edit answers them. No session: not signed in.
    _stranger_id, stranger = desk.member("CONTRIBUTOR", on_project=False)
    assert asks(stranger) == [404, 404, 404, 404]
    assert asks(outsider) == [404, 404, 404, 404]
    assert asks(TestClient(desk.owner.app)) == [401, 401, 401, 401]
    # The routes take their principal from the session, always a person's. An agent
    # principal reaching them is refused as it is for an edit, before anything is written.
    agent = Principal(kind=PrincipalKind.AGENT, id=owner_id)
    with monkeypatch.context() as patched:
        patched.setattr(workpaper_service, "_session_principal", lambda _request: agent)
        refused = asks(None)
    assert len(set(refused)) == 1 and refused[0] in (403, 404)
    where = (desk.team["org"], desk.team["project"], UUID(desk.paper_id))
    typed = drafts.KeepBody(based_on=current, text="An agent keeps no working copy.")
    for call in (
        lambda c: drafts.mine(c, agent, *where),
        lambda c: drafts.keep(c, agent, *where, desk.text, typed),
        lambda c: drafts.discard_mine(c, agent, *where, desk.text),
    ):
        with connect(migrated.url) as connection, pytest.raises((NotVisible, AccessDenied)):
            call(connection)
    assert desk.kept() == [mine]
    assert desk.state() == before

    # An archived engagement is read-only: the middleware refuses keeping and discarding,
    # and the table refuses a write that reaches it. What was kept is still read.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (desk.team["project"],)
        )
    for answer in (
        desk.keep(desk.text, based_on=current, text="Too late."),
        desk.discard(desk.text),
    ):
        assert answer.status_code == 409, answer.text
        assert answer.json()["detail"] == closed_detail("ARCHIVED")
    for statement in (
        "DELETE FROM workpaper_section_drafts",
        "UPDATE workpaper_section_drafts SET based_on = based_on + 1",
    ):
        with (
            connect(migrated.url) as connection,
            pytest.raises(psycopg.errors.CheckViolation, match="archived"),
        ):
            connection.execute(statement)
    assert [copy["text"] for copy in desk.mine().json()] == ["The owner's typing."]
    assert desk.kept() == [mine]


def test_saving_a_section_deletes_my_working_copy_and_preparing_deletes_every_one(
    migrated: Database,
) -> None:
    desk = _Desk(migrated, "wc-save")
    first = desk.current
    owner_id = desk.team["owner_id"]
    colleague_id, colleague = desk.member("CONTRIBUTOR")
    audited = len(desk.audited())
    assert desk.keep(desk.text, based_on=first, text="Mine, unfinished.").status_code == 200
    assert desk.keep(desk.table, based_on=first, rows=[["my row"]]).status_code == 200
    assert desk.keep(desk.text, colleague, based_on=first, text="Theirs.").status_code == 200

    def whose() -> list[tuple[str, Any, int]]:
        return sorted(((str(r[1]), r[2], int(r[3])) for r in desk.kept()), key=str)

    everyone = sorted(
        [(desk.text, owner_id, first), (desk.table, owner_id, first),
         (desk.text, colleague_id, first)],
        key=str,
    )  # fmt: skip
    assert whose() == everyone
    # A save that is refused deletes nothing.
    assert desk.edit(desk.text, based_on=first + 1, text="Stale.").status_code == 409
    assert whose() == everyone
    # Saved: a new version, with its audit event as before, and my working copy of that
    # section is gone in the same step. My other section's and my colleague's are not.
    saved = desk.edit(desk.text, based_on=first, text="Mine, **finished**.")
    assert saved.status_code == 200, saved.text
    second = first + 1
    assert saved.json()["current_version"] == second
    assert whose() == sorted(
        [(desk.table, owner_id, first), (desk.text, colleague_id, first)], key=str
    )
    assert [copy["section"] for copy in desk.mine().json()] == [desk.table]
    # The colleague's was started from the version before: it is still theirs, read with
    # the version it was started from, and kept again from either version; never from one
    # the workpaper does not have.
    (theirs,) = desk.mine(colleague).json()
    assert (theirs["text"], theirs["based_on"]) == ("Theirs.", first)
    assert desk.keep(desk.text, colleague, based_on=first, text="Theirs, more.").status_code == 200
    assert desk.mine(colleague).json()[0]["based_on"] == first
    assert desk.keep(desk.text, colleague, based_on=second, text="Theirs, more.").status_code == 200
    assert desk.mine(colleague).json()[0]["based_on"] == second
    ahead = desk.keep(desk.text, colleague, based_on=second + 1, text="Theirs, more.")
    assert (ahead.status_code, ahead.json()["detail"]) == (409, NO_SUCH_VERSION)

    # While the agent is drafting the workpaper nothing is kept, as nothing is edited.
    held = desk.kept()
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET draft_status = 'WORKING' WHERE id = %s", (desk.paper_id,)
        )
    busy = desk.keep(desk.text, based_on=second, text="While it drafts.")
    assert (busy.status_code, busy.json()["detail"]) == (409, DRAFTING)
    edit = desk.edit(desk.text, based_on=second, text="While it drafts.")
    assert (edit.status_code, edit.json()["detail"]) == (409, DRAFTING)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET draft_status = 'IDLE' WHERE id = %s", (desk.paper_id,)
        )
    assert desk.kept() == held and len(held) == 2

    # Prepared: every working copy of the workpaper is deleted with it, whoever's, and
    # none is kept until it is reopened. A conclusion is recorded first, as preparing a
    # design workpaper needs (section 3.7); recording it keeps the working copies.
    desk.conclude()
    assert desk.kept() == held
    paper = desk.paper()
    prepared = desk.owner.post(
        f"{desk.base}/{desk.paper_id}/prepare", json={"version": paper["version"]}
    )
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["status"] == "PREPARED"
    assert desk.kept() == []
    assert desk.mine().json() == [] and desk.mine(colleague).json() == []
    for client in (None, colleague):
        frozen = desk.keep(desk.text, client, based_on=second, text="After preparation.")
        assert (frozen.status_code, frozen.json()["detail"]) == (409, PREPARED)
    frozen_edit = desk.edit(desk.text, based_on=second, text="After preparation.")
    assert (frozen_edit.status_code, frozen_edit.json()["detail"]) == (409, PREPARED)
    assert desk.discard(desk.text).status_code == 204
    assert desk.kept() == []
    reopened = desk.owner.post(
        f"{desk.base}/{desk.paper_id}/reopen",
        json={"version": prepared.json()["version"], "reason": "One more sentence to add."},
    )
    assert reopened.status_code == 200, reopened.text
    assert desk.keep(desk.text, based_on=second, text="After reopening.").status_code == 200
    assert whose() == [(desk.text, owner_id, second)]
    # The save, the sign-off and the reopening are the workpaper's audit events since the
    # first working copy was kept: no working copy, kept, replaced or deleted, ever is one.
    assert desk.audited()[audited:] == [
        "workpaper.edited",
        "workpaper.prepared",
        "workpaper.reopened",
    ]


def test_the_table_holds_one_shaped_working_copy_per_section_and_person_and_goes_with_them(
    migrated: Database,
) -> None:
    """The table's own rules, for a write that does not come through the routes."""
    desk = _Desk(migrated, "wc-table")
    current = desk.current
    owner_id = desk.team["owner_id"]
    assert desk.keep(desk.text, based_on=current, text="Kept.").status_code == 200

    def insert(content: Any, key: str = "another-section", based_on: int = 1) -> None:
        with connect(migrated.url) as connection:
            connection.execute(
                "INSERT INTO workpaper_section_drafts (organization_id, project_id, "
                "workpaper_id, section_key, user_id, based_on, content) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (desk.team["org"], desk.team["project"], desk.paper_id, key, owner_id, based_on,
                 Json(content)),
            )  # fmt: skip

    # Exactly one of a text and rows, of the right kind and within a save's limits.
    shapes: tuple[Any, ...] = (
        {},
        {"text": "x", "rows": [["y"]]},
        {"text": "x", "html": "<b>x</b>"},
        {"rows": [["y"]], "note": "z"},
        {"fields": []},
        {"text": 1},
        {"text": None},
        {"text": ["x"]},
        {"rows": "y"},
        {"rows": {"0": ["y"]}},
        ["text"],
        "text",
        {"text": "a" * 12_001},
        {"rows": [["r"]] * 301},
        # A text may name the agent's draft it came from (migration 0171): a uuid as a
        # string, beside a text only, and nothing else beside it.
        {"proposal_id": str(uuid4())},
        {"text": "x", "proposal_id": None},
        {"text": "x", "proposal_id": 1},
        {"text": "x", "proposal_id": "not an id"},
        {"text": "x", "proposal_id": str(uuid4()).upper()},
        {"text": "x", "proposal_id": str(uuid4()), "note": "z"},
        {"text": 1, "proposal_id": str(uuid4())},
        {"text": "a" * 12_001, "proposal_id": str(uuid4())},
        {"rows": [["y"]], "proposal_id": str(uuid4())},
    )
    for content in shapes:
        with pytest.raises(psycopg.errors.CheckViolation, match="workpaper_section_drafts_content"):
            insert(content)
    # A text that names one is kept, and read back with it.
    named = str(uuid4())
    insert({"text": "From the agent.", "proposal_id": named})
    named_in = {copy["section"]: copy["proposal_id"] for copy in desk.mine().json()}
    assert named_in == {desk.text: None, "another-section": named}
    assert desk.discard("another-section").status_code == 204
    with pytest.raises(psycopg.errors.CheckViolation, match="workpaper_section_drafts_based_on"):
        insert({"text": "x"}, based_on=0)
    for key in ("", "k" * 61):
        with pytest.raises(psycopg.errors.CheckViolation, match="workpaper_section_drafts_section"):
            insert({"text": "x"}, key=key)
    # One per workpaper, section and person.
    with pytest.raises(psycopg.errors.UniqueViolation, match="workpaper_section_drafts_one"):
        insert({"text": "A second one."}, key=desk.text)
    assert [(r[1], r[4]) for r in desk.kept()] == [(desk.text, {"text": "Kept."})]
    # A row of another shape that reached the table is not shown, and nothing fails.
    insert({"rows": [["a cell"], "not a row"]})
    assert [copy["section"] for copy in desk.mine().json()] == [desk.text]
    assert desk.discard("another-section").status_code == 204

    # It goes with its workpaper. No route deletes a workpaper, and one with a version
    # cannot be deleted at all (its versions are kept), so the one opened and not drafted
    # yet is used: its working copy is written directly, as no route keeps one there.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO workpaper_section_drafts (organization_id, project_id, workpaper_id, "
            "section_key, user_id, based_on, content) VALUES (%s, %s, %s, 'conclusion', %s, 1, %s)",
            (desk.team["org"], desk.team["project"], desk.undrafted_id, owner_id,
             Json({"text": "Goes with its workpaper."})),
        )  # fmt: skip
    assert sorted(r[0] for r in desk.kept()) == sorted([desk.paper_id, desk.undrafted_id])
    with connect(migrated.url) as connection:
        connection.execute("DELETE FROM workpapers WHERE id = %s", (desk.undrafted_id,))
    assert [r[0] for r in desk.kept()] == [desk.paper_id]
    # The workpaper itself is not deleted with its working copy.
    assert desk.discard(desk.text).status_code == 204
    assert desk.kept() == [] and desk.paper()["current_version"] == current


def test_where_the_migration_is_not_applied_a_section_is_still_saved_and_prepared(
    migrated: Database,
) -> None:
    """The code released before migration 0164: there is no working copy on record, so
    none is read or deleted, and saving a section and preparing the workpaper work as
    before. Only keeping one is refused."""
    desk = _Desk(migrated, "wc-unmigrated")
    current = desk.current
    with connect(migrated.url) as connection:
        connection.execute("DROP TABLE workpaper_section_drafts")
    assert desk.mine().json() == []
    assert desk.keep(desk.text, based_on=current, text="Not kept.").status_code == 503
    assert desk.discard(desk.text).status_code == 204
    saved = desk.edit(desk.text, based_on=current, text="Saved without a working copy.")
    assert saved.status_code == 200, saved.text
    assert saved.json()["current_version"] == current + 1
    with connect(migrated.url) as connection:
        edited = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'workpaper.edited' "
            "AND target_id = %s",
            (desk.paper_id,),
        ).fetchone()
    assert edited == (1,)
    # A conclusion is recorded first, as preparing a design workpaper needs (section 3.7):
    # it moves the workpaper's version on past the save's.
    desk.conclude()
    prepared = desk.owner.post(
        f"{desk.base}/{desk.paper_id}/prepare", json={"version": desk.paper()["version"]}
    )
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["status"] == "PREPARED"
