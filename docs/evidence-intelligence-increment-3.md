# Evidence Intelligence Workspace — Increment 3 plan

The inline, contextual AI evidence assistant and the OCR citation correction. Proposed on
30 October 2026 for the product owner's approval; nothing in it is built. The brief and
increments 1 and 2 are in [evidence-intelligence.md](evidence-intelligence.md).

The rule the plan keeps: the assistant is the existing agent console, scoped to a control
and the evidence on screen. There is no second conversation store, no second model path,
and no second analysis of evidence. The agent reads records, narrates them with checked
citations, drafts, and proposes steps; every consequential step waits for a person.

## 1. What the auditor can do, and what it rests on

| Ability (the brief) | How it is met | Reused | New |
| --- | --- | --- | --- |
| Ask about the displayed evidence | A thread on the control, with the file, finding and request on screen as the message's *focus*; the agent reads the file through `read_evidence` and answers with checked citations | `console.py` turn loop, `AgentCaller` (job `console-lead`, BALANCED), `console_citations.resolve`, `read_evidence` | Thread scope and message focus (migration 0138); focus framing |
| Investigate findings without leaving the workspace | "Ask about this" on a finding opens the thread with that finding in focus; the agent reads the finding, its history and its passage | `evidence_findings.list_findings`, finding events | READ tools `list_evidence_findings`, `get_evidence_finding` |
| Go to the exact supporting source | A citation in an answer opens the file in the centre viewer at its page, sheet, row or cell; a citation on another file switches the navigator to it | `Citation` (file, quote, location), `EvidenceViewer`, the workspace's `show()` | Citation → viewer wiring; the OCR page fix so the page is the real page |
| Generate and revise follow-up questions | The agent drafts from the accepted findings (or the ones named), revises on request, and hands the text to increment 2's composer, where the person reviews and sends; "send it" is a confirmed step at most | `draft_follow_up`, `clean_follow_up`, `send_follow_up`, the composer | CONFIRM tools `prepare_follow_up` (opens the composer) and `send_follow_up` |
| Reanalyze when more evidence arrives | The agent proposes a re-read of the file named; the person confirms; the reading's own hooks reassess the open findings (increment 2) | `reread_evidence` (CONFIRM), `reassess_on_reading` | Nothing |
| Compare old and new assessments | Each reading that lands is kept as a version; a deterministic comparison shows what changed per requested item, gap and finding; the agent reads the same comparison | `evidence_analyses` (version), `evidence_mapping_runs` (every run kept), finding events | `evidence_assessment_versions` (migration 0138), `compare_assessments`, the "What changed" panel, READ tool `compare_evidence_assessments` |
| Propose actions that need approval | The agent proposes `decide_evidence_finding`, `send_follow_up`, `reread_evidence` as CONFIRM steps; they run only when a person confirms, under that person's rights, and are audited | `console_actions` (PROPOSED → DONE, `decided_by`), `Tool.check` | CONFIRM tool `decide_evidence_finding` |

## 2. Architecture

### 2.1 One agent, one caller, one thread model

The inline assistant is `console.py` with `console_tools.TOOLS`, run through
`provenance.AgentCaller` on the `console-lead` job (BALANCED tier, the engagement's call,
job and monthly budgets, trial reservations, provenance per attempt, sealed content).
Threads, messages and actions stay in `console_threads`, `console_messages` and
`console_actions`. The console page keeps working as it does; a control's threads also
appear there, under the control.

### 2.2 Scope and focus (migration 0138, part 1)

- `console_threads.control_id uuid NULL REFERENCES controls`, with an index on
  `(user_id, control_id)`. A thread with a control is that person's thread on that control;
  opening the workspace's assistant gets or creates it. Threads stay per person, as the
  console's are (recommended; see §8 for the alternative).
- `console_messages.focus jsonb NOT NULL DEFAULT '{}'`: the control, evidence file,
  finding and request on screen when the person asked, each checked to belong to the firm
  and project before the message is stored (404 otherwise). The focus is recorded, so the
  history shows what the person was looking at.
- `AskBody` gains `focus` (optional ids). `GET …/console/threads?control=` lists a
  control's threads; `POST …/console/threads` accepts `control_id`.

