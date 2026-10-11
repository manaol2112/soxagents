from typing import Any

import psycopg
import pytest
from support import Database

from ai_workforce_api.db import connect, require_one_row, transaction
from ai_workforce_api.migrate import apply_migrations, migrations_dir


@pytest.fixture
def database(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def test_same_project_slug_is_unique_inside_one_organization(database: Database) -> None:
    with connect(database.url) as connection:
        left = _seed_org(connection, "acme", "owner-a@example.com")
        right = _seed_org(connection, "beta", "owner-b@example.com")
        _insert_project(connection, left, "sox-2026")
        _insert_project(connection, right, "sox-2026")
        with pytest.raises(psycopg.errors.UniqueViolation):
            with transaction(connection) as cursor:
                _insert_project(cursor, left, "sox-2026")


def test_invalid_project_status_is_rejected(database: Database) -> None:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with pytest.raises(psycopg.errors.InvalidTextRepresentation):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO projects (organization_id, name, slug, owner_user_id, status)
                    VALUES (%s, 'Engagement', 'engagement', %s, 'DELETED')
                    """,
                    (seeded["organization_id"], seeded["user_id"]),
                )


def test_project_owner_must_be_an_active_member(database: Database) -> None:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, display_name)
                VALUES ('outsider@example.com', 'Outsider')
                RETURNING id
                """
            )
            outsider = cursor.fetchone()
        assert outsider is not None
        with pytest.raises(psycopg.errors.RaiseException, match="active member"):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO projects (organization_id, name, slug, owner_user_id)
                    VALUES (%s, 'Engagement', 'engagement', %s)
                    """,
                    (seeded["organization_id"], outsider[0]),
                )


def test_project_membership_cannot_cross_organizations(database: Database) -> None:
    with connect(database.url) as connection:
        left = _seed_org(connection, "acme", "owner-a@example.com")
        right = _seed_org(connection, "beta", "owner-b@example.com")
        project_id = _insert_project(connection, left, "sox-2026")
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO project_memberships (organization_id, project_id, user_id)
                    VALUES (%s, %s, %s)
                    """,
                    (right["organization_id"], project_id, right["user_id"]),
                )


def test_email_uniqueness_is_case_insensitive(database: Database) -> None:
    with connect(database.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                "INSERT INTO users (email, display_name) VALUES ('Owner@example.com', 'Owner')"
            )
        with pytest.raises(psycopg.errors.UniqueViolation):
            with transaction(connection) as cursor:
                cursor.execute(
                    "INSERT INTO users (email, display_name) VALUES ('owner@example.com', 'Other')"
                )


def test_task_dependency_cycle_is_rejected(database: Database) -> None:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _insert_project(connection, seeded, "sox-2026")
        first = _insert_task(connection, seeded, project_id, "Collect evidence")
        second = _insert_task(connection, seeded, project_id, "Test control")
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO task_dependencies (
                    organization_id, project_id, task_id, depends_on_task_id
                )
                VALUES (%s, %s, %s, %s)
                """,
                (seeded["organization_id"], project_id, second, first),
            )
        with pytest.raises(psycopg.errors.RaiseException, match="cycle"):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO task_dependencies (
                        organization_id, project_id, task_id, depends_on_task_id
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (seeded["organization_id"], project_id, first, second),
                )


def test_task_cannot_depend_on_itself(database: Database) -> None:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _insert_project(connection, seeded, "sox-2026")
        task_id = _insert_task(connection, seeded, project_id, "Collect evidence")
        with pytest.raises(psycopg.errors.RaiseException, match="cycle"):
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO task_dependencies (
                        organization_id, project_id, task_id, depends_on_task_id
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (seeded["organization_id"], project_id, task_id, task_id),
                )


def test_audit_events_reject_updates_and_deletes(database: Database) -> None:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO audit_events (organization_id, actor_user_id, action)
                VALUES (%s, %s, 'project.created')
                RETURNING id
                """,
                (seeded["organization_id"], seeded["user_id"]),
            )
            event = cursor.fetchone()
        assert event is not None
        with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
            with transaction(connection) as cursor:
                cursor.execute(
                    "UPDATE audit_events SET action = 'project.changed' WHERE id = %s",
                    (event[0],),
                )
        with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
            with transaction(connection) as cursor:
                cursor.execute("DELETE FROM audit_events WHERE id = %s", (event[0],))


def test_organization_delete_is_restricted_when_a_project_exists(database: Database) -> None:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        _insert_project(connection, seeded, "sox-2026")
        with transaction(connection) as cursor:
            cursor.execute(
                "DELETE FROM memberships WHERE organization_id = %s",
                (seeded["organization_id"],),
            )
        with pytest.raises(psycopg.errors.RestrictViolation):
            with transaction(connection) as cursor:
                cursor.execute(
                    "DELETE FROM organizations WHERE id = %s",
                    (seeded["organization_id"],),
                )


def test_organization_update_uses_the_version_column(database: Database) -> None:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with transaction(connection) as cursor:
            cursor.execute(
                """
                UPDATE organizations
                SET name = 'Acme Audit', version = version + 1
                WHERE id = %s AND version = 1
                RETURNING version
                """,
                (seeded["organization_id"],),
            )
            require_one_row(cursor)
            updated = cursor.fetchone()
        assert updated == (2,)


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


def _insert_project(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any],
    seeded: dict[str, Any],
    slug: str,
) -> Any:
    def insert(cursor: psycopg.Cursor[Any]) -> Any:
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
        return row[0]

    if isinstance(connection, psycopg.Cursor):
        return insert(connection)
    with transaction(connection) as cursor:
        return insert(cursor)


def _insert_task(
    connection: psycopg.Connection[Any],
    seeded: dict[str, Any],
    project_id: Any,
    title: str,
) -> Any:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO tasks (organization_id, project_id, title)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            (seeded["organization_id"], project_id, title),
        )
        row = cursor.fetchone()
    assert row is not None
    return row[0]
