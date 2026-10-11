# Phase plan

Implement one milestone at a time. Do not start the next milestone until the current milestone's acceptance criteria pass and the diff is reviewed.

Source specification: AI Employee Workforce Cursor Build Plan.

## Current milestone

**Phase 6, Milestone 6.4 — Outbound messages.** Complete, pending review.

Milestone 6.3 was reviewed and accepted, together with the engagement workspace redesign. Do not start Milestone 6.5 until this checkpoint is reviewed.

## Phase 1 — Repository foundation

Objective: a reproducible development environment and recorded architecture decisions before business functionality.

| Milestone | Scope | Status |
| --- | --- | --- |
| 1.1 Inspect and initialize | `AGENTS.md`, `README.md`, setup guide, `.env.example`, `.gitignore` | Complete |
| 1.2 Select and pin dependencies | Node.js LTS, Python, lockfiles, task commands, decision records | Complete |
| 1.3 Local development environment | Docker Compose for PostgreSQL, health checks, start/stop/status/test/reset | Complete |
| 1.4 CI and baseline quality | Format, lint, typecheck, tests, CI workflow, smoke test | Complete |

## Phase 2 — Database, identity, and core data model

| Milestone | Scope | Status |
| --- | --- | --- |
| 2.1 Database conventions | UTC timestamps, UUID keys, migrations, transaction boundaries | Complete |
| 2.2 Initial tables | Organizations, users, projects, agents, tasks, audit events | Complete |
| 2.3 Authentication | Entra ID sessions | Complete |
| 2.4 Authorization | Roles and tenant isolation | Complete |
| 2.5 Database and access tests | Constraints, isolation, concurrency | Complete |

Phase 1 acceptance: a fresh clone follows the setup guide, required services report healthy, baseline checks pass, no credentials or sensitive evidence are committed, and architecture decisions plus unresolved trade-offs are documented.

Phase 2 acceptance: users can authenticate, protected routes reject anonymous requests, authorization is enforced in the API, tenant-isolation tests pass, migrations apply from an empty database, and business records live in PostgreSQL.

## Phase 3 — Workforce dashboard and task management

| Milestone | Scope | Status |
| --- | --- | --- |
| 3.1 Application shell | Navigation, project selector, account menu, notifications, loading and access states | Complete |
| 3.2 Project management | Create, edit, pause, and archive projects | Complete |
| 3.3 Agent registry | Agent definitions without stored secrets | Complete |
| 3.4 Task management | Assignment, dependencies, and status transitions | Complete |
| 3.5 Interface | Project overview, task board, and agent directory | Complete |

## Phase 4 — Workflow engine and AI orchestration

Objective: reliable planning and delegation. Models propose; software executes.

| Milestone | Scope | Status |
| --- | --- | --- |
| 4.1 Workflow interface | Start, status, cancel, pause, resume, history, signal, and policy retry | Complete |
| 4.2 Durable execution | Temporal adapter, timers, and reconciliation | Complete |
| 4.3 Model adapter | Provider-neutral generation and schema checks | Complete |
| 4.4 Manager agent | Validated task plans without tool execution | Complete |
| 4.5 Structured handoffs | Versioned worker results | Complete |
| 4.6 Failure handling | Timeout, duplicate start, crash, and retry exhaustion | Complete |

## Phase 5 — Approvals and action authorization

Objective: centralized policy enforcement before any external system is connected.

| Milestone | Scope | Status |
| --- | --- | --- |
| 5.1 Action catalog | Registered action types, risk, validation, and approval requirements | Complete |
| 5.2 Policy engine | Deterministic allow and deny rules | Complete |
| 5.3 Approval workflow | Approval bound to the exact action parameters | Complete |
| 5.4 Authorized execution | Execute only after permission and approval checks | Complete |
| 5.5 Security tests | Bypass, expiry, rejection, and race coverage | Complete |

## Phase 6 — Shared mailbox and PBC automation

Objective: reliable two-way email operations and evidence-request follow-ups. The mock provider comes first. Live send stays disabled.

| Milestone | Scope | Status |
| --- | --- | --- |
| 6.1 Email provider abstraction | Mock operations for send, draft, read, search, attachments, notifications, and reconcile | Complete |
| 6.2 Microsoft 365 configuration | Shared mailbox configuration. Live send stays disabled | Complete |
| 6.3 PBC data model | Request records and allowed status transitions | Complete |
| 6.4 Outbound messages | Approved templates, idempotent delivery records | Complete, pending review |
| 6.5 Inbound email processing | Notifications, matching, and untrusted content | Not started |
| 6.6 Follow-up scheduling | Durable reminders that stop when the request is resolved | Not started |
| 6.7 Test scenarios | Send, timeout, duplicate, reply, and reminder cases | Not started |

## Later phases

Do not implement these until their phase is accepted.

| Phase | Objective |
| --- | --- |
| 7 | Evidence ingestion, extraction, classification, and chain of custody |
| 8 | SOX control inventory, test definitions, testing engine, workpapers |
| 9 | Independent review, review notes, and remediation |
| 10 | Reporting from validated records and an end-to-end synthetic project |
| 11 | Security, observability, recovery, cost controls, and a limited release |

## Decisions

Accepted in Milestone 1.2: [runtime and package managers](decisions/0001-runtime-and-package-managers.md).

Accepted in Milestone 1.3: [local PostgreSQL](decisions/0006-local-postgresql.md).

Accepted in Milestone 1.4: [baseline quality tools](decisions/0007-baseline-quality-tools.md).

Accepted before Phase 2. Implementation still waits for the milestone named in each record:

- [Temporal](decisions/0002-workflow-engine.md), adapter in Milestone 4.2
- [In-repository orchestration, not LangGraph](decisions/0003-agent-orchestration.md), Milestone 4.4
- [Microsoft Entra ID](decisions/0004-authentication-provider.md), Milestone 2.3
- [S3 API, MinIO locally](decisions/0005-object-storage.md), Milestone 7.1

Accepted in Milestone 2.1: [SQL migrations](decisions/0008-sql-migrations.md). Conventions are in [data-model.md](data-model.md).
