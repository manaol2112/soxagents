"""Roll-forward after effective interim testing, and the retest of a remediated deficiency."""

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from support import Database
from test_evidence_intake import _accept_population, _engagement, _request
from test_outbound import migrated
from test_testing_engine import _add, _answer, _base, _Citing, _read_all, _year
from test_workpapers import _tested_control

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_extraction import Table
from ai_workforce_api.sampling import build_frame
from ai_workforce_api.test_rounds import (
    RETEST_RULES,
    ROLLFORWARD_SIZES,
    retest_rule,
    rollforward_size,
)
from ai_workforce_api.testing_engine import run_sheet

_ = migrated


def test_round_sizes_follow_frequency_and_automation() -> None:
    assert rollforward_size("DAILY", "MANUAL") == ("SAMPLE", 5)
    assert rollforward_size("QUARTERLY", "IT_DEPENDENT_MANUAL") == ("SAMPLE", 1)
    assert rollforward_size("DAILY", "AUTOMATED") == ("TEST_OF_ONE", 1)
    assert retest_rule("MONTHLY", "MANUAL") == ("SAMPLE", 2, 60)
    assert retest_rule("DAILY", "MANUAL") == ("SAMPLE", 20, 28)
    assert retest_rule("WEEKLY", "AUTOMATED") == ("TEST_OF_ONE", 1, 0)
    assert set(ROLLFORWARD_SIZES) == set(RETEST_RULES)


def test_a_window_frames_only_its_dates_and_records_how_far_it_ran() -> None:
    table = Table(
        sheet="Sheet",
        columns=("ID", "Date"),
        rows=(("a", "2027-01-05"), ("b", "2027-05-01"), ("c", "2027-07-20"), ("d", "x")),
        note="",
    )
    whole = build_frame(table, date(2027, 12, 31), "EVENT_DRIVEN")
    assert whole.rows == (0, 1, 2)
    assert whole.covered_to == date(2027, 7, 20)
    window = build_frame(
        table, date(2027, 12, 31), "EVENT_DRIVEN", window=(date(2027, 4, 1), date(2027, 12, 31))
    )
    assert window.rows == (1, 2)
    assert "2027-04-01 to 2027-12-31" in next(
        c.detail for c in window.checks if c.check == "period"
    )
    # A window is not a year: the rows check does not expect a year's occurrences.
    assert next(c for c in window.checks if c.check == "rows").result == "OK"


def _rounds(client: TestClient, team: dict[str, Any]) -> list[dict[str, Any]]:
    found = client.get(f"{_base(team)}/test-rounds")
    assert found.status_code == 200, found.text
    body: list[dict[str, Any]] = found.json()
    return body


def _sheets(client: TestClient, team: dict[str, Any]) -> list[dict[str, Any]]:
    found = client.get(f"{_base(team)}/test-sheets")
    assert found.status_code == 200, found.text
    body: list[dict[str, Any]] = found.json()
    return body


def _plans(client: TestClient, team: dict[str, Any]) -> list[dict[str, Any]]:
    found = client.get(f"{_base(team)}/control-tests")
    assert found.status_code == 200, found.text
    body: list[dict[str, Any]] = found.json()
    return body


def _test_and_sign(
    migrated: Database, client: TestClient, team: dict[str, Any], sheet: dict[str, Any]
) -> dict[str, Any]:
    """Every item passes, and the sheet is signed off."""
    provider = _Citing([_answer(["PASS"] * len(sheet["attributes"]))])
    with connect(migrated.url) as connection:
        run_sheet(connection, provider, UUID(sheet["id"]))
    current = next(s for s in _sheets(client, team) if s["id"] == sheet["id"])
    assert current["proposed_conclusion"] == "EFFECTIVE", current["blocking"]
    signed = client.post(
        f"{_base(team)}/test-sheets/{sheet['id']}/sign-off", json={"version": current["version"]}
    )
    assert signed.status_code == 200, signed.text
    body: dict[str, Any] = signed.json()
    return body


