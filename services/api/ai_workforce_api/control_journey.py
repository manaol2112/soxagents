"""The control's journey (workflow redesign, Milestone 0): where a control is in
Plan → Request → Test → Conclude → Review, the state of each testing phase, whether each
phase is ready to test, and everything still outstanding, derived once from the records the
controls register already builds and read by every page (docs/workflow-redesign.md, §4).

Nothing here decides anything or changes a record. The step is a map for the person, not a
gate: the gates stay where they are (plan approval, phase release, request approval,
population and sample acceptance, sign-off, independent review). The step never hides the
rest: the per-phase states and the blockers are always given with it (refinement A).

Where the journey and the register's older words disagree (`progress_of`, which reads a
control as concluded once its review is signed, even with a roll-forward round open), the
journey says so in `conflicts` rather than either being changed silently; the product owner
decides which stands.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel

from ai_workforce_api.evidence_planning import PHASE_LABELS

if TYPE_CHECKING:
    from ai_workforce_api.phase_release import ControlPhases, PhaseStatus
    from ai_workforce_api.test_rounds import RoundBody
    from ai_workforce_api.workspace import ControlRequest, ControlRow

# Who a step belongs to: the same words as workspace.Actor (which imports this module).
Actor = Literal["PREPARER", "APPROVER", "REVIEWER", "CLIENT", "AGENT", "NONE"]
Step = Literal["PLAN", "REQUEST", "TEST", "CONCLUDE", "REVIEW", "DONE"]
Phase = Literal["DESIGN", "INTERIM", "ROLLFORWARD", "RETEST", "REMEDIATION"]
# The testing phases in the order the work runs (workspace._PHASE_ORDER). Retest and
# remediation appear only once a deficiency opened them.
PHASES: tuple[Phase, ...] = ("DESIGN", "INTERIM", "ROLLFORWARD", "REMEDIATION", "RETEST")
PhaseState = Literal[
    "NOT_APPLICABLE",
    "AWAITING_PLAN",
    "PLANNED",
    "RELEASED",
    "REQUESTED",
    "RECEIVED",
    "TESTING",
    "RESULTS_TO_CONFIRM",
    "SIGNED_OFF",
    "REVIEWED",
]
PHASE_STATE_LABELS: dict[str, str] = {
    "NOT_APPLICABLE": "Not applicable",
    "AWAITING_PLAN": "Waiting for the test plan",
    "PLANNED": "Planned, not released",
    "RELEASED": "Released, evidence to request",
    "REQUESTED": "Evidence requested",
    "RECEIVED": "Evidence received",
    "TESTING": "Testing",
    "RESULTS_TO_CONFIRM": "Results to confirm",
    "SIGNED_OFF": "Signed off",
    "REVIEWED": "Reviewed",
}
_LABELS: dict[str, str] = {
    **PHASE_LABELS,
    "RETEST": "Remediation retest",
    "REMEDIATION": "Remediation",
}
# A phase in one of these states is still to be requested, or waits on the client.
_WAITING: frozenset[str] = frozenset({"PLANNED", "RELEASED", "REQUESTED"})
# A phase in one of these states is being tested, or its results decided.
_IN_TEST: frozenset[str] = frozenset({"RECEIVED", "TESTING", "RESULTS_TO_CONFIRM"})
_FINISHED: frozenset[str] = frozenset({"NOT_APPLICABLE", "SIGNED_OFF", "REVIEWED"})
_RECEIVED = ("RECEIVED", "CLOSED")
_OUT = ("SENT", "WAITING_FOR_RESPONSE", "PARTIALLY_RECEIVED", "OVERDUE", "ESCALATED")
_OPEN_ROUND = ("REQUESTED", "TESTING")
# Readiness states that stop interim testing for a reason other than the plan or the
# evidence (readiness.py); the control's readiness names the first thing in the way.
_NOT_READY = (
    "NEEDS_INFORMATION",
    "CONFLICT_REQUIRES_REVIEW",
    "PROCESS_UNDERSTANDING_INCOMPLETE",
    "EVIDENCE_PENDING",
)
# The step the register's stage (workspace.progress_of) corresponds to; RESULTS_TO_CONFIRM
# is Test while the sheet is open and Conclude once it is signed off.
STEP_OF_PROGRESS: dict[str, Step] = {
    "PLAN_TO_APPROVE": "PLAN",
    "TO_REQUEST": "REQUEST",
    "AWAITING_EVIDENCE": "REQUEST",
    "EVIDENCE_RECEIVED": "TEST",
    "READY_FOR_TESTING": "TEST",
    "AGENT_TESTING": "TEST",
    "RESULTS_TO_CONFIRM": "TEST",
    "AWAITING_REVIEW": "REVIEW",
    "REVIEW_NOTES": "REVIEW",
    "CONCLUDED": "DONE",
}


class NotFinal(BaseModel):
    """One reason a control's conclusion is not final (docs/workflow-integrity.md §2.1):
    what is outstanding, and the step and phase where it is resolved."""

    kind: Literal["PLAN", "DESIGN", "TESTING", "IMPACT", "REVIEW", "ROUND"]
    text: str
    step: Step
    phase: Phase | None = None


class Finality(BaseModel):
    # The audit opinion is complete and may be relied on: every required phase and round
    # is tested and independently reviewed, and no plan change awaits an impact
    # assessment. Derived, never stored; it reverses when new work arises.
    final: bool
    reasons: list[NotFinal]


@dataclass(frozen=True)
class RoundFacts:
    """One testing round as finality reads it (W2, W3): its own review, the plan-revision
    impact on its signed-off results, and whether its review covers its sheet's version."""

    kind: str
    status: str
    conclusion: str | None = None
    review_status: str | None = None
    # None: covered (or nothing to assess); PENDING: a reviewer's decision awaited;
    # OUTSTANDING: the revision differs or is unknown and no assessment is raised yet.
    impact: str | None = None
    sheet_version: int | None = None
    # The round review's recorded coverage (coverage.sheet_version), when signed.
    covered_version: int | None = None
    # A reviewer's coverage assessment says the review covers the current version.
    coverage_assessed: bool = False


