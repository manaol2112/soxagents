"""Approval requests bound to exact action parameters. Nothing here executes the action."""

import hashlib
import json
import re
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret, find_action
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
    permits,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.policy import evaluate
from ai_workforce_api.settings import Settings

ApprovalDecisionName = Literal["PENDING", "APPROVED", "REJECTED", "EXPIRED"]
_TARGET_FIELDS = (
    "resource_ref",
    "attachment_ref",
    "workpaper_ref",
    "report_ref",
    "request_ref",
    "thread_ref",
    "target_user_ref",
    "recipient",
)
_COLUMNS = """
    id, requesting_user_id, requesting_agent_id, action_id, parameters, target_resource, risk,
    payload_hash, approver_user_id, decision, decision_reason, execution_status, expires_at
"""


class ApprovalState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class ApprovalBody(BaseModel):
    id: UUID
    requesting_user_id: UUID
    requesting_agent_id: UUID | None
    action_id: str
    parameters: dict[str, str]
    target_resource: str
    risk: str
    payload_hash: str
    approver_user_id: UUID | None
    decision: str
    decision_reason: str | None
    execution_status: str
    expires_at: datetime


class ApprovalCreate(BaseModel):
    action_id: str = Field(pattern=r"^[a-z]+(?:[.][a-z]+)*$", max_length=40)
    parameters: dict[str, str] = Field(default_factory=dict)
    requesting_agent_id: UUID | None = None


class ApprovalDecision(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    reason: str = Field(min_length=1, max_length=500)


def register_approvals(app: FastAPI, settings: Settings) -> None:
    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/approvals",
        response_model=ApprovalBody,
    )
    def create_approval(
        organization_id: UUID,
        project_id: UUID,
        body: ApprovalCreate,
        request: Request,
    ) -> ApprovalBody:
        principal = _session_principal(request)
        if contains_secret(body.parameters):
            raise HTTPException(status_code=422, detail="approval fields are invalid")
        return _run(
            settings,
            lambda connection: _request(connection, principal, organization_id, project_id, body),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/approvals",
        response_model=list[ApprovalBody],
    )
    def list_approvals(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[ApprovalBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _list(connection, principal, organization_id, project_id),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/approvals/{approval_id}",
        response_model=ApprovalBody,
    )
    def read_approval(
        organization_id: UUID, project_id: UUID, approval_id: UUID, request: Request
    ) -> ApprovalBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _read(
                connection, principal, organization_id, project_id, approval_id
            ),
        )

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/approvals/{approval_id}/decision",
        response_model=ApprovalBody,
    )
    def decide_approval(
        organization_id: UUID,
        project_id: UUID,
        approval_id: UUID,
        body: ApprovalDecision,
        request: Request,
    ) -> ApprovalBody:
        principal = _session_principal(request)
        if body.reason.strip() == "" or contains_secret({"reason": body.reason}):
            raise HTTPException(status_code=422, detail="approval fields are invalid")
        recorded = _run(
            settings,
            lambda connection: _decide(
                connection, principal, organization_id, project_id, approval_id, body
            ),
        )
        if recorded.decision == "EXPIRED":
            raise HTTPException(status_code=409, detail="approval has expired")
        return recorded


