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


def _rejected(error: ActivityError) -> bool:
    cause = error.cause
    return isinstance(cause, ApplicationError) and cause.type == "NonRetryableEffect"
