"""The evidence portal as the control owner's working space (migration 0078): deliverables,
uploads for an item, answers, messages, submitting, and the audit team's side."""

from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_evidence_intake import _request
from test_evidence_portal import _code, _public, _sent, _verify
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.portal_workspace import item_state, owner_status, question_key
from ai_workforce_api.request_details import parse_wording

__all__ = ["migrated"]

_PORTAL = "/public/evidence-portal/session"


def test_the_owner_status_comes_from_the_records_never_from_a_file_arriving() -> None:
    assert owner_status("SENT", 0, False, []) == "AWAITING"
    assert owner_status("SENT", 2, False, ["NOT_REVIEWED"]) == "IN_PROGRESS"
    assert owner_status("SENT", 2, True, ["NOT_REVIEWED"]) == "SUBMITTED"
    assert owner_status("RECEIVED", 2, True, ["NOT_REVIEWED"]) == "UNDER_REVIEW"
    assert owner_status("RECEIVED", 2, True, ["ACCEPTED", "INSUFFICIENT"]) == "MORE_NEEDED"
    # Only the audit team's judgment completes a request, or closing it.
    assert owner_status("RECEIVED", 2, True, ["ACCEPTED", "ACCEPTED"]) == "COMPLETED"
    assert owner_status("CLOSED", 0, False, []) == "COMPLETED"
    assert item_state(0, None) == "NOT_STARTED"
    assert item_state(3, "NOT_REVIEWED") == "UPLOADED"
    assert item_state(3, "UNDER_REVIEW") == "UNDER_REVIEW"
    assert item_state(3, "FOLLOW_UP_REQUIRED") == "MORE_NEEDED"
    assert item_state(1, "ACCEPTED") == "ACCEPTED"


def test_the_closing_line_is_not_part_of_the_last_item() -> None:
    content = parse_wording(
        "Opening.\n\n1. The list\n   Every grant.\n\n2. The query\n   Its parameters.\n\n"
        "Please label each file with the number of the item it answers. Thank you."
    )
    assert [item.detail for item in content.items] == ["Every grant.", "Its parameters."]
    assert content.closing.endswith("Thank you.")
    # Free wording is kept as written.
    free = parse_wording("Send the access list please. Thank you.")
    assert free.structured is False and free.closing == ""


def test_the_owner_sees_each_deliverable_and_uploads_for_one(migrated: Database) -> None:
    # Lean (27 October 2026): the design request carries two deliverables.
    sent = _sent(migrated, "items", "DESIGN")
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    body = public.get(_PORTAL, headers=session).json()
    request = body["requests"][0]
    assert request["structured"] is True and request["open"] is True
    assert [item["number"] for item in request["deliverables"]] == [1, 2]
    assert all(item["state"] == "NOT_STARTED" for item in request["deliverables"])
    assert "Thank you" not in request["deliverables"][-1]["detail"]
    assert request["owner_status"] == "AWAITING"
    assert body["counts"]["total"] == 1 and body["counts"]["awaiting"] == 1
    # Nothing internal reaches the owner.
    for internal in ("rationale", "objective", "planning", "internal_note"):
        assert internal not in request
    first = _upload(public, session, sent["request_id"], "grants.csv", b"id,granted\n1,x\n", 1)
    assert first.status_code == 200, first.text
    # An item the request does not have is refused.
    unknown = _upload(public, session, sent["request_id"], "x.csv", b"other\n", 9)
    assert unknown.status_code == 409
    request = public.get(_PORTAL, headers=session).json()["requests"][0]
    one, two = request["deliverables"]
    assert [f["file_name"] for f in one["files"]] == ["grants.csv"]
    assert one["state"] == "UPLOADED" and two["files"] == []
    assert request["owner_status"] == "IN_PROGRESS"
    # The file reached the audit team at once, filed by the owner for item 1, and is
    # linked to the item's planned requirement where one matches, by the owner.
    with connect(migrated.url) as connection:
        match = connection.execute(
            "SELECT owner_item, filed_by FROM evidence_matches WHERE pbc_request_id = %s",
            (sent["request_id"],),
        ).fetchall()
        links = connection.execute(
            "SELECT l.origin, r.title FROM evidence_requirement_files l "
            "JOIN evidence_requirements r ON r.id = l.requirement_id "
            "JOIN evidence_files f ON f.id = l.evidence_file_id WHERE f.file_name = 'grants.csv'"
        ).fetchall()
        planned = connection.execute(
            "SELECT count(*) FROM evidence_requirements WHERE pbc_request_id = %s "
            "AND status = 'REQUESTED' AND lower(title) = lower(%s)",
            (sent["request_id"], one["title"]),
        ).fetchone()
    assert match == [(1, "OWNER")]
    assert planned == (1,)
    assert links == [("OWNER", one["title"])]


