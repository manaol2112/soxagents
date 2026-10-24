"""The read-only consolidation analysis (Release 2a; docs/release-2a.md).

For one engagement: each requirement's evidence specification (evidence_catalog), then
what Release 2 would do with them, without doing it. Delivery grouping: the requests the
unsent requirements would travel in, grouped so that each is one sensible task for one
person (recipient, phase, workflow, personal data; then control family and due dates as
guidelines). Artifact sharing: the requirements that could share one artifact, identical
or with differences a person would confirm. Each run is recorded, immutable, for review.

It changes no requirement, request, file, receipt, sufficiency, approval, or test: only
the derived specifications (evidence_specifications) and the run itself are written.
"""

import json
import re
from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import date, datetime
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
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_catalog import (
    CATALOG_VERSION,
    KINDS,
    Kind,
    RequirementFacts,
    Sensitivity,
    Spec,
    compatibility,
    spec_hash,
    specification,
)
from ai_workforce_api.settings import Settings

Workflow = Literal["documents", "populations", "samples"]
# A request is a task one person can follow (owner, 24 October 2026): these are guidelines
# for when a group reads better split, not targets.
SPLIT_ITEMS = 25
SPLIT_FAMILIES = 2
SPLIT_DUE_DAYS = 14
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RecipientBasis = Literal["REQUEST", "CONTROL_OWNER", "PROVIDER_ROLE", "NONE"]
# A request's recipient: confirmed on a request already; suggested from the control's
# recorded owner (a person confirms it in R2b); or not assigned (never sendable).
RecipientStatus = Literal["CONFIRMED", "SUGGESTED", "UNASSIGNED"]
StaleReason = Literal[
    "NO_SPECIFICATION", "CATALOG_CHANGED", "REQUIREMENT_CHANGED", "PLAN_REVISED",
    "PLAN_NOT_APPROVED",
]  # fmt: skip


class SpecificationStale(Exception):
    """A specification not computed against the requirement and the current approved
    revision of its plan: nothing may be generated or approved from it."""

    def __init__(self, reasons: dict[UUID, StaleReason]) -> None:
        self.reasons = reasons
        counts = Counter(reasons.values())
        self.detail = "evidence specifications are not current: " + ", ".join(
            f"{n} {reason.lower().replace('_', ' ')}" for reason, n in sorted(counts.items())
        )
        super().__init__(self.detail)


def eligible_for_grouping(status: str | None) -> bool:
    """Only requirements not yet on a request, or on a draft one: a request awaiting
    approval, sent, answered, or closed has entered the audit trail and is never
    regrouped (owner, 24 October 2026)."""
    return status is None or status == "DRAFT"


class Row(BaseModel):
    requirement_id: UUID
    version: int
    updated_at: datetime
    phase: str
    title: str
    categories: list[str]
    control_id: UUID
    control_ref: str
    domain: str
    application: str
    request_id: UUID | None
    request_status: str | None
    recipient: str
    recipient_basis: RecipientBasis
    due: date | None
    plan_revision: int | None
    spec: Spec
    spec_hash: str


class Package(BaseModel):
    """One request delivery grouping would produce, as the auditor would see it."""

    recipient: str
    recipient_status: RecipientStatus
    phase: str
    workflow: Workflow
    sensitivity: Sensitivity
    # Only with a recipient and a known sensitivity; R2b sends nothing else, and an
    # unassigned group is an internal grouping for assignment, never a client request.
    sendable: bool
    family: str | None
    items: int
    controls: int
    sections: list[str]
    due: date | None


class ShareGroup(BaseModel):
    kind: str
    label: str
    verdict: Literal["IDENTICAL", "DIFFERENCES"]
    requirements: int
    controls: list[str]
    # Where and when it applies: its systems (or organization-wide) and phases.
    sources: list[str] = Field(default_factory=list)
    phases: list[str] = Field(default_factory=list)
    differences: list[str] = Field(default_factory=list)


