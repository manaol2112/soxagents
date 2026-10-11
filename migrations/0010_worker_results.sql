-- A worker result is a versioned handoff. It does not execute the proposed actions.

CREATE TABLE worker_results (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    agent_definition_id uuid NOT NULL,
    agent_revision integer NOT NULL,
    schema_version integer NOT NULL,
    result_version integer NOT NULL,
    operation_key text NOT NULL,
    status text NOT NULL,
    summary text NOT NULL,
    output jsonb NOT NULL,
    artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
    proposed_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
    required_approval jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT worker_results_schema_version CHECK (schema_version = 1),
    CONSTRAINT worker_results_revision_positive CHECK (agent_revision >= 1),
    CONSTRAINT worker_results_result_version_positive CHECK (result_version >= 1),
    CONSTRAINT worker_results_status CHECK (
        status IN ('SUCCEEDED', 'FAILED', 'BLOCKED', 'NEEDS_APPROVAL')
    ),
    CONSTRAINT worker_results_summary_not_blank CHECK (length(btrim(summary)) > 0),
    CONSTRAINT worker_results_operation_key_not_blank CHECK (length(btrim(operation_key)) > 0),
    CONSTRAINT worker_results_output_object CHECK (jsonb_typeof(output) = 'object'),
    CONSTRAINT worker_results_artifacts_array CHECK (jsonb_typeof(artifact_refs) = 'array'),
    CONSTRAINT worker_results_evidence_array CHECK (jsonb_typeof(evidence_refs) = 'array'),
    CONSTRAINT worker_results_errors_array CHECK (jsonb_typeof(errors) = 'array'),
    CONSTRAINT worker_results_limitations_array CHECK (jsonb_typeof(limitations) = 'array'),
    CONSTRAINT worker_results_actions_array CHECK (jsonb_typeof(proposed_actions) = 'array'),
    CONSTRAINT worker_results_approval_object CHECK (
        required_approval IS NULL OR jsonb_typeof(required_approval) = 'object'
    ),
    CONSTRAINT worker_results_operation_key UNIQUE (project_id, operation_key),
    CONSTRAINT worker_results_task_version_key UNIQUE (task_id, result_version),
    CONSTRAINT worker_results_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT worker_results_task_fk
        FOREIGN KEY (task_id, project_id, organization_id)
        REFERENCES tasks (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT worker_results_definition_fk
        FOREIGN KEY (agent_definition_id, organization_id)
        REFERENCES agent_definitions (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT worker_results_actor_fk
        FOREIGN KEY (actor_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION prevent_worker_result_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'worker_results are immutable';
END;
$$;

CREATE TRIGGER worker_results_immutable
BEFORE UPDATE OR DELETE ON worker_results
FOR EACH ROW EXECUTE FUNCTION prevent_worker_result_mutation();

CREATE INDEX worker_results_project_idx ON worker_results (project_id, created_at);
