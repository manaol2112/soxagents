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
    AccessDenied,
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
from ai_workforce_api.request_email import (
    Facts,
    control_line,
    one_name,
    tidy,
    values_for_request,
)
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
# Version 3 (the approved redesign, product owner, 12 November 2026): the subject names
# the control, its items and its due date, with the reference replies are matched on; the
# owner is greeted by name when a record holds it; the facts, then WHAT WE NEED with every
# item under labels an owner understands, then HOW TO SEND IT, and a signature
# (request_email.py composes the parts). A message approved on version 2 is still sent
# on version 2: the send renders it again on the version its approval records
# (approved_template), never on a newer one.
PBC_REQUEST_V3 = MessageTemplate(
    template_id="pbc-request",
    version=3,
    subject="$subject_line",
    body=(
        "$greeting\n\n"
        "$opening"
        "$facts\n\n"
        "WHAT WE NEED\n\n"
        "$items\n\n"
        "HOW TO SEND IT\n\n"
        "Open your secure upload page:\n"
        "$upload_link\n"
        "Enter the one-time code we email to this address, then upload each file against "
        "its item. Please do not send evidence as email attachments.\n\n"
        "Thank you,\n"
        "The $team\n\n"
        "Questions? Reply to this email and keep $reference in the subject."
    ),
)
PBC_REMINDER_V3 = MessageTemplate(
    template_id="pbc-reminder",
    version=3,
    subject="Reminder: $subject_line",
    body=(
        "$greeting\n\n"
        "This is reminder $sequence of $limit for the evidence the $team asked for. If "
        "you have already uploaded it, thank you, and you can ignore this reminder.\n\n"
        "$opening"
        "$facts\n\n"
        "WHAT WE NEED\n\n"
        "$items\n\n"
        "HOW TO SEND IT\n\n"
        "Open your secure upload page:\n"
        "$upload_link\n"
        "Enter the one-time code we email to this address, then upload each file against "
        "its item. Please do not send evidence as email attachments.\n\n"
        "Thank you,\n"
        "The $team\n\n"
        "Questions? Reply to this email and keep $reference in the subject."
    ),
)
TEMPLATES: tuple[MessageTemplate, ...] = (
    PBC_REQUEST,
    PBC_REMINDER,
    PBC_REQUEST_V3,
    PBC_REMINDER_V3,
)
_BY_VERSION: dict[tuple[str, int], MessageTemplate] = {
    (t.template_id, t.version): t for t in TEMPLATES
}
# What a new message is rendered on.
CURRENT_REQUEST = PBC_REQUEST_V3
CURRENT_REMINDER = PBC_REMINDER_V3
# The template an approval binds, from its request reference ("pbc/{request}/{template}-
# v{version}/..."), which the approval's payload hash covers.
_APPROVED_REF = re.compile(r"^pbc/[0-9a-f-]{36}/([a-z][a-z0-9-]{0,40}?)-v(\d{1,4})/")


def template_for(template_id: str, version: int | None) -> MessageTemplate:
    """The template of this id at this version, or the current one for None. A version
    no template has is refused (ValueError): the send then refuses the message."""
    if version is None:
        return CURRENT_REMINDER if template_id == PBC_REMINDER.template_id else CURRENT_REQUEST
    found = _BY_VERSION.get((template_id, version))
    if found is None:
        raise ValueError("unknown template version")
    return found


