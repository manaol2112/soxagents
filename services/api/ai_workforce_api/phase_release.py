"""Phase-based release (master test plans, milestone E).

Every applicable phase's evidence is planned, and drafted, in advance. Requests are released
progressively: design and implementation with the test plan's approval; interim and the
roll-forward by a person's release of that phase for the control (`phase_releases`,
migration 0081). The agents never release a phase.

The platform recommends a release when the earlier phase is complete: interim once the
design workpaper is prepared, the roll-forward once interim testing is signed off (or, where
interim does not apply, once design is). A reviewer may release a phase before then, for one
control, with the reason recorded (decided by the product owner).

A released phase only lets its requests go for approval: each request is still approved,
and sent, by a person. Releasing never sends anything.
"""

from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_planning import PHASE_LABELS
from ai_workforce_api.evidence_plans import PlanState, _audit
from ai_workforce_api.settings import Settings

Released = Literal["INTERIM", "ROLLFORWARD"]
RELEASED_PHASES: tuple[Released, ...] = ("INTERIM", "ROLLFORWARD")
GATE_RELEASE: dict[str, str] = {
    "INTERIM": "release the interim phase first",
    "ROLLFORWARD": "release the roll-forward phase first",
}
_APPLIES = ("APPLICABLE", "CONDITIONAL")
_APPROVED = ("APPROVED", "CHANGES_PROPOSED")
PhaseStep = Literal[
    "NOT_APPLICABLE",
    "AWAITING_PLAN",
    "WAITING",
    "READY",
    "RELEASED",
    "COMPLETE",
]
STEP_LABELS: dict[str, str] = {
    "NOT_APPLICABLE": "Not applicable",
    "AWAITING_PLAN": "Waiting for the test plan",
    "WAITING": "Waiting for the earlier phase",
    "READY": "Ready to release",
    "RELEASED": "Released",
    "COMPLETE": "Complete",
}


def release_reason(
    connection: psycopg.Connection[Any], control_id: UUID, phase: str | None
) -> str | None:
    """Why the control's requests for an operating phase cannot go for approval yet, or
    None: the phase is released (or needs no release)."""
    if phase not in RELEASED_PHASES:
        return None
    row = connection.execute(
        "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s AND phase = %s",
        (control_id, phase),
    ).fetchone()
    return release_reason_from(row is not None, phase)


def release_reason_from(released: bool, phase: str | None) -> str | None:
    """release_reason from whether the phase is released for the control."""
    if phase not in RELEASED_PHASES:
        return None
    return None if released else GATE_RELEASE[phase]


def released_phases(connection: psycopg.Connection[Any], project_id: UUID) -> set[tuple[UUID, str]]:
    """Every (control, phase) released on the engagement, read once."""
    return {
        (UUID(str(row[0])), str(row[1]))
        for row in connection.execute(
            """
            SELECT r.engagement_control_id, r.phase FROM phase_releases r
            JOIN engagement_controls c ON c.id = r.engagement_control_id
            WHERE c.project_id = %s
            """,
            (project_id,),
        ).fetchall()
    }


class PhaseStatus(BaseModel):
    phase: Literal["DESIGN", "INTERIM", "ROLLFORWARD"]
    label: str
    applicability: str | None
    complete: bool
    step: PhaseStep
    step_label: str
    released_by: str | None = None
    released_at: datetime | None = None
    early: bool = False
    reason: str = ""
    # What it waits for, in words, when it is not ready.
    waiting_for: str = ""


class ControlPhases(BaseModel):
    control_id: UUID
    control_ref: str
    title: str
    application: str
    plan_status: str | None
    phases: list[PhaseStatus]


