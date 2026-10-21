"""Model providers that call a vendor. The model adapter itself stays vendor-neutral.

Only this module names a vendor SDK, so the adapter and the agents never import one.
"""

import base64
import json
import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

from ai_workforce_api.models import (
    OUTPUT_TOOL,
    ChatProvider,
    ChatReply,
    ChatTool,
    LocalModelProvider,
    ModelCancelled,
    ModelConfig,
    ModelProvider,
    ModelProviderError,
    ModelRateLimit,
    ModelRaw,
    ModelRequest,
    ModelTier,
    ModelTimeout,
    ToolCall,
    UnavailableModelProvider,
)
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

LOCAL_PROVIDERS = frozenset({"", "mock", "local"})

# Milestone 3a: three tiers, each pinned to a model the provider lists, with its price in
# dollars per million tokens (input, output) as published on 20 October 2026 and checked
# against the provider's model list and a structured-output call before being chosen.
# Haiku 5.5's price is for prompts up to 100,000 tokens, which every agent prompt is.
TIER_DEFAULTS: dict[ModelTier, str] = {
    "FAST": "claude-haiku-5-5",
    "BALANCED": "claude-sonnet-5-5",
    "DEEP": "claude-opus-5-5",
}
KNOWN_PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-4-6": (5.00, 25.00),
    "claude-haiku-4-5-20251001": (1.00, 5.00),
}
# Which tier each agent's work runs on (the owner's development defaults, Milestone 3a
# closure). FAST: routine classification and low-complexity extraction (reading, matching
# and classifying evidence, RCM scans, system suggestions, the library match). BALANCED:
# evidence interpretation, testing drafts and routine reviewer analysis (everything else,
# the independent reviewer included). DEEP: explicitly authorized complex analysis only,
# through MODEL_DEEP_AGENTS; no agent runs on it by default.
AGENT_TIERS: dict[str, ModelTier] = {
    "evidence-reader": "FAST",
    "evidence-coordinator": "BALANCED",
    "itgc-access-tester": "BALANCED",
    "itgc-change-tester": "BALANCED",
    "itgc-operations-tester": "BALANCED",
    "business-process-tester": "BALANCED",
    "workpaper-preparer": "BALANCED",
    "engagement-planner": "BALANCED",
    "independent-reviewer": "BALANCED",
    "reporting-analyst": "BALANCED",
    "console-lead": "BALANCED",
}
TIER_NAMES = frozenset({"fast", "balanced", "deep"})
# The default Claude model when MODEL_NAME is empty: the BALANCED tier's.
DEFAULT_CLAUDE_MODEL = TIER_DEFAULTS["BALANCED"]
# The configuration of modules not yet moved to a tier (the console, setup, scoping, the
# RCM readers, the library): the BALANCED model at its price. The provider substitutes
# MODEL_NAME for it when one is set.
CLAUDE_CONFIG = ModelConfig("claude", "anthropic", DEFAULT_CLAUDE_MODEL, 2_000, 10_000)


def nanos_per_token(dollars_per_million: float) -> int:
    """$2 per million tokens is 2,000 nano-dollars a token."""
    return round(dollars_per_million * 1_000)


def model_prices(settings: Settings) -> dict[str, tuple[int, int]]:
    """Known prices plus MODEL_PRICES, in nanos per token. A malformed entry is ignored."""
    prices = {
        name: (nanos_per_token(i), nanos_per_token(o)) for name, (i, o) in KNOWN_PRICES.items()
    }
    if settings.model_prices.strip():
        try:
            extra = json.loads(settings.model_prices)
        except ValueError:
            extra = None
        if isinstance(extra, dict):
            for name, pair in extra.items():
                if (
                    isinstance(name, str)
                    and isinstance(pair, list)
                    and len(pair) == 2
                    and all(isinstance(v, (int, float)) and v >= 0 for v in pair)
                ):
                    prices[name] = (nanos_per_token(pair[0]), nanos_per_token(pair[1]))
    return prices


def tier_model(settings: Settings, tier: ModelTier) -> str:
    chosen = {
        "FAST": settings.model_fast,
        "BALANCED": settings.model_balanced or settings.model_name,
        "DEEP": settings.model_deep,
    }[tier].strip()
    return chosen or TIER_DEFAULTS[tier]


