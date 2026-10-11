-- Custody records for inbound attachment bytes. The object key is generated here.
-- mock_objects holds bytes only while the S3 settings are empty.

CREATE TABLE evidence_files (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    mailbox_attachment_id uuid NOT NULL,
    object_key text NOT NULL,
    content_sha256 text NOT NULL,
    size_bytes integer NOT NULL,
    content_type text NOT NULL,
    file_name text NOT NULL,
    stored_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_files_sha256 CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_files_size CHECK (size_bytes BETWEEN 0 AND 25000000),
    CONSTRAINT evidence_files_key CHECK (object_key ~ '^evidence/[0-9a-f-]{36}$'),
    CONSTRAINT evidence_files_text CHECK (
        char_length(content_type) BETWEEN 1 AND 100
        AND char_length(file_name) BETWEEN 1 AND 200
    ),
    CONSTRAINT evidence_files_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_files_attachment_fk
        FOREIGN KEY (mailbox_attachment_id) REFERENCES mailbox_attachments (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_files_actor_fk
        FOREIGN KEY (stored_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_files_attachment_key UNIQUE (mailbox_attachment_id),
    CONSTRAINT evidence_files_object_key UNIQUE (object_key)
);

CREATE INDEX evidence_files_project_idx ON evidence_files (project_id, created_at);

CREATE TABLE mock_objects (
    object_key text PRIMARY KEY,
    content bytea NOT NULL,
    content_sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT mock_objects_sha256 CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT mock_objects_key CHECK (object_key ~ '^evidence/[0-9a-f-]{36}$'),
    CONSTRAINT mock_objects_size CHECK (octet_length(content) <= 25000000)
);

CREATE FUNCTION guard_evidence_file()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'evidence files cannot be deleted';
    END IF;
    RAISE EXCEPTION 'evidence files are immutable';
END;
$$;

CREATE TRIGGER evidence_files_guard
    BEFORE UPDATE OR DELETE ON evidence_files
    FOR EACH ROW
    EXECUTE FUNCTION guard_evidence_file();

CREATE TRIGGER mock_objects_guard
    BEFORE UPDATE OR DELETE ON mock_objects
    FOR EACH ROW
    EXECUTE FUNCTION guard_evidence_file();
