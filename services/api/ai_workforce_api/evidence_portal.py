"""Secure evidence upload links (Milestone 8.12).

An evidence request email carries a link instead of asking for attachments. A link
belongs to one recipient on one engagement and opens every open request sent to that
address. Opening it asks for a one-time code sent to the same address; the code opens a
short session in which the owner uploads files to a request. Each file is stored like any
other upload, filed by its owner to the request's control, and read by the evidence
coordinator (`evidence_analysis.py`), which marks the request received.

The owner never sees or downloads anything but the names of the files they added. Only
hashes of the link token, the code, and the session token are stored. A request takes
uploads until 30 days after its due date, and none once it is closed or cancelled. The
team can revoke a recipient's links at any time. Every step is audited without the
recipient's address in the payload.
"""

import asyncio
import hashlib
import hmac
import logging
import re
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Request, Response
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.evidence_analysis import (
    EvidenceAnalysisScheduler,
    queue_analysis,
    schedule_analyses,
)
from ai_workforce_api.evidence_intake import clean_name, clean_type
from ai_workforce_api.mailbox import MailboxProvider, MailboxUnavailable, open_mailbox
from ai_workforce_api.portal_workspace import (
    OWNER_STATUS_LABELS,
    AnswersBody,
    MessageBody,
    PortalDeliverable,
    PortalItemFile,
    PortalMessage,
    PortalQuestion,
    SubmitBody,
    WorkspaceState,
    post_owner_message,
    request_facts,
    save_answers,
    submit,
)
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import ObjectStore, StoreError, digest_of, open_store

logger = logging.getLogger(__name__)

# What the approved message shows where the link goes; the delivery puts the link there.
LINK_PLACEHOLDER = "[secure upload link, added when the request is sent]"
DAYS_AFTER_DUE = 30
CODE_MINUTES = 10
CODE_TRIES = 5
CODES_PER_HOUR = 5
SESSION_MINUTES = 120
MAX_BYTES = 25_000_000
# A request the owner can still add to: sent, and not closed or cancelled.
OPEN_STATUSES = (
    "SENT",
    "WAITING_FOR_RESPONSE",
    "PARTIALLY_RECEIVED",
    "RECEIVED",
    "OVERDUE",
    "ESCALATED",
)
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{32,64}$")
_CODE = re.compile(r"^[0-9]{6}$")
MailboxFactory = Callable[[Settings, psycopg.Connection[Any], UUID, UUID], MailboxProvider]
StoreFactory = Callable[[Settings, psycopg.Connection[Any]], ObjectStore]


class PortalState(Exception):
    """The link or session cannot do this now; the detail is safe to show the owner."""

    def __init__(self, detail: str) -> None:
        self.detail = detail


class TooMany(Exception):
    pass


@dataclass(frozen=True)
class Link:
    id: UUID
    organization_id: UUID
    project_id: UUID
    recipient: str
    revoked: bool


class LinkStatusBody(BaseModel):
    # ACTIVE: open requests wait. CLOSED: none are open now. REVOKED: the team stopped it.
    state: str
    engagement: str
    firm: str
    masked_email: str


class CodeSentBody(BaseModel):
    sent: bool
    expires_in_minutes: int
    # Only with the mock mailbox and mock mail enabled, for local testing: no email leaves.
    preview_code: str | None = None


class SessionBody(BaseModel):
    session_token: str
    expires_at: datetime


class PortalFile(BaseModel):
    file_name: str
    size_bytes: int
    added_at: datetime


class PortalReference(BaseModel):
    """Reference material the audit team chose to share with the recipient (migration
    0075). Material kept internal is never listed here."""

    id: UUID
    file_name: str
    size_bytes: int


class PortalRequest(BaseModel):
    id: UUID
    reference: str
    control: str
    description: str
    due_at: datetime
    status: str
    open_until: datetime
    files: list[PortalFile]
    references: list[PortalReference] = []
    # The owner's working space (portal_workspace.py, migration 0078).
    title: str = ""
    type_label: str = ""
    summary: str = ""
    closing: str = ""
    # False: the wording is free text, shown as written, with one upload for it.
    structured: bool = False
    period: str = ""
    deliverables: list[PortalDeliverable] = []
    # Files uploaded before uploads named their item.
    earlier_files: list[PortalItemFile] = []
    questions: list[PortalQuestion] = []
    messages: list[PortalMessage] = []
    submitted_at: datetime | None = None
    owner_status: str = "AWAITING"
    owner_status_label: str = ""
    # Still taking files and answers (open, and within 30 days of its due date).
    open: bool = True


class PortalCounts(BaseModel):
    total: int
    awaiting: int
    in_progress: int
    submitted: int
    under_review: int
    more_needed: int
    completed: int


class PortalBody(BaseModel):
    engagement: str
    firm: str
    email: str
    session_expires_at: datetime
    requests: list[PortalRequest]
    counts: PortalCounts | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None


class SubmittedBody(BaseModel):
    submitted_at: datetime | None
    # Items still without a file when the owner submitted.
    missing: list[str]


class PortalUploadBody(BaseModel):
    file_name: str
    duplicate: bool


class RecipientLinks(BaseModel):
    recipient: str
    active_links: int
    revoked_links: int
    last_opened_at: datetime | None
    last_upload_at: datetime | None
    open_requests: int


