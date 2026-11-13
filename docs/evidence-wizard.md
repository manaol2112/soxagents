# The D&I evidence wizard

Asked for by the product owner on 13 November 2026: "When the user clicks the upload, I want
my system to have a very intelligent evidence wizard that can handle multiple file upload
and automatically classifying the evidence, tagging them to the correct attribute ... clearly
show ... what classification it identified, what attributes was addressed, and whether which
specific attribute is not satisfied ... a professional animation when files are being
analyzed so that the user would not wonder what's happening."

Decided by the product owner the same day:

- **Placement is automatic.** The agent files each file on the D&I item it fits when it is
  confident. A file it is unsure about waits for a person to choose. Every placement is
  shown, and a person can move any file.
- **One wizard for every upload.** The list's new "Upload evidence" button and each row's
  Upload open the same wizard. From a row, the files go to that item (the person's choice
  stands); the agent only suggests a better fit.
- **D&I first.** Interim and roll-forward sample evidence keeps today's tester flow.
- **Prototype first.** An interactive prototype of the three steps and the animation is
  approved before the screen is built. The server work starts in parallel.

This document is the build contract. It builds on the evidence assurance chain
(docs/evidence-assurance.md), which stays the only source of attribute results.

## 1. What a person sees

### Entry

- **"Upload evidence"** in the D&I list's header opens the wizard for the whole control:
  the agent sorts the files into the control's D&I items.
- **A row's Upload** opens the same wizard with that item chosen ("Adding to: One completed
  quarterly review").
- **Files dropped anywhere on the D&I list** open the wizard with those files queued.

### Step 1: Add files

- A large drop zone: several files at once, a folder, or files chosen from the computer.
- The queued files: type mark, name, size, and remove.
- Beside it, "What the agent looks for": the control's D&I items, each with its attribute
  letters and whether it already has files. Each letter shows its wording on demand.
- The primary action reads "Analyze 5 files". Beneath it: "Files are kept with a custody
  record. Nothing is sent to the client."

### Step 2: Analyze

This is the long part (about 10 seconds per file to read, and 1 to 3 minutes per D&I item
for the two readings). It must never look stuck.

- **The pipeline, at the top:** Secure, Read, Classify and sort, Check against attributes.
  Each stage shows its live count ("Read 3 of 5"). An elapsed time and a plain estimate sit
  beside it: "Usually 2 to 4 minutes for 5 files." Below: "You can close this window. The
  results appear on the list when they are ready."
- **One row per file:** its mark and name, then its stage track (Secured, Read, Classified,
  Sorted). When classified, its type in words and how sure the agent is. When sorted, the
  item it went to ("To: Access review policy and designated owners list"), or "Needs you:
  choose where this goes" with the choice inline, or "Not D&I evidence: kept in the
  control's files".
- **One card per D&I item that received files:** "Checking against attributes A to F",
  with the two readings drawn as two lanes ("First reading", "Second reading, without
  seeing the first") and then "Comparing". The lanes reflect the run's real stage.
- **Honest progress only.** Every state comes from the server's records. No made-up
  percentage. An indeterminate animation shows work under way; a tick shows a stage done.

### Step 3: Results

- **A summary line first**, for example: "5 files sorted into 2 items. A, B, C and D
  supported. E not satisfied on One completed quarterly review: the changes were made 41
  days after quarter end. F needs your judgment. 1 file is not D&I evidence."
- **One card per D&I item:**
  - its files, each with its type, and the attributes that file addresses (the letters
    whose verified passages are in that file);
  - its attributes, each in words with a mark (never colour alone): Supported
    (implementation or design), Shown in part, Not satisfied, Your judgment needed, Not
    checked (with why). A "Not satisfied" attribute names what is not met and quotes the
    passage, with "Open in the file". A "Your judgment needed" attribute shows both readings.
- **Files that need a person** keep their inline choice; "Not D&I evidence" files can be
  moved to an item.
- **Actions:** move a file (to another item, or out of D&I), remove a file, Accept an
  item's evidence (the existing judgement, a person's decision, stating what it marks as
  evidenced), and Done.

### Motion

