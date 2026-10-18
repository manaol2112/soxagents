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

.PHONY: help toolchain check install start go awake stop status format lint typecheck api web migrate test ci reset

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
	@echo "make test       Run smoke tests, then SELECT 1 against PostgreSQL"
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

test: migrate
	set -a && . ./.env && set +a && uv run pytest
	pnpm exec node --test tests/smoke.test.ts tests/shell-model.test.ts tests/project-form.test.ts tests/agent-form.test.ts tests/task-form.test.ts tests/directory.test.ts tests/workflow-model.test.ts tests/follow-ups.test.ts tests/format.test.ts tests/routes.test.ts tests/onboarding-model.test.ts tests/draft-model.test.ts tests/engagement-model.test.ts tests/analysis-model.test.ts tests/testing-model.test.ts tests/console-model.test.ts tests/evidence-model.test.ts tests/sheet-model.test.ts tests/workpaper-model.test.ts tests/evidence-change-model.test.ts tests/round-model.test.ts tests/evidence-preview-model.test.ts tests/review-model.test.ts tests/welcome-model.test.ts tests/sign-in-model.test.ts tests/client-copy.test.ts tests/invite-model.test.ts tests/system-scoping-model.test.ts tests/process-model.test.ts tests/control-context-model.test.ts tests/assistant-model.test.ts tests/evidence-plan-model.test.ts tests/portal-model.test.ts tests/portal-workspace.test.ts tests/engagement-lifecycle.test.ts tests/engagement-close.test.ts tests/engagement-edit.test.ts tests/no-autofill.test.ts tests/clients.test.ts tests/engagements-model.test.ts tests/controls-register-model.test.ts tests/control-workspace-model.test.ts tests/evidence-workspace-model.test.ts tests/controls-overview-model.test.ts tests/engagement-profile.test.ts tests/evidence-flow.test.ts tests/request-details.test.ts tests/evidence-center-model.test.ts tests/recent-engagements.test.ts tests/browser-url.test.ts tests/planning-model.test.ts
	$(COMPOSE) exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "SELECT 1"'

ci: lint typecheck test

reset: require-env
	@echo "Deleting the local PostgreSQL volume ai_workforce_postgres_data."
	$(COMPOSE) down -v --remove-orphans

require-env:
	@test -f .env || (echo "Missing .env. Copy .env.example and set the PostgreSQL values in docs/development.md."; exit 1)
