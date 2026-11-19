"""The D&I requests after the release (B1g; decided by the product owner on 12 November
2026, docs/control-workflow-plan.md): one list of requests, "Approve and send" for a whole
request, "Upload" on each row, and a delivery line that says only what happened.

Approval boundary and evidence traceability (critical tier):

- evidence already in hand is per item: a file for one item of an unsent D&I request
  leaves the other items to be asked for, in a wording without the item in hand; when
  every item is in hand nothing is sent;
- a person approves the wording that goes out: an approval of an earlier wording is
  withdrawn, never carried over, and nothing is sent without an approval;
- with email off an approval records a hand-over, by whom and when, with the person as
  the actor, the API says HANDED_OVER and live_email false, and nothing reads as sent;
  with a mailbox on, the delivery is EMAIL;
- a request a person adds after the release is drafted into an outgoing request that
  needs approval; a request is not reworded once it went for approval or was sent;
- an item that waits for an earlier one is read and judged as a planned item once a file
  of its own is linked to it (docs/evidence-assurance.md, section 10.15, item 3): a person
  accepts it or finds it short, and while it is in hand and not accepted the design
  workpaper is not drafted again, as for a requested item. Without a file it still waits
  and nothing of it is judged. Only in the D&I phase: an interim or roll-forward item that
  waits for its sample is never judged on a linked file (independent review of 10.15);
- the file an item in hand was accepted with is not withdrawn or replaced, as for a
  requested item, and an item that loses its last own file loses its judgment on record,
  so it never reads accepted again on a different file.

Split on 19 November 2026 so that no one file sets the slowest CI part (this file took
about 700 s on one CI worker): the tests from the reviewer's refusal on, with the
independent review's findings, are in test_design_evidence_handover.py, unchanged.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_evidence_analysis import _no_ocr, _settings
from test_evidence_intake import _engagement
from test_evidence_plans import _control, _phase, _plan
from test_execution import _add_project_member, _add_user
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.evidence_plans import JUDGEABLE_SQL, requirement_state
from ai_workforce_api.outbound import IN_HAND_ALL, IN_HAND_CHANGED

__all__ = ["migrated"]

AC01 = "ITGC-AC-01"


class _Case:
    """A launched engagement whose ITGC-AC-01 D&I evidence is released: its D&I items are
    requested in one draft the evidence coordinator prepared, not yet approved."""

    def __init__(self, migrated: Database, slug: str) -> None:
        self.database = migrated
        self.team, self.client, _scheduler = _engagement(
            migrated, f"de-{slug}-{uuid4().hex[:4]}", design=False
        )
        self.base = f"/organizations/{self.team['org']}/projects/{self.team['project']}"
        self.control = _control(migrated, self.team, AC01)
        design = self.design()
        drafts = [r for r in design["requests"] if r["status"] == "DRAFT"]
        assert len(drafts) == 1, design["requests"]
        self.request = str(drafts[0]["id"])
        self.items = self.carried(self.request)
        assert len(self.items) >= 2, "the D&I request carries several items"

    def design(self, client: TestClient | None = None) -> dict[str, Any]:
        return _phase(_plan(client or self.client, self.team, self.control), "DESIGN")

    def carried(self, request_id: str) -> list[dict[str, Any]]:
        return [
            r
            for r in self.design()["requirements"]
            if r["request_id"] == request_id and r["status"] == "REQUESTED"
        ]

    def item(self, requirement_id: str) -> dict[str, Any]:
        return next(r for r in self.design()["requirements"] if r["id"] == requirement_id)

    def listed(self, request_id: str, client: TestClient | None = None) -> dict[str, Any]:
        """The request as the plan's D&I phase lists it."""
        return next(r for r in self.design(client)["requests"] if r["id"] == request_id)

    def read(self, request_id: str, client: TestClient | None = None) -> dict[str, Any]:
        found = (client or self.client).get(f"{self.base}/pbc-requests/{request_id}")
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    def upload(
        self, item: dict[str, Any], name: str, client: TestClient | None = None, more: str = ""
    ) -> Any:
        return (client or self.client).post(
            f"{self.base}/evidence-uploads",
            params={
                "batch_id": str(uuid4()),
                "name": name,
                "request_id": item["request_id"],
                "requirement_id": item["id"],
            },
            content=f"Evidence for {item['title']}: managers approve access.{more}".encode(),
            headers={"content-type": "text/plain"},
        )

    def add_for(self, item: dict[str, Any], name: str, read: bool = True, more: str = "") -> str:
        added = self.upload(item, name, more=more)
        assert added.status_code == 200, added.text
        if read:
            self.read_files()
        return str(added.json()["file_id"])

    def read_files(self) -> None:
        """The evidence reader finishes every file it was given (the rules, no model)."""
        with connect(self.database.url) as connection:
            for (analysis_id,) in connection.execute(
                "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
            ).fetchall():
                run_analysis(connection, _settings(self.database), None, analysis_id, _no_ocr)

    def approve(self, request_id: str, client: TestClient | None = None) -> Any:
        current = self.read(request_id)
        return (client or self.client).post(
            f"{self.base}/pbc-requests/{request_id}/approve",
            json={"version": current["version"], "reason": "Read it; asks for the right items."},
        )

    def send(self, request_id: str, approval_id: str, client: TestClient | None = None) -> Any:
        return (client or self.client).post(
            f"{self.base}/pbc-requests/{request_id}/send", json={"approval_id": approval_id}
        )

    def move(self, request_id: str, status: str, **changes: Any) -> Any:
        """The request's own update route: its status, and what a person may change."""
        current = self.read(request_id)
        fields = {
            key: current[key]
            for key in ("version", "recipient", "due_at", "evidence_description", "control_ref")
        }
        return self.client.post(
            f"{self.base}/pbc-requests/{request_id}", json={**fields, "status": status, **changes}
        )

    def email_off(self, user_id: Any = None) -> TestClient:
        """The same person where live email is off: no mailbox can send."""
        return _session(self.database, user_id or self.team["owner_id"], email_provider="graph")

    def rows(self, query: str, *params: Any) -> list[tuple[Any, ...]]:
        with connect(self.database.url) as connection:
            return list(connection.execute(query, params).fetchall())

    def count(self, table: str) -> int:
        query = {
            "outbound_messages": "SELECT count(*) FROM outbound_messages WHERE project_id = %s",
            "mailbox_messages": "SELECT count(*) FROM mailbox_messages WHERE project_id = %s",
        }[table]
        return int(self.rows(query, self.team["project"])[0][0])

    def audit(self, action: str, target: str) -> list[tuple[Any, ...]]:
        return self.rows(
            "SELECT actor_user_id, actor_agent_instance_id, payload FROM audit_events "
            "WHERE action = %s AND target_id = %s ORDER BY occurred_at, id",
            action,
            UUID(target),
        )

    def name(self, user_id: Any) -> str:
        return str(self.rows("SELECT display_name FROM users WHERE id = %s", user_id)[0][0])

    def member(self, role: str) -> tuple[UUID, TestClient]:
        with connect(self.database.url) as connection:
            user = _add_user(
                connection, self.team["org"], f"{role.lower()}-{uuid4().hex[:6]}@example.com", role
            )
            _add_project_member(connection, self.team["org"], self.team["project"], user)
        return user, _session(self.database, user)


