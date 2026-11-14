# Testing strategy: risk-based and tiered

Decided by the product owner on 19 October 2026, replacing the full Python regression
suite as the gate for every milestone, and revised by the owner on 21 October 2026 into
three tiers with risk-based escalation. The objective: audit-grade quality without running
the whole suite for every change. Nothing here weakens authorization, segregation of
duties, approval gates or audit traceability; those tests are the ones that always run.

## 1. The tiers

### Tier 1: routine development

For an ordinary code change:

1. Formatting, linting and type checking for the modified code (`make format`, `make
   lint`, `make typecheck`).
2. The targeted tests for the modified components and the code that depends on them:
   the tests of the changed files and their callers, chosen by hand or with `make
   test-changed` (`make test-changed BASE=HEAD` selects only from the uncommitted and
   untracked changes; `scripts/changed_tests.py --list` prints the selection without
   running it).
3. `make test-fast` once a feature change is complete.

Decided by the owner on 23 October 2026, for active development:

- After each meaningful change, run only the tests above plus the critical safeguard tests
  the change could affect (approval enforcement, plan applicability, evidence
  traceability, authorization and permissions, testing gates, approval history). Run the
  relevant critical files, not the whole critical tier, and never skip one the change
  could affect.
- For a significant UI change, also check rendering, navigation, preserved form and filter
  state, loading and error states, layouts at 390 px and 1440 px, keyboard use, motion
  (and reduced motion), no unnecessary page reload, and that the page agrees with the
  server after the action (the UI acceptance checklist in `docs/design-system.md`).
- Do not run the full suite automatically after a step; it belongs to Tier 3, migration
  validation, final verification before a merge or release, or the owner's request.
- After each step report: the tests executed, passed and failed counts, execution time,
  the tests deliberately deferred, and the risks not yet verified. Never describe targeted
  runs as regression testing of the application. Before asking to commit, merge, or
  release, list the outstanding full-regression requirements.
- On machines where application control blocks `pytest.exe` (the `make test-*` targets
  fail at once), run the same selection with `python -m pytest`, checking first that every
  named file exists: a missing path collects nothing and exits 0.

### Tier 2: milestone closure

Before a milestone is committed:

1. Everything in Tier 1 for the milestone's changes.
2. The relevant targeted and integration tests for the affected workflows, named in the
   milestone report.
3. `make test-fast`.
4. `make test-critical`: authorization, segregation of duties, approvals, evidence
   traceability, review independence, database integrity, model-execution safeguards.
5. The milestone's own acceptance and safeguard tests (and its gated live tests where
   the milestone measures a model).
6. Migration validation whenever the database changes: `test_migrations` and
   `test_schema` (in the critical set), the migration applied to the development
   database, and the schema and record-preservation checks reported.

The full legacy suite is not required at every milestone.

### Tier 3: major milestone or release

`make test-full` and every applicable integration, security and regression test:

- at the completion of a major milestone group (for example, all of M3);
- before a production release;
- after a significant architectural or shared-infrastructure change (the database layer,
  the agent caller, authentication, the worker, the migration runner);
- when targeted or critical tests suggest a wider regression risk.

### Risk-based escalation, within any tier

