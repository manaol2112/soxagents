-- In-scope systems found in an uploaded RCM. After an upload, an agent reads the
-- systems column and the control text and proposes the systems the RCM covers, each
-- with the controls it belongs to. A person confirms them in the import preview, and
-- importing creates them as the engagement's in-scope applications.

ALTER TABLE rcm_imports
    ADD COLUMN systems jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN systems_status text NOT NULL DEFAULT 'PENDING',
    ADD COLUMN systems_source text,
    ADD COLUMN systems_note text NOT NULL DEFAULT '',
    ADD COLUMN systems_basis text NOT NULL DEFAULT '',
    ADD COLUMN systems_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN systems_lease_until timestamptz,
    ADD COLUMN systems_model_call_id uuid,
    ADD COLUMN systems_version integer NOT NULL DEFAULT 1,
    ADD CONSTRAINT rcm_imports_systems CHECK (
        jsonb_typeof(systems) = 'array' AND jsonb_array_length(systems) <= 100
    ),
    ADD CONSTRAINT rcm_imports_systems_status CHECK (
        systems_status IN ('PENDING', 'SCANNING', 'READY', 'FAILED')
    ),
    ADD CONSTRAINT rcm_imports_systems_source CHECK (
        systems_source IS NULL OR systems_source IN ('MODEL', 'RULES')
    ),
    ADD CONSTRAINT rcm_imports_systems_ready CHECK (
        (systems_status = 'READY') = (systems_source IS NOT NULL)
    ),
    ADD CONSTRAINT rcm_imports_systems_note CHECK (char_length(systems_note) <= 200),
    ADD CONSTRAINT rcm_imports_systems_attempts CHECK (systems_attempts BETWEEN 0 AND 20),
    ADD CONSTRAINT rcm_imports_systems_version CHECK (systems_version >= 1),
    ADD CONSTRAINT rcm_imports_systems_call_fk
        FOREIGN KEY (systems_model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX rcm_imports_systems_open_idx ON rcm_imports (systems_status, systems_lease_until)
    WHERE status = 'MAPPING' AND systems_status IN ('PENDING', 'SCANNING');

-- An in-scope application can say which layer it is.
ALTER TABLE engagement_applications
    ADD COLUMN layer text NOT NULL DEFAULT 'APPLICATION',
    ADD CONSTRAINT engagement_applications_layer CHECK (
        layer IN ('APPLICATION', 'DATABASE', 'OPERATING_SYSTEM', 'INFRASTRUCTURE', 'TOOL')
    );
