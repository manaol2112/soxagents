"""The standard library as a methodology knowledge base, and its governance (standard
library, milestone L1).

The library's content is code: each standard control's record (controls.LIBRARY), its
testing definition (definition_registry), and its design statement (statement_registry).
This module reads them for the Library page, one entry per standard control, and records
a firm's methodology review of each: draft, pending review, approved at a library version,
or retired; an approval of an older version reads as superseded once the library moves
on. An entry with no decision is pending review: the published definitions are a draft
for a methodology reviewer until one approves them.

Anyone in the firm may submit a change for review; an owner or admin decides it, as for
the firm's other organization-wide settings. Deciding never edits the library: an accepted
change is applied in code and arrives with the next library version. Every decision is in
the audit trail. Nothing here changes what an engagement loads or tests; which templates a
match may use is the next milestone's.
"""

from collections.abc import Callable
from typing import Annotated, Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
    permits,
)
from ai_workforce_api.control_statements import render
from ai_workforce_api.controls import (
    BY_KEY,
    DOMAIN_LABELS,
    LIBRARY,
    LIBRARY_VERSION,
    LibraryControl,
    kind_for_domain,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.definition_registry import BY_LIBRARY_KEY, definition_version
from ai_workforce_api.settings import Settings
from ai_workforce_api.statement_registry import statement_for
from ai_workforce_api.testing_definitions import SOURCES, TESTED, Definition

Category = Literal["ITGC", "ITAC", "KEY_REPORT", "BUSINESS", "ENTITY"]
CATEGORIES: tuple[Category, ...] = ("ITGC", "ITAC", "KEY_REPORT", "BUSINESS", "ENTITY")
CATEGORY_LABELS: dict[Category, str] = {
    "ITGC": "IT general controls",
    "ITAC": "Application controls",
    "KEY_REPORT": "Key reports and IPE",
    "BUSINESS": "Business process controls",
    "ENTITY": "Entity-level controls",
}

StoredStatus = Literal["DRAFT", "PENDING_REVIEW", "APPROVED", "RETIRED"]
STORED_STATUSES: tuple[StoredStatus, ...] = ("DRAFT", "PENDING_REVIEW", "APPROVED", "RETIRED")
# What the entry reads as: a stored status, or superseded (approved at an earlier version).
Status = Literal["DRAFT", "PENDING_REVIEW", "APPROVED", "SUPERSEDED", "RETIRED"]

RequestKind = Literal["CHANGE", "NEW", "RETIRE"]
RequestStatus = Literal["OPEN", "ACCEPTED", "DECLINED"]
Decision = Literal["ACCEPTED", "DECLINED"]


class GovernanceState(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def category_for(domain: str) -> Category:
    """The library's category for a control's area: the paste's four, and entity-level."""
    if domain == "ENTITY":
        return "ENTITY"
    return kind_for_domain(domain)


def effective_status(
    stored: str | None, approved_version: int | None, library_key: str = ""
) -> Status:
    """What the entry reads as. No decision is pending review; an approval of an earlier
    version of the control's definition is superseded until a reviewer approves the current
    one (each definition carries its version; the library version is the highest)."""
    if stored is None:
        return "PENDING_REVIEW"
    current = definition_version(library_key) if library_key else LIBRARY_VERSION
    if stored == "APPROVED" and (approved_version or 0) < current:
        return "SUPERSEDED"
    if stored in STORED_STATUSES:
        return stored
    return "PENDING_REVIEW"


# Bodies


class GovernanceBody(BaseModel):
    status: Status
    stored_status: StoredStatus | None
    library_version: int
    note: str
    decided_by: str | None
    decided_at: str | None
    approved_by: str | None
    approved_at: str | None
    approved_version: int | None
    # Whether the caller may decide the entry's status and its change requests.
    can_decide: bool


class StepBody(BaseModel):
    action: str
    # Keys of the evidence suite items the step uses.
    evidence: list[str]
    record: str
    exception: str


class ProcedureBody(BaseModel):
    key: str
    phase: str
    objective: str
    action: str
    evidence: list[str]
    attributes: list[str]
    limitation: str
    # Version 4: the numbered steps.
    steps: list[StepBody] = []


class EvidenceItemBody(BaseModel):
    """One item of the standard evidence suite (version 4)."""

    key: str
    name: str
    form: str
    provider: str
    phases: list[str]
    purpose: str
    period: str
    contents: list[str]
    completeness: str
    not_acceptable: str
    alternatives: list[str]
    attributes: list[str]


class SourceBody(BaseModel):
    ref: str
    title: str
    kind: str
    says: str


class AttributeBody(BaseModel):
    key: str
    text: str
    confidence: str
    # HIGH and MODERATE: tested as the library's approved attributes; the rest are proposed
    # to an engagement with their question.
    tested: bool
    condition: str
    why: str
    evidence: list[str]
    extract: list[str]
    compare: str
    passes: str
    fails: str
    insufficient: str
    review: str
    not_infer: str
    basis: list[str]
    assumptions: list[str]
    question: str
    blocks: bool
    # Version 4: keys of the evidence suite items the attribute is judged from.
    evidence_keys: list[str] = []


class RetiredBody(BaseModel):
    text: str
    reason: str
    replaced_by: str


class SlotBody(BaseModel):
    key: str
    label: str
    kind: str
    why: str
    example: str
    blocks: bool


class InformationBody(BaseModel):
    name: str
    kind: str
    elements: list[str]
    ipe: str


class StatementBody(BaseModel):
    # The statement with each client value as its label in brackets.
    text: str
    risk: str
    assertions: list[str]
    control_type: str
    nature: str
    frequency: str
    operator: str
    reviewer: str
    owner: str
    authority: str
    judgment: str
    judgment_note: str
    precision: str
    investigation: str
    information: list[InformationBody]
    itgcs: list[str]
    evidence: str
    slots: list[SlotBody]
    it_risk: str
    principle: str
    applies_when: str


class UsageBody(BaseModel):
    project_id: UUID
    project_name: str
    project_status: str
    controls: int


class ChangeRequestBody(BaseModel):
    id: UUID
    library_key: str | None
    kind: RequestKind
    title: str
    detail: str
    status: RequestStatus
    submitted_by: str
    submitted_at: str
    decided_by: str | None
    decided_at: str | None
    decision_note: str


class EntryRowBody(BaseModel):
    library_key: str
    control_ref: str
    title: str
    category: Category
    domain: str
    domain_label: str
    nature: str
    frequency: str
    control_type: str
    objective: str
    procedures: int
    attributes_tested: int
    attributes_proposed: int
    evidence: int
    status: Status
    approved_version: int | None
    decided_at: str | None
    usage_engagements: int
    usage_controls: int
    open_requests: int


class CategoryBody(BaseModel):
    key: Category
    label: str
    entries: int


class LibraryIndexBody(BaseModel):
    library_version: int
    categories: list[CategoryBody]
    counts: dict[str, int]
    entries: list[EntryRowBody]
    # Change requests that name no standard control (a proposed new one), open first.
    new_requests: list[ChangeRequestBody]


class LibraryEntryBody(BaseModel):
    row: EntryRowBody
    risk: str
    activity: str
    performer: str
    reviewer: str
    trigger: str
    population: str
    sampling: str
    design_confirmation: str
    assumptions: list[str]
    questions: list[str]
    not_applicable: list[str]
    procedures: list[ProcedureBody]
    attributes: list[AttributeBody]
    retired: list[RetiredBody]
    # The evidence the standard control's record names (what an engagement requests).
    evidence: list[str]
    # Version 4: the standard evidence suite, and the definition's version.
    evidence_suite: list[EvidenceItemBody] = []
    definition_version: int
    statement: StatementBody | None
    sources: list[SourceBody]
    governance: GovernanceBody
    usage: list[UsageBody]
    change_requests: list[ChangeRequestBody]


class StatusWrite(BaseModel):
    status: StoredStatus
    note: str = Field(default="", max_length=1000)


class ManyStatusWrite(BaseModel):
    """One decision on several standard controls, as the Library page's selection makes it."""

    library_keys: list[Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9-]{1,59}$")]] = Field(
        min_length=1, max_length=200
    )
    status: StoredStatus
    note: str = Field(default="", max_length=1000)


class ManyStatusResult(BaseModel):
    decided: list[str]
    # Already at that status: nothing to record.
    skipped: list[str]


class ChangeRequestWrite(BaseModel):
    library_key: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{1,59}$")
    kind: RequestKind
    title: str = Field(min_length=3, max_length=200)
    detail: str = Field(min_length=20, max_length=4000)


class DecisionWrite(BaseModel):
    decision: Decision
    note: str = Field(default="", max_length=1000)


# Reading the library


def _iso(value: Any) -> str | None:
    return None if value is None else value.isoformat()


def _row(
    control: LibraryControl,
    definition: Definition | None,
    governance: tuple[Any, ...] | None,
    usage: tuple[int, int],
    open_requests: int,
) -> EntryRowBody:
    statement = statement_for(control.key)
    stored = None if governance is None else str(governance[0])
    approved_version = None if governance is None else governance[3]
    return EntryRowBody(
        library_key=control.key,
        control_ref=control.control_ref,
        title=control.title,
        category=category_for(control.domain),
        domain=control.domain,
        domain_label=DOMAIN_LABELS.get(control.domain, control.domain),
        nature=control.nature,
        frequency=control.frequency,
        control_type=(
            definition.control_type
            if definition is not None
            else (statement.control_type if statement is not None else "")
        ),
        objective=definition.objective if definition is not None else "",
        procedures=0 if definition is None else len(definition.procedures),
        attributes_tested=0 if definition is None else len(definition.approved),
        attributes_proposed=0 if definition is None else len(definition.proposed),
        evidence=len(control.pbc_items),
        status=effective_status(stored, approved_version, control.key),
        approved_version=approved_version,
        decided_at=None if governance is None else _iso(governance[2]),
        usage_engagements=usage[0],
        usage_controls=usage[1],
        open_requests=open_requests,
    )


def _governance_rows(
    connection: psycopg.Connection[Any], organization_id: UUID
) -> dict[str, tuple[Any, ...]]:
    rows = connection.execute(
        """
        SELECT library_key, status, library_version, decided_at, approved_version
        FROM library_entries WHERE organization_id = %s
        """,
        (organization_id,),
    ).fetchall()
    # (status, library_version, decided_at, approved_version)
    return {str(row[0]): (row[1], row[2], row[3], row[4]) for row in rows}


def _usage_counts(
    connection: psycopg.Connection[Any], organization_id: UUID
) -> dict[str, tuple[int, int]]:
    rows = connection.execute(
        """
        SELECT c.library_key, count(DISTINCT p.id), count(*)
        FROM engagement_controls c
        JOIN projects p ON p.id = c.project_id
        WHERE p.organization_id = %s AND p.deleted_at IS NULL
          AND c.included AND c.library_key <> ''
        GROUP BY c.library_key
        """,
        (organization_id,),
    ).fetchall()
    return {str(row[0]): (int(row[1]), int(row[2])) for row in rows}


def _open_request_counts(
    connection: psycopg.Connection[Any], organization_id: UUID
) -> dict[str, int]:
    rows = connection.execute(
        """
        SELECT library_key, count(*) FROM library_change_requests
        WHERE organization_id = %s AND status = 'OPEN' AND library_key IS NOT NULL
        GROUP BY library_key
        """,
        (organization_id,),
    ).fetchall()
    return {str(row[0]): int(row[1]) for row in rows}


def library_index(connection: psycopg.Connection[Any], organization_id: UUID) -> LibraryIndexBody:
    governance = _governance_rows(connection, organization_id)
    usage = _usage_counts(connection, organization_id)
    open_requests = _open_request_counts(connection, organization_id)
    entries = [
        _row(
            control,
            BY_LIBRARY_KEY.get(control.key),
            governance.get(control.key),
            usage.get(control.key, (0, 0)),
            open_requests.get(control.key, 0),
        )
        for control in LIBRARY
    ]
    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry.status] = counts.get(entry.status, 0) + 1
    return LibraryIndexBody(
        library_version=LIBRARY_VERSION,
        categories=[
            CategoryBody(
                key=key,
                label=CATEGORY_LABELS[key],
                entries=sum(1 for entry in entries if entry.category == key),
            )
            for key in CATEGORIES
        ],
        counts=counts,
        entries=entries,
        new_requests=_change_requests(connection, organization_id, None),
    )


