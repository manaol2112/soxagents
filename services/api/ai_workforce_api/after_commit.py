"""Work a request hands to the background worker only once it has committed.

A request that queues background work (a plan run, a request's draft, a test run) writes
the queued row in its own transaction. Handed to the worker inside the request, the
worker's claim ran against the rows as they were before it: work just queued was not there
to claim, was skipped, and then waited, queued, for nobody (found on 12 November 2026).
So a route runs its work through `committed`, and whatever the work passes to
`after_commit` is handed over once the request's connection has committed.

A handoff that fails never fails the request: what was queued stays queued in the
database and is picked up by the worker's start, or handed over again by the person.
Outside a request (a worker, a script, a test calling a service function) there is
nothing to wait for, and the handoff runs at once.
"""

import logging
from collections.abc import Callable
from contextvars import ContextVar

logger = logging.getLogger(__name__)

_AFTER_COMMIT: ContextVar[list[Callable[[], None]] | None] = ContextVar(
    "after_commit_handoffs", default=None
)


def after_commit(handoff: Callable[[], None]) -> None:
    """Hand work over once the request has committed; at once outside a request."""
    waiting = _AFTER_COMMIT.get()
    if waiting is None:
        handoff()
    else:
        waiting.append(handoff)


def committed[T](call: Callable[[], T]) -> T:
    """Run a request's work (which opens, uses and commits its own connection), then hand
    over what it queued. Nothing is handed over when the work fails: it rolled back."""
    handoffs: list[Callable[[], None]] = []
    token = _AFTER_COMMIT.set(handoffs)
    try:
        result = call()
    finally:
        _AFTER_COMMIT.reset(token)
    for handoff in handoffs:
        # The request has committed: a worker that cannot be reached must not turn a
        # recorded decision into an error (the person would retry and be refused), nor
        # stop the handoffs after it. What was queued stays queued in the database and
        # is picked up without this handoff: the local worker's start (resume, which
        # reads open_plan_runs and the open drafts and tests), the workflow engine's
        # start (durable.resume_plan_runs), and, for a run that follows the
        # understanding, the person's "Run again" (the generate route hands a queued
        # run over again).
        try:
            handoff()
        except Exception as error:
            logger.warning(
                "queued work could not be handed to the worker (%s); it stays queued",
                type(error).__name__,
            )
    return result
