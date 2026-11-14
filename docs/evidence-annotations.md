# Evidence annotations

Asked for by the product owner on 14 November 2026: "I want a functionality where the AI
agent annotates the basis why the specific evidence satisfy the requirements of the control
and the specific attribute. This annotations would be reviewed by the user and can be
adjusted as needed. Basically a professional annotations." Two mockups on a sample file were
shown; the owner chose the compact one ("Great I like that last approach"): a tickmark
legend of one line per annotation, the basis as a callout beside the box in view, and what
the file shows per attribute at the top.

Defaults the owner was told and did not change: reviewing annotations is optional (accepting
evidence does not wait for it; the count reviewed is shown), and the annotated copy is made
when a person downloads it, not added to the workpaper by itself.

## 1. What a person sees (the evidence preview)

Opened from a file on the D&I Evidence list (a file on a DESIGN requirement of a control).

- **The evidence**, with a numbered box (a tickmark) on each annotated passage. The file is
  never changed: the boxes are a layer over it.
- **What this file shows**, top right: one row per approved attribute of the control, with
  the numbers of the annotations that bear on it, or "Not in this file".
- **Annotations**, below it: one line each (number, a short label, the attribute letters, a
  review mark), in reading order. "2 of 7 reviewed".
- **The basis**, for the one annotation selected, as a callout beside its box (or below it
  where there is no room): the sentence, the exact words it rests on, a "Checked in code"
  line where a comparison backs it, and Confirm & next, Edit, Remove, with previous and
  next. Enter confirms and moves on; the arrow keys move.
