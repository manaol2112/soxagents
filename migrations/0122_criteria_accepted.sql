-- A person accepts the criteria the planner agent proposed for an attribute, as they read
-- (decided by the product owner on 27 October 2026: "Needs review" offered no way to
-- confirm them). The criteria stay the agent's; who accepted them and when are recorded
-- beside them, so the attribute reads Confirmed without a person retyping the text. The
-- acceptance belongs to the words accepted: any change to the criteria clears it.
--
-- Rollback: drop the trigger and function below and the columns criteria_accepted_by and
-- criteria_accepted_at; delete the '0122_criteria_accepted' row from schema_migrations.
ALTER TABLE control_attributes
    ADD COLUMN criteria_accepted_by uuid REFERENCES users (id),
    ADD COLUMN criteria_accepted_at timestamptz,
    ADD CONSTRAINT control_attributes_criteria_accepted CHECK (
        (criteria_accepted_by IS NULL) = (criteria_accepted_at IS NULL)
        AND (criteria_accepted_by IS NULL OR criteria_origin = 'AGENT')
    );

CREATE FUNCTION control_attributes_criteria_acceptance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.objective, OLD.condition, OLD.pass_criteria, OLD.fail_criteria,
        OLD.judgment_required, OLD.automatable, OLD.criteria_origin)
       IS DISTINCT FROM
       (NEW.objective, NEW.condition, NEW.pass_criteria, NEW.fail_criteria,
        NEW.judgment_required, NEW.automatable, NEW.criteria_origin) THEN
        NEW.criteria_accepted_by := NULL;
        NEW.criteria_accepted_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER control_attributes_criteria_acceptance
    BEFORE UPDATE ON control_attributes
    FOR EACH ROW EXECUTE FUNCTION control_attributes_criteria_acceptance();
