"""Evidence the team adds directly: a folder or files, matched to controls by an agent.

Each uploaded file gets the same immutable custody record as a mailbox attachment, with
the folder path it came from. The evidence coordinator then reads it, matches it to its
control, and files it when it is confident (evidence_analysis.py). A person can file a
file the agent was unsure about, or move one the agent filed. Moving a file reads it
again against its new control, and puts its old request back when nothing else moved it.

Names and folder paths come from the person's computer and are untrusted: they are
checked, never used as storage keys, and shown as plain text.
"""

import asyncio
import re
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
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
from ai_workforce_api.control_instances import family_ids
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence import MAX_BYTES, StoreFactory
from ai_workforce_api.evidence_analysis import (
    EvidenceAnalysisScheduler,
    queue_analysis,
    restart_analysis,
    schedule_analyses,
)
from ai_workforce_api.evidence_classify import KIND_LABELS
from ai_workforce_api.evidence_links import control_request, evidence_hint
from ai_workforce_api.evidence_receipts import apply_receipt, undo_receipt
from ai_workforce_api.evidence_review import review_decided
from ai_workforce_api.evidence_withdrawn import in_force, is_withdrawn
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import StoreError, digest_of, open_store
from ai_workforce_api.testing_engine import TestScheduler, request_run, schedule_runs

MAX_PATH = 500
# Files a computer adds to folders on its own. They are not evidence.
_SYSTEM_FILES = frozenset({".ds_store", "thumbs.db", "desktop.ini", "icon\r"})
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_CONTENT_TYPE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,60}/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,60}$"
)

RowState = Literal["READING", "NEEDS_MATCH", "FILED", "NOT_LINKED"]


class IntakeState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class UploadBody(BaseModel):
    file_id: UUID
    file_name: str
    folder_path: str
    duplicate: bool


class Suggestion(BaseModel):
    control_id: UUID
    control_ref: str
    title: str
    reason: str


class RegisterApplication(BaseModel):
    id: UUID
    name: str


class RegisterControl(BaseModel):
    id: UUID
    control_ref: str
    title: str
    area: str
    # The instance's application (Milestone 8.5): pages show "ID · application".
    application: str = ""
    applications: list[RegisterApplication] = []


class RegisterRequest(BaseModel):
    id: UUID
    status: str
    provided_directly: bool


class RegisterFile(BaseModel):
    id: UUID
    file_name: str
    folder_path: str
    source: Literal["UPLOAD", "MAILBOX"]
    size_bytes: int
    content_type: str
    created_at: datetime
    added_by: str
    batch_id: UUID | None
    # READING: the agent is reading or matching it. NEEDS_MATCH: waits for a person.
    # FILED: filed to a control. NOT_LINKED: a mailbox file whose reply has no request.
    state: RowState
    filed_by: Literal["AGENT", "PERSON", "OWNER", "EMAIL"] | None
    confidence: float | None
    match_reason: str
    suggestions: list[Suggestion]
    filing_version: int | None
    control: RegisterControl | None
    request: RegisterRequest | None
    analysis_id: UUID | None
    read_status: str | None
    kind: str | None
    kind_label: str | None
    kind_confirmed: bool
    summary: str
    review_status: str | None
    review_proposed: str | None
    review_decision: str | None
    # Which of its control's applications the file shows (ONE), all of them (ALL), or
    # not known yet (UNKNOWN); and who said so.
    application: RegisterApplication | None = None
    application_scope: Literal["ONE", "ALL", "UNKNOWN"] | None = None
    application_by: Literal["AGENT", "PERSON"] | None = None
    application_reason: str = ""
    application_version: int | None = None


class WithdrawnFile(BaseModel):
    """A file a person withdrew. Its custody record stays; it is not evidence any more."""

    id: UUID
    file_name: str
    folder_path: str
    source: Literal["UPLOAD", "MAILBOX"]
    size_bytes: int
    created_at: datetime
    added_by: str
    reason: str
    withdrawn_by: str
    withdrawn_at: datetime
    # The file that took its place, when it was replaced; a replaced file is not restored.
    replaced_by: UUID | None
    replaced_by_name: str | None
    control: RegisterControl | None


