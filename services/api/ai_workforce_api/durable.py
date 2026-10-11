"""Temporal adapter behind the workflow service. Business modules do not import it."""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any
from uuid import UUID

from temporalio import activity
from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.worker import Worker

from ai_workforce_api.console import fail_turn, open_turns
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.durable_workflow import (
    AnalysisRequest,
    ConsoleTurnWorkflow,
    DraftRequest,
    DurableEffectWorkflow,
    EffectRequest,
    EvidenceAnalysisWorkflow,
    FollowUpRequest,
    FollowUpWorkflow,
    PbcDraftWorkflow,
    RcmSystemScanWorkflow,
    ScanRequest,
    TurnRequest,
)
from ai_workforce_api.evidence_analysis import fail_analysis, open_analyses
from ai_workforce_api.followups import advance, remindable_requests
from ai_workforce_api.pbc_drafting import fail_draft, open_drafts
from ai_workforce_api.rcm_systems import fail_scan, open_scans
from ai_workforce_api.workflow import DurableUnavailable, WorkflowRunBody

logger = logging.getLogger(__name__)

TASK_QUEUE = "ai-workforce"


def follow_up_workflow_id(request_id: UUID) -> str:
    return f"pbc-follow-up:{request_id}"


def draft_workflow_id(draft_id: UUID) -> str:
    return f"pbc-draft:{draft_id}"


