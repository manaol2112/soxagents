-- CUECs drive the controls recommended for each system.
--
-- A recommendation can now bring a control into scope for a system: one already loaded
-- but out of scope there (control_id), or a library control not loaded yet
-- (library_key). It carries the references of the CUECs that call for it, such as
-- ["CUEC-1", "CUEC-3"], as its support. The old one-CUEC-to-one-control mapping is no
-- longer proposed; decided ones stay on record.

ALTER TABLE system_recommendations
    DROP CONSTRAINT system_recommendations_kind,
    DROP CONSTRAINT system_recommendations_control,
    ADD COLUMN library_key text,
    ADD COLUMN cuec_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT system_recommendations_kind CHECK (
        kind IN ('EXCLUDE', 'ADD_SOC_REVIEW', 'INCLUDE', 'MAP_CUEC', 'CUEC_GAP')
    ),
    ADD CONSTRAINT system_recommendations_target CHECK (
        (kind IN ('EXCLUDE', 'MAP_CUEC') AND control_id IS NOT NULL AND library_key IS NULL)
        OR (kind = 'INCLUDE' AND (control_id IS NOT NULL) <> (library_key IS NOT NULL))
        OR (kind IN ('ADD_SOC_REVIEW', 'CUEC_GAP') AND control_id IS NULL AND library_key IS NULL)
    ),
    ADD CONSTRAINT system_recommendations_cuec_refs CHECK (jsonb_typeof(cuec_refs) = 'array'),
    ADD CONSTRAINT system_recommendations_library_key CHECK (
        library_key IS NULL OR library_key ~ '^[a-z][a-z0-9-]{0,60}$'
    );

-- Open suggestions in the old shape go; every system not yet started is reviewed again.
DELETE FROM system_recommendations WHERE status = 'PROPOSED';

UPDATE system_reviews AS r
SET review_status = 'PENDING', attempts = 0, version = r.version + 1
FROM engagement_settings AS s
WHERE s.project_id = r.project_id AND s.kicked_off_at IS NULL AND r.review_status = 'IDLE';
