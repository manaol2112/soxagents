# M3d tests: commands run and expectations changed

## Gate (Tier 2, with escalation)

Run on the final M3d code, on 21 October 2026, six xdist workers against the template database.

| Command | Result |
| --- | --- |
| `make lint` | Python clean (257 files formatted, all checks passed). Biome reports only the two known line-ending items (`biome.json`, `apps/web/next-env.d.ts`); environment issue, not edited. |
| `make typecheck` | `Success: no issues found in 257 source files` |
| `make test-critical` | **447 passed** in 7 min 30 s, plus the critical Node set 1 of 1 |
| `make test-fast` | **161 Python passed** in 4 min 50 s, **129 Node passed** |
| Every Node test file | **723 passed**, 0 failed |
| `services/api/tests/test_reliability.py`, `test_hostile_evidence.py` (in both sets above) | 23 and 3 passed |
| Gated live tests (`test_live_reliability.py`, `test_live_grounded.py`, `test_live_corpus.py`) | Run separately with the live key, never in the gate; results in `results.md`. `test_the_hostile_corpus_against_the_live_agents` **fails** on the stricter mapping-quote check (reported, not relaxed). |
| Escalation: `make test-full` (run 1) | 900 passed, 1 failed (name not kept by the quiet output), 10 skipped, 14 min |
| The same, runs 2 and 3 | Hung at about 87% in `test_system_scoping::test_a_review_asked_for_mid_run_runs_again_with_what_changed`, with 66 to 71 connections idle in transaction; stopped |
| Control: `pytest -n 6 --dist loadfile services/api/tests` on a checkout of 222ac28 | No hang; 864 passed, 6 failed, 7 skipped. All six are connection failures surfacing as 503 "authorization unavailable" or "session lookup failed" |
| `pytest -v -n 6 --dist loadfile services/api/tests` on M3d (run 4) | No hang; **895 passed, 1 failed, 10 skipped**, 14 min. `test_security::test_races_do_not_duplicate_side_effects` failed with "too many clients already" |
| That test and the root `tests/` Python tests, alone | **6 passed** |

The full suite runs at the edge of PostgreSQL's 100 connections (Temporal holds 25). Failures and hangs vary by run, on the M3c code too. The test that hung, and the code it exercises, are unchanged since 222ac28. M3d has no clean full run. Every test that failed on connections passed alone. For Tier 3, run with fewer workers or a higher `max_connections`.

**Why the escalation.** M3d changed shared infrastructure that every agent uses: `provenance.py` (the call configuration and the outcome record), `models.py` (the model-call record and its read), and migration 0098. The routine sets cover the tester, reviewer and mapping. They do not cover every other agent's model-call path, so the whole Python suite was run once on the final code.

## Expectations changed in existing tests

No test was retired. No audit-integrity assertion was weakened. Each change is recorded where it is made, in a comment in the test.

| Test | Old expectation | New expectation | Justification |
| --- | --- | --- | --- |
| `test_testing_definitions::test_the_tester_reads_each_definition_and_can_ask_a_person` | A REVIEW whose note is `"?"` is accepted | The REVIEW is given a real reason; a `"?"` note now makes the answer an execution failure (asserted in `test_reliability`) | The owner's item C: a schema-valid answer with no meaningful analysis must not count as success. What the test was for (REVIEW is a valid result) is unchanged. |
| `test_test_citations::test_results_carry_their_checked_citations` | A PASS whose note is `"ok"` carries no citations when no files are given | The same, with a note that states a reason | The same as above: `"ok"` is not analysis. The assertion on citations is unchanged. |
| `test_agent_execution::test_the_tester_records_its_calls_with_provenance_and_acts_as_the_agent` | Prompt version `control-tester/3` | `control-tester/5` | The tester's prompt changed (plan evidence, the plan rule). The provenance assertions are unchanged. The version is the point of the record. |
| `test_evidence_corpus::test_the_answer_schema_and_check_bound_what_the_model_can_say` | The injection file's passage stands as a verified reference (`["a.csv", "b.txt"]`, 3 dropped) | The passage is not a reference; it is kept as an inference marked "not used as evidence" (`["a.csv"]`, 4 dropped) | The owner's item A: untrusted evidence is source material, never support. The live hostile run found the mapping citing such passages. The old expectation encoded the behaviour M3d was asked to remove. The forged and out-of-range quotes still drop. |
| `test_migrations` (both tests) | Migrations up to 0097 | Adds `0098_model_call_outcomes` | A new migration. |

## Harness changes (not expectations)

`test_grounded_testing.grounded_engagement` gained two optional hooks, used by the live M3d runs:

- `before_upload`: a firm setting made before upload.
- `read`: the live reader instead of the scripted one.

It also accepts the hostile set's manifest through `as_manifest()`. Where a sample's file name holds a folder path, the harness asserts that intake refuses it (422) and uploads it again under its own name. The M3c sets use plain names, so their path is unchanged. The M3c corpus files and expectations are unchanged (`corpus_m3c.py` and `corpus_m3c_supplement.py` have no diff).

