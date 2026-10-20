# Milestone 2 plan: consolidate the auditor experience

Written 20 October 2026, after Milestone 1's acceptance, for the product owner's review
before any Milestone 2 code. It follows the approved design
([workflow-redesign.md](workflow-redesign.md) §2, §5, §6 and the Milestone 2 and 3
outlines in §7) and the owner's Milestone 2 brief: one engagement overview, one canonical
task and approval queue, consistent navigation, no duplicate status derivations,
contextual access to detailed records, clear visibility of agent activity and pending
human decisions; no new workflow engines, agent capabilities or large architectural
changes; nothing legacy removed before its replacement is validated.

## 1. What exists today (inspected)

**Navigation** (`shell-model.ts`): fourteen section ids, thirteen shown as menu items in
two groups. Engagement: Home, Agent console, Controls, Test plans, Project plan, Timeline,
Evidence, Deficiencies, Approvals. Setup: Engagement settings, Library, AI workforce,
Engagements. Each is its own page with its own header, filters and, in several cases,
its own queue.

**Pages and their size.** `planning-view.tsx` (3,568 lines: the Test plans queue with
batch approve and "answer many", the Phases view with batch release, and the per-control
PlanReview with understanding / procedures / attributes / evidence tabs);
`controls-view.tsx` (2,665: the register with its Action center, and the control
workspace, guided and classic); `engagement-view.tsx` (1,968: the dashboard under Home,
Project plan, Timeline, Deficiencies); `evidence-center.tsx` (1,628: requests, mailbox,
files, contacts, request review); `workspace-view.tsx` (the shell, Approvals, Agent
console, Engagements, settings pages).

**Queues and action lists.** Six places compute "what needs a person":

| Where | Source | Kinds |
| --- | --- | --- |
| Home › Do next | API `next_steps` (one pass, role- and stage-aware; W1–W4 kinds added) | setup, plans_* (impact, held, revised, ready, values, describe), evidence and testing kinds |
| Agent console › inbox | API `console._inbox` | approval (outbound message), samples, review sign-off, evidence replies |
| Approvals page | API `approvals` | pending, expired, self-approval cases, by kind |
| Dashboard and console "attention" | client `workflow-model.attentionQueue` | approval, blocked task, evidence, review, mailbox triage, reply, reminder |
| Controls register › Action center | client `controls-overview.ActionCenter` from register rows | by stage |
| Control › classic "Your next action" | client `nextActionOf` (since the acceptance follow-up, led by the canonical next step) | the control's own |

They disagree in small ways (what counts as waiting, who it waits on, what links where),
which is the owner's "duplicate queues" finding.

**Status derivations.** The guided workspace reads the API's journey, finality, readiness
and progress (W1). The classic control view and the register still derive some states on
the client: `lifecycleOf` / `stageState` and the AI-activity lanes in
`control-workspace-model.ts`, `stateOf` in `control-phases.tsx` (now journey-fed for the
testing panels), `currentStage` in `phases-view.tsx`, and the register's stage text.

**Agent activity.** Shown in five forms: Agent console (threads and inbox), the control's
Agent says block (guided), the classic AI-activity lanes, AI workforce settings (agents and
runs), and the control's Activity tab.

## 2. Duplicate or competing interfaces

1. **Queues** (table above): six derivations of one question.
2. **Plan review**: `PlanReview` in `planning-view.tsx` (four tabs, batch approve) and the
   control's Plan step (`evidence-plan-view.tsx` with the test basis card) render the
   same plan differently; approving from either is the same route.
3. **Requests**: `request-review.tsx` (the approval flow), the Evidence center's requests
   tab, and the control's Request step each render a request.
4. **Schedule**: Project plan and Timeline are two pages over the same milestones and
   phases; Home repeats the schedule as a card.
5. **Control status**: the guided frame (journey) and the classic view (client
   derivations) on the same page behind "All details".
