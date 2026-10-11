import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from test_execution import _add_project_member, _add_user, _ready
from test_inbound import _reply, _sent_request, _simulate
from test_outbound import _approved_request, _pbc_body, _request, _send, _session, _team
from test_pbc import _draft, _move, _requests

from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.durable import TASK_QUEUE, activities_for, follow_up_workflow_id
from ai_workforce_api.durable_workflow import FollowUpRequest, FollowUpWorkflow
from ai_workforce_api.followups import DONE, HOLD_SECONDS, Occurrence, advance, plan
from ai_workforce_api.mailbox import MailboxProvider, open_mailbox
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.outbound import PBC_REMINDER, render_reminder, send_reminder
from ai_workforce_api.settings import Settings

_APPROVED_REMINDER = "218c32e995682d02a05ab598cbd12195ca3c46b132d7ba3459185a36acaf2ab5"
_SENT_AT = datetime(2026, 10, 1, 9, tzinfo=UTC)


def test_the_reminder_template_is_the_reviewed_version() -> None:
    template = PBC_REMINDER
    text = f"{template.template_id}\n{template.version}\n{template.subject}\n{template.body}"
    assert hashlib.sha256(text.encode()).hexdigest() == _APPROVED_REMINDER


def test_reminders_render_in_the_request_thread() -> None:
    request = _pbc_body("The population of new accounts").model_copy(
        update={"status": "SENT", "outbound_message_id": "mock-1", "thread_id": "thread-1"}
    )
    follow_up_id = uuid4()
    message = render_reminder(request, "SOX 2026", follow_up_id, 1)
    reference = f"PBC-{request.id.hex[-8:].upper()}"
    assert message.action_id == "mail.reminder"
    assert message.thread_id == "thread-1"
    assert message.subject == f"[{reference}] Reminder: Evidence request: control/access-review"
    assert "This is reminder 1 of 2 for the evidence the audit team for SOX 2026" in message.body
    assert message.request_ref.startswith(f"pbc/{request.id}/pbc-reminder-v1/{follow_up_id}/")
    assert message.metadata["follow_up_id"] == str(follow_up_id)
    assert message.metadata["follow_up_sequence"] == "1"
    assert render_reminder(request, "SOX 2026", follow_up_id, 1) == message
    assert render_reminder(request, "SOX 2026", uuid4(), 1).request_ref != message.request_ref
    with pytest.raises(ValueError):
        render_reminder(request.model_copy(update={"thread_id": None}), "SOX 2026", follow_up_id, 1)


def test_reminders_fall_due_after_the_last_contact() -> None:
    waiting = _plan(now=_SENT_AT + timedelta(days=2))
    assert waiting.kind == "wait"
    assert waiting.seconds == 86400
    due = _plan(now=_SENT_AT + timedelta(days=3))
    assert (due.kind, due.sequence) == ("remind", 1)
    assert due.due_at == _SENT_AT + timedelta(days=3)
    replied = _plan(now=_SENT_AT + timedelta(days=4), last_reply_at=_SENT_AT + timedelta(days=2))
    assert replied.kind == "wait"
    reminded = [Occurrence("SENT", "", _SENT_AT + timedelta(days=3))]
    assert _plan(now=_SENT_AT + timedelta(days=5), occurrences=reminded).kind == "wait"
    second = _plan(now=_SENT_AT + timedelta(days=6), occurrences=reminded)
    assert (second.kind, second.sequence) == ("remind", 2)
    retried = [*reminded, Occurrence("FAILED", "delivery_failed", _SENT_AT + timedelta(days=6))]
    again = _plan(now=_SENT_AT + timedelta(days=6), occurrences=retried)
    assert (again.kind, again.sequence) == ("remind", 2)


