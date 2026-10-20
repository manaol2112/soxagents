"""Independent review of testing rounds (workflow integrity W2, migration 0090): a
roll-forward or retest round signed off gets a review of its own, re-performed on the
round's sheet and signed with what it covered; a prior review never covers later work;
a retest remediates its deficiency only once its review is signed off."""

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from support import Database
from test_control_progress import _controls
from test_evidence_intake import _accept_population, _engagement, _request
from test_outbound import _session, migrated
from test_test_rounds import (
    _engagement_scheduler,
    _plans,
    _rounds,
    _sheets,
    _test_and_sign,
)
from test_testing_engine import _add, _answer, _base, _Citing, _read_all, _year
from test_workpapers import _tested_control

from ai_workforce_api.control_reviews import run_reperformance
from ai_workforce_api.db import connect
from ai_workforce_api.testing_engine import run_sheet

__all__ = ["migrated"]


def _rolled_forward(migrated: Database, slug: str) -> tuple[dict[str, Any], Any, dict[str, Any]]:
    """Interim testing effective and signed off, then the roll-forward round tested and
    signed off too (test_test_rounds walks the same path)."""
    team, client, scheduler = _engagement(migrated, slug)
    base = _base(team)
    year = _year(migrated, team)
    kickoff = _request(migrated, team, "ITGC-AC-01")
    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    [plan] = _plans(client, team)
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
    assert _test_and_sign(migrated, client, team, interim)["conclusion"] == "EFFECTIVE"
    [rolled] = _rounds(client, team)
    rest = (
        "User ID,Name,Date granted\n"
        f"u0009,Early User,{year}-02-01\n"
        f"u0010,Later User,{year}-05-10\n"
        f"u0011,Last User,{year}-06-10\n"
    )
    _add(client, team, "rollforward population.csv", rest, rolled["request_id"])
    _read_all(migrated, scheduler)
    round_plan = next(p for p in _plans(client, team) if p["test_round_id"] == rolled["id"])
    _accept_population(client, team, round_plan["engagement_control_id"], "ROLLFORWARD")
    round_approved = client.post(
        f"{base}/control-tests/{round_plan['id']}/approve", json={"version": round_plan["version"]}
    ).json()
    round_sheet = next(s for s in _sheets(client, team) if s["test_round_id"] == rolled["id"])
    later = "ticket,user,approved_by\nT-10,u0010,Demo Manager\nT-11,u0011,Demo Manager\n"
    _add(client, team, "rollforward tickets.csv", later, round_approved["sample_request_id"])
    _read_all(migrated, scheduler)
    assert _test_and_sign(migrated, client, team, round_sheet)["conclusion"] == "EFFECTIVE"
    [done] = _rounds(client, team)
    assert done["status"] == "SIGNED_OFF"
    return team, client, done


def _sign_review(
    migrated: Database, client: Any, team: dict[str, Any], review_id: str
) -> dict[str, Any]:
    """The reviewer agent re-performs (rules, no model), the reviewer dismisses what it
    proposed with a reason, and signs the review off."""
    base = _base(team)
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review_id)) == "DONE"
    # The effectiveness workpaper is prepared for the round's results by a person, as the
    # review requires (the round's sign-off opened it again from the signed testing).
    with connect(migrated.url) as connection:
        connection.execute(
            """
            UPDATE workpapers SET status = 'PREPARED', prepared_by = %s,
                prepared_at = clock_timestamp(), prepared_version = current_version,
                version = version + 1
            WHERE project_id = %s AND stage = 'EFFECTIVENESS' AND engagement_control_id = (
                SELECT engagement_control_id FROM control_reviews WHERE id = %s)
            """,
            (team["owner_id"], team["project"], review_id),
        )
        connection.commit()
    reviewer = _session(migrated, team["reviewer_id"])
    path = f"{base}/reviews/{review_id}"
    review = next(r for r in client.get(f"{base}/reviews").json() if r["id"] == review_id)
    for note in review["notes"]:
        if note["status"] == "PROPOSED":
            decided = reviewer.post(
                f"{path}/notes/{note['id']}/decide",
                json={"version": review["version"], "action": "DISMISS", "reason": "Reviewed."},
            )
            assert decided.status_code == 200, decided.text
            review = decided.json()
    signed = reviewer.post(
        f"{path}/sign-off", json={"version": review["version"], "note": "Reviewed."}
    )
    assert signed.status_code == 200, signed.text
    body: dict[str, Any] = signed.json()
    return body


