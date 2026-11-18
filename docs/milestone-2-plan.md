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

## 12. Obligations and their one queue item (M2b)

Every actionable obligation the platform records, the record or rule it is read from, the
one queue item that represents it (`kind` / `obligation`), whose it is, how it is
bucketed, and where it is done. "Step" means the guided control workspace's step. An
obligation never has two items: where a control's next step restates a listed record,
the record's item stands and the step is dropped (`_STEP_TO_KIND`); a round's window
item is dropped when its samples, its basis or the control's step on that phase carries
the hold; a plan task that restates a listed review is dropped. `test_queue.py` checks
the identities, the owners and the buckets on fixture engagements; the scale engagement
(§13) checks that no identity repeats.

| Obligation | Read from | Item (`kind` / `obligation`) | Owner | Bucket | Where |
| --- | --- | --- | --- | --- | --- |
| Finish setting up and launch | `projects.status = DRAFT` | `setup` / SETUP | Owner | MINE or WAITING | Setup |
| Plan the evidence; reconcile a kickoff draft | the control's next step (`workspace.step_of`) | `control-step` / EVIDENCE_PLAN | Preparer | MINE or WAITING | Plan step |
| Approve the test plan (first or revised) | next step; `readiness_state` | `control-step` / PLAN_APPROVAL | Preparer | MINE or WAITING; BLOCKED while an impact assessment or a conflict holds it | Plan step |
| Settle the attributes | next step | `control-step` / PLAN_ATTRIBUTES | Preparer | MINE or WAITING | Plan step |
| Release a phase | next step (`release_ready`) | `control-step` / PHASE_RELEASE | Approver | MINE or WAITING; never upcoming, the release is the action | Plan step |
| Approve a drafted evidence request (the exact message) | `pbc_requests.status = DRAFT`, one per request | `request-draft` / REQUEST_DRAFT_APPROVAL | Approver | MINE or WAITING; BLOCKED while held for planning or a recipient | Request step, request open |
| Approve an outbound send or another registered action | `approvals.decision = PENDING` | `approval` / SEND_APPROVAL or ACTION_APPROVAL | Approver, never the requester | MINE or WAITING | Approvals |
| Submit or send a request | next step | `control-step` / EVIDENCE_REQUEST | Preparer | MINE or WAITING | Request step |
| Evidence awaited from the client; overdue to chase | next step, `overdue` | `control-step` / EVIDENCE_RECEIPT | Client; the chase is the team's | WAITING; the chase MINE for the preparer | Request step (the inbox's `late` kind) |
| Approve a due reminder | `pbc_follow_ups.status = DUE` | `reminder` / REMINDER_APPROVAL | Approver | MINE or WAITING | Evidence, requests |
| Read a reply; match an unmatched email | `inbound_messages` | `reply` / REPLY_TRIAGE | Preparer | MINE or WAITING | Evidence, mailbox |
| Decide the sufficiency of reviewed evidence | `evidence_reviews.decision IS NULL` (READY or NEEDS_PERSON) | `evidence-review` / EVIDENCE_SUFFICIENCY | Preparer | MINE or WAITING | Evidence, mailbox, request open |
| Accept or confirm the population | next step | `control-step` / POPULATION | Preparer | MINE or WAITING | Test step |
| Approve the proposed samples | `control_tests.status = PROPOSED` | `samples` / SAMPLES_APPROVAL | Preparer | MINE or WAITING; BLOCKED until the population is accepted or the round is ready; UPCOMING when the retest window alone holds it | Test step |
| Testing queued for the tester; a round's testing in hand | next step (actor AGENT, or "Finish the … testing") | `control-step` / TESTING_RUN | Agent, or the preparer | The agent's turn is UPCOMING with a worker and BLOCKED ("Automation unavailable") without | Test step |
| A tester run that stopped | `test_sheets.run_note` | `run-stopped` / TESTING_RUN_STOPPED | Preparer | MINE or WAITING | Test step |
| Decide open results; sign off the testing | next step (`sheet_left`) | `control-step` / TESTING_DECISION, TESTING_SIGNOFF | Preparer | MINE or WAITING | Test and Conclude steps |
| Log or dismiss the proposed deficiency | next step | `control-step` / DEFICIENCY_LOG | Preparer | MINE or WAITING | Conclude step |
| Prepare the workpapers | next step | `control-step` / WORKPAPERS | Preparer | MINE or WAITING | Conclude step |
| A workpaper draft that stopped | `workpapers.draft_note = DRAFT_FAILED` | `draft-stopped` / WORKPAPER_DRAFT_STOPPED | Preparer | MINE or WAITING | Plan step (design) or Conclude step |
| The independent review of a control or a round | `control_reviews.status = OPEN`, one per review, with its notes and re-performance | `review` / CONTROL_REVIEW or ROUND_REVIEW; REPERFORMANCE_STOPPED when the agent's re-performance did not finish | Reviewer, or the preparer to answer notes; the agent while queued | MINE or WAITING; a queued re-performance UPCOMING with a worker, BLOCKED without | Review step |
| Decide the impact of a plan revision on signed-off results | `plan_impact.assessments` PENDING | `impact` / IMPACT_ASSESSMENT | Reviewer (`viewer_can_decide`) | MINE or WAITING; holds the engagement | Plan step |
| Assess whether a signed-off review covers later work | `control_journey` coverage gaps, against the latest signed review | `coverage` / COVERAGE_ASSESSMENT | Reviewer, independence applied | MINE or WAITING; holds the engagement | Review step |
| Confirm a round's testing basis | `test_rounds.basis` stale or reconstructed | `round-basis` / ROUND_BASIS | Preparer | MINE or WAITING; holds the engagement | Test step |
| A round open whose window or release has not come | `round_readiness` holds ("must operate until", "Not released yet") | `round` / ROUND_WINDOW | No one | UPCOMING | Test step |
| Start a deficiency's remediation | `deficiencies.status = OPEN` | `deficiency` / DEFICIENCY_REMEDIATION | Preparer | MINE or WAITING | Conclude step (Deficiencies when no control) |
| Remediation in progress | `status = REMEDIATION_IN_PROGRESS` | `deficiency` / DEFICIENCY_REMEDIATION | Client (the remediation owner named) | WAITING, an ordinary wait | Conclude step |
| Retest a remediated deficiency | `status = READY_FOR_RETEST`: the open retest round's items; without a round, `deficiency` / DEFICIENCY_RETEST | Preparer | MINE or WAITING | Test or Conclude step |
| What remains before a concluded control is final | `control_journey.finality` reasons when no step is open | `finality` / FINAL_COMPLETION; when a step is open, the step item carries the first reason | No one | UPCOMING | Review step |
| A plan task blocked or ready for review | `tasks.status` BLOCKED, REVIEW | `task` / TASK_BLOCKED, TASK_REVIEW (dropped when the control's review is listed) | Preparer | BLOCKED; MINE or WAITING | Project plan |

Not represented as queue items, by design or because no record carries an obligation
yet: an evidence file being read or analysed (the agents' work, shown on the file, not a
person's obligation); the client's own uploads (the WAITING items above are the team's
view of them); organization-level work (library governance, invitations, engagement
creation); and the engagement's close-out and reporting, which Milestone 2c takes up
with Reports. Roll-forward testing that is not yet released appears as the control's
upcoming completion item until the phase is released, then as its own steps.

**Buckets.** MINE: the viewer may act and the record is ready. WAITING: another person's
turn (the client, the preparer, the reviewer, an approver), an ordinary wait, never a
blocker. BLOCKED: a prerequisite is unmet (the population not accepted, the round not
ready, an impact assessment pending, a task blocked) or no one can act (queued agent
work with no worker configured). UPCOMING: nothing is due yet (a phase not released, a
retest window not reached, agent work queued for a worker that exists, a concluded
control's remaining round not yet open). A hold on another phase never makes the current
step upcoming: the holds are read from the step's own phase.

## 13. M2b as built

**Queue completeness** (`queue.py`). Six sources added, each read from the record that
carries the obligation: evidence sufficiency reviews awaiting a person's decision
(`evidence_reviews.decision IS NULL`, READY or NEEDS_PERSON, with the agent's proposal
or why it could not review); historical coverage assessments (the journey's coverage
gaps, against the latest signed-off review of the control or the round); workpaper
drafts the agent gave up on (`DRAFT_FAILED`); re-performances that did not finish
(`REPERFORM_FAILED`, under the review's own item); deficiency remediation and retest
(`deficiencies.status`, the retest left to the open round's items when one exists); a
round open whose window or release has not come; and what remains before a concluded
control is final when no step is open. Every item now carries an `obligation` code; §12
maps each obligation to its one item. Two control-step prefixes that did not match the
review wording ("Answer the review notes", "Clear the answered notes") are corrected so
an open review never appears twice, and "Re-perform", "Independent review" and "Retest
outstanding" steps defer to the review and deficiency items.

**Four buckets.** UPCOMING joins MINE, WAITING and BLOCKED: nothing is due yet. A
queued agent turn (the tester's run, the reviewer agent's re-performance, a drafting run)
is UPCOMING when a worker exists (`workspace.automation_of`, passed into the queue) and
BLOCKED with "Automation unavailable: no worker is configured" when none does; the
holds that lift with time or a release ("must operate until", "Not released yet") make
samples, rounds and the control's step on that phase UPCOMING, read from the step's own
phase so another phase's hold never counts; remediation in progress is a WAITING item
owned by the control owner, never a blocker. The console inbox leaves UPCOMING items
out (nothing waits on a person) and shows the overdue chase under its own `late` kind.
`limit` and `offset` page the filtered list; `total` says how many matched.

**The Testing destination** (`section=testing`, `testing-hub-model.ts`,
`testing-hub-view.tsx`). One header and four views. Plans and Phases embed the Test
plans page's own components (`PlanningPage`, `PhasesView`) with the Testing header in
place of theirs and their links kept inside the destination (`planningHref` takes the
section); the plan review, batch approval, answering and release behaviour is the one
implementation, unchanged. Results lists every in-scope control's testing from the
register rows, test sheets and rounds the guided workspace reads: the sheet's headline
(never "running" without a worker), the open round's phase, the result and exceptions,
the control's next step and whose it is, with filters (to start, testing, to decide or
sign off, signed off, exceptions, mine) and a search; each row opens the guided
workspace on the step. Review lists the independent reviews with their stage, notes open,
the queue's own action on each (including the coverage assessment of a signed-off
review) and whose it is, with open / mine / signed-off filters. The "Testing" menu entry
replaces "Test plans"; the legacy page still answers at `section=planning` until the
replacement is validated. The loaders fetch controls, sheets, rounds, reviews, automation
and the queue for the destination; the planning review and phase progress only for the
Plans and Phases views.

**Scale** (`ai_workforce_scale`, built through the API by the fixtures' rules-only
paths): 155 controls over five systems (SAP ERP, Oracle EBS, Workday, Salesforce,
ServiceNow); 20 populations received, 15 accepted, 10 sets of samples approved, 8 tester
runs (6 clean, 2 with an exception), 2 runs stopped, 7 sheets signed off, one deficiency
logged and moved to remediation, 7 reviews open (3 with the agent's notes to decide, one
re-performance queued, one stopped) and 2 signed off (one with a coverage gap, one with
an impact assessment pending and a stale round basis), 5 plans revised, 5 requests sent
(simulated) with 2 overdue, and 125 controls at "to request" with 291 drafted requests
awaiting approval. The queue listed 326 items (312 MINE, 7 BLOCKED, 7 WAITING, 0
UPCOMING without a worker) with no repeated identity.

| Read (in-process test client, five runs) | Median | Max |
| --- | --- | --- |
| `GET /queue` (326 items) | 231 ms | 341 ms |
| `GET /queue?limit=25` | 229 ms | 378 ms |
| `GET /queue?bucket=MINE` | 215 ms | 249 ms |
| `GET /console/inbox` | 236 ms | 323 ms |
| `GET /workspace/controls` (the register) | 175 ms | 208 ms |
| `GET /test-sheets` | 78 ms | 96 ms |
| `GET /reviews` | 62 ms | 81 ms |
| `GET /planning-review` (the Plans view) | 498 ms | 567 ms |

One queue read issues 166 SQL statements in about 140 ms, 128 of them in the register
builder (`workspace._controls`) the queue reads for every control's journey; the sources
added in M2b add one statement each. Paging does not cut the cost: the list is computed
whole, then filtered and cut, because every item's authorization is per viewer. The
bottleneck is the register builder's per-control statements, not the queue; a
set-based register read would halve the time and is the first optimisation to make if
engagements grow past this scale. The Plans view's `planning-review` read is the slowest
page on the destination at half a second. Home collapses the 291 identical
drafted-request items into one expandable row, as it already did for repeated steps.

**Validation.** `test_queue.py` (six tests): the new sources and their owners
(coverage, stopped drafts, stopped re-performance, evidence sufficiency, deficiency
remediation and retest), the UPCOMING and BLOCKED readings of queued agent work with and
without a worker, the round window, the inbox's treatment of each, filters that narrow,
paging; `test_waiting.py` rewritten for the one queue's overdue chase beside the console's
own count. Node: `testing-hub-model` (views and addresses, result states from sheet,
round and row, review rows with the queue's action, filters and counts), `queue-model`
(UPCOMING, obligation, paging, collapsed drafted requests). The scale engagement's
screenshots and the three-control walkthrough are in `docs/review/m2b/`.

**Remaining duplicated interfaces** (for M2c and M2d): the legacy Test plans page
(`section=planning`) beside the Testing destination's Plans and Phases views; the console
inbox's own "past due" count beside the queue's per-control chase items; the console
page's inbox beside Home's queue (M2c retires the console page as a destination); the
classic control tabs beside the guided steps (M2d); the guided Plan step links to the plan
review rather than embedding its sections (the plan has one editor; the embedding is
M2d's).

## 14. M2c as built: the six destinations

**Navigation before and after.** Before: fourteen sections in two menu groups,
Engagement (Home, Agent console, Controls, Test plans, Project plan, Timeline, Evidence,
Deficiencies, Approvals) and Setup (Engagement settings, Library, AI workforce,
Engagements), plus Tasks reachable by address; M2b made it fifteen with Testing. After:
one menu of six destinations, Home · Controls · Testing · Evidence · Reports · Settings
(`DESTINATIONS` in `shell-model.ts`), each a page or a page with tabs; the engagement
switcher stays in the top bar. Reports › Deficiencies / Schedule / Timeline / Status and
reports; Settings › Engagement / Library / AI workforce / Tasks / Engagements. The tab
travels as `view`, as Testing's does, so a page's own `tab` (a control's plan tab, the
library's) still opens. The Approvals badge moves to Home, whose queue lists every
pending approval. Three pages leave the menu and stay reachable by their addresses and
from the pages that lead to them: the agent console (from Home, from the pages that cite
it, and from Reports › Status and reports, where the five engagement reports are produced
on request), the approvals page (from every approval item in the queue and from Reports ›
Status and reports) and the engagements page (behind the switcher and Settings ›
Engagements). Nothing was rebuilt: each tab renders the component that was the page.

**Redirect mapping** (`resolveRoute` in `routes.ts`, answered by the edge proxy
`apps/web/proxy.ts` with HTTP 307 before anything renders, and applied again by
`page.tsx` as a fallback; every other parameter is kept, repeated ones included):

| Older address | Resolves to | Record kept |
| --- | --- | --- |
| `section=overview` (and no section) | Home | — |
| `section=controls` | Controls | `control`, `step`, `tab`, `request`, `wp`, `ev`, filters |
| `section=testing` | Testing | `view`, `control`, `tab`, `filter` |
| `section=evidence` | Evidence | `tab`, `request`, `file`, `queue`, filters |
| `section=planning` | Testing (Plans) | `control`, `tab`, `filter`; `view=phases` → Testing › Phases |
| `section=plan` | Reports › Schedule (`view=schedule`) | `stage` and the plan's filters |
| `section=timeline` | Reports › Timeline (`view=timeline`) | — |
| `section=deficiencies` | Reports › Deficiencies (`view=deficiencies`) | `deficiency`, `new` (the log dialog for a control) |
| `section=setup` | Settings › Engagement (`view=engagement`) | `step`, `control`, `sample`, `template`, `system`, `edit`, `category`, `notice` |
| `section=library` | Settings › Library (`view=library`) | `control`, `tab`, `category`, `status`, `q` |
| `section=agents` | Settings › AI workforce (`view=workforce`) | `agent` |
| `section=tasks` | Settings › Tasks (`view=tasks`) | `task`, the directory filters |
| `section=console` | the agent console, retained | `thread`, `notice` |
| `section=approvals` | the approvals page, retained | `notice` |
| `section=projects` | the engagements page, retained | `create`, `edit`, `manage`, `view` |
| `section=reports`, `section=settings` | the destination; an unknown `view` opens its first tab | as above |

A redirect never lands on a generic page when a record-specific destination exists: the
deficiency, the control's plan, the library entry, the agent and the task each open as
before, inside the destination that now holds their page. `shell-model.test.ts` opens
every older section and the stored link shapes (a control's plan on its tab, a
deficiency, a log dialog, a setup step, a library entry, an agent, a task, a repeated
filter) and checks the address each resolves to; the queue's and the next-steps API's
links (`section=planning`, `section=approvals`) keep working through the same table.

**The M2b conditions.** Results show the phase of the record in the row (the sheet's
round, else the interim sheet, else the open round awaiting its testing), never the
control's journey step; `testing-hub-model.test.ts` holds a concluded control whose
remaining obligation is the design workpaper's review coverage and checks the row says
Interim. Semantic deduplication: a submitted request's approval record and the control's
"Approve the evidence request" step are one item (the approval's); a stopped tester run
and "Testing stopped: run it again" are one (the sheet's); a due reminder and "Chase the
overdue evidence request" are one (the reminder's); a stopped workpaper draft and
"Prepare the workpapers" are one (the draft's); open reviews, impact and coverage
assessments, round bases, proposed samples and deficiencies already stood for their
steps. Independent obligations stay apart: a control's drafted design request beside its
submitted interim request, a review beside a deficiency. `test_queue.py` builds the
approval and stopped-run cases and checks that no (control, obligation) pair repeats
except the per-record kinds (one drafted request, one send approval, one reminder each). The same check against the live 155-control queue found one more pair, an impact
assessment listed as its record and as the control's finality step in other words; a
step now also defers by its obligation class (`_OBLIGATION_KINDS`), and the live check
reports no repeated pair (`docs/review/m2c/queue-dedup.md`).
At phone width the Results and Review tables fold to cards that show the control, its
status, whose it is and the next action, with the phase, result, notes and sign-off
behind Details; the desktop tables are unchanged.

**Scale baseline.** The 155-control engagement (§13) and a 403-control one over thirteen
systems (`ai_workforce_scale400`, 830 queue items, 747 of them drafted-request
approvals):

| Read (in-process, median of five) | 155 controls | 403 controls |
| --- | --- | --- |
| `GET /queue` | 231 ms, 166 statements | 350 ms, 246 statements |
| `GET /queue?limit=25` | 229 ms | 331 ms |
| `GET /console/inbox` | 236 ms | 351 ms |
| `GET /workspace/controls` | 175 ms, 128 statements | 329 ms, 208 statements |
| `GET /test-sheets` | 78 ms | 126 ms |
| `GET /planning-review` | 498 ms | 1131 ms |

Latency and statements grow well under linearly with the controls (2.6× the controls,
1.5× the time, 1.5× the statements): the per-request cost is the fixed set of per-table
reads, not per-control queries, and no material issue is exposed. The Plans view's
`planning-review` read is the one that grows fastest and is the first to revisit if
engagements exceed this size; no rewrite is undertaken.

**Remaining duplicated interfaces and risks.** The console page's inbox beside Home's
queue, and its own past-due count (Milestone 3 makes the console the companion panel);
the classic control tabs beside the guided steps (M2d); the guided Plan step linking to
the plan review rather than embedding it (M2d); the Settings › Engagement tab is the
setup wizard's step pages, which still read as a wizard after launch; in-app links that
still name the older sections (the next-steps API, the Home journey bar, the register's
planning links) work through the redirect and are to be rewritten to the destinations in
M2d so no request takes the extra hop.

## 15. M2d as built: one control interface, one queue, direct links

**Feature parity first.** Every classic control tab and its actions were inventoried
against the guided workspace before anything was retired
([milestone-2-parity.md](milestone-2-parity.md)): the seven tabs, 60-odd write intents
across the planning, evidence, sampling, testing, exception, remediation, retest,
assessment, review, conclusion and sign-off routes, the role each needs, where each now
lives, and the test that covers it. Every action already had a home in a step; the
Overview and Activity tabs held no writes. No legacy action was hidden without a
validated replacement.

**The guided workspace is the control's one interface.** The classic tab bar, the audit
progress bar, the overview's next-action panel, summary metrics and agent roster, and the
"All details" link are retired. An older `?tab=` link opens the step that holds that
tab's work (`stepForTab`); `?tab=activity` opens the Activity record, which now sits
below the steps as a disclosure the stepper links to. No tab was added and no second
control dashboard exists: the record page is the header, the stepper with its Needs-you
card, Agent says and trace, the step's body, and the activity record.

**The plan review inside the Plan step.** `PlanReview`, the one component Testing › Plans
uses, is embedded in the Plan step (exported, with an `embedded` mode that drops the
breadcrumb, pager and repeated title). Approving, requesting changes, accepting or
dismissing the planner's revision, answering client values, describing facts, editing
procedures and evidence, and releasing a phase all run through the same `planning` and
`phase_release` routes with the same version checks, impact assessments and audit
events; nothing was reimplemented. The loader reads the master plan and the phase
progress for an open control.

**One queue, no independent calculation.** The console's inbox is built from the queue
alone (M2a); the dead legacy derivation (`_waiting_elsewhere`, with its own past-due
count and sheet-based items) is deleted. Overdue evidence requests are now items of the
queue themselves (`request-overdue`, one per request past due, the client's to answer and
the team's to chase); the inbox's `late` entries are those items, and the control's
"Chase the overdue" step defers to them. The four buckets are preserved; the inbox omits
UPCOMING and the waits on the client, which wait on no one inside the firm.
`docs/review/m2d/queue-reconciliation.md` reconciles Home's queue, the inbox and the
register for the lead, the reviewer and an admin off the team: the inbox count equals
the queue less those two classes for each viewer, titles match one to one in order, and
every register row's next step is either the queue's control step or deferred to the
record's own item.

**Direct links.** Internal links to the moved sections are rewritten to the destinations
at the source: `canonicalQuery` in `routes.ts` is applied by the shared builders
(`workspaceHref`, `directoryHref`, the controls page's `href`, the engagement pages'
`pageHref`, `libraryHref`, `setupHref`, the systems page, the engagement write route's
redirect) and `planningHref` defaults to Testing; the API's next-steps links name
`testing`, and the queue's plan-task link names Reports › Schedule. The HTTP redirects
stay for bookmarks and stored external links and were re-checked live
(`docs/review/m2d/redirects.md`). Record, control, phase, round and request identifiers
travel unchanged, as the route tests show.

**Cross-role walkthroughs** (`docs/review/m2d/walkthroughs.md`, screenshots `j1-*` to
`j6-*`), on the 155-control engagement, every action through the page's own controls:

- The preparer approved a revised plan from the Plan step (state NEEDS_CLARIFICATION →
  APPROVED, revision 2 approved, two decisions on record), approved a drafted request from
  the Request step (DRAFT → APPROVAL_PENDING, after the approval checks passed), and
  accepted a received population (the control's samples item went from BLOCKED to MINE).
- The reviewer accepted one proposed note and dismissed another with a reason on the
  Review step (notes OPEN and DISMISSED); the lead's attempt to sign off the review was
  refused by the API (409, independence).
- The manager worked from Home, Testing › Results filtered to what needs deciding,
  Testing › Review, Reports and the register, at desktop and phone width.
- The control owner opened a portal link, confirmed identity with the one-time code
  (shown as a local preview: no email is sent in this environment), opened the request
  and uploaded a file, acknowledged on the page and visible to the team on the request.
- A concluded control showed its sign-off receipts (testing by Dana Whitfield, review by
  Riley Okafor) and conclusion; a second sign-off was refused by the API; the activity
  record opened from an older `?tab=activity` link.
- A deficiency moved from remediation in progress to ready for retest from Reports ›
  Deficiencies with the fix date; the retest round opened and the control's Test step
  showed the Remediation and Retest phases; the queue listed the round as upcoming.

No journey needed a legacy page. Two findings outside the scope of the change: the
drafted requests on the scale engagement could not be approved until the client's domain
was on the recipient allowlist (the approval checks say so; the queue's readiness does not
yet read that check, so the item is MINE while the page refuses), and the portal's
"Submit evidence" step was not exercised (the upload itself reached the team).

**Legacy capabilities still required.** Producing the five engagement reports (PDF and
Word) is done in the agent console, which Reports › Status links to and says so. The
approvals page remains the place where expired and self-approval cases are listed; every
approval item in the queue opens it. The engagements page sits behind the switcher and
Settings › Engagements.

**Validation.** Python: `test_queue.py` (seven tests, with the overdue source), the
inbox-related files (`test_waiting` rewritten: the inbox is the queue's list, so a step
is titled as the register words it and each overdue request is one `late` item;
`test_next_steps` points at Testing), the fast set and the critical set. Node: the route
and link tests (`shell-model`, `directory`, `library-model`, `planning-model`) rewritten
for the destination addresses, and the whole set. Type checks and lint clean (the known
`biome.json` endings aside).

**Remaining limitations and technical debt.**

- The queue's readiness for a drafted request does not read the approval checks
  (recipient allowlist, request quality); the page does. Reading `request_quality` per
  draft in the queue is the fix, at a cost per request to measure.
- The console page still exists as a destination (reachable, out of the menu) with its
  own chat and activity; Milestone 3 makes it the companion panel. Its inbox is the queue.
- The Settings › Engagement tab is the setup wizard's step pages, which still read as a
  wizard after launch.
- Three pages produce addresses to the retained sections (`console`, `approvals`,
  `projects`) by design; everything else is a destination address. The API's `next_steps`
  still exists beside the queue for Home's journey bar (figures only).
- `PlanReview` inside the Plan step loads the master plan and the phase progress on every
  control open, about two extra reads; the register, sheets, rounds and reviews reads
  were already there.
- The 403-control baseline stands (§14); no performance rewrite was undertaken.

## 16. Milestone 2 closure

**M2d committed** as e818eae (generated files, line-ending-only changes and the earlier
screenshots left out).

**Drafted requests are ready in the queue only when their approval would pass.** The
approval endpoint (`outbound._approve_draft`) refuses a draft when it is held for
planning, has no recipient, names a recipient the allowlist does not accept, or fails a
check of `request_details.blocker` (the request's type, phase, period, mapping to the
plan, duplicates, wording). The queue now reads that same rule for every draft at once:
`request_details.draft_blockers` builds `request_checks` from the same functions as
`blocker`, with the shared reads done once and the per-request reads batched (the items,
windows and duplicates of `request_quality.quality_checks_many`; the planning hold's
pieces, `gate_facts`, `released_phases` and the kickoff reconciliation, memoized per
control). The single-request path keeps its own readers and the deciding functions are
shared (`gate_reason_from`, `release_reason_from`, `quality_from`), so the two cannot
drift; `test_queue.py` asserts, for every draft of a fixture engagement under two
allowlists, that the batched and the single-request readings are identical. In the
queue a held draft is BLOCKED with the endpoint's own words and belongs to the preparer
who resolves it; a ready draft is the approver's; a person's own draft is the preparer's
to submit. The endpoint applies the rule again, with its own settings and the record's
version, when the action is taken: the queue never stands in for it, and the requester
never approves their own request (the approval permission and the agent-drafted rule are
the endpoint's). Tests: allowed domain (ready, the approver's), blocked domain (held with
the reason, the preparer's), missing recipient (held, filed under contacts in the inbox),
a member who may prepare but not approve (sees it waiting; refused with 403), the
allowlist changed between the queue's reading and the action (refused with 409), a stale
version (409), then the approval itself (200, APPROVAL_PENDING, the item leaves the queue).

Before and after on the scale engagements (`docs/review/m2-closure/queue-readiness.md`):
at 155 controls, 287 drafts read as MINE before; after, 283 MINE and 4 BLOCKED (two
"Release the roll-forward phase first", two "Confirm the type"); with an allowlist naming
another domain, all 287 BLOCKED with "cannot receive evidence requests". At 403
controls, 747 drafts: 715 MINE and 32 BLOCKED (26 "Approve the control's test plan
first"). The queue's in-process time went from 205 ms to 581 ms at 155 controls and
from 297 ms to 808 ms at 403 (the first batched version cost 2.2 s; the per-draft reads
were then removed: 17 statements for the whole rule).

**The client portal's final submission** (`docs/review/m2-closure/portal-smoke.md`,
screenshots `portal-*`), in headless Chrome against the 155-control engagement: the owner
opened the authorized link, asked for the code (shown as a local preview: no email is
sent in this environment, as the page says), confirmed identity, opened the request,
uploaded a file to each of the two required items (both acknowledged, "2 of 2 items with
files"), pressed Submit evidence, confirmed in the dialog, and saw "Submitted" with the
date. The team's side: `owner_submitted_at` set, the audit event
`evidence.portal_submitted` recorded on the request, both files on the request of the
right control (ITGC-AC-07 · Salesforce) in the right engagement. A wrong token answers
"This link is not valid"; a link the team revoked shows no request and the API refuses a
code for it (409). Outbound email delivery was not exercised: no sender is configured.
A link otherwise lives while its requests are open (until their due date plus the grace
days) and cannot be used after.

**Keyboard-only checks** (`docs/review/m2-closure/keyboard.md`, screenshots `keys-*`),
real key events in headless Chrome: the stepper's steps are reached in order with
visible focus and Enter opens a step; the plan review's actions are reached and Enter on
"Request changes" opens the comment form with the next Tab landing in it; the queue's
filter chips and rows are reached with visible focus and Enter on a row's Open opens the
control; the phone-width Results and Review cards' Details disclosures take focus (visible
when reached by Tab) and open with Enter; the status and close-out dialog takes focus on
open, keeps Tab inside and closes on Escape; the portal's submission dialog takes focus on
open. No material blocker was found. Noncritical accessibility debt recorded: Space on a
Details disclosure did not toggle it under the driver (Enter does; a manual check is
owed); focus after Escape on the close-out dialog returns to the document, not to an
opener (the dialog opens from an address); "Log a deficiency" is a link that reloads the
page with the form open, so focus starts at the top; the portal's submission dialog is
a native modal (`showModal`) but the driver's Tab trail recorded one stop it could not
place inside it, to be confirmed by hand.

**Preserved, with their limitations recorded.** The console's reporting interface, the
Settings › Engagement wizard pages and the embedded `PlanReview` are unchanged; the
embedded review costs two reads per control open (the master plan and the phase
progress), and the queue's draft rule costs about 0.35 s per queue read at 155 controls,
both noted for optimisation.

## 10. Out of scope for Milestone 2

The Agent Companion panel (Milestone 3), the onboarding wizard and design tokens
(Milestone 4), any new agent capability, any workflow engine change, live model or
outbound-sender validation (tracked separately; see acceptance-walkthrough.md).
