# Milestone 2d: feature parity of the classic control interface and the guided workspace

Inspected on 21 October 2026 before the classic tabs were retired. The control record had
seven classic tabs (Overview, Test plan, Evidence, Testing, Findings, Review, Activity),
reached by `section=controls&control=…&tab=…`, and, since Milestone 1, the guided
workspace (Plan → Request → Test → Conclude → Review) reached by `&step=…`. Every write
goes through a registered web route under `apps/web/app/workspace/*/route.ts` to the API,
which checks authorization, the record's version and independence again and writes the
audit event; moving a form between pages changes none of that. Roles are the API's:
**P** preparer (`task.update`, the control's assignee or an engagement lead/preparer),
**A** approver (`project.update`, never the requester), **R** the engagement's independent
reviewer who did not prepare the work, **Any** any member who can read.

The columns: the feature or action; where it was; who may do it; where it is now; whether
the replacement works; whether authorization and the audit trail are unchanged (they are
the API's, so "same" means the same route and the same event); the test that covers it;
any gap.

## Overview tab (classic) → the stepper and Home

| Feature | Was | Role | Now | Works | Auth and audit | Tests | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Audit progress bar | Overview | Any | The stepper's five steps with their notes and the phase strip | Yes | n/a (read) | `control-journey-model` | None |
| Next action panel, with quick actions "Propose attributes", "Draft process map", "Review documents" | Overview | P | Needs-you card (the canonical next step) and the same quick actions in the Plan step's control definition (`control-context-view`) | Yes | same routes (`control-context`) | `control-workspace-model`, `test_control_context` | None |
| Summary metrics (requests, files, samples, findings) | Overview | Any | The register row, Home's health figures, the Testing › Results row | Yes | n/a | `controls-register-model`, `testing-hub-model` | The per-control metric strip is not repeated on the record |
| Agent activity roster | Overview | Any | Agent says on each step, and the Activity record below the steps | Yes | n/a | `agent-says-model` | None |
| Classic tab bar and "All details" | Overview | Any | Removed; `?tab=` links open the step that holds the tab's work | Yes | n/a | `control-journey-model` (`stepForTab`), `shell-model` | None |

## Test plan tab → the Plan step

| Feature | Was | Role | Now | Works | Auth and audit | Tests | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Plan-revision impact assessment (decide impact on signed-off results) | Test plan | R | Plan step, `ImpactPanel` | Yes | same (`impact`, `review.impact_assessed`) | `test_plan_impact`, `impact-model`, M1b browser test | None |
| Test plan summary with a link to the Test plans page | Test plan | Any | The plan review itself, embedded (`PlanReview`, the one component Testing › Plans uses): understanding, procedures, attributes, evidence tabs, decision history | Yes | same | `planning-model`, `test_master_plans` | None |
| Approve the plan, request changes, submit for approval, decide the planner's revision | Test plans page | A (approve/decide), P (submit) | Plan step, `ReviewActions` inside the embedded review | Yes | same (`planning`, `evidence_plan.approved` etc.; version checked) | `test_master_plans`, `test_planning_gate` | None |
| Edit procedures, evidence wording, links, criteria; answer client values; describe facts | Test plans page | P | Plan step, the embedded review's own dialogs | Yes | same | `test_master_plans`, `planning-model` | None |
| Release a phase (single) | Test plans page phase strip | A/R | Plan step, the embedded review's `PhaseStrip` (Testing › Phases keeps the batch) | Yes | same (`phase_release`) | `test_phase_release` | None |
| Test basis: find a standard, use the client's procedures, tailor | Test plan | P | Plan step, `TestBasisCard` | Yes | same (`test-basis`) | `test_testing_definitions`, `test_library_matching` | None |
| Control definition: attributes (generate, add, edit, decide, retire), documents (review), process map (build, adopt, save), conflicts (resolve), classification, library adoption | Test plan | P | Plan step, the definition parts (pending ones first, the rest folded) | Yes | same (`control-context`) | `test_control_context`, `test_control_statements`, `test_slot_options` | None |

## Evidence tab → the Request step

| Feature | Was | Role | Now | Works | Auth and audit | Tests | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Evidence plan per phase, proposals, population acceptance | Evidence | P | Request step, `EvidenceWorkspace` | Yes | same (`evidence-plan`) | `test_evidence_plans`, `test_evidence_planning`, `evidence-plan-model` | None |
| Requests: draft, submit, approve (request review), send, resend, cancel, follow-ups and reminders | Evidence | P (submit), A (approve, send) | Request step, `EvidenceRequests` and `RequestReview` (`?request=`) | Yes | same (`request-review`, `follow-ups`, approvals) | `test_pbc`, `test_evidence_flow`, `test_followups`, `test_approvals` | None |
| Upload a file to a request, replace or withdraw a file, move a file between requests, evidence sufficiency decisions | Evidence | P | Request step, `ControlEvidence` (the control's library) and the mailbox | Yes | same (`evidence-uploads`, `evidence-change`, `evidence-replace`, `evidence-analyses`) | `test_evidence`, `test_evidence_versions`, `test_evidence_review`, `evidence-change-model` | None |
| Attachments received by email and portal uploads | Evidence | Any | Request step (files), Evidence › Mailbox, the client portal (unchanged) | Yes | same | `test_inbound`, `test_evidence_portal` | None |

## Testing tab → the Test step

| Feature | Was | Role | Now | Works | Auth and audit | Tests | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Samples: approve, replace a sample, accept the population | Testing | P | Test step, `TestPlanCard` | Yes | same (`control-tests`, `control_test.approved`) | `test_sampling`, `test_testing_engine` | None |
| Test sheet: run again, link/unlink evidence to an item, exclude/include an item, override a result, sign off, reopen | Testing | P | Test step, `TestSheetCard` | Yes | same (`test-sheets`; sign-off versions kept) | `test_testing_engine`, `test_test_citations`, `test_signoff_history`, `sheet-model` | None |
| Exceptions: log the proposed deficiency or dismiss it with a reason | Testing | P | Test step (sheet) and Conclude step | Yes | same | `test_testing_engine`, `test_workspace` | None |
| Workpapers: draft, redraft, prepare, view versions (design and effectiveness) | Testing | P | Test step (`WorkpapersTab`, compact) | Yes | same (`workpapers`) | `test_workpapers`, `test_workpaper_templates` | None |
| Rounds: roll-forward and retest, confirm the testing basis, the round's sheet and sign-off | Testing | P | Test step, `TestRounds` and `RoundView` | Yes | same (`round-basis`, `test-sheets`) | `test_test_rounds`, `test_round_readiness`, `test_round_basis` | None |

## Findings tab → the Conclude step

| Feature | Was | Role | Now | Works | Auth and audit | Tests | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Potential exceptions from testing (not yet decided) | Findings | Any | Conclude step | Yes | n/a | `control-workspace-model` | None |
| Deficiencies logged: log a deficiency, update it, progress remediation (owner, plan, due date, fix date), record a retest result, propose and decide changes | Findings | P (log, progress), R (decide a change) | Conclude step, `FindingsTab`; the register under Reports › Deficiencies | Yes | same (`engagement` route → `deficiencies`; closure rules in `workspace._progress`) | `test_workspace`, `test_test_rounds`, `test_engagement_integrity` | None |

## Review tab → the Review step

| Feature | Was | Role | Now | Works | Auth and audit | Tests | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Independent review: re-perform, decide the agent's notes, answer notes, clear or return answers, sign off, reopen | Review | R (decide, clear, sign), P (answer) | Review step, `ReviewTab` | Yes | same (`reviews`; independence enforced by the API) | `test_control_reviews`, `test_independence`, `review-model` | None |
| Historical coverage assessment | Review | R | Review step, `CoverageForm` | Yes | same (`review.coverage_assessed`) | `test_plan_impact`, M1b browser test | None |
| Round reviews (roll-forward, retest) | Review | R/P | Review step, `RoundReviews` | Yes | same | `test_round_reviews` | None |
| Conclusion and sign-off history (receipts) | Review | Any | Review step's conclusion section; receipts in the stepper | Yes | n/a (read; history immutable by the API) | `signoff-model`, `test_signoff_history` | None |

## Activity tab → the Activity record

| Feature | Was | Role | Now | Works | Auth and audit | Tests | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The control's audit trail | Activity | Any | The Activity record below the steps (`#activity`, opened by the stepper's link and by `?tab=activity`) | Yes | n/a (read) | — (rendering only) | None |

## Retired and retained

Retired with M2d (the guided workspace covers each): the classic tab bar and its seven
tab pages as destinations, the audit progress bar, the overview's next-action panel and
summary metrics, the overview's agent roster, the "All details" link, and the `?tab=`
page mode (`?tab=` still opens the step that holds the tab's work).

Retained outside the control record, reachable from it: the Test plans queue and batch
actions (Testing › Plans), the phase release batch (Testing › Phases), the deficiencies
register (Reports › Deficiencies), the evidence center and mailbox (Evidence), the
approvals page (from each approval item), the agent console (from Home and Reports ›
Status). No action required a hidden legacy page in the cross-role walkthroughs
(`docs/review/m2d/`); the one legacy capability still required is the agent console for
producing the five engagement reports, which Reports › Status links to and says so.
