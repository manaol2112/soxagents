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

Laid out 8 November 2026 (product owner: "the flow does not make sense"); the Attributes step added and the canvas redesigned 11 November 2026 (product owner: the attributes come before the D&I evidence; "my nodes and data flow look very small and I can't even read the letters"). Time runs left to right and every edge runs forward or down; four tinted bands, one per stage, on a dot grid. Twelve steps.

```
UNDERSTAND                      D&I BRANCH                                                CONCLUDE
Setup → Understanding           D&I Evidence → D&I Assessment → D&I Conclusion ─ not effective ─┐
             ↓                     ↑                                  │ effective                │
         Attributes ───────────────┤                                  ↓                          ├→ Control Conclusion
                                   │  OE BRANCH                                                  │        ↓
                                   └→ Scope & Sampling ─────────→ OE Evidence → OE Testing ─────┘  Independent Review
                                                                                                          ↓
                                                                                                   Final Workpaper
```

- The Attributes (a human gate) open both branches once they are settled; a control whose D&I is released or whose plan is approved keeps its branches open while its attributes still need criteria.
- OE starts one column later than D&I: Scope & Sampling may begin once the attributes are settled, and OE Evidence sits directly under the D&I Conclusion that clears it.
- The canvas opens at a readable zoom (at least 0.9, `READABLE_ZOOM`) and pans sideways when the workflow is wider than the panel, instead of shrinking it; Fit shows the whole workflow. Its height follows the content (`workflowFrame`).
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

**B1a. The D&I release waits for settled attributes. Built 11 November 2026** (the product owner: "Typically I test a sample of one against the attributes so attributes should be finalized first ... and based on the attributes, that would impact the evidence that will be requested"; "go ahead"). No migration.

- The release is recommended ("Ready to release") once Control Understanding is complete **and** the control's attributes are settled: at least one approved, none proposed, no open question about them (`evidence_plans.ATTRIBUTES_SETTLED_SQL`'s rule, read with its counts by `phase_release.attribute_waits`), and the attribute agent not still at work on the control (`process_narrative_runs` PENDING or WORKING). The rest of the test plan (scope, sampling, periods) stays OE's and does not hold it.
- No separate confirmation of the attributes (product owner's choice): the library's standard attributes are approved in the firm's library review (L3e), and the agent's tailoring proposals from Control Understanding are each decided by a person, so asking again would repeat those decisions. The release itself stays a person's.
- Early release stays available with a reason (at least 20 characters), as before understanding. A release already recorded is not revisited.
- The phase status says what it waits on (`waiting_on`: UNDERSTANDING or ATTRIBUTES; "Waiting for the attributes"). The release's audit record (`phase.released`) keeps the approved attributes' wording at the release.
- The web: D&I Evidence reads "Waiting on the attributes" and points to Test Design ("Decide the attributes"); once they are settled the card offers both the release and "Approve scope and sampling". The stage line marks both branches as current. The D&I Evidence panel opens on one decision card (`design-release.tsx`): what the release rests on (understood, attributes settled, items planned), what will be requested with the attributes each item evidences, the attributes folded with their source, and one action; an early release asks its reason on request. Governing documents fold under the evidence list; the list drops its phase filter and shows filters only past six requests.
- Tests: `tests/test_design_release.py` (two added), `tests/design-release-model.test.ts`, `tests/next-step-model.test.ts`, `tests/step-panel-model.test.ts`.
- **The Attributes step** (same day; the product owner chose "Attributes step first" over an arrow between the branches): the workflow is twelve steps. Attributes (a human gate, in the Understand band) follows Control Understanding and opens both branches; it reads "N to decide", "N questions on the attributes", "None approved yet", "Being updated" (the server still waits) or "N attributes settled". The OE branch's first step is **Scope & Sampling** (scope, sampling, periods and the plan's approval), which waits on the attributes. The understanding's done step leads to "Finalize the attributes" until they are settled, then to D&I evidence; its review reports `attributes_settled` from `phase_release.attribute_waits`, so it never disagrees with the release.

