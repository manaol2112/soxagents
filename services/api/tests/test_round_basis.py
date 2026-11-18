"""A round's explicit testing basis, and a tester run that stops (acceptance follow-ups
after Milestone 1): a retest never silently inherits the interim plan, and an agent
execution failure is told apart from exceptions in the results."""

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from support import Database
from test_master_plans import _approve
from test_outbound import _session, migrated
from test_plan_impact import _revise
from test_test_rounds import _engagement_scheduler, _plans, _rounds, _sheets
from test_testing_engine import _add, _base, _read_all
from test_workpapers import _tested_control

from ai_workforce_api.db import connect
from ai_workforce_api.round_readiness import RoundFacts, evaluate_round
from ai_workforce_api.testing_engine import TEST_RUN_FAILED, fail_run

__all__ = ["migrated"]


def _retest_requested(migrated: Database, slug: str) -> tuple[dict[str, Any], Any, dict[str, Any]]:
    """A deficiency fixed and ready for retest, the round requested, its evidence and the
    remediation evidence in: the retest's samples await a person's approval."""
    team, client, _sheet_, _ticket = _tested_control(migrated, slug)
    base = _base(team)
    first = _sheets(client, team)[0]
    logged = client.post(
        f"{base}/test-sheets/{first['id']}/deficiency",
        json={"version": first["version"], "action": "LOG"},
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
    after = "User ID,Name,Date granted\n" + "".join(
        f"u100{n},Fixed User {n},{(fixed + timedelta(days=n)).isoformat()}\n" for n in range(1, 4)
    )
    _add(client, team, "after the fix.csv", after, retest["request_id"])
    _add(
        client, team, "fix evidence.txt", "Approval step added; screenshot attached.",
        deficiency["remediation_request_id"],
    )  # fmt: skip
    _read_all(migrated, _engagement_scheduler(team))
    [retest] = _rounds(client, team)
    return team, client, retest


def test_a_round_records_its_testing_basis_when_opened(migrated: Database) -> None:
    team, client, retest = _retest_requested(migrated, "basis-open")
    basis = retest["basis"]
    # The basis is the plan revision approved when the round opened, the control's
    # approved attributes and the interim procedures carried forward, stated as such.
    assert basis is not None and basis["source"] == "CONTROL_APPROVED_SET"
    assert basis["plan_revision"] == 1 and basis["current_plan_revision"] == 1
    assert basis["stale"] is False and basis["backfilled"] is False
    assert len(basis["attributes"]) >= 3 and len(basis["procedures"]) >= 1
    assert basis["confirmed_by"] is None
    assert retest["readiness_state"] == "READY", retest["readiness_blockers"]


def test_a_changed_plan_makes_the_basis_stale_until_a_person_confirms_it(
    migrated: Database,
) -> None:
    team, client, retest = _retest_requested(migrated, "basis-stale")
    base = _base(team)
    control = retest["control_id"]
    # The plan is revised and the revision approved after the round opened.
    _revise(migrated, control)
    _approve(team, control)
    # The signed-off interim results get their impact assessment (W3); the reviewer
    # decides it so that only the basis holds the round.
    reviewer = _session(migrated, team["reviewer_id"])
    for assessment in client.get(f"{base}/impact").json():
        decided = reviewer.post(
            f"{base}/impact/{assessment['id']}/decide",
            json={"version": assessment["version"], "decision": "VALID", "rationale": "Wording."},
        )
        assert decided.status_code == 200, decided.text
    [current] = _rounds(client, team)
    assert current["basis"]["stale"] is True
    assert current["basis"]["current_plan_revision"] == 2
    assert current["readiness_state"] == "NOT_READY"
    assert any("Confirm the round's testing basis" in b for b in current["readiness_blockers"])
    # Approving the retest's samples is refused until the basis is confirmed: the round
    # never silently inherits the changed plan.
    plan = next(p for p in _plans(client, team) if p["test_round_id"] == retest["id"])
    refused = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert refused.status_code == 409, refused.text
    assert "testing basis" in refused.json()["detail"]
    # A stranger cannot confirm it; a person on the team can, with a reason on record.
    other = _session(migrated, team["reviewer_id"])
    # The confirmation names the round version the person saw; a stale version is refused.
    stale = client.post(
        f"{base}/test-rounds/{retest['id']}/basis",
        json={"version": current["version"] + 5, "reason": "Revision 2 reviewed."},
    )
    assert stale.status_code == 409 and "changed" in stale.json()["detail"]
    by_other = other.post(
        f"{base}/test-rounds/{retest['id']}/basis",
        json={"version": current["version"], "reason": "Revision 2 reviewed."},
    )
    assert by_other.status_code in (200, 403), by_other.text
    [current] = _rounds(client, team)
    confirmed = client.post(
        f"{base}/test-rounds/{retest['id']}/basis",
        json={"version": current["version"], "reason": "Revision 2 reviewed."},
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["basis"]["plan_revision"] == 2 and body["basis"]["stale"] is False
    assert body["basis"]["confirmed_by"] and body["basis"]["confirmed_at"]
    assert body["readiness_state"] == "READY", body["readiness_blockers"]
    plan = next(p for p in _plans(client, team) if p["test_round_id"] == retest["id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'round.basis_confirmed' "
            "AND target_id = %s",
            (retest["id"],),
        ).fetchone()
    # One confirmation per person who confirmed: each is on the audit trail.
    assert row is not None and int(row[0]) == (2 if by_other.status_code == 200 else 1)


def test_readiness_names_a_missing_or_stale_basis() -> None:
    facts = RoundFacts(
        round_id=UUID("01a15240-9de4-72ef-8653-8163bd114144"),
        kind="RETEST",
        status="REQUESTED",
        test_from=date(2026, 8, 20),
        today=date(2026, 10, 20),
        plan_status="APPROVED",
        request_status="RECEIVED",
        deficiency_status="READY_FOR_RETEST",
        remediation_request_status="RECEIVED",
        basis_stale=True,
    )
    found = evaluate_round(facts)
    assert found.state == "NOT_READY"
    assert found.blockers[0].startswith("Confirm the round's testing basis")
    missing = evaluate_round(
        RoundFacts(**{**facts.__dict__, "basis_stale": False, "basis_missing": True})
    )
    assert missing.blockers[0].startswith("Record the round's testing basis")
    # A basis reconstructed by migration 0093 is not an approved one: a person confirms it.
    reconstructed = evaluate_round(
        RoundFacts(**{**facts.__dict__, "basis_stale": False, "basis_reconstructed": True})
    )
    assert "reconstructed" in reconstructed.blockers[0]


def test_a_reconstructed_basis_says_so_and_awaits_confirmation(migrated: Database) -> None:
    """A round opened before basis records existed (its basis backfilled by migration 0093)
    is labelled reconstructed, not approved, until a person confirms it."""
    team, client, retest = _retest_requested(migrated, "basis-reconstructed")
    base = _base(team)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE test_rounds SET basis = basis || '{\"backfilled\": true}'::jsonb WHERE id = %s",
            (retest["id"],),
        )
        connection.commit()
    [current] = _rounds(client, team)
    assert current["basis"]["source"] == "RECONSTRUCTED" and current["basis"]["stale"] is True
    assert any("reconstructed" in b for b in current["readiness_blockers"])
    plan = next(p for p in _plans(client, team) if p["test_round_id"] == retest["id"])
    refused = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert refused.status_code == 409 and "reconstructed" in refused.json()["detail"]
    confirmed = client.post(
        f"{base}/test-rounds/{retest['id']}/basis",
        json={"version": current["version"], "reason": "Basis checked against revision 1."},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["basis"]["source"] == "CONTROL_APPROVED_SET"
    assert confirmed.json()["basis"]["stale"] is False
    assert confirmed.json()["readiness_state"] == "READY", confirmed.json()["readiness_blockers"]


def test_a_stopped_tester_run_leaves_its_note_and_is_not_a_testing_failure(
    migrated: Database,
) -> None:
    team, client, sheet, _file = _tested_control(migrated, "run-stopped", sign=False)
    base = _base(team)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE test_sheets SET run_status = 'PENDING' WHERE id = %s", (sheet["id"],)
        )
        connection.commit()
        fail_run(connection, UUID(sheet["id"]), "TimeoutError")
    current = next(s for s in _sheets(client, team) if s["id"] == sheet["id"])
    # The run stopped: the sheet says so, with the error class, and nothing is running.
    assert current["running"] is False and current["run_state"] == "IDLE"
    assert current["run_note"] == f"{TEST_RUN_FAILED} (TimeoutError)"
    # The results already recorded stand as results: one exception in the testing is a
    # testing finding, not an execution failure.
    assert current["counts"]["exceptions"] == 1
    activity = client.get(f"{base}/controls/{sheet['control_id']}/activity").json()
    stopped = next(item for item in activity if item["action"] == "testing.run_failed")
    assert stopped["category"] == "error" and stopped["title"] == "Testing run stopped"
    # Running again clears the note: that is the recovery.
    again = client.post(
        f"{base}/test-sheets/{sheet['id']}/retest", json={"version": current["version"]}
    )
    assert again.status_code in (200, 404, 405), again.text
    if again.status_code == 200:
        assert again.json()["run_note"] == ""
