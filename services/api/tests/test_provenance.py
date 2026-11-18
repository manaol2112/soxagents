"""Milestone 3a: how an agent job calls the model and what it leaves behind
(provenance.py). Tiers pin priced models; budgets refuse a call before dispatch; a
transient failure is retried and recorded each time; every call carries its provenance
without a secret; the prompt and answer are kept encrypted and read only by the firm's
owner or admin or the engagement's reviewer, with a stated purpose, and the read is
audited; a cancellation is honoured before the call."""

import base64
import hashlib
import json
import pathlib
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from support import Database
from test_models import _add_project_member, _add_user, _client, _seed_org, _seed_project
from test_outbound import migrated

from ai_workforce_api import provenance
from ai_workforce_api.db import connect
from ai_workforce_api.model_providers import (
    CLAUDE_CONFIG,
    AnthropicModelProvider,
    agent_tier,
    check_model_configuration,
    tier_config,
)
from ai_workforce_api.models import (
    ModelConfig,
    ModelProviderError,
    ModelRateLimit,
    ModelRaw,
    ModelRequest,
    ModelTimeout,
    cost_micros,
)
from ai_workforce_api.provenance import (
    AgentCaller,
    Job,
    Limits,
    agent_actor,
    purge_expired_contents,
    sha256_text,
)
from ai_workforce_api.settings import Settings
from ai_workforce_api.workforce import sync_standard_workforce

__all__ = ["migrated"]

SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer"],
    "properties": {"answer": {"type": "string"}},
}
KEY = base64.b64encode(hashlib.sha256(b"test provenance key").digest()).decode()
SONNET = ModelConfig("balanced", "anthropic", "claude-sonnet-5-5", 2_000, 10_000)


class _Scripted:
    """Answers, or raises, in the order given; records every request."""

    def __init__(self, steps: list[Any]) -> None:
        self.steps = steps
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        step = self.steps[min(len(self.requests), len(self.steps)) - 1]
        if isinstance(step, Exception):
            raise step
        return ModelRaw(step, (), 800, 200)


def _request(prompt: str = "Say ok.", system: str = "Be brief.") -> ModelRequest:
    return ModelRequest(
        operation="generate",
        prompt=prompt,
        output_schema=SCHEMA,
        allowed_tool_ids=(),
        timeout_seconds=30,
        cancelled=False,
        system=system,
    )


