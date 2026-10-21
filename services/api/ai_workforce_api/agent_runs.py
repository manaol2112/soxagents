"""An agent's run on a record, as the person sees it: queued, running, or not running.

The records keep a lease status (PENDING, WORKING, IDLE). PENDING is work handed to the
background and not yet picked up; WORKING is an agent executing it now. A WORKING run whose
lease ran out is still shown as running: the worker resumes it.

Milestone 3a adds cancellation. A person with update rights on the engagement cancels a
queued or running job: a queued one is finished at once; a running one is asked to stop
and does so at its next check (between items, before a model call), never in the middle
of writing a result. The record keeps who asked, when, and when it stopped; the note says
so, and running the job again is the recovery.
"""

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

RunState = Literal["IDLE", "QUEUED", "RUNNING"]


def run_state(status: Any) -> RunState:
    if status == "PENDING":
        return "QUEUED"
    if status == "WORKING":
        return "RUNNING"
    return "IDLE"


@dataclass(frozen=True)
class RunKind:
    table: str
    status_column: str
    note_column: str
    # The status a cancelled job rests in: the lease model's IDLE, or FAILED for an
    # analysis, whose statuses are PENDING, WORKING, READY and FAILED.
    rest: str
    target_type: str
    audit_action: str
    agent_key: str


RUN_KINDS: dict[str, RunKind] = {
    "test-sheet": RunKind(
        "test_sheets",
        "run_status",
        "run_note",
        "IDLE",
        "test_sheet",
        "testing.run_cancelled",
        "control-tester",
    ),  # fmt: skip
    "review": RunKind(
        "control_reviews",
        "reperform_status",
        "reperform_note",
        "IDLE",
        "control_review",
        "control_review.reperform_cancelled",
        "independent-reviewer",
    ),  # fmt: skip
    "analysis": RunKind(
        "evidence_analyses",
        "status",
        "note",
        "FAILED",
        "evidence_analysis",
        "evidence.analysis_cancelled",
        "evidence-coordinator",
    ),  # fmt: skip
    "workpaper": RunKind(
        "workpapers",
        "draft_status",
        "draft_note",
        "IDLE",
        "workpaper",
        "workpaper.draft_cancelled",
        "workpaper-preparer",
    ),  # fmt: skip
}

CANCELLED_NOTE = "Cancelled by {name}. Run it again when ready."

CancelState = Literal["NONE", "REQUESTED", "CANCELLED"]


def cancel_state(status: Any, requested_at: Any, cancelled_at: Any, note: Any) -> CancelState:
    """What a person sees: REQUESTED while a running job has been asked to stop and has
    not yet; CANCELLED when the job's last outcome was a cancellation; NONE otherwise
    (including after the job was run again)."""
    if requested_at is not None and cancelled_at is None and status in ("PENDING", "WORKING"):
        return "REQUESTED"
    if cancelled_at is not None and str(note or "").startswith("Cancelled by "):
        return "CANCELLED"
    return "NONE"


class CancelBody(BaseModel):
    kind: str
    record_id: UUID
    # CANCELLED: the job was queued and is finished now. REQUESTED: the job is running
    # and stops at its next check.
    state: Literal["CANCELLED", "REQUESTED"]
    note: str


def cancel_requested(connection: psycopg.Connection[Any], kind: str, record_id: UUID) -> bool:
    """Whether a person asked the running job to stop. Jobs call this between units."""
    found = RUN_KINDS[kind]
    row = connection.execute(
        f"SELECT cancel_requested_at IS NOT NULL AND cancelled_at IS NULL "  # noqa: S608
        f"FROM {found.table} WHERE id = %s",
        (record_id,),
    ).fetchone()
    return bool(row is not None and row[0])