def approved_template(
    connection: psycopg.Connection[Any], approval_id: UUID
) -> tuple[str, int] | None:
    """The template id and version an approval was asked on, from its request reference;
    None when it names none."""
    row = connection.execute(
        "SELECT parameters ->> 'request_ref' FROM approvals WHERE id = %s", (approval_id,)
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        return None
    match = _APPROVED_REF.match(row[0])
    if match is None:
        return None
    found = match.group(1), int(match.group(2))
    # A version no template has is rendered on the current one, which then does not match
    # the approval: the send is refused as not matching, never sent on other wording.
    return found if found in _RENDERABLE else None


# Every template version a message can still be rendered on: the single request's and
# reminder's (here), and a group's and its reminder's (evidence_groups._templates).
_RENDERABLE = frozenset(
    {
        *_BY_VERSION,
        ("pbc-group", 1),
        ("pbc-group", 2),
        ("pbc-group-reminder", 1),
        ("pbc-group-reminder", 2),
    }
)


def approved_version(
    connection: psycopg.Connection[Any], approval_id: UUID, template_id: str
) -> int | None:
    """The version of this template an approval binds; None (the current version) when
    it binds another template, whose message then does not match the approval."""
    found = approved_template(connection, approval_id)
    return found[1] if found is not None and found[0] == template_id else None


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
    # Whether a message can be sent now (email_on). False: an approval records a hand-over
    # (request.delivery says HANDED_OVER) and nothing is sent.
    live_email: bool = False
    # An approval while email is off: whether it recorded the hand-over, and the sentence
    # that says which (HANDED_OVER or NOT_HANDED_OVER). Empty with email on, and on a
    # submit: nothing was approved for sending yet, or it waits to be sent.
    handed_over: bool = False
    notice: str = ""


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
            lambda connection: _stamped(
                settings,
                mailbox,
                _submit(
                    connection, settings, principal, organization_id, project_id, request_id, body
                ),
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
            lambda connection: _stamped(
                settings,
                mailbox,
                _approve_draft(
                    connection,
                    settings,
                    principal,
                    organization_id,
                    project_id,
                    request_id,
                    body,
                    mailbox,
                ),
            ),  # fmt: skip
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
                handover=True,
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


def email_on(settings: Settings, mailbox: MailboxFactory = open_mailbox) -> bool:
    """Whether a message can be sent now: the rule the send itself refuses on
    (_send_once). The configured mailbox sends (live email with every condition met, or
    the mock mailbox of development and tests), or the caller brought its own."""
    return mailbox is not open_mailbox or mailbox_available(settings)


def _stamped(settings: Settings, mailbox: MailboxFactory, result: SubmitResult) -> SubmitResult:
    """The answer of a submit or an approval says whether email is on, on the result and
    on its request."""
    on = email_on(settings, mailbox)
    return result.model_copy(
        update={"live_email": on, "request": result.request.model_copy(update={"live_email": on})}
    )


def render(
    request: PbcBody,
    engagement: str,
    facts: Facts | None = None,
    *,
    version: int | None = None,
) -> RenderedMessage:
    """The request's message on a template version: the current one for a new approval,
    the approved one for a send (approved_template). Deterministic: the send renders it
    again and refuses anything but the approved content. Version 2 reads no facts."""
    template = template_for(PBC_REQUEST.template_id, version)
    reference, subject, body = _compose(template, request, engagement, {}, facts)
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


def render_request(
    connection: psycopg.Connection[Any],
    request: PbcBody,
    engagement: str,
    *,
    version: int | None = None,
    approval_id: UUID | None = None,
    proposed: dict[str, str] | None = None,
) -> RenderedMessage:
    """render, with the request's facts. For an approval (`approval_id`: its send, a
    resumed send, its hand-over, its preview while it awaits the send), the facts kept
    with it when it was asked (approved_facts), so a contact or a control's name changed
    since never changes or blocks the approved message. Otherwise the facts its records
    hold now, with `proposed` names for addresses not saved yet (a review before send)."""
    facts = approved_facts(connection, approval_id).get(request.id) if approval_id else None
    if facts is None:
        facts = request_facts(connection, request, proposed)
    return render(request, engagement, facts, version=version)


def approved_facts(connection: psycopg.Connection[Any], approval_id: UUID) -> dict[UUID, Facts]:
    """The facts an approval's message was rendered with, by request (migration 0157);
    empty for an approval that keeps none (asked before version 3)."""
    row = connection.execute(
        "SELECT facts FROM approved_message_facts WHERE approval_id = %s", (approval_id,)
    ).fetchone()
    if row is None or not isinstance(row[0], dict):
        return {}
    return {UUID(str(key)): Facts.from_json(value) for key, value in row[0].items()}


def keep_facts(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    approval_id: UUID,
    facts: dict[UUID, Facts],
) -> None:
    """Keep, with the approval just asked, the facts its message was rendered with.
    Written once; never changed (the table refuses it)."""
    cursor.execute(
        """
        INSERT INTO approved_message_facts (approval_id, organization_id, project_id, facts)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (approval_id) DO NOTHING
        """,
        (
            approval_id,
            organization_id,
            project_id,
            Json({str(key): value.as_json() for key, value in facts.items()}),
        ),
    )


def _copied(request: PbcBody) -> tuple[str, ...]:
    return tuple(item.strip().lower() for item in request.cc_recipients if item.strip())


def _digest(recipient: str, cc: tuple[str, ...], subject: str, body: str) -> str:
    # A request with nobody copied keeps the digest it had before copies existed.
    copied = f"\ncc:{','.join(cc)}" if cc else ""
    return hashlib.sha256(f"{recipient}{copied}\n{subject}\n{body}".encode()).hexdigest()


def render_reminder(
    request: PbcBody,
    engagement: str,
    follow_up_id: UUID,
    sequence: int,
    facts: Facts | None = None,
    *,
    version: int | None = None,
) -> RenderedMessage:
    """Reminders reply in the request's thread so the recipient sees one conversation."""
    if request.thread_id is None:
        raise ValueError("request has no thread")
    template = template_for(PBC_REMINDER.template_id, version)
    reference, subject, body = _compose(
        template,
        request,
        engagement,
        {"sequence": str(sequence), "limit": str(max(sequence, request.max_follow_ups))},
        facts,
    )
    recipient = request.recipient.strip()
    cc = _copied(request)
    digest = _digest(recipient, cc, subject, body)
    tag = f"{template.template_id}-v{template.version}"
    return RenderedMessage(
        template=template,
        recipient=recipient,
        subject=subject,
        body=body,
        reference=reference,
        content_sha256=digest,
        request_ref=f"pbc/{request.id}/{tag}/{follow_up_id}/{digest[:16]}",
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
    template: MessageTemplate,
    request: PbcBody,
    engagement: str,
    extra: dict[str, str],
    facts: Facts | None = None,
) -> tuple[str, str, str]:
    if template.version >= 3:
        return _compose_v3(template, request, engagement, extra, facts or Facts())
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


def _compose_v3(
    template: MessageTemplate,
    request: PbcBody,
    engagement: str,
    extra: dict[str, str],
    facts: Facts,
) -> tuple[str, str, str]:
    """Version 3's text (request_email.py), within the same limits as before: the body
    with room for the link within 4,000 characters, else every item in brief with the
    note that the full wording is on the secure link."""
    reference = f"PBC-{request.id.hex[-8:].upper()}"

    def text(brief: bool) -> tuple[str, str]:
        values = values_for_request(
            reference=reference,
            control_ref=request.control_ref,
            phase=request.testing_phase,
            due=request.due_at,
            description=request.evidence_description,
            engagement=engagement,
            facts=facts,
            brief=brief,
            note=SUMMARY_NOTE,
        )
        values.update({"upload_link": LINK_PLACEHOLDER, **extra})
        return (
            Template(template.subject).substitute(values),
            tidy(Template(template.body).substitute(values)),
        )

    subject, body = text(False)
    room = 200
    if len(body) > 4000 - room:
        subject, body = text(True)
    if len(subject) > 200 or len(body) > 4000 - room:
        raise ValueError("message is too long")
    return reference, subject, body


def request_facts(
    connection: psycopg.Connection[Any],
    request: PbcBody,
    proposed: dict[str, str] | None = None,
) -> Facts:
    """What the email names besides the wording, as the records hold it now: the
    control's name, a line describing it, its system, and the recipient's name when a
    record holds one person's. Read when a message is rendered for a new approval, and
    kept with that approval (keep_facts)."""
    title = frequency = system = ""
    if request.engagement_control_id is not None:
        row = connection.execute(
            "SELECT c.title, c.frequency, coalesce(a.name, '') FROM engagement_controls c "
            "LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id "
            "WHERE c.id = %s AND c.project_id = %s",
            (request.engagement_control_id, request.project_id),
        ).fetchone()
        if row is not None:
            title, frequency, system = (" ".join(str(x or "").split()) for x in row)
    return Facts(
        control_title=title[:160],
        control_line=control_line(title, frequency, system),
        system=system[:120],
        recipient_name=recipient_name(
            connection,
            request.project_id,
            request.recipient,
            request.engagement_control_id,
            proposed,
        ),
    )


def recipient_name(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    recipient: str,
    control_id: UUID | None,
    proposed: dict[str, str] | None = None,
) -> str:
    """The recipient's name as the records hold it: the request's control owner, a client
    contact of the engagement, its evidence coordinator, or the owner of another of its
    controls, at that address (whatever its capitals). Empty when none does, when a name
    is not a person's, or when the address is held under more than one name (a shared
    mailbox): never made up from the address. `proposed` names an address whose owner is
    about to be saved on the request's control, in place of the one saved there now."""
    address = recipient.strip().lower()
    if not address:
        return ""
    rows = connection.execute(
        """
        SELECT rank, name FROM (
            SELECT 1 AS rank, owner_name AS name FROM engagement_controls
            WHERE id = %s AND project_id = %s AND lower(btrim(owner_email)) = %s
            UNION ALL
            SELECT 2, name FROM engagement_contacts
            WHERE project_id = %s AND lower(btrim(email)) = %s
            UNION ALL
            SELECT 3, client_coordinator_name FROM engagement_settings
            WHERE project_id = %s AND lower(btrim(client_coordinator_email)) = %s
            UNION ALL
            SELECT 4, owner_name FROM engagement_controls
            WHERE project_id = %s AND included AND lower(btrim(owner_email)) = %s
              AND id IS DISTINCT FROM %s
        ) named
        WHERE btrim(coalesce(name, '')) <> ''
        ORDER BY rank, name
        """,
        (control_id, project_id, address, project_id, address, project_id, address,
         project_id, address, control_id),
    ).fetchall()  # fmt: skip
    names = [str(row[1]) for row in rows]
    given = {key.strip().lower(): value for key, value in (proposed or {}).items()}
    if address in given:
        names = [given[address], *(str(row[1]) for row in rows if row[0] != 1)]
    return one_name(names)


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
    # A request awaiting its send is shown as its approval binds it, on the version it
    # was approved on; any other, as a new approval would render it.
    version = latest = None
    if pbc.status == "APPROVAL_PENDING":
        latest = _latest_approval(connection, organization_id, project_id, request_id)
        if latest is not None:
            version = approved_version(connection, latest, PBC_REQUEST.template_id)
    return _preview_body(
        settings,
        render_request(
            connection, pbc, _engagement(connection, organization_id, project_id),
            version=version, approval_id=latest,
        ),
    )  # fmt: skip


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
    *,
    template_version: int | None = None,
    carried_from: UUID | None = None,
) -> SubmitResult:
    """Ask for the approval of the request's message, on the current template version
    with the facts its records hold now; or, for a message carried over from an earlier
    approval (`carried_from`), on that approval's version with the facts kept with it."""
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
    _settle_in_hand(connection, principal, organization_id, project_id, request_id)
    from ai_workforce_api.evidence_plans import held_for_planning

    held = held_for_planning(connection, request_id) if pbc.status == "DRAFT" else None
    if held is not None:
        raise OutboundState(held)
    if pbc.recipient.strip() == "":
        # Drafted with no owner email and no evidence coordinator to address it to.
        raise OutboundState("set who the request goes to first")
    facts = approved_facts(connection, carried_from).get(pbc.id) if carried_from else None
    if facts is None:
        facts = request_facts(connection, pbc)
    message = render(
        pbc, _engagement(connection, organization_id, project_id), facts,
        version=template_version,
    )  # fmt: skip
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
    with transaction(connection) as cursor:
        keep_facts(cursor, organization_id, project_id, approval.id, {pbc.id: facts})
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
    mailbox: MailboxFactory = open_mailbox,
) -> SubmitResult:
    """The reviewer approves a request the agent drafted, as it stands: the evidence
    coordinator asked, the reviewer approves. It then waits to be sent. A request a person
    wrote is submitted for someone else to approve instead.

    With email off nothing can be sent, so the approval records the hand-over (hand_over;
    product owner, 12 November 2026): the approver is on record as having handed the
    request over, as approved, and the answer says so (request.delivery)."""
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
    _settle_in_hand(connection, principal, organization_id, project_id, request_id)
    from ai_workforce_api.evidence_plans import held_for_planning

    held = held_for_planning(connection, request_id)
    if held is not None:
        raise OutboundState(held)
    if pbc.recipient.strip() == "":
        raise OutboundState("set who the request goes to first")
    facts = request_facts(connection, pbc)
    message = render(pbc, _engagement(connection, organization_id, project_id), facts)
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
        keep_facts(cursor, organization_id, project_id, asked.id, {pbc.id: facts})
        approve_agent_request(cursor, organization_id, project_id, principal.id, asked.id, reason)
        _pbc_audit(
            cursor, organization_id, project_id, principal.id, request_id, "APPROVAL_PENDING"
        )
    approval = _load(connection, organization_id, project_id, asked.id)
    if approval is None:
        raise NotVisible()
    approved = _pbc_body(row)
    handed, notice = False, ""
    if not email_on(settings, mailbox):
        handed = hand_over(
            connection, settings, principal, organization_id, project_id, request_id, asked.id
        )
        notice = HANDED_OVER if handed else NOT_HANDED_OVER
        if handed:
            approved = _read_pbc(connection, organization_id, project_id, request_id)
    return SubmitResult(
        request=approved,
        approval=approval,
        preview=_preview_body(settings, message),
        handed_over=handed,
        notice=notice,
    )


