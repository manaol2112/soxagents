"""A control's statement in an engagement (Milestone 8.9): the library statement with the
client's values, and the values themselves.

- design_for: the statement as the control record shows it, each slot with its value.
- set_values: the team fills slots on one control, or on every control in the engagement
  that uses the same slot and has no value yet. The control's description and the
  bracketed wording in its attributes follow.
- missing_values: the slots testing waits for, per control, for readiness.
- refresh_statement: put the rendered statement back on the control's description.

Only library controls on version 3 have a statement; a client's own control has none.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.control_context import ContextState
from ai_workforce_api.control_statements import ASSERTION_LABELS, Statement, render
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.statement_registry import statement_for
from ai_workforce_api.testing_definitions import DEFINITIONS_VERSION

# Filled from the control's own system, never by hand.
AUTOMATIC = ("system",)


class SlotBody(BaseModel):
    key: str
    label: str
    kind: str
    why: str
    example: str
    blocks: bool
    value: str
    automatic: bool
    filled_by: str | None
    filled_at: datetime | None
    version: int


class InformationBody(BaseModel):
    name: str
    kind: str
    elements: list[str]
    ipe: str


class DesignBody(BaseModel):
    """How the control is designed, as its documentation states it, with the client's values
    in place and the label of each value still missing in brackets."""

    text: str
    risk: str
    it_risk: str
    principle: str
    assertions: list[str]
    control_type: str
    nature: str
    frequency: str
    operator: str
    reviewer: str
    owner: str
    authority: str
    judgment: str
    judgment_note: str
    precision: str
    investigation: str
    information: list[InformationBody]
    itgcs: list[str]
    evidence: str
    applies_when: str
    slots: list[SlotBody]
    # The labels of the slots testing waits for.
    missing: list[str]


class ValuesBody(BaseModel):
    values: dict[str, str] = Field(min_length=1, max_length=40)
    # Also fill this slot on every other control in the engagement that uses it and has no
    # value yet.
    everywhere: bool = False


def _statement(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any], control_id: UUID
) -> tuple[Statement, dict[str, Any]] | None:
    row = connection.execute(
        """
        SELECT c.library_key, c.library_version, a.name, c.organization_id, c.project_id
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.id = %s
        """,
        (control_id,),
    ).fetchone()
    if row is None or row[0] is None or int(row[1] or 0) < DEFINITIONS_VERSION:
        return None
    statement = statement_for(str(row[0]))
    if statement is None:
        return None
    return statement, {
        "system": "" if row[2] is None else str(row[2]),
        "organization_id": row[3],
        "project_id": row[4],
    }


def _values(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any], control_id: UUID
) -> dict[str, tuple[str, str | None, datetime | None, int]]:
    return {
        str(row[0]): (str(row[1]), None if row[2] is None else str(row[2]), row[3], int(row[4]))
        for row in connection.execute(
            """
            SELECT p.slot_key, p.value, u.display_name, p.filled_at, p.version
            FROM control_parameters p LEFT JOIN users u ON u.id = p.filled_by
            WHERE p.engagement_control_id = %s
            """,
            (control_id,),
        ).fetchall()
    }


def _blocking(statement: Statement) -> set[str]:
    """The slots testing waits for: blocking ones used anywhere but the owner's name."""
    owner_only = {
        key for key in statement.keys_used()
        if key not in _used_outside_owner(statement)
    }  # fmt: skip
    return {
        slot.key for slot in statement.slots
        if slot.blocks and slot.key not in AUTOMATIC and slot.key not in owner_only
    }  # fmt: skip


def _used_outside_owner(statement: Statement) -> set[str]:
    from ai_workforce_api.control_statements import SLOT

    fields = (
        statement.text, statement.operator, statement.reviewer, statement.precision,
        statement.investigation, statement.evidence,
    )  # fmt: skip
    return {key for value in fields for key in SLOT.findall(value)}


def design_for(connection: psycopg.Connection[Any], control_id: UUID) -> DesignBody | None:
    found = _statement(connection, control_id)
    if found is None:
        return None
    statement, context = found
    stored = _values(connection, control_id)
    values = {key: value[0] for key, value in stored.items()}
    values["system"] = context["system"]
    labels = {slot.key: slot.label for slot in statement.slots}
    blocking = _blocking(statement)

    def show(text: str) -> str:
        return render(text, values, labels)

    return DesignBody(
        text=show(statement.text),
        risk=statement.risk,
        it_risk=statement.it_risk,
        principle=statement.principle,
        assertions=[ASSERTION_LABELS[item] for item in statement.assertions],
        control_type=statement.control_type,
        nature=statement.nature,
        frequency=statement.frequency,
        operator=show(statement.operator),
        reviewer=show(statement.reviewer),
        owner=show(statement.owner),
        authority=show(statement.authority),
        judgment=statement.judgment,
        judgment_note=statement.judgment_note,
        precision=show(statement.precision),
        investigation=show(statement.investigation),
        information=[
            InformationBody(
                name=item.name, kind=item.kind, elements=list(item.elements), ipe=item.ipe
            )
            for item in statement.information
        ],  # fmt: skip
        itgcs=list(statement.itgcs),
        evidence=show(statement.evidence),
        applies_when=show(statement.applies_when),
        slots=[
            SlotBody(
                key=slot.key,
                label=slot.label,
                kind=slot.kind,
                why=slot.why,
                example=slot.example,
                blocks=slot.key in blocking,
                value=values.get(slot.key, ""),
                automatic=slot.key in AUTOMATIC,
                filled_by=stored[slot.key][1] if slot.key in stored else None,
                filled_at=stored[slot.key][2] if slot.key in stored else None,
                version=stored[slot.key][3] if slot.key in stored else 0,
            )
            for slot in statement.slots
        ],  # fmt: skip
        missing=[
            slot.label
            for slot in statement.slots
            if slot.key in blocking and not values.get(slot.key, "").strip()
        ],  # fmt: skip
    )


