"""Phase-based release (master test plans, milestone E; D&I release, B1).

Every applicable phase's evidence is planned in advance. Requests are released
progressively, each phase by a person's release of it for the control (`phase_releases`,
migrations 0081 and 0145). The agents never release a phase.

- Design and implementation (D&I): its own release, once Control Understanding is complete
  (decided by the product owner on 8 November 2026) and the control's attributes are settled
  (11 November 2026: D&I is a test of one against the attributes, and the attributes decide
  the evidence asked for). It does not wait for the rest of the test plan (scope, sampling),
  and revising the plan does not hold it. Releasing it requests the Design phase's evidence
  items, and the release's audit record keeps the attributes they were requested against.
- Interim and the roll-forward: on an approved test plan, once the D&I conclusion is signed
  off effective (B0); the roll-forward once interim testing is signed off (or, where interim
  does not apply, once D&I is). Their requests are prepared in advance and go for approval
  once released.

The platform recommends a release when what comes before it is complete. A person may
release a phase before then, for one control, with the reason recorded.

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
from ai_workforce_api.evidence_plans import GATE_DESIGN_RELEASE, PlanState, _audit
from ai_workforce_api.settings import Settings

Released = Literal["DESIGN", "INTERIM", "ROLLFORWARD"]
RELEASED_PHASES: tuple[Released, ...] = ("DESIGN", "INTERIM", "ROLLFORWARD")
_OPERATING: tuple[str, ...] = ("INTERIM", "ROLLFORWARD")
GATE_RELEASE: dict[str, str] = {
    "DESIGN": GATE_DESIGN_RELEASE,
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


def understanding_waits(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, str]:
    """What each control's understanding still waits for, in a sentence; a control missing
    from the result is understood. Control Understanding is complete when every client value
    the control's statement asks is answered, no question on the control is open, for a
    business process control its process understanding is confirmed (as the workflow's
    Control Understanding step reads it), and every required walkthrough question asked for
    it has a confirmed answer (11 November 2026; walkthrough_answers). The walkthrough is
    checked last, so the earlier waits read as before; optional questions never hold it."""
    from ai_workforce_api.control_context import (
        classifications_of,
        needs_process_understanding,
    )
    from ai_workforce_api.control_design import unanswered_values
    from ai_workforce_api.walkthrough_answers import unanswered_required

    one = control_id is not None
    params = {"p": project_id, "c": control_id}
    which = "c.id = %(c)s" if one else "c.included"
    rows = connection.execute(
        f"""
        SELECT c.id, c.classifications, c.domain, c.nature, u.status,
               coalesce(c.library_key, ''), coalesce(c.frequency, '')
        FROM engagement_controls c
        LEFT JOIN process_understandings u ON u.engagement_control_id = c.id
        WHERE c.project_id = %(p)s AND {which}
        """,
        params,
    ).fetchall()
    questions = {
        UUID(str(row[0])): int(row[1])
        for row in connection.execute(
            "SELECT engagement_control_id, count(*) FROM control_context_issues "
            "WHERE project_id = %(p)s AND status = 'OPEN' GROUP BY 1",
            params,
        ).fetchall()
    }
    missing = unanswered_values(connection, project_id)
    # One read of the engagement's confirmed walkthrough answers (or the one control's).
    walkthrough = unanswered_required(
        connection,
        project_id,
        [(UUID(str(row[0])), str(row[5]), str(row[3] or ""), str(row[6])) for row in rows],
        control_id,
    )
    waits: dict[UUID, str] = {}
    for cid, classifications, domain, nature, understanding, _library, _frequency in rows:
        control = UUID(str(cid))
        if missing.get(control):
            count = missing[control]
            waits[control] = (
                f"Control Understanding is not complete: {count} question"
                f"{' is' if count == 1 else 's are'} not answered."
            )
        elif questions.get(control):
            count = questions[control]
            waits[control] = (
                f"Control Understanding is not complete: {count} question"
                f"{' is' if count == 1 else 's are'} open."
            )
        elif (
            needs_process_understanding(
                classifications_of(classifications, str(domain), str(nature or ""))
            )
            and understanding != "CONFIRMED"
        ):
            waits[control] = (
                "Control Understanding is not complete: the process understanding is not confirmed."
            )
        elif walkthrough.get(control):
            count = walkthrough[control]
            waits[control] = (
                f"Control Understanding is not complete: {count} walkthrough question"
                f"{' is' if count == 1 else 's are'} not answered."
            )
    return waits


def _counted(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


# An approved attribute's criteria that wait only for a person's acceptance, over
# control_attributes as `a`: the planner agent tailored them, or they were prepared with the
# demo, they are complete, and no person has accepted them. Accepting them owns them
# (control_attributes.CRITERIA_OWNED_SQL); any other unowned criteria (none at all, or a
# person's own left incomplete) still need tailoring.
_CRITERIA_TO_ACCEPT_SQL = """
    (a.criteria_origin IN ('AGENT', 'SEEDED') AND a.criteria_accepted_at IS NULL
     AND (a.judgment_required IS TRUE
          OR (a.condition <> '' AND a.pass_criteria <> '' AND a.fail_criteria <> '')))
