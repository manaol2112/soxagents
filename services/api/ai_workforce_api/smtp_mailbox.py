"""Live email over SMTP (decided by the product owner): send only, to allowlisted domains.

Live sending needs every one of these, or the mailbox stays unavailable:

- `EMAIL_PROVIDER` is `smtp` or `gmail`;
- `EMAIL_LIVE_SEND_ENABLED` is true;
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and a valid `EMAIL_FROM` are set;
- `EMAIL_ALLOWED_RECIPIENT_DOMAINS` names at least one domain. Live mail goes only to
  those domains, the copied people included: anything else is refused before the
  connection opens.

A sent message is recorded like the mock's (mailbox_messages), so idempotency, threads,
and reconciliation work the same: a key already recorded is never sent again. The message
is recorded only after the server accepts it; when the outcome is unknown, outbound's own
reconciliation decides. Replies are not read: they arrive in the account's inbox, and
evidence comes through the secure upload link. The password is never logged or returned.
"""

import hashlib
import logging
import re
import smtplib
import ssl
from collections.abc import Mapping
from email.message import EmailMessage
from email.utils import formatdate
from typing import Any
from uuid import UUID

import psycopg

from ai_workforce_api.email_html import to_html
from ai_workforce_api.mailbox import (
    AttachmentDraft,
    MailboxState,
    MailMessage,
    MockMailbox,
)
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

SMTP_PROVIDERS = frozenset({"smtp", "gmail"})
TIMEOUT_SECONDS = 30
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_DOMAIN = re.compile(r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9-]{1,63})+$")
_HEADER_UNSAFE = re.compile(r"[\r\n]")


class RecipientNotAllowed(MailboxState):
    """A recipient is outside the domains live email may reach."""

    def __init__(self) -> None:
        super().__init__("a recipient is outside the allowed email domains")


def uses_smtp(settings: Settings) -> bool:
    return settings.email_provider.strip().lower() in SMTP_PROVIDERS


def allowed_domains(settings: Settings) -> frozenset[str]:
    items = {item.strip().lower() for item in settings.email_allowed_recipient_domains.split(",")}
    return frozenset(item for item in items if _DOMAIN.fullmatch(item) is not None)


def smtp_configured(settings: Settings) -> bool:
    return (
        settings.smtp_host.strip() != ""
        and 0 < settings.smtp_port < 65536
        and settings.smtp_user.strip() != ""
        and settings.smtp_password != ""
        and _EMAIL.fullmatch(settings.email_from.strip()) is not None
    )


def smtp_live(settings: Settings) -> bool:
    """Every condition for live sending holds."""
    return (
        uses_smtp(settings)
        and settings.email_live_send_enabled
        and smtp_configured(settings)
        and len(allowed_domains(settings)) > 0
    )


def address_allowed(settings: Settings, address: str) -> bool:
    clean = address.strip().lower()
    if _EMAIL.fullmatch(clean) is None:
        return False
    return clean.rsplit("@", 1)[1] in allowed_domains(settings)


def message_id(settings: Settings, idempotency_key: str) -> str:
    """The same key always makes the same Message-ID, so a mail client can tell a repeat."""
    digest = hashlib.sha256(idempotency_key.encode()).hexdigest()[:32]
    domain = settings.email_from.strip().rsplit("@", 1)[-1]
    return f"<{digest}@{domain}>"


def build(
    settings: Settings,
    *,
    idempotency_key: str,
    recipient: str,
    cc: tuple[str, ...],
    subject: str,
    body: str,
    reply_to: str = "",
) -> EmailMessage:
    if _HEADER_UNSAFE.search(subject) or any(
        _HEADER_UNSAFE.search(item) for item in (recipient, *cc, reply_to)
    ):
        raise MailboxState("mailbox fields are invalid")
    if reply_to.strip() and _EMAIL.fullmatch(reply_to.strip()) is None:
        raise MailboxState("mailbox fields are invalid")
    message = EmailMessage()
    message["From"] = settings.email_from.strip()
    message["To"] = recipient.strip()
    if cc:
        message["Cc"] = ", ".join(item.strip() for item in cc)
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = message_id(settings, idempotency_key)
    if reply_to.strip():
        message["Reply-To"] = reply_to.strip()
    # The approved text, word for word, and the same words laid out for a mail client.
    message.set_content(body)
    message.add_alternative(to_html(subject, body), subtype="html")
    return message


def deliver(settings: Settings, message: EmailMessage) -> None:
    """Hand the message to the SMTP server. Raises on any failure; the outcome of a
    failure after the server accepted the message is unknown to the caller."""
    context = ssl.create_default_context()
    host, port = settings.smtp_host.strip(), settings.smtp_port
    client: smtplib.SMTP
    if settings.smtp_secure:
        client = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_SECONDS, context=context)
    else:
        client = smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS)
    with client:
        if not settings.smtp_secure:
            client.starttls(context=context)
        client.login(settings.smtp_user.strip(), settings.smtp_password)
        client.send_message(message)


Sender = Any  # (settings, EmailMessage) -> None, replaceable in tests


def _deliverer() -> Sender:
    """The module's deliver, looked up when sending, so a test can replace it."""
    return deliver


class SmtpMailbox(MockMailbox):
    """The mock's records, with the message delivered over SMTP first."""

    def __init__(
        self,
        settings: Settings,
        connection: psycopg.Connection[Any],
        organization_id: UUID,
        project_id: UUID,
        sender: Sender | None = None,
    ) -> None:
        super().__init__(connection, organization_id, project_id)
        self._settings = settings
        self._sender = sender

    def send(
        self,
        *,
        idempotency_key: str,
        recipient: str,
        subject: str,
        body: str,
        thread_id: str | None,
        attachments: tuple[AttachmentDraft, ...] = (),
        metadata: Mapping[str, str] | None = None,
        cc: tuple[str, ...] = (),
    ) -> MailMessage:
        if attachments:
            # Evidence goes the other way, through the secure link; nothing is attached.
            raise MailboxState("mailbox fields are invalid")
        if not all(address_allowed(self._settings, item) for item in (recipient, *cc)):
            raise RecipientNotAllowed()
        existing = self.lookup(idempotency_key)
        if existing is not None:
            return existing
        (self._sender or _deliverer())(
            self._settings,
            build(
                self._settings,
                idempotency_key=idempotency_key,
                recipient=recipient,
                cc=cc,
                subject=subject,
                body=body,
            ),
        )
        return super().send(
            idempotency_key=idempotency_key,
            recipient=recipient,
            subject=subject,
            body=body,
            thread_id=thread_id,
            metadata=metadata,
            cc=cc,
        )


def send_direct(
    settings: Settings,
    *,
    idempotency_key: str,
    recipient: str,
    subject: str,
    body: str,
    reply_to: str = "",
    sender: Sender | None = None,
) -> None:
    """Send one email that belongs to no engagement (a welcome email), under the same
    rules. Raises RecipientNotAllowed or MailboxState; the caller records the outcome."""
    if not smtp_live(settings):
        raise MailboxState("live email is not configured")
    if not address_allowed(settings, recipient):
        raise RecipientNotAllowed()
    (sender or _deliverer())(
        settings,
        build(
            settings,
            idempotency_key=idempotency_key,
            recipient=recipient,
            cc=(),
            subject=subject,
            body=body,
            reply_to=reply_to,
        ),
    )
