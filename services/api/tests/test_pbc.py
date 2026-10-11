from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_execution import _add_project_member, _add_user, _client, _ready

from ai_workforce_api.db import connect
from ai_workforce_api.mailbox import MockMailbox
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings

_DUE = "2026-11-01T00:00:00Z"


def test_a_pbc_request_follows_its_status_path(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "pbc")
    with connect(migrated.url) as connection:
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
        message = MockMailbox(connection, seeded["organization_id"], project_id).send(
            idempotency_key="pbc-message",
            recipient="client@example.com",
            subject="Population request",
            body="request/population",
            thread_id="thread-population",
        )
    created = client.post(_requests(seeded, project_id), json=_draft())
    assert created.status_code == 200
    assert created.json()["status"] == "DRAFT"
    assert created.json()["escalation_state"] == "NONE"
    assert created.json()["outbound_message_id"] is None
    repeat = client.post(_requests(seeded, project_id), json=_draft())
    assert repeat.json()["id"] == created.json()["id"]
    conflict = client.post(
        _requests(seeded, project_id),
        json={**_draft(), "recipient": "other@example.com"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "pbc key is already in use"
    request_id = created.json()["id"]
    pending = _move(client, seeded, project_id, request_id, _draft(), "APPROVAL_PENDING", 1)
    assert pending["status"] == "APPROVAL_PENDING"
    jumped = _move(client, seeded, project_id, request_id, _draft(), "RECEIVED", pending["version"])
    assert jumped.status_code == 409
    assert jumped.json()["detail"] == "pbc status is not allowed"
    missing = _move(client, seeded, project_id, request_id, _draft(), "SENT", pending["version"])
    assert missing.status_code == 409
    assert missing.json()["detail"] == "outbound message is required"
    sent = _move(
        client,
        seeded,
        project_id,
        request_id,
        _draft(),
        "SENT",
        pending["version"],
        outbound_message_id=message.provider_message_id,
        thread_id=message.thread_id,
    )
    assert sent["status"] == "SENT"
    assert sent["outbound_message_id"] == message.provider_message_id
    waiting = _move(
        client,
        seeded,
        project_id,
        request_id,
        _draft(),
        "WAITING_FOR_RESPONSE",
        sent["version"],
        outbound_message_id=message.provider_message_id,
        thread_id=message.thread_id,
    )
    partial = _move(
        client,
        seeded,
        project_id,
        request_id,
        _draft(),
        "PARTIALLY_RECEIVED",
        waiting["version"],
        outbound_message_id=message.provider_message_id,
        thread_id=message.thread_id,
        attachment_refs=["evidence/population.csv"],
    )
    assert partial["first_response_at"] is not None
    assert partial["received_at"] is None
    assert partial["attachment_refs"] == ["evidence/population.csv"]
    received = _move(
        client,
        seeded,
        project_id,
        request_id,
        _draft(),
        "RECEIVED",
        partial["version"],
        outbound_message_id=message.provider_message_id,
        thread_id=message.thread_id,
        attachment_refs=["evidence/population.csv"],
    )
    assert received["received_at"] is not None
    closed = _move(
        client,
        seeded,
        project_id,
        request_id,
        _draft(),
        "CLOSED",
        received["version"],
        outbound_message_id=message.provider_message_id,
        thread_id=message.thread_id,
        attachment_refs=["evidence/population.csv"],
    )
    assert closed["status"] == "CLOSED"
    assert closed["escalation_state"] == "NONE"
    stale = _move(
        client,
        seeded,
        project_id,
        request_id,
        _draft(),
        "CLOSED",
        received["version"],
        outbound_message_id=message.provider_message_id,
        thread_id=message.thread_id,
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "pbc request changed"
    reader = _client(migrated, reviewer)
    assert reader.get(_requests(seeded, project_id)).status_code == 200
    assert reader.post(_requests(seeded, project_id), json=_draft("second")).status_code == 403
    assert "client@example.com" not in _audit_text(migrated)
    assert client.get("/health").json()["live_email_enabled"] is False


def test_closed_pbc_records_do_not_send(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "closed-pbc")
    secret = client.post(
        _requests(seeded, project_id),
        json={**_draft(), "evidence_description": "api_key=sk-live-example"},
    )
    assert secret.status_code == 422
    assert "sk-live-example" not in _stored_text(migrated)
    created = client.post(_requests(seeded, project_id), json=_draft())
    pending = _move(
        client, seeded, project_id, created.json()["id"], _draft(), "APPROVAL_PENDING", 1
    )
    changed = _move(
        client,
        seeded,
        project_id,
        created.json()["id"],
        {**_draft(), "recipient": "changed@example.com"},
        "APPROVAL_PENDING",
        pending["version"],
    )
    assert changed.status_code == 409
    assert changed.json()["detail"] == "pbc recipient is bound"
    cancelled = _move(
        client,
        seeded,
        project_id,
        created.json()["id"],
        _draft(),
        "CANCELLED",
        pending["version"],
        cancellation_reason="The sample period changed",
    )
    assert cancelled["status"] == "CANCELLED"
    assert cancelled["cancellation_reason"] == "The sample period changed"
    finished = _move(
        client,
        seeded,
        project_id,
        created.json()["id"],
        _draft(),
        "CLOSED",
        cancelled["version"],
    )
    assert finished["status"] == "CLOSED"
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'PAUSED' WHERE id = %s",
            (project_id,),
        )
        connection.commit()
    kept = _move(
        client, seeded, project_id, created.json()["id"], _draft(), "CLOSED", finished["version"]
    )
    assert kept["status"] == "CLOSED"
    paused = client.post(_requests(seeded, project_id), json=_draft("paused-request"))
    assert paused.status_code == 409
    assert paused.json()["detail"] == "project is not active"
    foreign = client.post(
        f"/organizations/{uuid4()}/projects/{project_id}/pbc-requests",
        json=_draft("foreign"),
    )
    assert foreign.status_code == 404
    anonymous = TestClient(create_app(Settings()))
    assert anonymous.post(_requests(seeded, project_id), json=_draft("anon")).status_code == 401
    assert _message_count(migrated) == 0


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _move(
    client: TestClient,
    seeded: dict[str, Any],
    project_id: UUID,
    request_id: str,
    fields: dict[str, Any],
    status: str,
    version: int,
    **extra: Any,
) -> Any:
    payload = {
        "version": version,
        "status": status,
        "recipient": fields["recipient"],
        "due_at": fields["due_at"],
        "evidence_description": fields["evidence_description"],
        "control_ref": fields["control_ref"],
        "attachment_refs": extra.get("attachment_refs", fields.get("attachment_refs", [])),
        "follow_up_after_days": 3,
        "max_follow_ups": 2,
        "cancellation_reason": extra.get("cancellation_reason", ""),
    }
    if "outbound_message_id" in extra:
        payload["outbound_message_id"] = extra["outbound_message_id"]
        payload["thread_id"] = extra["thread_id"]
    response = client.post(f"{_requests(seeded, project_id)}/{request_id}", json=payload)
    if response.status_code == 200:
        return response.json()
    return response


def _draft(operation_key: str = "population-2026") -> dict[str, Any]:
    return {
        "operation_key": operation_key,
        "control_ref": "control/access-review",
        "recipient": "client@example.com",
        "due_at": _DUE,
        "evidence_description": "The population of new accounts for the period",
        "attachment_refs": [],
        "follow_up_after_days": 3,
        "max_follow_ups": 2,
    }


def _requests(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/pbc-requests"


def _audit_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT payload::text FROM audit_events").fetchall()
    return str(rows)


def _stored_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT coalesce(evidence_description, '') || coalesce(recipient, '')
            FROM pbc_requests
            """
        ).fetchall()
    return str(rows)


def _message_count(database: Database) -> int:
    with connect(database.url) as connection:
        row = connection.execute("SELECT count(*) FROM mailbox_messages").fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]
