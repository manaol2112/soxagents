"""Clients (Milestone 8.18).

A firm keeps a list of its clients, and each engagement belongs to one. A new engagement
for a client takes the client's details from its latest engagement (the email domains, the
evidence coordinator, the request cadence), and can start from one of its earlier
engagements: the roll-forward copies that engagement's setup into the new draft, for the
team to review in setup. Testing, evidence, plans, workpapers, deficiencies, and SOC
reports never carry over; they belong to the period they were done for.

The database keeps each engagement's copy of its client's name equal to the client's
(migration 0070), so a rename here renames the client on every engagement.
"""

from collections.abc import Callable
from datetime import date
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg import sql
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

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
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

_ORG_WIDE = (Role.OWNER, Role.ADMIN)


class ClientExists(Exception):
    """Another client in the firm already has this name."""


class ClientVersionError(Exception):
    """The client changed since the caller read it."""


class ClientEngagement(BaseModel):
    id: UUID
    name: str
    status: str
    period_end: date | None
    launched: bool


class ClientBody(BaseModel):
    id: UUID
    name: str
    version: int
    # The client's engagements the caller can open, newest first.
    engagements: list[ClientEngagement]


class ClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def folded(cls, value: str) -> str:
        return fold(value)


class ClientRename(ClientCreate):
    version: int = Field(ge=1)


def fold(name: str) -> str:
    """A client's name as kept: trimmed, with single spaces."""
    return " ".join(name.split())


