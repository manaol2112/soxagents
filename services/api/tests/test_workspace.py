from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from support import Database, approve_evidence_plans
from test_onboarding import _base, _complete_setup, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.schedule import PHASE_KEYS, interim_cutoff, standard_schedule
from ai_workforce_api.workspace import (
    ControlRequest,
    ControlRow,
    StageBody,
    evidence_phases,
    next_step,
    progress_of,
    step_of,
    suggested_severity,
)

__all__ = ["migrated"]


# The calendar


@pytest.mark.parametrize(
    ("kickoff", "period_end", "interim"),
    [
        (date(2026, 10, 11), date(2027, 12, 31), True),
        (date(2026, 11, 1), date(2027, 6, 30), True),
        (date(2027, 10, 1), date(2027, 12, 31), False),
        (date(2026, 10, 11), date(2025, 12, 31), False),
    ],
    ids=["a-year-ahead", "june-year-end", "late-start", "period-already-ended"],
)
def test_the_calendar_keeps_every_phase_in_order_after_kickoff(
    kickoff: date, period_end: date, interim: bool
) -> None:
    schedule = standard_schedule(kickoff, period_end, 10)
    assert schedule.interim is interim
    assert [phase.key for phase in schedule.phases] == list(PHASE_KEYS)
    for phase in schedule.phases:
        assert kickoff <= phase.start <= phase.end
    keys = {m.key for m in schedule.milestones}
    assert {"KICKOFF", "PERIOD_END", "SIGN_OFF", "PBC_DUE"} <= keys
    assert ("INTERIM_CUTOFF" in keys) is interim
    dues = [m.due for m in schedule.milestones]
    assert dues == sorted(dues)


def test_the_standard_calendar_tests_at_the_interim_date_and_signs_off_after_year_end() -> None:
    schedule = standard_schedule(date(2026, 10, 11), date(2027, 12, 31), 10)
    assert interim_cutoff(date(2027, 12, 31)) == date(2027, 9, 30)
    assert interim_cutoff(date(2027, 3, 31)) == date(2026, 12, 31)
    testing = schedule.phase("INTERIM_TESTING")
    assert testing.start <= date(2027, 9, 30) <= testing.end
    assert schedule.phase("ROLLFORWARD").start == date(2028, 1, 1)
    sign_off = next(m for m in schedule.milestones if m.key == "SIGN_OFF")
    assert sign_off.due == date(2027, 12, 31) + timedelta(days=60)
    pbc = next(m for m in schedule.milestones if m.key == "PBC_DUE")
    assert pbc.due == date(2026, 10, 21)


def _row(**overrides: Any) -> ControlRow:
    values: dict[str, Any] = {
        "id": UUID("01a12985-c94d-73f6-8007-7d6130692f22"),
        "control_ref": "ITGC-AC-01",
        "title": "New user access is approved",
        "activity": "Approved before access.",
        "category": "it",
        "domain": "ACCESS",
        "domain_label": "Logical access",
        "area": "Logical access",
        "frequency": "EVENT_DRIVEN",
        "frequency_label": "",
        "nature": "MANUAL",
        "nature_label": "",
        "key_control": True,
        "included": True,
        "owner_name": "Dana",
        "owner_email": "dana@example.com",
        "systems": [],
        "sample_size": 25,
        "agent_key": "itgc-access-tester",
        "stage": "PLANNED",
        "stages": StageBody(walkthrough="READY", evidence="NONE", test="READY", review="READY"),
        "evidence_requests": 0,
        "evidence_received": 0,
        "deficiencies": 0,
        "worst_severity": None,
        "conclusion": "NOT_CONCLUDED",
    }
    values.update(overrides)
    return ControlRow(**values)


# The moment the steps are worked out at: before the requests' due date.
NOW = datetime(2026, 10, 16, tzinfo=UTC)


