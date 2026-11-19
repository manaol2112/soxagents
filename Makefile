NODE_VERSION := 24.21.0
PNPM_VERSION := 12.10.1
PYTHON_VERSION := 3.14.8
UV_VERSION := 0.13.0

COMPOSE := docker compose

# The recipes are POSIX shell. On Windows, make would otherwise run them with cmd.exe:
# use the bash that Git for Windows installs, whichever terminal make is run from.
ifeq ($(OS),Windows_NT)
SHELL := C:/Program Files/Git/bin/bash.exe
.SHELLFLAGS := -c
# Scripts run with Git's bash by its path: make runs a one-line recipe without a shell, and
# on Windows a bare "bash" is WSL's launcher (C:/Windows/System32/bash.exe).
BASH := $(SHELL)
else
BASH := bash
endif

.PHONY: help toolchain check check-tesseract install install-tesseract start free-ports go awake stop status format lint typecheck api web migrate test test-fast test-critical test-demo test-changed test-full ci reset test-node check-changed test-files prove test-critical-shard test-fast-only web-build backup restore backup-verify seed-review-states scratch-stack scratch-status scratch-stop browser-check env-status test-durations

help:
	@echo "make toolchain  Show pinned Node.js, pnpm, Python, and uv versions"
	@echo "make check      Fail if the toolchain does not match the pins or Tesseract OCR is missing"
	@echo "make install    Install Tesseract OCR if missing, then locked dependencies with pnpm and uv"
	@echo "make start      Start PostgreSQL, Temporal, and MinIO, then migrate"
	@echo "make go         Start everything: make start, then the API and the web app"
	@echo "make free-ports Stop a server an earlier run left on port 8000 or 3000 (make go does this)"
	@echo "make awake      Keep Windows from sleeping (HOURS=72 to stop after 72 hours)"
	@echo "make migrate    Apply SQL migrations without deleting data"
	@echo "make stop       Stop PostgreSQL without deleting data"
	@echo "make status     Show Compose service status"
	@echo "make env-status Each running API and web server: its checkout, branch, commit, database"
	@echo "make format     Format Python and TypeScript tests"
	@echo "make lint       Run format checks and linters"
	@echo "make typecheck  Run mypy and tsc"
	@echo "make api        Run the API on 127.0.0.1:8000"
	@echo "make web        Run the web app on 127.0.0.1:3000"
	@echo "make web-build  The production build of the web app (next build), as CI runs it"
	@echo "make test       The milestone gate: test-critical, then the Node tests"
	@echo "make test-fast  Targeted tests for the active work (FAST_PY=... FAST_NODE=... to choose)"
	@echo "make test-critical  Audit-integrity and security regression tests, in parallel"
	@echo "make test-changed   Tests for the files changed since main (BASE=<ref> to compare)"
	@echo "make check-changed  G0: lint and types on the changed files, then their tests, in a summary"
	@echo "make test-files TESTS='<files or node ids>'  G1: named tests (the touched area's safeguards)"
	@echo "make prove TEST=<node id> FILES='<fix files>'  G1: the new safeguard test fails without its fix"
	@echo "make test-critical-shard SHARD=k SHARDS=n  Part k of n of the critical tier (what CI runs)"
	@echo "make test-fast-only  The fast tier's files that are not critical (what CI runs)"
	@echo "make test-durations RUN=<CI run id>  Refresh scripts/test_durations.json, which balances the CI parts"
	@echo "make test-full  The entire legacy Python suite (only when the owner asks)"
	@echo "make ci         Run lint, typecheck, and test"
	@echo "make backup     Back up a database to backups/ (DB=name; default: DATABASE_URL's)"
	@echo "make restore    Restore a backup into a NEW database (FILE=... TARGET=...)"
	@echo "make backup-verify  Prove a backup restores, on a scratch database"
	@echo "make reset      Delete ALL local data; needs CONFIRM=delete-local-data and backs up first"

toolchain:
	@echo "Node.js $(NODE_VERSION)"
	@echo "pnpm $(PNPM_VERSION)"
	@echo "Python $(PYTHON_VERSION)"
	@echo "uv $(UV_VERSION)"

check: check-node check-pnpm check-uv check-python check-tesseract

check-node:
	@current="$$(node -p 'process.versions.node')"; \
	if [ "$$current" != "$(NODE_VERSION)" ]; then \
		echo "Node.js $$current does not match pinned $(NODE_VERSION). See docs/development.md."; \
		exit 1; \
	fi; \
	echo "Node.js $(NODE_VERSION)"

