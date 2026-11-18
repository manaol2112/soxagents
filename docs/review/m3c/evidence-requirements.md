# Evidence the agents asked for on clean samples: required or not?

The owner's decision on the M3c review (item A): before adding documents to clean
scenarios, decide whether the approved attributes require them; distinguish mandatory,
supporting and unnecessary evidence; keep the M3c scenario set and its expected results
unchanged; put any scenario where a document is genuinely needed in a separate
supplement; and say whether the agents' inconsistency calls for a change to the testing
logic.

## What the agents asked for

In the two live M3c runs, every inconclusive result on a clean cell came from one of three
requests (results.md, "Every inconclusive result on a clean cell"):

| Attribute (approved wording) | What was asked for | Where (run 1 / run 2) |
| --- | --- | --- |
| ITGC-AC-01 B: "The request was approved by the user's manager and, where the access management policy requires it, by the application owner" | The access policy, and an application owner register showing Helen Cho is the owner | 5 of 5 clean samples, both runs (human review) |
| ITGC-AC-01 D: "The access granted in the system is the access that was approved, and no more" | A system-side listing of the user's roles | 3 and 4 of 7 clean samples (unable); the reviewer raised it on passes 13 times in three runs |
| ITGC-CM-01 D: "The business owner and the IT owner approved the change before it was deployed to production" | A register designating the business and IT owners | 3 and 2 of 6 clean samples (human review) |

## Classification against the approved attributes

| Document | Attribute | Class | Why |
| --- | --- | --- | --- |
| Access policy | AC-01 B | **Supporting** where both approvals are present; **mandatory** only where the owner's approval is absent | The attribute's condition ("where the policy requires it") decides only whether the owner's approval is needed. When the owner did approve, the attribute is met whatever the policy says. Every clean M3c sample has both approvals, so the policy cannot change their result. |
| Application owner register | AC-01 B | **Supporting** | The ticket records the approval in the application owner's role ("Application owner approval: Helen Cho"), the request tool's own record. A register raises confidence that the person is the owner; the attribute does not require one, and nothing in the evidence contradicts it. It becomes decisive only when other evidence says the approver is not the owner. |
| System role listing | AC-01 D | **Supporting** for the M3c samples | "In the system" is evidenced by the population listing (the system's record of each grant, one row per user, with the role) and the provisioning record. Both show the approved role. A full role listing is how "and no more" is shown most strongly, and it is decisive when it shows more; it is not needed to show what the system granted in this provisioning event. |
| Owner designation register | CM-01 D | **Supporting** | The change record names each approval in its owner role. The attribute asks that both owners approved before deployment; it does not require a separate designation document unless the evidence suggests the approver is not the owner. |
| (none) | — | **Unnecessary** | None of the requests was unnecessary in kind: each would raise confidence. What was unnecessary was withholding a result for them where the evidence on hand already meets the attribute. |

So, for the M3c scenario set as built, **none of the requested documents is mandatory**,
and the clean expectations (PASS) stand unchanged. Each document is mandatory in a
different scenario, where it decides the result. Those scenarios are now the separate
supplement (`services/api/tests/corpus_m3c_supplement.py`, written to
`docs/review/m3c/corpus-supplement/`), with their own fixed expectations:

| Sample | The document | What it decides | Expected |
| --- | --- | --- | --- |
| u0101 | Policy AM-2 §4: owner approval only for roles ending in Admin | AP Clerk, manager approval only: B is met | PASS |
| u0102 | The same policy | Payroll Admin, manager approval only: B is not met | EXCEPTION |
| u0103 | The system's role listing: AR Clerk and AR Supervisor assigned on the grant date | D: more was granted than approved | EXCEPTION |
| CHG-2101 | The SAP ERP owner register: the business owner is Elena Rossi | D: the business approval is by Jonas Brandt, not the owner | EXCEPTION |

The M3c scenario set, its manifest and its 98 expected results are unchanged.

## The inconsistency, and whether the testing logic needs to change

- **The pattern.** The agents treated supporting evidence as mandatory on some samples and
  not on others with the same evidence: AC-01 D passed on four of seven clean samples in
  run 1 and three in run 2, with the same kinds of evidence; CM-01 D passed on three and
  four of six. The choice moves between runs (88 of 98 cells agree; every difference is between
  a pass and an inconclusive result).
- **What it is not.** It is not a false pass or a false exception: the scepticism only ever
  withheld a pass. It costs a person's time, not audit correctness.
- **Assessment.** The prompts tell the tester to test against the attributes but do not
  say how to treat evidence that would merely raise confidence. Professional judgment is
  involved, and the safer error is the one made. An improvement is warranted, but not
  tuned on this scenario set: the instruction would be "an attribute met by the evidence
  on hand is a pass; supporting evidence that would raise confidence goes in
  limitations, not in the result", validated on a fresh scenario set so that the change
  is not fitted to the one it is measured on. Recommended for M3d; not made in M3c.
- **Evidence planning.** Where an engagement does require these documents (a firm's
  methodology may), the place to require them is the approved evidence plan and the
  attribute's definition, which the tester already receives, not the tester's discretion.