def payload_hash(
    organization_id: UUID,
    project_id: UUID,
    action_id: str,
    agent_id: UUID | None,
    parameters: dict[str, str],
) -> str:
    body = {
        "action_id": action_id,
        "organization_id": str(organization_id),
        "parameters": {key: value.strip() for key, value in sorted(parameters.items())},
        "project_id": str(project_id),
        "requesting_agent_id": "" if agent_id is None else str(agent_id),
    }
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _request(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ApprovalCreate,
) -> ApprovalBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    decision = evaluate(
        connection,
        principal,
        organization_id,
        project_id,
        body.action_id,
        body.parameters,
    )
    if decision.decision != "ALLOW":
        raise ApprovalState("action is not allowed")
    action = find_action(body.action_id)
    if action is None or action.approval == "NONE":
        raise ValueError("approval is not required")
    _active_agent(connection, organization_id, body.requesting_agent_id)
    stripped = {key: value.strip() for key, value in body.parameters.items()}
    digest = payload_hash(
        organization_id, project_id, body.action_id, body.requesting_agent_id, stripped
    )
    current = _pending(connection, project_id, principal.id, digest)
    if current is not None:
        return current
    _expire_pending(connection, organization_id, project_id, principal.id, digest)
    target = _target(stripped)
    try:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO approvals (
                    organization_id, project_id, requesting_user_id, requesting_agent_id,
                    action_id, parameters, target_resource, risk, payload_hash, expires_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, clock_timestamp() + interval '24 hours')
                RETURNING id
                """,
                (
                    organization_id,
                    project_id,
                    principal.id,
                    body.requesting_agent_id,
                    body.action_id,
                    Json(stripped),
                    target,
                    action.risk,
                    digest,
                ),
            )
            row = cursor.fetchone()
            if row is None or not isinstance(row[0], UUID):
                raise NotVisible()
            _audit(
                cursor,
                organization_id,
                project_id,
                principal.id,
                row[0],
                "approval.requested",
                "PENDING",
            )
            approval_id = row[0]
    except UniqueViolation:
        raced = _pending(connection, project_id, principal.id, digest)
        if raced is None:
            raise NotVisible() from None
        return raced
    recorded = _load(connection, organization_id, project_id, approval_id)
    if recorded is None:
        raise NotVisible()
    return recorded


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[ApprovalBody]:
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
        FROM approvals
        WHERE organization_id = %s AND project_id = %s
        ORDER BY created_at
        """,
        (organization_id, project_id),
    ).fetchall()
    return [_body(row) for row in rows]


def _read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
) -> ApprovalBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    recorded = _load(connection, organization_id, project_id, approval_id)
    if recorded is None:
        raise NotVisible()
    return recorded


def _decide(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
    body: ApprovalDecision,
) -> ApprovalBody:
    reason = body.reason.strip()
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, approval_id)
        if current is None:
            raise NotVisible()
        if current.requesting_user_id == principal.id:
            raise ApprovalState("requester cannot approve")
        if current.decision != "PENDING":
            raise ApprovalState("approval is already decided")
        permission = (
            Action.ORGANIZATION_UPDATE if _organization_level(current) else Action.PROJECT_UPDATE
        )
        if not permits(
            connection,
            principal=principal,
            action=permission,
            organization_id=organization_id,
            project_id=project_id,
        ):
            raise AccessDenied()
        expired = _is_expired(cursor, approval_id)
        if expired:
            cursor.execute(
                """
                UPDATE approvals
                SET decision = 'EXPIRED', decided_at = clock_timestamp(), version = version + 1
                WHERE id = %s AND decision = 'PENDING'
                """,
                (approval_id,),
            )
            _audit(
                cursor,
                organization_id,
                project_id,
                principal.id,
                approval_id,
                "approval.expired",
                "EXPIRED",
            )
        else:
            cursor.execute(
                """
                UPDATE approvals
                SET decision = %s,
                    decision_reason = %s,
                    approver_user_id = %s,
                    decided_at = clock_timestamp(),
                    version = version + 1
                WHERE id = %s AND decision = 'PENDING'
                """,
                (body.decision, reason, principal.id, approval_id),
            )
            _audit(
                cursor,
                organization_id,
                project_id,
                principal.id,
                approval_id,
                "approval.decided",
                body.decision,
            )
            if body.decision == "REJECTED":
                return_for_revision(
                    cursor, organization_id, project_id, principal.id, current, reason
                )
    recorded = _load(connection, organization_id, project_id, approval_id)
    if recorded is None:
        raise NotVisible()
    return recorded


# An evidence request's first send: pbc/{request}/{template}-v{n}/{digest}. A reminder's
# reference has a fourth part (outbound.py) and leaves the request as it is.
_REQUEST_SEND = re.compile(r"^pbc/([0-9a-f-]{36})/[^/]+/[^/]+$", re.IGNORECASE)


