-- Review and finalize (the Systems & Processes workflow, SP6, decided by the product owner on
-- 24 October 2026): the engagement's work starts when a person confirms its scope. Until
-- then, scope changes create no work. An engagement that already has work (launched with
-- controls in scope) is final from its launch, so nothing changes for it.

ALTER TABLE engagement_settings
    ADD COLUMN scope_finalized_at timestamptz,
    ADD COLUMN scope_finalized_by uuid REFERENCES users (id);

UPDATE engagement_settings s
SET scope_finalized_at = s.kicked_off_at, scope_finalized_by = s.kicked_off_by
WHERE s.kicked_off_at IS NOT NULL
  AND (
      EXISTS (
          SELECT 1 FROM engagement_controls c WHERE c.project_id = s.project_id AND c.included
      )
      OR EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.project_id = s.project_id AND t.engagement_control_id IS NOT NULL
      )
  );
