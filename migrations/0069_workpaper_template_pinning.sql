-- Workpaper templates after launch (Milestone 8.16).
--
-- The team can customise, upload, apply, and remove workpaper templates after launch. A
-- change reaches only workpapers that have not started; a started workpaper keeps the
-- template it began with. A workpaper starts when a person or the agent first writes in
-- it, or when it is prepared; one filled only from the records has not started, since it
-- is filled again from the records in any shape.
--
-- started_at: when it started. template_snapshot: the template it began with, taken when
-- it starts, so a firm template edited afterwards does not reshape it.

ALTER TABLE workpapers
    ADD COLUMN started_at timestamptz,
    ADD COLUMN template_snapshot jsonb,
    ADD CONSTRAINT workpapers_snapshot CHECK (
        template_snapshot IS NULL OR jsonb_typeof(template_snapshot) = 'object'
    ),
    ADD CONSTRAINT workpapers_snapshot_started CHECK (
        template_snapshot IS NULL OR started_at IS NOT NULL
    );

-- Workpapers already written in or prepared have started. Their template is taken when
-- they are next drafted, from the template they name.
UPDATE workpapers w
SET started_at = coalesce(
    (SELECT min(v.created_at) FROM workpaper_versions v
     WHERE v.workpaper_id = w.id AND v.source IN ('AGENT', 'PERSON')),
    w.prepared_at
)
WHERE w.started_at IS NULL
  AND (w.prepared_at IS NOT NULL OR EXISTS (
      SELECT 1 FROM workpaper_versions v
      WHERE v.workpaper_id = w.id AND v.source IN ('AGENT', 'PERSON')
  ));

-- Confirming the templates is a step before launch, and launching required it. A change
-- after launch cleared it all the same, which left a launched engagement's setup showing
-- a step to do that could no longer be done. Launch is when they were last confirmed.
UPDATE engagement_settings
SET templates_confirmed_at = kicked_off_at, templates_confirmed_by = kicked_off_by
WHERE kicked_off_at IS NOT NULL AND templates_confirmed_at IS NULL;
