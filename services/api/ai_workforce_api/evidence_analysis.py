"""Reading and classifying stored evidence: the background job and its API.

When a person stores an attachment, the evidence coordinator reads it in the
background: the file's text (by OCR for screenshots and scanned pages), what kind of
evidence it is, and how it covers each item its request asked for. A person confirms
the kind. Nothing here changes a request: a person still marks it received.

The custody record is never changed. The bytes are read through the custody check, and
the job stops if the stored object no longer matches its hash.
"""

import logging
from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Literal, Protocol, runtime_checkable
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.control_tests import approved, control_for_population, propose
from ai_workforce_api.db import connect, independent_steps, transaction
from ai_workforce_api.evidence_classify import (
    CLASSIFY_SCHEMA,
    SYSTEM_PROMPT,
    Classification,
    ClassifyContext,
    EvidenceKind,
    RequestedItem,
    check_classification,
    prompt_for,
    rules_classify,
)
from ai_workforce_api.evidence_extraction import (
    Extraction,
    Table,
    extract,
    read_table,
    with_ocr,
    without_ocr,
)
from ai_workforce_api.evidence_ocr import (
    Engine,
    OcrFactory,
    OcrFailed,
    OcrUnavailable,
    engines_for,
    local_ocr_available,
    model_jpeg,
)
from ai_workforce_api.evidence_review import (
    Review,
    ReviewContext,
    is_screenshot,
    review_decided,
    run_review,
    save_review,
    unable_review,
)
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.model_providers import CLAUDE_CONFIG, call_note, live_model, provider_for
from ai_workforce_api.models import ModelProvider, ModelRaw, ModelRequest, complete, record_call
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import ObjectStore, StoreError, digest_of, open_store

logger = logging.getLogger(__name__)

LEASE_MINUTES = 10
MAX_ATTEMPTS = 3
EXCERPT_CHARS = 3_000
StoreFactory = Callable[[Settings, psycopg.Connection[Any]], ObjectStore]
AnalysisRunner = Callable[[UUID], str]


@runtime_checkable
class EvidenceAnalysisScheduler(Protocol):
    def schedule_evidence_analyses(self, analysis_ids: list[UUID]) -> None: ...


def analysis_runner(
    settings: Settings,
    provider: ModelProvider | None = None,
    ocr: OcrFactory | None = None,
    store: StoreFactory = open_store,
) -> AnalysisRunner:
    """One analysis, with its own connection. Safe to run twice: a finished one is skipped."""
    model = provider if provider is not None else provider_for(settings)
    use_model = provider is not None or live_model(settings)
    engines = ocr if ocr is not None else engines_for(settings)

    def run(analysis_id: UUID) -> str:
        with connect(settings.database_url) as connection:
            return run_analysis(
                connection, settings, model if use_model else None, analysis_id, engines, store
            )

    return run


