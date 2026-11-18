"""Readiness of a testing round (round_readiness.py, workflow integrity W4): remediation
before retesting, the round's evidence received, the fixed control operated long enough,
the approved testing prerequisites; roll-forward after interim signed off effective. The
gates refuse sampling and testing until then, and say why."""

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from support import Database
from test_control_progress import _controls
from test_outbound import migrated
from test_round_reviews import _rolled_forward
from test_test_rounds import _plans, _rounds
from test_testing_engine import _add, _base, _read_all
from test_workpapers import _tested_control

from ai_workforce_api.round_readiness import RoundFacts, evaluate_round

__all__ = ["migrated"]

ROUND = UUID("01a12990-0000-7000-8000-000000000001")
TODAY = date(2026, 10, 20)


def _facts(**overrides: Any) -> RoundFacts:
    values: dict[str, Any] = {
        "round_id": ROUND,
        "kind": "RETEST",
        "status": "REQUESTED",
        "test_from": TODAY - timedelta(days=1),
        "today": TODAY,
        "plan_status": "APPROVED",
        "request_status": "RECEIVED",
        "interim_conclusion": "NOT_EFFECTIVE",
        "deficiency_status": "READY_FOR_RETEST",
        "remediation_request_status": "RECEIVED",
        "population_blocker": None,
        "impact_pending": 0,
    }
    values.update(overrides)
    return RoundFacts(**values)


def _blockers(**overrides: Any) -> list[str]:
    return evaluate_round(_facts(**overrides)).blockers


def test_a_retest_is_ready_only_after_remediation_and_its_prerequisites() -> None:
    assert evaluate_round(_facts()).state == "READY"
    assert _blockers(remediation_request_status="SENT") == [
        "Remediation evidence (the fix and its support) is not received"
    ]
    # Evidence already on record against the remediation request, even in part, is the
    # fix's evidence: no duplicate request is asked for.
    assert _blockers(remediation_request_status="PARTIALLY_RECEIVED") == []
    assert _blockers(deficiency_status="REMEDIATION_IN_PROGRESS") == [
        "The deficiency is not ready for retest"
    ]
    assert _blockers(test_from=TODAY + timedelta(days=10)) == [
        "The fixed control must operate until 2026-10-30 before it is retested"
    ]
    assert _blockers(request_status="SENT") == ["The retest population is not received"]
    assert _blockers(plan_status="PROPOSED")[0] == "Approve the test plan at its current revision"
    assert _blockers(impact_pending=1)[0] == (
        "Decide the impact of the plan revision on the signed-off results first"
    )
    assert _blockers(population_blocker="accept the population first") == [
        "accept the population first"
    ]
    # Every blocker, in the order to resolve them.
    assert len(_blockers(remediation_request_status=None, request_status=None)) == 2
    assert evaluate_round(_facts(status="SIGNED_OFF")).state == "DONE"
    assert evaluate_round(_facts(status="CANCELLED")).state == "DONE"


def test_a_roll_forward_needs_effective_interim_testing_and_its_evidence() -> None:
    rolled = {"kind": "ROLLFORWARD", "interim_conclusion": "EFFECTIVE", "deficiency_status": None}
    assert evaluate_round(_facts(**rolled)).state == "READY"
    assert _blockers(**{**rolled, "interim_conclusion": "NOT_EFFECTIVE"}) == [
        "Interim testing must be signed off effective before a roll-forward"
    ]
    assert _blockers(**{**rolled, "request_status": "SENT"}) == [
        "The roll-forward evidence (changes since interim and the remaining population) is "
        "not received"
    ]
    # Interim's independent review is not a prerequisite: the work may run in parallel.
    assert "review" not in " ".join(_blockers(**rolled)).lower()


def test_sampling_a_retest_waits_for_the_remediation_evidence(migrated: Database) -> None:
    team, client, sheet, _ticket = _tested_control(migrated, "round-ready-retest")
    base = _base(team)
    logged = client.post(
        f"{base}/test-sheets/{sheet['id']}/deficiency",
        json={
            "version": _controls(client, team)
            and client.get(f"{base}/test-sheets").json()[0]["version"],
            "action": "LOG",
        },
    )
    assert logged.status_code == 200, logged.text
    [deficiency] = client.get(f"{base}/deficiencies").json()
    fixed = date.today() - timedelta(days=90)
    current = deficiency
    for body in (
        {"status": "REMEDIATION_IN_PROGRESS"},
        {"status": "READY_FOR_RETEST", "remediated_on": fixed.isoformat()},
    ):
        moved = client.post(
            f"{base}/deficiencies/{deficiency['id']}/progress",
            json={"version": current["version"], **body},
        )
        assert moved.status_code == 200, moved.text
        current = moved.json()
    [retest] = _rounds(client, team)
    assert retest["readiness_state"] == "NOT_READY"
    assert (
        "Remediation evidence (the fix and its support) is not received"
        in retest["readiness_blockers"]
    )
    # The journey's retest phase says the same.
    row = _controls(client, team)[retest["control_id"]]
    phase = next(p for p in row["journey"]["phases"] if p["phase"] == "RETEST")
    assert phase["ready_for_testing"] is False
    assert "Remediation evidence (the fix and its support) is not received" in phase["blockers"]
    # The retest population arrives and samples are proposed; approving them is refused
    # while the remediation evidence is outstanding.
    after = "User ID,Name,Date granted\n" + "".join(
        f"u100{n},Fixed User {n},{(fixed + timedelta(days=n)).isoformat()}\n" for n in range(1, 4)
    )
    _add(client, team, "after the fix.csv", after, retest["request_id"])
    from test_test_rounds import _engagement_scheduler

    scheduler = _engagement_scheduler(team)
    _read_all(migrated, scheduler)
    plan = next(p for p in _plans(client, team) if p["test_round_id"] == retest["id"])
    refused = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert refused.status_code == 409, refused.text
    assert "Remediation evidence" in refused.json()["detail"]
    # The owner sends the fix and its support: the retest is ready and the samples approve.
    _add(
        client,
        team,
        "fix evidence.txt",
        "Approval step added; screenshot attached.",
        deficiency["remediation_request_id"],
    )
    _read_all(migrated, scheduler)
    [retest] = _rounds(client, team)
    assert retest["readiness_state"] == "READY", retest["readiness_blockers"]
    plan = next(p for p in _plans(client, team) if p["test_round_id"] == retest["id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text


def test_a_roll_forward_round_reads_its_readiness(migrated: Database) -> None:
    team, client, rolled = _rolled_forward(migrated, "round-ready-rollforward")
    # DONE: the round's testing is signed off. It says nothing about its independent
    # review (still open) or the control's completion (not final).
    assert rolled["readiness_state"] == "DONE" and rolled["readiness_blockers"] == []
    assert rolled["review_status"] == "OPEN"
    row = _controls(client, team)[rolled["control_id"]]
    assert row["final"] is False
    assert "Independent review of the roll-forward round outstanding" in [
        item["text"] for item in row["not_final"]
    ]
    assert next(p for p in row["journey"]["phases"] if p["phase"] == "ROLLFORWARD")["state"] in (
        "SIGNED_OFF",
        "REVIEWED",
    )
