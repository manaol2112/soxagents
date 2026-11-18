"""The control's journey (control_journey.py, workflow redesign Milestone 0): the step, each
phase's state and readiness, the outstanding blockers, reopened work and stale results, from
the records the register builds. The hard scenarios the product owner named (refinement E),
each as a synthetic row, and the invariants on a real engagement."""

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from support import Database
from test_control_progress import _controls
from test_engagement_data import _engagement
from test_outbound import migrated
from test_testing_engine import _base, _sheet
from test_workpapers import _tested_control
from test_workspace import _request, _row

from ai_workforce_api.control_journey import (
    PHASES,
    STEP_OF_PROGRESS,
    FinalityFacts,
    NotFinal,
    RoundFacts,
    finality,
    journey_of,
    leading_reason,
)
from ai_workforce_api.db import connect
from ai_workforce_api.phase_release import ControlPhases, PhaseStatus
from ai_workforce_api.test_rounds import RoundBody
from ai_workforce_api.workspace import StageBody, progress_of, step_of

__all__ = ["migrated"]

NOW = datetime(2026, 10, 16, tzinfo=UTC)
CONTROL = UUID("01a12985-c94d-73f6-8007-7d6130692f22")


def _phases(
    design: str = "RELEASED",
    interim: str = "RELEASED",
    rollforward: str = "WAITING",
    complete: tuple[bool, bool, bool] = (True, False, False),
    waiting_for: str = "",
    early: bool = False,
) -> ControlPhases:
    steps = {"DESIGN": design, "INTERIM": interim, "ROLLFORWARD": rollforward}
    done = dict(zip(("DESIGN", "INTERIM", "ROLLFORWARD"), complete, strict=True))
    return ControlPhases(
        control_id=CONTROL,
        control_ref="ITGC-AC-01",
        title="New user access is approved",
        application="SAP",
        plan_status="APPROVED",
        phases=[
            PhaseStatus(
                phase=phase,
                label=phase.title(),
                applicability="NOT_APPLICABLE"
                if steps[phase] == "NOT_APPLICABLE"
                else "APPLICABLE",
                complete=done[phase],
                # As phase_release reads it: a complete phase's step is COMPLETE.
                step="COMPLETE" if done[phase] else steps[phase],  # type: ignore[arg-type]
                step_label=steps[phase].title(),
                waiting_for=waiting_for if steps[phase] == "WAITING" else "",
                early=early and steps[phase] == "RELEASED",
            )
            for phase in ("DESIGN", "INTERIM", "ROLLFORWARD")
        ],
    )


def _round(
    kind: str,
    status: str,
    request_status: str | None = None,
    conclusion: str | None = None,
    review_status: str | None = None,
) -> RoundBody:
    return RoundBody(
        id=UUID("01a12990-0000-7000-8000-000000000001"),
        control_id=CONTROL,
        control_ref="ITGC-AC-01",
        kind=kind,  # type: ignore[arg-type]
        number=1,
        status=status,
        method="SAMPLE",
        window_start=date(2026, 10, 1),
        window_end=date(2026, 12, 31),
        test_from=date(2026, 10, 1),
        sample_size=2,
        deficiency_id=None,
        deficiency_reference=None,
        request_id=None if request_status is None else UUID("01a12990-0000-7000-8000-000000000002"),
        request_status=request_status,
        task_id=None,
        test_id=None,
        sheet_id=None,
        conclusion=conclusion,
        cancel_reason="",
        created_at=NOW,
        review_status=review_status,
    )


def _settled(stages: StageBody, **overrides: Any) -> Any:
    """A row with its register words worked out, as _controls does, so the journey's
    agreement with them can be checked."""
    row = _row(**overrides)
    step = step_of(row, stages, NOW)
    row.next_step, row.actor, row.overdue = step.text, step.actor, step.late
    row.progress = progress_of(row, stages, step)
    return row


def _states(journey: Any) -> dict[str, str]:
    return {item.phase: item.state for item in journey.phases}


IDLE = StageBody(walkthrough="READY", evidence="NONE", test="READY", review="READY")
TESTED = StageBody(walkthrough="SUCCEEDED", evidence="RECEIVED", test="SUCCEEDED", review="READY")
REVIEWED = StageBody(
    walkthrough="SUCCEEDED", evidence="RECEIVED", test="SUCCEEDED", review="SUCCEEDED"
)


