"""Project records. Status changes are explicit, and archive keeps the row."""

from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import ConcurrentUpdateError, require_one_row, transaction
from ai_workforce_api.settings import Settings

ProjectStatus = Literal["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]
_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"DRAFT", "ACTIVE", "ARCHIVED"}),
    "ACTIVE": frozenset({"ACTIVE", "PAUSED", "ARCHIVED"}),
    "PAUSED": frozenset({"PAUSED", "ACTIVE", "ARCHIVED"}),
    "ARCHIVED": frozenset({"ARCHIVED"}),
}


class ProjectStateError(Exception):
    """The requested status is not a legal next state."""


class ProjectConflict(Exception):
    """Another project in the organization already uses this slug."""


class ProjectVersionError(Exception):
    """The project version no longer matches the caller's copy."""


class ProgressItem(BaseModel):
    status: str
    count: int


class ActivityItem(BaseModel):
    action: str
    occurred_at: datetime
    actor_name: str


class AssignableMemberBody(BaseModel):
    id: UUID
    display_name: str


class ProjectDetailBody(BaseModel):
    id: UUID
    name: str
    slug: str
    scope: str
    owner_user_id: UUID
    owner_name: str
    status: str
    starts_on: date | None
    ends_on: date | None
    version: int
    progress: list[ProgressItem]
    activity: list[ActivityItem]


class ProjectFields(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    scope: str = Field(default="", max_length=4000)
    owner_user_id: UUID
    starts_on: date | None = None
    ends_on: date | None = None

    @field_validator("name")
    @classmethod
    def name_is_visible(cls, value: str) -> str:
        stripped = value.strip()
        if stripped == "":
            raise ValueError("name is blank")
        return stripped

    @field_validator("scope")
    @classmethod
    def scope_is_trimmed(cls, value: str) -> str:
        return value.strip()

    def dates_are_ordered(self) -> None:
        if (
            self.starts_on is not None
            and self.ends_on is not None
            and self.ends_on < self.starts_on
        ):
            raise ValueError("ends_on precedes starts_on")


class ProjectCreateBody(ProjectFields):
    status: Literal["DRAFT", "ACTIVE"] = "DRAFT"


class ProjectUpdateBody(ProjectFields):
    status: ProjectStatus
    version: int = Field(ge=1)


def register_projects(app: FastAPI, settings: Settings) -> None:
    @app.get(
        "/organizations/{organization_id}/projects/{project_id}",
        response_model=ProjectDetailBody,
    )
    def project(organization_id: UUID, project_id: UUID, request: Request) -> ProjectDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: get_project(connection, principal, organization_id, project_id),
        )

    @app.get(
        "/organizations/{organization_id}/assignable-members",
        response_model=list[AssignableMemberBody],
    )
    def assignable_members(organization_id: UUID, request: Request) -> list[AssignableMemberBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: list_assignable_members(connection, principal, organization_id),
        )

    @app.post(
        "/organizations/{organization_id}/projects",
        response_model=ProjectDetailBody,
        status_code=201,
    )
    def create(
        organization_id: UUID, body: ProjectCreateBody, request: Request
    ) -> ProjectDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: create_project(connection, principal, organization_id, body),
        )

    @app.patch(
        "/organizations/{organization_id}/projects/{project_id}",
        response_model=ProjectDetailBody,
    )
    def update(
        organization_id: UUID,
        project_id: UUID,
        body: ProjectUpdateBody,
        request: Request,
    ) -> ProjectDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: update_project(
                connection, principal, organization_id, project_id, body
            ),
        )


