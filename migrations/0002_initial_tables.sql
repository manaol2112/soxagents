CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE organization_status AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE membership_role AS ENUM (
    'OWNER',
    'ADMIN',
    'PROJECT_MANAGER',
    'REVIEWER',
    'CONTRIBUTOR'
);
CREATE TYPE membership_status AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE project_status AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE agent_definition_status AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE agent_instance_status AS ENUM (
    'PENDING',
    'RUNNING',
    'WAITING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);
CREATE TYPE task_status AS ENUM (
    'DRAFT',
    'READY',
    'QUEUED',
    'RUNNING',
    'WAITING',
    'BLOCKED',
    'REVIEW',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);
CREATE TYPE task_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE workflow_run_status AS ENUM (
    'RUNNING',
    'PAUSED',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);

CREATE FUNCTION assert_active_org_member(p_organization_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.memberships
        WHERE organization_id = p_organization_id
          AND user_id = p_user_id
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'user is not an active member of the organization';
    END IF;
END;
$$;

CREATE FUNCTION enforce_project_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM public.assert_active_org_member(NEW.organization_id, NEW.owner_user_id);
    RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_project_member_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM public.assert_active_org_member(NEW.organization_id, NEW.user_id);
    RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_task_assignee_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.assignee_user_id IS NOT NULL THEN
        PERFORM public.assert_active_org_member(NEW.organization_id, NEW.assignee_user_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_task_dependency_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF EXISTS (
        WITH RECURSIVE walk AS (
            SELECT NEW.depends_on_task_id AS task_id
            UNION ALL
            SELECT dependency.depends_on_task_id
            FROM public.task_dependencies AS dependency
            JOIN walk ON dependency.task_id = walk.task_id
        )
        SELECT 1
        FROM walk
        WHERE task_id = NEW.task_id
    ) THEN
        RAISE EXCEPTION 'task dependency cycle';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'audit_events are immutable';
END;
$$;

CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    name text NOT NULL,
    slug text NOT NULL,
    status organization_status NOT NULL DEFAULT 'ACTIVE',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organizations_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT organizations_slug_key UNIQUE (slug),
    CONSTRAINT organizations_version_positive CHECK (version >= 1)
);

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    email citext NOT NULL,
    display_name text NOT NULL,
    oidc_subject text,
    status user_status NOT NULL DEFAULT 'ACTIVE',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_oidc_subject_key UNIQUE (oidc_subject),
    CONSTRAINT users_display_name_not_blank CHECK (length(btrim(display_name)) > 0),
    CONSTRAINT users_email_has_at CHECK (position('@' IN email::text) > 1),
    CONSTRAINT users_version_positive CHECK (version >= 1)
);

CREATE TABLE memberships (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role membership_role NOT NULL,
    status membership_status NOT NULL DEFAULT 'ACTIVE',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT memberships_organization_user_key UNIQUE (organization_id, user_id),
    CONSTRAINT memberships_version_positive CHECK (version >= 1),
    CONSTRAINT memberships_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT memberships_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    scope text NOT NULL DEFAULT '',
    owner_user_id uuid NOT NULL,
    status project_status NOT NULL DEFAULT 'DRAFT',
    starts_on date,
    ends_on date,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT projects_id_organization_key UNIQUE (id, organization_id),
    CONSTRAINT projects_organization_slug_key UNIQUE (organization_id, slug),
    CONSTRAINT projects_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT projects_dates_ordered CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
    CONSTRAINT projects_version_positive CHECK (version >= 1),
    CONSTRAINT projects_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT projects_owner_fk
        FOREIGN KEY (owner_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE project_memberships (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT project_memberships_project_user_key UNIQUE (project_id, user_id),
    CONSTRAINT project_memberships_version_positive CHECK (version >= 1),
    CONSTRAINT project_memberships_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT project_memberships_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE agent_definitions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    agent_key text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    description text NOT NULL DEFAULT '',
    revision integer NOT NULL DEFAULT 1,
    input_schema jsonb NOT NULL,
    output_schema jsonb NOT NULL,
    allowed_tool_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    model_config_ref text NOT NULL,
    max_iterations integer NOT NULL,
    time_budget_seconds integer NOT NULL,
    status agent_definition_status NOT NULL DEFAULT 'ACTIVE',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT agent_definitions_id_organization_key UNIQUE (id, organization_id),
    CONSTRAINT agent_definitions_organization_key_key UNIQUE (organization_id, agent_key),
    CONSTRAINT agent_definitions_key_format CHECK (agent_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT agent_definitions_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT agent_definitions_role_not_blank CHECK (length(btrim(role)) > 0),
    CONSTRAINT agent_definitions_revision_positive CHECK (revision >= 1),
    CONSTRAINT agent_definitions_input_schema_object CHECK (jsonb_typeof(input_schema) = 'object'),
    CONSTRAINT agent_definitions_output_schema_object CHECK (jsonb_typeof(output_schema) = 'object'),
    CONSTRAINT agent_definitions_model_ref_not_blank CHECK (length(btrim(model_config_ref)) > 0),
    CONSTRAINT agent_definitions_iterations_positive CHECK (max_iterations > 0),
    CONSTRAINT agent_definitions_time_budget_positive CHECK (time_budget_seconds > 0),
    CONSTRAINT agent_definitions_version_positive CHECK (version >= 1),
    CONSTRAINT agent_definitions_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE agent_instances (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    agent_definition_id uuid NOT NULL,
    definition_revision integer NOT NULL,
    status agent_instance_status NOT NULL DEFAULT 'PENDING',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT agent_instances_id_project_key UNIQUE (id, project_id, organization_id),
    CONSTRAINT agent_instances_revision_positive CHECK (definition_revision >= 1),
    CONSTRAINT agent_instances_version_positive CHECK (version >= 1),
    CONSTRAINT agent_instances_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT agent_instances_definition_fk
        FOREIGN KEY (agent_definition_id, organization_id)
        REFERENCES agent_definitions (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    status task_status NOT NULL DEFAULT 'DRAFT',
    priority task_priority NOT NULL DEFAULT 'NORMAL',
    deadline timestamptz,
    assignee_user_id uuid,
    agent_instance_id uuid,
    retry_count integer NOT NULL DEFAULT 0,
    max_retries integer NOT NULL DEFAULT 0,
    blocker text,
    escalation text,
    cancelled_at timestamptz,
    cancellation_reason text,
    artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT tasks_id_project_key UNIQUE (id, project_id, organization_id),
    CONSTRAINT tasks_title_not_blank CHECK (length(btrim(title)) > 0),
    CONSTRAINT tasks_retry_count_nonnegative CHECK (retry_count >= 0),
    CONSTRAINT tasks_max_retries_nonnegative CHECK (max_retries >= 0),
    CONSTRAINT tasks_cancelled_has_timestamp CHECK (
        status <> 'CANCELLED' OR cancelled_at IS NOT NULL
    ),
    CONSTRAINT tasks_artifact_refs_array CHECK (jsonb_typeof(artifact_refs) = 'array'),
    CONSTRAINT tasks_version_positive CHECK (version >= 1),
    CONSTRAINT tasks_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tasks_assignee_fk
        FOREIGN KEY (assignee_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tasks_agent_instance_fk
        FOREIGN KEY (agent_instance_id, project_id, organization_id)
        REFERENCES agent_instances (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE task_dependencies (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    depends_on_task_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT task_dependencies_edge_key UNIQUE (task_id, depends_on_task_id),
    CONSTRAINT task_dependencies_not_self CHECK (task_id <> depends_on_task_id),
    CONSTRAINT task_dependencies_task_fk
        FOREIGN KEY (task_id, project_id, organization_id)
        REFERENCES tasks (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT task_dependencies_depends_on_fk
        FOREIGN KEY (depends_on_task_id, project_id, organization_id)
        REFERENCES tasks (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE workflow_runs (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid,
    workflow_key text NOT NULL,
    status workflow_run_status NOT NULL DEFAULT 'RUNNING',
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT workflow_runs_project_key_key UNIQUE (project_id, workflow_key),
    CONSTRAINT workflow_runs_key_not_blank CHECK (length(btrim(workflow_key)) > 0),
    CONSTRAINT workflow_runs_version_positive CHECK (version >= 1),
    CONSTRAINT workflow_runs_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workflow_runs_task_fk
        FOREIGN KEY (task_id, project_id, organization_id)
        REFERENCES tasks (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid,
    actor_user_id uuid,
    actor_agent_instance_id uuid,
    action text NOT NULL,
    target_type text,
    target_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT audit_events_action_not_blank CHECK (length(btrim(action)) > 0),
    CONSTRAINT audit_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT audit_events_agent_requires_project CHECK (
        actor_agent_instance_id IS NULL OR project_id IS NOT NULL
    ),
    CONSTRAINT audit_events_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT audit_events_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT audit_events_actor_user_fk
        FOREIGN KEY (actor_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT audit_events_actor_agent_fk
        FOREIGN KEY (actor_agent_instance_id, project_id, organization_id)
        REFERENCES agent_instances (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER memberships_set_updated_at
BEFORE UPDATE ON memberships
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER projects_set_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER projects_owner_membership
BEFORE INSERT OR UPDATE OF organization_id, owner_user_id ON projects
FOR EACH ROW EXECUTE FUNCTION enforce_project_owner_membership();

CREATE TRIGGER project_memberships_set_updated_at
BEFORE UPDATE ON project_memberships
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER project_memberships_org_member
BEFORE INSERT OR UPDATE OF organization_id, user_id ON project_memberships
FOR EACH ROW EXECUTE FUNCTION enforce_project_member_membership();

CREATE TRIGGER agent_definitions_set_updated_at
BEFORE UPDATE ON agent_definitions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER agent_instances_set_updated_at
BEFORE UPDATE ON agent_instances
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tasks_set_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tasks_assignee_membership
BEFORE INSERT OR UPDATE OF organization_id, assignee_user_id ON tasks
FOR EACH ROW EXECUTE FUNCTION enforce_task_assignee_membership();

CREATE TRIGGER task_dependencies_no_cycle
BEFORE INSERT OR UPDATE OF task_id, depends_on_task_id ON task_dependencies
FOR EACH ROW EXECUTE FUNCTION prevent_task_dependency_cycle();

CREATE TRIGGER workflow_runs_set_updated_at
BEFORE UPDATE ON workflow_runs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();

CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE INDEX projects_organization_status_idx ON projects (organization_id, status);
CREATE INDEX project_memberships_user_idx ON project_memberships (user_id);
CREATE INDEX agent_definitions_organization_status_idx
    ON agent_definitions (organization_id, status);
CREATE INDEX agent_instances_project_status_idx ON agent_instances (project_id, status);
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_user_id);
CREATE INDEX tasks_open_deadline_idx ON tasks (deadline)
    WHERE deadline IS NOT NULL
      AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE INDEX task_dependencies_depends_on_idx ON task_dependencies (depends_on_task_id);
CREATE INDEX workflow_runs_project_status_idx ON workflow_runs (project_id, status);
CREATE INDEX audit_events_organization_time_idx ON audit_events (organization_id, occurred_at DESC);
CREATE INDEX audit_events_project_time_idx ON audit_events (project_id, occurred_at DESC);
