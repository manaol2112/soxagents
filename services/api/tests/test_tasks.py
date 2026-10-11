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


def test_task_moves_through_legal_states_and_records_history(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        contributor = _add_user(
            connection, seeded["organization_id"], "worker@example.com", "CONTRIBUTOR"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, contributor)
    client = _client(migrated, seeded["user_id"])
    created = client.post(_tasks(seeded, project_id), json=_task("Collect population"))
    assert created.status_code == 201
    body = created.json()
    assert body["activity"][0]["action"] == "task.created"
    task_id = body["id"]
    assigned = client.patch(
        f"{_tasks(seeded, project_id)}/{task_id}",
        json={**_edit(body), "assignee_user_id": str(contributor), "version": body["version"]},
    )
    assert assigned.status_code == 200
    assert assigned.json()["assignee_user_id"] == str(contributor)
    assert assigned.json()["activity"][0]["action"] == "task.assigned"
    ready = _move(client, seeded, project_id, assigned.json(), "READY")
    queued = _move(client, seeded, project_id, ready, "QUEUED")
    running = _move(client, seeded, project_id, queued, "RUNNING")
    skipped = client.patch(
        f"{_tasks(seeded, project_id)}/{task_id}",
        json={**_edit(running), "status": "DRAFT", "version": running["version"]},
    )
    assert skipped.status_code == 409
    blocked = client.patch(
        f"{_tasks(seeded, project_id)}/{task_id}",
        json={**_edit(running), "status": "BLOCKED", "blocker": "", "version": running["version"]},
    )
    assert blocked.status_code == 409
    failed = _move(client, seeded, project_id, running, "FAILED")
    cancelled = client.patch(
        f"{_tasks(seeded, project_id)}/{task_id}",
        json={
            **_edit(failed),
            "operation": "cancel",
            "cancellation_reason": "Scope changed",
            "version": failed["version"],
        },
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    reopened = client.patch(
        f"{_tasks(seeded, project_id)}/{task_id}",
        json={**_edit(cancelled.json()), "status": "READY", "version": cancelled.json()["version"]},
    )
    assert reopened.status_code == 409
    restored = client.patch(
        f"{_tasks(seeded, project_id)}/{task_id}",
        json={
            **_edit(cancelled.json()),
            "operation": "reactivate",
            "version": cancelled.json()["version"],
        },
    )
    assert restored.status_code == 200
    assert restored.json()["status"] == "DRAFT"
    assert restored.json()["activity"][0]["action"] == "task.reactivated"


def test_retry_is_limited_and_dependencies_cannot_cycle(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    client = _client(migrated, seeded["user_id"])
    first = client.post(_tasks(seeded, project_id), json={**_task("First"), "max_retries": 1})
    second = client.post(_tasks(seeded, project_id), json=_task("Second"))
    assert first.status_code == 201
    assert second.status_code == 201
    linked = client.patch(
        f"{_tasks(seeded, project_id)}/{second.json()['id']}",
        json={
            **_edit(second.json()),
            "depends_on_task_ids": [first.json()["id"]],
            "version": second.json()["version"],
        },
    )
    assert linked.status_code == 200
    cycle = client.patch(
        f"{_tasks(seeded, project_id)}/{first.json()['id']}",
        json={
            **_edit(first.json()),
            "depends_on_task_ids": [second.json()["id"]],
            "version": first.json()["version"],
        },
    )
    assert cycle.status_code == 409
    assert cycle.json()["detail"] == "task dependency is not allowed"
    failed = _fail(client, seeded, project_id, first.json())
    retried = client.patch(
        f"{_tasks(seeded, project_id)}/{failed['id']}",
        json={**_edit(failed), "operation": "retry", "version": failed["version"]},
    )
    assert retried.status_code == 200
    assert retried.json()["status"] == "READY"
    assert retried.json()["retry_count"] == 1
    failed_again = _fail(client, seeded, project_id, retried.json())
    exhausted = client.patch(
        f"{_tasks(seeded, project_id)}/{failed_again['id']}",
        json={**_edit(failed_again), "operation": "retry", "version": failed_again["version"]},
    )
    assert exhausted.status_code == 409
    assert exhausted.json()["detail"] == "task has no retries remaining"


def test_reviewer_cannot_write_and_a_disabled_agent_cannot_be_assigned(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        other = _seed_org(connection, "beta", "beta@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
        instance_id = _disabled_instance(
            connection, seeded["organization_id"], project_id, seeded["user_id"]
        )
    owner = _client(migrated, seeded["user_id"])
    created = owner.post(_tasks(seeded, project_id), json=_task("Assigned work"))
    assert created.status_code == 201
    reviewer_client = _client(migrated, reviewer)
    listed = reviewer_client.get(_tasks(seeded, project_id))
    assert listed.status_code == 200
    denied = reviewer_client.post(_tasks(seeded, project_id), json=_task("Reviewer task"))
    assert denied.status_code == 403
    project = f"/organizations/{seeded['organization_id']}/projects/{project_id}"
    assert reviewer_client.get(f"{project}/task-assignees").status_code == 403
    hidden = owner.get(_tasks(other, project_id))
    assert hidden.status_code == 404
    assigned = owner.post(
        _tasks(seeded, project_id),
        json={**_task("Agent work"), "agent_instance_id": str(instance_id)},
    )
    assert assigned.status_code == 409
    assert assigned.json()["detail"] == "task cannot be assigned to that agent"
    stale = owner.patch(
        f"{_tasks(seeded, project_id)}/{created.json()['id']}",
        json={**_edit(created.json()), "version": 99},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "task changed"


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _tasks(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/tasks"


def _task(title: str) -> dict[str, Any]:
    return {
        "title": title,
        "description": "Prepare the sample.",
        "priority": "HIGH",
        "status": "DRAFT",
        "artifact_refs": ["evidence/population"],
    }


def _edit(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": body["title"],
        "description": body["description"],
        "priority": body["priority"],
        "status": body["status"],
        "assignee_user_id": body["assignee_user_id"],
        "agent_instance_id": body["agent_instance_id"],
        "max_retries": body["max_retries"],
        "blocker": body["blocker"] or "",
        "escalation": body["escalation"] or "",
        "cancellation_reason": body["cancellation_reason"] or "",
        "artifact_refs": body["artifact_refs"],
        "depends_on_task_ids": [item["id"] for item in body["depends_on"]],
        "operation": "save",
    }


def _move(
    client: TestClient, seeded: dict[str, Any], project_id: UUID, body: dict[str, Any], status: str
) -> dict[str, Any]:
    response = client.patch(
        f"{_tasks(seeded, project_id)}/{body['id']}",
        json={**_edit(body), "status": status, "version": body["version"]},
    )
    assert response.status_code == 200
    result: dict[str, Any] = response.json()
    return result


def _fail(
    client: TestClient, seeded: dict[str, Any], project_id: UUID, body: dict[str, Any]
) -> dict[str, Any]:
    ready = _move(client, seeded, project_id, body, "READY")
    queued = _move(client, seeded, project_id, ready, "QUEUED")
    running = _move(client, seeded, project_id, queued, "RUNNING")
    return _move(client, seeded, project_id, running, "FAILED")


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


def _disabled_instance(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, user_id: UUID
) -> UUID:
    del user_id
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO agent_definitions (
                organization_id, agent_key, name, role, input_schema, output_schema,
                model_config_ref, max_iterations, time_budget_seconds, status
            )
            VALUES (%s, 'control-tester', 'Control tester', 'Tests a control',
                    '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb,
                    'audit-model', 2, 60, 'ACTIVE')
            RETURNING id
            """,
            (organization_id,),
        )
        definition = cursor.fetchone()
        assert definition is not None
        cursor.execute(
            """
            INSERT INTO agent_instances (
                organization_id, project_id, agent_definition_id, definition_revision, status
            )
            VALUES (%s, %s, %s, 1, 'RUNNING')
            RETURNING id
            """,
            (organization_id, project_id, definition[0]),
        )
        instance = cursor.fetchone()
        assert instance is not None
        cursor.execute(
            """
            UPDATE agent_definitions
            SET status = 'DISABLED', revision = revision + 1, version = version + 1
            WHERE id = %s
            """,
            (definition[0],),
        )
    assert isinstance(instance[0], UUID)
    return instance[0]
