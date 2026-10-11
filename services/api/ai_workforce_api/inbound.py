"""Inbound replies to evidence requests.

Mail content is untrusted data. Processing records each received message once, keeps
plain text with the markup removed, and decides whether it matches a request. A match
never changes a request's status: a person reviews the reply and decides. Nothing in
this module passes mail content to a model, follows a link, or opens an attachment.
"""

import re
import unicodedata
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parseaddr
from html.parser import HTMLParser
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.mailbox import (
    MOCK_SENDER,
    AttachmentDraft,
    MailboxProvider,
    MailboxState,
    MailboxUnavailable,
    MailMessage,
    MockMailbox,
    open_mailbox,
)
from ai_workforce_api.settings import Settings

MailboxFactory = Callable[[Settings, psycopg.Connection[Any], UUID, UUID], MailboxProvider]

BODY_LIMIT = 20000
SUBJECT_LIMIT = 200
RECONCILE_LIMIT = 500
# A reply can be linked to a request in these statuses. Earlier or final statuses
# mean no reply is expected, so the message goes to triage instead.
OPEN_STATUSES = frozenset(
    {"SENT", "WAITING_FOR_RESPONSE", "PARTIALLY_RECEIVED", "OVERDUE", "ESCALATED", "RECEIVED"}
)

_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_REFERENCE = re.compile(r"(?i)\bPBC-([0-9A-F]{8})\b")
_LOOKS_HTML = re.compile(
    r"(?i)<\s*/?\s*(html|head|body|div|p|br|span|table|tr|td|a|b|i|u|font|style|script|img)\b"
)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
# Zero-width, joiner, and direction-override characters can hide or reorder text.
_INVISIBLE = re.compile("[​-‏‪-‮⁠-⁤⁦-⁩﻿]")
_SECRET_VALUE = re.compile(
    r"(?i)\b(api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|"
    r"password|passwd|private[_-]?key)(\s*[:=]\s*)\S+"
)
_SECRET_TOKEN = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}")
_PRIVATE_KEY = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.DOTALL
)
_COLUMNS = """
    id, pbc_request_id, suggested_pbc_request_id, match_status, match_method, unmatched_reason,
    review_state, sender, subject, body_text, body_truncated, content_redacted, received_at,
    triage_reason, triaged_at, reviewed_at, mailbox_message_id, version
"""

UnmatchedReason = Literal[
    "",
    "no_reference",
    "unknown_reference",
    "ambiguous_reference",
    "conflicting_reference",
    "sender_mismatch",
    "request_not_open",
]


class InboundState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


# Content handling


@dataclass(frozen=True)
class CleanText:
    text: str
    truncated: bool
    redacted: bool


