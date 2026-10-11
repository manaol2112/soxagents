"""Provider-neutral model adapter. Providers propose. This module does not execute tools."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol
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
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

ModelOperation = Literal["generate", "propose_tools"]
_SECRET_TEXT = re.compile(
    r"(?i)(api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|"
    r"private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY"
)
_LOCAL_PROVIDERS = frozenset({"", "mock", "local"})


@dataclass(frozen=True)
class ModelConfig:
    name: str
    provider: str
    model_name: str
    input_micros_per_token: int
    output_micros_per_token: int


MODEL_CONFIGS: dict[str, ModelConfig] = {
    "audit-model": ModelConfig("audit-model", "local", "local", 0, 0),
    "local": ModelConfig("local", "local", "local", 0, 0),
}


class ModelTimeout(Exception):
    """The provider did not answer before the deadline."""


class ModelCancelled(Exception):
    """The caller cancelled the generation."""


class ModelRateLimit(Exception):
    """The provider refused the call because of a rate limit."""


class ModelProviderError(Exception):
    """The provider could not complete the call."""


@dataclass(frozen=True)
class ToolProposal:
    tool_id: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ModelRequest:
    operation: ModelOperation
    prompt: str
    output_schema: dict[str, Any]
    allowed_tool_ids: tuple[str, ...]
    timeout_seconds: int
    cancelled: bool


@dataclass(frozen=True)
class ModelRaw:
    output: dict[str, Any] | None
    tool_calls: tuple[ToolProposal, ...]
    input_tokens: int
    output_tokens: int


class ModelProvider(Protocol):
    """One model provider. A live provider is not included."""

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw: ...


class LocalModelProvider:
    """Fills the schema with empty values. It does not read the prompt or call a network."""

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        if request.cancelled:
            raise ModelCancelled()
        if request.operation == "propose_tools":
            proposals = tuple(
                ToolProposal(tool_id=tool_id, arguments={}) for tool_id in request.allowed_tool_ids
            )
            return ModelRaw(None, proposals, _tokens(request.prompt), _tokens(str(len(proposals))))
        filled = _fill(request.output_schema)
        if not isinstance(filled, dict):
            raise ModelProviderError()
        return ModelRaw(filled, (), _tokens(request.prompt), _tokens(json.dumps(filled)))


class UnavailableModelProvider:
    """A named remote provider is not connected. The API key is not read."""

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        raise ModelProviderError()


class ToolProposalBody(BaseModel):
    tool_id: str
    arguments: dict[str, Any]


class ModelCallBody(BaseModel):
    id: UUID
    operation: str
    status: str
    model_config_ref: str
    input_tokens: int
    output_tokens: int
    cost_micros: int
    output: dict[str, Any] | None = None
    tool_calls: list[ToolProposalBody] = Field(default_factory=list)


class ModelCallCreate(BaseModel):
    model_config_ref: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$")
    operation: ModelOperation
    prompt: str = Field(min_length=1, max_length=4000)
    output_schema: dict[str, Any]
    allowed_tool_ids: list[str] = Field(default_factory=list, max_length=16)
    timeout_seconds: int = Field(default=30, ge=1, le=120)
    cancelled: bool = False

    @field_validator("allowed_tool_ids")
    @classmethod
    def tool_ids_are_names(cls, value: list[str]) -> list[str]:
        for tool_id in value:
            if re.fullmatch(r"[a-z0-9]+(?:[._-][a-z0-9]+)*", tool_id) is None:
                raise ValueError("model fields are invalid")
        return value

    @field_validator("output_schema")
    @classmethod
    def schema_is_an_object(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value)) > 8000 or not _schema_supported(value, 0):
            raise ValueError("model fields are invalid")
        return value


def register_models(
    app: FastAPI,
    settings: Settings,
    provider: ModelProvider | None = None,
) -> None:
    resolved = provider if provider is not None else _provider_for(settings)

    @app.post(
        "/organizations/{organization_id}/projects/{project_id}/model-calls",
        response_model=ModelCallBody,
    )
    def create_call(
        organization_id: UUID,
        project_id: UUID,
        body: ModelCallCreate,
        request: Request,
    ) -> ModelCallBody:
        principal = _session_principal(request)
        recorded = _run(
            settings,
            lambda connection: _create(
                connection, resolved, principal, organization_id, project_id, body
            ),
        )
        if recorded.status != "SUCCEEDED":
            raise HTTPException(
                status_code=_STATUS_CODES[recorded.status],
                detail=_STATUS_DETAILS[recorded.status],
            )
        return recorded

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/model-calls/{call_id}",
        response_model=ModelCallBody,
    )
    def read_call(
        organization_id: UUID, project_id: UUID, call_id: UUID, request: Request
    ) -> ModelCallBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _read(connection, principal, organization_id, project_id, call_id),
        )


def _provider_for(settings: Settings) -> ModelProvider:
    if settings.model_provider in _LOCAL_PROVIDERS:
        return LocalModelProvider()
    return UnavailableModelProvider()


def _create(
    connection: psycopg.Connection[Any],
    provider: ModelProvider,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ModelCallCreate,
) -> ModelCallBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    config = MODEL_CONFIGS.get(body.model_config_ref)
    if config is None:
        raise ValueError("model configuration is unknown")
    if _SECRET_TEXT.search(body.prompt):
        raise ValueError("model fields are invalid")
    request = ModelRequest(
        operation=body.operation,
        prompt=body.prompt,
        output_schema=body.output_schema,
        allowed_tool_ids=tuple(body.allowed_tool_ids),
        timeout_seconds=body.timeout_seconds,
        cancelled=body.cancelled,
    )
    status, raw = _complete(provider, request, config)
    try:
        output, tool_calls = _checked(body, raw, status)
    except _Malformed as error:
        status = "MALFORMED"
        raw = error.raw
        output = None
        tool_calls = ()
    call_id = _record(
        connection,
        principal,
        organization_id,
        project_id,
        body.model_config_ref,
        body.operation,
        status,
        raw,
        config,
    )
    return ModelCallBody(
        id=call_id,
        operation=body.operation,
        status=status,
        model_config_ref=body.model_config_ref,
        input_tokens=raw.input_tokens,
        output_tokens=raw.output_tokens,
        cost_micros=_cost(config, raw),
        output=output,
        tool_calls=[
            ToolProposalBody(tool_id=item.tool_id, arguments=item.arguments) for item in tool_calls
        ],
    )


def _complete(
    provider: ModelProvider, request: ModelRequest, config: ModelConfig
) -> tuple[str, ModelRaw]:
    if request.cancelled:
        return "CANCELLED", ModelRaw(None, (), 0, 0)
    try:
        raw = provider.complete(request, config)
    except ModelTimeout:
        return "TIMEOUT", ModelRaw(None, (), 0, 0)
    except ModelCancelled:
        return "CANCELLED", ModelRaw(None, (), 0, 0)
    except ModelRateLimit:
        return "RATE_LIMITED", ModelRaw(None, (), 0, 0)
    except ModelProviderError:
        return "MODEL_ERROR", ModelRaw(None, (), 0, 0)
    if raw.input_tokens < 0 or raw.output_tokens < 0:
        return "MODEL_ERROR", ModelRaw(None, (), 0, 0)
    return "SUCCEEDED", raw


def _checked(
    body: ModelCallCreate, raw: ModelRaw, status: str
) -> tuple[dict[str, Any] | None, tuple[ToolProposal, ...]]:
    if status != "SUCCEEDED":
        return None, ()
    if body.operation == "generate":
        if raw.output is None or not _matches(body.output_schema, raw.output):
            raise _Malformed(raw)
        return raw.output, ()
    allowed = set(body.allowed_tool_ids)
    for proposal in raw.tool_calls:
        if proposal.tool_id not in allowed or not isinstance(proposal.arguments, dict):
            raise _Malformed(raw)
    return None, raw.tool_calls


class _Malformed(Exception):
    def __init__(self, raw: ModelRaw) -> None:
        self.raw = raw


def _record(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    model_config_ref: str,
    operation: str,
    status: str,
    raw: ModelRaw,
    config: ModelConfig,
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO model_calls (
                organization_id, project_id, actor_user_id, model_config_ref, operation, status,
                input_tokens, output_tokens, cost_micros
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                principal.id,
                model_config_ref,
                operation,
                status,
                raw.input_tokens,
                raw.output_tokens,
                _cost(config, raw),
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
            VALUES (%s, %s, %s, 'model.called', 'model_call', %s, %s)
            """,
            (
                organization_id,
                project_id,
                principal.id,
                row[0],
                Json({"status": status}),
            ),
        )
    return row[0]


