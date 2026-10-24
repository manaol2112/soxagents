"""The engagement's evidence command center (migration 0076): one list of every request,
filtered, sorted, and paged on the server; figures from the records; saved views; and
changes to many requests at once, each checked and audited as a single change is."""

import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_evidence_flow import _drafted, _launch, _project
from test_execution import _add_project_member, _add_user
from test_onboarding import _complete_setup, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_center import lifecycle_of

__all__ = ["migrated"]


def _ready(migrated: Database, slug: str) -> dict[str, Any]:
    team = _new_engagement(migrated, slug)
    _complete_setup(team["owner"], team)
    _launch(team["owner"], team)
    _drafted(migrated, team)
    return team


def _list(client: Any, team: dict[str, Any], **params: Any) -> dict[str, Any]:
    read = client.get(f"{_project(team)}/evidence-requests", params=params)
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _all(client: Any, team: dict[str, Any], **params: Any) -> list[dict[str, Any]]:
    body = _list(client, team, size=200, **params)
    rows: list[dict[str, Any]] = body["rows"]
    page = 1
    while len(rows) < body["total"]:
        page += 1
        rows += _list(client, team, size=200, page=page, **params)["rows"]
    return rows


def _bulk(client: Any, team: dict[str, Any], rows: list[dict[str, Any]], **body: Any) -> Any:
    return client.post(
        f"{_project(team)}/evidence-requests/bulk",
        json={"items": [{"id": row["id"], "version": row["version"]} for row in rows], **body},
    )


def test_the_lifecycle_is_read_from_the_records() -> None:
    assert lifecycle_of("DRAFT", None, True, True, False, []) == "READY_FOR_REVIEW"
    assert lifecycle_of("DRAFT", None, False, True, False, []) == "DRAFT"
    assert lifecycle_of("DRAFT", None, True, False, False, []) == "DRAFT"
    assert lifecycle_of("DRAFT", "REJECTED", True, True, False, []) == "CHANGES_REQUESTED"
    assert lifecycle_of("APPROVAL_PENDING", "PENDING", True, True, False, []) == (
        "READY_FOR_REVIEW"
    )
    assert lifecycle_of("APPROVAL_PENDING", "APPROVED", True, True, False, []) == "APPROVED"
    # Sent is awaiting evidence: one stage, not two.
    assert lifecycle_of("SENT", "APPROVED", True, True, False, []) == "AWAITING_EVIDENCE"
    assert lifecycle_of("SENT", "APPROVED", True, True, True, []) == "CLARIFICATION_NEEDED"
    assert lifecycle_of("OVERDUE", None, True, True, False, []) == "AWAITING_EVIDENCE"
    assert lifecycle_of("WAITING_FOR_RESPONSE", None, True, True, True, []) == (
        "CLARIFICATION_NEEDED"
    )
    assert lifecycle_of("PARTIALLY_RECEIVED", None, True, True, False, []) == ("PARTIALLY_RECEIVED")
    # A file arriving never completes a request: a person judges each item.
    received = [("RECEIVED", "NOT_REVIEWED"), ("RECEIVED", "NOT_REVIEWED")]
    assert lifecycle_of("RECEIVED", None, True, True, False, received) == "EVIDENCE_RECEIVED"
    assert lifecycle_of("RECEIVED", None, True, True, False, []) == "EVIDENCE_RECEIVED"
    # A requirement's sufficiency is a person's judgment: ACCEPTED, never the reader's
    # SUFFICIENT proposal (the expectation corrected in Release 2b-3; docs/release-2b.md).
    judging = [("RECEIVED", "ACCEPTED"), ("RECEIVED", "NOT_REVIEWED")]
    assert lifecycle_of("RECEIVED", None, True, True, False, judging) == "UNDER_REVIEW"
    done = [("RECEIVED", "ACCEPTED"), ("WAIVED", "NOT_REVIEWED")]
    assert lifecycle_of("RECEIVED", None, True, True, False, done) == "READY_FOR_TESTING"
    assert lifecycle_of("CLOSED", None, True, True, False, []) == "COMPLETED"
    assert lifecycle_of("CANCELLED", "REJECTED", True, True, False, []) == "REJECTED"
    assert lifecycle_of("CANCELLED", None, True, True, False, []) == "CANCELLED"


def test_an_engagement_with_no_requests_shows_none(migrated: Database) -> None:
    team = _new_engagement(migrated, "ec-empty")
    body = _list(team["owner"], team)
    assert body["rows"] == [] and body["total"] == 0
    assert body["kpis"] == {
        "total": 0,
        "needs_assignment": 0,
        "awaiting_approval": 0,
        "awaiting_client": 0,
        "received": 0,
        "needs_review": 0,
        "overdue": 0,
        "completed": 0,
    }
    assert [view["id"] for view in body["views"]][:3] == ["all", "mine", "attention"]