def register_clients(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/clients"

    @app.get(base, response_model=list[ClientBody])
    def clients(organization_id: UUID, request: Request) -> list[ClientBody]:
        principal = _session_principal(request)
        return _run(settings, lambda c: list_clients(c, principal, organization_id))

    @app.post(base, response_model=ClientBody, status_code=201)
    def create(organization_id: UUID, body: ClientCreate, request: Request) -> ClientBody:
        principal = _session_principal(request)
        return _run(settings, lambda c: create_client(c, principal, organization_id, body))

    @app.patch(f"{base}/{{client_id}}", response_model=ClientBody)
    def rename(
        organization_id: UUID, client_id: UUID, body: ClientRename, request: Request
    ) -> ClientBody:
        principal = _session_principal(request)
        return _run(
            settings, lambda c: rename_client(c, principal, organization_id, client_id, body)
        )


def list_clients(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> list[ClientBody]:
    access = authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_CREATE,
        organization_id=organization_id,
    )
    with connection.cursor() as cursor:
        rows = cursor.execute(
            "SELECT id, name, version FROM clients WHERE organization_id = %s ORDER BY lower(name)",
            (organization_id,),
        ).fetchall()
        return [
            _body(cursor, organization_id, UUID(str(r[0])), str(r[1]), int(r[2]), access.role,
                  principal.id)
            for r in rows
        ]  # fmt: skip


def create_client(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    body: ClientCreate,
) -> ClientBody:
    access = authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_CREATE,
        organization_id=organization_id,
    )
    if body.name == "" or contains_secret({"client": body.name}):
        raise ValueError("client name is invalid")
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO clients (organization_id, name, created_by) VALUES (%s, %s, %s)
            ON CONFLICT (organization_id, lower(name)) DO NOTHING
            RETURNING id, version
            """,
            (organization_id, body.name, principal.id),
        ).fetchone()
        if row is None:
            raise ClientExists()
        _audit(cursor, organization_id, principal.id, "client.created", UUID(str(row[0])), {})
        return _body(cursor, organization_id, UUID(str(row[0])), body.name, int(row[1]),
                     access.role, principal.id)  # fmt: skip


def rename_client(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    client_id: UUID,
    body: ClientRename,
) -> ClientBody:
    """A rename reaches every engagement of the client, including ones the caller cannot
    open, so it is for an owner or admin."""
    access = authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_CREATE,
        organization_id=organization_id,
    )
    if access.role not in _ORG_WIDE:
        raise AccessDenied()
    if body.name == "" or contains_secret({"client": body.name}):
        raise ValueError("client name is invalid")
    with transaction(connection) as cursor:
        current = cursor.execute(
            "SELECT version FROM clients WHERE id = %s AND organization_id = %s FOR UPDATE",
            (client_id, organization_id),
        ).fetchone()
        if current is None:
            raise NotVisible()
        if int(current[0]) != body.version:
            raise ClientVersionError()
        try:
            cursor.execute(
                """
                UPDATE clients SET name = %s, version = version + 1,
                       updated_at = clock_timestamp()
                WHERE id = %s
                """,
                (body.name, client_id),
            )
        except psycopg.errors.UniqueViolation:
            raise ClientExists() from None
        _audit(cursor, organization_id, principal.id, "client.renamed", client_id, {})
        return _body(cursor, organization_id, client_id, body.name, body.version + 1,
                     access.role, principal.id)  # fmt: skip


# Used by engagement creation, the edit form, and setup's profile step.


def assign_client(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    *,
    client_id: UUID | None = None,
    name: str = "",
) -> UUID | None:
    """Put the engagement with a client: the one named by id, else the firm's client of
    that name (case and spacing aside), created if it is new. No name and no id leaves it
    without a client."""
    if client_id is not None:
        found = cursor.execute(
            "SELECT id FROM clients WHERE id = %s AND organization_id = %s",
            (client_id, organization_id),
        ).fetchone()
        if found is None:
            raise NotVisible()
        chosen: UUID | None = client_id
    else:
        folded = fold(name)
        if folded == "":
            chosen = None
        else:
            if contains_secret({"client": folded}):
                raise ValueError("client name is invalid")
            cursor.execute(
                """
                INSERT INTO clients (organization_id, name, created_by) VALUES (%s, %s, %s)
                ON CONFLICT (organization_id, lower(name)) DO NOTHING
                """,
                (organization_id, folded, actor_id),
            )
            row = cursor.execute(
                "SELECT id FROM clients WHERE organization_id = %s AND lower(name) = lower(%s)",
                (organization_id, folded),
            ).fetchone()
            if row is None:
                raise NotVisible()
            chosen = UUID(str(row[0]))
    cursor.execute(
        """
        UPDATE engagement_settings SET client_id = %s, version = version + 1,
               updated_at = clock_timestamp()
        WHERE project_id = %s
        """,
        (chosen, project_id),
    )
    return chosen


def client_of(cursor: psycopg.Cursor[Any], project_id: UUID) -> UUID | None:
    row = cursor.execute(
        "SELECT client_id FROM engagement_settings WHERE project_id = %s", (project_id,)
    ).fetchone()
    return None if row is None or row[0] is None else UUID(str(row[0]))


def carry_client_details(
    cursor: psycopg.Cursor[Any], project_id: UUID, client_id: UUID, source: UUID | None
) -> None:
    """A new engagement takes its client's details from an earlier engagement: the one it
    rolls forward from, else the client's latest. Nothing to take for a new client."""
    if source is None:
        row = cursor.execute(
            """
            SELECT s.project_id FROM engagement_settings s
            JOIN projects p ON p.id = s.project_id
            WHERE s.client_id = %s AND s.project_id <> %s AND p.deleted_at IS NULL
            ORDER BY p.created_at DESC LIMIT 1
            """,
            (client_id, project_id),
        ).fetchone()
        if row is None:
            return
        source = UUID(str(row[0]))
    cursor.execute(
        """
        UPDATE engagement_settings t
        SET client_domains = s.client_domains,
            client_coordinator_name = s.client_coordinator_name,
            client_coordinator_email = s.client_coordinator_email,
            pbc_due_days = s.pbc_due_days,
            pbc_follow_up_days = s.pbc_follow_up_days,
            pbc_max_follow_ups = s.pbc_max_follow_ups,
            version = t.version + 1, updated_at = clock_timestamp()
        FROM engagement_settings s
        WHERE t.project_id = %s AND s.project_id = %s
        """,
        (project_id, source),
    )


