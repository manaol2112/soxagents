"""Deny-by-default authorization.

The session identifies the caller. Role and tenant come from active membership rows.
A client-supplied organization id is accepted only after that lookup succeeds.
Agents are not principals and cannot grant privileges. A user cannot change their own membership.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.db import ConcurrentUpdateError, connect, require_one_row, transaction
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)


class Role(StrEnum):
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    PROJECT_MANAGER = "PROJECT_MANAGER"
    REVIEWER = "REVIEWER"
    CONTRIBUTOR = "CONTRIBUTOR"


class Action(StrEnum):
    ORGANIZATION_READ = "organization.read"
    ORGANIZATION_UPDATE = "organization.update"
    MEMBERSHIP_READ = "membership.read"
    MEMBERSHIP_GRANT = "membership.grant"
    PROJECT_READ = "project.read"
    PROJECT_CREATE = "project.create"
    PROJECT_UPDATE = "project.update"
    TASK_READ = "task.read"
    TASK_UPDATE = "task.update"
    AGENT_READ = "agent.read"
    AGENT_UPDATE = "agent.update"


class PrincipalKind(StrEnum):
    USER = "USER"
    AGENT = "AGENT"


class AccessDenied(Exception):
    """The caller is inside the tenant, and the action is not allowed."""


class NotVisible(Exception):
    """The caller has no active access to this tenant or record."""


class MembershipConflict(Exception):
    """The user is already a member of the organization."""


@dataclass(frozen=True)
class Principal:
    kind: PrincipalKind
    id: UUID


@dataclass(frozen=True)
class Access:
    user_id: UUID
    organization_id: UUID
    role: Role
    project_id: UUID | None


@dataclass(frozen=True)
class OrganizationRecord:
    id: UUID
    name: str
    slug: str
    role: Role


@dataclass(frozen=True)
class ProjectRecord:
    id: UUID
    name: str
    slug: str
    status: str
    # What the engagements page shows on each card: the client, the kind of audit, the
    # period, the owner, and how much is in scope.
    client_name: str = ""
    engagement_type: str = ""
    period_end: date | None = None
    owner_name: str = ""
    controls: int = 0
    open_deficiencies: int = 0
    client_id: UUID | None = None
    # Where the work stands, for the card (engagements page): agent tasks by status,
    # evidence past due by the metrics rulebook, the next milestone, and the last activity.
    task_counts: tuple[tuple[str, int], ...] = ()
    overdue_requests: int = 0
    next_milestone: str = ""
    next_milestone_due: date | None = None
    missed_milestones: int = 0
    last_activity_at: datetime | None = None


@dataclass(frozen=True)
class MembershipRecord:
    user_id: UUID
    email: str
    role: Role
    status: str
    version: int


@dataclass(frozen=True)
class _Membership:
    id: UUID
    role: Role
    status: str
    version: int


_PROJECT_ACTIONS = frozenset(
    {
        Action.PROJECT_READ,
        Action.PROJECT_UPDATE,
        Action.TASK_READ,
        Action.TASK_UPDATE,
    }
)
_ORG_WIDE_PROJECT_ACCESS = frozenset({Role.OWNER, Role.ADMIN})
_ROLE_ACTIONS: dict[Role, frozenset[Action]] = {
    Role.OWNER: frozenset(Action),
    Role.ADMIN: frozenset(Action),
    Role.PROJECT_MANAGER: frozenset(
        {
            Action.ORGANIZATION_READ,
            Action.PROJECT_READ,
            Action.PROJECT_CREATE,
            Action.PROJECT_UPDATE,
            Action.TASK_READ,
            Action.TASK_UPDATE,
            Action.AGENT_READ,
        }
    ),
    Role.REVIEWER: frozenset(
        {
            Action.ORGANIZATION_READ,
            Action.PROJECT_READ,
            Action.TASK_READ,
            Action.AGENT_READ,
        }
    ),
    Role.CONTRIBUTOR: frozenset(
        {
            Action.ORGANIZATION_READ,
            Action.PROJECT_READ,
            Action.TASK_READ,
            Action.TASK_UPDATE,
            Action.AGENT_READ,
        }
    ),
}
_GRANTABLE: dict[Role, frozenset[Role]] = {
    Role.OWNER: frozenset(Role),
    Role.ADMIN: frozenset({Role.PROJECT_MANAGER, Role.REVIEWER, Role.CONTRIBUTOR}),
}


class MembershipGrantBody(BaseModel):
    user_id: UUID
    role: Role


class MembershipUpdateBody(BaseModel):
    role: Role
    status: str = Field(pattern="^(ACTIVE|DISABLED)$")
    version: int = Field(ge=1)


class OrganizationBody(BaseModel):
    id: UUID
    name: str
    slug: str
    role: Role


class TaskCountBody(BaseModel):
    status: str
    count: int


class MilestoneDueBody(BaseModel):
    name: str
    due: date


class ProjectBody(BaseModel):
    id: UUID
    name: str
    slug: str
    status: str
    # The firm's client it belongs to (Milestone 8.18).
    client_id: UUID | None = None
    client_name: str = ""
    engagement_type: str = ""
    period_end: date | None = None
    owner_name: str = ""
    controls: int = 0
    open_deficiencies: int = 0
    progress: list[TaskCountBody] = Field(default_factory=list)
    overdue_requests: int = 0
    next_milestone: MilestoneDueBody | None = None
    missed_milestones: int = 0
    last_activity_at: datetime | None = None


class MembershipBody(BaseModel):
    user_id: UUID
    email: str
    role: Role
    status: str
    version: int


def authorize(
    connection: psycopg.Connection[Any],
    *,
    principal: Principal,
    action: Action,
    organization_id: UUID,
    project_id: UUID | None = None,
) -> Access:
    """Allow the action only when an active membership grants it. Unknown actions are absent."""
    membership = _require_user_membership(connection, principal, organization_id)
    if action in _PROJECT_ACTIONS and (
        project_id is None
        or not _project_visible(
            connection, principal.id, organization_id, project_id, membership.role
        )
    ):
        raise NotVisible()
    if action not in _ROLE_ACTIONS[membership.role]:
        raise AccessDenied()
    return Access(
        user_id=principal.id,
        organization_id=organization_id,
        role=membership.role,
        project_id=project_id,
    )


def permits(
    connection: psycopg.Connection[Any],
    *,
    principal: Principal,
    action: Action,
    organization_id: UUID,
    project_id: UUID | None = None,
) -> bool:
    """Return whether the caller holds the action. A missing tenant still raises NotVisible."""
    try:
        authorize(
            connection,
            principal=principal,
            action=action,
            organization_id=organization_id,
            project_id=project_id,
        )
    except AccessDenied:
        return False
    return True


def list_organizations(
    connection: psycopg.Connection[Any], principal: Principal
) -> list[OrganizationRecord]:
    _require_user(principal)
    rows = connection.execute(
        """
        SELECT o.id, o.name, o.slug, m.role::text
        FROM memberships AS m
        JOIN organizations AS o ON o.id = m.organization_id
        JOIN users AS u ON u.id = m.user_id
        WHERE m.user_id = %s
          AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
          AND o.status = 'ACTIVE'
        ORDER BY o.slug
        """,
        (principal.id,),
    ).fetchall()
    return [_organization_record(row) for row in rows]


def list_projects(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> list[ProjectRecord]:
    # Overdue by the metrics rulebook: sent or partly received, and past its due date.
    from ai_workforce_api.engagement_data import OVERDUE_GROUPS, REQUEST_GROUPS

    late = [status for status, group in REQUEST_GROUPS.items() if group in OVERDUE_GROUPS]
    membership = _require_user_membership(connection, principal, organization_id)
    rows = connection.execute(
        """
        SELECT p.id, p.name, p.slug, p.status::text,
               coalesce(s.client_name, ''), coalesce(s.engagement_type, ''), s.period_end,
               coalesce(u.display_name, ''),
               (SELECT count(*) FROM engagement_controls c
                WHERE c.project_id = p.id AND c.included),
               (SELECT count(*) FROM deficiencies d
                WHERE d.project_id = p.id AND d.status <> 'CLOSED'),
               s.client_id,
               (SELECT coalesce(json_agg(json_build_object('status', t.status, 'count', t.n)
                                         ORDER BY t.status), '[]'::json)
                FROM (SELECT status::text AS status, count(*) AS n FROM tasks
                      WHERE organization_id = p.organization_id AND project_id = p.id
                      GROUP BY status) AS t),
               (SELECT count(*) FROM pbc_requests r
                WHERE r.organization_id = p.organization_id AND r.project_id = p.id
                  AND r.status::text = ANY(%s) AND r.due_at < transaction_timestamp()),
               (SELECT json_build_object('name', m.name, 'due', m.due_date)
                FROM engagement_milestones m
                WHERE m.project_id = p.id AND m.completed_at IS NULL
                ORDER BY m.due_date, m.position LIMIT 1),
               (SELECT count(*) FROM engagement_milestones m
                WHERE m.project_id = p.id AND m.completed_at IS NULL AND m.due_date < %s),
               (SELECT max(e.occurred_at) FROM audit_events e
                WHERE e.organization_id = p.organization_id AND e.project_id = p.id)
        FROM projects AS p
        LEFT JOIN engagement_settings AS s ON s.project_id = p.id
        LEFT JOIN users AS u ON u.id = p.owner_user_id
        WHERE p.organization_id = %s AND p.deleted_at IS NULL
          AND (
            %s
            OR EXISTS (
                SELECT 1
                FROM project_memberships AS pm
                WHERE pm.project_id = p.id
                  AND pm.organization_id = p.organization_id
                  AND pm.user_id = %s
            )
          )
        ORDER BY p.slug
        """,
        (
            late,
            datetime.now(UTC).date(),
            organization_id,
            membership.role in _ORG_WIDE_PROJECT_ACCESS,
            principal.id,
        ),
    ).fetchall()
    return [_project_record(row) for row in rows]


def list_memberships(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> list[MembershipRecord]:
    authorize(
        connection,
        principal=principal,
        action=Action.MEMBERSHIP_READ,
        organization_id=organization_id,
    )
    rows = connection.execute(
        """
        SELECT m.user_id, u.email::text, m.role::text, m.status::text, m.version
        FROM memberships AS m
        JOIN users AS u ON u.id = m.user_id
        WHERE m.organization_id = %s
        ORDER BY u.email
        """,
        (organization_id,),
    ).fetchall()
    return [_membership_record(row) for row in rows]


def grant_membership(
    connection: psycopg.Connection[Any],
    *,
    principal: Principal,
    organization_id: UUID,
    target_user_id: UUID,
    role: Role,
) -> MembershipRecord:
    _reject_self_or_agent(principal, target_user_id)
    with transaction(connection) as cursor:
        actor = _lock_membership(cursor, principal.id, organization_id)
        if actor is None or not _principal_is_active(cursor, principal.id, organization_id):
            raise NotVisible()
        if role not in _GRANTABLE.get(actor.role, frozenset()):
            raise AccessDenied()
        if _lock_user_status(cursor, target_user_id) != "ACTIVE":
            raise NotVisible()
        if _lock_membership(cursor, target_user_id, organization_id) is not None:
            raise MembershipConflict()
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            (organization_id, target_user_id, role.value),
        )
        created = cursor.fetchone()
        if created is None or not isinstance(created[0], UUID):
            raise AccessDenied()
        _audit(cursor, organization_id, principal.id, created[0], role.value, "ACTIVE")
        email = _user_email(cursor, target_user_id)
    return MembershipRecord(
        user_id=target_user_id, email=email, role=role, status="ACTIVE", version=1
    )


def update_membership(
    connection: psycopg.Connection[Any],
    *,
    principal: Principal,
    organization_id: UUID,
    target_user_id: UUID,
    role: Role,
    status: str,
    version: int,
) -> MembershipRecord:
    _reject_self_or_agent(principal, target_user_id)
    with transaction(connection) as cursor:
        actor = _lock_membership(cursor, principal.id, organization_id)
        if actor is None or not _principal_is_active(cursor, principal.id, organization_id):
            raise NotVisible()
        current = _lock_membership(cursor, target_user_id, organization_id)
        if current is None:
            raise NotVisible()
        grantable = _GRANTABLE.get(actor.role, frozenset())
        if current.role not in grantable or role not in grantable:
            raise AccessDenied()
        cursor.execute(
            """
            UPDATE memberships
            SET role = %s, status = %s, version = version + 1
            WHERE organization_id = %s AND user_id = %s AND version = %s
            RETURNING version
            """,
            (role.value, status, organization_id, target_user_id, version),
        )
        require_one_row(cursor)
        updated = cursor.fetchone()
        if updated is None or not isinstance(updated[0], int):
            raise AccessDenied()
        _audit(cursor, organization_id, principal.id, current.id, role.value, status)
        email = _user_email(cursor, target_user_id)
        new_version = updated[0]
    return MembershipRecord(
        user_id=target_user_id,
        email=email,
        role=role,
        status=status,
        version=new_version,
    )


def register_authorization(app: FastAPI, settings: Settings) -> None:
    @app.get("/organizations", response_model=list[OrganizationBody])
    def organizations(request: Request) -> list[OrganizationBody]:
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> list[OrganizationBody]:
            return [_organization_body(row) for row in list_organizations(connection, principal)]

        return _call(settings, work)

    @app.get("/organizations/{organization_id}/projects", response_model=list[ProjectBody])
    def projects(organization_id: UUID, request: Request) -> list[ProjectBody]:
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> list[ProjectBody]:
            return [
                _project_body(row) for row in list_projects(connection, principal, organization_id)
            ]

        return _call(settings, work)

    @app.get("/organizations/{organization_id}/memberships", response_model=list[MembershipBody])
    def memberships(organization_id: UUID, request: Request) -> list[MembershipBody]:
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> list[MembershipBody]:
            return [
                _membership_body(row)
                for row in list_memberships(connection, principal, organization_id)
            ]

        return _call(settings, work)

    @app.post(
        "/organizations/{organization_id}/memberships",
        response_model=MembershipBody,
        status_code=201,
    )
    def grant(organization_id: UUID, body: MembershipGrantBody, request: Request) -> MembershipBody:
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> MembershipBody:
            return _membership_body(
                grant_membership(
                    connection,
                    principal=principal,
                    organization_id=organization_id,
                    target_user_id=body.user_id,
                    role=body.role,
                )
            )

        return _call(settings, work)

    @app.patch(
        "/organizations/{organization_id}/memberships/{user_id}",
        response_model=MembershipBody,
    )
    def change_membership(
        organization_id: UUID,
        user_id: UUID,
        body: MembershipUpdateBody,
        request: Request,
    ) -> MembershipBody:
        principal = _session_principal(request)

        def work(connection: psycopg.Connection[Any]) -> MembershipBody:
            return _membership_body(
                update_membership(
                    connection,
                    principal=principal,
                    organization_id=organization_id,
                    target_user_id=user_id,
                    role=body.role,
                    status=body.status,
                    version=body.version,
                )
            )

        return _call(settings, work)


def _require_user(principal: Principal) -> None:
    if principal.kind is not PrincipalKind.USER:
        raise AccessDenied()


def _require_user_membership(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> _Membership:
    _require_user(principal)
    row = connection.execute(
        """
        SELECT m.id, m.role::text, m.status::text, m.version
        FROM memberships AS m
        JOIN users AS u ON u.id = m.user_id
        JOIN organizations AS o ON o.id = m.organization_id
        WHERE m.organization_id = %s
          AND m.user_id = %s
          AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
          AND o.status = 'ACTIVE'
        """,
        (organization_id, principal.id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _membership_from_row(row)


def _project_visible(
    connection: psycopg.Connection[Any],
    user_id: UUID,
    organization_id: UUID,
    project_id: UUID,
    role: Role,
) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM projects AS p
        WHERE p.id = %s
          AND p.organization_id = %s
          AND p.deleted_at IS NULL
          AND (
            %s
            OR EXISTS (
                SELECT 1
                FROM project_memberships AS pm
                WHERE pm.project_id = p.id
                  AND pm.organization_id = p.organization_id
                  AND pm.user_id = %s
            )
          )
        """,
        (project_id, organization_id, role in _ORG_WIDE_PROJECT_ACCESS, user_id),
    ).fetchone()
    return row is not None


