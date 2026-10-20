"""The engagement's one queue (queue.py, Milestone 2a): every open obligation once, with
its record, its owner, whether the viewer may act, and where it is done; the console
inbox reads the same list; filters never widen what a viewer sees."""

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from support import Database
from test_control_reviews import _prepared_control
from test_evidence_analysis import _no_ocr, _Provider
from test_evidence_intake import _accept_population, _client, _engagement, _request, _Scheduler
from test_evidence_review import (
    _decide_path,
    _opt_into_model,
    _png,
    _sent_engagement_request,
    _store_screenshot,
)
from test_evidence_review import _reviews as _evidence_reviews
from test_execution import _add_user, _seed_org
from test_outbound import _session, migrated
from test_phase_release import _prepare_design
from test_round_reviews import _sign_review
from test_test_rounds import _plans, _rounds, _sheets
from test_testing_engine import _add, _base, _controls, _read_all, _year
from test_workpapers import _tested_control

from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.console import _inbox
from ai_workforce_api.control_reviews import REPERFORM_FAILED, run_reperformance
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.queue import NO_WORKER, queue
from ai_workforce_api.settings import Settings
from ai_workforce_api.testing_engine import fail_run
from ai_workforce_api.workpaper_service import DRAFT_FAILED

__all__ = ["migrated"]


def _queue(client: Any, team: dict[str, Any], **params: str) -> dict[str, Any]:
    read = client.get(f"{_base(team)}/queue", params=params)
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def test_each_obligation_appears_once_with_its_owner_and_where_it_is_done(
    migrated: Database,
) -> None:
    team, client, sheet, _file = _prepared_control(migrated, "queue-once", "DISMISS")
    _prepare_design(migrated, team, sheet["control_id"])
    base = _base(team)
    review = client.get(f"{base}/reviews").json()[0]
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"
        connection.commit()
    body = _queue(client, team)
    ids = [item["id"] for item in body["items"]]
    assert len(ids) == len(set(ids))
    # The control's open review is one item, the reviewer's, with its record and link;
    # the control's own next step (the same obligation) is not listed beside it.
    mine = [item for item in body["items"] if item["control_id"] == sheet["control_id"]]
    # Two obligations on the control, kept apart: the roll-forward round's drafted request
    # (an approver's) and the review (the reviewer's). The plan's "ready for review" task
    # and the control's next step, which both restate the review, are not repeated.
    assert sorted(item["kind"] for item in mine) == ["request-draft", "review"], [
        item["title"] for item in mine
    ]
    [item] = [item for item in mine if item["kind"] == "review"]
    assert item["id"] == f"review:{review['id']}"
    assert item["source"] == {"type": "control_review", "id": review["id"]}
    assert item["owner"]["role"] == "REVIEWER" and item["authorized"] is False
    assert item["bucket"] == "WAITING" and item["stage"] == "REVIEW"
    assert item["link"] == {
        "section": "controls",
        "query": {"control": sheet["control_id"], "step": "review"},
    }
    assert item["title"].startswith("Decide ") and "reviewer agent" in item["reason"]
    # The drafted requests of the other controls are each an approver's item, the
    # owner's to act on, with the request opened in the control's Request step.
    drafts = [item for item in body["items"] if item["kind"] == "request-draft"]
    assert drafts and all(item["bucket"] == "MINE" and item["authorized"] for item in drafts)
    assert all(item["link"]["query"]["step"] == "request" for item in drafts)
    assert body["counts"]["MINE"] == sum(1 for item in body["items"] if item["bucket"] == "MINE")
    # The reviewer sees the same list with the review as theirs.
    reviewer = _session(migrated, team["reviewer_id"])
    theirs = _queue(reviewer, team)
    [review_item] = [i for i in theirs["items"] if i["id"] == f"review:{review['id']}"]
    assert review_item["authorized"] is True and review_item["bucket"] == "MINE"
    # The console inbox is the same list, in its own shape.
    inbox = client.get(f"{base}/console/inbox").json()["waiting"]
    kinds = {item["kind"] for item in inbox}
    assert {"control_review", "drafts"} <= kinds
    assert len(inbox) == len(
        [
            i
            for i in body["items"]
            if not (i["bucket"] == "WAITING" and i["owner"]["role"] == "CLIENT")
            and i["bucket"] != "UPCOMING"
        ]
    )


