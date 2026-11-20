"""Scripted answers of the set reviewer (attribute_review), stated per test.

Since 19 November 2026 (SOL defect 4, I11) the set reviewer's answer is used only when it
gives a verdict on every attribute it was given (attribute_review.covering): an empty or
partial answer is corrected once and then stored NOT_REVIEWED. A test that is about
something else states the reviewer's answer it relies on with these, instead of the empty
answer the shared fakes default to (test_attributes_follow_understanding._Agents,
test_agent_answers._Script), which this increment does not edit (they belong to the
audit-invariants harness, PR #22).
"""

import json
from typing import Any

NOTE = "The attribute and its criteria fit the confirmed understanding."


def given_of(prompt: str) -> dict[str, Any]:
    """The set reviewer's inputs, from its prompt (attribute_review.review_prompt)."""
    found: dict[str, Any] = json.loads(
        prompt.split("<review_inputs>\n", 1)[1].rsplit("\n</review_inputs>", 1)[0]
    )
    return found


def with_every_verdict(
    answer: dict[str, Any], given: dict[str, Any], verdict: str = "OK"
) -> dict[str, Any]:
    """`answer` with `verdict` added for every attribute given that it names no verdict
    for."""
    named = {str(item["id"]) for item in answer.get("attributes", [])}
    rest = [
        {"id": item["id"], "verdict": verdict, "note": NOTE}
        for item in given["attributes"]
        if str(item["id"]) not in named
    ]
    return {**answer, "attributes": [*answer.get("attributes", []), *rest]}


def every_ok(given: dict[str, Any]) -> dict[str, Any]:
    """The reviewer finds every attribute OK and nothing about the set."""
    return with_every_verdict({"attributes": [], "findings": []}, given)


def every_ok_from_prompt(prompt: str) -> dict[str, Any]:
    """every_ok, for a fake that answers from the prompt (test_agent_answers._Script)."""
    return every_ok(given_of(prompt))
