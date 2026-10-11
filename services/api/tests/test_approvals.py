from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.approvals import payload_hash
from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def test_an_approval_is_bound_to_the_exact_parameters(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "bind")
    with connect(migrated.url) as connection:
        admin = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
        manager = _add_user(
            connection, seeded["organization_id"], "manager@example.com", "PROJECT_MANAGER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, manager)
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
        agent_id = _seed_agent(connection, seeded["organization_id"], "ACTIVE")
    before = _counts(migrated)
    first = client.post(
        _approvals(seeded, project_id),
        json={**_external("first@example.com"), "requesting_agent_id": str(agent_id)},
    )
    assert first.status_code == 200
    assert first.json()["decision"] == "PENDING"
    assert first.json()["execution_status"] == "NOT_STARTED"
    assert first.json()["risk"] == "HIGH"
    assert first.json()["target_resource"] == "first@example.com"
    assert first.json()["requesting_agent_id"] == str(agent_id)
    repeat = client.post(
        _approvals(seeded, project_id),
        json={**_external("first@example.com"), "requesting_agent_id": str(agent_id)},
    )
    assert repeat.json()["id"] == first.json()["id"]
    changed = client.post(_approvals(seeded, project_id), json=_external("second@example.com"))
    assert changed.status_code == 200
    assert changed.json()["id"] != first.json()["id"]
    assert changed.json()["payload_hash"] != first.json()["payload_hash"]
    owner_decision = client.post(
        _decision(seeded, project_id, first.json()["id"]),
        json={"decision": "APPROVED", "reason": "I asked for it"},
    )
    assert owner_decision.status_code == 409
    assert owner_decision.json()["detail"] == "requester cannot approve"
    manager_client = _client(migrated, manager)
    denied = manager_client.post(
        _decision(seeded, project_id, first.json()["id"]),
        json={"decision": "APPROVED", "reason": "Project manager"},
    )
    assert denied.status_code == 403
    approved = _client(migrated, admin).post(
        _decision(seeded, project_id, first.json()["id"]),
        json={"decision": "APPROVED", "reason": "Recipient is unchanged"},
    )
    assert approved.status_code == 200
    assert approved.json()["decision"] == "APPROVED"
    assert approved.json()["execution_status"] == "NOT_STARTED"
    assert approved.json()["parameters"]["recipient"] == "first@example.com"
    second = client.get(f"{_approvals(seeded, project_id)}/{changed.json()['id']}")
    assert second.json()["decision"] == "PENDING"
    assert second.json()["parameters"]["recipient"] == "second@example.com"
    routine = client.post(_approvals(seeded, project_id), json=_pbc())
    accepted = manager_client.post(
        _decision(seeded, project_id, routine.json()["id"]),
        json={"decision": "APPROVED", "reason": "Routine request"},
    )
    assert accepted.status_code == 200
    reader = _client(migrated, reviewer)
    assert reader.get(_approvals(seeded, project_id)).status_code == 200
    assert (
        reader.post(_approvals(seeded, project_id), json=_external("third@example.com")).status_code
        == 403
    )
    assert _counts(migrated) == before
    assert "first@example.com" not in _audit_text(migrated)
    assert "first@example.com" in str(first.json()["parameters"])


def test_denied_secret_and_expired_requests_are_not_usable(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "closed")
    with connect(migrated.url) as connection:
        admin = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
        connection.execute(
            """
            INSERT INTO action_restrictions (organization_id, action_id)
            VALUES (%s, 'mail.external')
            """,
            (seeded["organization_id"],),
        )
        connection.commit()
    denied = client.post(_approvals(seeded, project_id), json=_external("audit@example.com"))
    assert denied.status_code == 409
    assert denied.json()["detail"] == "action is not allowed"
    connection_url = migrated
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM action_restrictions WHERE organization_id = %s",
            (seeded["organization_id"],),
        )
        connection.commit()
    unnecessary = client.post(
        _approvals(seeded, project_id),
        json={"action_id": "file.read", "parameters": {"resource_ref": "evidence/population"}},
    )
    assert unnecessary.status_code == 422
    assert unnecessary.json()["detail"] == "approval is not required"
    secret = client.post(
        _approvals(seeded, project_id),
        json=_external("audit@example.com", subject="api_key=sk-live-example"),
    )
    assert secret.status_code == 422
    assert "sk-live-example" not in secret.text
    with connect(migrated.url) as connection:
        disabled = _seed_agent(connection, seeded["organization_id"], "DISABLED")
    blocked = client.post(
        _approvals(seeded, project_id),
        json={**_external("audit@example.com"), "requesting_agent_id": str(disabled)},
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "disabled agent cannot request approval"
    assert _approval_count(migrated) == 0
    approval_id = _insert_expired(migrated, seeded, project_id)
    late = _client(migrated, admin).post(
        _decision(seeded, project_id, approval_id),
        json={"decision": "APPROVED", "reason": "Too late"},
    )
    assert late.status_code == 409
    assert late.json()["detail"] == "approval has expired"
    stored = client.get(f"{_approvals(seeded, project_id)}/{approval_id}")
    assert stored.json()["decision"] == "EXPIRED"
    assert stored.json()["execution_status"] == "NOT_STARTED"
    assert "sk-live-example" not in _audit_text(migrated)
    del connection_url


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _external(recipient: str, subject: str = "Population request") -> dict[str, Any]:
    return {
        "action_id": "mail.external",
        "parameters": {"recipient": recipient, "subject": subject},
    }


def _pbc() -> dict[str, Any]:
    return {
        "action_id": "mail.pbc",
        "parameters": {
            "recipient": "client@example.com",
            "subject": "Population request",
            "request_ref": "request/population",
        },
    }


def _approvals(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/approvals"


def _decision(seeded: dict[str, Any], project_id: UUID, approval_id: UUID | str) -> str:
    return f"{_approvals(seeded, project_id)}/{approval_id}/decision"


def _ready(database: Database, slug: str) -> tuple[dict[str, Any], UUID, TestClient]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug)
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    return seeded, project_id, _client(database, seeded["user_id"])


def _client(database: Database, user_id: UUID) -> TestClient:
    settings = Settings(database_url=database.url, session_cookie_secure=False)
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
    return TestClient(create_app(settings), cookies={"aw_session": token})


def _seed_org(connection: psycopg.Connection[Any], slug: str) -> dict[str, Any]:
    name = f"{slug}-{uuid4().hex[:8]}"
    email = f"{name}@example.com"
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO organizations (name, slug) VALUES (%s, %s) RETURNING id",
            (name, name),
        )
        organization = cursor.fetchone()
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email),
        )
        user = cursor.fetchone()
        if organization is None or user is None:
            raise RuntimeError("seed failed")
        cursor.execute(
            "INSERT INTO memberships (organization_id, user_id, role) VALUES (%s, %s, 'OWNER')",
            (organization[0], user[0]),
        )
    connection.commit()
    return {"organization_id": organization[0], "user_id": user[0]}


