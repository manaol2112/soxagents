from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret, find_action, parameters_ok
from ai_workforce_api.approvals import payload_hash
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.mailbox import MailboxUnavailable, open_mailbox
from ai_workforce_api.policy import evaluate
from ai_workforce_api.settings import Settings
from ai_workforce_api.tasks import TaskCreateBody, create_task

MAIL = frozenset({"mail.draft", "mail.reminder", "mail.external"})
TEMPLATED = frozenset({"mail.pbc"})
UNAVAILABLE = frozenset({"workpaper.update", "report.finalize"})


class ExecutionCreate(BaseModel):
    action_id: str = Field(min_length=1, max_length=100)
    parameters: dict[str, str] = Field(default_factory=dict)
    approval_id: UUID | None = None


class ExecutionBody(BaseModel):
    id: UUID
    action_id: str
    status: str
    approval_id: UUID | None
    result_ref: str | None
    reason: str | None


class ExecutionState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


def register_execution(app: FastAPI, settings: Settings) -> None:
    @app.post("/organizations/{organization_id}/projects/{project_id}/actions/execute")
    def execute(
        organization_id: UUID, project_id: UUID, body: ExecutionCreate, request: Request
    ) -> ExecutionBody:
        if contains_secret(body.parameters):
            raise HTTPException(status_code=422, detail="action fields are invalid")
        principal = _session_principal(request)
        try:
            return _call(
                settings,
                lambda connection: _execute(
                    connection, settings, principal, organization_id, project_id, body
                ),
            )
        except ExecutionState as error:
            raise HTTPException(status_code=409, detail=error.detail) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail="action fields are invalid") from error


def _execute(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ExecutionCreate,
) -> ExecutionBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    definition = find_action(body.action_id.strip())
    if definition is None or not parameters_ok(definition, body.parameters):
        raise ValueError("action fields are invalid")
    if definition.action_id in TEMPLATED:
        raise ExecutionState("action requires an approved template")
    parameters = {key: value.strip() for key, value in body.parameters.items()}
    agent_id = _agent_id(connection, organization_id, project_id, body.approval_id)
    digest = payload_hash(organization_id, project_id, definition.action_id, agent_id, parameters)
    existing = _existing(connection, project_id, digest)
    if existing is not None:
        return existing
    if (
        evaluate(
            connection, principal, organization_id, project_id, definition.action_id, parameters
        ).decision
        != "ALLOW"
    ):
        raise ExecutionState("action is not allowed")
    _require_approval(definition.approval, body.approval_id)
    try:
        with transaction(connection) as cursor:
            if definition.approval != "NONE" and _lock_approval(
                cursor,
                organization_id,
                project_id,
                body.approval_id,
                definition.action_id,
                digest,
            ):
                found = _existing(connection, project_id, digest)
                if found is None:
                    raise ExecutionState("approval is not approved")
                return found
            if not parameters_ok(definition, parameters):
                raise ValueError("action fields are invalid")
            if (
                evaluate(
                    connection,
                    principal,
                    organization_id,
                    project_id,
                    definition.action_id,
                    parameters,
                ).decision
                != "ALLOW"
            ):
                raise ExecutionState("action is not allowed")
            status, result_ref, reason = _perform(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                definition.action_id,
                parameters,
                digest,
            )
            recorded = _insert(
                cursor,
                organization_id,
                project_id,
                principal.id,
                body.approval_id,
                definition.action_id,
                digest,
                status,
                result_ref,
                reason,
            )
            if body.approval_id is not None:
                _mark(cursor, body.approval_id, status)
            _audit(cursor, organization_id, principal.id, recorded.id, status)
            return recorded
    except UniqueViolation:
        winner = _existing(connection, project_id, digest)
        if winner is None:
            raise
        return winner


def _agent_id(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID | None,
) -> UUID | None:
    if approval_id is None:
        return None
    row = connection.execute(
        """
        SELECT requesting_agent_id
        FROM approvals
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (approval_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    agent_id = row[0]
    if agent_id is not None and not isinstance(agent_id, UUID):
        raise NotVisible()
    return agent_id


def _require_approval(level: str, approval_id: UUID | None) -> None:
    if level != "NONE" and approval_id is None:
        raise ExecutionState("approval is required")
    if level == "NONE" and approval_id is not None:
        raise ExecutionState("approval does not match")


def _lock_approval(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID | None,
    action_id: str,
    digest: str,
) -> bool:
    row = cursor.execute(
        """
        SELECT decision::text, action_id, payload_hash, execution_status,
               expires_at <= clock_timestamp()
        FROM approvals
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (approval_id, organization_id, project_id),
    ).fetchone()
    if row is None or not isinstance(row[0], str) or not isinstance(row[1], str):
        raise NotVisible()
    if row[1] != action_id or row[2] != digest:
        raise ExecutionState("approval does not match")
    if row[0] == "APPROVED" and row[3] in {"SUCCEEDED", "REFUSED"}:
        return True
    if row[4] is True:
        raise ExecutionState("approval has expired")
    if row[0] != "APPROVED" or row[3] != "NOT_STARTED":
        raise ExecutionState("approval is not approved")
    return False


