"""Workflow service. Business code depends on this interface, not on Temporal."""

import json
import re
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal, Protocol
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import ForeignKeyViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import ConcurrentUpdateError, require_one_row, transaction
from ai_workforce_api.settings import Settings

WorkflowFinishStatus = Literal["SUCCEEDED", "FAILED"]
_OPEN = frozenset({"RUNNING", "PAUSED"})
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


class WorkflowStateError(Exception):
    """The workflow cannot accept that operation in its current status."""


class WorkflowConflict(Exception):
    """The workflow key is already used and cannot be started again."""


class WorkflowVersionError(Exception):
    """The workflow version no longer matches the caller's copy."""


class WorkflowRunBody(BaseModel):
    id: UUID
    workflow_key: str
    task_id: UUID | None
    status: str
    attempt: int
    max_attempts: int
    started_at: datetime
    finished_at: datetime | None
    version: int
    created: bool = False


class WorkflowEventBody(BaseModel):
    event_type: str
    payload: dict[str, Any]
    occurred_at: datetime


class WorkflowStartBody(BaseModel):
    workflow_key: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    task_id: UUID | None = None
    max_attempts: int = Field(default=1, ge=1, le=10)
    timer_seconds: int = Field(default=0, ge=0, le=86400)


class WorkflowVersionBody(BaseModel):
    version: int = Field(ge=1)


class WorkflowFinishBody(BaseModel):
    status: WorkflowFinishStatus
    version: int = Field(ge=1)


class WorkflowSignalBody(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9._-]{0,80}$")
    payload: dict[str, Any] = Field(default_factory=dict)
    version: int = Field(ge=1)

    @field_validator("payload")
    @classmethod
    def payload_has_no_secret(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value)) > 4000:
            raise ValueError("workflow fields are invalid")
        _reject_secrets(value)
        return value


class DurableUnavailable(Exception):
    """The durable engine did not accept the run."""


class DurableRun(Protocol):
    """Starts durable execution for a run. The implementation lives outside this module."""

    def attach(
        self,
        run: WorkflowRunBody,
        organization_id: UUID,
        project_id: UUID,
        timer_seconds: int,
    ) -> None: ...


class WorkflowEngine(Protocol):
    """Provider-neutral workflow operations. Temporal is not imported here."""

    def start(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        body: WorkflowStartBody,
    ) -> WorkflowRunBody: ...

    def get(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
    ) -> WorkflowRunBody: ...

    def pause(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        version: int,
    ) -> WorkflowRunBody: ...

    def resume(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        version: int,
    ) -> WorkflowRunBody: ...

    def cancel(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        version: int,
    ) -> WorkflowRunBody: ...

    def finish(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowFinishBody,
    ) -> WorkflowRunBody: ...

    def retry(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        version: int,
    ) -> WorkflowRunBody: ...

    def signal(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowSignalBody,
    ) -> WorkflowRunBody: ...

    def history(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
    ) -> list[WorkflowEventBody]: ...


class PostgresWorkflowEngine:
    """Stores runs and history in PostgreSQL. It does not call Temporal."""

    def start(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        body: WorkflowStartBody,
    ) -> WorkflowRunBody:
        return _start(connection, principal, organization_id, project_id, body)

    def get(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
    ) -> WorkflowRunBody:
        return _get(connection, principal, organization_id, project_id, workflow_id)

    def pause(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        version: int,
    ) -> WorkflowRunBody:
        return _transition(
            connection,
            principal,
            organization_id,
            project_id,
            workflow_id,
            version,
            allowed={"RUNNING"},
            status="PAUSED",
            event_type="paused",
            action="workflow.paused",
        )

    def resume(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        version: int,
    ) -> WorkflowRunBody:
        return _transition(
            connection,
            principal,
            organization_id,
            project_id,
            workflow_id,
            version,
            allowed={"PAUSED"},
            status="RUNNING",
            event_type="resumed",
            action="workflow.resumed",
        )

    def cancel(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        version: int,
    ) -> WorkflowRunBody:
        return _transition(
            connection,
            principal,
            organization_id,
            project_id,
            workflow_id,
            version,
            allowed=_OPEN,
            status="CANCELLED",
            event_type="cancelled",
            action="workflow.cancelled",
            finish=True,
        )

    def finish(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowFinishBody,
    ) -> WorkflowRunBody:
        return _transition(
            connection,
            principal,
            organization_id,
            project_id,
            workflow_id,
            body.version,
            allowed=_OPEN,
            status=body.status,
            event_type="finished",
            action="workflow.finished",
            finish=True,
        )

    def retry(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        version: int,
    ) -> WorkflowRunBody:
        return _retry(connection, principal, organization_id, project_id, workflow_id, version)

    def signal(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowSignalBody,
    ) -> WorkflowRunBody:
        return _signal(connection, principal, organization_id, project_id, workflow_id, body)

    def history(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
    ) -> list[WorkflowEventBody]:
        return _history(connection, principal, organization_id, project_id, workflow_id)


