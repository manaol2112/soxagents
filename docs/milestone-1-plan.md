# Milestone 1: the guided control workspace (implementation plan for approval)

Status: **approved; M1a built (see §9).** Milestone 1 builds the control workspace the
owner approved in [workflow-redesign.md](workflow-redesign.md) §3 on the W1–W4 backend
([workflow-integrity.md](workflow-integrity.md)). Scope is the auditor's experience of one
control; the W1–W4 safeguards are not touched; no new destination, menu change or page is
added (those are Milestones 2 and 3).

The interface must make immediately clear: where the auditor is in the workflow, what is
complete, what blocks progress, what the agent recommends, and what the human must do next.

---

## 1. Inventory: what exists today

**Shell and routing.** `workspace-view.tsx` (5,053 lines) holds the sidebar (`NAV_GROUPS`),
the section router, and the shared primitives every page uses: `PageHeader`, `CardHeader`,
`StatusPill`, `Banner`, `Metric`, `EmptyState`, plus `UiIcon`, `ConfirmAction`, `OnceForm`,
`ChoiceForm`, `SuggestedAnswer`, `AnswerProgress`, `AutoRefresh` and the `confirm-dialog`
pattern. Pages are server components; interactive parts are `"use client"` islands (45
files) that post to server actions and refresh.

**The control record** (`controls-view.tsx`, `ControlRecord`, lines 947–1800) renders seven
tabs from `tab=`:

| Tab | Components today |
|---|---|
| overview | `NextActionPanel`, `NextActionLine`, `SummaryMetrics`, `RecordSections`, `AiActivity` (`control-workspace.tsx`); `PhasePanel` / `PhaseStep` (`control-phases.tsx`: design, interim, roll-forward, review, each with its steps, state derived **client-side** by `stateOf`) |
| design | `ReadinessPanel`, `DesignPanel`, `AttributesPanel`, `IssuesList`, `ProcessPanel`, `DocumentsPanel` (`control-context-view.tsx`), `TestBasisCard`, `TestPlanCard` / `TestPlanSummary` |
| evidence | `EvidenceRequests`, `ControlEvidence`, `EvidenceWorkspace`, `PhaseEvidencePlan` / `PlanDetails` (`evidence-plan-view.tsx`), `RequestReview` |
| testing | `TestSheetCard` (`sheet-view.tsx`), `TestRounds` (`round-view.tsx`), `WorkpapersTab` |
| findings | `FindingsTab` |
| review | `ReviewTab` (`review-view.tsx`) |
| activity | `ActivityTimeline` |

**Engagement-wide pages** that the workspace links to and must not duplicate: Test plans
(`planning-view.tsx`: `PlanReview`, the queue, `PhasesView`), Evidence center, Home
(`home-view.tsx`: journey bar and *Do next*), the agent console.

**Design system.** Tokens already exist on `:root` in `globals.css` (colour, type scale
`--fs-*`, radius, shadow, surfaces, tones); 13 stylesheets, 36k lines in all, with the
control record's own `control-workspace.css` (4,725 lines, `cw-*` classes). Inter, a dark
sidebar, light surfaces, pills for status. No component library; everything is in-house.

**Backend contracts available from W1–W4** (read by no page yet, except Home):

- `ControlRow.journey`: step, step phase, action, per-phase state and readiness with
  blockers, control-level blockers, `reopened`, `stale_results`, `final`,
  `not_final_because`. `ControlRow.final`, `not_final` (reason, step, phase),
  `reopen_reason`, `round_reviews`, `readiness_state` (now with `IMPACT_PENDING`).
- `RoundBody.review_status`, `readiness_state`, `readiness_blockers`.
- `/reviews`: `test_round_id`, `round_kind`, `coverage`; `POST …/reviews/{id}/coverage`.
- `/impact`: assessments with the agent's recommendation and `viewer_can_decide`;
  `POST …/impact/detect`, `POST …/impact/{id}/decide`.
