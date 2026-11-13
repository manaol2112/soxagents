"""Marking a request received when the team files evidence against it.

A file filed against a request moves it to received, or to partly received while an item
the request asked for is still not covered by any file filed to it. A request that was
sent moves as if the owner had replied, and its open follow-ups stop. A request that was
never sent (a draft, or awaiting approval) is marked as provided directly, and its send
approval, pending or approved and not yet used, is withdrawn, so the request never goes out.

Evidence already in hand is per item (B1g, product owner, 12 November 2026). Before, a
file for one item of an unsent request marked the whole request received and withdrew its
send, so its other items were never asked for. Now, for a D&I request drafted from the
plan and never sent nor handed over, the items with evidence of their own stay on the
request, which is received as provided directly (nothing is sent for them), and the items
with none leave it and are requested again in a draft of their own, worded from the plan
without the items in hand; that draft needs a person's approval like any other, and an
approval of the earlier wording is withdrawn, never carried over. A file that serves no
item leaves the request as it was: it still goes out. When every item is in hand nothing
is sent, as before. The interim and roll-forward requests behave as before.

Each move is recorded on a filing. When a file leaves the request (withdrawn, or moved to
another control) the request follows the evidence left on it: received while every item
still has evidence, partly received while some does, and back to where it was before any
evidence came once none is left (31 Oct 2026: withdrawing one of two items' files left the
request received).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Json

from ai_workforce_api.followups import cancel_open
from ai_workforce_api.pbc import handover_of, record_handover_withdrawn

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
    for one item is read against that item alone, so its first item is not the request's.

    A file filed for one item (its filing names the requirement) counts only for that item
    and the items it is linked to, whatever else its reading found: the rule
    evidence_plans.request_file_serves applies. A file of the D&I evidence wizard is read
    against every D&I item of its control (evidence_wizard.py), so its reading names items
    it is not filed for (independent review of the wizard, 13 November 2026: a combined
    file placed from a row on one item marked the whole request received). An item the
    reading names on another request is not this request's; one it names on this request
    that is no longer requested (waived, removed) counts by its place in the list, as
    before."""
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
    # Every requirement this request carries or carried, whatever its status now.
    here = {
        str(row[0])
        for row in cursor.execute(
            "SELECT id FROM evidence_requirements WHERE pbc_request_id = %s", (request_id,)
        ).fetchall()
    }
    rows = cursor.execute(
        """
        SELECT a.classification,
               (SELECT m.requirement_id::text FROM evidence_matches m
                WHERE m.evidence_file_id = l.evidence_file_id AND m.status = 'FILED'),
               ARRAY(SELECT ef.requirement_id::text FROM evidence_requirement_files ef
                     WHERE ef.evidence_file_id = l.evidence_file_id AND ef.status = 'LINKED')
        FROM evidence_file_links l
        JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
        WHERE l.project_id = %s AND l.pbc_request_id = %s AND a.status = 'READY'
        """,
        (project_id, request_id),
    ).fetchall()
    found: set[int] = set()
    for classification, filed_for, linked in rows:
        if not isinstance(classification, dict):
            continue
        # Filed for one item: it counts for that item and those it is linked to only.
        allowed = None if filed_for is None else {str(filed_for), *(str(x) for x in linked)}
        for item in classification.get("items", []):
            if not isinstance(item, dict) or item.get("coverage") != "COVERED":
                continue
            named = str(item.get("requirement_id") or "")
            if allowed is not None and named not in allowed:
                continue
            if named in planned:
                found.add(planned.index(named))
            elif named and named not in here:
                # Another request's item (a wizard file is read against every D&I item).
                continue
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


