"""Versioned worker results. A handoff is recorded. Proposed actions are not executed."""

import json
import re
from collections.abc import Callable
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

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

SCHEMA_VERSION = 1
ResultStatus = Literal["SUCCEEDED", "FAILED", "BLOCKED", "NEEDS_APPROVAL"]
LimitationCode = Literal["partial_population", "missing_evidence", "assumption", "scope"]
ErrorCode = Literal["timeout", "malformed", "blocked", "unavailable", "limit"]
ActionCode = Literal["clarify", "replan", "review", "stop"]
_ACCEPTING = frozenset({"RUNNING", "WAITING", "BLOCKED", "REVIEW"})
_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$")
_SECRET_TEXT = re.compile(
    r"(?i)(api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|"
    r"private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY"
)
_SECRET_KEYS = frozenset(
    {
        "api_key",
        "apikey",
        "secret",
        "password",
        "token",
        "access_token",
        "refresh_token",
        "client_secret",
        "private_key",
    }
)
_POLICY = ("send email", "send an email", "grant role", "change permission", "execute tool")


class HandoffConflict(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class ResultErrorBody(BaseModel):
    code: ErrorCode
    detail: str = Field(min_length=1, max_length=500)


class ProposedActionBody(BaseModel):
    action: ActionCode
    reason: str = Field(default="", max_length=500)


class RequiredApprovalBody(BaseModel):
    code: Literal["review"]


class WorkerResultBody(BaseModel):
    id: UUID
    schema_version: int
    result_version: int
    operation_key: str
    task_id: UUID
    agent_definition_id: UUID
    agent_revision: int
    status: str
    summary: str
    output: dict[str, Any]
    artifact_refs: list[str]
    evidence_refs: list[str]
    errors: list[ResultErrorBody]
    limitations: list[str]
    proposed_actions: list[ProposedActionBody]
    required_approval: RequiredApprovalBody | None


class WorkerResultCreate(BaseModel):
    operation_key: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$")
    task_id: UUID
    agent_definition_id: UUID
    agent_revision: int = Field(ge=1, le=1000)
    status: ResultStatus
    summary: str = Field(min_length=1, max_length=2000)
    output: dict[str, Any]
    artifact_refs: list[str] = Field(default_factory=list, max_length=20)
    evidence_refs: list[str] = Field(default_factory=list, max_length=20)
    errors: list[ResultErrorBody] = Field(default_factory=list, max_length=8)
    limitations: list[LimitationCode] = Field(default_factory=list, max_length=8)
    proposed_actions: list[ProposedActionBody] = Field(default_factory=list, max_length=8)
    required_approval: RequiredApprovalBody | None = None


def register_handoffs(app: FastAPI, settings: Settings) -> None:
    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/worker-results",
        response_model=WorkerResultBody,
    )
    def create_result(
        organization_id: UUID,
        project_id: UUID,
        body: WorkerResultCreate,
        request: Request,
    ) -> WorkerResultBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _create(connection, principal, organization_id, project_id, body),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/worker-results",
        response_model=list[WorkerResultBody],
    )
    def list_results(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[WorkerResultBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _list(connection, principal, organization_id, project_id),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/worker-results/{result_id}",
        response_model=WorkerResultBody,
    )
    def read_result(
        organization_id: UUID, project_id: UUID, result_id: UUID, request: Request
    ) -> WorkerResultBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _read(connection, principal, organization_id, project_id, result_id),
        )