check-pnpm:
	@current="$$(pnpm --version)"; \
	if [ "$$current" != "$(PNPM_VERSION)" ]; then \
		echo "pnpm $$current does not match pinned $(PNPM_VERSION). See docs/development.md."; \
		exit 1; \
	fi; \
	echo "pnpm $(PNPM_VERSION)"

check-uv:
	@current="$$(uv --version | awk '{print $$2}')"; \
	if [ "$$current" != "$(UV_VERSION)" ]; then \
		echo "uv $$current does not match pinned $(UV_VERSION). See docs/development.md."; \
		exit 1; \
	fi; \
	echo "uv $(UV_VERSION)"

check-python:
	@current="$$(uv python find $(PYTHON_VERSION))"; \
	echo "Python $(PYTHON_VERSION) at $$current"

# Tesseract OCR reads screenshots and scans of evidence. It is a system program that pnpm
# and uv cannot install, so scripts/tesseract.sh installs it (make install) and checks it.
check-tesseract:
	@"$(BASH)" scripts/tesseract.sh check

install-tesseract:
	@"$(BASH)" scripts/tesseract.sh install

install: install-tesseract
	pnpm install --frozen-lockfile
	uv sync --all-packages --frozen --python $(PYTHON_VERSION)

start: require-env
	$(COMPOSE) up -d --wait --wait-timeout 180
	set -a && . ./.env && set +a && uv run --package ai-workforce-api python -m ai_workforce_api.migrate

# One command after a restart: the database layer, then the API and the web app
# together in this terminal. Ctrl+C stops both; the Docker services keep running.
# Before starting, stop a server an earlier run left on the API's or the web app's port: on
# Windows, Ctrl+C can leave them running and the next start then fails (scripts/free-ports.sh;
# only Python or Node is stopped, anything else on the port is named and stops the start).
FREE_PORTS ?= 8000 3000
free-ports:
	@"$(BASH)" scripts/free-ports.sh $(FREE_PORTS)

go: start free-ports
	@echo "API on http://127.0.0.1:8000 and workspace on http://localhost:3000. Ctrl+C stops both."
	@trap 'kill 0' INT TERM; "$(MAKE)" --no-print-directory api & "$(MAKE)" --no-print-directory web & wait

# Windows only: keep the machine awake while the servers run. HOURS=0 runs until stopped.
HOURS ?= 0
awake:
	powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/stay-awake.ps1 -Hours $(HOURS) -LidClosed

migrate: start

stop: require-env
	$(COMPOSE) stop

status: require-env
	$(COMPOSE) ps

# scripts/run_tests.py decides whether a gate passed and scripts/changed_tests.py what it
# runs, so both are held to the same checks.
format:
	uv run ruff format tests services/api scripts/run_tests.py scripts/changed_tests.py scripts/env_status.py
	uv run ruff check --fix tests services/api scripts/run_tests.py scripts/changed_tests.py scripts/env_status.py
	pnpm exec biome check --write

lint:
	uv run ruff format --check tests services/api scripts/run_tests.py scripts/changed_tests.py scripts/env_status.py
	uv run ruff check tests services/api scripts/run_tests.py scripts/changed_tests.py scripts/env_status.py
	pnpm exec biome check

typecheck:
	uv run mypy
	uv run mypy scripts/run_tests.py scripts/changed_tests.py scripts/env_status.py
	pnpm exec tsc --noEmit --incremental false
	pnpm exec tsc -p apps/web/tsconfig.json --noEmit --incremental false

# `python -m uvicorn`, not the uvicorn launcher: Windows App Control can block the
# launcher .exe (os error 4551), and the API then never started under `make go`.
api: require-env
	set -a && . ./.env && set +a && uv run --package ai-workforce-api python -m uvicorn ai_workforce_api.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir services/api/ai_workforce_api

# The production build, which no other check compiles (CI runs it on every push). Locally,
# it rewrites apps/web/next-env.d.ts to the build's type paths: restore that file after.
web-build:
	pnpm --filter web build

# WEB_HOST=0.0.0.0 in .env lets other devices on the network open the workspace; the
# default keeps it on this machine.
web:
	set -a && . ./.env && set +a && pnpm --filter web exec next dev --hostname "$${WEB_HOST:-127.0.0.1}" --port 3000

