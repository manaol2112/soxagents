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
- a reviewer reads and is refused, and another firm sees nothing.
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

    def upload(self, item: dict[str, Any], name: str, client: TestClient | None = None) -> Any:
        return (client or self.client).post(
            f"{self.base}/evidence-uploads",
            params={
                "batch_id": str(uuid4()),
                "name": name,
                "request_id": item["request_id"],
                "requirement_id": item["id"],
            },
            content=f"Evidence for {item['title']}: managers approve access.".encode(),
            headers={"content-type": "text/plain"},
        )

    def add_for(self, item: dict[str, Any], name: str, read: bool = True) -> str:
        added = self.upload(item, name)
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


def test_a_reviewer_reads_and_is_refused_and_another_firm_sees_nothing(
    migrated: Database,
) -> None:
    case = _Case(migrated, "roles")
    item = case.items[0]
    _reviewer_id, reviewer = case.member("REVIEWER")
    # Reads, with the new fields.
    plan = _plan(reviewer, case.team, case.control)
    assert plan["live_email"] is True
    assert all("in_hand" in r for r in _phase(plan, "DESIGN")["requirements"])
    assert case.read(case.request, reviewer)["delivery"] is None
    # Refused wherever its neighbours refuse.
    assert case.approve(case.request, reviewer).status_code == 403
    assert case.upload(item, "policy.txt", reviewer).status_code == 403
    control = f"{case.base}/controls/{case.control}"
    assert (
        reviewer.post(
            f"{control}/evidence-requirements",
            json={
                "phase": "DESIGN",
                "title": "Another request",
                "description": "Something the reviewer would like to see.",
                "categories": ["OTHER"],
                "objective": "None they may ask for.",
                "rationale": "A reviewer reads; they do not change the work.",
            },
        ).status_code
        == 403
    )
    assert (
        reviewer.post(
            f"{control}/evidence-requirements/{item['id']}/edit",
            json={"title": item["title"], "description": "Reworded by a reader.", "version": 1},
        ).status_code
        == 403
    )
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    approval_id = approved.json()["approval"]["id"]
    assert case.send(case.request, approval_id, reviewer).status_code == 403
    # A reader where email is off hands nothing over either.
    off = case.email_off(_reviewer_id)
    assert case.send(case.request, approval_id, off).status_code == 403
    assert case.read(case.request)["delivery"] is None
    # A contributor prepares requests and may not approve one (as before).
    other = _Case(migrated, "roles-b")
    _contributor_id, contributor = other.member("CONTRIBUTOR")
    assert other.approve(other.request, contributor).status_code == 403
    # Another firm's person sees none of it.
    outsider = other.client
    assert outsider.get(f"{case.base}/pbc-requests/{case.request}").status_code in (403, 404)
    assert outsider.post(
        f"{case.base}/pbc-requests/{case.request}/send", json={"approval_id": approval_id}
    ).status_code in (403, 404)
    assert outsider.get(f"{control}/evidence-plan").status_code in (403, 404)
    assert case.audit("pbc.handed_over", case.request) == []


def test_an_interim_request_keeps_its_behaviour(migrated: Database) -> None:
    """The per-item rule is the D&I phase's. An unsent interim request still follows the
    earlier rule when a file comes for one of its items: the request moves as a whole and
    its items stay on it (the same defect exists there; it is reported, not changed)."""
    team, client, _scheduler = _engagement(migrated, f"de-interim-{uuid4().hex[:4]}")
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    control = _control(migrated, team, AC01)
    interim = _phase(_plan(client, team, control), "INTERIM")
    request = next(r for r in interim["requests"] if r["status"] == "DRAFT")
    carried = [
        r
        for r in interim["requirements"]
        if r["request_id"] == request["id"] and r["status"] == "REQUESTED"
    ]
    assert carried
    added = client.post(
        f"{base}/evidence-uploads",
        params={
            "batch_id": str(uuid4()),
            "name": "population.txt",
            "request_id": request["id"],
            "requirement_id": carried[0]["id"],
        },
        content=b"User ID, name, date granted.",
        headers={"content-type": "text/plain"},
    )
    assert added.status_code == 200, added.text
    with connect(migrated.url) as connection:
        for (analysis_id,) in connection.execute(
            "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
        ).fetchall():
            run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
    after = _phase(_plan(client, team, control), "INTERIM")
    moved = next(r for r in after["requests"] if r["id"] == request["id"])
    assert moved["status"] in ("RECEIVED", "PARTIALLY_RECEIVED")
    assert moved["status"] == ("RECEIVED" if len(carried) == 1 else "PARTIALLY_RECEIVED")
    # No item left it, and no other interim request was drafted for the rest.
    still = [r for r in after["requirements"] if r["request_id"] == request["id"]]
    assert {r["id"] for r in still} >= {r["id"] for r in carried}
    assert [r["id"] for r in after["requests"]] == [r["id"] for r in interim["requests"]]