@dataclass(frozen=True)
class FinalityFacts:
    """What finality is decided from, read once per engagement (finality_facts)."""

    plan_status: str | None
    approved_revision: int | None
    # Each phase's applicability from the approved plan (evidence_plan_phases).
    applicability: Mapping[str, str]
    design_prepared_at: datetime | None
    # The interim sheet (test_round_id IS NULL).
    sheet_status: str | None
    sheet_plan_revision: int | None
    sheet_signed_at: datetime | None
    review_status: str | None
    review_signed_at: datetime | None
    # Each round: kind, status, conclusion, and its own review's status (W2), or None.
    rounds: tuple[RoundFacts, ...]
    deficiency_statuses: tuple[str, ...]
    # W3: the interim sheet's version, what the signed review covered (control_reviews
    # .coverage), each prepared workpaper's version by stage, and the impact assessment
    # of the interim results against the approved revision: None (none needed or none
    # raised yet), PENDING, VALID, REPERFORM.
    sheet_version: int | None = None
    review_coverage: Mapping[str, Any] | None = None
    workpaper_versions: Mapping[str, int | None] | None = None
    impact_state: str | None = None
    # A reviewer's coverage assessment (W3 follow-up) covers the current sheet and
    # workpaper versions, so the signed review stands for them.
    coverage_assessed: bool = False


_APPROVED_PLAN = ("APPROVED", "CHANGES_PROPOSED")
_APPLIES = ("APPLICABLE", "CONDITIONAL")
_OPEN_ROUNDS = ("REQUESTED", "TESTING")


def _coverage_gaps(facts: FinalityFacts) -> list[NotFinal]:
    """What changed since the signed review recorded its coverage: the sheet's version or
    a prepared workpaper's version. Coverage recorded without a sheet version (backfilled
    from a review that never re-performed) is unknown, and unknown is outstanding."""
    coverage = facts.review_coverage or {}
    gaps: list[NotFinal] = []
    if facts.coverage_assessed:
        return gaps
    covered_version = coverage.get("sheet_version")
    if covered_version is None or (
        facts.sheet_version is not None and int(covered_version) != facts.sheet_version
    ):
        gaps.append(
            NotFinal(
                kind="REVIEW",
                text="Testing changed since the review covered it: review outstanding"
                if covered_version is not None
                else "The review did not record the testing version it covered: review outstanding",
                step="REVIEW",
                phase="INTERIM",
            )
        )
    covered_papers = {
        str(item.get("stage")): item.get("version")
        for item in coverage.get("workpapers", [])
        if isinstance(item, dict)
    }
    for stage, version in (facts.workpaper_versions or {}).items():
        if version is not None and covered_papers.get(stage) != version:
            gaps.append(
                NotFinal(
                    kind="REVIEW",
                    text=f"The {stage.lower()} workpaper changed since the review covered it: "
                    "review outstanding",
                    step="REVIEW",
                    phase="DESIGN" if stage == "DESIGN" else "INTERIM",
                )
            )
    return gaps