# Testing strategy (docs/test-strategy.md, decided by the product owner): targeted and
# audit-critical tests gate a milestone; the whole legacy suite runs only on request.
# Every Python test still gets its own database, cloned from a migrated template;
# files run in parallel with one file per worker.
# Six workers: each test opens several PostgreSQL connections (the app, the schedulers,
# direct checks) and the local server allows 100; more workers exhaust them.
WORKERS ?= 6
PYTEST := uv run pytest -q -p no:cacheprovider -n $(WORKERS) --dist loadfile --durations=15 --tb=short
API_TESTS := services/api/tests

# The active work's tests: the workflow-integrity set by default, or the files given.
FAST_PY ?= $(API_TESTS)/test_database_url.py $(API_TESTS)/test_attribute_allowances.py $(API_TESTS)/test_authentication_profile.py $(API_TESTS)/test_attributes_follow_understanding.py $(API_TESTS)/test_understanding_is_authority.py $(API_TESTS)/test_control_details.py $(API_TESTS)/test_understanding_chat.py $(API_TESTS)/test_design_release.py $(API_TESTS)/test_control_conclusions.py $(API_TESTS)/test_design_conclusions.py $(API_TESTS)/test_methodology.py $(API_TESTS)/test_question_review.py $(API_TESTS)/test_added_control_planning.py $(API_TESTS)/test_understanding_copy.py $(API_TESTS)/test_policy_evidence.py $(API_TESTS)/test_control_send.py $(API_TESTS)/test_last_page.py $(API_TESTS)/test_process_flow_steps.py $(API_TESTS)/test_control_journey.py $(API_TESTS)/test_workspace.py $(API_TESTS)/test_control_reviews.py $(API_TESTS)/test_round_reviews.py $(API_TESTS)/test_plan_impact.py $(API_TESTS)/test_round_readiness.py $(API_TESTS)/test_round_basis.py $(API_TESTS)/test_signoff_history.py $(API_TESTS)/test_test_rounds.py $(API_TESTS)/test_phase_release.py $(API_TESTS)/test_control_progress.py $(API_TESTS)/test_control_activity.py $(API_TESTS)/test_next_steps.py $(API_TESTS)/test_migrations.py $(API_TESTS)/test_agent_execution.py $(API_TESTS)/test_provenance.py $(API_TESTS)/test_evidence_corpus.py $(API_TESTS)/test_evidence_reading.py $(API_TESTS)/test_grounded_testing.py $(API_TESTS)/test_reliability.py $(API_TESTS)/test_hostile_evidence.py $(API_TESTS)/test_plan_evaluation.py $(API_TESTS)/test_waiting.py $(API_TESTS)/test_standard_adoption.py $(API_TESTS)/test_slot_options.py $(API_TESTS)/test_evidence_assurance.py $(API_TESTS)/test_evidence_wizard.py $(API_TESTS)/test_agent_answers.py $(API_TESTS)/test_design_workpaper_model.py $(API_TESTS)/test_assurance_upgrade.py $(API_TESTS)/test_attribute_dispositions_model.py $(API_TESTS)/test_file_reliability_model.py $(API_TESTS)/test_workpaper_marks.py $(API_TESTS)/test_design_conclusion_choice_model.py $(API_TESTS)/test_workpaper_review_notes_model.py $(API_TESTS)/test_design_points_model.py $(API_TESTS)/test_design_narrative_prompt.py $(API_TESTS)/test_workpaper_redraft_model.py $(API_TESTS)/test_understanding_once_rules.py $(API_TESTS)/test_understanding_review_rules.py $(API_TESTS)/test_walkthrough_banks.py $(API_TESTS)/test_walkthrough_since.py $(API_TESTS)/test_control_understanding_contract.py
FAST_NODE ?= tests/button-hover.test.ts tests/attributes-handoff-model.test.ts tests/understanding-document-model.test.ts tests/authentication-model.test.ts tests/design-release-model.test.ts tests/design-requests-model.test.ts tests/design-evidence-model.test.ts tests/evidence-assurance-model.test.ts tests/evidence-wizard-model.test.ts tests/evidence-wizard-contract.test.ts tests/step-frame-model.test.ts tests/control-details-model.test.ts tests/next-step-model.test.ts tests/understanding-chat-model.test.ts tests/control-workflow-model.test.ts tests/step-panel-model.test.ts tests/understanding-once-model.test.ts tests/understanding-once-view.test.ts tests/understanding-specialist-model.test.ts tests/understanding-specialist-view.test.ts tests/understanding-review-fixes.test.ts tests/attribute-questions-line.test.ts tests/control-conclusion-model.test.ts tests/design-conclusion-model.test.ts tests/methodology-model.test.ts tests/no-autofill.test.ts tests/focus-trap.test.ts tests/theme.test.ts tests/system-layer.test.ts tests/agent-avatar-model.test.ts tests/understanding-copy-model.test.ts tests/policy-evidence-model.test.ts tests/first-engagement-model.test.ts tests/launch-checklist-model.test.ts tests/system-added-model.test.ts tests/select-controls-model.test.ts tests/last-page-model.test.ts tests/panel-placement.test.ts tests/control-send-model.test.ts tests/controls-page.test.ts tests/request-approve-send.test.ts tests/form-change.test.ts tests/evidence-mapping-model.test.ts tests/evidence-intelligence-model.test.ts tests/evidence-findings-model.test.ts tests/evidence-dialog-model.test.ts tests/evidence-change-model.test.ts tests/sample-trace-model.test.ts tests/control-tabs-model.test.ts tests/control-setup-model.test.ts tests/home-work-model.test.ts tests/engagement-lifecycle.test.ts tests/phone-layout.test.ts tests/sheet-model.test.ts tests/agent-says-model.test.ts tests/queue-model.test.ts tests/testing-hub-model.test.ts tests/control-journey-model.test.ts tests/signoff-model.test.ts tests/controls-register-model.test.ts tests/engagement-model.test.ts tests/review-model.test.ts tests/home-model.test.ts tests/round-model.test.ts tests/control-workspace-model.test.ts tests/controls-overview-model.test.ts tests/shared-plans-model.test.ts tests/request-group-model.test.ts tests/evidence-owners-model.test.ts tests/run-failure-lines.test.ts tests/design-workpaper-model.test.ts tests/design-workpaper-view.test.ts tests/design-points-model.test.ts tests/evidence-upgrade-model.test.ts tests/check-digest-model.test.ts tests/check-digest-view.test.ts tests/one-evidence-viewer.test.ts tests/viewer-about.test.ts tests/attribute-tickmark-model.test.ts tests/attribute-tickmark-view.test.ts tests/file-reliability-model.test.ts tests/file-reliability-view.test.ts tests/evidence-closing-model.test.ts tests/evidence-closing-view.test.ts tests/tickmark-chain.test.ts tests/section-edit-model.test.ts tests/section-edit-view.test.ts tests/rich-text-model.test.ts tests/rich-editor-view.test.ts tests/section-redraft-model.test.ts tests/section-redraft-view.test.ts tests/working-copy-model.test.ts tests/leave-guard.test.ts tests/autosave-view.test.ts tests/conclusion-choice-view.test.ts tests/preparer-signoff.test.ts tests/review-notes-model.test.ts tests/review-notes-view.test.ts tests/review-request-model.test.ts tests/review-signoff-view.test.ts tests/step-focus-model.test.ts tests/control-understanding-contract.test.ts

