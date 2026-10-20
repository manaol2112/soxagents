"""Evidence request details (migration 0075): the request's type, title, priority, who it
goes to and who is copied, the reference material attached to it, and the checks that
must pass before it is approved or sent.

A request's type is worked out from its records (the evidence plan's requirement
categories, the evidence coordinator's draft items, its phase, and the control's area)
until a person confirms it. A classification the records do not settle is shown as a
recommendation for the auditor to confirm before the agent's draft is approved.

The client-facing wording stays in evidence_description; this module reads its numbered
structure back for the checklist the page shows. Internal material (why each item is
asked for, the drafter's assumptions) is returned separately and never reaches the email
or the owner's portal.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Request, Response
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
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
from ai_workforce_api.evidence import MAX_BYTES, StoreFactory, _filename, preview_type
from ai_workforce_api.evidence_intake import clean_name, clean_type
from ai_workforce_api.pbc import _COLUMNS as _PBC_COLUMNS
from ai_workforce_api.pbc import PbcBody, PbcState
from ai_workforce_api.pbc import _body as _pbc_body
from ai_workforce_api.portal_workspace import (
    ClientBody,
    MessageBody,
    WorkspaceState,
    client_record,
    mark_seen,
    post_team_message,
)
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import StoreError, digest_of, open_store

RequestType = Literal[
    "POPULATION",
    "SAMPLE_EVIDENCE",
    "SAMPLE_OF_ONE",
    "CONFIGURATION",
    "POLICY_PROCEDURE",
    "PROCESS_NARRATIVE",
    "SYSTEM_REPORT",
    "ACCESS_LISTING",
    "RECONCILIATION",
    "APPROVAL_EVIDENCE",
    "EXCEPTION_EVIDENCE",
    "OTHER",
]
Priority = Literal["NORMAL", "HIGH", "URGENT"]
Basis = Literal["RULES", "AGENT", "PERSON"]
ContactSource = Literal["OWNER", "COORDINATOR", "CONTACT", "RECIPIENT"]
Visibility = Literal["INTERNAL", "SHARED"]

MAX_COPIED = 10
MAX_ATTACHMENTS = 20
# The statuses whose recipients, copies, due date, and priority can still change: nothing
# has been sent. An approved request returns to draft when they change.
_UNSENT = frozenset({"DRAFT", "APPROVAL_PENDING"})
_CLOSED = frozenset({"CANCELLED", "CLOSED"})
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_PREVIEWABLE = frozenset({"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"})

# A requirement category, as the request type it asks for. A population of user access is
# an access listing; execution evidence for a design walkthrough is a sample of one.
_CATEGORY_TYPES: dict[str, RequestType] = {
    "POPULATION": "POPULATION",
    "SAMPLE": "SAMPLE_EVIDENCE",
    "CONFIGURATION": "CONFIGURATION",
    "CHANGE_HISTORY": "CONFIGURATION",
    "PROCESS_DOCUMENTATION": "PROCESS_NARRATIVE",
    "CONTROL_EXECUTION": "SAMPLE_EVIDENCE",
    "REPORT_RELIABILITY": "SYSTEM_REPORT",
    "OTHER": "OTHER",
}
# A drafted item's kind (pbc_drafting.KINDS), as a request type.
_KIND_TYPES: dict[str, RequestType] = {
    "population": "POPULATION",
    "walkthrough": "SAMPLE_OF_ONE",
    "design": "PROCESS_NARRATIVE",
    "configuration": "CONFIGURATION",
    "change_history": "CONFIGURATION",
    "report": "SYSTEM_REPORT",
    "policy": "POLICY_PROCEDURE",
    "other": "OTHER",
}
# For wording no plan or draft explains: a recommendation only, never settled.
_KEYWORDS: tuple[tuple[re.Pattern[str], RequestType], ...] = (
    (
        re.compile(
            r"(?i)\buser (?:access )?list|\baccess list|\bpermissions? list"
            r"|\busers? and roles\b|\broles? and users?\b"
        ),
        "ACCESS_LISTING",
    ),
    (re.compile(r"(?i)\breconciliation"), "RECONCILIATION"),
    (re.compile(r"(?i)\bexceptions?\b"), "EXCEPTION_EVIDENCE"),
    (re.compile(r"(?i)\bpopulation\b|\blist of\b|\blisting\b"), "POPULATION"),
    (re.compile(r"(?i)\bselected (?:item|sample)s?\b|\beach sample"), "SAMPLE_EVIDENCE"),
    (re.compile(r"(?i)\bconfiguration|\bsettings?\b|\bparameters?\b"), "CONFIGURATION"),
    (re.compile(r"(?i)\bpolicy\b|\bprocedure"), "POLICY_PROCEDURE"),
    (
        re.compile(r"(?i)\bnarrative|\bwalkthrough|\bprocess (?:flow|description)"),
        "PROCESS_NARRATIVE",
    ),
    (re.compile(r"(?i)\breport\b|\bquery\b|\bIPE\b"), "SYSTEM_REPORT"),
    (re.compile(r"(?i)\bapprov(?:al|ed)\b|\bsign-?off"), "APPROVAL_EVIDENCE"),
)
_ITEM = re.compile(r"^(\d{1,2})\. (\S.*)$")
_FIELDS = {
    "Period:": "period",
    "Include:": "include",
    "Format:": "format",
    "Show:": "show",
    "Completeness:": "completeness",
    "If not available:": "alternatives",
}
# A phase's request, by name, as the evidence plan heads its wording.
PHASE_TITLES: dict[str, str] = {
    "DESIGN": "Design evidence",
    "INTERIM": "Interim testing evidence",
    "ROLLFORWARD": "Roll-forward evidence",
}
# What a planned item's title carries when the item is optional or conditional.
_NECESSITY_SUFFIX = re.compile(r"\s*\((?:if available|if it applies)\)$", re.IGNORECASE)
# A policy or standard among the process documentation, rather than a narrative.
_POLICY = re.compile(r"(?i)\bpolic(?:y|ies)\b|\bprocedures?\b|\bstandards?\b")
_QUESTIONS = "Questions for you:"


# Why the evidence coordinator's draft waits (evidence_plans.held_for_planning), in words.
HELD_WORDS: dict[str, str] = {
    "plan the evidence first": "Plan the control's evidence first.",
    "approve the test plan first": "Approve the control's test plan first.",
    "settle the control's attributes first": (
        "Settle the control's attributes first: operating evidence follows them."
    ),
    "release the interim phase first": (
        "Release the interim phase for this control first: its requests are prepared and "
        "wait for design and implementation testing."
    ),
    "release the roll-forward phase first": (
        "Release the roll-forward phase for this control first: its requests are prepared "
        "and wait for interim testing."
    ),
    "settle the kickoff draft against the plan first": (
        "Reconcile this kickoff draft with the evidence plan first."
    ),
}


class DetailsState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


# Bodies


class RequestTypeBody(BaseModel):
    request_type: str
    label: str
    purpose: str


class TypeBody(BaseModel):
    request_type: str
    label: str
    basis: Basis
    # A person confirmed it; it no longer follows the records.
    confirmed: bool
    # The records do not settle it: a recommendation for the auditor to confirm.
    uncertain: bool
    # Why this type, in plain words, for the audit team.
    reason: str


class ItemBody(BaseModel):
    number: int
    title: str
    detail: str
    period: str = ""
    include: list[str] = Field(default_factory=list)
    format: str = ""
    show: str = ""
    completeness: str = ""
    # What may serve instead.
    alternatives: list[str] = Field(default_factory=list)
    request_type: str | None = None


class ContentBody(BaseModel):
    summary: str
    items: list[ItemBody]
    questions: list[str]
    # False: the wording has no numbered items, so it is shown as written.
    structured: bool
    # The wording's closing line after the items ("... Thank you."), kept apart from them.
    closing: str = ""


class PlanningRequirement(BaseModel):
    title: str
    categories: list[str]
    objective: str
    rationale: str
    necessity: str
    status: str
    sufficiency: str


class PlanningBody(BaseModel):
    """For the audit team only: never part of the email or the owner's portal."""

    requirements: list[PlanningRequirement]
    assumptions: list[str]
    # Who wrote the wording: the evidence coordinator's model, its rules, or a person.
    drafted_by: Literal["MODEL", "RULES", "PERSON"]
    drafting: bool


