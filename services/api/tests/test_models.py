from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.models import (
    ModelCancelled,
    ModelConfig,
    ModelProvider,
    ModelProviderError,
    ModelRateLimit,
    ModelRaw,
    ModelRequest,
    ModelTimeout,
    ToolProposal,
)
from ai_workforce_api.settings import Settings

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary"],
    "properties": {"summary": {"type": "string"}},
}
SECRET = "model-key-should-not-persist"


def test_local_model_fills_the_schema_and_records_usage(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "local")
    created = client.post(_calls(seeded, project_id), json=_generate("Summarize the population"))
    assert created.status_code == 200
    body = created.json()
    assert body["output"] == {"summary": ""}
    assert body["status"] == "SUCCEEDED"
    assert body["input_tokens"] > 0
    assert body["cost_micros"] == 0
    recorded = client.get(f"{_calls(seeded, project_id)}/{body['id']}")
    assert recorded.status_code == 200
    assert recorded.json()["output"] is None
    assert "Summarize the population" not in _stored_text(migrated)
    proposed = client.post(
        _calls(seeded, project_id),
        json={
            **_generate("Propose a draft"),
            "operation": "propose_tools",
            "allowed_tool_ids": ["mail.draft"],
        },
    )
    assert proposed.status_code == 200
    assert proposed.json()["tool_calls"] == [{"tool_id": "mail.draft", "arguments": {}}]
    assert proposed.json()["output"] is None