def tier_config(settings: Settings, tier: ModelTier) -> ModelConfig:
    """The pinned model and price of a tier. A live model without a known price is a
    configuration error: no call is made whose cost cannot be counted."""
    model = tier_model(settings, tier)
    price = model_prices(settings).get(model)
    if price is None:
        if live_model(settings):
            raise ValueError(f"no price is configured for the {tier} model {model}")
        price = (0, 0)
    return ModelConfig(tier.lower(), "anthropic", model, price[0], price[1])


def agent_tier(agent_key: str, settings: Settings | None = None) -> ModelTier:
    """The tier an agent runs on: DEEP only when the settings name it, else its default."""
    if settings is not None and agent_key in deep_agents(settings):
        return "DEEP"
    return AGENT_TIERS.get(agent_key, "BALANCED")


def deep_agents(settings: Settings) -> frozenset[str]:
    return frozenset(key.strip() for key in settings.model_deep_agents.split(",") if key.strip())


def check_model_configuration(settings: Settings) -> list[str]:
    """What is wrong with the live model configuration, for the start-up check and the
    automation status: an empty list when every tier has a priced model."""
    if not live_model(settings):
        return []
    problems: list[str] = []
    for tier in ("FAST", "BALANCED", "DEEP"):
        try:
            tier_config(settings, tier)
        except ValueError as error:
            problems.append(str(error))
    return problems


