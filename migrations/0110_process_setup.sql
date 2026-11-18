-- Adding a business process in one step (the Systems & Processes workflow, SP3, decided by
-- the product owner on 24 October 2026): its description, its owner, and its control areas,
-- the agent's suggestion kept apart from the areas a person approved. The systems it runs
-- on are linked in engagement_process_systems (0109). None of these puts a control in scope.

ALTER TABLE engagement_processes
    ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN owner text NOT NULL DEFAULT '',
    ADD COLUMN control_areas text[],
    ADD COLUMN control_areas_suggested jsonb,
    ADD COLUMN control_areas_decided_by uuid REFERENCES users (id),
    ADD COLUMN control_areas_decided_at timestamptz,
    ADD CONSTRAINT engagement_processes_description CHECK (char_length(description) <= 500),
    ADD CONSTRAINT engagement_processes_owner CHECK (char_length(owner) <= 200),
    ADD CONSTRAINT engagement_processes_control_areas CHECK (
        control_areas IS NULL
        OR control_areas <@ ARRAY['ITGC', 'ITAC', 'IPE', 'BUSINESS']::text[]
    ),
    ADD CONSTRAINT engagement_processes_control_areas_decided CHECK (
        (control_areas IS NULL) = (control_areas_decided_at IS NULL)
    );