def queue_analysis(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    requester_id: UUID,
) -> UUID | None:
    """Queue the analysis of a newly stored file, in the transaction that stores it."""
    row = cursor.execute(
        """
        INSERT INTO evidence_analyses (
            organization_id, project_id, evidence_file_id, requested_by_user_id
        )
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (evidence_file_id) DO NOTHING
        RETURNING id
        """,
        (organization_id, project_id, file_id, requester_id),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


def schedule_analyses(
    scheduler: EvidenceAnalysisScheduler | None, analysis_ids: list[UUID]
) -> None:
    """Hand analyses to the background. If that fails, they stay pending and resume later."""
    if scheduler is None or not analysis_ids:
        return
    try:
        scheduler.schedule_evidence_analyses(analysis_ids)
    except Exception:
        logger.warning("evidence analyses could not be scheduled; they will resume on restart")


# The job


def run_analysis(
    connection: psycopg.Connection[Any],
    settings: Settings,
    provider: ModelProvider | None,
    analysis_id: UUID,
    ocr: OcrFactory,
    store: StoreFactory = open_store,
) -> str:
    independent_steps(connection)
    with transaction(connection) as cursor:
        claimed = cursor.execute(
            """
            UPDATE evidence_analyses a
            SET status = 'WORKING', attempts = attempts + 1,
                lease_until = clock_timestamp() + make_interval(mins => %s),
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND attempts < %s
              AND (status = 'PENDING'
                   OR (status = 'WORKING' AND lease_until < clock_timestamp()))
            RETURNING organization_id, project_id, evidence_file_id, requested_by_user_id
            """,
            (LEASE_MINUTES, analysis_id, MAX_ATTEMPTS),
        ).fetchone()
    if claimed is None:
        return "SKIPPED"
    organization_id, project_id, file_id, requester = claimed
    stored = connection.execute(
        """
        SELECT object_key, content_sha256, size_bytes, content_type, file_name,
               mailbox_attachment_id
        FROM evidence_files WHERE id = %s AND project_id = %s
        """,
        (file_id, project_id),
    ).fetchone()
    if stored is None:
        raise NotVisible()
    key, digest, size, content_type, file_name, attachment_id = stored
    # A storage outage raises, so the attempt is retried.
    content = store(settings, connection).get(str(key))
    if digest_of(content) != digest or len(content) != int(size):
        _fail(connection, analysis_id, "The stored file no longer matches its custody record.")
        _audit(
            connection,
            organization_id,
            project_id,
            requester,
            "evidence.custody_check_failed",
            file_id,
            {"content_sha256": str(digest)},
        )
        return "FAILED"

    def record(status: str, raw: ModelRaw) -> UUID:
        return record_call(
            connection,
            requester,
            organization_id,
            project_id,
            "claude",
            status,
            raw,
            CLAUDE_CONFIG,
        )

    request = _request_for(connection, project_id, attachment_id)
    extraction = extract(content, str(file_name), str(content_type))
    ocr_engine: Engine | None = None
    ocr_call_id: UUID | None = None
    # Kept for the visual review after OCR has read them.
    images = extraction.images
    file_kind = extraction.file_kind
    if extraction.images:
        extraction, ocr_engine, ocr_call_id = _read_images(
            connection, organization_id, provider, ocr, record, extraction
        )
    context = _context(connection, project_id, str(file_name), extraction, request)
    classification: Classification | None = None
    source = "RULES"
    note = "No model is configured." if provider is None else ""
    call_id: UUID | None = None
    if provider is not None and extraction.text.strip():
        model_request = ModelRequest(
            operation="generate",
            prompt=prompt_for(context),
            output_schema=CLASSIFY_SCHEMA,
            allowed_tool_ids=(),
            timeout_seconds=90,
            cancelled=False,
            system=SYSTEM_PROMPT,
        )
        status, raw = complete(provider, model_request, CLAUDE_CONFIG)
        call_id = record(status, raw)
        # A MALFORMED answer is still read by the stricter evidence check, which cuts
        # over-long text and lists. The call stays recorded as malformed.
        if status in ("SUCCEEDED", "MALFORMED") and raw.output is not None:
            try:
                classification = check_classification(raw.output, context)
                source = "MODEL"
            except ValueError as error:
                note = f"Model answer rejected: {error}."
        else:
            note = call_note(status)
    elif provider is not None:
        note = "Nothing could be read from the file, so the rules were used."
    if classification is None:
        classification = rules_classify(context)
    review: tuple[Review, str, ReviewContext, UUID | None, str, str] | None = None
    if is_screenshot(file_kind, bool(images)):
        review = _review(
            connection,
            organization_id,
            project_id,
            provider,
            record,
            request,
            context,
            images,
            extraction,
        )
    # A population for a sampled control: the tester proposes a test plan.
    sampling = _sampling(
        connection, project_id, request, classification.kind, content, file_name, content_type
    )
    with transaction(connection) as cursor:
        saved = cursor.execute(
            """
            UPDATE evidence_analyses
            SET status = 'READY', lease_until = NULL, pbc_request_id = %s,
                extraction = %s, extraction_status = %s, ocr_engine = %s,
                extracted_text = %s, text_truncated = %s, content_redacted = %s,
                page_count = %s, row_count = %s, columns = %s, classification = %s,
                source = %s, model_call_id = %s, ocr_model_call_id = %s, note = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND status = 'WORKING'
            RETURNING id
            """,
            (
                None if request is None else request[0],
                extraction.method,
                extraction.status,
                ocr_engine,
                extraction.text,
                extraction.truncated,
                extraction.redacted,
                extraction.pages,
                extraction.rows,
                Json(list(extraction.columns)),
                Json(classification.model_dump()),
                source,
                call_id,
                ocr_call_id,
                _note(note, extraction.note),
                analysis_id,
            ),
        ).fetchone()
        if saved is None:
            return "SKIPPED"
        if review is not None:
            result, status_text, review_context, review_call, review_note, tester = review
            save_review(
                cursor,
                organization_id=organization_id,
                project_id=project_id,
                analysis_id=analysis_id,
                file_id=file_id,
                request=request,
                requester=requester,
                review=result,
                status="READY" if status_text == "READY" else "NEEDS_PERSON",
                context=review_context,
                model_call_id=review_call,
                note=review_note,
                tester=tester,
            )
        if sampling is not None and request is not None and request[3] is not None:
            (period_end, frequency, nature, size, tester), table = sampling
            propose(
                cursor,
                organization_id=organization_id,
                project_id=project_id,
                control_id=request[3],
                file_id=file_id,
                file_name=str(file_name),
                sha256=str(digest),
                table=table,
                period_end=period_end,
                frequency=frequency,
                nature=nature,
                size=size,
                proposer=requester,
                tester=tester,
            )
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'evidence.analyzed', 'evidence_file', %s, %s)
            """,
            (
                organization_id,
                project_id,
                requester,
                file_id,
                Json(
                    {
                        "agent": "evidence-coordinator",
                        "source": source,
                        "kind": classification.kind,
                        "confidence": classification.confidence,
                        "extraction_status": extraction.status,
                        "ocr_engine": ocr_engine,
                    }
                ),
            ),
        )
    return "READY"


def _sampling(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    request: tuple[UUID, str, str, UUID | None] | None,
    kind: str,
    content: bytes,
    file_name: Any,
    content_type: Any,
) -> tuple[tuple[date | None, str, str, int, str], Table] | None:
    """The control and table to sample, when this file is its population."""
    if kind != "population" or request is None or request[3] is None:
        return None
    plan = control_for_population(connection, project_id, request[3])
    if plan is None or approved(connection, project_id, request[3]):
        return None
    table = read_table(content, str(file_name), str(content_type))
    if table is None or not table.rows:
        return None
    return plan, table


def _review(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    provider: ModelProvider | None,
    record: Callable[[str, ModelRaw], UUID],
    request: tuple[UUID, str, str, UUID | None] | None,
    context: ClassifyContext,
    images: tuple[bytes, ...],
    extraction: Extraction,
) -> tuple[Review, str, ReviewContext, UUID | None, str, str]:
    """The control's tester reviews the screenshot. Returns the review and how it went."""
    from ai_workforce_api.controls import BUSINESS_TESTER, DOMAIN_AGENTS
    from ai_workforce_api.pbc_drafting import load_context

    loaded = None
    if request is not None and request[3] is not None:
        try:
            loaded = load_context(connection, project_id, request[3])
        except NotVisible:
            loaded = None
    review_context = ReviewContext(
        file_name=context.file_name,
        control_ref=context.control_ref or "(not linked to a control)",
        control_title=context.control_title,
        control_activity=context.control_activity,
        systems=context.systems,
        period=context.period,
        attributes=() if loaded is None else loaded.test_attributes,
        requested=tuple(item.title for item in context.items),
        ocr_text=extraction.text,
    )
    tester = (
        "evidence-coordinator"
        if loaded is None
        else DOMAIN_AGENTS.get(loaded.domain, BUSINESS_TESTER)
    )
    if not images:
        reason = extraction.note or "The image could not be read."
        return (
            unable_review(review_context, reason, unreadable=True),
            "NEEDS_PERSON",
            (review_context),
            None,
            reason,
            tester,
        )
    if provider is None:
        reason = "No model is configured, so screenshots are not reviewed by the agent."
    elif ocr_choice(connection, organization_id) != "MODEL":
        reason = (
            "The firm reads images locally, so screenshots are not sent to the model for a "
            "visual review. An owner or admin can turn on model OCR under AI workforce."
        )
    else:
        result, call_id, failed = run_review(provider, images, review_context, record, model_jpeg)
        if result is not None:
            return result, "READY", review_context, call_id, "", tester
        return (
            unable_review(review_context, failed, unreadable=False),
            "NEEDS_PERSON",
            review_context,
            call_id,
            failed,
            tester,
        )
    return (
        unable_review(review_context, reason, unreadable=False),
        "NEEDS_PERSON",
        review_context,
        None,
        reason,
        tester,
    )