**B1b. Pass/fail criteria tailored to the control, for every agent that reads evidence. Built 11 November 2026** (the product owner: "it's critical that these agents are considering the control environment and not just fully relying on the standard wording on the library. It has to be tailored on the control environment but still guided by the requirements of the attributes. I want also these criteria to be displayed in the finalize the attribute"). No migration: the criteria columns exist (0079, 0080, 0122).

- **What counts.** An approved attribute's criteria are owned when a person wrote them, or a person accepted those the planner agent tailored (or the demo prepared). The library's standard wording is the requirement, not the criteria. One rule, `control_attributes.CRITERIA_OWNED_SQL`, read by the settled check, the planner, the testers and the attribute review.
- **The planner tailors every attribute** (`engagement-planner/5`): it is given each library attribute's standard (condition, pass, exception, insufficient, review, do-not-infer) as `attribute_standards`, and the attributes no person owns criteria for as `attributes_needing_criteria`. It names the client's system, tool, roles, policy and values from the documented design and the approved narrative, meets every part of the standard, never weakens one, and never invents a name or value. Its criteria are written for library attributes too now (`_write_criteria`), never over a person's, an accepted, or the demo's.
- **The testers judge against them.** The control tester (`control-tester/6`) gets each attribute's `tailored_criteria` beside the standard's `definition`; the tailored govern, the standard supplies what to find and compare and its insufficient, review and do-not-infer rules. Agent criteria no person accepted are never given. Each test records which criteria each attribute was judged against (`inputs.criteria`: TAILORED, STANDARD or NONE). The evidence coordinator's mapping (`evidence-mapping/5`) maps to the same criteria.
- **Settled waits for them.** The attributes are settled (the D&I release's recommendation, the workflow's Attributes step, the understanding review) only once every approved attribute's criteria are owned: "N attributes need criteria tailored to this control" when none are stated, "N attributes have criteria to accept" when the planner or the demo prepared them (both in one sentence when both apply). The planner writes and compares exactly the attributes it may write (`evidence_plans.CRITERIA_WRITABLE_SQL`): a re-plan of an approved plan whose only change is tailored criteria is proposed as a revision for a person to accept. A control whose plan was approved earlier gets the tailoring from its next planner run (plan again, or a recorded control change). A crashed attribute-agent run (an expired lease) no longer holds the release. The operating evidence's gate (`ATTRIBUTES_SETTLED_SQL`) is unchanged for now.
- **The Attributes step shows them.** Each approved attribute shows its criteria (tested, passes when, fails when, judgment), who owns them, and Accept or Edit; a person writing them starts from the standard's requirement. One "Accept all N criteria" decision accepts every tailored set, each recorded on its own. The standard's requirement opens on request.
- Tests: `test_design_release.py` (criteria wait, accept, the planner writes for library attributes, never over a person's), `test_evidence_planning.py`, `test_grounded_testing.py`, `test_evidence_findings.py`, `test_understanding_chat.py`; `control-context-model.test.ts`, `control-workflow-model.test.ts`, `design-release-model.test.ts`. `tailor_criteria` in `tests/support.py` states criteria for tests of what follows.

**B1c. Walkthrough questions. Built 11 November 2026** (migration 0147, `walkthrough_answers.py`; the product owner: Control Understanding asked correct but high-level questions; it must ask the full set a senior IT auditor asks in a walkthrough). Decided: a question bank per control family (`walkthrough_questions.py`); first increment the universal questions plus the logical access (`access-*`) and change management (`change-*`) library controls; only required questions hold "Control Understanding complete"; optional ones are asked but can be left. Controls already understood under the earlier questions reopen until their required walkthrough answers are given; a D&I release already recorded stays released (the product owner, the same day: "let's keep it for now").

- **The answers.** One row per control and question (`control_walkthrough_answers`): CONFIRMED by a person (source PERSON), or PROPOSED by the planner from walkthrough notes (source AGENT, with the exact words of the notes) or the prior year. `PUT .../controls/{id}/walkthrough-answers` saves a topic's answers at once, all or none, authorized as the statement's values are (project update, a person): each must be a question asked for the control now (else 409), an offered option, Yes or No, or plain text of at most 1,000 characters with no credential (else 422 with the reason). A MULTI answer is kept joined with "; ". Only an optional question may be marked not applicable, with no value. Each answer written is audited (`control_walkthrough.answered`: the option, or a free-text answer's length only); the same answer again writes nothing.
- **What is asked.** The bank's questions for the control's library key, nature and frequency, in its order; a follow-up once its parent's confirmed answer calls for it. Only confirmed answers open follow-ups, everywhere (the review, the gate, the save's check), so the review lists exactly what the gate counts; a save may answer a parent and its follow-ups together. A follow-up whose parent changed keeps its answer on record but is no longer asked, counted or given to the agents.
- **The review.** Each question asked is a WALKTHROUGH point after the others, with its topic, answer kind, what it drives (`needed_for`: evidence; attributes for attributes and criteria; testing for sampling and scope) and, for a proposal, its quote.
- **The gate.** `understanding_waits` checks the walkthrough last, in one query for the engagement: "Control Understanding is not complete: N walkthrough questions are not answered." The D&I release recommendation and the review's ready-for-evidence read it.
- **Notes.** The notes reader asks the planner the walkthrough's open questions in the same call (`understanding-notes-v2`); its walkthrough answers are recorded as proposals with their quote (a quote not in the notes, or an answer that does not fit the question, is dropped) and never replace a confirmed answer. Without a model, a choice's option named word for word is proposed; "Yes" or "No" in the notes answers nothing by itself. The statement's answers are offered to the person as before.
- **The agents.** The confirmed answers (not applicable left out) are the control environment: the planner (`engagement-planner/6`) reads them as `walkthrough_answers`, for the evidence items and each attribute's criteria, and may quote them; the control tester (`control-tester/7`) reads them under the control as context for applying the criteria, never as evidence of performance. Both treat them as client-provided data.
- **The understanding and the asking order** (product owner feedback, 11 November 2026: "The understanding" did not change as the walkthrough was answered). The review's `narrative` tells the confirmed answers topic by topic in the bank's order (`walkthrough_questions.narrate`): the bank's words, and each answer keyed to its question, under the topic's label. Only the confirmed answers to the questions asked now are told, the same ones the gate counts: a proposal, a question marked not applicable and an unanswered one are not. The questions are asked in the order the control runs (`questions_for`, a follow-up after its parent), and the review, the gate and the agents' inputs all keep that order. An answer kept for a question the bank no longer has (removed when the bank was trimmed) stays on record but is read nowhere: not asked, counted, given to the agents or told.
- **Several answers and "Other"** (product owner, 11 November 2026: "The questions in control understanding do not take multiple answers"). A question where more than one option can be true at the same client for the same control is multi-select (25 former choices, e.g. how IT learns of a termination, how access is granted, how service accounts are identified), and the workaround options ("Both", "A mix", "In different ways") are gone; a single choice stays only where its options exclude each other (the four "can the doer also approve" questions, disabled or deleted, how a third-party expiry is set, the volume range). Every choice and multi-select question also takes one answer its options do not offer, `Other: <text>` (3 to 200 characters, no ";", no credential; the last part of a multi-select answer), except the volume range, which the planned sample is read from. The save keeps it with its prefix in the bank's spelling, the audit records its length only, the review's WALKTHROUGH point says `allows_other`, and the gate, the narrative (its text, without the prefix) and the agents read it as any confirmed answer; the notes reader (`understanding-notes-v3`) may propose one, kept only when its quote is in the notes.
- Tests: `test_walkthrough_answers.py`; `test_design_release.py` and `test_understanding_chat.py` rewritten for the walkthrough's required questions; `answer_walkthrough` in `tests/support.py` answers them for tests of what follows.

**B1d. The attributes follow the understanding. Built 12 November 2026** (migration 0148, `attribute_review.py`; the product owner, on the Attributes step showing six library attributes "Needs criteria" right after Control Understanding: "Shouldn't it automatically update when the user has completed the control understanding?"; "I don't want it to show propose then the user would have to approve separately"; "when the attributes are displayed, the agent already reviewed it and the human will be the second pair of eyes").

- **The trigger.** After any save on the control (`context_routes.changed`), `evidence_plans.queue_for_understanding` queues the control's plan run when Control Understanding is complete (`understanding_waits` has no entry) and the planner has not read it as it stands (`understanding_due`): a client value or a confirmed walkthrough answer changed after the plan was last generated, or the planner agent never ran on the plan (`source = 'RULES'`) and an approved attribute it may write has no criteria. Only when a worker can run it and a model is configured, as `replan_for_new_attributes`; with no model nothing is queued and "Propose with the agent" stays the manual path. One run at a time for the control: never while its plan run or its approved narrative's run waits or works, and not over a failed run (a person starts that again). It stops by itself: the run generates the plan again, so nothing is due until the understanding changes.
- **The run** (the existing plan-run queue, `run_plan`; no new queue). When the understanding is due it does three stages, each shown on the page (`evidence_plans.run_stage`): ATTRIBUTES, the attribute agent proposes what the understanding adds, changes or retires (it now reads the documented design and the confirmed walkthrough answers); CRITERIA, the planner plans again and tailors every attribute it may write; REVIEW, the reviewer agent reviews the set. A save made while the agents work is read by one more pass, and only one. Every step commits on its own (`db.independent_steps`), so the stage is visible and no row of the control stays locked during a model call.
- **Nothing approved changes without a person.** Proposals stay PROPOSED; criteria are written as the agent's, to accept; on a plan a person approved the planner's tailoring arrives as a pending revision and the reviewer writes nothing on approved attributes. The agents never release or approve anything, and the settled rule is unchanged: nothing is settled until a person accepts.
- **The reviewer agent** (`attribute-set-review/2`, the independent reviewer, its own model call and record). It reads the control, its documented design with the client's values, the confirmed walkthrough answers, the approved narrative, each attribute's standard, and the whole set as it would stand with its criteria. Per attribute: OK, REVISED or CONCERN with a one-line reason; for the set, findings (an activity no attribute covers, attributes that test the same thing). A revision is kept only where an agent may write (an agent's proposal: wording and criteria; an approved attribute's criteria no person stated or accepted, on a plan no person approved) and only if it states all three parts, is objectively testable, holds no credential or link, and states no figure or citation the inputs do not give; otherwise it is left out and the attribute reads as a concern. One round. A review that does not finish leaves the drafts as they are, marked "not reviewed", and blocks nothing. Kept on the plan (`evidence_plans.attribute_review`) with a mark of the words reviewed, so a verdict never stands for words that changed after it; the attribute API gives each attribute's `review` and the set's `review_summary`.
- **The wait.** While the run waits or works (a live lease) and criteria are not owned, `attribute_waits` says "the agent is still updating them", as it does for the narrative's run. Those attributes were waiting already, so a plan run never holds attributes that were settled.
- **One acceptance** (`POST .../attributes/accept`, `control_attributes.accept_many`). One decision per attribute and one call for the set: for a proposal it approves the change (`decide`) and accepts the criteria it carries; for an approved attribute it accepts the tailored criteria. Each item goes through the same rules at the version the person saw and leaves its own records with the person as the actor (`attribute.approved`, `control_attribute.criteria_accepted`), the group one more (`attributes.accepted`); all or none. Authorized as any attribute decision.
- **The Attributes step.** One list as the agent proposes it to stand: an addition is a row with the next letter ("Added by the agent"), a rewording shows the new wording in the place of the attribute it replaces ("Reworded by the agent", the previous wording on request), a retirement marks the attribute ("Agent suggests removing"); each "To accept", with Accept on the row, "Accept all N" for the set, and Reject in the row's menu. While the agents work the step shows the stage with the reading mark, the chips read "Updating…", actions are off, and the page reads again every three seconds without a reload. "Propose with the agent" becomes "Run again" once an agent has worked.
- **No duplicates, and the best final version** (the product owner, 12 November 2026, on ITGC-AC-02, where the agent added "disabled or removed by a system administrator…" beside the approved "access … was disabled or removed…": "I don't want to see duplicate attribute… the best final version of the attribute and criteria are the ones that are being reviewed by the human reviewer"; and, refining it the same day: "If it already copies one, that means I only need to be specific on the criteria"). The attribute says what is tested; its criteria say how it is tested at this client. When a proposed attribute overlaps an existing one and only adds a detail (who performed it, which record shows it, which account), the existing attribute's wording stays as it is, a library standard's above all, and the detail goes into that attribute's tailored criteria (condition, pass, fail). No CHANGE is proposed to reword an attribute for a detail; CHANGE remains for a real difference in what is tested (another approver, system or timing); ADD only for a condition no attribute tests. The detail is written only where the planner itself may write criteria (`CRITERIA_WRITABLE_SQL`: none a person stated or accepted, none the demo's) and not on a plan a person approved (`attribute_review.write_detail`), as the agent's, to accept. Where the criteria are a person's, the duplicate is dropped (SUPERSEDED, with a note) and a concern is kept in the stored review. The reviewer corrects what it can instead of leaving a recommendation it would itself reject. Each merge is in the stored review (`merges`: CRITERIA, FOLDED into a proposal the agent already made for the attribute, or DROPPED) and on the audit trail (`attributes.reviewed`).
- **Standing methodology: no duplicate attributes, on every path** (the product owner, 12 November 2026: it applies "to every attribute generated from now on"). An agent never proposes an attribute that duplicates one already approved or proposed; it makes the existing attribute's criteria specific instead. Every agent proposal goes through `control_attributes.generate`, where the rule cannot be skipped: the drafter's prompt (`attributes/4`) and the reviewer of the drafts (`attribute-review/2`) return such a detail as a CHANGE in the approved wording with more specific criteria, which the server writes into the attribute's criteria where an agent may and never stores as a proposal (left out, and counted, where a person owns the criteria, which the context now says); and a server guard before anything is stored, with no model in it: an addition whose wording an approved or proposed attribute already has, or that is written from the library attribute one already stands for (`definition_key`), is never stored, and an attribute gets at most one proposed change. What was left out or made specific is in the note and the audit record (`attribute.proposed`: `duplicates_left_out`, `criteria_detailed`). Every path then ends with the set review (`attribute-set-review/2`), which catches what only a reading can tell is a duplicate: the run after Control Understanding and "Run again" (`evidence_plans._plan_pass`), "Propose with the agent" answered in the request (`context_routes.generate_reviewed`), the review of a control (`review_control`), and the approved narrative's run (`process_narrative._plan_from_narrative`). Library proposals (`library_matching`) already matched by definition and wording and are unchanged. Without a model no agent proposes anything, so there is nothing to review. `test_attributes_follow_understanding.py` runs each path with a model that adds a duplicate, and the guard alone with both reviewers passing it; it is in `make test-fast`.
- **Letters.** In the Attributes step an added row takes the next letter after the approved attributes (D, E, …), the letter it has once accepted; a rewording keeps the letter of the attribute it replaces and a retirement its own.
- **No reviewer notes on the screen** (the product owner, 12 November 2026, on seeing them: "I don't need to see this note from the reviewer agent. Any note from the reviewer."). The Attributes step shows none of the reviewer's verdicts, reasons or findings, per row or for the set. Display only: the review is still made, applied where it may correct, kept on the plan and carried by the API (`review`, `review_summary`). The step says only when the review did not finish ("The reviewer agent did not finish, so these are not reviewed."), which is the run's status.
- **Only a run that works on the attributes shows as one** (the product owner, 12 November 2026, after "Accept all": "it shows updating again? Why is that?"). Accepting an addition asks the planner to plan its evidence (`replan_for_new_attributes`), a plain plan run with no stage that changes no attribute and no accepted criteria. The Attributes step shows nothing for a plain run and blocks nothing during it; `attributes_run` and the "still updating" wait read only a run that has a stage (the one that follows the understanding) or the approved narrative's planning stages. The second run was kept rather than having the planner plan evidence for proposals in the first: the plan's items are linked to approved attributes, and evidence planned for a proposal nobody accepted would put undecided agent content into a plan a person approves and requests from.
- **Handed to the worker after the commit** (found the same day: a queued run sat for two minutes). The context routes handed queued work (plan runs, released drafts, resumed tests) to the worker inside the request, before it committed; a free worker thread's claim saw the plan as it was before, skipped it, and nobody started it until the next restart. They are now handed over once the request has committed (`context_routes.run`), as the other routes do.
- **D&I evidence traceable to the attributes** (found on the real data the same day, on ITGC-AC-02: the walkthrough instance "One leaver traced from HR to SAP" had no attribute links while the release read "tested against 4 attributes"). Cause: the planner agent's design example never listed an attribute. Its prompt asked for the attributes only in the operating phases ("Design procedures … need no attribute link"), `check_plan` checked attribute coverage only for the operating phases, and the rules' walkthrough item, which was linked, was replaced by the agent's. Not the malformed-answer path and not the merge. Now enforced in code for the rules' plan and the model's alike, by repair (`evidence_planning._instance_against_every_attribute`, in `check_plan`): in a design phase that applies, every item that shows the control performed once (category CONTROL_EXECUTION: a walkthrough instance or example) lists every approved attribute, in the control's order, so its links follow (`_sync_named_links`) and a re-plan after an accepted addition extends them. There is no field to record why an attribute is not evidenced at D&I, so none is excepted; a policy or procedure document keeps what the planner listed (it evidences only the attributes it states). A design phase none of whose items lists an attribute is noted for the team in the plan. The planner's prompt says the same (`engagement-planner/7`). The gate: `phase_release.design_untraced` lists a control with approved attributes whose planned D&I items are linked to none of them; its D&I release is then not ready but WAITING with `waiting_on` EVIDENCE ("The D&I evidence is not planned against the attributes: no D&I item evidences any of the N approved attributes. Plan the evidence again.", step label "Evidence not planned against the attributes"), after the understanding and the attributes; an early release still needs the reason. Planning the evidence again clears it. Tests: `test_design_traceability.py`, in `make test-critical`.
- **After an independent review of this change** (12 November 2026; each with a regression test). A handoff to the worker that fails after the commit never fails the request, is logged, and does not stop the handoffs after it; what was queued stays queued and is picked up by the worker's start (`resume`, `durable.resume_plan_runs`) or, for a queued run that follows the understanding, by "Run again", which hands it over again. Two additions each named as the other's duplicate never both vanish: the second is kept, as a concern. An addition a person approved while the reviewer worked is not merged away, and nothing false is recorded. The reviewer's criteria for an approved attribute are not written over the criteria of a change proposed for it (they could contradict its wording): the duplicate goes and a concern is kept on the change. The reviewer's own revision has the same approved-plan guard as `write_detail`. Every queueing that is not a run following the understanding clears `run_stage` (the launch, `queue_unrefined_plans`, `replan_for_new_attributes`), so a failed staged run never turns an evidence re-plan into an attribute run. An approved attribute gets at most one proposal in an answer, a change or a retirement, and the step never shows a change or a retirement as an addition. The drafter's detail for an attribute left as worded passes the reviewer's checks (`attribute_review.refused_criteria`) or is left out. Two additions written from one library attribute do not both land. Only a live D&I item counts as evidencing an attribute (planned, waiting for its dependency, or requested; not waived, removed, or only a proposed addition). A failed planner run with the understanding since completed reads as stopped ("The planner's last run failed, so the attributes were not updated from the understanding. Run again."), since nothing is queued over a failed run.
- **A run that does not finish** (found the same day with the real model and a reloading API). The context says `attributes_run` STOPPED with `attributes_run_note`, and the step shows the note in place of the working line, never a run as working once nobody works on it: a run whose lease ran out or that failed ("The run stopped before it finished. Run again."), and a planner answer that still broke a rule after its two corrections, so the rules planned instead ("The planner's answer could not be used. Run again.", also the run's note; the run ends idle, and is not queued again by itself). "Run again" (`POST .../attributes/generate`) asks for the whole run in the background when a worker and a model are there (`request_attributes_run`, also over a failed or stopped run), and is the attribute agent alone otherwise, as before. A queued, interrupted or failed run keeps its stage, which is how `run_plan` knows to start with the attributes and how the step knows the run was one of its own. The local worker (the API process, local development) puts plan runs the previous process left working back to waiting when it starts (`reclaim_interrupted_plan_runs`), so a reload resumes them at once; other workers reclaim by the lease, as before. A malformed model answer now records where it broke the schema on its call (`model_calls.error`: the schema's property path and the type found, never the answer's words).
- Tests: `test_attributes_follow_understanding.py`; `control-context-model.test.ts`, `control-workflow-model.test.ts`.

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
