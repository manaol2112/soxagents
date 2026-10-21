# Running the agents (operations)

Milestone 3a. How the agents' background work runs in each environment, what the model
configuration means, what each execution state is, and where the records are.

## Workers

Agent work (reading evidence, drafting requests, testing, drafting workpapers, the
independent re-performance, planning, the console's turns) is a job on its own record:
the record carries a lease status (`PENDING`, `WORKING`, `IDLE`; an analysis ends in
`READY` or `FAILED`), the attempt count and the lease expiry. One of two workers runs it:

| Environment | Setting | Worker |
| --- | --- | --- |
| Development | `LOCAL_WORKER_ENABLED=true`, `WORKFLOW_ADDRESS` empty | A thread pool inside the API process (`LOCAL_WORKER_THREADS`, default 6). Open records are resumed when the API starts. |
| Staging, production | `WORKFLOW_ADDRESS=host:7233` | Temporal (`docker-compose.yml` publishes it on localhost:7233). The API process serves the worker; each job is a workflow with retries and a start-to-close timeout. |
| Neither | both empty | Nothing runs. Queued work stays queued and every page says automation is unavailable. |

A job that fails is tried again up to its `MAX_ATTEMPTS` (three), then rests with a note
("did not finish") and the queue offers to run it again. A worker that dies mid-job
leaves the record `WORKING` with a lease; the next worker resumes it when the lease runs
out (15 minutes for a test run, 10 for a read), and a unit written before the crash
stands (each item is one transaction).

## The model

`MODEL_PROVIDER=anthropic` and `MODEL_API_KEY` turn the live provider on. Three tiers each
pin a model; empty values take the defaults, which were checked against the provider's
model list, its published prices and a structured-output call on 20 October 2026:

| Tier | Default | Price (in, out, $ per million tokens) | Policy (the owner's development defaults) |
| --- | --- | --- | --- |
| FAST (`MODEL_FAST`) | `claude-haiku-5-5` | 0.10, 0.50 | Routine classification and low-complexity extraction: reading, matching and classifying evidence, model OCR, RCM system scans and term mapping, system suggestions, the library match |
| BALANCED (`MODEL_BALANCED`, or the older `MODEL_NAME`) | `claude-sonnet-5-5` | 2, 10 | Evidence interpretation, testing drafts and routine reviewer analysis: the evidence coordinator, the testers, the screenshot review, workpapers, the independent reviewer's re-performance, the planner's plans, attributes, process maps, setup and scoping, the console's lead agent |
| DEEP (`MODEL_DEEP`) | `claude-opus-5-5` | 4, 20 | Explicitly authorized complex analysis only: no agent runs on it unless `MODEL_DEEP_AGENTS` names its roster key (for example `independent-reviewer,engagement-planner`) |

The mapping is `model_providers.AGENT_TIERS`; it is a development default, not a
production policy. A live model whose price the code does not know is refused at the
call and reported by `GET …/workspace/automation` (`model: none` with the reason);
`MODEL_PRICES` names a price for it. The automation route also says which model answered
last, how, and the engagement's spend this month against the limits (`budget`), all read
from the call records, never by calling the model. No page or queue read calls the model
(`test_agent_execution`).

## One way to call the model (containment)

Every model call an agent makes goes through `provenance.AgentCaller` (`generate` for a
structured answer, `chat` for the console's turns): the tier picks the model and price,
the budgets are checked before dispatch, a cancellation is honoured, each attempt is
recorded with its provenance, and the prompt and answer are sealed when a key is set.
The evidence reading modules keep their provider-and-record protocol; `CallerProvider`
is the caller behind it.

The live provider refuses anything else: a generation under the untiered configuration
or a chat turn not marked by the caller is turned away before any network call
(`MODEL_ERROR`, logged as "unmetered live model … refused"). `MODEL_ALLOW_UNMETERED=true`
lifts that for development only; it is never set for a real engagement, and
`test_provenance` asserts the refusal and the static rule that only the adapter and the
caller record calls or invoke a chat turn.

### Caller inventory (Milestone 3a closure)

| Module and operation | Live model possible | Provenance and budget | Through the caller |
| --- | --- | --- | --- |
| `testing_engine` tester run, per item | yes | full, with inputs (sheet, version, plan revision, files and hashes) | yes, cancellable |
| `control_reviews` re-performance, per item | yes | full, with inputs | yes, cancellable |
| `evidence_analysis` matching, classification, model OCR, screenshot review | yes | full, with inputs (file and hash); the review on the tester's agent | yes (`CallerProvider`), cancellable |
| `pbc_drafting` request draft | yes | full | yes |
| `workpaper_service` narrative draft | yes | full | yes, cancellable |
| `evidence_plans` planner | yes | full | yes |
| `console` lead agent turns | yes | full (`propose_tools`, `console/1`) | yes (`chat`); the console keeps its own retry policy |
| `setup_drafting`, `system_applicability` (scoping, SOC reports), `control_attributes`, `process_understanding` | yes | full | yes (closure) |
| `rcm_systems`, `rcm_terms`, `library_matching`, `system_suggestions` | yes | full (FAST) | yes (closure) |
| `models` route `POST …/model-calls`, `manager` task planning | no: `_provider_for` returns the local or the unavailable provider, never the live one | the record as before | not applicable; refused live by construction |

No caller remains that can reach the live model without a budget and a provenance
record.

## Budgets

Enforced before a call is sent, from an estimate of its cost (the prompt, the system
text, the images, the full output allowance); a call past a limit is not sent and is
recorded as `BUDGET_EXCEEDED` with the limit named. Every attempt counts, retries
included. Micro-dollars; 0 removes a limit.

| Setting | Development default |
| --- | --- |
| `MODEL_BUDGET_CALL_MICROS` | 1,000,000 ($1 a call) |
| `MODEL_BUDGET_JOB_MICROS` | 10,000,000 ($10 a job: one run of one record) |
| `MODEL_BUDGET_ENGAGEMENT_MONTH_MICROS` | 50,000,000 ($50 an engagement a calendar month, UTC) |

These are provisional development limits, not production ones. A job stopped by a
budget rests like a failed one; a console turn stopped by one tells the person. The
owner raises the limit or waits for the month. The month's spend and the limits are on
`GET …/workspace/automation`.

## What a record says about who produced it

| Source | Meaning |
| --- | --- |
| `MODEL` | The model's answer, checked (schema, attributes, citations, candidates) |
| `RULES` | The reviewed rules by design: no model is configured, or the rules are the method |
| `FALLBACK` | The model failed or its answer was rejected, and the rules produced a separate result; the failed call is linked and the note names the failure first |
| `FAILED` | The model failed and nothing stands in; a person decides (a test item is "unable to tell") |
| `REVIEW` | A control tested once reused its screenshot review (no model configured) |

A model failure is never written as `RULES`, and a rules result never makes a failed call
read as `MODEL`.

## Provenance

Every call is a row in `model_calls`: the requesting person (`actor_user_id`), the
executing agent's instance (`actor_agent_instance_id`) and key, the model that answered
and its tier, the prompt's version and SHA-256, the answer's SHA-256, the record worked
on, the job and attempt, the duration, the status and the error class (never a vendor
message, never the key), the tokens and the cost, and `inputs`: what the call was made
from (the evidence file ids and content hashes, the sheet and its version, the approved
plan revision, the request or control). `GET …/model-calls/{id}` returns all of it.
Audit events written by a job name the agent's instance beside the person it worked for.
These records are audit records: they are never purged.

With `PROVENANCE_KEY` (32 random bytes, base64) the prompt and the answer themselves are
kept in `model_call_contents`, encrypted (AES-GCM, the call id as associated data) for
`MODEL_CONTENT_RETENTION_DAYS` (default 90, configurable). The deploy step
(`make migrate`) removes the expired ones; the call records and hashes stay. The firm's
owner or admin, or the engagement's reviewer, reads a call's content with
`GET …/model-calls/{id}/content?purpose=…`, inside the engagement only; the purpose is
required and every read is audited (`model_call.content_read`). Without the key only
hashes are kept.

### Encryption keys and rotation

- **Identification.** Each key is named by its id: the first twelve hex characters of
  the SHA-256 of the key bytes. Every sealed record carries the id of the key that
  sealed it (`model_call_contents.key_id`, and `key_id` on the content route's answer).
  The id reveals nothing about the key.
- **Rotation.** Generate a new key (`openssl rand -base64 32`), set it as
  `PROVENANCE_KEY`, and move the previous value into `PROVENANCE_PREVIOUS_KEYS`
  (comma-separated; several may be kept). Restart the API. New content is sealed under
  the new key; content sealed under an earlier key is read with the earlier key, chosen
  by its id. Nothing is re-sealed: the old key must stay configured for as long as its
  content is to be readable, that is at most the retention period, after which the
  purge removes the last content it sealed and it can be dropped.
- **Old-key access.** A key kept only in `PROVENANCE_PREVIOUS_KEYS` decrypts; it never
  seals. Dropping a key from both settings makes its content unreadable at once; the
  read answers 409 naming the key id to restore.
- **Recovery if a key is lost.** The content sealed under it cannot be recovered. The
  call records, their hashes, inputs, tokens, costs, statuses and audit events are
  unaffected and remain the audit record; a reviewer can still see what was asked (the
  hash, the version, the inputs) and how it ended. The unreadable content rows expire
  with their retention, or an operator removes them early with
  `DELETE FROM model_call_contents WHERE key_id = …` (the trigger allows a delete only
  once expired; an early removal is a deliberate operator action in a transaction that
  disables the trigger, and is recorded in the change log).
- **Not built.** Re-sealing under a new key, per-tenant keys, and an external key
  management service. The single process key is documented, identified and rotatable;
  that is the whole of the design for this milestone.

## Cancellation

`POST …/agent-runs/{kind}/{id}/cancel` with `kind` one of `test-sheet`, `review`,
`analysis`, `workpaper`, for a member who may update the engagement; the control's Agent
says block offers it as **Cancel run** while a tester run or a re-performance is queued or
running. The record keeps the two moments apart:

| State | Meaning | Where |
| --- | --- | --- |
| `REQUESTED` | A person asked a running job to stop; it has not yet | `cancel_requested_at` and `cancel_requested_by` set, `cancelled_at` null; `cancel_state: REQUESTED` on the sheet, review and workpaper bodies; audit `agent_run.cancel_requested` |
| `CANCELLED` | The job stopped (at once when it was only queued; at its next check when it was running) | `cancelled_at` set, the status at rest, the note "Cancelled by …. Run it again when ready."; `cancel_state: CANCELLED`; audit `testing.run_cancelled` (or the kind's own action) naming the agent that stopped and the person who asked |
| `NONE` | Nothing pending, and the last outcome was not a cancellation | after the job is run again |

What is guaranteed: a job checks for a cancellation before every model call, between
units, and **after** a call returns, so an answer that arrives after the request is
never committed (the call stays on the record as made, with its cost; the unit stays
untested); the caller checks before each retry, so no further attempt is made once
cancellation is asked for; units written before the request stand and keep their
attribution; a failed or stopped run keeps its own note and audit events. Running the job
again is the recovery, and it tests only what was left.

## Live tests

`services/api/tests/test_live_model.py` runs only with `MODEL_LIVE_TESTS=1` and a key
(`set -a && . ./.env && set +a && MODEL_LIVE_TESTS=1 uv run pytest -s
services/api/tests/test_live_model.py`). It makes one short call per tier and runs the
tester once on a synthetic control: a few cents. It is never part of `make test`,
`make test-fast` or `make test-critical`.
