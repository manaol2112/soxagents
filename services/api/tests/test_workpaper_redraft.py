"""Redraft a section a person has edited (docs/design-workpaper.md, section 3.11).

The person asks the agent to redraft one text section from its editor: a proposal is
recorded PENDING and one registered agent run drafts it, under the drafter's safeguards
(the same standing instructions and prompt version, the facts and the evidence as data,
the preparer's current text inside the facts, the citation check, the run record). The
proposal is the agent's: nothing of the workpaper changes until the person saves the
section from it, a person's save whose note and audit event name the agent's draft. One
proposal stands per workpaper, section and person; it ends once (USED, KEPT_MINE or
SUPERSEDED), is never deleted, and is read only by the person who asked. Synthetic data
only.
"""

from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database, record_design_choice
from test_evidence_analysis import _Provider
from test_evidence_intake import _client, _engagement, _request, _Scheduler
from test_execution import _add_project_member, _add_user, _ready
from test_outbound import migrated
from test_testing_engine import _add, _base, _read_all

from ai_workforce_api import workpaper_redraft as redraft
from ai_workforce_api import workpaper_service
from ai_workforce_api.authorization import AccessDenied, NotVisible, Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.engagement_close import closed_detail
from ai_workforce_api.inbound import clean_text
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.workpaper_service import run_draft

_ = migrated

EVIDENCE = (
    "Access request AR-1042. Approved by the IT manager in ServiceNow on 3 March before "
    "access was granted to the finance role."
)
MINE = "The IT manager **approves** each access request before access is granted."
CHANGED = "the workpaper changed; refresh and edit the latest version"


class _Redrafts(_Scheduler):
    """The engine as the routes see it: what was handed over, never run by itself (the
    tests run each proposal's run directly)."""

    def __init__(self, fails: bool = False) -> None:
        super().__init__()
        self.redrafts: list[UUID] = []
        self.fails = fails

    def schedule_workpaper_redrafts(self, proposal_ids: list[UUID]) -> None:
        if self.fails:
            raise RuntimeError("the engine is not reachable")
        self.redrafts.extend(proposal_ids)


