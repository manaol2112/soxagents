# Production worker: design proposal

**Status: Proposal. Not approved. Nothing has been implemented.**

18 November 2026, branch `governance`. Builds on `docs/background-work.md` (option B). Paths are repo-relative, with line numbers.

## Summary

Today the API runs all agent work on its own threads; a crash or deploy interrupts jobs, and only an API restart resumes them. The same job code moves into one dedicated worker process reading the existing Postgres job tables; the API only records work and wakes the worker. Every claimed job gets an owner token and a lease renewed while it runs, so two runs cannot both write a result. Failures retry after a delay and, when attempts run out, end failed with a note a person sees. A database lock guarantees one worker, and its heartbeat shows whether it is alive. Development is unchanged by default; rollback is one setting (`WORKER_MODE=embedded`). Temporal stays the documented destination and is not adopted now.

| # | Increment | Risk |
| --- | --- | --- |
| W0 | Owner decisions; addendum to `docs/decisions/0002-workflow-engine.md`; update `docs/operations.md` | Low |
| W1 | Harden the in-process worker: job registry, periodic sweep, exhausted jobs failed, delayed retries, logged failures, bounded intake, drain (migration: `retry_at`) | High |
| W2 | Owner tokens on every claim and write; lease renewal for every job; a claim for section redrafts; safe start-up reclaim (migration) | High |
| W3 | `WORKER_MODE`, `python -m ai_workforce_api.worker`, single-worker lock, heartbeat, wake-up, start-up checks (migration: heartbeat table) | High |
| W4 | Reminders timed by the worker | Medium |
| W5 | Process definitions, alerts, staging soak, runbook, production switch | High |

## 1. Goal and non-goals

Goal: no job lost, applied twice, or left "working" forever across crashes, deploys and restarts. Not in scope: Temporal migration or removing its adapter; a broker; a job framework; a second worker; changing what jobs do; moving the deploy-step maintenance (`services/api/ai_workforce_api/migrate.py:153-183`); email, which is sent in the request, not by a job (`services/api/ai_workforce_api/outbound.py:1806-1837`).

## 2. Process model

Today, without `WORKFLOW_ADDRESS`, `LocalDraftScheduler` runs inside the API (`services/api/ai_workforce_api/main.py:178-185`), starts and stops with it (`services/api/ai_workforce_api/main.py:319-333`), on one shared, unbounded pool (`services/api/ai_workforce_api/pbc_drafting.py:1198-1200`, `1207-1209`). Development enables it with `LOCAL_WORKER_ENABLED=true` (`.env.example:162`; default false, `services/api/ai_workforce_api/settings.py:206`).

`WORKER_MODE=off|embedded|dedicated`. Unset, it follows `LOCAL_WORKER_ENABLED` (true means `embedded`), so development is unchanged. In `dedicated` the API executes nothing.

**Discovery.** One job registry lists each type once (selector, runner, fail function), replacing the two hand-kept resume lists (`services/api/ai_workforce_api/pbc_drafting.py:1671-1752`, `services/api/ai_workforce_api/durable.py:264-282`). A sweep every 30 s runs the existing `open_*` selectors (e.g. `services/api/ai_workforce_api/pbc_drafting.py:1104-1116`), which today run only at start. The worker tracks jobs in flight, takes only what free threads can run, and gives console turns their own two-thread lane.

**Latency.** Handoff still happens after commit (`services/api/ai_workforce_api/after_commit.py:36-61`); in `dedicated` it sends a Postgres `NOTIFY` naming the job type, and the worker runs that selector at once.

| | NOTIFY + 30 s sweep (recommended) | Poll every 2 s |
| --- | --- | --- |
| Pickup | under 1 s | up to 2 s |
| Idle load | none | ~8 queries/s |
| Lost signal | next sweep | n/a |
| Needs | direct DB connection (no transaction pooler) | nothing |

## 3. Durable execution and leases

A claim is one conditional `UPDATE` counting the attempt (`services/api/ai_workforce_api/pbc_drafting.py:797-806`), so two claimants cannot both win. But resets and result writes check status, not owner (`services/api/ai_workforce_api/pbc_drafting.py:990-997`, `1390-1395`, `1634-1638`; `services/api/ai_workforce_api/testing_engine.py:1391-1400`). `release_claim` fences on the attempt count (`services/api/ai_workforce_api/db.py:123-140`), which a test run resets to 0 (`services/api/ai_workforce_api/testing_engine.py:1398`). Only evidence assessments carry an owner token (`services/api/ai_workforce_api/evidence_assurance.py:4972-4986`).