def test_evidence_for_one_item_leaves_the_others_to_be_asked_without_it(
    migrated: Database,
) -> None:
    """Before (the product owner's finding): a file for one item of an unsent request
    marked the whole request received and withdrew its send, so the other items were never
    asked for. Now only that item is in hand; the others are asked for in a draft worded
    without it, which is sent only on a person's approval."""
    case = _Case(migrated, "one")
    first, rest = case.items[0], case.items[1:]
    file_id = case.add_for(first, "access policy.txt")

    # The item in hand: its file is its evidence, on the request that carried it, which is
    # received as provided directly. Nothing is sent for it.
    held = case.item(first["id"])
    assert held["in_hand"] is True
    assert held["request_id"] == case.request
    assert [f["name"] for f in held["files"]] == ["access policy.txt"]
    kept = case.read(case.request)
    assert (kept["status"], kept["provided_directly"], kept["delivery"]) == ("RECEIVED", True, None)
    assert case.rows(
        "SELECT requirement_id, pbc_request_id FROM evidence_matches WHERE evidence_file_id = %s",
        UUID(file_id),
    ) == [(UUID(first["id"]), UUID(case.request))]

    # The others are not in hand and are asked for in one draft of their own.
    others = [case.item(item["id"]) for item in rest]
    assert all(item["in_hand"] is False and item["status"] == "REQUESTED" for item in others)
    carrying = {item["request_id"] for item in others}
    assert len(carrying) == 1 and case.request not in carrying
    outgoing = str(carrying.pop())
    draft = case.read(outgoing)
    assert draft["status"] == "DRAFT" and draft["drafted_by"] == "AGENT"
    assert draft["delivery"] is None
    # Addressed as the request they left was.
    assert (draft["recipient"], draft["due_at"]) == (kept["recipient"], kept["due_at"])
    # The wording leaves the item in hand out, and asks for each of the others.
    assert first["title"] not in draft["evidence_description"]
    assert all(item["title"] in draft["evidence_description"] for item in rest)
    # It reads as ready for a person, not as waiting for the coordinator's draft.
    assert all(item["state"] == "READY_FOR_REVIEW" for item in others)
    preview = case.client.get(f"{case.base}/pbc-requests/{outgoing}/outbound-preview").json()
    assert first["title"] not in preview["body"]

    # On the record, with the person who added the file as the actor; no agent decided.
    moved = case.audit("pbc.items_requested_separately", case.request)
    assert [(row[0], row[1]) for row in moved] == [(case.team["owner_id"], None)]
    assert moved[0][2]["requests"] == [outgoing]
    assert sorted(moved[0][2]["requirements"]) == sorted(item["id"] for item in rest)
    assert len(case.audit("pbc.received_from_evidence", case.request)) == 1

    # Nothing was sent, and nothing is without a person's approval of this wording.
    assert case.count("outbound_messages") == 0
    assert case.rows(
        "SELECT count(*) FROM approvals WHERE parameters ->> 'request_ref' LIKE %s",
        f"pbc/{outgoing}/%",
    ) == [(0,)]
    approved = case.approve(outgoing)
    assert approved.status_code == 200, approved.text
    sent = case.send(outgoing, approved.json()["approval"]["id"])
    assert sent.status_code == 200, sent.text
    mailed = case.rows(
        "SELECT body FROM mailbox_messages WHERE project_id = %s", case.team["project"]
    )
    assert len(mailed) == 1
    assert first["title"] not in mailed[0][0]
    assert all(item["title"] in mailed[0][0] for item in rest)
    assert case.read(outgoing)["status"] == "SENT"
    # The request with the item in hand never went out.
    assert case.read(case.request)["status"] == "RECEIVED"


def test_when_every_item_is_in_hand_nothing_is_sent(migrated: Database) -> None:
    """Every item's evidence added before the request went out: nothing is left to ask
    for, so no draft waits for approval and nothing is sent (as before)."""
    case = _Case(migrated, "all")
    # Added together: the one request is received as provided directly, whole.
    for number, item in enumerate(case.items):
        case.add_for(item, f"evidence {number}.txt", read=False)
    case.read_files()
    design = case.design()
    assert [(r["id"], r["status"]) for r in design["requests"]] == [(case.request, "RECEIVED")]
    assert case.read(case.request)["provided_directly"] is True
    mine = [r for r in design["requirements"] if r["request_id"] == case.request]
    assert len(mine) == len(case.items) and all(item["in_hand"] for item in mine)
    refused = case.approve(case.request)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "request is not a draft"
    assert case.count("outbound_messages") == 0 and case.count("mailbox_messages") == 0

    # Added one after another, each on its row as the list then shows it: the last file
    # leaves no draft behind, and each file stays the evidence of its own item.
    other = _Case(migrated, "each")
    for number, item in enumerate(other.items):
        other.add_for(other.item(item["id"]), f"evidence {number}.txt")
    design = other.design()
    assert design["requests"] and all(r["status"] == "RECEIVED" for r in design["requests"])
    for number, item in enumerate(other.items):
        held = other.item(item["id"])
        assert held["in_hand"] is True and held["status"] == "REQUESTED"
        assert [f["name"] for f in held["files"]] == [f"evidence {number}.txt"]
    assert other.count("outbound_messages") == 0 and other.count("mailbox_messages") == 0


def test_an_item_waiting_for_an_earlier_one_is_in_hand_once_its_evidence_is(
    migrated: Database,
) -> None:
    """Before (the product owner's finding, 14 November 2026): an item that waits for an
    earlier one, with no request yet, had its own evidence linked by a person and still
    read "To send", because only planned and requested items counted as in hand. Now its
    evidence is in hand and nothing needs sending for it; the item itself is unchanged."""
    case = _Case(migrated, "waits")
    earlier, waiting = case.items[0], case.items[1]
    file_id = case.add_for(earlier, "access policy.txt")
    with connect(migrated.url) as connection:
        # As the planner leaves an item that waits for an earlier step: no request yet.
        connection.execute(
            "UPDATE evidence_requirements SET status = 'AWAITING_DEPENDENCY', "
            "depends_on = %s, pbc_request_id = NULL WHERE id = %s",
            (UUID(earlier["id"]), UUID(waiting["id"])),
        )
    before = case.item(waiting["id"])
    assert (before["status"], before["in_hand"]) == ("AWAITING_DEPENDENCY", False)
    linked = case.client.post(
        f"{case.base}/controls/{case.control}/evidence-requirements/{waiting['id']}/files",
        json={"file_id": file_id, "reason": "The policy also shows this item.",
              "version": before["version"]},
    )  # fmt: skip
    assert linked.status_code == 200, linked.text
    after = case.item(waiting["id"])
    assert after["in_hand"] is True
    assert after["status"] == "AWAITING_DEPENDENCY" and after["request_id"] is None
    assert [f["name"] for f in after["files"]] == ["access policy.txt"]


