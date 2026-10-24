"""Owner assignment for draft requests addressed to no one (Release 2b-2; docs/release-2b.md).

The agent suggests who each request should go to from the engagement's own records only,
and says where each suggestion comes from; a person confirms many at once or picks someone
else for any of them. Nothing is invented: without a reliable record there is no
suggestion, and a request addressed to no one stays unsendable. Confirming sets each
request's recipient through the single request's own assignment (request_details._assign:
the same address checks, version check, and audit), so the request then travels with that
person's other requests (evidence_groups).
"""

import re
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.settings import Settings

Source = Literal["CONTROL_OWNER", "SAME_CONTROL", "CONTACT", "SAME_SYSTEM"]
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
MAX_ITEMS = 500


class Suggestion(BaseModel):
    name: str
    email: str
    source: Source
    # Where it comes from, in words, for the person confirming it.
    label: str


class Unassigned(BaseModel):
    id: UUID
    version: int
    reference: str
    control_id: UUID
    control_ref: str
    control_title: str
    system: str
    phase: str | None
    suggestion: Suggestion | None


class Contact(BaseModel):
    name: str
    email: str
    role: str
    source: str


class OwnersBody(BaseModel):
    items: list[Unassigned]
    # The engagement's people at the client and its email domains, for choosing someone else.
    contacts: list[Contact]
    domains: list[str]


class AssignItem(BaseModel):
    id: UUID
    version: int = Field(ge=1)
    recipient: str = Field(min_length=3, max_length=254)


class AssignBody(BaseModel):
    items: list[AssignItem] = Field(min_length=1, max_length=MAX_ITEMS)


class Outcome(BaseModel):
    id: UUID
    ok: bool
    detail: str


class AssignResult(BaseModel):
    done: int
    refused: int
    outcomes: list[Outcome]


# Suggestions


def _confirmed(connection: psycopg.Connection[Any], project_id: UUID) -> list[tuple[Any, ...]]:
    """Recipients a person confirmed: on a request that was approved or sent, or set on a
    draft by a person. (control, area, system, recipient)."""
    return connection.execute(
        """
        SELECT r.engagement_control_id, c.domain, coalesce(a.name, ''), lower(btrim(r.recipient))
        FROM pbc_requests r
        JOIN engagement_controls c ON c.id = r.engagement_control_id AND c.included
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE r.project_id = %s AND btrim(r.recipient) <> '' AND r.status <> 'CANCELLED'
          AND (r.status <> 'DRAFT' OR EXISTS (
                SELECT 1 FROM audit_events e
                WHERE e.project_id = r.project_id AND e.target_type = 'pbc_request'
                  AND e.target_id = r.id AND e.action = 'pbc.assignment_changed'
                  AND e.actor_user_id IS NOT NULL AND e.payload ? 'recipient'))
        """,
        (project_id,),
    ).fetchall()


def _one(values: set[str]) -> str | None:
    return next(iter(values)) if len(values) == 1 else None


