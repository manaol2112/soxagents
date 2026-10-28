"""Engagement onboarding. Everything an engagement needs before the agents start.

A team sets up scope, the engagement team, the RCM, workpaper templates, and the PBC
plan. Readiness is computed from those records, never stored, so it cannot drift.
When everything is ready, the planner proposes a kickoff plan from the RCM. A person
approves it, and only then does the engagement start: it becomes active, and its
tasks and draft PBC requests are created in one transaction. Nothing is emailed;
each request still goes through the usual approval before it is sent.
"""

import hashlib
import json
import re
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api import independence
from ai_workforce_api.actions import contains_secret
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.control_instances import (
    InstanceState,
    add_application_everywhere,
    control_label,
    reconcile_family,
    remove_application_everywhere,
)
from ai_workforce_api.controls import (
    BY_KEY,
    DOMAIN_AGENTS,
    DOMAIN_LABELS,
    DOMAINS,
    FREQUENCIES,
    ITGC_DOMAINS,
    LIBRARY,
    LIBRARY_VERSION,
    NATURES,
    SYSTEM_DOMAINS,
    TESTER_KEYS,
    runs_on_a_system,
    sample_size,
)
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.evidence_plans import plan_and_issue
from ai_workforce_api.invitations import (
    DomainChecker,
    InviteBody,
    InviteRefused,
    dns_checker,
    firm_domains,
    held_welcomes,
    invite,
    send_welcomes,
    signed_in,
)
from ai_workforce_api.library_definitions import link_definitions
from ai_workforce_api.mailbox import live_send_enabled
from ai_workforce_api.model_providers import live_model
from ai_workforce_api.pbc_drafting import DraftScheduler, queue_kickoff_drafts, schedule
from ai_workforce_api.profile_checks import PeriodState, period_state
from ai_workforce_api.rcm_systems import KNOWN_CATEGORIES, KNOWN_SYSTEMS
from ai_workforce_api.schedule import KIND_PHASES
from ai_workforce_api.scope_changes import (
    OPEN_TASKS,
    ScopeImpact,
    reconcile_scope,
    scope_impact,
    started,
)
from ai_workforce_api.settings import Settings
from ai_workforce_api.setup_suggest import (
    OwnerSuggestion,
    ProfileUpdate,
    SetupDraftBody,
    draft_body,
    owner_email_suggestions,
)
from ai_workforce_api.system_applicability import (
    AssessmentBody,
    SocReportBody,
    assessment_body,
    report_bodies,
)
from ai_workforce_api.system_review_queue import (
    schedule_system_reviews,
    track_review,
    track_reviews_for_project,
)
from ai_workforce_api.workpapers import (
    PreviewControl,
    TemplateSummary,
    WorkpaperPreview,
    default_template,
    preview,
    summaries,
)
from ai_workforce_api.workspace import create_engagement_schedule

_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_DOMAIN = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
ROLES = ("LEAD", "PREPARER", "REVIEWER")
# Engagement-level workers every kickoff plan uses, besides each domain's tester.
CORE_AGENTS = (
    "engagement-planner",
    "evidence-coordinator",
    "independent-reviewer",
    "reporting-analyst",
)


class OnboardingState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


# Bodies


class SettingsBody(BaseModel):
    # The engagement's profile, named at creation (Milestone 8.3c).
    client_name: str = ""
    engagement_type: str = "SOX_ITGC"
    # The frameworks chosen when it was created (migration 0108); None when none were.
    frameworks: list[str] | None = None
    period_end: date | None
    period_start: date | None = None
    fiscal_year: str = ""
    methodology: str | None = None
    reporting_objectives: str = ""
    client_coordinator_name: str
    client_coordinator_email: str
    client_domains: list[str]
    pbc_due_days: int
    pbc_follow_up_days: int
    pbc_max_follow_ups: int
    templates_confirmed_at: datetime | None
    kicked_off_at: datetime | None
    version: int
    # Review and finalize (SP6, migration 0111): the engagement's work starts here.
    scope_finalized_at: datetime | None = None


class CuecBody(BaseModel):
    # CUEC-1, CUEC-2, ... in the order the review lists them.
    ref: str = ""
    text: str
    control_id: UUID | None = None
    control_ref: str | None = None
    # Answered by a control already in scope for this system.
    in_scope: bool = False


class SystemReviewBody(BaseModel):
    """The scoping agent's review of one system (system_scoping.py)."""

    status: Literal["IDLE", "PENDING", "WORKING"]
    source: Literal["NONE", "RULES", "AGENT"]
    basis: Literal["KNOWLEDGE"]
    summary: str
    coverage: str
    cuecs: list[CuecBody]
    note: str
    reviewed_at: Any = None


class RecommendationBody(BaseModel):
    id: UUID
    kind: Literal["EXCLUDE", "ADD_SOC_REVIEW", "INCLUDE", "MAP_CUEC", "CUEC_GAP"]
    control_id: UUID | None
    # A library control the recommendation would add for this system.
    library_key: str | None = None
    control_ref: str
    control_title: str
    cuec: str
    reason: str
    # The CUECs that call for it, as support.
    cuec_refs: list[str] = []
    status: Literal["PROPOSED", "ACCEPTED", "DISMISSED"]


class OtherControlBody(BaseModel):
    library_key: str
    control_ref: str
    title: str
    domain: str
    # This system's instance, when it is loaded for it but out of scope.
    control_id: UUID | None = None


class ApplicationBody(BaseModel):
    id: UUID
    name: str
    description: str
    layer: str = "APPLICATION"
    # How the system is run and whether a SOC 1 report is expected (migration 0047).
    hosting: str | None = None
    soc_expected: bool | None = None
    facts_source: str = "NONE"
    facts_reason: str = ""
    facts_confirmed: bool = False
    version: int = 1
    review: SystemReviewBody | None = None
    recommendations: list[RecommendationBody] = []
    # How many controls are in scope for this system now.
    controls_in_scope: int = 0
    # Library controls not in scope for it and not recommended: the team may add them.
    other_controls: list[OtherControlBody] = []
    # Milestone 8.10: the system's details, the agent's assessment beside the team's
    # decisions, and the SOC reports uploaded for it with their CUECs.
    purpose: str = ""
    processes: str = ""
    owner: str = ""
    # The system's code in the client's control references, when a person set one.
    ref_code: str = ""
    assessment: AssessmentBody | None = None
    soc_reports: list[SocReportBody] = []
    # The Systems & Processes workflow (SP2, migration 0109): where it runs, the systems it
    # integrates with and the processes it supports (either side may have named the link),
    # and its control areas: the agent's suggestion as shown, apart from those a person
    # approved (None until one decides).
    environment: str | None = None
    integration_ids: list[UUID] = []
    process_ids: list[UUID] = []
    control_areas: list[str] | None = None
    control_areas_suggested: dict[str, Any] | None = None
    control_areas_decided_at: datetime | None = None
    # Taken out of scope after launch (migration 0114): when, and why. Kept on record.
    out_of_scope_at: datetime | None = None
    out_of_scope_reason: str = ""


class ProcessBody(BaseModel):
    """A business process the team named (migration 0059): the controls it writes for it
    belong to it, and are tested like the standard cycle it is based on."""

    id: UUID
    name: str
    domain: str
    domain_label: str
    version: int
    controls_in_scope: int = 0
    # The systems it runs on (migration 0109), the primary one first when there is one.
    system_ids: list[UUID] = []
    primary_system_id: UUID | None = None
    # SP3 (migration 0110): its description and owner, and its control areas: the agent's
    # suggestion as shown, apart from those a person approved (None until one decides).
    description: str = ""
    owner: str = ""
    control_areas: list[str] | None = None
    control_areas_suggested: dict[str, Any] | None = None
    control_areas_decided_at: datetime | None = None


class ProcessCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    domain: str


class TeamMemberBody(BaseModel):
    user_id: UUID
    display_name: str
    email: str
    engagement_role: str
    organization_role: str
    # Validated once the person has signed in with this address; the role applies either way.
    validated: bool = True
    # A welcome email is written and waiting for live email to be turned on.
    welcome_held: bool = False


class CandidateBody(BaseModel):
    user_id: UUID
    display_name: str
    email: str
    organization_role: str


class CustomField(BaseModel):
    label: str
    value: str


class ControlBody(BaseModel):
    id: UUID
    library_key: str
    control_ref: str
    domain: str
    title: str
    risk: str
    activity: str
    frequency: str
    nature: str
    key_control: bool
    included: bool
    owner_name: str
    owner_email: str
    application_ids: list[UUID]
    test_attributes: list[str]
    pbc_items: list[str]
    template_key: str
    # The one application this instance is for (Milestone 8.5), and its name for pages.
    application_id: UUID | None = None
    application_name: str = ""
    label: str = ""
    # The process the team named for it, when it is not one of the standard cycles.
    process_id: UUID | None = None
    agent_key: str
    sample_size: int
    version: int
    source: str
    domain_label: str
    frequency_label: str
    nature_label: str
    custom_fields: list[CustomField]
    # An approved sample or a test sheet rests on how it is defined (Milestone 8.13):
    # changing its frequency, nature, or area needs acknowledging.
    tested: bool = False


class ReadinessItem(BaseModel):
    step: str
    title: str
    complete: bool
    issues: list[str]
    # Worth knowing, never blocking.
    advisories: list[str] = []


class PlanItem(BaseModel):
    key: str
    kind: Literal["walkthrough", "evidence", "test", "review", "report"]
    title: str
    description: str
    agent_key: str
    control_id: UUID | None
    control_ref: str | None
    depends_on: list[str]


class PlanBody(BaseModel):
    id: UUID
    status: str
    items: list[PlanItem]
    fingerprint: str
    created_at: datetime
    decided_at: datetime | None
    created_tasks: int
    created_requests: int


class PlanPreview(BaseModel):
    """The work launching will create, computed from the setup as it stands."""

    items: list[PlanItem]
    fingerprint: str


class StaffedAgent(BaseModel):
    agent_key: str
    name: str
    active: bool
    staffed: bool


class PbcPreviewItem(BaseModel):
    control_id: UUID
    control_ref: str
    recipient: str
    items: list[str]
    to_coordinator: bool = False


class LibraryArea(BaseModel):
    domain: str
    controls: int
    loaded: int


class DraftingSummary(BaseModel):
    """How far the evidence coordinator is with drafting the kickoff requests."""

    total: int
    pending: int
    drafted: int
    by_model: int
    failed: int


class LaunchSummary(BaseModel):
    """Where a launched engagement's work stands now: who launched it, its evidence plans
    (nothing is requested before a plan is approved), its requests, and the agents' tasks.
    Counted from the records each time; nothing here is stored."""

    launched_at: datetime
    launched_by: str
    controls: int
    plans_approved: int
    # Planned, waiting for a person's approval (a first plan or proposed changes).
    plans_proposed: int
    # The planner agent is still refining the plan.
    plans_working: int
    # Controls in scope with no evidence plan yet.
    plans_missing: int
    # Drafted, or submitted for approval, before their control's plan was approved: they
    # wait for the plan (the planning gate) and are not counted below.
    requests_held: int
    requests_draft: int
    requests_awaiting_approval: int
    requests_with_client: int
    requests_received: int
    tasks_total: int
    tasks_done: int
    tasks_active: int
    # Blocked or failed: a person should look.
    tasks_attention: int


class OnboardingBody(BaseModel):
    project_id: UUID
    project_name: str
    project_status: str
    scope: str
    settings: SettingsBody
    applications: list[ApplicationBody]
    # Business processes the team named, beside the standard cycles.
    processes: list[ProcessBody] = []
    team: list[TeamMemberBody]
    candidates: list[CandidateBody]
    library: list[LibraryArea]
    # Business process and entity-level controls the library offers and not loaded yet.
    process_offers: list[OtherControlBody] = []
    controls: list[ControlBody]
    templates: list[TemplateSummary]
    agents: list[StaffedAgent]
    pbc_preview: list[PbcPreviewItem]
    readiness: list[ReadinessItem]
    ready: bool
    plan: PlanBody | None
    # Until launch: the plan as it stands, so the launch page needs no proposal step.
    plan_preview: PlanPreview | None = None
    started: bool
    drafting: DraftingSummary
    # Once launched: where the work stands now.
    launch: LaunchSummary | None = None
    rcm_source: Literal["NONE", "LIBRARY", "UPLOAD"]
    rcm_file_name: str
    open_import_id: UUID | None
    # The planner's setup draft and the owner emails the client's pattern suggests.
    setup_draft: SetupDraftBody | None = None
    owner_suggestions: list[OwnerSuggestion] = []
    # The firm's own email domains; invitations go only to addresses on them.
    firm_domains: list[str] = []
    # Common systems not yet in scope, to pick from instead of typing them.
    known_systems: list[KnownSystem] = []
    # False only in development: anyone on the team may then act as the reviewer.
    independence_required: bool = True
    # Where the period disagrees with the name, scope, or fiscal year, and whether a person
    # confirmed it as recorded (profile_checks.py).
    period: PeriodState | None = None


class PeriodConfirm(BaseModel):
    # What the page showed: the confirmation is for exactly that.
    basis: str = Field(min_length=8, max_length=64)


class PeriodAlign(BaseModel):
    # What the page showed: the correction is for exactly that.
    basis: str = Field(min_length=8, max_length=64)
    # Move the period end to the name's year, or change the name to the period's year.
    to: Literal["period_end", "name"]


class ScopeUpdate(BaseModel):
    scope: str = Field(max_length=4000)
    period_end: date | None


class ApplicationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class CustomSystem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    layer: Literal["APPLICATION", "DATABASE", "OPERATING_SYSTEM", "INFRASTRUCTURE", "TOOL"]


class KnownSystemsAdd(BaseModel):
    # Names from the known-systems catalog; each keeps the catalog's layer.
    names: list[str] = Field(default_factory=list, max_length=60)
    # Systems the catalog does not list, named by the team, each with its kind.
    custom: list[CustomSystem] = Field(default_factory=list, max_length=20)


class KnownSystem(BaseModel):
    name: str
    layer: str
    # What it is, such as ERP or HR (rcm_systems.KNOWN_CATEGORIES); "" when not known.
    category: str = ""


class TeamAdd(BaseModel):
    user_id: UUID
    engagement_role: Literal["LEAD", "PREPARER", "REVIEWER"]
    # Further roles for the same person, given in the same transaction. Only while reviewer
    # independence is off (development): with it on, one person holds one role.
    additional_roles: list[Literal["LEAD", "PREPARER", "REVIEWER"]] = Field(
        default_factory=list, max_length=2
    )


class TeamRemove(BaseModel):
    # One role to take away; without it the person leaves the team.
    engagement_role: Literal["LEAD", "PREPARER", "REVIEWER"] | None = None


