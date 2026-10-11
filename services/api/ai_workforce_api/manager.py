"""Manager agent. It proposes a task plan and creates tasks only after validation."""

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
from ai_workforce_api.models import (
    MODEL_CONFIGS,
    ModelCallCreate,
    ModelProvider,
    _create,
    _provider_for,
)
from ai_workforce_api.settings import Settings
from ai_workforce_api.tasks import TaskCreateBody, create_task
from ai_workforce_api.workflow import (
    DurableRun,
    DurableUnavailable,
    PostgresWorkflowEngine,
    WorkflowRunBody,
    WorkflowStartBody,
)

MAX_TASKS = 8
MAX_CREATED_PLANS = 3
_SECRET_TEXT = re.compile(
    r"(?i)(api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|"
    r"private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY"
)
_POLICY = ("send email", "send an email", "grant role", "change permission", "execute tool")
_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["tasks"],
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "depends_on"],
                "properties": {
                    "title": {"type": "string"},
                    "depends_on": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}


class ProposedTask(BaseModel):
    title: str
    depends_on: list[str]


class BlockedTaskBody(BaseModel):
    title: str
    blocker: str


class ManagerPlanBody(BaseModel):
    id: UUID
    status: str
    objective: str
    assumptions: list[str]
    task_ids: list[UUID]
    blocked: list[BlockedTaskBody]


class ManagerPlanCreate(BaseModel):
    objective: str = Field(min_length=1, max_length=3900)
    operation: Literal["plan", "replan"] = "plan"


def register_manager(
    app: FastAPI,
    settings: Settings,
    provider: ModelProvider | None = None,
    durable: DurableRun | None = None,
) -> None:
    resolved = provider if provider is not None else _provider_for(settings)

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/manager-plans",
        response_model=ManagerPlanBody,
    )
    def create_plan(
        organization_id: UUID,
        project_id: UUID,
        body: ManagerPlanCreate,
        request: Request,
    ) -> ManagerPlanBody:
        principal = _session_principal(request)
        recorded = _run(
            settings,
            lambda connection: _plan(
                connection, resolved, principal, organization_id, project_id, body
            ),
        )
        if durable is not None and recorded.status == "CREATED":
            _submit_durable(settings, durable, principal, organization_id, project_id, recorded.id)
        return recorded

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/manager-plans/{plan_id}",
        response_model=ManagerPlanBody,
    )
    def read_plan(
        organization_id: UUID, project_id: UUID, plan_id: UUID, request: Request
    ) -> ManagerPlanBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _read(connection, principal, organization_id, project_id, plan_id),
        )


def _plan(
    connection: psycopg.Connection[Any],
    provider: ModelProvider,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ManagerPlanCreate,
) -> ManagerPlanBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    objective = body.objective.strip()
    if objective == "" or _SECRET_TEXT.search(objective):
        raise ValueError("manager fields are invalid")
    project_status = _project_status(connection, organization_id, project_id)
    blocked = _blocked(connection, organization_id, project_id)
    known = _task_titles(connection, organization_id, project_id)
    assumptions = _context_assumptions(
        connection, project_id, project_status, body.operation, objective, blocked
    )
    proposals: list[ProposedTask] = []
    if assumptions == []:
        proposals, model_assumptions = _propose(
            connection, provider, principal, organization_id, project_id, objective
        )
        assumptions = _validate(body.operation, objective, proposals, known, blocked)
        assumptions.extend(model_assumptions)
    assumptions = sorted(set(assumptions))
    task_ids: list[UUID] = []
    status = _decision(assumptions, proposals)
    if status == "CREATED":
        task_ids = _create_tasks(
            connection, principal, organization_id, project_id, body.operation, proposals, known
        )
    plan_id = _store(
        connection,
        principal,
        organization_id,
        project_id,
        objective,
        status,
        assumptions,
        task_ids,
    )
    if status == "CREATED":
        PostgresWorkflowEngine().start(
            connection,
            principal,
            organization_id,
            project_id,
            WorkflowStartBody(workflow_key=f"manager-{plan_id}", max_attempts=1),
        )
    return ManagerPlanBody(
        id=plan_id,
        status=status,
        objective=objective,
        assumptions=assumptions,
        task_ids=task_ids,
        blocked=blocked,
    )


