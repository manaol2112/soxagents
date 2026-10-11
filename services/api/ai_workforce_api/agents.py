"""Organization agent definitions. A definition stores a model name, never a secret."""

import re
from collections.abc import Callable
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator, model_validator

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

AgentStatus = Literal["ACTIVE", "DISABLED"]
_TRANSITIONS: dict[str, frozenset[str]] = {
    "ACTIVE": frozenset({"ACTIVE", "DISABLED"}),
    "DISABLED": frozenset({"ACTIVE", "DISABLED"}),
}
_TOOL_ID = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
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
        "passwd",
        "token",
        "access_token",
        "refresh_token",
        "client_secret",
        "private_key",
        "access_key",
        "secret_key",
        "authorization",
        "credential",
        "credentials",
    }
)
_SCHEMA_WORDS = frozenset({"string", "number", "integer", "boolean", "object", "array", "null"})


class AgentStateError(Exception):
    """The requested status is not a legal next state."""


class AgentConflict(Exception):
    """Another definition in the organization already uses this key."""


class AgentVersionError(Exception):
    """The definition version no longer matches the caller's copy."""


class SecretMaterial(Exception):
    """The definition includes a secret value."""


class AgentSummaryBody(BaseModel):
    id: UUID
    agent_key: str
    name: str
    role: str
    status: str


class AgentDetailBody(BaseModel):
    id: UUID
    agent_key: str
    name: str
    role: str
    description: str
    revision: int
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    allowed_tool_ids: list[str]
    model_config_ref: str
    max_iterations: int
    time_budget_seconds: int
    status: str
    version: int


class AgentFields(BaseModel):
    agent_key: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    name: str = Field(min_length=1, max_length=200)
    role: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    allowed_tool_ids: list[str] = Field(default_factory=list, max_length=32)
    model_config_ref: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$")
    max_iterations: int = Field(ge=1, le=100)
    time_budget_seconds: int = Field(ge=1, le=86400)

    @field_validator("name", "role", "description")
    @classmethod
    def text_is_trimmed(cls, value: str) -> str:
        return value.strip()

    @field_validator("name", "role")
    @classmethod
    def text_is_visible(cls, value: str) -> str:
        if value.strip() == "":
            raise ValueError("text is blank")
        return value.strip()

    @field_validator("allowed_tool_ids")
    @classmethod
    def tools_are_ids(cls, value: list[str]) -> list[str]:
        seen: set[str] = set()
        for item in value:
            if len(item) > 80 or _TOOL_ID.fullmatch(item) is None or item in seen:
                raise ValueError("tool id is invalid")
            seen.add(item)
        return value

    @model_validator(mode="after")
    def contains_no_secret(self) -> AgentFields:
        try:
            _reject_secrets(self.model_dump())
        except SecretMaterial:
            raise ValueError("agent fields contain a secret") from None
        return self


class AgentCreateBody(AgentFields):
    status: AgentStatus = "ACTIVE"


class AgentUpdateBody(AgentFields):
    status: AgentStatus
    version: int = Field(ge=1)


def register_agents(app: FastAPI, settings: Settings) -> None:
    @app.get("/organizations/{organization_id}/agents", response_model=list[AgentSummaryBody])
    def agents(organization_id: UUID, request: Request) -> list[AgentSummaryBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: list_agents(connection, principal, organization_id),
        )

    @app.get(
        "/organizations/{organization_id}/agents/{agent_id}",
        response_model=AgentDetailBody,
    )
    def agent(organization_id: UUID, agent_id: UUID, request: Request) -> AgentDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: get_agent(connection, principal, organization_id, agent_id),
        )

    @app.post(
        "/organizations/{organization_id}/agents",
        response_model=AgentDetailBody,
        status_code=201,
    )
    def create(organization_id: UUID, body: AgentCreateBody, request: Request) -> AgentDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: create_agent(connection, principal, organization_id, body),
        )

    @app.patch(
        "/organizations/{organization_id}/agents/{agent_id}",
        response_model=AgentDetailBody,
    )
    def update(
        organization_id: UUID,
        agent_id: UUID,
        body: AgentUpdateBody,
        request: Request,
    ) -> AgentDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: update_agent(connection, principal, organization_id, agent_id, body),
        )