class _Bench:
    """One engagement with a control's design workpaper drafted from the records, one
    evidence file read for the control (unless told not to: the agent then has nothing to
    draft from), and its understanding section saved by a person."""

    def __init__(self, database: Database, slug: str, evidence: bool = True) -> None:
        self.database = database
        self.team, _owner, _scheduler = _engagement(database, slug, design=False)
        self.scheduler = _Redrafts()
        self.owner = _client(database, self.team["owner_id"], self.scheduler)
        self.root = _base(self.team)
        self.base = f"{self.root}/workpapers"
        controls = self.owner.get(f"{self.root}/workspace/controls").json()
        self.control_id = next(c["id"] for c in controls if c["control_ref"] == "ITGC-AC-02")
        self.file_id = ""
        if evidence:
            # The control's D&I request (OE is not released without a D&I conclusion).
            kickoff = _request(database, self.team, "ITGC-AC-02", "DESIGN")
            _add(self.owner, self.team, "approval record.txt", EVIDENCE, kickoff["id"])
            _read_all(database, self.scheduler)
            files = self.owner.get(f"{self.root}/evidence-register").json()["files"]
            self.file_id = next(f["id"] for f in files if f["file_name"] == "approval record.txt")
        opened = self.owner.post(f"{self.base}/draft", json={"control_id": self.control_id})
        assert opened.status_code == 200, opened.text
        papers = {w["stage"]: w for w in opened.json()}
        self.paper_id = str(papers["DESIGN"]["id"])
        with connect(database.url) as connection:
            run_draft(connection, None, UUID(self.paper_id))
        sections = self.paper()["content"]["sections"]
        self.key = next(s["key"] for s in sections if s["key"].startswith("understanding-"))
        self.title = next(s["title"] for s in sections if s["key"] == self.key)
        self.other = next(
            s["key"] for s in sections
            if s["kind"] == "text" and s["narrative"] and s["key"] != self.key
        )  # fmt: skip
        self.table = next(s["key"] for s in sections if s["kind"] == "table")
        self.fields = next(s["key"] for s in sections if s["kind"] == "fields")
        self.plain = next(
            (s["key"] for s in sections if s["kind"] == "text" and not s["narrative"]), None
        )
        saved = self.edit(self.key, based_on=self.current, text=MINE)
        assert saved.status_code == 200, saved.text
        assert self.section(self.key)["source"] == "PERSON"

    def paper(self) -> dict[str, Any]:
        listed = self.owner.get(self.base, params={"control_id": self.control_id})
        assert listed.status_code == 200, listed.text
        found: dict[str, Any] = next(w for w in listed.json() if w["id"] == self.paper_id)
        return found

    @property
    def current(self) -> int:
        return int(self.paper()["current_version"])

    def section(self, key: str) -> dict[str, Any]:
        found: dict[str, Any] = next(
            s for s in self.paper()["content"]["sections"] if s["key"] == key
        )
        return found

    def url(self, key: str) -> str:
        return f"{self.base}/{self.paper_id}/sections/{key}"

    def ask(self, key: str | None = None, client: TestClient | None = None, **body: Any) -> Any:
        body.setdefault("workpaper_version", self.current)
        return (client or self.owner).post(f"{self.url(key or self.key)}/redraft", json=body)

    def asked(self, key: str | None = None, client: TestClient | None = None) -> dict[str, Any]:
        answer = self.ask(key, client)
        assert answer.status_code == 202, answer.text
        proposal: dict[str, Any] = answer.json()["proposal"]
        return proposal

    def read(self, key: str | None = None, client: TestClient | None = None) -> Any:
        return (client or self.owner).get(f"{self.url(key or self.key)}/proposal")

    def mine(self, key: str | None = None, client: TestClient | None = None) -> Any:
        answer = self.read(key, client)
        assert answer.status_code == 200, answer.text
        return answer.json()["proposal"]

    def keep_mine(
        self, proposal_id: str, key: str | None = None, client: TestClient | None = None
    ) -> Any:
        return (client or self.owner).post(
            f"{self.url(key or self.key)}/proposal/{proposal_id}/keep-mine", json={}
        )

    def edit(self, key: str, client: TestClient | None = None, **body: Any) -> Any:
        return (client or self.owner).post(self.url(key), json=body)

    def run(self, proposal_id: str, provider: Any) -> str:
        with connect(self.database.url) as connection:
            return redraft.run_redraft(connection, provider, UUID(proposal_id))

    def answer(self, text: str, key: str | None = None) -> dict[str, Any]:
        return {"sections": [{"key": key or self.key, "text": text}]}

    def member(self, role: str, on_project: bool = True) -> tuple[UUID, TestClient]:
        with connect(self.database.url) as connection:
            user = _add_user(
                connection, self.team["org"], f"{role.lower()}-{uuid4().hex[:6]}@example.com", role
            )
            if on_project:
                _add_project_member(connection, self.team["org"], self.team["project"], user)
        # The same engine as the owner's, so a colleague's request is handed over too.
        return user, _client(self.database, user, self.scheduler)

    def rows(self, statement: str, *values: Any) -> list[tuple[Any, ...]]:
        with connect(self.database.url) as connection:
            return [tuple(row) for row in connection.execute(statement, values).fetchall()]

    def ended(self, proposal_id: str) -> tuple[Any, ...]:
        (row,) = self.rows(
            "SELECT status, ended_as, ended_by FROM workpaper_section_proposals WHERE id = %s",
            proposal_id,
        )
        return row

    def workpaper(self) -> tuple[Any, ...]:
        """Everything a proposal must leave alone: the workpaper's row (its status, its
        `current_version`, `version` counter and timestamps) and each version, whole."""
        (row,) = self.rows(
            """
            SELECT (SELECT w::text FROM workpapers w WHERE w.id = %s),
                   (SELECT array_agg(v::text ORDER BY v.number) FROM workpaper_versions v
                    WHERE v.workpaper_id = %s)
            """,
            self.paper_id,
            self.paper_id,
        )
        return row

    def audited(self) -> list[tuple[str, Any, Any, Any]]:
        return [
            (str(r[0]), r[1], r[2], r[3])
            for r in self.rows(
                "SELECT action, payload, actor_user_id, actor_agent_instance_id FROM audit_events "
                "WHERE target_type = 'workpaper' AND target_id = %s ORDER BY occurred_at, id",
                self.paper_id,
            )
        ]