def test_a_control_waits_at_plan_until_a_person_approves_its_plan() -> None:
    row = _settled(IDLE, evidence_plan="PROPOSED")
    journey = journey_of(
        row,
        _phases(
            design="AWAITING_PLAN",
            interim="AWAITING_PLAN",
            rollforward="AWAITING_PLAN",
            complete=(False, False, False),
        ),
    )
    assert (journey.step, journey.step_phase) == ("PLAN", None)
    assert journey.action == "Approve the test plan" == row.next_step
    assert set(_states(journey).values()) == {"AWAITING_PLAN"}
    assert not any(item.ready_for_testing for item in journey.phases)
    assert all(item.blockers == ["Approve the test plan"] for item in journey.phases)
    assert journey.conflicts == []


def test_overlapping_phases_interim_reviewed_while_the_roll_forward_is_tested() -> None:
    # The review is signed (the opinion is reached); a roll-forward round is being tested,
    # so the conclusion is not final and the register no longer reads it as concluded.
    row = _settled(
        REVIEWED,
        sheet_status="SIGNED_OFF",
        review_status="SIGNED_OFF",
        review_left="SIGNED",
        conclusion="EFFECTIVE",
        evidence_plan="PLANNED",
        not_final=[
            NotFinal(
                kind="ROUND",
                text="Roll-forward testing in progress",
                step="TEST",
                phase="ROLLFORWARD",
            )
        ],
    )
    assert row.progress == "READY_FOR_TESTING"
    assert row.next_step == "Finish the roll-forward testing and sign it off"
    journey = journey_of(
        row,
        _phases(rollforward="RELEASED", complete=(True, True, False)),
        [_round("ROLLFORWARD", "TESTING", "RECEIVED")],
    )
    assert (journey.step, journey.step_phase) == ("TEST", "ROLLFORWARD")
    assert _states(journey) == {
        "DESIGN": "REVIEWED",
        "INTERIM": "REVIEWED",
        "ROLLFORWARD": "TESTING",
    }
    assert journey.stale_results is False
    assert journey.final is False
    assert journey.not_final_because == ["Roll-forward testing in progress"]
    assert journey.conflicts == []


def test_the_roll_forward_waits_for_interim_testing_and_says_so() -> None:
    row = _settled(
        StageBody(walkthrough="SUCCEEDED", evidence="RECEIVED", test="RUNNING", review="READY"),
        sheet_status="OPEN",
        sheet_left="TESTING",
        testing_running=True,
        requests=[_request("EVIDENCE", "RECEIVED", phase="INTERIM")],
    )
    journey = journey_of(
        row, _phases(rollforward="WAITING", waiting_for="Interim testing is not signed off.")
    )
    assert (journey.step, journey.step_phase) == ("TEST", "INTERIM")
    rollforward = next(item for item in journey.phases if item.phase == "ROLLFORWARD")
    assert rollforward.state == "PLANNED" and rollforward.ready_for_testing is False
    assert rollforward.blockers == [
        "Not released yet: release is recommended once interim testing is signed off; a "
        "reviewer may release it earlier"
    ]
    # The later phase is outstanding beside the step, not hidden by it.
    assert "Roll-forward operating effectiveness: planned, not released" in journey.blockers
    assert journey.conflicts == []


def test_incomplete_and_overdue_evidence_hold_the_phase_from_testing() -> None:
    received = _request("EVIDENCE", "RECEIVED", phase="INTERIM")
    late = _request("EVIDENCE", "OVERDUE", phase="INTERIM")
    row = _settled(
        StageBody(walkthrough="SUCCEEDED", evidence="OVERDUE", test="READY", review="READY"),
        requests=[received, late],
    )
    journey = journey_of(
        row, _phases(), requirements={"INTERIM": {"REQUESTED": 2, "AWAITING_DEPENDENCY": 1}}
    )
    assert (journey.step, journey.step_phase) == ("REQUEST", "INTERIM")
    interim = next(item for item in journey.phases if item.phase == "INTERIM")
    assert interim.state == "REQUESTED" and interim.ready_for_testing is False
    assert interim.blockers == [
        "1 evidence item waits on an earlier item",
        "1 request not yet received (overdue)",
    ]
    assert "Evidence overdue" in journey.blockers
    assert journey.conflicts == []