def _request(
    kind: str, status: str, due_at: datetime | None = None, phase: str | None = None
) -> ControlRequest:
    return ControlRequest(
        id=UUID("01a12986-8c55-7649-b395-5f2b1e335b46"),
        kind=kind,  # type: ignore[arg-type]
        title="Population",
        status=status,
        due_at=due_at or datetime(2026, 10, 21, tzinfo=UTC),
        phase=phase,
    )


def test_the_next_step_names_who_a_control_waits_on() -> None:
    idle = StageBody(walkthrough="READY", evidence="NONE", test="READY", review="READY")
    tested = StageBody(
        walkthrough="SUCCEEDED", evidence="RECEIVED", test="SUCCEEDED", review="READY"
    )
    cases = [
        (_row(included=False), "Out of scope", "NONE", False),
        (_row(conclusion="EFFECTIVE"), "Concluded with no exceptions", "NONE", False),
        (_row(), "Request evidence", "TEAM", False),
        (
            _row(requests=[_request("EVIDENCE", "DRAFT")]),
            "Submit the evidence request",
            "TEAM",
            False,
        ),
        (
            _row(requests=[_request("EVIDENCE", "APPROVAL_PENDING")]),
            "Approve the evidence request",
            "TEAM",
            False,
        ),
        (_row(requests=[_request("EVIDENCE", "SENT")]), "Waiting for evidence", "OWNER", False),
        (
            _row(requests=[_request("EVIDENCE", "OVERDUE")]),
            "Chase the overdue evidence request",
            "OWNER",
            True,
        ),
        (
            _row(test_status="PROPOSED", requests=[_request("EVIDENCE", "RECEIVED")]),
            "Approve the samples",
            "TEAM",
            False,
        ),
        (
            _row(requests=[_request("EVIDENCE", "RECEIVED"), _request("SAMPLES", "SENT")]),
            "Waiting for sample evidence",
            "OWNER",
            False,
        ),
        (
            _row(requests=[_request("EVIDENCE", "RECEIVED"), _request("FOLLOW_UP", "DRAFT")]),
            "Submit the follow-up",
            "TEAM",
            False,
        ),
        (
            _row(requests=[_request("EVIDENCE", "RECEIVED")]),
            "Confirm the population",
            "TEAM",
            False,
        ),
        (
            _row(nature="AUTOMATED", requests=[_request("EVIDENCE", "RECEIVED")]),
            "Test the evidence",
            "AGENT",
            False,
        ),
    ]
    for row, step, waiting, late in cases:
        assert next_step(row, idle, NOW) == (step, waiting, late), step
    done = _row(test_status="APPROVED", requests=[_request("SAMPLES", "RECEIVED")])
    assert next_step(done, tested, NOW) == ("Prepare the workpapers for review", "TEAM", False)


def test_a_request_out_past_its_due_date_is_overdue() -> None:
    # As the metrics rulebook counts it: sent or partly received, and past its due date.
    idle = StageBody(walkthrough="READY", evidence="REQUESTED", test="READY", review="READY")
    past = NOW - timedelta(days=2)
    for status in ("SENT", "WAITING_FOR_RESPONSE", "PARTIALLY_RECEIVED"):
        row = _row(requests=[_request("EVIDENCE", status, due_at=past)])
        assert next_step(row, idle, NOW) == ("Chase the overdue evidence request", "OWNER", True)
    # A draft past its date has not gone out, so it is not late.
    draft = _row(requests=[_request("EVIDENCE", "DRAFT", due_at=past)])
    assert next_step(draft, idle, NOW) == ("Submit the evidence request", "TEAM", False)


