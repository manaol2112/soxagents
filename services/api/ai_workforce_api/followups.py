"""Follow-up reminders for sent PBC requests.

A durable timer calls ``advance``. The database decides whether a reminder is due, so a
late, repeated, or concurrent wake-up cannot create a second reminder. Reminders are only
marked due here; a person requests approval and sends each one.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import ceil
from typing import Any, Literal, Protocol
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

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

logger = logging.getLogger(__name__)

REMINDABLE = frozenset({"SENT", "WAITING_FOR_RESPONSE", "PARTIALLY_RECEIVED", "OVERDUE"})
HOLD_SECONDS = 900
PAUSED_SECONDS = 86400
DONE = -1
_COLUMNS = """
    id, pbc_request_id, sequence, status, due_at, approval_id, outbound_id, closed_at,
    reason, created_at, updated_at, version
"""


class FollowUpTimer(Protocol):
    def schedule(self, organization_id: UUID, project_id: UUID, request_id: UUID) -> None: ...


class FollowUpState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class FollowUpBody(BaseModel):
    id: UUID
    pbc_request_id: UUID
    sequence: int
    status: str
    due_at: datetime
    approval_id: UUID | None
    outbound_id: UUID | None
    closed_at: datetime | None
    reason: str
    created_at: datetime
    updated_at: datetime
    version: int


class SkipBody(BaseModel):
    version: int = Field(ge=1)


@dataclass(frozen=True)
class Occurrence:
    status: str
    reason: str
    closed_at: datetime | None


@dataclass(frozen=True)
class Step:
    kind: Literal["stop", "hold", "wait", "remind", "escalate"]
    seconds: int = 0
    sequence: int = 0
    due_at: datetime | None = None


def plan(
    *,
    request_status: str,
    project_status: str,
    ended: bool,
    follow_up_after_days: int,
    max_follow_ups: int,
    first_contact_at: datetime | None,
    last_reply_at: datetime | None,
    occurrences: list[Occurrence],
    now: datetime,
) -> Step:
    """Decide the next follow-up step. Pure, so every rule is testable without a clock."""
    if request_status not in REMINDABLE or ended:
        return Step("stop")
    if project_status != "ACTIVE":
        return Step("hold", seconds=PAUSED_SECONDS)
    if first_contact_at is None or any(
        item.status in {"DUE", "APPROVAL_PENDING"} for item in occurrences
    ):
        return Step("hold", seconds=HOLD_SECONDS)
    contacts = [first_contact_at]
    contacts.extend(
        item.closed_at
        for item in occurrences
        if item.status in {"SENT", "SKIPPED"} and item.closed_at is not None
    )
    if last_reply_at is not None:
        contacts.append(last_reply_at)
    due_at = max(contacts) + timedelta(days=follow_up_after_days)
    if now < due_at:
        return Step("wait", seconds=max(1, ceil((due_at - now).total_seconds())), due_at=due_at)
    used = sum(1 for item in occurrences if _uses_slot(item))
    if used < max_follow_ups:
        return Step("remind", sequence=used + 1, due_at=due_at)
    return Step("escalate", due_at=due_at)


def _uses_slot(item: Occurrence) -> bool:
    return item.status == "SENT" or (item.status == "SKIPPED" and item.reason != "reply_received")


def register_followups(
    app: FastAPI, settings: Settings, timer: FollowUpTimer | None = None
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/follow-ups")
    def list_follow_ups(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[FollowUpBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _list(connection, principal, organization_id, project_id),
        )

    @app.post(f"{base}/follow-ups/reconcile")
    def reconcile(organization_id: UUID, project_id: UUID, request: Request) -> list[FollowUpBody]:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _reconcile(
                connection, principal, organization_id, project_id, timer
            ),
        )

    @app.post(f"{base}/pbc-requests/{{request_id}}/follow-ups/{{follow_up_id}}/skip")
    def skip(
        organization_id: UUID,
        project_id: UUID,
        request_id: UUID,
        follow_up_id: UUID,
        body: SkipBody,
        request: Request,
    ) -> FollowUpBody:
        principal = _session_principal(request)
        return _run(
            settings,
            lambda connection: _skip(
                connection, principal, organization_id, project_id, request_id, follow_up_id, body
            ),
        )


def _run[T](settings: Settings, work: Callable[[psycopg.Connection[Any]], T]) -> T:
    try:
        return _call(settings, work)
    except FollowUpState as error:
        raise HTTPException(status_code=409, detail=error.detail) from None


def schedule(
    timer: FollowUpTimer | None, organization_id: UUID, project_id: UUID, request_id: UUID
) -> None:
    """Start the request's timer. The database stays correct if this fails; reconcile retries."""
    if timer is None:
        return
    try:
        timer.schedule(organization_id, project_id, request_id)
    except Exception:
        logger.warning("follow-up timer could not be scheduled")


