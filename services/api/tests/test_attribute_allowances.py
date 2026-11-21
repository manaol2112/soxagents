"""The attribute run's agents ask for an output allowance that holds their answer (16 November
2026).

The attribute drafter, the reviewer of its drafts and the reviewer of the set asked for no
allowance, so each had the provider's default of 4,096 output tokens. On a control with a
long record the drafter's answer was cut off there twice (4,096 of 4,096 output tokens), and
the step read "The attribute agent could not finish: the answer was cut off at the output
limit". Its correction was asked with the same allowance, so it could not succeed either."""

from typing import Any

from support import Database
from test_attributes_follow_understanding import (
    ADDED,
    _Agents,
    _answer_required,
    _plan_run,
    _ready,
)
from test_outbound import migrated

from ai_workforce_api import attribute_review, control_attributes
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_plans import PLANNER_TOKENS, run_plan
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest

__all__ = ["migrated"]

# The provider's default allowance that cut these answers off: 4,096 tokens without images.
# Since 21 November 2026 a request that names none gets models.DEFAULT_OUTPUT_TOKENS
# (16,000); these agents still name their own, and none may fall back to the old 4,096.
CUT_OFF_DEFAULT = 4096


class _Recorded(_Agents):
    """The scripted agents of the attribute run, keeping what each request asked for."""

    def __init__(self, *args: Any) -> None:
        super().__init__(*args)
        self.asked: dict[str, tuple[int, int]] = {}

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        who = {
            control_attributes.SYSTEM_PROMPT: "attributes",
            control_attributes.REVIEW_PROMPT: "draft-review",
            attribute_review.SYSTEM_PROMPT: "set-review",
        }.get(request.system or "")
        if who is not None:
            self.asked[who] = (request.max_tokens, request.timeout_seconds)
        return super().complete(request, config)


def test_each_agent_of_the_attribute_run_asks_for_more_than_the_providers_default(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "allowance")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    agents = _Recorded(migrated, team, control)
    # One addition, so the reviewer of the drafts has a draft to review.
    agents.proposals = [
        {
            "action": "ADD", "replaces": "", "text": ADDED, "basis": "INFERRED", "source": "",
            "quote": "", "note": "The walkthrough says each request states its justification.",
            "condition": "The ServiceNow request has a business justification entered.",
            "pass_criteria": "The justification field of the ServiceNow request is filled in.",
            "fail_criteria": "The justification field of the ServiceNow request is empty.",
            "judgment_required": False,
        }
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    assert agents.asked == {
        # The drafter and the reviewer of its drafts write the attributes out in full: the
        # planner's allowance and time.
        "attributes": (PLANNER_TOKENS, 300),
        "draft-review": (PLANNER_TOKENS, 300),
        "set-review": (8000, 180),
    }
    assert all(tokens > CUT_OFF_DEFAULT for tokens, _seconds in agents.asked.values())
    # The time allows for the allowance: no agent is given less time than the question
    # reviewer, whose 8,000 tokens run in 180 seconds.
    assert all(seconds >= 180 for _tokens, seconds in agents.asked.values())