def test_each_step_names_who_takes_it() -> None:
    idle = StageBody(walkthrough="READY", evidence="NONE", test="READY", review="READY")
    cases = [
        (_row(requests=[_request("EVIDENCE", "DRAFT")]), "PREPARER", True),
        (_row(requests=[_request("EVIDENCE", "APPROVAL_PENDING")]), "APPROVER", False),
        (_row(requests=[_request("EVIDENCE", "SENT")]), "CLIENT", False),
        (_row(sheet_status="SIGNED_OFF", review_left="SIGN"), "REVIEWER", False),
        (_row(sheet_status="SIGNED_OFF", review_left="DECIDE"), "REVIEWER", False),
        (_row(sheet_status="SIGNED_OFF", review_left="ADDRESS"), "PREPARER", False),
        (_row(sheet_status="SIGNED_OFF", review_left="REPERFORMING"), "AGENT", False),
        (_row(sheet_status="OPEN", sheet_left="TESTING", testing_running=True), "AGENT", False),
        (_row(sheet_status="OPEN", sheet_left="DECIDE"), "PREPARER", False),
        (_row(conclusion="EFFECTIVE"), "NONE", False),
    ]
    for row, actor, drafted in cases:
        step = step_of(row, idle, NOW)
        assert (step.actor, step.drafted) == (actor, drafted), step.text


def test_testing_that_stopped_is_not_shown_as_running() -> None:
    idle = StageBody(walkthrough="READY", evidence="RECEIVED", test="RUNNING", review="READY")
    running = _row(sheet_status="OPEN", sheet_left="TESTING", testing_running=True)
    stopped = _row(sheet_status="OPEN", sheet_left="TESTING", testing_running=False)
    assert step_of(running, idle, NOW).text == "Test the evidence"
    assert progress_of(running, idle, step_of(running, idle, NOW)) == "AGENT_TESTING"
    step = step_of(stopped, idle, NOW)
    assert (step.text, step.actor) == ("Testing stopped: run it again", "PREPARER")
    assert progress_of(stopped, idle, step) == "READY_FOR_TESTING"


def test_every_control_has_one_stage_from_its_records() -> None:
    def stage(row: ControlRow, evidence: str = "NONE", test: str = "READY") -> str:
        stages = StageBody(walkthrough="READY", evidence=evidence, test=test, review="READY")
        return progress_of(row, stages, step_of(row, stages, NOW))

    assert stage(_row()) == "TO_REQUEST"
    assert stage(_row(requests=[_request("EVIDENCE", "DRAFT")]), "DRAFTED") == "TO_REQUEST"
    assert stage(_row(requests=[_request("EVIDENCE", "SENT")]), "REQUESTED") == (
        "AWAITING_EVIDENCE"
    )
    assert stage(_row(requests=[_request("EVIDENCE", "PARTIALLY_RECEIVED")]), "PARTIAL") == (
        "EVIDENCE_RECEIVED"
    )
    received = [_request("EVIDENCE", "RECEIVED")]
    assert stage(_row(requests=received), "RECEIVED") == "EVIDENCE_RECEIVED"
    assert stage(_row(nature="AUTOMATED", requests=received), "RECEIVED") == ("READY_FOR_TESTING")
    assert stage(_row(test_status="PROPOSED", requests=received), "RECEIVED") == (
        "EVIDENCE_RECEIVED"
    )
    assert stage(_row(sheet_status="OPEN", sheet_left="EVIDENCE"), "RECEIVED") == (
        "AWAITING_EVIDENCE"
    )
    assert stage(_row(sheet_status="OPEN", sheet_left="SIGN_OFF"), "RECEIVED") == (
        "RESULTS_TO_CONFIRM"
    )
    assert stage(_row(sheet_status="SIGNED_OFF"), "RECEIVED", "SUCCEEDED") == ("RESULTS_TO_CONFIRM")
    assert stage(_row(sheet_status="SIGNED_OFF", review_left="SIGN"), "RECEIVED") == (
        "AWAITING_REVIEW"
    )
    assert stage(_row(sheet_status="SIGNED_OFF", review_left="ADDRESS"), "RECEIVED") == (
        "REVIEW_NOTES"
    )
    # Concluded wins over everything, findings or not.
    assert stage(_row(conclusion="EXCEPTION", deficiencies=1), "RECEIVED") == "CONCLUDED"


