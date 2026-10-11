-- The standard workforce is part of every firm and every engagement.
--
-- The roster is code. The deploy step (python -m ai_workforce_api.migrate) copies it
-- into standard_agents and brings every firm up to date. These triggers then keep it
-- true without anyone acting:
--   * a new firm receives every standard worker;
--   * a new engagement is staffed with the firm's active standard workers;
--   * a standard worker that is added or re-enabled is staffed on open engagements.
-- Standard workers are locked. Outside the deploy sync, only their status can change.

ALTER TABLE agent_definitions
    ADD COLUMN source text NOT NULL DEFAULT 'custom',
    ADD COLUMN roster_version integer;

ALTER TABLE agent_definitions
    ADD CONSTRAINT agent_definitions_source CHECK (source IN ('custom', 'standard')),
    ADD CONSTRAINT agent_definitions_roster CHECK (
        (source = 'standard') = (roster_version IS NOT NULL AND roster_version >= 1)
    );

CREATE TABLE standard_agents (
    agent_key text PRIMARY KEY,
    roster_version integer NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    description text NOT NULL,
    input_schema jsonb NOT NULL,
    output_schema jsonb NOT NULL,
    allowed_tool_ids text[] NOT NULL,
    model_config_ref text NOT NULL,
    max_iterations integer NOT NULL,
    time_budget_seconds integer NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT standard_agents_key_format CHECK (agent_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT standard_agents_roster CHECK (roster_version >= 1),
    CONSTRAINT standard_agents_schemas CHECK (
        jsonb_typeof(input_schema) = 'object' AND jsonb_typeof(output_schema) = 'object'
    ),
    CONSTRAINT standard_agents_limits CHECK (max_iterations > 0 AND time_budget_seconds > 0)
);

CREATE FUNCTION standard_sync_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    SELECT coalesce(current_setting('app.standard_sync', true), '') = 'on'
$$;

-- Standard workers are platform-managed.
CREATE FUNCTION guard_standard_agent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF public.standard_sync_active() THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.source = 'standard' AND pg_trigger_depth() < 2 THEN
            RAISE EXCEPTION 'standard agents are managed by the platform';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.source = 'standard' THEN
            RAISE EXCEPTION 'standard agents are managed by the platform';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.source IS DISTINCT FROM OLD.source
        OR NEW.roster_version IS DISTINCT FROM OLD.roster_version
    THEN
        RAISE EXCEPTION 'standard agents are managed by the platform';
    END IF;
    IF OLD.source = 'standard' AND (
        NEW.agent_key, NEW.name, NEW.role, NEW.description, NEW.input_schema,
        NEW.output_schema, NEW.allowed_tool_ids, NEW.model_config_ref, NEW.max_iterations,
        NEW.time_budget_seconds, NEW.organization_id
    ) IS DISTINCT FROM (
        OLD.agent_key, OLD.name, OLD.role, OLD.description, OLD.input_schema,
        OLD.output_schema, OLD.allowed_tool_ids, OLD.model_config_ref, OLD.max_iterations,
        OLD.time_budget_seconds, OLD.organization_id
    ) THEN
        RAISE EXCEPTION 'standard agents are managed by the platform';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agent_definitions_standard_guard
    BEFORE INSERT OR UPDATE OR DELETE ON agent_definitions
    FOR EACH ROW EXECUTE FUNCTION guard_standard_agent();

-- A new firm receives the standard workforce.
CREATE FUNCTION install_standard_workforce()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    WITH installed AS (
        INSERT INTO public.agent_definitions (
            organization_id, agent_key, name, role, description, input_schema,
            output_schema, allowed_tool_ids, model_config_ref, max_iterations,
            time_budget_seconds, status, source, roster_version
        )
        SELECT NEW.id, s.agent_key, s.name, s.role, s.description, s.input_schema,
               s.output_schema, s.allowed_tool_ids, s.model_config_ref, s.max_iterations,
               s.time_budget_seconds, 'ACTIVE', 'standard', s.roster_version
        FROM public.standard_agents AS s
        ORDER BY s.agent_key
        ON CONFLICT (organization_id, agent_key) DO NOTHING
        RETURNING id, organization_id, roster_version
    )
    INSERT INTO public.audit_events (organization_id, action, target_type, target_id, payload)
    SELECT organization_id, 'agent.created', 'agent_definition', id,
           jsonb_build_object(
               'status', 'ACTIVE', 'revision', 1, 'source', 'standard',
               'roster_version', roster_version
           )
    FROM installed;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_standard_workforce
    AFTER INSERT ON organizations
    FOR EACH ROW EXECUTE FUNCTION install_standard_workforce();

-- A new engagement is staffed with the firm's active standard workers.
CREATE FUNCTION staff_new_engagement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.status::text = 'ARCHIVED' THEN
        RETURN NEW;
    END IF;
    WITH staffed AS (
        INSERT INTO public.agent_instances (
            organization_id, project_id, agent_definition_id, definition_revision
        )
        SELECT d.organization_id, NEW.id, d.id, d.revision
        FROM public.agent_definitions AS d
        WHERE d.organization_id = NEW.organization_id
          AND d.source = 'standard'
          AND d.status::text = 'ACTIVE'
        ORDER BY d.agent_key
        ON CONFLICT (project_id, agent_definition_id) DO NOTHING
        RETURNING id, organization_id, project_id, agent_definition_id
    )
    INSERT INTO public.audit_events (
        organization_id, project_id, action, target_type, target_id, payload
    )
    SELECT organization_id, project_id, 'agent_instance.staffed', 'agent_instance', id,
           jsonb_build_object('agent_definition_id', agent_definition_id, 'source', 'standard')
    FROM staffed;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_standard_workforce
    AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION staff_new_engagement();

-- A standard worker that is added or re-enabled joins every open engagement.
CREATE FUNCTION staff_standard_agent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.source <> 'standard' OR NEW.status::text <> 'ACTIVE' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status::text = 'ACTIVE' AND OLD.source = 'standard' THEN
        RETURN NEW;
    END IF;
    WITH staffed AS (
        INSERT INTO public.agent_instances (
            organization_id, project_id, agent_definition_id, definition_revision
        )
        SELECT p.organization_id, p.id, NEW.id, NEW.revision
        FROM public.projects AS p
        WHERE p.organization_id = NEW.organization_id AND p.status::text <> 'ARCHIVED'
        ORDER BY p.id
        ON CONFLICT (project_id, agent_definition_id) DO NOTHING
        RETURNING id, organization_id, project_id
    )
    INSERT INTO public.audit_events (
        organization_id, project_id, action, target_type, target_id, payload
    )
    SELECT organization_id, project_id, 'agent_instance.staffed', 'agent_instance', id,
           jsonb_build_object('agent_definition_id', NEW.id, 'source', 'standard')
    FROM staffed;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agent_definitions_standard_staffing
    AFTER INSERT OR UPDATE OF status, source ON agent_definitions
    FOR EACH ROW EXECUTE FUNCTION staff_standard_agent();
