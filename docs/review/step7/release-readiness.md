# Step 7 — Pre-launch security hardening and end-to-end trial acceptance

Release-readiness report, 30 October 2026. Branch `milestones-6.5-to-8.1b`, working tree on commit `1ed646b` plus the uncommitted Steps 2–7. Nothing has been committed, pushed or deployed.

Verdict: **no release blocker remains open in the Step 7 scope**, and every test suite is green after the three fixture and expectation updates recorded in section 9b. The trial and demo are release-ready once the production deployment checklist (section 11) is completed and the High-priority items (section 10) are scheduled. The system is not marked production-ready until the owner accepts this report, the deployment checklist is executed, and the full-suite run in section 9 is confirmed on the commit that ships.

## 1. Hardening summary

| Area | What was built | Where |
| --- | --- | --- |
| Request throttling | Database-backed fixed windows, one atomic upsert per request, shared by every API instance. Scopes: sign-in start and callback per network address (fail open), firm creation per address and per normalised mailbox (fail closed), demo initialization and reset per firm. A refusal answers 429 with `Retry-After` and says only that there were too many requests. Thresholds are settings; 0 turns a scope off. Old windows are removed by housekeeping. | `rate_limit.py`, migration 0134, `settings.py`, `auth.py`, `demo.py`, `main.py` |
| Trial identity abuse | The provider-verified email is normalised (lower case, no `+tag`, no dots for Google mailboxes) and hashed into `trial_identities`. A second firm under a mailbox that already had a trial is created with its subscription SUSPENDED (`status_reason = 'duplicate-identity'`) and audited `registration.held`; every accepted registration is audited `registration.accepted` with the issuer, the mailbox's domain and the address's hash. Throttled sign-ups create nothing. | `auth.py`, migration 0134 |
| Object storage integrity | Every store-then-insert path discards its object when the row is refused (`storage_sweep.discarding` / `discard`): evidence intake, portal uploads, evidence versions, exports, governing documents, request attachments, mailbox evidence. Housekeeping sweeps objects under `evidence/`, `documents/`, `exports/` that no record names and that are older than an hour. The development store's guard allows exactly that delete and nothing else. | `storage_sweep.py`, `storage.py`, migration 0135, `migrate.py` |
| Archived engagement immutability | A database trigger refuses any insert, update or delete of an archived engagement's records on 36 record tables, whoever writes. The audit trail, exports, console, tour progress and job claims keep moving. Deploy-time routines skip archived engagements. | migration 0136, `plan_impact.py`, `master_plans.py` |
| AI run lifecycle | The quiet window after a run's last settled call is a setting (`TRIAL_AI_QUIET_SECONDS`, 90). The reservation-per-call model, the one-run-at-a-time rule, the $5 budget, 20 runs and 10-minute maximum are unchanged and verified live. | `subscriptions.py`, `provenance.py`, `settings.py` |
| Web | The sign-in page shows the "throttled" notice; the demo and tour proxies forward the browser's address; the engagement picker follows a client-side change of engagement (found in the walkthrough, section 6). | `sign-in-model.ts`, `workspace/demo/route.ts`, `workspace/demo/tour/route.ts`, `choice-form.tsx` |

Edge rate limiting was evaluated and not added: the sign-in flow goes straight to the API and the web proxy has no shared store, so a server-side limiter keyed on `X-Forwarded-For` is the single point of enforcement. The production front proxy must set that header (checklist).

## 2. Abuse protection strategy and residual risks

Protection in place:

- Registration costs an attacker a verified mailbox per trial; aliases of one mailbox are held for support, not granted. Per-address and per-identity windows cap mass sign-ups from one network. No device fingerprinting, IP bans or identity verification were added.
- A trial's AI spend is bounded by the reservation ledger (budget, run count, one run at a time, run length), not by the agent's goodwill. Storage is bounded per firm. Demo resets are capped at three.
- Every refusal is a 402/409/429 with a code; none reveals whether an account or firm exists.

Residual risks (accepted for launch, documented):