# Whether a request is one the per-item rule applies to (B1g): a D&I request drafted
# from the plan and never handed over. A message recorded for it and not definitively
# failed may be with the owner (pending, or its outcome unknown, or delivered): the request
# is then treated as asked for, whole, and is never split. Approved or sent with other
# requests as one email: likewise. SQL over pbc_requests as r, inside a query with
# parameters (hence the doubled %).
_PER_ITEM = """
    (r.testing_phase = 'DESIGN' AND r.engagement_control_id IS NOT NULL
     AND r.operation_key LIKE 'plan-%%' AND r.handed_over_at IS NULL
     AND NOT EXISTS (
         SELECT 1 FROM outbound_messages o
         WHERE o.pbc_request_id = r.id AND o.status <> 'FAILED')
     AND NOT EXISTS (
         SELECT 1 FROM evidence_request_group_members m
         JOIN evidence_request_groups g ON g.id = m.group_id
         WHERE m.pbc_request_id = r.id AND m.released_at IS NULL
           AND g.status IN ('APPROVED', 'SENT')))
"""


def apply_receipt(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    match_id: UUID | None,
    request_id: UUID,
    actor_id: UUID,
    by: Literal["AGENT", "PERSON", "OWNER"],
) -> ReceiptStatus | None:
    """Move the request for a filed file. Returns the new status, or None if it stays.
    Without `match_id` (evidence in hand for an item by a link, not a filing on this
    request: a wizard bundle's further item), the move is recorded on the request alone."""
    moved, _split = _receive(
        cursor, organization_id, project_id, match_id, request_id, actor_id, by
    )
    return moved


def settle_in_hand(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    actor_id: UUID,
) -> Literal["SPLIT", "IN_HAND"] | None:
    """Before an unsent D&I request goes for approval: evidence already in hand for its
    items is applied now (the file's reading may not have finished, or the evidence was
    linked, which moves no request by itself), so nobody approves a wording that asks for
    an item in hand. SPLIT: some items were in hand, and the rest are now asked for in a
    draft without them. IN_HAND: every item was, so the request is received as provided
    directly and nothing needs sending. None: nothing is in hand and the request goes on
    as it is. Only for the requests the per-item rule covers (_receive)."""
    row = cursor.execute(
        "SELECT status FROM pbc_requests WHERE id = %s AND project_id = %s",
        (request_id, project_id),
    ).fetchone()
    if row is None or str(row[0]) not in _UNSENT:
        return None
    reading = cursor.execute(
        "SELECT 1 FROM evidence_matches m "
        "JOIN evidence_analyses a ON a.evidence_file_id = m.evidence_file_id "
        "WHERE m.pbc_request_id = %s AND m.status = 'FILED' AND m.requirement_id IS NULL "
        "AND a.status IN ('PENDING', 'WORKING') LIMIT 1",
        (request_id,),
    ).fetchone()
    if reading is not None:
        # A file added on the request as a whole serves the items its reading finds it
        # covers: until it is read, which items it puts in hand is not known, and the
        # reading applies it when it ends (apply_receipt), approved or not.
        return None
    match = cursor.execute(
        "SELECT m.id FROM evidence_matches m JOIN evidence_file_links l "
        "ON l.evidence_file_id = m.evidence_file_id AND l.pbc_request_id = m.pbc_request_id "
        "WHERE m.pbc_request_id = %s AND m.status = 'FILED' ORDER BY m.id LIMIT 1",
        (request_id,),
    ).fetchone()
    moved, split = _receive(
        cursor, organization_id, project_id, None if match is None else UUID(str(match[0])),
        request_id, actor_id, "PERSON", settling=True,
    )  # fmt: skip
    if moved is None:
        return None
    return "SPLIT" if split else "IN_HAND"


class _KeepAsItWas(Exception):
    """Nothing was asked for again: the request is left as it was."""