def test_reminders_stop_hold_or_escalate() -> None:
    late = _SENT_AT + timedelta(days=30)
    for status in ("DRAFT", "RECEIVED", "ESCALATED", "CANCELLED", "CLOSED"):
        assert _plan(now=late, request_status=status).kind == "stop"
    assert _plan(now=late, ended=True).kind == "stop"
    assert _plan(now=late, project_status="ON_HOLD").kind == "hold"
    assert _plan(now=late, first_contact_at=None).kind == "hold"
    open_reminder = [Occurrence("APPROVAL_PENDING", "", None)]
    assert _plan(now=late, occurrences=open_reminder).kind == "hold"
    used = [
        Occurrence("SENT", "", _SENT_AT + timedelta(days=3)),
        Occurrence("SKIPPED", "skipped_by_person", _SENT_AT + timedelta(days=6)),
    ]
    assert _plan(now=late, occurrences=used).kind == "escalate"
    superseded = [*used[:1], Occurrence("SKIPPED", "reply_received", _SENT_AT + timedelta(days=6))]
    assert (_plan(now=late, occurrences=superseded).sequence) == 2
    assert _plan(now=late, max_follow_ups=0).kind == "escalate"


def test_a_due_reminder_is_approved_then_sent_in_the_request_thread(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "reminder")
    request_id = _sent(migrated, seeded, project_id, owner, admin)
    assert _advance(migrated, seeded, project_id, request_id, days=1) > 0
    assert _follow_ups(owner, seeded, project_id) == []
    assert _advance(migrated, seeded, project_id, request_id, days=4) == HOLD_SECONDS
    assert _advance(migrated, seeded, project_id, request_id, days=4) == HOLD_SECONDS
    [due] = _follow_ups(owner, seeded, project_id)
    assert (due["status"], due["sequence"]) == ("DUE", 1)
    submitted = owner.post(_reminder(seeded, project_id, request_id, due["id"], "submit"))
    assert submitted.status_code == 200
    approval = submitted.json()["approval"]
    assert approval["action_id"] == "mail.reminder"
    assert submitted.json()["follow_up"]["status"] == "APPROVAL_PENDING"
    assert submitted.json()["preview"]["subject"].startswith(f"[{_reference(request_id)}] Reminder")
    twice = owner.post(_reminder(seeded, project_id, request_id, due["id"], "submit"))
    assert twice.status_code == 409
    early = owner.post(
        _reminder(seeded, project_id, request_id, due["id"], "send"),
        json={"approval_id": approval["id"]},
    )
    assert early.status_code == 409
    assert early.json()["detail"] == "approval is not approved"
    _decide(admin, seeded, project_id, approval["id"], "APPROVED")
    sent = owner.post(
        _reminder(seeded, project_id, request_id, due["id"], "send"),
        json={"approval_id": approval["id"]},
    )
    assert sent.status_code == 200
    body = sent.json()
    assert (body["status"], body["kind"], body["follow_up_id"]) == (
        "ACCEPTED",
        "reminder",
        due["id"],
    )
    request = _request(owner, seeded, project_id, request_id)
    assert body["thread_id"] == request["thread_id"]
    assert request["status"] == "WAITING_FOR_RESPONSE"
    repeated = owner.post(
        _reminder(seeded, project_id, request_id, due["id"], "send"),
        json={"approval_id": approval["id"]},
    )
    assert repeated.json()["id"] == body["id"]
    assert _mailbox_count(migrated) == 2
    [closed] = _follow_ups(owner, seeded, project_id)
    assert (closed["status"], closed["outbound_id"]) == ("SENT", body["id"])
    initial = owner.post(
        _send(seeded, project_id, request_id), json={"approval_id": approval["id"]}
    )
    assert initial.status_code == 409
    audit = _audit_text(migrated)
    assert "client@example.com" not in audit
    assert "Reminder" not in audit


