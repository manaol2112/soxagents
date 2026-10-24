"""Outbound evidence requests from approved templates. Live email stays disabled."""

import hashlib
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from string import Template
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.approvals import (
    ApprovalBody,
    ApprovalCreate,
    ApprovalState,
    _load,
    _request,
    approve_agent_request,
    approve_own,
    payload_hash,
)
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_portal import LINK_PLACEHOLDER, link_url, mint_link
from ai_workforce_api.followups import (
    FollowUpBody,
    FollowUpState,
    FollowUpTimer,
    close_open,
    follow_up_now,
    lock_follow_up,
    mark_sent,
    mark_submitted,
    read_follow_up,
    schedule,
)
from ai_workforce_api.mailbox import (
    MOCK_SENDER,
    MailboxProvider,
    MailboxState,
    MailboxUnavailable,
    MailMessage,
    mailbox_available,
    open_mailbox,
)
from ai_workforce_api.pbc import _COLUMNS as _PBC_COLUMNS
from ai_workforce_api.pbc import PbcBody, PbcState
from ai_workforce_api.pbc import _audit as _pbc_audit
from ai_workforce_api.pbc import _body as _pbc_body
from ai_workforce_api.pbc import _lock as _lock_pbc
from ai_workforce_api.policy import evaluate
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

MailboxFactory = Callable[[Settings, psycopg.Connection[Any], UUID, UUID], MailboxProvider]
ACTION_ID = "mail.pbc"
REMINDER_ACTION_ID = "mail.reminder"
CLAIM_SECONDS = 120
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_DOMAIN = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
_OPEN = frozenset({"PENDING", "UNKNOWN"})
_COLUMNS = """
    id, pbc_request_id, approval_id, template_id, template_version, recipient, subject,
    status, provider_message_id, thread_id, error_code, attempt_count, metadata,
    created_at, updated_at, version
"""


class OutboundState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


@dataclass(frozen=True)
class MessageTemplate:
    template_id: str
    version: int
    subject: str
    body: str


# Version 2 (Milestone 8.12): evidence comes in through the owner's secure upload link,
# never as email attachments. The approved text holds a placeholder where the link goes;
# the delivery mints the link and puts it there, so the token is never stored.
PBC_REQUEST = MessageTemplate(
    template_id="pbc-request",
    version=2,
    subject="[$reference] Evidence request: $control",
    body=(
        "Hello,\n\n"
        "The audit team for $engagement is requesting the evidence below.\n\n"
        "Request: $reference\n"
        "Control: $control\n"
        "Due: $due\n\n"
        "Evidence requested:\n"
        "$description\n\n"
        "Upload the evidence through your secure link:\n"
        "$upload_link\n\n"
        "The link opens every open request the audit team has sent you for this "
        "engagement. When you open it, a one-time code is emailed to this address. Files "
        "sent as email attachments are not accepted as evidence.\n\n"
        "If you have a question, reply to this email and keep $reference in the subject.\n\n"
        "Thank you."
    ),
)
PBC_REMINDER = MessageTemplate(
    template_id="pbc-reminder",
    version=2,
    subject="[$reference] Reminder: Evidence request: $control",
    body=(
        "Hello,\n\n"
        "This is reminder $sequence of $limit for the evidence the audit team for "
        "$engagement requested.\n\n"
        "Request: $reference\n"
        "Control: $control\n"
        "Due: $due\n\n"
        "Evidence requested:\n"
        "$description\n\n"
        "Upload the evidence through your secure link:\n"
        "$upload_link\n\n"
        "When you open it, a one-time code is emailed to this address. Files sent as "
        "email attachments are not accepted as evidence.\n\n"
        "If you have already uploaded it, thank you, and you can ignore this reminder."
    ),
)
TEMPLATES: tuple[MessageTemplate, ...] = (PBC_REQUEST, PBC_REMINDER)
# A grouped request's reminder (evidence_groups) is a reminder too.
_REMINDER_TEMPLATES = frozenset({PBC_REMINDER.template_id, "pbc-group-reminder"})


@dataclass(frozen=True)
class RenderedMessage:
    template: MessageTemplate
    recipient: str
    subject: str
    body: str
    reference: str
    content_sha256: str
    request_ref: str
    metadata: dict[str, str]
    action_id: str = ACTION_ID
    thread_id: str | None = None
    # Copied on the message. Bound by the approval through the content digest, which the
    # approved request_ref carries.
    cc: tuple[str, ...] = ()

    def parameters(self) -> dict[str, str]:
        return {
            "recipient": self.recipient,
            "subject": self.subject,
            "request_ref": self.request_ref,
        }


class OutboundPreview(BaseModel):
    template_id: str
    template_version: int
    reference: str
    recipient: str
    recipient_allowed: bool
    subject: str
    body: str
    parameters: dict[str, str]


class SubmitBody(BaseModel):
    version: int = Field(ge=1)


class SubmitResult(BaseModel):
    request: PbcBody
    approval: ApprovalBody
    preview: OutboundPreview


class ReminderSubmitResult(BaseModel):
    follow_up: FollowUpBody
    approval: ApprovalBody
    preview: OutboundPreview
    # Sent at once: a person's reminder is approved by asking for it (see remind_now).
    delivery: OutboundBody | None = None


class ApproveDraftBody(BaseModel):
    version: int = Field(ge=1)
    # The reviewer's note, kept with the approval.
    reason: str = Field(default="Reviewed and approved.", min_length=1, max_length=500)


class SendBody(BaseModel):
    approval_id: UUID


class OutboundBody(BaseModel):
    id: UUID
    pbc_request_id: UUID
    approval_id: UUID
    kind: Literal["request", "reminder"]
    follow_up_id: UUID | None
    template_id: str
    template_version: int
    recipient: str
    subject: str
    reference: str
    status: str
    delivery_confirmed: bool
    # Copied on the message (migration 0075).
    cc: list[str] = Field(default_factory=list)
    provider_message_id: str | None
    thread_id: str | None
    error_code: str
    attempt_count: int
    created_at: datetime
    updated_at: datetime
    version: int


