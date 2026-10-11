# Phase plan

Implement one milestone at a time. Do not start the next milestone until the current milestone's acceptance criteria pass and the diff is reviewed.

Source specification: AI Employee Workforce Cursor Build Plan.

## Current milestone

**Phase 8, Milestone 8.1b — Agent console.** Complete, pending review. Inserted by the product owner: the platform is driven by agents. See [console.md](console.md).

Decisions for 8.1b, confirmed by the product owner:

- The engagement opens on an agent console. A person tells the agents what they want in plain language, the agents answer from the engagement's records or reply with a plan of concrete actions, and the person confirms. Beside it: what is waiting on the person, and what the agents did. The registers and records stay as reference views.
- Autonomy: reading, answering, redrafting, rereading a file, and proposing samples run at once. Anything that goes to a client, approves, signs off, logs a deficiency, or changes the plan is a step the person confirms. Approvals that need a second person still need that person. The agent never claims a step is done before it is.
- The first tools cover evidence requests, evidence review and sampling, status and questions, and deficiencies and the plan. The agent answers any question about a specific control and the evidence for it, from the stored records and extracted text.
- Every tool is registered with a schema and a risk class. A step runs as the person who confirmed it, through the same authorization and service code as the pages.

**Phase 8, Milestone 8.1 — Test plans and sample selection.** Complete, pending review. See [testing.md](testing.md).

Milestones 7.3 and 7.4 were accepted by the product owner. Phase 7 is complete.

Decisions for Phase 8, confirmed by the product owner:

- Phase 8 runs in four milestones, each reviewed before the next: 8.1 test plans and sample selection, 8.2 the testing engine, 8.3 filled workpapers, 8.4 roll-forward and remediation tasks.
- Samples: the system selects random samples with a recorded seed, sized by the control's frequency and nature. The tester explains the selection, and a person approves it before the sample request goes out. A person can replace a selected item (haphazard or targeted) with a reason.
- Workpapers: a structured, versioned record in the platform, exported to `.xlsx`.
- Exceptions: the testing engine proposes a deficiency (condition, criteria, cause, effect, suggested severity) for a person to log or dismiss. The reviewer approval from 7.2 still applies.