def _reject_self_or_agent(principal: Principal, target_user_id: UUID) -> None:
    if principal.kind is not PrincipalKind.USER or principal.id == target_user_id:
        raise AccessDenied()


def _principal_is_active(cursor: psycopg.Cursor[Any], user_id: UUID, organization_id: UUID) -> bool:
    cursor.execute(
        """
        SELECT 1
        FROM memberships AS m
        JOIN users AS u ON u.id = m.user_id
        JOIN organizations AS o ON o.id = m.organization_id
        WHERE m.organization_id = %s
          AND m.user_id = %s
          AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
          AND o.status = 'ACTIVE'
        """,
        (organization_id, user_id),
    )
    return cursor.fetchone() is not None


def _lock_membership(
    cursor: psycopg.Cursor[Any], user_id: UUID, organization_id: UUID
) -> _Membership | None:
    cursor.execute(
        """
        SELECT id, role::text, status::text, version
        FROM memberships
        WHERE organization_id = %s AND user_id = %s
        FOR UPDATE
        """,
        (organization_id, user_id),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    return _membership_from_row(row)


def _lock_user_status(cursor: psycopg.Cursor[Any], user_id: UUID) -> str | None:
    cursor.execute("SELECT status::text FROM users WHERE id = %s FOR UPDATE", (user_id,))
    row = cursor.fetchone()
    if row is None or not isinstance(row[0], str):
        return None
    return row[0]


def _user_email(cursor: psycopg.Cursor[Any], user_id: UUID) -> str:
    cursor.execute("SELECT email::text FROM users WHERE id = %s", (user_id,))
    row = cursor.fetchone()
    if row is None or not isinstance(row[0], str):
        raise NotVisible()
    return row[0]


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    actor_user_id: UUID,
    membership_id: UUID,
    role: str,
    status: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, 'membership.grant', 'membership', %s, %s)
        """,
        (organization_id, actor_user_id, membership_id, Json({"role": role, "status": status})),
    )


def _membership_from_row(row: tuple[Any, ...]) -> _Membership:
    membership_id, role, status, version = row
    if (
        not isinstance(membership_id, UUID)
        or not isinstance(role, str)
        or not isinstance(status, str)
        or not isinstance(version, int)
    ):
        raise AccessDenied()
    return _Membership(id=membership_id, role=Role(role), status=status, version=version)


def _organization_record(row: tuple[Any, ...]) -> OrganizationRecord:
    organization_id, name, slug, role = row
    if (
        not isinstance(organization_id, UUID)
        or not isinstance(name, str)
        or not isinstance(slug, str)
    ):
        raise NotVisible()
    if not isinstance(role, str):
        raise NotVisible()
    return OrganizationRecord(id=organization_id, name=name, slug=slug, role=Role(role))


def _project_record(row: tuple[Any, ...]) -> ProjectRecord:
    project_id, name, slug, status = row[:4]
    if (
        not isinstance(project_id, UUID)
        or not isinstance(name, str)
        or not isinstance(slug, str)
        or not isinstance(status, str)
    ):
        raise NotVisible()
    extra = row[4:]
    if len(extra) < 6:
        return ProjectRecord(id=project_id, name=name, slug=slug, status=status)
    return ProjectRecord(
        id=project_id,
        name=name,
        slug=slug,
        status=status,
        client_name=str(extra[0] or ""),
        engagement_type=str(extra[1] or ""),
        period_end=extra[2] if isinstance(extra[2], date) else None,
        owner_name=str(extra[3] or ""),
        controls=int(extra[4] or 0),
        open_deficiencies=int(extra[5] or 0),
        client_id=extra[6] if len(extra) > 6 and isinstance(extra[6], UUID) else None,
        **(_work_fields(extra[7:]) if len(extra) > 11 else {}),
    )


def _work_fields(extra: tuple[Any, ...]) -> dict[str, Any]:
    """Where an engagement's work stands, as list_projects reads it for the card."""
    tasks, overdue, milestone, missed, last = extra
    counts = tuple(
        (str(item["status"]), int(item["count"]))
        for item in (tasks if isinstance(tasks, list) else [])
        if isinstance(item, dict)
    )
    due = milestone.get("due") if isinstance(milestone, dict) else None
    return {
        "task_counts": counts,
        "overdue_requests": int(overdue or 0),
        "next_milestone": str(milestone.get("name", "")) if isinstance(milestone, dict) else "",
        "next_milestone_due": date.fromisoformat(due) if isinstance(due, str) else None,
        "missed_milestones": int(missed or 0),
        "last_activity_at": last if isinstance(last, datetime) else None,
    }


