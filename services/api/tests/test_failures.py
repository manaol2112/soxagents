from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from temporalio.client import Client, WorkflowFailureError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.durable import TASK_QUEUE, activities_for
from ai_workforce_api.durable_workflow import DurableEffectWorkflow, EffectRequest
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def test_a_task_starts_only_after_its_predecessor_succeeds(migrated: Database) -> None:
    seeded, project_id, client = _workspace(migrated, "order")
    first = client.post(_tasks(seeded, project_id), json=_task("Collect the population")).json()
    second = client.post(_tasks(seeded, project_id), json=_task("Review the sample")).json()
    linked = client.patch(
        f"{_tasks(seeded, project_id)}/{second['id']}",
        json={**_edit(second), "depends_on_task_ids": [first["id"]], "version": second["version"]},
    )
    assert linked.status_code == 200
    ready = _move(client, seeded, project_id, linked.json(), "READY")
    blocked = client.patch(
        f"{_tasks(seeded, project_id)}/{second['id']}",
        json={**_edit(ready), "status": "QUEUED", "version": ready["version"]},
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "task dependency has not succeeded"
    finished = _advance(client, seeded, project_id, first, "SUCCEEDED")
    assert finished["status"] == "SUCCEEDED"
    queued = _move(client, seeded, project_id, ready, "QUEUED")
    running = _move(client, seeded, project_id, queued, "RUNNING")
    assert running["status"] == "RUNNING"
    exhausted = client.patch(
        f"{_tasks(seeded, project_id)}/{finished['id']}",
        json={**_edit(finished), "operation": "retry", "version": finished["version"]},
    )
    assert exhausted.status_code == 409
    assert _task_count(migrated, project_id) == 2


def test_a_restarted_api_keeps_one_workflow_after_duplicate_start(migrated: Database) -> None:
    seeded, project_id, client = _workspace(migrated, "restart")
    started = client.post(
        _workflows(seeded, project_id),
        json={"workflow_key": "population-request", "max_attempts": 2},
    )
    assert started.status_code == 200
    restarted = _client(migrated, seeded["user_id"])
    kept = restarted.get(f"{_workflows(seeded, project_id)}/{started.json()['id']}")
    assert kept.status_code == 200
    assert kept.json()["status"] == "RUNNING"
    duplicate = restarted.post(
        _workflows(seeded, project_id),
        json={"workflow_key": "population-request", "max_attempts": 2},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == started.json()["id"]
    assert duplicate.json()["created"] is False
    failed = restarted.post(
        f"{_workflows(seeded, project_id)}/{started.json()['id']}/finish",
        json={"status": "FAILED", "version": kept.json()["version"]},
    )
    retried = restarted.post(
        f"{_workflows(seeded, project_id)}/{started.json()['id']}/retry",
        json={"version": failed.json()["version"]},
    )
    assert retried.status_code == 200
    failed_again = restarted.post(
        f"{_workflows(seeded, project_id)}/{started.json()['id']}/finish",
        json={"status": "FAILED", "version": retried.json()["version"]},
    )
    exhausted = restarted.post(
        f"{_workflows(seeded, project_id)}/{started.json()['id']}/retry",
        json={"version": failed_again.json()["version"]},
    )
    assert exhausted.status_code == 409
    assert exhausted.json()["detail"] == "workflow cannot change that way"
    duplicate_again = restarted.post(
        _workflows(seeded, project_id),
        json={"workflow_key": "population-request"},
    )
    assert duplicate_again.status_code == 409
    assert duplicate_again.json()["detail"] == "workflow key is already in use"
    assert _workflow_count(migrated, project_id, "population-request") == 1


def test_cancellation_rejects_a_later_worker_result(migrated: Database) -> None:
    seeded, project_id, task_id, definition_id, client = _running_work(migrated, "cancel")
    recorded = client.post(_results(seeded, project_id), json=_result(task_id, definition_id))
    assert recorded.status_code == 200
    detail = client.get(f"{_tasks(seeded, project_id)}/{task_id}").json()
    cancelled = client.patch(
        f"{_tasks(seeded, project_id)}/{task_id}",
        json={
            **_edit(detail),
            "operation": "cancel",
            "cancellation_reason": "Stopped during execution",
            "version": detail["version"],
        },
    )
    assert cancelled.status_code == 200
    late = client.post(
        _results(seeded, project_id),
        json=_result(task_id, definition_id, key="after-cancel"),
    )
    assert late.status_code == 409
    assert late.json()["detail"] == "task cannot accept a result"
    assert _result_count(migrated, task_id) == 1


def test_concurrent_results_keep_distinct_versions(migrated: Database) -> None:
    seeded, project_id, task_id, definition_id, _owner = _running_work(migrated, "race")
    clients = [_client(migrated, seeded["user_id"]) for _index in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda item: item[0].post(
                    _results(seeded, project_id),
                    json=_result(task_id, definition_id, key=f"race-{item[1]}"),
                ),
                [(clients[0], 1), (clients[1], 2)],
            )
        )
    assert [response.status_code for response in responses] == [200, 200]
    assert {response.json()["result_version"] for response in responses} == {1, 2}
    assert _result_count(migrated, task_id) == 2


@pytest.mark.anyio
async def test_a_worker_crash_reconciles_without_a_second_effect(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_run(connection)
    async with await WorkflowEnvironment.start_time_skipping() as environment:
        async with Worker(
            environment.client,
            task_queue=TASK_QUEUE,
            workflows=[DurableEffectWorkflow],
            activities=activities_for(migrated.url),
        ):
            before = await _execute(environment.client, seeded, "before", mode="crash_before_write")
            assert before == "AMBIGUOUS"
            after = await _execute(environment.client, seeded, "after", mode="crash_after_write")
            assert after == "SUCCEEDED"
            assert _effect_count(migrated.url, seeded["run_id"], "after") == 1
            handle = await environment.client.start_workflow(
                DurableEffectWorkflow.run,
                _payload(seeded, "held", mode="ok", wait_for_release=True),
                id=f"{seeded['run_id']}:held",
                task_queue=TASK_QUEUE,
            )
            await handle.cancel()
            with pytest.raises(WorkflowFailureError):
                await handle.result()
    assert _effect_count(migrated.url, seeded["run_id"], "held") == 0


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _workspace(database: Database, slug: str) -> tuple[dict[str, Any], UUID, TestClient]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug)
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    return seeded, project_id, _client(database, seeded["user_id"])


def _running_work(
    database: Database, slug: str
) -> tuple[dict[str, Any], UUID, UUID, UUID, TestClient]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug)
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        definition_id = _seed_definition(connection, seeded["organization_id"])
        task_id = _seed_running_task(connection, seeded["organization_id"], project_id)
    return seeded, project_id, task_id, definition_id, _client(database, seeded["user_id"])


