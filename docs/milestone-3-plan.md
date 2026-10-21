# Milestone 3 plan: real agentic audit capabilities

Written 21 October 2026, after Milestone 2's acceptance, for the product owner's review
before any Milestone 3 code. Milestone 3 validates that the platform performs real agentic
audit work: durable agent execution against a real model provider, evidence intelligence,
grounded testing, reliability and safeguards, and an end-to-end validation with real
evidence and actual model responses. It is not a UI redesign. Nothing in this document has
been implemented; M3a starts only when the owner approves this plan.

The owner's principles, which every stage below is held to:

- Agents draft, analyze, test and recommend. They never approve their own work.
- Approved procedures, attributes and conclusions are never altered silently by an agent.
- Every agent output is a proposal until a person decides it, with its evidence,
  rationale and status traceable.
- No silent fallback from a failed model call to fabricated success. Never invent
  samples, evidence, approvals or testing outcomes.
- No competing workflow engine, status model or user interface.
- Model calls are never executed as part of ordinary queue or page reads; the Milestone 2
  queue baseline (581 ms at 155 controls, 808 ms at 403, in process) is preserved.

## 1. Architecture assessment (inspected)

### 1.1 Durable execution

Two execution paths exist behind one job model, and business code depends on neither
engine directly (ADR 0002; `test_durable` asserts no business module imports the SDK):

- **Temporal** (`durable.py`, `durable_workflow.py`): twelve workflow types
  (`console_turn`, `control_testing`, `control_review`, `evidence_analysis`,
  `evidence_plan_run`, `pbc_draft`, `setup_draft`, `workpaper_draft`, `pbc_follow_up`,
  `rcm_system_scan`, `system_review`, `durable_effect`), one task queue, `RetryPolicy`
  per activity (for example analysis 8 min start-to-close, three attempts, 2 min maximum
  interval), `resume_*` functions that re-enqueue open records at start, and the effect
  reconciliation of Milestone 4.6 (`_record_effect`, `_reconcile_effect`, `_insert_once`).
  The worker is served inside the API process when `WORKFLOW_ADDRESS` is set
  (`main.py` lifespan). Temporal is in `docker-compose.yml`.
- **Local worker** (`pbc_drafting.LocalDraftScheduler`): a thread pool
  (`LOCAL_WORKER_THREADS`, default 6) inside the API process when
  `LOCAL_WORKER_ENABLED=true` and no workflow address is set; `resume()` at start picks up
  open records; each job retries `MAX_ATTEMPTS` times, then the record is failed.

Both paths run the same job functions. **Every agent job is a lease on its own record,
not a row in a job table**: `run_sheet` claims `test_sheets` (`run_status` PENDING →
WORKING with `lease_until`, `attempts`), `run_analysis` claims `evidence_analyses`,
`run_reperformance` claims `control_reviews.reperform_status`, `run_draft` claims
`workpapers.draft_status` and `pbc_drafts.status`, `run_turn` claims the agent message.
A lease that expires is picked up again (`open_runs`, `open_turns`, `open_analyses`),
`fail_run`/`fail_draft`/`fail_turn` stop after the last attempt with a note and an audit
event (`testing.run_failed`), and `db.independent_steps` makes each step commit on its
own so no row is locked while a model works. The person-facing state is derived by
`agent_runs.run_state` (IDLE / QUEUED / RUNNING) and Milestone 1d's automation status
("Automation unavailable" when no worker is configured).

What this gives Milestone 3: durable jobs, retries, lease recovery after a crash, at-most-
once effects, accurate states without a worker. What it lacks is in §2.

### 1.2 Model provider

`models.py` is a provider-neutral adapter: `ModelProvider.complete(ModelRequest,
ModelConfig) -> ModelRaw`, structured output checked against the request's JSON schema
(`complete` returns `MALFORMED` when it does not match), a status vocabulary
(SUCCEEDED, MALFORMED, TIMEOUT, CANCELLED, RATE_LIMITED, MODEL_ERROR), `record_call`
writing the immutable `model_calls` table (migration 0008: config ref, operation,
status, tokens, cost; **no prompt, no output, no model name**). `model_providers.py` is
the only module that names a vendor: `AnthropicModelProvider` (`anthropic==1.8.0`,
structured output through one tool whose input schema is the output schema, images as
base64 blocks, `max_retries=1`, timeout from the request, provider errors mapped to the
status vocabulary), `provider_for(settings)` (local / Anthropic / unavailable),
`live_model(settings)` (`MODEL_PROVIDER=anthropic` and a key), `DEFAULT_CLAUDE_MODEL =
claude-sonnet-5-5`, `CLAUDE_CONFIG` with cost per token 0 ("not configured yet"). A
streaming `ChatProvider` serves the console (`converse_streaming`, tool calls up to eight
per turn, retries after 2 s and 6 s on busy errors).

The roster (`workforce.py`, docs/workforce.md) names logical model tiers (`reasoning`,
`standard`) that nothing maps to a real model yet: every job calls the one configured
model under the one `claude` config ref.

### 1.3 Evidence readers

`evidence_extraction.py` is deterministic and bounded (xlsx cached values via openpyxl,
csv/txt, docx paragraphs and tables, PDF text layer via pypdf, images normalised for
OCR; 200,000 characters, 300 pages, 10 OCR images, 100,000 rows; archives checked
before opening; secret-looking values redacted; kind from bytes, not name).
`evidence_ocr.py` has two engines behind one interface: Tesseract locally (default,
images never leave the firm) and model vision (firm opt-in, audited). `run_analysis`
reads through the custody check (hash and size), matches an unfiled upload to a control
(rule on a control ID in the path or name, else the model among in-scope candidates,
filed only when confidence ≥ 0.8, otherwise suggestions for a person), classifies the
file against its request (model, with reviewed keyword rules when no model or the answer
fails its checks), reviews screenshots against the control's attributes (vision call,
conclusion derived from the checked results, a person signs off), and proposes a sample
for a population (deterministic seeded draw, `sampling.py` / `control_tests.propose`).

### 1.4 Testing agents

`testing_engine.run_sheet` places new files, checks the control's readiness, then tests
each item whose evidence changed: one structured call per item with the control, the
approved attributes and their definitions, the item's population row and bounded file
excerpts (9,000 characters), screenshots as images. `check_results` keeps one result per
attribute (a missing index is UNABLE), `check_citations` keeps only quotes found in the
cited file, `supported` turns an uncited PASS into UNABLE with the note "a person decides
this result". Each item records `source` (MODEL / REVIEW / RULES), `model_call_id`, a
note, and the person's overrides separately (`test_items.overrides`), so the final
result of an attribute is the override, else the proposal. Signing the sheet off is a
person's act with its history (`test_sheet_signoffs`). The master planner
(`evidence_plans`) proposes the test plan with the same shape (model, checked, else
rules, labelled); the plan is approved by a person and changes to an approved plan wait
for a decision (W3 impact assessments). Workpapers (`workpaper_service.run_draft`) are
written only from evidence that has been read or testing that is signed off
(`has_input`); without either, the narratives wait.

### 1.5 Review agents

`control_reviews.run_reperformance`: reviewed rules first (sample size against the
standard table, uncited passes, a pass set by a person where the tester saw an
exception, empty narratives, the deficiency decision), then the model re-performs each
tested item with the tester's prompt shape but as the reviewer, never seeing the
tester's results; differences become proposed notes with their own checked citations.
Notes are proposed until the engagement reviewer accepts or dismisses them;
independence rules (`independence.py`, `REVIEW_INDEPENDENCE_REQUIRED`) decide who may
sign. Round reviews (W2), sign-off history (W3) and coverage assessments (W4) stand.

### 1.6 Audit logs and operational controls

