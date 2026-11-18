# M3a closure evidence (21 October 2026)

The owner's eight closure items (docs/milestone-3-plan.md §15), what was done and where
it is checked.

## Caller inventory

See docs/operations.md, "Caller inventory": every module that can reach the live model,
whether it can, its provenance and budget coverage, and that each runs through the agent
caller. The route `POST …/model-calls` and the manager cannot reach the live model by
construction. Containment: the live provider refuses an unmetered generation or chat turn
unless `MODEL_ALLOW_UNMETERED=true`; `test_provenance` asserts it dynamically (a fake
vendor client is never reached) and statically (only `models.py` and `provenance.py`
record calls or invoke a chat turn).

## Cancellation

| Check | Result | Test |
| --- | --- | --- |
| Requested and completed distinguishable | `cancel_state` REQUESTED while running and asked, CANCELLED once stopped, NONE after a rerun; two audit events | `test_a_person_cancels_a_queued_or_running_run_and_runs_it_again` |
| No late response committed | the first item's answer arrives after the request and is discarded; the call stays recorded; the rerun tests all three with one call each | same |
| Retries respect cancellation | a timeout, then a cancellation during the pause: attempt 2 recorded `CANCELLED`, no second call | `test_retries_respect_a_cancellation_and_budgets_count_every_attempt` |
| Attribution preserved | the discarded call and the later calls carry the agent and the requester; the stopped run's note names the person | same tests |
| Audit history | `agent_run.cancel_requested` by the person; `testing.run_cancelled` with the agent instance and the items tested | same |
| The action in the UI | `cancel-1-offered.png` (queued run on the demo engagement, button under the Run line), `cancel-2-cancelled.png` ("Stopped. Cancelled by Dana Whitfield. Run it again when ready.", button gone, `?cancel=cancelled`), `cancel-3-mobile.png` (390 px, document width 390) | headless Chrome against the demo API without a worker |

## Key rotation

docs/operations.md, "Encryption keys and rotation". Test:
`test_content_stays_readable_across_a_key_rotation` (old key kept: 200 with the old key's
id; dropped: 409 naming the id; the record and hash stay).

## Budgets

Enforced across retries (`test_retries_respect_a_cancellation_and_budgets_count_every_attempt`:
a malformed first attempt's cost counts and the retry is refused), on chat turns
(`test_a_turn_is_metered_recorded_and_stopped_by_the_budget`), and visible on
`GET …/workspace/automation` (`budget`).

## Provenance

`GET …/model-calls/{id}` returns the requesting person, the agent instance and key, the
model and tier, the prompt version and hashes, the inputs (sheet, version, plan revision,
files with content hashes), the attempt, duration, status, error, tokens, cost and
whether content is sealed (`test_the_tester_records_its_calls_with_provenance_and_acts_as_the_agent`).

## Gate

See `tests.md` (M3a) and §15.6 of the plan for the closure's commands and results.
