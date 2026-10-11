# AI Employee Workforce

Web platform for a shared AI employee workforce. The first delivery path is IT SOX and IT audit work: plan a project, request evidence, test controls, review the work independently, and report from validated records.

A dedicated shared mailbox is the team's communication channel. The platform may perform routine, explicitly authorized actions on its own. Actions that are sensitive or consequential wait for a person to approve them.

This repository is the application root. The folder name is `soxagents`. Product documents refer to the same codebase as the AI Employee Workforce platform.

## Status

Phase 6, Milestone 6.3 is complete and waiting for review. A PBC request stores its status path. Moving it does not send email.

See `docs/phase-plan.md` for the milestone sequence and `docs/development.md` for local setup.

## Principles

- Business records live in PostgreSQL. Workflow progress lives in a durable workflow engine.
- Models propose plans and interpret ambiguous material. Deterministic code checks permissions, runs approved side effects, and records the result.
- External effects go through registered tools and a central authorization layer.
- Live email sending is off unless it is deliberately configured.
- Development uses mock providers and synthetic data.

## Layout

Directories are added as each milestone needs them. The intended shape is:

```text
├── AGENTS.md
├── README.md
├── Makefile
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── pyproject.toml
├── uv.lock
├── docs/
├── migrations/
├── apps/web/            # Next.js workspace shell
├── services/api/        # FastAPI health and readiness
├── workers/workflow/
├── packages/contracts/
├── migrations/
├── tests/
└── scripts/
```

## Setup

Follow `docs/development.md`. From a machine with the pinned toolchain, run `make check` and `make install`. Copy `.env.example` to `.env` only when a later milestone needs local configuration. Do not commit `.env`.