### 2.3 Framing: records, never file text

`SYSTEM_PROMPT` gains a focus block built from records only: the control's reference,
title and phase; the file's name, kind, reading status and the one-line summary of its
reading; the finding's title, kind, status and question; the request's phase and status.
No evidence text enters the system prompt. The agent reads text through `read_evidence`
(the untrusted-content block, `EVIDENCE_CHARS` 8,000), as it does today, so the
containment properties tested in `test_console.py` and `test_hostile_evidence.py` hold.

### 2.4 Tools

Registered in `console_tools.TOOLS` with a label, an argument schema, a risk and a
`check`, so `test_every_tool_is_registered_with_a_schema_and_a_risk` covers them.

| Tool | Risk | Does | Backed by |
| --- | --- | --- | --- |
| `list_evidence_findings` | READ | A control's findings, optionally for one file, request or status, with the summary by status | `evidence_findings.list_findings` |
| `get_evidence_finding` | READ | One finding with its citation, question, expected response and history | `list_findings` (one id) |
| `compare_evidence_assessments` | READ | What changed between a file's previous and current reading, or a file and the file it replaced, or the last two mapping runs | `compare_assessments` (§2.5) |
| `decide_evidence_finding` | CONFIRM | Accept, edit the question, dismiss, resolve, accept a clarification, more needed, not applicable (reason), escalate, reopen | `evidence_findings.decide` under the confirming person's principal; a reviewer's confirm answers 403 and the step is FAILED with the reason |
| `prepare_follow_up` | ROUTINE (writes nothing) | The draft message for the findings named, returned as text; the action card offers "Open in composer", prefilled | `draft_follow_up`, `clean_follow_up` |
| `send_follow_up` | CONFIRM | Send the consolidated follow-up on one request; the card shows the whole text; confirm sends it as the person | `evidence_findings.send_follow_up` (same refusals and audits as the composer) |
| `reread_evidence` | CONFIRM (exists) | Read the file again | unchanged |

Every tool's `check` runs before a proposal, so the person is never offered a step that
would fail (a finding not in a sendable status, a request of another control, a file whose
reading is confirmed).

### 2.5 Assessment versions and comparison (migration 0138, part 2)

A re-read today resets the reading in place (`restart_analysis`: version + 1, the
classification cleared), so nothing earlier remains to compare with.

- `evidence_assessment_versions`: `analysis_id`, `version`, `evidence_file_id`,
  `file_sha256`, `plan_revision`, `kind`, `summary`, `coverage jsonb` (per requested item:
  state and note), `gaps jsonb`, `follow_ups jsonb`, `period`, `application`, `source`,
  `model_call_id`, `created_at`; unique `(analysis_id, version)`; an immutable trigger;
  `refuse_archived_writes`. Written in `run_analysis` when a reading lands READY, where
  the findings are derived, idempotently (`ON CONFLICT DO NOTHING`).
- `compare_assessments(previous, current, findings_events)`: a pure function giving, per
  requested item, the state before and after; the gaps resolved, new and kept (matched by
  normalised text); the findings answered, stale, new and closed since (from
  `evidence_finding_events`); kind, period and application changes; the plan revision and
  file hash of each side. No model call.
- Lineage: a replaced file compares its first reading with the last version of the file
  it replaced (the version chain `evidence_versions` keeps). A mapping comparison uses the
  last two `evidence_mapping_runs` of the control, per approved attribute (identifier and
  code, as increment 2's findings do).
- Shown as the "What changed" panel (§3) and read by the agent through the tool.

### 2.6 Citations to the source

Answers already carry checked citations (`[^n]`, file id, quote, surrounding text,
location). The thread passes them to the workspace's `show()` as an `EvidenceCitation`,
which draws the box on the PDF page, marks the passage in read text, or selects the
sheet's cell. A citation on a file other than the one displayed selects that file in the
navigator first. The location's page is right once §2.7 is in.

### 2.7 OCR citation correction

`extract()` collects the images of scanned PDF pages into `Extraction.images` without
their page numbers; `with_ocr()` then labels them `[Page 1, read by OCR]`, `[Page 2, …]`
by their position among the scanned pages, after all the text pages, so `location_of`
reports the wrong page for any PDF that mixes text and scanned pages, and a scanned page
whose image could not be taken shifts the pages after it.

The fix: `Extraction.image_pages: tuple[int, ...]` (real 1-based pages, parallel to
`images`, default empty so every constructor stands); `extract()` fills it; `with_ocr()`
labels each OCR text with its real page and interleaves the text pages and OCR pages in
page order; images and `[Image n]` labels in Word documents are unchanged;
`location_of` needs no change. Texts stored before the fix keep scan-order pages until
the file is read again (the existing re-read; the plan adds no backfill, since OCR would
have to run again). A reading's `note` says when a scanned page had no image.

### 2.8 State and reloads

The thread reuses the console's poll (every 2 s while the agent works, stopped when it
settles) and `router.refresh()` only when an action settles; a confirmed
`decide_evidence_finding` refetches the findings through the existing
`useFindingsAction` path, so the finding's status and the "what changed" line update in
place. An approval or send shows success only after the server confirms it.

