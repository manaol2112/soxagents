"""The last workspace page each person opened (migration 0124), so the workspace opens
where they left off, on any computer (decided by the product owner on 28 October 2026).

A page is kept only as an address within the workspace (``/?organization=...``) for a firm,
and an engagement, the person can open at the time; access is checked again when it is
read back, so a page in a firm or engagement they have since left is never offered.
"""

from collections.abc import Callable
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

MAX_PATH = 2000


class LastPage(BaseModel):
    path: str = Field(min_length=3, max_length=MAX_PATH)


class LastPageBody(BaseModel):
    path: str
    organization_id: UUID
    project_id: UUID | None
    visited_at: str


def _ids(path: str) -> tuple[UUID, UUID | None]:
    """The firm and engagement a workspace address names; refused when it is anything
    else (another site, another page, a missing or malformed firm)."""
    parts = urlsplit(path)
    if parts.scheme or parts.netloc or parts.path != "/" or parts.fragment:
        raise ValueError("not a workspace address")
    query = parse_qs(parts.query, keep_blank_values=False)
    organizations = query.get("organization", [])
    projects = query.get("project", [])
    if len(organizations) != 1 or len(projects) > 1:
        raise ValueError("not a workspace address")
    try:
        organization = UUID(organizations[0])
        project = UUID(projects[0]) if projects else None
    except ValueError:
        raise ValueError("not a workspace address") from None
    return organization, project


def _may_open(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID | None,
) -> bool:
    try:
        authorize(
            connection,
            principal=principal,
            action=Action.PROJECT_READ if project_id is not None else Action.ORGANIZATION_READ,
            organization_id=organization_id,
            project_id=project_id,
        )
    except AccessDenied, NotVisible:
        return False
    return True


def remember(connection: psycopg.Connection[Any], principal: Principal, body: LastPage) -> None:
    """Keep the page as the person's last, when it is one they may open."""
    organization_id, project_id = _ids(body.path)
    if not _may_open(connection, principal, organization_id, project_id):
        raise NotVisible()
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO user_last_pages (user_id, organization_id, project_id, path)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE
            SET organization_id = EXCLUDED.organization_id,
                project_id = EXCLUDED.project_id,
                path = EXCLUDED.path,
                visited_at = clock_timestamp()
            """,
            (principal.id, organization_id, project_id, body.path),
        )


def recall(connection: psycopg.Connection[Any], principal: Principal) -> LastPageBody | None:
    """The person's last page, while they may still open it."""
    row = connection.execute(
        "SELECT path, organization_id, project_id, visited_at FROM user_last_pages "
        "WHERE user_id = %s",
        (principal.id,),
    ).fetchone()
    if row is None:
        return None
    organization_id = UUID(str(row[1]))
    project_id = None if row[2] is None else UUID(str(row[2]))
    if not _may_open(connection, principal, organization_id, project_id):
        return None
    return LastPageBody(
        path=str(row[0]),
        organization_id=organization_id,
        project_id=project_id,
        visited_at=row[3].isoformat(),
    )


def register_last_page(app: FastAPI, settings: Settings) -> None:
    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.put("/me/last-page", status_code=204)
    def put_last_page(body: LastPage, request: Request) -> Response:
        run(request, lambda c, p: remember(c, p, body))
        return Response(status_code=204)

    @app.get("/me/last-page")
    def get_last_page(request: Request) -> LastPageBody:
        found = run(request, recall)
        if found is None:
            raise HTTPException(status_code=404, detail="no last page")
        return found
