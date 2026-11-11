# The control as its workflow: D&I and OE branches

Status: **the web workflow is built (8 November 2026) and awaits the product owner's review; it is not committed.** The backend increments below are proposed for review before they are built.

The product owner restructured the workflow on 8 November 2026 with their own diagram:

> Build evidence as a reusable service, with two explicit evidence workstreams—D&I and OE—rather than a single evidence step late in the audit. This allows agents to request and evaluate walkthrough support early, while preserving a clean, non-overwhelming main workflow.

Decided (four questions):

1. Sampling, results and exceptions, retest and roll-forward live inside **OE Testing**.
2. D&I evidence is requested after Control Understanding, with **its own human approval**. The OE test plan approval gates only OE evidence.
3. **OE waits for an effective design** (corrected by the product owner the same day: "OE can't start if design is failing"; AS 2201). OE planning (Test Design & Approval) may run while D&I is under way. OE evidence requests and OE testing start only once D&I is concluded effective. When D&I is concluded not effective, OE is not performed, and the control concludes not effective on the design deficiency, which goes to remediation. This replaces the first choice, that the branches run in parallel.
4. Population integrity becomes a check inside OE Evidence, and sign-off and lock become part of Final Workpaper. Both are marked as not available yet.

The decisions of the 14-step design (below) still stand: one click opens a step's panel, the guided setup's screens open inside steps, and pass/fail guidelines go into the firm methodology.

## The workflow (built)

Laid out 8 November 2026 (product owner: "the flow does not make sense"). Time runs left to right and every edge runs forward or down; four bands, one per stage, on a drafting grid.

```
UNDERSTAND     D&I BRANCH                                                     CONCLUDE
Setup          D&I Evidence → D&I Assessment → D&I Conclusion ── not effective ─┐
  ↓                                                 │ effective                 │
Understanding ┤                                     ↓                           ├→ Control Conclusion
               OE BRANCH                                                        │        ↓
               Test Design & Approval ────────→ OE Evidence → OE Testing ───────┘  Independent Review
                                                                                         ↓
                                                                                  Final Workpaper
```

- OE starts one column later than D&I: Test Design may begin once the control is understood, and OE Evidence sits directly under the D&I Conclusion that clears it.
- The layout is tested: no edge runs back, the effective edge drops straight down, the "Not effective" label sits clear of every step, and each band holds only its own steps.

- OE Evidence and OE Testing show "Waiting on D&I conclusion" until D&I is concluded effective. They show "Not performed: design not effective" when it is concluded not effective, and the conclusion is then proposed as not effective without OE.
- OE work done before this gate existed still shows as it stands; it is never called not performed.
- D&I's verdict is read from today's records: the prepared design workpaper, and any design-type deficiency.

- **Evidence is one service.** D&I Evidence is the plan's Design phase, and OE Evidence its Interim and Roll-forward phases: the same requests, intake and review.
- **Each step shows a state, never an instruction.** A step that cannot begin says what it waits on ("Waiting on OE evidence").
- **Next steps.** One step is marked Next per open branch, and the header names each one.
- **Not built yet.** Each panel says plainly what is missing.
- **Panels:**
  - Steps 02 and 06 show the guided setup's screens.
  - D&I Assessment and D&I Conclusion show the design section (plan, procedures, design workpaper).
  - OE Testing shows the testing and findings sections together.
  - Activity opens from the header.
- **Statuses read from today's records:**
  - D&I Assessment comes from the design workpaper (drafting, draft, prepared).
  - D&I Conclusion comes from the reviewer's sign-off (B2, built): "Effective · to sign off" until signed, "Effective · signed off" or "Not effective · signed off" once signed, and "Out of date · to sign again" when its basis changed.
  - OE Evidence and OE Testing wait on that sign-off. OE work recorded before it is flagged "Started before D&I sign-off", never shown as progress. OE work recorded before a design signed off as not effective reads "Not relied on".
  - The Control Conclusion is proposed once both branches are done, and final at the review.

Known limitations:

