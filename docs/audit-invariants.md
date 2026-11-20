# Audit invariants

The rules an IT SOX audit must never break, whatever route reaches the state: a person in
the workspace (API), a background worker (WRK), the Northstar demo seed (DEMO), or an import
(library, RCM, prior year, portal and mailbox intake: IMP). Each one names the critical-tier
tests that hold it now and, where it is held only in part, the defect still open and the
increment that will close it.

Decided by the product owner on 19 November 2026 (the process change: audit rules,
fail-closed, a hostile test model). Every change names the invariants it touches (the pull
request template asks), and a High-risk design note answers the "what happens later"
challenge for each (docs/test-strategy.md §1, G2).

`services/api/tests/test_audit_invariants.py` reads the three tables below and fails CI when:

- a test named under "Held by" does not exist, is skipped or marked xfail, or is not in the
  critical tier (`CRITICAL_PY`, or picked into `CRITICAL_PICKED`, in the Makefile);
- an invariant held "in part" or "open" has no row in the open table, or one held "in full"
  has one;
- an open row names an increment that is not in the increments table, or no defect id.

So renaming, deleting or moving a held-by test out of the critical tier fails CI until this
file follows it. That is intended. The model-contract cells (I10) are kept in one place,
`services/api/tests/test_model_contract.py`; each open cell names a defect id that has a row
here, and the increment is read from that row.

There are no `xfail` marks (owner, 19 November 2026). An open part's test lands with the
increment that fixes it, which moves its contract cell from OPEN to CHECKED in the same
commit and deletes its row here.

## Invariants

