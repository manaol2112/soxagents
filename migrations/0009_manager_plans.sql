-- A manager plan records the decision. It does not store model output.

CREATE TABLE manager_plans (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    objective text NOT NULL,
    status text NOT NULL,
    assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
    task_ids uuid[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manager_plans_objective_not_blank CHECK (length(btrim(objective)) > 0),
    CONSTRAINT manager_plans_status CHECK (
        status IN ('CREATED', 'CLARIFICATION', 'ESCALATED', 'REFUSED')
    ),
    CONSTRAINT manager_plans_assumptions_array CHECK (jsonb_typeof(assumptions) = 'array'),
    CONSTRAINT manager_plans_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT manager_plans_actor_fk
        FOREIGN KEY (actor_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION prevent_manager_plan_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'manager_plans are immutable';
END;
$$;

CREATE TRIGGER manager_plans_immutable
BEFORE UPDATE OR DELETE ON manager_plans
FOR EACH ROW EXECUTE FUNCTION prevent_manager_plan_mutation();

CREATE INDEX manager_plans_project_idx ON manager_plans (project_id, created_at);
