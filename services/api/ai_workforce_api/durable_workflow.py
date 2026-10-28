"""Temporal workflow definition. This module does not open database connections."""

from datetime import timedelta
from typing import TypedDict

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError


class EffectRequest(TypedDict):
    organization_id: str
    project_id: str
    workflow_run_id: str
    operation_key: str
    mode: str
    timer_seconds: int
    max_attempts: int
    wait_for_release: bool


@workflow.defn(name="durable_effect")
class DurableEffectWorkflow:
    """Sleeps on a durable timer, then records one idempotent effect."""

    def __init__(self) -> None:
        self._release = False

    @workflow.signal
    def release(self) -> None:
        self._release = True

    @workflow.run
    async def run(self, payload: EffectRequest) -> str:
        timer_seconds = payload["timer_seconds"]
        if timer_seconds > 0:
            await workflow.sleep(timedelta(seconds=timer_seconds))
        if payload["wait_for_release"]:
            await workflow.wait_condition(lambda: self._release)
        timeout = 1 if payload["mode"].startswith("timeout") else 10
        try:
            outcome = await workflow.execute_activity(
                "record_effect",
                args=[
                    payload["organization_id"],
                    payload["project_id"],
                    payload["workflow_run_id"],
                    payload["operation_key"],
                    payload["mode"],
                    payload["max_attempts"],
                ],
                start_to_close_timeout=timedelta(seconds=timeout),
                retry_policy=RetryPolicy(
                    maximum_attempts=payload["max_attempts"],
                    non_retryable_error_types=["NonRetryableEffect"],
                ),
            )
        except ActivityError as error:
            if _rejected(error):
                return "FAILED"
            outcome = await workflow.execute_activity(
                "reconcile_effect",
                args=[
                    payload["organization_id"],
                    payload["project_id"],
                    payload["workflow_run_id"],
                    payload["operation_key"],
                ],
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        if payload["mode"] == "duplicate":
            outcome = await workflow.execute_activity(
                "record_effect",
                args=[
                    payload["organization_id"],
                    payload["project_id"],
                    payload["workflow_run_id"],
                    payload["operation_key"],
                    "ok",
                    payload["max_attempts"],
                ],
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        if outcome == "SUCCEEDED" and timer_seconds > 0:
            return "SUCCEEDED:timer"
        if not isinstance(outcome, str):
            raise ApplicationError("workflow fields are invalid", non_retryable=True)
        return outcome


class FollowUpRequest(TypedDict):
    organization_id: str
    project_id: str
    request_id: str


FOLLOW_UP_MIN_SECONDS = 60
FOLLOW_UP_MAX_SECONDS = 86400
FOLLOW_UP_LOOPS = 200


@workflow.defn(name="pbc_follow_up")
class FollowUpWorkflow:
    """Keeps time for one PBC request. The database decides whether a reminder is due."""

    @workflow.run
    async def run(self, payload: FollowUpRequest) -> str:
        for _ in range(FOLLOW_UP_LOOPS):
            seconds = await workflow.execute_activity(
                "advance_follow_up",
                args=[
                    payload["organization_id"],
                    payload["project_id"],
                    payload["request_id"],
                    workflow.now().isoformat(),
                ],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_interval=timedelta(minutes=10)),
            )
            if not isinstance(seconds, int):
                raise ApplicationError("follow-up fields are invalid", non_retryable=True)
            if seconds < 0:
                return "DONE"
            wait = min(max(seconds, FOLLOW_UP_MIN_SECONDS), FOLLOW_UP_MAX_SECONDS)
            await workflow.sleep(timedelta(seconds=wait))
        workflow.continue_as_new(payload)


def _rejected(error: ActivityError) -> bool:
    cause = error.cause
    return isinstance(cause, ApplicationError) and cause.type == "NonRetryableEffect"


class DraftRequest(TypedDict):
    draft_id: str


DRAFT_ATTEMPTS = 3


class ScanRequest(TypedDict):
    import_id: str


@workflow.defn(name="rcm_system_scan")
class RcmSystemScanWorkflow:
    """Identifies the systems in one uploaded RCM, with retries."""

    @workflow.run
    async def run(self, payload: ScanRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "scan_rcm_systems",
                args=[payload["import_id"]],
                start_to_close_timeout=timedelta(minutes=4),
                retry_policy=RetryPolicy(
                    maximum_attempts=DRAFT_ATTEMPTS, maximum_interval=timedelta(minutes=2)
                ),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_rcm_system_scan",
                args=[payload["import_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


class AnalysisRequest(TypedDict):
    analysis_id: str


@workflow.defn(name="evidence_analysis")
class EvidenceAnalysisWorkflow:
    """Reads and classifies one stored evidence file, with retries."""

    @workflow.run
    async def run(self, payload: AnalysisRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "analyze_evidence_file",
                args=[payload["analysis_id"]],
                start_to_close_timeout=timedelta(minutes=8),
                retry_policy=RetryPolicy(
                    maximum_attempts=DRAFT_ATTEMPTS, maximum_interval=timedelta(minutes=2)
                ),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_evidence_analysis",
                args=[payload["analysis_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


class TurnRequest(TypedDict):
    message_id: str


class TestRunRequest(TypedDict):
    sheet_id: str


class WorkpaperRequest(TypedDict):
    workpaper_id: str


@workflow.defn(name="workpaper_draft")
class WorkpaperDraftWorkflow:
    """The agent drafts one workpaper, with retries."""

    @workflow.run
    async def run(self, payload: WorkpaperRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "draft_workpaper",
                args=[payload["workpaper_id"]],
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_workpaper_draft",
                args=[payload["workpaper_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


class ReviewRequest(TypedDict):
    review_id: str


@workflow.defn(name="control_review")
class ControlReviewWorkflow:
    """The independent reviewer re-performs one control's testing, with retries."""

    @workflow.run
    async def run(self, payload: ReviewRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "reperform_review",
                args=[payload["review_id"]],
                start_to_close_timeout=timedelta(minutes=15),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_review",
                args=[payload["review_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


class SetupDraftRequest(TypedDict):
    project_id: str


class PlanRunRequest(TypedDict):
    plan_id: str


@workflow.defn(name="evidence_plan_run")
class EvidencePlanRunWorkflow:
    """The planner agent plans a launched control, with retries; the rules' plan stands
    if it cannot."""

    @workflow.run
    async def run(self, payload: PlanRunRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "run_evidence_plan",
                args=[payload["plan_id"]],
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_evidence_plan_run",
                args=[payload["plan_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


class SystemReviewRequest(TypedDict):
    application_id: str


@workflow.defn(name="system_review")
class SystemReviewWorkflow:
    """The scoping agent reviews one in-scope system, with retries."""

    @workflow.run
    async def run(self, payload: SystemReviewRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "review_system",
                args=[payload["application_id"]],
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_system_review",
                args=[payload["application_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


class PriorYearRequest(TypedDict):
    document_id: str


@workflow.defn(name="prior_year_run")
class PriorYearWorkflow:
    """The agent matches and analyses one prior-year reference, with retries."""

    @workflow.run
    async def run(self, payload: PriorYearRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "run_prior_year",
                args=[payload["document_id"]],
                start_to_close_timeout=timedelta(minutes=30),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_prior_year_run",
                args=[payload["document_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


class NarrativeRequest(TypedDict):
    control_id: str


@workflow.defn(name="process_narrative_run")
class NarrativeWorkflow:
    """The agents draft and review one control's process narrative, with retries."""

    @workflow.run
    async def run(self, payload: NarrativeRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "run_narrative",
                args=[payload["control_id"]],
                start_to_close_timeout=timedelta(minutes=30),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_narrative_run",
                args=[payload["control_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


@workflow.defn(name="setup_draft")
class SetupDraftWorkflow:
    """The planner drafts an engagement's setup, with retries."""

    @workflow.run
    async def run(self, payload: SetupDraftRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "draft_setup",
                args=[payload["project_id"]],
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_setup_draft",
                args=[payload["project_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


@workflow.defn(name="control_testing")
class ControlTestingWorkflow:
    """The control's tester tests a sheet's items, with retries, and again if asked."""

    @workflow.run
    async def run(self, payload: TestRunRequest) -> str:
        for _ in range(5):
            try:
                result = await workflow.execute_activity(
                    "test_control",
                    args=[payload["sheet_id"]],
                    start_to_close_timeout=timedelta(minutes=30),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
            except ActivityError:
                await workflow.execute_activity(
                    "fail_test_run",
                    args=[payload["sheet_id"]],
                    start_to_close_timeout=timedelta(seconds=30),
                )
                return "FAILED"
            if str(result) != "AGAIN":
                return str(result)
        return "AGAIN"


@workflow.defn(name="console_turn")
class ConsoleTurnWorkflow:
    """Answers one message in the agent console, with one retry."""

    @workflow.run
    async def run(self, payload: TurnRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "answer_console_turn",
                args=[payload["message_id"]],
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_console_turn",
                args=[payload["message_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)


@workflow.defn(name="pbc_draft")
class PbcDraftWorkflow:
    """Drafts one evidence request, with retries. The database decides whether to draft."""

    @workflow.run
    async def run(self, payload: DraftRequest) -> str:
        try:
            result = await workflow.execute_activity(
                "draft_pbc_request",
                args=[payload["draft_id"]],
                start_to_close_timeout=timedelta(minutes=4),
                retry_policy=RetryPolicy(
                    maximum_attempts=DRAFT_ATTEMPTS, maximum_interval=timedelta(minutes=2)
                ),
            )
        except ActivityError:
            await workflow.execute_activity(
                "fail_pbc_draft",
                args=[payload["draft_id"]],
                start_to_close_timeout=timedelta(seconds=30),
            )
            return "FAILED"
        return str(result)
