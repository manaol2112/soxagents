"""Model providers that call a vendor. The model adapter itself stays vendor-neutral.

Only this module names a vendor SDK, so the adapter and the agents never import one.
"""

import base64
from typing import Any, cast

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
        try:
            message = client.messages.create(
                model=self._model,
                max_tokens=8192 if request.images else 4096,
                system=request.system,
                messages=[message_param],
                tools=[
                    {
                        "name": OUTPUT_TOOL,
                        "description": "Record the result in the required format.",
                        "input_schema": request.output_schema,
                    }
                ],
                # Some models refuse a forced tool choice. The instructions ask for the
                # tool, and the caller rejects any answer that does not come through it.
                tool_choice={"type": "auto"},
            )
        except APITimeoutError:
            raise ModelTimeout() from None
        except RateLimitError:
            raise ModelRateLimit() from None
        except APIError:
            raise ModelProviderError() from None
        output: dict[str, Any] | None = None
        for block in message.content:
            if isinstance(block, ToolUseBlock) and block.name == OUTPUT_TOOL:
                output = block.input if isinstance(block.input, dict) else None
        return ModelRaw(output, (), message.usage.input_tokens, message.usage.output_tokens)

    def converse(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
    ) -> ChatReply:
        """One assistant turn. Tool calls are returned, never run here."""
        from anthropic import Anthropic, APIError, APITimeoutError, RateLimitError
        from anthropic.types import MessageParam, TextBlock, ToolParam, ToolUseBlock

        client = Anthropic(api_key=self._api_key, timeout=float(timeout_seconds), max_retries=1)
        try:
            message = client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=system,
                messages=cast(
                    "list[MessageParam]", [_anthropic_message(item) for item in messages]
                ),
                tools=cast(
                    "list[ToolParam]",
                    [
                        {
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": tool.input_schema,
                        }
                        for tool in tools
                    ],
                ),
                tool_choice={"type": "auto"},
            )
        except APITimeoutError:
            raise ModelTimeout() from None
        except RateLimitError:
            raise ModelRateLimit() from None
        except APIError:
            raise ModelProviderError() from None
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