def _read_images(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    provider: ModelProvider | None,
    ocr: OcrFactory,
    record: Callable[[str, ModelRaw], UUID],
    extraction: Extraction,
) -> tuple[Extraction, Engine | None, UUID | None]:
    """Try the firm's engines in order. Local OCR never sends an image out."""
    choice = ocr_choice(connection, organization_id)
    notes: list[str] = []
    if choice == "MODEL" and provider is None:
        notes.append("The firm chose model OCR, but no model is configured.")
    engines = ocr(choice, provider, record)
    for engine in engines:
        try:
            result = engine.read(extraction.images)
        except (OcrUnavailable, OcrFailed) as error:
            notes.append(error.note)
            continue
        notes.append(result.note)
        read = with_ocr(extraction, list(result.texts), _note(*notes))
        return read, result.engine, result.model_call_id
    if not engines:
        notes.append("No OCR engine is installed, so a person reads the images.")
    return without_ocr(extraction, _note(*notes)), None, None


def ocr_choice(connection: psycopg.Connection[Any], organization_id: UUID) -> Engine:
    row = connection.execute(
        "SELECT ocr_engine FROM organization_evidence_settings WHERE organization_id = %s",
        (organization_id,),
    ).fetchone()
    return "MODEL" if row is not None and row[0] == "MODEL" else "LOCAL"


