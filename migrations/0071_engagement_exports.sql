-- Engagement exports (Milestone 8.20).
--
-- A person, or the agent console on their behalf, exports engagement records (evidence
-- requests, controls, exceptions, review items) to Excel or CSV. The file is built from
-- the records as they stood at one moment (as_of), stored in object storage, and listed
-- here only once it is stored, so a download link never points at nothing. A file can be
-- downloaded by people who can see its engagement for 30 days; after that its bytes are
-- removed and this record stays, as the trail of what was exported, when, and by whom.

CREATE TABLE engagement_exports (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    dataset text NOT NULL,
    file_format text NOT NULL,
    -- The filters the records were chosen with, exactly as applied.
    filters jsonb NOT NULL DEFAULT '{}'::jsonb,
    row_count integer NOT NULL,
    as_of timestamptz NOT NULL,
    file_name text NOT NULL,
    object_key text NOT NULL,
    content_sha256 text NOT NULL,
    byte_size integer NOT NULL,
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    -- When the file's bytes were removed after it expired.
    purged_at timestamptz,
    CONSTRAINT engagement_exports_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT engagement_exports_dataset CHECK (
        dataset IN ('evidence_requests', 'controls', 'exceptions', 'review_items')
    ),
    CONSTRAINT engagement_exports_format CHECK (file_format IN ('xlsx', 'csv')),
    CONSTRAINT engagement_exports_filters CHECK (jsonb_typeof(filters) = 'object'),
    CONSTRAINT engagement_exports_rows CHECK (row_count >= 0),
    CONSTRAINT engagement_exports_file CHECK (
        char_length(file_name) BETWEEN 1 AND 200 AND char_length(object_key) BETWEEN 1 AND 400
        AND content_sha256 ~ '^[0-9a-f]{64}$' AND byte_size > 0
    ),
    CONSTRAINT engagement_exports_expiry CHECK (expires_at > created_at),
    CONSTRAINT engagement_exports_object UNIQUE (object_key)
);

CREATE INDEX engagement_exports_project ON engagement_exports (project_id, created_at DESC);
CREATE INDEX engagement_exports_expiring ON engagement_exports (expires_at)
    WHERE purged_at IS NULL;

-- The development object store (object storage when S3 is not configured) keeps exports
-- beside evidence: exports/<export id>.
ALTER TABLE mock_objects DROP CONSTRAINT mock_objects_key;
ALTER TABLE mock_objects ADD CONSTRAINT mock_objects_key
    CHECK (object_key ~ '^(evidence|exports)/[0-9a-f-]{36}$');

-- Stored evidence stays write-once. An export's file is removed when it expires, so the
-- development store lets go of export objects, and of nothing else.
CREATE FUNCTION guard_stored_object()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.object_key LIKE 'exports/%' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'evidence files cannot be deleted';
    END IF;
    RAISE EXCEPTION 'evidence files are immutable';
END;
$$;

DROP TRIGGER mock_objects_guard ON mock_objects;
CREATE TRIGGER mock_objects_guard
    BEFORE UPDATE OR DELETE ON mock_objects
    FOR EACH ROW
    EXECUTE FUNCTION guard_stored_object();