def test_a_plan_revised_after_results_were_signed_off_marks_them_stale() -> None:
    # A material change sends the plan back to PROPOSED; the signed-off results stand in
    # the records. The journey returns to Plan and says the results need an impact
    # assessment; the register still reads results to confirm.
    row = _settled(
        TESTED,
        sheet_status="SIGNED_OFF",
        sheet_left=None,
        test_result="EFFECTIVE",
        evidence_plan="PROPOSED",
        readiness_state="READY_FOR_REVIEW",
    )
    journey = journey_of(row, _phases(complete=(True, True, False)))
    assert journey.step == "PLAN"
    assert journey.stale_results is True
    assert journey.blockers[0].startswith("The test plan changed after results were signed off")
    assert journey.conflicts, "the register does not see the stale results"


def test_a_review_note_that_reopens_the_testing_makes_test_the_step_again() -> None:
    row = _settled(
        StageBody(walkthrough="SUCCEEDED", evidence="RECEIVED", test="RUNNING", review="RUNNING"),
        sheet_status="OPEN",
        sheet_left="TESTING",
        review_status="OPEN",
        review_left="ADDRESS",
        requests=[_request("EVIDENCE", "RECEIVED", phase="INTERIM")],
    )
    assert row.progress == "REVIEW_NOTES"
    journey = journey_of(row, _phases(complete=(True, False, False)))
    assert (journey.step, journey.step_phase) == ("TEST", "INTERIM")
    assert journey.reopened == "The independent review reopened the testing"
    assert "Review notes open" in journey.blockers
    assert journey.conflicts and "review notes" in journey.conflicts[0]


def test_an_exception_with_a_proposed_deficiency_is_concluded_not_tested() -> None:
    row = _settled(
        TESTED,
        sheet_status="SIGNED_OFF",
        sheet_left="DEFICIENCY",
        test_result="NOT_EFFECTIVE",
        requests=[_request("EVIDENCE", "RECEIVED", phase="INTERIM")],
    )
    assert row.progress == "RESULTS_TO_CONFIRM"
    journey = journey_of(row, _phases(complete=(True, True, False)))
    assert (journey.step, journey.step_phase) == ("CONCLUDE", None)
    assert journey.action == "Log the proposed deficiency"
    assert _states(journey)["INTERIM"] == "SIGNED_OFF"
    assert journey.conflicts == []


def test_remediation_and_retest_appear_as_phases_only_once_opened() -> None:
    row = _settled(
        REVIEWED,
        sheet_status="SIGNED_OFF",
        test_result="NOT_EFFECTIVE",
        review_status="SIGNED_OFF",
        review_left="SIGNED",
        conclusion="EXCEPTION",
        deficiencies=1,
        not_final=[
            NotFinal(
                kind="ROUND",
                text="Retest requested, evidence outstanding",
                step="REQUEST",
                phase="RETEST",
            )
        ],
        requests=[
            _request("EVIDENCE", "RECEIVED", phase="INTERIM"),
            _request("EVIDENCE", "SENT", phase="REMEDIATION"),
        ],
    )
    before = journey_of(row, _phases(rollforward="NOT_APPLICABLE", complete=(True, True, False)))
    assert [item.phase for item in before.phases] == [
        "DESIGN",
        "INTERIM",
        "ROLLFORWARD",
        "REMEDIATION",
    ]
    journey = journey_of(
        row,
        _phases(rollforward="NOT_APPLICABLE", complete=(True, True, False)),
        [_round("RETEST", "REQUESTED", "SENT")],
    )
    assert _states(journey)["RETEST"] == "REQUESTED"
    assert _states(journey)["REMEDIATION"] == "REQUESTED"
    assert journey.step == "REQUEST" and journey.step_phase in ("RETEST", "REMEDIATION")
    assert "1 open deficiency" in journey.blockers
    # The retest signed off effective closes the remediation too.
    fixed = journey_of(
        row,
        _phases(rollforward="NOT_APPLICABLE", complete=(True, True, False)),
        [_round("RETEST", "SIGNED_OFF", "RECEIVED", "EFFECTIVE")],
    )
    assert _states(fixed)["RETEST"] == "SIGNED_OFF"
    assert _states(fixed)["REMEDIATION"] == "SIGNED_OFF"