class ContactBody(BaseModel):
    name: str
    email: str
    role: str
    source: ContactSource


class AttachmentBody(BaseModel):
    id: UUID
    source: Literal["UPLOAD", "ENGAGEMENT_FILE", "PRIOR_YEAR_WORKPAPER"]
    file_name: str
    content_type: str
    size_bytes: int
    source_year: str
    visibility: Visibility
    previewable: bool
    added_by: str
    added_at: datetime
    shared_by: str | None
    version: int


class CheckBody(BaseModel):
    key: str
    label: str
    ok: bool
    detail: str


class ControlBody(BaseModel):
    id: UUID
    control_ref: str
    title: str
    owner_name: str
    owner_email: str


class SupportBody(BaseModel):
    """An approved attribute of the test plan the request's items evidence. Internal: the
    reviewer sees it before approving; the client never does."""

    code: str
    text: str
    items: list[str]


class DetailsBody(BaseModel):
    request: PbcBody
    reference: str
    title: str
    # A person set the title; otherwise it is the first item's.
    title_set: bool
    control: ControlBody | None
    type: TypeBody
    types: list[RequestTypeBody]
    content: ContentBody
    planning: PlanningBody
    attachments: list[AttachmentBody]
    # The engagement's people at the client, for the recipient fields.
    contacts: list[ContactBody]
    # Who the request should go to when nobody is set: the owner, else the coordinator.
    suggested: ContactBody | None
    # The client's email domains, from its control owners and evidence coordinator.
    domains: list[str]
    checks: list[CheckBody]
    ready: bool
    # An owner reply on this request waits for the team.
    clarification: bool
    # Recipients, copies, due date, and priority can change: nothing has been sent.
    assignable: bool
    can_edit: bool
    can_share: bool
    # What the owner gave through the portal: answers, messages, and their submission.
    client: ClientBody | None = None
    supports: list[SupportBody] = []


class SentMessage(BaseModel):
    id: UUID
    # The owner was emailed a link to read it (live or mock mailbox, allowed recipient).
    notified: bool


class AssignmentBody(BaseModel):
    version: int = Field(ge=1)
    recipient: str = Field(max_length=254)
    cc: list[str] = Field(default_factory=list, max_length=MAX_COPIED)
    due_on: date
    priority: Priority = "NORMAL"


class ClassificationBody(BaseModel):
    version: int = Field(ge=1)
    request_type: RequestType
    title: str = Field(default="", max_length=160)


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=254)
    role: str = Field(default="", max_length=120)


class LinkBody(BaseModel):
    source: Literal["ENGAGEMENT_FILE", "PRIOR_YEAR_WORKPAPER"]
    id: UUID


class AttachmentVersion(BaseModel):
    version: int = Field(ge=1)


class VisibilityBody(BaseModel):
    version: int = Field(ge=1)
    visibility: Visibility


class SourceFile(BaseModel):
    id: UUID
    file_name: str
    size_bytes: int
    added_at: datetime


class SourceWorkpaper(BaseModel):
    id: UUID
    engagement: str
    year: str
    reference: str
    stage: str


class SourcesBody(BaseModel):
    files: list[SourceFile]
    workpapers: list[SourceWorkpaper]


# Routes


