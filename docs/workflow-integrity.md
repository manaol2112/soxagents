# Workflow integrity: corrections before the control workspace

Status: **plan approved (W1–W4) with conditions; W1 authorized (19 October 2026).** W2, W3
and W4 each wait for the previous step's review. This milestone corrects the six findings
of the Milestone 0 report ([workflow-redesign.md](workflow-redesign.md) §7) under the
owner's decisions (§7) and conditions (§8). It comes before Milestone 1 (the control
workspace). Guiding principle: **no control is represented as fully concluded unless all
required testing, evidence, impact assessments and independent reviews supporting that
conclusion are complete.**

Rules for every change here: no existing methodology, approval permission or historical
audit record is changed silently; schema changes only through migrations; every correction
carries regression tests, permission tests and, where it shows, screenshots.

---

## 1. Classification of the findings

| # | Finding | Class | Correction in |
|---|---|---|---|
| 1 | A control reads "concluded" once its review is signed, even with an applicable roll-forward unreleased or a round open | **Derived-state defect** (the stored records are right; the derivation misrepresents them) | W1 |
| 2 | Results signed off before a material plan revision are relied on; the sheet does not record the revision it was tested under | **Missing approval safeguard** plus a **backend data gap** (`test_sheets.plan_revision` exists since 0079 but is never written) | W3 |
| 3 | Testing reopened by a review note reads as "Review notes"; the reason is only in the audit log | **Presentation inconsistency** plus a **data gap** (no reopen reason on the sheet) | W1 |
| 4 | Early interim release leaves design and implementation testing outstanding without consequence for the conclusion | **Missing conclusion safeguard** (release itself is correct and stays) | W1 (with #1) |
| 5 | Roll-forward, retest and remediation rounds have no independent review; one review per control, keyed `(project, control)` | **Missing review safeguard** | W2 |
| 6a | `_PHASE_ORDER` shows retest before remediation | **Presentation** (used only to sort: `workspace.evidence_phases`, `evidence_center` sorting, `control_journey.PHASES`; no logic reads it) | W4 |
| 6b | Rounds are gated by the control's interim readiness; no round-specific readiness (evidence, dependencies, sampling) | **Missing safeguard** | W4 |

---

## 2. The canonical control state (W1)

### 2.1 Definitions

Two things are told apart that today share one word:

- **Opinion** (`conclusion`: `NOT_CONCLUDED | EFFECTIVE | EXCEPTION`): the testing's result
  once interim testing is signed off and reviewed. Unchanged in meaning; it may exist while
  work remains (a roll-forward still to run, a retest open).
- **Final** (`final: bool`, new): the opinion is complete and may be relied on. True only
  when every condition below holds. The register's stage `CONCLUDED`, the dashboard's
  "concluded", the next-steps journey's Testing and Review stages, the status report's
  "concluded" and the review-complete milestone all follow `final`, not the opinion.

`final` requires, for the control's applicable phases and rounds:

1. The plan is approved at its current revision (no revision pending; no impact
   assessment pending, W3).
2. **Design and implementation**, where applicable: the design workpaper is prepared and
   covered by a signed review (#4). An early interim release never waives it.
3. **Interim**: the sheet is signed off and covered by a signed review.
4. **Roll-forward**, where applicable: a round is signed off and covered by a signed review
   (W2); none open.
5. **Retest and remediation**: no round open; a signed retest round is covered by a signed
   review (W2).
6. No review open and no review note unresolved on any of the above.

### 2.2 Where it is derived and who reads it

One function, `control_journey.canonical_state(row, phases, rounds, reviews, impact)`,
returns the step, the per-phase states, `final`, and the reason it is not final. Readers
changed to use it (today each has its own rule):

| Reader | Today | After |
|---|---|---|
| `workspace._controls` conclusion block (around line 1154) and `progress_of` | concluded once review signed and the plan task done | `conclusion` = opinion; stage `CONCLUDED` only when `final` |
| `workspace._stage` | lifecycle words from task stages | unchanged words, `CONCLUDED` from `final` |
| `readiness.evaluate` (`CONCLUDED`, `READY_FOR_REVIEW`) | review signed → CONCLUDED | `CONCLUDED` only when `final`; new `IMPACT_PENDING` (W3) |
| `control_reviews._update_completion` (REVIEW_COMPLETE milestone) | every control's review signed | every control `final` |
| `workspace._dashboard` "concluded", `next_steps` Testing/Review stages | opinion | `final` |
| `reports.status_report` "concluded, review signed off" | opinion | `final`, with the open items named |
| `control_journey.conflicts` | reports disagreement | empty by construction; the field stays and a test asserts it is empty on every fixture |

State transitions: none stored; the derivation changes. Historical records: untouched.

### 2.3 "Testing reopened" (#3)

- Migration **0089**: `test_sheets.reopened_at timestamptz`, `reopened_by uuid`,
  `reopen_reason text NOT NULL DEFAULT ''`, `reopened_from text` (`REVIEW_NOTE`,
  `IMPACT_ASSESSMENT`, `PERSON`) and `reopened_from_id uuid`. Written by
  `test_sheets.reopen_work` (person), `control_reviews._reopen_for` (note), and W3's
  reperformance decision. Cleared at the next sign-off. Backfill: none (the audit log keeps
  past reasons; past reopenings are not current).
- `workspace.Progress` gains `TESTING_REOPENED`; `progress_of` returns it when the sheet is
  OPEN with `reopened_at` set, before the review's own states; `step_of` returns
  "Testing reopened: <reason>" for the preparer. The review-note workflow (decide, address,
  clear, sign) is unchanged and still visible under the review.
- Web: `PROGRESS`, `PROGRESS_LABELS` ("Testing reopened"), `stageText`, the register's
  stage colour. No layout change.

### 2.4 Affected code, contracts and tests (W1)

- Functions: `workspace._controls`, `progress_of`, `step_of`, `_stage`, `_dashboard`;
  `readiness.evaluate`; `control_reviews._update_completion`, `_reopen_for`;
  `test_sheets.reopen_work`; `next_steps.next_steps`; `reports` status report;
  `control_journey` (new `canonical_state`, `final`).
- API contracts: `ControlRow` gains `final: bool` and `not_final_because: list[str]`; the
  values of `conclusion`, `progress` and `stage` keep their names; `progress` gains one
  value. `ReadinessBody.state` gains `IMPACT_PENDING` in W3. `/workspace/dashboard`
  `controls.concluded` counts `final`.
- Regression tests touched: `test_workspace` (stage table), `test_control_progress`,
  `test_control_reviews` (sign-off → concluded), `test_test_rounds` (a roll-forward after
  the review), `test_next_steps`, `test_control_journey` (conflicts empty), Node
  `engagement-model`, `controls-register-model`, `controls-overview-model`.
- Expected behaviour on the dev engagement: no change (nothing is concluded there). On the
  fixtures: a control with its review signed and a roll-forward applicable but unreleased
  stops reading `CONCLUDED` and reads `TO_REQUEST` (roll-forward) with
  `not_final_because = ["Roll-forward testing outstanding"]`.

---

## 3. Independent review of rounds (W2)

### 3.1 Change

- Migration **0090**: `control_reviews.test_round_id uuid NULL REFERENCES test_rounds`;
  replace the unique key `(project_id, engagement_control_id)` with two partial unique
  indexes: one for the control's own review (`test_round_id IS NULL`), one per round.
  `control_reviews.coverage jsonb NOT NULL DEFAULT '{}'`: the exact sheet id and version,
  round id, workpaper ids and versions, and the results hash the review covered, written at
  sign-off. Existing reviews are backfilled with the sheet version they already record
  (`sheet_version_reviewed`) and the workpaper versions current at their `signed_at`;
  rounds signed before this migration get **no** review retroactively: they are listed as
  "review outstanding" and the owner decides per engagement (see §7).
- `test_rounds.round_signed_off` opens a review for the round (`open_review(...,
  test_round_id=round)`); `control_reviews.run_reperformance` re-performs the round's sheet
  (today it selects the sheet with `test_round_id IS NULL`); `review_states` returns the
  control's reviews by round; the console's `review` and `control_review` inbox items name
  the round.
- A prior review stays historically valid and never covers later work: a design workpaper
  prepared, a sheet reopened and signed again, or a new round after a signed review opens a
  new review scope (a new row for a round; a re-performance of the control's review for
  interim, as `open_review` already does on conflict) and `final` waits for it.
- Deficiency retest outcome: today `round_signed_off` sets the deficiency to `REMEDIATED`
  or back to `REMEDIATION_IN_PROGRESS` at sign-off. Under rule 5 the result should
  contribute only after review. Proposed: record `retest_result` at sign-off as now, move
  the status change to the round review's sign-off, and show "Retest passed, review
  pending" meanwhile. **Decision needed** (§7).

### 3.2 Affected code, contracts and tests (W2)

- Functions: `control_reviews.open_review`, `run_reperformance`, `_review`, `reviews`,
  `review_states`, `_finish`, sign-off; `test_rounds.round_signed_off`; `workspace`
  (`review_status`/`review_left` stay for the control's review; `ControlRow` gains
  `round_reviews`); `console._inbox`; `control_journey` (`REVIEWED` per phase from the
  round's review).
- API: `/reviews` rows gain `test_round_id` and `coverage`; `/test-rounds` rows gain
  `review_status`. Web `review-model` keys reviews by control **and** round; the Review tab
  lists them; no new page.
- Permissions: the reviewer role and independence rules apply unchanged to round reviews
  (the same `_is_reviewer` and preparer checks).
- Tests: `test_control_reviews` (round review opens, re-performs the round's sheet, signs
  with coverage), `test_test_rounds` (sign-off → review; deficiency status timing per the
  decision), `test_control_journey`, console tests, Node `review-model`.

---

## 4. Version-aware impact assessment (W3)

### 4.1 Change

- **Stamp the revision tested.** `test_sheets.sign_off_work` writes
  `plan_revision = evidence_plans.approved_revision` (column exists). Backfill for signed
  sheets: the plan's `approved_revision` if the plan has not been revised since the sheet
  was signed (`revised_txid`/`plan_versions.created_at` before `signed_at`), else **NULL =
  unknown**, which counts as pending assessment (conservative). **Decision needed** (§7).
- **Record the assessment.** Migration **0091**: table `plan_impact_assessments`
  (`id, organization_id, project_id, engagement_control_id, test_sheet_id, test_round_id,
  from_revision, to_revision, status PENDING|VALID|REPERFORM, decided_by, decided_at,
  rationale, version, created_at`), one per signed sheet per revision step; an audit event
  on each decision.
- **When it is raised.** A material revision already returns the plan to `PROPOSED`
  (`revise_evidence_plan`); the journey marks the results stale at once and `final` is
  false. Assessments are created when the **revised plan is approved** (the approver sees
  the changes since approval and the sheets they affect): one `PENDING` row per sheet or
  round signed under an earlier revision. If the revision changes nothing a sheet depends
  on (the plan's `changes_since` items touch neither attributes, procedures nor the phase's
  evidence requirements), the assessment is created **already VALID with the rationale
  "revision does not affect tested attributes or procedures"**, by rule, and recorded as
  such. **Decision needed** whether this automatic VALID is acceptable or every assessment
  must be a person's (§7).
- **Reliance prevented until decided.** `readiness.evaluate` returns `IMPACT_PENDING`
  (blocking) ahead of `READY_FOR_REVIEW`/`CONCLUDED`; `final` is false; the status report
  lists the control under "results pending impact assessment"; the console and Home queue
  carry "Assess the impact of the plan revision on N signed-off results"; sample approval
  and tester runs for the control stay blocked as today (`require_testable`).
- **Decision.** `POST .../test-sheets/{id}/impact` with `{version, decision: VALID |
  REPERFORM, rationale}`, permitted to the engagement **reviewer role** and never to the
  person who signed the sheet (the review's own independence rule). `VALID` records the
  decision. `REPERFORM` records it and reopens the sheet through `reopen_work` with
  `reopened_from = IMPACT_ASSESSMENT` (Testing reopened: "Plan revision N: …"); if the
  review was signed, `open_review` re-performs it (its earlier sign-off remains in its row
  history and the assessment). Prior sign-offs, versions and rationale are kept in the
  assessment row and the audit log; nothing is deleted or rewritten.

### 4.2 Affected code, contracts and tests (W3)

- Functions: `test_sheets.sign_off_work`, `reopen_work`; `master_plans` approval path (the
  trigger for assessments; the approve route is unchanged in signature);
  `readiness.load_facts`/`evaluate`; `control_journey.stale_results` (from assessments);
  `next_steps.plan_steps`; `console._inbox`; `reports`; new `plan_impact.py` with the
  route.
- API: new route above; `ControlRow` gains `impact_pending: int`; `ReadinessBody.state`
  gains `IMPACT_PENDING`; `/controls/{id}/master-plan` gains `impact: [...]` so the Plan
  step can show it later.
- Tests: new `test_plan_impact.py` (approve a revision after a signed sheet → pending;
  VALID; REPERFORM reopens the sheet and the review; permission: signer refused, reviewer
  allowed; automatic VALID rule), `test_master_plans`, `test_readiness`,
  `test_control_journey`, `test_next_steps`, console tests.

---

## 5. Ordering and round readiness (W4)

- `_PHASE_ORDER` (workspace), `evidence_center._PHASE_ORDER` and `control_journey.PHASES`
  become `DESIGN, INTERIM, ROLLFORWARD, REMEDIATION, RETEST`. Verified: all three only sort
  displays; `test_control_progress` checks sums, not order; Node tests read the order as
  given. No logic changes.
- `readiness.round_readiness(round, control, ...)`, exposed on `RoundBody` as
  `readiness_state`, `readiness_blockers` and read by the journey's phase blockers:
  - Roll-forward: interim signed off effective and its review signed (W2); the round's
    request received (the owner's confirmation and the remaining-period population); the
    population accepted (`population_gate` already takes the round kind); the sample
    sized for the remaining period (`rollforward_size`).
  - Retest: the deficiency is `READY_FOR_RETEST` with a fix date; the operating period in
    `RETEST_RULES` has elapsed since it; remediation evidence received; population after
    the fix date accepted; sample sized by the remediation table.
  - Remediation: the remediation request received; the deficiency's remediation plan
    recorded.
- Enforcement: `control_tests` sample approval and the tester's run for a round test check
  `round_readiness` as they check `require_testable` for interim. Blockers are worded for
  the person.
- Tests: `test_test_rounds` (each blocker; the run refused and allowed), `test_readiness`,
  `test_control_journey`, `evidence_center` ordering tests.

---

## 6. Delivery order and acceptance criteria

| Step | Migration | Accept when |
|---|---|---|
| **W1** Canonical state; "Testing reopened" | 0089 (reopen columns) | A control with any applicable phase, round or review outstanding is never `CONCLUDED`; `journey.conflicts` is empty on every fixture and on the dev engagement; the reopened sheet reads "Testing reopened: <reason>" with the note workflow intact; all existing tests pass with their assertions updated only where the old reading was the defect, each such change listed in the report |
| **W2** Round reviews with coverage | 0090 | Every signed round opens a review of its own sheet; coverage records sheet, round and workpaper versions; a prior review never covers later work; permissions unchanged (tests); `final` waits for round reviews |
| **W3** Impact assessment | 0091 | A material revision after a signed sheet produces pending assessments on approval; `IMPACT_PENDING` blocks reliance everywhere `final` is read; VALID and REPERFORM behave as §4; the signer cannot decide; history preserved (sheet versions, audit, assessment rows) |
| **W4** Ordering; round readiness | none | Remediation sorts before retest everywhere; a round cannot be sampled or run until its readiness passes; blockers shown on the round and in the journey |

Each step: format, lint, mypy, pytest, Node tests, permission tests, screenshots where a
label changes, the diff reviewed, and a closeout report in the AGENTS.md format. The
existing full suite is run after each step. Nothing from Milestone 1 (the control
workspace) starts in this milestone.

---

## 7. Decisions (made by the product owner, 19 October 2026)

1. **Conclusion versus final.** `conclusion` stays the audit opinion (EFFECTIVE /
   EXCEPTION). `final` is the canonical indicator that all required testing and
   independent reviews are complete. The register, dashboard, status reports and
   completion milestones use `final` for completion.
2. **Deficiency remediation.** Remediation confirmation moves to the independent review,
   and requires successful remediation validation and the applicable retesting. A
   reviewer's sign-off alone never marks a deficiency REMEDIATED when testing found
   continuing exceptions. (§3.1 is amended: the status change happens at the round
   review's sign-off **and only when the retest passed**.)
3. **Historical rounds.** Rounds signed before W2 without demonstrable review coverage are
   review outstanding. An earlier control review is never assumed to cover later testing.
4. **Historical plan revisions.** Unknown plan-revision coverage triggers an impact
   assessment; it is never assumed valid. Historical sign-offs and audit records are kept.
5. **No automatic VALID.** Agents may analyse a revision and recommend VALID with a
   rationale; an independent human reviewer approves every decision, even when the change
   appears unrelated to the tested attributes. (§4.1 is amended: the rule-based VALID is
   replaced by a recorded **recommendation**, status still PENDING.)
6. **Decision authority.** Impact assessments require the independent reviewer role; the
   person who prepared or signed the affected testing never approves its assessment; an
   engagement owner may approve only when they independently satisfy the reviewer role and
   segregation of duties.

## 8. Conditions on implementation (owner)

- `final` is derived, never stored, and reverses when new required work, a plan change, a
  review note or a new testing round arises.
- Finalization is not an effective opinion: a control with supported exceptions is
  finalized too.
- Required phases come from the approved methodology and plan (`evidence_plan_phases`
  applicability); interim and roll-forward are not required of every control.
- The approved plan baseline and its revision identifiers (`plan_versions`,
  `approved_revision`) are preserved.
- **W1 must not treat a control as final while the W2 and W3 safeguards are missing**: a
  signed round without a review of its own, and a signed sheet whose plan revision is
  unknown or differs from the approved revision, each keep `final` false with the reason
  named, until W2 and W3 provide the review and the assessment.
- Remediation readiness distinguishes administrative remediation (plan, owner, evidence
  of the fix) from retesting procedures needing evidence, populations and samples.
- All historical records, approval decisions, testing results and audit trails are kept.
- After W1: the code changes, test results, migration outcome, regressions found and
  unresolved methodology questions are presented for review before W2.
- No unrelated workflow is modified; no authorization or approval requirement weakened.

## 9. W1 as built (scope confirmation)

W1 implements §2 with these specifics, following §8:

- `control_journey.finality_facts` reads, in one pass per engagement: the plan's status,
  revision and approved revision; each phase's applicability; the design workpaper's
  preparation; the interim sheet's status, version, stamped plan revision and sign-off;
  the control review's status, `sheet_version_reviewed` and sign-off; the rounds; the
  deficiencies' statuses. `finality(facts)` returns `final` and the ordered reasons it is
  not, each with the step and phase it belongs to.
- Sign-off stamps `test_sheets.plan_revision` from the plan's `approved_revision` (the
  column has existed since 0079). Earlier sign-offs stay NULL: "plan revision coverage
  unknown: impact assessment outstanding" until W3.
- A signed round keeps `final` false with "independent review of the <kind> round
  outstanding" until W2.
- Migration 0089 adds the sheet's reopen columns; `reopen_work` and the review's
  `_reopen_for` write them; sign-off clears them (the audit log keeps the history).
- Readiness' own `CONCLUDED` state (readiness.py: "the review is signed off; nothing more
  to test") is **not** changed in W1; its label is reported as an open question.

Open questions from W1, for the owner (none changes methodology; each is a presentation
or a pre-existing record-keeping point):

1. A not-final conclusion whose first open item is design testing reads as the stage
   `READY_FOR_TESTING` ("Ready for testing") with the next step "Design and
   implementation testing outstanding". A stage of its own for design work may read
   better; proposed for Milestone 1's register wording.
2. The lifecycle `stage` of a signed-but-not-final review reads `IN_REVIEW`; the
   register's `progress` and `next_step` carry the precise state. Same proposal.
3. Reopening a sheet (pre-existing behaviour) clears the sheet row's own `signed_by`,
   `signed_at` and `conclusion`; the sign-off remains only in the audit log
   (`testing.signed_off`). W1 adds the reopen columns and keeps the log; whether the
   sheet should also keep its last sign-off as columns (or a sign-off history table) is
   proposed for W3, where sign-offs and impact decisions are recorded side by side.
4. `readiness_state` `CONCLUDED` still means "review signed off" (it answers whether the
   control can be tested); the canonical completion is `final`. Rename proposed for M1.

## 10. W2 as built (independent review of rounds)

- Migration **0090**: `control_reviews.test_round_id` (nullable, references `test_rounds`),
  `control_reviews.coverage jsonb`; the single `(project, control)` unique constraint is
  replaced by two partial unique indexes (one review per control with no round; one per
  round). Signed reviews are backfilled with the sheet version they recorded and the
  workpaper versions prepared before they signed (`coverage.backfilled = true`). Rounds
  signed before 0090 get no review: they read "independent review of the … round
  outstanding" until a reviewer signs one (decision 3).
- `test_rounds.round_signed_off` opens the round's own review (`open_review(...,
  test_round_id)`); `run_reperformance` re-performs the round's sheet; `_review`,
  `/reviews` and the register's `round_reviews` carry `test_round_id`, `round_kind` and
  `coverage`; `review_states` reads the control's own review and `round_review_states`
  the rounds'; a must-fix note on a round review reopens the round's sheet.
- Sign-off records **coverage**: the sheet id and version, the round, and each prepared
  workpaper with its version; the audit event carries the same. A prior review never
  covers later work: `finality` treats a signed round as covered only when its own review
  is signed; the journey reads a reviewed round as `REVIEWED`.
- **Decision 2 as built**: a retest's `retest_result` and `retested_at` are recorded at the
  sheet's sign-off as before; a failed retest returns the deficiency to
  `REMEDIATION_IN_PROGRESS` at once; a passed retest leaves it `READY_FOR_RETEST` with
  `retest_result = PASSED` until the round review signs off, when `round_reviewed` sets
  `REMEDIATED` (and only then, and only if the retest passed). The reviewer's sign-off of a
  failed retest changes nothing.
- The review's own gates are unchanged for round reviews: reviewer role, independence from
  the preparer, every note cleared, the effectiveness workpaper prepared, the re-performance
  read at the sheet's current version.
- Not in W2 (disclosed): the web Review tab does not yet list a control's round reviews
  (the model reads them: `roundReviewsFor`); the console's review items do not name the
  round; both are Milestone 1 presentation work.
- Completed after the W2 report, at the owner's request: a failed retest's full
  round-review lifecycle (its review signs; the deficiency stays in remediation; nothing
  ever marks it remediated) and a must-fix note on a round review (the round's sheet,
  not the interim one, reopens; the round is testing again; the review waits; the earlier
  sign-off stays on record marked reopened; a second sign-off adds a second record).

## 11. W3 as built (sign-off history and plan-revision impact)

- Migration **0091**: `test_sheet_signoffs` and `control_review_signoffs`, one row per
  sign-off as it was made (signer, time, conclusion or coverage, the sheet's version, the
  plan revision tested under); reopening marks the row once (`reopened_*`); triggers refuse
  any other update and every delete. Backfilled from the sheets and reviews signed off
  today (their plan revision unknown where it was never stamped). `plan_impact_assessments`:
  one per current sign-off and plan revision, unique.
- **Detection** (`plan_impact.detect`): every current sign-off whose plan revision is
  unknown or differs from the plan's approved revision gets a PENDING assessment, raised
  when a revised plan is approved (`master_plans.approve`), at deploy
  (`detect_everywhere` in `migrate`), and on request (`POST .../impact/detect`,
  idempotent). An earlier PENDING assessment is superseded by a later revision's.
- **Recommendation** (the rules, no model): the two plan versions are compared with
  `changes_since`; a change to the control, an attribute, an evidence requirement, or the
  procedures or phase decision of the tested phase is recommended REPERFORM with the items
  named; a change confined to the understanding, wording, or another phase's decision is
  recommended VALID with that reason; an unknown revision gets no recommendation, only
  the reason it cannot be compared. The status stays PENDING in every case (decision 5).
- **Decision** (`POST .../impact/{id}/decide`): the reviewer role only, never the person
  who signed the testing off (decision 6; `independence` as for reviews), a rationale of
  at least three characters, version-checked, audited. VALID records it; REPERFORM also
  reopens the sheet (`Testing reopened`, `reopened_from = IMPACT_ASSESSMENT`, the
  assessment as the reason) and the review that covered it (`reopen_review_for`, its
  sign-off kept on record), and the review re-performs once the testing is signed again.
- **Reliance blocked** until decided: readiness returns `IMPACT_PENDING` (blocking, so
  sample approval and the tester's runs wait, `require_testable`); `final` is false with
  the reason; the journey marks the results stale; the Home queue carries "Decide the
  impact of plan revisions on N signed-off results" (blocking). A VALID decision for the
  approved revision lets the results count again; a decision for an earlier revision never
  covers a later one.
- **Version-specific review coverage**: a signed review stands only for the sheet version
  and the workpaper versions it recorded; a later sheet version or a re-prepared or newly
  prepared workpaper reads "review outstanding" until a review covers it; coverage without
  a recorded sheet version is unknown and outstanding. The historical review and its
  sign-off record are untouched.
- Historical records: the dev engagement's one signed sheet has no evidence plan at all
  (it predates planning), so no assessment is raised for it; finality already reads it as
  "test plan not approved". No sheet or review row changed under 0091.
- Not in W3 (disclosed): the web shows `IMPACT_PENDING` as a readiness label only; the
  assessment list and decision form are Milestone 1 work (the API is complete).

## 12. W3 follow-ups and W4 as built

W3 follow-ups (owner's decisions 1 and 2 on the W3 report):

- **Recommendation rule**: a change bears on signed-off results when it touches how the
  control operates (description, frequency, nature, system), an attribute, an evidence
  requirement, or the procedures or phase decision of the tested phase → REPERFORM
  recommended with the items named. A change confined to another phase → VALID
  recommended. A change to the understanding, scope, risk, title or key-control flag is
  **never** assumed harmless: no recommendation, with the items named for a person's
  judgement. Every recommendation is advisory; the status stays PENDING.
- **Historical coverage assessment** (migration 0092, `review_coverage_assessments`): a
  reviewer who did not prepare the work may document that a signed review COVERS the
  current sheet and workpaper versions (or REQUIRES_REVIEW), with a rationale; the row is
  immutable; the original review and its sign-off record are untouched. Finality treats a
  COVERS assessment that matches the current versions as coverage; a later version needs
  a new assessment or a review. Route: `POST .../reviews/{id}/coverage`.
- **Finality over rounds** reads each signed round's own plan-revision impact (pending or
  outstanding holds the conclusion) and its review's version coverage (`RoundFacts`),
  not only the interim sheet's.
- Integration tests added: REPERFORM after the covering review was signed (the review
  reopens with its sign-off kept on record; readiness leaves CONCLUDED; the sheet reads
  Testing reopened); a reviewer's coverage assessment making a design workpaper prepared
  after the review count as covered.

W4:

- **Phase order** everywhere remediation is shown: design, interim, roll-forward,
  **remediation, retest** (`workspace._PHASE_ORDER`, `evidence_center`,
  `control_journey.PHASES`); display only, no logic read the order.
- **Round readiness** (`round_readiness.py`): per round, `READY`, `NOT_READY` with the
  blockers in the order to resolve, or `DONE`. A retest needs the deficiency ready for
  retest, the remediation evidence (the fix and its support) received, the fixed control
  operated until `test_from`, the retest population received, the population accepted,
  the plan approved at its current revision and no impact decision pending. A
  roll-forward needs interim signed off effective and its evidence received; interim's
  independent review is **not** a prerequisite (the methodology allows the work in
  parallel; final completion still needs every review). The gates: approving a round's
  samples (`control_tests`) and the tester's run (`testing_engine`) wait on it and say
  why; `RoundBody` carries `readiness_state` and `readiness_blockers`; the journey's
  roll-forward and retest phases show the round's own blockers.
- Legacy tests updated (documented, UPDATE class): the retest flows in `test_test_rounds`
  and `test_round_reviews` now receive the remediation evidence before sampling, as the
  methodology requires; their assertions are otherwise unchanged.
- The seven activities the owner named read as: the design, interim, roll-forward,
  remediation and retest phases (journey), the independent review (step Review, per
  control and per round), and the final conclusion (`final`).
- Owner's decisions on the W4 report: roll-forward testing may proceed before interim's
  review (final completion still needs every applicable review); remediation evidence
  counts once it is on record as evidence against the deficiency's remediation request
  (versioned, in custody, traceable), in part or in full, so no duplicate request is
  asked for, and a note on the deficiency alone is never enough. A round's readiness
  `DONE` means its testing is signed off and nothing more: its review and the control's
  completion are read from `round_reviews` and `final` (tested).
