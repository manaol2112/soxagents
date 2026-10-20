"""Engagement data for questions and exports (Milestone 8.20).

Everything here reads; nothing writes. Each answer is taken from the engagement's own
records at one moment, in one read-only transaction, and says when that moment was
(as_of). Counts, groupings, overdue days, and completion are worked out here, by the rules
in RULES (docs/metrics.md), never by the model. A value the records do not hold is "not
recorded", never zero or a guess, and records that contradict each other are flagged, not
smoothed over.

Every call authorizes the person for the engagement it reads. Another engagement is found
only among those the person can open in the same firm.
"""

from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    authorize,
    list_projects,
)
from ai_workforce_api.evidence_withdrawn import in_force

RULES_VERSION = "Metrics rulebook v1, pending approval"

# How an evidence request's status reads, in groups an audit team uses.
REQUEST_GROUPS: dict[str, str] = {
    "DRAFT": "draft",
    "APPROVAL_PENDING": "awaiting_approval",
    "SENT": "with_client",
    "WAITING_FOR_RESPONSE": "with_client",
    "OVERDUE": "with_client",
    "ESCALATED": "with_client",
    "PARTIALLY_RECEIVED": "partly_received",
    "RECEIVED": "received",
    "CANCELLED": "cancelled",
}
GROUP_LABELS = {
    "draft": "Draft",
    "awaiting_approval": "Awaiting approval",
    "with_client": "With the client",
    "partly_received": "Partly received",
    "received": "Received",
    "closed": "Closed without receipt",
    "cancelled": "Cancelled",
}
# Not yet received: still to come from the client, or not yet sent.
PENDING_GROUPS = ("draft", "awaiting_approval", "with_client", "partly_received")
# Only a request that has gone out can be late.
OVERDUE_GROUPS = ("with_client", "partly_received")
PHASES = ("DESIGN", "INTERIM", "ROLLFORWARD", "RETEST", "REMEDIATION")
OPEN_NOTES = ("PROPOSED", "OPEN", "RESPONDED")
CLOSED_DEFICIENCIES = ("REMEDIATED", "CLOSED")
NOT_RECORDED = "Not recorded"
MAX_ROWS = 50_000

RequestGroup = Literal[
    "draft",
    "awaiting_approval",
    "with_client",
    "partly_received",
    "received",
    "closed",
    "cancelled",
]
Phase = Literal["DESIGN", "INTERIM", "ROLLFORWARD", "RETEST", "REMEDIATION", "NOT_RECORDED"]
TestingStatus = Literal[
    "complete", "awaiting_review", "in_testing", "awaiting_evidence", "not_started"
]


class DataUnavailable(Exception):
    """The records could not be read, or too many were asked for. The message says which."""


class EngagementUnclear(Exception):
    """The engagement named fits none, or several, of those the person can open. The
    message lists the choices, for the person to pick from."""


@dataclass
class Scope:
    """The engagement read, and the moment its records were read at."""

    organization_id: UUID
    project_id: UUID
    name: str
    client: str
    as_of: datetime


@contextmanager
def snapshot(connection: psycopg.Connection[Any]) -> Iterator[datetime]:
    """One read-only view of the records, and when it was taken.

    Outside a transaction, a repeatable-read transaction keeps every query on the same
    moment, so totals and lists agree even while others change the records. Inside one
    (an API request already reading), the reads join it and the moment is when they start.
    """
    if connection.info.transaction_status == psycopg.pq.TransactionStatus.IDLE:
        with connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            row = connection.execute("SELECT transaction_timestamp()").fetchone()
            yield _moment(row)
        return
    row = connection.execute("SELECT clock_timestamp()").fetchone()
    yield _moment(row)


def _moment(row: tuple[Any, ...] | None) -> datetime:
    if row is None or not isinstance(row[0], datetime):
        raise DataUnavailable("The time of the read could not be taken.")
    return row[0].astimezone(UTC)


def resolve_engagement(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    current: UUID,
    reference: str | None,
) -> UUID:
    """The engagement a question is about: this one, or one the person names that they can
    open in this firm. A name that fits several, or none, is refused with the choices."""
    wanted = " ".join((reference or "").split()).lower()
    if wanted in ("", "this", "this engagement", "current", "this project", "our engagement"):
        return current
    projects = list_projects(connection, principal, organization_id)
    for project in projects:
        if wanted == str(project.id):
            return project.id

    def names(project: Any) -> list[str]:
        client = " ".join(str(project.client_name or "").split()).lower()
        name = " ".join(str(project.name).split()).lower()
        return [name, str(project.slug).lower(), f"{client} {name}".strip(), client]

    exact = [p for p in projects if wanted in names(p)]
    found = exact or [p for p in projects if any(wanted in text for text in names(p))]
    if len(found) == 1:
        return found[0].id

    def label(project: Any) -> str:
        client = str(project.client_name or "").strip()
        return f"{client} · {project.name}" if client else str(project.name)

    if not found:
        known = ", ".join(label(p) for p in projects[:10]) or "none"
        raise EngagementUnclear(
            f'No engagement you can open matches "{reference}". You can open: {known}.'
        )
    choices = ", ".join(label(p) for p in found[:10])
    raise EngagementUnclear(
        f'"{reference}" matches more than one engagement: {choices}. Which one?'
    )


