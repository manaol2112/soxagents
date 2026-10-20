"""What waits on the team is one list: the inbox the agent console and the dashboard both
show (Milestone 8.12)."""

from typing import Any
from uuid import UUID

from support import Database
from test_evidence_intake import _accept_population, _engagement, _request
from test_outbound import _session, migrated
from test_testing_engine import _add, _answer, _base, _Citing, _read_all, _sheet, _year

from ai_workforce_api.db import connect
from ai_workforce_api.testing_engine import run_sheet

_ = migrated


def test_open_test_results_and_late_evidence_wait_on_the_team(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "waiting")
    base = _base(team)
    year = _year(migrated, team)
    kickoff = _request(migrated, team, "ITGC-AC-01")
    population = "User ID,Name,Date granted,Ticket\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10,REQ-{n}\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    plan = client.get(f"{base}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    sheet = _sheet(client, team)
    labels = [item["label"] for item in sheet["items"]]
    attributes = len(sheet["attributes"])
    samples = approved.json()["sample_request_id"]
    _add(client, team, "approvals.csv", f"ticket,user\nA-1,{labels[0]}\nA-2,{labels[1]}\n", samples)
    _add(client, team, f"{labels[2]} ticket.txt", "Approved by Demo Manager.", samples)
    _read_all(migrated, scheduler)
    provider = _Citing(
        [
            _answer(["PASS"] * attributes),
            _answer(["PASS"] * attributes),
            _answer(["PASS", "UNABLE"] + ["PASS"] * (attributes - 2)),
        ]
    )
    with connect(migrated.url) as connection:
        assert run_sheet(connection, provider, UUID(sheet["id"])) == "DONE"
    # A request is sent, then falls past due.
    late_id = _send(migrated, team, client, "ITGC-CM-01")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'OVERDUE', due_at = clock_timestamp() - "
            "interval '2 days' WHERE id = %s",
            (late_id,),
        )
    waiting = _waiting(client, team)
    results = [item for item in waiting if item["kind"] == "results"]
    assert results == [
        {
            "kind": "results",
            "title": "Decide the open test results for ITGC-AC-01",
            "detail": "Results the tester could not settle",
            "control_ref": "ITGC-AC-01",
            "link": "controls",
            "control_id": plan["engagement_control_id"],
            "tab": "interim",
        }
    ]
    # Past due: the engagement-wide count (the console's own summary, kept until the
    # console page retires) and, from the one queue (M2a/M2b), the control's own step,
    # "chase", the team's to do.
    late = [item for item in waiting if item["kind"] == "late"]
    assert sorted(item["title"] for item in late) == [
        "1 evidence request past due",
        "Chase the overdue evidence request",
    ]
    assert [item["control_ref"] for item in late if item["control_ref"]] == ["ITGC-CM-01"]
    # Drafted requests still wait to be submitted.
    assert any(item["kind"] == "drafts" for item in waiting)


def _send(database: Database, team: dict[str, Any], client: Any, ref: str) -> str:
    request = _request(database, team, ref)
    base = _base(team)
    submitted = client.post(
        f"{base}/pbc-requests/{request['id']}/submit", json={"version": request["version"]}
    )
    assert submitted.status_code == 200, submitted.text
    approval = submitted.json()["approval"]["id"]
    admin = _session(database, team["reviewer_id"])
    decided = admin.post(
        f"{base}/approvals/{approval}/decision",
        json={"decision": "APPROVED", "reason": "Checked the request"},
    )
    assert decided.status_code == 200, decided.text
    sent = client.post(f"{base}/pbc-requests/{request['id']}/send", json={"approval_id": approval})
    assert sent.status_code == 200, sent.text
    return str(request["id"])


def _waiting(client: Any, team: dict[str, Any]) -> list[dict[str, Any]]:
    inbox = client.get(f"{_base(team)}/console/inbox")
    assert inbox.status_code == 200, inbox.text
    items: list[dict[str, Any]] = inbox.json()["waiting"]
    return items
