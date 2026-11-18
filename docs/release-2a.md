# Release 2a: evidence catalog, specifications, and a read-only consolidation analysis

Authorized by the product owner on 24 October 2026, after the Release 2 architecture and
user experience reviews, with the commit conditions of the same day. Release 2 removes
unnecessary evidence work while keeping audit quality: fewer, clearer requests (R2b), one
artifact for several requirements where it is genuinely the same evidence (R2c), one
Evidence workspace and a plain client portal (R2d), and key report reuse (R2e). R2a builds
what those stand on and changes nothing users see.

## Scope

1. **Evidence catalog** (`evidence_catalog.py`): the kinds of artifact several requirements
   can share, which library evidence items are which kind, and which hold personal data.
   Versioned in code (revision 2) and reviewed like the library.
2. **Evidence specification** for every requirement: its kind, its scope (organization,
   engagement, system, or one control; and always its operating units), its period, what
   distinguishes one instance of the artifact from another, its sensitivity, and whether it
   is a sample item. Stored with a fingerprint and the plan revision it was computed from
   (`evidence_specifications`, migrations 0105 and 0106).
3. **Compatibility rules**: whether two requirements could share one artifact (identical,
   compatible with differences a person must confirm, or incompatible, with the reasons).
4. **Read-only consolidation analysis** (`consolidation.py`): the requests delivery
   grouping would produce and the requirements artifact sharing could serve together, for
   one engagement, recorded as an immutable analysis run for review.
5. **The freshness gate** for R2b (`consolidation.require_fresh`).

Not active in R2a (owner, 24 October 2026): consolidated requests, automatic artifact
sharing, grouped acceptance, owner assignment, and the redesigned workspace and portal.
Requests, files, receipts, sufficiency, approvals, and testing behave exactly as before.

## Decisions applied

- Release 1's entity isolation holds: requirements in different operating units are never
  compatible, whatever their kind.
- A specification match is a precondition for sharing, never proof that a file is
  sufficient; R2a only classifies.
- Samples are never shared across controls.
- Anything outside the catalog (a requirement written by a person or the agent, a custom
  control) is never shared and is reported for catalog review.
