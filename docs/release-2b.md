# Release 2b: grouped evidence requests

Authorized by the product owner after the R2a commit (065cafb), in three steps: R2b-1
(grouped draft requests, the grouped review panel, approval and sending, migration 0107),
R2b-2 (owner suggestions), R2b-3 (statuses and bulk). The architecture is **Option 1,
wrapping**, approved by the owner: a grouped request wraps the per-control requests one
person receives, and those per-control requests stay authoritative for requirements,
receipts, and testing. This record covers **R2b-1** only. R2b-2, R2b-3, R2c, and R2d are
not started.

## Decisions applied

- **One request per person and phase.** The evidence coordinator's untouched drafts for
  one recipient (with the same people copied), one phase, one kind of evidence (samples
  apart), one sensitivity (personal data apart, R2a's reviewed lists), and one set of
  operating units (Release 1's entity isolation) travel together. R2a's split rule
  applies unchanged: a group over 25 items spanning more than two control families is
  split by family, a part still over 25 items by system, and dates more than 14 days
  apart by date. An email that cannot carry every item names every control and leaves the
  items to the secure link (as a single request's brief does), and is split only if even
  that does not fit. A group of one is no group: that request goes as it does today.
- **Regrouping is automatic and never restructures what a person shaped.** Until it is
  approved, a group is a proposal computed when the list is read; nothing is stored, so a
  new draft joins and a sent one leaves without anyone regrouping. A draft is *touched*,
  and not regrouped on its own, when a person edited its wording or classification,
  attached a file, wrote on it, asked for a redraft, returned it, or it had an approval of
  its own. Assigning a recipient, copies, a due date, or a priority is routing, not
  shaping: such a draft regroups under its new recipient. A touched draft for the same
  person and phase is offered in the group's review ("Also for this person") for a person
  to include. Requests awaiting approval, sent requests, and historical approvals are
  never restructured.
- **Eligibility is the same as approving a draft today.** Any agent draft a reviewer could
  approve on its own: addressed to a valid address, not held (planning, plan approval,
  attributes, phase release), not still being drafted, with its requirements in scope and
  of known sensitivity. A draft written by a person is never grouped (it goes to someone
  else for approval).
- **The grouping is invisible.** The Evidence page lists a group as one request ("Evidence
  for 4 controls", the earliest due date, one status). Its panel shows who it goes to and
  by when, each control with its items (a control's own due date only where it differs),
  what stops it, and the email. No grouping vocabulary appears.

## Approval and sending

One action, **Approve and send**, available only when every request in the group is ready
(the same checks the single request's approval runs, plus R2a's freshness gate):

1. **Approve, atomically.** In one transaction: each member is locked and checked (still a
   draft, the version the reviewer saw, drafted by the agent, not held, every request
   check); the group's email is rendered and its recipients checked against the allowed
   domains; the members' requirement specifications are refreshed and
   `consolidation.require_fresh` refuses any that is not current against the approved
   plan revision; sensitivity must be known and the operating units one set; then **each
   member is approved through the existing approval engine** (the evidence coordinator
   asks, the person approves, as for a single draft), each approval binding that request
   *and the group's email* (`request_ref = pbc/{request}/pbc-group-v1/{group}/{digest}`),
   every member moves to awaiting sending, and the group and its **immutable approval
   record** are written: every member with its version and approval, every requirement
   with its version, specification fingerprint, plan revision and sensitivity, and the
   recipient, people copied, subject, and content digest. Any failure rolls all of it back.
2. **Send, durably.** The single outbound message is recorded through the existing outbound
   engine against the **lead member's approval** before the provider is called, under
   locks and after every check again: the group still approved, each member at its
   approved version, the content digest unchanged, the send checks per request, every
   member's approval still approved, unexecuted, unexpired, and bound to this email. One
   approval owns one message, and the message's key is its content, so it is never sent
   twice; a repeated call resumes the record (reconciling with the provider by idempotency
   key after an interruption).
3. **Outcome.** Accepted: every member is sent in one thread with the same message id,
   every member's approval is settled as executed, and the group is sent. Refused by the
   provider, or found changed before sending (a request, a requirement, its plan revision,
   or the content), or its approvals expired: the group is recorded **not sent** with the
   reason, every member's approval is settled as refused, and the members return to draft
   to be grouped and approved again. Email off: nothing is recorded and the approval
   stands, sent once email is on (the outbound engine's existing rule). A delivery whose
   outcome is unknown stays approved and is resumed by **Send** in the panel.

The panel shows a result only after the server confirms it, and a second press while the
first is on its way does nothing (and would be refused or resumed by the server anyway).

## No member ever sends or reminds alone

- A request in an approved or sent group is refused by the single-request send path.
- Reminders run once per group, through its lead: a member's timer ends at once; the
  lead's reminds while any request in the group is with the recipient (even after its own
  evidence arrived), counts replies across the group, and escalates every open member
  together. The reminder lists only what is still open, in the group's thread, under the
  group's reference. "Follow up now" on any member reminds the group.
- Replies in the group's thread match several requests, so the existing inbound matching
  treats them as ambiguous and gives them to a person to place.
- Uploads come through the existing portal per request, so each file stays with the
  requirements it answers.

## Migration 0107

Three tables, additive: `evidence_request_groups` (status moves only from approved to sent
or not sent; immutable otherwise; never deleted), `evidence_request_group_members` (frozen;
a request is in at most one group in effect; released only when its group is not sent),
`evidence_group_approvals` (immutable). Rollback in the file's notes, only before any group
is sent.

## Record

Built on 065cafb.

**Modules.** New: `evidence_groups.py` (proposals, the group's email and reminder wording,
the review, approve and send, and the hooks below), migration 0107, the panel
(`request-group.tsx`, `request-group-model.ts`). Changed, each narrowly:

- `outbound.py`: one approval settled by id (`settle_approval`, used by `_settle`); the
  group's email rendered for the send's own re-check and its reminder for the lead;
  members sent or returned to draft when the provider accepts or refuses; a member never
  sent alone; "Follow up now" reminds through the lead.
- `followups.py`: a member's timer ends; the lead reminds while any member is open,
  escalates them together, and stays in the restart list.
- `evidence_center.py`: `grouped=1` collapses a group's requests into one row (the API and
  CSV export are unchanged without it); a group is never bulk-selected; the control filter
  finds the group a control travels in.
- `main.py` (routes), the Evidence page's model, loader, table and panel wiring.

The approximately thirty per-control consumers are unchanged.

**Routes.** `GET …/evidence-groups/{id}` (review), `POST …/approve-send` (people who may
approve), `POST …/send` (resume).

**Wording** (reviewed at the owner's closure check: short, precise, client-friendly). The
email says what the audit team for the engagement needs and by when, lists each control by
its name and system (never an internal control ID, never the grouping) with its items and
periods, a control's own due date only where it differs, and points to the secure link
for the full wording. The reminder says what is still outstanding. The reference stays
only in the subject, where reply matching needs it. Both are locked by a hash test
(`test_the_group_wording_is_the_reviewed_version`); a change is deliberate and reviewed.

**A person's routing is never overwritten** (owner's closure check). Regrouping only reads:
it never writes a recipient, copies, a due date, or a priority. A draft a person reassigns
travels with its new recipient's request; a due date or priority a person set stays on
the request through regrouping, approval, and sending, and the email shows that control's
own due date (`test_a_persons_recipient_due_date_and_priority_are_never_overwritten`).

**Databases.** 0107 replayed on disposable copies of the demonstration (123 tables, 11,518
rows) and development (123 tables, 66,135 rows) databases: applied, grouped (read only),
rolled back with its notes, applied again; no pre-existing row changed at any point.
Applied to both. No group is stored in either. Their records are disposable development
data (the owner's clean-slate policy) and were not used to shape the behavior; the
screenshots come from a separate synthetic database built through onboarding, with the
mock mailbox.

**Validation on freshly onboarded synthetic engagements.** IT general controls over one
system: 62 drafts become 8 requests (one per person and phase, personal data apart). IT
general controls over two systems with application controls, key reports, a business
process control, two management reviews, and a payroll control: one request per person,
phase, and system for the general controls; application controls and key reports
together; the business process control and management reviews together for their owner;
the payroll control only with personal data. A first cut packed requests greedily by item
count and fragmented one person's work into many small requests mixing families; it was
replaced by R2a's family-then-system rule, with the email naming every control when the
items do not fit.

## Known limitations

- Bulk Approve and send for groups is not in R2b-1 (R2b-3); a group is approved from its
  panel. Group rows are never bulk-selected.
- Recipients come only from the request; suggestions are R2b-2. A draft without one stays
  on its own until it has one.
- **Temporary:** the client portal still lists the per-control requests a link opens. The
  consolidated client experience (one request, its controls and items, one place to
  upload) remains required for Release 2 and is delivered in R2d; R2b does not close
  Release 2 without it.
- A plan with proposed changes awaiting a decision blocks its control's group
  (R2a's freshness contract requires the approved revision); the panel says so.
- Statuses (Missing, Provided, Verified, Accepted, Ready for testing) are R2b-3; a sent
  group shows the least advanced of its requests' stages, and each control's own.

# R2b-2: bulk owner assignment

Authorized with the R2b-1 commit (2869d8c). Built on the clean-slate policy: validated on
freshly onboarded synthetic engagements; no work for historical records.

## Behavior

- **Who needs an owner.** Every draft request addressed to no one. The Evidence page says
  how many ("9 requests have no owner") with **Assign owners**, and the evidence
  coordinator link when none is set. Such a request stays unsendable: it joins no request
  for a person, and approval refuses it.
- **Suggestions from reliable records only, with their source**, first that applies:
  1. *Control owner in the RCM* (the control's recorded owner).
  2. *Receives this control's other requests*: the one person a person confirmed for the
     same control's other requests (approved or sent, or assigned by a person).
  3. *Named for ITGC-AC-05 in the engagement contacts*: the one contact whose role a
     person wrote names the control.
  4. *Receives the change management requests for SAP ERP*: the one person confirmed for
     the same area's requests on the same system.
  An ambiguous record (two people), an address the engagement cannot send to, or no record
  suggests nothing. Nothing is invented: not an address, and not a name (a name shows only
  where a record holds one).
- **Bulk confirmation with individual overrides.** One section per suggested person, with
  its sources and its requests, all checked; **Change for all** or **Change** on any
  request picks someone else from the engagement's people or a typed address; unchecking
  leaves a request out. Requests with no suggestion wait in their own section for a pick.
  **Assign N requests** confirms them in one action.
- **Confirming** sets each recipient through the single request's own assignment: the
  same address checks (valid, allowed, within the client's domains), version check, and
  audit (`pbc.assignment_changed`, the person's); copies, due date, and priority stay. A
  request that cannot change says why beside it; the others go through. An assigned
  draft then travels with that person's other requests for the phase (R2b-1).
- **No schema change.** Routes: `GET …/evidence-owners`, `POST …/evidence-owners/assign`.

## Proposed, not built

- **System owners.** The approved sources include application and system owners, but no
  record holds one (`engagement_applications` has no owner). Recording a business and an
  IT owner per system at onboarding would make them a reliable source; that is a schema
  and onboarding change for the owner's decision.

## Known limitations

- Assignment applies to drafts only; a request awaiting approval or sent keeps its
  recipient.
- A draft whose due date has passed is refused until its date is changed (the single
  request's assignment rule).