def test_evidence_is_counted_by_testing_phase() -> None:
    past = NOW - timedelta(days=1)
    phases = evidence_phases(
        [
            _request("EVIDENCE", "RECEIVED", phase="INTERIM"),
            _request("EVIDENCE", "SENT", due_at=past, phase="INTERIM"),
            _request("EVIDENCE", "DRAFT", phase="DESIGN"),
            _request("EVIDENCE", "CANCELLED", phase="DESIGN"),
            _request("EVIDENCE", "SENT", phase="ROLLFORWARD"),
        ],
        NOW,
    )
    assert [(p.phase, p.requests, p.received, p.drafted, p.out, p.late) for p in phases] == [
        ("DESIGN", 1, 0, 1, 0, 0),
        ("INTERIM", 2, 1, 0, 1, 1),
        ("ROLLFORWARD", 1, 0, 0, 1, 0),
    ]


def test_severity_follows_likelihood_and_magnitude() -> None:
    assert suggested_severity("REMOTE", "MATERIAL") == "CONTROL_DEFICIENCY"
    assert suggested_severity("PROBABLE", "INCONSEQUENTIAL") == "CONTROL_DEFICIENCY"
    assert suggested_severity("REASONABLY_POSSIBLE", "MORE_THAN_INCONSEQUENTIAL") == (
        "SIGNIFICANT_DEFICIENCY"
    )
    assert suggested_severity("PROBABLE", "MATERIAL") == "MATERIAL_WEAKNESS"


# The workspace, end to end


def test_kickoff_lays_out_the_plan_and_the_workspace_reads_it(migrated: Database) -> None:
    team, owner, base = _started(migrated, "workspace")
    plan = owner.get(f"{base}/workspace/plan").json()
    assert plan["started"] is True and plan["schedule_missing"] is False
    phases = {phase["key"]: phase for phase in plan["phases"]}
    assert list(phases) == list(PHASE_KEYS)
    assert phases["WALKTHROUGHS"]["tasks"] == 19
    assert phases["INTERIM_TESTING"]["tasks"] == 38
    assert phases["REPORTING"]["tasks"] == 1
    assert {m["key"] for m in plan["milestones"]} >= {"KICKOFF", "PERIOD_END", "SIGN_OFF"}
    # Kickoff and scoping happened in setup, so they start done, and so does planning.
    marks = {m["key"]: m for m in plan["milestones"]}
    assert marks["KICKOFF"]["status"] == "DONE"
    assert marks["SCOPING_COMPLETE"]["status"] == "DONE"
    assert phases["PLANNING"]["status"] == "DONE"
    tasks = plan["tasks"]
    assert len(tasks) == 77
    assert all(task["deadline"] for task in tasks)
    assert all(task["control_ref"] for task in tasks if task["plan_kind"] != "report")
    tests = [task for task in tasks if task["plan_kind"] == "test"]
    assert all(task["waiting_on"] == 2 for task in tests)

    # Moving a phase moves the open tasks that followed its end.
    phase = phases["WALKTHROUGHS"]
    moved_end = date.fromisoformat(phase["planned_end"]) + timedelta(days=10)
    moved = owner.patch(
        f"{base}/workspace/phases/WALKTHROUGHS",
        json={
            "version": phase["version"],
            "planned_start": phase["planned_start"],
            "planned_end": moved_end.isoformat(),
        },
    )
    assert moved.status_code == 200, moved.text
    walkthroughs = [t for t in moved.json()["tasks"] if t["plan_kind"] == "walkthrough"]
    assert {t["deadline"][:10] for t in walkthroughs} == {moved_end.isoformat()}
    backwards = owner.patch(
        f"{base}/workspace/phases/WALKTHROUGHS",
        json={
            "version": phase["version"] + 1,
            "planned_start": "2030-01-02",
            "planned_end": "2030-01-01",
        },
    )
    assert backwards.status_code == 422
    pbc = next(m for m in moved.json()["milestones"] if m["key"] == "PBC_DUE")
    done = owner.patch(
        f"{base}/workspace/milestones/PBC_DUE",
        json={"version": pbc["version"], "due_date": pbc["due_date"], "completed": True},
    ).json()
    assert next(m for m in done["milestones"] if m["key"] == "PBC_DUE")["status"] == "DONE"

    register = owner.get(f"{base}/workspace/controls").json()
    assert len(register) == 19
    first = register[0]
    assert first["category"] == "it"
    assert first["stage"] == "PLANNED"
    assert first["stages"]["evidence"] == "DRAFTED"
    assert first["evidence_requests"] == 2
    assert first["systems"] == ["SAP ERP"]
    # Each control says what moves it forward and who it waits on.
    assert first["next_step"] == "Submit the evidence request"
    assert first["waiting_on"] == "TEAM"
    assert first["overdue"] is False
    assert [request["kind"] for request in first["requests"]] == ["EVIDENCE", "EVIDENCE"]
    assert [request["phase"] for request in first["requests"]] == ["DESIGN", "INTERIM"]
    assert {request["status"] for request in first["requests"]} == {"DRAFT"}
    assert first["test_attributes"] and first["pbc_items"] and first["risk"]
    dashboard = owner.get(f"{base}/workspace/dashboard").json()
    assert dashboard["controls"]["in_scope"] == 19
    assert dashboard["evidence"]["draft"] == 38
    assert dashboard["work"]["total"] == 77
    assert len(dashboard["schedule"]["phases"]) == 7


