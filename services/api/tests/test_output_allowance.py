"""Every model call has room for its answer, and a cut-off answer is never an answer
(21 November 2026, D-N0-1).

The provider's current models think before they answer, and the thinking is spent from the
call's output allowance. A call that named no allowance got 4,096 tokens (8,192 with
images): in the N0 baseline that cut off 12 of 16 design drafts, each replaced by a
stand-in, and 21 calls named none. A call that names none now gets
models.DEFAULT_OUTPUT_TOKENS, the budget reserves what the provider is sent, and a chat
reply cut off at the limit is refused instead of shown as a whole answer."""

from contextlib import AbstractContextManager
from typing import Any

import pytest

from ai_workforce_api.model_providers import AnthropicModelProvider, tier_config
from ai_workforce_api.models import (
    DEFAULT_OUTPUT_TOKENS,
    ModelCutOff,
    ModelImage,
    ModelRequest,
    complete,
    cost_micros,
    estimate_tokens,
)
from ai_workforce_api.provenance import estimate_micros
from ai_workforce_api.settings import Settings

SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
}
LIVE = Settings(model_provider="anthropic", model_api_key="not-a-real-key")
HELLO = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]


def _request(max_tokens: int = 0, images: tuple[ModelImage, ...] = ()) -> ModelRequest:
    return ModelRequest(
        operation="generate", prompt="Answer.", output_schema=SCHEMA, allowed_tool_ids=(),
        timeout_seconds=30, cancelled=False, system="Be exact.", images=images,
        max_tokens=max_tokens,
    )  # fmt: skip


def _message(kwargs: dict[str, Any], stop_reason: str, content: list[Any]) -> Any:
    from anthropic.types import Message, Usage

    return Message(
        id="m1", type="message", role="assistant", model=kwargs["model"], content=content,
        stop_reason=stop_reason, stop_sequence=None,  # type: ignore[arg-type]
        usage=Usage(input_tokens=10, output_tokens=5),
    )  # fmt: skip


class _Client:
    """The vendor client, answering with `stop_reason` and keeping what each call asked."""

    asked: list[dict[str, Any]] = []
    stop_reason = "end_turn"

    def __init__(self, **_kwargs: Any) -> None:
        self.messages = self

    def create(self, **kwargs: Any) -> Any:
        from anthropic.types import TextBlock, ToolUseBlock

        _Client.asked.append(kwargs)
        tools = [tool.get("name") for tool in kwargs.get("tools", [])]
        content: list[Any] = (
            [ToolUseBlock(id="t1", type="tool_use", name="record_output", input={"answer": "ok"})]
            if "record_output" in tools
            else [TextBlock(type="text", text="Half an ans")]
        )
        return _message(kwargs, _Client.stop_reason, content)

    def stream(self, **kwargs: Any) -> AbstractContextManager[Any]:
        client = self

        class _Stream:
            text_stream = iter(["Half ", "an ans"])

            def __enter__(self) -> _Stream:
                return self

            def __exit__(self, *_exc: object) -> None:
                return None

            def get_final_message(self) -> Any:
                return client.create(**kwargs)

        return _Stream()


@pytest.fixture
def vendor(monkeypatch: pytest.MonkeyPatch) -> type[_Client]:
    import anthropic

    _Client.asked = []
    _Client.stop_reason = "end_turn"
    monkeypatch.setattr(anthropic, "Anthropic", _Client)
    return _Client


def test_a_call_that_names_no_allowance_gets_the_shared_one(vendor: type[_Client]) -> None:
    provider = AnthropicModelProvider("k", "")
    config = tier_config(LIVE, "BALANCED")
    image = ModelImage("image/png", b"\x89PNG not a real image")
    for request in (_request(), _request(images=(image,))):
        status, raw = complete(provider, request, config)
        assert (status, raw.output) == ("SUCCEEDED", {"answer": "ok"})
    # A call that names its own allowance keeps it, shorter or longer.
    complete(provider, _request(max_tokens=600), config)
    complete(provider, _request(max_tokens=32_000), config)
    # A chat turn has the same room.
    with provider.metered():
        provider.converse("Be brief.", HELLO, (), 30)
    assert [call["max_tokens"] for call in vendor.asked] == [
        DEFAULT_OUTPUT_TOKENS, DEFAULT_OUTPUT_TOKENS, 600, 32_000, DEFAULT_OUTPUT_TOKENS,
    ]  # fmt: skip
    # Large enough for the design drafts that were cut off (up to 6,329 output tokens).
    assert DEFAULT_OUTPUT_TOKENS >= 16_000


def test_the_budget_reserves_the_allowance_the_provider_is_sent() -> None:
    """The reservation before a call is its worst case: the allowance actually sent."""
    config = tier_config(LIVE, "BALANCED")
    request = _request()
    inputs = estimate_tokens(request.prompt) + estimate_tokens(request.system)
    assert estimate_micros(config, request) == cost_micros(config, inputs, DEFAULT_OUTPUT_TOKENS)
    longer = _request(max_tokens=32_000)
    assert estimate_micros(config, longer) == cost_micros(config, inputs, 32_000)


@pytest.mark.parametrize("streaming", [False, True])
def test_a_chat_reply_cut_off_at_the_limit_is_refused(
    vendor: type[_Client], streaming: bool
) -> None:
    """Before, the partial text of a cut-off chat reply was returned as the whole answer."""
    provider = AnthropicModelProvider("k", "")
    vendor.stop_reason = "max_tokens"
    shown: list[str] = []
    with provider.metered(), pytest.raises(ModelCutOff) as refused:
        if streaming:
            provider.converse_streaming("Be brief.", HELLO, (), 30, shown.append)
        else:
            provider.converse("Be brief.", HELLO, (), 30)
    # What the provider reported it used, so the call is counted at its cost.
    assert (refused.value.input_tokens, refused.value.output_tokens) == (10, 5)
    # A cut-off is a provider failure that is not worth the same call again.
    assert not ModelCutOff().transient


def test_a_cut_off_generation_is_told_as_incomplete() -> None:
    """The person's note for a malformed answer covers the cut-off, which shares the status;
    the call's record names which it was (models.outcome)."""
    from ai_workforce_api.model_providers import call_note

    assert call_note("MALFORMED") == (
        "The model's answer was incomplete or not in the required format."
    )