def test_a_waiting_item_with_a_linked_file_reads_as_a_planned_item_with_one() -> None:
    """Section 10.15, item 3 (pure). Before: an item that waits for an earlier one read
    "Waits for an earlier item" whatever was linked to it. Now, with a file of its own
    linked, a D&I item has the state a planned item with one has, for every judgment a
    person made; without one it still waits.

    Rewritten after the independent review of 10.15 (15 November 2026). The old calls gave
    no phase and expected the planned item's state: that encoded the defect, the rule
    applying to every phase, so an interim or roll-forward sample item that waits for its
    sample read "Received" and could be accepted on any linked file before a sample
    existed. The new expectation: the state of a planned item only where the phase is
    DESIGN; in any other phase, and where no phase is given, it waits (AS 2315: a sample
    item is evidenced by the item selected, which does not exist before the selection)."""
    judgments = ("NOT_REVIEWED", "UNDER_REVIEW", "ACCEPTED", "INSUFFICIENT", "FOLLOW_UP_REQUIRED")

    def waiting(judged: str, has: bool, linked: bool, phase: str | None) -> str:
        return requirement_state("AWAITING_DEPENDENCY", None, None, judged, has, linked, phase)

    for judged in judgments:
        planned = requirement_state("PLANNED", None, None, judged, True, True, "DESIGN")
        assert waiting(judged, True, True, "DESIGN") == planned
    assert waiting("NOT_REVIEWED", True, True, "DESIGN") == "RECEIVED"
    assert waiting("ACCEPTED", False, True, "DESIGN") == "ACCEPTED"
    # Only in the D&I phase: an interim or roll-forward item that waits, and one whose
    # phase is not said, waits whatever is linked to it and whatever is on record.
    for phase in ("INTERIM", "ROLLFORWARD", None):
        for judged in judgments:
            assert waiting(judged, True, True, phase) == "AWAITING_DEPENDENCY", (phase, judged)
    # A planned item with a linked file is judged in every phase, as before.
    for phase in ("DESIGN", "INTERIM", "ROLLFORWARD", None):
        assert requirement_state("PLANNED", None, None, "NOT_REVIEWED", True, True, phase) == (
            "RECEIVED"
        )
    # Without a linked file nothing changed: it waits, whatever else is on record.
    for judged in ("NOT_REVIEWED", "ACCEPTED", "INSUFFICIENT"):
        assert requirement_state("AWAITING_DEPENDENCY", None, None, judged) == (
            "AWAITING_DEPENDENCY"
        )
        assert waiting(judged, True, False, "DESIGN") == "AWAITING_DEPENDENCY"


def _design_draft(case: _Case) -> str | None:
    """Whether the agent was asked to draft the control's design workpaper: its draft
    status, or None where no design workpaper is open."""
    rows = case.rows(
        "SELECT draft_status FROM workpapers WHERE engagement_control_id = %s AND stage = 'DESIGN'",
        UUID(case.control),
    )
    return None if not rows else str(rows[0][0])


def test_a_waiting_item_with_its_own_evidence_is_judged_and_counted_as_a_requested_one(
    migrated: Database,
) -> None:
    """Section 10.15, item 3. Before (the end-to-end trace of 15 November 2026): an item
    that waits for an earlier one could never be accepted ("nothing has been received for
    this requirement yet", though its file was linked and it read "in hand"), nothing ever
    released it, and the design workpaper was drafted again without it. Now, with a file
    of its own, a person judges it as a planned item with one, and while it is in hand
    and not accepted it holds the draft back exactly as a requested item does."""
    case = _Case(migrated, "judged")
    earlier, waiting = case.items[0], case.items[1]
    requested = [item for item in case.items if item["id"] != waiting["id"]]
    with connect(migrated.url) as connection:
        # As the planner leaves an item that waits for an earlier step: no request yet.
        connection.execute(
            "UPDATE evidence_requirements SET status = 'AWAITING_DEPENDENCY', "
            "depends_on = %s, pbc_request_id = NULL WHERE id = %s",
            (earlier["key"], UUID(waiting["id"])),
        )
    judge = f"{case.base}/controls/{case.control}/evidence-requirements"

    def decide(item_id: str, sufficiency: str, note: str = "") -> Any:
        return case.client.post(
            f"{judge}/{item_id}/sufficiency",
            json={"sufficiency": sufficiency, "note": note,
                  "version": case.item(item_id)["version"]},
        )  # fmt: skip

    # Without a file of its own nothing changed: it waits, and nothing of it is judged.
    before = case.item(waiting["id"])
    assert (before["status"], before["state"], before["in_hand"]) == (
        "AWAITING_DEPENDENCY", "AWAITING_DEPENDENCY", False,
    )  # fmt: skip
    for sufficiency in ("ACCEPTED", "INSUFFICIENT", "FOLLOW_UP_REQUIRED"):
        refused = decide(waiting["id"], sufficiency, "The approval is missing.")
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"] == "nothing has been received for this requirement yet"
    assert case.item(waiting["id"])["sufficiency"] == "NOT_REVIEWED"

    # Each requested item's own evidence comes in, and the policy is linked to the item
    # that waits.
    files = {
        item["id"]: case.add_for(case.item(item["id"]), f"evidence {number}.txt")
        for number, item in enumerate(requested)
    }
    linked = case.client.post(
        f"{judge}/{waiting['id']}/files",
        json={"file_id": files[earlier["id"]], "reason": "The policy also shows this item.",
              "version": case.item(waiting["id"])["version"]},
    )  # fmt: skip
    assert linked.status_code == 200, linked.text
    held = case.item(waiting["id"])
    # Read as a planned item with a file: received, to be judged. The item is unchanged.
    assert (held["status"], held["request_id"], held["in_hand"]) == (
        "AWAITING_DEPENDENCY", None, True,
    )  # fmt: skip
    assert (held["state"], held["state_label"]) == ("RECEIVED", "Received, not yet reviewed")
    assert (held["depends_on"], held["sufficiency"]) == (earlier["key"], "NOT_REVIEWED")

    # A person finds it short, with what is missing, as for any item in hand.
    unsaid = decide(waiting["id"], "INSUFFICIENT")
    assert unsaid.status_code != 200, unsaid.text
    for sufficiency in ("INSUFFICIENT", "FOLLOW_UP_REQUIRED"):
        short = decide(waiting["id"], sufficiency, "The approval date is missing.")
        assert short.status_code == 200, short.text
        found = case.item(waiting["id"])
        assert (found["state"], found["sufficiency"]) == (sufficiency, sufficiency)
        assert found["sufficiency_note"] == "The approval date is missing."
    back = decide(waiting["id"], "NOT_REVIEWED")
    assert back.status_code == 200, back.text
    assert case.item(waiting["id"])["state"] == "RECEIVED"

    # Every requested item accepted while the item in hand is not: the design workpaper
    # is not drafted again (before, it was: only requested items were counted).
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET draft_status = 'IDLE' WHERE engagement_control_id = %s "
            "AND stage = 'DESIGN'",
            (UUID(case.control),),
        )
    for item in requested:
        accepted = decide(item["id"], "ACCEPTED")
        assert accepted.status_code == 200, accepted.text
    assert all(case.item(item["id"])["state"] == "ACCEPTED" for item in requested)
    assert _design_draft(case) in (None, "IDLE")

    # The item in hand accepted: on the record with the person, and the agent is asked
    # for the design workpaper from the accepted evidence.
    accepted = decide(waiting["id"], "ACCEPTED")
    assert accepted.status_code == 200, accepted.text
    done = case.item(waiting["id"])
    assert (done["state"], done["sufficiency"], done["status"], done["request_id"]) == (
        "ACCEPTED", "ACCEPTED", "AWAITING_DEPENDENCY", None,
    )  # fmt: skip
    assert done["sufficiency_by"] == case.name(case.team["owner_id"])
    judged = case.audit("evidence_requirement.sufficiency", waiting["id"])
    assert [(row[0], row[1], row[2]["sufficiency"]) for row in judged] == [
        (case.team["owner_id"], None, "INSUFFICIENT"),
        (case.team["owner_id"], None, "FOLLOW_UP_REQUIRED"),
        (case.team["owner_id"], None, "NOT_REVIEWED"),
        (case.team["owner_id"], None, "ACCEPTED"),
    ]
    assert _design_draft(case) == "PENDING"

    # 18 November 2026 (E1, evidence reliance; product owner): the file an item was
    # accepted with stays on it until that decision is changed. Old: the unlink went
    # through and took the acceptance with it; new: the unlink is refused naming the
    # acceptance, the person reopens the decision, and then unlinks.
    link = next(f for f in done["files"] if f["link_id"] is not None)
    kept = case.client.post(
        f"{judge}/{waiting['id']}/files/{link['link_id']}/remove",
        json={"reason": "Linked to the wrong item.", "version": link["link_version"]},
    )
    assert kept.status_code == 409
    assert "was accepted with it; change that decision first" in kept.json()["detail"]
    assert decide(waiting["id"], "NOT_REVIEWED").status_code == 200
    # Its file unlinked: no judgment is left on it, and it waits again.
    removed = case.client.post(
        f"{judge}/{waiting['id']}/files/{link['link_id']}/remove",
        json={"reason": "Linked to the wrong item.", "version": link["link_version"]},
    )
    assert removed.status_code == 200, removed.text
    again = case.item(waiting["id"])
    assert (again["state"], again["sufficiency"], again["in_hand"]) == (
        "AWAITING_DEPENDENCY", "NOT_REVIEWED", False,
    )  # fmt: skip
    assert decide(waiting["id"], "ACCEPTED").status_code == 409


