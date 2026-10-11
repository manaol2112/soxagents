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


def test_a_running_task_records_a_versioned_result(migrated: Database) -> None:
    seeded, project_id, task_id, definition_id, client = _ready(migrated, "record")
    created = client.post(_results(seeded, project_id), json=_body(task_id, definition_id))
    assert created.status_code == 200
    body = created.json()
    assert body["schema_version"] == 1
    assert body["result_version"] == 1
    assert body["status"] == "SUCCEEDED"
    assert body["output"] == {"population": "synthetic"}
    assert body["evidence_refs"] == ["evidence/population"]
    assert body["proposed_actions"] == [{"action": "review", "reason": "Check the sample"}]
    recorded = client.get(f"{_results(seeded, project_id)}/{body['id']}")
    assert recorded.status_code == 200
    assert recorded.json()["summary"] == "Collected the population"
    listed = client.get(_results(seeded, project_id))
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [body["id"]]
    assert _task_status(migrated, task_id) == "RUNNING"
    assert _audit_payload(migrated) == {"status": "SUCCEEDED", "schema_version": 1}


def test_the_same_operation_key_does_not_create_another_version(migrated: Database) -> None:
    seeded, project_id, task_id, definition_id, client = _ready(migrated, "retry")
    first = client.post(
        _results(seeded, project_id), json=_body(task_id, definition_id, key="collect-1")
    )
    assert first.status_code == 200
    again = client.post(
        _results(seeded, project_id),
        json=_body(task_id, definition_id, key="collect-1", summary="A different summary"),
    )
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["summary"] == "Collected the population"
    second = client.post(
        _results(seeded, project_id), json=_body(task_id, definition_id, key="collect-2")
    )
    assert second.status_code == 200
    assert second.json()["result_version"] == 2
    other = _insert_task(migrated, seeded, project_id, "RUNNING")
    reused = client.post(
        _results(seeded, project_id), json=_body(other, definition_id, key="collect-1")
    )
    assert reused.status_code == 409
    assert reused.json()["detail"] == "handoff key is already in use"
    assert _count(migrated) == 2


def test_a_result_cannot_invent_completion_or_approval(migrated: Database) -> None:
    seeded, project_id, task_id, definition_id, client = _ready(migrated, "guard", status="DRAFT")
    draft = client.post(_results(seeded, project_id), json=_body(task_id, definition_id))
    assert draft.status_code == 409
    assert draft.json()["detail"] == "task cannot accept a result"
    running = _insert_task(migrated, seeded, project_id, "RUNNING")
    empty = client.post(
        _results(seeded, project_id),
        json=_body(running, definition_id, output={}),
    )
    assert empty.status_code == 422
    missing = client.post(
        _results(seeded, project_id),
        json={
            **_body(running, definition_id, key="needs-review", status="NEEDS_APPROVAL"),
            "required_approval": None,
        },
    )
    assert missing.status_code == 422
    held = client.post(
        _results(seeded, project_id),
        json={
            **_body(running, definition_id, key="needs-review", status="NEEDS_APPROVAL"),
            "required_approval": {"code": "review"},
        },
    )
    assert held.status_code == 200
    assert held.json()["required_approval"] == {"code": "review"}
    assert _task_status(migrated, running) == "RUNNING"
    assert _count(migrated) == 1