def test_a_signed_round_gets_its_own_review_covering_its_sheet(migrated: Database) -> None:
    team, client, rolled = _rolled_forward(migrated, "round-review")
    base = _base(team)
    reviews = client.get(f"{base}/reviews").json()
    # The round's review opened at its sign-off; the control's own review (opened by the
    # effectiveness workpaper) is separate, and neither stands for the other.
    round_review = next(r for r in reviews if r["test_round_id"] == rolled["id"])
    assert (round_review["status"], round_review["round_kind"]) == ("OPEN", "ROLLFORWARD")
    assert all(r["test_round_id"] != rolled["id"] for r in reviews if r["id"] != round_review["id"])
    round_sheet = next(s for s in _sheets(client, team) if s["test_round_id"] == rolled["id"])
    assert round_review["sheet_status"] == "SIGNED_OFF"
    assert round_review["sheet_version"] == round_sheet["version"]
    # Before its review signs, the control is held by it, in those words.
    row = _controls(client, team)[rolled["control_id"]]
    held = [item["text"] for item in row["not_final"]]
    assert "Independent review of the roll-forward round outstanding" in held
    [state] = [r for r in row["round_reviews"] if r["round_id"] == rolled["id"]]
    assert state["status"] == "OPEN"
    signed = _sign_review(migrated, client, team, round_review["id"])
    assert signed["status"] == "SIGNED_OFF"
    # The review re-performed the round's sheet, not the interim one, and recorded what
    # it covered: that sheet at that version, the round, the workpapers it saw.
    assert signed["sheet_version_reviewed"] == round_sheet["version"]
    coverage = signed["coverage"]
    assert coverage["sheet_id"] == round_sheet["id"]
    assert coverage["sheet_version"] == round_sheet["version"]
    assert coverage["test_round_id"] == rolled["id"]
    assert isinstance(coverage["workpapers"], list)
    row = _controls(client, team)[rolled["control_id"]]
    assert "Independent review of the roll-forward round outstanding" not in [
        item["text"] for item in row["not_final"]
    ]
    assert next(r for r in _rounds(client, team) if r["id"] == rolled["id"])["review_status"] == (
        "SIGNED_OFF"
    )
    journey = row["journey"]
    assert next(p for p in journey["phases"] if p["phase"] == "ROLLFORWARD")["state"] == "REVIEWED"