def test_an_interim_item_that_waits_for_its_sample_is_never_judged_on_a_linked_file(
    migrated: Database,
) -> None:
    """Independent review of 10.15, item 3. The rule that an item waiting for an earlier
    one is judged once a file of its own is linked is the D&I phase's. Before: the phase
    was not read, so an interim sample item that waits for its sample read "Received" as
    soon as any file the control holds was linked to it, and a person could accept it
    before a sample existed. Now it waits, and nothing of it is judged, as before 10.15."""
    team, client, _scheduler = _engagement(migrated, f"de-wait-{uuid4().hex[:4]}")
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    control = _control(migrated, team, AC01)
    judge = f"{base}/controls/{control}/evidence-requirements"

    def interim() -> dict[str, Any]:
        return _phase(_plan(client, team, control), "INTERIM")

    def item(requirement_id: str) -> dict[str, Any]:
        return next(r for r in interim()["requirements"] if r["id"] == requirement_id)

    requested = [r for r in interim()["requirements"] if r["status"] == "REQUESTED"]
    waits = [r for r in interim()["requirements"] if r["status"] == "AWAITING_DEPENDENCY"]
    # As the planner leaves a sample item: it waits for the population, with no request.
    assert requested and waits, [(r["key"], r["status"]) for r in interim()["requirements"]]
    waiting = waits[0]
    assert waiting["depends_on"] is not None and waiting["request_id"] is None

    # A file the control holds, linked to the item that waits.
    added = client.post(
        f"{base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "population.txt",
                "request_id": requested[0]["request_id"], "requirement_id": requested[0]["id"]},
        content=b"User ID, name, date granted.",
        headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    with connect(migrated.url) as connection:
        for (analysis_id,) in connection.execute(
            "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
        ).fetchall():
            run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
    linked = client.post(
        f"{judge}/{waiting['id']}/files",
        json={"file_id": added.json()["file_id"], "reason": "The listing names the items.",
              "version": item(waiting["id"])["version"]},
    )  # fmt: skip
    assert linked.status_code == 200, linked.text
    held = item(waiting["id"])
    assert [f["name"] for f in held["files"]] == ["population.txt"]

    # It still waits for its sample: not received, and nothing of it is judged.
    assert (held["status"], held["state"], held["sufficiency"]) == (
        "AWAITING_DEPENDENCY", "AWAITING_DEPENDENCY", "NOT_REVIEWED",
    )  # fmt: skip
    for sufficiency in ("ACCEPTED", "INSUFFICIENT", "FOLLOW_UP_REQUIRED"):
        refused = client.post(
            f"{judge}/{waiting['id']}/sufficiency",
            json={"sufficiency": sufficiency, "note": "The approval is missing.",
                  "version": item(waiting["id"])["version"]},
        )  # fmt: skip
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"] == "nothing has been received for this requirement yet"
    after = item(waiting["id"])
    assert (after["state"], after["sufficiency"]) == ("AWAITING_DEPENDENCY", "NOT_REVIEWED")
    # The one rule says the same: it is not an item a person can judge, in either phase
    # but the D&I one (the same item read as a D&I item would be).
    with connect(migrated.url) as connection:
        [(judgeable, as_design)] = connection.execute(
            f"SELECT {JUDGEABLE_SQL}, "  # noqa: S608
            f"{JUDGEABLE_SQL.replace('q.phase', chr(39) + 'DESIGN' + chr(39))} "
            "FROM evidence_requirements q WHERE q.id = %s",
            (UUID(waiting["id"]),),
        ).fetchall()
    assert (judgeable, as_design) == (False, True)