def test_tiers_pin_priced_models_and_refuse_an_unpriced_live_one() -> None:
    live = Settings(model_provider="anthropic", model_api_key="not-a-real-key")
    fast, balanced, deep = (tier_config(live, t) for t in ("FAST", "BALANCED", "DEEP"))
    assert (fast.model_name, fast.input_nanos_per_token, fast.output_nanos_per_token) == (
        "claude-haiku-5-5", 100, 500,
    )  # fmt: skip
    assert (balanced.model_name, balanced.input_nanos_per_token) == ("claude-sonnet-5-5", 2_000)
    assert (deep.model_name, deep.output_nanos_per_token) == ("claude-opus-5-5", 20_000)
    # $2 per million in and $10 per million out: 1,000 in and 500 out cost $0.007.
    assert cost_micros(balanced, 1_000, 500) == 7_000
    assert cost_micros(balanced, 1, 0) == 2  # rounded up, never under-counted
    # MODEL_NAME keeps naming the BALANCED tier's model; a tier can be overridden.
    alias = Settings(model_provider="anthropic", model_api_key="k", model_name="claude-opus-5-5")
    assert tier_config(alias, "BALANCED").model_name == "claude-opus-5-5"
    # A live model without a price is refused, unless MODEL_PRICES names one.
    unknown = Settings(model_provider="anthropic", model_api_key="k", model_deep="claude-x-9")
    with pytest.raises(ValueError, match="no price"):
        tier_config(unknown, "DEEP")
    assert check_model_configuration(unknown) == [
        "no price is configured for the DEEP model claude-x-9"
    ]
    priced = Settings(
        model_provider="anthropic", model_api_key="k", model_deep="claude-x-9",
        model_prices='{"claude-x-9": [1.5, 6]}',
    )  # fmt: skip
    assert (
        tier_config(priced, "DEEP").input_nanos_per_token,
        tier_config(priced, "DEEP").output_nanos_per_token,
    ) == (1_500, 6_000)  # noqa: E501
    # Without a live provider a known model keeps its price, an unknown one is not refused,
    # and the configuration check has nothing to say.
    assert tier_config(Settings(model_provider=""), "DEEP").model_name == "claude-opus-5-5"
    unpriced_local = Settings(model_provider="", model_deep="claude-x-9")
    assert tier_config(unpriced_local, "DEEP").input_nanos_per_token == 0
    assert check_model_configuration(Settings(model_provider="")) == []
    # The owner's development defaults: reading, matching and classifying are FAST;
    # testing, drafting and the routine reviewer analysis BALANCED; DEEP only for the
    # agents MODEL_DEEP_AGENTS names.
    assert agent_tier("evidence-reader") == "FAST"
    assert agent_tier("itgc-access-tester") == "BALANCED"
    assert agent_tier("independent-reviewer") == "BALANCED"
    assert agent_tier("engagement-planner") == "BALANCED"
    assert agent_tier("console-lead") == "BALANCED"
    assert agent_tier("something-else") == "BALANCED"
    authorized = Settings(
        model_provider="", model_deep_agents="independent-reviewer, engagement-planner"
    )
    assert agent_tier("independent-reviewer", authorized) == "DEEP"
    assert agent_tier("engagement-planner", authorized) == "DEEP"
    assert agent_tier("itgc-access-tester", authorized) == "BALANCED"
    # The provider sends a tier's pinned model, and MODEL_NAME for the untiered config.
    provider = AnthropicModelProvider("k", "claude-opus-5-5")
    assert provider.model_for(tier_config(live, "FAST")) == "claude-haiku-5-5"
    assert provider.model_for(CLAUDE_CONFIG) == "claude-opus-5-5"


