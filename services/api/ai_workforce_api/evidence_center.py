"""The engagement's evidence command center (migration 0076): every request on one list,
filtered, sorted, and paged on the server, with counts that come from the records, the
views people save, and changes made to many requests at once.

A request's stage is derived from its records (its status, its latest send approval, an
owner reply the team has not reviewed, and how its evidence was judged), as the product
owner decided; overdue and escalated are flags beside the stage. A file arriving never
completes a request: it is completed once every planned item it carries is judged
sufficient or waived, or once it is closed.

Changes to many requests run one request at a time, each in its own transaction, through
the same functions a single change uses (and so the same checks, authorization, and audit
trail). A request that cannot change is reported with why; the others go through.
"""

import csv
import io
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request, Response
from psycopg.errors import UniqueViolation
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
from ai_workforce_api.pbc import _COLUMNS as _PBC_COLUMNS
from ai_workforce_api.pbc import PbcBody, PbcState
from ai_workforce_api.pbc import _body as _pbc_body
from ai_workforce_api.request_details import (
    AssignmentBody,
    DetailsState,
    classify,
    contacts,
    parse_wording,
    reference_of,
    request_types,
    signals_of,
    title_of,
)
from ai_workforce_api.settings import Settings

Stage = Literal[
    "DRAFT",
    "READY_FOR_REVIEW",
    "APPROVED",
    "SENT",
    "AWAITING_EVIDENCE",
    "EVIDENCE_RECEIVED",
    "UNDER_REVIEW",
    "COMPLETED",
    "CHANGES_REQUESTED",
    "PARTIALLY_RECEIVED",
    "CLARIFICATION_NEEDED",
    "REJECTED",
    "CANCELLED",
]
# The stages shown, in order. "SENT" is no longer one (decided by the product owner): a
# sent request is awaiting its evidence. It stays in Stage so a saved view that filters
# on it still reads, as Awaiting evidence.
STAGES: tuple[Stage, ...] = (
    "DRAFT",
    "CHANGES_REQUESTED",
    "READY_FOR_REVIEW",
    "APPROVED",
    "AWAITING_EVIDENCE",
    "CLARIFICATION_NEEDED",
    "PARTIALLY_RECEIVED",
    "EVIDENCE_RECEIVED",
    "UNDER_REVIEW",
    "COMPLETED",
    "REJECTED",
    "CANCELLED",
)
STAGE_LABELS: dict[str, str] = {
    "DRAFT": "Draft",
    "READY_FOR_REVIEW": "Ready for review",
    "APPROVED": "Approved",
    "SENT": "Sent",
    "AWAITING_EVIDENCE": "Awaiting evidence",
    "EVIDENCE_RECEIVED": "Evidence received",
    "UNDER_REVIEW": "Under review",
    "COMPLETED": "Completed",
    "CHANGES_REQUESTED": "Changes requested",
    "PARTIALLY_RECEIVED": "Partially received",
    "CLARIFICATION_NEEDED": "Clarification needed",
    "REJECTED": "Rejected",
    "CANCELLED": "Cancelled",
}
Agent = Literal["DRAFTING", "TYPE_TO_CONFIRM", "READY_FOR_REVIEW", "READING", "NONE"]
AGENT_LABELS: dict[str, str] = {
    "DRAFTING": "Drafting",
    "TYPE_TO_CONFIRM": "Type to confirm",
    "READY_FOR_REVIEW": "Drafted",
    "READING": "Reading files",
    "NONE": "",
}
Kpi = Literal[
    "needs_assignment",
    "awaiting_approval",
    "awaiting_client",
    "received",
    "needs_review",
    "overdue",
    "completed",
]
KPIS: tuple[Kpi, ...] = (
    "needs_assignment",
    "awaiting_approval",
    "awaiting_client",
    "received",
    "needs_review",
    "overdue",
    "completed",
)
BuiltIn = Literal[
    "all",
    "mine",
    "attention",
    "unassigned",
    "approval",
    "client",
    "validation",
    "overdue",
    "completed",
]
BUILT_IN: dict[str, str] = {
    "all": "All requests",
    "mine": "My requests",
    "attention": "Needs my attention",
    "unassigned": "Unassigned",
    "approval": "Awaiting approval",
    "client": "Awaiting client",
    "validation": "Received, needs validation",
    "overdue": "Overdue",
    "completed": "Completed",
}
_VIEW_KPI: dict[str, Kpi] = {
    "unassigned": "needs_assignment",
    "approval": "awaiting_approval",
    "client": "awaiting_client",
    "validation": "needs_review",
    "overdue": "overdue",
    "completed": "completed",
}
SORTS = ("title", "control", "system", "phase", "type", "owner", "stage", "due", "agent")
PAGE_SIZES = (25, 50, 100, 200)
MAX_BULK = 500
_UNSENT = frozenset({"DRAFT", "APPROVAL_PENDING"})
_OUT = frozenset({"SENT", "WAITING_FOR_RESPONSE", "PARTIALLY_RECEIVED", "OVERDUE", "ESCALATED"})
_LIST = re.compile(r"^[A-Za-z0-9_.@ +/&()-]{1,200}$")
_PHASE_ORDER = {"DESIGN": 0, "INTERIM": 1, "ROLLFORWARD": 2, "REMEDIATION": 3, "RETEST": 4}


class CenterState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


# The lifecycle. evidence-flow's lifecycleOf (request-details-model.ts) says the same.