def test_a_redraft_is_proposed_beside_the_persons_text_and_changes_nothing_until_saved(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "rd-propose")
    current = bench.current
    before = bench.workpaper()
    assert bench.mine() is None

    proposal = bench.asked()
    assert proposal["status"] == "PENDING" and proposal["based_on"] == current
    assert (proposal["text"], proposal["citations"], proposal["words"]) == ("", [], 0)
    assert (proposal["ready_at"], proposal["failure"], proposal["removed_note"]) == (None, "", "")
    assert set(proposal) == {
        "id", "section_key", "based_on", "status", "text", "citations", "words",
        "requested_at", "ready_at", "failure", "removed_note",
    }  # fmt: skip
    assert proposal["section_key"] == bench.key
    # Handed to the engine once committed, and read back as it stands.
    assert bench.scheduler.redrafts == [UUID(proposal["id"])]
    assert bench.mine() == proposal
    assert bench.workpaper() == before

    # The agent's run: one section, the drafter's prompt and version, the person's text
    # inside the facts as data, and its citations checked against the file as a draft's.
    provider = _Provider(
        [
            bench.answer(
                "The IT manager approves each access request in ServiceNow before access is "
                f'granted. [cite:{bench.file_id} "Approved by the IT manager in ServiceNow"] '
                f'The approval was seen. [cite:{bench.file_id} "words the file does not have"]'
            )
        ]
    )
    assert bench.run(proposal["id"], provider) == "READY"
    (request,) = provider.requests
    assert request.system == workpaper_service.SYSTEM_PROMPT
    facts = request.prompt.split("<workpaper_facts>\n", 1)[1].split("\n</workpaper_facts>", 1)[0]
    assert '"preparer_current_text": "The IT manager **approves** each access request' in facts
    assert '"draft_walkthrough_steps": false' in facts
    assert request.prompt.count("<workpaper_facts>") == 1
    assert "approval record.txt" in request.prompt

    ready = bench.mine()
    assert ready["status"] == "READY" and ready["ready_at"] is not None
    assert ready["text"].startswith(
        "The IT manager approves each access request in ServiceNow before access is granted."
    )
    assert "[^1]" in ready["text"] and "[cite:" not in ready["text"]
    assert "[^2]" not in ready["text"] and ready["text"].rstrip().endswith("was seen.")
    [citation] = ready["citations"]
    assert citation["evidence_file_id"] == bench.file_id and citation["number"] == 1
    assert citation["quote"] == "Approved by the IT manager in ServiceNow"
    assert ready["words"] == redraft.words_of(ready["text"]) == 17
    assert ready["removed_note"] == (
        f"1 quotation in {bench.title} was not found in its file and was removed; read the "
        "sentence again."
    )
    assert ready["failure"] == ""
    # The run record: the model call under the drafter's version, for the workpaper, with
    # the proposal's run id as its job.
    (run_id,) = bench.rows(
        "SELECT run_id FROM workpaper_section_proposals WHERE id = %s", proposal["id"]
    )[0]
    calls = bench.rows(
        "SELECT prompt_version, agent_key, target_type, target_id::text, job_id, "
        "inputs ->> 'proposal', inputs ->> 'section' FROM model_calls WHERE job_id = %s",
        run_id,
    )
    assert calls == [
        ("workpaper-preparer/5", "workpaper-preparer", "workpaper", bench.paper_id, run_id,
         proposal["id"], bench.key),
    ]  # fmt: skip

    # Nothing of the workpaper changed: not its row, its versions or its content. The
    # section is still the person's text.
    assert bench.workpaper() == before
    assert bench.section(bench.key)["text"] == MINE
    assert bench.section(bench.key)["source"] == "PERSON"
    # On the audit trail: the person asked; the agent drafted for them.
    trail = bench.audited()[-2:]
    assert [entry[0] for entry in trail] == ["workpaper.redraft_requested", "workpaper.redrafted"]
    assert trail[0][1] == {"section": bench.key, "proposal_id": proposal["id"], "based_on": current}
    assert trail[0][3] is None
    assert trail[1][1] == {
        "section": bench.key, "proposal_id": proposal["id"], "status": "READY",
        "quotations_removed": 1,
    }  # fmt: skip
    assert trail[1][2] == bench.team["owner_id"] and trail[1][3] is not None
    # A run of a proposal that is no longer PENDING does nothing.
    again = _Provider([bench.answer("Something else.")])
    assert bench.run(proposal["id"], again) == "SKIPPED" and again.requests == []


