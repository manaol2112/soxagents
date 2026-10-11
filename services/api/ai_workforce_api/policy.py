"""Deterministic action policy. A decision does not execute the action."""

from collections.abc import Callable
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret, find_action, parameters_ok
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
    permits,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

DecisionName = Literal["ALLOW", "DENY"]
ReasonName = Literal[
    "allowed",
    "unregistered",
    "invalid",
    "permission",
    "organization",
    "project",
    "inactive",
    "self",
    "agent",
]
_READ_PERMISSIONS = frozenset(
    {
        Action.ORGANIZATION_READ,
        Action.MEMBERSHIP_READ,
        Action.PROJECT_READ,
        Action.TASK_READ,
        Action.AGENT_READ,
    }
)


class PolicyDecision(BaseModel):
    action_id: str
    decision: DecisionName
    reason: ReasonName


class PolicyRequest(BaseModel):
    action_id: str = Field(pattern=r"^[a-z]+(?:[.][a-z]+)*$", max_length=40)
    parameters: dict[str, str] = Field(default_factory=dict)


class RestrictionBody(BaseModel):
    id: UUID
    action_id: str
    project_id: UUID | None


class RestrictionCreate(BaseModel):
    action_id: str = Field(pattern=r"^[a-z]+(?:[.][a-z]+)*$", max_length=40)
    project_id: UUID | None = None


def register_policy(app: FastAPI, settings: Settings) -> None:
    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/actions/decide",
        response_model=PolicyDecision,
    )
    def decide(
        organization_id: UUID,
        project_id: UUID,
        body: PolicyRequest,
        request: Request,
    ) -> PolicyDecision:
        principal = _session_principal(request)
        if contains_secret(body.parameters):
            raise HTTPException(status_code=422, detail="action fields are invalid")
        return _run(
            settings,
            lambda connection: evaluate(
                connection, principal, organization_id, project_id, body.action_id, body.parameters
            ),
        )

    @app.post(
        "/organizations/{organization_id}/action-restrictions",
        response_model=RestrictionBody,
    )
    def create_restriction(
        organization_id: UUID,
        body: RestrictionCreate,
        request: Request,
    ) -> RestrictionBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _restrict(connection, principal, organization_id, body),
        )

    @app.delete(
        "/organizations/{organization_id}/action-restrictions/{restriction_id}",
        status_code=204,
    )
    def delete_restriction(
        organization_id: UUID,
        restriction_id: UUID,
        request: Request,
    ) -> None:
        principal = _session_principal(request)
        _run(
            settings,
            lambda connection: _lift(connection, principal, organization_id, restriction_id),
        )


def evaluate(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    action_id: str,
    parameters: dict[str, str],
) -> PolicyDecision:
    if principal.kind is PrincipalKind.AGENT:
        return _agent_decision(action_id, parameters)
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    action = find_action(action_id)
    if action is None:
        return _denied(action_id, "unregistered")
    if not parameters_ok(action, parameters):
        return _denied(action_id, "invalid")
    if action.action_id == "permission.modify" and _targets_self(principal, parameters):
        return _denied(action_id, "self")
    if not permits(
        connection,
        principal=principal,
        action=action.permission,
        organization_id=organization_id,
        project_id=project_id,
    ):
        return _denied(action_id, "permission")
    if _restricted(connection, organization_id, None, action_id):
        return _denied(action_id, "organization")
    if _restricted(connection, organization_id, project_id, action_id):
        return _denied(action_id, "project")
    if (
        action.permission not in _READ_PERMISSIONS
        and _project_status(connection, organization_id, project_id) != "ACTIVE"
    ):
        return _denied(action_id, "inactive")
    return PolicyDecision(action_id=action_id, decision="ALLOW", reason="allowed")


