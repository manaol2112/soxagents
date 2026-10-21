"""How an agent's job calls the model, and what it leaves behind (Milestone 3a).

One `AgentCaller` per job. Each generation goes through it: the job's tier picks the
pinned model and its price; the budgets are checked before dispatch (a call past a limit
is refused and recorded as BUDGET_EXCEEDED, nothing is sent); a cancellation asked for by
a person is honoured before the call; a transient failure is tried again with a short
pause, a malformed answer once; and every attempt is recorded with its provenance (the
model, the tier, the agent, the prompt's version and hash, the answer's hash, the record
worked on, the job, the attempt, the duration, the error class) and, when the firm has a
provenance key, the prompt and the answer themselves, encrypted, kept for the configured
retention and readable only through the audited content route by the firm's owner or
admin or the engagement's reviewer, who state their purpose.

Nothing here decides anything about the audit: a caller reads the status and writes its
own record as MODEL, FALLBACK or FAILED. Nothing here runs from a page read.
"""

import base64
import hashlib
import json
import logging
import os
import time
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, cast
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel

from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    Role,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.model_providers import (
    AnthropicModelProvider,
    agent_tier,
    call_note,
    live_model,
    tier_config,
)
from ai_workforce_api.models import (
    ChatProvider,
    ChatReply,
    ChatTool,
    ModelBudgetExceeded,
    ModelCancelled,
    ModelConfig,
    ModelProvider,
    ModelProviderError,
    ModelRateLimit,
    ModelRaw,
    ModelRequest,
    ModelTier,
    ModelTimeout,
    Provenance,
    StreamingChatProvider,
    cost_micros,
    estimate_tokens,
    outcome,
    record_call,
)
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

# What one image costs in input tokens, for the estimate before dispatch.
IMAGE_TOKENS = 1_600
# The console's prompt version, recorded on every chat turn.
CHAT_PROMPT_VERSION = "console/1"
# Waits before a second and a third attempt after a transient failure.
RETRY_DELAYS = (2.0, 6.0)
TRANSIENT = frozenset({"TIMEOUT", "RATE_LIMITED", "MODEL_ERROR"})
READABLE = frozenset({"SUCCEEDED", "MALFORMED"})


def pause(seconds: float) -> None:
    """Wait between attempts. Tests replace this so they do not sleep."""
    time.sleep(seconds)


@dataclass(frozen=True)
class Job:
    """One agent job: who works, on what, for whom."""

    agent_key: str
    target_type: str
    target_id: UUID
    organization_id: UUID
    project_id: UUID
    requester: UUID
    attempt: int = 1
    job_id: UUID = field(default_factory=uuid4)
    # The engagement's instance of the roster worker, for the audit trail.
    agent_instance_id: UUID | None = None


@dataclass(frozen=True)
class Call:
    """The outcome of one generation after its retries."""

    status: str
    raw: ModelRaw
    call_id: UUID | None
    attempts: int

    @property
    def readable(self) -> bool:
        """A checked answer may still be read from a malformed one by a stricter check."""
        return self.status in READABLE and self.raw.output is not None

    @property
    def note(self) -> str:
        return "" if self.status == "SUCCEEDED" else call_note(self.status)


@dataclass(frozen=True)
class Limits:
    """Budgets in micro-dollars; 0 is no limit."""

    call: int
    job: int
    engagement_month: int

    @classmethod
    def of(cls, settings: Settings | None) -> Limits:
        if settings is None:
            return cls(0, 0, 0)
        return cls(
            settings.model_budget_call_micros,
            settings.model_budget_job_micros,
            settings.model_budget_engagement_month_micros,
        )


def config_for(settings: Settings | None, tier: ModelTier) -> ModelConfig:
    """The tier's pinned, priced model with a live provider; an unpriced local
    configuration otherwise (tests and the mock provider)."""
    if settings is not None and live_model(settings):
        return tier_config(settings, tier)
    return ModelConfig(tier.lower(), "local", "local", 0, 0)


def estimate_micros(config: ModelConfig, request: ModelRequest) -> int:
    """The most a call can cost: the prompt and system text, the images, and the full
    output allowance."""
    output = request.max_tokens or (8192 if request.images else 4096)
    inputs = (
        estimate_tokens(request.prompt)
        + estimate_tokens(request.system)
        + len(request.images) * IMAGE_TOKENS
    )
    return cost_micros(config, inputs, output)


def month_spend(connection: psycopg.Connection[Any], project_id: UUID) -> int:
    row = connection.execute(
        """
        SELECT coalesce(sum(cost_micros), 0) FROM model_calls
        WHERE project_id = %s AND created_at >= date_trunc('month', clock_timestamp())
        """,
        (project_id,),
    ).fetchone()
    return int(row[0]) if row is not None else 0


