"""Approve and send a control's evidence requests from its own Request step (decided by the
product owner on 28 October 2026: "is there an option to approve this and send to the
process owner then automatically captured in the evidence center? If the control owner is
not available it should show a pop up to assign the control owner").

Nothing here sends on its own: a draft addressed to no one goes to the control's owner
through the request's own assignment (request_details._assign), and the drafts are then
approved and sent through the Evidence center's bulk change (evidence_center.bulk), the
one path that approves each agent's draft, records the approval, and sends with it. A
draft that travels with other controls' requests to the same person goes as that one
request (evidence_groups), as it would from the Evidence center; the preview says which.
The requests are the Evidence center's own records, so they appear there as sent.
"""

import hashlib
import re
from collections.abc import Callable
from datetime import UTC
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
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
from ai_workforce_api.settings import Settings

_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
REASON = "Reviewed and approved from the control's Request step."
# Why a prepared request waits, as the person reads it on the Request step.
_WAITS = {
    "release the interim phase first": (
        "Will become available after design and implementation testing and interim release."
    ),
    "release the roll-forward phase first": (
        "Will become available after interim testing and roll-forward release."
    ),
}


class Routing(BaseModel):
    """Who one request (as the review shows it: a group or a single request) goes to, and
    who is copied, changed in the review before sending (28 October 2026)."""

    id: UUID
    recipient: str = Field(min_length=3, max_length=254)
    cc: list[str] = Field(default_factory=list, max_length=10)


class Seen(BaseModel):
    """An email as the review showed it: the request it is (as the review named it) and
    the fingerprint of its subject and text (SendTarget.digest)."""

    id: UUID
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")


# The email that would go is not the one the review showed (who it goes to was changed in
# the review, so it greets someone else, or it now travels with other requests). Decided
# with the review of the redesign (13 November 2026): what is read is what is sent, so
# it is not approved; the changes are kept, and the next review shows the email as it goes.
REVIEW_AGAIN = (
    "Who this goes to was changed, and the email now reads differently from the one you "
    "reviewed. Your changes are saved: review the email again, then send it."
)


class ControlSendBody(BaseModel):
    # Only check: say what would go, to whom, and with what; change nothing.
    preview: bool = True
    # Changes made in the review: applied, through each request's own assignment, when sent.
    routing: list[Routing] = Field(default_factory=list, max_length=50)
    # The control's owner, when it has none: set on the control, and the drafts addressed
    # to no one go to them.
    owner_name: str | None = Field(default=None, max_length=200)
    owner_email: str | None = Field(default=None, max_length=200)
    # The emails as the review showed them. With a send: a request whose email would now
    # read differently is not approved (REVIEW_AGAIN). None given: nothing is compared.
    seen: list[Seen] = Field(default_factory=list, max_length=100)


class SendTarget(BaseModel):
    id: UUID
    reference: str
    title: str
    recipient: str
    # The other controls whose requests travel in the same email.
    other_controls: list[str]
    ok: bool
    detail: str
    # Prepared ahead and held until its phase is released: expected, not a failure.
    waiting: bool = False
    # The testing phase it serves (DESIGN, INTERIM, ROLLFORWARD), when it is one request.
    phase: str = ""
    # The email as it will go, read in the review before anything is approved (product
    # owner, 12 November 2026: "It's not easy to find the email template"). Rendered by the
    # send's own functions (outbound.render, evidence_groups.render_group), so the review
    # shows the text the send renders again and checks; the upload link is added when sent.
    # Empty when the text cannot be rendered (the send then refuses it with its reason).
    subject: str = ""
    body: str = ""
    # The same email laid out as the recipient's mail client shows it (email_html.to_html,
    # the layout the live send attaches): built only from the subject and text above.
    html: str = ""
    # The fingerprint of the subject and text above: sent back with the send (Seen), so
    # the email approved is the one that was read.
    digest: str = ""


class OwnerChoice(BaseModel):
    name: str
    email: str
    role: str


class ControlSendResult(BaseModel):
    preview: bool
    control_ref: str = ""
    control_title: str = ""
    # When an owner is asked for: the engagement's people at the client to choose from, and
    # its email domains (evidence_owners.suggestions, the Evidence center's own list).
    contacts: list[OwnerChoice] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    # The control has no owner and a draft is addressed to no one: ask for the owner.
    needs_owner: bool
    owner_name: str
    owner_email: str
    drafts: int
    targets: list[SendTarget]
    done: int
    refused: int


