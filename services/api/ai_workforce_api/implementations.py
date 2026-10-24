"""Where a control operates (Unified planning, Release 1; docs/unified-planning-r1.md).

An implementation is an engagement control row: the control as it operates somewhere. A
system-based control already has one per system (control_instances.py). Any control may
also operate in, or merely cover, the engagement's other scope units: legal entities,
locations, departments or operating units, shared-service centres, and processes or
sub-processes (migration 0104). All of it is optional; most controls have none.

- OPERATES: the control runs separately there; each combination is its own
  implementation, planned, requested, tested and concluded on its own. Splitting a
  control so is a person's decision (the engagement lead or an authorized reviewer;
  decided by the product owner), never automatic, and never only because several
  entities are in scope.
- COVERS: the control is run once, centrally, and covers the unit; it stays one
  implementation.

The database keeps each row's implementation key (its system and operating units), so a
control and implementation is one row.
"""

from typing import Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.db import transaction

UnitKind = Literal["ENTITY", "LOCATION", "DEPARTMENT", "SERVICE_CENTER", "PROCESS"]
UNIT_KINDS: tuple[UnitKind, ...] = ("ENTITY", "LOCATION", "DEPARTMENT", "SERVICE_CENTER", "PROCESS")
KIND_LABELS: dict[str, str] = {
    "ENTITY": "Legal entity",
    "LOCATION": "Location",
    "DEPARTMENT": "Department or operating unit",
    "SERVICE_CENTER": "Shared-service centre",
    "PROCESS": "Process or sub-process",
}


class ImplementationState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class ScopeUnit(BaseModel):
    id: UUID
    kind: UnitKind
    kind_label: str
    name: str
    # How many in-scope controls operate in it, and how many cover it.
    operating: int = 0
    covering: int = 0


class UnitCreate(BaseModel):
    kind: UnitKind
    name: str = Field(min_length=1, max_length=200)


class CoverageBody(BaseModel):
    """The units a central control covers. Replaces what it covered before."""

    unit_ids: list[UUID] = Field(default_factory=list, max_length=200)


class SplitBody(BaseModel):
    """Operate the control separately in each unit: the control itself takes the first,
    and each other gets an implementation of its own. Why, for the record."""

    unit_ids: list[UUID] = Field(min_length=2, max_length=50)
    reason: str = Field(min_length=10, max_length=1000)


class Scope(BaseModel):
    """An implementation's scope, as a plan decision records it."""

    application: str | None = None
    operates: list[str] = Field(default_factory=list)
    covers: list[str] = Field(default_factory=list)

    def names(self) -> list[str]:
        """What names this implementation apart from its siblings."""
        return [name for name in [self.application, *self.operates] if name]

    def label(self) -> str:
        return " · ".join(self.names())


def operating_names(connection: psycopg.Connection[Any], project_id: UUID) -> dict[UUID, str]:
    """The units each control operates in, by name, for the controls split by them: what
    tells a split control's rows apart where the system alone does not."""
    return {
        UUID(str(row[0])): str(row[1])
        for row in connection.execute(
            """
            SELECT s.engagement_control_id, string_agg(u.name, ' · ' ORDER BY u.name)
            FROM engagement_control_scopes s
            JOIN engagement_scope_units u ON u.id = s.unit_id
            WHERE s.project_id = %s AND s.role = 'OPERATES'
            GROUP BY s.engagement_control_id
            """,
            (project_id,),
        ).fetchall()
    }


def scopes(connection: psycopg.Connection[Any], project_id: UUID) -> dict[UUID, Scope]:
    """Every control's scope in the project: its system and its units."""
    found: dict[UUID, Scope] = {}
    for control_id, application in connection.execute(
        """
        SELECT c.id, a.name FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.project_id = %s
        """,
        (project_id,),
    ).fetchall():
        found[UUID(str(control_id))] = Scope(
            application=None if application is None else str(application)
        )
    for control_id, role, name in connection.execute(
        """
        SELECT s.engagement_control_id, s.role, u.name
        FROM engagement_control_scopes s
        JOIN engagement_scope_units u ON u.id = s.unit_id
        WHERE s.project_id = %s
        ORDER BY u.kind, lower(u.name)
        """,
        (project_id,),
    ).fetchall():
        scope = found.setdefault(UUID(str(control_id)), Scope())
        (scope.operates if role == "OPERATES" else scope.covers).append(str(name))
    return found


