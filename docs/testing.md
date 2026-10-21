# Testing

Phase 8 tests each in-scope control from its evidence. Agents do the first pass; people decide. Milestone 8.1 covers the test plan and sample selection. The testing engine (8.2), workpapers (8.3), and roll-forward (8.4) follow.

## Control context and readiness

A control's test attributes belong to the control. A process narrative is one supporting document among others, never a requirement: an ITGC is tested from its own criteria and evidence, and a business process control from an understanding of its process, which any authoritative source can establish. Process understanding and evidence are assessed separately, and a readiness gate decides when testing may start (`control_context.py`, `control_attributes.py`, `process_understanding.py`, `readiness.py`, `context_routes.py`; migration 0061).

### Classification

Each control is classified from its area and nature: IT general control, automated application control, IT-dependent manual control, business process control, entity-level control, key report. A control can carry several (an automated control in order to cash is both an automated application control and a business process control). The team can set the classification on the control record; clearing it goes back to what the area and nature imply. Only a business process control requires process understanding.

### Attributes

Every attribute has an identity, a status (proposed, approved, rejected, retired, superseded), a basis (documented or inferred), and its source: the control library, the client's RCM, the team, the agent, or a supporting document, with the quoted words where a source states it (`control_attributes`). The approved attributes are what the tester tests. The control's attribute list stays the one every module reads, and a trigger keeps the approved attributes in step with it, so setup, an RCM import, the library, and the control editor keep working; a wording that is replaced or removed is retired, never deleted.

