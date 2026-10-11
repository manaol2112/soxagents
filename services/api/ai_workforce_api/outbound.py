"""Outbound evidence requests from approved templates. Live email stays disabled."""

import hashlib
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from string import Template
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.approvals import (
    ApprovalBody,
    ApprovalCreate,
    ApprovalState,
    _request,
    payload_hash,
)
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
    MailboxProvider,
    MailboxState,
    MailboxUnavailable,
    MailMessage,
    open_mailbox,
)
from ai_workforce_api.pbc import _COLUMNS as _PBC_COLUMNS
from ai_workforce_api.pbc import PbcBody, PbcState
from ai_workforce_api.pbc import _audit as _pbc_audit
from ai_workforce_api.pbc import _body as _pbc_body
from ai_workforce_api.pbc import _lock as _lock_pbc
from ai_workforce_api.policy import evaluate
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

MailboxFactory = Callable[[Settings, psycopg.Connection[Any], UUID, UUID], MailboxProvider]
ACTION_ID = "mail.pbc"
CLAIM_SECONDS = 120
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_DOMAIN = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
_OPEN = frozenset({"PENDING", "UNKNOWN"})
_COLUMNS = """
    id, pbc_request_id, approval_id, template_id, template_version, recipient, subject,
    status, provider_message_id, thread_id, error_code, attempt_count, metadata,
    created_at, updated_at, version
"""


class OutboundState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


@dataclass(frozen=True)
class MessageTemplate:
    template_id: str
    version: int
    subject: str
    body: str


PBC_REQUEST = MessageTemplate(
    template_id="pbc-request",
    version=1,
    subject="[$reference] Evidence request: $control",
    body=(
        "Hello,\n\n"
        "The audit team for $engagement is requesting the evidence below.\n\n"
        "Request: $reference\n"
        "Control: $control\n"
        "Due: $due\n\n"
        "Evidence requested:\n"
        "$description\n\n"
        "Please reply to this email with the evidence attached. Keep $reference in the "
        "subject so your response is matched to this request.\n\n"
        "Thank you."
    ),
)
TEMPLATES: tuple[MessageTemplate, ...] = (PBC_REQUEST,)


@dataclass(frozen=True)
class RenderedMessage:
    template: MessageTemplate
    recipient: str
    subject: str
    body: str
    reference: str
    content_sha256: str
    request_ref: str
    metadata: dict[str, str]

    def parameters(self) -> dict[str, str]:
        return {
            "recipient": self.recipient,
            "subject": self.subject,
            "request_ref": self.request_ref,
        }


class OutboundPreview(BaseModel):
    template_id: str
    template_version: int
    reference: str
    recipient: str
    recipient_allowed: bool
    subject: str
    body: str
    parameters: dict[str, str]


class SubmitBody(BaseModel):
    version: int = Field(ge=1)


class SubmitResult(BaseModel):
    request: PbcBody
    approval: ApprovalBody
    preview: OutboundPreview


class SendBody(BaseModel):
    approval_id: UUID


class OutboundBody(BaseModel):
    id: UUID
    pbc_request_id: UUID
    approval_id: UUID
    template_id: str
    template_version: int
    recipient: str
    subject: str
    reference: str
    status: str
    delivery_confirmed: bool
    provider_message_id: str | None
    thread_id: str | None
    error_code: str
    attempt_count: int
    created_at: datetime
    updated_at: datetime
    version: int


