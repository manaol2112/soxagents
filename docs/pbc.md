# PBC requests

A PBC request belongs to one project. It records who owns the request, who should receive it, when it is due, which control it supports, and what evidence was asked for. Creating or moving a request does not send email.

The control link is a reference such as `control/access-review`. The control inventory arrives in a later phase. The follow-up fields set the reminder schedule. See [Follow-up reminders](#follow-up-reminders).

## Status transitions

| From | Allowed next statuses |
| --- | --- |
| `DRAFT` | `DRAFT`, `APPROVAL_PENDING`, `CANCELLED` |
| `APPROVAL_PENDING` | `APPROVAL_PENDING`, `DRAFT`, `SENT`, `CANCELLED` |
| `SENT` | `SENT`, `WAITING_FOR_RESPONSE`, `CANCELLED` |
| `WAITING_FOR_RESPONSE` | `WAITING_FOR_RESPONSE`, `PARTIALLY_RECEIVED`, `RECEIVED`, `OVERDUE`, `ESCALATED`, `CANCELLED` |
| `PARTIALLY_RECEIVED` | `PARTIALLY_RECEIVED`, `RECEIVED`, `OVERDUE`, `ESCALATED`, `CANCELLED` |
| `RECEIVED` | `RECEIVED`, `CLOSED` |
| `OVERDUE` | `OVERDUE`, `WAITING_FOR_RESPONSE`, `PARTIALLY_RECEIVED`, `RECEIVED`, `ESCALATED`, `CANCELLED` |
| `ESCALATED` | `ESCALATED`, `WAITING_FOR_RESPONSE`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED`, `CLOSED` |
| `CANCELLED` | `CANCELLED`, `CLOSED` |
| `CLOSED` | `CLOSED` |

`SENT` and every later in-progress status require an outbound message id and thread id that already exist in the project mailbox. The transition checks that row. It does not create or send a message. After the request leaves `DRAFT`, the recipient, control reference, and evidence description stay bound. A sent message id stays bound as well.

**The reviewer approves the agent's draft.** A request the evidence coordinator drafted for a control (from its plan, at kickoff, on a scope change, or for its samples: any request tied to a control) is approved by the person who reviews it, in one step: they read it, edit it if needed, and approve it (`POST …/pbc-requests/{id}/approve` with the version and a note). The agent is recorded as having asked (`requesting_agent_id`, the evidence coordinator) and the reviewer as the approver, so no second person is needed and nobody approves their own request. It needs project.update (owners, admins, project managers); it is refused for a request with no recipient, a kickoff draft held for planning, or a request a person wrote (never tied to a control): that one is submitted for someone else to approve. The request then waits in `APPROVAL_PENDING`, approved, until someone sends it; sending stays a separate click. The public decision endpoint is unchanged: a requester never approves there.

**Approve and send (product owner, 22 October 2026).** This changes the earlier decision that sending stays a separate click (`docs/phase-plan.md`). A reviewer may now approve an agent's draft and send it in one press:

- **One request:** the request's panel offers **Approve and send**. The web route makes the approve call, then the send call with that approval (`request-review-model.approveAndSend`).
- **Many requests:** the bulk action `APPROVE_SEND` (`POST …/evidence-requests/bulk`) runs Approve's checks for each request, approves it, then sends it through the same send path (`outbound.send_request`).
- **Separately recorded:** the approval and the send are each recorded and audited on their own.
- **A refused send:** the request stays approved and says why ("Approved, but not sent: …"), to be sent again later.
- **The separate path:** **Approve only**, and the bulk **Approve**, still approve without sending.

**Approval and return for revision.** Someone who prepares requests without the right to approve them submits a draft instead: that asks for an approval of its exact message and moves it to `APPROVAL_PENDING`. The person who submitted it never approves it, and only someone with project.update may. Rejecting the approval (with a reason) returns the request to `DRAFT` for revision, unless another approval of it is still open or approved; the approver, time, and reason are in the audit trail (`pbc.returned_for_revision`). An approved request waits in `APPROVAL_PENDING` until someone sends it. Each request on the control register carries its latest approval (`approval_decision`, `approval_reason`, who decided) and whether the person reading may decide it (`viewer_can_decide`); `GET …/pbc-requests/{id}` reads one request whole.

`PARTIALLY_RECEIVED` or `RECEIVED` records the first response time. `RECEIVED` also records the received time. `ESCALATED` is the only status whose escalation state is `ESCALATED`. `CANCELLED` requires a reason. `CLOSED` is the end of the record.

People who can update a task can create and move a request while the project is active. A paused project can still be closed or cancelled through an existing request, and it cannot gain a new one. A reviewer can read requests and cannot change them. The audit payload stores the status only.

## Sending a request

Requests are sent only from an approved template. The template registry is code in `ai_workforce_api/outbound.py`. A test pins each template's fingerprint, so a wording change needs code review. The current templates are `pbc-request` and `pbc-reminder` version 2 (Milestone 8.12): they carry the owner's secure upload link and say that email attachments are not accepted as evidence. The approved text holds a placeholder where the link goes; the delivery mints the link and puts it there, so the approval still matches and the link is never stored. A message approved under version 1 no longer matches and is refused at send with `approval does not match`; submit it again. See [evidence.md](evidence.md#secure-upload-links).

1. `GET .../pbc-requests/{id}/outbound-preview` renders the message and shows whether the recipient is allowed. It writes nothing.
2. `POST .../pbc-requests/{id}/submit` with the request version renders the message, checks the recipient, requests a `mail.pbc` approval, and moves a draft to `APPROVAL_PENDING`.
3. Another person with project update rights approves it. The requester cannot approve their own request.
4. `POST .../pbc-requests/{id}/send` with the approval id sends it.
5. `GET .../outbound-messages` lists delivery records for the project.

The approval binds the recipient, the subject, and `request_ref`. The `request_ref` holds the request id, the template version, and a fingerprint of the rendered recipient, subject, and body. If the due date, the engagement name, or anything else in the message changes after approval, the send is refused with `approval does not match`. The generic action endpoint refuses `mail.pbc`, so a request cannot skip the template.

The subject carries a short reference such as `[PBC-1A2B3C4D]`. The message metadata carries the full request id, that reference, the template, and the outbound record id. Reply matching in Milestone 6.5 uses these.

### Recipients

The recipient must be a valid address and must match the request. It cannot be the shared mailbox. When `EMAIL_ALLOWED_RECIPIENT_DOMAINS` is set, the domain must exactly match one entry. A malformed entry allows nothing. An empty value allows any valid address.

### Delivery records

The send commits an outbound record in `PENDING` before it calls the mailbox provider. The provider idempotency key is `outbound:<record id>`, and one approval can own only one record. Repeating a send returns the same record.

| Status | Meaning |
| --- | --- |
| `PENDING` | Recorded, and the delivery attempt is in progress or was interrupted |
| `ACCEPTED` | The provider accepted the message. Delivery is not confirmed |
| `SENT` | The provider reports the message left the mailbox |
| `DELIVERED` | The provider confirmed delivery. Only this sets `delivery_confirmed` |
| `BOUNCED` | The provider reported a bounce |
| `FAILED` | Nothing was sent, for example because live email is disabled |
| `UNKNOWN` | A timeout or provider error happened after the send may have started |

A database trigger allows only forward moves: `PENDING` to `ACCEPTED`, `FAILED`, or `UNKNOWN`; `UNKNOWN` to `ACCEPTED` or `FAILED`; `ACCEPTED` to `SENT`, `DELIVERED`, or `BOUNCED`; and `SENT` to `DELIVERED` or `BOUNCED`. Content and provider ids cannot change once recorded, and records cannot be deleted. The mock provider reports acceptance only, so it never produces `SENT`, `DELIVERED`, or `BOUNCED`.

Retrying an `UNKNOWN` or interrupted `PENDING` record reconciles first. The service looks the message up by its idempotency key. If the provider has it, the record moves to `ACCEPTED` without a second send. If not, it sends once more, unless the approval has expired. An attempt holds a two-minute claim, so a second caller cannot start the same delivery while the first is running.

On `ACCEPTED`, the approval execution is marked `SUCCEEDED`, and the request moves to `SENT` with the provider message id and thread id. On `FAILED`, the approval is marked `REFUSED` and the request stays in `APPROVAL_PENDING`. Audit payloads store the status, the error code, and the template only. They never store the recipient, the subject, or the body.

## Request details

Migration 0075. `GET .../pbc-requests/{id}/details` returns the request with what the review panel shows (`request_details.py`): its reference and title, its type, the client checklist read back from the wording, the audit team's planning (internal), its reference materials, the engagement's contacts and the suggested recipient, the client's email domains, and the checks before approval and sending.

- **Type.** Twelve types in `evidence_request_types` (population, sample evidence, sample of one, configuration, policy or procedure, process narrative, system report or IPE, access listing, reconciliation, approval evidence, exception evidence, other). Until a person confirms one (`POST .../classification`, with an optional title), the type comes from the records: the evidence plan's requirement categories, else the drafter's item kinds, else the request's purpose (a samples request); wording alone gives only a recommendation. A population on an access control is an access listing; execution evidence for design is a sample of one. A type the records do not settle must be confirmed before the reviewer approves the agent's draft.
- **Assignment.** `POST .../assignment` with the version, recipient, copied addresses (`cc`, up to ten), due date, and priority (`NORMAL`, `HIGH`, `URGENT`). Every address must be valid, allowed for outbound email, and within the client's email domains (the engagement's `client_domains`, else those of its owners and coordinator). Changes are refused once a message is recorded. An approved request that has not been sent returns to draft and its pending approval expires; the approved one can no longer be used, as sending checks the approved recipients and wording. Audit: `pbc.assignment_changed`, with each change.
- **Contacts.** `GET .../engagement-contacts` lists the coordinator, the control owners, contacts added from requests, and past recipients. `POST` adds one (`engagement_contact.added`); adding an address twice keeps one.
- **Copied people.** The copied addresses are part of the content fingerprint in `request_ref`, so the approval covers them; a request nobody is copied on keeps its earlier fingerprint. They go to the mailbox provider with the message and are kept on the outbound record. Reminders copy the same people.
- **Reference materials.** `POST .../attachments?name=` uploads one; `POST .../attachments/link` attaches an engagement file or a prior-year workpaper (an xlsx made at the time, from the same client's earlier engagement, same control, which the person can read). `GET .../attachments/{id}/content` and `/preview`; `POST .../remove` and `/visibility`. Each is `INTERNAL` until someone with project update rights shares it (`SHARED`); only shared ones appear on the owner's secure upload page, downloaded with the portal session. Audit: `pbc.attachment_added`, `_shared`, `_unshared`, `_removed`.
- **Checks against the test plan (milestone D).** Wording specific and in the client's terms, items mapped to approved attributes, periods within the phase's window, the phase applies, nothing undecided, no duplicate open request (`request_quality.py`). The details carry `supports`, the approved attributes the items evidence, for the reviewer; the client's view never does.
- **Checks.** Title, type, phase, instructions (not the placeholder written while drafting), recipient, copied, due date (not past), the control still in scope, reference materials, and planning. Approving the agent's draft runs them all; submitting a person's request runs all but the type; sending runs the recipient, copied, due date, and control again.

## The planning gate

Migration 0077. An evidence request the evidence coordinator drafts for a planned phase is created only when `evidence_plans.gate_reason` allows it: the control's evidence plan is approved by a person (or approved with changes proposed), and for interim and roll-forward evidence the control's attributes are settled. Decided by the product owner: the plan waits for a person whether or not a model is configured. A plan is never approved on its own.

The Evidence tab lists what still needs the person (`attention_of`): a provisional plan, missing information, exceptions, approvals the planner listed, a phase whose applicability is undecided or has an open question, or proposed changes. A plan a person approved is never changed automatically, and later planner changes to it are proposed to them. A plan that took effect with no approver before this rule takes later planner changes directly, and goes back to proposed (`settle_automatically`) if one of them needs judgment.

Every request still needs an approver before it is sent.

Since migration 0079 the plan is the control's master test plan ([testing.md](testing.md#master-test-plans-0079)). Approving it needs project.update and approves the control's attributes with it, so the attributes are settled before approval. A material change to an approved plan (a person's edit, an accepted proposal, a change to the control or its attributes) sends it back for review (filling a client value the plan left in brackets is not one, migration 0086), and the gate closes until it is approved again: drafts already made are held as before. Requests drafted from the plan record the revision they came from (`pbc_requests.plan_revision`).

Launch writes the rules' plan for each control and leaves it proposed. With a model, the plan is marked for the planner agent (`run_status` PENDING); `run_plan` refines it in the background and still leaves it proposed. If the run fails (`fail_plan_run`), or no model is configured when it runs, the rules' plan stands and still waits. `POST …/evidence-plan/approve` is what releases the requests the gate allows (`release`); so does settling the control's attributes or an open conflict about them, once the plan is approved. The local scheduler then drafts what was released (`drafts_for_plan`).

`POST …/evidence-plan/approve` releases what the gate allows; so does any decision on the control's attributes or open conflicts. Plans proposed before this rule are not settled retroactively. A draft the agent made before the gate opened is held (`held_for_planning`): approving, submitting, and sending it are refused with `approve the evidence plan first` or `settle the control's attributes first`, and the request details checks say so. A person's own request is not held.

## Drafting from the control

After kickoff, the evidence coordinator drafts every kickoff request from its control, in the background. Code: `services/api/ai_workforce_api/pbc_drafting.py`.

Since Milestone 8.7 each control's evidence is planned by testing phase first, and kickoff makes a **design request** and an **interim request** per control from that plan (the roll-forward's items go out on its round's request). A phase request is drafted item by item from its planned evidence: the rules write one item per requirement, and Claude words the same items, with a draft that asks for a population in a design request, or leaves out a required planned item, rejected. Every request records its phase (`testing_phase`). See [testing.md](testing.md#evidence-planning-by-phase-87). A request holds every planned item whole, at the requirement's own wording (up to 14 items of up to 1,500 characters; migration 0073 raises the request text to 80,000 characters), and is never shortened. When the full wording does not fit one email (4,000 characters), the email lists every item by number and title with its period and says the full wording of each is on the secure link, where the owner sees the request whole; nothing is cut without saying so. The approver approves that email as it will go.

What a request from before 8.7 asked for, the first request for each control (still how a request with no planned items is drafted):

- **A manual or IT-dependent manual control:** the population of instances in the period, with the fields a tester needs to select and trace a sample (by area: user, role, approver for access; ticket, approver, tester, deployer for change; transaction, amount, preparer, reviewer for the business cycles), the export format, the report parameters, and how to show the population is complete. A monthly, quarterly, or annual control asks for each occurrence instead (12, 4, or 1 expected).
- **An automated control:** the configuration that enforces it, and every change to that configuration in the period with who can change it.
- **A key report (IPE):** the report as run, its logic or query, its parameters, and its reconciliation to the ledger or source.
- **Every control:** evidence for a walkthrough of one instance against the test attributes, and the policy or procedure.

Sample evidence is not requested here. It comes after samples are selected (Phase 8).

Who drafts:

- **Claude**, when `MODEL_PROVIDER=anthropic` and `MODEL_API_KEY` are set. The control's facts from the RCM (including the client's own terms and extra columns) are sent to Anthropic as data, inside a `<control>` block, with instructions to ignore anything in it that reads as an instruction. The answer must come through one tool and match the draft schema; an answer outside the tool counts as no answer. It is then checked again: no links, no credential-shaped text, no request for passwords or access, and the item the control needs (population, configuration, or report) must be there. A draft that breaks a rule is rejected, not repaired. Each call is recorded in `model_calls` against the person who approved the kickoff.
- **The rules drafter**, without a model, or when the call fails or the draft is rejected. It writes the same structure from the control's own facts. The draft records why the rules were used.

