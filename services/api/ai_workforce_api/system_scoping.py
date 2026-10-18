"""An in-scope system's scoping: its candidate controls, the review job, and the team's
changes to its controls.

The review itself (milestone 8.10) is in system_applicability.py: it reads any uploaded
SOC 1 report, then assesses which candidate controls apply and whether a SOC 1 report is
relevant. It runs only when a person asks (the wizard's magic wand) or uploads a report,
and it changes no scope: the team saves the wizard's selection. Earlier reviews guessed
CUECs and SOC coverage from what such reports usually say; migration 0065 removed those.

This module keeps what the review and the wizard share: the candidates (gather), the job
that runs a review, and bringing a control into or out of scope for a system.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import Principal, _call, _session_principal
from ai_workforce_api.control_instances import clone_instance
from ai_workforce_api.controls import (
    DOMAIN_AGENTS,
    LIBRARY,
    LIBRARY_VERSION,
    runs_on_a_system,
)
from ai_workforce_api.db import connect, independent_steps, transaction
from ai_workforce_api.model_providers import live_model, provider_for
from ai_workforce_api.models import ModelProvider
from ai_workforce_api.onboarding import (
    OnboardingBody,
    OnboardingState,
    _audit,
    _authorize_setup,
    _reason_for,
    _reset_templates,
    _snapshot,
)
from ai_workforce_api.scope_changes import reconcile_scope
from ai_workforce_api.settings import Settings
from ai_workforce_api.system_review_queue import (
    LEASE_MINUTES,
    MAX_ATTEMPTS,
    request_review,
    schedule_system_reviews,
)
from ai_workforce_api.workpapers import default_template

logger = logging.getLogger(__name__)

Hosting = Literal["SAAS", "VENDOR_HOSTED", "ON_PREMISES"]
HOSTING: tuple[Hosting, ...] = ("SAAS", "VENDOR_HOSTED", "ON_PREMISES")

# What is known of common systems: how each is usually run, and whether its vendor
# usually issues a SOC 1 report. A first guess the team confirms; it varies by client.
KNOWN_FACTS: dict[str, tuple[Hosting | None, bool | None]] = {
    "SAP S/4HANA": (None, None),
    "SAP ECC": ("ON_PREMISES", False),
    "SAP BW": ("ON_PREMISES", False),
    "SAP SuccessFactors": ("SAAS", True),
    "SAP Ariba": ("SAAS", True),
    "SAP Concur": ("SAAS", True),
    "Oracle E-Business Suite": ("ON_PREMISES", False),
    "Oracle Fusion Cloud ERP": ("SAAS", True),
    "Oracle NetSuite": ("SAAS", True),
    "Oracle PeopleSoft": ("ON_PREMISES", False),
    "Oracle Hyperion": ("ON_PREMISES", False),
    "JD Edwards": ("ON_PREMISES", False),
    "Oracle Database": ("ON_PREMISES", False),
    "Microsoft Dynamics 365": ("SAAS", True),
    "Microsoft Dynamics AX": ("ON_PREMISES", False),
    "Microsoft Dynamics GP": ("ON_PREMISES", False),
    "Business Central": ("SAAS", True),
    "Workday": ("SAAS", True),
    "Salesforce": ("SAAS", True),
    "ServiceNow": ("SAAS", True),
    "Jira": ("SAAS", True),
    "Coupa": ("SAAS", True),
    "Kyriba": ("SAAS", True),
    "BlackLine": ("SAAS", True),
    "OneStream": ("SAAS", True),
    "Anaplan": ("SAAS", True),
    "ADP": ("SAAS", True),
    "UKG": ("SAAS", True),
    "QuickBooks": ("SAAS", True),
    "Sage Intacct": ("SAAS", True),
    "Epicor": (None, None),
    "Infor": (None, None),
    "Tableau": (None, False),
    "Power BI": ("SAAS", True),
    "Snowflake": ("SAAS", True),
    "Microsoft SQL Server": ("ON_PREMISES", False),
    "IBM Db2": ("ON_PREMISES", False),
    "PostgreSQL": ("ON_PREMISES", False),
    "MySQL": ("ON_PREMISES", False),
    "Microsoft Entra ID": ("SAAS", True),
    "Active Directory": ("ON_PREMISES", False),
    "Okta": ("SAAS", True),
    "CyberArk": (None, None),
    "SailPoint": (None, None),
    "Windows Server": ("ON_PREMISES", False),
    "Linux": ("ON_PREMISES", False),
    "UNIX": ("ON_PREMISES", False),
    "IBM i": ("ON_PREMISES", False),
    "Mainframe": ("ON_PREMISES", False),
    "Amazon Web Services": ("VENDOR_HOSTED", True),
    "Microsoft Azure": ("VENDOR_HOSTED", True),
    "Google Cloud": ("VENDOR_HOSTED", True),
    "Azure DevOps": ("SAAS", True),
    "GitHub": ("SAAS", True),
    "GitLab": (None, None),
    "Control-M": ("ON_PREMISES", False),
    "Veeam": ("ON_PREMISES", False),
    "Commvault": ("ON_PREMISES", False),
}

# The library areas a CUEC can call for: IT general controls, application controls, and
# key reports. Business-cycle controls are scoped by process, not by system.
RECOMMENDABLE_DOMAINS = ("ACCESS", "CHANGE", "OPERATIONS", "ITAC", "IPE")
# A system the client runs, with no SOC 1 report to rely on, has its own IT general
# controls tested. When the agent does not choose them, the reviewed set for the kind of
# system stands in. Every other library control stays available for the team to add.
_GENERAL = ("ACCESS", "CHANGE", "OPERATIONS")
_ACCESS = (
    "access-provisioning",
    "access-termination",
    "access-review",
    "access-privileged",
    "access-authentication",
)
GENERAL_BY_LAYER: dict[str, tuple[str, ...]] = {
    "APPLICATION": (
        *_ACCESS,
        "access-shared-accounts",
        "change-approval",
        "change-segregation",
        "change-configuration",
        "change-data",
        "operations-jobs",
        "operations-backup",
    ),
    "DATABASE": (
        *_ACCESS,
        "access-shared-accounts",
        "change-approval",
        "change-data",
        "operations-backup",
    ),
    "OPERATING_SYSTEM": (*_ACCESS, "change-approval", "operations-jobs", "operations-backup"),
    "INFRASTRUCTURE": (
        *_ACCESS,
        "access-shared-accounts",
        "change-configuration",
        "operations-incidents",
        "operations-physical",
    ),
    "TOOL": (*_ACCESS[:4], "change-configuration"),
}


@dataclass(frozen=True)
class Candidate:
    """A control that could answer a CUEC for this system."""

    library_key: str
    control_ref: str
    title: str
    # The system's instance, when the control is loaded for it. For a control the client
    # has on another system only, another system's instance (`elsewhere`).
    control_id: UUID | None
    included: bool
    domain: str = ""
    activity: str = ""
    elsewhere: bool = False


@dataclass(frozen=True)
class SystemFacts:
    application_id: UUID
    organization_id: UUID
    project_id: UUID
    name: str
    layer: str
    hosting: str | None
    soc_expected: bool | None
    confirmed: bool
    # This system's control instances: (id, library key, control ref, title, included).
    controls: tuple[tuple[UUID, str, str, str, bool], ...]
    # Every control a CUEC could call for: this system's instances, then library
    # controls not loaded for it, or, when the client's RCM is the source, the client's
    # other IT controls not on this system yet.
    candidates: tuple[Candidate, ...]
    uploaded: bool = False


# Facts


def gather(connection: psycopg.Connection[Any], application_id: UUID) -> SystemFacts | None:
    row = connection.execute(
        """
        SELECT a.id, a.organization_id, a.project_id, a.name, a.layer, a.hosting,
               a.soc_expected, a.facts_confirmed
        FROM engagement_applications a WHERE a.id = %s
        """,
        (application_id,),
    ).fetchone()
    if row is None:
        return None
    controls = connection.execute(
        """
        SELECT id, library_key, control_ref, title, included, domain, activity
        FROM engagement_controls
        WHERE project_id = %s AND engagement_application_id = %s
        ORDER BY control_ref
        """,
        (row[2], application_id),
    ).fetchall()
    rows = tuple((UUID(str(c[0])), str(c[1]), str(c[2]), str(c[3]), bool(c[4])) for c in controls)
    loaded = {str(c[1]): c for c in controls}
    candidates: list[Candidate] = [
        Candidate(
            str(c[1]), str(c[2]), str(c[3]), UUID(str(c[0])), bool(c[4]), str(c[5]), str(c[6])
        )
        for c in controls
        if str(c[5]) in RECOMMENDABLE_DOMAINS
    ]
    uploaded_row = connection.execute(
        "SELECT EXISTS (SELECT 1 FROM engagement_controls WHERE project_id = %s "
        "AND source = 'UPLOAD')",
        (row[2],),
    ).fetchone()
    uploaded = bool(uploaded_row and uploaded_row[0])
    if uploaded:
        # The client's RCM is the source: its other IT controls, not on this system yet,
        # are what a CUEC can call for. The library is not offered next to it.
        others = connection.execute(
            """
            SELECT DISTINCT ON (upper(control_ref))
                   id, control_ref, title, domain, activity
            FROM engagement_controls
            WHERE project_id = %s AND source = 'UPLOAD' AND domain = ANY(%s)
              AND upper(control_ref) <> ALL(%s)
            ORDER BY upper(control_ref), created_at
            """,
            (
                row[2],
                list(RECOMMENDABLE_DOMAINS),
                [str(c[2]).upper() for c in controls],
            ),
        ).fetchall()
        candidates += [
            Candidate("", str(o[1]), str(o[2]), UUID(str(o[0])), False, str(o[3]), str(o[4]), True)
            for o in others
        ]
    else:
        candidates += [
            Candidate(
                control.key,
                control.control_ref,
                control.title,
                None,
                False,
                control.domain,
                control.activity,
            )
            for control in LIBRARY
            if control.domain in RECOMMENDABLE_DOMAINS and control.key not in loaded
        ]
    return SystemFacts(
        application_id=UUID(str(row[0])),
        organization_id=UUID(str(row[1])),
        project_id=UUID(str(row[2])),
        name=str(row[3]),
        layer=str(row[4]),
        hosting=None if row[5] is None else str(row[5]),
        soc_expected=None if row[6] is None else bool(row[6]),
        confirmed=bool(row[7]),
        controls=rows,
        candidates=tuple(candidates),
        uploaded=uploaded,
    )


# Running a review


def review_runner(
    settings: Settings, provider: ModelProvider | None = None
) -> Callable[[UUID], str]:
    model = provider if provider is not None else provider_for(settings)
    use_model = provider is not None or live_model(settings)

    def run(application_id: UUID) -> str:
        with connect(settings.database_url) as connection:
            return run_review(connection, model if use_model else None, application_id)

    return run


def run_review(
    connection: psycopg.Connection[Any], provider: ModelProvider | None, application_id: UUID
) -> str:
    """Review the system; again, a few times at most, when asked again mid-run."""
    result = "SKIPPED"
    for _ in range(3):
        result = _review_once(connection, provider, application_id)
        if result != "AGAIN":
            return result
    return "DONE"


def _review_once(
    connection: psycopg.Connection[Any], provider: ModelProvider | None, application_id: UUID
) -> str:
    independent_steps(connection)
    with transaction(connection) as cursor:
        claimed = cursor.execute(
            """
            UPDATE system_reviews
            SET review_status = 'WORKING', attempts = attempts + 1, again = false,
                lease_until = clock_timestamp() + make_interval(mins => %s)
            WHERE application_id = %s AND attempts < %s
              AND (review_status = 'PENDING'
                   OR (review_status = 'WORKING' AND lease_until < clock_timestamp()))
            RETURNING requested_by
            """,
            (LEASE_MINUTES, application_id, MAX_ATTEMPTS),
        ).fetchone()
    if claimed is None:
        return "SKIPPED"
    requester = UUID(str(claimed[0]))
    # Milestone 8.10: read any uploaded SOC report, then assess which controls apply and
    # whether a SOC 1 report is relevant (system_applicability.py).
    from ai_workforce_api.system_applicability import review

    again = review(connection, provider, application_id, requester)
    return "AGAIN" if again else "DONE"


# What a person does with the review


class FactsUpdate(BaseModel):
    version: int = Field(ge=1)
    hosting: Hosting | None
    soc_expected: bool | None


class AddControl(BaseModel):
    """A control the team adds for one system: a library control, or its own instance."""

    library_key: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9-]{0,60}$")
    control_id: UUID | None = None


def add_control(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    body: AddControl,
) -> OnboardingBody:
    """Bring one control into scope for this system, chosen by the team."""
    if (body.library_key is None) == (body.control_id is None):
        raise ValueError("name a library control or a control")
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    with transaction(connection) as cursor:
        # The team adds controls without first confirming how the system is run: that is
        # the agent's assessment now, not a question (milestone 8.10).
        found = cursor.execute(
            "SELECT 1 FROM engagement_applications WHERE id = %s AND project_id = %s",
            (application_id, project_id),
        ).fetchone()
        if found is None:
            raise OnboardingState("system changed")
        include_control(
            cursor, organization_id, project_id, application_id, body.control_id, body.library_key
        )
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.system_control_added",
            {"library_key": body.library_key, "control_id": None if body.control_id is None
             else str(body.control_id)},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def include_control(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    control_id: UUID | None,
    library_key: str | None,
) -> None:
    """Bring a control into scope for this system: its own instance, a copy of another
    system's, the family's row without a system, or a library control."""
    if True:
        # This system's own instance: the one named, or its family's, or the library control's.
        instance = cursor.execute(
            """
            SELECT id FROM engagement_controls
            WHERE project_id = %s AND engagement_application_id = %s
              AND (id = %s OR (library_key IS NOT NULL AND library_key = %s)
                   OR control_ref = (SELECT control_ref FROM engagement_controls WHERE id = %s))
            """,
            (project_id, application_id, control_id, library_key, control_id),
        ).fetchone()
        if instance is not None:
            cursor.execute(
                """
                UPDATE engagement_controls
                SET included = true, version = version + 1, updated_at = clock_timestamp()
                WHERE id = %s AND NOT included
                """,
                (instance[0],),
            )
        elif library_key is not None:
            _add_library_control(cursor, organization_id, project_id, application_id, library_key)
        else:
            # Another system's instance of the control: this system gets its own.
            source = cursor.execute(
                """
                SELECT id, engagement_application_id, domain FROM engagement_controls
                WHERE id = %s AND project_id = %s FOR UPDATE
                """,
                (control_id, project_id),
            ).fetchone()
            if source is None:
                raise OnboardingState("system changed")
            if not runs_on_a_system(str(source[2])):
                raise OnboardingState("a business process control has no system")
            if source[1] is None:
                # The family's row without a system takes this one.
                cursor.execute(
                    """
                    UPDATE engagement_controls
                    SET engagement_application_id = %s, application_ids = ARRAY[%s]::uuid[],
                        included = true, version = version + 1, updated_at = clock_timestamp()
                    WHERE id = %s
                    """,
                    (application_id, application_id, source[0]),
                )
            else:
                copied = clone_instance(cursor, UUID(str(source[0])), application_id)
                cursor.execute(
                    "UPDATE engagement_controls SET included = true WHERE id = %s", (copied,)
                )
            _reset_templates(cursor, project_id)


class RemoveControl(BaseModel):
    control_id: UUID
    # Why, when the engagement is running and the control has work on record.
    reason: str = Field(default="", max_length=500)


def remove_control(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    body: RemoveControl,
) -> OnboardingBody:
    """Take one of this system's controls out of scope. It stays available to add back."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    recorded = _reason_for(connection, project_id, [body.control_id], body.reason)
    with transaction(connection) as cursor:
        updated = cursor.execute(
            """
            UPDATE engagement_controls
            SET included = false, version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND project_id = %s AND engagement_application_id = %s
            RETURNING id
            """,
            (body.control_id, project_id, application_id),
        ).fetchone()
        if updated is None:
            raise OnboardingState("system changed")
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.system_control_removed",
            {"control_id": str(body.control_id), **recorded},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