def test_using_the_draft_is_a_persons_save_that_names_the_proposal(migrated: Database) -> None:
    bench = _Bench(migrated, "rd-use")
    proposal = bench.asked()
    text = (
        f'The IT manager approves each request. [cite:{bench.file_id} "Approved by the IT manager"]'
    )
    assert bench.run(proposal["id"], _Provider([bench.answer(text)])) == "READY"
    ready = bench.mine()
    current = bench.current

    # A proposal that is not the caller's standing READY one for the section is refused,
    # and nothing is saved.
    for other in (str(uuid4()), proposal["id"]):
        key = bench.other if other == proposal["id"] else bench.key
        refused = bench.edit(key, based_on=current, text=ready["text"], proposal_id=other)
        assert (refused.status_code, refused.json()["detail"]) == (409, redraft.PROPOSAL_CHANGED)
    assert bench.edit(bench.key, based_on=current, text="x", proposal_id="no").status_code == 422
    assert bench.current == current

    # "Use the draft", then a word changed, then Save: the person's version.
    used = ready["text"].replace("each request", "each access request")
    saved = bench.edit(bench.key, based_on=current, text=used, proposal_id=ready["id"])
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["current_version"] == current + 1
    [newest, *_older] = body["versions"]
    assert newest["source"] == "PERSON" and newest["created_by"] is not None
    stamp = redraft.when(
        bench.rows("SELECT ready_at FROM workpaper_section_proposals WHERE id = %s", ready["id"])[
            0
        ][0]
    )
    assert newest["note"] == (
        f"Edited {bench.key.replace('-', ' ')}. From the agent's draft of {stamp}."
    )
    section = next(s for s in body["content"]["sections"] if s["key"] == bench.key)
    assert (section["text"], section["source"]) == (clean_text(used, 12_000).text, "PERSON")
    # Its marks are the draft's citations.
    assert section["citations"] == ready["citations"] and "[^1]" in section["text"]
    # The proposal ended USED, by the person; none stands for the section any more.
    assert bench.ended(ready["id"]) == ("READY", "USED", bench.team["owner_id"])
    assert bench.mine() is None
    action, payload, actor, agent = bench.audited()[-1]
    assert (action, payload, actor, agent) == (
        "workpaper.edited", {"section": bench.key, "proposal_id": ready["id"]},
        bench.team["owner_id"], None,
    )  # fmt: skip
    # The proposal is used once: a second save from it is refused.
    twice = bench.edit(bench.key, based_on=current + 1, text=used, proposal_id=ready["id"])
    assert (twice.status_code, twice.json()["detail"]) == (409, redraft.PROPOSAL_CHANGED)

    # "Draft again" rewriting a section the agent drafts (no person saved it) supersedes a
    # redraft of it, ended by whoever asked for the draft; the person's section is kept.
    other = bench.asked(bench.other)
    drafted = bench.owner.post(f"{bench.base}/draft", json={"control_id": bench.control_id})
    assert drafted.status_code == 200, drafted.text
    with connect(migrated.url) as connection:
        assert (
            run_draft(connection, _Provider([bench.answer("Redrafted.", bench.other)]),
                      UUID(bench.paper_id))
            == "DONE"
        )  # fmt: skip
    assert bench.section(bench.other)["text"] == "Redrafted."
    assert bench.ended(other["id"]) == ("PENDING", "SUPERSEDED", bench.team["owner_id"])
    assert bench.section(bench.key)["text"] == clean_text(used, 12_000).text