class PreviewLinkBody(BaseModel):
    url: str


# Tokens and links


def new_token() -> str:
    return secrets.token_urlsafe(32)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _code_hash(link_id: UUID, code: str) -> str:
    return _hash(f"{link_id}:{code}")


def link_url(settings: Settings, token: str) -> str:
    base = settings.link_base_url() or "http://localhost:3000"
    return f"{base}/upload/{token}"


def mint_link(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    recipient: str,
    outbound_message_id: UUID | None,
    issued_by: UUID | None,
) -> str:
    """Record a new link for the recipient and return its token, which is never stored."""
    token = new_token()
    cursor.execute(
        """
        INSERT INTO evidence_portal_links (
            organization_id, project_id, recipient, token_hash, outbound_message_id, issued_by
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            organization_id,
            project_id,
            recipient.strip().lower(),
            _hash(token),
            outbound_message_id,
            issued_by,
        ),
    )
    return token


def notify_owner_of_reply(
    connection: psycopg.Connection[Any],
    settings: Settings,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    message_id: UUID,
    actor: UUID,
    text: str,
    mailbox: MailboxFactory = open_mailbox,
) -> bool:
    """Email the request's owner that the audit team wrote, with the message and a fresh
    secure link. Only to an allowed recipient, through the mailbox (live or the mock);
    the message is kept either way. True when it was handed to the mailbox."""
    from ai_workforce_api.outbound import recipient_allowed

    row = connection.execute(
        "SELECT recipient, outbound_message_id IS NOT NULL FROM pbc_requests "
        "WHERE id = %s AND project_id = %s",
        (request_id, project_id),
    ).fetchone()
    if row is None or not row[1]:
        return False
    recipient = str(row[0]).strip().lower()
    if recipient == "" or not recipient_allowed(settings, recipient):
        return False
    reference = f"PBC-{request_id.hex[-8:].upper()}"
    with transaction(connection) as cursor:
        token = mint_link(cursor, organization_id, project_id, recipient, None, actor)
    body = (
        f"Hello,\n\nThe audit team wrote to you about evidence request {reference}:\n\n"
        f"{text}\n\nTo reply, answer questions, or upload files, open your secure link:\n"
        f"{link_url(settings, token)}\n\nWhen you open it, a one-time code is emailed to "
        "this address. Files sent as email attachments are not accepted as evidence.\n"
    )
    try:
        mailbox(settings, connection, organization_id, project_id).send(
            idempotency_key=f"request-message:{message_id}",
            recipient=recipient,
            subject=f"[{reference}] A message from the audit team",
            body=body,
            thread_id=None,
            metadata={"kind": "request-message"},
        )
    except Exception:
        logger.warning("the owner could not be told of the team's message")
        return False
    return True


def mask_email(address: str) -> str:
    local, _, domain = address.partition("@")
    if local == "" or domain == "":
        return "your address"
    return f"{local[0]}{'*' * min(max(len(local) - 1, 2), 6)}@{domain}"


def _link(connection: psycopg.Connection[Any], token: str) -> Link:
    if _TOKEN.fullmatch(token) is None:
        raise NotVisible()
    row = connection.execute(
        """
        SELECT id, organization_id, project_id, recipient::text, revoked_at IS NOT NULL
        FROM evidence_portal_links WHERE token_hash = %s
        """,
        (_hash(token),),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return Link(UUID(str(row[0])), UUID(str(row[1])), UUID(str(row[2])), str(row[3]), bool(row[4]))


def _names(connection: psycopg.Connection[Any], link: Link) -> tuple[str, str]:
    row = connection.execute(
        """
        SELECT p.name, o.name FROM projects p JOIN organizations o ON o.id = p.organization_id
        WHERE p.id = %s AND p.organization_id = %s
        """,
        (link.project_id, link.organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return str(row[0]), str(row[1])


_OPEN_REQUESTS = f"""
    SELECT r.id, r.control_ref, r.evidence_description, r.due_at, r.status,
           r.due_at + interval '{DAYS_AFTER_DUE} days'
    FROM pbc_requests r
    WHERE r.project_id = %s AND lower(r.recipient) = %s
      AND r.status IN ({", ".join(f"'{status}'" for status in OPEN_STATUSES)})
      AND r.outbound_message_id IS NOT NULL
      AND clock_timestamp() <= r.due_at + interval '{DAYS_AFTER_DUE} days'
"""


def _open_requests(connection: psycopg.Connection[Any], link: Link) -> list[tuple[Any, ...]]:
    rows = connection.execute(
        _OPEN_REQUESTS + " ORDER BY r.due_at, r.control_ref",
        (link.project_id, link.recipient.lower()),
    ).fetchall()
    return list(rows)


def _project_active(connection: psycopg.Connection[Any], link: Link) -> bool:
    row = connection.execute(
        "SELECT status::text FROM projects WHERE id = %s AND organization_id = %s",
        (link.project_id, link.organization_id),
    ).fetchone()
    return row is not None and row[0] == "ACTIVE"


def _state(connection: psycopg.Connection[Any], link: Link) -> str:
    if link.revoked:
        return "REVOKED"
    if not _project_active(connection, link) or not _open_requests(connection, link):
        return "CLOSED"
    return "ACTIVE"


# The owner's side


def link_status(connection: psycopg.Connection[Any], token: str) -> LinkStatusBody:
    link = _link(connection, token)
    engagement, firm = _names(connection, link)
    state = _state(connection, link)
    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE evidence_portal_links SET last_opened_at = clock_timestamp() WHERE id = %s",
            (link.id,),
        )
    return LinkStatusBody(
        state=state, engagement=engagement, firm=firm, masked_email=mask_email(link.recipient)
    )


def send_code(
    connection: psycopg.Connection[Any],
    settings: Settings,
    token: str,
    mailbox: MailboxFactory = open_mailbox,
) -> CodeSentBody:
    """Email a one-time code to the link's address. Five an hour, each for ten minutes."""
    link = _link(connection, token)
    if _state(connection, link) != "ACTIVE":
        raise PortalState("this link no longer opens any request")
    engagement, firm = _names(connection, link)
    recent = connection.execute(
        "SELECT count(*) FROM evidence_portal_codes WHERE link_id = %s "
        "AND created_at > clock_timestamp() - interval '1 hour'",
        (link.id,),
    ).fetchone()
    if recent is not None and int(recent[0]) >= CODES_PER_HOUR:
        raise TooMany()
    code = f"{secrets.randbelow(1_000_000):06d}"
    code_id = uuid4()
    provider = mailbox(settings, connection, link.organization_id, link.project_id)
    delivery = "SENT"
    try:
        provider.send(
            idempotency_key=f"portal-code:{code_id}",
            recipient=link.recipient,
            subject=f"Your code for the {engagement} evidence upload",
            body=(
                f"Hello,\n\nYour code to upload evidence for {engagement} ({firm}) is:\n\n"
                f"{code}\n\nIt works for {CODE_MINUTES} minutes. If you did not open the "
                "upload link, you can ignore this email.\n"
            ),
            thread_id=None,
            metadata={"kind": "evidence-portal-code"},
        )
    except MailboxUnavailable:
        delivery = "NOT_SENT"
    except Exception:
        logger.warning("evidence portal code delivery failed")
        delivery = "NOT_SENT"
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO evidence_portal_codes (id, link_id, code_hash, expires_at, delivery)
            VALUES (%s, %s, %s, clock_timestamp() + make_interval(mins => %s), %s)
            """,
            (code_id, link.id, _code_hash(link.id, code), CODE_MINUTES, delivery),
        )
        _audit(cursor, link, "evidence_portal.code_sent", {"delivery": delivery})
    if delivery != "SENT":
        connection.commit()
        raise PortalState(
            "the code could not be emailed; contact the audit team that sent the request"
        )
    preview = _mock_mail(settings)
    return CodeSentBody(
        sent=True, expires_in_minutes=CODE_MINUTES, preview_code=code if preview else None
    )


def _mock_mail(settings: Settings) -> bool:
    return settings.email_provider.strip().lower() in ("", "mock") and (
        settings.email_mock_inbound_enabled
    )


def verify_code(connection: psycopg.Connection[Any], token: str, code: str) -> SessionBody:
    """Exchange a valid code for a session. Each code allows five tries."""
    link = _link(connection, token)
    if _state(connection, link) != "ACTIVE":
        raise PortalState("this link no longer opens any request")
    if _CODE.fullmatch(code.strip()) is None:
        raise PortalState("enter the six-digit code from the email")
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            SELECT id, code_hash, attempts FROM evidence_portal_codes
            WHERE link_id = %s AND used_at IS NULL AND delivery = 'SENT'
              AND expires_at > clock_timestamp()
            ORDER BY created_at DESC LIMIT 1
            FOR UPDATE
            """,
            (link.id,),
        ).fetchone()
        if row is None:
            raise PortalState("the code has expired; ask for a new one")
        code_id, stored, attempts = UUID(str(row[0])), str(row[1]), int(row[2])
        if attempts >= CODE_TRIES:
            raise PortalState("too many wrong codes; ask for a new one")
        matches = hmac.compare_digest(stored, _code_hash(link.id, code.strip()))
        if not matches:
            # The wrong try is counted and committed before the refusal.
            cursor.execute(
                "UPDATE evidence_portal_codes SET attempts = attempts + 1 WHERE id = %s",
                (code_id,),
            )
            _audit(cursor, link, "evidence_portal.code_refused", {"attempt": attempts + 1})
    if not matches:
        # The request's connection rolls back on an error: keep the counted try.
        connection.commit()
        left = CODE_TRIES - attempts - 1
        raise PortalState(
            "that code is not right; ask for a new one"
            if left <= 0
            else f"that code is not right; {left} tr{'y' if left == 1 else 'ies'} left"
        )
    with transaction(connection) as cursor:
        claimed = cursor.execute(
            "SELECT used_at FROM evidence_portal_codes WHERE id = %s FOR UPDATE", (code_id,)
        ).fetchone()
        if claimed is None or claimed[0] is not None:
            raise PortalState("the code has already been used; ask for a new one")
        cursor.execute(
            "UPDATE evidence_portal_codes SET used_at = clock_timestamp(), "
            "attempts = attempts + 1 WHERE id = %s",
            (code_id,),
        )
        session = new_token()
        found = cursor.execute(
            """
            INSERT INTO evidence_portal_sessions (link_id, token_hash, expires_at)
            VALUES (%s, %s, clock_timestamp() + make_interval(mins => %s))
            RETURNING expires_at
            """,
            (link.id, _hash(session), SESSION_MINUTES),
        ).fetchone()
        if found is None:
            raise NotVisible()
        _audit(cursor, link, "evidence_portal.verified", {})
    return SessionBody(session_token=session, expires_at=found[0])