## 3. UI design

The three panels stay. The assistant lives in the right column and the bar below it:

- **The composer bar** (today's `ei-ask`) stays where it is, always one line with the
  suggested questions as chips. Typing or picking a chip opens the thread.
- **The thread** is a fourth tab of the right panel, "Assistant", opened when a question
  is asked and remembered per control. It shows the person's thread on this control:
  messages, the agent's answer as it is written (the console's live text), citations as
  numbered marks that open the source in the centre, and **action cards**.
- **Action cards**: the step's label, its summary in words (the finding's title, the
  decision, the request the message goes to), the full follow-up text when it is a send,
  and Confirm / Cancel. Pending shows as pending; done shows the server's result; failed
  says why and what to do (for a reviewer, that the decision is the preparer's).
  `prepare_follow_up` shows the draft with "Open in composer".
- **Finding detail** gains "Ask about this" (focus = the finding) and, when a previous
  version exists, "Compare with previous reading".
- **"What changed" panel** in the AI analysis tab when a file has an earlier version: a
  compact table (item, before → after), the gaps resolved and new, the findings answered
  and stale, and a fold with the previous reading's summary. Deterministic, drawn on load,
  no model call.
- **Suggested questions** come from the records: the findings' questions, "What changed
  since the last reading?", "Why is item n partially supported?", "Draft a follow-up for
  the accepted findings". They are text to send, never answered in advance.
- **Console page**: a control's threads are listed under the control's reference; the
  thread opens there too, with the same component.

Standards: keyboard operable; 1440, 1366 and 390 wide (the thread stacks under the
panels at 1040 and below as the tabs do); dark theme; motion within the design system's
durations and off under reduced motion; copy in the neutral client-facing voice, no agent
first person; the UI acceptance checklist in `design-system.md` §"UI acceptance checklist".

Web code: `console-chat.tsx` is split so the thread (messages, live text, citations,
action cards, composer) is one component, `ConsoleThread`, used by the console page and
the workspace; the console page keeps its greeting, panel and inbox around it. No second
chat implementation. New pure models (`console-focus-model.ts`, `assessment-compare-
model.ts`) carry the logic, tested with node:test.

## 4. Dependencies

No new runtime dependency, UI framework, state library or animation library. Reused:
`console.py`, `console_tools.py`, `console_citations.py`, `provenance.py`,
`evidence_findings.py`, `evidence_analysis.py`, `evidence_mapping.py`,
`evidence_extraction.py`, `rate_limit.py` (the throttle windows), `subscriptions.py`
(trial reservations), `ConsoleChat`, `EvidenceViewer`, `EvidenceIntelligence`,
`playwright-core` (already a development dependency, for acceptance). One migration,
0138, with the two tables and columns above.

## 5. API cost controls

Measured so far: one evidence read on the FAST tier costs about 1,579 micro-dollars
($0.0016); the structured calls recorded on the review and development databases average
about 37,000 micro-dollars, most of them BALANCED-tier agents. A console turn is not yet
measured here; on BALANCED with two tool reads (about 8,000 to 12,000 input tokens and up
to 800 output tokens) the tier's prices give roughly $0.02 to $0.04 a turn. Increment 3D's
acceptance measures it and records the figure in `metrics.md`.

Controls, in order of effect:

1. **Nothing runs without a person's message.** No model call on page load, on polling,
   on selecting a file or a finding, or when a reading lands. The insight, the coverage,
   the comparison and the "what changed" line are deterministic.
2. **Reanalysis is confirmed and targeted**: one file, by the person, through the
   existing re-read; the hooks that follow are deterministic.
3. **Context discipline**: records in the framing, text only through `read_evidence`
   with its cap; tool results capped (`RESULT_CHARS`); the history starts at a question
   and is capped as today.
4. **Budgets unchanged and applied**: call, job and month budgets, the trial's AI
   budget and run reservations, all on the `console-lead` job; a turn over budget answers
   with the existing budget notice and makes no call.
5. **A per-person turn throttle**: `CONSOLE_TURNS_PER_HOUR` (default proposed 30),
   kept in `rate_limit.py`'s database windows, failing closed, 429 with Retry-After, with
   the trial's quiet period (`trial_ai_quiet_seconds`) as today.
6. **Tier**: `console-lead` stays BALANCED; nothing on DEEP; drafting a follow-up is
   deterministic text first (`draft_follow_up`), the model revises only when asked.
7. **Visibility**: spend by operation stays in the automation route and the trial usage
   tab; the thread shows "n turns this hour" when within 5 of the limit.

## 6. Security safeguards

- **Authorization**: each tool runs as the asking or confirming person; the decision
  tool calls `evidence_findings.decide` (project update, a person only), so an independent
  reviewer can read and ask but cannot decide or send, and the console records the failed
  step with its reason. Focus ids are checked to the firm and project; another firm's ids
  answer 404 (`test_evidence_findings` pattern).
- **Approvals**: deciding, sending and re-reading are CONFIRM steps; the agent never
  accepts, closes, sends or re-reads on its own; the reader's reassessment keeps proposing
  ANSWERED only (increment 2's invariant, kept by the same tests).
- **Untrusted content**: evidence text reaches the model only inside the untrusted block
  of `read_evidence`; a citation is shown only after `resolve` checks the quote against
  the stored text (`unchecked_hidden` while streaming); follow-up text passes
  `clean_follow_up` (links and credential requests refused) whichever path sends it.
- **Containment**: tools are the only effects; arguments are validated by schema before
  anything runs; `check` runs before a proposal; the live provider refuses any unmetered
  call. No file content can name or run a tool.
- **Audit and integrity**: `console_actions` keeps `decided_by` and `decided_at`;
  `evidence.finding_decided` and `evidence.follow_up_sent` are written by the same
  functions the UI uses; assessment versions and finding events are append-only; the
  archived-engagement guard covers the new table; findings and threads are never deleted.
- **Data handling**: no tokens, keys or secrets logged; prompts and answers sealed under
  the existing content key and retention; the focus stores ids, not text.
- **Trials**: the subscription gate (402 after expiry) and reservations apply to turns.

## 7. Acceptance tests

Python, added to `make test-critical` (model-execution safeguards and approvals):

- `test_console_workspace.py`: a thread per person per control, found again on the next
  visit; a focus of another firm answers 404; the framing holds the records and no file
  text (the scripted provider asserts its system prompt); every new tool is registered with
  a schema and a risk; `list`/`get` findings respect the firm and project;
  `decide_evidence_finding` is proposed, runs only on confirm, changes the finding and
  writes the audit; a reviewer's confirm answers 403 and the step is FAILED with the
  reason; `prepare_follow_up` returns a draft and sends nothing; `send_follow_up` is
  proposed with the full text, refuses links, and once confirmed is the same message and
  audits as the composer; `reread_evidence` proposes and nothing is read until confirmed;
  a turn is recorded on `console-lead` at the BALANCED price; the hourly throttle answers
  429 and the trial's exhausted budget answers with the notice and no call; a finding
  decided from the thread shows the person, never the agent, as the closing actor.
- `test_assessment_versions.py`: a version written when a reading lands, once;
  a re-read keeps the previous version and adds the next; the comparison's cases (an item
  from partly covered to covered, a gap resolved, a gap new, a gap kept, a finding
  answered and one stale, a kind or period change, a replaced file against the file it
  replaced, the last two mapping runs per attribute); versions are immutable; archived
  engagements refuse writes.
- `test_evidence_reading.py` additions for the OCR fix: a synthetic PDF with a text page
  1, scanned pages 2 and 4 and a text page 3 labels `[Page 2, read by OCR]` and
  `[Page 4, read by OCR]` in page order, and `location_of` gives the real page; a scanned
  page without an image does not shift the pages after it and is named in the note; an
  image-only PDF and a Word document with images read as before; a finding derived from
  an OCR'd passage cites the real page; a file read before the fix is corrected by the
  re-read.

Node (`make test-fast`): `console-focus-model.test.ts` (the focus from the workspace's
selection, the suggested questions, action card states, citation to viewer mapping, the
turn-limit notice), `assessment-compare-model.test.ts` (the rendering of each comparison
case, empty and first-reading states), additions to
`evidence-intelligence-model.test.ts`.

UI acceptance with Playwright (the review stack, synthetic Northstar data) at 1440×900,
1366×768 and 390 wide, light and dark: ask, answer with a citation, the citation opens
the page; a proposed decision confirmed changes the finding only after the server answers;
the draft opens the composer prefilled; the "What changed" panel after a re-read;
keyboard path through the card; no horizontal overflow, no clipped text, reduced motion
honoured. Screenshots to `docs/review/evidence-workspace/`.

Closure (Tier 2): targeted tests, `make test-fast`, `make test-critical`, migration
validation (0138 applied on the development and review databases, `test_migrations`
lists), biome, tsc, ruff, mypy; the console turn cost measured and recorded.

## 8. Implementation increments

Each one is reviewed and approved before the next starts.

| Increment | Scope | Size | Acceptance |
| --- | --- | --- | --- |
| 3A | OCR citation correction (§2.7), API only; applied to the development database's readers by re-read on request | Small | The OCR tests above; existing reading tests unchanged; a scanned PDF on the review stack cites its real page |
| 3B | Assessment versions and the comparison (§2.5; migration 0138 part 2), the `compare_evidence_assessments` tool, the "What changed" panel and "Compare with previous reading" | Medium | `test_assessment_versions.py`; compare model tests; the panel at both viewports |
| 3C | The control-scoped assistant on the API (§2.2–2.4; migration 0138 part 1): thread scope, focus, framing, the finding and follow-up tools, the turn throttle | Medium | `test_console_workspace.py`; console tests unchanged; cost recorded per turn |
| 3D | The inline thread in the workspace (§3): `ConsoleThread` shared with the console page, the Assistant tab and composer bar, action cards, citations into the viewer, "Ask about this", the console page listing control threads; Playwright acceptance; `metrics.md`, `evidence.md`, `operations.md` updated | Large | The Playwright run; the UI acceptance checklist; `make test-fast` and `make test-critical` green |

Migration 0138 ships in one file with both parts, applied at 3B; 3C adds no migration.
If 3B and 3C are approved together, the file is written once.

Decisions for the product owner before 3C:

1. **Thread scope**: per person per control (recommended; consistent with the console,
   a person's questions stay theirs, every decision is still on the shared records and
   audit) or one shared thread per control (every member sees every question; needs a
   visibility rule for drafts and a different history model).
2. **Sending from the thread**: the composer only (recommended default; the person
   reads the whole message where they edit it), with the confirmed `send_follow_up` step
   available when the person asks the agent to send, or the composer only and no send
   tool at all.
3. **Turn throttle default**: 30 turns per person per hour, or another figure.
4. **3A first**: ship the OCR correction on its own before 3B (recommended; small,
   independent, fixes a known defect in citations the workspace already shows).

## 9. Limitations and risks

- The assistant narrates records; it does not re-read or re-map evidence on its own, so
  an answer about a file whose reading is stale says so and offers the re-read step.
- Scanned PDFs read before 3A keep scan-order page labels until read again.
- A long thread's cost grows with its history; the console's history cap bounds it, and
  the throttle bounds the hour.
- The thread shares the right column's width; long answers scroll inside the tab, and at
  1366 wide the column is 328 px, so action cards are designed for that width first.
- `console_actions` arguments are fixed at proposal; revising a drafted message means
  asking again or editing in the composer, never editing the proposed step in place.
