from pathlib import Path
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


def test_an_authorized_action_runs_once(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "run")
    with connect(migrated.url) as connection:
        admin = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
        contributor = _add_user(
            connection, seeded["organization_id"], "contributor@example.com", "CONTRIBUTOR"
        )
    before = _count(migrated, "tasks")
    created = client.post(
        _execute(seeded, project_id),
        json={"action_id": "task.create", "parameters": {"title": "Prepare the population"}},
    )
    assert created.status_code == 200
    assert created.json()["status"] == "SUCCEEDED"
    assert created.json()["approval_id"] is None
    assert created.json()["reason"] is None
    repeat = client.post(
        _execute(seeded, project_id),
        json={"action_id": "task.create", "parameters": {"title": "Prepare the population"}},
    )
    assert repeat.json()["id"] == created.json()["id"]
    assert _count(migrated, "tasks") == before + 1
    reading = client.post(
        _execute(seeded, project_id),
        json={"action_id": "file.read", "parameters": {"resource_ref": "evidence/population"}},
    )
    assert reading.status_code == 200
    assert reading.json()["status"] == "SUCCEEDED"
    assert reading.json()["result_ref"] == "evidence/population"
    assert "content" not in reading.json()
    admin_client = _client(migrated, admin)
    change = _approved(
        client,
        admin_client,
        seeded,
        project_id,
        {
            "action_id": "permission.modify",
            "parameters": {"target_user_ref": f"user/{contributor}", "role": "REVIEWER"},
        },
    )
    performed = client.post(_execute(seeded, project_id), json=change)
    assert performed.status_code == 200
    assert performed.json()["status"] == "SUCCEEDED"
    assert _role(migrated, contributor) == "REVIEWER"
    again = client.post(_execute(seeded, project_id), json=change)
    assert again.json()["id"] == performed.json()["id"]
    assert _role(migrated, contributor) == "REVIEWER"
    protected = _approved(
        client,
        admin_client,
        seeded,
        project_id,
        {
            "action_id": "permission.modify",
            "parameters": {"target_user_ref": f"user/{admin}", "role": "CONTRIBUTOR"},
        },
    )
    blocked = client.post(_execute(seeded, project_id), json=protected)
    assert blocked.status_code == 200
    assert blocked.json()["status"] == "REFUSED"
    assert blocked.json()["reason"] == "protected_role"
    assert _role(migrated, admin) == "ADMIN"
    assert client.get("/health").json()["live_email_enabled"] is False
    source = (Path(__file__).parents[1] / "ai_workforce_api" / "execution.py").read_text()
    assert "smtplib" not in source
    assert "msal" not in source


