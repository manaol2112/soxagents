-- Client RCM uploads. A team uploads the client's own risk and control matrix,
-- maps its columns to the fields the platform needs, maps the client's terms for
-- area, frequency, and nature to standard values, and imports it as the RCM.
-- Only parsed cell values are kept. The uploaded file is never stored or executed.

CREATE TABLE rcm_imports (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'MAPPING',
    file_name text NOT NULL,
    file_kind text NOT NULL,
    file_sha256 text NOT NULL,
    size_bytes integer NOT NULL,
    sheets jsonb NOT NULL,
    sheet_index integer NOT NULL DEFAULT 0,
    header_row integer NOT NULL DEFAULT 1,
    header_names jsonb NOT NULL DEFAULT '[]'::jsonb,
    column_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    value_maps jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    imported_by_user_id uuid,
    imported_at timestamptz,
    imported_controls integer NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT rcm_imports_status CHECK (status IN ('MAPPING', 'IMPORTED', 'DISCARDED')),
    CONSTRAINT rcm_imports_kind CHECK (file_kind IN ('CSV', 'XLSX')),
    CONSTRAINT rcm_imports_name CHECK (char_length(file_name) BETWEEN 1 AND 200),
    CONSTRAINT rcm_imports_hash CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT rcm_imports_size CHECK (size_bytes BETWEEN 1 AND 5000000),
    CONSTRAINT rcm_imports_shapes CHECK (
        jsonb_typeof(sheets) = 'array'
        AND jsonb_typeof(header_names) = 'array'
        AND jsonb_typeof(column_fields) = 'array'
        AND jsonb_typeof(value_maps) = 'object'
    ),
    CONSTRAINT rcm_imports_layout CHECK (sheet_index >= 0 AND header_row >= 1),
    CONSTRAINT rcm_imports_imported CHECK (
        (status = 'IMPORTED') = (imported_by_user_id IS NOT NULL AND imported_at IS NOT NULL)
    ),
    CONSTRAINT rcm_imports_version CHECK (version >= 1),
    CONSTRAINT rcm_imports_scope_key UNIQUE (project_id, id),
    CONSTRAINT rcm_imports_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT rcm_imports_creator_fk
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT rcm_imports_importer_fk
        FOREIGN KEY (imported_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One upload is being mapped at a time per engagement.
CREATE UNIQUE INDEX rcm_imports_one_open ON rcm_imports (project_id) WHERE status = 'MAPPING';
CREATE INDEX rcm_imports_org_idx ON rcm_imports (organization_id, imported_at DESC)
    WHERE status = 'IMPORTED';

-- An engagement control keeps the client's own terms next to the standard values
-- the platform uses for the tester, sample size, and templates.
ALTER TABLE engagement_controls
    ADD COLUMN source text NOT NULL DEFAULT 'LIBRARY',
    ADD COLUMN rcm_import_id uuid,
    ADD COLUMN source_row integer,
    ADD COLUMN domain_label text NOT NULL DEFAULT '',
    ADD COLUMN frequency_label text NOT NULL DEFAULT '',
    ADD COLUMN nature_label text NOT NULL DEFAULT '',
    ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT engagement_controls_source CHECK (source IN ('LIBRARY', 'UPLOAD')),
    ADD CONSTRAINT engagement_controls_upload CHECK (
        (source = 'UPLOAD') = (rcm_import_id IS NOT NULL AND source_row IS NOT NULL)
    ),
    ADD CONSTRAINT engagement_controls_labels CHECK (
        char_length(domain_label) <= 120
        AND char_length(frequency_label) <= 120
        AND char_length(nature_label) <= 120
    ),
    ADD CONSTRAINT engagement_controls_custom CHECK (
        jsonb_typeof(custom_fields) = 'array' AND jsonb_array_length(custom_fields) <= 80
    ),
    ADD CONSTRAINT engagement_controls_import_fk
        FOREIGN KEY (project_id, rcm_import_id) REFERENCES rcm_imports (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Client matrices use longer references and descriptions, and may have no risk text.
ALTER TABLE engagement_controls DROP CONSTRAINT engagement_controls_text;
ALTER TABLE engagement_controls ADD CONSTRAINT engagement_controls_text CHECK (
    char_length(control_ref) BETWEEN 1 AND 60
    AND char_length(title) BETWEEN 1 AND 200
    AND char_length(risk) <= 4000
    AND char_length(activity) BETWEEN 1 AND 4000
    AND char_length(owner_name) <= 200
    AND char_length(owner_email) <= 200
);
