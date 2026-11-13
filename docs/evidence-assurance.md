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
(changed 12 November 2026, before the first build was finished).

A run is identified by its basis: every file in force on the requirement (its id, content
hash, the hash of its stored text, its kind, and whether the gate left it out), the
attribute basis, the requirement's links, the control's facts, the lens and both prompt
versions. It starts by itself when the reading of a file on a DESIGN requirement lands
(`evidence_analysis.run_analysis`, status READY), in the background, after the reading's
transaction commits (the `_after_commit` pattern of context_routes.py; a run is never
handed to the worker before the row that asks for it is committed). While another file of
the same requirement is still being read, nothing is queued: that file's reading queues
the run, so files that arrive together are read once. A run still queued when a file
arrives is brought up to date in place (no second run for the same requirement).

### Stage 1: the gate (code only, no model call)

The gate applies **per file**. A file is left out of the readings, with one code and one
plain sentence, when any of these hold:

| Code | When |
| --- | --- |
| `CUSTODY` | The reading failed its custody check. |
| `UNREADABLE` | Nothing readable was extracted (no text, password-protected, a failed OCR, a reading that did not finish). |
| `KIND_UNSURE` | The reader's confidence in the file's kind is low, or the rules classified it (no model, or the model's answer was rejected), and no person has confirmed the kind. |
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

For each attribute it answers, per **element**, one of:

`MET`, `PARTLY_MET`, `NOT_MET`, `CONTRADICTED`, `CANNOT_TELL`, or `NOT_ADDRESSED` (the files
do not bear on this attribute at all; allowed only for an attribute that is not
`expected`, or with a stated reason for one that is).

The elements are set in code, so neither reading chooses what it is judged on: the
criteria's **condition** and what **passes** at this client, where a person owns criteria;
the wording alone otherwise. What counts as an exception is given to the reading as the
description of failing, not as an element to be met.

Each answer carries the exact words it rests on, with the index of the file they are in,
or names what is absent.

### Stage 3: the blind re-performance (one model call)

The independent reviewer agent (`independent-reviewer`, the same tier and the same model
configuration, never a weaker model) gets the same files, lens and attributes and
**nothing of the first answer**: both requests are written from the run's input before
either reading is asked. Its instructions take the sceptic's side: for each element, find
the record that shows it, and say what would have to be there and is not.

### Stage 4: what stands (code only)

Applied to each agent's answer first, then to the pair. The model proposes; the code
decides what stands (the rule of evidence_mapping.py).

1. Every quote is found in the stored text of **the file it names**
   (`console_citations.find_quote`) and located there (`evidence_mapping.locate`). A quote
   that file does not hold is dropped, whichever other file may hold it.
2. `MET` and `PARTLY_MET` need a verified quote for each element they claim. Without
   one, the element is `CANNOT_TELL`.
3. `CONTRADICTED` needs two verified quotes. Otherwise `CANNOT_TELL`.
4. Passages are classified RECORD, REQUIREMENT, ASSERTION or INSTRUCTION (the first, third
   and fourth as evidence_mapping does; a REQUIREMENT is a document's own rule, "access
   must be approved by ..."). Only a RECORD supports an element under `INSTANCE_RECORD`.
   Under `DESIGN_DOCUMENT` a REQUIREMENT supports an element, as does a RECORD the
   document carries (its approval, its version); a statement that something was done
   does not. An unclassified passage is an ASSERTION. A line the deterministic guards
   flag is never support.
5. When a file's stored text was cut (`text_truncated`), or when a file of the request
   was left out by the gate, an answer that rests on absence (`NOT_MET`, `NOT_ADDRESSED`,
   and the missing part of `PARTLY_MET`) becomes `CANNOT_TELL`, with "a file was read in
   part" or "a file on this request has not been checked".
6. An attribute's result is the weakest of its elements: any `CONTRADICTED` gives
   `CONTRADICTED`; else any `NOT_MET` with any `MET` gives `PARTLY_MET`; all `NOT_MET`
   gives `NOT_MET`; any `CANNOT_TELL` gives `CANNOT_TELL` unless a `MET` and a `NOT_MET`
   already make it `PARTLY_MET` (so `NOT_MET` with `CANNOT_TELL` is `CANNOT_TELL`: what is
   not known could be met); all `MET` gives `MET`. An element or an attribute the answer
   leaves out is `CANNOT_TELL`.

Then the comparison, per attribute:

| Assessor | Reviewer | Verdict |
| --- | --- | --- |
| `MET` | `MET` | `SUPPORTED` |
| the same one of `PARTLY_MET`, `NOT_MET`, `CONTRADICTED` | | `ISSUE` |
| `NOT_ADDRESSED` | `NOT_ADDRESSED` | `NOT_ADDRESSED` |
| anything else, including either `CANNOT_TELL` | | `UNSETTLED` |

`PARTLY_MET` against `NOT_MET` is `UNSETTLED`, not an issue: the two readings disagree on
what the files show. An `expected` attribute both find `NOT_ADDRESSED` is an `ISSUE` (the
evidence does not address what its request said it would). `SUPPORTED` always carries the
result `MET` and at least one verified passage from each reading.

There is no third agent and no tie-break. `UNSETTLED` goes to a person with both views.

A reading that gives no usable answer (the call failed, was cut off, did not match the
schema, or was rejected by the checks) settles nothing: the run is FAILED, nothing of it
is shown, and a person runs it again. The second reading is not asked for when the first
gave nothing.

### Stage 5: what a person sees

- `SUPPORTED`: the attribute, the passages both readings rest on, each with its file.
- `ISSUE`: recorded as an evidence finding (source `ASSURANCE`), so the existing accept,
  edit, follow-up and resolve loop applies. The finding states the attribute's letter,
  what is not shown, and the passage or the absence it rests on. The question it proposes
  for the control owner is written from the firm's own attribute wording, never from the
  model's words.
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
- While a run works, the row says so. Nothing of a run is shown before it finishes.

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
  and criteria), the requirement's linked attribute ids, the control's facts, the lens,
  both prompt versions, and one hash over all of it;
- state: `PENDING`, `WORKING`, `HELD`, `READY`, `FAILED`; the stage reached; lease and
  attempts as evidence_analyses has them; the gate's code and sentence when the whole run
  is held; why it failed when it did;
- the two checked answers (never the raw model output), each with its model call id;
- the outcome per attribute (verdict, result, passages with their file and location, what
  is absent, and both views when unsettled);
- `stale_at` and `stale_reason` when a file is added to, replaced on or withdrawn from
  the requirement, a file is read again with another text or kind, an attribute's wording
  or criteria changes, the attribute list changes, the requirement's links change, or the
  control's description changes. A stale run is shown as out of date and a new run is
  queued while a file is still in force on the requirement.

A finished run (`HELD`, `READY`, `FAILED`) is only ever marked out of date, once, and an
out-of-date run is never changed (a trigger refuses both); a run is never deleted. A run
still queued is brought up to date in place.

Idempotent: there is one current run per requirement, and the same basis is never run
twice; asking again returns the run on record. When a basis comes back (a link removed
and restored), the earlier reviewed run of that basis is copied into a new run
(`reused_from_id`), with no model call. Partial reuse of single attributes' results is
not built.

`evidence_findings` gains the source `ASSURANCE`, the kinds `NOT_MET`, `PARTLY_MET`,
`CONTRADICTED` and `NOT_ADDRESSED`, and `assessment_id` (the run a finding rests on), by
migration (never by silently widening a check). An `ISSUE` is recorded once per
requirement, attribute and basis, pinned to its run; when the run goes out of date its
open findings are marked stale, as a replaced file's are. Where the finding of a basis
went stale and that basis comes back, the issue is recorded again for the new run, so an
agreed issue is never left without a finding a person can act on. A plan approved again
does not mark them stale: they are pinned to the run's basis, not the plan's revision.

Every model call goes through `provenance.AgentCaller` (budgets, trial reservations,
cancellation, the provenance record), both readings in one job. A run that cannot pay for
both readings does not start the first one (`AgentCaller.refusal_for`): it is FAILED with
the reason, and no call is made or recorded.

## 5. Pure core (for tests and the evaluation set)

In `evidence_assurance.py`, with no database:

```python
Result = Literal["MET", "PARTLY_MET", "NOT_MET", "CONTRADICTED", "CANNOT_TELL", "NOT_ADDRESSED"]
Verdict = Literal["SUPPORTED", "ISSUE", "UNSETTLED", "NOT_ADDRESSED"]
Lens = Literal["DESIGN_DOCUMENT", "INSTANCE_RECORD"]
Role = Literal["ASSESSOR", "REVIEWER"]
PassageBasis = Literal["RECORD", "REQUIREMENT", "ASSERTION", "INSTRUCTION"]
HeldCode = Literal["CUSTODY", "UNREADABLE", "KIND_UNSURE", "POPULATION", "NO_ATTRIBUTES", "TOO_LARGE"]

@dataclass(frozen=True)
class AttributeSpec: id: UUID; code: str; text: str; criteria: dict[str, Any] | None; expected: bool

@dataclass(frozen=True)
class FileSpec: id: UUID; name: str; kind: str; text: str; truncated: bool; sha256: str

@dataclass(frozen=True)
class ChainInput:
    control_ref: str; title: str; activity: str; lens: Lens
    attributes: tuple[AttributeSpec, ...]
    files: tuple[FileSpec, ...]          # the files the readings include, in prompt order
    files_left_out: bool = False         # a file of the request was held by the gate

@dataclass(frozen=True)
class GateFacts: custody_failed: bool; readable: bool; kind: str; kind_confirmed: bool; confidence: str; source: str

def gate(facts: GateFacts) -> Held | None: ...                       # one file
def run_gate(files: Sequence[tuple[Held | None, int]], attributes: int) -> Held | None: ...   # the run
def lens_for(categories: tuple[str, ...], kinds: Sequence[str]) -> Lens: ...
def elements_of(attribute: AttributeSpec) -> tuple[tuple[str, str], ...]: ...   # (key, text)
def prompt_for(chain: ChainInput, role: Role) -> tuple[str, str]: ...   # (system, prompt)
def check_opinion(output: dict[str, Any], chain: ChainInput) -> Opinion: ...   # rules 1 to 6
def compare(first: Opinion, second: Opinion, chain: ChainInput) -> tuple[Outcome, ...]: ...
def run_chain(ask: Callable[[Role, str, str], dict[str, Any] | None], chain: ChainInput) -> ChainResult: ...
```

`Outcome` has `attribute_id`, `code`, `expected`, `verdict`, `result` (the agreed one, or
None), `passages` (each with its `file_id`), `absent`, `views` (both, when unsettled) and
`summary` (one sentence, written in code). `ChainResult` has `outcomes`, `first`, `second`
(the two checked `Opinion`s), and `failed` and `reason` when a reading gave no usable
answer. `run_chain` is the gate's successor stages only (assess, re-perform, compare); an
`ask` that returns None for either role gives every attribute `UNSETTLED` with the reason,
never a guess. `check_opinion` raises `ValueError` for an answer of the wrong shape, which
`run_chain` treats as no answer.

The reviewer's prompt never contains anything from the assessor's answer. A test asserts it.

## 6. API

`GET /organizations/{o}/projects/{p}/controls/{c}/evidence-assurance` (project.read):

```json
{
  "requests": [
    {
      "requirement_id": "…", "run_id": "…",
      "status": "QUEUED | CHECKING | HELD | REVIEWED | FAILED | OUT_OF_DATE",
      "stage": "GATE | ASSESS | VERIFY | COMPARE | DONE",
      "held": { "code": "KIND_UNSURE", "reason": "…" },
      "held_files": [ { "file_id": "…", "code": "KIND_UNSURE", "reason": "…" } ],
      "file_ids": [ "…" ],
      "lens": "INSTANCE_RECORD",
      "read_in_part": false,
      "attributes": [
        {
          "attribute_id": "…", "code": "B", "expected": true,
          "verdict": "SUPPORTED | ISSUE | UNSETTLED | NOT_ADDRESSED",
          "result": "MET | PARTLY_MET | NOT_MET | CONTRADICTED | NOT_ADDRESSED | null",
          "summary": "…",
          "passages": [ { "quote": "…", "file_id": "…",
                          "location": { "label": "Page 3", "page": 3, "sheet": null,
                                        "row": null, "column": null, "cell": null } } ],
          "absent": [ "…" ],
          "views": [ { "role": "ASSESSOR", "result": "MET", "reason": "…" },
                     { "role": "REVIEWER", "result": "NOT_MET", "reason": "…" } ],
          "finding_id": "… or null"
        }
      ],
      "out_of_date": [ "…" ],
      "finished_at": "…",
      "note": ""
    }
  ],
  "summary": { "checking": 0, "held": 0, "failed": 0, "out_of_date": 0,
               "supported": 0, "issues": 0, "unsettled": 0 }
}
```

One entry per DESIGN requirement that has a file in force and a run, its latest. A
requirement whose files are still being read for the first time has no entry yet.

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
- `views` is empty unless UNSETTLED; `attributes` is empty unless the run is REVIEWED
  (nothing of a run is shown before it finishes, and nothing of one that is out of date).
  `SUPPORTED` always carries `result` `MET` and at least one passage. `finding_id` is set
  only for an ISSUE.
- `out_of_date` is non-empty only when `status` is `OUT_OF_DATE`: one plain sentence for
  each thing that changed. A finished run is compared with what would be read now each
  time it is read, so a change nothing marked yet still shows as out of date.
- `note` says in a sentence why a FAILED run stopped; it is empty otherwise.
- `read_in_part` is true when any included file's stored text was cut.
- Every `reason` and sentence is plain, with no codes.
- `summary`: `checking`, `held`, `failed` and `out_of_date` count requests; `supported`,
  `issues` and `unsettled` count the attribute verdicts of the reviewed requests.

`POST .../evidence-assurance/{requirement_id}/rerun` (task.update): starts the run again
for a FAILED or OUT_OF_DATE request. Success is 202 with the request's entry (the shape
above). A request whose reviewed or held run still rests on the same basis is returned as
it is (the same basis is never run twice). Refused with 409, whose `detail` is one plain
sentence, while a run is queued or working ("The check is already running."), while a
file of the request is still being read, or when no file is on the request. Another firm
gets 404, as does a requirement that is not a DESIGN requirement of the control; a
Reviewer reads and cannot rerun (403).

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
