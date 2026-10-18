-- Controls per application (Milestone 8.5).
--
-- A control that covers several systems is documented, requested, tested, and concluded
-- once per system, as auditors do: ITGC-AC-01 for Active Directory and ITGC-AC-01 for
-- Oracle are two engagement controls with the same ID. Each row now names its one
-- application (or none, for a control with no system). Everything that hangs off a
-- control row (requests, sample plans, test sheets, workpapers, deficiencies, rounds)
-- follows the row, so each application instance is a full control.
--
-- Existing controls on several applications are split here: the row keeps its first
-- application and a clone is made for each other one. Evidence a person or the agent
-- tagged with one application moves to that application's row, and so do the open test
-- items for that application. Requests, tasks, plans, deficiencies, and workpapers stay
-- with the original row. `application_ids` is kept, as a one-element array, for the
-- readers that still use it.

ALTER TABLE engagement_controls
    ADD COLUMN engagement_application_id uuid,
    ADD CONSTRAINT engagement_controls_application_fk
        FOREIGN KEY (project_id, engagement_application_id)
        REFERENCES engagement_applications (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    DROP CONSTRAINT engagement_controls_unique,
    DROP CONSTRAINT engagement_controls_ref_unique;

-- One row per control and application; one row per control without an application.
CREATE UNIQUE INDEX engagement_controls_ref_app_unique
    ON engagement_controls (project_id, control_ref, engagement_application_id)
    WHERE engagement_application_id IS NOT NULL;
CREATE UNIQUE INDEX engagement_controls_ref_none_unique
    ON engagement_controls (project_id, control_ref)
    WHERE engagement_application_id IS NULL;
CREATE UNIQUE INDEX engagement_controls_key_app_unique
    ON engagement_controls (project_id, library_key, engagement_application_id)
    WHERE engagement_application_id IS NOT NULL;
CREATE UNIQUE INDEX engagement_controls_key_none_unique
    ON engagement_controls (project_id, library_key)
    WHERE engagement_application_id IS NULL;
CREATE INDEX engagement_controls_application_idx
    ON engagement_controls (project_id, engagement_application_id);

-- The clones, one per application after the first, remembering which row they came from.
CREATE TEMP TABLE control_clones (
    original_id uuid NOT NULL,
    clone_id uuid NOT NULL,
    application_id uuid NOT NULL
) ON COMMIT DROP;

WITH extra AS (
    SELECT c.id AS original_id, x.app AS application_id, x.ordinality
    FROM engagement_controls c
    CROSS JOIN LATERAL unnest(c.application_ids[2:]) WITH ORDINALITY AS x(app, ordinality)
    WHERE cardinality(c.application_ids) > 1
      AND EXISTS (
          SELECT 1 FROM engagement_applications a
          WHERE a.project_id = c.project_id AND a.id = x.app
      )
),
made AS (
    INSERT INTO engagement_controls (
        organization_id, project_id, library_key, library_version, control_ref, domain,
        title, risk, activity, frequency, nature, key_control, included, owner_name,
        owner_email, application_ids, test_attributes, pbc_items, design_template_key,
        effectiveness_template_key, agent_key, source, rcm_import_id, source_row,
        domain_label, frequency_label, nature_label, custom_fields,
        engagement_application_id
    )
    SELECT c.organization_id, c.project_id, c.library_key, c.library_version, c.control_ref,
           c.domain, c.title, c.risk, c.activity, c.frequency, c.nature, c.key_control,
           c.included, c.owner_name, c.owner_email, ARRAY[e.application_id],
           c.test_attributes, c.pbc_items, c.design_template_key,
           c.effectiveness_template_key, c.agent_key, c.source, c.rcm_import_id,
           c.source_row, c.domain_label, c.frequency_label, c.nature_label, c.custom_fields,
           e.application_id
    FROM extra e JOIN engagement_controls c ON c.id = e.original_id
    RETURNING id, control_ref, project_id, engagement_application_id
)
INSERT INTO control_clones (original_id, clone_id, application_id)
SELECT c.id, m.id, m.engagement_application_id
FROM made m
JOIN engagement_controls c
  ON c.project_id = m.project_id AND c.control_ref = m.control_ref
 AND c.engagement_application_id IS NULL
 AND m.engagement_application_id = ANY(c.application_ids);

-- The original rows keep their first application.
UPDATE engagement_controls c
SET engagement_application_id = c.application_ids[1],
    application_ids = c.application_ids[1:1]
WHERE cardinality(c.application_ids) >= 1
  AND EXISTS (
      SELECT 1 FROM engagement_applications a
      WHERE a.project_id = c.project_id AND a.id = c.application_ids[1]
  );

-- Evidence tagged with a clone's application moves to the clone, off the original's
-- request (the request stays with the original).
UPDATE evidence_matches m
SET engagement_control_id = k.clone_id, pbc_request_id = NULL, version = m.version + 1
FROM control_clones k
JOIN evidence_file_applications t
  ON t.engagement_application_id = k.application_id AND t.scope = 'ONE'
WHERE m.engagement_control_id = k.original_id
  AND m.evidence_file_id = t.evidence_file_id
  AND m.status = 'FILED';

-- Open test items for a clone's application move to a new sheet for the clone.
CREATE TEMP TABLE clone_sheets (
    original_sheet_id uuid NOT NULL,
    clone_id uuid NOT NULL,
    new_sheet_id uuid NOT NULL
) ON COMMIT DROP;

WITH made AS (
    INSERT INTO test_sheets (
        organization_id, project_id, engagement_control_id, method, attributes, status,
        run_status, requested_by
    )
    SELECT s.organization_id, s.project_id, k.clone_id, s.method, s.attributes, 'OPEN',
           'PENDING', s.requested_by
    FROM test_sheets s
    JOIN control_clones k ON k.original_id = s.engagement_control_id
    WHERE s.status = 'OPEN' AND s.method = 'TEST_OF_ONE' AND s.test_round_id IS NULL
      AND EXISTS (
          SELECT 1 FROM test_items i
          WHERE i.test_sheet_id = s.id AND i.engagement_application_id = k.application_id
      )
    RETURNING id, engagement_control_id
)
INSERT INTO clone_sheets (original_sheet_id, clone_id, new_sheet_id)
SELECT s.id, m.engagement_control_id, m.id
FROM made m
JOIN control_clones k ON k.clone_id = m.engagement_control_id
JOIN test_sheets s ON s.engagement_control_id = k.original_id
 AND s.status = 'OPEN' AND s.method = 'TEST_OF_ONE' AND s.test_round_id IS NULL;

UPDATE test_items i
SET test_sheet_id = cs.new_sheet_id, version = i.version + 1
FROM clone_sheets cs
JOIN control_clones k ON k.clone_id = cs.clone_id
WHERE i.test_sheet_id = cs.original_sheet_id
  AND i.engagement_application_id = k.application_id;

INSERT INTO test_sheet_files (test_sheet_id, evidence_file_id, placement, placed_by,
                              decided_by, reason)
SELECT cs.new_sheet_id, f.evidence_file_id, f.placement, f.placed_by, f.decided_by, f.reason
FROM clone_sheets cs
JOIN test_sheet_files f ON f.test_sheet_id = cs.original_sheet_id
JOIN evidence_matches m
  ON m.evidence_file_id = f.evidence_file_id AND m.engagement_control_id = cs.clone_id
ON CONFLICT DO NOTHING;

DELETE FROM test_sheet_files f
USING clone_sheets cs, evidence_matches m
WHERE f.test_sheet_id = cs.original_sheet_id
  AND m.evidence_file_id = f.evidence_file_id
  AND m.engagement_control_id = cs.clone_id;
