# Testing strategy: risk-based and change-focused

Decided by the product owner on 19 October 2026, replacing the full Python regression
suite as the gate for every milestone. The objective: validate the approved workflow
meaningfully, every time, without an hour of regression against functionality being
replaced. Nothing here weakens authorization, segregation of duties, approval gates or
audit traceability; those tests are the ones that always run.

## 1. The gate for a milestone (W1–W4 and after)

1. Formatting, linting and type checking for the modified code (`make format`, `make
   lint`, `make typecheck`).
2. The targeted tests for the active work: `make test-fast` (the workflow-integrity set
   by default; `FAST_PY=... FAST_NODE=...` to choose) or `make test-changed` for the files
   modified.
3. Every applicable audit-critical safeguard test: `make test-critical`.
4. Migration validation whenever the database changes: `test_migrations` and
   `test_schema` (in the critical set), the migration applied to the development
   database, and the schema and record-preservation checks reported.
5. Focused integration tests for the affected workflows (named in the milestone report).

The entire legacy suite, `make test-full`, runs only when the owner explicitly asks.

## 2. Commands

| Command | What it runs | Typical time |
|---|---|---|
| `make test-fast` | `FAST_PY` Python files and `FAST_NODE` Node files; defaults are the workflow-integrity set | 2–4 min |
| `make test-critical` | The CRITICAL files of §4, in parallel (`-n auto --dist loadfile`) | 8–12 min |
| `make test-changed [BASE=<ref>]` | `scripts/changed_tests.py`: tests that import or name the changed modules, migration tests when `migrations/` changed, Node tests importing changed web files; one level deep, so it complements `test-critical` rather than replacing it | depends |
| `make test` | `test-critical` then the Node smoke test (what `make ci` runs) | |
| `make test-full` | The entire Python suite (≈ 750 tests) with `-rsw` for skips and warnings | ≈ 60 min serial; ≈ 12 min with workers |

Mechanics that keep the tests trustworthy and fast: every Python test still gets its own
database, now cloned from a per-session template that `apply_migrations` built once
(`tests/conftest.py`), and files run in parallel with `pytest-xdist` (one file per
worker). `test_migrations` keeps applying the migrations itself on an empty database.

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