def _statement_body(library_key: str) -> StatementBody | None:
    statement = statement_for(library_key)
    if statement is None:
        return None
    labels = {slot.key: slot.label for slot in statement.slots}

    def words(text: str) -> str:
        return render(text, {}, labels)

    return StatementBody(
        text=words(statement.text),
        risk=statement.risk,
        assertions=list(statement.assertions),
        control_type=statement.control_type,
        nature=statement.nature,
        frequency=statement.frequency,
        operator=words(statement.operator),
        reviewer=words(statement.reviewer),
        owner=words(statement.owner),
        authority=words(statement.authority),
        judgment=statement.judgment,
        judgment_note=statement.judgment_note,
        precision=words(statement.precision),
        investigation=words(statement.investigation),
        information=[
            InformationBody(
                name=item.name, kind=item.kind, elements=list(item.elements), ipe=item.ipe
            )
            for item in statement.information
        ],
        itgcs=list(statement.itgcs),
        evidence=words(statement.evidence),
        slots=[
            SlotBody(
                key=slot.key,
                label=slot.label,
                kind=slot.kind,
                why=slot.why,
                example=slot.example,
                blocks=slot.blocks,
            )
            for slot in statement.slots
        ],
        it_risk=statement.it_risk,
        principle=statement.principle,
        applies_when=words(statement.applies_when),
    )