def _restrict(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    body: RestrictionCreate,
) -> RestrictionBody:
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_UPDATE,
        organization_id=organization_id,
    )
    if find_action(body.action_id) is None:
        raise ValueError("action is not registered")
    if body.project_id is not None:
        _project_status(connection, organization_id, body.project_id)
    existing = _restriction(connection, organization_id, body.project_id, body.action_id)
    if existing is not None:
        return existing
    created: UUID | None = None
    try:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO action_restrictions (organization_id, project_id, action_id)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (organization_id, body.project_id, body.action_id),
            )
            row = cursor.fetchone()
            if row is None or not isinstance(row[0], UUID):
                raise NotVisible()
            created = row[0]
            _audit(
                cursor,
                organization_id,
                body.project_id,
                principal.id,
                created,
                "action.restricted",
                body.action_id,
            )
    except UniqueViolation:
        raced = _restriction(connection, organization_id, body.project_id, body.action_id)
        if raced is None:
            raise NotVisible() from None
        return raced
    if created is None:
        raise NotVisible()
    return RestrictionBody(id=created, action_id=body.action_id, project_id=body.project_id)


def _lift(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    restriction_id: UUID,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_UPDATE,
        organization_id=organization_id,
    )
    with transaction(connection) as cursor:
        cursor.execute(
            """
            DELETE FROM action_restrictions
            WHERE id = %s AND organization_id = %s
            RETURNING project_id, action_id
            """,
            (restriction_id, organization_id),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[1], str):
            raise NotVisible()
        project_id = row[0] if isinstance(row[0], UUID) else None
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            restriction_id,
            "action.restriction_lifted",
            row[1],
        )


def _agent_decision(action_id: str, parameters: dict[str, str]) -> PolicyDecision:
    action = find_action(action_id)
    if action is None:
        return _denied(action_id, "unregistered")
    if not parameters_ok(action, parameters):
        return _denied(action_id, "invalid")
    if action.action_id == "permission.modify":
        return _denied(action_id, "agent")
    return _denied(action_id, "permission")


def _targets_self(principal: Principal, parameters: dict[str, str]) -> bool:
    target = parameters.get("target_user_ref", "").strip()
    own = str(principal.id)
    return target == own or target == f"user/{own}"


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


def _restricted(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID | None,
    action_id: str,
) -> bool:
    if project_id is None:
        row = connection.execute(
            """
            SELECT 1 FROM action_restrictions
            WHERE organization_id = %s AND project_id IS NULL AND action_id = %s
            """,
            (organization_id, action_id),
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT 1 FROM action_restrictions
            WHERE organization_id = %s AND project_id = %s AND action_id = %s
            """,
            (organization_id, project_id, action_id),
        ).fetchone()
    return row is not None


def _restriction(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID | None,
    action_id: str,
) -> RestrictionBody | None:
    if project_id is None:
        row = connection.execute(
            """
            SELECT id, action_id FROM action_restrictions
            WHERE organization_id = %s AND project_id IS NULL AND action_id = %s
            """,
            (organization_id, action_id),
        ).fetchone()
    else:
        row = connection.execute(
            """
            SELECT id, action_id FROM action_restrictions
            WHERE organization_id = %s AND project_id = %s AND action_id = %s
            """,
            (organization_id, project_id, action_id),
        ).fetchone()
    if row is None or not isinstance(row[0], UUID) or not isinstance(row[1], str):
        return None
    return RestrictionBody(id=row[0], action_id=row[1], project_id=project_id)


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID | None,
    actor_id: UUID,
    restriction_id: UUID,
    action: str,
    action_id: str,
) -> None:
    scope = "project" if project_id is not None else "organization"
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'action_restriction', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor_id,
            action,
            restriction_id,
            Json({"action_id": action_id, "scope": scope}),
        ),
    )


def _denied(action_id: str, reason: ReasonName) -> PolicyDecision:
    return PolicyDecision(action_id=action_id, decision="DENY", reason=reason)


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except ValueError:
        raise HTTPException(status_code=422, detail="action is not registered") from None
    return result
