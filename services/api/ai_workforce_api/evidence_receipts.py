"""Marking a request received when the team files evidence against it.

A file filed against a request moves it to received, or to partly received while an item
the request asked for is still not covered by any file filed to it. A request that was
sent moves as if the owner had replied, and its open follow-ups stop. A request that was
never sent (a draft, or awaiting approval) is marked as provided directly, and its send
approval, pending or approved and not yet used, is withdrawn, so the request never goes out.

Each move is recorded on a filing. When a file leaves the request (withdrawn, or moved to
another control) the request follows the evidence left on it: received while every item
still has evidence, partly received while some does, and back to where it was before any
evidence came once none is left (31 Oct 2026: withdrawing one of two items' files left the
request received).
"""

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Json

from ai_workforce_api.followups import cancel_open

ReceiptStatus = Literal["PARTIALLY_RECEIVED", "RECEIVED"]
_ANSWERED = frozenset({"SENT", "WAITING_FOR_RESPONSE", "OVERDUE", "ESCALATED"})
_UNSENT = frozenset({"DRAFT", "APPROVAL_PENDING"})
_SEND_ACTION = "mail.pbc"
# The statuses evidence moves a request to.
_EVIDENCE = frozenset({"PARTIALLY_RECEIVED", "RECEIVED"})


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
        # No drafted list to count against: a request sent from the evidence plan skips
        # its draft. Each requested item counts by its own evidence, as the plan shows
        # it (31 Oct 2026: one item's file marked such a request received, so its other
        # items read received with nothing of their own). A request with no planned
        # items is received by any file, as before.
        return not planned or _every_item_served(cursor, request_id)
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


def _every_item_served(cursor: psycopg.Cursor[Any], request_id: UUID) -> bool:
    """Whether each requested item of the request has evidence of its own: a file on the
    request that serves it (filed for it, or for the request as a whole and not read as
    missing it), a file a sibling control shares for it, or a file a person linked to it.
    The same test the evidence plan uses for an item's state (evidence_plans._requirements)."""
    from ai_workforce_api.evidence_plans import request_file_serves, shared_from_sibling

    row = cursor.execute(
        """
        SELECT count(*) FROM evidence_requirements q
        WHERE q.pbc_request_id = %s AND q.status = 'REQUESTED'
          AND NOT EXISTS (
              SELECT 1 FROM evidence_file_links l
              LEFT JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
              WHERE l.pbc_request_id = q.pbc_request_id AND {SERVES})
          AND NOT EXISTS ({SHARED})
          AND NOT EXISTS (
              SELECT 1 FROM evidence_requirement_files ef
              JOIN evidence_file_links l
                ON l.evidence_file_id = ef.evidence_file_id
               AND l.engagement_control_id = ef.engagement_control_id
              WHERE ef.requirement_id = q.id AND ef.status = 'LINKED')
        """.replace("{SERVES}", request_file_serves("l.evidence_file_id")).replace(
            "{SHARED}", shared_from_sibling("1")
        ),
        (request_id,),
    ).fetchone()
    return row is not None and int(row[0]) == 0


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
    # A request whose every item a person accepted is received, as when the last item is
    # accepted (evidence_plans._received_when_accepted): a file restored to it puts it back
    # where its withdrawal found it.
    whole = covered(cursor, project_id, request_id) or _every_item_accepted(cursor, request_id)
    target: ReceiptStatus = "RECEIVED" if whole else "PARTIALLY_RECEIVED"
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


@dataclass(frozen=True)
class Released:
    """The receipt a filing recorded, taken off it as its file leaves the request."""

    request_id: UUID
    # The request's status before evidence moved it, as this filing recorded it.
    before: str | None


def release_receipt(cursor: psycopg.Cursor[Any], match_id: UUID) -> Released | None:
    """Take the receipt record off a filing whose file is leaving its request."""
    row = cursor.execute(
        "SELECT receipt_request_id, receipt_status_before FROM evidence_matches "
        "WHERE id = %s FOR UPDATE",
        (match_id,),
    ).fetchone()
    if row is None or row[0] is None:
        return None
    cursor.execute(
        "UPDATE evidence_matches SET receipt_request_id = NULL, receipt_status_before = NULL, "
        "receipt_status_set = NULL, version = version + 1 WHERE id = %s",
        (match_id,),
    )
    return Released(UUID(str(row[0])), None if row[1] is None else str(row[1]))