class Summary(BaseModel):
    requirements: int
    active: int
    eligible: int
    requests_today: int
    requests_proposed: int
    recipients: dict[str, int]
    catalog: dict[str, int]
    unmapped: dict[str, int]
    identical_groups: int
    identical_requirements: int
    asks_saved: int
    difference_groups: int
    difference_requirements: int
    specifications_changed: int
    # Requests to assign an owner to, or to classify, before any could be sent.
    unassigned_requests: int = 0
    unassigned_items: int = 0
    unknown_sensitivity_items: int = 0


class AnalysisBody(BaseModel):
    id: UUID
    run_at: datetime
    run_by: str
    catalog_version: int
    summary: Summary
    packages: list[Package]
    shares: list[ShareGroup]
    stale: bool = False
    # Requirements whose specification is not current, by reason (computed when read).
    stale_reasons: dict[str, int] = Field(default_factory=dict)


# Loading and specifications


def _rows(connection: psycopg.Connection[Any], project_id: UUID) -> list[Row]:
    found: list[Row] = []
    for r in connection.execute(
        """
        SELECT r.id, r.version, r.phase, r.title, r.categories, r.requirement_key, r.origin,
               r.period_start, r.period_end, r.as_of,
               c.id, c.control_ref, c.domain, coalesce(c.library_key, ''),
               c.engagement_application_id, coalesce(a.name, ''), c.implementation_key,
               c.owner_email, q.id, q.status, q.recipient, q.due_at, r.updated_at, p.revision
        FROM evidence_requirements r
        JOIN engagement_controls c ON c.id = r.engagement_control_id
        LEFT JOIN evidence_plans p ON p.id = r.plan_id
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        LEFT JOIN pbc_requests q ON q.id = r.pbc_request_id
        WHERE r.project_id = %s AND r.status <> 'WAIVED' AND c.included
        ORDER BY c.control_ref, r.phase, r.requirement_key
        """,
        (project_id,),
    ).fetchall():
        spec = specification(RequirementFacts(
            requirement_key=str(r[5]), phase=str(r[2]), title=str(r[3]),
            categories=tuple(str(x) for x in (r[4] or [])), origin=str(r[6] or ""),
            period_start=r[7], period_end=r[8], as_of=r[9], control_id=str(r[10]),
            library_key=str(r[13]), application_id=None if r[14] is None else str(r[14]),
            implementation_key=str(r[16] or ""), domain=str(r[12]),
        ))  # fmt: skip
        recipient, basis = _recipient(r[20], r[17], spec.provider, str(r[15]))
        due = r[21].date() if isinstance(r[21], datetime) else None
        found.append(Row(
            requirement_id=UUID(str(r[0])), version=int(r[1]), updated_at=r[22], phase=str(r[2]),
            title=str(r[3]), categories=[str(x) for x in (r[4] or [])],
            control_id=UUID(str(r[10])), control_ref=str(r[11]), domain=str(r[12]),
            application=str(r[15]), request_id=None if r[18] is None else UUID(str(r[18])),
            request_status=None if r[19] is None else str(r[19]), recipient=recipient,
            recipient_basis=basis, due=due, spec=spec, spec_hash=spec_hash(spec),
            plan_revision=None if r[23] is None else int(r[23]),
        ))  # fmt: skip
    return found


def _recipient(
    named: Any, owner: Any, provider: str, application: str
) -> tuple[str, RecipientBasis]:
    """Who the requirement goes to: the request's recipient, else the control's owner
    (lower-cased addresses). Without a named person it waits to be assigned, one group per
    system: the library's provider role differs item by item ("the access administrator",
    "the system administrator") and would split one person's work into fragments; it is
    a hint for whoever assigns the request, not a recipient. Nothing is invented: an
    address that is not one is ignored."""
    if isinstance(named, str) and EMAIL.match(named.strip()):
        return named.strip().lower(), "REQUEST"
    if isinstance(owner, str) and EMAIL.match(owner.strip()):
        return owner.strip().lower(), "CONTROL_OWNER"
    where = application or "no system"
    return f"Not yet assigned: {where}", "PROVIDER_ROLE" if provider else "NONE"


