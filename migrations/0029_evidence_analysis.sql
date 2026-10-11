-- Reading and classifying stored evidence (Milestone 7.3).
--
-- Each custody record gets one analysis: the text read from the file (directly, or by
-- OCR for screenshots and scanned pages), a suggested evidence kind, and how the file
-- covers what its request asked for. The suggestion never changes a request. A person
-- confirms the kind, and a person still marks the request received.
--
-- The custody record stays immutable. The analysis is derived data and can be redone.

CREATE TABLE organization_evidence_settings (
    organization_id uuid PRIMARY KEY,
    -- LOCAL: the OCR engine installed with the API (Tesseract). Images stay in the firm.
    -- MODEL: the model provider reads images. Opted into by an owner or admin.
    ocr_engine text NOT NULL DEFAULT 'LOCAL',
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT organization_evidence_settings_engine CHECK (ocr_engine IN ('LOCAL', 'MODEL')),
    CONSTRAINT organization_evidence_settings_version CHECK (version >= 1),
    CONSTRAINT organization_evidence_settings_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT organization_evidence_settings_actor_fk
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE evidence_analyses (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    evidence_file_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    -- The request the file was read against, from the matched or assigned reply.
    pbc_request_id uuid,
    extraction text,
    extraction_status text,
    ocr_engine text,
    extracted_text text NOT NULL DEFAULT '',
    text_truncated boolean NOT NULL DEFAULT false,
    content_redacted boolean NOT NULL DEFAULT false,
    page_count integer,
    row_count integer,
    columns jsonb NOT NULL DEFAULT '[]'::jsonb,
    classification jsonb,
    source text,
    model_call_id uuid,
    ocr_model_call_id uuid,
    note text NOT NULL DEFAULT '',
    confirmed_kind text,
    confirmed_note text NOT NULL DEFAULT '',
    confirmed_by uuid,
    confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT evidence_analyses_status CHECK (
        status IN ('PENDING', 'WORKING', 'READY', 'FAILED')
    ),
    CONSTRAINT evidence_analyses_attempts CHECK (attempts BETWEEN 0 AND 20),
    CONSTRAINT evidence_analyses_extraction CHECK (
        extraction IS NULL
        OR extraction IN ('TEXT', 'TABLE', 'DOCUMENT', 'PDF_TEXT', 'OCR', 'NONE')
    ),
    CONSTRAINT evidence_analyses_extraction_status CHECK (
        extraction_status IS NULL
        OR extraction_status IN ('EXTRACTED', 'PARTIAL', 'NEEDS_OCR', 'UNSUPPORTED', 'UNREADABLE')
    ),
    CONSTRAINT evidence_analyses_ocr_engine CHECK (
        ocr_engine IS NULL OR ocr_engine IN ('LOCAL', 'MODEL')
    ),
    CONSTRAINT evidence_analyses_text CHECK (char_length(extracted_text) <= 200000),
    CONSTRAINT evidence_analyses_counts CHECK (
        (page_count IS NULL OR page_count >= 0) AND (row_count IS NULL OR row_count >= 0)
    ),
    CONSTRAINT evidence_analyses_columns CHECK (jsonb_typeof(columns) = 'array'),
    CONSTRAINT evidence_analyses_classification CHECK (
        classification IS NULL OR jsonb_typeof(classification) = 'object'
    ),
    CONSTRAINT evidence_analyses_source CHECK (source IS NULL OR source IN ('MODEL', 'RULES')),
    CONSTRAINT evidence_analyses_ready CHECK (
        (status = 'READY')
        = (classification IS NOT NULL AND source IS NOT NULL AND extraction_status IS NOT NULL)
    ),
    CONSTRAINT evidence_analyses_note CHECK (
        char_length(note) <= 300 AND char_length(confirmed_note) <= 500
    ),
    CONSTRAINT evidence_analyses_confirmed_kind CHECK (
        confirmed_kind IS NULL OR confirmed_kind IN (
            'population', 'walkthrough', 'design', 'configuration', 'change_history',
            'report', 'policy', 'sample', 'other'
        )
    ),
    CONSTRAINT evidence_analyses_confirmation CHECK (
        (confirmed_kind IS NULL) = (confirmed_by IS NULL)
        AND (confirmed_by IS NULL) = (confirmed_at IS NULL)
        AND (confirmed_kind IS NULL OR status = 'READY')
    ),
    CONSTRAINT evidence_analyses_version CHECK (version >= 1),
    CONSTRAINT evidence_analyses_one_per_file UNIQUE (evidence_file_id),
    CONSTRAINT evidence_analyses_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_analyses_file_fk
        FOREIGN KEY (evidence_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_analyses_requester_fk
        FOREIGN KEY (requested_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_analyses_request_fk
        FOREIGN KEY (pbc_request_id) REFERENCES pbc_requests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_analyses_model_call_fk
        FOREIGN KEY (model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_analyses_ocr_call_fk
        FOREIGN KEY (ocr_model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_analyses_confirmer_fk
        FOREIGN KEY (confirmed_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_analyses_open_idx ON evidence_analyses (status, lease_until)
    WHERE status IN ('PENDING', 'WORKING');
CREATE INDEX evidence_analyses_project_idx ON evidence_analyses (project_id, created_at);

-- Files stored before this milestone are read once, by the person who stored them.
INSERT INTO evidence_analyses (organization_id, project_id, evidence_file_id, requested_by_user_id)
SELECT organization_id, project_id, id, stored_by FROM evidence_files;
