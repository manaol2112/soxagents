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
from ai_workforce_api.control_reviews import fail_reperformance, open_reperformances
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.durable_workflow import (
    AnalysisRequest,
    ConsoleTurnWorkflow,
    ControlReviewWorkflow,
    ControlTestingWorkflow,
    DraftRequest,
    DurableEffectWorkflow,
    EffectRequest,
    EvidenceAnalysisWorkflow,
    EvidencePlanRunWorkflow,
    FollowUpRequest,
    FollowUpWorkflow,
    NarrativeRequest,
    NarrativeWorkflow,
    PbcDraftWorkflow,
    PlanRunRequest,
    PriorYearRequest,
    PriorYearWorkflow,
    RcmSystemScanWorkflow,
    ReviewRequest,
    ScanRequest,
    SetupDraftRequest,
    SetupDraftWorkflow,
    SystemReviewRequest,
    SystemReviewWorkflow,
    TestRunRequest,
    TurnRequest,
    WorkpaperDraftWorkflow,
    WorkpaperRequest,
)
from ai_workforce_api.evidence_analysis import fail_analysis, open_analyses
from ai_workforce_api.followups import advance, remindable_requests
from ai_workforce_api.pbc_drafting import fail_draft, open_drafts
from ai_workforce_api.rcm_systems import fail_scan, open_scans
from ai_workforce_api.setup_drafting import fail_draft as fail_setup
from ai_workforce_api.setup_drafting import open_drafts as open_setups
from ai_workforce_api.system_review_queue import fail_review as fail_scoping
from ai_workforce_api.system_review_queue import open_reviews as open_scopings
from ai_workforce_api.testing_engine import fail_run, open_runs
from ai_workforce_api.workflow import DurableUnavailable, WorkflowRunBody
from ai_workforce_api.workpaper_service import fail_draft as fail_workpaper
from ai_workforce_api.workpaper_service import open_drafts as open_workpapers

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

    def schedule_test_runs(self, sheet_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_tests(self._address, sheet_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_workpaper_drafts(self, workpaper_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_workpapers(self._address, workpaper_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_system_reviews(self, application_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_scopings(self._address, application_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_setup_drafts(self, project_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_setups(self._address, project_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_reviews(self, review_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_reviews(self._address, review_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_plan_runs(self, plan_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_plan_runs(self._address, plan_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_prior_year_runs(self, document_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_prior_year_runs(self._address, document_ids))
        except Exception as error:
            raise DurableUnavailable() from error

    def schedule_narrative_runs(self, control_ids: list[UUID]) -> None:
        try:
            asyncio.run(_schedule_narrative_runs(self._address, control_ids))
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
    test: Callable[[UUID], str] | None = None,
    workpaper: Callable[[UUID], str] | None = None,
    setup: Callable[[UUID], str] | None = None,
    review: Callable[[UUID], str] | None = None,
    scoping: Callable[[UUID], str] | None = None,
    plan: Callable[[UUID], str] | None = None,
    prior: Callable[[UUID], str] | None = None,
    narrative: Callable[[UUID], str] | None = None,
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
            ControlTestingWorkflow,
            WorkpaperDraftWorkflow,
            SetupDraftWorkflow,
            ControlReviewWorkflow,
            SystemReviewWorkflow,
            EvidencePlanRunWorkflow,
            PriorYearWorkflow,
            NarrativeWorkflow,
        ],
        activities=activities_for(
            database_url,
            draft,
            scan,
            analyze,
            converse,
            test,
            address,
            workpaper,
            setup,
            review,
            scoping,
            plan,
            prior,
            narrative,
        ),
    )
    async with worker:
        await resume_follow_ups(client, database_url)
        await resume_drafts(client, database_url)
        await resume_scans(client, database_url)
        await resume_analyses(client, database_url)
        await resume_turns(client, database_url)
        await resume_tests(client, database_url)
        await resume_workpapers(client, database_url)
        await resume_setups(client, database_url)
        await resume_reviews(client, database_url)
        await resume_scopings(client, database_url)
        await resume_plan_runs(client, database_url)
        await resume_prior_year_runs(client, database_url)
        await resume_narrative_runs(client, database_url)
        yield


async def resume_narrative_runs(client: Client, database_url: str) -> int:
    from ai_workforce_api.process_narrative import open_runs

    try:
        with connect(database_url) as connection:
            ids = open_runs(connection)
        for control_id in ids:
            await start_narrative_run(client, control_id)
    except Exception:
        logger.warning("narrative runs could not be resumed")
        return 0
    return len(ids)


async def start_narrative_run(client: Client, control_id: UUID) -> None:
    payload: NarrativeRequest = {"control_id": str(control_id)}
    try:
        await client.start_workflow(
            NarrativeWorkflow.run,
            payload,
            id=f"process-narrative-run:{control_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_narrative_runs(address: str, control_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for control_id in control_ids:
        await start_narrative_run(client, control_id)


async def resume_prior_year_runs(client: Client, database_url: str) -> int:
    from ai_workforce_api.prior_year import open_runs

    try:
        with connect(database_url) as connection:
            ids = open_runs(connection)
        for document_id in ids:
            await start_prior_year_run(client, document_id)
    except Exception:
        logger.warning("prior-year runs could not be resumed")
        return 0
    return len(ids)


async def start_prior_year_run(client: Client, document_id: UUID) -> None:
    payload: PriorYearRequest = {"document_id": str(document_id)}
    try:
        await client.start_workflow(
            PriorYearWorkflow.run,
            payload,
            id=f"prior-year-run:{document_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_prior_year_runs(address: str, document_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for document_id in document_ids:
        await start_prior_year_run(client, document_id)


async def resume_plan_runs(client: Client, database_url: str) -> int:
    from ai_workforce_api.evidence_plans import open_plan_runs

    try:
        with connect(database_url) as connection:
            ids = open_plan_runs(connection)
        for plan_id in ids:
            await start_plan_run(client, plan_id)
    except Exception:
        logger.warning("evidence plan runs could not be resumed")
        return 0
    return len(ids)


async def start_plan_run(client: Client, plan_id: UUID) -> None:
    payload: PlanRunRequest = {"plan_id": str(plan_id)}
    try:
        await client.start_workflow(
            EvidencePlanRunWorkflow.run,
            payload,
            id=f"evidence-plan-run:{plan_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_plan_runs(address: str, plan_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for plan_id in plan_ids:
        await start_plan_run(client, plan_id)


async def resume_scopings(client: Client, database_url: str) -> int:
    try:
        with connect(database_url) as connection:
            ids = open_scopings(connection)
        for application_id in ids:
            await start_scoping(client, application_id)
    except Exception:
        logger.warning("system scoping reviews could not be resumed")
        return 0
    return len(ids)


async def start_scoping(client: Client, application_id: UUID) -> None:
    payload: SystemReviewRequest = {"application_id": str(application_id)}
    try:
        await client.start_workflow(
            SystemReviewWorkflow.run,
            payload,
            id=f"system-review:{application_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_scopings(address: str, application_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for application_id in application_ids:
        await start_scoping(client, application_id)


async def resume_setups(client: Client, database_url: str) -> int:
    try:
        with connect(database_url) as connection:
            ids = open_setups(connection)
        for project_id in ids:
            await start_setup(client, project_id)
    except Exception:
        logger.warning("setup drafts could not be resumed")
        return 0
    return len(ids)


async def start_setup(client: Client, project_id: UUID) -> None:
    payload: SetupDraftRequest = {"project_id": str(project_id)}
    try:
        await client.start_workflow(
            SetupDraftWorkflow.run,
            payload,
            id=f"setup-draft:{project_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_setups(address: str, project_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for project_id in project_ids:
        await start_setup(client, project_id)


async def resume_workpapers(client: Client, database_url: str) -> int:
    try:
        with connect(database_url) as connection:
            ids = open_workpapers(connection)
        for workpaper_id in ids:
            await start_workpaper(client, workpaper_id)
    except Exception:
        logger.warning("workpaper drafts could not be resumed")
        return 0
    return len(ids)


async def start_workpaper(client: Client, workpaper_id: UUID) -> None:
    payload: WorkpaperRequest = {"workpaper_id": str(workpaper_id)}
    try:
        await client.start_workflow(
            WorkpaperDraftWorkflow.run,
            payload,
            id=f"workpaper-draft:{workpaper_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_workpapers(address: str, workpaper_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for workpaper_id in workpaper_ids:
        await start_workpaper(client, workpaper_id)


async def resume_reviews(client: Client, database_url: str) -> int:
    try:
        with connect(database_url) as connection:
            ids = open_reperformances(connection)
        for review_id in ids:
            await start_review(client, review_id)
    except Exception:
        logger.warning("review re-performances could not be resumed")
        return 0
    return len(ids)


async def start_review(client: Client, review_id: UUID) -> None:
    payload: ReviewRequest = {"review_id": str(review_id)}
    try:
        await client.start_workflow(
            ControlReviewWorkflow.run,
            payload,
            id=f"control-review:{review_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_reviews(address: str, review_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for review_id in review_ids:
        await start_review(client, review_id)


async def resume_tests(client: Client, database_url: str) -> int:
    try:
        with connect(database_url) as connection:
            ids = open_runs(connection)
        for sheet_id in ids:
            await start_test(client, sheet_id)
    except Exception:
        logger.warning("test runs could not be resumed")
        return 0
    return len(ids)


async def start_test(client: Client, sheet_id: UUID) -> None:
    payload: TestRunRequest = {"sheet_id": str(sheet_id)}
    try:
        await client.start_workflow(
            ControlTestingWorkflow.run,
            payload,
            id=f"control-testing:{sheet_id}",
            task_queue=TASK_QUEUE,
        )
    except WorkflowAlreadyStartedError:
        return


async def _schedule_tests(address: str, sheet_ids: list[UUID]) -> None:
    client = await Client.connect(address)
    for sheet_id in sheet_ids:
        await start_test(client, sheet_id)


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
    test: Callable[[UUID], str] | None = None,
    address: str = "",
    workpaper: Callable[[UUID], str] | None = None,
    setup: Callable[[UUID], str] | None = None,
    review: Callable[[UUID], str] | None = None,
    scoping: Callable[[UUID], str] | None = None,
    plan: Callable[[UUID], str] | None = None,
    prior: Callable[[UUID], str] | None = None,
    narrative: Callable[[UUID], str] | None = None,
) -> list[Any]:
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
        result = await asyncio.to_thread(analyze, UUID(analysis_id))
        if address and test is not None:
            # A read file may give its control's tester new evidence to test.
            def pending() -> list[UUID]:
                with connect(database_url) as connection:
                    return open_runs(connection)

            try:
                await _schedule_tests(address, await asyncio.to_thread(pending))
            except Exception:
                logger.warning("test runs could not be scheduled; they will resume on restart")
        if address and workpaper is not None:
            # A control's first read file gives the drafting agent its walkthrough to write.
            from ai_workforce_api.workpaper_service import draft_design_after_analysis

            def design() -> list[UUID]:
                with connect(database_url) as connection:
                    return draft_design_after_analysis(connection, UUID(analysis_id))

            try:
                await _schedule_workpapers(address, await asyncio.to_thread(design))
            except Exception:
                logger.warning("the design draft could not be scheduled; it resumes on restart")
        return result

    @activity.defn(name="fail_evidence_analysis")
    async def fail_evidence_analysis(analysis_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_analysis(connection, UUID(analysis_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="draft_workpaper")
    async def draft_workpaper(workpaper_id: str) -> str:
        if workpaper is None:
            return "SKIPPED"
        # Drafting calls the model and the database, so it runs off the event loop.
        return await asyncio.to_thread(workpaper, UUID(workpaper_id))

    @activity.defn(name="fail_workpaper_draft")
    async def fail_workpaper_draft(workpaper_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_workpaper(connection, UUID(workpaper_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="draft_setup")
    async def draft_setup(project_id: str) -> str:
        if setup is None:
            return "SKIPPED"
        return await asyncio.to_thread(setup, UUID(project_id))

    @activity.defn(name="review_system")
    async def review_system(application_id: str) -> str:
        if scoping is None:
            return "SKIPPED"
        return await asyncio.to_thread(scoping, UUID(application_id))

    @activity.defn(name="fail_system_review")
    async def fail_system_review(application_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_scoping(connection, UUID(application_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="run_evidence_plan")
    async def run_evidence_plan(plan_id: str) -> str:
        if plan is None:
            return "SKIPPED"
        return await asyncio.to_thread(plan, UUID(plan_id))

    @activity.defn(name="fail_evidence_plan_run")
    async def fail_evidence_plan_run(plan_id: str) -> None:
        from ai_workforce_api.evidence_plans import fail_plan_run

        def fail() -> None:
            with connect(database_url) as connection:
                fail_plan_run(connection, UUID(plan_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="run_prior_year")
    async def run_prior_year(document_id: str) -> str:
        if prior is None:
            return "SKIPPED"
        return await asyncio.to_thread(prior, UUID(document_id))

    @activity.defn(name="fail_prior_year_run")
    async def fail_prior_year_run(document_id: str) -> None:
        from ai_workforce_api.prior_year import fail_run

        def fail() -> None:
            with connect(database_url) as connection:
                fail_run(connection, UUID(document_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="fail_setup_draft")
    async def fail_setup_draft(project_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_setup(connection, UUID(project_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="reperform_review")
    async def reperform_review(review_id: str) -> str:
        if review is None:
            return "SKIPPED"
        return await asyncio.to_thread(review, UUID(review_id))

    @activity.defn(name="fail_review")
    async def fail_review(review_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_reperformance(connection, UUID(review_id))

        await asyncio.to_thread(fail)

    @activity.defn(name="test_control")
    async def test_control(sheet_id: str) -> str:
        if test is None:
            return "SKIPPED"
        # Testing calls the model and the database, so it runs off the event loop.
        result = await asyncio.to_thread(test, UUID(sheet_id))
        if address and workpaper is not None:
            # The tester's first results start the effectiveness workpaper while testing
            # is still open.
            from ai_workforce_api.workpaper_service import draft_effectiveness_after_run

            def effectiveness() -> list[UUID]:
                with connect(database_url) as connection:
                    return draft_effectiveness_after_run(connection, UUID(sheet_id))

            try:
                await _schedule_workpapers(address, await asyncio.to_thread(effectiveness))
            except Exception:
                logger.warning("the testing draft could not be scheduled; it resumes on restart")
        return result

    @activity.defn(name="fail_test_run")
    async def fail_test_run(sheet_id: str) -> None:
        def fail() -> None:
            with connect(database_url) as connection:
                fail_run(connection, UUID(sheet_id), "the workflow's retries ran out")

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

    @activity.defn(name="run_narrative")
    async def run_narrative(control_id: str) -> str:
        if narrative is None:
            return "SKIPPED"
        return await asyncio.to_thread(narrative, UUID(control_id))

    @activity.defn(name="fail_narrative_run")
    async def fail_narrative_run(control_id: str) -> None:
        from ai_workforce_api.process_narrative import fail_run

        def fail() -> None:
            with connect(database_url) as connection:
                fail_run(connection, UUID(control_id))

        await asyncio.to_thread(fail)

    return [
        run_narrative,
        fail_narrative_run,
        draft_workpaper,
        fail_workpaper_draft,
        draft_setup,
        fail_setup_draft,
        run_evidence_plan,
        fail_evidence_plan_run,
        run_prior_year,
        fail_prior_year_run,
        review_system,
        fail_system_review,
        test_control,
        reperform_review,
        fail_review,
        fail_test_run,
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
