# Unified planning, Release 1: implementations and shared control plans

Authorized by the product owner on 23 October 2026 (Release 1 only; Release 2 evidence
consolidation is not authorized). The architecture, its decisions, and the owner's answers
are in the proposal of the same date; this file is the build plan and its record.

## Scope

1. A control-agnostic implementation model: where a control operates (system, legal
   entity, location, department or operating unit, shared-service centre, process or
   sub-process), all optional, kept apart from what a centrally operated control merely
   covers.
2. Shared control plans: one plan per control in the engagement, reviewed once for every
   implementation whose plan is the same.
3. Applicability per implementation, from the plans themselves: the same plan, a different
   plan (reviewed on its own), or not enough information yet.
4. Reusable implementation configuration: answers given once offered to every
   implementation that asks the same question.
5. Planning review by exception: approve together, review separately, waiting for
   information.
6. Group approval with an individual, traceable record per implementation.
7. Guided, simpler screens for the above.
8. Safe migration: every existing record, approval, and downstream relation unchanged.

Out of scope: evidence consolidation, standards matching, firm-wide reuse (Releases 2–4).

## Decisions applied (owner, 23 October 2026)

- An implementation is today's engagement control row. A control needs no system.
- Implementation scope (where it **operates**, which makes it a separate implementation) is
  kept apart from coverage (what a central control **covers**, which does not).
- A business control is split only when the engagement lead or another authorized
  reviewer confirms; never because several entities are in scope.
- No difference is treated as immaterial by default: report names, population sources,
  account ranges, administrator groups, and thresholds included. Two implementations
  share a plan only when their plans are the same once the implementation's own names are
  set aside; any other difference is shown and the plan is reviewed on its own. Where the
  plans cannot be compared, a person reviews.
- Group approval covers only implementations whose plans are the same, each approved
  through the existing approval (its own fingerprinted version and decision), all or
  none, with a group decision that records exactly what the reviewer was shown.

## Design

**Implementation model (migration 0104).**
- `engagement_scope_units`: the engagement's legal entities, locations, departments or
  operating units, shared-service centres, and processes or sub-processes. Optional.
- `engagement_control_scopes`: a control's units, each as `OPERATES` (part of what makes
  the implementation) or `COVERS` (coverage only).
- `engagement_controls.implementation_key`: the application and the operating units, kept
  by the database; one row per control and implementation replaces one per control and
  application. Every existing row's key is its application or nothing.
- `MANAGEMENT_REVIEW` joins the control classifications, which already overlap.

**Shared plans (`shared_plans.py`).** A control's family is its implementations. Each
plan is compared, as a reviewer approves it, with a reference plan, with only the
parameters in `NONMATERIAL` set aside: the plan's revision and schema numbers, the system
the row names, and the implementation's own system and unit names where the plan uses
them exactly as recorded. The reference (`reference_of`; owner, Release 1 closure):

- the approved plan, where one is approved (authoritative); approved plans that differ
  leave no reference;
- otherwise the plan the largest group of comparable implementations shares, shown as a
  *proposed* shared plan that a reviewer approves, never approved by rule;
- none on a tie, or with nothing to compare: each plan is reviewed on its own.

Plans that need information are never candidates. Each implementation is then
`SAME_PLAN`, `DIFFERENT_PLAN` (with what differs, by section and item), or
`NEEDS_INFORMATION`. The rule is the same for every kind of control (ITGC, automated
application, key report, business process, management review, entity level).

**Group decisions (migration 0104).** `plan_group_decisions`, immutable: the control, the
shared plan's fingerprint, what was presented (each implementation, its plan version, its
fingerprint, its applicability), its fingerprint, the reviewer, and the comment. Each
implementation's `plan_decisions` row names its group decision, the shared fingerprint,
and its scope.

**Review by exception.** The Test plans page opens on three groups: approve together,
review separately, waiting for information. A control's drawer shows the shared plan
once, the implementations it covers, and what differs, with the one decision.

## Acceptance criteria

1. A control on N implementations with the same plan is approved in one decision, which
   creates N plan decisions, each with its fingerprint, scope, the shared fingerprint, and
   the group decision; a stale or changed plan refuses the whole decision.
2. An implementation whose plan differs, or that needs information, cannot be in a group
   decision (the API refuses it) and is reviewed on its own as today.