class _InHand:
    """A D&I item in hand without a request (planned, or waiting for an earlier item),
    and the files the control holds for another item, each with its own content."""

    def __init__(self, migrated: Database, slug: str, status: str) -> None:
        self.case = case = _Case(migrated, slug)
        self.other, self.item_id = case.items[0], str(case.items[1]["id"])
        self.title = str(case.items[1]["title"])
        with connect(migrated.url) as connection:
            connection.execute(
                "UPDATE evidence_requirements SET status = %s, depends_on = %s, "
                "pbc_request_id = NULL WHERE id = %s",
                (status, self.other["key"] if status == "AWAITING_DEPENDENCY" else None,
                 UUID(self.item_id)),
            )  # fmt: skip
        self.judge = f"{case.base}/controls/{case.control}/evidence-requirements"
        self.files = f"{case.base}/evidence-files"
        self.added = 0

    def item(self) -> dict[str, Any]:
        return self.case.item(self.item_id)

    def file(self) -> str:
        """Another file the control holds, added for the other item."""
        self.added += 1
        return self.case.add_for(
            self.case.item(self.other["id"]), f"file {self.added}.txt", more=f" Copy {self.added}."
        )

    def link(self, file_id: str) -> None:
        linked = self.case.client.post(
            f"{self.judge}/{self.item_id}/files",
            json={"file_id": file_id, "reason": "It also shows this item.",
                  "version": self.item()["version"]},
        )  # fmt: skip
        assert linked.status_code == 200, linked.text

    def unlink(self, file_id: str) -> None:
        link = next(f for f in self.item()["files"] if f["file_id"] == file_id)
        removed = self.case.client.post(
            f"{self.judge}/{self.item_id}/files/{link['link_id']}/remove",
            json={"reason": "Linked to the wrong item.", "version": link["link_version"]},
        )
        assert removed.status_code == 200, removed.text

    def decide(self, sufficiency: str, note: str = "") -> Any:
        return self.case.client.post(
            f"{self.judge}/{self.item_id}/sufficiency",
            json={"sufficiency": sufficiency, "note": note, "version": self.item()["version"]},
        )

    def withdraw(self, file_id: str) -> Any:
        return self.case.client.post(
            f"{self.files}/{file_id}/withdraw", json={"reason": "Uploaded the wrong document."}
        )

    def replace(self, file_id: str) -> Any:
        return self.case.client.post(
            f"{self.files}/{file_id}/replace",
            params={"name": "corrected.txt", "reason": "Corrected export"},
            content=f"A corrected copy of {file_id}.".encode(),
            headers={"content-type": "text/plain"},
        )

    def on_record(self) -> tuple[str, Any]:
        """The item's judgment as stored, whatever its state reads."""
        [row] = self.case.rows(
            "SELECT sufficiency, sufficiency_by FROM evidence_requirements WHERE id = %s",
            UUID(self.item_id),
        )
        return str(row[0]), row[1]


@pytest.mark.parametrize("status", ["PLANNED", "AWAITING_DEPENDENCY"])
def test_the_file_an_item_in_hand_was_accepted_with_is_not_withdrawn_or_replaced(
    migrated: Database, status: str
) -> None:
    """Independent review of 10.15, item 4. A file an item was accepted with is relied on
    and cannot be withdrawn or replaced until that decision is changed (product owner, 31
    October 2026). Before: only requested items were read, so the file an item in hand
    without a request was accepted with (planned, or a D&I item that waits for an earlier
    one: 10.15, item 3) left with no refusal, and the acceptance stayed on record with
    nothing under it."""
    hand = _InHand(migrated, f"kept-{status[:4].lower()}", status)
    file_id = hand.file()
    hand.link(file_id)
    assert hand.decide("ACCEPTED").status_code == 200
    assert (hand.item()["status"], hand.item()["state"]) == (status, "ACCEPTED")

    for refused, verb in (
        (hand.withdraw(file_id), "withdrawn"),
        (hand.replace(file_id), "replaced"),
    ):
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"] == (
            f'the file cannot be {verb}: the evidence item "{hand.title}" was accepted with '
            "it; change that decision first"
        )
    # Nothing moved: the file is in force on the item and the acceptance stands.
    kept = hand.item()
    assert (kept["state"], [f["file_id"] for f in kept["files"]]) == ("ACCEPTED", [file_id])
    assert hand.case.rows(
        "SELECT count(*) FROM evidence_withdrawals WHERE evidence_file_id = %s", UUID(file_id)
    ) == [(0,)]

    # The decision changed first, as the refusal says: the file can then leave.
    assert hand.decide("NOT_REVIEWED").status_code == 200
    assert hand.withdraw(file_id).status_code == 200
    assert hand.item()["files"] == []


def test_an_item_that_loses_its_last_file_never_reads_accepted_on_a_different_one(
    migrated: Database,
) -> None:
    """Independent review of 10.15, item 4. Before: an item in hand whose only file went
    kept its acceptance on record, hidden (it read as waiting again), and read "Accepted"
    again as soon as a different file was linked: a file nobody had judged. Now the
    judgment goes when the last file of its own does, on record and with an audit event,
    and a judgment that rests on no file is never carried onto a file linked later."""
    hand = _InHand(migrated, "relink", "AWAITING_DEPENDENCY")
    case, owner = hand.case, hand.case.team["owner_id"]
    first, later = hand.file(), hand.file()

    def resets() -> list[tuple[Any, ...]]:
        return [
            (row[0], row[2])
            for row in case.audit("evidence_requirement.sufficiency_reset", hand.item_id)
        ]

    # Accepted with the first file; a second is linked afterwards, and the first unlinked
    # (the judgment stays while another file is on the item, the existing rule).
    hand.link(first)
    assert hand.decide("ACCEPTED").status_code == 200
    hand.link(later)
    # 18 November 2026 (E1, evidence reliance; product owner): the first file was accepted
    # with, so it stays on the item until that decision changes. Old: the unlink went
    # through, the acceptance standing on the later file; new: the unlink is refused. The
    # rest of this test starts from the record the earlier rule left, set directly: the
    # first file's link removed, the acceptance standing on the later file alone.
    link = next(f for f in hand.item()["files"] if f["file_id"] == first)
    refused = case.client.post(
        f"{hand.judge}/{hand.item_id}/files/{link['link_id']}/remove",
        json={"reason": "Linked to the wrong item.", "version": link["link_version"]},
    )
    assert refused.status_code == 409
    assert "was accepted with it; change that decision first" in refused.json()["detail"]
    with connect(case.database.url) as connection:
        connection.execute(
            "UPDATE evidence_requirement_files SET status = 'REMOVED', removed_by = %s, "
            "removed_at = clock_timestamp(), removed_reason = 'Linked to the wrong item.', "
            "version = version + 1 WHERE requirement_id = %s AND evidence_file_id = %s",
            (owner, UUID(hand.item_id), UUID(first)),
        )
    assert (hand.item()["state"], hand.on_record()) == ("ACCEPTED", ("ACCEPTED", owner))

    # The file left came after the acceptance, so it can be withdrawn. The item then has
    # no file of its own: the acceptance is gone from the record, and why is recorded.
    assert hand.withdraw(later).status_code == 200
    gone = hand.item()
    assert (gone["state"], gone["sufficiency"], gone["files"]) == (
        "AWAITING_DEPENDENCY", "NOT_REVIEWED", [],
    )  # fmt: skip
    assert hand.on_record() == ("NOT_REVIEWED", None)
    assert resets() == [
        (owner, {"sufficiency": "NOT_REVIEWED", "was": "ACCEPTED", "by": "FILE_WITHDRAWN",
                 "evidence_file_id": later}),
    ]  # fmt: skip
    [withdrawn] = case.audit("evidence.withdrawn", later)
    assert withdrawn[2]["judgments_reset"] == [hand.item_id]
    # A different file linked: received, for a person to judge. Never accepted.
    third = hand.file()
    hand.link(third)
    assert (hand.item()["state"], hand.on_record()) == ("RECEIVED", ("NOT_REVIEWED", None))

    # The same when the last file is replaced: the judgment on the old file is not carried.
    # 18 November 2026 (E1, evidence reliance; product owner): a person's link carries to
    # the replacement. Old: the item was left with no file (the link was the old file's
    # own); new: the replacement is linked to the item, never judged. The judgment reset
    # and its audit event are unchanged.
    assert hand.decide("INSUFFICIENT", "The approval date is missing.").status_code == 200
    fourth = hand.file()
    hand.link(fourth)
    hand.unlink(third)
    replaced = hand.replace(fourth)
    assert replaced.status_code == 200
    assert (
        [(f["file_id"], f["via"]) for f in hand.item()["files"]],
        hand.on_record(),
    ) == ([(replaced.json()["file_id"], "LINK")], ("NOT_REVIEWED", None))
    assert resets()[1:] == [
        (owner, {"sufficiency": "NOT_REVIEWED", "was": "INSUFFICIENT", "by": "FILE_REPLACED",
                 "evidence_file_id": fourth}),
    ]  # fmt: skip

    # A record left by the earlier behaviour: an acceptance with no file under it. It is
    # hidden while the item has none, and it is taken off as a file is linked. (18
    # November 2026: the carried link is taken off first, so the item has none.)
    case.read_files()
    hand.unlink(replaced.json()["file_id"])
    with connect(case.database.url) as connection:
        connection.execute(
            "UPDATE evidence_requirements SET sufficiency = 'ACCEPTED', sufficiency_by = %s, "
            "sufficiency_at = clock_timestamp() WHERE id = %s",
            (owner, UUID(hand.item_id)),
        )
    assert hand.item()["state"] == "AWAITING_DEPENDENCY"
    fifth = hand.file()
    hand.link(fifth)
    assert (hand.item()["state"], hand.on_record()) == ("RECEIVED", ("NOT_REVIEWED", None))
    links = [row[2] for row in case.audit("evidence_requirement.file_linked", hand.item_id)]
    assert [(link["judgment_reset"], link["judgment_was"]) for link in links] == [
        (False, None), (False, None), (False, None), (False, None), (True, "ACCEPTED"),
    ]  # fmt: skip
    # Judged on the file now linked, it is accepted, and that file is then kept.
    assert hand.decide("ACCEPTED").status_code == 200
    assert hand.withdraw(fifth).status_code == 409