def test_the_owner_answers_the_questions_on_the_request(migrated: Database) -> None:
    sent = _sent(migrated, "answers")
    question = "Which system produces the access listing?"
    _add_question(migrated, sent["request_id"], question)
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    request = public.get(_PORTAL, headers=session).json()["requests"][0]
    assert request["questions"] == [
        {"key": question_key(question), "text": question, "answer": "", "answered_at": None}
    ]
    url = f"{_PORTAL}/requests/{sent['request_id']}/answers"
    saved = public.post(
        url, json={"answers": [{"key": question_key(question), "answer": "SAP ERP"}]},
        headers=session,
    )  # fmt: skip
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"saved": 1}
    # A question no longer on the request, or a secret, is refused.
    stale = public.post(url, json={"answers": [{"key": "0" * 16, "answer": "x"}]}, headers=session)
    assert stale.status_code == 409
    secret = public.post(
        url,
        json={"answers": [{"key": question_key(question), "answer": "password: hunter2xyz"}]},
        headers=session,
    )
    assert secret.status_code == 409
    malformed = public.post(url, json={"answers": [{"key": "nothex", "answer": "x"}]},
                            headers=session)  # fmt: skip
    assert malformed.status_code == 422
    edited = public.post(
        url, json={"answers": [{"key": question_key(question), "answer": "SAP ERP 7.5"}]},
        headers=session,
    )  # fmt: skip
    assert edited.status_code == 200
    answer = public.get(_PORTAL, headers=session).json()["requests"][0]["questions"][0]
    assert answer["answer"] == "SAP ERP 7.5" and answer["answered_at"] is not None
    # The team reads the answer on the request.
    details = _team_details(sent)
    assert [(a["question"], a["answer"]) for a in details["client"]["answers"]] == [
        (question, "SAP ERP 7.5")
    ]
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'evidence.portal_answered'"
        ).fetchone()
    assert audit == (2,)


def test_the_owner_and_the_team_write_to_each_other_on_a_request(migrated: Database) -> None:
    sent = _sent(migrated, "thread")
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    url = f"{_PORTAL}/requests/{sent['request_id']}/messages"
    written = public.post(url, json={"body": "Does a CSV export work?"}, headers=session)
    assert written.status_code == 200, written.text
    assert written.json()["author"] == "YOU"
    assert public.post(url, json={"body": "   "}, headers=session).status_code == 409
    assert public.post(url, json={"body": ""}, headers=session).status_code == 422
    details = _team_details(sent)
    assert details["client"]["unseen"] == 1
    assert details["client"]["messages"][0]["author_name"] == sent["recipient"]
    # The team replies; the owner is emailed a fresh link, and the reply marks it seen.
    team = f"{_base(sent)}/pbc-requests/{sent['request_id']}"
    reply = sent["client"].post(f"{team}/messages", json={"body": "Yes, CSV is fine."})
    assert reply.status_code == 200, reply.text
    assert reply.json()["notified"] is True
    assert sent["client"].post(f"{team}/messages", json={"body": " "}).status_code == 409
    assert _team_details(sent)["client"]["unseen"] == 0
    with connect(migrated.url) as connection:
        mail = connection.execute(
            "SELECT subject, body FROM mailbox_messages WHERE body LIKE '%%Yes, CSV is fine.%%'"
        ).fetchall()
    assert len(mail) == 1
    assert "A message from the audit team" in str(mail[0][0])
    assert "/upload/" in str(mail[0][1])
    thread = public.get(_PORTAL, headers=session).json()["requests"][0]["messages"]
    assert [(m["author"], m["body"]) for m in thread] == [
        ("YOU", "Does a CSV export work?"),
        ("AUDIT_TEAM", "Yes, CSV is fine."),
    ]
    assert thread[1]["author_name"].endswith("audit team")
    # Seen is idempotent.
    seen = sent["client"].post(f"{team}/messages/seen")
    assert seen.status_code == 200 and seen.json() == {"seen": 0}


def test_messages_are_records_that_never_change(migrated: Database) -> None:
    sent = _sent(migrated, "immutable")
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    url = f"{_PORTAL}/requests/{sent['request_id']}/messages"
    assert public.post(url, json={"body": "First"}, headers=session).status_code == 200
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.RaiseException):
            connection.execute("UPDATE request_messages SET body = 'Changed'")
        connection.rollback()
        with pytest.raises(psycopg.errors.RaiseException):
            connection.execute("DELETE FROM request_messages")
        connection.rollback()
        # Only marking it seen, once.
        connection.execute("UPDATE request_messages SET seen_by_team_at = clock_timestamp()")
        connection.commit()
        with pytest.raises(psycopg.errors.RaiseException):
            connection.execute("UPDATE request_messages SET seen_by_team_at = NULL")


