"""The engagement workspace: dashboard, controls register, project plan, timeline, and
deficiencies. Everything here is read from the engagement's own records, so the pages
always agree with each other.

Deficiencies follow the SOX evaluation: each has a condition, criteria, cause, and
effect, a design or operating type, and a severity (control deficiency, significant
deficiency, or material weakness) informed by likelihood and magnitude. A severity of
significant deficiency or material weakness, either way, and closing a deficiency,
take effect only when the engagement's reviewer approves, and never by the person who
asked for the change.
"""

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api import independence
from ai_workforce_api.agent_runs import RunState, run_state
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.control_activity import ActivityItem, control_activity
from ai_workforce_api.control_instances import control_label
from ai_workforce_api.control_journey import Actor as JourneyActor
from ai_workforce_api.control_journey import (
    ControlJourney,
    NotFinal,
    finality,
    finality_facts,
    journey_of,
    leading_reason,
    round_in_hand,
)
from ai_workforce_api.control_reviews import (
    REVIEW_STEPS,
    review_overview,
    review_states,
    round_review_states,
)
from ai_workforce_api.controls import DOMAIN_LABELS, ITGC_DOMAINS, sample_size
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_plans import (
    ATTRIBUTES_SETTLED_SQL,
    population_waiting_controls,
    reconcile_waiting,
    unplanned_controls,
    unrequested_controls,
)
from ai_workforce_api.profile_checks import period_state
from ai_workforce_api.readiness import readiness_states
from ai_workforce_api.schedule import KIND_PHASES, PHASE_KEYS, standard_schedule
from ai_workforce_api.settings import Settings
from ai_workforce_api.test_rounds import (
    cancel_retest,
    draft_remediation_request,
    start_retest,
)

Severity = Literal["CONTROL_DEFICIENCY", "SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS"]
Status = Literal["OPEN", "REMEDIATION_IN_PROGRESS", "READY_FOR_RETEST", "REMEDIATED", "CLOSED"]
SEVERE = {"SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS"}
DONE_TASKS = {"SUCCEEDED", "CANCELLED"}
OPEN_PBC = {
    "DRAFT",
    "APPROVAL_PENDING",
    "SENT",
    "WAITING_FOR_RESPONSE",
    "PARTIALLY_RECEIVED",
    "OVERDUE",
    "ESCALATED",
}
RECEIVED_PBC = {"RECEIVED", "CLOSED"}
_CREDENTIAL = re.compile(
    r"(?i)(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|private[_-]?key)"
    r"\s*[:=]\s*\S{8,}"
    r"|password\s*[:=]\s*(?=\S*[0-9])(?=\S*[A-Za-z])\S{6,}"
    r"|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY"
)


class WorkspaceState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


def category(domain: str) -> str:
    if domain in (*ITGC_DOMAINS, "ITAC"):
        return "it"
    if domain == "IPE":
        return "reports"
    return "business"


def suggested_severity(likelihood: str, magnitude: str) -> str:
    """The usual reading of likelihood and magnitude. A person decides the severity."""
    if likelihood == "REMOTE" or magnitude == "INCONSEQUENTIAL":
        return "CONTROL_DEFICIENCY"
    if magnitude == "MATERIAL":
        return "MATERIAL_WEAKNESS"
    return "SIGNIFICANT_DEFICIENCY"


# Bodies


class PhaseBody(BaseModel):
    key: str
    name: str
    position: int
    planned_start: date
    planned_end: date
    version: int
    tasks: int
    done: int
    overdue: int
    status: Literal["NOT_STARTED", "IN_PROGRESS", "DONE", "AT_RISK"]


class MilestoneBody(BaseModel):
    key: str
    name: str
    phase_key: str
    due_date: date
    completed_at: datetime | None
    version: int
    status: Literal["DONE", "UPCOMING", "DUE_SOON", "MISSED"]


class PlanTask(BaseModel):
    id: UUID
    title: str
    status: str
    phase_key: str | None
    plan_kind: str | None
    control_id: UUID | None
    control_ref: str | None
    agent: str | None
    assignee: str | None
    deadline: datetime | None
    waiting_on: int


class AutomationBody(BaseModel):
    """Whether queued agent runs will be picked up (M1d). The web says "running" only
    when a run record is active and this says a worker exists; otherwise automated
    execution is reported as unavailable rather than implied."""

    available: bool
    provider: Literal["workflow", "local", "none"]
    detail: str
    # Milestone 3a: the model behind the agents, from the settings and the recorded
    # calls, never by calling it. "live" is a priced, pinned model per tier; "local" the
    # mock adapter; "none" a named provider without a key or a price.
    model: Literal["live", "local", "none"] = "local"
    model_detail: str = ""
    models: dict[str, str] = Field(default_factory=dict)
    last_call_status: str | None = None
    last_call_at: datetime | None = None
    # The engagement's model spend this calendar month (UTC) against the limits, in
    # micro-dollars; 0 as a limit means none (Milestone 3a closure: visible usage).
    budget: dict[str, int] = Field(default_factory=dict)


def automation_of(settings: Settings) -> AutomationBody:
    from ai_workforce_api.model_providers import (
        check_model_configuration,
        live_model,
        tier_model,
    )

    model: Literal["live", "local", "none"] = "local"
    model_detail = "The mock model adapter answers; no call leaves the process."
    models: dict[str, str] = {}
    if settings.model_provider not in ("", "mock", "local"):
        problems = check_model_configuration(settings)
        if live_model(settings) and not problems:
            model = "live"
            models = {tier: tier_model(settings, tier) for tier in ("FAST", "BALANCED", "DEEP")}
            model_detail = "The agents call the configured provider on three pinned models."
        else:
            model = "none"
            model_detail = (
                "; ".join(problems)
                if problems
                else "A model provider is named without a key, so no model call can be made."
            )
    if settings.workflow_address != "":
        return AutomationBody(
            available=True,
            provider="workflow",
            detail="A durable workflow engine runs the agents' queued work.",
            model=model,
            model_detail=model_detail,
            models=models,
        )
    if settings.local_worker_enabled:
        return AutomationBody(
            available=True,
            provider="local",
            detail="The API's local worker runs the agents' queued work.",
            model=model,
            model_detail=model_detail,
            models=models,
        )
    return AutomationBody(
        available=False,
        provider="none",
        detail="No agent worker is configured: queued runs stay queued until one is.",
        model=model,
        model_detail=model_detail,
        models=models,
    )


def _with_last_call(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    body: AutomationBody,
    settings: Settings,
) -> AutomationBody:
    """The engagement's latest recorded call, so a page can say when the model last
    answered or failed without calling it."""
    from ai_workforce_api.provenance import month_spend

    spent = month_spend(connection, project_id)
    budget = {
        "month_spent_micros": spent,
        "month_limit_micros": settings.model_budget_engagement_month_micros,
        "month_remaining_micros": max(0, settings.model_budget_engagement_month_micros - spent)
        if settings.model_budget_engagement_month_micros
        else 0,
        "call_limit_micros": settings.model_budget_call_micros,
        "job_limit_micros": settings.model_budget_job_micros,
    }
    row = connection.execute(
        "SELECT status, created_at FROM model_calls WHERE project_id = %s "
        "ORDER BY created_at DESC LIMIT 1",
        (project_id,),
    ).fetchone()
    if row is None:
        return body.model_copy(update={"budget": budget})
    return body.model_copy(
        update={"last_call_status": str(row[0]), "last_call_at": row[1], "budget": budget}
    )


class PlanBody(BaseModel):
    started: bool
    kickoff: date | None
    period_end: date | None
    schedule_missing: bool
    phases: list[PhaseBody]
    milestones: list[MilestoneBody]
    tasks: list[PlanTask]


class StageBody(BaseModel):
    walkthrough: str
    evidence: str
    test: str
    review: str


class RoundReview(BaseModel):
    """A testing round's independent review, as the register shows it."""

    round_id: UUID
    kind: str
    round_status: str
    status: Literal["OPEN", "SIGNED_OFF"] | None
    left: str | None


class ControlRequest(BaseModel):
    id: UUID
    kind: Literal["EVIDENCE", "SAMPLES", "FOLLOW_UP"]
    title: str
    status: str
    due_at: datetime
    # The testing phase it serves (evidence_plans.py); None for a request not tied to one.
    phase: str | None = None
    # Its version, for a change made from the register (submitting drafts together).
    version: int = 1
    recipient: str = ""
    # Made at kickoff, before the control's evidence was planned (operation key).
    kickoff: bool = False
    # AGENT: the evidence coordinator drafted it, and a person approves it first. PERSON:
    # a person wrote it, and it is sent directly (outbound.send_written).
    drafted_by: Literal["AGENT", "PERSON"] = "AGENT"
    # The latest approval asked for sending it: PENDING, APPROVED, REJECTED, EXPIRED,
    # FAILED (approved, but the send was refused, so nothing went out), or RESEND (the
    # same message was approved and refused only because email was off: send it again),
    # who asked, and the approver's decision.
    approval_id: UUID | None = None
    approval_decision: str | None = None
    approval_requested_by: UUID | None = None
    approval_reason: str | None = None
    approval_decided_by: str | None = None
    # The person reading may decide its open approval: they have the right, and they are
    # not the one who asked (approvals.py enforces the same).
    viewer_can_decide: bool = False


# Where a control is in the work: one stage each, in order, so the stages add up to the
# controls in scope. Worked out from the records in progress_of().
Progress = Literal[
    "PLAN_TO_APPROVE",
    "TO_REQUEST",
    "AWAITING_EVIDENCE",
    "EVIDENCE_RECEIVED",
    "READY_FOR_TESTING",
    "AGENT_TESTING",
    "RESULTS_TO_CONFIRM",
    "TESTING_REOPENED",
    "AWAITING_REVIEW",
    "REVIEW_NOTES",
    "CONCLUDED",
]
# The stage a not-final conclusion reads as, from the step of what keeps it open
# (control_journey.NotFinal); CONCLUDED is reserved for a final conclusion.
_PROGRESS_FOR_STEP: dict[str, Progress] = {
    "PLAN": "PLAN_TO_APPROVE",
    "REQUEST": "TO_REQUEST",
    "TEST": "READY_FOR_TESTING",
    "CONCLUDE": "RESULTS_TO_CONFIRM",
    "REVIEW": "AWAITING_REVIEW",
    "DONE": "CONCLUDED",
}
# Who the next step belongs to: a preparer (task.update), an approver of outbound
# requests (project.update), the engagement's independent reviewer, the client, an agent.
# Who a control's next step belongs to (control_journey.Actor, defined there so the
# journey needs nothing from this module at import time).
Actor = JourneyActor


class PhaseEvidence(BaseModel):
    """A testing phase's evidence requests: how many, and how many are in."""

    phase: str
    requests: int
    received: int
    drafted: int
    out: int
    late: int


class ApplicationStatus(BaseModel):
    files: int = 0
    # PASS, EXCEPTION, or OPEN while it is not tested or decided; None with no test item.
    result: Literal["PASS", "EXCEPTION", "OPEN"] | None = None


class AgentRuns(BaseModel):
    """A control's agents at work, from their run records only: files being read (and
    those that could not be), the tester's run, a workpaper being drafted, the reviewer
    agent's re-performance, and which of them stopped and need a person to start again.
    Queued is handed to the background and not yet picked up; running is executing now."""

    reading: int = 0
    read_failed: int = 0
    testing: RunState = "IDLE"
    drafting: RunState = "IDLE"
    reviewing: RunState = "IDLE"
    stopped: list[Literal["drafting", "reviewing"]] = Field(default_factory=list)


