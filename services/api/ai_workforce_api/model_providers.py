"""Model providers that call a vendor. The model adapter itself stays vendor-neutral.

Only this module names a vendor SDK, so the adapter and the agents never import one.
"""

import base64
import logging
from collections.abc import Callable
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
    ModelTimeout,
    ToolCall,
    UnavailableModelProvider,
)
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

LOCAL_PROVIDERS = frozenset({"", "mock", "local"})
# The default Claude model when MODEL_NAME is empty. Cost per token is not configured yet.
DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5"
CLAUDE_CONFIG = ModelConfig("claude", "anthropic", DEFAULT_CLAUDE_MODEL, 0, 0)


class AnthropicModelProvider:
    """Claude through the Anthropic API. The key is held in memory and never logged.

    A structured generation is answered through one tool whose input schema is the
    requested output schema. An answer outside the tool is no answer, and the caller
    still checks the result against the schema.
    """

    def __init__(self, api_key: str, model_name: str) -> None:
        self._api_key = api_key
        self._model = model_name or DEFAULT_CLAUDE_MODEL

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
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
                    model=self._model,
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
        return AnthropicModelProvider(settings.model_api_key, settings.model_name)
    return None


def provider_for(settings: Settings) -> ModelProvider:
    """The configured provider. Anthropic needs both the provider name and a key."""
    if settings.model_provider in LOCAL_PROVIDERS:
        return LocalModelProvider()
    if live_model(settings):
        return AnthropicModelProvider(settings.model_api_key, settings.model_name)
    return UnavailableModelProvider()


def live_model(settings: Settings) -> bool:
    return settings.model_provider == "anthropic" and settings.model_api_key != ""


def call_note(status: str) -> str:
    """What a person should know when a model call did not give a usable answer."""
    notes = {
        "TIMEOUT": "The model did not answer in time, so the rules were used.",
        "RATE_LIMITED": "The model was rate limited, so the rules were used.",
        "MODEL_ERROR": (
            "The model could not be used, so the rules were used. Check MODEL_NAME and "
            "MODEL_API_KEY."
        ),
        "MALFORMED": "The model's answer was not in the required format, so the rules were used.",
    }
    return notes.get(status, f"The model call ended {status.lower()}, so the rules were used.")
