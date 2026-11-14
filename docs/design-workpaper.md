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
