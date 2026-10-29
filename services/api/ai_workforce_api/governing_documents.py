"""Policies and procedures on the Systems & Processes page (decided by the product owner on
25 October 2026).

A policy or procedure is uploaded once for the engagement and governs any number of its
systems and processes; it must govern at least one. Every control under them can cite it
as a source, and the agents read it when they review the control, as if it were linked to
the control (control_context.applies_to). A person can take it off one control from that
control's documents, and link it back.

A person removes a document, or replaces it with a newer file (decided by the product
owner, migration 0113). A removed one stops applying to every control and leaves the
list, but stays on record with who removed it and when, so what the agents quoted from it
stays traceable. A replacement governs what the old version governed, with the same
controls taken off; the old version is removed and names the new one.

The document's text is kept; the file itself is not. A document is untrusted data: what it
says is read and quoted, never followed.
"""

from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request, Response
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import Action, NotVisible, Principal, _call, _session_principal
from ai_workforce_api.context_routes import _project
from ai_workforce_api.control_context import (
    MAX_DOCUMENT,
    MAX_UPLOAD,
    ContextState,
    ReadDocument,
    applies_to,
    clean,
    line,
    read_document,
    store_document,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_extraction import extract
from ai_workforce_api.evidence_ocr import OcrFailed, OcrUnavailable, engines_for
from ai_workforce_api.model_providers import live_model, provider_for
from ai_workforce_api.models import ModelProvider, ModelRaw
from ai_workforce_api.provenance import AgentCaller, CallerProvider, Job, agent_actor
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import StoreError, open_store

# Policies and procedures govern; process narratives and flow diagrams describe (decided by
# the product owner on 26 October 2026, the References tab). Each is linked the same way.
GoverningKind = Literal["POLICY", "PROCEDURE", "NARRATIVE", "FLOWCHART"]
GOVERNING_KINDS: tuple[GoverningKind, ...] = ("POLICY", "PROCEDURE", "NARRATIVE", "FLOWCHART")
# Those whose original file is kept, to be proposed and filed as evidence (0125).
EVIDENCE_KINDS = ("POLICY", "PROCEDURE")


class ScopeBody(BaseModel):
    """What the document governs. At least one system or process."""

    system_ids: list[UUID] = Field(default_factory=list, max_length=200)
    process_ids: list[UUID] = Field(default_factory=list, max_length=200)


class PolicyBody(BaseModel):
    id: UUID
    kind: GoverningKind
    title: str
    file_name: str
    characters: int
    excerpt: str
    created_by: str | None
    created_at: datetime
    system_ids: list[UUID]
    process_ids: list[UUID]
    # The engagement's controls it applies to, and those a person took it off.
    controls: int
    excluded: int
    # Its original file is kept (0125): its size and type. One uploaded before is text only.
    file_kept: bool = False
    file_size: int | None = None
    file_type: str = ""


class PolicyResult(BaseModel):
    policy: PolicyBody | None
    readable: bool
    note: str


def policies(connection: psycopg.Connection[Any], project_id: UUID) -> list[PolicyBody]:
    rows = connection.execute(
        f"""
        SELECT d.id, d.kind, d.title, d.file_name, char_length(d.text), left(d.text, 400),
               u.display_name, d.created_at,
               ARRAY(SELECT s.engagement_application_id FROM source_document_systems s
                     WHERE s.document_id = d.id ORDER BY s.linked_at),
               ARRAY(SELECT s.process_id FROM source_document_processes s
                     WHERE s.document_id = d.id ORDER BY s.linked_at),
               (SELECT count(*) FROM engagement_controls c
                WHERE c.project_id = d.project_id AND c.included
                  AND {applies_to("c.id")}),
               (SELECT count(*) FROM source_document_exclusions x
                WHERE x.document_id = d.id),
               d.object_key IS NOT NULL, d.size_bytes, d.content_type
        FROM source_documents d
        LEFT JOIN users u ON u.id = d.created_by
        WHERE d.project_id = %s AND d.kind = ANY(%s) AND d.removed_at IS NULL
        ORDER BY d.created_at
        """,
        (project_id, list(GOVERNING_KINDS)),
    ).fetchall()
    return [
        PolicyBody(
            id=row[0],
            kind=row[1],
            title=str(row[2]),
            file_name=str(row[3]),
            characters=int(row[4]),
            excerpt=str(row[5]),
            created_by=None if row[6] is None else str(row[6]),
            created_at=row[7],
            system_ids=[UUID(str(item)) for item in row[8]],
            process_ids=[UUID(str(item)) for item in row[9]],
            controls=int(row[10]),
            excluded=int(row[11]),
            file_kept=bool(row[12]),
            file_size=None if row[13] is None else int(row[13]),
            file_type=str(row[14]),
        )
        for row in rows
    ]


def original_file(
    connection: psycopg.Connection[Any], store: Any, project_id: UUID, document_id: UUID
) -> tuple[str, str, bytes]:
    """A policy or procedure's original file, as uploaded: its name, type and bytes. One
    uploaded before its file was kept (0125) has none."""
    row = connection.execute(
        "SELECT file_name, title, content_type, object_key FROM source_documents "
        "WHERE id = %s AND project_id = %s AND kind = ANY(%s)",
        (document_id, project_id, list(GOVERNING_KINDS)),
    ).fetchone()
    if row is None or row[3] is None:
        raise NotVisible()
    return str(row[0]) or str(row[1]), str(row[2]), store.get(str(row[3]))


def set_scope(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    document_id: UUID,
    actor: UUID,
    scope: ScopeBody,
) -> None:
    """Replace what the document governs. Each system and process must be the engagement's
    own; controls a person took it off stay off."""
    systems = list(dict.fromkeys(scope.system_ids))
    processes = list(dict.fromkeys(scope.process_ids))
    if not systems and not processes:
        raise ContextState("a policy or procedure governs at least one system or process")
    found = cursor.execute(
        "SELECT count(*) FROM engagement_applications WHERE project_id = %s "
        "AND id = ANY(%s::uuid[])",
        (project_id, systems),
    ).fetchone()
    if found is None or int(found[0]) != len(systems):
        raise ValueError("system is not in this engagement")
    found = cursor.execute(
        "SELECT count(*) FROM engagement_processes WHERE project_id = %s AND id = ANY(%s::uuid[])",
        (project_id, processes),
    ).fetchone()
    if found is None or int(found[0]) != len(processes):
        raise ValueError("process is not in this engagement")
    cursor.execute(
        "DELETE FROM source_document_systems WHERE document_id = %s AND "
        "engagement_application_id <> ALL(%s::uuid[])",
        (document_id, systems),
    )
    cursor.execute(
        "DELETE FROM source_document_processes WHERE document_id = %s "
        "AND process_id <> ALL(%s::uuid[])",
        (document_id, processes),
    )
    for system_id in systems:
        cursor.execute(
            """
            INSERT INTO source_document_systems (
                document_id, project_id, engagement_application_id, linked_by
            )
            VALUES (%s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (document_id, project_id, system_id, actor),
        )
    for process_id in processes:
        cursor.execute(
            """
            INSERT INTO source_document_processes (document_id, project_id, process_id, linked_by)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (document_id, project_id, process_id, actor),
        )


def read_reference(
    connection: psycopg.Connection[Any],
    settings: Settings,
    provider: ModelProvider | None,
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    content: bytes,
    file_name: str,
    content_type: str,
) -> ReadDocument:
    """The text of a document, an image (a flow diagram) read by OCR: the firm's engines
    in order, as evidence is read (evidence_analysis.ocr_choice), so an image leaves the
    firm only when the firm chose model OCR. A model's reading is recorded as any call."""
    read = read_document(content, file_name, content_type)
    extraction = extract(content, line(file_name, 200) or "document", content_type)
    if read.readable or extraction.file_kind != "image":
        return read
    from ai_workforce_api.evidence_analysis import ocr_choice

    choice = ocr_choice(connection, organization_id)
    reader: CallerProvider | None = None
    if provider is not None and choice == "MODEL":
        reader = CallerProvider(
            AgentCaller(
                connection, provider,
                Job("evidence-reader", "source_document", project_id, organization_id,
                    project_id, actor,
                    agent_instance_id=agent_actor(connection, project_id,
                                                  "evidence-coordinator")),
                settings=settings,
            ),
            "reference-ocr/1",
            {"file": line(file_name, 200)},
        )  # fmt: skip

    def record(status: str, raw: ModelRaw) -> UUID:
        if reader is None:
            raise RuntimeError("a model call was recorded without a model")
        return reader.record(status, raw)

    for engine in engines_for(settings)(choice, reader, record):
        try:
            result = engine.read(extraction.images or (content,))
        except OcrUnavailable, OcrFailed:
            continue
        text = clean("\n\n".join(result.texts), MAX_DOCUMENT)
        if text:
            return ReadDocument(
                file_name=read.file_name, sha256=read.sha256, text=text, readable=True,
                note="The diagram was read by OCR; check its steps against the image.",
            )  # fmt: skip
    return ReadDocument(
        file_name=read.file_name, sha256=read.sha256, text="", readable=False,
        note="The image could not be read here. Upload the diagram as a PDF or a Word "
        "document with its steps as text.",
    )  # fmt: skip


def remove(cursor: psycopg.Cursor[Any], document_id: UUID, actor: UUID) -> None:
    """Take the document off everything it applies to; it stays on record."""
    row = cursor.execute(
        """
        UPDATE source_documents
        SET removed_at = clock_timestamp(), removed_by = %s, updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND removed_at IS NULL
        RETURNING id
        """,
        (actor, document_id),
    ).fetchone()
    if row is None:
        raise ContextState("the document was already removed")


def replace(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    document_id: UUID,
    actor: UUID,
    *,
    title: str,
    text: str,
    file_name: str,
    sha256: str,
) -> UUID:
    """A newer version in the old one's place: the same kind, what it governs, the controls
    linked to it or taken off it. The old version is removed and names the new one."""
    old = cursor.execute(
        "SELECT kind, title FROM source_documents WHERE id = %s AND removed_at IS NULL FOR UPDATE",
        (document_id,),
    ).fetchone()
    if old is None:
        raise ContextState("the document was already removed")
    new_id = store_document(
        cursor, organization_id, project_id, actor, kind=str(old[0]),
        title=line(title, 200) or str(old[1]), text=text, origin="UPLOAD",
        file_name=file_name, sha256=sha256,
    )  # fmt: skip
    # Fixed table and column names, never input.
    for table, column, by in (
        ("source_document_systems", "engagement_application_id", "linked_by"),
        ("source_document_processes", "process_id", "linked_by"),
        ("source_document_controls", "engagement_control_id", "linked_by"),
        ("source_document_exclusions", "engagement_control_id", "excluded_by"),
    ):
        cursor.execute(
            f"INSERT INTO {table} (document_id, {column}, project_id, {by}) "
            f"SELECT %s, {column}, project_id, %s FROM {table} WHERE document_id = %s",
            (new_id, actor, document_id),
        )
    remove(cursor, document_id, actor)
    cursor.execute(
        "UPDATE source_documents SET replaced_by = %s WHERE id = %s", (new_id, document_id)
    )
    return new_id


def _kind(cursor: psycopg.Cursor[Any], document_id: UUID) -> str:
    row = cursor.execute(
        "SELECT kind FROM source_documents WHERE id = %s", (document_id,)
    ).fetchone()
    return "" if row is None else str(row[0])


def _governing(connection: psycopg.Connection[Any], project_id: UUID, document_id: UUID) -> None:
    found = connection.execute(
        "SELECT 1 FROM source_documents WHERE id = %s AND project_id = %s AND kind = ANY(%s) "
        "AND removed_at IS NULL",
        (document_id, project_id, list(GOVERNING_KINDS)),
    ).fetchone()
    if found is None:
        raise NotVisible()


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    action: str,
    target: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'source_document', %s, %s)
        """,
        (organization_id, project_id, actor, action, target, Json(payload)),
    )


def keep_file(
    cursor: psycopg.Cursor[Any],
    store: Any,
    document_id: UUID,
    content: bytes,
    content_type: str,
) -> None:
    """Keep the original file of a policy or procedure, so it can be filed as evidence
    (migration 0125). The text read from it stays what the agents quote."""
    key = f"documents/{uuid4()}"
    store.put(key, content)
    cursor.execute(
        "UPDATE source_documents SET object_key = %s, content_type = %s, size_bytes = %s "
        "WHERE id = %s",
        (key, line(content_type, 100) or "application/octet-stream", len(content), document_id),
    )


def register_governing_documents(
    app: FastAPI,
    settings: Settings,
    provider: ModelProvider | None = None,
    scheduler: object | None = None,
    store: Callable[[Settings, psycopg.Connection[Any]], Any] = open_store,
) -> None:
    from ai_workforce_api.policy_evidence import request_run
    from ai_workforce_api.policy_evidence import schedule as schedule_policy_evidence

    base = "/organizations/{organization_id}/projects/{project_id}"

    def model() -> ModelProvider | None:
        if provider is not None:
            return provider
        return provider_for(settings) if live_model(settings) else None

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except ContextState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError:
            raise HTTPException(status_code=422, detail="policy is invalid") from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None

    def one(connection: psycopg.Connection[Any], project_id: UUID, document_id: UUID) -> PolicyBody:
        return next(item for item in policies(connection, project_id) if item.id == document_id)

    @app.get(f"{base}/policies")
    def list_policies(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[PolicyBody]:
        def work(c: psycopg.Connection[Any], p: Principal) -> list[PolicyBody]:
            _project(c, p, organization_id, project_id, Action.TASK_READ)
            return policies(c, project_id)

        return run(request, work)

    @app.post(f"{base}/policies/upload")
    async def upload_policy(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        kind: GoverningKind = "POLICY",
        title: str = "",
        file_name: str = "",
        system_id: list[UUID] = Query(default=[]),  # noqa: B008
        process_id: list[UUID] = Query(default=[]),  # noqa: B008
    ) -> PolicyResult:
        content = await request.body()
        if len(content) > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="file is larger than 5 MB")
        if not content:
            raise HTTPException(status_code=422, detail="file is empty")
        content_type = request.headers.get("content-type", "")
        scope = ScopeBody(system_ids=system_id, process_ids=process_id)

        def work(c: psycopg.Connection[Any], p: Principal) -> PolicyResult:
            _project(c, p, organization_id, project_id)
            read = read_reference(
                c, settings, model(), organization_id, project_id, p.id, content,
                file_name, content_type,
            )  # fmt: skip
            if not read.readable:
                return PolicyResult(policy=None, readable=False, note=read.note)
            with transaction(c) as cursor:
                document_id = store_document(
                    cursor, organization_id, project_id, p.id, kind=kind,
                    title=line(title, 200) or read.file_name, text=read.text, origin="UPLOAD",
                    file_name=read.file_name, sha256=read.sha256,
                )  # fmt: skip
                set_scope(cursor, project_id, document_id, p.id, scope)
                if kind in EVIDENCE_KINDS:
                    keep_file(cursor, store(settings, c), document_id, content, content_type)
                    queued.append(request_run(cursor, organization_id, project_id, p.id))
                _audit(cursor, organization_id, project_id, p.id, "document.uploaded",
                       document_id, {"kind": kind, "systems": len(scope.system_ids),
                                     "processes": len(scope.process_ids)})  # fmt: skip
            return PolicyResult(policy=one(c, project_id, document_id), readable=True,
                                note=read.note)  # fmt: skip

        queued: list[UUID] = []
        result = run(request, work)
        schedule_policy_evidence(scheduler, queued)
        return result

    @app.get(f"{base}/policies/{{document_id}}/file")
    def policy_file(
        organization_id: UUID, project_id: UUID, document_id: UUID, request: Request
    ) -> Response:
        """The original file: a PDF or image shown in the page, sandboxed; anything else,
        such as a Word document, downloaded."""
        from ai_workforce_api.evidence import _filename, preview_type

        def work(c: psycopg.Connection[Any], p: Principal) -> tuple[str, str, bytes]:
            _project(c, p, organization_id, project_id, Action.TASK_READ)
            return original_file(c, store(settings, c), project_id, document_id)

        name, content_type, content = run(request, work)
        shown = preview_type(content)
        headers = {
            "Content-Disposition": (
                f'{"inline" if shown else "attachment"}; filename="{_filename(name)}"'
            ),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        }
        if shown:
            # Shown, never run: no scripts, forms, or requests from the file.
            headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src data:"
        return Response(
            content=content,
            media_type=shown or content_type or "application/octet-stream",
            headers=headers,
        )

    @app.post(f"{base}/policies/{{document_id}}/remove")
    def remove_policy(
        organization_id: UUID, project_id: UUID, document_id: UUID, request: Request
    ) -> list[PolicyBody]:
        def work(c: psycopg.Connection[Any], p: Principal) -> list[PolicyBody]:
            _project(c, p, organization_id, project_id)
            _governing(c, project_id, document_id)
            with transaction(c) as cursor:
                remove(cursor, document_id, p.id)
                _audit(cursor, organization_id, project_id, p.id, "document.removed",
                       document_id, {})  # fmt: skip
            return policies(c, project_id)

        return run(request, work)

    @app.post(f"{base}/policies/{{document_id}}/replace")
    async def replace_policy(
        organization_id: UUID,
        project_id: UUID,
        document_id: UUID,
        request: Request,
        title: str = "",
        file_name: str = "",
    ) -> PolicyResult:
        content = await request.body()
        if len(content) > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="file is larger than 5 MB")
        if not content:
            raise HTTPException(status_code=422, detail="file is empty")
        content_type = request.headers.get("content-type", "")

        def work(c: psycopg.Connection[Any], p: Principal) -> PolicyResult:
            _project(c, p, organization_id, project_id)
            _governing(c, project_id, document_id)
            read = read_reference(
                c, settings, model(), organization_id, project_id, p.id, content,
                file_name, content_type,
            )  # fmt: skip
            if not read.readable:
                return PolicyResult(policy=None, readable=False, note=read.note)
            with transaction(c) as cursor:
                new_id = replace(
                    cursor, organization_id, project_id, document_id, p.id, title=title,
                    text=read.text, file_name=read.file_name, sha256=read.sha256,
                )  # fmt: skip
                _audit(cursor, organization_id, project_id, p.id, "document.replaced",
                       new_id, {"previous": str(document_id)})  # fmt: skip
                if _kind(cursor, new_id) in EVIDENCE_KINDS:
                    keep_file(cursor, store(settings, c), new_id, content, content_type)
                    queued.append(request_run(cursor, organization_id, project_id, p.id))
            return PolicyResult(policy=one(c, project_id, new_id), readable=True,
                                note=read.note)  # fmt: skip

        queued: list[UUID] = []
        result = run(request, work)
        schedule_policy_evidence(scheduler, queued)
        return result

    @app.put(f"{base}/policies/{{document_id}}/scope")
    def scope_policy(
        organization_id: UUID,
        project_id: UUID,
        document_id: UUID,
        body: ScopeBody,
        request: Request,
    ) -> PolicyBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> PolicyBody:
            _project(c, p, organization_id, project_id)
            _governing(c, project_id, document_id)
            with transaction(c) as cursor:
                set_scope(cursor, project_id, document_id, p.id, body)
                _audit(cursor, organization_id, project_id, p.id, "document.scoped",
                       document_id, {"systems": [str(i) for i in body.system_ids],
                                     "processes": [str(i) for i in body.process_ids]})  # fmt: skip
                if _kind(cursor, document_id) in EVIDENCE_KINDS:
                    queued.append(request_run(cursor, organization_id, project_id, p.id))
            return one(c, project_id, document_id)

        queued: list[UUID] = []
        result = run(request, work)
        schedule_policy_evidence(scheduler, queued)
        return result