def follow_evidence(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    actor_id: UUID,
    before: str | None = None,
) -> None:
    """After a file left the request, move the request to what the evidence left on it
    shows. Called once the file is off the request (withdrawn, or filed elsewhere), with
    the status `before` its filing recorded, if it recorded one. A request evidence never
    moved, or one moved on since (closed, cancelled), is left alone."""
    row = cursor.execute(
        "SELECT status FROM pbc_requests WHERE id = %s AND project_id = %s FOR UPDATE",
        (request_id, project_id),
    ).fetchone()
    if row is None or str(row[0]) not in _EVIDENCE:
        return
    status = str(row[0])
    records = [
        (UUID(str(found[0])), None if found[1] is None else str(found[1]))
        for found in cursor.execute(
            "SELECT id, receipt_status_before FROM evidence_matches "
            "WHERE receipt_request_id = %s ORDER BY id FOR UPDATE",
            (request_id,),
        ).fetchall()
    ]
    if before is None and not records:
        return
    # Where the request was before any evidence came: the first recorded status that is
    # not itself a receipt.
    origins = [
        value
        for value in [before, *(record[1] for record in records)]
        if value is not None and value not in _EVIDENCE
    ]
    origin = origins[0] if origins else None
    if _evidence_left(cursor, request_id):
        whole = covered(cursor, project_id, request_id) or _every_item_accepted(cursor, request_id)
        target = "RECEIVED" if whole else "PARTIALLY_RECEIVED"
    elif origin is not None:
        # A withdrawn send approval does not come back, so an unsent request returns to draft.
        target = "DRAFT" if origin in _UNSENT else origin
    else:
        return
    if target != status:
        cursor.execute(
            """
            UPDATE pbc_requests
            SET status = %s,
                provided_directly = CASE WHEN %s = 'DRAFT' THEN false ELSE provided_directly END,
                escalation_state = CASE WHEN %s = 'ESCALATED' THEN 'ESCALATED' ELSE 'NONE' END,
                received_at = CASE WHEN %s = 'RECEIVED' THEN received_at ELSE NULL END,
                updated_at = clock_timestamp(),
                version = version + 1
            WHERE id = %s AND project_id = %s
            """,
            (target, target, target, target, request_id, project_id),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            actor_id,
            request_id,
            "pbc.receipt_undone",
            {"status": target, "from": status},
        )
    if target not in _EVIDENCE:
        cursor.execute(
            "UPDATE evidence_matches SET receipt_request_id = NULL, receipt_status_before = NULL, "
            "receipt_status_set = NULL, version = version + 1 WHERE receipt_request_id = %s",
            (request_id,),
        )
        return
    # Keep the record that puts the request back when its last file leaves.
    if records:
        cursor.execute(
            "UPDATE evidence_matches SET receipt_status_set = %s, version = version + 1 "
            "WHERE receipt_request_id = %s",
            (target, request_id),
        )
        if origin is not None and not any(record[1] == origin for record in records):
            cursor.execute(
                "UPDATE evidence_matches SET receipt_status_before = %s WHERE id = %s",
                (origin, records[0][0]),
            )
    elif origin is not None:
        cursor.execute(
            """
            UPDATE evidence_matches
            SET receipt_request_id = %s, receipt_status_before = %s, receipt_status_set = %s,
                version = version + 1
            WHERE id = (
                SELECT m.id FROM evidence_matches m
                JOIN evidence_file_links l
                  ON l.evidence_file_id = m.evidence_file_id
                 AND l.pbc_request_id = m.pbc_request_id
                WHERE m.pbc_request_id = %s AND m.receipt_request_id IS NULL
                ORDER BY m.id LIMIT 1
            )
            """,
            (request_id, origin, target, request_id),
        )


def _evidence_left(cursor: psycopg.Cursor[Any], request_id: UUID) -> bool:
    """Whether any file is still on the request, or linked by a person to one of its items."""
    row = cursor.execute(
        """
        SELECT EXISTS (SELECT 1 FROM evidence_file_links WHERE pbc_request_id = %s)
            OR EXISTS (
                SELECT 1 FROM evidence_requirement_files ef
                JOIN evidence_requirements q ON q.id = ef.requirement_id
                JOIN evidence_file_links l
                  ON l.evidence_file_id = ef.evidence_file_id
                 AND l.engagement_control_id = ef.engagement_control_id
                WHERE q.pbc_request_id = %s AND q.status = 'REQUESTED' AND ef.status = 'LINKED')
        """,
        (request_id, request_id),
    ).fetchone()
    return row is not None and bool(row[0])


def _every_item_accepted(cursor: psycopg.Cursor[Any], request_id: UUID) -> bool:
    """Whether a person accepted every requested item: such a request stays received
    (evidence_plans._received_when_accepted)."""
    row = cursor.execute(
        "SELECT count(*), count(*) FILTER (WHERE sufficiency = 'ACCEPTED') "
        "FROM evidence_requirements WHERE pbc_request_id = %s AND status = 'REQUESTED'",
        (request_id,),
    ).fetchone()
    return row is not None and int(row[0]) > 0 and int(row[0]) == int(row[1])


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
    # An approved send not yet used is withdrawn too: recorded as never executed, so the
    # approval can no longer send the request. One whose send is in flight (its outcome
    # pending or unknown) is left to its reconciliation, which finds the message sent or
    # refuses it now that the request is received (outbound._verified). Bug hunt, 9
    # November 2026: an approved send stayed live after the evidence came directly.
    approved = cursor.execute(
        """
        UPDATE approvals a
        SET execution_status = 'REFUSED', version = version + 1
        WHERE a.organization_id = %s AND a.project_id = %s AND a.action_id = %s
          AND a.decision = 'APPROVED' AND a.execution_status = 'NOT_STARTED'
          AND a.parameters ->> 'request_ref' LIKE %s
          AND NOT EXISTS (
              SELECT 1 FROM outbound_messages o
              WHERE o.approval_id = a.id AND o.status IN ('PENDING', 'UNKNOWN'))
        RETURNING a.id
        """,
        (organization_id, project_id, _SEND_ACTION, f"pbc/{request_id}/%"),
    ).fetchall()
    for (approval_id,) in approved:
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
                Json({"execution_status": "REFUSED", "reason": "evidence provided directly"}),
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
