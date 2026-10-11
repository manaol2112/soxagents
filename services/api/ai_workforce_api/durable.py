"""Temporal adapter behind the workflow service. Business modules do not import it."""

import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from temporalio import activity
from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.worker import Worker

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.durable_workflow import DurableEffectWorkflow, EffectRequest
from ai_workforce_api.workflow import DurableUnavailable, WorkflowRunBody

TASK_QUEUE = "ai-workforce"


class TemporalAdapter:
    """Submits a run to Temporal. A duplicate workflow id is the same run."""

    def __init__(self, address: str) -> None:
        self._address = address

    def attach(
        self,
        run: WorkflowRunBody,
        organization_id: UUID,
        project_id: UUID,
        timer_seconds: int,
    ) -> None:
        try:
            asyncio.run(_attach(self._address, run, organization_id, project_id, timer_seconds))
        except DurableUnavailable:
            raise
        except Exception as error:
            raise DurableUnavailable() from error


@asynccontextmanager
async def serve(address: str, database_url: str) -> AsyncIterator[None]:
    client = await Client.connect(address)
    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[DurableEffectWorkflow],
        activities=activities_for(database_url),
    )
    async with worker:
        yield


def activities_for(database_url: str) -> list[Callable[..., Any]]:
    @activity.defn(name="record_effect")
    async def record_effect(
        organization_id: str,
        project_id: str,
        workflow_run_id: str,
        operation_key: str,
        mode: str,
        max_attempts: int,
    ) -> str:
        return await _record_effect(
            database_url,
            organization_id,
            project_id,
            workflow_run_id,
            operation_key,
            mode,
            max_attempts,
        )

    @activity.defn(name="reconcile_effect")
    async def reconcile_effect(
        organization_id: str,
        project_id: str,
        workflow_run_id: str,
        operation_key: str,
    ) -> str:
        return _reconcile_effect(
            database_url, organization_id, project_id, workflow_run_id, operation_key
        )

    return [record_effect, reconcile_effect]


async def _attach(
    address: str,
    run: WorkflowRunBody,
    organization_id: UUID,
    project_id: UUID,
    timer_seconds: int,
) -> None:
    try:
        client = await Client.connect(address)
    except Exception as error:
        raise DurableUnavailable() from error
    request = _request(run, organization_id, project_id, timer_seconds)
    try:
        await client.start_workflow(
            DurableEffectWorkflow.run,
            request,
            id=str(run.id),
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


def _request(
    run: WorkflowRunBody,
    organization_id: UUID,
    project_id: UUID,
    timer_seconds: int,
) -> EffectRequest:
    return {
        "organization_id": str(organization_id),
        "project_id": str(project_id),
        "workflow_run_id": str(run.id),
        "operation_key": f"{run.id}:effect",
        "mode": "ok",
        "timer_seconds": timer_seconds,
        "max_attempts": run.max_attempts,
        "wait_for_release": False,
    }


async def _record_effect(
    database_url: str,
    organization_id: str,
    project_id: str,
    workflow_run_id: str,
    operation_key: str,
    mode: str,
    max_attempts: int,
) -> str:
    from temporalio.exceptions import ApplicationError

    attempt = activity.info().attempt
    if mode == "nonretryable":
        raise ApplicationError("effect rejected", type="NonRetryableEffect", non_retryable=True)
    if mode == "retryable" and attempt < max_attempts:
        raise ApplicationError("temporary failure")
    if mode == "crash_before_write":
        raise ApplicationError("worker crashed")
    if mode == "timeout_before_write":
        await asyncio.sleep(30)
    outcome = "SUCCEEDED"
    _insert_once(
        database_url,
        organization_id,
        project_id,
        workflow_run_id,
        operation_key,
        outcome,
        attempt,
    )
    if mode == "crash_after_write":
        raise ApplicationError("worker crashed")
    if mode == "timeout_after_write":
        await asyncio.sleep(30)
    return _read_outcome(database_url, workflow_run_id, operation_key)


def _reconcile_effect(
    database_url: str,
    organization_id: str,
    project_id: str,
    workflow_run_id: str,
    operation_key: str,
) -> str:
    existing = _find_outcome(database_url, workflow_run_id, operation_key)
    if existing is not None:
        return existing
    _insert_once(
        database_url,
        organization_id,
        project_id,
        workflow_run_id,
        operation_key,
        "AMBIGUOUS",
        1,
    )
    recorded = _find_outcome(database_url, workflow_run_id, operation_key)
    if recorded is None:
        raise DurableUnavailable()
    return recorded


def _insert_once(
    database_url: str,
    organization_id: str,
    project_id: str,
    workflow_run_id: str,
    operation_key: str,
    outcome: str,
    attempt: int,
) -> None:
    with connect(database_url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO workflow_effects (
                    organization_id, project_id, workflow_run_id, operation_key, outcome, attempt
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (workflow_run_id, operation_key) DO NOTHING
                """,
                (
                    UUID(organization_id),
                    UUID(project_id),
                    UUID(workflow_run_id),
                    operation_key,
                    outcome,
                    attempt,
                ),
            )


def _read_outcome(database_url: str, workflow_run_id: str, operation_key: str) -> str:
    outcome = _find_outcome(database_url, workflow_run_id, operation_key)
    if outcome is None:
        raise DurableUnavailable()
    return outcome


def _find_outcome(database_url: str, workflow_run_id: str, operation_key: str) -> str | None:
    with connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT outcome
            FROM workflow_effects
            WHERE workflow_run_id = %s AND operation_key = %s
            """,
            (UUID(workflow_run_id), operation_key),
        ).fetchone()
    if row is None or not isinstance(row[0], str):
        return None
    return row[0]
