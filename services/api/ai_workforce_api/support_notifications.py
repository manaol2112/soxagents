"""Notifications to the firm's own support address (migration 0123).

Decided by the product owner on 27 October 2026: every demo request from the landing page
and every new sign-up emails `SUPPORT_NOTIFY_EMAIL` (support@auditworkforce.ai), which
forwards to the owner. A notification is recorded in the same transaction as the event,
so it exists exactly when the event does; it is sent after the visitor has their answer,
under the live-email rules (smtp_mailbox.send_direct: the allowed domains, a fixed
Message-ID per notification). It is marked sent only once the mail server accepts it. A
failure stays held and is tried again with the next notification, at most a few times.

Everything in a notification comes from a public form or a sign-in, so it is plain text,
cut to length, and never carries a header a visitor could steer: the visitor's address is
only the Reply-To, and only when it is a valid address.
"""

import logging
from typing import Any, Literal
from uuid import UUID

import psycopg

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

Kind = Literal["DEMO_REQUEST", "SIGN_UP"]
MAX_ATTEMPTS = 5
# A claim older than this is a send that never finished; it may be tried again.
STALE_CLAIM = "10 minutes"


def enabled(settings: Settings) -> bool:
    return settings.support_notify_email.strip() != ""


def record(
    cursor: psycopg.Cursor[Any],
    settings: Settings,
    *,
    kind: Kind,
    subject_id: UUID,
    subject: str,
    body: str,
    reply_to: str = "",
) -> bool:
    """Hold one notification for an event, in the event's own transaction. Nothing is
    recorded when no support address is configured. Returns whether one was recorded."""
    if not enabled(settings):
        return False
    cursor.execute(
        """
        INSERT INTO support_notifications (kind, subject_id, recipient, reply_to, subject, body)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (kind, subject_id) DO NOTHING
        """,
        (
            kind,
            subject_id,
            settings.support_notify_email.strip()[:200],
            reply_to.strip()[:200],
            clean_line(subject, 200) or "Audit Workforce notification",
            body[:6000],
        ),
    )
    return True


def deliver_held(settings: Settings, sender: Any = None) -> tuple[int, int]:
    """Send every notification still held, oldest first. Returns (sent, not sent). Never
    raises: a visitor's request has already been answered when this runs."""
    if settings.database_url == "" or not enabled(settings):
        return 0, 0
    try:
        with connect(settings.database_url) as connection:
            return _deliver(connection, settings, sender)
    except psycopg.Error:
        logger.warning("support notifications could not be read")
        return 0, 0


def _deliver(
    connection: psycopg.Connection[Any], settings: Settings, sender: Any
) -> tuple[int, int]:
    from ai_workforce_api.mailbox import MailboxState
    from ai_workforce_api.smtp_mailbox import send_direct, smtp_live

    if not smtp_live(settings):
        return 0, 0
    with transaction(connection) as cursor:
        # Claimed under a lock, so two senders never mail the same notification.
        claimed = cursor.execute(
            f"""
            UPDATE support_notifications
            SET status = 'SENDING', claimed_at = clock_timestamp(), attempts = attempts + 1
            WHERE id IN (
                SELECT id FROM support_notifications
                WHERE attempts < %s
                  AND (status = 'HELD'
                       OR (status = 'SENDING'
                           AND claimed_at < clock_timestamp() - interval '{STALE_CLAIM}'))
                ORDER BY created_at
                LIMIT 20
                FOR UPDATE SKIP LOCKED
            )
            RETURNING created_at, id, recipient, reply_to, subject, body
            """,
            (MAX_ATTEMPTS,),
        ).fetchall()
    sent = failed = 0
    # RETURNING keeps no order: oldest first, as they happened.
    for _, notification_id, recipient, reply_to, subject, body in sorted(
        claimed, key=lambda row: row[0]
    ):
        try:
            send_direct(
                settings,
                idempotency_key=f"support:{notification_id}",
                recipient=str(recipient),
                subject=str(subject),
                body=str(body),
                reply_to=str(reply_to),
                sender=sender,
            )
        except MailboxState as error:
            logger.warning("a support notification was not sent: %s", error)
            _release(connection, notification_id)
            failed += 1
            continue
        except Exception:
            logger.warning("a support notification could not be sent")
            _release(connection, notification_id)
            failed += 1
            continue
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE support_notifications SET status = 'SENT', sent_at = clock_timestamp() "
                "WHERE id = %s AND status = 'SENDING'",
                (notification_id,),
            )
        sent += 1
    return sent, failed


def _release(connection: psycopg.Connection[Any], notification_id: UUID) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE support_notifications SET status = 'HELD', claimed_at = NULL "
            "WHERE id = %s AND status = 'SENDING'",
            (notification_id,),
        )


def demo_request_text(*, name: str, email: str, firm: str, message: str) -> tuple[str, str]:
    """The subject and body for a demo request."""
    who = f"{name} ({firm})" if firm else name
    lines = [
        "A demo request came in from the landing page.",
        "",
        f"Name: {name}",
        f"Work email: {email}",
        f"Company or firm: {firm or 'Not given'}",
    ]
    if message:
        lines += ["", message]
    lines += ["", "Reply to this email to answer them directly."]
    return f"Demo request from {who}", "\n".join(lines)


def sign_up_text(*, name: str, email: str, workspace: str, provider: str) -> tuple[str, str]:
    """The subject and body for a new account that created its own workspace."""
    lines = [
        "Someone signed up and a workspace was created for them.",
        "",
        f"Name: {name or 'Not given'}",
        f"Email: {email}",
        f"Workspace: {workspace}",
        f"Signed in with: {provider}",
    ]
    return f"New sign-up: {name or email}", "\n".join(lines)