class AgentCaller:
    """The one way an agent job generates: tiered, budgeted, cancellable, recorded."""

    def __init__(
        self,
        connection: psycopg.Connection[Any],
        provider: ModelProvider | ChatProvider,
        job: Job,
        *,
        settings: Settings | None = None,
        tier: ModelTier | None = None,
        limits: Limits | None = None,
        cancelled: Callable[[], bool] | None = None,
        retry: bool = True,
        config: ModelConfig | None = None,
    ) -> None:
        self._connection = connection
        self._provider = provider
        self.job = job
        # A live provider reached without the settings in hand (a route's "plan again")
        # still prices and budgets its calls from the process's own settings.
        if settings is None and isinstance(provider, AnthropicModelProvider):
            settings = Settings()
        self.tier: ModelTier = tier if tier is not None else agent_tier(job.agent_key, settings)
        self.config = config if config is not None else config_for(settings, self.tier)
        self._settings = settings
        self._limits = limits if limits is not None else Limits.of(settings)
        self._cancelled = cancelled
        self._retry = retry
        self.spent = 0

    def derive(
        self,
        agent_key: str,
        tier: ModelTier | None = None,
        target_type: str | None = None,
        target_id: UUID | None = None,
    ) -> AgentCaller:
        """Another agent's calls within the same job (the same budget, the same
        cancellation): the screenshot review by the control's tester inside a read."""
        job = Job(
            agent_key,
            target_type or self.job.target_type,
            target_id or self.job.target_id,
            self.job.organization_id,
            self.job.project_id,
            self.job.requester,
            self.job.attempt,
            self.job.job_id,
            agent_actor(self._connection, self.job.project_id, agent_key),
        )
        other = AgentCaller(
            self._connection,
            self._provider,
            job,
            settings=self._settings,
            tier=tier,
            limits=self._limits,
            cancelled=self._cancelled,
            retry=self._retry,
        )
        other.spent = self.spent
        return other

    def cancelled(self) -> bool:
        return self._cancelled is not None and self._cancelled()

    def generate(
        self,
        request: ModelRequest,
        prompt_version: str,
        inputs: dict[str, Any] | None = None,
    ) -> Call:
        """One generation, tried again after a transient failure (never after a malformed
        or rejected one), recorded each time. `inputs` says what the call was made from
        (evidence file ids and hashes, the sheet and its version, the approved plan
        revision) and is kept on every attempt."""
        attempt = 0
        last: Call | None = None
        nothing = ModelRaw(None, (), 0, 0)
        while True:
            attempt += 1
            # A cancellation asked for while an earlier attempt failed or paused stops the
            # retry here: no further attempt is made.
            if self.cancelled():
                call_id = self._record(
                    "CANCELLED", nothing, request, prompt_version, attempt, None,
                    "cancelled before the call", inputs,
                )  # fmt: skip
                return Call("CANCELLED", nothing, call_id, attempt)
            refusal = self._over_budget(estimate_micros(self.config, request))
            if refusal:
                call_id = self._record(
                    "BUDGET_EXCEEDED", nothing, request, prompt_version, attempt, None, refusal,
                    inputs,
                )  # fmt: skip
                return Call("BUDGET_EXCEEDED", nothing, call_id, attempt)
            started = time.perf_counter()
            found = outcome(cast(ModelProvider, self._provider), request, self.config)
            duration = int((time.perf_counter() - started) * 1000)
            self.spent += cost_micros(self.config, found.raw.input_tokens, found.raw.output_tokens)
            call_id = self._record(
                found.status, found.raw, request, prompt_version, attempt, duration,
                found.error, inputs,
            )  # fmt: skip
            last = Call(found.status, found.raw, call_id, attempt)
            if found.status == "SUCCEEDED" or not self._retry:
                return last
            # Only a transient failure is tried again (the caller may still read a
            # malformed answer with a stricter check; it is not asked for twice).
            if not (found.transient and attempt <= len(RETRY_DELAYS)):
                return last
            pause(RETRY_DELAYS[attempt - 1])

    def chat(
        self,
        provider: ChatProvider,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
        on_text: Callable[[str], None] | None = None,
        attempt: int = 1,
        prompt_version: str = CHAT_PROMPT_VERSION,
    ) -> ChatReply:
        """One console turn through the budgets and the record. The provider's exceptions
        are raised after the failed attempt is recorded (the console keeps its own retry
        policy); ModelBudgetExceeded is raised before any call when a limit is reached.
        The provider is marked metered for the call, so a bare chat turn stays refused."""
        transcript = json.dumps(messages, sort_keys=True, default=str)
        request = ModelRequest(
            operation="propose_tools",
            prompt=transcript,
            output_schema={},
            allowed_tool_ids=tuple(tool.name for tool in tools),
            timeout_seconds=timeout_seconds,
            cancelled=False,
            system=system,
        )
        nothing = ModelRaw(None, (), 0, 0)
        inputs = {"messages": len(messages), "tools": len(tools)}
        refusal = self._over_budget(
            cost_micros(self.config, estimate_tokens(system) + estimate_tokens(transcript), 4096)
        )
        if refusal:
            self._record(
                "BUDGET_EXCEEDED", nothing, request, prompt_version, attempt, None, refusal,
                inputs, operation="propose_tools",
            )  # fmt: skip
            raise ModelBudgetExceeded()
        metered = getattr(provider, "metered", None)
        started = time.perf_counter()
        try:
            with metered() if callable(metered) else nullcontext():
                if on_text is not None and isinstance(provider, StreamingChatProvider):
                    reply = provider.converse_streaming(
                        system, messages, tools, timeout_seconds, on_text
                    )
                else:
                    reply = provider.converse(system, messages, tools, timeout_seconds)
        except (ModelTimeout, ModelRateLimit, ModelCancelled, ModelProviderError) as error:
            duration = int((time.perf_counter() - started) * 1000)
            status = {
                "ModelTimeout": "TIMEOUT",
                "ModelRateLimit": "RATE_LIMITED",
                "ModelCancelled": "CANCELLED",
            }.get(type(error).__name__, "MODEL_ERROR")
            detail = (
                f"provider error (status {error.status})"
                if isinstance(error, ModelProviderError) and error.status
                else status.lower().replace("_", " ")
            )
            self._record(
                status, nothing, request, prompt_version, attempt, duration, detail, inputs,
                operation="propose_tools",
            )  # fmt: skip
            raise
        duration = int((time.perf_counter() - started) * 1000)
        raw = ModelRaw(
            {
                "text": reply.text,
                "tool_calls": [
                    {"name": call.name, "arguments": call.arguments} for call in reply.tool_calls
                ],
            },
            (),
            reply.input_tokens,
            reply.output_tokens,
        )
        self.spent += cost_micros(self.config, raw.input_tokens, raw.output_tokens)
        self._record(
            "SUCCEEDED", raw, request, prompt_version, attempt, duration, "", inputs,
            operation="propose_tools",
        )  # fmt: skip
        return reply

    def _over_budget(self, estimate: int) -> str:
        limits = self._limits
        if limits.call and estimate > limits.call:
            return f"the call would cost about ${estimate / 1e6:.2f}, over the ${limits.call / 1e6:.2f} limit a call"  # noqa: E501
        if limits.job and self.spent + estimate > limits.job:
            return f"the job has spent ${self.spent / 1e6:.2f} and the next call would pass the ${limits.job / 1e6:.2f} limit a job"  # noqa: E501
        if limits.engagement_month:
            spent = month_spend(self._connection, self.job.project_id)
            if spent + estimate > limits.engagement_month:
                return f"the engagement has spent ${spent / 1e6:.2f} this month and the next call would pass the ${limits.engagement_month / 1e6:.2f} limit"  # noqa: E501
        return ""

    def _record(
        self,
        status: str,
        raw: ModelRaw,
        request: ModelRequest,
        prompt_version: str,
        attempt: int,
        duration_ms: int | None,
        error: str,
        inputs: dict[str, Any] | None = None,
        operation: str = "generate",
    ) -> UUID:
        prompt_hash = sha256_text(request.system + "\n" + request.prompt)
        output_hash = sha256_text(json.dumps(raw.output, sort_keys=True)) if raw.output else ""
        call_id = record_call(
            self._connection,
            self.job.requester,
            self.job.organization_id,
            self.job.project_id,
            self.config.name,
            status,
            raw,
            self.config,
            Provenance(
                agent_key=self.job.agent_key,
                tier=self.tier,
                prompt_version=prompt_version,
                prompt_sha256=prompt_hash,
                output_sha256=output_hash,
                target_type=self.job.target_type,
                target_id=self.job.target_id,
                job_id=self.job.job_id,
                attempt=attempt,
                duration_ms=duration_ms,
                error=error,
                actor_agent_instance_id=self.job.agent_instance_id,
                inputs=inputs or {},
            ),
            operation=operation,
        )
        if status != "BUDGET_EXCEEDED":
            store_contents(self._connection, self._settings, self.job, call_id, request, raw)
        return call_id


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