- Many distinct mailboxes from many networks can still each get a trial and its $5 of model usage. Mitigation is the audit trail (`registration.accepted` carries domain and address hash) and the settings, which can be tightened without a release.
- A duplicate-identity hold is a support decision: there is no self-service appeal, by design.
- Throttle counters live in the database; a database outage fails sign-in open (people can still sign in) and sign-up closed (no new firms).
- The trial's quiet window means a settled run holds its slot for 90 seconds; a person who starts two uploads back to back sees the second wait. Intended.

## 3. Storage cleanup design and verification

Design: the database and the object store share no transaction, so the order is put-then-insert, with a discard of the object when the insert is refused, plus a periodic sweep for anything a crash left behind. The development store (`mock_objects`) rolls its put back with the request and lets the sweep delete only unreferenced keys (migration 0135 guard).

Verified by `tests/test_storage_cleanup.py` (4 tests): a row the database refuses leaves no object; a store that fails stores and records nothing; the same file arriving twice keeps one object; the sweep removes old orphans, leaves young ones and anything a record names, ignores keys outside the application's prefixes, and tolerates a store that cannot list; the development store refuses to delete or change a named object. Scenarios covered by construction rather than a separate test: network interruption and process crash (the sweep), retries (the dedup on `content_sha256`), trial storage rejection (the AW402 trigger is one more refused insert and takes the same discard path).

Not verified live: no S3 bucket is configured in the review environment, so `S3ObjectStore.list_keys` (paginated `list_objects_v2`) and the sweep against a real bucket ran only against the mock and the in-memory store (High priority, section 10).

## 4. Archived engagement immutability results

`tests/test_archived_guard.py` (3 tests): an archived engagement refuses inserts, updates and deletes on evidence files, controls, deficiencies, test sheets and settings from a direct database connection (`check_violation`, "the engagement is archived and read-only") while reads, the HTTP 409 and the audit trail still work; an ACTIVE and a COMPLETED engagement keep their lifecycle and stay writable; a demo reset still archives the old demo and builds the new one, and the tour still records. In the walkthrough the archived first demo's uploaded file refused an update from a direct connection.

Scope is deliberately narrow: the guard covers the engagement's record tables, not tasks, job tables, audit events or exports, so background work and the audit trail are never blocked.

## 5. AI concurrency and budget verification

Live, on the review stack with the real model provider: one upload to the demo's NS-AC-02 request ran the Evidence Agent once (`claude-haiku-5-5`, fast tier, 2,781 input and 2,212 output tokens, 11.85 s), the reservation was settled at 1,385 micro-dollars and released, the analysis row says `source = MODEL`, the usage endpoint reported 1 of 20 runs and 1,385 of 5,000,000 micro-dollars, `ai_active_runs` was 1 inside the 90-second quiet window and 0 after it. The 60 seeded analyses in the demo stayed `SEEDED`. Tests: `test_trial_hardening.py` (abandoned run released at its estimate; the quiet window is the deployment's; a second run waits inside it), `test_subscriptions.py` (budget, run count, concurrency).

Run lifecycle decision: no job start/end hooks exist today (callers are built in a dozen modules), so an explicit run lifecycle with a renewable lease is proposed as its own milestone (section 10) rather than retrofitted here. Residual exposure: a worker that dies mid-run holds its slot until the run could last no longer (600 s), then is settled at its estimate.

## 6. End-to-end acceptance results

Fresh synthetic trial firm registered through the real sign-in page on the review stack (API 8020 with a scripted Google identity, web 3020 built with `next build`), review database `ai_workforce_eg_ui`, migrations 0134–0136 applied.