# Audit integrity, authorization, segregation of duties, approvals, evidence
# traceability, review independence, and database integrity (CRITICAL in
# docs/test-strategy.md). Kept in step with that document.
# Single safeguard tests from files otherwise CURRENT (docs/test-strategy.md §6): the
# M3a rule that a model failure is never the rules' work, for each agent, the model
# call's containment, and a pass standing only on cited evidence.
CRITICAL_PICKED := $(addprefix $(API_TESTS)/,test_evidence_plans.py::test_the_agent_plans_when_its_plan_passes_the_checks test_evidence_analysis.py::test_a_rejected_model_answer_falls_back_to_the_rules test_pbc_drafting.py::test_a_bad_or_failed_model_draft_falls_back_to_the_rules test_evidence_reading.py::test_claude_receives_images_as_base64_blocks_before_the_prompt test_console.py::test_a_failed_answer_can_be_retried_in_place test_console.py::test_a_busy_model_is_tried_again_before_the_turn_gives_up test_system_applicability.py::test_a_report_waits_for_a_model_and_uploads_are_checked test_control_context.py::test_a_pass_stands_only_on_cited_evidence test_sampling.py::test_a_population_gets_a_proposed_test_plan_that_a_person_approves)
CRITICAL_NODE := tests/no-autofill.test.ts tests/control-understanding-contract.test.ts
CRITICAL_PY := $(addprefix $(API_TESTS)/,test_authentication_profile.py test_agent_answers.py test_design_traceability.py test_design_requests.py test_design_evidence.py test_evidence_assurance.py test_evidence_wizard.py test_planner_reliability.py test_control_details.py test_understanding_chat.py test_methodology.py test_access.py test_actions.py test_agents.py test_approvals.py test_auth.py test_authorization.py test_execution.py test_security.py test_policy.py test_schema.py test_migrations.py test_independence.py test_control_reviews.py test_design_conclusions.py test_design_release.py test_control_conclusions.py test_round_reviews.py test_plan_impact.py test_round_readiness.py test_round_basis.py test_queue.py test_signoff_history.py test_planning_gate.py test_master_plans.py test_evidence_flow.py test_evidence_versions.py test_evidence.py test_engagement_integrity.py test_handoffs.py test_outbound.py test_smtp_mailbox.py test_support_notifications.py test_subscriptions.py test_demo.py test_mailbox.py test_inbound.py test_health.py test_control_journey.py test_test_rounds.py test_workspace.py test_phase_release.py test_test_citations.py test_console_citations.py test_evidence_review.py test_testing_engine.py test_workpapers.py test_google.py test_invitations.py test_demo_requests.py test_evidence_portal.py test_projects.py test_tasks.py test_workflows.py test_failures.py test_durable.py test_agent_execution.py test_provenance.py test_evidence_corpus.py test_grounded_testing.py test_reliability.py test_hostile_evidence.py test_plan_evaluation.py test_shared_plans.py test_evidence_catalog.py test_evidence_groups.py test_evidence_owners.py test_evidence_status.py test_registration_hardening.py test_storage_cleanup.py test_archived_guard.py test_evidence_findings.py test_evidence_dialog.py test_evidence_workspace.py test_sample_traces.py test_trial_hardening.py test_demo_reset.py test_engagement_close.py test_test_infrastructure.py test_assurance_upgrade.py test_attribute_dispositions.py test_file_reliability.py test_workpaper_drafts.py test_design_conclusion_choice.py test_workpaper_review_notes.py test_design_review_requests.py test_design_points.py test_design_narrative_prompt.py test_workpaper_redraft_model.py test_workpaper_redraft.py test_understanding_once_rules.py test_understanding_once.py test_understanding_review_rules.py test_understanding_review.py test_walkthrough_since.py test_control_understanding_contract.py test_prompt_data.py test_reliability_audit.py test_secret_text.py test_test_tiers.py test_ci_gate.py test_run_tests_script.py test_changed_tests.py test_route_authorization.py test_web_calls_api_routes.py test_scheduler_parity.py test_request_status_moves.py test_prompt_neutral_everywhere.py test_review_guard.py test_env_status.py) tests/test_smoke.py $(CRITICAL_PICKED)