def test_requests_sent_as_one_email_are_handed_over_when_email_is_off(migrated: Database) -> None:
    """Requests that travel to one person as one email (the evidence centre's group):
    approved and sent with email off, each request is recorded as handed over by that
    person, nothing is sent, and the same email still goes out once a mailbox is on."""
    from test_evidence_center import _ready
    from test_evidence_flow import _project
    from test_evidence_groups import _approve_send, _personal_split, _review

    team = _ready(migrated, f"de-group-{uuid4().hex[:4]}")
    off = _session(migrated, team["owner_id"], email_provider="graph")
    standard, _personal = _personal_split(off, team)
    view = _review(off, team, standard["id"]).json()
    members = [str(m["id"]) for m in view["members"]]
    approved = _approve_send(off, team, view, reason="Checked the request.")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    assert "handed over" in approved.json()["notice"]
    with connect(migrated.url) as connection:
        name = connection.execute(
            "SELECT display_name FROM users WHERE id = %s", (team["owner_id"],)
        ).fetchone()
        sent = connection.execute(
            "SELECT (SELECT count(*) FROM outbound_messages WHERE project_id = %s), "
            "(SELECT count(*) FROM mailbox_messages WHERE project_id = %s)",
            (team["project"], team["project"]),
        ).fetchone()
        actors = connection.execute(
            "SELECT target_id, actor_user_id FROM audit_events WHERE action = 'pbc.handed_over' "
            "AND project_id = %s",
            (team["project"],),
        ).fetchall()
    assert name is not None and sent == (0, 0)
    assert sorted(actors) == sorted((UUID(member), team["owner_id"]) for member in members)
    for member in members:
        read = off.get(f"{_project(team)}/pbc-requests/{member}").json()
        assert read["status"] == "APPROVAL_PENDING" and read["live_email"] is False
        assert read["delivery"]["mode"] == "HANDED_OVER" and read["delivery"]["by"] == name[0]
    # With a mailbox on, the approved email goes out as approved; the delivery is then it.
    delivered = team["owner"].post(f"{_project(team)}/evidence-groups/{view['id']}/send")
    assert delivered.status_code == 200, delivered.text
    assert delivered.json()["status"] == "SENT"
    for member in members:
        read = team["owner"].get(f"{_project(team)}/pbc-requests/{member}").json()
        assert read["status"] == "SENT" and read["delivery"]["mode"] == "EMAIL"


# After the independent review of 12 November 2026 (docs/control-workflow-plan.md, B1g
# "After the independent review"): each finding with its regression test.


def _send_with_unknown_outcome(case: _Case, request_id: str, approval_id: str) -> Any:
    """A send whose provider delivered the message and then timed out: its outcome is
    unknown, and the request still awaits its send on record."""
    from test_outbound import _TimesOut

    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.outbound import send_request
    from ai_workforce_api.settings import Settings

    with connect(case.database.url) as connection:
        return send_request(
            connection,
            Settings(database_url=case.database.url),
            Principal(kind=PrincipalKind.USER, id=case.team["owner_id"]),
            UUID(str(case.team["org"])),
            UUID(str(case.team["project"])),
            UUID(request_id),
            UUID(approval_id),
            lambda settings, c, org, project: _TimesOut(  # type: ignore[arg-type,return-value]
                case.database.url, org, project, deliver=True
            ),
        )