A draft only rewrites a request that is still `DRAFT`, so it can never change a message someone already submitted for approval. Coordinator notes and assumptions stay in the platform; only the request text is emailed. A person can **Redraft** a draft request from the Evidence page.

Background work: the drafting state is a row per request in `pbc_drafts`. With `WORKFLOW_ADDRESS` set, each draft is a Temporal workflow (`pbc_draft`, three attempts, then marked failed). Without it, `LOCAL_WORKER_ENABLED=true` runs drafts on two worker threads in the API process for local development. Either way, open drafts resume when the API starts, and a draft that is already finished is skipped, so running one twice is safe.

## Inbound replies

Milestone 6.5 records replies that arrive in the shared mailbox. Mail content is untrusted data. Nothing passes it to a model, follows a link in it, or opens an attachment. Since Milestone 8.12 a reply's attachments are never taken as evidence: evidence comes in through the owner's secure upload link.

### Processing

Each received message is recorded once in `inbound_messages`, keyed by the mailbox message. Repeating a notification returns the same record. `POST .../inbound-messages/reconcile` records any received message that has no record yet, for example after a missed notification.

The record keeps:

- The sender address, and the subject on one line.
- The body as plain text. Markup, scripts, styles, control characters, and zero-width or direction-override characters are removed. Secret-looking values such as `password: …`, `sk-…`, and private key blocks are replaced with `[redacted]`. The text is limited to 20,000 characters, and a flag records truncation and redaction.
- Attachment metadata: name, type, size, and a SHA-256 hash when the provider supplies one. The bytes are stored separately. See [evidence.md](evidence.md).

