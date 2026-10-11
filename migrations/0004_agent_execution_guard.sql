-- Disabling an agent definition does not update existing instance rows.
-- An instance already RUNNING or WAITING may still reach a terminal status.
-- A disabled definition rejects a new instance and rejects a start from any other status.

CREATE FUNCTION enforce_agent_execution_gate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    definition_status text;
BEGIN
    SELECT status::text INTO definition_status
    FROM public.agent_definitions
    WHERE id = NEW.agent_definition_id
      AND organization_id = NEW.organization_id;
    IF definition_status IS NULL THEN
        RAISE EXCEPTION 'agent definition is not visible';
    END IF;
    IF definition_status = 'DISABLED' THEN
        IF TG_OP = 'INSERT' THEN
            RAISE EXCEPTION 'disabled agent cannot start an execution';
        ELSIF NEW.agent_definition_id IS DISTINCT FROM OLD.agent_definition_id THEN
            RAISE EXCEPTION 'disabled agent cannot start an execution';
        ELSIF NEW.status::text IN ('RUNNING', 'WAITING')
           AND OLD.status::text NOT IN ('RUNNING', 'WAITING') THEN
            RAISE EXCEPTION 'disabled agent cannot start an execution';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agent_instances_execution_gate
BEFORE INSERT OR UPDATE OF status, agent_definition_id ON agent_instances
FOR EACH ROW EXECUTE FUNCTION enforce_agent_execution_gate();
