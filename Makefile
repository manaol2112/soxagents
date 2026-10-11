NODE_VERSION := 24.21.0
PNPM_VERSION := 12.10.1
PYTHON_VERSION := 3.14.8
UV_VERSION := 0.13.0

COMPOSE := docker compose

.PHONY: help toolchain check install start stop status format lint typecheck api web migrate test ci reset

help:
	@echo "make toolchain  Show pinned Node.js, pnpm, Python, and uv versions"
	@echo "make check      Fail if the local toolchain does not match the pins"
	@echo "make install    Install locked dependencies with pnpm and uv"
	@echo "make start      Start PostgreSQL, Temporal, and MinIO, then migrate"
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

web:
	pnpm --filter web dev

test: migrate
	set -a && . ./.env && set +a && uv run pytest
	pnpm exec node --test tests/smoke.test.ts tests/shell-model.test.ts tests/project-form.test.ts tests/agent-form.test.ts tests/task-form.test.ts tests/directory.test.ts tests/workflow-model.test.ts tests/follow-ups.test.ts tests/format.test.ts tests/routes.test.ts tests/onboarding-model.test.ts tests/draft-model.test.ts tests/engagement-model.test.ts tests/analysis-model.test.ts tests/testing-model.test.ts tests/console-model.test.ts
	$(COMPOSE) exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "SELECT 1"'

ci: lint typecheck test

reset: require-env
	@echo "Deleting the local PostgreSQL volume ai_workforce_postgres_data."
	$(COMPOSE) down -v --remove-orphans

require-env:
	@test -f .env || (echo "Missing .env. Copy .env.example and set the PostgreSQL values in docs/development.md."; exit 1)