def refresh_specifications(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, rows: list[Row]
) -> int:
    """Store each requirement's specification, again for any requirement edited since;
    returns how many specifications are new or say something different."""
    stored = {
        UUID(str(row[0])): (str(row[1]), int(row[2]), int(row[3]), row[4], row[5])
        for row in cursor.execute(
            "SELECT requirement_id, spec_hash, requirement_version, catalog_version, "
            "computed_at, plan_revision FROM evidence_specifications WHERE project_id = %s",
            (project_id,),
        ).fetchall()
    }
    changed = 0
    for row in rows:
        known = stored.get(row.requirement_id)
        same = known is not None and known[0] == row.spec_hash and known[2] == CATALOG_VERSION
        current = (
            known is not None and known[1] == row.version and known[3] >= row.updated_at
            and known[4] == row.plan_revision
        )  # fmt: skip
        if same and current:
            continue
        if not same:
            changed += 1
        cursor.execute(
            """
            INSERT INTO evidence_specifications (requirement_id, organization_id, project_id,
                                                 catalog_version, kind, spec, spec_hash,
                                                 requirement_version, plan_revision)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (requirement_id) DO UPDATE
            SET catalog_version = EXCLUDED.catalog_version, kind = EXCLUDED.kind,
                spec = EXCLUDED.spec, spec_hash = EXCLUDED.spec_hash,
                requirement_version = EXCLUDED.requirement_version,
                plan_revision = EXCLUDED.plan_revision, computed_at = clock_timestamp()
            """,
            (row.requirement_id, organization_id, project_id, CATALOG_VERSION, row.spec.kind,
             row.spec.model_dump_json(), row.spec_hash, row.version, row.plan_revision),
        )  # fmt: skip
    return changed


# Delivery grouping


def workflow_of(categories: list[str]) -> Workflow:
    if "SAMPLE" in categories:
        return "samples"
    if "POPULATION" in categories:
        return "populations"
    return "documents"


def _source(row: Row) -> str:
    """The section a requirement sits in: its system, else the organization, else its
    control family (a business process or governance control has no system)."""
    if row.spec.level == "ORGANIZATION":
        return "Organization-wide"
    if row.application:
        return row.application
    from ai_workforce_api.controls import DOMAIN_LABELS

    return DOMAIN_LABELS.get(row.domain, row.domain.replace("_", " ").title())