def _control(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> tuple[str, str, str, str]:
    row = connection.execute(
        "SELECT control_ref, owner_name, owner_email, title FROM engagement_controls "
        "WHERE id = %s AND project_id = %s",
        (control_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return (
        str(row[0]),
        str(row[1] or "").strip(),
        str(row[2] or "").strip().lower(),
        str(row[3] or ""),
    )


def _drafts(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[tuple[UUID, str]]:
    """The control's agent drafts waiting for a person's approval, with their recipient."""
    return [
        (UUID(str(row[0])), str(row[1] or "").strip())
        for row in connection.execute(
            "SELECT id, recipient FROM pbc_requests WHERE project_id = %s "
            "AND engagement_control_id = %s AND status = 'DRAFT' AND drafted_by = 'AGENT' "
            "ORDER BY created_at",
            (project_id, control_id),
        ).fetchall()
    ]


def _phase_title(phase: str | None) -> str:
    """A draft without a title of its own, named by its phase, never by a code."""
    from ai_workforce_api.evidence_planning import PHASE_LABELS

    label = PHASE_LABELS.get(str(phase), "")
    return f"{label} evidence request" if label else "Evidence request"


def _with_email(
    connection: Any,
    organization_id: UUID,
    project_id: UUID,
    shown: dict[UUID, SendTarget],
    groups: dict[UUID, Any],
    routing: list[Routing] | None = None,
    proposed: dict[str, str] | None = None,
) -> None:
    """Each target that goes now, with its email's subject and text as the send renders
    it: to the recipient the send will use (the review's change, else the request's own,
    else the control's owner) and, for an owner named in the review and not saved yet,
    with that name (`proposed`)."""
    from ai_workforce_api.email_html import to_html
    from ai_workforce_api.evidence_groups import _pbcs, render_group, sections_for
    from ai_workforce_api.outbound import _engagement, _read_pbc, render_request

    engagement = _engagement(connection, organization_id, project_id)
    changes = {change.id: change for change in routing or []}

    def addressed(request: Any, key: UUID, fallback: str) -> Any:
        change = changes.get(key)
        if change is not None:
            return request.model_copy(
                update={
                    "recipient": change.recipient.strip().lower(),
                    "cc_recipients": [a.strip().lower() for a in change.cc],
                }
            )
        if request.recipient.strip() == "":
            return request.model_copy(update={"recipient": fallback})
        return request

    for key, target in shown.items():
        if target.waiting or not target.ok:
            continue
        try:
            grouped = groups.get(key)
            if grouped is not None:
                members = [m for m, _ in grouped.members]
                pbcs = _pbcs(connection, organization_id, project_id, members)
                going = [addressed(pbcs[m], key, target.recipient) for m in members]
                message = render_group(
                    key, members[0], sections_for(connection, going, None, proposed), engagement
                )
            else:
                request = addressed(
                    _read_pbc(connection, organization_id, project_id, key), key, target.recipient
                )
                message = render_request(connection, request, engagement, proposed=proposed)
        except ValueError, KeyError, IndexError, NotVisible:
            continue
        shown[key] = target.model_copy(
            update={
                "recipient": message.recipient or target.recipient,
                "subject": message.subject,
                "body": message.body,
                "html": to_html(message.subject, message.body),
                "digest": text_digest(message.subject, message.body),
            }
        )


def text_digest(subject: str, body: str) -> str:
    """The fingerprint of an email's subject and text, as the review shows them."""
    return hashlib.sha256(f"{subject}\n{body}".encode()).hexdigest()


def _check_routing(routing: list[Routing]) -> None:
    for change in routing:
        addresses = [change.recipient, *change.cc]
        if any(_EMAIL.fullmatch(a.strip().lower()) is None for a in addresses):
            raise ValueError("give a valid email address for each recipient")
        if contains_secret({"addresses": " ".join(addresses)}):
            raise ValueError("an address holds a credential")


def _route(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    routing: list[Routing],
    shown: dict[UUID, Any],
) -> None:
    """Each change on every draft of the request it names (a group's members, or the one
    request), through the request's own assignment: its address checks and its audit."""
    from ai_workforce_api.evidence_center import _read
    from ai_workforce_api.request_details import AssignmentBody, _assign

    for change in routing:
        group = shown.get(change.id)
        members = [m for m, _ in group.members] if group is not None else [change.id]
        for member in members:
            current = _read(connection, organization_id, project_id, member)
            if current is None or current.status != "DRAFT":
                continue
            _assign(
                connection, settings, principal, organization_id, project_id, member,
                AssignmentBody(
                    version=current.version,
                    recipient=change.recipient.strip().lower(),
                    cc=[a.strip().lower() for a in change.cc],
                    due_on=current.due_at.astimezone(UTC).date(),
                    priority=current.priority,  # type: ignore[arg-type]
                ),
            )  # fmt: skip


def _owner(body: ControlSendBody) -> tuple[str, str] | None:
    if body.owner_email is None and body.owner_name is None:
        return None
    name = " ".join((body.owner_name or "").split())
    email = (body.owner_email or "").strip().lower()
    if not name or _EMAIL.fullmatch(email) is None:
        raise ValueError("name the owner and give a valid email")
    if contains_secret({"name": name, "email": email}):
        raise ValueError("the owner holds a credential")
    return name, email


def control_send(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: ControlSendBody,
    mailbox: Any = None,
    timer: Any = None,
) -> ControlSendResult:
    from ai_workforce_api.evidence_center import BulkBody, BulkItem, _read, bulk
    from ai_workforce_api.evidence_groups import bulk_targets
    from ai_workforce_api.evidence_plans import held_for_planning
    from ai_workforce_api.request_details import AssignmentBody, _assign

    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    control_ref, owner_name, owner_email, control_title = _control(
        connection, project_id, control_id
    )
    given = _owner(body)
    if given is not None:
        owner_name, owner_email = given
    drafts = _drafts(connection, project_id, control_id)
    unaddressed = [draft for draft, recipient in drafts if recipient == ""]
    if unaddressed and _EMAIL.fullmatch(owner_email) is None:
        from ai_workforce_api.evidence_owners import suggestions

        people = suggestions(connection, settings, project_id)
        return ControlSendResult(
            preview=body.preview, control_ref=control_ref, control_title=control_title,
            contacts=[
                OwnerChoice(name=c.name, email=c.email, role=c.role) for c in people.contacts
            ],
            domains=people.domains, needs_owner=True, owner_name=owner_name, owner_email="",
            drafts=len(drafts), targets=[], done=0, refused=0,
        )  # fmt: skip
    _check_routing(body.routing)
    if not body.preview:
        # The requests as the review showed them, so a change names the same ones.
        before = bulk_targets(connection, principal, organization_id, project_id)
        with transaction(connection):
            if given is not None:
                # The owner is the control's, on every instance of it (onboarding._owner_batch).
                from ai_workforce_api.onboarding import OwnerBatch, _owner_batch

                _owner_batch(
                    connection, principal, organization_id, project_id,
                    OwnerBatch(control_ids=[control_id], owner_name=owner_name,
                               owner_email=owner_email),
                )  # fmt: skip
            for draft in unaddressed:
                current = _read(connection, organization_id, project_id, draft)
                if current is None:
                    continue
                _assign(
                    connection, settings, principal, organization_id, project_id, draft,
                    AssignmentBody(
                        version=current.version, recipient=owner_email,
                        cc=current.cc_recipients,
                        due_on=current.due_at.astimezone(UTC).date(),
                        priority=current.priority,  # type: ignore[arg-type]
                    ),
                )  # fmt: skip
            _route(
                connection, settings, principal, organization_id, project_id,
                body.routing, before,
            )  # fmt: skip
        drafts = _drafts(connection, project_id, control_id)

    # Each draft goes as the request the Evidence center shows: its group, or itself.
    groups = bulk_targets(connection, principal, organization_id, project_id)
    refs: dict[UUID, str] = {
        UUID(str(row[0])): str(row[1])
        for row in connection.execute(
            "SELECT id, control_ref FROM pbc_requests WHERE project_id = %s", (project_id,)
        ).fetchall()
    }
    recipients = dict(drafts)
    items: list[BulkItem] = []
    shown: dict[UUID, SendTarget] = {}
    for draft, recipient in drafts:
        # Interim and roll-forward requests are prepared ahead and wait for their phase to
        # be released (milestone E): they are not sent, and not a failure.
        held = held_for_planning(connection, draft)
        if held is not None and held.startswith("release the"):
            current = _read(connection, organization_id, project_id, draft)
            if current is not None:
                shown[draft] = SendTarget(
                    id=draft, reference=f"PBC-{str(draft).replace('-', '')[-8:].upper()}",
                    title=current.title or _phase_title(current.testing_phase),
                    recipient=recipient or owner_email, other_controls=[], ok=False,
                    detail=_WAITS.get(held, "Will become available once its phase is released."),
                    waiting=True, phase=str(current.testing_phase or ""),
                )  # fmt: skip
            continue
        group = next(
            (gid for gid, target in groups.items() if draft in {m for m, _ in target.members}),
            None,
        )
        if group is not None:
            if group in shown:
                continue
            grouped = groups[group]
            others = sorted(
                {refs.get(m, "") for m, _ in grouped.members if m not in recipients} - {""}
            )
            items.append(BulkItem(id=group, version=max(1, grouped.version)))
            shown[group] = SendTarget(
                id=group, reference=grouped.reference, title=grouped.title,
                recipient=recipient or owner_email, other_controls=others, ok=True, detail="",
            )  # fmt: skip
            continue
        current = _read(connection, organization_id, project_id, draft)
        if current is None:
            continue
        items.append(BulkItem(id=draft, version=current.version))
        shown[draft] = SendTarget(
            id=draft, reference=f"PBC-{str(draft).replace('-', '')[-8:].upper()}",
            title=current.title or _phase_title(current.testing_phase),
            recipient=recipient or owner_email,
            other_controls=[], ok=True, detail="", phase=str(current.testing_phase or ""),
        )  # fmt: skip
    changed: list[SendTarget] = []
    if body.preview:
        _with_email(
            connection, organization_id, project_id, shown, groups, body.routing,
            None if given is None else {owner_email: owner_name},
        )  # fmt: skip
    elif body.seen:
        # The owner and the review's changes are saved: each email as it goes now,
        # against the one the review showed.
        _with_email(connection, organization_id, project_id, shown, groups)
        seen = {item.id: item.digest for item in body.seen}
        for key, target in list(shown.items()):
            if target.ok and not target.waiting and target.digest not in ("", seen.get(key)):
                shown[key] = target.model_copy(update={"ok": False, "detail": REVIEW_AGAIN})
                changed.append(shown[key])
        refused = {target.id for target in changed}
        items = [item for item in items if item.id not in refused]
    waiting = [target for target in shown.values() if target.waiting]
    # The engagement's people at the client, for changing who a request goes to.
    choices: list[OwnerChoice] = []
    domains: list[str] = []
    if body.preview:
        from ai_workforce_api.evidence_owners import suggestions

        listed = suggestions(connection, settings, project_id)
        choices = [OwnerChoice(name=c.name, email=c.email, role=c.role) for c in listed.contacts]
        domains = listed.domains
    if not items:
        return ControlSendResult(
            preview=body.preview, control_ref=control_ref, control_title=control_title,
            contacts=choices, domains=domains,
            needs_owner=False, owner_name=owner_name, owner_email=owner_email,
            drafts=len(drafts), targets=[*waiting, *changed], done=0, refused=len(changed),
        )  # fmt: skip
    if body.preview and unaddressed:
        # Addressed only when sent: say where they will go, nothing checked yet.
        for ready in shown.values():
            if not ready.waiting:
                ready.detail = "Ready to approve and send."
        return ControlSendResult(
            preview=True, control_ref=control_ref, control_title=control_title,
            contacts=choices, domains=domains,
            needs_owner=False, owner_name=owner_name, owner_email=owner_email,
            drafts=len(drafts), targets=list(shown.values()),
            done=len(shown) - len(waiting), refused=0,
        )  # fmt: skip
    result = bulk(
        connection, settings, principal, organization_id, project_id,
        BulkBody(action="APPROVE_SEND", items=items, preview=body.preview, reason=REASON),
        mailbox=mailbox, timer=timer,
    )  # fmt: skip
    for outcome in result.outcomes:
        said = shown.get(outcome.id)
        if said is not None:
            said.ok, said.detail = outcome.ok, outcome.detail
    return ControlSendResult(
        preview=body.preview, control_ref=control_ref, control_title=control_title,
        contacts=choices, domains=domains,
            needs_owner=False, owner_name=owner_name,
        owner_email=owner_email, drafts=len(drafts), targets=list(shown.values()),
        done=result.done, refused=result.refused + len(changed),
    )  # fmt: skip


def register_control_send(
    app: FastAPI,
    settings: Settings,
    mailbox: Any = None,
    timer: Any = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.post(f"{base}/evidence-requests/approve-send")
    def approve_send(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: ControlSendBody,
        request: Request,
    ) -> ControlSendResult:
        """Approve and send the control's drafts to its owner, as the Evidence center does."""
        return run(
            request,
            lambda c, p: control_send(
                c, settings, p, organization_id, project_id, control_id, body, mailbox, timer
            ),
        )