def _request_for(
    connection: psycopg.Connection[Any], project_id: UUID, attachment_id: UUID
) -> tuple[UUID, str, str, UUID | None] | None:
    """The request the attachment's reply is matched or assigned to, if any."""
    row = connection.execute(
        """
        SELECT r.id, r.control_ref, r.evidence_description, r.engagement_control_id
        FROM mailbox_attachments ma
        JOIN inbound_messages i
          ON i.mailbox_message_id = ma.message_id AND i.project_id = ma.project_id
        JOIN pbc_requests r ON r.id = i.pbc_request_id AND r.project_id = i.project_id
        WHERE ma.id = %s AND ma.project_id = %s AND i.match_status IN ('MATCHED', 'ASSIGNED')
        ORDER BY i.created_at DESC
        LIMIT 1
        """,
        (attachment_id, project_id),
    ).fetchone()
    if row is None:
        return None
    return UUID(str(row[0])), str(row[1]), str(row[2]), row[3]


def _context(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    file_name: str,
    extraction: Extraction,
    request: tuple[UUID, str, str, UUID | None] | None,
) -> ClassifyContext:
    items: tuple[RequestedItem, ...] = ()
    control: dict[str, Any] = {}
    period = "the audit period"
    if request is not None:
        draft = connection.execute(
            "SELECT content FROM pbc_drafts WHERE pbc_request_id = %s AND status = 'DRAFTED'",
            (request[0],),
        ).fetchone()
        if draft is not None and isinstance(draft[0], dict):
            items = tuple(
                RequestedItem(
                    kind=str(item.get("kind", "other")),
                    title=clean_line(str(item.get("title", "")), 160),
                    fields=tuple(clean_line(str(f), 80) for f in item.get("fields", [])[:15]),
                    period=clean_line(str(item.get("period", "")), 160),
                )
                for item in draft[0].get("items", [])[:8]
                if isinstance(item, dict)
            )
        if request[3] is not None:
            from ai_workforce_api.pbc_drafting import load_context

            try:
                loaded = load_context(connection, project_id, request[3])
            except NotVisible:
                loaded = None
            if loaded is not None:
                control = {
                    "ref": loaded.control_ref,
                    "title": loaded.title,
                    "activity": loaded.activity,
                    "area": loaded.domain_label,
                    "frequency": loaded.frequency_label or loaded.frequency,
                    "systems": loaded.applications,
                }
                period = loaded.period
    return ClassifyContext(
        file_name=clean_line(file_name, 200),
        file_kind=extraction.file_kind,
        read_as=extraction.method,
        read_status=extraction.status,
        read_note=extraction.note,
        text=extraction.text,
        columns=extraction.columns,
        rows=extraction.rows,
        pages=extraction.pages,
        request_title="" if request is None else f"Evidence request for {request[1]}",
        request_description="" if request is None else request[2],
        items=items,
        control_ref=str(control.get("ref", "" if request is None else request[1])),
        control_title=str(control.get("title", "")),
        control_activity=str(control.get("activity", "")),
        area=str(control.get("area", "")),
        frequency=str(control.get("frequency", "")),
        systems=tuple(control.get("systems", ())),
        period=period,
    )