def test_a_concluded_control_with_nothing_outstanding_is_done() -> None:
    row = _settled(
        REVIEWED,
        sheet_status="SIGNED_OFF",
        test_result="EFFECTIVE",
        review_status="SIGNED_OFF",
        review_left="SIGNED",
        conclusion="EFFECTIVE",
        final=True,
        requests=[_request("EVIDENCE", "RECEIVED", phase="INTERIM")],
    )
    journey = journey_of(
        row,
        _phases(rollforward="RELEASED", complete=(True, True, True)),
        [_round("ROLLFORWARD", "SIGNED_OFF", "RECEIVED", "EFFECTIVE", "SIGNED_OFF")],
    )
    assert (journey.step, journey.step_phase) == ("DONE", None)
    assert _states(journey)["ROLLFORWARD"] == "REVIEWED"
    assert journey.final is True and journey.not_final_because == []
    assert set(_states(journey).values()) <= {"REVIEWED", "SIGNED_OFF"}
    assert journey.blockers == [] and journey.conflicts == []
    assert not any(item.ready_for_testing for item in journey.phases)


def test_a_round_in_testing_leads_the_step_and_the_action_once_the_opinion_is_reached() -> None:
    """Interim concluded not effective, its review open, and the retest round in testing:
    the work in hand (the retest) is the step, the register's stage and the next action,
    not the review that waits on the reviewer; the review stays outstanding."""
    reasons = [
        NotFinal(kind="REVIEW", text="Independent review not signed off", step="REVIEW"),
        NotFinal(
            kind="DESIGN",
            text="Design and implementation testing outstanding",
            step="TEST",
            phase="DESIGN",
        ),
        NotFinal(kind="ROUND", text="Retest testing in progress", step="TEST", phase="RETEST"),
    ]
    assert leading_reason(reasons).kind == "ROUND"
    assert leading_reason(reasons[:2]).kind == "REVIEW"
    row = _settled(
        REVIEWED,
        sheet_status="SIGNED_OFF",
        test_result="NOT_EFFECTIVE",
        review_status="OPEN",
        review_left="REPERFORMING",
        conclusion="EXCEPTION",
        deficiencies=1,
        not_final=reasons,
        requests=[
            _request("EVIDENCE", "RECEIVED", phase="INTERIM"),
            _request("EVIDENCE", "RECEIVED", phase="REMEDIATION"),
        ],
    )
    journey = journey_of(
        row,
        _phases(rollforward="NOT_APPLICABLE", complete=(True, True, False)),
        [_round("RETEST", "TESTING", "RECEIVED")],
    )
    assert (journey.step, journey.step_phase) == ("TEST", "RETEST")
    assert "Independent review not signed off" in journey.not_final_because
    assert journey.final is False
    assert row.progress == "READY_FOR_TESTING"
    assert (row.next_step, row.actor) == ("Finish the retest testing and sign it off", "PREPARER")
    # Before the opinion is reached too: interim signed off, its workpapers not prepared,
    # the retest in testing. The retest leads; the workpapers stay outstanding.
    before = _settled(
        REVIEWED,
        sheet_status="SIGNED_OFF",
        test_result="NOT_EFFECTIVE",
        conclusion="NOT_CONCLUDED",
        deficiencies=1,
        not_final=reasons[1:],
        requests=[
            _request("EVIDENCE", "RECEIVED", phase="INTERIM"),
            _request("EVIDENCE", "RECEIVED", phase="REMEDIATION"),
        ],
    )
    early = journey_of(
        before,
        _phases(rollforward="NOT_APPLICABLE", complete=(True, True, False)),
        [_round("RETEST", "TESTING", "RECEIVED")],
    )
    assert (early.step, early.step_phase) == ("TEST", "RETEST")
    assert before.progress == "READY_FOR_TESTING"
    assert before.next_step == "Finish the retest testing and sign it off"