def finality(facts: FinalityFacts | None) -> Finality:
    """Whether the control's conclusion is final, and if not, why, in the order of the
    work. Required phases come from the approved plan's applicability; a round counts
    once it exists. Until the round reviews (W2) and the impact assessments (W3) exist,
    a signed round and a sheet whose plan revision is unknown or differs from the
    approved revision each keep the conclusion open, with the reason named (§8)."""
    reasons: list[NotFinal] = []
    if facts is None or facts.plan_status not in _APPROVED_PLAN:
        reasons.append(
            NotFinal(
                kind="PLAN", text="Test plan not approved at its current revision", step="PLAN"
            )
        )
    if facts is None:
        return Finality(final=False, reasons=reasons)
    applies = {phase: facts.applicability.get(phase) in _APPLIES for phase in PHASES}
    if applies["INTERIM"] or facts.sheet_status is not None:
        if facts.sheet_status != "SIGNED_OFF":
            reasons.append(
                NotFinal(
                    kind="TESTING",
                    text="Interim testing not signed off"
                    if facts.sheet_status == "OPEN"
                    else "Interim testing outstanding",
                    step="TEST" if facts.sheet_status == "OPEN" else "REQUEST",
                    phase="INTERIM",
                )
            )
        else:
            # Results count under the plan revision they were tested against, or once a
            # reviewer found a later revision does not affect them (VALID, W3).
            covered = facts.sheet_plan_revision is not None and (
                facts.sheet_plan_revision == facts.approved_revision
            )
            if not covered and facts.impact_state != "VALID":
                if facts.sheet_plan_revision is None:
                    text = (
                        "Plan revision the interim results were tested under is not "
                        "recorded: impact assessment "
                    )
                else:
                    text = (
                        "Test plan revised since the interim results were signed off: "
                        "impact assessment "
                    )
                text += (
                    "pending a reviewer's decision"
                    if facts.impact_state == "PENDING"
                    else "outstanding"
                )
                reasons.append(NotFinal(kind="IMPACT", text=text, step="REVIEW", phase="INTERIM"))
            if facts.review_status != "SIGNED_OFF":
                reasons.append(
                    NotFinal(
                        kind="REVIEW",
                        text="Independent review not signed off",
                        step="REVIEW",
                        phase="INTERIM",
                    )
                )
            elif (
                facts.sheet_signed_at is not None
                and facts.review_signed_at is not None
                and facts.sheet_signed_at > facts.review_signed_at
                and not facts.coverage_assessed
            ):
                reasons.append(
                    NotFinal(
                        kind="REVIEW",
                        text="Interim testing signed off after the review: review outstanding",
                        step="REVIEW",
                        phase="INTERIM",
                    )
                )
            elif facts.review_coverage is not None:
                # Version-specific coverage (W3): the review stands for the sheet version
                # and the workpaper versions it recorded, never for later ones.
                reasons.extend(_coverage_gaps(facts))
    if applies["DESIGN"]:
        if facts.design_prepared_at is None:
            reasons.append(
                NotFinal(
                    kind="DESIGN",
                    text="Design and implementation testing outstanding",
                    step="TEST",
                    phase="DESIGN",
                )
            )
        elif (
            facts.review_signed_at is not None
            and facts.design_prepared_at > facts.review_signed_at
            and not facts.coverage_assessed
        ):
            reasons.append(
                NotFinal(
                    kind="REVIEW",
                    text="Design workpaper prepared after the review signed off: review "
                    "outstanding",
                    step="REVIEW",
                    phase="DESIGN",
                )
            )
    for kind, phase, word in (
        ("ROLLFORWARD", "ROLLFORWARD", "roll-forward"),
        ("RETEST", "RETEST", "retest"),
    ):
        rounds = [r for r in facts.rounds if r.kind == kind and r.status != "CANCELLED"]
        if any(r.status in _OPEN_ROUNDS for r in rounds):
            testing = any(r.status == "TESTING" for r in rounds)
            reasons.append(
                NotFinal(
                    kind="ROUND",
                    text=f"{word.capitalize()} testing in progress"
                    if testing
                    else f"{word.capitalize()} requested, evidence outstanding",
                    step="TEST" if testing else "REQUEST",
                    phase=phase,  # type: ignore[arg-type]
                )
            )
        elif any(r.status == "SIGNED_OFF" for r in rounds):
            latest = [r for r in rounds if r.status == "SIGNED_OFF"][-1]
            # Its signed-off results under a plan since revised (W3) hold the conclusion
            # like the interim ones do.
            if latest.impact is not None:
                reasons.append(
                    NotFinal(
                        kind="IMPACT",
                        text=f"{word.capitalize()} results: impact assessment "
                        + (
                            "pending a reviewer's decision"
                            if latest.impact == "PENDING"
                            else "outstanding"
                        ),
                        step="REVIEW",
                        phase=phase,  # type: ignore[arg-type]
                    )
                )
            if latest.review_status != "SIGNED_OFF":
                # A prior review of the control never covers a later round (decision 3).
                reasons.append(
                    NotFinal(
                        kind="REVIEW",
                        text=f"Independent review of the {word} round outstanding",
                        step="REVIEW",
                        phase=phase,  # type: ignore[arg-type]
                    )
                )
            elif not latest.coverage_assessed and (
                latest.covered_version is None or latest.covered_version != latest.sheet_version
            ):
                reasons.append(
                    NotFinal(
                        kind="REVIEW",
                        text=f"{word.capitalize()} testing changed since its review covered it: "
                        "review outstanding"
                        if latest.covered_version is not None
                        else f"The {word} review did not record the testing version it "
                        "covered: review outstanding",
                        step="REVIEW",
                        phase=phase,  # type: ignore[arg-type]
                    )
                )
        elif kind == "ROLLFORWARD" and applies["ROLLFORWARD"]:
            reasons.append(
                NotFinal(
                    kind="ROUND",
                    text="Roll-forward testing outstanding",
                    step="REQUEST",
                    phase="ROLLFORWARD",
                )
            )
        elif kind == "RETEST" and "READY_FOR_RETEST" in facts.deficiency_statuses:
            reasons.append(
                NotFinal(kind="ROUND", text="Retest outstanding", step="REQUEST", phase="RETEST")
            )
    return Finality(final=not reasons, reasons=reasons)