def test_reminders_escalate_after_the_limit_and_never_resume(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "escalate")
    request_id = _sent(migrated, seeded, project_id, owner, admin)
    for sequence in (1, 2):
        assert _advance(migrated, seeded, project_id, request_id, days=4) == HOLD_SECONDS
        due = _follow_ups(owner, seeded, project_id)[0]
        assert (due["status"], due["sequence"]) == ("DUE", sequence)
        skipped = owner.post(
            _reminder(seeded, project_id, request_id, due["id"], "skip"),
            json={"version": due["version"]},
        )
        assert skipped.status_code == 200
        assert (skipped.json()["status"], skipped.json()["reason"]) == (
            "SKIPPED",
            "skipped_by_person",
        )
    assert _advance(migrated, seeded, project_id, request_id, days=2) > 0
    assert _advance(migrated, seeded, project_id, request_id, days=4) == DONE
    request = _request(owner, seeded, project_id, request_id)
    assert (request["status"], request["escalation_state"]) == ("ESCALATED", "ESCALATED")
    reopened = _move(
        owner,
        seeded,
        project_id,
        request_id,
        _draft(),
        "WAITING_FOR_RESPONSE",
        request["version"],
        outbound_message_id=request["outbound_message_id"],
        thread_id=request["thread_id"],
    )
    assert reopened["status"] == "WAITING_FOR_RESPONSE"
    assert _advance(migrated, seeded, project_id, request_id, days=30) == DONE
    assert len(_follow_ups(owner, seeded, project_id)) == 2
    with connect(migrated.url) as connection:
        actors = connection.execute(
            """
            SELECT action, actor_user_id FROM audit_events
            WHERE target_id = %s AND payload->>'status' = 'ESCALATED'
            """,
            (UUID(request_id),),
        ).fetchall()
    assert actors == [("pbc.updated", None)]


def test_resolving_a_request_cancels_its_reminders(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "resolved")
    request_id = _sent(migrated, seeded, project_id, owner, admin)
    _advance(migrated, seeded, project_id, request_id, days=4)
    due = _follow_ups(owner, seeded, project_id)[0]
    request = _request(owner, seeded, project_id, request_id)
    cancelled = _move(
        owner,
        seeded,
        project_id,
        request_id,
        _draft(),
        "CANCELLED",
        request["version"],
        outbound_message_id=request["outbound_message_id"],
        thread_id=request["thread_id"],
        cancellation_reason="Evidence was provided in person",
    )
    assert cancelled["status"] == "CANCELLED"
    [closed] = _follow_ups(owner, seeded, project_id)
    assert (closed["status"], closed["reason"]) == ("CANCELLED", "request_resolved")
    refused = owner.post(_reminder(seeded, project_id, request_id, due["id"], "submit"))
    assert refused.status_code == 409
    assert _advance(migrated, seeded, project_id, request_id, days=30) == DONE
    assert _mailbox_count(migrated) == 1


def test_a_request_resolved_mid_send_is_never_reminded(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "midsend")
    request_id = _sent(migrated, seeded, project_id, owner, admin)
    _advance(migrated, seeded, project_id, request_id, days=4)
    due = _follow_ups(owner, seeded, project_id)[0]
    submitted = owner.post(_reminder(seeded, project_id, request_id, due["id"], "submit"))
    approval_id = submitted.json()["approval"]["id"]
    _decide(admin, seeded, project_id, approval_id, "APPROVED")

    def resolves_first(
        settings: Settings, connection: psycopg.Connection[Any], org: UUID, project: UUID
    ) -> MailboxProvider:
        with connect(migrated.url) as other:
            other.execute(
                """
                UPDATE pbc_requests
                SET status = 'WAITING_FOR_RESPONSE', version = version + 1 WHERE id = %s
                """,
                (UUID(request_id),),
            )
            other.execute(
                """
                UPDATE pbc_requests
                SET status = 'RECEIVED', received_at = clock_timestamp(),
                    first_response_at = clock_timestamp(), version = version + 1
                WHERE id = %s
                """,
                (UUID(request_id),),
            )
        return open_mailbox(settings, connection, org, project)

    with connect(migrated.url) as connection:
        result = send_reminder(
            connection,
            Settings(database_url=migrated.url),
            Principal(kind=PrincipalKind.USER, id=seeded["user_id"]),
            seeded["organization_id"],
            project_id,
            UUID(request_id),
            UUID(due["id"]),
            UUID(approval_id),
            resolves_first,
        )
    assert (result.status, result.error_code) == ("FAILED", "request_resolved")
    assert _mailbox_count(migrated) == 1
    [closed] = _follow_ups(owner, seeded, project_id)
    assert (closed["status"], closed["reason"]) == ("CANCELLED", "request_resolved")