- The evidence section opens with all phases; its phase filter is not in the address.
- The two D&I steps share the design section.
- Final Workpaper shows the testing section, where the workpapers are.
- The workflow is framed to fit: about 77% at 1440 px and 72% at 1366 px (the app's sidebar takes the rest), 94% at 1680 px.

## Backend increments (B0 to B3 built; C proposed)

The workflow reads today's records honestly. Three of the product owner's decisions need backend changes. They touch approval boundaries and audit conclusions, so each runs the critical tier.

**B0. The OE gate in the backend. Built 8 November 2026** (the product owner chose to build the step panels, B0 and B3 together).

- `design_conclusions.oe_gate_reason()` reads the standing D&I verdict. Until it is signed off effective, the server refuses: an Interim or Roll-forward phase release (early or not); an OE evidence request going for approval or out, whoever drafted it (`evidence_plans.held_for_planning`); sample approval (`control_tests._approve`); and an OE test sheet's sign-off (`test_sheets.sign_off_work`). The tester agent waits (`readiness.waiting_reason`, after the control's own readiness), and testing that waited resumes when D&I is signed off effective.
- A not-effective sign-off refuses OE for good ("operating effectiveness is not tested") and opens the control's independent review on the design alone, with nothing for the reviewer agent to re-perform.
- The phase progress counts D&I complete at the effective sign-off, not at the prepared design workpaper, and the evidence lists label an OE request held for it "Awaiting the D&I sign-off".
- The synthetic Northstar demo has its reviewer, Riley Okafor, sign each D&I conclusion after Morgan Lee prepares the design workpaper.
- Tests: `sign_off_design` in `tests/support.py` records the sign-off for tests of what follows D&I; tests of the D&I work itself pass `design=False`. Tests whose expectations encoded OE before D&I were rewritten, each with the old and the new expectation noted.

**B1. D&I evidence with its own approval. Built 9 November 2026** (migration 0145; the product owner: "proceed"). Before, one status, the evidence plan's APPROVED, gated every phase, and any plan revision held all of them.

- The **D&I release** is a `phase_releases` row with phase DESIGN, like the Interim and Roll-forward releases. An Owner, Admin or Project Manager releases it (`Action.PROJECT_UPDATE`; an agent never does). It is recommended ("Ready to release") once Control Understanding is complete: the client values the control's statement needs are recorded, no question on the control is open, and a business process control's process understanding is confirmed (`phase_release.understanding_waits`). Before then a person may release it early, with a reason of at least 20 characters, recorded with the release.
- It needs a plan, not its approval, and it is refused while the planner is drafting the plan. Releasing it requests the Design phase's items and queues their drafts. Each request still needs its own approval before it is sent; nothing is sent by the release.
- The Design phase's gate (`evidence_plans.gate_reason_from`) reads the release and never the plan's status, so revising the test plan holds only the operating evidence. The same rule is read by the request details, the evidence list ("Awaiting the D&I release"), the coordinator's unrequested controls, the launch summary, and the control's next step ("Release the D&I evidence").
- What a person released is not extended by the agent: a planner run's additions or material changes to released D&I items are proposed to a person (`pending_change`), as on an approved plan.
- Backfill: a control whose plan a person approved, or whose design requests were already sent, is recorded as released (its approver named where the plan records one), so nothing in flight is held.
- The web: the D&I Evidence step reads "To release" once the control is understood, and its panel offers the release (with the reason when early) and confirms it once the server has recorded it. The phases board and the Test Design release strip offer the D&I release with the interim and roll-forward ones, for one control or a selection at once.
- Tests: `tests/test_design_release.py` (critical tier). `release_design` in `tests/support.py` records the release for tests of what follows it.

**B2. A D&I conclusion with a reviewer. Built 8 November 2026** (migration 0143, `design_conclusions.py`; the product owner: "proceed").

- The records propose the verdict once the design workpaper is prepared: effective, or not effective while an unremediated design deficiency is logged. The agent does not draft a separate conclusion: the verdict follows the records.
- A team member with the reviewer role who did not prepare the design workpaper signs it off, for the workpaper at its prepared version. The reviewer cannot sign a different verdict; a disagreement is a design deficiency to log, or the workpaper to reopen.
- Each sign-off is kept as made (trigger-enforced; one stands per control). Reopening the design workpaper reopens it. A design deficiency logged, remediated or closed afterwards puts it out of date. A reviewer can reopen it with a reason of at least 10 characters.
- `design_verdict()` is what the B0 gate and the B3 conclusion read.

**B3. The consolidated conclusion. Built 8 November 2026** (migration 0144, `control_conclusions.py`; the product owner: "the agent proposes, a person rates").

