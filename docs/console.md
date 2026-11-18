# Agent console

The engagement opens on the agent console. A person tells the workforce what they want in plain language. The lead agent answers from the engagement's records, does routine work at once, and brings everything else back as steps the person confirms.

## What a person sees

The console is the page: one reading column on an open canvas, the composer held at the bottom of the window, and a side panel of chats and what needs the person. On a wide screen the panel sits beside the chat and can be tucked away (remembered per person); narrower, it slides over the chat and closes with Escape. A new chat opens on a greeting with the composer in the middle and suggestions under it. The page follows the latest words while the person reads the end, and leaves them be when they scroll up, with a button to jump back to the latest.


- **The conversation.** Questions and instructions in, briefings and plans out. The agent leads with the answer, cites control IDs, request IDs, and file names. An answer reads like a document, not a chat bubble: headings, numbered and bulleted lists (one level nested), tables, inline code and code blocks, quotes, bold and italics, and links. A link opens only to the web or to a page of this app; any other target shows as plain words. The person's own messages are on the right.
- **Steps to confirm.** A proposed action shows as a numbered step with what it does and what it touches (for example "Submit the evidence request for approval: ITGC-AC-02"). Each step has **Approve** and **Skip**; several have **Approve all**. A step shows who confirmed it and whether it ran.
- **Answer actions.** Under each answer: **Copy** (plain text; tables paste into a sheet), **Read aloud** (the browser's own speech, on the device; the text goes nowhere else), and on the latest answer **Retry**. A message of yours can be copied too.
- **Routine work.** Work the agent did at once (a redraft, a reread, a sample proposal) is listed under its reply.
- **Waiting on you.** Approvals another person asked for, samples to approve, screenshot reviews to sign off, and drafted requests.
- **Agent activity.** What the agents did recently: drafted, read, reviewed, proposed.
- **Conversations.** Every conversation stays available, grouped by when it last moved (Today, Yesterday, Previous 7 days, Previous 30 days, Older), named after its first message. **New conversation** starts a fresh one (an empty one is reused), and any earlier one opens again from the list. Each person sees only their own.

A question gets an answer, not steps: the agent stays on the question's subject and proposes nothing. If something on that subject needs doing, it ends with one line naming the next step, which the person can ask for. When the person asks it to do something, or asks what to do next, it proposes the steps in the same turn, with the wording or values filled in, instead of asking. Steps run in the order proposed, each on the latest state, so dependent steps (reword a draft, then submit it) go in one plan.

The registers and records (Controls, Evidence, Deficiencies, Plan) stay as reference views.

## How a turn runs

Sending a message stores it and starts an agent turn in the background (the local worker, or the `console_turn` workflow on Temporal). One message is answered at a time per conversation; the person can write the next message while the agent answers. The chat sends without reloading the page and shows what the agent is doing ("Opening ITGC-AC-01").

**The answer appears as the agent writes it.** The model's text streams (`converse_streaming`, a `StreamingChatProvider`). The turn saves the answer so far on its message at most every quarter second, while the message is still being worked on, so a settled answer is never overwritten; the chat fetches the conversation every half second while an answer is being written and reveals new words at reading pace. Citations are never shown before they are checked: while the answer is written, citation markers, whole or half written, are left out (`unchecked_hidden`); the finished answer, with its checked citations, replaces the draft. A table row still being written waits for its end, and bold or code that is open shows closed. Words from a model attempt that broke off are taken back before the turn tries again, and a turn picked up again after a stopped worker starts from an empty answer. Saving the draft never fails the turn. A provider that does not stream still shows each reply's text as it completes. A control with one instance per application is named with its application ("ITGC-AC-01 · Oracle", "ITGC-AC-01 (Oracle)", or "ITGC-AC-01 for Oracle"); the bare ID is refused with the instances to choose from.

When the model is busy (overloaded, a server error, a rate limit, a dropped connection), the turn tries again after 2 and then 6 seconds. A request the model rejects is not sent again. If no attempt gets through and nothing ran, the answer is marked failed with the reason and a **Retry** button. Only the latest settled answer can be retried, by the person who asked. An answer that did nothing is redone in place. An answer with steps stays on the record: its unconfirmed steps are cancelled and a new answer follows, and the agent sees only the newer one. Failed calls are logged with their kind and status code only.

The lead agent is Claude, through the provider-neutral chat interface in `models.py` (`ChatProvider.converse`). In a turn it can call tools up to eight times. Every model call is recorded with its token use. Without a configured model, the console says so.

The agent sees the last twelve messages of the conversation, starting at a question (never part way into an earlier answer, whose tool results would have no calls before them), and a short snapshot of the engagement. The conversation is not the system of record: every effect lands in the engagement's own tables and audit trail.

## Questions about the engagement, and files

Milestone 8.20. The agent answers questions about where an engagement stands from its records, through read tools that work the figures out by the [metrics rulebook](metrics.md), never by the model:

- **Engagement status** (`engagement_status`): controls in scope and their testing status with the completion rate and its rule, evidence pending, overdue, and received but not reviewed, open deficiencies and failed tests, open review notes, missed milestones, the blockers with the records behind them, and data checks.
- **Evidence requests** (`list_requests`), **controls** (`list_controls`), **exceptions** (`list_exceptions`), and **open review items** (`list_review_items`), filtered by status or status group, testing phase, application, owner, process, control, overdue only, review state, or text. Totals and counts cover every match; rows come a page at a time, compact enough to fit the answer, and the rest is offered as a next page or a file.
- Each answer says when the records were read (as of) and names the records behind each claim. A value the records do not hold is "Not recorded", never zero. Records that contradict each other are reported, not corrected.
- Another engagement the person can open in the same firm can be named (`engagement`); a name that fits several, or none, is answered with the choices. Another firm's engagements are never found.
- A follow-up keeps the filters already in use, because the agent sees its earlier calls and their filters.

**Files.** `export_records` makes an Excel (xlsx) or CSV file of evidence requests, controls, exceptions, or review items, with the same filters as the answer, and the answer shows it as a file with its download (`/workspace/exports/{id}`). The file is built from one read, checked (its rows are exactly the records counted, every column present), stored, and only then recorded and offered, so a link never points at nothing. The Excel file has an About sheet: engagement, client, filters, record count, data as of, who made it and when, the rules, the source, and the data checks. Text from clients and owners stays text: a cell is never a formula. Files are kept for 30 days for anyone who can see the engagement; then their bytes are removed (410 on download) and the record stays (`engagement_exports`). Making and downloading a file are audited (`export.created`, `export.downloaded`). Neither changes the engagement's records.

**Reports.** Milestone 8.21 (`reports.py`). `generate_report` makes a PDF (or an editable Word file) from the same records: the **engagement status report** (overall status, scope, testing progress, evidence requests with every overdue one, open exceptions, outstanding review items, blockers, and next actions), the **pending evidence tracker** (each pending request with its control, application, phase, evidence type, owner, request and due dates, status, days overdue, and follow-up; filterable like the list), the **control testing summary** (each control's testing status, evidence pending by phase, result, workpapers, review, and next step), the **exceptions and remediation report** (deficiencies as recorded and failed tests with no deficiency, with remediation owner, target date, and what is outstanding), and the **executive summary** (progress, accomplishments, outstanding items, risks and blockers, decisions needed, milestones, and limitations). Every report opens with what it covers and when the records were read, and ends with its data checks and an "About this report" section (source, scope, rules). Before it is saved, every table is checked to hold exactly the records counted; a report that does not add up is not saved. The agent may add a short narrative: it is printed in its own section, "AI-written summary", marked as an interpretation that is not verified, and kept with the file's record. Reports are stored, offered in the answer, kept 30 days, and audited like exports. In PDFs, typographic punctuation is printed in plain form (| - ...) so the text copies and searches cleanly, and characters the PDF fonts cannot draw (for example non-Latin scripts) print as "?"; Word files keep them.

## Tools

Tools are registered in `console_tools.py` with a schema and a risk class. Only registered tools with valid arguments run.

| Risk | Runs | Tools |
| --- | --- | --- |
| Read | At once | Engagement status, list controls, list exceptions, list open review items, open a control (definition, attributes, requests, every evidence file with what was read from it and its screenshot review, the test plan and samples, deficiencies), open a control's independent review, read evidence text, list requests, list deficiencies, read the plan, list pending approvals |
| Routine | At once, listed on the reply | Export to a file, make a PDF or Word report, redraft a request, read a file again, propose samples, re-perform a review |
| Confirm | When the person confirms, as that person | Edit a draft request (its wording, the email address it goes to, or both), draft a new request or follow-up, mark a request partly received, received, or closed (or cancel it with a reason), submit a request for approval, send an approved request, decide an approval, approve samples, replace a sample, confirm an evidence kind, sign off a screenshot review, log a deficiency, decide, raise, answer, clear, or return a review note, sign off a control's independent review, change phase dates, change a milestone |

A step that would fail is never proposed. Before a step is offered, its tool checks it against the engagement as it stands, and as the earlier steps of the same plan will leave it: submitting a request needs a recipient whose address is allowed and wording that fits in one email (about 3,800 characters with the template), or, when it is longer, every item in brief with the secure link to the full request ([pbc.md](pbc.md)). A refused step goes back to the agent with the reason ("The request for ITGC-SF-02 has no recipient. Set the owner's email address first."), and the agent tells the person what is missing and proposes the fix when it can, for example editing the draft to shorten it or to set the recipient. It never guesses an email address. When a confirmed step still fails (things changed after it was proposed), it says why in plain words, under "Approved by …, but it did not run".

A confirmed step calls the same service function as the page, with the same authorization: a role without rights fails safely and says so, an approval still needs a second person, and live email stays off unless configured. A step is claimed before it runs, so confirming twice cannot run it twice. Each step commits on its own; in **Confirm all**, the first failure stops the rest. At most 25 steps are proposed in one turn.

## Safety

- Evidence text returned to the agent is marked as client data, and the agent is told to ignore instructions inside it.
- Tool results are bounded (24,000 characters; evidence text 8,000 at a time).
- The agent cannot change permissions, approve its own requests, or run anything unregistered.
- Routine tool runs and confirmed steps are audited (`console.tool_ran`, `console.step_confirmed`), with the tool and outcome, not the content.

## Citations

When an answer relies on what an evidence file says, the agent reads the file (`read_evidence`) and quotes the exact words: `[cite:<evidence_file_id> "the exact words"]`. Before the answer is saved (`console_citations.py`), each quote is looked up in that file's stored text, in this engagement only, matching loosely on spacing, case, quote marks, and dashes but never on words. A quote that is found becomes a numbered source; one that is not, or that names a file outside the engagement, is removed, so an answer never shows a citation the file does not support. Each source keeps the quote, the passage around it, and where it is: the page of a PDF, the sheet of a workbook, an image, or "Screenshot, read by OCR".

In the chat, each source is a numbered chip in the text. Opening it shows the file, its location, and the passage with the quote highlighted, with a link that opens the file on the Evidence page. Every answer with sources ends with a **Sources** list. Copying an answer keeps the numbers as [1]; reading aloud leaves them out.

`get_control` lists every evidence file in brief (kind, application, summary, review verdict) so none is cut off; `read_evidence` gives one file in full, with its reading and screenshot review. An answer is everything the agent said in its turn, across tool calls, not only its last words.