The API marks every record `untrusted: true`. The web app refuses records without that mark and shows the text as plain text.

### Matching

A reply matches a request only when both hold:

1. It is in the request's mail thread, or its subject carries the request reference such as `[PBC-1A2B3C4D]`.
2. The sender is the request's recipient.

The request must also be open: sent, waiting, partially received, overdue, escalated, or received. Anything else is unmatched, with one reason: `no_reference`, `unknown_reference`, `ambiguous_reference` (more than one request), `conflicting_reference` (the thread and the subject disagree), `sender_mismatch`, or `request_not_open`. For the last two the record suggests the likely request.

### People decide

A match never changes the request status. A matched reply is flagged `NEEDS_REVIEW`. A person with project update rights:

- Marks a reply reviewed with `POST .../inbound-messages/{id}/review`.
- Assigns unmatched mail to an open request with a reason, `POST .../assign`. It then needs review.
- Dismisses unmatched mail with a reason, `POST .../dismiss`.

The request status is then updated separately through the request itself. Each decision happens once. A database trigger keeps the content fixed and allows only these forward moves. Records cannot be deleted. Audit payloads hold the decision only, never the sender, subject, or body.

### Local testing

The mock mailbox does not receive real mail. With `EMAIL_MOCK_INBOUND_ENABLED=true` and the mock provider, a team member can simulate a reply with `POST .../mailbox/simulated-inbound`. The endpoint returns 404 otherwise.