def missing_values(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, list[tuple[str, str]]]:
    """Per control, the (label, why) of each slot testing waits for that has no value."""
    rows = connection.execute(
        """
        SELECT id, library_key FROM engagement_controls
        WHERE project_id = %s AND library_key IS NOT NULL AND library_version >= %s
        """,
        (project_id, DEFINITIONS_VERSION),
    ).fetchall()
    filled: dict[UUID, set[str]] = {}
    for control_id, key in connection.execute(
        "SELECT engagement_control_id, slot_key FROM control_parameters "
        "WHERE project_id = %s AND value <> ''",
        (project_id,),
    ).fetchall():
        filled.setdefault(UUID(str(control_id)), set()).add(str(key))
    found: dict[UUID, list[tuple[str, str]]] = {}
    for control_id, library_key in rows:
        statement = statement_for(str(library_key))
        if statement is None:
            continue
        have = filled.get(UUID(str(control_id)), set())
        missing = [
            (slot.label, slot.why) for slot in statement.slots
            if slot.key in _blocking(statement) and slot.key not in have
        ]  # fmt: skip
        if missing:
            found[UUID(str(control_id))] = missing
    return found


def refresh_statement(cursor: psycopg.Cursor[Any], control_id: UUID) -> None:
    """Put the statement, with the values filled so far, on the control's description, and
    fill each value into the bracketed wording of the control's attributes."""
    from ai_workforce_api.control_attributes import _write_list

    found = _statement(cursor, control_id)
    if found is None:
        return
    statement, context = found
    values = {key: value[0] for key, value in _values(cursor, control_id).items()}
    values["system"] = context["system"]
    labels = {slot.key: slot.label for slot in statement.slots}
    cursor.execute(
        "UPDATE engagement_controls SET activity = %s, version = version + 1, "
        "updated_at = clock_timestamp() WHERE id = %s AND activity IS DISTINCT FROM %s",
        (render(statement.text, values, labels), control_id,
         render(statement.text, values, labels)),
    )  # fmt: skip
    changed = False
    for slot in statement.slots:
        value = values.get(slot.key, "").strip()
        if not value or slot.key in AUTOMATIC:
            continue
        marker = f"[{slot.fills}]"
        for row_id, text, status in cursor.execute(
            "SELECT id, text, status FROM control_attributes WHERE engagement_control_id = %s "
            "AND status IN ('APPROVED', 'PROPOSED') AND strpos(text, %s) > 0",
            (control_id, marker),
        ).fetchall():
            cursor.execute(
                "UPDATE control_attributes SET text = %s, version = version + 1, "
                "updated_at = clock_timestamp() WHERE id = %s",
                (str(text).replace(marker, value)[:300], row_id),
            )
            changed = changed or status == "APPROVED"
    if changed:
        _write_list(cursor, control_id)


def set_values(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: ValuesBody,
) -> list[UUID]:
    """Fill slots on the control (and, when asked, on every control that uses them and has
    no value yet). Returns every control changed."""
    found = _statement(connection, control_id)
    if found is None:
        raise ContextState("this control has no statement to fill")
    statement, _context = found
    cleaned: dict[str, str] = {}
    for key, raw in body.values.items():
        slot = statement.slot(key)
        if slot is None or key in AUTOMATIC:
            raise ContextState("unknown value")
        value = clean_line(raw, 300).strip()
        if contains_secret({key: value}):
            raise ContextState("a value cannot hold a credential")
        cleaned[key] = value
    targets: dict[UUID, set[str]] = {control_id: set(cleaned)}
    with transaction(connection) as cursor:
        if body.everywhere:
            for other, library_key in cursor.execute(
                """
                SELECT id, library_key FROM engagement_controls
                WHERE project_id = %s AND id <> %s AND library_key IS NOT NULL
                  AND library_version >= %s
                """,
                (project_id, control_id, DEFINITIONS_VERSION),
            ).fetchall():
                other_statement = statement_for(str(library_key))
                if other_statement is None:
                    continue
                shared = {key for key in cleaned if other_statement.slot(key) is not None}
                if not shared:
                    continue
                have = {
                    str(row[0]) for row in cursor.execute(
                        "SELECT slot_key FROM control_parameters WHERE engagement_control_id = %s "
                        "AND value <> ''",
                        (other,),
                    ).fetchall()
                }  # fmt: skip
                if shared - have:
                    targets[UUID(str(other))] = shared - have
        for target, keys in targets.items():
            for key in keys:
                value = cleaned[key]
                cursor.execute(
                    """
                    INSERT INTO control_parameters (
                        organization_id, project_id, engagement_control_id, slot_key, value,
                        filled_by, filled_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s,
                            CASE WHEN %s <> '' THEN clock_timestamp() END)
                    ON CONFLICT (engagement_control_id, slot_key) DO UPDATE
                    SET value = EXCLUDED.value,
                        filled_by = CASE WHEN EXCLUDED.value <> '' THEN EXCLUDED.filled_by END,
                        filled_at = EXCLUDED.filled_at,
                        version = control_parameters.version + 1
                    """,
                    (organization_id, project_id, target, key, value,
                     actor if value else None, value),
                )  # fmt: skip
            refresh_statement(cursor, target)
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'control.values_set', 'engagement_control', %s, %s)
            """,
            (
                organization_id, project_id, actor, control_id,
                Json({"keys": sorted(cleaned), "controls": len(targets),
                      "everywhere": body.everywhere}),
            ),
        )  # fmt: skip
    return list(targets)