def _create(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: WorkerResultCreate,
) -> WorkerResultBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    _validated(body)
    with transaction(connection) as cursor:
        task_status = _locked_task(cursor, organization_id, project_id, body.task_id)
        if task_status not in _ACCEPTING:
            raise HandoffConflict("task cannot accept a result")
        _matching_definition(cursor, organization_id, body.agent_definition_id, body.agent_revision)
        existing = _by_key(cursor, organization_id, project_id, body.operation_key)
        if existing is not None:
            if existing.task_id != body.task_id:
                raise HandoffConflict("handoff key is already in use")
            return existing
        result_version = _next_version(cursor, body.task_id)
        cursor.execute(
            """
            INSERT INTO worker_results (
                organization_id, project_id, task_id, actor_user_id, agent_definition_id,
                agent_revision, schema_version, result_version, operation_key, status, summary,
                output, artifact_refs, evidence_refs, errors, limitations, proposed_actions,
                required_approval
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                body.task_id,
                principal.id,
                body.agent_definition_id,
                body.agent_revision,
                SCHEMA_VERSION,
                result_version,
                body.operation_key,
                body.status,
                body.summary.strip(),
                Json(body.output),
                Json(body.artifact_refs),
                Json(body.evidence_refs),
                Json([item.model_dump() for item in body.errors]),
                Json(list(body.limitations)),
                Json([item.model_dump() for item in body.proposed_actions]),
                Json(body.required_approval.model_dump()) if body.required_approval else None,
            ),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[0], UUID):
            raise NotVisible()
        result_id = row[0]
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id, payload
            )
            VALUES (%s, %s, %s, 'worker.result_recorded', 'worker_result', %s, %s)
            """,
            (
                organization_id,
                project_id,
                principal.id,
                result_id,
                Json({"status": body.status, "schema_version": SCHEMA_VERSION}),
            ),
        )
    return WorkerResultBody(
        id=result_id,
        schema_version=SCHEMA_VERSION,
        result_version=result_version,
        operation_key=body.operation_key,
        task_id=body.task_id,
        agent_definition_id=body.agent_definition_id,
        agent_revision=body.agent_revision,
        status=body.status,
        summary=body.summary.strip(),
        output=body.output,
        artifact_refs=body.artifact_refs,
        evidence_refs=body.evidence_refs,
        errors=body.errors,
        limitations=list(body.limitations),
        proposed_actions=body.proposed_actions,
        required_approval=body.required_approval,
    )


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[WorkerResultBody]:
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
        FROM worker_results
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
    result_id: UUID,
) -> WorkerResultBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM worker_results
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (result_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _body(row)


def _validated(body: WorkerResultCreate) -> None:
    texts = [body.summary, *(item.detail for item in body.errors)]
    texts.extend(item.reason for item in body.proposed_actions)
    if any(_SECRET_TEXT.search(text) or _policy(text) for text in texts):
        raise ValueError("handoff fields are invalid")
    if body.status == "SUCCEEDED" and body.output == {}:
        raise ValueError("handoff fields are invalid")
    if body.status == "NEEDS_APPROVAL" and body.required_approval is None:
        raise ValueError("handoff fields are invalid")
    if len(set(body.limitations)) != len(body.limitations):
        raise ValueError("handoff fields are invalid")
    _references(body.artifact_refs)
    _references(body.evidence_refs)
    if len(json.dumps(body.output)) > 8000 or not _output_ok(body.output, 0):
        raise ValueError("handoff fields are invalid")


def _references(values: list[str]) -> None:
    if len(set(values)) != len(values):
        raise ValueError("handoff fields are invalid")
    for value in values:
        if _REFERENCE.fullmatch(value) is None or _SECRET_TEXT.search(value) or _policy(value):
            raise ValueError("handoff fields are invalid")


def _output_ok(value: Any, depth: int) -> bool:
    if depth > 4:
        return False
    if value is None or isinstance(value, bool | int | float):
        return True
    if isinstance(value, str):
        return _SECRET_TEXT.search(value) is None and not _policy(value)
    if isinstance(value, list):
        return len(value) <= 40 and all(_output_ok(item, depth + 1) for item in value)
    if isinstance(value, dict):
        if len(value) > 40:
            return False
        for key, item in value.items():
            if not isinstance(key, str):
                return False
            normalized = key.lower().replace("-", "_")
            if normalized in _SECRET_KEYS or _SECRET_TEXT.search(key) or _policy(key):
                return False
            if not _output_ok(item, depth + 1):
                return False
        return True
    return False


def _policy(value: str) -> bool:
    lowered = value.lower()
    return any(phrase in lowered for phrase in _POLICY)


def _locked_task(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, task_id: UUID
) -> str:
    row = cursor.execute(
        """
        SELECT status::text FROM tasks
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (task_id, organization_id, project_id),
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    return row[0]


def _matching_definition(
    cursor: psycopg.Cursor[Any], organization_id: UUID, definition_id: UUID, revision: int
) -> None:
    row = cursor.execute(
        """
        SELECT revision, status::text FROM agent_definitions
        WHERE id = %s AND organization_id = %s
        """,
        (definition_id, organization_id),
    ).fetchone()
    if row is None or not isinstance(row[0], int) or not isinstance(row[1], str):
        raise NotVisible()
    if row[1] != "ACTIVE":
        raise HandoffConflict("disabled agent cannot submit a result")
    if row[0] != revision:
        raise HandoffConflict("agent version does not match")


def _next_version(cursor: psycopg.Cursor[Any], task_id: UUID) -> int:
    row = cursor.execute(
        "SELECT COALESCE(MAX(result_version), 0) FROM worker_results WHERE task_id = %s",
        (task_id,),
    ).fetchone()
    if row is None or not isinstance(row[0], int):
        raise NotVisible()
    return row[0] + 1


_COLUMNS = """
    id, schema_version, result_version, operation_key, task_id, agent_definition_id,
    agent_revision, status, summary, output, artifact_refs, evidence_refs, errors,
    limitations, proposed_actions, required_approval
"""


def _by_key(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, operation_key: str
) -> WorkerResultBody | None:
    row = cursor.execute(
        f"""
        SELECT {_COLUMNS}
        FROM worker_results
        WHERE organization_id = %s AND project_id = %s AND operation_key = %s
        """,
        (organization_id, project_id, operation_key),
    ).fetchone()
    if row is None:
        return None
    return _body(row)


def _body(row: tuple[Any, ...]) -> WorkerResultBody:
    (
        result_id,
        schema_version,
        result_version,
        operation_key,
        task_id,
        definition_id,
        revision,
        status,
        summary,
        output,
        artifacts,
        evidence,
        errors,
        limitations,
        actions,
        approval,
    ) = row
    if (
        not isinstance(result_id, UUID)
        or not isinstance(schema_version, int)
        or not isinstance(result_version, int)
        or not isinstance(operation_key, str)
        or not isinstance(task_id, UUID)
        or not isinstance(definition_id, UUID)
        or not isinstance(revision, int)
        or not isinstance(status, str)
        or not isinstance(summary, str)
        or not isinstance(output, dict)
        or not isinstance(artifacts, list)
        or not isinstance(evidence, list)
        or not isinstance(errors, list)
        or not isinstance(limitations, list)
        or not isinstance(actions, list)
    ):
        raise NotVisible()
    return WorkerResultBody(
        id=result_id,
        schema_version=schema_version,
        result_version=result_version,
        operation_key=operation_key,
        task_id=task_id,
        agent_definition_id=definition_id,
        agent_revision=revision,
        status=status,
        summary=summary,
        output=output,
        artifact_refs=[item for item in artifacts if isinstance(item, str)],
        evidence_refs=[item for item in evidence if isinstance(item, str)],
        errors=[ResultErrorBody.model_validate(item) for item in errors if isinstance(item, dict)],
        limitations=[item for item in limitations if isinstance(item, str)],
        proposed_actions=[
            ProposedActionBody.model_validate(item) for item in actions if isinstance(item, dict)
        ],
        required_approval=(
            RequiredApprovalBody.model_validate(approval) if isinstance(approval, dict) else None
        ),
    )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except HandoffConflict as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except ValueError:
        raise HTTPException(status_code=422, detail="handoff fields are invalid") from None
    return result
