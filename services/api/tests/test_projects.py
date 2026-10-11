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


def test_owner_can_create_edit_pause_and_archive(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
    client = _client(migrated, seeded["user_id"])
    created = client.post(
        f"/organizations/{seeded['organization_id']}/projects",
        json={
            "name": "SOX 2026",
            "slug": "sox-2026",
            "scope": "Access reviews",
            "owner_user_id": str(seeded["user_id"]),
            "status": "ACTIVE",
            "starts_on": "2026-01-01",
            "ends_on": "2026-12-31",
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["scope"] == "Access reviews"
    assert body["progress"] == []
    assert body["activity"][0]["action"] == "project.created"
    project_id = body["id"]
    paused = client.patch(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}",
        json={**_edit(body), "status": "PAUSED", "version": body["version"]},
    )
    assert paused.status_code == 200
    assert paused.json()["status"] == "PAUSED"
    assert paused.json()["activity"][0]["action"] == "project.paused"
    resumed = client.patch(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}",
        json={**_edit(paused.json()), "status": "ACTIVE", "version": paused.json()["version"]},
    )
    assert resumed.status_code == 200
    assert resumed.json()["activity"][0]["action"] == "project.resumed"
    archived = client.patch(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}",
        json={**_edit(resumed.json()), "status": "ARCHIVED", "version": resumed.json()["version"]},
    )
    assert archived.status_code == 200
    reopened = client.patch(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}",
        json={
            **_edit(archived.json()),
            "status": "ACTIVE",
            "version": archived.json()["version"],
        },
    )
    assert reopened.status_code == 409
    kept = client.get(f"/organizations/{seeded['organization_id']}/projects/{project_id}")
    assert kept.status_code == 200
    assert kept.json()["status"] == "ARCHIVED"


def test_reviewer_cannot_create_and_contributor_cannot_update(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        contributor = _add_user(
            connection, seeded["organization_id"], "contributor@example.com", "CONTRIBUTOR"
        )
    owner = _client(migrated, seeded["user_id"])
    created = owner.post(
        f"/organizations/{seeded['organization_id']}/projects",
        json=_create(seeded["user_id"]),
    )
    assert created.status_code == 201
    project_id = created.json()["id"]
    with connect(migrated.url) as connection:
        _add_project_member(connection, seeded["organization_id"], UUID(project_id), contributor)
    reviewer_client = _client(migrated, reviewer)
    assert (
        reviewer_client.get(
            f"/organizations/{seeded['organization_id']}/assignable-members"
        ).status_code
        == 403
    )
    refused = reviewer_client.post(
        f"/organizations/{seeded['organization_id']}/projects",
        json=_create(reviewer),
    )
    assert refused.status_code == 403
    contributor_client = _client(migrated, contributor)
    updated = contributor_client.patch(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}",
        json={**_edit(created.json()), "name": "Changed", "version": 1},
    )
    assert updated.status_code == 403


def test_duplicate_slug_stale_version_and_foreign_owner_are_rejected(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        home = _seed_org(connection, "acme", "owner-a@example.com")
        other = _seed_org(connection, "beta", "owner-b@example.com")
    client = _client(migrated, home["user_id"])
    first = client.post(
        f"/organizations/{home['organization_id']}/projects",
        json=_create(home["user_id"]),
    )
    assert first.status_code == 201
    duplicate = client.post(
        f"/organizations/{home['organization_id']}/projects",
        json=_create(home["user_id"]),
    )
    assert duplicate.status_code == 409
    stale = client.patch(
        f"/organizations/{home['organization_id']}/projects/{first.json()['id']}",
        json={**_edit(first.json()), "name": "Newer", "version": 9},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "project changed"
    foreign = client.post(
        f"/organizations/{home['organization_id']}/projects",
        json={**_create(other["user_id"]), "slug": "other-owner"},
    )
    assert foreign.status_code == 404


def test_task_counts_are_visible_on_the_project(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
    client = _client(migrated, seeded["user_id"])
    created = client.post(
        f"/organizations/{seeded['organization_id']}/projects",
        json=_create(seeded["user_id"]),
    )
    assert created.status_code == 201
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO tasks (organization_id, project_id, title)
                VALUES (%s, %s, 'Walkthrough')
                """,
                (seeded["organization_id"], created.json()["id"]),
            )
    detail = client.get(
        f"/organizations/{seeded['organization_id']}/projects/{created.json()['id']}"
    )
    assert detail.status_code == 200
    assert detail.json()["progress"] == [{"status": "DRAFT", "count": 1}]


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _create(owner_id: UUID) -> dict[str, str]:
    return {
        "name": "SOX 2026",
        "slug": "sox-2026",
        "scope": "Access reviews",
        "owner_user_id": str(owner_id),
        "status": "DRAFT",
    }


def _edit(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": body["name"],
        "slug": body["slug"],
        "scope": body["scope"],
        "owner_user_id": body["owner_user_id"],
        "status": body["status"],
        "starts_on": body["starts_on"],
        "ends_on": body["ends_on"],
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