def finality_facts(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, FinalityFacts]:
    """Every control's finality facts for the engagement, in one pass per table."""
    plans = {
        row[0]: (str(row[1]), row[2])
        for row in connection.execute(
            "SELECT engagement_control_id, status, approved_revision FROM evidence_plans "
            "WHERE project_id = %s",
            (project_id,),
        ).fetchall()
    }
    applicability: dict[UUID, dict[str, str]] = {}
    for control_id, phase, decided in connection.execute(
        "SELECT engagement_control_id, phase, applicability FROM evidence_plan_phases "
        "WHERE project_id = %s",
        (project_id,),
    ).fetchall():
        applicability.setdefault(control_id, {})[str(phase)] = str(decided)
    designed = {
        row[0]: row[1]
        for row in connection.execute(
            "SELECT engagement_control_id, max(prepared_at) FROM workpapers "
            "WHERE project_id = %s AND stage = 'DESIGN' AND status = 'PREPARED' GROUP BY 1",
            (project_id,),
        ).fetchall()
    }
    sheets = {
        row[0]: (str(row[1]), row[2], row[3], int(row[4]))
        for row in connection.execute(
            "SELECT engagement_control_id, status, plan_revision, signed_at, version "
            "FROM test_sheets WHERE project_id = %s AND test_round_id IS NULL",
            (project_id,),
        ).fetchall()
    }
    # The control's own review; the rounds' reviews travel with the rounds below.
    reviews = {
        row[0]: (str(row[1]), row[2], dict(row[3]) if isinstance(row[3], dict) else {})
        for row in connection.execute(
            "SELECT engagement_control_id, status, signed_at, coverage FROM control_reviews "
            "WHERE project_id = %s AND test_round_id IS NULL",
            (project_id,),
        ).fetchall()
    }
    papers: dict[UUID, dict[str, int | None]] = {}
    for control_id, stage, prepared_version in connection.execute(
        "SELECT engagement_control_id, stage, prepared_version FROM workpapers "
        "WHERE project_id = %s AND status = 'PREPARED'",
        (project_id,),
    ).fetchall():
        papers.setdefault(control_id, {})[str(stage)] = (
            None if prepared_version is None else int(prepared_version)
        )
    # The impact assessment of the interim results against the approved revision (W3).
    impact: dict[UUID, str] = {}
    for control_id, status in connection.execute(
        """
        SELECT a.engagement_control_id, a.status
        FROM plan_impact_assessments a
        JOIN test_sheet_signoffs o ON o.id = a.signoff_id AND o.reopened_at IS NULL
        JOIN evidence_plans p ON p.engagement_control_id = a.engagement_control_id
                             AND p.approved_revision = a.to_revision
        WHERE a.project_id = %s AND a.test_round_id IS NULL
        """,
        (project_id,),
    ).fetchall():
        impact[control_id] = str(status)
    rounds: dict[UUID, list[RoundFacts]] = {}
    for row in connection.execute(
        """
        SELECT r.engagement_control_id, r.kind, r.status, r.conclusion, v.status,
               v.coverage ->> 'sheet_version', s.version,
               (SELECT o.plan_revision FROM test_sheet_signoffs o
                WHERE o.test_sheet_id = s.id AND o.reopened_at IS NULL
                ORDER BY o.signed_at DESC LIMIT 1),
               (SELECT a.status FROM plan_impact_assessments a
                JOIN test_sheet_signoffs o2 ON o2.id = a.signoff_id AND o2.reopened_at IS NULL
                WHERE a.test_round_id = r.id AND a.to_revision = p.approved_revision
                ORDER BY a.created_at DESC LIMIT 1),
               p.approved_revision,
               EXISTS (SELECT 1 FROM review_coverage_assessments ca
                       WHERE ca.control_review_id = v.id AND ca.decision = 'COVERS'
                         AND ca.sheet_version = s.version)
        FROM test_rounds r
        LEFT JOIN control_reviews v ON v.test_round_id = r.id
        LEFT JOIN test_sheets s ON s.test_round_id = r.id
        LEFT JOIN evidence_plans p ON p.engagement_control_id = r.engagement_control_id
        WHERE r.project_id = %s ORDER BY r.number
        """,
        (project_id,),
    ).fetchall():
        status = str(row[2])
        plan_revision, assessment, approved = row[7], row[8], row[9]
        round_impact: str | None = None
        if (
            status == "SIGNED_OFF"
            and approved is not None
            and (plan_revision is None or int(plan_revision) != int(approved))
            and assessment != "VALID"
        ):
            round_impact = "PENDING" if assessment == "PENDING" else "OUTSTANDING"
        rounds.setdefault(row[0], []).append(
            RoundFacts(
                kind=str(row[1]),
                status=status,
                conclusion=None if row[3] is None else str(row[3]),
                review_status=None if row[4] is None else str(row[4]),
                impact=round_impact,
                sheet_version=None if row[6] is None else int(row[6]),
                covered_version=None if row[5] in (None, "") else int(row[5]),
                coverage_assessed=bool(row[10]),
            )
        )
    # A reviewer's coverage assessments of the control's own review (W3 follow-up).
    assessed: dict[UUID, list[tuple[int, dict[str, Any]]]] = {}
    for control_id, sheet_version, versions in connection.execute(
        """
        SELECT ca.engagement_control_id, ca.sheet_version, ca.workpaper_versions
        FROM review_coverage_assessments ca
        JOIN control_reviews v ON v.id = ca.control_review_id
        WHERE ca.project_id = %s AND ca.decision = 'COVERS' AND v.test_round_id IS NULL
        """,
        (project_id,),
    ).fetchall():
        assessed.setdefault(control_id, []).append(
            (int(sheet_version), dict(versions) if isinstance(versions, dict) else {})
        )
    deficiencies: dict[UUID, list[str]] = {}
    for control_id, status in connection.execute(
        "SELECT engagement_control_id, status FROM deficiencies "
        "WHERE project_id = %s AND engagement_control_id IS NOT NULL",
        (project_id,),
    ).fetchall():
        deficiencies.setdefault(control_id, []).append(str(status))
    controls = [
        row[0]
        for row in connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s", (project_id,)
        ).fetchall()
    ]
    found: dict[UUID, FinalityFacts] = {}
    for control_id in controls:
        plan = plans.get(control_id)
        sheet = sheets.get(control_id)
        review = reviews.get(control_id)
        found[control_id] = FinalityFacts(
            plan_status=None if plan is None else plan[0],
            approved_revision=None if plan is None else plan[1],
            applicability=applicability.get(control_id, {}),
            design_prepared_at=designed.get(control_id),
            sheet_status=None if sheet is None else sheet[0],
            sheet_plan_revision=None if sheet is None else sheet[1],
            sheet_signed_at=None if sheet is None else sheet[2],
            review_status=None if review is None else review[0],
            review_signed_at=None if review is None else review[1],
            rounds=tuple(rounds.get(control_id, [])),
            deficiency_statuses=tuple(deficiencies.get(control_id, [])),
            sheet_version=None if sheet is None else sheet[3],
            review_coverage=None if review is None or review[0] != "SIGNED_OFF" else review[2],
            workpaper_versions=papers.get(control_id),
            impact_state=impact.get(control_id),
            coverage_assessed=any(
                version == (sheet[3] if sheet is not None else None)
                and papers_match(assessed_papers, papers.get(control_id, {}))
                for version, assessed_papers in assessed.get(control_id, [])
            ),
        )
    return found


