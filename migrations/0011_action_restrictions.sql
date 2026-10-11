-- An action restriction denies one registered action for an organization or one project.

CREATE TABLE action_restrictions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid,
    action_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT action_restrictions_action_id_format CHECK (action_id ~ '^[a-z]+(?:[.][a-z]+)*$'),
    CONSTRAINT action_restrictions_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT action_restrictions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX action_restrictions_organization_key
    ON action_restrictions (organization_id, action_id)
    WHERE project_id IS NULL;

CREATE UNIQUE INDEX action_restrictions_project_key
    ON action_restrictions (organization_id, project_id, action_id)
    WHERE project_id IS NOT NULL;

CREATE INDEX action_restrictions_project_idx
    ON action_restrictions (project_id)
    WHERE project_id IS NOT NULL;
