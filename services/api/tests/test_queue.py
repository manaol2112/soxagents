"""The engagement's one queue (queue.py, Milestone 2a): every open obligation once, with
its record, its owner, whether the viewer may act, and where it is done; the console
inbox reads the same list; filters never widen what a viewer sees."""

from typing import Any
from uuid import UUID

from support import Database
from test_control_reviews import _prepared_control
from test_evidence_intake import _accept_population, _client, _engagement, _request, _Scheduler
from test_execution import _add_user, _seed_org
from test_outbound import _session, migrated
from test_phase_release import _prepare_design
from test_test_rounds import _plans
from test_testing_engine import _add, _base, _read_all, _year

from ai_workforce_api.control_reviews import run_reperformance
from ai_workforce_api.db import connect

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