- Stage changes: a tick scales in (180 ms); the active stage has a soft pulse and a shimmer
  on its track segment; the two readings' lanes shimmer independently.
- Results: attribute marks appear in a short stagger (40 ms each, under 300 ms in all).
- The dialog opens in 200 to 300 ms; expanding a card takes 150 to 250 ms.
- Under reduced motion: no pulse or shimmer, no stagger; states change in place, in words.
- A polite live region announces stage changes, at most one announcement every few seconds.

### Layout

The window follows the Review and send window: fixed height (never taller than the screen),
a header with the three steps, a body that scrolls in its own panes, and a footer bar with
the step's action, always visible. At narrow widths it is one column.

## 2. Server

Built in `evidence_wizard.py` (migration 0158), with its hooks in the reading
(`evidence_analysis`), the uploads and the Evidence center's filing (`evidence_intake`), the
D&I list's links (`evidence_plans`), cancellation (`agent_runs`) and the receipts
(`evidence_receipts`). The independent review of 13 November 2026 is folded in below.

### 2.1 Uploading into the wizard

`POST .../evidence-uploads` takes the wizard's scope as well as today's fields:

- `design_control_id`: the control whose D&I items the files are sorted into (this
  engagement's and in scope; else 404, or 409 out of scope);
- `requirement_id`: set when the wizard was opened from a row (that item is the person's
  choice); it must be a DESIGN requirement of that control that still expects evidence
  (planned, waiting on another or requested; not waived or removed, not a proposed addition
  nobody accepted, not on a cancelled or closed request, in a D&I phase that applies), else
  409;
- `batch_id`: as today, one per wizard session. A batch keeps its control and its item: an
  upload naming another is 409, as is a batch id already used by uploads outside the wizard
  and an upload outside the wizard into a wizard batch.

The batch (`evidence_batches`: id, control, phase DESIGN, the item chosen if any, who, when)
is recorded in the transaction of the session's first upload that stores a file or lists one
held already, never before it, so no batch is empty. The upload takes the batch's row first,
before it files anything on a request or takes the plan, the order the batch's landing takes
them in. An upload without `requirement_id` is filed to the control on no request, its
placement pending; one from a row is filed on the row's item at once (on its request, or
linked to an item not yet requested), a person's placement.

A file the engagement holds already, dropped again in a session of the same control, stores
nothing new (`duplicate: true`) and is listed in that session with the placement it has
(`evidence_batch_duplicates`); from a row it serves the row's item too. Held anywhere else,
it is refused (409), and nothing is recorded. Custody, de-duplication and the
archived-engagement guard are unchanged.

### 2.2 Reading for placement

A wizard file is read by the existing reader, with every D&I item of the control as its
requested items (the DESIGN requirements that still expect evidence, across the control's
D&I requests, each with its id, title, description, categories and the attribute letters it
links, with their wording), at most `MAX_ITEMS` (14), the row's own item always among them.
The reader's coverage of each item is recorded against the requirement, as today.

The reader's own model-derived findings are never proposed for a wizard file: the
assurance chain judges D&I evidence once the file is placed. Its deterministic findings
(placeholder text, version, dates) are derived once the file is on an item's request, by the
agent or a person, so a file first placed on no request still gets them when it is moved
onto one.

### 2.3 Placement rules (code decides, the model proposes)

1. A file the assurance gate would hold (custody, a reading that did not finish,
   unreadable, kind unsure, population on a design item) is not placed: it needs a person,
   with the gate's reason, and the items ranked.
2. Candidates are the items the reader says the file covers (COVERED first, then PARTIAL).
3. The file is placed when the reader is the model with high or medium confidence and one
   candidate stands out: the only COVERED item, or the only candidate whose category fits the
   file's kind (a policy, procedure or narrative to process documentation; a ticket, log,
   listing, screenshot or sign-off to control execution, and to the item's own category
   where it asks for exactly that). A file the reader says fully covers several items (a
   bundle) is placed on each of them.
4. Otherwise it needs a person, with the candidates ranked and the reason in words.
5. A file covering no item is "not D&I evidence": it stays in the control's files, shown in
   the results, and can be moved.