def test_deficiencies_need_the_reviewer_for_severity_and_closing(migrated: Database) -> None:
    team, owner, base = _started(migrated, "deficiencies")
    control = owner.get(f"{base}/workspace/controls").json()[0]
    reviewer = _session(migrated, team["reviewer_id"])
    simple = owner.post(
        f"{base}/deficiencies",
        json={
            "control_id": control["id"],
            "title": "Approval missing for two new users",
            "condition": "Two of 25 samples had no approval before access was granted.",
            "criteria": "Access is approved before it is granted.",
            "deficiency_type": "OPERATING",
            "likelihood": "REASONABLY_POSSIBLE",
            "magnitude": "INCONSEQUENTIAL",
        },
    )
    assert simple.status_code == 200, simple.text
    first = simple.json()
    assert (first["reference"], first["severity"], first["pending_change"]) == (
        "D-001",
        "CONTROL_DEFICIENCY",
        None,
    )
    severe = owner.post(
        f"{base}/deficiencies",
        json={
            "title": "Privileged access not reviewed",
            "deficiency_type": "DESIGN",
            "likelihood": "PROBABLE",
            "magnitude": "MATERIAL",
            "severity": "MATERIAL_WEAKNESS",
        },
    ).json()
    # Logged as severe: it stays a control deficiency until the reviewer agrees.
    assert severe["reference"] == "D-002"
    assert severe["severity"] == "CONTROL_DEFICIENCY"
    assert severe["suggested_severity"] == "MATERIAL_WEAKNESS"
    assert severe["pending_change"]["severity"] == "MATERIAL_WEAKNESS"
    assert severe["can_decide"] is False
    own = owner.post(
        f"{base}/deficiencies/{severe['id']}/changes/decide",
        json={"version": severe["version"], "approve": True},
    )
    assert own.status_code == 403
    listed = {d["id"]: d for d in reviewer.get(f"{base}/deficiencies").json()}
    assert listed[severe["id"]]["can_decide"] is True
    approved = reviewer.post(
        f"{base}/deficiencies/{severe['id']}/changes/decide",
        json={"version": severe["version"], "approve": True, "reason": "Agreed."},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["severity"] == "MATERIAL_WEAKNESS"
    assert approved.json()["pending_change"] is None

    # Remediation and retest, then closing through the reviewer.
    current = first
    # A deficiency on a control needs the date its fix took effect to be retested.
    undated = owner.post(
        f"{base}/deficiencies/{first['id']}/progress",
        json={"version": current["version"], "status": "REMEDIATION_IN_PROGRESS"},
    ).json()
    refused = owner.post(
        f"{base}/deficiencies/{first['id']}/progress",
        json={"version": undated["version"], "status": "READY_FOR_RETEST"},
    )
    assert refused.status_code == 422
    current = owner.post(
        f"{base}/deficiencies/{first['id']}/progress",
        json={
            "version": undated["version"],
            "status": "READY_FOR_RETEST",
            "remediated_on": "2026-01-15",
        },
    ).json()
    assert current["remediated_on"] == "2026-01-15"
    skipped = owner.post(
        f"{base}/deficiencies/{first['id']}/progress",
        json={"version": current["version"], "status": "OPEN"},
    )
    assert skipped.status_code == 409
    retested = owner.post(
        f"{base}/deficiencies/{first['id']}/progress",
        json={"version": current["version"], "retest_result": "PASSED"},
    ).json()
    assert (retested["status"], retested["retest_result"]) == ("REMEDIATED", "PASSED")
    close = owner.post(
        f"{base}/deficiencies/{first['id']}/changes",
        json={"version": retested["version"], "kind": "CLOSE", "reason": "Retest passed."},
    ).json()
    assert close["pending_change"]["kind"] == "CLOSE"
    assert close["status"] == "REMEDIATED"
    closed = reviewer.post(
        f"{base}/deficiencies/{first['id']}/changes/decide",
        json={"version": close["version"], "approve": True},
    ).json()
    assert closed["status"] == "CLOSED" and closed["closed_at"] is not None

    register = {c["id"]: c for c in owner.get(f"{base}/workspace/controls").json()}
    assert register[control["id"]]["deficiencies"] == 0
    # An open finding before testing is reviewed is a finding, not a conclusion.
    other = owner.post(
        f"{base}/deficiencies",
        json={"control_id": control["id"], "title": "Walkthrough gap", "deficiency_type": "DESIGN"},
    )
    assert other.status_code == 200
    row = {c["id"]: c for c in owner.get(f"{base}/workspace/controls").json()}[control["id"]]
    assert (row["deficiencies"], row["conclusion"]) == (1, "NOT_CONCLUDED")
    assert row["stage"] != "CONCLUDED"
    dashboard = owner.get(f"{base}/workspace/dashboard").json()
    assert dashboard["deficiencies"]["open"] == 2
    assert dashboard["controls"]["concluded"] == 0
    assert dashboard["controls"]["exceptions"] == 1
    assert dashboard["deficiencies"]["by_severity"]["MATERIAL_WEAKNESS"] == 1
    secret = owner.post(
        f"{base}/deficiencies",
        json={"title": "x", "deficiency_type": "DESIGN", "condition": "password = Hunter2024"},
    )
    assert secret.status_code == 422
    with connect(migrated.url) as connection:
        actions = connection.execute(
            "SELECT count(*) FROM audit_events "
            "WHERE project_id = %s AND action LIKE 'deficiency.%%'",
            (team["project"],),
        ).fetchone()
    assert actions is not None and actions[0] >= 8


def test_an_engagement_started_earlier_gets_its_plan_on_request(migrated: Database) -> None:
    team, owner, base = _started(migrated, "earlier")
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM engagement_milestones WHERE project_id = %s", (team["project"],)
        )
        connection.execute(
            "DELETE FROM engagement_phases WHERE project_id = %s", (team["project"],)
        )
    assert owner.get(f"{base}/workspace/plan").json()["schedule_missing"] is True
    created = owner.post(f"{base}/workspace/schedule")
    assert created.status_code == 200, created.text
    assert created.json()["schedule_missing"] is False
    assert len(created.json()["phases"]) == 7


# Helpers


def _started(database: Database, slug: str) -> tuple[dict[str, Any], TestClient, str]:
    team = _new_engagement(database, slug)
    owner = team["owner"]
    _complete_setup(owner, team)
    onboarding = _base(team["org"], team["project"])
    plan = owner.post(f"{onboarding}/plan").json()["plan"]
    started = owner.post(
        f"{onboarding}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    # Nothing is requested before a person approves each control's evidence plan.
    approve_evidence_plans(database, team["project"])
    return team, owner, f"/organizations/{team['org']}/projects/{team['project']}"
