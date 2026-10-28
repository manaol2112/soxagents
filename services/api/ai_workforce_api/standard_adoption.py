"""Client controls following the firm's standards, decided together (decided by the product
owner on 25 October 2026).

A control imported from a client's RCM follows the client's own procedures until a person
decides its test basis (library_matching.py); with none documented, its plan falls back to
generic steps. So the rules match every imported control to the standards when the RCM is
imported, and a person confirms the strong matches as one grouped decision: each control
then follows its standard, its standard's attributes are proposed, and once the scope is
final it is planned again from the standard's procedures. A partial match, or none, stays
the client's for a person to decide on the control itself. Nothing is decided by the
rules: a match is a proposal until a person confirms it.

Matching here uses the rules only (no model is called for a whole RCM at once); the
control's own page can still ask the agent to adjudicate one control.
"""

import logging
from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.controls import BY_KEY
from ai_workforce_api.db import transaction
from ai_workforce_api.library_matching import (
    BasisWrite,
    MatchState,
    decide_basis,
    load_control,
    run_match,
)
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

MAX_CONTROLS = 500


class StandardMatch(BaseModel):
    control_id: UUID
    control_ref: str
    title: str
    system: str
    library_key: str
    standard_ref: str
    standard_title: str
    rationale: str


class MatchesBody(BaseModel):
    # The client's controls whose best match is strong, for one grouped decision.
    strong: list[StandardMatch]
    # How many of the client's undecided controls matched only partly, or not at all.
    partial: int
    none: int
    # The client's undecided controls the rules have not matched yet.
    unmatched: int


class AdoptBody(BaseModel):
    control_ids: list[UUID] = Field(min_length=1, max_length=MAX_CONTROLS)


class AdoptResult(BaseModel):
    adopted: int
    # Planned again from the standard now (the scope is final), or at finalization.
    replanned: bool


_UNDECIDED = """
    c.project_id = %s AND c.included AND c.source <> 'LIBRARY' AND c.test_basis IS NULL
"""


def match_client_controls(
    connection: psycopg.Connection[Any], project_id: UUID, actor: UUID
) -> int:
    """The rules match each of the client's undecided controls not matched yet. Returns
    how many were matched."""
    rows = connection.execute(
        f"""
        SELECT c.id FROM engagement_controls c
        WHERE {_UNDECIDED}
          AND NOT EXISTS (SELECT 1 FROM library_match_runs r WHERE r.engagement_control_id = c.id)
        ORDER BY c.control_ref
        LIMIT %s
        """,
        (project_id, MAX_CONTROLS),
    ).fetchall()
    matched = 0
    for (control_id,) in rows:
        facts = load_control(connection, UUID(str(control_id)))
        if facts is None:
            continue
        run_match(connection, None, facts, actor)
        matched += 1
    return matched


def matches(connection: psycopg.Connection[Any], project_id: UUID) -> MatchesBody:
    rows = connection.execute(
        f"""
        SELECT c.id, c.control_ref, c.title, coalesce(a.name, ''), m.library_key, m.status,
               m.rationale, r.id IS NOT NULL
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        LEFT JOIN library_match_runs r ON r.engagement_control_id = c.id
        LEFT JOIN library_matches m ON m.run_id = r.id AND m.rank = 1
        WHERE {_UNDECIDED}
        ORDER BY c.control_ref, a.name
        """,
        (project_id,),
    ).fetchall()
    strong: list[StandardMatch] = []
    partial = none = unmatched = 0
    for control_id, ref, title, system, key, status, rationale, ran in rows:
        if not ran:
            unmatched += 1
        elif status == "STRONG" and key in BY_KEY:
            standard = BY_KEY[str(key)]
            strong.append(
                StandardMatch(
                    control_id=control_id,
                    control_ref=str(ref),
                    title=str(title),
                    system=str(system),
                    library_key=str(key),
                    standard_ref=standard.control_ref,
                    standard_title=standard.title,
                    rationale=str(rationale or ""),
                )  # fmt: skip
            )
        elif status == "PARTIAL":
            partial += 1
        else:
            none += 1
    return MatchesBody(strong=strong, partial=partial, none=none, unmatched=unmatched)


def adopt_standards(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    control_ids: list[UUID],
) -> AdoptResult:
    """A person confirms strong matches together: each control follows its matched
    standard. Every control named is checked first: the client's, undecided, and strongly
    matched; otherwise none is decided. Planned again from the standard once the scope is final;
    before that, the finalization plans it."""
    from ai_workforce_api.scope_changes import scope_finalized

    wanted = list(dict.fromkeys(control_ids))
    keys = {item.control_id: item.library_key for item in matches(connection, project_id).strong}
    if any(control_id not in keys for control_id in wanted):
        raise MatchState("a control changed or no longer matches a standard strongly")
    replan = scope_finalized(connection, project_id)
    for control_id in wanted:
        facts = load_control(connection, control_id)
        if facts is None or facts.project_id != project_id:
            raise MatchState("a control changed")
        decide_basis(
            connection, facts, actor,
            BasisWrite(basis="STANDARD", library_key=keys[control_id],
                       note="Confirmed with the other strong matches to the firm's standards."),
            replan=replan,
        )  # fmt: skip
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'library.adopted_together', 'project', %s, %s)
            """,
            (organization_id, project_id, actor, project_id,
             Json({"controls": [str(item) for item in wanted]})),
        )  # fmt: skip
    return AdoptResult(adopted=len(wanted), replanned=replan)


def match_after_import(connection: psycopg.Connection[Any], project_id: UUID, actor: UUID) -> None:
    """An imported RCM is matched to the standards at once. A failure leaves the import as
    it is: the team matches from the Controls tab."""
    try:
        match_client_controls(connection, project_id, actor)
    except Exception:
        connection.rollback()
        logger.warning("the imported controls could not be matched to the standards")


def register_standard_adoption(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/standards"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except MatchState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    def allowed(
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
        if action is not Action.TASK_READ and principal.kind is not PrincipalKind.USER:
            raise AccessDenied()

    @app.get(f"{base}/matches")
    def read(organization_id: UUID, project_id: UUID, request: Request) -> MatchesBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> MatchesBody:
            allowed(c, p, organization_id, project_id, Action.TASK_READ)
            return matches(c, project_id)

        return run(request, work)

    @app.post(f"{base}/match")
    def match(organization_id: UUID, project_id: UUID, request: Request) -> MatchesBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> MatchesBody:
            allowed(c, p, organization_id, project_id, Action.PROJECT_UPDATE)
            match_client_controls(c, project_id, p.id)
            return matches(c, project_id)

        return run(request, work)

    @app.post(f"{base}/adopt")
    def adopt(
        organization_id: UUID, project_id: UUID, body: AdoptBody, request: Request
    ) -> AdoptResult:
        def work(c: psycopg.Connection[Any], p: Principal) -> AdoptResult:
            allowed(c, p, organization_id, project_id, Action.PROJECT_UPDATE)
            return adopt_standards(c, organization_id, project_id, p.id, body.control_ids)

        return run(request, work)
