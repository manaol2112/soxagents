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

## 3. The chain, per file

One run per (file content hash, requirement, attribute basis). It starts by itself when a
file's reading lands (`evidence_analysis.run_analysis`, status READY) on a DESIGN
requirement, in the background, after the reading's transaction commits (the
`_after_commit` pattern of context_routes.py; a run is never handed to the worker before
the row that asks for it is committed).

### Stage 1: the gate (code only, no model call)

The run stops here, as HELD with one code and one plain sentence, when any of these hold.
Nothing later runs, so nothing later is paid for.

| Code | When |
| --- | --- |
| `CUSTODY` | The reading failed its custody check. |
| `UNREADABLE` | Nothing readable was extracted (no text, password-protected, a failed OCR). |
| `KIND_UNSURE` | The reader's confidence in the file's kind is low, or the rules classified it (no model, or the model's answer was rejected), and no person has confirmed the kind. |
| `POPULATION` | The file is a population on a design item: the walkthrough instance is picked first (walkthrough_instances.py). |
| `NO_ATTRIBUTES` | The control has no approved attribute. |

A person clears `KIND_UNSURE` by confirming the kind (the existing confirm action), which
starts the run again. A replaced file starts a new run. `POST .../rerun` starts it again
after a failure.

### Stage 2: the assessment (one model call)

The control's own tester agent (the BALANCED tier) reads the **whole stored text** of the
file (no excerpt cut; `evidence_extraction.MAX_TEXT` is the only bound) with:

- the control (reference, title, activity), as data;
- the **lens**, set in code from the requirement's category and the file's kind:
  `DESIGN_DOCUMENT` (a policy, procedure, narrative or configuration standard: does the
  documented design require what the attribute tests?) or `INSTANCE_RECORD` (the records
  of one instance, walked through: does this instance show it?). A design document never
  shows that the control operated, and the prompt says so;
- every approved attribute, each with its letter, its wording and its person-owned
  criteria (`testing_engine.tailored_criteria`: condition, pass, exception), marked
  `expected` when the requirement links it (`evidence_requirement_attributes`).

For each attribute it answers, per **element** (the parts of the criteria; the wording
alone when no person owns criteria), one of:

`MET`, `PARTLY_MET`, `NOT_MET`, `CONTRADICTED`, `CANNOT_TELL`, or `NOT_ADDRESSED` (the file
does not bear on this attribute at all; allowed only for an attribute that is not
`expected`, or with a stated reason for one that is).

Each answer carries the exact words of the file it rests on, or names what is absent.

### Stage 3: the blind re-performance (one model call)

The independent reviewer agent (`independent-reviewer`, the same tier, never a weaker
model) gets the same file, lens and attributes and **nothing of the first answer**. Its
instructions take the sceptic's side: for each element, find the record that shows it,
and say what would have to be there and is not.

### Stage 4: what stands (code only)

Applied to each agent's answer first, then to the pair. The model proposes; the code
decides what stands (the rule of evidence_mapping.py).

1. Every quote is found in the stored text (`console_citations.find_quote`) and located
   (`evidence_mapping.locate`). A quote the file does not hold is dropped.
2. `MET` and `PARTLY_MET` need a verified quote for each element they claim. Without
   one, the element is `CANNOT_TELL`.
3. `CONTRADICTED` needs two verified quotes. Otherwise `CANNOT_TELL`.
4. Passages are classified RECORD, ASSERTION or INSTRUCTION as evidence_mapping does. Only
   a RECORD supports an element under `INSTANCE_RECORD`. Under `DESIGN_DOCUMENT` the
   document's own requirement ("access must be approved by ...") supports an element;
   a statement that something was done does not. A line the deterministic guards flag is
   never support.
5. When the stored text was cut (`text_truncated`), an answer that rests on absence
   (`NOT_MET`, `NOT_ADDRESSED`) becomes `CANNOT_TELL`, with "the file was read in part".
6. An attribute's result is the weakest of its elements: any `CONTRADICTED` gives
   `CONTRADICTED`; else any `NOT_MET` with any `MET` gives `PARTLY_MET`; all `NOT_MET`
   gives `NOT_MET`; any `CANNOT_TELL` with no `NOT_MET` gives `CANNOT_TELL`; all `MET`
   gives `MET`.

Then the comparison, per attribute:

| Assessor | Reviewer | Verdict |
| --- | --- | --- |
| `MET` | `MET` | `SUPPORTED` |
| the same one of `PARTLY_MET`, `NOT_MET`, `CONTRADICTED` | | `ISSUE` |
| `NOT_ADDRESSED` | `NOT_ADDRESSED` | `NOT_ADDRESSED` |
| anything else, including either `CANNOT_TELL` | | `UNSETTLED` |

`PARTLY_MET` against `NOT_MET` is `UNSETTLED`, not an issue: the two readings disagree on
what the file shows. An `expected` attribute both find `NOT_ADDRESSED` is an `ISSUE` (the
file does not address what its request said it would).

There is no third agent and no tie-break. `UNSETTLED` goes to a person with both views.

### Stage 5: what a person sees

- `SUPPORTED`: the attribute, the passages both readings rest on.
- `ISSUE`: recorded as an evidence finding (source `ASSURANCE`), so the existing accept,
  edit, follow-up and resolve loop applies. The finding states the attribute's letter,
  what is not shown, and the passage or the absence it rests on.
- `UNSETTLED`: shown as "The two readings do not agree. Your judgment is needed.", with
  each reading's result and reason. Never a finding, never counted as support.
- For a file the chain covers, the reader's own model-derived findings (source `READER`:
  gaps, partial and uncovered items) are **not** proposed to a person: they were never
  checked by a second reading. The reader's answer stays on the reading's record. The
  deterministic checks (source `RULES`: placeholder text, version, dates) stay: they are
  facts located in the text.
