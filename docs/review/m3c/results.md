# M3c live validation results

Synthetic data only: the grounded-testing scenario set in `corpus/` (built by
`scripts/build_corpus_m3c.py`), loaded into isolated test databases. Model: Claude Sonnet
5.5 on the BALANCED tier for the tester (`control-tester/2`), the reviewer
(`independent-reviewer/2`) and the M3b mapping that ran first (`evidence-mapping/2`).
The scorecards in this folder are the raw output of `services/api/tests/test_live_grounded.py`.

## Denominators

The set has 18 samples and 98 cells (one per sample and approved attribute). Every cell's
expected result was fixed in `corpus/manifest.json` before any model ran.

| Category | Cells | What it means |
| --- | --- | --- |
| Clean | 70 | The evidence satisfies the attribute. PASS is right; an EXCEPTION is a false exception. |
| Planted negative | 20 | A planted defect: the attribute is not shown to be met. A PASS is a false pass. |
| Dependent | 8 | Affected by a defect planted for another attribute of the same sample; more than one result is defensible. In neither rate. |

## The tester (two runs)

| Measure | Run 1 | Run 2 |
| --- | --- | --- |
| Cells with a result | 98 of 98 | 98 of 98 |
| False passes on planted negatives | **0 of 20** | **0 of 20** |
| Negatives at exactly the expected result | 14 of 20 | 13 of 20 |
| False exceptions on clean cells | **0 of 70** | **0 of 70** |
| Clean cells passed | 58 of 70 | 59 of 70 |
| Clean cells inconclusive (unable or human review) | 12 of 70 | 11 of 70 |
| Unable to determine, all cells | 11 of 98 | 12 of 98 |
| Human review required, all cells | 9 of 98 | 8 of 98 |
| Passes with a verified citation | 63 of 63 | 62 of 62 |
| Exceptions with observed, expected and support | 15 of 15 | 16 of 16 |
| Prompt injections followed | **0** (11 cells on the 2 injection samples) | **0** |
| Citations offered that are not in the evidence | 0 of 191 | 0 of 189 |
| Rule-check sides offered and located | 162 of 162 | 128 of 128 |
| Rule checks proposed | 81 | 64 |
| Results changed by a rule check | 1 (CHG-2005 E, to unable) | 0 |
| Execution failures | 0 | 0 |
| Protected decisions unchanged | yes | yes |
| Items given the mapping's passages as context | 17 of 18 | 17 of 18 |

A negative that is not exactly the expected result is still not a false pass: u0007 and
CHG-2008 attributes expected as unable were proposed as exceptions (missing approval and
test evidence called an exception, which is defensible), and u0010's misleading approval
was proposed as unable rather than an exception. Every one of these is listed with its
note in the scorecards (`outcome: ACCEPTABLE`).

### Repeatability

The runs agree on 88 of the 98 cells: 63 of 70 clean, 19 of 20 negative, 6 of 8
dependent. All ten differences are between a pass and an inconclusive result (or, on one
negative, between unable and exception). No cell moved between pass and exception, and
neither run made a false pass or a false exception.

### Every inconclusive result on a clean cell

| Attribute | Cells (run 1 / run 2) | What the tester said | Assessment |
| --- | --- | --- | --- |
| ITGC-AC-01 B: approved by the manager and, where the policy requires it, by the application owner | u0001, u0002, u0003, u0006, u0009 (both runs; human review) | The manager's approval is verified; the access policy and the application owner list are not in the evidence, so whether owner approval was needed, and whether Helen Cho is the owner, is for a person. | Defensible. The attribute's own condition ("where the policy requires it") cannot be resolved from the evidence, which holds no policy and no owner register. The tester did not pass a condition it could not verify. The expected outcome is unchanged; whether the scenario set should carry a policy extract is for the owner. |
| ITGC-AC-01 D: the access granted is the access approved, and no more | Run 1: u0003, u0005, u0008. Run 2: u0004, u0005, u0008, u0009 (unable) | No system-side role listing for the user: the ticket's provisioning line and the population row show the role granted, but cannot show that nothing more was granted. | Defensible professional scepticism ("and no more" calls for the system's own record), applied inconsistently: other clean samples with the same evidence passed. The reviewer raised the same point on passes (below). The expected outcome is unchanged; the owner may decide whether clean samples should carry a system extract. |
| ITGC-CM-01 D: the business owner and the IT owner approved before deployment | Run 1: CHG-2003, 2004, 2008. Run 2: CHG-2003, 2007 (human review) | Both approvals are dated before deployment, but no document designates the business owner and IT owner of SAP ERP. | Defensible, inconsistent across samples (the same evidence passed elsewhere). Same pattern as AC-01 B. |
| ITGC-CM-01 E: neither approver developed or implemented the change | Run 1: CHG-2005 (unable, by a rule check) | The tester found no overlap, but put both approvers in one value of its "different" comparison; that value is not in a single quoted passage, so the side was unverified and the pass became unable. | A system-caused unable: the rule check fails safe (never a false pass) but cost a correct pass. Recorded as a known defect; the fix (one value per side, one comparison per pair) is recommended, not tuned against this set. |

Every unable and human-review result, with its note and whether the evidence was
otherwise complete, is in `unable_and_review_analysed` in each tester scorecard.

## The reviewer (planted tester errors)

A scripted tester planted 16 false passes (each citing a real passage of the evidence a
careless tester could cite) and 2 false exceptions, kept 4 correct exceptions and 68
correct passes (the 72 correct results), and passed the 8 dependent cells. The testing was signed off, the effectiveness workpaper prepared and the
review opened through the real path; the live reviewer re-performed every item without
the tester's results.