_RAISES: dict[str, Callable[[], Exception]] = {
    "TIMEOUT": ModelTimeout,
    "RATE_LIMITED": ModelRateLimit,
    "CANCELLED": ModelCancelled,
    "BUDGET_EXCEEDED": ModelBudgetExceeded,
    "MODEL_ERROR": ModelProviderError,
}


class CallerProvider:
    """The caller behind the older (provider, record) protocol that the evidence reading
    modules use: `complete(provider, request, config)` runs the tiered, budgeted,
    recorded generation, and the `record(status, raw)` callback hands back the id of the
    call already recorded instead of recording a second one. The config argument is
    ignored: the caller's tier decides the model."""

    def __init__(
        self, caller: AgentCaller, prompt_version: str, inputs: dict[str, Any] | None = None
    ) -> None:
        self._caller = caller
        self._version = prompt_version
        self._inputs = inputs
        self.last: Call | None = None

    @property
    def caller(self) -> AgentCaller:
        return self._caller

    def for_agent(
        self, agent_key: str, tier: ModelTier | None, prompt_version: str
    ) -> CallerProvider:
        return CallerProvider(self._caller.derive(agent_key, tier), prompt_version, self._inputs)

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        call = self._caller.generate(request, self._version, self._inputs)
        self.last = call
        if call.status in READABLE:
            # models.complete checks the schema again and names a malformed answer itself.
            return call.raw
        raise _RAISES.get(call.status, ModelProviderError)()

    def record(self, status: str, raw: ModelRaw) -> UUID:
        """The id of the call `complete` recorded. A record asked for without a call (a
        provider bug) is written plainly so nothing is lost."""
        if self.last is not None and self.last.call_id is not None:
            found = self.last.call_id
            self.last = None
            return found
        return record_call(
            self._caller._connection,  # noqa: SLF001 - the same job's connection
            self._caller.job.requester,
            self._caller.job.organization_id,
            self._caller.job.project_id,
            self._caller.config.name,
            status,
            raw,
            self._caller.config,
            Provenance(
                agent_key=self._caller.job.agent_key,
                tier=self._caller.tier,
                target_type=self._caller.job.target_type,
                target_id=self._caller.job.target_id,
                job_id=self._caller.job.job_id,
            ),  # fmt: skip
        )


