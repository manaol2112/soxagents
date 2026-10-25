"""Project records. Status changes are explicit, and archive keeps the row."""

from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.clients import (
    assign_client,
    carry_client_details,
    client_of,
    roll_forward,
)
from ai_workforce_api.db import ConcurrentUpdateError, require_one_row, transaction
from ai_workforce_api.settings import Settings

ProjectStatus = Literal["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]
# The engagement lifecycle (Milestones 8.13 and 8.14). A draft becomes active only by
# launching from setup (onboarding.launch_engagement), which records the kickoff and the
# plan in the same transaction; nothing here can skip that. An active engagement can pause
# and resume. Completing and reopening have their own actions (engagement_close.py): a
# completed engagement is read-only until reopened, and can be archived. Archiving closes
# it for good: an archived engagement is read-only.
_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"DRAFT", "ARCHIVED"}),
    "ACTIVE": frozenset({"ACTIVE", "PAUSED", "ARCHIVED"}),
    "PAUSED": frozenset({"PAUSED", "ACTIVE", "ARCHIVED"}),
    "COMPLETED": frozenset({"ARCHIVED"}),
    "ARCHIVED": frozenset(),
}


class ProjectStateError(Exception):
    """The requested status is not a legal next state."""


class ProjectLaunchRequired(Exception):
    """A draft becomes active only by launching it from setup."""


class ProjectArchived(Exception):
    """An archived engagement is closed: nothing about it changes."""


class ProjectCompleted(Exception):
    """A completed engagement is read-only until an owner or admin reopens it."""


class ProjectConflict(Exception):
    """Another project in the organization already uses this slug."""


class ProjectVersionError(Exception):
    """The project version no longer matches the caller's copy."""


class ProjectDetailsLocked(Exception):
    """The client and the period end are part of the launched plan; they no longer change."""


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
    # The engagement's profile from its settings, for the edit form (Milestone 8.15).
    client_id: UUID | None = None
    client_name: str = ""
    period_end: date | None = None
    launched: bool = False


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


# The standard library's categories an engagement can cover (migration 0108).
Framework = Literal["ITGC", "ITAC", "KEY_REPORT", "BUSINESS", "ENTITY"]


class ProjectCreateBody(ProjectFields):
    status: Literal["DRAFT", "ACTIVE"] = "DRAFT"
    # The engagement's profile (Milestone 8.3c), kept on its settings.
    client_name: str = Field(default="", max_length=200)
    # A new engagement covers IT general controls and business process controls.
    engagement_type: Literal["SOX_ITGC", "SOX_FULL", "IT_AUDIT"] = "SOX_FULL"
    period_end: date | None = None
    # The firm's client it is for (Milestone 8.18); else the client named, found or added.
    client_id: UUID | None = None
    # An earlier engagement of the same client whose setup the new one starts from.
    rollforward_from: UUID | None = None
    # The frameworks it covers (migration 0108); setup's Controls step opens with their
    # areas selected. None leaves setup's usual selection.
    frameworks: list[Framework] | None = Field(default=None, min_length=1, max_length=5)
    # The audit methodology, chosen with the client and the scope on the New engagement
    # page (decided by the product owner); None leaves it to the profile.
    methodology: Literal["EXTERNAL_ICFR", "MANAGEMENT_404", "INTERNAL_AUDIT"] | None = None

    @field_validator("frameworks")
    @classmethod
    def each_once(cls, value: list[Framework] | None) -> list[Framework] | None:
        return None if value is None else list(dict.fromkeys(value))


class ProjectUpdateBody(ProjectFields):
    status: ProjectStatus
    version: int = Field(ge=1)