def ask_again_for_items_left(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    actor_id: UUID,
) -> bool:
    """After a person moved evidence off an item in the D&I evidence wizard
    (evidence_wizard.move), on a D&I request that was only ever provided directly (never
    emailed nor handed over, the requests the per-item rule covers): the request is put
    back where it was before evidence came (a draft) and what is still in hand is applied
    again, item by item (settle_in_hand), so the items left without evidence of their own
    are asked for again in a draft of their own, which needs a person's approval like any
    other, and the items in hand stay on it, received as provided directly. When nothing
    can be asked for again (nothing left without evidence, nothing in hand, a file on it
    still being read, the items cannot be requested now) the request is left as it was.
    Outside the wizard, evidence taken off an item leaves the request as follow_evidence
    puts it. Returns whether items were asked for again."""
    cursor.execute(
        "SELECT 1 FROM evidence_plans p JOIN pbc_requests r "
        "ON r.engagement_control_id = p.engagement_control_id AND r.project_id = p.project_id "
        "WHERE r.id = %s AND r.project_id = %s AND r.testing_phase = 'DESIGN' FOR UPDATE OF p",
        (request_id, project_id),
    )
    row = cursor.execute(
        f"""
        SELECT r.status, {_PER_ITEM}
               AND r.provided_directly AND r.outbound_message_id IS NULL
        FROM pbc_requests r WHERE r.id = %s AND r.project_id = %s FOR UPDATE OF r
        """,  # noqa: S608
        (request_id, project_id),
    ).fetchone()
    if row is None or str(row[0]) not in _EVIDENCE or not row[1]:
        return False
    in_hand, left = _items(cursor, request_id)
    if not in_hand or not left:
        return False
    try:
        with cursor.connection.transaction():
            cursor.execute(
                """
                UPDATE pbc_requests
                SET status = 'DRAFT', provided_directly = false, received_at = NULL,
                    updated_at = clock_timestamp(), version = version + 1
                WHERE id = %s AND project_id = %s
                """,
                (request_id, project_id),
            )
            _audit(
                cursor, organization_id, project_id, actor_id, request_id,
                "pbc.receipt_undone",
                {"status": "DRAFT", "from": str(row[0]),
                 "reason": "evidence was moved off an item; what is in hand is applied again"},
            )  # fmt: skip
            if settle_in_hand(cursor, organization_id, project_id, request_id, actor_id) != (
                "SPLIT"
            ):
                raise _KeepAsItWas()
    except _KeepAsItWas:
        return False
    return True


def _receive(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    match_id: UUID | None,
    request_id: UUID,
    actor_id: UUID,
    by: Literal["AGENT", "PERSON", "OWNER"],
    *,
    settling: bool = False,
) -> tuple[ReceiptStatus | None, bool]:
    """The move, and whether items were taken off the request to be asked for on their
    own. `settling` (settle_in_hand): only where the per-item rule applies, and only when
    something is in hand."""
    # The plan's row before the request and its requirements, as every writer of a plan
    # takes them (evidence_plans.issue): the items left to ask for are requested again.
    cursor.execute(
        "SELECT 1 FROM evidence_plans p JOIN pbc_requests r "
        "ON r.engagement_control_id = p.engagement_control_id AND r.project_id = p.project_id "
        "WHERE r.id = %s AND r.project_id = %s AND r.testing_phase = 'DESIGN' FOR UPDATE OF p",
        (request_id, project_id),
    )
    row = cursor.execute(
        f"""
        SELECT r.status, r.engagement_control_id, {_PER_ITEM}
        FROM pbc_requests r WHERE r.id = %s AND r.project_id = %s FOR UPDATE OF r
        """,  # noqa: S608
        (request_id, project_id),
    ).fetchone()
    if row is None:
        return None, False
    before = str(row[0])
    # A request whose every item a person accepted is received, as when the last item is
    # accepted (evidence_plans._received_when_accepted): a file restored to it puts it back
    # where its withdrawal found it.
    whole = covered(cursor, project_id, request_id) or _every_item_accepted(cursor, request_id)
    unsent = before in _UNSENT
    # Per item (B1g): on an unsent D&I request of the plan, never handed over, the items
    # with no evidence of their own are still to be asked for.
    left: list[UUID] = []
    served = False
    if unsent and bool(row[2]) and (settling or not whole):
        in_hand, left = _items(cursor, request_id)
        if not in_hand:
            # No file serves any of its items: nothing is in hand, so the request stays
            # as it is and still goes out for all of them.
            return None, False
        # Every item it keeps has evidence of its own: it is received, whatever the
        # coordinator's draft counted (one answer with settle_in_hand's IN_HAND).
        served = True
    elif settling:
        return None, False
    if before in ("RECEIVED", "CLOSED", "CANCELLED"):
        return None, False
    if before not in _ANSWERED and before not in _UNSENT and before != "PARTIALLY_RECEIVED":
        return None, False

    def move(target: ReceiptStatus, aside: list[UUID]) -> None:
        _move(
            cursor, organization_id, project_id, match_id, request_id, actor_id, by,
            before, target, aside, None if row[1] is None else UUID(str(row[1])),
        )  # fmt: skip

    if left:
        try:
            # All of it or none: the items taken off are requested again in the same
            # step, or the request is left whole.
            with cursor.connection.transaction():
                move("RECEIVED", left)
            return "RECEIVED", True
        except _NotRequested:
            # The items left to ask for cannot be requested now (the engagement is not
            # running, the control is out of scope, a kickoff draft waits to be settled
            # against the plan): no item is left without a request. The request stays
            # whole: untouched before an approval, and as before for a file that came.
            if settling:
                return None, False
            served = False
    target: ReceiptStatus = "RECEIVED" if whole or served else "PARTIALLY_RECEIVED"
    if before == target:
        return None, False
    move(target, [])
    return target, False