def lifecycle_of(
    status: str,
    decision: str | None,
    agent_drafted: bool,
    wording_ready: bool,
    clarification: bool,
    requirements: list[tuple[str, str]],
) -> Stage:
    """A request's stage from its records. Requirements are (status, sufficiency)."""
    if status == "CANCELLED":
        return "REJECTED" if decision == "REJECTED" else "CANCELLED"
    if status == "DRAFT":
        if decision == "REJECTED":
            return "CHANGES_REQUESTED"
        return "READY_FOR_REVIEW" if agent_drafted and wording_ready else "DRAFT"
    if status == "APPROVAL_PENDING":
        # RESEND: approved, and sent again on that approval once email is on.
        return "APPROVED" if decision in ("APPROVED", "RESEND") else "READY_FOR_REVIEW"
    if status == "SENT":
        # Sent is awaiting evidence: nothing has to happen between the two.
        return "CLARIFICATION_NEEDED" if clarification else "AWAITING_EVIDENCE"
    if status in ("WAITING_FOR_RESPONSE", "OVERDUE", "ESCALATED"):
        return "CLARIFICATION_NEEDED" if clarification else "AWAITING_EVIDENCE"
    if status == "PARTIALLY_RECEIVED":
        return "CLARIFICATION_NEEDED" if clarification else "PARTIALLY_RECEIVED"
    if status == "RECEIVED":
        if requirements and all(
            state == "WAIVED" or sufficiency == "SUFFICIENT" for state, sufficiency in requirements
        ):
            return "COMPLETED"
        judged = [item for item in requirements if item[0] != "WAIVED"]
        if any(sufficiency != "NOT_REVIEWED" for _, sufficiency in judged):
            return "UNDER_REVIEW"
        return "EVIDENCE_RECEIVED"
    if status == "CLOSED":
        return "COMPLETED"
    return "DRAFT"


# Bodies


class RowBody(BaseModel):
    id: UUID
    reference: str
    title: str
    control_id: UUID | None
    control_ref: str
    control_title: str
    systems: list[str]
    phase: str | None
    request_type: str
    type_label: str
    type_uncertain: bool
    recipient: str
    recipient_name: str
    cc_count: int
    status: str
    stage: Stage
    stage_label: str
    overdue: bool
    escalated: bool
    clarification: bool
    held: bool
    # Why it waits, when held: the plan or attributes it needs first, in words.
    held_reason: str = ""
    due_at: datetime
    priority: str
    agent: Agent
    agent_label: str
    drafted_by: str
    files: int
    version: int
    approval_id: UUID | None = None
    approval_decision: str | None = None
    approval_reason: str | None = None
    approval_decided_by: str | None = None
    viewer_can_decide: bool = False
    kickoff: bool = False
    # The approved attributes of the test plan its items evidence (internal), by code.
    supports: list[str] = []


class KpiBody(BaseModel):
    total: int
    needs_assignment: int
    awaiting_approval: int
    awaiting_client: int
    received: int
    needs_review: int
    overdue: int
    completed: int


class FacetBody(BaseModel):
    key: str
    label: str
    count: int


class FacetsBody(BaseModel):
    stage: list[FacetBody]
    phase: list[FacetBody]
    type: list[FacetBody]
    owner: list[FacetBody]
    system: list[FacetBody]


class ViewBody(BaseModel):
    id: str
    name: str
    built_in: bool
    filters: dict[str, Any]


class MatchBody(BaseModel):
    id: UUID
    version: int


class ControlOption(BaseModel):
    id: UUID
    control_ref: str
    title: str
    systems: list[str]


class TypeOption(BaseModel):
    request_type: str
    label: str
    purpose: str


class ListBody(BaseModel):
    rows: list[RowBody]
    # Every request the filters match, for selecting all of them at once.
    matching: list[MatchBody]
    total: int
    page: int
    size: int
    kpis: KpiBody
    facets: FacetsBody
    views: list[ViewBody]
    # In-scope controls and the request types, for a new request.
    controls: list[ControlOption]
    types: list[TypeOption]
    # In-scope controls with no evidence plan, and planned evidence never requested: what
    # "Generate requests" would do.
    unplanned: int
    unrequested: int
    can_act: bool
    can_approve: bool


class Filters(BaseModel):
    """What narrows the list. Empty lists and None narrow nothing."""

    q: str = Field(default="", max_length=200)
    stage: list[str] = Field(default_factory=list, max_length=20)
    phase: list[str] = Field(default_factory=list, max_length=10)
    type: list[str] = Field(default_factory=list, max_length=20)
    owner: list[str] = Field(default_factory=list, max_length=50)
    system: list[str] = Field(default_factory=list, max_length=50)
    control: UUID | None = None
    kpi: Kpi | None = None
    view: str = Field(default="all", max_length=60)


class ViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    filters: Filters


class BulkItem(BaseModel):
    id: UUID
    version: int = Field(ge=1)


class BulkBody(BaseModel):
    action: Literal["ASSIGN", "DUE", "PRIORITY", "APPROVE", "SUBMIT", "RETURN"]
    items: list[BulkItem] = Field(min_length=1, max_length=MAX_BULK)
    # Only check: say what each request would need, change nothing.
    preview: bool = False
    recipient: str | None = Field(default=None, max_length=254)
    cc: list[str] | None = Field(default=None, max_length=10)
    due_on: date | None = None
    priority: Literal["NORMAL", "HIGH", "URGENT"] | None = None
    reason: str = Field(default="", max_length=500)


class OutcomeBody(BaseModel):
    id: UUID
    reference: str
    title: str
    ok: bool
    detail: str


class BulkResult(BaseModel):
    action: str
    preview: bool
    done: int
    refused: int
    outcomes: list[OutcomeBody]


# Routes