## Follow-up reminders

Milestone 6.6 schedules reminders for sent requests. Every reminder needs approval. Nothing goes out unattended.

**One stage once sent** (decided by the product owner). A sent request is awaiting its evidence: the pages show **Awaiting evidence** from the moment it is sent, with no separate Sent stage. The request's status still records `SENT` until a reminder goes out (then `WAITING_FOR_RESPONSE`), which the reminder schedule uses; a saved view filtering on the old Sent stage reads as Awaiting evidence.

**Who approves what** (decided by the product owner). A request the evidence coordinator drafted (`drafted_by = 'AGENT'`) is reviewed and approved by a person before it is sent. A request a person wrote (`drafted_by = 'PERSON'`) is sent directly: **Send to the recipient** on a draft, or **Send now** on one already submitted by the same person (`POST …/pbc-requests/{id}/send-direct`, `outbound.send_written`). It is submitted, the approval is recorded as the sender's, with the reason (`approvals.approve_own`), and it is sent. Every send check still applies: the planning gate, a recipient on the allowed domains, and a message that fits. One submitted by someone else is theirs to send, or an approver's to approve.

**Reminders in one click** (decided by the product owner). A reminder repeats a request that was already approved, in the reviewed reminder wording, so the person who asks for it approves it. **Follow up now** (`POST …/pbc-requests/{id}/follow-ups/now`) works while the request is with the recipient and no reminder is open; **Send reminder** on a reminder the schedule made due (`POST …/follow-ups/{id}/remind`). Both write the reminder, record the approval as that person's, with the reason (`approvals.approve_own`, audit `approval.self_approved`), and send it at once in the request's thread. With email off, the approval stands and the reminder goes once email is on. The agent's reminders, and anyone who wants a second look, still ask another person (`…/submit`). A request takes at most ten reminders.