def return_for_revision(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    approver_id: UUID,
    approval: ApprovalBody,
    reason: str,
) -> UUID | None:
    """A rejected evidence request goes back to draft so it can be revised, unless another
    approval of it is still open or approved. Returns the request, or None."""
    if approval.action_id != "mail.pbc":
        return None
    match = _REQUEST_SEND.match(approval.parameters.get("request_ref", ""))
    if match is None:
        return None
    request_id = UUID(match.group(1))
    row = cursor.execute(
        """
        UPDATE pbc_requests r
        SET status = 'DRAFT', version = r.version + 1, updated_at = clock_timestamp()
        WHERE r.id = %s AND r.project_id = %s AND r.organization_id = %s
          AND r.status = 'APPROVAL_PENDING'
          AND NOT EXISTS (
              SELECT 1 FROM approvals a
              WHERE a.project_id = r.project_id AND a.id <> %s AND a.action_id = 'mail.pbc'
                AND a.parameters ->> 'request_ref' LIKE 'pbc/' || r.id::text || '/%%'
                AND (a.decision = 'PENDING'
                     OR (a.decision = 'APPROVED' AND a.execution_status = 'NOT_STARTED'))
          )
        RETURNING r.id
        """,
        (request_id, project_id, organization_id, approval.id),
    ).fetchone()
    if row is None:
        return None
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'pbc.returned_for_revision', 'pbc_request', %s, %s)
        """,
        (
            organization_id,
            project_id,
            approver_id,
            request_id,
            Json({"approval_id": str(approval.id), "reason": reason, "status": "DRAFT"}),
        ),
    )
    return request_id


def approve_agent_request(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    approver_id: UUID,
    approval_id: UUID,
    reason: str,
) -> None:
    """A person approves what an agent asked for. Internal only: the caller has checked
    the person's right to approve and that an agent drafted what is approved (the public
    decision endpoint keeps its rule that a requester never approves)."""
    row = cursor.execute(
        """
        UPDATE approvals
        SET decision = 'APPROVED', decision_reason = %s, approver_user_id = %s,
            decided_at = clock_timestamp(), version = version + 1
        WHERE id = %s AND organization_id = %s AND project_id = %s
          AND decision = 'PENDING' AND requesting_agent_id IS NOT NULL
        RETURNING id
        """,
        (reason, approver_id, approval_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise ApprovalState("approval is already decided")
    _audit(
        cursor, organization_id, project_id, approver_id, approval_id, "approval.decided",
        "APPROVED",
    )  # fmt: skip


def approve_own(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    person_id: UUID,
    approval_id: UUID,
    reason: str,
) -> None:
    """A person approves their own request, where the product owner decided a second
    person adds nothing: a reminder of a request already approved, in the reviewed
    reminder wording; and a message carried over unchanged from an approval whose send
    was refused because email was off. Internal only: the caller checks which case it
    is. The approval is recorded like any other, with the reason, and stays immutable;
    an agent's request is never approved this way."""
    row = cursor.execute(
        """
        UPDATE approvals
        SET decision = 'APPROVED', decision_reason = %s, approver_user_id = %s,
            decided_at = clock_timestamp(), version = version + 1
        WHERE id = %s AND organization_id = %s AND project_id = %s
          AND decision = 'PENDING' AND requesting_user_id = %s
          AND requesting_agent_id IS NULL AND expires_at > clock_timestamp()
        RETURNING id
        """,
        (reason[:500], person_id, approval_id, organization_id, project_id, person_id),
    ).fetchone()
    if row is None:
        raise ApprovalState("approval is already decided")
    _audit(
        cursor, organization_id, project_id, person_id, approval_id, "approval.self_approved",
        "APPROVED",
    )  # fmt: skip


def _organization_level(current: ApprovalBody) -> bool:
    action = find_action(current.action_id)
    return action is not None and action.approval == "ORGANIZATION"


