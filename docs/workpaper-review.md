# Workpaper review notes

Asked for by the product owner on 15 November 2026: "build a workpaper review workspace
for D&I result, and eventually can be used for OE … each field can have its own review
note, each words and letters can also be highlighted and highlighted words can have its
review note as well … a very easy way of filtering these review notes. Review notes should
also have criticality type, Status, Resolution Owner", with an agent that helps close a
note where it can. After two prototypes: "Looks better … the rest, please start building",
with the criticalities "Urgent, Normal, Follow-up", colour only for the criticality ("I
don't want a lot of colors … simple UI and UX but still look classy and professional"),
and the highlighted words shown in the colour of the note's criticality.

## 1. What it is

A reviewer (or anyone on the engagement who may read the workpaper and act on it) raises
**review notes** on a workpaper. A note is about one of three things:

- **a field**: one place of the workpaper (a section's text, a table cell, an attribute's
  result, the conclusion);
- **highlighted words**: any run of characters inside a field, down to one letter;
- **the workpaper as a whole**.

Every note has a **criticality** (`URGENT`, `NORMAL`, `FOLLOW_UP`: "Urgent", "Normal",
"Follow-up"), a **status** (`OPEN`, `RESPONDED`, `CLEARED`, `DISMISSED`), a **resolution
owner** (a member of the engagement; the workpaper's preparer by default), its text, and a
thread of replies. Notes are records of the review: never deleted, each change kept.

The same notes serve any workpaper (`workpapers.id`), so the D&I workpaper (stage
`DESIGN`) is first and the testing workpaper (stage `EFFECTIVENESS`) uses them unchanged.
The existing `review_notes` of the control review at the end of testing (migration 0042:
the reviewer agent's and a person's notes on results, samples and deficiencies, with
`MUST_FIX`/`SHOULD_FIX`/`OBSERVATION`) stay as they are; these are a separate, simpler
record anchored in a workpaper's text. They may be brought together later.

## 2. The record (migration 0166)

`workpaper_review_notes`: `id`, `organization_id`, `project_id`, `workpaper_id`,
`number` (1, 2, … per workpaper), and

- the anchor: `anchor_kind` (`FIELD`, `TEXT`, `WORKPAPER`); `field` (the field's key,
  section 3; '' for `WORKPAPER`); for `TEXT`: `quote` (the highlighted characters, 1 to
  500), `prefix` and `suffix` (up to 60 characters around it, to find it again), and
  `occurrence` (which match of the quote in the field it was, from 0); `workpaper_version`
  (the version it was raised on);
- `text` (10 to 2000 characters; a person's own, cleaned as text is);
- `criticality`, `status`, `owner_id` (a user);
- `raised_by`, `raised_at`; `cleared_by`, `cleared_at`; `dismissed_by`, `dismissed_at`,
  `dismiss_reason` (10 to 500);
- `version` (a counter for "it changed under you").

`workpaper_review_note_events`: one row per thing that happened to a note, written once,
never changed or deleted: `kind` (`RAISED`, `REPLIED`, `RESPONDED`, `CLEARED`, `REOPENED`,
`DISMISSED`, `CRITICALITY`, `OWNER`), `by`, `at`, `text` (the reply, the reason; '' where
none), `data` (what changed: `{from, to}`). The thread on screen is these rows. The note's
row itself changes only in status, criticality, owner, the cleared/dismissed columns and
`version` (a guard refuses any other change, and any delete); archived engagements are
read-only as everywhere.

## 3. Fields and highlights

A field's key names one place of the workpaper, independent of how it is drawn:
`understanding`, `conclusion`, `conclusion.choice`, `walkthrough.<row>.<column>` (row from
1, the stored section's column from 1), `attributes.<attribute id>.basis`,
`attributes.<attribute id>.result`, `attributes.<attribute id>.note`,
`reports.<row>.<column>`, `matters.<n>`, `procedures.<n>`, `control.<fact>` (risk,
activity). The web marks each such element with its key; the server takes a key as an
opaque string of that shape (letters, digits, dots, hyphens; up to 120).

A `TEXT` note is found again in its field's text by its quote: the `occurrence`-th match
whose surroundings fit `prefix`/`suffix` best. Where the words are no longer there (the
text was edited), the note stays on its field and says "The highlighted words have
changed since this note was raised", with the words as they were.

Highlighted words are drawn in the note's criticality colour (the words themselves take
the colour, with a thin underline; no background colour), and nothing else in the
workpaper is coloured by notes. A field with a note carries a small numbered marker.

## 4. Who may do what (the server decides)

- **Read**: whoever may read the workpaper.
- **Raise**, **reply**: a person on the engagement who may update it (TASK_UPDATE) or
  review it (the reviewer role). Never an agent in a person's name.
- **Respond** (a reply that sets `RESPONDED`): the resolution owner, or the workpaper's
  preparer.
- **Clear**, **reopen**, **change criticality**: the person who raised it, or a reviewer.
  Never the resolution owner on their own note to themselves unless they raised it; a
  preparer cannot clear a reviewer's note.
- **Dismiss** (with a reason): the person who raised it, or a reviewer.
- **Change the owner**: the person who raised it, a reviewer, or the current owner
  (handing it on).
- A note is raised on any version of the workpaper, prepared or draft.

**Sign-off.** The D&I sign-off (and, later, the testing review's) is refused while a note
of the workpaper is `URGENT` and `OPEN` or `RESPONDED`: "clear or dismiss the urgent
review notes first (N)". Preparing a workpaper is not held by notes.

## 5. The API

Under `/organizations/{o}/projects/{p}/workpapers/{workpaper_id}/review-notes`:

- `GET` → `{notes: [...], members: [{id, name, role}], can_raise, can_review, counts}`:
  every note with its events, the people who can own one, and what the caller may do.
- `POST` `{anchor_kind, field, quote?, prefix?, suffix?, occurrence?, workpaper_version,
  text, criticality, owner_id}` → the note.
- `POST /{note_id}/reply` `{text, responds: bool, version}`.
- `POST /{note_id}/clear` `{version}`; `/reopen` `{text, version}`; `/dismiss`
  `{reason, version}`; `/criticality` `{criticality, version}`; `/owner`
  `{owner_id, version}`.

A stale `version` is a 409 ("the note changed; read it again"). Each write is one audit
event (`workpaper_review_note.<kind>`), never with more than 200 characters of text.

## 6. The screen

In the D&I workpaper views (and wherever a workpaper's Document view is shown):

- **Notes beside the workpaper.** The Document view gains a "Notes" switch in its bar
  ("Notes · 4"). On: a rail at the right lists the notes in the order of the document,
  each numbered to match its marker; selecting a note scrolls to its place and the
  reverse. Selecting words in a field offers "Add review note" beside the selection;
  each field offers it on its own (a small button that appears with the pointer or the
  focus, and from the keyboard). The form: the note, the criticality (Urgent, Normal,
  Follow-up), the resolution owner; shown as raised only after the server confirms.
  Above the rail, one-press filters: Open, Urgent, Mine, This section.
- **All notes.** A fourth view beside Document, Matrix and Evidence: "Notes · N". A
  search box (the note's text, its replies and the highlighted words) and filters for
  status, criticality, owner, section and who raised it; a table of note, where,
  criticality, owner and status; the selected note beside it with its passage, its
  thread, a reply box and its actions; "Open the workpaper at this passage". The filters
  are kept in the browser for the session, not in the address.
- **The reviewer's step** (D&I Conclusion and Review) says how many notes are open and
  how many are urgent, with a link to All notes, and why the sign-off waits where it
  does.
- Calm: one colour per criticality (Urgent a deep red, Normal a dark blue, Follow-up a
  grey) and nowhere else; status, owner and time in quiet text; no filled pills for
  notes. Keyboard and screen reader complete; 390 px; dark; motion short and off when
  asked.

## 7. The agent's help (second increment, after the notes themselves)

For a note the agent can help with, it proposes; a person decides; nothing is changed or
cleared by the agent.

- **Wording** (grammar, clarity, a sentence to rewrite): a proposed rewrite of the
  highlighted words or the field, with the changes marked, facts taken only from the
  workpaper and its evidence.
- **A question the records answer** (the documentation, the data): what the evidence
  shows, with its reference, and one or two ways to settle it ("correct the workpaper",
  "reply only").
- **Judgment**: no proposal; the note says so, with "Ask the agent anyway".

It runs as a registered agent run under the existing safeguards (untrusted text as data,
budgets, the run record), started when a person asks ("Ask the agent") or, where the
organization turns it on, when a note is raised. Its proposal is stored on the note as
the agent's (never as a person's reply) until a person uses it: "Use as the reply" writes
the person's reply; "Send to the preparer" proposes the change to the resolution owner,
who accepts it into the section's editor (a working copy, saved by them).

## 8. Status

| Increment | State |
| --- | --- |
| Prototypes; layout, criticalities and colour agreed | done, 15 November 2026 |
| Notes: record, API, the rail, All notes, filters, sign-off held by urgent notes (1–6) | being built |
| The agent's help (7) | next |