def test_the_journey_agrees_with_the_register_wherever_it_does_not_report_a_conflict() -> None:
    draft = StageBody(walkthrough="READY", evidence="DRAFTED", test="READY", review="READY")
    out = StageBody(walkthrough="READY", evidence="REQUESTED", test="READY", review="READY")
    cases = [
        (_settled(IDLE, evidence_plan="PROPOSED"), _phases(interim="AWAITING_PLAN")),
        (_settled(IDLE), _phases()),
        (_settled(draft, requests=[_request("EVIDENCE", "DRAFT")]), _phases()),
        (_settled(out, requests=[_request("EVIDENCE", "SENT")]), _phases()),
        (
            _settled(
                StageBody(walkthrough="READY", evidence="RECEIVED", test="READY", review="READY"),
                requests=[_request("EVIDENCE", "RECEIVED")],
            ),
            _phases(),
        ),
        (
            _settled(
                StageBody(walkthrough="READY", evidence="RECEIVED", test="RUNNING", review="READY"),
                sheet_status="OPEN",
                sheet_left="TESTING",
                testing_running=True,
            ),
            _phases(),
        ),
        (_settled(TESTED, sheet_status="OPEN", sheet_left="DECIDE"), _phases()),
        (
            _settled(TESTED, sheet_status="SIGNED_OFF", sheet_left="DEFICIENCY"),
            _phases(complete=(True, True, False)),
        ),
        (
            _settled(
                StageBody(
                    walkthrough="SUCCEEDED", evidence="RECEIVED", test="SUCCEEDED", review="RUNNING"
                ),
                sheet_status="SIGNED_OFF",
                review_status="OPEN",
                review_left="DECIDE",
            ),
            _phases(rollforward="NOT_APPLICABLE", complete=(True, True, False)),
        ),
        (
            _settled(
                REVIEWED,
                sheet_status="SIGNED_OFF",
                review_status="SIGNED_OFF",
                review_left="SIGNED",
                conclusion="EFFECTIVE",
                final=True,
            ),
            _phases(rollforward="NOT_APPLICABLE", complete=(True, True, False)),
        ),
    ]
    for row, phases in cases:
        journey = journey_of(row, phases)
        expected = STEP_OF_PROGRESS[row.progress]
        if row.progress == "RESULTS_TO_CONFIRM" and row.sheet_status == "SIGNED_OFF":
            expected = "CONCLUDE"
        assert journey.conflicts == [], (row.progress, journey.step, journey.conflicts)
        assert journey.step == expected, (row.progress, journey.step)
        assert journey.action == row.next_step
        # Every phase appears once, in the order of the work.
        order = [item.phase for item in journey.phases]
        assert order == [p for p in PHASES if p in order] and len(set(order)) == len(order)


def test_every_control_on_an_engagement_has_a_journey_that_matches_its_row(
    migrated: Database,
) -> None:
    team, client = _engagement(migrated, "journey")
    rows = _controls(client, team)
    assert rows
    for row in rows.values():
        if not row["included"]:
            continue
        journey = row["journey"]
        assert journey is not None, row["control_ref"]
        assert journey["action"] == row["next_step"]
        assert journey["actor"] == row["actor"]
        phases = [item["phase"] for item in journey["phases"]]
        assert phases == [p for p in PHASES if p in phases]
        # Every live request is counted in one phase the journey lists.
        for request in row["requests"]:
            if request["status"] != "CANCELLED":
                assert request["phase"] is None or request["phase"] in phases
        expected = STEP_OF_PROGRESS[row["progress"]]
        if journey["conflicts"]:
            assert journey["step"] != expected
        else:
            assert journey["step"] == expected, (row["control_ref"], journey)
    sent = next(row for row in rows.values() if row["control_ref"] == "ITGC-AC-01")
    journey = sent["journey"]
    assert (journey["step"], journey["step_phase"]) == ("REQUEST", "INTERIM")
    interim = next(item for item in journey["phases"] if item["phase"] == "INTERIM")
    assert interim["state"] == "REQUESTED" and interim["ready_for_testing"] is False
    assert any("not yet received" in blocker for blocker in interim["blockers"])


def test_signed_off_results_are_stale_once_the_plan_is_revised(migrated: Database) -> None:
    team, client, _sheet, _file = _tested_control(migrated, "journey-stale")
    rows = _controls(client, team)
    tested = next(row for row in rows.values() if row["control_ref"] == "ITGC-AC-01")
    journey = tested["journey"]
    assert tested["sheet_status"] == "SIGNED_OFF"
    assert journey["step"] == "CONCLUDE" and journey["stale_results"] is False
    interim = next(item for item in journey["phases"] if item["phase"] == "INTERIM")
    assert interim["state"] == "SIGNED_OFF" and interim["ready_for_testing"] is False
    # A material change to the approved plan, as the revision triggers make it.
    with connect(migrated.url) as connection:
        plan_id = connection.execute(
            "SELECT id FROM evidence_plans WHERE engagement_control_id = %s", (tested["id"],)
        ).fetchone()
        assert plan_id is not None
        connection.execute("SELECT revise_evidence_plan(%s)", (plan_id[0],))
        connection.commit()
    after = _controls(client, team)[tested["id"]]
    journey = after["journey"]
    assert after["evidence_plan"] == "PROPOSED"
    assert journey["step"] == "PLAN" and journey["stale_results"] is True
    assert journey["blockers"][0].startswith("The test plan changed after results were signed off")
    # Today's readiness still reads the control as ready for review: the inconsistency the
    # milestone reports, not one it changes.
    assert after["readiness_state"] == "READY_FOR_REVIEW"
    assert journey["conflicts"]


