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
endif

.PHONY: help toolchain check install start go awake stop status format lint typecheck api web migrate test test-fast test-critical test-changed test-full ci reset

help:
	@echo "make toolchain  Show pinned Node.js, pnpm, Python, and uv versions"
	@echo "make check      Fail if the local toolchain does not match the pins"
	@echo "make install    Install locked dependencies with pnpm and uv"
	@echo "make start      Start PostgreSQL, Temporal, and MinIO, then migrate"
	@echo "make go         Start everything: make start, then the API and the web app"
	@echo "make awake      Keep Windows from sleeping (HOURS=72 to stop after 72 hours)"
	@echo "make migrate    Apply SQL migrations without deleting data"
	@echo "make stop       Stop PostgreSQL without deleting data"
	@echo "make status     Show Compose service status"
	@echo "make format     Format Python and TypeScript tests"
	@echo "make lint       Run format checks and linters"
	@echo "make typecheck  Run mypy and tsc"
	@echo "make api        Run the API on 127.0.0.1:8000"
	@echo "make web        Run the web app on 127.0.0.1:3000"
	@echo "make test       The milestone gate: test-critical, then the Node tests"
	@echo "make test-fast  Targeted tests for the active work (FAST_PY=... FAST_NODE=... to choose)"
	@echo "make test-critical  Audit-integrity and security regression tests, in parallel"
	@echo "make test-changed   Tests for the files changed since main (BASE=<ref> to compare)"
	@echo "make test-full  The entire legacy Python suite (only when the owner asks)"
	@echo "make ci         Run lint, typecheck, and test"
	@echo "make reset      Stop PostgreSQL and delete the local data volume"

toolchain:
	@echo "Node.js $(NODE_VERSION)"
	@echo "pnpm $(PNPM_VERSION)"
	@echo "Python $(PYTHON_VERSION)"
	@echo "uv $(UV_VERSION)"

check: check-node check-pnpm check-uv check-python

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

install:
	pnpm install --frozen-lockfile
	uv sync --all-packages --frozen --python $(PYTHON_VERSION)

start: require-env
	$(COMPOSE) up -d --wait --wait-timeout 180
	set -a && . ./.env && set +a && uv run --package ai-workforce-api python -m ai_workforce_api.migrate

# One command after a restart: the database layer, then the API and the web app
# together in this terminal. Ctrl+C stops both; the Docker services keep running.
go: start
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

format:
	uv run ruff format tests services/api
	uv run ruff check --fix tests services/api
	pnpm exec biome check --write

lint:
	uv run ruff format --check tests services/api
	uv run ruff check tests services/api
	pnpm exec biome check

typecheck:
	uv run mypy
	pnpm exec tsc --noEmit --incremental false
	pnpm exec tsc -p apps/web/tsconfig.json --noEmit --incremental false

api: require-env
	set -a && . ./.env && set +a && uv run --package ai-workforce-api uvicorn ai_workforce_api.main:app --host 127.0.0.1 --port 8000

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
FAST_PY ?= $(API_TESTS)/test_control_journey.py $(API_TESTS)/test_workspace.py $(API_TESTS)/test_control_reviews.py $(API_TESTS)/test_round_reviews.py $(API_TESTS)/test_plan_impact.py $(API_TESTS)/test_round_readiness.py $(API_TESTS)/test_round_basis.py $(API_TESTS)/test_signoff_history.py $(API_TESTS)/test_test_rounds.py $(API_TESTS)/test_phase_release.py $(API_TESTS)/test_control_progress.py $(API_TESTS)/test_control_activity.py $(API_TESTS)/test_next_steps.py $(API_TESTS)/test_migrations.py $(API_TESTS)/test_agent_execution.py $(API_TESTS)/test_provenance.py $(API_TESTS)/test_evidence_corpus.py
FAST_NODE ?= tests/evidence-mapping-model.test.ts tests/queue-model.test.ts tests/testing-hub-model.test.ts tests/control-journey-model.test.ts tests/signoff-model.test.ts tests/controls-register-model.test.ts tests/engagement-model.test.ts tests/review-model.test.ts tests/home-model.test.ts tests/round-model.test.ts tests/control-workspace-model.test.ts tests/controls-overview-model.test.ts

