"""Project tasks. Status changes are validated, and cancellation does not restart itself."""

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal, NoReturn
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
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

TaskStatus = Literal[
    "DRAFT",
    "READY",
    "QUEUED",
    "RUNNING",
    "WAITING",
    "BLOCKED",
    "REVIEW",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
]
TaskPriority = Literal["LOW", "NORMAL", "HIGH", "URGENT"]
_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"DRAFT", "READY", "CANCELLED"}),
    "READY": frozenset({"READY", "QUEUED", "DRAFT", "BLOCKED", "CANCELLED"}),
    "QUEUED": frozenset({"QUEUED", "RUNNING", "READY", "CANCELLED"}),
    "RUNNING": frozenset(
        {"RUNNING", "WAITING", "BLOCKED", "REVIEW", "SUCCEEDED", "FAILED", "CANCELLED"}
    ),
    "WAITING": frozenset({"WAITING", "RUNNING", "BLOCKED", "CANCELLED"}),
    "BLOCKED": frozenset({"BLOCKED", "READY", "CANCELLED"}),
    "REVIEW": frozenset({"REVIEW", "SUCCEEDED", "FAILED", "READY", "CANCELLED"}),
    "SUCCEEDED": frozenset({"SUCCEEDED"}),
    "FAILED": frozenset({"FAILED", "CANCELLED"}),
    "CANCELLED": frozenset({"CANCELLED"}),
}
_ARTIFACT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$")
_SECRET_TEXT = re.compile(
    r"(?i)(api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|"
    r"private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY"
)


class TaskStateError(Exception):
    """The requested status is not a legal next state."""


class TaskVersionError(Exception):
    """The task version no longer matches the caller's copy."""


class TaskDependencyError(Exception):
    """The dependency would cycle or point at the task itself."""


class TaskDependencyBlocked(Exception):
    """A predecessor has not succeeded, so this task cannot start."""


class TaskAgentError(Exception):
    """The agent cannot accept this assignment."""


class TaskRetryError(Exception):
    """The task has no retries remaining."""


class TaskActivity(BaseModel):
    action: str
    occurred_at: datetime
    actor_name: str


class TaskDependencyBody(BaseModel):
    id: UUID
    title: str


class TaskSummaryBody(BaseModel):
    id: UUID
    title: str
    status: str
    priority: str
    deadline: datetime | None
    assignee_name: str | None


class TaskDetailBody(BaseModel):
    id: UUID
    title: str
    description: str
    status: str
    priority: str
    deadline: datetime | None
    assignee_user_id: UUID | None
    assignee_name: str | None
    agent_instance_id: UUID | None
    retry_count: int
    max_retries: int
    blocker: str | None
    escalation: str | None
    cancellation_reason: str | None
    cancelled_at: datetime | None
    artifact_refs: list[str]
    version: int
    depends_on: list[TaskDependencyBody]
    activity: list[TaskActivity]


class AssignableBody(BaseModel):
    id: UUID
    display_name: str


class AgentInstanceBody(BaseModel):
    id: UUID
    name: str
    definition_status: str
    status: str