- Sign-off history tables (`test_sheet_signoffs`, `control_review_signoffs`) with no read
  route yet.

Web models already parse `final`, `notFinalBecause`, `reopenReason`, `testRoundId`,
`roundKind`, `coverage` and the journey (`home-model.ts`).

---

## 2. Reconciling the approved design with W1–W4

| Approved design (§3) | Backed by | Note |
|---|---|---|
| Stepper Plan → Request → Test → Conclude → Review, any step openable | `journey.step`, `journey.phases` | `tab=` values map to steps (`LEGACY_TABS`) |
| Phase strip: D&I, interim, roll-forward, remediation, retest | `journey.phases` (W4 order), each with state, `ready_for_testing`, blockers; `REVIEWED` per round (W2) | Replaces `control-phases.tsx`'s client-side `stateOf` |
| "What the agents did" / "Needs you" with one primary action | `next_step`, `actor`, `yours`, `not_final[0]`; agent runs (`agents`) | Primary action is the register's; `Change…` holds the rest |
| Reopened step with reason | `progress = TESTING_REOPENED`, `reopen_reason`, `reopened_from` | |
| Blockers never hidden | `journey.blockers`, round `readiness_blockers`, `not_final` | |
| Trace rail attribute → evidence → result | sheet items and attributes (`sheet-model`), evidence plan requirements (`evidence-plan-model`), files | Existing data, new presentation |
| Receipts (who, version, when) | sign-off history (W3) | **Needs two read-only routes** (sheet and review sign-offs); the only backend work in M1 |
| Not in the original design, added by W1–W4 | impact assessments and their recommendations (W3), coverage assessments (W3 follow-up), round reviews (W2), `IMPACT_PENDING`, `final` and its reasons (W1) | Surfaced contextually in the steps they belong to |

---

## 3. Component plan

**Reuse as-is** (no change beyond placement): `PageHeader`, `CardHeader`, `StatusPill`,
`Banner`, `Metric`, `EmptyState`, `ConfirmAction`, `ChoiceForm`, dialogs; `PlanReview`
sections (Test plans); `ReadinessPanel`, `AttributesPanel`, `TestBasisCard`;
`PhaseEvidencePlan`, `RequestReview`, `EvidenceWorkspace`; `TestSheetCard`,
`TestRounds`, `WorkpapersTab`, `FindingsTab`, `ReviewTab`; `ActivityTimeline`; Home.