| Measure | Run 1 | Run 2 | Run 3 (after the fix below) |
| --- | --- | --- | --- |
| Planted false passes caught | 15 of 16 | 15 of 16 | **16 of 16** |
| as must-fix (reviewer found an exception) | 12 | 12 | 13 |
| as should-fix (reviewer found it unable, for a person, or not applicable) | 3 | 3 | 3 |
| Planted false exceptions caught | 2 of 2 | 2 of 2 | 2 of 2 |
| Notes raised on correct results | 5 of 72 | 4 of 72 | 5 of 72 |
| Citations offered not in the evidence | 0 of 164 | 0 of 170 | 0 of 167 |
| Protected decisions unchanged | yes | yes | yes |
| Every note proposed, every review open | yes | yes | yes |

**The miss (runs 1 and 2): u0007 E** ("the approver is not the user, and the administrator
who granted the access did not approve it"), planted as a pass. The reviewer answered
not applicable: "No approval exists, so there is no approver to compare with the user or
administrator; the lack of approval is already an exception under attributes 1–3." The
reviewer disagreed, but the comparison table (`control_reviews._DISAGREEMENTS`) had no
entry for a pass against not applicable, so the disagreement was dropped without a note.
That is a system defect, not the model's: the table now raises a should-fix note for a
pass or an exception the reviewer finds not applicable, with a regression test. Run 3,
after the fix, caught all 16.

**Notes on correct results:** 13 of the 14 across the three runs are on ITGC-AC-01 D (no
system-side role listing), the same scepticism the tester showed; one (run 2, u0008 E) is
the rule-check representation defect above, in the reviewer's own answer. They are
should-fix proposals for a person; none is a must-fix.

**The rules' notes** (reported apart from the model's): on both controls, "the sheet tests
10 (8) items; the standard sample for an event-driven control is 25", although the whole
population was tested (a pre-existing rule that does not recognise a population smaller
than the standard sample); "there is no design and walkthrough workpaper"; and "the
proposed deficiency was dismissed", which the validation did deliberately.

## Cost

| Run | Mapping | Tester | Reviewer | Total |
| --- | --- | --- | --- | --- |
| 1 | $0.437 | $0.702 | $0.297 | $1.437 |
| 2 | $0.439 | $0.657 | $0.294 | $1.390 |
| 3 (reviewer only) | — | — | $0.290 | $0.290 |
| **All live M3c runs** | | | | **$3.12** |

No call was refused by a budget; every call succeeded.

## Closure run (after the owner's conditional acceptance)

One fresh live run with the closure code: prompts `control-tester/3` and
`independent-reviewer/3` (one atomic value per comparison side), the rule-check
correction, and the reviewer's not-applicable disagreement. The scenario set, the manifest,
the expected outcomes and the planted reviewer errors are unchanged. The scorecards are
`live-tester-closure.json`, `live-reviewer-closure.json` and `live-supplement-closure.json`.
The results of runs 1 to 3 above are unchanged.

| Tester | Closure run |
| --- | --- |
| False passes on planted negatives | **0 of 20** |
| Negatives at exactly the expected result | 15 of 20 |
| False exceptions on clean cells | **0 of 70** |
| Clean cells passed / inconclusive | 55 / 15 of 70 |
| Unable / human review, all cells | 14 / 10 of 98 |
| Passes with a verified citation | 60 of 60 |
| Exceptions explained and supported | 14 of 14 |
| Injections followed | 0 |
| Citations offered not in the evidence | 0 of 197 |
| Rule checks proposed / held / did not hold / not evaluable | 102 / 91 / 9 / 2 |
| Results changed by a rule check | 1 (CHG-2004 C, to unable) |
| Agreement with run 1 / run 2 | 92 / 86 of 98 cells; no cell moved between pass and exception |

**The 15 inconclusive clean cells:**

- **ITGC-AC-01 B (five cells):** the access policy and the owner list.
- **ITGC-AC-01 D (five cells):** the system role listing.
- **ITGC-CM-01 D (four cells):** the owner designation.
- **CHG-2004 C (one cell):** the rule check compared "PRD" with the population cell "SAP ERP PRD"; a population side must equal a whole cell, so the side was unverified and the pass became unable (fail-safe).

The first three are the supporting-evidence requests analysed in `evidence-requirements.md`.

The run 1 rule-check case (CHG-2005 E, two approvers in one value) passed.

| Reviewer | Closure run |
| --- | --- |
| Planted false passes caught | **16 of 16** |
| as must-fix / should-fix | 13 / 3 |
| Planted false exceptions caught | 2 of 2 |
| Notes on correct results | 3 of 72 (u0002 D, u0008 D, u0009 D: no system role listing) |
| "Not applicable" answers on a pass or an exception | 1 (u0007 E), and it raised a should-fix finding |
| Citations offered not in the evidence | 0 of 166 |
| Protected decisions unchanged; every note proposed, every review open | yes |

| Supplement (`corpus-supplement/`, tester only, no mapping) | Result |
| --- | --- |
| False passes on planted negatives | 0 of 3 |
| Planted negatives exactly right | 3 of 3 (u0102 B, u0103 D, CHG-2101 D) |
| False exceptions on clean cells | 0 of 16 |
| Clean cells passed | 15 of 16 (u0103 B: the policy and owner list again) |

**Cost of the closure run:** tester with the mapping $1.15, reviewer $0.29, supplement $0.16, total $1.60. **All M3c live runs together cost $4.72.**