class TaskFields(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    priority: TaskPriority = "NORMAL"
    deadline: datetime | None = None
    assignee_user_id: UUID | None = None
    agent_instance_id: UUID | None = None
    blocker: str = Field(default="", max_length=2000)
    escalation: str = Field(default="", max_length=2000)
    cancellation_reason: str = Field(default="", max_length=2000)
    max_retries: int = Field(default=0, ge=0, le=20)
    artifact_refs: list[str] = Field(default_factory=list, max_length=20)
    depends_on_task_ids: list[UUID] = Field(default_factory=list, max_length=50)

    @field_validator("title", "description", "blocker", "escalation", "cancellation_reason")
    @classmethod
    def text_is_trimmed(cls, value: str) -> str:
        stripped = value.strip()
        if _SECRET_TEXT.search(stripped):
            raise ValueError("task fields are invalid")
        return stripped

    @field_validator("title")
    @classmethod
    def title_is_visible(cls, value: str) -> str:
        if value.strip() == "":
            raise ValueError("title is blank")
        return value.strip()

    @field_validator("deadline")
    @classmethod
    def deadline_has_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("deadline needs a timezone")
        return value

    @field_validator("artifact_refs")
    @classmethod
    def artifacts_are_references(cls, value: list[str]) -> list[str]:
        seen: set[str] = set()
        for item in value:
            if _ARTIFACT.fullmatch(item) is None or item in seen or _SECRET_TEXT.search(item):
                raise ValueError("artifact reference is invalid")
            seen.add(item)
        return value

    @field_validator("depends_on_task_ids")
    @classmethod
    def dependencies_are_unique(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("dependency is repeated")
        return value


class TaskCreateBody(TaskFields):
    status: Literal["DRAFT", "READY"] = "DRAFT"


class TaskUpdateBody(TaskFields):
    status: TaskStatus
    version: int = Field(ge=1)
    operation: Literal["save", "cancel", "reactivate", "retry"] = "save"


def register_tasks(app: FastAPI, settings: Settings) -> None:
    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/tasks",
        response_model=list[TaskSummaryBody],
    )
    def tasks(organization_id: UUID, project_id: UUID, request: Request) -> list[TaskSummaryBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: list_tasks(connection, principal, organization_id, project_id),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/task-assignees",
        response_model=list[AssignableBody],
    )
    def assignees(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[AssignableBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: list_assignees(connection, principal, organization_id, project_id),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/agent-instances",
        response_model=list[AgentInstanceBody],
    )
    def instances(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[AgentInstanceBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: list_instances(connection, principal, organization_id, project_id),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/tasks/{task_id}",
        response_model=TaskDetailBody,
    )
    def task(
        organization_id: UUID, project_id: UUID, task_id: UUID, request: Request
    ) -> TaskDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: get_task(
                connection, principal, organization_id, project_id, task_id
            ),
        )

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/tasks",
        response_model=TaskDetailBody,
        status_code=201,
    )
    def create(
        organization_id: UUID, project_id: UUID, body: TaskCreateBody, request: Request
    ) -> TaskDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: create_task(
                connection, principal, organization_id, project_id, body
            ),
        )

    @app.patch(
        "/organizations/{organization_id}/projects/{project_id}/tasks/{task_id}",
        response_model=TaskDetailBody,
    )
    def update(
        organization_id: UUID,
        project_id: UUID,
        task_id: UUID,
        body: TaskUpdateBody,
        request: Request,
    ) -> TaskDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: update_task(
                connection, principal, organization_id, project_id, task_id, body
            ),
        )


