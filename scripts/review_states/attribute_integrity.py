"""attribute-integrity (20 November 2026): the Attributes step with a pending revision.

ITGC-AC-03, whose evidence plan a person approved, has its understanding completed through
the API; the attribute agents' run is then taken by a scripted model, as
test_attributes_follow_understanding builds the same state
(test_an_approved_plan_keeps_its_attributes_and_gets_the_tailoring_as_a_proposed_change):
the planner's tailored criteria wait on the approved plan as a proposed revision, and the
independent set reviewer, given those pending criteria, revises the first attribute's,
which reads as a CONCERN with its note on that row before Accept. Synthetic data only.
"""

from typing import Any

from set_review_answers import with_every_verdict
from support import run_plan_through
from test_attributes_follow_understanding import (
    _Agents,
    _answer_required,
    _approved,
    _client,
    _plan_run,
    _Scheduler,
)
from test_evidence_plans import _control
from test_walkthrough_answers import _values_and_questions_answered

from ai_workforce_api.db import connect

CONTROL = "ITGC-AC-03"
NOTE = "Name the system the request is raised in, so a tester knows where to look."


def build(seed: Any) -> None:
    control = _control(seed.database, seed.team, CONTROL)
    _values_and_questions_answered(seed.database, seed.team, control)
    scheduler = _Scheduler()
    client = _client(seed.database, seed.team["owner_id"], scheduler, True)
    _answer_required(seed.database, seed.team, control, client)
    plan_id = _plan_run(seed.database, control)[0]
    assert scheduler.plans == [plan_id], scheduler.plans
    first = _approved(seed.database, control)[0]
    agents = _Agents(seed.database, seed.team, control)
    agents.review = lambda given: with_every_verdict(
        {
            "attributes": [
                {
                    "id": str(first[0]),
                    "verdict": "REVISED",
                    "note": NOTE,
                    "condition": "The ServiceNow request names the user and the role requested.",
                    "pass_criteria": "The ServiceNow request names the user and the role.",
                    "fail_criteria": "The ServiceNow request names no user or no role.",
                }
            ],
            "findings": [],
        },
        given,
    )
    with connect(seed.database.url) as connection:
        assert run_plan_through(connection, agents, plan_id) == "DONE"
    body = seed.client.get(f"{seed.base()}/controls/{control}/context").json()["attributes"]
    shown = [
        item
        for group in ("approved", "proposed")
        for item in body[group]
        if (item.get("review") or {}).get("verdict") == "CONCERN"
    ]
    assert len(shown) == body["review_summary"]["concerns"] >= 1, body["review_summary"]
    seed.add(
        "attribute-integrity-pending-concern",
        seed.href(section="controls", control=control, step="attributes"),
        control=CONTROL,
        concern_on=str(first[0]),
        concerns=body["review_summary"]["concerns"],
        plan=str(plan_id),
    )