def test_the_list_filters_sorts_and_pages_on_the_server(migrated: Database) -> None:
    team = _ready(migrated, "ec-list")
    owner = team["owner"]
    first = _list(owner, team, size=25)
    total = first["total"]
    assert total > 25 and len(first["rows"]) == 25
    assert first["kpis"]["total"] == total
    row = first["rows"][0]
    # One line per request: its title, never the wording.
    assert set(row) >= {"title", "control_ref", "systems", "phase", "type_label", "stage"}
    assert "evidence_description" not in row
    assert all(not item["title"].startswith("For our") for item in first["rows"])
    every = _all(owner, team)
    assert len(every) == total and len({item["id"] for item in every}) == total
    # Agent drafts with a recipient are ready for review, and counted as awaiting approval.
    ready = [item for item in every if item["stage"] == "READY_FOR_REVIEW" and item["recipient"]]
    assert first["kpis"]["awaiting_approval"] == len(ready)
    assert first["kpis"]["completed"] == 0 and first["kpis"]["received"] == 0
    # A figure filters to exactly the requests it counts.
    approval = _list(owner, team, kpi="awaiting_approval", size=200)
    assert approval["total"] == len(ready)
    # Filters: phase, type, owner, system, search.
    interim = _all(owner, team, phase="INTERIM")
    assert interim and all(item["phase"] == "INTERIM" for item in interim)
    facets = first["facets"]
    a_type = facets["type"][0]["key"]
    typed = _all(owner, team, type=a_type)
    assert len(typed) == facets["type"][0]["count"]
    assert all(item["request_type"] == a_type for item in typed)
    system = next(item["key"] for item in facets["system"] if item["key"] != "NONE")
    assert all(system in item["systems"] for item in _all(owner, team, system=system))
    searched = _all(owner, team, q="itgc-ac-01")
    assert searched and all(item["control_ref"] == "ITGC-AC-01" for item in searched)
    # Sorting by due date, both ways.
    ascending = [item["due_at"] for item in _all(owner, team, sort="due", dir="asc")]
    assert ascending == sorted(ascending)
    descending = [item["control_ref"] for item in _all(owner, team, sort="control", dir="desc")]
    assert descending == sorted(descending, key=str.lower, reverse=True)
    # Bad input is refused, not guessed at.
    refused = owner.get(f"{_project(team)}/evidence-requests", params={"sort": "nonsense"})
    assert refused.status_code == 422
    assert owner.get(f"{_project(team)}/evidence-requests", params={"size": 7}).status_code == 422
    # Another engagement's people cannot read it.
    stranger = _new_engagement(migrated, "ec-list-other")
    hidden = stranger["owner"].get(f"{_project(team)}/evidence-requests")
    assert hidden.status_code in (403, 404)


def test_many_requests_are_assigned_at_once_after_a_preview(migrated: Database) -> None:
    team = _ready(migrated, "ec-assign")
    owner = team["owner"]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET recipient = '' WHERE project_id = %s", (team["project"],)
        )
        connection.commit()
    unassigned = _all(owner, team, view="unassigned")
    assert len(unassigned) == _list(owner, team)["kpis"]["needs_assignment"] > 0
    chosen = unassigned[:50]
    preview = _bulk(owner, team, chosen, action="ASSIGN", recipient="ops@client.example",
                    preview=True)  # fmt: skip
    assert preview.status_code == 200, preview.text
    assert preview.json()["done"] == len(chosen)
    assert _list(owner, team)["kpis"]["needs_assignment"] == len(unassigned)
    outside = _bulk(owner, team, chosen[:1], action="ASSIGN", recipient="x@elsewhere.example")
    assert outside.json()["outcomes"][0]["ok"] is False
    assert "outside the client's email domains" in outside.json()["outcomes"][0]["detail"]
    applied = _bulk(owner, team, chosen, action="ASSIGN", recipient="ops@client.example")
    assert applied.status_code == 200, applied.text
    assert applied.json()["done"] == len(chosen) and applied.json()["refused"] == 0
    assert _list(owner, team)["kpis"]["needs_assignment"] == len(unassigned) - len(chosen)
    with connect(migrated.url) as connection:
        audited = connection.execute(
            "SELECT count(*) FROM audit_events WHERE project_id = %s "
            "AND action = 'pbc.assignment_changed'",
            (team["project"],),
        ).fetchone()
    assert audited is not None and audited[0] == len(chosen)
    # Repeating the same change with the old versions changes nothing twice.
    again = _bulk(owner, team, chosen, action="ASSIGN", recipient="ops@client.example")
    assert again.json()["done"] == 0
    assert all(
        "changed since the list loaded" in item["detail"] for item in again.json()["outcomes"]
    )
    # A due date for many; a date in the past is refused for each.
    fresh = _all(owner, team, owner="ops@client.example")
    due = (datetime.now(UTC) + timedelta(days=30)).date().isoformat()
    moved = _bulk(owner, team, fresh[:5], action="DUE", due_on=due)
    assert moved.json()["done"] == 5
    past = (datetime.now(UTC) - timedelta(days=2)).date().isoformat()
    fresh = _all(owner, team, owner="ops@client.example")
    late = _bulk(owner, team, fresh[:2], action="DUE", due_on=past)
    assert late.json()["done"] == 0
    assert late.json()["outcomes"][0]["detail"] == "The due date cannot be in the past."
    # Each request appears once.
    twice = owner.post(
        f"{_project(team)}/evidence-requests/bulk",
        json={"action": "PRIORITY", "priority": "HIGH",
              "items": [{"id": fresh[0]["id"], "version": fresh[0]["version"]}] * 2},
    )  # fmt: skip
    assert twice.status_code == 422


