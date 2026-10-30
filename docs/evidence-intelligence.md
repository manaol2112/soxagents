# Evidence Intelligence Workspace

The control's Request step as an evidence review workstation (asked for by the product
owner on 30 October 2026, from two reference screenshots and a brief). The person always
sees three things: what the agent found, what is still missing, and what to do next.

This document records what existed before the work, the gaps against the brief, the
increments in which the gaps are closed, and the status of each. It is the implementation
documentation the brief asks for; the decisions are summarised in `phase-plan.md`.

## 1. What existed (reused, not rebuilt)

| Capability | Where | Reused as |
| --- | --- | --- |
| Upload (team and portal), multi-file, drag and drop, batches, hash de-duplication, custody check | `evidence_intake.py`, `evidence_portal.py`, `evidence-intake.tsx` (`RequestUpload`) | The navigator's drop zone |
| The evidence reader: one analysis per file (`evidence_analyses`): kind, summary, reason, coverage of each requested item with a note, up to six gaps ("what a person should follow up"), period, application; `PENDING → WORKING → READY | FAILED`; re-read; confirm kind | `evidence_analysis.py`, `evidence_classify.py`, `analysis-view.tsx` | The AI analysis tab's summary and coverage; the Details tab |
| Model calls through one caller: budgets, trial reservations, provenance, sealed content, untrusted-content prompts, deterministic line guards | `provenance.py`, `testing_checks.py` | Unchanged |
| Evidence-to-attribute mapping: per approved attribute, verified passages located to a page, sheet, row and cell; facts, inferences, missing, conflicts, concerns; stale on plan revision, attribute change, file replacement | `evidence_mapping.py`, migration 0096–0099 | Traceability tab; findings with citations |
| Preview: PDF pages drawn by pdf.js with cited passages boxed; images; the read text of spreadsheets and documents with passages marked | `evidence-preview.tsx`, `evidence-preview-model.ts` | The centre panel, now inline (`EvidenceViewer`) |
| A person's disposition of a requirement: Accept, Insufficient, Follow up (with a note), Not applicable, Restore; link a held file; policy on file | `evidence_plans.py` (`set_sufficiency`), `evidence-plan-view.tsx` | The decision bar of the AI panel |
| Client channel: portal answers, messages and uploads; team messages that email the owner a fresh link; email replies matched to requests | `portal_workspace.py`, `request_details.py` | Follow-ups travel on it (increment 2) |
| Approvals for sends, reminders (`pbc_follow_ups`), the control's Approve and send | `outbound.py`, `followups.py`, `control-send.tsx` | Unchanged |
| The agent console with citations and the `ask` hand-off from a control | `console-chat.tsx`, `control-rail.tsx` | The workspace's assistant bar (increment 1); inline thread (increment 3) |

## 2. Gaps against the brief

1. **Layout.** The step was a list of requests beside one request's panel; the file, the
   reading and the decision were three clicks apart, and the preview was a modal.
2. **Findings are strings.** The reader's gaps and the mapping's missing, conflicts and
   concerns exist, but not as records a person can accept, edit, dismiss, send and resolve,
   with history.
3. **No follow-up loop.** "Follow up" writes a free-text note on the requirement; nothing
   links a client's answer or a later upload back to the point it answers.
4. **No citations on reader findings.** The reader returns no quotes, so a gap cannot open
   the passage. The mapping does, but only on the Test step.
5. **No deterministic checks** for placeholders, an unestablished version or effective
   date, or a period outside the phase's window.
6. **Coverage vocabulary.** Covered, partly covered, not covered; the brief's states
   (supported, partially supported, not supported by reviewed evidence, conflicting,
   requires clarification, not yet assessed) were not shown anywhere together, and no
   coverage figure carried its denominator.
7. **Assistant.** Questions leave the page for the console; nothing proposes an action.
8. **Known defect.** OCR'd PDF pages are numbered by their position among the scanned
   pages, not their real page (`evidence_extraction.with_ocr`).

## 3. Increments

### Increment 1 — the workspace on the data that exists (no schema change)

Status: **built 30 October 2026, awaiting review.**

- `evidence-intelligence-model.ts` (pure, tested): the navigator (phases, items, files,
  what needs a person), and for the selected file an *insight*: its reading status, the
  summary, coverage rows with the brief's states and a denominator ("n of m items this file
  was read against"), findings (the reader's gaps and uncovered items; the mapping's
  missing, conflicts and concerns for this file, each with its passage; the screenshot
  review's issues), traceability rows per approved attribute with this file's passages,
  the next action, and the questions to suggest.
- `evidence-intelligence-view.tsx`: the three panels. Left, the evidence navigator with
  phase chips, search, the drop zone (the existing `RequestUpload` with the item's Add
  evidence menu) and the items with their files. Centre, the document (`EvidenceViewer`,
  the existing viewer made inline, with zoom) and its toolbar (download, replace,
  withdraw, application). Right, AI analysis, Details (the existing `AnalysisPanel`) and
  Traceability. Below, the assistant bar: suggested questions from the findings, handed to
  the agent console as today.
