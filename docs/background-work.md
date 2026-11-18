# Background work: current design, limits, and recommended production shape

**Status: Proposal. Not approved. Nothing in the application has been changed.**

**Superseded in detail by `docs/production-worker-design.md` (18 November 2026),** which was
checked against the `governance` branch and corrects this study: console turns, evidence
assessments and narrative runs also renew their leases; evidence assessments already carry an
owner token and `db.release_claim` fences many writes on the attempt count; console turns and
evidence assessments are also failed when their attempts run out; and a section redraft has no
claim at all. Line numbers here are from the `windows-dev` working tree.

Read-only study of branch `windows-dev` (working tree, 17 November 2026). Paths are under `services/api/ai_workforce_api/` unless they start with `docs/`.

## The answer

The in-process worker is good enough for development. It is not safe for production: work interrupted by a crash or deploy is picked up again only when the process next starts, some stalled jobs are never marked failed, failures are logged without detail, and one start-up step is unsafe as soon as two API processes share the database. The simplest safe production shape is the same worker code running as **one dedicated worker process** that polls the existing Postgres job tables, with the API no longer executing jobs (option B). Temporal stays the documented destination (`docs/decisions/0002-workflow-engine.md`) and is not migrated to now. Adopting B needs the owner's approval and an addendum to that decision record.

## How it works today

- Each job is a row with status, attempts and a lease. Routes hand ids to the worker after commit (`after_commit.py:42-61`).
- Without `WORKFLOW_ADDRESS`, `LocalDraftScheduler` runs jobs on a thread pool in the API process (`main.py:184-185`, `pbc_drafting.py:1193-1195`; 6 threads by default, 16 at most, `settings.py:206-211`). With it, Temporal runs the same job functions, also inside the API process (`main.py:357-389`).
- Outbound email is not a background job. It is sent in the request, one record per approval with an idempotency key (`outbound.py:1806-1837`, `2081-2082`). Live sending is off.

## 1. Development: adequate

State survives restarts, a job is retried three times then failed, and no extra service is needed. The annoyance: a job cut off by `--reload` stays "working" until its lease (5-20 minutes) expires *and* the API starts again, because start-up resumes only queued or lease-expired rows (`pbc_drafting.py:1104-1116`). Only plan runs are reclaimed at once (`evidence_plans.py:2953-2972`).

## 2. What prevents production reliability

| Area | Finding |
| --- | --- |
| Crash, restart, deploy | `resume()` runs only at start (`main.py:346-351`; `durable.py:264-282`). There is no periodic sweep, so the recovery described in `docs/operations.md:20-22` happens only on a restart. |
| Attempt exhaustion | A job that crashed on its last attempt is skipped by resume and stays "working" for good. Only plan runs are failed (`evidence_plans.py:2962-2967`). |
| More than one process | The claim is one conditional `UPDATE` (`pbc_drafting.py:796-803`): two processes cannot both win. But the start-up plan-run reclaim resets another live process's runs (`evidence_plans.py:2960-2961`), and leases carry no owner, so a retry reset can clear another worker's claim. |
| Lease versus run time | Only test runs and plan runs renew their lease (`testing_engine.py:1227`, `evidence_plans.py:3474`). A job that outlives its lease can be claimed twice once a sweep or second worker exists. |
| Back-pressure | The pool queue is unbounded and shared: an interactive console turn waits behind bulk drafting (`pbc_drafting.py:1640-1642`). |
| Retries | The three attempts run back to back with no delay (`pbc_drafting.py:1757-1766`): a short provider outage exhausts them. |
| Lost errors | Pool results are discarded (`pbc_drafting.py:1204`); retries log a fixed sentence with no job id or error. |
| Shutdown | `shutdown(wait=False, cancel_futures=True)` (`pbc_drafting.py:1754-1755`): no drain. |
| Timers | Only Temporal times reminders (`durable_workflow.py:104-128`). Without it there is no timer (`followups.py:180-186`); reminders fall due only when the reconcile route is called (`followups.py:696-707`). |
| Observability | No queue depth, oldest-job age or failure count was found. |

## 3. Job types

| Class | Job types |
| --- | --- |
| Business-critical (must not be lost or run twice) | Outbound send (in request, already guarded); reminder timing; test runs; independent review re-performance; evidence reading and attribute assessment; evidence plan runs; workpaper drafts |
| Best-effort (a person can run it again) | Request drafts; setup drafts; RCM system scans; system scoping reviews; prior-year, narrative and policy-evidence runs; section redrafts; console turns |

No background job sends email or signs a conclusion; the production risk is silently stalled or duplicated work.

## 4. Options

| Option | Fixes | Costs | Leaves open |
| --- | --- | --- | --- |
| **A.** In-process, plus periodic sweep, fail exhausted rows, log failures, graceful drain | Stalled and lost work on a single API process | Small; no new parts | Still one process doing web and jobs; unsafe with two API processes; every deploy interrupts jobs |
| **B.** A, run as one dedicated worker process polling the same tables; API executes nothing | Jobs survive API deploys and scaling; one place to watch and drain | A second process to run; pickup delay of one poll interval | Single worker until leases carry an owner; timers are polled, not exact |
| **C.** Temporal as wired | Durable timers, retries, history | A server to operate; parity and tests first | Follow-on work differs: after a plan run the local worker drafts released requests, Temporal does not (`pbc_drafting.py:1356-1398` vs `durable.py:1081-1097`), likewise after a narrative run (`pbc_drafting.py:1488-1513` vs `durable.py:1236-1240`); 15 of 17 workflows have no test |

## 5. Recommendation (for approval)

Adopt **B**, built as A first. Preconditions, each with a test, before first production use:

1. A periodic sweep over every job table, including expired leases.
2. Exhausted rows end failed with a visible note, for every job type.
3. Exactly one worker enforced (a database lock); the start-up reclaim made safe for it.
4. Every job's lease outlives its run (renewal or a shorter timeout).
5. Failures logged with job id and error type; queue depth and oldest age reported.
6. Bounded drain on stop; delay between retries.
7. Reminders advanced by the sweep (the database already decides what is due).
8. Follow-on work defined once and shared by both workers.
9. Tests: crash mid-job, two claimants for one row, exhaustion, drain.

Sketch: land A in development; add the worker entry point and switch API execution off; soak in staging; then production. Any lease-owner column goes in by migration.

**Not now:** migrating to Temporal; removing the Temporal adapter; running several workers; new brokers or frameworks; treating the current in-process worker as production-safe.

## 6. Not verified

Nothing was run; all findings are from reading code. Not established: behaviour under a real crash or two processes; whether other jobs outlive their lease in practice; whether any screen calls the reminder reconcile route (none found in `apps/web`); the count of scheduler probes and Protocols; Temporal behaviour beyond the two tested workflows; intended production hosting and process count.
