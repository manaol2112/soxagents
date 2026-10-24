"""Marking a request received when the team files evidence against it.

A file filed against a request moves it to received, or to partly received while an item
the request asked for is still not covered by any file filed to it. A request that was
sent moves as if the owner had replied, and its open follow-ups stop. A request that was
never sent (a draft, or awaiting approval) is marked as provided directly, and its pending
send approval is withdrawn, so the request never goes out.

Each move is recorded on the filing, so changing a file to another control can put the
request back while nothing else has moved it since.
"""

from typing import Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Json

from ai_workforce_api.followups import cancel_open

ReceiptStatus = Literal["PARTIALLY_RECEIVED", "RECEIVED"]
_ANSWERED = frozenset({"SENT", "WAITING_FOR_RESPONSE", "OVERDUE", "ESCALATED"})
_UNSENT = frozenset({"DRAFT", "APPROVAL_PENDING"})
_SEND_ACTION = "mail.pbc"


def covered(cursor: psycopg.Cursor[Any], project_id: UUID, request_id: UUID) -> bool:
    """Whether the files filed to the request, together, cover every requested item. An
    item is placed by the requirement the reader names where it names one, in the order
    the request lists its requirements (evidence_analysis._planned_items): a file added
    for one item is read against that item alone, so its first item is not the request's."""
    planned = [
        str(row[0])
        for row in cursor.execute(
            """
            SELECT id FROM evidence_requirements
            WHERE pbc_request_id = %s AND status = 'REQUESTED'
            ORDER BY CASE necessity WHEN 'REQUIRED' THEN 0 WHEN 'CONDITIONAL' THEN 1 ELSE 2 END,
                     created_at, requirement_key
            """,
            (request_id,),
        ).fetchall()
    ]
    draft = cursor.execute(
        "SELECT content FROM pbc_drafts WHERE pbc_request_id = %s AND status = 'DRAFTED'",
        (request_id,),
    ).fetchone()
    wanted = 0
    if draft is not None and isinstance(draft[0], dict):
        items = draft[0].get("items", [])
        wanted = min(len(items), 8) if isinstance(items, list) else 0
    if wanted == 0:
        return True
    rows = cursor.execute(
        """
        SELECT a.classification FROM evidence_file_links l
        JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
        WHERE l.project_id = %s AND l.pbc_request_id = %s AND a.status = 'READY'
        """,
        (project_id, request_id),
    ).fetchall()
    found: set[int] = set()
    for (classification,) in rows:
        if not isinstance(classification, dict):
            continue
        for item in classification.get("items", []):
            if not isinstance(item, dict) or item.get("coverage") != "COVERED":
                continue
            named = str(item.get("requirement_id") or "")
            if named in planned:
                found.add(planned.index(named))
            elif isinstance(item.get("index"), int):
                found.add(item["index"])
    return all(index in found for index in range(wanted))


def apply_receipt(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    match_id: UUID,
    request_id: UUID,
    actor_id: UUID,
    by: Literal["AGENT", "PERSON", "OWNER"],
) -> ReceiptStatus | None:
    """Move the request for a filed file. Returns the new status, or None if it stays."""
    row = cursor.execute(
        "SELECT status FROM pbc_requests WHERE id = %s AND project_id = %s FOR UPDATE",
        (request_id, project_id),
    ).fetchone()
    if row is None:
        return None
    before = str(row[0])
    target: ReceiptStatus = (
        "RECEIVED" if covered(cursor, project_id, request_id) else "PARTIALLY_RECEIVED"
    )
    if before in ("RECEIVED", "CLOSED", "CANCELLED") or before == target:
        return None
    if before not in _ANSWERED and before not in _UNSENT and before != "PARTIALLY_RECEIVED":
        return None
    unsent = before in _UNSENT
    cursor.execute(
        """
        UPDATE pbc_requests
        SET status = %s,
            provided_directly = provided_directly OR %s,
            escalation_state = 'NONE',
            first_response_at = coalesce(first_response_at, clock_timestamp()),
            received_at = CASE WHEN %s = 'RECEIVED' THEN clock_timestamp() ELSE NULL END,
            updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND project_id = %s
        """,
        (target, unsent, target, request_id, project_id),
    )
    if unsent:
        _withdraw_send(cursor, organization_id, project_id, request_id, actor_id)
    if target == "RECEIVED":
        cancel_open(cursor, organization_id, project_id, actor_id, request_id)
    # The first move is what a change of control puts back.
    cursor.execute(
        """
        UPDATE evidence_matches
        SET receipt_request_id = %s,
            receipt_status_before = coalesce(receipt_status_before, %s),
            receipt_status_set = %s,
            version = version + 1
        WHERE id = %s
        """,
        (request_id, before, target, match_id),
    )
    _audit(
        cursor,
        organization_id,
        project_id,
        actor_id,
        request_id,
        "pbc.received_from_evidence",
        {"status": target, "from": before, "by": by, "provided_directly": unsent},
    )
    return target


def undo_receipt(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    match_id: UUID,
    actor_id: UUID,
) -> None:
    """Put the request back when its only filed file moves away, if nothing else moved it."""
    row = cursor.execute(
        """
        SELECT receipt_request_id, receipt_status_before, receipt_status_set, evidence_file_id
        FROM evidence_matches WHERE id = %s FOR UPDATE
        """,
        (match_id,),
    ).fetchone()
    if row is None or row[0] is None:
        return
    request_id, before, set_to, file_id = UUID(str(row[0])), str(row[1]), str(row[2]), row[3]
    cursor.execute(
        "UPDATE evidence_matches SET receipt_request_id = NULL, receipt_status_before = NULL, "
        "receipt_status_set = NULL, version = version + 1 WHERE id = %s",
        (match_id,),
    )
    others = cursor.execute(
        "SELECT 1 FROM evidence_file_links WHERE pbc_request_id = %s AND evidence_file_id <> %s",
        (request_id, file_id),
    ).fetchone()
    if others is not None:
        return
    # A withdrawn approval does not come back, so an unsent request returns to draft.
    restored = "DRAFT" if before in _UNSENT else before
    moved = cursor.execute(
        """
        UPDATE pbc_requests
        SET status = %s,
            provided_directly = CASE WHEN %s THEN false ELSE provided_directly END,
            escalation_state = CASE WHEN %s = 'ESCALATED' THEN 'ESCALATED' ELSE 'NONE' END,
            received_at = NULL,
            updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND project_id = %s AND status = %s
        RETURNING id
        """,
        (restored, before in _UNSENT, restored, request_id, project_id, set_to),
    ).fetchone()
    if moved is not None:
        _audit(
            cursor,
            organization_id,
            project_id,
            actor_id,
            request_id,
            "pbc.receipt_undone",
            {"status": restored, "from": set_to},
        )


def _withdraw_send(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    actor_id: UUID,
) -> None:
    rows = cursor.execute(
        """
        UPDATE approvals
        SET decision = 'EXPIRED', decided_at = clock_timestamp(), version = version + 1
        WHERE organization_id = %s AND project_id = %s AND action_id = %s
          AND decision = 'PENDING' AND parameters ->> 'request_ref' LIKE %s
        RETURNING id
        """,
        (organization_id, project_id, _SEND_ACTION, f"pbc/{request_id}/%"),
    ).fetchall()
    for (approval_id,) in rows:
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'approval.withdrawn', 'approval', %s, %s)
            """,
            (
                organization_id,
                project_id,
                actor_id,
                approval_id,
                Json({"decision": "EXPIRED", "reason": "evidence provided directly"}),
            ),
        )


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    request_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'pbc_request', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, request_id, Json(payload)),
    )