def get_project(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> ProjectDetailBody:
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    return _load_detail(connection, organization_id, project_id)


def list_assignable_members(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> list[AssignableMemberBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_CREATE,
        organization_id=organization_id,
    )
    rows = connection.execute(
        """
        SELECT u.id, u.display_name
        FROM memberships AS m
        JOIN users AS u ON u.id = m.user_id
        WHERE m.organization_id = %s
          AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
        ORDER BY u.display_name
        """,
        (organization_id,),
    ).fetchall()
    members: list[AssignableMemberBody] = []
    for row in rows:
        member_id, display_name = row
        if not isinstance(member_id, UUID) or not isinstance(display_name, str):
            raise NotVisible()
        members.append(AssignableMemberBody(id=member_id, display_name=display_name))
    return members


def create_project(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    body: ProjectCreateBody,
) -> ProjectDetailBody:
    body.dates_are_ordered()
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_CREATE,
        organization_id=organization_id,
    )
    with transaction(connection) as cursor:
        if not _active_member(cursor, organization_id, body.owner_user_id):
            raise NotVisible()
        try:
            cursor.execute(
                """
                INSERT INTO projects (
                    organization_id, name, slug, scope, owner_user_id, status, starts_on, ends_on
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    organization_id,
                    body.name,
                    body.slug,
                    body.scope,
                    body.owner_user_id,
                    body.status,
                    body.starts_on,
                    body.ends_on,
                ),
            )
        except psycopg.errors.UniqueViolation:
            raise ProjectConflict() from None
        created = cursor.fetchone()
        if created is None or not isinstance(created[0], UUID):
            raise NotVisible()
        project_id = created[0]
        for member_id in {body.owner_user_id, principal.id}:
            cursor.execute(
                """
                INSERT INTO project_memberships (organization_id, project_id, user_id)
                VALUES (%s, %s, %s)
                """,
                (organization_id, project_id, member_id),
            )
        _audit(cursor, organization_id, project_id, principal.id, "project.created", body.status)
    return _load_detail(connection, organization_id, project_id)


def update_project(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ProjectUpdateBody,
) -> ProjectDetailBody:
    body.dates_are_ordered()
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        if not _active_member(cursor, organization_id, body.owner_user_id):
            raise NotVisible()
        cursor.execute(
            """
            SELECT status::text
            FROM projects
            WHERE id = %s AND organization_id = %s
            FOR UPDATE
            """,
            (project_id, organization_id),
        )
        current = cursor.fetchone()
        if current is None or not isinstance(current[0], str):
            raise NotVisible()
        if body.status not in _TRANSITIONS.get(current[0], frozenset()):
            raise ProjectStateError()
        try:
            cursor.execute(
                """
                UPDATE projects
                SET name = %s,
                    slug = %s,
                    scope = %s,
                    owner_user_id = %s,
                    status = %s,
                    starts_on = %s,
                    ends_on = %s,
                    version = version + 1
                WHERE id = %s AND organization_id = %s AND version = %s
                """,
                (
                    body.name,
                    body.slug,
                    body.scope,
                    body.owner_user_id,
                    body.status,
                    body.starts_on,
                    body.ends_on,
                    project_id,
                    organization_id,
                    body.version,
                ),
            )
            require_one_row(cursor)
        except ConcurrentUpdateError:
            raise ProjectVersionError() from None
        except psycopg.errors.UniqueViolation:
            raise ProjectConflict() from None
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            _update_action(current[0], body.status),
            body.status,
        )
    return _load_detail(connection, organization_id, project_id)


def _update_action(previous: str, status: str) -> str:
    if status == "PAUSED" and previous != "PAUSED":
        return "project.paused"
    if status == "ACTIVE" and previous == "PAUSED":
        return "project.resumed"
    if status == "ARCHIVED" and previous != "ARCHIVED":
        return "project.archived"
    if status == "ACTIVE" and previous == "DRAFT":
        return "project.started"
    return "project.updated"


def _active_member(cursor: psycopg.Cursor[Any], organization_id: UUID, user_id: UUID) -> bool:
    cursor.execute(
        """
        SELECT 1
        FROM memberships AS m
        JOIN users AS u ON u.id = m.user_id
        WHERE m.organization_id = %s
          AND m.user_id = %s
          AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
        """,
        (organization_id, user_id),
    )
    return cursor.fetchone() is not None


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_user_id: UUID,
    action: str,
    status: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'project', %s, %s)
        """,
        (organization_id, project_id, actor_user_id, action, project_id, Json({"status": status})),
    )


def _load_detail(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID
) -> ProjectDetailBody:
    row = connection.execute(
        """
        SELECT p.id, p.name, p.slug, p.scope, p.owner_user_id, u.display_name,
               p.status::text, p.starts_on, p.ends_on, p.version
        FROM projects AS p
        JOIN users AS u ON u.id = p.owner_user_id
        WHERE p.id = %s AND p.organization_id = %s
        """,
        (project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    (
        project_id_value,
        name,
        slug,
        scope,
        owner_user_id,
        owner_name,
        status,
        starts_on,
        ends_on,
        version,
    ) = row
    if (
        not isinstance(project_id_value, UUID)
        or not isinstance(name, str)
        or not isinstance(slug, str)
        or not isinstance(scope, str)
        or not isinstance(owner_user_id, UUID)
        or not isinstance(owner_name, str)
        or not isinstance(status, str)
        or not isinstance(version, int)
        or not _is_date(starts_on)
        or not _is_date(ends_on)
    ):
        raise NotVisible()
    progress_rows = connection.execute(
        """
        SELECT status::text, count(*)
        FROM tasks
        WHERE organization_id = %s AND project_id = %s
        GROUP BY status
        ORDER BY status
        """,
        (organization_id, project_id),
    ).fetchall()
    progress: list[ProgressItem] = []
    for item in progress_rows:
        item_status, count = item
        if not isinstance(item_status, str) or not isinstance(count, int):
            raise NotVisible()
        progress.append(ProgressItem(status=item_status, count=count))
    activity_rows = connection.execute(
        """
        SELECT e.action, e.occurred_at, COALESCE(u.display_name, 'Workspace')
        FROM audit_events AS e
        LEFT JOIN users AS u ON u.id = e.actor_user_id
        WHERE e.organization_id = %s AND e.project_id = %s
        ORDER BY e.occurred_at DESC
        LIMIT 20
        """,
        (organization_id, project_id),
    ).fetchall()
    activity: list[ActivityItem] = []
    for item in activity_rows:
        action, occurred_at, actor_name = item
        if (
            not isinstance(action, str)
            or not isinstance(occurred_at, datetime)
            or not isinstance(actor_name, str)
        ):
            raise NotVisible()
        activity.append(ActivityItem(action=action, occurred_at=occurred_at, actor_name=actor_name))
    return ProjectDetailBody(
        id=project_id_value,
        name=name,
        slug=slug,
        scope=scope,
        owner_user_id=owner_user_id,
        owner_name=owner_name,
        status=status,
        starts_on=starts_on,
        ends_on=ends_on,
        version=version,
        progress=progress,
        activity=activity,
    )


def _is_date(value: object) -> bool:
    return value is None or isinstance(value, date)


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except ProjectStateError:
        raise HTTPException(
            status_code=409, detail="project status cannot change that way"
        ) from None
    except ProjectConflict:
        raise HTTPException(status_code=409, detail="project slug is already in use") from None
    except ProjectVersionError:
        raise HTTPException(status_code=409, detail="project changed") from None
    except ValueError:
        raise HTTPException(status_code=422, detail="project fields are invalid") from None
    return result