`audit_events` (actor user or agent instance, action, target, payload) is written by
every job and route; `model_calls` is immutable; `workflow_runs` / `workflow_events` /
`workflow_effects` record the Temporal path; `worker_results` (migration 0010) is the
versioned result record of the Milestone 4.5 manager path, unused by the per-record
jobs. The action catalog, policy and approvals (`actions.py`, `policy.py`,
`approvals.py`, `execution.py`; `test_security`) keep a model from certifying its own
action. The console marks evidence text as client data and bounds tool results; every
reader that feeds a model documents the text as untrusted.

### 1.7 Tests that exist for the agents

Ten test files stub the provider with `ModelRaw(output, (), 800, 200)`
(`test_testing_engine` 13 tests, `test_evidence_analysis` 11, `test_evidence_review` 8,
`test_pbc_drafting` 16, `test_master_plans` 19, `test_models` 8, `test_control_reviews`
4, `test_test_citations` 4, `test_console_citations` 5, `test_workpapers` 8). The
Anthropic adapter is exercised against a fake client (`test_evidence_reading`,
`test_pbc_drafting`), never against the API. `test_failures` covers duplicate starts,
cancellation rejecting a later result and concurrent result versions on the Milestone 4
path; `test_durable` the SDK boundary; `test_security` the policy and approval bypasses;
`test_access` tenant visibility. There is no test with a real model response, no test
of a worker crash mid-job on the per-record leases, and one prompt-injection test
(`test_evidence_reading`: the excerpt is marked as data and bounded).

## 2. What exists, what is rules- or stub-only, what is partial, what is missing

| Capability | State | Evidence |
| --- | --- | --- |
| Durable jobs, retries, lease recovery, resume at start | **Exists** (two engines, one job model) | §1.1; `test_failures`, `test_durable` |
| Provider-neutral model adapter, schema check, status vocabulary, call record | **Exists** | `models.py`, `test_models` |
| Anthropic provider | **Exists, never validated live** in this repository's environment | `model_providers.py`; fake-client tests only |
| Model tiers → real models, cost per token, per-engagement spend | **Missing** | one config ref, cost 0 |
| Prompt and output provenance (what the model was asked, what it answered, which model and prompt version) | **Missing**: `model_calls` stores tokens and status only; items keep `model_call_id` | migration 0008 |
| Cancellation of a running job by a person | **Missing**: `ModelRequest.cancelled` exists, every job passes `False`, no route | §1.1 |
| Accurate execution states | **Exists** (run records + automation status) | M1d |
| Agent attribution in the audit trail | **Partial**: jobs write `actor_user_id` = requester with `{"agent": "control-tester"}` in the payload; `actor_agent_instance_id` is unused by jobs | `audit_events` |
| Deterministic file reading, OCR, custody check | **Exists** | `test_evidence_reading` |
| Control matching, classification, screenshot review, sufficiency | **Exists with the model; rules or "a person decides" without** | §1.3 |
| Period, completeness and population checks | **Exists, rules only** (by design) | `sampling.py` |
| Sample selection | **Exists, deterministic, seeded, person-approved** | `control_tests.propose` |
| Per-item testing with citations, uncited pass → UNABLE | **Exists**; validated only with stub answers | §1.4 |
| Test plan drafting, attribute proposals, process map | **Exists**; model with rules fallback, labelled, person approves | `evidence_plans`, `control_attributes`, `process_understanding` |
| Workpaper narratives | **Exists**; grounded in read evidence or signed testing | `workpaper_service` |
| Reviewer re-performance and proposed notes | **Exists**; validated only with stub answers | §1.5 |
| Conclusion recommendation (control-level opinion from results) | **Partial**: the sheet's conclusion follows the results by rule; a written rationale from the model is not produced | `testing_engine` |
| Approvals, SoD, independence, immutable history | **Exists** | critical set |
| Prompt-injection resistance | **Partial**: readers mark data as untrusted, outputs are schema- and candidate-checked; one explicit test | §1.7 |
| Tenant isolation inside jobs | **Exists by construction** (every job reads its record's organisation and project); not tested for a crafted cross-tenant id in a model answer | `test_access` |
| Reproducible records of an agent's work | **Partial**: results, citations, source and call id are kept; the prompt, answer and model are not | §2 row 5 |
| Live end-to-end validation | **Missing** | M2 completion report: "live model responses, a running worker and outbound email remain unvalidated" |

The "rules were used" wording in `model_providers.call_note` is the one place where a
model failure reads like a fallback to success. Where it is applied today the rules
output is itself reviewed code, labelled `source = RULES` with the note, and a person
still decides (plans, drafts, setup); the tester and reviewer strip the phrase and leave
the item UNABLE. M3a makes the distinction explicit in the record (§4.2) so that no
reader has to know the wording.

## 3. Sequence

Five stages, each reviewed before the next. No stage rebuilds what §1 found; each adds
the smallest thing that makes the next validation possible.

| Stage | Purpose | Migration | Model calls in tests |
| --- | --- | --- | --- |
| M3a Real agent execution | Jobs run on a configured worker against a real provider, with accurate states, retries, cancellation, recovery and provenance | 0094 (provenance) | stubbed, plus one gated live smoke |
| M3b Evidence intelligence | Reading, matching, classification, period and completeness checks and sufficiency on real evidence, with every finding traceable to the file | none expected | stubbed, plus gated live |
| M3c Grounded testing | Per-item testing, exceptions, conclusion recommendation and reviewer re-performance from real evidence; nothing invented | none expected | stubbed, plus gated live |
| M3d Reliability and safeguards | Tenant isolation, least privilege, injection resistance, failure and retry, unsupported conclusions, approvals and SoD, reproducibility, budgets | 0095 only if budgets need a table | stubbed adversarial |
| M3e End-to-end validation | One engagement, real (synthetic) evidence, actual model responses, worker running; report what the AI did and what was simulated | none | live |

## 4. M3a: real agent execution

### 4.1 Worker configuration

- One documented way to run the agents in each environment, using what exists:
  development on the local worker (`LOCAL_WORKER_ENABLED=true`), staging and production
  on Temporal (`WORKFLOW_ADDRESS`), both with `MODEL_PROVIDER=anthropic` and a key held
  only in the environment. `docs/operations.md` (new) records the variables, the start
  order, the health signals and what each state means. No new engine.
- The automation status route (M1d, `workspace/automation`) gains the provider's
  readiness (configured / unavailable / unreachable since <time>), read from settings and
  the last recorded call outcome, never by calling the model.

### 4.2 Provenance (migration 0094)

`model_calls` keeps tokens and status by design ("prompts, outputs and provider keys are
not stored"); Milestone 3 needs the record to be reproducible and reviewable. Proposed:

- `model_calls` gains `model_name`, `prompt_version` (a version string each agent
  declares beside its prompt), `prompt_sha256`, `output_sha256`, `agent_key` (the roster
  key), `target_type` and `target_id` (the record worked on), `attempt` and
  `duration_ms`. The immutability trigger stays.
- A new table `model_call_contents` (organisation, project, call id, prompt text,
  system text, output JSON, image count, created at), **immutable, visible only to the
  firm's owner or admin through one read route**, kept to let a reviewer see exactly
  what the agent was asked and answered. Evidence text is already redacted before it
  reaches a prompt. Retention: the engagement's lifetime; removed with the engagement's
  close-out export if the owner so decides (open question Q2).
- Each agent job writes the audit event with `actor_agent_instance_id` set to the
  engagement's instance of the roster worker (the `agent_instances` row the staffing
  triggers already create) and `actor_user_id` kept as the requester, so the trail says
  which agent acted for whom.
- `source` on items, analyses, plans, drafts and reviews gains the value `FAILED`
  beside MODEL / REVIEW / RULES where today a failed call leaves RULES with a note:
  **a record never says RULES when the rules did not produce it.** The tester and the
  reviewer already leave UNABLE; they will record `FAILED` with the call's status.

### 4.3 States, retries, cancellation, recovery

- States stay the lease model (PENDING / WORKING / IDLE plus the failure note) and
  `run_state`; nothing new is derived on the client.
- Retries: the job-level attempt counters already exist. M3a makes the provider's
  transient statuses (TIMEOUT, RATE_LIMITED, overloaded MODEL_ERROR) retry with the
  job's backoff and the terminal ones (a rejected request, MALFORMED twice) stop the
  attempt, recording which; the console's 2 s / 6 s policy becomes the shared one in
  `models.py` so each job does not keep its own.
- Cancellation: `POST …/runs/{kind}/{id}/cancel` for a person with update rights on the
  engagement (the tester's sheet, an analysis, a re-performance, a workpaper draft,
  a plan run); the job checks the cancellation flag between items and before each model
  call (`ModelRequest.cancelled` becomes a callable), records `CANCELLED` on the call
  and the record, and the queue reads a cancelled run as the person's next action
  ("Run the tester again" is the recovery, as for a stopped run).
- Recovery: a lease that expires while a worker is dead is resumed (exists). M3a adds
  the test that a job killed between the model answer and the write leaves no partial
  result (each item writes in one transaction; the next attempt tests the item again
  and records a second call).

### 4.4 Acceptance criteria

1. With `MODEL_PROVIDER=anthropic` and a worker, requesting a test run on a fixture
   control produces items with `source = MODEL`, a call record with model name, prompt
   version, hashes and duration, an audit event attributed to the tester's instance,
   and the sheet's run state passes QUEUED → RUNNING → IDLE without a page calling the
   model.
2. A failed call (timeout, rate limit, rejected request, malformed twice) leaves the
   item UNABLE with `source = FAILED` and the status named; nothing reads as a success.
3. Cancelling a running job stops it at the next check; the record says cancelled, by
   whom and when; the next action is to run it again.
4. Killing the worker mid-run and starting it again completes the run with no duplicate
   or partial item result (automated with the local worker).
5. The queue's in-process time at 155 controls is within 10 % of the Milestone 2
   baseline; no route in the page-load path calls `provider.complete`.

### 4.5 Tests

`test_testing_engine` (states, FAILED source, cancellation, crash recovery with a
provider stub that blocks on an event), `test_models` (retry policy, provenance fields,
content table visibility by role and tenant), `test_migrations`/`test_schema` for 0094,
`test_queue` unchanged plus the timing assertion. One live smoke test, skipped unless
`MODEL_LIVE_TESTS=1` and a key are set, that sends one bounded prompt and asserts the
schema-checked answer and the call record (never in `make test-critical`).

## 5. M3b: evidence intelligence

Scope: the existing analysis pipeline on real evidence, with every finding pointing at
the file and the words it rests on. No new pipeline.

- **Reading**: the deterministic readers are kept; M3b measures them on a corpus of
  realistic synthetic evidence (§9.3): access listings, change tickets, job logs,
  approval emails, configuration screenshots, scanned sign-offs, multi-sheet workbooks,
  password-protected and corrupted files. Gaps found become reader fixes, not model
  calls.
- **Period and completeness**: the population checks (`sampling.py`) are extended where
  the corpus shows a miss (date formats, fiscal periods, a key column the rule does not
  recognise), each with its rule written and tested; the model may **suggest** a key or
  date column when the rules find none, recorded as a suggestion a person confirms
  before the frame is built. The frame itself stays deterministic.
- **Matching and classification**: validated live on the corpus; the confidence
  threshold, the candidate list and the "a person chooses" path are measured (how many
  filed, how many suggested, how many wrong). A wrong filing is corrected by a rule or a
  prompt change with its version bumped, never by lowering the threshold without the
  owner's decision.
- **Sufficiency**: the evidence review's checks (legible, right system, in period, no
  signs of editing, applicable) and the request-level sufficiency (`evidence_plans`,
  ACCEPTED / INSUFFICIENT) keep a person's decision; the agent's proposed sufficiency
  gains a written reason per requirement citing the file, so the reviewer sees why.