| Id | Invariant | Held | Held by (critical tier) |
| --- | --- | --- | --- |
| I1 | Nothing is final unless its whole basis is current: plan approved at the tested revision, attributes and owned criteria as tested, D&I sign-off holding, every phase decided. The same holds for engagement completion. | in part | `services/api/tests/test_control_journey.py::test_a_conclusion_is_final_only_when_everything_required_is_tested_and_reviewed` `services/api/tests/test_control_journey.py::test_signed_off_results_are_stale_once_the_plan_is_revised` `services/api/tests/test_plan_impact.py::test_a_revised_plan_raises_an_assessment_only_a_reviewer_decides` `services/api/tests/test_plan_impact.py::test_an_open_sheet_follows_reapproved_attributes_and_signs_off_only_after_retest` `services/api/tests/test_testing_engine.py::test_accepted_criteria_on_an_open_sheet_hold_sign_off_until_retested` `services/api/tests/test_testing_engine.py::test_items_tested_on_an_unfilled_value_hold_sign_off_until_tested_again_with_it` `services/api/tests/test_lock_order.py::test_a_run_tests_each_item_on_the_attributes_it_reads_with_the_item` `services/api/tests/test_control_conclusions.py::test_a_d_and_i_sign_off_that_lapses_after_a_full_sign_off_takes_the_conclusion_off_final` `services/api/tests/test_control_journey.py::test_an_effective_d_and_i_sign_off_out_of_date_keeps_the_conclusion_open` `services/api/tests/test_control_reviews.py::test_the_review_waits_while_the_plan_is_revised_and_not_approved` |
| I2 | A sign-off binds the exact versions it reviewed. What it relied on cannot change under it, and anything arriving later is assessed by a reviewer before the conclusion stands. | in part | `services/api/tests/test_evidence_reliance.py::test_signed_testing_and_an_approved_sample_keep_their_files` `services/api/tests/test_evidence_reliance.py::test_a_file_filed_after_the_design_sign_off_was_not_part_of_it` `services/api/tests/test_control_journey.py::test_a_signed_review_covers_only_the_versions_it_recorded` `services/api/tests/test_design_conclusions.py::test_a_recorded_d_and_i_conclusion_is_never_changed_or_deleted` |
| I3 | Missing evidence never supports an attribute and never proves a failure. | in part | `services/api/tests/test_assurance_review.py::test_an_attribute_not_demonstrated_is_never_called_contradicted` `services/api/tests/test_assurance_scenarios.py::test_a_missing_approval_is_not_demonstrated_and_the_approval_record_is_asked_for` `services/api/tests/test_grounded_testing.py::test_an_execution_failure_is_not_a_result_and_is_tested_again` `services/api/tests/test_model_contract.py::test_an_entry_point_fails_closed` |
| I4 | Evidence read only in part is declared to every reader and never yields an unqualified PASS or SUFFICIENT. | in part | `services/api/tests/test_assurance_review.py::test_a_file_read_only_in_part_makes_the_evidence_incomplete` `services/api/tests/test_assurance_scenarios.py::test_a_file_whose_ocr_failed_is_held_and_nothing_is_concluded_as_missing` |
| I5 | A PASS rests on a verified quotation from the sample's own record: words found (not only a box), whole tokens, not negated, of minimum length. | in part | `services/api/tests/test_grounded_testing.py::test_an_exception_needs_its_explanation_and_support_and_a_forged_citation_is_dropped` `services/api/tests/test_control_context.py::test_a_pass_stands_only_on_cited_evidence` |
| I6 | A comparison the criteria require that was not made, or cannot be resolved, leaves the result open (UNABLE or CANNOT_TELL), never PASS or SUPPORTED. | in part | `services/api/tests/test_grounded_testing.py::test_a_comparison_side_is_one_atomic_value_and_ambiguity_is_unable` |
| I7 | An agent's Not Applicable, judgment call or drafted override is a proposal until a person decides it, with a reason that is not missing evidence. | in part | `services/api/tests/test_attribute_dispositions.py::test_only_a_person_who_may_decide_evidence_records_or_reopens` `services/api/tests/test_phase_release.py::test_an_early_release_needs_a_reason_and_only_a_reviewer_releases` |
| I8 | Undecided is never "does not apply": a PENDING phase holds the conclusion until a person decides it. | in part | `services/api/tests/test_control_conclusions.py::test_an_undecided_phase_holds_the_proposal_and_never_reads_does_not_apply` `services/api/tests/test_control_journey.py::test_an_undecided_phase_keeps_the_conclusion_open` `services/api/tests/test_control_journey.py::test_roll_forward_left_undecided_after_interim_exceptions_is_not_final_until_a_person_decides` `services/api/tests/test_phase_release.py::test_an_undecided_phase_waits_for_the_plan_not_not_applicable` |
| I9 | Outcomes are a closed set and the open ones block: five OE results; UNABLE and REVIEW block sign-off; a signed sheet is only EFFECTIVE or NOT_EFFECTIVE; D&I keeps CONTRADICTED apart from NOT_DEMONSTRATED. | in part | `services/api/tests/test_assurance_review.py::test_an_attribute_not_demonstrated_is_never_called_contradicted` `services/api/tests/test_audit_invariants.py::test_results_and_conclusions_are_one_closed_vocabulary` |
| I10 | Fail closed: a model call, check, comparison, reviewer or refresh that fails, is cut off, is malformed, or returns nothing or part of what was asked yields UNABLE, NOT_REVIEWED or still due. Never a pass, a completed review or "nothing due". | in part | `services/api/tests/test_agent_execution.py::test_a_provider_failure_leaves_failed_items_for_a_person_never_a_rules_result` `services/api/tests/test_evidence_assurance.py::test_a_model_failure_on_either_reading_is_a_failed_check_never_a_guess` `services/api/tests/test_grounded_testing.py::test_an_execution_failure_is_not_a_result_and_is_tested_again` `services/api/tests/test_model_contract.py::test_every_model_entry_point_is_in_the_contract` `services/api/tests/test_model_contract.py::test_the_hostile_answer_fits_each_schema` `services/api/tests/test_model_contract.py::test_an_entry_point_fails_closed` `services/api/tests/test_model_contract_db.py::test_an_empty_policy_answer_proposes_nothing` |
| I11 | A review with any in-scope item unverdicted is not a review, and its verdicts hold only for the exact words a person is asked to accept. | in part | `services/api/tests/test_control_reviews.py::test_the_reviewer_re_performs_each_result_without_the_testers_answer` `services/api/tests/test_grounded_testing.py::test_the_reviewer_catches_planted_false_passes_by_re_performing_independently` `services/api/tests/test_understanding_review_rules.py::test_a_skipped_attribute_is_corrected_once_then_marked_not_reviewed_never_invented` |
| I12 | Only person-owned criteria are tested, and no agent-written figure, threshold or observation without a source in the records becomes a criterion or a recorded fact. | in part | `services/api/tests/test_design_release.py::test_the_planner_tailors_library_attributes_but_never_a_persons_criteria` `services/api/tests/test_grounded_testing.py::test_the_tester_judges_against_the_criteria_tailored_to_the_control` |
| I13 | No one signs or decides the review of work whose outcome they prepared, overrode, dismissed or recorded. | in part | `services/api/tests/test_independence.py::test_with_independence_on_the_same_person_is_refused` `services/api/tests/test_independence.py::test_a_preparer_made_reviewer_never_decides_or_clears_a_note_on_their_own_work` `services/api/tests/test_independence.py::test_production_refuses_to_start_with_independence_off` `services/api/tests/test_design_conclusions.py::test_the_d_and_i_conclusion_is_signed_by_an_independent_reviewer` |
| I14 | Only a person decides (approve, sign off, rate, release, send, override). An agent principal is denied every decision and cannot change its own permissions or run an unregistered tool. | in part | `services/api/tests/test_policy.py::test_policy_allows_a_permitted_action_and_denies_the_rest` `services/api/tests/test_approvals.py::test_an_approval_is_bound_to_the_exact_parameters` `services/api/tests/test_execution.py::test_closed_approvals_do_not_perform_an_action` `services/api/tests/test_control_conclusions.py::test_a_person_rates_each_deficiency_and_a_severe_rating_waits_for_the_reviewer` `services/api/tests/test_audit_invariants.py::test_an_agent_principal_is_denied_every_registered_action` `services/api/tests/test_audit_invariants.py::test_authorization_refuses_an_agent_principal_before_any_read` `services/api/tests/test_console.py::test_every_tool_is_registered_with_a_schema_and_a_risk` `services/api/tests/test_console.py::test_routine_tools_run_and_sensitive_ones_wait_for_the_person` |
| I15 | Text in evidence never instructs: a planted instruction never changes a result, and a relied-on file that contains one is surfaced. | in part | `services/api/tests/test_prompt_neutral_everywhere.py::test_every_value_inside_a_prompts_data_tag_is_made_inert` `services/api/tests/test_hostile_evidence.py::test_an_obedient_tester_is_contained_and_the_reviewer_catches_what_is_left` `services/api/tests/test_evidence_assurance.py::test_instructions_in_a_file_do_not_change_a_result` |
| I16 | One outcome, one story: panel, register, dashboard, workpaper, export and reports state the same verdict, dismissal and review state. | in part | `services/api/tests/test_control_journey.py::test_the_journey_agrees_with_the_register_wherever_it_does_not_report_a_conflict` `services/api/tests/test_control_journey.py::test_every_control_on_an_engagement_has_a_journey_that_matches_its_row` `services/api/tests/test_workspace.py::test_the_register_and_the_panel_read_the_same_verdict_for_an_undecided_proposal` |

