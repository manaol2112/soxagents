-- The evidence planner agent's run on a control's plan. At launch each control gets the
-- reviewed rules' plan at once, then the planner agent refines it in the background; the
-- plan waits for a person's approval either way, and no request is drafted before then.
ALTER TABLE evidence_plans
    -- IDLE: nothing to run. PENDING: the agent is to plan it. WORKING: it is planning
    -- (leased). FAILED: the agent could not; the rules' plan stands.
    ADD COLUMN run_status text NOT NULL DEFAULT 'IDLE',
    ADD COLUMN run_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN run_lease_until timestamptz,
    ADD COLUMN run_note text NOT NULL DEFAULT '',
    ADD CONSTRAINT evidence_plans_run_status CHECK (
        run_status IN ('IDLE', 'PENDING', 'WORKING', 'FAILED')
    ),
    ADD CONSTRAINT evidence_plans_run_attempts CHECK (run_attempts BETWEEN 0 AND 50),
    ADD CONSTRAINT evidence_plans_run_note CHECK (char_length(run_note) <= 300);

CREATE INDEX evidence_plans_runs ON evidence_plans (run_status, run_lease_until)
    WHERE run_status IN ('PENDING', 'WORKING');