def register_evidence_center(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except (CenterState, DetailsState, PbcState) as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    def filters_of(request: Request) -> tuple[Filters, str, str, int, int]:
        params = request.query_params

        def many(name: str) -> list[str]:
            values = [item.strip() for item in params.get(name, "").split(",") if item.strip()]
            if any(_LIST.fullmatch(item) is None for item in values):
                raise HTTPException(status_code=422, detail="filters are invalid")
            return values

        try:
            control = params.get("control") or None
            filters = Filters(
                q=params.get("q", "").strip(),
                stage=many("stage"),
                phase=many("phase"),
                type=many("type"),
                owner=many("owner"),
                system=many("system"),
                control=UUID(control) if control else None,
                kpi=params.get("kpi") or None,  # type: ignore[arg-type]
                view=params.get("view", "all") or "all",
            )
            sort = params.get("sort", "stage")
            direction = params.get("dir", "asc")
            page = int(params.get("page", "1"))
            size = int(params.get("size", "50"))
        except ValueError:
            raise HTTPException(status_code=422, detail="filters are invalid") from None
        if sort not in SORTS or direction not in ("asc", "desc"):
            raise HTTPException(status_code=422, detail="filters are invalid")
        if page < 1 or size not in PAGE_SIZES:
            raise HTTPException(status_code=422, detail="filters are invalid")
        return filters, sort, direction, page, size

    @app.get(f"{base}/evidence-requests")
    def list_requests(organization_id: UUID, project_id: UUID, request: Request) -> ListBody:
        filters, sort, direction, page, size = filters_of(request)
        return run(
            request,
            lambda c, p: listing(
                c, p, organization_id, project_id, filters, sort, direction, page, size
            ),
        )

    @app.get(f"{base}/evidence-requests.csv")
    def export(organization_id: UUID, project_id: UUID, request: Request) -> Response:
        filters, sort, direction, _page, _size = filters_of(request)
        text = run(
            request,
            lambda c, p: export_csv(c, p, organization_id, project_id, filters, sort, direction),
        )
        return Response(
            content=text.encode("utf-8-sig"),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": 'attachment; filename="evidence-requests.csv"',
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        )

    @app.post(f"{base}/evidence-requests/bulk")
    def bulk_change(
        organization_id: UUID, project_id: UUID, body: BulkBody, request: Request
    ) -> BulkResult:
        return run(request, lambda c, p: bulk(c, settings, p, organization_id, project_id, body))

    @app.get(f"{base}/evidence-views")
    def list_views(organization_id: UUID, project_id: UUID, request: Request) -> list[ViewBody]:
        return run(request, lambda c, p: views(c, p, organization_id, project_id))

    @app.post(f"{base}/evidence-views")
    def save_view(
        organization_id: UUID, project_id: UUID, body: ViewCreate, request: Request
    ) -> ViewBody:
        return run(request, lambda c, p: _save_view(c, p, organization_id, project_id, body))

    @app.post(f"{base}/evidence-views/{{view_id}}/remove")
    def remove_view(
        organization_id: UUID, project_id: UUID, view_id: UUID, request: Request
    ) -> list[ViewBody]:
        return run(request, lambda c, p: _remove_view(c, p, organization_id, project_id, view_id))


# Reading


@dataclass
class _Facts:
    """What was read for the engagement's requests, in one pass."""

    controls: dict[UUID, tuple[str, str, str, list[str]]] = field(default_factory=dict)
    # Each requirement a request carries: status, sufficiency, categories, title.
    requirements: dict[UUID, list[tuple[str, str, list[str], str]]] = field(default_factory=dict)
    drafts: dict[UUID, tuple[str, str, list[str]]] = field(default_factory=dict)
    clarifications: set[UUID] = field(default_factory=set)
    files: Counter[UUID] = field(default_factory=Counter)
    reading: set[UUID] = field(default_factory=set)
    approvals: dict[UUID, dict[str, Any]] = field(default_factory=dict)
    held: set[UUID] = field(default_factory=set)
    plans: dict[UUID, str] = field(default_factory=dict)
    settled: set[UUID] = field(default_factory=set)
    names: dict[str, str] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    # The test plan's approved attributes each request's items evidence, by code.
    supports: dict[UUID, list[str]] = field(default_factory=dict)
    # The (control, phase) pairs a person released (phase_release.py).
    released: set[tuple[UUID, str]] = field(default_factory=set)


def _facts(connection: psycopg.Connection[Any], project_id: UUID) -> _Facts:
    from ai_workforce_api.evidence_plans import ATTRIBUTES_SETTLED_SQL, reconcile_waiting
    from ai_workforce_api.workspace import request_approvals

    facts = _Facts()
    for row in connection.execute(
        """
        SELECT c.id, c.control_ref, c.title, c.domain,
               coalesce(
                   (SELECT array_agg(a.name ORDER BY a.name) FROM engagement_applications a
                    WHERE a.project_id = c.project_id
                      AND (a.id = c.engagement_application_id OR a.id = ANY(c.application_ids))),
                   ARRAY[]::text[])
        FROM engagement_controls c WHERE c.project_id = %s
        """,
        (project_id,),
    ).fetchall():
        facts.controls[row[0]] = (str(row[1]), str(row[2]), str(row[3]), list(row[4] or []))
    for row in connection.execute(
        """
        SELECT pbc_request_id, status, sufficiency, categories, title
        FROM evidence_requirements
        WHERE project_id = %s AND pbc_request_id IS NOT NULL ORDER BY created_at, id
        """,
        (project_id,),
    ).fetchall():
        facts.requirements.setdefault(row[0], []).append(
            (str(row[1]), str(row[2]), [str(item) for item in row[3] or []], str(row[4]))
        )
    for row in connection.execute(
        """
        SELECT DISTINCT ON (pbc_request_id) pbc_request_id, status, coalesce(source, ''),
               coalesce(jsonb_path_query_array(content, '$.items[*].kind'), '[]'::jsonb)
        FROM pbc_drafts WHERE project_id = %s
        ORDER BY pbc_request_id, created_at DESC, id DESC
        """,
        (project_id,),
    ).fetchall():
        kinds = [str(item) for item in row[3]] if isinstance(row[3], list) else []
        facts.drafts[row[0]] = (str(row[1]), str(row[2]), kinds)
    facts.clarifications = {
        row[0]
        for row in connection.execute(
            """
            SELECT DISTINCT pbc_request_id FROM inbound_messages
            WHERE project_id = %s AND pbc_request_id IS NOT NULL
              AND match_status IN ('MATCHED', 'ASSIGNED') AND review_state = 'NEEDS_REVIEW'
            """,
            (project_id,),
        ).fetchall()
    }
    for row in connection.execute(
        """
        SELECT m.pbc_request_id, count(*),
               bool_or(a.status IS NOT NULL AND a.status IN ('PENDING', 'WORKING'))
        FROM evidence_matches m
        LEFT JOIN evidence_analyses a ON a.evidence_file_id = m.evidence_file_id
        WHERE m.project_id = %s AND m.status = 'FILED' AND m.pbc_request_id IS NOT NULL
        GROUP BY m.pbc_request_id
        """,
        (project_id,),
    ).fetchall():
        facts.files[row[0]] = int(row[1])
        if row[2]:
            facts.reading.add(row[0])
    facts.approvals = request_approvals(connection, project_id)
    waiting = reconcile_waiting(connection, project_id)
    for row in connection.execute(
        """
        SELECT r.id, r.engagement_control_id,
               EXISTS (SELECT 1 FROM evidence_plans p
                       WHERE p.engagement_control_id = r.engagement_control_id)
        FROM pbc_requests r JOIN engagement_settings s ON s.project_id = r.project_id
        WHERE r.project_id = %s AND r.status = 'DRAFT' AND r.engagement_control_id IS NOT NULL
          AND s.kicked_off_at IS NOT NULL
          AND (r.operation_key LIKE 'kickoff-%%' OR r.operation_key LIKE 'scope-%%')
        """,
        (project_id,),
    ).fetchall():
        if not row[2] or row[1] in waiting:
            facts.held.add(row[0])
    facts.plans = {
        row[0]: str(row[1])
        for row in connection.execute(
            "SELECT engagement_control_id, status FROM evidence_plans WHERE project_id = %s",
            (project_id,),
        ).fetchall()
    }
    facts.settled = {
        row[0]
        for row in connection.execute(
            f"SELECT c.id FROM engagement_controls c WHERE c.project_id = %s "
            f"AND {ATTRIBUTES_SETTLED_SQL}",
            (project_id,),
        ).fetchall()
    }
    for request_id, codes in connection.execute(
        """
        SELECT q.pbc_request_id, array_agg(DISTINCT a.code ORDER BY a.code)
        FROM evidence_requirements q
        JOIN evidence_requirement_attributes l ON l.requirement_id = q.id
        JOIN control_attributes a ON a.id = l.attribute_id AND a.status = 'APPROVED'
        WHERE q.project_id = %s AND q.status = 'REQUESTED' AND q.pbc_request_id IS NOT NULL
          AND a.code IS NOT NULL
        GROUP BY q.pbc_request_id
        """,
        (project_id,),
    ).fetchall():
        facts.supports[request_id] = sorted(
            (str(code) for code in codes), key=lambda code: (len(code), code)
        )
    facts.released = {
        (row[0], str(row[1]))
        for row in connection.execute(
            "SELECT engagement_control_id, phase FROM phase_releases WHERE project_id = %s",
            (project_id,),
        ).fetchall()
    }
    facts.names = {item.email: item.name for item in contacts(connection, project_id)}
    facts.labels = {item.request_type: item.label for item in request_types(connection)}
    return facts


@dataclass(frozen=True)
class _Row:
    body: RowBody
    owner_user_id: UUID
    drafting: bool


def _rows(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    can_approve: bool,
) -> list[_Row]:
    facts = _facts(connection, project_id)
    now = datetime.now(UTC)
    found: list[_Row] = []
    for raw in connection.execute(
        f"""
        SELECT {_PBC_COLUMNS} FROM pbc_requests
        WHERE organization_id = %s AND project_id = %s
        ORDER BY created_at, id
        """,
        (organization_id, project_id),
    ).fetchall():
        pbc = _pbc_body(raw)
        found.append(_row(pbc, facts, principal, can_approve, now))
    return found


def _row(
    pbc: PbcBody, facts: _Facts, principal: Principal, can_approve: bool, now: datetime
) -> _Row:
    control = facts.controls.get(pbc.engagement_control_id) if pbc.engagement_control_id else None
    requirements = facts.requirements.get(pbc.id, [])
    draft = facts.drafts.get(pbc.id)
    drafting = draft is not None and draft[0] in ("PENDING", "DRAFTING")
    signals = signals_of(
        pbc,
        access=control is not None and control[2] == "ACCESS",
        agent=draft is not None and draft[1] == "MODEL",
        categories=[item[2] for item in requirements],
        kinds=draft[2] if draft is not None else [],
        titles=[item[3] for item in requirements],
    )
    kind = classify(pbc, signals, facts.labels)
    approval = facts.approvals.get(pbc.id, {})
    decision = approval.get("approval_decision")
    clarification = pbc.id in facts.clarifications
    stage = lifecycle_of(
        pbc.status,
        decision,
        pbc.drafted_by == "AGENT",
        not drafting,
        clarification,
        [(item[0], item[1]) for item in requirements],
    )
    unsent = pbc.status in _UNSENT
    agent: Agent = "NONE"
    if drafting:
        agent = "DRAFTING"
    elif unsent and kind.uncertain:
        agent = "TYPE_TO_CONFIRM"
    elif stage == "READY_FOR_REVIEW" and pbc.drafted_by == "AGENT":
        agent = "READY_FOR_REVIEW"
    elif pbc.id in facts.reading:
        agent = "READING"
    title = title_of(pbc, parse_wording(pbc.evidence_description))
    recipient = pbc.recipient.strip().lower()
    held_reason = ""
    if pbc.id in facts.held:
        held_reason = "Held for planning"
    elif (
        pbc.drafted_by == "AGENT"
        and pbc.engagement_control_id is not None
        and pbc.status in _UNSENT
        and (
            pbc.testing_phase in ("DESIGN", "INTERIM", "ROLLFORWARD")
            or pbc.operation_key.startswith(("kickoff-", "scope-"))
        )
    ):
        plan = facts.plans.get(pbc.engagement_control_id)
        if plan is None:
            held_reason = "Held for planning"
        elif plan not in ("APPROVED", "CHANGES_PROPOSED"):
            held_reason = "Awaiting plan approval"
        elif (
            pbc.testing_phase in ("INTERIM", "ROLLFORWARD")
            and pbc.engagement_control_id not in facts.settled
        ):
            held_reason = "Awaiting attributes"
        elif (
            pbc.testing_phase in ("INTERIM", "ROLLFORWARD")
            and not pbc.operation_key.startswith(("kickoff-", "scope-"))
            and (pbc.engagement_control_id, pbc.testing_phase) not in facts.released
        ):
            held_reason = "Awaiting phase release"
    if held_reason and stage == "READY_FOR_REVIEW":
        # Not ready for anyone's review until the plan (or attributes) let it go.
        stage = "DRAFT"
    late = pbc.status in ("OVERDUE", "ESCALATED") or (pbc.status in _OUT and pbc.due_at < now)
    return _Row(
        body=RowBody(
            id=pbc.id,
            reference=reference_of(pbc.id),
            title=title[:160],
            control_id=pbc.engagement_control_id,
            control_ref=control[0] if control else pbc.control_ref,
            control_title=control[1] if control else "",
            systems=control[3] if control else [],
            phase=pbc.testing_phase,
            request_type=kind.request_type,
            type_label=kind.label,
            type_uncertain=kind.uncertain,
            recipient=recipient,
            recipient_name=facts.names.get(recipient, ""),
            cc_count=len(pbc.cc_recipients),
            status=pbc.status,
            stage=stage,
            stage_label=STAGE_LABELS[stage],
            overdue=late,
            escalated=pbc.status == "ESCALATED",
            clarification=clarification,
            held=held_reason != "",
            held_reason=held_reason,
            due_at=pbc.due_at,
            priority=pbc.priority,
            agent=agent,
            agent_label=AGENT_LABELS[agent],
            drafted_by=pbc.drafted_by,
            files=facts.files.get(pbc.id, 0),
            version=pbc.version,
            approval_id=approval.get("approval_id"),
            approval_decision=decision,
            approval_reason=approval.get("approval_reason"),
            approval_decided_by=approval.get("approval_decided_by"),
            viewer_can_decide=(
                can_approve
                and decision == "PENDING"
                and approval.get("approval_requested_by") != principal.id
            ),
            kickoff=pbc.operation_key.startswith(("kickoff-", "scope-")),
            supports=facts.supports.get(pbc.id, []),
        ),
        owner_user_id=pbc.owner_user_id,
        drafting=drafting,
    )


def kpi_of(row: RowBody, kpi: Kpi) -> bool:
    """Whether a request counts toward a figure. The figures are operational filters, not
    a partition: a request partly received is both with the client and received."""
    if kpi == "needs_assignment":
        return row.status in _UNSENT and row.recipient == ""
    if kpi == "awaiting_approval":
        return row.stage == "READY_FOR_REVIEW" and row.recipient != ""
    if kpi == "awaiting_client":
        return row.stage in (
            "SENT",
            "AWAITING_EVIDENCE",
            "CLARIFICATION_NEEDED",
            "PARTIALLY_RECEIVED",
        )
    if kpi == "received":
        return row.status in ("PARTIALLY_RECEIVED", "RECEIVED", "CLOSED") or (
            row.files > 0 and row.status != "CANCELLED"
        )
    if kpi == "needs_review":
        return row.status in ("PARTIALLY_RECEIVED", "RECEIVED") and row.stage != "COMPLETED"
    if kpi == "overdue":
        return row.overdue
    return row.stage == "COMPLETED"


def _attention(row: _Row, principal: Principal, can_act: bool, can_approve: bool) -> bool:
    """What the person reading can move now."""
    body = row.body
    if body.viewer_can_decide:
        return True
    if not can_act:
        return False
    if body.status in _UNSENT and (body.recipient == "" or body.held):
        return True
    if body.stage == "CHANGES_REQUESTED" or body.stage == "APPROVED":
        return True
    if body.stage == "DRAFT" and body.drafted_by == "PERSON" and not row.drafting:
        return True
    if body.stage == "READY_FOR_REVIEW" and body.drafted_by == "AGENT" and can_approve:
        return body.approval_decision != "PENDING"
    if body.clarification:
        return True
    return kpi_of(body, "needs_review")


def _matches(
    row: _Row,
    filters: Filters,
    principal: Principal,
    can_act: bool,
    can_approve: bool,
) -> bool:
    body = row.body
    view = filters.view
    if view == "mine" and row.owner_user_id != principal.id:
        return False
    if view == "attention" and not _attention(row, principal, can_act, can_approve):
        return False
    if view in _VIEW_KPI and not kpi_of(body, _VIEW_KPI[view]):
        return False
    if filters.kpi is not None and not kpi_of(body, filters.kpi):
        return False
    if filters.stage and body.stage not in {
        "AWAITING_EVIDENCE" if item == "SENT" else item for item in filters.stage
    }:
        return False
    if filters.phase and (body.phase or "NONE") not in filters.phase:
        return False
    if filters.type and body.request_type not in filters.type:
        return False
    if filters.owner and (body.recipient or "UNASSIGNED") not in filters.owner:
        return False
    if filters.system and not (set(body.systems or ["NONE"]) & set(filters.system)):
        return False
    if filters.control is not None and body.control_id != filters.control:
        return False
    if filters.q:
        haystack = " ".join(
            [
                body.title,
                body.reference,
                body.control_ref,
                body.control_title,
                body.recipient,
                body.recipient_name,
                *body.systems,
            ]
        ).lower()
        if not all(word in haystack for word in filters.q.lower().split()):
            return False
    return True


def _sort_key(row: RowBody, sort: str) -> tuple[Any, ...]:
    if sort == "title":
        return (row.title.lower(),)
    if sort == "control":
        return (row.control_ref.lower(), row.title.lower())
    if sort == "system":
        return ((row.systems[0] if row.systems else "~").lower(), row.control_ref.lower())
    if sort == "phase":
        return (_PHASE_ORDER.get(row.phase or "", 9), row.control_ref.lower())
    if sort == "type":
        return (row.type_label.lower(), row.control_ref.lower())
    if sort == "owner":
        return ((row.recipient_name or row.recipient or "~").lower(), row.control_ref.lower())
    if sort == "due":
        return (row.due_at, row.control_ref.lower())
    if sort == "agent":
        return (row.agent == "NONE", row.agent, row.control_ref.lower())
    return (STAGES.index(row.stage), not row.overdue, row.due_at, row.control_ref.lower())


def _rights(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> tuple[bool, bool]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    return (
        _allowed(connection, principal, Action.TASK_UPDATE, organization_id, project_id),
        principal.kind is PrincipalKind.USER
        and _allowed(connection, principal, Action.PROJECT_UPDATE, organization_id, project_id),
    )


def _filtered(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    filters: Filters,
    sort: str,
    direction: str,
) -> tuple[list[_Row], list[_Row], bool, bool]:
    can_act, can_approve = _rights(connection, principal, organization_id, project_id)
    if filters.view not in BUILT_IN:
        saved = _saved(connection, principal, project_id, filters.view)
        filters = Filters(**{**saved.model_dump(), "q": filters.q or saved.q, "view": "all"})
    rows = _rows(connection, principal, organization_id, project_id, can_approve)
    chosen = [row for row in rows if _matches(row, filters, principal, can_act, can_approve)]
    chosen.sort(key=lambda row: _sort_key(row.body, sort), reverse=direction == "desc")
    return rows, chosen, can_act, can_approve


def listing(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    filters: Filters,
    sort: str,
    direction: str,
    page: int,
    size: int,
) -> ListBody:
    from ai_workforce_api.evidence_plans import unplanned_controls, unrequested_controls

    rows, chosen, can_act, can_approve = _filtered(
        connection, principal, organization_id, project_id, filters, sort, direction
    )
    bodies = [row.body for row in rows]
    start = (page - 1) * size
    return ListBody(
        rows=[row.body for row in chosen[start : start + size]],
        matching=[MatchBody(id=row.body.id, version=row.body.version) for row in chosen],
        total=len(chosen),
        page=page,
        size=size,
        kpis=KpiBody(
            total=len(bodies),
            **{kpi: sum(1 for body in bodies if kpi_of(body, kpi)) for kpi in KPIS},
        ),
        facets=_facets(bodies),
        views=views(connection, principal, organization_id, project_id),
        controls=_controls(connection, project_id),
        types=[
            TypeOption(request_type=item.request_type, label=item.label, purpose=item.purpose)
            for item in request_types(connection)
        ],
        unplanned=len(unplanned_controls(connection, project_id)),
        unrequested=len(unrequested_controls(connection, project_id)),
        can_act=can_act,
        can_approve=can_approve,
    )


def _controls(connection: psycopg.Connection[Any], project_id: UUID) -> list[ControlOption]:
    return [
        ControlOption(
            id=row[0], control_ref=str(row[1]), title=str(row[2]), systems=list(row[3] or [])
        )  # fmt: skip
        for row in connection.execute(
            """
            SELECT c.id, c.control_ref, c.title,
                   (SELECT array_agg(a.name ORDER BY a.name) FROM engagement_applications a
                    WHERE a.project_id = c.project_id
                      AND (a.id = c.engagement_application_id OR a.id = ANY(c.application_ids)))
            FROM engagement_controls c
            WHERE c.project_id = %s AND c.included
            ORDER BY c.control_ref, c.id
            """,
            (project_id,),
        ).fetchall()
    ]


def _facets(bodies: list[RowBody]) -> FacetsBody:
    stages = Counter(body.stage for body in bodies)
    phases = Counter(body.phase or "NONE" for body in bodies)
    types: Counter[str] = Counter()
    type_labels: dict[str, str] = {}
    owners: Counter[str] = Counter()
    owner_labels: dict[str, str] = {}
    systems: Counter[str] = Counter()
    for body in bodies:
        types[body.request_type] += 1
        type_labels[body.request_type] = body.type_label
        key = body.recipient or "UNASSIGNED"
        owners[key] += 1
        owner_labels[key] = body.recipient_name or body.recipient or "Unassigned"
        for system in body.systems or ["NONE"]:
            systems[system] += 1
    phase_labels = {
        "DESIGN": "Design",
        "INTERIM": "Interim",
        "ROLLFORWARD": "Roll-forward",
        "RETEST": "Retest",
        "REMEDIATION": "Remediation",
        "NONE": "No phase",
    }
    return FacetsBody(
        stage=[
            FacetBody(key=key, label=STAGE_LABELS[key], count=stages[key])
            for key in STAGES
            if stages[key] > 0
        ],
        phase=[
            FacetBody(key=key, label=phase_labels.get(key, key), count=count)
            for key, count in sorted(phases.items(), key=lambda item: _PHASE_ORDER.get(item[0], 9))
        ],
        type=[
            FacetBody(key=key, label=type_labels[key], count=count)
            for key, count in sorted(types.items(), key=lambda item: type_labels[item[0]])
        ],
        owner=[
            FacetBody(key=key, label=owner_labels[key], count=count)
            for key, count in sorted(
                owners.items(), key=lambda item: (item[0] != "UNASSIGNED", owner_labels[item[0]])
            )
        ],
        system=[
            FacetBody(key=key, label="No system" if key == "NONE" else key, count=count)
            for key, count in sorted(systems.items())
        ],
    )


def export_csv(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    filters: Filters,
    sort: str,
    direction: str,
) -> str:
    """The filtered list as a spreadsheet: what the table shows, no internal reasoning."""
    _rows_all, chosen, _act, _approve = _filtered(
        connection, principal, organization_id, project_id, filters, sort, direction
    )
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(
        [
            "Reference",
            "Title",
            "Control",
            "System",
            "Phase",
            "Evidence type",
            "Owner",
            "Copied",
            "Stage",
            "Overdue",
            "Due date",
            "Priority",
            "Files",
        ]
    )
    for row in chosen:
        body = row.body
        writer.writerow(
            [
                _cell(body.reference),
                _cell(body.title),
                _cell(body.control_ref),
                _cell("; ".join(body.systems)),
                _cell(body.phase or ""),
                _cell(body.type_label),
                _cell(body.recipient),
                body.cc_count,
                _cell(body.stage_label),
                "Yes" if body.overdue else "No",
                body.due_at.date().isoformat(),
                _cell(body.priority.capitalize()),
                body.files,
            ]
        )
    return out.getvalue()


def _cell(value: str) -> str:
    """A spreadsheet never runs a cell as a formula."""
    return f"'{value}" if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


# Saved views


def views(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[ViewBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    built = [
        ViewBody(id=key, name=name, built_in=True, filters={"view": key})
        for key, name in BUILT_IN.items()
    ]
    own = connection.execute(
        """
        SELECT id, name, filters FROM evidence_saved_views
        WHERE organization_id = %s AND project_id = %s AND user_id = %s
        ORDER BY lower(name)
        """,
        (organization_id, project_id, principal.id),
    ).fetchall()
    return built + [
        ViewBody(id=str(row[0]), name=str(row[1]), built_in=False, filters=dict(row[2]))
        for row in own
    ]


def _saved(
    connection: psycopg.Connection[Any], principal: Principal, project_id: UUID, view: str
) -> Filters:
    try:
        view_id = UUID(view)
    except ValueError:
        raise ValueError("filters are invalid") from None
    row = connection.execute(
        "SELECT filters FROM evidence_saved_views WHERE id = %s AND project_id = %s "
        "AND user_id = %s",
        (view_id, project_id, principal.id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    saved = Filters.model_validate(row[0])
    # A saved view never names another saved view.
    return saved if saved.view in BUILT_IN else Filters(**{**saved.model_dump(), "view": "all"})


def _save_view(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ViewCreate,
) -> ViewBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    name = " ".join(body.name.split())
    if not name or contains_secret({"name": name, "q": body.filters.q}):
        raise ValueError("the view name is invalid")
    filters = body.filters.model_dump(mode="json")
    if filters["view"] not in BUILT_IN:
        filters["view"] = "all"
    try:
        with transaction(connection) as cursor:
            row = cursor.execute(
                """
                INSERT INTO evidence_saved_views (
                    organization_id, project_id, user_id, name, filters
                )
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (organization_id, project_id, principal.id, name, Json(filters)),
            ).fetchone()
    except UniqueViolation:
        raise CenterState("A view with this name already exists.") from None
    if row is None:
        raise NotVisible()
    return ViewBody(id=str(row[0]), name=name, built_in=False, filters=filters)


def _remove_view(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    view_id: UUID,
) -> list[ViewBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        cursor.execute(
            "DELETE FROM evidence_saved_views WHERE id = %s AND project_id = %s AND user_id = %s",
            (view_id, project_id, principal.id),
        )
    return views(connection, principal, organization_id, project_id)


# Many requests at once


def bulk(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: BulkBody,
) -> BulkResult:
    """One change to many requests, each on its own: a request that cannot change says why
    and the others go through. A preview runs the checks and changes nothing."""
    from ai_workforce_api.approvals import ApprovalDecision, ApprovalState, _decide
    from ai_workforce_api.outbound import (
        ApproveDraftBody,
        OutboundState,
        SubmitBody,
        _approve_draft,
        _submit,
    )
    from ai_workforce_api.request_details import _assign, blocker

    needed = Action.PROJECT_UPDATE if body.action in ("APPROVE", "RETURN") else Action.TASK_UPDATE
    authorize(
        connection,
        principal=principal,
        action=needed,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    if len({item.id for item in body.items}) != len(body.items):
        raise ValueError("each request can appear once")
    reason = " ".join(body.reason.split())
    if contains_secret({"reason": reason}):
        raise ValueError("the note holds a credential")
    if body.action == "ASSIGN" and body.recipient is None:
        raise ValueError("choose who the requests go to")
    if body.action == "DUE" and body.due_on is None:
        raise ValueError("choose a due date")
    if body.action == "PRIORITY" and body.priority is None:
        raise ValueError("choose a priority")
    if body.action == "RETURN" and len(reason) < 3:
        raise ValueError("say what needs to change")
    approvals: dict[UUID, dict[str, Any]] = {}
    if body.action == "RETURN":
        from ai_workforce_api.workspace import request_approvals

        approvals = request_approvals(connection, project_id)
    outcomes: list[OutcomeBody] = []
    for item in body.items:
        current = _read(connection, organization_id, project_id, item.id)
        if current is None:
            outcomes.append(
                OutcomeBody(
                    id=item.id,
                    reference="",
                    title="",
                    ok=False,
                    detail="This request is not on this engagement.",
                )
            )
            continue
        title = title_of(current, parse_wording(current.evidence_description))
        reference = reference_of(current.id)

        def outcome(
            ok: bool,
            detail: str,
            key: UUID = item.id,
            ref: str = reference,
            name: str = title,
        ) -> None:
            outcomes.append(
                OutcomeBody(id=key, reference=ref, title=name[:160], ok=ok, detail=detail)
            )

        if current.version != item.version:
            outcome(False, "The request changed since the list loaded. Reload and try again.")
            continue
        try:
            if body.action in ("ASSIGN", "DUE", "PRIORITY"):
                if current.status not in _UNSENT:
                    outcome(False, "The request has been sent; it can no longer change.")
                    continue
                change = AssignmentBody(
                    version=current.version,
                    recipient=(body.recipient if body.recipient is not None else current.recipient),
                    cc=body.cc if body.cc is not None else current.cc_recipients,
                    due_on=body.due_on or current.due_at.astimezone(UTC).date(),
                    priority=body.priority or current.priority,  # type: ignore[arg-type]
                )
                if body.preview:
                    outcome(True, "Ready to change.")
                    continue
                _assign(connection, settings, principal, organization_id, project_id,
                        item.id, change)  # fmt: skip
                outcome(True, "Changed.")
            elif body.action == "APPROVE":
                if current.drafted_by != "AGENT":
                    outcome(False, "Written by a person: submit it for someone else to approve.")
                    continue
                if current.status != "DRAFT":
                    outcome(False, "Not a draft awaiting review.")
                    continue
                problem = blocker(connection, settings, organization_id, project_id, item.id)
                if problem is not None:
                    outcome(False, problem)
                    continue
                if body.preview:
                    outcome(True, "Ready to approve.")
                    continue
                note = ApproveDraftBody(
                    version=current.version, reason=reason or "Reviewed and approved."
                )
                _approve_draft(
                    connection, settings, principal, organization_id, project_id, item.id, note
                )
                outcome(True, "Approved. Not sent.")
            elif body.action == "SUBMIT":
                if current.status != "DRAFT":
                    outcome(False, "Not a draft.")
                    continue
                problem = blocker(
                    connection,
                    settings,
                    organization_id,
                    project_id,
                    item.id,
                    frozenset({"title", "phase", "instructions", "recipient", "cc", "due",
                               "control", "planning"}),
                )  # fmt: skip
                if problem is not None:
                    outcome(False, problem)
                    continue
                if body.preview:
                    outcome(True, "Ready to submit.")
                    continue
                _submit(connection, settings, principal, organization_id, project_id, item.id,
                        SubmitBody(version=current.version))  # fmt: skip
                outcome(True, "Submitted for approval.")
            else:
                found = approvals.get(item.id, {})
                if found.get("approval_decision") != "PENDING":
                    outcome(False, "No approval is waiting on this request.")
                    continue
                if found.get("approval_requested_by") == principal.id:
                    outcome(False, "You submitted it; another approver must decide it.")
                    continue
                if body.preview:
                    outcome(True, "Ready to return.")
                    continue
                returned = ApprovalDecision(decision="REJECTED", reason=reason)
                _decide(
                    connection, principal, organization_id, project_id, found["approval_id"],
                    returned,
                )  # fmt: skip
                outcome(True, "Returned for changes.")
        except DetailsState as error:
            # The details checks already speak to people.
            outcome(False, error.detail)
        except (PbcState, OutboundState, ApprovalState, CenterState) as error:
            outcome(False, _sentence(error.detail))
        except AccessDenied, NotVisible:
            outcome(False, "Your role does not permit this change.")
        except ValueError:
            outcome(False, "The change is not valid for this request.")
    done = sum(1 for item in outcomes if item.ok)
    return BulkResult(
        action=body.action,
        preview=body.preview,
        done=done,
        refused=len(outcomes) - done,
        outcomes=outcomes,
    )


_INTERNAL = {
    "pbc request changed": "The request changed since the list loaded. Reload and try again.",
    "request is not a draft": "Not a draft awaiting review.",
    "set who the request goes to first": "Assign a recipient.",
    "recipient is not allowed": "This recipient is not permitted for outbound email.",
    "plan the evidence first": "Plan the control's evidence first.",
    "settle the kickoff draft against the plan first": (
        "Reconcile the kickoff draft with the evidence plan first."
    ),
    "approve the test plan first": "Approve the control's test plan first.",
    "settle the control's attributes first": "Settle the control's attributes first.",
    "requester cannot approve": "You submitted it; another approver must decide it.",
    "approval is already decided": "A decision is already recorded.",
    "the evidence coordinator is not set up": "The evidence coordinator is not set up.",
}


def _sentence(detail: str) -> str:
    """A refusal in words for people: the details checks already speak so."""
    return _INTERNAL.get(detail, detail if detail[:1].isupper() else "The change was refused.")


def _read(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, request_id: UUID
) -> PbcBody | None:
    row = connection.execute(
        f"""
        SELECT {_PBC_COLUMNS} FROM pbc_requests
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (request_id, organization_id, project_id),
    ).fetchone()
    return None if row is None else _pbc_body(row)


def _allowed(
    connection: psycopg.Connection[Any],
    principal: Principal,
    action: Action,
    organization_id: UUID,
    project_id: UUID,
) -> bool:
    try:
        authorize(
            connection,
            principal=principal,
            action=action,
            organization_id=organization_id,
            project_id=project_id,
        )
    except AccessDenied, NotVisible:
        return False
    return True