def _membership_record(row: tuple[Any, ...]) -> MembershipRecord:
    user_id, email, role, status, version = row
    if (
        not isinstance(user_id, UUID)
        or not isinstance(email, str)
        or not isinstance(role, str)
        or not isinstance(status, str)
        or not isinstance(version, int)
    ):
        raise NotVisible()
    return MembershipRecord(
        user_id=user_id, email=email, role=Role(role), status=status, version=version
    )


def _organization_body(record: OrganizationRecord) -> OrganizationBody:
    return OrganizationBody(id=record.id, name=record.name, slug=record.slug, role=record.role)


def _project_body(record: ProjectRecord) -> ProjectBody:
    return ProjectBody(
        id=record.id,
        name=record.name,
        slug=record.slug,
        status=record.status,
        client_id=record.client_id,
        client_name=record.client_name,
        engagement_type=record.engagement_type,
        period_end=record.period_end,
        owner_name=record.owner_name,
        controls=record.controls,
        open_deficiencies=record.open_deficiencies,
        progress=[
            TaskCountBody(status=status, count=count) for status, count in record.task_counts
        ],
        overdue_requests=record.overdue_requests,
        next_milestone=(
            MilestoneDueBody(name=record.next_milestone, due=record.next_milestone_due)
            if record.next_milestone_due is not None
            else None
        ),
        missed_milestones=record.missed_milestones,
        last_activity_at=record.last_activity_at,
    )