"""


def attribute_waits(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, str]:
    """What each control's attributes still wait for, in a sentence; a control missing from
    the result has its attributes settled. The D&I evidence is a test of one against them
    (product owner, 11 November 2026), so its release is recommended only once they are.
    Settled is evidence_plans.ATTRIBUTES_SETTLED_SQL's rule (approved attributes, none
    proposed, no open question about them), read here with its counts, with the attribute
    agent not still at work on the control (its proposals would follow), and with every
    approved attribute's criteria tailored to the control and owned by a person
    (control_attributes.CRITERIA_OWNED_SQL): the testers judge evidence against them. Unowned
    criteria are worded by what they wait for: a person's acceptance (_CRITERIA_TO_ACCEPT_SQL),
    or tailoring. A narrative run holds the attributes while it waits, or works under a live
    lease (a WORKING run with no lease is held, as process_narrative never reclaims it); one
    whose lease ran out was interrupted and is reclaimed, so it holds nothing."""
    from ai_workforce_api.control_attributes import CRITERIA_OWNED_SQL

    one = control_id is not None
    params = {"p": project_id, "c": control_id}
    which = "c.id = %(c)s" if one else "c.included"
    rows = connection.execute(
        f"""
        SELECT c.id,
               (SELECT count(*) FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED'),
               (SELECT count(*) FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'PROPOSED'),
               (SELECT count(*) FROM control_context_issues i
                WHERE i.engagement_control_id = c.id AND i.status = 'OPEN'
                  AND i.origin IN ('ATTRIBUTES', 'SOURCES')),
               EXISTS (SELECT 1 FROM process_narrative_runs r
                       WHERE r.engagement_control_id = c.id
                         AND (r.run_status = 'PENDING'
                              OR (r.run_status = 'WORKING'
                                  AND (r.run_lease_until IS NULL
                                       OR r.run_lease_until >= clock_timestamp())))),
               (SELECT count(*) FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED'
                  AND NOT coalesce({CRITERIA_OWNED_SQL}, false)
                  AND coalesce({_CRITERIA_TO_ACCEPT_SQL}, false)),
               (SELECT count(*) FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED'
                  AND NOT coalesce({CRITERIA_OWNED_SQL}, false)
                  AND NOT coalesce({_CRITERIA_TO_ACCEPT_SQL}, false))
        FROM engagement_controls c
        WHERE c.project_id = %(p)s AND {which}
        """,
        params,
    ).fetchall()
    waits: dict[UUID, str] = {}
    for cid, approved, proposed, questions, working, to_accept, untailored in rows:
        control = UUID(str(cid))
        if working:
            waits[control] = "The attributes are not settled: the agent is still updating them."
        elif int(proposed) > 0:
            waits[control] = (
                f"The attributes are not settled: {_counted(int(proposed), 'proposed attribute')} "
                f"{'waits' if int(proposed) == 1 else 'wait'} for a decision."
            )
        elif int(questions) > 0:
            waits[control] = (
                f"The attributes are not settled: {_counted(int(questions), 'question')} about "
                f"them {'is' if int(questions) == 1 else 'are'} open."
            )
        elif int(approved) == 0:
            waits[control] = "The attributes are not settled: no attribute is approved."
        elif int(to_accept) > 0 or int(untailored) > 0:
            parts = []
            if int(to_accept) > 0:
                count = int(to_accept)
                parts.append(
                    f"{_counted(count, 'attribute')} {'has' if count == 1 else 'have'} "
                    "criteria to accept"
                )
            if int(untailored) > 0:
                count = int(untailored)
                parts.append(
                    f"{_counted(count, 'attribute')} {'needs' if count == 1 else 'need'} "
                    "criteria tailored to this control"
                )
            waits[control] = f"The attributes are not settled: {' and '.join(parts)}."
    return waits


def approved_attributes(connection: psycopg.Connection[Any], control_id: UUID) -> list[str]:
    """The control's approved attributes, in their order, as worded now."""
    return [
        str(row[0])
        for row in connection.execute(
            "SELECT text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position, created_at",
            (control_id,),
        ).fetchall()
    ]


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
    # What the D&I release waits on, for the screens that point to it: Control
    # Understanding, or the attributes (11 November 2026). Empty otherwise.
    waiting_on: Literal["", "UNDERSTANDING", "ATTRIBUTES"] = ""


class ControlPhases(BaseModel):
    control_id: UUID
    control_ref: str
    title: str
    application: str
    # The units it operates in, when split by them (Release 1).
    units: str = ""
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
    from ai_workforce_api.implementations import operating_names

    units = operating_names(connection, project_id)
    scope = "project_id = %(p)s" + (" AND engagement_control_id = %(c)s" if one else "")
    applicability: dict[tuple[UUID, str], str] = {
        (UUID(str(row[0])), str(row[1])): str(row[2])
        for row in connection.execute(
            f"SELECT engagement_control_id, phase, applicability FROM evidence_plan_phases "
            f"WHERE {scope}",
            params,
        ).fetchall()
    }
    # D&I is complete once its conclusion is signed off effective (B0, 8 November 2026).
    from ai_workforce_api.design_conclusions import effective_controls

    designed = effective_controls(connection, project_id, control_id if one else None)
    waits = understanding_waits(connection, project_id, control_id if one else None)
    unsettled = attribute_waits(connection, project_id, control_id if one else None)
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
            elif release is not None:
                status.step = "RELEASED"
            elif phase == "DESIGN":
                # Its own release, once the control is understood (B1) and its attributes
                # are settled (11 November 2026); never the plan's approval.
                if control in waits:
                    status.step, status.waiting_on = "WAITING", "UNDERSTANDING"
                    status.waiting_for = waits[control]
                elif control in unsettled:
                    status.step, status.waiting_on = "WAITING", "ATTRIBUTES"
                    status.waiting_for = unsettled[control]
                else:
                    status.step = "READY"
            elif not approved:
                status.step, status.waiting_for = "AWAITING_PLAN", "Approve the test plan."
            else:
                earlier = _earlier(phase, applicability, control, complete)
                status.step = "READY" if earlier is None else "WAITING"
                status.waiting_for = earlier or ""
            status.step_label = (
                "Released early"
                if status.step == "RELEASED" and status.early
                else "Waiting for understanding"
                if status.waiting_on == "UNDERSTANDING"
                else "Waiting for the attributes"
                if status.waiting_on == "ATTRIBUTES"
                else STEP_LABELS[status.step]
            )
            phases.append(status)
        found.append(
            ControlPhases(
                control_id=control,
                control_ref=str(ref),
                title=str(title),
                application=str(application),
                units=units.get(control, ""),
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
        return "The D&I conclusion is not signed off as effective."
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
    if ready["DESIGN"]:
        count = ready["DESIGN"]
        recommendation = (
            f"Control Understanding is complete for {count} control"
            f"{'' if count == 1 else 's'}. The D&I evidence is ready to release."
        )
    elif ready["INTERIM"]:
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
    Returns whether this call released it. The D&I evidence needs a plan, not its approval;
    an operating phase needs the approved plan and the D&I conclusion signed off effective."""
    reason = " ".join(body.reason.split())
    with transaction(connection) as cursor:
        plan = cursor.execute(
            "SELECT status, revision, run_status FROM evidence_plans WHERE project_id = %s "
            "AND engagement_control_id = %s FOR UPDATE",
            (project_id, control_id),
        ).fetchone()
        if plan is None:
            raise PlanState("plan the evidence first")
        if phase == "DESIGN" and str(plan[2]) in ("PENDING", "WORKING"):
            raise PlanState("The planner is still drafting the plan.")
        if phase != "DESIGN" and str(plan[0]) not in _APPROVED:
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
        if phase in _OPERATING:
            from ai_workforce_api.design_conclusions import oe_gate_reason

            gated = oe_gate_reason(cursor.connection, control_id)
            if gated is not None:
                raise PlanState(gated)
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
        payload: dict[str, Any] = {"phase": phase, "early": early, "reason": reason}
        if phase == "DESIGN":
            # What the D&I evidence is requested against, as worded at the release: a test
            # of one is judged against these attributes (11 November 2026).
            payload["attributes"] = approved_attributes(cursor.connection, control_id)
        _audit(
            cursor, organization_id, project_id, actor, "phase.released", "engagement_control",
            control_id, payload,
        )  # fmt: skip
    return True


def phase_word(phase: str) -> str:
    return {"DESIGN": "D&I", "ROLLFORWARD": "roll-forward"}.get(phase, phase.lower())


def request_released(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    phase: str,
    actor: UUID,
) -> list[UUID]:
    """After a D&I release, request the Design phase's evidence items and queue their drafts
    (evidence_plans.release). Each draft still goes for a person's approval before it is
    sent. An operating phase's requests are prepared already: nothing to request."""
    if phase != "DESIGN":
        return []
    from ai_workforce_api.evidence_plans import release as request_allowed

    return request_allowed(connection, organization_id, project_id, control_id, actor)


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


def register_phase_release(app: FastAPI, settings: Settings, scheduler: Any = None) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    def requested(
        connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID,
        control_id: UUID, phase: str, actor: UUID,
    ) -> None:  # fmt: skip
        """A D&I release requests the Design items; their drafts go to the background."""
        from ai_workforce_api.pbc_drafting import schedule

        schedule(
            scheduler,
            request_released(connection, organization_id, project_id, control_id, phase, actor),
        )

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
            requested(c, organization_id, project_id, control_id, phase, p.id)
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
                if done:
                    requested(c, organization_id, project_id, control_id, body.phase, p.id)
                outcomes.append(ReleaseOutcome(
                    control_id=control_id, control_ref=ref, released=done,
                    detail="" if done else "Already released.",
                ))  # fmt: skip
            return BatchReleased(
                outcomes=outcomes, released=sum(1 for item in outcomes if item.released)
            )

        return run(request, work)