def finish_cancelled(
    connection: psycopg.Connection[Any],
    kind: str,
    record_id: UUID,
    *,
    actor_agent_instance_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> bool:
    """The job noticed the request and stopped: the record rests, says who cancelled it,
    and the audit trail records the agent's stop. False when nothing was requested."""
    found = RUN_KINDS[kind]
    extra = ", version = version + 1, updated_at = clock_timestamp()" if kind == "analysis" else ""
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE {found.table} t
            SET {found.status_column} = %s, lease_until = NULL, cancelled_at = clock_timestamp(),
                {found.note_column} = %s{extra}
            FROM users u
            WHERE t.id = %s AND t.cancel_requested_at IS NOT NULL AND t.cancelled_at IS NULL
              AND u.id = t.cancel_requested_by
            RETURNING t.organization_id, t.project_id, t.cancel_requested_by, u.display_name
            """,  # noqa: S608
            (found.rest, "", record_id),
        ).fetchone()
        if row is None:
            return False
        name = str(row[3])
        cursor.execute(
            f"UPDATE {found.table} SET {found.note_column} = %s WHERE id = %s",  # noqa: S608
            (CANCELLED_NOTE.format(name=name)[:300], record_id),
        )
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, actor_agent_instance_id, action,
                target_type, target_id, payload
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                row[0],
                row[1],
                row[2],
                actor_agent_instance_id,
                found.audit_action,
                found.target_type,
                record_id,
                Json({"agent": found.agent_key, "stopped": "at the next check", **(payload or {})}),
            ),
        )
    return True


def request_cancel(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    kind: str,
    record_id: UUID,
) -> CancelBody:
    found = RUN_KINDS.get(kind)
    if found is None:
        raise NotVisible()
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"SELECT t.{found.status_column}, u.display_name FROM {found.table} t "  # noqa: S608
            f"JOIN users u ON u.id = %s WHERE t.id = %s AND t.project_id = %s "
            f"AND t.organization_id = %s FOR UPDATE OF t",
            (principal.id, record_id, project_id, organization_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        status, name = str(row[0]), str(row[1])
        if status == "PENDING":
            # Nothing has claimed the job: it is finished here and now.
            extra = (
                ", version = version + 1, updated_at = clock_timestamp()"
                if kind == "analysis"
                else ""
            )
            note = CANCELLED_NOTE.format(name=name)[:300]
            cursor.execute(
                f"""
                UPDATE {found.table}
                SET {found.status_column} = %s, lease_until = NULL, {found.note_column} = %s,
                    cancel_requested_at = clock_timestamp(), cancel_requested_by = %s,
                    cancelled_at = clock_timestamp(){extra}
                WHERE id = %s
                """,  # noqa: S608
                (found.rest, note, principal.id, record_id),
            )
            _audit(cursor, organization_id, project_id, principal.id, found, record_id,
                   {"state": "queued", "agent": found.agent_key})  # fmt: skip
            return CancelBody(kind=kind, record_id=record_id, state="CANCELLED", note=note)
        if status == "WORKING":
            # The latest request stands; an earlier, finished cancellation does not mask it.
            cursor.execute(
                f"""
                UPDATE {found.table}
                SET cancel_requested_at = clock_timestamp(), cancel_requested_by = %s,
                    cancelled_at = NULL
                WHERE id = %s
                """,  # noqa: S608
                (principal.id, record_id),
            )
            cursor.execute(
                """
                INSERT INTO audit_events (
                    organization_id, project_id, actor_user_id, action, target_type, target_id,
                    payload
                )
                VALUES (%s, %s, %s, 'agent_run.cancel_requested', %s, %s, %s)
                """,
                (
                    organization_id,
                    project_id,
                    principal.id,
                    found.target_type,
                    record_id,
                    Json({"agent": found.agent_key}),
                ),  # fmt: skip
            )
            return CancelBody(
                kind=kind,
                record_id=record_id,
                state="REQUESTED",
                note="The agent stops at its next check.",
            )
    raise HTTPException(status_code=409, detail="no agent run is queued or running")


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    found: RunKind,
    record_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor_id,
            found.audit_action,
            found.target_type,
            record_id,
            Json(payload),
        ),
    )


def register_agent_runs(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.post(f"{base}/agent-runs/{{kind}}/{{record_id}}/cancel", response_model=CancelBody)
    def cancel(
        organization_id: UUID, project_id: UUID, kind: str, record_id: UUID, request: Request
    ) -> CancelBody:
        principal = _session_principal(request)
        return _call(
            settings,
            lambda connection: request_cancel(
                connection, principal, organization_id, project_id, kind, record_id
            ),
        )