**Migration (additive, nullable):** `claim_token uuid`, `claimed_by uuid`, `retry_at timestamptz` on `pbc_drafts`, `rcm_imports` (systems and terms sets), `evidence_analyses`, `console_messages`, `test_sheets`, `workpapers`, `setup_drafts`, `control_reviews`, `system_reviews`, `evidence_plans` (`run_` prefix), `prior_year_runs`, `process_narrative_runs`, `policy_evidence_runs`; `evidence_assessments` gets `claimed_by`, `retry_at`. `workpaper_section_proposals` also needs `attempts`, `lease_until` and a `WORKING` status: a redraft has no claim at all (`services/api/ai_workforce_api/workpaper_redraft.py:528-538`). New table `worker_heartbeats`.

**Claim and write.** The claim sets token and instance; every later write adds `AND claim_token = %s`, so a lapsed run cannot overwrite its successor.

**Renewal for every job.** The worker renews each held claim every third of its lease, learning claims through `hold_claim` (`services/api/ai_workforce_api/db.py:83-120`, extended to record the token), stopping at a per-type ceiling so a hung job cannot hold a row. Today only test, plan, narrative, console and assessment runs renew (`services/api/ai_workforce_api/testing_engine.py:1228-1235`, `services/api/ai_workforce_api/evidence_plans.py:3398-3407`, `services/api/ai_workforce_api/process_narrative.py:503-513`, `services/api/ai_workforce_api/console.py:486-492`, `services/api/ai_workforce_api/evidence_assurance.py:5225-5237`).

**Start-up reclaim.** `reclaim_interrupted_plan_runs` resets every working plan run, live or not (`services/api/ai_workforce_api/evidence_plans.py:2879-2899`). It will release only rows whose lease expired or whose `claimed_by` instance has a stale heartbeat.

## 4. Concurrent workers

One worker first: it removes whole classes of race and still runs jobs in parallel. It holds `pg_try_advisory_lock` on a dedicated session connection for its lifetime (the precedent: `services/api/ai_workforce_api/migrate.py:50`); a second worker cannot take it and exits; losing the connection stops claiming and exits. Embedded mode takes the same lock, so with several API processes only one runs jobs.

A second worker later needs W2's tokens, `SKIP LOCKED` discovery, per-task advisory locks for singleton work (reminder timing; `queue_due_reads`, `land_open_batches`, `backfill`: `services/api/ai_workforce_api/pbc_drafting.py:1709-1719`), and a connection budget.

## 5. Idempotency

| Job | Run twice today | Needed |
| --- | --- | --- |
| Drafts, analyses, scans, setup, scoping, re-performance, workpapers, prior-year, narrative, policy, plan runs, console | Concurrent second run refused at claim; a lapsed run can still overwrite; each run costs a model call | Token |
| Test runs | Each item its own transaction (`docs/operations.md:20-22`); completion unfenced | Token |
| Evidence assessments | Token-fenced | Instance id |
| Section redrafts | Both call the model; first READY write wins (`services/api/ai_workforce_api/workpaper_redraft.py:629-638`) | Claim + token |
| Reminders | Database decides what is due, under `FOR UPDATE` (`services/api/ai_workforce_api/followups.py:3-5`, `218`) | None |
| Outbound email | One record per approval, provider idempotency key (`services/api/ai_workforce_api/outbound.py:1806-1837`, `2081-2082`) | Not a job |

`workflow_effects` serves only the Temporal path (`services/api/ai_workforce_api/durable.py:1404-1412`). Follow-on steps that will now run each sweep (`draft_design_after_analysis`, which checks for existing work, `services/api/ai_workforce_api/workpaper_service.py:105-118`; `follow_plan`; `backfill`) each need a run-twice test.

## 6. Retries and failure

Retries run back to back (`services/api/ai_workforce_api/pbc_drafting.py:1757-1766`), log one fixed sentence with no job id, and pool results are discarded (`services/api/ai_workforce_api/pbc_drafting.py:1207-1209`). Only plan runs, console turns and assessments fail exhausted rows (`services/api/ai_workforce_api/evidence_plans.py:2889-2892`, `services/api/ai_workforce_api/console.py:668-683`, `services/api/ai_workforce_api/evidence_assurance.py:6012-6020`).

- A failed attempt releases its claim with `retry_at` 30 s, then 2 min, later (with jitter).
- The sweep fails exhausted rows (lapsed working or pending) through each module's existing fail function, which writes the note people see (e.g. `services/api/ai_workforce_api/pbc_drafting.py:976`, `services/api/ai_workforce_api/testing_engine.py:1200-1225`).
- Poison jobs: attempts count at claim, so a job that kills the process fails after three tries.
- A wrapper with a done-callback logs every failure's type, id, attempt, error type and traceback, never prompt or evidence text.

