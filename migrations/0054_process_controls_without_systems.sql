-- Business process and entity-level controls belong to a process, not a system: one row
-- each, with no system. For engagements not yet started, the per-system copies made when
-- systems were added collapse into one. A copy with requests, testing, or findings stays.

WITH process AS (
    SELECT c.id,
           row_number() OVER (
               PARTITION BY c.project_id, c.control_ref ORDER BY c.created_at, c.id
           ) AS n
    FROM engagement_controls c
    JOIN engagement_settings s ON s.project_id = c.project_id
    WHERE s.kicked_off_at IS NULL
      AND c.domain NOT IN ('ACCESS', 'CHANGE', 'OPERATIONS', 'ITAC', 'IPE')
),
dependents AS (
    SELECT engagement_control_id AS id FROM pbc_requests
    UNION SELECT engagement_control_id FROM pbc_drafts
    UNION SELECT engagement_control_id FROM deficiencies
    UNION SELECT engagement_control_id FROM tasks
    UNION SELECT engagement_control_id FROM evidence_reviews
    UNION SELECT engagement_control_id FROM control_tests
    UNION SELECT engagement_control_id FROM evidence_matches
    UNION SELECT engagement_control_id FROM test_sheets
    UNION SELECT engagement_control_id FROM workpapers
    UNION SELECT engagement_control_id FROM test_rounds
    UNION SELECT engagement_control_id FROM control_reviews
)
DELETE FROM engagement_controls c
USING process p
WHERE c.id = p.id
  AND p.n > 1
  AND c.id NOT IN (SELECT id FROM dependents WHERE id IS NOT NULL);

UPDATE engagement_controls c
SET engagement_application_id = NULL,
    application_ids = ARRAY[]::uuid[],
    version = c.version + 1,
    updated_at = clock_timestamp()
FROM engagement_settings s
WHERE s.project_id = c.project_id
  AND s.kicked_off_at IS NULL
  AND c.domain NOT IN ('ACCESS', 'CHANGE', 'OPERATIONS', 'ITAC', 'IPE')
  AND c.engagement_application_id IS NOT NULL;