| Step | Result |
| --- | --- |
| Registration via "Continue with Google" | PASS. Firm "Brightline-audit", TRIAL, 7 days; `registration.accepted` audited; identity hash stored; throttle counters recorded (login, callback, signup, signup_identity). |
| Demo invitation "Experience Audit Workforce in action" | PASS on the first-run Home and from the account menu ("Explore the demo"). |
| Demo initialization | PASS. 14.7 s from click to the demo overview; audit `demo.scenario_clock`, `demo.dataset_built`, `demo.initialized`. |
| Overview and welcome | PASS. Demo strip, timestamp explanation, welcome dialog with the eight stages (desktop and phone). |
| Guided tour, 8 stages | PASS. Each stage lands on its page and record (overview; NS-AC-02 plan; understanding; the request PBC-90E2FEE8; test results with failed sample NS-EMP-0417; review; deficiency D-002 on Reports; Reports status). "Finish tour" closes the panel; `demo.tour_started` and `demo.tour_completed` audited; "Take the tour again" chip afterwards. |
| Live Evidence Agent upload | PASS (section 5). The file shows as "covers it in part", "The reader proposed: Looks sufficient", with MODEL provenance. |
| Trial usage page | PASS. 1 of 20 runs, 1 of 1 engagements (demo not counted), 1 of 1 users, storage 0 (demo files outside the allowance). |
| Independent allowances | PASS. The firm's own engagement was created beside the demo (201); a second was refused 402 `TRIAL_LIMIT engagements 1/1`; the demo never counted. |
| Demo reset | PASS. Card on Settings › Engagement setup, confirmation dialog, "Preparing the new demo…" pending state, 15.1 s to the new demo with the welcome shown again; the old demo ARCHIVED and read-only; trial dates and usage unchanged; after three resets the card says the resets are used and the API refuses 409 `resets-exhausted`. |
| Trial expiration (review DB, date set one minute past and restored) | PASS. `TRIAL_EXPIRED`, `writable: false`; project creation, demo initialization, tour progress and uploads all 402 `SUBSCRIPTION_INACTIVE`; the ended-trial strip shows on Home, the demo and the usage page; the demo stays readable. |

Defect found and fixed during the walkthrough: after a reset the breadcrumb engagement picker kept showing the firm's own engagement although the demo was open (uncontrolled `<select>` with a stale `defaultValue`). Fixed by remounting the select when its value changes (`choice-form.tsx`); verified by switching engagements client-side in both directions.

Observations not fixed (classified in section 10): the demo Home shows "18 requests are addressed outside the allowed recipient domains" unless `northstar.example` is an allowed recipient domain; AI spend under one cent shows as "$0.00 of $5.00"; a person who accepted the invitation while no dataset was configured is not re-invited on Home once it is (the account menu still offers the demo).

## 7. Screenshots

`docs/review/step7/` (synthetic review data only): 01 sign-in; 02 first-run Home (desktop, phone); 03 the invitation mid-start; 04 demo overview (desktop, phone); 05 welcome dialog (desktop, phone); 11–18 the eight tour stages (18 also on phone); 19 after "Finish tour"; 20 the live Evidence Agent reading; 21 trial usage (desktop, phone); 22–24 reset card, confirmation (desktop, phone), the new demo; 25 resets exhausted; 26–28 the ended trial on Home (desktop, phone), the demo and the usage page.

## 8. Performance measurements

Review stack on one laptop, review database, taken while test suites were idle unless noted.

| Measurement | Result |
| --- | --- |
| Demo initialization (server, build inside one transaction) | 13.6 s (reset, same build); 14.7 s click-to-overview in the browser (critical tier running concurrently) |
| Demo reset (API `POST /demo/reset`) | 13.6 s |
| Overview page, server-rendered with session (`next start`) | 1.09–1.20 s total, 5 ms TTFB |
| Trial usage page / Reports status page | 0.38–0.40 s / 0.34–0.37 s |
| `GET /demo` / `GET /demo/tour` / `GET /subscription` (usage) | 37–70 ms / 34–58 ms / 29–71 ms |
| Tour overhead | one `GET /demo/tour` per page (≈50 ms); each "Next" landed within the 3.5 s step budget |
| Evidence processing (upload to analysis READY, live model) | 12.0 s (model call 11.85 s) |

The 13–15 s demo build is the only figure above a few seconds; the dialog shows a pending state throughout, and the web route allows 60 s. A prebuilt template or background build is a Post-launch improvement.

## 9. Tests executed