def scope_of(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> Scope:
    return scopes(connection, project_id).get(control_id, Scope())


def units(connection: psycopg.Connection[Any], project_id: UUID) -> list[ScopeUnit]:
    return [
        ScopeUnit(
            id=row[0],
            kind=row[1],
            kind_label=KIND_LABELS[str(row[1])],
            name=str(row[2]),
            operating=int(row[3]),
            covering=int(row[4]),
        )  # fmt: skip
        for row in connection.execute(
            """
            SELECT u.id, u.kind, u.name,
                   count(*) FILTER (WHERE s.role = 'OPERATES' AND c.included),
                   count(*) FILTER (WHERE s.role = 'COVERS' AND c.included)
            FROM engagement_scope_units u
            LEFT JOIN engagement_control_scopes s ON s.unit_id = u.id
            LEFT JOIN engagement_controls c ON c.id = s.engagement_control_id
            WHERE u.project_id = %s
            GROUP BY u.id
            ORDER BY array_position(%s::text[], u.kind), lower(u.name)
            """,
            (project_id, list(UNIT_KINDS)),
        ).fetchall()
    ]


def add_unit(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    body: UnitCreate,
) -> list[ScopeUnit]:
    name = " ".join(body.name.split())
    if name == "":
        raise ValueError("name the unit")
    with transaction(connection) as cursor:
        added = cursor.execute(
            """
            INSERT INTO engagement_scope_units (organization_id, project_id, kind, name,
                                                created_by)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (organization_id, project_id, body.kind, name, actor),
        ).fetchone()
        if added is None:
            raise ImplementationState(f"{KIND_LABELS[body.kind]} {name} is already listed")
        _audit(
            cursor, organization_id, project_id, actor, "scope_unit.added",
            "engagement_scope_unit", UUID(str(added[0])), {"kind": body.kind, "name": name},
        )  # fmt: skip
    return units(connection, project_id)


def _project_units(
    cursor: psycopg.Cursor[Any], project_id: UUID, unit_ids: list[UUID]
) -> dict[UUID, str]:
    found = {
        UUID(str(row[0])): str(row[1])
        for row in cursor.execute(
            "SELECT id, name FROM engagement_scope_units WHERE project_id = %s AND id = ANY(%s)",
            (project_id, unit_ids),
        ).fetchall()
    }
    if len(found) != len(set(unit_ids)):
        raise ImplementationState("one of the units is not part of this engagement")
    return found


def set_coverage(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: CoverageBody,
) -> Scope:
    """What a central control covers. Coverage never splits it."""
    wanted = list(dict.fromkeys(body.unit_ids))
    with transaction(connection) as cursor:
        names = _project_units(cursor, project_id, wanted)
        operating = {
            UUID(str(row[0]))
            for row in cursor.execute(
                "SELECT unit_id FROM engagement_control_scopes "
                "WHERE engagement_control_id = %s AND role = 'OPERATES'",
                (control_id,),
            ).fetchall()
        }
        if operating & set(wanted):
            raise ImplementationState("the control operates there separately already")
        cursor.execute(
            "DELETE FROM engagement_control_scopes "
            "WHERE engagement_control_id = %s AND role = 'COVERS'",
            (control_id,),
        )
        for unit_id in wanted:
            cursor.execute(
                """
                INSERT INTO engagement_control_scopes (engagement_control_id, project_id,
                                                       unit_id, role, decided_by)
                VALUES (%s, %s, %s, 'COVERS', %s)
                """,
                (control_id, project_id, unit_id, actor),
            )
        _audit(
            cursor, organization_id, project_id, actor, "control.coverage_set",
            "engagement_control", control_id, {"covers": [names[u] for u in wanted]},
        )  # fmt: skip
    return scope_of(connection, project_id, control_id)


def split(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: SplitBody,
) -> list[UUID]:
    """Operate the control separately in each unit, as a person decided: the control
    takes the first unit, and each other unit gets an implementation of its own (a copy of
    the control, planned with the reviewed rules). Returns the new implementations."""
    from ai_workforce_api.control_instances import clone_instance

    wanted = list(dict.fromkeys(body.unit_ids))
    if len(wanted) < 2:
        raise ImplementationState("choose at least two units to operate in separately")
    reason = " ".join(body.reason.split())
    with transaction(connection) as cursor:
        row = cursor.execute(
            "SELECT engagement_application_id, included FROM engagement_controls "
            "WHERE id = %s AND project_id = %s FOR UPDATE",
            (control_id, project_id),
        ).fetchone()
        if row is None:
            raise ImplementationState("the control is not part of this engagement")
        if not row[1]:
            raise ImplementationState("the control is out of scope")
        names = _project_units(cursor, project_id, wanted)
        already = cursor.execute(
            "SELECT 1 FROM engagement_control_scopes "
            "WHERE engagement_control_id = %s AND role = 'OPERATES'",
            (control_id,),
        ).fetchone()
        if already is not None:
            raise ImplementationState("the control already operates separately")
        application = None if row[0] is None else UUID(str(row[0]))
        # A unit it covered is now one it operates in.
        cursor.execute(
            "DELETE FROM engagement_control_scopes WHERE engagement_control_id = %s "
            "AND role = 'COVERS' AND unit_id = ANY(%s)",
            (control_id, wanted),
        )
        _operate(cursor, project_id, control_id, wanted[0], actor)
        created: list[UUID] = []
        for unit_id in wanted[1:]:
            copied = clone_instance(
                cursor, control_id, application, implementation_key=_key(application, unit_id)
            )
            _operate(cursor, project_id, copied, unit_id, actor)
            created.append(copied)
        _audit(
            cursor, organization_id, project_id, actor, "control.split",
            "engagement_control", control_id,
            {"operates": [names[u] for u in wanted], "reason": reason,
             "created": [str(c) for c in created]},
        )  # fmt: skip
    return created


def _key(application: UUID | None, unit_id: UUID) -> str:
    """What the database computes once the unit is linked (implementation_key_of)."""
    return f"{'' if application is None else application}:{unit_id}"


def _operate(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, unit_id: UUID, actor: UUID
) -> None:
    cursor.execute(
        """
        INSERT INTO engagement_control_scopes (engagement_control_id, project_id, unit_id,
                                               role, decided_by)
        VALUES (%s, %s, %s, 'OPERATES', %s)
        """,
        (control_id, project_id, unit_id, actor),
    )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    action: str,
    target_type: str,
    target_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (organization_id, project_id, actor_user_id, action,
                                  target_type, target_id, payload)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, actor, action, target_type, target_id, Json(payload)),
    )
