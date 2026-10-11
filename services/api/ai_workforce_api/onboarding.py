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
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.controls import (
    DOMAIN_AGENTS,
    DOMAINS,
    FREQUENCIES,
    ITGC_DOMAINS,
    LIBRARY,
    LIBRARY_VERSION,
    NATURES,
    TESTER_KEYS,
    default_templates,
    sample_size,
)
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.pbc_drafting import DraftScheduler, queue_kickoff_drafts, schedule
from ai_workforce_api.schedule import KIND_PHASES
from ai_workforce_api.settings import Settings
from ai_workforce_api.workpapers import (
    DESIGN_KEYS,
    EFFECTIVENESS_KEYS,
    PreviewControl,
    TemplateSummary,
    WorkpaperPreview,
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
    period_end: date | None
    client_coordinator_name: str
    client_coordinator_email: str
    client_domains: list[str]
    pbc_due_days: int
    pbc_follow_up_days: int
    pbc_max_follow_ups: int
    templates_confirmed_at: datetime | None
    kicked_off_at: datetime | None
    version: int


class ApplicationBody(BaseModel):
    id: UUID
    name: str
    description: str
    layer: str = "APPLICATION"


class TeamMemberBody(BaseModel):
    user_id: UUID
    display_name: str
    email: str
    engagement_role: str
    organization_role: str


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
    design_template_key: str
    effectiveness_template_key: str
    agent_key: str
    sample_size: int
    version: int
    source: str
    domain_label: str
    frequency_label: str
    nature_label: str
    custom_fields: list[CustomField]


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


class OnboardingBody(BaseModel):
    project_id: UUID
    project_name: str
    project_status: str
    scope: str
    settings: SettingsBody
    applications: list[ApplicationBody]
    team: list[TeamMemberBody]
    candidates: list[CandidateBody]
    library: list[LibraryArea]
    controls: list[ControlBody]
    templates: list[TemplateSummary]
    agents: list[StaffedAgent]
    pbc_preview: list[PbcPreviewItem]
    readiness: list[ReadinessItem]
    ready: bool
    plan: PlanBody | None
    started: bool
    drafting: DraftingSummary
    rcm_source: Literal["NONE", "LIBRARY", "UPLOAD"]
    rcm_file_name: str
    open_import_id: UUID | None


class ScopeUpdate(BaseModel):
    scope: str = Field(max_length=4000)
    period_end: date | None


class ApplicationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class TeamAdd(BaseModel):
    user_id: UUID
    engagement_role: Literal["LEAD", "PREPARER", "REVIEWER"]


class ControlUpdate(BaseModel):
    version: int = Field(ge=1)
    included: bool
    key_control: bool
    owner_name: str = Field(max_length=200)
    owner_email: str = Field(max_length=200)
    frequency: str
    nature: str
    application_ids: list[UUID] = Field(max_length=50)
    design_template_key: str
    effectiveness_template_key: str
    # The area and tester can be changed per control. A new area brings its tester.
    domain: str | None = None
    agent_key: str | None = None

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


class PbcUpdate(BaseModel):
    client_coordinator_name: str = Field(max_length=200)
    client_coordinator_email: str = Field(max_length=200)
    client_domains: list[str] = Field(max_length=10)
    pbc_due_days: int = Field(ge=1, le=90)
    pbc_follow_up_days: int = Field(ge=1, le=30)
    pbc_max_follow_ups: int = Field(ge=0, le=10)


class PlanApproval(BaseModel):
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


def register_onboarding(
    app: FastAPI, settings: Settings, drafts: DraftScheduler | None = None
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/onboarding"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        return _run(settings, lambda connection: work(connection, principal))

    @app.get(base)
    def read(organization_id: UUID, project_id: UUID, request: Request) -> OnboardingBody:
        return run(request, lambda c, p: load_onboarding(c, p, organization_id, project_id))

    @app.patch(f"{base}/scope")
    def scope(
        organization_id: UUID, project_id: UUID, body: ScopeUpdate, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _update_scope(c, p, organization_id, project_id, body))

    @app.post(f"{base}/applications")
    def add_application(
        organization_id: UUID, project_id: UUID, body: ApplicationCreate, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _add_application(c, p, organization_id, project_id, body))

    @app.post(f"{base}/applications/{{application_id}}/remove")
    def remove_application(
        organization_id: UUID, project_id: UUID, application_id: UUID, request: Request
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: _remove_application(c, p, organization_id, project_id, application_id),
        )

    @app.post(f"{base}/team")
    def add_member(
        organization_id: UUID, project_id: UUID, body: TeamAdd, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _add_member(c, p, organization_id, project_id, body))

    @app.post(f"{base}/team/{{user_id}}/remove")
    def remove_member(
        organization_id: UUID, project_id: UUID, user_id: UUID, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _remove_member(c, p, organization_id, project_id, user_id))

    @app.post(f"{base}/controls/load-library")
    def load_library(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        body: LibraryLoad | None = None,
    ) -> OnboardingBody:
        chosen = body or LibraryLoad()
        return run(request, lambda c, p: _load_library(c, p, organization_id, project_id, chosen))

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
        return run(request, lambda c, p: _bulk_owner(c, p, organization_id, project_id, body))

    @app.post(f"{base}/templates/confirm")
    def confirm_templates(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _confirm_templates(c, p, organization_id, project_id))

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
        started = run(
            request,
            lambda c, p: approve_plan(c, p, organization_id, project_id, plan_id, body),
        )
        # The kickoff has committed. The evidence coordinator drafts in the background.
        schedule(drafts, started_drafts(settings, project_id))
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
    agents = _agents(connection, organization_id, project_id, controls)
    readiness = _readiness(str(project[2]), settings, applications, team, controls, agents)
    ready = all(item.complete for item in readiness)
    source, file_name, open_import = _rcm_state(connection, project_id, controls)
    return OnboardingBody(
        project_id=project_id,
        project_name=str(project[0]),
        project_status=str(project[1]),
        scope=str(project[2]),
        settings=settings,
        applications=applications,
        team=team,
        candidates=_candidates(connection, organization_id, project_id),
        library=_library_areas(controls),
        controls=controls,
        templates=summaries(),
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
        started=settings.kicked_off_at is not None,
        drafting=_drafting(connection, project_id),
        rcm_source=source,
        rcm_file_name=file_name,
        open_import_id=open_import,
    )


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
               kicked_off_at, version
        FROM engagement_settings WHERE project_id = %s
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return SettingsBody(
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
    )


def _applications(connection: psycopg.Connection[Any], project_id: UUID) -> list[ApplicationBody]:
    rows = connection.execute(
        """
        SELECT id, name, description, layer FROM engagement_applications
        WHERE project_id = %s ORDER BY name
        """,
        (project_id,),
    ).fetchall()
    return [
        ApplicationBody(id=row[0], name=str(row[1]), description=str(row[2]), layer=str(row[3]))
        for row in rows
    ]


def _team(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> list[TeamMemberBody]:
    rows = connection.execute(
        """
        SELECT u.id, u.display_name, u.email::text, pm.engagement_role, m.role::text
        FROM project_memberships pm
        JOIN users u ON u.id = pm.user_id
        JOIN memberships m ON m.user_id = pm.user_id AND m.organization_id = pm.organization_id
        WHERE pm.organization_id = %s AND pm.project_id = %s AND m.status = 'ACTIVE'
        ORDER BY CASE pm.engagement_role WHEN 'LEAD' THEN 0 WHEN 'REVIEWER' THEN 2 ELSE 1 END,
                 u.display_name
        """,
        (organization_id, project_id),
    ).fetchall()
    return [
        TeamMemberBody(
            user_id=row[0],
            display_name=str(row[1]),
            email=str(row[2]),
            engagement_role=str(row[3]),
            organization_role=str(row[4]),
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
    pbc_items, design_template_key, effectiveness_template_key, agent_key, version,
    source, domain_label, frequency_label, nature_label, custom_fields
"""


def _controls(connection: psycopg.Connection[Any], project_id: UUID) -> list[ControlBody]:
    rows = connection.execute(
        f"SELECT {_CONTROL_COLUMNS} FROM engagement_controls WHERE project_id = %s "
        "ORDER BY control_ref",
        (project_id,),
    ).fetchall()
    return [_control(row) for row in rows]


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
        design_template_key=str(row[16]),
        effectiveness_template_key=str(row[17]),
        agent_key=str(row[18]),
        sample_size=sample_size(str(row[7]), str(row[8])),
        version=int(row[19]),
        source=str(row[20]),
        domain_label=str(row[21]),
        frequency_label=str(row[22]),
        nature_label=str(row[23]),
        custom_fields=[
            CustomField(label=str(item.get("label", "")), value=str(item.get("value", "")))
            for item in row[24]
            if isinstance(item, dict)
        ],
    )


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
) -> list[ReadinessItem]:
    included = [control for control in controls if control.included]
    scope_issues: list[str] = []
    if scope.strip() == "":
        scope_issues.append("Describe what the engagement covers.")
    if settings.period_end is None:
        scope_issues.append("Set the period end date.")
    team_issues: list[str] = []
    roles = {member.engagement_role for member in team}
    if "LEAD" not in roles:
        team_issues.append("Name an engagement lead.")
    if "REVIEWER" not in roles:
        team_issues.append("Name an independent reviewer.")
    rcm_issues: list[str] = []
    if not included:
        rcm_issues.append(
            "Load the standard library or upload the client's RCM, and keep at least one "
            "control in scope."
        )
    # A control owner is optional: without one, the request goes to the PBC coordinator.
    rcm_advisories: list[str] = []
    missing_owner = [c.control_ref for c in included if _EMAIL.fullmatch(c.owner_email) is None]
    if missing_owner:
        rcm_advisories.append(
            f"{len(missing_owner)} control{'s have' if len(missing_owner) > 1 else ' has'} no "
            "owner yet. Their evidence requests go to the client's PBC coordinator, who can "
            "forward them."
        )
    # Systems come from the RCM: identified on upload, or added here for the library.
    if included and not applications:
        rcm_issues.append("Add the in-scope systems the controls run on.")
    missing_app = [c.control_ref for c in included if not c.application_ids]
    if missing_app and applications:
        rcm_issues.append(f"Choose the systems {_list(missing_app)} covers.")
    template_issues: list[str] = []
    if settings.templates_confirmed_at is None:
        template_issues.append("Review the workpaper previews and confirm the templates.")
    pbc_issues: list[str] = []
    if _EMAIL.fullmatch(settings.client_coordinator_email) is None:
        pbc_issues.append("Add the client's PBC coordinator.")
    if not settings.client_domains:
        pbc_issues.append("Add the client's email domains.")
    else:
        outside = [
            c.control_ref
            for c in included
            if _EMAIL.fullmatch(c.owner_email)
            and c.owner_email.rsplit("@", 1)[1].lower() not in settings.client_domains
        ]
        if outside:
            pbc_issues.append(f"Owners of {_list(outside)} are outside the client's domains.")
    agent_issues = [
        f"{agent.name} is {'disabled' if not agent.active else 'not on the team'}."
        for agent in agents
        if not (agent.active and agent.staffed)
    ]
    return [
        ReadinessItem(
            step="scope", title="Scope and period", complete=not scope_issues, issues=scope_issues
        ),
        ReadinessItem(
            step="team", title="Team and access", complete=not team_issues, issues=team_issues
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
        ReadinessItem(step="pbc", title="PBC plan", complete=not pbc_issues, issues=pbc_issues),
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
    if row[0] is True and not after_start:
        raise OnboardingState("engagement has started")


def _update_scope(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ScopeUpdate,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    scope = body.scope.strip()
    if contains_secret({"scope": scope}):
        raise ValueError("scope holds a secret")
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE projects SET scope = %s, version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND organization_id = %s AND scope IS DISTINCT FROM %s
            """,
            (scope, project_id, organization_id, scope),
        )
        _touch(cursor, project_id, "period_end = %s", (body.period_end,))
        _audit(cursor, organization_id, project_id, principal.id, "onboarding.scope", {})
    return _snapshot(connection, organization_id, project_id)


def _add_application(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ApplicationCreate,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    name = " ".join(body.name.split())
    description = body.description.strip()
    if name == "" or contains_secret({"name": name, "description": description}):
        raise ValueError("application is invalid")
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO engagement_applications (organization_id, project_id, name, description)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (project_id, name) DO NOTHING
            RETURNING id
            """,
            (organization_id, project_id, name, description),
        ).fetchone()
        if row is not None:
            # A new application joins every in-scope control by default.
            cursor.execute(
                """
                UPDATE engagement_controls
                SET application_ids = array_append(application_ids, %s),
                    version = version + 1, updated_at = clock_timestamp()
                WHERE project_id = %s AND NOT (%s = ANY(application_ids))
                """,
                (row[0], project_id, row[0]),
            )
            _audit(cursor, organization_id, project_id, principal.id, "onboarding.application", {})
    return _snapshot(connection, organization_id, project_id)


def _remove_application(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE engagement_controls
            SET application_ids = array_remove(application_ids, %s),
                version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s AND %s = ANY(application_ids)
            """,
            (application_id, project_id, application_id),
        )
        removed = cursor.execute(
            "DELETE FROM engagement_applications WHERE id = %s AND project_id = %s RETURNING id",
            (application_id, project_id),
        ).fetchone()
        if removed is None:
            raise NotVisible()
        _audit(cursor, organization_id, project_id, principal.id, "onboarding.application", {})
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
    with transaction(connection) as cursor:
        if body.engagement_role == "LEAD":
            # One lead. A new lead moves the previous one to preparer.
            cursor.execute(
                """
                UPDATE project_memberships
                SET engagement_role = 'PREPARER', version = version + 1
                WHERE project_id = %s AND engagement_role = 'LEAD' AND user_id <> %s
                """,
                (project_id, body.user_id),
            )
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id, engagement_role)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (project_id, user_id) DO UPDATE
            SET engagement_role = EXCLUDED.engagement_role,
                version = project_memberships.version + 1
            """,
            (organization_id, project_id, body.user_id, body.engagement_role),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.team",
            {"user_id": str(body.user_id), "engagement_role": body.engagement_role},
        )
    return _snapshot(connection, organization_id, project_id)


def _remove_member(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    owner = connection.execute(
        "SELECT owner_user_id FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    if owner is not None and owner[0] == user_id:
        raise OnboardingState("the engagement owner stays on the team")
    with transaction(connection) as cursor:
        removed = cursor.execute(
            "DELETE FROM project_memberships WHERE project_id = %s AND user_id = %s RETURNING id",
            (project_id, user_id),
        ).fetchone()
        if removed is None:
            raise NotVisible()
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.team",
            {"user_id": str(user_id), "removed": True},
        )
    return _snapshot(connection, organization_id, project_id)


def _load_library(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: LibraryLoad,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    if not set(body.domains) <= set(DOMAINS):
        raise ValueError("area is unknown")
    applications = [app.id for app in _applications(connection, project_id)]
    added = 0
    with transaction(connection) as cursor:
        # The library and an uploaded RCM are alternatives. Loading one replaces the other.
        replaced = cursor.execute(
            "DELETE FROM engagement_controls WHERE project_id = %s AND source = 'UPLOAD'",
            (project_id,),
        ).rowcount
        for control in (c for c in LIBRARY if c.domain in body.domains):
            design, effectiveness = default_templates(control.nature)
            row = cursor.execute(
                """
                INSERT INTO engagement_controls (
                    organization_id, project_id, library_key, library_version, control_ref,
                    domain, title, risk, activity, frequency, nature, application_ids,
                    test_attributes, pbc_items, design_template_key, effectiveness_template_key,
                    agent_key
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (project_id, library_key) DO NOTHING
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
                    applications,
                    Json(list(control.test_attributes)),
                    Json(list(control.pbc_items)),
                    design,
                    effectiveness,
                    DOMAIN_AGENTS[control.domain],
                ),
            ).fetchone()
            added += 0 if row is None else 1
        if added or replaced:
            _reset_templates(cursor, project_id)
            _audit(
                cursor,
                organization_id,
                project_id,
                principal.id,
                "onboarding.rcm",
                {"library_version": LIBRARY_VERSION, "added": added, "replaced": replaced},
            )
    return _snapshot(connection, organization_id, project_id)


def _update_control(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: ControlUpdate,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    if body.frequency not in FREQUENCIES or body.nature not in NATURES:
        raise ValueError("control fields are invalid")
    if (body.domain is not None and body.domain not in DOMAINS) or (
        body.agent_key is not None and body.agent_key not in TESTER_KEYS
    ):
        raise ValueError("area or tester is unknown")
    if (
        body.design_template_key not in DESIGN_KEYS
        or body.effectiveness_template_key not in EFFECTIVENESS_KEYS
    ):
        raise ValueError("template is unknown")
    if body.owner_email != "" and _EMAIL.fullmatch(body.owner_email) is None:
        raise ValueError("owner email is invalid")
    if contains_secret({"name": body.owner_name, "email": body.owner_email}):
        raise ValueError("control fields hold a secret")
    known = {app.id for app in _applications(connection, project_id)}
    if not set(body.application_ids) <= known:
        raise ValueError("application is unknown")
    with transaction(connection) as cursor:
        current = cursor.execute(
            """
            SELECT design_template_key, effectiveness_template_key, version, domain, agent_key
            FROM engagement_controls WHERE id = %s AND project_id = %s FOR UPDATE
            """,
            (control_id, project_id),
        ).fetchone()
        if current is None:
            raise NotVisible()
        if int(current[2]) != body.version:
            raise OnboardingState("control changed")
        domain = body.domain or str(current[3])
        agent = body.agent_key or (
            DOMAIN_AGENTS[domain] if domain != current[3] else str(current[4])
        )
        cursor.execute(
            """
            UPDATE engagement_controls
            SET included = %s, key_control = %s, owner_name = %s, owner_email = %s,
                frequency = %s, nature = %s, application_ids = %s,
                design_template_key = %s, effectiveness_template_key = %s,
                domain = %s, agent_key = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND project_id = %s
            """,
            (
                body.included,
                body.key_control,
                body.owner_name,
                body.owner_email.lower(),
                body.frequency,
                body.nature,
                list(dict.fromkeys(body.application_ids)),
                body.design_template_key,
                body.effectiveness_template_key,
                domain,
                agent,
                control_id,
                project_id,
            ),
        )
        if (current[0], current[1]) != (body.design_template_key, body.effectiveness_template_key):
            _reset_templates(cursor, project_id)
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.control",
            {"control_id": str(control_id), "included": body.included},
        )
    return _snapshot(connection, organization_id, project_id)


def _bulk_owner(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: OwnerBulk,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
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


def _update_pbc(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: PbcUpdate,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id)
    email = body.client_coordinator_email.strip().lower()
    name = body.client_coordinator_name.strip()
    if email != "" and _EMAIL.fullmatch(email) is None:
        raise ValueError("coordinator email is invalid")
    domains = list(
        dict.fromkeys(item.strip().lower() for item in body.client_domains if item.strip())
    )
    if any(_DOMAIN.fullmatch(item) is None for item in domains):
        raise ValueError("domain is invalid")
    if contains_secret({"name": name, "email": email}):
        raise ValueError("pbc fields hold a secret")
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
        _audit(cursor, organization_id, project_id, principal.id, "onboarding.pbc", {})
    return _snapshot(connection, organization_id, project_id)


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
        template_key,
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
    for control in sorted((c for c in controls if c.included), key=lambda c: c.control_ref):
        ref = control.control_ref
        name = f"{ref} {control.title}"
        attributes = "; ".join(control.test_attributes)
        items.extend(
            [
                PlanItem(
                    key=f"{ref}:walkthrough",
                    kind="walkthrough",
                    title=f"Walkthrough and design: {name}"[:200],
                    description=(
                        f"Walk through one instance and assess design using template "
                        f"{control.design_template_key}. Attributes: {attributes}"
                    )[:4000],
                    agent_key=control.agent_key,
                    control_id=control.id,
                    control_ref=ref,
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
                    control_ref=ref,
                    depends_on=[],
                ),
                PlanItem(
                    key=f"{ref}:test",
                    kind="test",
                    title=f"Test operating effectiveness: {name}"[:200],
                    description=(
                        f"Select {control.sample_size} sample(s) and test each attribute using "
                        f"template {control.effectiveness_template_key}. Attributes: {attributes}"
                    )[:4000],
                    agent_key=control.agent_key,
                    control_id=control.id,
                    control_ref=ref,
                    depends_on=[f"{ref}:walkthrough", f"{ref}:evidence"],
                ),
                PlanItem(
                    key=f"{ref}:review",
                    kind="review",
                    title=f"Independent review: {name}"[:200],
                    description="Review the walkthrough and testing workpapers and raise notes.",
                    agent_key="independent-reviewer",
                    control_id=control.id,
                    control_ref=ref,
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


def _fingerprint(items: list[PlanItem], settings: SettingsBody) -> str:
    payload = {
        "items": [item.model_dump(mode="json") for item in items],
        "pbc": [settings.pbc_due_days, settings.pbc_follow_up_days, settings.pbc_max_follow_ups],
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
    fingerprint = _fingerprint(items, snapshot.settings)
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


def approve_plan(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
    body: PlanApproval,
) -> OnboardingBody:
    """Start the engagement from the approved plan, all at once or not at all."""
    _authorize_setup(connection, principal, organization_id, project_id)
    snapshot = _snapshot(connection, organization_id, project_id)
    if not snapshot.ready:
        raise OnboardingState("setup is not complete")
    plan = snapshot.plan
    if plan is None or plan.id != plan_id or plan.status != "PROPOSED":
        raise OnboardingState("plan is not the current proposal")
    items = build_plan(snapshot.controls)
    if (
        body.fingerprint != plan.fingerprint
        or _fingerprint(items, snapshot.settings) != plan.fingerprint
    ):
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
            created = cursor.execute(
                """
                INSERT INTO pbc_requests (
                    organization_id, project_id, operation_key, control_ref, owner_user_id,
                    recipient, due_at, evidence_description, follow_up_after_days,
                    max_follow_ups, engagement_control_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (project_id, operation_key) DO NOTHING
                RETURNING id
                """,
                (
                    organization_id,
                    project_id,
                    f"kickoff-{plan_id.hex[:12]}-{control.id.hex}",
                    pbc_reference(control.control_ref),
                    principal.id,
                    recipient_for(control, settings),
                    due_at,
                    "\n".join(f"- {line}" for line in control.pbc_items)[:4000],
                    settings.pbc_follow_up_days,
                    settings.pbc_max_follow_ups,
                    control.id,
                ),
            ).fetchone()
            if created is not None:
                requests += 1
                drafted.append((created[0], control.id))
                _audit_target(
                    cursor,
                    organization_id,
                    project_id,
                    principal.id,
                    "pbc.updated",
                    "pbc_request",
                    created[0],
                    {"status": "DRAFT", "source": "kickoff"},
                )
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
    """A change to the templates in use needs the team to look again."""
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