def _scope(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    as_of: datetime,
) -> Scope:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    row = connection.execute(
        """
        SELECT p.name, coalesce(s.client_name, '') FROM projects p
        LEFT JOIN engagement_settings s ON s.project_id = p.id
        WHERE p.id = %s AND p.organization_id = %s AND p.deleted_at IS NULL
        """,
        (project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return Scope(organization_id, project_id, str(row[0]), str(row[1]), as_of)


def scope_body(scope: Scope) -> dict[str, Any]:
    return {
        "engagement": scope.name,
        "client": scope.client or NOT_RECORDED,
        "as_of": scope.as_of.isoformat(timespec="seconds"),
        "rules": RULES_VERSION,
    }


# Evidence requests


@dataclass
class RequestFilters:
    status: str | None = None
    status_group: list[str] = field(default_factory=list)
    phase: str | None = None
    application: str | None = None
    owner: str | None = None
    process: str | None = None
    control_ref: str | None = None
    overdue_only: bool = False
    evidence_review: Literal["not_reviewed", "insufficient", "accepted"] | None = None
    search: str | None = None

    def applied(self) -> dict[str, Any]:
        """The filters as they were applied, for the answer and the export to repeat."""
        values = {
            "status": self.status,
            "status_group": list(self.status_group) or None,
            "phase": self.phase,
            "application": self.application,
            "owner": self.owner,
            "process": self.process,
            "control_ref": self.control_ref,
            "overdue_only": self.overdue_only or None,
            "evidence_review": self.evidence_review,
            "search": self.search,
        }
        return {key: value for key, value in values.items() if value not in (None, "")}


def reference_of(request_id: UUID) -> str:
    """The reference the request's emails carry (outbound._compose)."""
    return f"PBC-{request_id.hex[-8:].upper()}"


def _group(status: str, received_at: datetime | None) -> str:
    if status == "CLOSED":
        return "received" if received_at is not None else "closed"
    return REQUEST_GROUPS.get(status, "unknown")


def _days_late(due_at: datetime, as_of: datetime) -> int:
    """Whole days past the due date, by calendar date in UTC; 0 when due earlier today."""
    return max((as_of.date() - due_at.astimezone(UTC).date()).days, 0)


def _review(sufficiency: list[str], files: int) -> str:
    """Whether what came in has been judged: the evidence requirements the request carries."""
    if not sufficiency:
        return "no requirement linked"
    if "INSUFFICIENT" in sufficiency or "FOLLOW_UP_REQUIRED" in sufficiency:
        return "insufficient"
    if all(value == "ACCEPTED" for value in sufficiency):
        return "accepted"
    if files == 0:
        return "nothing received yet"
    return "not reviewed"


def _request_rows(connection: psycopg.Connection[Any], scope: Scope) -> list[dict[str, Any]]:
    rows = connection.execute(
        f"""
        SELECT r.id, r.control_ref, r.status, r.recipient, r.due_at, r.created_at,
               r.received_at, r.updated_at, r.testing_phase, r.evidence_description,
               r.operation_key, r.provided_directly,
               c.id, c.title, c.owner_name, c.owner_email,
               coalesce(nullif(c.domain_label, ''), c.domain),
               pr.name,
               coalesce(app.name, (
                   SELECT string_agg(a2.name, ', ' ORDER BY a2.name)
                   FROM engagement_applications a2 WHERE a2.id = ANY(c.application_ids)
               )),
               coalesce((
                   SELECT array_agg(DISTINCT category ORDER BY category)
                   FROM evidence_requirements q, unnest(q.categories) AS category
                   WHERE q.pbc_request_id = r.id AND q.status NOT IN ('REMOVED', 'WAIVED')
               ), '{{}}'),
               coalesce((
                   SELECT array_agg(DISTINCT q.sufficiency)
                   FROM evidence_requirements q
                   WHERE q.pbc_request_id = r.id AND q.status NOT IN ('REMOVED', 'WAIVED')
               ), '{{}}'),
               (SELECT count(*) FROM evidence_file_links l
                JOIN evidence_files f ON f.id = l.evidence_file_id
                WHERE l.pbc_request_id = r.id AND NOT {in_force("f")})
        FROM pbc_requests r
        LEFT JOIN engagement_controls c ON c.id = r.engagement_control_id
        LEFT JOIN engagement_processes pr ON pr.id = c.process_id
        LEFT JOIN engagement_applications app ON app.id = c.engagement_application_id
        WHERE r.project_id = %s AND r.organization_id = %s
        """,
        (scope.project_id, scope.organization_id),
    ).fetchall()
    found: list[dict[str, Any]] = []
    for row in rows:
        request_id = UUID(str(row[0]))
        status = str(row[2])
        group = _group(status, row[6])
        due_at: datetime = row[4]
        late = group in OVERDUE_GROUPS and due_at < scope.as_of
        description = " ".join(str(row[9]).split())
        operation = str(row[10])
        kind = (
            "samples"
            if operation.startswith("samples-")
            else "follow-up"
            if operation.startswith("recapture-")
            else "evidence"
        )
        found.append(
            {
                "request_id": str(request_id),
                "reference": reference_of(request_id),
                "control_ref": str(row[1]),
                "control_title": str(row[13] or NOT_RECORDED),
                "application": str(row[18]) if row[18] else NOT_RECORDED,
                "process": str(row[17] or row[16] or NOT_RECORDED),
                "phase": str(row[8]) if row[8] else NOT_RECORDED,
                "evidence_type": ", ".join(str(item).replace("_", " ").lower() for item in row[19])
                or NOT_RECORDED,
                "kind": kind,
                "description": description[:500],
                "control_owner": str(row[14] or row[15] or NOT_RECORDED),
                "recipient": str(row[3]).strip() or NOT_RECORDED,
                "requested_on": row[5].astimezone(UTC).date().isoformat(),
                "due_on": due_at.astimezone(UTC).date().isoformat(),
                "status": status,
                "status_group": group,
                "overdue": late,
                "days_overdue": _days_late(due_at, scope.as_of) if late else 0,
                "files_received": int(row[21]),
                "received_on": None
                if row[6] is None
                else row[6].astimezone(UTC).date().isoformat(),
                "evidence_review": _review([str(item) for item in row[20]], int(row[21])),
                "last_updated": row[7].astimezone(UTC).isoformat(timespec="seconds"),
                "follow_up": _follow_up(group, late, str(row[3]).strip(), row),
                # Kept for the checks below and for matching to controls; not shown.
                "_control_id": None if row[12] is None else UUID(str(row[12])),
                "_due_at": due_at,
                "_provided_directly": bool(row[11]),
            }
        )
    return found


def _follow_up(group: str, late: bool, recipient: str, row: tuple[Any, ...]) -> str:
    """The next thing the request needs, from its own state only."""
    if group == "draft":
        return "Set the recipient, then submit" if recipient == "" else "Submit for approval"
    if group == "awaiting_approval":
        return "An approver to approve the message"
    if late:
        return "Chase the owner: past due"
    if group in ("with_client", "partly_received"):
        return "Wait for the owner" if group == "with_client" else "Wait for the rest"
    return ""


def _matches(text: str | None, wanted: str | None) -> bool:
    return wanted is None or wanted.strip() == "" or wanted.strip().lower() in (text or "").lower()


def evidence_requests(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    filters: RequestFilters,
    *,
    sort: Literal["most_overdue", "due", "control", "status"] = "most_overdue",
    offset: int = 0,
    limit: int | None = 50,
) -> dict[str, Any]:
    """The engagement's evidence requests that match, with totals over all of them and one
    page of rows. Cancelled requests are left out unless asked for by status or group."""
    with snapshot(connection) as as_of:
        scope = _scope(connection, principal, organization_id, project_id, as_of)
        rows = _request_rows(connection, scope)
    wanted_groups = set(filters.status_group)
    chosen = []
    for row in rows:
        if filters.status is not None and row["status"] != filters.status.upper():
            continue
        if wanted_groups and row["status_group"] not in wanted_groups:
            continue
        if not wanted_groups and filters.status is None and row["status_group"] == "cancelled":
            continue
        if filters.phase is not None:
            phase = NOT_RECORDED if filters.phase == "NOT_RECORDED" else filters.phase
            if row["phase"] != phase:
                continue
        if filters.overdue_only and not row["overdue"]:
            continue
        if filters.evidence_review is not None:
            review = {
                "not_reviewed": ("not reviewed",),
                "insufficient": ("insufficient",),
                "accepted": ("accepted",),
            }[filters.evidence_review]
            if row["evidence_review"] not in review:
                continue
        if not _matches(row["application"], filters.application):
            continue
        if not (
            _matches(row["control_owner"], filters.owner)
            or _matches(row["recipient"], filters.owner)
        ):
            continue
        if not _matches(row["process"], filters.process):
            continue
        if filters.control_ref is not None and not row["control_ref"].lower().startswith(
            filters.control_ref.strip().lower()
        ):
            continue
        text = " ".join(
            [row["reference"], row["control_ref"], row["control_title"], row["description"]]
        )
        if not _matches(text, filters.search):
            continue
        chosen.append(row)
    order = {
        "most_overdue": lambda r: (-r["days_overdue"], not r["overdue"], r["due_on"]),
        "due": lambda r: (r["due_on"], r["control_ref"]),
        "control": lambda r: (r["control_ref"], r["due_on"]),
        "status": lambda r: (r["status_group"], r["due_on"]),
    }[sort]
    chosen.sort(key=order)
    if limit is None and len(chosen) > MAX_ROWS:
        raise DataUnavailable(
            f"{len(chosen):,} requests match; narrow the filters to {MAX_ROWS:,} or fewer."
        )
    page = chosen[offset : None if limit is None else offset + limit]
    groups = Counter(row["status_group"] for row in chosen)
    return {
        **scope_body(scope),
        "filters": filters.applied(),
        "total": len(chosen),
        "returned": len(page),
        "offset": offset,
        "more": offset + len(page) < len(chosen),
        "matching": "none" if not chosen else "some",
        "by_status_group": {key: groups.get(key, 0) for key in GROUP_LABELS if groups.get(key)},
        "pending": sum(groups.get(key, 0) for key in PENDING_GROUPS),
        "overdue": sum(1 for row in chosen if row["overdue"]),
        "phase_not_recorded": sum(1 for row in chosen if row["phase"] == NOT_RECORDED),
        "requests": [_public(row) for row in page],
        "data_quality": request_checks(chosen, scope.as_of),
    }


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if not key.startswith("_")}


def request_checks(rows: list[dict[str, Any]], as_of: datetime) -> list[dict[str, Any]]:
    """Records that contradict each other or miss what the work needs. Reported as they
    are, never corrected here."""
    checks: list[tuple[str, str, list[dict[str, Any]]]] = [
        (
            "status_overdue_but_not_due",
            "Marked overdue although the due date has not passed",
            [r for r in rows if r["status"] == "OVERDUE" and r["_due_at"] >= as_of],
        ),
        (
            "received_without_files",
            "Marked received but no evidence file is linked",
            [
                r
                for r in rows
                if r["status_group"] == "received"
                and r["files_received"] == 0
                and not r["_provided_directly"]
            ],
        ),
        (
            "pending_without_phase",
            "Not yet received and no testing phase is recorded",
            [r for r in rows if r["status_group"] in PENDING_GROUPS and r["phase"] == NOT_RECORDED],
        ),
        (
            "unsent_without_recipient",
            "Not yet sent and no recipient email, so it cannot be sent",
            [
                r
                for r in rows
                if r["status_group"] in ("draft", "awaiting_approval")
                and r["recipient"] == NOT_RECORDED
            ],
        ),
    ]
    return [
        {
            "check": key,
            "finding": finding,
            "count": len(found),
            "examples": [f"{r['reference']} ({r['control_ref']})" for r in found[:5]],
        }
        for key, finding, found in checks
        if found
    ]


# Controls


@dataclass
class ControlFilters:
    testing_status: str | None = None
    stage: str | None = None
    application: str | None = None
    owner: str | None = None
    process: str | None = None
    control_ref: str | None = None
    failed_only: bool = False
    key_only: bool = False
    search: str | None = None

    def applied(self) -> dict[str, Any]:
        values = {
            "testing_status": self.testing_status,
            "stage": self.stage,
            "application": self.application,
            "owner": self.owner,
            "process": self.process,
            "control_ref": self.control_ref,
            "failed_only": self.failed_only or None,
            "key_only": self.key_only or None,
            "search": self.search,
        }
        return {key: value for key, value in values.items() if value not in (None, "")}


def testing_status(row: Any, open_notes: int, pending: int) -> str:
    """Where a control's testing stands (RULES): complete only when its conclusion is
    final (every required phase and round tested and independently reviewed:
    control_journey.finality), its review is signed off, and no review note is open."""
    if (
        row.conclusion != "NOT_CONCLUDED"
        and getattr(row, "final", False)
        and row.review_status == "SIGNED_OFF"
        and open_notes == 0
    ):
        return "complete"
    if row.sheet_status == "SIGNED_OFF":
        return "awaiting_review"
    if row.sheet_status == "OPEN" and row.sheet_left not in ("EVIDENCE",):
        return "in_testing"
    if pending > 0 or row.sheet_left == "EVIDENCE":
        return "awaiting_evidence"
    return "not_started"


def _control_rows(
    connection: psycopg.Connection[Any],
    principal: Principal,
    scope: Scope,
    requests: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    from ai_workforce_api.workspace import _controls

    controls = [
        c
        for c in _controls(connection, principal, scope.organization_id, scope.project_id)
        if c.included
    ]
    notes = dict(
        connection.execute(
            """
            SELECT r.engagement_control_id, count(*) FROM review_notes n
            JOIN control_reviews r ON r.id = n.control_review_id
            WHERE n.project_id = %s AND n.status = ANY(%s)
            GROUP BY r.engagement_control_id
            """,
            (scope.project_id, list(OPEN_NOTES)),
        ).fetchall()
    )
    papers: dict[UUID, list[str]] = {}
    for control_id, status in connection.execute(
        "SELECT engagement_control_id, status FROM workpapers WHERE project_id = %s",
        (scope.project_id,),
    ).fetchall():
        papers.setdefault(control_id, []).append(str(status))
    processes = dict(
        connection.execute(
            """
            SELECT c.id, p.name FROM engagement_controls c
            JOIN engagement_processes p ON p.id = c.process_id WHERE c.project_id = %s
            """,
            (scope.project_id,),
        ).fetchall()
    )
    by_control: dict[UUID, list[dict[str, Any]]] = {}
    for request in requests:
        if request["_control_id"] is not None:
            by_control.setdefault(request["_control_id"], []).append(request)
    found = []
    for c in controls:
        mine = [r for r in by_control.get(c.id, []) if r["status_group"] != "cancelled"]
        pending = [r for r in mine if r["status_group"] in PENDING_GROUPS]
        open_notes = int(notes.get(c.id, 0))
        status = testing_status(c, open_notes, len(pending))
        written = papers.get(c.id, [])
        failed = c.conclusion == "EXCEPTION" or c.test_result == "NOT_EFFECTIVE"
        found.append(
            {
                "control_ref": c.label or c.control_ref,
                "title": c.title,
                "application": c.application_name or ", ".join(c.systems) or NOT_RECORDED,
                # The instance's application, for a step that names it (8.5).
                "application_id": None if c.application_id is None else str(c.application_id),
                "process": str(processes.get(c.id) or c.area or NOT_RECORDED),
                "owner": c.owner_name or c.owner_email or NOT_RECORDED,
                "key_control": c.key_control,
                "frequency": c.frequency_label or c.frequency or NOT_RECORDED,
                "stage": c.stage,
                "testing_status": status,
                "test_sheet": c.sheet_status or "NOT_STARTED",
                "test_result": c.test_result or "NOT_CONCLUDED",
                "conclusion": c.conclusion,
                "failed": failed,
                "review": c.review_status or "NOT_OPENED",
                "open_review_notes": open_notes,
                "workpapers": (
                    f"{written.count('PREPARED')} prepared, {written.count('DRAFT')} draft"
                    if written
                    else "None started"
                ),
                "evidence_requests": len(mine),
                "evidence_pending": len(pending),
                "evidence_overdue": sum(1 for r in mine if r["overdue"]),
                "evidence_pending_by_phase": dict(Counter(r["phase"] for r in pending)),
                "open_deficiencies": c.deficiencies,
                "next_step": c.next_step,
                "waiting_on": c.waiting_on,
                "_sheet_left": c.sheet_left,
            }
        )
    return found


def controls(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    filters: ControlFilters,
    *,
    offset: int = 0,
    limit: int | None = 50,
) -> dict[str, Any]:
    """The controls in scope that match, with their testing status, and totals over all."""
    with snapshot(connection) as as_of:
        scope = _scope(connection, principal, organization_id, project_id, as_of)
        requests = _request_rows(connection, scope)
        rows = _control_rows(connection, principal, scope, requests)
    chosen = []
    for row in rows:
        if filters.testing_status is not None and row["testing_status"] != filters.testing_status:
            continue
        if filters.stage is not None and row["stage"] != filters.stage.upper():
            continue
        if filters.failed_only and not row["failed"]:
            continue
        if filters.key_only and not row["key_control"]:
            continue
        if not _matches(row["application"], filters.application):
            continue
        if not _matches(row["owner"], filters.owner):
            continue
        if not _matches(row["process"], filters.process):
            continue
        if filters.control_ref is not None and not row["control_ref"].lower().startswith(
            filters.control_ref.strip().lower()
        ):
            continue
        if not _matches(f"{row['control_ref']} {row['title']}", filters.search):
            continue
        chosen.append(row)
    chosen.sort(key=lambda r: r["control_ref"])
    page = chosen[offset : None if limit is None else offset + limit]
    statuses = Counter(row["testing_status"] for row in chosen)
    return {
        **scope_body(scope),
        "filters": filters.applied(),
        "total": len(chosen),
        "returned": len(page),
        "offset": offset,
        "more": offset + len(page) < len(chosen),
        "matching": "none" if not chosen else "some",
        "by_testing_status": dict(statuses),
        "failed": sum(1 for row in chosen if row["failed"]),
        "controls": [_public(row) for row in page],
        "data_quality": control_checks(chosen),
    }


def control_checks(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    checks: list[tuple[str, str, list[dict[str, Any]]]] = [
        (
            "concluded_with_pending_evidence",
            "Concluded while evidence is still outstanding",
            [r for r in rows if r["conclusion"] != "NOT_CONCLUDED" and r["evidence_pending"] > 0],
        ),
        (
            "failed_without_deficiency",
            "A failed test with no deficiency logged",
            [r for r in rows if r["failed"] and r["open_deficiencies"] == 0],
        ),
        (
            "tested_without_received_evidence",
            "Test signed off but no evidence request is received",
            [
                r
                for r in rows
                if r["test_sheet"] == "SIGNED_OFF"
                and r["evidence_requests"] > 0
                and r["evidence_requests"] == r["evidence_pending"]
            ],
        ),
    ]
    return [
        {
            "check": key,
            "finding": finding,
            "count": len(found),
            "examples": [r["control_ref"] for r in found[:5]],
        }
        for key, finding, found in checks
        if found
    ]


# Exceptions and review


def exceptions(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    *,
    include_closed: bool = False,
    application: str | None = None,
    control_ref: str | None = None,
    offset: int = 0,
    limit: int | None = 50,
) -> dict[str, Any]:
    """Deficiencies as recorded, and failed tests that have none. Severity is shown only as
    the team recorded it; it is a judgment, never worked out here."""
    from ai_workforce_api.workspace import _deficiencies

    with snapshot(connection) as as_of:
        scope = _scope(connection, principal, organization_id, project_id, as_of)
        items = _deficiencies(connection, principal, organization_id, project_id)
        requests = _request_rows(connection, scope)
        control_list = _control_rows(connection, principal, scope, requests)
    rows: list[dict[str, Any]] = []
    for item in items:
        if not include_closed and item.status in CLOSED_DEFICIENCIES:
            continue
        rows.append(
            {
                "exception_id": item.reference,
                "kind": "deficiency",
                "control_ref": item.control_ref or NOT_RECORDED,
                "application": item.application_name or NOT_RECORDED,
                "title": item.title,
                "description": " ".join(item.condition.split())[:500] or NOT_RECORDED,
                "type": item.deficiency_type,
                "severity_as_recorded": item.severity or NOT_RECORDED,
                "status": item.status,
                "remediation_owner": item.remediation_owner or NOT_RECORDED,
                "remediation_due": None
                if item.remediation_due is None
                else item.remediation_due.isoformat(),
                "identified_on": item.identified_at.date().isoformat(),
                "pending_decision": item.pending_change is not None,
            }
        )
    for control in control_list:
        if control["failed"] and control["open_deficiencies"] == 0:
            rows.append(
                {
                    "exception_id": f"TEST-{control['control_ref']}",
                    "kind": "failed test, no deficiency logged",
                    "control_ref": control["control_ref"],
                    "application": control["application"],
                    "title": f"{control['control_ref']} failed testing",
                    "description": "The test result is not effective and no deficiency is "
                    "logged for it. An auditor decides whether it is one.",
                    "type": NOT_RECORDED,
                    "severity_as_recorded": NOT_RECORDED,
                    "status": "NOT_EVALUATED",
                    "remediation_owner": NOT_RECORDED,
                    "remediation_due": None,
                    "identified_on": None,
                    "pending_decision": False,
                }
            )
    chosen = [
        row
        for row in rows
        if _matches(row["application"], application)
        and (
            control_ref is None
            or row["control_ref"].lower().startswith(control_ref.strip().lower())
        )
    ]
    page = chosen[offset : None if limit is None else offset + limit]
    return {
        **scope_body(scope),
        "filters": {
            key: value
            for key, value in {
                "include_closed": include_closed or None,
                "application": application,
                "control_ref": control_ref,
            }.items()
            if value is not None
        },
        "total": len(chosen),
        "returned": len(page),
        "offset": offset,
        "more": offset + len(page) < len(chosen),
        "matching": "none" if not chosen else "some",
        "by_status": dict(Counter(row["status"] for row in chosen)),
        "exceptions": page,
    }


def review_items(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    *,
    control_ref: str | None = None,
    offset: int = 0,
    limit: int | None = 50,
) -> dict[str, Any]:
    """Open review notes, and prepared workpapers whose control's review is not signed off."""
    with snapshot(connection) as as_of:
        scope = _scope(connection, principal, organization_id, project_id, as_of)
        notes = connection.execute(
            """
            SELECT n.number, c.control_ref, coalesce(a.name, ''), n.target_kind, n.target,
                   n.text, n.severity, n.status, n.raised_by, n.raised_at, n.response
            FROM review_notes n
            JOIN control_reviews r ON r.id = n.control_review_id
            JOIN engagement_controls c ON c.id = r.engagement_control_id
            LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
            WHERE n.project_id = %s AND n.status = ANY(%s)
            ORDER BY n.raised_at
            """,
            (scope.project_id, list(OPEN_NOTES)),
        ).fetchall()
        papers = connection.execute(
            """
            SELECT c.control_ref, coalesce(a.name, ''), w.stage, w.prepared_at,
                   coalesce(r.status, 'NOT_OPENED')
            FROM workpapers w
            JOIN engagement_controls c ON c.id = w.engagement_control_id
            LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
            LEFT JOIN control_reviews r ON r.engagement_control_id = c.id
            WHERE w.project_id = %s AND w.status = 'PREPARED'
              AND coalesce(r.status, 'NOT_OPENED') <> 'SIGNED_OFF'
            ORDER BY c.control_ref, w.stage
            """,
            (scope.project_id,),
        ).fetchall()
    rows: list[dict[str, Any]] = []
    for note in notes:
        rows.append(
            {
                "item": f"Review note {note[0]}",
                "kind": "review note",
                "control_ref": str(note[1]),
                "application": str(note[2]) or NOT_RECORDED,
                "about": f"{note[3]} {note[4]}".strip(),
                "detail": " ".join(str(note[5]).split())[:500],
                "severity_as_recorded": str(note[6] or NOT_RECORDED),
                "status": str(note[7]),
                "raised_by": str(note[8]),
                "since": note[9].astimezone(UTC).date().isoformat(),
                "days_open": (scope.as_of.date() - note[9].astimezone(UTC).date()).days,
                "response": " ".join(str(note[10] or "").split())[:300] or None,
            }
        )
    for paper in papers:
        rows.append(
            {
                "item": f"{paper[2].title()} workpaper",
                "kind": "workpaper awaiting review",
                "control_ref": str(paper[0]),
                "application": str(paper[1]) or NOT_RECORDED,
                "about": str(paper[2]),
                "detail": "Prepared; the control's independent review is not signed off.",
                "severity_as_recorded": NOT_RECORDED,
                "status": f"Review {str(paper[4]).replace('_', ' ').lower()}",
                "raised_by": NOT_RECORDED,
                "since": None if paper[3] is None else paper[3].astimezone(UTC).date().isoformat(),
                "days_open": None
                if paper[3] is None
                else (scope.as_of.date() - paper[3].astimezone(UTC).date()).days,
                "response": None,
            }
        )
    chosen = [
        row
        for row in rows
        if control_ref is None or row["control_ref"].lower().startswith(control_ref.lower())
    ]
    page = chosen[offset : None if limit is None else offset + limit]
    return {
        **scope_body(scope),
        "filters": {} if control_ref is None else {"control_ref": control_ref},
        "total": len(chosen),
        "returned": len(page),
        "offset": offset,
        "more": offset + len(page) < len(chosen),
        "matching": "none" if not chosen else "some",
        "by_kind": dict(Counter(row["kind"] for row in chosen)),
        "items": page,
    }


# The overview


def status(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> dict[str, Any]:
    """Where the engagement stands: scope, testing, evidence, exceptions, review, schedule,
    what blocks it, and what in its records does not add up. Every figure comes with its
    rule, and every list names the records behind it."""
    from ai_workforce_api.workspace import _deficiencies, _plan

    with snapshot(connection) as as_of:
        scope = _scope(connection, principal, organization_id, project_id, as_of)
        requests = _request_rows(connection, scope)
        control_list = _control_rows(connection, principal, scope, requests)
        findings = _deficiencies(connection, principal, organization_id, project_id)
        plan = _plan(connection, principal, organization_id, project_id)
        open_notes = connection.execute(
            "SELECT count(*) FROM review_notes WHERE project_id = %s AND status = ANY(%s)",
            (project_id, list(OPEN_NOTES)),
        ).fetchone()
        engagement = connection.execute(
            """
            SELECT p.status::text, s.period_end, s.kicked_off_at IS NOT NULL
            FROM projects p LEFT JOIN engagement_settings s ON s.project_id = p.id
            WHERE p.id = %s
            """,
            (project_id,),
        ).fetchone()
    live = [r for r in requests if r["status_group"] != "cancelled"]
    groups = Counter(r["status_group"] for r in live)
    late = sorted((r for r in live if r["overdue"]), key=lambda r: -r["days_overdue"])
    statuses = Counter(c["testing_status"] for c in control_list)
    complete = statuses.get("complete", 0)
    in_scope = len(control_list)
    open_findings = [d for d in findings if d.status not in CLOSED_DEFICIENCIES]
    waiting_owner = [c for c in control_list if c["waiting_on"] == "OWNER"]
    failed = [c for c in control_list if c["failed"]]
    missed = [m for m in plan.milestones if m.status == "MISSED"]
    blockers = []
    if late:
        blockers.append(
            {
                "blocker": f"{len(late)} evidence request{'s' if len(late) != 1 else ''} overdue",
                "oldest": f"{late[0]['reference']} ({late[0]['control_ref']}), "
                f"{late[0]['days_overdue']} days late",
                "records": [r["reference"] for r in late[:10]],
            }
        )
    if failed:
        blockers.append(
            {
                "blocker": f"{len(failed)} control{'s' if len(failed) != 1 else ''} failed testing",
                "records": [c["control_ref"] for c in failed[:10]],
            }
        )
    notes_open = int(open_notes[0]) if open_notes else 0
    if notes_open:
        blockers.append(
            {"blocker": f"{notes_open} review note{'s' if notes_open != 1 else ''} open"}
        )
    if missed:
        blockers.append(
            {
                "blocker": f"{len(missed)} milestone{'s' if len(missed) != 1 else ''} missed",
                "records": [f"{m.name} (due {m.due_date.isoformat()})" for m in missed[:5]],
            }
        )
    if waiting_owner:
        blockers.append(
            {
                "blocker": f"{len(waiting_owner)} control"
                f"{'s' if len(waiting_owner) != 1 else ''} waiting on a control owner",
                "records": [c["control_ref"] for c in waiting_owner[:10]],
            }
        )
    return {
        **scope_body(scope),
        "engagement_status": str(engagement[0]) if engagement else NOT_RECORDED,
        "launched": bool(engagement[2]) if engagement else False,
        "period_end": None
        if engagement is None or engagement[1] is None
        else engagement[1].isoformat(),
        "controls": {
            "in_scope": in_scope,
            "key": sum(1 for c in control_list if c["key_control"]),
            "by_testing_status": {
                key: statuses.get(key, 0)
                for key in (
                    "complete",
                    "awaiting_review",
                    "in_testing",
                    "awaiting_evidence",
                    "not_started",
                )
            },
            "failed": len(failed),
            "completion": {
                "complete": complete,
                "in_scope": in_scope,
                "percent": None if in_scope == 0 else round(100 * complete / in_scope, 1),
                "rule": "Complete = concluded, independent review signed off, and no review "
                "note open. Out-of-scope controls are left out.",
            },
        },
        "evidence": {
            "requests": len(live),
            "by_status_group": {k: groups.get(k, 0) for k in GROUP_LABELS if groups.get(k)},
            "pending": sum(groups.get(k, 0) for k in PENDING_GROUPS),
            "overdue": len(late),
            "received_not_reviewed": sum(1 for r in live if r["evidence_review"] == "not reviewed"),
            "cancelled_left_out": sum(1 for r in requests if r["status_group"] == "cancelled"),
            "rule": "Pending = not yet received (draft, awaiting approval, with the client, partly "
            "received). Overdue = sent, not fully received, and past its due date.",
        },
        "exceptions": {
            "open_deficiencies": len(open_findings),
            "severity_as_recorded": dict(Counter(d.severity for d in open_findings)),
            "awaiting_decision": sum(1 for d in open_findings if d.pending_change),
            "failed_tests_without_deficiency": sum(
                1 for c in failed if c["open_deficiencies"] == 0
            ),
        },
        "review": {
            "open_review_notes": notes_open,
            "controls_awaiting_review": statuses.get("awaiting_review", 0),
        },
        "schedule": {
            "missed_milestones": len(missed),
            "next_milestones": [
                {"milestone": m.name, "due": m.due_date.isoformat(), "status": m.status}
                for m in plan.milestones
                if m.status != "DONE"
            ][:4],
            "phases_at_risk": [p.name for p in plan.phases if p.status == "AT_RISK"],
        },
        "blockers": blockers,
        "data_quality": request_checks(requests, scope.as_of) + control_checks(control_list),
    }