HANDED_OVER = "Approved and handed over: email sending is off, so nothing was sent."
# Email is off and the person who approved may not send this request, or a send of it
# would be refused: the approval stands and nothing says the request left.
NOT_HANDED_OVER = (
    "Approved. Not handed over: email sending is off, and a send of this request would be "
    "refused, so nothing is recorded as handed over."
)


IN_HAND_CHANGED = (
    "Evidence for part of this request is already in hand, so the request was updated to "
    "ask only for the rest. Review it again before approving."
)
IN_HAND_ALL = (
    "Evidence for every item of this request is already in hand, so nothing needs sending."
)


def _settle_in_hand(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
) -> None:
    """Before a request goes for approval: an item whose evidence is already in hand is
    not asked for (evidence_receipts.settle_in_hand). When that changes what the request
    asks, the change is kept and the approval is refused with why: a person approves the
    wording that goes out, so they read it again first. When every item is in hand the
    request is received as provided directly, and there is nothing to approve."""
    from ai_workforce_api.evidence_receipts import settle_in_hand

    with transaction(connection) as cursor:
        changed = settle_in_hand(cursor, organization_id, project_id, request_id, principal.id)
    if changed is not None:
        connection.commit()
        raise OutboundState(IN_HAND_CHANGED if changed == "SPLIT" else IN_HAND_ALL)