# Finality (workflow integrity W1): the conclusion is final only when every required
# phase and round is tested and independently reviewed and no plan change awaits an
# impact assessment. Derived from facts, never stored.

T1 = datetime(2026, 10, 1, tzinfo=UTC)
T2 = datetime(2026, 10, 5, tzinfo=UTC)
T3 = datetime(2026, 10, 9, tzinfo=UTC)
LATER = datetime(2026, 10, 12, tzinfo=UTC)
ROLLED = {"DESIGN": "APPLICABLE", "INTERIM": "APPLICABLE", "ROLLFORWARD": "APPLICABLE"}


def _facts(**overrides: Any) -> FinalityFacts:
    values: dict[str, Any] = {
        "plan_status": "APPROVED",
        "approved_revision": 2,
        "applicability": {
            "DESIGN": "APPLICABLE",
            "INTERIM": "APPLICABLE",
            "ROLLFORWARD": "NOT_APPLICABLE",
        },
        "design_prepared_at": T1,
        "sheet_status": "SIGNED_OFF",
        "sheet_plan_revision": 2,
        "sheet_signed_at": T2,
        "review_status": "SIGNED_OFF",
        "review_signed_at": T3,
        "rounds": (),
        "deficiency_statuses": (),
    }
    values.update(overrides)
    return FinalityFacts(**values)


def _texts(facts: FinalityFacts | None) -> list[str]:
    return [item.text for item in finality(facts).reasons]


def test_a_conclusion_is_final_only_when_everything_required_is_tested_and_reviewed() -> None:
    assert finality(_facts()).final is True
    # Required phases come from the plan: a late start with no interim is final too.
    late = {"DESIGN": "APPLICABLE", "INTERIM": "NOT_APPLICABLE"}
    assert finality(_facts(applicability=late, sheet_status=None)).final is True
    # With exceptions as well: finality is not an effective opinion.
    assert finality(_facts(deficiency_statuses=("OPEN",))).final is True
    assert _texts(None) == ["Test plan not approved at its current revision"]
    assert _texts(_facts(plan_status="PROPOSED"))[0] == (
        "Test plan not approved at its current revision"
    )
    assert _texts(_facts(design_prepared_at=None)) == [
        "Design and implementation testing outstanding"
    ]
    assert _texts(_facts(sheet_status="OPEN")) == ["Interim testing not signed off"]
    assert _texts(_facts(sheet_status=None)) == ["Interim testing outstanding"]
    assert _texts(_facts(review_status=None)) == ["Independent review not signed off"]


def test_plan_revision_coverage_and_later_work_keep_a_conclusion_open() -> None:
    # The revision the results were tested under is unknown (signed before W1) or older
    # than the approved plan: an impact assessment is outstanding (W3), never assumed valid.
    assert _texts(_facts(sheet_plan_revision=None))[0].endswith("impact assessment outstanding")
    assert _texts(_facts(sheet_plan_revision=1)) == [
        "Test plan revised since the interim results were signed off: impact assessment outstanding"
    ]
    # Work after the review: a re-signed sheet or a design workpaper prepared later.
    assert _texts(_facts(sheet_signed_at=LATER)) == [
        "Interim testing signed off after the review: review outstanding"
    ]
    assert _texts(_facts(design_prepared_at=LATER)) == [
        "Design workpaper prepared after the review signed off: review outstanding"
    ]


