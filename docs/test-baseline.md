# Test baseline and known failures

The checks that fail today, kept apart from anything a new change breaks. A change is
judged against this list: a failure that is not here is new and belongs to the change.
No test is weakened or removed to shorten the list; an entry leaves when its cause is fixed.

Recorded 19 November 2026 on `main` at `15a0a1c` (the testing assessment of that day, step 1).
Update the date and the rows whenever one is fixed or found.

## State of the gate

**CI is the integration gate, and it is green.** Until 19 November 2026 the `baseline` job
ran `make test` on Linux: the critical tier (`make test-critical`), then every Node test
(`make test-node`), after lint and type checks. Its last ten runs, 18 and 19 November 2026,
all passed, each in 26 to 43 minutes; the last (commit `15a0a1c`) ran 1,383 critical tests,
all passed, in 32 min 42 s. From the testing plan of 19 November the same checks run as
parallel jobs, with the critical tier in four parts, the fast tier's 26 other files (which no
CI run had reached) and the web app's production build added
(docs/test-strategy.md §1, G4); the required check is still `baseline`, which passes only
when every part passed. Its first run on GitHub (pull request #10, commit `ed63acb`,
19 November 2026) passed every part in 11 min 36 s from start to end: critical parts
9 min 28 s, 8 min 40 s, 10 min 17 s and 11 min 24 s; fast only 7 min 20 s; Node tests
1 min 50 s; lint and types 1 min 14 s; web build 53 s; `secrets` 22 s, `dependencies` 8 s.

**Local runs on Windows.** Every failure in the local pytest logs of 18 and 19 November 2026
was an environment error, not a product defect: `psycopg.OperationalError` "Address already
in use (10048)", or a 503 when the sign-in query lost its connection (row B6). Each passed
when rerun alone. The tiers are therefore not rerun locally as a gate; CI runs them.
`scripts/run_tests.py` reruns such an error once, alone, and reports it on its own line.

## Measured baseline (19 November 2026)

| Measure | Value | Where |
| --- | --- | --- |
| Critical tier, `-n 6` | 64 min 50 s; 1,759 passed, 3 failed and 1 error, all 10048 | Windows, a working branch |
| Fast tier | 25 to 27 min; about 1,010 passed per run, 2 to 4 failed, all 10048 | Windows |
| One file, `test_evidence_reliance.py` (330 tests, 21 with a database), `-n 2` | 212 s on the shared PostgreSQL, 215 s on a throwaway in-memory one | Windows |
| One file of pure tests (84 tests) | 2 to 3 s | Windows |
| Critical tier and every Node test in CI | 26 to 43 min, green | Linux, GitHub Actions |
| Per-test database clone, then drop | about 105 ms, then 175 ms (at most 1.15 s), on the shared server | benchmark |
| One database-heavy test of 14 s | about 152 new connections and 13,000 SQL statements | benchmark |

So the database set-up of a test is not the bottleneck (under half a second of a 14 s
test); the time is in the test bodies, where the application opens a connection per
operation. That connection churn is also what exhausts Windows' ephemeral ports (B6).

## What was observed

| Check | Where | Result |
| --- | --- | --- |
| `make test` (critical tier, every Node test), lint, type checks | Linux, CI | Pass, last ten runs (18–19 Nov 2026) |
| Node tests, all 180 files | Windows checkout, 19 Nov 2026 | 3,669 pass, 10 fail in `tests/evidence-wizard-contract.test.ts` (row B4) |
| `biome check` | Windows checkout, 19 Nov 2026 | Pass (`.gitattributes` keeps every checkout LF) |
| `ruff`, `mypy`, `tsc` | Windows | Pass |
| `test_assurance_eval_set.py` (full-only) | Windows, no database, 19 Nov 2026 | 59 of 59 pass (B9 lifted) |
| `tests/test_smoke.py` (critical tier since 19 Nov 2026) | Windows, 19 Nov 2026 | 5 of 5 pass (B10 lifted) |

## Known failures

