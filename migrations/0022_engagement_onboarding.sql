-- Engagement onboarding: everything an engagement needs before the agents start.
-- Scope and period, in-scope applications, the engagement team, the RCM, workpaper
-- templates, the PBC plan, and the kickoff plan a person approves.

CREATE TABLE engagement_settings (
    project_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    period_end date,
    client_coordinator_name text NOT NULL DEFAULT '',
    client_coordinator_email text NOT NULL DEFAULT '',
    client_domains text[] NOT NULL DEFAULT ARRAY[]::text[],
    pbc_due_days integer NOT NULL DEFAULT 10,
    pbc_follow_up_days integer NOT NULL DEFAULT 3,
    pbc_max_follow_ups integer NOT NULL DEFAULT 2,
    templates_confirmed_at timestamptz,
    templates_confirmed_by uuid,
    kicked_off_at timestamptz,
    kicked_off_by uuid,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_settings_cadence CHECK (
        pbc_due_days BETWEEN 1 AND 90
        AND pbc_follow_up_days BETWEEN 1 AND 30
        AND pbc_max_follow_ups BETWEEN 0 AND 10
    ),
    CONSTRAINT engagement_settings_coordinator CHECK (
        char_length(client_coordinator_name) <= 200
        AND char_length(client_coordinator_email) <= 200
    ),
    CONSTRAINT engagement_settings_domains CHECK (cardinality(client_domains) <= 10),
    CONSTRAINT engagement_settings_confirmed CHECK (
        (templates_confirmed_at IS NULL) = (templates_confirmed_by IS NULL)
    ),
    CONSTRAINT engagement_settings_kickoff CHECK (
        (kicked_off_at IS NULL) = (kicked_off_by IS NULL)
    ),
    CONSTRAINT engagement_settings_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT engagement_settings_confirmed_fk
        FOREIGN KEY (templates_confirmed_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT engagement_settings_kickoff_fk
        FOREIGN KEY (kicked_off_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE engagement_applications (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_applications_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT engagement_applications_description CHECK (char_length(description) <= 500),
    CONSTRAINT engagement_applications_unique UNIQUE (project_id, name),
    CONSTRAINT engagement_applications_scope_key UNIQUE (project_id, id),
    CONSTRAINT engagement_applications_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- The engagement role is descriptive. Organization roles still decide permissions.
ALTER TABLE project_memberships
    ADD COLUMN engagement_role text NOT NULL DEFAULT 'PREPARER',
    ADD CONSTRAINT project_memberships_engagement_role CHECK (
        engagement_role IN ('LEAD', 'PREPARER', 'REVIEWER')
    );

CREATE TABLE engagement_controls (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    library_key text NOT NULL,
    library_version integer NOT NULL,
    control_ref text NOT NULL,
    domain text NOT NULL,
    title text NOT NULL,
    risk text NOT NULL,
    activity text NOT NULL,
    frequency text NOT NULL,
    nature text NOT NULL,
    key_control boolean NOT NULL DEFAULT true,
    included boolean NOT NULL DEFAULT true,
    owner_name text NOT NULL DEFAULT '',
    owner_email text NOT NULL DEFAULT '',
    application_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    test_attributes jsonb NOT NULL,
    pbc_items jsonb NOT NULL,
    design_template_key text NOT NULL,
    effectiveness_template_key text NOT NULL,
    agent_key text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_controls_domain CHECK (domain IN ('ACCESS', 'CHANGE', 'OPERATIONS')),
    CONSTRAINT engagement_controls_frequency CHECK (
        frequency IN (
            'ANNUAL', 'QUARTERLY', 'MONTHLY', 'WEEKLY', 'DAILY', 'RECURRING', 'EVENT_DRIVEN'
        )
    ),
    CONSTRAINT engagement_controls_nature CHECK (
        nature IN ('MANUAL', 'AUTOMATED', 'IT_DEPENDENT_MANUAL')
    ),
    CONSTRAINT engagement_controls_text CHECK (
        char_length(control_ref) BETWEEN 1 AND 40
        AND char_length(title) BETWEEN 1 AND 200
        AND char_length(risk) BETWEEN 1 AND 1000
        AND char_length(activity) BETWEEN 1 AND 2000
        AND char_length(owner_name) <= 200
        AND char_length(owner_email) <= 200
    ),
    CONSTRAINT engagement_controls_lists CHECK (
        jsonb_typeof(test_attributes) = 'array' AND jsonb_typeof(pbc_items) = 'array'
    ),
    CONSTRAINT engagement_controls_unique UNIQUE (project_id, library_key),
    CONSTRAINT engagement_controls_ref_unique UNIQUE (project_id, control_ref),
    CONSTRAINT engagement_controls_scope_key UNIQUE (project_id, id),
    CONSTRAINT engagement_controls_version CHECK (version >= 1),
    CONSTRAINT engagement_controls_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX engagement_controls_project_idx ON engagement_controls (project_id, control_ref);

CREATE TABLE engagement_plans (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'PROPOSED',
    items jsonb NOT NULL,
    fingerprint text NOT NULL,
    proposed_by_user_id uuid NOT NULL,
    decided_by_user_id uuid,
    decided_at timestamptz,
    decision_reason text NOT NULL DEFAULT '',
    created_tasks integer NOT NULL DEFAULT 0,
    created_requests integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT engagement_plans_status CHECK (
        status IN ('PROPOSED', 'APPROVED', 'SUPERSEDED')
    ),
    CONSTRAINT engagement_plans_items CHECK (jsonb_typeof(items) = 'array'),
    CONSTRAINT engagement_plans_fingerprint CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT engagement_plans_decided CHECK (
        (status = 'APPROVED') = (decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
    ),
    CONSTRAINT engagement_plans_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT engagement_plans_proposer_fk
        FOREIGN KEY (proposed_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT engagement_plans_decider_fk
        FOREIGN KEY (decided_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One approved plan per engagement: kickoff happens once.
CREATE UNIQUE INDEX engagement_plans_one_approved
    ON engagement_plans (project_id) WHERE status = 'APPROVED';

-- A PBC request drafted at kickoff points back to its control.
ALTER TABLE pbc_requests ADD COLUMN engagement_control_id uuid;
ALTER TABLE pbc_requests
    ADD CONSTRAINT pbc_requests_control_fk
    FOREIGN KEY (project_id, engagement_control_id)
    REFERENCES engagement_controls (project_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Every engagement has settings from the moment it exists.
INSERT INTO engagement_settings (project_id, organization_id)
SELECT id, organization_id FROM projects
ON CONFLICT DO NOTHING;

CREATE FUNCTION create_engagement_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    INSERT INTO public.engagement_settings (project_id, organization_id)
    VALUES (NEW.id, NEW.organization_id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_engagement_settings
    AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION create_engagement_settings();
