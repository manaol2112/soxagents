-- A task may name an agent instance only when that instance's definition is ACTIVE.
-- The instance must already belong to the task's project. Disabling a definition
-- does not clear assignments that were saved earlier.

CREATE FUNCTION enforce_task_agent_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    definition_status text;
BEGIN
    IF NEW.agent_instance_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.agent_instance_id IS NOT DISTINCT FROM OLD.agent_instance_id THEN
        RETURN NEW;
    END IF;
    SELECT definition.status::text INTO definition_status
    FROM public.agent_instances AS instance
    JOIN public.agent_definitions AS definition
      ON definition.id = instance.agent_definition_id
     AND definition.organization_id = instance.organization_id
    WHERE instance.id = NEW.agent_instance_id
      AND instance.project_id = NEW.project_id
      AND instance.organization_id = NEW.organization_id;
    IF definition_status IS NULL THEN
        RAISE EXCEPTION 'agent instance is not visible';
    END IF;
    IF definition_status = 'DISABLED' THEN
        RAISE EXCEPTION 'task cannot be assigned to a disabled agent';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_agent_assignment
BEFORE INSERT OR UPDATE OF agent_instance_id, project_id, organization_id ON tasks
FOR EACH ROW EXECUTE FUNCTION enforce_task_agent_assignment();