def _name(row: tuple[Any, ...], at: int) -> str | None:
    """A person's display name, or their email, from a row that joined users."""
    value = row[at]
    return None if value is None else str(value)


def _governance(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    library_key: str,
    can_decide: bool,
) -> GovernanceBody:
    row = connection.execute(
        """
        SELECT e.status, e.library_version, e.note, e.decided_at, e.approved_at,
               e.approved_version,
               coalesce(nullif(d.display_name, ''), d.email),
               coalesce(nullif(a.display_name, ''), a.email)
        FROM library_entries e
        JOIN users d ON d.id = e.decided_by
        LEFT JOIN users a ON a.id = e.approved_by
        WHERE e.organization_id = %s AND e.library_key = %s
        """,
        (organization_id, library_key),
    ).fetchone()
    if row is None:
        return GovernanceBody(
            status="PENDING_REVIEW",
            stored_status=None,
            library_version=LIBRARY_VERSION,
            note="",
            decided_by=None,
            decided_at=None,
            approved_by=None,
            approved_at=None,
            approved_version=None,
            can_decide=can_decide,
        )
    return GovernanceBody(
        status=effective_status(str(row[0]), row[5], library_key),
        stored_status=str(row[0]),  # type: ignore[arg-type]
        library_version=int(row[1]),
        note=str(row[2]),
        decided_by=_name(row, 6),
        decided_at=_iso(row[3]),
        approved_by=_name(row, 7),
        approved_at=_iso(row[4]),
        approved_version=None if row[5] is None else int(row[5]),
        can_decide=can_decide,
    )


