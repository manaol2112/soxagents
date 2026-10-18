-- Withdrawing and replacing evidence (Milestone 8.3b).
--
-- An evidence file's custody record never changes and is never deleted (0021). A person
-- who uploaded the wrong file withdraws it instead: the file leaves the register,
-- matching, testing, and workpapers, but its record and bytes stay, with who withdrew it
-- and why. A replaced file names the file that took its place. A withdrawal that was not
-- a replacement can be restored. Withdrawals are never deleted; only the restore is added.

CREATE TABLE evidence_withdrawals (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    evidence_file_id uuid NOT NULL,
    reason text NOT NULL,
    withdrawn_by uuid NOT NULL,
    withdrawn_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- The new version of the file, when the withdrawal was a replacement.
    replaced_by_file_id uuid,
    restored_by uuid,
    restored_at timestamptz,
    restore_reason text,
    CONSTRAINT evidence_withdrawals_reason CHECK (char_length(reason) BETWEEN 3 AND 500),
    CONSTRAINT evidence_withdrawals_restored CHECK (
        (restored_by IS NULL) = (restored_at IS NULL)
        AND (restored_by IS NULL) = (restore_reason IS NULL)
    ),
    CONSTRAINT evidence_withdrawals_restore_reason CHECK (
        restore_reason IS NULL OR char_length(restore_reason) BETWEEN 3 AND 500
    ),
    CONSTRAINT evidence_withdrawals_replacement CHECK (
        replaced_by_file_id IS NULL
        OR (replaced_by_file_id <> evidence_file_id AND restored_by IS NULL)
    ),
    CONSTRAINT evidence_withdrawals_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_withdrawals_file_fk
        FOREIGN KEY (evidence_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_withdrawals_replacement_fk
        FOREIGN KEY (replaced_by_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_withdrawals_by_fk
        FOREIGN KEY (withdrawn_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_withdrawals_restorer_fk
        FOREIGN KEY (restored_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- At most one withdrawal in force per file.
CREATE UNIQUE INDEX evidence_withdrawals_in_force
    ON evidence_withdrawals (evidence_file_id) WHERE restored_at IS NULL;
CREATE INDEX evidence_withdrawals_project_idx ON evidence_withdrawals (project_id);
CREATE INDEX evidence_withdrawals_replacement_idx
    ON evidence_withdrawals (replaced_by_file_id) WHERE replaced_by_file_id IS NOT NULL;

CREATE FUNCTION guard_evidence_withdrawal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'evidence withdrawals cannot be deleted';
    END IF;
    -- The only change is the restore, once.
    IF OLD.restored_at IS NOT NULL
       OR NEW.restored_at IS NULL
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.evidence_file_id IS DISTINCT FROM OLD.evidence_file_id
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.withdrawn_by IS DISTINCT FROM OLD.withdrawn_by
       OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
       OR NEW.replaced_by_file_id IS DISTINCT FROM OLD.replaced_by_file_id THEN
        RAISE EXCEPTION 'evidence withdrawals can only be restored';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_withdrawals_guard
    BEFORE UPDATE OR DELETE ON evidence_withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION guard_evidence_withdrawal();

-- Every reader of a file's request and control goes through this view, so a withdrawn
-- file is off its request, its control, testing, and workpapers at once.
CREATE OR REPLACE VIEW evidence_file_links AS
SELECT f.id AS evidence_file_id,
       f.project_id,
       m.pbc_request_id,
       m.engagement_control_id
FROM evidence_files f
JOIN evidence_matches m ON m.evidence_file_id = f.id AND m.status = 'FILED'
WHERE f.source = 'UPLOAD'
  AND NOT EXISTS (
      SELECT 1 FROM evidence_withdrawals w
      WHERE w.evidence_file_id = f.id AND w.restored_at IS NULL
  )
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
      AND NOT EXISTS (
          SELECT 1 FROM evidence_withdrawals w
          WHERE w.evidence_file_id = f.id AND w.restored_at IS NULL
      )
    ORDER BY f.id, i.created_at DESC
) linked;