def test_a_request_whose_email_may_be_with_the_owner_is_never_split(migrated: Database) -> None:
    """Review finding 1: a send was started and its outcome is unknown (the message may
    have been delivered). A file then read for one item must not take the other items off
    the request and reword it as never sent: it is treated as asked for, whole."""
    case = _Case(migrated, "flight")
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    worded = case.read(case.request)["evidence_description"]
    unknown = _send_with_unknown_outcome(case, case.request, approved.json()["approval"]["id"])
    assert unknown.status == "UNKNOWN"
    assert case.read(case.request)["status"] == "APPROVAL_PENDING"
    case.add_for(case.items[0], "access policy.txt")
    after = case.read(case.request)
    assert after["status"] == "PARTIALLY_RECEIVED"
    assert after["evidence_description"] == worded
    assert {r["id"] for r in case.carried(case.request)} == {r["id"] for r in case.items}
    assert [r["id"] for r in case.design()["requests"]] == [case.request]
    assert case.audit("pbc.items_requested_separately", case.request) == []
    # Nor at an approval or a send: the settle leaves it alone too.
    assert case.rows(
        "SELECT status FROM outbound_messages WHERE pbc_request_id = %s", UUID(case.request)
    ) == [("UNKNOWN",)]


def test_a_hand_over_is_held_to_everything_a_send_is_held_to(
    migrated: Database, monkeypatch: Any
) -> None:
    """Review finding 2: the hand-over skipped the recipient allow-list and the action
    policy, which a send enforces. Where a send would be refused, nothing is recorded."""
    from ai_workforce_api import outbound
    from ai_workforce_api.outbound import NOT_HANDED_OVER, OutboundState

    # A recipient outside the allowed domains: a send to them is refused, so is this.
    case = _Case(migrated, "held")
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    approval_id = approved.json()["approval"]["id"]
    narrow = _session(
        migrated,
        case.team["owner_id"],
        email_provider="graph",
        email_allowed_recipient_domains="elsewhere.example",
    )
    assert case.send(case.request, approval_id, narrow).status_code == 409
    assert case.read(case.request)["delivery"] is None
    # The action policy: sending requests is restricted on this engagement.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO action_restrictions (organization_id, project_id, action_id) "
            "VALUES (%s, %s, 'mail.pbc')",
            (case.team["org"], case.team["project"]),
        )
    assert case.send(case.request, approval_id, case.email_off()).status_code == 409
    assert case.read(case.request)["delivery"] is None
    assert case.audit("pbc.handed_over", case.request) == []
    # Without the restriction the same send is refused for email alone, and handed over.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM action_restrictions WHERE project_id = %s", (case.team["project"],)
        )
    assert case.send(case.request, approval_id, case.email_off()).status_code == 409
    assert case.read(case.request)["delivery"]["mode"] == "HANDED_OVER"

    # An approver whose send would be refused approves, and nothing is handed over: the
    # answer says so. (Asking for the approval is itself refused under a restriction, so
    # the refusal is placed where the hand-over checks it.)
    other = _Case(migrated, "held-b")

    def refuse(*_args: Any, **_kwargs: Any) -> None:
        raise OutboundState("action is not allowed")

    monkeypatch.setattr(outbound, "_require_policy", refuse)
    answered = other.approve(other.request, other.email_off())
    assert answered.status_code == 200, answered.text
    body = answered.json()
    assert body["approval"]["decision"] == "APPROVED"
    assert (body["handed_over"], body["notice"]) == (False, NOT_HANDED_OVER)
    assert body["request"]["delivery"] is None and body["live_email"] is False
    assert other.audit("pbc.handed_over", other.request) == []
    assert other.read(other.request)["delivery"] is None