def test_bulk_approval_skips_requests_without_a_recipient(migrated: Database) -> None:
    team = _ready(migrated, "ec-approve")
    owner = team["owner"]
    rows = _all(owner, team, view="approval")
    assert len(rows) >= 4
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET recipient = '' WHERE id = ANY(%s)",
            ([UUID(item["id"]) for item in rows[:2]],),
        )
        connection.commit()
    rows = [item for item in _all(owner, team) if item["id"] in {r["id"] for r in rows[:4]}]
    # A contributor cannot approve, and someone who may only read cannot change anything.
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], f"c-{uuid4().hex[:6]}@example.com",
                           "CONTRIBUTOR")  # fmt: skip
        reader = _add_user(connection, team["org"], f"r-{uuid4().hex[:6]}@example.com",
                           "REVIEWER")  # fmt: skip
        _add_project_member(connection, team["org"], team["project"], member)
        _add_project_member(connection, team["org"], team["project"], reader)
    assert _bulk(_session(migrated, member), team, rows, action="APPROVE").status_code == 403
    assert _bulk(_session(migrated, reader), team, rows, action="PRIORITY",
                 priority="HIGH").status_code == 403  # fmt: skip
    preview = _bulk(owner, team, rows, action="APPROVE", preview=True).json()
    problems = {item["id"]: item for item in preview["outcomes"]}
    unaddressed = {item["id"] for item in rows if item["recipient"] == ""}
    assert len(unaddressed) == 2
    for request_id in unaddressed:
        assert problems[request_id]["ok"] is False
        assert problems[request_id]["detail"] == "Assign a recipient."
    applied = _bulk(owner, team, rows, action="APPROVE", reason="Checked the batch.").json()
    assert applied["done"] == 2 and applied["refused"] == 2
    after = {item["id"]: item for item in _all(owner, team)}
    approved = [request_id for request_id in after if request_id in {r["id"] for r in rows}
                and request_id not in unaddressed]  # fmt: skip
    for request_id in approved:
        # Approved, not sent: sending stays a separate step.
        assert after[request_id]["stage"] == "APPROVED"
        assert after[request_id]["status"] == "APPROVAL_PENDING"
    with connect(migrated.url) as connection:
        sent = connection.execute(
            "SELECT count(*) FROM outbound_messages WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert sent is not None and sent[0] == 0


def test_bulk_approve_and_send_approves_then_sends_each_through_the_one_send_path(
    migrated: Database,
) -> None:
    """Approve and send (product owner, 22 October 2026): each agent's draft is approved,
    then sent with that approval, both recorded; one without a recipient is refused and
    nothing of it changes; Approve alone still sends nothing."""
    team = _ready(migrated, "ec-approve-send")
    owner = team["owner"]
    rows = _all(owner, team, view="approval")[:3]
    assert len(rows) == 3
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET recipient = '' WHERE id = %s", (UUID(rows[0]["id"]),)
        )
        connection.commit()
        member = _add_user(connection, team["org"], f"c-{uuid4().hex[:6]}@example.com",
                           "CONTRIBUTOR")  # fmt: skip
        _add_project_member(connection, team["org"], team["project"], member)
    rows = [item for item in _all(owner, team) if item["id"] in {r["id"] for r in rows}]
    # Only someone who may approve may approve and send.
    assert _bulk(_session(migrated, member), team, rows, action="APPROVE_SEND").status_code == 403
    preview = _bulk(owner, team, rows, action="APPROVE_SEND", preview=True).json()
    said = {item["id"]: item for item in preview["outcomes"]}
    unaddressed = (
        rows[0]["id"]
        if rows[0]["recipient"] == ""
        else next(item["id"] for item in rows if item["recipient"] == "")
    )
    assert said[unaddressed]["detail"] == "Assign a recipient."
    assert all(
        item["detail"] == "Ready to approve and send."
        for key, item in said.items()
        if key != unaddressed
    )
    with connect(migrated.url) as connection:
        nothing = connection.execute(
            "SELECT count(*) FROM outbound_messages WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert nothing is not None and nothing[0] == 0
    applied = _bulk(owner, team, rows, action="APPROVE_SEND", reason="Checked and sent.").json()
    assert applied["done"] == 2 and applied["refused"] == 1, applied
    outcome = {item["id"]: item for item in applied["outcomes"]}
    for key, item in outcome.items():
        assert item["detail"] == ("Assign a recipient." if key == unaddressed
                                  else "Approved and sent."), item  # fmt: skip
    with connect(migrated.url) as connection:
        sent = connection.execute(
            "SELECT pbc_request_id, status FROM outbound_messages WHERE project_id = %s",
            (team["project"],),
        ).fetchall()
        approvals = connection.execute(
            "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'pbc.updated' "
            "AND payload->>'status' = 'APPROVAL_PENDING'",
            (team["project"],),
        ).fetchone()
    # One message per approved request, each through the one send path, none for the other.
    assert sorted(str(row[0]) for row in sent) == sorted(k for k in outcome if k != unaddressed)
    assert {str(row[1]) for row in sent} == {"ACCEPTED"}
    assert approvals is not None and approvals[0] >= 2
    after = {item["id"]: item for item in _all(owner, team)}
    assert after[unaddressed]["status"] == "DRAFT"


def test_a_persons_request_names_its_control_and_goes_to_someone_else(
    migrated: Database,
) -> None:
    team = _ready(migrated, "ec-person")
    owner = team["owner"]
    control = _all(owner, team)[0]["control_id"]
    created = owner.post(
        f"{_project(team)}/pbc-requests",
        json={
            "operation_key": f"manual-{uuid4().hex[:8]}",
            "control_ref": "ITGC-AC-01",
            "recipient": "iam@client.example",
            "due_at": (datetime.now(UTC) + timedelta(days=9)).isoformat(),
            "evidence_description": "Please provide the signed quarterly access review.",
            "engagement_control_id": control,
            "testing_phase": "INTERIM",
            "request_type": "APPROVAL_EVIDENCE",
            "title": "Q3 access review sign-off",
            "priority": "HIGH",
            "cc_recipients": ["pbc@client.example"],
        },
    )
    assert created.status_code in (200, 201), created.text
    made = created.json()
    assert made["drafted_by"] == "PERSON" and made["engagement_control_id"] == control
    assert made["request_type"] == "APPROVAL_EVIDENCE" and made["priority"] == "HIGH"
    path = f"{_project(team)}/pbc-requests/{made['id']}"
    # Naming a control never makes it the agent's: its author cannot approve it.
    own = owner.post(f"{path}/approve", json={"version": made["version"]})
    assert own.status_code == 409
    row = next(item for item in _all(owner, team, q="Q3 access review") if item["id"] == made["id"])
    assert row["stage"] == "DRAFT" and row["type_label"] == "Approval evidence"
    submitted = _bulk(owner, team, [row], action="SUBMIT").json()
    assert submitted["done"] == 1, submitted
    # The submitter cannot return it; another approver can.
    row = next(item for item in _all(owner, team) if item["id"] == made["id"])
    mine = _bulk(owner, team, [row], action="RETURN", reason="Wrong period.").json()
    assert mine["outcomes"][0]["detail"] == "You submitted it; another approver must decide it."
    reviewer = _session(migrated, team["reviewer_id"])
    short = _bulk(reviewer, team, [row], action="RETURN", reason="")
    assert short.status_code == 422
    returned = _bulk(reviewer, team, [row], action="RETURN", reason="Wrong period.").json()
    assert returned["done"] == 1, returned
    row = next(item for item in _all(owner, team) if item["id"] == made["id"])
    assert row["stage"] == "CHANGES_REQUESTED" and row["status"] == "DRAFT"
    # A control outside the engagement is not found.
    stray = owner.post(
        f"{_project(team)}/pbc-requests",
        json={
            "operation_key": f"manual-{uuid4().hex[:8]}",
            "control_ref": "ITGC-AC-01",
            "recipient": "",
            "due_at": (datetime.now(UTC) + timedelta(days=9)).isoformat(),
            "evidence_description": "Please provide the listing.",
            "engagement_control_id": str(uuid4()),
        },
    )
    assert stray.status_code == 404


def test_saved_views_belong_to_their_person(migrated: Database) -> None:
    team = _ready(migrated, "ec-views")
    owner = team["owner"]
    base = f"{_project(team)}/evidence-views"
    saved = owner.post(
        base, json={"name": "Interim access", "filters": {"phase": ["INTERIM"], "q": "ac"}}
    )
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert view["built_in"] is False
    assert owner.post(base, json={"name": "interim ACCESS", "filters": {}}).status_code == 409
    rows = _all(owner, team, view=view["id"])
    assert rows and all(item["phase"] == "INTERIM" for item in rows)
    reviewer = _session(migrated, team["reviewer_id"])
    assert [item["id"] for item in reviewer.get(base).json() if not item["built_in"]] == []
    hidden = reviewer.get(f"{_project(team)}/evidence-requests", params={"view": view["id"]})
    assert hidden.status_code == 404
    left = owner.post(f"{base}/{view['id']}/remove").json()
    assert all(item["built_in"] for item in left)


def test_the_export_never_runs_a_cell_as_a_formula(migrated: Database) -> None:
    team = _ready(migrated, "ec-export")
    owner = team["owner"]
    row = _all(owner, team)[0]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET title = '=HYPERLINK(\"x\")' WHERE id = %s", (row["id"],)
        )
        connection.commit()
    exported = owner.get(f"{_project(team)}/evidence-requests.csv")
    assert exported.status_code == 200
    text = exported.content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("Reference,Title,Control")
    assert "'=HYPERLINK" in text
    assert "=HYPERLINK" not in text.replace("'=HYPERLINK", "")


