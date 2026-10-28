"""Adding a system in one step: the Systems & Processes workflow's Add system wizard (SP2,
decided by the product owner on 24 October 2026).

The wizard collects a system's details, how it is used, and its control areas, then adds it
in one call. The setup agent suggests the control areas from what the wizard documents
(the system's type, how it is hosted, the business processes it supports) and the firm's
standard library; the suggestion is kept as it was shown, apart from the areas a person
approves, with who approved them and when. Adding a system puts no control in scope and so
creates no work: its controls join the families as instances out of scope, and are selected
later (SP4) or from the system's own scoping. Systems and processes are created on their
own; linking them is optional on both sides.
"""

from collections.abc import Callable
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.authorization import Principal, _call, _session_principal
from ai_workforce_api.control_instances import add_application_everywhere
from ai_workforce_api.controls import BUSINESS_LIBRARY, ITGC_DOMAINS, LIBRARY, LIBRARY_VERSION
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.onboarding import (
    SYSTEM_EXISTS,
    OnboardingBody,
    OnboardingState,
    _audit,
    _authorize_setup,
    _snapshot,
    _taken_names,
)
from ai_workforce_api.settings import Settings
from ai_workforce_api.system_review_queue import track_review

Layer = Literal["APPLICATION", "DATABASE", "OPERATING_SYSTEM", "INFRASTRUCTURE", "TOOL"]
Hosting = Literal["SAAS", "VENDOR_HOSTED", "ON_PREMISES"]
Environment = Literal["PRODUCTION", "NON_PRODUCTION", "BOTH"]
Area = Literal["ITGC", "ITAC", "IPE", "BUSINESS"]

AREAS: tuple[Area, ...] = ("ITGC", "ITAC", "IPE", "BUSINESS")


class SystemDraft(BaseModel):
    """What the wizard has documented about a system so far."""

    name: str = Field(min_length=1, max_length=120)
    layer: Layer
    description: str = Field(default="", max_length=500)
    owner: str = Field(default="", max_length=200)
    environment: Environment | None = None
    purpose: str = Field(default="", max_length=1000)
    hosting: Hosting | None = None
    # Other processes it supports, as typed, beside the named processes it is linked to.
    processes: str = Field(default="", max_length=500)
    integration_ids: list[UUID] = Field(default=[], max_length=50)
    process_ids: list[UUID] = Field(default=[], max_length=50)


class SystemCreate(SystemDraft):
    # The control areas the person approved, once the wizard has shown the agent's
    # suggestion (recomputed here, never taken from the caller); omitted, no decision yet.
    approved_areas: list[Area] | None = Field(default=None, max_length=4)


class AreaSuggestion(BaseModel):
    area: Area
    suggested: bool
    # How many of the firm's library controls the area holds for this system.
    controls: int
    reason: str


class AreaSuggestions(BaseModel):
    # The agent's rules over the documented facts and the library; no model is called.
    source: Literal["RULES"] = "RULES"
    library_version: int = LIBRARY_VERSION
    areas: list[AreaSuggestion]


def _count(domains: tuple[str, ...] | set[str]) -> int:
    return sum(1 for control in LIBRARY if control.domain in domains)


def suggest_areas(
    layer: str,
    hosting: str | None,
    process_domains: list[str],
    processes_text: str,
) -> AreaSuggestions:
    """The control areas that typically apply to a system, with the reason for each, from
    its type, how it is hosted, and the processes it supports."""
    application = layer == "APPLICATION"
    itgc_reason = (
        "Access, change, and operations controls apply to every system that supports "
        "financial reporting."
    )
    if hosting in ("SAAS", "VENDOR_HOSTED"):
        itgc_reason += (
            " A provider runs it, so a SOC 1 report may cover the provider's operations; "
            "confirm that in the system's scoping."
        )
    cycles = sorted({domain for domain in process_domains if domain})
    business = (
        {control.domain for control in BUSINESS_LIBRARY if control.domain in cycles}
        if cycles
        else {control.domain for control in BUSINESS_LIBRARY}
    )
    supports = bool(cycles) or processes_text.strip() != ""
    kind = layer.replace("_", " ").lower()
    return AreaSuggestions(
        areas=[
            AreaSuggestion(
                area="ITGC", suggested=True, controls=_count(ITGC_DOMAINS), reason=itgc_reason
            ),
            AreaSuggestion(
                area="ITAC",
                suggested=application,
                controls=_count(("ITAC",)),
                reason=(
                    "An application can enforce automated controls in its configuration, "
                    "such as approvals, calculations, and matching."
                    if application
                    else f"Automated application controls run in applications, not in a {kind}."
                ),
            ),
            AreaSuggestion(
                area="IPE",
                suggested=application,
                controls=_count(("IPE",)),
                reason=(
                    "Reports from an application are relied on in reviews, so their "
                    "completeness and accuracy is tested."
                    if application
                    else f"Key reports come from applications, not from a {kind}."
                ),
            ),
            AreaSuggestion(
                area="BUSINESS",
                suggested=supports,
                controls=_count(business),
                reason=(
                    "It supports business processes, whose manual and IT-dependent "
                    "controls rely on it."
                    if supports
                    else "No business process is linked yet; link one to scope its controls."
                ),
            ),
        ]
    )