6. **Agent activity**: five forms, no single answer to "what did the agents do here, and
   what waits on me".
7. **Approvals**: a page of its own, inline approvals on requests, and queue rows that
   point to the page.

## 3. Components to reuse as they are

Guided workspace: `ControlStepper`, `AgentSays`, `TraceRail`, `ImpactPanel`,
`CoverageForm`, `RoundReviews`, `TestSheetCard`, `TestRounds` (with the basis), the
Workpapers, Review and Findings tabs, receipts. Planning: `PlanReview` sections and the
batch approve / answer-many flows, `PhasesView` and the phase release batch. Evidence:
the Evidence center tabs and `RequestReview`. Home: the journey bar and `NextStepsPanel`.
Reports: `DeficienciesMain`, `PlanMain` and `TimelineMain` (merged into one Schedule
view), the existing exports. Approvals: `ApprovalsMain` rows (as a filtered view of the
queue). Settings: the nine setup step pages, Library, AI workforce.

## 4. Legacy views to hide or retire (each only after its replacement is validated)

| Legacy | Replacement | When hidden | When retired |
| --- | --- | --- | --- |
| Client-side `attentionQueue` and the register's Action center | The canonical queue (M2a) | M2a, once the queue test passes | M2a |
| Agent console inbox | Queue filter "Agent" on Home; console threads stay | M2a | Console page itself: Milestone 3 (companion) |
| Approvals menu item | Home queue filter "Approvals"; inline approvals | M2c (page reachable by redirect) | Milestone 3 |
| Test plans, Project plan, Timeline, Deficiencies menu items | Testing › Plans and Phases; Reports › Schedule and Deficiencies | M2c | Milestone 3 |
| Classic control view ("All details") | The five steps, once the Plan step embeds PlanReview and the Request step the request component | M2d, behind the existing "All details" link until the write-intent test passes | Milestone 3 |
| Client-side status derivations in the classic view and phases view | Journey, readiness, progress (already served) | M2d | With the classic view |

## 5. Proposed navigation and information architecture

Six destinations, as approved: **Home** · **Controls** · **Testing** · **Evidence** ·
**Reports** · **Settings**; the engagement switcher in the top bar; the Agent console
stays reachable (it becomes the companion in Milestone 3). Secondary navigation is tabs
inside a destination: Testing › Plans / Phases / Results / Review; Evidence › Requests /
Mailbox / Files / Contacts; Reports › Deficiencies / Schedule / Status; Settings ›
Engagement / Team / Systems / Templates / Contacts / Library / AI workforce.

Routing keeps `/?organization=…&project=…&section=…`. New sections `testing`, `reports`,
`settings`; old sections redirect with the same record open (the table in
workflow-redesign.md §5): `planning → testing`, `plan, timeline → reports&tab=schedule`,
`deficiencies → reports&tab=deficiencies`, `approvals → overview&filter=approvals`,
`setup → settings`, `library → settings&tab=library`, `agents, tasks →
settings&tab=workforce`. Stored links in emails, portal messages and audit events keep
working; a test opens every stored link shape.

**Desktop (1440).** Left rail with the six destinations and the switcher; a page header
with the destination's tabs; content in one column with the queue or table first and the
record opened in place (the control workspace as today). No second dashboard: Home is
the only overview, its health figures and schedule card read from the same API as the
queue.

**Mobile (390).** The rail collapses to the horizontal scroller already used for the
engagement menu, with the six destinations only; destination tabs become a second
scroller; queue rows stack title, who it waits on, and the one action; tables fold to
cards with the same fields (the register already does this); the control workspace keeps
the layout validated in Milestone 1. Nothing requires hover; every action is a button or
a link.

## 6. Incremental stages