# The encrypted prompt and answer


def content_key(settings: Settings | None) -> tuple[str, bytes] | None:
    """The firm's current provenance key and its identifier, or None when contents are
    not kept. New content is always sealed under this key."""
    if settings is None:
        return None
    return _decode_key(settings.provenance_key, "PROVENANCE_KEY")


def key_id_of(key: bytes) -> str:
    """A key's identifier: the first twelve hex characters of its SHA-256. It names the
    key on every sealed record without revealing it."""
    return hashlib.sha256(key).hexdigest()[:12]


def _decode_key(value: str, name: str) -> tuple[str, bytes] | None:
    if value.strip() == "":
        return None
    try:
        key = base64.b64decode(value.strip(), validate=True)
    except ValueError:
        logger.warning("%s is not base64; it is ignored", name)
        return None
    if len(key) != 32:
        logger.warning("%s is not 32 bytes; it is ignored", name)
        return None
    return key_id_of(key), key


def content_keys(settings: Settings | None) -> dict[str, bytes]:
    """Every key content may be sealed under, by id: the current one and the earlier ones
    kept in PROVENANCE_PREVIOUS_KEYS after a rotation."""
    found: dict[str, bytes] = {}
    if settings is None:
        return found
    current = content_key(settings)
    if current is not None:
        found[current[0]] = current[1]
    for index, value in enumerate(settings.provenance_previous_keys.split(",")):
        older = _decode_key(value, f"PROVENANCE_PREVIOUS_KEYS[{index}]")
        if older is not None:
            found.setdefault(older[0], older[1])
    return found


