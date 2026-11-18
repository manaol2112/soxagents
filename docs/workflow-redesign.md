# Guided control testing: refined design for approval

Status: **approved architecture; Milestone 0 authorized (19 October 2026).** The product
owner approved the six destinations, the phase-aware control workspace, the centralized
queue, the contextual Agent Companion and the incremental delivery, decided §8, and added
refinements A–E (§9). Milestone 1 and any UI change wait for the Milestone 0 results and a
further approval.

The owner's constraints, which this design must satisfy:

1. Keep Plan → Request → Test → Conclude → Review, but make it phase-aware; never force a
   linear path where the methodology iterates.
2. Keep engagement-wide test plan management alongside the per-control experience.
3. Six destinations: Home, Controls, Testing, Evidence, Reports, Settings.
4. A contextual Agent Companion that explains with traceable information and separates
   read-only analysis from actions needing approval.
5. Four setup steps, with workspace creation, readiness for planning and readiness for
   testing kept distinct; no required fact silently replaced by a default.
6. No change to authorization, segregation of duties, approval gates, audit trail, evidence
   traceability, versioning or testing logic.
7. Validate the workflow and information architecture first; consolidate navigation last.
8. No large rewrite: reuse components and services, ship incrementally, keep deep links.

Everything below is grounded in the state machines the code already enforces
(`workspace.step_of` / `progress_of`, `master_plans.state_of`, `phase_release.py`,
`test_sheets`, `control_reviews.REVIEW_STEPS`, `test_rounds`). The redesign adds **one
derivation and one set of surfaces**; it adds no new state and removes no gate.

---

## 1. Principles

- **One source of truth per question.** A control's step, a phase's state and "what needs me"
  are each computed in one API function and read by every page. No page recomputes them.
- **Pages batch; the control guides.** Cross-control work (approve plans, release phases,
  chase evidence, review results) happens on Testing, Evidence and Home. Work on one control
  happens in its workspace, which always says where the control is and what is next.
- **Agents propose, people decide, the record shows both.** Every step shows what the agents
  did (with citations and versions) and what a person decided (with who and when).
- **Simplify the surface, not the methodology.** Rare actions move into a menu; none is
  removed. Every gate that exists today exists afterwards, at the same level.

---

## 2. Refined information architecture

### 2.1 Destinations

| Destination | Purpose | Contains | Mostly used by |
|---|---|---|---|
| **Home** | Where the engagement stands; what waits on me | Journey bar (6 stages); **Do next** queue filtered by role, stage and phase; schedule card; engagement health | Everyone, daily |
| **Controls** | The scope and each control's record | Register (filters, owners, systems, stage, "yours"); the **control workspace** (§3); scope changes (add from library / RCM / system) | Preparers |
| **Testing** | Execution across the engagement | **Plans** (engagement-wide review and batch approval), **Phases** (D&I / Interim / Roll-forward / Retest / Remediation board and releases), **Results** (exceptions and open decisions across controls), **Review** (independent review queue) | Managers, reviewers |
| **Evidence** | Everything asked of the client | Requests tracker, mailbox, files register, contacts and coordinator, outbound approvals inline | Preparers, coordinators |
| **Reports** | Working registers and deliverables | **Deficiencies** (working register with remediation and retest), status report, evidence tracker, exceptions report, **Schedule** (project plan + timeline merged) | Managers, partners |
| **Settings** | Engagement configuration | Profile and period, team and roles, systems, library, workpaper templates, evidence contacts, AI workforce (agents and runs), readiness | Owners, admins |