class RegisterBody(BaseModel):
    files: list[RegisterFile]
    controls: list[RegisterControl]
    withdrawn: list[WithdrawnFile] = []


class ApplicationBody(BaseModel):
    # ONE with the application, or ALL when the file applies to every application.
    scope: Literal["ONE", "ALL"]
    application_id: UUID | None = None


class FilingBody(BaseModel):
    version: int = Field(ge=1)
    # None takes the file off its control, back to the files that need a match.
    control_id: UUID | None


def register_evidence_intake(
    app: FastAPI,
    settings: Settings,
    store: StoreFactory = open_store,
    analyses: EvidenceAnalysisScheduler | None = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except IntakeState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None

    @app.post(f"{base}/evidence-uploads")
    async def upload(
        organization_id: UUID,
        project_id: UUID,
        batch_id: UUID,
        name: str,
        request: Request,
        path: str = "",
        request_id: UUID | None = None,
    ) -> UploadBody:
        file_name = clean_name(name)
        folder = clean_folder(path)
        content = await request.body()
        if not content or len(content) > MAX_BYTES:
            raise HTTPException(status_code=422, detail="file is empty or too large")
        content_type = clean_type(request.headers.get("content-type", ""))
        stored, queued = run(
            request,
            lambda c, p: _upload(
                c,
                store(settings, c),
                p,
                organization_id,
                project_id,
                batch_id,
                file_name,
                folder,
                content_type,
                content,
                request_id,
            ),
        )
        await asyncio.to_thread(schedule_analyses, analyses, [] if queued is None else [queued])
        return stored

    @app.get(f"{base}/evidence-register")
    def register(organization_id: UUID, project_id: UUID, request: Request) -> RegisterBody:
        return run(request, lambda c, p: _register(c, p, organization_id, project_id))

    @app.post(f"{base}/evidence-files/{{file_id}}/application")
    def set_application(
        organization_id: UUID,
        project_id: UUID,
        file_id: UUID,
        body: ApplicationBody,
        request: Request,
    ) -> RegisterBody:
        result, queued = run(
            request,
            lambda c, p: _set_application(c, p, organization_id, project_id, file_id, body),
        )
        tests = analyses if isinstance(analyses, TestScheduler) else None
        schedule_runs(tests, queued)
        return result

    @app.post(f"{base}/evidence-files/{{file_id}}/filing")
    def file(
        organization_id: UUID,
        project_id: UUID,
        file_id: UUID,
        body: FilingBody,
        request: Request,
    ) -> RegisterBody:
        result, queued = run(
            request, lambda c, p: _file(c, p, organization_id, project_id, file_id, body)
        )
        schedule_analyses(analyses, [] if queued is None else [queued])
        return result


# Checking what the person's computer sent


def clean_name(value: str) -> str:
    name = value.strip()
    if (
        not name
        or len(name) > 200
        or "/" in name
        or "\\" in name
        or name in (".", "..")
        or _CONTROL_CHARS.search(name)
    ):
        raise HTTPException(status_code=422, detail="file name is invalid")
    lowered = name.lower()
    if lowered in _SYSTEM_FILES or lowered.startswith(("~$", "._")):
        raise HTTPException(status_code=422, detail="not an evidence file")
    return name


def clean_folder(value: str) -> str:
    """A relative folder path, with forward slashes, never climbing out of itself."""
    parts = [part.strip() for part in value.replace("\\", "/").split("/")]
    parts = [part for part in parts if part not in ("", ".")]
    folder = "/".join(parts)
    if (
        any(part == ".." for part in parts)
        or len(folder) > MAX_PATH
        or _CONTROL_CHARS.search(folder)
        or re.match(r"^[A-Za-z]:", folder)
    ):
        raise HTTPException(status_code=422, detail="folder path is invalid")
    return folder


def clean_type(value: str) -> str:
    kind = value.split(";", 1)[0].strip().lower()
    return kind if _CONTENT_TYPE.fullmatch(kind) else "application/octet-stream"


# Storing


def _person(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    action: Action,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=action,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()


def _require_active(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> None:
    """Only an active engagement takes new evidence or changes its filings."""
    row = connection.execute(
        "SELECT status::text FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    if row[0] != "ACTIVE":
        raise IntakeState("the engagement is not active, so it takes no new evidence")


def _upload(
    connection: psycopg.Connection[Any],
    store: Any,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    batch_id: UUID,
    file_name: str,
    folder: str,
    content_type: str,
    content: bytes,
    request_id: UUID | None = None,
) -> tuple[UploadBody, UUID | None]:
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _require_active(connection, organization_id, project_id)
    # A file added on a request is filed to it by the person: nothing to match.
    target = None if request_id is None else _request_target(connection, project_id, request_id)
    digest = digest_of(content)
    existing = _existing(connection, project_id, digest, folder, file_name)
    if existing is not None and is_withdrawn(connection, existing):
        raise IntakeState("this file was withdrawn; restore it from the withdrawn files")
    if existing is not None:
        return UploadBody(
            file_id=existing, file_name=file_name, folder_path=folder, duplicate=True
        ), None
    file_id = uuid4()
    key = f"evidence/{file_id}"
    store.put(key, content)
    try:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO evidence_files (
                    id, organization_id, project_id, source, upload_batch_id, folder_path,
                    object_key, content_sha256, size_bytes, content_type, file_name, stored_by
                )
                VALUES (%s, %s, %s, 'UPLOAD', %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    file_id,
                    organization_id,
                    project_id,
                    batch_id,
                    folder,
                    key,
                    digest,
                    len(content),
                    content_type,
                    file_name,
                    principal.id,
                ),
            )
            if target is None:
                cursor.execute(
                    "INSERT INTO evidence_matches (organization_id, project_id, evidence_file_id) "
                    "VALUES (%s, %s, %s)",
                    (organization_id, project_id, file_id),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO evidence_matches (
                        organization_id, project_id, evidence_file_id, status,
                        engagement_control_id, pbc_request_id, filed_by, decided_by, reason
                    )
                    VALUES (%s, %s, %s, 'FILED', %s, %s, 'PERSON', %s, %s)
                    """,
                    (
                        organization_id,
                        project_id,
                        file_id,
                        target[1],
                        target[0],
                        principal.id,
                        "Added on its evidence request.",
                    ),
                )
            cursor.execute(
                """
                INSERT INTO audit_events (
                    organization_id, project_id, actor_user_id, action, target_type,
                    target_id, payload
                )
                VALUES (%s, %s, %s, 'evidence.uploaded', 'evidence_file', %s, %s)
                """,
                (
                    organization_id,
                    project_id,
                    principal.id,
                    file_id,
                    Json(
                        {
                            "content_sha256": digest,
                            "size_bytes": len(content),
                            "batch_id": str(batch_id),
                        }
                    ),
                ),
            )
            queued = queue_analysis(cursor, organization_id, project_id, file_id, principal.id)
    except UniqueViolation:
        # The same file arrived twice at once: the first one is kept.
        again = _existing(connection, project_id, digest, folder, file_name)
        if again is None:
            raise
        return UploadBody(
            file_id=again, file_name=file_name, folder_path=folder, duplicate=True
        ), None
    return UploadBody(
        file_id=file_id, file_name=file_name, folder_path=folder, duplicate=False
    ), queued


def _request_target(
    connection: psycopg.Connection[Any], project_id: UUID, request_id: UUID
) -> tuple[UUID, UUID]:
    """The request and its in-scope control, for a file added on the request."""
    row = connection.execute(
        """
        SELECT r.id, coalesce(r.engagement_control_id, c.id), r.status
        FROM pbc_requests r
        LEFT JOIN engagement_controls c
          ON c.project_id = r.project_id AND c.control_ref = r.control_ref AND c.included
        WHERE r.id = %s AND r.project_id = %s
        LIMIT 1
        """,
        (request_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    if row[2] in ("CANCELLED", "CLOSED"):
        raise IntakeState("this request is closed, so it takes no more evidence")
    if row[1] is None:
        raise IntakeState("this request is not linked to a control in scope")
    return UUID(str(row[0])), UUID(str(row[1]))


def _existing(
    connection: psycopg.Connection[Any], project_id: UUID, digest: str, folder: str, name: str
) -> UUID | None:
    row = connection.execute(
        """
        SELECT id FROM evidence_files
        WHERE project_id = %s AND source = 'UPLOAD' AND content_sha256 = %s
          AND folder_path = %s AND file_name = %s
        """,
        (project_id, digest, folder, name),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


# The register


_REGISTER = (
    """
    SELECT f.id, f.file_name, f.folder_path, f.source, f.size_bytes, f.content_type,
           f.created_at, f.upload_batch_id,
           coalesce(u.display_name, f.uploaded_by_email::text || ' (secure link)'),
           m.status, m.filed_by, m.confidence, m.reason, m.suggestions, m.version,
           c.id, c.control_ref, c.title, c.domain_label,
           r.id, r.status, r.provided_directly,
           a.id, a.status, a.classification ->> 'kind', a.confirmed_kind,
           a.classification ->> 'summary',
           v.status, v.proposed, v.decision,
           t.scope, ea.id, ea.name, t.tagged_by, t.reason, t.version, ca.name
    FROM evidence_files f
    LEFT JOIN users u ON u.id = f.stored_by
    LEFT JOIN evidence_matches m ON m.evidence_file_id = f.id
    LEFT JOIN evidence_file_links l ON l.evidence_file_id = f.id
    LEFT JOIN engagement_controls c
      ON c.id = l.engagement_control_id AND c.project_id = f.project_id
    LEFT JOIN engagement_applications ca ON ca.id = c.engagement_application_id
    LEFT JOIN pbc_requests r ON r.id = l.pbc_request_id AND r.project_id = f.project_id
    LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
    LEFT JOIN evidence_reviews v ON v.evidence_analysis_id = a.id
    LEFT JOIN evidence_file_applications t ON t.evidence_file_id = f.id
    LEFT JOIN engagement_applications ea ON ea.id = t.engagement_application_id
    WHERE f.organization_id = %s AND f.project_id = %s AND NOT """
    + in_force("f")
    + """
"""
)

_WITHDRAWN = """
    SELECT f.id, f.file_name, f.folder_path, f.source, f.size_bytes, f.created_at,
           coalesce(u.display_name, f.uploaded_by_email::text || ' (secure link)'),
           w.reason, wu.display_name, w.withdrawn_at, w.replaced_by_file_id,
           nf.file_name, c.id, c.control_ref, c.title, c.domain_label
    FROM evidence_withdrawals w
    JOIN evidence_files f ON f.id = w.evidence_file_id
    LEFT JOIN users u ON u.id = f.stored_by
    JOIN users wu ON wu.id = w.withdrawn_by
    LEFT JOIN evidence_files nf ON nf.id = w.replaced_by_file_id
    LEFT JOIN evidence_matches m ON m.evidence_file_id = f.id AND m.status = 'FILED'
    LEFT JOIN engagement_controls c ON c.id = m.engagement_control_id
    WHERE w.restored_at IS NULL AND f.organization_id = %s AND f.project_id = %s
"""


def _register(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID | None = None,
) -> RegisterBody:
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    rows = connection.execute(
        _REGISTER
        + ("" if file_id is None else " AND f.id = %s")
        + " ORDER BY f.created_at DESC, f.id DESC LIMIT 2000",
        (organization_id, project_id)
        if file_id is None
        else (organization_id, project_id, file_id),
    ).fetchall()
    withdrawn = connection.execute(
        _WITHDRAWN
        + ("" if file_id is None else " AND f.id = %s")
        + " ORDER BY w.withdrawn_at DESC LIMIT 500",
        (organization_id, project_id)
        if file_id is None
        else (organization_id, project_id, file_id),
    ).fetchall()
    controls = connection.execute(
        """
        SELECT c.id, c.control_ref, c.title, c.domain_label,
               coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name)
                                          ORDER BY a.name)
                         FROM engagement_applications a
                         WHERE a.project_id = c.project_id
                           AND a.id IN (SELECT o.engagement_application_id
                                        FROM engagement_controls o
                                        WHERE o.project_id = c.project_id
                                          AND o.control_ref = c.control_ref)),
                        '[]'::jsonb),
               ca.name
        FROM engagement_controls c
        LEFT JOIN engagement_applications ca ON ca.id = c.engagement_application_id
        WHERE c.project_id = %s AND c.included ORDER BY c.control_ref, ca.name NULLS FIRST
        """,
        (project_id,),
    ).fetchall()
    return RegisterBody(
        files=[_row(row) for row in rows],
        controls=[
            RegisterControl(
                id=row[0],
                control_ref=str(row[1]),
                title=str(row[2]),
                area=str(row[3]),
                applications=[RegisterApplication.model_validate(item) for item in row[4]],
                application="" if row[5] is None else str(row[5]),
            )
            for row in controls
        ],
        withdrawn=[
            WithdrawnFile(
                id=row[0],
                file_name=str(row[1]),
                folder_path=str(row[2]),
                source="UPLOAD" if row[3] == "UPLOAD" else "MAILBOX",
                size_bytes=int(row[4]),
                created_at=row[5],
                added_by=str(row[6]),
                reason=str(row[7]),
                withdrawn_by=str(row[8]),
                withdrawn_at=row[9],
                replaced_by=row[10],
                replaced_by_name=None if row[11] is None else str(row[11]),
                control=None
                if row[12] is None
                else RegisterControl(
                    id=row[12], control_ref=str(row[13]), title=str(row[14]), area=str(row[15])
                ),
            )
            for row in withdrawn
        ],
    )


def _row(row: tuple[Any, ...]) -> RegisterFile:
    source: Literal["UPLOAD", "MAILBOX"] = "UPLOAD" if row[3] == "UPLOAD" else "MAILBOX"
    match_status = None if row[9] is None else str(row[9])
    read_status = None if row[23] is None else str(row[23])
    control = (
        None
        if row[15] is None
        else RegisterControl(
            id=row[15],
            control_ref=str(row[16]),
            title=str(row[17]),
            area=str(row[18]),
            application="" if row[36] is None else str(row[36]),
        )
    )
    state: RowState
    filed_by: Literal["AGENT", "PERSON", "OWNER", "EMAIL"] | None = None
    if source == "UPLOAD":
        if match_status == "FILED":
            state = "FILED"
            filed_by = (
                "PERSON" if row[10] == "PERSON" else "OWNER" if row[10] == "OWNER" else "AGENT"
            )
        elif match_status == "NEEDS_MATCH":
            state = "NEEDS_MATCH"
        else:
            state = "READING"
    else:
        state = "FILED" if control is not None else "NOT_LINKED"
        filed_by = "EMAIL" if control is not None else None
    kind = row[25] if row[25] is not None else row[24]
    suggestions = row[13] if isinstance(row[13], list) else []
    return RegisterFile(
        id=row[0],
        file_name=str(row[1]),
        folder_path=str(row[2]),
        source=source,
        size_bytes=int(row[4]),
        content_type=str(row[5]),
        created_at=row[6],
        added_by=str(row[8]),
        batch_id=row[7],
        state=state,
        filed_by=filed_by,
        confidence=None if row[11] is None else float(row[11]),
        match_reason=str(row[12] or ""),
        suggestions=[
            Suggestion.model_validate(item) for item in suggestions if isinstance(item, dict)
        ],
        filing_version=None if row[14] is None else int(row[14]),
        control=control,
        request=None
        if row[19] is None
        else RegisterRequest(id=row[19], status=str(row[20]), provided_directly=bool(row[21])),
        analysis_id=row[22],
        read_status=read_status,
        kind=None if kind is None else str(kind),
        kind_label=None if kind is None else KIND_LABELS.get(str(kind), str(kind)),
        kind_confirmed=row[25] is not None,
        summary=str(row[26] or ""),
        review_status=None if row[27] is None else str(row[27]),
        review_proposed=None if row[28] is None else str(row[28]),
        review_decision=None if row[29] is None else str(row[29]),
        application=None if row[31] is None else RegisterApplication(id=row[31], name=str(row[32])),
        application_scope=None if row[30] is None else row[30],
        application_by=None if row[33] is None else row[33],
        application_reason=str(row[34] or ""),
        application_version=None if row[35] is None else int(row[35]),
    )


# Filing by a person


def _file(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    body: FilingBody,
) -> tuple[RegisterBody, UUID | None]:
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _require_active(connection, organization_id, project_id)
    queued: UUID | None = None
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            SELECT m.id, m.status, m.version, m.engagement_control_id, m.filed_by,
                   a.id, a.status, a.confirmed_kind
            FROM evidence_matches m
            JOIN evidence_files f ON f.id = m.evidence_file_id AND f.source = 'UPLOAD'
            LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
            WHERE m.evidence_file_id = %s AND m.project_id = %s AND m.organization_id = %s
            FOR UPDATE OF m
            """,
            (file_id, project_id, organization_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if is_withdrawn(cursor, file_id):
            raise IntakeState("this file is withdrawn; restore it first")
        match_id, status, version, current, filed_by = row[0], row[1], row[2], row[3], row[4]
        analysis_id, read_status, confirmed = row[5], row[6], row[7]
        if int(version) != body.version:
            raise IntakeState("filing changed")
        if status == "PENDING" or read_status in ("PENDING", "WORKING"):
            raise IntakeState("the agent is still reading this file")
        if analysis_id is not None and review_decided(connection, analysis_id):
            raise IntakeState("the screenshot review is signed off, so the file stays filed")
        control = None
        if body.control_id is not None:
            control = cursor.execute(
                "SELECT id, control_ref FROM engagement_controls "
                "WHERE id = %s AND project_id = %s AND included",
                (body.control_id, project_id),
            ).fetchone()
            if control is None:
                raise NotVisible()
        if control is not None and current == control[0]:
            # The same control: the person confirms the agent's filing. Nothing is reread.
            if filed_by != "PERSON":
                cursor.execute(
                    "UPDATE evidence_matches SET filed_by = 'PERSON', decided_by = %s, "
                    "version = version + 1 WHERE id = %s",
                    (principal.id, match_id),
                )
                _audit(
                    cursor,
                    organization_id,
                    project_id,
                    principal.id,
                    file_id,
                    control[1],
                    "confirmed",
                )
        else:
            undo_receipt(cursor, organization_id, project_id, match_id, principal.id)
            if control is None:
                cursor.execute(
                    """
                    UPDATE evidence_matches
                    SET status = 'NEEDS_MATCH', engagement_control_id = NULL,
                        pbc_request_id = NULL, filed_by = NULL, decided_by = NULL,
                        reason = 'Taken off its control by a person.', version = version + 1
                    WHERE id = %s
                    """,
                    (match_id,),
                )
                _audit(cursor, organization_id, project_id, principal.id, file_id, None, "unfiled")
            else:
                named = cursor.execute(
                    "SELECT file_name FROM evidence_files WHERE id = %s", (file_id,)
                ).fetchone()
                name = "" if named is None else str(named[0])
                kind = "workbook" if name.lower().endswith((".xlsx", ".xlsm", ".csv")) else ""
                # The phase request whose planned evidence the file most likely answers.
                request = control_request(
                    connection, project_id, control[0], evidence_hint(name, kind, "")
                )
                cursor.execute(
                    """
                    UPDATE evidence_matches
                    SET status = 'FILED', engagement_control_id = %s, pbc_request_id = %s,
                        filed_by = 'PERSON', decided_by = %s, reason = '',
                        version = version + 1
                    WHERE id = %s
                    """,
                    (control[0], None if request is None else request[0], principal.id, match_id),
                )
                _audit(
                    cursor, organization_id, project_id, principal.id, file_id, control[1], "filed"
                )
                if confirmed is not None or analysis_id is None:
                    # A person confirmed what the file is, so it is not read again.
                    if request is not None:
                        apply_receipt(
                            cursor,
                            organization_id,
                            project_id,
                            match_id,
                            request[0],
                            principal.id,
                            "PERSON",
                        )
                else:
                    # Read it again against its control: coverage, review, and sampling.
                    restart_analysis(cursor, analysis_id, principal.id)
                    queued = analysis_id
    return _register(connection, principal, organization_id, project_id, file_id), queued


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    file_id: UUID,
    control_ref: str | None,
    change: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'evidence.filed', 'evidence_file', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor_id,
            file_id,
            Json({"change": change, "control_ref": control_ref, "by": "PERSON"}),
        ),
    )