def _usage(
    connection: psycopg.Connection[Any], organization_id: UUID, library_key: str
) -> list[UsageBody]:
    rows = connection.execute(
        """
        SELECT p.id, p.name, p.status, count(*)
        FROM engagement_controls c
        JOIN projects p ON p.id = c.project_id
        WHERE p.organization_id = %s AND p.deleted_at IS NULL
          AND c.included AND c.library_key = %s
        GROUP BY p.id, p.name, p.status
        ORDER BY p.name
        """,
        (organization_id, library_key),
    ).fetchall()
    return [
        UsageBody(
            project_id=row[0], project_name=str(row[1]), project_status=str(row[2]), controls=row[3]
        )
        for row in rows
    ]


def _change_requests(
    connection: psycopg.Connection[Any], organization_id: UUID, library_key: str | None
) -> list[ChangeRequestBody]:
    rows = connection.execute(
        """
        SELECT r.id, r.library_key, r.kind, r.title, r.detail, r.status, r.submitted_at,
               r.decided_at, r.decision_note,
               coalesce(nullif(s.display_name, ''), s.email),
               coalesce(nullif(d.display_name, ''), d.email)
        FROM library_change_requests r
        JOIN users s ON s.id = r.submitted_by
        LEFT JOIN users d ON d.id = r.decided_by
        WHERE r.organization_id = %s AND r.library_key IS NOT DISTINCT FROM %s
        ORDER BY (r.status = 'OPEN') DESC, r.submitted_at DESC
        """,
        (organization_id, library_key),
    ).fetchall()
    return [
        ChangeRequestBody(
            id=row[0],
            library_key=None if row[1] is None else str(row[1]),
            kind=row[2],
            title=str(row[3]),
            detail=str(row[4]),
            status=row[5],
            submitted_by=str(row[9]),
            submitted_at=row[6].isoformat(),
            decided_by=_name(row, 10),
            decided_at=_iso(row[7]),
            decision_note=str(row[8]),
        )
        for row in rows
    ]


