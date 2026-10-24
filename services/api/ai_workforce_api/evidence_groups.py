"""Grouped evidence requests (Release 2b-1, Option 1; docs/release-2b.md).

One person receives one request for a phase: the per-control requests the evidence
coordinator drafted for them travel together, approved in one action, sent in one email,
and reminded in one workflow. The per-control requests stay authoritative for
requirements, receipts, and testing. Each is approved through the existing approval
engine, bound to the group's email, and the group's approval record holds exactly what
was approved (migration 0107).

Until a person approves it, a group is a proposal computed from untouched agent drafts,
so regrouping is automatic. It never restructures what a person shaped, what awaits
approval, or what was sent. A draft a person changed is offered in the group's review
for a person to include. Grouping is never shown as a concept: the person sees one
request.

Sending is durable. The approval commits first (every member, the group, and the record,
in one transaction). The single outbound message is then recorded against the lead
member's approval through the outbound engine, which never sends one approval twice and
resumes an interrupted send. A send that cannot go returns the members to draft, with
the reason kept.
"""

import logging
import re
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from string import Template
from typing import Any, Literal
from uuid import UUID, uuid5

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.approvals import (
    ApprovalCreate,
    ApprovalState,
    _request,
    approve_agent_request,
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
from ai_workforce_api.followups import REMINDABLE, FollowUpState, FollowUpTimer, schedule
from ai_workforce_api.mailbox import open_mailbox
from ai_workforce_api.pbc import _COLUMNS as _PBC_COLUMNS
from ai_workforce_api.pbc import PbcBody, PbcState
from ai_workforce_api.pbc import _body as _pbc_body
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

GroupStatus = Literal["PROPOSED", "APPROVED", "SENT", "NOT_SENT"]
NotSentReason = Literal["delivery_failed", "approval_expired", "changed_since_approval"]
GROUP_TEMPLATE_ID = "pbc-group"
GROUP_REMINDER_TEMPLATE_ID = "pbc-group-reminder"
# A request is a task one person can follow: the R2a guidelines (owner, 24 October 2026).
MAX_ITEMS = 25
MAX_FAMILIES = 2
DUE_SPREAD_DAYS = 14
_NAMESPACE = UUID("5f0c9c1e-6a43-4c55-9d1f-2b7e0c3a8d61")
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_LIVE = ("APPROVED", "SENT")
_NOT_SENT_WORDS: dict[str, str] = {
    "delivery_failed": "The mail provider did not accept it.",
    "approval_expired": "The approval expired before it was sent.",
    "changed_since_approval": "A request in it changed after it was approved.",
}


class GroupState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


# Wording


def _templates() -> tuple[Any, Any]:
    from ai_workforce_api.outbound import MessageTemplate

    request = MessageTemplate(
        template_id=GROUP_TEMPLATE_ID,
        version=1,
        subject="[$reference] Evidence request for $engagement",
        body=(
            "Hello,\n\n"
            "The audit team for $engagement needs the evidence below by $due.\n\n"
            "$sections\n\n"
            "Please upload it through your secure link, where each item is described in "
            "full:\n"
            "$upload_link\n\n"
            "When you open the link, a one-time code is emailed to this address. Files sent "
            "as email attachments cannot be accepted.\n\n"
            "If you have a question, reply to this email.\n\n"
            "Thank you."
        ),
    )
    reminder = MessageTemplate(
        template_id=GROUP_REMINDER_TEMPLATE_ID,
        version=1,
        subject="[$reference] Reminder: evidence request for $engagement",
        body=(
            "Hello,\n\n"
            "A reminder ($sequence of $limit) about the evidence the audit team for "
            "$engagement needs by $due. Still outstanding:\n\n"
            "$sections\n\n"
            "Please upload it through your secure link:\n"
            "$upload_link\n\n"
            "If you have already uploaded it, thank you; you can ignore this reminder."
        ),
    )
    return request, reminder


@dataclass(frozen=True)
class Section:
    """One member as the email shows it."""

    id: UUID
    control_ref: str
    description: str
    due_at: datetime
    recipient: str
    cc: tuple[str, ...]
    # The control's name and its system: what the reader sees instead of internal IDs.
    control_title: str = ""
    system: str = ""


def section_of(pbc: PbcBody, control_title: str = "", system: str = "") -> Section:
    return Section(
        id=pbc.id,
        control_ref=pbc.control_ref.strip(),
        description=pbc.evidence_description,
        due_at=pbc.due_at,
        recipient=pbc.recipient.strip(),
        cc=tuple(item.strip().lower() for item in pbc.cc_recipients if item.strip()),
        control_title=" ".join(control_title.split())[:160],
        system=" ".join(system.split())[:120],
    )


def sections_for(connection: Any, pbcs: list[PbcBody]) -> list[Section]:
    """The members as the email shows them, by their controls' names and systems."""
    names = {
        UUID(str(row[0])): (str(row[1]), str(row[2]))
        for row in connection.execute(
            "SELECT c.id, c.title, coalesce(a.name, '') FROM engagement_controls c "
            "LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id "
            "WHERE c.id = ANY(%s)",
            ([p.engagement_control_id for p in pbcs if p.engagement_control_id is not None],),
        ).fetchall()
    }
    found: list[Section] = []
    for p in pbcs:
        title, system = (
            names.get(p.engagement_control_id, ("", "")) if p.engagement_control_id else ("", "")
        )
        found.append(section_of(p, title, system))
    return found


def reference_of(group_id: UUID) -> str:
    return f"PBC-{group_id.hex[-8:].upper()}"


def _day(moment: datetime) -> str:
    due = moment.astimezone(UTC)
    return f"{due.day} {due:%B %Y}"


def _heading(section: Section) -> tuple[str, list[str]]:
    """The member's heading and its items in brief (number, title, period)."""
    from ai_workforce_api.request_details import heading_of, parse_wording

    content = parse_wording(section.description)
    heading = section.control_title or heading_of(content) or section.control_ref
    if section.system:
        heading += f" ({section.system})"
    items: list[str] = []
    for item in content.items:
        line = f"{item.number}. {item.title}"
        if item.period:
            line += f"\n   Period: {item.period}"
        items.append(line)
    if not items:
        first = next((x.strip() for x in section.description.splitlines() if x.strip()), "")
        if first and first != heading:
            items.append(first[:300])
    return heading[:200], items


def _block(section: Section, due: datetime, with_items: bool) -> str:
    heading, items = _heading(section)
    if section.due_at.astimezone(UTC).date() != due.astimezone(UTC).date():
        heading += f" (due {_day(section.due_at)})"
    if not with_items:
        return f"- {heading}"
    return "\n".join([heading, *items])


def _shared(sections: list[Section]) -> tuple[str, tuple[str, ...]]:
    recipients = {s.recipient.lower() for s in sections}
    copies = {s.cc for s in sections}
    if len(sections) < 1 or len(recipients) != 1 or len(copies) != 1:
        raise ValueError("members do not share one recipient")
    return sections[0].recipient, sections[0].cc


def render_group(group_id: UUID, lead_id: UUID, sections: list[Section], engagement: str) -> Any:
    """The group's one email, from its members as they stand. Deterministic: the send
    renders it again and refuses anything but the approved content."""
    from ai_workforce_api.evidence_portal import LINK_PLACEHOLDER
    from ai_workforce_api.outbound import RenderedMessage, _digest

    template, _ = _templates()
    recipient, cc = _shared(sections)
    due = min(s.due_at for s in sections)
    reference = reference_of(group_id)
    values = {
        "reference": reference,
        "count": str(len(sections)),
        "engagement": " ".join(engagement.split())[:200] or "this engagement",
        "due": _day(due),
        "sections": "\n\n".join(_block(s, due, True) for s in sections),
        "upload_link": LINK_PLACEHOLDER,
    }
    subject = Template(template.subject).substitute(values)
    body = Template(template.body).substitute(values)
    if len(body) > 3800:
        # The items do not fit one email: every control is still named, and its items
        # are on the secure link, as a single request's brief does (outbound._compose).
        values["sections"] = "\n".join(_block(s, due, False) for s in sections)
        body = Template(template.body).substitute(values)
    if len(subject) > 200 or len(body) > 3800:
        raise ValueError("message is too long")
    digest = _digest(recipient, cc, subject, body)
    return RenderedMessage(
        template=template,
        recipient=recipient,
        subject=subject,
        body=body,
        reference=reference,
        content_sha256=digest,
        request_ref=_ref(lead_id, group_id, digest),
        metadata={
            "request_id": str(lead_id),
            "request_reference": reference,
            "template": f"{template.template_id}.v{template.version}",
            "group_id": str(group_id),
        },
        cc=cc,
    )


def render_group_reminder(
    group_id: UUID,
    lead: PbcBody,
    open_sections: list[Section],
    engagement: str,
    follow_up_id: UUID,
    sequence: int,
) -> Any:
    """The group's reminder, in its thread, listing what is still open."""
    from ai_workforce_api.evidence_portal import LINK_PLACEHOLDER
    from ai_workforce_api.outbound import (
        REMINDER_ACTION_ID,
        RenderedMessage,
        _digest,
    )

    if lead.thread_id is None:
        raise ValueError("request has no thread")
    if not open_sections:
        raise ValueError("nothing is open")
    _, template = _templates()
    recipient, cc = _shared(open_sections)
    due = min(s.due_at for s in open_sections)
    reference = reference_of(group_id)
    values = {
        "reference": reference,
        "count": str(len(open_sections)),
        "engagement": " ".join(engagement.split())[:200] or "this engagement",
        "due": _day(due),
        "sections": "\n".join(_block(s, due, False) for s in open_sections),
        "upload_link": LINK_PLACEHOLDER,
        "sequence": str(sequence),
        "limit": str(max(sequence, lead.max_follow_ups)),
    }
    subject = Template(template.subject).substitute(values)
    body = Template(template.body).substitute(values)
    if len(subject) > 200 or len(body) > 3800:
        raise ValueError("message is too long")
    digest = _digest(recipient, cc, subject, body)
    version = f"{template.template_id}-v{template.version}"
    return RenderedMessage(
        template=template,
        recipient=recipient,
        subject=subject,
        body=body,
        reference=reference,
        content_sha256=digest,
        request_ref=f"pbc/{lead.id}/{version}/{follow_up_id}/{digest[:16]}",
        metadata={
            "request_id": str(lead.id),
            "request_reference": reference,
            "template": f"{template.template_id}.v{template.version}",
            "group_id": str(group_id),
            "follow_up_id": str(follow_up_id),
            "follow_up_sequence": str(sequence),
        },
        action_id=REMINDER_ACTION_ID,
        thread_id=lead.thread_id,
        cc=cc,
    )


def _ref(request_id: UUID, group_id: UUID, digest: str) -> str:
    # pbc/{request}/... keeps every per-request reader of approvals working.
    return f"pbc/{request_id}/{GROUP_TEMPLATE_ID}-v1/{group_id}/{digest[:16]}"


def member_parameters(message: Any, request_id: UUID, group_id: UUID) -> dict[str, str]:
    """What a member's approval binds: the group's recipient, subject, and content."""
    return {
        "recipient": message.recipient,
        "subject": message.subject,
        "request_ref": _ref(request_id, group_id, message.content_sha256),
    }


# Proposals


@dataclass(frozen=True)
class Candidate:
    id: UUID
    version: int
    created_at: datetime
    recipient: str
    cc: tuple[str, ...]
    phase: str
    workflow: str
    sensitivity: str
    units: tuple[str, ...]
    due_at: datetime
    control_ref: str
    family: str
    # The system its control is over; empty when none.
    system: str
    items: int
    requirements: tuple[UUID, ...]
    untouched: bool
    section: Section


@dataclass(frozen=True)
class Proposal:
    id: UUID
    members: tuple[Candidate, ...]
    # Drafts a person changed, for the same person and phase: a person may include them.
    optional: tuple[Candidate, ...]

    @property
    def key(self) -> tuple[Any, ...]:
        return _key(self.members[0])


@dataclass(frozen=True)
class Stored:
    id: UUID
    status: str
    lead_request_id: UUID
    lead_approval_id: UUID
    recipient: str
    phase: str | None
    reason: str
    approved_at: datetime
    approved_by: str
    sent_at: datetime | None
    version: int
    members: tuple[UUID, ...]


def _key(candidate: Candidate) -> tuple[Any, ...]:
    return (
        candidate.recipient,
        candidate.cc,
        candidate.phase,
        candidate.workflow,
        candidate.sensitivity,
        candidate.units,
    )


# Changes a person made to a draft, or a reviewer's activity on it: such a draft is not
# regrouped on its own. Assigning a recipient, copies, a due date, or a priority is routing,
# not shaping: those drafts regroup under their new recipient.
_TOUCHED = """
    EXISTS (
        SELECT 1 FROM approvals a
        WHERE a.project_id = r.project_id AND a.action_id = 'mail.pbc'
          AND a.parameters ->> 'request_ref' LIKE 'pbc/' || r.id::text || '/%%'
          AND a.parameters ->> 'request_ref' NOT LIKE 'pbc/' || r.id::text || '/pbc-group-%%'
    )
    OR EXISTS (SELECT 1 FROM request_messages m WHERE m.pbc_request_id = r.id)
    OR EXISTS (SELECT 1 FROM request_attachments t WHERE t.pbc_request_id = r.id)
    OR EXISTS (
        SELECT 1 FROM audit_events e
        WHERE e.project_id = r.project_id AND e.target_type = 'pbc_request'
          AND e.target_id = r.id
          AND (e.action IN ('pbc.returned_for_revision', 'pbc.redraft_requested',
                            'pbc.classified')
               OR (e.action = 'pbc.updated'
                   AND NOT (e.payload ? 'source' OR e.payload ? 'group_id')))
    )
"""


def candidates(
    connection: psycopg.Connection[Any], project_id: UUID, ready: Callable[[UUID], bool]
) -> list[Candidate]:
    """The agent's drafts that could travel together (any a reviewer could approve on its
    own today): addressed to a person, not held, not still being drafted, of known
    sensitivity, and within one set of operating units. Whether a person touched each is
    said."""
    from ai_workforce_api.consolidation import _rows

    found: dict[UUID, list[Any]] = defaultdict(list)
    for row in _rows(connection, project_id):
        if row.request_id is not None:
            found[row.request_id].append(row)
    result: list[Candidate] = []
    for r in connection.execute(
        f"""
        SELECT r.id, r.version, r.created_at, r.recipient, r.cc_recipients, r.testing_phase,
               r.due_at, r.control_ref, r.evidence_description, c.domain, ({_TOUCHED}),
               c.title
        FROM pbc_requests r
        JOIN engagement_controls c ON c.id = r.engagement_control_id AND c.included
        WHERE r.project_id = %s AND r.status = 'DRAFT' AND r.drafted_by = 'AGENT'
        ORDER BY r.created_at, r.id
        """,
        (project_id,),
    ).fetchall():
        request_id = UUID(str(r[0]))
        rows = found.get(request_id, [])
        recipient = str(r[3]).strip().lower()
        if not rows or _EMAIL.fullmatch(recipient) is None or not ready(request_id):
            continue
        sensitivities = {row.spec.sensitivity for row in rows}
        units = {tuple(row.spec.units) for row in rows}
        if "UNKNOWN" in sensitivities or len(units) != 1:
            continue
        cc = tuple(sorted(str(x).strip().lower() for x in (r[4] or []) if str(x).strip()))
        result.append(
            Candidate(
                id=request_id,
                version=int(r[1]),
                created_at=r[2],
                recipient=recipient,
                cc=cc,
                phase=str(r[5] or ""),
                workflow="samples" if any(row.spec.sample for row in rows) else "documents",
                sensitivity="PERSONAL" if "PERSONAL" in sensitivities else "STANDARD",
                units=next(iter(units)),
                due_at=r[6],
                control_ref=str(r[7]),
                family=str(r[9]),
                system=rows[0].application,
                items=len(rows),
                requirements=tuple(row.requirement_id for row in rows),
                untouched=r[10] is not True,
                section=Section(
                    id=request_id,
                    control_ref=str(r[7]).strip(),
                    control_title=" ".join(str(r[11] or "").split())[:160],
                    system=" ".join(rows[0].application.split())[:120],
                    description=str(r[8]),
                    due_at=r[6],
                    recipient=str(r[3]).strip(),
                    cc=tuple(str(x).strip().lower() for x in (r[4] or []) if str(x).strip()),
                ),
            )
        )
    return result


def propose(
    project_id: UUID,
    found: list[Candidate],
    engagement: str,
    taken: set[UUID],
) -> list[Proposal]:
    """The groups the untouched drafts form: one per person, phase, kind of evidence,
    sensitivity, and set of operating units. As R2a decided, a group reads better split
    by control family when it is over 25 items and spans more than two families, then by
    system when a part is still over 25 items, and by due date when its dates are more
    than 14 days apart; and any part is split until it fits one email. A group of one is
    no group: that request goes as it is today."""
    by_key: dict[tuple[Any, ...], list[Candidate]] = defaultdict(list)
    for candidate in found:
        by_key[_key(candidate)].append(candidate)
    proposals: list[Proposal] = []
    for key in sorted(by_key, key=repr):
        members = by_key[key]
        fresh = sorted(
            (c for c in members if c.untouched),
            key=lambda c: (c.due_at, c.family, c.control_ref, str(c.id)),
        )
        touched = tuple(
            sorted((c for c in members if not c.untouched), key=lambda c: c.control_ref)
        )
        chunks: list[list[Candidate]] = []
        for family_part in _split(fresh, lambda c: c.family, MAX_FAMILIES):
            for part in _split(family_part, lambda c: c.system, 1):
                chunks.extend(_by_due(part))
        fitting: list[list[Candidate]] = []
        for chunk in chunks:
            fitting.extend(_fit(chunk, engagement))
        offered = False
        for chunk in fitting:
            if len(chunk) < 2:
                continue
            seed = f"{project_id}:{key!r}:{chunk[0].id}"
            proposals.append(
                Proposal(
                    id=_free(seed, taken),
                    members=tuple(chunk),
                    optional=() if offered else touched,
                )
            )
            offered = True
    return proposals


def _split(
    members: list[Candidate], by: Callable[[Candidate], str], allowed: int
) -> list[list[Candidate]]:
    """Split by a facet when the part is over the item guideline and spans more than the
    allowed number of its values; keep the order otherwise."""
    values = sorted({by(c) for c in members})
    if sum(c.items for c in members) <= MAX_ITEMS or len(values) <= allowed:
        return [members]
    return [[c for c in members if by(c) == value] for value in values]


def _by_due(members: list[Candidate]) -> list[list[Candidate]]:
    """Windows of due dates no more than 14 days apart (members are in due order)."""
    windows: list[list[Candidate]] = []
    for candidate in members:
        if windows and (candidate.due_at - windows[-1][0].due_at).days <= DUE_SPREAD_DAYS:
            windows[-1].append(candidate)
        else:
            windows.append([candidate])
    return windows


def _fit(chunk: list[Candidate], engagement: str) -> list[list[Candidate]]:
    """Split a chunk until each part fits one email."""
    if len(chunk) < 2:
        return [chunk]
    try:
        render_group(_NAMESPACE, chunk[0].id, [c.section for c in chunk], engagement)
    except ValueError:
        middle = len(chunk) // 2
        return _fit(chunk[:middle], engagement) + _fit(chunk[middle:], engagement)
    return [chunk]


def _free(seed: str, taken: set[UUID]) -> UUID:
    """A stable id for a proposal, never one an approved group already holds."""
    candidate = uuid5(_NAMESPACE, seed)
    turn = 1
    while candidate in taken:
        turn += 1
        candidate = uuid5(_NAMESPACE, f"{seed}:{turn}")
    return candidate


def stored(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    statuses: tuple[str, ...] | None = _LIVE,
    group_id: UUID | None = None,
) -> list[Stored]:
    """Approved groups (still in effect, by default) with their members in order."""
    rows = connection.execute(
        """
        SELECT g.id, g.status, g.lead_request_id, g.lead_approval_id, g.recipient,
               g.testing_phase, g.reason, g.approved_at, coalesce(u.display_name, ''),
               g.sent_at, g.version,
               array(SELECT m.pbc_request_id FROM evidence_request_group_members m
                     WHERE m.group_id = g.id ORDER BY m.position)
        FROM evidence_request_groups g
        LEFT JOIN users u ON u.id = g.approved_by
        WHERE g.project_id = %s
          AND (%s::text[] IS NULL OR g.status = ANY(%s::text[]))
          AND (%s::uuid IS NULL OR g.id = %s)
        ORDER BY g.approved_at, g.id
        """,
        (
            project_id,
            None if statuses is None else list(statuses),
            None if statuses is None else list(statuses),
            group_id,
            group_id,
        ),
    ).fetchall()
    return [
        Stored(
            id=UUID(str(r[0])),
            status=str(r[1]),
            lead_request_id=UUID(str(r[2])),
            lead_approval_id=UUID(str(r[3])),
            recipient=str(r[4]),
            phase=None if r[5] is None else str(r[5]),
            reason=str(r[6]),
            approved_at=r[7],
            approved_by=str(r[8]),
            sent_at=r[9],
            version=int(r[10]),
            members=tuple(UUID(str(x)) for x in (r[11] or [])),
        )
        for r in rows
    ]


def _taken(connection: psycopg.Connection[Any], project_id: UUID) -> set[UUID]:
    return {
        UUID(str(row[0]))
        for row in connection.execute(
            "SELECT id FROM evidence_request_groups WHERE project_id = %s", (project_id,)
        ).fetchall()
    }


def proposals_for(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    ready: Callable[[UUID], bool],
) -> list[Proposal]:
    from ai_workforce_api.outbound import _engagement

    return propose(
        project_id,
        candidates(connection, project_id, ready),
        _engagement(connection, organization_id, project_id),
        _taken(connection, project_id),
    )


def _row_ready(rows: list[Any]) -> Callable[[UUID], bool]:
    """Ready to group by the list's own reading: not held, not still being drafted."""
    state = {row.body.id: not row.body.held and not row.drafting for row in rows}
    return lambda request_id: state.get(request_id, False)


# The Evidence page's list: one row per request as the person sees it


_STAGE_ORDER = (
    "CLARIFICATION_NEEDED",
    "CHANGES_REQUESTED",
    "DRAFT",
    "READY_FOR_REVIEW",
    "APPROVED",
    "AWAITING_EVIDENCE",
    "PARTIALLY_RECEIVED",
    "EVIDENCE_RECEIVED",
    "UNDER_REVIEW",
    "COMPLETED",
)
_RECEIVED_STAGES = frozenset({"PARTIALLY_RECEIVED", "EVIDENCE_RECEIVED", "UNDER_REVIEW"})
_ENDED_STAGES = frozenset({"COMPLETED", "CANCELLED", "REJECTED"})


def aggregate_stage(stages: list[str]) -> str:
    """A sent group's stage from its requests': a question first; done when every one is;
    partly received when some evidence came and some is awaited; else the earliest."""
    if "CLARIFICATION_NEEDED" in stages:
        return "CLARIFICATION_NEEDED"
    live = [s for s in stages if s not in ("CANCELLED", "REJECTED")]
    if not live:
        return "CANCELLED"
    if all(s in _ENDED_STAGES for s in live):
        return "COMPLETED"
    if any(s in _RECEIVED_STAGES or s == "COMPLETED" for s in live) and any(
        s == "AWAITING_EVIDENCE" for s in live
    ):
        return "PARTIALLY_RECEIVED"
    return min(live, key=lambda s: _STAGE_ORDER.index(s) if s in _STAGE_ORDER else 99)


def aggregate_status(statuses: list[str]) -> str:
    live = [s for s in statuses if s != "CANCELLED"] or ["CANCELLED"]
    if all(s in ("RECEIVED", "CLOSED", "CANCELLED") for s in live):
        return "CLOSED" if all(s in ("CLOSED", "CANCELLED") for s in live) else "RECEIVED"
    if any(s in ("PARTIALLY_RECEIVED", "RECEIVED", "CLOSED") for s in live):
        return "PARTIALLY_RECEIVED"
    for status in ("ESCALATED", "OVERDUE", "WAITING_FOR_RESPONSE", "SENT", "APPROVAL_PENDING"):
        if status in live:
            return status
    return live[0]


def collapse(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    rows: list[Any],
) -> list[Any]:
    """The list's rows with each group's requests as one row (evidence_center._Row)."""
    from ai_workforce_api.evidence_center import STAGE_LABELS, RowBody, _Row

    by_id = {row.body.id: row for row in rows}
    groups: list[tuple[UUID, str, list[Any], str, str]] = []
    for group in stored(connection, project_id):
        members = [by_id[m] for m in group.members if m in by_id]
        if len(members) >= 2:
            groups.append((group.id, group.status, members, reference_of(group.id),
                           group.approved_by))  # fmt: skip
    taken = {member.body.id for _, _, members, _, _ in groups for member in members}
    for proposal in proposals_for(connection, organization_id, project_id, _row_ready(rows)):
        members = [by_id[c.id] for c in proposal.members if c.id in by_id]
        if len(members) >= 2 and not any(m.body.id in taken for m in members):
            groups.append((proposal.id, "PROPOSED", members, reference_of(proposal.id), ""))
            taken.update(m.body.id for m in members)
    if not groups:
        return rows
    result = [row for row in rows if row.body.id not in taken]
    for group_id, status, members, reference, approver in groups:
        bodies = [m.body for m in members]
        lead = bodies[0]
        if status == "PROPOSED":
            ready = all(b.stage == "READY_FOR_REVIEW" for b in bodies)
            stage = "READY_FOR_REVIEW" if ready else "DRAFT"
            state = "DRAFT"
        elif status == "APPROVED":
            stage, state = "APPROVED", "APPROVAL_PENDING"
        else:
            stage = aggregate_stage([b.stage for b in bodies])
            state = aggregate_status([b.status for b in bodies])
        refs = [b.control_ref for b in bodies]
        systems = sorted({s for b in bodies for s in b.systems})
        types = [b.request_type for b in bodies]
        kind = max(set(types), key=lambda t: (types.count(t), t))
        label = next(b.type_label for b in bodies if b.request_type == kind)
        due = min(b.due_at for b in bodies)
        body = RowBody(
            id=group_id,
            reference=reference,
            title=f"Evidence for {len(bodies)} controls",
            control_id=None,
            control_ref=f"{len(bodies)} controls",
            control_title=", ".join(refs)[:300],
            systems=systems,
            phase=lead.phase,
            request_type=kind,
            type_label=label,
            type_uncertain=any(b.type_uncertain for b in bodies),
            recipient=lead.recipient,
            recipient_name=lead.recipient_name,
            cc_count=lead.cc_count,
            status=state,
            stage=stage,  # type: ignore[arg-type]
            stage_label=STAGE_LABELS[stage],
            overdue=any(b.overdue for b in bodies),
            escalated=any(b.escalated for b in bodies),
            clarification=any(b.clarification for b in bodies),
            held=False,
            due_at=due,
            priority="HIGH" if any(b.priority == "HIGH" for b in bodies) else lead.priority,
            agent="READY_FOR_REVIEW" if stage == "READY_FOR_REVIEW" else "NONE",
            agent_label="Ready for review" if stage == "READY_FOR_REVIEW" else "",
            drafted_by="AGENT",
            files=sum(b.files for b in bodies),
            version=sum(b.version for b in bodies),
            approval_decision=None if status == "PROPOSED" else "APPROVED",
            approval_decided_by=approver or None,
            group=True,
            group_status=status,
            member_ids=[b.id for b in bodies],
            member_controls=[b.control_id for b in bodies if b.control_id is not None],
        )
        result.append(_Row(body=body, owner_user_id=members[0].owner_user_id, drafting=False))
    return result


# The review side panel


class MemberView(BaseModel):
    id: UUID
    reference: str
    control_id: UUID | None
    control_ref: str
    control_title: str
    systems: list[str]
    title: str
    items: list[str]
    due_at: datetime
    # Shown only where it differs from the request's own due date.
    due_differs: bool
    status: str
    stage: str
    stage_label: str
    version: int
    # What stops it being approved, in words; None when it is ready.
    problem: str | None = None


class GroupView(BaseModel):
    id: UUID
    reference: str
    status: GroupStatus
    title: str
    phase: str | None
    recipient: str
    recipient_name: str
    cc: list[str]
    due_at: datetime
    item_count: int
    personal_data: bool
    members: list[MemberView]
    optional: list[MemberView] = Field(default_factory=list)
    subject: str
    body: str
    ready: bool
    approved_by: str = ""
    approved_at: datetime | None = None
    sent_at: datetime | None = None
    # The single message's delivery: "", PENDING, ACCEPTED, UNKNOWN, or FAILED.
    delivery: str = ""
    # Why it was not sent, in words, when it was not.
    reason: str = ""
    lead_request_id: UUID
    can_approve: bool
    notice: str = ""


class SeenMember(BaseModel):
    id: UUID
    version: int = Field(ge=1)


class ApproveSendBody(BaseModel):
    # The requests the person reviewed, at the versions they saw: the proposal's, and any
    # changed draft they chose to include.
    members: list[SeenMember] = Field(min_length=2, max_length=60)
    reason: str = Field(default="Reviewed and approved.", min_length=1, max_length=500)


def _center_rows(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[Any]:
    from ai_workforce_api.evidence_center import _rows

    return _rows(connection, principal, organization_id, project_id, False)


def _member_view(
    row: Any,
    pbc: PbcBody,
    due: datetime,
    problem: str | None,
) -> MemberView:
    from ai_workforce_api.evidence_center import STAGE_LABELS

    _, items = _heading(section_of(pbc))
    body = row.body if row is not None else None
    stage = body.stage if body is not None else "DRAFT"
    return MemberView(
        id=pbc.id,
        reference=f"PBC-{pbc.id.hex[-8:].upper()}",
        control_id=pbc.engagement_control_id,
        control_ref=body.control_ref if body is not None else pbc.control_ref,
        control_title=body.control_title if body is not None else "",
        systems=body.systems if body is not None else [],
        title=body.title if body is not None else pbc.control_ref,
        items=[item.split("\n", 1)[0] for item in items],
        due_at=pbc.due_at,
        due_differs=pbc.due_at.astimezone(UTC).date() != due.astimezone(UTC).date(),
        status=pbc.status,
        stage=stage,
        stage_label=STAGE_LABELS.get(stage, stage),
        version=pbc.version,
        problem=problem,
    )


def _pbcs(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, ids: list[UUID]
) -> dict[UUID, PbcBody]:
    rows = connection.execute(
        f"SELECT {_PBC_COLUMNS} FROM pbc_requests "
        "WHERE organization_id = %s AND project_id = %s AND id = ANY(%s)",
        (organization_id, project_id, ids),
    ).fetchall()
    found = [_pbc_body(row) for row in rows]
    return {pbc.id: pbc for pbc in found}


def _problem(
    connection: psycopg.Connection[Any],
    settings: Settings,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
) -> str | None:
    from ai_workforce_api.evidence_center import _sentence
    from ai_workforce_api.evidence_plans import held_for_planning
    from ai_workforce_api.request_details import blocker

    held = held_for_planning(connection, request_id)
    if held is not None:
        return _sentence(held)
    problem = blocker(connection, settings, organization_id, project_id, request_id)
    if problem is not None:
        return _sentence(problem)
    # Requests go out only from the current, approved revision of their plan (R2a).
    revised = connection.execute(
        """
        SELECT 1 FROM evidence_requirements r JOIN evidence_plans p ON p.id = r.plan_id
        WHERE r.pbc_request_id = %s AND r.status <> 'WAIVED'
          AND (p.status <> 'APPROVED' OR p.approved_revision IS DISTINCT FROM p.revision)
        LIMIT 1
        """,
        (request_id,),
    ).fetchone()
    if revised is not None:
        return "The control's evidence plan is not approved at its current revision."
    return None


def _rights(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> bool:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        return False
    try:
        authorize(
            connection,
            principal=principal,
            action=Action.PROJECT_UPDATE,
            organization_id=organization_id,
            project_id=project_id,
        )
    except AccessDenied, NotVisible:
        return False
    return True


def review(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    group_id: UUID,
) -> GroupView:
    """The request as the reviewer sees it: who it goes to, by when, every control and
    item in it, what stops it, and the email itself."""
    from ai_workforce_api.outbound import _by_approval, _engagement, recipients_allowed

    can_approve = _rights(connection, principal, organization_id, project_id)
    rows = _center_rows(connection, principal, organization_id, project_id)
    by_id = {row.body.id: row for row in rows}
    engagement = _engagement(connection, organization_id, project_id)
    found = stored(connection, project_id, None, group_id)
    if found:
        group = found[0]
        pbcs = _pbcs(connection, organization_id, project_id, list(group.members))
        members = [pbcs[m] for m in group.members if m in pbcs]
        due = min(p.due_at for p in members)
        record = connection.execute(
            "SELECT subject, cc FROM evidence_group_approvals WHERE group_id = %s", (group.id,)
        ).fetchone()
        try:
            message = render_group(
                group.id, group.lead_request_id, sections_for(connection, members), engagement
            )
            body = message.body
        except ValueError:
            body = ""
        outbound = _by_approval(connection, organization_id, project_id, group.lead_approval_id)
        personal = _personal(connection, project_id, group.id)
        return GroupView(
            id=group.id,
            reference=reference_of(group.id),
            status=group.status,  # type: ignore[arg-type]
            title=f"Evidence for {len(members)} controls",
            phase=group.phase,
            recipient=group.recipient,
            recipient_name=by_id[members[0].id].body.recipient_name
            if members[0].id in by_id
            else "",
            cc=[str(x) for x in (record[1] if record is not None else [])],
            due_at=due,
            item_count=sum(len(_heading(section_of(p))[1]) for p in members),
            personal_data=personal,
            members=[_member_view(by_id.get(p.id), p, due, None) for p in members],
            subject=str(record[0]) if record is not None else "",
            body=body,
            ready=group.status == "APPROVED",
            approved_by=group.approved_by,
            approved_at=group.approved_at,
            sent_at=group.sent_at,
            delivery="" if outbound is None else outbound.status,
            reason=_NOT_SENT_WORDS.get(group.reason, ""),
            lead_request_id=group.lead_request_id,
            can_approve=can_approve,
        )
    proposal = next(
        (p for p in proposals_for(connection, organization_id, project_id, _row_ready(rows))
         if p.id == group_id),
        None,
    )  # fmt: skip
    if proposal is None:
        raise NotVisible()
    ids = [c.id for c in proposal.members] + [c.id for c in proposal.optional]
    pbcs = _pbcs(connection, organization_id, project_id, ids)
    members = [pbcs[c.id] for c in proposal.members]
    due = min(p.due_at for p in members)
    problems = {
        p.id: _problem(connection, settings, organization_id, project_id, p.id) for p in members
    }
    sections = sections_for(connection, members)
    message = render_group(proposal.id, members[0].id, sections, engagement)
    notice = (
        ""
        if recipients_allowed(settings, message)
        else ("This recipient is not permitted for outbound email.")
    )
    return GroupView(
        id=proposal.id,
        reference=reference_of(proposal.id),
        status="PROPOSED",
        title=f"Evidence for {len(members)} controls",
        phase=proposal.members[0].phase,
        recipient=members[0].recipient.strip().lower(),
        recipient_name=by_id[members[0].id].body.recipient_name if members[0].id in by_id else "",
        cc=list(proposal.members[0].cc),
        due_at=due,
        item_count=sum(c.items for c in proposal.members),
        personal_data=proposal.members[0].sensitivity == "PERSONAL",
        members=[_member_view(by_id.get(p.id), p, due, problems[p.id]) for p in members],
        optional=[
            _member_view(
                by_id.get(c.id),
                pbcs[c.id],
                due,
                _problem(connection, settings, organization_id, project_id, c.id),
            )
            for c in proposal.optional
            if c.id in pbcs
        ],
        subject=message.subject,
        body=message.body,
        ready=notice == "" and all(problem is None for problem in problems.values()),
        lead_request_id=members[0].id,
        can_approve=can_approve,
        notice=notice,
    )


def _personal(connection: psycopg.Connection[Any], project_id: UUID, group_id: UUID) -> bool:
    row = connection.execute(
        "SELECT sensitivity FROM evidence_group_approvals WHERE group_id = %s AND project_id = %s",
        (group_id, project_id),
    ).fetchone()
    return row is not None and row[0] == "PERSONAL"


# Approval and sending


def approve_and_send(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    group_id: UUID,
    body: ApproveSendBody,
    mailbox: Any = open_mailbox,
    timer: FollowUpTimer | None = None,
) -> GroupView:
    """One action: every request in the group is approved through the approval engine,
    the group and exactly what was approved are recorded, all in one transaction; then the
    one email is sent. A send that cannot go now leaves the approval standing, said; a
    repeat of this call never approves or sends twice."""
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
        raise ValueError("the note holds a credential")
    if len({m.id for m in body.members}) != len(body.members):
        raise ValueError("each request can appear once")
    existing = stored(connection, project_id, None, group_id)
    if existing:
        group = existing[0]
        if group.status == "NOT_SENT":
            raise GroupState("This request was not sent. Review it again.")
        if group.status == "SENT":
            return review(connection, settings, principal, organization_id, project_id, group_id)
        return send_group(
            connection, settings, principal, organization_id, project_id, group_id, mailbox,
            timer,
        )  # fmt: skip
    _approve(connection, settings, principal, organization_id, project_id, group_id, body, reason)
    connection.commit()
    return send_group(
        connection, settings, principal, organization_id, project_id, group_id, mailbox, timer
    )


def _approve(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    group_id: UUID,
    body: ApproveSendBody,
    reason: str,
) -> None:
    from ai_workforce_api.consolidation import (
        SpecificationStale,
        _rows,
        refresh_specifications,
        require_fresh,
    )
    from ai_workforce_api.outbound import (
        ACTION_ID,
        _coordinator,
        _engagement,
        recipients_allowed,
    )

    rows = _center_rows(connection, principal, organization_id, project_id)
    proposal = next(
        (p for p in proposals_for(connection, organization_id, project_id, _row_ready(rows))
         if p.id == group_id),
        None,
    )  # fmt: skip
    if proposal is None:
        raise GroupState("The request changed since it was opened. Review it again.")
    seen = {m.id: m.version for m in body.members}
    allowed = {c.id: c for c in (*proposal.members, *proposal.optional)}
    if not {c.id for c in proposal.members} <= seen.keys() or not seen.keys() <= allowed.keys():
        raise GroupState("The request changed since it was opened. Review it again.")
    chosen = [c for c in (*proposal.members, *proposal.optional) if c.id in seen]
    ids = [c.id for c in chosen]
    with transaction(connection) as cursor:
        locked = {
            UUID(str(row[0])): (str(row[1]), int(row[2]), str(row[3]))
            for row in cursor.execute(
                "SELECT id, status, version, drafted_by FROM pbc_requests "
                "WHERE id = ANY(%s) AND project_id = %s ORDER BY id FOR UPDATE",
                (ids, project_id),
            ).fetchall()
        }
        for candidate in chosen:
            status, version, drafted = locked.get(candidate.id, ("", 0, ""))
            if status != "DRAFT" or drafted != "AGENT" or version != seen[candidate.id]:
                raise GroupState("The request changed since it was opened. Review it again.")
        for candidate in chosen:
            problem = _problem(connection, settings, organization_id, project_id, candidate.id)
            if problem is not None:
                raise GroupState(f"{candidate.control_ref}: {problem}")
        pbcs = _pbcs(connection, organization_id, project_id, ids)
        members = [pbcs[i] for i in ids]
        engagement = _engagement(connection, organization_id, project_id)
        try:
            message = render_group(group_id, ids[0], sections_for(connection, members), engagement)
        except ValueError:
            raise GroupState("The request does not fit one email. Send fewer controls.") from None
        if not recipients_allowed(settings, message):
            raise GroupState("This recipient is not permitted for outbound email.")
        # The approved plan and current specifications (R2a's freshness contract).
        requirement_rows = [r for r in _rows(connection, project_id) if r.request_id in pbcs]
        if {r.requirement_id for r in requirement_rows} != {
            q for c in chosen for q in c.requirements
        }:
            raise GroupState("The request changed since it was opened. Review it again.")
        refresh_specifications(cursor, organization_id, project_id, requirement_rows)
        try:
            require_fresh(connection, project_id, [r.requirement_id for r in requirement_rows])
        except SpecificationStale:
            raise GroupState(
                "A control's evidence plan is not approved at its current revision."
            ) from None
        if {r.spec.sensitivity for r in requirement_rows} & {"UNKNOWN"} or len(
            {tuple(r.spec.units) for r in requirement_rows}
        ) != 1:
            raise GroupState("The request mixes evidence that must travel separately.")
        agent = _coordinator(connection, organization_id)
        if agent is None:
            raise GroupState("The evidence coordinator is not set up.")
        approvals = [
            _request(
                connection,
                principal,
                organization_id,
                project_id,
                ApprovalCreate(
                    action_id=ACTION_ID,
                    parameters=member_parameters(message, p.id, group_id),
                    requesting_agent_id=agent,
                ),
            )
            for p in members
        ]
        cursor.execute(
            """
            INSERT INTO evidence_request_groups (
                id, organization_id, project_id, lead_request_id, lead_approval_id, recipient,
                testing_phase, approved_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (group_id, organization_id, project_id, ids[0], approvals[0].id,
             message.recipient.lower(), members[0].testing_phase, principal.id),
        )  # fmt: skip
        frozen: list[dict[str, Any]] = []
        for position, (pbc, approval) in enumerate(zip(members, approvals, strict=True), 1):
            updated = cursor.execute(
                "UPDATE pbc_requests SET status = 'APPROVAL_PENDING', "
                "updated_at = clock_timestamp(), version = version + 1 "
                "WHERE id = %s AND version = %s AND status = 'DRAFT' RETURNING version",
                (pbc.id, pbc.version),
            ).fetchone()
            if updated is None:
                raise GroupState("The request changed since it was opened. Review it again.")
            approve_agent_request(
                cursor, organization_id, project_id, principal.id, approval.id, reason
            )
            cursor.execute(
                """
                INSERT INTO evidence_request_group_members (
                    group_id, pbc_request_id, organization_id, project_id, position,
                    approval_id, request_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (group_id, pbc.id, organization_id, project_id, position, approval.id,
                 int(updated[0])),
            )  # fmt: skip
            _request_audit(cursor, organization_id, project_id, principal.id, pbc.id,
                           "APPROVAL_PENDING", group_id)  # fmt: skip
            frozen.append({
                "request_id": str(pbc.id),
                "request_version": int(updated[0]),
                "approval_id": str(approval.id),
                "control_ref": pbc.control_ref,
                "due_on": pbc.due_at.astimezone(UTC).date().isoformat(),
                "requirements": [
                    {"id": str(r.requirement_id), "version": r.version,
                     "spec_hash": r.spec_hash, "plan_revision": r.plan_revision,
                     "sensitivity": r.spec.sensitivity}
                    for r in requirement_rows if r.request_id == pbc.id
                ],
            })  # fmt: skip
        sensitivity = (
            "PERSONAL" if any(r.spec.sensitivity == "PERSONAL" for r in requirement_rows)
            else "STANDARD"
        )  # fmt: skip
        cursor.execute(
            """
            INSERT INTO evidence_group_approvals (
                group_id, organization_id, project_id, approved_by, decision_reason, recipient,
                cc, subject, content_sha256, template_id, template_version, sensitivity, members
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (group_id, organization_id, project_id, principal.id, reason,
             message.recipient.lower(), Json(list(message.cc)), message.subject,
             message.content_sha256, message.template.template_id, message.template.version,
             sensitivity, Json(frozen)),
        )  # fmt: skip
        _group_audit(cursor, organization_id, project_id, principal.id, group_id,
                     "evidence.group_approved", {"requests": len(members)})  # fmt: skip


def send_group(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    group_id: UUID,
    mailbox: Any = open_mailbox,
    timer: FollowUpTimer | None = None,
) -> GroupView:
    """Send an approved group's one email, or resume a send that was interrupted. The
    outbound engine binds the message to the lead's approval: one approval, one message,
    never sent twice. Anything changed since approval is refused before a message is
    recorded, and the requests go back to draft to be reviewed again."""
    from ai_workforce_api.outbound import OutboundState, _send_once

    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    found = stored(connection, project_id, None, group_id)
    if not found:
        raise NotVisible()
    group = found[0]
    if group.status == "NOT_SENT":
        raise GroupState("This request was not sent. Review it again.")
    notice = ""
    if group.status == "APPROVED":
        current = _outbound_of(connection, organization_id, project_id, group)
        if current is None:
            stale = _send_problem(connection, settings, organization_id, project_id, group)
            if stale is not None:
                with transaction(connection) as cursor:
                    _retire(cursor, organization_id, project_id, principal.id, group, stale)
                connection.commit()
                raise GroupState(_NOT_SENT_WORDS[stale] + " Review it again.")
        try:
            result = _send_once(
                connection,
                settings,
                principal,
                organization_id,
                project_id,
                group.lead_approval_id,
                mailbox,
                lambda: _record(
                    connection, settings, principal, organization_id, project_id, group
                ),
                lambda outbound: (
                    outbound.pbc_request_id == group.lead_request_id
                    and outbound.follow_up_id is None
                ),
            )
        except OutboundState as refused:
            if refused.detail != "live email is off":
                raise
            notice = "Email sending is off; the approval stands, to send once it is on."
        else:
            if result.status == "ACCEPTED":
                schedule(timer, organization_id, project_id, group.lead_request_id)
            elif result.status == "UNKNOWN":
                notice = "Handed to the mail provider; delivery is not yet confirmed."
    view = review(connection, settings, principal, organization_id, project_id, group_id)
    return view.model_copy(update={"notice": notice}) if notice else view


def _outbound_of(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, group: Stored
) -> Any:
    from ai_workforce_api.outbound import _by_approval

    return _by_approval(connection, organization_id, project_id, group.lead_approval_id)


def _frozen(connection: psycopg.Connection[Any], group_id: UUID) -> tuple[str, list[Any]]:
    row = connection.execute(
        "SELECT content_sha256, members FROM evidence_group_approvals WHERE group_id = %s",
        (group_id,),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return str(row[0]), list(row[1] or [])


def _send_problem(
    connection: psycopg.Connection[Any],
    settings: Settings,
    organization_id: UUID,
    project_id: UUID,
    group: Stored,
) -> NotSentReason | None:
    """Why the approved group can no longer be sent as approved, or None: a request or
    requirement changed, a plan was revised or is no longer approved, the content would
    differ, or the approvals expired."""
    from ai_workforce_api.consolidation import _rows, staleness
    from ai_workforce_api.evidence_catalog import CATALOG_VERSION
    from ai_workforce_api.outbound import _engagement

    digest, frozen = _frozen(connection, group.id)
    versions = {UUID(m["request_id"]): int(m["request_version"]) for m in frozen}
    pbcs = _pbcs(connection, organization_id, project_id, list(group.members))
    for request_id, version in versions.items():
        pbc = pbcs.get(request_id)
        if pbc is None or pbc.status != "APPROVAL_PENDING" or pbc.version != version:
            return "changed_since_approval"
    approved = {
        UUID(r["id"]): (int(r["version"]), str(r["spec_hash"]), r["plan_revision"])
        for m in frozen
        for r in m["requirements"]
    }
    current = {r.requirement_id: r for r in _rows(connection, project_id)
               if r.request_id in versions}  # fmt: skip
    if set(current) != set(approved):
        return "changed_since_approval"
    for requirement_id, (version, spec_hash, revision) in approved.items():
        now = current[requirement_id]
        if (
            now.version != version
            or now.spec_hash != spec_hash
            or now.plan_revision != revision
            or now.spec.catalog_version != CATALOG_VERSION
        ):
            return "changed_since_approval"
    if staleness(connection, project_id, list(approved)):
        return "changed_since_approval"
    members = [pbcs[m] for m in group.members]
    try:
        message = render_group(
            group.id,
            group.lead_request_id,
            sections_for(connection, members),
            _engagement(connection, organization_id, project_id),
        )
    except ValueError:
        return "changed_since_approval"
    if message.content_sha256 != digest:
        return "changed_since_approval"
    expired = connection.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM evidence_request_group_members m JOIN approvals a ON a.id = m.approval_id
            WHERE m.group_id = %s
              AND (a.expires_at <= clock_timestamp() OR a.decision <> 'APPROVED'
                   OR a.execution_status <> 'NOT_STARTED'))
        """,
        (group.id,),
    ).fetchone()
    if expired is not None and expired[0] is True:
        return "approval_expired"
    return None


def _record(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    group: Stored,
) -> Any:
    """Record the one outbound message before the provider is called, under locks, after
    checking again everything the approval bound."""
    from ai_workforce_api.approvals import payload_hash
    from ai_workforce_api.outbound import (
        _SEND_CHECKS,
        ACTION_ID,
        OutboundState,
        _check,
        _engagement,
        _insert,
        _lock_approval,
        _operation_key,
        _require_policy,
        recipients_allowed,
    )

    try:
        with transaction(connection) as cursor:
            row = cursor.execute(
                "SELECT status FROM evidence_request_groups WHERE id = %s FOR UPDATE",
                (group.id,),
            ).fetchone()
            if row is None or row[0] != "APPROVED":
                raise OutboundState("request is not awaiting approval")
            digest, frozen = _frozen(connection, group.id)
            versions = {UUID(m["request_id"]): int(m["request_version"]) for m in frozen}
            locked = cursor.execute(
                f"SELECT {_PBC_COLUMNS} FROM pbc_requests WHERE id = ANY(%s) "
                "ORDER BY id FOR UPDATE",
                (list(group.members),),
            ).fetchall()
            pbcs = {p.id: p for p in (_pbc_body(r) for r in locked)}
            for request_id, version in versions.items():
                pbc = pbcs.get(request_id)
                if pbc is None or pbc.status != "APPROVAL_PENDING" or pbc.version != version:
                    raise OutboundState("request is not awaiting approval")
            members = [pbcs[m] for m in group.members]
            message = render_group(
                group.id,
                group.lead_request_id,
                sections_for(connection, members),
                _engagement(connection, organization_id, project_id),
            )
            if message.content_sha256 != digest:
                raise OutboundState("approval does not match")
            if not recipients_allowed(settings, message):
                raise OutboundState("recipient is not allowed")
            for pbc in members:
                _check(connection, settings, organization_id, project_id, pbc.id, _SEND_CHECKS)
            lead_digest = _lock_approval(
                cursor, organization_id, project_id, group.lead_approval_id, message
            )
            for approval in cursor.execute(
                """
                SELECT m.pbc_request_id, a.payload_hash, a.requesting_agent_id, a.decision::text,
                       a.execution_status, a.expires_at <= clock_timestamp()
                FROM evidence_request_group_members m JOIN approvals a ON a.id = m.approval_id
                WHERE m.group_id = %s AND a.id <> %s
                ORDER BY a.id
                FOR UPDATE OF a
                """,
                (group.id, group.lead_approval_id),
            ).fetchall():
                agent = approval[2] if isinstance(approval[2], UUID) else None
                expected = payload_hash(
                    organization_id, project_id, ACTION_ID, agent,
                    member_parameters(message, UUID(str(approval[0])), group.id),
                )  # fmt: skip
                if approval[1] != expected:
                    raise OutboundState("approval does not match")
                if approval[5] is True:
                    raise OutboundState("approval has expired")
                if approval[3] != "APPROVED" or approval[4] != "NOT_STARTED":
                    raise OutboundState("approval is not approved")
            _require_policy(connection, principal, organization_id, project_id, message)
            return _insert(
                cursor,
                organization_id,
                project_id,
                principal.id,
                group.lead_request_id,
                group.lead_approval_id,
                _operation_key(cursor, project_id, group.lead_approval_id, lead_digest),
                message,
            )
    except UniqueViolation:
        return None


def _retire(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    group: Stored,
    reason: NotSentReason,
) -> None:
    """The group is not sent: its record stays, its approvals are settled as refused, and
    its requests return to draft, to be grouped and reviewed again."""
    from ai_workforce_api.outbound import settle_approval

    updated = cursor.execute(
        "UPDATE evidence_request_groups SET status = 'NOT_SENT', reason = %s, "
        "updated_at = clock_timestamp(), version = version + 1 "
        "WHERE id = %s AND status = 'APPROVED' RETURNING id",
        (reason, group.id),
    ).fetchone()
    if updated is None:
        return
    for request_id, approval_id in cursor.execute(
        "SELECT pbc_request_id, approval_id FROM evidence_request_group_members "
        "WHERE group_id = %s AND released_at IS NULL ORDER BY position",
        (group.id,),
    ).fetchall():
        settle_approval(cursor, organization_id, project_id, actor_id, approval_id, "REFUSED",
                        "not_available", None)  # fmt: skip
        back = cursor.execute(
            "UPDATE pbc_requests SET status = 'DRAFT', updated_at = clock_timestamp(), "
            "version = version + 1 WHERE id = %s AND status = 'APPROVAL_PENDING' RETURNING id",
            (request_id,),
        ).fetchone()
        if back is not None:
            _request_audit(cursor, organization_id, project_id, actor_id, request_id, "DRAFT",
                           group.id)  # fmt: skip
    cursor.execute(
        "UPDATE evidence_request_group_members SET released_at = clock_timestamp() "
        "WHERE group_id = %s AND released_at IS NULL",
        (group.id,),
    )
    _group_audit(cursor, organization_id, project_id, actor_id, group.id,
                 "evidence.group_not_sent", {"reason": reason})  # fmt: skip


# Hooks for the outbound and reminder engines


def _by_lead_approval(connection: Any, approval_id: UUID) -> Stored | None:
    row = connection.execute(
        "SELECT project_id, id FROM evidence_request_groups WHERE lead_approval_id = %s",
        (approval_id,),
    ).fetchone()
    if row is None:
        return None
    found = stored(connection, UUID(str(row[0])), None, UUID(str(row[1])))
    return found[0] if found else None


def is_group_message(template_id: str) -> bool:
    return template_id in (GROUP_TEMPLATE_ID, GROUP_REMINDER_TEMPLATE_ID)


def message_for(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    outbound: Any,
) -> Any:
    """Render a group's request message again from its members, for the send's check."""
    from ai_workforce_api.outbound import _engagement

    group = _by_lead_approval(connection, outbound.approval_id)
    if group is None:
        raise ValueError("group not found")
    pbcs = _pbcs(connection, organization_id, project_id, list(group.members))
    return render_group(
        group.id,
        group.lead_request_id,
        sections_for(connection, [pbcs[m] for m in group.members]),
        _engagement(connection, organization_id, project_id),
    )


def sent_group_of(connection: Any, request_id: UUID) -> Stored | None:
    """The sent group a request travels in, or None."""
    row = connection.execute(
        """
        SELECT g.project_id, g.id FROM evidence_request_group_members m
        JOIN evidence_request_groups g ON g.id = m.group_id
        WHERE m.pbc_request_id = %s AND m.released_at IS NULL AND g.status = 'SENT'
        """,
        (request_id,),
    ).fetchone()
    if row is None:
        return None
    found = stored(connection, UUID(str(row[0])), ("SENT",), UUID(str(row[1])))
    return found[0] if found else None


def in_live_group(connection: Any, request_id: UUID) -> bool:
    """Whether the request travels in an approved or sent group: it never sends alone."""
    row = connection.execute(
        """
        SELECT 1 FROM evidence_request_group_members m
        JOIN evidence_request_groups g ON g.id = m.group_id
        WHERE m.pbc_request_id = %s AND m.released_at IS NULL
          AND g.status IN ('APPROVED', 'SENT')
        """,
        (request_id,),
    ).fetchone()
    return row is not None


def reminder_target(connection: Any, request_id: UUID) -> UUID:
    """The request whose reminders cover this one: its sent group's lead, else itself."""
    group = sent_group_of(connection, request_id)
    return request_id if group is None else group.lead_request_id


def open_members(connection: Any, group: Stored) -> list[PbcBody]:
    rows = connection.execute(
        f"SELECT {_PBC_COLUMNS} FROM pbc_requests WHERE id = ANY(%s)",
        (list(group.members),),
    ).fetchall()
    found = {p.id: p for p in (_pbc_body(r) for r in rows)}
    return [found[m] for m in group.members if m in found and found[m].status in REMINDABLE]


def reminder_for(
    connection: psycopg.Connection[Any],
    pbc: PbcBody,
    engagement: str,
    follow_up_id: UUID,
    sequence: int,
) -> Any | None:
    """The group's reminder when the request leads a sent group; None otherwise. A member
    that does not lead is never reminded on its own."""
    from ai_workforce_api.outbound import OutboundState

    group = sent_group_of(connection, pbc.id)
    if group is None:
        return None
    if group.lead_request_id != pbc.id:
        raise OutboundState("reminders for this request go with the request it was sent in")
    return render_group_reminder(
        group.id,
        pbc,
        sections_for(connection, open_members(connection, group)),
        engagement,
        follow_up_id,
        sequence,
    )


def remindable(connection: Any, pbc: PbcBody) -> bool:
    """A request is reminded while it is open; a group's lead, while any of its requests
    is."""
    group = sent_group_of(connection, pbc.id)
    if group is None or group.lead_request_id != pbc.id:
        return pbc.status in REMINDABLE
    return bool(open_members(connection, group))


def mark_sent(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    outbound: Any,
    provider_message_id: str,
    thread_id: str,
) -> bool:
    """The provider accepted the group's email: every request in it is sent, in one
    thread, and every member's approval is settled as executed. False when the message is
    not a group's."""
    from ai_workforce_api.outbound import settle_approval
    from ai_workforce_api.pbc import _audit as _pbc_audit

    group = _by_lead_approval(cursor.connection, outbound.approval_id)
    if group is None:
        return False
    for request_id, approval_id in cursor.execute(
        "SELECT pbc_request_id, approval_id FROM evidence_request_group_members "
        "WHERE group_id = %s AND released_at IS NULL ORDER BY position",
        (group.id,),
    ).fetchall():
        if approval_id != outbound.approval_id:
            settle_approval(cursor, organization_id, project_id, actor_id, approval_id,
                            "SUCCEEDED", None, provider_message_id)  # fmt: skip
        row = cursor.execute(
            """
            UPDATE pbc_requests
            SET status = 'SENT', outbound_message_id = %s, thread_id = %s,
                updated_at = clock_timestamp(), version = version + 1
            WHERE id = %s AND project_id = %s AND status = 'APPROVAL_PENDING'
            RETURNING id
            """,
            (provider_message_id, thread_id, request_id, project_id),
        ).fetchone()
        if row is not None:
            _pbc_audit(cursor, organization_id, project_id, actor_id, request_id, "SENT")
    cursor.execute(
        "UPDATE evidence_request_groups SET status = 'SENT', sent_at = clock_timestamp(), "
        "updated_at = clock_timestamp(), version = version + 1 "
        "WHERE id = %s AND status = 'APPROVED'",
        (group.id,),
    )
    _group_audit(cursor, organization_id, project_id, actor_id, group.id, "evidence.group_sent",
                 {"outbound_id": str(outbound.id)})  # fmt: skip
    return True


def mark_failed(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    outbound: Any,
) -> None:
    """The provider refused the group's email, or it could not be sent as approved."""
    group = _by_lead_approval(cursor.connection, outbound.approval_id)
    if group is not None and group.status == "APPROVED":
        _retire(cursor, organization_id, project_id, actor_id, group, "delivery_failed")


def lead_scope(cursor: psycopg.Cursor[Any], request_id: UUID) -> tuple[UUID, list[UUID]] | None:
    """For the reminder schedule: (lead, members) when the request travels in a sent
    group; None when it travels alone."""
    group = sent_group_of(cursor.connection, request_id)
    if group is None:
        return None
    return group.lead_request_id, list(group.members)


def _request_audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    request_id: UUID,
    status: str,
    group_id: UUID,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'pbc.updated', 'pbc_request', %s, %s)
        """,
        (organization_id, project_id, actor_id, request_id,
         Json({"status": status, "group_id": str(group_id)})),
    )  # fmt: skip


def _group_audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    group_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'evidence_request_group', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, group_id, Json(payload)),
    )


# Routes


def register_evidence_groups(
    app: FastAPI,
    settings: Settings,
    mailbox: Any = open_mailbox,
    timer: FollowUpTimer | None = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/evidence-groups"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        from ai_workforce_api.outbound import OutboundState

        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except GroupState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except (OutboundState, ApprovalState, PbcState, FollowUpState) as error:
            from ai_workforce_api.evidence_center import _sentence

            raise HTTPException(status_code=409, detail=_sentence(error.detail)) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.get(f"{base}/{{group_id}}")
    def read_group(
        organization_id: UUID, project_id: UUID, group_id: UUID, request: Request
    ) -> GroupView:
        return run(
            request,
            lambda c, p: review(c, settings, p, organization_id, project_id, group_id),
        )

    @app.post(f"{base}/{{group_id}}/approve-send")
    def approve_send(
        organization_id: UUID,
        project_id: UUID,
        group_id: UUID,
        body: ApproveSendBody,
        request: Request,
    ) -> GroupView:
        """Approve every request in it and send the one email."""
        return run(
            request,
            lambda c, p: approve_and_send(
                c, settings, p, organization_id, project_id, group_id, body, mailbox, timer
            ),
        )

    @app.post(f"{base}/{{group_id}}/send")
    def send(
        organization_id: UUID, project_id: UUID, group_id: UUID, request: Request
    ) -> GroupView:
        """Send an approved request whose email has not gone yet, or resume its send."""
        return run(
            request,
            lambda c, p: send_group(
                c, settings, p, organization_id, project_id, group_id, mailbox, timer
            ),
        )