def test_one_proposal_stands_and_a_newer_request_or_another_version_supersedes_it(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "rd-supersede")
    first = bench.asked()
    second = bench.asked()
    assert bench.ended(first["id"]) == ("PENDING", "SUPERSEDED", bench.team["owner_id"])
    assert bench.mine()["id"] == second["id"]
    # The superseded one is not drafted: no model call is made for it.
    idle = _Provider([bench.answer("Not drafted.")])
    assert bench.run(first["id"], idle) == "SKIPPED" and idle.requests == []

    # Keep mine ends it; nothing of the workpaper changes.
    assert bench.run(second["id"], _Provider([bench.answer("The agent's text.")])) == "READY"
    before = bench.workpaper()
    kept = bench.keep_mine(second["id"])
    assert (kept.status_code, kept.json()) == (200, {"proposal": None})
    assert bench.ended(second["id"]) == ("READY", "KEPT_MINE", bench.team["owner_id"])
    assert bench.mine() is None and bench.workpaper() == before
    assert bench.audited()[-1][:2] == (
        "workpaper.redraft_kept_mine", {"section": bench.key, "proposal_id": second["id"]},
    )  # fmt: skip
    again = bench.keep_mine(second["id"])
    assert (again.status_code, again.json()["detail"]) == (409, redraft.PROPOSAL_CHANGED)
    assert bench.keep_mine(str(uuid4())).status_code == 404

    # A version of the section saved on another basis supersedes the one that stands,
    # everyone's; a version of another section does not.
    colleague_id, colleague = bench.member("CONTRIBUTOR")
    mine = bench.asked()
    theirs = bench.asked(client=colleague)
    # Each reads their own only.
    assert bench.mine()["id"] == mine["id"]
    assert bench.mine(client=colleague)["id"] == theirs["id"]
    assert bench.keep_mine(mine["id"], client=colleague).status_code == 404
    elsewhere = bench.edit(bench.other, based_on=bench.current, text="Another section.")
    assert elsewhere.status_code == 200, elsewhere.text
    assert bench.ended(mine["id"])[1] is None and bench.ended(theirs["id"])[1] is None
    # A redraft asked for at a version since replaced is refused.
    stale = bench.ask(workpaper_version=bench.current - 1)
    assert (stale.status_code, stale.json()["detail"]) == (409, CHANGED)
    saved = bench.edit(bench.key, based_on=bench.current, text="My own words, saved.")
    assert saved.status_code == 200, saved.text
    assert bench.ended(mine["id"]) == ("PENDING", "SUPERSEDED", bench.team["owner_id"])
    assert bench.ended(theirs["id"]) == ("PENDING", "SUPERSEDED", bench.team["owner_id"])
    assert bench.mine() is None and bench.mine(client=colleague) is None

    # Saving from my proposal supersedes my colleague's for the section; theirs cannot be
    # used by me.
    mine = bench.asked()
    theirs = bench.asked(client=colleague)
    assert bench.run(mine["id"], _Provider([bench.answer("Mine, drafted.")])) == "READY"
    assert bench.run(theirs["id"], _Provider([bench.answer("Theirs, drafted.")])) == "READY"
    current = bench.current
    taken = bench.edit(
        bench.key, based_on=current, text="Theirs, drafted.", proposal_id=theirs["id"]
    )
    assert (taken.status_code, taken.json()["detail"]) == (409, redraft.PROPOSAL_CHANGED)
    saved = bench.edit(bench.key, based_on=current, text="Mine, drafted.", proposal_id=mine["id"])
    assert saved.status_code == 200, saved.text
    assert bench.ended(mine["id"])[1] == "USED"
    assert bench.ended(theirs["id"]) == ("READY", "SUPERSEDED", bench.team["owner_id"])
    assert colleague_id != bench.team["owner_id"]


