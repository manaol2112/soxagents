"""Mock mailbox. This module does not call Microsoft Graph or send live email."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, Request
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.authorization import NotVisible, _session_principal
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

MOCK_SENDER = "shared-mailbox@example.com"
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$")
_MOCK_PROVIDERS = frozenset({"", "mock"})
_METADATA_KEY = re.compile(r"^[a-z][a-z_]{0,40}$")


class MailboxUnavailable(Exception):
    """No live mailbox provider is configured."""


class MailboxState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


@dataclass(frozen=True)
class AttachmentDraft:
    attachment_ref: str
    file_name: str
    content_type: str
    size_bytes: int


@dataclass(frozen=True)
class MailMessage:
    id: UUID
    provider_message_id: str
    thread_id: str
    status: str
    sender: str
    recipient: str
    subject: str
    body: str


@dataclass(frozen=True)
class MailAttachment:
    attachment_ref: str
    file_name: str
    content_type: str
    size_bytes: int


@dataclass(frozen=True)
class MailNotification:
    id: UUID
    notification_key: str
    message_id: UUID
    kind: str


@dataclass(frozen=True)
class MailboxReconcile:
    status: str
    message_count: int
    missing_message_ids: tuple[str, ...]


class MailboxProvider(Protocol):
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
    ) -> MailMessage: ...

    def create_draft(
        self,
        *,
        idempotency_key: str,
        recipient: str,
        subject: str,
        body: str,
        thread_id: str | None,
    ) -> MailMessage: ...

    def read_message(self, provider_message_id: str) -> MailMessage: ...

    def lookup(self, idempotency_key: str) -> MailMessage | None: ...

    def read_thread(self, thread_id: str) -> tuple[MailMessage, ...]: ...

    def search(self, query: str) -> tuple[MailMessage, ...]: ...

    def retrieve_attachment(self, attachment_ref: str) -> MailAttachment: ...

    def receive_notification(
        self, notification_key: str, provider_message_id: str, kind: str
    ) -> MailNotification: ...

    def reconcile(self, known_message_ids: tuple[str, ...]) -> MailboxReconcile: ...


class MailboxConfigurationBody(BaseModel):
    provider: Literal["mock", "unavailable"]
    configuration_complete: bool
    shared_mailbox_restricted: bool
    live_email_enabled: bool


def register_mailbox(app: FastAPI, settings: Settings) -> None:
    @app.get("/mailbox/configuration", response_model=MailboxConfigurationBody)
    def read_configuration(request: Request) -> MailboxConfigurationBody:
        _session_principal(request)
        return mailbox_configuration(settings)


def mailbox_configuration(settings: Settings) -> MailboxConfigurationBody:
    complete = configuration_complete(settings)
    provider: Literal["mock", "unavailable"] = (
        "mock" if settings.email_provider.strip().lower() in _MOCK_PROVIDERS else "unavailable"
    )
    return MailboxConfigurationBody(
        provider=provider,
        configuration_complete=complete,
        shared_mailbox_restricted=complete,
        live_email_enabled=live_send_enabled(settings),
    )


def configuration_complete(settings: Settings) -> bool:
    return (
        _present(settings.graph_tenant_id)
        and _present(settings.graph_client_id)
        and _present(settings.graph_client_secret)
        and _EMAIL.fullmatch(settings.shared_mailbox_address.strip()) is not None
    )


def mailbox_is_intended(settings: Settings, address: str) -> bool:
    configured = settings.shared_mailbox_address.strip().lower()
    if not configuration_complete(settings) or configured == "":
        return False
    return address.strip().lower() == configured


def live_send_enabled(settings: Settings) -> bool:
    """The readiness check reads the flag and still withholds live send."""
    _ = (settings.email_live_send_enabled, configuration_complete(settings))
    return False


def _present(value: str) -> bool:
    text = value.strip()
    return text != "" and len(text) <= 200 and "\n" not in value and "\r" not in value


def open_mailbox(
    settings: Settings,
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
) -> MailboxProvider:
    if settings.email_provider.strip().lower() not in _MOCK_PROVIDERS:
        return UnavailableMailbox()
    return MockMailbox(connection, organization_id, project_id)


class UnavailableMailbox:
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
    ) -> MailMessage:
        raise MailboxUnavailable()

    def create_draft(
        self,
        *,
        idempotency_key: str,
        recipient: str,
        subject: str,
        body: str,
        thread_id: str | None,
    ) -> MailMessage:
        raise MailboxUnavailable()

    def read_message(self, provider_message_id: str) -> MailMessage:
        raise MailboxUnavailable()

    def lookup(self, idempotency_key: str) -> MailMessage | None:
        raise MailboxUnavailable()

    def read_thread(self, thread_id: str) -> tuple[MailMessage, ...]:
        raise MailboxUnavailable()

    def search(self, query: str) -> tuple[MailMessage, ...]:
        raise MailboxUnavailable()

    def retrieve_attachment(self, attachment_ref: str) -> MailAttachment:
        raise MailboxUnavailable()

    def receive_notification(
        self, notification_key: str, provider_message_id: str, kind: str
    ) -> MailNotification:
        raise MailboxUnavailable()

    def reconcile(self, known_message_ids: tuple[str, ...]) -> MailboxReconcile:
        raise MailboxUnavailable()


class MockMailbox:
    def __init__(
        self,
        connection: psycopg.Connection[Any],
        organization_id: UUID,
        project_id: UUID,
    ) -> None:
        self._connection = connection
        self._organization_id = organization_id
        self._project_id = project_id

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
    ) -> MailMessage:
        return self._write(
            "ACCEPTED",
            idempotency_key,
            recipient,
            subject,
            body,
            thread_id,
            attachments,
            metadata or {},
        )

    def create_draft(
        self,
        *,
        idempotency_key: str,
        recipient: str,
        subject: str,
        body: str,
        thread_id: str | None,
    ) -> MailMessage:
        return self._write("DRAFT", idempotency_key, recipient, subject, body, thread_id, (), {})

    def lookup(self, idempotency_key: str) -> MailMessage | None:
        key = idempotency_key.strip()
        if key == "" or len(key) > 200:
            raise MailboxState("mailbox fields are invalid")
        return self._by_key(key)

    def read_message(self, provider_message_id: str) -> MailMessage:
        row = self._connection.execute(
            f"""
            SELECT {_MESSAGE_COLUMNS}
            FROM mailbox_messages
            WHERE project_id = %s AND provider_message_id = %s
            """,
            (self._project_id, provider_message_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        return _message(row)

    def read_thread(self, thread_id: str) -> tuple[MailMessage, ...]:
        if thread_id.strip() == "":
            raise MailboxState("mailbox fields are invalid")
        rows = self._connection.execute(
            f"""
            SELECT {_MESSAGE_COLUMNS}
            FROM mailbox_messages
            WHERE project_id = %s AND thread_id = %s
            ORDER BY created_at, id
            """,
            (self._project_id, thread_id),
        ).fetchall()
        return tuple(_message(row) for row in rows)

    def search(self, query: str) -> tuple[MailMessage, ...]:
        term = query.strip().lower()
        if term == "" or len(term) > 200:
            return ()
        rows = self._connection.execute(
            f"""
            SELECT {_MESSAGE_COLUMNS}
            FROM mailbox_messages
            WHERE project_id = %s
              AND (
                position(%s in lower(subject)) > 0
                OR position(%s in lower(recipient)) > 0
              )
            ORDER BY created_at, id
            LIMIT 20
            """,
            (self._project_id, term, term),
        ).fetchall()
        return tuple(_message_without_body(row) for row in rows)

    def retrieve_attachment(self, attachment_ref: str) -> MailAttachment:
        row = self._connection.execute(
            """
            SELECT attachment_ref, file_name, content_type, size_bytes
            FROM mailbox_attachments
            WHERE project_id = %s AND attachment_ref = %s
            """,
            (self._project_id, attachment_ref),
        ).fetchone()
        if row is None or not isinstance(row[0], str) or not isinstance(row[3], int):
            raise NotVisible()
        return MailAttachment(
            attachment_ref=row[0],
            file_name=str(row[1]),
            content_type=str(row[2]),
            size_bytes=row[3],
        )

    def receive_notification(
        self, notification_key: str, provider_message_id: str, kind: str
    ) -> MailNotification:
        key = notification_key.strip()
        if key == "" or len(key) > 200 or kind not in {"created", "updated"}:
            raise MailboxState("mailbox fields are invalid")
        current = self._notification(key)
        if current is not None:
            return current
        message = self.read_message(provider_message_id)
        try:
            with transaction(self._connection) as cursor:
                row = cursor.execute(
                    """
                    INSERT INTO mailbox_notifications (
                        organization_id, project_id, notification_key, message_id, kind
                    )
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id, notification_key, message_id, kind
                    """,
                    (self._organization_id, self._project_id, key, message.id, kind),
                ).fetchone()
        except UniqueViolation:
            raced = self._notification(key)
            if raced is None:
                raise NotVisible() from None
            return raced
        if row is None:
            raise NotVisible()
        return _notification(row)

    def reconcile(self, known_message_ids: tuple[str, ...]) -> MailboxReconcile:
        rows = self._connection.execute(
            """
            SELECT provider_message_id
            FROM mailbox_messages
            WHERE project_id = %s
            """,
            (self._project_id,),
        ).fetchall()
        stored = {row[0] for row in rows if isinstance(row[0], str)}
        missing = tuple(message_id for message_id in known_message_ids if message_id not in stored)
        return MailboxReconcile(
            status="reconciled", message_count=len(stored), missing_message_ids=missing
        )

    def _write(
        self,
        status: str,
        idempotency_key: str,
        recipient: str,
        subject: str,
        body: str,
        thread_id: str | None,
        attachments: tuple[AttachmentDraft, ...],
        metadata: Mapping[str, str],
    ) -> MailMessage:
        key = idempotency_key.strip()
        clean_recipient = recipient.strip()
        clean_subject = subject.strip()
        clean_body = body.strip()
        thread = uuid4().hex if thread_id is None or thread_id.strip() == "" else thread_id.strip()
        _validate_message(key, clean_recipient, clean_subject, clean_body, thread)
        for attachment in attachments:
            _validate_attachment(attachment)
        _validate_metadata(metadata)
        existing = self._by_key(key)
        if existing is not None:
            return existing
        provider_message_id = f"mock-{uuid4().hex}"
        try:
            with transaction(self._connection) as cursor:
                row = cursor.execute(
                    f"""
                    INSERT INTO mailbox_messages (
                        organization_id, project_id, idempotency_key, provider_message_id,
                        thread_id, status, sender, recipient, subject, body, metadata
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING {_MESSAGE_COLUMNS}
                    """,
                    (
                        self._organization_id,
                        self._project_id,
                        key,
                        provider_message_id,
                        thread,
                        status,
                        MOCK_SENDER,
                        clean_recipient,
                        clean_subject,
                        clean_body,
                        Json(dict(metadata)),
                    ),
                ).fetchone()
                if row is None:
                    raise NotVisible()
                message = _message(row)
                for attachment in attachments:
                    cursor.execute(
                        """
                        INSERT INTO mailbox_attachments (
                            organization_id, project_id, message_id, attachment_ref,
                            file_name, content_type, size_bytes
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            self._organization_id,
                            self._project_id,
                            message.id,
                            attachment.attachment_ref,
                            attachment.file_name,
                            attachment.content_type,
                            attachment.size_bytes,
                        ),
                    )
        except UniqueViolation:
            raced = self._by_key(key)
            if raced is None:
                raise NotVisible() from None
            return raced
        except ForeignKeyViolation:
            raise NotVisible() from None
        return message

    def _by_key(self, idempotency_key: str) -> MailMessage | None:
        row = self._connection.execute(
            f"""
            SELECT {_MESSAGE_COLUMNS}
            FROM mailbox_messages
            WHERE project_id = %s AND idempotency_key = %s
            """,
            (self._project_id, idempotency_key),
        ).fetchone()
        if row is None:
            return None
        return _message(row)

    def _notification(self, notification_key: str) -> MailNotification | None:
        row = self._connection.execute(
            """
            SELECT id, notification_key, message_id, kind
            FROM mailbox_notifications
            WHERE project_id = %s AND notification_key = %s
            """,
            (self._project_id, notification_key),
        ).fetchone()
        if row is None:
            return None
        return _notification(row)


