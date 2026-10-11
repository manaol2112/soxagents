"""Population checks and seeded selection, and the test plan API."""

import hashlib
from datetime import date
from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from support import Database
from test_evidence_review import _base, _client, _sent_engagement_request
from test_execution import _add_project_member, _add_user
from test_outbound import migrated

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.evidence_extraction import Table, read_table
from ai_workforce_api.sampling import build_frame, parse_date, period_bounds, select
from ai_workforce_api.settings import Settings

_ = migrated

# Pure rules


def _table(rows: list[list[str]], columns: tuple[str, ...]) -> Table:
    return Table(sheet="Sheet", columns=columns, rows=tuple(tuple(r) for r in rows), note="")


def test_the_same_frame_size_and_seed_always_give_the_same_rows() -> None:
    frame = tuple(range(300))
    first = select(frame, 25, 424242)
    assert first == select(frame, 25, 424242)
    assert first != select(frame, 25, 424243)
    assert first == sorted(first)
    assert len(set(first)) == 25
    assert select(frame[:3], 25, 1) == [0, 1, 2]


def test_the_frame_keeps_rows_dated_in_the_period_and_flags_the_rest() -> None:
    columns = ("Ticket", "User", "Date granted")
    rows = [[f"REQ-{n}", f"user{n}", f"2027-{(n % 12) + 1:02d}-15"] for n in range(30)]
    rows += [["REQ-900", "early", "2026-11-30"], ["REQ-901", "late", "2028-01-02"]]
    rows += [["REQ-902", "nodate", "soon"]]
    frame = build_frame(_table(rows, columns), date(2027, 12, 31), "EVENT_DRIVEN")
    assert frame.key_column == 0
    assert frame.date_column == 2
    assert len(frame.rows) == 30
    assert frame.excluded == 3
    period = next(check for check in frame.checks if check.check == "period")
    assert period.result == "ISSUE"
    assert "2 rows outside it" in period.detail
    assert "1 row without a readable date" in period.detail
    assert next(c for c in frame.checks if c.check == "key").result == "OK"


def test_a_short_or_duplicated_population_is_flagged() -> None:
    columns = ("Review ID", "Quarter", "Date performed")
    rows = [["QR-1", "Q1", "2027-03-31"], ["QR-1", "Q2", "2027-06-30"], ["", "Q3", "2027-09-30"]]
    frame = build_frame(_table(rows, columns), date(2027, 12, 31), "QUARTERLY")
    by_check = {check.check: check for check in frame.checks}
    assert by_check["rows"].result == "ISSUE"
    assert "about 4" in by_check["rows"].detail
    assert by_check["key"].result == "ISSUE"
    assert "1 repeated and 1 blank" in by_check["key"].detail
    no_dates = build_frame(_table([["a"], ["b"]], ("Name",)), date(2027, 12, 31), "EVENT_DRIVEN")
    assert len(no_dates.rows) == 2
    assert next(c for c in no_dates.checks if c.check == "period").result == "INFO"


def test_dates_and_periods_are_read_as_written() -> None:
    assert parse_date("2027-03-04") == date(2027, 3, 4)
    assert parse_date("2027-03-04T10:00:00") == date(2027, 3, 4)
    assert parse_date("03/04/2027") == date(2027, 3, 4)
    assert parse_date("4 Mar 2027") == date(2027, 3, 4)
    assert parse_date("31/31/2027") is None
    assert parse_date("next week") is None
    assert period_bounds(date(2027, 12, 31)) == (date(2027, 1, 1), date(2027, 12, 31))
    assert period_bounds(date(2028, 2, 29)) == (date(2027, 3, 1), date(2028, 2, 29))


def test_only_workbooks_and_csvs_are_populations() -> None:
    table = read_table(b"Ticket,User\nREQ-1,ann\n\nREQ-2,bob\n", "pop.csv", "text/csv")
    assert table is not None
    assert table.columns == ("Ticket", "User")
    assert table.rows == (("REQ-1", "ann"), ("REQ-2", "bob"))
    assert read_table(b"%PDF-1.4 nope", "pop.pdf", "application/pdf") is None


# Against the database