def _task(title: str) -> dict[str, Any]:
    return {"title": title, "description": "Prepare the sample.", "priority": "HIGH"}


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


def _advance(
    client: TestClient, seeded: dict[str, Any], project_id: UUID, body: dict[str, Any], status: str
) -> dict[str, Any]:
    current = body
    for step in ("READY", "QUEUED", "RUNNING", status):
        current = _move(client, seeded, project_id, current, step)
    return current


def _result(task_id: UUID, definition_id: UUID, *, key: str = "collect") -> dict[str, Any]:
    return {
        "operation_key": key,
        "task_id": str(task_id),
        "agent_definition_id": str(definition_id),
        "agent_revision": 1,
        "status": "SUCCEEDED",
        "summary": "Collected the population",
        "output": {"population": "synthetic"},
        "proposed_actions": [{"action": "review", "reason": "Check the sample"}],
    }


def _tasks(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/tasks"


def _workflows(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/workflows"


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


def _seed_org(connection: psycopg.Connection[Any], slug: str) -> dict[str, Any]:
    email = f"{slug}-{uuid4().hex[:8]}@example.com"
    name = f"{slug}-{uuid4().hex[:8]}"
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


def _seed_definition(connection: psycopg.Connection[Any], organization_id: UUID) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO agent_definitions (
                organization_id, agent_key, name, role, input_schema, output_schema,
                model_config_ref, max_iterations, time_budget_seconds
            )
            VALUES (%s, 'population-collector', 'Population collector', 'Collects a population',
                    '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 'audit-model', 2, 60)
            RETURNING id
            """,
            (organization_id,),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None or not isinstance(row[0], UUID):
        raise RuntimeError("seed failed")
    return row[0]


def _seed_running_task(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO tasks (organization_id, project_id, title, status)
            VALUES (%s, %s, 'Collect the population', 'RUNNING')
            RETURNING id
            """,
            (organization_id, project_id),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None or not isinstance(row[0], UUID):
        raise RuntimeError("seed failed")
    return row[0]


def _seed_run(connection: psycopg.Connection[Any]) -> dict[str, UUID]:
    seeded = _seed_org(connection, "crash")
    project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO workflow_runs (organization_id, project_id, workflow_key, max_attempts)
            VALUES (%s, %s, 'effect', 1)
            RETURNING id
            """,
            (seeded["organization_id"], project_id),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None or not isinstance(row[0], UUID):
        raise RuntimeError("seed failed")
    return {
        "organization_id": seeded["organization_id"],
        "project_id": project_id,
        "run_id": row[0],
    }


async def _execute(client: Client, seeded: dict[str, UUID], operation: str, *, mode: str) -> str:
    result: str = await client.execute_workflow(
        DurableEffectWorkflow.run,
        _payload(seeded, operation, mode=mode),
        id=f"{seeded['run_id']}:{operation}",
        task_queue=TASK_QUEUE,
    )
    return result


def _payload(
    seeded: dict[str, UUID], operation: str, *, mode: str, wait_for_release: bool = False
) -> EffectRequest:
    return {
        "organization_id": str(seeded["organization_id"]),
        "project_id": str(seeded["project_id"]),
        "workflow_run_id": str(seeded["run_id"]),
        "operation_key": operation,
        "mode": mode,
        "timer_seconds": 0,
        "max_attempts": 1,
        "wait_for_release": wait_for_release,
    }


def _task_count(database: Database, project_id: UUID) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s", (project_id,)
        ).fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _workflow_count(database: Database, project_id: UUID, workflow_key: str) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT count(*) FROM workflow_runs
            WHERE project_id = %s AND workflow_key = %s
            """,
            (project_id, workflow_key),
        ).fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _result_count(database: Database, task_id: UUID) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM worker_results WHERE task_id = %s", (task_id,)
        ).fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _effect_count(database_url: str, run_id: UUID, operation: str) -> int:
    with connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT count(*) FROM workflow_effects
            WHERE workflow_run_id = %s AND operation_key = %s
            """,
            (run_id, operation),
        ).fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]