**M2a. The canonical queue.** Extend the API's `next_steps` with the kinds the other
derivations carry and it does not: outbound-message approvals (from `approvals`, with the
requester-never-approves rule intact), mailbox triage and replies, review sign-offs and
note decisions per reviewer role, stopped agent runs (from the run notes), impact
decisions and basis confirmations. Add role, stage and phase filters (API parameters, no
client recomputation). Home's Do next, the console inbox and the register's Action center
read this one list; `attentionQueue` is deleted. Each row says who it waits on (from
`mark_yours` and the engagement roles) and opens the step or record it is about. No new
write route.

**M2b. Testing and the one plan.** `section=testing` with four tabs built from existing
components: Plans (the Test plans queue, filters, batch approve, answer many), Phases
(the phases view and batch release), Results (open result decisions and exceptions across
controls, from `test_sheets` and the journey), Review (the independent review queue from
`review_overview`). The control's Plan step embeds the `PlanReview` sections (one
rendering of a plan); the Request step and the Evidence center share `RequestReview` (one
rendering of a request). Opening a row anywhere opens the control at the right step.

**M2c. Reports, Settings and the six-item navigation.** `section=reports` (Deficiencies,
Schedule as Project plan and Timeline merged with milestone editing kept, Status with the
existing exports) and `section=settings` (the setup step pages as sections, Library, AI
workforce). Navigation to six items; the redirect table; Approvals, Test plans, Project
plan, Timeline and Deficiencies leave the menu but their pages answer by redirect.

**M2d. Retire the client-side derivations and the classic view.** A test enumerates every
write intent the classic tabs offer and asserts the guided steps offer each for a control
in the right state. When it passes: the classic tabs are no longer rendered, `lifecycleOf`
and the lanes model go, the Activity tab becomes an activity drawer on the workspace, and
agent activity has two homes: Agent says on the step and the drawer for the record.

Each stage ships with its screenshots at 1440 and 390, its targeted tests, and the
critical set when the API changes; the owner reviews each before the next.

## 7. Acceptance criteria

- One queue: Home, the console inbox and the register show identical items for the same
  viewer; a test compares the three against `next_steps` for the fixture engagements, and
  every console inbox kind and approvals row appears in the queue with the same link.
- Every action available today on Test plans, Approvals, Project plan, Timeline,
  Deficiencies and the classic control tabs is available in the new destinations or the
  queue; the write-intent test and the §5 mapping checklist pass.
- No page recomputes a control's stage, step or next action on the client; the register,
  the queue and the workspace read the journey and the register row.
- Every old section URL and stored link shape lands on the right record (test).
- Batch approvals record one decision per plan version, as today; the requester never
  approves their own request; a reviewer is offered only controls they may act on.
- Agent activity: on any control, the step's Agent says and the activity drawer say what
  the agents did, what they propose, what waits on a person, and the execution state from
  the run records; nothing is shown as running without a worker.
- Desktop and mobile screenshots of each destination approved by the owner; no
  horizontal overflow at 390; keyboard paths for the rail, the tabs and the queue.

## 8. Risk-based tests

- Python: `test_next_steps` extended with the new kinds and filters; a parity test
  against `console._inbox` and `approvals` (then the inbox reads `next_steps`);
  authorization tests for the queue filters (a filter never widens what a viewer sees);
  redirect tests for the section table; the critical set after each API change.
- Node: model tests for the queue filters and row wording, the destination tabs, the
  redirect mapping, the write-intent enumeration; the existing 703 tests kept green, each
  superseded expectation rewritten with its reason.
- Browser: the acceptance walkthrough's twelve stages replayed through the new navigation
  on the walkthrough database (`ai_workforce_walk`), at 1440 and 390, before M2d retires
  anything; the two smoke tests (impact decision, coverage assessment) rerun.

## 9. Risks and how each is held

