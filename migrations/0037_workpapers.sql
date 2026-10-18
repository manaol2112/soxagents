-- Workpapers (Milestone 8.3).
--
-- Each in-scope control has a design workpaper (walkthrough and test of design) and an
-- operating effectiveness workpaper, from the templates confirmed at onboarding. The
-- records fill what they can: the control, the population, the samples, the testing
-- matrix, and the exceptions. The agent drafts the narratives, citing evidence files, and
-- a person edits any section. Every change is a new version; versions are never changed.
-- The preparer signs the workpaper off; independent review comes in Phase 9.

CREATE TABLE workpapers (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    stage text NOT NULL,
    template_key text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    current_version integer NOT NULL DEFAULT 0,
    -- The agent's drafting run: IDLE, or PENDING and WORKING while it drafts.
    draft_status text NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    draft_note text NOT NULL DEFAULT '',
    requested_by uuid NOT NULL,
    prepared_by uuid,
    prepared_at timestamptz,
    prepared_version integer,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT workpapers_stage CHECK (stage IN ('DESIGN', 'EFFECTIVENESS')),
    CONSTRAINT workpapers_template CHECK (char_length(template_key) BETWEEN 1 AND 60),
    CONSTRAINT workpapers_status CHECK (status IN ('DRAFT', 'PREPARED')),
    CONSTRAINT workpapers_draft CHECK (draft_status IN ('IDLE', 'PENDING', 'WORKING')),
    CONSTRAINT workpapers_attempts CHECK (attempts BETWEEN 0 AND 50),
    CONSTRAINT workpapers_prepared CHECK (
        (status = 'PREPARED')
        = (prepared_by IS NOT NULL AND prepared_at IS NOT NULL AND prepared_version IS NOT NULL)
    ),
    CONSTRAINT workpapers_text CHECK (char_length(draft_note) <= 500),
    CONSTRAINT workpapers_versions CHECK (current_version >= 0 AND version >= 1),
    CONSTRAINT workpapers_one_per_stage UNIQUE (project_id, engagement_control_id, stage),
    CONSTRAINT workpapers_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpapers_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpapers_requester_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpapers_preparer_fk
        FOREIGN KEY (prepared_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX workpapers_draft_idx ON workpapers (draft_status, lease_until)
    WHERE draft_status IN ('PENDING', 'WORKING');

CREATE TRIGGER workpapers_updated_at
    BEFORE UPDATE ON workpapers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workpaper_versions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    workpaper_id uuid NOT NULL,
    number integer NOT NULL,
    -- The sections, as the workpaper renders and exports them.
    content jsonb NOT NULL,
    source text NOT NULL,
    created_by uuid,
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT workpaper_versions_number CHECK (number >= 1),
    CONSTRAINT workpaper_versions_content CHECK (jsonb_typeof(content) = 'object'),
    CONSTRAINT workpaper_versions_source CHECK (source IN ('AGENT', 'PERSON', 'RECORDS')),
    CONSTRAINT workpaper_versions_person CHECK (source <> 'PERSON' OR created_by IS NOT NULL),
    CONSTRAINT workpaper_versions_note CHECK (char_length(note) <= 500),
    CONSTRAINT workpaper_versions_key UNIQUE (workpaper_id, number),
    CONSTRAINT workpaper_versions_workpaper_fk
        FOREIGN KEY (workpaper_id) REFERENCES workpapers (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_versions_person_fk
        FOREIGN KEY (created_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION guard_workpaper_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'workpaper versions are immutable';
END;
$$;

CREATE TRIGGER workpaper_versions_guard
    BEFORE UPDATE OR DELETE ON workpaper_versions
    FOR EACH ROW
    EXECUTE FUNCTION guard_workpaper_version();
