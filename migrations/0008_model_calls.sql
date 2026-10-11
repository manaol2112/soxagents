-- Model calls record the outcome only. Prompts, outputs, and provider keys are not stored.

CREATE TABLE model_calls (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    model_config_ref text NOT NULL,
    operation text NOT NULL,
    status text NOT NULL,
    input_tokens integer NOT NULL,
    output_tokens integer NOT NULL,
    cost_micros integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT model_calls_config_not_blank CHECK (length(btrim(model_config_ref)) > 0),
    CONSTRAINT model_calls_operation CHECK (operation IN ('generate', 'propose_tools')),
    CONSTRAINT model_calls_status CHECK (
        status IN (
            'SUCCEEDED', 'MALFORMED', 'TIMEOUT', 'CANCELLED', 'RATE_LIMITED', 'MODEL_ERROR'
        )
    ),
    CONSTRAINT model_calls_tokens_nonnegative CHECK (input_tokens >= 0 AND output_tokens >= 0),
    CONSTRAINT model_calls_cost_nonnegative CHECK (cost_micros >= 0),
    CONSTRAINT model_calls_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT model_calls_actor_fk
        FOREIGN KEY (actor_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION prevent_model_call_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'model_calls are immutable';
END;
$$;

CREATE TRIGGER model_calls_immutable
BEFORE UPDATE OR DELETE ON model_calls
FOR EACH ROW EXECUTE FUNCTION prevent_model_call_mutation();

CREATE INDEX model_calls_project_idx ON model_calls (project_id, created_at);