def test_an_approval_with_email_off_says_what_it_recorded(migrated: Database) -> None:
    """Review findings 2 and 7: the approve answer, and the bulk "Approve", say that the
    request was handed over when it was, in one sentence."""
    from ai_workforce_api.outbound import HANDED_OVER

    case = _Case(migrated, "says")
    answered = case.approve(case.request, case.email_off())
    assert answered.status_code == 200, answered.text
    assert (answered.json()["handed_over"], answered.json()["notice"]) == (True, HANDED_OVER)
    # With a mailbox on there is nothing to say: it waits to be sent.
    on = _Case(migrated, "says-on")
    answered = on.approve(on.request)
    assert (answered.json()["handed_over"], answered.json()["notice"]) == (False, "")

    bulk = _Case(migrated, "says-bulk")
    current = bulk.read(bulk.request)
    changed = bulk.email_off().post(
        f"{bulk.base}/evidence-requests/bulk",
        json={
            "action": "APPROVE",
            "items": [{"id": bulk.request, "version": current["version"]}],
            "reason": "Read it; asks for the right items.",
        },
    )
    assert changed.status_code == 200, changed.text
    outcome = next(o for o in changed.json()["outcomes"] if o["id"] == bulk.request)
    assert (outcome["ok"], outcome["detail"]) == (True, HANDED_OVER)
    assert bulk.read(bulk.request)["delivery"]["mode"] == "HANDED_OVER"


