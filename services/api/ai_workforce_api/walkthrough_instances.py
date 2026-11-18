"""The walkthrough instance an auditor picks from a population for a design item
(migration 0138; decided by the product owner on 31 October 2026).

A population uploaded on a design item is not that item's evidence: the item asks for one
instance of the control, walked through. The auditor picks the instance from the list in
the evidence dialog and then uploads that instance's evidence themselves; nothing is sent
to the control owner. The pick records the population file and its hash, the row as read,
and the person; a later pick supersedes it, and the earlier one stays on record.

Only a person picks. An agent proposes nothing here, and the pick decides nothing about
the control: the walkthrough is assessed from the evidence uploaded for it.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
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
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.control_tests import TestState, _population
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.sampling import key_column
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import ObjectStore, StoreError


class InstanceState(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class PickBody(BaseModel):
    file_id: UUID
    row_number: int = Field(ge=1, le=1_000_000)
    note: str = Field(default="", max_length=500)

    @field_validator("note")
    @classmethod
    def plain(cls, value: str) -> str:
        return clean_line(value, 500)


class InstanceBody(BaseModel):
    id: UUID
    requirement_id: UUID
    population_file_id: UUID
    file_name: str
    row_number: int
    key_column: str
    key_value: str
    columns: list[str]
    values: list[str]
    note: str
    selected_by_name: str
    created_at: datetime
    superseded_at: datetime | None


class InstancesBody(BaseModel):
    """The control's picks: the current one of each design item first, then the earlier."""

    instances: list[InstanceBody]


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


def _visible(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> None:
    row = connection.execute(
        "SELECT 1 FROM engagement_controls WHERE id = %s AND project_id = %s",
        (control_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()


def pick(
    connection: psycopg.Connection[Any],
    principal: Principal,
    store: ObjectStore,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    body: PickBody,
    *,
    origin: Literal["PICKED", "CONFIRMED"] = "PICKED",
    named_in: tuple[UUID, str] | None = None,
    reasons: list[str] | None = None,
    after: Callable[[psycopg.Cursor[Any], UUID, UUID | None], None] | None = None,
) -> InstancesBody:
    """Record the row a person picked as the design item's walkthrough instance: their own
    pick, or the agent's proposal they confirmed (origin, the file that named it, and the
    agent's reasons; sample_traces.py). `after` runs in the same transaction with the new
    pick and the one it replaced."""
    _person(connection, principal, organization_id, project_id)
    _visible(connection, project_id, control_id)
    item = connection.execute(
        "SELECT phase, status FROM evidence_requirements "
        "WHERE id = %s AND project_id = %s AND engagement_control_id = %s",
        (requirement_id, project_id, control_id),
    ).fetchone()
    if item is None:
        raise NotVisible()
    if str(item[0]) != "DESIGN":
        raise InstanceState("a walkthrough instance is picked for a design item")
    if str(item[1]) in ("REMOVED", "WAIVED"):
        raise InstanceState("the item is no longer in the plan")
    on_control = connection.execute(
        "SELECT 1 FROM evidence_file_links WHERE evidence_file_id = %s "
        "AND project_id = %s AND engagement_control_id = %s",
        (body.file_id, project_id, control_id),
    ).fetchone()
    if on_control is None:
        raise InstanceState("the population is not filed to this control")
    try:
        table, _name, sha256 = _population(connection, store, project_id, body.file_id)
    except TestState as error:
        raise InstanceState(error.detail) from None
    if body.row_number > len(table.rows):
        raise InstanceState("that row is not in the population")
    values = [value[:500] for value in table.rows[body.row_number - 1]]
    key = key_column(table)
    with transaction(connection) as cursor:
        earlier = cursor.execute(
            "SELECT id FROM walkthrough_instances "
            "WHERE requirement_id = %s AND superseded_at IS NULL FOR UPDATE",
            (requirement_id,),
        ).fetchone()
        if earlier is not None:
            cursor.execute(
                "UPDATE walkthrough_instances SET superseded_at = clock_timestamp(), "
                "superseded_by = %s WHERE id = %s",
                (principal.id, earlier[0]),
            )
        row = cursor.execute(
            """
            INSERT INTO walkthrough_instances (
                organization_id, project_id, engagement_control_id, requirement_id,
                population_file_id, population_sha256, row_number, key_column, key_value,
                columns, row_values, note, selected_by, origin, named_in_file_id,
                named_in_sha256, reasons
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                control_id,
                requirement_id,
                body.file_id,
                sha256,
                body.row_number,
                "" if key is None else table.columns[key][:200],
                "" if key is None else values[key][:500],
                Json([column[:200] for column in table.columns]),
                Json(values),
                body.note,
                principal.id,
                origin,
                None if named_in is None else named_in[0],
                "" if named_in is None else named_in[1],
                Json([reason[:240] for reason in (reasons or [])[:8]]),
            ),
        ).fetchone()
        assert row is not None
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'evidence.walkthrough_instance_selected',
                    'walkthrough_instance', %s, %s)
            """,
            (
                organization_id,
                project_id,
                principal.id,
                row[0],
                Json(
                    {
                        "requirement_id": str(requirement_id),
                        "file_id": str(body.file_id),
                        "row_number": body.row_number,
                        "replaced": None if earlier is None else str(earlier[0]),
                        "origin": origin,
                        "named_in": None if named_in is None else str(named_in[0]),
                    }
                ),
            ),
        )
        if after is not None:
            after(cursor, UUID(str(row[0])), None if earlier is None else UUID(str(earlier[0])))
    return read(connection, principal, organization_id, project_id, control_id)


def read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
) -> InstancesBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    _visible(connection, project_id, control_id)
    rows = connection.execute(
        """
        SELECT w.id, w.requirement_id, w.population_file_id, f.file_name, w.row_number,
               w.key_column, w.key_value, w.columns, w.row_values, w.note,
               coalesce(u.display_name, ''), w.created_at, w.superseded_at
        FROM walkthrough_instances w
        JOIN evidence_files f ON f.id = w.population_file_id
        LEFT JOIN users u ON u.id = w.selected_by
        WHERE w.project_id = %s AND w.engagement_control_id = %s
        ORDER BY w.superseded_at IS NOT NULL, w.created_at DESC
        """,
        (project_id, control_id),
    ).fetchall()
    return InstancesBody(
        instances=[
            InstanceBody(
                id=r[0],
                requirement_id=r[1],
                population_file_id=r[2],
                file_name=str(r[3]),
                row_number=int(r[4]),
                key_column=str(r[5]),
                key_value=str(r[6]),
                columns=[str(c) for c in r[7]],
                values=[str(v) for v in r[8]],
                note=str(r[9]),
                selected_by_name=str(r[10]),
                created_at=r[11],
                superseded_at=r[12],
            )
            for r in rows
        ]
    )


def register_walkthrough_instances(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except InstanceState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None

    @app.get(f"{base}/walkthrough-instances", response_model=InstancesBody)
    def listed(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> InstancesBody:
        return run(request, lambda c, p: read(c, p, organization_id, project_id, control_id))

    # A pick is posted through sample_traces.register_sample_traces, which records what the
    # trace observes about the picked sample in the pick's transaction.