def test_malformed_timeout_cancel_and_limits_are_recorded(migrated: Database) -> None:
    seeded, project_id, _owner = _ready(migrated, "faults")
    cases = {
        "bad": (422, "model output is invalid", "MALFORMED"),
        "timeout": (408, "model timed out", "TIMEOUT"),
        "rate": (429, "model rate limit", "RATE_LIMITED"),
        "down": (503, "model provider is unavailable", "MODEL_ERROR"),
    }
    for mode, expected in cases.items():
        client = _client(migrated, seeded["user_id"], _Scripted(mode))
        response = client.post(_calls(seeded, project_id), json=_generate(f"Case {mode}"))
        assert response.status_code == expected[0]
        assert response.json()["detail"] == expected[1]
        assert "nope" not in response.text
    cancelled = _client(migrated, seeded["user_id"], _Scripted("unused"))
    response = cancelled.post(
        _calls(seeded, project_id), json={**_generate("Stop"), "cancelled": True}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "model call was cancelled"
    statuses = _statuses(migrated)
    assert statuses == ["MALFORMED", "TIMEOUT", "RATE_LIMITED", "MODEL_ERROR", "CANCELLED"]


def test_a_disallowed_tool_proposal_is_rejected(migrated: Database) -> None:
    seeded, project_id, _owner = _ready(migrated, "tools")
    client = _client(migrated, seeded["user_id"], _Scripted("foreign-tool"))
    response = client.post(
        _calls(seeded, project_id),
        json={
            **_generate("Propose"),
            "operation": "propose_tools",
            "allowed_tool_ids": ["mail.draft"],
        },
    )
    assert response.status_code == 422
    assert _statuses(migrated) == ["MALFORMED"]


def test_secret_prompt_and_unknown_configuration_are_not_stored(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "secret")
    leaked = client.post(_calls(seeded, project_id), json=_generate("api_key=sk-live-example"))
    assert leaked.status_code == 422
    unknown = client.post(
        _calls(seeded, project_id), json={**_generate("Hello"), "model_config_ref": "remote-prod"}
    )
    assert unknown.status_code == 422
    assert unknown.json()["detail"] == "model configuration is unknown"
    assert _statuses(migrated) == []
    assert "sk-live-example" not in _stored_text(migrated)


def test_remote_provider_is_refused_and_the_key_is_not_stored(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "remote", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    settings = Settings(
        database_url=migrated.url,
        session_cookie_secure=False,
        model_provider="openai",
        model_api_key=SECRET,
    )
    client = _client(migrated, seeded["user_id"], provider=None, settings=settings)
    response = client.post(_calls(seeded, project_id), json=_generate("Hello"))
    assert response.status_code == 503
    assert response.json()["detail"] == "model provider is unavailable"
    stored = _stored_text(migrated)
    assert SECRET not in stored
    assert "openai" not in stored
    assert _statuses(migrated) == ["MODEL_ERROR"]


def test_reviewer_can_read_a_call_and_cannot_create_one(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "review", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
    owner = _client(migrated, seeded["user_id"])
    created = owner.post(_calls(seeded, project_id), json=_generate("Hello"))
    assert created.status_code == 200
    reader = _client(migrated, reviewer)
    assert reader.get(f"{_calls(seeded, project_id)}/{created.json()['id']}").status_code == 200
    denied = reader.post(_calls(seeded, project_id), json=_generate("Hello again"))
    assert denied.status_code == 403


def test_other_tenant_cannot_read_a_model_call(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        first = _seed_org(connection, "one", "one@example.com")
        second = _seed_org(connection, "two", "two@example.com")
        project_id = _seed_project(connection, first["organization_id"], first["user_id"])
        other = _seed_project(connection, second["organization_id"], second["user_id"])
    owner = _client(migrated, first["user_id"])
    created = owner.post(_calls(first, project_id), json=_generate("Hello"))
    stranger = _client(migrated, second["user_id"])
    hidden = stranger.get(f"{_calls(second, other)}/{created.json()['id']}")
    assert hidden.status_code == 404


def test_model_module_does_not_import_a_provider_sdk() -> None:
    source = (Path(__file__).parents[1] / "ai_workforce_api" / "models.py").read_text(
        encoding="utf-8"
    )
    assert "openai" not in source
    assert "anthropic" not in source


class _Scripted:
    def __init__(self, mode: str) -> None:
        self.mode = mode

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        if self.mode == "bad":
            return ModelRaw({"nope": 1}, (), 2, 2)
        if self.mode == "timeout":
            raise ModelTimeout()
        if self.mode == "rate":
            raise ModelRateLimit()
        if self.mode == "down":
            raise ModelProviderError()
        if self.mode == "foreign-tool":
            return ModelRaw(None, (ToolProposal("shell.exec", {}),), 1, 1)
        if self.mode == "unused":
            raise ModelCancelled()
        raise AssertionError(self.mode)


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _ready(database: Database, slug: str) -> tuple[dict[str, Any], UUID, TestClient]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug, "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    return seeded, project_id, _client(database, seeded["user_id"])


def _generate(prompt: str) -> dict[str, Any]:
    return {
        "model_config_ref": "audit-model",
        "operation": "generate",
        "prompt": prompt,
        "output_schema": SCHEMA,
    }


def _calls(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/model-calls"


def _client(
    database: Database,
    user_id: UUID,
    provider: ModelProvider | None = None,
    settings: Settings | None = None,
) -> TestClient:
    resolved = settings or Settings(
        database_url=database.url, session_cookie_secure=False, model_provider=""
    )
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (%s, %s, clock_timestamp() + interval '1 hour')
            """,
            (user_id, token_hash(token)),
        )
        connection.commit()
    return TestClient(
        create_app(resolved, model_provider=provider),
        cookies={"aw_session": token},
    )


def _statuses(database: Database) -> list[str]:
    with connect(database.url) as connection:
        rows = connection.execute(
            "SELECT status FROM model_calls ORDER BY created_at, id"
        ).fetchall()
    return [row[0] for row in rows if isinstance(row[0], str)]


def _stored_text(database: Database) -> str:
    with connect(database.url) as connection:
        calls = connection.execute("SELECT * FROM model_calls").fetchall()
        audits = connection.execute(
            "SELECT payload::text FROM audit_events WHERE action = 'model.called'"
        ).fetchall()
    return str(calls) + str(audits)


def _seed_org(connection: psycopg.Connection[Any], slug: str, email: str) -> dict[str, Any]:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO organizations (name, slug) VALUES (%s, %s) RETURNING id",
            (slug, slug),
        )
        organization_id = cursor.fetchone()
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email),
        )
        user_id = cursor.fetchone()
        if organization_id is None or user_id is None:
            raise RuntimeError("seed failed")
        cursor.execute(
            "INSERT INTO memberships (organization_id, user_id, role) VALUES (%s, %s, 'OWNER')",
            (organization_id[0], user_id[0]),
        )
    connection.commit()
    return {"organization_id": organization_id[0], "user_id": user_id[0]}


def _seed_project(
    connection: psycopg.Connection[Any], organization_id: UUID, user_id: UUID
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO projects (organization_id, name, slug, owner_user_id)
            VALUES (%s, 'SOX', %s, %s)
            RETURNING id
            """,
            (organization_id, f"sox-{uuid4().hex[:8]}", user_id),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[0], UUID):
            raise RuntimeError("seed failed")
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id)
            VALUES (%s, %s, %s)
            """,
            (organization_id, row[0], user_id),
        )
    connection.commit()
    return row[0]


def _add_user(
    connection: psycopg.Connection[Any], organization_id: UUID, email: str, role: str
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[0], UUID):
            raise RuntimeError("seed failed")
        cursor.execute(
            "INSERT INTO memberships (organization_id, user_id, role) VALUES (%s, %s, %s)",
            (organization_id, row[0], role),
        )
    connection.commit()
    return row[0]


def _add_project_member(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, user_id: UUID
) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id)
            VALUES (%s, %s, %s)
            """,
            (organization_id, project_id, user_id),
        )
    connection.commit()