def test_a_handed_over_request_that_receives_evidence_and_loses_it(migrated: Database) -> None:
    """Review findings 3 and 6. A handed-over request was asked for, whole: evidence that
    arrives for one item is received, not "in hand", and nothing is split. When that
    evidence is withdrawn the request returns to draft and its hand-over ends, on the
    trail, with who withdrew the file and why."""
    case = _Case(migrated, "ho-evidence")
    approved = case.approve(case.request, case.email_off())
    assert approved.json()["handed_over"] is True
    first = case.items[0]
    file_id = case.add_for(first, "access policy.txt")
    after = case.read(case.request)
    assert (after["status"], after["provided_directly"]) == ("PARTIALLY_RECEIVED", True)
    assert after["delivery"]["mode"] == "HANDED_OVER"
    assert {r["id"] for r in case.carried(case.request)} == {r["id"] for r in case.items}
    held = case.item(first["id"])
    assert [f["name"] for f in held["files"]] == ["access policy.txt"]
    assert held["in_hand"] is False
    assert case.audit("pbc.items_requested_separately", case.request) == []

    withdrawn = case.client.post(
        f"{case.base}/evidence-files/{file_id}/withdraw", json={"reason": "The wrong version."}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    back = case.read(case.request)
    assert (back["status"], back["delivery"]) == ("DRAFT", None)
    ended = case.audit("pbc.handover_withdrawn", case.request)
    assert [(row[0], row[1]) for row in ended] == [(case.team["owner_id"], None)]
    assert ended[0][2]["reason"] == "its evidence was withdrawn"
    assert ended[0][2]["approval_id"] == approved.json()["approval"]["id"]
    assert ended[0][2]["handed_over_by"] == str(case.team["owner_id"])


def test_a_hand_over_never_ends_without_a_record(migrated: Database) -> None:
    """Review finding 3: every path that returns a handed-over request to draft says so
    on the trail, with the actor and the reason, and the database refuses one that does
    not (migration 0153)."""
    import psycopg

    # An approval of it rejected.
    case = _Case(migrated, "ho-reject")
    approved = case.approve(case.request, case.email_off())
    assert approved.json()["handed_over"] is True
    with connect(migrated.url) as connection:
        # As when its approval can no longer send it; a new approval is then asked.
        connection.execute(
            "UPDATE approvals SET execution_status = 'REFUSED' WHERE id = %s",
            (approved.json()["approval"]["id"],),
        )
    current = case.read(case.request)
    submitted = case.client.post(
        f"{case.base}/pbc-requests/{case.request}/submit", json={"version": current["version"]}
    )
    assert submitted.status_code == 200, submitted.text
    reviewer = _session(migrated, case.team["reviewer_id"])
    rejected = reviewer.post(
        f"{case.base}/approvals/{submitted.json()['approval']['id']}/decision",
        json={"decision": "REJECTED", "reason": "Ask for the signed version."},
    )
    assert rejected.status_code == 200, rejected.text
    assert (case.read(case.request)["status"], case.read(case.request)["delivery"]) == (
        "DRAFT",
        None,
    )
    ended = case.audit("pbc.handover_withdrawn", case.request)
    assert [row[0] for row in ended] == [case.team["reviewer_id"]]
    assert ended[0][2]["reason"] == "an approval of it was rejected"

    # A path that records nothing is refused, and the hand-over stands.
    other = _Case(migrated, "ho-bypass")
    assert other.approve(other.request, other.email_off()).json()["handed_over"] is True
    with pytest.raises(psycopg.errors.RaiseException, match="hand-over"):
        with connect(migrated.url) as connection:
            connection.execute(
                "UPDATE pbc_requests SET status = 'DRAFT' WHERE id = %s", (other.request,)
            )
    assert other.read(other.request)["delivery"]["mode"] == "HANDED_OVER"
    assert other.audit("pbc.handover_withdrawn", other.request) == []


def test_requests_sent_as_one_email_and_not_sent_end_their_hand_over_on_record(
    migrated: Database,
) -> None:
    """Review finding 3, for requests that travel as one email: handed over with email
    off, then changed, so the email is not sent as approved and they return to draft."""
    from test_evidence_center import _ready
    from test_evidence_flow import _project
    from test_evidence_groups import _approve_send, _personal_split, _review

    team = _ready(migrated, f"de-retire-{uuid4().hex[:4]}")
    off = _session(migrated, team["owner_id"], email_provider="graph")
    standard, _personal = _personal_split(off, team)
    view = _review(off, team, standard["id"]).json()
    members = [str(m["id"]) for m in view["members"]]
    assert _approve_send(off, team, view, reason="Checked the request.").status_code == 200
    with connect(migrated.url) as connection:
        # One of them changed after the approval.
        connection.execute(
            "UPDATE pbc_requests SET version = version + 1 WHERE id = %s", (members[0],)
        )
    refused = team["owner"].post(f"{_project(team)}/evidence-groups/{view['id']}/send")
    assert refused.status_code == 409, refused.text
    with connect(migrated.url) as connection:
        states = connection.execute(
            "SELECT status, handed_over_at FROM pbc_requests WHERE id = ANY(%s::uuid[])",
            (members,),
        ).fetchall()
        ended = connection.execute(
            "SELECT target_id, actor_user_id FROM audit_events "
            "WHERE action = 'pbc.handover_withdrawn' AND project_id = %s",
            (team["project"],),
        ).fetchall()
    assert states == [("DRAFT", None)] * len(members)
    assert sorted(ended) == sorted((UUID(member), team["owner_id"]) for member in members)


def test_items_that_cannot_be_requested_again_stay_on_their_request(migrated: Database) -> None:
    """Review finding 4: the split took the remaining items off the request even when
    they could not be requested again (here a kickoff draft waits to be settled against
    the plan), leaving them planned with no request and an audit record of none. Now the
    request stays whole, as before the per-item rule: no item is stranded."""
    case = _Case(migrated, "strand")
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO pbc_requests (organization_id, project_id, operation_key, control_ref, "
            "owner_user_id, recipient, due_at, evidence_description, engagement_control_id, "
            "drafted_by) SELECT organization_id, project_id, 'kickoff-legacy', control_ref, "
            "owner_user_id, recipient, due_at, 'Drafted at kickoff.', engagement_control_id, "
            "'AGENT' FROM pbc_requests WHERE id = %s",
            (case.request,),
        )
    case.add_for(case.items[0], "access policy.txt")
    after = case.read(case.request)
    assert (after["status"], after["provided_directly"]) == ("PARTIALLY_RECEIVED", True)
    assert {r["id"] for r in case.carried(case.request)} == {r["id"] for r in case.items}
    assert case.audit("pbc.items_requested_separately", case.request) == []
    assert case.rows(
        "SELECT count(*) FROM evidence_requirements WHERE engagement_control_id = %s "
        "AND phase = 'DESIGN' AND status = 'PLANNED' AND id = ANY(%s::uuid[])",
        UUID(case.control),
        [r["id"] for r in case.items],
    ) == [(0,)]


def test_a_split_requests_only_the_items_it_took_off(migrated: Database) -> None:
    """Review finding 5: the re-issue requested every planned item of every phase of the
    control. A D&I file now requests only the D&I items it left to ask for."""
    case = _Case(migrated, "narrow")
    waiting = case.rows(
        "SELECT q.id, q.pbc_request_id, r.version FROM evidence_requirements q "
        "JOIN pbc_requests r ON r.id = q.pbc_request_id "
        "WHERE q.engagement_control_id = %s AND q.phase = 'INTERIM' AND q.status = 'REQUESTED' "
        "AND q.depends_on IS NULL AND r.status = 'DRAFT' ORDER BY q.created_at LIMIT 1",
        UUID(case.control),
    )
    assert waiting, "the control has an interim item in a draft"
    item, request, _version = waiting[0]
    with connect(migrated.url) as connection:
        # An interim item planned and not requested, as one a person restored would be.
        connection.execute(
            "UPDATE evidence_requirements SET status = 'PLANNED', pbc_request_id = NULL "
            "WHERE id = %s",
            (item,),
        )
    before = case.rows(
        "SELECT version, evidence_description FROM pbc_requests WHERE id = %s", request
    )
    case.add_for(case.items[0], "access policy.txt")
    assert case.read(case.request)["status"] == "RECEIVED"
    assert case.rows(
        "SELECT status, pbc_request_id FROM evidence_requirements WHERE id = %s", item
    ) == [("PLANNED", None)]
    assert (
        case.rows("SELECT version, evidence_description FROM pbc_requests WHERE id = %s", request)
        == before
    )
    assert case.rows(
        "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'pbc.updated' "
        "AND payload ->> 'source' = 'evidence_in_hand' AND payload ->> 'phase' <> 'DESIGN'",
        case.team["project"],
    ) == [(0,)]


def test_every_item_served_is_received_whatever_the_draft_counted(migrated: Database) -> None:
    """Review finding 8: with the coordinator's draft on record, a request whose every
    item had a file of its own was marked partly received while the approval was told
    nothing needed sending. Both now say received."""
    from ai_workforce_api.pbc_drafting import run_draft

    for slug, read in (("served-read", True), ("served-approve", False)):
        case = _Case(migrated, slug)
        with connect(migrated.url) as connection:
            draft = connection.execute(
                "SELECT id FROM pbc_drafts WHERE pbc_request_id = %s", (case.request,)
            ).fetchone()
            assert draft is not None
            assert run_draft(connection, None, draft[0]) == "DRAFTED"
        for number, item in enumerate(case.items):
            case.add_for(item, f"evidence {number}.txt", read=False)
        if read:
            case.read_files()
        else:
            refused = case.approve(case.request)
            assert refused.status_code == 409 and refused.json()["detail"] == IN_HAND_ALL
        assert case.read(case.request)["status"] == "RECEIVED"


def test_sending_applies_evidence_that_came_in_hand_after_the_approval(
    migrated: Database,
) -> None:
    """Review finding 9: evidence in hand for one item after the approval (its reading not
    ended, or a file linked) left the send emailing the approved wording, which still
    asked for it. The send is refused, and the shorter wording is approved again."""
    case = _Case(migrated, "resettle")
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    approval_id = approved.json()["approval"]["id"]
    first, rest = case.items[0], case.items[1:]
    case.add_for(first, "access policy.txt", read=False)
    refused = case.send(case.request, approval_id)
    assert refused.status_code == 409 and refused.json()["detail"] == IN_HAND_CHANGED
    assert case.count("outbound_messages") == 0 and case.count("mailbox_messages") == 0
    assert case.read(case.request)["status"] == "RECEIVED"
    assert case.rows(
        "SELECT decision::text, execution_status FROM approvals WHERE id = %s", UUID(approval_id)
    ) == [("APPROVED", "REFUSED")]
    outgoing = str(case.item(rest[0]["id"])["request_id"])
    again = case.approve(outgoing)
    assert again.status_code == 200, again.text
    assert case.send(outgoing, again.json()["approval"]["id"]).status_code == 200
    mailed = case.rows(
        "SELECT body FROM mailbox_messages WHERE project_id = %s", case.team["project"]
    )
    assert len(mailed) == 1 and first["title"] not in mailed[0][0]


def test_the_draft_made_by_a_split_is_split_again(migrated: Database) -> None:
    """The draft for the remaining items is a request like any other: a file for one of
    its items leaves the rest to be asked for once more, without either item in hand."""
    case = _Case(migrated, "twice")
    _added(case, "Approval ticket for the new joiner")
    items = case.carried(case.request)
    assert len(items) >= 3
    first, second, rest = items[0], items[1], items[2:]
    case.add_for(first, "first.txt")
    middle = str(case.item(second["id"])["request_id"])
    assert middle != case.request
    case.add_for(case.item(second["id"]), "second.txt")
    assert case.read(middle)["status"] == "RECEIVED"
    assert case.item(second["id"])["request_id"] == middle
    last = {str(case.item(item["id"])["request_id"]) for item in rest}
    assert len(last) == 1 and not last & {case.request, middle}
    final = case.read(last.pop())
    assert final["status"] == "DRAFT"
    assert first["title"] not in final["evidence_description"]
    assert second["title"] not in final["evidence_description"]
    assert all(item["title"] in final["evidence_description"] for item in rest)
    assert len(case.audit("pbc.items_requested_separately", middle)) == 1
    assert all(case.item(item["id"])["in_hand"] for item in (first, second))
    assert case.count("outbound_messages") == 0


def test_an_upload_read_while_the_request_is_approved_leaves_one_consistent_record(
    migrated: Database,
) -> None:
    """The reading of a file for one item ends while a person approves the request: both
    finish (one waits for the other), the request with the item in hand is received, the
    rest are in a draft, and no approval is left that could send either wording."""
    import threading

    case = _Case(migrated, "race")
    first, rest = case.items[0], case.items[1:]
    case.add_for(first, "access policy.txt", read=False)
    start = threading.Barrier(2)
    answers: list[Any] = []
    failures: list[BaseException] = []

    def approve() -> None:
        try:
            start.wait(timeout=30)
            answers.append(case.approve(case.request))
        except BaseException as error:
            failures.append(error)

    def read() -> None:
        try:
            start.wait(timeout=30)
            case.read_files()
        except BaseException as error:
            failures.append(error)

    workers = [threading.Thread(target=approve), threading.Thread(target=read)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=120)
    assert not any(worker.is_alive() for worker in workers) and failures == []
    # The approval never went through: the item was in hand before it could.
    assert [answer.status_code for answer in answers] == [409], answers[0].text
    assert case.read(case.request)["status"] == "RECEIVED"
    assert {r["id"] for r in case.carried(case.request)} == {first["id"]}
    carrying = {str(case.item(item["id"])["request_id"]) for item in rest}
    assert len(carrying) == 1 and case.read(carrying.pop())["status"] == "DRAFT"
    assert case.rows(
        "SELECT count(*) FROM approvals WHERE project_id = %s AND action_id = 'mail.pbc' "
        "AND (decision = 'PENDING' OR (decision = 'APPROVED' "
        "AND execution_status = 'NOT_STARTED'))",
        case.team["project"],
    ) == [(0,)]
    assert len(case.audit("pbc.items_requested_separately", case.request)) == 1
    assert case.count("outbound_messages") == 0