def papers_match(assessed: Mapping[str, Any], current: Mapping[str, int | None]) -> bool:
    """The workpaper versions a coverage assessment recorded are the current ones."""
    return {k: v for k, v in current.items() if v is not None} == {
        str(k): v for k, v in assessed.items() if v is not None
    }


class PhaseJourney(BaseModel):
    phase: Phase
    label: str
    state: PhaseState
    state_label: str
    # Testing may start or go on now (refinement B): the plan is approved at its current
    # revision, the phase is released, its evidence is received, the population and
    # samples are accepted, and nothing it depends on is open.
    ready_for_testing: bool
    # What stands in the way of testing it, in the order to resolve; empty once finished.
    blockers: list[str]
    released_early: bool = False


class ControlJourney(BaseModel):
    step: Step
    # The phase the step is about; None for Plan, Conclude, Review and Done.
    step_phase: Phase | None
    # The one thing that moves the control forward and whose it is: the register's own
    # next step, unchanged, so every page says the same thing.
    action: str
    actor: Actor
    phases: list[PhaseJourney]
    # Everything outstanding across the control, beyond the step: nothing is hidden.
    blockers: list[str]
    # Why earlier work is open again (a review note reopened the testing), or "".
    reopened: str
    # Results were signed off and the test plan changed since: they are not relied on
    # until the impact is assessed (refinement D).
    stale_results: bool
    # The conclusion is final (finality): complete and relied on. Done only then.
    final: bool
    not_final_because: list[str]
    # Where the register's older derivation disagrees with the journey, in words, for the
    # owner's decision; empty when they agree.
    conflicts: list[str]


def _request_state(requests: Sequence[ControlRequest]) -> str | None:
    """Where a phase's requests stand: None (none live), RELEASED (drafted or awaiting
    approval, nothing out), REQUESTED (out with the client), RECEIVED (all in)."""
    live = [r for r in requests if r.status != "CANCELLED"]
    if not live:
        return None
    if all(r.status in _RECEIVED for r in live):
        return "RECEIVED"
    if any(r.status in _OUT for r in live):
        return "REQUESTED"
    return "RELEASED"