def test_a_rejected_reminder_is_skipped_and_the_schedule_continues(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "rejected")
    request_id = _sent(migrated, seeded, project_id, owner, admin)
    _advance(migrated, seeded, project_id, request_id, days=4)
    due = _follow_ups(owner, seeded, project_id)[0]
    submitted = owner.post(_reminder(seeded, project_id, request_id, due["id"], "submit"))
    _decide(admin, seeded, project_id, submitted.json()["approval"]["id"], "REJECTED")
    assert _advance(migrated, seeded, project_id, request_id, days=4) == HOLD_SECONDS
    listed = _follow_ups(owner, seeded, project_id)
    assert [(item["sequence"], item["status"], item["reason"]) for item in listed] == [
        (2, "DUE", ""),
        (1, "SKIPPED", "approval_rejected"),
    ]


def test_a_reply_supersedes_a_due_reminder_without_using_a_slot(migrated: Database) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "replied")
    request_id = sent["id"]
    _advance(migrated, seeded, project_id, request_id, days=4)
    replied = owner.post(_simulate(seeded, project_id), json=_reply(sent, key="reply-1"))
    assert replied.status_code == 200
    assert _advance(migrated, seeded, project_id, request_id, days=2) > 0
    [superseded] = _follow_ups(owner, seeded, project_id)
    assert (superseded["status"], superseded["reason"]) == ("SKIPPED", "reply_received")
    assert _advance(migrated, seeded, project_id, request_id, days=4) == HOLD_SECONDS
    due = _follow_ups(owner, seeded, project_id)[0]
    assert (due["status"], due["sequence"]) == ("DUE", 1)


def test_reminders_cannot_bypass_the_template_or_the_roles(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "bypass")
    request_id = _sent(migrated, seeded, project_id, owner, admin)
    _advance(migrated, seeded, project_id, request_id, days=4)
    due = _follow_ups(owner, seeded, project_id)[0]
    executed = owner.post(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}/actions/execute",
        json={
            "action_id": "mail.reminder",
            "parameters": {
                "recipient": "client@example.com",
                "subject": "Anything at all",
                "request_ref": f"pbc/{request_id}/pbc-reminder-v1/{due['id']}/free-form",
            },
        },
    )
    assert executed.status_code == 409
    assert executed.json()["detail"] == "action requires an approved template"
    with connect(migrated.url) as connection:
        reviewer_id = _add_user(
            connection,
            seeded["organization_id"],
            f"reviewer-{uuid4().hex[:6]}@example.com",
            "REVIEWER",
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer_id)
    reviewer = _session(migrated, reviewer_id)
    assert reviewer.get(_list(seeded, project_id)).status_code == 200
    assert (
        reviewer.post(_reminder(seeded, project_id, request_id, due["id"], "submit")).status_code
        == 403
    )
    assert reviewer.post(f"{_list(seeded, project_id)}/reconcile").status_code == 403
    _stranger_seeded, _other, stranger = _ready(migrated, "stranger")
    assert stranger.get(_list(seeded, project_id)).status_code == 404
    hidden = stranger.post(
        _reminder(seeded, project_id, request_id, due["id"], "skip"), json={"version": 1}
    )
    assert hidden.status_code == 404
    reconciled = owner.post(f"{_list(seeded, project_id)}/reconcile")
    assert reconciled.status_code == 200
    assert [item["id"] for item in reconciled.json()] == [due["id"]]