3. A business process control with no system plans, reviews, and approves as one
   implementation; split by entity (confirmed by a lead), it shares one decision when the
   plans are the same and is reviewed separately where they are not.
4. A centrally operated control covering several entities stays one implementation.
5. Existing ITGC families keep their records, labels, approvals, requests, and testing;
   every existing plan decision is unchanged.
6. The Test plans page answers what to approve together and what needs separate review
   without opening each plan; decisions update in place without a full reload; the
   shared plan is shown once; it stays usable with hundreds of controls (paged, folded).
7. Lint, types, targeted unit and integration tests, the relevant critical tests, and
   migration validation pass; the full suite runs at the release's close.

## Record

Built 23 October 2026 on branch `milestones-6.5-to-8.1b`; not committed (awaiting the
owner's approval). Closure items from the owner's quality gate of the same day are marked
(closure).

**What was built.**
- Migration 0104 as designed above; applied to the development and demonstration
  databases. Existing rows keep their key (their application, or nothing).
- `implementations.py`: scope units, coverage (`COVERS`), and split by operating units
  (`PROJECT_UPDATE`, a reason of 10 to 1,000 characters, refused when the control already
  operates in a named unit). The source row keeps the first unit; the others are new rows
  with their own plans.
- `shared_plans.py`: families, the reference plan (closure: approved plan, else the
  largest group as a proposal, else none), applicability, and the group decision (all or
  none, the ready set exactly, at the versions shown, checked against the presented
  fingerprint, which now records the reference's basis).
- `MANAGEMENT_REVIEW` can be chosen as a classification (closure; the database allowed it,
  the API and the classification picker did not).
- Copies made after launch are now linked to their definitions (`_clone`), so a split
  implementation is planned as its control rather than generically.
- Test plans page: By control (default), Each plan (the existing review queue), Phases.
  Groups, a drawer with the shared plan shown once (a *proposed* shared plan where it comes
  from the largest group), the reference marked, and in-place updates: a confirmed
  approval shows as approved on its row until the refreshed list moves it; a conflict
  refreshes the drawer in place and says so.
- A split control is named by its units wherever a person could pick the wrong one
  (closure): the controls register and overview, a control's workspace and plan page, the
  plan review queue, phase release, the evidence register, engagement setup, the review
  queue, and the console's control lookup. Each entity is asked its own client values.

**Defects found and fixed at closure.**
- A fast double press on "Approve" recorded a second, empty group decision (the API
  accepted a request that had read the plans before the first committed, and approving an
  approved plan records nothing). The API now refuses it and checks one record per plan;
  the drawer sends one request. The empty record made before the fix remains in the
  demonstration database as a known historical artifact (below), unchanged.
- A split control's entities shared answers ("fill every control that has none") and
  evidence (files tagged for every system). Both now stay within the same units; sharing
  across entities is Release 2's evidence consolidation.
- Copy and display: a double full stop after names ending "Inc.", raw JSON in "What
  differs", an unstyled error message, and a link button that rendered filled in the
  drawer.

**Deferred improvements (not in Release 1), with their dependencies.**
- Planner-generated split recommendations: needs the planner to read where a control
  operates from the RCM or process narratives (entity and location facts per control)
  and a review step for the lead's confirmation; builds on `implementations.split`.
- Reusable answers across implementations: needs a rule for which values are
  entity-specific (people, thresholds) and which are shared (policies), and an explicit
  "apply to" decision recorded per implementation; today each entity answers its own and
  the existing per-system "Apply to" stays opt-in.
- General server-side paging: needs the families endpoint to page and count in SQL rather
  than read every plan (`master_plans._load`), and the page to fetch groups on demand;
  today 62 plans read in 0.38 s and the page shows 25 rows per group.
- Release 2 evidence consolidation: needs the owner's authorization; depends on the IPE
  reuse decision (report version, parameters, source, period, completeness and accuracy
  compatible) and on units, which now keep evidence apart by default.
- Units in workpapers, evidence matching suggestions, deficiency lists and exports:
  display only; depends on the same `operating_names` helper.

**Known limitations.**
- After a conflict, the list behind the drawer re-sorts as the control moves groups
  (layout shift 0.06 to 0.07, under the 0.1 guideline).
- Names are set aside only where a plan uses them exactly as recorded; a plan that
  abbreviates its system or entity shows as different (reviewed on its own, the safe
  direction).

**Evidence sharing across entities (commit authorization, 24 October 2026).**
`test_evidence_is_never_shared_across_entities_and_still_shared_across_systems` (critical)
covers both sharing rules, the files a control's family shares (`FAMILY_FILES`) and the
files a sibling adds on the same item (`shared_from_sibling`): one entity's file never
serves another entity's control or item, even tagged by a person as covering every system;
within one scope (a control per system) a person's tag for every system still serves as
before, and an agent's tag or one naming another system still does not. Release 1 has no
authorized relationship that shares evidence across entities (that is Release 2). The test
replaces the evidence block of the split-control test, whose check of the unchanged
behaviour never ran (its engagement had one system). Each guard was removed in turn and
the test failed.

**Commits (24 October 2026).** Two commits on d8afd44: the earlier approved work
(evidence handling with migrations 0100 to 0103, Home, settings and setup, the approval
flow), then this release (migration 0104 and everything above). The earlier work was
separated by attributing each change to the period it was written in, with four
line-level splits made by hand (`Makefile`, `test_migrations.py`, the units guard in
`evidence_plans.shared_from_sibling`, the `cp-` block of `planning.css`); the two test
rewrites that follow the earlier work's behaviour (`test_sampling`, `test_waiting`) are in
the first commit. The first commit was validated alone in an isolated worktree: lint
(except the known long line), mypy, tsc, every Node file (769 passed), and the full Python
suite (920 passed, 0 failed, 13 skipped live runs; an earlier run had one intermittent
failure, `test_followups::test_a_reply_supersedes_a_due_reminder_without_using_a_slot`,
which passed alone, on its file's rerun and in the full rerun, in code neither commit
changes). The second commit's tree is the state validated at closure, with only the
focused evidence test and these notes added.

**Demonstration data (synthetic test data; not a production database).**
The demonstration database (`ai_workforce_m3c_demo`, owner `m3c-demo-1ce91cc0@example.com`)
holds synthetic data only. The closure checks added to it: business control RTR-02, split
into two fictitious entities, "Northwind UK Ltd" and "Northwind US Inc.", and approved;
group approvals of ITGC-AC-01 to -03, -05 and -06; and evidence titles marked "(revised)"
on ITGC-AC-07 to -10, edited directly in the database to make a plan change while it was
being reviewed. Known historical artifact: group decision
`01a16acd-071f-7c59-9577-e5722551a2c8` (RTR-02, 23 October 2026 22:06:24 UTC) has no plan
records. The double-press defect, since fixed, created it; group decisions are immutable,
so it stays as the audit trail of that defect. It is the only group decision whose record
count differs from what it presented (the replay's `group_record_count_mismatch` is 1 on
this database and 0 on the development database).

**Closure gates (23 October 2026, uncommitted working tree on d8afd44).**
- `make test-critical` 467 passed; `make test-fast` 169 Python and 172 Node passed;
  `make test-full` 929 passed, 0 failed, 13 skipped (live model runs, opt-in); every
  Node file 778 passed. (`python -m pytest` with the Makefile's arguments: Windows blocks
  `pytest.exe`.) The first full run had 2 failures from earlier work on this branch
  (migration 0103's receipt rule; two new inbox fields): expectations rewritten, recorded
  in docs/test-strategy.md §6, and the tests added to the routine sets.
- Migration replay: 104 migrations on an empty database (0.8 s; a second run applies
  none); on disposable copies of the demonstration (118 tables, 10,015 rows) and
  development (63,183 rows, 2,247 controls) databases, 0104 rolled back with the steps in
  its notes and applied again: every table's rows identical on its pre-0104 columns at all
  three points; no duplicate implementations, no orphans, every group decision with one
  approved record per plan presented.

**Acceptance criteria (closure).** 1 to 5: PASS (`test_shared_plans.py`, now critical,
and the replay). 6: PASS on the demonstration engagement at 1440 and 390 pixels: no
horizontal overflow, no layout shift on load, approval confirmed by the server in about
1 s and the list refreshed in place in about 2 s, one decision however fast the button is
pressed, conflicts explained and refreshed in place. 7: PASS (gates above; lint clean
except the two known line-ending files and one long line already in d8afd44).
