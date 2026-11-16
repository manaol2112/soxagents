# The D&I workpaper in three views

Asked for by the product owner on 14 November 2026: "revisit the d&i work paper and propose
a revamp. I wanted a professional audit workpaper. Show me few prototypes that I can choose
from." Three prototypes were shown on a sample control; the owner asked for all of them:
"Can you build all three so the user would have three options?"

## 1. One workpaper, three views

The D&I workpaper (stage DESIGN) stays one record: its sections, versions, preparation and
the D&I conclusion's sign-off are unchanged, as are their routes, permissions and audit
events. What changes is how it is shown. A person chooses among three views of the same
data, and the choice is remembered in that browser:

- **Document** (the classic workpaper): a formal page. A header block with the workpaper
  reference, prepared by, reviewed by and the status; numbered sections (objective, risk and
  control; procedures performed; the walkthrough of one instance; attributes tested;
  information produced by the entity; matters for the reviewer; conclusion); a tickmark
  legend and an evidence index; signature lines. It prints as a document ("Print or save as
  PDF"), with nothing of the app around it.
- **Matrix** (the test matrix): the conclusion and the counts as tiles; a grid of attributes
  against evidence, each cell saying what that file does for that attribute; the
  walkthrough as a timeline; matters for the reviewer; reports relied on; the evidence as
  thumbnails.
- **Evidence** (the workpaper with its evidence beside it): the workpaper on the left
  (conclusion, attributes with their basis and references, the walkthrough), and on the
  right the evidence a selected reference points to, with its annotations
  (docs/evidence-annotations.md) and the basis of the one in view.

In every view an attribute's result reads as a workpaper says it (product owner,
15 November 2026): "No exceptions noted" where the check shows the attribute (`SHOWN`;
it read "Shown"), "Exceptions noted" for an exception, the check's or one a person
recorded (`EXCEPTION`, `EXCEPTION_RECORDED`). Every other state keeps its own words
(section 2), so nothing is said to have no exception that was not shown. The page words
these itself; the server's `state_words` are unchanged.

In every view a statement carries the reference of the evidence it rests on (`E1`, `E2`, …,
in the order of the evidence index), and selecting a reference opens that file at that
passage. Nothing in a view is a decision: preparing, reopening and signing stay the
existing actions, shown once per view. Sections a preparer may edit today stay editable from
every view, through the existing section editor.

## 2. What the views are built from (the server assembles it)

`GET /organizations/{o}/projects/{p}/controls/{c}/design-workpaper` (PROJECT_READ), built in
code from the records, with no model call and nothing stored:

```json
{
  "control": {"id": "…", "ref": "ITGC-AC-02", "title": "…", "system": "Workday",
              "engagement": "SOX FY2027", "area": "IT general controls"},
  "workpaper": {"id": "…", "reference": "ITGC-AC-02-WORK-TOD", "status": "DRAFT",
                "drafting": false, "version": 3, "shown_version": 1, "current_version": 1,
                "prepared_by": null, "prepared_at": null},
  "review": {"status": "TO_SIGN", "proposed": "EFFECTIVE", "signed_verdict": null,
             "signed_by": null, "signed_at": null, "out_of_date": []},
  "risk": "…", "activity": "…",
  "facts": [{"label": "Frequency", "value": "As events occur"}],
  "understanding": "…",
  "procedures": ["…"],
  "evidence": [{"ref": "E1", "file_id": "…", "file_name": "…", "kind": "walkthrough",
                "kind_words": "Walkthrough record", "requirement_id": "…",
                "requirement_title": "…", "annotations": 7, "reviewed": 2,
                "left_out": null, "image": true}],
  "walkthrough": {"columns": ["Step", "Who", "Evidence inspected", "Result"],
                  "steps": [{"number": 1, "when": "", "step": "…", "who": "…",
                             "evidence": "…", "result": "…", "refs": ["E1"]}],
                  "source": "AGENT"},
  "attributes": [{"id": "…", "code": "A", "text": "…", "state": "SHOWN",
                  "state_words": "Shown", "basis": "…", "tickmark": "AGREED",
                  "refs": [{"ref": "E3", "annotation_ids": ["…"], "numbers": [4, 5]}],
                  "marks": {"E3": "SHOWS", "E1": "IDENTIFIES", "E7": "SOURCE"},
                  "checks": ["…"], "notes": ""}],
  "reports": [{"ref": "E7", "report": "…", "source": "…", "procedure": "…"}],
  "matters": [{"state": "OPEN", "kind": "FOLLOW_UP", "text": "…", "refs": ["E3"]}],
  "conclusion": {"text": "…", "source": "AGENT", "proposed": "EFFECTIVE",
                 "words": "Effective", "signed": false},
  "tickmarks": [{"mark": "AGREED", "symbol": "✓", "meaning": "…"}],
  "can_edit": true
}
```

- `workpaper` is null where the control has no D&I workpaper yet; the views then say so and
  offer the existing "Draft" action.
- `evidence`: every file in force on a DESIGN requirement of the control, once each (a file
  serving two requirements is one entry, under its first), in the order of the D&I list,
  numbered `E1`…. `left_out` is the gate's sentence where the current check left the file
  out. `annotations` and `reviewed` count its listed annotations.
- `walkthrough`: the workpaper's own walkthrough section, row by row, with the columns it
  was drafted with. `refs` are the evidence entries a row names (a file name in the row, or
  a citation of the section). `when` is the row's "When" cell where the section has that
  column, otherwise the first date the row states (section 3).