# The application a file shows, set by a person


def _set_application(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    body: ApplicationBody,
) -> tuple[RegisterBody, list[UUID]]:
    """Set which application a file shows, and have the tester place it again."""
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _require_active(connection, organization_id, project_id)
    if (body.scope == "ONE") != (body.application_id is not None):
        raise IntakeState("choose one application, or all of them")
    queued: list[UUID] = []
    with transaction(connection) as cursor:
        link = cursor.execute(
            "SELECT engagement_control_id FROM evidence_file_links "
            "WHERE evidence_file_id = %s AND project_id = %s",
            (file_id, project_id),
        ).fetchone()
        if link is None or link[0] is None:
            raise IntakeState("file the evidence to a control first")
        if body.application_id is not None:
            # Any application of the control's family: the file becomes the evidence of
            # the instance that covers it.
            allowed = cursor.execute(
                "SELECT 1 FROM engagement_controls c "
                "JOIN engagement_controls me ON me.id = %s AND me.project_id = c.project_id "
                "WHERE c.project_id = %s AND c.control_ref = me.control_ref "
                "AND c.engagement_application_id = %s",
                (link[0], project_id, body.application_id),
            ).fetchone()
            if allowed is None:
                raise IntakeState("the control does not cover that application")
        cursor.execute(
            """
            INSERT INTO evidence_file_applications (
                evidence_file_id, organization_id, project_id, scope,
                engagement_application_id, tagged_by, decided_by, reason
            )
            VALUES (%s, %s, %s, %s, %s, 'PERSON', %s, 'Set by a person.')
            ON CONFLICT (evidence_file_id) DO UPDATE
            SET scope = EXCLUDED.scope,
                engagement_application_id = EXCLUDED.engagement_application_id,
                tagged_by = 'PERSON', decided_by = EXCLUDED.decided_by,
                reason = EXCLUDED.reason, version = evidence_file_applications.version + 1
            """,
            (file_id, organization_id, project_id, body.scope, body.application_id,
             principal.id),
        )  # fmt: skip
        for sheet in cursor.execute(
            "SELECT id, status FROM test_sheets WHERE project_id = %s "
            "AND engagement_control_id = ANY(%s) AND status = 'OPEN' "
            "ORDER BY created_at FOR UPDATE",
            (project_id, family_ids(cursor, project_id, UUID(str(link[0])))),
        ).fetchall():
            # Off the items it was on, and placed again on its next run.
            for (item_id,) in cursor.execute(
                "DELETE FROM test_item_files t USING test_items i "
                "WHERE i.id = t.test_item_id AND i.test_sheet_id = %s "
                "AND t.evidence_file_id = %s RETURNING t.test_item_id",
                (sheet[0], file_id),
            ).fetchall():
                cursor.execute(
                    "UPDATE test_items SET needs_test = true, version = version + 1 WHERE id = %s",
                    (item_id,),
                )
            cursor.execute(
                "DELETE FROM test_sheet_files WHERE test_sheet_id = %s AND evidence_file_id = %s",
                (sheet[0], file_id),
            )
            again = request_run(cursor, UUID(str(sheet[0])))
            queued += [] if again is None else [again]
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'evidence.application_set', 'evidence_file', %s, %s)
            """,
            (
                organization_id,
                project_id,
                principal.id,
                file_id,
                Json({"scope": body.scope, "application_id": str(body.application_id or "")}),
            ),
        )
    return _register(connection, principal, organization_id, project_id, file_id), queued