def store_contents(
    connection: psycopg.Connection[Any],
    settings: Settings | None,
    job: Job,
    call_id: UUID,
    request: ModelRequest,
    raw: ModelRaw,
) -> bool:
    """Keep the prompt and the answer, encrypted, until their expiry. False when the
    firm keeps hashes only."""
    found = content_key(settings)
    if found is None or settings is None:
        return False
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key_id, key = found
    plain = json.dumps(
        {"system": request.system, "prompt": request.prompt, "output": raw.output},
        ensure_ascii=False,
    ).encode("utf-8")
    nonce = os.urandom(12)
    sealed = AESGCM(key).encrypt(nonce, plain, call_id.bytes)
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO model_call_contents (
                organization_id, project_id, model_call_id, key_id, nonce, ciphertext,
                prompt_chars, output_chars, image_count, expires_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, clock_timestamp() + %s)
            """,
            (
                job.organization_id,
                job.project_id,
                call_id,
                key_id,
                nonce,
                sealed,
                len(request.prompt),
                0 if raw.output is None else len(json.dumps(raw.output)),
                len(request.images),
                timedelta(days=settings.model_content_retention_days),
            ),
        )
    return True


def purge_expired_contents(connection: psycopg.Connection[Any]) -> int:
    """Remove prompts and answers past their retention. The call records and hashes stay."""
    with transaction(connection) as cursor:
        cursor.execute("DELETE FROM model_call_contents WHERE expires_at <= clock_timestamp()")
        return cursor.rowcount


class ContentBody(BaseModel):
    call_id: UUID
    # The id of the key the content is sealed under (operations.md, key rotation).
    key_id: str
    system: str
    prompt: str
    output: dict[str, Any] | None
    image_count: int
    expires_at: str
    # The person's stated purpose, as recorded.
    purpose: str


_CONTENT_ROLES = frozenset({Role.OWNER, Role.ADMIN})


def read_contents(
    connection: psycopg.Connection[Any],
    principal: Principal,
    settings: Settings,
    organization_id: UUID,
    project_id: UUID,
    call_id: UUID,
    purpose: str,
) -> ContentBody:
    """The prompt and answer of one call, for the firm's owner or admin or the
    engagement's reviewer, with a stated purpose; every read is audited."""
    access = authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    if access.role not in _CONTENT_ROLES and not _engagement_reviewer(
        connection, project_id, principal.id
    ):
        raise AccessDenied()
    row = connection.execute(
        """
        SELECT c.key_id, c.nonce, c.ciphertext, c.image_count, c.expires_at
        FROM model_call_contents c
        JOIN model_calls m ON m.id = c.model_call_id
        WHERE c.model_call_id = %s AND c.organization_id = %s AND c.project_id = %s
          AND m.organization_id = %s AND m.project_id = %s
        """,
        (call_id, organization_id, project_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    key = content_keys(settings).get(str(row[0]))
    if key is None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"this content is sealed under key {row[0]}, which is not configured; "
                "add it to PROVENANCE_PREVIOUS_KEYS to read it"
            ),
        )
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    plain = json.loads(AESGCM(key).decrypt(bytes(row[1]), bytes(row[2]), call_id.bytes))
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id, payload
            )
            VALUES (%s, %s, %s, 'model_call.content_read', 'model_call', %s, %s)
            """,
            (organization_id, project_id, principal.id, call_id, Json({"purpose": purpose})),
        )
    return ContentBody(
        call_id=call_id,
        key_id=str(row[0]),
        system=str(plain.get("system", "")),
        prompt=str(plain.get("prompt", "")),
        output=plain.get("output") if isinstance(plain.get("output"), dict) else None,
        image_count=int(row[3]),
        expires_at=row[4].isoformat(),
        purpose=purpose,
    )


def _engagement_reviewer(
    connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID
) -> bool:
    row = connection.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM project_memberships
            WHERE project_id = %s AND user_id = %s AND engagement_role = 'REVIEWER'
        ) OR EXISTS (
            SELECT 1 FROM project_member_roles
            WHERE project_id = %s AND user_id = %s AND engagement_role = 'REVIEWER'
        )
        """,
        (project_id, user_id, project_id, user_id),
    ).fetchone()
    return bool(row is not None and row[0])


# The agent as actor


def agent_actor(
    connection: psycopg.Connection[Any], project_id: UUID, agent_key: str
) -> UUID | None:
    """The engagement's instance of a roster worker, for audit events the agent writes.
    None when the engagement is not staffed with it (the event then names no agent)."""
    row = connection.execute(
        """
        SELECT i.id FROM agent_instances i
        JOIN agent_definitions d ON d.id = i.agent_definition_id
        WHERE i.project_id = %s AND d.agent_key = %s
        ORDER BY i.created_at LIMIT 1
        """,
        (project_id, agent_key),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


def register_provenance(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/model-calls/{{call_id}}/content", response_model=ContentBody)
    def content(
        organization_id: UUID, project_id: UUID, call_id: UUID, purpose: str, request: Request
    ) -> ContentBody:
        stated = purpose.strip()
        if not 8 <= len(stated) <= 300:
            raise HTTPException(status_code=422, detail="state the purpose of reading this content")
        principal = _session_principal(request)
        return _call(
            settings,
            lambda connection: read_contents(
                connection, principal, settings, organization_id, project_id, call_id, stated
            ),
        )
