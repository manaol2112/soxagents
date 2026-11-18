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
| B8 | Intermittent: `test_attributes_follow_understanding.py::test_a_run_whose_process_died_reads_as_stopped_and_resumes_when_the_worker_starts` failed once in a parallel run of its file on 18 Nov 2026 (traceback lost: the output was piped through `tail`) | Characterized 18 Nov 2026: not reproduced in 40 plain runs; `resume()` hands over exactly the expected run (instrumented), each test has its own database, and every lease compares on the database clock. A sweep of 109 runs with one connection forced to fail never gave a wrong result, and produced a real "Address already in use (10048)" in fixture setup: most likely B6 (this test opens about 109 connections in 9 seconds). The earlier hypothesis (the test reads before the pool's hand-offs end) is wrong: the pool is shut down before the assertion. A separate defect it found, a finished plan run retried when its follow-up could not be handed on, is fixed (`LocalDraftScheduler._after_plan`) | Windows | Linked to B6; closed with it, or reopened if a kept traceback (run with `-rfE --tb=short`, never through `tail`) shows another cause |

### Lifted

- B7 (18 November 2026, branch `b7-known-failures`): the three fast-tier tests that expected
  behaviour from before B1j/B1k were rewritten for the approved behaviour, each with a dated
  note giving the old and new expectation and no assertion removed. The third waited for the
  product owner, who confirmed that day that a due specialist review is queued over a failed
  planner run before Control Understanding is complete (recorded in
  `docs/control-workflow-plan.md`, B1l). A fourth fast-tier test, stale since the prompt-data
  change of 17 November (`test_design_workpaper_model.py`: `<b>` now arrives inert), was
  rewritten the same way. `make test-fast` on Windows, 18 November: Python 988 passed and
  that one failed (its file then 89 of 89); node 2,124 of 2,143, the 19 failures all B4.

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