- `attributes`: each approved attribute of the control, with what the current (not out of
  date) checks of the control's DESIGN requirements find across them:

  | `state` | Words | When |
  | --- | --- | --- |
  | `EXCEPTION` | Exception shown | any check finds the records show it is not met (an issue resting on a deviation or a contradiction, or a failed comparison) |
  | `SHOWN` | Shown | supported on a requirement that asks for it, and no exception |
  | `SHOWN_IN_PART` | Shown in part | part of it shown and the rest neither shown nor contradicted |
  | `NOT_SHOWN` | Not shown | asked for and not demonstrated |
  | `NOT_CONCLUDED` | Not concluded | the checks leave it to a person or wait on a file |
  | `NOT_TESTED` | Not tested yet | no current check covers it |

  Across requests the most cautious reading stands, in this order: an exception on any
  check; then `NOT_CONCLUDED` where any current check of a request that asks for the
  attribute leaves it open (the readings disagree, a comparison failed on one reading, or
  it waits on a person or a file), even where another request shows it; then `SHOWN`;
  `SHOWN_IN_PART`; `NOT_SHOWN`; `NOT_TESTED`. Where one request shows an attribute and
  another that asks for it does not, the state is `SHOWN` and a matter says so.

  `basis` is the check's own sentence for the state that stands (never a model's free
  text beyond what the check already stores). `refs` are the files its verified passages
  are in, with the numbers of the annotations on them that stand. `marks` says, per file,
  the strongest thing the file does for the attribute: `EXCEPTION`, `SHOWS`, `IDENTIFIES`,
  `SOURCE`. `EXCEPTION` and `SHOWS` come only from the passages of current checks, never
  from an annotation alone; `IDENTIFIES` and `SOURCE` come from annotations that stand
  (listed, the file still in force, and either the request's check is current or a person
  made, confirmed or edited it). `notes` are the preparer's own from the workpaper's
  attribute section, matched on the attribute's wording.

  `tickmark` never claims more than the state: `EXCEPTION` for an exception; `COMPARED`
  or `AGREED` only where the state is `SHOWN`, the check that shows it shows the
  implementation (not only what a document requires), its review leaves no reliability
  question open on the files it rests on, and no current check of the attribute is open or
  holds a failed comparison (`COMPARED` where a comparison made in code passed on that
  check, `AGREED` otherwise); `NONE` in every other case.
- `procedures`: sentences written in code from what was done and is on record (the number
  of files inspected and from which requests, that one instance was walked through where
  a person or the agent recorded its steps (a template's starter rows are not a
  walkthrough; a file read only in part is said to be read in part), that dates were
  compared in code where a check made a
  comparison, that a report's parameters were inspected where a file's review says so).
  Never a procedure the records do not show.
- `matters`: what a reviewer should see first, from the records: open evidence findings
  (`FINDING`), the checks' open follow-ups (`FOLLOW_UP`) and considerations
  (`CONSIDERATION`), attributes not concluded (`UNSETTLED`), files left out (`FILE`), what
  each current check's review says is incomplete or not yet reliable (`COMPLETENESS`: a
  file read in part, a report whose basis is not shown, a source prepared by management),
  and one `NOTE` that operating effectiveness is tested separately. `OPEN` for what waits
  on a person, `NOTED` otherwise. A check that is out of date is said first. At most 12,
  with a last line counting what is not listed.
- `conclusion`: the workpaper's conclusion section and the D&I conclusion's verdict
  (design_conclusions): proposed until a reviewer signs. The views say "Proposed" and who
  drafted it; nothing here signs.
- `tickmarks`: the legend, fixed in code: `✓` agreed to the system's own record without
  exception; `≡` dates or values compared in code, within what the attribute allows; `◊`
  report parameters inspected; `✗` exception shown.

Read-only: nothing is written, queued or sent by this route. A reader of the engagement
sees it; `can_edit` says whether the viewer may edit sections (the existing rule).

## 3. What does not change

No migration, no model prompt and no template changes: the walkthrough keeps the columns it
was drafted with, and a row's `when` is the row's own "When" or "Date" cell where a firm's
template has that column, otherwise the first date (with its time, where one follows) that
the row's own cells state, as written, and '' where they state none. A **When** column in
the standard template is planned, not built: it changes the drafting prompt and the
templates' recorded version, which is its own increment.

An engine 1 check (docs/evidence-assurance.md) gives an attribute its state from that
check's own element results and its `SHOWS` marks from their verified passages; it has no
comparisons, facts, follow-ups or review of its files' reliability, so no tickmark,
`IDENTIFIES` mark or `FOLLOW_UP` matter comes from it.

## 3.1 Where it is shown

Wherever the D&I workpaper is shown today (the control's "Walkthrough and design workpaper"
step and the workpaper section of the control), the three views come first, under one
switcher (Document, Matrix, Evidence; the choice is kept in the browser, and the address
bar is not changed). Under them, one fold, "Edit, prepare and versions", holds today's
workpaper card unchanged: the section editor, Draft again, Prepare, Reopen, the versions
and the Excel export. It is open while there is no workpaper or a draft is running. An
"Edit" link on an editable section of a view opens the fold at that section. The D&I
conclusion's sign-off stays where it is. The testing workpaper (stage EFFECTIVENESS) is
not changed.