def _round_state(
    status: str, request_status: str | None, review_status: str | None = None
) -> PhaseState:
    """A round's phase state from the round (test_rounds): its request's standing while it
    is requested, then its testing, then its own review (W2)."""
    if status == "SIGNED_OFF":
        return "REVIEWED" if review_status == "SIGNED_OFF" else "SIGNED_OFF"
    if status == "TESTING":
        return "TESTING"
    if request_status is None:
        return "PLANNED"
    if request_status in _RECEIVED:
        return "RECEIVED"
    if request_status in _OUT:
        return "REQUESTED"
    return "RELEASED"


def _latest(rounds: Sequence[RoundBody], kind: str) -> RoundBody | None:
    found = [r for r in rounds if r.kind == kind and r.status != "CANCELLED"]
    return max(found, key=lambda r: r.number) if found else None


def _status_of(phases: ControlPhases | None, phase: str) -> PhaseStatus | None:
    if phases is None:
        return None
    return next((item for item in phases.phases if item.phase == phase), None)


def _requests_by_phase(
    control: ControlRow, phases: ControlPhases | None
) -> dict[str, list[ControlRequest]]:
    """The control's live requests by the phase they serve. A request with no phase (a
    kickoff or legacy request) serves the first operating phase that applies."""
    applicable = {
        item.phase
        for item in (phases.phases if phases is not None else [])
        if item.step != "NOT_APPLICABLE"
    }
    default = next((p for p in ("INTERIM", "ROLLFORWARD", "DESIGN") if p in applicable), "INTERIM")
    found: dict[str, list[ControlRequest]] = {}
    for request in control.requests:
        if request.status == "CANCELLED":
            continue
        found.setdefault(request.phase or default, []).append(request)
    return found


def _interim_sheet_state(control: ControlRow) -> PhaseState | None:
    """Interim testing's state from its test sheet, which outranks its requests once it
    exists (a follow-up may still be out while testing goes on)."""
    if control.sheet_status == "SIGNED_OFF":
        return "SIGNED_OFF"
    if control.sheet_status == "OPEN":
        if control.sheet_left == "TESTING":
            return "TESTING"
        if control.sheet_left in ("DECIDE", "SIGN_OFF"):
            return "RESULTS_TO_CONFIRM"
        if control.sheet_left == "EVIDENCE":
            return "REQUESTED"
        return "RECEIVED"
    if control.test_status == "PROPOSED":
        # The population is read and samples proposed: evidence is in, testing has not begun.
        return "RECEIVED"
    return None


def _phase_state(
    control: ControlRow,
    phase: Phase,
    status: PhaseStatus | None,
    requests: Sequence[ControlRequest],
    rounds: Sequence[RoundBody],
) -> PhaseState | None:
    """The phase's state, or None for a round phase that was never opened."""
    reviewed = control.review_status == "SIGNED_OFF"
    if phase in ("RETEST",):
        latest = _latest(rounds, "RETEST")
        return (
            None
            if latest is None
            else _round_state(latest.status, latest.request_status, latest.review_status)
        )
    if phase == "REMEDIATION":
        if not requests:
            return None
        retest = _latest(rounds, "RETEST")
        if (
            retest is not None
            and retest.status == "SIGNED_OFF"
            and retest.conclusion == "EFFECTIVE"
        ):
            return "SIGNED_OFF"
        state = _request_state(requests)
        return "RELEASED" if state is None else state  # type: ignore[return-value]
    if phase == "ROLLFORWARD":
        latest = _latest(rounds, "ROLLFORWARD")
        if latest is not None:
            return _round_state(latest.status, latest.request_status, latest.review_status)
    step = None if status is None else status.step
    if step is None:
        # Not planned by phase (launched before phase planning): the plan decides.
        return "AWAITING_PLAN" if control.evidence_plan != "PLANNED" else "RELEASED"
    if step == "NOT_APPLICABLE":
        return "NOT_APPLICABLE"
    if step == "AWAITING_PLAN":
        return "AWAITING_PLAN"
    if step == "COMPLETE":
        return "REVIEWED" if reviewed else "SIGNED_OFF"
    if phase == "INTERIM":
        from_sheet = _interim_sheet_state(control)
        if from_sheet is not None:
            return "REVIEWED" if from_sheet == "SIGNED_OFF" and reviewed else from_sheet
    if step in ("WAITING", "READY"):
        return "PLANNED"
    from_requests = _request_state(requests)
    return "RELEASED" if from_requests is None else from_requests  # type: ignore[return-value]


