-- Adding a system in one step (the Systems & Processes workflow, SP2, decided by the
-- product owner on 24 October 2026): its environment, the systems it integrates with, the
-- business processes it supports, and its control areas. The agent's suggested areas are
-- kept apart from the areas a person approved, with who approved them and when. None of
-- these puts a control in scope.

ALTER TABLE engagement_applications
    ADD COLUMN environment text,
    -- The control areas a person approved for the system; NULL until one decides.
    ADD COLUMN control_areas text[],
    -- The agent's suggestion as it was shown: {source, library_version, areas: [...]}.
    ADD COLUMN control_areas_suggested jsonb,
    ADD COLUMN control_areas_decided_by uuid REFERENCES users (id),
    ADD COLUMN control_areas_decided_at timestamptz,
    ADD CONSTRAINT engagement_applications_environment CHECK (
        environment IS NULL OR environment IN ('PRODUCTION', 'NON_PRODUCTION', 'BOTH')
    ),
    ADD CONSTRAINT engagement_applications_control_areas CHECK (
        control_areas IS NULL
        OR control_areas <@ ARRAY['ITGC', 'ITAC', 'IPE', 'BUSINESS']::text[]
    ),
    ADD CONSTRAINT engagement_applications_control_areas_decided CHECK (
        (control_areas IS NULL) = (control_areas_decided_at IS NULL)
    );

-- A system's integrations: another system of the same engagement it exchanges data with.
-- Stored once per pair, from the system that named it.
CREATE TABLE engagement_system_integrations (
    project_id uuid NOT NULL REFERENCES projects (id),
    application_id uuid NOT NULL REFERENCES engagement_applications (id) ON DELETE CASCADE,
    related_application_id uuid NOT NULL
        REFERENCES engagement_applications (id) ON DELETE CASCADE,
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (application_id, related_application_id),
    CONSTRAINT engagement_system_integrations_other CHECK (
        application_id <> related_application_id
    )
);

CREATE INDEX engagement_system_integrations_related_idx
    ON engagement_system_integrations (related_application_id);

-- The systems a business process runs on; at most one is its primary system. A process
-- and a system are each created on their own: the link is optional on both sides.
CREATE TABLE engagement_process_systems (
    project_id uuid NOT NULL REFERENCES projects (id),
    process_id uuid NOT NULL REFERENCES engagement_processes (id) ON DELETE CASCADE,
    application_id uuid NOT NULL REFERENCES engagement_applications (id) ON DELETE CASCADE,
    is_primary boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (process_id, application_id)
);

CREATE UNIQUE INDEX engagement_process_systems_primary
    ON engagement_process_systems (process_id) WHERE is_primary;

CREATE INDEX engagement_process_systems_application_idx
    ON engagement_process_systems (application_id);
