"""Milestone 2.5 access checks. Schema and login tests live beside this file."""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import ConcurrentUpdateError, connect, require_one_row, transaction
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def test_invalid_membership_role_and_task_status_are_rejected(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _insert_project(connection, seeded, "sox-2026")
        with pytest.raises(psycopg.errors.InvalidTextRepresentation):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO memberships (organization_id, user_id, role)
                    VALUES (%s, %s, 'SUPERUSER')
                    """,
                    (seeded["organization_id"], seeded["user_id"]),
                )
        with pytest.raises(psycopg.errors.InvalidTextRepresentation):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO tasks (organization_id, project_id, title, status)
                    VALUES (%s, %s, 'Walkthrough', 'SKIPPED')
                    """,
                    (seeded["organization_id"], project_id),
                )


def test_membership_cannot_be_duplicated(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with pytest.raises(psycopg.errors.UniqueViolation):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO memberships (organization_id, user_id, role)
                    VALUES (%s, %s, 'ADMIN')
                    """,
                    (seeded["organization_id"], seeded["user_id"]),
                )


def test_task_dependency_cannot_cross_projects(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        first = _insert_project(connection, seeded, "first")
        second = _insert_project(connection, seeded, "second")
        task_a = _insert_task(connection, seeded["organization_id"], first, "Collect")
        task_b = _insert_task(connection, seeded["organization_id"], second, "Review")
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO task_dependencies (
                        organization_id, project_id, task_id, depends_on_task_id
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (seeded["organization_id"], first, task_a, task_b),
                )


def test_task_assignee_must_belong_to_the_organization(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _insert_project(connection, seeded, "sox-2026")
        outsider = _add_user_only(connection, "outsider@example.com")
        with pytest.raises(psycopg.errors.RaiseException, match="active member"):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO tasks (organization_id, project_id, title, assignee_user_id)
                    VALUES (%s, %s, 'Walkthrough', %s)
                    """,
                    (seeded["organization_id"], project_id, outsider),
                )


def test_stale_organization_update_does_not_overwrite(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with transaction(connection) as cursor:
            cursor.execute(
                """
                UPDATE organizations
                SET name = 'Acme Audit', version = version + 1
                WHERE id = %s AND version = 1
                """,
                (seeded["organization_id"],),
            )
            require_one_row(cursor)
    with connect(migrated.url) as connection:
        with pytest.raises(ConcurrentUpdateError):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    UPDATE organizations
                    SET name = 'Lost Update', version = version + 1
                    WHERE id = %s AND version = 1
                    """,
                    (seeded["organization_id"],),
                )
                require_one_row(cursor)
        name = connection.execute(
            "SELECT name FROM organizations WHERE id = %s",
            (seeded["organization_id"],),
        ).fetchone()
    assert name == ("Acme Audit",)


def test_project_id_from_another_organization_stays_hidden(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        home = _seed_org(connection, "acme", "owner@example.com")
        other = _seed_org(connection, "beta", "other@example.com")
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO memberships (organization_id, user_id, role)
                VALUES (%s, %s, 'OWNER')
                """,
                (other["organization_id"], home["user_id"]),
            )
        project_id = _insert_project(connection, other, "sox-2026")
    client = _client(migrated, home["user_id"])
    crossed = client.get(f"/organizations/{home['organization_id']}/projects/{project_id}")
    direct = client.get(f"/organizations/{other['organization_id']}/projects/{project_id}")
    assert crossed.status_code == 404
    assert direct.status_code == 200