def _task(migrated: Database, task_id: str) -> tuple[str, str, str]:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT status::text, plan_kind, phase_key FROM tasks WHERE id = %s", (task_id,)
        ).fetchone()
    assert row is not None
    return str(row[0]), str(row[1]), str(row[2])


def _request_row(migrated: Database, request_id: str) -> tuple[str, str]:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT status, evidence_description FROM pbc_requests WHERE id = %s", (request_id,)
        ).fetchone()
    assert row is not None
    return str(row[0]), str(row[1])


def test_effective_interim_testing_rolls_forward_to_period_end(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "rollfwd")
    base = _base(team)
    year = _year(migrated, team)
    kickoff = _request(migrated, team, "ITGC-AC-01")
    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    [plan] = _plans(client, team)
    assert plan["test_round_id"] is None
    _accept_population(client, team, plan["engagement_control_id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    ).json()
    [interim] = _sheets(client, team)
    tickets = "ticket,user,approved_by\n" + "".join(
        f"T-{n},{item['label']},Demo Manager\n" for n, item in enumerate(interim["items"])
    )
    _add(client, team, "access tickets.csv", tickets, approved["sample_request_id"])
    _read_all(migrated, scheduler)
    signed = _test_and_sign(migrated, client, team, interim)
    assert signed["conclusion"] == "EFFECTIVE"

    # The population ran to the 10th of March: the roll-forward covers the rest.
    [rolled] = _rounds(client, team)
    assert (rolled["kind"], rolled["status"], rolled["number"]) == ("ROLLFORWARD", "REQUESTED", 1)
    assert rolled["window_start"] == f"{year}-03-11"
    assert rolled["window_end"] == f"{year}-12-31"
    with connect(migrated.url) as connection:
        frequency = connection.execute(
            "SELECT frequency FROM engagement_controls WHERE id = %s", (rolled["control_id"],)
        ).fetchone()
    assert frequency is not None
    assert rolled["sample_size"] == ROLLFORWARD_SIZES[str(frequency[0])]
    status, text = _request_row(migrated, rolled["request_id"])
    assert status == "DRAFT"
    assert text.startswith("Roll-forward for ITGC-AC-01")
    assert f"from {year}-03-11 to {year}-12-31" in text
    # The evidence plan's roll-forward now applies, for this window, and its items go out
    # on the round's request: what changed, and the remaining population with its support.
    plan = client.get(f"{base}/controls/{rolled['control_id']}/evidence-plan").json()
    roll = next(p for p in plan["phases"] if p["phase"] == "ROLLFORWARD")
    assert roll["applicability"] == "APPLICABLE"
    assert roll["period_start"] == f"{year}-03-11"
    on_request = {r["key"] for r in roll["requirements"] if r["request_id"] == rolled["request_id"]}
    # The standard's suite (library version 4), lean (27 October 2026): one item carries
    # the population, how it was produced, and what changed since interim.
    assert on_request == {"rollforward-ac01-e3"}
    assert "Changes since the interim period" in text
    assert "Record count" in text
    assert f"11 March {year} to 31 December {year}" in text
    waiting = next(r for r in roll["requirements"] if r["key"] == "rollforward-ac01-e8")
    assert waiting["state"] == "AWAITING_DEPENDENCY"
    assert _task(migrated, rolled["task_id"]) == ("READY", "rollforward", "ROLLFORWARD")

    # The owner sends the rest of the period; only its dates are sampled, for the round.
    rest = (
        "User ID,Name,Date granted\n"
        f"u0009,Early User,{year}-02-01\n"
        f"u0010,Later User,{year}-05-10\n"
        f"u0011,Last User,{year}-06-10\n"
    )
    _add(client, team, "rollforward population.csv", rest, rolled["request_id"])
    _read_all(migrated, scheduler)
    plans = _plans(client, team)
    assert len(plans) == 2
    round_plan = next(p for p in plans if p["test_round_id"] == rolled["id"])
    assert round_plan["frame_rows"] == 2
    assert round_plan["explanation"].startswith(f"Sampled only from {year}-03-11")
    assert next(p for p in plans if p["test_round_id"] is None)["status"] == "APPROVED"
    _accept_population(client, team, round_plan["engagement_control_id"], "ROLLFORWARD")
    round_approved = client.post(
        f"{base}/control-tests/{round_plan['id']}/approve", json={"version": round_plan["version"]}
    ).json()
    assert round_approved["sample_request_id"] is not None
    sheets = _sheets(client, team)
    round_sheet = next(s for s in sheets if s["test_round_id"] == rolled["id"])
    assert round_sheet["round_kind"] == "ROLLFORWARD"
    assert sorted(item["label"] for item in round_sheet["items"]) == ["u0010", "u0011"]
    assert _rounds(client, team)[0]["status"] == "TESTING"

    # Its evidence goes to the round's sheet; interim testing is left alone.
    with connect(migrated.url) as connection:
        before = connection.execute(
            "SELECT count(*) FROM test_sheet_files WHERE test_sheet_id = %s", (interim["id"],)
        ).fetchone()
    later = "ticket,user,approved_by\nT-10,u0010,Demo Manager\nT-11,u0011,Demo Manager\n"
    _add(client, team, "rollforward tickets.csv", later, round_approved["sample_request_id"])
    _read_all(migrated, scheduler)
    signed_round = _test_and_sign(migrated, client, team, round_sheet)
    assert signed_round["conclusion"] == "EFFECTIVE"
    with connect(migrated.url) as connection:
        after = connection.execute(
            "SELECT count(*) FROM test_sheet_files WHERE test_sheet_id = %s", (interim["id"],)
        ).fetchone()
    assert before == after
    [done] = _rounds(client, team)
    assert (done["status"], done["conclusion"]) == ("SIGNED_OFF", "EFFECTIVE")
    assert _task(migrated, done["task_id"])[0] == "SUCCEEDED"
    # A roll-forward is never started twice for the same interim result.
    assert len(_rounds(client, team)) == 1


def test_a_logged_deficiency_is_remediated_and_retested(migrated: Database) -> None:
    team, client, sheet, _ticket = _tested_control(migrated, "retest")
    base = _base(team)
    # Interim testing found an exception: no roll-forward, a deficiency is proposed.
    assert _rounds(client, team) == []
    logged = client.post(
        f"{base}/test-sheets/{sheet['id']}/deficiency",
        json={"version": _sheets(client, team)[0]["version"], "action": "LOG"},
    )
    assert logged.status_code == 200, logged.text
    [deficiency] = client.get(f"{base}/deficiencies").json()
    assert deficiency["remediation_request_id"] is not None
    status, text = _request_row(migrated, deficiency["remediation_request_id"])
    assert status == "DRAFT"
    assert text.startswith(f"Remediation of {deficiency['reference']} on ITGC-AC-01")
    with connect(migrated.url) as connection:
        remediation = connection.execute(
            "SELECT status::text, phase_key FROM tasks WHERE plan_kind = 'remediation' "
            "AND project_id = %s",
            (team["project"],),
        ).fetchone()
    assert remediation == ("READY", "REMEDIATION")

    def progress(current: dict[str, Any], **body: Any) -> dict[str, Any]:
        moved = client.post(
            f"{base}/deficiencies/{deficiency['id']}/progress",
            json={"version": current["version"], **body},
        )
        assert moved.status_code == 200, moved.text
        result: dict[str, Any] = moved.json()
        return result

    current = progress(deficiency, status="REMEDIATION_IN_PROGRESS")
    fixed = date.today() - timedelta(days=90)
    current = progress(current, status="READY_FOR_RETEST", remediated_on=fixed.isoformat())
    [retest] = _rounds(client, team)
    assert (retest["kind"], retest["deficiency_reference"]) == ("RETEST", deficiency["reference"])
    with connect(migrated.url) as connection:
        control = connection.execute(
            "SELECT frequency, nature FROM engagement_controls WHERE id = %s",
            (retest["control_id"],),
        ).fetchone()
    assert control is not None
    method, size, days = retest_rule(str(control[0]), str(control[1]))
    assert (retest["method"], retest["sample_size"]) == (method, size)
    assert retest["window_start"] == fixed.isoformat()
    assert retest["test_from"] == (fixed + timedelta(days=days)).isoformat()
    assert _request_row(migrated, retest["request_id"])[1].startswith(
        "Remediation retest for ITGC-AC-01"
    )

    # Going back to remediation withdraws the retest and its draft request.
    current = progress(current, status="REMEDIATION_IN_PROGRESS")
    [cancelled] = _rounds(client, team)
    assert cancelled["status"] == "CANCELLED"
    assert _request_row(migrated, cancelled["request_id"])[0] == "CANCELLED"
    assert _task(migrated, cancelled["task_id"])[0] == "CANCELLED"

    # Ready again: a second retest, sampled only from after the fix.
    current = progress(current, status="READY_FOR_RETEST", remediated_on=fixed.isoformat())
    second = next(r for r in _rounds(client, team) if r["status"] == "REQUESTED")
    assert second["number"] == 2
    after = (
        "User ID,Name,Date granted\n"
        + "".join(
            f"u100{n},Fixed User {n},{(fixed + timedelta(days=n)).isoformat()}\n"
            for n in range(1, 4)
        )
        + f"u0999,Before Fix,{(fixed - timedelta(days=5)).isoformat()}\n"
    )
    _add(client, team, "after the fix.csv", after, second["request_id"])
    # Remediation precedes retesting (W4): the fix and its support arrive on the
    # remediation request before the retest is sampled.
    _add(
        client, team, "fix evidence.txt", "Approval step added; screenshot attached.",
        deficiency["remediation_request_id"],
    )  # fmt: skip
    scheduler = _engagement_scheduler(team)
    _read_all(migrated, scheduler)
    plan = next(p for p in _plans(client, team) if p["test_round_id"] == second["id"])
    assert plan["frame_rows"] == 3
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    ).json()
    retest_sheet = next(s for s in _sheets(client, team) if s["test_round_id"] == second["id"])
    assert retest_sheet["round_kind"] == "RETEST"
    tickets = "ticket,user,approved_by\n" + "".join(
        f"T-{n},{item['label']},Demo Manager\n" for n, item in enumerate(retest_sheet["items"])
    )
    _add(client, team, "fixed tickets.csv", tickets, approved["sample_request_id"])
    _read_all(migrated, scheduler)
    signed = _test_and_sign(migrated, client, team, retest_sheet)
    # A passing retest proposes no new deficiency: it remediates the one it retests.
    assert (signed["conclusion"], signed["proposal_status"]) == ("EFFECTIVE", "NONE")
    # The result is recorded at once; the deficiency is remediated only once the round's
    # own independent review signs off (workflow integrity W2, test_round_reviews).
    final = client.get(f"{base}/deficiencies").json()[0]
    assert (final["status"], final["retest_result"]) == ("READY_FOR_RETEST", "PASSED")
    [retest_review] = [
        r for r in client.get(f"{base}/reviews").json() if r["test_round_id"] == second["id"]
    ]
    assert (retest_review["status"], retest_review["round_kind"]) == ("OPEN", "RETEST")
    reopened = client.post(
        f"{base}/test-sheets/{retest_sheet['id']}/reopen",
        json={"version": signed["version"], "reason": "Second look"},
    )
    assert reopened.status_code == 409


def _engagement_scheduler(team: dict[str, Any]) -> Any:
    """The scheduler the engagement's client queued analyses on."""
    scheduler: Any = team["scheduler"]
    return scheduler