def register_workflows(
    app: FastAPI,
    settings: Settings,
    engine: WorkflowEngine | None = None,
    durable: DurableRun | None = None,
) -> None:
    resolved = engine if engine is not None else PostgresWorkflowEngine()

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/workflows",
        response_model=WorkflowRunBody,
    )
    def start(
        organization_id: UUID,
        project_id: UUID,
        body: WorkflowStartBody,
        request: Request,
    ) -> WorkflowRunBody:
        principal = _session_principal(request)
        run = _run(
            settings,
            lambda connection: resolved.start(
                connection, principal, organization_id, project_id, body
            ),
        )
        if durable is not None and run.status in _OPEN:
            try:
                durable.attach(run, organization_id, project_id, body.timer_seconds)
            except DurableUnavailable:
                raise HTTPException(
                    status_code=503, detail="workflow execution is unavailable"
                ) from None
        return run

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/workflows/{workflow_id}",
        response_model=WorkflowRunBody,
    )
    def status(
        organization_id: UUID, project_id: UUID, workflow_id: UUID, request: Request
    ) -> WorkflowRunBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resolved.get(
                connection, principal, organization_id, project_id, workflow_id
            ),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/workflows/{workflow_id}/history",
        response_model=list[WorkflowEventBody],
    )
    def history(
        organization_id: UUID, project_id: UUID, workflow_id: UUID, request: Request
    ) -> list[WorkflowEventBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resolved.history(
                connection, principal, organization_id, project_id, workflow_id
            ),
        )

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/workflows/{workflow_id}/pause",
        response_model=WorkflowRunBody,
    )
    def pause(
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowVersionBody,
        request: Request,
    ) -> WorkflowRunBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resolved.pause(
                connection, principal, organization_id, project_id, workflow_id, body.version
            ),
        )

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/workflows/{workflow_id}/resume",
        response_model=WorkflowRunBody,
    )
    def resume(
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowVersionBody,
        request: Request,
    ) -> WorkflowRunBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resolved.resume(
                connection, principal, organization_id, project_id, workflow_id, body.version
            ),
        )

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/workflows/{workflow_id}/cancel",
        response_model=WorkflowRunBody,
    )
    def cancel(
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowVersionBody,
        request: Request,
    ) -> WorkflowRunBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resolved.cancel(
                connection, principal, organization_id, project_id, workflow_id, body.version
            ),
        )

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/workflows/{workflow_id}/finish",
        response_model=WorkflowRunBody,
    )
    def finish(
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowFinishBody,
        request: Request,
    ) -> WorkflowRunBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resolved.finish(
                connection, principal, organization_id, project_id, workflow_id, body
            ),
        )

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/workflows/{workflow_id}/retry",
        response_model=WorkflowRunBody,
    )
    def retry(
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowVersionBody,
        request: Request,
    ) -> WorkflowRunBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resolved.retry(
                connection, principal, organization_id, project_id, workflow_id, body.version
            ),
        )

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/workflows/{workflow_id}/signals",
        response_model=WorkflowRunBody,
    )
    def signal(
        organization_id: UUID,
        project_id: UUID,
        workflow_id: UUID,
        body: WorkflowSignalBody,
        request: Request,
    ) -> WorkflowRunBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resolved.signal(
                connection, principal, organization_id, project_id, workflow_id, body
            ),
        )