# Audit integrity, authorization, segregation of duties, approvals, evidence
# traceability, review independence, and database integrity (CRITICAL in
# docs/test-strategy.md). Kept in step with that document.
CRITICAL_PY := $(addprefix $(API_TESTS)/,test_access.py test_actions.py test_agents.py test_approvals.py test_auth.py test_authorization.py test_execution.py test_security.py test_policy.py test_schema.py test_migrations.py test_independence.py test_control_reviews.py test_round_reviews.py test_plan_impact.py test_round_readiness.py test_round_basis.py test_queue.py test_signoff_history.py test_planning_gate.py test_master_plans.py test_evidence_flow.py test_evidence_versions.py test_evidence.py test_engagement_integrity.py test_handoffs.py test_outbound.py test_smtp_mailbox.py test_mailbox.py test_inbound.py test_health.py test_control_journey.py test_test_rounds.py test_workspace.py test_phase_release.py test_test_citations.py test_console_citations.py test_evidence_review.py test_testing_engine.py test_workpapers.py test_google.py test_invitations.py test_demo_requests.py test_evidence_portal.py test_projects.py test_tasks.py test_workflows.py test_failures.py test_durable.py test_agent_execution.py test_provenance.py test_evidence_corpus.py)

test-fast: require-env
	set -a && . ./.env && set +a && $(PYTEST) $(FAST_PY)
	pnpm exec node --test $(FAST_NODE)

test-critical: require-env
	set -a && . ./.env && set +a && $(PYTEST) $(CRITICAL_PY)

BASE ?=
test-changed: require-env
	set -a && . ./.env && set +a && uv run python scripts/changed_tests.py $(if $(BASE),--base $(BASE),)

test: test-critical
	pnpm exec node --test tests/smoke.test.ts tests/shell-model.test.ts tests/project-form.test.ts tests/agent-form.test.ts tests/task-form.test.ts tests/directory.test.ts tests/workflow-model.test.ts tests/follow-ups.test.ts tests/format.test.ts tests/routes.test.ts tests/onboarding-model.test.ts tests/draft-model.test.ts tests/engagement-model.test.ts tests/analysis-model.test.ts tests/testing-model.test.ts tests/console-model.test.ts tests/evidence-model.test.ts tests/sheet-model.test.ts tests/workpaper-model.test.ts tests/evidence-change-model.test.ts tests/round-model.test.ts tests/evidence-preview-model.test.ts tests/review-model.test.ts tests/welcome-model.test.ts tests/sign-in-model.test.ts tests/client-copy.test.ts tests/invite-model.test.ts tests/system-scoping-model.test.ts tests/process-model.test.ts tests/control-context-model.test.ts tests/assistant-model.test.ts tests/evidence-plan-model.test.ts tests/portal-model.test.ts tests/portal-workspace.test.ts tests/engagement-lifecycle.test.ts tests/engagement-close.test.ts tests/engagement-edit.test.ts tests/no-autofill.test.ts tests/clients.test.ts tests/engagements-model.test.ts tests/controls-register-model.test.ts tests/control-workspace-model.test.ts tests/evidence-workspace-model.test.ts tests/controls-overview-model.test.ts tests/engagement-profile.test.ts tests/evidence-flow.test.ts tests/request-details.test.ts tests/evidence-center-model.test.ts tests/recent-engagements.test.ts tests/browser-url.test.ts tests/planning-model.test.ts tests/library-model.test.ts tests/test-basis-model.test.ts tests/evidence-mapping-model.test.ts
	$(COMPOSE) exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "SELECT 1"'

# The entire legacy Python suite, about an hour serially; run only when the owner asks.
test-full: require-env
	set -a && . ./.env && set +a && $(PYTEST) -rsw

ci: lint typecheck test

reset: require-env
	@echo "Deleting the local PostgreSQL volume ai_workforce_postgres_data."
	$(COMPOSE) down -v --remove-orphans

require-env:
	@test -f .env || (echo "Missing .env. Copy .env.example and set the PostgreSQL values in docs/development.md."; exit 1)
