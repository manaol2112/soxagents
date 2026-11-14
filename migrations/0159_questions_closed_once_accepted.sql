-- No follow-up questions once the attributes are accepted (14 November 2026; product
-- owner: "I don't want to have any follow-up questions when the attributes are already
-- approved and accepted. What's the point? All questions are already asked and answered in
-- the control understanding").
--
-- From now on a person's decision that leaves a control's attributes accepted closes the
-- agents' open questions about them (control_attributes.close_questions_once_accepted), and
-- the agents (the attribute run, the narrative and the process understanding) ask none on
-- accepted attributes. This migration applies the same rule
-- once to the questions already open: on every control whose attributes are accepted
-- (approved attributes, no proposal waiting, no agent criteria waiting on a person), the
-- agent's open ATTRIBUTES, SOURCES and PROCESS questions are marked SUPERSEDED with the note
-- "Closed when the attributes were accepted." and one audit record per control names them.
-- Nobody answered or dismissed them, so resolved_by and resolved_at stay empty. Archived
-- engagements are read-only (migration 0136) and are left as they are.
--
-- Data only: no schema change.
--
-- Rollback: for each 'attributes.questions_closed' audit record whose payload reason is
-- 'MIGRATION_0159', set those questions back to OPEN (the audit record stays: audit events
-- are immutable); delete the '0159_questions_closed_once_accepted' row from
-- schema_migrations.

WITH accepted AS (
    SELECT e.id, e.organization_id, e.project_id
    FROM engagement_controls e
    JOIN projects p ON p.id = e.project_id
    WHERE p.status <> 'ARCHIVED'
      AND EXISTS (
          SELECT 1 FROM control_attributes a
          WHERE a.engagement_control_id = e.id AND a.status = 'APPROVED')
      AND NOT EXISTS (
          SELECT 1 FROM control_attributes a
          WHERE a.engagement_control_id = e.id AND a.status = 'PROPOSED')
      AND NOT EXISTS (
          SELECT 1 FROM control_attributes a
          WHERE a.engagement_control_id = e.id AND a.status = 'APPROVED'
            AND a.criteria_origin IN ('AGENT', 'SEEDED')
            AND a.criteria_accepted_at IS NULL
            AND (a.judgment_required IS TRUE
                 OR (a.condition <> '' AND a.pass_criteria <> '' AND a.fail_criteria <> '')))
),
closed AS (
    UPDATE control_context_issues i
    SET status = 'SUPERSEDED',
        resolution_note = 'Closed when the attributes were accepted.',
        version = i.version + 1,
        updated_at = clock_timestamp()
    FROM accepted
    WHERE i.engagement_control_id = accepted.id
      AND i.status = 'OPEN'
      AND i.raised_by = 'AGENT'
      AND i.origin IN ('ATTRIBUTES', 'SOURCES', 'PROCESS')
    RETURNING i.id, i.topic, i.engagement_control_id, accepted.organization_id,
              accepted.project_id
)
INSERT INTO audit_events (
    organization_id, project_id, action, target_type, target_id, payload
)
SELECT organization_id, project_id, 'attributes.questions_closed', 'engagement_control',
       engagement_control_id,
       jsonb_build_object(
           'reason', 'MIGRATION_0159',
           'questions', jsonb_agg(
               jsonb_build_object('id', id::text, 'topic', topic) ORDER BY id)
       )
FROM closed
GROUP BY organization_id, project_id, engagement_control_id;