class _NotRequested(Exception):
    """An item taken off a request could not be requested again."""


def _move(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    match_id: UUID | None,
    request_id: UUID,
    actor_id: UUID,
    by: Literal["AGENT", "PERSON", "OWNER"],
    before: str,
    target: ReceiptStatus,
    left: list[UUID],
    control_id: UUID | None,
) -> None:
    """Record the request's move for the evidence on it; with `left`, the items still to
    be asked for leave it first and are requested again last (_NotRequested if not)."""
    unsent = before in _UNSENT
    if left:
        assert control_id is not None
        _set_aside(cursor, project_id, control_id, request_id, left, before)
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
    if match_id is not None:
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
        {"status": target, "from": before, "by": by, "provided_directly": unsent,
         # Moved by a link, not a filing: no filing records where it was (follow_evidence).
         **({"by_link": True} if match_id is None else {})},
    )  # fmt: skip
    if left:
        assert control_id is not None
        _request_again(cursor, organization_id, project_id, control_id, request_id, actor_id, left)


def _items(cursor: psycopg.Cursor[Any], request_id: UUID) -> tuple[list[UUID], list[UUID]]:
    """The request's items with evidence of their own, and those with none: the test of
    _every_item_served, item by item (a file on the request that serves the item, one a
    sibling control shares for it, or one a person linked to it)."""
    from ai_workforce_api.evidence_plans import request_file_serves, shared_from_sibling

    rows = cursor.execute(
        """
        SELECT q.id,
               EXISTS (
                   SELECT 1 FROM evidence_file_links l
                   LEFT JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
                   WHERE l.pbc_request_id = q.pbc_request_id AND {SERVES})
               OR EXISTS ({SHARED})
               OR EXISTS (
                   SELECT 1 FROM evidence_requirement_files ef
                   JOIN evidence_file_links l
                     ON l.evidence_file_id = ef.evidence_file_id
                    AND l.engagement_control_id = ef.engagement_control_id
                   WHERE ef.requirement_id = q.id AND ef.status = 'LINKED')
        FROM evidence_requirements q
        WHERE q.pbc_request_id = %s AND q.status = 'REQUESTED'
        ORDER BY q.created_at, q.requirement_key
        FOR UPDATE OF q
        """.replace("{SERVES}", request_file_serves("l.evidence_file_id")).replace(
            "{SHARED}", shared_from_sibling("1")
        ),
        (request_id,),
    ).fetchall()
    in_hand = [UUID(str(item[0])) for item in rows if item[1]]
    left = [UUID(str(item[0])) for item in rows if not item[1]]
    return in_hand, left