def test_a_proposal_ended_while_the_agent_drafts_is_not_written(migrated: Database) -> None:
    bench = _Bench(migrated, "rd-cancel")
    proposal = bench.asked()

    class _KeptMeanwhile(_Provider):
        def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
            # The person presses "Keep mine" while the model answers.
            assert bench.keep_mine(proposal["id"]).status_code == 200
            return super().complete(request, config)

    provider = _KeptMeanwhile([bench.answer("Too late.")])
    assert bench.run(proposal["id"], provider) == "CANCELLED"
    assert len(provider.requests) == 1
    assert bench.rows(
        "SELECT status, text, ended_as FROM workpaper_section_proposals WHERE id = %s",
        proposal["id"],
    ) == [("PENDING", "", "KEPT_MINE")]


def test_a_redraft_that_cannot_be_drafted_fails_in_one_sentence(migrated: Database) -> None:
    bench = _Bench(migrated, "rd-fail")
    before = bench.workpaper()

    # No model configured.
    proposal = bench.asked()
    assert bench.run(proposal["id"], None) == "FAILED"
    failed = bench.mine()
    assert (failed["status"], failed["failure"], failed["text"]) == (
        "FAILED", redraft.NO_MODEL, "",
    )  # fmt: skip
    assert failed["ready_at"] is None
    # "Try again" is another request: it supersedes the failed one.
    retried = bench.asked()
    assert bench.ended(failed["id"])[1] == "SUPERSEDED"
    # A model answer that is not usable.
    assert bench.run(retried["id"], _Provider([None])) == "FAILED"
    assert bench.mine()["failure"] == redraft.CALL_FAILED["MALFORMED"]
    # An answer without the section.
    other = bench.asked()
    assert bench.run(other["id"], _Provider([bench.answer("Elsewhere.", "no-such")])) == "FAILED"
    assert bench.mine()["failure"] == redraft.NOT_MATCHED
    assert bench.audited()[-1][1] == {
        "section": bench.key, "proposal_id": other["id"], "status": "FAILED",
    }  # fmt: skip
    # A run that gave up after its retries.
    gave_up = bench.asked()
    with connect(migrated.url) as connection:
        redraft.fail_redraft(connection, UUID(gave_up["id"]))
        assert redraft.open_redrafts(connection) == []
    assert bench.mine()["failure"] == redraft.RUN_FAILED

    # No engine to run it, or one that cannot be reached: failed at once, in the answer.
    for scheduler, sentence in ((_Scheduler(), redraft.NO_ENGINE),
                                (_Redrafts(fails=True), redraft.NOT_STARTED)):  # fmt: skip
        client = _client(migrated, bench.team["owner_id"], scheduler)
        answer = bench.ask(client=client)
        assert answer.status_code == 202, answer.text
        assert (answer.json()["proposal"]["status"], answer.json()["proposal"]["failure"]) == (
            "FAILED", sentence,
        )  # fmt: skip
    assert bench.workpaper() == before