**Simplify** (same component, less to read, driven by the API's state):

- `PhasePanel` / `PhaseStep` → the **phase strip**, fed by `journey.phases`; `stateOf` and
  `currentStage` (client-side derivations) retired.
- `NextActionPanel` → the **Needs you** card: `next_step` as the one primary action, the
  reason from `not_final[0]` or `reopen_reason`, `Change…` for the rare verbs of the step.
- `RecordSections` → collapsible **Details** under the step.
- `ControlRecord`'s tab router → a **step router** (`step=` with `tab=` mapped); the seven
  tabs stay reachable behind "All details" until Milestone 2 validates the workspace.
- `TestRounds` → shows each round's readiness blockers and review status (new fields).

**Replace**: the seven-tab header (by the stepper); the duplicated client-side state
derivations (by `journey`). Nothing else is removed in M1.

**New, small, all presentational over existing data or routes**:

- `StepperBar` (5 steps, `aria-current`, done/current/upcoming marks).
- `TraceRail` (attribute → evidence → result for the active phase).
- `ReceiptsStrip` (sign-off history; needs the two read routes).
- `ImpactPanel` (assessments for the control: recommendation with rationale and items,
  the reviewer's VALID / REPERFORM form behind `viewer_can_decide`, rationale required).
- `CoverageForm` (on a signed review: COVERS / REQUIRES_REVIEW, reviewer only).
- `RoundReviews` (in the Review step: each round's review, its state, its coverage).
- `AgentSays` (one consistent block: what the agent did, what it recommends and why,
  with the record it cites; used by impact, review notes and the plan's flags).

Every human action keeps its explicit button and `ConfirmAction`; nothing is decided
from a recommendation, and `viewer_can_decide` / `yours` gate what a person sees as
actionable. No new write route is added.

---

## 4. The workspace, step by step

```
Header: ‹ Prev · REF · title · system · frequency · key · owner · status pill · Ask · Next ›
Stepper: ✓ Plan  ✓ Request  ● Test  ○ Conclude  ○ Review   (from journey.step)
Phase strip: [✓ Design] [● Interim · testing] [○ Roll-forward · not released] [+ Remediation/Retest when opened]
Needs you: <next_step> [primary] [Change… ▾]   reason: not_final[0] / reopen_reason
Agent says: what it did · what it recommends · why · cites
Step body (current step) | Trace rail (attribute → evidence → result) | Receipts
Blockers (always visible): journey.blockers, round readiness, impact pending, coverage gaps
Details (collapsed) · All details (classic tabs, until M2)
```

| Step | Body | Contextual items surfaced |
|---|---|---|
| Plan | `PlanReview` sections, `TestBasisCard`, readiness | **Impact assessments** (pending first) with the agent's recommendation; plan approval (unchanged gate) |
| Request | `PhaseEvidencePlan` per phase, `RequestReview`, releases | Outstanding approvals of requests; phase release state; round request readiness |
| Test | `TestSheetCard`, `TestRounds` | Round readiness blockers (remediation evidence, operating period, population); `TESTING_REOPENED` reason; impact `REPERFORM` reopenings |
| Conclude | `WorkpapersTab`, `FindingsTab` | Deficiency remediation state; retest readiness; `final` reasons |
| Review | `ReviewTab`, **`RoundReviews`**, **`CoverageForm`** | Review coverage gaps; reviewer-only actions; independence refusals as today |

---

## 5. Sequence and acceptance

Each part ships with Node model tests, API tests for any route added, `make test-fast`
and `make test-critical`, screenshots at 1440 and 390 measured, lint and type checks.

| Part | Builds | Accept when |
|---|---|---|
| **M1a** Frame | `StepperBar`, phase strip from `journey`, Needs-you card, blockers, `ReceiptsStrip`; two read routes `GET …/test-sheets/{id}/signoffs`, `GET …/reviews/{id}/signoffs`; step router with `tab=` mapping; "All details" fallback | Opening any control shows step, phases, next action and blockers above the fold at both widths; old `tab=` links land on the right step; no client-side state derivation remains for stage or phase |
| **M1b** Step bodies | The five step bodies from the reused components; `ImpactPanel`; `RoundReviews`; `CoverageForm` | Every action of the seven tabs is reachable from a step (intent-coverage test); impact and coverage decisions work end to end for a reviewer and are refused for the signer; screenshots |
| **M1c** Agent and trace | `AgentSays`, `TraceRail` | Each attribute shows its evidence and result for the active phase; every recommendation shows its rationale and cites its record; nothing acts without a person |
| **M1d** Close | Retire `stateOf` / `currentStage`; docs; the owner walks one control Plan → Done without "All details" | Owner's walkthrough; `test-critical` green |

Estimated size: M1a and M1b are the bulk; the work is extraction and composition inside
`controls-view.tsx` and `control-workspace.tsx`, not a rewrite.

---

## 6. Testing (approved strategy)

`make test-fast` with `FAST_PY` set to the control and review tests plus the two new route
tests, `FAST_NODE` to the control-workspace, engagement, review, round, sheet and new
workspace models; `make test-critical` before each part's report; screenshots at both
widths for every visual change; no full legacy suite.

---

## 7. Risks

- `controls-view.tsx` (2,388 lines) and `workspace-view.tsx` (5,053): changes are made by
  extracting components, never by rewriting the files, to keep the diff reviewable.
- Server components with client islands: the stepper is server-rendered from `journey`;
  only forms are client islands, as today.
- 36k lines of CSS: M1 adds `cw-step*` styles on the existing tokens and touches no global
  rule; the full design-system pass stays Milestone 4.
- Duplication guard: the Plan step embeds the same `PlanReview` the Test plans page uses;
  impact and coverage have one panel each, linked from the steps, never copied.

---

## 8. Decisions needed before M1a

1. **Commit first.** 168 files are uncommitted (Home, Milestone 0, W1–W4). Commit them as
   one reviewed commit before the redesign so `make test-changed` is meaningful and the
   M1 diff stands alone. Recommended.
2. **Classic tabs** reachable behind "All details" through M1 and retired in Milestone 2.
   Recommended.
3. **Two read-only routes** for sign-off history (receipts). Recommended; no writes.
4. **Where impact decisions live**: the Plan step (the revision is a plan matter), with
   the Review step linking to the same panel. Recommended.
5. **Agent recommendations' wording**: "The agent recommends … because …" with the items
   it compared, and "A reviewer decides" beside every recommendation. Confirm.

---

## 9. M1a as built

- **Two read routes** (tenant- and project-scoped, `task.read`): `GET
  …/test-sheets/{id}/signoffs` and `GET …/reviews/{id}/signoffs`, returning each sign-off
  as made (signer, time, conclusion or coverage, version, plan revision) and, when it was
  opened again, by what and why. `test_signoff_history` covers the records, a reopening,
  and refusal across tenants and projects.
- **Web models** (`control-journey-model.ts`, `signoff-model.ts`): the API's journey
  parsed as given; the five steps with done / current / upcoming from the journey alone;
  the step a link asks for (`?step=`) else the journey's; each applicable phase with its
  state in words; the Needs-you card, role-aware (`yours`, `actor`), with the reason the
  step is open only when it is not the action itself; the outstanding list, each cause
  once with the phases it holds, work not yet reached left out; testing complete, review
  complete and final kept apart; receipts in words. 36 Node tests.
- **The frame** (`control-stepper.tsx`, server-rendered): stepper, completion line
  (testing · review · final), phase chips, Needs-you, Outstanding with a link to the step
  where each item is resolved, On record (receipts). The control record shows it when no
  classic tab is asked for and renders the step's classic body under it; "All details"
  opens the seven tabs unchanged; old `tab=` links still land on their tab.
- Verified at 1440 and 390 on the dev engagements: a control whose action is the viewer's
  (Approve the evidence plan) and one that waits on the client (Waiting for evidence); the
  next action sits above the fold at both widths; no horizontal overflow. No engagement
  the owner belongs to has a signed-off sheet, so receipts are shown by the API tests and
  model tests rather than a screenshot.
- Not in M1a: the step bodies (M1b), the agent block and trace rail (M1c), retiring the
  client-side derivations (M1d).

## 10. M1b as built

The step bodies gain the workflow interactions W1–W4 introduced, each where the step's
work is, without a new write path: every action goes through the existing registered
routes with the same authorization, the same approval gates and the same records.

- **Terminology.** The one gate is named *Approve the test plan* everywhere (register
  next step, evidence gate text, request details, evidence center). "Evidence plan" was
  the same gate under another name; no gate was merged or removed.
- **Phase dependency wording** distinguishes three things: what blocks an action now
  (the Needs-you card and the phase's own cause), what is outstanding before the control
  is final (the Outstanding list, each item linked to the step that resolves it), and a
  future phase not yet released ("Not released yet: release is recommended once design
  and implementation testing is complete; a reviewer may release it earlier"). The
  outstanding list no longer repeats the API's phase lines or its impact line when the
  not-final reason already says so.
- **Plan step: impact assessments** (`impact-model.ts`, `impact-panel.tsx`,
  `app/workspace/impact/route.ts`). Each assessment shows what was signed off, by whom,
  under which revision, the agent's recommendation with its rationale and the item-by-item
  comparison, and links to the testing and the review it is about. Only the viewer the
  API marks `viewer_can_decide` (a reviewer who did not sign the testing) sees the
  decision form (VALID or REPERFORM, rationale of three characters or more); everyone
  else sees that it waits on the independent reviewer. The form posts to the existing
  `POST …/impact/{id}/decide`; the API checks the role, the signer's exclusion and the
  version again. A pending assessment the viewer may decide is the Needs-you card itself.
- **Testing and Review steps** carry a banner while an assessment is pending, linking to
  the Plan step: nothing relies on the signed-off results until the reviewer decides.
- **Review step: round reviews** (`round-reviews.tsx`). Each testing round's own review
  (W2) is listed with its state (open with notes to decide, ready to sign off, or signed
  off and what it covered); opening one shows the full review — the agent's
  re-performance, the proposed notes to accept or dismiss, the sign-off — through the
  existing review component, so the reviewer independence rules apply unchanged.
- **Historical coverage assessments** (`coverage-form.tsx`). A signed review whose
  coverage of a later testing version is unknown shows a form (COVERS or REQUIRES_REVIEW
  with a rationale) posting to `POST …/reviews/{id}/coverage` (W3); the record is
  immutable and shown once made.
- **The step in hand.** A roll-forward or retest round in testing is the control's step,
  the register's stage (*Ready for testing*) and the next action (*Finish the retest
  testing and sign it off*), whether or not the opinion is reached, before the interim's
  workpapers or review, which stay outstanding. `control_journey.round_in_hand` and
  `leading_reason` drive all three so they never disagree. In the stepper a step behind
  the journey's with work still in hand is shown as *working*, never as done; the step a
  link opens is outlined.
- **Verified** on six fixture-built scenarios at 1440 and 390 (`docs/review/m1b/`, index
  in `docs/review/README.md`): plan awaiting approval; evidence awaiting the owner;
  testing ready for execution; a round awaiting independent review; an impact assessment
  requiring a reviewer's decision (reviewer and signer views); a completed control with
  receipts.
- **Browser smoke tests** (after the report, at the owner's request; `docs/review/m1b/
  e2e-*.png`): the impact decision and the coverage assessment were exercised end to end
  in headless Chrome against the demo database — loading, client validation (disabled
  button, native required fields), submission, the success state after refresh or
  redirect, a stale tab's conflict shown inline, and the signer's and preparer's views
  without forms. The review's sign-off record was compared byte for byte before and
  after the coverage assessment: unchanged. Plain review forms posted from a guided step
  now return to that step (the route reads the step from the referer, allowing only the
  five step names) instead of the classic tab.
- **Remaining UX issues** (M1d, retiring client-side derivations): the classic testing
  body's group headers derive their own status ("Roll-forward and retests — Not started"
  while a retest is testing; a roll-forward workpaper offered when the roll-forward is
  not applicable); the review step repeats the generic "the independent review opens
  when…" explanation above the round reviews; the Needs-you card and the On-record line
  are server-derived but the classic bodies under them are not yet.
- Not in M1b: the agent block and trace rail (M1c), retiring the client-side derivations
  (M1d).

## 11. M1c as built

Two presentational components over records the workspace already loads; no API change,
no new write path, no migration.

- **Agent says** (`agent-says-model.ts`, `agent-says.tsx`): one block under the Needs-you
  card, for the open step. *Did*: what the agents actually did, from the records (the
  plan's generation runs, the sheet's tested samples and cited passages, the review's
  re-performance and notes, the control's agent activity); a run in progress is said to
  be in progress. *Proposes*: the agents' proposal worded as a proposal (a plan for
  approval, a conclusion, a deficiency, review notes, an impact decision) with its
  recorded reason; nothing proposed is ever shown as done, and a person's sign-off is
  attributed to the person. *Based on*: the records behind it as links (attributes with
  exceptions, cited evidence files, plan changes, assessment, notes). *Decision*: the
  decision still pending and whose it is. *No proposal* or *Caveat*: when the records
  give no basis (no sheet, no results, results or notes that cite no evidence, a plan
  missing information, an assessment the rules could not judge) the block says so
  instead of recommending.
- **Trace rail** (`trace-model.ts`, `trace-rail.tsx`): the chain objective → risk →
  procedure → attribute → evidence → result → exception → conclusion → review as compact
  chips, each stating whether its record exists (recorded, partly, not on record); open,
  each link's records and a table per attribute of the evidence its results cite and what
  they found. Objective and procedures come from the approved plan's phase, the risk from
  the control, attributes from the sheet or the approved set, evidence from the phase's
  requirements and the results' citations, results and exceptions from the sheet,
  the conclusion from the control's canonical state, the review from its record. A
  missing link is shown as missing; `unsupportedLinks` lists them.
- **Placement**: both inside the guided frame (`control-stepper.tsx`); the classic view
  is unchanged. The step's sheet and review are the round's when the journey is at a
  roll-forward or retest, else the control's own; with no control review yet, an open
  round review is the step's work.
- **Verified** at 1440 and 390 on five demo scenarios (`docs/review/m1c/`).
- **Missing or unsupported trace links seen in the scenarios**: the retest's rail takes
  objective, procedures and evidence from the interim phase, because the plan has no
  phase record for a retest (it says "for interim operating effectiveness"); no results
  cite evidence until the tester runs; the plan-awaiting-approval control has no evidence,
  results, exception, conclusion or review record, and says so.
- **Remaining UX issues** (carried to M1d with the earlier three): the plan proposal's
  reason is the plan's summary, which restates the control statement at length; the
  retest's agent block says "Testing is running now" from the sheet's run state even when
  no worker is configured, which is the record but reads oddly in a demo without a
  worker; the agent block repeats the Needs-you decision in its own words when the
  reviewer is the viewer.
- Not in M1c: retiring the client-side derivations in the classic bodies (M1d).

## 12. M1d as built

Corrections to what M1a–M1c showed, each from a record; no new workflow, no navigation
change, no migration. One read-only route was added.

- **Execution state** (`execution-model.ts`, `GET …/workspace/automation`). "Running" is
  said only when a run record is active (the record's lease: queued or working) *and* the
  automation status says a worker or workflow engine exists. Without one, every place
  that spoke of an agent at work now says automation is unavailable: the sheet headline
  ("Run queued · automation unavailable"), Agent says ("Automation unavailable. A testing
  run is queued, but no agent worker is configured, so it will not start."), the
  workpaper line, the review pill, the register's stage detail ("Run queued; no agent
  worker") and the classic AI-activity lanes. The states kept apart: ready, queued,
  running, completed, failed (stopped), unavailable. Nothing is inferred from the sheet's
  workflow state. The route reads the API's settings (`workflow_address`,
  `local_worker_enabled`) under `task.read`; it serves no secret.
- **Role-aware actions** (`workspace.mark_yours`, `ControlRow.assignees`). A preparer's
  step is the viewer's when they are assigned to the control's task or, with no
  assignee, when they are on the engagement team as lead or preparer. Organization
  permissions alone no longer make it theirs: the engagement reviewer and an admin off
  the team see "Waits on the preparer", with the assignees named when there are any. The
  Needs-you card, Agent says ("The independent reviewer decides…" versus "You accept or
  dismiss…", from `viewer_is_reviewer` and `viewer_can_decide`) and the stepper now
  agree. Approvals keep their permission rule; the requester never approves their own.
- **Agent says, concise.** The default view is Run, Did, Proposes (one sentence with a
  reason cut at a sentence end near 180 characters), No proposal or Caveat, Decision. The
  full reason and the "Based on" references sit behind "Details". The plan proposal's
  reason is now what the plan is built from and how much it asks for, not the plan
  summary.
- **Retest traceability** (`trace-model.ts`, `TraceRound`). For a retest the rail no
  longer borrows the interim plan phase: the objective is the round record ("Retest round
  1 of D-001 … no retest-specific objective is on the approved plan", partial), the
  procedure link is missing ("No retest-specific procedures are approved on the plan; the
  interim procedures are not shown as the retest's"), the attributes are stated as
  carried from the control's approved set, and the evidence is the files on the retest
  samples and the round's request, with "The interim evidence requirements are not the
  retest's". A roll-forward keeps its own plan phase.
- **Classic bodies.** The testing panels' headers read the journey's phase states (a
  retest in testing is "In progress"; a released phase with nothing requested is "Not
  started"); the review panel is in progress while the control's or any round's review
  is open. In the guided Review step the generic explanation is gone and, with no review
  of the control's own, one line says why and points to the rounds' reviews. The
  conclusion says, when the testing was signed off not effective and the control is
  effective, that the proposed deficiency was dismissed by a person (with the reason) and
  that the reviewer concluded on the signed-off review. "All details" still opens the
  classic view.
- **Walkthrough.** Plan → Request → Test → Conclude → Review verified on the demo
  scenarios at 1440 and 390, with a new scenario where testing is complete and the review
  open: the completion line reads "Testing complete · Review pending · Not final", the
  stepper's Review step is current, the card waits on the reviewer, and the conclusion
  reads "Not concluded". Parallel work is shown where the records allow it: in the
  round-review scenario the roll-forward round's review is open while design evidence is
  still to be requested; in the retest scenario the retest is the step while the
  interim's review remains outstanding.
- **Tests.** `tests/execution-model.test.ts` (new); the sheet headline, register stage,
  classic lanes, journey, agent block and trace tests updated for the new meanings (each
  old expectation replaced by the with-worker and without-worker pair); Python:
  `test_control_progress` gains the engagement-role rule, the admin-off-the-team case,
  the assignees, and the automation route and its settings cases.
- **Still unsupported or incomplete.** The retest's objective and procedures remain
  unsupported links until the plan records a retest phase (M2 scope). The classic
  "Your next action" panel and the register's queue derive their own next action and can
  differ from the guided Needs-you card (the classic view is retired in M2). Failure of a
  tester run is not recorded distinctly from idle on the sheet (`run_status` has no FAILED
  value), so "Stopped" is shown only for drafting and re-performance, where the records
  carry it. The agents' `stopped` list is per control, not per round.

## 13. Milestone 1 completion report

**Delivered** (M1a–M1d, commits 4e1987f and 1574154 plus the M1d working tree): the
guided control workspace. A control opens as a map of where it is: five steps from the
API's journey that gate nothing; the testing phases with their own state; one Needs-you
card naming the next action and whose it is, by assignment or engagement role; an Agent
says block that keeps recorded facts, agent proposals, supporting records and pending
human decisions apart and reports execution from run records and the automation status;
a compact trace rail from objective to independent review that draws no link without a
record; the Outstanding list linked to the step that resolves each item; the sign-offs
on record; and the step bodies with the W1–W4 interactions (impact decisions, round
reviews, coverage assessments) through the existing routes. "All details" keeps the
classic view until Milestone 2.

**Preserved**: authorization (every write through the registered routes and the
authorization layer), segregation of duties (the signer never decides the impact of
their own testing; the preparer never assesses coverage; the reviewer role decides notes
and signs), approval gates (one, named "Approve the test plan" everywhere), and audit
traceability (immutable sign-off history; the coverage assessment leaves the sign-off
byte-identical, checked in the browser).

**Tests actually run for M1d**: `make test-critical` 351 passed in 4 min 45 s;
`make test-fast` (see docs/test-strategy.md §5 for the run); all 701 Node tests pass;
type checks clean; lint clean except the known `biome.json` line endings.

**Unsupported trace links and incomplete agent functionality**: as listed under M1d
above. **Recommended next**: Milestone 2 (validate the workspace with users; retire the
classic view; a retest phase on the plan so the retest's objective and procedures become
recorded links).