6. From a row, the file is placed on that row's item whatever the reader says. If the
   reader is confident another item fits better, the placement carries a suggestion ("This
   looks like a policy or procedure. Move it to “Access review policy”?"). Nothing moves
   without a person.

A placement is a filing for the item: on the item's request (the file's filing names the
request and the item), or, for a further item or one not requested yet, a link to it. So
the existing rules follow: the item counts the file as evidence in hand (evidence_receipts),
and the assurance chain queues the item's check once all its files are read. The filing is
tried first, in the reading's own transaction: an item that changed while the file was read
leaves it unplaced (a person chooses), and the reading names the request the file is on.

The receipts rule (`evidence_receipts.covered`): a file filed for one item counts only for
that item and the items it is linked to, whatever else its reading found (the rule
`request_file_serves` applies to the request's items). A wizard file is read against every
D&I item of its control, so its reading names items it is not filed for. An item a reading
names on another request is not this request's; one it names on this request that is no
longer requested (waived, removed) counts by its place in the list, as before.

The batch waits for its files. Every way a reading ends (read, failed, out of attempts,
custody, cancelled while queued or while running) runs one hook in the transaction that
records the ending: the placement where it was read, a person's choice with the gate's
reason where it ended unread and nothing was placed, then the landing check. Once none of
the batch's files still filed to its control is being read (a file filed to another control
since is not the batch's to wait for), the batch lands: each placed file's request is
received as for a file read on it (`apply_receipt`, item by item), the control's checks are
brought in step, and when it landed is recorded (`landed_at`). Files that arrive together
are so checked once, and an unsent request is not split on the first file when the second
is for its other item. On start-up, beside the chain's backfill, a batch whose files all
ended since it last landed lands now (`land_open_batches`).

Placements are recorded in `evidence_placements` (append-only): file, the session it was
decided in, requirement (or none) and every item it is placed on, status PLACED,
NEEDS_PERSON or NOT_DESIGN, method AGENT or PERSON, the reader's confidence, the reason, the
ranked suggestions, the reading, who decided and when. A move supersedes the earlier row and
keeps it. A move outside the wizard is recorded the same way, as a person's: the Evidence
center's filing ("Moved to another control in the Evidence center.", "Taken off its control
in the Evidence center.", "Filed to this control in the Evidence center.") and the D&I
list's link and unlink ("Linked to an item on the D&I list.", "Taken off an item on the D&I
list."); the Evidence center's filing also runs the batch's landing check. Every path takes
the file's reading, then the batch, then the plan, then a request, so none waits for another.

### 2.4 The batch's state

`GET .../controls/{control_id}/evidence-batches/{batch_id}` (project.read):

```json
{
  "batch_id": "…", "control_id": "…", "chosen_requirement_id": "… | null",
  "created_at": "…", "server_now": "…",
  "stages": { "stored": 5, "read": 3, "sorted": 2, "checked_items": 0, "items": 2, "files": 5 },
  "files": [
    {
      "file_id": "…", "name": "…", "size_bytes": 0, "extension": "pdf", "duplicate": false,
      "stage": "STORED | READING | READ | SORTED | NEEDS_PERSON | NOT_DESIGN | FAILED",
      "read": { "status": "PENDING | WORKING | READY | FAILED", "method": "TEXT | OCR | NONE",
                "pages": 0, "started_at": "…", "finished_at": "…", "note": "" },
      "classification": { "kind": "policy", "label": "Policy or procedure",
                          "confidence": "high | medium | low", "summary": "…" },
      "placement": {
        "status": "PLACED | NEEDS_PERSON | NOT_DESIGN | PENDING",
        "method": "AGENT | PERSON",
        "requirement_ids": ["…"],
        "reason": "…",
        "suggestions": [ { "requirement_id": "…", "title": "…", "reason": "…" } ],
        "version": 1
      },
      "addresses": [ { "code": "B", "verdict": "SUPPORTED" } ]
    }
  ],
  "items": [
    { "requirement_id": "…", "title": "…", "request_title": "…", "letters": ["A", "B"],
      "file_ids": ["…"], "assurance": { "…": "the entry of GET …/evidence-assurance for it" } }
  ]
}
```

Plain sentences only in `reason`, `note` and `summary`. `addresses` is empty until the item's
check is REVIEWED. Cheap enough to poll every 2 to 5 seconds: the assurance chain is read
once per state, and not at all before any placed item has a check (each item is then
`NOT_CHECKED`).

- `files` lists the session's own files in the order they were added, then the files held
  already that were dropped in it (`duplicate: true`), each with its current placement.
- Each file is shown where it is now, from its filing and links, never where a placement
  said it was: `placement.requirement_ids` are the items it serves now, `items` the items
  holding the session's files. A file filed to another control since is `NOT_DESIGN`, its
  reading that control's.
- `classification` is null until the file is read; `read.pages`, `started_at` and
  `finished_at` are null where unknown; `read.method` is `NONE` until the reading ends.
- A file not yet placed shows `{ "status": "PENDING", "method": "AGENT", "version": 0 }`.
- `stages`: `stored` and `files` count the listed files; `read` the readings that ended
  (or files filed elsewhere since); `sorted` the files with a placement; `checked_items` the
  items whose check ended (reviewed, held or failed).

`POST .../controls/{control_id}/evidence-batches/{batch_id}/files/{file_id}/placement`
(task.update), body `{ "requirement_ids": ["…"], "version": 1 }` (empty list: not D&I
evidence). It records a PERSON placement, moves the filing (the requests and checks of both
items follow; the reading names the request the file is on now, where its deterministic
findings are derived), and answers with the file's entry. On a D&I request only ever
provided directly (never emailed nor handed over), the items a move leaves without evidence
are asked for again in a draft of their own, which needs approval like any other; outside
the wizard, taking evidence off an item leaves the request as before. A stale version, a
file still being read, withdrawn or filed to another control, an item the control no longer
expects evidence for, or an item named twice is 409. Another firm is 404; a Reviewer reads
and cannot move; an archived engagement changes nothing.

`GET .../controls/{control_id}/evidence-batches` (project.read): the control's recent
sessions, the most recent first, at most 10, for the D&I list's progress line and to reopen
a session from any device:

```json
{
  "batches": [
    { "batch_id": "…", "created_at": "…", "created_by_name": "…",
      "chosen_requirement_id": "… | null", "files": 5, "in_progress": 0,
      "needs_person": 1, "not_design": 1, "finished": true, "finished_at": "… | null" }
  ]
}
```

`in_progress` counts files still being read, or read and not yet placed; `finished` is true
when every file's reading ended and every placed item's check ended, and `finished_at` is
when (null until then).

## 3. Accuracy work in parallel

From the live run of 13 November 2026 (docs/evidence-assurance.md, section 8):

- Two readings returned `attributes` as JSON text. The readings read a nested answer the way
  the planner does (`ModelRequest.unnest`), and a reading that runs out of room is retried
  once with a larger answer budget.
- Most false issues came from one attribute whose criteria ask for something records rarely
  state outright (that the person who assigned the role is "a member of SAP Security"). The
  cause is diagnosed before any rule or prompt changes, and no audit meaning is weakened.

## 4. Acceptance

- Dropping several files sorts each into the right D&I item or says why it could not, and
  never loses a file.
- Per file: its type, its item, and the attributes it addresses. Per item: each attribute's
  result in words, with the passage for a supported or not satisfied attribute.
- Progress is shown at every moment from the server's records; closing the window loses
  nothing; reopening from the list shows the same state.
- A person can move any file, and the item's results follow.
- Nothing is sent to the client, and nothing is accepted, without a person.
- The UI acceptance checklist of docs/design-system.md, in both themes, at 1366 and 1440,
  under reduced motion, and by keyboard.

## 5. Status

| Increment | State |
| --- | --- |
| Interactive prototype for approval | in progress, 13 November 2026 |
| Server: wizard uploads, placement, batch state, moves, the sessions list | built, with the independent review's fixes; pending review, 13 November 2026 |
| Accuracy: nested answers, the false-issue pattern | in progress, 13 November 2026 |
| The wizard in the app, built to the approved prototype | after the prototype is approved |