class TemporalAdapter:
    """Submits runs and follow-up timers to Temporal. A duplicate workflow id is the same run."""

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

    def schedule(self, organization_id: UUID, project_id: UUID, request_id: UUID) -> None:
        try:
            asyncio.run(_schedule_once(self._address, organization_id, project_id, request_id))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_drafts(self._address, draft_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_system_scans(self, import_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_scans(self._address, import_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_evidence_analyses(self, analysis_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_analyses(self._address, analysis_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_console_turns(self, message_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_turns(self._address, message_ids))
        except Exception as error:
            raise DurableUnavailable() from error


@asynccontextmanager
async def serve(
    address: str,
    database_url: str,
    draft: Callable[[UUID], str] | None = None,
    scan: Callable[[UUID], str] | None = None,
    analyze: Callable[[UUID], str] | None = None,
    converse: Callable[[UUID], str] | None = None,
) -> AsyncIterator[None]:
    client = await Client.connect(address)
    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[
            DurableEffectWorkflow,
            FollowUpWorkflow,
            PbcDraftWorkflow,
            RcmSystemScanWorkflow,
            EvidenceAnalysisWorkflow,
            ConsoleTurnWorkflow,
        ],
        activities=activities_for(database_url, draft, scan, analyze, converse),
    )
    async with worker:
        await resume_follow_ups(client, database_url)
        await resume_drafts(client, database_url)
        await resume_scans(client, database_url)
        await resume_analyses(client, database_url)
        await resume_turns(client, database_url)
        yield


async def resume_turns(client: Client, database_url: str) -> int:
    try:
        with connect(database_url) as connection:
            ids = open_turns(connection)
        for message_id in ids:
            await start_turn(client, message_id)
    except Exception:
        logger.warning("console turns could not be resumed")
        return 0
    return len(ids)


async def start_turn(client: Client, message_id: UUID) -> None:
    payload: TurnRequest = {"message_id": str(message_id)}
    try:
        await client.start_workflow(
            ConsoleTurnWorkflow.run,
            payload,
            id=f"console-turn:{message_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_turns(address: str, message_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for message_id in message_ids:
        await start_turn(client, message_id)


async def resume_analyses(client: Client, database_url: str) -> int:
    """Restart reading for stored files still waiting to be read."""
    try:
        with connect(database_url) as connection:
            ids = open_analyses(connection)
        for analysis_id in ids:
            await start_analysis(client, analysis_id)
    except Exception:
        logger.warning("evidence analyses could not be resumed")
        return 0
    return len(ids)


async def start_analysis(client: Client, analysis_id: UUID) -> None:
    payload: AnalysisRequest = {"analysis_id": str(analysis_id)}
    try:
        await client.start_workflow(
            EvidenceAnalysisWorkflow.run,
            payload,
            id=f"evidence-analysis:{analysis_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_analyses(address: str, analysis_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for analysis_id in analysis_ids:
        await start_analysis(client, analysis_id)


async def resume_scans(client: Client, database_url: str) -> int:
    """Restart system scans for uploads still being mapped."""
    try:
        with connect(database_url) as connection:
            ids = open_scans(connection)
        for import_id in ids:
            await start_scan(client, import_id)
    except Exception:
        logger.warning("system scans could not be resumed")
        return 0
    return len(ids)


async def start_scan(client: Client, import_id: UUID) -> None:
    payload: ScanRequest = {"import_id": str(import_id)}
    try:
        await client.start_workflow(
            RcmSystemScanWorkflow.run,
            payload,
            id=f"rcm-system-scan:{import_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_scans(address: str, import_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for import_id in import_ids:
        await start_scan(client, import_id)


async def resume_drafts(client: Client, database_url: str) -> int:
    """Restart drafting for every open draft. A running draft is left alone."""
    try:
        with connect(database_url) as connection:
            ids = open_drafts(connection)
        for draft_id in ids:
            await start_draft(client, draft_id)
    except Exception:
        logger.warning("drafts could not be resumed")
        return 0
    return len(ids)


async def start_draft(client: Client, draft_id: UUID) -> None:
    payload: DraftRequest = {"draft_id": str(draft_id)}
    try:
        await client.start_workflow(
            PbcDraftWorkflow.run,
            payload,
            id=draft_workflow_id(draft_id),
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_drafts(address: str, draft_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for draft_id in draft_ids:
        await start_draft(client, draft_id)


async def resume_follow_ups(client: Client, database_url: str) -> int:
    """Restart timers for every open request. Started timers are left alone."""
    try:
        with connect(database_url) as connection:
            requests = remindable_requests(connection)
        for organization_id, project_id, request_id in requests:
            await start_follow_up(client, organization_id, project_id, request_id)
    except Exception:
        logger.warning("follow-up timers could not be resumed")
        return 0
    return len(requests)


async def start_follow_up(
    client: Client, organization_id: UUID, project_id: UUID, request_id: UUID
) -> None:
    payload: FollowUpRequest = {
        "organization_id": str(organization_id),
        "project_id": str(project_id),
        "request_id": str(request_id),
    }
    try:
        await client.start_workflow(
            FollowUpWorkflow.run,
            payload,
            id=follow_up_workflow_id(request_id),
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_once(
    address: str, organization_id: UUID, project_id: UUID, request_id: UUID
) -> None:
    client = await Client.connect(address)
    await start_follow_up(client, organization_id, project_id, request_id)


def activities_for(
    database_url: str,
    draft: Callable[[UUID], str] | None = None,
    scan: Callable[[UUID], str] | None = None,
    analyze: Callable[[UUID], str] | None = None,
    converse: Callable[[UUID], str] | None = None,
) -> list[Callable[..., Any]]:
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

    @activity.defn(name="advance_follow_up")
    async def advance_follow_up(
        organization_id: str, project_id: str, request_id: str, now: str
    ) -> int:
        with connect(database_url) as connection:
            return advance(
                connection,
                UUID(organization_id),
                UUID(project_id),
                UUID(request_id),
                datetime.fromisoformat(now),
            )

    @activity.defn(name="draft_pbc_request")
    async def draft_pbc_request(draft_id: str) -> str:
        if draft is None:
            return "SKIPPED"
        # Drafting calls the model and the database, so it runs off the event loop.
        return await asyncio.to_thread(draft, UUID(draft_id))

    @activity.defn(name="fail_pbc_draft")
    async def fail_pbc_draft(draft_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_draft(connection, UUID(draft_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="scan_rcm_systems")
    async def scan_rcm_systems(import_id: str) -> str:
        if scan is None:
            return "SKIPPED"
        return await asyncio.to_thread(scan, UUID(import_id))

    @activity.defn(name="fail_rcm_system_scan")
    async def fail_rcm_system_scan(import_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_scan(connection, UUID(import_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="analyze_evidence_file")
    async def analyze_evidence_file(analysis_id: str) -> str:
        if analyze is None:
            return "SKIPPED"
        # Reading calls OCR, the model, and the database, so it runs off the event loop.
        return await asyncio.to_thread(analyze, UUID(analysis_id))

    @activity.defn(name="fail_evidence_analysis")
    async def fail_evidence_analysis(analysis_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_analysis(connection, UUID(analysis_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="answer_console_turn")
    async def answer_console_turn(message_id: str) -> str:
        if converse is None:
            return "SKIPPED"
        return await asyncio.to_thread(converse, UUID(message_id))

    @activity.defn(name="fail_console_turn")
    async def fail_console_turn(message_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_turn(connection, UUID(message_id))

        await asyncio.to_thread(fail)

    return [
        answer_console_turn,
        fail_console_turn,
        record_effect,
        reconcile_effect,
        advance_follow_up,
        draft_pbc_request,
        fail_pbc_draft,
        scan_rcm_systems,
        fail_rcm_system_scan,
        analyze_evidence_file,
        fail_evidence_analysis,
    ]


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
