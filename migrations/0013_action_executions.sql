ALTER TABLE approvals DROP CONSTRAINT approvals_execution_status;

ALTER TABLE approvals
    ADD CONSTRAINT approvals_execution_status
    CHECK (execution_status IN ('NOT_STARTED', 'SUCCEEDED', 'REFUSED'));

CREATE OR REPLACE FUNCTION prevent_approval_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'approvals are immutable';
    END IF;
    IF OLD.decision = 'PENDING' THEN
        IF NEW.decision NOT IN ('APPROVED', 'REJECTED', 'EXPIRED') THEN
            RAISE EXCEPTION 'approvals are immutable';
        END IF;
        IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
            OR NEW.project_id IS DISTINCT FROM OLD.project_id
            OR NEW.requesting_user_id IS DISTINCT FROM OLD.requesting_user_id
            OR NEW.requesting_agent_id IS DISTINCT FROM OLD.requesting_agent_id
            OR NEW.action_id IS DISTINCT FROM OLD.action_id
            OR NEW.parameters IS DISTINCT FROM OLD.parameters
            OR NEW.target_resource IS DISTINCT FROM OLD.target_resource
            OR NEW.risk IS DISTINCT FROM OLD.risk
            OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
            OR NEW.execution_status IS DISTINCT FROM OLD.execution_status
            OR NEW.created_at IS DISTINCT FROM OLD.created_at
            OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        THEN
            RAISE EXCEPTION 'approvals are immutable';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.decision = 'APPROVED'
        AND OLD.execution_status = 'NOT_STARTED'
        AND NEW.decision = 'APPROVED'
        AND NEW.execution_status IN ('SUCCEEDED', 'REFUSED')
        AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
        AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
        AND NEW.requesting_user_id IS NOT DISTINCT FROM OLD.requesting_user_id
        AND NEW.requesting_agent_id IS NOT DISTINCT FROM OLD.requesting_agent_id
        AND NEW.action_id IS NOT DISTINCT FROM OLD.action_id
        AND NEW.parameters IS NOT DISTINCT FROM OLD.parameters
        AND NEW.target_resource IS NOT DISTINCT FROM OLD.target_resource
        AND NEW.risk IS NOT DISTINCT FROM OLD.risk
        AND NEW.payload_hash IS NOT DISTINCT FROM OLD.payload_hash
        AND NEW.approver_user_id IS NOT DISTINCT FROM OLD.approver_user_id
        AND NEW.decision_reason IS NOT DISTINCT FROM OLD.decision_reason
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
        AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
        AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
    THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'approvals are immutable';
END;
$$;

CREATE TABLE action_executions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    approval_id uuid,
    action_id text NOT NULL,
    payload_hash text NOT NULL,
    status text NOT NULL,
    result_ref text,
    reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT action_executions_status CHECK (status IN ('SUCCEEDED', 'REFUSED')),
    CONSTRAINT action_executions_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT action_executions_reason CHECK (
        (
            status = 'SUCCEEDED'
            AND reason IS NULL
            AND result_ref IS NOT NULL
            AND char_length(result_ref) BETWEEN 1 AND 300
        )
        OR (
            status = 'REFUSED'
            AND result_ref IS NULL
            AND reason IN ('live_email_disabled', 'not_available', 'protected_role')
        )
    ),
    CONSTRAINT action_executions_organization_fkey
        FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT,
    CONSTRAINT action_executions_project_fkey
        FOREIGN KEY (organization_id, project_id)
        REFERENCES projects (organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT action_executions_actor_fkey
        FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT action_executions_approval_fkey
        FOREIGN KEY (approval_id) REFERENCES approvals (id) ON DELETE RESTRICT,
    CONSTRAINT action_executions_project_hash_key UNIQUE (project_id, payload_hash),
    CONSTRAINT action_executions_approval_key UNIQUE (approval_id)
);

CREATE INDEX action_executions_project_idx ON action_executions (project_id, created_at);

CREATE FUNCTION prevent_action_execution_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'action executions are immutable';
END;
$$;

CREATE TRIGGER action_executions_immutable
    BEFORE UPDATE OR DELETE ON action_executions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_action_execution_mutation();