def _start(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: WorkflowStartBody,
) -> WorkflowRunBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        try:
            cursor.execute(
                """
                INSERT INTO workflow_runs (
                    organization_id, project_id, task_id, workflow_key, max_attempts
                )
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (project_id, workflow_key) DO NOTHING
                RETURNING id
                """,
                (organization_id, project_id, body.task_id, body.workflow_key, body.max_attempts),
            )
        except ForeignKeyViolation:
            raise NotVisible() from None
        created = cursor.fetchone()
        if created is None:
            return _existing_start(cursor, organization_id, project_id, body)
        if not isinstance(created[0], UUID):
            raise NotVisible()
        workflow_id = created[0]
        _event(
            cursor,
            organization_id,
            project_id,
            workflow_id,
            "started",
            {"status": "RUNNING", "timer_seconds": body.timer_seconds},
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            workflow_id,
            "workflow.started",
            "RUNNING",
        )
    run = _load(connection, organization_id, project_id, workflow_id)
    return run.model_copy(update={"created": True})


def _existing_start(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    body: WorkflowStartBody,
) -> WorkflowRunBody:
    cursor.execute(
        """
        SELECT id, task_id, status::text, attempt, max_attempts, started_at, finished_at,
               workflow_key, version
        FROM workflow_runs
        WHERE organization_id = %s AND project_id = %s AND workflow_key = %s
        """,
        (organization_id, project_id, body.workflow_key),
    )
    row = cursor.fetchone()
    if row is None:
        raise WorkflowConflict()
    run = _run_from_row(row)
    if run.status not in _OPEN or run.task_id != body.task_id:
        raise WorkflowConflict()
    return run


def _get(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workflow_id: UUID,
) -> WorkflowRunBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    return _load(connection, organization_id, project_id, workflow_id)


def _transition(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workflow_id: UUID,
    version: int,
    *,
    allowed: set[str] | frozenset[str],
    status: str,
    event_type: str,
    action: str,
    finish: bool = False,
) -> WorkflowRunBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, workflow_id, version)
        if current not in allowed:
            raise WorkflowStateError()
        try:
            cursor.execute(
                """
                UPDATE workflow_runs
                SET status = %s,
                    finished_at = CASE WHEN %s THEN clock_timestamp() ELSE finished_at END,
                    version = version + 1
                WHERE id = %s AND organization_id = %s AND project_id = %s AND version = %s
                """,
                (status, finish, workflow_id, organization_id, project_id, version),
            )
            require_one_row(cursor)
        except ConcurrentUpdateError:
            raise WorkflowVersionError() from None
        _event(cursor, organization_id, project_id, workflow_id, event_type, {"status": status})
        _audit(cursor, organization_id, project_id, principal.id, workflow_id, action, status)
    return _load(connection, organization_id, project_id, workflow_id)


def _retry(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workflow_id: UUID,
    version: int,
) -> WorkflowRunBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, workflow_id, version)
        attempt, max_attempts = _attempts(cursor, workflow_id)
        if current != "FAILED" or attempt >= max_attempts:
            raise WorkflowStateError()
        try:
            cursor.execute(
                """
                UPDATE workflow_runs
                SET status = 'RUNNING',
                    attempt = attempt + 1,
                    finished_at = NULL,
                    version = version + 1
                WHERE id = %s AND organization_id = %s AND project_id = %s AND version = %s
                """,
                (workflow_id, organization_id, project_id, version),
            )
            require_one_row(cursor)
        except ConcurrentUpdateError:
            raise WorkflowVersionError() from None
        _event(
            cursor,
            organization_id,
            project_id,
            workflow_id,
            "retried",
            {"status": "RUNNING", "attempt": attempt + 1},
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            workflow_id,
            "workflow.retried",
            "RUNNING",
        )
    return _load(connection, organization_id, project_id, workflow_id)


def _signal(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workflow_id: UUID,
    body: WorkflowSignalBody,
) -> WorkflowRunBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, workflow_id, body.version)
        if current not in _OPEN:
            raise WorkflowStateError()
        try:
            cursor.execute(
                """
                UPDATE workflow_runs
                SET version = version + 1
                WHERE id = %s AND organization_id = %s AND project_id = %s AND version = %s
                """,
                (workflow_id, organization_id, project_id, body.version),
            )
            require_one_row(cursor)
        except ConcurrentUpdateError:
            raise WorkflowVersionError() from None
        _event(
            cursor,
            organization_id,
            project_id,
            workflow_id,
            "signaled",
            {"name": body.name, "payload": body.payload},
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            workflow_id,
            "workflow.signaled",
            current,
        )
    return _load(connection, organization_id, project_id, workflow_id)