A change that touches model-execution safeguards, authentication, authorization, data
integrity, migrations, approval boundaries, sampling, audit conclusions or shared
infrastructure widens its tests: the selection must cover the affected dependencies and
the critical invariants they hold (for example, a change to the agent caller runs every
test that asserts a model failure is recorded as FAILED or FALLBACK, not only the
caller's own tests). A high-risk change does not by itself require the whole suite; the
milestone report says why the selection is enough, or escalates to Tier 3.

## 2. Commands

| Command | What it runs | Typical time |
|---|---|---|
| `make test-fast` | `FAST_PY` Python files and `FAST_NODE` Node files; defaults are the workflow-integrity set | 2–4 min |
| `make test-critical` | The CRITICAL files of §4 and the single safeguard tests of §6 (`CRITICAL_PICKED`), in parallel on six workers, then the Node safeguard tests (`CRITICAL_NODE`) | ≈ 6 min |
| `make test-changed [BASE=<ref>]` | `scripts/changed_tests.py`: tests that import or name the changed modules, migration tests when `migrations/` changed, Node tests importing changed web files; one level deep, so it complements `test-critical` rather than replacing it | depends |
| `make test` | `test-critical` then the Node smoke test (what `make ci` runs) | |
| Pre-launch hardening (Step 7) | `test_registration_hardening.py` (throttles, duplicate trials, concurrent registration), `test_storage_cleanup.py` (refused uploads, orphan sweep, the development store's guard), `test_archived_guard.py` (archived engagements read-only, active and completed unchanged, the demo reset), `test_trial_hardening.py` (abandoned runs, the quiet window, storage allowance) and `test_demo_reset.py` are in `CRITICAL_PY` | part of `make test-critical` |
| D&I evidence traceable to the attributes (12 November 2026) | `test_design_traceability.py` (the planner proposes which approved attributes every D&I request addresses, for every kind of control, by the rules and by an agent that names none, on a carrier fixed per kind, as a proposal that never changes an accepted request's links, never for an excepted attribute, and ignoring one that is not approved; the design item that shows the control performed once is linked to every approved attribute whoever planned it, and to an attribute accepted later after the re-plan; a plan whose D&I items leave an approved attribute unaddressed is not released; since the D&I requests list of the same day the hold is per attribute and there is no early release, so it is refused whatever the reason). In `CRITICAL_PY`. `test_attributes_follow_understanding.py` (the attributes follow the understanding; no duplicate attribute on any path; one acceptance; queued work handed to the worker after the commit) is in `FAST_PY`. |
| The D&I requests list (12 November 2026, B1f) | `test_design_requests.py`: approval boundary and evidence traceability (a D&I request is a person's only once accepted, all or none at the versions seen, a reviewer refused; a person's add, edit, links or restore accepts as that person; the planner never overwrites an accepted request and its addition stays proposed until accepted; every approved attribute is addressed by a request or excepted with a reason; the D&I evidence is released by the request that completes the list, as that person, with the audit record of what was released and the drafts handed over after the commit; whatever event finds the list settled releases it for the person of its last decision, with the trigger on the record, and never for someone who may no longer accept; a links change held to the request's version and to the planner; exceptions withdrawn once a request addresses their attribute; bounded working and drafting; one lock order; the release and its requests in one step; acceptance not surviving a removal; one test through the routes alone from a fresh launch; no early D&I release; migrations 0149 and 0150, the backfill and constraints). In `CRITICAL_PY`. `test_design_release.py`, `test_design_traceability.py`, `test_planning_gate.py` and `test_master_plans.py` hold the expectations rewritten for it, each with the old one noted. | part of `make test-critical` |
| D&I requests after the release (12 November 2026, B1g) | `test_design_evidence.py`: approval boundary and evidence traceability (evidence in hand for one item of an unsent D&I request leaves the others to be asked in a wording without it, and each file stays the evidence of its item; every item in hand sends nothing; an approval of an earlier wording never sends, nor hands over, the new one; with email off an approval records the hand-over with the person as the actor and nothing reads as sent, alone or as one email to one person; with a mailbox on the delivery is the email; a request added after the release needs approval; no rewording once approved or sent; a reviewer refused, another firm sees nothing; the interim phase unchanged; and, after the independent review: a request whose email may be with the owner is never split, a hand-over is held to everything a send is, it never ends without a record with the actor (the database refuses one that does), no item is stranded by a split, a send settles evidence in hand as an approval does, a split split again, a file read while the request is approved) is in `CRITICAL_PY` | part of `make test-critical` |
| The evidence assurance chain (12 November 2026, docs/evidence-assurance.md) | `test_evidence_assurance.py`: model-execution safeguard, evidence traceability and audit conclusions, with scripted model answers (the gate holds a file or the whole run before any model call; a quote the named file does not hold never supports, an unverified MET never stands, a contradiction needs two passages, an absence is never told from files read in part or from a request with a file left out; the files of one request are read together; every row of the comparison table, SUPPORTED only on an agreed MET with a verified passage; the reviewer's request carries nothing of the assessor's answer; nothing of a run is visible before it finishes; an ISSUE becomes a finding once and UNSETTLED never; the reader's findings are held for a covered file while the deterministic checks stay; a changed file, attribute or link marks the run out of date and queues a new one, the same basis never run twice; instructions in a file change no result; a budget that cannot cover both readings starts neither; a model failure is a failed check, never a guess; an answer sent one level too deep is read as written, and a reading cut off at its allowance (the stop reason, or JSON text that ends part way) is asked once more with a larger one as its own recorded call, cut off again failing the check, while a whole answer of the wrong shape is never asked again (13 November 2026); prompts /5 tell both readings the quote rule the strict match applies and the placeholder, shortfall-attribution and designation rules, a NOT_MET resting only on a placeholder is no deviation where a reading relies on another document of the request, and NOT_MET against PARTLY_MET on a linked attribute is an ISSUE met in part with both views, rule 5 first, and on an unlinked one is shown for reference; a quote over two lines is read line by line for assertion markers (13 November 2026); another firm gets 404 and a reviewer cannot rerun) is in `FAST_PY` and `CRITICAL_PY`. | |
| The planner's answer read as written; a failed run never makes a plan worse (12 November 2026, B1h) | `test_planner_reliability.py`: model-execution safeguard and approval boundary (the two answer shapes the real model returned, by a fake provider; the schema sent agrees with the model that validates it; a rejected or failed answer leaves a standing plan byte for byte, over the agent's plan and over accepted, requested, released D&I requests; the fallback still plans a control with no usable plan; "Run again" with nothing changed calls no agent and `force` runs them; `attributes_rerun_useful` from what the agents read; a kept replan is not queued again on every save; a control change the planner could not plan for holds the operating gates; duplicate keys, optional properties, deep nesting and NaN are never read from text, and the call's hash is of what the provider returned). In `CRITICAL_PY`. |
| Every agent's answer read as its schema declares it; no agent fails silently (13 November 2026, B1i) | `test_agent_answers.py`: model-execution safeguard (every agent that calls a model enumerated from the code, so a new one is covered the day it is written: none turns the shared reading off and none calls a provider directly; each agent's own schema fed the shapes seen in the wild: JSON text at the top level and deep, a wrapper, a missing required part, prose where an object belongs, read exactly or failed with the place recorded, never a guessed value; null left out only for an optional object; a quote held only word for word; end to end on the Attributes step: what can be read is used, a quote the records do not hold is never kept, a failing part is corrected once, and an answer that still cannot be used is said in plain words in `attributes_agent_notes` until a later answer is used). In `FAST_PY` and `CRITICAL_PY`. |
| Evidence findings (Evidence Intelligence Workspace, increment 2) | `test_evidence_findings.py` (a follow-up is refused until a person accepts it and never carries links or credential requests; a reply or a later file proposes ANSWERED and never closes; a plan approved again marks findings stale; another firm gets 404 and a reviewer cannot decide) is in `CRITICAL_PY`; `tests/evidence-intelligence-model.test.ts` and `tests/evidence-findings-model.test.ts` in `FAST_NODE` | part of `make test-critical` and `make test-fast` |
| Evidence Intelligence Workspace, UI acceptance | Playwright (`playwright-core`, a root development dependency, on the installed Chrome) drives the review stack at 1440×900 and 1366×768 in both themes, measures horizontal overflow, clipped text and panel heights, and captures docs/review/evidence-workspace; the script lives in the session scratchpad, not the repository | on request, before a UI milestone closes |
| OCR page numbering (Evidence Intelligence Workspace, increment 3A) | `test_evidence_reading.py` (a PDF mixing text and scanned pages labels each OCR'd page with its real page, in page order; a blank page shifts nothing; images without page numbers keep the old order), in `make test-fast`; `test_evidence_findings.py::test_a_finding_on_a_scanned_page_cites_the_real_page` in the critical tier; checked live on the review stack with model OCR (docs/review/evidence-workspace/3a-*.png) | seconds |
| The evidence dialog (31 October 2026) | `test_evidence_dialog.py` in the critical tier (a population read as a page of rows with search and bounds, another firm refused; a chosen sample size audited beside the plan's and refused outside 1 to 200; samples still wait for an accepted population; a walkthrough instance picked for a design item only, superseded and kept, never edited or deleted, refused to a reviewer; the reader's reason cut at a sentence) and `tests/evidence-dialog-model.test.ts` in `make test-fast` (steps, suggestions by phase and type, sizes, checked writes, parsers); Playwright on the review stack: the design flow end to end with the live reader, review mode on a population and on a PDF with findings, at 1440, 1366 and 390, light and dark | about a minute, plus one live read |
| Withdrawing a file (31 October 2026) | `test_evidence_workspace.py::test_withdrawing_one_items_file_steps_the_request_back` (received, partly received after one item's file goes, back to sent when none is left, received again on restore; each step-down audited as `pbc.receipt_undone`) and `::test_a_file_no_one_relied_on_can_be_withdrawn` (only reliance on the file keeps it: an item accepted with it, or a prepared workpaper citing it; a file added after the workpaper was prepared, or to an item after it was accepted, can be withdrawn) and `tests/evidence-change-model.test.ts` in `make test-fast` (the route answers in place only when asked; the control page's withdraw form shows a refusal in place); Playwright on the review stack: a refused withdrawal shows its reason in the form, a withdrawal is confirmed on the item and in the dialog, with no page reload | about half a minute |
| Evidence item cards (31 October 2026) | `test_evidence_workspace.py::test_an_item_without_its_own_file_cannot_be_accepted` (refused with no file of its own; accepted with one; a decision reopened with why) and `::test_unlinking_an_items_only_file_steps_the_request_back` (received, then partly received and the item awaited again after its only linked file is unlinked; audited) and `tests/evidence-workspace-model.test.ts` (the file card's upload date, size, and link or share line); Playwright on the review stack: a file with the reader's pill and an empty item, several files on an accepted item, the findings opened, the file, item and add menus, at 1440 light and dark and 390 | about half a minute |
| Phase waits for complete items (31 October 2026) | `test_evidence_workspace.py::test_a_phase_waits_until_each_item_is_complete` (a received request with items covered only in part stays at Request with the count of items not complete; one accepted and one covered in full moves it to Test; an item marked not applicable, once the revised plan is approved, no longer holds it) | about 15 seconds |
| Sample of one traced (31 October 2026) | `test_sample_traces.py` in `make test-critical` (identifiers, dates in PDFs with private glyphs, business days and the stated limit; the ticket names the sample and every file is traced; a surname alone never picks it; two tickets for two leavers ask which; a memo naming no one is not a point, another leaver's ticket is; through the API, a person confirms only the row proposed now, the observations become TRACE findings, a later pick leaves them stale, a reviewer reads but confirms nothing, another firm sees nothing; ticket text is never an instruction) and `tests/sample-trace-model.test.ts` in `make test-fast`; migration 0139 in `test_migrations.py`; Playwright on the review stack: the proposal, confirming it, and the listing picker, at 1440, 1366 and 390, light and dark | about half a minute |
| `make test-demo` | The demo's release gate (Step 6): the Northstar dataset, lifecycle and closure suites, the guided tour, the demo reset, the demo record and the subscriptions, with the demo's Node model tests; the Northstar fixture builds once per run | ≈ 12 min serial |
| `make test-full` | The entire Python suite (873 tests and 6 gated live tests in October 2026) with `-rsw` for skips and warnings | ≈ 60 min serial; ≈ 13 min on six workers, when nothing else holds database connections |

Mechanics that keep the tests trustworthy and fast: every Python test still gets its own
database, now cloned from a per-session template that `apply_migrations` built once
(`tests/conftest.py`), and files run in parallel with `pytest-xdist` (one file per
worker). `test_migrations` keeps applying the migrations itself on an empty database.
Since 11 November 2026 the files that kept their own `migrated` fixture (test_access,
test_auth, test_authorization and 22 others) clone the template too, instead of running
every migration for each test. Each worker's database names carry an owner token, and the
worker keeps one connection open under that token (its application_name) for the session,
so the next run drops the databases of a run that was killed before its teardown, and never
touches a live run's. Template builds are serialized by an advisory lock: eight or more
at once (a run's workers, or two runs together) exhausted PostgreSQL's shared lock table
("out of shared memory") and errored every test of those workers. A Temporal
time-skipping test server that
does not start within sdk-core's fixed five seconds (a loaded machine) is started again,
up to four times; the harness itself is tested in `test_test_infrastructure.py`
(critical tier). Under parallel load a test's time is mostly PostgreSQL round trips
through Docker (thousands of queries and over a hundred new connections per test);
another run on the same database server, such as `make test-demo`, can make a tier
several times slower, so time a tier only when nothing else is running.

Until the current branch is committed, `make test-changed` compares against `main` and
selects almost everything; commit at each milestone so the selection is meaningful, or
pass `BASE=<commit>`.

## 3. Rules for tests that fail or look obsolete

- A failing test is never classified as obsolete by default. For each failure the report
  states the original expectation, the new expected behaviour, the methodology
  justification, and whether the change is an intentional correction or a regression.
- A test whose expectation encodes a superseded workflow is **rewritten** to validate the
  approved behaviour, keeping its audit-integrity assertions.
- A test is **retired** only when the functionality it covers has genuinely been removed
  (an API or rule that no longer exists), not because a page moved or a label changed.

## 4. Classification of the Python suite (100 files, 749 tests)

CRITICAL files run on every milestone (`make test-critical`). CURRENT files are valid for
retained functionality and run when their area changes. UPDATE files hold expectations
the approved workflow supersedes; each is rewritten in the milestone that changes the
behaviour. No file is RETIRE today: nothing covered has been removed yet (the navigation
consolidation in Milestone 3 may retire page-level tests, never the API or rule tests
behind them).

| File | Class | Why |
|---|---|---|
| test_access, test_auth, test_authorization, test_google | CRITICAL | Sessions, tenants, membership, sign-in |
| test_actions, test_agents, test_policy, test_security, test_execution, test_approvals | CRITICAL | Registered actions only, policy fails closed, approvals bound to parameters, no bypass, no duplicate side effects |
| test_schema, test_migrations, test_engagement_integrity, test_durable, test_failures | CRITICAL | Database constraints, contiguous migrations, idempotency, workflow integrity |
| test_independence, test_control_reviews, test_round_reviews | CRITICAL | Review independence and coverage (W2) |
| test_planning_gate, test_master_plans, test_phase_release | CRITICAL | Nothing requested or tested without a person's approval; release gates |
| test_evidence, test_evidence_versions, test_evidence_flow, test_evidence_review, test_evidence_portal | CRITICAL | Evidence custody, versions, tenant separation, sign-off, secure links |
| test_test_citations, test_console_citations, test_testing_engine, test_workpapers | CRITICAL | Results trace to evidence; sign-off and conclusion rules; workpaper versions |
| test_control_journey, test_workspace, test_test_rounds | CRITICAL | Canonical state and finality (W1), rounds |
| test_outbound, test_smtp_mailbox, test_mailbox, test_health, test_inbound, test_handoffs | CRITICAL | Nothing sent without approval or outside the allowlist; live email off by default; mail is untrusted data; results cannot invent approvals |
| test_projects, test_tasks, test_workflows, test_invitations, test_demo_requests | CRITICAL | Role limits on writes; invitation and public-form abuse checks |
| test_control_activity | UPDATE → done (W1) | Expected CONCLUDED on a signed review with no testing; now expects the opinion with `final` false and the reasons |
| test_control_reviews (one test) | UPDATE → done (W1) | Expected CONCLUDED with D&I outstanding; now prepares the design workpaper before sign-off, then expects CONCLUDED |
| test_test_rounds (retest) | UPDATE (W2) | Expects REMEDIATED at round sign-off; the approved rule remediates at the round review's sign-off, retest passed |
| test_waiting, test_next_steps, test_console | UPDATE (M2–M3) | One queue and the companion replace the console page and dashboard card as destinations; API assertions stay |
| test_reports, test_engagement_data | CURRENT (verify at W3) | "Complete" now follows `final`; impact-pending wording arrives with W3 |
| test_control_progress, test_controls_batch, test_scope_changes, test_waiting | CURRENT | Register behaviour retained |
| test_onboarding, test_setup_drafting, test_engagement_profile, test_engagement_details, test_engagement_close, test_clients, test_preview, test_template_pinning, test_workpaper_templates | CURRENT (M4 revisits onboarding steps; readiness checks stay) | |
| test_rcm_import, test_rcm_systems, test_rcm_terms, test_rcm_uploads, test_system_scoping, test_system_applicability, test_system_suggestions, test_business_processes, test_manual_controls, test_control_statements, test_control_context, test_slot_options | CURRENT | Scope and library behaviour retained |
| test_library_governance, test_library_matching, test_testing_definitions | CURRENT | Standard library |
| test_evidence_planning, test_evidence_plans, test_evidence_center, test_evidence_intake, test_evidence_analysis, test_evidence_reading, test_evidence_workspace, test_request_details, test_request_quality, test_request_wording, test_pbc, test_pbc_drafting, test_pbc_scenarios, test_followups, test_portal_workspace, test_sampling, test_plan_grounding | CURRENT | Evidence and planning behaviour retained |
| test_console, test_manager, test_models, test_workforce, test_tasks | CURRENT | Agents and runs |

Node tests (`tests/*.test.ts`, 667) are unit tests of the web models; they run in
`test-fast` by area and in full in under a minute when the web changes broadly.
Candidates for UPDATE at Milestone 3: `shell-model` (default section and nav), `console-model`
and `workflow-model` (queue sources).

## 5. Record

- 19 October 2026, 19:07: the full Python suite started after migration 0089 and the API
  restart (W1) was **cancelled at the owner's direction at 19:27**, not passed. The
  previous full run (Home work, before Milestone 0 and W1) passed 770 of 770 in 59 min.
  W1's targeted batch passed 90 of 92 before the two documented corrections, then 18 of 18
  on rerun (`test_control_journey`, the two corrected tests).
- The strategy, the template database, `pytest-xdist` and the three commands were
  introduced the same evening. First runs under it (W2): the targeted set, 55 passed in
  90 s on six workers; `make test-critical`, **334 passed, 0 failed, 0 skipped, 0
  warnings in 4 min 3 s** on six workers. An earlier attempt with `-n auto` (16 workers)
  exhausted PostgreSQL's 100 connections (147 fixture errors in 100 s), so the default is
  six workers.
- W3: targeted set (impact, round reviews, journey, reviews, rounds, workspace, migrations,
  master plans, activity) 77 passed after one recommendation refinement; `make
  test-critical` with `test_plan_impact` added: **342 passed, 0 failed, 0 skipped, 0
  warnings in 4 min 13 s**.
- W4 (with the W3 follow-ups): targeted set 76 passed; `make test-critical` with
  `test_round_readiness` added: **348 passed, 0 failed, 0 skipped, 0 warnings in 5 min**.
- M1b (19 October 2026): `make test-fast` **80 Python passed in 2 min 1 s and 102 Node
  passed**; the whole Node set 685 passed; `make test-critical` **351 passed, 0 failed in
  4 min 31 s** after the last code change. One legacy expectation rewritten
  (`test_overlapping_phases…`: the next step for a roll-forward round in testing reads
  "Finish the roll-forward testing and sign it off", an action, instead of the status
  "Roll-forward testing in progress"; the step and stage it asserted are unchanged).
- M1b browser smoke tests (owner's condition): the impact decision and the coverage
  assessment driven end to end in headless Chrome against the demo database; recorded in
  `docs/review/README.md`. Commit 4e1987f.
- M1c (web only, no API change): `make test-fast` **80 Python passed in 2 min 3 s and 102
  Node passed**; the whole Node set **697 passed** (two new files: `agent-says-model`,
  `trace-model`); type checks clean; lint clean except the known `biome.json` line
  endings. The critical set was not rerun: no Python, migration or route changed.
- M1d (`workspace.py` changed: whose-step rule, assignees, the automation route):
  `make test-critical` **351 passed, 0 failed in 4 min 45 s**; `make test-fast` **82
  Python passed in 2 min 9 s and 102 Node passed**; the whole Node set **701 passed**;
  type checks clean; lint clean except the known `biome.json` line endings. Expectations
  rewritten for the new meanings, each with its with-worker and without-worker pair:
  the sheet headline ("The tester is testing" → "Run queued · automation unavailable"
  without a worker), the register's `AGENT_TESTING` detail, the classic lanes (the test
  builder now states a configured worker, and one case states none), and the
  whose-step test ("a preparer's step is anyone's who can work on tasks" → an engagement
  lead's or preparer's, or the assignee's).
- Acceptance follow-ups (20 October 2026; migration 0093, `test_rounds.py`,
  `round_readiness.py`, `testing_engine.py`, the worker loops): `test_round_basis.py` added
  to the fast and critical sets. `make test-critical` **355 passed, 0 failed in 4 min
  40 s**; `make test-fast` **86 Python passed in 2 min 15 s and 103 Node passed**; the
  whole Node set **703 passed**; type checks clean; lint clean except the known
  `biome.json` line endings. The acceptance walkthrough itself ran the twelve stages
  through the API on an isolated database (docs/acceptance-walkthrough.md).
- M2a (the engagement's one queue; `queue.py`, the console inbox built from it;
  `test_queue.py` added to the fast and critical sets): `make test-critical` **358 passed,
  0 failed in 4 min 45 s**; `make test-fast` **87 Python passed in 2 min 4 s and 108 Node
  passed**; the whole Node set **706 passed**; type checks clean; lint clean except the
  known `biome.json` line endings. Expectations rewritten for the one queue: the inbox
  lists one item per drafted request instead of a count (`test_evidence_flow`, two
  assertions); the client-side `attentionQueue` tests retired with the function, their
  cases now covered by `test_queue.py` and `queue-model.test.ts`; the register's action
  center tests rewritten for `actionCenterFromQueue`.
- M2b (queue completeness, four buckets, the Testing destination; `queue.py`, `console.py`,
  `test_queue.py` grown to six tests, `testing-hub-model.test.ts` added to the fast set):
  `make test-critical` **362 passed, 0 failed in 4 min 57 s**; `make test-fast` **87 Python
  passed in 2 min 8 s and 112 Node passed**; the whole Node set **711 passed**; type checks
  clean (one pre-existing mypy error in `test_round_basis.py`, helpers imported from a
  module that re-exported them implicitly, fixed by importing from the defining modules);
  lint clean except the known `biome.json` line endings. One legacy expectation rewritten
  (`test_waiting`: the console inbox lists, beside its own engagement-wide "past due"
  count, the one queue's per-control step "Chase the overdue evidence request" under the
  inbox's `late` kind; the open-results assertion is unchanged). That test had been failing
  since M2a without being run: it is in the UPDATE class, not the fast or critical sets.
  The inbox-related UPDATE and CURRENT files (`test_console`, `test_evidence_flow`,
  `test_waiting`, `test_next_steps`, `test_evidence_review`, `test_workspace`) ran once:
  58 passed after the rewrite.
- M2c (the six destinations; the M2b conditions: Results phase, semantic deduplication,
  phone cards, the 403-control baseline): `make test-critical` **363 passed, 0 failed in
  4 min 51 s** on the final code (`test_queue.py` grown to seven tests, with the
  obligation-class rule); `make test-fast` **87 Python passed in 2 min 5 s and 112 Node
  passed**; the whole Node set **714 passed** (`shell-model` gains the route and redirect
  cases, `testing-hub-model` the Results phase regression); the ten moved addresses
  answered 307 live from the edge proxy with their record kept
  (`docs/review/m2c/redirects.md`); type checks clean; lint clean except the known
  `biome.json` line endings. No legacy expectation changed.
- M2d (the guided workspace as the one control interface; `queue.py` overdue source,
  `console.py` legacy derivation deleted, `next_steps.py` links): `make test-critical`
  **363 passed, 0 failed in 4 min 59 s**; `make test-fast` **87 Python passed in 2 min
  10 s and 112 Node passed**; the whole Node set **714 passed**; type checks clean; lint
  clean except the known `biome.json` line endings. Expectations rewritten: `test_waiting`
  (the inbox is the queue's list, so the open-results step is titled as the register words
  it with the control in its own field, and each overdue request is one `late` item from the
  queue instead of the console's own count); `test_next_steps` (the plans link names
  Testing); Node `directory`, `library-model`, `planning-model` (addresses name the
  destinations: `settings&view=tasks`, `settings&view=library`, `testing`). Nothing retired.
- Milestone 2 closure (`request_details.draft_blockers`, `request_quality` batched reads,
  `evidence_plans.gate_facts`, `phase_release.released_phases`, the queue's draft readiness;
  `test_queue.py` grown to nine tests): `make test-critical` **365 passed, 0 failed in
  5 min 1 s**; `make test-fast` **87 Python passed in 2 min 38 s and 112 Node passed**;
  type checks clean; lint clean except the known `biome.json` line endings. One
  expectation rewritten (`test_evidence_flow`: the inbox states a held draft's reason in
  the approval endpoint's own words, "Plan the control's evidence first", filed under
  planning as before). Browser checks recorded in `docs/review/m2-closure/`: the client
  portal's full submission path, keyboard-only paths, and the drafted-request readiness
  before and after on the 155- and 403-control engagements.
- M3a (21 October 2026, real agent execution; migration 0094): `make test-fast` with
  `test_agent_execution` and `test_provenance` added to the fast set **102 Python passed
  in 2 min 40 s and 112 Node passed**; `make test-critical` with both files added
  **first run 3 failed, 377 passed in 5 min 10 s (`test_workpapers`: the workpaper drafter's audit call read an `agent_instance` variable that the no-model path never set, an UnboundLocalError in `run_draft`; fixed by initialising it before the branches); rerun after the fix: **380 passed, 0 failed in 5 min 12 s****; type checks clean; lint clean except the known `biome.json` endings. The
  gated live smoke (`MODEL_LIVE_TESTS=1`, never in the gate) passed 2 of 2 in 31 s for
  $0.0427. Two legacy expectations rewritten in `test_pbc_drafting`: a rejected or failed
  model draft was `RULES` with "so the rules were used"; it is `FALLBACK` with the failure
  named first (the owner's decision 5 for Milestone 3: a model failure stays visible even
  when the rules produce a result). Nothing retired; no audit-integrity assertion changed.
- M3a closure (21 October 2026; migration 0095; the console and nine other callers moved
  onto the agent caller, cancellation semantics, key rotation, budget visibility): targeted
  Python across every touched module (migrations, provenance, execution, console, drafting,
  workpapers, reviews, analysis, RCM, setup, scoping, suggestions, library, context, models)
  first run 9 failed, 142 passed (five legacy expectations and four defects in the new
  code: a chat message shape in a test, a leftover direct record in the reader, a draft
  input that was not serialisable, a malformed-answer retry that doubled the reading
  path's calls, removed); after the fixes 67 passed on the five files that failed;
  `make test-fast` **106 Python passed in 2 min 28 s and 112 Node passed**; `make test-critical` **384 passed, 0 failed in 5 min 28 s**. Legacy expectations rewritten,
  each for the owner's decision 5 (a rules result after a failed or rejected model answer
  is FALLBACK, never RULES): `test_evidence_analysis` (an empty answer, an unknown kind),
  and `test_pbc_drafting::test_claude_answers_through_the_forced_output_tool` now passes a
  tier's configuration to the live adapter, as every caller does since the closure (an
  untiered live call is refused as unmetered). Nothing retired; no audit-integrity
  assertion changed.
- M3b (21 October 2026, evidence intelligence; migration 0096): `make test-fast` with
  `test_evidence_corpus` and the mapping model test added **113 Python passed in 2 min 58 s
  and 114 Node passed**; `make test-critical` with `test_evidence_corpus` added **391
  passed, 0 failed in 5 min 33 s**; the corpus tests rerun on the final corpus 7 passed;
  type checks clean; lint clean except the known `biome.json` endings. The gated live
  corpus runs (never in the gate) cost $1.84 in all. No legacy expectation rewritten.
- M3b closure (21 October 2026; migration 0097): `make test-fast` **123 Python passed in
  3 min 0 s and 114 Node passed**; `make test-critical` **401 passed, 0 failed in 5 min 53 s**;
  the closure's corpus tests 17 passed. One M3a regression found outside the gate and
  corrected: `test_evidence_reading::test_claude_receives_images_as_base64_blocks_before_the_prompt`
  called the live adapter with the untiered configuration, which the M3a containment refuses;
  it now uses a tier's configuration (the safeguard is intended and unchanged). Three repeat
  live runs of the unchanged corpus cost $2.61.
- M3c (grounded testing; `testing_engine.py`, `testing_checks.py`, `testing_rationale.py`,
  `control_reviews.py`, `workpaper_service.py`, `test_sheets.py`, the sheet's web model and
  view; `test_grounded_testing.py` added to the fast and critical sets, `sheet-model` and
  `agent-says-model` to the fast Node set): `make test-critical` **411 passed, 0 failed in
  5 min 51 s**; `make test-fast` **133 Python passed and 128 Node passed**; every Node file
  **722 passed**; `make test-full`, run at the owner's direction before acceptance, **873
  passed, 0 failed, 6 skipped** (the gated live tests) in 12 min 40 s on the final code.
  Expectations rewritten for M3c, each recorded in `docs/review/m3c/tests.md`: the
  provider-failure test (an execution failure writes no result), two prompt versions, and
  `test_control_context`'s unexplained exception (now for a person). Two pre-existing
  failures found by the full runs and fixed: `test_evidence_plans` expected RULES for a
  rejected plan, which M3a made FALLBACK; the form check failed on the M3a and M3b forms
  missing `autoComplete="off"` (code fixed). Earlier full runs that shared PostgreSQL with
  the live runs hit its 100-connection limit (Temporal holds 24); those tests passed alone.
- Tiered strategy (decided by the owner on 21 October 2026, §1, §6 and §7): the review of
  tests the routine sets had missed added eight single safeguard tests to `make
  test-critical` (`CRITICAL_PICKED`) and the form check to both the fast and the critical
  Node sets (`CRITICAL_NODE`); the export test's one-microsecond flake was traced to the
  product and fixed (one timestamp for creation and expiry), its expectation unchanged.

- M3c closure (Tier 2 with escalation: approval enforcement and the workpaper content model changed): `make test-critical` **421 passed**; `make test-fast` **135 Python and 129 Node passed**; every Node file **723 passed**; the 17 non-routine files that touch workpapers, reviews or the rule checks **193 passed**; the live M3c tests 3 passed. `make test-full` not rerun, at the owner's direction; the selection covers the changed paths (see `docs/review/m3c/tests.md`).
- M3d (Tier 2 with escalation; reliability and safeguards; migration 0098; shared `provenance.py` and `models.py`; `test_reliability.py` and `test_hostile_evidence.py` added to the fast and critical sets): `make test-critical` **447 passed**; `make test-fast` **161 Python and 129 Node passed**; every Node file **723 passed**; lint and types clean except the known line endings. Escalated to the full Python suite for the shared model-call record. It ran four times: 900 passed and 1 failed; two hangs in `test_system_scoping` with connections idle in transaction; then **895 passed, 1 failed** (`test_security`'s race test, "too many clients already"). A control run of the 222ac28 code had 6 connection failures and no hang. The failed tests passed alone. The suite now runs at the edge of PostgreSQL's 100 connections (Temporal holds 25), so Tier 3 should use fewer workers or more connections. Expectations rewritten, none retired: see `docs/review/m3d/tests.md`.
- M3d closure (the owner's conditional acceptance; migration 0099; the mapper, the reviewer and the instruction guard changed; `test_plan_evaluation.py` added to the fast and critical sets): `make test-critical` **454 passed**; `make test-fast` **168 Python and 130 Node passed**; every Node file **724 passed**; `make test-full` once, after the connection fix, **908 passed, 0 failed, 13 skipped**, peak 41 connections. The full-suite failures and hangs of the first M3d gate were one test's unbounded recursion (below, §6), not M3d. Expectations changed: see `docs/review/m3d/tests.md`.
- Unified planning R1 closure (Tier 3 at the owner's request; migration 0104; shared plans, implementations, the reference plan, labels for split controls; `test_shared_plans.py` added to `CRITICAL_PY`, `test_sampling`'s approval test to `CRITICAL_PICKED`, `test_waiting.py` to `FAST_PY`): `make test-critical` **467 passed**; `make test-fast` **169 Python and 172 Node passed**; every Node file **778 passed**; `make test-full` **929 passed, 0 failed, 13 skipped** (live, opt-in), after a first run with 2 failures from earlier branch work (§6). Migration replay on an empty database and on disposable copies of the demonstration and development databases, with 0104 rolled back and applied again: no row changed. Record: docs/unified-planning-r1.md.
- Release 2a (Tier 2; migrations 0105 and 0106, additive; the evidence catalog, specifications, compatibility rules, read-only consolidation analysis, the freshness gate; `test_evidence_catalog.py` added to `CRITICAL_PY`): `make test-critical` **485 passed**, then **489 passed** after the owner's commit conditions (reviewed sensitivity, unassigned groups never sendable, the freshness gate); `make test-fast` **169 Python and 172 Node passed**; every Node file **778 passed**; migration replay of 0105 and 0106 on disposable copies of the demonstration and development databases, no pre-existing row changed. The full suite was not run: no existing behaviour changed, and it runs at Release 2's close. Record: docs/release-2a.md.

## 6. Regression prevention

When a full run, a live run or a later milestone finds a failure that the routine sets
missed, the milestone that finds it adds the lightest test that would have caught it to
`make test-fast` or `make test-critical` (a whole file, or one test by its node id in
`CRITICAL_PICKED`), and records it here. Assertions are not weakened, safeguards are not
disabled, and expected outcomes are not changed merely to pass (§3).

The review of 21 October 2026:

| Missed failure | Cause | Found | Coverage now |
| --- | --- | --- | --- |
| `test_evidence_reading::test_claude_receives_images_as_base64_blocks_before_the_prompt` | M3a's call containment refused the untiered configuration the test used | M3b (fixed in 4f9ef42) | `CRITICAL_PICKED` |
| `test_evidence_plans::test_the_agent_plans_when_its_plan_passes_the_checks` | Still expected RULES for a rejected model plan, which M3a made FALLBACK; failing since 1483037 | M3c full run | `CRITICAL_PICKED` |
| `tests/no-autofill.test.ts` | The M3a cancel form and the M3b mapping form lacked `autoComplete="off"` | M3c full Node run | `FAST_NODE` and `CRITICAL_NODE` |
| `test_control_context::test_a_pass_stands_only_on_cited_evidence` | M3c's rule for unexplained exceptions changed its expectation | M3c full run | `CRITICAL_PICKED` |
| The same M3a rule for the other agents | Not missed yet; added so the next change to the agent caller is caught | This review | `CRITICAL_PICKED`: `test_evidence_analysis::test_a_rejected_model_answer_falls_back_to_the_rules`, `test_pbc_drafting::test_a_bad_or_failed_model_draft_falls_back_to_the_rules`, `test_console::test_a_failed_answer_can_be_retried_in_place`, `test_console::test_a_busy_model_is_tried_again_before_the_turn_gives_up`, `test_system_applicability::test_a_report_waits_for_a_model_and_uploads_are_checked` |
| `test_engagement_data::test_an_excel_export_holds_exactly_the_filtered_records` (intermittent) | The export's creation and expiry came from two clock readings, a microsecond apart | M3c full run | Fixed in the product (`exports.py`); the test's 30-day expectation is unchanged |
| Full-suite connection exhaustion and hangs (`test_system_scoping::test_a_review_asked_for_mid_run_runs_again_with_what_changed`) | The test's patched `gather` posted before recording its call; each nested request re-entered it until PostgreSQL refused a connection (74 for one test) | M3d closure, by sampling `pg_stat_activity` and the `TEST_CONNECTION_AUDIT` diagnostic | The test asserts the library loads once (`loads == [True]`); `TEST_CONNECTION_AUDIT` records any connection a test leaves open |
| `test_waiting` (earlier) | An UPDATE-class file not run between M2a and M2b | M2b | Its queue behaviour is asserted by `test_queue` (critical) |
| A group plan decision recorded twice, the second with no plan records (Unified planning R1) | Two requests from a fast double press both passed the read-time checks; approving an approved plan records nothing, so the second group decision stood empty | R1 closure, by a UI check counting records after a double press | Fixed in the product (`approve` refuses inside a group decision; `approve_group` checks one record per plan). `test_shared_plans.py` added to `CRITICAL_PY`; `test_a_group_decision_never_stands_without_a_record_for_each_plan` fails without the fix |
| `test_sampling::test_a_population_gets_a_proposed_test_plan_that_a_person_approves` | Expected the kickoff request to stay SENT; migration 0103 (owner) receives a request once its items are accepted. Rewritten: the request is RECEIVED on acceptance and unchanged by the sample request (old and new expectations in the test) | R1 closure full run | `CRITICAL_PICKED` |
| `test_waiting::test_open_test_results_and_late_evidence_wait_on_the_team` | The inbox items gained `id` and `control_label` (queue.QueueItem); the exact comparison now asserts both | R1 closure full run | `FAST_PY` |
| A split control's entities sharing values and evidence (R1) | "Fill every control that has none" and the family's shared files did not know units | R1 closure review | Fixed in the product (`set_values`, `FAMILY_FILES`, `shared_from_sibling` match on units); asserted in `test_shared_plans.py` (critical), each shown to fail without its fix; both evidence rules by `test_evidence_is_never_shared_across_entities_and_still_shared_across_systems` (added at the commit authorization) |

## 7. Reporting and the milestone closure checklist

Every milestone report states:

1. The tests executed, with the commands actually run and their results.
2. The tests intentionally not executed, and why.
3. The risk-based justification for the selected coverage: what changed, which invariants
   it could affect, and which tests cover them.
4. Any outstanding failures or regression risks.
5. The date and commit of the most recent successful full-suite execution, and whether it
   still applies to the code being closed.

Closure checklist (Tier 2, and Tier 3 where §1 requires it):

- [ ] Formatting, lint and type checks clean for the changed code (known environment
      exceptions named).
- [ ] Targeted and integration tests for the affected workflows run and passing.
- [ ] `make test-fast` passing.
- [ ] `make test-critical` passing.
- [ ] The milestone's acceptance and safeguard tests, and gated live tests where a model
      is measured, run and passing, with their results recorded.
- [ ] Migrations validated and applied to the development database, when the schema
      changed.
- [ ] Escalation considered (§1): the high-risk areas touched, and why the selection
      covers them or why Tier 3 ran.
- [ ] Every rewritten expectation recorded with the old one, the new one and the
      justification (§3); any test missed by the routine sets added to them (§6).
- [ ] The diff reviewed for unrelated changes, secrets, unsafe defaults and data exposure.
- [ ] The report's five items above.

**Most recent successful full-suite execution:** 21 October 2026, `make test-full`, 873
passed, 0 failed, 6 skipped (the gated live tests), on the M3c working tree (branch
`milestones-6.5-to-8.1b`, base commit 4f9ef42, M3c uncommitted). To be updated with the M3c
commit once the owner authorizes it.
