from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from support import Database
from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.durable import TASK_QUEUE, activities_for
from ai_workforce_api.durable_workflow import DurableEffectWorkflow, EffectRequest
from ai_workforce_api.migrate import apply_migrations, migrations_dir


def test_business_modules_do_not_import_the_temporal_sdk() -> None:
    root = Path(__file__).parents[1] / "ai_workforce_api"
    allowed = {"durable.py", "durable_workflow.py"}
    for path in root.glob("*.py"):
        if path.name in allowed:
            continue
        source = path.read_text(encoding="utf-8")
        assert "temporalio" not in source
        assert "import temporal" not in source


@pytest.mark.anyio
async def test_durable_timer_retry_and_reconciliation(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_run(connection)
    async with await WorkflowEnvironment.start_time_skipping() as environment:
        async with Worker(
            environment.client,
            task_queue=TASK_QUEUE,
            workflows=[DurableEffectWorkflow],
            activities=activities_for(migrated.url),
        ):
            timed = await _execute(
                environment.client, seeded, "timer", mode="ok", timer_seconds=3600
            )
            assert timed == "SUCCEEDED:timer"
            retried = await _execute(
                environment.client,
                seeded,
                "retry",
                mode="retryable",
                max_attempts=3,
            )
            assert retried == "SUCCEEDED"
            assert _attempt(migrated.url, seeded["run_id"], "retry") == 3
            rejected = await _execute(
                environment.client, seeded, "reject", mode="nonretryable", max_attempts=3
            )
            assert rejected == "FAILED"
            assert _attempt(migrated.url, seeded["run_id"], "reject") is None
            ambiguous = await _execute(
                environment.client, seeded, "missing", mode="timeout_before_write", max_attempts=1
            )
            assert ambiguous == "AMBIGUOUS"
            recovered = await _execute(
                environment.client, seeded, "wrote", mode="timeout_after_write", max_attempts=1
            )
            assert recovered == "SUCCEEDED"
            duplicated = await _execute(environment.client, seeded, "once", mode="duplicate")
            assert duplicated == "SUCCEEDED"
            assert _count(migrated.url, seeded["run_id"], "once") == 1
            handle = await environment.client.start_workflow(
                DurableEffectWorkflow.run,
                _payload(seeded, "held", mode="ok", wait_for_release=True),
                id=f"{seeded['run_id']}:held",
                task_queue=TASK_QUEUE,
            )
            with pytest.raises(WorkflowAlreadyStartedError):
                await environment.client.start_workflow(
                    DurableEffectWorkflow.run,
                    _payload(seeded, "held", mode="ok", wait_for_release=True),
                    id=f"{seeded['run_id']}:held",
                    task_queue=TASK_QUEUE,
                )
            await handle.cancel()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


async def _execute(
    client: Client,
    seeded: dict[str, UUID],
    operation: str,
    *,
    mode: str,
    timer_seconds: int = 0,
    max_attempts: int = 1,
    wait_for_release: bool = False,
) -> str:
    result: str = await client.execute_workflow(
        DurableEffectWorkflow.run,
        _payload(
            seeded,
            operation,
            mode=mode,
            timer_seconds=timer_seconds,
            max_attempts=max_attempts,
            wait_for_release=wait_for_release,
        ),
        id=f"{seeded['run_id']}:{operation}",
        task_queue=TASK_QUEUE,
    )
    return result


def _payload(
    seeded: dict[str, UUID],
    operation: str,
    *,
    mode: str,
    timer_seconds: int = 0,
    max_attempts: int = 1,
    wait_for_release: bool = False,
) -> EffectRequest:
    return {
        "organization_id": str(seeded["organization_id"]),
        "project_id": str(seeded["project_id"]),
        "workflow_run_id": str(seeded["run_id"]),
        "operation_key": operation,
        "mode": mode,
        "timer_seconds": timer_seconds,
        "max_attempts": max_attempts,
        "wait_for_release": wait_for_release,
    }


def _attempt(database_url: str, run_id: UUID, operation: str) -> int | None:
    with connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT attempt FROM workflow_effects
            WHERE workflow_run_id = %s AND operation_key = %s
            """,
            (run_id, operation),
        ).fetchone()
    if row is None or not isinstance(row[0], int):
        return None
    return row[0]


def _count(database_url: str, run_id: UUID, operation: str) -> int:
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


def _seed_run(connection: psycopg.Connection[Any]) -> dict[str, UUID]:
    slug = f"durable-{uuid4().hex[:8]}"
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO organizations (name, slug) VALUES (%s, %s) RETURNING id",
            ("Durable", slug),
        )
        organization = cursor.fetchone()
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (f"{slug}@example.com", "Owner"),
        )
        user = cursor.fetchone()
        if organization is None or user is None:
            raise RuntimeError("seed failed")
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, 'OWNER')
            """,
            (organization[0], user[0]),
        )
        cursor.execute(
            """
            INSERT INTO projects (organization_id, name, slug, owner_user_id)
            VALUES (%s, 'SOX', %s, %s)
            RETURNING id
            """,
            (organization[0], slug, user[0]),
        )
        project = cursor.fetchone()
        if project is None:
            raise RuntimeError("seed failed")
        cursor.execute(
            """
            INSERT INTO workflow_runs (
                organization_id, project_id, workflow_key, max_attempts
            )
            VALUES (%s, %s, 'effect', 3)
            RETURNING id
            """,
            (organization[0], project[0]),
        )
        run = cursor.fetchone()
    connection.commit()
    if run is None or not isinstance(run[0], UUID) or not isinstance(project[0], UUID):
        raise RuntimeError("seed failed")
    if not isinstance(organization[0], UUID):
        raise RuntimeError("seed failed")
    return {
        "organization_id": organization[0],
        "project_id": project[0],
        "run_id": run[0],
    }