def test_other_tenant_memberships_are_not_listed(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        home = _seed_org(connection, "acme", "owner-a@example.com")
        other = _seed_org(connection, "beta", "owner-b@example.com")
    client = _client(migrated, home["user_id"])
    response = client.get(f"/organizations/{other['organization_id']}/memberships")
    assert response.status_code == 404


def test_contributor_cannot_change_roles(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        member = _add_user(
            connection, seeded["organization_id"], "member@example.com", "CONTRIBUTOR"
        )
        target = _add_user_only(connection, "target@example.com")
    client = _client(migrated, member)
    granted = client.post(
        f"/organizations/{seeded['organization_id']}/memberships",
        json={"user_id": str(target), "role": "ADMIN"},
    )
    changed = client.patch(
        f"/organizations/{seeded['organization_id']}/memberships/{seeded['user_id']}",
        json={"role": "CONTRIBUTOR", "status": "DISABLED", "version": 1},
    )
    assert granted.status_code == 403
    assert changed.status_code == 403


def test_disabled_membership_and_organization_lose_access(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with transaction(connection) as cursor:
            cursor.execute(
                """
                UPDATE memberships
                SET status = 'DISABLED', version = version + 1
                WHERE user_id = %s
                """,
                (seeded["user_id"],),
            )
    client = _client(migrated, seeded["user_id"])
    assert client.get("/organizations").json() == []
    assert client.get(f"/organizations/{seeded['organization_id']}/projects").status_code == 404
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                UPDATE memberships
                SET status = 'ACTIVE', version = version + 1
                WHERE user_id = %s
                """,
                (seeded["user_id"],),
            )
            cursor.execute(
                """
                UPDATE organizations
                SET status = 'DISABLED', version = version + 1
                WHERE id = %s
                """,
                (seeded["organization_id"],),
            )
    assert client.get("/organizations").json() == []
    assert client.get(f"/organizations/{seeded['organization_id']}/projects").status_code == 404


def test_user_row_cannot_be_deleted_while_referenced(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with pytest.raises(psycopg.errors.RestrictViolation):
            with transaction(connection) as cursor:
                cursor.execute("DELETE FROM users WHERE id = %s", (seeded["user_id"],))
    client = _client(migrated, seeded["user_id"])
    assert client.get("/organizations").status_code == 200
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute("DELETE FROM auth_sessions WHERE user_id = %s", (seeded["user_id"],))
            cursor.execute("DELETE FROM memberships WHERE user_id = %s", (seeded["user_id"],))
            cursor.execute("DELETE FROM users WHERE id = %s", (seeded["user_id"],))
    assert client.get("/organizations").status_code == 401


def test_membership_remains_after_a_new_app_instance(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
    raw = f"session-{seeded['user_id']}"
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO auth_sessions (user_id, token_hash, expires_at)
                VALUES (%s, %s, clock_timestamp() + interval '1 hour')
                """,
                (seeded["user_id"], token_hash(raw)),
            )
    first = TestClient(_app(migrated))
    first.cookies.set("aw_session", raw)
    assert first.get("/organizations").json()[0]["slug"] == "acme"
    second = TestClient(_app(migrated))
    second.cookies.set("aw_session", raw)
    assert second.get("/organizations").json()[0]["slug"] == "acme"


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


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


def _add_user_only(connection: psycopg.Connection[Any], email: str) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email),
        )
        row = cursor.fetchone()
    assert row is not None
    assert isinstance(row[0], UUID)
    return row[0]


def _add_user(
    connection: psycopg.Connection[Any], organization_id: UUID, email: str, role: str
) -> UUID:
    user_id = _add_user_only(connection, email)
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, %s)
            """,
            (organization_id, user_id, role),
        )
    return user_id


def _insert_project(connection: psycopg.Connection[Any], seeded: dict[str, Any], slug: str) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO projects (organization_id, name, slug, owner_user_id, status)
            VALUES (%s, %s, %s, %s, 'ACTIVE')
            RETURNING id
            """,
            (seeded["organization_id"], slug, slug, seeded["user_id"]),
        )
        row = cursor.fetchone()
    assert row is not None
    assert isinstance(row[0], UUID)
    return row[0]


def _insert_task(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, title: str
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO tasks (organization_id, project_id, title)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            (organization_id, project_id, title),
        )
        row = cursor.fetchone()
    assert row is not None
    assert isinstance(row[0], UUID)
    return row[0]