def test_follow_up_rows_only_move_forward(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "forward")
    request_id = _sent(migrated, seeded, project_id, owner, admin)
    _advance(migrated, seeded, project_id, request_id, days=4)
    due = _follow_ups(owner, seeded, project_id)[0]
    owner.post(
        _reminder(seeded, project_id, request_id, due["id"], "skip"),
        json={"version": due["version"]},
    )
    with connect(migrated.url) as connection:
        for statement in (
            "UPDATE pbc_follow_ups SET status = 'DUE', reason = '', closed_at = NULL, "
            "version = version + 1",
            "UPDATE pbc_follow_ups SET sequence = 5, version = version + 1",
            "DELETE FROM pbc_follow_ups",
        ):
            with pytest.raises(psycopg.Error):
                with connection.transaction():
                    connection.execute(statement)


@pytest.mark.anyio
async def test_the_durable_timer_escalates_a_silent_request(migrated: Database) -> None:
    seeded, project_id, owner, admin = _team(migrated, "timer")
    request_id = _sent(migrated, seeded, project_id, owner, admin)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET max_follow_ups = 0, version = version + 1 WHERE id = %s",
            (UUID(request_id),),
        )
    payload: FollowUpRequest = {
        "organization_id": str(seeded["organization_id"]),
        "project_id": str(project_id),
        "request_id": request_id,
    }
    async with await WorkflowEnvironment.start_time_skipping() as environment:
        async with Worker(
            environment.client,
            task_queue=TASK_QUEUE,
            workflows=[FollowUpWorkflow],
            activities=activities_for(migrated.url),
        ):
            result = await environment.client.execute_workflow(
                FollowUpWorkflow.run,
                payload,
                id=follow_up_workflow_id(UUID(request_id)),
                task_queue=TASK_QUEUE,
            )
    assert result == "DONE"
    assert _request(owner, seeded, project_id, request_id)["status"] == "ESCALATED"


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def _plan(**overrides: Any) -> Any:
    fields: dict[str, Any] = {
        "request_status": "SENT",
        "project_status": "ACTIVE",
        "ended": False,
        "follow_up_after_days": 3,
        "max_follow_ups": 2,
        "first_contact_at": _SENT_AT,
        "last_reply_at": None,
        "occurrences": [],
    }
    fields.update(overrides)
    return plan(**fields)


def _sent(
    database: Database,
    seeded: dict[str, Any],
    project_id: UUID,
    owner: TestClient,
    admin: TestClient,
) -> str:
    request_id, approval_id = _approved_request(database, seeded, project_id, owner, admin)
    sent = owner.post(_send(seeded, project_id, request_id), json={"approval_id": approval_id})
    assert sent.json()["status"] == "ACCEPTED"
    return request_id


def _advance(
    database: Database, seeded: dict[str, Any], project_id: UUID, request_id: str, *, days: float
) -> int:
    with connect(database.url) as connection:
        row = connection.execute("SELECT clock_timestamp()").fetchone()
        assert row is not None
        return advance(
            connection,
            seeded["organization_id"],
            project_id,
            UUID(request_id),
            row[0] + timedelta(days=days),
        )


def _decide(
    client: TestClient, seeded: dict[str, Any], project_id: UUID, approval_id: str, decision: str
) -> None:
    decided = client.post(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}/approvals/"
        f"{approval_id}/decision",
        json={"decision": decision, "reason": "Checked the reminder"},
    )
    assert decided.status_code == 200


def _follow_ups(client: TestClient, seeded: dict[str, Any], project_id: UUID) -> list[Any]:
    listed = client.get(_list(seeded, project_id))
    assert listed.status_code == 200
    items: list[Any] = listed.json()
    return items


def _list(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/follow-ups"


def _reminder(
    seeded: dict[str, Any], project_id: UUID, request_id: str, follow_up_id: str, verb: str
) -> str:
    return f"{_requests(seeded, project_id)}/{request_id}/follow-ups/{follow_up_id}/{verb}"


def _reference(request_id: str) -> str:
    return f"PBC-{UUID(request_id).hex[-8:].upper()}"


def _mailbox_count(database: Database) -> int:
    with connect(database.url) as connection:
        row = connection.execute("SELECT count(*) FROM mailbox_messages").fetchone()
    return 0 if row is None else int(row[0])


def _audit_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT payload::text FROM audit_events").fetchall()
    return str(rows)
