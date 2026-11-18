# Review screenshots

Captured from the running app with headless Chrome at 1440×1000 (desktop, full page) and
390×844 (mobile, first screen), as evidence for each milestone's review. Every screenshot
is of fixture data: the demo engagements are built from the test fixtures into a separate
database (`ai_workforce_demo`), with made-up people (Dana Whitfield prepares and signs
off; Riley Okafor is the independent reviewer). No client evidence appears.

## m1a — the guided frame

| File | What it shows |
| --- | --- |
| `ready-desktop-1440.png`, `ready-mobile-390.png` | A control whose next action is the viewer's: *Approve the test plan*. |
| `blocked-desktop-1440.png`, `blocked-mobile-390.png` | A control that waits on the client, with what is outstanding and where each item is resolved. |

## m1b — the step bodies and the reviewer's interactions

Six scenarios, numbered as the owner asked for them. Desktop and mobile of each; the two
reviewer-only interactions are also shown as the person who signed the testing sees them.

| # | Scenario | Files | Viewer |
| --- | --- | --- | --- |
| 1 | A plan awaiting approval | `1-plan-awaiting-approval-*.png` | Engagement owner |
| 2 | Evidence awaiting the owner (drafted, not sent) | `2-evidence-awaiting-owner-*.png` | Engagement owner |
| 3 | Testing ready for execution (a retest whose remediation evidence is in and samples approved) | `3-testing-ready-*.png` | Engagement owner |
| 4 | A round awaiting independent review (the roll-forward round signed off, its own review open with two proposed notes) | `4-round-awaiting-review-reviewer-*.png` | Independent reviewer |
| 5 | A plan-revision impact assessment requiring a reviewer's decision | `5-impact-decision-reviewer-*.png`; `5-impact-decision-owner-desktop.png` | Independent reviewer; the signer (who may not decide) |
| 6 | A completed control with its sign-off receipts | `6-completed-receipts-*.png` | Engagement owner |