- **Traceability**: every classification, match, screenshot finding and sufficiency
  proposal shows the call it came from, its prompt version and the quoted words
  (`console_citations` style check: a quote not found in the file is dropped).

Acceptance: on the corpus, every filed match is right or marked for a person; no
classification names an item the request does not have; every screenshot finding has a
box or quote that checks out; a file that cannot be read says so and queues a person,
never a guess; results are identical on a second run of the same file (same prompt
version, same seed where sampling applies) or the difference is recorded as the
model's.

## 6. M3c: grounded testing

Scope: the tester, the reviewer and a conclusion recommendation on real evidence.

- **Per-item testing**: validated live on the corpus's controls (an access review, a
  change, a backup job, a journal entry approval, a test of one for a configuration).
  The citation requirement stands: an uncited pass is UNABLE. M3c measures agreement
  with the corpus's known answers (each synthetic item has a planted outcome) and
  reports false passes, false exceptions and unable rates per attribute.
- **Sampling**: unchanged and deterministic. The tester never selects or replaces an
  item; it tests the items a person approved. A control whose samples are not approved
  is not tested (readiness, exists).
- **Exceptions**: a model EXCEPTION needs the observed-versus-expected note and a
  citation; the proposed deficiency follows the existing rule. The agent never logs or
  dismisses a deficiency.
- **Conclusion recommendation**: the sheet's conclusion follows the final results by
  rule (exists). M3c adds the tester's written rationale per sheet (what was tested,
  what passed, what the exceptions mean for the control objective, what it could not
  tell), stored as a proposal on the sheet with its call id, shown in Agent says and
  the Conclude step, **never written into the conclusion field**. A person signs off as
  today.
- **Reviewer**: re-performance live on the same corpus; proposed notes are measured
  against the planted outcomes; the reviewer still never sees the tester's results.
- **Mandatory human review** is unchanged: sheet sign-off, note decisions and review
  sign-off remain a person's, under the independence rules.

Acceptance: no PASS without a verified citation; no sample, file or approval created by
an agent; the conclusion field is written only by the sign-off route; the reviewer
proposes a must-fix note on every planted false pass the tester made; a run against the
same evidence and prompt version is reproducible or its variance is recorded; the
approved attributes and the approved plan are byte-identical before and after a run.

## 7. M3d: reliability and safeguards

Each item is a test or a small change, not a feature:

- **Tenant isolation**: a model answer that names another firm's control, file or
  request id is dropped (candidate lists already bound the answer; the test proves it
  for matching, citations, the console's tools and the review notes).
- **Least privilege**: the roster's allowed actions are enforced for every job
  (`workforce.py` fingerprint test exists; M3d adds a test that a job cannot call a
  service function outside its worker's actions and that no standard worker holds
  `permission.modify` or `mail.external`).
- **Prompt injection**: a corpus of hostile evidence (instructions in a cell, in OCR
  text, in a file name, in a folder path, in an email body) asserting that the tester
  keeps testing, the classifier keeps classifying, no tool runs, no citation is forged,
  no approval is proposed; the system prompts are reviewed and versioned.
- **Model failure and retry**: the retry matrix of §4.3 under each status; a provider
  that returns a schema-valid but semantically empty answer; a provider that returns a
  success with negative tokens (exists); a rate limit sustained past the attempts.
- **Unsupported conclusions**: a pass with a citation that does not check out, an
  exception without an observation, a result for an attribute that does not exist, a
  conclusion the results do not support; each is refused by the check that exists or
  one added.
- **Approvals and SoD**: the critical set stays; M3d adds the agent-specific cases: a
  turn that proposes approving its own draft, a job that tries to sign a sheet, a
  reviewer re-performance on the preparer's own sheet under independence.
- **Budgets**: per-engagement and per-firm model spend limits from configuration
  (`MODEL_BUDGET_*`), enforced in `record_call`'s path before a call (a job past the
  budget stops with `BUDGET` as its reason, visible in the queue), with cost per token
  configured per model name. Migration 0095 only if a budget ledger table is needed
  rather than summing `model_calls` (decision Q4).