def test_a_file_that_serves_no_item_leaves_the_request_to_go_out(migrated: Database) -> None:
    """Nothing is in hand when the file on the request serves none of its items (the
    reader's model found it covers none): the request stays a draft for all of them.
    Before, it was marked partly received and its send withdrawn."""
    case = _Case(migrated, "none")
    added = case.client.post(
        f"{case.base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "notes.txt", "request_id": case.request},
        content=b"Minutes of a meeting about parking.",
        headers={"content-type": "text/plain"},
    )
    assert added.status_code == 200, added.text
    covers_none = ",".join(
        f'{{"requirement_id": "{item["id"]}", "coverage": "NOT_COVERED"}}' for item in case.items
    )
    with connect(migrated.url) as connection:
        # As the model reads it: it covers none of the request's items.
        connection.execute(
            "UPDATE evidence_analyses SET source = 'MODEL', "
            "classification = jsonb_build_object('items', %s::jsonb) WHERE evidence_file_id = %s",
            (f"[{covers_none}]", added.json()["file_id"]),
        )
        connection.commit()
        from ai_workforce_api.evidence_receipts import apply_receipt

        match = connection.execute(
            "SELECT id FROM evidence_matches WHERE evidence_file_id = %s",
            (added.json()["file_id"],),
        ).fetchone()
        assert match is not None
        with connection.cursor() as cursor:
            moved = apply_receipt(
                cursor, case.team["org"], case.team["project"], match[0], UUID(case.request),
                case.team["owner_id"], "PERSON",
            )  # fmt: skip
        connection.commit()
    assert moved is None
    assert case.read(case.request)["status"] == "DRAFT"
    assert all(not item["in_hand"] for item in case.carried(case.request))
    assert len(case.carried(case.request)) == len(case.items)


def test_an_approval_of_an_earlier_wording_never_sends_the_new_one(migrated: Database) -> None:
    """The approval is of the wording that goes out. A request approved and not yet sent,
    for which one item's evidence then comes in hand: its approval is withdrawn, and the
    request for the remaining items is a new draft that needs its own approval."""
    case = _Case(migrated, "wording")
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    approval_id = approved.json()["approval"]["id"]
    first, rest = case.items[0], case.items[1:]
    case.add_for(first, "access policy.txt")

    assert case.rows(
        "SELECT decision::text, execution_status FROM approvals WHERE id = %s", UUID(approval_id)
    ) == [("APPROVED", "REFUSED")]
    assert len(case.audit("approval.withdrawn", approval_id)) == 1
    assert case.read(case.request)["status"] == "RECEIVED"
    outgoing = str(case.item(rest[0]["id"])["request_id"])
    assert outgoing != case.request and case.read(outgoing)["status"] == "DRAFT"
    # The earlier approval sends neither request.
    for request_id in (case.request, outgoing):
        refused = case.send(request_id, approval_id)
        assert refused.status_code == 409, refused.text
    assert case.count("outbound_messages") == 0 and case.count("mailbox_messages") == 0
    # The request it was asked on holds the item in hand only, as it now reads.
    assert rest[0]["title"] not in case.read(case.request)["evidence_description"]
    # A new approval, of the new wording, is what sends it.
    again = case.approve(outgoing)
    assert again.status_code == 200, again.text
    assert again.json()["approval"]["id"] != approval_id
    assert case.send(outgoing, again.json()["approval"]["id"]).status_code == 200
    assert case.count("mailbox_messages") == 1


def test_approving_waits_for_evidence_in_hand_to_be_struck_from_the_wording(
    migrated: Database,
) -> None:
    """A file added on one item whose reading has not finished: approving the request then
    would approve a wording that still asks for it. The approval is refused, the request
    is updated, and the person approves the wording that leaves the item out."""
    case = _Case(migrated, "guard")
    first, rest = case.items[0], case.items[1:]
    case.add_for(first, "access policy.txt", read=False)
    refused = case.approve(case.request)
    assert refused.status_code == 409
    assert refused.json()["detail"] == IN_HAND_CHANGED
    assert case.read(case.request)["status"] == "RECEIVED"
    assert case.rows(
        "SELECT count(*) FROM approvals WHERE parameters ->> 'request_ref' LIKE %s",
        f"pbc/{case.request}/%",
    ) == [(0,)]
    outgoing = str(case.item(rest[0]["id"])["request_id"])
    assert outgoing != case.request
    assert first["title"] not in case.read(outgoing)["evidence_description"]
    assert case.approve(outgoing).status_code == 200
    # The reading finishing afterwards changes nothing: the item was already in hand.
    case.read_files()
    assert case.read(case.request)["status"] == "RECEIVED"
    assert case.read(outgoing)["status"] == "APPROVAL_PENDING"
    assert case.item(first["id"])["in_hand"] is True