class Decision(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=60)
    # KEEP undoes reliance on the SOC report: the control comes back into scope.
    action: Literal["ACCEPT", "DISMISS", "KEEP"]


def set_facts(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    body: FactsUpdate,
) -> OnboardingBody:
    """The team states how the system is run. Changed facts are reviewed again."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    with transaction(connection) as cursor:
        before = cursor.execute(
            """
            SELECT a.hosting, a.soc_expected, r.review_status = 'IDLE' AND r.reviewed_at IS NOT NULL
            FROM engagement_applications a
            LEFT JOIN system_reviews r ON r.application_id = a.id
            WHERE a.id = %s AND a.project_id = %s
            FOR UPDATE OF a
            """,
            (application_id, project_id),
        ).fetchone()
        if before is None:
            raise OnboardingState("system changed")
        # The finished review already used these facts: confirming them keeps it.
        unchanged = (
            before[0] == body.hosting and before[1] == body.soc_expected and before[2] is True
        )
        updated = cursor.execute(
            """
            UPDATE engagement_applications
            SET hosting = %s, soc_expected = %s, facts_source = 'PERSON',
                facts_reason = 'Confirmed by the team.', facts_confirmed = true,
                version = version + 1
            WHERE id = %s AND project_id = %s AND version = %s
            RETURNING id
            """,
            (body.hosting, body.soc_expected, application_id, project_id, body.version),
        ).fetchone()
        if updated is None:
            raise OnboardingState("system changed")
        if not unchanged:
            request_review(cursor, organization_id, project_id, application_id, principal.id)
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.system_facts",
            {"hosting": body.hosting, "soc_expected": body.soc_expected, "reviewed": not unchanged},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def decide(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    body: Decision,
) -> OnboardingBody:
    """Accept or dismiss recommendations once the team has confirmed how the system is run."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    applied = 0
    with transaction(connection) as cursor:
        confirmed = cursor.execute(
            "SELECT facts_confirmed FROM engagement_applications WHERE id = %s AND project_id = %s",
            (application_id, project_id),
        ).fetchone()
        if confirmed is None:
            raise OnboardingState("system changed")
        if not confirmed[0]:
            raise OnboardingState("confirm how the system is run first")
        rows = cursor.execute(
            """
            SELECT id, kind, control_id, library_key FROM system_recommendations
            WHERE application_id = %s AND project_id = %s AND id = ANY(%s)
              AND (status = 'PROPOSED'
                   OR (%s AND status = 'ACCEPTED' AND kind = 'EXCLUDE'))
            FOR UPDATE
            """,
            (application_id, project_id, body.ids, body.action == "KEEP"),
        ).fetchall()
        if len(rows) != len(set(body.ids)):
            raise OnboardingState("recommendations changed")
        if body.action == "KEEP" and any(str(row[1]) != "EXCLUDE" for row in rows):
            raise OnboardingState("recommendations changed")
        for rec_id, kind, control_id, library_key in rows:
            if body.action == "KEEP":
                # Tested after all: the control comes back, and the reliance is set aside
                # so a review does not recommend it again.
                _apply(cursor, organization_id, project_id, application_id, "INCLUDE",
                       control_id)  # fmt: skip
            elif body.action == "ACCEPT":
                _apply(
                    cursor,
                    organization_id,
                    project_id,
                    application_id,
                    str(kind),
                    control_id,
                    None if library_key is None else str(library_key),
                )
                applied += 1
            cursor.execute(
                """
                UPDATE system_recommendations
                SET status = %s, decided_by = %s, decided_at = clock_timestamp()
                WHERE id = %s
                """,
                ("ACCEPTED" if body.action == "ACCEPT" else "DISMISSED", principal.id, rec_id),
            )
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.system_scoping",
            {"action": body.action, "count": len(rows)},
        )  # fmt: skip
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def _apply(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    kind: str,
    control_id: Any,
    library_key: str | None = None,
) -> None:
    if kind == "INCLUDE":
        include_control(
            cursor,
            organization_id,
            project_id,
            application_id,
            None if control_id is None else UUID(str(control_id)),
            library_key,
        )
    elif kind == "EXCLUDE":
        cursor.execute(
            """
            UPDATE engagement_controls
            SET included = false, version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND project_id = %s AND engagement_application_id = %s
            """,
            (control_id, project_id, application_id),
        )
    # A CUEC gap is recorded by its decision; the controls stay as they are.


