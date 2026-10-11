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
from ai_workforce_api.settings import Settings

_EXPECTED = (
    ("file.read", "task.read", "LOW", "NONE"),
    ("task.create", "task.update", "LOW", "NONE"),
    ("mail.draft", "task.update", "MODERATE", "NONE"),
    ("mail.pbc", "task.update", "MODERATE", "PROJECT"),
    ("mail.reminder", "task.update", "MODERATE", "PROJECT"),
    ("mail.external", "task.update", "HIGH", "ORGANIZATION"),
    ("attachment.retrieve", "task.read", "MODERATE", "PROJECT"),
    ("workpaper.update", "task.update", "HIGH", "PROJECT"),
    ("permission.modify", "membership.grant", "HIGH", "ORGANIZATION"),
    ("report.finalize", "project.update", "HIGH", "ORGANIZATION"),
)


def test_the_catalog_declares_every_action_and_does_not_execute(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "catalog")
    listed = client.get(f"/organizations/{seeded['organization_id']}/actions")
    assert listed.status_code == 200
    body = listed.json()
    assert [
        (item["action_id"], item["permission"], item["risk"], item["approval"]) for item in body
    ] == list(_EXPECTED)
    assert body[0]["fields"] == [{"name": "resource_ref", "kind": "reference", "max_length": 200}]
    before = _counts(migrated)
    checked = client.post(
        _checks(seeded, project_id),
        json={"action_id": "task.create", "parameters": {"title": "Collect the population"}},
    )
    assert checked.status_code == 200
    assert checked.json() == {
        "action_id": "task.create",
        "permission": "task.update",
        "risk": "LOW",
        "approval": "NONE",
        "accepted": True,
    }
    sensitive = client.post(
        _checks(seeded, project_id),
        json={
            "action_id": "mail.external",
            "parameters": {"recipient": "audit@example.com", "subject": "Population request"},
        },
    )
    assert sensitive.status_code == 200
    assert sensitive.json()["approval"] == "ORGANIZATION"
    assert sensitive.json()["risk"] == "HIGH"
    assert _counts(migrated) == before
    assert client.get("/health").json()["live_email_enabled"] is False


def test_unknown_secret_and_incomplete_actions_are_rejected(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "reject")
    unknown = client.post(
        _checks(seeded, project_id),
        json={"action_id": "mail.send", "parameters": {}},
    )
    assert unknown.status_code == 422
    assert unknown.json()["detail"] == "action is not registered"
    missing = client.post(
        _checks(seeded, project_id),
        json={"action_id": "file.read", "parameters": {}},
    )
    assert missing.status_code == 422
    assert missing.json()["detail"] == "action fields are invalid"
    extra = client.post(
        _checks(seeded, project_id),
        json={
            "action_id": "file.read",
            "parameters": {"resource_ref": "evidence/population", "note": "extra"},
        },
    )
    assert extra.status_code == 422
    owner = client.post(
        _checks(seeded, project_id),
        json={
            "action_id": "permission.modify",
            "parameters": {"target_user_ref": "user/preview", "role": "OWNER"},
        },
    )
    assert owner.status_code == 422
    secret = client.post(
        _checks(seeded, project_id),
        json={
            "action_id": "mail.draft",
            "parameters": {"recipient": "audit@example.com", "subject": "api_key=sk-live-example"},
        },
    )
    assert secret.status_code == 422
    assert "sk-live-example" not in secret.text
    assert "sk-live-example" not in _stored_text(migrated)


def test_reviewer_can_read_the_catalog_and_another_tenant_cannot(migrated: Database) -> None:
    seeded, project_id, owner = _ready(migrated, "review")
    with connect(migrated.url) as connection:
        reviewer = _add_user(connection, seeded["organization_id"], "reviewer@example.com")
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
        other = _seed_org(connection, "other")
    reader = _client(migrated, reviewer)
    assert reader.get(f"/organizations/{seeded['organization_id']}/actions").status_code == 200
    checked = reader.post(
        _checks(seeded, project_id),
        json={"action_id": "file.read", "parameters": {"resource_ref": "evidence/population"}},
    )
    assert checked.status_code == 200
    stranger = _client(migrated, other["user_id"])
    hidden = stranger.get(f"/organizations/{seeded['organization_id']}/actions")
    assert hidden.status_code == 404
    anonymous = TestClient(
        create_app(Settings(database_url=migrated.url, session_cookie_secure=False))
    )
    assert anonymous.get(f"/organizations/{seeded['organization_id']}/actions").status_code == 401
    del owner


def test_action_module_does_not_send_mail() -> None:
    source = (Path(__file__).parents[1] / "ai_workforce_api" / "actions.py").read_text(
        encoding="utf-8"
    )
    lowered = source.lower()
    assert "smtplib" not in lowered
    assert "graph" not in lowered
    assert "msal" not in lowered


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _ready(database: Database, slug: str) -> tuple[dict[str, Any], UUID, TestClient]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug)
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    return seeded, project_id, _client(database, seeded["user_id"])


def _checks(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/actions/check"


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


def _add_user(connection: psycopg.Connection[Any], organization_id: UUID, email: str) -> UUID:
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
            VALUES (%s, %s, 'REVIEWER')
            """,
            (organization_id, row[0]),
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


def _counts(database: Database) -> tuple[int, int, int]:
    with connect(database.url) as connection:
        tasks = connection.execute("SELECT count(*) FROM tasks").fetchone()
        audits = connection.execute("SELECT count(*) FROM audit_events").fetchone()
        plans = connection.execute("SELECT count(*) FROM manager_plans").fetchone()
    if (
        tasks is None
        or audits is None
        or plans is None
        or not isinstance(tasks[0], int)
        or not isinstance(audits[0], int)
        or not isinstance(plans[0], int)
    ):
        return (0, 0, 0)
    return (tasks[0], audits[0], plans[0])


def _stored_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT payload::text FROM audit_events").fetchall()
    return str(rows)
