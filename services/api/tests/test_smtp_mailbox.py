"""Live email over SMTP (decided by the product owner): send only, only to allowlisted
domains, and only when every condition holds. A message is sent once and recorded like
the mock's. These tests never open a network connection: the sender is replaced."""

from email.message import EmailMessage
from types import SimpleNamespace
from typing import Any

import pytest
from support import Database
from test_onboarding import _new_engagement
from test_outbound import migrated

from ai_workforce_api.db import connect
from ai_workforce_api.invitations import send_welcomes
from ai_workforce_api.mailbox import (
    MailboxState,
    UnavailableMailbox,
    live_send_enabled,
    mailbox_configuration,
    open_mailbox,
)
from ai_workforce_api.outbound import recipients_allowed
from ai_workforce_api.settings import Settings
from ai_workforce_api.smtp_mailbox import (
    RecipientNotAllowed,
    SmtpMailbox,
    message_id,
    smtp_live,
)

__all__ = ["migrated"]

PASSWORD = "app-password-not-real"


def _live(url: str = "", **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": url,
        "email_provider": "gmail",
        "email_live_send_enabled": True,
        "smtp_host": "smtp.example.test",
        "smtp_port": 465,
        "smtp_user": "sender@example.test",
        "smtp_password": PASSWORD,
        "email_from": "agents@example.test",
        "email_allowed_recipient_domains": "client.example, Example.org",
    }
    values.update(overrides)
    return Settings(**values)


class _Sent:
    """Stands in for the SMTP server: keeps what it was handed."""

    def __init__(self) -> None:
        self.messages: list[EmailMessage] = []

    def __call__(self, settings: Settings, message: EmailMessage) -> None:
        del settings
        self.messages.append(message)


def _recorded(database: Database, project: Any) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", (project,)
        ).fetchone()
    return 0 if row is None else int(row[0])


def test_live_email_needs_every_condition() -> None:
    assert smtp_live(_live()) and live_send_enabled(_live())
    for change in (
        {"email_live_send_enabled": False},
        {"email_provider": "mock"},
        {"email_provider": "graph"},
        {"smtp_host": ""},
        {"smtp_user": ""},
        {"smtp_password": ""},
        {"email_from": "not an address"},
        # No allowlist, no live email: nothing reaches an address no one chose.
        {"email_allowed_recipient_domains": ""},
        {"email_allowed_recipient_domains": "not a domain"},
    ):
        assert not smtp_live(_live(**change)), change
    status = mailbox_configuration(_live())
    assert status.provider == "smtp" and status.live_email_enabled is True
    assert mailbox_configuration(_live(email_live_send_enabled=False)).provider == "unavailable"
    # The credentials never leave the process.
    shown = status.model_dump_json() + repr(_live())
    assert PASSWORD not in shown and "sender@example.test" not in shown


def test_a_live_message_is_sent_once_and_recorded(migrated: Database) -> None:
    team = _new_engagement(migrated, "smtp-send")
    sent = _Sent()
    settings = _live(migrated.url)
    with connect(migrated.url) as connection:
        box = SmtpMailbox(settings, connection, team["org"], team["project"], sender=sent)
        first = box.send(
            idempotency_key="outbound:one",
            recipient="owner@client.example",
            subject="Evidence for ITGC-AC-01",
            body="Please provide the user access listing.",
            thread_id=None,
            cc=("lead@example.org",),
        )
        # The same send again, as a retry would make it: nothing goes out twice.
        again = box.send(
            idempotency_key="outbound:one",
            recipient="owner@client.example",
            subject="Evidence for ITGC-AC-01",
            body="Please provide the user access listing.",
            thread_id=None,
            cc=("lead@example.org",),
        )
    assert len(sent.messages) == 1
    message = sent.messages[0]
    assert message["From"] == "agents@example.test"
    assert message["To"] == "owner@client.example"
    assert message["Cc"] == "lead@example.org"
    assert message["Subject"] == "Evidence for ITGC-AC-01"
    assert message["Message-ID"] == message_id(settings, "outbound:one")
    plain = message.get_body(preferencelist=("plain",))
    assert plain is not None
    assert "Please provide the user access listing." in plain.get_content()
    assert first.status == "ACCEPTED" and again.id == first.id
    assert _recorded(migrated, team["project"]) == 1


def test_a_recipient_outside_the_allowed_domains_is_refused(migrated: Database) -> None:
    team = _new_engagement(migrated, "smtp-refuse")
    sent = _Sent()
    with connect(migrated.url) as connection:
        box = SmtpMailbox(
            _live(migrated.url), connection, team["org"], team["project"], sender=sent
        )
        for recipient, cc in (
            ("someone@realcompany.com", ()),
            ("owner@client.example", ("boss@realcompany.com",)),
            ("owner@sub.client.example", ()),
        ):
            with pytest.raises(RecipientNotAllowed):
                box.send(
                    idempotency_key=f"outbound:{recipient}:{len(cc)}",
                    recipient=recipient,
                    subject="Evidence",
                    body="Body",
                    thread_id=None,
                    cc=cc,
                )
        # A header cannot be smuggled in through the subject.
        with pytest.raises(MailboxState):
            box.send(
                idempotency_key="outbound:header",
                recipient="owner@client.example",
                subject="Evidence\nBcc: everyone@realcompany.com",
                body="Body",
                thread_id=None,
            )
    assert sent.messages == []
    assert _recorded(migrated, team["project"]) == 0
    # Submitting a request is refused the same way when someone copied is outside them.
    settings = _live(migrated.url)
    allowed = SimpleNamespace(recipient="owner@client.example", cc=("lead@example.org",))
    copied = SimpleNamespace(recipient="owner@client.example", cc=("boss@realcompany.com",))
    assert recipients_allowed(settings, allowed) is True
    assert recipients_allowed(settings, copied) is False


