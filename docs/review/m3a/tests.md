# M3a gate: commands run and results (21 October 2026)

Risk-based and change-focused (docs/test-strategy.md). The full legacy suite was not run.

| Command | Result |
| --- | --- |
| `uv run mypy` | Success: no issues found in 239 source files |
| `uv run ruff format services/api tests`, `uv run ruff check services/api tests` | clean after the automatic fixes |
| `pnpm exec tsc --noEmit --incremental false`; `pnpm exec tsc -p apps/web/tsconfig.json --noEmit --incremental false` | clean |
| `pnpm exec biome check` | 2 findings: `biome.json` line endings (known environment issue) and the regenerated `apps/web/next-env.d.ts` (restored with `git checkout`, never committed) |
| `pytest -n 3 test_migrations.py test_provenance.py test_agent_execution.py test_pbc_drafting.py` | 31 passed (1 min 48 s) |
| `MODEL_LIVE_TESTS=1 pytest -s test_live_model.py` (by hand, with the owner's key) | 2 passed in 31 s; $0.0427 ([live-smoke.md](live-smoke.md)) |
| `make test-fast` (FAST_PY now includes `test_agent_execution.py`, `test_provenance.py`) | 102 Python passed in 2 min 40 s; 112 Node passed |
| `make test-critical` (CRITICAL_PY now includes both new files) | first run 3 failed, 377 passed in 5 min 10 s (`test_workpapers`: the workpaper drafter's audit call read an `agent_instance` variable that the no-model path never set, an UnboundLocalError in `run_draft`; fixed by initialising it before the branches); rerun after the fix: **380 passed, 0 failed in 5 min 12 s** |
| `python -m ai_workforce_api.migrate` on the development database | applied 0094; 8 standard workers in place; 0 expired contents removed; 1,777 existing `model_calls` rows kept |

## New tests

`test_provenance.py` (6): tiers pin priced models and refuse an unpriced live one; a call
is recorded with its provenance and its contents encrypted (and read only by the owner,
admin or engagement reviewer with a purpose, audited; 403, 404, 409 and 422 as expected);
contents kept only with a key and removed once expired (trigger refuses update and early
delete); budgets refuse before dispatch (call, job, month) and record the refusal; transient
failures retried with the pauses and each attempt recorded, a rejected request not
retried, a malformed answer asked once more, a provider bug a failed call; a cancellation
honoured before the call.

`test_agent_execution.py` (9): the tester records its calls with provenance and acts as
the agent; a provider failure leaves FAILED items for a person, never a rules result, and
nothing is signed off; without a model the rules run and say so; the evidence reader names
a model failure behind its rules result (FALLBACK); a person cancels a queued or running
run and runs it again (queue shows the stopped run; a firm reviewer is refused, another
tenant sees nothing); a queued evidence read can be cancelled; a crashed run resumes
without a duplicate or partial result; no page or queue read calls the model; the
automation status names the model without calling it.

`test_live_model.py` (2, skipped unless `MODEL_LIVE_TESTS=1`): each tier answers a
structured prompt and is recorded with its cost; the tester tests synthetic evidence with
the live model.

Node: `draft-model.test.ts` (a rules draft after a model failure is told apart from a
deliberate one), `analysis-model.test.ts` (FALLBACK and FAILED kept apart from RULES),
`review-model.test.ts` (FALLBACK re-performance).

## Legacy expectations rewritten

Two tests in `test_pbc_drafting.py` expected `RULES` after a rejected or failed model
draft; they now expect `FALLBACK` with the failure named first (the owner's decision 5).
Recorded in docs/test-strategy.md §5 and docs/milestone-3-plan.md §14. No assertion was
weakened or retired.

## Closure gate (§15)

| Command | Result |
| --- | --- |
| `uv run mypy` | clean (241 files) |
| `ruff format` / `ruff check` | clean |
| `tsc` (root and web) | clean |
| `pnpm exec biome check` | clean except the known `biome.json` endings and the regenerated `next-env.d.ts` (restored) |
| Node: agent-says, sheet, review, workpaper, control-workspace models | 63 passed |
| targeted Python (17 files across every touched module) | first run 9 failed, 142 passed; the five failing files after the fixes: 67 passed (4 min 43 s) |
| `make test-fast` | **106 Python passed in 2 min 28 s and 112 Node passed** |
| `make test-critical` | **384 passed, 0 failed in 5 min 28 s** |
| `python -m ai_workforce_api.migrate` | 0095 applied to the development and the demo databases |

The first run's failures: a test's chat message shape; `evidence_analysis` still held a
direct `record_call` for the no-model path (removed: nothing records without a model);
the request drafter's inputs carried planned items that were not JSON (now a count); the
caller retried a malformed answer once, which doubled the calls of the reading path whose
stricter checks already read such answers (the retry is removed; only transient failures
are retried); and the legacy expectations listed in docs/test-strategy.md §5.