# Test files that run only in the full suite (make test-full), by decision rather than by
# omission: every pytest file is in the fast, critical or demo tier or is named here, and
# services/api/tests/test_test_tiers.py fails when one is in none (governance, 17 Nov 2026:
# 75 files had drifted out of every tier unnoticed). Move a file up a tier by deleting it
# here and adding it there.
FULL_ONLY_PY := $(addprefix $(API_TESTS)/,test_assurance_engine2.py test_assurance_eval_set.py test_assurance_facts.py test_assurance_followups.py test_assurance_forward_only.py test_assurance_review.py test_assurance_scenarios.py test_business_processes.py test_client_address.py test_clients.py test_console.py test_control_challenges.py test_control_context.py test_control_statements.py test_controls_batch.py test_design_workpaper.py test_email_html.py test_engagement_data.py test_engagement_details.py test_engagement_profile.py test_evidence_analysis.py test_evidence_annotations.py test_evidence_center.py test_evidence_intake.py test_evidence_planning.py test_evidence_plans.py test_followups.py test_governing_documents.py test_library_governance.py test_library_matching.py test_live_corpus.py test_live_grounded.py test_live_model.py test_live_reliability.py test_manager.py test_manual_controls.py test_models.py test_narrative_review.py test_onboarding.py test_pbc.py test_pbc_drafting.py test_pbc_scenarios.py test_plan_grounding.py test_portal_workspace.py test_preview.py test_prior_year.py test_process_narrative.py test_rcm_import.py test_rcm_systems.py test_rcm_terms.py test_rcm_uploads.py test_reports.py test_request_details.py test_request_quality.py test_request_wording.py test_review_fixes.py test_sampling.py test_scope_changes.py test_scope_setup.py test_setup_drafting.py test_slot_options_coverage.py test_start_from.py test_system_applicability.py test_system_scoping.py test_system_setup.py test_system_suggestions.py test_template_pinning.py test_testing_definitions.py test_walkthrough_answers.py test_walkthrough_questions.py test_workforce.py test_workpaper_templates.py)

