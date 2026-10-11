from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings

SCHEMA = {"type": "object", "properties": {}}


def test_owner_can_define_disable_and_enable_an_agent(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    client = _client(migrated, seeded["user_id"])
    created = client.post(
        f"/organizations/{seeded['organization_id']}/agents",
        json=_definition("evidence-request"),
    )
    assert created.status_code == 201
    body = created.json()
    assert body["revision"] == 1
    assert body["model_config_ref"] == "audit-model"
    assert "secret" not in body["model_config_ref"]
    agent_id = body["id"]
    _insert_instance(
        migrated,
        seeded["organization_id"],
        project_id,
        UUID(agent_id),
        "RUNNING",
    )
    disabled = client.patch(
        f"/organizations/{seeded['organization_id']}/agents/{agent_id}",
        json={**_edit(body), "status": "DISABLED", "version": body["version"]},
    )
    assert disabled.status_code == 200
    assert disabled.json()["status"] == "DISABLED"
    assert disabled.json()["revision"] == 2
    with connect(migrated.url) as connection:
        running = connection.execute(
            "SELECT status::text FROM agent_instances WHERE agent_definition_id = %s",
            (agent_id,),
        ).fetchone()
        assert running == ("RUNNING",)
        connection.execute(
            """
            UPDATE agent_instances
            SET status = 'SUCCEEDED', version = version + 1
            WHERE agent_definition_id = %s
            """,
            (agent_id,),
        )
        with pytest.raises(psycopg.errors.RaiseException, match="disabled agent cannot start"):
            _insert_instance(
                migrated,
                seeded["organization_id"],
                project_id,
                UUID(agent_id),
                "PENDING",
            )
    enabled = client.patch(
        f"/organizations/{seeded['organization_id']}/agents/{agent_id}",
        json={
            **_edit(disabled.json()),
            "status": "ACTIVE",
            "version": disabled.json()["version"],
        },
    )
    assert enabled.status_code == 200
    assert enabled.json()["status"] == "ACTIVE"
    listed = client.get(f"/organizations/{seeded['organization_id']}/agents")
    assert listed.status_code == 200
    assert listed.json()[0]["agent_key"] == "evidence-request"


def test_reviewer_can_read_and_cannot_change_definitions(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        manager = _add_user(
            connection, seeded["organization_id"], "manager@example.com", "PROJECT_MANAGER"
        )
    owner = _client(migrated, seeded["user_id"])
    created = owner.post(
        f"/organizations/{seeded['organization_id']}/agents",
        json=_definition("control-tester"),
    )
    assert created.status_code == 201
    agent_id = created.json()["id"]
    reviewer_client = _client(migrated, reviewer)
    listed = reviewer_client.get(f"/organizations/{seeded['organization_id']}/agents")
    assert listed.status_code == 200
    detail = reviewer_client.get(f"/organizations/{seeded['organization_id']}/agents/{agent_id}")
    assert detail.status_code == 200
    denied = reviewer_client.post(
        f"/organizations/{seeded['organization_id']}/agents",
        json=_definition("other-agent"),
    )
    assert denied.status_code == 403
    manager_client = _client(migrated, manager)
    managed = manager_client.post(
        f"/organizations/{seeded['organization_id']}/agents",
        json=_definition("pbc-chaser"),
    )
    assert managed.status_code == 201


def test_secret_values_duplicate_keys_and_other_tenants_are_rejected(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        other = _seed_org(connection, "beta", "beta@example.com")
    client = _client(migrated, seeded["user_id"])
    secret = client.post(
        f"/organizations/{seeded['organization_id']}/agents",
        json={
            **_definition("secret-agent"),
            "description": "api_key=sk-live-should-not-persist",
        },
    )
    assert secret.status_code == 422
    with connect(migrated.url) as connection:
        stored = connection.execute("SELECT count(*) FROM agent_definitions").fetchone()
    assert stored == (0,)
    created = client.post(
        f"/organizations/{seeded['organization_id']}/agents",
        json=_definition("evidence-request"),
    )
    assert created.status_code == 201
    duplicate = client.post(
        f"/organizations/{seeded['organization_id']}/agents",
        json=_definition("evidence-request"),
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "agent key is already in use"
    stale = client.patch(
        f"/organizations/{seeded['organization_id']}/agents/{created.json()['id']}",
        json={**_edit(created.json()), "version": 99},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "agent changed"
    hidden = client.get(f"/organizations/{other['organization_id']}/agents")
    assert hidden.status_code == 404
    foreign = _client(migrated, other["user_id"]).get(
        f"/organizations/{other['organization_id']}/agents/{created.json()['id']}"
    )
    assert foreign.status_code == 404


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _definition(agent_key: str) -> dict[str, Any]:
    return {
        "agent_key": agent_key,
        "name": "Evidence request",
        "role": "Requests population files",
        "description": "Asks the client for the listed evidence.",
        "input_schema": SCHEMA,
        "output_schema": SCHEMA,
        "allowed_tool_ids": ["mail.draft"],
        "model_config_ref": "audit-model",
        "max_iterations": 4,
        "time_budget_seconds": 600,
        "status": "ACTIVE",
    }


def _edit(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "agent_key": body["agent_key"],
        "name": body["name"],
        "role": body["role"],
        "description": body["description"],
        "input_schema": body["input_schema"],
        "output_schema": body["output_schema"],
        "allowed_tool_ids": body["allowed_tool_ids"],
        "model_config_ref": body["model_config_ref"],
        "max_iterations": body["max_iterations"],
        "time_budget_seconds": body["time_budget_seconds"],
        "status": body["status"],
    }


def _app(database: Database) -> Any:
    return create_app(Settings(database_url=database.url, session_cookie_secure=False))


def _client(database: Database, user_id: UUID) -> TestClient:
    raw = f"session-{user_id}"
    with connect(database.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO auth_sessions (user_id, token_hash, expires_at)
                VALUES (%s, %s, clock_timestamp() + interval '1 hour')
                """,
                (user_id, token_hash(raw)),
            )
    client = TestClient(_app(database))
    client.cookies.set("aw_session", raw)
    return client


def _seed_org(connection: psycopg.Connection[Any], slug: str, email: str) -> dict[str, Any]:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO organizations (name, slug) VALUES (%s, %s) RETURNING id",
            (slug, slug),
        )
        organization = cursor.fetchone()
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, slug),
        )
        user = cursor.fetchone()
        assert organization is not None
        assert user is not None
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, 'OWNER')
            """,
            (organization[0], user[0]),
        )
    return {"organization_id": organization[0], "user_id": user[0]}


def _add_user(
    connection: psycopg.Connection[Any], organization_id: UUID, email: str, role: str
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email),
        )
        user = cursor.fetchone()
        assert user is not None
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, %s)
            """,
            (organization_id, user[0], role),
        )
    assert isinstance(user[0], UUID)
    return user[0]


def _seed_project(
    connection: psycopg.Connection[Any], organization_id: UUID, user_id: UUID
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO projects (organization_id, name, slug, owner_user_id, status)
            VALUES (%s, 'SOX 2026', 'sox-2026', %s, 'ACTIVE')
            RETURNING id
            """,
            (organization_id, user_id),
        )
        project = cursor.fetchone()
        assert project is not None
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id)
            VALUES (%s, %s, %s)
            """,
            (organization_id, project[0], user_id),
        )
    assert isinstance(project[0], UUID)
    return project[0]


def _insert_instance(
    database: Database,
    organization_id: UUID,
    project_id: UUID,
    agent_id: UUID,
    status: str,
) -> None:
    with connect(database.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO agent_instances (
                    organization_id, project_id, agent_definition_id, definition_revision, status
                )
                VALUES (%s, %s, %s, 1, %s)
                """,
                (organization_id, project_id, agent_id, status),
            )