def test_a_call_is_recorded_with_its_provenance_and_its_contents_encrypted(
    migrated: Database,
) -> None:
    seeded, project_id, _owner = _ready(migrated, "prov", KEY)
    org = seeded["organization_id"]
    owner_id = seeded["user_id"]
    settings = Settings(database_url=migrated.url, provenance_key=KEY)
    provider = _Scripted([{"answer": "ok"}])
    prompt = "Test u0001 against the approval. api_key: sk-notreal-123 appears in the file."
    with connect(migrated.url) as connection:
        # The deploy step staffs every open engagement with the standard workers.
        sync_standard_workforce(connection)
        instance = agent_actor(connection, project_id, "itgc-access-tester")
        assert instance is not None, "the engagement is staffed with the standard workers"
        job = Job("itgc-access-tester", "test_sheet", uuid4(), org, project_id, owner_id,
                  agent_instance_id=instance)  # fmt: skip
        caller = AgentCaller(connection, provider, job, settings=settings)
        call = caller.generate(_request(prompt), "control-tester/1")
        assert (call.status, call.attempts, call.raw.output) == ("SUCCEEDED", 1, {"answer": "ok"})
        row = connection.execute(
            """
            SELECT model_name, tier, agent_key, prompt_version, prompt_sha256, output_sha256,
                   target_type, target_id, job_id, attempt, duration_ms, error,
                   actor_agent_instance_id, model_config_ref, status
            FROM model_calls WHERE id = %s
            """,
            (call.call_id,),
        ).fetchone()
        assert row is not None
        assert row[:4] == ("local", "BALANCED", "itgc-access-tester", "control-tester/1")
        assert row[4] == sha256_text("Be brief.\n" + prompt)
        assert row[5] == sha256_text(json.dumps({"answer": "ok"}, sort_keys=True))
        assert (row[6], row[7], row[8], row[9]) == ("test_sheet", job.target_id, job.job_id, 1)
        assert isinstance(row[10], int) and row[10] >= 0
        assert (row[11], row[12], row[13], row[14]) == ("", instance, "balanced", "SUCCEEDED")
        # Neither the prompt nor the secret in it is anywhere but the sealed content.
        plain = str(connection.execute("SELECT * FROM model_calls").fetchall())
        plain += str(connection.execute("SELECT payload::text FROM audit_events").fetchall())
        assert "sk-notreal" not in plain and "u0001" not in plain and KEY not in plain
        sealed = connection.execute(
            "SELECT ciphertext, prompt_chars, image_count, key_id FROM model_call_contents "
            "WHERE model_call_id = %s",
            (call.call_id,),
        ).fetchone()
        assert sealed is not None
        assert b"sk-notreal" not in bytes(sealed[0]) and b"u0001" not in bytes(sealed[0])
        assert (sealed[1], sealed[2]) == (len(prompt), 0)
        audit = connection.execute(
            "SELECT actor_user_id, actor_agent_instance_id, payload FROM audit_events "
            "WHERE action = 'model.called' AND target_id = %s",
            (call.call_id,),
        ).fetchone()
        assert audit is not None
        assert (audit[0], audit[1]) == (owner_id, instance)
        assert audit[2]["agent"] == "itgc-access-tester" and audit[2]["tier"] == "BALANCED"
    # Only the firm's owner or admin, or the engagement's reviewer, reads the content,
    # with a purpose, and the read is audited. Another tenant sees nothing.
    base = f"/organizations/{org}/projects/{project_id}/model-calls/{call.call_id}/content"
    owner = _client(migrated, owner_id, settings=_app_settings(migrated, KEY))
    assert owner.get(base).status_code == 422
    assert owner.get(base, params={"purpose": "short"}).status_code == 422
    read = owner.get(base, params={"purpose": "Reviewing the tester's basis for item u0001"})
    assert read.status_code == 200, read.text
    assert read.json()["prompt"] == prompt
    assert read.json()["system"] == "Be brief."
    assert read.json()["output"] == {"answer": "ok"}
    with connect(migrated.url) as connection:
        contributor = _add_user(connection, org, "member@example.com", "CONTRIBUTOR")
        _add_project_member(connection, org, project_id, contributor)
        reviewer = _add_user(connection, org, "reviewer@example.com", "CONTRIBUTOR")
        _add_project_member(connection, org, project_id, reviewer)
        connection.execute(
            "UPDATE project_memberships SET engagement_role = 'REVIEWER' "
            "WHERE project_id = %s AND user_id = %s",
            (project_id, reviewer),
        )
        connection.commit()
    member = _client(migrated, contributor, settings=_app_settings(migrated, KEY))
    assert member.get(base, params={"purpose": "Just curious about it"}).status_code == 403
    engagement_reviewer = _client(migrated, reviewer, settings=_app_settings(migrated, KEY))
    assert (
        engagement_reviewer.get(
            base, params={"purpose": "Independent review of the test"}
        ).status_code
        == 200
    )  # noqa: E501
    with connect(migrated.url) as connection:
        other = _seed_org(connection, "prov-other", "other@example.com")
        other_project = _seed_project(connection, other["organization_id"], other["user_id"])
    stranger = _client(migrated, other["user_id"], settings=_app_settings(migrated, KEY))
    hidden = stranger.get(
        f"/organizations/{other['organization_id']}/projects/{other_project}/model-calls/"
        f"{call.call_id}/content",
        params={"purpose": "Looking at another firm's work"},
    )
    assert hidden.status_code == 404
    with connect(migrated.url) as connection:
        reads = connection.execute(
            "SELECT actor_user_id, payload ->> 'purpose' FROM audit_events "
            "WHERE action = 'model_call.content_read' ORDER BY occurred_at"
        ).fetchall()
    assert [(r[0], r[1]) for r in reads] == [
        (owner_id, "Reviewing the tester's basis for item u0001"),
        (reviewer, "Independent review of the test"),
    ]
    # Without the key that sealed it, the content is not served; the record stays.
    keyless = _client(migrated, owner_id, settings=_app_settings(migrated, ""))
    assert keyless.get(base, params={"purpose": "Reading without the key"}).status_code == 409