On the Design tab the team adds, rewords, or retires attributes (a rewording retires the old wording and records the new one in its place; a control keeps at least one). **Propose with the agent** sends the control context package (the control's description, objective, risk, classification, systems, owner, frequency, nature, evidence requested, client fields, approved and proposed attributes, process understanding status, evidence status) and the control's sources (its RCM record and every linked document) to Claude, which proposes attributes to add, changes to an approved one (naming it), or one to retire. Each proposal is documented only when its quote is found in the named source; otherwise it is inferred, with a note. A proposal that repeats an approved, pending, rejected, or retired wording is dropped, so a document added later enriches the control without duplicating its attributes. Proposals never change the approved set; a person approves (optionally rewording) or rejects each, and the history keeps every decision.

### Supporting documents

Narratives, policies, procedures or SOPs, flowcharts, walkthrough notes, system documentation, and prior-year workpapers are stored once per engagement as text (an uploaded file is read and not kept) and linked to any number of controls; a control can have any number of them (`POST …/source-documents`, `POST …/source-documents/upload`, `…/links`, `…/unlink`). They are untrusted data. Adding one runs the deterministic checks at once and, from the record, a review of the control against all its sources: the agent's attribute proposals and, for a business process control, an updated process map (`POST …/controls/{id}/review`). Each link records when it was last reviewed.

### Process understanding

For a business process control the understanding is a structured map: steps from initiation to recording, who performs each, the system, the step where the control operates, and the exception path (`process_understandings`). Each step says how it is known: documented (a quote found in its source), inferred (common practice no source states), or written by the team (from a walkthrough or an inquiry). **Build the map from the sources** asks the agent; without a model, reviewed rules build one from the RCM record (documented) with the common practice for the area around it (inferred). The agent never overwrites a map the team has: its map is kept beside it until a person adopts it. A person confirms the understanding; confirming needs at least one step and the control point. Editing it without confirming makes it a draft again.

### Issues

What is missing, ambiguous, or contradictory is recorded as an issue with why it matters and what would resolve it, quoting the sources (`control_context_issues`). The agents raise them, and so do deterministic rules: a linked document that names one frequency for the control other than the RCM's is a conflict. A conflict the agent cannot point to in the sources is recorded as ambiguity. A person resolves or dismisses each issue with a note; the same issue is not raised again once settled.

### Readiness

Readiness is assessed per control in five separate checks, each listing what is in the way, why it matters, and what resolves it:

1. **Definition and criteria**: a description, a set frequency, at least one approved attribute, no proposed change waiting for a decision, no open question on the criteria.
2. **Process understanding**, only for a business process control: a confirmed map with the control point, no open question on the process. A document added since is a warning to review.
3. **Evidence**: for a sampled control, its population read; for a control tested once, at least one read file. Sufficiency is judged in testing, item by item.
4. **Scope and population**: the population's checks. An empty or unreadable population blocks; a count short for the frequency, duplicate keys, or rows outside the period are warnings to look at.
5. **Conflicts**: open conflicts between sources block.

The state follows: **Conflict to review**, **Needs information**, **Process understanding incomplete**, **Evidence pending**, **Ready to test**; once testing is signed off, **Ready for review** until the independent review signs off, then **Concluded**. In the three blocking states the samples cannot be approved (409 "control not ready") and the tester does not test: the control's files are still placed, its items wait, and the sheet says why; clearing the blocker asks the sheet to run again. The register flags the controls whose testing is blocked, and the record's Overview tab shows the checks.

### A pass rests on the evidence

A tester's pass stands only on a passage that checks out against the item's files. A pass without one becomes "unable to tell" for a person to decide, so no conclusion of effective rests on the tester's word alone. A person can still decide any result, with a reason, as before.

### Migration

Migration 0061 adds the tables and the trigger, backfills every control's current attributes as approved from its own source, and carries each 0060 narrative with text into a supporting document linked to its control and a process understanding with the same status (confirmed stays confirmed, with the control as its documented control point). The 0060 table is kept, not written. The carry-over statements can be run again without creating duplicates. The migration file says how to roll it back.

## Evidence planning by phase (8.7)

Every in-scope control is planned across three testing phases before evidence is requested: **design effectiveness**, **interim operating effectiveness**, and **roll-forward operating effectiveness** (`evidence_planning.py` plans, `evidence_plans.py` stores the plan and makes requests from it; migration 0062). Evidence requests are a product of the plan, not the plan itself.

### What the planner decides

The planner reads the control: its activity, risk, attributes, classification, nature, frequency, systems, linked documents, process understanding, the period, interim testing, and any changes recorded on the control. It first decides what kind of control it is:

| Kind | Example | What the phases ask for |
| --- | --- | --- |
| Configuration (system-enforced) | MFA, password settings, an automated three-way match | Design: the setting, what it must cover, the policy it meets, who can change it, and the setting seen operating. Interim and roll-forward: the setting at the window's end and its change history for the window. Never a transaction population or sample |
| Population | Access provisioning, change approval, periodic access reviews | Design: the procedure and a walkthrough of one instance (plus review criteria for an access review, the approval workflow and approvers for change management, and the report for an IT-dependent manual control). Interim and roll-forward: the population for the window, its completeness and accuracy support, and the sample evidence, which waits for the sample |
| Management review | Flux reviews, reconciliations | As a population control, with the review's precision (criteria, thresholds, investigation and resolution) for design and evidence of actual reviews for operation |
| Key report | IPE | The report's logic and parameters for design; the run, its reconciliation, and changes for each window |

A population says what it lists: control executions (each quarterly review), the transactions the control acts on (each change), or the items reviewed within one execution (the user listing a selected review covered). Sample sizes come from the firm's tables (`controls.sample_size` at interim, the update-sample table for the roll-forward); the audit team selects the sample, never the owner. A process narrative is requested only for a business process control whose process is not yet understood (no confirmed map and no narrative, flowchart, procedure, or walkthrough notes linked).

### Applicability

Each phase is **applicable**, **conditionally applicable** (with its condition), **not applicable** (with a specific reason), or **pending determination** (with the question to answer). What the records settle is decided in code and the agent cannot change it:

- no period end: interim and roll-forward are pending;
- interim testing not signed off: the roll-forward is conditional on its effective sign-off; signed off effective with a round: applicable for the round's window; signed off not effective: pending (reliance on interim is not appropriate as is); interim covered the whole period: not applicable;
- a control introduced after the interim date: interim is not applicable, and its testing falls in the roll-forward; a control replaced or discontinued: pending, with the question of how the rest of the period is covered.

Design applies to every in-scope control. Missing evidence is never a reason a phase does not apply: the API refuses that reason from a person, and the checks reject it from the agent. A person can decide any phase with a reason; that decision is kept when the plan is generated again.

### Who plans

Kickoff and a control joining scope plan with the rules (no model call inside the launch transaction). **Plan again** on the control record (`POST …/controls/{id}/evidence-plan/generate`) asks Claude when a model is configured. Its plan must match the schema and pass the checks: each phase once; only the control's own attributes; sample evidence depends on a population requirement and says how the sample is selected; no population or sample for an automated control; design of a configured control includes its configuration; a business control whose process is not understood asks for it; an IT-dependent control tracks its report's reliability; no links, credentials, owner-selected samples, or claims that evidence arrived or a test passed. A plan that breaks a rule is rejected and the rules plan is used, with the reason in the plan's note. Every run is kept unchanged in `evidence_plan_runs`, with what it changed.

### Requests by phase

Applicable phases get their own requests: kickoff now drafts a **design request** and an **interim request** per control, instead of one combined request. The roll-forward's requirements go out on the roll-forward round's request when interim testing is signed off effective, for the round's window. Sample evidence goes out on the sample request when the samples are approved. Each request lists its requirements with their periods; the evidence coordinator then words it (Claude when configured, otherwise the rules), and a draft that asks for a population in a design request, or leaves out a required planned item, is rejected. Requests are still sent only after the usual approval. Retest, remediation, and follow-up requests record their phase too (`pbc_requests.testing_phase`).

### Planning again

Requirements are identified by control, phase, and key, so planning again never duplicates them. A requirement a person wrote, edited, or waived is kept as it is. A change to a requirement whose request has gone for approval or been sent, or to an approved plan, is never applied: it waits on the requirement as a proposed change for a person to accept or dismiss, and the plan shows **Changes proposed** until the changes are decided and the plan is approved again. An accepted change to something already sent is requested again on a new request. A requirement whose request was cancelled is requested again; to stop asking, a person marks it not applicable with a reason. Recording a change to the control (`POST …/controls/{id}/control-changes`: configuration, process, people, system, introduced, replaced, discontinued) plans again: a change after the interim date adds evidence for it in the roll-forward and the design after the change, lists it as an exception, and asks for an auditor's review.

### Receipt is not sufficiency

A requirement is received when its request is marked received or a file is filed to it (or attached to a reply matched to it). Whether it is enough is a person's call: accept, under review, insufficient (with what is missing), or follow-up required (`POST …/evidence-requirements/{id}/sufficiency`), refused while nothing has arrived. **Approving samples requires the phase's population, and its required completeness support, to be accepted** (or marked not applicable with a reason); until then the approval is refused and the register's next step is "Accept the population on the evidence plan".

A phase's state is derived: not planned, not applicable, awaiting clarification, conditional, requests not generated, requests drafted but not sent (drafted or awaiting approval: nothing asked of the owner yet), evidence outstanding (asked of the owner and not all in, or found short), received but not validated, waiting on an earlier step, evidence accepted, or complete. A phase is complete only when its testing is (the design workpaper prepared, the interim sheet signed off, the roll-forward round signed off), never because requests were made or files arrived.

### Files that serve requirements

A file serves every requirement its request carries. A person can also link a file the control already holds to any other requirement of the control, in any phase, with why (`POST …/evidence-requirements/{id}/files`; migration 0073, `evidence_requirement_files`): the design walkthrough's file for an interim item, one policy for the interim and the roll-forward. The link keeps who made it, when, and why; unlinking (`…/files/{link}/remove`) needs a reason too, keeps the link marked removed, and puts a judgment that rested on that file alone back to not reviewed. Only one of the control's own files can be linked, never one already on the requirement's request, and a withdrawn file stops serving every requirement at once. A planned requirement that a linked file serves counts as received (a person can judge it), and is not requested from the owner while the file stands, unless a person finds it insufficient or asks for a follow-up.

### The reader's view of each requirement

When a request carries planned requirements, the evidence reader judges each file against the requirements themselves, and records its coverage under each requirement's id (the id comes from the request, never from the model's answer). Each requirement then lists its files (on its request, or linked) with what the reader found, the period the file shows, and what it says to follow up, and the reader's proposal: looks sufficient, needs a follow-up, looks insufficient, or no view yet, with the reason. Without a model, the keyword rules propose only on a full match of the requested fields; a kind that matches, or not, says nothing about the detail, so it is left to a person. A proposal never changes the requirement: only a person accepts it, finds it insufficient, or asks for a follow-up (`…/sufficiency`).