def _read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    call_id: UUID,
) -> ModelCallBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    row = connection.execute(
        """
        SELECT id, operation, status, model_config_ref, input_tokens, output_tokens, cost_micros
        FROM model_calls
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (call_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    call_id_value, operation, status, model_config_ref, input_tokens, output_tokens, cost = row
    if (
        not isinstance(call_id_value, UUID)
        or not isinstance(operation, str)
        or not isinstance(status, str)
        or not isinstance(model_config_ref, str)
        or not isinstance(input_tokens, int)
        or not isinstance(output_tokens, int)
        or not isinstance(cost, int)
    ):
        raise NotVisible()
    return ModelCallBody(
        id=call_id_value,
        operation=operation,
        status=status,
        model_config_ref=model_config_ref,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_micros=cost,
    )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except ValueError as error:
        detail = (
            "model configuration is unknown"
            if "unknown" in str(error)
            else "model fields are invalid"
        )
        raise HTTPException(status_code=422, detail=detail) from None
    return result


_STATUS_CODES = {
    "MALFORMED": 422,
    "TIMEOUT": 408,
    "CANCELLED": 409,
    "RATE_LIMITED": 429,
    "MODEL_ERROR": 503,
}
_STATUS_DETAILS = {
    "MALFORMED": "model output is invalid",
    "TIMEOUT": "model timed out",
    "CANCELLED": "model call was cancelled",
    "RATE_LIMITED": "model rate limit",
    "MODEL_ERROR": "model provider is unavailable",
}


def _cost(config: ModelConfig, raw: ModelRaw) -> int:
    return (
        raw.input_tokens * config.input_micros_per_token
        + raw.output_tokens * config.output_micros_per_token
    )


def _tokens(value: str) -> int:
    return max(1, len(value) // 4)


def _schema_supported(schema: object, depth: int) -> bool:
    if depth > 4 or not isinstance(schema, dict):
        return False
    kind = schema.get("type")
    if kind not in {"object", "string", "integer", "number", "boolean", "array"}:
        return False
    if kind == "object":
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        if not isinstance(properties, dict) or not isinstance(required, list):
            return False
        if not all(isinstance(name, str) and name in properties for name in required):
            return False
        return all(_schema_supported(item, depth + 1) for item in properties.values())
    if kind == "array":
        items = schema.get("items")
        return items is None or _schema_supported(items, depth + 1)
    return True


def _matches(schema: dict[str, Any], value: object) -> bool:
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            return False
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        if not isinstance(properties, dict) or not isinstance(required, list):
            return False
        for name in required:
            if name not in value:
                return False
        additional = schema.get("additionalProperties", True)
        for key, item in value.items():
            if key in properties and isinstance(properties[key], dict):
                if not _matches(properties[key], item):
                    return False
            elif additional is False:
                return False
        return True
    if kind == "string":
        return isinstance(value, str)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "array":
        if not isinstance(value, list):
            return False
        items = schema.get("items")
        if not isinstance(items, dict):
            return True
        return all(_matches(items, item) for item in value)
    return False


def _fill(schema: dict[str, Any]) -> object:
    kind = schema.get("type")
    if kind == "string":
        return ""
    if kind == "integer" or kind == "number":
        return 0
    if kind == "boolean":
        return False
    if kind == "array":
        return []
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    if not isinstance(properties, dict) or not isinstance(required, list):
        return {}
    filled: dict[str, Any] = {}
    for name in required:
        property_schema = properties.get(name)
        if isinstance(property_schema, dict):
            filled[name] = _fill(property_schema)
    return filled
