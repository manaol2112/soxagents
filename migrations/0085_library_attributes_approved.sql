-- The library's attributes are decided in the firm's library review, not plan by plan
-- (milestone L3e, decided by the product owner). A library attribute that depends on the
-- client (LOW or NOT_ESTABLISHED confidence) enters an engagement approved with its
-- standard, its question kept as a note; the client values it depends on are asked as
-- values, and testing waits for them, as before. This approves the library proposals still
-- open in engagements, unless the same wording is already approved on the control, and puts
-- each control's attribute list back in order.
--
-- Rollback: set status back to 'PROPOSED' and proposal back to 'ADD' for the attributes
-- whose note starts with 'From the library standard (approved by migration 0085)', put each
-- control's test_attributes back from its approved attributes, and delete the
-- '0085_library_attributes_approved' row from schema_migrations.

UPDATE control_attributes a
SET status = 'APPROVED',
    proposal = NULL,
    decided_at = clock_timestamp(),
    note = left(
        'From the library standard (approved by migration 0085); it depends on the client: '
            || regexp_replace(a.note, '^Library v[0-9]+, [a-z ]+ confidence: ', ''),
        500
    ),
    version = a.version + 1,
    updated_at = clock_timestamp()
WHERE a.status = 'PROPOSED'
  AND a.source_kind = 'LIBRARY'
  AND a.proposal = 'ADD'
  AND a.replaces_id IS NULL
  AND a.definition_key IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM control_attributes b
      WHERE b.engagement_control_id = a.engagement_control_id
        AND b.status = 'APPROVED' AND b.text = a.text
  );

-- A separate statement: one in the same statement as the approval would read the
-- attributes as they were before it.
UPDATE engagement_controls c
SET test_attributes = coalesce((
        SELECT jsonb_agg(x.text ORDER BY x.position, x.created_at)
        FROM control_attributes x
        WHERE x.engagement_control_id = c.id AND x.status = 'APPROVED'
    ), '[]'::jsonb),
    version = c.version + 1,
    updated_at = clock_timestamp()
WHERE c.id IN (
    SELECT engagement_control_id FROM control_attributes
    WHERE note LIKE 'From the library standard (approved by migration 0085)%'
);
