"""Demo requests and new sign-ups are announced to the firm's support address (migration
0123): recorded with the event, sent after the answer, once, under the live-email rules."""

from email.message import EmailMessage
from typing import Any

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_google import FakeProvider
from test_outbound import migrated

from ai_workforce_api import smtp_mailbox
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.identity import Identity
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings
from ai_workforce_api.support_notifications import deliver_held

__all__ = ["migrated"]

SUPPORT = "support@auditworkforce.example"


def _settings(url: str, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": url,
        "session_cookie_secure": False,
        "app_base_url": "",
        "google_redirect_url": "http://localhost:8000/auth/google/callback",
        "email_provider": "gmail",
        "email_live_send_enabled": True,
        "smtp_host": "smtp.example.test",
        "smtp_port": 465,
        "smtp_user": "sender@auditworkforce.example",
        "smtp_password": "app-password-not-real",
        "email_from": "agents@auditworkforce.example",
        "email_allowed_recipient_domains": "auditworkforce.example",
        "support_notify_email": SUPPORT,
    }
    values.update(overrides)
    return Settings(**values)


class _Server:
    """Stands in for the SMTP server: keeps what it accepts, or refuses while down."""

    def __init__(self) -> None:
        self.messages: list[EmailMessage] = []
        self.down = False

    def __call__(self, settings: Settings, message: EmailMessage) -> None:
        del settings
        if self.down:
            raise OSError("connection refused")
        self.messages.append(message)


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch) -> _Server:
    fake = _Server()
    monkeypatch.setattr(smtp_mailbox, "deliver", fake)
    return fake


def _rows(url: str) -> list[tuple[Any, ...]]:
    with connect(url) as connection:
        return list(
            connection.execute(
                "SELECT kind, status, attempts, recipient, reply_to FROM support_notifications "
                "ORDER BY created_at"
            ).fetchall()
        )


def _demo(client: TestClient, **overrides: str) -> Any:
    body = {
        "name": "Pat Lee",
        "email": "Pat@Firm.Example",
        "firm": "Firm LLP",
        "message": "Primary focus: IT SOX / ITGC",
        **overrides,
    }
    return client.post("/public/demo-requests", json=body)


def test_a_demo_request_is_emailed_to_support_once_with_a_reply_to(
    migrated: Database, server: _Server
) -> None:
    client = TestClient(create_app(_settings(migrated.url)))
    left = _demo(client)
    assert left.status_code == 201, left.text
    assert len(server.messages) == 1
    sent = server.messages[0]
    assert sent["To"] == SUPPORT
    assert sent["Reply-To"] == "pat@firm.example"
    assert sent["Subject"] == "Demo request from Pat Lee (Firm LLP)"
    text = sent.get_body(preferencelist=("plain",))
    assert text is not None
    content = text.get_content()
    assert "Work email: pat@firm.example" in content
    assert "Primary focus: IT SOX / ITGC" in content
    assert _rows(migrated.url) == [("DEMO_REQUEST", "SENT", 1, SUPPORT, "pat@firm.example")]
    # Delivering again sends nothing more.
    assert deliver_held(_settings(migrated.url)) == (0, 0)
    assert len(server.messages) == 1


def test_a_failed_send_stays_held_and_goes_with_the_next_one(
    migrated: Database, server: _Server
) -> None:
    client = TestClient(create_app(_settings(migrated.url)))
    server.down = True
    assert _demo(client).status_code == 201
    assert server.messages == []
    assert _rows(migrated.url)[0][:3] == ("DEMO_REQUEST", "HELD", 1)
    server.down = False
    assert _demo(client, email="sam@firm.example", name="Sam Roe").status_code == 201
    assert [m["Subject"] for m in server.messages] == [
        "Demo request from Pat Lee (Firm LLP)",
        "Demo request from Sam Roe (Firm LLP)",
    ]
    assert [row[1] for row in _rows(migrated.url)] == ["SENT", "SENT"]


def test_nothing_is_recorded_without_a_support_address_or_for_a_bot(
    migrated: Database, server: _Server
) -> None:
    quiet = TestClient(create_app(_settings(migrated.url, support_notify_email="")))
    assert _demo(quiet).status_code == 201
    client = TestClient(create_app(_settings(migrated.url)))
    assert _demo(client, website="http://spam.example").status_code == 201
    assert _rows(migrated.url) == []
    assert server.messages == []


def test_a_support_address_outside_the_allowed_domains_is_never_mailed(
    migrated: Database, server: _Server
) -> None:
    client = TestClient(
        create_app(_settings(migrated.url, email_allowed_recipient_domains="client.example"))
    )
    assert _demo(client).status_code == 201
    assert server.messages == []
    assert _rows(migrated.url)[0][1] == "HELD"


def test_a_new_sign_up_is_announced_once_and_an_existing_member_is_not(
    migrated: Database, server: _Server
) -> None:
    identity = Identity(
        subject="109876543210",
        email="dana@firm.example",
        issuer="google",
        display_name="Dana Ruiz",
    )
    client = TestClient(
        create_app(_settings(migrated.url), None, google_identity_provider=FakeProvider(identity))
    )
    for _ in range(2):
        client.get("/auth/google/login", follow_redirects=False)
        signed = client.get(
            "/auth/google/callback?code=good-code&state=google-state", follow_redirects=False
        )
        assert signed.status_code == 200
    assert [m["Subject"] for m in server.messages] == ["New sign-up: Dana Ruiz"]
    body = server.messages[0].get_body(preferencelist=("plain",))
    assert body is not None
    content = body.get_content()
    assert "Workspace: Firm" in content and "Signed in with: Google" in content
    assert _rows(migrated.url) == [("SIGN_UP", "SENT", 1, SUPPORT, "dana@firm.example")]

    # Someone who already belongs to a firm gets no workspace, so no announcement.
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            user = cursor.execute(
                "INSERT INTO users (email, display_name) VALUES ('lee@other.example', 'Lee') "
                "RETURNING id"
            ).fetchone()
            organization = cursor.execute(
                "INSERT INTO organizations (name, slug) VALUES ('Other', 'other') RETURNING id"
            ).fetchone()
            assert user is not None and organization is not None
            cursor.execute(
                "INSERT INTO memberships (organization_id, user_id, role) "
                "VALUES (%s, %s, 'REVIEWER')",
                (organization[0], user[0]),
            )
    member = TestClient(
        create_app(
            _settings(migrated.url),
            None,
            google_identity_provider=FakeProvider(
                Identity(subject="222", email="lee@other.example", issuer="google")
            ),
        )
    )
    member.get("/auth/google/login", follow_redirects=False)
    member.get("/auth/google/callback?code=good-code&state=google-state", follow_redirects=False)
    assert len(server.messages) == 1


def test_a_steered_reply_to_is_refused_by_the_mail_builder() -> None:
    settings = _settings("")
    with pytest.raises(smtp_mailbox.MailboxState):
        smtp_mailbox.build(
            settings,
            idempotency_key="k",
            recipient=SUPPORT,
            cc=(),
            subject="s",
            body="b",
            reply_to="a@b.example\r\nBcc: x@y.example",
        )
    with pytest.raises(smtp_mailbox.MailboxState):
        smtp_mailbox.build(
            settings,
            idempotency_key="k",
            recipient=SUPPORT,
            cc=(),
            subject="s",
            body="b",
            reply_to="not an address",
        )
