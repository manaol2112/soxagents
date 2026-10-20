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

Rebuilding the demo database: the builder script lives outside the repository (it drives
the test fixtures); the API is pointed at `ai_workforce_demo` with the test environment
(independence required, no model, no worker, no live email).