def test_nothing_is_approved_when_every_item_is_already_in_hand(migrated: Database) -> None:
    """Every item's file added on its row, their reading not finished: there is nothing to
    send, so the approval is refused and the request is received as provided directly."""
    case = _Case(migrated, "guard-all")
    for number, item in enumerate(case.items):
        case.add_for(item, f"evidence {number}.txt", read=False)
    refused = case.approve(case.request)
    assert refused.status_code == 409
    assert refused.json()["detail"] == IN_HAND_ALL
    kept = case.read(case.request)
    assert (kept["status"], kept["provided_directly"]) == ("RECEIVED", True)
    assert [r["id"] for r in case.design()["requests"]] == [case.request]
    assert case.rows(
        "SELECT count(*) FROM approvals WHERE parameters ->> 'request_ref' LIKE %s",
        f"pbc/{case.request}/%",
    ) == [(0,)]
    case.read_files()
    assert case.read(case.request)["status"] == "RECEIVED"
    assert case.count("outbound_messages") == 0 and case.count("mailbox_messages") == 0

    # A file added on the request as a whole and not read yet puts nothing in hand by
    # itself: which items it serves is the reading's to say, so the approval goes on.
    other = _Case(migrated, "guard-whole")
    added = other.client.post(
        f"{other.base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "bundle.txt", "request_id": other.request},
        content=b"Several documents in one file.",
        headers={"content-type": "text/plain"},
    )
    assert added.status_code == 200, added.text
    assert other.approve(other.request).status_code == 200


