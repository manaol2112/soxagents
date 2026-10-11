-- One recorded outcome per operation. A timed-out attempt must not insert a second row.

CREATE TABLE workflow_effects (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    workflow_run_id uuid NOT NULL,
    operation_key text NOT NULL,
    outcome text NOT NULL,
    attempt integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT workflow_effects_key_not_blank CHECK (length(btrim(operation_key)) > 0),
    CONSTRAINT workflow_effects_outcome CHECK (outcome IN ('SUCCEEDED', 'FAILED', 'AMBIGUOUS')),
    CONSTRAINT workflow_effects_attempt_positive CHECK (attempt >= 1),
    CONSTRAINT workflow_effects_operation_key UNIQUE (workflow_run_id, operation_key),
    CONSTRAINT workflow_effects_run_fk
        FOREIGN KEY (workflow_run_id, project_id, organization_id)
        REFERENCES workflow_runs (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION prevent_workflow_effect_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'workflow_effects are immutable';
END;
$$;

CREATE TRIGGER workflow_effects_immutable
BEFORE UPDATE OR DELETE ON workflow_effects
FOR EACH ROW EXECUTE FUNCTION prevent_workflow_effect_mutation();
