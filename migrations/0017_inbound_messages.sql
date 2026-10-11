-- Inbound replies. The mock mailbox can now hold received mail, and each received
-- message gets one processed record with sanitized text and a match decision.

ALTER TABLE mailbox_messages DROP CONSTRAINT mailbox_messages_status;
ALTER TABLE mailbox_messages
    ADD CONSTRAINT mailbox_messages_status CHECK (status IN ('DRAFT', 'ACCEPTED', 'RECEIVED'));

ALTER TABLE mailbox_messages DROP CONSTRAINT mailbox_messages_body;
ALTER TABLE mailbox_messages
    ADD CONSTRAINT mailbox_messages_body CHECK (
        (status <> 'RECEIVED' AND char_length(body) <= 4000)
        OR (status = 'RECEIVED' AND char_length(body) <= 200000)
    );

ALTER TABLE mailbox_attachments ADD COLUMN content_sha256 text;
ALTER TABLE mailbox_attachments
    ADD CONSTRAINT mailbox_attachments_sha256 CHECK (
        content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE pbc_requests ADD CONSTRAINT pbc_requests_scope_key UNIQUE (project_id, id);

CREATE TABLE inbound_messages (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    mailbox_message_id uuid NOT NULL,
    pbc_request_id uuid,
    suggested_pbc_request_id uuid,
    match_status text NOT NULL,
    match_method text NOT NULL,
    unmatched_reason text NOT NULL DEFAULT '',
    review_state text NOT NULL,
    sender text NOT NULL,
    subject text NOT NULL,
    body_text text NOT NULL,
    body_truncated boolean NOT NULL DEFAULT false,
    content_redacted boolean NOT NULL DEFAULT false,
    attachment_count integer NOT NULL DEFAULT 0,
    received_at timestamptz NOT NULL,
    triaged_by_user_id uuid,
    triaged_at timestamptz,
    triage_reason text NOT NULL DEFAULT '',
    reviewed_by_user_id uuid,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT inbound_messages_match_status CHECK (
        match_status IN ('MATCHED', 'UNMATCHED', 'ASSIGNED', 'DISMISSED')
    ),
    CONSTRAINT inbound_messages_match_method CHECK (
        match_method IN ('thread', 'reference', 'manual', 'none')
    ),
    CONSTRAINT inbound_messages_reason CHECK (
        unmatched_reason IN (
            '', 'no_reference', 'unknown_reference', 'ambiguous_reference',
            'conflicting_reference', 'sender_mismatch', 'request_not_open'
        )
    ),
    CONSTRAINT inbound_messages_review_state CHECK (
        review_state IN ('NEEDS_REVIEW', 'REVIEWED', 'NOT_APPLICABLE')
    ),
    CONSTRAINT inbound_messages_matched CHECK (
        match_status <> 'MATCHED'
        OR (
            pbc_request_id IS NOT NULL
            AND match_method IN ('thread', 'reference')
            AND unmatched_reason = ''
        )
    ),
    CONSTRAINT inbound_messages_unmatched CHECK (
        match_status NOT IN ('UNMATCHED', 'DISMISSED')
        OR (
            pbc_request_id IS NULL
            AND match_method = 'none'
            AND unmatched_reason <> ''
            AND review_state = 'NOT_APPLICABLE'
        )
    ),
    CONSTRAINT inbound_messages_assigned CHECK (
        match_status <> 'ASSIGNED'
        OR (pbc_request_id IS NOT NULL AND match_method = 'manual')
    ),
    CONSTRAINT inbound_messages_linked_review CHECK (
        (pbc_request_id IS NULL) = (review_state = 'NOT_APPLICABLE')
    ),
    CONSTRAINT inbound_messages_triage CHECK (
        (match_status IN ('ASSIGNED', 'DISMISSED'))
        = (
            triaged_by_user_id IS NOT NULL
            AND triaged_at IS NOT NULL
            AND char_length(btrim(triage_reason)) BETWEEN 1 AND 500
        )
    ),
    CONSTRAINT inbound_messages_reviewed CHECK (
        (review_state = 'REVIEWED') = (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
    CONSTRAINT inbound_messages_text CHECK (
        char_length(sender) BETWEEN 1 AND 320
        AND char_length(subject) <= 200
        AND char_length(body_text) <= 20000
    ),
    CONSTRAINT inbound_messages_attachments CHECK (attachment_count BETWEEN 0 AND 100),
    CONSTRAINT inbound_messages_version CHECK (version >= 1),
    CONSTRAINT inbound_messages_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT inbound_messages_mailbox_fk
        FOREIGN KEY (organization_id, project_id, mailbox_message_id)
        REFERENCES mailbox_messages (organization_id, project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT inbound_messages_request_fk
        FOREIGN KEY (project_id, pbc_request_id) REFERENCES pbc_requests (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT inbound_messages_suggested_fk
        FOREIGN KEY (project_id, suggested_pbc_request_id) REFERENCES pbc_requests (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT inbound_messages_triaged_by_fk
        FOREIGN KEY (triaged_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT inbound_messages_reviewed_by_fk
        FOREIGN KEY (reviewed_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT inbound_messages_mailbox_key UNIQUE (mailbox_message_id)
);

CREATE INDEX inbound_messages_project_idx ON inbound_messages (project_id, received_at);
CREATE INDEX inbound_messages_request_idx ON inbound_messages (pbc_request_id, received_at);

CREATE FUNCTION guard_inbound_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'inbound messages cannot be deleted';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.mailbox_message_id IS DISTINCT FROM OLD.mailbox_message_id
        OR NEW.suggested_pbc_request_id IS DISTINCT FROM OLD.suggested_pbc_request_id
        OR NEW.sender IS DISTINCT FROM OLD.sender
        OR NEW.subject IS DISTINCT FROM OLD.subject
        OR NEW.body_text IS DISTINCT FROM OLD.body_text
        OR NEW.body_truncated IS DISTINCT FROM OLD.body_truncated
        OR NEW.content_redacted IS DISTINCT FROM OLD.content_redacted
        OR NEW.attachment_count IS DISTINCT FROM OLD.attachment_count
        OR NEW.received_at IS DISTINCT FROM OLD.received_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'inbound message content is immutable';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'inbound message update is invalid';
    END IF;
    -- A person assigns or dismisses unmatched mail once.
    IF OLD.match_status = 'UNMATCHED' AND NEW.match_status IN ('ASSIGNED', 'DISMISSED') THEN
        IF NEW.match_status = 'ASSIGNED' AND NEW.review_state <> 'NEEDS_REVIEW' THEN
            RAISE EXCEPTION 'an assigned reply needs review';
        END IF;
        RETURN NEW;
    END IF;
    -- A person reviews a linked reply once. The link itself is then fixed.
    IF NEW.match_status = OLD.match_status
        AND NEW.pbc_request_id IS NOT DISTINCT FROM OLD.pbc_request_id
        AND NEW.triaged_by_user_id IS NOT DISTINCT FROM OLD.triaged_by_user_id
        AND NEW.triage_reason IS NOT DISTINCT FROM OLD.triage_reason
        AND OLD.review_state = 'NEEDS_REVIEW'
        AND NEW.review_state = 'REVIEWED'
    THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'inbound message change is not allowed';
END;
$$;

CREATE TRIGGER inbound_messages_guard
    BEFORE UPDATE OR DELETE ON inbound_messages
    FOR EACH ROW
    EXECUTE FUNCTION guard_inbound_message();