def _statuses(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> list[ControlPhases]:
    one = control_id is not None
    where = "c.project_id = %(p)s AND " + ("c.id = %(c)s" if one else "c.included")
    params = {"p": project_id, "c": control_id}
    controls = connection.execute(
        f"""
        SELECT c.id, c.control_ref, c.title, coalesce(a.name, ''), p.status
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        LEFT JOIN evidence_plans p ON p.engagement_control_id = c.id
        WHERE {where}
        ORDER BY c.control_ref, a.name
        """,
        params,
    ).fetchall()
    scope = "project_id = %(p)s" + (" AND engagement_control_id = %(c)s" if one else "")
    applicability: dict[tuple[UUID, str], str] = {
        (UUID(str(row[0])), str(row[1])): str(row[2])
        for row in connection.execute(
            f"SELECT engagement_control_id, phase, applicability FROM evidence_plan_phases "
            f"WHERE {scope}",
            params,
        ).fetchall()
    }
    designed = {
        UUID(str(row[0]))
        for row in connection.execute(
            f"SELECT engagement_control_id FROM workpapers WHERE {scope} AND stage = 'DESIGN' "
            "AND status = 'PREPARED'",
            params,
        ).fetchall()
    }
    tested = {
        UUID(str(row[0]))
        for row in connection.execute(
            f"SELECT engagement_control_id FROM test_sheets WHERE {scope} "
            "AND test_round_id IS NULL AND status = 'SIGNED_OFF'",
            params,
        ).fetchall()
    }
    rolled = {
        UUID(str(row[0]))
        for row in connection.execute(
            f"""
            SELECT DISTINCT ON (engagement_control_id) engagement_control_id
            FROM test_rounds WHERE {scope} AND kind = 'ROLLFORWARD' AND status = 'SIGNED_OFF'
            ORDER BY engagement_control_id, number DESC
            """,
            params,
        ).fetchall()
    }
    releases: dict[tuple[UUID, str], tuple[Any, ...]] = {
        (UUID(str(row[0])), str(row[1])): tuple(row[2:])
        for row in connection.execute(
            f"""
            SELECT r.engagement_control_id, r.phase, u.display_name, r.released_at, r.early,
                   r.reason
            FROM phase_releases r LEFT JOIN users u ON u.id = r.released_by
            WHERE r.{scope}
            """,
            params,
        ).fetchall()
    }
    found: list[ControlPhases] = []
    for cid, ref, title, application, plan_status in controls:
        control = UUID(str(cid))
        approved = plan_status in _APPROVED
        complete = {
            "DESIGN": control in designed,
            "INTERIM": control in tested,
            "ROLLFORWARD": control in rolled,
        }
        phases: list[PhaseStatus] = []
        for phase in ("DESIGN", "INTERIM", "ROLLFORWARD"):
            decided = applicability.get((control, phase))
            applies = decided in _APPLIES
            release = releases.get((control, phase))
            status = PhaseStatus(
                phase=phase,
                label=PHASE_LABELS[phase],
                applicability=decided,
                complete=complete[phase],
                step="NOT_APPLICABLE",
                step_label="",
            )
            if release is not None:
                status.released_by = None if release[0] is None else str(release[0])
                status.released_at, status.early, status.reason = (
                    release[1],
                    bool(release[2]),
                    str(release[3]),
                )
            if decided is None:
                status.step, status.waiting_for = "AWAITING_PLAN", "The control is not planned."
            elif not applies:
                status.step = "NOT_APPLICABLE"
            elif complete[phase]:
                status.step = "COMPLETE"
            elif phase == "DESIGN":
                status.step = "RELEASED" if approved else "AWAITING_PLAN"
                if not approved:
                    status.waiting_for = "Approve the test plan."
            elif release is not None:
                status.step = "RELEASED"
            elif not approved:
                status.step, status.waiting_for = "AWAITING_PLAN", "Approve the test plan."
            else:
                earlier = _earlier(phase, applicability, control, complete)
                status.step = "READY" if earlier is None else "WAITING"
                status.waiting_for = earlier or ""
            status.step_label = (
                "Released early"
                if status.step == "RELEASED" and status.early
                else STEP_LABELS[status.step]
            )
            phases.append(status)
        found.append(
            ControlPhases(
                control_id=control,
                control_ref=str(ref),
                title=str(title),
                application=str(application),
                plan_status=plan_status,
                phases=phases,
            )  # fmt: skip
        )
    return found


def _earlier(
    phase: str,
    applicability: dict[tuple[UUID, str], str],
    control: UUID,
    complete: dict[str, bool],
) -> str | None:
    """What the phase waits for before its release is recommended, or None when ready."""
    if not complete["DESIGN"]:
        return "Design and implementation testing is not complete."
    if phase == "ROLLFORWARD" and applicability.get((control, "INTERIM")) in _APPLIES:
        if not complete["INTERIM"]:
            return "Interim testing is not signed off."
    return None


class PhaseProgress(BaseModel):
    controls: list[ControlPhases]
    # How many controls are ready to release each phase, and how many have it released.
    ready: dict[str, int]
    released: dict[str, int]
    # What to do next, as the platform recommends it (never done for the reviewer).
    recommendation: str
    viewer_can_release: bool = False


def progress(connection: psycopg.Connection[Any], project_id: UUID) -> PhaseProgress:
    rows = _statuses(connection, project_id)
    ready: dict[str, int] = {phase: 0 for phase in RELEASED_PHASES}
    released: dict[str, int] = {phase: 0 for phase in RELEASED_PHASES}
    for row in rows:
        for item in row.phases:
            if item.phase in ready and item.step == "READY":
                ready[item.phase] += 1
            if item.phase in released and item.step in ("RELEASED", "COMPLETE"):
                released[item.phase] += 1
    recommendation = ""
    if ready["INTERIM"]:
        count = ready["INTERIM"]
        recommendation = (
            f"Design and implementation testing has been completed for {count} control"
            f"{'' if count == 1 else 's'}. The interim evidence requests are ready for review."
        )
    elif ready["ROLLFORWARD"]:
        count = ready["ROLLFORWARD"]
        recommendation = (
            f"Interim testing has been completed for {count} control"
            f"{'' if count == 1 else 's'}. The roll-forward evidence requests are ready for "
            "review."
        )
    return PhaseProgress(
        controls=rows, ready=ready, released=released, recommendation=recommendation
    )


def phase_statuses(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, ControlPhases]:
    """Every in-scope control's phases, by control (the controls register reads them)."""
    return {row.control_id: row for row in _statuses(connection, project_id)}


def phases_of(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> ControlPhases | None:
    found = _statuses(connection, project_id, control_id)
    return found[0] if found else None


class ReleaseBody(BaseModel):
    # Required (at least 20 characters) when the earlier phase is not complete.
    reason: str = Field(default="", max_length=1000)


def release(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    phase: Released,
    actor: UUID,
    body: ReleaseBody,
) -> bool:
    """A person releases the control's phase. Idempotent: a released phase stays as it was.
    Returns whether this call released it."""
    reason = " ".join(body.reason.split())
    with transaction(connection) as cursor:
        plan = cursor.execute(
            "SELECT status, revision FROM evidence_plans WHERE project_id = %s "
            "AND engagement_control_id = %s FOR UPDATE",
            (project_id, control_id),
        ).fetchone()
        if plan is None or str(plan[0]) not in _APPROVED:
            raise PlanState("approve the test plan first")
        if (
            cursor.execute(
                "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s AND phase = %s",
                (control_id, phase),
            ).fetchone()
            is not None
        ):
            return False
        status = phases_of(cursor.connection, project_id, control_id)
        current = (
            None
            if status is None
            else next((item for item in status.phases if item.phase == phase), None)
        )
        if current is None or current.step == "NOT_APPLICABLE":
            raise PlanState(f"the test plan says the {phase_word(phase)} phase does not apply")
        early = current.step != "READY"
        if early and len(reason) < 20:
            raise PlanState(
                f"{current.waiting_for} Say why the {phase_word(phase)} phase is released now."
            )
        cursor.execute(
            """
            INSERT INTO phase_releases (
                organization_id, project_id, engagement_control_id, phase, early, reason,
                plan_revision, released_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (organization_id, project_id, control_id, phase, early, reason, plan[1], actor),
        )
        _audit(
            cursor, organization_id, project_id, actor, "phase.released", "engagement_control",
            control_id, {"phase": phase, "early": early, "reason": reason},
        )  # fmt: skip
    return True


def phase_word(phase: str) -> str:
    return "roll-forward" if phase == "ROLLFORWARD" else phase.lower()


# Routes


class BatchRelease(BaseModel):
    """The controls a reviewer selected, each released on its own."""

    phase: Released
    control_ids: list[UUID] = Field(min_length=1, max_length=200)
    reason: str = Field(default="", max_length=1000)


class ReleaseOutcome(BaseModel):
    control_id: UUID
    control_ref: str
    released: bool
    detail: str


class BatchReleased(BaseModel):
    outcomes: list[ReleaseOutcome]
    released: int


def register_phase_release(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except PlanState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    def allowed(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID,
        project_id: UUID, action: Action,
    ) -> None:  # fmt: skip
        authorize(
            connection, principal=principal, action=action,
            organization_id=organization_id, project_id=project_id,
        )  # fmt: skip
        if action is not Action.TASK_READ and principal.kind is not PrincipalKind.USER:
            # An agent never releases a phase.
            raise NotVisible()

    def may_release(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID,
        project_id: UUID,
    ) -> bool:  # fmt: skip
        try:
            allowed(connection, principal, organization_id, project_id, Action.PROJECT_UPDATE)
        except Exception:
            return False
        return True

    def in_scope(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> str:
        row = connection.execute(
            "SELECT control_ref, included FROM engagement_controls WHERE id = %s "
            "AND project_id = %s",
            (control_id, project_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if not row[1]:
            raise PlanState("the control is out of scope")
        return str(row[0])

    @app.get(f"{base}/phase-progress")
    def read(organization_id: UUID, project_id: UUID, request: Request) -> PhaseProgress:
        def work(c: psycopg.Connection[Any], p: Principal) -> PhaseProgress:
            allowed(c, p, organization_id, project_id, Action.TASK_READ)
            body = progress(c, project_id)
            body.viewer_can_release = may_release(c, p, organization_id, project_id)
            return body

        return run(request, work)

    @app.post(f"{base}/controls/{{control_id}}/phases/{{phase}}/release")
    def release_one(
        organization_id: UUID, project_id: UUID, control_id: UUID, phase: Released,
        body: ReleaseBody, request: Request,
    ) -> ControlPhases:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> ControlPhases:
            allowed(c, p, organization_id, project_id, Action.PROJECT_UPDATE)
            in_scope(c, project_id, control_id)
            release(c, organization_id, project_id, control_id, phase, p.id, body)
            found = phases_of(c, project_id, control_id)
            assert found is not None
            return found

        return run(request, work)

    @app.post(f"{base}/phases/release")
    def release_many(
        organization_id: UUID, project_id: UUID, body: BatchRelease, request: Request
    ) -> BatchReleased:
        def work(c: psycopg.Connection[Any], p: Principal) -> BatchReleased:
            allowed(c, p, organization_id, project_id, Action.PROJECT_UPDATE)
            outcomes: list[ReleaseOutcome] = []
            for control_id in dict.fromkeys(body.control_ids):
                try:
                    ref = in_scope(c, project_id, control_id)
                except NotVisible, PlanState:
                    outcomes.append(ReleaseOutcome(
                        control_id=control_id, control_ref="", released=False,
                        detail="The control is not in scope.",
                    ))  # fmt: skip
                    continue
                try:
                    done = release(c, organization_id, project_id, control_id, body.phase,
                                   p.id, ReleaseBody(reason=body.reason))  # fmt: skip
                except PlanState as error:
                    outcomes.append(ReleaseOutcome(
                        control_id=control_id, control_ref=ref, released=False,
                        detail=error.detail,
                    ))  # fmt: skip
                    continue
                outcomes.append(ReleaseOutcome(
                    control_id=control_id, control_ref=ref, released=done,
                    detail="" if done else "Already released.",
                ))  # fmt: skip
            return BatchReleased(
                outcomes=outcomes, released=sum(1 for item in outcomes if item.released)
            )

        return run(request, work)
