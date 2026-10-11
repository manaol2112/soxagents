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

`PARTIALLY_RECEIVED` or `RECEIVED` records the first response time. `RECEIVED` also records the received time. `ESCALATED` is the only status whose escalation state is `ESCALATED`. `CANCELLED` requires a reason. `CLOSED` is the end of the record.

People who can update a task can create and move a request while the project is active. A paused project can still be closed or cancelled through an existing request, and it cannot gain a new one. A reviewer can read requests and cannot change them. The audit payload stores the status only.

## Sending a request

Requests are sent only from an approved template. The template registry is code in `ai_workforce_api/outbound.py`. A test pins each template's fingerprint, so a wording change needs code review. The first template is `pbc-request` version 1.

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

## Drafting from the control

After kickoff, the evidence coordinator drafts every kickoff request from its control, in the background. Code: `services/api/ai_workforce_api/pbc_drafting.py`.

What a draft asks for, the first request for each control:

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

Milestone 6.5 records replies that arrive in the shared mailbox. Mail content is untrusted data. Nothing passes it to a model, follows a link in it, or opens an attachment.

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
