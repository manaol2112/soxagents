-- The engagement's evidence command center: who wrote each request, and the request views
-- a person saves.

-- 1. Who drafted the request. Until now a request was the evidence coordinator's when it
-- named a control; a person's request can now name its control too, so this is recorded
-- rather than inferred. A person never approves their own request; the reviewer approves
-- the agent's. Existing rows keep what the old rule said.
ALTER TABLE pbc_requests
    ADD COLUMN drafted_by text NOT NULL DEFAULT 'PERSON',
    ADD CONSTRAINT pbc_requests_drafted_by CHECK (drafted_by IN ('AGENT', 'PERSON'));

UPDATE pbc_requests SET drafted_by = 'AGENT' WHERE engagement_control_id IS NOT NULL;

-- 2. A person's saved request views on one engagement: a name and the filters it applies.
CREATE TABLE evidence_saved_views (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users (id),
    name text NOT NULL,
    filters jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_saved_views_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    CONSTRAINT evidence_saved_views_filters CHECK (
        jsonb_typeof(filters) = 'object' AND octet_length(filters::text) <= 4000
    ),
    CONSTRAINT evidence_saved_views_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX evidence_saved_views_name_unique
    ON evidence_saved_views (project_id, user_id, lower(name));