def list_tasks(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[TaskSummaryBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        """
        SELECT t.id, t.title, t.status::text, t.priority::text, t.deadline, u.display_name
        FROM tasks AS t
        LEFT JOIN users AS u ON u.id = t.assignee_user_id
        WHERE t.organization_id = %s AND t.project_id = %s
        ORDER BY t.title
        """,
        (organization_id, project_id),
    ).fetchall()
    return [_summary(row) for row in rows]


def list_assignees(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[AssignableBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        """
        SELECT u.id, u.display_name
        FROM project_memberships AS pm
        JOIN users AS u ON u.id = pm.user_id
        JOIN memberships AS m
          ON m.organization_id = pm.organization_id AND m.user_id = pm.user_id
        WHERE pm.organization_id = %s
          AND pm.project_id = %s
          AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
        ORDER BY u.display_name
        """,
        (organization_id, project_id),
    ).fetchall()
    people: list[AssignableBody] = []
    for row in rows:
        user_id, display_name = row
        if not isinstance(user_id, UUID) or not isinstance(display_name, str):
            raise NotVisible()
        people.append(AssignableBody(id=user_id, display_name=display_name))
    return people


def list_instances(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[AgentInstanceBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        """
        SELECT instance.id, definition.name, definition.status::text, instance.status::text
        FROM agent_instances AS instance
        JOIN agent_definitions AS definition
          ON definition.id = instance.agent_definition_id
         AND definition.organization_id = instance.organization_id
        WHERE instance.organization_id = %s AND instance.project_id = %s
        ORDER BY definition.name
        """,
        (organization_id, project_id),
    ).fetchall()
    instances: list[AgentInstanceBody] = []
    for row in rows:
        instance_id, name, definition_status, status = row
        if (
            not isinstance(instance_id, UUID)
            or not isinstance(name, str)
            or not isinstance(definition_status, str)
            or not isinstance(status, str)
        ):
            raise NotVisible()
        instances.append(
            AgentInstanceBody(
                id=instance_id,
                name=name,
                definition_status=definition_status,
                status=status,
            )
        )
    return instances


def get_task(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    task_id: UUID,
) -> TaskDetailBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    return _load_detail(connection, organization_id, project_id, task_id)


def create_task(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: TaskCreateBody,
) -> TaskDetailBody:
    _require_blocker(body.status, body.blocker)
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        task_id = _insert_task(cursor, organization_id, project_id, body)
        _replace_dependencies(
            cursor, organization_id, project_id, task_id, body.depends_on_task_ids
        )
        _audit(
            cursor, organization_id, project_id, principal.id, task_id, "task.created", body.status
        )
    return _load_detail(connection, organization_id, project_id, task_id)


def update_task(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    task_id: UUID,
    body: TaskUpdateBody,
) -> TaskDetailBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        current = _lock_task(cursor, organization_id, project_id, task_id)
        status, action, retry_count = _next_state(current, body)
        _require_blocker(status, body.blocker)
        if status in {"QUEUED", "RUNNING"} and current[0] not in {"QUEUED", "RUNNING"}:
            _require_predecessors(cursor, organization_id, project_id, body.depends_on_task_ids)
        if status == "CANCELLED" and body.cancellation_reason == "":
            raise TaskStateError()
        try:
            cursor.execute(
                """
                UPDATE tasks
                SET title = %s,
                    description = %s,
                    status = %s,
                    priority = %s,
                    deadline = %s,
                    assignee_user_id = %s,
                    agent_instance_id = %s,
                    retry_count = %s,
                    max_retries = %s,
                    blocker = NULLIF(%s, ''),
                    escalation = NULLIF(%s, ''),
                    cancellation_reason = NULLIF(%s, ''),
                    cancelled_at = CASE
                        WHEN %s = 'CANCELLED' THEN COALESCE(cancelled_at, clock_timestamp())
                        ELSE cancelled_at
                    END,
                    artifact_refs = %s,
                    version = version + 1
                WHERE id = %s AND organization_id = %s AND project_id = %s AND version = %s
                """,
                (
                    body.title,
                    body.description,
                    status,
                    body.priority,
                    body.deadline,
                    body.assignee_user_id,
                    body.agent_instance_id,
                    retry_count,
                    body.max_retries,
                    body.blocker,
                    body.escalation,
                    body.cancellation_reason,
                    status,
                    Json(body.artifact_refs),
                    task_id,
                    organization_id,
                    project_id,
                    body.version,
                ),
            )
            require_one_row(cursor)
        except ConcurrentUpdateError:
            raise TaskVersionError() from None
        except psycopg.Error as error:
            _translate_database_error(error)
        if body.operation == "save":
            _replace_dependencies(
                cursor, organization_id, project_id, task_id, body.depends_on_task_ids
            )
        _audit(cursor, organization_id, project_id, principal.id, task_id, action, status)
    return _load_detail(connection, organization_id, project_id, task_id)


def _next_state(
    current: tuple[str, UUID | None, int, int], body: TaskUpdateBody
) -> tuple[str, str, int]:
    previous, previous_assignee, retry_count, max_retries = current
    if body.operation == "cancel":
        if "CANCELLED" not in _TRANSITIONS.get(previous, frozenset()):
            raise TaskStateError()
        return "CANCELLED", "task.cancelled", retry_count
    if body.operation == "reactivate":
        if previous != "CANCELLED":
            raise TaskStateError()
        return "DRAFT", "task.reactivated", retry_count
    if body.operation == "retry":
        if previous != "FAILED" or retry_count >= max_retries:
            raise TaskRetryError()
        return "READY", "task.retried", retry_count + 1
    if body.status not in _TRANSITIONS.get(previous, frozenset()):
        raise TaskStateError()
    if body.assignee_user_id != previous_assignee:
        if body.assignee_user_id is None:
            return body.status, "task.unassigned", retry_count
        return body.status, "task.assigned", retry_count
    if body.status == "CANCELLED" and previous != "CANCELLED":
        return body.status, "task.cancelled", retry_count
    return body.status, "task.updated", retry_count


def _require_blocker(status: str, blocker: str) -> None:
    if status == "BLOCKED" and blocker == "":
        raise TaskStateError()


def _require_predecessors(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    predecessors: list[UUID],
) -> None:
    if predecessors == []:
        return
    cursor.execute(
        """
        SELECT id, status::text FROM tasks
        WHERE organization_id = %s AND project_id = %s AND id = ANY(%s)
        FOR UPDATE
        """,
        (organization_id, project_id, predecessors),
    )
    rows = cursor.fetchall()
    if len(rows) != len(set(predecessors)):
        raise TaskDependencyError()
    for row in rows:
        if row[1] != "SUCCEEDED":
            raise TaskDependencyBlocked()


def _insert_task(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, body: TaskCreateBody
) -> UUID:
    try:
        cursor.execute(
            """
            INSERT INTO tasks (
                organization_id, project_id, title, description, status, priority, deadline,
                assignee_user_id, agent_instance_id, max_retries, blocker, escalation,
                cancellation_reason, artifact_refs
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULLIF(%s, ''), NULLIF(%s, ''),
                    NULLIF(%s, ''), %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                body.title,
                body.description,
                body.status,
                body.priority,
                body.deadline,
                body.assignee_user_id,
                body.agent_instance_id,
                body.max_retries,
                body.blocker,
                body.escalation,
                body.cancellation_reason,
                Json(body.artifact_refs),
            ),
        )
    except psycopg.Error as error:
        _translate_database_error(error)
    created = cursor.fetchone()
    if created is None or not isinstance(created[0], UUID):
        raise NotVisible()
    return created[0]


def _lock_task(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, task_id: UUID
) -> tuple[str, UUID | None, int, int]:
    cursor.execute(
        """
        SELECT status::text, assignee_user_id, retry_count, max_retries
        FROM tasks
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (task_id, organization_id, project_id),
    )
    row = cursor.fetchone()
    if row is None:
        raise NotVisible()
    status, assignee, retry_count, max_retries = row
    if (
        not isinstance(status, str)
        or not isinstance(retry_count, int)
        or not isinstance(max_retries, int)
        or not (assignee is None or isinstance(assignee, UUID))
    ):
        raise NotVisible()
    return status, assignee, retry_count, max_retries


def _replace_dependencies(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    task_id: UUID,
    depends_on: list[UUID],
) -> None:
    if task_id in depends_on:
        raise TaskDependencyError()
    cursor.execute(
        """
        DELETE FROM task_dependencies
        WHERE organization_id = %s AND project_id = %s AND task_id = %s
        """,
        (organization_id, project_id, task_id),
    )
    for predecessor_id in depends_on:
        try:
            cursor.execute(
                """
                INSERT INTO task_dependencies (
                    organization_id, project_id, task_id, depends_on_task_id
                )
                VALUES (%s, %s, %s, %s)
                """,
                (organization_id, project_id, task_id, predecessor_id),
            )
        except psycopg.Error as error:
            _translate_database_error(error)


def _translate_database_error(error: psycopg.Error) -> NoReturn:
    message = str(error)
    if "cycle" in message or "not_self" in message:
        raise TaskDependencyError() from None
    if "disabled agent" in message:
        raise TaskAgentError() from None
    if "not an active member" in message or "not visible" in message:
        raise NotVisible() from None
    if isinstance(error, psycopg.errors.ForeignKeyViolation):
        raise NotVisible() from None
    raise error


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_user_id: UUID,
    task_id: UUID,
    action: str,
    status: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'task', %s, %s)
        """,
        (organization_id, project_id, actor_user_id, action, task_id, Json({"status": status})),
    )


def _load_detail(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, task_id: UUID
) -> TaskDetailBody:
    row = connection.execute(
        """
        SELECT t.id, t.title, t.description, t.status::text, t.priority::text, t.deadline,
               t.assignee_user_id, u.display_name, t.agent_instance_id, t.retry_count,
               t.max_retries, t.blocker, t.escalation, t.cancellation_reason, t.cancelled_at,
               t.artifact_refs, t.version
        FROM tasks AS t
        LEFT JOIN users AS u ON u.id = t.assignee_user_id
        WHERE t.id = %s AND t.organization_id = %s AND t.project_id = %s
        """,
        (task_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    dependencies = connection.execute(
        """
        SELECT predecessor.id, predecessor.title
        FROM task_dependencies AS edge
        JOIN tasks AS predecessor
          ON predecessor.id = edge.depends_on_task_id
         AND predecessor.project_id = edge.project_id
        WHERE edge.task_id = %s AND edge.organization_id = %s
        ORDER BY predecessor.title
        """,
        (task_id, organization_id),
    ).fetchall()
    activity_rows = connection.execute(
        """
        SELECT e.action, e.occurred_at, COALESCE(u.display_name, 'Workspace')
        FROM audit_events AS e
        LEFT JOIN users AS u ON u.id = e.actor_user_id
        WHERE e.organization_id = %s AND e.target_type = 'task' AND e.target_id = %s
        ORDER BY e.occurred_at DESC
        LIMIT 20
        """,
        (organization_id, task_id),
    ).fetchall()
    return _detail(row, dependencies, activity_rows)


def _summary(row: tuple[Any, ...]) -> TaskSummaryBody:
    task_id, title, status, priority, deadline, assignee_name = row
    if (
        not isinstance(task_id, UUID)
        or not isinstance(title, str)
        or not isinstance(status, str)
        or not isinstance(priority, str)
        or not _is_time(deadline)
        or not (assignee_name is None or isinstance(assignee_name, str))
    ):
        raise NotVisible()
    return TaskSummaryBody(
        id=task_id,
        title=title,
        status=status,
        priority=priority,
        deadline=deadline,
        assignee_name=assignee_name,
    )


def _detail(
    row: tuple[Any, ...],
    dependencies: list[tuple[Any, ...]],
    activity_rows: list[tuple[Any, ...]],
) -> TaskDetailBody:
    (
        task_id,
        title,
        description,
        status,
        priority,
        deadline,
        assignee_user_id,
        assignee_name,
        agent_instance_id,
        retry_count,
        max_retries,
        blocker,
        escalation,
        cancellation_reason,
        cancelled_at,
        artifact_refs,
        version,
    ) = row
    if (
        not isinstance(task_id, UUID)
        or not isinstance(title, str)
        or not isinstance(description, str)
        or not isinstance(status, str)
        or not isinstance(priority, str)
        or not _is_time(deadline)
        or not (assignee_user_id is None or isinstance(assignee_user_id, UUID))
        or not (assignee_name is None or isinstance(assignee_name, str))
        or not (agent_instance_id is None or isinstance(agent_instance_id, UUID))
        or not isinstance(retry_count, int)
        or not isinstance(max_retries, int)
        or not (blocker is None or isinstance(blocker, str))
        or not (escalation is None or isinstance(escalation, str))
        or not (cancellation_reason is None or isinstance(cancellation_reason, str))
        or not _is_time(cancelled_at)
        or not isinstance(artifact_refs, list)
        or not all(isinstance(item, str) for item in artifact_refs)
        or not isinstance(version, int)
    ):
        raise NotVisible()
    depends_on: list[TaskDependencyBody] = []
    for item in dependencies:
        predecessor_id, predecessor_title = item
        if not isinstance(predecessor_id, UUID) or not isinstance(predecessor_title, str):
            raise NotVisible()
        depends_on.append(TaskDependencyBody(id=predecessor_id, title=predecessor_title))
    activity: list[TaskActivity] = []
    for item in activity_rows:
        action, occurred_at, actor_name = item
        if (
            not isinstance(action, str)
            or not isinstance(occurred_at, datetime)
            or not isinstance(actor_name, str)
        ):
            raise NotVisible()
        activity.append(TaskActivity(action=action, occurred_at=occurred_at, actor_name=actor_name))
    return TaskDetailBody(
        id=task_id,
        title=title,
        description=description,
        status=status,
        priority=priority,
        deadline=deadline,
        assignee_user_id=assignee_user_id,
        assignee_name=assignee_name,
        agent_instance_id=agent_instance_id,
        retry_count=retry_count,
        max_retries=max_retries,
        blocker=blocker,
        escalation=escalation,
        cancellation_reason=cancellation_reason,
        cancelled_at=cancelled_at,
        artifact_refs=artifact_refs,
        version=version,
        depends_on=depends_on,
        activity=activity,
    )


def _is_time(value: object) -> bool:
    return value is None or isinstance(value, datetime)


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except TaskStateError:
        raise HTTPException(status_code=409, detail="task status cannot change that way") from None
    except TaskVersionError:
        raise HTTPException(status_code=409, detail="task changed") from None
    except TaskDependencyError:
        raise HTTPException(status_code=409, detail="task dependency is not allowed") from None
    except TaskDependencyBlocked:
        raise HTTPException(status_code=409, detail="task dependency has not succeeded") from None
    except TaskAgentError:
        raise HTTPException(
            status_code=409, detail="task cannot be assigned to that agent"
        ) from None
    except TaskRetryError:
        raise HTTPException(status_code=409, detail="task has no retries remaining") from None
    except ValueError:
        raise HTTPException(status_code=422, detail="task fields are invalid") from None
    return result