def test_a_population_gets_a_proposed_test_plan_that_a_person_approves(
    migrated: Database,
) -> None:
    team, client, request = _sent_engagement_request(migrated, "samples", "ITGC-AC-01")
    with connect(migrated.url) as connection:
        found = connection.execute(
            "SELECT period_end FROM engagement_settings WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert found is not None
    period_end = found[0]
    year = period_end.year
    lines = ["User ID,Name,Role granted,Date granted,Ticket,Approver"]
    for n in range(1, 41):
        lines.append(
            f"u{n:04d},Demo User {n},Clerk,{year}-{(n % 12) + 1:02d}-10,REQ-{n},Demo Manager"
        )
    lines.append(f"u9999,Demo Early,Clerk,{year - 1}-06-01,REQ-999,Demo Manager")
    content = ("\n".join(lines) + "\n").encode()
    analysis_id = _store(client, team, request, content, "access_population.csv")
    with connect(migrated.url) as connection:
        run_analysis(
            connection, Settings(database_url=migrated.url), None, analysis_id, _no_engines
        )
    tests = _tests(client, team)
    assert len(tests) == 1
    test = tests[0]
    assert test["control_ref"] == "ITGC-AC-01"
    assert test["status"] == "PROPOSED"
    assert test["sample_size"] == 25
    assert test["population_rows"] == 41
    assert test["frame_rows"] == 40
    assert test["key_column"] == "User ID"
    assert test["date_column"] == "Date granted"
    assert test["population_sha256"] == hashlib.sha256(content).hexdigest()
    assert len(test["samples"]) == 25
    assert all(sample["selection"] == "RANDOM" for sample in test["samples"])
    assert "u9999" not in [sample["key_value"] for sample in test["samples"]]
    assert f"seed {test['seed']}" in test["explanation"]
    # Anyone can draw the same items again from the same file and seed.
    table = read_table(content, "access_population.csv", "text/csv")
    assert table is not None
    frame = build_frame(table, period_end, "EVENT_DRIVEN")
    assert [s["row_number"] for s in test["samples"]] == [
        index + 1 for index in select(frame.rows, 25, int(test["seed"]))
    ]
    base = f"{_base(team['org'], team['project'])}/control-tests/{test['id']}"
    selected = {sample["row_number"] for sample in test["samples"]}
    spare = next(row for row in range(1, 41) if row not in selected)
    vague = client.post(
        f"{base}/samples/1/replace",
        json={
            "version": test["version"],
            "row_number": spare,
            "selection": "TARGETED",
            "reason": "",
        },
    )
    assert vague.status_code == 422
    taken = client.post(
        f"{base}/samples/1/replace",
        json={
            "version": test["version"],
            "row_number": test["samples"][1]["row_number"],
            "selection": "TARGETED",
            "reason": "Already selected",
        },
    )
    assert taken.status_code == 409
    replaced = client.post(
        f"{base}/samples/1/replace",
        json={
            "version": test["version"],
            "row_number": spare,
            "selection": "TARGETED",
            "reason": "Admin role granted outside the normal process; test it specifically.",
        },
    )
    assert replaced.status_code == 200, replaced.text
    first = replaced.json()["samples"][0]
    assert first["row_number"] == spare
    assert first["selection"] == "TARGETED"
    assert first["replaced_by_name"]
    with connect(migrated.url) as connection:
        reviewer_id = _add_user(
            connection, team["org"], f"rv-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, team["org"], team["project"], reviewer_id)
    reviewer = _client(migrated, reviewer_id)
    version = replaced.json()["version"]
    assert reviewer.post(f"{base}/approve", json={"version": version}).status_code == 403
    assert client.post(f"{base}/approve", json={"version": version - 1}).status_code == 409
    approved = client.post(f"{base}/approve", json={"version": version})
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["status"] == "APPROVED"
    assert body["approved_by_name"]
    assert body["sample_request_status"] == "DRAFT"
    with connect(migrated.url) as connection:
        drafted = connection.execute(
            "SELECT recipient, evidence_description, status FROM pbc_requests WHERE id = %s",
            (body["sample_request_id"],),
        ).fetchone()
        original = connection.execute(
            "SELECT status FROM pbc_requests WHERE id = %s", (request["id"],)
        ).fetchone()
    assert drafted is not None
    assert drafted[0] == request["recipient"]
    assert drafted[2] == "DRAFT"
    assert "We selected 25 items" in drafted[1]
    assert f"1. u{spare:04d}" in drafted[1]
    assert original == ("SENT",)
    assert client.post(f"{base}/approve", json={"version": body["version"]}).status_code == 409
    locked = client.post(
        f"{base}/samples/2/replace",
        json={
            "version": body["version"],
            "row_number": 41,
            "selection": "HAPHAZARD",
            "reason": "x" * 5,
        },
    )
    assert locked.status_code == 409
    redraw = client.post(
        f"{_base(team['org'], team['project'])}/control-tests/propose",
        json={"evidence_file_id": test["population_file_id"]},
    )
    assert redraw.status_code == 409
    audit = _audit(migrated)
    for action in (
        "control_test.samples_proposed",
        "control_test.sample_replaced",
        "control_test.samples_approved",
        "pbc.sample_request_drafted",
    ):
        assert action in audit
    assert "itgc-access-tester" in audit


def test_a_person_can_draw_again_with_a_new_seed_before_approval(migrated: Database) -> None:
    team, client, request = _sent_engagement_request(migrated, "redraw", "ITGC-AC-01")
    lines = ["Ticket,User"] + [f"REQ-{n},user{n}" for n in range(60)]
    analysis_id = _store(client, team, request, ("\n".join(lines) + "\n").encode(), "pop.csv")
    with connect(migrated.url) as connection:
        run_analysis(
            connection, Settings(database_url=migrated.url), None, analysis_id, _no_engines
        )
    first = _tests(client, team)[0]
    again = client.post(
        f"{_base(team['org'], team['project'])}/control-tests/propose",
        json={"evidence_file_id": first["population_file_id"]},
    )
    assert again.status_code == 200
    assert again.json()["seed"] != first["seed"]
    assert again.json()["version"] == first["version"] + 1
    assert len(again.json()["samples"]) == 25


def test_an_automated_control_is_not_sampled(migrated: Database) -> None:
    team, client, request = _sent_engagement_request(migrated, "automated", "ITGC-AC-05")
    lines = ["Setting,Value"] + [f"setting{n},on" for n in range(10)]
    analysis_id = _store(client, team, request, ("\n".join(lines) + "\n").encode(), "settings.csv")
    with connect(migrated.url) as connection:
        run_analysis(
            connection, Settings(database_url=migrated.url), None, analysis_id, _no_engines
        )
    assert _tests(client, team) == []


# Helpers


def _no_engines(choice: Any, provider: Any, record: Any) -> list[Any]:
    del choice, provider, record
    return []


def _store(
    client: TestClient, team: dict[str, Any], request: dict[str, Any], content: bytes, name: str
) -> UUID:
    base = _base(team["org"], team["project"])
    reply = client.post(
        f"{base}/mailbox/simulated-inbound",
        json={
            "notification_key": f"pop-{uuid4().hex[:8]}",
            "sender": f"Owner <{request['recipient']}>",
            "subject": f"RE: [PBC-{UUID(request['id']).hex[-8:].upper()}] Evidence request",
            "body": "Population attached.",
            "thread_id": None,
            "attachments": [
                {
                    "file_name": name,
                    "content_type": "text/csv",
                    "size_bytes": len(content),
                    "content_sha256": hashlib.sha256(content).hexdigest(),
                }
            ],
        },
    )
    assert reply.status_code == 200, reply.text
    stored = client.post(
        f"{base}/mailbox-attachments/{reply.json()['attachments'][0]['id']}/content",
        content=content,
        headers={"content-type": "application/octet-stream"},
    )
    assert stored.status_code == 200, stored.text
    return UUID(client.get(f"{base}/evidence-analyses").json()[0]["id"])


def _tests(client: TestClient, team: dict[str, Any]) -> list[dict[str, Any]]:
    listed = client.get(f"{_base(team['org'], team['project'])}/control-tests")
    assert listed.status_code == 200, listed.text
    body: list[dict[str, Any]] = listed.json()
    return body


def _audit(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT action, payload::text FROM audit_events").fetchall()
    return str(rows)