- The conclusion is proposed from the records, never stored: waiting until the D&I conclusion is signed off; not effective without OE when the design is signed off not effective; otherwise effective only when each OE phase that applies is signed off without exceptions (or retested effective, or dismissed with a reason) and no deficiency is open.
- A person rates each deficiency's severity, with the agent's suggestion (from likelihood and magnitude) and its reason pre-filled. Ratings are kept as made (trigger-enforced). A significant deficiency or material weakness still waits for the reviewer through the existing change request; a rating answers a severity requested when the deficiency was logged.
- The control's review is not signed off while a deficiency is unrated, and its sign-off records the proposed conclusion and each severity in its coverage.

## The step panels (built 8 November 2026)

The product owner: the panels "look like a traditional view which does not align with my new workflow and design". Decided: a decision-first layout for every panel, an agent strip in each panel, the agent proposes the conclusion and a person rates, and everything built at once.

- One frame (`step-frame.tsx`, `step-panel-model.ts`): what the step needs from the person, with one action (or what it waits on, naming the step that holds it); the step's own work, with the agent's strip (what it did, what it found, and a question about the step); the steps it is based on; the detail folded; and the step that follows (both ways from the D&I conclusion until it is signed).
- Each panel holds only its own step. D&I Evidence shows the Design phase, OE Evidence the Interim and Roll-forward phases. D&I Assessment shows the design workpaper alone. Test Design holds the full test plan, the testing basis, and scope and sampling ("why each phase applies", moved from Setup). Understanding holds the control definition and the prior year. Control Conclusion is the proposed conclusion with the ratings, and the approvals checklist folded. Independent Review is the review alone. Final Workpaper shows the design and testing workpapers.
- The side-rail assistant is retired from the panels; each panel's agent strip takes its place.

## The next step (built 10 November 2026)

The product owner: "when a new system is added and a control is mapped to that system, clicking the control would go to the nodes. However, it's not very clear what the user would do to begin the setup. Before, I have an agent that pops out." A mock-up was approved the same day, with the recommendation that nothing opens by itself, so the 8 November decision to retire the pop-up stands.

- **A Next step card above the workflow** (`next-step.tsx`, `next-step-model.ts`):
  - **What it says:** what to do, as a plain title ("Confirm how ITGC-AC-02 runs on Workday HCM"); why, from the step panel's own need; what the records show, from the agent's notes. It gives no invented estimates.
  - **Its actions:** one button that opens the step, and "Ask the planner".
  - **Its source:** the workflow the nodes are drawn from. It names exactly the steps marked next (tested), so it cannot disagree with them.
- **It adapts to the control's state:**
  - an agent preparing the step: the step is named as being prepared, nothing is asked of the person, and a progress line shows;
  - both branches open: each step offered with its own action;
  - all done: the control is concluded;
  - nothing for the person: what the control waits on.
- **The node carries the card's words** ("Start here", "Ready", "Being prepared", "Needs attention") in a flag, with a soft pulse that is off under reduced motion. The phone list shows the same words.
- **A journey strip** puts the eleven steps in five plain stages (Set up, Understand, D&I evidence, Test, Conclude), showing where the control is.
- **"Show me around"** opens a three-stop tour: the card, the step on the workflow, and the workflow. It uses the shared spotlight tour with its new `auto={false}`, so it never opens by itself.

## Step 01: the control's details (built 10 November 2026)

The product owner, on the Next step guidance: "revisit the first step in the node. Says start here but there are no actual section where I can put my answers or what are the things that are needed." A newly mapped control usually lacks one RCM detail, its owner. That holds step 01, but its panel was read-only.

- **Step 01 now opens like Control Understanding** (`control-details.tsx`, `control-details-model.ts`):
  - a header ("Complete ITGC-AC-04's details") with "n of 5 recorded";
  - on the left, the control as recorded, each missing detail marked;
  - on the right, each missing detail asked one at a time: the owner's name and email, the frequency or the nature as choices. Back and "Save & continue", then "Continue to Control Understanding".
