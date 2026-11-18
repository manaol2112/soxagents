"""Live model smoke (Milestone 3a). Runs only when MODEL_LIVE_TESTS=1 and a provider key
are set in the environment; never part of the gate. It costs a few cents: one short
structured call per tier, then the tester on one synthetic control with synthetic
evidence. It prints what the report needs: the model that answered, the tokens, the cost
and the duration of every call, and the tester's results.
"""

import json
import os
from typing import Any
from uuid import UUID, uuid4

import pytest
from support import Database
from test_agent_execution import _ready_sheet
from test_models import _seed_org, _seed_project
from test_outbound import migrated

from ai_workforce_api.db import connect
from ai_workforce_api.model_providers import check_model_configuration, provider_for, tier_config
from ai_workforce_api.models import ModelRequest
from ai_workforce_api.provenance import AgentCaller, Job
from ai_workforce_api.settings import Settings
from ai_workforce_api.testing_engine import run_sheet
from ai_workforce_api.workforce import sync_standard_workforce

__all__ = ["migrated"]

# Read at import: the session fixture clears the model variables for every test, so the
# key is taken here and handed to the settings by hand. It is never printed or stored.
_KEY = os.environ.get("MODEL_API_KEY", "")
_live = os.environ.get("MODEL_LIVE_TESTS") == "1" and _KEY != ""
pytestmark = pytest.mark.skipif(
    not _live, reason="live model tests run only with MODEL_LIVE_TESTS=1 and MODEL_API_KEY"
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "n"],
    "properties": {"answer": {"type": "string"}, "n": {"type": "integer"}},
}


def _live_settings(database: Database) -> Settings:
    settings = Settings(database_url=database.url, model_provider="anthropic", model_api_key=_KEY)
    assert check_model_configuration(settings) == []
    return settings


def test_each_tier_answers_a_structured_prompt_and_is_recorded_with_its_cost(
    migrated: Database,
) -> None:
    settings = _live_settings(migrated)
    provider = provider_for(settings)
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "live", "live-owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        sync_standard_workforce(connection)
        summary: list[dict[str, Any]] = []
        for tier in ("FAST", "BALANCED", "DEEP"):
            job = Job("itgc-access-tester", "test_sheet", uuid4(), seeded["organization_id"],
                      project_id, seeded["user_id"])  # fmt: skip
            caller = AgentCaller(connection, provider, job, settings=settings, tier=tier)
            call = caller.generate(
                ModelRequest(
                    operation="generate",
                    prompt="Record the answer 'ok' and n = 3.",
                    output_schema=SCHEMA,
                    allowed_tool_ids=(),
                    timeout_seconds=60,
                    cancelled=False,
                    system="Answer only through the record_output tool.",
                ),
                "live-smoke/1",
            )
            if call.status != "SUCCEEDED":
                error = connection.execute(
                    "SELECT error FROM model_calls WHERE id = %s", (call.call_id,)
                ).fetchone()
                raise AssertionError((tier, call.status, error))
            assert call.raw.output == {"answer": "ok", "n": 3}
            row = connection.execute(
                "SELECT model_name, tier, input_tokens, output_tokens, cost_micros, duration_ms, "
                "prompt_sha256, output_sha256 FROM model_calls WHERE id = %s",
                (call.call_id,),
            ).fetchone()
            assert row is not None
            expected = tier_config(settings, tier).model_name
            assert (row[0], row[1]) == (expected, tier)
            assert row[2] > 0 and row[3] > 0 and row[4] > 0 and row[5] > 0
            summary.append(
                {"tier": tier, "model": row[0], "input_tokens": row[2], "output_tokens": row[3],
                 "cost_usd": row[4] / 1e6, "duration_ms": row[5]}
            )  # fmt: skip
    print("\nLIVE TIERS " + json.dumps(summary))


def test_the_tester_tests_synthetic_evidence_with_the_live_model(migrated: Database) -> None:
    settings = _live_settings(migrated)
    provider = provider_for(settings)
    team, client, sheet = _ready_sheet(migrated, "live-tester")
    with connect(migrated.url) as connection:
        assert run_sheet(connection, provider, UUID(sheet["id"]), None, settings) == "DONE"
        items = connection.execute(
            "SELECT label, source, results, note FROM test_items WHERE test_sheet_id = %s "
            "ORDER BY position",
            (sheet["id"],),
        ).fetchall()
        calls = connection.execute(
            "SELECT model_name, tier, status, attempt, input_tokens, output_tokens, cost_micros, "
            "duration_ms, prompt_version FROM model_calls WHERE project_id = %s "
            "ORDER BY created_at",
            (team["project"],),
        ).fetchall()
    assert [i[1] for i in items] == ["MODEL", "MODEL", "MODEL"], [tuple(i[:2]) for i in items]
    for _label, _source, results, _note in items:
        assert results and all(r["result"] in ("PASS", "EXCEPTION", "UNABLE", "NOT_APPLICABLE")
                               for r in results)  # fmt: skip
        # A pass stands only on a citation that checked out against the file.
        assert all(r["citations"] for r in results if r["result"] == "PASS")
    assert {c[2] for c in calls} == {"SUCCEEDED"}
    assert {c[1] for c in calls} == {"BALANCED"}
    current = client.get(
        f"/organizations/{team['org']}/projects/{team['project']}/test-sheets"
    ).json()[0]
    report = {
        "sheet": sheet["id"],
        "attributes": sheet["attributes"],
        "items": [
            {"label": i[0], "source": i[1], "note": i[3],
             "results": [{"index": r["index"], "result": r["result"], "note": r["note"],
                          "citations": len(r.get("citations", []))} for r in i[2]]}
            for i in items
        ],
        "calls": [
            {"model": c[0], "tier": c[1], "status": c[2], "attempt": c[3], "input_tokens": c[4],
             "output_tokens": c[5], "cost_usd": c[6] / 1e6, "duration_ms": c[7],
             "prompt_version": c[8]}
            for c in calls
        ],
        "proposed_conclusion": current["proposed_conclusion"],
        "total_cost_usd": sum(c[6] for c in calls) / 1e6,
    }  # fmt: skip
    print("\nLIVE TESTER " + json.dumps(report))