def test_rounds_keep_a_conclusion_open_until_tested_and_reviewed() -> None:
    assert _texts(_facts(applicability=ROLLED)) == ["Roll-forward testing outstanding"]
    requested = (RoundFacts("ROLLFORWARD", "REQUESTED"),)
    assert _texts(_facts(applicability=ROLLED, rounds=requested)) == [
        "Roll-forward requested, evidence outstanding"
    ]
    testing = (RoundFacts("ROLLFORWARD", "TESTING"),)
    assert _texts(_facts(applicability=ROLLED, rounds=testing)) == [
        "Roll-forward testing in progress"
    ]
    # Signed without a review of its own (before W2, or not yet opened): outstanding.
    signed = (RoundFacts("ROLLFORWARD", "SIGNED_OFF", conclusion="EFFECTIVE"),)
    assert _texts(_facts(applicability=ROLLED, rounds=signed)) == [
        "Independent review of the roll-forward round outstanding"
    ]
    # Signed and reviewed, the review recording the sheet version it covered: covered
    # (W2, W3); a review that recorded no version is unknown, and unknown is outstanding.
    reviewed = (
        RoundFacts(
            "ROLLFORWARD",
            "SIGNED_OFF",
            conclusion="EFFECTIVE",
            review_status="SIGNED_OFF",
            sheet_version=3,
            covered_version=3,
        ),
    )
    assert _texts(_facts(applicability=ROLLED, rounds=reviewed)) == []
    opened = (
        RoundFacts("ROLLFORWARD", "SIGNED_OFF", conclusion="EFFECTIVE", review_status="OPEN"),
    )
    assert _texts(_facts(applicability=ROLLED, rounds=opened)) == [
        "Independent review of the roll-forward round outstanding"
    ]
    cancelled = (RoundFacts("ROLLFORWARD", "CANCELLED"),)
    assert _texts(_facts(applicability=ROLLED, rounds=cancelled)) == [
        "Roll-forward testing outstanding"
    ]
    assert _texts(_facts(deficiency_statuses=("READY_FOR_RETEST",))) == ["Retest outstanding"]
    assert _texts(_facts(rounds=(RoundFacts("RETEST", "TESTING"),))) == [
        "Retest testing in progress"
    ]
    assert _texts(_facts(rounds=(RoundFacts("RETEST", "SIGNED_OFF", conclusion="EFFECTIVE"),))) == [
        "Independent review of the retest round outstanding"
    ]
    # A reviewed round whose results predate a plan revision, or whose sheet changed
    # since its review covered it, holds the conclusion too (W3 follow-up).
    pending = (
        RoundFacts(
            "ROLLFORWARD",
            "SIGNED_OFF",
            "EFFECTIVE",
            "SIGNED_OFF",
            impact="PENDING",
            sheet_version=3,
            covered_version=3,
        ),
    )
    assert _texts(_facts(applicability=ROLLED, rounds=pending)) == [
        "Roll-forward results: impact assessment pending a reviewer's decision"
    ]
    moved = (
        RoundFacts(
            "ROLLFORWARD",
            "SIGNED_OFF",
            "EFFECTIVE",
            "SIGNED_OFF",
            sheet_version=5,
            covered_version=4,
        ),
    )
    assert _texts(_facts(applicability=ROLLED, rounds=moved)) == [
        "Roll-forward testing changed since its review covered it: review outstanding"
    ]
    assessed = (
        RoundFacts(
            "ROLLFORWARD",
            "SIGNED_OFF",
            "EFFECTIVE",
            "SIGNED_OFF",
            sheet_version=5,
            covered_version=4,
            coverage_assessed=True,
        ),
    )
    assert _texts(_facts(applicability=ROLLED, rounds=assessed)) == []
    # The step and phase each reason points at, for the register and the journey.
    reasons = finality(_facts(applicability=ROLLED, design_prepared_at=None)).reasons
    assert [(r.kind, r.step, r.phase) for r in reasons] == [
        ("DESIGN", "TEST", "DESIGN"),
        ("ROUND", "REQUEST", "ROLLFORWARD"),
    ]