## Open parts

Each row is one defect, by its id in the audit-invariants design note of 19 November 2026,
and the increment whose fix lands its test. e3a merged on 19 November 2026 (#21): its tests
for ST-1, ST-2, ST-4, FP-7 and ST-2-I16 now hold I1, I8 and I16 under "Held by", and those
rows are gone.

| Invariant | Defect | What is open | Increment |
| --- | --- | --- | --- |
| I1 | ST-5 | D&I points raised after sign-off do not reopen the conclusion | D&I sign-off |
| I1 | FO-8 | Engagement completion checks only that signed rows exist, never finality | D&I sign-off |
| I1 | FO-9 | A reopened EFFECTIVENESS workpaper drops out of the coverage check | D&I sign-off |
| I1 | ST-3 | Late OE evidence on a signed sheet is not assessed (probably a migration) | unassigned: owner decision D3 |
| I2 | ST-3-intake | Evidence arriving through the portal or mailbox after sign-off is not assessed by a reviewer | unassigned: owner decision D3 |
| I2 | SOL-3 | The attribute set-review marks are not tied to the revision reviewed | SOL attributes |
| I3 | OE-ABSENCE | An OE EXCEPTION built on absence stands with any verified citation (testing_engine._exception_stands) | OE pass rules |
| I3 | D1 | An override to EXCEPTION or N/A needs a 3-character reason with no missing-evidence rule (test_sheets) | OE pass rules |
| I4 | FF-1 | Model OCR pads unread pages with "" and the reading reads as whole | E3 readings |
| I4 | E3-PARTIAL | Page, sheet, row and OCR caps are not declared as read in part; only truncation is | E3 readings |
| I5 | FP-2 | A negated passage's tail ("approved by ..." of "not approved by ...") is a verified OE citation | OE pass rules |
| I5 | MC-1 | An OE citation need not name the sample's own row | OE pass rules |
| I5 | UC-1 | A box-only citation on an image is kept with the words not found | OE pass rules |
| I5 | FP-14 | An uncited screenshot-review PASS is copied past `supported()` | OE pass rules |
| I5 | DEMO-PASS | The Northstar seed writes results with its own PASS rule (demo_northstar/lifecycle.py) | OE pass rules |
| I6 | FP-1 | Only the comparisons the model proposes are made; a PASS with none stands | OE pass rules |
| I6 | FP-3 | Date-only values, ISO timestamps, day-first dates and name forms are compared without saying they are ambiguous | OE pass rules |
| I6 | FO-14 | In D&I a NOT_RUN comparison counts only when a fact is missing | OE pass rules |
| I6 | FO-17 | Trace dates are always read month-first | OE pass rules |
| I6 | FO-18 | Identifiers are reduced to ASCII and "1,5" reads as 15 | OE pass rules |
| I7 | FP-6 | An OE agent N/A with a note of more than three words is decided; t/test_testing_engine.py:71-72 encodes N/A plus PASS as EFFECTIVE and is rewritten with the fix | OE pass rules |
| I8 | APPLIES-COPIES | e3a's four tests hold the conclusion, the journey and the release. Still open: whether a phase applies is written three times (`_APPLIES` in control_conclusions, control_journey and phase_release), and no test reads PENDING through every reader (the register, the export, the queue); the Northstar seed's path runs outside CI | unassigned: owner decision on placing the I8 reader property test |
| I9 | OE-STORED | OE results are stored in jsonb with no constraint; the demo seed writes them directly | OE pass rules |
| I9 | UH-5 | Omitted screenshot checks become UNCLEAR, which still allows NO_EXCEPTION | OE pass rules |
| I9 | critic-7 | A D&I DISAGREE goes to a client clarification, not to a person's judgment | unassigned: owner decision on critic 7 |
| I10 | FO-1 | The re-performed gate reads only reperformed_at: a FALLBACK or zero-item run clears it | OE pass rules |
| I10 | FO-2 | `_finish` withdraws every proposed agent note even when the run re-performed nothing; reachable through the ROUTINE console tool `reperform_review` | OE pass rules |
| I10 | UH-4 | A re-performer's PARTIAL answer against a tester N/A or EXCEPTION raises no note | OE pass rules |
| I10 | FP-5 | The re-performer's element list is the model's choice; one SHOWN element endorses a pass | OE pass rules |
| I10 | UC-2 | The tester's observed values are never checked against the files | OE pass rules |
| I10 | INJ-1 | An obedient tester citing another line than the planted one is not caught (OE half) | OE pass rules |
| I10 | FO-22 | Omitted screenshot checks allow NO_EXCEPTION; rewrites t/test_evidence_review.py:110 | OE pass rules |
| I10 | FO-3 | An empty drafts-reviewer list is accepted as reviewed and discards every draft | SOL attributes |
| I10 | FO-4 | `_pass_finished` ignores rejected outcomes | SOL attributes |
| I10 | FO-5 | An empty answer on a limited update counts as having followed the understanding | SOL attributes |
| I10 | FO-6 | A REVISED verdict with no revision is recorded OK | SOL attributes |
| I10 | SOL-4 | An empty or partial set review is stored REVIEWED | SOL attributes |
| I10 | SOL-2 | An invented figure in criteria passes the figure check | SOL attributes |
| I10 | FO-25 | The narrative review's `passed` is the model's own boolean | SOL attributes |
| I10 | HX-1 | An empty workpaper draft is recorded as the agent's | D&I sign-off |
| I10 | UC-4 | A workpaper claim is kept after its quote was dropped | D&I sign-off |
| I10 | UH-1 | A lazy MISSING mapping drafts a client follow-up | E3 readings |
| I10 | ST-6 | An ungrounded COVERED classification becomes Verified | E3 readings |
| I10 | UC-3 | An invented period becomes a RULES period finding | E3 readings |
| I10 | FO-15 | A system, subject or period concern needs both readings; rewrites t/test_assurance_scenarios.py:831-833 (owner methodology decision) | E3 readings |
| I10 | FO-23 | A FALLBACK read of headers alone gives COVERED | E3 readings |
| I10 | FO-24 | SOC exceptions are dropped and report type and period are not verified | scope integrity |
| I10 | FO-27 | The prior-year analysis is marked DONE after a failed call | E3 readings |
| I10 | FO-28 | The request-draft check matches by category kind only | request-draft fix |
| I10 | STOP-VALID | `models.outcome` accepts `stopped="max_tokens"` with a schema-valid output; only the provider adapter nulls a cut-off answer (defence in depth) | unassigned: owner decision on defence in depth |
| I10 | BASIS-RERUN | A rerun triggered by a change to its basis (evidence replaced or withdrawn, a placeholder filled, an attribute or criterion reworded) that fails leaves the earlier favourable result standing; unmeasured (e3a's N1 retest covers the placeholder's own trigger, not a failed rerun) | OE pass rules |
| I10 | TRANSIENT | Timeouts, rate limits, provider errors and cancellations are measured per entry point only where a test names them | unassigned: owner decision on transient-failure cells |
| I11 | FO-3-I11 | The drafts reviewer's verdicts are not counted against the drafts in scope | SOL attributes |
| I11 | FP-5-I11 | OE `endorsed` accepts one SHOWN element on a list the model chose | OE pass rules |
| I12 | SOL-2-I12 | `refused_criteria` runs only on a CHANGE that keeps the approved wording | SOL attributes |
| I12 | FO-7 | The figure check matches substrings and misses number words and other units | SOL attributes |
| I12 | FP-11 | OE testing does not require owned criteria; with no approved attributes one is invented (FO-21) | OE pass rules |
| I13 | DISAGREE-TABLE | The disagreement table lacks (N/A, UNABLE), (N/A, REVIEW), (EXCEPTION, UNABLE) and (EXCEPTION, REVIEW) | OE pass rules |
| I13 | OVERRIDERS | Overriders and dismissers may sign the review of what they decided | OE pass rules |
| I13 | RECORDERS | D&I tickmark and reliability recorders may sign over their own judgment | D&I sign-off |
| I14 | AGENT-AS-PERSON | Decisions applied by service code from agent output under a person's identity (FO-2's withdrawal through `reperform_review`, FO-3's discarded drafts); every agent acts under a USER principal, so the agent-principal guards are a regression guard only | OE pass rules |
| I14 | critic-9 | A console-drafted decision is recorded as the person's own, with no "drafted by agent" mark | unassigned: owner decision on critic 9 |
| I14 | READ-EFFECTS | The console guard asserts each tool's tier, not that a READ tool has no side effect | unassigned: owner decision on a side-effect guard |
| I15 | INJ-1-OE | An obedient model citing another line than the planted one (OE half) | OE pass rules |
| I15 | INJ-1-DI | The same for the D&I readings | E3 readings |
| I16 | FO-13 | The REVIEW_COMPLETE milestone is a snapshot never recomputed; workpaper fill and export verdicts | D&I sign-off |
| I16 | item-18 | The export does not show the review state | unassigned: owner decision on item 18 |

## Increments

The closed set an open row or a model-contract cell may name, in the queue's order. Any
other owner is written `unassigned: <the owner decision it waits for>`.

| Increment | What it is |
| --- | --- |
| SOL attributes | SOL's attribute fixes, with the two Attributes-step follow-ups |
| question fixes A | Question fixes part A, branch question-integrity-a |
| scope integrity | Scope integrity, branch scope-integrity-a |
| request-draft fix | The request-draft fix, branch pbc-draft-coverage |
| D&I sign-off | D&I sign-off integrity |
| OE pass rules | The OE pass rules |
| question fixes B | Question fixes part B |
| E3 readings | The rest of E3: evidence read in part, readings and follow-ups |
| E2 | E2 |

## Harness: what the shared fakes do by default

`services/api/tests/hostile_model.py` holds the hostile model, the shared replay fake and the
tester's prompt parsers. A call nothing scripted fails the test at teardown
(`conftest.nothing_unscripted_was_asked`). Known cooperative defaults that remain, each with
its owner:

| Default | Where | Owner |
| --- | --- | --- |
| The three replay copies repeat their last answer after the script ends, stated as `then=Repeat()` | `test_evidence_analysis._Provider`, `test_evidence_reading._Provider`, `test_provenance._Scripted` | step 2b of this increment, after e3a merges: hand over to EMPTY, and give each test that relies on the repetition its own `then=Repeat()` |
| `Scripted.with_elements` marks every cited reviewer PASS element SHOWN (hides FP-5) | `test_grounded_testing.with_elements` | step 2b (`elements=ALL_SHOWN` opt-in), after e3a merges (test_reliability uses it) |
| `_Citing` cites file 0's first line whatever the sample (hides MC-1) | `test_testing_engine._Citing` | step 2b, after e3a merges (e3a owns the file) |
| The specialist answers `established` unless a test sets it (54 constructions) | `test_attributes_follow_understanding._Agents`, `test_agent_answers._Script` | SOL attributes |
| The set reviewer answers an empty review, which production stores REVIEWED (SOL-4) | `test_attributes_follow_understanding._Agents.review` | SOL attributes |
| `test_system_applicability._Scripted` is a fourth replay copy | `test_system_applicability.py` | scope integrity (it owns that file's work) |