- While a run works, the row says so. Nothing of a run is shown before it finishes.

Coverage on the D&I list: an attribute is *evidenced* by a file only when the run is
`SUPPORTED` for it **and** a person accepted the requirement's evidence. The agents'
`SUPPORTED` alone is "ready for you to accept".

## 4. Records (migration)

`evidence_assessments`, one row per run, never updated once finished except to be marked
out of date:

- identity: organization, project, control, file, the reading (`analysis_id`),
  requirement, phase;
- basis: the file's content hash, a hash of the attributes as assessed (each id, wording
  and criteria), the requirement's linked attribute ids, the lens, both prompt versions;
- state: `PENDING`, `WORKING`, `HELD`, `READY`, `FAILED`; the stage reached; lease and
  attempts as evidence_analyses has them; the gate's code and sentence when held;
- the two checked answers (never the raw model output), each with its model call id;
- the outcome per attribute (verdict, result, passages with locations, what is absent,
  and both views when unsettled);
- `stale_at` and `stale_reason` when the file is replaced or withdrawn, an attribute's
  wording or criteria changes, the attribute list changes, or the requirement's links
  change. A stale run is shown as out of date and a new run is queued where the file is
  still in force.

Idempotent: the same (file hash, requirement, attribute basis, prompt versions) is never
run twice; asking again returns the run on record. An edit to one attribute re-runs the
files it is assessed on; the unchanged attributes' results may be reused only when the
record shows the same attribute basis for them (a cost saving, never a shortcut on a
changed input).

`evidence_findings` gains the source `ASSURANCE` and the kinds `NOT_MET`, `PARTLY_MET`,
`CONTRADICTED` and `NOT_ADDRESSED`, by migration (never by silently widening a check).

Every model call goes through `provenance.AgentCaller` (budgets, trial reservations,
cancellation, the provenance record). A run that cannot pay for both readings does not
start the first one.

## 5. Pure core (for tests and the evaluation set)

In `evidence_assurance.py`, with no database:

```python
Result = Literal["MET", "PARTLY_MET", "NOT_MET", "CONTRADICTED", "CANNOT_TELL", "NOT_ADDRESSED"]
Verdict = Literal["SUPPORTED", "ISSUE", "UNSETTLED", "NOT_ADDRESSED"]
Lens = Literal["DESIGN_DOCUMENT", "INSTANCE_RECORD"]
Role = Literal["ASSESSOR", "REVIEWER"]

@dataclass(frozen=True)
class AttributeSpec: id: UUID; code: str; text: str; criteria: dict[str, Any] | None; expected: bool

@dataclass(frozen=True)
class FileSpec: id: UUID; name: str; kind: str; text: str; truncated: bool; sha256: str

@dataclass(frozen=True)
class ChainInput:
    control_ref: str; title: str; activity: str; lens: Lens
    attributes: tuple[AttributeSpec, ...]; file: FileSpec

def prompt_for(chain: ChainInput, role: Role) -> tuple[str, str]: ...   # (system, prompt)
def check_opinion(output: dict[str, Any], chain: ChainInput) -> Opinion: ...   # rules 1 to 6
def compare(first: Opinion, second: Opinion, chain: ChainInput) -> tuple[Outcome, ...]: ...
def run_chain(ask: Callable[[Role, str, str], dict[str, Any] | None], chain: ChainInput) -> ChainResult: ...
```

`Outcome` has `attribute_id`, `code`, `expected`, `verdict`, `result` (the agreed one, or
None), `passages`, `absent`, and `views` (both, when unsettled). `run_chain` is the gate's
successor stages only (assess, re-perform, compare); an `ask` that returns None for either
role gives every attribute `UNSETTLED` with the reason, never a guess.

The reviewer's prompt never contains anything from the assessor's answer. A test asserts it.

## 6. API

`GET /organizations/{o}/projects/{p}/controls/{c}/evidence-assurance` (project.read):

```json
{
  "files": [
    {
      "file_id": "…", "requirement_id": "…", "run_id": "…",
      "status": "QUEUED | CHECKING | HELD | REVIEWED | FAILED | OUT_OF_DATE",
      "stage": "GATE | ASSESS | VERIFY | COMPARE | DONE",
      "held": { "code": "KIND_UNSURE", "reason": "…" },
      "lens": "DESIGN_DOCUMENT",
      "read_in_part": false,
      "attributes": [
        {
          "attribute_id": "…", "code": "B", "expected": true,
          "verdict": "SUPPORTED | ISSUE | UNSETTLED | NOT_ADDRESSED",
          "result": "MET | PARTLY_MET | NOT_MET | CONTRADICTED | NOT_ADDRESSED | null",
          "summary": "…",
          "passages": [ { "quote": "…", "file_id": "…", "location": { "page": 3 } } ],
          "absent": [ "…" ],
          "views": [ { "role": "ASSESSOR", "result": "MET", "reason": "…" },
                     { "role": "REVIEWER", "result": "NOT_MET", "reason": "…" } ],
          "finding_id": "… or null"
        }
      ],
      "out_of_date": [ "…" ],
      "finished_at": "…"
    }
  ],
  "summary": { "checking": 0, "held": 0, "supported": 0, "issues": 0, "unsettled": 0 }
}
```

`held` is null unless HELD; `views` is empty unless UNSETTLED; `attributes` is empty until
the run is REVIEWED. One entry per in-force file on a DESIGN requirement, its latest run.

`POST .../evidence-assurance/{file_id}/rerun` (task.update): starts the run again for a
FAILED or OUT_OF_DATE file. Refused (409) while one works. Another firm gets 404; a
Reviewer reads and cannot rerun.

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