class ControlUpdate(BaseModel):
    version: int = Field(ge=1)
    included: bool
    key_control: bool
    owner_name: str = Field(max_length=200)
    owner_email: str = Field(max_length=200)
    frequency: str
    nature: str
    application_ids: list[UUID] = Field(max_length=50)
    template_key: str = Field(max_length=60)
    # The area and tester can be changed per control. A new area brings its tester.
    domain: str | None = None
    agent_key: str | None = None
    # The person saw that the control has testing on record and changes it anyway: the
    # sample and results are then flagged for reassessment (Milestone 8.13).
    acknowledge_testing: bool = False
    # Why, when this takes a control with work on record out of a running engagement.
    reason: str = Field(default="", max_length=500)

    @field_validator("owner_name", "owner_email")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return value.strip()


class LibraryLoad(BaseModel):
    domains: list[str] = Field(default=list(ITGC_DOMAINS), min_length=1, max_length=20)


class OwnerBulk(BaseModel):
    domain: str = Field(max_length=40)
    owner_name: str = Field(min_length=1, max_length=200)
    owner_email: str = Field(min_length=3, max_length=200)
    only_missing: bool = True


class OwnerBatch(BaseModel):
    control_ids: list[UUID] = Field(min_length=1, max_length=2000)
    owner_name: str = Field(min_length=1, max_length=200)
    owner_email: str = Field(min_length=3, max_length=200)


class OwnerBatchResult(BaseModel):
    updated: int


class PbcUpdate(BaseModel):
    # Set in the Evidence section (evidence-contacts); omitted here, they are kept.
    client_coordinator_name: str | None = Field(default=None, max_length=200)
    client_coordinator_email: str | None = Field(default=None, max_length=200)
    client_domains: list[str] | None = Field(default=None, max_length=10)
    pbc_due_days: int = Field(ge=1, le=90)
    pbc_follow_up_days: int = Field(ge=1, le=30)
    pbc_max_follow_ups: int = Field(ge=0, le=10)


class ContactsUpdate(BaseModel):
    client_coordinator_name: str = Field(max_length=200)
    client_coordinator_email: str = Field(max_length=200)
    client_domains: list[str] = Field(max_length=10)


class ContactsBody(BaseModel):
    """Who at the client receives evidence requests, set from the Evidence section."""

    client_coordinator_name: str
    client_coordinator_email: str
    client_domains: list[str]
    # Draft requests with no recipient yet: no owner and no coordinator when drafted.
    waiting: int


class PlanApproval(BaseModel):
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