def roll_forward(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    source: UUID,
    target: UUID,
    actor_id: UUID,
) -> dict[str, int]:
    """Copy an earlier engagement's setup into a new draft: its kind of engagement, its
    scope, its systems and processes, its controls with their owners, attributes, and
    client values, its firm templates and whether they were confirmed, and its team.
    Nothing done for its period comes along."""
    # Templates confirmed on the earlier engagement are the same templates here: the
    # confirmation carries, recorded as the person rolling forward, now.
    confirmed = cursor.execute(
        """
        UPDATE engagement_settings t
        SET engagement_type = s.engagement_type,
            templates_confirmed_at = CASE WHEN s.templates_confirmed_at IS NULL THEN NULL
                                          ELSE clock_timestamp() END,
            templates_confirmed_by = CASE WHEN s.templates_confirmed_at IS NULL THEN NULL
                                          ELSE %s::uuid END,
            version = t.version + 1, updated_at = clock_timestamp()
        FROM engagement_settings s
        WHERE t.project_id = %s AND s.project_id = %s
        RETURNING t.templates_confirmed_at IS NOT NULL
        """,
        (actor_id, target, source),
    ).fetchone()
    # The scope is last period's words to start from; the planner suggests changes to it.
    scoped = cursor.execute(
        """
        UPDATE projects t SET scope = s.scope, version = t.version + 1,
            updated_at = clock_timestamp()
        FROM projects s
        WHERE t.id = %s AND s.id = %s AND btrim(t.scope) = '' AND btrim(s.scope) <> ''
        RETURNING t.id
        """,
        (target, source),
    ).fetchone()
    moved = {"project_id": target}
    processes = _copy(cursor, "engagement_processes", source, lambda _row: moved)
    systems = _copy(cursor, "engagement_applications", source, lambda _row: moved)
    imports = _copy(
        cursor,
        "rcm_imports",
        source,
        lambda _row: {**moved, "systems_model_call_id": None, "terms_model_call_id": None},
        only="id IN (SELECT rcm_import_id FROM engagement_controls WHERE project_id = %s)",
    )

    def control(row: dict[str, Any]) -> dict[str, Any]:
        app = row["engagement_application_id"]
        return {
            **moved,
            "engagement_application_id": None if app is None else systems.get(UUID(str(app))),
            "application_ids": [
                systems[UUID(str(a))] for a in row["application_ids"] if UUID(str(a)) in systems
            ],
            "process_id": None
            if row["process_id"] is None
            else processes.get(UUID(str(row["process_id"]))),
            "rcm_import_id": None
            if row["rcm_import_id"] is None
            else imports.get(UUID(str(row["rcm_import_id"]))),
        }

    controls = _copy(cursor, "engagement_controls", source, control)

    def parameter(row: dict[str, Any]) -> dict[str, Any]:
        return {**moved, "engagement_control_id": controls[UUID(str(row["engagement_control_id"]))]}

    _copy(cursor, "control_parameters", source, parameter)
    templates = _copy(
        cursor, "workpaper_templates", source, lambda _row: {**moved, "uploaded_by": actor_id}
    )
    # The team: everyone still active in the firm, in the roles they held.
    members = cursor.execute(
        """
        INSERT INTO project_memberships (organization_id, project_id, user_id, engagement_role)
        SELECT pm.organization_id, %s, pm.user_id, pm.engagement_role
        FROM project_memberships pm
        JOIN memberships m ON m.organization_id = pm.organization_id AND m.user_id = pm.user_id
        WHERE pm.project_id = %s AND m.status = 'ACTIVE'
        ON CONFLICT (project_id, user_id) DO NOTHING
        RETURNING user_id
        """,
        (target, source),
    ).fetchall()
    cursor.execute(
        """
        INSERT INTO project_member_roles (project_id, user_id, engagement_role)
        SELECT %s, r.user_id, r.engagement_role
        FROM project_member_roles r
        JOIN project_memberships pm ON pm.project_id = %s AND pm.user_id = r.user_id
        WHERE r.project_id = %s
        ON CONFLICT (project_id, user_id, engagement_role) DO NOTHING
        """,
        (target, target, source),
    )
    return {
        "systems": len(systems),
        "processes": len(processes),
        "controls": len(controls),
        "templates": len(templates),
        "templates_confirmed": int(confirmed is not None and bool(confirmed[0])),
        "scope": int(scoped is not None),
        "members_added": len(members),
    }


