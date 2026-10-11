"""Store inbound attachment bytes. The record is the chain of custody, not a workpaper."""

import asyncio
import re
from collections.abc import Callable
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Request, Response
from psycopg.types.json import Json
from pydantic import BaseModel

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
from ai_workforce_api.evidence_analysis import (
    EvidenceAnalysisScheduler,
    queue_analysis,
    schedule_analyses,
)
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import ObjectStore, StoreError, digest_of, open_store

MAX_BYTES = 25_000_000
_NAME = re.compile(r"[^A-Za-z0-9._-]")
StoreFactory = Callable[[Settings, psycopg.Connection[Any]], ObjectStore]


class EvidenceState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class EvidenceFileBody(BaseModel):
    id: UUID
    mailbox_attachment_id: UUID
    content_sha256: str
    size_bytes: int
    content_type: str
    file_name: str
    created_at: datetime


def register_evidence(
    app: FastAPI,
    settings: Settings,
    store: StoreFactory = open_store,
    analyses: EvidenceAnalysisScheduler | None = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/evidence-files")
    def list_files(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[EvidenceFileBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _list(connection, principal, organization_id, project_id),
        )

    @app.post(f"{base}/mailbox-attachments/{{attachment_id}}/content")
    async def store_file(
        organization_id: UUID,
        project_id: UUID,
        attachment_id: UUID,
        request: Request,
    ) -> EvidenceFileBody:
        content = await request.body()
        principal = _session_principal(request)
        stored, queued = _run(
            settings,
            lambda connection: _store(
                connection,
                store(settings, connection),
                principal,
                organization_id,
                project_id,
                attachment_id,
                content,
            ),
        )
        # The evidence coordinator reads the new file in the background. Scheduling may
        # start its own event loop, so it runs off this one.
        await asyncio.to_thread(schedule_analyses, analyses, [] if queued is None else [queued])
        return stored

    @app.get(f"{base}/evidence-files/{{file_id}}/content")
    def download(
        organization_id: UUID, project_id: UUID, file_id: UUID, request: Request
    ) -> Response:
        principal = _session_principal(request)
        stored, content = _run(
            settings,
            lambda connection: _download(
                connection,
                store(settings, connection),
                principal,
                organization_id,
                project_id,
                file_id,
            ),
        )
        return Response(
            content=content,
            media_type=stored.content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{_filename(stored.file_name)}"',
                "X-Content-Type-Options": "nosniff",
            },
        )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        return _call(settings, work)
    except EvidenceState as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except StoreError as error:
        status = 409 if error.detail == "stored object changed" else 503
        raise HTTPException(status_code=status, detail=error.detail) from None


def _store(
    connection: psycopg.Connection[Any],
    store: ObjectStore,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    attachment_id: UUID,
    content: bytes,
) -> tuple[EvidenceFileBody, UUID | None]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()
    if len(content) > MAX_BYTES:
        raise EvidenceState("file does not match")
    digest = digest_of(content)
    with transaction(connection) as cursor:
        attachment = _lock_attachment(cursor, organization_id, project_id, attachment_id)
        if len(content) != attachment[0]:
            raise EvidenceState("file does not match")
        declared = attachment[3]
        if isinstance(declared, str) and declared != digest:
            raise EvidenceState("file does not match")
        existing = _by_attachment(cursor, project_id, attachment_id)
        if existing is not None:
            if existing.content_sha256 != digest:
                raise EvidenceState("file changed")
            return existing, None
        file_id = uuid4()
        key = f"evidence/{file_id}"
        store.put(key, content)
        row = cursor.execute(
            """
            INSERT INTO evidence_files (
                id, organization_id, project_id, mailbox_attachment_id, object_key,
                content_sha256, size_bytes, content_type, file_name, stored_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, mailbox_attachment_id, content_sha256, size_bytes,
                      content_type, file_name, created_at
            """,
            (
                file_id,
                organization_id,
                project_id,
                attachment_id,
                key,
                digest,
                len(content),
                str(attachment[1]),
                str(attachment[2]),
                principal.id,
            ),
        ).fetchone()
        if row is None:
            raise NotVisible()
        stored = _body(row)
        _audit(cursor, organization_id, project_id, principal.id, stored)
        queued = queue_analysis(cursor, organization_id, project_id, stored.id, principal.id)
    return stored, queued


def _download(
    connection: psycopg.Connection[Any],
    store: ObjectStore,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
) -> tuple[EvidenceFileBody, bytes]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    stored = _by_id(connection, organization_id, project_id, file_id)
    content = store.get(_key(connection, stored.id))
    if digest_of(content) != stored.content_sha256 or len(content) != stored.size_bytes:
        raise EvidenceState("custody check failed")
    return stored, content


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[EvidenceFileBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        """
        SELECT id, mailbox_attachment_id, content_sha256, size_bytes, content_type,
               file_name, created_at
        FROM evidence_files
        WHERE organization_id = %s AND project_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 500
        """,
        (organization_id, project_id),
    ).fetchall()
    return [_body(row) for row in rows]


def _lock_attachment(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, attachment_id: UUID
) -> tuple[Any, ...]:
    row = cursor.execute(
        """
        SELECT size_bytes, content_type, file_name, content_sha256
        FROM mailbox_attachments
        WHERE id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (attachment_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    locked: tuple[Any, ...] = row
    return locked


def _by_attachment(
    cursor: psycopg.Cursor[Any], project_id: UUID, attachment_id: UUID
) -> EvidenceFileBody | None:
    row = cursor.execute(
        """
        SELECT id, mailbox_attachment_id, content_sha256, size_bytes, content_type,
               file_name, created_at
        FROM evidence_files
        WHERE project_id = %s AND mailbox_attachment_id = %s
        """,
        (project_id, attachment_id),
    ).fetchone()
    return None if row is None else _body(row)


def _by_id(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, file_id: UUID
) -> EvidenceFileBody:
    row = connection.execute(
        """
        SELECT id, mailbox_attachment_id, content_sha256, size_bytes, content_type,
               file_name, created_at
        FROM evidence_files
        WHERE id = %s AND organization_id = %s AND project_id = %s
        """,
        (file_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _body(row)


def _key(connection: psycopg.Connection[Any], file_id: UUID) -> str:
    row = connection.execute(
        "SELECT object_key FROM evidence_files WHERE id = %s",
        (file_id,),
    ).fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    return row[0]


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    stored: EvidenceFileBody,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'evidence.stored', 'evidence_file', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor_id,
            stored.id,
            Json({"content_sha256": stored.content_sha256, "size_bytes": stored.size_bytes}),
        ),
    )


def _body(row: tuple[Any, ...]) -> EvidenceFileBody:
    if not isinstance(row[0], UUID) or not isinstance(row[6], datetime):
        raise NotVisible()
    return EvidenceFileBody(
        id=row[0],
        mailbox_attachment_id=row[1],
        content_sha256=str(row[2]),
        size_bytes=int(row[3]),
        content_type=str(row[4]),
        file_name=str(row[5]),
        created_at=row[6],
    )


def _filename(name: str) -> str:
    cleaned = _NAME.sub("_", name).strip("._")[:120]
    return cleaned or "evidence"