IN_HAND_NOTE = "Asked for on its own: evidence for another item of its request was in hand."


def _set_aside(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    control_id: UUID,
    request_id: UUID,
    left: list[UUID],
    before: str,
) -> None:
    """Take the items still to be asked for off the request, which keeps only the items
    whose evidence is in hand and is worded again for what it now holds (it is not sent:
    it is received as provided directly, and an approval of its earlier wording is
    withdrawn by the caller). The coordinator's draft of it no longer says what it holds,
    so it stops counting (covered() then reads each item's own evidence)."""
    from ai_workforce_api.evidence_plans import render_into

    cursor.execute(
        """
        UPDATE evidence_requirements
        SET status = CASE WHEN depends_on IS NULL THEN 'PLANNED' ELSE 'AWAITING_DEPENDENCY' END,
            pbc_request_id = NULL, coverage_note = %s, version = version + 1
        WHERE id = ANY(%s) AND pbc_request_id = %s
        """,
        (IN_HAND_NOTE, left, request_id),
    )
    # Before its status moves and its send approval is withdrawn, in this transaction:
    # the request is never left approved for a wording it no longer has.
    assert before in _UNSENT
    render_into(cursor, project_id, control_id, request_id, unsent=True)
    cursor.execute(
        """
        UPDATE pbc_drafts
        SET status = 'SKIPPED', source = NULL, content = NULL, lease_until = NULL,
            note = 'Evidence for its items was in hand; the rest are asked for on their own.',
            version = version + 1, updated_at = clock_timestamp()
        WHERE pbc_request_id = %s
        """,
        (request_id,),
    )


def _request_again(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    request_id: UUID,
    actor_id: UUID,
    left: list[UUID],
) -> None:
    """Request the items taken off a request whose other items were in hand, as any planned
    item is requested (evidence_plans.issue: the same gates, the same draft request per
    control and phase). The request is worded from the plan, item by item, by the reviewed
    rendering and with no model: it is ready for a person at once, never waiting on a
    worker, and it is sent only on a person's approval of that wording. A request made
    for them is addressed as the one they left was (who it goes to, who is copied, when
    it is due), which a person may have set."""
    from ai_workforce_api.evidence_plans import issue

    # Only the items taken off: nothing else of the control is requested by a file.
    issued = issue(
        cursor, organization_id, project_id, control_id, actor_id, "evidence_in_hand", only=left
    )
    if issued.created:
        cursor.execute(
            """
            UPDATE pbc_requests n
            SET recipient = o.recipient, cc_recipients = o.cc_recipients, due_at = o.due_at,
                follow_up_after_days = o.follow_up_after_days,
                max_follow_ups = o.max_follow_ups, priority = o.priority,
                version = n.version + 1
            FROM pbc_requests o
            WHERE o.id = %s AND n.id = ANY(%s) AND n.status = 'DRAFT'
            """,
            (request_id, issued.created),
        )
    if issued.rewritten:
        # A draft they joined was worded again from the plan (render_into): what the
        # coordinator drafted for it before no longer lists its items.
        cursor.execute(
            """
            UPDATE pbc_drafts
            SET status = 'SKIPPED', source = NULL, content = NULL, lease_until = NULL,
                note = 'Items joined it after it was drafted; the plan''s wording stands.',
                version = version + 1, updated_at = clock_timestamp()
            WHERE pbc_request_id = ANY(%s) AND status <> 'DRAFTING'
            """,
            (issued.rewritten,),
        )
    placed = cursor.execute(
        "SELECT q.pbc_request_id FROM evidence_requirements q "
        "LEFT JOIN pbc_requests r ON r.id = q.pbc_request_id AND r.status = 'DRAFT' "
        "WHERE q.id = ANY(%s) AND q.status = 'REQUESTED' AND r.id IS NOT NULL",
        (left,),
    ).fetchall()
    if len(placed) != len(left):
        raise _NotRequested()
    carried = sorted({str(item[0]) for item in placed})
    _audit(
        cursor,
        organization_id,
        project_id,
        actor_id,
        request_id,
        "pbc.items_requested_separately",
        {
            "requirements": [str(item) for item in left],
            "requests": carried,
            "reason": "evidence for the request's other items was in hand",
        },
    )


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
        "SELECT status, provided_directly AND outbound_message_id IS NULL "
        "AND handed_over_at IS NULL "
        "FROM pbc_requests WHERE id = %s AND project_id = %s FOR UPDATE",
        (request_id, project_id),
    ).fetchone()
    if row is None or str(row[0]) not in _EVIDENCE:
        return
    status = str(row[0])
    never_asked = bool(row[1])
    records = [
        (UUID(str(found[0])), None if found[1] is None else str(found[1]))
        for found in cursor.execute(
            "SELECT id, receipt_status_before FROM evidence_matches "
            "WHERE receipt_request_id = %s ORDER BY id FOR UPDATE",
            (request_id,),
        ).fetchall()
    ]
    if before is None and not records:
        if never_asked:
            # Received only from evidence provided directly, with no filing that recorded
            # where it was (the evidence in hand was a person's link, settle_in_hand): it
            # was never sent nor handed over, so it was a draft.
            before = "DRAFT"
        else:
            # Received by a link, not a filing (a D&I evidence wizard bundle's further
            # item, apply_receipt without a filing): where the link's receipt found it.
            before = _linked_from(cursor, request_id)
            if before is None:
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
    handed = handover_of(cursor, project_id, request_id) if target == "DRAFT" else None
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
        if target == "DRAFT" and handed is not None:
            # No longer with the owner as approved: said on the trail, by whom and why
            # (the database refuses a hand-over that ends with no such record).
            record_handover_withdrawn(
                cursor, organization_id, project_id, request_id, actor_id, handed,
                "its evidence was withdrawn",
            )  # fmt: skip
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


