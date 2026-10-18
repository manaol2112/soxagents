-- Evidence intake (Milestone 8.1c).
--
-- The team adds evidence directly: a folder or files from their computer. Each file gets
-- the same immutable custody record as a mailbox attachment, with the folder path it came
-- from. The evidence coordinator matches it to a control. A confident match is filed at
-- once and marked as the agent's, and a person can change it. Other files wait for a
-- person with the agent's suggestions. The match is a separate, mutable record: custody
-- never changes.
--
-- Filing a file against a request marks the request received, or partly received while
-- requested items are still missing. A request that was never sent (a draft, or awaiting
-- approval) can be received this way: it is marked as provided directly, not by email,
-- and its pending send approval is withdrawn so it never goes out.

ALTER TABLE evidence_files ALTER COLUMN mailbox_attachment_id DROP NOT NULL;
ALTER TABLE evidence_files ADD COLUMN source text NOT NULL DEFAULT 'MAILBOX';
-- Where the file sat in the folder the person chose, for example "AC-01/Q4".
ALTER TABLE evidence_files ADD COLUMN folder_path text NOT NULL DEFAULT '';
ALTER TABLE evidence_files ADD COLUMN upload_batch_id uuid;
ALTER TABLE evidence_files ADD CONSTRAINT evidence_files_source
    CHECK (source IN ('MAILBOX', 'UPLOAD'));
ALTER TABLE evidence_files ADD CONSTRAINT evidence_files_origin CHECK (
    (source = 'MAILBOX' AND mailbox_attachment_id IS NOT NULL
        AND upload_batch_id IS NULL AND folder_path = '')
    OR (source = 'UPLOAD' AND mailbox_attachment_id IS NULL AND upload_batch_id IS NOT NULL)
);
ALTER TABLE evidence_files ADD CONSTRAINT evidence_files_folder CHECK (
    char_length(folder_path) <= 500
    AND folder_path !~ '(^/|\\|(^|/)\.\.(/|$)|[[:cntrl:]])'
);

-- The same file from the same place is stored once, so uploading a folder again is safe.
CREATE UNIQUE INDEX evidence_files_upload_once
    ON evidence_files (project_id, content_sha256, folder_path, file_name)
    WHERE source = 'UPLOAD';
CREATE INDEX evidence_files_batch_idx ON evidence_files (project_id, upload_batch_id)
    WHERE upload_batch_id IS NOT NULL;

CREATE TABLE evidence_matches (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    evidence_file_id uuid NOT NULL,
    -- PENDING: not matched yet. FILED: filed to a control. NEEDS_MATCH: waits for a person.
    status text NOT NULL DEFAULT 'PENDING',
    engagement_control_id uuid,
    pbc_request_id uuid,
    filed_by text,
    decided_by uuid,
    source text,
    confidence numeric(3, 2),
    reason text NOT NULL DEFAULT '',
    -- The agent's best candidates: [{control_id, control_ref, title, reason}].
    suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
    model_call_id uuid,
    -- Set when this filing moved the request, so a change of control can put it back.
    receipt_request_id uuid,
    receipt_status_before text,
    receipt_status_set text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT evidence_matches_status CHECK (status IN ('PENDING', 'FILED', 'NEEDS_MATCH')),
    CONSTRAINT evidence_matches_filed CHECK (
        (status = 'FILED' AND engagement_control_id IS NOT NULL AND filed_by IS NOT NULL)
        OR (status <> 'FILED' AND engagement_control_id IS NULL AND pbc_request_id IS NULL
            AND filed_by IS NULL)
    ),
    CONSTRAINT evidence_matches_filed_by CHECK (
        filed_by IS NULL
        OR (filed_by = 'AGENT' AND decided_by IS NULL)
        OR (filed_by = 'PERSON' AND decided_by IS NOT NULL)
    ),
    CONSTRAINT evidence_matches_source CHECK (source IS NULL OR source IN ('RULES', 'MODEL')),
    CONSTRAINT evidence_matches_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT evidence_matches_text CHECK (char_length(reason) <= 500),
    CONSTRAINT evidence_matches_suggestions CHECK (
        jsonb_typeof(suggestions) = 'array' AND jsonb_array_length(suggestions) <= 5
    ),
    CONSTRAINT evidence_matches_receipt CHECK (
        (receipt_request_id IS NULL AND receipt_status_before IS NULL
            AND receipt_status_set IS NULL)
        OR (receipt_request_id IS NOT NULL AND receipt_status_before IS NOT NULL
            AND receipt_status_set IN ('PARTIALLY_RECEIVED', 'RECEIVED'))
    ),
    CONSTRAINT evidence_matches_version CHECK (version >= 1),
    CONSTRAINT evidence_matches_file_key UNIQUE (evidence_file_id),
    CONSTRAINT evidence_matches_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_matches_file_fk
        FOREIGN KEY (evidence_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_matches_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_matches_request_fk
        FOREIGN KEY (project_id, pbc_request_id) REFERENCES pbc_requests (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_matches_receipt_fk
        FOREIGN KEY (project_id, receipt_request_id) REFERENCES pbc_requests (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_matches_person_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_matches_project_idx ON evidence_matches (project_id, status);
CREATE INDEX evidence_matches_request_idx ON evidence_matches (pbc_request_id)
    WHERE pbc_request_id IS NOT NULL;

CREATE TRIGGER evidence_matches_updated_at
    BEFORE UPDATE ON evidence_matches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A request received from evidence the team uploaded, without an email.
ALTER TABLE pbc_requests ADD COLUMN provided_directly boolean NOT NULL DEFAULT false;
ALTER TABLE pbc_requests DROP CONSTRAINT pbc_requests_message_required;
ALTER TABLE pbc_requests ADD CONSTRAINT pbc_requests_message_required CHECK (
    status IN ('DRAFT', 'APPROVAL_PENDING', 'CANCELLED', 'CLOSED')
    OR (outbound_message_id IS NOT NULL AND thread_id IS NOT NULL)
    OR (provided_directly AND status IN ('PARTIALLY_RECEIVED', 'RECEIVED'))
);
ALTER TABLE pbc_requests ADD CONSTRAINT pbc_requests_provided_directly CHECK (
    NOT provided_directly OR outbound_message_id IS NULL
);

-- The request and control each stored file belongs to, whichever way it arrived: an
-- uploaded file by its filing, a mailbox attachment by the reply it came with.
CREATE VIEW evidence_file_links AS
SELECT f.id AS evidence_file_id,
       f.project_id,
       m.pbc_request_id,
       m.engagement_control_id
FROM evidence_files f
JOIN evidence_matches m ON m.evidence_file_id = f.id AND m.status = 'FILED'
WHERE f.source = 'UPLOAD'
UNION ALL
SELECT linked.evidence_file_id, linked.project_id, linked.pbc_request_id,
       linked.engagement_control_id
FROM (
    SELECT DISTINCT ON (f.id)
           f.id AS evidence_file_id,
           f.project_id,
           r.id AS pbc_request_id,
           r.engagement_control_id
    FROM evidence_files f
    JOIN mailbox_attachments ma ON ma.id = f.mailbox_attachment_id
    JOIN inbound_messages i
      ON i.mailbox_message_id = ma.message_id AND i.project_id = ma.project_id
     AND i.match_status IN ('MATCHED', 'ASSIGNED')
    JOIN pbc_requests r ON r.id = i.pbc_request_id AND r.project_id = i.project_id
    WHERE f.source = 'MAILBOX'
    ORDER BY f.id, i.created_at DESC
) linked;