def fail_analysis(connection: psycopg.Connection[Any], analysis_id: UUID) -> None:
    """After the last retry, an analysis is failed so a person can run it again."""
    _fail(connection, analysis_id, "Reading the file did not finish.")


def _fail(connection: psycopg.Connection[Any], analysis_id: UUID, note: str) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE evidence_analyses
            SET status = 'FAILED', lease_until = NULL, note = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND status IN ('PENDING', 'WORKING')
            """,
            (note[:300], analysis_id),
        )


def reset_analysis(connection: psycopg.Connection[Any], analysis_id: UUID) -> None:
    """Put a failed attempt back in the queue for the next retry."""
    connection.execute(
        "UPDATE evidence_analyses SET status = 'PENDING', lease_until = NULL "
        "WHERE id = %s AND status = 'WORKING'",
        (analysis_id,),
    )


def open_analyses(connection: psycopg.Connection[Any]) -> list[UUID]:
    """Analyses to resume after a restart: never started, or abandoned mid-read."""
    rows = connection.execute(
        """
        SELECT id FROM evidence_analyses
        WHERE attempts < %s
          AND (status = 'PENDING' OR (status = 'WORKING' AND lease_until < clock_timestamp()))
        ORDER BY created_at
        LIMIT 500
        """,
        (MAX_ATTEMPTS,),
    ).fetchall()
    return [UUID(str(row[0])) for row in rows]


def _note(*parts: str) -> str:
    return " ".join(part.strip() for part in parts if part.strip())[:300]


def _audit(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID | None,
    actor_id: UUID,
    action: str,
    target_id: UUID,
    payload: dict[str, Any],
    target_type: str = "evidence_file",
) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (organization_id, project_id, actor_id, action, target_type, target_id, Json(payload)),
        )


# API


class AnalysisBody(BaseModel):
    id: UUID
    evidence_file_id: UUID
    pbc_request_id: UUID | None
    status: str
    attempts: int
    extraction: str | None
    extraction_status: str | None
    ocr_engine: str | None
    text_excerpt: str
    text_length: int
    text_truncated: bool
    content_redacted: bool
    page_count: int | None
    row_count: int | None
    columns: list[str]
    classification: Classification | None
    source: str | None
    note: str
    confirmed_kind: str | None
    confirmed_note: str
    confirmed_at: datetime | None
    confirmed_by_name: str | None
    updated_at: datetime
    version: int


class VersionBody(BaseModel):
    version: int = Field(ge=1)


class ConfirmBody(BaseModel):
    version: int = Field(ge=1)
    kind: EvidenceKind
    note: str = Field(default="", max_length=500)

    @field_validator("note")
    @classmethod
    def plain_note(cls, value: str) -> str:
        return clean_line(value, 500)


class EvidenceSettingsBody(BaseModel):
    ocr_engine: Engine
    version: int
    model_configured: bool
    local_ocr_available: bool


class EvidenceSettingsUpdate(BaseModel):
    ocr_engine: Literal["LOCAL", "MODEL"]
    # 0 when the firm has never changed the setting.
    version: int = Field(ge=0)


class AnalysisState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


def register_evidence_analysis(
    app: FastAPI, settings: Settings, scheduler: EvidenceAnalysisScheduler | None
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except AnalysisState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None

    @app.get(f"{base}/evidence-analyses")
    def list_analyses(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[AnalysisBody]:
        return run(request, lambda c, p: _list(c, p, organization_id, project_id))

    @app.post(f"{base}/evidence-analyses/{{analysis_id}}/reanalyze")
    def reanalyze(
        organization_id: UUID,
        project_id: UUID,
        analysis_id: UUID,
        body: VersionBody,
        request: Request,
    ) -> AnalysisBody:
        result = run(
            request,
            lambda c, p: _reanalyze(c, p, organization_id, project_id, analysis_id, body),
        )
        schedule_analyses(scheduler, [result.id])
        return result

    @app.post(f"{base}/evidence-analyses/{{analysis_id}}/confirm")
    def confirm(
        organization_id: UUID,
        project_id: UUID,
        analysis_id: UUID,
        body: ConfirmBody,
        request: Request,
    ) -> AnalysisBody:
        return run(
            request,
            lambda c, p: _confirm(c, p, organization_id, project_id, analysis_id, body),
        )

    @app.get("/organizations/{organization_id}/evidence-settings")
    def read_settings(organization_id: UUID, request: Request) -> EvidenceSettingsBody:
        return run(request, lambda c, p: _settings(c, p, settings, organization_id))

    @app.put("/organizations/{organization_id}/evidence-settings")
    def update_settings(
        organization_id: UUID, body: EvidenceSettingsUpdate, request: Request
    ) -> EvidenceSettingsBody:
        return run(request, lambda c, p: _update_settings(c, p, settings, organization_id, body))


_COLUMNS = """
    a.id, a.evidence_file_id, a.pbc_request_id, a.status, a.attempts, a.extraction,
    a.extraction_status, a.ocr_engine, left(a.extracted_text, %s),
    char_length(a.extracted_text), a.text_truncated, a.content_redacted, a.page_count,
    a.row_count, a.columns, a.classification, a.source, a.note, a.confirmed_kind,
    a.confirmed_note, a.confirmed_at, u.display_name, a.updated_at, a.version
