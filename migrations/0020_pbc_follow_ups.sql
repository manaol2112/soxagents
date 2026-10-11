ALTER TABLE outbound_messages DROP CONSTRAINT outbound_messages_error;

ALTER TABLE outbound_messages
    ADD CONSTRAINT outbound_messages_error CHECK (
        (
            status IN ('FAILED', 'UNKNOWN')
            AND error_code IN (
                'live_email_disabled', 'invalid_message', 'approval_expired',
                'timeout', 'provider_error', 'request_resolved'
            )
        )
        OR (status NOT IN ('FAILED', 'UNKNOWN') AND error_code = '')
    );

-- Set when reminders escalate a request. Automatic reminders never resume after that.
ALTER TABLE pbc_requests ADD COLUMN follow_ups_ended_at timestamptz;

CREATE TABLE pbc_follow_ups (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    pbc_request_id uuid NOT NULL,
    sequence integer NOT NULL,
    status text NOT NULL DEFAULT 'DUE',
    due_at timestamptz NOT NULL,
    approval_id uuid,
    outbound_id uuid,
    closed_at timestamptz,
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT pbc_follow_ups_status CHECK (
        status IN ('DUE', 'APPROVAL_PENDING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED')
    ),
    CONSTRAINT pbc_follow_ups_sequence CHECK (sequence BETWEEN 1 AND 10),
    CONSTRAINT pbc_follow_ups_approval CHECK (
        (status = 'DUE' AND approval_id IS NULL)
        OR (status IN ('APPROVAL_PENDING', 'SENT') AND approval_id IS NOT NULL)
        OR status IN ('SKIPPED', 'FAILED', 'CANCELLED')
    ),
    CONSTRAINT pbc_follow_ups_outbound CHECK (
        (status = 'SENT' AND outbound_id IS NOT NULL)
        OR (status IN ('DUE', 'APPROVAL_PENDING', 'SKIPPED') AND outbound_id IS NULL)
        OR status IN ('FAILED', 'CANCELLED')
    ),
    CONSTRAINT pbc_follow_ups_closed CHECK (
        (status IN ('DUE', 'APPROVAL_PENDING')) = (closed_at IS NULL)
    ),
    CONSTRAINT pbc_follow_ups_reason CHECK (
        (status IN ('DUE', 'APPROVAL_PENDING', 'SENT') AND reason = '')
        OR (
            status = 'SKIPPED'
            AND reason IN ('approval_rejected', 'skipped_by_person', 'reply_received')
        )
        OR (status = 'FAILED' AND reason IN ('delivery_failed', 'approval_expired'))
        OR (status = 'CANCELLED' AND reason = 'request_resolved')
    ),
    CONSTRAINT pbc_follow_ups_version CHECK (version >= 1),
    CONSTRAINT pbc_follow_ups_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_follow_ups_request_fk
        FOREIGN KEY (project_id, pbc_request_id) REFERENCES pbc_requests (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_follow_ups_approval_fk
        FOREIGN KEY (approval_id) REFERENCES approvals (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_follow_ups_outbound_fk
        FOREIGN KEY (outbound_id) REFERENCES outbound_messages (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_follow_ups_approval_key UNIQUE (approval_id),
    CONSTRAINT pbc_follow_ups_outbound_key UNIQUE (outbound_id)
);

-- A slot is used by a sent or deliberately skipped reminder. Failed, cancelled, and
-- reply-superseded reminders free their slot. One open reminder per request.
CREATE UNIQUE INDEX pbc_follow_ups_slot_key ON pbc_follow_ups (pbc_request_id, sequence)
    WHERE status IN ('DUE', 'APPROVAL_PENDING', 'SENT')
        OR (status = 'SKIPPED' AND reason <> 'reply_received');
CREATE UNIQUE INDEX pbc_follow_ups_open_key ON pbc_follow_ups (pbc_request_id)
    WHERE status IN ('DUE', 'APPROVAL_PENDING');
CREATE INDEX pbc_follow_ups_project_idx ON pbc_follow_ups (project_id, created_at);

CREATE FUNCTION guard_pbc_follow_up()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'follow-ups cannot be deleted';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.pbc_request_id IS DISTINCT FROM OLD.pbc_request_id
        OR NEW.sequence IS DISTINCT FROM OLD.sequence
        OR NEW.due_at IS DISTINCT FROM OLD.due_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'follow-up identity is immutable';
    END IF;
    IF (OLD.approval_id IS NOT NULL AND NEW.approval_id IS DISTINCT FROM OLD.approval_id)
        OR (OLD.outbound_id IS NOT NULL AND NEW.outbound_id IS DISTINCT FROM OLD.outbound_id)
    THEN
        RAISE EXCEPTION 'follow-up references are bound';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'follow-up update is invalid';
    END IF;
    IF (OLD.status = 'DUE' AND NEW.status IN ('APPROVAL_PENDING', 'SKIPPED', 'CANCELLED'))
        OR (
            OLD.status = 'APPROVAL_PENDING'
            AND NEW.status IN ('SENT', 'SKIPPED', 'FAILED', 'CANCELLED')
        )
    THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'follow-up status change is not allowed';
END;
$$;

CREATE TRIGGER pbc_follow_ups_guard
    BEFORE UPDATE OR DELETE ON pbc_follow_ups
    FOR EACH ROW
    EXECUTE FUNCTION guard_pbc_follow_up();
