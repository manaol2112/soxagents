-- A business process the team names itself, when the standard cycles do not describe
-- the client's process: added like a system, with the controls the team writes for it.
-- Each is based on a standard cycle, which decides the tester, the sample size, and the
-- workpaper template of its controls.

CREATE TABLE engagement_processes (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    domain text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_processes_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT engagement_processes_domain CHECK (
        domain IN (
            'ENTITY', 'ORDER_TO_CASH', 'PROCURE_TO_PAY', 'RECORD_TO_REPORT', 'TREASURY',
            'HIRE_TO_RETIRE', 'INVENTORY', 'FIXED_ASSETS', 'TAX', 'OTHER_BUSINESS'
        )
    ),
    CONSTRAINT engagement_processes_unique UNIQUE (project_id, name),
    CONSTRAINT engagement_processes_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

ALTER TABLE engagement_controls
    ADD COLUMN process_id uuid REFERENCES engagement_processes (id);

CREATE INDEX engagement_controls_process_idx
    ON engagement_controls (process_id) WHERE process_id IS NOT NULL;