- **Recorded details:** a detail already recorded can be changed from the record.
- **Details from the library or the RCM** (description, objective, risk) point to Controls setup. They aren't edited here.
- **The full record** (risk and objective, scope, and why each testing phase applies) stays reachable, folded below.
- **Decided by the product owner:** a detail recorded here applies to this system's control. The same control on other systems is offered it where empty, chosen system by system, and a copy never overwrites. The setup editor still sets a control's details on every system at once.
- **Server:** `control_details.py`, `GET` and `PUT {control}/details`.
  - It uses the setup editor's permission (PROJECT_UPDATE, after start) and its checks: known frequency and nature, a valid email, no secrets, and the control's version.
  - Each save and copy is audited (`control.details_set`, `control.details_copied`).
  - A person without the permission sees the record read-only.

**C. Pass/fail guidelines in the firm methodology.** This is increment B of the 14-step plan below, unchanged.

---

# The control as a 14-step workflow: plan

> **Superseded on 8 November 2026** by the 11-step workflow with D&I and OE branches, and its step panels (above). Kept as the record of what was decided and built before; its code (the tabs, the stepper, the guided-setup pop-up and the assistant rail) was removed in the cleanup of 9 November 2026.

Status: **increment A built 8 November 2026, awaiting the product owner's review; not committed. Increment B (pass/fail guidelines) is proposed below for review before it is built.** This supersedes the Flow tab and its stage design in [control-flow-plan.md](control-flow-plan.md).

The product owner asked for this on 8 November 2026, with a reference screenshot. "I only want the Node WF to be the main workspace and only the workspace for my controls but you can leverage the other sections for the double click of each step in the node data flow."

The product owner decided four questions:

1. **Double-clicking a step opens a wide panel over the flow.** The panel shows the step's existing section, and the flow stays visible on its left. The control's eight tabs are removed; every function they held is reached through a step's panel.
2. **All 14 steps show now.** Population Integrity and Final Sign-off & Lock have no records behind them yet. They say so plainly and are built as their own increments.
3. **Pass/fail guidelines belong to the firm methodology, in this milestone.** The attribute and testing agents follow the engagement's pinned version.
4. **The guided-setup pop-up is retired.** Steps 01–04 open its screens when double-clicked, and the flow highlights the step to do next.

## The steps

There are four kinds of node, each drawn with its own colour and label:

- **Source:** what the client's records give.
- **AI agent:** an agent prepares the step's work, and a person can see it and correct it.
- **Human gate:** a person decides; no agent can pass it.
- **Output:** what the work produces.