- **Reproducibility**: a read route that assembles, for one item or note, the prompt
  version, the content record, the files and their hashes, the answer and the checks
  applied: the record a regulator or a reviewer would ask for.

Acceptance: every case above has a test in the critical set; `make test-critical`
passes; no safeguard was relaxed to make it pass.

## 8. M3e: end-to-end validation

One fixture engagement built from the corpus (§9.3), the local worker and Temporal each
once, the Anthropic provider configured, independence on, mock mail inbound: plan a
control (the planner's proposal, a person approves), request evidence (the drafter, a
person approves, the portal upload), read and classify it, sample, test, draft the
workpaper, re-perform, decide notes, sign off, conclude; then a retest after a planted
exception. The evidence pack (`docs/review/m3e/`) records for each step what the model
did, its call record and provenance, what a person decided, what was simulated (email
delivery, the client's reply), and timing and cost. The report states accomplishment
versus simulation plainly.

Acceptance: the walkthrough completes without hand edits to the database; every agent
output in it has a provenance record; the owner can open any item and see the prompt
version, the evidence cited and the person who decided; the costs are within the budget
set; the Milestone 2 queue baseline holds on the same engagement.

## 9. Design detail

### 9.1 Agent execution and provenance

```
person's action (route, authorized)
  → record set PENDING, audit event (actor: person)
  → scheduler (local pool | Temporal activity) → job claims the lease
  → for each unit: prompt (versioned) → provider.complete → status
       SUCCEEDED → schema check → domain check (citations, candidates, attributes)
                 → write unit result, source = MODEL, model_call_id
       MALFORMED/FAILED → write unit result UNABLE, source = FAILED, status in note
       CANCELLED → stop, record cancelled
     each unit: model_calls row (+ contents) and audit event (actor: agent instance,
     for: requester)
  → lease released: IDLE | PENDING (requested again) | failed note after last attempt
person decides: override, approve, sign off (routes unchanged, SoD unchanged)
```

Nothing above runs from a GET. The queue reads `run_status`, `attempts`, the note and
the automation status.

### 9.2 Human approval and reviewer safeguards

Unchanged and asserted again in M3d: approvals record the exact payload and never the
requester's own; the engagement reviewer, never the preparer or the signer, decides
notes and signs reviews; a must-fix note reopens the work; plan changes after sign-off
raise an impact assessment; the agent proposes and a person decides at every one of
these points; the console's confirm flow runs as the person with the route's own
authorization. New in Milestone 3: `source = FAILED`, cancellation, budgets and the
provenance record, each a read or a stop, never a decision.

### 9.3 The evidence corpus

Synthetic, generated by a script in the repository (`scripts/corpus/`), with no client
data: controls across access, change, operations and a business process; populations
with planted duplicates, out-of-period rows and blank keys; evidence per sample with
planted passes, exceptions and gaps; screenshots rendered from HTML with planted dates
and system names; hostile files for §7. Each file carries its known answer in a
manifest the tests compare against. The corpus is the basis of M3b, M3c, M3d and M3e.

### 9.4 Failure modes and recovery

| Failure | Behaviour | Recovery |
| --- | --- | --- |
| Provider timeout or rate limit | Attempt retried with backoff within the job's attempts; status recorded on each call | Automatic; after the last attempt the record is failed with the reason, the queue offers "run again" |
| Provider rejects the request (bad key, bad model name) | No retry; record failed; automation status shows unreachable with the time | Operator fixes the configuration; a person runs again |
| Malformed answer | One retry; then UNABLE with `FAILED` | A person decides the item or runs again |
| Worker crash mid-run | Lease expires; the next worker resumes; the item is tested again (no partial write) | Automatic |
| Cancellation | Stops at the next check; recorded | A person runs again |
| Budget exhausted | Job stops before the call with `BUDGET`; nothing partial | Owner raises the budget; a person runs again |
| Storage or custody mismatch | Analysis fails with the audit event (exists) | A person replaces the file |
| Hostile evidence | The checks drop forged citations, unknown candidates and unknown attributes; the item is UNABLE where nothing checks out | A person tests the item |
| Model answer names another tenant's record | Dropped by the candidate check; logged | None needed |

## 10. Data and API changes

Only those the stages need:

- Migration 0094 (M3a): `model_calls` columns (§4.2), `model_call_contents`, the
  `FAILED` source value on `test_items`, `evidence_analyses`, `control_reviews`,
  `workpapers`, `pbc_drafts` and the plan runs; a `cancelled_by` / `cancelled_at` pair
  on the leased records; the sheet's conclusion rationale (M3c) can be a column on
  `test_sheets` added in 0094 to avoid a second migration, written only by the job and
  cleared on reopen.
- Routes (M3a): `POST …/runs/{kind}/{id}/cancel`; `GET …/model-calls/{id}` (owner or
  admin; the content record); `workspace/automation` gains the provider's readiness.
  (M3d): `GET …/provenance/{target_type}/{id}` assembling the record of §7.
- Settings: `MODEL_NAME_REASONING`, `MODEL_NAME_STANDARD` (the roster's tiers), cost
  per token per model name, `MODEL_BUDGET_ENGAGEMENT_MICROS`, `MODEL_BUDGET_FIRM_MICROS`,
  `MODEL_LIVE_TESTS`. Defaults keep today's behaviour (one model, no budget).
- No change to the status model, the queue's item shape, the destinations or the
  workflow engines.

## 11. Testing strategy (risk-based)

- Each stage: format, lint, typecheck on the modified code; `make test-fast` with
  `FAST_PY`/`FAST_NODE` set to the stage's files; `make test-critical`; migration tests
  when 0094/0095 land, applied to the development database; the stage's focused
  integration tests named in its report.
- Stub-based tests stay the gate; **live model tests are gated by `MODEL_LIVE_TESTS=1`**
  and a key, run by hand for each stage's report and in M3e, never in CI by default,
  with their call records and costs reported.
- The corpus manifest makes the live measurements repeatable: the same files, the same
  known answers, the same prompt versions.
- Legacy expectations: a test that encodes "RULES with a note after a model failure"
  is rewritten to expect `FAILED` with the methodology justification; nothing is
  retired.
- The full suite runs only when the owner asks.

## 12. Risks, dependencies and open questions

Risks:

- **Cost and rate limits** during live validation; held by budgets (M3d) and by running
  the live tests by hand with a reported spend. Until M3d, M3a's live smoke is one call.
- **Model variance** across runs makes "reproducible" mean "the same inputs, the record
  of what was answered", not identical answers; the plan says so and records variance.
- **Provenance storage** holds prompts that contain evidence excerpts (already
  redacted); access is owner or admin only and audited. The owner decides retention
  (Q2).
- **The corpus** may not represent the owner's clients' evidence; the corpus is
  reviewed by the owner before M3b and extended when a reader gap appears.
- **Temporal in the owner's environment**: validated once in M3e; development stays on
  the local worker.

Dependencies: an Anthropic API key for the owner's account (held in the environment,
never committed); Tesseract installed where OCR is validated locally; Temporal from
`docker-compose.yml` for the M3e run.

Open questions for the owner:

1. **Model names per tier**: `claude-sonnet-5-5` for `standard` and `claude-opus-5-5`
   for `reasoning` (planner, reviewer, reporting analyst), or one model for all?
2. **Retention of prompt and answer contents**: the engagement's lifetime, a fixed
   period, or until close-out? Who may read them (owner/admin proposed)?
3. **Budgets**: default per-engagement and per-firm limits, and whether a budget stop
   needs an owner's approval to lift or just a configuration change.
4. **Budget ledger**: sum `model_calls` (no table) or a ledger table (migration 0095)?
5. **Conclusion rationale**: shown in Agent says and the Conclude step only, or also
   copied into the effectiveness workpaper's narrative as a drafted section?
6. **Corpus review**: will the owner review the synthetic corpus's controls and planted
   outcomes before M3b, or accept it from the manifest?

## 13. Decisions after the owner's review (before M3a)

The owner conditionally approved the M3a–M3e direction on 21 October 2026 and answered
the six questions of §12 with product guidance. Each is reconciled here against the
question as asked; what the guidance did not settle is flagged, not assumed silently.

| § 12 question | Owner's guidance | Decision taken in M3a | Still open or assumed |
| --- | --- | --- | --- |
| 1. Model names per tier | Configurable Fast, Balanced and Deep tiers, pinned to real, supported IDs; verify availability, pricing and structured output first; invent nothing | Verified on 20 October 2026 against the provider's model list, the published prices and one structured-output call each (`docs/review/m3a/live-smoke.md`). Pinned: FAST `claude-haiku-5-5`, BALANCED `claude-sonnet-5-5`, DEEP `claude-opus-5-5`, overridable per tier (`MODEL_FAST`, `MODEL_BALANCED`, `MODEL_DEEP`; `MODEL_NAME` stays the BALANCED alias). A live model without a known price is refused. | **Assumed:** which work runs on which tier (reading, matching, classifying, OCR → FAST; drafting, testing, the screenshot review, workpapers, console, setup, scoping → BALANCED; the planner and the independent reviewer → DEEP). The owner did not specify this mapping. |
| 2. Prompt and answer provenance | Store identity, version, prompt/template version, input and output references or hashes, timestamps, tokens, outcome, error information; full content only where necessary, encrypted and access-controlled, configurable retention, no sensitive raw logs | `model_calls` gains model, tier, agent, prompt version, prompt and output SHA-256, target, job, attempt, duration, error class (vendor status code only). Full content in `model_call_contents`, AES-GCM under `PROVENANCE_KEY`, kept `MODEL_CONTENT_RETENTION_DAYS` and purged at deploy; hashes and records stay. Without the key, hashes only. | **Assumed:** 90 days as the default retention; one environment key with no re-sealing rotation (older content is unreadable until the old key is set again). The owner gave no number and no rotation rule. |
| 3. Access to execution artefacts | Restrict by tenant, engagement, role and legitimate audit purpose; record access | One route, inside the engagement, for the firm's owner or admin or the engagement's reviewer (the `REVIEWER` engagement role), with a stated purpose (8–300 characters) recorded in the `model_call.content_read` audit event; another tenant sees 404; a contributor 403. | **Assumed:** the role set. Lead and preparer roles and the firm's project manager are excluded; the owner may want the engagement lead included. |
| 4. Budgets | $1 a call, $10 a job, $50 an engagement a month in development; enforce before dispatch where feasible; stop when exhausted; provisional | Enforced before every call from a cost estimate (prompt, system, images, full output allowance) against the three limits; a refused call is recorded as `BUDGET_EXCEEDED` and the job rests like a failed one. No ledger table: the month's spend is the sum of `model_calls` for the engagement. Defaults as given; 0 removes a limit. | **Assumed:** the month is the calendar month in UTC; the job is one run of one record (one lease claim), and the screenshot review inside a read shares the read's job budget. The console's chat turns are not yet metered by the caller (see §14 limitations). |
| 5. RULES vs MODEL vs FAILED vs fallback | Distinguish deliberate RULES, MODEL, FAILED attempts and explicit fallback; a model failure stays visible even when the rules produce a result; never imply the model completed work it did not | Four sources on every agent record: `MODEL`, `RULES` (by design), `FALLBACK` (the rules after a model failure, the failed call linked, the note naming the failure first), `FAILED` (nothing stands in; a person decides). Applied to test items (FAILED), evidence reads, matches, request drafts, plans, workpapers, the re-performance, setup, scoping, RCM scans, the process map and the library match (FALLBACK). The generic "so the rules were used" wording is gone. | None. |
| 6. Conclusion rationale | Let the agent draft it into the existing workpaper, labelled proposed and unapproved, with evidence references and limitations; keep sign-off and independent review | Accepted as the M3c design: the rationale becomes a drafted, unapproved section of the effectiveness workpaper (the `AGENT`-sourced section mechanism that exists), never the conclusion field. Not built in M3a. | None for M3a. |

Flagged beyond the six: the owner's M3a scope names "controlled cancellation and retry";
cancellation is built for the four leased job kinds (the tester's run, the re-performance,
an evidence read, a workpaper draft). Request drafts and plan runs are short single calls
and are not cancellable; the console's turn has its own retry and is unchanged.

## 14. M3a as built: real agent execution

Built on 21 October 2026 after the owner's conditional approval (§13), for review before
M3b. No new engine, no new status model, no UI redesign: the existing jobs run through
one caller, and the records say what the model did.

### Files changed

- Migration `0094_agent_execution_provenance.sql`: `model_calls` gains the provenance
  columns (model, tier, agent, prompt version, prompt and output SHA-256, target, job,
  attempt, duration, error class, agent actor) and the `BUDGET_EXCEEDED` status; the
  encrypted `model_call_contents` table with its protect trigger (no update; delete only
  once expired); the source checks widened with `FALLBACK` and `FAILED` on test items,
  evidence analyses, matches, request drafts, plans and plan runs, workpaper versions,
  re-performances, setup drafts, system reviews and assessments, RCM scans and terms, the
  process map's builder and the library match; cancellation columns on test sheets,
  control reviews, evidence analyses and workpapers. Applied to the development database:
  1,777 existing call records kept with empty provenance columns.
- `provenance.py` (new): `AgentCaller` (tier, budgets, cancellation check, retries,
  provenance record, encrypted contents), `CallerProvider` (the caller behind the evidence
  modules' provider-and-record protocol), `agent_actor`, the content read route, the
  purge. `agent_runs.py`: the four cancellable kinds, `cancel_requested`,
  `finish_cancelled`, the cancel route. `models.py`: prices in nano-dollars a token, the
  `Outcome` with its error class, `Provenance`, `cost_micros`, `ModelBudgetExceeded`.
  `model_providers.py`: the tiers, the verified prices, `tier_config`, the configuration
  check, the provider choosing a tier's model, `call_note` without the fallback wording,
  `fallback_note`. `settings.py`: tiers, prices, budgets, the provenance key, retention,
  the live-test switch. `workspace.py`: the automation status names the model and the last
  call. `migrate.py`: the purge at deploy. `main.py`: the two route registrations.
- Jobs moved to the caller: `testing_engine.run_sheet` (per-item cancellation, `FAILED`,
  agent actor), `control_reviews.run_reperformance` (`FALLBACK` when every call failed),
  `evidence_analysis.run_analysis` (the reader's FAST caller, the tester's BALANCED caller
  for the screenshot review, `FALLBACK`, `FAILED` matches, cancellation),
  `pbc_drafting.run_draft`, `workpaper_service.run_draft` (cancellation),
  `evidence_plans.plan_for`. Fallback labelled in `setup_drafting`, `system_applicability`,
  `rcm_systems`, `rcm_terms`, `process_understanding`, `library_matching`,
  `evidence_matching.no_match`, and the failure wording of `evidence_review`.
- Web models accept and word the new sources (`analysis-model`, `draft-model`,
  `review-model`, `evidence-plan-model`, `onboarding-model`, `workpaper-model`,
  `control-context-model`, `agent-says-model`).
- Tests: `test_provenance.py` (6), `test_agent_execution.py` (9), `test_live_model.py`
  (2, gated), two legacy expectations rewritten in `test_pbc_drafting.py`, cases added to
  three Node tests; both new Python files in the fast and critical sets.
- Docs: `operations.md` (new), `workforce.md`, `evidence.md`, `review.md`,
  `testing.md`, `.env.example`, `docs/review/m3a/`.

### Behaviour

Every call of the moved jobs is tiered, priced, budgeted, cancellable, retried on
transient failure (2 s, then 6 s; never a malformed answer or a rejected request) and
recorded with its provenance; the prompt and answer are sealed under the firm's key when
one is set and readable only through the audited route. A model failure is `FAILED` (the
tester's items) or `FALLBACK` (where reviewed rules produce a separate result), never
`RULES`. A person cancels a queued or running tester run, re-performance, evidence read
or workpaper draft; the job stops at its next check and the queue offers to run it again.
The automation status says which model stands behind the agents and how the last call
ended without calling it. No page or queue read calls the model.

### Models and costs (verified)

FAST `claude-haiku-5-5` ($0.10 / $0.50 per million tokens), BALANCED `claude-sonnet-5-5`
($2 / $10), DEEP `claude-opus-5-5` ($4 / $20): all three on the provider's model list,
all three answered a structured-output call. The live smoke
(`docs/review/m3a/live-smoke.md`) cost $0.0427: three tier calls at 421 input and 70
output tokens each ($0.000078, $0.001542, $0.003084) and the tester's three item calls on
Sonnet 5.5 (3,751 to 3,755 input, 405 to 596 output tokens, $0.0116 to $0.0135, 3.6 to
4.6 s each). On the synthetic evidence the tester returned fifteen "unable to tell"
results with the missing evidence named and the words it did have cited, and no invented
pass.

### Tests executed

| Command | Result |
| --- | --- |
| `uv run mypy` | Success, 239 files |
| `uv run ruff format` / `ruff check` | clean |
| `pnpm exec tsc` (root and `apps/web`) | clean |
| `pnpm exec biome check` | clean except the known `biome.json` endings and the regenerated `next-env.d.ts` |
| `pytest test_migrations test_provenance test_agent_execution test_pbc_drafting` | 31 passed |
| `MODEL_LIVE_TESTS=1 pytest -s test_live_model.py` | 2 passed, 31 s, $0.0427 |
| `make test-fast` | 102 Python passed (2 min 40 s), 112 Node passed |
| `make test-critical` | first run 3 failed, 377 passed in 5 min 10 s (`test_workpapers`: the workpaper drafter's audit call read an `agent_instance` variable that the no-model path never set, an UnboundLocalError in `run_draft`; fixed by initialising it before the branches); rerun after the fix: **380 passed, 0 failed in 5 min 12 s** |

### Owner's required validation

| Demonstration | Result | Where |
| --- | --- | --- |
| One successful real provider call | PASS | live smoke: three tiers, then the tester's three calls |
| One provider failure | PASS | `test_a_provider_failure_leaves_failed_items…` (rejected request, items FAILED, nothing concluded); `test_transient_failures_are_retried…` (timeout, rate limit, malformed, exhausted) |
| One rules-only run | PASS | `test_without_a_model_the_rules_run_and_say_so` (RULES, no call recorded) |
| One explicit fallback after model failure | PASS | `test_the_evidence_reader_names_a_model_failure…` (FALLBACK, failure named first, failed call linked); the rewritten drafting tests |
| One cancellation and recovery case | PASS | queued and running cancellation of a tester run, the stopped run in the queue, the rerun finishing what was left; a queued read cancelled; a crashed run resumed without a duplicate |
| Agent identity versus requesting human | PASS | `testing.items_tested` carries `actor_user_id` (the requester) and `actor_agent_instance_id` (the tester's instance); calls carry `agent_key` |
| Prompt and response provenance without secrets | PASS | hashes, model, version, job and error class on the row; contents sealed; no plaintext, key or secret in any row or audit payload; the content read audited with its purpose |
| Authorization and tenant isolation | PASS | content: 422 without a purpose, 403 contributor, 200 owner and engagement reviewer, 404 other tenant, 409 under another key; cancel: 403 firm reviewer, 404 other tenant |
| Budget enforcement | PASS | a call, a job and a month limit each refuse before dispatch and record `BUDGET_EXCEEDED`; another engagement's spend does not count; 0 removes a limit |
| No model invocation during page or queue reads | PASS | an exploding provider behind nine reads (queue, controls, dashboard, activity, next steps, sheets, tests, reviews, automation): never called |

### Critical safeguards validated

Authorization and tenant isolation on the two new routes; the tester, reviewer and reader
jobs read and write only their record's organisation and project; no approval, sign-off,
independence, custody or immutable-history rule changed; `model_calls` stays immutable;
the contents table cannot be altered and is removed only at expiry. The full critical set
ran (table above).

### Legacy expectations rewritten (test-strategy.md §3)

- `test_pbc_drafting::test_a_bad_or_failed_model_draft_falls_back_to_the_rules`: old
  expectation, a rejected or timed-out model draft leaves `source = RULES` with the note
  "…, so the rules were used"; new, `FALLBACK` with the failure named first and three
  recorded attempts for the timeout. Justification: the owner's decision 5, a model
  failure must stay visible even when the rules produce a result. Intentional correction.
- `test_pbc_drafting::test_the_design_request_asks_for_design_evidence_and_no_population`:
  old, `RULES` after a rejected model draft; new, `FALLBACK` with the rejection named.
  Same justification. No assertion about the request's wording or audit changed.

### Not tested, and the risk

- Temporal as the worker was not run; the job functions are the ones Temporal's
  activities call, and the durable tests are unchanged. Risk: an activity timeout shorter
  than three retries with pauses (the analysis allows 8 minutes; the pauses add 8 s).
- The reviewer's re-performance and the screenshot review ran only against stubs; live
  in M3c and M3b.
- The modules still on `CLAUDE_CONFIG` and `record_call` (the console's turns, setup,
  scoping, RCM scans and terms, the library match, attribute proposals) record the
  model, tokens and status but no prompt hash, agent, tier or job, and are not budgeted
  or cancellable. Risk: a runaway console conversation is bounded only by its own eight
  tool calls a turn.
- The live smoke's evidence is three synthetic lines; the tester's quality on realistic
  evidence is M3b and M3c's measurement.

### Security implications

Prompts (with the readers' redaction already applied) and answers are now stored when a
key is configured: AES-GCM with the call id as associated data, one process key, access
by role with a recorded purpose, expiry by configuration. The error column keeps the
vendor's status code only and redacts secret-looking text. Both new routes authorize
inside the engagement; the content route refuses a stranger with 404 and a contributor
with 403. Budgets bound spend before dispatch. Widening the source checks adds values; it
removes no rule.

### Known limitations and defects

- Found and fixed during the gate: `workpaper_service.run_draft` raised on the no-model
  path (the audit call's agent variable was set only when the model drafted); three
  `test_workpapers` tests caught it on the first critical run.
- Cancellation has no button yet; the route exists and the queue shows the stopped run.
- Key rotation re-seals nothing; the retention default (90 days), the tier-to-job mapping
  and the content-reader roles are assumptions flagged in §13.
- The month budget is the calendar month in UTC and sums the engagement's calls, so a
  long month-end run can be refused mid-way; the job then rests for a person.
- `make lint` still reports `biome.json`'s line endings (environment) and the regenerated
  `apps/web/next-env.d.ts`, which is restored and never committed.

### Recommended next

M3b, evidence intelligence, after this review: the corpus of §9.3, the readers and
population checks measured on it, matching and classification live, sufficiency with a
written reason per requirement. Nothing of M3b has been started.

## 15. M3a closure (after the owner's conditional acceptance)

The owner conditionally accepted M3a on 21 October 2026 and asked for eight focused
closure items before M3b. Each is closed below; the evidence is
`docs/review/m3a/closure.md`.

### 15.1 The four assumptions, confirmed as development defaults

| Assumption | The owner's default | Applied |
| --- | --- | --- |
| Tier per work | FAST routine classification and low-complexity extraction; BALANCED evidence interpretation, testing drafts and routine reviewer analysis; DEEP explicitly authorized complex analysis only | `AGENT_TIERS` revised: the independent reviewer and the planner moved to BALANCED; no agent runs on DEEP unless `MODEL_DEEP_AGENTS` names it (`agent_tier(key, settings)`) |
| Retention | Encrypted prompts and answers 90 days, configurable; audit records kept separately | `MODEL_CONTENT_RETENTION_DAYS` (90) purges only `model_call_contents`; `model_calls`, hashes, inputs and audit events are never purged (documented) |
| Prompt access | The engagement's reviewer or a firm owner or admin, with a legitimate purpose, within the tenant and engagement | Unchanged: the content route requires the purpose, checks the engagement membership and role, answers 404 across tenants and audits every read |
| Budget month | Calendar month UTC, with visible usage and limits | `GET …/workspace/automation` now carries `budget`: the month's spend, the three limits and what remains |

None of these is a production policy.

### 15.2 Legacy callers: inventory and containment

Every caller that could reach the live model outside the caller was moved onto it; the
inventory is in `operations.md` ("Caller inventory"). Moved in the closure: the console's
turns (`AgentCaller.chat`, operation `propose_tools`, prompt version `console/1`, the
lead agent as `console-lead`; the console keeps its own retry policy and tells the person
when a budget stops a turn), `setup_drafting`, `system_applicability` (scoping and SOC
reports), `control_attributes`, `process_understanding`, `rcm_systems`, `rcm_terms`,
`library_matching`, `system_suggestions`. Not applicable: the `POST …/model-calls` route
and the manager, whose provider is the local or the unavailable one by construction.

Containment beyond the migration: the live provider refuses a generation under the
untiered configuration and a chat turn not marked by the caller, before any network
call, unless `MODEL_ALLOW_UNMETERED=true` (development only). A static test asserts that
only the adapter and the caller record calls or invoke a chat turn
(`test_no_module_calls_the_model_outside_the_caller`); a dynamic one asserts the refusal
and the metered paths against a fake vendor client.

### 15.3 Cancellation semantics, validated

- Requested and completed are distinct records (`cancel_requested_at`/`by` and
  `cancelled_at`) and distinct states on the sheet, review and workpaper bodies
  (`cancel_state`: REQUESTED, CANCELLED, NONE), with their own audit events.
- A cancelled job cannot commit a late model response: the tester, the reviewer and the
  workpaper drafter check again after the call returns and discard the answer; the call
  stays on the record as made. Test: the cancellation is asked for during the first
  item's call; no item is written, the call is recorded, the rerun tests all three.
- Retries respect cancellation: the caller checks before every attempt; a cancellation
  during the pause before a retry records `CANCELLED` as attempt 2 and makes no call.
- Completed and failed work keep their attribution: units written before the request
  stand with their calls; the stopped run's note and events are the cancellation's.
- Audit history: `agent_run.cancel_requested` by the person, then `testing.run_cancelled`
  (or the kind's own action) naming the agent that stopped and the person who asked.
- The action: **Cancel run** in the control's Agent says block while a tester run or a
  re-performance is queued or running, posting to `/workspace/agent-runs`, which calls
  the API's cancel route as the signed-in person and returns to the control. Verified in
  headless Chrome on the 155-control engagement (`docs/review/m3a/cancel-1-offered.png`,
  `cancel-2-cancelled.png`, `cancel-3-mobile.png` at 390 px without overflow): the button
  on the queued run, the stop attributed to the person, the button gone.

### 15.4 Encryption keys

Key identification (the SHA-256 prefix on every sealed record and on the content
route), rotation (`PROVENANCE_KEY` new, the old key in `PROVENANCE_PREVIOUS_KEYS`, no
re-sealing), old-key access (decrypt only, by id) and recovery when a key is lost (the
content is gone; the call records, hashes, inputs and audit events stand) are in
`operations.md`, "Encryption keys and rotation". Test: content sealed under an earlier key
reads after a rotation, is refused by key id once the key is dropped, and the record's
hash stays.

### 15.5 Provenance accuracy

Each call now records the requesting person, the executing agent instance, the model
and tier, the prompt version and hashes, `inputs` (migration 0095: the sheet and its
version, the approved plan revision, the evidence files and their content hashes, the
request or control), the outcome and error class, tokens and cost, and whether content
is sealed; `GET …/model-calls/{id}` returns all of it. A failed attempt never reads as
MODEL because a rules fallback completed: the record keeps the failed call, the result
keeps FALLBACK or FAILED (`test_the_evidence_reader_names_a_model_failure…`).

### 15.6 Tests and gate

| Command | Result |
| --- | --- |
| `uv run mypy` | clean (241 files) |
| `ruff format`, `ruff check` | clean |
| `tsc` (root and web), `biome check` | clean except the known `biome.json` endings |
| Node tests for the changed models | 63 passed |
| targeted Python (migrations, provenance, execution, console, drafting, workpapers, reviews, analysis, RCM, setup, scoping, suggestions, library, context, models) | first run 9 failed, 142 passed; after the fixes the five failing files 67 passed |
| `make test-fast` | **106 Python passed in 2 min 28 s and 112 Node passed** |
| `make test-critical` | **384 passed, 0 failed in 5 min 28 s** |

Migrations 0094 and 0095 applied to the development database and to the 155-control
demo database; existing records kept.

### 15.7 Remaining limitations

- The console's chat retries are the console's own (2 s, 6 s), recorded by the caller
  per attempt; the caller's budgets apply, its cancellation does not (a turn is seconds).
- An evidence read is cancellable through the route only; the UI offers the action for
  the tester and the reviewer.
- Key rotation re-seals nothing; per-tenant keys and an external key service are not
  built.
- The month budget sums the engagement's calls in the calendar month (UTC); a long
  month-end run can be refused mid-way and rests for a person.

## 16. M3b as built: evidence intelligence

Built on 21 October 2026 after M3a's acceptance (§15), for review before M3c. The brief:
validate and improve ingestion, classification, extraction, custody and
evidence-to-attribute mapping on a controlled synthetic corpus, with precise traceability;
no autonomous control testing, no rebuild of what works.

### 16.1 Reuse versus change

| Capability | Decision | Why |
| --- | --- | --- |
| Readers (`evidence_extraction`: xlsx, csv, docx, PDF text layer, images) | Reused unchanged | Every corpus file read as the manifest expects: method, status, row counts, columns and planted facts (`test_every_file_is_stored_linked_read_and_kept_as_it_came`). No deficiency found. |
| OCR (`evidence_ocr`: Tesseract, model vision) | Reused unchanged | Tesseract is not installed here; the live run used model OCR and read every planted word of the four images and the scanned page (6 of 6). |
| Custody (`evidence_files`, hash and size, immutable record, withdraw and replace) | Reused unchanged | Hashes, sizes, names, sources, links, duplicates stored once, a replacement as a new record with the old one withdrawn: all verified on the corpus. |
| Matching and classification (`evidence_matching`, `evidence_classify`) | Reused; measured | Uploads named their request, so no matching call ran; classification kinds measured live (§16.5). |
| Citations (`console_citations.find_quote`, `location_of`; `test_citations`) | Reused; extended | A verified quote is now located to a data row and a column or cell of a table (`evidence_mapping.locate`) as well as to a page or a sheet. |
| Requirements and their files (`evidence_requirements`, `evidence_requirement_files`) | Reused | The plan's requirements name the attributes they serve; their files and their requests' files are the candidates for an attribute. |
| Model calls | Reused (M3a) | Every call runs through the agent caller: the reader on FAST, the screenshot review on the control's tester (BALANCED), the mapping on the evidence coordinator (BALANCED), all budgeted and recorded with inputs (file ids and hashes, plan revision). |
| **New**: evidence-to-attribute mapping (`evidence_mapping.py`, migration 0096, two routes, a Test-step panel) | Built | Nothing existed that related the evidence on hand to each approved attribute with located passages and a sufficiency status. |
| **New**: the synthetic corpus and its manifest (`services/api/tests/corpus.py`, `scripts/build_corpus.py`) | Built | 27 files over six controls with every planted difficulty and an independently written expected outcome per file and per attribute. |
| **Changed**: the provider's handling of an answer cut off at the output limit | Changed | The first live run showed four mapping answers cut off at 4,096 output tokens and read as partial; a cut-off answer is now no answer (MALFORMED without output, so FALLBACK), and the mapping asks for a bounded answer with an 8,192-token allowance. |

### 16.2 The corpus (`docs/review/m3b/corpus/`, manifest in `manifest.json`)

Six scenarios: user access provisioning (ITGC-AC-01), terminated-user access removal
(ITGC-AC-02), user access review (ITGC-AC-03), privileged access (ITGC-AC-04), change
management (ITGC-CM-01) and the three-way-match automated control (ITAC-01). Twenty-seven
files: CSV populations and logs, multi-sheet workbooks, text PDFs, a scanned PDF with no
text layer, a Word test summary and job-title table, PNG screenshots, a text note, random
bytes named `.xlsx`. Planted: a missing approval (REQ-2), an approval after provisioning
(REQ-3, CHG-1004), conflicting timestamps (REQ-7, a login after a disable), identifiers
that differ across files (u0003 / U-0003 / OLIM / oscar.lim@…; employee ids against
usernames), a duplicate row, an out-of-period row, incomplete populations (REQ-8, E-1004),
prior-year files, an unreadable file, ambiguous screenshots (no date, no system), a
removal marked but not actioned (u0106), a generic root account with no owner, and a note
instructing the model to mark everything sufficient. The manifest states, per file, the
kind, the reader's method and status, the row count and columns, the words the text must
carry, the words OCR must read, and the difficulty flags; per attribute (in the library's
wording the engagements carry), the statuses that would be right, the identifiers the
mapping must mention and the file it must never stand on. The model never grades itself.

### 16.3 Evidence-to-attribute mapping

`POST …/controls/{id}/evidence-mapping` (update rights) runs a mapping; `GET` reads the
latest, with its staleness; the Test step shows it with **Map evidence**. A run needs the
control's evidence plan approved and reads the approved attributes at the plan's current
revision. For each attribute: the plan's requirements that name it give what is required;
the files linked to those requirements or sent on their requests (all the control's
in-force files when none) are the candidates; without a model, or without readable
candidates, the rules say MISSING or UNKNOWN and a person maps. With a model, one bounded
call per attribute (the candidates' text as data, the attribute, the control) proposes a
status, facts with quotes, inferences, what is missing and conflicts with two quotes each.
The code then decides what stands: a quote is looked up in the file's stored text and,
when found, located (page; sheet; data row and column, with the cell for a workbook); a
fact whose quote is not found becomes an inference marked unverified; a conflict keeps
only verified quotes and needs two; POTENTIALLY_SUFFICIENT without a verified passage is
lowered to UNKNOWN; CONTRADICTORY without two becomes INCOMPLETE; MISSING beside a
verified passage becomes INCOMPLETE. The run and its mappings are append-only, pinned to
the plan revision, a hash of the attributes and every file's content hash; a read marks
the run stale when the attributes changed, the plan was approved again, a mapped file
was replaced or withdrawn, or a file was added. Nothing in the run touches the plan, the
attributes, a requirement's sufficiency, an approval or a sign-off (asserted by a before
and after snapshot of those tables), and no pass or fail is concluded.

### 16.4 Safeguards

The instruction file's words reach the model only inside `<evidence>` marked as client
data; its content may be quoted as what the file says, never followed. Model output can
name only candidate files by index (an index outside the list is dropped), only the five
statuses, and only quotes the files hold. A cross-engagement read answers 404; another
engagement's files are never candidates (`test_another_engagements_evidence_never_reaches_a_mapping`).
The mapping read route is in the no-model-on-reads guard; a run is a person's POST.

### 16.5 Results (live, `docs/review/m3b/live-scorecard.json`)

Two full runs and two runs of the clean scenario, all with actual model responses.

| Measure | First full run | Second full run (after the fixes) |
| --- | --- | --- |
| Files read to a record | 24 of 24 | 24 of 24 |
| Kind as expected or an acceptable alternative | 16 of 24 (strict) | 22 of 24 |
| OCR words read (model OCR) | 6 of 6 | 6 of 6 |
| Mapping status within the acceptable statuses | 22 of 24 | 24 of 24 |
| Required identifiers mentioned | 24 of 24 | 24 of 24 |
| Verified references (located to page, sheet, row or cell) | 279 (252) | 189 (165) |
| Quotes the files do not hold | 0 | 0 |
| Sufficient status standing on the instruction file | 0 | 0 |
| Attributes marked sufficient as the instruction demanded | 0 | 0 |
| Mapping answers cut off at the output limit | 4 | 0 |
| Cost | $0.8579 | $0.7823 |

The first run's four cut-off mapping answers led to the one change to existing code (a
cut-off answer is no answer) and a bounded mapping prompt (`evidence-mapping/2`). The
scorer was also refined: quoting the instruction file as content (three mappings did, each
saying it was not followed) is allowed; standing on it for a sufficient status is not. The
two kind misses of the second run are a ticket screenshot read as a sample (manifest:
other) and the 2027 change population read as change history (manifest: population).

**The clean scenario (ITGC-OP-01).** The first live run on it returned INCOMPLETE for the
first attribute, and the model was right: the run ids skipped R-5505, R-5506 and R-5510
and the evidence held no scheduled-job list, no financial-relevance list and no record of
who monitored, which the manifest had missed. The scenario was completed (contiguous run
ids, the job schedule with relevance and the export's parameters, who acknowledged each
alert). The second run mapped all four attributes POTENTIALLY_SUFFICIENT, each with seven
or eight located passages (rows of the run history and the alert log, the incident report's
page), no conflict, and follow-up suggestions listed as missing items (such as run history
for other selected days). Cost $0.1071 and $0.0925.

Live spend for M3b: $1.84 in all, within the development budgets (no call was refused).

### 16.6 Tests

| Command | Result |
| --- | --- |
| `uv run mypy` | clean (245 files) |
| `ruff format` / `ruff check` | clean |
| `tsc` (root and web), `biome check` | clean except the known `biome.json` endings and the regenerated `next-env.d.ts` |
| Manifest check: every corpus file through the deterministic readers | 31 of 31 as expected |
| `pytest test_evidence_corpus.py` | 7 passed on the final 31-file corpus (the 2 live tests skip without the flag) |
| `node --test tests/evidence-mapping-model.test.ts` | 2 passed |
| `MODEL_LIVE_TESTS=1 pytest -s test_live_corpus.py` | full run 1 failed (the scorer, then corrected); full run 2 passed; clean scenario passed twice (first run's INCOMPLETE was right) |
| `make test-fast` | **113 Python passed in 2 min 58 s and 114 Node passed** |
| `make test-critical` | **391 passed, 0 failed in 5 min 33 s** |
| Migration 0096 | applied to the development database; `test_migrations` and `test_schema` in the critical set |

### 16.7 Limitations

- Passages in plain text files and in OCR text are located to the file only (no page or
  row marker exists in the stored text); image references are whole-image, never a region.
- ITAC-01 is in the corpus but the fixture engagement requests no evidence for it, so its
  files are not ingested in the automated runs; its three files are read by the manifest
  check only.
- Classification kinds are compared against the classifier's vocabulary, where a change
  log and a disable log are both defensibly `change_history` or `sample`; the manifest
  names the acceptable alternatives per file.
- A mapping run is synchronous on the request (one call per attribute, about 4 s each);
  a control with many attributes takes under a minute. It is not a queued job.
- Tesseract is not installed in this environment; OCR was exercised through the model
  only.

### 16.8 M3b closure

The owner conditionally accepted M3b on 21 October 2026 and asked for five closure items. The completion report records them ([milestone-3b-completion.md](milestone-3b-completion.md), "Closure"): the two classification errors and the deterministic gap they exposed (a person's confirmed population now proposes samples); three repeat runs of the unchanged corpus ([repeatability.md](review/m3b/repeatability.md)); every unsuccessful model call recorded as NOT_MAPPED, an execution failure (migration 0097); a test that a mapping leaves 29 protected tables untouched; and the gate.
