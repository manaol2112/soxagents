# Phase plan

Implement one milestone at a time. Do not start the next milestone until the current milestone's acceptance criteria pass and the diff is reviewed.

Source specification: AI Employee Workforce Cursor Build Plan.

## Current milestone

**Milestone 3d: reliability and safeguards.** M3c accepted at commit 222ac28 and M3d authorized on 21 October 2026; conditionally accepted the same day, closed, and committed at the owner's direction ([milestone-3-plan.md §18](milestone-3-plan.md), [milestone-3d-completion.md](milestone-3d-completion.md), evidence in `docs/review/m3d/`, closure in `docs/review/m3d/closure.md`). It covers a hostile-evidence corpus and a second, unseen one; isolation, least-privilege and segregation-of-duties tests at the service layer; an eleven-category failure matrix; a reproducibility record per model call (migration 0098); the approved plan's required evidence per attribute in the tester and the reviewer; deterministic population matching; and, in the closure, the mapper's separation of records from assertions and instructions (migration 0099, both applied to the development database), the reviewer's element-by-element pass check, the plan-consistent evaluation m3c-plan/1, and the fix of a test whose recursion exhausted PostgreSQL's connections. Acceptance: nine of ten criteria pass; criterion 1 fails on the unseen set (1 of 8 attacks, a tester pass the reviewer caught), accepted and recorded by the owner, with the tester's element check carried into M3e. M3e is not started.

**Milestone 3c: grounded testing.** M3b accepted at commit 4f9ef42 and M3c authorized on 21 October 2026. Conditionally accepted, closed (explicit human review of the AI rationale on Prepare, one atomic value per rule-check side, a supplementary scenario set, the reviewer's not-applicable finding; see the completion report §11) and committed after the closure checks ([milestone-3-plan.md §17](milestone-3-plan.md), [milestone-3c-completion.md](milestone-3c-completion.md), evidence in `docs/review/m3c/`): a separate synthetic scenario set of 18 samples with fixed expected results; the tester explains every result with the observed and expected conditions and limitations, and objective comparisons are evaluated by code (`testing_checks.py`); exceptions stand only explained and supported; an execution failure holds no result; a pass citing instructions in the evidence goes to a person; the AI-proposed testing rationale is a pending section of the effectiveness workpaper (`testing_rationale.py`); the reviewer re-performs with the same checks. Live: no false pass on 20 planted negatives and no false exception on 70 clean cells in two runs; the reviewer caught 16 of 16 planted false passes after one fix. No migration. M3d is not started.

**Milestone 3b: evidence intelligence.** M3a accepted (commit 1483037) and M3b authorized on 21 October 2026. Built and pending review ([milestone-3-plan.md §16](milestone-3-plan.md), [milestone-3b-completion.md](milestone-3b-completion.md), evidence in `docs/review/m3b/`): a controlled synthetic corpus of 27 files with independently written expected outcomes; the readers, OCR, custody, classification and citations measured on it and reused; the one new capability, evidence-to-attribute mapping (`evidence_mapping.py`, migration 0096, applied to the development database), with every passage verified and located, append-only runs pinned to the plan revision and the files' hashes, and a Test-step panel. No pass or fail is concluded. M3c is not started.

**Milestone 3a: real agent execution.** The owner conditionally approved the Milestone 3 direction and answered the plan's six questions on 21 October 2026 ([milestone-3-plan.md §13](milestone-3-plan.md)); M3a is built, conditionally accepted, and its closure items are done pending the owner's final review (§14 and §15; evidence in `docs/review/m3a/`). Migrations 0094 and 0095 (applied to the development database). Every agent job's model call runs through one caller (`provenance.py`): three configurable tiers pinned to verified models with their prices, budgets enforced before dispatch, retries with a pause, a person's cancellation honoured between units, and a provenance record per call with the prompt and answer sealed under the firm's key; a model failure is recorded as `FAILED` or `FALLBACK`, never as the rules' work; audit events name the agent beside the person; no page or queue read calls the model ([operations.md](operations.md)). M3b is not started.

**Milestone 2 accepted (21 October 2026; commits 2d5a086, 3309686, 6480232, e818eae, b1c4c8a).** The [completion report](milestone-2-completion.md) records the acceptance and the remaining noncritical limitations.

**Milestone 2d: the guided workspace as the one control interface.** M2c accepted and committed (6480232); M2d authorized ([milestone-2-plan.md §15](milestone-2-plan.md), [milestone-2-parity.md](milestone-2-parity.md)). Complete, pending the owner's review of the Milestone 2 completion report ([milestone-2-completion.md](milestone-2-completion.md)); no migration. The classic control tabs are retired behind the guided steps, the plan review is inside the Plan step, the console inbox and past-due items read the queue alone, internal links name the six destinations. Milestone 3 is not started.

**Milestone 2c: the six destinations.** M2b accepted conditionally and committed (3309686); M2c authorized ([milestone-2-plan.md §14](milestone-2-plan.md)). Complete, pending review; no migration; no API change beyond the queue's semantic deduplication rules. One menu of six destinations (Home, Controls, Testing, Evidence, Reports, Settings); the older sections redirect with their record kept (`apps/web/proxy.ts`, `routes.ts`); the agent console, approvals and engagements pages stay reachable by address. M2d is not started.

**Milestone 2b: queue completeness, four buckets and the Testing destination.** M2a accepted conditionally and committed (2d5a086); M2b authorized ([milestone-2-plan.md §12–§13](milestone-2-plan.md)). Complete, pending review; no migration; the queue route gains `UPCOMING`, an `obligation` code per item, `limit`/`offset`, and the sources it lacked (evidence sufficiency reviews, coverage assessments, stopped workpaper drafts and re-performances, deficiency remediation and retest, round windows, final completion); `section=testing` replaces the Test plans menu entry with Plans, Phases, Results and Review views built from the existing components; the legacy Test plans page stays reachable by its address. M2c–M2d are not started.

**Milestone 1 accepted (M1a–M1d, commits 4e1987f, 1574154, 71e38e7).** Before Milestone 2: the acceptance walkthrough of one control's full lifecycle ([acceptance-walkthrough.md](acceptance-walkthrough.md), screenshots in `docs/review/acceptance/`) and three follow-ups, pending the owner's review: the classic next-action panel consumes the canonical next step; a round records an explicit testing basis that a person confirms when the plan changes (migration 0093, `POST …/test-rounds/{id}/basis`); a tester run that stops leaves its note and activity, kept apart from testing failures.

**Milestone 1d: corrections and the guided walkthrough.** Authorized by the product owner with M1c's conditional acceptance ([milestone-1-plan.md §12](milestone-1-plan.md)). Complete; no migration; one read-only route (`workspace/automation`).

- Agent execution states come from run records and the automation status, never from the sheet's workflow state; with no worker configured, automation is shown as unavailable. A preparer's step is the viewer's only by assignment or engagement role. Agent says is concise with details expandable. The retest's trace shows its unsupported links instead of borrowing the interim plan. Classic headers, the repeated review explanation and the effective-after-dismissal wording are corrected. Walkthrough verified on seven demo scenarios ([docs/review/README.md](review/README.md)).
- M1c (complete, committed in 1574154): the agent block and the trace rail ([milestone-1-plan.md §11](milestone-1-plan.md)).

- One "Agent says" block under the Needs-you card: what the agents did (from the records), what they propose and why, the records it rests on, and the decision a person still has to make; when the records give no basis, it says so. A compact trace rail from control objective to independent review, each link stating whether its record exists, opened for the records and a per-attribute table of cited evidence and results. Verified on five demo scenarios ([docs/review/README.md](review/README.md)).
- M1b (complete, committed in 4e1987f): the Plan step shows each plan-revision impact assessment with the agent's recommendation and the reviewer's decision form (reviewer only, never the signer); the Review step lists each testing round's own review and the coverage assessment of a signed review; Testing and Review carry a banner while an assessment is pending. A round in testing is the step, the stage and the next action before the interim's review. Verified on six fixture-built scenarios ([docs/review/README.md](review/README.md)).
- M1a (complete): opening a control shows the five steps as a map of where it is (from the API's journey, never a gate), the testing phases with their own state, the one thing that needs a person and who that is, everything outstanding with the step where it is resolved, and the sign-offs on record (two new read routes). The step's classic body shows under the frame; "All details" keeps the seven tabs through M2.

**Workflow integrity W4: phase order and round readiness (with the W3 follow-ups).** Authorized by the product owner on conditional approval of W3; design in [workflow-integrity.md](workflow-integrity.md) §5 and §12. Complete, pending review; migration 0092.

- Remediation precedes retesting wherever phases are shown. Each roll-forward and retest round has a readiness of its own (`round_readiness.py`): a retest waits for the remediation evidence, the fixed control's operating period, its population and samples and the approved plan; a roll-forward for effective interim testing and its evidence, not for interim's review. Approving a round's samples and the tester's run wait on it and say why; the register's rounds and the journey's phases carry the blockers.
- W3 follow-ups: the agent's impact recommendation treats changes to the understanding, scope or risk as a person's judgement (never VALID by rule); a qualified reviewer may document that a signed review covers later work (`review_coverage_assessments`, immutable, the review untouched); finality reads each round's impact and coverage; REPERFORM after a signed review reopens the review with its record kept.
- Legacy tests updated: the retest flows receive the remediation evidence before sampling (the approved rule); no assertion weakened.

**Workflow integrity W3: sign-off history and plan-revision impact assessments.** Authorized by the product owner on conditional acceptance of W1 and W2; design in [workflow-integrity.md](workflow-integrity.md) §4 and §11. Complete, pending review; migration 0091.

- Every sign-off of a test sheet and of an independent review is kept as made (`test_sheet_signoffs`, `control_review_signoffs`): signer, time, conclusion or coverage, sheet version, plan revision. Reopening marks the record once; triggers refuse any other change and every delete.
- Results signed off under a plan revision that was later revised, or never recorded, raise a `plan_impact_assessments` row (on approval of the revised plan, at deploy, on request). The agent compares the plan versions and recommends VALID or REPERFORM with its rationale; nothing is valid until the engagement's reviewer, never the signer, decides. Until then readiness is `IMPACT_PENDING` (blocking), `final` is false, the journey marks the results stale and the Home queue asks for the decision. REPERFORM reopens the testing and the review that covered it, with the assessment as the reason.
- A signed review covers only the sheet version and workpaper versions it recorded; later versions read "review outstanding" while the historical review stays.
- Also completed: the two W2 integration tests the owner asked for (a failed retest through its round review; a must-fix note reopening a round).

**Workflow integrity W2: independent review of testing rounds.** Authorized by the product owner with the risk-based testing strategy ([test-strategy.md](test-strategy.md)); design in [workflow-integrity.md](workflow-integrity.md) §3 and §10. Complete, pending review; migration 0090.

- A roll-forward or retest round signed off opens a review of its own (`control_reviews.test_round_id`); the reviewer agent re-performs the round's sheet; a reviewer decides the notes and signs off under the same role, independence and clearance rules as the control's review. Sign-off records what the review covered (`coverage`: the sheet and its version, the round, each prepared workpaper and its version). A prior review never covers later work; `finality` counts a signed round as covered only once its own review is signed, and the journey reads it as reviewed.
- A passed retest remediates its deficiency only when the round's review signs off (owner's decision 2); a failed retest returns it to remediation at the sheet's sign-off as before. `test_test_rounds` was updated accordingly (old: REMEDIATED at sheet sign-off; new: READY_FOR_RETEST with the result recorded, then REMEDIATED at the review's sign-off, covered in `test_round_reviews`).
- Rounds signed before 0090 are review outstanding until a reviewer signs one (decision 3). Nothing about the control's own review, its gates or its history changed.

**Workflow integrity W1: the canonical control state.** The product owner approved the integrity plan in [workflow-integrity.md](workflow-integrity.md) (W1–W4, each reviewed before the next) and authorized W1. Complete, pending review; migration 0089.

- `conclusion` stays the audit opinion (EFFECTIVE / EXCEPTION). `final` (`control_journey.finality`, derived from `finality_facts` in one pass per engagement, never stored) is the one indicator that the opinion is complete: the plan approved at its current revision; design and implementation prepared where applicable; interim signed off, with its plan revision recorded and equal to the approved one, and independently reviewed with nothing signed after the review; every applicable roll-forward and retest round tested and reviewed; no retest outstanding. Required phases come from the plan's applicability. Until W2 and W3 exist, a signed round and a sheet whose plan revision is unknown each keep `final` false with the reason named.
- Completion follows `final` everywhere it was read from the opinion: the register's stage `CONCLUDED` and its next step (the first reason keeping the conclusion open, as a stage of its own), the lifecycle stage, the dashboard's concluded count, the engagement data's "complete" testing status (status report), the review-complete milestone (`review_overview.complete`) and the Home journey. `ControlRow` gains `final`, `not_final` (reason, step, phase), `reopen_reason` and `reopened_from`; the journey gains `final` and `not_final_because`, and its `conflicts` are empty by construction.
- Sign-off stamps `test_sheets.plan_revision` (a column since 0079 that nothing wrote). Migration 0089 records on the sheet why it was reopened, by whom, when and from what (a review note, an impact assessment, a person); the register's new stage `TESTING_REOPENED` reads "Testing reopened" with the reason while the review's notes keep their own workflow. Sign-off clears the current reason; the audit log keeps every past one.
- No gate, permission or stored record changed. Assertions that encoded the old reading (a control concluded with work outstanding) were corrected and are listed in the W1 report.

