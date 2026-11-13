-- What the agents read at their last run (12 November 2026; docs/control-workflow-plan.md,
-- B1h "After the independent review").
--
-- Whether running the agents again on a control would do anything is one comparison: what
-- they would read now against what they read at their last finished run. Three facts of
-- the plan's run are kept on the plan, beside the run's status:
--
--   run_read     a hash of what the agents read at the start of their last run that
--                finished its work (evidence_plans.agents_read): the planner's facts, the
--                criteria a person stated, and the control's documents. Empty until such a
--                run has finished.
--   run_read_at  when that run finished.
--   run_tried    the same hash for the last run that did not finish its work (the planner's
--                answer could not be used and the plan was kept, or the run failed). While
--                the agents would read the same again, nothing queues the run by itself:
--                only a person, or a change in what they read. Cleared by a finished run.
--
-- Additive only: three defaulted or nullable columns. No backfill: for a plan with no
-- finished run on record the older rule applies (a change in the understanding after the
-- plan was generated).
--
-- Rollback: ALTER TABLE evidence_plans DROP COLUMN run_read, DROP COLUMN run_read_at,
-- DROP COLUMN run_tried; and delete the '0152_plan_run_read' row from schema_migrations.

ALTER TABLE evidence_plans
    ADD COLUMN run_read text NOT NULL DEFAULT '',
    ADD COLUMN run_read_at timestamptz,
    ADD COLUMN run_tried text NOT NULL DEFAULT '',
    ADD CONSTRAINT evidence_plans_run_read CHECK (
        char_length(run_read) <= 64 AND char_length(run_tried) <= 64
        AND (run_read = '') = (run_read_at IS NULL)
    );