def _phase_blockers(
    control: ControlRow,
    phase: Phase,
    state: PhaseState,
    status: PhaseStatus | None,
    requests: Sequence[ControlRequest],
    requirements: Mapping[str, int],
    rounds: Sequence[RoundBody] = (),
) -> list[str]:
    """Why the phase cannot be tested now (refinement B), in the order to resolve. A
    round's phase takes the round's own readiness (round_readiness.py, W4)."""
    if state in _FINISHED:
        return []
    if phase in ("ROLLFORWARD", "RETEST"):
        latest = _latest(rounds, phase)
        if latest is not None and latest.status in _OPEN_ROUND:
            return list(latest.readiness_blockers)
    blockers: list[str] = []
    if control.evidence_plan == "NONE":
        blockers.append("Plan the evidence")
    elif control.evidence_plan != "PLANNED":
        blockers.append(
            "Revise the test plan as the reviewer asked"
            if control.plan_changes_requested
            else "Approve the test plan"
        )
    elif control.readiness_state == "PLAN_NOT_APPROVED":
        blockers.append(control.readiness_blocker or "Approve the test plan at its revision")
    if not control.attributes_settled:
        blockers.append("Settle the control's attributes")
    if state == "PLANNED" and phase in ("INTERIM", "ROLLFORWARD"):
        # Not a gate on anything now: the platform recommends the release once the
        # earlier phase is complete, and a reviewer may release it earlier.
        waiting = status.waiting_for if status is not None else ""
        blockers.append(_not_released(waiting))
    if control.reconcile and phase == "INTERIM":
        blockers.append("Reconcile the kickoff draft with the evidence plan")
    dependent = requirements.get("AWAITING_DEPENDENCY", 0)
    if dependent:
        blockers.append(
            f"{dependent} evidence item{' waits' if dependent == 1 else 's wait'} on an "
            "earlier item"
        )
    outstanding = [r for r in requests if r.status != "CANCELLED" and r.status not in _RECEIVED]
    if outstanding and state in ("RELEASED", "REQUESTED"):
        out = [r for r in outstanding if r.status in _OUT]
        if out:
            late = any(r.status in ("OVERDUE", "ESCALATED") for r in out)
            blockers.append(
                f"{len(out)} request{'' if len(out) == 1 else 's'} not yet received"
                + (" (overdue)" if late else "")
            )
        else:
            blockers.append("Evidence requests not yet sent")
    elif state == "RELEASED" and not requests:
        planned = requirements.get("PLANNED", 0)
        blockers.append(
            f"{planned} evidence item{'' if planned == 1 else 's'} to request"
            if planned
            else "Evidence to request"
        )
    if phase == "INTERIM":
        if control.population_pending:
            blockers.append("Accept the population")
        if control.test_status == "PROPOSED":
            blockers.append("Approve the samples")
        if control.readiness_state in _NOT_READY and state in _IN_TEST | {"REQUESTED"}:
            words = control.readiness_blocker or control.readiness_label
            if words and words not in blockers:
                blockers.append(words)
    return blockers


# How far along a phase is; the step follows the open phase that is furthest along, and
# the conclusion and the review of the interim line of work outrank its testing.
_PROGRESS: dict[str, int] = {
    "PLANNED": 0,
    "RELEASED": 1,
    "REQUESTED": 2,
    "RECEIVED": 3,
    "TESTING": 4,
    "RESULTS_TO_CONFIRM": 5,
}
_CONCLUDING = 6
_REVIEWING = 7


_RELEASE_AFTER = {
    "Design and implementation testing is not complete.": "design and implementation testing "
    "is complete",
    "Interim testing is not signed off.": "interim testing is signed off",
}


def _not_released(waiting: str) -> str:
    """Why a phase is not released yet, as a recommendation rather than a block."""
    after = _RELEASE_AFTER.get(waiting)
    if after is not None:
        return (
            f"Not released yet: release is recommended once {after}; "
            "a reviewer may release it earlier"
        )
    if waiting:
        return f"Not released yet: {waiting.rstrip('.')}"
    return "Not released yet: a person releases this phase"


def _step(control: ControlRow, phases: Sequence[PhaseJourney]) -> tuple[Step, Phase | None]:
    """The step the control is at (docs §4.2): Plan until its plan is approved at its
    current revision; otherwise the open phase furthest along (an earlier phase still to
    request is outstanding, not the step); the conclusion or the review once interim
    testing is signed off, unless a review note reopened the testing; Done only when
    nothing applicable is open."""
    if control.evidence_plan != "PLANNED":
        return "PLAN", None
    in_hand = round_in_hand(control.not_final)
    if in_hand is not None and not (control.final or not control.not_final):
        return "TEST", in_hand.phase
    if control.conclusion != "NOT_CONCLUDED":
        # The opinion is reached: Done when final, else the first thing keeping it open
        # (the register's stage follows the same reason: workspace.progress_of).
        if control.final or not control.not_final:
            return "DONE", None
        first = leading_reason(control.not_final)
        return first.step, first.phase
    candidates: list[tuple[int, int, Step, Phase | None]] = []
    for index, item in enumerate(phases):
        if item.state in _WAITING or item.state in _IN_TEST:
            step: Step = "REQUEST" if item.state in _WAITING else "TEST"
            # Ties go to the earlier phase, so the key sorts later phases lower.
            candidates.append((_PROGRESS[item.state], -index, step, item.phase))
    signed = control.sheet_status == "SIGNED_OFF"
    if control.sheet_left == "DEFICIENCY" or (
        signed and control.review_status is None and control.conclusion == "NOT_CONCLUDED"
    ):
        candidates.append((_CONCLUDING, 0, "CONCLUDE", None))
    if control.review_status == "OPEN" and control.sheet_status != "OPEN":
        # A review note that reopened the sheet makes its testing the step again.
        candidates.append((_REVIEWING, 0, "REVIEW", None))
    if not candidates:
        return "CONCLUDE", None
    _rank, _tie, step, phase = max(candidates)
    return step, phase


