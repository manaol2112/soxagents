"""Every earlier version of an attribute's criteria (docs/control-workflow-plan.md, B1j; the
product owner, 16 November 2026, on ITGC-CM-06: "does the criteria identified initially
currently being saved or are overwritten and start again?").

The database keeps them, not the code: a trigger on control_attributes (migration 0172)
copies the criteria an update replaces into attribute_criteria_versions, whoever made the
change, and stamps who or what wrote the new ones, when and why. The server says who and why
around its writes, in settings that last only as long as the write (`writing`) or, for a
background run, as long as the run (`run_settings`):

- app.criteria_by: the person who wrote them (master_plans.set_criteria);
- app.criteria_writer: the agent that wrote them ("Planner agent", "Attribute agent",
  "Reviewer agent");
- app.criteria_cause: the matter of the answer or the changed assumption the run follows,
  shown as "Updated from your answer on <matter>" (`criteria_updated_from`);
- app.criteria_only: the attribute codes a run may change (the one update a changed
  assumption starts); the trigger refuses any other attribute's criteria while it is set.

Settings no writer set read as unknown: a version written before this migration, or by a
path that says nothing, names no one.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel

from ai_workforce_api.control_context import line

WriterKind = Literal["PERSON", "AGENT", "SEEDED", "RULES"]
PLANNER = "Planner agent"
ATTRIBUTE_AGENT = "Attribute agent"
REVIEWER = "Reviewer agent"
CAUSE_LIMIT = 300


class WrittenBy(BaseModel):
    kind: WriterKind
    name: str


class CriteriaVersionBody(BaseModel):
    version: int
    condition: str
    pass_criteria: str
    fail_criteria: str
    judgment_required: bool
    origin: str
    written_at: datetime
    written_by: WrittenBy
    cause: str


class CriteriaHistoryBody(BaseModel):
    versions: list[CriteriaVersionBody]


def writer_kind(origin: str | None) -> WriterKind:
    """Who stated a version, by its criteria_origin: a person, an agent, the demo, or (no
    origin on record) the rules: the library's own wording or a path that named none."""
    if origin == "PERSON":
        return "PERSON"
    if origin == "AGENT":
        return "AGENT"
    if origin == "SEEDED":
        return "SEEDED"
    return "RULES"


def written_by(origin: str | None, person: str | None, writer: str) -> WrittenBy:
    """Who wrote a version, as the history says it: the person's name where one is on
    record, otherwise the agent's, otherwise "" (unknown)."""
    return WrittenBy(kind=writer_kind(origin), name=line(person or writer or "", 120))


def cause_of(matters: list[str]) -> str:
    """The cause a run's criteria writes carry: the matters it follows, once each, in order,
    as one line within the limit."""
    return line("; ".join(dict.fromkeys(item for item in matters if item.strip())), CAUSE_LIMIT)


@contextmanager
def writing(
    cursor: psycopg.Cursor[Any],
    *,
    by: UUID | None = None,
    writer: str = "",
    cause: str | None = None,
) -> Iterator[None]:
    """Say who or what writes criteria inside the block, for the trigger to stamp; reset
    after it, so a later write in the same transaction is never stamped as this one's. A
    cause of None leaves the run's own (run_settings). The settings are the transaction's
    (SET LOCAL): a block that fails is rolled back with them."""
    cursor.execute(
        "SELECT set_config('app.criteria_by', %s, true)", ("" if by is None else str(by),)
    )
    cursor.execute("SELECT set_config('app.criteria_writer', %s, true)", (line(writer, 60),))
    if cause is not None:
        cursor.execute(
            "SELECT set_config('app.criteria_cause', %s, true)", (line(cause, CAUSE_LIMIT),)
        )
    yield
    cursor.execute("SELECT set_config('app.criteria_by', '', true)")
    cursor.execute("SELECT set_config('app.criteria_writer', '', true)")
    if cause is not None:
        cursor.execute("SELECT set_config('app.criteria_cause', '', true)")


@contextmanager
def run_settings(
    connection: psycopg.Connection[Any], cause: str, only: tuple[str, ...]
) -> Iterator[None]:
    """For the length of a background run's pass (its own connection, each step committing
    by itself): the cause its criteria writes carry, and the attribute codes it may change
    (none: any it may write). Cleared after it, whatever happens."""
    connection.execute(
        "SELECT set_config('app.criteria_cause', %s, false)", (line(cause, CAUSE_LIMIT),)
    )
    connection.execute("SELECT set_config('app.criteria_only', %s, false)", (",".join(only),))
    try:
        yield
    finally:
        try:
            connection.execute("SELECT set_config('app.criteria_cause', '', false)")
            connection.execute("SELECT set_config('app.criteria_only', '', false)")
        except psycopg.Error:
            # The connection is gone with the run: nothing is left to clear.
            pass


def counts(connection: psycopg.Connection[Any], control_id: UUID) -> dict[UUID, int]:
    """How many earlier versions each of the control's attributes keeps."""
    return {
        UUID(str(row[0])): int(row[1])
        for row in connection.execute(
            "SELECT attribute_id, count(*) FROM attribute_criteria_versions "
            "WHERE engagement_control_id = %s GROUP BY attribute_id",
            (control_id,),
        ).fetchall()
    }


def versions(
    connection: psycopg.Connection[Any], control_id: UUID, attribute_id: UUID
) -> CriteriaHistoryBody:
    """An attribute's earlier criteria, newest first. 404 when the attribute is not this
    control's."""
    from ai_workforce_api.authorization import NotVisible

    found = connection.execute(
        "SELECT 1 FROM control_attributes WHERE id = %s AND engagement_control_id = %s",
        (attribute_id, control_id),
    ).fetchone()
    if found is None:
        raise NotVisible()
    rows = connection.execute(
        """
        SELECT v.version, v.condition, v.pass_criteria, v.fail_criteria, v.judgment_required,
               v.criteria_origin, v.written_at, u.display_name, v.writer, v.cause
        FROM attribute_criteria_versions v
        LEFT JOIN users u ON u.id = v.written_by
        WHERE v.attribute_id = %s AND v.engagement_control_id = %s
        ORDER BY v.version DESC
        """,
        (attribute_id, control_id),
    ).fetchall()
    return CriteriaHistoryBody(
        versions=[
            CriteriaVersionBody(
                version=int(row[0]),
                condition=str(row[1]),
                pass_criteria=str(row[2]),
                fail_criteria=str(row[3]),
                judgment_required=bool(row[4]),
                origin=str(row[5] or ""),
                written_at=row[6],
                written_by=written_by(
                    None if row[5] is None else str(row[5]),
                    None if row[7] is None else str(row[7]),
                    str(row[8]),
                ),
                cause=str(row[9]),
            )
            for row in rows
        ]
    )