def _project_ids(
    connection: psycopg.Connection[Any], table: str, project_id: UUID, ids: list[UUID]
) -> list[UUID]:
    """The ids that belong to the engagement, in the order given; a stranger's is refused."""
    unique = list(dict.fromkeys(ids))
    if not unique:
        return []
    found = {
        UUID(str(row[0]))
        for row in connection.execute(
            f"SELECT id FROM {table} WHERE project_id = %s AND id = ANY(%s)",  # noqa: S608
            (project_id, unique),
        ).fetchall()
    }
    if len(found) != len(unique):
        raise ValueError("a linked record is not in this engagement")
    return unique


def _process_domains(
    connection: psycopg.Connection[Any], project_id: UUID, process_ids: list[UUID]
) -> list[str]:
    if not process_ids:
        return []
    return [
        str(row[0])
        for row in connection.execute(
            "SELECT domain FROM engagement_processes WHERE project_id = %s AND id = ANY(%s)",
            (project_id, process_ids),
        ).fetchall()
    ]


def _clean(body: SystemDraft) -> dict[str, str]:
    values = {
        "name": " ".join(body.name.split()),
        "description": clean_line(body.description, 500),
        "owner": clean_line(body.owner, 200),
        "purpose": clean_line(body.purpose, 1000),
        "processes": clean_line(body.processes, 500),
    }
    if values["name"] == "" or contains_secret(values):
        raise ValueError("system is invalid")
    return values


def preview_areas(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: SystemDraft,
) -> AreaSuggestions:
    """The agent's suggested areas for a system not yet added. Writes nothing."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    _clean(body)
    processes = _project_ids(connection, "engagement_processes", project_id, body.process_ids)
    return suggest_areas(
        body.layer, body.hosting, _process_domains(connection, project_id, processes),
        body.processes,
    )  # fmt: skip


def create_system(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: SystemCreate,
) -> OnboardingBody:
    """Add a system with its details, links, and approved control areas. No control joins
    the scope, so no work, request, or approval is created."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    values = _clean(body)
    if values["name"].casefold() in _taken_names(connection, project_id):
        raise OnboardingState(SYSTEM_EXISTS)
    integrations = _project_ids(
        connection, "engagement_applications", project_id, body.integration_ids
    )
    processes = _project_ids(connection, "engagement_processes", project_id, body.process_ids)
    suggestion = suggest_areas(
        body.layer, body.hosting, _process_domains(connection, project_id, processes),
        values["processes"],
    )  # fmt: skip
    decided = body.approved_areas is not None
    approved = [area for area in AREAS if area in set(body.approved_areas or [])]
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO engagement_applications (
                organization_id, project_id, name, description, layer, owner, purpose,
                processes, environment, hosting, facts_source, facts_reason, facts_confirmed,
                control_areas, control_areas_suggested, control_areas_decided_by,
                control_areas_decided_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    CASE WHEN %s THEN clock_timestamp() END)
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (organization_id, project_id, values["name"], values["description"], body.layer,
             values["owner"], values["purpose"], values["processes"], body.environment,
             body.hosting, "PERSON" if body.hosting else "NONE",
             "Stated by the team when the system was added." if body.hosting else "",
             body.hosting is not None, approved if decided else None,
             Json(suggestion.model_dump()) if decided else None,
             principal.id if decided else None, decided),
        ).fetchone()  # fmt: skip
        if row is None:
            # Another request added the same system a moment ago.
            raise OnboardingState(SYSTEM_EXISTS)
        system_id = UUID(str(row[0]))
        # The system joins each control family as its own instance, out of scope: its
        # controls are selected later, so adding it creates no work.
        add_application_everywhere(cursor, project_id, system_id)
        cursor.execute(
            """
            UPDATE engagement_controls
            SET included = false, version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s AND engagement_application_id = %s AND included
            """,
            (project_id, system_id),
        )
        track_review(cursor, organization_id, project_id, system_id, principal.id)
        for related in integrations:
            cursor.execute(
                """
                INSERT INTO engagement_system_integrations (
                    project_id, application_id, related_application_id, created_by
                )
                VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING
                """,
                (project_id, system_id, related, principal.id),
            )
        for process_id in processes:
            cursor.execute(
                """
                INSERT INTO engagement_process_systems (
                    project_id, process_id, application_id, created_by
                )
                VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING
                """,
                (project_id, process_id, system_id, principal.id),
            )
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.system_added",
            {"system_id": str(system_id), "layer": body.layer,
             "approved_areas": approved,
             "suggested_areas": [a.area for a in suggestion.areas if a.suggested],
             "integrations": len(integrations), "processes": len(processes)},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def register_system_setup(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/onboarding/systems"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except OnboardingState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.post(f"{base}/areas")
    def system_areas(
        organization_id: UUID, project_id: UUID, body: SystemDraft, request: Request
    ) -> AreaSuggestions:
        return run(request, lambda c, p: preview_areas(c, p, organization_id, project_id, body))

    @app.post(base)
    def add_system(
        organization_id: UUID, project_id: UUID, body: SystemCreate, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: create_system(c, p, organization_id, project_id, body))