- **Sensitivity is reviewed, not guessed** (owner's commit conditions). A library item holds
  personal data only by the reviewed list (`SENSITIVE_ITEMS`, 14 items: HR termination and
  transfer listings and their report screens and walkthroughs, managers of record, HR
  status, the payroll register and its source documents, an employee's pay recalculation);
  13 items whose wording mentions HR, payroll, leavers, or transfers were reviewed and are
  not personal data (`REVIEWED_NOT_SENSITIVE`). Every item of a hire-to-retire control
  other than its documented procedure is personal data. Evidence of a custom control, or
  written by a person or the agent, is **UNKNOWN**: never shared, never grouped with other
  evidence, and not sendable until a person classifies it. Words only prompt the review: a
  test fails when a library item's wording suggests HR or payroll data and it is in neither
  list.
- **Recipients** (owner's commit conditions): a request's own recipient is confirmed; a
  control's recorded owner is a suggestion a person confirms (R2b); without either, the
  evidence is grouped internally per system as "not yet assigned". Such a group is never a
  sendable client request. No address is invented: a recorded value that is not an address
  is ignored.
- **Oversized requests**: a group larger than the guideline is split by control family,
  then by system, when that reads better; the guidelines (25 items, two families, 14 days)
  are not limits.
- Cross-control policy sharing is deferred: catalog revision 2 maps none; a reviewed
  methodology mapping comes before R2c. Title similarity never authorizes sharing.

## Catalog, revision 2

| Kind | Scope | Period | Sensitivity | Library items |
| --- | --- | --- | --- | --- |
| Policy or procedure | Organization (per unit where the control is split) | In force during the period | Standard | Every suite item in the form of a policy (31), and the rules-generated procedure, process narrative and review criteria items; one document per item, so it is shared by the control's own implementations, never across controls |
| HR leavers listing | Organization | Window | Personal | `ac02-e3` |
| HR transfers listing | Organization | Window | Personal | `ac07-e3` |
| Production deployment log | System | Window | Standard | `cm01-e3` (all deployments), `cm02-e4` (outside the normal release path), `cm07-e4` (releases) |
| Users able to change a configuration | System | As of a date | Standard | `ac05-e5`, `op03-e5`, `itac03-e5` to `itac13-e5` (each for its own configuration) |
| Calendar of days | Engagement | Window | Standard | `op01-e3`, `ac12-e3`, `op06-e3` |
| Specific to one control | That control | Its own | Reviewed per item | Every other suite item and the other rules-generated items |

Revision 1 recognised personal data from words in item names; revision 2 replaces that
with the reviewed lists. Specifications computed under revision 1 are stale.

## Compatibility rules

In order; the first that applies decides.

1. Different operating units: **incompatible** (entity isolation).
2. Either's sensitivity is not established: **incompatible**.
3. Either is a sample item: **incompatible**.
4. Either is outside the catalog: **incompatible**.
5. Either is specific to one control: **incompatible**.
6. Different kinds: **incompatible**; different sensitivity: **incompatible**.
7. System scope and different systems: **incompatible**.
8. Policy or procedure for different documents: **incompatible**.
9. As-of dates differ: **incompatible**; windows that do not overlap: **incompatible**.
10. Windows or periods that overlap but differ, or a different selection or configuration:
    **compatible with differences** (a person would confirm, in R2c).
11. Otherwise: **identical**.

## Freshness: the contract for R2b

A specification is current only when it was computed under this catalog revision, from the
requirement as it is now (version and last change), and from the current revision of its
plan, and that revision is approved. `staleness` names the reason for each requirement that
is not (`NO_SPECIFICATION`, `CATALOG_CHANGED`, `REQUIREMENT_CHANGED`, `PLAN_REVISED`,
`PLAN_NOT_APPROVED`). **R2b calls `require_fresh` before it generates a request and again
before a request is approved; any reason refuses** (`SpecificationStale`), and nothing is
generated or approved from a stale specification. The analysis reports the same reasons;
a plan that is not yet approved is reported, not counted as a change.

## Acceptance criteria

1. Every library evidence item is classified by the catalog, and a test fails when the
   library adds one the catalog does not know or one whose sensitivity is not reviewed.
2. Every requirement of an engagement gets a specification, fingerprint, and plan
   revision; a requirement or plan that changes is reported, and the freshness gate
   refuses it.
3. The rules hold for every kind of control, with entity isolation, unknown sensitivity,
   samples, and the catalog boundary tested as critical.
4. The analysis changes no requirement, request, file, receipt, or approval (asserted by a
   test comparing those tables before and after), and its runs cannot be changed.
5. Migrations 0105 and 0106 are additive; replay on copies of the demonstration and
   development databases changes no existing row.
6. The R2a report gives the actual opportunities on the demonstration and development
   engagements, the risks, the tests, and the migration results.

## Record

Built 24 October 2026 on `b382ac1`.

**What was built.** Migrations 0105 (two new tables) and 0106 (the plan revision a
specification was computed from); `evidence_catalog.py`; `consolidation.py` with
`POST …/evidence-consolidation/analyses` and `GET …/analyses/latest` (project read to view,
task update to run, people only) and the freshness gate. No screen changed.

**Decisions made while building, accepted by the owner.** Evidence without a named person
is grouped per system, not per provider role (provider roles split one person's work into
more requests than today); a group still larger than the guideline after the family split
is split by system (the demonstration engagement otherwise produced 114-item requests); a
requirement whose wording changed is refreshed but not counted as a changed specification;
groups a person could reconcile are joined and say where and when they apply.

**Analysis results** (on disposable copies; the development database holds no analysis):

| | Demonstration (synthetic) | Development |
| --- | --- | --- |
| Requirements in scope | 1,333 | 105 |
| Already on a request in the audit trail (never regrouped) | 14 | 18 |
| Requests today (one per control and phase, samples apart) | 459 | 24 |
| Requests after delivery grouping | 78 | 20 |
| of which internal groups to assign an owner to (never sendable) | 4 (10 items) | 16 (66 items) |
| Largest request | 36 items | 14 items |
| Evidence of unknown sensitivity | 0 | 0 |
| Requirements that could share an artifact (identical) | 135 in 41 groups, 94 fewer asks | 14 in 7 groups, 7 fewer asks |
| Compatible with differences (a person would confirm) | 42 in 11 groups | 6 in 1 group |

On the development engagement most evidence has no named owner (the controls record none),
so the count of requests there depends on R2b's owner assignment: the 16 internal groups
become as many requests as there are owners. Identical sharing is almost all the same
control's policy across its systems and the HR leavers and transfers listings.

**Databases.** 0105 and 0106 are applied to the development database (`ai_workforce`) and
the synthetic demonstration database (`ai_workforce_m3c_demo`), and to no other database on
the local server. The development database holds no specifications and no analysis runs.
The demonstration database holds two analysis runs and 1,333 specifications from catalog
revision 1, reported stale until its next analysis. There is no production database in this
environment. Test databases are created per test from the migrations and dropped. Replay
copies were dropped.

**Migration.** 0105 and 0106 replayed together on disposable copies of the demonstration
(121 tables, 10,181 rows) and development (121 tables, 66,135 rows) databases: applied,
analysed, rolled back with the steps in their notes, applied again; every pre-existing
table identical at each point but for the one audit event each analysis records. Existing
evidence requests, approvals, and testing conclusions are therefore unchanged.

**Tests.** `test_evidence_catalog.py` (21, in `make test-critical`): the catalog; reviewed
sensitivity (lists disjoint, every prompted item reviewed, only the lists decide; payroll
areas; custom and written evidence unknown); specifications and fingerprints; every rule
both ways round, entity isolation and unknown sensitivity first; grouping (oversized split,
unassigned per system and never sendable, unknown sensitivity apart and not sendable,
confirmed and suggested recipients, personal data apart, due dates); and on an engagement
with a control split by entity: every requirement specified, the read-only fingerprint of
requirements, requests, files, filings, decisions, approvals and tests, immutable runs,
staleness for wording and period, the freshness gate refusing an unapproved plan, passing
after approval, refusing a revised plan, and another firm seeing nothing.

**Known limitations.**
- Specifications are refreshed when an analysis runs; R2b refreshes them before generating
  requests, behind the freshness gate.
- Policies shared across different controls are not in the catalog; a reviewed
  methodology mapping comes before R2c.
- Leftover test databases from earlier interrupted runs (none with 0105) remain on the
  local server; they are not part of R2a.