| # | Lane | Step | Kind | Opens on double-click | Status from |
| --- | --- | --- | --- | --- | --- |
| 01 | Understand & prepare | Control Setup | Source | Control setup: ID, description, objective, frequency, owner, risk and scope (today's Risk & Scoping and control summary) | the control's record |
| 02 | | Control Understanding | AI agent | Upload a narrative, or answer the agent's questions until the methodology's requirements for this control are met (today's setup screens: answers, process, documents) | setup steps, open questions |
| 03 | | Test Design | AI agent | Attributes and the evidence needed for D&I, interim and roll-forward (setup's attributes screen, and the evidence plan) | approved/proposed attributes, the evidence plan |
| 04 | | Planning Approval | Human gate | The test plan for approval (setup's plan screen) | the plan's state |
| 05 | | Evidence Intake | AI agent | Requests, received files, add evidence (today's Evidence tab) | evidence items' states |
| 06 | Collect & execute | Population Integrity | AI agent | Not available yet: completeness and accuracy of the population | none yet |
| 07 | | Sample Selection | AI agent | The samples drawn, and how (Testing tab) | the test sheet |
| 08 | | Execute Test | AI agent | The test sheet (Testing tab) | tested / to test, the run |
| 09 | | Results & Deviations | AI agent | Exceptions and the proposed finding (Findings & Issues tab) | exceptions, the proposal |
| 10 | | Resolution & Retest | Human gate | Findings to resolve, the retest round (Findings & Issues tab) | findings, rounds |
| 11 | Review & finalize | Independent Review | Human gate | The review (Approvals tab) | the review |
| 12 | | Control Conclusion | AI agent | The conclusion (Approvals tab) | the control's conclusion |
| 13 | | Workpaper Output | Output | Workpapers (the Testing tab's workpapers) | the workpapers |
| 14 | | Final Sign-off & Lock | Output | Not available yet: sign-off, lock and retention | none yet |

The steps run left to right in each lane, and the middle lane runs back the other way, as in the reference. A dashed **Retest** edge loops from 10 back to 08. The control's activity record (today's History tab) opens from the header.

## Increments

**A. The workflow as the control's workspace.** This is the web side only, built on the records the page already reads.

- The 14 steps in three lanes, each with its kind, status, a one-line "where it stands", and the next step highlighted.
- One click shows the step's summary; a double-click or Enter opens its wide panel with the step's section.
- The tabs and the pop-up are removed, and the steps not yet available say so.
- On a phone, the workflow reads as a list, and each step opens the same section.

Acceptance:

- Every step's status agrees with its records.
- Every function the tabs held is reached from a step's panel or the header.
- Approvals still show success only after the server confirms.
- No full reload when a panel opens.
- Both themes at 1440, 1366 and 390.

**B. Pass/fail guidelines in the firm methodology.** This adds a migration and changes the agents.

What exists today:

- The platform's testing-definitions library holds global result rules: PASS only on cited evidence, EXCEPTION only when the evidence shows the condition was not met, INSUFFICIENT, REVIEW, and NOT_APPLICABLE.
- It also holds 82 control definitions, with pass, fail, insufficient, review and do-not-infer guidance for each attribute.
- But it is code, labelled a draft for professional review, and not owned or versioned by the firm.

Proposed, for the product owner's review before it is built:

- **Where the guidelines live.** The firm methodology's versions (migration 0142) gain *testing guidelines*:
  - one set of result definitions;
  - one section per control type (ITGC access, change and operations; ITAC; IPE; business process; MRC; entity-level; ITDM), each saying what evidence suffices, what is an exception, what is insufficient, and what needs a person's judgment.
- **The default.** Version 1's guidelines are drawn from the library's current text and labelled as not approved by the firm. A firm changes them by proposing a version, which another Owner or Admin approves.
- **What the agents follow:**
  - The attribute agent drafts each attribute's pass and fail criteria within the control type's guidelines.
  - The testing agent judges each result against them.
  - Both record the methodology version they used.
  - The library's per-control definitions stay as the platform's suggested attributes.
- **Acceptance:**
  - An engagement's agents use its pinned version's guidelines.
  - A change takes effect only after a second person approves it.
  - Each result and each drafted criterion names the version.

**C. Population Integrity.** This is the population's completeness and accuracy, with the IPE checks the library already describes for each population. It is built later (decision 2).

**D. Final Sign-off & Lock.** The final sign-off, after which the control's workpapers are locked, with retention. It is built later (decision 2).

## Risks

- **Reach of increment A.** The tabs hold most of the control's functions. Each is mapped to a step above, and the review checks that none is lost.
- **Increment B changes the agents' prompts.** The prompt versions change, and the agents' tests run in the critical tier.
- **The Overview's attribute lines are removed with the tabs.** They had a known defect: they matched evidence items by attribute code, but the evidence plan names attributes by their text. The workflow's statuses do not match attributes to evidence items, so they do not have this defect. Anything that matches attributes to evidence items again must match on code or on normalised text.

## Increment A, as built (8 November 2026)

- `control-workflow-model.ts` holds the 14 steps, their lanes and kinds, each step's status from the records, the next step, the addresses (earlier tab and step links open the step that holds their work), and the layout. `control-workflow-canvas.tsx` draws it with React Flow. `control-workflow.tsx` holds the workflow, the selected step's summary, the phone list and the wide panel.
- The control page shows the workflow in place of the steps and the eight tabs. A step's panel shows the section the tabs held. Steps 02 to 04 show the guided setup's screens inline (`ControlSetup only=…`), and the setup no longer opens as a pop-up. Activity (the History tab) opens from the workflow's header.
- Control Understanding shows *What is understood* above its screens: the design as documented, else the control statement, and each client-specific question with its answer.
- The Flow tab of the same day (`control-flow*`) is removed; this design supersedes it.
- The address kept `?step=` only up to 10 letters, so "understanding" opened nothing. It now keeps up to 24, with a test that every step's key fits.

Known limitations:

- Steps that share a section show the whole section: Sample Selection, Execute Test and Workpaper Output show the testing section; Results and Resolution show findings; Review and Conclusion show approvals.
- Test Design shows the plan review below the attributes, so its approve action also appears in step 03, as well as at the Planning Approval gate.
- The former Overview's content (the next action bar, the agent's notes, the attribute and file summaries, next best actions) has no step of its own. The workflow's next step and each step's panel take its place.
