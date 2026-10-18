"""Completing, reopening, and deleting engagements (Milestone 8.14).

Completed: a running engagement whose work is done. Every in-scope control (each system's
instance) has a signed-off test and a signed-off independent review with none reopened,
every deficiency is closed, every evidence request is received, closed, or cancelled, and
no agent work is running. Completing cancels the agents' open tasks. A completed
engagement is read-only; an owner or admin reopens it with a reason, which is kept.

Deleted: a draft that never launched. An owner or admin deletes it by typing its name.
Its setup is removed; the project row stays as a hidden placeholder, because the audit
trail never changes and points at it, and so do the records of the agents staffed on it
and the AI calls made for its setup (status, tokens, and cost; no content).

A completed or archived engagement is closed: the API refuses every change to it, in one
place (`register_closed_engagements`), except the lifecycle actions themselves.
"""

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg import sql
from psycopg.types.json import Json
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    Role,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.control_instances import control_label
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.settings import Settings

CLOSED = ("COMPLETED", "ARCHIVED")
# Agent tasks that have not started or are waiting; a running one is let finish first.
_OPEN_TASKS = ("DRAFT", "READY", "QUEUED", "WAITING", "BLOCKED", "REVIEW")
_OPEN_ITEMS_SHOWN = 50

# What a never-launched draft's setup consists of, removed in this order (children
# first). Every other table that holds rows for the engagement either stays with the
# placeholder (_KEPT) or, holding anything, means work exists and the draft is not
# deleted (`_work_on_record`).
_SETUP_TABLES = (
    "project_member_roles",
    "project_memberships",
    "invitations",
    "source_document_controls",
    "control_attributes",
    "control_context_issues",
    "control_narratives",
    "control_parameters",
    "process_understandings",
    "control_changes",
    "system_recommendations",
    "system_control_assessments",
    "soc_cuecs",
    "soc_reports",
    "system_reviews",
    "engagement_controls",
    "source_documents",
    "engagement_processes",
    "rcm_imports",
    "engagement_applications",
    "setup_drafts",
    "workpaper_templates",
    "engagement_milestones",
    "engagement_phases",
    "engagement_settings",
)
_KEPT = ("audit_events", "model_calls", "agent_instances", "engagement_reopenings")


class CompletionBlocked(Exception):
    """Work on the engagement is still open."""