def test_submitting_needs_a_file_and_confirms_missing_items(migrated: Database) -> None:
    # Lean (27 October 2026): the design request carries two deliverables.
    sent = _sent(migrated, "submit", "DESIGN")
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    url = f"{_PORTAL}/requests/{sent['request_id']}/submit"
    empty = public.post(url, json={}, headers=session)
    assert empty.status_code == 409
    assert "at least one file" in empty.json()["detail"]
    _upload(public, session, sent["request_id"], "grants.csv", b"id\n1\n", 1)
    unconfirmed = public.post(url, json={"note": "More soon"}, headers=session)
    assert unconfirmed.status_code == 409
    assert "no files yet" in unconfirmed.json()["detail"]
    confirmed = public.post(
        url, json={"note": "The query follows Monday.", "confirm_incomplete": True},
        headers=session,
    )  # fmt: skip
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["missing"] == [
        "Walkthrough instance: one access request from request to grant"
    ]
    request = public.get(_PORTAL, headers=session).json()["requests"][0]
    assert request["submitted_at"] is not None
    assert request["owner_status"] in ("SUBMITTED", "UNDER_REVIEW")
    client = _team_details(sent)["client"]
    assert client["submitted_at"] is not None
    assert client["submission_note"] == "The query follows Monday."
    # Uploads still reach the team after submitting, and submitting again is fine.
    later = _upload(public, session, sent["request_id"], "query.png", b"\x89PNG count", 2)
    assert later.status_code == 200
    assert public.post(url, json={}, headers=session).status_code == 200


def test_the_owner_reaches_only_their_own_requests_in_the_workspace(
    migrated: Database,
) -> None:
    sent = _sent(migrated, "isolation")
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    # Another control's request goes to another owner: none of it is open to this one.
    other = _request(migrated, sent["team"], "ITGC-CM-01")["id"]
    for path, payload in (
        ("answers", {"answers": []}),
        ("messages", {"body": "Hello"}),
        ("submit", {"confirm_incomplete": True}),
    ):
        refused = public.post(f"{_PORTAL}/requests/{other}/{path}", json=payload,
                              headers=session)  # fmt: skip
        assert refused.status_code == 409, (path, refused.text)
        assert public.post(f"{_PORTAL}/requests/{other}/{path}", json=payload).status_code == 401


def test_a_closed_request_is_listed_to_look_back_at_but_takes_nothing(
    migrated: Database,
) -> None:
    sent = _sent(migrated, "closed")
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    # A second request to the same owner stays open, so the link still opens.
    _send(migrated, sent, _request(migrated, sent["team"], "ITGC-AC-01", "DESIGN"))
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'CLOSED' WHERE id = %s", (sent["request_id"],)
        )
    listed = public.get(_PORTAL, headers=session)
    assert listed.status_code == 200, listed.text
    closed = next(r for r in listed.json()["requests"] if r["id"] == sent["request_id"])
    assert closed["open"] is False and closed["owner_status"] == "COMPLETED"
    assert listed.json()["counts"]["completed"] == 1
    upload = _upload(public, session, sent["request_id"], "late.csv", b"late\n", 1)
    assert upload.status_code == 409
    message = public.post(f"{_PORTAL}/requests/{sent['request_id']}/messages",
                          json={"body": "Late"}, headers=session)  # fmt: skip
    assert message.status_code == 409


# Helpers


def _base(sent: dict[str, Any]) -> str:
    team = sent["team"]
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _send(database: Database, sent: dict[str, Any], request: dict[str, Any]) -> None:
    """Another request of the engagement is approved and sent, as _sent sends the first."""
    admin = _session(database, sent["team"]["reviewer_id"])
    one = f"{_base(sent)}/pbc-requests/{request['id']}"
    submitted = sent["client"].post(f"{one}/submit", json={"version": request["version"]})
    assert submitted.status_code == 200, submitted.text
    approval = submitted.json()["approval"]["id"]
    decided = admin.post(
        f"{_base(sent)}/approvals/{approval}/decision",
        json={"decision": "APPROVED", "reason": "Checked the request"},
    )
    assert decided.status_code == 200, decided.text
    delivered = sent["client"].post(f"{one}/send", json={"approval_id": approval})
    assert delivered.status_code == 200, delivered.text


def _team_details(sent: dict[str, Any]) -> dict[str, Any]:
    found = sent["client"].get(f"{_base(sent)}/pbc-requests/{sent['request_id']}/details")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return body


def _upload(
    public: TestClient,
    session: dict[str, str],
    request_id: str,
    name: str,
    content: bytes,
    item: int | None,
) -> Any:
    return public.post(
        f"{_PORTAL}/requests/{request_id}/files",
        params={"name": name} if item is None else {"name": name, "item": item},
        content=content,
        headers={**session, "content-type": "text/csv"},
    )


def _add_question(database: Database, request_id: str, question: str) -> None:
    """The request's wording gains a question, as the drafter writes questions."""
    with connect(database.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET evidence_description = evidence_description || %s "
            "WHERE id = %s",
            (f"\n\nQuestions for you:\n- {question}", request_id),
        )
