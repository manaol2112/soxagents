# ADR 0007: Baseline quality tools

## Status

Accepted

## Context

Milestone 1.4 needs formatting, linting, type checking, and a smoke test before application code exists. The repository has no Next.js or FastAPI package yet.

## Decision

- Python formatting and linting: Ruff 0.17.0.
- Python type checking: mypy 2.4.0, strict, over `tests/`.
- Python tests: pytest 9.1.1.
- TypeScript formatting and linting: Biome 2.5.15, limited to `tests/**/*.ts`.
- TypeScript type checking: TypeScript 7.0.2 with strict compiler options. Node types are pinned to 24.19.1 so they match the Node.js 24 runtime.
- TypeScript tests: the built-in `node:test` runner. No Jest, Vitest, ESLint, or Prettier.
- CI is `.github/workflows/ci.yml`. It installs the pinned toolchain and runs `make check`, `make install`, `make lint`, `make typecheck`, and `make test`.
- `make test` runs the smoke tests, then starts PostgreSQL and runs `SELECT 1`.

Versions are exact in `pyproject.toml` and `package.json`, and locked in `uv.lock` and `pnpm-lock.yaml`.

## Consequences

- Application frameworks are still not installed.
- A pull request is not merge-ready until the same commands pass locally. GitHub must run the workflow after the repository has a remote; that run is not part of this checkpoint.
- Biome does not format Python, Markdown, or the Makefile. Ruff owns Python style.
