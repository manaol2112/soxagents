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
from ai_workforce_api.workflow import DurableRun, DurableUnavailable, WorkflowRunBody


def test_workflow_start_pause_signal_and_history(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    client = _client(migrated, seeded["user_id"])
    started = client.post(
        _workflows(seeded, project_id),
        json={"workflow_key": "population-request", "max_attempts": 2},
    )
    assert started.status_code == 200
    run = started.json()
    assert run["created"] is True
    assert run["status"] == "RUNNING"
    again = client.post(
        _workflows(seeded, project_id),
        json={"workflow_key": "population-request", "max_attempts": 2},
    )
    assert again.status_code == 200
    assert again.json()["id"] == run["id"]
    assert again.json()["created"] is False
    paused = client.post(_action(seeded, project_id, run["id"], "pause"), json={"version": 1})
    assert paused.status_code == 200
    assert paused.json()["status"] == "PAUSED"
    signaled = client.post(
        _action(seeded, project_id, run["id"], "signals"),
        json={
            "name": "evidence-received",
            "payload": {"count": 1},
            "version": paused.json()["version"],
        },
    )
    assert signaled.status_code == 200
    resumed = client.post(
        _action(seeded, project_id, run["id"], "resume"),
        json={"version": signaled.json()["version"]},
    )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "RUNNING"
    history = client.get(_action(seeded, project_id, run["id"], "history"))
    assert history.status_code == 200
    assert [event["event_type"] for event in history.json()] == [
        "started",
        "paused",
        "signaled",
        "resumed",
    ]


def test_failed_workflow_retries_until_policy_is_exhausted(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "retry", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    client = _client(migrated, seeded["user_id"])
    run = client.post(
        _workflows(seeded, project_id),
        json={"workflow_key": "sample-pull", "max_attempts": 2},
    ).json()
    failed = client.post(
        _action(seeded, project_id, run["id"], "finish"),
        json={"status": "FAILED", "version": run["version"]},
    )
    assert failed.status_code == 200
    retried = client.post(
        _action(seeded, project_id, run["id"], "retry"),
        json={"version": failed.json()["version"]},
    )
    assert retried.status_code == 200
    assert retried.json()["status"] == "RUNNING"
    assert retried.json()["attempt"] == 2
    failed_again = client.post(
        _action(seeded, project_id, run["id"], "finish"),
        json={"status": "FAILED", "version": retried.json()["version"]},
    )
    exhausted = client.post(
        _action(seeded, project_id, run["id"], "retry"),
        json={"version": failed_again.json()["version"]},
    )
    assert exhausted.status_code == 409
    assert exhausted.json()["detail"] == "workflow cannot change that way"
    cancelled = client.post(
        _action(seeded, project_id, run["id"], "cancel"),
        json={"version": failed_again.json()["version"]},
    )
    assert cancelled.status_code == 409


def test_cancel_stops_signals_and_stale_version_conflicts(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "cancel", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    client = _client(migrated, seeded["user_id"])
    run = client.post(_workflows(seeded, project_id), json={"workflow_key": "close-out"}).json()
    cancelled = client.post(
        _action(seeded, project_id, run["id"], "cancel"), json={"version": run["version"]}
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    signaled = client.post(
        _action(seeded, project_id, run["id"], "signals"),
        json={"name": "late", "version": cancelled.json()["version"]},
    )
    assert signaled.status_code == 409
    stale = client.post(
        _action(seeded, project_id, run["id"], "resume"), json={"version": run["version"]}
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "workflow changed"


def test_reviewer_can_read_history_but_cannot_start(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "review", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
    owner = _client(migrated, seeded["user_id"])
    run = owner.post(_workflows(seeded, project_id), json={"workflow_key": "walkthrough"}).json()
    reader = _client(migrated, reviewer)
    listed = reader.get(_action(seeded, project_id, run["id"], ""))
    assert listed.status_code == 200
    history = reader.get(_action(seeded, project_id, run["id"], "history"))
    assert history.status_code == 200
    denied = reader.post(_workflows(seeded, project_id), json={"workflow_key": "other"})
    assert denied.status_code == 403


def test_other_tenant_and_foreign_task_are_hidden(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        first = _seed_org(connection, "one", "one@example.com")
        second = _seed_org(connection, "two", "two@example.com")
        project_id = _seed_project(connection, first["organization_id"], first["user_id"])
        other_project = _seed_project(connection, second["organization_id"], second["user_id"])
        task_id = _seed_task(connection, second["organization_id"], other_project)
    client = _client(migrated, first["user_id"])
    hidden = client.post(
        _workflows(second, other_project),
        json={"workflow_key": "foreign"},
    )
    assert hidden.status_code == 404
    missing_task = client.post(
        _workflows(first, project_id),
        json={"workflow_key": "local", "task_id": str(task_id)},
    )
    assert missing_task.status_code == 404
    secret = client.post(
        _workflows(first, project_id),
        json={"workflow_key": "safe"},
    )
    assert secret.status_code == 200
    leaked = client.post(
        _action(first, project_id, secret.json()["id"], "signals"),
        json={
            "name": "note",
            "payload": {"note": "api_key=sk-live-example"},
            "version": secret.json()["version"],
        },
    )
    assert leaked.status_code == 422


def test_start_keeps_the_run_when_durable_execution_is_down(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "down", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])

    class Down:
        def attach(
            self,
            run: WorkflowRunBody,
            organization_id: UUID,
            project_id: UUID,
            timer_seconds: int,
        ) -> None:
            raise DurableUnavailable()

    client = _client(migrated, seeded["user_id"], durable=Down())
    started = client.post(
        _workflows(seeded, project_id),
        json={"workflow_key": "population", "timer_seconds": 30},
    )
    assert started.status_code == 503
    assert started.json()["detail"] == "workflow execution is unavailable"


def test_workflow_module_does_not_import_temporal() -> None:
    source = (Path(__file__).parents[1] / "ai_workforce_api" / "workflow.py").read_text(
        encoding="utf-8"
    )
    assert "temporalio" not in source
    assert "import temporal" not in source


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _workflows(seeded: dict[str, Any], project_id: UUID) -> str:
    organization_id = seeded["organization_id"]
    return f"/organizations/{organization_id}/projects/{project_id}/workflows"


def _action(seeded: dict[str, Any], project_id: UUID, workflow_id: str, name: str) -> str:
    suffix = f"/{name}" if name else ""
    return f"{_workflows(seeded, project_id)}/{workflow_id}{suffix}"


def _client(database: Database, user_id: UUID, durable: DurableRun | None = None) -> TestClient:
    settings = Settings(
        database_url=database.url,
        app_base_url="http://localhost:3000",
        session_cookie_secure=False,
        workflow_address="",
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
    return TestClient(create_app(settings, durable=durable), cookies={"aw_session": token})


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
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, 'OWNER')
            """,
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


def _seed_task(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO tasks (organization_id, project_id, title)
            VALUES (%s, %s, 'Foreign task')
            RETURNING id
            """,
            (organization_id, project_id),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None or not isinstance(row[0], UUID):
        raise RuntimeError("seed failed")
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
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
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