def library_entry(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    library_key: str,
    can_decide: bool,
) -> LibraryEntryBody | None:
    control = BY_KEY.get(library_key)
    if control is None:
        return None
    definition = BY_LIBRARY_KEY.get(library_key)
    governance = _governance_rows(connection, organization_id).get(library_key)
    usage = _usage(connection, organization_id, library_key)
    requests = _change_requests(connection, organization_id, library_key)
    row = _row(
        control,
        definition,
        governance,
        (len(usage), sum(item.controls for item in usage)),
        sum(1 for item in requests if item.status == "OPEN"),
    )
    refs: list[str] = []
    attributes: list[AttributeBody] = []
    procedures: list[ProcedureBody] = []
    retired: list[RetiredBody] = []
    if definition is not None:
        for item in definition.attributes:
            for ref in item.basis:
                if ref not in refs:
                    refs.append(ref)
            attributes.append(
                AttributeBody(
                    key=item.key,
                    text=item.text,
                    confidence=item.confidence,
                    tested=item.confidence in TESTED,
                    condition=item.condition,
                    why=item.why,
                    evidence=list(item.evidence),
                    extract=list(item.extract),
                    compare=item.compare,
                    passes=item.passes,
                    fails=item.fails,
                    insufficient=item.insufficient,
                    review=item.review,
                    not_infer=item.not_infer,
                    basis=[SOURCES[ref].ref for ref in item.basis if ref in SOURCES],
                    assumptions=list(item.assumptions),
                    question=item.question,
                    blocks=item.blocks,
                    evidence_keys=list(item.evidence_keys),
                )
            )
        procedures = [
            ProcedureBody(
                key=item.key,
                phase=item.phase,
                objective=item.objective,
                action=item.action,
                evidence=list(item.evidence),
                attributes=list(item.attributes),
                limitation=item.limitation,
                steps=[
                    StepBody(
                        action=step.action,
                        evidence=list(step.evidence),
                        record=step.record,
                        exception=step.exception,
                    )
                    for step in item.steps
                ],
            )
            for item in definition.procedures
        ]
        suite = [
            EvidenceItemBody(
                key=item.key,
                name=item.name,
                form=item.form,
                provider=item.provider,
                phases=list(item.phases),
                purpose=item.purpose,
                period=item.period,
                contents=list(item.contents),
                completeness=item.completeness,
                not_acceptable=item.not_acceptable,
                alternatives=list(item.alternatives),
                attributes=list(item.attributes),
            )
            for item in definition.evidence
        ]
        retired = [
            RetiredBody(text=item.text, reason=item.reason, replaced_by=item.replaced_by)
            for item in definition.retired
        ]
    return LibraryEntryBody(
        row=row,
        risk=control.risk,
        activity=control.activity,
        performer="" if definition is None else definition.performer,
        reviewer="" if definition is None else definition.reviewer,
        trigger="" if definition is None else definition.trigger,
        population="" if definition is None else definition.population,
        sampling="" if definition is None else definition.sampling,
        design_confirmation="" if definition is None else definition.design_confirmation,
        assumptions=[] if definition is None else list(definition.assumptions),
        questions=[] if definition is None else list(definition.questions),
        not_applicable=[] if definition is None else list(definition.not_applicable),
        procedures=procedures,
        attributes=attributes,
        retired=retired,
        evidence=list(control.pbc_items),
        evidence_suite=[] if definition is None else suite,
        definition_version=definition_version(library_key),
        statement=_statement_body(library_key),
        sources=[
            SourceBody(
                ref=SOURCES[ref].ref,
                title=SOURCES[ref].title,
                kind=SOURCES[ref].kind,
                says=SOURCES[ref].says,
            )
            for ref in refs
            if ref in SOURCES
        ],
        governance=_governance(connection, organization_id, library_key, can_decide),
        usage=usage,
        change_requests=requests,
    )


# Deciding


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    actor: UUID,
    action: str,
    target_type: str,
    target_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (organization_id, actor, action, target_type, target_id, Json(payload)),
    )