def test_who_may_redraft_and_where(migrated: Database, monkeypatch: pytest.MonkeyPatch) -> None:
    _firm, _project, outsider = _ready(migrated, "rd-other-firm")
    # No evidence: nothing here asks the agent to draft, and the workpaper can be prepared.
    bench = _Bench(migrated, "rd-roles", evidence=False)
    mine = bench.asked()
    before = bench.rows("SELECT count(*) FROM workpaper_section_proposals")

    def asks(client: TestClient | None) -> list[int]:
        return [
            bench.ask(client=client).status_code,
            bench.read(client=client).status_code,
            bench.keep_mine(mine["id"], client=client).status_code,
        ]

    # A Reviewer reads the workpaper and may not edit it: no redraft; their own proposal
    # is none; another's is not theirs to see or end.
    _reviewer_id, reviewer = bench.member("REVIEWER")
    assert asks(reviewer) == [403, 200, 404]
    assert bench.mine(client=reviewer) is None
    # A person of the firm who is not on the engagement, and another firm's person: not
    # found. No session: not signed in.
    _stranger_id, stranger = bench.member("CONTRIBUTOR", on_project=False)
    assert asks(stranger) == [404, 404, 404]
    assert asks(outsider) == [404, 404, 404]
    assert asks(TestClient(bench.owner.app)) == [401, 401, 401]
    # An agent principal is refused before anything is written.
    agent = Principal(kind=PrincipalKind.AGENT, id=bench.team["owner_id"])
    with monkeypatch.context() as patched:
        patched.setattr(workpaper_service, "_session_principal", lambda _request: agent)
        refused = asks(None)
    assert len(set(refused)) == 1 and refused[0] in (403, 404)
    where = (bench.team["org"], bench.team["project"], UUID(bench.paper_id), bench.key)
    calls: tuple[Callable[[psycopg.Connection[Any]], object], ...] = (
        lambda c: redraft.request_redraft(
            c, agent, *where, redraft.RedraftBody(workpaper_version=1)
        ),
        lambda c: redraft.read_mine(c, agent, *where),
        lambda c: redraft.keep_mine(c, agent, *where, UUID(mine["id"])),
    )
    for call in calls:
        with connect(migrated.url) as connection, pytest.raises((NotVisible, AccessDenied)):
            call(connection)
    assert bench.rows("SELECT count(*) FROM workpaper_section_proposals") == before
    assert bench.mine()["id"] == mine["id"]

    # Only a section the agent drafts; a section the workpaper does not have is not found.
    for key in [bench.table, bench.fields] + ([bench.plain] if bench.plain else []):
        refused_key = bench.ask(key)
        assert (refused_key.status_code, refused_key.json()["detail"]) == (
            409, redraft.NOT_DRAFTED,
        )  # fmt: skip
    assert bench.ask("no-such-section").status_code == 404
    assert bench.ask(workpaper_version=0).status_code == 422
    assert bench.owner.post(f"{bench.url(bench.key)}/redraft", json={}).status_code == 422

    # Not while the agent drafts the workpaper (queued or running).
    for status in ("PENDING", "WORKING"):
        with connect(migrated.url) as connection:
            connection.execute(
                "UPDATE workpapers SET draft_status = %s WHERE id = %s", (status, bench.paper_id)
            )
        busy = bench.ask()
        assert (busy.status_code, busy.json()["detail"]) == (409, redraft.DRAFTING)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET draft_status = 'IDLE' WHERE id = %s", (bench.paper_id,)
        )

    # Prepared: every proposal that stands is superseded, and none is asked for.
    record_design_choice(bench.owner, bench.root, bench.control_id)
    prepared = bench.owner.post(
        f"{bench.base}/{bench.paper_id}/prepare", json={"version": bench.paper()["version"]}
    )
    assert prepared.status_code == 200, prepared.text
    assert bench.ended(mine["id"])[1] == "SUPERSEDED" and bench.mine() is None
    frozen = bench.ask()
    assert (frozen.status_code, frozen.json()["detail"]) == (409, redraft.PREPARED)
    reopened = bench.owner.post(
        f"{bench.base}/{bench.paper_id}/reopen",
        json={"version": prepared.json()["version"], "reason": "One more sentence to add."},
    )
    assert reopened.status_code == 200, reopened.text
    standing = bench.asked()

    # An archived engagement is read-only: the middleware refuses the request and the
    # dismissal, and the table refuses a write that reaches it. What stands is still read.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (bench.team["project"],)
        )
    for answer in (bench.ask(), bench.keep_mine(standing["id"])):
        assert answer.status_code == 409, answer.text
        assert answer.json()["detail"] == closed_detail("ARCHIVED")
    for statement in (
        "DELETE FROM workpaper_section_proposals",
        "UPDATE workpaper_section_proposals SET ended_at = clock_timestamp(), "
        "ended_by = requested_by, ended_as = 'KEPT_MINE' WHERE ended_at IS NULL",
    ):
        with (
            connect(migrated.url) as connection,
            pytest.raises(psycopg.errors.CheckViolation, match="archived"),
        ):
            connection.execute(statement)
    assert bench.mine()["id"] == standing["id"]
    # A run there writes nothing either: the table refuses it (the engine retries, then
    # gives up), and the proposal stays as it stood.
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.CheckViolation, match="archived"),
    ):
        redraft.run_redraft(connection, None, UUID(standing["id"]))
    assert bench.mine() == standing