@dataclass(frozen=True)
class Session:
    id: UUID
    link: Link
    expires_at: datetime


def _session(connection: psycopg.Connection[Any], token: str) -> Session:
    if _TOKEN.fullmatch(token) is None:
        raise NotVisible()
    row = connection.execute(
        """
        SELECT s.id, s.expires_at, l.id, l.organization_id, l.project_id, l.recipient::text,
               l.revoked_at IS NOT NULL
        FROM evidence_portal_sessions s
        JOIN evidence_portal_links l ON l.id = s.link_id
        WHERE s.token_hash = %s AND s.ended_at IS NULL AND s.expires_at > clock_timestamp()
        """,
        (_hash(token),),
    ).fetchone()
    if row is None:
        raise NotVisible()
    link = Link(UUID(str(row[2])), UUID(str(row[3])), UUID(str(row[4])), str(row[5]), bool(row[6]))
    if link.revoked:
        raise NotVisible()
    return Session(UUID(str(row[0])), link, row[1])


_LISTED_REQUESTS = f"""
    SELECT r.id, r.control_ref, r.evidence_description, r.due_at, r.status,
           r.due_at + interval '{DAYS_AFTER_DUE} days',
           r.status IN ({", ".join(f"'{status}'" for status in OPEN_STATUSES)})
             AND clock_timestamp() <= r.due_at + interval '{DAYS_AFTER_DUE} days'
    FROM pbc_requests r
    WHERE r.project_id = %s AND lower(r.recipient) = %s
      AND r.outbound_message_id IS NOT NULL
      AND (
        (r.status IN ({", ".join(f"'{status}'" for status in OPEN_STATUSES)})
         AND clock_timestamp() <= r.due_at + interval '{DAYS_AFTER_DUE} days')
        OR r.status = 'CLOSED'
      )
    ORDER BY r.due_at, r.control_ref
"""


