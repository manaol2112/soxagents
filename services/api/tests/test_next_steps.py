"""The engagement's home (next_steps.py): its stages as one journey, and one ordered list
of what waits on the team, each step placed in its stage with the page where it is done."""

from typing import Any

from support import Database
from test_master_plans import _approve
from test_onboarding import _new_engagement
from test_outbound import migrated
from test_planning_gate import _control, _launched, _project

__all__ = ["migrated"]


def _next(team: dict[str, Any], client: Any = None) -> dict[str, Any]:
    read = (client or team["owner"]).get(f"{_project(team)}/next-steps")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _stage(body: dict[str, Any], key: str) -> dict[str, Any]:
    found: dict[str, Any] = next(item for item in body["stages"] if item["key"] == key)
    return found


def test_an_engagement_being_set_up_points_to_its_setup(migrated: Database) -> None:
    team = _new_engagement(migrated, "next-setup")
    body = _next(team)
    assert body["launched"] is False and body["current"] == "SETUP"
    assert [item["key"] for item in body["stages"]] == [
        "SETUP", "PLANS", "EVIDENCE", "TESTING", "REVIEW", "CLOSE",
    ]  # fmt: skip
    assert _stage(body, "SETUP")["status"] == "CURRENT"
    assert {item["status"] for item in body["stages"][1:]} == {"UPCOMING"}
    first = body["steps"][0]
    assert (first["stage"], first["kind"], first["section"]) == ("SETUP", "setup", "setup")
    assert first["blocks"] is True


def test_a_launched_engagement_leads_with_its_test_plans(migrated: Database) -> None:
    team = _launched(migrated, "next-plans")
    body = _next(team)
    assert body["launched"] is True and body["current"] == "PLANS"
    assert _stage(body, "SETUP")["status"] == "DONE"
    plans = _stage(body, "PLANS")
    assert plans["status"] == "CURRENT" and plans["done"] == 0 and plans["total"] > 0
    # The steps follow the order of the work: every test-plan step before any other.
    stages = [step["stage"] for step in body["steps"]]
    order = ["SETUP", "PLANS", "EVIDENCE", "TESTING", "REVIEW", "CLOSE"]
    assert stages == sorted(stages, key=order.index)
    kinds = {step["kind"]: step for step in body["steps"] if step["stage"] == "PLANS"}
    ready = kinds["plans_ready"]
    assert ready["section"] == "planning"
    assert ready["query"] == {"filter": "DRAFT_READY,PENDING_REVIEW,NEEDS_CLARIFICATION"}
    waiting = int(ready["title"].split()[1])
    # Each control waits on its test plan, not on a request that cannot be made yet.
    control = _control(team, "ITGC-AC-01")
    assert control["progress"] == "PLAN_TO_APPROVE"
    _approve(team, control["id"])
    after = _next(team)
    assert _stage(after, "PLANS")["done"] == 1
    approve = next(step for step in after["steps"] if step["kind"] == "plans_ready")
    assert int(approve["title"].split()[1]) == waiting - 1
    assert _control(team, "ITGC-AC-01")["progress"] != "PLAN_TO_APPROVE"


def test_only_a_member_reads_the_next_steps(migrated: Database) -> None:
    team = _launched(migrated, "next-members")
    outsider = _new_engagement(migrated, "next-outsider")["owner"]
    read = outsider.get(f"{_project(team)}/next-steps")
    assert read.status_code in (403, 404)