class AnthropicModelProvider:
    """Claude through the Anthropic API. The key is held in memory and never logged.

    A structured generation is answered through one tool whose input schema is the
    requested output schema. An answer outside the tool is no answer, and the caller
    still checks the result against the schema.
    """

    def __init__(self, api_key: str, model_name: str, allow_unmetered: bool = False) -> None:
        self._api_key = api_key
        self._model = model_name or DEFAULT_CLAUDE_MODEL
        # Containment (Milestone 3a closure): a call that is not a tier's, or a chat turn
        # outside the agent caller, carries no budget and no provenance and is refused
        # unless MODEL_ALLOW_UNMETERED authorizes it for development.
        self._allow_unmetered = allow_unmetered
        self._metered_depth = 0

    @contextmanager
    def metered(self) -> Iterator[None]:
        """The agent caller's mark: chat turns inside this block are metered by it."""
        self._metered_depth += 1
        try:
            yield
        finally:
            self._metered_depth -= 1

    def _refuse_unmetered(self, what: str) -> None:
        if self._allow_unmetered:
            return
        logger.warning("unmetered live model %s refused; route it through the agent caller", what)
        raise ModelProviderError(transient=False, status=None)

    def model_for(self, config: ModelConfig) -> str:
        """A tier's pinned model; the configured default for the untiered configuration."""
        if config.provider == "anthropic" and config.name != CLAUDE_CONFIG.name:
            return config.model_name or self._model
        return self._model

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        if config.provider != "anthropic" or config.name not in TIER_NAMES:
            self._refuse_unmetered(f"generation under configuration {config.name!r}")
        model = self.model_for(config)
        if request.cancelled:
            raise ModelCancelled()
        if request.operation != "generate":
            raise ModelProviderError()
        from anthropic import Anthropic, APIError, APITimeoutError, RateLimitError
        from anthropic.types import ImageBlockParam, MessageParam, TextBlockParam, ToolUseBlock

        client = Anthropic(
            api_key=self._api_key, timeout=float(request.timeout_seconds), max_retries=1
        )
        message_param: MessageParam = {"role": "user", "content": request.prompt}
        if request.images:
            blocks: list[ImageBlockParam | TextBlockParam] = [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image.media_type,
                        "data": base64.b64encode(image.data).decode("ascii"),
                    },
                }
                for image in request.images
            ]
            blocks.append({"type": "text", "text": request.prompt})
            message_param = {"role": "user", "content": blocks}
        output_tool: dict[str, Any] = {
            "name": OUTPUT_TOOL,
            "description": "Record the result in the required format.",
            "input_schema": request.output_schema,
        }
        max_tokens = request.max_tokens or (8192 if request.images else 4096)

        def ask(searching: bool) -> tuple[Any, list[Any]]:
            """Ask, and when the model pauses a long search turn, let it continue."""
            tools: list[Any] = [output_tool]
            if searching:
                tools.append(
                    {"type": "web_search_20250305", "name": "web_search",
                     "max_uses": request.web_search}
                )  # fmt: skip
            conversation: list[Any] = [message_param]
            blocks: list[Any] = []
            for _turn in range(3):
                reply = client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    system=request.system,
                    messages=conversation,
                    tools=tools,
                    # Some models refuse a forced tool choice. The instructions ask for
                    # the tool, and the caller rejects an answer that does not use it.
                    tool_choice={"type": "auto"},
                )
                blocks.extend(reply.content)
                if reply.stop_reason != "pause_turn":
                    return reply, blocks
                conversation = [*conversation, {"role": "assistant", "content": reply.content}]
            return reply, blocks

        searched = request.web_search > 0
        try:
            try:
                message, blocks = ask(searched)
            except APIError as error:
                # The organization may not have web search enabled: answer without it.
                if not searched or isinstance(error, (APITimeoutError, RateLimitError)):
                    raise
                logger.info("web search unavailable; answering without it")
                searched = False
                message, blocks = ask(False)
        except APITimeoutError:
            raise ModelTimeout() from None
        except RateLimitError:
            raise ModelRateLimit() from None
        except APIError as error:
            raise _provider_error(error) from None
        output: dict[str, Any] | None = None
        sources: list[tuple[str, str]] = []
        for block in blocks:
            if isinstance(block, ToolUseBlock) and block.name == OUTPUT_TOOL:
                output = block.input if isinstance(block.input, dict) else None
            elif getattr(block, "type", "") == "web_search_tool_result":
                content = getattr(block, "content", None)
                if isinstance(content, list):
                    sources += [
                        (str(item.url), str(item.title)) for item in content
                        if getattr(item, "type", "") == "web_search_result"
                    ]  # fmt: skip
                else:
                    searched = False
        if getattr(message, "stop_reason", "") == "max_tokens":
            # The answer was cut off at the output limit: whatever reached the tool is
            # partial and is not an answer. The caller sees MALFORMED with no output.
            logger.info("model answer cut off at max_tokens; not used")
            output = None
        return ModelRaw(
            output, (), message.usage.input_tokens, message.usage.output_tokens,
            sources=tuple(dict.fromkeys(sources)), searched=searched,
        )  # fmt: skip

    def converse(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
    ) -> ChatReply:
        """One assistant turn. Tool calls are returned, never run here."""
        from anthropic import Anthropic, APIError, APITimeoutError, RateLimitError

        if self._metered_depth == 0:
            self._refuse_unmetered("chat turn")
        client = Anthropic(api_key=self._api_key, timeout=float(timeout_seconds), max_retries=1)
        try:
            message = client.messages.create(**self._chat_request(system, messages, tools))
        except APITimeoutError:
            raise ModelTimeout() from None
        except RateLimitError:
            raise ModelRateLimit() from None
        except APIError as error:
            raise _provider_error(error) from None
        return _chat_reply(message)

    def converse_streaming(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
        on_text: Callable[[str], None],
    ) -> ChatReply:
        """One assistant turn, its text handed to on_text as the model writes it. The reply
        is the same as converse's: tool calls are returned, never run here."""
        from anthropic import Anthropic, APIError, APITimeoutError, RateLimitError

        if self._metered_depth == 0:
            self._refuse_unmetered("streaming chat turn")
        client = Anthropic(api_key=self._api_key, timeout=float(timeout_seconds), max_retries=1)
        try:
            with client.messages.stream(**self._chat_request(system, messages, tools)) as stream:
                for delta in stream.text_stream:
                    on_text(delta)
                message = stream.get_final_message()
        except APITimeoutError:
            raise ModelTimeout() from None
        except RateLimitError:
            raise ModelRateLimit() from None
        except APIError as error:
            raise _provider_error(error) from None
        return _chat_reply(message)

    def _chat_request(
        self, system: str, messages: list[dict[str, Any]], tools: tuple[ChatTool, ...]
    ) -> dict[str, Any]:
        return {
            "model": self._model,
            "max_tokens": 4096,
            "system": system,
            "messages": [_anthropic_message(item) for item in messages],
            "tools": [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                }
                for tool in tools
            ],
            "tool_choice": {"type": "auto"},
        }


