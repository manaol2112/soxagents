-- Master test plans, milestone B: the planner's understanding and criteria, grounded.
--
-- 1. Who stated an attribute's criteria: a person, or the planner agent (proposed, for an
--    attribute the library does not define). A person's criteria are never replaced by a
--    run; the agent's are shown as the agent's until a person edits them.
-- 2. The client's values in a library control's statement (control_parameters) are part
--    of the control's understanding: a change revises the plan, and an approved plan goes
--    back for review (migration 0079's rule).
--
-- Rollback: drop the trigger and function below and the column criteria_origin; delete the
-- '0080_master_plan_grounding' row from schema_migrations.

ALTER TABLE control_attributes
    ADD COLUMN criteria_origin text,
    ADD CONSTRAINT control_attributes_criteria_origin CHECK (
        criteria_origin IS NULL OR criteria_origin IN ('PERSON', 'AGENT')
    );

-- Criteria already on record were written by a person (the only writer before now).
UPDATE control_attributes SET criteria_origin = 'PERSON'
WHERE condition <> '' OR pass_criteria <> '' OR fail_criteria <> ''
   OR judgment_required IS NOT NULL OR automatable IS NOT NULL;

CREATE FUNCTION control_parameters_revise_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.value IS NOT DISTINCT FROM NEW.value THEN
        RETURN NULL;
    END IF;
    PERFORM revise_plan_of_control(
        CASE WHEN TG_OP = 'DELETE' THEN OLD.engagement_control_id ELSE NEW.engagement_control_id END
    );
    RETURN NULL;
END;
$$;

CREATE TRIGGER control_parameters_revise_plan
    AFTER INSERT OR UPDATE OR DELETE ON control_parameters
    FOR EACH ROW EXECUTE FUNCTION control_parameters_revise_plan();
