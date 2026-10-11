from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_execution import _ready

from ai_workforce_api.auth import token_hash
from ai_workforce_api.authorization import NotVisible
from ai_workforce_api.db import connect
from ai_workforce_api.mailbox import (
    MOCK_SENDER,
    AttachmentDraft,
    MailboxState,
    MailboxUnavailable,
    MockMailbox,
    mailbox_is_intended,
    open_mailbox,
)
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def test_the_mock_mailbox_records_and_reconciles(migrated: Database) -> None:
    seeded, project_id, _owner = _ready(migrated, "mailbox")
    attachment = AttachmentDraft("evidence/population.csv", "population.csv", "text/csv", 128)
    with connect(migrated.url) as connection:
        mailbox = MockMailbox(connection, seeded["organization_id"], project_id)
        sent = mailbox.send(
            idempotency_key="send-1",
            recipient="audit@example.com",
            subject="Population request",
            body="request/population",
            thread_id="thread-population",
            attachments=(attachment,),
        )
        repeat = mailbox.send(
            idempotency_key="send-1",
            recipient="other@example.com",
            subject="A different subject",
            body="",
            thread_id=None,
        )
        draft = mailbox.create_draft(
            idempotency_key="draft-1",
            recipient="audit@example.com",
            subject="Population draft",
            body="",
            thread_id="thread-population",
        )
        assert sent.status == "ACCEPTED"
        assert sent.sender == MOCK_SENDER
        assert repeat.provider_message_id == sent.provider_message_id
        assert repeat.recipient == "audit@example.com"
        assert draft.status == "DRAFT"
        thread = mailbox.read_thread("thread-population")
        assert [item.provider_message_id for item in thread] == [
            sent.provider_message_id,
            draft.provider_message_id,
        ]
        found = mailbox.search("population")
        assert found[0].body == ""
        assert mailbox.search("") == ()
        stored = mailbox.retrieve_attachment("evidence/population.csv")
        assert stored.size_bytes == 128
        assert stored.file_name == "population.csv"
        notice = mailbox.receive_notification("notice-1", sent.provider_message_id, "created")
        again = mailbox.receive_notification("notice-1", draft.provider_message_id, "updated")
        assert again.id == notice.id
        assert again.kind == "created"
        reconciled = mailbox.reconcile((sent.provider_message_id, "mock-missing"))
        assert reconciled.status == "reconciled"
        assert reconciled.message_count == 2
        assert reconciled.missing_message_ids == ("mock-missing",)
        with pytest.raises(MailboxState):
            mailbox.send(
                idempotency_key="secret",
                recipient="audit@example.com",
                subject="api_key=sk-live-example",
                body="",
                thread_id=None,
            )
        with pytest.raises(NotVisible):
            mailbox.read_message("mock-missing")
    assert "sk-live-example" not in _stored_text(migrated)
    with connect(migrated.url) as connection:
        try:
            with connection.transaction():
                connection.execute("UPDATE mailbox_messages SET subject = 'changed'")
        except psycopg.Error as error:
            assert "immutable" in str(error)
        else:
            raise AssertionError("mailbox update should fail")
    source = Path(__file__).parents[1].joinpath("ai_workforce_api", "mailbox.py").read_text()
    assert "smtplib" not in source
    assert "msal" not in source


def test_a_named_provider_does_not_send(migrated: Database) -> None:
    seeded, project_id, _owner = _ready(migrated, "closed-mail")
    settings = Settings(
        database_url=migrated.url, session_cookie_secure=False, email_provider="graph"
    )
    with connect(migrated.url) as connection:
        with pytest.raises(MailboxUnavailable):
            open_mailbox(settings, connection, seeded["organization_id"], project_id).send(
                idempotency_key="blocked",
                recipient="audit@example.com",
                subject="Population request",
                body="",
                thread_id=None,
            )
    client = _client(migrated, seeded["user_id"], settings)
    refused = client.post(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}/actions/execute",
        json={
            "action_id": "mail.draft",
            "parameters": {"recipient": "audit@example.com", "subject": "Population request"},
        },
    )
    assert refused.status_code == 200
    assert refused.json()["status"] == "REFUSED"
    assert refused.json()["reason"] == "live_email_disabled"
    assert _message_count(migrated) == 0
    assert client.get("/health").json()["live_email_enabled"] is False


def test_mailbox_configuration_stays_closed(migrated: Database) -> None:
    seeded, _project_id, _owner = _ready(migrated, "config")
    secret = "client-secret-value"
    address = "sox-mailbox@example.com"
    incomplete = Settings(database_url=migrated.url, session_cookie_secure=False)
    anonymous = TestClient(create_app(incomplete))
    assert anonymous.get("/mailbox/configuration").status_code == 401
    signer = _client(migrated, seeded["user_id"], incomplete)
    closed = signer.get("/mailbox/configuration")
    assert closed.status_code == 200
    assert closed.json() == {
        "provider": "mock",
        "configuration_complete": False,
        "shared_mailbox_restricted": False,
        "live_email_enabled": False,
    }
    assert mailbox_is_intended(incomplete, address) is False
    ready = Settings(
        database_url=migrated.url,
        session_cookie_secure=False,
        email_live_send_enabled=True,
        email_provider="graph",
        graph_tenant_id="tenant",
        graph_client_id="application",
        graph_client_secret=secret,
        shared_mailbox_address=address,
    )
    assert secret not in repr(ready)
    configured = _client(migrated, seeded["user_id"], ready).get("/mailbox/configuration")
    assert configured.json() == {
        "provider": "unavailable",
        "configuration_complete": True,
        "shared_mailbox_restricted": True,
        "live_email_enabled": False,
    }
    assert secret not in configured.text
    assert address not in configured.text
    assert mailbox_is_intended(ready, address) is True
    assert mailbox_is_intended(ready, "other@example.com") is False


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _client(database: Database, user_id: object, settings: Settings) -> TestClient:
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (%s, %s, clock_timestamp() + interval '1 hour')
            """,
            (user_id, token_hash(token)),
        )
        connection.commit()
    return TestClient(create_app(settings), cookies={"aw_session": token})


def _message_count(database: Database) -> int:
    with connect(database.url) as connection:
        row = connection.execute("SELECT count(*) FROM mailbox_messages").fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _stored_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT subject || body FROM mailbox_messages
            UNION ALL
            SELECT payload::text FROM audit_events
            """
        ).fetchall()
    return str(rows)