class ControlRow(BaseModel):
    id: UUID
    control_ref: str
    title: str
    activity: str
    category: str
    domain: str
    domain_label: str
    area: str
    frequency: str
    frequency_label: str
    nature: str
    nature_label: str
    key_control: bool
    included: bool
    owner_name: str
    owner_email: str
    systems: list[str]
    sample_size: int
    agent_key: str
    # The instance's application (Milestone 8.5), and the name pages show.
    application_id: UUID | None = None
    application_name: str = ""
    label: str = ""
    stage: str
    stages: StageBody
    evidence_requests: int
    evidence_received: int
    deficiencies: int
    worst_severity: str | None
    conclusion: Literal["NOT_CONCLUDED", "EFFECTIVE", "EXCEPTION"]
    risk: str = ""
    test_attributes: list[str] = []
    pbc_items: list[str] = []
    test_status: str | None = None
    # The test sheet (8.2): OPEN or SIGNED_OFF, what is left, and its signed-off result.
    sheet_status: Literal["OPEN", "SIGNED_OFF"] | None = None
    sheet_left: (
        Literal["EVIDENCE", "TESTING", "DECIDE", "SIGN_OFF", "PLACE", "DEFICIENCY"] | None
    ) = None
    test_result: Literal["EFFECTIVE", "NOT_EFFECTIVE"] | None = None
    # The independent review (9.1): OPEN or SIGNED_OFF, and what it waits for.
    review_status: Literal["OPEN", "SIGNED_OFF"] | None = None
    review_left: (
        Literal["REPERFORMING", "REPERFORM", "DECIDE", "ADDRESS", "CLEAR", "SIGN", "SIGNED"] | None
    ) = None
    # Per application the control covers: its evidence files and its test result.
    by_application: dict[str, ApplicationStatus] = {}
    # What happens next, and who it waits on: the audit team, the control owner, or an
    # agent. Derived here so every page says the same thing.
    next_step: str = ""
    waiting_on: Literal["TEAM", "OWNER", "AGENT", "NONE"] = "NONE"
    overdue: bool = False
    requests: list[ControlRequest] = []
    # Whether the control can be tested (readiness.py), and the first thing in the way.
    readiness_state: str = "READY"
    readiness_label: str = ""
    readiness_blocker: str = ""
    # The interim population is not yet accepted on the evidence plan, so its samples
    # cannot be approved (evidence_plans.population_gate).
    population_pending: bool = False
    # The tester agent is testing (queued or working) now.
    testing_running: bool = False
    # The control's stage in the work, who its next step belongs to, and whether that is
    # the person asking (their role, the engagement's reviewer, independence, and any
    # person the control's work is assigned to).
    progress: Progress = "TO_REQUEST"
    actor: Actor = "NONE"
    yours: bool = False
    # The people the control's open work is assigned to, by display name (M1d): who a
    # preparer's step waits on when it is not the viewer's.
    assignees: list[str] = []
    # The next step is submitting a drafted request: done together, not control by control.
    drafted: bool = False
    # An exception in its testing or an open deficiency.
    exceptions: bool = False
    evidence_phases: list[PhaseEvidence] = []
    # The instance's application, as its system record says: its layer and hosting
    # (rcm_systems, system_scoping), for the register's neutral system icon.
    application_layer: str | None = None
    application_hosting: str | None = None
    # What the control's agents are doing, from their run records.
    agents: AgentRuns = Field(default_factory=lambda: AgentRuns())
    # Whether its evidence is planned (evidence_plans.py). PROPOSED: planned, waiting for a
    # person's approval; nothing is requested before then. NONE: a running engagement's
    # control launched before evidence planning existed.
    evidence_plan: Literal["PLANNED", "PROPOSED", "NONE"] = "PLANNED"
    # The reviewer asked for changes to its test plan (it reads as PROPOSED above: it waits
    # for a person).
    plan_changes_requested: bool = False
    # Operating phases a person released (phase_release.py), and the one ready to release.
    released_phases: list[str] = Field(default_factory=list)
    release_ready: str | None = None
    # Its attributes are settled: operating evidence is requested only then.
    attributes_settled: bool = True
    # A kickoff draft holds plan items until a person reconciles it (evidence_plans).
    reconcile: bool = False
    # The conclusion is final (control_journey.finality): every required phase and round
    # tested and independently reviewed, no plan change awaiting assessment. `conclusion`
    # is the opinion; only `final` means complete (docs/workflow-integrity.md §2).
    final: bool = False
    not_final: list[NotFinal] = []
    # A signed-off sheet opened again: why, and from what (migration 0089).
    reopen_reason: str = ""
    reopened_from: Literal["REVIEW_NOTE", "IMPACT_ASSESSMENT", "PERSON"] | None = None
    # Each testing round's own independent review (workflow integrity W2).
    round_reviews: list[RoundReview] = []
    # Where the control is in Plan → Request → Test → Conclude → Review, each phase's
    # state and readiness, and what is outstanding (control_journey.py, Milestone 0).
    journey: ControlJourney | None = None


class DeficiencyBody(BaseModel):
    id: UUID
    reference: str
    control_id: UUID | None
    control_ref: str | None
    title: str
    condition: str
    criteria: str
    cause: str
    effect: str
    deficiency_type: str
    likelihood: str
    magnitude: str
    severity: str
    suggested_severity: str
    compensating_controls: str
    status: str
    remediation_owner: str
    remediation_plan: str
    remediation_due: date | None
    retest_result: str
    retested_at: date | None
    source: str
    pending_change: dict[str, Any] | None
    # The date the fix took effect, and the request to the owner for the remediation.
    remediated_on: date | None = None
    remediation_request_id: UUID | None = None
    application_name: str = ""
    identified_by: str
    identified_at: datetime
    closed_at: datetime | None
    version: int
    can_decide: bool


class DashboardBody(BaseModel):
    started: bool
    controls: dict[str, Any]
    evidence: dict[str, Any]
    deficiencies: dict[str, Any]
    schedule: dict[str, Any]
    work: dict[str, Any]
    # The independent review across the engagement (9.2).
    review: dict[str, Any] = {}
    # Where the period disagrees with the engagement's name, scope, or fiscal year and no
    # person confirmed it as recorded (profile_checks.py).
    period_conflicts: list[str] = []
    # In-scope controls with no evidence plan: launched before evidence planning existed.
    unplanned_controls: int = 0
    # Planned controls whose design or interim evidence was never requested.
    unrequested_controls: int = 0
    # Drafted requests with no one to send them to (no owner email, no coordinator).
    unaddressed_requests: int = 0


class PhaseUpdate(BaseModel):
    version: int = Field(ge=1)
    planned_start: date
    planned_end: date


class MilestoneUpdate(BaseModel):
    version: int = Field(ge=1)
    due_date: date
    completed: bool


class DeficiencyCreate(BaseModel):
    control_id: UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    condition: str = Field(default="", max_length=4000)
    criteria: str = Field(default="", max_length=4000)
    cause: str = Field(default="", max_length=4000)
    effect: str = Field(default="", max_length=4000)
    deficiency_type: Literal["DESIGN", "OPERATING"]
    likelihood: Literal["REMOTE", "REASONABLY_POSSIBLE", "PROBABLE"] = "REASONABLY_POSSIBLE"
    magnitude: Literal["INCONSEQUENTIAL", "MORE_THAN_INCONSEQUENTIAL", "MATERIAL"] = (
        "MORE_THAN_INCONSEQUENTIAL"
    )
    severity: Severity = "CONTROL_DEFICIENCY"
    compensating_controls: str = Field(default="", max_length=4000)
    remediation_owner: str = Field(default="", max_length=200)
    remediation_plan: str = Field(default="", max_length=4000)
    remediation_due: date | None = None


class DeficiencyUpdate(BaseModel):
    version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    condition: str = Field(default="", max_length=4000)
    criteria: str = Field(default="", max_length=4000)
    cause: str = Field(default="", max_length=4000)
    effect: str = Field(default="", max_length=4000)
    deficiency_type: Literal["DESIGN", "OPERATING"]
    likelihood: Literal["REMOTE", "REASONABLY_POSSIBLE", "PROBABLE"]
    magnitude: Literal["INCONSEQUENTIAL", "MORE_THAN_INCONSEQUENTIAL", "MATERIAL"]
    compensating_controls: str = Field(default="", max_length=4000)
    remediation_owner: str = Field(default="", max_length=200)
    remediation_plan: str = Field(default="", max_length=4000)
    remediation_due: date | None = None


class DeficiencyProgress(BaseModel):
    version: int = Field(ge=1)
    status: Literal["OPEN", "REMEDIATION_IN_PROGRESS", "READY_FOR_RETEST"] | None = None
    retest_result: Literal["PASSED", "FAILED"] | None = None
    # Required to mark a deficiency on a control ready for retest: the retest samples
    # only from this date on.
    remediated_on: date | None = None


class ChangeRequest(BaseModel):
    version: int = Field(ge=1)
    kind: Literal["SEVERITY", "CLOSE"]
    severity: Severity | None = None
    reason: str = Field(min_length=1, max_length=1000)


class ChangeDecision(BaseModel):
    version: int = Field(ge=1)
    approve: bool
    reason: str = Field(default="", max_length=1000)