def test_a_retest_remediates_its_deficiency_only_once_its_review_is_signed(
    migrated: Database,
) -> None:
    team, client, sheet, _ticket = _tested_control(migrated, "round-retest-review")
    base = _base(team)
    logged = client.post(
        f"{base}/test-sheets/{sheet['id']}/deficiency",
        json={"version": _sheets(client, team)[0]["version"], "action": "LOG"},
    )
    assert logged.status_code == 200, logged.text
    [deficiency] = client.get(f"{base}/deficiencies").json()

    def progress(current: dict[str, Any], **body: Any) -> dict[str, Any]:
        moved = client.post(
            f"{base}/deficiencies/{deficiency['id']}/progress",
            json={"version": current["version"], **body},
        )
        assert moved.status_code == 200, moved.text
        result: dict[str, Any] = moved.json()
        return result

    fixed = date.today() - timedelta(days=90)
    current = progress(deficiency, status="REMEDIATION_IN_PROGRESS")
    current = progress(current, status="READY_FOR_RETEST", remediated_on=fixed.isoformat())
    [retest] = _rounds(client, team)
    after = "User ID,Name,Date granted\n" + "".join(
        f"u100{n},Fixed User {n},{(fixed + timedelta(days=n)).isoformat()}\n" for n in range(1, 4)
    )
    _add(client, team, "after the fix.csv", after, retest["request_id"])
    # Remediation precedes retesting (W4): the remediation evidence arrives first.
    _add(
        client, team, "fix evidence.txt", "Approval step added; screenshot attached.",
        deficiency["remediation_request_id"],
    )  # fmt: skip
    scheduler = _engagement_scheduler(team)
    _read_all(migrated, scheduler)
    plan = next(p for p in _plans(client, team) if p["test_round_id"] == retest["id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    ).json()
    retest_sheet = next(s for s in _sheets(client, team) if s["test_round_id"] == retest["id"])
    tickets = "ticket,user,approved_by\n" + "".join(
        f"T-{n},{item['label']},Demo Manager\n" for n, item in enumerate(retest_sheet["items"])
    )
    _add(client, team, "fixed tickets.csv", tickets, approved["sample_request_id"])
    _read_all(migrated, scheduler)
    signed = _test_and_sign(migrated, client, team, retest_sheet)
    assert signed["conclusion"] == "EFFECTIVE"
    # The retest passed, but the deficiency is remediated only once the round's review
    # signs off (owner's decision 2); until then the result is recorded, the status held.
    held = client.get(f"{base}/deficiencies").json()[0]
    assert (held["status"], held["retest_result"]) == ("READY_FOR_RETEST", "PASSED")
    review = next(
        r for r in client.get(f"{base}/reviews").json() if r["test_round_id"] == retest["id"]
    )
    assert review["round_kind"] == "RETEST"
    _sign_review(migrated, client, team, review["id"])
    remediated = client.get(f"{base}/deficiencies").json()[0]
    assert (remediated["status"], remediated["retest_result"]) == ("REMEDIATED", "PASSED")


def _test_and_sign_failing(
    migrated: Database, client: Any, team: dict[str, Any], sheet: dict[str, Any]
) -> dict[str, Any]:
    """The first attribute fails on every item, and the sheet is signed off."""
    provider = _Citing(
        [_answer(["EXCEPTION"] + ["PASS"] * (len(sheet["attributes"]) - 1))] * len(sheet["items"])
    )
    with connect(migrated.url) as connection:
        run_sheet(connection, provider, UUID(sheet["id"]))
    current = next(s for s in _sheets(client, team) if s["id"] == sheet["id"])
    assert current["proposed_conclusion"] == "NOT_EFFECTIVE", current["blocking"]
    signed = client.post(
        f"{_base(team)}/test-sheets/{sheet['id']}/sign-off", json={"version": current["version"]}
    )
    assert signed.status_code == 200, signed.text
    body: dict[str, Any] = signed.json()
    return body


def _retest_round(
    migrated: Database, slug: str
) -> tuple[dict[str, Any], Any, dict[str, Any], dict[str, Any]]:
    """A logged deficiency fixed and ready for retest, its round requested, its evidence
    in and its samples approved: the retest sheet is ready to run."""
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
    # Remediation precedes retesting (W4): the remediation evidence arrives first.
    _add(
        client, team, "fix evidence.txt", "Approval step added; screenshot attached.",
        deficiency["remediation_request_id"],
    )  # fmt: skip
    scheduler = _engagement_scheduler(team)
    _read_all(migrated, scheduler)
    plan = next(p for p in _plans(client, team) if p["test_round_id"] == retest["id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    ).json()
    retest_sheet = next(s for s in _sheets(client, team) if s["test_round_id"] == retest["id"])
    tickets = "ticket,user,approved_by\n" + "".join(
        f"T-{n},{item['label']},Demo Manager\n" for n, item in enumerate(retest_sheet["items"])
    )
    _add(client, team, "fixed tickets.csv", tickets, approved["sample_request_id"])
    _read_all(migrated, scheduler)
    return team, client, retest, retest_sheet


def test_a_failed_retest_is_never_remediated_by_its_review(migrated: Database) -> None:
    team, client, retest, retest_sheet = _retest_round(migrated, "round-retest-failed")
    base = _base(team)
    signed = _test_and_sign_failing(migrated, client, team, retest_sheet)
    # A failed retest proposes no new deficiency: it sends the one it retests back to
    # remediation at once, with the result recorded.
    assert (signed["conclusion"], signed["proposal_status"]) == ("NOT_EFFECTIVE", "NONE")
    failed = client.get(f"{base}/deficiencies").json()[0]
    assert (failed["status"], failed["retest_result"]) == ("REMEDIATION_IN_PROGRESS", "FAILED")
    # Its round review opens all the same, and signing it changes nothing about the
    # deficiency: a reviewer's sign-off never remediates continuing exceptions.
    review = next(
        r for r in client.get(f"{base}/reviews").json() if r["test_round_id"] == retest["id"]
    )
    signed_review = _sign_review(migrated, client, team, review["id"])
    assert signed_review["status"] == "SIGNED_OFF"
    still = client.get(f"{base}/deficiencies").json()[0]
    assert (still["status"], still["retest_result"]) == ("REMEDIATION_IN_PROGRESS", "FAILED")
    with connect(migrated.url) as connection:
        remediated = connection.execute(
            "SELECT count(*) FROM audit_events WHERE target_id = %s "
            "AND payload ->> 'status' = 'REMEDIATED'",
            (failed["id"],),
        ).fetchone()
    assert remediated is not None and remediated[0] == 0
    row = _controls(client, team)[retest["control_id"]]
    assert row["final"] is False


def test_a_must_fix_note_on_a_round_review_reopens_the_round_and_keeps_its_history(
    migrated: Database,
) -> None:
    team, client, rolled = _rolled_forward(migrated, "round-review-reopen")
    base = _base(team)
    round_sheet = next(s for s in _sheets(client, team) if s["test_round_id"] == rolled["id"])
    review = next(
        r for r in client.get(f"{base}/reviews").json() if r["test_round_id"] == rolled["id"]
    )
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"
        [(signed_by, signed_at, reopened_at)] = connection.execute(
            "SELECT signed_by, signed_at, reopened_at FROM test_sheet_signoffs "
            "WHERE test_sheet_id = %s",
            (round_sheet["id"],),
        ).fetchall()
    assert signed_by is not None and reopened_at is None
    reviewer = _session(migrated, team["reviewer_id"])
    review = next(r for r in client.get(f"{base}/reviews").json() if r["id"] == review["id"])
    raised = reviewer.post(
        f"{base}/reviews/{review['id']}/notes",
        json={
            "version": review["version"],
            "target_kind": "RESULT",
            "severity": "MUST_FIX",
            "text": "Attribute A: T-10 was approved by the requester. Test it again.",
            "item_id": round_sheet["items"][0]["id"],
        },
    )
    assert raised.status_code == 200, raised.text
    note = next(n for n in raised.json()["notes"] if n["raised_by"] == "PERSON")
    assert note["reopened"][0] == "SHEET"
    # The round's sheet reopened (not the interim one), the round is testing again, the
    # review waits behind it, and the earlier sign-off stays on record, marked reopened.
    sheets = {s["id"]: s for s in _sheets(client, team)}
    assert sheets[round_sheet["id"]]["status"] == "OPEN"
    interim = next(s for s in sheets.values() if s["test_round_id"] is None)
    assert interim["status"] == "SIGNED_OFF"
    assert next(r for r in _rounds(client, team) if r["id"] == rolled["id"])["status"] == "TESTING"
    assert "the testing is not signed off" in raised.json()["blocking"]
    row = _controls(client, team)[rolled["control_id"]]
    assert row["journey"]["phases"][2]["state"] == "TESTING"
    with connect(migrated.url) as connection:
        history = connection.execute(
            "SELECT signed_by, signed_at, reopened_at, reopened_from, reopen_reason "
            "FROM test_sheet_signoffs WHERE test_sheet_id = %s ORDER BY signed_at",
            (round_sheet["id"],),
        ).fetchall()
    assert len(history) == 1
    assert (history[0][0], history[0][1]) == (signed_by, signed_at)
    assert history[0][2] is not None and history[0][3] == "REVIEW_NOTE"
    assert history[0][4].startswith("Review note:")
    # Signed off again: a second sign-off on record, the first still there.
    assert _test_and_sign(migrated, client, team, sheets[round_sheet["id"]])["conclusion"] == (
        "EFFECTIVE"
    )
    with connect(migrated.url) as connection:
        count = connection.execute(
            "SELECT count(*), count(*) FILTER (WHERE reopened_at IS NULL) "
            "FROM test_sheet_signoffs WHERE test_sheet_id = %s",
            (round_sheet["id"],),
        ).fetchone()
    assert count == (2, 1)
