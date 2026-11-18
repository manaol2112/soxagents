-- Test basis and standard matching (standard library, milestone L2). A person decides,
-- per control, what its test plan is built from: the matched standard (STANDARD), the
-- standard as a starting point the firm tailors (CUSTOM), or the client's own documented
-- procedures (CLIENT). Decided by the product owner. Null is the default by the control's
-- source: a library copy follows its standard, a client's control follows the client's
-- procedures until a person decides; nothing is forced. A control's candidate standards,
-- found when a person asks, are kept with their status, rationale, and what applies.
--
-- Rollback: drop the tables library_matches and library_match_runs; drop the columns
-- test_basis, test_basis_by, test_basis_at, test_basis_note from engagement_controls;
-- delete the '0084_test_basis' row from schema_migrations.

ALTER TABLE engagement_controls
    ADD COLUMN test_basis text,
    ADD COLUMN test_basis_by uuid REFERENCES users (id),
    ADD COLUMN test_basis_at timestamptz,
    ADD COLUMN test_basis_note text NOT NULL DEFAULT '',
    ADD CONSTRAINT engagement_controls_test_basis CHECK (
        test_basis IS NULL OR test_basis IN ('STANDARD', 'CLIENT', 'CUSTOM')
    ),
    ADD CONSTRAINT engagement_controls_test_basis_note CHECK (
        char_length(test_basis_note) <= 1000
    ),
    ADD CONSTRAINT engagement_controls_test_basis_decided CHECK (
        (test_basis IS NULL) = (test_basis_by IS NULL AND test_basis_at IS NULL)
    );

CREATE TABLE library_match_runs (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    -- RULES when the fixed rules decided; MODEL when the model's adjudication passed its
    -- checks.
    decided_by text NOT NULL,
    note text NOT NULL DEFAULT '',
    no_match boolean NOT NULL DEFAULT false,
    model_call_id uuid,
    requested_by uuid NOT NULL REFERENCES users (id),
    computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT library_match_runs_by CHECK (decided_by IN ('RULES', 'MODEL')),
    CONSTRAINT library_match_runs_note CHECK (char_length(note) <= 1000),
    CONSTRAINT library_match_runs_one UNIQUE (engagement_control_id),
    CONSTRAINT library_match_runs_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT library_match_runs_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE library_matches (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    run_id uuid NOT NULL REFERENCES library_match_runs (id) ON DELETE CASCADE,
    engagement_control_id uuid NOT NULL,
    library_key text NOT NULL,
    rank integer NOT NULL,
    status text NOT NULL,
    score numeric(6, 3) NOT NULL,
    rationale text NOT NULL DEFAULT '',
    -- Attribute keys of the standard that apply to the control, and those excluded with
    -- the reason; what the control does not state and a person must record.
    applicable jsonb NOT NULL DEFAULT '[]'::jsonb,
    excluded jsonb NOT NULL DEFAULT '[]'::jsonb,
    missing jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT library_matches_key CHECK (library_key ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
    CONSTRAINT library_matches_rank CHECK (rank BETWEEN 1 AND 10),
    CONSTRAINT library_matches_status CHECK (status IN ('STRONG', 'PARTIAL', 'NONE')),
    CONSTRAINT library_matches_rationale CHECK (char_length(rationale) <= 1500),
    CONSTRAINT library_matches_lists CHECK (
        jsonb_typeof(applicable) = 'array' AND jsonb_typeof(excluded) = 'array'
        AND jsonb_typeof(missing) = 'array'
    ),
    CONSTRAINT library_matches_one UNIQUE (engagement_control_id, library_key)
);

CREATE INDEX library_matches_control_idx ON library_matches (engagement_control_id, rank);
