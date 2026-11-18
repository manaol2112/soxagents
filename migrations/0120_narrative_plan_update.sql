-- The test plan follows the approved process narrative (decided by the product owner on 26
-- October 2026: "evidence and attribute should be leveraging the approved process
-- narratives because controls should be tested based on how the control is setup").
-- Approving a narrative starts a background run that updates the control's attributes and
-- evidence from it: a plan still being drafted is updated directly, and an approved plan
-- receives proposals that a person accepts or dismisses. The run has its own mode and
-- stages, and keeps what it changed for the narrative to show.
ALTER TABLE process_narrative_runs
    DROP CONSTRAINT process_narrative_runs_mode,
    ADD CONSTRAINT process_narrative_runs_mode CHECK (mode IN ('DRAFT', 'REVIEW', 'PLAN')),
    DROP CONSTRAINT process_narrative_runs_stage,
    ADD CONSTRAINT process_narrative_runs_stage CHECK (
        stage IN ('', 'PREPARING', 'DRAFTING', 'REVIEWING', 'CHECKING', 'ATTRIBUTES', 'EVIDENCE')
    ),
    -- {attributes: proposed, evidence: changed or proposed, note}; null before any update.
    ADD COLUMN plan_outcome jsonb,
    ADD COLUMN planned_at timestamptz,
    ADD CONSTRAINT process_narrative_runs_plan_outcome CHECK (
        plan_outcome IS NULL OR jsonb_typeof(plan_outcome) = 'object'
    );