def register_onboarding(
    app: FastAPI,
    settings: Settings,
    drafts: DraftScheduler | None = None,
    domain_checker: DomainChecker | None = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/onboarding"
    checker: DomainChecker = domain_checker if domain_checker is not None else dns_checker(settings)

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        return _run(settings, lambda connection: work(connection, principal))

    @app.get(base)
    def read(organization_id: UUID, project_id: UUID, request: Request) -> OnboardingBody:
        return run(request, lambda c, p: load_onboarding(c, p, organization_id, project_id))

    @app.patch(f"{base}/profile")
    def profile(
        organization_id: UUID, project_id: UUID, body: ProfileUpdate, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _update_profile(c, p, organization_id, project_id, body))

    @app.post(f"{base}/period/confirm")
    def confirm_period(
        organization_id: UUID, project_id: UUID, body: PeriodConfirm, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _confirm_period(c, p, organization_id, project_id, body))

    @app.post(f"{base}/period/align")
    def align_period(
        organization_id: UUID, project_id: UUID, body: PeriodAlign, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _align_period(c, p, organization_id, project_id, body))

    @app.patch(f"{base}/scope")
    def scope(
        organization_id: UUID, project_id: UUID, body: ScopeUpdate, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _update_scope(c, p, organization_id, project_id, body))

    @app.post(f"{base}/applications")
    def add_application(
        organization_id: UUID, project_id: UUID, body: ApplicationCreate, request: Request
    ) -> OnboardingBody:
        result = run(
            request, lambda c, p: _add_application(c, p, organization_id, project_id, body)
        )
        schedule_system_reviews(drafts, pending_reviews(result))
        return result

    @app.post(f"{base}/applications/known")
    def add_known_applications(
        organization_id: UUID, project_id: UUID, body: KnownSystemsAdd, request: Request
    ) -> OnboardingBody:
        result = run(
            request, lambda c, p: _add_known_systems(c, p, organization_id, project_id, body)
        )
        schedule_system_reviews(drafts, pending_reviews(result))
        return result

    @app.post(f"{base}/applications/{{application_id}}/remove")
    def remove_application(
        organization_id: UUID,
        project_id: UUID,
        application_id: UUID,
        request: Request,
        body: ScopeReason | None = None,
    ) -> OnboardingBody:
        reason = "" if body is None else body.reason
        return run(
            request,
            lambda c, p: _remove_application(
                c, p, organization_id, project_id, application_id, reason
            ),
        )

    @app.post(f"{base}/applications/{{application_id}}/restore")
    def restore_application(
        organization_id: UUID, project_id: UUID, application_id: UUID, request: Request
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: _restore_application(c, p, organization_id, project_id, application_id),
        )

    @app.get(f"{base}/scope-impact")
    def impact(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        control_id: Annotated[list[UUID] | None, Query()] = None,
        application_id: UUID | None = None,
    ) -> ScopeImpact:
        def work(c: psycopg.Connection[Any], p: Principal) -> ScopeImpact:
            _authorize_setup(c, p, organization_id, project_id, after_start=True)
            ids = list(control_id or [])
            if application_id is not None:
                ids += [
                    UUID(str(row[0]))
                    for row in c.execute(
                        "SELECT id FROM engagement_controls WHERE project_id = %s "
                        "AND engagement_application_id = %s AND included",
                        (project_id, application_id),
                    ).fetchall()
                ]
            return scope_impact(c, project_id, ids)

        return run(request, work)

    @app.get(f"{base}/team/{{user_id}}/impact")
    def team_impact(
        organization_id: UUID, project_id: UUID, user_id: UUID, request: Request
    ) -> TeamImpact:
        def work(c: psycopg.Connection[Any], p: Principal) -> TeamImpact:
            _authorize_setup(c, p, organization_id, project_id, after_start=True)
            return _team_impact(c, project_id, user_id)

        return run(request, work)

    @app.post(f"{base}/team")
    def add_member(
        organization_id: UUID, project_id: UUID, body: TeamAdd, request: Request
    ) -> OnboardingBody:
        changed = run(request, lambda c, p: _add_member(c, p, organization_id, project_id, body))
        schedule(drafts, started_drafts(settings, project_id))
        return changed

    @app.post(f"{base}/team/invite")
    def invite_member(
        organization_id: UUID, project_id: UUID, body: InviteBody, request: Request
    ) -> OnboardingBody:
        invited: list[UUID] = []

        def work(connection: psycopg.Connection[Any], principal: Principal) -> OnboardingBody:
            # The same permission as adding someone already in the firm.
            _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
            user_id = invite(
                connection,
                principal,
                organization_id,
                project_id,
                body,
                checker,
                settings.link_base_url(),
            )
            invited.append(user_id)
            return _add_member(
                connection,
                principal,
                organization_id,
                project_id,
                TeamAdd(
                    user_id=user_id,
                    engagement_role=body.engagement_role,
                    additional_roles=body.additional_roles,
                ),
            )

        try:
            changed = run(request, work)
        except InviteRefused as refused:
            raise HTTPException(status_code=refused.status, detail=refused.detail) from None
        schedule(drafts, started_drafts(settings, project_id))
        # With live email on, the welcome email goes now; otherwise it stays held.
        if invited and live_send_enabled(settings):
            with connect(settings.database_url) as connection:
                send_welcomes(connection, settings, organization_id, project_id, invited)
                return _snapshot(connection, organization_id, project_id)
        return changed

    @app.post(f"{base}/team/welcomes/send")
    def send_held_welcomes(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> OnboardingBody:
        """Send the team's held welcome emails, now that live email is on."""

        def work(connection: psycopg.Connection[Any], principal: Principal) -> OnboardingBody:
            _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
            if not live_send_enabled(settings):
                raise OnboardingState("live email is off")
            send_welcomes(connection, settings, organization_id, project_id)
            return _snapshot(connection, organization_id, project_id)

        return run(request, work)

    @app.post(f"{base}/team/{{user_id}}/remove")
    def remove_member(
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        request: Request,
        body: TeamRemove | None = None,
    ) -> OnboardingBody:
        role = None if body is None else body.engagement_role
        return run(
            request,
            lambda c, p: _remove_member(c, p, organization_id, project_id, user_id, role),
        )

    @app.post(f"{base}/controls/add")
    def add_process_control(
        organization_id: UUID, project_id: UUID, body: ProcessControlAdd, request: Request
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: _add_process_control(c, p, organization_id, project_id, body),
        )

    @app.post(f"{base}/processes")
    def add_process(
        organization_id: UUID, project_id: UUID, body: ProcessCreate, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _add_process(c, p, organization_id, project_id, body))

    @app.post(f"{base}/processes/{{process_id}}/remove")
    def remove_process(
        organization_id: UUID, project_id: UUID, process_id: UUID, request: Request
    ) -> OnboardingBody:
        return run(
            request, lambda c, p: _remove_process(c, p, organization_id, project_id, process_id)
        )

    @app.post(f"{base}/controls/new")
    def create_control(
        organization_id: UUID, project_id: UUID, body: ControlCreate, request: Request
    ) -> OnboardingBody:
        changed = run(
            request, lambda c, p: _create_control(c, p, organization_id, project_id, body)
        )
        schedule(drafts, started_drafts(settings, project_id))
        return changed

    @app.post(f"{base}/controls/{{control_id}}/scope")
    def scope_control(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: ControlScopeUpdate,
        request: Request,
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: _scope_control(c, p, organization_id, project_id, control_id, body),
        )

    @app.post(f"{base}/controls/load-library")
    def load_library(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        body: LibraryLoad | None = None,
    ) -> OnboardingBody:
        chosen = body or LibraryLoad()
        result = run(request, lambda c, p: _load_library(c, p, organization_id, project_id, chosen))
        schedule_system_reviews(drafts, pending_reviews(result))
        return result

    @app.patch(f"{base}/controls/{{control_id}}")
    def update_control(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: ControlUpdate,
        request: Request,
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: _update_control(c, p, organization_id, project_id, control_id, body),
        )

    @app.post(f"{base}/controls/owner")
    def bulk_owner(
        organization_id: UUID, project_id: UUID, body: OwnerBulk, request: Request
    ) -> OnboardingBody:
        changed = run(request, lambda c, p: _bulk_owner(c, p, organization_id, project_id, body))
        schedule(drafts, started_drafts(settings, project_id))
        return changed

    @app.post(f"{base}/controls/owner-batch")
    def owner_batch(
        organization_id: UUID, project_id: UUID, body: OwnerBatch, request: Request
    ) -> OwnerBatchResult:
        changed = run(request, lambda c, p: _owner_batch(c, p, organization_id, project_id, body))
        schedule(drafts, started_drafts(settings, project_id))
        return changed

    @app.post(f"{base}/templates/confirm")
    def confirm_templates(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> OnboardingBody:
        changed = run(request, lambda c, p: _confirm_templates(c, p, organization_id, project_id))
        schedule(drafts, started_drafts(settings, project_id))
        return changed

    @app.get(f"{base}/workpaper-preview")
    def workpaper_preview(
        organization_id: UUID,
        project_id: UUID,
        template: str,
        control_id: UUID,
        request: Request,
    ) -> WorkpaperPreview:
        return run(
            request,
            lambda c, p: _preview(c, p, organization_id, project_id, template, control_id),
        )

    @app.get(f"{base}/evidence-contacts")
    def evidence_contacts(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> ContactsBody:
        return run(request, lambda c, p: _get_contacts(c, p, organization_id, project_id))

    @app.patch(f"{base}/evidence-contacts")
    def update_evidence_contacts(
        organization_id: UUID, project_id: UUID, body: ContactsUpdate, request: Request
    ) -> ContactsBody:
        changed = run(
            request, lambda c, p: _update_contacts(c, p, organization_id, project_id, body)
        )
        schedule(drafts, started_drafts(settings, project_id))
        return changed

    @app.patch(f"{base}/pbc")
    def pbc(
        organization_id: UUID, project_id: UUID, body: PbcUpdate, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _update_pbc(c, p, organization_id, project_id, body))

    @app.post(f"{base}/plan")
    def propose(organization_id: UUID, project_id: UUID, request: Request) -> OnboardingBody:
        return run(request, lambda c, p: propose_plan(c, p, organization_id, project_id))

    @app.post(f"{base}/plan/{{plan_id}}/approve")
    def approve(
        organization_id: UUID,
        project_id: UUID,
        plan_id: UUID,
        body: PlanApproval,
        request: Request,
    ) -> OnboardingBody:
        agent = live_model(settings)
        started = run(
            request,
            lambda c, p: approve_plan(c, p, organization_id, project_id, plan_id, body, agent),
        )
        # The kickoff has committed. The planner agent refines each control's evidence
        # plan in the background; nothing is requested until a person approves it.
        schedule(drafts, started_drafts(settings, project_id))
        _schedule_plan_runs(settings, drafts, project_id)
        return started

    @app.post(f"{base}/plan/launch")
    def launch(
        organization_id: UUID, project_id: UUID, body: PlanApproval, request: Request
    ) -> OnboardingBody:
        agent = live_model(settings)
        started = run(
            request,
            lambda c, p: launch_engagement(c, p, organization_id, project_id, body, agent),
        )
        schedule(drafts, started_drafts(settings, project_id))
        _schedule_plan_runs(settings, drafts, project_id)
        return started


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        return _call(settings, work)
    except OnboardingState as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail="onboarding fields are invalid") from error


# Reads


def load_onboarding(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> OnboardingBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    return _snapshot(connection, organization_id, project_id)


def firm_templates(connection: psycopg.Connection[Any], project_id: UUID) -> list[Any]:
    from ai_workforce_api.workpaper_templates import firm_templates as _firm

    return _firm(connection, project_id)


def template_for_control(
    connection: psycopg.Connection[Any], project_id: UUID, domain: str, chosen: str
) -> str:
    from ai_workforce_api.workpaper_templates import template_for_control as _for

    return _for(connection, project_id, domain, chosen)


def resolve_template(connection: psycopg.Connection[Any], project_id: UUID, key: str) -> Any:
    from ai_workforce_api.workpaper_templates import resolve_template as _resolve

    return _resolve(connection, project_id, key)


def _snapshot(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> OnboardingBody:
    project = connection.execute(
        "SELECT name, status::text, scope FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    if project is None:
        raise NotVisible()
    settings = _settings(connection, project_id)
    applications = _applications(connection, project_id)
    team = _team(connection, organization_id, project_id)
    controls = _controls(connection, project_id)
    processes = _processes(connection, project_id, controls)
    agents = _agents(connection, organization_id, project_id, controls)
    loaded_keys = {c.library_key for c in controls if c.library_key}
    # The library and an upload are alternatives: no library offers next to the client's RCM.
    from_upload = any(c.source == "UPLOAD" for c in controls)
    process_offers = [
        OtherControlBody(
            library_key=c.key, control_ref=c.control_ref, title=c.title, domain=c.domain
        )
        for c in LIBRARY
        if not from_upload and not runs_on_a_system(c.domain) and c.key not in loaded_keys
    ]
    period = period_state(connection, project_id)
    readiness = _readiness(str(project[2]), settings, applications, team, controls, agents, period)
    ready = all(item.complete for item in readiness)
    source, file_name, open_import = _rcm_state(connection, project_id, controls)
    templates = summaries(firm_templates(connection, project_id))
    body = OnboardingBody(
        project_id=project_id,
        project_name=str(project[0]),
        project_status=str(project[1]),
        scope=str(project[2]),
        settings=settings,
        applications=applications,
        processes=processes,
        team=team,
        candidates=_candidates(connection, organization_id, project_id),
        firm_domains=firm_domains(connection, organization_id),
        known_systems=_known_systems(applications),
        independence_required=independence.required(),
        period=period,
        library=_library_areas(controls),
        process_offers=process_offers,
        controls=controls,
        templates=templates,
        agents=agents,
        pbc_preview=[
            PbcPreviewItem(
                control_id=control.id,
                control_ref=control.control_ref,
                recipient=recipient_for(control, settings),
                to_coordinator=_EMAIL.fullmatch(control.owner_email) is None,
                items=control.pbc_items,
            )
            for control in controls
            if control.included
        ],
        readiness=readiness,
        ready=ready,
        plan=_latest_plan(connection, project_id),
        # Filled below from this exact snapshot so its fingerprint covers every
        # launch-relevant record a person reviewed.
        plan_preview=None,
        started=settings.kicked_off_at is not None,
        drafting=_drafting(connection, project_id),
        launch=_launch_summary(connection, project_id),
        rcm_source=source,
        rcm_file_name=file_name,
        open_import_id=open_import,
        setup_draft=draft_body(connection, project_id),
        owner_suggestions=owner_email_suggestions(controls, settings.client_domains),
    )
    if settings.kicked_off_at is None:
        body.plan_preview = _plan_preview(body)
    return body


def _library_areas(controls: list[ControlBody]) -> list[LibraryArea]:
    loaded = {control.library_key for control in controls if control.source == "LIBRARY"}
    areas: list[LibraryArea] = []
    for domain in DOMAINS:
        keys = [control.key for control in LIBRARY if control.domain == domain]
        if keys:
            areas.append(
                LibraryArea(
                    domain=domain,
                    controls=len(keys),
                    loaded=sum(1 for key in keys if key in loaded),
                )
            )
    return areas


def _rcm_state(
    connection: psycopg.Connection[Any], project_id: UUID, controls: list[ControlBody]
) -> tuple[Literal["NONE", "LIBRARY", "UPLOAD"], str, UUID | None]:
    """Where the RCM came from, and the upload a person is still mapping, if any."""
    open_row = connection.execute(
        "SELECT id FROM rcm_imports WHERE project_id = %s AND status = 'MAPPING'",
        (project_id,),
    ).fetchone()
    open_import = None if open_row is None else open_row[0]
    if not controls:
        return "NONE", "", open_import
    if not any(control.source == "UPLOAD" for control in controls):
        return "LIBRARY", "", open_import
    imported = connection.execute(
        """
        SELECT file_name FROM rcm_imports
        WHERE project_id = %s AND status = 'IMPORTED'
        ORDER BY imported_at DESC LIMIT 1
        """,
        (project_id,),
    ).fetchone()
    return "UPLOAD", "" if imported is None else str(imported[0]), open_import


def _settings(connection: psycopg.Connection[Any], project_id: UUID) -> SettingsBody:
    row = connection.execute(
        """
        SELECT period_end, client_coordinator_name, client_coordinator_email, client_domains,
               pbc_due_days, pbc_follow_up_days, pbc_max_follow_ups, templates_confirmed_at,
               kicked_off_at, version, client_name, engagement_type, period_start,
               fiscal_year, methodology, reporting_objectives, frameworks, scope_finalized_at
        FROM engagement_settings WHERE project_id = %s
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return SettingsBody(
        client_name=str(row[10]),
        engagement_type=str(row[11]),
        period_end=row[0],
        client_coordinator_name=str(row[1]),
        client_coordinator_email=str(row[2]),
        client_domains=[str(item) for item in row[3]],
        pbc_due_days=int(row[4]),
        pbc_follow_up_days=int(row[5]),
        pbc_max_follow_ups=int(row[6]),
        templates_confirmed_at=row[7],
        kicked_off_at=row[8],
        version=int(row[9]),
        period_start=row[12],
        fiscal_year=str(row[13]),
        methodology=None if row[14] is None else str(row[14]),
        reporting_objectives=str(row[15]),
        frameworks=None if row[16] is None else [str(item) for item in row[16]],
        scope_finalized_at=row[17],
    )


_LIBRARY_BY_KEY = {control.key: control for control in LIBRARY}


def _other_controls(
    controls: dict[str, tuple[UUID, bool]],
    recommendations: list[RecommendationBody],
    by_standard: dict[str, tuple[UUID, bool, str, str]] | None = None,
) -> list[OtherControlBody]:
    """The library's controls not in scope for the system and not waiting as a
    recommendation. The client's own controls on other systems are offered in the system
    wizard, adapted to the system (adapted_controls), never copied as they are from here
    (decided by the product owner)."""
    # Waiting as a recommendation, or out of scope because the SOC report covers it (shown
    # with its own "Keep in scope").
    waiting = {
        r.control_ref.upper()
        for r in recommendations
        if (r.status == "PROPOSED" and r.kind == "INCLUDE")
        or (r.status == "ACCEPTED" and r.kind == "EXCLUDE")
    }
    others: list[OtherControlBody] = []
    for control in LIBRARY:
        ref = control.control_ref.upper()
        if control.domain not in SYSTEM_DOMAINS or ref in waiting:
            continue
        # The system's own control for the standard, under whatever reference it has
        # (ITGC-AD-01 adapted from the client's controls): offered back when out of scope,
        # and not offered at all when in scope.
        own = (by_standard or {}).get(control.key)
        if own is not None:
            if own[1]:
                continue
            others.append(
                OtherControlBody(
                    library_key=control.key,
                    control_ref=own[2],
                    title=own[3],
                    domain=control.domain,
                    control_id=own[0],
                )  # fmt: skip
            )
            continue
        current = controls.get(ref)
        if current is not None and current[1]:
            continue
        others.append(
            OtherControlBody(
                library_key=control.key,
                control_ref=control.control_ref,
                title=control.title,
                domain=control.domain,
                control_id=None if current is None else current[0],
            )
        )
    return others


def _live_cuec(item: dict[str, Any], controls: dict[str, tuple[UUID, bool]]) -> CuecBody:
    """A reviewed CUEC with the system's control for it as it stands now."""
    ref = item.get("control_ref")
    control_ref = ref if isinstance(ref, str) and ref != "" else None
    current = None if control_ref is None else controls.get(control_ref.upper())
    stored = item.get("control_id")
    return CuecBody(
        ref=str(item.get("ref", "")),
        text=str(item.get("text", "")),
        control_id=current[0] if current is not None else stored,
        control_ref=control_ref,
        in_scope=current is not None and current[1],
    )


def _applications(connection: psycopg.Connection[Any], project_id: UUID) -> list[ApplicationBody]:
    rows = connection.execute(
        """
        SELECT a.id, a.name, a.description, a.layer, a.hosting, a.soc_expected,
               a.facts_source, a.facts_reason, a.facts_confirmed, a.version,
               r.review_status, r.source, r.basis, r.summary, r.coverage, r.cuecs, r.note,
               r.reviewed_at, a.purpose, a.processes, a.owner, coalesce(a.ref_code, ''),
               a.environment, a.control_areas, a.control_areas_suggested,
               a.control_areas_decided_at, a.out_of_scope_at, a.out_of_scope_reason
        FROM engagement_applications a
        LEFT JOIN system_reviews r ON r.application_id = a.id
        WHERE a.project_id = %s ORDER BY a.name
        """,
        (project_id,),
    ).fetchall()
    # Whether a CUEC is answered is read from the controls as they are now, not from the
    # review: a decision taken after the review changes it.
    live: dict[UUID, dict[str, tuple[UUID, bool]]] = {}
    # Each system's control for a library standard, by the standard: (id, included,
    # reference, title).
    standards: dict[UUID, dict[str, tuple[UUID, bool, str, str]]] = {}
    for app_id, ref, control_id, included, key, shown, title in connection.execute(
        """
        SELECT engagement_application_id, upper(control_ref), id, included, library_key,
               control_ref, title
        FROM engagement_controls
        WHERE project_id = %s AND engagement_application_id IS NOT NULL
        """,
        (project_id,),
    ).fetchall():
        known = live.setdefault(app_id, {})
        if ref not in known or (included and not known[ref][1]):
            known[ref] = (control_id, bool(included))
        if key is not None and str(key) in BY_KEY:
            standards.setdefault(app_id, {})[str(key)] = (
                control_id, bool(included), str(shown), str(title),
            )  # fmt: skip
    # Integrations read both ways: the pair is stored once, from the system that named it.
    integrations: dict[UUID, list[UUID]] = {}
    for one, other in connection.execute(
        "SELECT application_id, related_application_id FROM engagement_system_integrations "
        "WHERE project_id = %s ORDER BY created_at",
        (project_id,),
    ).fetchall():
        integrations.setdefault(one, []).append(other)
        integrations.setdefault(other, []).append(one)
    linked: dict[UUID, list[UUID]] = {}
    for application_id, process_id in connection.execute(
        "SELECT application_id, process_id FROM engagement_process_systems "
        "WHERE project_id = %s ORDER BY created_at",
        (project_id,),
    ).fetchall():
        linked.setdefault(application_id, []).append(process_id)
    recommendations: dict[UUID, list[RecommendationBody]] = {}
    for rec in connection.execute(
        """
        SELECT s.id, s.application_id, s.kind, s.control_id, coalesce(c.control_ref, ''),
               coalesce(c.title, ''), s.cuec, s.reason, s.status, s.library_key, s.cuec_refs
        FROM system_recommendations s
        LEFT JOIN engagement_controls c ON c.id = s.control_id
        WHERE s.project_id = %s
        ORDER BY CASE s.kind WHEN 'INCLUDE' THEN 0 WHEN 'EXCLUDE' THEN 1
                             WHEN 'ADD_SOC_REVIEW' THEN 2 ELSE 3 END,
                 c.control_ref, s.created_at
        """,
        (project_id,),
    ).fetchall():
        library = _LIBRARY_BY_KEY.get(str(rec[9])) if rec[9] is not None else None
        recommendations.setdefault(rec[1], []).append(
            RecommendationBody(
                id=rec[0],
                kind=rec[2],
                control_id=rec[3],
                library_key=None if rec[9] is None else str(rec[9]),
                control_ref=str(rec[4]) if library is None else library.control_ref,
                control_title=str(rec[5]) if library is None else library.title,
                cuec=str(rec[6]),
                reason=str(rec[7]),
                cuec_refs=[str(ref) for ref in (rec[10] or []) if isinstance(ref, str)],
                status=rec[8],
            )
        )
    return [
        ApplicationBody(
            id=row[0],
            name=str(row[1]),
            description=str(row[2]),
            layer=str(row[3]),
            hosting=None if row[4] is None else str(row[4]),
            soc_expected=row[5],
            facts_source=str(row[6]),
            facts_reason=str(row[7]),
            facts_confirmed=bool(row[8]),
            version=int(row[9]),
            review=None
            if row[10] is None
            else SystemReviewBody(
                status=row[10],
                source=row[11],
                basis=row[12],
                summary=str(row[13]),
                coverage=str(row[14]),
                cuecs=[
                    _live_cuec(item, live.get(row[0], {}))
                    for item in (row[15] or [])
                    if isinstance(item, dict)
                ],
                note=str(row[16]),
                reviewed_at=row[17],
            ),
            recommendations=recommendations.get(row[0], []),
            controls_in_scope=sum(1 for _, included in live.get(row[0], {}).values() if included),
            other_controls=_other_controls(
                live.get(row[0], {}), recommendations.get(row[0], []), standards.get(row[0], {})
            ),
            purpose=str(row[18]),
            processes=str(row[19]),
            owner=str(row[20]),
            ref_code=str(row[21]),
            assessment=assessment_body(connection, row[0]),
            soc_reports=report_bodies(connection, row[0]),
            environment=None if row[22] is None else str(row[22]),
            integration_ids=integrations.get(row[0], []),
            process_ids=linked.get(row[0], []),
            control_areas=None if row[23] is None else [str(area) for area in row[23]],
            control_areas_suggested=row[24] if isinstance(row[24], dict) else None,
            control_areas_decided_at=row[25],
            out_of_scope_at=row[26],
            out_of_scope_reason=str(row[27]),
        )
        for row in rows
    ]


def pending_reviews(body: OnboardingBody) -> list[UUID]:
    """The systems whose scoping review is waiting to run, to hand to the worker."""
    return [
        app.id
        for app in body.applications
        if app.review is not None and app.review.status == "PENDING"
    ]


def _team(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> list[TeamMemberBody]:
    rows = connection.execute(
        """
        SELECT u.id, u.display_name, u.email::text, r.engagement_role, m.role::text
        FROM project_memberships pm
        CROSS JOIN LATERAL (
            SELECT pm.engagement_role
            UNION
            SELECT x.engagement_role FROM project_member_roles x
            WHERE x.project_id = pm.project_id AND x.user_id = pm.user_id AND %s
        ) AS r (engagement_role)
        JOIN users u ON u.id = pm.user_id
        JOIN memberships m ON m.user_id = pm.user_id AND m.organization_id = pm.organization_id
        WHERE pm.organization_id = %s AND pm.project_id = %s AND m.status = 'ACTIVE'
        ORDER BY CASE r.engagement_role WHEN 'LEAD' THEN 0 WHEN 'REVIEWER' THEN 2 ELSE 1 END,
                 u.display_name
        """,
        # Extra roles count only while independence is off (migration 0046).
        (not independence.required(), organization_id, project_id),
    ).fetchall()
    ids = list(dict.fromkeys(row[0] for row in rows))
    validated = signed_in(connection, ids)
    held = held_welcomes(connection, organization_id, ids)
    return [
        TeamMemberBody(
            user_id=row[0],
            display_name=str(row[1]),
            email=str(row[2]),
            engagement_role=str(row[3]),
            organization_role=str(row[4]),
            validated=row[0] in validated,
            welcome_held=row[0] in held,
        )
        for row in rows
    ]


def _candidates(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> list[CandidateBody]:
    rows = connection.execute(
        """
        SELECT u.id, u.display_name, u.email::text, m.role::text
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = %s AND m.status = 'ACTIVE'
          AND NOT EXISTS (
              SELECT 1 FROM project_memberships pm
              WHERE pm.project_id = %s AND pm.user_id = m.user_id
          )
        ORDER BY u.display_name
        """,
        (organization_id, project_id),
    ).fetchall()
    return [
        CandidateBody(
            user_id=row[0],
            display_name=str(row[1]),
            email=str(row[2]),
            organization_role=str(row[3]),
        )
        for row in rows
    ]


_CONTROL_COLUMNS = """
    id, library_key, control_ref, domain, title, risk, activity, frequency, nature,
    key_control, included, owner_name, owner_email, application_ids, test_attributes,
    pbc_items, template_key, agent_key, version,
    source, domain_label, frequency_label, nature_label, custom_fields,
    engagement_application_id,
    (SELECT a.name FROM engagement_applications a
     WHERE a.id = engagement_controls.engagement_application_id),
    process_id,
    (SELECT string_agg(u.name, ' · ' ORDER BY u.name) FROM engagement_control_scopes s
     JOIN engagement_scope_units u ON u.id = s.unit_id
     WHERE s.engagement_control_id = engagement_controls.id AND s.role = 'OPERATES')
"""


def _controls(connection: psycopg.Connection[Any], project_id: UUID) -> list[ControlBody]:
    rows = connection.execute(
        f"SELECT {_CONTROL_COLUMNS} FROM engagement_controls WHERE project_id = %s "
        "ORDER BY control_ref",
        (project_id,),
    ).fetchall()
    tested = {
        str(row[0])
        for row in connection.execute(
            """
            SELECT DISTINCT upper(c.control_ref) FROM engagement_controls c
            WHERE c.project_id = %s AND c.id IN (SELECT id FROM _tested_controls)
            """.replace("_tested_controls", _TESTED),
            (project_id,),
        ).fetchall()
    }
    controls = [_control(row) for row in rows]
    for control in controls:
        control.tested = control.control_ref.upper() in tested
    return controls


def _control(row: tuple[Any, ...]) -> ControlBody:
    return ControlBody(
        id=row[0],
        library_key=str(row[1]),
        control_ref=str(row[2]),
        domain=str(row[3]),
        title=str(row[4]),
        risk=str(row[5]),
        activity=str(row[6]),
        frequency=str(row[7]),
        nature=str(row[8]),
        key_control=bool(row[9]),
        included=bool(row[10]),
        owner_name=str(row[11]),
        owner_email=str(row[12]),
        application_ids=list(row[13]),
        test_attributes=[str(item) for item in row[14]],
        pbc_items=[str(item) for item in row[15]],
        template_key=str(row[16]),
        agent_key=str(row[17]),
        sample_size=sample_size(str(row[7]), str(row[8])),
        version=int(row[18]),
        source=str(row[19]),
        domain_label=str(row[20]),
        frequency_label=str(row[21]),
        nature_label=str(row[22]),
        custom_fields=[
            CustomField(label=str(item.get("label", "")), value=str(item.get("value", "")))
            for item in row[23]
            if isinstance(item, dict)
        ],
        application_id=row[24],
        application_name="" if row[25] is None else str(row[25]),
        label=control_label(
            str(row[2]),
            None if row[25] is None else str(row[25]),
            None if row[27] is None else str(row[27]),
        ),
        process_id=row[26],
    )


def _processes(
    connection: psycopg.Connection[Any], project_id: UUID, controls: list[ControlBody]
) -> list[ProcessBody]:
    counts: dict[UUID, int] = {}
    for control in controls:
        if control.process_id is not None and control.included:
            counts[control.process_id] = counts.get(control.process_id, 0) + 1
    systems: dict[UUID, list[UUID]] = {}
    primary: dict[UUID, UUID] = {}
    for process_id, application_id, is_primary in connection.execute(
        "SELECT process_id, application_id, is_primary FROM engagement_process_systems "
        "WHERE project_id = %s ORDER BY is_primary DESC, created_at",
        (project_id,),
    ).fetchall():
        systems.setdefault(process_id, []).append(application_id)
        if is_primary:
            primary[process_id] = application_id
    return [
        ProcessBody(
            id=row[0],
            name=str(row[1]),
            domain=str(row[2]),
            domain_label=DOMAIN_LABELS.get(str(row[2]), str(row[2])),
            version=int(row[3]),
            controls_in_scope=counts.get(row[0], 0),
            system_ids=systems.get(row[0], []),
            primary_system_id=primary.get(row[0]),
            description=str(row[4]),
            owner=str(row[5]),
            control_areas=None if row[6] is None else [str(area) for area in row[6]],
            control_areas_suggested=row[7] if isinstance(row[7], dict) else None,
            control_areas_decided_at=row[8],
        )
        for row in connection.execute(
            "SELECT id, name, domain, version, description, owner, control_areas, "
            "control_areas_suggested, control_areas_decided_at FROM engagement_processes "
            "WHERE project_id = %s ORDER BY name",
            (project_id,),
        ).fetchall()
    ]


def _add_process(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ProcessCreate,
) -> OnboardingBody:
    """Name a business process of the client's own, based on the standard cycle it is
    closest to. Allowed after launch, like adding a system."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    name = " ".join(body.name.split())
    if name == "" or contains_secret({"name": name}):
        raise ValueError("process name is invalid")
    if body.domain not in DOMAINS or runs_on_a_system(body.domain):
        raise ValueError("a process is based on a business cycle")
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO engagement_processes (organization_id, project_id, name, domain)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (project_id, name) DO NOTHING
            RETURNING id
            """,
            (organization_id, project_id, name, body.domain),
        ).fetchone()
        if row is None:
            raise OnboardingState("process exists")
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.process_added",
            {"process_id": str(row[0]), "domain": body.domain},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def _remove_process(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    process_id: UUID,
) -> OnboardingBody:
    """Remove a named process that has no controls. One with controls stays: take its
    controls out of scope instead, so their work and records are kept."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    with transaction(connection) as cursor:
        used = cursor.execute(
            "SELECT 1 FROM engagement_controls WHERE project_id = %s AND process_id = %s LIMIT 1",
            (project_id, process_id),
        ).fetchone()
        if used is not None:
            raise OnboardingState("process has controls")
        gone = cursor.execute(
            "DELETE FROM engagement_processes WHERE project_id = %s AND id = %s RETURNING id",
            (project_id, process_id),
        ).fetchone()
        if gone is None:
            raise ValueError("process is unknown")
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.process_removed",
            {"process_id": str(process_id)},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def _agents(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    controls: list[ControlBody],
) -> list[StaffedAgent]:
    needed = list(CORE_AGENTS)
    for control in controls:
        if control.included and control.agent_key not in needed:
            needed.append(control.agent_key)
    rows = connection.execute(
        """
        SELECT d.agent_key, d.name, d.status::text = 'ACTIVE',
               EXISTS (
                   SELECT 1 FROM agent_instances i
                   WHERE i.agent_definition_id = d.id AND i.project_id = %s
               )
        FROM agent_definitions d
        WHERE d.organization_id = %s AND d.agent_key = ANY(%s)
        """,
        (project_id, organization_id, needed),
    ).fetchall()
    found = {str(row[0]): row for row in rows}
    return [
        StaffedAgent(
            agent_key=key,
            name=str(found[key][1]) if key in found else key,
            active=bool(found[key][2]) if key in found else False,
            staffed=bool(found[key][3]) if key in found else False,
        )
        for key in needed
    ]


def _readiness(
    scope: str,
    settings: SettingsBody,
    applications: list[ApplicationBody],
    team: list[TeamMemberBody],
    controls: list[ControlBody],
    agents: list[StaffedAgent],
    period: PeriodState | None = None,
) -> list[ReadinessItem]:
    included = [control for control in controls if control.included]
    scope_issues: list[str] = []
    scope_advisories: list[str] = []
    if scope.strip() == "":
        scope_issues.append("Describe what the engagement covers.")
    if settings.period_end is None:
        scope_issues.append("Set the period end date.")
    if settings.methodology is None:
        scope_issues.append("Choose the audit methodology.")
    if period is not None:
        # A disagreement holds launch until it is fixed or a person confirms the period.
        scope_issues += [conflict.message for conflict in period.open]
        scope_advisories += [c.message for c in period.conflicts if not c.blocking]
    if settings.period_end is not None and settings.period_start is None:
        scope_advisories.append(
            "Save the profile to record the period start. Until then the period is "
            "the twelve months to its end."
        )
    team_issues: list[str] = []
    team_advisories: list[str] = []
    roles = {member.engagement_role for member in team}
    if "LEAD" not in roles:
        team_issues.append("Name an engagement lead.")
    if "REVIEWER" not in roles and independence.required():
        team_issues.append("Name an independent reviewer.")
    if not independence.required():
        team_advisories.append(
            "Development mode: reviewer independence is not enforced, so anyone on the team "
            "may review, including their own work. Not allowed in production."
        )
    rcm_issues: list[str] = []
    # Owners are not assigned on setup: a request without one goes to the PBC coordinator.
    rcm_advisories: list[str] = []
    # Controls are set up in the Controls section once the engagement runs (decided by the
    # product owner, 25 October 2026): an engagement launches without them, and each
    # control added afterwards gets its work then (scope_changes.reconcile_scope).
    if not included:
        rcm_advisories.append(
            "No controls yet: load the standard library or upload the client's RCM."
            if settings.kicked_off_at is not None
            else "No controls yet. After launch, set up the systems and controls in "
            "Controls: load the standard library or upload the client's RCM."
        )
    # Systems come from the RCM: identified on upload, or added here for the library.
    on_systems = [c for c in included if runs_on_a_system(c.domain)]
    if on_systems and not applications:
        rcm_issues.append("Add the in-scope systems the controls run on.")
    missing_app = [c.control_ref for c in on_systems if c.application_id is None]
    if missing_app and applications:
        rcm_issues.append(f"Choose the systems {_list(missing_app)} covers.")
    # The workpaper templates need no confirmation (product owner, 22 October 2026): the
    # standard ones, or the firm's once saved, apply by default, and a change applies to
    # workpapers not yet started. The step is there to customise and preview.
    template_issues: list[str] = []
    # Evidence requests are not part of setup: launch drafts one per control and sends
    # none, and the client's PBC coordinator and domains are set in the Evidence section.
    agent_issues = [
        f"{agent.name} is {'disabled' if not agent.active else 'not on the team'}."
        for agent in agents
        if not (agent.active and agent.staffed)
    ]
    return [
        ReadinessItem(
            step="scope",
            title="Profile and period",
            complete=not scope_issues,
            issues=scope_issues,
            advisories=scope_advisories,
        ),
        ReadinessItem(
            step="team",
            title="Team and access",
            complete=not team_issues,
            issues=team_issues,
            advisories=team_advisories,
        ),
        ReadinessItem(
            step="rcm",
            title="Risk and control matrix",
            complete=not rcm_issues,
            issues=rcm_issues,
            advisories=rcm_advisories,
        ),
        ReadinessItem(
            step="workpapers",
            title="Workpaper templates",
            complete=not template_issues,
            issues=template_issues,
        ),
        ReadinessItem(
            step="agents", title="AI workforce", complete=not agent_issues, issues=agent_issues
        ),
    ]


def _list(refs: list[str]) -> str:
    return ", ".join(refs[:4]) + (f" and {len(refs) - 4} more" if len(refs) > 4 else "")


# Setup changes


def _authorize_setup(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    *,
    after_start: bool = False,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    row = connection.execute(
        """
        SELECT s.kicked_off_at IS NOT NULL, p.status::text
        FROM engagement_settings s JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = %s AND p.organization_id = %s
        """,
        (project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    if row[1] == "ARCHIVED":
        raise OnboardingState("engagement is archived")
    if row[1] == "COMPLETED":
        raise OnboardingState("engagement is completed")
    if row[0] is True and not after_start:
        raise OnboardingState("engagement has started")


def authorize_controls_setup(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> None:
    """Loading the library or importing an RCM replaces the engagement's control set.
    Before launch that is plain setup. After launch it is allowed only while the
    engagement has no controls (decided by the product owner: controls are set up in the
    Controls section once the engagement runs), so nothing with work attached is ever
    replaced; controls are then changed one at a time."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    if started(connection, project_id):
        existing = connection.execute(
            "SELECT 1 FROM engagement_controls WHERE project_id = %s LIMIT 1", (project_id,)
        ).fetchone()
        if existing is not None:
            raise OnboardingState("controls are already set up")


def _update_scope(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ScopeUpdate,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    scope = _checked_scope(body.scope)
    with transaction(connection) as cursor:
        _write_scope(cursor, organization_id, project_id, principal.id, scope)
        _touch(cursor, project_id, "period_end = %s", (body.period_end,))
    return _snapshot(connection, organization_id, project_id)


def _checked_scope(text: str) -> str:
    scope = text.strip()
    if contains_secret({"scope": scope}):
        raise ValueError("scope holds a secret")
    return scope


def _write_scope(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    scope: str,
) -> None:
    """The engagement's scope narrative, within the caller's transaction."""
    cursor.execute(
        """
        UPDATE projects SET scope = %s, version = version + 1, updated_at = clock_timestamp()
        WHERE id = %s AND organization_id = %s AND scope IS DISTINCT FROM %s
        """,
        (scope, project_id, organization_id, scope),
    )
    _audit(cursor, organization_id, project_id, actor_id, "onboarding.scope", {})


def _confirm_period(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: PeriodConfirm,
) -> OnboardingBody:
    """A person confirms the period as recorded where the engagement's words disagree
    with it. Before and after launch alike; nothing changes but the confirmation."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    with transaction(connection) as cursor:
        cursor.execute(
            "SELECT 1 FROM engagement_settings WHERE project_id = %s FOR UPDATE", (project_id,)
        )
        state = period_state(connection, project_id)
        if state.basis != body.basis:
            raise OnboardingState("the period changed")
        blocking = [conflict for conflict in state.conflicts if conflict.blocking]
        if not blocking:
            raise OnboardingState("nothing to confirm")
        cursor.execute(
            """
            UPDATE engagement_settings
            SET period_confirmed_at = clock_timestamp(), period_confirmed_by = %s,
                period_confirmed_basis = %s, version = version + 1,
                updated_at = clock_timestamp()
            WHERE project_id = %s
            """,
            (principal.id, state.basis, project_id),
        )
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.period_confirmed",
            {"conflicts": [conflict.kind for conflict in blocking]},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def _align_period(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: PeriodAlign,
) -> OnboardingBody:
    """Correct where the engagement's name and its period disagree (decided by the
    product owner: corrected where the conflict is shown): the period end moves to the
    year the name points at, with a twelve-month start; or the name's year becomes the
    period's. Before launch only: the period is part of the launched plan."""
    _authorize_setup(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        cursor.execute(
            "SELECT 1 FROM engagement_settings WHERE project_id = %s FOR UPDATE", (project_id,)
        )
        state = period_state(connection, project_id)
        if state.basis != body.basis:
            raise OnboardingState("the period changed")
        conflict = next((c for c in state.conflicts if c.kind == "NAME_YEAR"), None)
        if conflict is None:
            raise OnboardingState("nothing to align")
        if body.to == "period_end":
            end = conflict.period_end_fix
            if end is None:
                raise OnboardingState("nothing to align")
            start = _twelve_months_to(end)
            cursor.execute(
                """
                UPDATE engagement_settings
                SET period_end = %s, period_start = %s, version = version + 1,
                    updated_at = clock_timestamp()
                WHERE project_id = %s
                """,
                (end, start, project_id),
            )
            change: dict[str, Any] = {"period_end": end.isoformat()}
        else:
            name = conflict.name_fix
            if name is None or name.strip() == "":
                raise OnboardingState("nothing to align")
            cursor.execute(
                """
                UPDATE projects SET name = %s, version = version + 1, updated_at = clock_timestamp()
                WHERE id = %s
                """,
                (name, project_id),
            )
            change = {"name": name}
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.period_aligned",
            {"to": body.to, **change},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def _twelve_months_to(end: date) -> date:
    """The first day of the twelve months that end on a date."""
    try:
        start = end.replace(year=end.year - 1)
    except ValueError:  # 29 February
        start = end.replace(year=end.year - 1, day=28)
    return start + timedelta(days=1)


def _update_profile(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ProfileUpdate,
) -> OnboardingBody:
    """The client, the kind of engagement, the period, and, when given, the scope: the
    profile step's one Save, written in one transaction so it lands whole or not at all."""
    _authorize_setup(connection, principal, organization_id, project_id)
    client = body.client_name.strip()
    if contains_secret({"client": client}):
        raise ValueError("client name holds a secret")
    scope = None if body.scope is None else _checked_scope(body.scope)
    with transaction(connection) as cursor:
        from ai_workforce_api.clients import assign_client, fold

        current = cursor.execute(
            "SELECT client_name FROM engagement_settings WHERE project_id = %s", (project_id,)
        ).fetchone()
        if current is None or fold(client).casefold() != str(current[0]).casefold():
            assign_client(cursor, organization_id, project_id, principal.id, name=client)
        if contains_secret(
            {"fiscal": body.fiscal_year or "", "objectives": body.reporting_objectives or ""}
        ):
            raise ValueError("profile holds a secret")
        start = cursor.execute(
            "SELECT period_start, period_end FROM engagement_settings WHERE project_id = %s",
            (project_id,),
        ).fetchone()
        assert start is not None
        fields = body.model_fields_set
        new_start = body.period_start if "period_start" in fields else start[0]
        new_end = body.period_end if "period_end" in fields else start[1]
        if new_start is not None and new_end is not None and new_start >= new_end:
            raise ValueError("the period starts on or after it ends")
        _touch(
            cursor,
            project_id,
            "engagement_type = %s, "
            "period_end = CASE WHEN %s THEN %s ELSE period_end END, "
            "period_start = CASE WHEN %s THEN %s ELSE period_start END, "
            "fiscal_year = coalesce(%s, fiscal_year), methodology = coalesce(%s, methodology), "
            "reporting_objectives = coalesce(%s, reporting_objectives)",
            (
                body.engagement_type,
                "period_end" in fields, body.period_end,
                "period_start" in fields, body.period_start,
                None if body.fiscal_year is None else " ".join(body.fiscal_year.split()),
                body.methodology,
                None if body.reporting_objectives is None else body.reporting_objectives.strip(),
            ),
        )  # fmt: skip
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.profile",
            {
                "engagement_type": body.engagement_type,
                "methodology": body.methodology,
                "period_start": body.period_start and body.period_start.isoformat(),
                "period_end": body.period_end and body.period_end.isoformat(),
            },
        )  # fmt: skip
        if scope is not None:
            _write_scope(cursor, organization_id, project_id, principal.id, scope)
    return _snapshot(connection, organization_id, project_id)


def _add_application(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ApplicationCreate,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    name = " ".join(body.name.split())
    description = body.description.strip()
    if name == "" or contains_secret({"name": name, "description": description}):
        raise ValueError("application is invalid")
    if name.casefold() in _taken_names(connection, project_id):
        raise OnboardingState(SYSTEM_EXISTS)
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO engagement_applications (organization_id, project_id, name, description)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (organization_id, project_id, name, description),
        ).fetchone()
        if row is None:
            # Another request added the same system a moment ago.
            raise OnboardingState(SYSTEM_EXISTS)
        if row is not None:
            # A new application joins every control: each family gets an instance for it.
            add_application_everywhere(cursor, project_id, UUID(str(row[0])))
            track_review(cursor, organization_id, project_id, UUID(str(row[0])), principal.id)
            _audit(cursor, organization_id, project_id, principal.id, "onboarding.application", {})
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


SYSTEM_EXISTS = "system is already in scope"


def _taken_names(connection: psycopg.Connection[Any], project_id: UUID) -> set[str]:
    """The engagement's system names as compared for duplicates: case and spacing aside."""
    rows = connection.execute(
        "SELECT name FROM engagement_applications WHERE project_id = %s", (project_id,)
    ).fetchall()
    return {" ".join(str(row[0]).split()).casefold() for row in rows}


def _known_systems(applications: list[ApplicationBody]) -> list[KnownSystem]:
    """The catalog, less what is already in scope. Plain "SAP" is left out: pick the product."""
    taken = {app.name.casefold() for app in applications}
    return [
        KnownSystem(name=name, layer=layer, category=KNOWN_CATEGORIES.get(name, ""))
        for name, layer, _patterns in KNOWN_SYSTEMS
        if name != "SAP" and name.casefold() not in taken
    ]


def _add_known_systems(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: KnownSystemsAdd,
) -> OnboardingBody:
    """Add several systems from the catalog at once. A name not in the catalog is refused."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    catalog = {name: layer for name, layer, _patterns in KNOWN_SYSTEMS}
    chosen = list(dict.fromkeys(body.names))
    if any(name not in catalog for name in chosen):
        raise ValueError("system is not in the catalog")
    picks: dict[str, str] = {name: catalog[name] for name in chosen}
    for item in body.custom:
        name = " ".join(item.name.split())
        if name == "" or contains_secret({"name": name}):
            raise ValueError("application is invalid")
        picks.setdefault(name, item.layer)
    if not picks:
        raise ValueError("no system chosen")
    # A system already in scope, however its name is cased or spaced, is not added again.
    taken = _taken_names(connection, project_id)
    picks = {name: layer for name, layer in picks.items() if name.casefold() not in taken}
    if not picks:
        raise OnboardingState(SYSTEM_EXISTS)
    added = 0
    with transaction(connection) as cursor:
        for name, layer in picks.items():
            row = cursor.execute(
                """
                INSERT INTO engagement_applications (
                    organization_id, project_id, name, description, layer
                )
                VALUES (%s, %s, %s, '', %s)
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                (organization_id, project_id, name, layer),
            ).fetchone()
            if row is not None:
                # Like any new system, it joins every control as its own instance.
                add_application_everywhere(cursor, project_id, UUID(str(row[0])))
                # Its review record waits for the wizard's magic wand (milestone 8.10).
                track_review(cursor, organization_id, project_id, UUID(str(row[0])), principal.id)
                added += 1
        if added:
            _audit(
                cursor,
                organization_id,
                project_id,
                principal.id,
                "onboarding.application",
                {"known_systems": added},
            )
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def _remove_application(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    reason: str = "",
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    if started(connection, project_id):
        affected = [
            UUID(str(row[0]))
            for row in connection.execute(
                "SELECT id FROM engagement_controls WHERE project_id = %s "
                "AND engagement_application_id = %s AND included",
                (project_id, application_id),
            ).fetchall()
        ]
        recorded = _reason_for(connection, project_id, affected, reason)
        # The engagement is running: the system's controls leave scope and their open
        # work is cancelled; the system itself stays on record for what was tested.
        with transaction(connection) as cursor:
            found = cursor.execute(
                "SELECT 1 FROM engagement_applications WHERE id = %s AND project_id = %s",
                (application_id, project_id),
            ).fetchone()
            if found is None:
                raise NotVisible()
            cursor.execute(
                """
                UPDATE engagement_controls
                SET included = false, version = version + 1, updated_at = clock_timestamp()
                WHERE project_id = %s AND engagement_application_id = %s AND included
                """,
                (project_id, application_id),
            )
            # The system is marked out of scope (0114): listed apart, out of the counts.
            cursor.execute(
                """
                UPDATE engagement_applications
                SET out_of_scope_at = clock_timestamp(), out_of_scope_by = %s,
                    out_of_scope_reason = %s, version = version + 1
                WHERE id = %s AND project_id = %s
                """,
                (principal.id, reason.strip()[:1000], application_id, project_id),
            )
            _audit(
                cursor, organization_id, project_id, principal.id,
                "onboarding.application_out_of_scope",
                {"application_id": str(application_id), **recorded},
            )  # fmt: skip
        reconcile_scope(connection, organization_id, project_id, principal.id)
        return _snapshot(connection, organization_id, project_id)
    with transaction(connection) as cursor:
        try:
            remove_application_everywhere(cursor, project_id, application_id)
        except InstanceState as error:
            raise OnboardingState(error.detail) from None
        removed = cursor.execute(
            "DELETE FROM engagement_applications WHERE id = %s AND project_id = %s RETURNING id",
            (application_id, project_id),
        ).fetchone()
        if removed is None:
            raise NotVisible()
        _audit(cursor, organization_id, project_id, principal.id, "onboarding.application", {})
    return _snapshot(connection, organization_id, project_id)


def _restore_application(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
) -> OnboardingBody:
    """A system taken out of scope comes back into scope (0114). Its controls stay out of
    scope: they are selected again, as for any system, so nothing returns unreviewed."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            UPDATE engagement_applications
            SET out_of_scope_at = NULL, out_of_scope_by = NULL, out_of_scope_reason = '',
                version = version + 1
            WHERE id = %s AND project_id = %s AND out_of_scope_at IS NOT NULL
            RETURNING id
            """,
            (application_id, project_id),
        ).fetchone()
        if row is None:
            raise OnboardingState("the system is not out of scope")
        _audit(
            cursor, organization_id, project_id, principal.id,
            "onboarding.application_back_in_scope", {"application_id": str(application_id)},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def _add_member(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: TeamAdd,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    member = connection.execute(
        """
        SELECT 1 FROM memberships
        WHERE organization_id = %s AND user_id = %s AND status = 'ACTIVE'
        """,
        (organization_id, body.user_id),
    ).fetchone()
    if member is None:
        raise NotVisible()
    relaxed = not independence.required()
    roles = list(dict.fromkeys([body.engagement_role, *body.additional_roles]))
    if len(roles) > 1 and not relaxed:
        # Segregation of duties: with independence required, one person holds one role.
        raise OnboardingState(ONE_ROLE)
    with transaction(connection) as cursor:
        for role in roles:
            _assign_role(
                cursor, principal, organization_id, project_id, body.user_id, role, relaxed
            )
    return _snapshot(connection, organization_id, project_id)


ONE_ROLE = "one role per person while reviewer independence is required"


def _assign_role(
    cursor: psycopg.Cursor[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
    role: str,
    relaxed: bool,
) -> None:
    """One role for one person, within the caller's transaction."""
    if role == "LEAD":
        # One lead. A new lead moves the previous one to preparer.
        cursor.execute(
            """
            UPDATE project_memberships
            SET engagement_role = 'PREPARER', version = version + 1
            WHERE project_id = %s AND engagement_role = 'LEAD' AND user_id <> %s
            """,
            (project_id, user_id),
        )
        cursor.execute(
            """
            DELETE FROM project_member_roles
            WHERE project_id = %s AND engagement_role = 'LEAD' AND user_id <> %s
            """,
            (project_id, user_id),
        )
    current = cursor.execute(
        "SELECT engagement_role FROM project_memberships WHERE project_id = %s AND user_id = %s",
        (project_id, user_id),
    ).fetchone()
    if relaxed and current is not None and current[0] != role:
        # Development only: keep the role they have and add this one.
        cursor.execute(
            """
            INSERT INTO project_member_roles (project_id, user_id, engagement_role)
            VALUES (%s, %s, %s)
            ON CONFLICT (project_id, user_id, engagement_role) DO NOTHING
            """,
            (project_id, user_id, role),
        )
    else:
        cursor.execute(
            """
            INSERT INTO project_memberships (
                organization_id, project_id, user_id, engagement_role
            )
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (project_id, user_id) DO UPDATE
            SET engagement_role = EXCLUDED.engagement_role,
                version = project_memberships.version + 1
            """,
            (organization_id, project_id, user_id, role),
        )
        if not relaxed:
            # One role per person: any extra roles from development go.
            cursor.execute(
                "DELETE FROM project_member_roles WHERE project_id = %s AND user_id = %s",
                (project_id, user_id),
            )
    _audit(
        cursor,
        organization_id,
        project_id,
        principal.id,
        "onboarding.team",
        {"user_id": str(user_id), "engagement_role": role},
    )


def _remove_member(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
    role: str | None = None,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    if role is not None and not independence.required():
        if _remove_role(connection, principal, organization_id, project_id, user_id, role):
            return _snapshot(connection, organization_id, project_id)
    owner = connection.execute(
        "SELECT owner_user_id FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    if owner is not None and owner[0] == user_id:
        raise OnboardingState("the engagement owner stays on the team")
    impact = _team_impact(connection, project_id, user_id)
    if impact.last_reviewer:
        raise OnboardingState("name another reviewer first")
    with transaction(connection) as cursor:
        removed = cursor.execute(
            "DELETE FROM project_memberships WHERE project_id = %s AND user_id = %s RETURNING id",
            (project_id, user_id),
        ).fetchone()
        if removed is None:
            raise NotVisible()
        # Their open assignments go back to the team; finished work keeps its name.
        released = cursor.execute(
            """
            UPDATE tasks SET assignee_user_id = NULL, version = version + 1
            WHERE project_id = %s AND assignee_user_id = %s
              AND status::text = ANY(%s)
            RETURNING id
            """,
            (project_id, user_id, list(OPEN_TASKS)),
        ).fetchall()
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.team",
            {"user_id": str(user_id), "removed": True, "released_tasks": len(released)},
        )
    return _snapshot(connection, organization_id, project_id)


class TeamImpact(BaseModel):
    """What removing a person from the team would do."""

    # Open work assigned to them, which goes back to the team.
    assigned_tasks: int
    # They are the only reviewer of a running engagement whose reviews must be independent.
    last_reviewer: bool


def _team_impact(
    connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID
) -> TeamImpact:
    row = connection.execute(
        """
        SELECT
          (SELECT count(*) FROM tasks WHERE project_id = %(p)s AND assignee_user_id = %(u)s
             AND status::text = ANY(%(open)s)),
          EXISTS (SELECT 1 FROM project_memberships
                  WHERE project_id = %(p)s AND user_id = %(u)s
                    AND engagement_role = 'REVIEWER'),
          (SELECT count(*) FROM project_memberships
           WHERE project_id = %(p)s AND engagement_role = 'REVIEWER')
        """,
        {"p": project_id, "u": user_id, "open": list(OPEN_TASKS)},
    ).fetchone()
    assert row is not None
    return TeamImpact(
        assigned_tasks=int(row[0]),
        last_reviewer=bool(row[1])
        and int(row[2]) <= 1
        and independence.required()
        and started(connection, project_id),
    )


def _remove_role(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
    role: str,
) -> bool:
    """Take one role from someone who holds several. False when it is their only role."""
    with transaction(connection) as cursor:
        extra = cursor.execute(
            """
            DELETE FROM project_member_roles
            WHERE project_id = %s AND user_id = %s AND engagement_role = %s
            RETURNING id
            """,
            (project_id, user_id, role),
        ).fetchone()
        if extra is None:
            main = cursor.execute(
                """
                SELECT pm.engagement_role,
                       (SELECT x.engagement_role FROM project_member_roles x
                        WHERE x.project_id = pm.project_id AND x.user_id = pm.user_id
                        ORDER BY x.created_at LIMIT 1)
                FROM project_memberships pm
                WHERE pm.project_id = %s AND pm.user_id = %s
                FOR UPDATE
                """,
                (project_id, user_id),
            ).fetchone()
            if main is None or main[0] != role or main[1] is None:
                return False
            # Their main role goes; the next role they hold takes its place.
            cursor.execute(
                """
                UPDATE project_memberships
                SET engagement_role = %s, version = version + 1
                WHERE project_id = %s AND user_id = %s
                """,
                (main[1], project_id, user_id),
            )
            cursor.execute(
                """
                DELETE FROM project_member_roles
                WHERE project_id = %s AND user_id = %s AND engagement_role = %s
                """,
                (project_id, user_id, main[1]),
            )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.team",
            {"user_id": str(user_id), "removed_role": role},
        )
    return True


class ProcessControlAdd(BaseModel):
    library_key: str = Field(pattern=r"^[a-z][a-z0-9-]{0,60}$")


class ControlCreate(BaseModel):
    """A control the team writes itself. A system-bound area needs its system."""

    control_ref: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=200)
    risk: str = Field(default="", max_length=1000)
    activity: str = Field(min_length=1, max_length=4000)
    domain: str
    frequency: str
    nature: str
    key_control: bool = True
    test_attributes: list[str] = Field(min_length=1, max_length=12)
    pbc_items: list[str] = Field(default_factory=list, max_length=12)
    application_id: UUID | None = None
    # A process the team named: the control takes the process's cycle as its area.
    process_id: UUID | None = None

    @field_validator("control_ref", "title", "risk", "activity")
    @classmethod
    def _line(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("test_attributes", "pbc_items")
    @classmethod
    def _lines(cls, value: list[str]) -> list[str]:
        cleaned = [" ".join(item.split())[:300] for item in value]
        return [item for item in cleaned if item]


class ControlScopeUpdate(BaseModel):
    included: bool
    # Why, when the engagement is running and the control has work on record.
    reason: str = Field(default="", max_length=500)


class ScopeReason(BaseModel):
    reason: str = Field(default="", max_length=500)


def _reason_for(
    connection: psycopg.Connection[Any], project_id: UUID, control_ids: list[UUID], reason: str
) -> dict[str, Any]:
    """After launch, taking controls with work on record out of scope needs a reason; the
    impact goes into the audit trail with it."""
    if not started(connection, project_id):
        return {}
    impact = scope_impact(connection, project_id, control_ids)
    why = " ".join(reason.split())
    if impact.material and len(why) < 3:
        raise OnboardingState("say why: this has work on record")
    if contains_secret({"reason": why}):
        raise ValueError("reason holds a secret")
    return {"reason": why, "impact": impact.model_dump()}


def _add_process_control(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ProcessControlAdd,
) -> OnboardingBody:
    """Add one business process control from the library: one row, no system."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    control = next((c for c in LIBRARY if c.key == body.library_key), None)
    if control is None or runs_on_a_system(control.domain):
        raise ValueError("control is not a business process control")
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO engagement_controls (
                organization_id, project_id, library_key, library_version, control_ref,
                domain, title, risk, activity, frequency, nature, application_ids,
                test_attributes, pbc_items, template_key, agent_key, engagement_application_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
            ON CONFLICT DO NOTHING
            """,
            (
                organization_id,
                project_id,
                control.key,
                LIBRARY_VERSION,
                control.control_ref,
                control.domain,
                control.title,
                control.risk,
                control.activity,
                control.frequency,
                control.nature,
                [],
                Json(list(control.test_attributes)),
                Json(list(control.pbc_items)),
                default_template(control.domain),
                DOMAIN_AGENTS[control.domain],
            ),
        )
        _reset_templates(cursor, project_id)
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.control_added",
            {"library_key": control.key},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def _create_control(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ControlCreate,
) -> OnboardingBody:
    """Add a control the team wrote: in scope, with its area's tester and template."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    process_name = ""
    if body.process_id is not None:
        process = connection.execute(
            "SELECT name, domain FROM engagement_processes WHERE project_id = %s AND id = %s",
            (project_id, body.process_id),
        ).fetchone()
        if process is None:
            raise ValueError("process is unknown")
        process_name, body.domain = str(process[0]), str(process[1])
    if body.domain not in DOMAINS:
        raise ValueError("area is unknown")
    if body.frequency not in FREQUENCIES or body.nature not in NATURES:
        raise ValueError("control fields are invalid")
    if not body.control_ref or not body.title or not body.activity:
        raise ValueError("control ID, title, and activity are needed")
    if not body.test_attributes:
        raise ValueError("at least one test attribute is needed")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}", body.control_ref):
        raise ValueError("control ID may use letters, digits, spaces, dots, slashes, and dashes")
    if contains_secret(
        {
            "ref": body.control_ref,
            "title": body.title,
            "risk": body.risk,
            "activity": body.activity,
            "attributes": " ".join(body.test_attributes),
            "pbc": " ".join(body.pbc_items),
        }
    ):
        raise ValueError("control fields hold a secret")
    system_bound = runs_on_a_system(body.domain)
    if system_bound and body.application_id is None:
        raise ValueError("a control in this area belongs to a system")
    if system_bound:
        known = {app.id for app in _applications(connection, project_id)}
        if body.application_id not in known:
            raise ValueError("application is unknown")
    application = body.application_id if system_bound else None
    with transaction(connection) as cursor:
        taken = cursor.execute(
            """
            SELECT 1 FROM engagement_controls
            WHERE project_id = %s AND upper(control_ref) = upper(%s)
              AND engagement_application_id IS NOT DISTINCT FROM %s
            """,
            (project_id, body.control_ref, application),
        ).fetchone()
        if taken is not None:
            raise OnboardingState("control ID exists")
        try:
            row = cursor.execute(
                """
                INSERT INTO engagement_controls (
                    organization_id, project_id, library_key, library_version, control_ref,
                    domain, title, risk, activity, frequency, nature, key_control,
                    application_ids, test_attributes, pbc_items, template_key, agent_key,
                    source, engagement_application_id, process_id, domain_label
                )
                VALUES (%s, %s, %s, 0, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        'MANUAL', %s, %s, %s)
                RETURNING id
                """,
                (
                    organization_id,
                    project_id,
                    f"manual:{uuid4().hex[:12]}",
                    body.control_ref,
                    body.domain,
                    body.title,
                    body.risk,
                    body.activity,
                    body.frequency,
                    body.nature,
                    body.key_control,
                    [] if application is None else [application],
                    Json(body.test_attributes),
                    Json(body.pbc_items),
                    default_template(body.domain),
                    DOMAIN_AGENTS[body.domain],
                    application,
                    body.process_id,
                    process_name,
                ),
            ).fetchone()
        except UniqueViolation:
            # Another request added the same control ID a moment ago.
            raise OnboardingState("control ID exists") from None
        assert row is not None
        _reset_templates(cursor, project_id)
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.control_created",
            {"control_id": str(row[0]), "domain": body.domain, "system_bound": system_bound},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def _scope_control(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: ControlScopeUpdate,
) -> OnboardingBody:
    """Put one control in or out of scope as it stands, changing nothing else about it."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    recorded = (
        {} if body.included else _reason_for(connection, project_id, [control_id], body.reason)
    )
    with transaction(connection) as cursor:
        updated = cursor.execute(
            """
            UPDATE engagement_controls
            SET included = %s, version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND project_id = %s
            RETURNING id
            """,
            (body.included, control_id, project_id),
        ).fetchone()
        if updated is None:
            raise NotVisible()
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.control_scope",
            {"control_id": str(control_id), "included": body.included, **recorded},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def _load_library(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: LibraryLoad,
) -> OnboardingBody:
    authorize_controls_setup(connection, principal, organization_id, project_id)
    if not set(body.domains) <= set(DOMAINS):
        raise ValueError("area is unknown")
    applications = [app.id for app in _applications(connection, project_id)]
    if not applications and any(runs_on_a_system(d) for d in body.domains):
        # A control that runs on a system is one instance per system (Milestone 8.5).
        raise OnboardingState("add an in-scope system first")
    added = 0
    with transaction(connection) as cursor:
        # The library and an uploaded RCM are alternatives. Loading one replaces the other,
        # with the matches to the standards proposed for the upload's controls.
        cursor.execute(
            "DELETE FROM library_match_runs WHERE project_id = %s AND engagement_control_id IN "
            "(SELECT id FROM engagement_controls WHERE project_id = %s AND source = 'UPLOAD')",
            (project_id, project_id),
        )
        replaced = cursor.execute(
            "DELETE FROM engagement_controls WHERE project_id = %s AND source = 'UPLOAD'",
            (project_id,),
        ).rowcount
        # One instance per in-scope system (Milestone 8.5), or one without a system yet.
        targets: list[UUID | None] = list(applications) or [None]
        for control in (c for c in LIBRARY if c.domain in body.domains):
            # A business process control belongs to its process: one row, no system.
            for app in targets if runs_on_a_system(control.domain) else [None]:
                row = cursor.execute(
                    """
                    INSERT INTO engagement_controls (
                        organization_id, project_id, library_key, library_version,
                        control_ref, domain, title, risk, activity, frequency, nature,
                        application_ids, test_attributes, pbc_items, template_key,
                        agent_key, engagement_application_id
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s)
                    ON CONFLICT DO NOTHING
                    RETURNING id
                    """,
                    (
                        organization_id,
                        project_id,
                        control.key,
                        LIBRARY_VERSION,
                        control.control_ref,
                        control.domain,
                        control.title,
                        control.risk,
                        control.activity,
                        control.frequency,
                        control.nature,
                        [] if app is None else [app],
                        Json(list(control.test_attributes)),
                        Json(list(control.pbc_items)),
                        default_template(control.domain),
                        DOMAIN_AGENTS[control.domain],
                        app,
                    ),
                ).fetchone()
                added += 0 if row is None else 1
        if added or replaced:
            _reset_templates(cursor, project_id)
            # With controls in place, each system's scoping can name them.
            track_reviews_for_project(cursor, organization_id, project_id, principal.id)
            _audit(
                cursor,
                organization_id,
                project_id,
                principal.id,
                "onboarding.rcm",
                {"library_version": LIBRARY_VERSION, "added": added, "replaced": replaced},
            )
    # After launch, each control loaded gets its work, as any control added then does.
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def _update_control(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: ControlUpdate,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    if body.frequency not in FREQUENCIES or body.nature not in NATURES:
        raise ValueError("control fields are invalid")
    if (body.domain is not None and body.domain not in DOMAINS) or (
        body.agent_key is not None and body.agent_key not in TESTER_KEYS
    ):
        raise ValueError("area or tester is unknown")
    if body.owner_email != "" and _EMAIL.fullmatch(body.owner_email) is None:
        raise ValueError("owner email is invalid")
    if contains_secret({"name": body.owner_name, "email": body.owner_email}):
        raise ValueError("control fields hold a secret")
    known = {app.id for app in _applications(connection, project_id)}
    if not set(body.application_ids) <= known:
        raise ValueError("application is unknown")
    was = connection.execute(
        "SELECT included FROM engagement_controls WHERE id = %s AND project_id = %s",
        (control_id, project_id),
    ).fetchone()
    recorded = (
        _reason_for(connection, project_id, [control_id], body.reason)
        if was is not None and bool(was[0]) and not body.included
        else {}
    )
    with transaction(connection) as cursor:
        current = cursor.execute(
            """
            SELECT template_key, version, domain, agent_key
            FROM engagement_controls WHERE id = %s AND project_id = %s FOR UPDATE
            """,
            (control_id, project_id),
        ).fetchone()
        if current is None:
            raise NotVisible()
        if int(current[1]) != body.version:
            raise OnboardingState("control changed")
        domain = body.domain or str(current[2])
        changed = _testing_changes(cursor, control_id, project_id, body, domain)
        if changed and not body.acknowledge_testing:
            raise OnboardingState(TESTED_CONTROL_CHANGE)
        agent = body.agent_key or (
            DOMAIN_AGENTS[domain] if domain != current[2] else str(current[3])
        )
        # The template must fit the control's kind; an area change brings its template.
        template = template_for_control(connection, project_id, domain, body.template_key)
        # The chosen systems decide the family's instances; the rest applies to all of them.
        # A business process control has none.
        chosen = body.application_ids if runs_on_a_system(domain) else []
        try:
            family = reconcile_family(cursor, project_id, control_id, chosen)
        except InstanceState as error:
            raise OnboardingState(error.detail) from None
        cursor.execute(
            """
            UPDATE engagement_controls
            SET included = %s, key_control = %s, owner_name = %s, owner_email = %s,
                frequency = %s, nature = %s, template_key = %s,
                domain = %s, agent_key = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = ANY(%s) AND project_id = %s
            """,
            (
                body.included,
                body.key_control,
                body.owner_name,
                body.owner_email.lower(),
                body.frequency,
                body.nature,
                template,
                domain,
                agent,
                family,
                project_id,
            ),
        )
        if str(current[0]) != template:
            _reset_templates(cursor, project_id)
            from ai_workforce_api.workpaper_templates import follow_template

            follow_template(cursor, project_id, [str(current[0]), template])
        if changed:
            _flag_retesting(cursor, organization_id, project_id, control_id, changed)
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.control",
            {
                "control_id": str(control_id),
                "included": body.included,
                **({"after_testing": sorted(changed)} if changed else {}),
                **recorded,
            },
        )
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


TESTED_CONTROL_CHANGE = "control has testing on record"
# The controls with an approved sample or a test sheet: their testing rests on how they
# were defined when it was done.
_TESTED = """(
    SELECT engagement_control_id AS id FROM control_tests WHERE status = 'APPROVED'
    UNION SELECT engagement_control_id FROM test_sheets
) AS tested"""
_LABELS = {"frequency": "Frequency", "nature": "Nature", "domain": "Area"}


def _testing_changes(
    cursor: psycopg.Cursor[Any],
    control_id: UUID,
    project_id: UUID,
    body: ControlUpdate,
    domain: str,
) -> dict[str, tuple[str, str]]:
    """What this edit changes that the control's approved sample or its testing rests on:
    its frequency (the sample size), its nature, or its area (its attributes and tester).
    The edit applies to every system's instance of the control, so any tested instance
    counts. Empty when nothing is tested yet, or nothing of that changes."""
    row = cursor.execute(
        """
        SELECT c.frequency, c.nature, c.domain,
               EXISTS (
                   SELECT 1 FROM engagement_controls f
                   WHERE f.project_id = c.project_id
                     AND upper(f.control_ref) = upper(c.control_ref)
                     AND f.id IN (SELECT id FROM _tested_controls)
               )
        FROM engagement_controls c WHERE c.id = %s AND c.project_id = %s
        """.replace("_tested_controls", _TESTED),
        (control_id, project_id),
    ).fetchone()
    if row is None or not row[3]:
        return {}
    proposed = {"frequency": body.frequency, "nature": body.nature, "domain": domain}
    current = {"frequency": str(row[0]), "nature": str(row[1]), "domain": str(row[2])}
    return {
        field: (current[field], value)
        for field, value in proposed.items()
        if value != current[field]
    }


def _flag_retesting(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    changed: dict[str, tuple[str, str]],
) -> None:
    """An open question on the control holds its testing until a person says whether the
    sample and results still stand."""

    what = "; ".join(
        f"{_LABELS[field]} from {before.replace('_', ' ').lower()} to "
        f"{after.replace('_', ' ').lower()}"
        for field, (before, after) in sorted(changed.items())
    )
    tested = cursor.execute(
        """
        SELECT f.id FROM engagement_controls c
        JOIN engagement_controls f
          ON f.project_id = c.project_id AND upper(f.control_ref) = upper(c.control_ref)
        WHERE c.id = %s AND c.project_id = %s AND f.id IN (SELECT id FROM _tested_controls)
        """.replace("_tested_controls", _TESTED),
        (control_id, project_id),
    ).fetchall()
    for (instance,) in tested:
        _flag_instance(cursor, organization_id, project_id, instance, what)


def _flag_instance(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    what: str,
) -> None:
    from ai_workforce_api.control_context import Issue, raise_issues

    raise_issues(
        cursor, organization_id, project_id, control_id,
        [Issue(
            origin="ATTRIBUTES", kind="CONFLICT",
            topic=f"Changed after testing: {what}"[:120],
            detail=f"The control changed after its sample was approved or tested ({what}).",
            why="The sample size, the attributes, and the results on record rest on the "
            "control as it was. They may no longer test the control as it now is.",
            resolve="Check whether the sample and the results still hold. Test again where "
            "they do not, then resolve this with a note of what was decided.",
        )],
        "RULES",
    )  # fmt: skip


def _bulk_owner(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: OwnerBulk,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    name = body.owner_name.strip()
    email = body.owner_email.strip().lower()
    if body.domain not in DOMAINS:
        raise ValueError("area is unknown")
    if _EMAIL.fullmatch(email) is None or contains_secret({"name": name, "email": email}):
        raise ValueError("owner is invalid")
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE engagement_controls
            SET owner_name = %s, owner_email = %s, version = version + 1,
                updated_at = clock_timestamp()
            WHERE project_id = %s AND domain = %s AND (NOT %s OR owner_email = '')
            """,
            (name, email, project_id, body.domain, body.only_missing),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.control",
            {"domain": body.domain, "bulk_owner": True},
        )
    return _snapshot(connection, organization_id, project_id)


def _owner_batch(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: OwnerBatch,
) -> OwnerBatchResult:
    """Set the owner of the chosen controls, as the control editor does: every instance of
    a control has the same owner, so each brings its family. Requests already sent keep
    their recipient."""
    from ai_workforce_api.control_instances import family_ids

    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    name = body.owner_name.strip()
    email = body.owner_email.strip().lower()
    if not name or _EMAIL.fullmatch(email) is None:
        raise ValueError("owner is invalid")
    if contains_secret({"name": name, "email": email}):
        raise ValueError("owner is invalid")
    with transaction(connection) as cursor:
        chosen: list[UUID] = []
        for control_id in dict.fromkeys(body.control_ids):
            family = family_ids(cursor, project_id, control_id)
            if not family:
                raise NotVisible()
            chosen.extend(member for member in family if member not in chosen)
        updated = cursor.execute(
            """
            UPDATE engagement_controls
            SET owner_name = %s, owner_email = %s, version = version + 1,
                updated_at = clock_timestamp()
            WHERE project_id = %s AND id = ANY(%s)
            RETURNING id
            """,
            (name, email, project_id, chosen),
        ).fetchall()
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.control",
            {"bulk_owner": True, "controls": len(updated)},
        )
    return OwnerBatchResult(updated=len(updated))


def _confirm_templates(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    if not any(c.included for c in _controls(connection, project_id)):
        raise OnboardingState("add controls first")
    with transaction(connection) as cursor:
        _touch(
            cursor,
            project_id,
            "templates_confirmed_at = clock_timestamp(), templates_confirmed_by = %s",
            (principal.id,),
        )
        _audit(cursor, organization_id, project_id, principal.id, "onboarding.templates", {})
    return _snapshot(connection, organization_id, project_id)


def _contacts(name: str, email: str, domains: list[str]) -> tuple[str, str, list[str]]:
    """The coordinator and client domains, checked: a valid email, valid domains, no secret."""
    email = email.strip().lower()
    name = name.strip()
    if email != "" and _EMAIL.fullmatch(email) is None:
        raise ValueError("coordinator email is invalid")
    clean = list(dict.fromkeys(item.strip().lower() for item in domains if item.strip()))
    if any(_DOMAIN.fullmatch(item) is None for item in clean):
        raise ValueError("domain is invalid")
    if contains_secret({"name": name, "email": email}):
        raise ValueError("pbc fields hold a secret")
    return name, email, clean


def _assign_waiting(cursor: psycopg.Cursor[Any], project_id: UUID, email: str) -> int:
    """Draft requests drafted with no recipient go to the coordinator. Sent ones keep theirs."""
    if email == "":
        return 0
    return cursor.execute(
        """
        UPDATE pbc_requests
        SET recipient = %s, version = version + 1, updated_at = clock_timestamp()
        WHERE project_id = %s AND status = 'DRAFT' AND recipient = ''
        """,
        (email, project_id),
    ).rowcount


def _update_pbc(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: PbcUpdate,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    current = _settings(connection, project_id)
    name, email, domains = _contacts(
        current.client_coordinator_name
        if body.client_coordinator_name is None
        else body.client_coordinator_name,
        current.client_coordinator_email
        if body.client_coordinator_email is None
        else body.client_coordinator_email,
        current.client_domains if body.client_domains is None else body.client_domains,
    )
    with transaction(connection) as cursor:
        _touch(
            cursor,
            project_id,
            """
            client_coordinator_name = %s, client_coordinator_email = %s, client_domains = %s,
            pbc_due_days = %s, pbc_follow_up_days = %s, pbc_max_follow_ups = %s
            """,
            (
                name,
                email,
                domains,
                body.pbc_due_days,
                body.pbc_follow_up_days,
                body.pbc_max_follow_ups,
            ),
        )
        assigned = _assign_waiting(cursor, project_id, email)
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.pbc",
            {"assigned_requests": assigned},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def _read_contacts(connection: psycopg.Connection[Any], project_id: UUID) -> ContactsBody:
    settings = _settings(connection, project_id)
    waiting = connection.execute(
        "SELECT count(*) FROM pbc_requests WHERE project_id = %s AND status = 'DRAFT' "
        "AND recipient = ''",
        (project_id,),
    ).fetchone()
    return ContactsBody(
        client_coordinator_name=settings.client_coordinator_name,
        client_coordinator_email=settings.client_coordinator_email,
        client_domains=list(settings.client_domains),
        waiting=0 if waiting is None else int(waiting[0]),
    )


def _get_contacts(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> ContactsBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    return _read_contacts(connection, project_id)


def _update_contacts(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ContactsUpdate,
) -> ContactsBody:
    """Set the client's PBC coordinator and domains, before or after launch."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    name, email, domains = _contacts(
        body.client_coordinator_name, body.client_coordinator_email, body.client_domains
    )
    with transaction(connection) as cursor:
        _touch(
            cursor,
            project_id,
            "client_coordinator_name = %s, client_coordinator_email = %s, client_domains = %s",
            (name, email, domains),
        )
        assigned = _assign_waiting(cursor, project_id, email)
        _audit(
            cursor, organization_id, project_id, principal.id, "evidence.contacts",
            {"assigned_requests": assigned},
        )  # fmt: skip
    return _read_contacts(connection, project_id)


def _preview(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    template_key: str,
    control_id: UUID,
) -> WorkpaperPreview:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    controls = {c.id: c for c in _controls(connection, project_id)}
    control = controls.get(control_id)
    if control is None:
        raise NotVisible()
    project = connection.execute(
        "SELECT name FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    names = {app.id: app.name for app in _applications(connection, project_id)}
    settings = _settings(connection, project_id)
    return preview(
        resolve_template(connection, project_id, template_key),
        PreviewControl(
            control_ref=control.control_ref,
            title=control.title,
            risk=control.risk,
            activity=control.activity,
            frequency=control.frequency,
            nature=control.nature,
            owner_name=control.owner_name,
            test_attributes=tuple(control.test_attributes),
            applications=tuple(names[a] for a in control.application_ids if a in names),
            frequency_label=control.frequency_label,
            nature_label=control.nature_label,
            custom_fields=tuple((item.label, item.value) for item in control.custom_fields),
        ),
        "" if project is None else str(project[0]),
        settings.period_end,
    )


# Kickoff


def build_plan(controls: list[ControlBody]) -> list[PlanItem]:
    """The planner's proposal: a walkthrough, evidence request, test, and review per control."""
    items: list[PlanItem] = []
    reviews: list[str] = []
    for control in sorted(
        (c for c in controls if c.included), key=lambda c: (c.control_ref, c.application_name)
    ):
        # The whole id: instances made together share a time-ordered prefix.
        ref = f"{control.control_ref}#{control.id.hex}"
        name = f"{control.label or control.control_ref} {control.title}"
        attributes = "; ".join(control.test_attributes)
        items.extend(
            [
                PlanItem(
                    key=f"{ref}:walkthrough",
                    kind="walkthrough",
                    title=f"Walkthrough and design: {name}"[:200],
                    description=(
                        f"Walk through one instance and assess design on the design tab "
                        f"of template {control.template_key}. Attributes: {attributes}"
                    )[:4000],
                    agent_key=control.agent_key,
                    control_id=control.id,
                    control_ref=control.control_ref,
                    depends_on=[],
                ),
                PlanItem(
                    key=f"{ref}:evidence",
                    kind="evidence",
                    title=f"Request evidence: {name}"[:200],
                    description=(
                        f"Request from {control.owner_email or 'the PBC coordinator'}: "
                        + "; ".join(control.pbc_items)
                    )[:4000],
                    agent_key="evidence-coordinator",
                    control_id=control.id,
                    control_ref=control.control_ref,
                    depends_on=[],
                ),
                PlanItem(
                    key=f"{ref}:test",
                    kind="test",
                    title=f"Test operating effectiveness: {name}"[:200],
                    description=(
                        f"Select {control.sample_size} sample(s) and test each attribute on the "
                        f"interim tab of template {control.template_key}. Attributes: {attributes}"
                    )[:4000],
                    agent_key=control.agent_key,
                    control_id=control.id,
                    control_ref=control.control_ref,
                    depends_on=[f"{ref}:walkthrough", f"{ref}:evidence"],
                ),
                PlanItem(
                    key=f"{ref}:review",
                    kind="review",
                    title=f"Independent review: {name}"[:200],
                    description="Review the walkthrough and testing workpapers and raise notes.",
                    agent_key="independent-reviewer",
                    control_id=control.id,
                    control_ref=control.control_ref,
                    depends_on=[f"{ref}:test"],
                ),
            ]
        )
        reviews.append(f"{ref}:review")
    if reviews:
        items.append(
            PlanItem(
                key="engagement:report",
                kind="report",
                title="Draft findings and the engagement report",
                description="Summarize exceptions and deficiencies from reviewed work only.",
                agent_key="reporting-analyst",
                control_id=None,
                control_ref=None,
                depends_on=reviews,
            )
        )
    return items


def _fingerprint(items: list[PlanItem], onboarding: OnboardingBody) -> str:
    """Bind launch approval to the complete launch-relevant setup.

    The task list does not carry the scope, period, team, agent staffing, or
    template contents. Those records can change in another tab while leaving an
    old task-list hash unchanged, so approval covers them explicitly.
    """
    used_templates = {control.template_key for control in onboarding.controls if control.included}
    payload = {
        "items": [item.model_dump(mode="json") for item in items],
        "project": {
            "name": onboarding.project_name,
            "status": onboarding.project_status,
            "scope": onboarding.scope,
        },
        "settings": onboarding.settings.model_dump(mode="json", exclude={"kicked_off_at"}),
        "period": (
            None if onboarding.period is None else onboarding.period.model_dump(mode="json")
        ),
        "applications": [
            {
                "id": str(application.id),
                "name": application.name,
                "layer": application.layer,
                "version": application.version,
            }
            for application in sorted(onboarding.applications, key=lambda item: str(item.id))
        ],
        "team": [
            {"user_id": str(member.user_id), "role": member.engagement_role}
            for member in sorted(
                onboarding.team, key=lambda item: (str(item.user_id), item.engagement_role)
            )
        ],
        "controls": [
            control.model_dump(mode="json")
            for control in sorted(
                (item for item in onboarding.controls if item.included),
                key=lambda item: str(item.id),
            )
        ],
        "templates": [
            template.model_dump(mode="json")
            for template in sorted(
                (item for item in onboarding.templates if item.key in used_templates),
                key=lambda item: (item.key, item.template_id, item.version),
            )
        ],
        "agents": [
            agent.model_dump(mode="json")
            for agent in sorted(onboarding.agents, key=lambda item: item.agent_key)
        ],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def propose_plan(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    snapshot = _snapshot(connection, organization_id, project_id)
    if not snapshot.ready:
        raise OnboardingState("setup is not complete")
    items = build_plan(snapshot.controls)
    fingerprint = _fingerprint(items, snapshot)
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE engagement_plans SET status = 'SUPERSEDED', version = version + 1
            WHERE project_id = %s AND status = 'PROPOSED'
            """,
            (project_id,),
        )
        cursor.execute(
            """
            INSERT INTO engagement_plans (
                organization_id, project_id, items, fingerprint, proposed_by_user_id
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                organization_id,
                project_id,
                Json([item.model_dump(mode="json") for item in items]),
                fingerprint,
                principal.id,
            ),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.plan_proposed",
            {"items": len(items), "proposed_by_agent": "engagement-planner"},
        )
    return _snapshot(connection, organization_id, project_id)


def _plan_preview(onboarding: OnboardingBody) -> PlanPreview:
    items = build_plan(onboarding.controls)
    return PlanPreview(items=items, fingerprint=_fingerprint(items, onboarding))


def _schedule_plan_runs(settings: Settings, scheduler: Any, project_id: UUID) -> None:
    """Hand the launched controls' plans to the planner agent."""
    plans = getattr(scheduler, "schedule_plan_runs", None)
    if plans is None or settings.database_url == "":
        return
    from ai_workforce_api.db import connect
    from ai_workforce_api.evidence_plans import open_plan_runs

    with connect(settings.database_url) as connection:
        ids = open_plan_runs(connection, project_id)
    if ids:
        plans(ids)


def launch_engagement(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: PlanApproval,
    agent: bool = False,
) -> OnboardingBody:
    """Launch from the plan as shown: the proposal and its approval in one step. The
    fingerprint the page showed must still match the setup, as for an approval."""
    _authorize_setup(connection, principal, organization_id, project_id)
    snapshot = _snapshot(connection, organization_id, project_id)
    if snapshot.started:
        raise OnboardingState("engagement has started")
    if not snapshot.ready or snapshot.plan_preview is None:
        raise OnboardingState("setup is not complete")
    if body.fingerprint != snapshot.plan_preview.fingerprint:
        raise OnboardingState("setup changed since the plan was shown")
    plan = snapshot.plan
    if plan is None or plan.status != "PROPOSED" or plan.fingerprint != body.fingerprint:
        plan = propose_plan(connection, principal, organization_id, project_id).plan
    assert plan is not None
    return approve_plan(connection, principal, organization_id, project_id, plan.id, body, agent)


def approve_plan(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
    body: PlanApproval,
    agent: bool = False,
) -> OnboardingBody:
    """Start the engagement from the approved plan, all at once or not at all. With the
    planner agent available, each control's evidence plan is left for it to refine."""
    _authorize_setup(connection, principal, organization_id, project_id)
    snapshot = _snapshot(connection, organization_id, project_id)
    if not snapshot.ready:
        raise OnboardingState("setup is not complete")
    plan = snapshot.plan
    if plan is None or plan.id != plan_id or plan.status != "PROPOSED":
        raise OnboardingState("plan is not the current proposal")
    items = build_plan(snapshot.controls)
    if body.fingerprint != plan.fingerprint or _fingerprint(items, snapshot) != plan.fingerprint:
        raise OnboardingState("setup changed since the plan was proposed")
    instances = _instances(connection, organization_id, project_id)
    controls = {c.id: c for c in snapshot.controls}
    settings = snapshot.settings
    due_at = datetime.combine(
        datetime.now(UTC).date() + timedelta(days=settings.pbc_due_days),
        datetime.min.time().replace(hour=23, minute=59),
        tzinfo=UTC,
    )
    with transaction(connection) as cursor:
        claimed = cursor.execute(
            """
            UPDATE engagement_settings
            SET kicked_off_at = clock_timestamp(), kicked_off_by = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s AND kicked_off_at IS NULL
            RETURNING project_id
            """,
            (principal.id, project_id),
        ).fetchone()
        if claimed is None:
            raise OnboardingState("engagement has started")
        # Launched with controls in scope, the scope is final now: their work is created
        # below. Launched without, the work waits for Review and finalize (SP6).
        cursor.execute(
            """
            UPDATE engagement_settings
            SET scope_finalized_at = kicked_off_at, scope_finalized_by = kicked_off_by
            WHERE project_id = %s AND EXISTS (
                SELECT 1 FROM engagement_controls WHERE project_id = %s AND included
            )
            """,
            (project_id, project_id),
        )
        cursor.execute(
            """
            UPDATE projects SET status = 'ACTIVE', version = version + 1,
                   updated_at = clock_timestamp()
            WHERE id = %s AND organization_id = %s AND status = 'DRAFT'
            """,
            (project_id, organization_id),
        )
        task_ids: dict[str, UUID] = {}
        for item in items:
            row = cursor.execute(
                """
                INSERT INTO tasks (
                    organization_id, project_id, title, description, status, priority,
                    agent_instance_id, deadline, phase_key, plan_kind, engagement_control_id
                )
                VALUES (%s, %s, %s, %s, 'READY', 'NORMAL', %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    organization_id,
                    project_id,
                    item.title,
                    item.description,
                    instances.get(item.agent_key),
                    due_at if item.kind == "evidence" else None,
                    KIND_PHASES[item.kind],
                    item.kind,
                    item.control_id,
                ),
            ).fetchone()
            if row is None:
                raise NotVisible()
            task_ids[item.key] = row[0]
            for predecessor in item.depends_on:
                cursor.execute(
                    """
                    INSERT INTO task_dependencies (
                        organization_id, project_id, task_id, depends_on_task_id
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (organization_id, project_id, row[0], task_ids[predecessor]),
                )
            _audit_target(
                cursor,
                organization_id,
                project_id,
                principal.id,
                "task.created",
                "task",
                row[0],
                {"status": "READY", "source": "kickoff"},
            )
        requests = 0
        drafted: list[tuple[UUID, UUID]] = []
        for item in items:
            if item.kind != "evidence" or item.control_id is None:
                continue
            control = controls[item.control_id]
            # Library version 3: attributes follow their testing definitions, and those
            # that need the client's answer are proposed, not tested.
            link_definitions(cursor, control.id, principal.id)
            # Each control's evidence is planned by phase: design, interim, and the
            # roll-forward. The phases that apply now get their own requests.
            # The rules plan each control now; the planner agent refines it after the
            # launch commits. Nothing is requested until a person approves the plan.
            for request_id in plan_and_issue(
                cursor, organization_id, project_id, control.id, principal.id, "kickoff", agent
            ):
                requests += 1
                drafted.append((request_id, control.id))
        # The evidence coordinator drafts each request once the kickoff commits.
        queue_kickoff_drafts(cursor, organization_id, project_id, principal.id, drafted)
        # The standard SOX calendar: phases, milestones, and each task's deadline.
        # The kickoff above is already recorded, so its milestones start done.
        if settings.period_end is not None:
            create_engagement_schedule(
                cursor,
                organization_id,
                project_id,
                datetime.now(UTC).date(),
                settings.period_end,
                settings.pbc_due_days,
            )
        cursor.execute(
            """
            UPDATE engagement_plans
            SET status = 'APPROVED', decided_by_user_id = %s, decided_at = clock_timestamp(),
                created_tasks = %s, created_requests = %s, version = version + 1
            WHERE id = %s AND project_id = %s AND status = 'PROPOSED'
            """,
            (principal.id, len(task_ids), requests, plan_id, project_id),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.kickoff",
            {"tasks": len(task_ids), "pbc_requests": requests},
        )
    return _snapshot(connection, organization_id, project_id)


def _launch_summary(connection: psycopg.Connection[Any], project_id: UUID) -> LaunchSummary | None:
    launched = connection.execute(
        """
        SELECT s.kicked_off_at, coalesce(u.display_name, '')
        FROM engagement_settings s LEFT JOIN users u ON u.id = s.kicked_off_by
        WHERE s.project_id = %s AND s.kicked_off_at IS NOT NULL
        """,
        (project_id,),
    ).fetchone()
    if launched is None:
        return None
    plans = connection.execute(
        """
        SELECT count(*),
               count(*) FILTER (WHERE p.status = 'APPROVED'),
               count(*) FILTER (WHERE p.status IN ('PROPOSED', 'CHANGES_PROPOSED',
                                                   'CHANGES_REQUESTED')),
               count(*) FILTER (WHERE p.run_status IN ('PENDING', 'WORKING')),
               count(*) FILTER (WHERE p.id IS NULL)
        FROM engagement_controls c
        LEFT JOIN evidence_plans p ON p.engagement_control_id = c.id
        WHERE c.project_id = %s AND c.included
        """,
        (project_id,),
    ).fetchone()
    requests = connection.execute(
        """
        SELECT count(*) FILTER (WHERE r.status IN ('DRAFT', 'APPROVAL_PENDING') AND held),
               count(*) FILTER (WHERE r.status = 'DRAFT' AND NOT held),
               count(*) FILTER (WHERE r.status = 'APPROVAL_PENDING' AND NOT held),
               count(*) FILTER (WHERE r.status IN ('SENT', 'WAITING_FOR_RESPONSE', 'OVERDUE',
                                                   'ESCALATED', 'PARTIALLY_RECEIVED')),
               count(*) FILTER (WHERE r.status IN ('RECEIVED', 'CLOSED'))
        FROM pbc_requests r
        LEFT JOIN evidence_plans p ON p.engagement_control_id = r.engagement_control_id
        CROSS JOIN LATERAL (
            SELECT r.engagement_control_id IS NOT NULL
                   AND coalesce(p.status, '') <> 'APPROVED' AS held
        ) h
        WHERE r.project_id = %s
        """,
        (project_id,),
    ).fetchone()
    tasks = connection.execute(
        """
        SELECT count(*) FILTER (WHERE status <> 'CANCELLED'),
               count(*) FILTER (WHERE status = 'SUCCEEDED'),
               count(*) FILTER (WHERE status NOT IN ('SUCCEEDED', 'CANCELLED', 'BLOCKED',
                                                     'FAILED')),
               count(*) FILTER (WHERE status IN ('BLOCKED', 'FAILED'))
        FROM tasks WHERE project_id = %s
        """,
        (project_id,),
    ).fetchone()
    p = [int(v) for v in plans] if plans is not None else [0] * 5
    r = [int(v) for v in requests] if requests is not None else [0] * 5
    t = [int(v) for v in tasks] if tasks is not None else [0] * 4
    return LaunchSummary(
        launched_at=launched[0], launched_by=str(launched[1]), controls=p[0],
        plans_approved=p[1], plans_proposed=p[2], plans_working=p[3], plans_missing=p[4],
        requests_held=r[0], requests_draft=r[1], requests_awaiting_approval=r[2],
        requests_with_client=r[3], requests_received=r[4], tasks_total=t[0], tasks_done=t[1],
        tasks_active=t[2], tasks_attention=t[3],
    )  # fmt: skip


def _drafting(connection: psycopg.Connection[Any], project_id: UUID) -> DraftingSummary:
    row = connection.execute(
        """
        SELECT count(*),
               count(*) FILTER (WHERE status IN ('PENDING', 'DRAFTING')),
               count(*) FILTER (WHERE status = 'DRAFTED'),
               count(*) FILTER (WHERE status = 'DRAFTED' AND source = 'MODEL'),
               count(*) FILTER (WHERE status = 'FAILED')
        FROM pbc_drafts WHERE project_id = %s
        """,
        (project_id,),
    ).fetchone()
    values = [int(item) for item in row] if row is not None else [0, 0, 0, 0, 0]
    return DraftingSummary(
        total=values[0],
        pending=values[1],
        drafted=values[2],
        by_model=values[3],
        failed=values[4],
    )


def started_drafts(settings: Settings, project_id: UUID) -> list[UUID]:
    """The engagement's drafts still waiting for the evidence coordinator."""
    try:
        with connect(settings.database_url) as connection:
            rows = connection.execute(
                "SELECT id FROM pbc_drafts WHERE project_id = %s AND status = 'PENDING' "
                "ORDER BY created_at",
                (project_id,),
            ).fetchall()
    except psycopg.Error:
        return []
    return [row[0] for row in rows]


def _instances(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> dict[str, UUID]:
    rows = connection.execute(
        """
        SELECT d.agent_key, i.id
        FROM agent_instances i
        JOIN agent_definitions d ON d.id = i.agent_definition_id
        WHERE i.organization_id = %s AND i.project_id = %s AND d.status = 'ACTIVE'
        """,
        (organization_id, project_id),
    ).fetchall()
    return {str(row[0]): row[1] for row in rows}


def _latest_plan(connection: psycopg.Connection[Any], project_id: UUID) -> PlanBody | None:
    row = connection.execute(
        """
        SELECT id, status, items, fingerprint, created_at, decided_at, created_tasks,
               created_requests
        FROM engagement_plans
        WHERE project_id = %s AND status IN ('PROPOSED', 'APPROVED')
        ORDER BY (status = 'APPROVED') DESC, created_at DESC
        LIMIT 1
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        return None
    return PlanBody(
        id=row[0],
        status=str(row[1]),
        items=[PlanItem.model_validate(item) for item in row[2]],
        fingerprint=str(row[3]),
        created_at=row[4],
        decided_at=row[5],
        created_tasks=int(row[6]),
        created_requests=int(row[7]),
    )


# Helpers


def recipient_for(control: ControlBody, settings: SettingsBody) -> str:
    """The control owner, or the PBC coordinator when no owner is named."""
    if _EMAIL.fullmatch(control.owner_email):
        return control.owner_email
    return settings.client_coordinator_email


def pbc_reference(control_ref: str) -> str:
    """A client's control ID as a PBC reference, which allows fewer characters."""
    text = re.sub(r"[^A-Za-z0-9._:/-]+", "-", control_ref).strip("-._:/")[:200]
    return text if text else "CONTROL"


def _reset_templates(cursor: psycopg.Cursor[Any], project_id: UUID) -> None:
    """Before launch, a change to the templates in use needs the team to look again.

    Confirming them is a step before launch (Milestone 8.16): after launch a change
    reaches the workpapers that have not started (workpaper_templates.follow_template),
    and nothing is confirmed again."""
    row = cursor.execute(
        "SELECT kicked_off_at IS NOT NULL FROM engagement_settings WHERE project_id = %s",
        (project_id,),
    ).fetchone()
    if row is not None and row[0] is True:
        return
    _touch(cursor, project_id, "templates_confirmed_at = NULL, templates_confirmed_by = NULL", ())


def _touch(
    cursor: psycopg.Cursor[Any], project_id: UUID, assignments: str, values: tuple[Any, ...]
) -> None:
    cursor.execute(
        f"""
        UPDATE engagement_settings
        SET {assignments}, version = version + 1, updated_at = clock_timestamp()
        WHERE project_id = %s
        """,
        (*values, project_id),
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    _audit_target(
        cursor, organization_id, project_id, actor_id, action, "project", project_id, payload
    )


def _audit_target(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    target_type: str,
    target_id: UUID,
    payload: dict[str, Any],
) -> None:
    """Audit payloads hold decisions and counts, never owner contacts or evidence text."""
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, actor_id, action, target_type, target_id, Json(payload)),
    )