class LifecycleRefused(Exception):
    """The engagement's state does not allow the action."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class VersionMismatch(Exception):
    """The engagement changed since the caller read it."""


class OpenItem(BaseModel):
    kind: Literal["TEST", "REVIEW", "DEFICIENCY", "REQUEST", "RUNNING"]
    label: str
    control_id: UUID | None = None


class ReopeningBody(BaseModel):
    reason: str
    reopened_by: str
    reopened_at: datetime


class CompletionBody(BaseModel):
    status: str
    version: int
    # Completing is possible now: the engagement runs and nothing is open.
    can_complete: bool
    open_count: int
    # The first open items, each a person can go and finish.
    open_items: list[OpenItem]
    completed_at: datetime | None
    completed_by: str
    reopenings: list[ReopeningBody]
    # The engagement never launched, so an owner or admin may delete it.
    deletable: bool


class CompleteBody(BaseModel):
    version: int = Field(ge=1)


class ReopenBody(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


class DeleteBody(BaseModel):
    version: int = Field(ge=1)
    # The engagement's name, typed by the person, so a delete is never an accident.
    name: str = Field(min_length=1, max_length=200)


class DeletedBody(BaseModel):
    deleted: bool


def register_engagement_close(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/completion", response_model=CompletionBody)
    def completion(organization_id: UUID, project_id: UUID, request: Request) -> CompletionBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: read_completion(connection, principal, organization_id, project_id),
        )

    @app.post(f"{base}/complete", response_model=CompletionBody)
    def complete(
        organization_id: UUID, project_id: UUID, body: CompleteBody, request: Request
    ) -> CompletionBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: complete_engagement(
                connection, principal, organization_id, project_id, body
            ),
        )

    @app.post(f"{base}/reopen", response_model=CompletionBody)
    def reopen(
        organization_id: UUID, project_id: UUID, body: ReopenBody, request: Request
    ) -> CompletionBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: reopen_engagement(
                connection, principal, organization_id, project_id, body
            ),
        )

    @app.post(f"{base}/delete", response_model=DeletedBody)
    def delete(
        organization_id: UUID, project_id: UUID, body: DeleteBody, request: Request
    ) -> DeletedBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: delete_draft(
                connection, principal, organization_id, project_id, body
            ),
        )


# The engagement's own lifecycle actions; everything else under a closed engagement waits.
_PROJECT_PATH = re.compile(
    r"^/organizations/([0-9a-fA-F-]{36})/projects/([0-9a-fA-F-]{36})(/[^?]*)?$"
)
_LIFECYCLE = frozenset({"", "/complete", "/reopen", "/delete"})
# Asking the console about a closed engagement changes nothing in it; its actions are
# refused by the policy engine, which allows only reads there.
_READ_ONLY_QUESTIONS = re.compile(r"^/console/(threads|messages(/[0-9a-fA-F-]{36}/retry)?)$")
_WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def closed_detail(status: str) -> str:
    return f"engagement is not active: it is {status.lower()} and read-only"


def register_closed_engagements(app: FastAPI, settings: Settings) -> None:
    """Refuse every change under a completed or archived engagement, in one place.

    Registered before the session middleware, so it runs after it: the caller is signed
    in, and the status is told only to a member of the engagement's firm."""

    @app.middleware("http")
    async def refuse_closed(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in _WRITES or settings.database_url == "":
            return await call_next(request)
        match = _PROJECT_PATH.match(request.url.path)
        if match is None:
            return await call_next(request)
        rest = match.group(3) or ""
        if rest in _LIFECYCLE or _READ_ONLY_QUESTIONS.match(rest) is not None:
            return await call_next(request)
        user_id = getattr(request.state, "user_id", None)
        if not isinstance(user_id, UUID):
            return await call_next(request)
        try:
            organization_id, project_id = UUID(match.group(1)), UUID(match.group(2))
        except ValueError:
            return await call_next(request)
        status = await run_in_threadpool(
            _closed_status, settings.database_url, user_id, organization_id, project_id
        )
        if status is not None:
            return JSONResponse({"detail": closed_detail(status)}, status_code=409)
        return await call_next(request)


def _closed_status(
    database_url: str, user_id: UUID, organization_id: UUID, project_id: UUID
) -> str | None:
    with connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT p.status::text
            FROM projects p
            JOIN memberships m
              ON m.organization_id = p.organization_id AND m.user_id = %s
             AND m.status = 'ACTIVE'
            WHERE p.id = %s AND p.organization_id = %s AND p.deleted_at IS NULL
            """,
            (user_id, project_id, organization_id),
        ).fetchone()
    if row is None or str(row[0]) not in CLOSED:
        return None
    return str(row[0])


def read_completion(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> CompletionBody:
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    with connection.cursor() as cursor:
        return _completion(cursor, organization_id, project_id)


def complete_engagement(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: CompleteBody,
) -> CompletionBody:
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        status, version = _lock(cursor, organization_id, project_id)
        if version != body.version:
            raise VersionMismatch()
        if status not in ("ACTIVE", "PAUSED"):
            raise LifecycleRefused("only a running engagement is completed")
        total, _items = _open_work(cursor, project_id)
        if total > 0:
            raise CompletionBlocked()
        cancelled = cursor.execute(
            """
            UPDATE tasks
            SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
                cancellation_reason = 'Engagement completed', version = version + 1,
                updated_at = clock_timestamp()
            WHERE project_id = %s AND status = ANY(%s)
            RETURNING id
            """,
            (project_id, list(_OPEN_TASKS)),
        ).fetchall()
        cursor.execute(
            """
            UPDATE projects
            SET status = 'COMPLETED', completed_at = clock_timestamp(), completed_by = %s,
                version = version + 1
            WHERE id = %s
            """,
            (principal.id, project_id),
        )
        _audit(
            cursor, organization_id, project_id, principal.id, "project.completed",
            {"status": "COMPLETED", "tasks_cancelled": len(cancelled)},
        )  # fmt: skip
        return _completion(cursor, organization_id, project_id)


def reopen_engagement(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ReopenBody,
) -> CompletionBody:
    access = authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if access.role not in (Role.OWNER, Role.ADMIN):
        raise AccessDenied()
    reason = " ".join(body.reason.split())
    if len(reason) < 3 or contains_secret({"reason": reason}):
        raise ValueError("reason is invalid")
    with transaction(connection) as cursor:
        status, version = _lock(cursor, organization_id, project_id)
        if version != body.version:
            raise VersionMismatch()
        if status != "COMPLETED":
            raise LifecycleRefused("only a completed engagement is reopened")
        cursor.execute(
            """
            INSERT INTO engagement_reopenings (
                organization_id, project_id, reason, reopened_by, completed_at
            )
            SELECT organization_id, id, %s, %s, completed_at FROM projects WHERE id = %s
            """,
            (reason, principal.id, project_id),
        )
        cursor.execute(
            """
            UPDATE projects
            SET status = 'ACTIVE', completed_at = NULL, completed_by = NULL,
                version = version + 1
            WHERE id = %s
            """,
            (project_id,),
        )
        # The reason is kept with the reopening, not in the audit payload.
        _audit(
            cursor, organization_id, project_id, principal.id, "project.reopened",
            {"status": "ACTIVE"},
        )  # fmt: skip
        return _completion(cursor, organization_id, project_id)


def delete_draft(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: DeleteBody,
) -> DeletedBody:
    access = authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if access.role not in (Role.OWNER, Role.ADMIN):
        raise AccessDenied()
    with transaction(connection) as cursor:
        status, version = _lock(cursor, organization_id, project_id)
        if version != body.version:
            raise VersionMismatch()
        row = cursor.execute(
            """
            SELECT p.name, s.kicked_off_at IS NOT NULL
            FROM projects p LEFT JOIN engagement_settings s ON s.project_id = p.id
            WHERE p.id = %s
            """,
            (project_id,),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if " ".join(body.name.split()) != " ".join(str(row[0]).split()):
            raise ValueError("name does not match")
        if row[1] is True or status not in ("DRAFT", "ARCHIVED"):
            raise LifecycleRefused("a launched engagement is not deleted")
        if _setup_running(cursor, project_id):
            raise LifecycleRefused("setup work is still running")
        if _work_on_record(cursor, project_id):
            raise LifecycleRefused("engagement has work on record")
        counts = cursor.execute(
            """
            SELECT (SELECT count(*) FROM engagement_applications WHERE project_id = %s),
                   (SELECT count(*) FROM engagement_controls WHERE project_id = %s)
            """,
            (project_id, project_id),
        ).fetchone()
        # The row first, while its settings still show it never launched.
        cursor.execute(
            """
            UPDATE projects
            SET deleted_at = clock_timestamp(), deleted_by = %s,
                slug = 'deleted-' || id::text, scope = '', version = version + 1
            WHERE id = %s
            """,
            (principal.id, project_id),
        )
        for table in _SETUP_TABLES:
            cursor.execute(
                sql.SQL("DELETE FROM {} WHERE project_id = %s").format(sql.Identifier(table)),
                (project_id,),
            )
        _audit(
            cursor, organization_id, project_id, principal.id, "project.deleted",
            {
                "status": status,
                "systems": int(counts[0]) if counts else 0,
                "controls": int(counts[1]) if counts else 0,
            },
        )  # fmt: skip
    return DeletedBody(deleted=True)


def _lock(cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID) -> tuple[str, int]:
    row = cursor.execute(
        """
        SELECT status::text, version FROM projects
        WHERE id = %s AND organization_id = %s AND deleted_at IS NULL
        FOR UPDATE
        """,
        (project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return str(row[0]), int(row[1])


def _setup_running(cursor: psycopg.Cursor[Any], project_id: UUID) -> bool:
    row = cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM setup_drafts
            WHERE project_id = %s AND draft_status IN ('PENDING', 'WORKING')
        ) OR EXISTS (
            SELECT 1 FROM system_reviews
            WHERE project_id = %s AND review_status IN ('PENDING', 'WORKING')
        )
        """,
        (project_id, project_id),
    ).fetchone()
    return bool(row and row[0])