**Phase 7, Milestone 7.4 — Agent first-pass review of screenshots.** Accepted. See [evidence.md](evidence.md#first-pass-review-of-screenshots).

Decisions for 7.4, confirmed by the product owner:

- For each screenshot or scanned page, the evidence coordinator reviews the evidence and tests it against the control's test attributes, then proposes a conclusion. A person signs it off or overrides it. Nothing is concluded without them.
- The review reads the images with Claude vision. The product owner opted the preview firm into model OCR. A firm that stays local gets no visual review, and the file is marked for a person.
- The review checks legibility, the system and environment, the date and period, signs of editing, and whether the screenshot applies to the control being tested.
- When the agent finds a reading issue or an exception, the auditor sees plain feedback on the file, and the agent drafts a follow-up request to the control owner. The draft goes out only after the usual approval.

**Phase 7, Milestone 7.3 — Evidence reading and classification.** Complete, pending review. This is the Phase 7 remainder. See [evidence.md](evidence.md#reading-and-classification).

Milestones 7.1b to 7.2 were accepted by the product owner.

Decisions for 7.3, confirmed by the product owner:

- Text formats and OCR: `.xlsx`, `.csv`, `.txt`, `.docx`, and PDF text are read deterministically. Screenshots, scanned pages, and images in documents are read by OCR.
- OCR is pluggable. Local Tesseract is the default, and images stay in the firm. A firm's owner or admin can opt into model OCR, which sends page images to the model provider, with local OCR as the fallback.
- Classification uses Claude on a bounded, redacted excerpt, with reviewed keyword rules as the fallback, as in 7.1d.
- The agent suggests the evidence kind, the coverage of each requested item, and the gaps. A person confirms the kind. Nothing changes the request status: a person still marks it received, as in 6.5.

**Phase 7, Milestone 7.2 — Engagement workspace.** Accepted. See [workspace.md](workspace.md).

Decisions for 7.2, confirmed by the product owner:

- The engagement navigation is organized around the audit: Dashboard (replacing Command center), Controls, Project plan (replacing the flat Work board), Timeline, Evidence, Deficiencies, and Approvals. Setup moves under Engagement settings.
- Kickoff lays out the standard SOX calendar from the kickoff date and the period end: planning, walkthroughs, evidence, interim testing, remediation retesting, roll-forward and year-end, and reporting, with milestones. The lead can change dates; tasks follow their phase.
- Deficiencies follow the SOX workflow: condition, criteria, cause, effect, design or operating, likelihood and magnitude, severity, compensating controls, remediation, and retest. The engagement reviewer approves significant deficiencies, material weaknesses, and closures, never their own request.
- Deficiency logging and severity evaluation pull forward the Phase 9 slice the workspace needs. Testing agents logging exceptions stays in Phase 8.

**Phase 7, Milestone 7.1f — Client terms mapped by an agent.** Complete, pending review. Inserted by the product owner. Do not start the next milestone until 7.1b to 7.1f are reviewed.

- After upload, an agent maps the client terms that are still blank, from the controls that use each term, with a reason per term. Remap with agent redoes every term. Claude or the reviewed rules, as in 7.1d. A person reviews the mapping before import.
- Background agent jobs commit each step on its own, so a claim is visible at once and no row stays locked during a model call.

**Phase 7, Milestone 7.1e — In-scope systems from the RCM.** Complete, pending review. Inserted by the product owner. Do not start the next milestone until 7.1b to 7.1e are reviewed. See [onboarding.md](onboarding.md#client-rcm-upload).

Decisions for 7.1e:

- After an upload, an agent identifies the in-scope systems from the systems column and the control text, in the background, with Claude or a reviewed rules list (the same model and fallback as 7.1d).
- A system is kept only when the RCM names it. A person confirms the list (rename, layer, leave out) in the import preview. Importing creates the systems as in-scope applications and tags each control with its own systems.

**Phase 7, Milestone 7.1d — Drafted evidence requests.** Complete, pending review. Inserted by the product owner. Do not start the next milestone until 7.1b, 7.1c, and 7.1d are reviewed. See [pbc.md](pbc.md#drafting-from-the-control).

Decisions for 7.1d, confirmed by the product owner:

- After kickoff, the evidence coordinator drafts every PBC request from its control in the background.
- Claude is the first live model, through the existing adapter, with a rules drafter when no model is configured or a model draft fails its checks. Control and RCM text is sent to the model provider.
- The first request per control asks for the population (or configuration, or the key report) and walkthrough and design evidence. Sample evidence is requested after sample selection, in Phase 8.
- One request per control, as before. Every request still needs a person's approval before it is sent.

**Phase 7, Milestone 7.1c — Client RCM upload.** Complete, pending review. Inserted by the product owner as part of onboarding. Do not start the next milestone until 7.1b and 7.1c are reviewed. See [onboarding.md](onboarding.md#client-rcm-upload).

Decisions for 7.1c, confirmed by the product owner:

- The RCM is format-agnostic. A team uploads the client's own `.xlsx` or `.csv`. Columns are auto-suggested from reviewed synonyms and this engagement's own earlier mappings, never another engagement's, and a person confirms them. Every other column is kept under the client's heading.
- Each engagement chooses the standard library or an upload. Either replaces the other until kickoff.
- Area becomes the client's own term. For area, frequency, and nature, a person maps each distinct client term once to a standard value, which drives the tester, sample size, and template. The client's term is shown next to it.
- No model reads the file. Parsing is deterministic and values-only.
- The RCM is not limited to IT. There are 15 standard areas: the three ITGC areas, application controls (ITAC), key reports and IPE, entity-level controls, eight business cycles (order to cash, procure to pay, record to report, treasury, hire to retire, inventory, fixed assets, tax), and other business process.
- One new standard worker, the business process controls tester, tests every area outside the three ITGC areas. A person can choose another tester per control.
- The standard library adds 32 starter business process controls next to the 16 ITGC controls. The team chooses which areas to load. The new control wording waits for product owner review.

**Phase 7, Milestone 7.1b — Engagement onboarding.** Complete, pending review. Inserted by the product owner. See [onboarding.md](onboarding.md).

Milestone 7.1 was accepted by the product owner.

Decisions for 7.1b, confirmed by the product owner:

- Every new engagement opens a guided setup: scope and period, team and access, RCM, workpaper templates, PBC plan, then review and start.
- It pulls forward only the Phase 8 slice onboarding needs: the engagement RCM and the workpaper templates. Testing, filled workpapers, and conclusions stay in Phase 8.
- The RCM starts from a reviewed standard ITGC library in code, which each engagement tailors.
- Workpaper templates are reviewed standard templates in code, previewed with the engagement's own controls.
- Start engagement requires every step to be ready. The planner proposes the kickoff plan from the RCM, a person approves it, and approval activates the engagement and creates the tasks and draft PBC requests. Nothing is emailed without the usual approval.

Milestone 6.7 was accepted by the product owner. Extraction and classification stay later in this phase.

Decisions for 7.1, from [ADR 0005](decisions/0005-object-storage.md) and the attachment content deferred in Phase 6:

- File bytes go to the S3 API. Compose runs MinIO for local development. While the S3 settings are empty, the API uses the mock store, including in tests.
- The application generates the object key. A file name is a label, never a path.
- A person stores the bytes for one inbound attachment. The service hashes them. When the mail already declared a hash, the bytes must match it. Storing the same bytes again returns the same record.
- The custody record and the stored object are immutable. A download checks the hash before it returns the bytes.
- Nothing is extracted, classified, or passed to a model.

Milestone 6.5a was accepted by the product owner.

Decisions for 6.6, confirmed by the product owner:

- A durable timer marks each reminder due. A person requests approval, a different person approves the exact message, and only then can it be sent. Nothing goes out unattended.
- Cadence comes from the request's own follow-up fields: the next reminder falls due `follow_up_after_days` after the last contact (the request, the last reminder, or the last matched reply).
- After `max_follow_ups` reminders, the next missed interval marks the request escalated for a person instead of sending more.
- Reminders stop as soon as the request leaves sent, waiting, partially received, or overdue. An open reminder is cancelled, and an in-flight send is refused before it reaches the mailbox.

Milestone 6.5 was accepted by the product owner. Agent definitions were manual, and nothing staffed agents onto an engagement, so tasks could not be assigned to an agent. 6.5a closes that gap.

Decisions for 6.5a, confirmed by the product owner:

- A standard SOX workforce is defined in code and reviewed like email templates: planner, evidence coordinator, three ITGC testers (access, change, operations), independent reviewer, reporting analyst.
- The workforce is a standard part of every firm and engagement, with no manual setup in any environment. The deploy step syncs the roster; database triggers install it for new firms and staff new engagements. (This replaced an earlier install-and-staff button design before it was released.)
- Standard workers are locked and platform-managed. An owner or admin can only disable or re-enable one for the firm. Roster changes reach every firm on deploy, and a firm's disable choice is kept.
- Only owners and admins create or edit custom agents. Project managers can still assign agents to tasks. Standard keys are reserved.
- Each worker gets only the registered actions its job needs. Sensitive actions still need approval. No worker may modify permissions or send external mail.
- Model references are logical tiers, `reasoning` and `standard`, resolved to real models later through configuration.

Decisions for 6.5, confirmed by the product owner:

- A matched reply is recorded and flagged for review. It never changes the request status. A person marks a request partially received or received.
- A reply matches only by thread id or the `[PBC-…]` subject reference, and only when the sender is the request's recipient. Anything else goes to an unmatched queue for a person to assign.
- Store the plain-text body with markup removed, plus attachment metadata (name, size, type, hash). Attachment bytes are stored by Milestone 7.1.

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

Phase 6 acceptance: a request is sent once from its approved template, a timeout reconciles without a second message, repeating a send or a reply returns the same record, a reply never changes the request by itself, and a reminder is approved, sent in the original thread, and stopped when the request is resolved.

| Milestone | Scope | Status |
| --- | --- | --- |
| 6.1 Email provider abstraction | Mock operations for send, draft, read, search, attachments, notifications, and reconcile | Complete |
| 6.2 Microsoft 365 configuration | Shared mailbox configuration. Live send stays disabled | Complete |
| 6.3 PBC data model | Request records and allowed status transitions | Complete |
| 6.4 Outbound messages | Approved templates, idempotent delivery records | Complete |
| 6.5 Inbound email processing | Notifications, matching, and untrusted content | Complete |
| 6.5a Standard workforce | Built-in SOX worker roster, install per firm, staff per engagement | Complete |
| 6.6 Follow-up scheduling | Durable reminders that stop when the request is resolved | Complete |
| 6.7 Test scenarios | Send, timeout, duplicate, reply, and reminder cases | Complete |

## Phase 7 — Evidence ingestion and chain of custody

Objective: store evidence bytes privately, with a hash the service computes, and keep that record immutable. Extraction and classification come after ingestion.

| Milestone | Scope | Status |
| --- | --- | --- |
| 7.1 File ingestion | S3-compatible storage, mock store, and an immutable custody record for an inbound attachment | Complete |
| 7.1b Engagement onboarding | Guided setup: scope, team, RCM from the ITGC library, workpaper templates with previews, PBC plan, approved kickoff plan | Complete |
| 7.1c Client RCM upload | Upload any client RCM (xlsx or csv), confirm column and term mappings, keep client columns, import as the engagement RCM. Business process areas, a business process tester, and a starter business library | Complete |
| 7.1d Drafted evidence requests | The evidence coordinator drafts each kickoff PBC request from its control, with Claude or a rules fallback, in the background | Complete |
| 7.1e In-scope systems from the RCM | An agent identifies the systems in an uploaded RCM, a person confirms them, and import tags them as in-scope applications | Complete |
| 7.1f Client terms mapped by an agent | The agent maps blank client terms from their controls, with reasons, and remaps on request | Complete |
| 7.2 Engagement workspace | Dashboard, controls register, project plan by phase, timeline with the standard SOX calendar, and the deficiency register with reviewer approval | Complete |
| 7.3 Evidence reading and classification | Read stored files (spreadsheets, documents, PDFs, and images by pluggable OCR), suggest the evidence kind and request coverage with Claude or rules, and a person confirms | Complete |
| 7.4 Agent first-pass review of screenshots | Claude reviews each screenshot (legibility, system, date, editing, applicability) and tests it against the control's attributes, drafts a follow-up when something is wrong, and a person signs off | Complete |

## Phase 8 — SOX testing and workpapers

Objective: test each in-scope control from its evidence, with agents doing the first pass and people deciding, and record the work in workpapers. The control inventory and workpaper templates were pulled forward into Phase 7.

| Milestone | Scope | Status |
| --- | --- | --- |
| 8.1 Test plans and sample selection | Each control's test plan, population checks, seeded random sample proposal, person approval and replacement, and a drafted sample evidence request | Complete, pending review |
| 8.1b Agent console | The engagement home: ask the agents in plain language, they answer from the records or propose actions, and a person confirms sensitive steps | Complete, pending review |
| 8.2 Testing engine | The tester tests each sample's evidence against the attributes, for any file type, and proposes deficiencies from exceptions | Not started |
| 8.3 Workpapers | Filled, versioned workpapers with preparer sign-off and `.xlsx` export | Not started |
| 8.4 Roll-forward and remediation | Tasks added once interim results are known | Not started |

## Later phases

Do not implement these until their phase is accepted.

| Phase | Objective |
| --- | --- |
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

See [workforce.md](workforce.md) for the standard workforce roster.

Accepted in Milestone 2.1: [SQL migrations](decisions/0008-sql-migrations.md). Conventions are in [data-model.md](data-model.md).
