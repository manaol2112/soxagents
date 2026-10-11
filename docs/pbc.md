# PBC requests

A PBC request belongs to one project. It records who owns the request, who should receive it, when it is due, which control it supports, and what evidence was asked for. Creating or moving a request does not send email.

The control link is a reference such as `control/access-review`. The control inventory arrives in a later phase. The follow-up fields record the schedule only. They do not send a reminder.

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