def test_contents_are_kept_only_with_a_key_and_removed_once_expired(migrated: Database) -> None:
    seeded, project_id, _owner = _ready(migrated, "retain", "")
    org, owner_id = seeded["organization_id"], seeded["user_id"]
    with connect(migrated.url) as connection:
        job = Job("evidence-reader", "evidence_file", uuid4(), org, project_id, owner_id)
        # No key: hashes only.
        plain = AgentCaller(
            connection, _Scripted([{"answer": "a"}]), job,
            settings=Settings(database_url=migrated.url),
        )  # fmt: skip
        first = plain.generate(_request(), "evidence-reader/1")
        count = connection.execute("SELECT count(*) FROM model_call_contents").fetchone()
        assert count == (0,)
        hashed = connection.execute(
            "SELECT prompt_sha256 FROM model_calls WHERE id = %s", (first.call_id,)
        ).fetchone()
        assert hashed is not None and len(str(hashed[0])) == 64
        # With a key: kept until the configured retention; the trigger refuses an early
        # removal and any change, and the deploy step removes what has expired.
        sealed = AgentCaller(
            connection, _Scripted([{"answer": "b"}]), job,
            settings=Settings(database_url=migrated.url, provenance_key=KEY,
                              model_content_retention_days=30),
        )  # fmt: skip
        second = sealed.generate(_request(), "evidence-reader/1")
        connection.commit()
        row = connection.execute(
            "SELECT expires_at - created_at FROM model_call_contents WHERE model_call_id = %s",
            (second.call_id,),
        ).fetchone()
        assert row is not None and row[0].days == 30
        with pytest.raises(Exception, match="immutable"):
            connection.execute(
                "UPDATE model_call_contents SET prompt_chars = 1 WHERE model_call_id = %s",
                (second.call_id,),
            )
        connection.rollback()
        with pytest.raises(Exception, match="only once expired"):
            connection.execute(
                "DELETE FROM model_call_contents WHERE model_call_id = %s", (second.call_id,)
            )
        connection.rollback()
        # An expired record (written as if a month ago with a short retention).
        connection.execute(
            """
            INSERT INTO model_call_contents (
                organization_id, project_id, model_call_id, key_id, nonce, ciphertext,
                prompt_chars, output_chars, created_at, expires_at
            )
            VALUES (%s, %s, %s, 'old', %s, %s, 1, 0,
                    clock_timestamp() - interval '40 days', clock_timestamp() - interval '10 days')
            """,
            (org, project_id, first.call_id, b"0" * 12, b"x"),
        )
        connection.commit()
        assert purge_expired_contents(connection) == 1
        left = connection.execute("SELECT model_call_id FROM model_call_contents").fetchall()
        assert [r[0] for r in left] == [second.call_id]
        # The call record and its hash outlive the content.
        assert connection.execute(
            "SELECT count(*) FROM model_calls WHERE id IN (%s, %s)", (first.call_id, second.call_id)
        ).fetchone() == (2,)


