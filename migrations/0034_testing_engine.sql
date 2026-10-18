-- The testing engine (Milestone 8.2).
--
-- Each in-scope control gets one test sheet. A sampled control's sheet has one item per
-- approved sample. A control tested once (an automated or configuration control) has a
-- single item. The control's tester links each evidence file to the items it supports,
-- then proposes a result for every test attribute of every item. A person can relink a
-- file or override any result with a reason, and signs the sheet off once for the
-- control. The conclusion is derived in code from the final results, with zero
-- tolerance: one exception means not effective. An exception becomes a proposed
-- deficiency, which a person logs or dismisses.

CREATE TABLE test_sheets (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    method text NOT NULL,
    control_test_id uuid,
    -- The control's test attributes when the sheet was made, by index.
    attributes jsonb NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    -- The background run: IDLE, or PENDING and WORKING while the tester works.
    run_status text NOT NULL DEFAULT 'PENDING',
    run_requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    run_started_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    requested_by uuid NOT NULL,
    conclusion text,
    signed_by uuid,
    signed_at timestamptz,
    signoff_note text NOT NULL DEFAULT '',
    -- The deficiency the tester proposes from the exceptions, for a person to decide.
    proposal jsonb,
    proposal_status text NOT NULL DEFAULT 'NONE',
    proposal_reason text NOT NULL DEFAULT '',
    proposal_decided_by uuid,
    deficiency_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT test_sheets_method CHECK (method IN ('SAMPLE', 'TEST_OF_ONE')),
    CONSTRAINT test_sheets_plan CHECK ((method = 'SAMPLE') = (control_test_id IS NOT NULL)),
    CONSTRAINT test_sheets_attributes CHECK (
        jsonb_typeof(attributes) = 'array' AND jsonb_array_length(attributes) BETWEEN 1 AND 12
    ),
    CONSTRAINT test_sheets_status CHECK (status IN ('OPEN', 'SIGNED_OFF')),
    CONSTRAINT test_sheets_run CHECK (run_status IN ('IDLE', 'PENDING', 'WORKING')),
    CONSTRAINT test_sheets_attempts CHECK (attempts BETWEEN 0 AND 50),
    CONSTRAINT test_sheets_signed CHECK (
        (status = 'SIGNED_OFF')
        = (signed_by IS NOT NULL AND signed_at IS NOT NULL AND conclusion IS NOT NULL)
    ),
    CONSTRAINT test_sheets_conclusion CHECK (
        conclusion IS NULL OR conclusion IN ('EFFECTIVE', 'NOT_EFFECTIVE')
    ),
    CONSTRAINT test_sheets_proposal CHECK (
        (proposal_status = 'NONE' AND proposal IS NULL)
        OR (proposal_status IN ('PROPOSED', 'LOGGED', 'DISMISSED') AND proposal IS NOT NULL)
    ),
    CONSTRAINT test_sheets_proposal_status CHECK (
        proposal_status IN ('NONE', 'PROPOSED', 'LOGGED', 'DISMISSED')
    ),
    CONSTRAINT test_sheets_logged CHECK ((proposal_status = 'LOGGED') = (deficiency_id IS NOT NULL)),
    CONSTRAINT test_sheets_dismissed CHECK (
        proposal_status <> 'DISMISSED' OR char_length(btrim(proposal_reason)) >= 3
    ),
    CONSTRAINT test_sheets_decided CHECK (
        (proposal_status IN ('LOGGED', 'DISMISSED')) = (proposal_decided_by IS NOT NULL)
    ),
    CONSTRAINT test_sheets_text CHECK (
        char_length(signoff_note) <= 1000 AND char_length(proposal_reason) <= 500
    ),
    CONSTRAINT test_sheets_version CHECK (version >= 1),
    -- One interim test sheet per control. Roll-forward testing comes in Milestone 8.4.
    CONSTRAINT test_sheets_one_per_control UNIQUE (project_id, engagement_control_id),
    CONSTRAINT test_sheets_scope_key UNIQUE (project_id, id),
    CONSTRAINT test_sheets_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_sheets_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_sheets_plan_fk
        FOREIGN KEY (control_test_id) REFERENCES control_tests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_sheets_requester_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_sheets_signer_fk
        FOREIGN KEY (signed_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_sheets_decider_fk
        FOREIGN KEY (proposal_decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_sheets_deficiency_fk
        FOREIGN KEY (deficiency_id) REFERENCES deficiencies (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX test_sheets_run_idx ON test_sheets (run_status, lease_until)
    WHERE run_status IN ('PENDING', 'WORKING');

CREATE TRIGGER test_sheets_updated_at
    BEFORE UPDATE ON test_sheets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE test_items (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    test_sheet_id uuid NOT NULL,
    position integer NOT NULL,
    sample_id uuid,
    label text NOT NULL,
    -- The sample's row as [{column, value}], to show and to give the tester.
    detail jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Set when its evidence changed, so the tester tests it (again).
    needs_test boolean NOT NULL DEFAULT false,
    -- The tester's proposal: [{index, result, note}]. Overrides: [{index, result, reason,
    -- by, at}]. The final result of an attribute is its override, else its proposal.
    results jsonb NOT NULL DEFAULT '[]'::jsonb,
    overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
    source text,
    model_call_id uuid,
    tested_at timestamptz,
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT test_items_position CHECK (position BETWEEN 1 AND 200),
    CONSTRAINT test_items_label CHECK (char_length(label) BETWEEN 1 AND 200),
    CONSTRAINT test_items_lists CHECK (
        jsonb_typeof(detail) = 'array' AND jsonb_typeof(results) = 'array'
        AND jsonb_typeof(overrides) = 'array'
    ),
    CONSTRAINT test_items_source CHECK (source IS NULL OR source IN ('MODEL', 'REVIEW', 'RULES')),
    CONSTRAINT test_items_note CHECK (char_length(note) <= 500),
    CONSTRAINT test_items_version CHECK (version >= 1),
    CONSTRAINT test_items_position_key UNIQUE (test_sheet_id, position),
    CONSTRAINT test_items_sheet_fk
        FOREIGN KEY (test_sheet_id) REFERENCES test_sheets (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_items_sample_fk
        FOREIGN KEY (sample_id) REFERENCES control_test_samples (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER test_items_updated_at
    BEFORE UPDATE ON test_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Each evidence file of the control, as the tester placed it: PLACED on one or more
-- items, UNPLACED when it found no item, EXCLUDED when a person said it is not test
-- evidence. The population a sample was drawn from is never test evidence.
CREATE TABLE test_sheet_files (
    test_sheet_id uuid NOT NULL,
    evidence_file_id uuid NOT NULL,
    placement text NOT NULL,
    placed_by text NOT NULL,
    decided_by uuid,
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (test_sheet_id, evidence_file_id),
    CONSTRAINT test_sheet_files_placement CHECK (
        placement IN ('PLACED', 'UNPLACED', 'EXCLUDED')
    ),
    CONSTRAINT test_sheet_files_by CHECK (
        (placed_by = 'AGENT' AND decided_by IS NULL)
        OR (placed_by = 'PERSON' AND decided_by IS NOT NULL)
    ),
    CONSTRAINT test_sheet_files_reason CHECK (char_length(reason) <= 300),
    CONSTRAINT test_sheet_files_sheet_fk
        FOREIGN KEY (test_sheet_id) REFERENCES test_sheets (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_sheet_files_file_fk
        FOREIGN KEY (evidence_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_sheet_files_person_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER test_sheet_files_updated_at
    BEFORE UPDATE ON test_sheet_files
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE test_item_files (
    test_item_id uuid NOT NULL,
    evidence_file_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (test_item_id, evidence_file_id),
    CONSTRAINT test_item_files_item_fk
        FOREIGN KEY (test_item_id) REFERENCES test_items (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_item_files_file_fk
        FOREIGN KEY (evidence_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX test_item_files_file_idx ON test_item_files (evidence_file_id);

-- Samples approved before this milestone get their sheet now, one item per sample. The
-- tester places their evidence on its first run.
WITH opened AS (
    INSERT INTO test_sheets (
        organization_id, project_id, engagement_control_id, method, control_test_id,
        attributes, requested_by
    )
    SELECT t.organization_id, t.project_id, t.engagement_control_id, 'SAMPLE', t.id,
           CASE WHEN jsonb_array_length(c.test_attributes) = 0
                THEN '["The control operated as described"]'::jsonb
                ELSE (SELECT jsonb_agg(value ORDER BY ordinality)
                      FROM jsonb_array_elements(c.test_attributes) WITH ORDINALITY
                      WHERE ordinality <= 12)
           END,
           t.approved_by
    FROM control_tests t
    JOIN engagement_controls c ON c.id = t.engagement_control_id
    WHERE t.status = 'APPROVED'
    RETURNING id, control_test_id
)
INSERT INTO test_items (test_sheet_id, position, sample_id, label)
SELECT o.id, s.position, s.id,
       CASE WHEN btrim(s.key_value) = '' THEN 'Row ' || s.row_number
            ELSE left(s.key_value, 200) END
FROM opened o JOIN control_test_samples s ON s.control_test_id = o.control_test_id;