## 7. Interrupted-job recovery

| Event | Recovery |
| --- | --- |
| Crash or forced kill | The next worker takes the lock and releases the dead instance's rows; the attempt counts |
| Deploy (SIGTERM) | Stop claiming; wait up to 120 s; release the rest, attempt refunded (owner decision); supervisor stop timeout 150 s |
| Hung job | Renewal stops at the ceiling; sweep reclaims; token rejects the late write |
| API crash | Nothing lost: committed before handoff |
| Database outage | Backoff; stale heartbeat alerts |

**Reminders.** Only Temporal times them (`services/api/ai_workforce_api/durable_workflow.py:104-128`); without it there is no timer (`services/api/ai_workforce_api/followups.py:180-186`) and reminders fall due only when the reconcile route is called (`services/api/ai_workforce_api/followups.py:696-707`). W4: every 5 minutes the worker calls `remindable_requests()` and `advance()` (`services/api/ai_workforce_api/followups.py:191`, `340`), safe because the database decides what is due.

## 8. Deployment

No Dockerfile or process file exists; `docker-compose.yml` runs only Postgres, Temporal and MinIO. Proposed: one image, two commands: the API (`uvicorn ai_workforce_api.main:app`, any replicas) and `python -m ai_workforce_api.worker` (one replica, restart on failure, SIGTERM, 150 s stop timeout, `--check` probe reading the heartbeat).

**Start-up refusals** (precedent `services/api/ai_workforce_api/settings.py:120-127`): `WORKER_MODE` contradicting `LOCAL_WORKER_ENABLED`; an explicit mode with `WORKFLOW_ADDRESS`; the worker outside `dedicated`; empty `DATABASE_URL`; schema older than the code; `APP_ENV=production` with `off`.

**Order:** drain worker, migrate, start API, start worker. Each environment has its own database, lock, model key and budget.

**Backups:** `make backup` is a local tool (`Makefile:215-222`, `docs/operations.md:202-249`). Production needs managed, scheduled backups with point-in-time recovery before first use.

## 9. Monitoring

- Structured JSON logs per job event (claimed, finished, failed, released) with type, id, attempt, instance, duration and outcome. No request id exists today; the API adds one and logs it with the job id at handoff.
- Every minute, per type: queue depth, oldest pending age, in flight, failures and retries per hour.
- `worker_heartbeats` updated every 15 s. `/ready` (`services/api/ai_workforce_api/main.py:298-313`) reports its age without changing its status code; the automation status (`services/api/ai_workforce_api/workspace.py:205-221`) says work runs only while it is fresh (wording change: design review).

| Alert | Warn | Page |
| --- | --- | --- |
| Heartbeat age | > 60 s | > 3 min |
| Oldest pending | bulk 10 min, console 1 min | |
| Failures | > 5/hour or > 20% | |
| Lapsed working rows | after two sweeps | |
| Worker restarts | | > 3 in 15 min |

## 10. Rollback

Migrations are forward-only (`docs/decisions/0008-sql-migrations.md`): rollback is old code on the new schema, ignoring the nullable columns. W1–W2: revert the code (the lock keeps old and new workers apart). W3: stop the worker, set `WORKER_MODE=embedded`. W4: `WORKER_REMINDERS=false`. Data damage: restore the managed backup.

## 11. Verification plan

Existing: `services/api/tests/test_scheduler_parity.py` (extend to the registry and handoff scheduler), `services/api/tests/test_reliability_audit.py` (claim give-back, renewal), `services/api/tests/test_failures.py`, `services/api/tests/test_durable.py` (Temporal, unchanged). New, (c) = `make test-critical`: forced kill mid-job gives one result (c); second worker refused, stale writer rejected (c); long job keeps its lease, reclaimed when renewal stops; exhaustion fails every registry type with a note (c); five handoffs plus a sweep give one run; drain finishes or releases; no claim before `retry_at`; failures log their job id; unsafe settings refused; a reminder advanced twice is created once; `/ready` reports the heartbeat.

## 12. Owner decisions

1. Hosting: containers or systemd; managed Postgres with point-in-time recovery; no transaction pooler for the worker.
2. Timed reminders in the first release (recommended: yes, within 5 minutes).
3. Wake-up: NOTIFY plus sweep (recommended) or polling only.
4. Refund the attempt of a drained job (recommended: yes).
5. `embedded` allowed in production as a temporary rollback (recommended: yes, guarded by the lock).
6. Approve the addendum to `docs/decisions/0002-workflow-engine.md`.
7. Alert recipients and channel.
