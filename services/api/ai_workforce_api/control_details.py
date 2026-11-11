"""A control's RCM details, completed on its own system (product owner, 10 November 2026).

Step 01 of the control's workflow flagged "Start here" with nowhere to record what was
missing. Its panel now asks for the missing details. Decided by the product owner: a detail
recorded here applies to this system's control only. The panel offers the same control on
the engagement's other systems where that detail is empty, chosen system by system, and a
copy never overwrites a value another system holds.

The setup editor (onboarding._update_control) still sets a control's details on every
system at once. This is the narrower action, under the same permission (PROJECT_UPDATE,
after the engagement starts) and the same checks (the known frequencies and natures, a
valid email, no secrets, the control's version).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.actions import _EMAIL, contains_secret
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    authorize,
)
from ai_workforce_api.control_context import ContextState
from ai_workforce_api.controls import FREQUENCIES, NATURES
from ai_workforce_api.db import transaction

#: The details a person can complete here. Description, objective and risk come from the
#: control library or the client's RCM.
FIELDS = ("owner", "frequency", "nature")


class DetailsTarget(BaseModel):
    """The same control on another system, with the details it lacks that this one holds."""

    control_id: UUID
    system: str
    #: The details this control holds that the other system lacks: what a copy fills now.
    fills: list[str]
    #: The details the other system lacks, held here or not: what it can be offered.
    lacks: list[str]


class DetailsBody(BaseModel):
    version: int
    owner_name: str
    owner_email: str
    frequency: str
    nature: str
    #: Whether the person may record details (the setup permission).
    can_edit: bool
    targets: list[DetailsTarget]


class DetailsSet(BaseModel):
    """The details to record on this control. A field left out is not changed."""

    version: int = Field(ge=1)
    owner_name: str | None = Field(default=None, max_length=200)
    owner_email: str | None = Field(default=None, max_length=200)
    frequency: str | None = None
    nature: str | None = None
    #: The same control on other systems, to fill where the detail is empty there.
    copy_to: list[UUID] = Field(default_factory=list, max_length=50)

    @field_validator("owner_name", "owner_email")
    @classmethod
    def trimmed(cls, value: str | None) -> str | None:
        return None if value is None else value.strip()


def _row(cursor: Any, project_id: UUID, control_id: UUID, lock: bool = False) -> Any:
    return cursor.execute(
        "SELECT control_ref, version, owner_name, owner_email, frequency, nature "
        "FROM engagement_controls WHERE id = %s AND project_id = %s"
        + (" FOR UPDATE" if lock else ""),
        (control_id, project_id),
    ).fetchone()


def _held(row: Any) -> dict[str, bool]:
    """Which details a control holds."""
    return {
        "owner": (str(row[2] or "") + str(row[3] or "")).strip() != "",
        "frequency": str(row[4] or "") != "",
        "nature": str(row[5] or "") != "",
    }


def _others(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, ref: str
) -> list[tuple[UUID, str]]:
    """The same control on the engagement's other systems, in scope (as the understanding's
    copy reads it: understanding_chat.copy_targets)."""
    return [
        (UUID(str(other)), str(system))
        for other, system in connection.execute(
            """
            SELECT c.id, coalesce(a.name, '') FROM engagement_controls c
            LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
            WHERE c.project_id = %s AND c.id <> %s AND c.control_ref = %s AND c.included
            ORDER BY a.name, c.id
            """,
            (project_id, control_id, ref),
        ).fetchall()
    ]


def _may_edit(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> bool:
    try:
        authorize(
            connection,
            principal=principal,
            action=Action.PROJECT_UPDATE,
            organization_id=organization_id,
            project_id=project_id,
        )
    except AccessDenied, NotVisible:
        return False
    return True


def details(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
) -> DetailsBody:
    """The control's details as recorded, and the other systems a copy would fill."""
    row = _row(connection, project_id, control_id)
    if row is None:
        raise ContextState("this control is not in the engagement")
    mine = _held(row)
    targets: list[DetailsTarget] = []
    for other, system in _others(connection, project_id, control_id, str(row[0])):
        theirs = _row(connection, project_id, other)
        if theirs is None:
            continue
        held = _held(theirs)
        targets.append(
            DetailsTarget(
                control_id=other,
                system=system,
                fills=[field for field in FIELDS if mine[field] and not held[field]],
                lacks=[field for field in FIELDS if not held[field]],
            )
        )
    return DetailsBody(
        version=int(row[1]),
        owner_name=str(row[2] or ""),
        owner_email=str(row[3] or ""),
        frequency=str(row[4] or ""),
        nature=str(row[5] or ""),
        can_edit=_may_edit(connection, principal, organization_id, project_id),
        targets=targets,
    )


