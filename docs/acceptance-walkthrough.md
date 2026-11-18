# Acceptance walkthrough: one ITGC control, onboarding to final conclusion

Run on 20 October 2026 against an isolated database (`ai_workforce_walk`, created and
migrated fresh for the run; the development and demo databases were untouched), with the
API pointed at it and the web app serving it. The control is ITGC-AC-01, User Access
Provisioning and Approval, from the standard library, on an engagement "SOX 2027" over
SAP ERP. Screenshots of every stage are in `docs/review/acceptance/` (desktop 1440 and,
for three stages, mobile 390); the stage log the run wrote is `walk-log.md` there, and
the sign-off history the API returned is `signoff-history.json`.

## What is real and what is simulated

- **People**: Dana Whitfield (engagement lead) and Riley Okafor (independent reviewer)
  are demo users. Every approval, sufficiency decision, sample approval, sign-off, note
  decision and review sign-off below is a real record made through the API by one of
  their sessions, with the same authorization checks as in use.
- **Agents that ran for real (rules, no model configured)**: the test-plan drafting from
  the standard, the evidence coordinator's request drafts, the evidence reader (file
  classification and population checks), the reviewer agent's re-performance.
- **SIMULATED**: the client's evidence files (small CSV and text fixtures); the tester's
  and the drafting agent's model answers (the test fixtures' stub provider, which answers
  pass or exception as scripted and cites the first line of the file it was given); the
  delivery of evidence requests (approved for sending, but no outbound sender is
  configured, so nothing left the system). Each is marked where it happens below.

## Validated and not validated

**Validated** by this walkthrough: the audit workflow and its records (plan generation and
approval, requests and their approvals, evidence intake and sufficiency, sampling and its
approval, testing sign-off, rounds and their bases, deficiency logging and remediation,
retest, independent review with note decisions and sign-off, the final conclusion), the
authorization and segregation-of-duties checks on each of those actions, the immutable
sign-off history, and the trace from objective to review, all through the API against
real application records.

**Not validated** (simulated or unavailable here, and not to be described as validated
live capabilities): the tester's and the drafting agent's model answers (no model was
configured; a stub provider answered as scripted), outbound evidence delivery (requests
were approved but no sender is configured; nothing left the system), and the client
portal's side of the exchange. The evidence reader and the reviewer agent ran their
rules-only paths, not a model. Product status reporting keeps this distinction until a
walkthrough runs with a configured model and sender.

## The twelve stages

