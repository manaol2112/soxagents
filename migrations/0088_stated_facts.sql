-- The facts the team states about a client's own control (decided by the product owner):
-- whether it prevents or detects, who performs and who reviews it, the assertions it
-- addresses, and the planner's proposals the team confirms (objective, population, what it
-- relies on). A library control takes these from its statement; a client's control from its
-- RCM had nowhere to record them, so its plan asked and nothing could answer.
--
-- stated_facts holds, by fact, {"value", "by", "by_name", "at"}. Stating a fact the plan
-- was missing is not a change to an approved plan, as a filled client value is not
-- (migration 0086); changing or clearing one already stated is, and sends it back.
--
-- Rollback: restore engagement_controls_revise_plan from migration 0086, drop the column
-- and its constraint, and delete the '0088_stated_facts' row from schema_migrations.

ALTER TABLE engagement_controls
    ADD COLUMN stated_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT engagement_controls_stated_facts CHECK (
        jsonb_typeof(stated_facts) = 'object'
    );

CREATE OR REPLACE FUNCTION engagement_controls_revise_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.title, OLD.risk, OLD.frequency, OLD.nature, OLD.domain, OLD.key_control,
        OLD.engagement_application_id, OLD.classifications)
       IS DISTINCT FROM
       (NEW.title, NEW.risk, NEW.frequency, NEW.nature, NEW.domain, NEW.key_control,
        NEW.engagement_application_id, NEW.classifications)
       -- The description restated with a client value filled in is the same description.
       OR (OLD.activity IS DISTINCT FROM NEW.activity
           AND NOT fills_placeholders(OLD.activity, NEW.activity))
       -- A fact the team stated, changed or cleared.
       OR EXISTS (
           SELECT 1 FROM jsonb_each(OLD.stated_facts) AS stated(name, fact)
           WHERE (NEW.stated_facts -> stated.name ->> 'value')
                 IS DISTINCT FROM (stated.fact ->> 'value')
       ) THEN
        PERFORM revise_plan_of_control(NEW.id);
    END IF;
    RETURN NULL;
END;
$$;