def test_a_thousand_requests_list_in_pages(migrated: Database) -> None:
    team = _ready(migrated, "ec-large")
    owner = team["owner"]
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO pbc_requests (
                organization_id, project_id, operation_key, control_ref, owner_user_id,
                recipient, due_at, evidence_description, engagement_control_id, testing_phase,
                drafted_by
            )
            SELECT r.organization_id, r.project_id, 'bulk-' || g || '-' || r.id, r.control_ref,
                   r.owner_user_id, '', r.due_at, r.evidence_description,
                   r.engagement_control_id, r.testing_phase, 'AGENT'
            FROM pbc_requests r CROSS JOIN generate_series(1, 30) g
            WHERE r.project_id = %s
            LIMIT 1000
            """,
            (team["project"],),
        )
        connection.commit()
    started = time.perf_counter()
    body = _list(owner, team, size=100, page=3)
    elapsed = time.perf_counter() - started
    assert body["total"] >= 1000 and len(body["rows"]) == 100
    assert body["kpis"]["needs_assignment"] >= 1000
    assert elapsed < 15, elapsed


def test_a_controls_planned_evidence_is_requested_on_request(migrated: Database) -> None:
    team = _ready(migrated, "ec-planned")
    owner = team["owner"]
    rows = _all(owner, team, phase="INTERIM")
    control = rows[0]["control_id"]
    path = f"{_project(team)}/controls/{control}/evidence-plan/request-planned"
    # Everything planned is already requested: nothing new.
    first = owner.post(path)
    assert first.status_code == 200, first.text
    assert first.json()["requested"] == 0
    # A withdrawn request's evidence is still needed: it is requested again, once.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'CANCELLED', cancellation_reason = 'test' "
            "WHERE id = %s",
            (rows[0]["id"],),
        )
        connection.commit()
    again = owner.post(path).json()
    assert again["requested"] == 1
    assert owner.post(path).json()["requested"] == 0
    with connect(migrated.url) as connection:
        reader = _add_user(connection, team["org"], f"rp-{uuid4().hex[:6]}@example.com",
                           "REVIEWER")  # fmt: skip
        _add_project_member(connection, team["org"], team["project"], reader)
    assert _session(migrated, reader).post(path).status_code == 403
    # The list names every matching request, for selecting all of them.
    body = _list(owner, team, phase="INTERIM", size=25)
    assert len(body["matching"]) == body["total"]
    assert body["controls"] and body["types"]