class _TextExtractor(HTMLParser):
    _SKIP = frozenset(
        {"script", "style", "head", "title", "template", "noscript", "svg", "iframe", "object"}
    )
    _BLOCK = frozenset(
        {
            "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
            "blockquote", "pre", "table", "ul", "ol", "hr", "section", "article",
        }
    )  # fmt: skip

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skipping = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._SKIP:
            self._skipping += 1
        elif tag in self._BLOCK and self._skipping == 0:
            self.parts.append("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._BLOCK and self._skipping == 0:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP:
            self._skipping = max(0, self._skipping - 1)
        elif tag in self._BLOCK and self._skipping == 0:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skipping == 0:
            self.parts.append(data)


def clean_text(raw: str, limit: int = BODY_LIMIT) -> CleanText:
    """Return plain text. Markup, scripts, and hidden characters are removed."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    if _LOOKS_HTML.search(text):
        extractor = _TextExtractor()
        extractor.feed(text)
        extractor.close()
        text = "".join(extractor.parts)
    text = unicodedata.normalize("NFC", text)
    text = _INVISIBLE.sub("", text)
    text = _CONTROL.sub("", text).replace("\t", "    ")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    redacted_text = _PRIVATE_KEY.sub("[redacted private key]", text)
    redacted_text = _SECRET_VALUE.sub(r"\1\2[redacted]", redacted_text)
    redacted_text = _SECRET_TOKEN.sub("[redacted]", redacted_text)
    redacted = redacted_text != text
    truncated = len(redacted_text) > limit
    return CleanText(text=redacted_text[:limit], truncated=truncated, redacted=redacted)


def clean_line(raw: str, limit: int = SUBJECT_LIMIT) -> str:
    """Return one line of plain text, such as a subject or a file name."""
    text = _INVISIBLE.sub("", unicodedata.normalize("NFC", raw))
    text = _CONTROL.sub(" ", text)
    text = _SECRET_VALUE.sub(r"\1\2[redacted]", " ".join(text.split()))
    return _SECRET_TOKEN.sub("[redacted]", text)[:limit]


def sender_address(raw: str) -> str | None:
    """Return the sender's address in lower case, or None when it is not valid."""
    _name, address = parseaddr(_INVISIBLE.sub("", raw))
    address = address.strip().lower()
    return address if _EMAIL.fullmatch(address) else None


def references(subject: str) -> tuple[str, ...]:
    """Return each distinct [PBC-XXXXXXXX] reference in the subject, upper case."""
    found: list[str] = []
    for match in _REFERENCE.finditer(subject):
        reference = match.group(1).upper()
        if reference not in found:
            found.append(reference)
    return tuple(found)


# Matching


@dataclass(frozen=True)
class Candidate:
    id: UUID
    recipient: str
    status: str


@dataclass(frozen=True)
class MatchDecision:
    status: Literal["MATCHED", "UNMATCHED"]
    method: Literal["thread", "reference", "none"]
    reason: UnmatchedReason
    request_id: UUID | None
    suggested_id: UUID | None


def decide(
    sender: str | None,
    thread_hits: tuple[Candidate, ...],
    reference_hits: Mapping[str, tuple[Candidate, ...]],
) -> MatchDecision:
    """Match strictly. Anything uncertain goes to a person."""
    referenced = {candidate.id for hits in reference_hits.values() for candidate in hits}
    candidate: Candidate | None = None
    method: Literal["thread", "reference"] = "thread"
    if len(thread_hits) > 1:
        return _unmatched("ambiguous_reference", None)
    if len(thread_hits) == 1:
        candidate = thread_hits[0]
        if referenced and referenced != {candidate.id}:
            return _unmatched("conflicting_reference", None)
    else:
        if not reference_hits:
            return _unmatched("no_reference", None)
        if not referenced:
            return _unmatched("unknown_reference", None)
        if len(referenced) > 1 or any(len(hits) != 1 for hits in reference_hits.values()):
            return _unmatched("ambiguous_reference", None)
        candidate = next(iter(reference_hits.values()))[0]
        method = "reference"
    if sender is None or sender != candidate.recipient.strip().lower():
        return _unmatched("sender_mismatch", candidate.id)
    if candidate.status not in OPEN_STATUSES:
        return _unmatched("request_not_open", candidate.id)
    return MatchDecision(
        status="MATCHED", method=method, reason="", request_id=candidate.id, suggested_id=None
    )


def _unmatched(reason: UnmatchedReason, suggested: UUID | None) -> MatchDecision:
    return MatchDecision(
        status="UNMATCHED", method="none", reason=reason, request_id=None, suggested_id=suggested
    )


# API bodies


class InboundAttachment(BaseModel):
    id: UUID
    file_name: str
    content_type: str
    size_bytes: int
    content_sha256: str | None


class InboundBody(BaseModel):
    id: UUID
    pbc_request_id: UUID | None
    suggested_pbc_request_id: UUID | None
    request_reference: str | None
    match_status: str
    match_method: str
    unmatched_reason: str
    review_state: str
    untrusted: Literal[True] = True
    sender: str
    subject: str
    body_text: str
    body_truncated: bool
    content_redacted: bool
    attachments: list[InboundAttachment]
    received_at: datetime
    triage_reason: str
    triaged_at: datetime | None
    reviewed_at: datetime | None
    version: int


class SimulatedAttachment(BaseModel):
    file_name: str = Field(min_length=1, max_length=200)
    content_type: str = Field(min_length=1, max_length=100)
    size_bytes: int = Field(ge=0, le=25000000)
    content_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class SimulatedInbound(BaseModel):
    notification_key: str = Field(min_length=1, max_length=190)
    sender: str = Field(min_length=3, max_length=320)
    subject: str = Field(max_length=200)
    body: str = Field(max_length=200000)
    thread_id: str | None = Field(default=None, max_length=80)
    attachments: list[SimulatedAttachment] = Field(default_factory=list, max_length=20)


class ReconcileBody(BaseModel):
    received: int
    processed: int


class AssignBody(BaseModel):
    version: int = Field(ge=1)
    pbc_request_id: UUID
    reason: str = Field(min_length=1, max_length=500)


class DismissBody(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=500)


class ReviewBody(BaseModel):
    version: int = Field(ge=1)


def register_inbound(
    app: FastAPI, settings: Settings, mailbox: MailboxFactory = open_mailbox
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.post(f"{base}/mailbox/simulated-inbound")
    def simulate(
        organization_id: UUID, project_id: UUID, body: SimulatedInbound, request: Request
    ) -> InboundBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _simulate(
                connection, settings, principal, organization_id, project_id, body, mailbox
            ),
        )

    @app.post(f"{base}/inbound-messages/reconcile")
    def reconcile_messages(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> ReconcileBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _reconcile(
                connection, settings, principal, organization_id, project_id, mailbox
            ),
        )

    @app.get(f"{base}/inbound-messages")
    def list_messages(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[InboundBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _list(connection, principal, organization_id, project_id),
        )

    @app.post(f"{base}/inbound-messages/{{inbound_id}}/assign")
    def assign(
        organization_id: UUID,
        project_id: UUID,
        inbound_id: UUID,
        body: AssignBody,
        request: Request,
    ) -> InboundBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _assign(
                connection, principal, organization_id, project_id, inbound_id, body
            ),
        )

    @app.post(f"{base}/inbound-messages/{{inbound_id}}/dismiss")
    def dismiss(
        organization_id: UUID,
        project_id: UUID,
        inbound_id: UUID,
        body: DismissBody,
        request: Request,
    ) -> InboundBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _dismiss(
                connection, principal, organization_id, project_id, inbound_id, body
            ),
        )

    @app.post(f"{base}/inbound-messages/{{inbound_id}}/review")
    def review(
        organization_id: UUID,
        project_id: UUID,
        inbound_id: UUID,
        body: ReviewBody,
        request: Request,
    ) -> InboundBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _review(
                connection, principal, organization_id, project_id, inbound_id, body
            ),
        )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        return _call(settings, work)
    except InboundState as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except MailboxUnavailable:
        raise HTTPException(status_code=503, detail="mailbox unavailable") from None
    except (MailboxState, ValueError) as error:
        raise HTTPException(status_code=422, detail="inbound fields are invalid") from error


