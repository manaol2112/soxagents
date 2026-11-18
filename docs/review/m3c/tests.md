# M3c gate: commands run and results

All on 21 October 2026, on the final M3c code unless stated. Six workers (`make` default).

| Command | Result |
| --- | --- |
| `make lint` | ruff format and check clean (250 files); biome reports only `biome.json` and `apps/web/next-env.d.ts`, both line endings of unmodified files in this working copy (known environment issue) |
| `make typecheck` | mypy clean (250 files); both TypeScript projects clean |
| `make test-critical` | **411 passed, 0 failed** in 5 min 51 s (M3b's 401, plus `test_grounded_testing.py`'s 10) |
| `make test-fast` | **133 Python passed** in 3 min 9 s; **128 Node passed**, 0 failed (run before the rationale placement fix; the critical and full runs are after it) |
| `pnpm exec node --test tests/*.test.ts` (every Node file) | **722 passed, 0 failed**, after the two form fixes below (first run: 721 passed, 1 failed) |
| `make test-full` (the whole legacy Python suite) | **873 passed, 0 failed, 6 skipped** in 12 min 40 s. The 6 skipped are the gated live tests (`test_live_corpus`, `test_live_grounded`, `test_live_model`). |
| `MODEL_LIVE_TESTS=1 … pytest services/api/tests/test_live_grounded.py` | Run 1: 2 passed (12 min). Run 2: 2 passed (11 min 29 s). Run 3, reviewer only after the disagreement fix: 1 passed (2 min 38 s). Results in `results.md`. |

## How the full suite came to pass

| Run | Result | What was found |
| --- | --- | --- |
| 1 (shared the database with the live runs and the demo build) | 866 passed, 6 failed | Four failures were PostgreSQL's connection limit ("too many clients", 503, "authentication unavailable") and one a one-microsecond timing difference in `test_engagement_data`'s export; all five passed when rerun alone. Two were real (below). |
| 2 (nothing else running) | 871 passed, 2 failed | Both "too many clients" (Temporal holds 24 of the 100 connections); `test_agents.py` and `test_round_reviews.py` rerun alone: 7 passed. |
| 3 (final code, after the rationale placement fix) | **873 passed, 0 failed** | |

The two real failures:

- `test_control_context.py::test_a_pass_stands_only_on_cited_evidence` — **caused by M3c**.
  Old expectation: an exception with no citation and no explanation stands as EXCEPTION.
  New: it goes to a person (REVIEW, note starting with the unsupported-exception text),
  and an added case shows an explained, cited exception standing. Justification: the
  owner's M3c rule that every exception explains the observed and expected conditions and
  its supporting evidence. Recorded in the test.
- `test_evidence_plans.py::test_the_agent_plans_when_its_plan_passes_the_checks` —
  **pre-existing since M3a** (confirmed failing on a clean checkout of 4f9ef42; the file
  is in neither the fast nor the critical set). Old expectation: a model plan rejected by
  the checks is recorded as RULES. New: FALLBACK, the rules' plan standing in with the
  call linked, as M3a made it (a model failure is never recorded as the rules' work; the
  code says so at `evidence_plans.Planned`). Recorded in the test.