def portal(connection: psycopg.Connection[Any], token: str) -> PortalBody:
    """The owner's requests: the open ones to work on, and completed ones to look back at.
    Nothing from another recipient or engagement is ever read."""
    session = _session(connection, token)
    link = session.link
    engagement, firm = _names(connection, link)
    rows = (
        connection.execute(_LISTED_REQUESTS, (link.project_id, link.recipient.lower())).fetchall()
        if _project_active(connection, link)
        else []
    )
    ids = [UUID(str(row[0])) for row in rows]
    files = _files_by_request(connection, session.link, ids)
    shared = _shared_by_request(connection, session.link, ids)
    requests: list[PortalRequest] = []
    for row in rows:
        request_id = UUID(str(row[0]))
        facts = request_facts(connection, link.project_id, request_id, link.recipient, str(row[4]))
        requests.append(
            PortalRequest(
                id=request_id,
                reference=f"PBC-{request_id.hex[-8:].upper()}",
                control=str(row[1]),
                description=str(row[2]),
                due_at=row[3],
                status=str(row[4]),
                open_until=row[5],
                files=files.get(request_id, []),
                references=shared.get(request_id, []),
                title=facts.title,
                type_label=facts.type_label,
                summary=facts.summary,
                closing=facts.closing,
                structured=facts.structured,
                period=facts.period,
                deliverables=facts.deliverables,
                earlier_files=facts.unfiled,
                questions=facts.questions,
                messages=facts.messages,
                submitted_at=facts.submitted_at,
                owner_status=facts.status,
                owner_status_label=OWNER_STATUS_LABELS[facts.status],
                open=bool(row[6]),
            )
        )
    statuses = [item.owner_status for item in requests]
    period = connection.execute(
        "SELECT period_start, period_end FROM engagement_settings WHERE project_id = %s",
        (link.project_id,),
    ).fetchone()
    return PortalBody(
        engagement=engagement,
        firm=firm,
        email=link.recipient,
        session_expires_at=session.expires_at,
        requests=requests,
        counts=PortalCounts(
            total=len(statuses),
            awaiting=statuses.count("AWAITING"),
            in_progress=statuses.count("IN_PROGRESS"),
            submitted=statuses.count("SUBMITTED"),
            under_review=statuses.count("UNDER_REVIEW"),
            more_needed=statuses.count("MORE_NEEDED"),
            completed=statuses.count("COMPLETED"),
        ),
        period_start=None if period is None or period[0] is None else _midnight(period[0]),
        period_end=None if period is None or period[1] is None else _midnight(period[1]),
    )


def _midnight(day: Any) -> datetime:
    return datetime(day.year, day.month, day.day)


