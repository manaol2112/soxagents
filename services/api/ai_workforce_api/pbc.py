"""PBC request records. Status changes do not send email."""

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

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
from ai_workforce_api.settings import Settings

PbcStatus = str
_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"DRAFT", "APPROVAL_PENDING", "CANCELLED"}),
    "APPROVAL_PENDING": frozenset({"APPROVAL_PENDING", "DRAFT", "SENT", "CANCELLED"}),
    "SENT": frozenset({"SENT", "WAITING_FOR_RESPONSE", "CANCELLED"}),
    "WAITING_FOR_RESPONSE": frozenset(
        {
            "WAITING_FOR_RESPONSE",
            "PARTIALLY_RECEIVED",
            "RECEIVED",
            "OVERDUE",
            "ESCALATED",
            "CANCELLED",
        }
    ),
    "PARTIALLY_RECEIVED": frozenset(
        {"PARTIALLY_RECEIVED", "RECEIVED", "OVERDUE", "ESCALATED", "CANCELLED"}
    ),
    "RECEIVED": frozenset({"RECEIVED", "CLOSED"}),
    "OVERDUE": frozenset(
        {
            "OVERDUE",
            "WAITING_FOR_RESPONSE",
            "PARTIALLY_RECEIVED",
            "RECEIVED",
            "ESCALATED",
            "CANCELLED",
        }
    ),
    "ESCALATED": frozenset(
        {
            "ESCALATED",
            "WAITING_FOR_RESPONSE",
            "PARTIALLY_RECEIVED",
            "RECEIVED",
            "CANCELLED",
            "CLOSED",
        }
    ),
    "CANCELLED": frozenset({"CANCELLED", "CLOSED"}),
    "CLOSED": frozenset({"CLOSED"}),
}
_NEEDS_MESSAGE = frozenset(
    {
        "SENT",
        "WAITING_FOR_RESPONSE",
        "PARTIALLY_RECEIVED",
        "RECEIVED",
        "OVERDUE",
        "ESCALATED",
    }
)
_RESPONSE = frozenset({"PARTIALLY_RECEIVED", "RECEIVED"})
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$")
_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")
_COLUMNS = """
    id, project_id, operation_key, control_ref, owner_user_id, recipient, due_at,
    evidence_description, status, outbound_message_id, thread_id, first_response_at,
    received_at, attachment_refs, follow_up_after_days, max_follow_ups, escalation_state,
    cancellation_reason, version
"""


class PbcState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class PbcCreate(BaseModel):
    operation_key: str
    control_ref: str
    recipient: str
    due_at: datetime
    evidence_description: str = Field(min_length=1, max_length=4000)
    owner_user_id: UUID | None = None
    attachment_refs: list[str] = Field(default_factory=list, max_length=20)
    follow_up_after_days: int = Field(default=3, ge=1, le=30)
    max_follow_ups: int = Field(default=2, ge=0, le=10)

    @field_validator("due_at")
    @classmethod
    def due_has_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("due date needs a timezone")
        return value


class PbcUpdate(BaseModel):
    version: int = Field(ge=1)
    status: str
    recipient: str
    due_at: datetime
    evidence_description: str = Field(min_length=1, max_length=4000)
    control_ref: str
    attachment_refs: list[str] = Field(default_factory=list, max_length=20)
    outbound_message_id: str | None = None
    thread_id: str | None = None
    follow_up_after_days: int = Field(default=3, ge=1, le=30)
    max_follow_ups: int = Field(default=2, ge=0, le=10)
    cancellation_reason: str = ""

    @field_validator("due_at")
    @classmethod
    def due_has_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("due date needs a timezone")
        return value


class PbcBody(BaseModel):
    id: UUID
    project_id: UUID
    operation_key: str
    control_ref: str
    owner_user_id: UUID
    recipient: str
    due_at: datetime
    evidence_description: str
    status: str
    outbound_message_id: str | None
    thread_id: str | None
    first_response_at: datetime | None
    received_at: datetime | None
    attachment_refs: list[str]
    follow_up_after_days: int
    max_follow_ups: int
    escalation_state: str
    cancellation_reason: str
    version: int


def register_pbc(app: FastAPI, settings: Settings) -> None:
    @app.post("/organizations/{organization_id}/projects/{project_id}/pbc-requests")
    def create_request(
        organization_id: UUID, project_id: UUID, body: PbcCreate, request: Request
    ) -> PbcBody:
        _reject_secret(body.model_dump())
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _create(connection, principal, organization_id, project_id, body),
        )

    @app.get("/organizations/{organization_id}/projects/{project_id}/pbc-requests")
    def list_requests(organization_id: UUID, project_id: UUID, request: Request) -> list[PbcBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _list(connection, principal, organization_id, project_id),
        )

    @app.post("/organizations/{organization_id}/projects/{project_id}/pbc-requests/{request_id}")
    def update_request(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: PbcUpdate,
        request: Request,
    ) -> PbcBody:
        _reject_secret(body.model_dump())
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _update(
                connection, principal, organization_id, project_id, request_id, body
            ),
        )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        return _call(settings, work)
    except PbcState as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail="pbc fields are invalid") from error