def register_outbound(
    app: FastAPI,
    settings: Settings,
    mailbox: MailboxFactory = open_mailbox,
    timer: FollowUpTimer | None = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/pbc-requests/{{request_id}}/outbound-preview")
    def preview(
        organization_id: UUID, project_id: UUID, request_id: UUID, request: Request
    ) -> OutboundPreview:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _preview(
                connection, settings, principal, organization_id, project_id, request_id
            ),
        )

    @app.post(f"{base}/pbc-request-batches/submit")
    def submit_batch(
        organization_id: UUID, project_id: UUID, body: SubmitBatchBody, request: Request
    ) -> SubmitBatchResult:
        principal = _session_principal(request)
        return _call(
            settings,
            lambda connection: _submit_batch(
                connection, settings, principal, organization_id, project_id, body
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/submit")
    def submit(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: SubmitBody,
        request: Request,
    ) -> SubmitResult:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _submit(
                connection, settings, principal, organization_id, project_id, request_id, body
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/approve")
    def approve_draft(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: ApproveDraftBody,
        request: Request,
    ) -> SubmitResult:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _approve_draft(
                connection, settings, principal, organization_id, project_id, request_id, body
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/send")
    def send(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: SendBody,
        request: Request,
    ) -> OutboundBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: send_request(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                request_id,
                body.approval_id,
                mailbox,
                timer,
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/follow-ups/now")
    def follow_up_request_now(
        organization_id: UUID, project_id: UUID, request_id: UUID, request: Request
    ) -> ReminderSubmitResult:
        """Send a reminder now, ahead of the schedule, in the reviewed reminder wording.
        The person asking approves it by asking (remind_now)."""
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> ReminderSubmitResult:
            authorize(
                connection,
                principal=principal,
                action=Action.TASK_UPDATE,
                organization_id=organization_id,
                project_id=project_id,
            )
            from ai_workforce_api.evidence_groups import reminder_target

            target = reminder_target(connection, request_id)
            follow_up = follow_up_now(connection, organization_id, project_id, target, principal.id)
            if follow_up.status == "APPROVAL_PENDING":
                raise OutboundState("a reminder already awaits approval")
            return remind_now(
                connection, settings, principal, organization_id, project_id, target,
                follow_up.id, timer, mailbox,
            )  # fmt: skip

        return _run(settings, work)

    @app.post(f"{base}/pbc-requests/{{request_id}}/send-direct")
    def send_direct(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: SubmitBody,
        request: Request,
    ) -> OutboundBody:
        """Send a request a person wrote straight to its recipient (send_written)."""
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: send_written(
                connection, settings, principal, organization_id, project_id, request_id,
                body.version, mailbox, timer,
            ),
        )  # fmt: skip

    @app.post(f"{base}/pbc-requests/{{request_id}}/resend")
    def resend(
        organization_id: UUID, project_id: UUID, request_id: UUID, request: Request
    ) -> OutboundBody:
        """Send again a request whose send was refused because email was off, on the
        approval it already had (resend_request)."""
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: resend_request(
                connection, settings, principal, organization_id, project_id, request_id,
                mailbox, timer,
            ),
        )  # fmt: skip

    @app.post(f"{base}/pbc-requests/{{request_id}}/follow-ups/{{follow_up_id}}/submit")
    def submit_follow_up(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        follow_up_id: UUID,
        request: Request,
    ) -> ReminderSubmitResult:
        """Ask another person to approve a reminder (the agent's way, and anyone's who
        wants a second look)."""
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: submit_reminder(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                request_id,
                follow_up_id,
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/follow-ups/{{follow_up_id}}/remind")
    def remind_follow_up(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        follow_up_id: UUID,
        request: Request,
    ) -> ReminderSubmitResult:
        """Send a due reminder in one step: the person asking approves it (remind_now)."""
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: remind_now(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                request_id,
                follow_up_id,
                timer,
                mailbox,
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/follow-ups/{{follow_up_id}}/send")
    def send_follow_up(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        follow_up_id: UUID,
        body: SendBody,
        request: Request,
    ) -> OutboundBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: send_reminder(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                request_id,
                follow_up_id,
                body.approval_id,
                mailbox,
            ),
        )

    @app.get(f"{base}/outbound-messages")
    def list_messages(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[OutboundBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _list(connection, principal, organization_id, project_id),
        )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        return _call(settings, work)
    except (OutboundState, ApprovalState, PbcState, FollowUpState) as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail="outbound fields are invalid") from error


def render(request: PbcBody, engagement: str) -> RenderedMessage:
    template = PBC_REQUEST
    reference, subject, body = _compose(template, request, engagement, {})
    recipient = request.recipient.strip()
    cc = _copied(request)
    digest = _digest(recipient, cc, subject, body)
    return RenderedMessage(
        template=template,
        recipient=recipient,
        subject=subject,
        body=body,
        reference=reference,
        content_sha256=digest,
        request_ref=f"pbc/{request.id}/{template.template_id}-v{template.version}/{digest[:16]}",
        metadata={
            "request_id": str(request.id),
            "request_reference": reference,
            "template": f"{template.template_id}.v{template.version}",
        },
        cc=cc,
    )


def _copied(request: PbcBody) -> tuple[str, ...]:
    return tuple(item.strip().lower() for item in request.cc_recipients if item.strip())


def _digest(recipient: str, cc: tuple[str, ...], subject: str, body: str) -> str:
    # A request with nobody copied keeps the digest it had before copies existed.
    copied = f"\ncc:{','.join(cc)}" if cc else ""
    return hashlib.sha256(f"{recipient}{copied}\n{subject}\n{body}".encode()).hexdigest()


def render_reminder(
    request: PbcBody, engagement: str, follow_up_id: UUID, sequence: int
) -> RenderedMessage:
    """Reminders reply in the request's thread so the recipient sees one conversation."""
    if request.thread_id is None:
        raise ValueError("request has no thread")
    template = PBC_REMINDER
    reference, subject, body = _compose(
        template,
        request,
        engagement,
        {"sequence": str(sequence), "limit": str(max(sequence, request.max_follow_ups))},
    )
    recipient = request.recipient.strip()
    cc = _copied(request)
    digest = _digest(recipient, cc, subject, body)
    version = f"{template.template_id}-v{template.version}"
    return RenderedMessage(
        template=template,
        recipient=recipient,
        subject=subject,
        body=body,
        reference=reference,
        content_sha256=digest,
        request_ref=f"pbc/{request.id}/{version}/{follow_up_id}/{digest[:16]}",
        metadata={
            "request_id": str(request.id),
            "request_reference": reference,
            "template": f"{template.template_id}.v{template.version}",
            "follow_up_id": str(follow_up_id),
            "follow_up_sequence": str(sequence),
        },
        action_id=REMINDER_ACTION_ID,
        thread_id=request.thread_id,
        cc=cc,
    )


def _compose(
    template: MessageTemplate, request: PbcBody, engagement: str, extra: dict[str, str]
) -> tuple[str, str, str]:
    reference = f"PBC-{request.id.hex[-8:].upper()}"
    due = request.due_at.astimezone(UTC)
    values = {
        "reference": reference,
        "control": request.control_ref.strip()[:120],
        "engagement": " ".join(engagement.split())[:200] or "this engagement",
        "due": f"{due.day} {due:%B %Y}",
        "description": request.evidence_description.strip(),
        "upload_link": LINK_PLACEHOLDER,
        **extra,
    }
    subject = Template(template.subject).substitute(values)
    body = Template(template.body).substitute(values)
    # The delivered body swaps the placeholder for the link, so leave room for it.
    room = 200 if LINK_PLACEHOLDER in body else 0
    if len(body) > 4000 - room and LINK_PLACEHOLDER in body:
        # The full wording does not fit one email: send every item in brief, and say the
        # full request is on the secure link, where the owner sees it whole.
        values["description"] = request_summary(request.evidence_description)
        body = Template(template.body).substitute(values)
    if len(subject) > 200 or len(body) > 4000 - room:
        raise ValueError("message is too long")
    return reference, subject, body


_ITEM = re.compile(r"^\d{1,2}\. \S")
SUMMARY_NOTE = (
    "This request is longer than one email. Every item is listed above in brief; the full "
    "wording of each is on the secure link below."
)


def request_summary(description: str) -> str:
    """A request in brief, for an email that cannot carry its full wording: what comes
    before the first item, then each item's number and title with its period, and a note
    that the full wording is on the secure link. No item is left out."""
    opening: list[str] = []
    items: list[str] = []
    for paragraph in description.strip().split("\n\n"):
        lines = paragraph.strip().split("\n")
        if _ITEM.match(lines[0]):
            period = [line.strip() for line in lines[1:] if line.strip().startswith("Period:")]
            items.append("\n".join([lines[0], *(f"   {line}" for line in period)]))
        elif not items:
            opening.append(paragraph.strip())
    return "\n\n".join([*opening, *items, SUMMARY_NOTE])


def recipient_allowed(settings: Settings, recipient: str) -> bool:
    address = recipient.strip().lower()
    if _EMAIL.fullmatch(address) is None:
        return False
    if address in {MOCK_SENDER, settings.shared_mailbox_address.strip().lower()}:
        return False
    configured = settings.email_allowed_recipient_domains.strip()
    if configured == "":
        return True
    domains = {item.strip().lower() for item in configured.split(",")}
    allowed = {item for item in domains if _DOMAIN.fullmatch(item) is not None}
    return address.rsplit("@", 1)[1] in allowed


def recipients_allowed(settings: Settings, message: Any) -> bool:
    """The recipient and everyone copied are allowed (live email reaches all of them)."""
    return all(
        recipient_allowed(settings, address)
        for address in (message.recipient, *getattr(message, "cc", ()))
    )


def _preview(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
) -> OutboundPreview:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    pbc = _read_pbc(connection, organization_id, project_id, request_id)
    return _preview_body(
        settings, render(pbc, _engagement(connection, organization_id, project_id))
    )


class BatchItem(BaseModel):
    request_id: UUID
    version: int = Field(ge=1)


class SubmitBatchBody(BaseModel):
    items: list[BatchItem] = Field(min_length=1, max_length=500)


class BatchOutcome(BaseModel):
    request_id: UUID
    ok: bool
    detail: str = ""


class SubmitBatchResult(BaseModel):
    submitted: int
    failed: int
    outcomes: list[BatchOutcome]


def _submit_batch(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: SubmitBatchBody,
) -> SubmitBatchResult:
    """Submit drafted requests for approval, each exactly as one is submitted: its own
    version check, recipient check, and approval. An approver still approves each
    message. One that cannot go is reported and the rest go on."""
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    outcomes: list[BatchOutcome] = []
    seen: set[UUID] = set()
    for item in body.items:
        if item.request_id in seen:
            continue
        seen.add(item.request_id)
        try:
            _submit(
                connection, settings, principal, organization_id, project_id,
                item.request_id, SubmitBody(version=item.version),
            )  # fmt: skip
            outcomes.append(BatchOutcome(request_id=item.request_id, ok=True))
        except NotVisible:
            outcomes.append(
                BatchOutcome(request_id=item.request_id, ok=False, detail="request not found")
            )
        except (OutboundState, ApprovalState, PbcState) as error:
            outcomes.append(BatchOutcome(request_id=item.request_id, ok=False, detail=error.detail))
        except ValueError:
            outcomes.append(
                BatchOutcome(
                    request_id=item.request_id, ok=False, detail="the request is too long to send"
                )
            )
    submitted = sum(1 for outcome in outcomes if outcome.ok)
    return SubmitBatchResult(
        submitted=submitted, failed=len(outcomes) - submitted, outcomes=outcomes
    )


def _submit(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    body: SubmitBody,
) -> SubmitResult:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    pbc = _read_pbc(connection, organization_id, project_id, request_id)
    if pbc.version != body.version:
        raise OutboundState("pbc request changed")
    if pbc.status not in {"DRAFT", "APPROVAL_PENDING"}:
        raise OutboundState("request is already sent")
    from ai_workforce_api.evidence_plans import held_for_planning

    held = held_for_planning(connection, request_id) if pbc.status == "DRAFT" else None
    if held is not None:
        raise OutboundState(held)
    if pbc.recipient.strip() == "":
        # Drafted with no owner email and no evidence coordinator to address it to.
        raise OutboundState("set who the request goes to first")
    message = render(pbc, _engagement(connection, organization_id, project_id))
    if not recipients_allowed(settings, message):
        raise OutboundState("recipient is not allowed")
    _check(connection, settings, organization_id, project_id, request_id, _SUBMIT_CHECKS)
    approval = _request(
        connection,
        principal,
        organization_id,
        project_id,
        ApprovalCreate(action_id=ACTION_ID, parameters=message.parameters()),
    )
    updated = pbc
    if pbc.status == "DRAFT":
        with transaction(connection) as cursor:
            row = cursor.execute(
                f"""
                UPDATE pbc_requests
                SET status = 'APPROVAL_PENDING', updated_at = clock_timestamp(),
                    version = version + 1
                WHERE id = %s AND organization_id = %s AND project_id = %s
                  AND version = %s AND status = 'DRAFT'
                RETURNING {_PBC_COLUMNS}
                """,
                (request_id, organization_id, project_id, body.version),
            ).fetchone()
            if row is None:
                raise OutboundState("pbc request changed")
            updated = _pbc_body(row)
            _pbc_audit(
                cursor, organization_id, project_id, principal.id, request_id, "APPROVAL_PENDING"
            )
    return SubmitResult(
        request=updated, approval=approval, preview=_preview_body(settings, message)
    )


# The request details checks (request_details.request_checks) each step runs.
_SUBMIT_CHECKS = frozenset(
    {"title", "phase", "instructions", "recipient", "cc", "due", "control", "planning"}
)
_SEND_CHECKS = frozenset({"recipient", "cc", "due", "control", "planning"})


def _check(
    connection: psycopg.Connection[Any],
    settings: Settings,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    keys: frozenset[str] | None,
) -> None:
    from ai_workforce_api.request_details import blocker

    problem = blocker(connection, settings, organization_id, project_id, request_id, keys)
    if problem is not None:
        raise OutboundState(problem)


def _agent_drafted(connection: psycopg.Connection[Any], request_id: UUID) -> bool:
    """Drafted by the evidence coordinator for a control (from its plan, at kickoff, on a
    scope change, or for its samples), not written by a person. Recorded when the request
    is created (migration 0076): a person's request may name its control too."""
    row = connection.execute(
        "SELECT 1 FROM pbc_requests WHERE id = %s AND drafted_by = 'AGENT'",
        (request_id,),
    ).fetchone()
    return row is not None


def _coordinator(connection: psycopg.Connection[Any], organization_id: UUID) -> UUID | None:
    row = connection.execute(
        "SELECT id FROM agent_definitions WHERE organization_id = %s "
        "AND agent_key = 'evidence-coordinator'",
        (organization_id,),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


def _approve_draft(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    body: ApproveDraftBody,
) -> SubmitResult:
    """The reviewer approves a request the agent drafted, as it stands: the evidence
    coordinator asked, the reviewer approves. It then waits to be sent. A request a person
    wrote is submitted for someone else to approve instead."""
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    reason = " ".join(body.reason.split())
    if contains_secret({"reason": reason}):
        raise ValueError("approval note holds a secret")
    pbc = _read_pbc(connection, organization_id, project_id, request_id)
    if pbc.version != body.version:
        raise OutboundState("pbc request changed")
    if pbc.status != "DRAFT":
        raise OutboundState("request is not a draft")
    if not _agent_drafted(connection, request_id):
        raise OutboundState("only an agent's draft is approved by its reviewer")
    from ai_workforce_api.evidence_plans import held_for_planning

    held = held_for_planning(connection, request_id)
    if held is not None:
        raise OutboundState(held)
    if pbc.recipient.strip() == "":
        raise OutboundState("set who the request goes to first")
    message = render(pbc, _engagement(connection, organization_id, project_id))
    if not recipients_allowed(settings, message):
        raise OutboundState("recipient is not allowed")
    _check(connection, settings, organization_id, project_id, request_id, None)
    agent = _coordinator(connection, organization_id)
    if agent is None:
        raise OutboundState("the evidence coordinator is not set up")
    asked = _request(
        connection,
        principal,
        organization_id,
        project_id,
        ApprovalCreate(
            action_id=ACTION_ID, parameters=message.parameters(), requesting_agent_id=agent
        ),
    )
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE pbc_requests
            SET status = 'APPROVAL_PENDING', updated_at = clock_timestamp(),
                version = version + 1
            WHERE id = %s AND organization_id = %s AND project_id = %s
              AND version = %s AND status = 'DRAFT'
            RETURNING {_PBC_COLUMNS}
            """,
            (request_id, organization_id, project_id, body.version),
        ).fetchone()
        if row is None:
            raise OutboundState("pbc request changed")
        approve_agent_request(cursor, organization_id, project_id, principal.id, asked.id, reason)
        _pbc_audit(
            cursor, organization_id, project_id, principal.id, request_id, "APPROVAL_PENDING"
        )
    approval = _load(connection, organization_id, project_id, asked.id)
    if approval is None:
        raise NotVisible()
    return SubmitResult(
        request=_pbc_body(row), approval=approval, preview=_preview_body(settings, message)
    )


def send_request(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    approval_id: UUID,
    mailbox: MailboxFactory = open_mailbox,
    timer: FollowUpTimer | None = None,
) -> OutboundBody:
    """Commit the outbound record before the provider is called."""
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    result = _send_once(
        connection,
        settings,
        principal,
        organization_id,
        project_id,
        approval_id,
        mailbox,
        lambda: _record(
            connection, settings, principal, organization_id, project_id, request_id, approval_id
        ),
        lambda current: current.pbc_request_id == request_id and current.follow_up_id is None,
    )
    if result.status == "ACCEPTED":
        schedule(timer, organization_id, project_id, request_id)
    return result


def submit_reminder(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    follow_up_id: UUID,
) -> ReminderSubmitResult:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    pbc = _read_pbc(connection, organization_id, project_id, request_id)
    if not _remindable(connection, pbc):
        raise OutboundState("request is not open")
    follow_up = read_follow_up(connection, organization_id, project_id, request_id, follow_up_id)
    if follow_up.status != "DUE":
        raise OutboundState("reminder is not due")
    message = _reminder(
        connection,
        pbc,
        _engagement(connection, organization_id, project_id),
        follow_up.id,
        follow_up.sequence,
    )
    if not recipients_allowed(settings, message):
        raise OutboundState("recipient is not allowed")
    approval = _request(
        connection,
        principal,
        organization_id,
        project_id,
        ApprovalCreate(action_id=REMINDER_ACTION_ID, parameters=message.parameters()),
    )
    updated = mark_submitted(
        connection, organization_id, project_id, principal.id, follow_up, approval.id
    )
    return ReminderSubmitResult(
        follow_up=updated, approval=approval, preview=_preview_body(settings, message)
    )


def remind_now(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    follow_up_id: UUID,
    timer: FollowUpTimer | None = None,
    mailbox: MailboxFactory = open_mailbox,
) -> ReminderSubmitResult:
    """A person's reminder, in one step (decided by the product owner). A reminder repeats
    a request that was already approved, in the reviewed reminder wording, so the person
    who asks for it approves it: the approval is recorded as theirs, with the reason, and
    the reminder is sent at once. An agent's reminder still waits for a person. With
    email off, the approval stands and the reminder is sent later."""
    submitted = submit_reminder(
        connection, settings, principal, organization_id, project_id, request_id, follow_up_id
    )
    if principal.kind is not PrincipalKind.USER:
        return submitted
    reference = f"PBC-{request_id.hex[-8:].upper()}"
    with transaction(connection) as cursor:
        approve_own(
            cursor, organization_id, project_id, principal.id, submitted.approval.id,
            f"Reminder {submitted.follow_up.sequence} for {reference}, sent by the person "
            "who asked for it: it repeats a request already approved, in the reviewed "
            "reminder wording.",
        )  # fmt: skip
    try:
        delivery = send_reminder(
            connection, settings, principal, organization_id, project_id, request_id,
            follow_up_id, submitted.approval.id, mailbox,
        )  # fmt: skip
    except OutboundState as refused:
        if refused.detail != "live email is off":
            raise
        delivery = None
    approval = _load(connection, organization_id, project_id, submitted.approval.id)
    return ReminderSubmitResult(
        follow_up=read_follow_up(connection, organization_id, project_id, request_id, follow_up_id),
        approval=approval if approval is not None else submitted.approval,
        preview=submitted.preview,
        delivery=delivery,
    )


def send_written(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    version: int,
    mailbox: MailboxFactory = open_mailbox,
    timer: FollowUpTimer | None = None,
) -> OutboundBody:
    """Send a request a person wrote, not the agent, straight to its recipient (decided
    by the product owner). The person writing it is the human judgment; the agent's
    drafts are the ones a person reviews and approves first. The approval is recorded as
    the sender's, with the reason, and every send check still applies: the planning
    gate, the recipient and the allowed domains, and the message fitting."""
    from ai_workforce_api.workspace import request_approvals

    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise OutboundState("a person sends this")
    if _agent_drafted(connection, request_id):
        raise OutboundState("the agent's draft is reviewed and approved first")
    pbc = _read_pbc(connection, organization_id, project_id, request_id)
    if pbc.version != version:
        raise OutboundState("pbc request changed")
    if pbc.status == "DRAFT":
        submitted = _submit(
            connection, settings, principal, organization_id, project_id, request_id,
            SubmitBody(version=version),
        )  # fmt: skip
        approval_id = submitted.approval.id
        requester = principal.id
    elif pbc.status == "APPROVAL_PENDING":
        latest = request_approvals(connection, project_id).get(request_id)
        if latest is None or latest["approval_decision"] not in ("PENDING", "APPROVED"):
            raise OutboundState("this request needs approval")
        approval_id = UUID(str(latest["approval_id"]))
        requester = latest["approval_requested_by"]
        if latest["approval_decision"] == "APPROVED":
            return send_request(
                connection, settings, principal, organization_id, project_id, request_id,
                approval_id, mailbox, timer,
            )  # fmt: skip
    else:
        raise OutboundState("request is already sent")
    if requester != principal.id:
        # Someone else submitted it for approval: it is theirs to send, or another's to
        # approve.
        raise OutboundState("another person submitted this request")
    with transaction(connection) as cursor:
        approve_own(
            cursor, organization_id, project_id, principal.id, approval_id,
            "Written by a person, not drafted by the agent: sent directly by the person "
            "who sent it, without a second approval.",
        )  # fmt: skip
    return send_request(
        connection, settings, principal, organization_id, project_id, request_id,
        approval_id, mailbox, timer,
    )  # fmt: skip


def carried_over_from(
    connection: psycopg.Connection[Any], project_id: UUID, approval_id: UUID
) -> tuple[UUID, str, datetime] | None:
    """An earlier approval of the very same message by another person (same action and
    parameters, whose request reference carries the message's content hash; who asked
    for the approval, a person or the agent, does not matter),
    whose send was refused because email was off: nothing was sent, so that approval
    still covers this message. Returns (approval id, approver, decided at)."""
    row = connection.execute(
        """
        SELECT earlier.id, coalesce(u.display_name, 'the approver'), earlier.decided_at
        FROM approvals current
        JOIN approvals earlier
          ON earlier.project_id = current.project_id
         AND earlier.action_id = current.action_id
         AND earlier.parameters = current.parameters
         AND earlier.id <> current.id
        JOIN outbound_messages o ON o.approval_id = earlier.id
        LEFT JOIN users u ON u.id = earlier.approver_user_id
        WHERE current.id = %s AND current.project_id = %s
          AND earlier.decision = 'APPROVED' AND earlier.execution_status = 'REFUSED'
          AND earlier.approver_user_id IS NOT NULL
          AND o.status = 'FAILED' AND o.error_code = 'live_email_disabled'
        ORDER BY earlier.decided_at DESC
        LIMIT 1
        """,
        (approval_id, project_id),
    ).fetchone()
    if row is None:
        return None
    return UUID(str(row[0])), str(row[1]), row[2]


def resend_request(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    mailbox: MailboxFactory = open_mailbox,
    timer: FollowUpTimer | None = None,
) -> OutboundBody:
    """Send again a request whose send was refused because email was off (decided by the
    product owner). The message must be exactly what was approved: a new approval is
    asked for it if none is open, and carried over from the earlier one, with its
    approver and date in the reason, then the message is sent. A changed message still
    needs another person's approval."""
    from ai_workforce_api.workspace import request_approvals

    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise OutboundState("a person sends this again")
    latest = request_approvals(connection, project_id).get(request_id)
    if latest is None:
        raise OutboundState("this request needs approval")
    approval_id = UUID(str(latest["approval_id"]))
    state = connection.execute(
        "SELECT decision, execution_status FROM approvals WHERE id = %s", (approval_id,)
    ).fetchone()
    if state is None:
        raise OutboundState("this request needs approval")
    if state[0] == "APPROVED" and state[1] == "REFUSED":
        # Its own send was refused: a new approval carries the same message over.
        pbc = _read_pbc(connection, organization_id, project_id, request_id)
        submitted = _submit(
            connection, settings, principal, organization_id, project_id, request_id,
            SubmitBody(version=pbc.version),
        )  # fmt: skip
        approval_id = submitted.approval.id
    elif state[0] != "PENDING":
        raise OutboundState("this request needs approval")
    source = carried_over_from(connection, project_id, approval_id)
    if source is None:
        raise OutboundState("this request needs approval")
    earlier, approver, decided = source
    with transaction(connection) as cursor:
        approve_own(
            cursor, organization_id, project_id, principal.id, approval_id,
            f"Carried over from approval {earlier} by {approver} on "
            f"{decided:%d %b %Y}: the same message, not sent then because email sending "
            "was off.",
        )  # fmt: skip
    return send_request(
        connection, settings, principal, organization_id, project_id, request_id,
        approval_id, mailbox, timer,
    )  # fmt: skip


def send_reminder(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    follow_up_id: UUID,
    approval_id: UUID,
    mailbox: MailboxFactory = open_mailbox,
) -> OutboundBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    return _send_once(
        connection,
        settings,
        principal,
        organization_id,
        project_id,
        approval_id,
        mailbox,
        lambda: _record_reminder(
            connection,
            settings,
            principal,
            organization_id,
            project_id,
            request_id,
            follow_up_id,
            approval_id,
        ),
        lambda current: (
            current.pbc_request_id == request_id and current.follow_up_id == follow_up_id
        ),
    )


def _send_once(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
    mailbox: MailboxFactory,
    record: Callable[[], OutboundBody | None],
    matches: Callable[[OutboundBody], bool],
) -> OutboundBody:
    """One approval owns one outbound record. A repeat call resumes or returns it."""
    current = _by_approval(connection, organization_id, project_id, approval_id)
    if current is None:
        # No mailbox to send through (live email is off): refuse before anything is
        # recorded, so the approval stands and the same message is sent once email is on
        # (decided by the product owner). A refusal recorded here could never be undone.
        if mailbox is open_mailbox and not mailbox_available(settings):
            raise OutboundState("live email is off")
        current = record()
        if current is not None:
            connection.commit()
            return _deliver(
                connection, settings, principal, organization_id, project_id, current, mailbox
            )
        current = _by_approval(connection, organization_id, project_id, approval_id)
        if current is None:
            raise NotVisible()
    if not matches(current):
        raise OutboundState("approval does not match")
    return _resume(connection, settings, principal, organization_id, project_id, current, mailbox)


def _record_reminder(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    follow_up_id: UUID,
    approval_id: UUID,
) -> OutboundBody | None:
    try:
        with transaction(connection) as cursor:
            pbc = _lock_pbc(cursor, organization_id, project_id, request_id)
            if not _remindable(connection, pbc):
                raise OutboundState("request is not open")
            follow_up = lock_follow_up(
                cursor, organization_id, project_id, request_id, follow_up_id
            )
            if follow_up.status != "APPROVAL_PENDING" or follow_up.approval_id != approval_id:
                raise OutboundState("reminder is not awaiting approval")
            message = _reminder(
                connection,
                pbc,
                _engagement(connection, organization_id, project_id),
                follow_up.id,
                follow_up.sequence,
            )
            if not recipients_allowed(settings, message):
                raise OutboundState("recipient is not allowed")
            digest = _lock_approval(cursor, organization_id, project_id, approval_id, message)
            _require_policy(connection, principal, organization_id, project_id, message)
            return _insert(
                cursor,
                organization_id,
                project_id,
                principal.id,
                request_id,
                approval_id,
                digest,
                message,
            )
    except UniqueViolation:
        return None


def _record(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    approval_id: UUID,
) -> OutboundBody | None:
    try:
        with transaction(connection) as cursor:
            pbc = _lock_pbc(cursor, organization_id, project_id, request_id)
            if pbc.status != "APPROVAL_PENDING":
                raise OutboundState("request is not awaiting approval")
            from ai_workforce_api.evidence_groups import in_live_group

            if in_live_group(connection, request_id):
                raise OutboundState("this request is sent with the request it was approved in")
            message = render(pbc, _engagement(connection, organization_id, project_id))
            if not recipients_allowed(settings, message):
                raise OutboundState("recipient is not allowed")
            _check(connection, settings, organization_id, project_id, request_id, _SEND_CHECKS)
            digest = _lock_approval(cursor, organization_id, project_id, approval_id, message)
            _require_policy(connection, principal, organization_id, project_id, message)
            return _insert(
                cursor,
                organization_id,
                project_id,
                principal.id,
                request_id,
                approval_id,
                _operation_key(cursor, project_id, approval_id, digest),
                message,
            )
    except UniqueViolation:
        return None


def _operation_key(
    cursor: psycopg.Cursor[Any], project_id: UUID, approval_id: UUID, digest: str
) -> str:
    """The same message is sent at most once: its key is its content. The one exception
    is a message whose earlier send was refused because email was off, so nothing went
    out: sent again on a carried-over approval, it takes a key of its own."""
    earlier = cursor.execute(
        "SELECT status, error_code FROM outbound_messages WHERE project_id = %s "
        "AND operation_key = %s",
        (project_id, digest),
    ).fetchone()
    if earlier is not None and earlier[0] == "FAILED" and earlier[1] == "live_email_disabled":
        return hashlib.sha256(f"{digest}:{approval_id}".encode()).hexdigest()
    return digest


def _insert(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    request_id: UUID,
    approval_id: UUID,
    digest: str,
    message: RenderedMessage,
) -> OutboundBody:
    row = cursor.execute(
        f"""
        INSERT INTO outbound_messages (
            organization_id, project_id, pbc_request_id, approval_id, actor_user_id,
            operation_key, template_id, template_version, recipient, subject,
            content_sha256, metadata, claimed_until
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            clock_timestamp() + make_interval(secs => %s)
        )
        RETURNING {_COLUMNS}
        """,
        (
            organization_id,
            project_id,
            request_id,
            approval_id,
            actor_id,
            digest,
            message.template.template_id,
            message.template.version,
            message.recipient,
            message.subject,
            message.content_sha256,
            Json({**message.metadata, **({"cc": list(message.cc)} if message.cc else {})}),
            CLAIM_SECONDS,
        ),
    ).fetchone()
    if row is None:
        raise NotVisible()
    recorded = _outbound(row)
    _audit(cursor, organization_id, project_id, actor_id, recorded, "outbound.recorded")
    return recorded


def _resume(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    current: OutboundBody,
    mailbox: MailboxFactory,
) -> OutboundBody:
    if current.status not in _OPEN:
        return current
    _require_policy(
        connection,
        principal,
        organization_id,
        project_id,
        _message_for(connection, organization_id, project_id, current),
    )
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE outbound_messages
            SET claimed_until = clock_timestamp() + make_interval(secs => %s),
                updated_at = clock_timestamp(),
                version = version + 1
            WHERE id = %s AND status IN ('PENDING', 'UNKNOWN')
              AND (claimed_until IS NULL OR claimed_until < clock_timestamp())
            RETURNING {_COLUMNS}
            """,
            (CLAIM_SECONDS, current.id),
        ).fetchone()
    if row is None:
        latest = _by_approval(connection, organization_id, project_id, current.approval_id)
        return current if latest is None else latest
    connection.commit()
    return _deliver(
        connection,
        settings,
        principal,
        organization_id,
        project_id,
        _outbound(row),
        mailbox,
        reconcile=True,
    )


def _deliver(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
    mailbox: MailboxFactory,
    *,
    reconcile: bool = False,
) -> OutboundBody:
    key = f"outbound:{outbound.id}"
    provider = mailbox(settings, connection, organization_id, project_id)
    attempts = outbound.attempt_count
    try:
        if reconcile:
            found = provider.lookup(key)
            if found is not None:
                return _finish(
                    connection, principal, organization_id, project_id, outbound, found, attempts
                )
            if _approval_expired(connection, outbound.approval_id):
                return _fail(
                    connection, principal, organization_id, project_id, outbound, "approval_expired"
                )
            attempts = min(attempts + 1, 10)
        message, code = _verified(connection, organization_id, project_id, outbound)
        if message is None:
            return _fail(connection, principal, organization_id, project_id, outbound, code)
        body = message.body
        if LINK_PLACEHOLDER in body:
            # The link is minted for this delivery; only its hash is kept.
            with transaction(connection) as cursor:
                token = mint_link(
                    cursor,
                    organization_id,
                    project_id,
                    message.recipient,
                    outbound.id,
                    principal.id if principal.kind is PrincipalKind.USER else None,
                )
            body = body.replace(LINK_PLACEHOLDER, link_url(settings, token))
        sent = provider.send(
            idempotency_key=key,
            recipient=message.recipient,
            subject=message.subject,
            body=body,
            thread_id=message.thread_id,
            metadata={**message.metadata, "outbound_id": str(outbound.id)},
            cc=message.cc,
        )
    except MailboxUnavailable:
        if reconcile:
            return _unknown(
                connection, principal, organization_id, project_id, outbound, "provider_error"
            )
        return _fail(
            connection, principal, organization_id, project_id, outbound, "live_email_disabled"
        )
    except MailboxState:
        return _fail(
            connection, principal, organization_id, project_id, outbound, "invalid_message"
        )
    except Exception as error:
        # The provider may have sent the message before this failure surfaced.
        logger.warning("outbound delivery outcome is unknown")
        code = "timeout" if isinstance(error, TimeoutError) else "provider_error"
        return _unknown(
            connection, principal, organization_id, project_id, outbound, code, attempts
        )
    return _finish(connection, principal, organization_id, project_id, outbound, sent, attempts)


def _finish(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
    message: MailMessage,
    attempts: int,
) -> OutboundBody:
    if message.status != "ACCEPTED":
        return _unknown(
            connection, principal, organization_id, project_id, outbound, "provider_error", attempts
        )
    with transaction(connection) as cursor:
        updated = _update(
            cursor,
            outbound,
            "ACCEPTED",
            "",
            attempts,
            message.provider_message_id,
            message.thread_id,
        )
        _settle(cursor, organization_id, project_id, principal.id, updated, "SUCCEEDED", None)
        if outbound.follow_up_id is not None:
            mark_sent(
                cursor,
                organization_id,
                project_id,
                principal.id,
                outbound.follow_up_id,
                outbound.id,
            )
        elif outbound.template_id == "pbc-group":
            from ai_workforce_api.evidence_groups import mark_sent as group_sent

            group_sent(
                cursor,
                organization_id,
                project_id,
                principal.id,
                updated,
                str(message.provider_message_id),
                str(message.thread_id),
            )
        else:
            row = cursor.execute(
                """
                UPDATE pbc_requests
                SET status = 'SENT', outbound_message_id = %s, thread_id = %s,
                    updated_at = clock_timestamp(), version = version + 1
                WHERE id = %s AND project_id = %s AND status = 'APPROVAL_PENDING'
                RETURNING id
                """,
                (
                    message.provider_message_id,
                    message.thread_id,
                    outbound.pbc_request_id,
                    project_id,
                ),
            ).fetchone()
            if row is not None:
                _pbc_audit(
                    cursor,
                    organization_id,
                    project_id,
                    principal.id,
                    outbound.pbc_request_id,
                    "SENT",
                )
        _audit(cursor, organization_id, project_id, principal.id, updated, "outbound.updated")
    return updated


def _fail(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
    code: str,
) -> OutboundBody:
    with transaction(connection) as cursor:
        updated = _update(cursor, outbound, "FAILED", code, outbound.attempt_count, None, None)
        reason = "live_email_disabled" if code == "live_email_disabled" else "not_available"
        _settle(cursor, organization_id, project_id, principal.id, updated, "REFUSED", reason)
        if outbound.template_id == "pbc-group":
            from ai_workforce_api.evidence_groups import mark_failed

            mark_failed(cursor, organization_id, project_id, principal.id, updated)
        if outbound.follow_up_id is not None:
            if code == "request_resolved":
                close_open(
                    cursor,
                    organization_id,
                    project_id,
                    principal.id,
                    outbound.follow_up_id,
                    "CANCELLED",
                    "request_resolved",
                    outbound.id,
                )
            else:
                close_open(
                    cursor,
                    organization_id,
                    project_id,
                    principal.id,
                    outbound.follow_up_id,
                    "FAILED",
                    "approval_expired" if code == "approval_expired" else "delivery_failed",
                    outbound.id,
                )
        _audit(cursor, organization_id, project_id, principal.id, updated, "outbound.updated")
    return updated


def _unknown(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
    code: str,
    attempts: int | None = None,
) -> OutboundBody:
    count = outbound.attempt_count if attempts is None else attempts
    with transaction(connection) as cursor:
        updated = _update(cursor, outbound, "UNKNOWN", code, count, None, None)
        _audit(cursor, organization_id, project_id, principal.id, updated, "outbound.updated")
    return updated


def _update(
    cursor: psycopg.Cursor[Any],
    outbound: OutboundBody,
    status: str,
    code: str,
    attempts: int,
    provider_message_id: str | None,
    thread_id: str | None,
) -> OutboundBody:
    row = cursor.execute(
        f"""
        UPDATE outbound_messages
        SET status = %s,
            error_code = %s,
            attempt_count = %s,
            provider_message_id = COALESCE(provider_message_id, %s),
            thread_id = COALESCE(thread_id, %s),
            claimed_until = NULL,
            updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND version = %s
        RETURNING {_COLUMNS}
        """,
        (status, code, attempts, provider_message_id, thread_id, outbound.id, outbound.version),
    ).fetchone()
    if row is None:
        raise OutboundState("outbound message changed")
    return _outbound(row)


def _settle(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    outbound: OutboundBody,
    status: str,
    reason: str | None,
) -> None:
    settle_approval(
        cursor,
        organization_id,
        project_id,
        actor_id,
        outbound.approval_id,
        status,
        reason,
        outbound.provider_message_id if status == "SUCCEEDED" else None,
    )


def settle_approval(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    approval_id: UUID,
    status: str,
    reason: str | None,
    result_ref: str | None,
) -> None:
    """Record what became of an approved action: executed, or refused. Once only."""
    cursor.execute(
        """
        UPDATE approvals
        SET execution_status = %s, version = version + 1
        WHERE id = %s AND decision = 'APPROVED' AND execution_status = 'NOT_STARTED'
        """,
        (status, approval_id),
    )
    cursor.execute(
        """
        INSERT INTO action_executions (
            organization_id, project_id, actor_user_id, approval_id, action_id,
            payload_hash, status, result_ref, reason
        )
        SELECT %s, %s, %s, id, action_id, payload_hash, %s, %s, %s
        FROM approvals
        WHERE id = %s
        ON CONFLICT DO NOTHING
        """,
        (
            organization_id,
            project_id,
            actor_id,
            status,
            result_ref,
            reason,
            approval_id,
        ),
    )


def _lock_approval(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
    message: RenderedMessage,
) -> str:
    row = cursor.execute(
        """
        SELECT action_id, payload_hash, requesting_agent_id, decision::text, execution_status,
               expires_at <= clock_timestamp()
        FROM approvals
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (approval_id, organization_id, project_id),
    ).fetchone()
    if row is None or not isinstance(row[1], str):
        raise NotVisible()
    agent_id = row[2] if isinstance(row[2], UUID) else None
    digest = payload_hash(
        organization_id, project_id, message.action_id, agent_id, message.parameters()
    )
    if row[0] != message.action_id or row[1] != digest:
        raise OutboundState("approval does not match")
    if row[5] is True:
        raise OutboundState("approval has expired")
    if row[3] != "APPROVED" or row[4] != "NOT_STARTED":
        raise OutboundState("approval is not approved")
    return digest


def _approval_expired(connection: psycopg.Connection[Any], approval_id: UUID) -> bool:
    row = connection.execute(
        "SELECT expires_at <= clock_timestamp() FROM approvals WHERE id = %s",
        (approval_id,),
    ).fetchone()
    return row is None or row[0] is True


def _require_policy(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    message: RenderedMessage,
) -> None:
    decision = evaluate(
        connection, principal, organization_id, project_id, message.action_id, message.parameters()
    )
    if decision.decision != "ALLOW":
        raise OutboundState("action is not allowed")


def _message_for(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
) -> RenderedMessage:
    from ai_workforce_api.evidence_groups import message_for

    pbc = _read_pbc(connection, organization_id, project_id, outbound.pbc_request_id)
    engagement = _engagement(connection, organization_id, project_id)
    if outbound.follow_up_id is None:
        if outbound.template_id == "pbc-group":
            return message_for(connection, organization_id, project_id, outbound)  # type: ignore[no-any-return]
        return render(pbc, engagement)
    follow_up = read_follow_up(
        connection, organization_id, project_id, outbound.pbc_request_id, outbound.follow_up_id
    )
    return _reminder(connection, pbc, engagement, follow_up.id, follow_up.sequence)


def _reminder(
    connection: psycopg.Connection[Any],
    pbc: PbcBody,
    engagement: str,
    follow_up_id: UUID,
    sequence: int,
) -> RenderedMessage:
    """A request's reminder; for a request sent in a group, the group's (its lead's)."""
    from ai_workforce_api.evidence_groups import reminder_for

    grouped = reminder_for(connection, pbc, engagement, follow_up_id, sequence)
    if grouped is not None:
        return grouped  # type: ignore[no-any-return]
    return render_reminder(pbc, engagement, follow_up_id, sequence)


def _remindable(connection: psycopg.Connection[Any], pbc: PbcBody) -> bool:
    from ai_workforce_api.evidence_groups import remindable

    return remindable(connection, pbc)


def _verified(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
) -> tuple[RenderedMessage | None, str]:
    """Re-render right before the provider call. A resolved request is never reminded."""
    if outbound.follow_up_id is not None:
        pbc = _read_pbc(connection, organization_id, project_id, outbound.pbc_request_id)
        follow_up = read_follow_up(
            connection, organization_id, project_id, outbound.pbc_request_id, outbound.follow_up_id
        )
        if not _remindable(connection, pbc) or follow_up.status != "APPROVAL_PENDING":
            return None, "request_resolved"
    try:
        message = _message_for(connection, organization_id, project_id, outbound)
    except ValueError:
        return None, "invalid_message"
    if message.content_sha256 != _content(connection, outbound.id):
        return None, "invalid_message"
    return message, ""


def _content(connection: psycopg.Connection[Any], outbound_id: UUID) -> str:
    row = connection.execute(
        "SELECT content_sha256 FROM outbound_messages WHERE id = %s", (outbound_id,)
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    return row[0]


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[OutboundBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM outbound_messages
        WHERE organization_id = %s AND project_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 200
        """,
        (organization_id, project_id),
    ).fetchall()
    return [_outbound(row) for row in rows]


def _by_approval(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
) -> OutboundBody | None:
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM outbound_messages
        WHERE organization_id = %s AND project_id = %s AND approval_id = %s
        """,
        (organization_id, project_id, approval_id),
    ).fetchone()
    return None if row is None else _outbound(row)


def _read_pbc(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, request_id: UUID
) -> PbcBody:
    row = connection.execute(
        f"""
        SELECT {_PBC_COLUMNS}
        FROM pbc_requests
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (request_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _pbc_body(row)


def _engagement(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> str:
    row = connection.execute(
        "SELECT name FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    return row[0]


def _preview_body(settings: Settings, message: RenderedMessage) -> OutboundPreview:
    return OutboundPreview(
        template_id=message.template.template_id,
        template_version=message.template.version,
        reference=message.reference,
        recipient=message.recipient,
        recipient_allowed=recipients_allowed(settings, message),
        subject=message.subject,
        body=message.body,
        parameters=message.parameters(),
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    outbound: OutboundBody,
    action: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'outbound_message', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor_id,
            action,
            outbound.id,
            Json(
                {
                    "status": outbound.status,
                    "error_code": outbound.error_code,
                    "template": f"{outbound.template_id}.v{outbound.template_version}",
                }
            ),
        ),
    )


def _outbound(row: tuple[Any, ...]) -> OutboundBody:
    if not isinstance(row[0], UUID) or not isinstance(row[7], str):
        raise NotVisible()
    metadata = row[12] if isinstance(row[12], dict) else {}
    follow_up = metadata.get("follow_up_id")
    return OutboundBody(
        id=row[0],
        pbc_request_id=row[1],
        approval_id=row[2],
        kind="reminder" if row[3] in _REMINDER_TEMPLATES else "request",
        follow_up_id=UUID(follow_up) if isinstance(follow_up, str) else None,
        template_id=str(row[3]),
        template_version=int(row[4]),
        recipient=str(row[5]),
        subject=str(row[6]),
        reference=str(metadata.get("request_reference", "")),
        cc=[str(item) for item in metadata.get("cc", []) if isinstance(item, str)],
        status=row[7],
        delivery_confirmed=row[7] == "DELIVERED",
        provider_message_id=row[8] if isinstance(row[8], str) else None,
        thread_id=row[9] if isinstance(row[9], str) else None,
        error_code=str(row[10]),
        attempt_count=int(row[11]),
        created_at=row[13],
        updated_at=row[14],
        version=int(row[15]),
    )
