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
