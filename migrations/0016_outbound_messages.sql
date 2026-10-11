ALTER TABLE mailbox_messages
    ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE mailbox_messages
    ADD CONSTRAINT mailbox_messages_metadata CHECK (jsonb_typeof(metadata) = 'object');

CREATE TABLE outbound_messages (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    pbc_request_id uuid NOT NULL,
    approval_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    operation_key text NOT NULL,
    template_id text NOT NULL,
    template_version integer NOT NULL,
    recipient text NOT NULL,
    subject text NOT NULL,
    content_sha256 text NOT NULL,
    metadata jsonb NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    provider_message_id text,
    thread_id text,
    error_code text NOT NULL DEFAULT '',
    attempt_count integer NOT NULL DEFAULT 1,
    claimed_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT outbound_messages_status CHECK (
        status IN ('PENDING', 'ACCEPTED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'UNKNOWN')
    ),
    CONSTRAINT outbound_messages_key CHECK (operation_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT outbound_messages_template CHECK (
        template_id ~ '^[a-z][a-z0-9-]{0,40}$' AND template_version BETWEEN 1 AND 1000
    ),
    CONSTRAINT outbound_messages_subject CHECK (char_length(subject) BETWEEN 1 AND 200),
    CONSTRAINT outbound_messages_recipient CHECK (char_length(recipient) BETWEEN 3 AND 200),
    CONSTRAINT outbound_messages_content CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT outbound_messages_metadata CHECK (jsonb_typeof(metadata) = 'object'),
    CONSTRAINT outbound_messages_ids CHECK (
        (provider_message_id IS NULL AND thread_id IS NULL)
        OR (
            char_length(provider_message_id) BETWEEN 1 AND 80
            AND char_length(thread_id) BETWEEN 1 AND 80
        )
    ),
    CONSTRAINT outbound_messages_ids_required CHECK (
        status IN ('PENDING', 'FAILED', 'UNKNOWN') OR provider_message_id IS NOT NULL
    ),
    CONSTRAINT outbound_messages_ids_absent CHECK (
        status NOT IN ('PENDING', 'FAILED') OR provider_message_id IS NULL
    ),
    CONSTRAINT outbound_messages_error CHECK (
        (
            status IN ('FAILED', 'UNKNOWN')
            AND error_code IN (
                'live_email_disabled', 'invalid_message', 'approval_expired',
                'timeout', 'provider_error'
            )
        )
        OR (status NOT IN ('FAILED', 'UNKNOWN') AND error_code = '')
    ),
    CONSTRAINT outbound_messages_attempts CHECK (attempt_count BETWEEN 1 AND 10),
    CONSTRAINT outbound_messages_version CHECK (version >= 1),
    CONSTRAINT outbound_messages_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT outbound_messages_request_fk
        FOREIGN KEY (pbc_request_id) REFERENCES pbc_requests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT outbound_messages_approval_fk
        FOREIGN KEY (approval_id) REFERENCES approvals (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT outbound_messages_actor_fk
        FOREIGN KEY (actor_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT outbound_messages_approval_key UNIQUE (approval_id),
    CONSTRAINT outbound_messages_operation_key UNIQUE (project_id, operation_key)
);

CREATE INDEX outbound_messages_project_idx ON outbound_messages (project_id, created_at);
CREATE INDEX outbound_messages_request_idx ON outbound_messages (pbc_request_id, created_at);

CREATE FUNCTION guard_outbound_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'outbound messages cannot be deleted';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.pbc_request_id IS DISTINCT FROM OLD.pbc_request_id
        OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
        OR NEW.operation_key IS DISTINCT FROM OLD.operation_key
        OR NEW.template_id IS DISTINCT FROM OLD.template_id
        OR NEW.template_version IS DISTINCT FROM OLD.template_version
        OR NEW.recipient IS DISTINCT FROM OLD.recipient
        OR NEW.subject IS DISTINCT FROM OLD.subject
        OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
        OR NEW.metadata IS DISTINCT FROM OLD.metadata
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'outbound message content is immutable';
    END IF;
    IF OLD.provider_message_id IS NOT NULL
        AND (
            NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
            OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
        )
    THEN
        RAISE EXCEPTION 'outbound provider ids are bound';
    END IF;
    IF NEW.attempt_count < OLD.attempt_count OR NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'outbound message update is invalid';
    END IF;
    IF NEW.status = OLD.status
        OR (OLD.status = 'PENDING' AND NEW.status IN ('ACCEPTED', 'FAILED', 'UNKNOWN'))
        OR (OLD.status = 'UNKNOWN' AND NEW.status IN ('ACCEPTED', 'FAILED'))
        OR (OLD.status = 'ACCEPTED' AND NEW.status IN ('SENT', 'DELIVERED', 'BOUNCED'))
        OR (OLD.status = 'SENT' AND NEW.status IN ('DELIVERED', 'BOUNCED'))
    THEN
        IF OLD.status IN ('DELIVERED', 'BOUNCED', 'FAILED')
            AND (
                NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
                OR NEW.error_code IS DISTINCT FROM OLD.error_code
            )
        THEN
            RAISE EXCEPTION 'outbound message is final';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'outbound status change is not allowed';
END;
$$;

CREATE TRIGGER outbound_messages_guard
    BEFORE UPDATE OR DELETE ON outbound_messages
    FOR EACH ROW
    EXECUTE FUNCTION guard_outbound_message();