**Workflow redesign, Milestone 0: the control's journey, validated (no UI).** The product owner approved the guided-testing design in [workflow-redesign.md](workflow-redesign.md) and authorized Milestone 0 only; Milestone 1 waits for its results and a further approval. Complete, pending review; no migration.

- `control_journey.journey_of` derives, from the register row the workspace already builds plus the control's rounds and requirement counts, the step (Plan, Request, Test, Conclude, Review, Done) and its phase; each phase's state (design, interim, roll-forward, and retest and remediation once opened) and whether it is ready for testing, with what holds it; the outstanding blockers across the control; work a review note reopened; and results signed off before the plan changed (stale). Exposed read-only as `journey` on `/workspace/controls` rows. No business logic, gate or authorization rule changed.
- The step follows the open phase furthest along; earlier open phases (design evidence still to request while interim is tested) are listed as outstanding, not hidden. Where the register's older words disagree (`progress_of` reads a control as concluded once its review is signed, even with a roll-forward round open or the plan revised since), the journey reports the disagreement in `conflicts` for the owner's decision rather than changing either.
- Scenario tests (`tests/test_control_journey.py`): plan not approved; interim reviewed while the roll-forward is tested; the roll-forward waiting on interim; incomplete and overdue evidence; a plan revised after results were signed off; a review note reopening the testing; an exception with a proposed deficiency; remediation and retest rounds; a fully concluded control; agreement with the register across its stages; and the invariants on a fixture engagement and after a real plan revision.

**Engagement home: where the engagement stands and what to do next.** Requested by the product owner ("as a user I'm getting confuse on what to do next"); they chose a Next steps home with the journey and one unified list first, and the menu reorganized later. Complete, pending review; no migration.

- An engagement opens on Home (the former Dashboard, now first in the menu); the agent console is one click away. `GET /organizations/{org}/projects/{project}/next-steps` (`next_steps.py`) returns the journey and the steps; the page is `home-view.tsx` with `home-model.ts`.
- The journey shows six stages, each with its progress: set up (launched), test plans (approved of in scope), evidence (requests received), testing (controls concluded), review (controls signed off), and close (engagement completed). The first unfinished stage is current. Reports have no issued state, so close is the engagement's completion.
- **Do next** is one ordered list: the setup to finish before launch, then the test plans' work (plans held by something to settle, plans to re-approve after a change, plans to approve, client values to answer, client controls to describe as an optional step), then everything the console's "Waiting on you" holds, each in its stage. Items that hold the engagement up come first in their stage, and the first item is marked "Start here". Each step opens the page where it is done; requests without a recipient open the evidence coordinator's field. Nothing is decided from Home.
- The dashboard's figures follow as "Engagement health". The separate "Waiting on you" card, and the banner for requests without a recipient, are replaced by the list, which holds the same items.
- A control whose test plan is not approved is at the new stage "Test plan to approve" (`workspace.progress_of`), not "Not yet requested": nothing is requested before a person approves its plan.

**Standard library, milestone L3e: library attributes are decided in the library review.** Requested by the product owner ("I'm already reviewing the library so it should be dealt on the library review not on the test plan"). Complete, pending review; migrations 0085, 0086, and 0087. See [library.md](library.md).

- A control following a library standard takes all of the standard's attributes approved, the LOW and NOT_ESTABLISHED ones too, each with its question as a note (`library_definitions.link_definitions`, and adoption of a later version). The plan review no longer asks a person to decide them; a person can still retire one that does not fit the client.
- Testing waits for every client value an approved attribute still shows in brackets, as well as the statement's blocking values (`control_design._waited`); the plan review and the Design tab ask for them. Thirteen optional attributes whose value the statement did not wait for now hold testing until it is entered (for example the access review deadline).
- Migration 0085 approves the library proposals still open in engagements (unless the same wording is already approved) and rewrites each affected control's attribute list.
- What the rules can settle is not left on the plan for a person (requested by the product owner: "I want this to be smooth onboarding as much as possible"):
  - A copy of a library attribute with its value typed in (as a control copied to another system or re-added to scope carries it, without its link) is that attribute (`Definition.filled_from`): it is linked and worded with the client's recorded values, or retired with a note when the library's own is on the control too. No second copy is added.
  - Every deploy (`make start`, after the migrations) runs `master_plans.settle_library_attributes`: each unapproved plan not being drafted is linked as above and, where a library attribute is untested or unsupported or the rules planned evidence for an attribute the control does not test, planned again with the rules, as "Plan again with the rules" does. An approved plan is left as it is. Idempotent.
  - The plan no longer flags a library attribute's inference as undocumented (the standard's basis is decided in the library review), nor design evidence as supporting no attribute; the planner no longer plans a suite item whose attributes the control does not test.
