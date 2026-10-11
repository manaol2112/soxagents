from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import token_hash
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    authorize,
    grant_membership,
    update_membership,
)
from ai_workforce_api.authorization import Role as MembershipRole
from ai_workforce_api.db import ConcurrentUpdateError, connect, transaction
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def test_organizations_require_a_session(migrated: Database) -> None:
    client = TestClient(_app(migrated))
    assert client.get("/organizations").status_code == 401


def test_organization_list_ignores_a_client_supplied_tenant(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        left = _seed_org(connection, "acme", "owner-a@example.com")
        right = _seed_org(connection, "beta", "owner-b@example.com")
    client = _client(migrated, left["user_id"])
    response = client.get(
        "/organizations", params={"organization_id": str(right["organization_id"])}
    )
    assert response.status_code == 200
    assert [row["slug"] for row in response.json()] == ["acme"]


def test_other_tenant_projects_are_not_visible(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        left = _seed_org(connection, "acme", "owner-a@example.com")
        right = _seed_org(connection, "beta", "owner-b@example.com")
        project_id = _insert_project(connection, right, "sox-2026")
    client = _client(migrated, left["user_id"])
    listing = client.get(f"/organizations/{right['organization_id']}/projects")
    detail = client.get(f"/organizations/{right['organization_id']}/projects/{project_id}")
    assert listing.status_code == 404
    assert detail.status_code == 404


def test_project_membership_limits_reads_inside_one_tenant(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        visible = _insert_project(connection, seeded, "visible")
        hidden = _insert_project(connection, seeded, "hidden")
        member = _add_user(
            connection, seeded["organization_id"], "member@example.com", "CONTRIBUTOR"
        )
        _add_project_member(connection, seeded["organization_id"], visible, member)
    client = _client(migrated, member)
    listing = client.get(f"/organizations/{seeded['organization_id']}/projects")
    assert listing.status_code == 200
    assert [row["slug"] for row in listing.json()] == ["visible"]
    hidden_response = client.get(f"/organizations/{seeded['organization_id']}/projects/{hidden}")
    assert hidden_response.status_code == 404
    owner = _client(migrated, seeded["user_id"])
    owner_listing = owner.get(f"/organizations/{seeded['organization_id']}/projects")
    assert [row["slug"] for row in owner_listing.json()] == ["hidden", "visible"]


def test_users_cannot_grant_their_own_membership(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
    client = _client(migrated, seeded["user_id"])
    response = client.post(
        f"/organizations/{seeded['organization_id']}/memberships",
        json={"user_id": str(seeded["user_id"]), "role": "ADMIN"},
    )
    assert response.status_code == 403
    changed = client.patch(
        f"/organizations/{seeded['organization_id']}/memberships/{seeded['user_id']}",
        json={"role": "ADMIN", "status": "ACTIVE", "version": 1},
    )
    assert changed.status_code == 403
    with connect(migrated.url) as connection:
        role = connection.execute(
            "SELECT role::text FROM memberships WHERE user_id = %s",
            (seeded["user_id"],),
        ).fetchone()
    assert role == ("OWNER",)


def test_admin_cannot_grant_owner_and_owner_can_grant_contributor(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        admin = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
        target = _add_user_only(connection, "target@example.com")
    admin_client = _client(migrated, admin)
    refused = admin_client.post(
        f"/organizations/{seeded['organization_id']}/memberships",
        json={"user_id": str(target), "role": "OWNER"},
    )
    assert refused.status_code == 403
    owner_client = _client(migrated, seeded["user_id"])
    granted = owner_client.post(
        f"/organizations/{seeded['organization_id']}/memberships",
        json={"user_id": str(target), "role": "CONTRIBUTOR"},
    )
    assert granted.status_code == 201
    assert granted.json()["role"] == "CONTRIBUTOR"
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT action, payload->>'role' FROM audit_events WHERE organization_id = %s",
            (seeded["organization_id"],),
        ).fetchone()
    assert audit == ("membership.grant", "CONTRIBUTOR")


def test_contributor_cannot_read_memberships(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        member = _add_user(
            connection, seeded["organization_id"], "member@example.com", "CONTRIBUTOR"
        )
    client = _client(migrated, member)
    response = client.get(f"/organizations/{seeded['organization_id']}/memberships")
    assert response.status_code == 403


def test_admin_cannot_change_an_owner(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        other = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
    client = _client(migrated, other)
    response = client.patch(
        f"/organizations/{seeded['organization_id']}/memberships/{seeded['user_id']}",
        json={"role": "ADMIN", "status": "ACTIVE", "version": 1},
    )
    assert response.status_code == 403


def test_disabled_user_loses_tenant_access(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE users SET status = 'DISABLED', version = version + 1 WHERE id = %s",
                (seeded["user_id"],),
            )
    client = _client(migrated, seeded["user_id"])
    assert client.get("/organizations").json() == []
    assert client.get(f"/organizations/{seeded['organization_id']}/projects").status_code == 404


def test_agent_cannot_grant_a_role(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        target = _add_user_only(connection, "target@example.com")
        with pytest.raises(AccessDenied):
            grant_membership(
                connection,
                principal=Principal(kind=PrincipalKind.AGENT, id=uuid4()),
                organization_id=seeded["organization_id"],
                target_user_id=target,
                role=MembershipRole.OWNER,
            )


def test_reviewer_can_read_a_task_and_cannot_update_it(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _insert_project(connection, seeded, "sox-2026")
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
        principal = Principal(kind=PrincipalKind.USER, id=reviewer)
        access = authorize(
            connection,
            principal=principal,
            action=Action.TASK_READ,
            organization_id=seeded["organization_id"],
            project_id=project_id,
        )
        assert access.role is MembershipRole.REVIEWER
        with pytest.raises(AccessDenied):
            authorize(
                connection,
                principal=principal,
                action=Action.TASK_UPDATE,
                organization_id=seeded["organization_id"],
                project_id=project_id,
            )


def test_stale_membership_version_is_rejected(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        second = _add_user(connection, seeded["organization_id"], "second@example.com", "OWNER")
        member = _add_user(
            connection, seeded["organization_id"], "member@example.com", "CONTRIBUTOR"
        )
        with pytest.raises(ConcurrentUpdateError):
            update_membership(
                connection,
                principal=Principal(kind=PrincipalKind.USER, id=second),
                organization_id=seeded["organization_id"],
                target_user_id=member,
                role=MembershipRole.REVIEWER,
                status="ACTIVE",
                version=99,
            )


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


def test_missing_project_is_not_visible_to_a_member(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        with pytest.raises(NotVisible):
            authorize(
                connection,
                principal=Principal(kind=PrincipalKind.USER, id=seeded["user_id"]),
                action=Action.PROJECT_READ,
                organization_id=seeded["organization_id"],
                project_id=uuid4(),
            )
