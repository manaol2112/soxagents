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
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.controls import DOMAIN_LABELS, ITGC_DOMAINS, sample_size
from ai_workforce_api.db import transaction
from ai_workforce_api.schedule import KIND_PHASES, PHASE_KEYS, standard_schedule
from ai_workforce_api.settings import Settings

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


class ControlRequest(BaseModel):
    id: UUID
    kind: Literal["EVIDENCE", "SAMPLES", "FOLLOW_UP"]
    title: str
    status: str
    due_at: datetime


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
    # What happens next, and who it waits on: the audit team, the control owner, or an
    # agent. Derived here so every page says the same thing.
    next_step: str = ""
    waiting_on: Literal["TEAM", "OWNER", "AGENT", "NONE"] = "NONE"
    overdue: bool = False
    requests: list[ControlRequest] = []


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
                WHERE t.project_id = c.project_id AND t.engagement_control_id = c.id)
        FROM engagement_controls c
        WHERE c.project_id = %s
        ORDER BY c.control_ref
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
    requests: dict[UUID, list[ControlRequest]] = {}
    for control_id, status, request_id, key, description, due_at in connection.execute(
        """
        SELECT engagement_control_id, status, id, operation_key, evidence_description, due_at
        FROM pbc_requests
        WHERE project_id = %s AND engagement_control_id IS NOT NULL
        ORDER BY created_at
        """,
        (project_id,),
    ).fetchall():
        evidence.setdefault(control_id, Counter())[str(status)] += 1
        requests.setdefault(control_id, []).append(
            ControlRequest(
                id=request_id,
                kind=_request_kind(str(key)),
                title=_request_title(str(description)),
                status=str(status),
                due_at=due_at,
            )
        )
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
            if pbc.get("OVERDUE") or pbc.get("ESCALATED")
            else "REQUESTED"
            if any(s in pbc for s in ("SENT", "WAITING_FOR_RESPONSE"))
            else "DRAFTED"
            if pbc
            else "NONE"
        )
        stage_body = StageBody(
            walkthrough=mine.get("walkthrough", "NONE"),
            evidence=evidence_state,
            test=mine.get("test", "NONE"),
            review=mine.get("review", "NONE"),
        )
        worst = max(found, key=order.index) if found else None
        # A control is concluded once its testing is reviewed. A deficiency found
        # earlier, at the walkthrough, is a finding, not a conclusion.
        conclusion: Literal["NOT_CONCLUDED", "EFFECTIVE", "EXCEPTION"]
        if stage_body.review != "SUCCEEDED":
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
                sample_size=sample_size(str(row[6]), str(row[8])),
                stage=_stage(stage_body, conclusion),
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
            )
        )
        step, waiting, late = next_step(result[-1], stage_body)
        result[-1].next_step, result[-1].waiting_on, result[-1].overdue = step, waiting, late
    return result


_LATE = {"OVERDUE", "ESCALATED"}
_OUT = {"SENT", "WAITING_FOR_RESPONSE", "PARTIALLY_RECEIVED"}


def next_step(
    control: ControlRow, stages: StageBody
) -> tuple[str, Literal["TEAM", "OWNER", "AGENT", "NONE"], bool]:
    """The one thing that moves this control forward, and who it waits on."""
    if not control.included:
        return "Out of scope", "NONE", False
    if control.conclusion == "EFFECTIVE":
        return "Concluded with no exceptions", "NONE", False
    if control.conclusion == "EXCEPTION":
        return "Concluded with exceptions", "NONE", False
    if control.test_status == "PROPOSED":
        return "Approve the samples", "TEAM", False
    by_kind: dict[str, list[ControlRequest]] = {}
    for request in control.requests:
        if request.status not in ("CANCELLED", "CLOSED"):
            by_kind.setdefault(request.kind, []).append(request)
    for kind, noun in (("FOLLOW_UP", "follow-up"), ("SAMPLES", "sample request"),
                       ("EVIDENCE", "evidence request")):  # fmt: skip
        mine = by_kind.get(kind, [])
        statuses = {request.status for request in mine}
        if statuses & _LATE:
            return f"Chase the overdue {noun}", "OWNER", True
        if "DRAFT" in statuses:
            return f"Submit the {noun}", "TEAM", False
        if "APPROVAL_PENDING" in statuses:
            return f"Approve the {noun}", "TEAM", False
        if statuses & _OUT:
            waiting = "sample evidence" if kind == "SAMPLES" else "evidence"
            return f"Waiting for {waiting}", "OWNER", False
    if not control.requests:
        return "Request evidence", "TEAM", False
    if stages.test not in ("SUCCEEDED",):
        if control.test_status is None and control.nature != "AUTOMATED":
            return "Confirm the population", "TEAM", False
        return "Test the evidence", "AGENT", False
    return "Independent review", "TEAM", False


def _request_kind(key: str) -> Literal["EVIDENCE", "SAMPLES", "FOLLOW_UP"]:
    if key.startswith("samples-"):
        return "SAMPLES"
    if key.startswith("recapture-"):
        return "FOLLOW_UP"
    return "EVIDENCE"


def _request_title(description: str) -> str:
    """The first meaningful line of a request, as its title."""
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
    concluded = sum(1 for c in controls if c.conclusion != "NOT_CONCLUDED")
    next_milestones = [m.model_dump(mode="json") for m in plan.milestones if m.status != "DONE"][:4]
    return DashboardBody(
        started=plan.started,
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
    u.display_name, d.identified_at, d.closed_at, d.version
"""


def _is_reviewer(connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID) -> bool:
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
        pending is not None and reviewer and str(pending.get("requested_by")) != str(viewer)
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
                pending_change, identified_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'CONTROL_DEFICIENCY',
                    %s, %s, %s, %s, %s, %s)
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
        if body.retest_result is not None:
            if status != "READY_FOR_RETEST":
                raise WorkspaceState("retest needs the remediation to be ready")
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
            cursor.execute(
                """
                UPDATE deficiencies SET status = %s, version = version + 1,
                       updated_at = clock_timestamp()
                WHERE id = %s
                """,
                (body.status, deficiency_id),
            )
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
            {"status": body.status, "retest": body.retest_result},
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
        if str(pending.get("requested_by")) == str(principal.id):
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