def register_workspace(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except WorkspaceState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.get(f"{base}/controls/{{control_id}}/activity")
    def activity(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> list[ActivityItem]:
        return run(
            request,
            lambda c, p: control_activity(c, p, organization_id, project_id, control_id),
        )

    @app.get(f"{base}/workspace/automation")
    def automation(organization_id: UUID, project_id: UUID, request: Request) -> AutomationBody:
        def read(connection: psycopg.Connection[Any], principal: Principal) -> AutomationBody:
            _authorize(connection, principal, organization_id, project_id, Action.TASK_READ)
            return _with_last_call(connection, project_id, automation_of(settings), settings)

        return run(request, read)

    @app.get(f"{base}/workspace/plan")
    def plan(organization_id: UUID, project_id: UUID, request: Request) -> PlanBody:
        return run(request, lambda c, p: _plan(c, p, organization_id, project_id))

    @app.post(f"{base}/workspace/schedule")
    def create_schedule(organization_id: UUID, project_id: UUID, request: Request) -> PlanBody:
        return run(request, lambda c, p: _create_schedule(c, p, organization_id, project_id))

    @app.patch(f"{base}/workspace/phases/{{phase_key}}")
    def update_phase(
        organization_id: UUID,
        project_id: UUID,
        phase_key: str,
        body: PhaseUpdate,
        request: Request,
    ) -> PlanBody:
        return run(
            request, lambda c, p: _update_phase(c, p, organization_id, project_id, phase_key, body)
        )

    @app.patch(f"{base}/workspace/milestones/{{milestone_key}}")
    def update_milestone(
        organization_id: UUID,
        project_id: UUID,
        milestone_key: str,
        body: MilestoneUpdate,
        request: Request,
    ) -> PlanBody:
        return run(
            request,
            lambda c, p: _update_milestone(c, p, organization_id, project_id, milestone_key, body),
        )

    @app.get(f"{base}/workspace/controls")
    def controls(organization_id: UUID, project_id: UUID, request: Request) -> list[ControlRow]:
        return run(request, lambda c, p: _controls(c, p, organization_id, project_id))

    @app.get(f"{base}/workspace/dashboard")
    def dashboard(organization_id: UUID, project_id: UUID, request: Request) -> DashboardBody:
        return run(request, lambda c, p: _dashboard(c, p, organization_id, project_id))

    @app.get(f"{base}/deficiencies")
    def deficiencies(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[DeficiencyBody]:
        return run(request, lambda c, p: _deficiencies(c, p, organization_id, project_id))

    @app.post(f"{base}/deficiencies")
    def create_deficiency(
        organization_id: UUID, project_id: UUID, body: DeficiencyCreate, request: Request
    ) -> DeficiencyBody:
        return run(request, lambda c, p: _create(c, p, organization_id, project_id, body))

    @app.patch(f"{base}/deficiencies/{{deficiency_id}}")
    def update_deficiency(
        organization_id: UUID,
        project_id: UUID,
        deficiency_id: UUID,
        body: DeficiencyUpdate,
        request: Request,
    ) -> DeficiencyBody:
        return run(
            request,
            lambda c, p: _update(c, p, organization_id, project_id, deficiency_id, body),
        )

    @app.post(f"{base}/deficiencies/{{deficiency_id}}/progress")
    def progress(
        organization_id: UUID,
        project_id: UUID,
        deficiency_id: UUID,
        body: DeficiencyProgress,
        request: Request,
    ) -> DeficiencyBody:
        return run(
            request,
            lambda c, p: _progress(c, p, organization_id, project_id, deficiency_id, body),
        )

    @app.post(f"{base}/deficiencies/{{deficiency_id}}/changes")
    def request_change(
        organization_id: UUID,
        project_id: UUID,
        deficiency_id: UUID,
        body: ChangeRequest,
        request: Request,
    ) -> DeficiencyBody:
        return run(
            request,
            lambda c, p: _request_change(c, p, organization_id, project_id, deficiency_id, body),
        )

    @app.post(f"{base}/deficiencies/{{deficiency_id}}/changes/decide")
    def decide(
        organization_id: UUID,
        project_id: UUID,
        deficiency_id: UUID,
        body: ChangeDecision,
        request: Request,
    ) -> DeficiencyBody:
        return run(
            request,
            lambda c, p: _decide(c, p, organization_id, project_id, deficiency_id, body),
        )


# Schedule


def create_engagement_schedule(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    kickoff: date,
    period_end: date,
    pbc_due_days: int,
) -> None:
    """Lay out the standard calendar and give each kickoff task its phase's deadline."""
    schedule = standard_schedule(kickoff, period_end, pbc_due_days)
    for phase in schedule.phases:
        cursor.execute(
            """
            INSERT INTO engagement_phases (
                organization_id, project_id, phase_key, name, position, planned_start,
                planned_end
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id, phase_key) DO NOTHING
            """,
            (
                organization_id,
                project_id,
                phase.key,
                phase.name,
                phase.position,
                phase.start,
                phase.end,
            ),
        )
    for milestone in schedule.milestones:
        cursor.execute(
            """
            INSERT INTO engagement_milestones (
                organization_id, project_id, milestone_key, name, phase_key, position, due_date
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id, milestone_key) DO NOTHING
            """,
            (
                organization_id,
                project_id,
                milestone.key,
                milestone.name,
                milestone.phase_key,
                milestone.position,
                milestone.due,
            ),
        )
    # Kickoff and scoping happen in engagement setup, so both are done when it starts.
    cursor.execute(
        """
        UPDATE engagement_milestones m
        SET completed_at = s.kicked_off_at, completed_by = s.kicked_off_by,
            version = m.version + 1, updated_at = clock_timestamp()
        FROM engagement_settings s
        WHERE s.project_id = m.project_id AND m.project_id = %s
          AND m.milestone_key IN ('KICKOFF', 'SCOPING_COMPLETE')
          AND m.completed_at IS NULL AND s.kicked_off_at IS NOT NULL
        """,
        (project_id,),
    )
    for kind, phase_key in KIND_PHASES.items():
        if kind == "evidence":
            continue  # Evidence tasks keep the PBC due date set at kickoff.
        end = schedule.phase(phase_key).end
        cursor.execute(
            """
            UPDATE tasks SET deadline = %s, version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s AND plan_kind = %s AND deadline IS NULL
            """,
            (
                datetime.combine(end, datetime.min.time(), tzinfo=UTC)
                + timedelta(hours=23, minutes=59),
                project_id,
                kind,
            ),
        )


def _authorize(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    action: Action,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=action,
        organization_id=organization_id,
        project_id=project_id,
    )


def _engagement(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
) -> tuple[date | None, date | None, int]:
    row = connection.execute(
        """
        SELECT s.kicked_off_at, s.period_end, s.pbc_due_days
        FROM engagement_settings s JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = %s AND p.organization_id = %s
        """,
        (project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    kicked = row[0].date() if row[0] is not None else None
    return kicked, row[1], int(row[2])


def _plan(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> PlanBody:
    _authorize(connection, principal, organization_id, project_id, Action.TASK_READ)
    kickoff, period_end, _due = _engagement(connection, organization_id, project_id)
    tasks = _tasks(connection, project_id)
    today = datetime.now(UTC).date()
    now = datetime.now(UTC)
    open_marks = {
        str(row[0])
        for row in connection.execute(
            "SELECT DISTINCT phase_key FROM engagement_milestones "
            "WHERE project_id = %s AND completed_at IS NULL",
            (project_id,),
        ).fetchall()
    }
    phases: list[PhaseBody] = []
    for row in connection.execute(
        """
        SELECT phase_key, name, position, planned_start, planned_end, version
        FROM engagement_phases WHERE project_id = %s ORDER BY position
        """,
        (project_id,),
    ).fetchall():
        mine = [task for task in tasks if task.phase_key == row[0]]
        done = sum(1 for task in mine if task.status in DONE_TASKS)
        overdue = sum(
            1
            for task in mine
            if task.status not in DONE_TASKS and task.deadline is not None and task.deadline < now
        )
        status: Literal["NOT_STARTED", "IN_PROGRESS", "DONE", "AT_RISK"]
        if (mine and done == len(mine)) or (not mine and row[0] not in open_marks):
            status = "DONE"
        elif overdue or (row[4] < today and mine and done < len(mine)):
            status = "AT_RISK"
        elif row[3] <= today or any(task.status not in ("READY", "DRAFT") for task in mine):
            status = "IN_PROGRESS"
        else:
            status = "NOT_STARTED"
        phases.append(
            PhaseBody(
                key=row[0],
                name=row[1],
                position=row[2],
                planned_start=row[3],
                planned_end=row[4],
                version=row[5],
                tasks=len(mine),
                done=done,
                overdue=overdue,
                status=status,
            )
        )
    milestones: list[MilestoneBody] = []
    for row in connection.execute(
        """
        SELECT milestone_key, name, phase_key, due_date, completed_at, version
        FROM engagement_milestones WHERE project_id = %s ORDER BY due_date, position
        """,
        (project_id,),
    ).fetchall():
        state: Literal["DONE", "UPCOMING", "DUE_SOON", "MISSED"]
        if row[4] is not None:
            state = "DONE"
        elif row[3] < today:
            state = "MISSED"
        elif row[3] <= today + timedelta(days=14):
            state = "DUE_SOON"
        else:
            state = "UPCOMING"
        milestones.append(
            MilestoneBody(
                key=row[0],
                name=row[1],
                phase_key=row[2],
                due_date=row[3],
                completed_at=row[4],
                version=row[5],
                status=state,
            )
        )
    return PlanBody(
        started=kickoff is not None,
        kickoff=kickoff,
        period_end=period_end,
        schedule_missing=kickoff is not None and not phases,
        phases=phases,
        milestones=milestones,
        tasks=tasks,
    )


def _tasks(connection: psycopg.Connection[Any], project_id: UUID) -> list[PlanTask]:
    rows = connection.execute(
        """
        SELECT t.id, t.title, t.status::text, t.phase_key, t.plan_kind, t.engagement_control_id,
               c.control_ref, d.name, u.display_name, t.deadline,
               (SELECT count(*) FROM task_dependencies td
                JOIN tasks pre ON pre.id = td.depends_on_task_id
                WHERE td.task_id = t.id AND pre.status::text NOT IN ('SUCCEEDED', 'CANCELLED'))
        FROM tasks t
        LEFT JOIN engagement_controls c ON c.id = t.engagement_control_id
        LEFT JOIN agent_instances i ON i.id = t.agent_instance_id
        LEFT JOIN agent_definitions d ON d.id = i.agent_definition_id
        LEFT JOIN users u ON u.id = t.assignee_user_id
        WHERE t.project_id = %s
        ORDER BY t.deadline NULLS LAST, c.control_ref NULLS LAST, t.created_at
        """,
        (project_id,),
    ).fetchall()
    return [
        PlanTask(
            id=row[0],
            title=row[1],
            status=row[2],
            phase_key=row[3],
            plan_kind=row[4],
            control_id=row[5],
            control_ref=row[6],
            agent=row[7],
            assignee=row[8],
            deadline=row[9],
            waiting_on=int(row[10]),
        )
        for row in rows
    ]


def _create_schedule(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> PlanBody:
    """For an engagement started before the workspace existed: lay out its calendar now."""
    _authorize(connection, principal, organization_id, project_id, Action.PROJECT_UPDATE)
    kickoff, period_end, due_days = _engagement(connection, organization_id, project_id)
    if kickoff is None or period_end is None:
        raise WorkspaceState("start the engagement first")
    with transaction(connection) as cursor:
        create_engagement_schedule(
            cursor, organization_id, project_id, kickoff, period_end, due_days
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "workspace.schedule",
            "project",
            project_id,
            {},
        )
    return _plan(connection, principal, organization_id, project_id)


def _update_phase(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    phase_key: str,
    body: PhaseUpdate,
) -> PlanBody:
    _authorize(connection, principal, organization_id, project_id, Action.PROJECT_UPDATE)
    if phase_key not in PHASE_KEYS:
        raise NotVisible()
    if body.planned_start > body.planned_end:
        raise ValueError("a phase cannot end before it starts")
    with transaction(connection) as cursor:
        current = cursor.execute(
            """
            SELECT planned_end, version FROM engagement_phases
            WHERE project_id = %s AND phase_key = %s FOR UPDATE
            """,
            (project_id, phase_key),
        ).fetchone()
        if current is None:
            raise NotVisible()
        if int(current[1]) != body.version:
            raise WorkspaceState("phase changed")
        cursor.execute(
            """
            UPDATE engagement_phases
            SET planned_start = %s, planned_end = %s, version = version + 1,
                updated_at = clock_timestamp()
            WHERE project_id = %s AND phase_key = %s
            """,
            (body.planned_start, body.planned_end, project_id, phase_key),
        )
        # Open tasks that followed the phase's end follow it to the new date.
        old_end = datetime.combine(current[0], datetime.min.time(), tzinfo=UTC)
        new_end = datetime.combine(body.planned_end, datetime.min.time(), tzinfo=UTC)
        cursor.execute(
            """
            UPDATE tasks
            SET deadline = %s + (deadline - %s), version = version + 1,
                updated_at = clock_timestamp()
            WHERE project_id = %s AND phase_key = %s AND plan_kind <> 'evidence'
              AND status::text NOT IN ('SUCCEEDED', 'CANCELLED')
              AND deadline >= %s AND deadline < %s + interval '1 day'
            """,
            (new_end, old_end, project_id, phase_key, old_end, old_end),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "workspace.phase",
            "project",
            project_id,
            {"phase": phase_key},
        )
    return _plan(connection, principal, organization_id, project_id)


def _update_milestone(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    milestone_key: str,
    body: MilestoneUpdate,
) -> PlanBody:
    _authorize(connection, principal, organization_id, project_id, Action.PROJECT_UPDATE)
    with transaction(connection) as cursor:
        updated = cursor.execute(
            """
            UPDATE engagement_milestones
            SET due_date = %s,
                completed_at = CASE WHEN %s THEN coalesce(completed_at, clock_timestamp())
                                    ELSE NULL END,
                completed_by = CASE WHEN %s THEN coalesce(completed_by, %s) ELSE NULL END,
                version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s AND milestone_key = %s AND version = %s
            RETURNING id
            """,
            (
                body.due_date,
                body.completed,
                body.completed,
                principal.id,
                project_id,
                milestone_key,
                body.version,
            ),
        ).fetchone()
        if updated is None:
            raise WorkspaceState("milestone changed")
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "workspace.milestone",
            "project",
            project_id,
            {"milestone": milestone_key, "completed": body.completed},
        )
    return _plan(connection, principal, organization_id, project_id)


# Controls register


def _controls(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[ControlRow]:
    _authorize(connection, principal, organization_id, project_id, Action.TASK_READ)
    rows = connection.execute(
        """
        SELECT c.id, c.control_ref, c.title, c.activity, c.domain, c.domain_label, c.frequency,
               c.frequency_label, c.nature, c.nature_label, c.key_control, c.included,
               c.owner_name, c.owner_email, c.agent_key,
               ARRAY(SELECT a.name FROM engagement_applications a
                     WHERE a.project_id = c.project_id AND a.id = ANY(c.application_ids)
                     ORDER BY a.name),
               c.risk, c.test_attributes, c.pbc_items,
               (SELECT t.status FROM control_tests t
                WHERE t.project_id = c.project_id AND t.engagement_control_id = c.id
                  AND t.test_round_id IS NULL),
               c.engagement_application_id,
               (SELECT a.name FROM engagement_applications a
                WHERE a.id = c.engagement_application_id),
               (SELECT a.layer FROM engagement_applications a
                WHERE a.id = c.engagement_application_id),
               (SELECT a.hosting FROM engagement_applications a
                WHERE a.id = c.engagement_application_id)
        FROM engagement_controls c
        WHERE c.project_id = %s
        ORDER BY c.control_ref, 21 NULLS FIRST
        """,
        (project_id,),
    ).fetchall()
    stages: dict[UUID, dict[str, str]] = {}
    for control_id, kind, status in connection.execute(
        """
        SELECT engagement_control_id, plan_kind, status::text FROM tasks
        WHERE project_id = %s AND engagement_control_id IS NOT NULL
        """,
        (project_id,),
    ).fetchall():
        stages.setdefault(control_id, {})[str(kind)] = str(status)
    evidence: dict[UUID, Counter[str]] = {}
    late_requests: dict[UUID, int] = {}
    now = datetime.now(UTC)
    requests: dict[UUID, list[ControlRequest]] = {}
    approvals = request_approvals(connection, project_id)
    for (
        control_id,
        status,
        request_id,
        key,
        description,
        due_at,
        phase,
        version,
        recipient,
        title,
        drafted_by,
    ) in connection.execute(
        """
        SELECT engagement_control_id, status, id, operation_key, evidence_description, due_at,
               testing_phase, version, recipient, title, drafted_by
        FROM pbc_requests
        WHERE project_id = %s AND engagement_control_id IS NOT NULL
        ORDER BY created_at
        """,
        (project_id,),
    ).fetchall():
        evidence.setdefault(control_id, Counter())[str(status)] += 1
        if is_late(str(status), due_at, now):
            late_requests[control_id] = late_requests.get(control_id, 0) + 1
        requests.setdefault(control_id, []).append(
            ControlRequest(
                id=request_id,
                kind=_request_kind(str(key)),
                title=_request_title(str(description), str(title or "")),
                status=str(status),
                due_at=due_at,
                phase=None if phase is None else str(phase),
                version=int(version),
                recipient=str(recipient),
                kickoff=str(key).startswith(("kickoff-", "scope-")),
                drafted_by="PERSON" if drafted_by == "PERSON" else "AGENT",
                **approvals.get(request_id, {}),
            )
        )
    planned = {
        row[0]: str(row[1])
        for row in connection.execute(
            "SELECT engagement_control_id, status FROM evidence_plans WHERE project_id = %s",
            (project_id,),
        ).fetchall()
    }
    settled = {
        row[0]
        for row in connection.execute(
            f"SELECT c.id FROM engagement_controls c WHERE c.project_id = %s "
            f"AND {ATTRIBUTES_SETTLED_SQL}",
            (project_id,),
        ).fetchall()
    }
    settle = reconcile_waiting(connection, project_id)
    from ai_workforce_api.phase_release import phase_statuses
    from ai_workforce_api.test_rounds import rounds as load_rounds

    phased = phase_statuses(connection, project_id)
    fin_facts = finality_facts(connection, project_id)
    reopens: dict[UUID, tuple[str, str]] = {
        row[0]: (str(row[1]), str(row[2]))
        for row in connection.execute(
            "SELECT engagement_control_id, reopen_reason, reopened_from FROM test_sheets "
            "WHERE project_id = %s AND test_round_id IS NULL AND reopened_from IS NOT NULL "
            "AND status = 'OPEN'",
            (project_id,),
        ).fetchall()
    }
    rounds_by: dict[UUID, list[Any]] = {}
    for found_round in load_rounds(connection, project_id):
        rounds_by.setdefault(found_round.control_id, []).append(found_round)
    # Each control's evidence requirements by phase and status, for the journey's
    # per-phase readiness.
    requirements: dict[UUID, dict[str, dict[str, int]]] = {}
    for control_id, phase, status, count in connection.execute(
        """
        SELECT engagement_control_id, phase, status, count(*) FROM evidence_requirements
        WHERE project_id = %s GROUP BY 1, 2, 3
        """,
        (project_id,),
    ).fetchall():
        requirements.setdefault(control_id, {}).setdefault(str(phase), {})[str(status)] = int(count)
    started = connection.execute(
        "SELECT kicked_off_at IS NOT NULL FROM engagement_settings WHERE project_id = %s",
        (project_id,),
    ).fetchone()
    sheets = _sheet_states(connection, project_id)
    reviews = review_states(connection, project_id)
    round_reviews = round_review_states(connection, project_id)
    readiness = readiness_states(connection, project_id)
    population_pending = population_waiting_controls(connection, project_id)
    per_app = _application_states(connection, project_id)
    runs = agent_runs(connection, project_id)
    findings: dict[UUID, list[str]] = {}
    for control_id, severity in connection.execute(
        """
        SELECT engagement_control_id, severity FROM deficiencies
        WHERE project_id = %s AND engagement_control_id IS NOT NULL AND status <> 'CLOSED'
        """,
        (project_id,),
    ).fetchall():
        findings.setdefault(control_id, []).append(str(severity))
    order = ["CONTROL_DEFICIENCY", "SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS"]
    result: list[ControlRow] = []
    for row in rows:
        mine = stages.get(row[0], {})
        pbc = evidence.get(row[0], Counter())
        found = findings.get(row[0], [])
        received = sum(count for status, count in pbc.items() if status in RECEIVED_PBC)
        evidence_state = (
            "RECEIVED"
            if pbc and received == sum(pbc.values())
            else "PARTIAL"
            if received or pbc.get("PARTIALLY_RECEIVED")
            else "OVERDUE"
            if late_requests.get(row[0])
            else "REQUESTED"
            if any(s in pbc for s in ("SENT", "WAITING_FOR_RESPONSE"))
            else "DRAFTED"
            if pbc
            else "NONE"
        )
        sheet = sheets.get(row[0])
        stage_body = StageBody(
            walkthrough=mine.get("walkthrough", "NONE"),
            evidence=evidence_state,
            # A test sheet says where testing is: signed off, or under way.
            test=mine.get("test", "NONE")
            if sheet is None
            else "SUCCEEDED"
            if sheet[0] == "SIGNED_OFF"
            else "RUNNING",
            review=mine.get("review", "NONE"),
        )
        worst = max(found, key=order.index) if found else None
        fin = finality(fin_facts.get(row[0]))
        # A control is concluded once its testing is reviewed: the independent review is
        # signed off and its plan task is done. A task marked done by hand, with no
        # signed-off review, does not conclude a control. A deficiency found earlier, at
        # the walkthrough, is a finding, not a conclusion.
        signed = row[0] in reviews and reviews[row[0]][0] == "SIGNED_OFF"
        conclusion: Literal["NOT_CONCLUDED", "EFFECTIVE", "EXCEPTION"]
        if stage_body.review != "SUCCEEDED" or not signed:
            conclusion = "NOT_CONCLUDED"
        elif found:
            conclusion = "EXCEPTION"
        else:
            conclusion = "EFFECTIVE"
        result.append(
            ControlRow(
                id=row[0],
                control_ref=row[1],
                title=row[2],
                activity=row[3],
                category=category(str(row[4])),
                domain=row[4],
                domain_label=row[5],
                area=row[5] or DOMAIN_LABELS.get(str(row[4]), str(row[4])),
                frequency=row[6],
                frequency_label=row[7],
                nature=row[8],
                nature_label=row[9],
                key_control=bool(row[10]),
                included=bool(row[11]),
                owner_name=row[12],
                owner_email=row[13],
                agent_key=row[14],
                systems=list(row[15]),
                application_id=row[20],
                application_name="" if row[21] is None else str(row[21]),
                label=control_label(str(row[1]), None if row[21] is None else str(row[21])),
                sample_size=sample_size(str(row[6]), str(row[8])),
                # The lifecycle reads CONCLUDED only for a final conclusion.
                stage=_stage(stage_body, conclusion if fin.final else "NOT_CONCLUDED"),
                stages=stage_body,
                evidence_requests=sum(pbc.values()),
                evidence_received=received,
                deficiencies=len(found),
                worst_severity=worst,
                conclusion=conclusion,
                risk=str(row[16] or ""),
                test_attributes=[str(item) for item in row[17] or []],
                pbc_items=[str(item) for item in row[18] or []],
                test_status=None if row[19] is None else str(row[19]),
                requests=requests.get(row[0], []),
                sheet_status=None if sheet is None else sheet[0],
                sheet_left=None if sheet is None else sheet[1],
                review_status=None if row[0] not in reviews else reviews[row[0]][0],
                review_left=None if row[0] not in reviews else reviews[row[0]][1],
                test_result=None if sheet is None else sheet[2],
                readiness_state=readiness[row[0]].state if row[0] in readiness else "READY",
                readiness_label=readiness[row[0]].label if row[0] in readiness else "",
                readiness_blocker=readiness[row[0]].first_blocker() if row[0] in readiness else "",
                population_pending=row[0] in population_pending,
                testing_running=False if sheet is None else bool(sheet[3]),
                by_application={
                    name: per_app.get((row[0], name), ApplicationStatus()) for name in row[15]
                },
                application_layer=None if row[22] is None else str(row[22]),
                application_hosting=None if row[23] is None else str(row[23]),
                agents=runs.get(row[0], AgentRuns()),
            )
        )
        current = result[-1]
        if started is not None and started[0] and current.id not in planned:
            current.evidence_plan = "NONE"
        elif planned.get(current.id) in ("PROPOSED", "CHANGES_REQUESTED"):
            current.evidence_plan = "PROPOSED"
            current.plan_changes_requested = planned.get(current.id) == "CHANGES_REQUESTED"
        current.attributes_settled = current.id in settled
        phases = phased.get(current.id)
        if phases is not None:
            current.released_phases = [
                item.phase for item in phases.phases if item.step in ("RELEASED", "COMPLETE")
            ]
            current.release_ready = next(
                (item.phase for item in phases.phases if item.step == "READY"), None
            )
        current.reconcile = current.id in settle
        current.final, current.not_final = fin.final, fin.reasons
        if current.id in reopens:
            current.reopen_reason, current.reopened_from = reopens[current.id]  # type: ignore[assignment]
        step = step_of(current, stage_body, now)
        current.next_step, current.waiting_on, current.overdue = (
            step.text,
            _WAITING[step.actor],
            step.late,
        )
        current.actor, current.drafted = step.actor, step.drafted
        current.progress = progress_of(current, stage_body, step)
        current.exceptions = (
            bool(found)
            or any(state.result == "EXCEPTION" for state in current.by_application.values())
            or current.test_result == "NOT_EFFECTIVE"
        )
        current.evidence_phases = evidence_phases(current.requests, now)
        current.round_reviews = [
            RoundReview(
                round_id=found_round.id,
                kind=str(found_round.kind),
                round_status=str(found_round.status),
                status=round_reviews[found_round.id][0]
                if found_round.id in round_reviews
                else None,
                left=round_reviews[found_round.id][1] if found_round.id in round_reviews else None,
            )
            for found_round in rounds_by.get(current.id, [])
            if found_round.status != "CANCELLED"
        ]
        current.journey = journey_of(
            current, phases, rounds_by.get(current.id, []), requirements.get(current.id)
        )
    mark_yours(connection, principal, organization_id, project_id, result)
    approver = _allowed(connection, principal, organization_id, project_id, Action.PROJECT_UPDATE)
    for row in result:
        for item in row.requests:
            item.viewer_can_decide = (
                approver
                and item.approval_decision == "PENDING"
                and item.approval_requested_by != principal.id
            )
    return result


_LATE = {"OVERDUE", "ESCALATED"}
# What an open test sheet needs next. Missing evidence falls through to the requests.
_SHEET_STEPS: dict[str, tuple[str, Literal["TEAM", "OWNER", "AGENT", "NONE"]]] = {
    "EVIDENCE": ("Waiting for sample evidence", "OWNER"),
    "PLACE": ("Link the sample evidence", "TEAM"),
    "TESTING": ("Test the evidence", "AGENT"),
    "DECIDE": ("Decide the open test results", "TEAM"),
    "SIGN_OFF": ("Sign off the testing", "TEAM"),
}


def _application_states(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[tuple[UUID, str], ApplicationStatus]:
    """Per control and application: the files that show it, and its test item's result."""
    from ai_workforce_api.test_sheets import _sheet
    from ai_workforce_api.testing_engine import OPEN_RESULTS

    states: dict[tuple[UUID, str], ApplicationStatus] = {}
    for control_id, name, files in connection.execute(
        """
        SELECT me.id, a.name, count(DISTINCT l.evidence_file_id)
        FROM engagement_controls me
        JOIN engagement_applications a ON a.id = me.engagement_application_id
        JOIN engagement_controls c
          ON c.project_id = me.project_id AND c.control_ref = me.control_ref
        JOIN evidence_file_links l ON l.engagement_control_id = c.id
        JOIN evidence_file_applications t ON t.evidence_file_id = l.evidence_file_id
        WHERE me.project_id = %s
          AND (t.scope = 'ALL' OR t.engagement_application_id = a.id
               OR (c.id = me.id AND t.scope = 'UNKNOWN'))
        GROUP BY 1, 2
        """,
        (project_id,),
    ).fetchall():
        states[(control_id, str(name))] = ApplicationStatus(files=int(files))
    names = {
        row[0]: str(row[1])
        for row in connection.execute(
            "SELECT id, name FROM engagement_applications WHERE project_id = %s", (project_id,)
        ).fetchall()
    }
    for sheet_id, control_id in connection.execute(
        "SELECT id, engagement_control_id FROM test_sheets WHERE test_round_id IS NULL "
        "AND project_id = %s "
        "AND method = 'TEST_OF_ONE'",
        (project_id,),
    ).fetchall():
        sheet = _sheet(connection, project_id, sheet_id)
        for item in sheet.items:
            if item.application_id is None or item.application_id not in names:
                continue
            finals = [cell.final for cell in item.cells]
            result: Literal["PASS", "EXCEPTION", "OPEN"] = (
                "EXCEPTION"
                if "EXCEPTION" in finals
                else "OPEN"
                if item.state != "TESTED" or any(f in OPEN_RESULTS for f in finals)
                else "PASS"
            )
            key = (control_id, names[item.application_id])
            current = states.get(key, ApplicationStatus())
            states[key] = ApplicationStatus(files=current.files, result=result)
    return states


def _strongest(current: RunState, status: Any) -> RunState:
    """Of two runs on the same control, the one further along: running over queued."""
    found = run_state(status)
    order = {"IDLE": 0, "QUEUED": 1, "RUNNING": 2}
    return found if order[found] > order[current] else current


def agent_runs(connection: psycopg.Connection[Any], project_id: UUID) -> dict[UUID, AgentRuns]:
    """Each control's agents at work, from the run records: evidence analyses of its
    files, its open test sheets, its workpapers, and its independent review."""
    from ai_workforce_api.control_reviews import REPERFORM_FAILED
    from ai_workforce_api.workpaper_service import DRAFT_FAILED

    runs: dict[UUID, AgentRuns] = {}

    def of(control_id: Any) -> AgentRuns:
        return runs.setdefault(UUID(str(control_id)), AgentRuns())

    for control_id, status, count in connection.execute(
        """
        SELECT l.engagement_control_id, a.status, count(*)
        FROM evidence_file_links l
        JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
        WHERE l.project_id = %s AND l.engagement_control_id IS NOT NULL
          AND a.status IN ('PENDING', 'WORKING', 'FAILED')
        GROUP BY 1, 2
        """,
        (project_id,),
    ).fetchall():
        if status == "FAILED":
            of(control_id).read_failed += int(count)
        else:
            of(control_id).reading += int(count)
    for control_id, status in connection.execute(
        "SELECT engagement_control_id, run_status FROM test_sheets "
        "WHERE project_id = %s AND status = 'OPEN' AND run_status IN ('PENDING', 'WORKING')",
        (project_id,),
    ).fetchall():
        found = of(control_id)
        found.testing = _strongest(found.testing, status)
    for control_id, status, note in connection.execute(
        "SELECT engagement_control_id, draft_status, draft_note "
        "FROM workpapers WHERE project_id = %s AND status = 'DRAFT'",
        (project_id,),
    ).fetchall():
        found = of(control_id)
        found.drafting = _strongest(found.drafting, status)
        if status == "IDLE" and note == DRAFT_FAILED and "drafting" not in found.stopped:
            found.stopped.append("drafting")
    for control_id, status, note in connection.execute(
        "SELECT engagement_control_id, reperform_status, reperform_note FROM control_reviews "
        "WHERE project_id = %s AND status = 'OPEN'",
        (project_id,),
    ).fetchall():
        found = of(control_id)
        found.reviewing = _strongest(found.reviewing, status)
        if status == "IDLE" and note == REPERFORM_FAILED:
            found.stopped.append("reviewing")
    return runs


def _sheet_states(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, tuple[Any, Any, Any, bool]]:
    """Each control's test sheet: its status, what it needs next, its result, and whether
    the tester agent is running on it now."""
    from ai_workforce_api.test_sheets import _sheet

    states: dict[UUID, tuple[Any, Any, Any, bool]] = {}
    for sheet_id, control_id in connection.execute(
        "SELECT id, engagement_control_id FROM test_sheets WHERE project_id = %s "
        "AND test_round_id IS NULL",
        (project_id,),
    ).fetchall():
        sheet = _sheet(connection, project_id, sheet_id)
        left: str | None
        if sheet.status == "SIGNED_OFF":
            left = "DEFICIENCY" if sheet.proposal_status == "PROPOSED" else None
        elif (
            sheet.running
            or sheet.counts["tested"] + sheet.counts["no_evidence"] < sheet.counts["items"]
        ):
            left = "TESTING"
        elif sheet.counts["no_evidence"]:
            left = "PLACE" if sheet.counts["unplaced"] else "EVIDENCE"
        elif sheet.counts["unable"] or sheet.counts.get("review", 0):
            left = "DECIDE"
        else:
            left = "SIGN_OFF"
        states[control_id] = (sheet.status, left, sheet.conclusion, sheet.running)
    return states


_OUT = {"SENT", "WAITING_FOR_RESPONSE", "PARTIALLY_RECEIVED"}


_WAITING: dict[Actor, Literal["TEAM", "OWNER", "AGENT", "NONE"]] = {
    "PREPARER": "TEAM",
    "APPROVER": "TEAM",
    "REVIEWER": "TEAM",
    "CLIENT": "OWNER",
    "AGENT": "AGENT",
    "NONE": "NONE",
}
# The review's steps by who takes them (control_reviews.py): deciding, clearing, and
# signing off are the engagement reviewer's; answering notes and re-performing a preparer's.
_REVIEW_ACTORS: dict[str, Actor] = {
    "REPERFORMING": "AGENT",
    "REPERFORM": "PREPARER",
    "DECIDE": "REVIEWER",
    "ADDRESS": "PREPARER",
    "CLEAR": "REVIEWER",
    "SIGN": "REVIEWER",
}
_SHEET_ACTORS: dict[str, Actor] = {
    "EVIDENCE": "CLIENT",
    "PLACE": "PREPARER",
    "TESTING": "AGENT",
    "DECIDE": "PREPARER",
    "SIGN_OFF": "PREPARER",
}


def is_late(status: str, due_at: datetime | None, now: datetime) -> bool:
    """A request is overdue once marked so, or once it is out with the client (sent, or
    partly received) and past its due date, as the metrics rulebook counts it."""
    if status in _LATE:
        return True
    return status in _OUT and due_at is not None and due_at < now


@dataclass(frozen=True)
class Step:
    """The one thing that moves a control forward, and who it belongs to."""

    text: str
    actor: Actor
    late: bool = False
    # Submitting a drafted request: done together on the Evidence page or by the agent.
    drafted: bool = False


def step_of(control: ControlRow, stages: StageBody, now: datetime | None = None) -> Step:
    """The control's next step from its records, and whose it is."""
    moment = now or datetime.now(UTC)
    if not control.included:
        return Step("Out of scope", "NONE")
    in_hand = round_in_hand(control.not_final)
    if in_hand is not None and not control.final:
        # A round in testing is the work in hand, before the interim's workpapers or
        # review (docs/workflow-integrity.md §2: interim review is no prerequisite).
        word = "retest" if in_hand.phase == "RETEST" else "roll-forward"
        return Step(f"Finish the {word} testing and sign it off", "PREPARER")
    if control.conclusion != "NOT_CONCLUDED":
        # The opinion is reached. Concluded only when final; otherwise the first thing
        # keeping it open is the step (docs/workflow-integrity.md §2).
        if control.final or not control.not_final:
            return Step(
                "Concluded with no exceptions"
                if control.conclusion == "EFFECTIVE"
                else "Concluded with exceptions",
                "NONE",
            )
        first = leading_reason(control.not_final)
        return Step(first.text, "REVIEWER" if first.step == "REVIEW" else "PREPARER")
    if control.test_status == "PROPOSED":
        if control.population_pending:
            return Step("Accept the population on the evidence plan", "PREPARER")
        return Step("Approve the samples", "PREPARER")
    if control.sheet_left == "DEFICIENCY":
        return Step("Log the proposed deficiency", "PREPARER")
    if control.sheet_status == "SIGNED_OFF":
        return _review_step(control)
    if control.sheet_left in _SHEET_STEPS:
        text, _who = _SHEET_STEPS[control.sheet_left]
        if control.sheet_left == "TESTING" and not control.testing_running:
            # The tester stopped with items untested: a person starts it again.
            return Step("Testing stopped: run it again", "PREPARER")
        if control.sheet_left != "EVIDENCE":
            return Step(text, _SHEET_ACTORS[control.sheet_left])
    by_kind: dict[str, list[ControlRequest]] = {}
    for request in control.requests:
        # Prepared for a phase not released yet: it waits for the release, not for a person.
        prepared = (
            control.evidence_plan == "PLANNED"
            and request.kind == "EVIDENCE"
            and not request.kickoff
            and request.phase in ("INTERIM", "ROLLFORWARD")
            and request.phase not in control.released_phases
            and request.status in ("DRAFT", "APPROVAL_PENDING")
        )
        if request.status not in ("CANCELLED", "CLOSED") and not prepared:
            by_kind.setdefault(request.kind, []).append(request)
    evidence = by_kind.get("EVIDENCE", [])
    unsent = all(request.status in ("DRAFT", "APPROVAL_PENDING") for request in evidence)
    # Planning comes before requesting: a request drafted before the plan is settled
    # against it by a person first (evidence_plans.reconcile).
    if control.evidence_plan == "NONE" and unsent:
        return Step(
            "Plan the evidence (request drafted before planning)"
            if evidence
            else "Plan the evidence",
            "PREPARER",
        )
    if control.reconcile and unsent:
        return Step("Reconcile the kickoff draft with the evidence plan", "PREPARER")
    # The planning gate: nothing is requested from a plan no person has approved.
    if control.evidence_plan == "PROPOSED" and control.plan_changes_requested:
        return Step("Revise the test plan as the reviewer asked", "PREPARER")
    if control.evidence_plan == "PROPOSED" and unsent:
        return Step("Approve the test plan", "PREPARER")
    for kind, noun in (("FOLLOW_UP", "follow-up"), ("SAMPLES", "sample request"),
                       ("EVIDENCE", "evidence request")):  # fmt: skip
        mine = by_kind.get(kind, [])
        statuses = {request.status for request in mine}
        if any(is_late(request.status, request.due_at, moment) for request in mine):
            return Step(f"Chase the overdue {noun}", "CLIENT", late=True)
        if "DRAFT" in statuses:
            return Step(f"Submit the {noun}", "PREPARER", drafted=True)
        pending = [request for request in mine if request.status == "APPROVAL_PENDING"]
        if any(request.approval_decision == "APPROVED" for request in pending):
            return Step(f"Send the approved {noun}", "PREPARER")
        if any(request.approval_decision in (None, "PENDING") for request in pending):
            return Step(f"Approve the {noun}", "APPROVER")
        if pending:
            # Its approval expired before anyone decided: it is asked for again.
            return Step(f"Submit the {noun} for approval again", "PREPARER")
        if statuses & _OUT:
            waiting = "sample evidence" if kind == "SAMPLES" else "evidence"
            return Step(f"Waiting for {waiting}", "CLIENT")
    if control.release_ready is not None and control.evidence_plan == "PLANNED":
        word = "roll-forward" if control.release_ready == "ROLLFORWARD" else "interim"
        return Step(f"Release the {word} phase", "APPROVER")
    operating = any(request.phase in ("INTERIM", "ROLLFORWARD") for request in evidence)
    if control.evidence_plan == "PLANNED" and not control.attributes_settled and not operating:
        # Operating evidence follows the attributes: it is requested once they are settled.
        return Step("Settle the attributes to request operating evidence", "PREPARER")
    if not control.requests:
        return Step("Request evidence", "PREPARER")
    if stages.test not in ("SUCCEEDED",):
        if control.test_status is None and control.nature != "AUTOMATED":
            return Step("Confirm the population", "PREPARER")
        return Step("Test the evidence", "AGENT")
    return _review_step(control)


# An evidence request's first send (approvals.return_for_revision); reminders differ.
_SEND_REF = r"^pbc/([0-9a-f-]{36})/[^/]+/[^/]+$"


def _unaddressed(connection: psycopg.Connection[Any], project_id: UUID) -> int:
    row = connection.execute(
        "SELECT count(*) FROM pbc_requests WHERE project_id = %s AND status = 'DRAFT' "
        "AND recipient = ''",
        (project_id,),
    ).fetchone()
    return 0 if row is None else int(row[0])


def request_approvals(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, dict[str, Any]]:
    """Each request's latest approval to send it. An approved send that was refused (live
    email was off, or the message did not fit) is FAILED: nothing went out, and the
    request is submitted again for a new approval."""
    found: dict[UUID, dict[str, Any]] = {}
    for (
        request_id,
        approval_id,
        decision,
        requester,
        reason,
        approver,
        executed,
        resendable,
    ) in connection.execute(
        """
        SELECT DISTINCT ON (ref.request_id)
               ref.request_id, a.id, a.decision, a.requesting_user_id, a.decision_reason,
               u.display_name, a.execution_status,
               EXISTS (
                   SELECT 1 FROM approvals e
                   JOIN outbound_messages o ON o.approval_id = e.id
                   WHERE e.project_id = a.project_id AND e.action_id = a.action_id
                     AND e.parameters = a.parameters AND e.decision = 'APPROVED'
                     AND e.execution_status = 'REFUSED' AND e.approver_user_id IS NOT NULL
                     AND o.status = 'FAILED' AND o.error_code = 'live_email_disabled'
               )
        FROM approvals a
        CROSS JOIN LATERAL (
            SELECT substring(a.parameters ->> 'request_ref' FROM %s)::uuid AS request_id
        ) ref
        LEFT JOIN users u ON u.id = a.approver_user_id
        WHERE a.project_id = %s AND a.action_id = 'mail.pbc' AND ref.request_id IS NOT NULL
        ORDER BY ref.request_id, a.created_at DESC
        """,
        (_SEND_REF, project_id),
    ).fetchall():
        failed = str(decision) == "APPROVED" and executed == "REFUSED"
        # RESEND: this exact message was approved by someone, and nothing went out only
        # because email was off; it is sent again on that approval (resend_request).
        again = bool(resendable) and (failed or str(decision) == "PENDING")
        found[UUID(str(request_id))] = {
            "approval_id": approval_id,
            "approval_decision": "RESEND" if again else "FAILED" if failed else str(decision),
            "approval_requested_by": requester,
            "approval_reason": None if reason is None else str(reason),
            "approval_decided_by": None if approver is None else str(approver),
        }
    return found


def next_step(
    control: ControlRow, stages: StageBody, now: datetime | None = None
) -> tuple[str, Literal["TEAM", "OWNER", "AGENT", "NONE"], bool]:
    """The one thing that moves this control forward, and who it waits on."""
    step = step_of(control, stages, now)
    return step.text, _WAITING[step.actor], step.late


def _review_step(control: ControlRow) -> Step:
    """After testing is signed off: prepare the workpapers, then the review's own steps."""
    if control.review_left is None:
        return Step("Prepare the workpapers for review", "PREPARER")
    step = REVIEW_STEPS.get(control.review_left)
    if step is None:
        return Step("Independent review", "REVIEWER")
    return Step(step[0], _REVIEW_ACTORS.get(control.review_left, "PREPARER"))


def progress_of(control: ControlRow, stages: StageBody, step: Step) -> Progress:
    """The control's one stage in the work, from its records. A control has exactly one,
    so the stages add up to the controls in scope; exceptions are shown beside it."""
    if control.conclusion != "NOT_CONCLUDED" and (control.final or not control.not_final):
        return "CONCLUDED"
    if control.sheet_status == "OPEN" and control.reopened_from is not None:
        # Signed-off testing opened again (a review note, an impact assessment, a person):
        # the stage says so, with the reason on the row; the review's notes stay open.
        return "TESTING_REOPENED"
    if round_in_hand(control.not_final) is not None and not control.final:
        return "READY_FOR_TESTING"
    if control.conclusion != "NOT_CONCLUDED":
        return _PROGRESS_FOR_STEP[leading_reason(control.not_final).step]
    if control.review_left is not None and control.review_left != "SIGNED":
        return (
            "REVIEW_NOTES"
            if control.review_left in ("ADDRESS", "REPERFORM")
            else ("AWAITING_REVIEW")
        )
    if control.sheet_status == "SIGNED_OFF":
        # Tested and signed off: the deficiency to log or the workpapers to prepare.
        return "RESULTS_TO_CONFIRM"
    if control.test_status == "PROPOSED":
        return "EVIDENCE_RECEIVED"
    if control.sheet_left == "TESTING":
        return "AGENT_TESTING" if control.testing_running else "READY_FOR_TESTING"
    if control.sheet_left in ("DECIDE", "SIGN_OFF"):
        return "RESULTS_TO_CONFIRM"
    if control.sheet_left == "EVIDENCE":
        return "AWAITING_EVIDENCE"
    if control.sheet_left == "PLACE":
        return "EVIDENCE_RECEIVED"
    if stages.evidence in ("NONE", "DRAFTED"):
        # Nothing is requested before a person approves the control's test plan.
        return "TO_REQUEST" if control.evidence_plan == "PLANNED" else "PLAN_TO_APPROVE"
    if stages.evidence in ("REQUESTED", "OVERDUE"):
        return "AWAITING_EVIDENCE"
    if stages.evidence == "PARTIAL":
        return "EVIDENCE_RECEIVED"
    if stages.test == "SUCCEEDED":
        return "RESULTS_TO_CONFIRM"
    # The stage never disagrees with the step: a population still to confirm comes first.
    if step.text == "Confirm the population":
        return "EVIDENCE_RECEIVED"
    if stages.test not in ("NONE", "READY", "DRAFT"):
        return "AGENT_TESTING"
    return "READY_FOR_TESTING"


_PHASE_ORDER = ("DESIGN", "INTERIM", "ROLLFORWARD", "REMEDIATION", "RETEST")


def evidence_phases(requests: list[ControlRequest], now: datetime) -> list[PhaseEvidence]:
    """Each testing phase's evidence requests (cancelled ones left out), in audit order."""
    found: dict[str, list[ControlRequest]] = {}
    for request in requests:
        if request.status == "CANCELLED":
            continue
        found.setdefault(request.phase or "OTHER", []).append(request)
    order = {phase: index for index, phase in enumerate(_PHASE_ORDER)}
    return [
        PhaseEvidence(
            phase=phase,
            requests=len(items),
            received=sum(1 for r in items if r.status in RECEIVED_PBC),
            drafted=sum(1 for r in items if r.status in ("DRAFT", "APPROVAL_PENDING")),
            out=sum(1 for r in items if r.status in _OUT or r.status in _LATE),
            late=sum(1 for r in items if is_late(r.status, r.due_at, now)),
        )
        for phase, items in sorted(found.items(), key=lambda item: order.get(item[0], 99))
    ]


def _allowed(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    action: Action,
) -> bool:
    try:
        _authorize(connection, principal, organization_id, project_id, action)
    except AccessDenied, NotVisible:
        return False
    return True


def mark_yours(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    controls: list[ControlRow],
) -> None:
    """Which next steps the person asking can take now. The same rules the actions apply:
    a preparer's step needs task.update (and, where the control's work is assigned to
    people, to be one of them); approving an outbound request needs project.update; the
    review's decisions are the engagement reviewer's, never on work they prepared when
    independence is required. Submitting drafted requests is done together, so it is no
    one control's step."""
    prepare = _allowed(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    approve = _allowed(connection, principal, organization_id, project_id, Action.PROJECT_UPDATE)
    reviewer = _is_reviewer(connection, project_id, principal.id)
    # A preparer's step, when no one is assigned, is an engagement lead's or preparer's
    # (project_memberships.engagement_role); an organization admin who is not on the
    # engagement's team has the permission but not the role, so it is not theirs (M1d).
    preparer = _has_engagement_role(connection, project_id, principal.id, ("LEAD", "PREPARER"))
    assigned: dict[UUID, set[UUID]] = {}
    names: dict[UUID, list[str]] = {}
    for control_id, user_id, name in connection.execute(
        """
        SELECT t.engagement_control_id, t.assignee_user_id, u.display_name FROM tasks t
        JOIN users u ON u.id = t.assignee_user_id
        WHERE t.project_id = %s AND t.engagement_control_id IS NOT NULL
          AND t.assignee_user_id IS NOT NULL AND t.status NOT IN ('SUCCEEDED', 'CANCELLED')
        ORDER BY u.display_name
        """,
        (project_id,),
    ).fetchall():
        assigned.setdefault(control_id, set()).add(user_id)
        found = names.setdefault(control_id, [])
        if str(name) not in found:
            found.append(str(name))
    prepared = {
        row[0]
        for row in connection.execute(
            """
            SELECT engagement_control_id FROM test_sheets
            WHERE project_id = %s AND signed_by = %s
            UNION
            SELECT engagement_control_id FROM workpapers
            WHERE project_id = %s AND prepared_by = %s
            """,
            (project_id, principal.id, project_id, principal.id),
        ).fetchall()
    }
    # The requester never approves their own request (approvals.py).
    requested = {
        row[0]
        for row in connection.execute(
            """
            SELECT r.engagement_control_id FROM approvals a
            JOIN pbc_requests r
              ON r.project_id = a.project_id
             AND r.id::text = split_part(a.parameters ->> 'request_ref', '/', 2)
            WHERE a.project_id = %s AND r.status = 'APPROVAL_PENDING'
              AND a.decision = 'PENDING' AND a.requesting_user_id = %s
            """,
            (project_id, principal.id),
        ).fetchall()
    }
    for control in controls:
        people = assigned.get(control.id)
        mine = principal.id in people if people is not None else preparer
        control.assignees = names.get(control.id, [])
        if control.drafted:
            control.yours = False
        elif control.actor == "PREPARER" or (control.actor == "CLIENT" and control.overdue):
            # An overdue request is the team's to chase.
            control.yours = prepare and mine
        elif control.actor == "APPROVER":
            control.yours = approve and control.id not in requested
        elif control.actor == "REVIEWER":
            control.yours = reviewer and not (independence.required() and control.id in prepared)
        else:
            control.yours = False


def _request_kind(key: str) -> Literal["EVIDENCE", "SAMPLES", "FOLLOW_UP"]:
    if key.startswith("samples-"):
        return "SAMPLES"
    if key.startswith("recapture-"):
        return "FOLLOW_UP"
    return "EVIDENCE"


def _request_title(description: str, title: str = "") -> str:
    """The request's title: the one a person set, else its first checklist item (its main
    deliverable), else the first meaningful line of its wording."""
    from ai_workforce_api.request_details import parse_wording

    if title.strip():
        return title.strip()[:160]
    items = parse_wording(description).items
    if items:
        return items[0].title[:160]
    for line in description.splitlines():
        text = line.strip().lstrip("-*• ").strip()
        if text:
            return text[:160]
    return "Evidence request"


def _stage(stages: StageBody, conclusion: str) -> str:
    """Where the control is in its lifecycle, in the words an audit team uses."""
    if conclusion != "NOT_CONCLUDED":
        return "CONCLUDED"
    if stages.review not in ("NONE", "READY", "DRAFT"):
        return "IN_REVIEW"
    if stages.test not in ("NONE", "READY", "DRAFT"):
        return "TESTING"
    if stages.evidence in ("RECEIVED", "PARTIAL"):
        return "EVIDENCE_RECEIVED"
    if stages.walkthrough not in ("NONE", "READY", "DRAFT"):
        return "WALKTHROUGH"
    if stages.evidence in ("REQUESTED", "OVERDUE"):
        return "EVIDENCE_REQUESTED"
    if stages.walkthrough == "NONE" and stages.evidence == "NONE":
        return "NOT_PLANNED"
    return "PLANNED"


# Dashboard


def _dashboard(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> DashboardBody:
    _authorize(connection, principal, organization_id, project_id, Action.TASK_READ)
    controls = [
        c for c in _controls(connection, principal, organization_id, project_id) if c.included
    ]
    plan = _plan(connection, principal, organization_id, project_id)
    deficiencies = _deficiencies(connection, principal, organization_id, project_id)
    pbc = Counter(
        str(row[0])
        for row in connection.execute(
            "SELECT status FROM pbc_requests WHERE project_id = %s", (project_id,)
        ).fetchall()
    )
    now = datetime.now(UTC)
    overdue_pbc = connection.execute(
        """
        SELECT count(*) FROM pbc_requests
        WHERE project_id = %s AND status IN ('SENT', 'WAITING_FOR_RESPONSE',
              'PARTIALLY_RECEIVED', 'OVERDUE', 'ESCALATED') AND due_at < %s
        """,
        (project_id, now),
    ).fetchone()
    by_category: dict[str, Counter[str]] = {}
    for control in controls:
        by_category.setdefault(control.category, Counter())[control.stage] += 1
    open_findings = [d for d in deficiencies if d.status != "CLOSED"]
    severity = Counter(d.severity for d in open_findings)
    tasks = plan.tasks
    agents = Counter(task.agent or "People" for task in tasks if task.status not in DONE_TASKS)
    # Completion counts final conclusions only (docs/workflow-integrity.md §2.1).
    concluded = sum(1 for c in controls if c.final)
    next_milestones = [m.model_dump(mode="json") for m in plan.milestones if m.status != "DONE"][:4]
    return DashboardBody(
        started=plan.started,
        review=review_overview(connection, project_id).model_dump(),
        period_conflicts=[c.message for c in period_state(connection, project_id).open],
        unplanned_controls=len(unplanned_controls(connection, project_id)),
        unrequested_controls=len(unrequested_controls(connection, project_id)),
        unaddressed_requests=_unaddressed(connection, project_id),
        controls={
            "in_scope": len(controls),
            "key": sum(1 for c in controls if c.key_control),
            "concluded": concluded,
            "effective": sum(1 for c in controls if c.conclusion == "EFFECTIVE"),
            "exceptions": sum(1 for c in controls if c.deficiencies > 0),
            "samples": sum(c.sample_size for c in controls),
            "by_category": {key: dict(value) for key, value in by_category.items()},
            "by_stage": dict(Counter(c.stage for c in controls)),
        },
        evidence={
            "total": sum(pbc.values()),
            "draft": pbc.get("DRAFT", 0) + pbc.get("APPROVAL_PENDING", 0),
            "outstanding": sum(
                pbc.get(s, 0)
                for s in (
                    "SENT",
                    "WAITING_FOR_RESPONSE",
                    "PARTIALLY_RECEIVED",
                    "OVERDUE",
                    "ESCALATED",
                )
            ),
            "received": sum(pbc.get(s, 0) for s in RECEIVED_PBC),
            "overdue": int(overdue_pbc[0]) if overdue_pbc else 0,
            "by_status": dict(pbc),
        },
        deficiencies={
            "open": len(open_findings),
            "by_severity": {
                key: severity.get(key, 0)
                for key in ("CONTROL_DEFICIENCY", "SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS")
            },
            "awaiting_approval": sum(1 for d in open_findings if d.pending_change),
            "remediation_overdue": sum(
                1
                for d in open_findings
                if d.remediation_due is not None
                and d.remediation_due < now.date()
                and d.status not in ("REMEDIATED",)
            ),
        },
        schedule={
            "phases": [phase.model_dump(mode="json") for phase in plan.phases],
            "next_milestones": next_milestones,
            "at_risk": sum(1 for phase in plan.phases if phase.status == "AT_RISK"),
            "missed_milestones": sum(1 for m in plan.milestones if m.status == "MISSED"),
            "schedule_missing": plan.schedule_missing,
            "period_end": plan.period_end.isoformat() if plan.period_end else None,
        },
        work={
            "total": len(tasks),
            "done": sum(1 for task in tasks if task.status in DONE_TASKS),
            "waiting": sum(
                1 for task in tasks if task.waiting_on > 0 and task.status not in DONE_TASKS
            ),
            "by_status": dict(Counter(task.status for task in tasks)),
            "by_agent": dict(agents.most_common(8)),
        },
    )


# Deficiencies


_DEFICIENCY_COLUMNS = """
    d.id, d.reference, d.engagement_control_id, c.control_ref, d.title, d.condition, d.criteria,
    d.cause, d.effect, d.deficiency_type, d.likelihood, d.magnitude, d.severity,
    d.compensating_controls, d.status, d.remediation_owner, d.remediation_plan,
    d.remediation_due, d.retest_result, d.retested_at, d.source, d.pending_change,
    u.display_name, d.identified_at, d.closed_at, d.version, d.remediated_on,
    d.remediation_request_id,
    (SELECT a.name FROM engagement_applications a WHERE a.id = c.engagement_application_id)
"""


def _has_engagement_role(
    connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID, roles: tuple[str, ...]
) -> bool:
    row = connection.execute(
        """
        SELECT 1 FROM project_memberships
        WHERE project_id = %s AND user_id = %s AND engagement_role = ANY(%s)
        """,
        (project_id, user_id, list(roles)),
    ).fetchone()
    return row is not None


def _is_reviewer(connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID) -> bool:
    if not independence.required():
        # Development only: anyone on the team can act as the reviewer.
        row = connection.execute(
            "SELECT 1 FROM project_memberships WHERE project_id = %s AND user_id = %s",
            (project_id, user_id),
        ).fetchone()
        return row is not None
    row = connection.execute(
        """
        SELECT 1 FROM project_memberships
        WHERE project_id = %s AND user_id = %s AND engagement_role = 'REVIEWER'
        """,
        (project_id, user_id),
    ).fetchone()
    return row is not None


def _deficiency(row: tuple[Any, ...], viewer: UUID, reviewer: bool) -> DeficiencyBody:
    pending = row[21] if isinstance(row[21], dict) else None
    can_decide = (
        pending is not None
        and reviewer
        and (not independence.required() or str(pending.get("requested_by")) != str(viewer))
    )
    return DeficiencyBody(
        id=row[0],
        reference=row[1],
        control_id=row[2],
        control_ref=row[3],
        title=row[4],
        condition=row[5],
        criteria=row[6],
        cause=row[7],
        effect=row[8],
        deficiency_type=row[9],
        likelihood=row[10],
        magnitude=row[11],
        severity=row[12],
        suggested_severity=suggested_severity(str(row[10]), str(row[11])),
        compensating_controls=row[13],
        status=row[14],
        remediation_owner=row[15],
        remediation_plan=row[16],
        remediation_due=row[17],
        retest_result=row[18],
        retested_at=row[19],
        source=row[20],
        pending_change=pending,
        identified_by=str(row[22] or ""),
        identified_at=row[23],
        closed_at=row[24],
        version=row[25],
        can_decide=can_decide,
        remediated_on=row[26],
        remediation_request_id=row[27],
        application_name="" if row[28] is None else str(row[28]),
    )


def _deficiencies(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[DeficiencyBody]:
    _authorize(connection, principal, organization_id, project_id, Action.TASK_READ)
    reviewer = _is_reviewer(connection, project_id, principal.id)
    rows = connection.execute(
        f"""
        SELECT {_DEFICIENCY_COLUMNS}
        FROM deficiencies d
        LEFT JOIN engagement_controls c ON c.id = d.engagement_control_id
        LEFT JOIN users u ON u.id = d.identified_by
        WHERE d.project_id = %s AND d.organization_id = %s
        ORDER BY d.reference
        """,
        (project_id, organization_id),
    ).fetchall()
    return [_deficiency(row, principal.id, reviewer) for row in rows]


def _one(
    connection: psycopg.Connection[Any],
    principal: Principal,
    project_id: UUID,
    deficiency_id: UUID,
) -> DeficiencyBody:
    row = connection.execute(
        f"""
        SELECT {_DEFICIENCY_COLUMNS}
        FROM deficiencies d
        LEFT JOIN engagement_controls c ON c.id = d.engagement_control_id
        LEFT JOIN users u ON u.id = d.identified_by
        WHERE d.id = %s AND d.project_id = %s
        """,
        (deficiency_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _deficiency(row, principal.id, _is_reviewer(connection, project_id, principal.id))


def _check_text(*values: str) -> None:
    if any(_CREDENTIAL.search(value) for value in values):
        raise ValueError("deficiency fields hold a credential")


def _create(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: DeficiencyCreate,
    source: Literal["MANUAL", "TESTING"] = "MANUAL",
) -> DeficiencyBody:
    _authorize(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _check_text(
        body.title,
        body.condition,
        body.criteria,
        body.cause,
        body.effect,
        body.compensating_controls,
        body.remediation_plan,
        body.remediation_owner,
    )
    with transaction(connection) as cursor:
        if body.control_id is not None:
            known = cursor.execute(
                "SELECT 1 FROM engagement_controls WHERE id = %s AND project_id = %s",
                (body.control_id, project_id),
            ).fetchone()
            if known is None:
                raise ValueError("control is unknown")
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"deficiency:{project_id}",))
        count = cursor.execute(
            "SELECT count(*) FROM deficiencies WHERE project_id = %s", (project_id,)
        ).fetchone()
        reference = f"D-{(int(count[0]) if count else 0) + 1:03d}"
        # A severe finding starts as a control deficiency until the reviewer agrees.
        severe = body.severity in SEVERE
        pending = (
            {
                "kind": "SEVERITY",
                "severity": body.severity,
                "reason": "Severity proposed when the deficiency was logged.",
                "requested_by": str(principal.id),
                "requested_at": datetime.now(UTC).isoformat(),
            }
            if severe
            else None
        )
        row = cursor.execute(
            """
            INSERT INTO deficiencies (
                organization_id, project_id, reference, engagement_control_id, title, condition,
                criteria, cause, effect, deficiency_type, likelihood, magnitude, severity,
                compensating_controls, remediation_owner, remediation_plan, remediation_due,
                pending_change, identified_by, source
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'CONTROL_DEFICIENCY',
                    %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                reference,
                body.control_id,
                body.title.strip(),
                body.condition,
                body.criteria,
                body.cause,
                body.effect,
                body.deficiency_type,
                body.likelihood,
                body.magnitude,
                body.compensating_controls,
                body.remediation_owner.strip(),
                body.remediation_plan,
                body.remediation_due,
                Json(pending) if pending else None,
                principal.id,
                source,
            ),
        ).fetchone()
        assert row is not None
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "deficiency.created",
            "deficiency",
            row[0],
            {"reference": reference, "proposed": body.severity},
        )
        # The owner is asked for the remediation plan and, later, the fix.
        if body.control_id is not None:
            draft_remediation_request(cursor, organization_id, project_id, row[0], principal.id)
    return _one(connection, principal, project_id, row[0])


def _locked(
    cursor: psycopg.Cursor[Any], project_id: UUID, deficiency_id: UUID, version: int
) -> tuple[Any, ...]:
    row = cursor.execute(
        """
        SELECT status, severity, pending_change, version FROM deficiencies
        WHERE id = %s AND project_id = %s FOR UPDATE
        """,
        (deficiency_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    if int(row[3]) != version:
        raise WorkspaceState("deficiency changed")
    return tuple(row)


def _update(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    deficiency_id: UUID,
    body: DeficiencyUpdate,
) -> DeficiencyBody:
    _authorize(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _check_text(
        body.title,
        body.condition,
        body.criteria,
        body.cause,
        body.effect,
        body.compensating_controls,
        body.remediation_plan,
        body.remediation_owner,
    )
    with transaction(connection) as cursor:
        current = _locked(cursor, project_id, deficiency_id, body.version)
        if current[0] == "CLOSED":
            raise WorkspaceState("deficiency is closed")
        cursor.execute(
            """
            UPDATE deficiencies
            SET title = %s, condition = %s, criteria = %s, cause = %s, effect = %s,
                deficiency_type = %s, likelihood = %s, magnitude = %s,
                compensating_controls = %s, remediation_owner = %s, remediation_plan = %s,
                remediation_due = %s, version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s
            """,
            (
                body.title.strip(),
                body.condition,
                body.criteria,
                body.cause,
                body.effect,
                body.deficiency_type,
                body.likelihood,
                body.magnitude,
                body.compensating_controls,
                body.remediation_owner.strip(),
                body.remediation_plan,
                body.remediation_due,
                deficiency_id,
            ),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "deficiency.updated",
            "deficiency",
            deficiency_id,
            {},
        )
    return _one(connection, principal, project_id, deficiency_id)


_NEXT_STATUS = {
    "OPEN": {"REMEDIATION_IN_PROGRESS"},
    "REMEDIATION_IN_PROGRESS": {"READY_FOR_RETEST", "OPEN"},
    "READY_FOR_RETEST": {"REMEDIATION_IN_PROGRESS"},
    "REMEDIATED": set(),
}


def _progress(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    deficiency_id: UUID,
    body: DeficiencyProgress,
) -> DeficiencyBody:
    """Remediation moves forward, and a retest decides whether it worked."""
    _authorize(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    with transaction(connection) as cursor:
        current = _locked(cursor, project_id, deficiency_id, body.version)
        status = str(current[0])
        if status == "CLOSED":
            raise WorkspaceState("deficiency is closed")
        open_retest = cursor.execute(
            "SELECT 1 FROM test_rounds WHERE deficiency_id = %s AND status IN "
            "('REQUESTED', 'TESTING')",
            (deficiency_id,),
        ).fetchone()
        if body.retest_result is not None:
            if status != "READY_FOR_RETEST":
                raise WorkspaceState("retest needs the remediation to be ready")
            if open_retest is not None:
                # A person records the result: the open retest round is withdrawn.
                cancel_retest(
                    cursor,
                    organization_id,
                    project_id,
                    deficiency_id,
                    principal.id,
                    "The retest result was recorded by a person.",
                )
            target = "REMEDIATED" if body.retest_result == "PASSED" else "REMEDIATION_IN_PROGRESS"
            cursor.execute(
                """
                UPDATE deficiencies
                SET status = %s, retest_result = %s, retested_at = current_date,
                    version = version + 1, updated_at = clock_timestamp()
                WHERE id = %s
                """,
                (target, body.retest_result, deficiency_id),
            )
        elif body.status is not None:
            if body.status not in _NEXT_STATUS.get(status, set()):
                raise WorkspaceState("status cannot move that way")
            control = cursor.execute(
                "SELECT engagement_control_id FROM deficiencies WHERE id = %s", (deficiency_id,)
            ).fetchone()
            on_control = control is not None and control[0] is not None
            if body.status == "READY_FOR_RETEST" and on_control:
                if body.remediated_on is None:
                    raise ValueError("give the date the fix took effect")
                if body.remediated_on > datetime.now(UTC).date():
                    raise ValueError("the fix cannot take effect in the future")
            cursor.execute(
                """
                UPDATE deficiencies SET status = %s,
                       remediated_on = CASE WHEN %s = 'READY_FOR_RETEST'
                                            THEN coalesce(%s, remediated_on)
                                            ELSE remediated_on END,
                       version = version + 1, updated_at = clock_timestamp()
                WHERE id = %s
                """,
                (body.status, body.status, body.remediated_on, deficiency_id),
            )
            if body.status == "READY_FOR_RETEST" and on_control and body.remediated_on:
                start_retest(
                    cursor, organization_id, project_id, deficiency_id, body.remediated_on,
                    principal.id,
                )  # fmt: skip
            elif status == "READY_FOR_RETEST":
                cancel_retest(
                    cursor, organization_id, project_id, deficiency_id, principal.id,
                    "The deficiency went back to remediation.",
                )  # fmt: skip
        else:
            raise ValueError("nothing to change")
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "deficiency.progress",
            "deficiency",
            deficiency_id,
            {
                "status": body.status,
                "retest": body.retest_result,
                "remediated_on": None
                if body.remediated_on is None
                else body.remediated_on.isoformat(),
            },
        )
    return _one(connection, principal, project_id, deficiency_id)


def _request_change(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    deficiency_id: UUID,
    body: ChangeRequest,
) -> DeficiencyBody:
    _authorize(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _check_text(body.reason)
    with transaction(connection) as cursor:
        current = _locked(cursor, project_id, deficiency_id, body.version)
        if current[0] == "CLOSED":
            raise WorkspaceState("deficiency is closed")
        if current[2] is not None:
            raise WorkspaceState("a change is waiting for the reviewer")
        if body.kind == "SEVERITY":
            if body.severity is None or body.severity == current[1]:
                raise ValueError("choose a different severity")
            if body.severity not in SEVERE and current[1] not in SEVERE:
                # Between levels that need no approval, the change applies now.
                cursor.execute(
                    """
                    UPDATE deficiencies SET severity = %s, version = version + 1,
                           updated_at = clock_timestamp() WHERE id = %s
                    """,
                    (body.severity, deficiency_id),
                )
                _audit(
                    cursor,
                    organization_id,
                    project_id,
                    principal.id,
                    "deficiency.severity",
                    "deficiency",
                    deficiency_id,
                    {"severity": body.severity},
                )
                return _one(connection, principal, project_id, deficiency_id)
        pending = {
            "kind": body.kind,
            "severity": body.severity,
            "reason": body.reason.strip(),
            "requested_by": str(principal.id),
            "requested_at": datetime.now(UTC).isoformat(),
        }
        cursor.execute(
            """
            UPDATE deficiencies SET pending_change = %s, version = version + 1,
                   updated_at = clock_timestamp() WHERE id = %s
            """,
            (Json(pending), deficiency_id),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "deficiency.change_requested",
            "deficiency",
            deficiency_id,
            {"kind": body.kind, "severity": body.severity},
        )
    return _one(connection, principal, project_id, deficiency_id)


def _decide(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    deficiency_id: UUID,
    body: ChangeDecision,
) -> DeficiencyBody:
    """Only the engagement's reviewer decides, and never on their own request."""
    _authorize(connection, principal, organization_id, project_id, Action.TASK_READ)
    if not _is_reviewer(connection, project_id, principal.id):
        raise HTTPException(status_code=403, detail="only the engagement reviewer decides")
    _check_text(body.reason)
    with transaction(connection) as cursor:
        current = _locked(cursor, project_id, deficiency_id, body.version)
        pending = current[2]
        if not isinstance(pending, dict):
            raise WorkspaceState("no change is waiting")
        if independence.required() and str(pending.get("requested_by")) == str(principal.id):
            raise HTTPException(
                status_code=403, detail="a reviewer cannot approve their own change"
            )
        if body.approve and pending.get("kind") == "SEVERITY":
            cursor.execute(
                """
                UPDATE deficiencies SET severity = %s, pending_change = NULL,
                       version = version + 1, updated_at = clock_timestamp() WHERE id = %s
                """,
                (pending.get("severity"), deficiency_id),
            )
        elif body.approve:
            cursor.execute(
                """
                UPDATE deficiencies SET status = 'CLOSED', closed_at = clock_timestamp(),
                       pending_change = NULL, version = version + 1,
                       updated_at = clock_timestamp() WHERE id = %s
                """,
                (deficiency_id,),
            )
        else:
            cursor.execute(
                """
                UPDATE deficiencies SET pending_change = NULL, version = version + 1,
                       updated_at = clock_timestamp() WHERE id = %s
                """,
                (deficiency_id,),
            )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "deficiency.change_decided",
            "deficiency",
            deficiency_id,
            {
                "kind": pending.get("kind"),
                "approved": body.approve,
                "severity": pending.get("severity"),
            },
        )
    return _one(connection, principal, project_id, deficiency_id)


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    target_type: str,
    target_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, actor_id, action, target_type, target_id, Json(payload)),
    )