**Email off.** With no mailbox to send through, **Send** is refused before anything is recorded ("live email is off"). The approval stands, and the same message is sent with it once email is on, with no second approval (decided by the product owner). Approval and execution records stay immutable.

**Send again.** A request refused before that rule, because email was off, used up its approval: those records cannot change. It reads as "Approved, not sent" (`request_approvals` reports `RESEND`), and **Send again** (`POST …/pbc-requests/{id}/resend`) carries the approval over. A new approval for the same message (same action and parameters, whose request reference carries the content hash) is recorded as approved by the person sending, with the earlier approval, its approver, and its date in the reason, and the message is sent. Only an unchanged message carries over: a changed one, or one refused for another reason, needs another person's approval.

**A refused send.** An approved request whose send was refused after it started (for example, the message not fitting) sent nothing. It reads as "Not sent: submit again" (`request_approvals` reports `FAILED`), and **Submit again** asks for a new approval. Once it is resubmitted, the refusal shows as history, not as the request's state.

### Schedule

A request gets reminders while it is sent, waiting for a response, partially received, or overdue, and the engagement is active. Each request has one durable timer in Temporal, workflow id `pbc-follow-up:{request_id}`. The timer only keeps time. Each time it wakes, it calls one database step, which decides what happens:

- The last contact is the latest of: the original request, the last sent or skipped reminder, and the last matched or assigned reply.
- The next reminder falls due `follow_up_after_days` after the last contact.
- When it falls due, a `DUE` reminder is recorded with the next sequence number, unless one is already open.
- Once `max_follow_ups` reminders are used and another interval passes with no reply, the request moves to `ESCALATED` for a person. Automatic reminders then end for that request, even if a person reopens it.

