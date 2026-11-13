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

### 2.1 Uploading into the wizard

`POST .../evidence-uploads` takes the wizard's scope as well as today's fields:

- `design_control_id`: the control whose D&I items the files are sorted into;
- `requirement_id`: set when the wizard was opened from a row (that item is the person's
  choice);
- `batch_id`: as today, one per wizard session.

The first upload of a batch records the batch (`evidence_batches`: id, control, phase DESIGN,
the item chosen if any, who, when). An upload without `requirement_id` is stored with its
placement pending. Custody, de-duplication and the archived-engagement guard are unchanged.

### 2.2 Reading for placement

A wizard file is read by the existing reader, with every D&I item of the control as its
requested items (the DESIGN requirements that still expect evidence, across the control's
D&I requests, each with its id, title, description, categories and the attribute letters it
links). The reader's coverage of each item is recorded against the requirement, as today.

The reader's own model-derived findings are never proposed for a wizard file: the
assurance chain judges D&I evidence once the file is placed. Its deterministic findings
(placeholder text, version, dates) stay.

### 2.3 Placement rules (code decides, the model proposes)

1. A file the assurance gate would hold (custody, unreadable, kind unsure, population on a
   design item) is not placed: it needs a person, with the gate's reason.
2. Candidates are the items the reader says the file covers (COVERED first, then PARTIAL).
3. The file is placed when the reader is the model with high or medium confidence and one
   candidate stands out: the only COVERED item, or the only candidate whose category fits the
   file's kind (a policy or procedure to process documentation, a ticket, log, listing,
   screenshot or sign-off to control execution). A file the reader says fully covers
   several items (a bundle) is placed on each of them.
4. Otherwise it needs a person, with the candidates ranked and the reason in words.
5. A file covering no item is "not D&I evidence": it stays in the control's files, shown in
   the results, and can be moved.
6. From a row, the file is placed on that row's item whatever the reader says. If the
   reader is confident another item fits better, the placement carries a suggestion ("This
   looks like the policy. Move it to Access review policy?"). Nothing moves without a person.

A placement is a filing on the item's request for that item, so the existing rules follow:
the item counts the file as evidence in hand (evidence_receipts), and the assurance chain
queues the item's check once all its files are read.

Placements are recorded in `evidence_placements` (append-only): file, batch, requirement (or
none), status PLACED, NEEDS_PERSON or NOT_DESIGN, method AGENT or PERSON, the reader's
confidence, the reason, the ranked suggestions, who decided and when. A move supersedes the
earlier row and keeps it.

### 2.4 The batch's state

`GET .../controls/{control_id}/evidence-batches/{batch_id}` (project.read):

```json
{
  "batch_id": "…", "control_id": "…", "chosen_requirement_id": "… | null",
  "created_at": "…", "server_now": "…",
  "stages": { "stored": 5, "read": 3, "sorted": 2, "checked_items": 0, "items": 2, "files": 5 },
  "files": [
    {
      "file_id": "…", "name": "…", "size_bytes": 0, "extension": "pdf",
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
check is REVIEWED. Cheap enough to poll every 2 to 5 seconds.

`POST .../evidence-batches/{batch_id}/files/{file_id}/placement` (task.update), body
`{ "requirement_ids": ["…"], "version": 1 }` (empty list: not D&I evidence). It records a
PERSON placement, moves the filing (the item's receipts and checks follow), and answers with
the file's entry. A stale version is 409. Another firm is 404; a Reviewer reads and cannot
move.

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
| Server: wizard uploads, placement, batch state, moves | in progress, 13 November 2026 |
| Accuracy: nested answers, the false-issue pattern | in progress, 13 November 2026 |
| The wizard in the app, built to the approved prototype | after the prototype is approved |