def suggestions(
    connection: psycopg.Connection[Any], settings: Settings, project_id: UUID
) -> OwnersBody:
    """Every draft addressed to no one, with who it should go to when a reliable record
    says so: the control's owner in the RCM; the person already confirmed for the same
    control's other requests; a contact a person named for the control; or the one person
    confirmed for the same area's requests on the same system. Ambiguous records suggest
    nothing; so does an address the engagement cannot send to."""
    from ai_workforce_api.controls import DOMAIN_LABELS
    from ai_workforce_api.request_details import address_problem, client_domains, contacts

    domains = client_domains(connection, project_id)
    people = contacts(connection, project_id)
    # Only a name a record holds; never one made up from the address.
    names = {
        person.email: person.name
        for person in people
        if person.name and person.name != person.email.split("@", 1)[0]
    }
    by_control: dict[Any, set[str]] = defaultdict(set)
    by_system: dict[tuple[str, str], set[str]] = defaultdict(set)
    for control, area, system, recipient in _confirmed(connection, project_id):
        if _EMAIL.fullmatch(str(recipient)):
            by_control[control].add(str(recipient))
            if system:
                by_system[(str(area), str(system))].add(str(recipient))
    named: dict[str, set[str]] = defaultdict(set)
    for email, role in connection.execute(
        "SELECT lower(email), role FROM engagement_contacts WHERE project_id = %s", (project_id,)
    ).fetchall():
        for ref in re.findall(r"[A-Z][A-Z0-9]*(?:-[A-Z0-9.]+)+", str(role).upper()):
            named[ref.rstrip(".")].add(str(email))
    items: list[Unassigned] = []
    for row in connection.execute(
        """
        SELECT r.id, r.version, r.testing_phase, c.id, c.control_ref, c.title, c.owner_name,
               lower(btrim(c.owner_email)), c.domain, coalesce(a.name, '')
        FROM pbc_requests r
        JOIN engagement_controls c ON c.id = r.engagement_control_id AND c.included
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE r.project_id = %s AND r.status = 'DRAFT' AND btrim(r.recipient) = ''
        ORDER BY c.control_ref, r.testing_phase, r.created_at
        """,
        (project_id,),
    ).fetchall():
        control, ref, area, system = row[3], str(row[4]), str(row[8]), str(row[9])
        area_label = DOMAIN_LABELS.get(area, area.replace("_", " ").title()).lower()
        found: list[tuple[str | None, Source, str]] = [
            (str(row[7]) if _EMAIL.fullmatch(str(row[7])) else None, "CONTROL_OWNER",
             "Control owner in the RCM"),
            (_one(by_control.get(control, set())), "SAME_CONTROL",
             "Receives this control's other requests"),
            (_one(named.get(ref.upper(), set())), "CONTACT",
             f"Named for {ref} in the engagement contacts"),
            (_one(by_system.get((area, system), set())) if system else None, "SAME_SYSTEM",
             f"Receives the {area_label} requests for {system}"),
        ]  # fmt: skip
        suggestion = None
        for email, source, label in found:
            if email is not None and address_problem(settings, email, domains) is None:
                name = str(row[6]).strip() if source == "CONTROL_OWNER" else ""
                suggestion = Suggestion(
                    name=name or names.get(email, ""), email=email, source=source, label=label
                )
                break
        items.append(
            Unassigned(
                id=UUID(str(row[0])),
                version=int(row[1]),
                reference=f"PBC-{UUID(str(row[0])).hex[-8:].upper()}",
                control_id=UUID(str(control)),
                control_ref=ref,
                control_title=str(row[5]),
                system=system,
                phase=None if row[2] is None else str(row[2]),
                suggestion=suggestion,
            )
        )
    return OwnersBody(
        items=items,
        contacts=[
            Contact(name=p.name, email=p.email, role=p.role, source=p.source) for p in people
        ],
        domains=domains,
    )


# Confirming


def assign(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: AssignBody,
) -> AssignResult:
    """Each request gets the recipient the person confirmed, on its own: one that cannot
    change says why and the others go through. Copies, due date, and priority stay."""
    from ai_workforce_api.request_details import AssignmentBody, DetailsState, _assign
    from ai_workforce_api.request_details import _read as read_request

    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    if len({item.id for item in body.items}) != len(body.items):
        raise ValueError("each request can appear once")
    outcomes: list[Outcome] = []
    for item in body.items:
        try:
            current = read_request(connection, organization_id, project_id, item.id)
        except NotVisible:
            outcomes.append(Outcome(id=item.id, ok=False, detail="This request was not found."))
            continue
        if current.status != "DRAFT" or current.recipient.strip() != "":
            outcomes.append(
                Outcome(id=item.id, ok=False, detail="This request already has an owner.")
            )
            continue
        try:
            _assign(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                item.id,
                AssignmentBody(
                    version=item.version,
                    recipient=item.recipient,
                    cc=current.cc_recipients,
                    due_on=current.due_at.astimezone(UTC).date(),
                    priority=current.priority,  # type: ignore[arg-type]
                ),
            )
        except DetailsState as error:
            outcomes.append(Outcome(id=item.id, ok=False, detail=error.detail))
            continue
        except ValueError:
            outcomes.append(
                Outcome(id=item.id, ok=False, detail="The change is not valid for this request.")
            )
            continue
        outcomes.append(Outcome(id=item.id, ok=True, detail="Assigned."))
    done = sum(1 for outcome in outcomes if outcome.ok)
    return AssignResult(done=done, refused=len(outcomes) - done, outcomes=outcomes)


# Routes


def register_evidence_owners(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/evidence-owners"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    def read(
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
    ) -> OwnersBody:
        authorize(
            connection,
            principal=principal,
            action=Action.TASK_READ,
            organization_id=organization_id,
            project_id=project_id,
        )
        return suggestions(connection, settings, project_id)

    @app.get(base)
    def list_owners(organization_id: UUID, project_id: UUID, request: Request) -> OwnersBody:
        """Every draft addressed to no one, with a suggested owner where a record says so."""
        return run(request, lambda c, p: read(c, p, organization_id, project_id))

    @app.post(f"{base}/assign")
    def assign_owners(
        organization_id: UUID, project_id: UUID, body: AssignBody, request: Request
    ) -> AssignResult:
        """Confirm owners for many requests at once, each with its own recipient."""
        return run(
            request,
            lambda c, p: assign(c, settings, p, organization_id, project_id, body),
        )
