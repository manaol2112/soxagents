from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_onboarding import _base, _new_engagement
from test_outbound import migrated

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect
from ai_workforce_api.main import create_app
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.rcm_import import ValueChoice
from ai_workforce_api.rcm_terms import check_terms, run_terms, terms_prompt
from ai_workforce_api.settings import Settings

__all__ = ["migrated"]

CHOICES = {
    "domain": [ValueChoice("IT", 3, None), ValueChoice("Program Change", 1, "CHANGE")],
    "frequency": [ValueChoice("Whenever needed", 2, None), ValueChoice("", 1, None)],
    "nature": [ValueChoice("Manual", 4, "MANUAL")],
}


def test_only_real_terms_and_allowed_values_are_taken() -> None:
    answer = {
        "mappings": [
            {"field": "domain", "term": "IT", "value": "ACCESS", "reason": "User access reviews."},
            {"field": "domain", "term": "Finance", "value": "RECORD_TO_REPORT", "reason": "x"},
            {"field": "frequency", "term": "Whenever needed", "value": "HOURLY", "reason": "x"},
            {"field": "frequency", "term": "(blank)", "value": "ANNUAL", "reason": "No value."},
            {"field": "nature", "term": "manual", "value": "MANUAL", "reason": "See https://x"},
            {"field": "domain", "term": "IT", "value": "CHANGE", "reason": "second answer"},
            {
                "field": "domain",
                "term": "Program Change",
                "value": "Change management",
                "reason": "Given as the label.",
            },
        ]
    }
    kept = check_terms(answer, CHOICES)
    assert kept["domain"] == {
        "it": ("ACCESS", "User access reviews."),
        "program change": ("CHANGE", "Given as the label."),
    }
    assert kept["frequency"] == {"": ("ANNUAL", "No value.")}
    assert kept["nature"] == {"manual": ("MANUAL", "")}
    with pytest.raises(ValueError):
        check_terms(
            {"mappings": [{"field": "domain", "term": "Nope", "value": "TAX", "reason": ""}]},
            CHOICES,
        )
    with pytest.raises(ValueError):
        check_terms({"mappings": "nope"}, CHOICES)


def test_the_prompt_gives_each_term_its_controls_and_the_standard_values() -> None:
    prompt = terms_prompt(CHOICES, {"domain": {"it": ["AC-01 - Access is reviewed."]}})
    assert "<rcm_terms>" in prompt
    assert "AC-01 - Access is reviewed." in prompt
    assert '"ORDER_TO_CASH": "Order to cash / revenue"' in prompt
    assert '"(blank)"' in prompt


# End to end

CLIENT_RCM = (
    "Ctrl #,Control Activity,How Often,Manual / Automated,Process,Control Owner\n"
    "AC 1.01,User access is reviewed by the application owner.,Quarterly,Manual,IT,Dana\n"
    "AC 1.02,New access is approved before it is granted.,Whenever needed,Manual,IT,Dana\n"
    "CM 2.01,Changes are tested before release.,Whenever needed,Manual,Program Change,Lee\n"
)


class FakeProvider:
    def __init__(self, output: dict[str, Any], during: Callable[[], None] | None = None) -> None:
        self.output = output
        self.during = during
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        if self.during is not None:
            self.during()
        return ModelRaw(self.output, (), 800, 200)


class RecordingScheduler:
    def __init__(self) -> None:
        self.scans: list[UUID] = []

    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        del draft_ids

    def schedule_system_scans(self, import_ids: list[UUID]) -> None:
        self.scans.extend(import_ids)


AGENT = {
    "mappings": [
        {"field": "domain", "term": "IT", "value": "ACCESS", "reason": "Both controls are access."},
        {"field": "domain", "term": "Program Change", "value": "CHANGE", "reason": "Changes."},
        {
            "field": "frequency",
            "term": "Whenever needed",
            "value": "EVENT_DRIVEN",
            "reason": "Done per request or change.",
        },
        {"field": "frequency", "term": "Quarterly", "value": "MONTHLY", "reason": "Disagrees."},
        {"field": "nature", "term": "Manual", "value": "MANUAL", "reason": "People do it."},
    ]
}