### Where it shows

The control workspace's **Evidence** tab is one workspace (see [workspace.md](workspace.md#the-control-workspace)). It leads with what the person does next on the evidence, one item per record (`evidence-flow.ts`): plan the evidence, settle a kickoff draft, revise a returned request, approve a request (only for someone who may: the right to approve, and not its submitter), send an approved one, submit an expired one again, review a drafted one, judge what the reader found. The first is a button that opens its record; the rest are listed. Then four figures (requirements accepted of those that apply, requests answered, files received and read, and what holds the evidence up); the agents on the evidence (the planner with **Approve plan** and **Plan again**, the request drafter, and the evidence reader, each with what it did and the decision it waits for), with the reader's proposals for items that arrived and no person has judged; then one view at a time: **Requirements** (every item once, by phase, filtered by phase and status, each with its files, the reader's view, and the decisions), **Requests** (every request across phases with its stage, what it carries, and the files that came back; each opens in a review panel: its title, reference, type, phase, priority, due date, and where it is on its lifecycle; the checks before approval; who it goes to, who is copied, when it is due, and its priority, set inline and saved as they change; the client checklist and submission instructions; reference materials, internal unless shared; the audit team's planning, collapsed and internal; and the actions that are the person's: confirm the type, edit the wording, submit for approval, ask the drafter to rewrite, approve (with an optional note) or return for changes, send. See [pbc.md](pbc.md#request-details)). The engagement's Evidence page is described in [workspace.md](workspace.md#the-evidence-page), **Files** (each file with what it serves), and **Plan details** (what the planner understood, missing information and exceptions, each phase's applicability, objectives, procedures, and the form to change it, the changes recorded on the control, and the planning history).

### Migration

Migration 0062 adds `pbc_requests.testing_phase` and backfills it from the records that made each request (a round's request and sample request, a remediation request; everything else on a control was interim evidence), and adds the plan tables. Controls launched before 0062 have no plan until a person plans them: one control from its record, or every unplanned control of the engagement at once from the dashboard (`POST …/evidence-plans/plan-missing`, the reviewed rules, one control per transaction, a planned control skipped). The dashboard counts them (`unplanned_controls`) and each control's next step is **Plan the evidence**.

A kickoff request already sent carries the design and interim items it asked for (noted on each item), with anything new requested separately. A kickoff request **still a draft is never replaced on its own**: planning leaves it and its plan items as they are, and a person settles it (`POST …/controls/{id}/evidence-plan/reconcile`): **replace** it with the plan's requests (it is cancelled with the person's reason and kept on record; the plan's design and interim requests are drafted) or **keep** it as the request for those items (they are linked to it; its wording is not changed). Until then the control's next step is **Settle the kickoff draft against the evidence plan**, the draft reads *Drafted before planning*, and the API refuses to submit it (`plan the evidence first`, `settle the kickoff draft against the plan first`). The decision is in the audit trail (`evidence_plan.reconciled`, with the reason and the items linked).

## Master test plans (0079)

A control's evidence plan is its master test plan, reviewed and approved by a person as one version (`master_plans.py`; migration 0079).

### Four sections

1. **Understanding of the control**: the control's own facts (description, risk, frequency, nature, area, application, classification) and the planner's understanding (summary, type, risks, dependencies, missing information, assumptions, exceptions).
2. **Test procedures**, per phase, each a row with a code (D1 design, I1 interim, R1 roll-forward), an optional method (inquiry, observation, inspection, reperformance, recalculation, comparison, walkthrough), and who wrote it. The planner's procedures are kept by a hash of their wording, so planning again does not duplicate them; a procedure a person wrote or edited is never changed by a run.
3. **Test attributes**: the control's approved attributes, each with a code (A1, kept through a rewording), the objective it addresses, the condition tested, pass and fail criteria, whether professional judgment is required, whether automated testing suits it, and its phases. Criteria the plan does not state come from the library definition and are marked as the library's.
4. **Required evidence**: the plan's requirements, each with a code (E1).

Links are by identity, many to many: a procedure to the attributes it tests, a requirement to the attributes it supports and the procedures it serves. A requirement is linked to the approved attributes it names by wording; wording that matches none stays unlinked. Findings say what does not link up or cannot be judged as written: a procedure that tests no attribute, an attribute with no procedure or no evidence, evidence that supports no attribute, a requirement naming an attribute the control does not have, an attribute with no criteria that is not marked as judgment, an inferred attribute no source states. Findings are shown to the reviewer and kept with each decision; they do not block approval.

### Approval

A person with project.update approves the current revision, with an optional comment, or requests changes with a comment of at least ten characters (`POST …/evidence-plan/approve`, `…/request-changes`). A contributor edits the plan and submits it for review (`…/submit`; after changes were requested, with a note on how they were addressed). Each decision is stored, unchangeable, with the plan as the reviewer saw it and its SHA-256 hash (`plan_versions`, `plan_decisions`). Approving the plan approves the control's attributes with it, so approval is refused while an attribute waits for a decision, an attribute or source question is open, the control has no description, frequency, or attribute, the planner is still drafting, or a proposed change or revision is undecided. Approving an approved plan records nothing new.

### Revisions

The plan's content has a revision, one more per transaction that changes it. Database triggers revise it when a procedure, a link, the control's approved attributes or their criteria, or the control's own facts change; the service revises it when a person decides a phase, edits, adds, waives, or restores evidence, or accepts a proposal. A revision sends an approved plan, or one returned for changes, back to proposed, and the database refuses an approved plan whose approved revision is not its current one. Periods that follow the engagement's dates, phase decisions the records settle, and bookkeeping (a requirement being requested, judged, or linked to a file) are not revisions.

A planner run on an approved plan never changes it: its understanding, objectives, and procedures wait as a proposed revision (`pending_revision`, accepted or dismissed with `POST …/evidence-plan/pending-revision`), new or returning evidence as proposed additions, and changed evidence as proposed changes, each decided on the requirement. Accepting revises the plan.

### What waits for an approved plan

Requests are drafted, approved, and sent only through the planning gate ([pbc.md](pbc.md#the-planning-gate)). Readiness has a sixth check, **Test plan approval**, and a blocking state, **Test plan awaiting approval** (after conflicts and missing information): samples are not approved and the tester does not test. A test sheet is not signed off on a plan that is not approved. Requests and test sheets record the approved revision they were made under (`plan_revision`).

### Planning states and the queue

Each control's planning state is derived: **Not started** (no plan), **Analyzing** (the planner agent is drafting), **Needs clarification** (information or a question is missing), **Draft ready**, **Pending review** (submitted, or a proposal waits for the reviewer), **Approved**, **Changes requested**. `GET …/planning-review` lists every in-scope control with its state, counts that add up to the controls in scope, and the next control waiting for a reviewer. `GET …/controls/{id}/master-plan` returns the four sections with their codes and links, the findings, what holds approval, the decisions, and whether the viewer may decide. Editing: `POST …/master-plan/procedures`, `…/procedures/{id}`, `…/procedures/{id}/remove`, `PUT …/procedures/{id}/attributes`, `PUT …/master-plan/evidence/{id}/links`, `POST …/master-plan/attributes/{id}/criteria`.

### Grounding (milestone B, migration 0080)

**The understanding, fact by fact.** Twelve facts make up the understanding of the control: objective, risk, description and operation, manual or automated, preventive or detective, frequency, performer, reviewer, system, population, assertions or IT risks, and dependencies (`master_plans.facts_of`). Each is built from the records every time the plan is read, says where it comes from (the client's RCM or the control record, the library's statement with the client's values, the library's definition, the planner), and quotes it. What no record states is **missing**, with the question that settles it; a library value the client has not given yet (a bracketed role) is missing too. Missing facts are clarifications on the plan (they do not hold approval), and the plan reads **Needs clarification**. The planner agent may propose a value for a missing fact; it stays a proposal and the question stays open. The facts are part of the stored version a reviewer approves. Changing or clearing a client value already recorded revises the plan (trigger on `control_parameters`); filling one the plan left in brackets does not, and an approved plan keeps its approval, with the value shown on the plan as filled since approval (migration 0086, decided by the product owner).

**Procedures and evidence, linked.** A library control on version 3 is planned with its definition's procedures, each operating and roll-forward procedure linked to the attributes it names (by their definition keys). Any other control is planned with the procedures for its kind, and only those that test each item against the attributes are linked; procedures that obtain, select, or support are not. Design procedures assess the design against the risk and are not linked to attributes. A requirement is linked to the procedures of its phase that test an attribute it supports, derived from the links. A person's links are never changed by a run. The finding **No … procedure tests an attribute** is raised for an applicable operating phase with no such procedure.

**Criteria.** For an attribute no library definition covers and no person has stated criteria for, the planner agent may propose its condition, pass and fail criteria, whether judgment is required, and whether it can be tested automatically; they show as the agent's (`criteria_origin`). Criteria a person states are never replaced by a run. A criterion worded so that a tester could not tell a pass from a fail (appropriate, adequate, timely, operating effectively) is left out and a person is asked.

**What the planner may not invent.** On top of the 8.7 checks, a plan from the model is rejected, and the rules' plan stands, when it cites a standard the records do not, offers a prior year's work as evidence that the control operates now, states an amount, a percentage, or a deadline in days, hours, or weeks that no record gives (the control's records, the library's definition, and the occurrences the engagement's dates give), quotes a source that does not say it, links a procedure the phase does not have, or names an attribute the control does not have. The reviewed rules' own plans pass the same checks.

**Planning again.** `POST …/evidence-plans/replan` plans every in-scope control again with the reviewed rules where no person has approved the plan (one control per transaction; approved plans and plans the agent is drafting are left), so plans carried over by migration 0079 gain their links and procedures.

### Reviewing a plan (milestone C)

The engagement's **Test plans** page lists every in-scope control with its planning state, what it has to resolve, what holds its approval, and its last decision; its figures filter the list. A reviewer opens a control's plan, reads its four sections as linked tabs (choosing a code opens and outlines the item it names and lists what it traces to), edits procedures, links, and criteria in place, and approves the revision or returns it with a comment. From the list, a reviewer can approve the plans they ticked: each is approved on its own, at the version the list showed (`POST …/planning-review/approve`); a plan changed since is refused. Web: `planning-model.ts`, `planning-view.tsx`, `load-planning.ts`, `app/workspace/planning/route.ts`.

The finding that evidence supports no attribute applies to evidence of an attribute (sample evidence, control execution, configuration); a population, documentation, report support, or change history supports the testing and is not flagged.

### Releasing phases (milestone E)

Every phase is planned and drafted in advance and released progressively (`phase_release.py`, migration 0081). Design follows the plan's approval; interim and the roll-forward wait for a person to release them for the control, and their prepared requests are held until then. Interim is recommended once the design workpaper is prepared, the roll-forward once interim testing is signed off (or once design is, where interim does not apply); an earlier release needs a recorded reason. `GET …/phase-progress` gives every control's phases; `POST …/controls/{id}/phases/{phase}/release` and `POST …/phases/release` (each control on its own) release them. Releasing never sends a request.

### Migration

Migration 0079 carries every plan's procedures into rows, gives every attribute and requirement its code, links requirements to the attributes they name, and withdraws every approval (decided by the product owner: every plan is reviewed again), keeping each in the audit trail (`evidence_plan.approval_withdrawn`).

## Test plans and samples (8.1)

### When a plan is proposed

When a stored file is read as a **population** for a control's request (see [evidence.md](evidence.md#reading-and-classification)), the control's tester proposes a test plan. A person can also ask for one from the file on the Evidence page (**Propose samples**), for example after confirming a file as a population.

An automated control is tested once from its configuration (the screenshot review in 7.4), so it is not sampled. Only `.xlsx` and `.csv` files are populations.

### Population checks

The tester reads the population again from storage, through the custody check, and records the file's SHA-256 with the plan (`sampling.py`). The checks are deterministic:

| Check | What it looks at |
| --- | --- |
| Completeness | The number of rows. A periodic control with fewer rows than it should show in a year (4 quarterly, 12 monthly, about 50 weekly, 1 annual) is an issue to raise with the owner |
| Unique items | The key column (a named ID, ticket, or reference with the most distinct values). Repeated or blank keys are an issue |
| Period | The date column (named like a date, with mostly readable dates). The audit period is the twelve months ending on the period end. Rows dated outside it, or without a readable date, are left out of the sampling frame |

The sampling frame is every row dated in the period, or every row when there is no date column.

### Selection

The sample size comes from the control's frequency and nature (for example 25 for an event-driven manual control, 2 for a quarterly one). Samples are drawn at random from the frame with a recorded seed. The same file, frame, size, and seed always give the same rows, so a reviewer can redraw them. When the frame is smaller than the sample size, every item is tested.

The plan explains the selection in plain words: how many items, from which file and sheet, with which seed, and why that size.

### A person's part

Until the samples are approved, a person with project update rights can:

- **Draw again**, which uses a new seed;
- **Replace a sample** with another row of the population, as a targeted or haphazard pick, with a reason. The reason and the person are kept on the sample;
- **Approve the samples.**

Approval drafts the sample evidence request to the control owner who sent the population: one line per item, with its key and a few columns, asking for the control's per-item evidence. The request is a normal draft and goes out only after the usual approval. An approved plan cannot be redrawn or changed.

Every proposal, replacement, and approval is in the audit trail, with the seed and the population hash.

## The testing engine (8.2)

Each in-scope control gets one **test sheet** (`test_sheets`, migration 0034). A sampled control's sheet opens when its samples are approved, with one item per sample. A control is tested once when it is automated, or when it has no sample plan and its evidence reads as a configuration (settings, or screenshots of them): its sheet opens with a single item when that evidence is read. If a population later brings a sample plan, approving its samples replaces the open test-of-one sheet. Samples approved before 8.2 got their sheet in the migration.

### Placing evidence

Whenever a file of the control is read, the control's tester places it (`testing_engine.py`):

- A file that names a sample's key (user ID, ticket, change number) in its name, folder, or text supports that sample. One file can support many samples, such as a ticket export. Keys under three characters are not matched, and a key must stand as a whole word.
- A file on the sample request that names no sample waits under **Files the tester could not place**, for a person to link to a sample or set aside.
- The population the samples came from, and files not on the sample request that name no sample, are set aside as not test evidence.
- A control over several applications is one instance **per application** (Milestone 8.5, see [onboarding.md](onboarding.md#controls-per-application-85)), each with its own sheet and one item, named after its application. A file filed to an instance is its evidence; a file that shows another of the control's applications is set aside there and tested on that instance instead; a file tagged as covering every application, such as a policy, is tested on each instance of the control (`control_instances.FAMILY_FILES`). A person who sets a file's application on the Evidence tab can name any application of the control's family, and the file moves to that instance's sheet. So one application can be effective while another has an exception, each with its own conclusion, workpaper, and deficiencies.

A person can link a file to a sample, take it off, set it aside, or bring it back. Each change has the affected items tested again.

### Testing

For every item with evidence, the tester proposes a result for each of the control's test attributes: **pass**, **exception**, **unable to tell**, or **not applicable**, with what it saw. Claude reads the control, the attributes, the sample's population row, and the parts of each file around the sample's key. Only the control's attributes can be answered; a missing answer is "unable to tell". A control tested once from screenshots reuses their first-pass review (7.4) when it covers every attribute. Without a model, every result waits for a person. Testing runs in the background (the local worker or the `control_testing` workflow) and again whenever evidence changes.

### A person's part

On the control's **Testing** tab, the sheet shows every item against every attribute. A person can open any result and set it with a reason; the tester's proposal and the person's result are both kept, with who set it. **Test again** reruns the tester.

The sheet is signed off once for the control. The conclusion is derived, never typed:

- **Incomplete** while an item has no evidence, is not yet tested, or has a result that is "unable to tell". Sign-off is refused, with what is left.
- **Not effective** when any final result is an exception (zero tolerance).
- **Effective** otherwise.

A signed-off sheet is final until a person reopens it with a reason. Its control's testing stage is done, and its next step is to prepare the workpapers for [independent review](review.md). A must-fix review note on a result reopens the sheet with the note as the reason.

### Exceptions become proposed deficiencies

Signing off with exceptions drafts a deficiency: condition (which items and attributes, with what the tester or person saw), criteria (the control and the failed attributes), cause (to be asked of the owner), effect (the control's risk), and a suggested severity. A key control with exceptions in a fifth or more of its items suggests a significant deficiency; anything else, a control deficiency. A person edits and **logs** it, through the deficiency register's own checks (a severe one still needs the reviewer, as in 7.2), or **dismisses** it with a reason. A logged deficiency keeps its source as testing. A sheet whose deficiency is logged cannot be reopened.

The agent console can read a control's sheet, test again (routine), and propose setting a result, linking evidence, signing off, and logging or dismissing the deficiency (each confirmed by a person).

Every placement, result, override, sign-off, reopening, and deficiency decision is in the audit trail.

## Workpapers (8.3)

Each control has one workpaper, shown as a workbook: a **design** tab (`<control>-TOD`), an **interim testing** tab (`<control>-TOE`), and a **roll-forward** tab (`<control>-RF`), from the control's template (see [onboarding.md](onboarding.md#workpaper-templates): one workbook per kind of control, or the firm's own). Underneath, the design tab is one record and the testing tabs share another, so design work and testing are prepared and reviewed separately as before. Both are structured records in the platform, and every change is a new, immutable version. The roll-forward tab is filled from the roll-forward round's own plan and sheet, and says so until that round starts.

### How a workpaper is filled

The tester's first results on a control's interim testing open its testing record and queue a draft, so the workpaper is built while testing is still open: the draft describes the open sheet's results as proposed, not final, its conclusion stays derived from the signed-off testing, and it cannot be prepared before the sign-off. Signing off the testing opens the record if it is not open yet and queues a redraft from the confirmed results. **Draft the workpaper** on the control's **Testing** tab (or the console's `draft_workpapers` tool, which is routine) opens both records and drafts them now. A section's key is its title as a slug, prefixed by its tab when the title repeats across tabs (`exceptions` on the interim tab, `rollforward-exceptions` on the roll-forward).

- **From the records:** the control's details, the population, the sample selection (size, method, seed), the testing matrix (every item against every attribute, with the final result and who set it), the exceptions, the information produced by the entity, and the sign-offs. These are filled in code, never by the model.
- **Drafted by the agent:** every narrative section except an effectiveness conclusion (the understanding of the control or configuration, the process narrative, the population, the changes since interim, the design conclusion) and the walkthrough of one instance. Claude writes them from the control, its testing, and its evidence, and cites the evidence the same way the console does. Each citation is checked against the file's stored text; a passage that is not in the file is dropped. In a table, a checked citation is written out as the file name, its place, and the quoted words.
- **The effectiveness conclusions are derived** from the signed-off sheets: the interim conclusion from interim testing, the conclusion for the period from the interim and roll-forward sheets together (effective, not effective, or testing not signed off yet). The agent cannot write them.

Drafting runs in the background (the local worker or the `workpaper_draft` workflow). Without a model, the record sections are filled and the narratives wait for a person.

**The agent drafts only from something it can read.** A draft with no read evidence file on the control and no signed-off testing fills the record sections and stops with the note "Waiting for evidence"; the model is not called and the Draft button is disabled with the same note. The first evidence file read for a control opens its design record and queues the agent's draft of the understanding and the walkthrough; later files do not redraft on their own, the preparer asks with **Draft again**. Signing off interim testing queues the testing record as before.

### A person's part

A person can edit any narrative or table section. The edit is saved against the version it was based on; an edit on an older version is refused. Sections a person wrote are kept when the agent drafts again. Earlier versions can be opened from **Version history**.

**Prepare** freezes a record at its current version, with who prepared it and when: the design tab on its own, the testing tabs together. The testing tabs can be prepared only once interim testing is signed off. A prepared record is changed only after a person reopens it with a reason. Preparing the testing tabs opens the control's [independent review](review.md); a must-fix review note on it reopens it.

### Export

**Download the workbook** on a control's Workpapers tab downloads every tab of its records as one `.xlsx` with a sheet per tab (`GET …/workpapers/export.xlsx?control_id=`); a record on its own downloads too. **Export workpapers** on the controls page downloads the engagement binder: an index sheet linking to one sheet per tab. Cell values that start with `=`, `+`, `-`, or `@` are written as text, so nothing in a workpaper runs as a formula.

Every draft, edit, preparation, and reopening is in the audit trail.

## Roll-forward and remediation (8.4)

Interim testing is a control's first round. Two more kinds of round follow once its results are known (`test_rounds.py`, table `test_rounds`, migration 0040). Each round has its own evidence request, task, test plan, and test sheet; interim testing's plan and sheet have no round. A file filed against a round's request, or its sample request, is tested on that round's sheet. Every other file of the control stays with interim testing. A file sent for a remediation request is kept as the owner's evidence of the fix and is not tested; the retest tests the population sent for it.

### Roll-forward

Signing off interim testing as **effective** starts a roll-forward when interim testing did not cover the whole period.

- **Window.** It starts the day after the last instance date in the interim population (`covered_to` on the plan), and runs to period end. For a control tested once it starts the day after sign-off. For a plan from before 8.4 it starts after the interim date.
- **Request and task.** It drafts a request to the control's owner, or to the PBC coordinator when there is no owner. The request asks the owner to confirm whether the control, who performs it, or its systems changed in the window, and for the population of that window; for a control tested once it asks for current evidence instead. It also adds a task in the roll-forward phase for the control's tester.
- **Testing.** When the population arrives, the tester proposes an update sample from the window only (annual, quarterly, and monthly 1, weekly 2, daily 5, more often or event-driven 10). A person approves it, and testing and sign-off work as at interim. Exceptions propose a deficiency as usual.

Reopening interim testing withdraws a roll-forward that has no sheet yet, with its draft request and task.

### Remediation and retest

**Remediation request.** Logging a deficiency on a control drafts a remediation request to the owner: the remediation plan, the owner, and the expected date, then evidence of the fix and the date it took effect. It also adds a task in the remediation phase for the evidence coordinator.

**Ready for retest.** Marking a deficiency on a control ready for retest requires the date the fix took effect, which cannot be in the future. This starts a retest round.

| Frequency | Retest sample | Operates at least |
| --- | --- | --- |
| Annual | 1 | — |
| Quarterly | 2 | 180 days (two quarters) |
| Monthly | 2 | 60 days |
| Weekly | 5 | 35 days |
| Daily | 20 | 28 days |
| More often or event-driven | 25 | 20 to 30 days |
| Automated (any frequency) | Tested once | — |

The retest's request asks for the population from the fix date on, once the control has operated long enough. Only instances after the fix are sampled.

**The retest decides the deficiency.** Signing off the retest sheet effective marks the deficiency **remediated** (retest passed). Signing it off not effective sends the deficiency back to remediation (retest failed). A failed retest does not propose a second deficiency, and a signed-off retest cannot be reopened; change the deficiency in its register.

**Going back.** Moving the deficiency back to remediation before the retest is signed off withdraws the retest with its draft request and task. A person can still record a retest result by hand, which withdraws the open retest.

### Where it shows

The control's **Testing** tab lists the rounds under **After interim testing**. Each shows:

- the window it covers, and for a retest the date it becomes testable;
- the sample size, and the request's status;
- one line on what happens next;
- the round's sample plan and test sheet.

`GET .../test-rounds` lists every round. Round changes, sign-offs, and cancellations are in the audit trail.

## What the tester relied on (8.4b)

The tester cites, for each attribute result, the passages it rests on (`test_citations.py`): the file, the exact words, and for a screenshot the box around them. Screenshots are sent to the tester as images only where the firm lets the model read images (**AI workforce → Evidence reading**), at most five per item.

Every citation is checked before it is kept:

- the file must be one of the item's;
- the words must be found in the file's stored text (including what OCR read), so nothing is cited that is not there;
- a box must lie inside the image, and be neither a speck nor the whole image;
- a screenshot citation whose words OCR did not read is kept only with a valid box, and is shown as boxed only.

The page or sheet a passage is on comes from the stored text, so the preview opens the right page.

**On the Testing tab:**

- A result with citations shows a small dot.
- Its popover lists what the tester relied on, with **Open with highlights**.
- Each file chip opens that file with every passage the item's results cite.

**In the preview**, each cited passage is outlined and numbered: on the PDF page itself, on the image, or on the cited rows of a spreadsheet. A list beside it steps through them.

With a model, the screenshot review no longer stands in for the tester on a control tested once; the tester tests it again so it can cite. Results from before 8.4b have no citations: **Test again** on an open sheet adds them. Signed-off sheets are not changed.

## Execution record (Milestone 3a)

The tester's run (`testing_engine.run_sheet`) makes every model call through one agent
caller for the run: the control's tester (by domain) on the BALANCED tier, the firm's
budgets checked before each call, a person's cancellation honoured between items, and a
provenance record per call (model, tier, agent, prompt version `control-tester/1`, hashes,
job, attempt, duration, error class). The audit event `testing.items_tested` names the
tester's instance beside the person who asked for the run.

An item's `source` says who produced its results: `MODEL` (the checked answer, a pass only
with a citation that checks out), `REVIEW` (a control tested once reusing its screenshot
review, without a model), `RULES` (no model configured: every result is "unable to tell"
for a person) or `FAILED` (the model failed, was cancelled, was refused by a budget or
answered unusably: every result is "unable to tell", the note says what happened and the
failed call is linked). A failure is never written as the rules' work, and nothing is
concluded from it: the sheet stays INCOMPLETE until a person decides each result.

A person with update rights cancels a queued or running run
(`POST …/agent-runs/test-sheet/{id}/cancel`): a queued run is finished at once, a running
one stops between items; the items tested so far stand, the sheet's note reads
"Cancelled by …. Run it again when ready." and the queue lists the stopped run. A run
whose worker died is resumed when its lease runs out, and an item written before the
crash is not tested again. See [operations.md](operations.md).