def _perform(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    action_id: str,
    parameters: dict[str, str],
    digest: str,
) -> tuple[str, str | None, str | None]:
    if action_id in MAIL or action_id == "attachment.retrieve":
        return _use_mailbox(
            connection, settings, organization_id, project_id, action_id, parameters, digest
        )
    if action_id in UNAVAILABLE:
        return ("REFUSED", None, "not_available")
    if action_id == "task.create":
        created = create_task(
            connection,
            principal,
            organization_id,
            project_id,
            TaskCreateBody(title=parameters["title"], status="DRAFT"),
        )
        return ("SUCCEEDED", str(created.id), None)
    if action_id == "file.read":
        return ("SUCCEEDED", parameters["resource_ref"], None)
    if action_id == "permission.modify":
        return _modify_permission(connection, organization_id, principal.id, parameters)
    return ("REFUSED", None, "not_available")


def _use_mailbox(
    connection: psycopg.Connection[Any],
    settings: Settings,
    organization_id: UUID,
    project_id: UUID,
    action_id: str,
    parameters: dict[str, str],
    digest: str,
) -> tuple[str, str | None, str | None]:
    mailbox = open_mailbox(settings, connection, organization_id, project_id)
    thread_id = parameters.get("thread_ref")
    body = parameters.get("request_ref", "")
    try:
        if action_id == "attachment.retrieve":
            attachment = mailbox.retrieve_attachment(parameters["attachment_ref"])
            return ("SUCCEEDED", attachment.attachment_ref, None)
        if action_id == "mail.draft":
            message = mailbox.create_draft(
                idempotency_key=digest,
                recipient=parameters["recipient"],
                subject=parameters["subject"],
                body=body,
                thread_id=thread_id,
            )
        else:
            message = mailbox.send(
                idempotency_key=digest,
                recipient=parameters["recipient"],
                subject=parameters["subject"],
                body=body,
                thread_id=thread_id,
            )
    except MailboxUnavailable:
        return ("REFUSED", None, "live_email_disabled")
    except NotVisible:
        return ("REFUSED", None, "not_available")
    return ("SUCCEEDED", message.provider_message_id, None)


def _modify_permission(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    actor_id: UUID,
    parameters: dict[str, str],
) -> tuple[str, str | None, str | None]:
    target = _target_user(parameters["target_user_ref"])
    if target is None:
        return ("REFUSED", None, "not_available")
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            SELECT id, role::text
            FROM memberships
            WHERE organization_id = %s AND user_id = %s
            FOR UPDATE
            """,
            (organization_id, target),
        ).fetchone()
        if row is None or not isinstance(row[0], UUID) or not isinstance(row[1], str):
            return ("REFUSED", None, "not_available")
        if row[1] in {"OWNER", "ADMIN"}:
            return ("REFUSED", None, "protected_role")
        cursor.execute(
            """
            UPDATE memberships
            SET role = %s, version = version + 1
            WHERE organization_id = %s AND user_id = %s
            """,
            (parameters["role"], organization_id, target),
        )
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, actor_user_id, action, target_type, target_id, payload
            )
            VALUES (%s, %s, 'membership.grant', 'membership', %s, %s)
            """,
            (
                organization_id,
                actor_id,
                row[0],
                Json({"role": parameters["role"], "status": "ACTIVE"}),
            ),
        )
    return ("SUCCEEDED", f"user/{target}", None)


def _target_user(reference: str) -> UUID | None:
    prefix, _, value = reference.partition("/")
    if prefix != "user":
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def _existing(
    connection: psycopg.Connection[Any], project_id: UUID, digest: str
) -> ExecutionBody | None:
    row = connection.execute(
        """
        SELECT id, action_id, status, approval_id, result_ref, reason
        FROM action_executions
        WHERE project_id = %s AND payload_hash = %s
        """,
        (project_id, digest),
    ).fetchone()
    if row is None:
        return None
    return _record(row)


def _insert(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    approval_id: UUID | None,
    action_id: str,
    digest: str,
    status: str,
    result_ref: str | None,
    reason: str | None,
) -> ExecutionBody:
    row = cursor.execute(
        """
        INSERT INTO action_executions (
            organization_id, project_id, actor_user_id, approval_id, action_id,
            payload_hash, status, result_ref, reason
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, action_id, status, approval_id, result_ref, reason
        """,
        (
            organization_id,
            project_id,
            actor_id,
            approval_id,
            action_id,
            digest,
            status,
            result_ref,
            reason,
        ),
    ).fetchone()
    if row is None:
        raise ExecutionState("action is not allowed")
    return _record(row)


def _mark(cursor: psycopg.Cursor[Any], approval_id: UUID, status: str) -> None:
    cursor.execute(
        """
        UPDATE approvals
        SET execution_status = %s, version = version + 1
        WHERE id = %s AND decision = 'APPROVED' AND execution_status = 'NOT_STARTED'
        """,
        (status, approval_id),
    )
    if cursor.rowcount != 1:
        raise ExecutionState("approval is not approved")


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    actor_id: UUID,
    execution_id: UUID,
    status: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, 'execution.completed', 'action_execution', %s, %s)
        """,
        (organization_id, actor_id, execution_id, Json({"status": status})),
    )


def _record(row: tuple[Any, ...]) -> ExecutionBody:
    if not isinstance(row[0], UUID) or not isinstance(row[1], str) or not isinstance(row[2], str):
        raise NotVisible()
    approval_id = row[3]
    result_ref = row[4]
    reason = row[5]
    if approval_id is not None and not isinstance(approval_id, UUID):
        raise NotVisible()
    if result_ref is not None and not isinstance(result_ref, str):
        raise NotVisible()
    if reason is not None and not isinstance(reason, str):
        raise NotVisible()
    return ExecutionBody(
        id=row[0],
        action_id=row[1],
        status=row[2],
        approval_id=approval_id,
        result_ref=result_ref,
        reason=reason,
    )
