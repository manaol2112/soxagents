-- Workpaper templates a firm keeps for an engagement: a Word or Excel workpaper it
-- uploaded, read for its structure, or a standard template it customised in the editor.
-- A template is a workbook: tabs (design, interim, roll-forward) with sections. Controls
-- refer to it by key in their template column. An uploaded file is kept as it was.

CREATE TABLE workpaper_templates (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL REFERENCES projects (id),
    key text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    tabs jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The standard template a customised one started from; empty for an upload.
    base_key text NOT NULL DEFAULT '',
    file_name text NOT NULL DEFAULT '',
    file_kind text NOT NULL DEFAULT 'NONE',
    file_sha256 text NOT NULL DEFAULT '',
    content bytea,
    uploaded_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT workpaper_templates_key UNIQUE (project_id, key),
    CONSTRAINT workpaper_templates_key_shape CHECK (key ~ '^firm-[a-z][0-9a-f]{11}$'),
    CONSTRAINT workpaper_templates_kind CHECK (kind IN ('ITGC', 'ITAC', 'BUSINESS', 'KEY_REPORT')),
    CONSTRAINT workpaper_templates_file_kind CHECK (file_kind IN ('NONE', 'DOCX', 'XLSX')),
    CONSTRAINT workpaper_templates_file CHECK (
        (file_kind = 'NONE') = (content IS NULL)
        AND (file_kind = 'NONE') = (file_name = '')
    ),
    CONSTRAINT workpaper_templates_tabs CHECK (jsonb_typeof(tabs) = 'array'),
    CONSTRAINT workpaper_templates_title CHECK (char_length(title) BETWEEN 1 AND 200),
    CONSTRAINT workpaper_templates_size CHECK (
        content IS NULL OR octet_length(content) BETWEEN 1 AND 5000000
    )
);

CREATE INDEX workpaper_templates_project_idx ON workpaper_templates (project_id, kind);