def test_budgets_refuse_a_call_before_dispatch_and_record_the_refusal(
    migrated: Database,
) -> None:
    seeded, project_id, _owner = _ready(migrated, "budget", "")
    org, owner_id = seeded["organization_id"], seeded["user_id"]
    long_prompt = "x" * 40_000  # about 13,300 tokens: $0.027 in, plus $0.041 of output allowance
    with connect(migrated.url) as connection:
        job = Job("itgc-change-tester", "test_sheet", uuid4(), org, project_id, owner_id)
        # The limit a call.
        provider = _Scripted([{"answer": "ok"}])
        caller = AgentCaller(connection, provider, job, config=SONNET, limits=Limits(50_000, 0, 0))
        refused = caller.generate(_request(long_prompt), "control-tester/1")
        assert refused.status == "BUDGET_EXCEEDED"
        assert provider.requests == []
        assert "limit a call" in _error(connection, refused.call_id)
        assert "budget is exhausted" in refused.note
        # The limit a job: the first call fits, the second would pass the limit.
        provider = _Scripted([{"answer": "ok"}, {"answer": "ok"}])
        caller = AgentCaller(connection, provider, job, config=SONNET, limits=Limits(0, 70_000, 0))
        first = caller.generate(_request(long_prompt), "control-tester/1")
        assert first.status == "SUCCEEDED" and caller.spent == 3_600
        second = caller.generate(_request(long_prompt), "control-tester/1")
        assert second.status == "BUDGET_EXCEEDED" and len(provider.requests) == 1
        assert "limit a job" in _error(connection, second.call_id)
        # The limit an engagement a month: what this month's calls already cost counts.
        connection.execute(
            """
            INSERT INTO model_calls (organization_id, project_id, actor_user_id,
                                     model_config_ref, operation, status, input_tokens,
                                     output_tokens, cost_micros, model_name)
            VALUES (%s, %s, %s, 'balanced', 'generate', 'SUCCEEDED', 1, 1, 49_950_000,
                    'claude-sonnet-5-5')
            """,
            (org, project_id, owner_id),
        )
        connection.commit()
        provider = _Scripted([{"answer": "ok"}])
        caller = AgentCaller(
            connection, provider, job, config=SONNET, limits=Limits(0, 0, 50_000_000)
        )
        monthly = caller.generate(_request(long_prompt), "control-tester/1")
        assert monthly.status == "BUDGET_EXCEEDED" and provider.requests == []
        assert "this month" in _error(connection, monthly.call_id)
        # Another engagement's spend is not this one's; no limit means no refusal.
        other_project = _seed_project(connection, org, owner_id)
        elsewhere = Job("itgc-change-tester", "test_sheet", uuid4(), org, other_project, owner_id)
        caller = AgentCaller(
            connection, _Scripted([{"answer": "ok"}]), elsewhere, config=SONNET,
            limits=Limits(0, 0, 50_000_000),
        )  # fmt: skip
        assert caller.generate(_request(long_prompt), "control-tester/1").status == "SUCCEEDED"
        free = AgentCaller(connection, _Scripted([{"answer": "ok"}]), job, config=SONNET)
        assert free.generate(_request(long_prompt), "control-tester/1").status == "SUCCEEDED"
        # The provisional development defaults: $1 a call, $10 a job, $50 a month.
        defaults = Limits.of(Settings(model_provider=""))
        assert (defaults.call, defaults.job, defaults.engagement_month) == (
            1_000_000, 10_000_000, 50_000_000,
        )  # fmt: skip


def test_transient_failures_are_retried_and_each_attempt_recorded(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeded, project_id, _owner = _ready(migrated, "retry", "")
    org, owner_id = seeded["organization_id"], seeded["user_id"]
    waits: list[float] = []
    monkeypatch.setattr(provenance, "pause", waits.append)
    with connect(migrated.url) as connection:
        job = Job("independent-reviewer", "control_review", uuid4(), org, project_id, owner_id)
        # Timeout, then rate limit, then an answer: three records, two pauses.
        provider = _Scripted([ModelTimeout(), ModelRateLimit(), {"answer": "ok"}])
        call = AgentCaller(connection, provider, job).generate(_request(), "independent-reviewer/1")
        assert (call.status, call.attempts) == ("SUCCEEDED", 3)
        assert waits == [2.0, 6.0]
        rows = connection.execute(
            "SELECT status, attempt, error, tier FROM model_calls WHERE job_id = %s "
            "ORDER BY created_at",
            (job.job_id,),
        ).fetchall()
        assert [tuple(r) for r in rows] == [
            ("TIMEOUT", 1, "the provider did not answer in time", "BALANCED"),
            ("RATE_LIMITED", 2, "the provider rate limited the call", "BALANCED"),
            ("SUCCEEDED", 3, "", "BALANCED"),
        ]
        # A request the provider rejected is not sent again.
        waits.clear()
        rejected = _Scripted([ModelProviderError(transient=False, status=400)])
        other = Job("independent-reviewer", "control_review", uuid4(), org, project_id, owner_id)
        call = AgentCaller(connection, rejected, other).generate(
            _request(), "independent-reviewer/1"
        )
        assert (call.status, call.attempts, waits) == ("MODEL_ERROR", 1, [])
        assert _error(connection, call.call_id) == "provider error (status 400)"
        assert call.note == "The model could not be used. Check the model configuration and key."
        # A malformed answer is not asked for again: a stricter check may still read it.
        malformed = _Scripted([{"wrong": 1}, {"wrong": 2}])
        third = Job("independent-reviewer", "control_review", uuid4(), org, project_id, owner_id)
        call = AgentCaller(connection, malformed, third).generate(
            _request(), "independent-reviewer/1"
        )
        assert (call.status, call.attempts, waits) == ("MALFORMED", 1, [])
        assert call.readable and call.raw.output == {"wrong": 1}
        # Transient failures past the attempts stop with the last status.
        waits.clear()
        down = _Scripted([ModelTimeout(), ModelTimeout(), ModelTimeout()])
        fourth = Job("independent-reviewer", "control_review", uuid4(), org, project_id, owner_id)
        call = AgentCaller(connection, down, fourth).generate(_request(), "independent-reviewer/1")
        assert (call.status, call.attempts, waits) == ("TIMEOUT", 3, [2.0, 6.0])
        # A provider that raises something else is a failed call, not a crashed job.
        buggy = _Scripted([KeyError("oops")])
        fifth = Job("independent-reviewer", "control_review", uuid4(), org, project_id, owner_id)
        call = AgentCaller(connection, buggy, fifth, retry=False).generate(_request(), "x/1")
        assert call.status == "MODEL_ERROR"
        assert _error(connection, call.call_id) == "provider raised KeyError"


def test_a_cancellation_is_honoured_before_the_call(migrated: Database) -> None:
    seeded, project_id, _owner = _ready(migrated, "cancel", "")
    org, owner_id = seeded["organization_id"], seeded["user_id"]
    with connect(migrated.url) as connection:
        job = Job("itgc-access-tester", "test_sheet", uuid4(), org, project_id, owner_id)
        provider = _Scripted([{"answer": "ok"}])
        caller = AgentCaller(connection, provider, job, cancelled=lambda: True)
        call = caller.generate(_request(), "control-tester/1")
        assert (call.status, provider.requests) == ("CANCELLED", [])
        assert _error(connection, call.call_id) == "cancelled before the call"
        assert call.note == "The model call was cancelled."


def _ready(database: Database, slug: str, key: str) -> tuple[dict[str, Any], UUID, Any]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug, f"{slug}-owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    return (
        seeded,
        project_id,
        _client(database, seeded["user_id"], settings=_app_settings(database, key)),
    )