def hand_over(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    approval_id: UUID,
) -> bool:
    """Record that an approved request was handed over, because email is off and nothing
    can be sent (product owner, 12 November 2026: email off means handed over, on the
    record). Who and when are kept on the request and on the audit trail, with the person
    as the actor; never an agent. Returns whether this call recorded it.

    Held to everything a send is held to (send_request and _record), except the mailbox:
    the person may send (the right to update the engagement's work, and the action policy
    for sending a request, with its restrictions), the request awaits its send, it does
    not travel in a group, its recipients are allowed, its send checks pass, and the
    approval is approved, not used, not expired, and is the approval of the message as it
    now reads (_lock_approval: a wording changed after the approval is not handed over on
    it). Where a send would be refused, nothing is recorded. The approval is left as it
    stands, so the same message can still be emailed once email is on; nothing here says
    it was sent."""
    if principal.kind is not PrincipalKind.USER:
        return False
    from ai_workforce_api.evidence_groups import in_live_group

    try:
        authorize(
            connection,
            principal=principal,
            action=Action.TASK_UPDATE,
            organization_id=organization_id,
            project_id=project_id,
        )
        with transaction(connection) as cursor:
            pbc = _lock_pbc(cursor, organization_id, project_id, request_id)
            if pbc.status != "APPROVAL_PENDING" or in_live_group(connection, request_id):
                return False
            message = render_request(
                connection, pbc, _engagement(connection, organization_id, project_id),
                version=approved_version(connection, approval_id, PBC_REQUEST.template_id),
                approval_id=approval_id,
            )  # fmt: skip
            if not recipients_allowed(settings, message):
                return False
            _check(connection, settings, organization_id, project_id, request_id, _SEND_CHECKS)
            _lock_approval(cursor, organization_id, project_id, approval_id, message)
            _require_policy(connection, principal, organization_id, project_id, message)
            row = cursor.execute(
                """
                UPDATE pbc_requests
                SET handed_over_at = clock_timestamp(), handed_over_by = %s,
                    handed_over_approval_id = %s, updated_at = clock_timestamp(),
                    version = version + 1
                WHERE id = %s AND project_id = %s AND status = 'APPROVAL_PENDING'
                  AND handed_over_approval_id IS DISTINCT FROM %s
                RETURNING id
                """,
                (principal.id, approval_id, request_id, project_id, approval_id),
            ).fetchone()
            if row is None:
                return False
            cursor.execute(
                """
                INSERT INTO audit_events (
                    organization_id, project_id, actor_user_id, action, target_type,
                    target_id, payload
                )
                VALUES (%s, %s, %s, 'pbc.handed_over', 'pbc_request', %s, %s)
                """,
                (
                    organization_id,
                    project_id,
                    principal.id,
                    request_id,
                    Json(
                        {
                            "approval_id": str(approval_id),
                            "content_sha256": message.content_sha256,
                            "reason": "live email is off",
                        }
                    ),
                ),
            )
            return True
    except OutboundState, NotVisible, AccessDenied, ValueError:
        return False


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
    *,
    handover: bool = False,
) -> OutboundBody:
    """Commit the outbound record before the provider is called.

    `handover` (the send route): with email off the send is refused as before, and the
    approved request is first recorded as handed over by the person sending it
    (hand_over), which is kept though the send is refused."""
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if _by_approval(connection, organization_id, project_id, approval_id) is None:
        # Nothing is recorded for this approval yet. Evidence that came in hand since the
        # approval (a file linked, or one whose reading has not ended) is applied first,
        # as at the approval: the send is then refused, and the shorter wording is
        # approved again.
        _settle_in_hand(connection, principal, organization_id, project_id, request_id)
        if (
            handover
            and not email_on(settings, mailbox)
            and hand_over(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                request_id,
                approval_id,
            )
        ):
            connection.commit()
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
    facts = reminder_facts(connection, pbc)
    message = _reminder(
        connection,
        pbc,
        _engagement(connection, organization_id, project_id),
        follow_up.id,
        follow_up.sequence,
        None,
        facts,
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
    with transaction(connection) as cursor:
        keep_facts(cursor, organization_id, project_id, approval.id, facts)
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
        # Its own send was refused: a new approval carries the same message over, on the
        # template version the refused approval was asked on.
        pbc = _read_pbc(connection, organization_id, project_id, request_id)
        submitted = _submit(
            connection, settings, principal, organization_id, project_id, request_id,
            SubmitBody(version=pbc.version),
            template_version=approved_version(connection, approval_id, PBC_REQUEST.template_id),
            carried_from=approval_id,
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
                approved_template(connection, approval_id),
                approved_facts(connection, approval_id) or None,
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
            # On the version the approval was asked on: a message approved before a newer
            # template still goes out exactly as approved.
            message = render_request(
                connection, pbc, _engagement(connection, organization_id, project_id),
                version=approved_version(connection, approval_id, PBC_REQUEST.template_id),
                approval_id=approval_id,
            )  # fmt: skip
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
    try:
        again = _message_for(connection, organization_id, project_id, current)
    except ValueError:
        # Recorded on a template version nothing renders any more, or no longer fitting
        # one email: it cannot be checked against what was approved, so it is not sent.
        return _fail(connection, principal, organization_id, project_id, current, "invalid_message")
    _require_policy(connection, principal, organization_id, project_id, again)
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
        # On the version the message was recorded with, which its approval bound.
        if outbound.template_id != PBC_REQUEST.template_id:
            raise ValueError("unknown template")
        return render_request(
            connection, pbc, engagement, version=outbound.template_version,
            approval_id=outbound.approval_id,
        )  # fmt: skip
    follow_up = read_follow_up(
        connection, organization_id, project_id, outbound.pbc_request_id, outbound.follow_up_id
    )
    return _reminder(
        connection, pbc, engagement, follow_up.id, follow_up.sequence,
        (outbound.template_id, outbound.template_version),
        approved_facts(connection, outbound.approval_id) or None,
    )  # fmt: skip


def _reminder(
    connection: psycopg.Connection[Any],
    pbc: PbcBody,
    engagement: str,
    follow_up_id: UUID,
    sequence: int,
    approved: tuple[str, int] | None = None,
    facts: dict[UUID, Facts] | None = None,
) -> RenderedMessage:
    """A request's reminder; for a request sent in a group, the group's (its lead's). On
    the template version `approved` names (the approval's or the recorded message's), or
    the current one for a new reminder; with the `facts` kept with its approval, or those
    its records hold now for a new reminder (reminder_facts)."""
    from ai_workforce_api.evidence_groups import GROUP_REMINDER_TEMPLATE_ID, reminder_for

    def version(template_id: str) -> int | None:
        if approved is None:
            return None
        # Approved as the other kind of reminder: rendered on the current version, it does
        # not match, and the send is refused.
        return approved[1] if approved[0] == template_id else None

    grouped = reminder_for(
        connection, pbc, engagement, follow_up_id, sequence,
        version=lambda: version(GROUP_REMINDER_TEMPLATE_ID), frozen=facts,
    )  # fmt: skip
    if grouped is not None:
        return grouped  # type: ignore[no-any-return]
    own = (facts or {}).get(pbc.id)
    return render_reminder(
        pbc, engagement, follow_up_id, sequence,
        own if own is not None else request_facts(connection, pbc),
        version=version(PBC_REMINDER.template_id),
    )  # fmt: skip


def reminder_facts(connection: psycopg.Connection[Any], pbc: PbcBody) -> dict[UUID, Facts]:
    """The facts a new reminder is rendered with, as the records hold them now: the
    request's, or, for a sent group's lead, those of each request still open in it."""
    from ai_workforce_api.evidence_groups import open_members, sent_group_of

    group = sent_group_of(connection, pbc.id)
    members = [pbc] if group is None else open_members(connection, group)
    return {member.id: request_facts(connection, member) for member in members}


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
    elif outbound.template_id != "pbc-group" and not _still_to_send(
        connection, organization_id, project_id, outbound
    ):
        # A request goes out only while it still awaits this send: not once evidence came
        # directly (received), it went back to draft, or another approval took over. Bug
        # hunt, 9 November 2026: a send resumed after an unknown outcome delivered a
        # request already received.
        return None, "request_resolved"
    try:
        message = _message_for(connection, organization_id, project_id, outbound)
    except ValueError:
        return None, "invalid_message"
    if message.content_sha256 != _content(connection, outbound.id):
        return None, "invalid_message"
    return message, ""


def _still_to_send(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    outbound: OutboundBody,
) -> bool:
    """Whether the request still awaits this send: it is awaiting approval, and the
    outbound's approval is its latest send approval, approved and not yet executed."""
    pbc = _read_pbc(connection, organization_id, project_id, outbound.pbc_request_id)
    if pbc.status != "APPROVAL_PENDING":
        return False
    row = connection.execute(
        """
        SELECT id, decision::text, execution_status FROM approvals
        WHERE organization_id = %s AND project_id = %s AND action_id = %s
          AND parameters ->> 'request_ref' LIKE %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (organization_id, project_id, ACTION_ID, f"pbc/{outbound.pbc_request_id}/%"),
    ).fetchone()
    return (
        row is not None
        and row[0] == outbound.approval_id
        and row[1] == "APPROVED"
        and row[2] == "NOT_STARTED"
    )


def _latest_approval(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, request_id: UUID
) -> UUID | None:
    """The request's latest send approval, if any."""
    row = connection.execute(
        """
        SELECT id FROM approvals
        WHERE organization_id = %s AND project_id = %s AND action_id = %s
          AND parameters ->> 'request_ref' LIKE %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (organization_id, project_id, ACTION_ID, f"pbc/{request_id}/%"),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


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
