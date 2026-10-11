-- An approval is bound to the exact action parameters. This milestone does not execute it.

CREATE TABLE approvals (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    requesting_user_id uuid NOT NULL,
    requesting_agent_id uuid,
    action_id text NOT NULL,
    parameters jsonb NOT NULL,
    target_resource text NOT NULL,
    risk text NOT NULL,
    payload_hash text NOT NULL,
    approver_user_id uuid,
    decision text NOT NULL DEFAULT 'PENDING',
    decision_reason text,
    execution_status text NOT NULL DEFAULT 'NOT_STARTED',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    decided_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT approvals_action_id_format CHECK (action_id ~ '^[a-z]+(?:[.][a-z]+)*$'),
    CONSTRAINT approvals_parameters_object CHECK (jsonb_typeof(parameters) = 'object'),
    CONSTRAINT approvals_target_not_blank CHECK (length(btrim(target_resource)) > 0),
    CONSTRAINT approvals_risk CHECK (risk IN ('LOW', 'MODERATE', 'HIGH')),
    CONSTRAINT approvals_hash_format CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT approvals_decision CHECK (
        decision IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')
    ),
    CONSTRAINT approvals_execution_status CHECK (execution_status = 'NOT_STARTED'),
    CONSTRAINT approvals_version_positive CHECK (version >= 1),
    CONSTRAINT approvals_expires_after_create CHECK (expires_at > created_at),
    CONSTRAINT approvals_decision_shape CHECK (
        (
            decision = 'PENDING'
            AND approver_user_id IS NULL
            AND decided_at IS NULL
            AND decision_reason IS NULL
        )
        OR (
            decision = 'EXPIRED'
            AND approver_user_id IS NULL
            AND decided_at IS NOT NULL
            AND decision_reason IS NULL
        )
        OR (
            decision IN ('APPROVED', 'REJECTED')
            AND approver_user_id IS NOT NULL
            AND decided_at IS NOT NULL
            AND decision_reason IS NOT NULL
            AND length(btrim(decision_reason)) > 0
        )
    ),
    CONSTRAINT approvals_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT approvals_requester_fk
        FOREIGN KEY (requesting_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT approvals_agent_fk
        FOREIGN KEY (requesting_agent_id, organization_id)
        REFERENCES agent_definitions (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT approvals_approver_fk
        FOREIGN KEY (approver_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX approvals_pending_key
    ON approvals (project_id, requesting_user_id, payload_hash)
    WHERE decision = 'PENDING';

CREATE INDEX approvals_project_idx ON approvals (project_id, created_at);

CREATE FUNCTION prevent_approval_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'approvals are immutable';
    END IF;
    IF OLD.decision <> 'PENDING' THEN
        RAISE EXCEPTION 'approvals are immutable';
    END IF;
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
END;
$$;

CREATE TRIGGER approvals_immutable
BEFORE UPDATE OR DELETE ON approvals
FOR EACH ROW EXECUTE FUNCTION prevent_approval_mutation();