def test_the_live_mailbox_is_used_only_when_ready(migrated: Database) -> None:
    team = _new_engagement(migrated, "smtp-open")
    with connect(migrated.url) as connection:
        ready = open_mailbox(_live(migrated.url), connection, team["org"], team["project"])
        off = open_mailbox(
            _live(migrated.url, email_live_send_enabled=False),
            connection,
            team["org"],
            team["project"],
        )
    assert isinstance(ready, SmtpMailbox)
    assert isinstance(off, UnavailableMailbox)


def test_a_held_welcome_email_is_sent_once_live_email_is_on(migrated: Database) -> None:
    team = _new_engagement(migrated, "smtp-welcome")
    with connect(migrated.url) as connection:
        for user, email in (
            (team["owner_id"], "new.preparer@example.org"),
            (team["reviewer_id"], "someone@realcompany.com"),
        ):
            connection.execute(
                """
                INSERT INTO invitations (
                    organization_id, project_id, user_id, email, invited_by,
                    organization_role, engagement_role, welcome_subject, welcome_body
                )
                VALUES (%s, %s, %s, %s, %s, 'CONTRIBUTOR', 'PREPARER', 'Welcome', 'Hello')
                """,
                (team["org"], team["project"], user, email, team["owner_id"]),
            )
        connection.commit()
        sent = _Sent()
        # Live email off: everything stays held.
        off = _live(migrated.url, email_live_send_enabled=False)
        assert send_welcomes(connection, off, team["org"], team["project"], sender=sent) == (0, 0)
        settings = _live(migrated.url)
        assert send_welcomes(connection, settings, team["org"], team["project"], sender=sent) == (
            1,
            1,
        )
        # Sent once: the held one outside the domains is tried again, the sent one never.
        assert send_welcomes(connection, settings, team["org"], team["project"], sender=sent) == (
            0,
            1,
        )
        statuses = dict(
            connection.execute(
                "SELECT email, welcome_status FROM invitations WHERE project_id = %s",
                (team["project"],),
            ).fetchall()
        )
    assert [message["To"] for message in sent.messages] == ["new.preparer@example.org"]
    assert statuses == {
        "new.preparer@example.org": "SENT",
        "someone@realcompany.com": "HELD",
    }


def test_sending_held_welcomes_is_refused_while_live_email_is_off(migrated: Database) -> None:
    team = _new_engagement(migrated, "smtp-route")
    refused = team["owner"].post(
        f"/organizations/{team['org']}/projects/{team['project']}/onboarding/team/welcomes/send"
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "live email is off"
    # The health check says the same.
    assert team["owner"].get("/health").json()["live_email_enabled"] is False


REQUEST_TEXT = """Hello,

The audit team for FY 2026 Audit is requesting the evidence below.

Request: PBC-92E257FD
Control: ITGC-CM-01
Due: 28 October 2026

Evidence requested:
We are starting interim testing of control ITGC-CM-01 <script>alert(1)</script>.

1. Every production change, 1 Jan to 30 Sep 2026
   Please provide a complete, system-generated list of every production change.
   Period: 1 January 2026 to 30 September 2026
   Include: Change identifier; Change title; Status
   Format: Excel or CSV export

Questions for you:
- Which system holds the deployment log?

Upload the evidence through your secure link:
https://evidence.example.test/upload/abc123

Thank you."""


def test_a_live_email_carries_the_approved_text_and_a_laid_out_copy() -> None:
    from ai_workforce_api.email_html import to_html
    from ai_workforce_api.smtp_mailbox import build

    message = build(
        _live(),
        idempotency_key="outbound:html",
        recipient="owner@client.example",
        cc=(),
        subject="[PBC-92E257FD] Evidence request: ITGC-CM-01",
        body=REQUEST_TEXT,
    )
    assert message.get_content_type() == "multipart/alternative"
    text = message.get_body(preferencelist=("plain",))
    page = message.get_body(preferencelist=("html",))
    assert text is not None and page is not None
    # The approved words, unchanged, as the plain part.
    assert text.get_content().replace("\r\n", "\n").rstrip("\n") == REQUEST_TEXT
    rendered = page.get_content()
    # Nothing in the text runs as markup.
    assert "<script>" not in rendered and "&lt;script&gt;" in rendered
    # The summary, the item, its details as a list, the questions, and the link button.
    assert ">PBC-92E257FD<" in rendered and ">28 October 2026<" in rendered
    assert "Every production change, 1 Jan to 30 Sep 2026" in rendered
    assert "<li" in rendered and "Change identifier" in rendered
    assert "Which system holds the deployment log?" in rendered
    assert 'href="https://evidence.example.test/upload/abc123"' in rendered
    assert "Open the secure upload page" in rendered
    # The header names the request without its reference tag.
    assert "<p" in rendered and "Evidence request: ITGC-CM-01</p>" in rendered
    # A sentence ending in a colon stays a sentence; a code is shown on its own.
    code = to_html("Your code", "Hello,\n\nYour code for FY 2026 Audit is:\n\n482913\n")
    assert "Your code for FY 2026 Audit is:</p>" in code and ">482913<" in code


def test_links_sent_outside_the_app_use_the_public_address() -> None:
    from ai_workforce_api.evidence_portal import link_url

    local = Settings(app_base_url="http://localhost:3000/")
    assert link_url(local, "abc") == "http://localhost:3000/upload/abc"
    shared = Settings(app_base_url="http://localhost:3000", public_base_url="http://10.0.0.5:3000/")
    assert link_url(shared, "abc") == "http://10.0.0.5:3000/upload/abc"
    assert shared.link_base_url() == "http://10.0.0.5:3000"
