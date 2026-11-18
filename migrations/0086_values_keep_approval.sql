-- A client value filled into an approved plan keeps its approval (decided by the product
-- owner, milestone L3e). The plan was approved with the value in brackets, waiting for it;
-- filling it, from the control or from another control's answer, is not a change to what
-- the plan tests. It is recorded (control_parameters, the control.values_set audit event)
-- and shown on the plan. Every other change still sends an approved plan back for review,
-- as migration 0079 set: rewording an attribute, or changing a value already filled.
--
-- fills_placeholders(old, new) holds when new is old with one or more of its bracketed
-- values filled in, and nothing else changed.
--
-- Rollback: restore control_attributes_revise_plan and engagement_controls_revise_plan
-- from migration 0079 and control_parameters_revise_plan from migration 0080, drop
-- fills_placeholders, and delete the
-- '0086_values_keep_approval' row from schema_migrations.

CREATE FUNCTION fills_placeholders(old_text text, new_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT old_text IS NOT NULL AND new_text IS NOT NULL
       AND new_text IS DISTINCT FROM old_text
       AND old_text ~ '\[[^]]+\]'
       AND new_text ~ (
           '^'
           || regexp_replace(
                  regexp_replace(old_text, '([.^$*+?(){}|\\])', '\\\1', 'g'),
                  '\[[^]]+\]', '.+', 'g'
              )
           || '$'
       );
$$;

CREATE OR REPLACE FUNCTION control_attributes_revise_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'APPROVED' THEN
            PERFORM revise_plan_of_control(NEW.engagement_control_id);
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.status = 'APPROVED' THEN
            PERFORM revise_plan_of_control(OLD.engagement_control_id);
        END IF;
    ELSIF (OLD.status = 'APPROVED' OR NEW.status = 'APPROVED')
          AND (OLD.status, OLD.text, OLD.objective, OLD.condition, OLD.pass_criteria,
               OLD.fail_criteria, OLD.judgment_required, OLD.automatable, OLD.phases)
              IS DISTINCT FROM
              (NEW.status, NEW.text, NEW.objective, NEW.condition, NEW.pass_criteria,
               NEW.fail_criteria, NEW.judgment_required, NEW.automatable, NEW.phases)
          -- An approved attribute whose bracketed client value is filled in is the same
          -- attribute.
          AND NOT (
              OLD.status = 'APPROVED' AND NEW.status = 'APPROVED'
              AND (OLD.objective, OLD.condition, OLD.pass_criteria, OLD.fail_criteria,
                   OLD.judgment_required, OLD.automatable, OLD.phases)
                  IS NOT DISTINCT FROM
                  (NEW.objective, NEW.condition, NEW.pass_criteria, NEW.fail_criteria,
                   NEW.judgment_required, NEW.automatable, NEW.phases)
              AND fills_placeholders(OLD.text, NEW.text)
          ) THEN
        PERFORM revise_plan_of_control(NEW.engagement_control_id);
    END IF;
    -- A rewording that takes effect keeps the links of the wording it replaces.
    IF TG_OP <> 'DELETE' AND NEW.status = 'APPROVED' AND NEW.replaces_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.status <> 'APPROVED') THEN
        INSERT INTO plan_procedure_attributes (
            procedure_id, attribute_id, organization_id, project_id, engagement_control_id,
            origin, created_by
        )
        SELECT procedure_id, NEW.id, organization_id, project_id, engagement_control_id,
               origin, created_by
        FROM plan_procedure_attributes WHERE attribute_id = NEW.replaces_id
        ON CONFLICT DO NOTHING;
        INSERT INTO evidence_requirement_attributes (
            requirement_id, attribute_id, organization_id, project_id, engagement_control_id,
            origin, created_by
        )
        SELECT requirement_id, NEW.id, organization_id, project_id, engagement_control_id,
               origin, created_by
        FROM evidence_requirement_attributes WHERE attribute_id = NEW.replaces_id
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

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
           AND NOT fills_placeholders(OLD.activity, NEW.activity)) THEN
        PERFORM revise_plan_of_control(NEW.id);
    END IF;
    RETURN NULL;
END;
$$;

-- A client value recorded where there was none fills the plan; changing or clearing one
-- already recorded changes it (migration 0080's rule, for those).
CREATE OR REPLACE FUNCTION control_parameters_revise_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.value IS NOT DISTINCT FROM NEW.value THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND coalesce(btrim(OLD.value), '') = '') THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'DELETE' AND coalesce(btrim(OLD.value), '') = '' THEN
        RETURN NULL;
    END IF;
    PERFORM revise_plan_of_control(
        CASE WHEN TG_OP = 'DELETE' THEN OLD.engagement_control_id ELSE NEW.engagement_control_id END
    );
    RETURN NULL;
END;
$$;
