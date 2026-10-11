from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import token_hash
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.policy import evaluate
from ai_workforce_api.settings import Settings


def test_policy_allows_a_permitted_action_and_denies_the_rest(migrated: Database) -> None:
    seeded, project_id, other_project, client = _ready(migrated, "policy")
    allowed = client.post(_decide(seeded, project_id), json=_read())
    assert allowed.status_code == 200
    assert allowed.json() == {"action_id": "file.read", "decision": "ALLOW", "reason": "allowed"}
    unknown = client.post(
        _decide(seeded, project_id),
        json={"action_id": "mail.send", "parameters": {"safe": "true"}},
    )
    assert unknown.json()["decision"] == "DENY"
    assert unknown.json()["reason"] == "unregistered"
    certified = client.post(
        _decide(seeded, project_id),
        json={
            "action_id": "file.read",
            "parameters": {"resource_ref": "evidence/population", "safe": "true"},
        },
    )
    assert certified.json() == {"action_id": "file.read", "decision": "DENY", "reason": "invalid"}
    with connect(migrated.url) as connection:
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
    reader = _client(migrated, reviewer)
    denied = reader.post(
        _decide(seeded, project_id),
        json={"action_id": "task.create", "parameters": {"title": "Collect the population"}},
    )
    assert denied.json() == {"action_id": "task.create", "decision": "DENY", "reason": "permission"}
    before = _counts(migrated)
    granted = client.post(
        _decide(seeded, project_id),
        json={
            "action_id": "permission.modify",
            "parameters": {"target_user_ref": f"user/{reviewer}", "role": "CONTRIBUTOR"},
        },
    )
    assert granted.json()["decision"] == "ALLOW"
    itself = client.post(
        _decide(seeded, project_id),
        json={
            "action_id": "permission.modify",
            "parameters": {"target_user_ref": f"user/{seeded['user_id']}", "role": "CONTRIBUTOR"},
        },
    )
    assert itself.json() == {"action_id": "permission.modify", "decision": "DENY", "reason": "self"}
    org_ban = client.post(
        _restrictions(seeded),
        json={"action_id": "mail.external"},
    )
    assert org_ban.status_code == 200
    again = client.post(_restrictions(seeded), json={"action_id": "mail.external"})
    assert again.json()["id"] == org_ban.json()["id"]
    banned = client.post(
        _decide(seeded, project_id),
        json={
            "action_id": "mail.external",
            "parameters": {"recipient": "audit@example.com", "subject": "Population request"},
        },
    )
    assert banned.json()["reason"] == "organization"
    project_ban = client.post(
        _restrictions(seeded),
        json={"action_id": "task.create", "project_id": str(project_id)},
    )
    assert project_ban.status_code == 200
    blocked = client.post(
        _decide(seeded, project_id),
        json={"action_id": "task.create", "parameters": {"title": "Collect the population"}},
    )
    assert blocked.json()["reason"] == "project"
    open_project = client.post(
        _decide(seeded, other_project),
        json={"action_id": "task.create", "parameters": {"title": "Collect the population"}},
    )
    assert open_project.json()["decision"] == "ALLOW"
    removed = client.delete(f"{_restrictions(seeded)}/{project_ban.json()['id']}")
    assert removed.status_code == 204
    restored = client.post(
        _decide(seeded, project_id),
        json={"action_id": "task.create", "parameters": {"title": "Collect the population"}},
    )
    assert restored.json()["decision"] == "ALLOW"
    assert _counts(migrated) == before
    assert "audit@example.com" not in _audit_text(migrated)
    with connect(migrated.url) as connection:
        agent = evaluate(
            connection,
            Principal(kind=PrincipalKind.AGENT, id=uuid4()),
            seeded["organization_id"],
            project_id,
            "permission.modify",
            {"target_user_ref": "user/other", "role": "REVIEWER"},
        )
    assert agent.decision == "DENY"
    assert agent.reason == "agent"


def test_inactive_projects_secret_values_and_other_tenants_fail_closed(migrated: Database) -> None:
    seeded, project_id, _other, client = _ready(migrated, "closed")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'PAUSED' WHERE id = %s",
            (project_id,),
        )
        connection.commit()
        contributor = _add_user(
            connection, seeded["organization_id"], "contributor@example.com", "CONTRIBUTOR"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, contributor)
    reading = client.post(_decide(seeded, project_id), json=_read())
    assert reading.json()["decision"] == "ALLOW"
    creating = client.post(
        _decide(seeded, project_id),
        json={"action_id": "task.create", "parameters": {"title": "Collect the population"}},
    )
    assert creating.json() == {"action_id": "task.create", "decision": "DENY", "reason": "inactive"}
    secret = client.post(
        _decide(seeded, project_id),
        json={
            "action_id": "mail.draft",
            "parameters": {"recipient": "audit@example.com", "subject": "api_key=sk-live-example"},
        },
    )
    assert secret.status_code == 422
    assert "sk-live-example" not in secret.text
    assert "sk-live-example" not in _audit_text(migrated)
    member = _client(migrated, contributor)
    assert member.post(_restrictions(seeded), json={"action_id": "file.read"}).status_code == 403
    with connect(migrated.url) as connection:
        stranger = _seed_org(connection, "stranger")
    hidden = _client(migrated, stranger["user_id"]).post(_decide(seeded, project_id), json=_read())
    assert hidden.status_code == 404


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _read() -> dict[str, Any]:
    return {"action_id": "file.read", "parameters": {"resource_ref": "evidence/population"}}


def _decide(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/actions/decide"


def _restrictions(seeded: dict[str, Any]) -> str:
    return f"/organizations/{seeded['organization_id']}/action-restrictions"


def _ready(database: Database, slug: str) -> tuple[dict[str, Any], UUID, UUID, TestClient]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug)
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        other = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    return seeded, project_id, other, _client(database, seeded["user_id"])


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


def _audit_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT action, payload::text FROM audit_events").fetchall()
    return str(rows)