def _work_on_record(cursor: psycopg.Cursor[Any], project_id: UUID) -> bool:
    """Any row for the engagement outside its setup and what the placeholder keeps. A
    table added later counts here until it is named above, so a delete never leaves part
    of the work behind."""
    tables = [
        str(row[0])
        for row in cursor.execute(
            """
            SELECT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'project_id'
              AND table_name <> ALL(%s)
            """,
            (list(_SETUP_TABLES) + list(_KEPT),),
        ).fetchall()
    ]
    for table in tables:
        found = cursor.execute(
            sql.SQL("SELECT EXISTS (SELECT 1 FROM {} WHERE project_id = %s)").format(
                sql.Identifier(table)
            ),
            (project_id,),
        ).fetchone()
        if found is not None and found[0] is True:
            return True
    return False


def _open_work(cursor: psycopg.Cursor[Any], project_id: UUID) -> tuple[int, list[OpenItem]]:
    items: list[OpenItem] = []
    for control_id, ref, application, tested, testing, reviewed, reviewing in cursor.execute(
        """
        SELECT c.id, c.control_ref, a.name,
               EXISTS (SELECT 1 FROM test_sheets t
                       WHERE t.engagement_control_id = c.id AND t.status = 'SIGNED_OFF'),
               EXISTS (SELECT 1 FROM test_sheets t
                       WHERE t.engagement_control_id = c.id AND t.status = 'OPEN'),
               EXISTS (SELECT 1 FROM control_reviews r
                       WHERE r.engagement_control_id = c.id AND r.status = 'SIGNED_OFF'),
               EXISTS (SELECT 1 FROM control_reviews r
                       WHERE r.engagement_control_id = c.id AND r.status = 'OPEN')
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.project_id = %s AND c.included
        ORDER BY c.control_ref, a.name NULLS FIRST
        """,
        (project_id,),
    ).fetchall():
        label = control_label(str(ref), None if application is None else str(application))
        if not tested or testing:
            items.append(OpenItem(kind="TEST", label=f"{label}: test not signed off",
                                  control_id=control_id))  # fmt: skip
        elif not reviewed or reviewing:
            items.append(OpenItem(kind="REVIEW", label=f"{label}: review not signed off",
                                  control_id=control_id))  # fmt: skip
    for reference, title, control_id in cursor.execute(
        """
        SELECT reference, title, engagement_control_id FROM deficiencies
        WHERE project_id = %s AND status <> 'CLOSED' ORDER BY reference
        """,
        (project_id,),
    ).fetchall():
        items.append(OpenItem(kind="DEFICIENCY", label=f"{reference} {title}: not closed",
                              control_id=control_id))  # fmt: skip
    for ref, status, control_id in cursor.execute(
        """
        SELECT control_ref, status, engagement_control_id FROM pbc_requests
        WHERE project_id = %s AND status NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')
        ORDER BY control_ref, created_at
        """,
        (project_id,),
    ).fetchall():
        state = str(status).replace("_", " ").lower()
        items.append(OpenItem(kind="REQUEST", label=f"{ref}: evidence request {state}",
                              control_id=control_id))  # fmt: skip
    for (title,) in cursor.execute(
        "SELECT title FROM tasks WHERE project_id = %s AND status = 'RUNNING' ORDER BY title",
        (project_id,),
    ).fetchall():
        items.append(OpenItem(kind="RUNNING", label=f"Agent still working: {title}"))
    return len(items), items[:_OPEN_ITEMS_SHOWN]