def test_who_may_act_follows_the_role_not_the_permission(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "queue-roles")
    base = _base(team)
    kickoff = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    [plan] = _plans(client, team)
    control = plan["engagement_control_id"]
    # Until a person accepts the population, the proposed samples cannot be approved: the
    # item is blocked and says so; accepting the population is the preparer's own step.
    before = _queue(client, team)["items"]
    [held] = [i for i in before if i["id"] == f"samples:{plan['id']}"]
    assert held["bucket"] == "BLOCKED" and held["ready"] is False
    assert held["blockers"] == ["Accept the population on the evidence plan first"]
    assert any(
        i["kind"] == "control-step" and i["control_id"] == control and i["bucket"] == "MINE"
        for i in before
    )
    _accept_population(client, team, control)
    # The samples proposed by the tester: the preparer's (the owner leads the team).
    [item] = [i for i in _queue(client, team)["items"] if i["id"] == f"samples:{plan['id']}"]
    assert item["owner"]["role"] == "PREPARER" and item["bucket"] == "MINE"
    assert item["ready"] is True and item["phase"] == "INTERIM"
    assert item["link"]["query"] == {"control": control, "step": "test"}
    # Not the independent reviewer's, nor an admin's who is not on the team: for them
    # it waits on the preparer.
    reviewer = _session(migrated, team["reviewer_id"])
    [theirs] = [i for i in _queue(reviewer, team)["items"] if i["id"] == f"samples:{plan['id']}"]
    assert theirs["authorized"] is False and theirs["bucket"] == "WAITING"
    with connect(migrated.url) as connection:
        admin_id = _add_user(
            connection, team["org"], f"admin-{plan['id'][:6]}@example.com", "ADMIN"
        )
    admin = _client(migrated, admin_id, _Scheduler())
    [seen] = [i for i in _queue(admin, team)["items"] if i["id"] == f"samples:{plan['id']}"]
    assert seen["authorized"] is False and seen["bucket"] == "WAITING"
    # Filters narrow, never widen.
    only_mine = _queue(client, team, bucket="MINE")["items"]
    assert only_mine and all(i["bucket"] == "MINE" for i in only_mine)
    assert all(
        i["bucket"] != "MINE"
        for i in _queue(reviewer, team, bucket="MINE")["items"]
        if i["id"] == f"samples:{plan['id']}"
    )
    by_control = _queue(client, team, control=control)["items"]
    assert by_control and all(i["control_id"] == control for i in by_control)
    assert _queue(client, team, phase="ROLLFORWARD")["items"] == []
    # Another organization's member cannot read it.
    with connect(migrated.url) as connection:
        stranger = _seed_org(connection, "queue-stranger")
    other = _client(migrated, stranger["user_id"], _Scheduler())
    assert other.get(f"{base}/queue").status_code in (403, 404)


def _items_on(body: dict[str, Any], control_id: str) -> list[dict[str, Any]]:
    return [item for item in body["items"] if item["control_id"] == control_id]