def register_outbound(
    app: FastAPI, settings: Settings, mailbox: MailboxFactory = open_mailbox
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/pbc-requests/{{request_id}}/outbound-preview")
    def preview(
        organization_id: UUID, project_id: UUID, request_id: UUID, request: Request
    ) -> OutboundPreview:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _preview(
                connection, settings, principal, organization_id, project_id, request_id
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/submit")
    def submit(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: SubmitBody,
        request: Request,
    ) -> SubmitResult:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _submit(
                connection, settings, principal, organization_id, project_id, request_id, body
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/send")
    def send(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: SendBody,
        request: Request,
    ) -> OutboundBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: send_request(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                request_id,
                body.approval_id,
                mailbox,
            ),
        )

    @app.get(f"{base}/outbound-messages")
    def list_messages(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[OutboundBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _list(connection, principal, organization_id, project_id),
        )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        return _call(settings, work)
    except (OutboundState, ApprovalState, PbcState) as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail="outbound fields are invalid") from error


def render(request: PbcBody, engagement: str) -> RenderedMessage:
    template = PBC_REQUEST
    reference = f"PBC-{request.id.hex[-8:].upper()}"
    due = request.due_at.astimezone(UTC)
    values = {
        "reference": reference,
        "control": request.control_ref.strip()[:120],
        "engagement": " ".join(engagement.split())[:200] or "this engagement",
        "due": f"{due.day} {due:%B %Y}",
        "description": request.evidence_description.strip(),
    }
    subject = Template(template.subject).substitute(values)
    body = Template(template.body).substitute(values)
    recipient = request.recipient.strip()
    if len(subject) > 200 or len(body) > 4000:
        raise ValueError("message is too long")
    digest = hashlib.sha256(f"{recipient}\n{subject}\n{body}".encode()).hexdigest()
    return RenderedMessage(
        template=template,
        recipient=recipient,
        subject=subject,
        body=body,
        reference=reference,
        content_sha256=digest,
        request_ref=f"pbc/{request.id}/{template.template_id}-v{template.version}/{digest[:16]}",
        metadata={
            "request_id": str(request.id),
            "request_reference": reference,
            "template": f"{template.template_id}.v{template.version}",
        },
    )


def recipient_allowed(settings: Settings, recipient: str) -> bool:
    address = recipient.strip().lower()
    if _EMAIL.fullmatch(address) is None:
        return False
    if address in {MOCK_SENDER, settings.shared_mailbox_address.strip().lower()}:
        return False
    configured = settings.email_allowed_recipient_domains.strip()
    if configured == "":
        return True
    domains = {item.strip().lower() for item in configured.split(",")}
    allowed = {item for item in domains if _DOMAIN.fullmatch(item) is not None}
    return address.rsplit("@", 1)[1] in allowed


def _preview(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
) -> OutboundPreview:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    pbc = _read_pbc(connection, organization_id, project_id, request_id)
    return _preview_body(
        settings, render(pbc, _engagement(connection, organization_id, project_id))
    )


def _submit(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    body: SubmitBody,
) -> SubmitResult:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    pbc = _read_pbc(connection, organization_id, project_id, request_id)
    if pbc.version != body.version:
        raise OutboundState("pbc request changed")
    if pbc.status not in {"DRAFT", "APPROVAL_PENDING"}:
        raise OutboundState("request is already sent")
    message = render(pbc, _engagement(connection, organization_id, project_id))
    if not recipient_allowed(settings, message.recipient):
        raise OutboundState("recipient is not allowed")
    approval = _request(
        connection,
        principal,
        organization_id,
        project_id,
        ApprovalCreate(action_id=ACTION_ID, parameters=message.parameters()),
    )
    updated = pbc
    if pbc.status == "DRAFT":
        with transaction(connection) as cursor:
            row = cursor.execute(
                f"""
                UPDATE pbc_requests
                SET status = 'APPROVAL_PENDING', updated_at = clock_timestamp(),
                    version = version + 1
                WHERE id = %s AND organization_id = %s AND project_id = %s
                  AND version = %s AND status = 'DRAFT'
                RETURNING {_PBC_COLUMNS}
                """,
                (request_id, organization_id, project_id, body.version),
            ).fetchone()
            if row is None:
                raise OutboundState("pbc request changed")
            updated = _pbc_body(row)
            _pbc_audit(
                cursor, organization_id, project_id, principal.id, request_id, "APPROVAL_PENDING"
            )
    return SubmitResult(
        request=updated, approval=approval, preview=_preview_body(settings, message)
    )


def send_request(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    approval_id: UUID,
    mailbox: MailboxFactory = open_mailbox,
) -> OutboundBody:
    """Commit the outbound record before the provider is called."""
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    current = _by_approval(connection, organization_id, project_id, approval_id)
    if current is None:
        current = _record(
            connection, settings, principal, organization_id, project_id, request_id, approval_id
        )
        if current is not None:
            connection.commit()
            return _deliver(
                connection, settings, principal, organization_id, project_id, current, mailbox
            )
        current = _by_approval(connection, organization_id, project_id, approval_id)
        if current is None:
            raise NotVisible()
    if current.pbc_request_id != request_id:
        raise OutboundState("approval does not match")
    return _resume(connection, settings, principal, organization_id, project_id, current, mailbox)


def _record(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    approval_id: UUID,
) -> OutboundBody | None:
    try:
        with transaction(connection) as cursor:
            pbc = _lock_pbc(cursor, organization_id, project_id, request_id)
            if pbc.status != "APPROVAL_PENDING":
                raise OutboundState("request is not awaiting approval")
            message = render(pbc, _engagement(connection, organization_id, project_id))
            if not recipient_allowed(settings, message.recipient):
                raise OutboundState("recipient is not allowed")
            digest = _lock_approval(cursor, organization_id, project_id, approval_id, message)
            _require_policy(connection, principal, organization_id, project_id, message)
            row = cursor.execute(
                f"""
                INSERT INTO outbound_messages (
                    organization_id, project_id, pbc_request_id, approval_id, actor_user_id,
                    operation_key, template_id, template_version, recipient, subject,
                    content_sha256, metadata, claimed_until
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    clock_timestamp() + make_interval(secs => %s)
                )
                RETURNING {_COLUMNS}
                """,
                (
                    organization_id,
                    project_id,
                    request_id,
                    approval_id,
                    principal.id,
                    digest,
                    message.template.template_id,
                    message.template.version,
                    message.recipient,
                    message.subject,
                    message.content_sha256,
                    Json(message.metadata),
                    CLAIM_SECONDS,
                ),
            ).fetchone()
            if row is None:
                raise NotVisible()
            recorded = _outbound(row)
            _audit(cursor, organization_id, project_id, principal.id, recorded, "outbound.recorded")
            return recorded
    except UniqueViolation:
        return None


def _resume(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    current: OutboundBody,
    mailbox: MailboxFactory,
) -> OutboundBody:
    if current.status not in _OPEN:
        return current
    pbc = _read_pbc(connection, organization_id, project_id, current.pbc_request_id)
    _require_policy(
        connection,
        principal,
        organization_id,
        project_id,
        render(pbc, _engagement(connection, organization_id, project_id)),
    )
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE outbound_messages
            SET claimed_until = clock_timestamp() + make_interval(secs => %s),
                updated_at = clock_timestamp(),
                version = version + 1
            WHERE id = %s AND status IN ('PENDING', 'UNKNOWN')
              AND (claimed_until IS NULL OR claimed_until < clock_timestamp())
            RETURNING {_COLUMNS}
            """,
            (CLAIM_SECONDS, current.id),
        ).fetchone()
    if row is None:
        latest = _by_approval(connection, organization_id, project_id, current.approval_id)
        return current if latest is None else latest
    connection.commit()
    return _deliver(
        connection,
        settings,
        principal,
        organization_id,
        project_id,
        _outbound(row),
        mailbox,
        reconcile=True,
    )


def _deliver(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
    mailbox: MailboxFactory,
    *,
    reconcile: bool = False,
) -> OutboundBody:
    key = f"outbound:{outbound.id}"
    provider = mailbox(settings, connection, organization_id, project_id)
    attempts = outbound.attempt_count
    try:
        if reconcile:
            found = provider.lookup(key)
            if found is not None:
                return _finish(
                    connection, principal, organization_id, project_id, outbound, found, attempts
                )
            if _approval_expired(connection, outbound.approval_id):
                return _fail(
                    connection, principal, organization_id, project_id, outbound, "approval_expired"
                )
            attempts = min(attempts + 1, 10)
        message = _verified(connection, organization_id, project_id, outbound)
        if message is None:
            return _fail(
                connection, principal, organization_id, project_id, outbound, "invalid_message"
            )
        sent = provider.send(
            idempotency_key=key,
            recipient=message.recipient,
            subject=message.subject,
            body=message.body,
            thread_id=None,
            metadata={**message.metadata, "outbound_id": str(outbound.id)},
        )
    except MailboxUnavailable:
        if reconcile:
            return _unknown(
                connection, principal, organization_id, project_id, outbound, "provider_error"
            )
        return _fail(
            connection, principal, organization_id, project_id, outbound, "live_email_disabled"
        )
    except MailboxState:
        return _fail(
            connection, principal, organization_id, project_id, outbound, "invalid_message"
        )
    except Exception as error:
        # The provider may have sent the message before this failure surfaced.
        logger.warning("outbound delivery outcome is unknown")
        code = "timeout" if isinstance(error, TimeoutError) else "provider_error"
        return _unknown(
            connection, principal, organization_id, project_id, outbound, code, attempts
        )
    return _finish(connection, principal, organization_id, project_id, outbound, sent, attempts)


def _finish(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
    message: MailMessage,
    attempts: int,
) -> OutboundBody:
    if message.status != "ACCEPTED":
        return _unknown(
            connection, principal, organization_id, project_id, outbound, "provider_error", attempts
        )
    with transaction(connection) as cursor:
        updated = _update(
            cursor,
            outbound,
            "ACCEPTED",
            "",
            attempts,
            message.provider_message_id,
            message.thread_id,
        )
        _settle(cursor, organization_id, project_id, principal.id, updated, "SUCCEEDED", None)
        row = cursor.execute(
            """
            UPDATE pbc_requests
            SET status = 'SENT', outbound_message_id = %s, thread_id = %s,
                updated_at = clock_timestamp(), version = version + 1
            WHERE id = %s AND project_id = %s AND status = 'APPROVAL_PENDING'
            RETURNING id
            """,
            (message.provider_message_id, message.thread_id, outbound.pbc_request_id, project_id),
        ).fetchone()
        if row is not None:
            _pbc_audit(
                cursor, organization_id, project_id, principal.id, outbound.pbc_request_id, "SENT"
            )
        _audit(cursor, organization_id, project_id, principal.id, updated, "outbound.updated")
    return updated


def _fail(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
    code: str,
) -> OutboundBody:
    with transaction(connection) as cursor:
        updated = _update(cursor, outbound, "FAILED", code, outbound.attempt_count, None, None)
        reason = "live_email_disabled" if code == "live_email_disabled" else "not_available"
        _settle(cursor, organization_id, project_id, principal.id, updated, "REFUSED", reason)
        _audit(cursor, organization_id, project_id, principal.id, updated, "outbound.updated")
    return updated


def _unknown(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
    code: str,
    attempts: int | None = None,
) -> OutboundBody:
    count = outbound.attempt_count if attempts is None else attempts
    with transaction(connection) as cursor:
        updated = _update(cursor, outbound, "UNKNOWN", code, count, None, None)
        _audit(cursor, organization_id, project_id, principal.id, updated, "outbound.updated")
    return updated


def _update(
    cursor: psycopg.Cursor[Any],
    outbound: OutboundBody,
    status: str,
    code: str,
    attempts: int,
    provider_message_id: str | None,
    thread_id: str | None,
) -> OutboundBody:
    row = cursor.execute(
        f"""
        UPDATE outbound_messages
        SET status = %s,
            error_code = %s,
            attempt_count = %s,
            provider_message_id = COALESCE(provider_message_id, %s),
            thread_id = COALESCE(thread_id, %s),
            claimed_until = NULL,
            updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND version = %s
        RETURNING {_COLUMNS}
        """,
        (status, code, attempts, provider_message_id, thread_id, outbound.id, outbound.version),
    ).fetchone()
    if row is None:
        raise OutboundState("outbound message changed")
    return _outbound(row)


def _settle(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    outbound: OutboundBody,
    status: str,
    reason: str | None,
) -> None:
    cursor.execute(
        """
        UPDATE approvals
        SET execution_status = %s, version = version + 1
        WHERE id = %s AND decision = 'APPROVED' AND execution_status = 'NOT_STARTED'
        """,
        (status, outbound.approval_id),
    )
    cursor.execute(
        """
        INSERT INTO action_executions (
            organization_id, project_id, actor_user_id, approval_id, action_id,
            payload_hash, status, result_ref, reason
        )
        SELECT %s, %s, %s, id, action_id, payload_hash, %s, %s, %s
        FROM approvals
        WHERE id = %s
        ON CONFLICT DO NOTHING
        """,
        (
            organization_id,
            project_id,
            actor_id,
            status,
            outbound.provider_message_id if status == "SUCCEEDED" else None,
            reason,
            outbound.approval_id,
        ),
    )


def _lock_approval(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
    message: RenderedMessage,
) -> str:
    row = cursor.execute(
        """
        SELECT action_id, payload_hash, requesting_agent_id, decision::text, execution_status,
               expires_at <= clock_timestamp()
        FROM approvals
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (approval_id, organization_id, project_id),
    ).fetchone()
    if row is None or not isinstance(row[1], str):
        raise NotVisible()
    agent_id = row[2] if isinstance(row[2], UUID) else None
    digest = payload_hash(organization_id, project_id, ACTION_ID, agent_id, message.parameters())
    if row[0] != ACTION_ID or row[1] != digest:
        raise OutboundState("approval does not match")
    if row[5] is True:
        raise OutboundState("approval has expired")
    if row[3] != "APPROVED" or row[4] != "NOT_STARTED":
        raise OutboundState("approval is not approved")
    return digest


def _approval_expired(connection: psycopg.Connection[Any], approval_id: UUID) -> bool:
    row = connection.execute(
        "SELECT expires_at <= clock_timestamp() FROM approvals WHERE id = %s",
        (approval_id,),
    ).fetchone()
    return row is None or row[0] is True


def _require_policy(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    message: RenderedMessage,
) -> None:
    decision = evaluate(
        connection, principal, organization_id, project_id, ACTION_ID, message.parameters()
    )
    if decision.decision != "ALLOW":
        raise OutboundState("action is not allowed")


def _verified(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
) -> RenderedMessage | None:
    pbc = _read_pbc(connection, organization_id, project_id, outbound.pbc_request_id)
    try:
        message = render(pbc, _engagement(connection, organization_id, project_id))
    except ValueError:
        return None
    if message.content_sha256 != _content(connection, outbound.id):
        return None
    return message


def _content(connection: psycopg.Connection[Any], outbound_id: UUID) -> str:
    row = connection.execute(
        "SELECT content_sha256 FROM outbound_messages WHERE id = %s", (outbound_id,)
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    return row[0]


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[OutboundBody]:
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
        FROM outbound_messages
        WHERE organization_id = %s AND project_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 200
        """,
        (organization_id, project_id),
    ).fetchall()
    return [_outbound(row) for row in rows]


def _by_approval(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
) -> OutboundBody | None:
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM outbound_messages
        WHERE organization_id = %s AND project_id = %s AND approval_id = %s
        """,
        (organization_id, project_id, approval_id),
    ).fetchone()
    return None if row is None else _outbound(row)


def _read_pbc(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, request_id: UUID
) -> PbcBody:
    row = connection.execute(
        f"""
        SELECT {_PBC_COLUMNS}
        FROM pbc_requests
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (request_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _pbc_body(row)


def _engagement(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> str:
    row = connection.execute(
        "SELECT name FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    return row[0]


def _preview_body(settings: Settings, message: RenderedMessage) -> OutboundPreview:
    return OutboundPreview(
        template_id=message.template.template_id,
        template_version=message.template.version,
        reference=message.reference,
        recipient=message.recipient,
        recipient_allowed=recipient_allowed(settings, message.recipient),
        subject=message.subject,
        body=message.body,
        parameters=message.parameters(),
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    outbound: OutboundBody,
    action: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'outbound_message', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor_id,
            action,
            outbound.id,
            Json(
                {
                    "status": outbound.status,
                    "error_code": outbound.error_code,
                    "template": f"{outbound.template_id}.v{outbound.template_version}",
                }
            ),
        ),
    )


def _outbound(row: tuple[Any, ...]) -> OutboundBody:
    if not isinstance(row[0], UUID) or not isinstance(row[7], str):
        raise NotVisible()
    metadata = row[12] if isinstance(row[12], dict) else {}
    return OutboundBody(
        id=row[0],
        pbc_request_id=row[1],
        approval_id=row[2],
        template_id=str(row[3]),
        template_version=int(row[4]),
        recipient=str(row[5]),
        subject=str(row[6]),
        reference=str(metadata.get("request_reference", "")),
        status=row[7],
        delivery_confirmed=row[7] == "DELIVERED",
        provider_message_id=row[8] if isinstance(row[8], str) else None,
        thread_id=row[9] if isinstance(row[9], str) else None,
        error_code=str(row[10]),
        attempt_count=int(row[11]),
        created_at=row[13],
        updated_at=row[14],
        version=int(row[15]),
    )