- **Edit**, in the callout: the sentence (the agent's own wording is kept and shown), the
  attributes it supports, and the box, by its handles on the evidence. **Add annotation**
  draws a new box.
- **Confirm all N proposed**, for routine files. **Download annotated copy** saves the
  evidence with its boxes and a numbered legend, as an image.

Three kinds, each in words and a colour, never colour alone: **Shows an attribute**
(`SHOWS`), **Right system, person or date** (`IDENTIFIES`), **Source** (`SOURCE`), and where
the records show an attribute is not met, **Shows an exception** (`EXCEPTION`).

A file with no positions (no local OCR, a spreadsheet, a file read in part) lists its
annotations without boxes; nothing else changes.

## 2. Where annotations come from

Proposed in code from a finished engine 2 check (docs/evidence-assurance.md, section 10) of
the requirement the file serves, in the transaction that saves the run. No extra model call.

- `SHOWS`: one per distinct verified passage of an element both readings find MET, on an
  attribute the request asks for. Passages of several attributes that overlap are one
  annotation naming each attribute. `EXCEPTION`: the same for a deviation's record passages.
- `IDENTIFIES`: from the facts both readings state alike (section 10.5, item 3): the SUBJECT
  ("Right person or record"), the SYSTEM ("Right system"), a TRIGGER_AT date ("Starts the
  clock"), a REFERENCE; one per kind and file, on the fact's own quote. Its attributes are
  those whose comparisons use the fact.
- `SOURCE`: where a reading quotes the words that show where the file comes from (who
  captured it, a report's run line), one per file.
- The sentence: what the reading said the passage shows (prompts /7 add an optional `shows`
  sentence to each quote, and an optional `quote` to each `files` entry), cleaned to one
  bounded line; the first reading's where both give one. Where none is given or it does not
  pass (a secret, an address, a link), code writes it from the element or the fact. The
  label is written in code (at most 60 characters).
- `check_sentence`: where a comparison made in code uses a fact read from the passage, the
  comparison's own sentence.
- At most 12 per file, in reading order (page, then top to bottom).
- A new run of the requirement adds proposals for passages not annotated yet, and marks the
  agent's unreviewed proposals it no longer cites `SUPERSEDED`. An annotation a person
  confirmed, edited, added or removed is never changed by a run.

An annotation is model-derived text until a person reviews it: it is shown, never sent
anywhere, never a finding, and it decides nothing.

## 3. Positions

`evidence_word_boxes`: for an image file, the words local OCR reads with their positions
(Tesseract's own word boxes; the image never leaves the machine, whatever the firm's OCR
choice for reading). Made once per file, when its first annotations are proposed or first
asked for; nothing of the file's stored text or its hash changes, and no file is read again
for its text. Without local OCR there are no positions.

An annotation's `rects` are the boxes of the words its quote covers, one per line, as
fractions of the page (x, y, width, height from 0 to 1), found by matching the quote's words
in order against the page's words (case, spacing and punctuation set aside). A quote that
is not found has no rects. A text PDF is boxed in the browser from its own text, as cited
passages already are; a scanned PDF's pages are not boxed yet.

## 4. Records (migration 0161)

`evidence_word_boxes` (evidence_file_id, page, organization_id, project_id, width, height,
words jsonb `[[text, x, y, w, h], …]` in pixels, engine, created_at; primary key file and
page). Written once.

`evidence_annotations`: id, organization_id, project_id, engagement_control_id,
requirement_id, evidence_file_id, assessment_id (the run that proposed it; null for a
person's), kind, label, statement, agent_statement (the agent's own sentence, kept; '' for a
person's), quote, attribute_ids uuid[], page, rects jsonb, check_sentence, origin
(`AGENT`, `PERSON`), status (`PROPOSED`, `CONFIRMED`, `EDITED`, `REMOVED`, `SUPERSEDED`),
position, version, created_by, decided_by, decided_at, created_at, updated_at.

Every change by a person is an audit event with the person as the actor
(`evidence_annotation.confirmed`, `.edited` with what it was and what it is, `.removed`,
`.added`, and one `evidence_annotations.confirmed` for a group); the agent's proposals are
one `evidence_annotations.proposed` event per run and file, with no person as actor. A
removed annotation stays on record. Archived engagements are read-only.

## 5. API

Under `/organizations/{o}/projects/{p}/controls/{c}`:

- `GET /evidence-annotations?requirement_id=…&file_id=…` (PROJECT_READ):

```json
{
  "file_id": "…", "requirement_id": "…", "positions": true,
  "pages": [{"page": 1, "width": 2200, "height": 1032}],
  "attributes": [{"id": "…", "code": "A", "text": "…", "annotation_ids": ["…"]}],
  "annotations": [{
    "id": "…", "number": 1, "kind": "SHOWS", "label": "Disabled the same day",
    "statement": "…", "agent_statement": "…", "quote": "…",
    "attribute_ids": ["…"], "codes": ["A", "C"], "page": 1,
    "rects": [[0.033, 0.472, 0.382, 0.040]], "check_sentence": "…",
    "origin": "AGENT", "status": "PROPOSED", "version": 1,
    "decided_by_name": null, "decided_at": null
  }],
  "reviewed": 2, "total": 7, "can_edit": true
}
```

  `REMOVED` and `SUPERSEDED` annotations are not listed. `number` is the place in the list.

- `POST /evidence-annotations/{id}/confirm` `{version}`.
- `POST /evidence-annotations/confirm-all` `{requirement_id, file_id}`: every `PROPOSED`
  one, as one decision.
- `POST /evidence-annotations/{id}/edit` `{version, statement?, attribute_ids?, rects?,
  page?}`: at least one change. New rects are bounded to the page; where the file has
  positions the quote becomes the words under them, and an edit whose box covers no word is
  refused ("The box covers no words of the file."). Status becomes `EDITED`.
- `POST /evidence-annotations/{id}/remove` `{version}`.
- `POST /evidence-annotations` `{requirement_id, file_id, page, rects, statement,
  attribute_ids, kind}`: a person's own (`origin` `PERSON`, status `CONFIRMED`).

Each returns the list as GET does. Decisions need the same permission as deciding evidence
(TASK_UPDATE on the control, an active engagement); 409 with a plain sentence when the
version is stale ("This annotation changed since the page loaded. Refresh and try again.").
The web calls them through `/workspace/evidence-annotations`.

## 6. Tests

Synthetic files only. Server: positions from a generated image (where local OCR is
installed; skipped otherwise), quote to rects, proposals from a scripted engine 2 run (each
kind, overlap, the cap, the sentence's fallbacks, a second run superseding only unreviewed
proposals), every route with its authorization, version and audit event. Web: the model
(parsing, the per-attribute rows, numbering, review counts, stepping order), the callout's
placement, and source-level checks of the viewer.

## 7. Status

| Increment | State |
| --- | --- |
| Mockups on a sample file, the compact one approved | done, 14 November 2026 |
| Server: positions, proposals, records, API | in progress, 14 November 2026 |
| The preview: boxes, legend, callout, review, edit, add, annotated copy | in progress, 14 November 2026 |