def _seed_project(
    connection: psycopg.Connection[Any], organization_id: UUID, user_id: UUID
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO projects (organization_id, name, slug, owner_user_id, status)
            VALUES (%s, 'SOX', %s, %s, 'ACTIVE')
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
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, %s)
            """,
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


def _seed_agent(connection: psycopg.Connection[Any], organization_id: UUID, status: str) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO agent_definitions (
                organization_id, agent_key, name, role, input_schema, output_schema,
                model_config_ref, max_iterations, time_budget_seconds, status
            )
            VALUES (%s, %s, 'Population collector', 'Collects a population',
                    '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb,
                    'audit-model', 2, 60, %s)
            RETURNING id
            """,
            (organization_id, f"collector-{uuid4().hex[:8]}", status),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None or not isinstance(row[0], UUID):
        raise RuntimeError("seed failed")
    return row[0]


def _insert_expired(database: Database, seeded: dict[str, Any], project_id: UUID) -> UUID:
    parameters = {"recipient": "late@example.com", "subject": "Population request"}
    digest = payload_hash(seeded["organization_id"], project_id, "mail.external", None, parameters)
    with connect(database.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO approvals (
                    organization_id, project_id, requesting_user_id, action_id, parameters,
                    target_resource, risk, payload_hash, created_at, expires_at
                )
                VALUES (
                    %s, %s, %s, 'mail.external', %s, 'late@example.com', 'HIGH', %s,
                    clock_timestamp() - interval '2 hours',
                    clock_timestamp() - interval '1 minute'
                )
                RETURNING id
                """,
                (
                    seeded["organization_id"],
                    project_id,
                    seeded["user_id"],
                    psycopg.types.json.Json(parameters),
                    digest,
                ),
            )
            row = cursor.fetchone()
        connection.commit()
    if row is None or not isinstance(row[0], UUID):
        raise RuntimeError("seed failed")
    return row[0]


def _counts(database: Database) -> tuple[int, int]:
    with connect(database.url) as connection:
        tasks = connection.execute("SELECT count(*) FROM tasks").fetchone()
        memberships = connection.execute("SELECT count(*) FROM memberships").fetchone()
    if (
        tasks is None
        or memberships is None
        or not isinstance(tasks[0], int)
        or not isinstance(memberships[0], int)
    ):
        return (0, 0)
    return (tasks[0], memberships[0])


def _approval_count(database: Database) -> int:
    with connect(database.url) as connection:
        row = connection.execute("SELECT count(*) FROM approvals").fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _audit_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT payload::text FROM audit_events").fetchall()
    return str(rows)