def _linked_from(cursor: psycopg.Cursor[Any], request_id: UUID) -> str | None:
    """Where the latest receipt a link recorded on the request found it (its audit event
    says, since no filing on the request recorded it), when that was not itself a receipt."""
    row = cursor.execute(
        """
        SELECT payload ->> 'from' FROM audit_events
        WHERE target_type = 'pbc_request' AND target_id = %s
          AND action = 'pbc.received_from_evidence'
          AND coalesce((payload ->> 'by_link')::boolean, false)
          AND payload ->> 'from' NOT IN ('PARTIALLY_RECEIVED', 'RECEIVED')
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
        """,
        (request_id,),
    ).fetchone()
    return None if row is None or row[0] is None else str(row[0])


def linked_requests(cursor: psycopg.Cursor[Any], file_id: UUID) -> list[UUID]:
    """The requests of the D&I items a file is linked to (evidence_requirement_files), in
    a fixed order: a link moves its item's request too (a D&I evidence wizard bundle)."""
    return [
        UUID(str(row[0]))
        for row in cursor.execute(
            """
            SELECT DISTINCT q.pbc_request_id FROM evidence_requirement_files ef
            JOIN evidence_requirements q ON q.id = ef.requirement_id
            WHERE ef.evidence_file_id = %s AND ef.status = 'LINKED' AND q.phase = 'DESIGN'
              AND q.pbc_request_id IS NOT NULL
            ORDER BY q.pbc_request_id
            """,
            (file_id,),
        ).fetchall()
    ]


def follow_linked(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    actor_id: UUID,
    followed: Sequence[UUID | None] = (),
) -> list[UUID]:
    """After a file left (withdrawn, or filed to another control or off it): the request of
    each D&I item it is linked to follows the evidence left on it too, as its filing's
    request does (`followed`, already followed). Returns the requests followed."""
    found = [request for request in linked_requests(cursor, file_id) if request not in followed]
    for request_id in found:
        follow_evidence(cursor, organization_id, project_id, request_id, actor_id)
    return found


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