"""


def _body(row: tuple[Any, ...]) -> AnalysisBody:
    return AnalysisBody(
        id=row[0],
        evidence_file_id=row[1],
        pbc_request_id=row[2],
        status=str(row[3]),
        attempts=int(row[4]),
        extraction=row[5],
        extraction_status=row[6],
        ocr_engine=row[7],
        text_excerpt=str(row[8]),
        text_length=int(row[9]),
        text_truncated=bool(row[10]),
        content_redacted=bool(row[11]),
        page_count=row[12],
        row_count=row[13],
        columns=[str(item) for item in row[14]],
        classification=None if row[15] is None else Classification.model_validate(row[15]),
        source=row[16],
        note=str(row[17]),
        confirmed_kind=row[18],
        confirmed_note=str(row[19]),
        confirmed_at=row[20],
        confirmed_by_name=None if row[21] is None else str(row[21]),
        updated_at=row[22],
        version=int(row[23]),
    )


def _select(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, analysis_id: UUID
) -> AnalysisBody:
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM evidence_analyses a LEFT JOIN users u ON u.id = a.confirmed_by
        WHERE a.id = %s AND a.organization_id = %s AND a.project_id = %s
        """,
        (EXCERPT_CHARS, analysis_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _body(row)


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[AnalysisBody]:
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
        FROM evidence_analyses a LEFT JOIN users u ON u.id = a.confirmed_by
        WHERE a.organization_id = %s AND a.project_id = %s
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 500
        """,
        (EXCERPT_CHARS, organization_id, project_id),
    ).fetchall()
    return [_body(row) for row in rows]


def _person(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()


def _reanalyze(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    analysis_id: UUID,
    body: VersionBody,
) -> AnalysisBody:
    _person(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        current = cursor.execute(
            """
            SELECT status, version, confirmed_kind, evidence_file_id FROM evidence_analyses
            WHERE id = %s AND organization_id = %s AND project_id = %s FOR UPDATE
            """,
            (analysis_id, organization_id, project_id),
        ).fetchone()
        if current is None:
            raise NotVisible()
        if int(current[1]) != body.version:
            raise AnalysisState("analysis changed")
        if current[0] in ("PENDING", "WORKING"):
            raise AnalysisState("analysis is in progress")
        if current[2] is not None:
            raise AnalysisState("analysis is confirmed")
        if review_decided(connection, analysis_id):
            raise AnalysisState("review is signed off")
        # An unsigned review is derived data and is redone with the reading.
        cursor.execute(
            "DELETE FROM evidence_reviews WHERE evidence_analysis_id = %s AND decision IS NULL",
            (analysis_id,),
        )
        cursor.execute(
            """
            UPDATE evidence_analyses
            SET status = 'PENDING', attempts = 0, lease_until = NULL, requested_by_user_id = %s,
                extraction = NULL, extraction_status = NULL, ocr_engine = NULL,
                extracted_text = '', text_truncated = false, content_redacted = false,
                page_count = NULL, row_count = NULL, columns = '[]'::jsonb,
                classification = NULL, source = NULL, model_call_id = NULL,
                ocr_model_call_id = NULL, note = '',
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s
            """,
            (principal.id, analysis_id),
        )
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'evidence.reanalysis_requested', 'evidence_file', %s, %s)
            """,
            (organization_id, project_id, principal.id, current[3], Json({})),
        )
    return _select(connection, organization_id, project_id, analysis_id)