def test_signed_off_testing_records_its_plan_revision_and_reopening_says_why(
    migrated: Database,
) -> None:
    team, client, _sheet_, _file = _tested_control(migrated, "journey-reopen")
    tested = next(r for r in _controls(client, team).values() if r["control_ref"] == "ITGC-AC-01")
    with connect(migrated.url) as connection:
        stamped = connection.execute(
            """
            SELECT s.plan_revision, p.approved_revision FROM test_sheets s
            JOIN evidence_plans p ON p.engagement_control_id = s.engagement_control_id
            WHERE s.engagement_control_id = %s AND s.test_round_id IS NULL
            """,
            (tested["id"],),
        ).fetchone()
    assert stamped is not None and stamped[0] is not None and stamped[0] == stamped[1]
    # Not final: the review is not signed (and the design testing is outstanding); the
    # register says what is outstanding instead of reading the control as concluded.
    assert tested["final"] is False and tested["conclusion"] == "NOT_CONCLUDED"
    assert "Independent review not signed off" in [r["text"] for r in tested["not_final"]]
    current = _sheet(client, team)
    reopened = client.post(
        f"{_base(team)}/test-sheets/{current['id']}/reopen",
        json={"version": current["version"], "reason": "Item 2 approval is missing"},
    )
    assert reopened.status_code == 200, reopened.text
    row = _controls(client, team)[tested["id"]]
    assert row["progress"] == "TESTING_REOPENED"
    assert (row["reopen_reason"], row["reopened_from"]) == (
        "Item 2 approval is missing",
        "PERSON",
    )
    assert row["journey"]["reopened"] == "Item 2 approval is missing"
    assert row["journey"]["step"] == "TEST" and row["final"] is False
    # Audit integrity: the earlier sign-off and the reopening both stay on record, with
    # who did each; reopening adds, it never deletes or rewrites.
    with connect(migrated.url) as connection:
        events = connection.execute(
            """
            SELECT action, actor_user_id IS NOT NULL, payload FROM audit_events
            WHERE target_id = %s AND action IN ('testing.signed_off', 'testing.reopened')
            ORDER BY occurred_at
            """,
            (current["id"],),
        ).fetchall()
        sheet_row = connection.execute(
            "SELECT reopened_by IS NOT NULL, reopen_reason, reopened_from, plan_revision "
            "FROM test_sheets WHERE id = %s",
            (current["id"],),
        ).fetchone()
    assert [(e[0], e[1]) for e in events] == [
        ("testing.signed_off", True),
        ("testing.reopened", True),
    ]
    assert events[1][2]["reason"] == "Item 2 approval is missing"
    assert sheet_row == (True, "Item 2 approval is missing", "PERSON", stamped[0])


def test_an_impact_assessment_decides_whether_results_under_an_earlier_revision_stand() -> None:
    # Results under revision 1, plan approved at 2: outstanding until raised, pending once
    # raised, covered once a reviewer decided VALID; REPERFORM reopens the sheet instead.
    assert _texts(_facts(sheet_plan_revision=1)) == [
        "Test plan revised since the interim results were signed off: impact assessment outstanding"
    ]
    assert _texts(_facts(sheet_plan_revision=1, impact_state="PENDING")) == [
        "Test plan revised since the interim results were signed off: impact assessment "
        "pending a reviewer's decision"
    ]
    assert _texts(_facts(sheet_plan_revision=1, impact_state="VALID")) == []
    assert _texts(_facts(sheet_plan_revision=None, impact_state="PENDING")) == [
        "Plan revision the interim results were tested under is not recorded: impact "
        "assessment pending a reviewer's decision"
    ]
    # A decision for an earlier revision never covers a later one.
    assert _texts(_facts(sheet_plan_revision=1, approved_revision=3, impact_state=None)) != []


def test_a_signed_review_covers_only_the_versions_it_recorded() -> None:
    covered = {"sheet_version": 4, "workpapers": [{"stage": "EFFECTIVENESS", "version": 2}]}
    base = {"sheet_version": 4, "workpaper_versions": {"EFFECTIVENESS": 2}}
    assert finality(_facts(review_coverage=covered, **base)).final is True
    assert _texts(
        _facts(review_coverage=covered, sheet_version=5, workpaper_versions={"EFFECTIVENESS": 2})
    ) == ["Testing changed since the review covered it: review outstanding"]
    assert _texts(
        _facts(review_coverage=covered, sheet_version=4, workpaper_versions={"EFFECTIVENESS": 3})
    ) == ["The effectiveness workpaper changed since the review covered it: review outstanding"]
    # A workpaper prepared after the review was never covered by it.
    later = {"EFFECTIVENESS": 2, "DESIGN": 1}
    assert _texts(_facts(review_coverage=covered, sheet_version=4, workpaper_versions=later)) == [
        "The design workpaper changed since the review covered it: review outstanding"
    ]
    # A qualified reviewer's documented coverage assessment covers the current versions
    # without re-performance (owner's decision 2); the review itself is untouched.
    assert (
        finality(
            _facts(
                review_coverage=covered,
                sheet_version=5,
                workpaper_versions={"EFFECTIVENESS": 3},
                coverage_assessed=True,
            )
        ).final
        is True
    )
    # Coverage without a sheet version (backfilled from a review that never recorded one)
    # is unknown, and unknown is outstanding, never assumed.
    assert _texts(_facts(review_coverage={"sheet_version": None, "workpapers": []}, **base)) == [
        "The review did not record the testing version it covered: review outstanding",
        "The effectiveness workpaper changed since the review covered it: review outstanding",
    ]