def set_details(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: DetailsSet,
) -> list[UUID]:
    """Records the details given on this control, then fills the same details on each other
    system chosen where that system has none. Returns every control changed."""
    # Imported here: onboarding imports the context modules.
    from ai_workforce_api.onboarding import _authorize_setup

    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    if body.frequency is not None and body.frequency not in FREQUENCIES:
        raise ValueError("frequency is unknown")
    if body.nature is not None and body.nature not in NATURES:
        raise ValueError("nature is unknown")
    email = None if body.owner_email is None else body.owner_email.lower()
    if email not in (None, "") and _EMAIL.fullmatch(email or "") is None:
        raise ValueError("owner email is invalid")
    if contains_secret({"name": body.owner_name or "", "email": email or ""}):
        raise ValueError("control details hold a secret")
    given = {
        "owner": body.owner_name is not None or email is not None,
        "frequency": body.frequency is not None,
        "nature": body.nature is not None,
    }
    if not any(given.values()):
        raise ValueError("no detail is given")
    changed: list[UUID] = []
    with transaction(connection) as cursor:
        row = _row(cursor, project_id, control_id, lock=True)
        if row is None:
            raise ContextState("this control is not in the engagement")
        if int(row[1]) != body.version:
            raise ContextState("the control changed; read it again")
        name = str(row[2] or "") if body.owner_name is None else body.owner_name
        mail = str(row[3] or "") if email is None else email
        frequency = body.frequency or str(row[4] or "")
        nature = body.nature or str(row[5] or "")
        cursor.execute(
            """
            UPDATE engagement_controls
            SET owner_name = %s, owner_email = %s, frequency = %s, nature = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND project_id = %s
            """,
            (name, mail, frequency, nature, control_id, project_id),
        )
        changed.append(control_id)
        _audit(
            cursor, organization_id, project_id, principal.id, control_id,
            "control.details_set", {"fields": [f for f in FIELDS if given[f]]},
        )  # fmt: skip
        offered = {
            other: system
            for other, system in _others(connection, project_id, control_id, str(row[0]))
        }
        for target in dict.fromkeys(body.copy_to):
            if target not in offered:
                raise ContextState("that system does not run this control in the engagement")
            theirs = _row(cursor, project_id, target, lock=True)
            if theirs is None:
                continue
            held = _held(theirs)
            fills = [field for field in FIELDS if given[field] and not held[field]]
            if not fills:
                continue
            cursor.execute(
                """
                UPDATE engagement_controls
                SET owner_name = %s, owner_email = %s, frequency = %s, nature = %s,
                    version = version + 1, updated_at = clock_timestamp()
                WHERE id = %s AND project_id = %s
                """,
                (
                    name if "owner" in fills else str(theirs[2] or ""),
                    mail if "owner" in fills else str(theirs[3] or ""),
                    frequency if "frequency" in fills else str(theirs[4] or ""),
                    nature if "nature" in fills else str(theirs[5] or ""),
                    target,
                    project_id,
                ),
            )
            changed.append(target)
            _audit(
                cursor, organization_id, project_id, principal.id, target,
                "control.details_copied",
                {"source_control_id": str(control_id), "fields": fills},
            )  # fmt: skip
    return changed


def _audit(
    cursor: Any,
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    control_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'engagement_control', %s, %s)
        """,
        (organization_id, project_id, actor, action, control_id, Json(payload)),
    )
