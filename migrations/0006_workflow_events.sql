-- Execution history is append-only. Retry policy lives on the run.
-- A terminal status keeps finished_at. Pause and resume do not finish the run.

ALTER TABLE workflow_runs
    ADD COLUMN attempt integer NOT NULL DEFAULT 1,
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 1,
    ADD CONSTRAINT workflow_runs_id_project_key UNIQUE (id, project_id, organization_id),
    ADD CONSTRAINT workflow_runs_attempt_positive CHECK (attempt >= 1),
    ADD CONSTRAINT workflow_runs_max_attempts_positive CHECK (max_attempts >= 1),
    ADD CONSTRAINT workflow_runs_attempt_within_policy CHECK (attempt <= max_attempts),
    ADD CONSTRAINT workflow_runs_terminal_has_finished CHECK (
        status IN ('RUNNING', 'PAUSED') OR finished_at IS NOT NULL
    );

CREATE TABLE workflow_events (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    workflow_run_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT workflow_events_type_not_blank CHECK (length(btrim(event_type)) > 0),
    CONSTRAINT workflow_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT workflow_events_run_fk
        FOREIGN KEY (workflow_run_id, project_id, organization_id)
        REFERENCES workflow_runs (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION prevent_workflow_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'workflow_events are immutable';
END;
$$;

CREATE TRIGGER workflow_events_immutable
BEFORE UPDATE OR DELETE ON workflow_events
FOR EACH ROW EXECUTE FUNCTION prevent_workflow_event_mutation();

CREATE INDEX workflow_events_run_idx ON workflow_events (workflow_run_id, occurred_at);
