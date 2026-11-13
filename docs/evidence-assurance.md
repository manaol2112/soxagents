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
On start-up a bounded backfill (`backfill`, 50 requirements a pass) queues a run for each
DESIGN requirement with files in force on it (its requirement files) and no current run; a
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

The elements are set in code, so neither reading chooses what it is judged on: the
criteria's **condition** and what **passes** at this client (keys `condition` and `pass`),
where a person owns criteria; the wording alone otherwise (key `wording`). The same
attribute has the same keys and texts on every request of the control, so elements combine
across requests by key. What counts as an exception is given to the reading as the
description of failing, not as an element to be met.

Each answer carries the exact words it rests on, with the index of the file they are in
(and, where the same words occur more than once in the file, the words around them), or
names what is absent.

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
   where the word just before it on the same line negates it (not, no, never, without) and
   never where it ends inside a token (a trailing `-`, `/`, `:` or `.` followed by a
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
   reading called it, a passage on a line where a sentence (at the line's start, after
   ". " or "; ", or after a bullet) opens with Remark:, Note:, Summary:, Comment: or
   Conclusion:, or that carries "<word> comment:", "per the <role>" or "according to", or
   that says all of something was (or has been) obtained, approved or reviewed. A line the
   deterministic guards flag is never support.
5. For an attribute the request asks for (`expected`), when a file's stored text was cut
   or a file of the request was left out by the gate, a result that rests on absence (a
   `NOT_MET`, a `NOT_ADDRESSED`, and the missing part of a `PARTLY_MET`) becomes
   `CANNOT_TELL`, with "a file was read in part" or "a file on this request has not been
   checked". An attribute the request does not link is not held to this rule. A
   **deviation** is the one exception: an element both readings find `NOT_MET`, each
   naming nothing absent for it and resting it on overlapping verified RECORD passages
   (under `DESIGN_DOCUMENT` also the document's own REQUIREMENT) from files read in full (a self-approval plainly in a ticket). It stands whatever else
   the request holds (compare, below); anything else is absence-based.
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
| a deviation on an element | the same deviation (overlapping records) | `ISSUE` `NOT_MET`, linked or not (both `CONTRADICTED` instead: `ISSUE` `CONTRADICTED`) |
| `MET` | `MET` (both with verified passages) | `SUPPORTED` |
| `SHOWN_IN_PART` | `SHOWN_IN_PART`, on the same elements | `PARTLY_SUPPORTED`, except: linked and no other D&I request of the control links it: `ISSUE` `PARTLY_MET`, naming the elements not shown |
| `PARTLY_MET` | `PARTLY_MET`, on the same elements, linked, another D&I request links it too | `PARTLY_SUPPORTED` (result `SHOWN_IN_PART`; the elements not met count as not shown) |
| the same `CONTRADICTED` | | `ISSUE` |
| the same `PARTLY_MET` or `NOT_MET`, attribute linked | | `ISSUE` |
| the same `PARTLY_MET` or `NOT_MET`, attribute not linked | | `NOT_ADDRESSED`, "This request does not ask for this attribute; what the readings found is shown for reference.", both views |
| `NOT_ADDRESSED` | `NOT_ADDRESSED` | `ISSUE` if linked (the evidence does not address what its request said it would), else `NOT_ADDRESSED` |
| anything else, including either `CANNOT_TELL` | | `UNSETTLED` |

`PARTLY_MET` against `NOT_MET`, `SHOWN_IN_PART` on different elements, and `PARTLY_MET` on
different elements of an attribute another request also asks for, are `UNSETTLED`. A
requirement with no links at all has every attribute unlinked. `SUPPORTED` always carries
the result `MET` and at least one verified passage from each reading. "Another D&I request
links it" is part of the run's basis (`elsewhere_attribute_ids`): a change there puts the
run out of date.

There is no third agent and no tie-break. `UNSETTLED` goes to a person with both views.

A reading that gives no usable answer (the call failed, was cut off, did not match the
schema, or was rejected by the checks) settles nothing: the run is FAILED, nothing of it
is shown, and a person runs it again. The second reading is not asked for when the first
gave nothing.

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
  words.
- An issue a person already has in hand (accepted, sent, answered, asked again,
  escalated) is never marked stale by a client's reply or upload: the reading that arrives
  attaches to it (matched on its requirement where it rests on several files) and proposes
  ANSWERED, and the next run's result is attached to it on its history, named as it is
  (supported, contradicted, not met, met in part, not settled; a run that supports the
  attribute proposes ANSWERED, "a person decides"); no second finding is
  raised for the attribute. No agent closes a finding. A finding nobody acted on goes stale
  with its run.
- `UNSETTLED`: shown as "The two readings do not agree. Your judgment is needed.", with
  each reading's result and reason. Never a finding, never counted as support.
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
the reason, and no call is made or recorded.

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
# Prompt versions: evidence-assurance-assessor/4, evidence-assurance-reviewer/4

@dataclass(frozen=True)
class AttributeSpec: id: UUID; code: str; text: str; criteria: dict[str, Any] | None; expected: bool; linked_elsewhere: bool = False

@dataclass(frozen=True)
class FileSpec: id: UUID; name: str; kind: str; text: str; truncated: bool; sha256: str

@dataclass(frozen=True)
class ChainInput:
    control_ref: str; title: str; activity: str; lens: Lens
    attributes: tuple[AttributeSpec, ...]
    files: tuple[FileSpec, ...]          # the files the readings include, in prompt order
    files_left_out: bool = False         # a file of the request was held by the gate
    categories: tuple[str, ...] = ()     # the requirement's, for each file's own lens

@dataclass(frozen=True)
class GateFacts: custody_failed: bool; readable: bool; kind: str; kind_confirmed: bool; confidence: str; source: str; read_failed: bool = False

def gate(facts: GateFacts) -> Held | None: ...                       # one file
def run_gate(files: Sequence[tuple[Held | None, int]], attributes: int) -> Held | None: ...   # the run
def lens_for(categories: tuple[str, ...], kinds: Sequence[str]) -> Lens: ...
def elements_of(attribute: AttributeSpec) -> tuple[tuple[str, str], ...]: ...   # (key, text)
def prompt_for(chain: ChainInput, role: Role) -> tuple[str, str]: ...   # (system, prompt)
def check_opinion(output: dict[str, Any], chain: ChainInput) -> Opinion: ...   # rules 1 to 6
def attribute_result(elements: Sequence[ElementView]) -> Result: ...   # rule 6
def compare(first: Opinion, second: Opinion, chain: ChainInput) -> tuple[Outcome, ...]: ...
def run_chain(ask: Callable[[Role, str, str], dict[str, Any] | None], chain: ChainInput) -> ChainResult: ...
```

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
          "views": [ { "role": "ASSESSOR", "result": "MET", "reason": "…" },
                     { "role": "REVIEWER", "result": "NOT_MET", "reason": "…" } ],
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
empty) where it has none.

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
- `views` is empty unless UNSETTLED or shown for reference (an unlinked attribute's
  agreed shortfall); `attributes` is empty unless the run is REVIEWED (nothing of a run is
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
in part, and a file whose request links the wrong attributes.

- With scripted model answers (in the fast and critical tiers): the code's rules. A false
  quote never supports; an unverified `MET` never stands; disagreement is `UNSETTLED`; the
  reviewer is blind; nothing reaches a person from one reading alone.
- With the live model (a command a person runs, never a tier: it spends money): each case
  scored per attribute. Reported separately: false `SUPPORTED` (the error that matters
  most), false `ISSUE`, `UNSETTLED` rate, and the cost per file. The first live figures
  are recorded here with their date, model and prompt versions.

## 9. Status

| Increment | State |
| --- | --- |
| The chain on D&I evidence: gate, assessment, blind re-performance, comparison, records, API, findings | in progress, 12 November 2026 |
| The D&I list shows each file's check and its results per attribute | in progress, 12 November 2026 |
| The evaluation set and the live scoring command | planned next |
| Prompt caching of the file text across the two readings (models.py) | planned, after the chain is measured |
| Interim and roll-forward evidence | planned |
