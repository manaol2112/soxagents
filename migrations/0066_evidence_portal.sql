-- Secure evidence upload links (Milestone 8.12).
--
-- An evidence request email carries a link instead of asking for attachments. The link
-- belongs to one recipient on one engagement and opens every open request sent to that
-- address. Opening it sends a one-time code to the address; the code opens a short
-- session in which the owner uploads files to a request. Each file is stored like any
-- other upload, filed to the request's control, and read by the evidence coordinator.
--
-- Only hashes of the link token, the code, and the session token are stored. A request
-- takes uploads until 30 days after its due date, and none once it is closed or
-- cancelled; the team can revoke a recipient's links at any time.

CREATE TABLE evidence_portal_links (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    recipient citext NOT NULL,
    token_hash text NOT NULL,
    -- The delivery that carried the link; null for a local preview link.
    outbound_message_id uuid,
    issued_by uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_opened_at timestamptz,
    revoked_at timestamptz,
    revoked_by uuid,
    CONSTRAINT evidence_portal_links_token UNIQUE (token_hash),
    CONSTRAINT evidence_portal_links_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_portal_links_recipient CHECK (
        char_length(recipient::text) BETWEEN 3 AND 320 AND position('@' IN recipient::text) > 1
    ),
    CONSTRAINT evidence_portal_links_revoked CHECK (
        (revoked_at IS NULL) = (revoked_by IS NULL)
    ),
    CONSTRAINT evidence_portal_links_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_portal_links_outbound_fk
        FOREIGN KEY (outbound_message_id) REFERENCES outbound_messages (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_portal_links_issuer_fk
        FOREIGN KEY (issued_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_portal_links_revoker_fk
        FOREIGN KEY (revoked_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_portal_links_recipient_idx
    ON evidence_portal_links (project_id, recipient);

-- A one-time code sent to the link's address. It expires after ten minutes and allows
-- five tries.
CREATE TABLE evidence_portal_codes (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    link_id uuid NOT NULL,
    code_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    used_at timestamptz,
    -- SENT: the mailbox accepted it. NOT_SENT: email is unavailable.
    delivery text NOT NULL,
    CONSTRAINT evidence_portal_codes_hash CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_portal_codes_attempts CHECK (attempts BETWEEN 0 AND 5),
    CONSTRAINT evidence_portal_codes_delivery CHECK (delivery IN ('SENT', 'NOT_SENT')),
    CONSTRAINT evidence_portal_codes_link_fk
        FOREIGN KEY (link_id) REFERENCES evidence_portal_links (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_portal_codes_link_idx ON evidence_portal_codes (link_id, created_at);

-- A verified visit: the owner's browser holds the token, the database its hash.
CREATE TABLE evidence_portal_sessions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    link_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    ended_at timestamptz,
    CONSTRAINT evidence_portal_sessions_token UNIQUE (token_hash),
    CONSTRAINT evidence_portal_sessions_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_portal_sessions_link_fk
        FOREIGN KEY (link_id) REFERENCES evidence_portal_links (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- A file the owner uploads through the link has no team member as its custodian: the
-- record names the address that uploaded it instead.
ALTER TABLE evidence_files ALTER COLUMN stored_by DROP NOT NULL;
ALTER TABLE evidence_files ADD COLUMN uploaded_by_email citext;
ALTER TABLE evidence_files ADD COLUMN portal_session_id uuid;
ALTER TABLE evidence_files ADD CONSTRAINT evidence_files_uploader CHECK (
    (stored_by IS NOT NULL AND uploaded_by_email IS NULL AND portal_session_id IS NULL)
    OR (stored_by IS NULL AND uploaded_by_email IS NOT NULL AND portal_session_id IS NOT NULL
        AND source = 'UPLOAD')
);
ALTER TABLE evidence_files ADD CONSTRAINT evidence_files_portal_session_fk
    FOREIGN KEY (portal_session_id) REFERENCES evidence_portal_sessions (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The owner files their own upload to the request it was made on.
ALTER TABLE evidence_matches DROP CONSTRAINT evidence_matches_filed_by;
ALTER TABLE evidence_matches ADD CONSTRAINT evidence_matches_filed_by CHECK (
    filed_by IS NULL
    OR (filed_by = 'AGENT' AND decided_by IS NULL)
    OR (filed_by = 'PERSON' AND decided_by IS NOT NULL)
    OR (filed_by = 'OWNER' AND decided_by IS NULL)
);