def _confirm(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    analysis_id: UUID,
    body: ConfirmBody,
) -> AnalysisBody:
    _person(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        current = cursor.execute(
            """
            SELECT status, version, classification, evidence_file_id FROM evidence_analyses
            WHERE id = %s AND organization_id = %s AND project_id = %s FOR UPDATE
            """,
            (analysis_id, organization_id, project_id),
        ).fetchone()
        if current is None:
            raise NotVisible()
        if int(current[1]) != body.version:
            raise AnalysisState("analysis changed")
        if current[0] != "READY":
            raise AnalysisState("analysis is not ready")
        suggested = str(current[2].get("kind", "")) if isinstance(current[2], dict) else ""
        cursor.execute(
            """
            UPDATE evidence_analyses
            SET confirmed_kind = %s, confirmed_note = %s, confirmed_by = %s,
                confirmed_at = clock_timestamp(), version = version + 1,
                updated_at = clock_timestamp()
            WHERE id = %s
            """,
            (body.kind, body.note, principal.id, analysis_id),
        )
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'evidence.classification_confirmed', 'evidence_file', %s, %s)
            """,
            (
                organization_id,
                project_id,
                principal.id,
                current[3],
                Json({"kind": body.kind, "suggested": suggested, "agreed": body.kind == suggested}),
            ),
        )
    return _select(connection, organization_id, project_id, analysis_id)


def _settings(
    connection: psycopg.Connection[Any],
    principal: Principal,
    settings: Settings,
    organization_id: UUID,
) -> EvidenceSettingsBody:
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_READ,
        organization_id=organization_id,
    )
    return _settings_body(connection, settings, organization_id)


def _settings_body(
    connection: psycopg.Connection[Any], settings: Settings, organization_id: UUID
) -> EvidenceSettingsBody:
    row = connection.execute(
        "SELECT ocr_engine, version FROM organization_evidence_settings WHERE organization_id = %s",
        (organization_id,),
    ).fetchone()
    return EvidenceSettingsBody(
        ocr_engine="MODEL" if row is not None and row[0] == "MODEL" else "LOCAL",
        version=0 if row is None else int(row[1]),
        model_configured=live_model(settings),
        local_ocr_available=local_ocr_available(settings),
    )


def _update_settings(
    connection: psycopg.Connection[Any],
    principal: Principal,
    settings: Settings,
    organization_id: UUID,
    body: EvidenceSettingsUpdate,
) -> EvidenceSettingsBody:
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_UPDATE,
        organization_id=organization_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    with transaction(connection) as cursor:
        current = cursor.execute(
            "SELECT ocr_engine, version FROM organization_evidence_settings "
            "WHERE organization_id = %s FOR UPDATE",
            (organization_id,),
        ).fetchone()
        version = 0 if current is None else int(current[1])
        if version != body.version:
            raise AnalysisState("settings changed")
        before = "LOCAL" if current is None else str(current[0])
        if before == body.ocr_engine:
            return _settings_body(connection, settings, organization_id)
        cursor.execute(
            """
            INSERT INTO organization_evidence_settings (organization_id, ocr_engine, updated_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (organization_id) DO UPDATE
            SET ocr_engine = EXCLUDED.ocr_engine, updated_by = EXCLUDED.updated_by,
                updated_at = clock_timestamp(),
                version = organization_evidence_settings.version + 1
            """,
            (organization_id, body.ocr_engine, principal.id),
        )
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, NULL, %s, 'evidence.ocr_engine_changed', 'organization', %s, %s)
            """,
            (
                organization_id,
                principal.id,
                organization_id,
                Json({"from": before, "to": body.ocr_engine}),
            ),
        )
    return _settings_body(connection, settings, organization_id)