def _open_request(connection: psycopg.Connection[Any], link: Link, request_id: UUID) -> str:
    """The request's status, when it is one of this owner's open requests."""
    if not _project_active(connection, link):
        raise PortalState("this engagement is not taking evidence now")
    row = connection.execute(
        _OPEN_REQUESTS + " AND r.id = %s",
        (link.project_id, link.recipient.lower(), request_id),
    ).fetchone()
    if row is None:
        raise PortalState("this request is closed or no longer open to you")
    return str(row[4])


def answer_questions(
    connection: psycopg.Connection[Any], token: str, request_id: UUID, body: AnswersBody
) -> int:
    session = _session(connection, token)
    link = session.link
    status = _open_request(connection, link, request_id)
    facts = request_facts(connection, link.project_id, request_id, link.recipient, status)
    with transaction(connection) as cursor:
        saved = save_answers(
            cursor, link.organization_id, link.project_id, request_id, link.recipient,
            [item.text for item in facts.questions], body,
        )  # fmt: skip
        if saved:
            _audit(cursor, link, "evidence.portal_answered",
                   {"request_id": str(request_id), "answers": saved},
                   target_type="pbc_request", target_id=request_id)  # fmt: skip
    return saved


def write_message(
    connection: psycopg.Connection[Any], token: str, request_id: UUID, body: MessageBody
) -> PortalMessage:
    session = _session(connection, token)
    link = session.link
    _open_request(connection, link, request_id)
    with transaction(connection) as cursor:
        message_id = post_owner_message(
            cursor, link.organization_id, link.project_id, request_id, link.recipient, body
        )
        _audit(cursor, link, "evidence.portal_message",
               {"request_id": str(request_id)},
               target_type="request_message", target_id=message_id)  # fmt: skip
    from ai_workforce_api.portal_workspace import messages_of

    found = next(
        item for item in messages_of(connection, request_id, True) if item.id == message_id
    )
    return found


def submit_evidence(
    connection: psycopg.Connection[Any], token: str, request_id: UUID, body: SubmitBody
) -> SubmittedBody:
    session = _session(connection, token)
    link = session.link
    status = _open_request(connection, link, request_id)
    facts = request_facts(connection, link.project_id, request_id, link.recipient, status)
    with transaction(connection) as cursor:
        missing = submit(cursor, request_id, facts.deliverables, body)
        _audit(cursor, link, "evidence.portal_submitted",
               {"request_id": str(request_id), "items_missing": len(missing)},
               target_type="pbc_request", target_id=request_id)  # fmt: skip
    row = connection.execute(
        "SELECT owner_submitted_at FROM pbc_requests WHERE id = %s", (request_id,)
    ).fetchone()
    return SubmittedBody(submitted_at=None if row is None else row[0], missing=missing)


def _files_by_request(
    connection: psycopg.Connection[Any], link: Link, request_ids: list[UUID]
) -> dict[UUID, list[PortalFile]]:
    """The files this address uploaded through its links, by request. Nothing else."""
    if not request_ids:
        return {}
    rows = connection.execute(
        """
        SELECT m.pbc_request_id, f.file_name, f.size_bytes, f.created_at
        FROM evidence_files f
        JOIN evidence_matches m ON m.evidence_file_id = f.id
        WHERE f.project_id = %s AND lower(f.uploaded_by_email::text) = %s
          AND m.pbc_request_id = ANY(%s)
        ORDER BY f.created_at
        """,
        (link.project_id, link.recipient.lower(), request_ids),
    ).fetchall()
    found: dict[UUID, list[PortalFile]] = {}
    for row in rows:
        found.setdefault(UUID(str(row[0])), []).append(
            PortalFile(file_name=str(row[1]), size_bytes=int(row[2]), added_at=row[3])
        )
    return found


def _shared_by_request(
    connection: psycopg.Connection[Any], link: Link, request_ids: list[UUID]
) -> dict[UUID, list[PortalReference]]:
    """The reference material shared on these requests, by request. Only what a person on
    the audit team explicitly shared; nothing internal."""
    if not request_ids:
        return {}
    rows = connection.execute(
        """
        SELECT a.pbc_request_id, a.id, a.file_name, a.size_bytes
        FROM request_attachments a
        WHERE a.project_id = %s AND a.organization_id = %s AND a.pbc_request_id = ANY(%s)
          AND a.visibility = 'SHARED' AND a.removed_at IS NULL
        ORDER BY a.created_at, a.id
        """,
        (link.project_id, link.organization_id, request_ids),
    ).fetchall()
    found: dict[UUID, list[PortalReference]] = {}
    for row in rows:
        found.setdefault(UUID(str(row[0])), []).append(
            PortalReference(id=UUID(str(row[1])), file_name=str(row[2]), size_bytes=int(row[3]))
        )
    return found