# Processing


def process_received(
    connection: psycopg.Connection[Any],
    provider: MailboxProvider,
    organization_id: UUID,
    project_id: UUID,
    provider_message_id: str,
) -> InboundBody | None:
    """Record one received message. Repeating it returns the same record."""
    message = provider.read_message(provider_message_id)
    return _process(connection, provider, organization_id, project_id, message)


def _process(
    connection: psycopg.Connection[Any],
    provider: MailboxProvider,
    organization_id: UUID,
    project_id: UUID,
    message: MailMessage,
) -> InboundBody | None:
    if message.status != "RECEIVED" or message.sender.strip().lower() == MOCK_SENDER:
        return None
    existing = _by_mailbox(connection, organization_id, project_id, message.id)
    if existing is not None:
        return existing
    attachments = provider.list_attachments(message.provider_message_id)
    sender = sender_address(message.sender)
    subject = clean_line(message.subject)
    body = clean_text(message.body)
    decision = decide(
        sender,
        _candidates(connection, organization_id, project_id, thread_id=message.thread_id),
        {
            reference: _candidates(connection, organization_id, project_id, reference=reference)
            for reference in references(subject)
        },
    )
    received_at = message.recorded_at or datetime.now(UTC)
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            INSERT INTO inbound_messages (
                organization_id, project_id, mailbox_message_id, pbc_request_id,
                suggested_pbc_request_id, match_status, match_method, unmatched_reason,
                review_state, sender, subject, body_text, body_truncated, content_redacted,
                attachment_count, received_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (mailbox_message_id) DO NOTHING
            RETURNING {_COLUMNS}
            """,
            (
                organization_id,
                project_id,
                message.id,
                decision.request_id,
                decision.suggested_id,
                decision.status,
                decision.method,
                decision.reason,
                "NEEDS_REVIEW" if decision.request_id is not None else "NOT_APPLICABLE",
                sender or clean_line(message.sender, 320) or "unknown",
                subject,
                body.text,
                body.truncated,
                body.redacted,
                len(attachments),
                received_at,
            ),
        ).fetchone()
        if row is not None:
            _audit(
                cursor,
                organization_id,
                project_id,
                None,
                row[0],
                "inbound.recorded",
                {
                    "match_status": decision.status,
                    "match_method": decision.method,
                    "unmatched_reason": decision.reason,
                },
            )
    if row is None:
        return _by_mailbox(connection, organization_id, project_id, message.id)
    return _inbound(connection, row)


def _simulate(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: SimulatedInbound,
    mailbox: MailboxFactory,
) -> InboundBody:
    provider = mailbox(settings, connection, organization_id, project_id)
    if not settings.email_mock_inbound_enabled or not isinstance(provider, MockMailbox):
        raise NotVisible()
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    message = provider.deliver_inbound(
        notification_key=body.notification_key,
        sender=body.sender,
        subject=body.subject,
        body=body.body,
        thread_id=body.thread_id,
        attachments=tuple(
            AttachmentDraft(
                attachment_ref=f"inbound/{body.notification_key}/{index}",
                file_name=item.file_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                content_sha256=item.content_sha256,
            )
            for index, item in enumerate(body.attachments)
        ),
    )
    recorded = _process(connection, provider, organization_id, project_id, message)
    if recorded is None:
        raise NotVisible()
    return recorded


def _reconcile(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    mailbox: MailboxFactory,
) -> ReconcileBody:
    """Process received mail that has no record yet, for example after a missed notification."""
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    provider = mailbox(settings, connection, organization_id, project_id)
    received = provider.list_received(RECONCILE_LIMIT)
    processed = 0
    for message in received:
        if _by_mailbox(connection, organization_id, project_id, message.id) is not None:
            continue
        if _process(connection, provider, organization_id, project_id, message) is not None:
            processed += 1
    return ReconcileBody(received=len(received), processed=processed)


def _candidates(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    *,
    thread_id: str | None = None,
    reference: str | None = None,
) -> tuple[Candidate, ...]:
    if thread_id is not None:
        condition, value = "thread_id = %s", thread_id
    elif reference is not None:
        condition, value = "upper(right(replace(id::text, '-', ''), 8)) = %s", reference
    else:
        return ()
    rows = connection.execute(
        f"""
        SELECT id, recipient, status
        FROM pbc_requests
        WHERE organization_id = %s AND project_id = %s AND {condition}
        ORDER BY created_at, id
        LIMIT 5
        """,
        (organization_id, project_id, value),
    ).fetchall()
    return tuple(Candidate(id=row[0], recipient=str(row[1]), status=str(row[2])) for row in rows)


# Human decisions


def _assign(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    inbound_id: UUID,
    body: AssignBody,
) -> InboundBody:
    _authorize_update(connection, principal, organization_id, project_id)
    reason = _reason(body.reason)
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, inbound_id, body.version)
        if current.match_status != "UNMATCHED":
            raise InboundState("reply is already triaged")
        target = cursor.execute(
            """
            SELECT status FROM pbc_requests
            WHERE id = %s AND organization_id = %s AND project_id = %s
            """,
            (body.pbc_request_id, organization_id, project_id),
        ).fetchone()
        if target is None:
            raise NotVisible()
        if str(target[0]) not in OPEN_STATUSES:
            raise InboundState("request is not open")
        row = cursor.execute(
            f"""
            UPDATE inbound_messages
            SET match_status = 'ASSIGNED', match_method = 'manual', pbc_request_id = %s,
                review_state = 'NEEDS_REVIEW', triaged_by_user_id = %s,
                triaged_at = clock_timestamp(), triage_reason = %s,
                updated_at = clock_timestamp(), version = version + 1
            WHERE id = %s
            RETURNING {_COLUMNS}
            """,
            (body.pbc_request_id, principal.id, reason, inbound_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            inbound_id,
            "inbound.assigned",
            {"match_status": "ASSIGNED", "pbc_request_id": str(body.pbc_request_id)},
        )
    return _inbound(connection, row)


def _dismiss(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    inbound_id: UUID,
    body: DismissBody,
) -> InboundBody:
    _authorize_update(connection, principal, organization_id, project_id)
    reason = _reason(body.reason)
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, inbound_id, body.version)
        if current.match_status != "UNMATCHED":
            raise InboundState("reply is already triaged")
        row = cursor.execute(
            f"""
            UPDATE inbound_messages
            SET match_status = 'DISMISSED', triaged_by_user_id = %s,
                triaged_at = clock_timestamp(), triage_reason = %s,
                updated_at = clock_timestamp(), version = version + 1
            WHERE id = %s
            RETURNING {_COLUMNS}
            """,
            (principal.id, reason, inbound_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            inbound_id,
            "inbound.dismissed",
            {"match_status": "DISMISSED"},
        )
    return _inbound(connection, row)


def _review(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    inbound_id: UUID,
    body: ReviewBody,
) -> InboundBody:
    """Record that a person read the reply. The request status is changed separately."""
    _authorize_update(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, inbound_id, body.version)
        if current.review_state != "NEEDS_REVIEW":
            raise InboundState("reply does not need review")
        row = cursor.execute(
            f"""
            UPDATE inbound_messages
            SET review_state = 'REVIEWED', reviewed_by_user_id = %s,
                reviewed_at = clock_timestamp(), updated_at = clock_timestamp(),
                version = version + 1
            WHERE id = %s
            RETURNING {_COLUMNS}
            """,
            (principal.id, inbound_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            inbound_id,
            "inbound.reviewed",
            {"review_state": "REVIEWED"},
        )
    return _inbound(connection, row)


def _authorize_update(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )


def _reason(value: str) -> str:
    reason = " ".join(value.split())
    if reason == "" or len(reason) > 500 or contains_secret({"reason": reason}):
        raise ValueError("reason is invalid")
    return reason


@dataclass(frozen=True)
class _Current:
    match_status: str
    review_state: str


def _lock(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    inbound_id: UUID,
    version: int,
) -> _Current:
    row = cursor.execute(
        """
        SELECT match_status, review_state, version
        FROM inbound_messages
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (inbound_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    if row[2] != version:
        raise InboundState("reply changed")
    return _Current(match_status=str(row[0]), review_state=str(row[1]))


# Reads


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[InboundBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM inbound_messages
        WHERE organization_id = %s AND project_id = %s
        ORDER BY received_at DESC, id DESC
        LIMIT 200
        """,
        (organization_id, project_id),
    ).fetchall()
    return [_inbound(connection, row) for row in rows]


def _by_mailbox(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    mailbox_message_id: UUID,
) -> InboundBody | None:
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM inbound_messages
        WHERE organization_id = %s AND project_id = %s AND mailbox_message_id = %s
        """,
        (organization_id, project_id, mailbox_message_id),
    ).fetchone()
    return None if row is None else _inbound(connection, row)


def _inbound(connection: psycopg.Connection[Any], row: tuple[Any, ...]) -> InboundBody:
    if not isinstance(row[0], UUID) or not isinstance(row[16], UUID):
        raise NotVisible()
    attachments = connection.execute(
        """
        SELECT id, file_name, content_type, size_bytes, content_sha256
        FROM mailbox_attachments
        WHERE message_id = %s
        ORDER BY created_at, id
        """,
        (row[16],),
    ).fetchall()
    request_id = row[1] if isinstance(row[1], UUID) else None
    return InboundBody(
        id=row[0],
        pbc_request_id=request_id,
        suggested_pbc_request_id=row[2] if isinstance(row[2], UUID) else None,
        request_reference=None if request_id is None else f"PBC-{request_id.hex[-8:].upper()}",
        match_status=str(row[3]),
        match_method=str(row[4]),
        unmatched_reason=str(row[5]),
        review_state=str(row[6]),
        sender=str(row[7]),
        subject=str(row[8]),
        body_text=str(row[9]),
        body_truncated=bool(row[10]),
        content_redacted=bool(row[11]),
        attachments=[
            InboundAttachment(
                id=item[0],
                file_name=clean_line(str(item[1])),
                content_type=clean_line(str(item[2]), 100),
                size_bytes=int(item[3]),
                content_sha256=item[4] if isinstance(item[4], str) else None,
            )
            for item in attachments
        ],
        received_at=row[12],
        triage_reason=str(row[13]),
        triaged_at=row[14],
        reviewed_at=row[15],
        version=int(row[17]),
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID | None,
    inbound_id: UUID,
    action: str,
    payload: dict[str, str],
) -> None:
    """Audit payloads hold decisions only, never the sender, subject, or body."""
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'inbound_message', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, inbound_id, Json(payload)),
    )