def decide_status(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    actor: UUID,
    library_key: str,
    write: StatusWrite,
) -> None:
    """Record where the firm's methodology review of a standard control stands. Approving
    records who approved it and at which library version; a reviewer approves again after
    the library moves on. The same status twice is refused, so a decision is never
    overwritten without a change."""
    if library_key not in BY_KEY:
        raise GovernanceState("that standard control is not in the library")
    with transaction(connection) as cursor:
        current = cursor.execute(
            """
            SELECT id, status, approved_version FROM library_entries
            WHERE organization_id = %s AND library_key = %s FOR UPDATE
            """,
            (organization_id, library_key),
        ).fetchone()
        before = effective_status(
            None if current is None else str(current[1]),
            None if current is None else current[2],
            library_key,
        )
        after: Status = write.status
        if before == after:
            raise GovernanceState(f"the entry is already {after.replace('_', ' ').lower()}")
        approving = write.status == "APPROVED"
        if current is None:
            row = cursor.execute(
                """
                INSERT INTO library_entries (
                    organization_id, library_key, status, library_version, note, decided_by,
                    approved_by, approved_at, approved_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s,
                        CASE WHEN %s THEN clock_timestamp() END, %s)
                RETURNING id
                """,
                (
                    organization_id,
                    library_key,
                    write.status,
                    LIBRARY_VERSION,
                    write.note.strip(),
                    actor,
                    actor if approving else None,
                    approving,
                    LIBRARY_VERSION if approving else None,
                ),
            ).fetchone()
        else:
            row = cursor.execute(
                """
                UPDATE library_entries
                SET status = %s, library_version = %s, note = %s, decided_by = %s,
                    decided_at = clock_timestamp(),
                    approved_by = CASE WHEN %s THEN %s ELSE approved_by END,
                    approved_at = CASE WHEN %s THEN clock_timestamp() ELSE approved_at END,
                    approved_version = CASE WHEN %s THEN %s ELSE approved_version END
                WHERE id = %s
                RETURNING id
                """,
                (
                    write.status,
                    LIBRARY_VERSION,
                    write.note.strip(),
                    actor,
                    approving,
                    actor,
                    approving,
                    approving,
                    LIBRARY_VERSION,
                    current[0],
                ),
            ).fetchone()
        if row is None:
            raise GovernanceState("the entry could not be recorded")
        _audit(
            cursor,
            organization_id,
            actor,
            "library.status",
            "library_entry",
            row[0],
            {
                "library_key": library_key,
                "from": before,
                "to": after,
                "library_version": LIBRARY_VERSION,
            },
        )


def decide_status_many(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    actor: UUID,
    write: ManyStatusWrite,
) -> ManyStatusResult:
    """Record one decision on several standard controls, all or none. Each is recorded and
    audited on its own, as decide_status records it; one already at that status is skipped."""
    keys = list(dict.fromkeys(write.library_keys))
    unknown = [key for key in keys if key not in BY_KEY]
    if unknown:
        raise GovernanceState(f"not in the library: {', '.join(unknown[:5])}")
    decided: list[str] = []
    skipped: list[str] = []
    with transaction(connection):
        current = {
            str(key): (str(status), version)
            for key, status, version in connection.execute(
                "SELECT library_key, status, approved_version FROM library_entries "
                "WHERE organization_id = %s AND library_key = ANY(%s)",
                (organization_id, keys),
            ).fetchall()
        }
        for key in keys:
            status, version = current.get(key, (None, None))
            if effective_status(status, version, key) == write.status:
                skipped.append(key)
                continue
            decide_status(
                connection, organization_id, actor, key,
                StatusWrite(status=write.status, note=write.note),
            )  # fmt: skip
            decided.append(key)
    return ManyStatusResult(decided=decided, skipped=skipped)


def submit_change_request(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    actor: UUID,
    write: ChangeRequestWrite,
) -> UUID:
    """A proposed change to the library, for a methodology reviewer: a change to or
    retirement of a standard control, or a new one."""
    if write.kind == "NEW":
        if write.library_key is not None:
            raise GovernanceState("a proposed new control names no existing one")
    elif write.library_key is None or write.library_key not in BY_KEY:
        raise GovernanceState("name the standard control the change is to")
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO library_change_requests (
                organization_id, library_key, kind, title, detail, submitted_by
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                write.library_key,
                write.kind,
                write.title.strip(),
                write.detail.strip(),
                actor,
            ),
        ).fetchone()
        if row is None:
            raise GovernanceState("the request could not be recorded")
        _audit(
            cursor,
            organization_id,
            actor,
            "library.change_request",
            "library_change_request",
            row[0],
            {"library_key": write.library_key, "kind": write.kind, "status": "OPEN"},
        )
        return UUID(str(row[0]))