test-fast: require-env
	set -a && . ./.env && set +a && $(PYTEST) $(FAST_PY)
	pnpm exec node --test $(FAST_NODE)

# The demo's release gate (Step 6): the Northstar dataset, lifecycle and closure, the
# guided tour and the demo reset. The Northstar fixture builds once per run (cached by
# database URL), so these run together, apart from the routine tiers.
DEMO_PY := $(addprefix $(API_TESTS)/,test_northstar.py test_northstar_lifecycle.py test_northstar_closure.py test_demo_tour.py test_demo_reset.py test_demo.py test_subscriptions.py)
DEMO_NODE := tests/demo-model.test.ts tests/demo-tour-model.test.ts tests/trial-model.test.ts tests/exports-model.test.ts tests/remediation-model.test.ts tests/seeded-provenance.test.ts

test-demo: require-env
	set -a && . ./.env && set +a && uv run pytest -q -p no:cacheprovider --tb=short $(DEMO_PY)
	pnpm exec node --test $(DEMO_NODE)

test-critical: require-env
	set -a && . ./.env && set +a && $(PYTEST) $(CRITICAL_PY)
	pnpm exec node --test $(CRITICAL_NODE)

BASE ?=
test-changed: require-env
	set -a && . ./.env && set +a && uv run python scripts/changed_tests.py --workers $(WORKERS) $(if $(BASE),--base $(BASE),)

# The test runner (scripts/run_tests.py, docs/test-strategy.md §1): one heavy pytest run on
# this machine at a time (a second one waits and says so), a wall-clock limit, JUnit XML
# and the log in test-results/ (git-ignored), and a summary of at most 20 lines with
# environment errors (B6) rerun once alone and counted on their own line.
RUN_TESTS := uv run python scripts/run_tests.py

# G0, every step: ruff, mypy, tsc and biome on the changed files, then the tests
# scripts/changed_tests.py selects for them, on two workers.
check-changed: require-env
	set -a && . ./.env && set +a && $(RUN_TESTS) changed $(if $(BASE),--base $(BASE),)

# G1: the safeguard tests of the touched area (docs/test-strategy.md §1), or any named
# files or node ids, through the same runner.
test-files: require-env
	@test -n "$(TESTS)" || (echo "Usage: make test-files TESTS='<test files or node ids>'"; exit 2)
	set -a && . ./.env && set +a && $(RUN_TESTS) pytest --label files $(TESTS)

# G1, for a NEW safeguard test only: it passes with its fix and fails without it, in a
# temporary worktree (nothing here is stashed or touched). FILES are the fix's source files,
# restored to BASE (default: the merge base with main); or PATCH=<file> reversed instead.
prove: require-env
	@test -n "$(TEST)" || (echo "Usage: make prove TEST=<pytest node id> FILES='<source files of the fix>' [PATCH=<file>] [BASE=<ref>]"; exit 2)
	set -a && . ./.env && set +a && $(RUN_TESTS) prove --test "$(TEST)" $(if $(BASE),--base $(BASE),) $(if $(PATCH),--patch $(PATCH),) $(FILES)

# G4, on CI: the critical tier's Python files in SHARDS parallel jobs (.github/workflows/
# ci.yml). The split is by CI's measured time per file (scripts/test_durations.json; a file
# with no time yet weighs its size) and deterministic; test_ci_gate.py checks that the
# shards together are CRITICAL_PY exactly. The Node files of CRITICAL_NODE run in the
# Node job, which runs every Node test.
SHARDS ?= 4
SHARD ?= 1
# 25 minutes, under the CI job's 30, so a hung part still writes its summary.
CI_PART_TIMEOUT ?= 1500
test-critical-shard: require-env
	set -a && . ./.env && set +a && $(RUN_TESTS) pytest --label critical-$(SHARD)-of-$(SHARDS) --workers $(WORKERS) --timeout $(CI_PART_TIMEOUT) --shard $(SHARD)/$(SHARDS) $(CRITICAL_PY)