| # | Stage | What happened | Screenshot |
| --- | --- | --- | --- |
| 1 | Onboard | Dana created the engagement, set its scope and period, added SAP ERP and the team (Dana: lead; Riley: reviewer), and approved the launch plan. | `01-onboarded-home.png` |
| 2 | Proposed plan | The platform drafted ITGC-AC-01's test plan from the standard: 18 evidence requirements across 3 phases, 7 procedures, 5 attributes; status PROPOSED. Nothing is requested before approval. Agent says: "Proposes this test plan for approval"; the decision is a person's. | `02-plan-proposed.png`, `-mobile.png` |
| 3 | Plan approved | Dana approved the plan (revision 1, approved by Dana Whitfield); the approval released the requests as drafts. | `03-plan-approved.png` |
| 4 | Requests | The coordinator agent drafted the interim population request and the design evidence request; Dana approved each with a reason on the approval record. They await the outbound sender (not configured): SIMULATED delivery, no email sent. | `04-requests.png` |
| 5 | Evidence | The population listing (3 users, SIMULATED) and the provisioning procedure were uploaded against the requests; the reader ran on rules and recorded the population checks (completeness, unique items, period); Dana accepted the population as sufficient (a person's decision). | `05-evidence-received.png` |
| 6 | Design testing | Dana asked for the design workpaper; the drafting agent drafted it from the read evidence (SIMULATED stub answer); Dana prepared it through the API. | `06-design-prepared.png` |
| 7 | Interim testing | Dana approved the sampling plan (3 of 3, seed on record); tickets arrived and were read; the tester's answers (SIMULATED) pass every attribute, each citing the ticket file; Dana signed the testing off EFFECTIVE with a note. | `07a-samples-approved.png`, `07b-interim-results.png`, `07c-interim-signed.png` |
| 8 | Roll-forward | The roll-forward round opened at the sign-off with its testing basis recorded (plan revision 1, 5 attributes, 4 procedures); Q4 population and tickets received and read; the tester's answers (SIMULATED) found one exception (ticket T-10 has no approver); Dana signed the round off NOT EFFECTIVE. | `08a-rollforward-results.png`, `08b-rollforward-signed.png` |
| 9 | Exception | Dana logged the proposed deficiency D-001, recorded remediation in progress and the fix date; the platform requested the retest with its own recorded basis (readiness READY once remediation evidence and the post-fix population arrived); Dana approved the retest samples; the tester's answers (SIMULATED) pass; Dana signed the retest off EFFECTIVE. D-001 stayed READY FOR RETEST until the retest's review signed (W4). | `09a-deficiency-logged.png`, `09b-retest-basis.png`, `09c-retest-signed.png` |
| 10 | Reviews | The effectiveness workpaper was drafted (SIMULATED) and prepared by Dana; the reviewer agent re-performed each review on rules and proposed notes; Riley dismissed each note with a reason and signed the three reviews (roll-forward round, retest round, control). Independence enforced: Dana, who signed the testing, cannot act as reviewer. | `10a-review-open-reviewer.png`, `-mobile.png`, `10b-reviews-signed.png` |
| 11 | Conclusion | ITGC-AC-01: concluded with exceptions on the signed-off review, final, progress CONCLUDED; D-001 REMEDIATED. | `11-final-conclusion.png`, `-mobile.png` |
| 12 | History and trace | Six sign-off records (three sheets, three reviews) read from the API, each with signer, time, note, version and plan revision; a `DELETE` on the sign-off table was refused by the database ("sign-off history is never deleted"). The trace rail reads "Every link has a record" from objective to review. | `12-trace-expanded.png`, `signoff-history.json` |

## Blocked actions observed

- Nothing was requested from the client before Dana approved the test plan (stage 2 → 3).
- The retest's samples could not be approved before its remediation evidence and
  population were received and the fixed control had operated for the minimum period
  (readiness blockers shown on the round until stage 9's evidence arrived).
- The deficiency stayed READY FOR RETEST after the retest passed, until the retest's
  independent review signed (stage 10): a reviewer's sign-off, not a tester's, remediates.
- Dana's sessions could not decide review notes or sign reviews (she signed the testing);
  Riley's could.
- The sign-off history could not be deleted.

## Remaining issues resolved in the same change

1. **Classic next-action panel** now takes the register's canonical next step (the same
   state the guided Needs-you card shows) as its primary action when it is the viewer's,
   or as the first "waiting" item when it is not. The architecture already carried the
   canonical state on the control row; the panel had derived its own.
2. **Retest testing basis**. A round now records its basis when it opens (plan revision,
   the control's approved attributes, the interim procedures carried forward, source,
   time); the round card shows it; a plan change after that makes the basis stale, the
   round's readiness names it, sample approval is refused, and a person confirms the
   basis against the plan as approved now (`POST …/test-rounds/{id}/basis`, with the
   confirmer and reason on record). The trace rail reads the retest's objective and
   procedures from the recorded basis. Migration 0093 adds the columns and backfills
   existing rounds; a backfilled basis is served as `RECONSTRUCTED`, worded as
   "reconstructed by migration 0093 from the plan as approved when basis records were
   introduced, not approved as this round's basis at the time", counts as stale (its
   round's readiness names it; sample approval is refused) until a person confirms it.
   The confirmation route requires `task.update` on the engagement, the round's current
   version (a changed round is refused), an open round, and records who confirmed, when,
   and the reason on the audit trail.
3. **Agent execution failures**. A tester run that stops after its retries leaves a note
   on the sheet (`run_note`, with the error class) and an activity event "Testing run
   stopped"; the sheet headline, the agent block and the classic lanes show "stopped"
   with running again as the recovery; results already recorded stand, and exceptions
   among them are testing findings, kept apart. The workpaper and review agents already
   recorded their stops; the tester now matches them.