def packages(rows: list[Row]) -> list[Package]:
    """The requests the eligible requirements would travel in. Grouped by recipient,
    phase, workflow, and sensitivity (personal data travels on its own; evidence whose
    sensitivity is not established travels on its own and is not sendable). A large group
    reads better split by control family when it spans several, then by source (system)
    when it is still large, and by due date when its dates are far apart. Each requirement
    stays one item."""
    groups: dict[tuple[str, str, Workflow, Sensitivity], list[Row]] = defaultdict(list)
    for row in rows:
        key = (row.recipient, row.phase, workflow_of(row.categories), row.spec.sensitivity)
        groups[key].append(row)
    found: list[Package] = []
    for (recipient, phase, flow, sensitivity), members in sorted(groups.items()):
        families = sorted({row.domain for row in members})
        parts: list[tuple[str | None, list[Row]]] = [(None, members)]
        if len(members) > SPLIT_ITEMS and len(families) > SPLIT_FAMILIES:
            parts = [(family, [r for r in members if r.domain == family]) for family in families]
        by_source: list[tuple[str | None, list[Row]]] = []
        for family, part in parts:
            sources = sorted({_source(r) for r in part})
            if len(part) > SPLIT_ITEMS and len(sources) > 1:
                by_source.extend(
                    (family, [r for r in part if _source(r) == src]) for src in sources
                )
            else:
                by_source.append((family, part))
        for family, part in by_source:
            dues = sorted(r.due for r in part if r.due is not None)
            if dues and (dues[-1] - dues[0]).days > SPLIT_DUE_DAYS:
                first = [
                    r for r in part if r.due is None or (r.due - dues[0]).days <= SPLIT_DUE_DAYS
                ]
                rest = [r for r in part if r not in first]
                chunks = [first, rest]
            else:
                chunks = [part]
            for chunk in chunks:
                chunk_dues = [r.due for r in chunk if r.due is not None]
                bases = {r.recipient_basis for r in chunk}
                status: RecipientStatus = (
                    "UNASSIGNED" if bases & {"PROVIDER_ROLE", "NONE"}
                    else "CONFIRMED" if bases == {"REQUEST"}
                    else "SUGGESTED"
                )  # fmt: skip
                found.append(Package(
                    recipient=recipient, recipient_status=status, phase=phase, workflow=flow,
                    sensitivity=sensitivity,
                    sendable=status != "UNASSIGNED" and sensitivity != "UNKNOWN",
                    family=family, items=len(chunk),
                    controls=len({r.control_id for r in chunk}),
                    sections=sorted({_source(r) for r in chunk}),
                    due=min(chunk_dues) if chunk_dues else None,
                ))  # fmt: skip
    return found


def requests_today(rows: list[Row]) -> int:
    """How many requests the same requirements travel in today: one per control and
    phase, with samples in their own."""
    return len({(r.control_id, r.phase, workflow_of(r.categories) == "samples") for r in rows})


# Artifact sharing


def _root(parent: dict[str, str], key: str) -> str:
    """The representative of a key's group (union-find, with path halving)."""
    while parent[key] != key:
        parent[key] = parent[parent[key]]
        key = parent[key]
    return key


def shares(rows: list[Row]) -> list[ShareGroup]:
    """The requirements that could share one artifact: identical specifications, then
    pairs a person would have to confirm (differences shown). Requirements of the same
    control and phase are one ask already and are not counted twice."""
    found: list[ShareGroup] = []
    by_hash: dict[str, list[Row]] = defaultdict(list)
    for row in rows:
        if (
            row.spec.kind not in (None, "CONTROL_SPECIFIC")
            and not row.spec.sample
            and row.spec.sensitivity != "UNKNOWN"
        ):
            by_hash[row.spec_hash].append(row)
    identical: list[list[Row]] = [group for group in by_hash.values() if len(group) > 1]
    for group in identical:
        spec = group[0].spec
        assert spec.kind is not None
        found.append(ShareGroup(
            kind=spec.kind, label=KINDS[spec.kind].label, verdict="IDENTICAL",
            requirements=len(group), controls=sorted({r.control_ref for r in group}),
            sources=sorted({_source(r) for r in group}), phases=sorted({r.phase for r in group}),
        ))  # fmt: skip
    # Differences: one representative per identical group, compared within a kind, and
    # the specifications a person could reconcile joined into one group with every
    # difference named (an item asked in three phases is one group, not three pairs).
    heads = [group[0] for group in by_hash.values()]
    by_kind: dict[Kind, list[Row]] = defaultdict(list)
    for row in heads:
        assert row.spec.kind is not None
        by_kind[row.spec.kind].append(row)
    for kind, members in sorted(by_kind.items()):
        parent = {row.spec_hash: row.spec_hash for row in members}
        noted: dict[str, set[str]] = defaultdict(set)
        for i, a in enumerate(members):
            for b in members[i + 1 :]:
                verdict = compatibility(a.spec, b.spec)
                if verdict.verdict == "DIFFERENCES":
                    parent[_root(parent, a.spec_hash)] = _root(parent, b.spec_hash)
                    noted[a.spec_hash].update(verdict.differences)
        clusters: dict[str, list[str]] = defaultdict(list)
        for row in members:
            clusters[_root(parent, row.spec_hash)].append(row.spec_hash)
        for hashes in clusters.values():
            if len(hashes) < 2:
                continue
            both = [r for key in hashes for r in by_hash[key]]
            found.append(ShareGroup(
                kind=kind, label=KINDS[kind].label, verdict="DIFFERENCES",
                requirements=len(both), controls=sorted({r.control_ref for r in both}),
                sources=sorted({_source(r) for r in both}),
                phases=sorted({r.phase for r in both}),
                differences=sorted({d for key in hashes for d in noted[key]}),
            ))  # fmt: skip
    return found


