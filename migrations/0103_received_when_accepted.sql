-- A request whose every requested item a person accepted is received (by the product
-- owner's decision, 22 Oct 2026). Before, a request stayed partly received, and its
-- reminders stayed due, when the evidence reader had not found every item covered, even
-- after a person accepted each one. Accepting the last item now settles the request
-- (evidence_plans._received_when_accepted); this applies the same to requests settled
-- before: they are received, and their open reminders are cancelled as resolved.

WITH settled AS (
    SELECT r.id
    FROM pbc_requests r
    WHERE r.status IN ('SENT', 'WAITING_FOR_RESPONSE', 'OVERDUE', 'ESCALATED',
                       'PARTIALLY_RECEIVED')
      AND EXISTS (SELECT 1 FROM evidence_requirements q
                  WHERE q.pbc_request_id = r.id AND q.status = 'REQUESTED')
      AND NOT EXISTS (SELECT 1 FROM evidence_requirements q
                      WHERE q.pbc_request_id = r.id AND q.status = 'REQUESTED'
                        AND q.sufficiency <> 'ACCEPTED')
),
received AS (
    UPDATE pbc_requests r
    SET status = 'RECEIVED', escalation_state = 'NONE',
        first_response_at = coalesce(r.first_response_at, clock_timestamp()),
        received_at = clock_timestamp(), updated_at = clock_timestamp(),
        version = r.version + 1
    FROM settled
    WHERE r.id = settled.id
    RETURNING r.id
)
UPDATE pbc_follow_ups f
SET status = 'CANCELLED', reason = 'request_resolved', closed_at = clock_timestamp(),
    updated_at = clock_timestamp(), version = f.version + 1
FROM received
WHERE f.pbc_request_id = received.id AND f.status IN ('DUE', 'APPROVAL_PENDING');