def _context_assumptions(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    project_status: str,
    operation: str,
    objective: str,
    blocked: list[BlockedTaskBody],
) -> list[str]:
    found: list[str] = []
    if project_status != "ACTIVE":
        found.append("inactive_project")
    if _policy(objective):
        found.append("policy")
    created = connection.execute(
        """
        SELECT count(*) FROM manager_plans
        WHERE project_id = %s AND status = 'CREATED'
        """,
        (project_id,),
    ).fetchone()
    if created is not None and isinstance(created[0], int) and created[0] >= MAX_CREATED_PLANS:
        found.append("limit")
    if operation == "replan" and blocked == []:
        found.append("no_blocker")
    return found


def _propose(
    connection: psycopg.Connection[Any],
    provider: ModelProvider,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    objective: str,
) -> tuple[list[ProposedTask], list[str]]:
    if "audit-model" not in MODEL_CONFIGS:
        return [], ["malformed"]
    recorded = _create(
        connection,
        provider,
        principal,
        organization_id,
        project_id,
        ModelCallCreate(
            model_config_ref="audit-model",
            operation="generate",
            prompt=f"Propose tasks grounded in this objective.\n{objective}",
            output_schema=PLAN_SCHEMA,
        ),
    )
    if recorded.status != "SUCCEEDED" or recorded.output is None:
        return [], ["malformed"]
    raw_tasks = recorded.output.get("tasks")
    if not isinstance(raw_tasks, list):
        return [], ["malformed"]
    proposals: list[ProposedTask] = []
    for item in raw_tasks:
        if not isinstance(item, dict):
            return [], ["malformed"]
        title = item.get("title")
        depends_on = item.get("depends_on")
        if not isinstance(title, str) or not isinstance(depends_on, list):
            return [], ["malformed"]
        if not all(isinstance(name, str) for name in depends_on):
            return [], ["malformed"]
        proposals.append(
            ProposedTask(title=title.strip(), depends_on=[str(name) for name in depends_on])
        )
    return proposals, []


def _validate(
    operation: str,
    objective: str,
    proposals: list[ProposedTask],
    known: dict[str, UUID],
    blocked: list[BlockedTaskBody],
) -> list[str]:
    if len(proposals) > MAX_TASKS:
        return ["limit"]
    if proposals == []:
        return ["ambiguous"]
    assumptions: list[str] = []
    titles = [item.title for item in proposals]
    if any(title == "" for title in titles):
        assumptions.append("missing_field")
    if len(titles) != len(set(titles)):
        assumptions.append("duplicate_title")
    blockers = {item.blocker for item in blocked}
    for item in proposals:
        if item.title == "":
            continue
        if _policy(item.title):
            assumptions.append("policy")
        found_date = _DATE.search(item.title)
        if found_date is not None and found_date.group(0) not in objective:
            assumptions.append("deadline")
        if re.search(r"\b(approved|approval)\b", item.title, re.IGNORECASE):
            assumptions.append("approval")
        if re.search(r"\b(completed|succeeded)\b", item.title, re.IGNORECASE):
            assumptions.append("completed_work")
        grounded = item.title in _phrases(objective)
        if operation == "replan":
            grounded = item.title in blockers
        if not grounded:
            assumptions.append("invented_title")
        for dependency in item.depends_on:
            if dependency not in titles and dependency not in known:
                assumptions.append("dependency")
    if _has_cycle(proposals):
        assumptions.append("dependency")
    return assumptions


def _decision(assumptions: list[str], proposals: list[ProposedTask]) -> str:
    if "inactive_project" in assumptions:
        return "REFUSED"
    if "policy" in assumptions or "limit" in assumptions:
        return "ESCALATED"
    if assumptions != [] or proposals == []:
        return "CLARIFICATION"
    return "CREATED"


def _create_tasks(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    operation: str,
    proposals: list[ProposedTask],
    known: dict[str, UUID],
) -> list[UUID]:
    ordered = _ordered(proposals)
    created: dict[str, UUID] = {}
    blockers = _blocked(connection, organization_id, project_id)
    blocker_titles = {item.blocker: item.title for item in blockers}
    for item in ordered:
        depends: list[UUID] = []
        for name in item.depends_on:
            predecessor = created.get(name, known.get(name))
            if predecessor is not None and predecessor not in depends:
                depends.append(predecessor)
        if operation == "replan":
            blocked_title = blocker_titles.get(item.title)
            if blocked_title is not None and blocked_title in known:
                predecessor = known[blocked_title]
                if predecessor not in depends:
                    depends.append(predecessor)
        detail = create_task(
            connection,
            principal,
            organization_id,
            project_id,
            TaskCreateBody(title=item.title, status="DRAFT", depends_on_task_ids=depends),
        )
        created[item.title] = detail.id
    return list(created.values())


