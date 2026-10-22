"""Provider-neutral model adapter. Providers propose. This module does not execute tools."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, Protocol, runtime_checkable
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
    # Prices in nano-dollars per token (1,000 nanos = 1 micro-dollar): $2 per million
    # tokens is 2,000. Costs are recorded in micro-dollars, rounded up.
    input_nanos_per_token: int
    output_nanos_per_token: int


# Which tier of model an agent's work runs on (model_providers.tier_config maps a tier to
# a pinned model). Milestone 3a.
ModelTier = Literal["FAST", "BALANCED", "DEEP"]


@dataclass(frozen=True)
class Provenance:
    """What a recorded call was, beyond its outcome: the agent, the record it worked on,
    the prompt's version and hashes, the job and attempt, its duration and error class.
    Never the key, never the prompt itself (provenance.py keeps that apart, encrypted)."""

    agent_key: str = ""
    tier: ModelTier | None = None
    prompt_version: str = ""
    prompt_sha256: str = ""
    output_sha256: str = ""
    target_type: str = ""
    target_id: UUID | None = None
    job_id: UUID | None = None
    attempt: int = 1
    duration_ms: int | None = None
    error: str = ""
    actor_agent_instance_id: UUID | None = None
    # What the call was made from: evidence file ids and hashes, the sheet and its
    # version, the approved plan revision, as the job knew them. Never the prompt.
    inputs: dict[str, Any] = field(default_factory=dict)
    # The call's configuration (M3d): model, tier, limits, the output schema's hash.
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Outcome:
    """One provider attempt: its status, the raw answer, and the error class when it
    failed (the vendor's status code, never its message), with whether a retry is worth
    it. A transient failure is overload, a server error, a dropped connection, a timeout
    or a rate limit."""

    status: str
    raw: ModelRaw
    error: str = ""
    transient: bool = False


MODEL_CONFIGS: dict[str, ModelConfig] = {
    "audit-model": ModelConfig("audit-model", "local", "local", 0, 0),
    "local": ModelConfig("local", "local", "local", 0, 0),
}
# The single tool a structured generation must answer through.
OUTPUT_TOOL = "record_output"


class ModelTimeout(Exception):
    """The provider did not answer before the deadline."""


class ModelCancelled(Exception):
    """The caller cancelled the generation."""


class ModelRateLimit(Exception):
    """The provider refused the call because of a rate limit."""


class ModelBudgetExceeded(Exception):
    """A budget refused the call before it was dispatched (provenance.py)."""


class ModelProviderError(Exception):
    """The provider could not complete the call.

    `transient` marks a failure worth trying again (overloaded, a server error, a dropped
    connection), as opposed to a request the provider rejected.
    """

    def __init__(self, transient: bool = False, status: int | None = None) -> None:
        super().__init__(f"provider error (status {status})" if status else "provider error")
        self.transient = transient
        self.status = status


@dataclass(frozen=True)
class ToolProposal:
    tool_id: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ModelImage:
    """One image for a provider that reads images. PNG or JPEG bytes."""

    media_type: Literal["image/png", "image/jpeg"]
    data: bytes


@dataclass(frozen=True)
class ModelRequest:
    operation: ModelOperation
    prompt: str
    output_schema: dict[str, Any]
    allowed_tool_ids: tuple[str, ...]
    timeout_seconds: int
    cancelled: bool
    system: str = ""
    # Shown to the model before the prompt. Only callers that are allowed to send images
    # to the provider set this.
    images: tuple[ModelImage, ...] = ()
    # How many web searches the model may run (milestone 8.10). Only callers allowed to
    # reach the web set this, and they send no client names in the prompt it searches from.
    web_search: int = 0
    # A larger answer than the default, for long structured outputs. 0 keeps the default.
    max_tokens: int = 0


@dataclass(frozen=True)
class ModelRaw:
    output: dict[str, Any] | None
    tool_calls: tuple[ToolProposal, ...]
    input_tokens: int
    output_tokens: int
    # The pages a web search returned, as (url, title): the only sources a caller may cite.
    sources: tuple[tuple[str, str], ...] = ()
    # True when the web search ran; False when it was not asked for or was unavailable.
    searched: bool = False


class ModelProvider(Protocol):
    """One model provider. A live provider is not included."""

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw: ...


# A conversation with tools, for the agent console. The provider proposes tool calls;
# the caller decides which run. Messages are provider-neutral:
#   {"role": "user" | "assistant", "content": [block, ...]}
# where a block is {"type": "text", "text"}, {"type": "tool_call", "id", "name",
# "arguments"}, or {"type": "tool_result", "id", "content", "is_error"}.


@dataclass(frozen=True)
class ChatTool:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ChatReply:
    text: str
    tool_calls: tuple[ToolCall, ...]
    input_tokens: int
    output_tokens: int


class ChatProvider(Protocol):
    def converse(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
    ) -> ChatReply: ...


@runtime_checkable
class StreamingChatProvider(Protocol):
    """A chat provider that also hands over its text as the model writes it."""

    def converse_streaming(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
        on_text: Callable[[str], None],
    ) -> ChatReply: ...


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
    # Provenance (Milestone 3a): who asked, which agent worked, which model and prompt
    # version answered, from what, how it ended. The prompt itself is behind /content.
    requested_by: UUID | None = None
    agent_instance_id: UUID | None = None
    agent_key: str | None = None
    tier: str | None = None
    model_name: str = ""
    prompt_version: str | None = None
    prompt_sha256: str | None = None
    output_sha256: str | None = None
    target_type: str | None = None
    target_id: UUID | None = None
    job_id: UUID | None = None
    attempt: int = 1
    duration_ms: int | None = None
    error: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    # Milestone 3d: the configuration and what the system made of the answer.
    config: dict[str, Any] = Field(default_factory=dict)
    outcome: dict[str, Any] = Field(default_factory=dict)
    has_content: bool = False
    created_at: datetime | None = None


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


def complete(
    provider: ModelProvider, request: ModelRequest, config: ModelConfig
) -> tuple[str, ModelRaw]:
    """Run one generation and name its outcome. A malformed answer is the caller's call."""
    found = outcome(provider, request, config)
    return found.status, found.raw


def outcome(provider: ModelProvider, request: ModelRequest, config: ModelConfig) -> Outcome:
    """One generation with its error class kept (provenance.py records it). A malformed
    answer keeps the raw output so a stricter caller may still read it."""
    status, raw, error, transient = _attempt(provider, request, config)
    if status == "SUCCEEDED" and request.operation == "generate":
        if raw.output is None or not _matches(request.output_schema, raw.output):
            return Outcome("MALFORMED", raw, "answer did not match the schema", False)
    return Outcome(status, raw, error, transient)


def record_call(
    connection: psycopg.Connection[Any],
    actor_id: UUID,
    organization_id: UUID,
    project_id: UUID,
    model_config_ref: str,
    status: str,
    raw: ModelRaw,
    config: ModelConfig,
    provenance: Provenance | None = None,
    operation: str = "generate",
) -> UUID:
    """Record a model call made for a person, such as drafting after their kickoff."""
    return _record_for(
        connection,
        actor_id,
        organization_id,
        project_id,
        model_config_ref,
        operation,
        status,
        raw,
        config,
        provenance,
    )


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
    status, raw, _error, _transient = _attempt(provider, request, config)
    return status, raw


def _attempt(
    provider: ModelProvider, request: ModelRequest, config: ModelConfig
) -> tuple[str, ModelRaw, str, bool]:
    """The status, the raw answer, the error class and whether a retry is worth it."""
    nothing = ModelRaw(None, (), 0, 0)
    if request.cancelled:
        return "CANCELLED", nothing, "cancelled before the call", False
    try:
        raw = provider.complete(request, config)
    except ModelTimeout:
        return "TIMEOUT", nothing, "the provider did not answer in time", True
    except ModelCancelled:
        return "CANCELLED", nothing, "cancelled", False
    except ModelRateLimit:
        return "RATE_LIMITED", nothing, "the provider rate limited the call", True
    except ModelBudgetExceeded:
        return "BUDGET_EXCEEDED", nothing, "a budget refused the call", False
    except ModelProviderError as error:
        detail = f"provider error (status {error.status})" if error.status else "provider error"
        return "MODEL_ERROR", nothing, detail, error.transient
    except Exception as error:  # noqa: BLE001 - a provider bug is a failed call, recorded
        return "MODEL_ERROR", nothing, f"provider raised {type(error).__name__}", False
    if raw.input_tokens < 0 or raw.output_tokens < 0:
        return "MODEL_ERROR", nothing, "the provider reported negative token counts", False
    return "SUCCEEDED", raw, "", False


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
    return _record_for(
        connection,
        principal.id,
        organization_id,
        project_id,
        model_config_ref,
        operation,
        status,
        raw,
        config,
    )


def _record_for(
    connection: psycopg.Connection[Any],
    actor_id: UUID,
    organization_id: UUID,
    project_id: UUID,
    model_config_ref: str,
    operation: str,
    status: str,
    raw: ModelRaw,
    config: ModelConfig,
    provenance: Provenance | None = None,
) -> UUID:
    found = provenance if provenance is not None else Provenance()
    # The error class is kept, never a message that could carry a key or client text.
    error = _SECRET_TEXT.sub("[redacted]", found.error)[:500]
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO model_calls (
                organization_id, project_id, actor_user_id, model_config_ref, operation, status,
                input_tokens, output_tokens, cost_micros, model_name, tier, agent_key,
                prompt_version, prompt_sha256, output_sha256, target_type, target_id, job_id,
                attempt, duration_ms, error, actor_agent_instance_id, inputs, config
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                actor_id,
                model_config_ref,
                operation,
                status,
                raw.input_tokens,
                raw.output_tokens,
                _cost(config, raw),
                config.model_name,
                found.tier,
                found.agent_key or None,
                found.prompt_version or None,
                found.prompt_sha256 or None,
                found.output_sha256 or None,
                found.target_type or None,
                found.target_id,
                found.job_id,
                max(1, min(found.attempt, 20)),
                found.duration_ms,
                error,
                found.actor_agent_instance_id,
                Json(found.inputs),
                Json(found.config),
            ),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[0], UUID):
            raise NotVisible()
        payload: dict[str, Any] = {"status": status}
        if found.agent_key:
            payload["agent"] = found.agent_key
        if found.tier:
            payload["tier"] = found.tier
            payload["model"] = config.model_name
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, actor_agent_instance_id, action,
                target_type, target_id, payload
            )
            VALUES (%s, %s, %s, %s, 'model.called', 'model_call', %s, %s)
            """,
            (
                organization_id,
                project_id,
                actor_id,
                found.actor_agent_instance_id,
                row[0],
                Json(payload),
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
        SELECT id, operation, status, model_config_ref, input_tokens, output_tokens, cost_micros,
               actor_user_id, actor_agent_instance_id, agent_key, tier, model_name,
               prompt_version, prompt_sha256, output_sha256, target_type, target_id, job_id,
               attempt, duration_ms, error, inputs, created_at,
               EXISTS (SELECT 1 FROM model_call_contents c WHERE c.model_call_id = model_calls.id),
               config,
               (SELECT o.outcome FROM model_call_outcomes o WHERE o.model_call_id = model_calls.id)
        FROM model_calls
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (call_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    call_id_value, operation, status, model_config_ref, input_tokens, output_tokens, cost = row[:7]
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
        requested_by=row[7],
        agent_instance_id=row[8],
        agent_key=row[9],
        tier=row[10],
        model_name=str(row[11] or ""),
        prompt_version=row[12],
        prompt_sha256=row[13],
        output_sha256=row[14],
        target_type=row[15],
        target_id=row[16],
        job_id=row[17],
        attempt=int(row[18] or 1),
        duration_ms=row[19],
        error=str(row[20] or ""),
        inputs=row[21] if isinstance(row[21], dict) else {},
        created_at=row[22],
        has_content=bool(row[23]),
        config=row[24] if isinstance(row[24], dict) else {},
        outcome=row[25] if isinstance(row[25], dict) else {},
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
    "BUDGET_EXCEEDED": 429,
}
_STATUS_DETAILS = {
    "MALFORMED": "model output is invalid",
    "TIMEOUT": "model timed out",
    "CANCELLED": "model call was cancelled",
    "RATE_LIMITED": "model rate limit",
    "MODEL_ERROR": "model provider is unavailable",
    "BUDGET_EXCEEDED": "model budget exhausted",
}


def _cost(config: ModelConfig, raw: ModelRaw) -> int:
    return cost_micros(config, raw.input_tokens, raw.output_tokens)


def cost_micros(config: ModelConfig, input_tokens: int, output_tokens: int) -> int:
    """The cost in micro-dollars, rounded up so a budget is never under-counted."""
    nanos = (
        input_tokens * config.input_nanos_per_token + output_tokens * config.output_nanos_per_token
    )
    return -(-nanos // 1000) if nanos > 0 else 0


def estimate_tokens(value: str) -> int:
    """A rough token count for text before it is sent (about four characters a token,
    plus a third for the newer tokenizers)."""
    return max(1, (len(value) * 4) // 12)


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