def advance(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    now: datetime | None = None,
) -> int:
    """Apply one follow-up step. Returns seconds until the next check, or DONE."""
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            SELECT r.status, p.status::text, r.follow_ups_ended_at IS NOT NULL,
                   r.follow_up_after_days, r.max_follow_ups, r.outbound_message_id,
                   clock_timestamp()
            FROM pbc_requests r
            JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
            WHERE r.id = %s AND r.organization_id = %s AND r.project_id = %s
            FOR UPDATE OF r
            """,
            (request_id, organization_id, project_id),
        ).fetchone()
        if row is None:
            return DONE
        status = str(row[0])
        moment = now if now is not None else row[6]
        if status not in REMINDABLE:
            cancel_open(cursor, organization_id, project_id, None, request_id)
            return DONE
        last_reply = _last_reply(cursor, project_id, request_id)
        _settle_open(cursor, organization_id, project_id, request_id, last_reply)
        step = plan(
            request_status=status,
            project_status=str(row[1]),
            ended=row[2] is True,
            follow_up_after_days=int(row[3]),
            max_follow_ups=int(row[4]),
            first_contact_at=_first_contact(cursor, project_id, row[5]),
            last_reply_at=last_reply,
            occurrences=_occurrences(cursor, request_id),
            now=moment,
        )
        if step.kind == "remind" and step.due_at is not None:
            created = cursor.execute(
                f"""
                INSERT INTO pbc_follow_ups (
                    organization_id, project_id, pbc_request_id, sequence, due_at
                )
                VALUES (%s, %s, %s, %s, %s)
                RETURNING {_COLUMNS}
                """,
                (organization_id, project_id, request_id, step.sequence, step.due_at),
            ).fetchone()
            if created is not None:
                _audit(cursor, organization_id, project_id, None, _body(created), "follow_up.due")
            return HOLD_SECONDS
        if step.kind == "escalate":
            _escalate(cursor, organization_id, project_id, request_id, status)
            return DONE
        if step.kind == "stop":
            return DONE
        return step.seconds


MAX_SEQUENCE = 10


def follow_up_now(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    actor: UUID,
) -> FollowUpBody:
    """A person asks for a reminder now, ahead of the schedule. The reminder is due at
    once and goes through the same approval as a scheduled one; nothing is sent here.
    An open reminder is returned instead of making a second one."""
    with transaction(connection) as cursor:
        row = cursor.execute(
            "SELECT status FROM pbc_requests WHERE id = %s AND organization_id = %s "
            "AND project_id = %s FOR UPDATE",
            (request_id, organization_id, project_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if str(row[0]) not in REMINDABLE:
            raise FollowUpState("the request is not with the recipient")
        found = cursor.execute(
            f"SELECT {_COLUMNS} FROM pbc_follow_ups WHERE pbc_request_id = %s "
            "AND status IN ('DUE', 'APPROVAL_PENDING')",
            (request_id,),
        ).fetchone()
        if found is not None:
            return _body(found)
        last = cursor.execute(
            "SELECT coalesce(max(sequence), 0) FROM pbc_follow_ups WHERE pbc_request_id = %s",
            (request_id,),
        ).fetchone()
        sequence = (0 if last is None else int(last[0])) + 1
        if sequence > MAX_SEQUENCE:
            raise FollowUpState("the most reminders for this request are sent")
        created = cursor.execute(
            f"""
            INSERT INTO pbc_follow_ups (
                organization_id, project_id, pbc_request_id, sequence, due_at
            )
            VALUES (%s, %s, %s, %s, clock_timestamp())
            RETURNING {_COLUMNS}
            """,
            (organization_id, project_id, request_id, sequence),
        ).fetchone()
        if created is None:
            raise FollowUpState("the reminder could not be made")
        body = _body(created)
        _audit(cursor, organization_id, project_id, actor, body, "follow_up.requested")
        return body


def remindable_requests(
    connection: psycopg.Connection[Any],
    organization_id: UUID | None = None,
    project_id: UUID | None = None,
) -> list[tuple[UUID, UUID, UUID]]:
    rows = connection.execute(
        """
        SELECT organization_id, project_id, id
        FROM pbc_requests
        WHERE status = ANY(%s) AND follow_ups_ended_at IS NULL
          AND (%s::uuid IS NULL OR organization_id = %s)
          AND (%s::uuid IS NULL OR project_id = %s)
        ORDER BY created_at
        LIMIT 5000
        """,
        (sorted(REMINDABLE), organization_id, organization_id, project_id, project_id),
    ).fetchall()
    return [(row[0], row[1], row[2]) for row in rows]


def read_follow_up(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    follow_up_id: UUID,
) -> FollowUpBody:
    row = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM pbc_follow_ups
        WHERE id = %s AND pbc_request_id = %s AND organization_id = %s AND project_id = %s
        """,
        (follow_up_id, request_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _body(row)


def lock_follow_up(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    follow_up_id: UUID,
) -> FollowUpBody:
    row = cursor.execute(
        f"""
        SELECT {_COLUMNS}
        FROM pbc_follow_ups
        WHERE id = %s AND pbc_request_id = %s AND organization_id = %s AND project_id = %s
        FOR UPDATE
        """,
        (follow_up_id, request_id, organization_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _body(row)


def mark_submitted(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    follow_up: FollowUpBody,
    approval_id: UUID,
) -> FollowUpBody:
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE pbc_follow_ups
            SET status = 'APPROVAL_PENDING', approval_id = %s,
                updated_at = clock_timestamp(), version = version + 1
            WHERE id = %s AND project_id = %s AND status = 'DUE' AND version = %s
            RETURNING {_COLUMNS}
            """,
            (approval_id, follow_up.id, project_id, follow_up.version),
        ).fetchone()
        if row is None:
            raise FollowUpState("reminder changed")
        updated = _body(row)
        _audit(cursor, organization_id, project_id, actor_id, updated, "follow_up.submitted")
    return updated


def mark_sent(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    follow_up_id: UUID,
    outbound_id: UUID,
) -> None:
    row = cursor.execute(
        f"""
        UPDATE pbc_follow_ups
        SET status = 'SENT', outbound_id = %s, closed_at = clock_timestamp(),
            updated_at = clock_timestamp(), version = version + 1
        WHERE id = %s AND project_id = %s AND status = 'APPROVAL_PENDING'
        RETURNING {_COLUMNS}
        """,
        (outbound_id, follow_up_id, project_id),
    ).fetchone()
    if row is None:
        return
    sent = _body(row)
    _audit(cursor, organization_id, project_id, actor_id, sent, "follow_up.sent")
    moved = cursor.execute(
        """
        UPDATE pbc_requests
        SET status = 'WAITING_FOR_RESPONSE', updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND project_id = %s AND status = 'SENT'
        RETURNING id
        """,
        (sent.pbc_request_id, project_id),
    ).fetchone()
    if moved is not None:
        _request_audit(
            cursor,
            organization_id,
            project_id,
            actor_id,
            sent.pbc_request_id,
            "WAITING_FOR_RESPONSE",
        )


def close_open(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID | None,
    follow_up_id: UUID,
    status: Literal["SKIPPED", "FAILED", "CANCELLED"],
    reason: str,
    outbound_id: UUID | None = None,
) -> FollowUpBody | None:
    row = cursor.execute(
        f"""
        UPDATE pbc_follow_ups
        SET status = %s, reason = %s, outbound_id = COALESCE(outbound_id, %s),
            closed_at = clock_timestamp(), updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND project_id = %s AND status IN ('DUE', 'APPROVAL_PENDING')
        RETURNING {_COLUMNS}
        """,
        (status, reason, outbound_id if status != "SKIPPED" else None, follow_up_id, project_id),
    ).fetchone()
    if row is None:
        return None
    closed = _body(row)
    _audit(cursor, organization_id, project_id, actor_id, closed, f"follow_up.{status.lower()}")
    return closed


def cancel_open(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID | None,
    request_id: UUID,
) -> None:
    rows = cursor.execute(
        """
        SELECT id FROM pbc_follow_ups
        WHERE pbc_request_id = %s AND project_id = %s AND status IN ('DUE', 'APPROVAL_PENDING')
        """,
        (request_id, project_id),
    ).fetchall()
    for row in rows:
        close_open(
            cursor, organization_id, project_id, actor_id, row[0], "CANCELLED", "request_resolved"
        )


def _settle_open(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    last_reply: datetime | None,
) -> None:
    rows = cursor.execute(
        """
        SELECT f.id, f.status, f.created_at, a.decision::text,
               a.decision = 'EXPIRED' OR a.expires_at <= clock_timestamp(),
               EXISTS (SELECT 1 FROM outbound_messages o WHERE o.approval_id = f.approval_id)
        FROM pbc_follow_ups f
        LEFT JOIN approvals a ON a.id = f.approval_id
        WHERE f.pbc_request_id = %s AND f.project_id = %s
          AND f.status IN ('DUE', 'APPROVAL_PENDING')
        FOR UPDATE OF f
        """,
        (request_id, project_id),
    ).fetchall()
    for follow_up_id, status, created_at, decision, expired, recorded in rows:
        if status == "DUE":
            if last_reply is not None and last_reply > created_at:
                close_open(
                    cursor,
                    organization_id,
                    project_id,
                    None,
                    follow_up_id,
                    "SKIPPED",
                    "reply_received",
                )
        elif recorded is True:
            continue
        elif decision == "REJECTED":
            close_open(
                cursor,
                organization_id,
                project_id,
                None,
                follow_up_id,
                "SKIPPED",
                "approval_rejected",
            )
        elif expired is True:
            close_open(
                cursor,
                organization_id,
                project_id,
                None,
                follow_up_id,
                "FAILED",
                "approval_expired",
            )


def _escalate(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    status: str,
) -> None:
    if status == "SENT":
        cursor.execute(
            """
            UPDATE pbc_requests
            SET status = 'WAITING_FOR_RESPONSE', updated_at = clock_timestamp(),
                version = version + 1
            WHERE id = %s AND project_id = %s AND status = 'SENT'
            """,
            (request_id, project_id),
        )
        _request_audit(
            cursor, organization_id, project_id, None, request_id, "WAITING_FOR_RESPONSE"
        )
    cursor.execute(
        """
        UPDATE pbc_requests
        SET status = 'ESCALATED', escalation_state = 'ESCALATED',
            follow_ups_ended_at = clock_timestamp(), updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND project_id = %s
          AND status IN ('WAITING_FOR_RESPONSE', 'PARTIALLY_RECEIVED', 'OVERDUE')
        """,
        (request_id, project_id),
    )
    _request_audit(cursor, organization_id, project_id, None, request_id, "ESCALATED")


def _first_contact(
    cursor: psycopg.Cursor[Any], project_id: UUID, message_id: str | None
) -> datetime | None:
    if message_id is None:
        return None
    row = cursor.execute(
        """
        SELECT created_at FROM mailbox_messages
        WHERE project_id = %s AND provider_message_id = %s
        """,
        (project_id, message_id),
    ).fetchone()
    return row[0] if row is not None and isinstance(row[0], datetime) else None


def _last_reply(cursor: psycopg.Cursor[Any], project_id: UUID, request_id: UUID) -> datetime | None:
    row = cursor.execute(
        """
        SELECT max(received_at) FROM inbound_messages
        WHERE project_id = %s AND pbc_request_id = %s
          AND match_status IN ('MATCHED', 'ASSIGNED')
        """,
        (project_id, request_id),
    ).fetchone()
    return row[0] if row is not None and isinstance(row[0], datetime) else None


def _occurrences(cursor: psycopg.Cursor[Any], request_id: UUID) -> list[Occurrence]:
    rows = cursor.execute(
        "SELECT status, reason, closed_at FROM pbc_follow_ups WHERE pbc_request_id = %s",
        (request_id,),
    ).fetchall()
    return [
        Occurrence(
            status=str(row[0]),
            reason=str(row[1]),
            closed_at=row[2] if isinstance(row[2], datetime) else None,
        )
        for row in rows
    ]


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[FollowUpBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        f"""
        SELECT {_COLUMNS}
        FROM pbc_follow_ups
        WHERE organization_id = %s AND project_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 500
        """,
        (organization_id, project_id),
    ).fetchall()
    return [_body(row) for row in rows]


def _reconcile(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    timer: FollowUpTimer | None,
) -> list[FollowUpBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    for org, project, request_id in remindable_requests(connection, organization_id, project_id):
        if advance(connection, org, project, request_id) != DONE:
            schedule(timer, org, project, request_id)
    return _list(connection, principal, organization_id, project_id)


def _skip(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    follow_up_id: UUID,
    body: SkipBody,
) -> FollowUpBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        current = lock_follow_up(cursor, organization_id, project_id, request_id, follow_up_id)
        if current.version != body.version:
            raise FollowUpState("reminder changed")
        if current.status not in {"DUE", "APPROVAL_PENDING"}:
            raise FollowUpState("reminder is closed")
        if current.approval_id is not None:
            recorded = cursor.execute(
                "SELECT 1 FROM outbound_messages WHERE approval_id = %s", (current.approval_id,)
            ).fetchone()
            if recorded is not None:
                raise FollowUpState("reminder is being sent")
        skipped = close_open(
            cursor,
            organization_id,
            project_id,
            principal.id,
            follow_up_id,
            "SKIPPED",
            "skipped_by_person",
        )
        if skipped is None:
            raise FollowUpState("reminder changed")
    return skipped


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID | None,
    follow_up: FollowUpBody,
    action: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'pbc_follow_up', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor_id,
            action,
            follow_up.id,
            Json(
                {
                    "request_id": str(follow_up.pbc_request_id),
                    "sequence": follow_up.sequence,
                    "status": follow_up.status,
                    "reason": follow_up.reason,
                }
            ),
        ),
    )


def _request_audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID | None,
    request_id: UUID,
    status: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'pbc.updated', 'pbc_request', %s, %s)
        """,
        (organization_id, project_id, actor_id, request_id, Json({"status": status})),
    )


def _body(row: tuple[Any, ...]) -> FollowUpBody:
    if not isinstance(row[0], UUID) or not isinstance(row[3], str):
        raise NotVisible()
    return FollowUpBody(
        id=row[0],
        pbc_request_id=row[1],
        sequence=int(row[2]),
        status=row[3],
        due_at=row[4],
        approval_id=row[5] if isinstance(row[5], UUID) else None,
        outbound_id=row[6] if isinstance(row[6], UUID) else None,
        closed_at=row[7] if isinstance(row[7], datetime) else None,
        reason=str(row[8]),
        created_at=row[9],
        updated_at=row[10],
        version=int(row[11]),
    )
