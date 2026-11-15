# Evidence assurance chain

Asked for by the product owner on 12 November 2026 ("I want this to be really really
good, accurate, and no room for error ... before providing feedback to the user, another
agent should review whether that result is accurate and correct"), and approved the same
day as the route below ("Okay implement your recommendation").

This document is the build contract. It says what the chain does, what it never does,
the records it keeps and the API the screen reads. The status of each increment is at
the end.

## 1. Objective

The audit conclusion rests on this review. Three errors matter, in this order:

1. Saying evidence supports an attribute when it does not (a false "met").
2. Raising an issue that is not real (a false issue, and a wrong follow-up to the client).
3. Skipping a file or an attribute without saying so.

No model can be promised free of error. The chain is built so that an error has to get
past two independent readings and a check in code before a person sees it as fact, and
so that anything the agents cannot settle is shown to a person as unsettled.

## 2. Scope

- Increment 1 (this document): evidence filed on a **DESIGN-phase** requirement (the D&I
  Evidence step) of a control that has approved attributes.
- Interim and roll-forward sample evidence keeps today's tester and independent reviewer
  (testing_engine.py, control_reviews.py). The chain is written so it can serve them later.
- Nothing here concludes on the control, accepts evidence, changes a requirement's
  sufficiency, sends anything, or decides a finding. Those stay a person's.

## 3. The chain, per request

One run per **requirement** (a DESIGN requirement with at least one file in force), reading
**all its in-force files together** in each reading. One request is often answered by
several files (a ticket shows the approval, the SAP change log shows the grant): judged
alone, neither shows "approved before granted", and each would raise an issue that is not
real. That is the second error the objective names, so the files are judged together
(changed 12 November 2026, before the first build was finished). Evidence may also be split
across requests (the change log asked for on another request): an element the request's
files do not bear on is `NOT_ADDRESSED`, never a shortfall (stage 4).

A run is identified by its basis: every file in force on the requirement (its id, content
hash, the hash of its stored text, its kind, and whether the gate left it out), the
attribute basis, the requirement's links, the control's facts, the lens, both prompt
versions, and the model configuration the readings would use (the tier and the model per
role). It starts by itself when the reading of a file on a DESIGN requirement ends
(`evidence_analysis.run_analysis`), in the background, after the reading's transaction
commits (the `_after_commit` pattern of context_routes.py; a run is never handed to the
worker before the row that asks for it is committed). While another file of the same
requirement is still being read, nothing is queued: that file's reading queues the run, so
files that arrive together are read once. A run still queued when a file arrives is
brought up to date in place (no second run for the same requirement).

Never silently skipped: a DESIGN requirement with a file in force and no run is listed as
`NOT_CHECKED` (section 6) and a person can start its check. Runs are also queued, or marked
out of date, when the plan is made again or approved or a plan run ends (requirements
created, removed or reshaped), when a requirement's links or an attribute's wording or
criteria change, when a file is linked to or taken off a requirement, withdrawn, replaced
or restored, when a file's kind is confirmed, and when the control's description changes.
On start-up a bounded backfill (`backfill`, 50 requirements a pass, never-tried and
oldest requirements first) queues a run for each DESIGN requirement with files in force on
it (its requirement files, filtered in the query and read exactly per control) and no
current run; a
requirement a pass already tried at the very same basis (its files still being read, say)
is not tried again until what it would read changes (`evidence_assessment_backfill`).

### Stage 1: the gate (code only, no model call)

The gate applies **per file**. A file is left out of the readings, with one code and one
plain sentence, when any of these hold:

| Code | When |
| --- | --- |
| `CUSTODY` | The reading failed its custody check. |
| `READ_FAILED` | The reading did not finish this time (a timeout, a provider error, a reader that gave up, a cancellation): "The file could not be read this time. Read it again." |
| `UNREADABLE` | Nothing readable was extracted (no text, password-protected, a failed OCR). |
| `KIND_UNSURE` | The reader's confidence in the file's kind is low, or the rules classified it (no model, or the model's answer was rejected), or the demo seeded it, and no person has confirmed the kind. |
| `POPULATION` | The file is a population on a design item: the walkthrough instance is picked first (walkthrough_instances.py). |

The run goes ahead on the files that passed, and names the files left out
(`held_files`). The whole run is HELD, with one code and one sentence, and nothing later
runs (so nothing later is paid for), when:

| Code | When |
| --- | --- |
| the first file's code | No file passed its own gate. |
| `NO_ATTRIBUTES` | The control has no approved attribute. |
| `TOO_LARGE` | The files that passed are together more than one reading takes (`MAX_READING_TEXT`, 400,000 characters of stored text). Nothing is cut to make them fit. |

A person clears `KIND_UNSURE` by confirming the kind (the existing confirm action), which
queues the run again. A file added, replaced or withdrawn on the requirement marks the run
out of date and queues a new one for the requirement. `POST .../rerun` starts it again
after a failure.

### Stage 2: the assessment (one model call)

The control's own tester agent (the BALANCED tier) reads the **whole stored text** of
every file that passed the gate (no excerpt cut; `evidence_extraction.MAX_TEXT` bounds a
file, `MAX_READING_TEXT` the request), each numbered by an index, with:

- the control (reference, title, activity), as data;
- the **lens**, set in code from the requirement's category and the files' kinds:
  `DESIGN_DOCUMENT` only when every included file is a design document (a policy,
  procedure, narrative or configuration standard: does the documented design require what
  the attribute tests?); otherwise `INSTANCE_RECORD` (the records of one instance, walked
  through: does this instance show it?), so a request answered by a policy and a ticket is
  judged on its records. A design document never shows that the control operated, and the
  prompt says so;
- every approved attribute, each with its letter, its wording and its person-owned
  criteria (`testing_engine.tailored_criteria`: condition, pass, exception), marked
  `expected` when the requirement links it (`evidence_requirement_attributes`).

The prompt's delimiters (`<file`, `</file>`, `<evidence>`, `<control_and_attributes>`)
are neutralised (`‹file`) wherever they occur in a file's text or name, or in the control's
data, written with `<`, `&lt;` or a look-alike bracket (`＜`, `﹤`, `〈`, `〈`, `⟨`), so no
file can close its block, open another, or forge the attributes.

For each attribute it answers, per **element**, one of:

`MET`, `PARTLY_MET`, `NOT_MET`, `CONTRADICTED` (two records that disagree with each other),
`CANNOT_TELL`, or `NOT_ADDRESSED` (this request's files contain nothing about the element;
another request may hold that evidence). A late approval, a self-approval, a wrong
approver or a date outside the period, shown by a record, is `NOT_MET` with that record's
passage and nothing named absent (nothing is missing: the record shows the element is not
met), never `CONTRADICTED`; absent names only what would have to be there and is not. All of an attribute's elements `NOT_ADDRESSED` needs a stated
reason for an `expected` attribute.

Decided by the product owner on 13 November 2026, after the first live run (prompts /5,
both roles):

- A placeholder where a document should name or state something the attribute requires
  (an approver role, a deadline, an owner: "[APPROVER ROLE(S) - TBC]") is `NOT_MET`, a
  deviation shown by the document, with nothing named absent. If an approved or final
  version of the same document is also among the request's files, the element is judged
  on that version, and the draft's placeholder is not a deviation ("Not met, unless
  approved copy"; rule 5a of stage 4 keeps the code to it).
- An element that compares people is judged on the people the records show. A missing
  approval is the shortfall of the attribute that requires it, not of another attribute.
- A person's team or role is shown only by the record's own designation of that person:
  an approval step naming the role, the ticket's assignee within its assignment group, a
  title beside the name, or the system user group; never by who wrote a note, closed the
  ticket or made the change ("Record's own designation").

The elements are set in code, so neither reading chooses what it is judged on: the
criteria's **condition** and what **passes** at this client (keys `condition` and `pass`),
where a person owns criteria; the wording alone otherwise (key `wording`). The same
attribute has the same keys and texts on every request of the control, so elements combine
across requests by key. What counts as an exception is given to the reading as the
description of failing, not as an element to be met.

Each answer carries the exact words it rests on, with the index of the file they are in
(and, where the same words occur more than once in the file, the words around them), or
names what is absent. The readings are told the quote rule exactly as the code applies it
(rule 1 of stage 4): at least four words or twenty characters, matched on whole words,
starting at a not, no, never or without among the three words before it; a short value
such as a record number is quoted with its label and the surrounding words on the same
line (or, where the whole line is shorter, another record that shows the element is
quoted). Before /5 the prompt allowed "a full value", which the match drops
("Number: RITM0048213" is nineteen characters).

### Stage 3: the blind re-performance (one model call)

The independent reviewer agent (`independent-reviewer`, the same tier and the same model
configuration, never a weaker model) gets the same files, lens and attributes and
**nothing of the first answer**: both requests are written from the run's input before
either reading is asked. Its instructions take the sceptic's side: for each element, find
the record that shows it, and say what would have to be there and is not.

### Stage 4: what stands (code only)

Applied to each agent's answer first, then to the pair. The model proposes; the code
decides what stands (the rule of evidence_mapping.py).

1. Every quote is found in the stored text of **the file it names**, strictly
   (`console_citations.find_passage`, beside the console's looser `find_quote`): on word
   boundaries at both ends, at least four words or twenty characters after folding, never
   where one of the three words before it in its clause negates it (not, no, never,
   without; the look-back stops at a cell separator ` | `, a tab, `:`, `;` or `.`, and
   "no" before a number or a full stop is a number's abbreviation) and never where it
   ends inside a token (a trailing `-`, `/`, `:` or `.` followed by a
   letter or digit). A
   quote that file does not hold is dropped, whichever other file may hold it. Where the
   words occur more than once in the file, the occurrence its context points to is the
   one located; when that cannot be told the passage still counts, located as "found in
   several places".
2. `MET` and `PARTLY_MET` need a verified quote for each element they claim. Without
   one, the element is `CANNOT_TELL`.
3. `CONTRADICTED` needs two verified passages that do not overlap and sit on different
   lines or in different files (two pieces of one line are one record), at least one of
   them support under the lens (a RECORD; or a REQUIREMENT under `DESIGN_DOCUMENT`).
   Otherwise `CANNOT_TELL`.
4. Passages are classified RECORD, REQUIREMENT, ASSERTION or INSTRUCTION (the first, third
   and fourth as evidence_mapping does; a REQUIREMENT is a document's own rule). Only a
   RECORD supports an element under `INSTANCE_RECORD`; under `DESIGN_DOCUMENT` a
   REQUIREMENT does, as does a RECORD the document carries. An unclassified passage is an
   ASSERTION. A concern wins: words the answer calls an ASSERTION or an INSTRUCTION
   anywhere are support nowhere in that answer. Code reads as an ASSERTION, whatever the
   reading called it, a passage whose own clause (each line it covers, split at ". ", "; "
   and " | "; the line break was added on 13 November 2026, so the second line of a quote
   that runs over two is read on its own) opens, after any bullet, with Remark:, Note:,
   Summary:, Comment:, Conclusion: or
   "<word> comment:", or says all of something was (or has been) obtained, approved or
   reviewed, or carries "per the <role>" or "according to" without a date, a time or a
   record id ("granted role per the approved request REQ-1041" stays a record). A line the
   deterministic guards flag is never support.
5. For an attribute the request asks for (`expected`), when a file's stored text was cut
   or a file of the request was left out by the gate, a result that rests on absence (a
   `NOT_MET`, a `NOT_ADDRESSED`, and the missing part of a `PARTLY_MET`) becomes
   `CANNOT_TELL`, with "a file was read in part" or "a file on this request has not been
   checked". An attribute the request does not link is not held to this rule. A
   **deviation** is the one exception: an element both readings find `NOT_MET`, each
   naming nothing absent for it and resting it on overlapping verified RECORD passages
   (under `DESIGN_DOCUMENT` also the document's own REQUIREMENT) from files read in
   full (a self-approval plainly in a ticket). It stands whatever else
   the request holds (compare, below), but it never escapes rule 5: on a request with a
   file left out or read in part it goes to a person; anything else is absence-based.

   5a. A placeholder ("Not met, unless approved copy", 13 November 2026): a `NOT_MET`
   resting only on placeholder text (bracketed text on its line, such as "[Approver name,
   title]", or TBD or TBC) is no deviation in a reading that rests any element of the same
   attribute on a verified passage of another document of the request. The code cannot
   tell an approved copy from another document, so any document the reading relies on
   counts as possibly that copy; a deviation needs both readings, so one such reading
   withdraws it, and where the other reading shows the element itself `MET` there never
   was one. The element stays `NOT_MET` and is compared as any other answer, with its
   reason saying why. The rule only ever withdraws an exception: it never makes support,
   so it cannot make a false `SUPPORTED`. A deviation a document shows without a
   placeholder (approval allowed after the grant) stands as before.
6. One reading's result for the attribute: any `CONTRADICTED` gives `CONTRADICTED`;
   all `NOT_ADDRESSED` gives `NOT_ADDRESSED`; every element `MET` gives `MET`; at least one
   `MET` and the rest `NOT_ADDRESSED` gives `SHOWN_IN_PART` (no shortfall: the rest may be
   another request's evidence); otherwise the weakest of the elements answered (the
   `NOT_ADDRESSED` ones left out): `MET` with `NOT_MET` or `PARTLY_MET` gives `PARTLY_MET`
   (kept for shortfalls that rest on absence); else any `CANNOT_TELL` gives `CANNOT_TELL`;
   else `NOT_MET`. An element or an attribute the answer leaves out is `CANNOT_TELL`.

Then the comparison, per attribute:

| Assessor | Reviewer | Verdict |
| --- | --- | --- |
| a deviation on an element | the same deviation (overlapping records) | every file read in full: `ISSUE` `NOT_MET`, linked or not (both `CONTRADICTED` instead: `ISSUE` `CONTRADICTED`); a file left out or read in part: `UNSETTLED`, "An exception is shown by the evidence, but a file on this request has not been checked. Your judgment is needed.", both readings' passages in `views` |
| `MET` | `MET` (both with verified passages) | `SUPPORTED` |
| `SHOWN_IN_PART` | `SHOWN_IN_PART`, on the same elements | `PARTLY_SUPPORTED`, except: linked and no other D&I request of the control links it: `ISSUE` `PARTLY_MET`, naming the elements not shown |
| `PARTLY_MET` | `PARTLY_MET`, on the same elements, linked, another D&I request links it too, and every element answered `MET`, `NOT_ADDRESSED` or `PARTLY_MET` (half shown) | `PARTLY_SUPPORTED` (result `SHOWN_IN_PART`; the elements not met count as not shown). An element answered `NOT_MET` bears on these files and is not shown by them: `ISSUE` `PARTLY_MET` |
| the same `CONTRADICTED` | | `ISSUE` |
| the same `PARTLY_MET` or `NOT_MET`, attribute linked | | `ISSUE` |
| the same `PARTLY_MET` or `NOT_MET`, attribute not linked | | `NOT_ADDRESSED`, "This request does not ask for this attribute; what the readings found is shown for reference.", both views |
| `NOT_MET` | `PARTLY_MET` (or the other way round), attribute linked | `ISSUE` `PARTLY_MET` ("Issue: met in part", 13 November 2026): both readings find it falls short, one wholly and one in part; the issue keeps both readings' passages and what they name absent, and carries both views. Rule 5 comes first, and the reading that finds it not met answers an element `NOT_MET`, which keeps the issue wherever else the attribute is asked for |
| `NOT_MET` | `PARTLY_MET` (or the other way round), attribute not linked | `NOT_ADDRESSED`, shown for reference with both views, as an agreed shortfall on it is (approved 13 November 2026: an unlinked attribute is an issue only for a deviation or a contradiction) |
| `NOT_ADDRESSED` | `NOT_ADDRESSED` | `ISSUE` if linked (the evidence does not address what its request said it would), else `NOT_ADDRESSED` |
| anything else, including either `CANNOT_TELL` | | `UNSETTLED` |

`PARTLY_MET` against `NOT_MET` was `UNSETTLED`, linked or not, before 13 November 2026.
`SHOWN_IN_PART` on different elements, and `PARTLY_MET` on different elements of an
attribute another request also asks for, are `UNSETTLED`. A
requirement with no links at all has every attribute unlinked. `SUPPORTED` always carries
the result `MET` and at least one verified passage from each reading. "Another D&I request
links it" is part of the run's basis (`elsewhere_attribute_ids`): a change there puts the
run out of date. Only a DESIGN requirement that still expects evidence counts (planned,
waiting on another or requested; not waived or removed, not a proposed addition nobody
accepted, not on a cancelled request, in a D&I phase that applies).

There is no third agent and no tie-break. `UNSETTLED` goes to a person with both views.

Both readings are asked with one request builder (`reading_request`, which the evaluation
set's scorer uses too). An answer whose `attributes` arrives as the text of its JSON is
read as the JSON it is (`models.unnested`, as the planner's answer is: the first live run,
13 November 2026, lost three readings, and so three cases, to it); every check applies to what is
read, and the call's record keeps what the provider returned and says it was re-read. A
reading whose answer was cut off at its allowance (8,192 output tokens for the first
engine; 12,000 from engine 2, whose answer is larger: section 10.4) (the provider's
stop reason, or JSON text that ends part way) is asked once more with 16,000 and 300
seconds, the same prompt, as a model call of its own through the same budgets and with the
claim's lease extended; the cut-off call stays on record (`NOT_USED`, asked again) and is
never read. An answer that is whole but of the wrong shape is not asked for again.

A reading that gives no usable answer (the call failed, was cut off again, did not match
the schema, or was rejected by the checks) settles nothing: the run is FAILED, nothing of
it is shown, and a person runs it again. The second reading is not asked for when the
first gave nothing.

### Stage 5: what a person sees

- `SUPPORTED`: the attribute, the passages both readings rest on, each with its file, and
  what it shows for D&I: `IMPLEMENTATION` when the run reads the records of an instance
  and every element shown rests, in both readings, on a passage of a file that is itself
  such a record; `DESIGN` otherwise (a policy or procedure requires it). The verdict is
  `SUPPORTED` either way; the screen counts an attribute as evidenced for D&I only where
  implementation is shown.
- `PARTLY_SUPPORTED`: the elements both readings find shown, with their passages; never a
  finding. Elements combine across requests by key: an attribute is evidenced when every
  element is shown (implementation) by some accepted request.
- `ISSUE`: recorded as an evidence finding (source `ASSURANCE`), once per requirement,
  attribute and basis, so the existing accept, edit, follow-up and resolve loop applies.
  The finding states the attribute's letter and what is not shown (for part shown, the
  elements not shown); for a deviation it names the element and quotes the record ("Not
  met: approved by someone other than the requester. The ticket shows “...”."). The question it proposes for the
  control owner is written from the firm's own attribute wording, never from the model's
  words. From engine 2, where the run's review holds a follow-up for the attribute, the
  question is that follow-up's request instead (section 10.5, item 5), and an issue a
  comparison made in code decided says so in its observation.
- An issue a person already has in hand (accepted, sent, answered, asked again,
  escalated) is never marked stale by a client's reply or upload: the reading that arrives
  attaches to it (matched on its requirement where it rests on several files) and proposes
  ANSWERED, and the next run's result is attached to it on its history, named as it is
  (supported, contradicted, not met, met in part, not settled; a run that supports the
  attribute proposes ANSWERED, "a person decides"); no second finding is
  raised for the attribute. No agent closes a finding. A finding nobody acted on goes stale
  with its run.
- `UNSETTLED`: shown with each reading's result and reason. Never a finding, never
  counted as support. Its sentence says why it is open (14 November 2026; the product
  owner: "The explanation should be very clear"), and never that the readings disagree
  where they agree:
  - the readings differ: "The two readings do not agree. Your judgment is needed.";
  - neither could tell: "Neither reading could tell from these files. Your judgment is
    needed.";
  - a reading did not finish: "A reading did not finish, so this is not concluded. Run the
    check again, or judge it yourself.";
  - both left it open only because a file of the request was not read (`pending`
    `FILE_NOT_READ`): "Not concluded yet. <file> has not been read, and what the other
    files do not show may be in it. The check runs again once it is read." The row reads
    "Waiting on a file", not "Your judgment needed": the file is waited on, not a choice
    between readings. Read only in part (`pending` `READ_IN_PART`) stays a person's
    judgment, with the file named.
  Each reading's reason names the file too ("<file> has not been read yet, so nothing can
  be concluded as missing: it may be in that file.").
- For a file the chain covers (a file its readings include), the reader's own
  model-derived findings (source `READER`: gaps, partial and uncovered items) are **not**
  proposed to a person: they were never checked by a second reading. The reader's answer
  stays on the reading's record. Those already proposed and not yet decided when the
  chain comes to cover the file (a kind confirmed later) are marked stale with the reason;
  a finding a person already decided is left as it is. The deterministic checks (source
  `RULES`: placeholder text, version, dates) stay: they are facts located in the text. A
  reading by the rules is not the model's, and its findings are left as they are.
- While a run works, the row says so. Nothing of a run is shown before it finishes. A run
  whose worker stopped before it finished reads as FAILED, "The check stopped before it
  finished.", so the person can check again.

Coverage on the D&I list: an attribute is *evidenced* by a request's files only when the
run is `SUPPORTED` for it **and** a person accepted the requirement's evidence. The agents'
`SUPPORTED` alone is "ready for you to accept".

## 4. Records (migration)

`evidence_assessments` (migration 0155), one row per run, never updated once finished
except to be marked out of date:

- identity: organization, project, control, requirement, phase;
- basis: every file in force on the requirement when the run was recorded (`files`: its
  id, name, content hash, the hash of its stored text, its kind, whether it was read in
  part, and the gate's code and sentence where it was left out), the files the readings
  include (`file_ids`), a hash of the attributes as assessed (each id, letter, wording
  and criteria), the requirement's linked attribute ids, the attributes another DESIGN
  requirement of the control links too (`elsewhere_attribute_ids`, migration 0156), the
  control's facts, the lens,
  both prompt versions, the model configuration the run would use (`models`), and one
  hash over all of it;
- state: `PENDING`, `WORKING`, `HELD`, `READY`, `FAILED`; the stage reached; lease and
  attempts as evidence_analyses has them, and the claim's owner token (`claim_token`: only
  the worker holding the claim saves, fails or resets the run; an exception after the claim
  puts it back in the queue, whichever worker ran it); the gate's code and sentence when
  the whole run is held; why it failed when it did;
- the two checked answers (never the raw model output), each with its model call id, and
  the model configuration the readings ran on (`ran_with`);
- the outcome per attribute (verdict, result, passages with their file and location, what
  is absent, both views when unsettled or shown for reference, what it shows for D&I, and
  each element as the readings agree on it);
- `stale_at` and `stale_reason` when a file is added to, replaced on or withdrawn from
  the requirement, a file is read again with another text or kind, an attribute's wording
  or criteria changes, the attribute list changes, the requirement's links change, the
  attributes other D&I requests link change, the control's description changes, or the
  model configuration changes. A stale run is shown
  as out of date and a new run is queued while a file is still in force on the
  requirement.

A finished run (`HELD`, `READY`, `FAILED`) is only ever marked out of date, once, and an
out-of-date run is never changed (a trigger refuses both); a run is never deleted. A run
still queued is brought up to date in place.

Idempotent: there is one current run per requirement, and the same basis is never run
twice; asking again returns the run on record. The start-up
backfill keeps, per DESIGN requirement, the basis it last tried
(`evidence_assessment_backfill`, migration 0156), bookkeeping that decides nothing. When a basis comes back (a link removed
and restored), the earlier reviewed run of that basis is copied into a new run
(`reused_from_id`), with no model call, only where it ran on the very model configuration
the basis names (a model change never reuses a run). Partial reuse of single attributes'
results is not built.

`evidence_findings` gains the source `ASSURANCE`, the kinds `NOT_MET`, `PARTLY_MET`,
`CONTRADICTED` and `NOT_ADDRESSED`, and `assessment_id` (the run a finding rests on), by
migration (never by silently widening a check). An `ISSUE` is recorded once per
requirement, attribute and basis, pinned to its run; when the run goes out of date its
findings nobody acted on are marked stale, as a replaced file's are, and one a person has
in hand is kept and gets the next run's result attached. Where the finding of a basis went
stale and that basis comes back, the issue is recorded again for the new run. A plan
approved again does not mark them stale: they are pinned to the run's basis, not the
plan's revision.

Every model call goes through `provenance.AgentCaller` (budgets, trial reservations,
cancellation, the provenance record), both readings in one job. A run that cannot pay for
both readings does not start the first one (`AgentCaller.refusal_for`): it is FAILED with
the reason, and no call is made or recorded. A reading asked again after its answer was
cut off is a further call in the same job (`inputs.retry_of` names the call it replaces);
it is not in that first sum, and passes the budget checks itself when it is made.

## 5. Pure core (for tests and the evaluation set)

In `evidence_assurance.py`, with no database:

```python
ElementResult = Literal["MET", "PARTLY_MET", "NOT_MET", "CONTRADICTED", "CANNOT_TELL", "NOT_ADDRESSED"]
Result = Literal["MET", "SHOWN_IN_PART", "PARTLY_MET", "NOT_MET", "CONTRADICTED", "CANNOT_TELL", "NOT_ADDRESSED"]
Verdict = Literal["SUPPORTED", "PARTLY_SUPPORTED", "ISSUE", "UNSETTLED", "NOT_ADDRESSED"]
Lens = Literal["DESIGN_DOCUMENT", "INSTANCE_RECORD"]
Role = Literal["ASSESSOR", "REVIEWER"]
Shows = Literal["DESIGN", "IMPLEMENTATION"]
PassageBasis = Literal["RECORD", "REQUIREMENT", "ASSERTION", "INSTRUCTION"]
HeldCode = Literal["CUSTODY", "READ_FAILED", "UNREADABLE", "KIND_UNSURE", "POPULATION", "NO_ATTRIBUTES", "TOO_LARGE"]
# Prompt versions: evidence-assurance-assessor/7, evidence-assurance-reviewer/7 (14 November 2026;
# an engine 1 run carries /5: ENGINE_PROMPTS)

@dataclass(frozen=True)
class AttributeSpec: id: UUID; code: str; text: str; criteria: dict[str, Any] | None; expected: bool; linked_elsewhere: bool = False

@dataclass(frozen=True)
class FileSpec: id: UUID; name: str; kind: str; text: str; truncated: bool; sha256: str; kind_unsure: bool = False

@dataclass(frozen=True)
class ChainInput:
    control_ref: str; title: str; activity: str; lens: Lens
    attributes: tuple[AttributeSpec, ...]
    files: tuple[FileSpec, ...]          # the files the readings include, in prompt order
    files_left_out: bool = False         # a file of the request was held by the gate
    categories: tuple[str, ...] = ()     # the requirement's, for each file's own lens
    left_out_names: tuple[str, ...] = () # the files left out, for the sentences that name them
    context: ControlContext | None = None  # engine 2 (10.2); None reads as a thin understanding
    left_out: tuple[LeftOut, ...] = ()   # engine 2: each file left out, with the gate's code and sentence

@dataclass(frozen=True)
class GateFacts: custody_failed: bool; readable: bool; kind: str; kind_confirmed: bool; confidence: str; source: str; read_failed: bool = False

def gate(facts: GateFacts, engine: int = 1, *, population_asked: bool = False) -> Held | None: ...   # one file, as an engine reads it
def run_gate(files: Sequence[tuple[Held | None, int]], attributes: int) -> Held | None: ...   # the run
def lens_for(categories: tuple[str, ...], kinds: Sequence[str]) -> Lens: ...
def elements_of(attribute: AttributeSpec) -> tuple[tuple[str, str], ...]: ...   # (key, text)
def prompt_for(chain: ChainInput, role: Role) -> tuple[str, str]: ...   # (system, prompt)
def reading_request(system: str, prompt: str, *, retry: bool = False) -> ModelRequest: ...   # both readings, database run and scorer
def cut_off(status: str, raw: ModelRaw, schema: dict[str, Any] = OPINION_SCHEMA) -> bool: ...   # ask again with more room
def check_opinion(output: dict[str, Any], chain: ChainInput) -> Opinion: ...   # rules 1 to 6; engine 2: facts, checks, asks, remarks, files
def attribute_result(elements: Sequence[ElementView]) -> Result: ...   # rule 6
def compare(first: Opinion, second: Opinion, chain: ChainInput) -> tuple[Outcome, ...]: ...
def review_of(first: Opinion, second: Opinion, chain: ChainInput, outcomes: Sequence[Outcome],
              previous_follow_ups: Sequence[Mapping[str, Any]] = ()) -> tuple[tuple[Outcome, ...], dict[str, Any]]: ...   # engine 2 (10.5 to 10.7)
def run_chain(ask: Callable[[Role, str, str], dict[str, Any] | None], chain: ChainInput,
              previous_follow_ups: Sequence[Mapping[str, Any]] = ()) -> ChainResult: ...
```

Engine 2 (section 10) adds, all with defaults so a chain built without them still runs:
`ControlContext` (assurance_context.py: `statement`, `risk`, `control_type`, `nature`,
`frequency`, `performer`, `reviewer`, `owner`, `system`, `period_from`, `period_to`,
`understanding` (a tuple of `UnderstandingFact(ref, question, answer, kind, confirmed_at,
confirmed_by)`), `request_title`, `request_description`; `thin`, `period`, `as_prompt()`,
`sha256`); on `Opinion`: `files`, `facts`, `facts_dropped`, `checks`, `asks`, `remarks`;
on `Outcome`: `assessment` and `checks`; on `ChainResult`: `review` (the object of 10.7;
None when a reading gave no usable answer). `run_chain` is `compare` followed by
`review_of`: the outcomes it returns are the ones code lets stand.

`Outcome` has `attribute_id`, `code`, `expected`, `verdict`, `result` (the agreed one, or
None when the readings differ or what they agree on is shown for reference), `passages`
(each with its `file_id`), `absent`, `views` (both, when unsettled or for reference),
`summary` (one sentence, written in code), `shows`, and `elements` (each element as the
readings agree on it: `key`, `text`, `result` or None, `passages`, `absent`, and
`deviation` where both readings rest its NOT_MET on the same record). `ChainResult`
has `outcomes`, `first`, `second` (the two checked `Opinion`s), and `failed` and `reason`
when a reading gave no usable answer. `run_chain` is the gate's successor stages only
(assess, re-perform, compare); an `ask` that returns None for either role gives every
attribute `UNSETTLED` with the reason, never a guess. `check_opinion` raises `ValueError`
for an answer of the wrong shape, which `run_chain` treats as no answer.

The reviewer's prompt never contains anything from the assessor's answer. A test asserts it.

## 6. API

`GET /organizations/{o}/projects/{p}/controls/{c}/evidence-assurance` (project.read):

```json
{
  "requests": [
    {
      "requirement_id": "…", "run_id": "… or null",
      "status": "NOT_CHECKED | QUEUED | CHECKING | HELD | REVIEWED | FAILED | OUT_OF_DATE",
      "stage": "GATE | ASSESS | VERIFY | COMPARE | DONE",
      "held": { "code": "KIND_UNSURE", "reason": "…" },
      "held_files": [ { "file_id": "…", "code": "READ_FAILED", "reason": "…" } ],
      "file_ids": [ "…" ],
      "lens": "INSTANCE_RECORD",
      "read_in_part": false,
      "attributes": [
        {
          "attribute_id": "…", "code": "B", "expected": true,
          "verdict": "SUPPORTED | PARTLY_SUPPORTED | ISSUE | UNSETTLED | NOT_ADDRESSED",
          "result": "MET | SHOWN_IN_PART | PARTLY_MET | NOT_MET | CONTRADICTED | NOT_ADDRESSED | null",
          "summary": "…",
          "shows": "DESIGN | IMPLEMENTATION | null",
          "passages": [ { "quote": "…", "file_id": "…",
                          "location": { "label": "Page 3", "page": 3, "sheet": null,
                                        "row": null, "column": null, "cell": null } } ],
          "absent": [ "…" ],
          "views": [ { "role": "ASSESSOR", "result": "MET", "reason": "…", "passages": [] },
                     { "role": "REVIEWER", "result": "NOT_MET", "reason": "…", "passages": [ … ] } ],
          "elements": [ { "key": "condition", "text": "…", "result": "MET | … | null",
                          "passages": [ … ], "absent": [ "…" ] } ],
          "finding_id": "… or null",
          "finding_status": "PROPOSED | ACCEPTED | … | null"
        }
      ],
      "out_of_date": [ "…" ],
      "finished_at": "…",
      "note": ""
    }
  ],
  "summary": { "not_checked": 0, "checking": 0, "held": 0, "failed": 0, "out_of_date": 0,
               "supported": 0, "partly_supported": 0, "issues": 0, "unsettled": 0 }
}
```

One entry per DESIGN requirement that has a file in force: its latest run, or
`NOT_CHECKED` (with `run_id` null, `held` null, `file_ids`, `held_files` and `attributes`
empty) where it has none. From engine 2 each entry also carries `engine_version` and
`review`, and each attribute `assessment` and `checks` (section 10.7); nothing above is
removed or renamed.

- `held` is null unless the whole run is HELD. `held_files` lists every file the readings
  did not include, each with its code and sentence: a file its own gate held, and, when
  the whole run is held, every file of the request (with its own code, or the run's for a
  file that passed its own gate). `file_ids` lists the files the readings include; it is
  empty for a run held whole. Together `file_ids` and `held_files` cover every file that
  was in force on the requirement when the run was recorded: a file in neither arrived
  later and is not part of this check (the entry is then `OUT_OF_DATE`, or a new run is
  about to be queued).
- Every `file_id` (in `file_ids`, `held_files` and each passage) is the evidence file id
  the evidence plan's requirement body lists in `files[].file_id`.
- `views` is empty unless UNSETTLED, shown for reference (an unlinked attribute's
  agreed shortfall), or an ISSUE the readings split on (one `NOT_MET`, one `PARTLY_MET`;
  the D&I screen's model, apps/web/src/evidence-assurance-model.ts, still keeps views only
  for UNSETTLED and NOT_ADDRESSED); a view's `passages` are filled only for an exception shown on a
  request with a file not checked (the passages each reading rests it on); `attributes` is empty unless the run is REVIEWED (nothing of a run is
  shown before it finishes, and nothing of one that is out of date). `SUPPORTED` always
  carries `result` `MET` and at least one passage. `shows` is set only for `SUPPORTED` and
  `PARTLY_SUPPORTED`.
- `elements`: each element by the key and text set in code (the same on every request of
  the control), with the result both readings agree on, or null where they differ; every
  element whose result is `MET` carries its own verified passages.
- `finding_id` and `finding_status`: the finding of an ISSUE, or the finding a person has
  in hand from an earlier run to which this run's result was attached; null otherwise.
- `out_of_date` is non-empty only when `status` is `OUT_OF_DATE`: one plain sentence for
  each thing that changed. A finished run is compared with what would be read now each
  time it is read, so a change nothing marked yet still shows as out of date.
- `note` says in a sentence why a FAILED run stopped ("The check stopped before it
  finished." for a run whose worker stopped); it is empty otherwise.
- `read_in_part` is true when any included file's stored text was cut.
- Every `reason` and sentence is plain, with no codes.
- `summary`: `not_checked`, `checking`, `held`, `failed` and `out_of_date` count requests;
  `supported`, `partly_supported`, `issues` and `unsettled` count the attribute verdicts of
  the reviewed requests, `issues` only while the finding is open (or has none).

`POST .../evidence-assurance/{requirement_id}/rerun` (task.update): starts the check for a
NOT_CHECKED, FAILED or OUT_OF_DATE request (a run that stopped is failed first). Success is
202 with the request's entry (the shape above). A request whose reviewed or held run still
rests on the same basis is returned as it is (the same basis is never run twice). Refused
with 409, whose `detail` is one plain sentence, while a run is queued or working ("The
check is already running."), while a file of the request is still being read, or when no
file is on the request. Another firm gets 404, as does a requirement that is not a DESIGN
requirement of the control; a Reviewer reads and cannot rerun (403).

The evidence findings API (`evidence_findings.FindingBody`) gains the source `ASSURANCE`,
the four kinds, and `assessment_id`.

## 7. Screen (D&I Evidence, the one list)

No new panel. On each request row of the list (design-evidence.tsx):

- while a run works: the row's quiet line reads "Checking against attributes A, B …";
- held: one line with the reason and the one action that clears it;
- reviewed: beside each attribute letter on the row, its state in words and a mark, never
  colour alone: supported, issue, your judgment needed. The row's body lists, per
  attribute, the passage (opening it in the file where the viewer can) or what is absent;
  for an unsettled one, both readings side by side with "Your judgment is needed";
- an issue is the existing finding, with its existing actions;
- Accept stays the person's, and says what accepting will mark as evidenced.

The UI acceptance checklist of docs/design-system.md applies: no full-page reload, state
kept, motion short and off under reduced motion, both themes, no horizontal overflow at
1366 and 1440.

## 8. Evaluation set

Synthetic files with known answers, never client evidence: a complete policy, a policy
missing one required element, a draft with placeholders, a document for another system, a
walkthrough instance that shows every attribute, one with the approval after the grant, a
self-approval, a period outside the audit period, two records that contradict, a summary
that asserts without records, a file carrying instructions aimed at the agent, a file read
in part, a file whose request links the wrong attributes, and (from 13 November 2026)
`assigner_team_not_designated`: the complete walkthrough with the role assigned by someone
no record designates as a member of SAP Security (the ticket in the SAP Security queue
and closed by him, no assignee, no title), so C is an `ISSUE`, met in part.

- With scripted model answers (in the fast and critical tiers): the code's rules. A false
  quote never supports; an unverified `MET` never stands; disagreement is `UNSETTLED`; the
  reviewer is blind; nothing reaches a person from one reading alone.
- With the live model (a command a person runs, never a tier: it spends money): each case
  scored per attribute. Reported separately: false `SUPPORTED` (the error that matters
  most), false `ISSUE`, `UNSETTLED` rate, and the cost per file. The first live figures
  are recorded here with their date, model and prompt versions.

### The first live run, 13 November 2026

All 20 cases, `claude-sonnet-5-5` (the BALANCED tier) for both readings, prompts
`evidence-assurance-assessor/4` and `evidence-assurance-reviewer/4`, a $5 cap: $2.19 spent
(697,833 input and 79,918 output tokens, $0.067 a file).

| Measure | Result |
| --- | --- |
| Cases scored | 17 of 20; 3 failed (a reading's `attributes` arrived as JSON text) |
| Attributes scored, correct | 64, 52 |
| False `SUPPORTED`, false `IMPLEMENTATION` | 0, 0 |
| False `ISSUE` | 7, all attribute C, both readings `PARTLY_MET` |
| Missed `ISSUE`; `ISSUE` with a result the case does not accept | 1; 1 |
| `UNSETTLED` | 10 (15.6%), 4 of them not acceptable |
| Readings agree | 59 of 64 (92.2%) |

What it showed, and what was done the same day:

- The three failed cases (`policy_complete` and `three_files_together`, the second
  reading; `walkthrough_approver_granted`, the first): "answer.attributes: expected array,
  got string", at 1,039 to 3,581 output tokens, well inside the allowance. Mended in the
  request (stage 4): read as written, and a reading cut off is asked once more with more
  room.
- The seven false issues: attribute C ("The requester, the approvers and the person who
  granted the access are different people"), whose criteria pass when "Neither approver is
  the requester or the user who receives the access, and the role was assigned by a member
  of SAP Security who did not approve the request." In each of the seven cases (and in
  `three_files_together`) no record designated the person who assigned the role (Tomas
  Nguyen, TNGUYEN) as a member of SAP Security: the ticket held only "Assignment group: SAP
  Security" (the queue, not the person), and his activity (a work note, the closure, the
  SAP change document) shows what he did, not his team. The careful reader's answer said "The role was
  assigned by SAP Security" and quoted nothing that shows it. The readings did accept the
  records' own designations elsewhere (the approval step "Role owner approval -
  Z_FI_AP_CLERK", the ticket's HR manager field: B was supported by both in
  `walkthrough_complete`). The fault was the cases': a ServiceNow requested item names its
  assignee beside its assignment group, and the eight cases now carry "Assigned to: Tomas
  Nguyen (TNGUYEN)", which the careful answer quotes. No prompt or rule changed. Reading a
  team from who worked or closed a ticket is no designation and was not adopted: in
  `walkthrough_approver_granted` an approver outside SAP Security worked and closed a
  ticket assigned to SAP Security.
- Left for the product owner that day, decided later the same day and built as prompts /5
  (stage 2, rule 5a and the comparison table): `policy_draft_placeholders` B (`ISSUE`
  `PARTLY_MET`, the case expects `NOT_MET`): a placeholder where the approvers should be
  named is a deviation in code under `DESIGN_DOCUMENT`, but the prompt's list of
  deviations did not name a placeholder, so the readings most likely named the approvers
  as absent ("Not met, unless approved copy"). `remark_all_approvals_obtained` B (missed):
  `NOT_MET` against `PARTLY_MET` on an absence (no record of the role owner's step at all)
  was `UNSETTLED` by the comparison table ("Issue: met in part").
  `remark_all_approvals_obtained` A and `split_request_ticket_only` A (`UNSETTLED`): each
  second reading lost exactly one quote to the strict match; the prompt allowed "at least
  four words or a full value", the match needs four words or twenty characters, and the
  ticket's own "Number: RITM0048213" (19 characters) is dropped (likely, not proven: the
  result file did not keep the readings' answers; it does now) (the quote rule stated
  exactly). `single_word_inside_unapproved` D (`UNSETTLED`): D's condition reads "the
  role approved in the ticket", and with the role owner's step Unapproved the second
  reading found D met only in part, B's shortfall read into D's wording (a missing
  approval is its own attribute's shortfall). The designation rule ("Record's own
  designation") states what the cases' correction above relied on.

What the /5 rules changed in the set's expectations (13 November 2026): the new case
`assigner_team_not_designated` (C an `ISSUE` `PARTLY_MET`); `policy_draft_placeholders`
C's careful answer names nothing absent for its placeholder section, as the placeholder
rule asks (its verdict, `ISSUE` `NOT_MET`, now rests on the deviation); and C in
`instructions_to_ai`, `remark_all_approvals_obtained` and `single_word_inside_unapproved`
no longer accepts `UNSETTLED`, since the missing role owner approval is now stated to be
B's shortfall, not C's. No other verdict changed: `remark_all_approvals_obtained` B already
accepted `PARTLY_MET`.

## 10. Engine 2: sufficiency, checks in code, follow-ups (14 November 2026)

Asked for by the product owner on 14 November 2026: the check should answer the question a
senior IT auditor answers, "has sufficient appropriate evidence been obtained for what this
request tests, and if not, exactly what is missing", grounded in the approved control
understanding, with objective comparisons made in code, and never by agreement of two
readings alone. Everything in sections 1 to 9 stands unless this section changes it. The
three stages (read and classify, place, check), the two blind readings, the findings and a
person's decisions are kept; no agent, queue, screen or approval stage is added.

### 10.1 Forward only

`evidence_assessments.engine_version` (migration 0160; existing rows are 1, new runs 2).

- A run is compared with what is in force **as its own engine reads it**: an engine 1 run
  keeps the engine 1 gate, hash inputs and prompt versions (/5), so the upgrade marks no
  run out of date and queues nothing. No historical evidence is read again, no finding is
  reopened, no accepted evidence needs a new decision.
- A new run is recorded only for an event that already records one (a file added, replaced,
  withdrawn or restored, a kind confirmed, an attribute or a link changed, a person's
  "Check again"). It is an engine 2 run. The earlier run is kept, out of date, as before.
- Engine 1 results are shown exactly as before. The new parts of the API (10.7) are absent
  for them.

### 10.2 The control's context (what the readings are given)

Besides the control's reference, title and activity, both readings get, as data inside
`control_and_attributes` under `understanding` (delimiters made inert as for everything
else placed there):

- the control as designed: its statement with the organization's values in place, the risk
  it addresses, type, nature, frequency, who performs, reviews and owns it, where known;
- the system the control is tested on and the audit period (from, to), where known;
- the confirmed understanding (understanding_authority.facts, as its agents get it: the
  walkthrough answers, the control's values and the answered questions, newest first, at
  most 40);
- what this request asked for: the requirement's title and description.

The context's hash is part of an engine 2 run's basis: a change to it puts the run out of
date ("The control's understanding changed."). Where the understanding is thin (no
confirmed fact), the readings are told so and the result says so (10.6, `context_thin`);
they never fill it in. The rules add: judge each element against the process the
understanding describes, not against the presence of a word; do not add a requirement
that neither the attributes nor the understanding state.

As built (assurance_context.py; `load_context` in evidence_assurance.py): the design is
`control_design.design_for` (its statement, risk, type, nature, frequency, operator,
reviewer and owner; none of it for a control with no library statement), the system is
the control's application (`engagement_applications.name`), the audit period is the
engagement's (`engagement_settings.period_start` and `period_end`), and the request is the
requirement's own title and description. Every text is one bounded line (statement 1,500
characters, risk 600, a fact's question 220 and answer 500, the request's title 300 and
description 1,500). The hash is taken from the very form the prompt carries, without each
fact's ref (its place in the list) and with the facts in an order of their own, so the
same understanding always gives the same hash. The hash is compared like any other part
of the basis: the queueing that follows a person's change (`follow_control`, which the
walkthrough's own route already calls) marks the engine 2 run out of date and records the
run that reads the understanding as it now stands; a change nothing told the queueing
about (the audit period) shows as out of date when the list is read. An engine 1 run has
no context, and no change to it ever puts that run out of date.

### 10.3 The gate

For engine 2 a file whose kind is not sure (`KIND_UNSURE`) is **read**, as the kind the
reader took it for, and the run lists it under `confirmations` (the person still confirms
its kind, which records a new run only if the kind changes the lens). Custody, a reading
that did not finish and a file with nothing readable stay hard stops. A population is left
out of a single-instance item as before, with the reason said by purpose ("a population
shows who or what is in scope, not that one instance was performed"); it is read where the
item itself asks for a population.

As built: an item asks for a population when its categories name `POPULATION`
(`evidence_requirements.categories`; `gate(facts, 2, population_asked=True)`). The
confirmations of a reviewed run are given by the API only for the files whose kind is
still not sure: a person who confirms the very kind the reader took changes nothing a
run rests on, so no run is recorded, and the file is no longer listed. The evidence
wizard still holds an unsure file to the first engine's rule before it places it (a
person places it); its sentence no longer says the check waits for the kind ("The reader
is not sure what kind of evidence this file is. Confirm its kind, or choose the item it
belongs to.").

### 10.4 What a reading answers in addition (prompts /6)

Each reading still answers every attribute, element by element (section 3). It adds, all
optional and capped:

- `files`: for each file index, `relevance` (RELEVANT, PARTLY_RELEVANT, NOT_RELEVANT,
  CANNOT_TELL; with one sentence), `source` (SYSTEM_RECORD: a system's own record, log,
  export or screen; MANAGEMENT_PREPARED: prepared by a person, such as a spreadsheet or a
  memo; DOCUMENT: a policy, procedure or narrative; UNKNOWN), `legibility` (CLEAR,
  PARTLY_UNREADABLE, UNREADABLE; with what could not be read), and for a report, listing
  or extract whether it shows its source, run date and parameters (`report_basis`: SHOWN,
  PARTLY_SHOWN, NOT_SHOWN, NOT_A_REPORT).
- `facts` (at most 24): facts the records state, each `id` ("F1"), `kind`, `value`, the
  file's index and the exact `quote` it is read from. Kinds: SUBJECT (the user, change or
  transaction the instance is about), REFERENCE (a ticket, request or change number),
  REQUESTED (what was asked for or approved), PERFORMED (what was actually granted, changed
  or done), APPROVER, PERFORMER, APPROVED_AT, PERFORMED_AT, TRIGGER_AT (the event that
  starts the clock: a termination date, a request date), SYSTEM, EXTRACTED_AT, PERIOD_FROM,
  PERIOD_TO, VALUE (a configured or reported value).
- `checks` (at most 12): the comparisons an element calls for, each naming the attribute's
  code, the element's key, a `test` and the two facts: NOT_AFTER (left is at or before
  right), BEFORE, SAME, DIFFERENT, WITHIN_DAYS (with `days`), IN_PERIOD (left within the
  audit period). The reading names the comparison; **code makes it** (10.5).
- `follow_ups` (at most 8): for an element the files do not show, the missing fact, why it
  matters to the test, the specific record or clarification to ask for, an acceptable
  alternative, `kind` (EVIDENCE or CLARIFICATION), `priority` (HIGH, MEDIUM, LOW), and
  whether it may be in the files already (`may_be_in_files`).
- `considerations` (at most 5): something a careful auditor would raise that no attribute
  asks about (a screenshot of the current state offered as proof of a past event, a report
  with no parameters), each with a quote.

The rules tell both readings: a follow-up is asked only for something an approved
attribute's element needs and the files do not show; say when nothing more is needed; a
consideration is an observation, never a new requirement.

Prompts /7 (14 November 2026, evidence annotations; docs/evidence-annotations.md, section
2) add two optional parts that describe what is quoted and change no result: each quote
of an element may carry `shows`, one plain sentence of at most 200 characters saying what
the passage shows for the element, with values as the file writes them; and each `files`
entry may carry `quote` (with `context`), the file's own words that show where it comes
from (who captured or exported it, a report's run line). As built: `shows` is kept on the
passage as one bounded line and dropped whole where it holds a secret, an address or a
link (`said_sentence`); a file's `quote` is kept only where it is found, strictly, in the
file it is said of and not on a line the guards flag (`Opinion.sources`). Neither is part
of the checked answer on record, and no verdict, fact, comparison, follow-up or finding
reads them: the same two answers give the same outcomes and the same review with or
without them. Every /6 rule is kept. An engine 2 run recorded under /6 reads as out of
date ("The check's instructions were updated.") and is run again by the event or the
person that starts a check, as after any change of the instructions.

As built: a reading's allowance is 12,000 output tokens (8,192 before), since the answer
now also carries these parts; a reading cut off is still asked once more with 16,000. An
entry of one of these parts that is not of its shape (a kind or a test outside its
vocabulary, a missing quote) is left out and, for a fact, counted; it never rejects the
reading, whose elements are held to their own shape exactly as before. Nothing in these
parts can make support.

### 10.5 What code decides

Applied after the rules of section 3, stage 4:

1. **Facts.** A fact stands only if its quote is found in the file it names (rule 1) and its
   value is in that quote. Dates are parsed in code; a date whose day and month could be
   read either way is not compared. As built, the quote must also sit on a line that is a
   record: never one the deterministic guards flag, nor one code reads as someone's
   account (a remark, a note, "all approvals were obtained"). What never shows an element
   never shows a failure of one either. A reading's dropped facts are counted
   (`facts_dropped`).
2. **Checks.** Each named comparison is made in code on each reading's own facts: PASS, FAIL
   or NOT_RUN (a fact missing or not parseable), with one sentence that states the values
   ("Approved 11 January 2027, performed 10 January 2027: the approval is after.").
   - Both readings name the same comparison for the same element and it FAILS on both, on
     values that agree: the element is not met, a deviation shown by the records, whatever
     either reading answered. The attribute is an `ISSUE` (`NOT_MET`), and its summary says
     a check of the records shows it. **Two readings that both say MET do not stand
     against it.**
   - It fails on one reading only: the attribute is not supported. `UNSETTLED`, with the
     sentence.
   - A check that passes supports nothing by itself: support is still two agreed MET
     answers on verified passages.
   - As built: a comparison is made only where it is named for an element of the run's
     attributes. A failure on both readings makes the element a deviation with the
     passages its facts are read from, and the summary reads "A check of the records
     shows attribute C is not met: <sentence>". Beside a file left out or read in part it
     follows item 4, as any exception does: `UNSETTLED` with the sentence and "<file> has
     not been read yet and may answer it. Your judgment is needed.", assessment
     `CONTRADICTED`, outcome `POTENTIAL_EXCEPTION`.
3. **Code's own checks**, on facts both readings state alike: the SYSTEM a file names is not
   the control's system (`WRONG_SYSTEM`), or the files name different SUBJECTs for one
   instance (`DIFFERENT_SUBJECT`): an attribute whose passages are all in such a file is not
   supported (`UNSETTLED`, with the sentence). A date outside the audit period
   (`OUTSIDE_PERIOD`) is a consideration unless an attribute's element asks for it. As
   built, the rule is applied element by element, which is stricter: an element all of
   whose passages are in such files is not shown, and an attribute with such an element
   is not supported. A comparison that fails on a fact read from such a file says nothing
   of this control's instance: it is never an `ISSUE`, and it takes the attribute's
   support away (`UNSETTLED`, with the concern's sentence). An element asks for the period
   when a reading names an `IN_PERIOD` comparison; the date is then no consideration, and
   the comparison's result is the element's.
4. **An exception is never hidden by a missing file.** An exception both readings show
   while a file is left out or read in part stays a person's (`UNSETTLED`, as before), but
   its assessment is `CONTRADICTED` and the request's outcome `POTENTIAL_EXCEPTION`.
5. **Follow-ups.** Kept only for an element that is open after the comparison, on an
   attribute the request asks for; one a reading asks for an element that is shown is
   dropped (counted). The two readings' asks for one element become one; an open element
   neither reading asked about gets one written by code from the element and what is
   absent. Asks with the same request are one follow-up covering several elements. At most
   six are shown, by priority. An element that waits on a file not read gets no follow-up:
   the file is the next step. A follow-up of the previous run whose element is now
   supported is listed as resolved by the new evidence; one whose element is still open
   stays open however many files arrived. As built: an element is open as `NOT_SHOWN`,
   `PARTLY`, `CANNOT_TELL`, `DISAGREE` (the readings differ, or a comparison fails on one
   of them), `DEVIATION` (the records show it is not met: a clarification) or
   `WAITING_FILE` (left open only because a file was not read, or was read in part; also
   an exception shown beside such a file). The rest of an attribute another request also
   asks for is not open on this request. The previous run is the requirement's latest
   earlier engine 2 run with a review. The finding of an `ISSUE` takes as its question the
   requests of the follow-ups that cover its attribute, so what a person accepts, edits
   and sends is what the check found missing; a request with a link or a request for
   credentials is not proposed, and nothing is sent by the check.
6. **Considerations.** Kept with a verified quote, the two readings' merged, at most five.
   Never a finding, never an attribute, never a change to the test plan.

### 10.6 Two dimensions, and the outcome

Per attribute the request asks for, `assessment`:

| Assessment | From |
| --- | --- |
| `SATISFIED` | `SUPPORTED` |
| `PARTIALLY_SUPPORTED` | `PARTLY_SUPPORTED`, or an `ISSUE` `PARTLY_MET` |
| `CONTRADICTED` | an `ISSUE` resting on a deviation or a contradiction (records show it is not met), a failed check, or an exception shown beside a file not read |
| `NOT_DEMONSTRATED` | an `ISSUE` resting on absence (`NOT_MET` with nothing shown, `NOT_ADDRESSED`): nothing shows it, and nothing shows a failure |
| `INDETERMINATE` | any other `UNSETTLED` |

Per run, `completeness`: `COMPLETE`; `INCOMPLETE` (a file left out or read in part);
`PARTLY_UNREADABLE` (a file with nothing readable or whose reading failed, or one both
readings find partly unreadable); `RELIABILITY_UNRESOLVED` (support rests on a file both
readings find MANAGEMENT_PREPARED or of UNKNOWN source, or on a report that does not show
its source, run date or parameters). The worst applies, in that order of the list's
reverse; each comes with its sentences. Custody passing is never called reliability.

Per run, `overall`, proposed and never a conclusion:

| Outcome | When |
| --- | --- |
| `POTENTIAL_EXCEPTION` | an asked attribute is `CONTRADICTED` |
| `SUFFICIENT` | every asked attribute is `SATISFIED`, and completeness is not `RELIABILITY_UNRESOLVED`; no follow-up is listed |
| `CLARIFICATION` | every open follow-up is a clarification |
| `ADDITIONAL_EVIDENCE` | a follow-up asks for evidence, or support needs corroboration |
| `UNABLE_TO_CONCLUDE` | otherwise (the readings disagree, a file cannot be read, a file is waited for) |

with `explanation`: at most three sentences written in code from the counts and the first
open element ("3 of 4 requested attributes are supported. C is not demonstrated: the
provisioning record is not among the files. 1 follow-up would resolve it.").

### 10.7 Records and API

- Each attribute of `outcome` gains `assessment` (null for an attribute the request does
  not ask for) and `checks`: `[{element, test, status: PASSED|FAILED|FAILED_ONE|NOT_RUN,
  sentence}]`.
- `evidence_assessments.review` (jsonb, null for engine 1):

```json
{
  "overall": "ADDITIONAL_EVIDENCE",
  "explanation": "…",
  "completeness": {"state": "INCOMPLETE", "reasons": ["…"]},
  "context_thin": false,
  "files": [{"file_id": "…", "relevance": "RELEVANT", "source": "SYSTEM_RECORD",
             "legibility": "CLEAR", "report_basis": "NOT_A_REPORT", "notes": ["…"]}],
  "confirmations": [{"file_id": "…", "code": "KIND_UNSURE", "reason": "…"}],
  "concerns": [{"code": "WRONG_SYSTEM", "sentence": "…", "file_ids": ["…"]}],
  "follow_ups": [{"key": "<attribute id>:<element>", "attribute_ids": ["…"],
                  "codes": ["C"], "elements": ["pass"], "missing": "…", "why": "…",
                  "request": "…", "alternatives": "…", "kind": "EVIDENCE",
                  "priority": "HIGH", "raised_by": ["ASSESSOR", "REVIEWER"],
                  "status": "OPEN"}],
  "follow_ups_more": 0,
  "follow_ups_dropped": 1,
  "resolved": [{"key": "…", "request": "…", "codes": ["B"]}],
  "considerations": [{"text": "…", "passages": [{"quote": "…", "file_id": "…",
                      "location": {}}], "raised_by": ["REVIEWER"]}]
}
```

- `GET …/evidence-assurance`: each request's entry gains `engine_version` and `review` (the
  object above, or null); each attribute `assessment` and `checks`. Nothing is removed.
  `review` is given only for a `REVIEWED` entry (nothing of a run is shown before it
  finishes, and nothing of one that is out of date). Each follow-up also carries `keys`,
  every "<attribute id>:<element>" it covers (one request may answer several elements);
  `raised_by` holds `ASSESSOR`, `REVIEWER`, or `CODE` where neither reading asked, and a
  consideration code raises (a date outside the period) is raised by `CODE`. The review
  is written with the outcome in the statement that finishes the run, is copied by a run
  that reuses an earlier one of the same basis, and is kept under 200,000 bytes (a
  request with a great many files loses its files' notes first, never a file).
- A follow-up is text for the person, who sends it through the existing request and
  follow-up steps after their approval. Nothing is sent by the check.
- The record's `review` also keeps `annotations`: the annotations proposed in code from
  the run (docs/evidence-annotations.md, section 2), each `{file_id, kind, label,
  statement, quote, attribute_ids, page, start, end, nth, check_sentence}`, within what the
  review has left of its size and never more than 60,000 bytes. They are kept there so
  that a run copying an earlier one of the same basis proposes the same with no model
  call; `GET …/evidence-assurance` does not give them (the annotations' own routes do),
  and nothing of the check reads them.

### 10.8 After the independent review and the scenario tests (14 November 2026)

An independent review of engine 2 and the thirty-four scenario tests found the rules below
too loose or too eager. Each is as the code now stands, and replaces what 10.2 to 10.7 say
where they differ.

Against a false pass:

- Unresolved reliability is the worst completeness state (RELIABILITY_UNRESOLVED, then
  PARTLY_UNREADABLE, then INCOMPLETE), so a file left out never hides it and the request is
  not `SUFFICIENT` while it stands. A file is partly unreadable only where both readings
  find it so; one reading's note is kept.
- An element that rests, even in part, on a file for another system or another subject is
  not shown, and its attribute is not supported (10.5 item 3 said "all its passages").
- A comparison a reading named for an element that could not be made because a fact it
  names is not in the files (its quote was not found, or it was never stated) takes the
  attribute's support away: `UNSETTLED`. The reading said the comparison decides the
  element, and what it compared is not there.
- What was asked for against what was done, both written as codes: a code that extends
  another is another code (`HR_PARTNER_VIEW` and `HR_PARTNER_VIEW_ALL`).

Against a false exception:

- SAME fails only for two references or two codes that differ. Words, names and a name
  against an id are not compared for sameness in code (a role's display name and its
  technical name, "Bob" and "Robert"): NOT_RUN, left to the readings and a person. Two
  system names that differ are the WRONG_SYSTEM concern's, never a failed check.
- WITHIN_DAYS counts calendar days and is not made for a limit in business or working
  days; an action dated before its trigger is not counted (NOT_RUN), not failed.
- A time shown with an offset or a zone, set against one that is not on the same footing,
  is ordered by date only when the dates are more than a day apart. Only real zone names
  are read as zones: a user id after a time is not one.
- IN_PERIOD is made only on a date of the instance (approved, performed, the trigger),
  never on when a report was run.
- An exception the readings read only from a file for another system or another subject is
  not an `ISSUE`: `UNSETTLED`, with the concern's sentence.

Cost and safety:

- A change to the control's understanding alone queues nothing: the list shows the check
  as out of date ("The control's understanding changed.") and a person starts it again.
  Answers are saved one by one, and each check is two model readings. New evidence, or any
  other change, records the run as before, with the understanding as it then stands; a run
  still queued takes the new understanding in place, and one the worker has just taken
  reads it as it stands. The context's hash leaves out when a fact was confirmed, so saving
  the same answer again changes nothing. The understanding is thin unless a person
  confirmed at least one fact.
- A finding's question, which a person may accept and send to the evidence owner, is the
  request both readings asked for or the sentence code wrote, never one reading's words
  alone, and never one that names an address, a link or a site, or asks for a secret.
  Otherwise the finding keeps its own plain question.
- The review always fits its size: after the files' notes, the completeness sentences, the
  confirmations and at last the files are bounded, with what was left out counted
  (`files_more`).

Known and left as they are: a comparison trusts the order the readings name the facts in
(both naming it the wrong way round on agreeing facts makes an issue a person then
dismisses); code's own concerns need both readings to state the system or the subject; an
exception shown still rests on the readings leaving `absent` empty for a record that shows
it (stage 4); an engine 1 run in flight at the release is replaced by a queued engine 2 run
that waits for the next start or event.

### 10.9 Tests

Pure tests with scripted readings and synthetic files only (no model, no client evidence):
the thirty-four cases the product owner listed (services/api/tests/test_assurance_scenarios.py),
beside the modules' own tests. The evaluation set (section 8) is not re-run live without
the owner's approval of its cost.

### 10.10 Checking again with the current engine (14 November 2026)

Asked for by the product owner after a request already checked by engine 1 had no way to
reach engine 2 ("where do I rerun the analysis of evidence from this view?"); the owner
chose the recommended route.

Forward only (10.1) still holds: nothing is ever re-checked on its own, and an engine 1 run
stays as it is until a person asks. A person who may decide evidence (TASK_UPDATE) can ask,
for one request at a time, that its finished engine 1 check be replaced by an engine 2 check.

- **Offered** on the request's row menu ("Check again with the current engine") and as the
  row's action, only where the request's current run is REVIEWED, was made by an earlier
  engine than the current one, and no file of the request is still being read. Never for a
  run that is queued, working, held, failed or out of date (those have their own action),
  and never for an engine 2 run.
- **Confirmation** before anything happens: it says that the request's files are read again
  by the model, as the first check did; that the earlier result is kept in the history and
  no longer shown as current; that findings from it nobody has decided yet are closed as
  out of date and raised again only if the new check finds them, while a finding a person
  has in hand keeps its status and gets the new result on its history (as any later check
  does: a result that supports the attribute proposes ANSWERED, and a person decides); and
  that nothing is sent to the organization.
- **What the server does**, in one transaction: the earlier run is marked out of date with
  the reason "A person asked for the check again with the current engine." (`stale_reason`
  is free text; no migration), its PROPOSED findings are marked out of date with it
  (`mark_stale_for_assessment`; a finding in hand is never marked stale), and a new run is queued on the current engine through
  `reconcile` for that requirement. One audit event, `evidence.assessment_engine_upgrade_requested`,
  with the person as actor, the requirement, the earlier run and its engine, and the new run.
  Asking twice queues one run (the second ask finds an engine 2 run and is refused with a
  plain sentence).
- **API**: `POST .../evidence-assurance/{requirement_id}/upgrade` (TASK_UPDATE, a person, 202
  with the request's entry as `rerun` answers). 409 with a plain sentence when the request
  has no run, is being read, is working, is not reviewed, is set aside (the item marked not
  applicable, its request cancelled, or the phase not applicable), or is already on the
  current engine ("This request was already checked by the current engine."). Where the
  current engine's gate would hold the request instead of checking it, the ask is refused
  with the hold's own sentence and the earlier check stays as it is.
- **What it never does**: no other request of the control or project is touched; no file is
  read again for its text (only the check runs); no decision or approval of a person is
  changed, and a finding a person has in hand is never closed or marked stale (the new
  result is attached to it for a person to decide); the earlier run's records stay.
- **Tests**: the guards above (each state and role), the earlier run kept and marked out of
  date with its reason, its open findings out of date and a person's decided finding
  untouched, one new queued engine 2 run, one audit event, a second ask refused, another
  request of the control untouched, and a reviewer role refused.

### 10.11 The check's result, simplified (14 November 2026)

Asked for by the product owner after a re-run: "my main issue is I'm overwhelmed in terms
of the heavy details ... A lot of wordings that is overwhelming. Propose an approach and
show me a prototype before building." A two-screen prototype on that request was shown and
approved ("Okay I like the prototypes"). The cause it answers: the same gap was written out
four times (the summary, the follow-up, the attribute's element, the proposed finding) and
everything was open at once.

Only the screen changes. What the check stores, decides and proposes, the API, the findings
and every action stay as they are; nothing is removed, and everything said today can still
be reached. The D&I list's row for a request shows its finished check in this order:

1. **The answer, in one line.** The proposed outcome as a pill in words with its mark (an
   engine 1 check has none), beside it the completeness caveat as a second pill where the
   evidence is not complete ("Reliability to resolve"), then the counts: "1 of 4 attributes
   shown · 3 to ask for · 2 need you", and "Proposed for your review". No paragraph.
2. **Attributes**, one row each, in the attributes' own order (A, B, C, ...): the letter,
   the attribute's wording on one line (the full wording on open), its state in words with
   a mark, and one short line: for a gap "Missing: " and the first thing not shown (its
   first sentence, with "+2 more" where there are more); for a shown attribute the first
   comparison made in code that passed, else the first sentence of what the check says it
   shows; for a judgment, the sentence over the two readings. Rows are closed when the list
   opens, and opening one closes the other.
3. **An opened attribute** says each thing once: the full wording; each element as Shown
   (its first verified passage quoted, with its file; further passages on request) or
   Missing (what is not shown); the comparisons made in code; the two readings side by side
   where a person's judgment is needed; and the finding on it with its existing actions,
   shown as its title, status and actions (its body, which repeats the above, on request).
4. **Needs you**: only what waits on this person, each one line with its one action: a
   file's type to confirm, a file left out that has an action, each attribute left to a
   person's judgment ("Review D" opens it), and one line for findings not yet decided
   ("2 proposed findings to accept or dismiss", opening the first). Absent when empty.
5. **Ask the owner**: the check's recommended follow-ups, one line each (the request's own
   words on one line, the full text and its details on open), with the attribute letters
   and the priority in words. Follow-ups of the same kind for the same attributes are
   folded under the first ("1 similar"), each still reachable. Each line is ticked or not
   (the first of each group ticked to start, a folded one not), and one action, "Add N to
   the request", opens the row's existing follow-up form with the ticked requests as its
   text for the person to edit and send through the existing path. "Copy all" copies the
   ticked ones. Nothing is sent by this section; a person without the right to act sees
   the list without the ticks and the action. Absent when the check recommends none.
6. **Details of the check**, one closed line naming what is inside: the check's own
   explanation, the completeness reasons, the considerations, what it found on the facts,
   the notes about the files, follow-ups the new evidence resolved, what the check was
   made against ("Checked against attributes A to D by two independent readings, reading
   7 files together"), and the attributes the request does not ask for.

Audit integrity, kept as tested rules: the outcome is never worded as more than proposed;
a completeness caveat is never dropped from the first line; an issue or a judgment is
never shown as shown, and its row's short line never omits that something is missing; the
counts agree with the lists under them; a finding's actions are the existing ones and
appear once; every word said before is still reachable in at most two steps.

A check that is queued, working, held, failed, out of date or not run keeps its present
one line and action. The evidence wizard's own summary is not changed.

### 10.12 The check's result as "Needs attention" (14 November 2026; replaces the layout of 10.11)

The first build of 10.11 was shown to the product owner and found still too heavy ("There
are already attributes at the top then you listed the attributes again with result. Also the
evidence are dump vertically ... Consolidate as much as possible"); two denser table
mockups were refused ("Looks overwhelming"). Of three calmer mockups the owner chose the
first ("I like A. Looks good."). 10.11's rule that only the screen changes, and its audit
integrity rules, stand; its layout is replaced by this one. The first build was never
committed.

**The first screen of an opened request with a finished check** answers one question: what
does this person need to do?

1. **The verdict**: the review's own outcome in words with a mark, large ("Additional
   evidence needed"), "Proposed for your review" beside it, and under it one sentence,
   "1 of 4 attributes is shown. 3 need your attention." A check without a review (engine 1)
   has the sentence alone as its verdict.
2. **Needs attention**: only what waits on this person, one item each, at most two lines:
   a marker (the attribute's letter, or the file's reference `E6`), a bold line, a quiet
   line, and one control.
   - An attribute with a gap (an issue, shown in part, not addressed, waiting on a file):
     bold "Missing: " and the first thing not shown (its first sentence, "+2 more" where
     there are more); quiet, the attribute's wording on one line; the control is a tick,
     "Ask owner", on where the check recommends a follow-up for it.
   - An attribute left to the person's judgment: bold, the sentence over the two readings;
     the control is "Decide", which opens it. Its follow-ups start unticked.
   - A file's type to confirm, or a file left out that has an action: bold, what to do;
     quiet, the file's sentence; the control is the check's own action.
   - A follow-up that names no attribute: one item with a tick.
   - Findings a person has still to decide (proposed, or answered by the owner) are said
     on their attribute's item ("Finding to decide") and counted in the sentence.
3. **The quiet line**: what is fine, and what must not be lost, each in a few words:
   "C shown" (each shown attribute, opening it), every caveat (the review's completeness
   label, "Read in part", "1 file left out"), and "All details". A caveat is never clipped
   or dropped from this line.
4. **The footer**: one sentence and two actions. "Ask owner for N items" opens the row's
   existing follow-up form with the ticked requests as its text (N counts requests, and
   the form says how many fit where they do not all fit); "Accept evidence" is the row's
   existing Accept. The sentence is the row's existing warning about accepting, in its
   first sentence with the rest on request; where there is none, "Nothing is sent until you
   approve it."
5. **Files**: the row's line says "7 files", which opens the files as today's list (each
   with its menu) in place; they are not listed until asked for. A file an item names is
   numbered `E1`... in the order of the row's files.
6. **All details** opens, in place: the request's wording, format and period, the
   attributes it addresses in full, and the check's details as 10.11 item 6 lists them.

**One attribute at a time.** Opening an item, a shown attribute or "Decide" replaces the
first screen, inside the same row, with that attribute alone: "Summary" to go back, its
place ("1 of 4") with previous and next, the attribute's full wording and its state in
words; then a short table of what is Shown (the sentence, the first verified passage
quoted, the file's reference and "Open") and what is Missing (each once); the two readings
side by side for a judgment; the comparisons made in code; "Ask the owner" with each
recommended follow-up for it and its tick; the finding on it with its existing actions
(shown as its title, status and actions; its body and history on request); and "More about
this attribute" for the rest (the elements in full, further passages, what is left to
other requests). The footer moves on: "Next: B". The order is the items needing attention,
then the rest. Leaving an attribute never discards something half typed in it.

Kept from the review of the first build, as tested rules: the count of shown attributes
never includes one shown only in design (the sentence says "1 shown in design" apart); an
open issue never reads as the benign "Shown in part" (it keeps the check's own "met in
part"); a row's short line never quotes a comparison that passed while another on it
failed; the counts equal the lists; "N more follow-ups are not listed here" is always
reachable; copying never silently copies less than was ticked; a short line is never cut
at an abbreviation, an initial or a list number; every caveat of either engine is on the
first screen.

### 10.13 Tickmarks: a person's disposition of an attribute (14 November 2026)

Asked for by the product owner on the attribute view of 10.12: "it's not a good use case
where I don't have the option to provide the evidence. The only option I have is to create
a follow-up. The user should be able to close this by providing ... additional evidence,
add a tickmark, or link an existing evidence"; and, on what a tickmark is for: "it's okay
for the evidence to be missing ... There will be cases that evidence won't be available so
I dont want those to be blocker". A set of four dispositions was proposed and the owner
said to proceed, with a reason from the person and no second approval (the independent
reviewer sees every disposition at sign-off).

**What it is.** The check proposes; a person concludes. On a request whose check is
finished, a person who may decide evidence (TASK_UPDATE) records, for one attribute, one
of:

| Disposition | When | Effect |
| --- | --- | --- |
| `SHOWN_ON_REVIEW` "Shown, on my review" | The evidence shows it and the check did not find it. | The attribute no longer waits on the person. It reads "Shown, auditor's judgment", never the plain "Shown". Needs an annotation a person made, confirmed or edited on a file in force on the request, naming the attribute (docs/evidence-annotations.md). |
| `NOT_APPLICABLE` "Not applicable to this instance" | The attribute does not apply to what was inspected. | No longer waits. Never counted as shown. |
| `NOT_AVAILABLE` "Evidence not available, accepted" | The evidence cannot be produced. | No longer waits. Never counted as shown; stays on the first screen and in the workpaper as an accepted limitation. May say what was relied on instead. |
| `EXCEPTION` "Exception" | The evidence shows the control did not work. | Closes nothing: the attribute keeps waiting, marked as an exception to evaluate through the existing findings and deficiency paths. A person can never tick an exception away. |

A reason is required for each (at least 10 characters, at most 1000, cleaned as other
person text is); `NOT_AVAILABLE` may add what was relied on instead (at most 600).

**Rules.**
- One standing disposition per request and attribute. Recording another replaces it (the
  earlier one is kept, marked replaced); a person reopens one with a reason, and it then
  no longer stands. Nothing is ever deleted.
- A disposition never changes what the check found: the run, its result, its findings and
  its follow-ups stay as they are and stay shown beside the disposition.
- A disposition is refused where the request has no finished, current check (queued,
  working, held, failed, out of date), where the attribute is not approved on the control,
  or (for `SHOWN_ON_REVIEW`, `NOT_APPLICABLE`, `NOT_AVAILABLE`) where the current check
  finds the records contradict the attribute (an issue resting on a failed comparison or a
  contradiction): only `EXCEPTION` is offered there.
- When a later check of the request finishes: where it finds the attribute supported, the
  disposition is no longer needed and is marked superseded by the check (kept in the
  history); where it finds a contradiction, a `SHOWN_ON_REVIEW`, `NOT_APPLICABLE` or
  `NOT_AVAILABLE` disposition no longer stands (marked overtaken, with the reason) and
  the attribute waits on the person again; otherwise the disposition stands.
- A `SHOWN_ON_REVIEW` whose annotation is removed, or whose file is no longer in force on
  the request, no longer stands.
- Accepting a request's evidence, the D&I conclusion and its sign-off are not changed by
  this increment. A disposition never marks an attribute as evidenced by an instance's
  records: where coverage is shown, it is a state of its own ("on the auditor's judgment").

**Records (migration 0162).** `attribute_dispositions`: id, organization_id, project_id,
engagement_control_id, requirement_id, attribute_id, kind, reason, relied_on,
annotation_id (null unless `SHOWN_ON_REVIEW`), assessment_id (the run current when it was
recorded), recorded_by, recorded_at, ended_at, ended_by (null where the check ended it),
ended_as (`REPLACED`, `REOPENED`, `SUPERSEDED_BY_CHECK`, `OVERTAKEN_BY_CHECK`,
`ANNOTATION_GONE`), ended_reason, version. One row with `ended_at IS NULL` per requirement
and attribute. Every act is an audit event with the person as actor
(`evidence.attribute_disposition_recorded`, `.reopened`); what a check ends is one event
without a person (`.ended_by_check`).

**API.** Under `/organizations/{o}/projects/{p}/controls/{c}/evidence-assurance/{requirement_id}/attributes/{attribute_id}`:
`POST /disposition` `{kind, reason, relied_on?, annotation_id?, replaces?}` and
`POST /disposition/reopen` `{id, version?, reason}` (as built below: both name the
disposition the person saw by its id); both answer the request's entry as `rerun`
does. `GET .../evidence-assurance` gives each attribute of a request `disposition` (null,
or `{id, kind, reason, relied_on, annotation_id, recorded_by_name, recorded_at, version}`),
`disposition_history` (ended ones, newest first, at most 10) and `contradicted` (whether
only `EXCEPTION` is taken there). 409 with one plain
sentence for each refusal. Archived and completed engagements are read-only as for every
write.

**The workpaper (docs/design-workpaper.md).** An attribute with a standing disposition on
any current check reads by it where the checks do not show it themselves: states
`SHOWN_ON_REVIEW` ("Shown, auditor's judgment"), `NOT_APPLICABLE`, `NOT_AVAILABLE`
("Evidence not available, accepted"); the tickmark is `REVIEWED` (legend: "On the auditor's
review, with the reason recorded") for the first and `NONE` for the others, never `AGREED`
or `COMPARED`. An exception shown by a check still wins over every disposition. Each
disposition is a matter for the reviewer (`DISPOSITION`, noted, with the person, the date
and the reason), and an `EXCEPTION` disposition is an open matter.

**The screen (10.12).**
- The attribute view gains "Add evidence" (Upload a file: the evidence wizard on this
  request; Use a file the control holds: the existing picker; both lead to a new check and
  its annotations as any added file does) and "Tickmark" (the four dispositions, the
  reason, and for "Shown, on my review" the annotation: pick one of the person's own on
  this attribute, or add one in the existing annotation viewer and come back).
- On the first screen an attribute with a standing disposition other than `EXCEPTION`
  leaves "Needs attention" and is on the quiet line in its own words ("B accepted without
  evidence", "D not applicable", "A shown, your judgment"), and the verdict says each
  count apart, never inside "shown". `EXCEPTION` stays in "Needs attention", marked.
- The attribute view shows the standing disposition with who, when, the reason and
  "Reopen", above what the check found; ended ones under "History".

**As built (server, 14 November 2026).**
- A person's `EXCEPTION` is never ended by a check: only a person reopens or replaces it
  (a check closing a person's exception would decide for them). The three closing kinds
  end as the rules say. A person who may decide evidence may Change (record another kind
  in its place) or Reopen an `EXCEPTION`, their own or another's, with a reason, as for
  any disposition: no second approval, and the ended exception is kept in the history
  with who ended it, when and why; where the records contradict the attribute, only
  another `EXCEPTION` can take its place.
- Reopening and replacing name what the person saw (independent review, 14 November
  2026). A standing disposition changes only by ending, so every one that stands has
  version 1 and the version cannot tell it from the one that replaced it: a reopening
  sent from a stale page reopened a disposition the person never saw. Now `reopen` takes
  `{id, version?, reason}`: the disposition standing on the attribute must be `id` (the
  `version`, still accepted, must then be its version), otherwise 409 "This tickmark
  changed since the page loaded, so refresh and try again." (or "No tickmark stands on
  this attribute for this request." where none stands). Recording takes `replaces`: the
  id of the disposition the person saw standing, or null (or left out) where they saw
  none. Where what stands is not that, nothing is recorded: 409 "A tickmark was recorded
  on this attribute since the page loaded, so refresh and try again." where another
  stands, and the stale sentence above where the one seen has ended and none stands. A
  disposition the list leaves out (its annotation no longer stands) counts as none seen.
  The standing row is locked until the act commits, so two people's acts take turns.
- Each attribute of the D&I list gives `contradicted` (boolean): whether the current
  check finds the records contradict the attribute, by the same rule recording refuses
  the three closing kinds by (`attribute_dispositions.contradicted`, from `check_finds`),
  for a run of either engine. The screen offers only "Exception" where it is true; it
  cannot work this out itself, since a run of the first engine records no assessment and
  the list's elements carry no deviation.
- "Shown, on my review" rests only on an annotation of kind `SHOWS` (a person's own, or
  the agent's that a person confirmed or edited). One of kind `EXCEPTION`, `IDENTIFIES` or
  `SOURCE` is refused: 409 "“Shown, on my review” needs an annotation that shows the
  attribute, not one that marks an exception, a person or source." An annotation's kind
  never changes once made. Dispositions recorded before this rule on another kind of
  annotation are not ended by it.
- "Contradiction" is the run's assessment `CONTRADICTED`, the same rule the workpaper reads
  as "Exception shown".
- A removed annotation, or an edit that takes the attribute off it, ends a "Shown, on my
  review" in the same transaction (`ANNOTATION_GONE`, the person who changed the
  annotation as actor, audit event `evidence.attribute_disposition_annotation_gone`); a
  file no longer in force ends it when the next check of the request finishes.
- Both POSTs answer 200 with the request's entry (nothing is queued).
- In the workpaper, a closing disposition stands in for its own request's check unless
  that check shows the attribute or an exception; across requests the most cautious
  stands (exception, then a judgment another request leaves open, then shown, then the
  dispositions). Tickmark `REVIEWED` (†, "On the auditor's review, with the reason
  recorded."); a person's `EXCEPTION` is an open matter and takes an agreed or compared
  tickmark away.
- In the workpaper, a person's `EXCEPTION` is never counted as shown (independent review,
  14 November 2026: the attributes tile said "Every attribute is shown" beside an open
  exception a person recorded on an attribute a check showed). Where the attribute would
  otherwise read as shown, by a check (`SHOWN`) or by a person's closing disposition on
  another request (`SHOWN_ON_REVIEW`, `NOT_APPLICABLE`, `NOT_AVAILABLE`), it reads
  `EXCEPTION_RECORDED` ("Exception recorded by the auditor"), tickmark `NONE`, its
  sentence the person's (who, when, the reason) with what the check found; the files keep
  the check's own marks. An exception a check shows still stands above it (`EXCEPTION`),
  and where a check leaves the attribute open, shows it in part or does not show it, it
  reads as the check left it, as before. It stays an open `DISPOSITION` matter.

**Tests.** Server: each kind recorded and read back; each refusal; replace and reopen;
what a later check does to each kind (supported, contradiction, neither); the annotation
rule; authorization and the audit events; the workpaper's states, tickmark and matters;
that nothing of the run, its findings or acceptance changes. Web: the model (attention,
quiet line, verdict counts, what is offered for each state) and the forms.

### 10.14 What is left after a person's work; a person's decision on a file's reliability (14 November 2026)

Found by the product owner after recording a tickmark: "I have added a tickmark on the
evidence here but says still can't be concluded?" Two causes: the first line shows the
check's own outcome, which a person's work never rewrites (10.13), and what was left was
not an attribute but a file: a report that does not show its source, run date or
parameters, so its completeness and accuracy are not established (the "Reliability to
resolve" caveat), which no tickmark on an attribute addresses and only a follow-up could.
The owner chose both remedies ("Okay build both").

**A. The first line says what is left after the person's work.**
- The check's outcome stays, quietly, as "The check proposed: Unable to conclude yet"
  (its own words, with "Proposed for your review").
- Above it, one plain status computed on the page from what is on record:
  - "Nothing waits on you." only where no attribute needs attention (10.12, 10.13) and no
    file's reliability is left unresolved;
  - otherwise "Still open: " and what is left, each in a few words, in this order:
    exceptions recorded, findings to decide, attributes that need attention, files whose
    reliability is unresolved (by name), other caveats (read in part, files left out);
  - where a person's work settled something, it says so first in one short clause:
    "Your tickmarks settle B and D."
- It never says the evidence is sufficient and never claims more than the check and the
  person's records show. The accept note (beside Accept) is unchanged.

**B. A person's decision on a file's reliability.** For a file in force on a D&I request
whose current check is finished, where the check's review says the file's reliability is
not established (`assurance_review._reliability`: source prepared by management, of an
unknown source, a report whose basis is not shown or shown in part, or a file the review
does not describe), a person who may decide evidence (TASK_UPDATE) records one of:

| Decision | Words | Effect |
| --- | --- | --- |
| `ESTABLISHED_ON_REVIEW` | "Reliability established on my review" | The person established the report's completeness and accuracy another way (watched it run, inspected its parameters, the owner confirmed them). States what was relied on (required, 10-600 characters). The file's reliability question no longer waits on the person. |
| `NOT_RELIED_ON` | "Not relied on" | The conclusion does not depend on this file. Its reliability question no longer waits; the file is said, everywhere it is cited, to be not relied on. |

A reason is required for both (10-1000 characters, cleaned as other person text).

Rules:
- One standing decision per request and file; recording another replaces it (kept as
  replaced); a person reopens one with a reason; nothing is deleted; both carry the id the
  person saw (as 10.13 after its review: `replaces` on record, `id` on reopen).
- A decision never changes what the check found: its run, its review, its completeness
  state and reasons stay as they are and stay shown beside the decision.
- Refused where the request has no finished, current check, where the file is not in force
  on the request, or where the check raises no reliability question on the file.
- It ends (kept, with how) when the file is no longer in force on the request (withdrawn,
  replaced); a later check never ends it, since the file's content is unchanged.
- Not relied on: an attribute whose verified passages rest only on files not relied on
  reads as the check found it, but in the workpaper its tickmark is `NONE` and a matter says
  the support rests on a file not relied on. It is never counted as more shown.

Records (migration 0163): `file_reliability_decisions`: id, organization_id, project_id,
engagement_control_id, requirement_id, evidence_file_id, kind, reason, relied_on,
assessment_id (current when recorded), recorded_by, recorded_at, ended_at, ended_by,
ended_as (`REPLACED`, `REOPENED`, `FILE_GONE`), ended_reason, version; one standing row per
requirement and file; written once, changed only by ending; never deleted; archived
engagements read-only. Audit events with the person as actor
(`evidence.file_reliability_recorded`, `.reopened`); `FILE_GONE` without a person
(`.ended_with_file`).

API, under `/organizations/{o}/projects/{p}/controls/{c}/evidence-assurance/{requirement_id}/files/{file_id}`:
`POST /reliability` `{kind, reason, relied_on?, replaces: uuid | null}` and
`POST /reliability/reopen` `{id, reason}`; both answer 200 with the request's entry as
`rerun` does; 409 with one plain sentence per refusal. `GET .../evidence-assurance` gives
each request `file_reliability`: a list, one per file of the check's review whose
reliability is not established or that carries a decision:
`{file_id, question: string (the check's own sentence, or ""), decision: null | {id, kind,
reason, relied_on, recorded_by_name, recorded_at}, history: [... ended ones, at most 10,
with ended_at, ended_by_name, ended_as, ended_reason]}`.

The workpaper (docs/design-workpaper.md): a file whose reliability was established on
review counts as reliable for the tickmark rule (an attribute shown on it may be `AGREED` or
`COMPARED`); its report row carries ◊ "Report parameters inspected" with the person, date
and what was relied on, and a procedure line "Established the reliability of N report(s)
on review, as recorded." A file not relied on is listed in the evidence index as "Not
relied on" with the reason; a matter for each decision (`DISPOSITION`, noted).

The screen:
- On the first screen the reliability caveat becomes, per file, an attention item
  ("Reliability of 06_Workday_Security_Activity_Export.csv not established", with the
  check's sentence as its context and "Decide" opening the file's decision), and leaves
  Needs attention once decided, going to the quiet line in its own words ("E6 reliability
  established on your review", "E6 not relied on").
- The decision is made from that item or from the file's "About this file" tab (docs/
  evidence-annotations.md 5b): a small form with the two choices, the reason, and what
  was relied on; a standing decision shows who, when, the reason, Change and Reopen, and
  ended ones under History.

Tests: server: each kind, each refusal, replace and reopen with ids, the file-gone ending,
that a later check does not end it, nothing of the run or its review changes, the
workpaper's tickmark rule, report row, procedure and matters, authorization and audit.
Web: the status line (A) over every combination of attention, findings, exceptions,
tickmarks, decisions and caveats, never "Nothing waits on you." while anything is left;
the item, the form, the quiet line.

### 10.15 Closing a request with tickmarks; exceptions carried to the workpaper (15 November 2026)

The product owner, on what tickmarks are for: "if I add tickmark to these attributes that
were not addressed by any evidence it will close the evidence request. Any issue will be
dealt with as exception in the workpaper analysis. Reason for this is that in the real
world, no evidence is perfect ... Otherwise, it will never move to the next phase which is
the design evidence analysis and the workpaper documentation." An end-to-end trace of the
tickmark work against that goal found that a tickmark closed nothing: a request closes
only on "Accept evidence", nothing downstream but the assembled workpaper read tickmarks,
one kind of request could not be accepted at all, and a recorded exception could be signed
over as "Effective". The plan below was put to the owner; decisions the owner did not
change are marked (default).

**Closing.**
1. *The last tickmark offers to close the request* (default). A request's attributes are
   settled when each attribute it asks for is evidenced by the check (10.12's rule) or
   carries a standing tickmark of any kind, an exception included (it is carried to the
   workpaper, item 5). Where recording a tickmark settles the last one, and the request
   can be accepted and is not yet, the form carries "Accept this request's evidence now",
   ticked to start; one press records the tickmark and then accepts through the existing
   Accept (its handler, rules and audit event), each shown as done only after the server
   confirms it; if the acceptance is refused the tickmark stays and the refusal is said.
   Unticked, or where settled already, the first screen says "Every attribute is shown or
   carries your tickmark. Accept the evidence to close this request." with Accept as the
   primary action. Nothing is accepted without that press.
2. *A tickmark may settle the check's proposed finding in the same act* (default): for a
   closing kind on an attribute whose finding is still proposed, the form carries "Dismiss
   the check's proposed finding with this reason", ticked to start, which uses the
   existing dismissal after the tickmark is recorded. An Exception leaves the finding to
   the person.
3. *An item that waits for an earlier one can be accepted once its own evidence is in
   hand.* A D&I item in `AWAITING_DEPENDENCY` with a file of its own reads and is judged
   as a planned item with one (`requirement_state`, `set_sufficiency`); the redraft of the
   design workpaper and the request's "received" move count in-hand items as they count
   requested ones.

**What reads tickmarks from here.**
4. The D&I list: Coverage has a state of its own for an attribute settled by a tickmark
   ("B not applicable, your tickmark"; never "evidenced"), and "accepted without support
   from the check" no longer names an attribute that carries one; the closed row's chips
   and the step's counts leave out attributes with a closing tickmark and count an
   exception as an issue; the step is not shown done while an accepted request has an
   attribute that waits again (a reopened tickmark, one a later check ended) and says so.
5. The D&I conclusion (docs/design-workpaper.md, design_conclusions.py): while an
   `EXCEPTION` tickmark stands on a current check of the control and no design deficiency
   is logged, signing off as effective is refused, and the conclusion says why ("An
   exception is recorded on attribute B. Log a design deficiency for it, or change the
   tickmark with your reason."). A tickmark recorded, changed, reopened or ended after the
   sign-off puts the sign-off out of date ("a tickmark changed after the sign-off").
6. The drafted workpaper: the agent that drafts the design workpaper is given the
   assembled attribute results and the standing tickmarks (kind, the person's reason as
   quoted data, never as instructions) so its text does not contradict them; the matters
   list skips a check's follow-up whose attributes all carry closing tickmarks and always
   has room for the tickmarks' own matters.
7. The activity log names each tickmark event in plain words.

**Not losing a person's work.**
8. A request whose check is not current (out of date, held, failed, running) says how
   many tickmarks are kept ("3 tickmarks kept. They apply again once the request is
   checked again."); `GET .../evidence-assurance` gives each request `tickmarks_kept`.
9. A tickmark that stands through a later check says so: `disposition.on_current_check`
   is false where it was recorded on an earlier run, and the screen marks it "Recorded on
   an earlier check; confirm it still holds" with Change and Reopen beside it.

**Left for a later increment** (told to the owner): a request with no file at all cannot
be closed as "evidence not available" (no check, so no tickmark; no file, so no Accept;
"Mark not applicable" refuses that reason by design); the Excel export of the workpaper
does not carry tickmarks.

Tests: server: an awaiting item with its own file is accepted and counted; the sign-off
refusal and its lifting by a deficiency or a changed tickmark; the out-of-date reason;
`tickmarks_kept` and `on_current_check`; the drafter's input holds the tickmarks as data
(scripted model); the matters rule; the activity words. Web: the settled rule and the
offer to accept (ticked, unticked, refused acceptance, already accepted, cannot accept);
the finding dismissal; coverage, chips and counts with each kind; the step not done while
an attribute waits again; the kept and earlier-check lines.

## 9. Status

| Increment | State |
| --- | --- |
| The chain on D&I evidence: gate, assessment, blind re-performance, comparison, records, API, findings | in progress, 12 November 2026 |
| The D&I list shows each file's check and its results per attribute | in progress, 12 November 2026 |
| The evaluation set and the live scoring command | built; first live run 13 November 2026 (section 8) |
| Readings read as written and asked again when cut off; the eight cases' assignee | built 13 November 2026, a live re-run of the wrong cases to follow |
| Prompts /5: the quote rule, placeholders, a split shortfall, shortfall attribution, designation; the case `assigner_team_not_designated` | built 13 November 2026, the same live re-run to follow |
| Engine 2 (section 10): the control's context and its hash, prompts /6 and the larger answer, facts and comparisons checked in code, concerns, follow-ups and considerations, the two dimensions and the proposed outcome, `review` saved and read through the API | built 14 November 2026 with scripted readings (test_assurance_engine2.py); the thirty-four scenarios and the screen to follow; not yet run live |
| Prompts /7: what a quote shows and where a file comes from, for the evidence annotations (docs/evidence-annotations.md) | built 14 November 2026 with scripted readings (test_evidence_annotations.py); not yet run live |
| Checking again with the current engine, for a request an earlier engine checked (10.10) | built 14 November 2026 (`upgrade_engine`, route `/upgrade`, no migration; the row's action and menu item with a confirmation; `test_assurance_upgrade.py` in the fast and critical tiers, `tests/evidence-upgrade-model.test.ts`); independently reviewed and tightened the same day; used once by the product owner on the development data |
| The check's result, simplified (10.11) | first build shown and refused as too heavy, 14 November 2026; never committed; replaced by 10.12 |
| The check's result as "Needs attention", one attribute at a time (10.12) | built 14 November 2026 (`check-digest-model.ts`, `check-digest.tsx`, `check-digest.css`; the row of a finished check in `design-evidence.tsx`; "View" from a row to the annotated evidence; a result whose elements are each half shown now stands as shown in part); independently reviewed once and corrected (what waits on a person or shows an exception is always on the first screen); checked in a headless browser against scripted answers, used by the product owner on the development data; a second review of the corrections to follow |
| Tickmarks: a person's disposition of an attribute; adding evidence from the attribute view (10.13) | server built 14 November 2026 (migration 0162 applied to development; `attribute_dispositions.py`; `test_attribute_dispositions.py` in the critical tier); the screen built the same day (`attribute-tickmark.tsx`; Tickmark and Add evidence on the attribute view; the first screen, verdict and workpaper word each disposition apart from shown), checked against scripted answers, not yet against the running server |
| What is left after a person's work; a person's decision on a file's reliability (10.14) | in progress, 14 November 2026 |
| Closing a request with tickmarks; exceptions carried to the workpaper (10.15) | planned for 15 November 2026, after 10.14 lands |
| Prompt caching of the file text across the two readings (models.py) | planned, after the chain is measured |
| Interim and roll-forward evidence | planned |