# The analysis


def analyze(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, actor: UUID
) -> AnalysisBody:
    """Refresh the specifications, analyse, and record the run."""
    rows = _rows(connection, project_id)
    eligible = [r for r in rows if eligible_for_grouping(r.request_status)]
    planned = packages(eligible)
    groups = shares(rows)
    catalog: Counter[str] = Counter(str(r.spec.kind or "OUTSIDE") for r in rows)
    unmapped = Counter(r.spec.unmapped_reason for r in rows if r.spec.kind is None)
    identical = [g for g in groups if g.verdict == "IDENTICAL"]
    different = [g for g in groups if g.verdict == "DIFFERENCES"]
    with transaction(connection) as cursor:
        changed = refresh_specifications(cursor, organization_id, project_id, rows)
        summary = Summary(
            requirements=len(rows),
            active=len(rows) - len(eligible),
            eligible=len(eligible),
            requests_today=requests_today(eligible),
            requests_proposed=len(planned),
            recipients=dict(Counter(r.recipient_basis for r in eligible)),
            catalog=dict(catalog),
            unmapped=dict(unmapped),
            identical_groups=len(identical),
            identical_requirements=sum(g.requirements for g in identical),
            asks_saved=sum(g.requirements - 1 for g in identical),
            difference_groups=len(different),
            difference_requirements=sum(g.requirements for g in different),
            specifications_changed=changed,
            unassigned_requests=sum(1 for p in planned if p.recipient_status == "UNASSIGNED"),
            unassigned_items=sum(p.items for p in planned if p.recipient_status == "UNASSIGNED"),
            unknown_sensitivity_items=sum(1 for r in eligible if r.spec.sensitivity == "UNKNOWN"),
        )
        detail = {"packages": [p.model_dump(mode="json") for p in planned],
                  "shares": [g.model_dump(mode="json") for g in groups]}  # fmt: skip
        recorded = cursor.execute(
            """
            INSERT INTO evidence_consolidation_analyses (organization_id, project_id,
                                                         catalog_version, summary, detail,
                                                         run_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (organization_id, project_id, CATALOG_VERSION, summary.model_dump_json(),
             json.dumps(detail), actor),
        ).fetchone()  # fmt: skip
        assert recorded is not None
        cursor.execute(
            """
            INSERT INTO audit_events (organization_id, project_id, actor_user_id, action,
                                      target_type, target_id, payload)
            VALUES (%s, %s, %s, 'evidence.consolidation_analyzed',
                    'evidence_consolidation_analysis', %s, %s)
            """,
            (organization_id, project_id, actor, recorded[0],
             json.dumps({"catalog_version": CATALOG_VERSION,
                         "requests_today": summary.requests_today,
                         "requests_proposed": summary.requests_proposed})),
        )  # fmt: skip
    found = latest(connection, project_id)
    assert found is not None
    return found


# Freshness


def staleness(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    requirement_ids: list[UUID] | None = None,
) -> dict[UUID, StaleReason]:
    """The requirements whose specification is not current, and why: none yet, an older
    catalog, the requirement changed since, its plan revised since, or its plan not
    approved at its current revision. In-scope, not waived requirements only."""
    found: dict[UUID, StaleReason] = {}
    for row in connection.execute(
        """
        SELECT r.id, s.requirement_id IS NULL, s.catalog_version, s.requirement_version,
               r.version, r.updated_at > s.computed_at, s.plan_revision, p.revision,
               p.approved_revision, p.status
        FROM evidence_requirements r
        JOIN engagement_controls c ON c.id = r.engagement_control_id AND c.included
        LEFT JOIN evidence_plans p ON p.id = r.plan_id
        LEFT JOIN evidence_specifications s ON s.requirement_id = r.id
        WHERE r.project_id = %s AND r.status <> 'WAIVED'
          AND (%s::uuid[] IS NULL OR r.id = ANY(%s::uuid[]))
        """,
        (project_id, requirement_ids, requirement_ids),
    ).fetchall():
        requirement = UUID(str(row[0]))
        if row[1]:
            found[requirement] = "NO_SPECIFICATION"
        elif row[2] != CATALOG_VERSION:
            found[requirement] = "CATALOG_CHANGED"
        elif row[3] != row[4] or row[5]:
            found[requirement] = "REQUIREMENT_CHANGED"
        elif row[6] is None or row[6] != row[7]:
            found[requirement] = "PLAN_REVISED"
        elif row[8] != row[7] or str(row[9]) != "APPROVED":
            found[requirement] = "PLAN_NOT_APPROVED"
    return found


def require_fresh(
    connection: psycopg.Connection[Any], project_id: UUID, requirement_ids: list[UUID]
) -> None:
    """The gate before any request is generated or approved from specifications (R2b's
    contract): every requirement's specification computed against the requirement as it
    is and the current, approved revision of its plan, or nothing proceeds."""
    stale = staleness(connection, project_id, requirement_ids)
    if stale:
        raise SpecificationStale(stale)


def latest(connection: psycopg.Connection[Any], project_id: UUID) -> AnalysisBody | None:
    """The engagement's latest analysis, and whether a requirement or its plan changed
    since (a plan not yet approved is reported, not counted as a change)."""
    row = connection.execute(
        """
        SELECT x.id, x.run_at, u.display_name, x.catalog_version, x.summary, x.detail
        FROM evidence_consolidation_analyses x JOIN users u ON u.id = x.run_by
        WHERE x.project_id = %s ORDER BY x.run_at DESC, x.id DESC LIMIT 1
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        return None
    reasons: Counter[str] = Counter(str(r) for r in staleness(connection, project_id).values())
    changed = sum(n for reason, n in reasons.items() if reason != "PLAN_NOT_APPROVED")
    detail = row[5] or {}
    return AnalysisBody(
        id=UUID(str(row[0])), run_at=row[1], run_by=str(row[2]), catalog_version=int(row[3]),
        summary=Summary.model_validate(row[4]),
        packages=[Package.model_validate(p) for p in detail.get("packages", [])],
        shares=[ShareGroup.model_validate(g) for g in detail.get("shares", [])],
        stale=changed > 0 or int(row[3]) != CATALOG_VERSION,
        stale_reasons=dict(reasons),
    )  # fmt: skip


def register_consolidation(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/evidence-consolidation"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        return _call(settings, lambda connection: work(connection, principal))

    @app.post(f"{base}/analyses")
    def run_analysis(organization_id: UUID, project_id: UUID, request: Request) -> AnalysisBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> AnalysisBody:
            authorize(c, principal=p, action=Action.TASK_UPDATE,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            if p.kind is not PrincipalKind.USER:
                raise NotVisible()
            return analyze(c, organization_id, project_id, p.id)

        return run(request, work)

    @app.get(f"{base}/analyses/latest")
    def latest_analysis(organization_id: UUID, project_id: UUID, request: Request) -> AnalysisBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> AnalysisBody:
            authorize(c, principal=p, action=Action.TASK_READ,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            found = latest(c, project_id)
            if found is None:
                raise HTTPException(status_code=404, detail="no analysis has run yet")
            return found

        return run(request, work)