| Risk | Mitigation |
| --- | --- |
| A rare testing verb loses its home when the classic tabs go | The write-intent enumeration test gates M2d |
| Queue parity breaks reviewer independence (a reviewer offered the preparer's step) | Rows carry `yours` from `mark_yours`; parity test includes a reviewer and an admin off the team |
| Deep links in emails and audit events break | Redirect table with a test over every stored link shape; `LEGACY_TABS` kept |
| Batch approval semantics change | Batch flows reused, not rewritten; one decision per plan version asserted |
| `next_steps` grows slow on large engagements | It stays one pass per table; measured on the 31-control fixture before and after |
| Mobile density on Testing tables | Cards at 390 as the register does; screenshots gate each stage |
| Scope creep into the companion | The console page stays as is until Milestone 3; M2 only changes what its inbox reads |

## 11. M2a as built

**The queue** (`queue.py`, `GET …/queue`, read under `task.read`). One list of every open
obligation on the engagement, read from the records that already carry it and the rules
that already decide it; nothing new is stored and no item acts. Each item carries a
stable identity (`kind:record id`), its source record, the control, phase and round, the
action and its reason, whose it is (role and assigned names), whether the viewer may act
now (`authorized`, the same rule the action applies: `mark_yours` for a preparer's step,
`project.update` and the requester-never-approves rule for approvals, the engagement
reviewer role with independence for reviews, `viewer_can_decide` for impact assessments),
whether the record is ready and what holds it, whether it holds the engagement up, its
bucket, and where in the guided workspace it is done. Sources: approvals pending; plan
impact assessments pending; open reviews, per review (the control's own and each
round's); rounds whose testing basis is stale or reconstructed; proposed samples, held
until the population is accepted and, for a round, until the round is ready; stopped
tester runs; drafted evidence requests, per request, held for planning or a recipient;
due reminders, per follow-up; replies and unmatched emails, per message; blocked plan
tasks; the engagement's setup while a draft; and each open control's next step from the
register row. Equivalent obligations appear once: a control's next step that restates a
listed record (proposed samples, its own review, a pending assessment, a stale basis) is
dropped, as is a plan task that restates a listed review; separate obligations stay
separate (each round's review, each assessment, each request, each reminder).

**Buckets.** MINE when the viewer may act and the record is ready; BLOCKED when the record
is not ready or no one's; WAITING otherwise, naming the role and the assignees. An
organization admin who is not on the engagement team sees the preparer's and the
reviewer's work as waiting, not as theirs; approvals keep their permission rule.

**Filters** (`bucket`, `stage`, `phase`, `control`) narrow the list on the server after
the viewer's items are computed; they never widen what a viewer sees or may do.

**Consumers.** Home's Do next is the queue, grouped by bucket with filter chips for
responsibility, stage and phase; a step repeated across many controls ("Approve the test
plan" on every unapproved control) is one expandable row with its count. The agent
console's inbox is built from the queue (`console._inbox`), in its older item shape so
the console page and `next_steps` are unchanged. The register's Needs-attention card is
built from the queue's items for the controls shown (`actionCenterFromQueue`), with the
drafted-requests batch kept. The client-side `attentionQueue` and the register's
row-derived `actionCenter` are deleted; the shell's command center and attention card
read the inbox. Every row opens the control's step, the request, the approvals page or
the mailbox, by the link the API gives.

**Validation.** `test_queue.py`: identity and deduplication, owner and authorization by
role (owner, reviewer, admin off the team), readiness blockers, filters that narrow,
tenant isolation, and the inbox as the same list. Node: `queue-model` (parsing, grouping,
filters, links, collapsed rows) and the register's action center from the queue. Two
legacy inbox expectations rewritten for per-request items (`test_evidence_flow`: one item
per drafted request instead of a count). The multi-control demonstration engagement
(`ai_workforce_m2a`: seven controls in different states plus the rest of the library
awaiting plan approval) was built through the API and screenshotted for three viewers
(`docs/review/m2a/`).

## 10. Out of scope for Milestone 2

The Agent Companion panel (Milestone 3), the onboarding wizard and design tokens
(Milestone 4), any new agent capability, any workflow engine change, live model or
outbound-sender validation (tracked separately; see acceptance-walkthrough.md).