def _create(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: PbcCreate,
) -> PbcBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    _fields(body.operation_key, body.control_ref, body.recipient, body.attachment_refs)
    if _project_status(connection, organization_id, project_id) != "ACTIVE":
        raise PbcState("project is not active")
    owner_id = body.owner_user_id or principal.id
    _require_owner(connection, organization_id, project_id, owner_id)
    existing = _by_key(connection, organization_id, project_id, body.operation_key)
    if existing is not None:
        if (
            existing.recipient != body.recipient.strip()
            or existing.control_ref != body.control_ref.strip()
            or existing.evidence_description != body.evidence_description.strip()
        ):
            raise PbcState("pbc key is already in use")
        return existing
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            INSERT INTO pbc_requests (
                organization_id, project_id, operation_key, control_ref, owner_user_id,
                recipient, due_at, evidence_description, attachment_refs,
                follow_up_after_days, max_follow_ups
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {_COLUMNS}
            """,
            (
                organization_id,
                project_id,
                body.operation_key.strip(),
                body.control_ref.strip(),
                owner_id,
                body.recipient.strip(),
                body.due_at,
                body.evidence_description.strip(),
                body.attachment_refs,
                body.follow_up_after_days,
                body.max_follow_ups,
            ),
        ).fetchone()
        if row is None:
            raise NotVisible()
        created = _body(row)
        _audit(cursor, organization_id, project_id, principal.id, created.id, "DRAFT")
    return created


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[PbcBody]:
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
        FROM pbc_requests
        WHERE organization_id = %s AND project_id = %s
        ORDER BY created_at, id
        """,
        (organization_id, project_id),
    ).fetchall()
    return [_body(row) for row in rows]


def _update(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    body: PbcUpdate,
) -> PbcBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    status = body.status.strip()
    if status not in _TRANSITIONS:
        raise ValueError("pbc fields are invalid")
    _fields("draft-key", body.control_ref, body.recipient, body.attachment_refs)
    reason = body.cancellation_reason.strip()
    if status == "CANCELLED" and reason == "":
        raise ValueError("pbc fields are invalid")
    if status != "CANCELLED" and reason != "":
        raise ValueError("pbc fields are invalid")
    message_id = _blank(body.outbound_message_id)
    thread_id = _blank(body.thread_id)
    if (message_id is None) != (thread_id is None):
        raise ValueError("pbc fields are invalid")
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, request_id)
        if current.version != body.version:
            raise PbcState("pbc request changed")
        if status not in _TRANSITIONS[current.status]:
            raise PbcState("pbc status is not allowed")
        if current.status != "DRAFT" and (
            body.recipient.strip() != current.recipient
            or body.control_ref.strip() != current.control_ref
            or body.evidence_description.strip() != current.evidence_description
        ):
            raise PbcState("pbc recipient is bound")
        if current.outbound_message_id is not None and (
            message_id != current.outbound_message_id or thread_id != current.thread_id
        ):
            raise PbcState("pbc message is bound")
        if status in _NEEDS_MESSAGE:
            if message_id is None or thread_id is None:
                raise PbcState("outbound message is required")
            _require_message(cursor, project_id, message_id, thread_id)
        elif status == "CLOSED":
            message_id = current.outbound_message_id
            thread_id = current.thread_id
        elif status != "CANCELLED":
            message_id = None
            thread_id = None
        escalation = "ESCALATED" if status == "ESCALATED" else "NONE"
        row = cursor.execute(
            f"""
            UPDATE pbc_requests
            SET recipient = %s,
                due_at = %s,
                evidence_description = %s,
                status = %s,
                outbound_message_id = %s,
                thread_id = %s,
                attachment_refs = %s,
                follow_up_after_days = %s,
                max_follow_ups = %s,
                escalation_state = %s,
                cancellation_reason = %s,
                control_ref = %s,
                first_response_at = CASE
                    WHEN %s AND first_response_at IS NULL THEN clock_timestamp()
                    ELSE first_response_at
                END,
                received_at = CASE
                    WHEN %s AND received_at IS NULL THEN clock_timestamp()
                    ELSE received_at
                END,
                updated_at = clock_timestamp(),
                version = version + 1
            WHERE id = %s AND version = %s
            RETURNING {_COLUMNS}
            """,
            (
                body.recipient.strip(),
                body.due_at,
                body.evidence_description.strip(),
                status,
                message_id,
                thread_id,
                body.attachment_refs,
                body.follow_up_after_days,
                body.max_follow_ups,
                escalation,
                reason if status == "CANCELLED" else "",
                body.control_ref.strip(),
                status in _RESPONSE or status == "RECEIVED",
                status == "RECEIVED",
                request_id,
                body.version,
            ),
        ).fetchone()
        if row is None:
            raise PbcState("pbc request changed")
        updated = _body(row)
        _audit(cursor, organization_id, project_id, principal.id, updated.id, status)
    return updated


