# Engagement workspace

Once an engagement starts, its work is organized the way audit teams run it. Every page reads the engagement's own records, so they always agree with each other.

| Page | What it shows |
| --- | --- |
| Dashboard | Health at a glance: controls in scope and concluded, evidence received and overdue, open deficiencies by severity, the schedule against today, open work by agent, and what is waiting on a person |
| Controls | The auditor's worklist. Work queues at the top (needs your action, waiting on owners, overdue, with findings, concluded), a type filter and search, and every in-scope control grouped by process area or by application (a control on several applications is listed under each, and one with none under "No application") with its frequency and samples, owner, status, next step, and evidence and finding counts. Opening a control shows a side panel: the next step and who it waits on, the lifecycle, and tabs for the overview (activity, risk, test attributes, evidence needed), evidence requests, the test plan, findings, and work |
| Project plan | The work by phase, with each phase's dates, progress, and tasks in the order they depend on |
| Timeline | A Gantt chart of the phases and milestones against today, and the milestone list |
| Deficiencies | The deficiency register and its SOX workflow |

Setup moves under **Engagement settings**. The task board stays available from each task.

## The standard SOX calendar

At kickoff the planner lays out the calendar from the kickoff date and the period end (`services/api/ai_workforce_api/schedule.py`):

| Phase | Default dates |
| --- | --- |
| Planning and scoping | The first two weeks |
| Walkthroughs and design | Weeks 2 to 6 |
| Evidence collection | From kickoff to the end of interim testing |
| Interim testing | Around the interim date: the end of the month three months before period end (Sep 30 for a Dec 31 year end) |
| Remediation retesting | From late interim testing to just after period end |
| Roll-forward and year-end testing | The 40 days after period end |
| Deficiency evaluation and reporting | 30 to 60 days after period end |

Milestones: kickoff, scoping complete, first evidence requests due, walkthroughs complete, the interim testing date, interim testing complete, remediation cut-off, period end, roll-forward complete, deficiency evaluation complete, and sign-off.

If kickoff leaves less than six weeks before the interim date, interim testing runs from kickoff instead. If the period has already ended, the year-end phases follow testing. Every phase starts on or after kickoff.

Each kickoff task belongs to a phase: walkthroughs to walkthroughs, evidence requests to evidence collection, tests and reviews to interim testing, the report to reporting. A task's deadline is its phase's end; evidence requests keep the PBC due date. The engagement lead can change a phase's dates, and open tasks that were due at its end move with it. Milestones can be re-dated and marked done. Roll-forward and remediation tasks are added once interim results are known (Phase 8).

An engagement started before the workspace existed shows **Create plan**, which lays out the same calendar from its kickoff date.

## Deficiencies

A deficiency records:

- the **condition** (what was found), **criteria** (what should have happened), **cause**, and **effect**;
- whether it is a **design** or **operating** deficiency;
- the **likelihood** of a misstatement (remote, reasonably possible, probable) and its **magnitude** (inconsequential, more than inconsequential, material), from which a severity is suggested;
- the **severity**: control deficiency, significant deficiency, or material weakness;
- compensating controls, and the remediation owner, plan, and due date.

Remediation runs open, remediation in progress, ready for retest, then a retest that passes (remediated) or fails (back to remediation).

The engagement reviewer, a team member with the reviewer role, approves:

- any severity change to or from significant deficiency or material weakness, including a deficiency logged as one, which stays a control deficiency until approved;
- closing a deficiency.

Nobody approves their own request. Every change is in the audit trail. References are sequential per engagement (D-001, D-002, ...). Testing agents will log deficiencies from test exceptions in Phase 8.

## Next steps

Each control has one next step, worked out by the API from its requests, test plan, and tasks (`next_step` in `workspace.py`), so every page says the same thing. It also says who the step waits on: **you** (the audit team, for example to submit a drafted request, approve samples, or review), the **owner** (waiting for evidence, or chasing an overdue request), or an **agent** (testing). In order: out of scope; concluded; samples waiting for approval; then follow-ups, sample requests, and evidence requests, each as overdue, draft, awaiting approval, or sent; request evidence; confirm the population; test; independent review.