def shared_reference(
    connection: psycopg.Connection[Any],
    store: ObjectStore,
    token: str,
    request_id: UUID,
    attachment_id: UUID,
) -> tuple[str, str, bytes]:
    """One shared reference on one of the recipient's open requests: its name, type, and
    content. Anything else (internal, removed, another request or recipient) is not
    found."""
    session = _session(connection, token)
    link = session.link
    if not _project_active(connection, link):
        raise NotVisible()
    target = connection.execute(
        _OPEN_REQUESTS
        + """
          AND r.id = %s
        """,
        (link.project_id, link.recipient.lower(), request_id),
    ).fetchone()
    if target is None:
        raise NotVisible()
    row = connection.execute(
        """
        SELECT file_name, content_type, object_key, content_sha256
        FROM request_attachments
        WHERE id = %s AND pbc_request_id = %s AND project_id = %s AND organization_id = %s
          AND visibility = 'SHARED' AND removed_at IS NULL
        """,
        (attachment_id, request_id, link.project_id, link.organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    content = store.get(str(row[2]))
    if digest_of(content) != str(row[3]):
        raise StoreError("stored object changed")
    return str(row[0]), str(row[1]), content


def upload(
    connection: psycopg.Connection[Any],
    store: ObjectStore,
    token: str,
    request_id: UUID,
    file_name: str,
    content_type: str,
    content: bytes,
    item: int | None = None,
) -> tuple[PortalUploadBody, UUID | None]:
    """Store a file on one of the owner's open requests and file it to its control. With an
    item, the file is for that numbered deliverable, and is linked to its planned
    requirement where one matches."""
    session = _session(connection, token)
    link = session.link
    if not _project_active(connection, link):
        raise PortalState("this engagement is not taking evidence now")
    if not content or len(content) > MAX_BYTES:
        raise PortalState("the file is empty or larger than 25 MB")
    target = connection.execute(
        _OPEN_REQUESTS
        + """
          AND r.id = %s
        """,
        (link.project_id, link.recipient.lower(), request_id),
    ).fetchone()
    if target is None:
        raise PortalState("this request is closed or no longer open to you")
    control = connection.execute(
        """
        SELECT coalesce(r.engagement_control_id, c.id), r.owner_user_id
        FROM pbc_requests r
        LEFT JOIN engagement_controls c
          ON c.project_id = r.project_id AND c.control_ref = r.control_ref AND c.included
        WHERE r.id = %s AND r.project_id = %s
        LIMIT 1
        """,
        (request_id, link.project_id),
    ).fetchone()
    if control is None or control[0] is None:
        raise PortalState("this request is not linked to a control; contact the audit team")
    control_id, requester = UUID(str(control[0])), UUID(str(control[1]))
    requirement = _item_requirement(connection, request_id, item)
    digest = digest_of(content)
    existing = _existing(connection, link, digest, file_name)
    if existing is not None:
        return PortalUploadBody(file_name=file_name, duplicate=True), None
    file_id = uuid4()
    key = f"evidence/{file_id}"
    store.put(key, content)
    try:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO evidence_files (
                    id, organization_id, project_id, source, upload_batch_id, folder_path,
                    object_key, content_sha256, size_bytes, content_type, file_name,
                    stored_by, uploaded_by_email, portal_session_id
                )
                VALUES (%s, %s, %s, 'UPLOAD', %s, '', %s, %s, %s, %s, %s, NULL, %s, %s)
                """,
                (
                    file_id,
                    link.organization_id,
                    link.project_id,
                    uuid4(),
                    key,
                    digest,
                    len(content),
                    content_type,
                    file_name,
                    link.recipient,
                    session.id,
                ),
            )
            cursor.execute(
                """
                INSERT INTO evidence_matches (
                    organization_id, project_id, evidence_file_id, status,
                    engagement_control_id, pbc_request_id, filed_by, reason, owner_item
                )
                VALUES (%s, %s, %s, 'FILED', %s, %s, 'OWNER', %s, %s)
                """,
                (
                    link.organization_id,
                    link.project_id,
                    file_id,
                    control_id,
                    request_id,
                    "Uploaded by the owner on its request through the secure link."
                    if item is None
                    else f"Uploaded by the owner for item {item} through the secure link.",
                    item,
                ),
            )
            if requirement is not None and requirement[1] == control_id:
                cursor.execute(
                    """
                    INSERT INTO evidence_requirement_files (
                        organization_id, project_id, engagement_control_id, requirement_id,
                        evidence_file_id, status, origin, reason
                    )
                    VALUES (%s, %s, %s, %s, %s, 'LINKED', 'OWNER', %s)
                    ON CONFLICT (requirement_id, evidence_file_id) DO NOTHING
                    """,
                    (
                        link.organization_id, link.project_id, control_id, requirement[0],
                        file_id, "Uploaded by the owner for this item through the secure link.",
                    ),
                )  # fmt: skip
            _audit(
                cursor,
                link,
                "evidence.portal_uploaded",
                {
                    "request_id": str(request_id),
                    "content_sha256": digest,
                    "size_bytes": len(content),
                },
                target_type="evidence_file",
                target_id=file_id,
            )
            # The person who owns the request asked for it, so they request the reading.
            queued = queue_analysis(
                cursor, link.organization_id, link.project_id, file_id, requester
            )
    except UniqueViolation:
        # The same file arrived twice at once: the first one is kept.
        return PortalUploadBody(file_name=file_name, duplicate=True), None
    return PortalUploadBody(file_name=file_name, duplicate=False), queued


def _item_requirement(
    connection: psycopg.Connection[Any], request_id: UUID, item: int | None
) -> tuple[UUID, UUID] | None:
    """The planned requirement the request's numbered item asks for, by its title, with
    its control. None for an item no requirement matches. Raises for an unknown item."""
    if item is None:
        return None
    from ai_workforce_api.request_details import parse_wording

    row = connection.execute(
        "SELECT evidence_description FROM pbc_requests WHERE id = %s", (request_id,)
    ).fetchone()
    content = parse_wording("" if row is None else str(row[0]))
    found = next((entry for entry in content.items if entry.number == item), None)
    if found is None:
        if content.structured or item != 1:
            raise PortalState("that item is not on the request")
        return None
    match = connection.execute(
        "SELECT id, engagement_control_id FROM evidence_requirements "
        "WHERE pbc_request_id = %s AND status = 'REQUESTED' "
        "AND lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) = %s LIMIT 1",
        (request_id, " ".join(found.title.lower().split())),
    ).fetchone()
    return None if match is None else (UUID(str(match[0])), UUID(str(match[1])))


def _existing(
    connection: psycopg.Connection[Any], link: Link, digest: str, name: str
) -> UUID | None:
    row = connection.execute(
        """
        SELECT id FROM evidence_files
        WHERE project_id = %s AND source = 'UPLOAD' AND content_sha256 = %s
          AND folder_path = '' AND file_name = %s
        """,
        (link.project_id, digest, name),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


def end_session(connection: psycopg.Connection[Any], token: str) -> None:
    session = _session(connection, token)
    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE evidence_portal_sessions SET ended_at = clock_timestamp() WHERE id = %s",
            (session.id,),
        )


# The team's side


def recipient_links(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[RecipientLinks]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        f"""
        SELECT l.recipient::text,
               count(*) FILTER (WHERE l.revoked_at IS NULL),
               count(*) FILTER (WHERE l.revoked_at IS NOT NULL),
               max(l.last_opened_at),
               (SELECT max(f.created_at) FROM evidence_files f
                WHERE f.project_id = l.project_id
                  AND lower(f.uploaded_by_email::text) = lower(l.recipient::text)),
               (SELECT count(*) FROM pbc_requests r
                WHERE r.project_id = l.project_id AND lower(r.recipient) = lower(l.recipient::text)
                  AND r.status IN ({", ".join(f"'{status}'" for status in OPEN_STATUSES)})
                  AND r.outbound_message_id IS NOT NULL
                  AND clock_timestamp() <= r.due_at + interval '{DAYS_AFTER_DUE} days')
        FROM evidence_portal_links l
        WHERE l.organization_id = %s AND l.project_id = %s
        GROUP BY l.project_id, l.recipient
        ORDER BY l.recipient
        """,
        (organization_id, project_id),
    ).fetchall()
    return [
        RecipientLinks(
            recipient=str(row[0]),
            active_links=int(row[1]),
            revoked_links=int(row[2]),
            last_opened_at=row[3],
            last_upload_at=row[4],
            open_requests=int(row[5]),
        )
        for row in rows
    ]


def revoke(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    recipient: str,
) -> int:
    """Stop every link this address holds on the engagement, and end its sessions."""
    _manager(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        rows = cursor.execute(
            """
            UPDATE evidence_portal_links
            SET revoked_at = clock_timestamp(), revoked_by = %s
            WHERE organization_id = %s AND project_id = %s AND lower(recipient::text) = %s
              AND revoked_at IS NULL
            RETURNING id
            """,
            (principal.id, organization_id, project_id, recipient.strip().lower()),
        ).fetchall()
        ids = [row[0] for row in rows]
        if ids:
            cursor.execute(
                "UPDATE evidence_portal_sessions SET ended_at = clock_timestamp() "
                "WHERE link_id = ANY(%s) AND ended_at IS NULL",
                (ids,),
            )
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'evidence_portal.revoked', 'project', %s, %s)
            """,
            (organization_id, project_id, principal.id, project_id, Json({"links": len(ids)})),
        )
    return len(ids)


def preview_link(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    recipient: str,
) -> PreviewLinkBody:
    """A link for local testing, where the mock mailbox sends nothing. Never otherwise."""
    if not _mock_mail(settings):
        raise PortalState("preview links exist only with the mock mailbox")
    _manager(connection, principal, organization_id, project_id)
    address = recipient.strip().lower()
    exists = connection.execute(
        "SELECT 1 FROM pbc_requests WHERE project_id = %s AND lower(recipient) = %s LIMIT 1",
        (project_id, address),
    ).fetchone()
    if exists is None:
        raise NotVisible()
    with transaction(connection) as cursor:
        token = mint_link(cursor, organization_id, project_id, address, None, principal.id)
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'evidence_portal.preview_link', 'project', %s, '{}'::jsonb)
            """,
            (organization_id, project_id, principal.id, project_id),
        )
    return PreviewLinkBody(url=link_url(settings, token))


def _manager(
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
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()


def _audit(
    cursor: psycopg.Cursor[Any],
    link: Link,
    action: str,
    payload: dict[str, Any],
    *,
    target_type: str = "evidence_portal_link",
    target_id: UUID | None = None,
) -> None:
    """The owner acts without an account: no actor, and never their address."""
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, NULL, %s, %s, %s, %s)
        """,
        (
            link.organization_id,
            link.project_id,
            action,
            target_type,
            target_id or link.id,
            Json({**payload, "channel": "secure_link"}),
        ),
    )


