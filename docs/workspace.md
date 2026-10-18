# Engagement workspace

Once an engagement starts, its work is organized the way audit teams run it. Every page reads the engagement's own records, so they always agree with each other.

| Page | What it shows |
| --- | --- |
| Dashboard | Health at a glance: controls in scope and concluded, evidence received and overdue, open deficiencies by severity, the schedule against today, the [independent review](review.md#across-the-engagement-92) across the engagement, open work by agent, and what is waiting on a person |
| Controls | The auditor's worklist. Work queues at the top (needs your action, waiting on owners, overdue, in review, with findings, concluded), a type filter and search, then filters for application, area, status, and owner (each a menu of checkboxes with a search box when the list is long, so several values of one filter widen it while different filters narrow together) and key controls only, all in the address so a filtered view can be shared, with Clear filters to reset, and every in-scope control instance grouped by application (the default) or by area, with the area or application on each row's reference line; a control on several applications is one instance under each, and one with none is under "Process and entity-level controls". Only queues with something in them are shown (All and Needs your action always). Each row shows the control ID and title, under them where it sits (its application, or its area when grouped by application), its frequency and sample size, then the owner, the status with a findings count when it has any and a flag when its testing is blocked, the next step and who it waits on, and the evidence received. Opening an instance shows the control workspace (see [The control workspace](#the-control-workspace)). |
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

Each kickoff task belongs to a phase: walkthroughs to walkthroughs, evidence requests to evidence collection, tests and reviews to interim testing, the report to reporting. A task's deadline is its phase's end; evidence requests keep the PBC due date. The engagement lead can change a phase's dates, and open tasks that were due at its end move with it. Milestones can be re-dated and marked done. Roll-forward and remediation tasks are added once interim results are known: effective interim testing adds a roll-forward task, a logged deficiency adds a remediation task, and a deficiency ready for retest adds a retest task ([Roll-forward and remediation](testing.md#roll-forward-and-remediation-84)).

An engagement started before the workspace existed shows **Create plan**, which lays out the same calendar from its kickoff date.

## Deficiencies

A deficiency records:

- the **condition** (what was found), **criteria** (what should have happened), **cause**, and **effect**;
- whether it is a **design** or **operating** deficiency;
- the **likelihood** of a misstatement (remote, reasonably possible, probable) and its **magnitude** (inconsequential, more than inconsequential, material), from which a severity is suggested;
- the **severity**: control deficiency, significant deficiency, or material weakness;
- compensating controls, and the remediation owner, plan, and due date.

Remediation runs open, remediation in progress, ready for retest, then a retest that passes (remediated) or fails (back to remediation). A deficiency on a control asks its owner for the remediation when it is logged, needs the date the fix took effect to be ready for retest, and is decided by the retest's signed-off sheet.

The engagement reviewer, a team member with the reviewer role, approves:

- any severity change to or from significant deficiency or material weakness, including a deficiency logged as one, which stays a control deficiency until approved;
- closing a deficiency.

Nobody approves their own request. Every change is in the audit trail. References are sequential per engagement (D-001, D-002, ...). Testing agents will log deficiencies from test exceptions in Phase 8.

## Next steps

Each control has one next step, worked out by the API from its requests, test plan, and tasks (`next_step` in `workspace.py`), so every page says the same thing. It also says who the step waits on: **you** (the audit team, for example to submit a drafted request, approve samples, or review), the **owner** (waiting for evidence, or chasing an overdue request), or an **agent** (testing). In order: out of scope; concluded; samples waiting for approval; then follow-ups, sample requests, and evidence requests, each as overdue, draft, awaiting approval, or sent; request evidence; confirm the population; test; independent review.

## Before launch

**Unplanned controls.** When a running engagement has in-scope controls with no evidence plan (launched before evidence planning), the dashboard says how many, with **Plan the evidence for N controls**; their kickoff drafts then wait for a person to settle each against its plan. The inbox lists drafts ready to submit apart from requests drafted before evidence planning.

**Links to a record.** An attention item, the record's header, and the Evidence tab open the record they are about by its address: `tab=evidence&ev=requests&request={id}` opens that request's review panel, `ev=plan` the plan, `ev=requirements` the requirements. A refresh or a new tab lands on the same place. Older `#ev-…` links still open their view.

**Period alert.** When a running engagement's period disagrees with its name or scope and no one has confirmed it, the dashboard says so above the figures, with a link to the profile ([Profile and period](onboarding.md#profile-and-period)).

A draft engagement has not launched, so its engagement sections (agent console, dashboard, controls, project plan, timeline, evidence, deficiencies, approvals) are closed: the sidebar shows them dimmed, and opening one shows a page that points back to Engagement settings. They open together once the kickoff plan is approved. Engagement settings, the AI workforce, and the engagements list stay open throughout. This is a workspace check; the API keeps its own rules (for example, evidence cannot be added to an engagement that is not active).

## The Engagements page

Milestone 8.15, redesigned in 8.18. The page has two views, **Engagements** and **Clients** (`view=clients`, for people who can create engagements), each with its count. The subtitle says how many open engagements there are, for how many clients, and how many are archived; the status filter carries the count per status. **All** means every engagement that is not archived: archived ones show only under **Archived**, and an archived engagement opened by link opens with that filter on.

The firm's engagements show as **Tiles** or as a **List**, across the page's full width. Each person's choice is kept in their browser. A tile leads with its client, so engagements with the same name tell apart, then the engagement, its status, period end, and lead; the agents' work as done of the total with a progress bar; what needs someone (evidence requests overdue, by the metrics rulebook, and milestones missed), or otherwise the next milestone; its controls and open findings; and when anything last happened. The list shows the client, engagement, status, period end, agent work, overdue evidence, and open findings; where it is narrower agent work gives way, and narrower still each row stacks with its labels. Engagements sort by status, then client, then the latest period first, except that the ones a person opened most recently come first.

Beside the status filters, after a divider, **Starred** and **Recent** show the person's own engagements; choosing one replaces the status filter. The page opens on Recent once any engagement on it that is not archived has been opened in this browser, and on all engagements otherwise; a link to one engagement's status opens on all engagements. Opening any page of an engagement records the visit (`visit-recorder.tsx`); Recent lists the last 30 opened, newest first, each saying when it was opened. A star on each tile and row stars or unstars the engagement. Starred includes archived engagements; Recent leaves them out. Search still applies. By the product owner's choice, visits and stars are kept in the person's browser only (`recent-engagements.ts`, local storage). They do not follow the person to another browser or device, and clearing site data clears them.

Choosing a tile or a row opens the engagement: a draft in setup, anything launched at its overview. Each has a **⋯** menu with the other ways in: **Open the engagement** (or **Continue setup**), the **Agent console**, **Open work**, **New engagement for {client}**, and **Status and close-out**. Status and close-out opens over the page (`manage=engagement`): edit details, pause, resume, archive, complete, reopen, or delete a draft, as the engagement's status allows; Escape, the close button, or a click outside returns to the page. Nothing opens over the page unless it is chosen; an engagement named in the link (the sidebar keeps one) only keeps the context. There is no side panel: the scope and recent activity are on the engagement's own pages.

**Editing.** An engagement's details are edited with the form it was created with: **Edit details** on its Status card opens it filled in (`edit=engagement`), with the client, the name, the period end, the lead, and the optional fieldwork dates. Saving is one request (`PATCH …/projects/{id}/details`) that updates the engagement and its profile in one transaction, audited as `project.updated` with the names of the fields that changed. After launch the client and the period end are part of the launched plan: the form shows them locked, and the API refuses a change to either with 409 "client and period end are locked after launch". A completed or archived engagement is not edited. The slug stays as it was created; the scope is written in guided setup. The status changes only by its own actions on the Status card: pause, resume, archive, and, on the Completion card, complete, reopen, and delete.

## Clients and roll-forward

Milestone 8.18 (`clients.py`, migration 0070). The firm keeps a client list, and each engagement belongs to one client. Two clients can't share a name, ignoring case and spacing. The migration links existing engagements to clients by name in the same way, so "Acme" and " acme " become one client.

**A new engagement for an existing client.** The New engagement form starts with a client picker: choose a client, or pick **+ New client** and type a name. A typed name that matches an existing client says so and offers to use that client instead. Both the **Clients** view of the Engagements page and an engagement's **⋯** menu (**New engagement for {client}**) open the form with the client already chosen (`create=engagement&client={id}`). The client's details carry over from its latest engagement: email domains, evidence coordinator, and request cadence. Guided setup's profile step shows the client and links back to the form to change it, rather than asking again.

**Starting from an earlier engagement.** When the client has engagements, the form offers **Start from**:

- **A fresh setup** (the default);
- one of that client's engagements.

Starting from an engagement copies its setup into the new draft for review:

- its scope, as the words to start from (the planner then suggests changes for the new period);
- its systems and processes;
- its controls, with their owners and attributes;
- its RCM uploads;
- its team and their roles (active firm members only);
- its workpaper templates, and their confirmation: templates confirmed on the earlier engagement are confirmed on the new one, recorded as the person rolling forward, at that time.

The form proposes the period end as a year after the earlier engagement's, says so, and leaves a date the person typed alone. A period end that is not after the earlier engagement's is flagged, without blocking.

Testing, evidence, workpapers, deficiencies, and results are never copied. The API refuses a start from another client's engagement (422) and requires read access to the source. The roll-forward is audited as `project.rolled_forward`, with the source and what was copied.

**The Clients view.** A table of the firm's clients by name, with a search: each client's number of engagements, its latest engagement (a link to it), that engagement's status and period end, **New engagement**, and, for an owner or admin, **Rename**.

**Renaming.** An owner or admin renames a client from the Clients view (`PATCH /organizations/{org}/clients/{id}`, audited as `client.renamed`). A database trigger updates the client name on every one of its engagements, launched ones included. A rename that clashes with another client is refused (409 "client exists"). The client list (`GET /organizations/{org}/clients`) is for people who can create engagements, and shows only the engagements each person can see.

**After launch.** An engagement's client is still part of its launched plan and stays locked. Saving the form with the same client, written differently, is not a change.

## Completing and deleting an engagement

Milestone 8.14 (`engagement_close.py`, migration 0068). Both live on the engagement's card under **Engagements**, below its settings.

**Completing.** An active or paused engagement is completed once its work is done:

- every in-scope control, on each of its systems, has a signed-off test sheet and none open again;
- its independent review is signed off and not reopened;
- every deficiency is closed;
- every evidence request is received, closed, or cancelled (an unsent draft counts as open);
- no agent is still working on a task.

Until then the card lists what is left (the first 50, each linking to its control) and the count (`GET …/completion`). **Complete engagement** asks first and then, in one transaction, checks the same again, cancels the agents' open tasks ("Engagement completed"), and records who completed it and when (`POST …/complete`, audited as `project.completed` with the number of tasks cancelled). A completed engagement is read-only everywhere: every change is refused, its pages say so, and its records stay readable. It can be archived from its settings.

**Reopening.** An owner or admin reopens a completed engagement with a reason (`POST …/reopen`). The reason, who gave it, and when are kept in `engagement_reopenings`, which never changes, and shown on the card; the database refuses a reopening without one. Reopening makes it active again; the tasks cancelled at completion are not restored, and new work comes as scope changes do.

**Deleting a draft.** An owner or admin can delete an engagement that never launched (a draft, or one archived before launch) by typing its name (`POST …/delete`). It is refused while the planner or the system agent is still working on it, and for any engagement with work on record. Its setup is removed: systems, controls and everything recorded about them, the team, invitations, RCM uploads, workpaper templates, and its settings. The audit trail never changes and points at the engagement, so its row stays as a hidden placeholder with no scope and a freed name, which the database keeps from changing again; the records of the agents staffed on it and of the AI calls made for its setup (status, tokens, and cost, no content) stay with it. Audited as `project.deleted` with the number of systems and controls removed.

## Controls register

The **Controls** page lists the engagement's controls in scope, grouped by application (or by area).

**Each control's stage** is worked out by the API from its records (`workspace.progress_of`), one stage per control, so the stages always add up to the controls in scope:

| Stage | When |
| --- | --- |
| Not yet requested | No evidence request has gone out: none yet, drafted, or awaiting approval to send. |
| Awaiting evidence | A request is out with the client (or sample evidence is awaited), nothing in yet. |
| Evidence received | Evidence is partly in, or in with the population to confirm, the population to accept, samples to approve, or files to link to samples. |
| Ready for testing | Evidence is in and the tester has not started, or testing stopped with items untested and needs to be run again. |
| Agent testing | The tester agent is testing now (queued or working). |
| Results to confirm | The agent's results are waiting for a person to decide and sign off, a proposed deficiency to log, or workpapers to prepare. |
| Awaiting review | With the independent reviewer (including the reviewer agent re-performing). |
| Review notes | The reviewer's notes are waiting for an answer, or the testing is to be re-performed. |
| Concluded | The review is signed off: effective, or with exceptions. |

Exceptions (an exception in testing or an open deficiency) are shown beside the stage, never as a stage of their own, so nothing is counted twice.

**Whose step it is.** Every next step names who takes it (`workspace.step_of`): a preparer (task.update), an approver of outbound requests (project.update), the engagement's independent reviewer, the client, or an agent. A step is the viewer's (`yours`) only when they could take it now: a preparer's step needs task.update and, where the control's work is assigned to people, to be one of them; an approval needs project.update and is never the requester's own; the reviewer's decisions need the reviewer role and, with independence on, are never on work the viewer prepared; an overdue request is the team's to chase. **Needs my attention** counts exactly these. Submitting drafted requests is done together, so it is no one control's step: the action center says once how many drafted requests wait, with **Submit all**.

**Overdue** follows the metrics rulebook: a request is overdue once it is out with the client (sent, waiting, or partly received) and past its due date, or marked overdue or escalated.

**Overall state.** Beside the stage, every control is in one of four states that add up to the controls in scope (`overallState`): **completed** (its review signed off), **blocked** (readiness stops its testing, an agent's work stopped and needs a person, or its evidence is overdue), **not started** (no evidence asked for yet), or **in progress**. The stage stays the detail; the four states are the overview.

- **Header.** The title with the scope in one line (controls in scope, applications, areas, period end), one action, **Continue** to the next control that is the viewer's (where its step is done), and a menu with **Export workpapers** and **Edit RCM**.
- **Progress.** How many are completed, who needs the viewer, how many have exceptions, a bar of the four states, each state with its count (a click opens exactly those controls), and **By stage**, which opens the nine stages with their counts. Both add up to the controls in scope.
- **Needs attention.** What needs a person across the register, each once and only from the records and the viewer's permissions: drafted requests to submit (one item with **Submit all**, for someone who may submit requests), requests to approve (to the Approvals page), testing to confirm, reviews and notes, controls to move on to testing, what stops controls from being tested, agent work to start again, overdue evidence, and exceptions. Each opens the controls it concerns.
- **Agents.** From the agents' run records only (`agents` on each control row: files being read and those that could not be, the tester's run, a workpaper being drafted, the reviewer agent's re-performance, queued or running, and which stopped): how many controls an agent is testing, files being read, workpapers being drafted, reviews being re-performed (running), results that wait for a person (done), controls waiting for the owner's evidence (waiting), and agent work that stopped (stopped). No agent mark is shown on a row unless an agent is at work or stopped.
- **Toolbar.** Search, **Application**, the status presets (all controls, needs my attention, in progress, blocked, awaiting evidence, in review, completed; the action center's views are named when open), **Needs my attention** with its count, **Filters** (type, stage, area, owner, key controls only, the order, and the grouping), and the view switch. Under it, what is shown of what is in scope and why ("48 of 80 controls in scope · Type: IT controls"), and the filters in force as chips. Every choice is in the address.
- **Applications view** (the everyday view). Each application's header has its neutral system icon (from its recorded layer and hosting: a cloud for a SaaS application, a database, a server, layers for infrastructure, a wrench for a tool; never a letter and never a vendor logo drawn from memory), its name, how many controls, how many completed, how many need the viewer and are blocked, and a thin completed bar. Each row: the control ID and title, its state in a few words (a drafted request reads "Request drafted", once) with what blocks it, its owner, and its next step when it is the viewer's (marked **You**), or who it is with. The rest opens below the row: area, frequency, nature, samples, evidence by phase, the full next step, the agent at work, what stops testing, the owner's email, and findings.
- **Table view** (`layout=table`). The same rows and filters as one table: columns a person chooses (application, owner, status, evidence, agent, next step, type, frequency, evidence due; kept in their browser), headings that sort, and selection with batch actions: submit the selected controls' drafted requests for approval, and set their owner (for someone who may change the setup). A hundred rows at a time, with **Show more**. The chosen view is kept in the browser.

**Batch actions.** `POST …/pbc-request-batches/submit` submits drafted requests for approval together: each with its own version check, recipient check, and approval, so an approver still approves each message before anything is sent; one that cannot go is reported with why, and the rest go on. `POST …/onboarding/controls/owner-batch` sets the owner of chosen controls, every instance of each (as the control editor does), for someone with project.update; requests already sent keep their recipient. The page says what went and what did not.

## The Evidence page

The engagement's Evidence Management page (increment A of the evidence command center, migration 0076). Requests is the default view; Evidence Library holds the files; Client Portal holds the coordinator, client email domains, secure upload links, and replies.

- **Figures.** Total, needs assignment (unsent, no recipient), awaiting approval (ready for review, with a recipient), awaiting client (sent, awaiting evidence, clarification needed, partly received), evidence received (any evidence arrived), needs review (received and not every item judged), overdue, completed (every planned item judged sufficient or waived, or closed). Each filters the list; they overlap, as a request partly received is both with the client and received.
- **The list.** `GET …/evidence-requests` with `q`, `stage`, `phase`, `type`, `owner` (an address, or `UNASSIGNED`), `system`, `kpi`, `view`, `sort`, `dir`, `page`, `size` (25, 50, 100, 200). It answers the page, every matching request's id and version (for selecting all), the figures, the filter counts, the person's views, the in-scope controls, the request types, and what generating requests would do. `…/evidence-requests.csv` exports the filtered list; a cell never starts with a formula character. The page keeps the list's state in its address (`rq`, `rstage`, … `rview`, `request`, `rnew`).
- **Views.** Built in: all, mine (requests the person owns), needs my attention (what the person can move now), unassigned, awaiting approval, awaiting client, received and needs validation, overdue, completed. `POST …/evidence-views` saves the current filters under a name for that person; `…/remove` deletes it. Nobody else sees them.
- **Many at once.** `POST …/evidence-requests/bulk` with an action (`ASSIGN`, `DUE`, `PRIORITY`, `SUBMIT`, `APPROVE`, `RETURN`), up to 500 requests with their versions, and `preview` to check without changing anything. Each request runs through the single-request function (assignment, submission, the reviewer's approval of the agent's draft, or a decision on the pending approval), in its own transaction, and answers ok or why not. A request that changed since the list loaded is refused, so repeating a change does nothing twice. Approving and returning need project update rights; returning needs a reason and is refused to the submitter.
- **A control's planned evidence.** `POST …/controls/{id}/evidence-plan/request-planned` requests the planned items never requested (the evidence coordinator drafts the wording). Nothing new when everything planned is requested.

## The control workspace

Opening a control shows it as a workspace for supervising the agents' work. Everything on it is read from records: the control, its evidence plan, requests, test sheet, review, rounds, workpapers, files, and its audit trail (`control-workspace-model.ts`).

- **Header.** The control ID and application, the title, and one line of facts (type, key or non-key, nature, frequency, the testing method as the records set it, owner). Beside them, the control's stage (as in the register), an **AI** mark when the stage is an agent's work no person has confirmed, how many agents are working while any runs on it, and one action: the next step when it is the viewer's (as the API decides: role, the reviewer and independence rules, the requester-never-approves rule, assignment), **View the conclusion** once concluded, otherwise who the step waits on, with no button.
- **Lifecycle.** Design, Evidence, Interim, Roll-forward, Review, and Conclusion, each with one real state (not started, ready, in progress, waiting for evidence, awaiting a decision, blocked, done, not applicable) and what exactly, opening the tab where its work is. A phase the evidence plan says does not apply is marked so, never shown as done. Evidence is done only when everything requested for design and interim is in and no item waits for a sufficiency judgment or has a gap; a received file alone is not enough. Interim shows the agent testing only while its run is on; testing that stopped with items untested is blocked until a person runs it again. Conclusion is set only by a signed-off independent review. No percentage is shown.
- **Overview.** Three parts, most pressing first.
  - **Needs attention**: what blocks first, then the viewer's other steps, each with what to do and **Open** (and the agent's offer to do it, where it can), then what waits on someone else and who.
  - **Agents on this control**: one row per agent in the order of the audit (control analyst, request drafter, evidence reader, design drafter, tester, testing workpaper drafter, reviewer agent), with four things kept apart. **Now**: running, queued (handed to the background, not yet picked up), stopped (it gave up; a person starts it again), or idle, and only when a record says so. Otherwise what it waits for: a dependency (the first read file, the tester's first results, the prepared workpaper) or a gate a person holds (readiness, the samples' approval). **Produced**: its output from the records; a workpaper's says how many sections are drafted with evidence cited, drafted without a citation, written by a person, from the records, not drafted yet, and its open review notes. **Decision**: whether a person has decided on that output (who decides, or who decided). The reviewer agent's differences from the preparer's results are counted, and a preparer is told another person signs off the review. An agent of a phase the evidence plan says does not apply is left out.
  - **Testing approach**, one line that opens: the control's classification, its method (tested once for an automated or configured control, otherwise its sample), and the phases its evidence plan says apply, each with the plan's reason, and whether its process must be understood. When the classification says automated application control and the RCM records a manual nature (so a sample is planned), it says **Records disagree** and asks for the nature to be confirmed.
  - Then the five most recent events.
- **Tabs.** Overview; **Control & design** (what the control is, readiness in five checks, the attributes and design, process understanding where needed, supporting documents, the walkthrough and design workpaper); **Evidence** (one evidence workspace: four figures for requirements, requests, files, and blockers; the agents on the evidence with the decisions they wait for and the reader's proposals; then Requirements, Requests, Files, and Plan details, one at a time, each requirement listed once across phases with its files, the reader's view marked AI, and a person's decision); **Testing** (interim: population and sample, the agent's results and the sign-off, the interim workpaper; roll-forward and retests: rounds and the roll-forward workpaper); **Findings** (potential exceptions from testing, kept apart from findings until a person decides them, then the deficiencies logged, with **Log a deficiency**); **Review & conclusion** (the independent review, then the conclusion); **Activity** (the control's audit trail, newest first by day, filtered by agents, people, or the workspace and by kind). Links to the older tabs (interim, roll-forward, workpapers) open Testing.

**Activity** comes from `GET …/controls/{id}/activity` (`control_activity.py`): every audit event about the control or its records (requests, requirements, plans, samples, test sheets, rounds, workpapers, reviews, deficiencies, tasks, attributes, process understanding, questions, and linked evidence files), newest first, with a title in words, a detail, and who did it. An event is an agent's when an agent instance is its actor, its payload names the agent, or it is output only an agent produces (items tested, the reviewer's re-performance, proposed attributes, a drafted process or workpaper), noting the person who asked for it. Bookkeeping (task reads, model calls) is left out.
