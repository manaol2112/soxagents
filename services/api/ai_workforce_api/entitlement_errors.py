"""What the API says when a firm's subscription refuses a change (Trial Management, Step 2).

Two refusals, both answered as 402 with a structured detail the web can read:

- a trial limit (`TRIAL_LIMIT`): the firm has used its allowance of a resource. Raised by
  the database (SQLSTATE AW402, from the triggers of migration 0127) or by a service's own
  check before the write;
- an inactive subscription (`SUBSCRIPTION_INACTIVE`): the trial has ended or the
  subscription is suspended or cancelled, so the firm's records are read-only.

Kept apart from subscriptions.py so authorization.py can map the errors without a cycle.
"""

from typing import Any

import psycopg

TRIAL_LIMIT_SQLSTATE = "AW402"
_PREFIX = "trial limit reached: "

RESOURCE_WORDS = {
    "engagements": "engagement",
    "systems": "system",
    "controls": "controls",
    "members": "team member",
    "uploads": "evidence files",
    "storage": "evidence storage",
    "ai": "AI allowance",
    "subscription": "subscription",
}


class TrialLimitReached(Exception):
    """A change would pass one of the trial's allowances."""

    def __init__(self, resource: str, used: int, allowed: int) -> None:
        super().__init__(f"{_PREFIX}{resource}")
        self.resource = resource
        self.used = used
        self.allowed = allowed

    def detail(self) -> dict[str, Any]:
        return trial_limit_detail(self.resource, self.used, self.allowed)


class SubscriptionInactive(Exception):
    """The firm's subscription allows no change."""

    def __init__(self, state: str) -> None:
        super().__init__(f"subscription inactive: {state}")
        self.state = state

    def detail(self) -> dict[str, Any]:
        return inactive_detail(self.state)


def trial_limit_detail(resource: str, used: int, allowed: int) -> dict[str, Any]:
    return {
        "detail": f"{_PREFIX}{resource}",
        "code": "TRIAL_LIMIT",
        "resource": resource,
        "used": used,
        "allowed": allowed,
    }


def inactive_detail(state: str) -> dict[str, Any]:
    words = {
        "TRIAL_EXPIRED": "the free trial has ended",
        "SUSPENDED": "the subscription is suspended",
        "CANCELED": "the subscription was cancelled",
    }
    return {
        "detail": f"subscription inactive: {words.get(state, state.lower())}",
        "code": "SUBSCRIPTION_INACTIVE",
        "state": state,
    }


def trial_limit_from(error: psycopg.Error) -> dict[str, Any] | None:
    """The structured detail of a database refusal, or None for any other error. Only the
    resource name and two counts are read from the server message; nothing else from it
    is repeated."""
    if error.sqlstate != TRIAL_LIMIT_SQLSTATE:
        return None
    message = error.diag.message_primary or ""
    resource = message[len(_PREFIX) :].strip() if message.startswith(_PREFIX) else "subscription"
    if resource not in RESOURCE_WORDS:
        resource = "subscription"
    used = allowed = 0
    counts = (error.diag.message_detail or "").split(" of ")
    if len(counts) == 2 and all(part.strip().isdigit() for part in counts):
        used, allowed = int(counts[0]), int(counts[1])
    return trial_limit_detail(resource, used, allowed)
