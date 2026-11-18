# Test baseline and known failures

The checks that fail today, kept apart from anything a new change breaks. A change is
judged against this list: a failure that is not here is new and belongs to the change.
No test is weakened or removed to shorten the list; an entry leaves when its cause is fixed.

Recorded 17 November 2026 on the `governance` branch (commit `c508e44` plus the governance
commits). Update the date and the rows whenever one is fixed or found.

## State of the gate

**CI is not healthy yet.** It has not run since 11 October 2026. The workflow now starts
PostgreSQL and runs on the working branches, but that has not been observed on GitHub, and
rows B1 to B3 below will fail its lint and type steps until they are fixed. Nothing here
may be described as passing in CI until a run shows it.

## What was observed

| Check | Where | Result |
| --- | --- | --- |
| Node tests, all 178 files | Linux container, clean export, no packages installed | 3,628 of 3,630 pass. The 2 failures need installed packages (`tests/rich-editor-view.test.ts`, `tests/security-headers.test.ts`), which CI installs |
| Node tests, all files | Windows checkout | 24 fail in 9 files. All pass on Linux: the cause is CRLF line endings and Windows paths (row B4) |
| `ruff check` | Windows | Pass |
| `ruff format --check` | Windows | 2 files fail (row B1) |
| `tsc` (web app) | Windows | Pass |
| `tsc` (root) | Windows | 1 error (row B2) |
| `mypy` | Windows | 6 errors in 2 test files (row B3) |
| Tier guard, safeguard tests, migration tests (46 tests) | Windows, real PostgreSQL | Pass |
| Python critical tier | Windows, earlier the same day, on `windows-dev` with uncommitted work | 1,295 pass, 7 fail (rows B5, B6) |
| Python critical tier | Linux | Not run. Unknown |

## Known failures

| Id | Failure | Cause | Platform | Lifted when |
| --- | --- | --- | --- | --- |
| B1 | `ruff format --check` fails on `services/api/ai_workforce_api/evidence_portal.py` and `system_scoping.py` | Committed unformatted | All | Both are formatted (no behaviour change). Needs approval: application files |
| B2 | `tsc`: `tests/attributes-handoff-model.test.ts:443`, property `working` does not exist on `RequestsView` | The test reads a field the model's type does not declare | All | The cause is diagnosed and the test or the type corrected, keeping the assertion |
| B3 | `mypy`: `tests/test_attributes_follow_understanding.py` (5) and `tests/test_assurance_forward_only.py` (1) import names their modules do not export | Private names used across modules | All | The names are exported or the imports corrected |
| B4 | 24 node tests in 9 files; `biome check` reports about 290 formatting errors | No `.gitattributes`, so a Windows checkout is CRLF; one test builds a path from a URL | Windows only | `.gitattributes` is merged and the checkout refreshed; `tests/evidence-wizard-contract.test.ts:29` uses `fileURLToPath` |
| B5 | 5 tests in `services/api/tests/test_understanding_review.py` | One splits a path on `/services/` (line 1205), which fails on Windows; four are undiagnosed | Seen on Windows | Diagnosed on Linux, then fixed |
| B6 | Intermittent "Address already in use (10048)" under parallel pytest | Hypothesis: ephemeral-port exhaustion | Windows only | Measured; until then lower `WORKERS` on Windows and rerun the failed file alone |

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
