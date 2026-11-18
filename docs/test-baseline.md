# Test baseline and known failures

The checks that fail today, kept apart from anything a new change breaks. A change is
judged against this list: a failure that is not here is new and belongs to the change.
No test is weakened or removed to shorten the list; an entry leaves when its cause is fixed.

Recorded 17 November 2026 on the `governance` branch (commit `c508e44` plus the governance
commits). Update the date and the rows whenever one is fixed or found.

## State of the gate

**CI is not healthy yet.** First observed run on 18 Nov 2026 (commit `6fefafc`): toolchain, install, lint, type check and PostgreSQL passed; the critical tier ran 1,335 tests in 31 minutes, 1,331 passed and 4 failed, so the node tests after it did not run. The four, and a fifth that failed on Windows only, were fixed on 18 November 2026: an assumption accepted with its attribute was matched by the workpaper's letter instead of its stable code and never became a point (a defect, fixed in `design_points.py`); two test expectations predated approved behaviour and were rewritten with dated notes; one test split a path on `/` and is now portable. It has not run since 11 October 2026. The workflow now starts
PostgreSQL and runs on the working branches, and the lint and type failures
that predated this work (B1 to B3) are fixed. Nothing here may be described as passing in
CI until a run on GitHub shows it; record the run below when it does.

## What was observed

| Check | Where | Result |
| --- | --- | --- |
| Node tests, all 178 files | Linux container, clean export, no packages installed | 3,628 of 3,630 pass. The 2 failures need installed packages (`tests/rich-editor-view.test.ts`, `tests/security-headers.test.ts`), which CI installs |
| Node tests, all files | Windows checkout | 24 fail in 9 files. All pass on Linux: the cause is CRLF line endings and Windows paths (row B4) |
| `ruff check` | Windows | Pass |
| `ruff format --check` | Windows | Pass (two files formatted on 18 Nov; no behaviour change) |
| `tsc` (web app) | Windows | Pass |
| `tsc` (root) | Windows | Pass (a test narrowed its type; assertion unchanged) |
| `mypy` | Windows | Pass (one explicit re-export; one test imports `Json` from its library) |
| Tier guard, safeguard tests, migration tests (46 tests) | Windows, real PostgreSQL | Pass |
| Python critical tier | Windows, earlier the same day, on `windows-dev` with uncommitted work | 1,295 pass, 7 fail (5 in `test_understanding_review.py`, fixed 18 Nov; 2 were row B6) |
| Python critical tier | Linux | Not run. Unknown |

## Known failures

| Id | Failure | Cause | Platform | Lifted when |
| --- | --- | --- | --- | --- |
| B4 | 24 node tests in 9 files; `biome check` reports about 290 formatting errors | No `.gitattributes`, so a Windows checkout is CRLF; one test builds a path from a URL | Windows only | `.gitattributes` is merged and the checkout refreshed; `tests/evidence-wizard-contract.test.ts:29` uses `fileURLToPath` |
| B6 | Intermittent "Address already in use (10048)" under parallel pytest | Hypothesis: ephemeral-port exhaustion | Windows only | Measured; until then lower `WORKERS` on Windows and rerun the failed file alone |
| B7 | 3 tests in the fast tier (`make test-fast` has been red since 16 Nov 2026 because of them): `test_understanding_is_authority.py::test_an_open_conflict_from_before_is_closed_only_for_a_reason_that_is_true_of_it`, `test_question_review.py::test_many_questions_are_written_in_small_batches`, `test_attributes_follow_understanding.py::test_a_failed_planner_run_reads_as_stopped_once_the_understanding_is_complete` | Diagnosed 18 Nov 2026: each expects behaviour from before B1j/B1k (16 Nov) that its rewrite missed; no product defect, not a platform issue. See "B7: causes and plan" below | All (deterministic) | Each fixed as below, assertions kept; the third after the owner confirms the behaviour it tests |

### B7: causes and plan

Diagnosed on 18 November 2026; the fixes were each tried in a scratch copy and passed. Not yet
applied.

1. **Open conflict closed only for a true reason.** The last assertion (line ~1389) expects
   the attribute run to leave no question open, while a few lines earlier the same test
   asserts that two of them stay open under B1j rule 4 (commit 1e3bee6: a run no longer
   closes the earlier round's unanswered questions). The line predates that rule.
   *Fix:* assert the exact set left open (those two), with an Old/New note. Low risk.
2. **Many questions written in small batches.** Since B1k (49503f5) the review turns the
   model's gaps into assumptions rather than questions, so the helper `_raised` now raises
   one question, and one batch is written. The batching itself (`question_review.BATCH`)
   is intact. *Fix:* let `_raised` take the questions to raise, and give this test five;
   every assertion as written. Low risk.
3. **A failed planner run reads as stopped once the understanding is complete.** Since
   B1k, completion waits for the specialist's review, so after the test's answers the
   understanding is not complete and the specialist's read is queued over the failed run
   (`evidence_plans.py` ~2639-2660). *Fix:* complete the understanding first (run the
   plan through), then fail the run and change an answer, and keep every original
   assertion. Low risk. **Owner decision first:** "a failed run is queued over before the
   understanding is complete" is recorded only in commit 49503f5 and a code comment, not
   in the approved B1k/B1l plan (`docs/control-workflow-plan.md`); confirm it, and record it
   in the plan, before a test is built on it. That plan's line ~133 ("nothing is queued
   over a failed run") is true only after completion.

Verification: the three tests, their three files, then `make test-fast`. The critical tier
is not affected.

## Tiers

Every pytest file is in the fast, critical or demo tier or is named in `FULL_ONLY_PY` in
the Makefile; `services/api/tests/test_test_tiers.py` fails otherwise. `make test` runs the
critical tier and every node test (`make test-node`, about four seconds).

| Tier | Files | Runs |
| --- | --- | --- |
| Fast (`make test-fast`) | 61 | When a feature change is complete |
| Critical (`make test-critical`) | 110 | In CI on every push and pull request; at milestone closure |
| Demo (`make test-demo`) | 7 | Before a demonstration |
| Full only (`FULL_ONLY_PY`) | 72 | `make test-full`: at a major milestone, before a release, or on request |
| Node, all files | 178 | In CI on every push and pull request |

The 72 full-only files were in no tier before 17 November 2026. They are listed as found,
not as judged: moving the important ones up a tier is open work, one area at a time.

## Not established

- Whether the Python critical tier is green on Linux.
- Timings of each tier since the suite grew.
- Test coverage: no tool measures it.
- Browser behaviour: no browser test is committed, and `next build` runs in no check.
