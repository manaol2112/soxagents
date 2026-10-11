"""Phase 6 acceptance. One evidence request, exercised through the API a person uses."""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_followups import _advance, _decide, _follow_ups, _reminder
from test_inbound import _action, _reply, _simulate
from test_outbound import (
    _approved_request,
    _count,
    _request,
    _send,
    _send_direct,
    _session,
    _team,
    _TimesOut,
)
from test_pbc import _draft, _move

from ai_workforce_api.db import connect
from ai_workforce_api.followups import DONE, HOLD_SECONDS
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def test_one_request_is_sent_retried_answered_and_reminded(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "scenario")
    request_id, approval_id = _approved_request(migrated, seeded, project_id, owner, admin)

    first = _send_direct(
        migrated, seeded, project_id, request_id, approval_id, _accepted_then_timed_out(migrated)
    )
    assert (first.status, first.error_code) == ("UNKNOWN", "timeout")
    assert _request(owner, seeded, project_id, request_id)["status"] == "APPROVAL_PENDING"

    retried = owner.post(_send(seeded, project_id, request_id), json={"approval_id": approval_id})
    assert retried.status_code == 200
    sent_mail = retried.json()
    assert sent_mail["status"] == "ACCEPTED"
    assert sent_mail["attempt_count"] == 1
    duplicate = owner.post(_send(seeded, project_id, request_id), json={"approval_id": approval_id})
    assert duplicate.json()["id"] == sent_mail["id"]
    assert _count(migrated, "mailbox_messages") == 1
    sent = _request(owner, seeded, project_id, request_id)
    assert sent["status"] == "SENT"
    assert sent["thread_id"] == sent_mail["thread_id"]

    mailbox = _session(migrated, seeded["user_id"], email_mock_inbound_enabled=True)
    payload = _reply(sent, key="scenario-reply")
    reply = mailbox.post(_simulate(seeded, project_id), json=payload)
    assert reply.status_code == 200
    recorded = reply.json()
    assert (recorded["match_status"], recorded["review_state"]) == ("MATCHED", "NEEDS_REVIEW")
    assert recorded["pbc_request_id"] == request_id
    repeated = mailbox.post(_simulate(seeded, project_id), json=payload)
    assert repeated.json()["id"] == recorded["id"]
    reviewed = mailbox.post(
        _action(seeded, project_id, recorded["id"], "review"), json={"version": 1}
    )
    assert reviewed.json()["review_state"] == "REVIEWED"
    assert _request(owner, seeded, project_id, request_id)["status"] == "SENT"

    assert _advance(migrated, seeded, project_id, request_id, days=1) > 0
    assert _follow_ups(owner, seeded, project_id) == []
    assert _advance(migrated, seeded, project_id, request_id, days=4) == HOLD_SECONDS
    assert _advance(migrated, seeded, project_id, request_id, days=4) == HOLD_SECONDS
    [due] = _follow_ups(owner, seeded, project_id)
    assert (due["status"], due["sequence"]) == ("DUE", 1)

    submitted = owner.post(_reminder(seeded, project_id, request_id, due["id"], "submit"))
    assert submitted.status_code == 200
    reminder_approval = submitted.json()["approval"]["id"]
    _decide(admin, seeded, project_id, reminder_approval, "APPROVED")
    reminded = owner.post(
        _reminder(seeded, project_id, request_id, due["id"], "send"),
        json={"approval_id": reminder_approval},
    )
    assert reminded.status_code == 200
    reminder = reminded.json()
    assert (reminder["kind"], reminder["status"], reminder["thread_id"]) == (
        "reminder",
        "ACCEPTED",
        sent["thread_id"],
    )
    reminded_again = owner.post(
        _reminder(seeded, project_id, request_id, due["id"], "send"),
        json={"approval_id": reminder_approval},
    )
    assert reminded_again.json()["id"] == reminder["id"]
    waiting = _request(owner, seeded, project_id, request_id)
    assert waiting["status"] == "WAITING_FOR_RESPONSE"

    assert _advance(migrated, seeded, project_id, request_id, days=4) == HOLD_SECONDS
    [second, first_reminder] = _follow_ups(owner, seeded, project_id)
    assert (second["status"], second["sequence"]) == ("DUE", 2)
    assert first_reminder["status"] == "SENT"
    received = _move(
        owner,
        seeded,
        project_id,
        request_id,
        _draft(),
        "RECEIVED",
        waiting["version"],
        outbound_message_id=waiting["outbound_message_id"],
        thread_id=waiting["thread_id"],
    )
    assert received["status"] == "RECEIVED"
    closed = {item["sequence"]: item for item in _follow_ups(owner, seeded, project_id)}
    assert closed[1]["status"] == "SENT"
    assert (closed[2]["status"], closed[2]["reason"]) == ("CANCELLED", "request_resolved")
    assert _advance(migrated, seeded, project_id, request_id, days=30) == DONE
    assert _count(migrated, "mailbox_messages") == 3
    assert "client@example.com" not in _audit_text(migrated)
    assert "Here is the listing" not in _audit_text(migrated)


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _accepted_then_timed_out(database: Database) -> Any:
    def mailbox(
        settings: Settings,
        connection: psycopg.Connection[Any],
        organization_id: UUID,
        project_id: UUID,
    ) -> Any:
        return _TimesOut(database.url, organization_id, project_id, deliver=True)

    return mailbox


def _audit_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT payload::text FROM audit_events").fetchall()
    return str(rows)
