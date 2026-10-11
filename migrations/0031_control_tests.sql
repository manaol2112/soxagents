-- Test plans and sample selection (Milestone 8.1).
--
-- A control's test plan records its population (a stored evidence file, by hash), the
-- checks on that population, and a reproducible random selection: the method, the seed,
-- and the frame it was drawn from. The tester proposes. A person may replace an item
-- with a reason, and approves the selection. Approval drafts the sample evidence request,
-- which goes out only after the usual approval.

CREATE TABLE control_tests (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'PROPOSED',
    sample_size integer NOT NULL,
    population_file_id uuid NOT NULL,
    population_sha256 text NOT NULL,
    population_rows integer NOT NULL,
    frame_rows integer NOT NULL,
    key_column text NOT NULL DEFAULT '',
    date_column text NOT NULL DEFAULT '',
    columns jsonb NOT NULL DEFAULT '[]'::jsonb,
    checks jsonb NOT NULL DEFAULT '[]'::jsonb,
    method text NOT NULL DEFAULT 'RANDOM',
    seed text NOT NULL,
    explanation text NOT NULL,
    proposed_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamptz,
    sample_request_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT control_tests_status CHECK (status IN ('PROPOSED', 'APPROVED')),
    CONSTRAINT control_tests_counts CHECK (
        sample_size BETWEEN 1 AND 200 AND population_rows >= 0
        AND frame_rows BETWEEN 0 AND population_rows
    ),
    CONSTRAINT control_tests_sha256 CHECK (population_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT control_tests_method CHECK (method = 'RANDOM'),
    CONSTRAINT control_tests_seed CHECK (seed ~ '^[0-9]{1,20}$'),
    CONSTRAINT control_tests_lists CHECK (
        jsonb_typeof(columns) = 'array' AND jsonb_typeof(checks) = 'array'
    ),
    CONSTRAINT control_tests_text CHECK (
        char_length(explanation) BETWEEN 1 AND 2000
        AND char_length(key_column) <= 200 AND char_length(date_column) <= 200
    ),
    CONSTRAINT control_tests_approved CHECK (
        (status = 'APPROVED') = (approved_by IS NOT NULL AND approved_at IS NOT NULL)
    ),
    CONSTRAINT control_tests_version CHECK (version >= 1),
    -- One interim test plan per control. Roll-forward testing comes in Milestone 8.4.
    CONSTRAINT control_tests_one_per_control UNIQUE (project_id, engagement_control_id),
    CONSTRAINT control_tests_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_tests_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_tests_population_fk
        FOREIGN KEY (population_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_tests_proposer_fk
        FOREIGN KEY (proposed_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_tests_approver_fk
        FOREIGN KEY (approved_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_tests_request_fk
        FOREIGN KEY (sample_request_id) REFERENCES pbc_requests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX control_tests_project_idx ON control_tests (project_id);

CREATE TABLE control_test_samples (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    control_test_id uuid NOT NULL,
    position integer NOT NULL,
    -- The data row in the population, counted from 1 after the header.
    row_number integer NOT NULL,
    key_value text NOT NULL DEFAULT '',
    row_values jsonb NOT NULL,
    selection text NOT NULL DEFAULT 'RANDOM',
    reason text NOT NULL DEFAULT '',
    replaced_by uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_test_samples_position CHECK (position BETWEEN 1 AND 200),
    CONSTRAINT control_test_samples_row CHECK (row_number >= 1),
    CONSTRAINT control_test_samples_values CHECK (jsonb_typeof(row_values) = 'array'),
    CONSTRAINT control_test_samples_selection CHECK (
        selection IN ('RANDOM', 'HAPHAZARD', 'TARGETED')
    ),
    -- A person's pick always carries their reason.
    CONSTRAINT control_test_samples_reason CHECK (
        char_length(reason) <= 500
        AND (selection = 'RANDOM' OR (char_length(btrim(reason)) >= 3 AND replaced_by IS NOT NULL))
    ),
    CONSTRAINT control_test_samples_position_key UNIQUE (control_test_id, position),
    CONSTRAINT control_test_samples_row_key UNIQUE (control_test_id, row_number),
    CONSTRAINT control_test_samples_test_fk
        FOREIGN KEY (control_test_id) REFERENCES control_tests (id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT control_test_samples_person_fk
        FOREIGN KEY (replaced_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);