def round_in_hand(reasons: Sequence[NotFinal]) -> NotFinal | None:
    """A roll-forward or retest round in testing: work already in hand, which leads the
    step, the register's stage and the next action before what waits on others (the
    interim review, the workpapers), whether or not the opinion is reached."""
    for reason in reasons:
        if reason.kind == "ROUND" and reason.step == "TEST":
            return reason
    return None


def leading_reason(reasons: Sequence[NotFinal]) -> NotFinal:
    """The reason that leads once the opinion is reached: the round in hand, else the
    first reason recorded. The step, the register's stage and the next action all follow
    it, so they never disagree."""
    return round_in_hand(reasons) or reasons[0]


def journey_of(
    control: ControlRow,
    phases: ControlPhases | None,
    rounds: Sequence[RoundBody] = (),
    requirements: Mapping[str, Mapping[str, int]] | None = None,
) -> ControlJourney:
    """The control's journey from its register row, its phase releases (phase_release),
    its rounds (test_rounds) and its evidence requirements by phase and status."""
    counts = requirements or {}
    by_phase = _requests_by_phase(control, phases)
    items: list[PhaseJourney] = []
    for phase in PHASES:
        status = _status_of(phases, phase)
        requests = by_phase.get(phase, [])
        state = _phase_state(control, phase, status, requests, rounds)
        if state is None:
            continue
        held = _phase_blockers(
            control, phase, state, status, requests, counts.get(phase, {}), rounds
        )
        items.append(
            PhaseJourney(
                phase=phase,
                label=_LABELS[phase],
                state=state,
                state_label=PHASE_STATE_LABELS[state],
                ready_for_testing=state not in _FINISHED and not held,
                blockers=held,
                released_early=bool(status is not None and status.early),
            )
        )
    step, step_phase = _step(control, items)
    signed = control.sheet_status == "SIGNED_OFF" or any(r.status == "SIGNED_OFF" for r in rounds)
    # Signed-off results under a plan since revised: stale until a reviewer's impact
    # assessment says they stand (W3), or while the revision awaits approval.
    stale = (signed and control.evidence_plan == "PROPOSED") or any(
        item.kind == "IMPACT" for item in control.not_final
    )
    # The sheet records why it was reopened (migration 0089); a sheet reopened before
    # that, while its review is open, is read as reopened by the review.
    reopened = (
        ""
        if control.sheet_status != "OPEN"
        else control.reopen_reason
        if control.reopened_from is not None
        else "The independent review reopened the testing"
        if control.review_status == "OPEN"
        else ""
    )
    blockers: list[str] = []
    if stale:
        blockers.append(
            "The test plan changed after results were signed off: assess the impact before "
            "relying on them"
        )
    if control.plan_changes_requested:
        blockers.append("The reviewer asked for changes to the test plan")
    if reopened:
        blockers.append(reopened)
    pending = sum(1 for r in control.requests if r.status == "APPROVAL_PENDING")
    if pending:
        blockers.append(f"{pending} request{'' if pending == 1 else 's'} awaiting approval to send")
    if control.overdue:
        blockers.append("Evidence overdue")
    for item in items:
        if item.phase != step_phase and item.state in _WAITING | _IN_TEST:
            blockers.append(f"{item.label}: {item.state_label.lower()}")
    if control.review_left in ("DECIDE", "ADDRESS", "CLEAR"):
        blockers.append("Review notes open")
    elif control.review_left in ("REPERFORM", "REPERFORMING"):
        blockers.append("Independent re-performance in progress")
    if control.deficiencies and step != "DONE":
        n = control.deficiencies
        blockers.append(f"{n} open deficienc{'y' if n == 1 else 'ies'}")
    conflicts: list[str] = []
    register = STEP_OF_PROGRESS.get(control.progress, "REQUEST")
    if control.progress == "RESULTS_TO_CONFIRM" and control.sheet_status == "SIGNED_OFF":
        register = "CONCLUDE"
    if register != step:
        where = f" ({_LABELS[step_phase].lower()})" if step_phase is not None else ""
        conflicts.append(
            f"The register reads the control as {control.progress.replace('_', ' ').lower()}; "
            f"the journey puts it at {step.title()}{where}"
        )
    return ControlJourney(
        step=step,
        step_phase=step_phase,
        action=control.next_step,
        actor=control.actor,
        phases=items,
        blockers=blockers,
        reopened=reopened,
        stale_results=stale,
        final=control.final,
        not_final_because=[item.text for item in control.not_final],
        conflicts=conflicts,
    )