def _fields(operation_key: str, control_ref: str, recipient: str, attachments: list[str]) -> None:
    if _KEY.fullmatch(operation_key.strip()) is None:
        raise ValueError("pbc fields are invalid")
    if (
        _REFERENCE.fullmatch(control_ref.strip()) is None
        or _EMAIL.fullmatch(recipient.strip()) is None
    ):
        raise ValueError("pbc fields are invalid")
    seen: set[str] = set()
    for item in attachments:
        if _REFERENCE.fullmatch(item) is None or item in seen:
            raise ValueError("pbc fields are invalid")
        seen.add(item)


def _project_status(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> str:
    row = connection.execute(
        """
        SELECT status::text FROM projects
        WHERE id = %s AND organization_id = %s
        """,
        (project_id, organization_id),
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    return row[0]


def _require_owner(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, user_id: UUID
) -> None:
    row = connection.execute(
        """
        SELECT 1 FROM memberships
        WHERE organization_id = %s AND user_id = %s AND status = 'ACTIVE'
          AND (
            role IN ('OWNER', 'ADMIN')
            OR EXISTS (
                SELECT 1 FROM project_memberships
                WHERE organization_id = %s AND project_id = %s AND user_id = %s
            )
          )
        """,
        (organization_id, user_id, organization_id, project_id, user_id),
    ).fetchone()
    if row is None:
        raise NotVisible()


def _require_message(
    cursor: psycopg.Cursor[Any], project_id: UUID, message_id: str, thread_id: str
) -> None:
    row = cursor.execute(
        """
        SELECT 1 FROM mailbox_messages
        WHERE project_id = %s AND provider_message_id = %s AND thread_id = %s
        """,
        (project_id, message_id, thread_id),
    ).fetchone()
    if row is None:
        raise PbcState("outbound message is required")


def _by_key(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, operation_key: str
) -> PbcBody | None:
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM pbc_requests
        WHERE organization_id = %s AND project_id = %s AND operation_key = %s
        """,
        (organization_id, project_id, operation_key.strip()),
    ).fetchone()
    if row is None:
        return None
    return _body(row)


def _lock(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, request_id: UUID
) -> PbcBody:
    row = cursor.execute(
        f"""
        SELECT {_COLUMNS}
        FROM pbc_requests
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (request_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _body(row)


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    request_id: UUID,
    status: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'pbc.updated', 'pbc_request', %s, %s)
        """,
        (organization_id, project_id, actor_id, request_id, Json({"status": status})),
    )


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _reject_secret(values: dict[str, Any]) -> None:
    texts = [str(item) for item in _strings(values)]
    if contains_secret({str(index): text for index, text in enumerate(texts)}):
        raise HTTPException(status_code=422, detail="pbc fields are invalid")


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        found: list[str] = []
        for item in value.values():
            found.extend(_strings(item))
        return found
    if isinstance(value, list):
        found = []
        for item in value:
            found.extend(_strings(item))
        return found
    return []


def _body(row: tuple[Any, ...]) -> PbcBody:
    if not isinstance(row[0], UUID) or not isinstance(row[8], str):
        raise NotVisible()
    attachments = row[13] if isinstance(row[13], list) else []
    return PbcBody(
        id=row[0],
        project_id=row[1],
        operation_key=str(row[2]),
        control_ref=str(row[3]),
        owner_user_id=row[4],
        recipient=str(row[5]),
        due_at=row[6],
        evidence_description=str(row[7]),
        status=row[8],
        outbound_message_id=row[9] if isinstance(row[9], str) else None,
        thread_id=row[10] if isinstance(row[10], str) else None,
        first_response_at=row[11] if isinstance(row[11], datetime) else None,
        received_at=row[12] if isinstance(row[12], datetime) else None,
        attachment_refs=[str(item) for item in attachments],
        follow_up_after_days=int(row[14]),
        max_follow_ups=int(row[15]),
        escalation_state=str(row[16]),
        cancellation_reason=str(row[17]),
        version=int(row[18]),
    )