def _validate_message(key: str, recipient: str, subject: str, body: str, thread: str) -> None:
    if (
        key == ""
        or len(key) > 200
        or _EMAIL.fullmatch(recipient) is None
        or subject == ""
        or len(subject) > 200
        or len(body) > 4000
        or len(thread) > 80
        or contains_secret({"subject": subject, "body": body, "recipient": recipient})
    ):
        raise MailboxState("mailbox fields are invalid")


def _validate_metadata(metadata: Mapping[str, str]) -> None:
    if len(metadata) > 10:
        raise MailboxState("mailbox fields are invalid")
    for key, value in metadata.items():
        if (
            _METADATA_KEY.fullmatch(key) is None
            or not isinstance(value, str)
            or len(value) > 200
            or "\n" in value
            or "\r" in value
            or contains_secret({key: value})
        ):
            raise MailboxState("mailbox fields are invalid")


def _validate_attachment(attachment: AttachmentDraft) -> None:
    if (
        _REFERENCE.fullmatch(attachment.attachment_ref) is None
        or attachment.file_name.strip() == ""
        or len(attachment.file_name) > 200
        or attachment.content_type.strip() == ""
        or len(attachment.content_type) > 100
        or attachment.size_bytes < 0
        or attachment.size_bytes > 25000000
        or contains_secret({"file_name": attachment.file_name})
    ):
        raise MailboxState("mailbox fields are invalid")


_MESSAGE_COLUMNS = "id, provider_message_id, thread_id, status, sender, recipient, subject, body"


def _message(row: tuple[object, ...]) -> MailMessage:
    if not isinstance(row[0], UUID) or not isinstance(row[1], str):
        raise NotVisible()
    return MailMessage(
        id=row[0],
        provider_message_id=row[1],
        thread_id=str(row[2]),
        status=str(row[3]),
        sender=str(row[4]),
        recipient=str(row[5]),
        subject=str(row[6]),
        body=str(row[7]),
    )


def _message_without_body(row: tuple[object, ...]) -> MailMessage:
    message = _message(row)
    return MailMessage(
        id=message.id,
        provider_message_id=message.provider_message_id,
        thread_id=message.thread_id,
        status=message.status,
        sender=message.sender,
        recipient=message.recipient,
        subject=message.subject,
        body="",
    )


def _notification(row: tuple[object, ...]) -> MailNotification:
    if not isinstance(row[0], UUID) or not isinstance(row[2], UUID):
        raise NotVisible()
    return MailNotification(
        id=row[0],
        notification_key=str(row[1]),
        message_id=row[2],
        kind=str(row[3]),
    )