def _completion(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID
) -> CompletionBody:
    row = cursor.execute(
        """
        SELECT p.status::text, p.version, p.completed_at, coalesce(u.display_name, ''),
               s.kicked_off_at IS NOT NULL
        FROM projects p
        LEFT JOIN users u ON u.id = p.completed_by
        LEFT JOIN engagement_settings s ON s.project_id = p.id
        WHERE p.id = %s AND p.organization_id = %s AND p.deleted_at IS NULL
        """,
        (project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    status, version, completed_at, completed_by, launched = row
    total, items = _open_work(cursor, project_id) if launched else (0, [])
    reopenings = [
        ReopeningBody(reason=str(reason), reopened_by=str(name), reopened_at=at)
        for reason, name, at in cursor.execute(
            """
            SELECT r.reason, coalesce(u.display_name, ''), r.created_at
            FROM engagement_reopenings r LEFT JOIN users u ON u.id = r.reopened_by
            WHERE r.project_id = %s ORDER BY r.created_at DESC
            """,
            (project_id,),
        ).fetchall()
    ]
    return CompletionBody(
        status=str(status),
        version=int(version),
        can_complete=str(status) in ("ACTIVE", "PAUSED") and total == 0,
        open_count=total,
        open_items=items,
        completed_at=completed_at,
        completed_by=str(completed_by),
        reopenings=reopenings,
        deletable=launched is not True and str(status) in ("DRAFT", "ARCHIVED"),
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'project', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, project_id, Json(payload)),
    )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except CompletionBlocked:
        raise HTTPException(status_code=409, detail="work is still open") from None
    except LifecycleRefused as error:
        raise HTTPException(status_code=409, detail=error.detail) from None
    except VersionMismatch:
        raise HTTPException(status_code=409, detail="project changed") from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    return result