- The Library page, the module notes, and the published definitions say so; the index counts a standard's client-dependent attributes as such, not as proposals.
- Bulk methodology review (requested by the product owner: "Any chance I can do bulk review here?"): an owner or admin selects standard controls awaiting approval on the Library page (by row, by area, or all shown) and approves them together, with one optional note. One call, all or none; each control's decision is recorded and audited on its own, and one already approved is skipped (`library_governance.decide_status_many`).
- Client values answered where the plan shows them missing (requested by the product owner: "is there any way to close that here?"): on a plan's Understanding tab, each value the plan asks for that appears in its text, and each missing fact that waits for one, opens the queue's answer dialog for that control, focused on that value (`viewer_can_answer`, task.update, as on the queue). A value the plan does not ask for stays shown in brackets.
- Approving a plan stays approved when a client value is filled into it later (reported by the product owner: "I open it and click approve but the status is not being updated"; decided: keep the approval). Answering a value with "Also use these answers for other controls" filled it into plans already approved and withdrew their approval. Migration 0086: filling a value the plan left in brackets (in the value, an attribute's wording, or the description) is not a revision; changing or clearing a value already recorded, and every other change, still sends an approved plan back for review. The plan lists the values filled since approval. The approve button also keeps reading "Approving…" until the refreshed plan shows, so a slow refresh no longer looks like nothing happened.
- A plan approved before and changed since says what changed (reported by the product owner: "Ready to approve but shows there is already approved?"): `master_plans.changes_since_approval` compares the approved snapshot (`plan_versions`) with the plan now, item by item (control fields, understanding, phase applicability, procedures, attributes, evidence; wording that only fills a client value is not a change). The queue row reads "Changed since approval: 13 procedures, 3 evidence items, title", its next step "Re-approve the changes", and its last decision "Approved revision N"; the plan shows a panel of the changes, one line per part of the plan, each item's code opening it.
- Found and fixed with it: a sentence a person appended to a standard evidence item's wording was dropped from the request (it fell into the "Not sufficient" part, which requests leave out); `suite_wording` now keeps it as the item's note, and the request asks for it. A client's own control following the standard is planned from the whole suite again (the suite skip applies only to controls whose attributes are linked to it).
- Every finding on a plan says what resolves it, with the control that does where the plan can (reported by the product owner: "not providing any solutions or links on how to address them"; `planning-model.findingFix`): the row's link editor (evidence or a procedure linked to no attribute, evidence naming one the control lacks), the attribute's criteria, planning this control again with the rules (an attribute nothing tests or supports, unapproved plans; `POST …/master-plan/replan`), the procedures or evidence to link it from (approved plans), the control's attributes, or the test basis on its Design tab (a deviation from the standard).
- Found and fixed with it: evidence planned while an attribute still had a client value in brackets was flagged as naming an attribute the control does not have once the value was filled (`master_plans._names_attribute`).
- A system added by hand to an engagement built from the client's RCM (reported by the product owner: "Why are the recommended controls coming from the RCM? I should also have the option to select from the standard library ... the reference [should] be from the system I just created"; decided: nothing in scope at first, the library and the client's controls offered, a new reference with the standard's wording, the copies removed):
  - A new system joins only the library's standards (`control_instances.add_application_everywhere`); the client's controls from its RCM are each for their own system and are no longer copied onto it. The row's "Add controls from the library" offers the library only.
  - The wizard offers the system's own controls, the client's IT general controls on its other systems, and the library (`system_scoping.gather`). Where the client's references name their system (ITGC-SAP-02), the controls that follow the same standard are offered once, adapted (`adapted_controls`): the reference in the client's scheme for this system (ITGC-AD-02, from its reference code, suggested from its name and editable in the wizard), the standard's statement worded for this system (or the client's wording with the other system's name replaced when no standard matches), what it was adapted from (`engagement_controls.adapted_from`), and an open question for the client to confirm it. References that name no system (AC 1.02) stay one family across systems, as before. Other systems' application controls and key reports are not offered.
  - A system's controls are one per standard: "Add controls from the library" offers the system's own control for a standard under its own reference ("Add back", ITGC-AD-01) when it is out of scope, and not at all when it is in scope; adding a standard the system already has in scope is refused with the reference it is in scope as (reported by the product owner: adding ITGC-AC-02 did nothing while ITGC-AD-02 was in scope).
  - "Add controls from the library" has a quick search (every word in the ID or title) and filters by area and for the controls taken out of scope, with the count shown and a Clear (requested by the product owner; `onboarding-model.filterOffers`, `library-offers.tsx`).
  - Migration 0087: `engagement_applications.ref_code`, `engagement_controls.adapted_from`. The 45 controls copied onto Active Directory in FY2027 Audit (in setup, nothing depending on them) were removed, with an audit event.
- A client's own control is described where its plan asks (reported by the product owner: "I'm not too clear what to do here"; decided: one dialog, proposals confirmed there, a matching standard suggested). Migration 0088, `engagement_controls.stated_facts`: what the team states (preventive or detective, performer, reviewer, assertions, and the planner's proposals it confirms: objective, population, what it relies on), with who and when; `PUT …/master-plan/facts`. Its missing facts are "Describe the control" on the plan (resolve FACTS), not the client values of a library statement; the Describe dialog asks each as a question with the input that fits. Stating a missing fact keeps an approval (as a filled value); changing one reopens the plan. A control whose RCM states no test attribute is offered the standard it matches when the match is strong ("Use its attributes", a customized standard); when none clearly matches, the plan says so and points to writing the attributes or choosing a standard.
- Not built: answering a NOT_ESTABLISHED attribute's yes/no question (for example whether inappropriate access is investigated) before it is tested; it is tested as the standard states it, and a person retires it on the Design tab when the client's control does not require it.

**Standard library, milestone L3c wave 1: the IT general controls, application controls, and key reports the catalogue lacked.** Requested by the product owner ("revisit the standard suite of sox controls... add all the missing controls with their standard attributes and procedures and evidence"). Decided by the product owner: the full proposed lists; IT first, business process next; the 34 version 3 controls rewritten after. Complete, pending review; no migration. See [library.md](library.md#breadth-wave-1-the-it-general-controls-application-controls-and-key-reports-the-catalogue-lacked-milestone-l3c).

- 29 standard controls added at version 4 (12 IT general, 11 application, 6 key report), each with a design statement (`statements_itgc_more.py`), a library record (`controls.V4_LIBRARY`), a stepped definition with its evidence suite (`definitions_itgc_more.py`, `definitions_itac.py`, `definitions_ipe.py`), and matching signals; the library is 82 controls. Every structural check (library, definitions, statements) passes and every version 4 standard plans and validates.
- Application controls are tests of one built by `definitions_itac._automated`; key reports by `definitions_ipe._report`; the client's criteria (delegations, matrices, thresholds, limits) stay LOW with their question. ITGC-OP-07 defines the SOC 1 review that ITGC-OP-05 deferred.
- Matching: a signal per new standard, the specific displacing the general; 31 scenarios find their standard as strong; the pinned library fingerprint and counts are re-pinned; the published definitions are regenerated.
- Not built: wave 2 (business process, fixed asset, tax, entity-level, about 39), version 4 depth for the 34 version 3 controls (L3b), and adding the new IT controls to scoping's recommended sets.
- Next: L3c wave 2.

**Standard library, milestone L3a: depth for the IT general controls (library version 4).** Requested by the product owner ("why a lot of those procedures are one liner only? I want the procedures and attribute to be solid as this will be the foundation of the agents test. I also want you to include standard suite of evidence for each control"). Decided by the product owner: numbered steps per procedure; a structured, keyed evidence catalogue per control; the IT general controls first; the Library page and the planner now, workpapers later. Complete, pending review; no migration. See [library.md](library.md#depth-steps-and-evidence-suites-milestone-l3a-library-version-4).

- The 19 IT general controls are rewritten at definition version 4: 117 procedures as 338 numbered steps (each with the evidence it uses, what to record, and what to do when it does not hold), 76 attributes (65 tested; 25 added from the controls' statements, inferences marked as such), and a standard evidence suite of 151 keyed items (form, provider, phases, purpose, period, contents, completeness, what is not acceptable, alternatives, attributes supported). The shared steps are written once in `definitions_support.py`.
- Structural checks extended for version 4 (steps, keys, suite use, vague wording) and the published definitions regenerated with steps and suites. Every version 2 attribute is still carried or retired with its reason; the library records still derive their tested attributes from the definitions; the pinned library fingerprint is re-pinned at version 4.
- Each definition carries its version. Engagement controls at version 3 keep their links and statements (`DEFINED_SINCE`); a version 4 update is offered to the controls of the rewritten standards and adopted by a person as before. A firm's approval reads as superseded against the definition's version, not the library's.
- The planner builds a following control's evidence requirements from the suite (population, completeness support, attribute evidence depending on the population, change history, context), replacing the generic rules while keeping the engagement's own change requirements; a configured control takes no sample; every version 4 standard plans and validates.
- The Library page shows the steps and the suite; plan rows link to the standard's steps.
- Not built: steps and suite keys in plan rows and workpapers; version 4 for the 34 other controls (L3b); new standard controls (L3c).
- Next: L3b, depth for the remaining controls.

**Standard library, milestone L2: test basis and matching.** Requested by the product owner ("move to the next milestone", with the flexibility to use the standard procedures, the client's, or a customized standard). Complete, pending review; migration 0084. See [library.md](library.md#test-basis-and-matching-milestone-l2-migration-0084).

- A person decides, per control, what its test plan is built from: the standard, a customized standard (the standard as a starting point, tailored), or the client's own procedures. With no decision a library copy follows its standard and a client's control the client's procedures; nothing is forced. Decided by the product owner.
- Matching runs only when a person asks (decided by the product owner): fixed rules shortlist and rank the standards of the control's category and area with a qualitative status (strong, partial, none), and the configured model adjudicates the shortlist, its answer checked before use; the rules stand otherwise. Thirteen RCM-worded scenarios find their standard as strong and two negatives are declined (`test_library_matching.py`).
- Following a standard adopts it: the control takes its key, the standard's attributes are proposed for a person to decide, the client's own attributes stay, the control is planned again with the rules, and the plan goes through its approval. A client's control keeps its own activity text. A standard pending methodology review may be followed (decided by the product owner); the plan review says so without holding approval, linked to the Library.
- The planner applies the library definition only when the basis is the standard or a customized standard; a plan that follows the standard as such reports a person's procedure as a deviation.
- Found and fixed: `refresh_statement` rewrote any control's description with the library statement; it now rewrites a library copy's only.
- Not built: matching at import or in the background, a calibrated numeric confidence (there is no labelled set), and limiting adoption to approved standards (the firm has approved none yet; the flag is shown instead).
- Next: L3, the standard controls the library lacks, in waves, each landing as pending methodology review.

**Standard library, milestone L1: governance and the Library page.** Requested by the product owner (a standard audit procedures and test attributes library; decided: the library stays in code, with a governance table; L1 first). Complete, pending review; migration 0083. See [library.md](library.md).

- The library's content stays in code (53 standard controls, 160 procedures, 146 attributes with their confidence, statements, and sources), version-controlled, checked, and published; the new tables record a firm's methodology review of each standard control and the changes proposed to it. Nothing an engagement loads, plans, or tests changes.
- Each standard control stands as draft, pending methodology review, approved at a library version, superseded (approved at an earlier version; derived), or retired; with no decision it reads as pending review. Owners and admins decide (`organization.update`), never the same status twice; approving records the approver and version; every decision is an audit event (`library.status`).
- Anyone in the firm proposes a change, a retirement, or a new standard control; an owner or admin accepts or declines it with a note (`library.change_request`, `library.change_decision`). Accepting edits nothing: the change is applied in code for the next library version.
- The **Library** section, under Setup, needs no engagement: figures by status that filter the list, the five categories, a search, and the controls by area one line each; one control shows its status and decision, objective and risk, and six views (procedures by phase, attributes tested and proposed, evidence, design with the client's values, sources as read, usage across the firm's engagements), applicability folded, and the change requests with their form and decisions.
- Not built, by design: enforcing the status in engagements (L2 limits matching and new plans to approved entries), a dedicated methodology-reviewer role (owners and admins decide, as for the firm's other settings), and editing definitions from the page.
- Next: L2, matching client controls to approved standard controls with a person's confirmation.

**Master test plans, milestone E: phase-based release.** Requested by the product owner ("proceed to next milestone"). Complete, pending review; migration 0081.

- Every phase's evidence is planned and drafted in advance; requests are released progressively (`phase_release.py`, `phase_releases`). Design and implementation follows the test plan's approval. Interim and the roll-forward are released by a person (project.update) for each control; until then their prepared requests are held ("Release the interim phase for this control first"), and approving, submitting, or sending them is refused. Releasing never sends anything; each request is still approved and sent by a person. The agents never release a phase.
- Decided by the product owner: interim is recommended for release once design and implementation testing is complete (the design workpaper prepared by a person), the roll-forward once interim testing is signed off, or once design is where interim does not apply. A reviewer may release earlier for one control with a reason of at least twenty characters, recorded with the release (`early`).
- The platform recommends, never acts: "Design and implementation testing has been completed for N controls. The interim evidence requests are ready for review." The control's next step reads "Release the interim phase"; held requests no longer read as "Submit the evidence request".
- The **Phases** view of the Test plans page: figures for what is ready and released, the recommendation with "Select the ready controls", and each control's three phases (not applicable, waiting for the test plan, waiting for the earlier phase, ready to release, released, released early, complete); a reviewer ticks controls and releases the chosen phase for each on its own (`POST …/phases/release`); early ones need the reason. Each plan's review shows its phases with Release or Release early.
- Phase exceptions follow the plan's applicability: a phase that does not apply is never released or waited for; a control introduced after the interim date goes from design straight to the roll-forward; a configured control has no population in any phase (8.7).
- Migration 0081 records as released the phases already under way (a request sent, testing started, a roll-forward round opened): 17 interim phases on the development database. Kickoff requests from before phases were planned are settled against the plan, not released.
- Not built: withdrawing a release, and a separate reliance assessment for the roll-forward (its plan already asks only for the remaining period and changes since interim; files already held serve its requirements through the 8.7 links).

**Master test plans, milestone D: specific requests, checked against the plan.** Requested by the product owner ("next milestone"). Complete, pending review; no migration.

- Before approval, every request a person or the agent prepared is also checked (`request_quality.py`, in `request_details.request_checks`): its wording asks for something specific in the client's terms (no catch-all such as "all relevant supporting documentation", no plan codes, testing terms, agents, or standards); every item that evidences an attribute (a sample's, an execution's, a configuration) maps to an approved attribute of the test plan; each item's period lies within its phase's window; its phase still applies; no proposed change to one of its items waits; and no other open request of the same control and phase asks for the same items. Each says in words what to fix; approving refuses while one fails, and the bulk approval reports it per request.
- The drafter's model draft is rejected when its wording would fail the same check (the rules' draft stands), so the agent never offers what approval would refuse.
- The rules' population requests name the fields the sample is selected and traced by: access (user ID, name, access or role, request date, approver, approval date, date granted), change (change ID, description, requester, approver and approval date, test evidence reference, deployment date), operations, and transactions.
- The reviewer sees, before approving, which approved attributes the request supports: on the request panel ("Supports A1, A2, A3", opening to each attribute and the items that evidence it) and on each row of the Evidence page's request list. Internal: the client's view of the request (`client_content`) never carries them.
- Fixed from milestone A: a request whose plan had changes requested did not show as held on the request list.
- Checked against the development data: of 1,096 requests, the wording check flags one ("test attribute" in the client's wording); lists that end "and any other filters applied" or "(standard, emergency, etc.)" pass.
- Not built: a similarity measure for duplicates beyond identical wording, a length limit on wording (a request is still never cut), and rewording the sample-evidence items that list the attributes in plain words.

**Master test plans, milestone C: the review screen and the planning queue.** Requested by the product owner ("proceed to next milestone"). Complete, pending review; no migration.

- A **Test plans** page in the engagement navigation (`section=planning`): six figures that add up to the controls in scope and filter the list (ready for review, needs clarification, changes requested, approved, being planned), a search, and one compact row per control with its state, what it has to resolve, what holds its approval, and its last decision. **Review next plan** opens the first one waiting. **Plan again with the rules** plans every unapproved plan again.
- Approving from the queue: a reviewer ticks the plans they reviewed; each is approved and recorded on its own, at the version shown, with an optional comment (`POST …/planning-review/approve`). A plan changed since the queue was read is refused and said so; nothing else is approved. Only someone with project.update sees the boxes, and the API refuses anyone else.
- The **master test plan review** (`&control=`): the control, its system, type, frequency, state, revision, and last decision; one action bar (approve with an optional comment kept with the decision, request changes with a comment, submit for review for a preparer, accept or dismiss the planner's revision); what holds approval and the questions that do not, in one short block; four tabs (control understanding, test procedures, test attributes, required evidence) with counts and a flag for what needs a look; previous, next, and next waiting for review without going back.
- The tabs are linked: every procedure, attribute, and requirement shows the codes it links to; choosing one opens its tab, outlines it, and lists what it traces to. Procedures, their attribute links, requirement links, and attribute criteria are edited in place; the plan is revised and an approved plan goes back for review. Each item says who wrote it (the planner agent, the reviewed rules, the library, a person); agent work is never shown as approved. Supporting sources (the quoted words and where they come from) show on request. The decision history folds under the page.
- Refined from the review of real plans: evidence that supports the testing (a population, documentation, report support, change history) is no longer reported as supporting no attribute; only evidence of an attribute (a sample's, an execution's, a configuration) must say which. The control record's **Review the test plan** opens this page.
- Checked in the running app (headless Chrome, development data): the queue (73 controls) and the review at 1440 px and 390 px wide, no sideways scroll; selecting I3 traced A1 to A4 and E5, and a chip opened the attribute's tab. Approving and requesting changes were exercised by the API tests, not on development data.
- Not built: approving many plans from a filtered list without ticking each (by design), a person confirming one fact on its own, comparing two plan versions side by side.

**Master test plans, milestone B: grounded planning.** Requested by the product owner after milestone A ("proceed with milestone b"). Complete; migration 0080.

- The understanding of each control is twelve facts built from the records (objective, risk, description, manual or automated, preventive or detective, frequency, performer, reviewer, system, population, assertions or IT risks, dependencies), each with its basis (source, proposed, judgment, assumption, missing) and its source quoted. What no record states is missing with a targeted question, never filled in; the plan then reads Needs clarification. The facts are in the version a reviewer approves; recording a client value revises the plan.
- Library controls are planned with their definitions' procedures, linked to the attributes they test; other controls link only the procedures that test the attributes. Design procedures trace to the risk, not to attributes. Requirements link to the procedures that test what they support, derived from the links.
- The planner agent may propose criteria for attributes no library definition covers; they show as the agent's and never replace a person's. Vague criteria are left for a person.
- A model plan is rejected (the rules' plan stands) when it cites a standard the records do not, treats prior-year work as evidence of operation, states a threshold or deadline no record gives, quotes a source that does not say it, or links what the control does not have. All 400 development controls' rules plans pass the same checks.
- `POST …/evidence-plans/replan` plans every unapproved plan again with the rules.
- Found: library statements leave the performer and reviewer as client values (a bracketed role) until the team records them, so most launched library controls read Needs clarification until those values are entered; the reviewer can still approve.
- Not built: the review screen (milestone C) showing the facts, the links, and the criteria; a person confirming one fact on its own (the approval confirms them together).

**Master test plans, milestone A of the agentic workflow review.** Requested by the product owner (an end-to-end review of the agentic IT SOX workflow: onboarding, planning, human review, evidence planning and approval, collection, validation, testing, review, and reporting). Complete; migration 0079. The product owner asked to proceed to milestone B. The onboarding integrity and planning-gate milestones below were accepted by the product owner before this one started.

- Found in the review: testing was not gated on plan approval (readiness checked only approved attributes); library and RCM attributes entered as approved with no person (the 0061 trigger); approval was not bound to a stored version (it overwrote the approver and kept no copy); a person's edit to an approved plan, and a later planner run, changed it without review (the run rewrote its understanding and procedures and added requirements directly); procedures were plain text and requirements named attributes by wording; contributors could approve plans; there was no "request changes".
- The evidence plan is the control's **master test plan** in four sections: understanding of the control (its own facts and the planner's understanding), test procedures per phase (`plan_procedures`, codes D1, I1, R1), test attributes (codes A1, with the condition, pass and fail criteria, whether judgment is required, whether automated testing suits it), and required evidence (codes E1). The sections link by identity, many to many (`plan_procedure_attributes`, `evidence_requirement_attributes`, `evidence_requirement_procedures`); what does not link up is a finding the reviewer sees and the decision records. Criteria not stated on the plan come from the library definition, marked as such.
- A person with project.update approves the plan's current revision or requests changes with a comment; contributors edit and submit for review. Each decision is kept, unchangeable, with a hashed copy of the plan as the reviewer saw it (`plan_versions`, `plan_decisions`). Decided by the product owner: approving the plan approves the control's attributes with it, so it is refused while an attribute waits for a decision or a question about them is open.
- A material change (procedures, approved attributes and their criteria, the links, the control's own facts, a person's edit to evidence or a phase, an accepted proposal) revises the plan, and an approved plan goes back for review; the database refuses an approved plan whose approved revision is not its current one. A later planner run never changes an approved plan: its understanding and procedures wait as a proposed revision, and new evidence as proposed additions, each accepted or dismissed by a person.
- Nothing downstream runs on a plan no person approved, or one changed since: requests are drafted, approved, and sent only through the planning gate (as before), and now samples are approved, the tester runs, and test sheets are signed off only on an approved plan (readiness check **Test plan approval**, state **Test plan awaiting approval**). Requests and test sheets record the plan revision they were made under.
- Seven planning states, derived from the records: not started, analyzing, needs clarification, draft ready, pending review, approved, changes requested. `GET …/planning-review` lists every in-scope control (none left out) with its state, counts that add up, and the next control waiting for a reviewer; `GET …/controls/{id}/master-plan` returns the four sections, findings, blockers, decisions, and whether the viewer may decide.
- Decided by the product owner: every plan approved before this milestone is reviewed again (migration 0079 withdrew 5 approvals on the development database, each kept in the audit trail); a plan cannot be approved while the planner agent is still drafting it.
- Not built in this milestone: the four-tab review screen and the planning queue page (milestone C; the control's plan panel gains Request changes and the proposed-revision decision only), the planner writing procedure-to-attribute links and criteria (milestone B), concise request wording and the evidence approval queue (D), phase release (E), and reassessing downstream work made under an earlier revision beyond recording it (F).
- Next: milestone B, the planner's four sections with provenance and fabrication checks.

**Engagement onboarding integrity and UX revamp.** Complete, accepted by the product owner; no migration. Requested by the product owner after review of the setup and launch journey.

- Launch approval is bound to the complete launch-relevant setup, including the engagement profile and the workpaper templates a person reviewed. A stale browser tab cannot launch a materially changed engagement.
- Reading onboarding data never schedules agent work. Pending evidence drafting resumes only from an authorized mutation or the worker's recovery path.
- Profile fields distinguish "leave unchanged" from "clear this value". A person can remove an optional period start or clear an incorrect period end before launch, and readiness updates from the resulting records.
- Setup is a decision-oriented journey: the overview gives one next action, the step rail separates complete, current, blocked, and optional work, each step explains its outcome before its mechanics, and launch puts blockers, advisories, and the approval decision in one scan path.
- Dense setup content is progressively disclosed. Controls, systems, templates, and launch details keep their existing capabilities while using clearer hierarchy, shorter instructions, consistent action placement, accessible state text, and responsive layouts.
- Acceptance: regression tests cover all three integrity defects; the onboarding model and route tests pass; TypeScript and Python checks pass; database-backed onboarding tests pass when the configured test database is available; no live email or other new external side effect is enabled.

**Planning before requesting.** Complete, accepted by the product owner; migration 0077.

Asked by the product owner ("why are evidences drafted before planning?").

- Found: most development engagements hold kickoff drafts made before evidence planning existed (FY 2027 Audit 80, SOX FY 2027 184), and newer launches drafted every design and interim request at launch from the rules' plan, which no person had approved (SOX FY 2028: 160 requests from 80 proposed plans). The earlier choice "a validated plan is enough" meant the planner's own checks, not a person.
- The planning gate (`evidence_plans.gate_reason`), decided by the product owner: nothing is drafted until a person approves the control's evidence plan. Design evidence (policy, narrative, walkthrough) is released on approval; operating evidence (population, samples, reports) also waits for the control's attributes to be settled (approved attributes, none proposed, no open conflict about them). Approving the plan, or settling the attributes, requests what the gate then allows (`release`), once.
- At launch each control gets the reviewed rules' plan at once, and the planner agent refines it in the background (`evidence_plan_run`, the local worker and the workflow engine both; with no model the rules' plan stands). The plan waits for a person either way. Decided by the product owner.
- Requests already drafted from an unapproved plan or before planning are held, not deleted: they show as awaiting plan approval and cannot be approved, submitted, or sent until the plan is approved (kickoff drafts are still reconciled against the plan). Decided by the product owner.
- The control's next step says "Approve the evidence plan", then "Settle the attributes to request operating evidence" where that is what waits. Scope changes use the rules' plan; a person can ask the agent to plan again.
- Not built: approving many plans at once, and the agent proposing attributes as part of the background run (it reads them; the attribute review stays on the control).

**Evidence command center, increment A of three.** Requested by the product owner (the engagement's Evidence page listed 160 requests as expanded rows, with setup forms and a request form always open). Complete, pending review; migration 0076.

- The page is Evidence Management: a compact header (New request, Generate requests with AI when the planner has work, More actions), eight figures that each filter the list, and three views: Requests (the default), Evidence Library, and Client Portal (coordinator, client domains, secure links, replies). A setup notice shows only when requests wait for a recipient and no coordinator is set.
- Requests is one table filtered, sorted, and paged by the API (`evidence_center.py`, `GET …/evidence-requests`): search, filters by status, phase, evidence type, owner, and system, built-in and saved views, sticky header, 25 to 200 rows a page, and selecting every matching request. A request opens in a side panel (the request panel from the last milestone); its delivery and reminders show above it.
- The owner is changed in place from the engagement's contacts, the control's owner first. Many requests are assigned, given a due date or priority, approved, submitted, or returned at once: each is checked first (what blocks each one, in words), then only those that pass change, one transaction each, with the same rules and audit trail as a single change. Approving never sends.
- The stage is derived from the records, as decided: a file arriving never completes a request; it is completed once every planned item is judged sufficient or waived. Overdue and escalated are flags.
- New request is a side panel: choose the control, request its planned evidence (the evidence coordinator drafts the wording), or write the request with phase, type, title, recipient, due date, reminders, and priority, with a preview of what the recipient receives. Reference materials are attached once it is saved.
- Who drafted a request is now recorded (`drafted_by`), not inferred from its control: a person's request can name its control and still goes to someone else for approval. Saved views are stored per person per engagement.
- Decided by the product owner: lifecycle derived with flags; evidence reuse through a link table (increment C); saved views stored per person; three increments.
- Next: increment B (agent owner suggestions with source and confidence, duplicate detection, the insights panel, validation outcomes, Agent Activity), then C (one file serving several requests and controls, versions, the Client Portal view, follow-ups in bulk).

**Evidence request details and recipients.** Requested by the product owner (the request panel mixed internal rationale with what the client receives, had no request type, and set the recipient only in an Edit mode). Complete, pending review; migration 0075.

- Each request has an explicit type from twelve, held as data (`evidence_request_types`), separate from its phase. The type is worked out from the records (the plan's requirement categories, the drafter's item kinds, the request's purpose, the control's area) until a person confirms it; a type the records do not settle is a recommendation the reviewer confirms before approving the agent's draft. Decided by the product owner: one request per control and phase, its primary type its purpose, each deliverable showing its own type.
- The panel shows a title, reference, type, phase, priority, and due date; the client checklist read back from the wording; submission instructions; and the audit team's planning (why each item is asked for, the drafter's assumptions) collapsed and marked internal.
- Recipients are set inline, with no Edit mode: a search over the engagement's contacts (owners, coordinator, contacts added from requests, past recipients), the owner or coordinator suggested, a new contact added and saved to the engagement, people copied (Cc), due date, and priority, each saved as it changes. Addresses must be within the client's email domains (Engagement Setup's, else its owners' and coordinator's). Changing an approved request returns it for approval. Decided by the product owner: one recipient, people copied on the email, all bound by the approval.
- Reference materials: upload, one of the engagement's files, or the prior-year workpaper of the same control from the same client's earlier engagement (never another client's, and only one the person can read). Internal by default; shown on the owner's secure upload page only when someone who may approve shares it. Removed, never deleted.
- The lifecycle (draft to completed, with changes requested, partially received, clarification needed, rejected, cancelled) is derived from the records; no status migration. Decided by the product owner. Checks run before approval and again at sending.
- Not built: copied people opening the secure link (the one-time code goes to the recipient), a reason on contact edits, and classifying an owner's reply as a question (clarification is an owner reply the team has not reviewed).

**Evidence workflow integrity and navigation.** Requested by the product owner (ITAC-SF-03 on DocuSign: "Review and submit the evidence request I drafted" opened the Evidence tab on the wrong view, beside "Not planned yet" and "0 / 0 accepted"). Complete, pending review; no migration.

- Root cause: twelve engagements launched before evidence planning existed (migration 0062) have kickoff drafts and no plans, and nothing planned them afterwards; the planner had not run, and the drafter had not bypassed it. Planning replaced a never-sent kickoff draft on its own. "Open" pointed at an anchor the Evidence redesign had removed. A rejected approval left the request awaiting approval.
- Planning comes first: an unplanned control's next step is to plan it (one control, or all on request from the dashboard); a kickoff draft is settled by a person, replaced (kept on record, with why) or kept; the API refuses to submit it before then. Decided by the product owner: plan on request, a person settles each kickoff draft, rejection returns the request to draft, drafting from a validated plan stays (every request still needs a submitter and a different approver).
- One derivation of the evidence work (`evidence-flow.ts`), from the records, read by the Overview, the record's header, and the Evidence tab; the server's next step (`workspace.step_of`) knows planning, settling, and an approved request still to send. Each record opens by its address, with a review panel for a request and its actions.
- Requests are always drafted, even with no one to address them to (no owner email, no coordinator); they wait for the coordinator and cannot be submitted before then. Engagements launched while such requests were skipped are repaired on request from the dashboard.
- Decided by the product owner: the agent drafts and the reviewer approves (no separate submit step, no second person); sending stays a separate click. Someone without the right to approve submits instead.
- Not built: a background planner for unplanned controls (planning is on request), editing a request's attachments, and changing the report's "Submit N drafted" line to leave out held drafts.

**Engagement setup and configuration.** Requested by the product owner (the "2027 SOX Audit" showed a period end of 31 December 2026 beside a scope that said 31 December 2027). Complete, pending review; migration 0074.

- Root cause: the period end was set when the engagement was created, the planner kept it (as its rules require) but wrote a narrative for another year, and launch never compared them. At least nine development engagements disagree the same way. No date is changed.
- The profile records the methodology, period start, fiscal year, and reporting objectives. The period check (`profile_checks.py`) flags a name, scope, or fiscal year label that names another period; launch waits until a person corrects it or confirms the period as recorded, and any later change asks again. A running engagement shows the disagreement on its dashboard and can be confirmed there. Decided by the product owner: block until confirmed; for launched engagements alert and confirm now, correct the period later; record the methodology and require independence under every one; impact preview and confirm for scope changes, a second approver later.
- Readiness separates what holds launch from what is worth knowing. Development mode (independence off) is said in readiness and refused with `APP_ENV=production`.
- After launch, removing a control or system shows what it affects and needs a reason where work is on record; removing a team member shows their open work, releases it, and never removes the only reviewer.
- Not built: correcting a running engagement's period, a second approver for scope changes, template management beyond what exists, and a reason on the system wizard's exclusions.

**Controls overview.** Requested by the product owner (the page read like a spreadsheet, repeated the drafted batch on every row, and used letter avatars for applications). Complete, pending review; no migration.

- The page answers four things first: progress in four states that add up to the controls in scope (completed, in progress, blocked, not started, with the nine stages on request), what needs a person (one action center, the drafted batch once with **Submit all**), what the agents are doing (from their run records), and where to find a control (search, application, status presets, needs my attention).
- Two views of the same rows and filters: application groups (everyday) and a table (columns, sorting, selection, batch actions, a hundred rows at a time). The view is in the address and kept in the browser.
- Applications show a neutral system icon from their recorded layer and hosting, never letters. Decided by the product owner: neutral icons now; approved logos would need a stored asset per application, not built.
- API: each control row carries its application's layer and hosting, its agents' runs (`agents`), and each request's version; `POST …/pbc-request-batches/submit` and `POST …/onboarding/controls/owner-batch`.
- Fixed: the control record's reviewer agent never showed as stopped (it looked for the wrong failure text); the failure notes are now named constants the register reads.

**Evidence workspace.** Requested by the product owner (the Evidence tab was procedural and listed every requirement twice). Complete, pending review; migration 0073.

- The Evidence tab is one workspace: four figures, the agents on the evidence (planner, request drafter, reader) with the decisions they wait for and the reader's proposals, and Requirements, Requests, Files, and Plan details, one view at a time. The plan table, the three phase panels, and the per-phase request tables are gone; each requirement shows once.
- The reader records what a file covers against each plan requirement (`requirement_id` on each coverage item, from the request), and each requirement carries its files and the reader's proposal (`files`, `assessment` on the plan's requirements). A proposal never changes a requirement: a person decides. Without a model, only a full field match proposes.
- A person can link a file the control holds to another requirement, in any phase, with why (`evidence_requirement_files`; `POST …/evidence-requirements/{id}/files`, `…/files/{link}/remove`). A linked, planned requirement counts as received and is not requested again while the file stands.
- Decided by the product owner: a request is never cut. It holds every planned item whole; an email too short for it carries every item in brief and the secure link to the full request. Decided: build the file-to-requirement link now.
- Fixed: a phase whose requests were only drafted read "Evidence outstanding" while its items said "Drafted, ready for review"; it now reads "Requests drafted, not sent", the same as the overview and the register. The drafter clipped each planned item to 880 characters and dropped items past the eighth, and the reader judged only the first eight.

**Control workspace: agents in parallel, progressive workpapers.** Requested by the product owner (a second review of the control workspace for agentic execution). Complete, pending review; no migration.

- The tester's first results start the effectiveness workpaper while testing is still open (`workpaper_service.draft_effectiveness_after_run`, from both the local worker and the durable workflow). The draft treats the open sheet's results as proposed, its conclusion stays derived from the signed-off testing, preparing it still needs the sign-off, and the sign-off asks for a redraft from the confirmed results.
- The test sheet, workpaper, and review say whether their agent's work is queued or running (`run_state`, `draft_state`, `reperform_state`; `agent_runs.py`). The old booleans remain.
- The Overview shows each agent on the control with running, what it waits for, what it produced, and the person's decision kept apart, a workpaper's make-up by provenance, and the testing approach from the records. The single-agent box, the agents' "done" list, and the three figures are gone.
- Found and shown, not changed: a control classified as an automated application control whose RCM nature is manual is planned as a sample, because the sample size follows the RCM nature.

**Control workspace.** Requested by the product owner (the control page was a checklist with the agents nearly invisible). Complete, pending review; no migration.

- The control record is a workspace: a compact header with the stage and the viewer's one next step, a lifecycle of six phases each in one real state, an agent workspace (what runs now, what the agents did, what needs a person), three figures, and tabs by function (Overview, Control & design, Evidence, Testing, Findings, Review & conclusion, Activity). The pop-up assistant is replaced by the agent workspace; its offers to do the work remain.
- New: `GET …/controls/{id}/activity`, the control's audit trail, with agent work told apart.
- Fixed: a control was concluded when its review task was marked done, even by hand through the Tasks page; it now needs a signed-off independent review. The old "steps done" count and the Overview's task table, which showed agent tasks as Ready after the agent had tested, are gone.

**Controls page: status model and progress.** Requested by the product owner ("Needs your action" showed nearly every control). Complete, pending review; no migration.

- The API gives each control one stage (nine, adding up to the controls in scope), who its next step belongs to, whether that is the viewer's (role, the reviewer and independence rules, the requester-never-approves rule, assignment), whether it has exceptions, and its evidence by testing phase (`workspace.step_of`, `progress_of`, `mark_yours`, `evidence_phases`).
- Decided by the product owner: drafted requests are one batch, not each control's action.
- Fixed: a request out with the client and past its due date is now overdue (it never was before: nothing set the OVERDUE status). Testing that stopped with items untested now says so, instead of showing the agent as still testing.
- The page shows a progress summary by stage, stage and evidence-by-phase per control, AI marks on unconfirmed agent work, the viewer's own steps as links, sorting, and sticky headings. The control record uses the same stage and says "You" only for the viewer's own step.

**Controls page redesign.** Requested by the product owner (the page was dense and hard to scan). Complete, pending review; presentation only, no API, permission, workflow state, or data change.

- One header with Edit RCM as the primary action; the views as a light tab strip; one toolbar (search, application, a Filters popover, grouping) with filters in force as removable chips.
- Application groups that open and close, with a one-line headline and no progress bars; the whole register starts as its headlines once it is long.
- Rows with the ID and title first, quieter metadata, readiness and findings in words, the API's next step (a link to the record's tab when it is the team's), and evidence received as a count.
- Search now also matches the application and the owner's email.
- Found, not changed: a request that is sent and past due counts as overdue in the metrics rulebook and reports, but the register (and the Overdue view) counts it only once its status is set to OVERDUE.

**Engagements page: smarter tiles.** Requested by the product owner (the side panel repeated the tile and took a quarter of the page). Complete, pending review; no migration.

- The side panel is gone; tiles and the list use the full width and open their engagement in one click.
- Each tile shows the agents' progress, overdue evidence (metrics rulebook), missed or next milestone, and when anything last happened, read with the projects list (`GET /organizations/{org}/projects` gains `progress`, `overdue_requests`, `next_milestone`, `missed_milestones`, `last_activity_at`).
- A ⋯ menu on each tile and row holds the other ways in, and **Status and close-out**, which opens over the page only when chosen (`manage=engagement`).

**Phase 8, Milestone 8.21: PDF and Word reports.** Requested by the product owner ("I can't produce a PDF"). Complete, pending review; migration 0072; new dependencies reportlab 4.5.1 and python-docx 1.2.0.

- Five reports from the engagement's records, as PDF or Word, through one pipeline (`reports.py`): engagement status report, pending evidence tracker, control testing summary, exceptions and remediation report, executive summary.
- Each report states its engagement, scope, data-as-of time, and rules; every table is checked against the records counted before the file is saved; data checks and an "About this report" section close it.
- An optional AI narrative is printed only in its own labelled section and kept with the file's record (`engagement_exports.narrative`).
- The agent makes a report when asked for a PDF, a report, or a summary to share (`generate_report`), and the answer offers it as a file, kept 30 days and audited, like exports.

**Phase 8, Milestone 8.20: answers and files from the engagement's records.** Inserted by the product owner. Complete, pending review; migration 0071.

Root cause found: the agent's read tools could not answer engagement-wide questions. The evidence request list stopped at 200 rows and reported that as the total; the control list showed only the first 100; workpapers, review notes, test results, and evidence state could be read only one control at a time, while a turn has eight tool rounds; there were no filters by testing phase, application, owner, or process, no overdue days, no as-of time, no way to tell "zero" from "not recorded", no other engagements, and no files. The model was left to count.

- A read-only data layer (`engagement_data.py`) works every figure out from one read of the records, by a written rulebook ([metrics.md](metrics.md), v1 pending approval), with as-of times, record references, "not recorded" for missing values, and data checks for records that contradict each other.
- The console's read tools now answer for the whole engagement, with filters, totals over every match, and pages; and for another engagement the person can open in the same firm.
- Excel and CSV exports (`exports.py`): checked, stored, recorded, offered in the answer as a file, kept 30 days, audited. The development object store now also keeps exports.
- The agent's instructions: read the records every time, use the application's figures, say as of, name the records, keep facts, figures, and its own reading apart, make no audit judgments, keep filters across follow-ups.

Decisions for 8.20, confirmed by the product owner: two milestones (this one; PDF and Word reports in 8.21), reportlab and python-docx for 8.21, files kept 30 days, and the metrics rulebook drafted for approval at review.

**Phase 8, Milestone 8.19: the agent console, redesigned.** Inserted by the product owner. Complete, pending review; no migration.

- Answers stream: the model's text is saved on the answer as it is written and shown live, citations held back until they are checked, then replaced by the finished answer.
- The console is the page, not a card in it: one reading column, the composer pinned to the bottom of the window, answers read as documents (no avatar, name, or time on each), the person's messages on the right.
- A new chat opens on a greeting with the composer in the middle and suggestions under it. The composer grows with the message, with a round send button; its keyboard hints are gone. The agent's work shows as one line ("Opening ITGC-AC-01") instead of dots and placeholder bars.
- Answers render headings, numbered and nested lists, code, quotes, rules, italics, and links (to the web or the app only).
- The side panel groups chats by day; on a narrow screen it slides over the chat.
- Steps that would fail are not proposed: submitting a request is checked for a recipient and for wording that fits in one email, also as earlier steps of the plan will leave it, and the agent hears why. A draft's recipient can now be set with Edit a draft request. A failed step says why instead of "That could not be done". Found by the product owner: two approved submissions failed on drafts with no recipient and wording too long to send.
- Fixed: a long conversation could send the model a history that opened on an earlier answer's tool results, which the model refused (400), so the question failed.

See [console.md](console.md#what-a-person-sees).

Decision for 8.19, confirmed by the product owner: real streaming, not a reveal of the finished answer.

**Phase 8, Milestone 8.18: clients and roll-forward.** Inserted by the product owner. Complete, pending review; migration 0070.

- The firm has a client list, and each engagement belongs to one client.
- A new engagement for an existing client is picked from that list, not retyped. It opens from the client or from the client's last engagement, with the client chosen. It takes the client's email domains, evidence coordinator, and request cadence.
- It can start from one of the client's earlier engagements. That copies the systems, the controls with their owners and attributes, the team, and the workpaper templates. Testing, evidence, and results are never copied.
- A typed name that matches an existing client is caught. Owners and admins rename a client once, and every engagement follows.
- Guided setup shows the client instead of asking for it.
- The Engagements page, redesigned after review:
  - two views, Engagements and Clients, in place of a Clients card that repeated the engagements;
  - the status boxes removed, since the filter carries the counts;
  - tiles and list rows lead with the client, and the initials badges are gone;
  - the opened engagement shows its facts, the scope cut to three lines, the agents' work as a progress bar, and recent activity with repeats folded and the system's bookkeeping left out.

See [workspace.md](workspace.md#clients-and-roll-forward).

Decisions for 8.18, confirmed by the product owner:

- Clients are records: the firm's client list, with each engagement belonging to one client. Existing engagements are linked by name, ignoring case and spacing. A rename updates every engagement. The client's details fill new engagements.
- A roll-forward carries the earlier engagement's scope and its templates' confirmation, and the form proposes the next period end; added after the product owner found a rolled-forward draft asking for the scope and the templates again.
- A roll-forward is offered, never forced. Client details carry over automatically. Starting from an earlier engagement is optional and copies setup only, never testing, evidence, or results.

**Phase 8, Milestone 8.17 — Controls in scope, opened over the page.** Inserted by the product owner. Complete, pending review; no migration. A system's or a process's controls in scope are a table: the ID, the control and its owner and whether it is key, its type, and how often and how it operates in plain words, with **Remove from scope**, which asks first and says what happens to the control's work. Opening a control opens it in a dialog over the page, as a template preview does; the page underneath keeps its tab, its open system, and its place, and closing or saving returns to it. Previously a control opened above the page and switched the page to the control's own tab, so a key report opened from a system's list left the page on the Key reports tab. The confirmation dialogs set their own text, so they read the same wherever they sit.

**Phase 8, Milestone 8.16 — Workpaper templates after launch.** Inserted by the product owner. Complete, pending review; migration 0069. Workpaper templates can be customised, uploaded, applied, and removed after launch. A change reaches workpapers that have not started; a started workpaper keeps the template it began with. Confirming templates is a step before launch only, so a control added after launch no longer leaves the step showing work to do; engagements where it had been cleared are repaired. Also: a template action that succeeded no longer shows "That could not be saved", and an action's error wraps under its buttons. See [onboarding.md](onboarding.md#workpaper-templates-after-launch).

Decision for 8.16, confirmed by the product owner: after launch, template changes apply to work not started; started workpapers keep their template.

**Phase 8, Milestone 8.15 — Engagements as tiles or a list, edited with their form.** Inserted by the product owner. Complete, pending review; no migration. The Engagements page shows tiles or a list, remembered per person. Editing an engagement opens the form it was created with, filled in, and saves its details and profile in one transaction; after launch the client and the period end stay locked. The inline settings form is gone; the card keeps the status and its actions. See [workspace.md](workspace.md#the-engagements-page).

Decision for 8.15, confirmed by the product owner: Edit opens the New engagement form, prefilled, rather than guided setup.

**Phase 8, Milestone 8.14 — Completing and deleting engagements.** Inserted by the product owner. Complete, pending review; migration 0068. An engagement whose work is done is completed; until then the Engagements card lists what is still open. A completed engagement is read-only, enforced in one place in the API, and an owner or admin reopens it with a reason that is kept. A draft that never launched can be deleted by an owner or admin, who types its name; its setup is removed and only the audit record is kept. See [workspace.md](workspace.md#completing-and-deleting-an-engagement).

Decisions for 8.14, confirmed by the product owner:

- Complete only when the work is done: every in-scope control tested and reviewed and signed off, no deficiency or evidence request open, and no agent work running.
- A completed engagement is read-only; an owner or admin can reopen it with a reason. The agents' open tasks are cancelled at completion.
- Deleting a never-launched draft removes it and its setup and keeps only the audit entries, on a hidden placeholder.
- Only owners and admins delete a draft.

**Phase 8, Milestone 8.13 — Engagement, system, and control integrity.** Inserted by the product owner. Complete, pending review; migration 0067. One engagement lifecycle: Draft (setup), launched once into Active, Paused and resumed, and Archived for good. The project settings no longer activate a draft or offer a status list; a draft becomes active only by launching it, and the API and the database refuse any other way. An archived engagement is read-only. The setup page, its footer, the dashboard callout, and the settings read one lifecycle module (`engagement-lifecycle.ts`), so a launched engagement never shows a Launch button. A second launch is refused and said plainly. Systems and control IDs are unique however they are written, enforced in the API and the database; the system wizard refuses a system already in scope and its Cancel never removes an existing one. Changing the frequency, nature, or area of a tested control needs acknowledging and opens a question on it. Archiving and removing a system ask first and say what happens. See [onboarding.md](onboarding.md#changing-scope-after-launch) and [authorization.md](authorization.md).

**Phase 8, Milestone 8.12 — Secure evidence upload links.** Inserted by the product owner. Complete, pending review; migration 0066. Evidence comes from the client only through a secure link in the request email: the owner confirms a one-time code sent to their address and uploads to their open requests, and each file is filed to its request's control and read by the evidence coordinator. Email attachments are no longer taken as evidence. The team sees who holds links and can turn them off. "Waiting on you" is one list: the dashboard shows the agent console's inbox, which now also lists test results to decide or sign off, replies to read, reminders due, late evidence, and blocked or finished agent work, each linking to the control record where it is about one control. Also: plain wording for open test results, the evidence plan's reasoning folded per item, the register's next steps marked as yours without a badge on every row, even breadcrumb spacing, the landing page's library figures read from the API, and the mobile navigation scrolled to the current page. See [evidence.md](evidence.md#secure-upload-links).

Decisions for 8.12, confirmed by the product owner:

- One link per owner on the engagement, opening every open request sent to that address.
- The link plus a one-time code emailed to the owner's address before anything opens.
- A request takes uploads until 30 days after its due date, and none once closed or cancelled; the team can revoke a link at any time.
- The link is the only way evidence comes in from the client: attachments on replies are kept with the reply but not taken as evidence.

**Phase 8, Milestone 8.11 — Workspace UI/UX refresh.** Inserted by the product owner. Complete, pending review. Presentation only: no API contract, permission, workflow state, or data change. One design system for the workspace (`docs/design-system.md`): a single set of tokens at the top of `apps/web/app/globals.css` that the scoped modules (controls `.cx`, console `.cv`, engagements `.eg`) alias, so the three accent blues and the hard-coded colors became one palette; text colors meet WCAG 2.2 AA; one definition each for buttons, badges, inputs, cards, and the page header. Every page uses the shared page header. Fixed: tab strips that showed a stray scrollbar, the controls register and timeline overflowing a phone screen (the register becomes cards there), clipped evidence values, the engagement detail panel, and misaligned console suggestions. The deficiency form, a settled PBC contact, and milestone date changes open on request; the project plan opens on the phases under way. Card links read as links; agent and rule proposals in the system wizard say who proposed them; motion stops for people who ask for less. A second review pass: finished workpaper steps fold so the test sheet comes up the page, the test sheet legend explains both result markers, Waiting on you sits under the dashboard KPIs as one line when empty, the console and control assistant lost their decorative gradients, the duplicate eyebrow under the breadcrumb is gone on desktop, and the record keeps clear of the agent launcher.

**Phase 8, Milestone 8.10 — System applicability wizard.** Inserted by the product owner. Complete, pending review; migration 0065. The agent's recommendations and SOC 1 reading are a draft for a SOX methodology reviewer. Adding a system opens a guided wizard: the system's details, then its controls from the library (selected by hand, or recommended by the agent with the magic wand), then a review of the recommendations, the SOC 1 assessment, and any CUECs, before the selection is saved. The team is no longer asked upfront how a system is hosted or whether a SOC 1 report applies: the agent assesses it and says so, with an explicit Undetermined when the evidence is not there.

Decisions for 8.10, confirmed by the product owner:

- The agent may search the web to establish whether a system's vendor issues a SOC 1 report, citing each source it relied on; searches use the system or vendor name only, never the client's. A source the search did not return is never cited.
- A vendor's SOC 1 report can be uploaded on its system (up to 25 MB). The agent reads it and records the report's facts and its CUECs, each with the report page the wording was found on, and maps each CUEC to the library's controls. CUECs come only from an uploaded report.
- The generic CUECs and SOC guesses stored by earlier reviews are deleted (migration); controls already in scope stay as they are, and facts a person confirmed are kept.
- Recommendations are proposals: nothing joins or leaves a system's scope until a person saves the wizard's selection, which is recorded with the agent's recommendation beside it.

**Phase 8, Milestone 8.9 — Control statements (library version 3).** Inserted by the product owner. Complete, pending review; a draft for a SOX methodology reviewer, not validated by one. 53 library controls (four combined controls split into nine) each have a statement in `statements_*.py`, checked by `statement_registry.py`; client values are stored per control (migration 0064), filled from the setup control editor or the control record, and testing waits for the ones that define a population or a precision. Statements: [testing-definitions.md](testing-definitions.md). The standard controls are rewritten to the design documentation a methodology reviewer expects: for each control, its objective and the risk it addresses (relevant assertions for process controls, the IT risk for IT general controls, the COSO principle for entity-level controls), nature and type (preventive or detective), frequency, the operator and reviewer with the authority they need, the judgment involved, its precision and criteria for investigation, how outliers are investigated and resolved, the information it uses with its data elements, the IT general controls an automated or IT-dependent control relies on, and the evidence it leaves. Source for the list: KPMG ICFR Handbook (2025) Q5.4.30, Q7.3.30, and Q2.3.60.

Decisions for 8.9, confirmed by the product owner:

- A library control that combines several controls is split: the original ID keeps its main activity and each other part becomes a new control (for example ITGC-OP-03.1). Existing engagements see the split as part of the opt-in update.
- Client-specific values (thresholds, roles, deadlines, report names) are named slots in the control statement, filled at setup; testing waits on an unfilled slot that matters.
- Every control carries assertions and risk, type and owner, the reports and IT general controls it relies on, and its precision, evidence, and exception follow-up as structured fields (a migration).
- The rewrite is folded into library version 3, which is not yet released: one comparison and one adoption for existing engagements.

**Phase 8, Milestone 8.8 — Testing definitions (library version 3).** Inserted by the product owner. Complete, pending review; a draft for a SOX methodology reviewer, not validated by one. Attributes link to their definitions (migration 0063); the tester and reviewer receive them and may return human review required; blocking proposals and design confirmations hold readiness; a control copied from version 2 adopts version 3 from its Design tab. Definitions: [testing-definitions.md](testing-definitions.md). Every standard control gets a structured testing definition: objective, characteristics, design, operating, and roll-forward procedures, and attributes with their condition, rationale, evidence, decision rules, source basis, and confidence; an uncertainty register lists what a SOX methodology reviewer must decide. See [testing-framework-review.md](testing-framework-review.md).

Decisions for 8.8, confirmed by the product owner:

- The framework supports management's SOX testing (the client's SOX PMO, internal audit, or a firm doing that testing). SEC Release 33-8810 is management's basis; PCAOB AS 2201 is cited as the standard the external auditor will apply, not as management's requirement.
- The agent's "unable to tell" splits into **insufficient evidence** (request more) and **human review required** (a person decides). After follow-up, a person can record an item that stays untestable as a deviation (AS 2315.40).
- Revised definitions are library version 3 for new engagements; an existing engagement adopts them per control after seeing the comparison, and signed-off or open test sheets keep their attributes.
- Low-confidence and not-established attributes enter a control as proposed attributes with their question, and nothing tests them until a person approves.

**Phase 8, Milestone 8.7 — Evidence planning by phase.** Inserted by the product owner. Complete, pending review. Every in-scope control is planned across design, interim, and roll-forward testing before evidence is requested: each phase's applicability with its reason, objectives, procedures, period, and evidence requirements (category, objective, attributes, reason, period, dependency), made by control-aware rules or by Claude under schema and rule checks (migration 0062). Kickoff makes a design request and an interim request per control instead of one combined request; the roll-forward's items go out on its round's request; sample evidence on the sample request. Receipt and sufficiency are separate, samples are approved only from a population a person accepted, planning again never duplicates or silently changes sent or approved work, and a phase is complete only when its testing is. See [testing.md](testing.md#evidence-planning-by-phase-87).

Decisions for 8.7 taken in the build, for the product owner to confirm:

- Kickoff sends two requests per control (design and interim), replacing 7.1d's one request per control.
- Approving samples requires the population, and its required completeness support, to be accepted on the evidence plan (or marked not applicable with a reason).
- The roll-forward stays conditional until interim testing is signed off effective, as in 8.4; its requirements are planned from the start and go out on the round's request.
- A cancelled request's requirements are requested again; a person stops asking by marking the requirement not applicable with a reason.
- Controls launched before 0062 have no plan until a person plans them; an unsent combined kickoff request is then replaced by phase requests.

**System scoping, part 1.** Inserted by the product owner. Complete, pending review. Each in-scope system records its hosting and whether a SOC 1 report is expected; the scoping agent reviews each system (coverage, CUECs, and per-system recommendations: take out what the SOC report covers, map each CUEC) and recommends the controls its CUECs call for, each with a rationale and its CUEC references; a person accepts each recommendation (migrations 0047 to 0054). Business process controls belong to a process, not a system, and each Controls tab scopes its own kind: systems, processes, or key reports. A client RCM on several sheets is imported sheet by sheet (add mode), and an uploaded RCM is scoped with the client's own controls rather than the library. Workpaper templates are their own setup step: one workbook template per kind of control (IT general controls, application controls, business process controls, key reports), each with design, interim testing, and roll-forward tabs, and a control keeps one template (migration 0056). A firm customises a standard workbook in the editor and saves it as its own, or uploads its own Word or Excel workpaper (migration 0055); previews open as a tabbed workbook, and the testers' workpaper, the exports, and the agent's drafting follow the template's tabs and sections. A system with no SOC 1 report gets the controls for its kind recommended instead, and every system offers the rest of the library to add. Reviewing the vendor's SOC 1 report is left to the entity-level controls, not recommended per system. Part 2, next: upload the vendor's SOC 1 report and have the agent read it, replacing the guess with the report's CUECs, carve-outs, period, and opinion, each cited. See [onboarding.md](onboarding.md#scoping-each-system).

**Review independence switch.** Inserted by the product owner for development. `REVIEW_INDEPENDENCE_REQUIRED` (default true) can be set false so the tester can also review and sign off, and one person can hold several engagement roles (migration 0046); the pages warn while it is off. Set it back to true before real engagements. See [review.md](review.md#development-switch-review_independence_required).

**Invite by email.** Inserted by the product owner. Complete, pending review. The Team step invites people by email with a role; invites go only to the firm's own email domains and are refused for malformed, temporary-mail, or no-mail domains, and past 20 an hour per inviter. People show as pending validation until they sign in with that address. The welcome email is written and held, since live email stays off (migration 0045). See [onboarding.md](onboarding.md#inviting-by-email).

**Google sign-up.** Inserted by the product owner after 9.2. Complete, pending review. A Google account signs in or signs up (`/auth/google/*`, migration 0044); either provider's first sign-in creates the person's own workspace; the same verified email is one user across providers; the web app gains `/sign-in` and the landing page offers Google. See [decisions/0009-google-sign-in.md](decisions/0009-google-sign-in.md) and [development.md](development.md).

**Phase 9, Milestone 9.2 — Review queue and console.** Complete, pending review. Milestones 8.5 and 9.1 were accepted by the product owner. See [review.md](review.md#across-the-engagement-92).

**Phase 9, Milestone 9.1 — Independent review.** Complete, pending review. See [review.md](review.md).

Decisions for Phase 9, confirmed by the product owner:

- One review per control instance, covering its signed-off test sheet, both prepared workpapers, and its deficiencies together.
- The independent reviewer agent re-performs the testing (each result against the evidence, the sample, the workpapers, the deficiency decision) and proposes review notes; a team member with the reviewer role, who did not sign off the sheet or prepare the workpaper, decides each note and signs the review off.
- A note that must be fixed reopens the sheet or workpaper with the note as the reason; the preparer answers and prepares again; the reviewer clears the note. Sign-off is blocked while notes are open, with the full note history kept.
- "Remediation" in Phase 9 means fixing what the review found. Deficiency remediation and retests stay as built in 8.4.

Milestones: 9.1 the review record, the agent's re-performance, review notes, and the reviewer's sign-off; 9.2 the reviewer's queue, engagement-level completion, and the console's review tools.

**Phase 8, Milestone 8.5 — Controls per application.** Complete, pending review. Inserted by the product owner. See [workspace.md](workspace.md), [onboarding.md](onboarding.md#rcm), [testing.md](testing.md#placing-evidence), and [evidence.md](evidence.md#evidence-by-application).

Decisions for 8.5, confirmed by the product owner:

- A control that covers several applications is one engagement control per application, with the same control ID: "ITGC-AC-01 · Active Directory" and "ITGC-AC-01 · Oracle" (migration 0041, `control_instances.py`).
- Everything is per instance: the owner, the evidence request, the test plan and sheet, the conclusion, the workpapers, the deficiencies, and the roll-forward and retest rounds. The workpaper reference carries the application ("ITGC-AC-01-AD-TOE").
- Existing engagements were split by the migration: the first application kept the original row with its requests and testing; each other application got a copy, with the files tagged as showing it and the test items for it.
- The Controls register lists instances by application with the process areas inside; grouping by area remains a toggle.

**Phase 8, Milestone 8.4b — Evidence preview and highlighted citations.** Complete, pending review. Inserted by the product owner. See [testing.md](testing.md#what-the-tester-relied-on-84b) and [evidence.md](evidence.md#previewing-evidence).

Decisions for 8.4b, confirmed by the product owner:

- Screenshots: Claude marks the region of each cited passage, checked to lie inside the image; a box that does not fit is dropped and the quote still shows.
- Documents: PDFs are rendered with the highlight on the page (pdf.js); spreadsheets and CSVs show as tables with the cited rows highlighted.
- Existing results gain citations when a person clicks Test again on an open sheet; nothing is re-tested without a click.
- The preview opens as a pop-up over the page, with the document beside the list of cited passages.

**Phase 8, Milestone 8.4 — Roll-forward and remediation.** Complete, pending review. Milestones 8.2, 8.3, 8.3b, and 8.3c were accepted by the product owner. See [testing.md](testing.md#roll-forward-and-remediation-84).

Decisions for 8.4, confirmed by the product owner:

- Roll-forward: when interim testing is signed off effective, the owner confirms nothing changed and provides the population for the rest of the period, and the tester tests an update sample sized for that remaining period.
- Retest: a new sample drawn only from after the remediation date, once the control has operated long enough, sized by the standard remediation table. A pass marks the deficiency remediated; a fail sends it back to remediation.
- Started automatically: signing off interim testing adds the roll-forward, and marking a deficiency ready for retest adds the retest. Their requests are drafted and wait for an approver.
- A logged deficiency drafts a remediation request to its owner for the plan and, later, evidence of the fix.

**Phase 8, Milestone 8.3c — Engagement onboarding revamp.** Complete, pending review. Inserted by the product owner. See [onboarding.md](onboarding.md).

Decisions for 8.3c, confirmed by the product owner:

- A full redesign of setup: a guided New engagement form (client, kind, period, lead), a setup overview as the first screen, every step rebuilt, the RCM and the workpaper templates in one step, and a launch review with an engagement memo. The setup records and APIs stay as they are.
- The agents draft and a person confirms: the engagement planner drafts the scope narrative, the period end, and the evidence-request cadence with reasons; the client's email pattern suggests owner emails. Nothing is applied until a person accepts it.
- An engagement does not start from a previous one yet; roll-forward stays in 8.4.

**Phase 8, Milestone 8.3b — Withdrawing and replacing evidence.** Complete, pending review. Inserted by the product owner. See [evidence.md](evidence.md#withdrawing-and-replacing-evidence).

Decisions for 8.3b, confirmed by the product owner:

- Delete means withdraw: the file leaves the register, matching, testing, and workpapers, with a required reason. Its custody record and bytes stay, with who withdrew it and why, and it can be restored.
- Replace stores a new version that takes the old file's place (control, request, application, and sample items). The old file is withdrawn and linked as the earlier version, and testing runs again.
- Signed-off testing, a prepared workpaper, a signed-off screenshot review, or an approved sample keeps its file until a person reopens that work.
- Anyone who can upload evidence on the project can withdraw, replace, or restore, with a reason, and every change is in the audit trail.

**Phase 8, Milestone 8.3 — Workpapers.** Complete, pending review. See [testing.md](testing.md#workpapers-83).

Decisions for 8.3, confirmed by the product owner:

- Each control gets an operating effectiveness workpaper, opened when its testing is signed off, and a design and walkthrough workpaper drafted on request.
- The records fill the factual sections in code. The agent drafts the narratives and the walkthrough with checked citations, and a person edits any section. Sections a person wrote are never overwritten. The effectiveness conclusion is derived from the signed-off testing.
- Every change is a new version. A person prepares each workpaper, which freezes it until it is reopened with a reason.
- Export: each workpaper as `.xlsx`, and an engagement binder with an index.

**Phase 8, Milestone 8.2 — Testing engine.** Complete, pending review. See [testing.md](testing.md#the-testing-engine-82). Milestones 8.1, 8.1b, and 8.1c were accepted by the product owner.

Decisions for 8.2, confirmed by the product owner:

- The tester links each evidence file to the sample items it names (key in the file name, folder, or text). Files it cannot place wait for a person, who can relink any file. Samples without evidence show as missing.
- For every sample, the tester proposes pass, exception, unable to tell, or not applicable for each test attribute, citing what it saw. A person reviews the whole sheet, can override any result with a reason, and signs off once per control.
- Sampled controls are tested sample by sample; automated controls are tested once from their evidence, reusing the screenshot review where it covers every attribute.
- Zero tolerance: any confirmed exception concludes the control as not effective and drafts a deficiency (condition, criteria, cause, effect, suggested severity) for a person to log or dismiss.

**Phase 8, Milestone 8.1c — Evidence intake.** Complete, pending review. Inserted by the product owner. See [evidence.md](evidence.md#evidence-intake).

Decisions for 8.1c, confirmed by the product owner:

- Evidence is shown as a professional table: every file with its folder, control, request status, kind, and agent review, with queues (needs a match, filed by agent, being read, from email), search, grouping by control, and a side panel per file.
- The team picks a local folder (or drops it, or chooses files). Cloud folders (SharePoint, OneDrive, Google Drive) are a later connector.
- The agent files confident matches at once, marked as the agent's, and a person can change them. Unclear files wait for a person with suggestions.
- A filed file marks its request received, or partly received while items are missing. A request that was never sent is marked as provided directly, and its pending send approval is withdrawn.

**Phase 8, Milestone 8.1b — Agent console.** Complete, pending review. Inserted by the product owner: the platform is driven by agents. See [console.md](console.md).

Decisions for 8.1b, confirmed by the product owner:

- The engagement opens on an agent console. A person tells the agents what they want in plain language, the agents answer from the engagement's records or reply with a plan of concrete actions, and the person confirms. Beside it: what is waiting on the person, and what the agents did. The registers and records stay as reference views.
- Autonomy: reading, answering, redrafting, rereading a file, and proposing samples run at once. Anything that goes to a client, approves, signs off, logs a deficiency, or changes the plan is a step the person confirms. Approvals that need a second person still need that person. The agent never claims a step is done before it is.
- The first tools cover evidence requests, evidence review and sampling, status and questions, and deficiencies and the plan. The agent answers any question about a specific control and the evidence for it, from the stored records and extracted text.
- Every tool is registered with a schema and a risk class. A step runs as the person who confirmed it, through the same authorization and service code as the pages.

**Phase 8, Milestone 8.1 — Test plans and sample selection.** Complete, pending review. See [testing.md](testing.md).

Milestones 7.3 and 7.4 were accepted by the product owner. Phase 7 is complete.

Decisions for Phase 8, confirmed by the product owner:

- Phase 8 runs in four milestones, each reviewed before the next: 8.1 test plans and sample selection, 8.2 the testing engine, 8.3 filled workpapers, 8.4 roll-forward and remediation tasks.
- Samples: the system selects random samples with a recorded seed, sized by the control's frequency and nature. The tester explains the selection, and a person approves it before the sample request goes out. A person can replace a selected item (haphazard or targeted) with a reason.
- Workpapers: a structured, versioned record in the platform, exported to `.xlsx`.
- Exceptions: the testing engine proposes a deficiency (condition, criteria, cause, effect, suggested severity) for a person to log or dismiss. The reviewer approval from 7.2 still applies.

**Phase 7, Milestone 7.4 — Agent first-pass review of screenshots.** Accepted. See [evidence.md](evidence.md#first-pass-review-of-screenshots).

Decisions for 7.4, confirmed by the product owner:

- For each screenshot or scanned page, the evidence coordinator reviews the evidence and tests it against the control's test attributes, then proposes a conclusion. A person signs it off or overrides it. Nothing is concluded without them.
- The review reads the images with Claude vision. The product owner opted the preview firm into model OCR. A firm that stays local gets no visual review, and the file is marked for a person.
- The review checks legibility, the system and environment, the date and period, signs of editing, and whether the screenshot applies to the control being tested.
- When the agent finds a reading issue or an exception, the auditor sees plain feedback on the file, and the agent drafts a follow-up request to the control owner. The draft goes out only after the usual approval.

**Phase 7, Milestone 7.3 — Evidence reading and classification.** Complete, pending review. This is the Phase 7 remainder. See [evidence.md](evidence.md#reading-and-classification).

Milestones 7.1b to 7.2 were accepted by the product owner.

Decisions for 7.3, confirmed by the product owner:

- Text formats and OCR: `.xlsx`, `.csv`, `.txt`, `.docx`, and PDF text are read deterministically. Screenshots, scanned pages, and images in documents are read by OCR.
- OCR is pluggable. Local Tesseract is the default, and images stay in the firm. A firm's owner or admin can opt into model OCR, which sends page images to the model provider, with local OCR as the fallback.
- Classification uses Claude on a bounded, redacted excerpt, with reviewed keyword rules as the fallback, as in 7.1d.
- The agent suggests the evidence kind, the coverage of each requested item, and the gaps. A person confirms the kind. Nothing changes the request status: a person still marks it received, as in 6.5.

**Phase 7, Milestone 7.2 — Engagement workspace.** Accepted. See [workspace.md](workspace.md).

Decisions for 7.2, confirmed by the product owner:

- The engagement navigation is organized around the audit: Dashboard (replacing Command center), Controls, Project plan (replacing the flat Work board), Timeline, Evidence, Deficiencies, and Approvals. Setup moves under Engagement settings.
- Kickoff lays out the standard SOX calendar from the kickoff date and the period end: planning, walkthroughs, evidence, interim testing, remediation retesting, roll-forward and year-end, and reporting, with milestones. The lead can change dates; tasks follow their phase.
- Deficiencies follow the SOX workflow: condition, criteria, cause, effect, design or operating, likelihood and magnitude, severity, compensating controls, remediation, and retest. The engagement reviewer approves significant deficiencies, material weaknesses, and closures, never their own request.
- Deficiency logging and severity evaluation pull forward the Phase 9 slice the workspace needs. Testing agents logging exceptions stays in Phase 8.

**Phase 7, Milestone 7.1f — Client terms mapped by an agent.** Complete, pending review. Inserted by the product owner. Do not start the next milestone until 7.1b to 7.1f are reviewed.

- After upload, an agent maps the client terms that are still blank, from the controls that use each term, with a reason per term. Remap with agent redoes every term. Claude or the reviewed rules, as in 7.1d. A person reviews the mapping before import.
- Background agent jobs commit each step on its own, so a claim is visible at once and no row stays locked during a model call.

**Phase 7, Milestone 7.1e — In-scope systems from the RCM.** Complete, pending review. Inserted by the product owner. Do not start the next milestone until 7.1b to 7.1e are reviewed. See [onboarding.md](onboarding.md#client-rcm-upload).

Decisions for 7.1e:

- After an upload, an agent identifies the in-scope systems from the systems column and the control text, in the background, with Claude or a reviewed rules list (the same model and fallback as 7.1d).
- A system is kept only when the RCM names it. A person confirms the list (rename, layer, leave out) in the import preview. Importing creates the systems as in-scope applications and tags each control with its own systems.

**Phase 7, Milestone 7.1d — Drafted evidence requests.** Complete, pending review. Inserted by the product owner. Do not start the next milestone until 7.1b, 7.1c, and 7.1d are reviewed. See [pbc.md](pbc.md#drafting-from-the-control).

Decisions for 7.1d, confirmed by the product owner:

- After kickoff, the evidence coordinator drafts every PBC request from its control in the background.
- Claude is the first live model, through the existing adapter, with a rules drafter when no model is configured or a model draft fails its checks. Control and RCM text is sent to the model provider.
- The first request per control asks for the population (or configuration, or the key report) and walkthrough and design evidence. Sample evidence is requested after sample selection, in Phase 8.
- One request per control, as before. Every request still needs a person's approval before it is sent.

**Phase 7, Milestone 7.1c — Client RCM upload.** Complete, pending review. Inserted by the product owner as part of onboarding. Do not start the next milestone until 7.1b and 7.1c are reviewed. See [onboarding.md](onboarding.md#client-rcm-upload).

Decisions for 7.1c, confirmed by the product owner:

- The RCM is format-agnostic. A team uploads the client's own `.xlsx` or `.csv`. Columns are auto-suggested from reviewed synonyms and this engagement's own earlier mappings, never another engagement's, and a person confirms them. Every other column is kept under the client's heading.
- Each engagement chooses the standard library or an upload. Either replaces the other until kickoff.
- Area becomes the client's own term. For area, frequency, and nature, a person maps each distinct client term once to a standard value, which drives the tester, sample size, and template. The client's term is shown next to it.
- No model reads the file. Parsing is deterministic and values-only.
- The RCM is not limited to IT. There are 15 standard areas: the three ITGC areas, application controls (ITAC), key reports and IPE, entity-level controls, eight business cycles (order to cash, procure to pay, record to report, treasury, hire to retire, inventory, fixed assets, tax), and other business process.
- One new standard worker, the business process controls tester, tests every area outside the three ITGC areas. A person can choose another tester per control.
- The standard library adds 32 starter business process controls next to the 16 ITGC controls. The team chooses which areas to load. The new control wording waits for product owner review.

**Phase 7, Milestone 7.1b — Engagement onboarding.** Complete, pending review. Inserted by the product owner. See [onboarding.md](onboarding.md).

Milestone 7.1 was accepted by the product owner.

Decisions for 7.1b, confirmed by the product owner:

- Every new engagement opens a guided setup: scope and period, team and access, RCM, workpaper templates, PBC plan, then review and start.
- It pulls forward only the Phase 8 slice onboarding needs: the engagement RCM and the workpaper templates. Testing, filled workpapers, and conclusions stay in Phase 8.
- The RCM starts from a reviewed standard ITGC library in code, which each engagement tailors.
- Workpaper templates are reviewed standard templates in code, previewed with the engagement's own controls.
- Start engagement requires every step to be ready. The planner proposes the kickoff plan from the RCM, a person approves it, and approval activates the engagement and creates the tasks and draft PBC requests. (Later, by the product owner: the plan is shown on the launch page as it stands and one Launch button records and approves it; the person's approval stays the gate. Systems and controls can change after launch; a control that joins gets its tasks and draft request, one that leaves has its open work cancelled. See [onboarding.md](onboarding.md#changing-scope-after-launch).) Nothing is emailed without the usual approval.

Milestone 6.7 was accepted by the product owner. Extraction and classification stay later in this phase.

Decisions for 7.1, from [ADR 0005](decisions/0005-object-storage.md) and the attachment content deferred in Phase 6:

- File bytes go to the S3 API. Compose runs MinIO for local development. While the S3 settings are empty, the API uses the mock store, including in tests.
- The application generates the object key. A file name is a label, never a path.
- A person stores the bytes for one inbound attachment. The service hashes them. When the mail already declared a hash, the bytes must match it. Storing the same bytes again returns the same record.
- The custody record and the stored object are immutable. A download checks the hash before it returns the bytes.
- Nothing is extracted, classified, or passed to a model.

Milestone 6.5a was accepted by the product owner.

Decisions for 6.6, confirmed by the product owner:

- A durable timer marks each reminder due. A person requests approval, a different person approves the exact message, and only then can it be sent. Nothing goes out unattended.
- Cadence comes from the request's own follow-up fields: the next reminder falls due `follow_up_after_days` after the last contact (the request, the last reminder, or the last matched reply).
- After `max_follow_ups` reminders, the next missed interval marks the request escalated for a person instead of sending more.
- Reminders stop as soon as the request leaves sent, waiting, partially received, or overdue. An open reminder is cancelled, and an in-flight send is refused before it reaches the mailbox.

Milestone 6.5 was accepted by the product owner. Agent definitions were manual, and nothing staffed agents onto an engagement, so tasks could not be assigned to an agent. 6.5a closes that gap.

Decisions for 6.5a, confirmed by the product owner:

- A standard SOX workforce is defined in code and reviewed like email templates: planner, evidence coordinator, three ITGC testers (access, change, operations), independent reviewer, reporting analyst.
- The workforce is a standard part of every firm and engagement, with no manual setup in any environment. The deploy step syncs the roster; database triggers install it for new firms and staff new engagements. (This replaced an earlier install-and-staff button design before it was released.)
- Standard workers are locked and platform-managed. An owner or admin can only disable or re-enable one for the firm. Roster changes reach every firm on deploy, and a firm's disable choice is kept.
- Only owners and admins create or edit custom agents. Project managers can still assign agents to tasks. Standard keys are reserved.
- Each worker gets only the registered actions its job needs. Sensitive actions still need approval. No worker may modify permissions or send external mail.
- Model references are logical tiers, `reasoning` and `standard`, resolved to real models later through configuration.

Decisions for 6.5, confirmed by the product owner:

- A matched reply is recorded and flagged for review. It never changes the request status. A person marks a request partially received or received.
- A reply matches only by thread id or the `[PBC-…]` subject reference, and only when the sender is the request's recipient. Anything else goes to an unmatched queue for a person to assign.
- Store the plain-text body with markup removed, plus attachment metadata (name, size, type, hash). Attachment bytes are stored by Milestone 7.1.

## Phase 1 — Repository foundation

Objective: a reproducible development environment and recorded architecture decisions before business functionality.

| Milestone | Scope | Status |
| --- | --- | --- |
| 1.1 Inspect and initialize | `AGENTS.md`, `README.md`, setup guide, `.env.example`, `.gitignore` | Complete |
| 1.2 Select and pin dependencies | Node.js LTS, Python, lockfiles, task commands, decision records | Complete |
| 1.3 Local development environment | Docker Compose for PostgreSQL, health checks, start/stop/status/test/reset | Complete |
| 1.4 CI and baseline quality | Format, lint, typecheck, tests, CI workflow, smoke test | Complete |

## Phase 2 — Database, identity, and core data model

| Milestone | Scope | Status |
| --- | --- | --- |
| 2.1 Database conventions | UTC timestamps, UUID keys, migrations, transaction boundaries | Complete |
| 2.2 Initial tables | Organizations, users, projects, agents, tasks, audit events | Complete |
| 2.3 Authentication | Entra ID sessions | Complete |
| 2.4 Authorization | Roles and tenant isolation | Complete |
| 2.5 Database and access tests | Constraints, isolation, concurrency | Complete |

Phase 1 acceptance: a fresh clone follows the setup guide, required services report healthy, baseline checks pass, no credentials or sensitive evidence are committed, and architecture decisions plus unresolved trade-offs are documented.

Phase 2 acceptance: users can authenticate, protected routes reject anonymous requests, authorization is enforced in the API, tenant-isolation tests pass, migrations apply from an empty database, and business records live in PostgreSQL.

## Phase 3 — Workforce dashboard and task management

| Milestone | Scope | Status |
| --- | --- | --- |
| 3.1 Application shell | Navigation, project selector, account menu, notifications, loading and access states | Complete |
| 3.2 Project management | Create, edit, pause, and archive projects | Complete |
| 3.3 Agent registry | Agent definitions without stored secrets | Complete |
| 3.4 Task management | Assignment, dependencies, and status transitions | Complete |
| 3.5 Interface | Project overview, task board, and agent directory | Complete |

## Phase 4 — Workflow engine and AI orchestration

Objective: reliable planning and delegation. Models propose; software executes.

| Milestone | Scope | Status |
| --- | --- | --- |
| 4.1 Workflow interface | Start, status, cancel, pause, resume, history, signal, and policy retry | Complete |
| 4.2 Durable execution | Temporal adapter, timers, and reconciliation | Complete |
| 4.3 Model adapter | Provider-neutral generation and schema checks | Complete |
| 4.4 Manager agent | Validated task plans without tool execution | Complete |
| 4.5 Structured handoffs | Versioned worker results | Complete |
| 4.6 Failure handling | Timeout, duplicate start, crash, and retry exhaustion | Complete |

## Phase 5 — Approvals and action authorization

Objective: centralized policy enforcement before any external system is connected.

| Milestone | Scope | Status |
| --- | --- | --- |
| 5.1 Action catalog | Registered action types, risk, validation, and approval requirements | Complete |
| 5.2 Policy engine | Deterministic allow and deny rules | Complete |
| 5.3 Approval workflow | Approval bound to the exact action parameters | Complete |
| 5.4 Authorized execution | Execute only after permission and approval checks | Complete |
| 5.5 Security tests | Bypass, expiry, rejection, and race coverage | Complete |

## Phase 6 — Shared mailbox and PBC automation

Objective: reliable two-way email operations and evidence-request follow-ups. The mock provider comes first. Live send stays disabled.

Phase 6 acceptance: a request is sent once from its approved template, a timeout reconciles without a second message, repeating a send or a reply returns the same record, a reply never changes the request by itself, and a reminder is approved, sent in the original thread, and stopped when the request is resolved.

| Milestone | Scope | Status |
| --- | --- | --- |
| 6.1 Email provider abstraction | Mock operations for send, draft, read, search, attachments, notifications, and reconcile | Complete |
| 6.2 Microsoft 365 configuration | Shared mailbox configuration. Live send stays disabled | Complete |
| 6.3 PBC data model | Request records and allowed status transitions | Complete |
| 6.4 Outbound messages | Approved templates, idempotent delivery records | Complete |
| 6.5 Inbound email processing | Notifications, matching, and untrusted content | Complete |
| 6.5a Standard workforce | Built-in SOX worker roster, install per firm, staff per engagement | Complete |
| 6.6 Follow-up scheduling | Durable reminders that stop when the request is resolved | Complete |
| 6.7 Test scenarios | Send, timeout, duplicate, reply, and reminder cases | Complete |

## Phase 7 — Evidence ingestion and chain of custody

Objective: store evidence bytes privately, with a hash the service computes, and keep that record immutable. Extraction and classification come after ingestion.

| Milestone | Scope | Status |
| --- | --- | --- |
| 7.1 File ingestion | S3-compatible storage, mock store, and an immutable custody record for an inbound attachment | Complete |
| 7.1b Engagement onboarding | Guided setup: scope, team, RCM from the ITGC library, workpaper templates with previews, PBC plan, approved kickoff plan | Complete |
| 7.1c Client RCM upload | Upload any client RCM (xlsx or csv), confirm column and term mappings, keep client columns, import as the engagement RCM. Business process areas, a business process tester, and a starter business library | Complete |
| 7.1d Drafted evidence requests | The evidence coordinator drafts each kickoff PBC request from its control, with Claude or a rules fallback, in the background | Complete |
| 7.1e In-scope systems from the RCM | An agent identifies the systems in an uploaded RCM, a person confirms them, and import tags them as in-scope applications | Complete |
| 7.1f Client terms mapped by an agent | The agent maps blank client terms from their controls, with reasons, and remaps on request | Complete |
| 7.2 Engagement workspace | Dashboard, controls register, project plan by phase, timeline with the standard SOX calendar, and the deficiency register with reviewer approval | Complete |
| 7.3 Evidence reading and classification | Read stored files (spreadsheets, documents, PDFs, and images by pluggable OCR), suggest the evidence kind and request coverage with Claude or rules, and a person confirms | Complete |
| 7.4 Agent first-pass review of screenshots | Claude reviews each screenshot (legibility, system, date, editing, applicability) and tests it against the control's attributes, drafts a follow-up when something is wrong, and a person signs off | Complete |

## Phase 8 — SOX testing and workpapers

Objective: test each in-scope control from its evidence, with agents doing the first pass and people deciding, and record the work in workpapers. The control inventory and workpaper templates were pulled forward into Phase 7.

| Milestone | Scope | Status |
| --- | --- | --- |
| 8.1 Test plans and sample selection | Each control's test plan, population checks, seeded random sample proposal, person approval and replacement, and a drafted sample evidence request | Complete |
| 8.1b Agent console | The engagement home: ask the agents in plain language, they answer from the records or propose actions, and a person confirms sensitive steps | Complete |
| 8.1c Evidence intake | Upload a folder or files; the agent matches each file to its control, files confident matches, and marks requests received; an evidence register table | Complete |
| 8.2 Testing engine | The tester tests each sample's evidence against the attributes, for any file type, and proposes deficiencies from exceptions | Complete, pending review |
| 8.3 Workpapers | Filled, versioned workpapers with preparer sign-off and `.xlsx` export | Complete, pending review |
| 8.3b Withdrawing and replacing evidence | Withdraw, restore, or replace an evidence file with a reason, keeping its custody record | Complete, pending review |
| 8.3c Engagement onboarding revamp | Guided creation, a setup overview, rebuilt steps, agent-drafted scope, period, and cadence, and a launch review | Complete, pending review |
| 8.4b Evidence preview and highlighted citations | Preview any evidence file; the tester cites, and boxes on screenshots, what each result rests on | Complete, pending review |
| 8.4 Roll-forward and remediation | Roll-forward rounds after effective interim testing, remediation requests, and post-remediation retests that decide the deficiency | Complete, pending review |
| 8.5 Controls per application | A control over several applications is one instance per application, each requested, tested, and concluded on its own; the register groups them by application | Complete, pending review |
| 8.6 Control context and readiness | Attributes owned by controls with provenance and history; supporting documents linked to many controls; process understanding for business process controls only; a readiness gate in five checks that explains each blocker; a pass stands only on cited evidence ([testing](testing.md#control-context-and-readiness)) | Complete, pending review |
| 8.7 Evidence planning by phase | Every control planned across design, interim, and roll-forward with applicability, objectives, procedures, and categorized evidence requirements; requests made per phase; population accepted before sampling; idempotent re-planning with proposed changes for review ([testing](testing.md#evidence-planning-by-phase-87)) | Complete, pending review |

## Phase 9 — Independent review

| Milestone | Scope | Status |
| --- | --- | --- |
| 9.1 Independent review | One review per control instance, opened when its effectiveness workpaper is prepared; the reviewer agent re-performs the testing and proposes notes; review notes are decided, answered, and cleared, with must-fix notes reopening the work; the engagement reviewer signs off, never on their own work | Complete, pending review |
| 9.2 Review queue and console | The dashboard's review progress and the register's In review queue, the "Independent review complete" milestone kept by the reviews, the console's inbox items and review tools | Complete, pending review |

## Later phases

Do not implement these until their phase is accepted.

| Phase | Objective |
| --- | --- |
| 10 | Reporting from validated records and an end-to-end synthetic project |
| 11 | Security, observability, recovery, cost controls, and a limited release |

## Decisions

Accepted in Milestone 1.2: [runtime and package managers](decisions/0001-runtime-and-package-managers.md).

Accepted in Milestone 1.3: [local PostgreSQL](decisions/0006-local-postgresql.md).

Accepted in Milestone 1.4: [baseline quality tools](decisions/0007-baseline-quality-tools.md).

Accepted before Phase 2. Implementation still waits for the milestone named in each record:

- [Temporal](decisions/0002-workflow-engine.md), adapter in Milestone 4.2
- [In-repository orchestration, not LangGraph](decisions/0003-agent-orchestration.md), Milestone 4.4
- [Microsoft Entra ID](decisions/0004-authentication-provider.md), Milestone 2.3; revised by [Google sign-in](decisions/0009-google-sign-in.md) after Milestone 9.2
- [S3 API, MinIO locally](decisions/0005-object-storage.md), Milestone 7.1

See [workforce.md](workforce.md) for the standard workforce roster.

Accepted in Milestone 2.1: [SQL migrations](decisions/0008-sql-migrations.md). Conventions are in [data-model.md](data-model.md).