def _active_agent(
    connection: psycopg.Connection[Any], organization_id: UUID, agent_id: UUID | None
) -> None:
    if agent_id is None:
        return
    row = connection.execute(
        """
        SELECT status::text FROM agent_definitions
        WHERE id = %s AND organization_id = %s
        """,
        (agent_id, organization_id),
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    if row[0] != "ACTIVE":
        raise ApprovalState("disabled agent cannot request approval")


def _target(parameters: dict[str, str]) -> str:
    for name in _TARGET_FIELDS:
        value = parameters.get(name, "").strip()
        if value != "":
            return value
    raise ValueError("approval fields are invalid")


def _pending(
    connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID, digest: str
) -> ApprovalBody | None:
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM approvals
        WHERE project_id = %s
          AND requesting_user_id = %s
          AND payload_hash = %s
          AND decision = 'PENDING'
          AND expires_at > clock_timestamp()
        """,
        (project_id, user_id, digest),
    ).fetchone()
    if row is None:
        return None
    return _body(row)


def _expire_pending(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
    digest: str,
) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE approvals
            SET decision = 'EXPIRED', decided_at = clock_timestamp(), version = version + 1
            WHERE organization_id = %s
              AND project_id = %s
              AND requesting_user_id = %s
              AND payload_hash = %s
              AND decision = 'PENDING'
              AND expires_at <= clock_timestamp()
            RETURNING id
            """,
            (organization_id, project_id, user_id, digest),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[0], UUID):
            return
        _audit(
            cursor,
            organization_id,
            project_id,
            user_id,
            row[0],
            "approval.expired",
            "EXPIRED",
        )


def _is_expired(cursor: psycopg.Cursor[Any], approval_id: UUID) -> bool:
    row = cursor.execute(
        """
        SELECT expires_at <= clock_timestamp() FROM approvals WHERE id = %s
        """,
        (approval_id,),
    ).fetchone()
    return row is not None and row[0] is True


def _lock(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, approval_id: UUID
) -> ApprovalBody | None:
    row = cursor.execute(
        f"""
        SELECT {_COLUMNS}
        FROM approvals
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (approval_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        return None
    return _body(row)


def _load(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
) -> ApprovalBody | None:
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM approvals
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (approval_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        return None
    return _body(row)


def _body(row: tuple[Any, ...]) -> ApprovalBody:
    (
        approval_id,
        requester_id,
        agent_id,
        action_id,
        parameters,
        target,
        risk,
        digest,
        approver_id,
        decision,
        reason,
        execution_status,
        expires_at,
    ) = row
    if (
        not isinstance(approval_id, UUID)
        or not isinstance(requester_id, UUID)
        or not isinstance(action_id, str)
        or not isinstance(parameters, dict)
        or not isinstance(target, str)
        or not isinstance(risk, str)
        or not isinstance(digest, str)
        or not isinstance(decision, str)
        or not isinstance(execution_status, str)
        or not isinstance(expires_at, datetime)
        or not (agent_id is None or isinstance(agent_id, UUID))
        or not (approver_id is None or isinstance(approver_id, UUID))
        or not (reason is None or isinstance(reason, str))
    ):
        raise NotVisible()
    stored = {
        key: value
        for key, value in parameters.items()
        if isinstance(key, str) and isinstance(value, str)
    }
    return ApprovalBody(
        id=approval_id,
        requesting_user_id=requester_id,
        requesting_agent_id=agent_id,
        action_id=action_id,
        parameters=stored,
        target_resource=target,
        risk=risk,
        payload_hash=digest,
        approver_user_id=approver_id,
        decision=decision,
        decision_reason=reason,
        execution_status=execution_status,
        expires_at=expires_at,
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    approval_id: UUID,
    action: str,
    decision: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'approval', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, approval_id, Json({"decision": decision})),
    )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except ApprovalState as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except ValueError:
        raise HTTPException(status_code=422, detail="approval is not required") from None
    return result