def test_coverage_and_stopped_drafts_are_items_of_their_own(migrated: Database) -> None:
    team, client, sheet, _file = _prepared_control(migrated, "queue-cover", "DISMISS")
    base = _base(team)
    control = sheet["control_id"]
    review = client.get(f"{base}/reviews").json()[0]
    _sign_review(migrated, client, team, review["id"])
    # The design workpaper is prepared after the review signed: the review's coverage
    # of it is unassessed. One item, the reviewer's, on the signed review's record; the
    # control's next step (the same gap, in the journey's words) is not repeated.
    _prepare_design(migrated, team, control)
    # (The roll-forward round's drafted request is an obligation of its own, as before.)
    mine = [i for i in _items_on(_queue(client, team), control) if i["kind"] != "request-draft"]
    assert [item["kind"] for item in mine] == ["coverage"], [i["title"] for i in mine]
    [gap] = mine
    assert gap["id"] == f"coverage:{review['id']}"
    assert gap["obligation"] == "COVERAGE_ASSESSMENT" and gap["blocks"] is True
    assert gap["owner"]["role"] == "REVIEWER" and gap["bucket"] == "WAITING"
    assert "since the review covered it" in gap["reason"]
    assert gap["link"]["query"] == {"control": control, "step": "review"}
    reviewer = _session(migrated, team["reviewer_id"])
    [theirs] = [i for i in _items_on(_queue(reviewer, team), control) if i["kind"] == "coverage"]
    assert theirs["authorized"] is True and theirs["bucket"] == "MINE"
    # A workpaper draft the agent gave up on is a stopped agent execution, listed as
    # the preparer's to start again, apart from any testing result.
    other = next(row["id"] for row in _controls(client, team) if row["id"] != control)
    with connect(migrated.url) as connection:
        failed = connection.execute(
            """
            INSERT INTO workpapers (
                organization_id, project_id, engagement_control_id, stage, template_key,
                status, draft_status, draft_note, requested_by
            )
            VALUES (%s, %s, %s, 'EFFECTIVENESS', 'itgc', 'DRAFT', 'IDLE', %s, %s)
            RETURNING id
            """,
            (team["org"], team["project"], other, DRAFT_FAILED, team["owner_id"]),
        ).fetchone()
        connection.commit()
    assert failed is not None
    key = f"draft-stopped:{failed[0]}"
    [stopped] = [i for i in _queue(client, team)["items"] if i["id"] == key]
    assert stopped["obligation"] == "WORKPAPER_DRAFT_STOPPED" and stopped["bucket"] == "MINE"
    assert stopped["title"] == "Draft the effectiveness workpaper again"
    assert stopped["reason"] == DRAFT_FAILED
    assert stopped["link"]["query"] == {"control": other, "step": "conclude"}