| Id | Failure | Cause | Platform | Lifted when |
| --- | --- | --- | --- | --- |
| B4 | 10 node tests (5 groups) in `tests/evidence-wizard-contract.test.ts`, `ENOENT` on a path `C:\C:\Users\...%20...` | The test builds a file path from a URL by hand. The CRLF half of B4 was lifted by `.gitattributes`: `biome check` and the other node tests pass on Windows | Windows only | `tests/evidence-wizard-contract.test.ts:29` uses `fileURLToPath` |
| B6 | Intermittent "Address already in use (10048)", or a 503 when a request's connection is refused, under parallel pytest | Ephemeral-port exhaustion from connection churn: about 150 new connections per database-heavy test (measured 19 Nov 2026) | Windows only | The application reuses connections (a pool: a High-risk change of its own); until then `scripts/run_tests.py` reruns each such error once alone and reports it as environment |
| B8 | Intermittent: `test_attributes_follow_understanding.py::test_a_run_whose_process_died_reads_as_stopped_and_resumes_when_the_worker_starts` failed once in a parallel run of its file on 18 Nov 2026 (traceback lost: the output was piped through `tail`) | Characterized 18 Nov 2026: not reproduced in 40 plain runs; `resume()` hands over exactly the expected run (instrumented), each test has its own database, and every lease compares on the database clock. A sweep of 109 runs with one connection forced to fail never gave a wrong result, and produced a real "Address already in use (10048)" in fixture setup: most likely B6 (this test opens about 109 connections in 9 seconds). The earlier hypothesis (the test reads before the pool's hand-offs end) is wrong: the pool is shut down before the assertion. A separate defect it found, a finished plan run retried when its follow-up could not be handed on, is fixed (`LocalDraftScheduler._after_plan`) | Windows | Linked to B6; closed with it, or reopened if a kept traceback (the runner keeps the whole log and the JUnit XML) shows another cause |

### Lifted

- B9 (19 November 2026): `test_assurance_eval_set.py::test_prompts_build_and_the_reviewer_sees_nothing_of_the_assessor[three_files_together]`
  expected each file's first 200 characters in the prompt exactly as stored. Traced to
  `a41dad1` (18 November 2026, owner-approved): the prompt-data neutraliser makes every
  tag-shaped token in untrusted text inert, not only the prompt's own tag names, so the
  case's e-mail headers (`<marcus.hale@...>`) arrive as `‹marcus.hale@...>`. Not a defect:
  the text is in the prompt, made inert as approved, and quotes still match the stored text
  (citation matching folds `‹` back). Rewritten with a dated note (old, new, why): the file
  is still checked to be in the prompt, as the neutraliser gives it, and now also checked
  not to arrive raw where it holds a tag-shaped token. The file is full-only, so no routine
  run had shown it.

- B10 (19 November 2026): `tests/test_smoke.py::test_start_waits_for_health_and_reset_is_the_only_volume_delete`
  expected `down -v` in the `reset` recipe, which since calls `scripts/reset.sh`. Rewritten
  with a dated note for the same safeguard where the delete now lives: the recipe only calls
  `scripts/reset.sh`, the script runs `down -v`, and neither the Makefile nor any other
  script deletes a volume (a wider assertion than before). The file was in no tier because
  the tier guard read `services/api/tests` only; `test_test_tiers.py` now reads every test
  file pytest collects, in each testpath at any depth, and `tests/test_smoke.py` is in the
  critical tier.

- B4, its CRLF half (by 19 November 2026): `.gitattributes` (`* text=auto eol=lf`) keeps every
  checkout LF; `biome check` passes on a fresh Windows checkout and the CRLF node failures
  are gone. The URL-path half remains as B4 above.
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
the Makefile; `services/api/tests/test_test_tiers.py` fails otherwise. CI runs the critical
tier in parts and every node test (`make test-node`); `services/api/tests/test_ci_gate.py`
fails if the parts together are not the critical tier exactly, or if a fast-tier or
critical file does not run in exactly one CI part.

| Tier | Files | Runs |
| --- | --- | --- |
| Fast (`make test-fast`) | 61 (35 of them also critical) | The 26 not critical in CI's fast-only part, every push and pull request; locally on request only |
| Critical (`make test-critical`) | 118 files and 9 single tests (`CRITICAL_PICKED`), counting the two gate guards and `tests/test_smoke.py` added 19 Nov 2026 | In CI on every push and pull request, in four parts |
| Demo (`make test-demo`) | 7 | Before a demonstration |
| Full only (`FULL_ONLY_PY`) | 72 | `make test-full`: at a major milestone, before a release, or on request |
| Node, all files | 180 | In CI on every push and pull request |

The 72 full-only files were in no tier before 17 November 2026. They are listed as found,
not as judged: moving the important ones up a tier is open work, one area at a time.

## Not established

- The parallel CI gate's timing and its first green run (recorded above when it runs).
- Test coverage: no tool measures it (planned).
- Browser behaviour: no browser test is committed yet (planned).
- Windows in CI: not run (planned for the release gate, G6).
