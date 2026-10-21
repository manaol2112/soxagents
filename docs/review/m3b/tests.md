# M3b gate: commands run and results (21 October 2026)

Risk-based and change-focused (docs/test-strategy.md). The full legacy suite was not run.

| Command | Result |
| --- | --- |
| `uv run mypy` | Success: no issues found in 245 source files |
| `uv run ruff format`, `uv run ruff check` | clean |
| `pnpm exec tsc` (root and `apps/web`) | clean |
| `pnpm exec biome check` | the known `biome.json` line endings and the regenerated `next-env.d.ts` (restored, never committed) |
| Manifest check: every corpus file through the deterministic readers | 31 of 31 as expected |
| `pytest test_evidence_corpus.py test_live_corpus.py` | 7 passed, 2 skipped (live, gated) on the final corpus |
| `node --test tests/evidence-mapping-model.test.ts` | 2 passed |
| `MODEL_LIVE_TESTS=1 pytest -s test_live_corpus.py` (by hand, owner's key) | full run 1: 1 failed (the scorer counted quoting the instruction file as standing on it; corrected); full run 2: passed; clean scenario: passed twice ([results.md](results.md), `live-scorecard.json`, `live-clean.json`) |
| `make test-fast` (FAST_PY with `test_evidence_corpus.py`; FAST_NODE with the mapping model) | 113 Python passed in 2 min 58 s; 114 Node passed |
| `make test-critical` (with `test_evidence_corpus.py`) | 391 passed, 0 failed in 5 min 33 s |
| `python -m ai_workforce_api.migrate` | 0096 applied to the development database |

No legacy expectation was rewritten in M3b. `test_agent_execution`'s no-model-on-reads
guard gained the mapping read route.

## Closure gate

| Command | Result |
| --- | --- |
| `uv run mypy` | clean (245 files) |
| `ruff format` / `ruff check` | clean |
| `tsc` (root and web), `biome check` | clean except the known `biome.json` endings and the regenerated `next-env.d.ts` (restored, not committed) |
| `pytest test_evidence_corpus.py` (with the closure tests) | 17 passed |
| Targeted: evidence analysis, reading, review, intake, sampling, request drafting, console, models, provenance, live tests (skipped without the flag) | 111 passed, 4 skipped, 1 failed: `test_evidence_reading::test_claude_receives_images_as_base64_blocks_before_the_prompt` |
| That file after its correction | 20 passed |
| `node --test` mapping model test | 2 passed |
| `make test-fast` | 123 Python passed in 3 min 0 s; 114 Node passed |
| `make test-critical` | **401 passed, 0 failed in 5 min 53 s** |
| Migrations 0096 and 0097 | applied to the development database; `test_migrations` and `test_schema` in the critical set |

**M3a regression found and corrected.** The failing evidence-reading test calls the live
adapter directly with the untiered configuration, which the M3a closure's containment
refuses as unmetered (commit 1483037). The file is not in the fast or critical sets, so
M3a's gate did not run it. The behaviour is the intended safeguard; the test now passes a
tier's configuration, as every caller does since M3a. Original expectation: an untiered live
call succeeds. New: the adapter is exercised through a tier's configuration. No safeguard
was weakened. Legacy expectations rewritten in the closure (owner's decision 5, a model
failure is never an evidence finding): none beyond this one; the corpus tests' own
expectations for failure modes are new.
