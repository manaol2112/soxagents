CREATE TABLE pbc_requests (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    operation_key text NOT NULL,
    control_ref text NOT NULL,
    owner_user_id uuid NOT NULL,
    recipient text NOT NULL,
    due_at timestamptz NOT NULL,
    evidence_description text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    outbound_message_id text,
    thread_id text,
    first_response_at timestamptz,
    received_at timestamptz,
    attachment_refs text[] NOT NULL DEFAULT '{}',
    follow_up_after_days integer NOT NULL DEFAULT 3,
    max_follow_ups integer NOT NULL DEFAULT 2,
    escalation_state text NOT NULL DEFAULT 'NONE',
    cancellation_reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT pbc_requests_key CHECK (operation_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$'),
    CONSTRAINT pbc_requests_control CHECK (control_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$'),
    CONSTRAINT pbc_requests_description CHECK (
        char_length(evidence_description) BETWEEN 1 AND 4000
    ),
    CONSTRAINT pbc_requests_status CHECK (
        status IN (
            'DRAFT', 'APPROVAL_PENDING', 'SENT', 'WAITING_FOR_RESPONSE',
            'PARTIALLY_RECEIVED', 'RECEIVED', 'OVERDUE', 'ESCALATED',
            'CANCELLED', 'CLOSED'
        )
    ),
    CONSTRAINT pbc_requests_message_pair CHECK (
        (outbound_message_id IS NULL AND thread_id IS NULL)
        OR (
            outbound_message_id IS NOT NULL
            AND thread_id IS NOT NULL
            AND char_length(outbound_message_id) BETWEEN 1 AND 80
            AND char_length(thread_id) BETWEEN 1 AND 80
        )
    ),
    CONSTRAINT pbc_requests_message_required CHECK (
        status IN ('DRAFT', 'APPROVAL_PENDING', 'CANCELLED', 'CLOSED')
        OR (outbound_message_id IS NOT NULL AND thread_id IS NOT NULL)
    ),
    CONSTRAINT pbc_requests_attachments CHECK (cardinality(attachment_refs) <= 20),
    CONSTRAINT pbc_requests_follow_up CHECK (
        follow_up_after_days BETWEEN 1 AND 30
        AND max_follow_ups BETWEEN 0 AND 10
    ),
    CONSTRAINT pbc_requests_escalation CHECK (
        (status = 'ESCALATED' AND escalation_state = 'ESCALATED')
        OR (status <> 'ESCALATED' AND escalation_state = 'NONE')
    ),
    CONSTRAINT pbc_requests_cancellation CHECK (
        (status = 'CANCELLED' AND char_length(btrim(cancellation_reason)) > 0)
        OR (status <> 'CANCELLED' AND cancellation_reason = '')
    ),
    CONSTRAINT pbc_requests_received CHECK (
        received_at IS NULL OR status IN ('RECEIVED', 'CLOSED')
    ),
    CONSTRAINT pbc_requests_version CHECK (version >= 1),
    CONSTRAINT pbc_requests_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_requests_owner_fk
        FOREIGN KEY (owner_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_requests_operation_key UNIQUE (project_id, operation_key)
);

CREATE INDEX pbc_requests_project_idx ON pbc_requests (project_id, created_at);