## Not run, and why

| Omitted | Why |
| --- | --- |
| Tier 3 (release-level runs) | At M3e, by the owner's strategy. |
| A full run with no failure | The connection limit above; not forced with changed settings, so that the record shows the gate as it ran. |
| Mobile UI checks | M3d changed no screen. The known mobile defects stay documented in `docs/known-defects.md`. |

## Closure (the owner's conditional acceptance)

Run on 21 October 2026 on the closure code, six workers.

| Command | Result |
| --- | --- |
| `make lint` | Python clean (260 files). Biome reports only the known line endings of `biome.json` and `apps/web/next-env.d.ts` |
| `make typecheck` | Clean |
| `make test-critical` (with `test_plan_evaluation.py` added) | **454 passed**, 0 failed; critical Node 1 of 1 |
| `make test-fast` (the same file added) | **168 Python passed, 130 Node passed** |
| Every Node test file | **724 passed** |
| `make test-full`, once, with `TEST_CONNECTION_AUDIT` and a `pg_stat_activity` sampler | **908 passed, 0 failed, 13 skipped** (the gated live tests) in 13 min 53 s. Peak 41 connections on the server (25 of them Temporal's), at most 2 for any test's database |

One reviewer change was made after the critical run: a passage on a line that instructs its reader or claims the audit's conclusion shows no element. It was covered by the full run above, which runs every critical and fast test, and by its own tests (2 passed).

**The PostgreSQL finding.** The sampler showed one test database holding 69 connections, 68 of them idle in transaction, while every other test held at most 2. That test was `test_system_scoping::test_a_review_asked_for_mid_run_runs_again_with_what_changed`, which held 74 when run alone.

- **The cause:** the test's patched `gather` posted to the API before recording its first call. Each request then rendered the engagement through the same patched function and posted again, recursing until PostgreSQL refused a connection. A refusal failed another worker's test, or an inner request waited on a lock: the earlier hangs.
- **Not M3d:** the test and the code it exercises are unchanged since 222ac28. Production never re-enters `gather`, which only the test patches. M3d adds no connection, pool or thread.
- **The correction:** a re-entry guard in the test, so a request made while the library loads does not load again, and a new assertion that it loads once. The test's own assertions are unchanged. Run alone, its database now peaks at 2 connections.
- **The diagnostic stays:** `TEST_CONNECTION_AUDIT=<file>` (conftest) records each test's open connections at teardown, before the forced drop would hide them. It is off by default.

**Expectations changed in the closure**, none weakened, none retired:

| Test | Before | Now | Why |
| --- | --- | --- | --- |
| `test_evidence_corpus::test_the_answer_schema_and_check_bound_what_the_model_can_say` | 222ac28: the injection passage was a reference (`["a.csv", "b.txt"]`, 3 dropped). First M3d round: no reference, an inference marked "not used as evidence", 4 dropped | `["a.csv"]`, 3 dropped, and the passage kept as an `INSTRUCTION` concern with its quote | The owner asked that such passages be flagged and surfaced for review, not only dropped. The scripted model labels the passage a record, so the test also shows the guard overriding the label |
| `test_hostile_evidence::test_an_obedient_tester_is_contained_…` | 9 of 10 false passes stand; the guard stops u0502 and u0510 | 6 of 10 stand; the guard stops u0501, u0502, u0506, u0510 and u0512 | The guard now also recognises claims of the audit's own work or conclusion. The reviewer still catches all 10 |
| `test_system_scoping::test_a_review_asked_for_mid_run_runs_again_with_what_changed` | Unbounded recursion through the patched function | Re-entry guard; adds `loads == [True]` | A defect in the test (above), not an expectation |
| `test_migrations` | Up to 0098 | Adds `0099_mapping_concerns` | New migration |

**Fixture format, not expectations:**

- **Scripted mapping answers** now carry `basis` per fact and a `concerns` list (`test_evidence_corpus`).
- **Scripted reviewer answers** now carry `elements` per result: `with_elements` in `test_grounded_testing`, and `_all_pass` in `test_control_reviews`.

These are the answer formats the closure's schemas require. What each test asserts is unchanged.

**New tests:**

- **`test_hostile_evidence`:** only a record supports an attribute; stored concerns are shown but never reach the tester; the guards flag no line of the clean scenario sets (the planted injection lines only, across more than 900 lines).
- **`test_reliability`:** a reviewer pass stands only element by element, including the u0007 D pattern; a reviewer that cannot show its elements raises every planted pass.
- **`test_plan_evaluation`:** the plan evaluation changes only the conflicting cells; the conflicts are the approved plan's REQUIRED evidence not in the samples.
- **Node:** the mapping panel's concerns.
- **Live, gated:** the unseen attack set; the repeated reviewer runs.

**Not run:** Tier 3, which stays at M3e; the full suite was not repeated after it passed.