And one pre-existing Node failure, `tests/no-autofill.test.ts` ("autocomplete is off on
every form"), from the M3a cancel form (`agent-says.tsx`) and the M3b mapping form
(`evidence-mapping-view.tsx`): fixed in the code by adding `autoComplete="off"`; the test
is unchanged.

## Legacy expectations changed in M3c, with the justification

| Test | Before | After | Why |
| --- | --- | --- | --- |
| `test_testing_engine._answer`, `_Citing` (fixtures, used by many files) | The scripted tester's exceptions had no observed or expected condition and no citation | They carry both conditions and cite a passage, as a compliant tester must | M3c: an unexplained or unsupported exception goes to a person. A fixture change, no assertion changed. |
| `test_agent_execution` (two assertions) | Prompt version `control-tester/1` | `control-tester/2` | The tester's prompt changed. |
| `test_agent_execution::test_a_provider_failure_leaves_failed_items…` | A failed item holds UNABLE results and the provider's note | No results; note starts "Not tested: the tester's model call failed (a technical failure…)" and ends with the provider's note; state FAILED; the blocking line names the technical failure | The owner: "EXECUTION FAILED is a technical failure, not an audit result." The failed call is still linked, nothing is concluded, sign-off is still refused. |
| `test_agent_execution` crash test (fixture) | The stubbed check took three arguments | It passes the population row through | The check gained the item's population row. |
| `tests/agent-says-model.test.ts` (fixture) | A cell without the new fields | The four new fields, empty | The cell type gained them. |
| `test_control_context`, `test_evidence_plans` | As above | As above | As above. |

No test was deleted or skipped, and no audit-integrity assertion was weakened.

## After the owner's tiered strategy (21 October 2026)

| Command | Result |
| --- | --- |
| `make test-critical` (with `CRITICAL_PICKED` and `CRITICAL_NODE`) | **419 passed, 0 failed** in 6 min 14 s; Node safeguard test 1 passed |
| `make test-fast` (with `no-autofill` in `FAST_NODE`) | **133 Python passed** in 3 min 5 s; **129 Node passed** |
| `pytest test_engagement_data.py test_reports.py` | 31 passed; the export test alone three more times, passed each time |
| `make lint`, `make typecheck` | Clean (known line-ending reports on `biome.json` and `apps/web/next-env.d.ts`) |

`make test-full` was not rerun; see the completion report, section 6.1.

## M3c closure (after the owner's conditional acceptance)

| Command | Result |
| --- | --- |
| `make lint`, `make typecheck` | Clean (251 files); known line-ending reports only |
| `make test-critical` | **421 passed, 0 failed** in 6 min 6 s; Node safeguard test passed |
| `make test-fast` | **135 Python passed**; **129 Node passed** |
| `pnpm exec node --test tests/*.test.ts` | **723 passed** |
| Expanded scope (`test_controls_batch`, `test_engagement_close`, `test_engagement_data`, `test_evidence_planning`, `test_evidence_workspace`, `test_library_matching`, `test_onboarding`, `test_plan_grounding`, `test_portal_workspace`, `test_rcm_uploads`, `test_request_details`, `test_request_quality`, `test_template_pinning`, `test_testing_definitions`, `test_workpaper_templates`, `test_control_context`, `test_reports`) | **193 passed** in 4 min 59 s |
| `MODEL_LIVE_TESTS=1 … pytest services/api/tests/test_live_grounded.py` | **3 passed** (tester, reviewer, supplement) in 13 min 33 s |

**Not run: `make test-full`.** The completion report's section 11.6 gives the reason.

**Expectations changed in the closure, with the justification:**

| Test | Before | After | Why |
| --- | --- | --- | --- |
| `test_grounded_testing::test_the_rationale_is_proposed_pending_review_and_never_the_conclusion` | A person's edit of the rationale marked it reviewed | An edit keeps it pending; Prepare is refused without the confirmation and for an agent principal; the confirmation records the review; a later edit voids it | The owner: "Editing must not automatically constitute review or approval" |
| `test_workpapers`, `test_control_reviews` (two calls), `test_grounded_testing::prepare_for_review` | Prepare an effectiveness workpaper with its version | The person also confirms the rationale review (`rationale_reviewed`); `test_workpapers` first asserts the refusal without it | The owner: explicit human review before workpaper approval |
| `test_agent_execution` (two assertions) | Prompt `control-tester/2` | `control-tester/3` | The prompt asks for one atomic value per side |
| `tests/control-workspace-model.test.ts` (fixture) | A section without a review | `review: null` | The section type gained it |

No test was deleted or skipped, and no audit-integrity assertion was weakened.