def test_the_agent_fills_unmapped_terms_and_explains_them(migrated: Database) -> None:
    owner, base, upload = _uploaded(migrated, "terms-fill")
    terms = {item["value"]: item for item in upload["values"]["domain"]}
    assert terms["IT"]["mapped"] is None
    assert upload["terms"]["status"] == "PENDING"
    provider = FakeProvider(AGENT)
    with connect(migrated.url) as connection:
        assert run_terms(connection, provider, UUID(upload["id"])) == "READY"
    assert provider.requests[0].system.startswith("You are an IT audit senior")
    assert "New access is approved" in provider.requests[0].prompt
    read = owner.get(f"{base}/rcm/uploads/{upload['id']}").json()
    assert read["terms"]["status"] == "READY"
    assert read["terms"]["source"] == "MODEL"
    domain = {item["value"]: item for item in read["values"]["domain"]}
    assert domain["IT"]["mapped"] == "ACCESS"
    assert domain["IT"]["reason"] == "Both controls are access."
    assert domain["IT"]["mapped_by"] == "MODEL"
    frequency = {item["value"]: item for item in read["values"]["frequency"]}
    # Filling keeps what the rules already mapped; it only sets what was blank.
    assert frequency["Quarterly"]["mapped"] == "QUARTERLY"
    assert frequency["Quarterly"]["reason"] == ""
    # The agent disagreed with a choice it may not change: shown as its alternative.
    assert frequency["Quarterly"]["alternative"] == "MONTHLY"
    assert frequency["Quarterly"]["alternative_reason"] == "Disagrees."
    assert frequency["Whenever needed"]["mapped"] == "EVENT_DRIVEN"
    # Where it agrees with the rules, its reason is shown.
    nature = {item["value"]: item for item in read["values"]["nature"]}
    assert nature["Manual"]["reason"] == "People do it."
    assert nature["Manual"]["mapped_by"] == "MODEL"
    assert nature["Manual"]["alternative"] is None
    assert read["ready"] is True, read["preview"]["problems"]


def test_remapping_redoes_every_term_and_needs_no_model(migrated: Database) -> None:
    owner, base, upload = _uploaded(migrated, "terms-remap")
    import_id = UUID(upload["id"])
    with connect(migrated.url) as connection:
        run_terms(connection, FakeProvider(AGENT), import_id)
    scheduler = owner.app.state.scheduler  # type: ignore[attr-defined]
    scheduler.scans.clear()
    asked = owner.post(f"{base}/rcm/uploads/{import_id}/terms/remap")
    assert asked.status_code == 200, asked.text
    assert asked.json()["terms"] == {
        "status": "PENDING",
        "mode": "REMAP",
        "source": "MODEL",
        "note": "",
        "model_available": False,
    }
    assert scheduler.scans == [import_id]
    with connect(migrated.url) as connection:
        assert run_terms(connection, FakeProvider(AGENT), import_id) == "READY"
    frequency = {
        item["value"]: item
        for item in owner.get(f"{base}/rcm/uploads/{import_id}").json()["values"]["frequency"]
    }
    assert frequency["Quarterly"]["mapped"] == "MONTHLY"
    assert frequency["Quarterly"]["reason"] == "Disagrees."
    # Without a model, remapping puts the rule suggestions back.
    owner.post(f"{base}/rcm/uploads/{import_id}/terms/remap")
    with connect(migrated.url) as connection:
        assert run_terms(connection, None, import_id) == "READY"
    read = owner.get(f"{base}/rcm/uploads/{import_id}").json()
    frequency = {item["value"]: item for item in read["values"]["frequency"]}
    assert frequency["Quarterly"]["mapped"] == "QUARTERLY"
    assert frequency["Quarterly"]["mapped_by"] == "RULES"
    assert read["terms"]["note"] == "No model is configured."


def test_a_mapping_changed_while_the_agent_works_is_not_overwritten(migrated: Database) -> None:
    owner, base, upload = _uploaded(migrated, "terms-race")
    import_id = UUID(upload["id"])

    seen: list[object] = []

    def change() -> None:
        # Mid model call: the claim is visible, and the row is not locked.
        with connect(migrated.url) as connection:
            seen.append(
                connection.execute(
                    "SELECT terms_status FROM rcm_imports WHERE id = %s", (import_id,)
                ).fetchone()
            )
            connection.execute(
                "UPDATE rcm_imports SET column_fields = column_fields || '[]'::jsonb, "
                "header_row = header_row WHERE id = %s",
                (import_id,),
            )
            connection.execute(
                "UPDATE rcm_imports SET sheet_index = sheet_index, "
                "column_fields = jsonb_set(column_fields, '{1}', '\"custom\"') WHERE id = %s",
                (import_id,),
            )

    with connect(migrated.url) as connection:
        assert run_terms(connection, FakeProvider(AGENT, change), import_id) == "SKIPPED"
    assert seen == [("WORKING",)]
    domain = {
        item["value"]: item
        for item in owner.get(f"{base}/rcm/uploads/{import_id}").json()["values"]["domain"]
    }
    assert domain["IT"]["mapped"] is None


# Helpers


def _uploaded(database: Database, slug: str) -> tuple[TestClient, str, dict[str, Any]]:
    team = _new_engagement(database, slug)
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (%s, %s, clock_timestamp() + interval '1 hour')
            """,
            (team["owner_id"], token_hash(token)),
        )
    scheduler = RecordingScheduler()
    app = create_app(
        Settings(database_url=database.url, session_cookie_secure=False),
        draft_scheduler=scheduler,
    )
    app.state.scheduler = scheduler
    owner = TestClient(app, cookies={"aw_session": token})
    base = _base(team["org"], team["project"])
    uploaded = owner.post(
        f"{base}/rcm/uploads", params={"file_name": "rcm.csv"}, content=CLIENT_RCM.encode()
    )
    assert uploaded.status_code == 200, uploaded.text
    body: dict[str, Any] = uploaded.json()
    assert scheduler.scans == [UUID(body["id"])]
    return owner, base, body