def _copy(
    cursor: psycopg.Cursor[Any],
    table: str,
    source: UUID,
    overrides: Callable[[dict[str, Any]], dict[str, Any]],
    only: str = "",
) -> dict[UUID, UUID]:
    """Copy a project's rows of a table, each with a new id and the given columns changed;
    every other column is copied as it is, so a column added later comes along too.
    Returns the new id of each old one."""
    described = [
        (str(row[0]), str(row[1]))
        for row in cursor.execute(
            """
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
              AND column_name NOT IN ('id', 'created_at', 'updated_at')
              AND is_generated = 'NEVER'
            ORDER BY ordinal_position
            """,
            (table,),
        ).fetchall()
    ]
    columns = [name for name, _kind in described]
    # JSON columns come back as Python values and go back as JSON.
    json_columns = {name for name, kind in described if kind in ("json", "jsonb")}
    where: sql.Composable = sql.SQL("project_id = %s")
    params: list[Any] = [source]
    if only:
        where = sql.SQL("project_id = %s AND ") + sql.SQL(only)  # type: ignore[arg-type,unused-ignore]
        params.append(source)
    rows = cursor.execute(
        sql.SQL("SELECT id, {} FROM {} WHERE {} ORDER BY id").format(
            sql.SQL(", ").join(sql.Identifier(c) for c in columns),
            sql.Identifier(table),
            where,
        ),
        params,
    ).fetchall()
    mapping: dict[UUID, UUID] = {}
    for row in rows:
        old = UUID(str(row[0]))
        values = dict(zip(columns, row[1:], strict=True))
        values.update(overrides(values))
        new = cursor.execute(
            sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING id").format(
                sql.Identifier(table),
                sql.SQL(", ").join(sql.Identifier(c) for c in columns),
                sql.SQL(", ").join(sql.Placeholder() for _ in columns),
            ),
            [
                Json(values[c]) if c in json_columns and values[c] is not None else values[c]
                for c in columns
            ],
        ).fetchone()
        if new is not None:
            mapping[old] = UUID(str(new[0]))
    return mapping


def _body(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    client_id: UUID,
    name: str,
    version: int,
    role: Role,
    user_id: UUID,
) -> ClientBody:
    rows = cursor.execute(
        """
        SELECT p.id, p.name, p.status::text, s.period_end, s.kicked_off_at IS NOT NULL
        FROM engagement_settings s JOIN projects p ON p.id = s.project_id
        WHERE s.client_id = %s AND p.organization_id = %s AND p.deleted_at IS NULL
          AND (%s OR EXISTS (
              SELECT 1 FROM project_memberships pm
              WHERE pm.project_id = p.id AND pm.user_id = %s
          ))
        ORDER BY p.created_at DESC
        """,
        (client_id, organization_id, role in _ORG_WIDE, user_id),
    ).fetchall()
    return ClientBody(
        id=client_id,
        name=name,
        version=version,
        engagements=[
            ClientEngagement(
                id=r[0], name=str(r[1]), status=str(r[2]), period_end=r[3], launched=r[4] is True
            )
            for r in rows
        ],
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    actor_id: UUID,
    action: str,
    client_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (organization_id, actor_user_id, action, target_type,
                                  target_id, payload)
        VALUES (%s, %s, %s, 'client', %s, %s)
        """,
        (organization_id, actor_id, action, client_id, Json(payload)),
    )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        result: T = _call(settings, work)
    except ClientExists:
        raise HTTPException(status_code=409, detail="client exists") from None
    except ClientVersionError:
        raise HTTPException(status_code=409, detail="client changed") from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    return result