def _membership_body(record: MembershipRecord) -> MembershipBody:
    return MembershipBody(
        user_id=record.user_id,
        email=record.email,
        role=record.role,
        status=record.status,
        version=record.version,
    )


def _session_principal(request: Request) -> Principal:
    user_id = request.state.user_id
    if not isinstance(user_id, UUID):
        raise HTTPException(status_code=401, detail="authentication required")
    return Principal(kind=PrincipalKind.USER, id=user_id)


def _call[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    if settings.database_url == "":
        raise HTTPException(status_code=503, detail="authorization unavailable")
    try:
        with connect(settings.database_url) as connection:
            result: T = work(connection)
            return result
    except NotVisible:
        raise HTTPException(status_code=404, detail="not found") from None
    except AccessDenied:
        raise HTTPException(status_code=403, detail="not allowed") from None
    except MembershipConflict:
        raise HTTPException(status_code=409, detail="membership already exists") from None
    except ConcurrentUpdateError:
        raise HTTPException(status_code=409, detail="membership changed") from None
    except psycopg.Error as error:
        # The class and SQLSTATE only: server messages can carry row values.
        logger.warning(
            "authorization query failed: %s %s %s",
            type(error).__name__,
            error.sqlstate or "",
            error.diag.constraint_name or "",
        )
        raise HTTPException(status_code=503, detail="authorization unavailable") from None