def test_the_table_writes_a_proposal_once_and_ends_it_once(migrated: Database) -> None:
    """The table's own rules, for a write that does not come through the routes."""
    bench = _Bench(migrated, "rd-table")
    proposal = bench.asked()
    assert bench.run(proposal["id"], _Provider([bench.answer("The agent's text.")])) == "READY"
    pending = bench.asked(bench.other)
    owner = bench.team["owner_id"]

    def refused(statement: str, *values: Any, match: str) -> None:
        with connect(migrated.url) as connection, pytest.raises(psycopg.Error, match=match):
            connection.execute(statement, values)

    update = "UPDATE workpaper_section_proposals SET "
    # Never deleted.
    refused("DELETE FROM workpaper_section_proposals", match="never deleted")
    # What was asked never changes; the agent's result is set once.
    refused(update + "based_on = based_on + 1 WHERE id = %s", proposal["id"], match="never changes")
    refused(update + "text = 'Rewritten.' WHERE id = %s", proposal["id"], match="set once")
    refused(update + "status = 'FAILED', text = '', citations = '[]', words = 0, "
            "removed_note = '', failure = 'x', ready_at = NULL, failed_at = clock_timestamp() "
            "WHERE id = %s", proposal["id"], match="set once")  # fmt: skip
    # Finished and ended in separate steps; a status to match its content.
    refused(update + "status = 'READY', text = 'x', ready_at = clock_timestamp(), "
            "ended_at = clock_timestamp(), ended_by = requested_by, ended_as = 'USED' "
            "WHERE id = %s", pending["id"], match="separate steps")  # fmt: skip
    refused(update + "status = 'READY' WHERE id = %s", pending["id"], match="shape")
    refused(update + "ended_at = clock_timestamp(), ended_by = requested_by, ended_as = 'USED' "
            "WHERE id = %s", pending["id"], match="ended")  # fmt: skip
    refused(update + "ended_at = clock_timestamp() WHERE id = %s", pending["id"], match="ended")
    refused(update + "ended_at = clock_timestamp(), ended_by = requested_by, ended_as = 'GONE' "
            "WHERE id = %s", pending["id"], match="ended_as")  # fmt: skip
    # Ended once.
    assert bench.keep_mine(proposal["id"]).status_code == 200
    refused(update + "ended_as = 'USED' WHERE id = %s", proposal["id"], match="never changed")
    # Recorded standing and PENDING, in its workpaper's engagement; one standing per
    # workpaper, section and person.
    insert = (
        "INSERT INTO workpaper_section_proposals (organization_id, project_id, workpaper_id, "
        "section_key, based_on, requested_by, status) VALUES (%s, %s, %s, %s, 1, %s, %s)"
    )
    org, project = bench.team["org"], bench.team["project"]
    refused(insert, org, project, bench.paper_id, bench.key, owner, "READY", match="standing")
    refused(insert, org, project, bench.paper_id, bench.other, owner, "PENDING",
            match="workpaper_section_proposals_standing")  # fmt: skip
    (other_project,) = bench.rows(
        "SELECT id FROM projects WHERE organization_id = %s AND id <> %s LIMIT 1", org, project
    )[0]
    refused(insert, org, other_project, bench.paper_id, bench.key, owner, "PENDING",
            match="engagement")  # fmt: skip
    for key in ("", "k" * 61):
        refused(insert, org, project, bench.paper_id, key, owner, "PENDING", match="section")
