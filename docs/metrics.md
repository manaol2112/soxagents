# Metrics rulebook

**Version 1, pending approval** (Milestone 8.20). The agent console's answers, the exports, and the PDF and Word reports (Milestone 8.21) work their figures out by these rules, in `services/api/ai_workforce_api/engagement_data.py`; the model never counts. Every answer and file says "Metrics rulebook v1, pending approval" until the product owner approves these rules.

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
- **Overdue** = With the client or Partly received, and the due date and time has passed at the as-of moment. A draft or a request awaiting approval is never overdue: it has not been sent.
- **Days overdue** = the as-of date minus the due date, in whole calendar days in UTC; 0 when it fell due earlier the same day.
- **Received but not reviewed** = files have arrived, and at least one evidence requirement the request carries has not been judged (sufficiency NOT_REVIEWED or UNDER_REVIEW). A file arriving never makes evidence sufficient.
- **Evidence type** = the categories of the evidence requirements the request carries (configuration, population, sample, and so on). Without a linked requirement it is "Not recorded".
- **Request date** = the date the request was created.

## Controls

Out-of-scope controls are left out of every count.

| Testing status | Rule |
| --- | --- |
| Complete | Concluded, independent review signed off, and no review note open |
| Awaiting review | Test sheet signed off; not yet complete |
| In testing | Test sheet open and not waiting on evidence |
| Awaiting evidence | Evidence pending, or the test sheet waits on evidence |
| Not started | None of the above |

- **Completion rate** = Complete ÷ controls in scope. Concluding a control is not enough: its review must be signed off with no note open.
- **Failed** = the control's conclusion is EXCEPTION, or its test sheet's signed-off result is NOT_EFFECTIVE. A failed test is not a deficiency until someone logs and decides one.

## Exceptions and review

- **Open deficiency** = any status other than REMEDIATED or CLOSED. Severity is only ever shown as recorded: it is a judgment, never worked out here.
- A failed test with no deficiency logged is listed separately, as an issue for the auditor to judge.
- **Open review note** = PROPOSED, OPEN, or RESPONDED.
- **Workpaper awaiting review** = PREPARED, and its control's independent review is not signed off.

## Data checks

Records that contradict each other are reported as they are, never corrected:

- marked OVERDUE although the due date has not passed;
- marked received with no evidence file linked (and not provided directly);
- not yet received with no testing phase;
- not yet sent with no recipient (it cannot be sent);
- concluded while evidence is still outstanding;
- a failed test with no deficiency logged;
- a test signed off while every evidence request for the control is still pending.

## Known gaps, for approval

- Completion does not yet look at each testing phase separately (design, interim, roll-forward): a control has one conclusion. A per-phase completion rule needs the roll-forward round's sign-off counted; proposed for approval with 8.21.
- Older requests carry no testing phase; they are shown as "Not recorded" and flagged.
- Evidence type is known only for requests that carry evidence requirements.
