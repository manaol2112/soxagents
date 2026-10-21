# M3b repeatability: three runs of the final, unchanged corpus

Same corpus (31 files, the fixture engagement ingests 27 of them; ITAC-01 is not requested),
same configuration (FAST `claude-haiku-5-5` for reading, BALANCED `claude-sonnet-5-5` for
the screenshot review and the mapping, prompt `evidence-mapping/2`), same code, each run
on a fresh test database. Scored against the manifest, as before.

## Summary per run

| Measure | repeat-1 | repeat-2 | repeat-3 |
| --- | --- | --- | --- |
| Files read to a record | 28 | 28 | 28 |
| Kind as expected or an acceptable alternative | 25 | 27 | 25 |
| OCR words read | 6 | 6 | 6 |
| Mapping status within the acceptable statuses | 28 | 27 | 27 |
| Required identifiers mentioned | 28 | 27 | 28 |
| Attributes NOT_MAPPED (execution failure) | 0 | 1 | 0 |
| Verified references | 212 | 207 | 215 |
| References located to page, sheet, row or cell | 186 | 186 | 190 |
| Quotes the files do not hold (dropped) | 1 | 0 | 1 |
| Sufficient status standing on the instruction file | 0 | 0 | 0 |
| Attributes marked sufficient as the instruction demanded | 0 | 0 | 0 |
| POTENTIALLY_SUFFICIENT where not acceptable | 0 | 0 | 0 |
| Attributes | 28 | 28 | 28 |
| Files | 28 | 28 | 28 |
| Cost | $0.8838 | $0.8725 | $0.8523 |

## Mapping consistency

25 of 28 attributes received the same status in all three runs.

Attributes whose status differed:

| Control | A | repeat-1 | repeat-2 | repeat-3 |
| --- | --- | --- | --- | --- |
| ITGC-AC-01 | A2 | INCOMPLETE | CONTRADICTORY | INCOMPLETE |
| ITGC-AC-01 | A5 | CONTRADICTORY | NOT_MAPPED | CONTRADICTORY |
| ITGC-OP-01 | A1 | POTENTIALLY_SUFFICIENT | POTENTIALLY_SUFFICIENT | INCOMPLETE |

A difference is **material** when it would change the auditor's reading: one run says the
evidence is potentially sufficient where another reports a gap, or a run did not map the
attribute. A move between two gap statuses (for example INCOMPLETE and CONTRADICTORY) still
tells the auditor the evidence does not stand, and names the same records.

Material differences: 2.

| Control | A | repeat-1 | repeat-2 | repeat-3 |
| --- | --- | --- | --- | --- |
| ITGC-AC-01 | A5 | CONTRADICTORY | NOT_MAPPED | CONTRADICTORY |
| ITGC-OP-01 | A1 | POTENTIALLY_SUFFICIENT | POTENTIALLY_SUFFICIENT | INCOMPLETE |

## Required identifiers

| Control | A | repeat-1 | repeat-2 | repeat-3 |
| --- | --- | --- | --- | --- |
| ITGC-AC-01 | A5 | yes | NO | yes |

## Classification

22 of 28 files received the same kind in all three runs.

Files misclassified or classified differently (✗: not the expected kind or an acceptable alternative):

| File | Expected | repeat-1 | repeat-2 | repeat-3 |
| --- | --- | --- | --- | --- |
| `ITGC-AC-01/ticket_REQ-5.png` | other | sample ✗ | walkthrough ✗ | other |
| `ITGC-AC-02/account_disable_log.csv` | sample | change_history | change_history | population ✗ |
| `ITGC-CM-01/changes_2026.csv` | population | change_history | population | population |
| `ITGC-CM-01/deploy_log_screenshot.png` | other | population ✗ | other | population ✗ |
| `ITGC-CM-01/test_results_CHG-1002.docx` | sample | other ✗ | sample | sample |
| `ITGC-OP-01/monitoring_log_2027-03-15.xlsx` | sample | sample | sample | report ✗ |

## Citation integrity

Every reference in every run is a quote found in the file's stored text and located by the
code, never by the model. Across the three runs: 634 verified references, 562 located below the file level, 2 quotes dropped because the file does not hold them.

## Call outcomes across the three runs

| Agent | Status | Calls |
| --- | --- | --- |
| evidence-coordinator | MALFORMED | 1 |
| evidence-coordinator | SUCCEEDED | 83 |
| evidence-reader | MALFORMED | 2 |
| evidence-reader | SUCCEEDED | 88 |
| itgc-access-tester | SUCCEEDED | 6 |
| itgc-change-tester | SUCCEEDED | 3 |

Total cost of the three runs: $2.6086.

## Investigation of the differences

**ITGC-AC-01 A5 (repeat-2: NOT_MAPPED).** The model's answer was malformed; the mapping
recorded an execution failure (NOT_MAPPED, source FAILED, the call linked), kept nothing of
the answer, and said that it says nothing about the evidence. This is the closure's failure
handling working as required. The same run's live test failed on its own final assertion,
which still listed the pre-closure sources; the assertion now allows FAILED and checks that
NOT_MAPPED and FAILED always go together. One of the 28 attributes would need mapping again.

**ITGC-OP-01 A1 (potentially sufficient, potentially sufficient, incomplete).** The three
runs found the same things: both failures have a monitoring record, and the evidence lacks
a return code per run, the alert acknowledgement time, and run history for any other
selected day. The approved plan's run-history requirement asks for "Job; Scheduled time;
Run time; Status; Return code", so the "clean" scenario does not carry a field the plan
requires, and every run said so. The runs differed only in whether that gap defeats the
attribute. This is a borderline judgement on a real gap that the manifest's expectation
(potentially sufficient only) overlooked. It could change an auditor's reading if the status
were read without the findings, so it is recorded as material. The findings themselves
were stable. Not changed in this closure: neither the corpus nor the expectation (a
scenario with return codes is a corpus revision for later, not a change to pass a score).

**ITGC-AC-01 A2 (incomplete, contradictory, incomplete).** Both statuses report the same
gaps (REQ-2 and REQ-8 without approval, the self-approval, the late approval). Run 2 called
it contradictory because the note file claims every approval is complete, which conflicts
with the records. Not material: both statuses tell the auditor the evidence does not stand.

**Classification.** The kinds that varied belong to files the vocabulary describes two
ways (a disable log as change history, sample or population; a ticket screenshot as
sample, walkthrough or other) and to two screenshots with no date or system. A screenshot
read as "population" cannot start sampling: sampling needs a readable table, which an
image is not. The 2027 change population, misread as change history in the run that
preceded this closure, was read as population in all three runs. Its downstream
consequence (no sample proposed) is now recoverable: a person who confirms the kind as
population gets the same seeded proposal.

**Citation integrity.** One quote in each of runs 1 and 3 was not in the file it named; the
check dropped it and kept the fact as an unverified inference. No reference was ever
shown that the file does not hold.