def test_queued_agent_work_is_upcoming_with_a_worker_and_blocked_without(
    migrated: Database,
) -> None:
    team, client, sheet, _file = _prepared_control(migrated, "queue-agent", "DISMISS")
    control = sheet["control_id"]
    review = client.get(f"{_base(team)}/reviews").json()[0]
    principal = Principal(kind=PrincipalKind.USER, id=UUID(str(team["owner_id"])))
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_reviews SET reperform_status = 'PENDING' WHERE id = %s",
            (review["id"],),
        )
        connection.commit()
        # The re-performance is queued: with a worker it is upcoming, nobody's action;
        # without one it is blocked, and says that automation is unavailable.
        with_worker = queue(connection, principal, team["org"], team["project"], True)
        without = queue(connection, principal, team["org"], team["project"], False)
    [item] = [i for i in with_worker.items if i.id == f"review:{review['id']}"]
    assert item.bucket == "UPCOMING" and item.owner.role == "AGENT" and item.blockers == []
    assert with_worker.counts["UPCOMING"] == 1
    [held] = [i for i in without.items if i.id == f"review:{review['id']}"]
    assert held.bucket == "BLOCKED" and held.blockers == [NO_WORKER]
    # Neither lists the control's step beside the review: one obligation, one item.
    kinds = [i.kind for i in with_worker.items if i.control_id == UUID(control)]
    assert kinds == ["request-draft", "review"]
    # The re-performance that did not finish is a stopped execution, the reviewer's
    # to start again, under the same item.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            UPDATE control_reviews SET reperform_status = 'IDLE', reperformed_at = NULL,
                   reperform_note = %s WHERE id = %s
            """,
            (REPERFORM_FAILED, review["id"]),
        )
        connection.commit()
    reviewer = _session(migrated, team["reviewer_id"])
    key = f"review:{review['id']}"
    [again] = [i for i in _queue(reviewer, team)["items"] if i["id"] == key]
    assert again["title"] == "Re-perform the testing for the review again"
    assert again["obligation"] == "REPERFORMANCE_STOPPED" and again["bucket"] == "MINE"
    assert again["reason"] == REPERFORM_FAILED
    # The inbox lists what waits on a person: with a worker the queued re-performance
    # is upcoming and not in it; the test app has no worker, so over the API the same
    # item is blocked and the inbox says what holds it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_reviews SET reperform_status = 'PENDING' WHERE id = %s",
            (review["id"],),
        )
        connection.commit()
        quiet = _inbox(connection, principal, team["org"], team["project"], True)
    assert not any(i.kind == "control_review" for i in quiet.waiting)
    inbox = client.get(f"{_base(team)}/console/inbox").json()["waiting"]
    [shown] = [i for i in inbox if i["kind"] == "control_review"]
    assert "Automation unavailable" in shown["detail"]


def test_remediation_waits_on_the_client_and_the_retest_is_the_rounds(
    migrated: Database,
) -> None:
    team, client, _sheet_, _ticket = _tested_control(migrated, "queue-fix")
    base = _base(team)
    first = _sheets(client, team)[0]
    logged = client.post(
        f"{base}/test-sheets/{first['id']}/deficiency",
        json={"version": first["version"], "action": "LOG"},
    )
    assert logged.status_code == 200, logged.text
    [deficiency] = client.get(f"{base}/deficiencies").json()
    control = deficiency["control_id"]
    key = f"deficiency:{deficiency['id']}"
    # Logged: starting the remediation is the preparer's, apart from the workpapers.
    [item] = [i for i in _queue(client, team)["items"] if i["id"] == key]
    assert item["obligation"] == "DEFICIENCY_REMEDIATION" and item["bucket"] == "MINE"
    assert item["phase"] == "REMEDIATION" and item["link"]["query"]["step"] == "conclude"
    assert item["title"].startswith(f"Start the remediation of {deficiency['reference']}")
    moved = client.post(
        f"{base}/deficiencies/{deficiency['id']}/progress",
        json={"version": deficiency["version"], "status": "REMEDIATION_IN_PROGRESS"},
    )
    assert moved.status_code == 200, moved.text
    # In remediation: an ordinary wait on the control owner, not a workflow blocker.
    [item] = [i for i in _queue(client, team)["items"] if i["id"] == key]
    assert item["owner"]["role"] == "CLIENT" and item["bucket"] == "WAITING"
    assert item["authorized"] is False and item["blockers"] == []
    # Ready for retest with the fix taking effect yesterday: the retest round opens and
    # is the obligation from here (the deficiency is not repeated); nothing is due on
    # it until the fixed control has operated long enough, so it is upcoming.
    fixed = date.today() - timedelta(days=1)
    moved = client.post(
        f"{base}/deficiencies/{deficiency['id']}/progress",
        json={
            "version": moved.json()["version"],
            "status": "READY_FOR_RETEST",
            "remediated_on": fixed.isoformat(),
        },
    )
    assert moved.status_code == 200, moved.text
    [retest] = _rounds(client, team)
    assert retest["kind"] == "RETEST" and retest["status"] == "REQUESTED"
    body = _queue(client, team)
    assert not any(i["id"] == key for i in body["items"])
    on_control = _items_on(body, control)
    # The interim's workpapers are still the preparer's step, due now; the retest round
    # is its own item, upcoming, with the window that holds it; its requests are the
    # approver's, as any drafted request.
    [step] = [i for i in on_control if i["kind"] == "control-step"]
    assert step["obligation"] == "WORKPAPERS" and step["bucket"] == "MINE"
    [window] = [i for i in on_control if i["kind"] == "round"]
    assert window["id"] == f"round:{retest['id']}" and window["bucket"] == "UPCOMING"
    assert window["obligation"] == "ROUND_WINDOW" and window["phase"] == "RETEST"
    assert any("must operate until" in blocker for blocker in window["blockers"])
    assert window["owner"]["role"] == "NONE" and window["authorized"] is False
    mine = {i["id"] for i in _queue(client, team, bucket="MINE")["items"]}
    assert window["id"] not in mine and step["id"] in mine
    assert body["counts"]["UPCOMING"] >= 1
    # A page of the filtered list, with the whole count.
    page = _queue(client, team, limit="1", offset="0")
    assert len(page["items"]) == 1 and page["total"] == len(body["items"])
    assert page["counts"] == body["counts"]


def test_evidence_awaiting_a_sufficiency_decision_is_the_preparers(migrated: Database) -> None:
    team, client, request = _sent_engagement_request(migrated, "queue-suff")
    _opt_into_model(client, team)
    analysis_id = _store_screenshot(client, team, request, _png("x", 20, 20))
    with connect(migrated.url) as connection:
        run_analysis(
            connection, Settings(database_url=migrated.url), _Provider([{}]), analysis_id, _no_ocr
        )
    [review] = _evidence_reviews(client, team)
    assert review["status"] == "NEEDS_PERSON" and review["decision"] is None
    key = f"evidence-review:{review['id']}"
    [item] = [i for i in _queue(client, team)["items"] if i["id"] == key]
    assert item["obligation"] == "EVIDENCE_SUFFICIENCY" and item["stage"] == "EVIDENCE"
    assert item["title"] == "Decide the sufficiency of settings.png"
    assert item["reason"].startswith("The agent could not review it")
    assert item["owner"]["role"] == "PREPARER" and item["bucket"] == "MINE"
    assert item["link"] == {
        "section": "evidence",
        "query": {"tab": "mailbox", "request": request["id"]},
    }
    # Decided: it leaves the queue.
    decided = client.post(
        _decide_path(team, review["id"]),
        json={"version": review["version"], "decision": "ACCEPTED"},
    )
    assert decided.status_code == 200, decided.text
    assert not any(i["id"] == key for i in _queue(client, team)["items"])


def test_two_records_for_one_obligation_make_one_item(migrated: Database) -> None:
    """Semantic deduplication (M2c): a submitted request's approval and the control's
    "Approve the evidence request" step are one obligation, as are a stopped tester run
    and the control's "Testing stopped: run it again" step. Independent obligations on
    the same control (its drafted design request, its review) stay apart."""
    team, client, scheduler = _engagement(migrated, "queue-dedup")
    base = _base(team)
    # A kickoff request submitted for approval: the approval record is the item; the
    # requester cannot approve it, so it waits on another approver.
    kickoff = _request(migrated, team, "ITGC-CM-01")
    submitted = client.post(
        f"{base}/pbc-requests/{kickoff['id']}/submit", json={"version": kickoff["version"]}
    )
    assert submitted.status_code == 200, submitted.text
    approval_id = submitted.json()["approval"]["id"]
    with connect(migrated.url) as connection:
        [(cm_control,)] = connection.execute(
            "SELECT engagement_control_id FROM pbc_requests WHERE id = %s", (kickoff["id"],)
        ).fetchall()
    body = _queue(client, team)
    on_cm = _items_on(body, str(cm_control))
    approvals = [i for i in on_cm if i["obligation"] in ("SEND_APPROVAL", "REQUEST_APPROVAL")]
    assert [i["id"] for i in approvals] == [f"approval:{approval_id}"], [
        (i["kind"], i["title"]) for i in on_cm
    ]
    assert approvals[0]["bucket"] == "WAITING" and approvals[0]["authorized"] is False
    assert not any(
        i["kind"] == "control-step" and i["obligation"] == "REQUEST_APPROVAL" for i in on_cm
    )
    # Another approver sees the same single item as theirs.
    other = _session(migrated, team["reviewer_id"])
    theirs = [i for i in _items_on(_queue(other, team), str(cm_control)) if i["kind"] == "approval"]
    assert len(theirs) == 1 and theirs[0]["bucket"] == "MINE"
    # The tester's run stopped before testing anything: the sheet's stopped-run item
    # stands; the control's step, which says the same, is not repeated.
    population_request = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, population_request["id"])
    _read_all(migrated, scheduler)
    [plan] = _plans(client, team)
    control = plan["engagement_control_id"]
    _accept_population(client, team, control)
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    [sheet] = [s for s in _sheets(client, team) if s["control_id"] == control]
    tickets = "ticket,user,approved_by\n" + "".join(
        f"T-{n},{item['label']},Demo Manager\n" for n, item in enumerate(sheet["items"])
    )
    _add(client, team, "access tickets.csv", tickets, approved.json()["sample_request_id"])
    _read_all(migrated, scheduler)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE test_sheets SET run_status = 'PENDING' WHERE id = %s", (sheet["id"],)
        )
        connection.commit()
        fail_run(connection, UUID(sheet["id"]), "ModelTimeout")
    on_control = _items_on(_queue(client, team), control)
    stopped = [i for i in on_control if i["obligation"] == "TESTING_RUN_STOPPED"]
    assert [i["kind"] for i in stopped] == ["run-stopped"], [
        (i["kind"], i["obligation"], i["title"]) for i in on_control
    ]
    assert stopped[0]["bucket"] == "MINE"
    # No identity, and no (control, obligation) pair, appears twice anywhere.
    body = _queue(client, team)
    pairs = [(i["control_id"], i["obligation"]) for i in body["items"] if i["control_id"]]
    repeated = {
        pair
        for pair in pairs
        if pairs.count(pair) > 1
        and pair[1] not in ("REQUEST_DRAFT_APPROVAL", "SEND_APPROVAL", "REMINDER_APPROVAL")
    }
    assert repeated == set(), repeated