def test_secret_policy_and_stale_agent_are_not_stored(migrated: Database) -> None:
    seeded, project_id, task_id, definition_id, client = _ready(migrated, "reject")
    secret = client.post(
        _results(seeded, project_id),
        json=_body(task_id, definition_id, summary="api_key=sk-live-example"),
    )
    assert secret.status_code == 422
    assert "sk-live-example" not in secret.text
    policy = client.post(
        _results(seeded, project_id),
        json=_body(task_id, definition_id, key="mail", summary="Please send an email"),
    )
    assert policy.status_code == 422
    tool = client.post(
        _results(seeded, project_id),
        json={
            **_body(task_id, definition_id, key="tool"),
            "proposed_actions": [{"action": "execute_tool", "reason": "Run it"}],
        },
    )
    assert tool.status_code == 422
    stale = client.post(
        _results(seeded, project_id),
        json={**_body(task_id, definition_id, key="stale"), "agent_revision": 2},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "agent version does not match"
    _disable(migrated, definition_id)
    disabled = client.post(
        _results(seeded, project_id), json=_body(task_id, definition_id, key="disabled")
    )
    assert disabled.status_code == 409
    assert disabled.json()["detail"] == "disabled agent cannot submit a result"
    assert _count(migrated) == 0
    assert "sk-live-example" not in _stored_text(migrated)


def test_reviewer_can_read_and_cannot_submit(migrated: Database) -> None:
    seeded, project_id, task_id, definition_id, owner = _ready(migrated, "review")
    created = owner.post(_results(seeded, project_id), json=_body(task_id, definition_id))
    assert created.status_code == 200
    with connect(migrated.url) as connection:
        reviewer = _add_user(connection, seeded["organization_id"], "reviewer@example.com")
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
    reader = _client(migrated, reviewer)
    assert reader.get(f"{_results(seeded, project_id)}/{created.json()['id']}").status_code == 200
    denied = reader.post(
        _results(seeded, project_id), json=_body(task_id, definition_id, key="again")
    )
    assert denied.status_code == 403


def test_another_tenant_cannot_read_a_result(migrated: Database) -> None:
    first, project_id, task_id, definition_id, owner = _ready(migrated, "one")
    created = owner.post(_results(first, project_id), json=_body(task_id, definition_id))
    assert created.status_code == 200
    with connect(migrated.url) as connection:
        second = _seed_org(connection, "two", "two@example.com")
        other = _seed_project(connection, second["organization_id"], second["user_id"])
    stranger = _client(migrated, second["user_id"])
    hidden = stranger.get(f"{_results(second, other)}/{created.json()['id']}")
    assert hidden.status_code == 404


def test_worker_results_are_immutable(migrated: Database) -> None:
    seeded, project_id, task_id, definition_id, client = _ready(migrated, "fixed")
    created = client.post(_results(seeded, project_id), json=_body(task_id, definition_id))
    result_id = created.json()["id"]
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
            with transaction(connection) as cursor:
                cursor.execute(
                    "UPDATE worker_results SET summary = 'changed' WHERE id = %s",
                    (result_id,),
                )
        with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
            with transaction(connection) as cursor:
                cursor.execute("DELETE FROM worker_results WHERE id = %s", (result_id,))


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _ready(
    database: Database, slug: str, *, status: str = "RUNNING"
) -> tuple[dict[str, Any], UUID, UUID, UUID, TestClient]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug, f"{slug}@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        definition_id = _seed_definition(connection, seeded["organization_id"])
        task_id = _seed_task(connection, seeded["organization_id"], project_id, status)
    return seeded, project_id, task_id, definition_id, _client(database, seeded["user_id"])


def _body(
    task_id: UUID,
    definition_id: UUID,
    *,
    key: str = "collect-population",
    summary: str = "Collected the population",
    status: str = "SUCCEEDED",
    output: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "operation_key": key,
        "task_id": str(task_id),
        "agent_definition_id": str(definition_id),
        "agent_revision": 1,
        "status": status,
        "summary": summary,
        "output": {"population": "synthetic"} if output is None else output,
        "artifact_refs": ["artifact/population"],
        "evidence_refs": ["evidence/population"],
        "errors": [],
        "limitations": ["missing_evidence"],
        "proposed_actions": [{"action": "review", "reason": "Check the sample"}],
        "required_approval": None,
    }


def _results(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/worker-results"


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
            "INSERT INTO memberships (organization_id, user_id, role) VALUES (%s, %s, 'OWNER')",
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


def _seed_definition(connection: psycopg.Connection[Any], organization_id: UUID) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO agent_definitions (
                organization_id, agent_key, name, role, input_schema, output_schema,
                model_config_ref, max_iterations, time_budget_seconds, status
            )
            VALUES (%s, 'population-collector', 'Population collector', 'Collects a population',
                    '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb,
                    'audit-model', 2, 60, 'ACTIVE')
            RETURNING id
            """,
            (organization_id,),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None or not isinstance(row[0], UUID):
        raise RuntimeError("seed failed")
    return row[0]


def _seed_task(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, status: str
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO tasks (organization_id, project_id, title, status)
            VALUES (%s, %s, 'Collect the population', %s)
            RETURNING id
            """,
            (organization_id, project_id, status),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None or not isinstance(row[0], UUID):
        raise RuntimeError("seed failed")
    return row[0]


def _insert_task(database: Database, seeded: dict[str, Any], project_id: UUID, status: str) -> UUID:
    with connect(database.url) as connection:
        return _seed_task(connection, seeded["organization_id"], project_id, status)


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


def _disable(database: Database, definition_id: UUID) -> None:
    with connect(database.url) as connection:
        connection.execute(
            "UPDATE agent_definitions SET status = 'DISABLED' WHERE id = %s",
            (definition_id,),
        )
        connection.commit()


def _task_status(database: Database, task_id: UUID) -> str:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT status::text FROM tasks WHERE id = %s", (task_id,)
        ).fetchone()
    if row is None or not isinstance(row[0], str):
        return ""
    return row[0]


def _count(database: Database) -> int:
    with connect(database.url) as connection:
        row = connection.execute("SELECT count(*) FROM worker_results").fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _audit_payload(database: Database) -> dict[str, Any]:
    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT payload FROM audit_events
            WHERE action = 'worker.result_recorded'
            """
        ).fetchone()
    if row is None or not isinstance(row[0], dict):
        return {}
    return row[0]


def _stored_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute(
            "SELECT summary, output::text, proposed_actions::text FROM worker_results"
        ).fetchall()
    return str(rows)