The step locks the request row, so a late, repeated, or concurrent wake-up cannot create a second reminder. The timer starts when the request is accepted. On API start, timers restart for every open request. `POST .../follow-ups/reconcile` runs the step for every open request in a project and restarts its timers.

### Sending a reminder

1. A person prepares the due reminder: `POST .../pbc-requests/{id}/follow-ups/{follow_up_id}/submit`. The service renders the `pbc-reminder` template and requests approval for `mail.reminder`, bound to the exact message.
2. A different person approves it.
3. A person sends it: `POST .../follow-ups/{follow_up_id}/send`. Delivery follows the same rules as the original request: the outbound record is committed first, one approval owns one record, and an unknown outcome reconciles by idempotency key before any retry.

The reminder goes out in the request's original mail thread, with the request reference in the subject. A sent reminder moves a `SENT` request to `WAITING_FOR_RESPONSE`. The generic action endpoint refuses `mail.reminder`, so a reminder can only come from the reviewed template.

### Stopping

- Moving a request out of the reminder statuses cancels its open reminder at once, with reason `request_resolved`.
- The send step checks the request again right before the provider call. If the request was resolved in between, the send is refused with `request_resolved` and nothing is sent.
- A matched reply that arrives while a reminder is due supersedes it (`reply_received`). The next reminder is scheduled from the reply.
- A person can skip a due reminder: `POST .../follow-ups/{follow_up_id}/skip`. A rejected approval also counts as skipped. Both use one of the `max_follow_ups` slots.
- An expired approval or a failed delivery frees the slot, so the same reminder falls due again.

### Records

Reminders are stored in `pbc_follow_ups`. A database trigger keeps the request, sequence, and due time fixed, allows only forward moves from `DUE` and `APPROVAL_PENDING`, and blocks deletes. Audit events `follow_up.due`, `follow_up.submitted`, `follow_up.sent`, `follow_up.skipped`, `follow_up.failed`, and `follow_up.cancelled` hold the sequence, status, and reason only. The scheduler records its own changes with no actor; the web app shows these as Workspace.

**A request settled by acceptance (product owner, 22 Oct 2026).** A request is received when a person has accepted every item it asked for, whatever the evidence reader found: nothing more is asked of the owner, so its open reminders are cancelled as resolved, and the change is in the audit trail (`pbc_request.received`). Before, it stayed partly received while the reader had not found every item covered. Migration 0103 applies this to requests already settled that way.