Browser smoke tests (headless Chrome driving the real app against the demo database, at
the owner's request after the M1b report):

| File | What it shows |
| --- | --- |
| `e2e-impact-1-form-short-rationale.png` | The reviewer's decision form with VALID chosen and a two-character rationale: the button stays disabled. |
| `e2e-impact-2-decided.png` | After "Record the decision": the pill reads *Results stand*, the decision line names the reviewer and the rationale, the form is gone, the Needs-you card moves on. |
| `e2e-impact-3-stale-conflict.png` | A second tab, loaded before the decision, submitting afterwards: the API's conflict is shown inline and nothing is recorded twice. |
| `e2e-coverage-1-form-validation.png` | The coverage form refusing to submit without a decision and a rationale (native validation). |
| `e2e-coverage-2-recorded.png` | After COVERS: back on the Review step with the notice, coverage reads "Nothing has changed since", the control is final; the sign-off record returned by the API is byte-identical to before. |

The signer of the testing and the preparer of the work were checked in the same runs:
neither sees a form, each sees why it waits on the independent reviewer.

## m1c — the agent block and the trace rail

Same demo engagements. "Agent says" sits under the Needs-you card; the trace rail sits
under the sign-offs on record, compact by default and opened with a click (the
`*-expanded-*` shots).

| File | What it shows |
| --- | --- |
| `plan-agent-proposal-*.png` | Plan awaiting approval: the agent drafted the plan from rules (18 requirements), proposes it for approval with its basis per phase; the decision is a person's. Trace: objective, risk, procedures and attributes on record; evidence, results, exception, conclusion and review not yet. |
| `plan-impact-decided-desktop.png` | The impact assessment after the reviewer's decision: the agent's comparison stays as what it did; no proposal is shown once a person decided. |
| `testing-agent-trace-*.png` | Retest ready: the agent's run is in progress ("results are not in yet"); the trace shows which links have records. |
| `testing-trace-expanded-*.png` | The same control with the rail open: each link's records and the per-attribute table (nothing tested yet, so no evidence is cited). |
| `review-agent-notes-*.png` | A round awaiting review: the reviewer agent's re-performance and its two proposed notes, with the attributes and evidence they cite; the reviewer decides and signs. |
| `completed-trace-expanded-*.png` | A concluded control: every link has a record, from the objective to the signed review, with each attribute's cited evidence and results. |

## m1d — corrections, before and after

The "before" of each correction is an earlier screenshot in `m1b/` or `m1c/`, named
below; the "after" is in `m1d/`. One scenario was added to the demo database for the
walkthrough: testing complete (design and interim signed off), the independent review
open with the agent's notes, not signed (`demo-review-open`).

| Correction | Before | After |
| --- | --- | --- |
| Agent execution wording: a queued run with no worker is no longer "The tester is testing" / "Testing is running now" | `m1c/testing-agent-trace-desktop.png`, `m1b/3-testing-ready-desktop.png` | `testing-after-*.png`: "Run queued · automation unavailable" on the sheet, "Automation unavailable" in Agent says, "draft queued; no agent worker is configured" on the workpapers; `classic-ai-activity-after-desktop.png` for the classic lanes |
| Role-aware actions: the reviewer no longer sees "Needs you" for the preparer's step | `m1c/review-agent-notes-desktop.png` ("Needs you: Prepare the workpapers") | `review-step-reviewer-after-*.png` ("Waits on the preparer") |
| Agent says concise, references behind "Details" | `m1c/plan-agent-proposal-desktop.png` (the plan summary restated the control) | `plan-agent-concise-*.png` |
| Retest traceability: interim objective, procedures and evidence requirements no longer shown as the retest's | `m1c/testing-trace-expanded-desktop.png` | `retest-trace-after-desktop.png` |
| Classic testing headers from the journey | `m1b/3-testing-ready-desktop.png` ("Roll-forward and retests — Not started" while the retest tests) | `testing-after-desktop.png` ("In progress") |
| Redundant review explanation removed in the guided step | `m1b/4-round-awaiting-review-reviewer-desktop.png` | `review-step-reviewer-after-desktop.png` |
| Effective after a dismissed exception, explained | `m1b/6-completed-receipts-desktop.png` | `conclusion-wording-after-*.png` |
| Testing complete, review outstanding: no finality implied | — | `testing-complete-review-open-*.png` ("Testing complete · Review pending · Not final"; the reviewer's view in `-reviewer-desktop.png`) |

Rebuilding the demo database: the builder script lives outside the repository (it drives
the test fixtures); the API is pointed at `ai_workforce_demo` with the test environment
(independence required, no model, no worker, no live email).

## acceptance — the lifecycle walkthrough

One control, ITGC-AC-01, from onboarding to its final conclusion on an isolated database,
twelve stages with a screenshot each (`01-…` to `12-…`), the stage log (`walk-log.md`)
and the sign-off history the API returned (`signoff-history.json`). The report, with
what was real and what was simulated, is [docs/acceptance-walkthrough.md](../acceptance-walkthrough.md).

## m2a — the engagement's one queue

A demonstration engagement (`ai_workforce_m2a`) with controls in different states, built
through the API: ITGC-AC-01 (interim signed off, roll-forward round open, plan revised and
approved so an impact assessment is pending and the round's basis is stale, review open
with the agent's note); AC-02 (samples proposed, population accepted); AC-03 (population
received, not yet accepted: samples blocked); AC-04 (requests drafted, awaiting approval);
AC-05 and the rest of the library (test plan awaiting approval); AC-06 (the tester's run
stopped); AC-07 (requests approved; one marked sent, SIMULATED delivery). Viewers: Dana
Whitfield (lead), Riley Okafor (independent reviewer), Morgan Adeyemi (organization admin
not on the engagement team).

| File | What it shows |
| --- | --- |
| `home-owner-desktop.png`, `-mobile.png` | Home for the lead: My actions, Blocked, Waiting on others, with filter chips; the repeated "Approve the test plan" step as one expandable row. |
| `home-owner-filtered-desktop.png` | The same queue filtered to My actions in the Testing stage. |
| `home-reviewer-desktop.png` | The reviewer: the impact decision and the review note are theirs; the preparer's steps wait on the preparer. |
| `home-admin-off-team-desktop.png` | An admin off the team: preparer's and reviewer's work shown as waiting on others, not as theirs; approvals remain theirs by permission. |
| `console-owner-desktop.png`, `console-reviewer-mobile.png` | The agent console's inbox, the same list. |
| `register-owner-desktop.png` | The register's Needs-attention card from the queue, with the drafted-requests batch. |
| `control-ac02-owner-desktop.png` | A control whose queue item and Needs-you card say the same thing. |

## m2b — queue completeness, four buckets, the Testing destination

A realistic-scale engagement (`ai_workforce_scale`): 155 controls over five systems in
mixed states, built through the API by the fixtures' rules-only paths (no live model, no
worker, no live email: stopped runs are stopped, queued runs say the automation is
unavailable, sent requests are SIMULATED). Viewers: Dana Whitfield (lead), Riley Okafor
(independent reviewer). The states and the queue timings are in
[milestone-2-plan.md §13](../milestone-2-plan.md).

| File | What it shows |
| --- | --- |
| `home-owner-desktop.png`, `-mobile.png` | Home for the lead at scale: the four buckets (Upcoming is empty without a worker), 291 drafted-request approvals as one expandable row, the overdue chase, stopped runs, the blocked samples held by an unaccepted population, the queued re-performance blocked by the missing worker, the waits on the reviewer and the control owner. |
| `home-owner-upcoming-desktop.png` | The queue filtered to Upcoming (empty on this engagement: no worker is configured). |
| `testing-plans-owner-desktop.png`, `-top.png`, `-mobile.png` | Testing › Plans: the Test plans queue embedded under the Testing header and tabs. |
| `testing-phases-owner-desktop.png`, `-top.png` | Testing › Phases: release by phase, embedded. |
| `testing-results-owner-desktop.png`, `-top.png`, `-mobile.png`, `-mobile-top.png` | Testing › Results: every control's testing state, result and next step, with filters and search; the phone layout scrolls the table inside its card. |
| `testing-results-mine-owner-desktop.png` | Results filtered to the lead's own steps. |
| `testing-review-owner-desktop.png`, `testing-review-reviewer-desktop.png`, `-mobile.png` | Testing › Review: the open reviews with their stage and the queue's action; the reviewer's own are marked Yours, the signed-off review with a coverage gap stays in Open. |
| `console-owner-desktop.png`, `-top.png` | The agent console's inbox, the same list without the upcoming items. |
| `walk-1-conclude-before-desktop.png`, `walk-1-conclude-after-desktop.png`, `walk-2-results-after-desktop.png`, `walk-3-review-reviewer-desktop.png`, `walk-log.md` | The multi-control walkthrough: from the Results and Review views, the lead signs off one control's testing, the reviewer accepts one proposed note, the lead starts a stopped tester run again (queued; the queue reports the automation unavailable), and the Results view and the queue counts after. |

## m2c — the six destinations

The same 155-control scale engagement (`ai_workforce_scale`, rebuilt; the lead Dana
Whitfield and the reviewer Riley Okafor), after the M2b conditions and the navigation
consolidation. The navigation inventory, the redirect mapping and the 403-control
baseline are in [milestone-2-plan.md §14](../milestone-2-plan.md).

| File | What it shows |
| --- | --- |
| `home-owner-desktop.png`, `home-owner-mobile.png` | The six-destination menu (Home, Controls, Testing, Evidence, Reports, Settings) at desktop and phone width; Home's queue unchanged. |
| `reports-deficiencies-owner-desktop.png`, `-mobile.png`, `reports-schedule-owner-desktop.png`, `reports-status-owner-desktop.png` | Reports with its tabs: the deficiencies register, the project plan as Schedule, and Status and reports (status and close-out, the agent console's reports, the export and the approvals page). |
| `settings-engagement-owner-desktop.png`, `settings-library-owner-desktop.png`, `settings-workforce-owner-desktop.png`, `-mobile.png` | Settings with its tabs: the engagement's setup steps, the library, the AI workforce. |
| `testing-results-owner-mobile.png`, `testing-review-reviewer-mobile.png`, `testing-review-reviewer-mobile-details.png` | Results and Review at 390px as cards: control, status, whose it is and the next action in view, the phase, result, notes and sign-off behind Details; no horizontal scrolling (document width 390). |
| `walk-1-home-mine-testing.png` → `walk-5-deficiency-open.png` | The cross-control walkthrough: Home's queue filtered to the lead's testing work, a control's Test step, Testing › Results filtered to Mine (each row opening its control's step), Reports › Deficiencies, and one deficiency opened from a stored link that resolves to the Reports tab. |
| `redirects.md` | Every older address requested live: the ten moved sections answer 307 to the destination with the record kept; the retained pages and destinations stay. |
| `queue-dedup.md` | The queue's items by kind and obligation after the M2c rules, and the (control, obligation) pairs that repeat beyond the per-record kinds. |

## m2d — the guided workspace as the one control interface

The 155-control scale engagement (`ai_workforce_scale`), with the API configured for the
walkthroughs as the demonstration needs: no model, no worker, no live email (mock mail
shows the portal's one-time code as a local preview), the client's domain on the
recipient allowlist. Every action was performed through the pages' own controls; the
outcome was read back through the API. The feature-parity matrix is
[docs/milestone-2-parity.md](../milestone-2-parity.md).

| File | What it shows |
| --- | --- |
| `before-classic-overview-desktop.png`, `-mobile.png`, `before-classic-testing-desktop.png`, `before-guided-plan-desktop.png` | Before: the classic Overview and Testing tabs (progress bar, next-action panel, metrics, tab bar) beside the guided workspace, whose Plan step linked out to the Test plans page. |
| `after-guided-plan-desktop.png`, `-mobile.png`, `after-guided-test-desktop.png`, `-mobile.png`, `after-legacy-tab-overview-desktop.png` | After: the stepper is the one interface; the plan is reviewed and approved inside the Plan step; an older `?tab=overview` link opens the Plan step; the Activity record sits below the steps. |
| `j1-*.png` | The preparer: approving a revised plan from the Plan step, approving a drafted request from the Request step, accepting a received population. |
| `j2-*.png` | The reviewer: accepting and dismissing the agent's proposed notes on the Review step, at desktop and phone width; the lead's attempt to sign off refused by the API (independence). |
| `j3-*.png` | The manager: Home, Testing › Results filtered to what needs deciding, Testing › Review, Reports, the register, at desktop and phone width. |
| `j4-*.png` | The control owner: the portal link, the identity code, the requests, a file uploaded to a requested item and acknowledged. |
| `j5-*.png` | A concluded control: the sign-off receipts and conclusion on the Review step, the activity record opened by an older `?tab=activity` link; a second sign-off refused by the API. |
| `j6-*.png` | A deficiency: from remediation in progress to ready for retest from Reports › Deficiencies, the retest round opened, the control's Test step showing the retest phase. |
| `walkthroughs.md` | The six journeys' log, with what each click did and what the API recorded. |
| `queue-reconciliation.md` | Home's queue, the console inbox and the register reconciled for three viewers (counts and identities). |
| `redirects.md` | The ten moved addresses answering 307 with their record kept; the retained pages and destinations staying. |

## m2-closure — Milestone 2 closure

The 155-control scale engagement, API configured for the checks (no model, no worker, no
sender; mock mail shows the portal's code as a local preview; the client's domain on the
recipient allowlist).

| File | What it shows |
| --- | --- |
| `queue-readiness.md` | Drafted-request readiness before and after the closure on the 155- and 403-control engagements, under two allowlists, with the queue's time. |
| `portal-smoke.md`, `portal-1-link.png` … `portal-8-expired.png`, `portal-6-submitted-mobile.png` | The control owner's full path: link, code, requests, uploads to both items, the submission dialog, the confirmation; the wrong token and the revoked link refused. |
| `keyboard.md`, `keys-1-stepper-focus.png` … `keys-7-closeout-dialog.png` | Keyboard-only checks: the stepper, the plan review's actions, the queue, the phone-width Details disclosures, the close-out dialog. |

## m3a — Milestone 3a: real agent execution

Test databases built from the migrations (0094 applied); the live smoke against the
provider with the owner's key on synthetic evidence only.

| File | What it shows |
| --- | --- |
| `live-smoke.md` | The models verified and pinned per tier with their prices; one structured call per tier with tokens, cost and duration; the tester on a synthetic control with the live model (no invented pass, every result cited or unable). |
| `tests.md` | The commands run for the M3a gate and their results: the new execution and provenance tests, the rewritten legacy expectations, the fast and critical sets, type checks and lint. |
| `closure.md`, `cancel-1-offered.png`, `cancel-2-cancelled.png`, `cancel-3-mobile.png` | The closure items: the caller inventory and containment, the cancellation semantics with the Cancel run action in the browser (queued run, the stop attributed to the person, phone width), key rotation, budgets across retries and on chat turns, the provenance read route. |

## m3b — Milestone 3b: evidence intelligence

The synthetic corpus, its manifest of independent expectations, the live run's scorecard,
the gate, and the mapping panel on the owner's development engagement.

| File | What it shows |
| --- | --- |
| `corpus/` and `corpus/manifest.json` | The 27 synthetic files across six controls with every planted difficulty, and the expected outcome per file (reader, rows, columns, facts, OCR words, flags) and per approved attribute (acceptable statuses, identifiers to mention, the file that must never be the support). |
| `live-scorecard.json`, `results.md` | The live model's reading, OCR, classification and mapping of the corpus against the manifest: per file and per attribute, every call's cost, and the summary. |
| `tests.md` | The commands run for the M3b gate and their results. |
| (screenshots) | The Test step's mapping panel was checked in headless Chrome at desktop and 390 px (document width 390) on the owner's development engagement. Those screenshots show that engagement's names and documents, which may be client material, so they are kept out of the repository. |
| `repeatability.md`, `live-scorecard-repeat-1.json` to `-3.json` | The closure's three runs of the unchanged corpus: per-run results, mapping and classification consistency, the investigation of each difference. |

## m3c — grounded testing

The grounded-testing scenario set, its manifest of fixed expectations, the live runs'
scorecards and the UI check. Synthetic data only: the screenshots come from a separate
database built from the scenario set (`ai_workforce_m3c_demo`), never the development
engagement.

| File | What it shows |
| --- | --- |
| `corpus/` and `corpus/manifest.json` | The 23 files of the two controls' populations and 18 samples, and for each of the 98 cells its category (clean, planted negative, dependent), the right result, the defensible results, why, and the passage a careless tester could cite. |
| `results.md` | The live tester and reviewer against the manifest: false passes, false exceptions, unable and human-review rates with their denominators, every inconclusive clean result analysed, the reviewer's detections and its one miss, cost. |
| `live-tester-run1.json`, `live-tester-run2.json` | Every cell's stored result, note, observed and expected conditions, citations and rule checks; the raw citation audit; every unable and human-review result; the protected-decisions check; each call's cost. |
| `live-reviewer-run1.json`, `-run2.json`, `-run3-after-fix.json` | The reviewer against planted false passes and false exceptions: caught, missed, raised on correct results, the rules' notes apart, the reviewer's own answers (run 2 on), cost. |
| `tests.md` | The commands run for the M3c gate and their results. |
| `ui-test-sheet-desktop.png`, `ui-test-sheet-mobile.png` | ITGC-AC-01's test sheet: the blocking line naming the execution failure as a technical failure, not a result (desktop), and the sheet at 390 px (document width 390). |
| `ui-test-cell-panel-desktop.png` | u0003 C: the exception decided by a rule check, with the observed and expected conditions, the rule check that does not hold and the cited passage; u0007's cells shown as "Failed" with its reason. |
| `ui-rationale-desktop.png`, `ui-rationale-mobile.png` | ITGC-CM-01's effectiveness workpaper: section 06, "AI-Proposed Testing Rationale — Pending Auditor Review", drafted by the agent, on the interim tab before the interim conclusion; its summary row and the first samples. At 390 px the workbook frame clips the right edge of every section alike (pre-existing). |
| `evidence-requirements.md` | The closure's analysis of the documents the agents asked for on clean samples: mandatory, supporting or unnecessary against the approved attributes; the inconsistency; the recommendation. |
| `corpus-supplement/` and its `manifest.json` | The supplementary scenarios where the policy, the owner register or the role listing decides the result (four samples, 21 cells), separate from the unchanged M3c set. |
| `live-tester-closure.json`, `live-reviewer-closure.json`, `live-supplement-closure.json` | The closure's fresh live run on the unchanged set and planted errors, and the supplement. |
| `ui-prepare-confirm-desktop.png`, `ui-prepare-confirm-mobile.png`, `ui-rationale-reviewed-desktop.png` | The Prepare action asking the person to confirm the review of the AI-proposed rationale (the box is required; at 390 px the confirmation and Prepare start at the left), and the rationale after the review: titled reviewed, with the reviewer, date and version. |

A rebuild of either scenario set gives identical text files and expected results; the PDF and workbook files embed their creation time, so their hashes (and the workbook's size) in the manifest change with each build.

## m3d — reliability and safeguards

These are the scenario sets, their fixed expectations, and the live runs' scorecards. All data is synthetic. The one screen M3d changed is the evidence-mapping panel's list of passages kept for review (the closure); its screenshots come from the synthetic M3c demonstration engagement.

| File | What it shows |
| --- | --- |
| `corpus-hostile/` and its `manifest.json` | The hostile-evidence corpus: 13 samples and 12 attacks (vehicle, technique, target agents, the attack's words, what would mean it worked), and the expected result of each of the 65 cells. |
| `corpus-consistency/`, `corpus-consistency-v2/` | The two evidence-requirement sets and their manifests. The first was found not to meet the plan's "what counts"; the second is corrected, written before any run of it. |
| `results.md` | Every live measure with its denominator: the hostile corpus by agent, evidence consistency (the M3c set classified by the plan, and the two consistency sets against the M3c-accepted tester), the M3c and M3b regressions, the reviewer's miss, cost. |
| `live-hostile-run1.json`, `live-hostile-final.json` | The reader, mapping, tester, console and reviewer against the hostile corpus, with each attack's outcome and the reproducibility check. |
| `live-consistency-run1.json`, `live-consistency-final.json`, `live-consistency-v2-final.json` | Baseline (the M3c-accepted tester) and M3d on the consistency sets, cell by cell. |
| `live-tester-m3d*.json`, `live-reviewer-m3d*.json`, `live-supplement-m3d*.json` | The M3c regression under the M3d code (the first round, the final round, and a second reviewer run). |
| `live-scorecard-m3d-final.json`, `live-clean-m3d-final.json` | The M3b regression. |
| `tests.md` | The commands run for the M3d gate, and the expectations changed with their justification. |
| `closure.md` | The closure's record against the owner's conditional acceptance: root causes, the unseen set's hash, the plan evaluation, the PostgreSQL finding, and the closure's live results with denominators. |
| `corpus-hostile-v2/` and its `manifest.json` | The unseen attack set (8 attacks, 45 cells), frozen before the corrections. |
| `m3c-plan-evaluation.json` | Evaluation m3c-plan/1: the M3c cells whose expectation contradicts the approved plan, and the recorded tester runs scored against both expectations. |
| `live-hostile-closure.json`, `live-unseen-closure.json` | The original and the unseen attack sets against the closure's agents, with the mapping's concerns and the model's own labels for every attack passage it quoted. |
| `live-reviewer-closure-{m3c,consistency-v2}-r{1,2,3}.json` | The corrected reviewer, three runs each, on the M3c planted cases and on the corrected consistency set's negatives (unseen by the reviewer). |
| `live-scorecard-m3d-closure.json`, `live-clean-m3d-closure.json` | The M3b regression under the closure's mapper. |
| `ui-mapping-concerns-desktop.png`, `ui-mapping-concerns-phone.png` | The mapping panel's passages for review, at 1440 and 390 px. |