def decide_change_request(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    actor: UUID,
    request_id: UUID,
    write: DecisionWrite,
) -> None:
    """Accept or decline a proposed change. Accepting records the decision for the next
    library version; it edits nothing in the library."""
    with transaction(connection) as cursor:
        current = cursor.execute(
            """
            SELECT status, library_key, kind FROM library_change_requests
            WHERE organization_id = %s AND id = %s FOR UPDATE
            """,
            (organization_id, request_id),
        ).fetchone()
        if current is None:
            raise GovernanceState("that change request does not exist")
        if current[0] != "OPEN":
            raise GovernanceState(f"the request is already {str(current[0]).lower()}")
        cursor.execute(
            """
            UPDATE library_change_requests
            SET status = %s, decided_by = %s, decided_at = clock_timestamp(), decision_note = %s
            WHERE id = %s
            """,
            (write.decision, actor, write.note.strip(), request_id),
        )
        _audit(
            cursor,
            organization_id,
            actor,
            "library.change_decision",
            "library_change_request",
            request_id,
            {
                "library_key": None if current[1] is None else str(current[1]),
                "kind": str(current[2]),
                "status": write.decision,
            },
        )


# Routes


def register_library_governance(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/library"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except GovernanceState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    def member(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
    ) -> bool:
        """Every member reads the library; owners and admins decide. Returns whether the
        caller decides."""
        authorize(
            connection,
            principal=principal,
            action=Action.ORGANIZATION_READ,
            organization_id=organization_id,
        )
        return permits(
            connection,
            principal=principal,
            action=Action.ORGANIZATION_UPDATE,
            organization_id=organization_id,
        )

    def decider(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
    ) -> None:
        if principal.kind is not PrincipalKind.USER:
            raise AccessDenied()
        authorize(
            connection,
            principal=principal,
            action=Action.ORGANIZATION_UPDATE,
            organization_id=organization_id,
        )

    @app.get(base)
    def index(organization_id: UUID, request: Request) -> LibraryIndexBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> LibraryIndexBody:
            member(c, p, organization_id)
            return library_index(c, organization_id)

        return run(request, work)

    @app.get(f"{base}/change-requests")
    def change_requests(organization_id: UUID, request: Request) -> list[ChangeRequestBody]:
        def work(c: psycopg.Connection[Any], p: Principal) -> list[ChangeRequestBody]:
            member(c, p, organization_id)
            return _change_requests(c, organization_id, None)

        return run(request, work)

    @app.post(f"{base}/change-requests", status_code=201)
    def submit(organization_id: UUID, body: ChangeRequestWrite, request: Request) -> dict[str, str]:
        def work(c: psycopg.Connection[Any], p: Principal) -> dict[str, str]:
            if p.kind is not PrincipalKind.USER:
                raise AccessDenied()
            member(c, p, organization_id)
            return {"id": str(submit_change_request(c, organization_id, p.id, body))}

        return run(request, work)

    @app.put(f"{base}/change-requests/{{request_id}}")
    def decide_request(
        organization_id: UUID, request_id: UUID, body: DecisionWrite, request: Request
    ) -> dict[str, str]:
        def work(c: psycopg.Connection[Any], p: Principal) -> dict[str, str]:
            decider(c, p, organization_id)
            decide_change_request(c, organization_id, p.id, request_id, body)
            return {"status": body.decision}

        return run(request, work)

    @app.put(f"{base}/status")
    def status_many(
        organization_id: UUID, body: ManyStatusWrite, request: Request
    ) -> ManyStatusResult:
        def work(c: psycopg.Connection[Any], p: Principal) -> ManyStatusResult:
            decider(c, p, organization_id)
            return decide_status_many(c, organization_id, p.id, body)

        return run(request, work)

    @app.get(f"{base}/{{library_key}}")
    def entry(organization_id: UUID, library_key: str, request: Request) -> LibraryEntryBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> LibraryEntryBody:
            decides = member(c, p, organization_id)
            found = library_entry(c, organization_id, library_key, decides)
            if found is None:
                raise HTTPException(status_code=404, detail="standard control not found")
            return found

        return run(request, work)

    @app.put(f"{base}/{{library_key}}/status")
    def status(
        organization_id: UUID, library_key: str, body: StatusWrite, request: Request
    ) -> GovernanceBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> GovernanceBody:
            decider(c, p, organization_id)
            decide_status(c, organization_id, p.id, library_key, body)
            return _governance(c, organization_id, library_key, True)

        return run(request, work)