def test_withdrawing_the_file_in_hand_puts_its_item_back_to_be_asked(migrated: Database) -> None:
    """Traceability holds when the evidence leaves: the withdrawn file stays on record, the
    item is no longer in hand, and its request is a draft again, for that item only, which
    needs approval like any other. The other items are not asked twice."""
    case = _Case(migrated, "withdraw")
    first, rest = case.items[0], case.items[1:]
    file_id = case.add_for(first, "access policy.txt")
    outgoing = str(case.item(rest[0]["id"])["request_id"])
    withdrawn = case.client.post(
        f"{case.base}/evidence-files/{file_id}/withdraw",
        json={"reason": "Superseded: the owner sent the wrong version."},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    back = case.read(case.request)
    assert (back["status"], back["provided_directly"]) == ("DRAFT", False)
    held = case.item(first["id"])
    assert held["in_hand"] is False and held["request_id"] == case.request
    assert first["title"] in back["evidence_description"]
    assert all(item["title"] not in back["evidence_description"] for item in rest)
    assert case.read(outgoing)["status"] == "DRAFT"
    # The file and what it evidenced stay on record.
    assert case.rows(
        "SELECT requirement_id FROM evidence_matches WHERE evidence_file_id = %s", UUID(file_id)
    ) == [(UUID(first["id"]),)]
    assert case.rows(
        "SELECT count(*) FROM evidence_withdrawals WHERE evidence_file_id = %s", UUID(file_id)
    ) == [(1,)]


def test_with_email_off_an_approval_records_the_hand_over(migrated: Database) -> None:
    """Before: with live email off the approval stood and nothing was sent, while the
    screens could read as if the request were with the owner. Now the approval records a
    hand-over, by whom and when, and the API says so; nothing says it was sent."""
    case = _Case(migrated, "off")
    off = case.email_off()
    plan = _plan(off, case.team, case.control)
    assert plan["live_email"] is False
    approved = case.approve(case.request, off)
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["live_email"] is False and body["request"]["live_email"] is False
    assert body["request"]["status"] == "APPROVAL_PENDING"
    delivery = body["request"]["delivery"]
    assert delivery["mode"] == "HANDED_OVER"
    assert delivery["by"] == case.name(case.team["owner_id"])
    at = datetime.fromisoformat(delivery["at"])
    assert abs(datetime.now(UTC) - at) < timedelta(minutes=5)

    # On the audit trail with the person as the actor, for the approval of this wording.
    recorded = case.audit("pbc.handed_over", case.request)
    assert [(row[0], row[1]) for row in recorded] == [(case.team["owner_id"], None)]
    assert recorded[0][2]["approval_id"] == body["approval"]["id"]
    assert recorded[0][2]["reason"] == "live email is off"
    assert case.rows(
        "SELECT handed_over_by, handed_over_approval_id FROM pbc_requests WHERE id = %s",
        UUID(case.request),
    ) == [(case.team["owner_id"], UUID(body["approval"]["id"]))]

    # Nothing is recorded as sent, anywhere the web reads it.
    assert case.count("outbound_messages") == 0 and case.count("mailbox_messages") == 0
    read = case.read(case.request, off)
    assert read["status"] == "APPROVAL_PENDING" and read["outbound_message_id"] is None
    assert read["delivery"]["mode"] == "HANDED_OVER" and read["live_email"] is False
    details = off.get(f"{case.base}/pbc-requests/{case.request}/details")
    assert details.status_code == 200, details.text
    assert details.json()["request"]["delivery"] == delivery
    assert details.json()["request"]["live_email"] is False
    design = case.design(off)
    listed = next(r for r in design["requests"] if r["id"] == case.request)
    assert listed["status"] == "APPROVAL_PENDING"
    assert listed["delivery"] == delivery
    assert listed["recipient"] == read["recipient"] and listed["version"] == read["version"]
    assert datetime.fromisoformat(listed["due_at"]) == datetime.fromisoformat(read["due_at"])
    carried = [r for r in design["requirements"] if r["request_id"] == case.request]
    assert carried and all(r["state"] == "APPROVAL_PENDING" for r in carried)
    assert all(r["request_status"] != "SENT" and not r["in_hand"] for r in carried)

    # Sending is still refused, and the hand-over is recorded once.
    refused = case.send(case.request, body["approval"]["id"], off)
    assert refused.status_code == 409 and refused.json()["detail"] == "live email is off"
    assert len(case.audit("pbc.handed_over", case.request)) == 1
    assert case.rows(
        "SELECT execution_status FROM approvals WHERE id = %s", UUID(body["approval"]["id"])
    ) == [("NOT_STARTED",)]

    # Taken back to draft to reword, it is no longer handed over; the trail keeps both.
    taken = case.move(case.request, "DRAFT")
    assert taken.status_code == 200, taken.text
    assert taken.json()["delivery"] is None
    assert [row[0] for row in case.audit("pbc.handover_withdrawn", case.request)] == [
        case.team["owner_id"]
    ]
    assert len(case.audit("pbc.handed_over", case.request)) == 1


def test_an_approved_request_sent_with_email_off_is_handed_over_by_the_sender(
    migrated: Database,
) -> None:
    """Approved while a mailbox was on and not sent; then email is off when a person sends
    it: the send is refused as before, and that person is on record as handing it over.
    A wording changed since the approval is not handed over on it."""
    case = _Case(migrated, "sender")
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    body = approved.json()
    # A mailbox is on: approving sends nothing by itself and hands nothing over.
    assert body["live_email"] is True and body["request"]["delivery"] is None
    approval_id = body["approval"]["id"]
    sender, _client = case.member("CONTRIBUTOR")
    refused = case.send(case.request, approval_id, case.email_off(sender))
    assert refused.status_code == 409 and refused.json()["detail"] == "live email is off"
    read = case.read(case.request)
    assert read["status"] == "APPROVAL_PENDING"
    assert read["delivery"]["mode"] == "HANDED_OVER"
    assert read["delivery"]["by"] == case.name(sender)
    assert [row[0] for row in case.audit("pbc.handed_over", case.request)] == [sender]
    assert case.count("outbound_messages") == 0

    # Another request, approved, then its due date moved: the approval is of another
    # message, so nothing is handed over on it.
    other = _Case(migrated, "moved")
    approved = other.approve(other.request)
    assert approved.status_code == 200, approved.text
    later = (datetime.now(UTC) + timedelta(days=40)).isoformat()
    assert other.move(other.request, "APPROVAL_PENDING", due_at=later).status_code == 200
    refused = other.send(other.request, approved.json()["approval"]["id"], other.email_off())
    assert refused.status_code == 409
    assert other.read(other.request)["delivery"] is None
    assert other.audit("pbc.handed_over", other.request) == []


def test_with_a_mailbox_on_the_delivery_is_the_email(migrated: Database) -> None:
    case = _Case(migrated, "on")
    assert _plan(case.client, case.team, case.control)["live_email"] is True
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    assert approved.json()["live_email"] is True
    assert approved.json()["request"]["delivery"] is None
    assert case.listed(case.request)["delivery"] is None
    sent = case.send(case.request, approved.json()["approval"]["id"])
    assert sent.status_code == 200, sent.text
    read = case.read(case.request)
    assert read["status"] == "SENT" and read["live_email"] is True
    assert read["delivery"]["mode"] == "EMAIL"
    assert read["delivery"]["by"] == case.name(case.team["owner_id"])
    assert read["delivery"]["at"] is not None
    assert case.listed(case.request)["delivery"] == read["delivery"]
    assert case.audit("pbc.handed_over", case.request) == []
    assert case.count("mailbox_messages") == 1


def _added(case: _Case, title: str) -> dict[str, Any]:
    added = case.client.post(
        f"{case.base}/controls/{case.control}/evidence-requirements",
        json={
            "phase": "DESIGN",
            "title": title,
            "description": "The record that shows who approved the access and when.",
            "categories": ["CONTROL_EXECUTION"],
            "objective": "Show the approval happened before the access was granted.",
            "rationale": "Asked by the reviewer after the release of the D&I evidence.",
        },
    )
    assert added.status_code == 200, added.text
    design = _phase(added.json(), "DESIGN")
    found: dict[str, Any] = next(r for r in design["requirements"] if r["title"] == title)
    return found


def test_a_request_added_after_the_release_is_drafted_and_needs_approval(
    migrated: Database,
) -> None:
    """Verified, not changed (B1g, 3a): a D&I request a person adds after the release is
    not left stranded. It joins the draft still open, whose wording then asks for it; once
    that request went for approval, a later addition is drafted in a request of its own.
    Either way nothing is sent before a person approves the wording."""
    case = _Case(migrated, "added")
    first = _added(case, "Approval ticket for the new joiner")
    assert first["status"] == "REQUESTED" and first["request_id"] == case.request
    assert first["accepted"] is True
    assert first["accepted_by"] == case.name(case.team["owner_id"])
    assert first["title"] in case.read(case.request)["evidence_description"]
    assert case.read(case.request)["status"] == "DRAFT"
    assert case.count("outbound_messages") == 0
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    worded = case.read(case.request)["evidence_description"]

    second = _added(case, "Screenshot of the role assignment")
    assert second["status"] == "REQUESTED" and second["request_id"] != case.request
    own = case.read(str(second["request_id"]))
    assert own["status"] == "DRAFT" and own["drafted_by"] == "AGENT"
    assert second["title"] in own["evidence_description"]
    # The approved request is not reworded by the addition.
    assert case.read(case.request)["evidence_description"] == worded
    # The addition's request is not covered by the approval of the other one.
    refused = case.send(str(second["request_id"]), approved.json()["approval"]["id"])
    assert refused.status_code == 409
    assert case.count("outbound_messages") == 0
    assert case.approve(str(second["request_id"])).status_code == 200


def test_a_request_is_not_reworded_once_it_went_for_approval_or_was_sent(
    migrated: Database,
) -> None:
    """Verified, not changed (B1g, 3b): the routes that reword a request keep the approval
    rule. A request awaiting its send, or sent, is not reworded in place; returned to
    draft and reworded, the approval of the earlier wording does not send it."""
    case = _Case(migrated, "edit")
    item = case.items[0]
    edit = f"{case.base}/controls/{case.control}/evidence-requirements/{item['id']}/edit"
    reworded = {"title": item["title"], "description": "The policy as approved this year, signed."}
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    approval_id = approved.json()["approval"]["id"]

    # Approved and not sent: neither route rewords it.
    refused = case.client.post(edit, json={**reworded, "version": case.item(item["id"])["version"]})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "the request carrying it has gone for approval"
    bound = case.move(case.request, "APPROVAL_PENDING", evidence_description="Something else.")
    assert bound.status_code == 409 and bound.json()["detail"] == "pbc recipient is bound"

    # Returned to draft and reworded: the earlier approval does not send the new wording.
    assert case.move(case.request, "DRAFT").status_code == 200
    changed = case.client.post(edit, json={**reworded, "version": case.item(item["id"])["version"]})
    assert changed.status_code == 200, changed.text
    assert reworded["description"] in case.read(case.request)["evidence_description"]
    assert case.move(case.request, "APPROVAL_PENDING").status_code == 200
    stale = case.send(case.request, approval_id)
    assert stale.status_code == 409 and stale.json()["detail"] == "approval does not match"
    # Nor is it handed over on that approval where email is off.
    assert case.send(case.request, approval_id, case.email_off()).status_code == 409
    assert case.read(case.request)["delivery"] is None
    assert case.count("outbound_messages") == 0 and case.count("mailbox_messages") == 0

    # A new approval of the new wording sends it; a sent request is not reworded.
    assert case.move(case.request, "DRAFT").status_code == 200
    again = case.approve(case.request)
    assert again.status_code == 200, again.text
    assert case.send(case.request, again.json()["approval"]["id"]).status_code == 200
    sent = case.read(case.request)
    assert sent["status"] == "SENT"
    refused = case.client.post(edit, json={**reworded, "version": case.item(item["id"])["version"]})
    assert refused.status_code == 409
    bound = case.move(case.request, "SENT", evidence_description="Something else.")
    assert bound.status_code == 409
    assert case.read(case.request)["evidence_description"] == sent["evidence_description"]
    mailed = case.rows(
        "SELECT body FROM mailbox_messages WHERE project_id = %s", case.team["project"]
    )
    assert len(mailed) == 1 and reworded["description"] in mailed[0][0]