# G4, on CI: the fast tier's files that are not in the critical tier, which no CI part ran
# before 19 Nov 2026 (CI ran the critical tier and the Node tests only). Computed from the
# two lists, so a file added to FAST_PY runs on CI the day it is added (test_ci_gate.py).
test-fast-only: require-env
	set -a && . ./.env && set +a && $(RUN_TESTS) pytest --label fast-only --workers $(WORKERS) --timeout $(CI_PART_TIMEOUT) $(filter-out $(CRITICAL_PY),$(FAST_PY))

# The times that balance the CI parts, from a CI run's logs (each part prints its
# test-results/<label>/durations.json): refresh them when the parts drift apart.
test-durations:
	@test -n "$(RUN)" || (echo "Usage: make test-durations RUN=<CI run id> (gh run list --workflow CI)"; exit 2)
	mkdir -p test-results
	gh run view $(RUN) --log > test-results/ci-run-$(RUN).log
	uv run python scripts/run_tests.py durations test-results/ci-run-$(RUN).log

# Every node test: about four seconds, so no hand-kept list decides which ones run.
test-node:
	pnpm exec node --test tests/*.test.ts

test: test-critical test-node
	$(COMPOSE) exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "SELECT 1"'

# The entire legacy Python suite, about an hour serially; run only when the owner asks.
test-full: require-env
	set -a && . ./.env && set +a && $(PYTEST) -rsw

ci: lint typecheck test

# Synthetic review states, a guarded scratch stack and the browser checks (testing
# assessment, 19 November 2026, steps 4 and 5). The scripts refuse any database that is not
# a marked synthetic one (scripts/review_guard.py). A worktree has no .venv of its own:
# pass PY=<path to the main checkout's .venv python> there.
#   make seed-review-states DB=ai_workforce_states_ui3
#   make scratch-stack DB=ai_workforce_states_ui3 [API_PORT=8030 WEB_PORT=3030 WORKER=1]
#   make browser-check DB=ai_workforce_states_ui3     make scratch-status   make scratch-stop
PY ?= $(firstword $(wildcard .venv/Scripts/python.exe .venv/bin/python) python3)
API_PORT ?= 8030
WEB_PORT ?= 3030

seed-review-states:
	$(PY) scripts/seed_review_states.py create --db $(DB)

scratch-stack:
	$(PY) scripts/scratch_stack.py start --db $(DB) --api-port $(API_PORT) --web-port $(WEB_PORT) $(if $(WORKER),--worker,)

# Every API and web server listening on ENV_PORTS (default: the development and scratch
# ports): the checkout it serves, its branch, commit, uncommitted files, how far it is
# behind origin/main, and an API's database name (never its URL). Standard library only.
ENV_PORTS ?=
env-status:
	uv run --no-project python scripts/env_status.py $(if $(ENV_PORTS),--ports "$(ENV_PORTS)",)

scratch-status:
	$(PY) scripts/scratch_stack.py status

scratch-stop:
	$(PY) scripts/scratch_stack.py stop

browser-check:
	REVIEW_DB=$(DB) REVIEW_WEB=http://127.0.0.1:$(WEB_PORT) pnpm exec node --test --test-concurrency=1 tests/browser/*.browser.ts

# Data protection (docs/operations.md, "Backup and restore"). A backup is one database,
# written to backups/ (git-ignored, not encrypted). A restore only goes into a database
# that does not exist yet. backup-verify proves a backup restores, on a scratch database.
#   make backup [DB=name]     make restore FILE=backups/x.dump TARGET=new_name
#   make backup-verify [DB=name]
backup: require-env
	@"$(BASH)" scripts/backup.sh backup

restore: require-env
	@"$(BASH)" scripts/backup.sh restore

backup-verify: require-env
	@"$(BASH)" scripts/backup.sh verify

# Deletes every local database and the local object store. It refuses without
# CONFIRM=delete-local-data, refuses outside a development APP_ENV without a second
# variable, and backs every database up first (scripts/reset.sh).
reset: require-env
	@"$(BASH)" scripts/reset.sh

require-env:
	@test -f .env || (echo "Missing .env. Copy .env.example and set the PostgreSQL values in docs/development.md."; exit 1)
