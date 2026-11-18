-- Systems taken out of scope before migration 0114 marked them (decided by the product
-- owner on 25 October 2026). A system is marked when the audit trail records it taken out
-- of scope and none of its controls is in scope now; the latest such record gives who,
-- when, and why. A system brought back into scope since, by having controls in scope
-- again, stays in scope.

UPDATE engagement_applications a
SET out_of_scope_at = e.occurred_at,
    out_of_scope_by = coalesce(e.actor_user_id, p.owner_user_id),
    out_of_scope_reason = left(coalesce(e.payload ->> 'reason', ''), 1000)
FROM (
    SELECT DISTINCT ON (payload ->> 'application_id')
           payload ->> 'application_id' AS application_id, occurred_at, actor_user_id, payload,
           project_id
    FROM audit_events
    WHERE action = 'onboarding.application_out_of_scope'
    ORDER BY payload ->> 'application_id', occurred_at DESC
) e
JOIN projects p ON p.id = e.project_id
WHERE a.id::text = e.application_id
  AND a.project_id = e.project_id
  AND a.out_of_scope_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM engagement_controls c
      WHERE c.engagement_application_id = a.id AND c.included
  );