- The item's decision (Accept, Follow up, Insufficient) sits on the AI panel and calls the
  existing sufficiency endpoint; a follow-up note starts from the findings ticked.
- Clicking a finding or a traceability row opens its passage in the document; a finding
  without a located passage says so ("not located in the file"), never a made-up page.
- The Request step's other views (Requests, Request groups, Coverage by attribute and by
  procedure) stay as they were, behind the "Evidence" tab.

### Increment 2 — findings as records, and the resolution loop (schema change)

Status: **built 30 October 2026, awaiting review.** Migration 0137, `evidence_findings.py`, `evidence-findings-model.ts`, `evidence-findings-view.tsx`, the `/workspace/evidence-findings` route; tests `test_evidence_findings.py` (8, in the critical tier) and `tests/evidence-findings-model.test.ts` (9). Checked end to end on the review stack: a draft policy with placeholders uploaded through the navigator, read live, gave ten findings (three from the checks, seven from the reader with their questions and passages); one accepted, composed and sent as a message on the request, with its history on the finding.

- Migration: `evidence_findings` (one per finding: the file, analysis and requirement it
  comes from, the attribute, kind, title, observation, citation, proposed question,
  expected response, status, plan revision and file hash) and `evidence_finding_events`
  (append-only: PROPOSED, ACCEPTED, EDITED, DISMISSED, SENT, REPLIED, REASSESSED,
  RESOLVED, CLARIFICATION_ACCEPTED, MORE_NEEDED, NOT_APPLICABLE, ESCALATED, STALE, each
  with the actor, note and what it points at).
- Derivation when a reading lands and when a mapping run completes, idempotent by
  fingerprint; deterministic checks on the read text (placeholders, version and effective
  date for a policy, period against the phase window) located with `find_quote`.
- The reader's schema gains `follow_ups[]` beside `gaps[]` (observation, question,
  expected response, the quote it rests on), filled in the same call, so no extra model
  call per file; quotes are verified against the stored text before they become citations.
- Endpoints: list a control's findings; decide one (accept, edit the wording, dismiss,
  resolve with the file that supports it, accept a clarification, more needed, not
  applicable with a reason, escalate); prepare a consolidated follow-up from accepted
  findings on one request, which a person sends through the existing request message
  (the owner is emailed a fresh link); nothing is sent by an agent.
- Reassessment: a reading that lands on a request with open findings, or an owner's
  message, is attached to the finding and ANSWERED is proposed (the event says whether
  the reader finds the new file covers the item); a plan approved again or a replaced
  file marks the finding stale. Nothing closes without a person.
- Tests (the brief's section 13): incomplete evidence gives a targeted follow-up with a
  located passage; reading again adds nothing and stales what is not found; a follow-up
  is refused until a person accepts, refuses links and credential requests, and is
  audited; a reply and a later file propose ANSWERED and keep the history; a plan
  approved again marks findings stale; dates outside the interim window are a finding
  while design evidence is not held to a window; a mapping run gives missing, conflict
  and concern findings idempotently; another firm gets 404 and a reviewer reads but
  cannot decide.
- After the owner's review of 30 October 2026: a withdrawn file marks its open findings
  stale as a replaced one does; the owner's portal answers and the submission attach to
  the findings as a message does (each a REPLIED event with what it points at); a later
  file or reply reaches a finding already answered too; a mapping finding carries the
  approved attribute's own identifier and code (`attribute_id`, `attribute_code`), not
  only its position; an edited question is audited like every other decision; the list
  answers with a `summary` by status, and the panel says what moved (answered, proposed,
  with the owner, out of date, closed) above the findings.
- Checked end to end as a test (`test_the_resolution_loop_end_to_end`): the incomplete
  policy, the gaps with located passages, the auditor's edit and acceptance, the
  follow-up sent, the owner's message, answer, upload and submission through the portal,
  one more reader call for the new file alone while the first reading stands, the
  findings of another request untouched, the auditor's resolution, clarification and
  more-needed decisions, the audit trail, and a reviewer who reads but cannot decide.
- UI acceptance with Playwright (playwright-core on the installed Chrome) at 1440×900
  and 1366×768 in both themes: no horizontal overflow, no clipped element, panels that
  scroll inside their height; screenshots in docs/review/evidence-workspace.
- Still open: a restored file does not clear the stale mark its withdrawal set (a person
  decides the finding either way); the OCR page numbering defect (increment 3).

### Increment 3 — the assistant in the workspace

Status: planned.

- An inline thread on the control's console (the existing `/console/messages` API and
  polling), persistent per control, with the suggested questions and action previews
  ("prepare a consolidated follow-up" opens increment 2's dialog).
- The OCR page numbering fix.

## 4. Principles kept

- A reading, a mapping and a finding are proposals; the requirement's sufficiency, the
  sent message and the sign-offs are a person's.
- Absence from one document is never proof the control does not exist; a policy that
  describes a control never says it operated.
- Design evidence does not satisfy interim or roll-forward requirements (the reader's
  coverage is per requested item, by phase).
- Uploaded text is untrusted content: shown as text, never followed.
- No coverage percentage without its denominator; no confidence figure.
