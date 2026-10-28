"""The Systems & Processes workflow's processes, control selection, and finalization (SP3,
SP4, SP6, decided by the product owner on 24 October 2026).

- SP3: a business process is added in one step with its description, owner, the systems it
  runs on (one of them primary), and its control areas: the agent's suggestion kept apart
  from the areas a person approved. A process needs no system, and a system no process.
- SP4: controls are selected from the firm's library for one system or one process at a
  time. A system's are its instances of the library standards; a process's are the library
  controls of the cycle it is based on.
- SP6: the engagement's work starts when a person reviews and finalizes the scope. Until
  then, selecting or removing controls creates no work (scope_changes.reconcile_scope reads
  scope_finalized); finalizing creates it for everything in scope, and later changes are
  reconciled at once, as before. An engagement launched with controls is final from its
  launch.
"""

from collections.abc import Callable
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.authorization import NotVisible, Principal, _call, _session_principal
from ai_workforce_api.controls import (
    DOMAIN_AGENTS,
    DOMAIN_LABELS,
    DOMAINS,
    ITGC_DOMAINS,
    LIBRARY,
    LIBRARY_VERSION,
    SYSTEM_DOMAINS,
    runs_on_a_system,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.onboarding import (
    OnboardingBody,
    OnboardingState,
    _audit,
    _audit_target,
    _authorize_setup,
    _instances,
    _reset_templates,
    _snapshot,
)
from ai_workforce_api.pbc_drafting import DraftScheduler
from ai_workforce_api.schedule import KIND_PHASES
from ai_workforce_api.scope_changes import reconcile_scope, scope_finalized, started
from ai_workforce_api.settings import Settings
from ai_workforce_api.system_scoping import include_control
from ai_workforce_api.system_setup import AREAS, Area, AreaSuggestion, AreaSuggestions, _count
from ai_workforce_api.workpapers import default_template

BUSINESS_DOMAINS = tuple(domain for domain in DOMAINS if not runs_on_a_system(domain))


def area_of(domain: str) -> Area:
    """The control area a library domain falls in."""
    if domain in ITGC_DOMAINS:
        return "ITGC"
    if domain in ("ITAC", "IPE"):
        return "ITAC" if domain == "ITAC" else "IPE"
    return "BUSINESS"


# SP3: adding a business process


class ProcessDraft(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    domain: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=500)
    owner: str = Field(default="", max_length=200)
    system_ids: list[UUID] = Field(default=[], max_length=50)
    primary_system_id: UUID | None = None


class ProcessSetupCreate(ProcessDraft):
    # The areas a person approved once the suggestion was shown; omitted, no decision yet.
    approved_areas: list[Area] | None = Field(default=None, max_length=4)


def suggest_process_areas(domain: str, system_layers: list[str]) -> AreaSuggestions:
    """The control areas that typically apply to a process, from the cycle it is based on
    and the systems it runs on."""
    cycle = DOMAIN_LABELS.get(domain, domain).lower()
    application = "APPLICATION" in system_layers
    return AreaSuggestions(
        areas=[
            AreaSuggestion(
                area="ITGC",
                suggested=False,
                controls=_count(ITGC_DOMAINS),
                reason="IT general controls are scoped on the systems the process runs on.",
            ),
            AreaSuggestion(
                area="ITAC",
                suggested=application,
                controls=_count(("ITAC",)),
                reason=(
                    "It runs on an application, which can enforce automated controls in "
                    "the process."
                    if application
                    else "No application is linked, so no automated control is expected."
                ),
            ),
            AreaSuggestion(
                area="IPE",
                suggested=application,
                controls=_count(("IPE",)),
                reason=(
                    "Reports from its application are likely relied on in its reviews."
                    if application
                    else "No application is linked, so no key report is expected."
                ),
            ),
            AreaSuggestion(
                area="BUSINESS",
                suggested=True,
                controls=_count((domain,)),
                reason=f"The library's {cycle} controls: manual and IT-dependent controls.",
            ),
        ]
    )


def _systems_of(
    connection: psycopg.Connection[Any], project_id: UUID, ids: list[UUID]
) -> dict[UUID, str]:
    """The engagement's systems named, with their layers; a stranger's is refused."""
    unique = list(dict.fromkeys(ids))
    if not unique:
        return {}
    rows = connection.execute(
        "SELECT id, layer FROM engagement_applications WHERE project_id = %s AND id = ANY(%s)",
        (project_id, unique),
    ).fetchall()
    if len(rows) != len(unique):
        raise ValueError("a linked record is not in this engagement")
    found = {UUID(str(row[0])): str(row[1]) for row in rows}
    return {system: found[system] for system in unique}


def _clean_process(body: ProcessDraft) -> dict[str, str]:
    values = {
        "name": " ".join(body.name.split()),
        "description": clean_line(body.description, 500),
        "owner": clean_line(body.owner, 200),
    }
    if values["name"] == "" or contains_secret(values):
        raise ValueError("process is invalid")
    if body.domain not in BUSINESS_DOMAINS:
        raise ValueError("a process is based on a business cycle")
    if body.primary_system_id is not None and body.primary_system_id not in body.system_ids:
        raise ValueError("the primary system is one of the process's systems")
    return values


def preview_process_areas(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ProcessDraft,
) -> AreaSuggestions:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    _clean_process(body)
    layers = list(_systems_of(connection, project_id, body.system_ids).values())
    return suggest_process_areas(body.domain, layers)


def create_process(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ProcessSetupCreate,
) -> OnboardingBody:
    """Add a business process with its details, systems, and approved control areas. It puts
    no control in scope, so no work, request, or approval is created."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    values = _clean_process(body)
    systems = _systems_of(connection, project_id, body.system_ids)
    suggestion = suggest_process_areas(body.domain, list(systems.values()))
    decided = body.approved_areas is not None
    approved = [area for area in AREAS if area in set(body.approved_areas or [])]
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO engagement_processes (
                organization_id, project_id, name, domain, description, owner,
                control_areas, control_areas_suggested, control_areas_decided_by,
                control_areas_decided_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                    CASE WHEN %s THEN clock_timestamp() END)
            ON CONFLICT (project_id, name) DO NOTHING
            RETURNING id
            """,
            (organization_id, project_id, values["name"], body.domain, values["description"],
             values["owner"], approved if decided else None,
             Json(suggestion.model_dump()) if decided else None,
             principal.id if decided else None, decided),
        ).fetchone()  # fmt: skip
        if row is None:
            raise OnboardingState("process exists")
        process_id = UUID(str(row[0]))
        for system_id in systems:
            cursor.execute(
                """
                INSERT INTO engagement_process_systems (
                    project_id, process_id, application_id, is_primary, created_by
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (project_id, process_id, system_id, system_id == body.primary_system_id,
                 principal.id),
            )  # fmt: skip
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.process_added",
            {"process_id": str(process_id), "domain": body.domain, "systems": len(systems),
             "approved_areas": approved,
             "suggested_areas": [a.area for a in suggestion.areas if a.suggested]},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


# SP4: selecting controls from the library


class ControlOption(BaseModel):
    library_key: str
    control_ref: str
    title: str
    domain: str
    domain_label: str
    area: Area
    # In scope for the target now.
    in_scope: bool


class ControlOptions(BaseModel):
    target_kind: Literal["SYSTEM", "PROCESS"]
    target_id: UUID
    target_name: str
    # The areas a person approved for the target; None until one decided.
    approved_areas: list[str] | None
    controls: list[ControlOption]


class ControlSelection(BaseModel):
    system_id: UUID | None = None
    process_id: UUID | None = None
    library_keys: list[str] = Field(min_length=1, max_length=150)


def _target(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    system_id: UUID | None,
    process_id: UUID | None,
) -> tuple[Literal["SYSTEM", "PROCESS"], UUID, str, str, list[str] | None]:
    """The system or process controls are selected for: kind, id, name, cycle, areas."""
    if (system_id is None) == (process_id is None):
        raise ValueError("name a system or a process")
    if system_id is not None:
        row = connection.execute(
            "SELECT id, name, control_areas, out_of_scope_at IS NOT NULL "
            "FROM engagement_applications WHERE id = %s AND project_id = %s",
            (system_id, project_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if row[3]:
            # Taken out of scope (0114): brought back first, then its controls selected.
            raise OnboardingState("bring the system back into scope first")
        return "SYSTEM", UUID(str(row[0])), str(row[1]), "", row[2]
    row = connection.execute(
        "SELECT id, name, domain, control_areas FROM engagement_processes "
        "WHERE id = %s AND project_id = %s",
        (process_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return "PROCESS", UUID(str(row[0])), str(row[1]), str(row[2]), row[3]


def control_options(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    system_id: UUID | None,
    process_id: UUID | None,
) -> ControlOptions:
    """The library controls that can be selected for a system or a process, each with
    whether it is in scope for it now."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    kind, target_id, name, cycle, areas = _target(connection, project_id, system_id, process_id)
    if kind == "SYSTEM":
        library = [control for control in LIBRARY if control.domain in SYSTEM_DOMAINS]
        held = {
            str(row[0])
            for row in connection.execute(
                "SELECT library_key FROM engagement_controls WHERE project_id = %s "
                "AND engagement_application_id = %s AND included AND library_key IS NOT NULL",
                (project_id, target_id),
            ).fetchall()
        }
    else:
        library = [control for control in LIBRARY if control.domain == cycle]
        held = {
            str(row[0])
            for row in connection.execute(
                "SELECT library_key FROM engagement_controls WHERE project_id = %s "
                "AND engagement_application_id IS NULL AND included AND library_key IS NOT NULL "
                "AND (process_id = %s OR process_id IS NULL)",
                (project_id, target_id),
            ).fetchall()
        }
    return ControlOptions(
        target_kind=kind,
        target_id=target_id,
        target_name=name,
        approved_areas=None if areas is None else [str(area) for area in areas],
        controls=[
            ControlOption(
                library_key=control.key,
                control_ref=control.control_ref,
                title=control.title,
                domain=control.domain,
                domain_label=DOMAIN_LABELS.get(control.domain, control.domain),
                area=area_of(control.domain),
                in_scope=control.key in held,
            )
            for control in library
        ],
    )


def _include_process_control(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    process_id: UUID,
    library_key: str,
) -> None:
    """A library business control in scope for a named process: its one row, given to the
    process, or added. One already given to another process stays with it."""
    control = next((c for c in LIBRARY if c.key == library_key), None)
    if control is None:
        raise ValueError("not a library control")
    row = cursor.execute(
        "SELECT id, process_id FROM engagement_controls WHERE project_id = %s "
        "AND library_key = %s AND engagement_application_id IS NULL FOR UPDATE",
        (project_id, library_key),
    ).fetchone()
    if row is not None:
        if row[1] is not None and UUID(str(row[1])) != process_id:
            raise OnboardingState(f"{control.control_ref} is in scope for another process")
        cursor.execute(
            """
            UPDATE engagement_controls
            SET included = true, process_id = %s, version = version + 1,
                updated_at = clock_timestamp()
            WHERE id = %s AND (NOT included OR process_id IS DISTINCT FROM %s)
            """,
            (process_id, row[0], process_id),
        )
        return
    cursor.execute(
        """
        INSERT INTO engagement_controls (
            organization_id, project_id, library_key, library_version, control_ref,
            domain, title, risk, activity, frequency, nature, application_ids,
            test_attributes, pbc_items, template_key, agent_key, engagement_application_id,
            process_id
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, %s)
        """,
        (organization_id, project_id, control.key, LIBRARY_VERSION, control.control_ref,
         control.domain, control.title, control.risk, control.activity, control.frequency,
         control.nature, [], Json(list(control.test_attributes)),
         Json(list(control.pbc_items)), default_template(control.domain),
         DOMAIN_AGENTS[control.domain], process_id),
    )  # fmt: skip
    _reset_templates(cursor, project_id)


def select_controls(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ControlSelection,
) -> OnboardingBody:
    """Bring the chosen library controls into scope for one system or process. Before the
    scope is finalized this creates no work; after, the work is reconciled as for any other
    scope change."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    kind, target_id, _name, cycle, _areas = _target(
        connection, project_id, body.system_id, body.process_id
    )
    keys = list(dict.fromkeys(body.library_keys))
    by_key = {control.key: control for control in LIBRARY}
    for key in keys:
        control = by_key.get(key)
        allowed = control is not None and (
            control.domain in SYSTEM_DOMAINS if kind == "SYSTEM" else control.domain == cycle
        )
        if not allowed:
            raise ValueError("a control does not apply to this system or process")
    with transaction(connection) as cursor:
        for key in keys:
            if kind == "SYSTEM":
                held = cursor.execute(
                    "SELECT 1 FROM engagement_controls WHERE project_id = %s "
                    "AND engagement_application_id = %s AND library_key = %s AND included",
                    (project_id, target_id, key),
                ).fetchone()
                if held is None:
                    include_control(cursor, organization_id, project_id, target_id, None, key)
            else:
                _include_process_control(cursor, organization_id, project_id, target_id, key)
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.controls_selected",
            {"target": kind.lower(), "target_id": str(target_id), "library_keys": keys},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


# SP6: review and finalize


class ScopeFinalization(BaseModel):
    # The person confirms the scope as reviewed: the counts shown on the page.
    systems: int = Field(ge=0)
    processes: int = Field(ge=0)
    controls: int = Field(ge=1)


def finalize_scope(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ScopeFinalization,
) -> OnboardingBody:
    """Confirm the scope and start planning: the work of every control in scope is created
    now, all at once. The counts the person reviewed must still match."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    if not started(connection, project_id):
        raise OnboardingState("launch the engagement first")
    if scope_finalized(connection, project_id):
        raise OnboardingState("the scope is already final")
    counts = connection.execute(
        """
        SELECT (SELECT count(*) FROM engagement_applications
                WHERE project_id = %s AND out_of_scope_at IS NULL),
               (SELECT count(*) FROM engagement_processes WHERE project_id = %s),
               (SELECT count(*) FROM engagement_controls WHERE project_id = %s AND included)
        """,
        (project_id, project_id, project_id),
    ).fetchone()
    assert counts is not None
    if int(counts[2]) == 0:
        raise OnboardingState("select at least one control")
    if (int(counts[0]), int(counts[1]), int(counts[2])) != (
        body.systems, body.processes, body.controls,
    ):  # fmt: skip
        raise OnboardingState("the scope changed since it was reviewed")
    instances = _instances(connection, organization_id, project_id)
    with transaction(connection) as cursor:
        claimed = cursor.execute(
            """
            UPDATE engagement_settings
            SET scope_finalized_at = clock_timestamp(), scope_finalized_by = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s AND scope_finalized_at IS NULL
            RETURNING project_id
            """,
            (principal.id, project_id),
        ).fetchone()
        if claimed is None:
            raise OnboardingState("the scope is already final")
        # Launched with no controls, the engagement has no report task yet: the reviews
        # created below wait for it.
        report = cursor.execute(
            "SELECT 1 FROM tasks WHERE project_id = %s AND plan_kind = 'report' "
            "AND status <> 'CANCELLED'",
            (project_id,),
        ).fetchone()
        if report is None:
            row = cursor.execute(
                """
                INSERT INTO tasks (
                    organization_id, project_id, title, description, status, priority,
                    agent_instance_id, phase_key, plan_kind
                )
                VALUES (%s, %s, %s, %s, 'READY', 'NORMAL', %s, %s, 'report')
                RETURNING id
                """,
                (organization_id, project_id, "Draft findings and the engagement report",
                 "Summarize exceptions and deficiencies from reviewed work only.",
                 instances.get("reporting-analyst"), KIND_PHASES["report"]),
            ).fetchone()  # fmt: skip
            if row is None:
                raise NotVisible()
            _audit_target(
                cursor, organization_id, project_id, principal.id, "task.created", "task",
                row[0], {"status": "READY", "source": "scope_finalized"},
            )  # fmt: skip
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.scope_finalized",
            {"systems": body.systems, "processes": body.processes, "controls": body.controls},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def register_scope_setup(
    app: FastAPI, settings: Settings, scheduler: DraftScheduler | None
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/onboarding"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except OnboardingState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    def drafts(project_id: UUID) -> None:
        """The evidence coordinator drafts the requests the new work queued."""
        from ai_workforce_api.onboarding import started_drafts
        from ai_workforce_api.pbc_drafting import schedule

        schedule(scheduler, started_drafts(settings, project_id))

    @app.post(f"{base}/processes/areas")
    def process_areas(
        organization_id: UUID, project_id: UUID, body: ProcessDraft, request: Request
    ) -> AreaSuggestions:
        return run(
            request, lambda c, p: preview_process_areas(c, p, organization_id, project_id, body)
        )

    @app.post(f"{base}/processes/setup")
    def add_process(
        organization_id: UUID, project_id: UUID, body: ProcessSetupCreate, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: create_process(c, p, organization_id, project_id, body))

    @app.get(f"{base}/scope/options")
    def scope_options(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        system_id: UUID | None = None,
        process_id: UUID | None = None,
    ) -> ControlOptions:
        return run(
            request,
            lambda c, p: control_options(c, p, organization_id, project_id, system_id, process_id),
        )

    @app.post(f"{base}/scope/select")
    def scope_select(
        organization_id: UUID, project_id: UUID, body: ControlSelection, request: Request
    ) -> OnboardingBody:
        result = run(request, lambda c, p: select_controls(c, p, organization_id, project_id, body))
        drafts(project_id)
        return result

    @app.post(f"{base}/scope/finalize")
    def scope_finalize(
        organization_id: UUID, project_id: UUID, body: ScopeFinalization, request: Request
    ) -> OnboardingBody:
        result = run(request, lambda c, p: finalize_scope(c, p, organization_id, project_id, body))
        drafts(project_id)
        return result