def _app_settings(database: Database, key: str) -> Settings:
    return Settings(
        database_url=database.url, session_cookie_secure=False, model_provider="",
        provenance_key=key,
    )  # fmt: skip


def _error(connection: Any, call_id: UUID | None) -> str:
    row = connection.execute("SELECT error FROM model_calls WHERE id = %s", (call_id,)).fetchone()
    assert row is not None
    return str(row[0])


def test_a_live_provider_refuses_a_call_outside_the_agent_caller(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Containment: the live provider answers a tier's generation through the caller and a
    chat turn marked metered by it; a bare call under the untiered configuration, or a
    bare chat turn, is refused before any network call unless MODEL_ALLOW_UNMETERED is
    set for development."""
    import anthropic
    from anthropic.types import Message, TextBlock, ToolUseBlock, Usage

    from ai_workforce_api.model_providers import provider_for
    from ai_workforce_api.models import ModelProviderError, complete

    seen: list[str] = []

    class FakeMessages:
        def create(self, **kwargs: Any) -> Any:
            seen.append(str(kwargs["model"]))
            if "tools" in kwargs and any(t.get("name") == "record_output" for t in kwargs["tools"]):
                content: list[Any] = [
                    ToolUseBlock(
                        id="t1", type="tool_use", name="record_output", input={"answer": "ok"}
                    )  # fmt: skip
                ]
            else:
                content = [TextBlock(type="text", text="hello")]
            return Message(
                id="m1", type="message", role="assistant", model=kwargs["model"],
                content=content, stop_reason="end_turn", stop_sequence=None,
                usage=Usage(input_tokens=10, output_tokens=5),
            )  # fmt: skip

    class FakeClient:
        def __init__(self, **kwargs: Any) -> None:
            self.messages = FakeMessages()

    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)
    live = Settings(model_provider="anthropic", model_api_key="not-a-real-key")
    provider = cast(AnthropicModelProvider, provider_for(live))
    # The old path: refused, nothing sent.
    assert complete(provider, _request(), CLAUDE_CONFIG)[0] == "MODEL_ERROR"
    hello = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
    with pytest.raises(ModelProviderError):
        provider.converse("be brief", hello, (), 30)
    assert seen == []
    # The caller: a tier's model, priced and recorded.
    seeded, project_id, _owner = _ready(migrated, "contain", "")
    with connect(migrated.url) as connection:
        job = Job("evidence-reader", "evidence_file", uuid4(), seeded["organization_id"],
                  project_id, seeded["user_id"])  # fmt: skip
        call = AgentCaller(connection, provider, job, settings=live).generate(_request(), "x/1")
        assert call.status == "SUCCEEDED" and seen == ["claude-haiku-5-5"]
        row = connection.execute(
            "SELECT model_name, cost_micros FROM model_calls WHERE id = %s", (call.call_id,)
        ).fetchone()
        assert row is not None and row[0] == "claude-haiku-5-5" and row[1] > 0
        # A chat turn through the caller is metered and recorded with its provenance.
        chat = Job("console-lead", "console_message", uuid4(), seeded["organization_id"],
                   project_id, seeded["user_id"])  # fmt: skip
        reply = AgentCaller(connection, provider, chat, settings=live).chat(
            provider,
            "be brief",
            hello,
            (),
            30,
        )
        assert reply.text == "hello" and seen[-1] == "claude-sonnet-5-5"
        turn = connection.execute(
            "SELECT agent_key, tier, operation, prompt_version, status, output_sha256 "
            "FROM model_calls WHERE job_id = %s",
            (chat.job_id,),
        ).fetchone()
        assert turn is not None
        assert tuple(turn[:5]) == (
            "console-lead",
            "BALANCED",
            "propose_tools",
            "console/1",
            "SUCCEEDED",
        )  # noqa: E501
        assert len(str(turn[5])) == 64
    # Development only: the switch lets the old path through (nothing else changes).
    permitted = provider_for(
        Settings(model_provider="anthropic", model_api_key="k", model_allow_unmetered=True)
    )
    assert complete(permitted, _request(), CLAUDE_CONFIG)[0] == "SUCCEEDED"


def test_no_module_calls_the_model_outside_the_caller() -> None:
    """Static containment: `record_call` is written only by the adapter and the caller, and
    a provider's chat methods are invoked only by the caller."""
    import re

    package = pathlib.Path(provenance.__file__).parent
    recorders = sorted(
        path.name
        for path in package.glob("*.py")
        if re.search(r"(?<![\w.])record_call\(", path.read_text(encoding="utf-8"))
        and path.name not in ("models.py", "provenance.py")
    )
    assert recorders == [], recorders
    chatters = sorted(
        path.name
        for path in package.glob("*.py")
        if re.search(r"\.converse(_streaming)?\(", path.read_text(encoding="utf-8"))
        and path.name not in ("provenance.py", "model_providers.py", "models.py")
    )
    assert chatters == [], chatters


def test_content_stays_readable_across_a_key_rotation(migrated: Database) -> None:
    """Key rotation: content sealed under an earlier key is read while that key is kept
    in PROVENANCE_PREVIOUS_KEYS; the record says which key sealed it; without the key the
    read is refused and the call record and hashes stay."""
    old_key = base64.b64encode(hashlib.sha256(b"old key").digest()).decode()
    new_key = base64.b64encode(hashlib.sha256(b"new key").digest()).decode()
    seeded, project_id, _owner = _ready(migrated, "rotate", old_key)
    org, owner_id = seeded["organization_id"], seeded["user_id"]
    with connect(migrated.url) as connection:
        job = Job("evidence-reader", "evidence_file", uuid4(), org, project_id, owner_id)
        before = AgentCaller(
            connection, _Scripted([{"answer": "sealed under the old key"}]), job,
            settings=Settings(database_url=migrated.url, model_provider="", provenance_key=old_key),
        ).generate(_request("old prompt"), "x/1")  # fmt: skip
        after = AgentCaller(
            connection, _Scripted([{"answer": "sealed under the new key"}]), job,
            settings=Settings(database_url=migrated.url, model_provider="", provenance_key=new_key),
        ).generate(_request("new prompt"), "x/1")  # fmt: skip
    path = f"/organizations/{org}/projects/{project_id}/model-calls"
    purpose = {"purpose": "Checking the sealed prompt after the rotation"}
    old_id = provenance.key_id_of(base64.b64decode(old_key))
    new_id = provenance.key_id_of(base64.b64decode(new_key))
    assert old_id != new_id and len(old_id) == 12
    # Rotated: the new key current, the old one kept.
    rotated = _client(
        migrated, owner_id,
        settings=Settings(database_url=migrated.url, session_cookie_secure=False,
                          model_provider="", provenance_key=new_key,
                          provenance_previous_keys=f" {old_key} ,"),
    )  # fmt: skip
    read_old = rotated.get(f"{path}/{before.call_id}/content", params=purpose)
    assert read_old.status_code == 200, read_old.text
    assert (read_old.json()["prompt"], read_old.json()["key_id"]) == ("old prompt", old_id)
    read_new = rotated.get(f"{path}/{after.call_id}/content", params=purpose)
    assert read_new.status_code == 200 and read_new.json()["key_id"] == new_id
    # The old key dropped: the old content is refused by name; the new one still reads.
    dropped = _client(migrated, owner_id, settings=_app_settings(migrated, new_key))
    refused = dropped.get(f"{path}/{before.call_id}/content", params=purpose)
    assert refused.status_code == 409
    assert old_id in refused.json()["detail"]
    assert dropped.get(f"{path}/{after.call_id}/content", params=purpose).status_code == 200
    record = dropped.get(f"{path}/{before.call_id}")
    assert record.status_code == 200
    assert record.json()["has_content"] is True and len(record.json()["prompt_sha256"]) == 64


def test_retries_respect_a_cancellation_and_budgets_count_every_attempt(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeded, project_id, _owner = _ready(migrated, "retry-cancel", "")
    org, owner_id = seeded["organization_id"], seeded["user_id"]
    flag = {"cancel": False}

    def pause_then_cancel(_seconds: float) -> None:
        flag["cancel"] = True

    monkeypatch.setattr(provenance, "pause", pause_then_cancel)
    with connect(migrated.url) as connection:
        job = Job("itgc-access-tester", "test_sheet", uuid4(), org, project_id, owner_id)
        # A cancellation asked for during the pause before a retry: no second attempt.
        provider = _Scripted([ModelTimeout(), {"answer": "late"}])
        call = AgentCaller(connection, provider, job, cancelled=lambda: flag["cancel"]).generate(
            _request(), "control-tester/1"
        )
        assert (call.status, call.attempts, len(provider.requests)) == ("CANCELLED", 2, 1)
        rows = connection.execute(
            "SELECT status, attempt FROM model_calls WHERE job_id = %s ORDER BY created_at",
            (job.job_id,),
        ).fetchall()
        assert [tuple(r) for r in rows] == [("TIMEOUT", 1), ("CANCELLED", 2)]
        # The job's spend accumulates across its calls and is checked before every
        # attempt, retries included: a short prompt estimates at about $0.041 here.
        flag["cancel"] = False
        other = Job("itgc-access-tester", "test_sheet", uuid4(), org, project_id, owner_id)
        spend = _Scripted(
            [{"answer": "one"}, ModelTimeout(), {"answer": "two"}, {"answer": "three"}]
        )
        caller = AgentCaller(connection, spend, other, config=SONNET, limits=Limits(0, 45_000, 0))
        first = caller.generate(_request(), "control-tester/1")
        second = caller.generate(_request(), "control-tester/1")
        third_call = caller.generate(_request(), "control-tester/1")
        assert (first.status, second.status, second.attempts, third_call.status) == (
            "SUCCEEDED",
            "SUCCEEDED",
            2,
            "BUDGET_EXCEEDED",
        )
        assert len(spend.requests) == 3, "the refused call was never sent"
        rows = connection.execute(
            "SELECT status, attempt, cost_micros FROM model_calls WHERE job_id = %s "
            "ORDER BY created_at",
            (other.job_id,),
        ).fetchall()
        assert [tuple(r) for r in rows] == [
            ("SUCCEEDED", 1, 3_600),
            ("TIMEOUT", 1, 0),
            ("SUCCEEDED", 2, 3_600),
            ("BUDGET_EXCEEDED", 1, 0),
        ]
        assert caller.spent == 7_200