def _add_library_control(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    library_key: str,
) -> None:
    """Bring a library control into scope for this system, as the CUECs call for."""
    control = next((c for c in LIBRARY if c.key == library_key), None)
    if control is None or control.domain not in RECOMMENDABLE_DOMAINS:
        raise OnboardingState("recommendations changed")
    cursor.execute(
        """
        INSERT INTO engagement_controls (
            organization_id, project_id, library_key, library_version, control_ref, domain,
            title, risk, activity, frequency, nature, application_ids, test_attributes,
            pbc_items, template_key, agent_key, engagement_application_id
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
            [application_id],
            Json(list(control.test_attributes)),
            Json(list(control.pbc_items)),
            default_template(control.domain),
            DOMAIN_AGENTS[control.domain],
            application_id,
        ),
    )
    _reset_templates(cursor, project_id)


def register_system_scoping(
    app: FastAPI, settings: Settings, scheduler: object | None = None
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/onboarding/systems"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except OnboardingState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.post(f"{base}/{{application_id}}/review")
    def review_again(
        organization_id: UUID, project_id: UUID, application_id: UUID, request: Request
    ) -> OnboardingBody:
        def work(connection: psycopg.Connection[Any], principal: Principal) -> OnboardingBody:
            _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
            with transaction(connection) as cursor:
                found = cursor.execute(
                    "SELECT 1 FROM engagement_applications WHERE id = %s AND project_id = %s",
                    (application_id, project_id),
                ).fetchone()
                if found is None:
                    raise OnboardingState("system changed")
                request_review(cursor, organization_id, project_id, application_id, principal.id)
            return _snapshot(connection, organization_id, project_id)

        body = run(request, work)
        schedule_system_reviews(scheduler, [application_id])
        return body

    @app.patch(f"{base}/{{application_id}}/facts")
    def facts(
        organization_id: UUID,
        project_id: UUID,
        application_id: UUID,
        body: FactsUpdate,
        request: Request,
    ) -> OnboardingBody:
        result = run(
            request,
            lambda c, p: set_facts(c, p, organization_id, project_id, application_id, body),
        )
        schedule_system_reviews(scheduler, [application_id])
        return result

    @app.post(f"{base}/{{application_id}}/controls/add")
    def add_system_control(
        organization_id: UUID,
        project_id: UUID,
        application_id: UUID,
        body: AddControl,
        request: Request,
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: add_control(c, p, organization_id, project_id, application_id, body),
        )

    @app.post(f"{base}/{{application_id}}/controls/remove")
    def remove_system_control(
        organization_id: UUID,
        project_id: UUID,
        application_id: UUID,
        body: RemoveControl,
        request: Request,
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: remove_control(c, p, organization_id, project_id, application_id, body),
        )

    @app.post(f"{base}/{{application_id}}/recommendations/decide")
    def decide_recommendations(
        organization_id: UUID,
        project_id: UUID,
        application_id: UUID,
        body: Decision,
        request: Request,
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: decide(c, p, organization_id, project_id, application_id, body),
        )

    # The applicability wizard (milestone 8.10)

    from ai_workforce_api import system_applicability as wizard

    def act(
        request: Request,
        organization_id: UUID,
        project_id: UUID,
        work: Callable[[psycopg.Connection[Any], Principal], None],
        after: bool = False,
    ) -> OnboardingBody:
        def done(connection: psycopg.Connection[Any], principal: Principal) -> OnboardingBody:
            _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
            try:
                work(connection, principal)
            except wizard.ApplicabilityState as error:
                raise OnboardingState(error.detail) from None
            if after:
                reconcile_scope(connection, organization_id, project_id, principal.id)
            return _snapshot(connection, organization_id, project_id)

        return run(request, done)

    @app.patch(f"{base}/{{application_id}}/details")
    def system_details(
        organization_id: UUID,
        project_id: UUID,
        application_id: UUID,
        body: wizard.DetailsBody,
        request: Request,
    ) -> OnboardingBody:
        return act(
            request, organization_id, project_id,
            lambda c, p: wizard.update_details(
                c, organization_id, project_id, application_id, p.id, body
            ),
        )  # fmt: skip

    @app.put(f"{base}/{{application_id}}/applicability")
    def system_applicability(
        organization_id: UUID,
        project_id: UUID,
        application_id: UUID,
        body: wizard.SelectionBody,
        request: Request,
    ) -> OnboardingBody:
        return act(
            request, organization_id, project_id,
            lambda c, p: wizard.save_selection(
                c, organization_id, project_id, application_id, p.id, body
            ),
            after=True,
        )  # fmt: skip

    @app.post(f"{base}/{{application_id}}/soc-reports/upload")
    async def upload_soc_report(
        organization_id: UUID,
        project_id: UUID,
        application_id: UUID,
        request: Request,
        file_name: str = "",
    ) -> OnboardingBody:
        content = await request.body()
        if len(content) > wizard.MAX_REPORT_BYTES:
            raise HTTPException(status_code=413, detail="file is larger than 25 MB")
        if not content:
            raise HTTPException(status_code=422, detail="file is empty")
        content_type = request.headers.get("content-type", "")
        body = act(
            request, organization_id, project_id,
            lambda c, p: None if wizard.upload_report(
                c, organization_id, project_id, application_id, p.id, content, file_name,
                content_type,
            ) else None,
        )  # fmt: skip
        schedule_system_reviews(scheduler, [application_id])
        return body

    @app.post(f"{base}/soc-reports/{{report_id}}/remove")
    def remove_soc_report(
        organization_id: UUID, project_id: UUID, report_id: UUID, request: Request
    ) -> OnboardingBody:
        return act(
            request, organization_id, project_id,
            lambda c, p: wizard.remove_report(c, organization_id, project_id, report_id, p.id),
        )  # fmt: skip