# Routes


class CodeBody(BaseModel):
    code: str


class RevokeBody(BaseModel):
    recipient: str


SESSION_HEADER = "x-portal-session"


def register_evidence_portal(
    app: FastAPI,
    settings: Settings,
    store: StoreFactory = open_store,
    analyses: EvidenceAnalysisScheduler | None = None,
    mailbox: MailboxFactory = open_mailbox,
) -> None:
    """The owner's routes are public and answer only to a link or session token; the
    team's are signed in and authorized like every other route."""
    public = "/public/evidence-portal"
    team = "/organizations/{organization_id}/projects/{project_id}/evidence-portal"

    def run[T](work: Callable[[psycopg.Connection[Any]], T]) -> T:
        if settings.database_url == "":
            raise HTTPException(status_code=503, detail="evidence upload unavailable")
        try:
            with connect(settings.database_url) as connection:
                return work(connection)
        except NotVisible:
            raise HTTPException(status_code=404, detail="this link is not valid") from None
        except (PortalState, WorkspaceState) as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except TooMany:
            raise HTTPException(
                status_code=429, detail="too many codes asked for; try again in an hour"
            ) from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None
        except psycopg.Error:
            logger.warning("evidence portal query failed")
            raise HTTPException(status_code=503, detail="evidence upload unavailable") from None

    def session_of(request: Request) -> str:
        token = request.headers.get(SESSION_HEADER, "").strip()
        if token == "":
            raise HTTPException(status_code=401, detail="enter the code first")
        return token

    @app.get(f"{public}/links/{{token}}")
    def status(token: str) -> LinkStatusBody:
        return run(lambda connection: link_status(connection, token))

    @app.post(f"{public}/links/{{token}}/code")
    def code(token: str) -> CodeSentBody:
        return run(lambda connection: send_code(connection, settings, token, mailbox))

    @app.post(f"{public}/links/{{token}}/verify")
    def verify(token: str, body: CodeBody) -> SessionBody:
        return run(lambda connection: verify_code(connection, token, body.code))

    @app.get(f"{public}/session")
    def requests(request: Request) -> PortalBody:
        token = session_of(request)
        return run(lambda connection: portal(connection, token))

    @app.post(f"{public}/session/requests/{{request_id}}/answers")
    def answers(request_id: UUID, body: AnswersBody, request: Request) -> dict[str, int]:
        token = session_of(request)
        return {"saved": run(lambda c: answer_questions(c, token, request_id, body))}

    @app.post(f"{public}/session/requests/{{request_id}}/messages")
    def message(request_id: UUID, body: MessageBody, request: Request) -> PortalMessage:
        token = session_of(request)
        return run(lambda c: write_message(c, token, request_id, body))

    @app.post(f"{public}/session/requests/{{request_id}}/submit")
    def submitted(request_id: UUID, body: SubmitBody, request: Request) -> SubmittedBody:
        token = session_of(request)
        return run(lambda c: submit_evidence(c, token, request_id, body))

    @app.post(f"{public}/session/requests/{{request_id}}/files")
    async def add_file(
        request_id: UUID, name: str, request: Request, item: int | None = None
    ) -> PortalUploadBody:
        token = session_of(request)
        file_name = clean_name(name)
        content = await request.body()
        content_type = clean_type(request.headers.get("content-type", ""))
        stored, queued = run(
            lambda connection: upload(
                connection,
                store(settings, connection),
                token,
                request_id,
                file_name,
                content_type,
                content,
                item,
            )
        )
        await asyncio.to_thread(schedule_analyses, analyses, [] if queued is None else [queued])
        return stored

    @app.get(f"{public}/session/requests/{{request_id}}/references/{{attachment_id}}")
    def reference(request_id: UUID, attachment_id: UUID, request: Request) -> Response:
        token = session_of(request)
        name, media, content = run(
            lambda connection: shared_reference(
                connection, store(settings, connection), token, request_id, attachment_id
            )
        )
        safe = re.sub(r"[^A-Za-z0-9 ._()-]", "_", name)[:200] or "reference"
        return Response(
            content=content,
            media_type=media,
            headers={
                "Content-Disposition": f'attachment; filename="{safe}"',
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        )

    @app.post(f"{public}/session/end", status_code=204)
    def end(request: Request) -> None:
        token = session_of(request)
        run(lambda connection: end_session(connection, token))

    def signed[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except PortalState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    @app.get(f"{team}/links")
    def links(organization_id: UUID, project_id: UUID, request: Request) -> list[RecipientLinks]:
        return signed(request, lambda c, p: recipient_links(c, p, organization_id, project_id))

    @app.post(f"{team}/revoke")
    def revoke_links(
        organization_id: UUID, project_id: UUID, body: RevokeBody, request: Request
    ) -> dict[str, int]:
        revoked = signed(
            request, lambda c, p: revoke(c, p, organization_id, project_id, body.recipient)
        )
        return {"revoked": revoked}

    @app.post(f"{team}/preview-link")
    def preview(
        organization_id: UUID, project_id: UUID, body: RevokeBody, request: Request
    ) -> PreviewLinkBody:
        return signed(
            request,
            lambda c, p: preview_link(c, settings, p, organization_id, project_id, body.recipient),
        )
