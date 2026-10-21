# Independent review

Phase 9 is the independent review of each control instance: a second look at the testing, the workpapers, and the deficiency decision by someone who did not do the work. Milestone 9.1 builds the review record, the reviewer agent's re-performance, review notes, and the reviewer's sign-off.

## Development switch: `REVIEW_INDEPENDENCE_REQUIRED`

Independence is enforced by default (`REVIEW_INDEPENDENCE_REQUIRED=true`, `independence.py`): only a team member with the reviewer role decides notes and signs off a review, never on work they tested or prepared; only the reviewer decides a deficiency change, never one they requested; and setup needs a named independent reviewer. Setting it to `false` is for development only: anyone on the engagement team can act as the reviewer, including on their own work; one person can hold several engagement roles at once (lead, preparer, and reviewer; extra roles live in `project_member_roles`, migration 0046, and each role card removes just that role); setup stops asking for a separate reviewer; and the Team step and every review panel show a warning that the checks are off. Approvals of client-facing actions keep their own rule either way: the requester never approves. The value is read when the API starts.

## One review per control instance (9.1)

Each control instance (see [controls per application](onboarding.md#controls-per-application-85)) has one review (`control_reviews`, migration 0042, `control_reviews.py`). It opens when the control's **operating effectiveness workpaper is prepared**, which can only happen once its testing is signed off. Preparing it again later, after the testing was reopened, re-performs the review.

The review covers, together: the signed-off test sheet, both workpapers, and the deficiency decided from the testing. The control's register row shows **In review** while it is open, and the plan's "Independent review" task is under way; signing the review off completes the task and concludes the control.

## The reviewer agent re-performs the testing

When the review opens, the independent reviewer agent re-performs the testing in the background (the local worker, or the `control_review` workflow on Temporal):

- **Reviewed rules in code** check the sample size against the standard table for the control's frequency, every passed attribute without a cited passage, every result a person set to pass where the tester saw an exception, empty narrative sections in the effectiveness workpaper, a missing or unprepared design workpaper, and the deficiency decision (exceptions found but the proposed deficiency dismissed or undecided).
- **Claude re-performs each tested item** from the item's evidence, with the same prompt shape and schema as the tester but as the reviewer, and never sees the tester's results. Its results are checked the same way (only the control's attributes; citations kept only where the words are in the file). Where its result differs from the final one, it proposes a note: **must fix** when it found an exception the test passed, **should fix** when it could not tell or found an exception met, and an **observation** elsewhere. The note carries the reviewer's own checked citations.

Without a model, the rules run and the review says a person re-performs by hand. At most 30 items are re-performed. Every re-performance withdraws the agent's earlier proposals that nobody decided, records its source, the sheet version it looked at, and its model call.

Since Milestone 3a the reviewer's calls run on the DEEP tier through the agent caller, each recorded with its provenance and attributed to the independent reviewer's instance in the audit trail. The re-performance's source is `MODEL` when the model re-performed at least one item (the note counts any items it could not), `FALLBACK` when every model call failed (the rules' checks stand on their own and the note names the failure), or `RULES` when no model is configured. A reviewer can cancel a running re-performance (`POST …/agent-runs/review/{id}/cancel`); re-performing again is the recovery.

## Review notes

A note (`review_notes`) is about a test result, the sample, a workpaper, the deficiency, or the control in general, with a severity: must fix, should fix, or observation.

- The agent's notes are **proposed**. The engagement reviewer **accepts** one (it is open for the preparer) or **dismisses** it with a reason.
- The reviewer can **raise** their own note; it is open at once.
- Accepting or raising a **must-fix** note **reopens the work it is about**, with the note as the reason: a result or sample note reopens the test sheet and the effectiveness workpaper prepared from it; a workpaper note reopens that workpaper. A sheet whose deficiency is logged cannot be reopened; the note says so and is answered instead.
- The preparer (anyone who can update the engagement) **answers** an open note. The reviewer **clears** it, or **returns** it with what is still missing.
- Every note keeps who raised, decided, answered, and cleared it, and when; dismissed and withdrawn notes stay on the record.

## Sign-off

A team member with the **reviewer engagement role** signs the review off, and only when: the testing is signed off; the effectiveness workpaper is prepared; the re-performance has run on the current version of the sheet; and no note is proposed, open, or answered but not cleared. **Nobody reviews their own work**: the person who signed off the testing or prepared a workpaper cannot sign off its review, even with the reviewer role. A signed-off review can be reopened by a reviewer with a reason.

Routes: `GET /reviews`, and `POST /reviews/{id}/reperform`, `/notes`, `/notes/{note}/decide`, `/notes/{note}/respond`, `/notes/{note}/clear`, `/sign-off`, `/reopen`. The web app shows it on the control's **Review** tab. Every re-performance, note, decision, answer, clearing, sign-off, and reopening is in the audit trail (`control_review` events).

## The register

After testing is signed off, the control's next step reads: prepare the workpapers for review; the reviewer is re-performing the testing; decide the reviewer's notes; address the review notes; clear the answered review notes; sign off the review. A reopened sheet comes first again.

## Across the engagement (9.2)

- **The dashboard** shows the independent review as a whole: how many control instances are not started, being re-performed, waiting for notes to be decided, answered, or cleared, ready to sign off, and signed off, with the open notes. It links to the Controls register's **In review** queue, which lists every instance whose review waits for a person.
- **Completion.** The standard calendar has an "Independent review complete" milestone (`REVIEW_COMPLETE`, in the interim testing phase). It is marked done, by the signing reviewer, when every in-scope control instance's review is signed off, and undone when a review is reopened or a new one opens. Engagements laid out before 9.2 get the milestone when their calendar is laid out again.
- **The agent console** reads a control's review (`get_review`: the re-performance, every note with its status and citations, what blocks sign-off, and whether you are its reviewer or prepared the work), re-performs it (routine), and proposes, for the person to confirm: deciding a proposed note, raising a note (a must-fix note reopens the work), answering a note, clearing or returning it, and signing the review off (`sign_off_control_review`). Each runs as the person, with the same rules as the page: only the engagement reviewer decides, clears, and signs off, and never on work they prepared. The console's inbox lists the reviews that wait on a person.