def _store(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    objective: str,
    status: str,
    assumptions: list[str],
    task_ids: list[UUID],
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO manager_plans (
                organization_id, project_id, actor_user_id, objective, status, assumptions, task_ids
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                principal.id,
                objective,
                status,
                Json(assumptions),
                task_ids,
            ),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[0], UUID):
            raise NotVisible()
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id, payload
            )
            VALUES (%s, %s, %s, 'manager.planned', 'manager_plan', %s, %s)
            """,
            (organization_id, project_id, principal.id, row[0], Json({"status": status})),
        )
    return row[0]


def _read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
) -> ManagerPlanBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    row = connection.execute(
        """
        SELECT id, objective, status, assumptions, task_ids
        FROM manager_plans
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (plan_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    plan_id_value, objective, status, assumptions, task_ids = row
    if (
        not isinstance(plan_id_value, UUID)
        or not isinstance(objective, str)
        or not isinstance(status, str)
        or not isinstance(assumptions, list)
        or not isinstance(task_ids, list)
    ):
        raise NotVisible()
    return ManagerPlanBody(
        id=plan_id_value,
        status=status,
        objective=objective,
        assumptions=[item for item in assumptions if isinstance(item, str)],
        task_ids=[item for item in task_ids if isinstance(item, UUID)],
        blocked=_blocked(connection, organization_id, project_id),
    )


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


def _task_titles(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> dict[str, UUID]:
    rows = connection.execute(
        """
        SELECT id, title FROM tasks
        WHERE organization_id = %s AND project_id = %s
        """,
        (organization_id, project_id),
    ).fetchall()
    titles: dict[str, UUID] = {}
    for row in rows:
        if isinstance(row[0], UUID) and isinstance(row[1], str):
            titles[row[1]] = row[0]
    return titles


def _blocked(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> list[BlockedTaskBody]:
    rows = connection.execute(
        """
        SELECT title, blocker FROM tasks
        WHERE organization_id = %s AND project_id = %s AND status = 'BLOCKED'
        ORDER BY title
        """,
        (organization_id, project_id),
    ).fetchall()
    blocked: list[BlockedTaskBody] = []
    for row in rows:
        if isinstance(row[0], str):
            blocker = row[1] if isinstance(row[1], str) else ""
            if blocker.strip() != "":
                blocked.append(BlockedTaskBody(title=row[0], blocker=blocker.strip()))
    return blocked


def _submit_durable(
    settings: Settings,
    durable: DurableRun,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
) -> None:
    try:
        run = _run(
            settings,
            lambda connection: _manager_workflow(
                connection, principal, organization_id, project_id, plan_id
            ),
        )
    except HTTPException:
        return
    if run is None:
        return
    try:
        durable.attach(run, organization_id, project_id, 0)
    except DurableUnavailable:
        return


def _manager_workflow(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
) -> WorkflowRunBody | None:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    row = connection.execute(
        """
        SELECT id FROM workflow_runs
        WHERE organization_id = %s AND project_id = %s AND workflow_key = %s
        """,
        (organization_id, project_id, f"manager-{plan_id}"),
    ).fetchone()
    if row is None or not isinstance(row[0], UUID):
        return None
    return PostgresWorkflowEngine().get(connection, principal, organization_id, project_id, row[0])


def _phrases(objective: str) -> set[str]:
    return {part.strip() for part in re.split(r"[\n.;]+", objective) if part.strip() != ""}


def _policy(value: str) -> bool:
    lowered = value.lower()
    return any(phrase in lowered for phrase in _POLICY)


def _has_cycle(proposals: list[ProposedTask]) -> bool:
    titles = {item.title for item in proposals}
    graph = {item.title: [name for name in item.depends_on if name in titles] for item in proposals}
    visiting: set[str] = set()
    visited: set[str] = set()

    def walk(title: str) -> bool:
        if title in visiting:
            return True
        if title in visited:
            return False
        visiting.add(title)
        for name in graph.get(title, []):
            if walk(name):
                return True
        visiting.remove(title)
        visited.add(title)
        return False

    return any(walk(title) for title in titles)


def _ordered(proposals: list[ProposedTask]) -> list[ProposedTask]:
    titles = {item.title for item in proposals}
    remaining = {item.title: item for item in proposals}
    ordered: list[ProposedTask] = []
    while remaining:
        ready = [
            item
            for item in remaining.values()
            if all(name not in remaining for name in item.depends_on if name in titles)
        ]
        if ready == []:
            break
        ready.sort(key=lambda item: item.title)
        for item in ready:
            ordered.append(item)
            del remaining[item.title]
    return ordered


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except ValueError:
        raise HTTPException(status_code=422, detail="manager fields are invalid") from None
    return result