The views load on their own (one request, an outline while it loads, a plain sentence and
"Try again" when it fails), and load again after the fold saves something. Thumbnails and
the evidence beside the workpaper load only when shown.

## 3.2 Editing a section where it is (product owner, 15 November 2026)

Old: "Edit" on a section of a view opened the fold at the bottom of the page, at the
card's editor (one text box; a table typed one row per line with "|" between cells; a
form post that loaded the whole page again). New: "Edit" turns the section into its
editor where it sits in the Document view, and saves in the background. The server is not
changed: a save is the existing `POST …/workpapers/{id}/sections/{key}` (`based_on`, and
`text` or `rows`), with its rules, its new version and its audit event.

- **What is edited.** The workpaper's own stored section, as the card's editor edits it
  (`papers`, the D&I workpaper's `sections`), never the assembled view:
  - *Understanding of the control* and *Conclusion*: the section's text, in one text box.
    Citation marks (`[^1]`) are shown as stored.
  - *Walkthrough* and *Information produced by the entity*: the section's own columns and
    rows as a grid of cells, with "Add a step" / "Add a report" and a remove button per
    row. A cell is one line (a line break is a space, as the server cleans it). The
    Document's "When" and "Ref" columns are read by the server from what the cells say, so
    they are not edited: the grid says so.
  - *Attributes tested*: the preparer's note of each attribute, one box per attribute in
    its row. The attribute, its result and its references come from the records and stay
    as they are. On save the note goes to the "Notes" cell of the attribute's row in the
    stored section (the row is found as the server finds it: by the attribute's wording
    after a letter or alone, or by its letter alone); an attribute with no row gets one
    ("A. wording", the note). Every other row and cell is sent back unchanged.
- **Where "Edit" opens in place.** Only where the stored section is on the page, is the
  version the views show (`workpaper.id` and `currentVersion` match the card's), has the
  kind the editor needs (text, or a table; for the attributes a table with a "Notes"
  column that is not the first), and the section is editable (`editableSections`, the
  existing rule). Otherwise "Edit" opens the fold as before. For the moment after a save
  in which the page's records are still a version behind the views, "Edit" is off
  everywhere: neither editor opens on the text before the save. From the Matrix and the Evidence views,
  "Edit" shows the Document view with that section's editor open.
- **One section at a time.** While an editor is open the other "Edit" links are off.
  "Cancel" (or Escape) closes it; where something was changed it asks first ("Discard
  your changes?"). Leaving the page with unsaved changes asks too.
- **Saving.** "Save" is off until something changed and while a limit is passed (text
  12,000 characters; 300 rows; a cell 1,000 characters; nothing that reads as a
  credential), with the reason said beside it. One press sends one request through
  `POST /workspace/workpapers/section` (JSON; it answers `{status, detail}` and never
  redirects). The editor stays, read-only, saying "Saving…", until the server confirms
  and the views have read the workpaper again; only then does it close and say "Saved as
  a new version of the draft." Nothing is shown as saved before that. A refusal keeps the
  editor open with what was typed and says why in one sentence (for a 409 this page's
  own where it knows the refusal, otherwise the server's: the workpaper changed, is
  prepared, or is being drafted; an ended session says to sign in again). After a 409
  the records and the views are read again, so "Cancel" then "Edit" opens the latest.
  Where the save was confirmed and the views then cannot be read, the editor still
  closes (the save stands) and the page says so: "Your change was saved as a new
  version, but the workpaper could not be read again." A change of spaces only that the
  server would drop is not a change: "Save" stays off. After a save the
  page's records are read again in the background (`router.refresh()`), so the fold's
  card and its version are current; no page is loaded again.
- **The fold** keeps today's card, with its own plain editor: it is the way to edit a
  section the Document does not show, and what "Edit" falls back to. One thing of the
  card changes: its editor of a section is made anew for each version, so its box always
  starts from that version's text (the page used to load again after every save; now the
  records can change under it).
- **Phone and keyboard.** The grid scrolls sideways inside its own frame, as the tables
  do. The editor's first box takes the focus when it opens; the focus returns to the
  section's "Edit" link when it closes. Motion is short and off under reduced motion.

Files: `apps/web/src/section-edit-model.ts` (pure: what an editor starts from, the draft,
the limits, the rows a save sends, the write the route validates),
`apps/web/src/section-editor.tsx` (the three editors and their bar),
`apps/web/app/workspace/workpapers/section/route.ts`.

## 3.3 Formatting in a text section (product owner, 15 November 2026)

"The textbox where I can edit the documentation, can that have a text formatting? … bold,
italic, underline, and anything possible." Decided with the product owner: formatting is
seen as it is typed (not marks in a plain box), which adds one editor component to the web
app (TipTap 3.32.2, pinned: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`).

- **Where.** The text sections edited in place (Understanding of the control, Conclusion).
  A table cell and a preparer's note stay one plain line.
- **What.** Bold, italic, underline, a bulleted list, a numbered list, a line break inside
  a paragraph, undo and redo, "Clear formatting". Nothing else of the component is on
  (no heading, link, code, quote, strike, rule, image): a section's structure is the
  workpaper's own. Shortcuts as people know them (Ctrl/Cmd+B, I, U).
- **How it is stored.** In the section's existing `text`, as plain text with marks. No
  HTML is stored or sent (the server's `clean_text` removes markup), no schema changes,
  and a reader that knows nothing of the marks still shows readable text.
  - Lines are read without the spaces around them. Blocks are separated by a blank
    line. A block whose every line is `- ` and some text is a bulleted list; `1. `,
    `2. `, … and some text, a numbered list (one item per line, numbered from one
    whatever was written); any other block is a paragraph, and a line break inside it is
    a line break.
  - Inside a line: `**bold**`, `''italic''` (two apostrophes), `++underline++`, nested
    as needed. Each mark is two characters of its own, so no mark is part of another and
    a single `*`, `+` or `'` is never one (nor is `_`: identifiers stay as they are). A
    mark opens only directly before a character that is not a space, and closes at the
    next such mark in the line that stands directly after one, with something between
    them; a mark with no partner in its line is plain text.
  - `\` directly before `*`, `+`, `'`, `\`, `-` or `.` makes that character plain, and
    is itself not shown; any other `\` is a backslash (a Windows path stays as typed).
    The editor writes the `\` where a person typed two such characters together, or a
    line that would otherwise read as a list item, so what is typed is what is read back.
  - A citation mark (`[^1]`) is plain text in the editor and is kept as typed.
- **How it is read.** Everywhere the web shows a text section it shows the formatting
  (the three views, the print, the workpaper card in the fold, for both stages): built as
  elements from the parsed text, never by setting HTML. The card's own plain editor shows
  the marks as text. The Excel export writes the text without the marks (a list item
  keeps its `- ` or number): `workpaper_marks.plain`.
- **Pasting.** Pasted content keeps only what the editor allows (the formats above);
  everything else arrives as plain text. Nothing pasted is run or stored as markup.
- **Limits.** The 12,000 characters are counted on the text as stored, marks included.
- **One grammar, two readers.** `apps/web/src/rich-text-model.ts` (parse, the editor's
  document to text and back, pure) and `services/api/ai_workforce_api/workpaper_marks.py`
  (`plain`) read the same grammar; the shared cases are in
  `tests/fixtures/rich-text/cases.json`, read by both sides' tests.

## 3.4 Autosave, and leaving with changes (product owner, 15 November 2026)

"I want to automatically save the updates that the user has typed in or edited. If the
user is leaving or moving to other pages, the system should ask if he/she wanted to save
the changes." Decided with the product owner: what is typed is kept automatically as a
**working copy** on the server; a version is added to the workpaper's history only when
the person saves (the "Save" button, or "Save" when asked on leaving).

**The working copy (server).** Migration 0164, `workpaper_section_drafts`: one row per
workpaper, section and person (`workpaper_id`, `section_key`, `user_id` unique), with
`organization_id`, `project_id`, `based_on` (the version it was started from), `content`
(`{"text": …}` or `{"rows": …}`, the body a save sends), `created_at`, `updated_at`. It is
a person's unfinished typing, not a record of the audit: it is replaced as they type and
deleted when saved or discarded, it is never read by the views, the export, the agents or
another person, and it is not in the audit trail (the save that follows is, as today).

- `GET  …/workpapers/{id}/drafts`: the caller's own working copies of that workpaper:
  `[{section, based_on, text | rows, updated_at}]`.
- `PUT  …/workpapers/{id}/sections/{key}/draft` `{based_on, text | rows}`: keeps it
  (insert or replace). Same permission as an edit (TASK_UPDATE, a person, an open
  engagement), same cleaning and limits as an edit, and only while the workpaper is a
  draft that is not being drafted and the section exists with that kind; refused with a
  409 and a sentence otherwise. `based_on` is stored as sent (1 to the current version).
  Answers `{updated_at}`.
- `DELETE …/workpapers/{id}/sections/{key}/draft`: discards the caller's own; 204 whether
  or not there was one.
- The existing section edit (`POST …/sections/{key}`), in its own transaction, also
  deletes the caller's working copy of that section. Preparing a workpaper deletes every
  working copy of it (nothing unfinished is carried past preparation).
- A working copy never changes the workpaper, its version or its `version` counter.

**In the page.**
- While an editor is open and something was changed, the working copy is sent 1.5 s
  after the last change (one request at a time; the latest text wins; a failed one is
  tried again on the next change and every 15 s). The bar says where it stands, and never
  says "saved" of a working copy as if it were the workpaper:
  "Keeping your changes…", "Changes kept at 10:42. Not in the workpaper until you save.",
  "Your changes are not kept yet: the server could not be reached."
- "Save" is as in 3.2 (a version, confirmed by the server before it reads as saved).
- "Cancel" closes the editor; where something was changed it asks first, and discards the
  working copy.
- Opening "Edit" on a section that has a working copy opens the editor with it and says
  "Your changes from 14 Nov 10:42 are restored." with "Discard them". Where the workpaper
  has changed since the working copy was started (`based_on` is not the current version)
  it also says "This section may have changed since. Saving replaces it with what is
  here." A section with a working copy and no open editor shows "Unsaved changes" beside
  its link, which reads "Continue editing".
- **Leaving.** With changes not yet saved to the workpaper, going elsewhere in the app (a
  link, another step, another control, closing the panel) first asks, in a dialog:
  "Save your changes to *Understanding of the control*?" with
  **Save** (saves a version as in 3.2, then goes on once the server confirmed; a refusal
  keeps the person here with the reason),
  **Leave without saving** (the working copy is kept and is there on return), and
  **Keep editing**. Closing or reloading the tab cannot show the app's own dialog: the
  browser's own prompt appears only while the latest changes are not yet kept, and the
  working copy is sent as the page goes.
- Guarded: links (`<a>`, `next/link`) and the controls page's own navigation
  (`useGuardedRouter` in the step switcher, the panel's close, the control switcher, the
  toolbar and the overview). The browser's Back button is not asked about: the working
  copy is kept and is there on return.

Files: server `workpaper_drafts.py` (routes registered with the workpaper service),
`workpaper_marks.py`, migration 0164; web `rich-text-model.ts`, `rich-text.tsx`,
`rich-editor.tsx`, `working-copy-model.ts`, `leave-guard.ts`, `leave-dialog.tsx`,
`apps/web/app/workspace/workpapers/draft/route.ts`.

## 3.5 One conclusion, written in D&I Assessment, reviewed in its own step (product owner, 15 November 2026)

"The conclusion already shows up in my D&I analysis then there is another step for the
D&I conclusion. However, in the D&I analysis, I don't have the option to edit the
conclusion here." Decided: "keep the Section 7 'Conclusion' here but allow the preparer
to update the conclusion … Then in the last step, probably the D&I Conclusion and Review."

- **Section 7 of the workpaper (D&I Assessment) is where the preparer concludes.** In the
  Document view it is one card:
  - the verdict, said as what it is: "Proposed by the agent · review it" until the
    workpaper is prepared, and why ("From the records: no design deficiency is logged" /
    "N design deficiencies are logged"), with "Log a design deficiency" (the existing
    way, never a typed verdict: the verdict follows the deficiency log, section 2);
  - the conclusion text, formatted (3.3), with **Edit conclusion** as a button in the
    card (not only the small link on the heading), opening the in-place editor of 3.2
    with autosave (3.4);
  - where a reviewer signed, who and when; where the sign-off no longer holds, that.
  - The Matrix and the Evidence views keep their short verdict and a link to section 7;
    they do not repeat the text.
- **The last D&I step is "D&I Conclusion and Review"** (was "D&I Conclusion"; covers
  "Review · Sign-off"). It is the reviewer's: the conclusion exactly as written in
  section 7 (the verdict line and the formatted text, read-only), what the sign-off rests
  on, and the sign-off, as today. For the preparer it says where to change it: "Edit the
  conclusion in D&I Assessment" (a link to section 7, whose editor opens there). Nothing
  is edited in this step, so the conclusion has one editor.
- **No server change, no migration.** The text is the workpaper's `design-conclusion`
  section, read by the step through the existing workpaper read; the verdict and the
  sign-off are the existing D&I conclusion's.

## 3.6 The preparer concludes; the agent proposes (product owner, 15 November 2026)

"Agent should propose but user should finalize the conclusion. Give the option to Not
Effective, Effective, Control Not Concluded, or Exceptions noted. Any other status I
missed?", then "Okay proceed" to the recommended set below. This replaces "the records
propose the verdict and the reviewer signs exactly it" (design_conclusions.py, header):
the records and the agent propose, the preparer chooses, the reviewer signs the
preparer's choice.

**The conclusions** (`DesignConclusionKind`):

| Kind | Words | Needs | OE |
| --- | --- | --- | --- |
| `EFFECTIVE` | Effective | a reason only where it differs from the proposal | clears OE once signed |
| `EXCEPTIONS_NOTED` | Exceptions noted | a reason, always: why the exceptions are not a deficiency | clears OE once signed |
| `NOT_EFFECTIVE` | Not effective | a basis (`DESIGN`, `IMPLEMENTATION`, `BOTH`) and a reason, always | OE is not performed (as today) |
| `NO_INSTANCE` | Design effective, no instance to walk through | a reason, always | clears OE once signed |
| `NOT_CONCLUDED` | Not concluded | a reason only where it differs from the proposal | can never be signed |

A reason is 10 to 1000 characters, the person's own, cleaned as text is (untrusted).
Deficiency severity (deficiency, significant deficiency, material weakness) is the
deficiency evaluation's, not this; "not tested / not relied on" is planning's.

**Design and implementation, said apart** (from the records, in the assembled view): per
approved attribute, `shown_by` is `IMPLEMENTATION` where a current check shows it in the
records of an instance (`Reading.implementation`), `DESIGN` where checks show it only as a
document requires it, null otherwise. Two results for the control:
- *Implementation*: `IN_PLACE` where every approved attribute is shown by the instance's
  records or carries a person's closing tickmark; `EXCEPTIONS` where any attribute's
  state is an exception (the check's or one a person recorded); otherwise `OPEN`, with
  the letters not yet shown in the instance.
- *Design*: `DESIGNED` where every approved attribute is shown (by design or by the
  instance) or carries a closing tickmark; `EXCEPTIONS` as above; otherwise `OPEN`, with
  the letters.
Each with one sentence. Section 3 is headed "Implementation: walkthrough of one instance";
section 4's Result keeps one result per attribute and says under it "In the instance" or
"As designed" (`shown_by`); section 7 shows the Design and the Implementation result
beside the conclusion.

**The proposal** (`proposed_conclusion`, with `proposed_reasons`, one sentence each),
computed whenever the D&I conclusion is read, not only once prepared:
1. `NOT_EFFECTIVE` where a design deficiency stands (basis not proposed);
2. else `EXCEPTIONS_NOTED` where any attribute's state is an exception;
3. else `NOT_CONCLUDED` where Design or Implementation is `OPEN` (the product owner's
   rule: design alone, without the instance, is not effective);
4. else `EFFECTIVE`.
The agent's drafted text (the workpaper's `design-conclusion` section) stays the text.

**The preparer's choice** (migration 0165, `design_conclusion_choices`, written once and
ended once, no delete, archived guard, as 0162/0163): `kind`, `basis` (NOT_EFFECTIVE
only), `reason`, `proposed_kind` (the proposal when it was recorded), `workpaper_id`,
`workpaper_version` (the current version then), `recorded_by`, `recorded_at`; `ended_at`,
`ended_by`, `ended_as` (`REPLACED` by the next choice). One stands per control.
- `POST /organizations/{o}/projects/{p}/design-conclusions/{control_id}/choice`
  `{kind, basis?, reason?, replaces}` (`replaces`: the id of the choice it replaces, or
  null; a stale `replaces` is a 409). A person with TASK_UPDATE, never an agent; only
  while the design workpaper is a draft that is not being drafted (a prepared one is
  reopened first); answers the D&I conclusion's body. Audit event
  `design_conclusion.chosen` with kind, basis, proposed kind, workpaper version (never the
  reason's text beyond 200 characters).
- Refused (409, one sentence): `EFFECTIVE` while a design deficiency stands, an
  exception stands (the check's or a person's), or Design or Implementation is open;
  `EXCEPTIONS_NOTED` or `NO_INSTANCE` while a design deficiency stands; `NO_INSTANCE`
  also unless Design is `DESIGNED` ("the design is not shown yet: Design effective needs
  every attribute shown as designed or settled by a tickmark"), at the choice and again
  at the sign-off; a missing
  basis or reason where the table says one is needed (422).
**Sign-off.** The reviewer signs the preparer's standing choice: `SignOffBody`
`{conclusion, choice_id, workpaper_version, note}`; refused where no choice stands, where it is
`NOT_CONCLUDED`, where `conclusion` is not the standing choice's kind, where the choice
was recorded after the workpaper was prepared (a choice is recorded on the draft, then
the workpaper is prepared: `recorded_at` ≤ the preparation), and where the choice's rules
above no longer hold (checked again in the transaction);
`NOT_EFFECTIVE` also needs a standing design deficiency ("log the design deficiency
first"). The existing refusals stay (independence, prepared version, out of date). The
standing exceptions no longer block a sign-off of `EXCEPTIONS_NOTED` or `NOT_EFFECTIVE`
(they are what it concludes on); they block `EFFECTIVE` as before.
- `design_conclusions` gains `conclusion` (the kind), `conclusion_basis`,
  `conclusion_reason`, `choice_id` (migration 0165, additive; existing rows are given
  `conclusion = verdict` in the migration). `verdict` stays the OE-facing two values
  every reader uses today: `NOT_EFFECTIVE` for `NOT_EFFECTIVE`, `EFFECTIVE` for
  `EFFECTIVE`, `EXCEPTIONS_NOTED` and `NO_INSTANCE`. `NOT_CONCLUDED` is never signed.
- Out of date also when the standing choice changed after the sign-off ("the preparer's
  conclusion changed").

**Tightened after the independent review (15 November 2026).** Each of these closes a way
a conclusion could be signed, or keep clearing OE, without resting on the records:
- *Independence covers the conclusion itself.* Where independence is required, the person
  who recorded the standing choice cannot sign it (as the workpaper's preparer cannot):
  "you recorded this conclusion; another reviewer must sign it off". `can_sign` is false
  for them.
- *"Exceptions noted" needs exceptions, and nothing else open.* It is refused unless an
  exception stands (the check's or a person's) and every other approved attribute is
  shown or settled by a closing tickmark ("Exceptions noted needs an exception on record
  and every other attribute shown or settled"), at the choice and again at the sign-off.
  It is also refused at the sign-off where an exception was recorded or found after the
  choice was recorded ("an exception was noted after this conclusion was recorded; the
  preparer records it again"). The proposal follows: with an exception and other
  attributes still open it proposes `NOT_CONCLUDED`, and its reasons name both.
- *A sign-off stops holding when its own rules stop holding.* It is out of date (and no
  longer clears OE: `design_verdict`, `oe_gate_reason`, `effective_controls`) when the
  rule that allowed its conclusion would now refuse it: an exception found by a later
  check under `EFFECTIVE` or `NO_INSTANCE`, Design or Implementation gone open under
  `EFFECTIVE`, Design no longer `DESIGNED` under `NO_INSTANCE`, no exception left or an
  attribute gone open under `EXCEPTIONS_NOTED`. The reason is the rule's own sentence. A
  sign-off made before choices were recorded (no `choice_id`) is held to `EFFECTIVE`'s or
  `NOT_EFFECTIVE`'s existing rules only, as before; so is one the demo seeded (a sign-off on
  a demo engagement, `projects.demo`, by a demo identity, `users.demo_organization_id`:
  both set only by demo initialization, migrations 0128 and 0130), never other data.
  "Noted after" compares the choice's `recorded_at` with a person's exception's own
  `recorded_at`, and with the `finished_at` of the latest current check run that shows a
  check's exception (a run with no finish time counts as after).
- *The sign-off names the choice.* `SignOffBody` is `{conclusion, choice_id,
  workpaper_version, note}`; a `choice_id` that is not the standing choice is refused
  ("the preparer's conclusion changed; read it again"). The `verdict` field is no longer
  accepted.
- *Recording a choice changes the workpaper's record.* It bumps `workpapers.version`, so
  a Prepare sent from a page that has not seen the choice is refused as stale.
- *An attribute shown only on files a person decided are not relied on* is sent with
  `shown_by: "NOT_RELIED"`, and the page says so under its result.

**The body** of `GET …/design-conclusions/{control_id}` gains `proposed_conclusion`,
`proposed_reasons`, `choice` (`{id, kind, basis, reason, proposed_kind, recorded_by,
recorded_at, workpaper_version}` or null), `can_choose`, `design` and `implementation`
(`{result, sentence, open: [letters]}`), and `signed.conclusion` / `signed.basis` /
`signed.reason` in the sign-off. `proposed` (the two-value verdict) stays for existing
readers.

**On screen.** Section 7 (3.5) holds the choice: the agent's proposal with its reasons
("Proposed by the agent · review it"), the five conclusions as a radio group (with the
basis for Not effective and the reason box where needed), "Record conclusion" (shown as
recorded only after the server confirms), the Design and Implementation results, and the
text with Edit conclusion. D&I Conclusion and Review shows the recorded conclusion, its
reason and basis, read-only, with the sign-off (the button reads "Sign off: <the
conclusion's words>").

## 3.7 The preparer's sign-off, where the conclusion is (product owner, 15 November 2026)

"Isn't there any separate requirement for D&I sign-off by the preparer? I see a prepared by
and reviewed by in the conclusion section. I don't know how that sign-off works right now."

Until now the preparer signed with "Prepare", a small button inside the folded "Edit,
prepare and versions" card at the bottom of D&I Assessment, with nothing saying what it
attests or what it needs. It now sits at the end of section 7, after the conclusion, as
the preparer's sign-off; the reviewer's sign-off stays in D&I Conclusion and Review.

- **What it is.** "Sign as preparer" is the existing prepare (`POST …/workpapers/{id}/
  prepare`, its version check, its record `prepared_by` / `prepared_at` /
  `prepared_version`, its audit event); nothing new is recorded. Its words say what is
  attested: "I prepared this workpaper; the evidence, the testing and the conclusion above
  are complete and supported." An optional note goes with it, as today.
- **What it needs** (the server refuses, the page says so before the press, each in one
  line): the workpaper is a draft that is not being drafted and is shown at its latest
  version; a conclusion is recorded (3.6) and it is not "Not concluded" ("record a
  conclusion first" / "Not concluded is not signed: record the conclusion the records
  support"); no section is open in its editor with changes not saved (the page's own
  check). Urgent review notes do not hold the preparer's sign-off (they hold the
  reviewer's: docs/workpaper-review.md, section 4). The server's new refusal applies to the
  design workpaper only; the testing workpaper's prepare is unchanged.
- **After it.** Section 7 ends with "Prepared by Dana Lee on 15 Nov 2026 · version 4" and,
  for the preparer, "Reopen to change" (the existing reopen, with its reason). The header
  table's "Prepared by" and "Reviewed by" read the same records: a name and a date where
  signed, "Not yet" otherwise, each linking to where it is signed.
- **D&I Conclusion and Review** shows both signatures in order: the preparer's (signed or
  not, with a link to section 7 where not) and the reviewer's (the sign-off).
- **One place.** The D&I card in the fold no longer offers Prepare (it keeps Draft again,
  Reopen, the versions and the Excel export); the testing workpaper's card is unchanged.
- The reviewer still cannot be the preparer, nor the person who recorded the conclusion,
  where independence is required (3.6).

## 3.8 One D&I step: the preparer sends it for review, the reviewer signs in section 7 (product owner, 16 November 2026)

"Does it make sense to separate those? I don't see the value of having a separate D&I
conclusion and review in Step 6", then "I still want to have a sign-off of the reviewer on
the D&I. When the user signs-off he/she has the option to send the workpaper for review to
another team member", then "Looks good to me" to the prototype
(scratchpad send-proto/send-for-review.png). Supersedes the separate step of 3.5: the D&I
conclusion and its review are both in D&I Assessment, section 7.

- **The workflow.** The step "D&I Conclusion and Review" (`designconclusion`) is removed;
  the D&I Assessment step carries the status: Draft · Prepared, in review with <name> ·
  Returned to the preparer · Signed off: <conclusion> · Sign-off out of date. Old links to
  the removed step land on D&I Assessment at section 7. Scope & Sampling still waits for
  the reviewer's D&I sign-off (the OE gate is unchanged).
- **Sending for review.** "Sign as preparer" becomes "Sign and send for review": one press
  prepares the design workpaper (3.7, unchanged rules) and sends it to the reviewer chosen
  in **Send for review to**, with an optional message (up to 1,000 characters, a person's
  own, untrusted). The picker lists the engagement's members whose engagement role is
  REVIEWER (the people who may sign: `control_reviews._is_reviewer`), each with how many
  D&I workpapers wait for them; the preparer and the person who recorded the standing
  conclusion are shown but not offered, with the reason, where independence is required.
  It starts on the reviewer this preparer last sent to on this engagement, else the only
  reviewer, else nothing (a choice is needed). A reviewer must be chosen to sign.
- **The record** (migration 0168, `design_review_requests`, written once and ended once,
  no delete, archived guard): control, workpaper, `workpaper_version` (the prepared
  version), `reviewer_id`, `sent_by`, `sent_at`, `message`, `reminded_at` (the last
  reminder, the one column that may change, and only forward), `ended_at`, `ended_by`,
  `ended_as` (`SIGNED` with the sign-off; `RETURNED` with a reason; `REASSIGNED` when
  another reviewer is chosen; `REOPENED` when the preparer reopens; `SUPERSEDED` when the
  workpaper is prepared again), `ended_reason`. One stands per control.
- **What the preparer sees after sending:** Prepared ✓ (who, when, version; Reopen), then
  "In review with <name> · sent <when>" with the message, **Change reviewer** (ends the
  request REASSIGNED and opens one to the new reviewer; the same picker rules) and
  **Remind** (an in-app notice to the reviewer; at most once an hour; no email).
- **What the reviewer sees** (the same section 7): the message, one line of what the
  sign-off rests on (deficiencies, exceptions, open and urgent review notes), an optional
  sign-off note, **Sign off: <conclusion>** (the existing sign-off of 3.6, which now also
  ends the request SIGNED) and **Return to preparer** (a reason, 10 to 1,000 characters:
  the design workpaper goes back to a draft through the existing reopen, the request ends
  RETURNED with the reason, and the preparer sees it). Only the reviewer the request names
  may sign it or return it; another reviewer is told who it is with and may be made the
  reviewer through Change reviewer by the preparer or a lead. Urgent review notes hold the
  sign-off (workpaper-review.md, section 4).
- **Returned:** the preparer sees "Returned by <name> · <when>" with the reason; the
  workpaper is a draft again; **Sign and send again** prepares it and opens a new request,
  starting on the same reviewer.
- **The reviewer's list on Home:** "Waiting for your review": one line per standing
  request for the viewer (control reference and title, "D&I", from whom, when, the
  conclusion, or "N urgent notes"), linking to D&I Assessment at section 7; the count in
  the navigation.
- **API** (`/organizations/{o}/projects/{p}/design-conclusions/{control_id}`): the body
  gains `review_request` (`{id, reviewer {id, name}, sent_by {id, name}, sent_at, message,
  reminded_at, version}` or null), `last_return` (`{by {id, name}, at, reason}` or null),
  `reviewers` (`[{id, name, waiting, offered, why_not}]`) and `default_reviewer_id`.
  `POST …/send-for-review` `{workpaper_version, reviewer_id, message, prepare_note}`
  (prepares, then opens the request, in one transaction); `POST …/review-request/reviewer`
  `{request_id, reviewer_id}`; `POST …/review-request/remind` `{request_id}`;
  `POST …/return` `{request_id, reason}`. The sign-off body gains `request_id` (required
  where a request stands; a stale one is a 409). `GET /organizations/{o}/projects/{p}/
  review-requests/mine` lists the viewer's standing requests for Home. Each write is one
  audit event; the message and reason at most 200 characters in it.

## 4. Tests

Server: the assembly from synthetic records (each attribute state, the evidence numbering
and a file on two requirements, references from rows and citations, procedures only for
what is on record, matters from each source, a control with no workpaper, an engine 1
check, the `when` of a row, authorization). Web: the model of each view (parsing, the
grid's cells, the timeline, the reference and tickmark words, the remembered view), and
source-level checks that the existing actions are kept and appear once.

## 5. Status

| Increment | State |
| --- | --- |
| Three prototypes on a sample control; all three asked for | done, 14 November 2026 |
| Server: the assembled view | built 14 November 2026 (`design_workpaper.py`, read-only route, no migration; `test_design_workpaper_model.py` in the fast tier, `test_design_workpaper.py`); independently reviewed and tightened the same day (section 2: the most cautious reading across requests, tickmarks, marks, matters); read over the 24 controls of the development data without writing; not yet seen with a live engine 2 check |
| The three views, the switcher, print | built 14 November 2026 (`design-workpaper-view.tsx`, `design-workpaper-model.ts`, `design-workpaper.css`, route `/workspace/design-workpaper`; mounted at the two D&I workpaper places with today's card in a fold); independently reviewed; checked in a headless browser against scripted answers in both themes and at phone width, not yet by eye in the running app, a real print dialog, or with a PDF file beside the workpaper |
| A When column in the standard walkthrough; a thumbnail route; a readable title per file | planned |
| A section edited where it is (3.2) | built 15 November 2026, web only (`section-edit-model.ts`, `section-editor.tsx`, route `/workspace/workpapers/section`; the server's existing section edit); independently reviewed the same day and tightened (the fold's editor made anew per version, "Edit" off while the page's records are behind a save, a 409 reads again, spaces alone are no change); checked in a headless browser on synthetic data (72 checks), not yet against the live API. Leaving by in-app navigation is not asked about until 3.4 |
| Formatting (3.3); autosave and leaving (3.4) | built 15 November 2026 (web: rich-editor, working copies, leave dialog; server: workpaper_marks, workpaper_drafts, migration 0164 applied to dev); checked in headless browsers on synthetic data (149 and 210 checks); independent review pending |
| One conclusion (3.5); the preparer concludes (3.6) | agreed 15 November 2026; being built |
| The preparer's sign-off (3.7): the server's refusal | built 16 November 2026 (`workpaper_service._prepare`: a design workpaper is refused with "record a conclusion first" where no conclusion stands, and "Not concluded is not signed: record the conclusion the records support" where the standing one is Not concluded; tests in `test_design_conclusion_choice.py`, critical tier). The testing workpaper's prepare is unchanged |