def _chat_reply(message: Any) -> ChatReply:
    """The model's message as a provider-neutral reply: its text and its tool calls."""
    from anthropic.types import TextBlock, ToolUseBlock

    text: list[str] = []
    calls: list[ToolCall] = []
    for block in message.content:
        if isinstance(block, TextBlock):
            text.append(block.text)
        elif isinstance(block, ToolUseBlock):
            arguments = block.input if isinstance(block.input, dict) else {}
            calls.append(ToolCall(id=block.id, name=block.name, arguments=arguments))
    return ChatReply(
        text="\n".join(part for part in text if part).strip(),
        tool_calls=tuple(calls),
        input_tokens=message.usage.input_tokens,
        output_tokens=message.usage.output_tokens,
    )


def _provider_error(error: Exception) -> ModelProviderError:
    """A vendor error as a neutral one. Logs the kind and status only, never the content."""
    status = getattr(error, "status_code", None)
    code = status if isinstance(status, int) else None
    # No status means the connection dropped. 408, 409, 5xx, and 529 (overloaded) pass.
    transient = code is None or code in (408, 409) or code >= 500
    logger.warning(
        "chat model call failed: %s status=%s transient=%s",
        type(error).__name__,
        code,
        transient,
    )
    return ModelProviderError(transient=transient, status=code)


def _anthropic_message(item: dict[str, Any]) -> dict[str, Any]:
    """A provider-neutral message in the Anthropic format."""
    blocks: list[dict[str, Any]] = []
    for block in item.get("content", []):
        kind = block.get("type")
        if kind == "text" and block.get("text"):
            blocks.append({"type": "text", "text": str(block["text"])})
        elif kind == "tool_call":
            blocks.append(
                {
                    "type": "tool_use",
                    "id": str(block["id"]),
                    "name": str(block["name"]),
                    "input": block.get("arguments", {}),
                }
            )
        elif kind == "tool_result":
            blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": str(block["id"]),
                    "content": str(block.get("content", "")),
                    "is_error": bool(block.get("is_error", False)),
                }
            )
    return {"role": item.get("role", "user"), "content": blocks}


def chat_provider_for(settings: Settings) -> ChatProvider | None:
    """The console's conversational provider, when a live model is configured."""
    if live_model(settings):
        return AnthropicModelProvider(
            settings.model_api_key, settings.model_name, settings.model_allow_unmetered
        )
    return None


def provider_for(settings: Settings) -> ModelProvider:
    """The configured provider. Anthropic needs both the provider name and a key."""
    if settings.model_provider in LOCAL_PROVIDERS:
        return LocalModelProvider()
    if live_model(settings):
        return AnthropicModelProvider(
            settings.model_api_key, settings.model_name, settings.model_allow_unmetered
        )
    return UnavailableModelProvider()


def live_model(settings: Settings) -> bool:
    return settings.model_provider == "anthropic" and settings.model_api_key != ""


def call_note(status: str) -> str:
    """What a person should know when a model call did not give a usable answer. It says
    what happened to the call and nothing about what stood in for it: a caller that falls
    back to the rules says so itself (fallback_note), so a model failure never reads as
    the model's work."""
    notes = {
        "TIMEOUT": "The model did not answer in time.",
        "RATE_LIMITED": "The model was rate limited.",
        "MODEL_ERROR": "The model could not be used. Check the model configuration and key.",
        "MALFORMED": "The model's answer was not in the required format.",
        "CANCELLED": "The model call was cancelled.",
        "BUDGET_EXCEEDED": "The model budget is exhausted, so the call was not made.",
    }
    return notes.get(status, f"The model call ended {status.lower()}.")


def fallback_note(status: str, stood_in: str = "the reviewed rules produced this instead") -> str:
    """A model failure that the rules stood in for: the failure first, the fallback named."""
    return f"{call_note(status)} The model did not produce this; {stood_in}."