class ProjectDetailsBody(BaseModel):
    """What the engagement form edits (Milestone 8.15): the same fields it creates with,
    and the fieldwork dates. The status changes by its own actions; the slug stays."""

    version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=200)
    owner_user_id: UUID
    client_name: str = Field(default="", max_length=200)
    # The firm's client, when the form picked one; else the client named.
    client_id: UUID | None = None
    period_end: date | None = None
    starts_on: date | None = None
    ends_on: date | None = None

    @field_validator("name", "client_name")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return " ".join(value.split())


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
        "/organizations/{organization_id}/projects/{project_id}/details",
        response_model=ProjectDetailBody,
    )
    def details(
        organization_id: UUID,
        project_id: UUID,
        body: ProjectDetailsBody,
        request: Request,
    ) -> ProjectDetailBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: update_details(
                connection, principal, organization_id, project_id, body
            ),
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


def update_details(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: ProjectDetailsBody,
) -> ProjectDetailBody:
    """The engagement's details and profile in one transaction. A completed or archived
    engagement is refused before this runs (engagement_close). After launch the client and
    the period end belong to the launched plan and stay as they are."""
    if body.name == "":
        raise ValueError("name is blank")
    if body.starts_on is not None and body.ends_on is not None and body.ends_on < body.starts_on:
        raise ValueError("ends_on precedes starts_on")
    if contains_secret({"name": body.name, "client": body.client_name}):
        raise ValueError("details hold a secret")
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
        row = cursor.execute(
            """
            SELECT p.status::text, p.version, p.name, p.owner_user_id, p.starts_on, p.ends_on,
                   s.client_name, s.period_end, s.kicked_off_at IS NOT NULL
            FROM projects p JOIN engagement_settings s ON s.project_id = p.id
            WHERE p.id = %s AND p.organization_id = %s AND p.deleted_at IS NULL
            FOR UPDATE OF p, s
            """,
            (project_id, organization_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        status, version, name, owner, starts, ends, client, period_end, launched = row
        current_client = client_of(cursor, project_id)
        if body.client_id is not None:
            named = cursor.execute(
                "SELECT name FROM clients WHERE id = %s AND organization_id = %s",
                (body.client_id, organization_id),
            ).fetchone()
            if named is None:
                raise NotVisible()
            body.client_name = str(named[0])
        if str(status) == "ARCHIVED":
            raise ProjectArchived()
        if str(status) == "COMPLETED":
            raise ProjectCompleted()
        if int(version) != body.version:
            raise ProjectVersionError()
        same_client = (
            body.client_id == current_client
            if body.client_id is not None
            else body.client_name.casefold() == str(client).casefold()
        )
        if launched and (not same_client or body.period_end != period_end):
            raise ProjectDetailsLocked()
        before = {
            "name": name, "owner": owner, "starts_on": starts, "ends_on": ends,
            "client": client, "period_end": period_end,
        }  # fmt: skip
        after = {
            "name": body.name, "owner": body.owner_user_id, "starts_on": body.starts_on,
            "ends_on": body.ends_on, "client": body.client_name, "period_end": body.period_end,
        }  # fmt: skip
        changed = sorted(
            key for key in after
            if after[key] != before[key] and not (key == "client" and same_client)
        )  # fmt: skip
        cursor.execute(
            """
            UPDATE projects
            SET name = %s, owner_user_id = %s, starts_on = %s, ends_on = %s,
                version = version + 1
            WHERE id = %s
            """,
            (body.name, body.owner_user_id, body.starts_on, body.ends_on, project_id),
        )
        if not launched:
            if not same_client:
                assign_client(
                    cursor, organization_id, project_id, principal.id,
                    client_id=body.client_id, name=body.client_name,
                )  # fmt: skip
            cursor.execute(
                """
                UPDATE engagement_settings
                SET period_end = %s, version = version + 1, updated_at = clock_timestamp()
                WHERE project_id = %s
                """,
                (body.period_end, project_id),
            )
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'project.updated', 'project', %s, %s)
            """,
            (
                organization_id, project_id, principal.id, project_id,
                Json({"status": str(status), "fields": changed}),
            ),
        )  # fmt: skip
    return _load_detail(connection, organization_id, project_id)


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
    if body.status != "DRAFT":
        # Every engagement starts as a draft; launching it from setup makes it active.
        raise ProjectLaunchRequired()
    if body.rollforward_from is not None:
        # The engagement it starts from is one the person can open.
        authorize(
            connection,
            principal=principal,
            action=Action.PROJECT_READ,
            organization_id=organization_id,
            project_id=body.rollforward_from,
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
        # The settings row comes from the projects trigger; the profile goes on it.
        cursor.execute(
            """
            UPDATE engagement_settings
            SET engagement_type = %s, period_end = %s, frameworks = %s,
                methodology = coalesce(%s, methodology),
                version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s
            """,
            (
                body.engagement_type,
                body.period_end,
                body.frameworks,
                body.methodology,
                project_id,
            ),
        )
        client_id = assign_client(
            cursor, organization_id, project_id, principal.id,
            client_id=body.client_id, name=body.client_name,
        )  # fmt: skip
        _audit(cursor, organization_id, project_id, principal.id, "project.created", body.status)
        if body.rollforward_from is not None:
            if client_id is None or client_of(cursor, body.rollforward_from) != client_id:
                raise ValueError("an engagement rolls forward from its own client's")
            copied = roll_forward(
                cursor, organization_id, body.rollforward_from, project_id, principal.id
            )
            cursor.execute(
                """
                INSERT INTO audit_events (
                    organization_id, project_id, actor_user_id, action, target_type,
                    target_id, payload
                )
                VALUES (%s, %s, %s, 'project.rolled_forward', 'project', %s, %s)
                """,
                (
                    organization_id, project_id, principal.id, project_id,
                    Json({"from": str(body.rollforward_from), **copied}),
                ),
            )  # fmt: skip
        if client_id is not None:
            carry_client_details(cursor, project_id, client_id, body.rollforward_from)
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
            WHERE id = %s AND organization_id = %s AND deleted_at IS NULL
            FOR UPDATE
            """,
            (project_id, organization_id),
        )
        current = cursor.fetchone()
        if current is None or not isinstance(current[0], str):
            raise NotVisible()
        if current[0] == "ARCHIVED":
            raise ProjectArchived()
        if current[0] == "DRAFT" and body.status in ("ACTIVE", "PAUSED"):
            raise ProjectLaunchRequired()
        if current[0] == "COMPLETED" and body.status != "ARCHIVED":
            # Its details are kept as completed; it is reopened by its own action.
            raise ProjectCompleted()
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
               p.status::text, p.starts_on, p.ends_on, p.version,
               coalesce(s.client_name, ''), s.period_end, s.kicked_off_at IS NOT NULL,
               s.client_id
        FROM projects AS p
        JOIN users AS u ON u.id = p.owner_user_id
        LEFT JOIN engagement_settings AS s ON s.project_id = p.id
        WHERE p.id = %s AND p.organization_id = %s AND p.deleted_at IS NULL
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
        client_name,
        period_end,
        launched,
        client_id,
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
        client_id=client_id if isinstance(client_id, UUID) else None,
        client_name=str(client_name),
        period_end=period_end if isinstance(period_end, date) else None,
        launched=launched is True,
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
    except ProjectLaunchRequired:
        raise HTTPException(
            status_code=409, detail="launch the engagement from setup to make it active"
        ) from None
    except ProjectArchived:
        raise HTTPException(
            status_code=409, detail="the engagement is archived and cannot change"
        ) from None
    except ProjectCompleted:
        raise HTTPException(
            status_code=409, detail="the engagement is completed; reopen it to change it"
        ) from None
    except ProjectConflict:
        raise HTTPException(status_code=409, detail="project slug is already in use") from None
    except ProjectVersionError:
        raise HTTPException(status_code=409, detail="project changed") from None
    except ProjectDetailsLocked:
        raise HTTPException(
            status_code=409, detail="client and period end are locked after launch"
        ) from None
    except ValueError:
        raise HTTPException(status_code=422, detail="project fields are invalid") from None
    return result
