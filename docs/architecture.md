# Architecture and module map

What the system is made of and which area owns what, taken from the code on 17 November
2026. Read it to find where a change belongs before writing one
(`docs/engineering-standards.md`, section 1). Keep it true: a change that moves a
responsibility updates this file in the same commit.

## Shape

- **API:** FastAPI with psycopg and plain SQL, in `services/api/ai_workforce_api` (about
  210 modules, 480 routes). `main.py` `create_app` registers every route group.
- **Database:** PostgreSQL. The schema changes only through numbered SQL files in
  `migrations/`, applied by `migrate.py` (one transaction per file, checksummed).
- **Web:** Next.js in `apps/web`. A screen's logic lives in `src/<name>-model.ts`; the
  `.tsx` beside it renders. Handlers under `app/workspace/*/route.ts` forward the browser's
  request and session cookie to the API.
- **Files:** S3-compatible object storage through `storage.py`. With no bucket
  configured, file bytes are rows of the database.
- **Background work:** see `docs/background-work.md` and `docs/operations.md`.
- **Outside services, one module each:** the model provider (`model_providers.py`),
  Temporal (`durable.py`, `durable_workflow.py`), object storage (`storage.py`), SMTP
  (`smtp_mailbox.py`). Nothing else imports their libraries.

## Rules of the structure

- **Authorization is one function.** `authorization.py` `authorize(principal, action,
  organization, project)`. Every service function that reads or writes tenant data calls
  it before doing anything else; the tenant comes from the path and the person's
  membership, never from the request body. See `docs/authorization.md`.
- **A route does not hold business rules.** Rules live in the service function, so the
  web route and the agent console, which calls the same functions, obey the same checks.
- **A side effect leaves through its owner:** email through `outbound.py`, a model call
  through `models.py` and `provenance.py`, a file through `storage.py`.
- **Work for later is a row first.** The request writes a queued record and hands its id
  over after commit (`after_commit.py`). State lives in the database, not in memory.
- **Consequential actions are recorded** in `audit_events`, which the database will not
  update or delete.
- **Untrusted text is data.** Emails, evidence, documents and model output go into prompts
  through `prompt_data.py` and come back through a schema.

## Who owns what

"Shared writers" names tables several areas write; a change there is at least Medium risk.

| Area | Main API modules | Web | Shared writers to watch |
| --- | --- | --- | --- |
| Identity and tenancy | `auth`, `authorization`, `identity`, `entra`, `google`, `invitations`, `clients`, `projects`, `subscriptions` | sign-in, shell | `projects` (7 modules) |
| Onboarding and scope | `onboarding`, `scope_setup`, `scope_changes`, `system_setup`, `system_scoping`, `rcm_*` | onboarding, setup, systems | `engagement_controls` (16 modules) |
| Library and definitions | `controls`, `definition_registry`, `definitions_*`, `library_*`, `standard_adoption`, `methodology` | library | `control_attributes` |
| Control understanding | `context_routes`, `control_context`, `understanding_*`, `process_narrative`, `walkthrough_*`, `question_review`, `prior_year` | understanding, control context | |
| Attributes | `control_attributes`, `attribute_*`, `criteria_history` | attributes | `control_attributes` (9 modules) |
| Test planning | `evidence_planning`, `evidence_plans`, `master_plans`, `shared_plans`, `plan_impact`, `phase_release`, `sampling` | planning | |
| Requests and email | `pbc`, `pbc_drafting`, `outbound`, `followups`, `evidence_groups`, `control_send`, `request_details`, `mailbox`, `smtp_mailbox`, `inbound` | evidence requests | `pbc_requests` (15 modules; allowed status changes are in `pbc.py`) |
| Client portal | `evidence_portal`, `portal_workspace` | `app/portal` | |
| Evidence intake and reading | `evidence`, `evidence_intake`, `evidence_versions`, `evidence_wizard`, `evidence_ocr`, `evidence_extraction`, `evidence_classify`, `evidence_analysis`, `evidence_review`, `storage` | evidence wizard, evidence dialog | `evidence_matches` (6 modules) |
| Evidence assurance | `evidence_assurance`, `assurance_*`, `evidence_annotations`, `evidence_findings`, `evidence_mapping`, `file_reliability`, `sample_traces` | design evidence | |
| Testing and rounds | `testing_engine`, `test_sheets`, `control_tests`, `test_rounds`, `round_readiness` | testing, rounds | `test_items` (2 modules) |
| Conclusions and workpapers | `design_conclusions`, `design_points`, `design_workpaper`, `control_conclusions`, `workpaper_*` | design workpaper | `workpapers` (6 modules) |
| Independent review | `control_reviews`, `design_review_requests`, `independence`, `control_challenges` | review | |
| Console, agents, models | `console`, `console_tools`, `agents`, `workforce`, `models`, `model_providers`, `provenance`, `prompt_data` | console | Calls other areas' service functions |
| Background work | `durable`, `durable_workflow`, `after_commit`, the local worker in `pbc_drafting` | | |
| Approvals and policy | `approvals`, `actions`, `policy`, `execution` | approvals | `approvals` (5 modules) |
| Workspace and reporting | `workspace`, `control_journey`, `next_steps`, `queue`, `evidence_center`, `reports`, `exports`, `engagement_close`, `tasks` | workspace, controls, home | `tasks` (7 modules) |
| Demo and trial | `demo*`, `demo_northstar/` | demo, tour | Writes most tables as fixtures |

## Words with more than one meaning

- **Follow-up** is four things, each on purpose: reminder timers (`followups.py`), the
  rules for what a set of evidence still lacks (`assurance_followups.py`), accepted
  findings sent as a message (`evidence_findings.py`), and the reminder send route
  (`outbound.py`). Since 18 November 2026 no follow-up is drafted for a single file.
- **Scheduler** is whichever background worker is configured. Code that queues work
  takes it as a parameter; both workers must offer the same jobs.

## Known structural debt

Recorded so nobody mistakes it for the intended design, and nobody "fixes" it in passing.
Each needs its own approved change.

- API modules have no layers: many imports are deferred inside functions to avoid cycles.
- The two background workers do not run identical follow-on work.
- The web reads API responses with hand-written parsers; only a few route families have
  contract tests.
- A few files are very large (`evidence_plans.py`, `planning-view.tsx`).
- `docs/phase-plan.md` is the full history; its "current milestone" section is long.