def test_closed_approvals_do_not_perform_an_action(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "closed")
    with connect(migrated.url) as connection:
        admin = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
        other = _seed_org(connection, "other")
    admin_client = _client(migrated, admin)
    missing = client.post(
        _execute(seeded, project_id),
        json=_external("outside@example.com"),
    )
    assert missing.status_code == 409
    assert missing.json()["detail"] == "approval is required"
    assert _count(migrated, "action_executions") == 0
    draft = client.post(
        _execute(seeded, project_id),
        json={
            "action_id": "mail.draft",
            "parameters": {"recipient": "draft@example.com", "subject": "Population request"},
        },
    )
    assert draft.status_code == 200
    assert draft.json()["status"] == "SUCCEEDED"
    assert draft.json()["reason"] is None
    assert draft.json()["result_ref"].startswith("mock-")
    approved = _approved(client, admin_client, seeded, project_id, _external("outside@example.com"))
    sent = client.post(_execute(seeded, project_id), json=approved)
    assert sent.status_code == 200
    assert sent.json()["status"] == "SUCCEEDED"
    assert sent.json()["result_ref"].startswith("mock-")
    stored = client.get(f"{_approvals(seeded, project_id)}/{approved['approval_id']}")
    assert stored.json()["execution_status"] == "SUCCEEDED"
    repeat = client.post(_execute(seeded, project_id), json=approved)
    assert repeat.json()["id"] == sent.json()["id"]
    assert _count(migrated, "action_executions") == 2
    assert _count(migrated, "mailbox_messages") == 2
    changed = client.post(
        _execute(seeded, project_id),
        json={**_external("changed@example.com"), "approval_id": approved["approval_id"]},
    )
    assert changed.status_code == 409
    assert changed.json()["detail"] == "approval does not match"
    rejected = _approved(
        client, admin_client, seeded, project_id, _external("rejected@example.com"), "REJECTED"
    )
    denied = client.post(_execute(seeded, project_id), json=rejected)
    assert denied.status_code == 409
    assert denied.json()["detail"] == "approval is not approved"
    expired_id = _insert_expired(migrated, seeded, project_id)
    expired = client.post(
        _execute(seeded, project_id),
        json={**_external("late@example.com"), "approval_id": str(expired_id)},
    )
    assert expired.status_code == 409
    assert expired.json()["detail"] == "approval has expired"
    held = _approved(client, admin_client, seeded, project_id, _external("held@example.com"))
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO action_restrictions (organization_id, action_id)
            VALUES (%s, 'mail.external')
            """,
            (seeded["organization_id"],),
        )
        connection.commit()
    blocked = client.post(_execute(seeded, project_id), json=held)
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "action is not allowed"
    held_row = client.get(f"{_approvals(seeded, project_id)}/{held['approval_id']}")
    assert held_row.json()["execution_status"] == "NOT_STARTED"
    secret = client.post(
        _execute(seeded, project_id),
        json=_external("outside@example.com", subject="api_key=sk-live-example"),
    )
    assert secret.status_code == 422
    assert "sk-live-example" not in _stored_text(migrated)
    paper = _approved(
        client,
        admin_client,
        seeded,
        project_id,
        {
            "action_id": "workpaper.update",
            "parameters": {"workpaper_ref": "workpaper/population", "change_summary": "Sample"},
        },
    )
    refused = client.post(_execute(seeded, project_id), json=paper)
    assert refused.status_code == 200
    assert refused.json()["status"] == "REFUSED"
    assert refused.json()["reason"] == "not_available"
    reader = _client(migrated, reviewer)
    assert (
        reader.post(
            _execute(seeded, project_id),
            json={"action_id": "task.create", "parameters": {"title": "Prepare the population"}},
        ).status_code
        == 403
    )
    foreign = client.post(
        f"/organizations/{other['organization_id']}/projects/{uuid4()}/actions/execute",
        json={"action_id": "task.create", "parameters": {"title": "Prepare the population"}},
    )
    assert foreign.status_code == 404
    anonymous = TestClient(
        create_app(Settings(database_url=migrated.url, session_cookie_secure=False))
    )
    assert (
        anonymous.post(
            _execute(seeded, project_id), json=_external("outside@example.com")
        ).status_code
        == 401
    )
    assert "outside@example.com" not in _audit_text(migrated)


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _approved(
    client: TestClient,
    admin: TestClient,
    seeded: dict[str, Any],
    project_id: UUID,
    body: dict[str, Any],
    decision: str = "APPROVED",
) -> dict[str, Any]:
    requested = client.post(_approvals(seeded, project_id), json=body)
    assert requested.status_code == 200
    decided = admin.post(
        f"{_approvals(seeded, project_id)}/{requested.json()['id']}/decision",
        json={"decision": decision, "reason": "Checked"},
    )
    assert decided.status_code == 200
    return {**body, "approval_id": requested.json()["id"]}


def _external(recipient: str, subject: str = "Population request") -> dict[str, Any]:
    return {
        "action_id": "mail.external",
        "parameters": {"recipient": recipient, "subject": subject},
    }


def _execute(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/actions/execute"


def _approvals(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/approvals"


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


def _count(database: Database, table: str) -> int:
    query = {
        "tasks": "SELECT count(*) FROM tasks",
        "action_executions": "SELECT count(*) FROM action_executions",
        "mailbox_messages": "SELECT count(*) FROM mailbox_messages",
    }[table]
    with connect(database.url) as connection:
        row = connection.execute(query).fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _role(database: Database, user_id: UUID) -> str:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT role::text FROM memberships WHERE user_id = %s", (user_id,)
        ).fetchone()
    if row is None or not isinstance(row[0], str):
        return ""
    return row[0]


def _stored_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT payload::text FROM audit_events
            UNION ALL
            SELECT parameters::text FROM approvals
            UNION ALL
            SELECT coalesce(result_ref, '') || coalesce(reason, '') FROM action_executions
            """
        ).fetchall()
    return str(rows)


def _audit_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT payload::text FROM audit_events").fetchall()
    return str(rows)