def _history(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workflow_id: UUID,
) -> list[WorkflowEventBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    _load(connection, organization_id, project_id, workflow_id)
    rows = connection.execute(
        """
        SELECT event_type, payload, occurred_at
        FROM workflow_events
        WHERE organization_id = %s AND project_id = %s AND workflow_run_id = %s
        ORDER BY occurred_at, id
        """,
        (organization_id, project_id, workflow_id),
    ).fetchall()
    events: list[WorkflowEventBody] = []
    for row in rows:
        event_type, payload, occurred_at = row
        if (
            not isinstance(event_type, str)
            or not isinstance(payload, dict)
            or not isinstance(occurred_at, datetime)
        ):
            raise NotVisible()
        events.append(
            WorkflowEventBody(event_type=event_type, payload=payload, occurred_at=occurred_at)
        )
    return events


def _lock(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    workflow_id: UUID,
    version: int,
) -> str:
    cursor.execute(
        """
        SELECT status::text, version
        FROM workflow_runs
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (workflow_id, organization_id, project_id),
    )
    row = cursor.fetchone()
    if row is None or not isinstance(row[0], str) or not isinstance(row[1], int):
        raise NotVisible()
    if row[1] != version:
        raise WorkflowVersionError()
    return row[0]


def _attempts(cursor: psycopg.Cursor[Any], workflow_id: UUID) -> tuple[int, int]:
    cursor.execute(
        "SELECT attempt, max_attempts FROM workflow_runs WHERE id = %s",
        (workflow_id,),
    )
    row = cursor.fetchone()
    if row is None or not isinstance(row[0], int) or not isinstance(row[1], int):
        raise NotVisible()
    return row[0], row[1]


def _event(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    workflow_id: UUID,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO workflow_events (
            organization_id, project_id, workflow_run_id, event_type, payload
        )
        VALUES (%s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, workflow_id, event_type, Json(payload)),
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_user_id: UUID,
    workflow_id: UUID,
    action: str,
    status: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'workflow_run', %s, %s)
        """,
        (organization_id, project_id, actor_user_id, action, workflow_id, Json({"status": status})),
    )


def _load(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    workflow_id: UUID,
) -> WorkflowRunBody:
    row = connection.execute(
        """
        SELECT id, task_id, status::text, attempt, max_attempts, started_at, finished_at,
               workflow_key, version
        FROM workflow_runs
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (workflow_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _run_from_row(row)


def _run_from_row(row: tuple[Any, ...]) -> WorkflowRunBody:
    (
        workflow_id,
        task_id,
        status,
        attempt,
        max_attempts,
        started_at,
        finished_at,
        workflow_key,
        version,
    ) = row
    if (
        not isinstance(workflow_id, UUID)
        or not (task_id is None or isinstance(task_id, UUID))
        or not isinstance(status, str)
        or not isinstance(attempt, int)
        or not isinstance(max_attempts, int)
        or not isinstance(started_at, datetime)
        or not (finished_at is None or isinstance(finished_at, datetime))
        or not isinstance(workflow_key, str)
        or not isinstance(version, int)
    ):
        raise NotVisible()
    return WorkflowRunBody(
        id=workflow_id,
        workflow_key=workflow_key,
        task_id=task_id,
        status=status,
        attempt=attempt,
        max_attempts=max_attempts,
        started_at=started_at,
        finished_at=finished_at,
        version=version,
    )


def _reject_secrets(value: object) -> None:
    if isinstance(value, str):
        if _SECRET_TEXT.search(value):
            raise ValueError("workflow fields are invalid")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower().replace("-", "_") in _SECRET_KEYS:
                raise ValueError("workflow fields are invalid")
            _reject_secrets(item)
        return
    if isinstance(value, list):
        for item in value:
            _reject_secrets(item)


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except WorkflowStateError:
        raise HTTPException(status_code=409, detail="workflow cannot change that way") from None
    except WorkflowConflict:
        raise HTTPException(status_code=409, detail="workflow key is already in use") from None
    except WorkflowVersionError:
        raise HTTPException(status_code=409, detail="workflow changed") from None
    except ValueError:
        raise HTTPException(status_code=422, detail="workflow fields are invalid") from None
    return result