Outside the six: the **Agent Companion** (a panel on every page, §2.3), the **engagement
switcher** in the top bar (today's Engagements page remains behind it), and the **client
portal**, which is a separate product surface and is unchanged.

### 2.2 Routing and compatibility

The address scheme stays `/?organization=…&project=…&section=…`. New sections: `testing`,
`reports`, `settings`. Old sections keep working by redirecting to their new home with the
same record open (table in §5). A control's `tab=` values map to steps through the existing
`LEGACY_TABS` mechanism. No deep link in an email, a portal message or a stored audit event
breaks.

### 2.3 Agent Companion

A right-side panel, opened from a persistent "Ask" button and ⌘K, on every page. Its context
is whatever the page shows: engagement, control, current step, active phase, attributes,
evidence, review state. It uses the existing console thread model and the existing
confirm / confirm-all flow; it gains no new permission.

Three kinds of reply, visibly distinguished:

| Kind | Example | Behaviour |
|---|---|---|
| **Explain** (read-only) | "Why these attributes?" "Which evidence satisfies A3?" "What blocks interim sign-off?" | Immediate; every claim cites the record it comes from (plan version, evidence file, result row) and says where it is uncertain |
| **Draft** | "Prepare a follow-up for the missing listing" | Produces a draft in the record where it belongs; nothing sent |
| **Act** | "Approve this plan", "Release roll-forward" | Routed through the same approval gate as the button; the panel shows the gate and who may decide |

Global conversations (not about the open record) remain available from the panel's thread
list; the console page as a destination is retired only in milestone 3.

---

## 3. Control workspace layout

Replaces the seven tabs (overview, design, evidence, testing, findings, review, activity)
with one page: a stepper, a phase strip, the current step's card, a trace rail, and an
activity drawer. Desktop layout (phone stacks the rail under the card):

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Prev   ITGC-AC-03 · Quarterly user access review          [Testing in progress]    │
│          SAP S/4HANA · Quarterly · Key · Owner: J. Rivera    Ask the agent   Next ›   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  ✓ Plan        ✓ Request        ● Test        ○ Conclude        ○ Review             │
│  approved v3   interim received  interim       —                —                    │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Phases   [✓ Design & implementation · reviewed] [● Interim · testing]               │
│           [○ Roll-forward · not released]  Retest/Remediation appear only when opened │
├───────────────────────────────────────────────────────┬──────────────────────────────┤
│  TEST · Interim                                       │  TRACE                       │
│                                                       │  Attribute → evidence → result│
│  What the agents did                                  │  A1 Reviewer approved  E2 ✓   │
│  Tested 25 of 25 items against A1–A4 from E2, E3.     │  A2 Timely (≤10 days)  E2 ✓   │
│  2 exceptions proposed (items 7, 19). [Open results]  │  A3 Removals actioned  E3  !  │
│                                                       │  A4 Evidence retained  E3 ✓   │
│  Needs you                                            │                              │
│  Decide the 2 open test results.                      │  Open: 1 question for the     │
│  [ Decide results ]   [ Change… ▾ ]                   │  client (E3, item 19)         │
│                                                       │                              │
│  Details (collapsed): sample and population · test    │  Activity  ›  (drawer)       │
│  sheet · procedures · requests for this phase         │                              │
├───────────────────────────────────────────────────────┴──────────────────────────────┤
│  Receipts: Plan approved by M. Chen, v3, 12 Mar · Interim released by M. Chen, 2 Apr  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Rules of the page:

- **The stepper is a map, not a gate.** Any step can be opened. A step that a later event
  reopened (a review note that reopens the test sheet, a material plan change) shows
  "Reopened: <reason>" and becomes the current step again; the history is kept.
- **The phase strip is the truth about progress.** A control with interim signed off and the
  roll-forward not released shows Test ✓ for interim and Request ○ for roll-forward; it is
  never "concluded". Retest and remediation rounds (`test_rounds`) appear as further chips
  when opened, never as new steps.
- **One primary action**, taken from `workspace.step_of` (the text the register already
  shows). **Change…** holds the rare verbs for that step. **Ask the agent** opens the
  companion with this control, step and phase as context.
- **The trace rail is always visible**: every approved attribute, the evidence linked to
  it, and its result in the active phase. This is the traceability requirement made
  permanent rather than a tab.
- **Receipts** are the audit trail in one line each (who, what, version, when); the full
  trail is the activity drawer.

What each step contains, and the existing component it reuses:

| Step | Shows | Primary action (from `step_of`) | In Change… | Reuses |
|---|---|---|---|---|
| **Plan** | Understanding, procedures, attributes, evidence requirements, flags with fixes, client values, describe, suggested standard, changes since approval | Approve the plan (version-bound) / Revise as the reviewer asked | Request changes, Re-plan with the rules, Describe, Answer values, Use a standard, Retire an attribute | `planning-view` PlanReview sections, Describe and values dialogs, `test-basis` |
| **Request** | Per phase: planned requirements, drafted and sent requests, portal status, follow-ups, release state | Release the phase / Approve the request / Send / Chase / Reconcile the kickoff draft | Draft a follow-up, Waive an item, Cancel a request, Reassign recipient | `evidence-plan-view`, `request-review` (one component for the Evidence page and this step) |
| **Test** | Per phase: population and samples, test sheet, agent run, results, exceptions | Accept the population / Approve the samples / Run testing again / Decide results / Sign off | Exclude or include an item, Link or unlink evidence, Replace a sample, Override a result with a reason, Add a note | `sheet-model` and testing views, `round-model` |
| **Conclude** | Workpapers, exceptions, proposed deficiency, remediation and retest rounds | Prepare the workpapers / Log the proposed deficiency / Open a retest | Edit the workpaper, Dismiss a proposed deficiency with a reason, Open remediation | `workpaper-model`, deficiency actions, `test_rounds` |
| **Review** | The reviewer's re-performance, proposed and raised notes, what each reopened | Decide the notes / Address / Clear / Sign off the review | Re-perform, Return to the preparer, Raise a note | `review-model`, `control_reviews` |

The 22 testing verbs all remain; they are placed (primary or Change…) rather than listed.

---

## 4. Phase-aware workflow and approval-state model

### 4.1 Phases

The phases are the existing `_PHASE_ORDER`: **DESIGN** (design and implementation),
**INTERIM**, **ROLLFORWARD**, **RETEST**, **REMEDIATION**. Which apply to a control comes from
its approved test plan; retest and remediation open from a deficiency or review outcome.

Each (control, phase) has one state, derived from records that already exist:

| Phase state | Derived from |
|---|---|
| NOT_APPLICABLE | The plan has no procedures for the phase |
| PLANNED | Requirements planned (`evidence_plan_items` PLANNED / AWAITING_DEPENDENCY), phase not released |
| RELEASED | `phase_releases` row (DESIGN releases with plan approval); requests may go for approval |
| REQUESTED | A request for the phase is SENT / WAITING_FOR_RESPONSE / OVERDUE / ESCALATED / PARTIALLY_RECEIVED |
| RECEIVED | Requested items received; sheet not open or at PLACE |
| TESTING | Sheet OPEN at TESTING (agent running or stopped) or test PROPOSED (samples / population) |
| RESULTS_TO_CONFIRM | Sheet at DECIDE or SIGN_OFF |
| SIGNED_OFF | Sheet SIGNED_OFF for the phase |
| REVIEWED | Control review SIGNED covering the phase |

### 4.2 The control's step

The step guides; it never hides the rest (refinement A). Alongside the step, the journey
always exposes the **per-phase state** (§4.1), the **current actionable task** (the
register's `next_step`, unchanged) and the **outstanding blockers** across every phase:
an unreleased later phase, open review notes, a plan changed since approval, overdue
evidence, a request awaiting approval, an open deficiency. A control reads "concluded"
only when nothing applicable is outstanding.

The step follows **the phase furthest along among those still open** (testing outranks
requesting; the conclusion and the review outrank testing of the same line of work), and
every other open phase is listed as outstanding beside it. Design evidence still to request
while interim testing runs is therefore a blocker, not the step. Work a review note reopened
makes its phase the step again. Done needs every applicable phase finished:

| Step | True when |
|---|---|
| Plan | Plan not approved: `evidence_plan` NONE or PROPOSED; master plan state NOT_STARTED, ANALYZING, NEEDS_CLARIFICATION, DRAFT_READY, PENDING_REVIEW or CHANGES_REQUESTED. (APPROVED with CHANGES_PROPOSED keeps the approval and is past Plan.) |
| Request | Some applicable phase is PLANNED, RELEASED or REQUESTED and the control is not past it in Test |
| Test | Some phase is RECEIVED, TESTING or RESULTS_TO_CONFIRM |
| Conclude | Every released phase SIGNED_OFF; workpaper not prepared, or a proposed deficiency undecided, or a retest/remediation round open |
| Review | Control review open (REPERFORMING, REPERFORM, DECIDE, ADDRESS, CLEAR, SIGN) |
| Done | Conclusion EFFECTIVE or EXCEPTION, review SIGNED, no round open |

Two invariants, tested in milestone 0: the step never disagrees with the register's
`next_step` text (both come from `step_of`), and the phase states of a control account for
every request, sheet and round it has (nothing is counted in two phases).

Non-linear paths are expressed as **reopening**, not as new steps: a review note that must be
fixed reopens the sheet (Test, with the note as the reason); a material plan change after
approval reopens Plan (`changes_since_approval`); a deficiency's retest opens a RETEST phase
in Test. The receipts keep what was signed before.

### 4.3 Approval gates (unchanged, restated so the design can be checked against them)

| Gate | Who | Rule kept |
|---|---|---|
| Test plan approval | Owner/Admin or Reviewer; never the person who drafted the revision | Bound to a stored plan version; attributes approved with it |
| Batch plan approval | Same | One decision record **per plan version**, with reviewer and time; eligible only when nothing holds the plan: a plan with an unresolved clarification, a blocking finding or a material uncertainty is **excluded** until resolved (refinement C); a held plan is never included; reviewer independence as for a single approval |
| Phase release | A person; reviewer may release early with a recorded reason | Releasing never sends anything |
| Outbound request | Approver ≠ requester (`approvals.py`) | Every request approved and sent by a person; live email stays as configured |
| Population / samples | Preparer | Accept before testing |
| Test results and sign-off | Preparer; overrides carry a reason | Sheet signed before workpapers |
| Deficiency | Preparer logs; reviewer confirms in review | Severity as approved by the reviewer |
| Independent review | Reviewer role, independent of the preparer | Notes decided and cleared before sign-off; reopening is recorded |
| Scope and settings | Owner/Admin | Unchanged |

### 4.4 Engagement readiness

| State | Meaning | How it is met |
|---|---|---|
| **Workspace created** | The engagement exists (status DRAFT); configuration continues | Step 1 of setup |
| **Ready for planning** | Required facts present or explicitly flagged for a person: period, scope (controls in scope with owners), systems, dependencies, team roles | `readiness.assess` passes; launch is allowed (status ACTIVE) |
| **Ready for testing** (per control **and phase**) | The plan is approved at its current revision; the phase is released (design releases with the plan); the phase's required evidence is received; the population is accepted and the samples approved; nothing the phase depends on is open | Existing gates, evaluated per phase (refinement B). Being past Plan establishes nothing on its own |
| **Completed** | All controls Done; reports issued | Existing completion |

Setup becomes four screens (client and period · controls in scope · systems and owners ·
launch), but the readiness checks that decide "ready for planning" are the ones that exist
today. Agents may **propose** values (owners from the RCM, systems from the controls); a
person confirms each required one. Optional configuration (workpaper templates, welcome
emails, evidence contacts beyond the coordinator) moves to Settings with its current
behaviour. Nothing required is defaulted. Whether readiness states are stored or computed
is a decision in §8.

### 4.5 Traceability and stale results (refinement D)

The chain is kept whole and visible: control objective and risk → procedures → attributes
(approved with the plan version) → evidence requirements and requests → files → samples →
test results → exceptions → conclusion → review notes and sign-off. The control workspace's
trace rail shows it; nothing in the redesign stores less.

A plan that changes after approval already goes back to PROPOSED (`revise_evidence_plan`)
and readiness blocks new testing until the revision is approved. Results signed off
*before* the change must not be treated as valid without an impact assessment: the journey
marks them **stale** (§7, Milestone 0) and the Plan step shows what changed. Whether the
platform should also withdraw the sign-off automatically is an inconsistency reported from
Milestone 0 for the owner's decision, not changed silently.

---

## 5. Mapping of existing pages and actions to new destinations

| Today | New destination | Notes |
|---|---|---|
| Home (`overview`) | **Home** | Queue gains filters (role, stage, phase); banners become queue steps |
| Agent console (`console`) | **Agent Companion** panel; thread list inside it | `section=console` opens Home with the panel open |
| Controls register (`controls`) | **Controls** | Unchanged; stage column uses the step and phase strip |
| Control record · Overview tab | Workspace header, stepper, receipts | |
| Control record · Design tab | **Plan step** | Test basis / choose standard included |
| Control record · Evidence tab | **Request step** (per phase) | |
| Control record · Testing tab | **Test step** (per phase) and **Conclude step** | Rounds as phase chips |
| Control record · Findings tab | **Conclude step** | Also listed in Reports › Deficiencies |
| Control record · Review tab | **Review step** | |
| Control record · Activity tab | **Activity drawer** | |
| Test plans (`planning`) queue, filters, batch approve, answer many | **Testing › Plans** | Same table and batch actions; opening a row opens the control at Plan |
| Test plans · PlanReview (per control) | **Plan step** | One component serves both |
| Test plans · Phases view, phase release batch | **Testing › Phases** | |
| Project plan (`plan`) and Timeline (`timeline`) | **Reports › Schedule**, card on Home | Milestone editing kept |
| Evidence center (`evidence`: requests, mailbox, files, contacts) | **Evidence** | Same tabs; `request-review` becomes the one request component |
| Deficiencies (`deficiencies`) | **Reports › Deficiencies** | Working register, remediation and retest actions kept |
| Approvals (`approvals`) | **Home queue** (filter "Approvals") and inline in Evidence / Testing | Expired and self-approval cases keep their rows; API unchanged |
| Engagement settings (`setup`, 9 steps) | **Setup wizard** (4 steps, DRAFT only) and **Settings** | Step pages reused as Settings sections |
| Library (`library`) | **Settings › Library** | Page unchanged |
| AI workforce (`agents`, `tasks`) | **Settings › AI workforce**; agent runs also visible per control step | |
| Engagements (`projects`) | Top-bar switcher; page kept behind it | |
| Client portal | Unchanged | |

Redirect table for milestone 3: `console → overview (panel open)`, `planning → testing`
(`view=phases → testing&tab=phases`), `plan, timeline → reports&tab=schedule`,
`deficiencies → reports&tab=deficiencies`, `approvals → overview&filter=approvals`,
`setup → settings` (or the wizard while DRAFT), `library → settings&tab=library`,
`agents, tasks → settings&tab=workforce`. Control `tab=` values map to steps.

---

## 6. Functionality at risk of being lost or duplicated

| Risk | Where it comes from | Mitigation and acceptance check |
|---|---|---|
| A rare testing verb has no home | 22 intents across sheet/review/testing/workpaper | Milestone 1 ships a test that enumerates every write intent and asserts a control in the right state exposes it (primary or Change…) |
| Approvals overview disappears | Approvals page lists pending, expired and self-approved across kinds | Home filter "Approvals" shows the same rows; API and permission tests unchanged |
| Two queues disagree | `console._inbox` (API) and `attentionQueue` (client-side fallback) compute "waiting" differently | Milestone 2 retires `attentionQueue`; Home and the companion read `next_steps` only |
| Two renderings of a plan | `planning-view` PlanReview and `evidence-plan-view` (Design tab) | One PlanReview component; Design tab removed only after the Plan step covers test basis |
| Three renderings of a request | `request-review`, evidence center, control Evidence tab | One request component by milestone 2 |
| Dashboard banners lost | Period conflicts, unplanned controls, requests without recipient | Each becomes a queue step kind with a target (recipient already done) |
| Phase release only reachable from the phases view | `PhasesView`, `phase-release-batch` | Request step offers single release; Testing › Phases keeps batch |
| Retest / remediation rounds hidden | `test_rounds` live under the Testing tab | Phase chips open them; Reports › Deficiencies links to the round |
| Deep links in emails and audit events | `section=`, `tab=` in stored links | Redirect table; `LEGACY_TABS`; a test opens every stored link shape |
| Step and register text disagree | Separate derivations | One function (`step_of`) feeds both; invariant test |
| Reviewer independence weakened by a shortcut | "Next control" flows, batch approvals | Flows only offer controls the viewer may act on (`mark_yours`, `viewer_can_answer`); batch records each decision |
| Setup facts silently defaulted | Four-step wizard | Readiness checks unchanged; a required fact is "to confirm" until a person confirms |
| Loss of keyboard and screen-reader paths | New stepper and drawer | Stepper is a `nav` with `aria-current`, drawer is a dialog; checked in screenshots and axe |

---

## 7. Phased implementation plan with acceptance criteria

Every milestone ends with: format, lint, mypy, pytest, Node tests, screenshots at 1440 and
390 measured, permission tests, a review of the diff for unrelated changes, and a report in
the AGENTS.md format. No migration is planned; one may be needed in milestone 4 (§8).

### Milestone 0: Validate the workflow and information architecture (no UI)

- `control_journey.py`: the step, the per-phase states, per-phase readiness for testing,
  the outstanding blockers, the reopened reason and the stale-results mark (§4), as a pure
  function over the rows `workspace` already builds (plus the control's rounds and
  requirement counts), exposed on `/workspace/controls` rows as `journey`. Where the
  journey and the register's older derivation (`progress_of`, the conclusion) disagree,
  the journey reports the disagreement in `conflicts`; neither is changed.
- Scenario tests (refinement E), each as a synthetic row and, where a fixture exists, on
  the database: plan not approved; overlapping phases (interim reviewed, roll-forward
  testing); roll-forward waiting on interim; incomplete and overdue evidence; plan revised
  after results were signed off; a review note reopening the sheet; an exception and its
  proposed deficiency; remediation and retest rounds; a fully concluded control.
- Invariant tests: one step per control; the journey's action is the register's
  `next_step`; the step agrees with `progress_of` except in the reported conflicts; every
  live request and open round is accounted for in exactly one phase; a phase is ready for
  testing only when every condition in §4.4 holds.
- **Accept when:** the tests above pass; on the dev engagement every in-scope control has a
  journey and every conflict is listed in the milestone report; the report names each
  inconsistency found in the existing methodology with a recommendation, and no business
  logic or authorization rule has changed.

### Milestone 1: The control workspace

- Stepper, phase strip, receipts, trace rail, activity drawer, prev/next control.
- Plan and Request steps built from the existing PlanReview and evidence-plan components;
  Test, Conclude and Review steps wrap the existing tab components with one primary action
  and a Change… menu.
- Legacy `tab=` links map to steps. The seven tabs remain reachable behind a "classic view"
  link until milestone 3.
- **Accept when:** the intent-coverage test passes; each gate in §4.3 is exercised by an
  existing API test unchanged; a reviewer cannot act on work they prepared; screenshots at
  both widths show the current step, phase strip and trace without overflow; the owner walks
  one control from Plan to Done without using the classic view.

### Milestone 2: The Testing workspace and the unified queue

- `section=testing` with Plans (today's queue and batch actions), Phases (today's phases
  view), Results (open decisions and exceptions across controls), Review (independent review
  queue).
- Home queue filters (role, stage, phase); approvals as queue rows; `attentionQueue` retired;
  one request component.
- **Accept when:** every action on the Test plans, Approvals and phases pages is available
  in Testing or the queue (checklist from §5 as a test); batch approval records one decision
  per plan version; the queue and the companion show identical items.

### Milestone 3: Agent Companion and navigation consolidation

- Companion panel with page context, explain / draft / act distinction, citations, and the
  existing confirm flow; global threads inside it.
- Navigation to six items; redirects from §5; Approvals, Test plans, Project plan, Timeline,
  Deficiencies, Agent console removed as menu items; classic control view removed.
- **Accept when:** every old section URL and every stored link shape lands on the right
  record; the companion refuses to act where the button would (same 403s, same approvals);
  no page recomputes the queue.

### Milestone 4: Onboarding and the design system

- Four-step wizard for DRAFT engagements with readiness states; optional configuration in
  Settings; agents propose, people confirm required facts.
- Design tokens and the shared components (stepper, "agents did / needs you" card, progress
  ring, pills, skeletons, empty states, toasts with undo) applied across the six
  destinations.
- **Accept when:** a new engagement reaches "ready for planning" only when `readiness.assess`
  passes; no required field has a silent default; the owner launches a test engagement in
  under ten minutes; visual regression screenshots approved at both widths.

### Milestone 5: The guided feel

- Command palette (⌘K), keyboard shortcuts (J/K next control, A approve where allowed),
  "next control in this stage" flows, completion moments, autosave.
- **Accept when:** a reviewer clears a stage's queue with the keyboard alone; every shortcut
  respects permissions; the suite, Node tests and screenshots pass.

---

## 8. Decisions (made by the product owner, 19 October 2026)

1. **Readiness states**: computed from existing records; no new persisted project status
   unless technically necessary.
2. **Testing sub-tabs**: Plans · Phases · Results · Review.
3. **Approvals URL**: `section=approvals` redirects to Home with the Approvals filter;
   existing deep links keep working.
4. **Classic view**: kept through Milestone 2 as a fallback; retired only after validation.
5. **AI workforce tasks**: under Settings, with each control's and testing activity's own
   execution history reachable from where it happened.

## 9. Final refinements (owner's conditions on implementation)

- **A. Navigation is not state.** The step guides; the overall control state, each phase's
  state, the current actionable task and the outstanding blockers are derived and exposed
  together, so nothing parallel is hidden (§4.2).
- **B. Ready for testing is per phase** and needs the approved plan at its current
  revision, the phase's release, the required evidence, population and sample readiness,
  and no unresolved dependency (§4.4).
- **C. Mandatory review stands.** Batch approval excludes plans with unresolved
  clarifications or material uncertainties; approval records stay version-bound; reviewer
  independence is unchanged (§4.3).
- **D. Traceability is whole**, from objective and risk to review decision; approved-plan
  changes trigger an impact assessment and stale results are never treated as valid (§4.5).
- **E. Milestone 0 covers the hard scenarios**: overlapping phases, incomplete evidence,
  plan revisions after testing, review notes reopening work, exceptions, remediation,
  retesting and roll-forward dependencies (§7).
- Changes stay minimal; business logic and authorization are preserved; inconsistencies
  found are flagged in the milestone report, never resolved by silently changing the
  methodology.
