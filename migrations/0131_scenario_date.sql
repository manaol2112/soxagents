-- Trial Management and Synthetic Demo Experience, Step 4B closure: the synthetic
-- scenario date of a demo engagement.
--
-- A demo engagement is set in a fictional period (the Northstar demo: FY2027). Three
-- things in the audit's own workflow compare a date with "today": whether a fix can
-- have taken effect, whether a retest may start, and how the schedule's milestones
-- read. For a demo engagement those three read the engagement's scenario date instead
-- (scenario.py); everything else, and every real engagement, reads the clock.
--
-- The date lives only on a demo engagement's settings row, set only by demo
-- initialization (the transaction carries aw.demo_initialization), and never on a real
-- engagement: the trigger refuses it anywhere else. No route writes it. Subscriptions,
-- authentication, authorization and the AI budgets never read it.

ALTER TABLE engagement_settings ADD COLUMN scenario_as_of date;

CREATE FUNCTION guard_scenario_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.scenario_as_of IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT is_demo_project(NEW.project_id) THEN
        RAISE EXCEPTION 'a scenario date belongs to a demo engagement only'
            USING ERRCODE = 'check_violation';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.scenario_as_of IS DISTINCT FROM OLD.scenario_as_of)
       AND coalesce(current_setting('aw.demo_initialization', true), '')
           <> NEW.organization_id::text THEN
        RAISE EXCEPTION 'a scenario date is set only by demo initialization'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_settings_scenario_date
    BEFORE INSERT OR UPDATE OF scenario_as_of ON engagement_settings
    FOR EACH ROW
    EXECUTE FUNCTION guard_scenario_date();
