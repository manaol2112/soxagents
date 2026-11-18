-- Milestone 3d: what is needed to reconstruct why an agent produced a result, beside the
-- inputs (0095).
--
-- `model_calls.config` is the call's configuration, written with the call: the model and
-- tier as configured, the output limit, the timeout, the hash of the output schema, the
-- tools allowed (none for a job) and how many images were sent.
--
-- `model_call_outcomes` is what the system made of the answer, written once by the job
-- that read it, after the call was recorded: whether it was accepted, rejected (and why)
-- or not used (the call failed), each proposed result as kept, the citations offered and
-- verified, and the deterministic checks applied. A separate append-only table, because
-- model_calls is immutable once written (0008). Neither holds evidence text or the
-- prompt: the sealed content (model_call_contents) stays the only copy, under its own
-- retention.

ALTER TABLE model_calls
    ADD COLUMN config jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT model_calls_config_object CHECK (jsonb_typeof(config) = 'object');

CREATE TABLE model_call_outcomes (
    model_call_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    outcome jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT model_call_outcomes_object CHECK (jsonb_typeof(outcome) = 'object'),
    CONSTRAINT model_call_outcomes_validation CHECK (
        outcome ->> 'validation' IN ('ACCEPTED', 'REJECTED', 'NOT_USED')
    ),
    CONSTRAINT model_call_outcomes_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT model_call_outcomes_call_fk
        FOREIGN KEY (model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION prevent_model_call_outcome_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'model call outcomes are immutable';
END;
$$;

CREATE TRIGGER model_call_outcomes_immutable
BEFORE UPDATE OR DELETE ON model_call_outcomes
FOR EACH ROW EXECUTE FUNCTION prevent_model_call_outcome_mutation();
