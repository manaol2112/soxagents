# Metrics rulebook

**Version 1.1, pending approval** (Milestone 8.20; revised 29 October 2026 at the product owner's direction after the Step 4B closure). The agent console's answers, the exports, and the PDF and Word reports (Milestone 8.21) work their figures out by these rules, in `services/api/ai_workforce_api/engagement_data.py`; the model never counts. Every answer and file says "Metrics rulebook v1.1, pending approval" until the product owner approves these rules.

Every figure is taken from the engagement's records in one read-only transaction (repeatable read), so totals and lists agree, and every answer and file states that moment as **as of** (UTC). Totals always cover every matching record, never only the page shown.

## Missing and empty

- **Not recorded**: the record does not hold the value (no owner, no testing phase, no recipient). It is shown as "Not recorded", never as zero or a guess, and counted where it matters (for example `phase_not_recorded`).
- **No match**: the filters matched nothing (`total` 0, `matching` "none"). That is an answer, not missing data.
- **Unavailable**: the records could not be read; the agent says so and gives no figure.

## Evidence requests

| Group | Request statuses |
| --- | --- |
| Draft | DRAFT |
| Awaiting approval | APPROVAL_PENDING |
| With the client | SENT, WAITING_FOR_RESPONSE, OVERDUE, ESCALATED |
| Partly received | PARTIALLY_RECEIVED |
| Received | RECEIVED; CLOSED with a received date |
| Closed without receipt | CLOSED with no received date |
| Cancelled | CANCELLED (left out of every count and list unless asked for) |

- **Pending** = Draft + Awaiting approval + With the client + Partly received (not yet received).
- **Future phase** (v1.1) = a request for the roll-forward phase that has not gone out (Draft or Awaiting approval). It is year-end work, counted in Pending and shown separately; it is not evidence outstanding against an interim conclusion.
- **Overdue** = With the client or Partly received, and the due date and time has passed at the as-of moment. A draft or a request awaiting approval is never overdue: it has not been sent.
- **Days overdue** = the as-of date minus the due date, in whole calendar days in UTC; 0 when it fell due earlier the same day.
- **Received but not reviewed** = files have arrived, and at least one evidence requirement the request carries has not been judged (sufficiency NOT_REVIEWED or UNDER_REVIEW). A file arriving never makes evidence sufficient.
- **Evidence type** = the categories of the evidence requirements the request carries (configuration, population, sample, and so on). Without a linked requirement it is "Not recorded".
- **Request date** = the date the request was created.

## Evidence requirements (v1.1)

Each evidence requirement of the approved plans (removed ones and those on cancelled requests left out) is in exactly one state, decided by precedence, so the states add up to the total:

| State | Rule |
| --- | --- |
| Waived | Status WAIVED |
| Accepted | Sufficiency ACCEPTED |
| Insufficient or follow-up required | Sufficiency INSUFFICIENT or FOLLOW_UP_REQUIRED |
| Received, not yet judged | A file is matched to it and no judgment is recorded |
| Requested, outstanding | Its request has gone out (not Draft or Awaiting approval) and nothing has come |
| Planned, not yet requested | Everything else: planned, waiting on a dependency, or on a request not yet sent |

The testing phase (design, interim, roll-forward) is a second dimension over the same requirements, reported beside the states and never added to them. "Intentionally open" is a team judgment, not a record: an item the team keeps open on purpose reads as "Requested, outstanding".

## Controls

Out-of-scope controls are left out of every count.

| Testing status | Rule |
| --- | --- |
| Complete | Concluded, final (every required phase and round tested and independently reviewed), review signed off, and no review note open |
| Awaiting roll-forward evidence (v1.1) | Test sheet signed off, conclusion reviewed with no note open, and only a roll-forward round (requested or in testing) keeps it from final |
| Awaiting review | Test sheet signed off; not yet complete for any other reason |
| In testing | Test sheet open and not waiting on evidence |
| Awaiting evidence | Evidence pending, or the test sheet waits on evidence |
| Not started | None of the above |

- **Completion rate** = Complete ÷ controls in scope. Concluding a control is not enough: its review must be signed off with no note open.
- **Interim result** (v1.1; the record's `test_result`) = the interim test sheet's signed-off result. It is the original testing outcome and is never rewritten.
- **Current result** (v1.1) = the result of the control's latest signed-off round (a retest or a roll-forward, in sign-off order); with no signed-off round, the interim result. Its basis (Interim, Retest n, Roll-forward n) is shown beside it.
- **Failed** (v1.1) = the current result is NOT_EFFECTIVE, or the conclusion records an exception (an open deficiency on a reviewed control). A control remediated and retested effective is no longer failed; its interim result still shows the original failure, and the report counts it under "Interim result not effective" and "Remediated and retested effective". A failed test is not a deficiency until someone logs and decides one.

## Exceptions and review

- **Open deficiency** = any status other than REMEDIATED or CLOSED. **Closed deficiency** (v1.1) = REMEDIATED or CLOSED, listed with the fix date, the retest result and the closing date as recorded. Severity is only ever shown as recorded: it is a judgment, never worked out here.
- **A failed test with no deficiency logged** (v1.1) = failed, and no deficiency, open or closed, is logged against the control. A closed deficiency counts as logged. It is listed separately, as an issue for the auditor to judge.
- **Open review note** = PROPOSED, OPEN, or RESPONDED.
- **Workpaper awaiting review** = PREPARED, and its control's independent review is not signed off.

## Data checks

Records that contradict each other are reported as they are, never corrected:

- marked OVERDUE although the due date has not passed;
- marked received with no evidence file linked (and not provided directly);
- not yet received with no testing phase;
- not yet sent with no recipient (it cannot be sent);
- concluded while evidence is still outstanding (v1.1: roll-forward requests not yet sent are left out of "outstanding");
- a failed test with no deficiency logged, open or closed;
- a test signed off while every evidence request for the control is still pending.

## Changes in version 1.1

For the product owner's approval. Each change keeps the original records visible and changes only how they are read:

1. The current result follows the latest signed-off round; the interim result stays as the original outcome. Before, a remediated and retested control read as failed for the rest of the engagement.
2. "Failed" reads the current result. "A failed test with no deficiency logged" counts closed deficiencies as logged.
3. "Awaiting roll-forward evidence" is split from "Awaiting review", which before held every reviewed control whose roll-forward round was waiting.
4. Closed deficiencies and remediation outcomes are counted and listed in the status report and the executive summary.
5. Evidence requirements are reported by state and by phase; roll-forward requests not yet sent are shown as future phase and left out of "evidence outstanding" on a concluded control.

## Known gaps, for approval

- Completion does not yet look at each testing phase separately (design, interim, roll-forward): a control has one conclusion, final once every required round is reviewed. A per-phase completion rate is still proposed.
- Older requests carry no testing phase; they are shown as "Not recorded" and flagged.
- Evidence type is known only for requests that carry evidence requirements.
- The report header's "data as of" is the moment the records were read (the clock). A demo engagement's narrative states its scenario date separately.
