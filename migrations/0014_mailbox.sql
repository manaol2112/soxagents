CREATE TABLE mailbox_messages (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    provider_message_id text NOT NULL,
    thread_id text NOT NULL,
    status text NOT NULL,
    sender text NOT NULL,
    recipient text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT mailbox_messages_status CHECK (status IN ('DRAFT', 'ACCEPTED')),
    CONSTRAINT mailbox_messages_key CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
    CONSTRAINT mailbox_messages_ids CHECK (
        char_length(provider_message_id) BETWEEN 1 AND 80
        AND char_length(thread_id) BETWEEN 1 AND 80
    ),
    CONSTRAINT mailbox_messages_subject CHECK (char_length(subject) BETWEEN 1 AND 200),
    CONSTRAINT mailbox_messages_body CHECK (char_length(body) <= 4000),
    CONSTRAINT mailbox_messages_organization_fkey
        FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT,
    CONSTRAINT mailbox_messages_project_fkey
        FOREIGN KEY (organization_id, project_id)
        REFERENCES projects (organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT mailbox_messages_scope_key UNIQUE (organization_id, project_id, id),
    CONSTRAINT mailbox_messages_idempotency_key UNIQUE (project_id, idempotency_key),
    CONSTRAINT mailbox_messages_provider_key UNIQUE (project_id, provider_message_id)
);

CREATE INDEX mailbox_messages_thread_idx ON mailbox_messages (project_id, thread_id, created_at);

CREATE TABLE mailbox_attachments (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    message_id uuid NOT NULL,
    attachment_ref text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    size_bytes integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT mailbox_attachments_size CHECK (size_bytes >= 0 AND size_bytes <= 25000000),
    CONSTRAINT mailbox_attachments_text CHECK (
        char_length(attachment_ref) BETWEEN 1 AND 200
        AND char_length(file_name) BETWEEN 1 AND 200
        AND char_length(content_type) BETWEEN 1 AND 100
    ),
    CONSTRAINT mailbox_attachments_message_fkey
        FOREIGN KEY (organization_id, project_id, message_id)
        REFERENCES mailbox_messages (organization_id, project_id, id) ON DELETE RESTRICT,
    CONSTRAINT mailbox_attachments_ref_key UNIQUE (project_id, attachment_ref)
);

CREATE TABLE mailbox_notifications (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    notification_key text NOT NULL,
    message_id uuid NOT NULL,
    kind text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT mailbox_notifications_kind CHECK (kind IN ('created', 'updated')),
    CONSTRAINT mailbox_notifications_key CHECK (char_length(notification_key) BETWEEN 1 AND 200),
    CONSTRAINT mailbox_notifications_message_fkey
        FOREIGN KEY (organization_id, project_id, message_id)
        REFERENCES mailbox_messages (organization_id, project_id, id) ON DELETE RESTRICT,
    CONSTRAINT mailbox_notifications_key_unique UNIQUE (project_id, notification_key)
);

CREATE FUNCTION prevent_mailbox_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'mailbox records are immutable';
END;
$$;

CREATE TRIGGER mailbox_messages_immutable
    BEFORE UPDATE OR DELETE ON mailbox_messages
    FOR EACH ROW
    EXECUTE FUNCTION prevent_mailbox_mutation();

CREATE TRIGGER mailbox_attachments_immutable
    BEFORE UPDATE OR DELETE ON mailbox_attachments
    FOR EACH ROW
    EXECUTE FUNCTION prevent_mailbox_mutation();

CREATE TRIGGER mailbox_notifications_immutable
    BEFORE UPDATE OR DELETE ON mailbox_notifications
    FOR EACH ROW
    EXECUTE FUNCTION prevent_mailbox_mutation();
