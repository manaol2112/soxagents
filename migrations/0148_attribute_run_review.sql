-- The attributes follow the understanding, reviewed before a person sees them (decided by
-- the product owner on 12 November 2026; docs/control-workflow-plan.md, B1d).
--
-- Once Control Understanding is complete, the control's plan run (migration 0077) proposes
-- the attributes the understanding calls for, tailors every attribute's criteria, and has an
-- independent reviewer agent check the whole set against the control and its understanding.
-- Two facts of that run are kept on the plan, beside the run's status:
--
--   run_stage         what the run is doing now, for the Attributes step's working state:
--                     ATTRIBUTES (proposing), CRITERIA (tailoring), REVIEW (reviewing). Empty
--                     when no such run works.
--   attribute_review  the reviewer agent's latest review of the set: whether it finished,
--                     when, the model call it came from, its findings on the set, and per
--                     attribute a verdict (OK, REVISED, CONCERN) with a one-line reason and
--                     a mark of the words reviewed, so a review never stands for words that
--                     changed after it. Agent output: never a person's approval, and it
--                     settles nothing.
--
-- Additive only: two nullable or defaulted columns. No backfill: no plan has such a run or
-- a review today.
--
-- Rollback: ALTER TABLE evidence_plans DROP COLUMN run_stage, DROP COLUMN attribute_review;
-- and delete the '0148_attribute_run_review' row from schema_migrations.

ALTER TABLE evidence_plans
    ADD COLUMN run_stage text NOT NULL DEFAULT '',
    ADD COLUMN attribute_review jsonb,
    ADD CONSTRAINT evidence_plans_run_stage CHECK (
        run_stage IN ('', 'ATTRIBUTES', 'CRITERIA', 'REVIEW')
    ),
    ADD CONSTRAINT evidence_plans_attribute_review CHECK (
        attribute_review IS NULL OR jsonb_typeof(attribute_review) = 'object'
    );