def register_request_details(
    app: FastAPI, settings: Settings, store: StoreFactory = open_store
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"
    one = f"{base}/pbc-requests/{{request_id}}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except (DetailsState, PbcState, WorkspaceState) as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.get(f"{one}/details")
    def read_details(
        organization_id: UUID, project_id: UUID, request_id: UUID, request: Request
    ) -> DetailsBody:
        return run(
            request,
            lambda c, p: details(c, settings, p, organization_id, project_id, request_id),
        )

    @app.post(f"{one}/messages")
    def team_message(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: MessageBody,
        request: Request,
    ) -> SentMessage:
        """The audit team writes to the request's owner; the owner is emailed a link."""

        def work(c: psycopg.Connection[Any], p: Principal) -> SentMessage:
            from ai_workforce_api.evidence_portal import notify_owner_of_reply

            _authorize(c, p, Action.TASK_UPDATE, organization_id, project_id)
            if p.kind is not PrincipalKind.USER:
                raise DetailsState("a person writes to the owner")
            _read(c, organization_id, project_id, request_id)
            with transaction(c) as cursor:
                message_id = post_team_message(
                    cursor, organization_id, project_id, request_id, p.id, body
                )
                cursor.execute(
                    """
                    INSERT INTO audit_events (
                        organization_id, project_id, actor_user_id, action, target_type,
                        target_id, payload
                    )
                    VALUES (%s, %s, %s, 'request.message_sent', 'request_message', %s, %s)
                    """,
                    (organization_id, project_id, p.id, message_id,
                     Json({"request_id": str(request_id)})),
                )  # fmt: skip
            notified = notify_owner_of_reply(
                c, settings, organization_id, project_id, request_id, message_id, p.id,
                " ".join(body.body.split())[:4000],
            )  # fmt: skip
            return SentMessage(id=message_id, notified=notified)

        return run(request, work)

    @app.post(f"{one}/messages/seen")
    def team_seen(
        organization_id: UUID, project_id: UUID, request_id: UUID, request: Request
    ) -> dict[str, int]:
        def work(c: psycopg.Connection[Any], p: Principal) -> dict[str, int]:
            _authorize(c, p, Action.TASK_READ, organization_id, project_id)
            _read(c, organization_id, project_id, request_id)
            with transaction(c) as cursor:
                return {"seen": mark_seen(cursor, request_id)}

        return run(request, work)

    @app.post(f"{one}/assignment")
    def assign(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: AssignmentBody,
        request: Request,
    ) -> DetailsBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> DetailsBody:
            _assign(c, settings, p, organization_id, project_id, request_id, body)
            return details(c, settings, p, organization_id, project_id, request_id)

        return run(request, work)

    @app.post(f"{one}/classification")
    def classify_request(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: ClassificationBody,
        request: Request,
    ) -> DetailsBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> DetailsBody:
            _classify(c, p, organization_id, project_id, request_id, body)
            return details(c, settings, p, organization_id, project_id, request_id)

        return run(request, work)

    @app.get(f"{base}/engagement-contacts")
    def list_contacts(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[ContactBody]:
        def work(c: psycopg.Connection[Any], p: Principal) -> list[ContactBody]:
            _authorize(c, p, Action.TASK_READ, organization_id, project_id)
            return contacts(c, project_id)

        return run(request, work)

    @app.post(f"{base}/engagement-contacts")
    def add_contact(
        organization_id: UUID, project_id: UUID, body: ContactCreate, request: Request
    ) -> ContactBody:
        return run(
            request,
            lambda c, p: _add_contact(c, settings, p, organization_id, project_id, body),
        )

    @app.get(f"{one}/attachment-sources")
    def sources(
        organization_id: UUID, project_id: UUID, request_id: UUID, request: Request
    ) -> SourcesBody:
        return run(request, lambda c, p: _sources(c, p, organization_id, project_id, request_id))

    @app.post(f"{one}/attachments")
    async def upload(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        name: str,
        request: Request,
    ) -> AttachmentBody:
        file_name = clean_name(name)
        content = await request.body()
        if not content or len(content) > MAX_BYTES:
            raise HTTPException(status_code=422, detail="the file is empty or larger than 25 MB")
        content_type = clean_type(request.headers.get("content-type", ""))
        return run(
            request,
            lambda c, p: _upload(
                c,
                store(settings, c),
                p,
                organization_id,
                project_id,
                request_id,
                file_name,
                content_type,
                content,
            ),
        )

    @app.post(f"{one}/attachments/link")
    def link(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        body: LinkBody,
        request: Request,
    ) -> AttachmentBody:
        return run(
            request,
            lambda c, p: _link(
                c, store(settings, c), p, organization_id, project_id, request_id, body
            ),
        )

    @app.get(f"{one}/attachments/{{attachment_id}}/content")
    def download(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        attachment_id: UUID,
        request: Request,
    ) -> Response:
        found, content = run(
            request,
            lambda c, p: _content(
                c, store(settings, c), p, organization_id, project_id, request_id, attachment_id
            ),
        )
        return Response(
            content=content,
            media_type=found.content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{_filename(found.file_name)}"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get(f"{one}/attachments/{{attachment_id}}/preview")
    def preview(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        attachment_id: UUID,
        request: Request,
    ) -> Response:
        """A PDF or image to show in the page. Anything else is downloaded instead."""
        found, content = run(
            request,
            lambda c, p: _content(
                c, store(settings, c), p, organization_id, project_id, request_id, attachment_id
            ),
        )
        media = preview_type(content)
        if media is None:
            raise HTTPException(status_code=415, detail="this file cannot be previewed")
        return Response(
            content=content,
            media_type=media,
            headers={
                "Content-Disposition": f'inline; filename="{_filename(found.file_name)}"',
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:",
                "Cache-Control": "private, no-store",
            },
        )

    @app.post(f"{one}/attachments/{{attachment_id}}/remove")
    def remove(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        attachment_id: UUID,
        body: AttachmentVersion,
        request: Request,
    ) -> list[AttachmentBody]:
        return run(
            request,
            lambda c, p: _remove(
                c, p, organization_id, project_id, request_id, attachment_id, body
            ),
        )

    @app.post(f"{one}/attachments/{{attachment_id}}/visibility")
    def share(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        attachment_id: UUID,
        body: VisibilityBody,
        request: Request,
    ) -> AttachmentBody:
        return run(
            request,
            lambda c, p: _share(c, p, organization_id, project_id, request_id, attachment_id, body),
        )


# Reading


def supports_of(
    connection: psycopg.Connection[Any], request_id: UUID
) -> list[tuple[str, str, list[str]]]:
    from ai_workforce_api.request_quality import supports

    return supports(connection, request_id)


def details(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
) -> DetailsBody:
    _authorize(connection, principal, Action.TASK_READ, organization_id, project_id)
    pbc = _read(connection, organization_id, project_id, request_id)
    types = request_types(connection)
    labels = {item.request_type: item.label for item in types}
    control = _control(connection, project_id, pbc.engagement_control_id)
    content = parse_wording(pbc.evidence_description)
    planning, kinds, by_title = _planning(connection, pbc)
    signals = _signals(connection, pbc, control, planning, kinds)
    kind = classify(pbc, signals, labels)
    for item in content.items:
        item.request_type = by_title.get(_norm(plain_title(item.title))) or _keyword_type(
            f"{item.title} {item.detail}"
        )
    known = contacts(connection, project_id)
    domains = client_domains(connection, project_id)
    attachments = _attachments(connection, request_id)
    checks = request_checks(connection, settings, pbc, kind, content, domains, attachments)
    can_edit = _allowed(connection, principal, Action.TASK_UPDATE, organization_id, project_id)
    can_share = principal.kind is PrincipalKind.USER and _allowed(
        connection, principal, Action.PROJECT_UPDATE, organization_id, project_id
    )
    return DetailsBody(
        request=pbc,
        reference=reference_of(pbc.id),
        title=title_of(pbc, content),
        title_set=pbc.title.strip() != "",
        control=control,
        type=kind,
        types=types,
        content=content,
        planning=planning,
        attachments=attachments,
        contacts=known,
        suggested=_suggested(connection, project_id, control),
        domains=domains,
        checks=checks,
        ready=all(check.ok for check in checks),
        clarification=_clarification(connection, request_id),
        assignable=pbc.status in _UNSENT and not _sending(connection, request_id),
        can_edit=can_edit,
        can_share=can_share,
        client=client_record(connection, request_id),
        supports=[
            SupportBody(code=code, text=text, items=items)
            for code, text, items in supports_of(connection, request_id)
        ],
    )


def client_content(
    connection: psycopg.Connection[Any], project_id: UUID, request_id: UUID
) -> tuple[str, str, ContentBody]:
    """What the control owner sees of a request (evidence_portal): its title, its type's
    label, and its wording read into items and questions, the same as the team sees. No
    planning, rationale, or internal note is included."""
    row = connection.execute(
        f"SELECT {_PBC_COLUMNS} FROM pbc_requests WHERE id = %s AND project_id = %s",
        (request_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    pbc = _pbc_body(row)
    labels = {item.request_type: item.label for item in request_types(connection)}
    control = _control(connection, project_id, pbc.engagement_control_id)
    content = parse_wording(pbc.evidence_description)
    planning, kinds, by_title = _planning(connection, pbc)
    kind = classify(pbc, _signals(connection, pbc, control, planning, kinds), labels)
    for item in content.items:
        item.request_type = by_title.get(_norm(plain_title(item.title))) or _keyword_type(
            f"{item.title} {item.detail}"
        )
    return title_of(pbc, content), kind.label, content


def reference_of(request_id: UUID) -> str:
    return f"PBC-{request_id.hex[-8:].upper()}"


def title_of(pbc: PbcBody, content: ContentBody) -> str:
    """The person's title, else the wording's own heading (a planned request opens with
    one: "Design evidence for ITGC-AC-05: ..."), else, for a phase's request of several
    items, the phase and control, else the first item's (the request's main deliverable),
    else the first line of the wording."""
    if pbc.title.strip():
        return pbc.title.strip()
    heading = heading_of(content)
    if heading:
        return heading
    if len(content.items) > 1 and pbc.testing_phase in PHASE_TITLES:
        return f"{PHASE_TITLES[pbc.testing_phase]} for {pbc.control_ref}"
    if content.items:
        return content.items[0].title[:160]
    for line in pbc.evidence_description.splitlines():
        if line.strip():
            return line.strip()[:160]
    return pbc.control_ref


def heading_of(content: ContentBody) -> str:
    """The wording's heading: a first line before the items that is a title, not a
    sentence (no closing punctuation). Empty when the wording opens with a sentence."""
    if not content.items or not content.summary:
        return ""
    first = content.summary.split("\n\n", 1)[0].strip()
    if "\n" in first or not first or len(first) > 160 or first[-1] in ".:?!,;":
        return ""
    return first


def plain_title(title: str) -> str:
    """An item's title without the "(if available)" a planned optional item carries."""
    return _NECESSITY_SUFFIX.sub("", title).strip()


def request_types(connection: psycopg.Connection[Any]) -> list[RequestTypeBody]:
    rows = connection.execute(
        "SELECT request_type, label, purpose FROM evidence_request_types ORDER BY sort_order"
    ).fetchall()
    return [RequestTypeBody(request_type=r[0], label=r[1], purpose=r[2]) for r in rows]


def parse_wording(text: str) -> ContentBody:
    """The request's wording, read back into the structure pbc_drafting.render writes: an
    opening, numbered items with their labelled lines, and questions. Wording a person
    rewrote freely comes back unstructured and is shown as written."""
    summary: list[str] = []
    items: list[ItemBody] = []
    questions: list[str] = []
    in_questions = False
    closing = ""
    for paragraph in text.strip().split("\n\n"):
        lines = [line.rstrip() for line in paragraph.strip("\n").split("\n")]
        if not lines or not lines[0].strip():
            continue
        head = _ITEM.match(lines[0].strip())
        if lines[0].strip() == _QUESTIONS:
            in_questions = True
            questions.extend(_bullets(lines[1:]))
            continue
        if in_questions and all(line.strip().startswith("- ") for line in lines):
            questions.extend(_bullets(lines))
            continue
        if head is not None:
            in_questions = False
            items.append(_item(int(head.group(1)), head.group(2).strip(), lines[1:]))
            continue
        if items and lines[0].startswith("   "):
            # A continuation of the previous item's detail.
            items[-1].detail = f"{items[-1].detail}\n{paragraph.strip()}".strip()
            continue
        if not items:
            summary.append(paragraph.strip())
        elif (
            not questions
            and "\n" not in paragraph.strip()
            and paragraph.strip().endswith("Thank you.")
        ):
            # The drafter's one-line closing, after the last item: not part of that item,
            # even when the item has no detail line of its own.
            closing = paragraph.strip()
        else:
            items[-1].detail = f"{items[-1].detail}\n\n{paragraph.strip()}".strip()
    if items and not questions and not closing:
        # The drafter's one-line closing, after the last item: not part of that item.
        parts = items[-1].detail.rsplit("\n\n", 1)
        if len(parts) == 2 and "\n" not in parts[1] and parts[1].endswith("Thank you."):
            items[-1].detail, closing = parts[0], parts[1]
    return ContentBody(
        summary="\n\n".join(summary) if items else text.strip(),
        items=items,
        questions=questions,
        structured=bool(items),
        closing=closing,
    )


def _bullets(lines: list[str]) -> list[str]:
    return [line.strip()[2:].strip() for line in lines if line.strip().startswith("- ")]


def _item(number: int, title: str, lines: list[str]) -> ItemBody:
    item = ItemBody(number=number, title=title, detail="")
    detail: list[str] = []
    for line in lines:
        text = line.strip()
        label = next((key for key in _FIELDS if text.startswith(key)), None)
        if label is None:
            detail.append(text)
            continue
        value = text[len(label) :].strip()
        field = _FIELDS[label]
        if field in {"include", "alternatives"}:
            parts = [part.strip().rstrip(".") for part in value.split(";") if part.strip()]
            setattr(item, field, parts)
        else:
            setattr(item, field, value)
    item.detail = "\n".join(part for part in detail if part)
    return item


def _planning(
    connection: psycopg.Connection[Any], pbc: PbcBody
) -> tuple[PlanningBody, list[str], dict[str, RequestType]]:
    """Why each item is asked for and the drafter's assumptions; the draft's item kinds;
    and each planned or drafted item's type by its title."""
    rows = connection.execute(
        """
        SELECT title, categories, objective, rationale, necessity, status, sufficiency
        FROM evidence_requirements
        WHERE pbc_request_id = %s
        ORDER BY created_at, id
        """,
        (pbc.id,),
    ).fetchall()
    requirements = [
        PlanningRequirement(
            title=str(r[0]),
            categories=[str(item) for item in (r[1] or [])],
            objective=str(r[2]),
            rationale=str(r[3]),
            necessity=str(r[4]),
            status=str(r[5]),
            sufficiency=str(r[6]),
        )
        for r in rows
    ]
    draft = connection.execute(
        """
        SELECT status, source, content
        FROM pbc_drafts
        WHERE pbc_request_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (pbc.id,),
    ).fetchone()
    content = draft[2] if draft is not None and isinstance(draft[2], dict) else {}
    assumptions = [str(item) for item in content.get("assumptions", []) if isinstance(item, str)]
    drafted_items = [item for item in content.get("items", []) if isinstance(item, dict)]
    kinds = [str(item.get("kind", "")) for item in drafted_items]
    by_title = item_types(
        [(str(item.get("title", "")), str(item.get("kind", ""))) for item in drafted_items],
        [(item.title, item.categories) for item in requirements],
        pbc.testing_phase,
    )
    source = str(draft[1]) if draft is not None and draft[1] is not None else ""
    drafted_by: Literal["MODEL", "RULES", "PERSON"] = (
        "MODEL" if source == "MODEL" else "RULES" if source == "RULES" else "PERSON"
    )
    drafting = draft is not None and str(draft[0]) in {"PENDING", "DRAFTING"}
    return (
        PlanningBody(
            requirements=requirements,
            assumptions=assumptions,
            drafted_by=drafted_by,
            drafting=drafting,
        ),
        kinds,
        by_title,
    )


@dataclass(frozen=True)
class Signals:
    """What the records say the request asks for, most important first."""

    types: tuple[RequestType, ...]
    # Where they came from: the plan, the coordinator's draft, the request's kind, or
    # only its wording (a recommendation the auditor confirms).
    origin: Literal["PLAN", "DRAFT", "KIND", "WORDING", "NONE"]
    agent: bool


def _signals(
    connection: psycopg.Connection[Any],
    pbc: PbcBody,
    control: ControlBody | None,
    planning: PlanningBody,
    kinds: list[str],
) -> Signals:
    return signals_of(
        pbc,
        access=control is not None and _area(connection, control.id) == "ACCESS",
        agent=planning.drafted_by == "MODEL",
        categories=[item.categories for item in planning.requirements],
        kinds=kinds,
        titles=[item.title for item in planning.requirements],
    )


def signals_of(
    pbc: PbcBody,
    *,
    access: bool,
    agent: bool,
    categories: list[list[str]],
    kinds: list[str],
    titles: list[str] | None = None,
) -> Signals:
    """What the records say the request asks for, from what was read for it: whether its
    control is about access, whether the drafter's model wrote it, each planned item's
    categories, and each drafted item's kind. Pure, so a list of requests is classified
    from one read of the engagement."""

    def refine(found: RequestType) -> RequestType:
        if found == "POPULATION" and access:
            return "ACCESS_LISTING"
        if found == "SAMPLE_EVIDENCE" and pbc.testing_phase == "DESIGN":
            return "SAMPLE_OF_ONE"
        return found

    if pbc.operation_key.startswith("samples-"):
        return Signals(("SAMPLE_EVIDENCE",), "KIND", False)
    named = titles if titles is not None and len(titles) == len(categories) else None
    planned = [
        refine(found)
        for found in (
            _category_type(item, pbc.testing_phase, named[index] if named else "")
            for index, item in enumerate(categories)
        )
        if found is not None
    ]
    if planned:
        return Signals(tuple(planned), "PLAN", agent)
    drafted = [refine(_KIND_TYPES[kind]) for kind in kinds if kind in _KIND_TYPES]
    if drafted:
        return Signals(tuple(drafted), "DRAFT", agent)
    worded = _keyword_type(pbc.evidence_description)
    if worded is not None:
        return Signals((refine(worded),), "WORDING", False)
    return Signals((), "NONE", False)


def classify(pbc: PbcBody, signals: Signals, labels: dict[str, str]) -> TypeBody:
    """The request's primary type: a person's confirmed choice, else what its first and
    most important item asks for."""
    if pbc.request_type is not None:
        return TypeBody(
            request_type=pbc.request_type,
            label=labels.get(pbc.request_type, pbc.request_type),
            basis="PERSON",
            confirmed=True,
            uncertain=False,
            reason="Confirmed by the audit team.",
        )
    primary: RequestType = signals.types[0] if signals.types else "OTHER"
    uncertain = signals.origin in {"WORDING", "NONE"} or primary == "OTHER"
    reason = {
        "PLAN": "Classified from the evidence plan's requirements.",
        "DRAFT": "Classified from the drafted request items.",
        "KIND": "Classified from the request's purpose.",
        "WORDING": "Recommended from the request wording. Confirm before approval.",
        "NONE": "The request could not be classified. Select a type before approval.",
    }[signals.origin]
    if primary == "OTHER" and signals.origin in {"PLAN", "DRAFT"}:
        reason = "The planned items do not fit a standard type. Confirm before approval."
    mixed = len(set(signals.types)) > 1
    if mixed and not uncertain:
        reason = f"{reason[:-1]}; the first item sets the primary type."
    return TypeBody(
        request_type=primary,
        label=labels.get(primary, primary),
        basis="AGENT" if signals.agent else "RULES",
        confirmed=False,
        uncertain=uncertain,
        reason=reason,
    )


def item_types(
    drafted: list[tuple[str, str]],
    planned: list[tuple[str, list[str]]],
    phase: str | None,
) -> dict[str, RequestType]:
    """Each item's type by its title: the drafter's kind for each drafted (title, kind),
    and the plan's type for each planned (title, categories). The draft's kind stands,
    unless it could not place the item ("other") and the plan can."""
    found: dict[str, RequestType] = {}
    for title, kind in drafted:
        drafted_type = _KIND_TYPES.get(kind)
        if drafted_type is not None:
            found[_norm(title)] = drafted_type
    for title, categories in planned:
        planned_type = _category_type(categories, phase, title, named=True)
        key = _norm(title)
        if planned_type is not None and found.get(key) in (None, "OTHER"):
            found[key] = planned_type
    return found


def _category_type(
    categories: list[str], phase: str | None, title: str = "", *, named: bool = False
) -> RequestType | None:
    """A planned item's type from its categories, refined by its title where the category
    is broad: a policy among the process documentation. With named, an item the plan could
    not place is labelled by what its title names plainly (a list of users and roles): a
    label for the item only, which never settles the request's own type."""
    for category in categories:
        found = _CATEGORY_TYPES.get(category)
        if found is None:
            continue
        if category == "CONTROL_EXECUTION" and phase == "DESIGN":
            return "SAMPLE_OF_ONE"
        if category == "PROCESS_DOCUMENTATION" and _POLICY.search(title):
            return "POLICY_PROCEDURE"
        if found == "OTHER" and named and title:
            return _keyword_type(title) or found
        return found
    return None


def _keyword_type(text: str) -> RequestType | None:
    for pattern, found in _KEYWORDS:
        if pattern.search(text):
            return found
    return None


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def _area(connection: psycopg.Connection[Any], control_id: UUID) -> str:
    row = connection.execute(
        "SELECT domain FROM engagement_controls WHERE id = %s", (control_id,)
    ).fetchone()
    return "" if row is None else str(row[0])


def _control(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None
) -> ControlBody | None:
    if control_id is None:
        return None
    row = connection.execute(
        """
        SELECT id, control_ref, title, owner_name, owner_email
        FROM engagement_controls WHERE id = %s AND project_id = %s
        """,
        (control_id, project_id),
    ).fetchone()
    if row is None:
        return None
    return ControlBody(
        id=row[0],
        control_ref=str(row[1]),
        title=str(row[2]),
        owner_name=str(row[3]),
        owner_email=str(row[4]).strip().lower(),
    )


def contacts(connection: psycopg.Connection[Any], project_id: UUID) -> list[ContactBody]:
    """The engagement's people at the client: its control owners, its evidence
    coordinator, the contacts added from requests, and anyone a request went to."""
    found: dict[str, ContactBody] = {}

    def add(name: str, email: str, role: str, source: ContactSource) -> None:
        address = email.strip().lower()
        if _EMAIL.fullmatch(address) is None or address in found:
            return
        found[address] = ContactBody(
            name=name.strip() or address.split("@", 1)[0],
            email=address,
            role=role,
            source=source,
        )

    for row in connection.execute(
        """
        SELECT client_coordinator_name, client_coordinator_email
        FROM engagement_settings WHERE project_id = %s
        """,
        (project_id,),
    ).fetchall():
        add(str(row[0]), str(row[1]), "Evidence coordinator", "COORDINATOR")
    for row in connection.execute(
        """
        SELECT owner_name, owner_email, string_agg(control_ref, ', ' ORDER BY control_ref)
        FROM engagement_controls
        WHERE project_id = %s AND included AND owner_email <> ''
        GROUP BY owner_name, owner_email
        ORDER BY owner_name, owner_email
        """,
        (project_id,),
    ).fetchall():
        refs = str(row[2])
        role = f"Control owner, {refs}" if len(refs) <= 80 else "Control owner"
        add(str(row[0]), str(row[1]), role, "OWNER")
    for row in connection.execute(
        "SELECT name, email, role FROM engagement_contacts WHERE project_id = %s ORDER BY name",
        (project_id,),
    ).fetchall():
        add(str(row[0]), str(row[1]), str(row[2]) or "Client contact", "CONTACT")
    for row in connection.execute(
        """
        SELECT DISTINCT lower(recipient) FROM pbc_requests
        WHERE project_id = %s AND recipient <> '' AND status <> 'CANCELLED'
        ORDER BY 1
        """,
        (project_id,),
    ).fetchall():
        add("", str(row[0]), "Previous recipient", "RECIPIENT")
    return list(found.values())


def _suggested(
    connection: psycopg.Connection[Any], project_id: UUID, control: ControlBody | None
) -> ContactBody | None:
    if control is not None and _EMAIL.fullmatch(control.owner_email):
        return ContactBody(
            name=control.owner_name or control.owner_email,
            email=control.owner_email,
            role="Control owner",
            source="OWNER",
        )
    row = connection.execute(
        """
        SELECT client_coordinator_name, lower(client_coordinator_email)
        FROM engagement_settings WHERE project_id = %s
        """,
        (project_id,),
    ).fetchone()
    if row is not None and _EMAIL.fullmatch(str(row[1])):
        return ContactBody(
            name=str(row[0]) or str(row[1]),
            email=str(row[1]),
            role="Evidence coordinator",
            source="COORDINATOR",
        )
    return None


def client_domains(connection: psycopg.Connection[Any], project_id: UUID) -> list[str]:
    """The client's email domains as Engagement Setup records them; for an engagement that
    names none, those of its control owners and evidence coordinator. Contacts added from
    a request never widen them."""
    configured = connection.execute(
        "SELECT client_domains FROM engagement_settings WHERE project_id = %s", (project_id,)
    ).fetchone()
    named = sorted(
        {str(item).strip().lower() for item in (configured[0] if configured else []) or []} - {""}
    )
    if named:
        return named
    rows = connection.execute(
        """
        SELECT DISTINCT lower(split_part(email, '@', 2)) FROM (
            SELECT owner_email AS email FROM engagement_controls
            WHERE project_id = %s AND included AND owner_email LIKE '%%_@_%%'
            UNION ALL
            SELECT client_coordinator_email FROM engagement_settings
            WHERE project_id = %s AND client_coordinator_email LIKE '%%_@_%%'
        ) people
        ORDER BY 1
        """,
        (project_id, project_id),
    ).fetchall()
    return [str(row[0]) for row in rows if str(row[0])]


def address_problem(settings: Settings, address: str, domains: list[str]) -> str | None:
    """Why an address cannot receive this engagement's requests, or None."""
    from ai_workforce_api.outbound import recipient_allowed

    clean = address.strip().lower()
    if _EMAIL.fullmatch(clean) is None:
        return f"{clean or 'The address'} is not a valid email address."
    if not recipient_allowed(settings, clean):
        return f"{clean} cannot receive evidence requests."
    if domains and clean.rsplit("@", 1)[1] not in domains:
        return f"{clean} is outside the client's email domains ({', '.join(domains)})."
    return None


def _attachments(connection: psycopg.Connection[Any], request_id: UUID) -> list[AttachmentBody]:
    rows = connection.execute(
        f"""
        SELECT {_ATTACHMENT_COLUMNS}
        FROM request_attachments a
        JOIN users u ON u.id = a.added_by
        LEFT JOIN users s ON s.id = a.shared_by
        WHERE a.pbc_request_id = %s AND a.removed_at IS NULL
        ORDER BY a.created_at, a.id
        """,
        (request_id,),
    ).fetchall()
    return [_attachment(row) for row in rows]


_ATTACHMENT_COLUMNS = """
    a.id, a.source, a.file_name, a.content_type, a.size_bytes, a.source_year, a.visibility,
    u.display_name, a.created_at, s.display_name, a.version
"""


def _attachment(row: tuple[Any, ...]) -> AttachmentBody:
    return AttachmentBody(
        id=row[0],
        source=row[1],
        file_name=str(row[2]),
        content_type=str(row[3]),
        size_bytes=int(row[4]),
        source_year=str(row[5]),
        visibility=row[6],
        previewable=str(row[3]) in _PREVIEWABLE,
        added_by=str(row[7]),
        added_at=row[8],
        shared_by=None if row[9] is None else str(row[9]),
        version=int(row[10]),
    )


def _clarification(connection: psycopg.Connection[Any], request_id: UUID) -> bool:
    row = connection.execute(
        """
        SELECT 1 FROM inbound_messages
        WHERE pbc_request_id = %s AND match_status IN ('MATCHED', 'ASSIGNED')
          AND review_state = 'NEEDS_REVIEW'
        LIMIT 1
        """,
        (request_id,),
    ).fetchone()
    return row is not None


def _sending(connection: psycopg.Connection[Any], request_id: UUID) -> bool:
    """A message for the request is recorded: its recipients are fixed."""
    row = connection.execute(
        "SELECT 1 FROM outbound_messages WHERE pbc_request_id = %s "
        "AND NOT metadata ? 'follow_up_id' "
        "LIMIT 1",
        (request_id,),
    ).fetchone()
    return row is not None


# Checks before approval and sending


def request_checks(
    connection: psycopg.Connection[Any],
    settings: Settings,
    pbc: PbcBody,
    kind: TypeBody,
    content: ContentBody,
    domains: list[str],
    attachments: list[AttachmentBody],
) -> list[CheckBody]:
    """What must be true before the request is approved and sent, each in plain words."""
    from ai_workforce_api.evidence_plans import held_for_planning

    checks: list[CheckBody] = []
    title = title_of(pbc, content)
    checks.append(CheckBody(key="title", label="Title", ok=title != "", detail=title))
    checks.append(
        CheckBody(
            key="type",
            label="Request type",
            ok=not kind.uncertain,
            detail=kind.label if not kind.uncertain else f"Confirm the type ({kind.label}).",
        )
    )
    phase_ok = pbc.engagement_control_id is None or pbc.testing_phase is not None
    checks.append(
        CheckBody(
            key="phase",
            label="Testing phase",
            ok=phase_ok,
            detail="Not tied to a testing phase."
            if pbc.testing_phase is None
            else pbc.testing_phase.replace("ROLLFORWARD", "ROLL-FORWARD").capitalize(),
        )
    )
    from ai_workforce_api.evidence_planning import PHASE_LABELS

    drafting = connection.execute(
        """
        SELECT c.control_ref FROM pbc_drafts d
        JOIN engagement_controls c ON c.id = d.engagement_control_id
        WHERE d.pbc_request_id = %s AND d.status IN ('PENDING', 'DRAFTING')
        LIMIT 1
        """,
        (pbc.id,),
    ).fetchone()
    text = pbc.evidence_description.strip()
    # Still the placeholder the plan wrote (evidence_plans._create_request). Wording a
    # person wrote meanwhile stands: once submitted, the drafter no longer replaces it.
    placeholder = drafting is not None and text in {
        f"{label} evidence for {drafting[0]}" for label in PHASE_LABELS.values()
    }
    if placeholder:
        instructions = "The wording is still being drafted."
    elif len(text) < 40:
        instructions = "Describe what the client must provide."
    elif contains_secret({"wording": text}):
        instructions = "Remove the credential from the wording."
    else:
        count = len(content.items)
        instructions = (
            f"{count} item{'s' if count != 1 else ''} requested." if count else "Written request."
        )
    checks.append(
        CheckBody(
            key="instructions",
            label="Instructions",
            ok=instructions.endswith("requested.") or instructions == "Written request.",
            detail=instructions,
        )
    )
    if pbc.recipient.strip() == "":
        recipient = CheckBody(
            key="recipient", label="Recipient", ok=False, detail="Assign a recipient."
        )
    else:
        problem = address_problem(settings, pbc.recipient, domains)
        recipient = CheckBody(
            key="recipient",
            label="Recipient",
            ok=problem is None,
            detail=problem or pbc.recipient.strip().lower(),
        )
    checks.append(recipient)
    copied = [address_problem(settings, item, domains) for item in pbc.cc_recipients]
    wrong = next((item for item in copied if item is not None), None)
    checks.append(
        CheckBody(
            key="cc",
            label="Copied",
            ok=wrong is None,
            detail=wrong
            or (f"{len(pbc.cc_recipients)} copied." if pbc.cc_recipients else "Nobody copied."),
        )
    )
    due = pbc.due_at.astimezone(UTC)
    checks.append(
        CheckBody(
            key="due",
            label="Due date",
            ok=due > datetime.now(UTC),
            detail=f"{due.day} {due:%B %Y}"
            if due > datetime.now(UTC)
            else "The due date has passed. Set a new due date.",
        )
    )
    in_scope = True
    if pbc.engagement_control_id is not None:
        row = connection.execute(
            "SELECT included FROM engagement_controls WHERE id = %s AND project_id = %s",
            (pbc.engagement_control_id, pbc.project_id),
        ).fetchone()
        in_scope = row is not None and bool(row[0])
    checks.append(
        CheckBody(
            key="control",
            label="Engagement and control",
            ok=in_scope,
            detail=pbc.control_ref if in_scope else "The control is no longer in scope.",
        )
    )
    shared = sum(1 for item in attachments if item.visibility == "SHARED")
    internal = len(attachments) - shared
    checks.append(
        CheckBody(
            key="attachments",
            label="Reference materials",
            ok=True,
            detail="None attached."
            if not attachments
            else f"{shared} shared with the recipient; {internal} internal only.",
        )
    )
    # Master test plans (milestone D): the wording is specific and the client's, every item
    # that evidences an attribute maps to the approved plan, periods lie in the phase's
    # window, the phase applies, nothing waits for a decision, and it is no duplicate.
    from ai_workforce_api.request_quality import quality_checks

    if pbc.status in _UNSENT:
        checks.extend(
            CheckBody(key=item.key, label=item.label, ok=item.ok, detail=item.detail)
            for item in quality_checks(
                connection, pbc.id, pbc.project_id, pbc.engagement_control_id,
                pbc.testing_phase, pbc.evidence_description, pbc.status,
            )
        )  # fmt: skip
    if pbc.status in _UNSENT:
        held = held_for_planning(connection, pbc.id)
        if held is not None:
            checks.append(
                CheckBody(
                    key="planning",
                    label="Evidence plan",
                    ok=False,
                    detail=HELD_WORDS.get(held, held),
                )
            )
    return checks


def blocker(
    connection: psycopg.Connection[Any],
    settings: Settings,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    keys: frozenset[str] | None = None,
) -> str | None:
    """The first check that fails, among the keys given (all when None), or None."""
    pbc = _read(connection, organization_id, project_id, request_id)
    labels = {item.request_type: item.label for item in request_types(connection)}
    control = _control(connection, project_id, pbc.engagement_control_id)
    content = parse_wording(pbc.evidence_description)
    planning, kinds, _ = _planning(connection, pbc)
    kind = classify(pbc, _signals(connection, pbc, control, planning, kinds), labels)
    checks = request_checks(
        connection,
        settings,
        pbc,
        kind,
        content,
        client_domains(connection, project_id),
        _attachments(connection, request_id),
    )
    for check in checks:
        if not check.ok and (keys is None or check.key in keys):
            return check.detail
    return None


# Changing


def _assign(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    body: AssignmentBody,
) -> None:
    """Who the request goes to, who is copied, when it is due, and its priority. Saved as
    each changes. An approved request that has not been sent returns to draft for a new
    approval: the approval covered the recipients it was given."""
    _authorize(connection, principal, Action.TASK_UPDATE, organization_id, project_id)
    recipient = body.recipient.strip().lower()
    copied = [item.strip().lower() for item in body.cc if item.strip()]
    domains = client_domains(connection, project_id)
    if recipient:
        problem = address_problem(settings, recipient, domains)
        if problem is not None:
            raise DetailsState(problem)
    if len(set(copied)) != len(copied):
        raise DetailsState("Each copied address can appear once.")
    if recipient and recipient in copied:
        raise DetailsState("The recipient is already on the request; remove them from Cc.")
    for item in copied:
        problem = address_problem(settings, item, domains)
        if problem is not None:
            raise DetailsState(problem)
    today = datetime.now(UTC).date()
    if body.due_on < today:
        raise DetailsState("The due date cannot be in the past.")
    if body.due_on > today + timedelta(days=366):
        raise DetailsState("The due date must be within a year.")
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, request_id)
        if current.version != body.version:
            raise DetailsState("The request changed. Reload it and try again.")
        if current.status not in _UNSENT or _sending(connection, request_id):
            raise DetailsState("The request has been sent; its recipients can no longer change.")
        due = current.due_at.astimezone(UTC)
        due_at = datetime.combine(body.due_on, due.timetz())
        changes: dict[str, Any] = {}
        if recipient != current.recipient.strip().lower():
            changes["recipient"] = {"from": current.recipient, "to": recipient}
        if copied != [item.lower() for item in current.cc_recipients]:
            changes["cc"] = {"from": current.cc_recipients, "to": copied}
        if due_at != current.due_at:
            changes["due"] = {
                "from": current.due_at.date().isoformat(),
                "to": body.due_on.isoformat(),
            }
        if body.priority != current.priority:
            changes["priority"] = {"from": current.priority, "to": body.priority}
        if not changes:
            return
        bound = {"recipient", "cc", "due"} & changes.keys()
        reopened = current.status == "APPROVAL_PENDING" and bool(bound)
        cursor.execute(
            """
            UPDATE pbc_requests
            SET recipient = %s, cc_recipients = %s, due_at = %s, priority = %s,
                status = CASE WHEN %s THEN 'DRAFT' ELSE status END,
                updated_at = clock_timestamp(), version = version + 1
            WHERE id = %s AND version = %s
            """,
            (recipient, copied, due_at, body.priority, reopened, request_id, body.version),
        )
        if reopened:
            # A pending approval no longer covers what would be sent. An approved one
            # cannot be used: sending checks the approved recipients and wording.
            cursor.execute(
                """
                UPDATE approvals
                SET decision = 'EXPIRED', decided_at = clock_timestamp(), version = version + 1
                WHERE project_id = %s AND action_id = 'mail.pbc' AND decision = 'PENDING'
                  AND parameters ->> 'request_ref' LIKE %s
                """,
                (project_id, f"pbc/{request_id}/%"),
            )
            changes["status"] = {"from": "APPROVAL_PENDING", "to": "DRAFT"}
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "pbc.assignment_changed",
            "pbc_request",
            request_id,
            changes,
        )


def _classify(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    body: ClassificationBody,
) -> None:
    """A person confirms or changes the request's type, and may set its title. Neither is
    part of the email, so an approval stands."""
    _authorize(connection, principal, Action.TASK_UPDATE, organization_id, project_id)
    title = " ".join(body.title.split())
    if contains_secret({"title": title}):
        raise ValueError("the title holds a credential")
    with transaction(connection) as cursor:
        current = _lock(cursor, organization_id, project_id, request_id)
        if current.version != body.version:
            raise DetailsState("The request changed. Reload it and try again.")
        if current.status in _CLOSED:
            raise DetailsState("The request is closed.")
        cursor.execute(
            """
            UPDATE pbc_requests
            SET request_type = %s, request_type_basis = 'PERSON', request_type_confirmed = true,
                title = %s, updated_at = clock_timestamp(), version = version + 1
            WHERE id = %s AND version = %s
            """,
            (body.request_type, title, request_id, body.version),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "pbc.classified",
            "pbc_request",
            request_id,
            {
                "request_type": {"from": current.request_type, "to": body.request_type},
                "title": {"from": current.title, "to": title},
            },
        )


def _add_contact(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ContactCreate,
) -> ContactBody:
    _authorize(connection, principal, Action.TASK_UPDATE, organization_id, project_id)
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    name = " ".join(body.name.split())
    role = " ".join(body.role.split())
    email = body.email.strip().lower()
    if not name:
        raise DetailsState("Enter the contact's name.")
    if contains_secret({"name": name, "role": role}):
        raise ValueError("the contact holds a credential")
    problem = address_problem(settings, email, client_domains(connection, project_id))
    if problem is not None:
        raise DetailsState(problem)
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO engagement_contacts (
                organization_id, project_id, name, email, role, created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id, email) DO NOTHING
            RETURNING id
            """,
            (organization_id, project_id, name, email, role, principal.id),
        ).fetchone()
        if row is not None:
            _audit(
                cursor,
                organization_id,
                project_id,
                principal.id,
                "engagement_contact.added",
                "engagement_contact",
                UUID(str(row[0])),
                {"email": email},
            )
    found = next((item for item in contacts(connection, project_id) if item.email == email), None)
    if found is None:
        raise NotVisible()
    return found


# Reference materials


def _sources(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
) -> SourcesBody:
    """What can be attached: this engagement's files, and the prior-year workpapers of the
    same control from the same client's earlier engagements the person can read."""
    _authorize(connection, principal, Action.TASK_READ, organization_id, project_id)
    pbc = _read(connection, organization_id, project_id, request_id)
    files = connection.execute(
        """
        SELECT f.id, f.file_name, f.size_bytes, f.created_at
        FROM evidence_files f
        WHERE f.project_id = %s AND f.organization_id = %s
          AND NOT EXISTS (
              SELECT 1 FROM request_attachments a
              WHERE a.pbc_request_id = %s AND a.evidence_file_id = f.id
                AND a.removed_at IS NULL
          )
        ORDER BY f.created_at DESC
        LIMIT 200
        """,
        (project_id, organization_id, request_id),
    ).fetchall()
    papers = [
        item
        for item in _prior_workpapers(connection, organization_id, project_id, pbc)
        if _allowed(connection, principal, Action.TASK_READ, organization_id, item[1])
    ]
    return SourcesBody(
        files=[
            SourceFile(id=r[0], file_name=str(r[1]), size_bytes=int(r[2]), added_at=r[3])
            for r in files
        ],
        workpapers=[
            SourceWorkpaper(
                id=item[0], engagement=item[2], year=item[3], reference=item[4], stage=item[5]
            )
            for item in papers
        ],
    )


def _prior_workpapers(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    pbc: PbcBody,
    workpaper_id: UUID | None = None,
) -> list[tuple[UUID, UUID, str, str, str, str]]:
    """(workpaper, its engagement, engagement name, year, control, stage) for the same
    client's earlier engagements, same control, prepared at least once. Never another
    client's: both engagements must name the same client record."""
    control_ref = pbc.control_ref
    if pbc.engagement_control_id is not None:
        row = connection.execute(
            "SELECT control_ref FROM engagement_controls WHERE id = %s",
            (pbc.engagement_control_id,),
        ).fetchone()
        if row is not None:
            control_ref = str(row[0])
    rows = connection.execute(
        """
        SELECT w.id, p.id, p.name,
               coalesce(nullif(s.fiscal_year, ''), to_char(s.period_end, 'YYYY'), ''),
               c.control_ref, w.stage
        FROM engagement_settings mine
        JOIN projects me ON me.id = mine.project_id
        JOIN engagement_settings s
          ON s.client_id = mine.client_id AND s.project_id <> mine.project_id
        JOIN projects p ON p.id = s.project_id AND p.organization_id = %s
        JOIN engagement_controls c ON c.project_id = p.id AND c.control_ref = %s
        JOIN workpapers w ON w.engagement_control_id = c.id AND w.project_id = p.id
        WHERE mine.project_id = %s AND mine.client_id IS NOT NULL
          AND p.created_at < me.created_at AND w.current_version > 0
          AND (%s::uuid IS NULL OR w.id = %s)
        ORDER BY p.created_at DESC, w.stage
        LIMIT 20
        """,
        (organization_id, control_ref, project_id, workpaper_id, workpaper_id),
    ).fetchall()
    return [
        (UUID(str(r[0])), UUID(str(r[1])), str(r[2]), str(r[3])[:20], str(r[4]), str(r[5]))
        for r in rows
    ]


def _upload(
    connection: psycopg.Connection[Any],
    store: Any,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    file_name: str,
    content_type: str,
    content: bytes,
) -> AttachmentBody:
    _authorize(connection, principal, Action.TASK_UPDATE, organization_id, project_id)
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    _attachable(connection, organization_id, project_id, request_id)
    key = f"evidence/{uuid4()}"
    digest = store.put(key, content)
    return _insert(
        connection,
        principal,
        organization_id,
        project_id,
        request_id,
        source="UPLOAD",
        file_name=file_name,
        content_type=content_type,
        size=len(content),
        key=key,
        digest=digest,
    )


def _link(
    connection: psycopg.Connection[Any],
    store: Any,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    body: LinkBody,
) -> AttachmentBody:
    _authorize(connection, principal, Action.TASK_UPDATE, organization_id, project_id)
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    pbc = _attachable(connection, organization_id, project_id, request_id)
    if body.source == "ENGAGEMENT_FILE":
        row = connection.execute(
            """
            SELECT file_name, content_type, size_bytes, object_key, content_sha256
            FROM evidence_files WHERE id = %s AND project_id = %s AND organization_id = %s
            """,
            (body.id, project_id, organization_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        attached = connection.execute(
            """
            SELECT 1 FROM request_attachments
            WHERE pbc_request_id = %s AND evidence_file_id = %s AND removed_at IS NULL
            """,
            (request_id, body.id),
        ).fetchone()
        if attached is not None:
            raise DetailsState("This file is already attached.")
        return _insert(
            connection,
            principal,
            organization_id,
            project_id,
            request_id,
            source="ENGAGEMENT_FILE",
            file_name=str(row[0]),
            content_type=str(row[1]),
            size=int(row[2]),
            key=str(row[3]),
            digest=str(row[4]),
            evidence_file_id=body.id,
        )
    found = _prior_workpapers(connection, organization_id, project_id, pbc, body.id)
    if not found:
        raise NotVisible()
    paper_id, prior_id, engagement, year, control_ref, stage = found[0]
    # The person must be able to read the earlier engagement, not only this one.
    _authorize(connection, principal, Action.TASK_READ, organization_id, prior_id)
    from ai_workforce_api.workpaper_export import workpaper_xlsx
    from ai_workforce_api.workpaper_service import _body as workpaper_body

    paper = workpaper_body(connection, prior_id, paper_id)
    content = workpaper_xlsx(engagement, [paper])
    reference = paper.content.reference if paper.content is not None else control_ref
    label = f"{year} " if year else ""
    key = f"evidence/{uuid4()}"
    digest = store.put(key, content)
    return _insert(
        connection,
        principal,
        organization_id,
        project_id,
        request_id,
        source="PRIOR_YEAR_WORKPAPER",
        file_name=clean_name(f"{label}{reference} {stage.lower()} workpaper.xlsx"),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size=len(content),
        key=key,
        digest=digest,
        prior=(prior_id, paper_id, year),
    )


def _attachable(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, request_id: UUID
) -> PbcBody:
    pbc = _read(connection, organization_id, project_id, request_id)
    if pbc.status in _CLOSED:
        raise DetailsState("The request is closed.")
    count = connection.execute(
        "SELECT count(*) FROM request_attachments WHERE pbc_request_id = %s AND removed_at IS NULL",
        (request_id,),
    ).fetchone()
    if count is not None and int(count[0]) >= MAX_ATTACHMENTS:
        raise DetailsState(f"A request holds at most {MAX_ATTACHMENTS} reference materials.")
    return pbc


def _insert(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    *,
    source: str,
    file_name: str,
    content_type: str,
    size: int,
    key: str,
    digest: str,
    evidence_file_id: UUID | None = None,
    prior: tuple[UUID, UUID, str] | None = None,
) -> AttachmentBody:
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO request_attachments (
                organization_id, project_id, pbc_request_id, source, file_name, content_type,
                size_bytes, object_key, content_sha256, evidence_file_id, prior_project_id,
                prior_workpaper_id, source_year, added_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                request_id,
                source,
                file_name,
                content_type,
                size,
                key,
                digest,
                evidence_file_id,
                None if prior is None else prior[0],
                None if prior is None else prior[1],
                "" if prior is None else prior[2],
                principal.id,
            ),
        ).fetchone()
        if row is None:
            raise NotVisible()
        attachment_id = UUID(str(row[0]))
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "pbc.attachment_added",
            "pbc_request",
            request_id,
            {"attachment_id": str(attachment_id), "source": source, "visibility": "INTERNAL"},
        )
    return _one_attachment(connection, request_id, attachment_id)


def _one_attachment(
    connection: psycopg.Connection[Any], request_id: UUID, attachment_id: UUID
) -> AttachmentBody:
    found = next(
        (item for item in _attachments(connection, request_id) if item.id == attachment_id), None
    )
    if found is None:
        raise NotVisible()
    return found


def _content(
    connection: psycopg.Connection[Any],
    store: Any,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    attachment_id: UUID,
) -> tuple[AttachmentBody, bytes]:
    _authorize(connection, principal, Action.TASK_READ, organization_id, project_id)
    row = connection.execute(
        """
        SELECT object_key, content_sha256 FROM request_attachments
        WHERE id = %s AND pbc_request_id = %s AND project_id = %s AND organization_id = %s
          AND removed_at IS NULL
        """,
        (attachment_id, request_id, project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    content = bytes(store.get(str(row[0])))
    if digest_of(content) != str(row[1]):
        raise StoreError("stored object changed")
    return _one_attachment(connection, request_id, attachment_id), content


def _remove(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    attachment_id: UUID,
    body: AttachmentVersion,
) -> list[AttachmentBody]:
    """Removed from the request, never deleted: the trail keeps what was attached."""
    _authorize(connection, principal, Action.TASK_UPDATE, organization_id, project_id)
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            UPDATE request_attachments
            SET removed_by = %s, removed_at = clock_timestamp(), version = version + 1
            WHERE id = %s AND pbc_request_id = %s AND project_id = %s AND organization_id = %s
              AND removed_at IS NULL AND version = %s
            RETURNING visibility
            """,
            (principal.id, attachment_id, request_id, project_id, organization_id, body.version),
        ).fetchone()
        if row is None:
            raise DetailsState("The attachment changed. Reload it and try again.")
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "pbc.attachment_removed",
            "pbc_request",
            request_id,
            {"attachment_id": str(attachment_id), "visibility": str(row[0])},
        )
    return _attachments(connection, request_id)


def _share(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    attachment_id: UUID,
    body: VisibilityBody,
) -> AttachmentBody:
    """Share a reference with the recipient, or make it internal again. Sharing is the
    explicit choice of someone who may approve requests; it shows the file on the owner's
    secure upload page for this request."""
    _authorize(connection, principal, Action.PROJECT_UPDATE, organization_id, project_id)
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    shared = body.visibility == "SHARED"
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            UPDATE request_attachments
            SET visibility = %s,
                shared_by = CASE WHEN %s THEN %s::uuid ELSE NULL END,
                shared_at = CASE WHEN %s THEN clock_timestamp() ELSE NULL END,
                version = version + 1
            WHERE id = %s AND pbc_request_id = %s AND project_id = %s AND organization_id = %s
              AND removed_at IS NULL AND version = %s AND visibility <> %s
            RETURNING id
            """,
            (
                body.visibility,
                shared,
                principal.id,
                shared,
                attachment_id,
                request_id,
                project_id,
                organization_id,
                body.version,
                body.visibility,
            ),
        ).fetchone()
        if row is None:
            raise DetailsState("The attachment changed. Reload it and try again.")
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "pbc.attachment_shared" if shared else "pbc.attachment_unshared",
            "pbc_request",
            request_id,
            {"attachment_id": str(attachment_id), "visibility": body.visibility},
        )
    return _one_attachment(connection, request_id, attachment_id)


# Helpers


def _read(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, request_id: UUID
) -> PbcBody:
    row = connection.execute(
        f"""
        SELECT {_PBC_COLUMNS} FROM pbc_requests
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (request_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _pbc_body(row)


def _lock(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, request_id: UUID
) -> PbcBody:
    row = cursor.execute(
        f"""
        SELECT {_PBC_COLUMNS} FROM pbc_requests
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (request_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _pbc_body(row)


def _authorize(
    connection: psycopg.Connection[Any],
    principal: Principal,
    action: Action,
    organization_id: UUID,
    project_id: UUID,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=action,
        organization_id=organization_id,
        project_id=project_id,
    )


def _allowed(
    connection: psycopg.Connection[Any],
    principal: Principal,
    action: Action,
    organization_id: UUID,
    project_id: UUID,
) -> bool:
    try:
        _authorize(connection, principal, action, organization_id, project_id)
    except AccessDenied, NotVisible:
        return False
    return True


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    target_type: str,
    target_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, actor_id, action, target_type, target_id, Json(payload)),
    )