Commands actually run (pytest invoked as `python -m pytest` with the Makefile's arguments, because `pytest.exe` is blocked on this machine):

| Run | Result |
| --- | --- |
| `tests/test_storage_cleanup.py tests/test_archived_guard.py` | 7 passed |
| `tests/test_registration_hardening.py tests/test_trial_hardening.py` | 11 passed |
| `tests/test_google.py` (after the expectation update, section 9b) | 12 passed |
| `make test-critical` equivalent (CRITICAL_PY incl. the five Step 7 files, + `no-autofill.test.ts`) | 565 passed, 1 failed (the `test_google` expectation, then updated and re-run green) in 568 s |
| `make test-fast` equivalent (FAST_PY + FAST_NODE) | 202 passed in 324 s; web fast set passed |
| `make test-demo` equivalent (DEMO_PY + DEMO_NODE) | 95 passed, 1 failed in 566 s: the tour test's stale-progress fixture inserted a project born ARCHIVED, which migration 0136 now refuses (section 9b); rewritten and re-run: `test_demo_tour.py` + `test_demo_reset.py` 16 passed in 188 s. Web demo set 39 passed |
| Full suite (`make test-full` equivalent, 1,217 tests) | 1,201 passed, 13 skipped (live-model tests, by design), 3 failed in 20 min 25 s. The three: the tour fixture above (rewritten, green); `test_engagement_close` deleting an archived never-launched draft, refused by migration 0136 because the purge of its setup rows ran against an ARCHIVED project — the guard now exempts a project marked deleted (the row is marked first, then purged), re-applied on the dev and review databases, and the test plus `test_archived_guard.py` re-run green (4 passed), with `test_engagement_close.py` added to `CRITICAL_PY`; `test_request_quality` expecting the design draft to fail the attribute-mapping check, an expectation superseded on 28 October (section 9b), rewritten and re-run green (15 passed) |
| `ruff check` / `ruff format --check` (services/api) | clean |
| `mypy` (project configuration, 327 files) | 3 pre-existing errors in unmodified tests (`test_testing_engine.py:726`, `test_evidence_plans.py:502`, `test_evidence_workspace.py:510`); everything in the milestone's files is clean |
| `tsc -p apps/web/tsconfig.json` | clean |
| `tsc` (root, includes `tests/`) | 11 pre-existing errors in six committed web test files (assistant, console, control-context, controls-overview, engagement-profile, evidence-workspace models); the milestone's own test files are clean |
| `biome check` | 2 format complaints, both line endings on generated files (`biome.json`, `next-env.d.ts`), an environment issue recorded earlier |
| `node --test tests/*.test.ts` (every web test) | 1,178 passed |

Last successful full-suite execution before this milestone: 23 October 2026 (920 passed, 13 skipped, 14 min 40 s) on the tree before Steps 2–7; it no longer applies, hence the run above.

### 9a. Tests intentionally not executed

- Live S3 storage tests: no bucket in the review environment.
- Entra sign-in: the provider is not configured for the review stack; Google is the trial's provider and the scripted identity drove it.
- Load testing of the throttles beyond the five-concurrent registration test.

### 9b. Legacy tests updated or retired

- `test_google.py::test_google_sign_up_creates_the_user_and_their_own_workspace`: expected audit actions `[membership.grant, organization.create]`; now also `registration.accepted`, because registration is audited since Step 7. Methodology: registration audit is an approved hardening requirement; no assertion was weakened.
- `tests/shell-model.test.ts`, `tests/planning-model.test.ts`, `tests/launch-checklist-model.test.ts`: fixtures completed for fields the models gained in earlier milestones (`subscription`, `units`, the policy file fields) and a regex that type-checked as a bad escape; behaviour unchanged, the tests pass.
- `test_demo_tour.py::test_an_unknown_stage_or_status_is_refused_and_stale_progress_is_set_aside`: the fixture inserted an "earlier demo" directly with `status = 'ARCHIVED'`; the project-creation trigger then writes `engagement_settings`, which migration 0136 refuses for an archived engagement, and every other shortcut (deleted then restored, archived then reopened) is refused by the existing lifecycle guards. The stale-progress half now arises the way it does in life: a firm of its own starts the tour, resets the demo, and the progress on the archived demo reads as stale against the new one. Same assertions (stale, stage, status, the new project id, rebinding on restart, `demo.tour_started`), stronger fixture; nothing weakened.
- `test_request_quality.py::test_a_request_is_checked_against_the_test_plan_before_approval`: expected the design draft, with an item's attribute links removed, to fail the "mapped to the test plan" check. Since 28 October 2026 (product owner: design evidence is not held to the attributes; the design is assessed from it) the check exempts the DESIGN phase, so the committed test was already failing at HEAD. Now it expects the design draft to stay mapped. The unmapped case for a testing-phase request is not exercised by this test any more, because no testing request carries a sample item at drafting time under the lean evidence requests (samples follow the population); listed as a coverage item in section 10.
- Type annotations added in `test_demo_reset.py`, `test_demo_tour.py`, `test_projects.py`, explicit exports in `test_subscriptions.py`, a direct import in `test_support_notifications.py`. No test retired.

### 9c. Risk-based justification

Tier 2 closure: the targeted new suites, the whole critical tier (authorization, approvals, evidence traceability, independence, database integrity, model safeguards, plus the five Step 7 files added to `CRITICAL_PY`), the fast tier, the demo release gate, migration validation (0134–0136 in `test_migrations.py`, applied to the dev and review databases), the web test sets and the lint and type checks, and the full suite because the milestone group ends here and shared infrastructure (auth, storage, database triggers) changed.

## 10. Remaining blockers and limitations

Release blockers: none open.

High priority (before or at launch):

1. Run the storage tests against the production bucket once (`S3ObjectStore.list_keys` and the sweep have only run against the mock store).
2. Allow `northstar.example` as a recipient domain in production (or exempt demo requests from the live-send check) so the demo Home does not open on a held-requests warning.
3. Root `tsc` type drift in six committed web test files and the three pre-existing mypy errors in unmodified API tests: make `make typecheck` green before the release branch is cut.
4. Decide the duplicate-identity support procedure (who lifts a SUSPENDED `duplicate-identity` firm and how it is recorded).
5. Test coverage: the attribute-mapping refusal for a testing-phase request (an unmapped sample item) has no end-to-end test since the 28 October design exemption; add one once a request carries sample items at drafting time.

Post-launch:

1. Explicit AI run lifecycle: a run record with a renewable worker lease and heartbeat, so a dead worker frees its slot in seconds rather than at the run's maximum length.
2. Prebuilt or background demo build to bring the 13–15 s initialization and reset under a few seconds.
3. Show AI spend under one cent as "< $0.01".
4. Re-invite on Home a person who accepted the invitation while no dataset was configured.
5. Usage counts archived non-demo engagements as occupancy (unchanged from Step 6).
6. The archived-engagement guard does not cover tasks, job tables or exports, by design; revisit if audit scope widens.

## 11. Production deployment checklist

- `DEMO_DATASET=northstar/1` (empty shows "Demo coming soon").
- `EMAIL_ALLOWED_RECIPIENT_DOMAINS` includes `northstar.example`, or demo requests are exempted (High priority 2).
- `RATE_LIMIT_*` left at the defaults (login 30/600 s per address; sign-up 5/h per address, 2/h per identity; demo 10/h per firm) and `TRIAL_AI_QUIET_SECONDS=90`; the front proxy sets `X-Forwarded-For` from the client address and strips a client-supplied one.
- `SESSION_COOKIE_SECURE=true`, `APP_BASE_URL`/`PUBLIC_BASE_URL`/`GOOGLE_REDIRECT_URL` on the public hostnames; the Google client allows that redirect.
- `MODEL_PROVIDER`, `MODEL_API_KEY`, `MODEL_NAME` set; trial defaults ($5, 20 runs, 1 concurrent, 600 s) confirmed in `organization_subscriptions` defaults.
- Object storage configured (S3) and the one-off storage verification run (High priority 1); housekeeping (`python -m ai_workforce_api.migrate`) scheduled so the orphan sweep, throttle-window cleanup and abandoned-run release run at least hourly.
- Migrations 0127–0136 applied by the migration runner; the ledger checksum verified.
- `SUPPORT_NOTIFY_EMAIL` set so `registration.held` and demo requests reach support; `EMAIL_LIVE_SEND_ENABLED` only if the recipient allow-list is in place.
- Preview login disabled (`PREVIEW_LOGIN_ENABLED=false`); the review scripted identity (`scratchpad/review_api.py`) is never deployed.
- Synthetic review firms and the test oracle (`services/api/tests/northstar_manifest.py`) are test-only; confirm the runtime package has no reference (checked: none).
- Smoke test after deploy: register a trial, start the demo, run the eight stages, one live upload, read the usage page.

## 12. Files changed in Step 7

New: `migrations/0134_rate_limits.sql`, `migrations/0135_storage_cleanup.sql`, `migrations/0136_archived_engagements.sql`, `services/api/ai_workforce_api/rate_limit.py`, `services/api/ai_workforce_api/storage_sweep.py`, `services/api/tests/test_registration_hardening.py`, `services/api/tests/test_storage_cleanup.py`, `services/api/tests/test_archived_guard.py`, `docs/review/step7/` (screenshots and this report).

Changed (API): `auth.py`, `demo.py`, `settings.py`, `storage.py`, `migrate.py`, `evidence_intake.py`, `evidence_portal.py`, `evidence_versions.py`, `exports.py`, `governing_documents.py`, `request_details.py`, `evidence.py`, `plan_impact.py`, `master_plans.py`, `subscriptions.py`, `provenance.py`; tests `test_trial_hardening.py` (one new test), `test_migrations.py`, `test_google.py`, `test_subscriptions.py`, `test_demo_reset.py`, `test_demo_tour.py` (stale-progress fixture), `test_projects.py`, `test_support_notifications.py`.

Changed (web): `apps/web/app/workspace/demo/route.ts`, `apps/web/app/workspace/demo/tour/route.ts`, `apps/web/src/sign-in-model.ts`, `apps/web/src/choice-form.tsx`; tests `tests/shell-model.test.ts`, `tests/planning-model.test.ts`, `tests/launch-checklist-model.test.ts`.

Changed (docs and build): `docs/phase-plan.md`, `docs/operations.md`, `docs/authorization.md`, `docs/test-strategy.md`, `Makefile` (five Step 7 suites and `test_engagement_close.py` in `CRITICAL_PY`). Also `services/api/tests/test_request_quality.py` (section 9b).

## 13. Security review (targeted)

Probes against the review API with the walkthrough session and without one:

| Check | Result |
| --- | --- |
| Cross-tenant reads (another firm's demo, project, subscription, tour) | 404 "not found" |
| BOLA: another firm's project id under the caller's firm | 404 |
| Demo flag forgery (`demo: true` in a project PATCH) | ignored by the schema; the flag stays false (and the database refuses it outside demo initialization) |
| Subscription manipulation (PATCH/POST on `/subscription`) | 405; limits are server-side only |
| Reset abuse (stale `expected_resets`, beyond the limit) | 409 `DEMO_RESET_REFUSED` |
| Tour stage forgery | 422 (literal stage names) |
| Unauthenticated and forged session cookie | 401 on every trial route |
| Mass sign-up / sign-in abuse | 429 after the window (tests: per address, per identity, five concurrent registrations) |
| Excessive AI usage | budget, run count, one at a time and run length enforced in the ledger (tests + live) |
| Upload abuse | per-file dedup, storage allowance (402), discard on refusal, orphan sweep |
| Sensitive error disclosure | validation errors name the field, never the data; throttle and hold refusals never say whether an account exists; no stack traces |
| Secrets in the diff | none (scan of changed files); tokens are never logged |
| Entitlement bypass via the expired trial | all writes 402 `SUBSCRIPTION_INACTIVE`, reads allowed |

Reviewer independence, historical audit records, the synthetic review firms and the test oracle are untouched.