def list_agents(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> list[AgentSummaryBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.AGENT_READ,
        organization_id=organization_id,
    )
    rows = connection.execute(
        """
        SELECT id, agent_key, name, role, status::text
        FROM agent_definitions
        WHERE organization_id = %s
        ORDER BY agent_key
        """,
        (organization_id,),
    ).fetchall()
    return [_summary(row) for row in rows]


def get_agent(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    agent_id: UUID,
) -> AgentDetailBody:
    authorize(
        connection,
        principal=principal,
        action=Action.AGENT_READ,
        organization_id=organization_id,
    )
    return _load_detail(connection, organization_id, agent_id)


def create_agent(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    body: AgentCreateBody,
) -> AgentDetailBody:
    authorize(
        connection,
        principal=principal,
        action=Action.AGENT_UPDATE,
        organization_id=organization_id,
    )
    with transaction(connection) as cursor:
        try:
            cursor.execute(
                """
                INSERT INTO agent_definitions (
                    organization_id, agent_key, name, role, description, input_schema,
                    output_schema, allowed_tool_ids, model_config_ref, max_iterations,
                    time_budget_seconds, status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                _insert_values(organization_id, body),
            )
        except psycopg.errors.UniqueViolation:
            raise AgentConflict() from None
        created = cursor.fetchone()
        if created is None or not isinstance(created[0], UUID):
            raise NotVisible()
        agent_id = created[0]
        _audit(cursor, organization_id, principal.id, agent_id, "agent.created", body.status, 1)
    return _load_detail(connection, organization_id, agent_id)


def update_agent(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    agent_id: UUID,
    body: AgentUpdateBody,
) -> AgentDetailBody:
    authorize(
        connection,
        principal=principal,
        action=Action.AGENT_UPDATE,
        organization_id=organization_id,
    )
    with transaction(connection) as cursor:
        cursor.execute(
            """
            SELECT status::text
            FROM agent_definitions
            WHERE id = %s AND organization_id = %s
            FOR UPDATE
            """,
            (agent_id, organization_id),
        )
        current = cursor.fetchone()
        if current is None or not isinstance(current[0], str):
            raise NotVisible()
        if body.status not in _TRANSITIONS.get(current[0], frozenset()):
            raise AgentStateError()
        try:
            cursor.execute(
                """
                UPDATE agent_definitions
                SET agent_key = %s,
                    name = %s,
                    role = %s,
                    description = %s,
                    input_schema = %s,
                    output_schema = %s,
                    allowed_tool_ids = %s,
                    model_config_ref = %s,
                    max_iterations = %s,
                    time_budget_seconds = %s,
                    status = %s,
                    revision = revision + 1,
                    version = version + 1
                WHERE id = %s AND organization_id = %s AND version = %s
                RETURNING revision
                """,
                (
                    *_field_values(body),
                    body.status,
                    agent_id,
                    organization_id,
                    body.version,
                ),
            )
            require_one_row(cursor)
        except ConcurrentUpdateError:
            raise AgentVersionError() from None
        except psycopg.errors.UniqueViolation:
            raise AgentConflict() from None
        revised = cursor.fetchone()
        if revised is None or not isinstance(revised[0], int):
            raise AgentVersionError()
        _audit(
            cursor,
            organization_id,
            principal.id,
            agent_id,
            _update_action(current[0], body.status),
            body.status,
            revised[0],
        )
    return _load_detail(connection, organization_id, agent_id)


def _update_action(previous: str, status: str) -> str:
    if status == "DISABLED" and previous != "DISABLED":
        return "agent.disabled"
    if status == "ACTIVE" and previous == "DISABLED":
        return "agent.enabled"
    return "agent.updated"


def _insert_values(organization_id: UUID, body: AgentCreateBody) -> tuple[Any, ...]:
    return (organization_id, *_field_values(body), body.status)


def _field_values(body: AgentFields) -> tuple[Any, ...]:
    return (
        body.agent_key,
        body.name,
        body.role,
        body.description,
        Json(body.input_schema),
        Json(body.output_schema),
        body.allowed_tool_ids,
        body.model_config_ref,
        body.max_iterations,
        body.time_budget_seconds,
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    actor_user_id: UUID,
    agent_id: UUID,
    action: str,
    status: str,
    revision: int,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'agent_definition', %s, %s)
        """,
        (
            organization_id,
            actor_user_id,
            action,
            agent_id,
            Json({"status": status, "revision": revision}),
        ),
    )


def _load_detail(
    connection: psycopg.Connection[Any], organization_id: UUID, agent_id: UUID
) -> AgentDetailBody:
    row = connection.execute(
        """
        SELECT id, agent_key, name, role, description, revision, input_schema, output_schema,
               allowed_tool_ids, model_config_ref, max_iterations, time_budget_seconds,
               status::text, version
        FROM agent_definitions
        WHERE id = %s AND organization_id = %s
        """,
        (agent_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _detail(row)


def _summary(row: tuple[Any, ...]) -> AgentSummaryBody:
    agent_id, agent_key, name, role, status = row
    if (
        not isinstance(agent_id, UUID)
        or not isinstance(agent_key, str)
        or not isinstance(name, str)
        or not isinstance(role, str)
        or not isinstance(status, str)
    ):
        raise NotVisible()
    return AgentSummaryBody(id=agent_id, agent_key=agent_key, name=name, role=role, status=status)


def _detail(row: tuple[Any, ...]) -> AgentDetailBody:
    (
        agent_id,
        agent_key,
        name,
        role,
        description,
        revision,
        input_schema,
        output_schema,
        allowed_tool_ids,
        model_config_ref,
        max_iterations,
        time_budget_seconds,
        status,
        version,
    ) = row
    if (
        not isinstance(agent_id, UUID)
        or not isinstance(agent_key, str)
        or not isinstance(name, str)
        or not isinstance(role, str)
        or not isinstance(description, str)
        or not isinstance(revision, int)
        or not isinstance(input_schema, dict)
        or not isinstance(output_schema, dict)
        or not isinstance(allowed_tool_ids, list)
        or not all(isinstance(item, str) for item in allowed_tool_ids)
        or not isinstance(model_config_ref, str)
        or not isinstance(max_iterations, int)
        or not isinstance(time_budget_seconds, int)
        or not isinstance(status, str)
        or not isinstance(version, int)
    ):
        raise NotVisible()
    return AgentDetailBody(
        id=agent_id,
        agent_key=agent_key,
        name=name,
        role=role,
        description=description,
        revision=revision,
        input_schema=input_schema,
        output_schema=output_schema,
        allowed_tool_ids=allowed_tool_ids,
        model_config_ref=model_config_ref,
        max_iterations=max_iterations,
        time_budget_seconds=time_budget_seconds,
        status=status,
        version=version,
    )


def _reject_secrets(value: object) -> None:
    if isinstance(value, str):
        if _SECRET_TEXT.search(value):
            raise SecretMaterial()
        return
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).lower().replace("-", "_")
            if normalized in _SECRET_KEYS and isinstance(item, str) and item not in _SCHEMA_WORDS:
                raise SecretMaterial()
            _reject_secrets(item)
        return
    if isinstance(value, list):
        for item in value:
            _reject_secrets(item)


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except AgentStateError:
        raise HTTPException(status_code=409, detail="agent status cannot change that way") from None
    except AgentConflict:
        raise HTTPException(status_code=409, detail="agent key is already in use") from None
    except AgentVersionError:
        raise HTTPException(status_code=409, detail="agent changed") from None
    except ValueError:
        raise HTTPException(status_code=422, detail="agent fields are invalid") from None
    return result
