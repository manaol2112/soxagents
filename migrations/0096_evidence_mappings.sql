-- Milestone 3b: evidence-to-attribute mapping.
--
-- For a control whose evidence plan is approved, a run maps each approved attribute to
-- the evidence on hand: what the plan requires for it, which in-force files are
-- candidates, the passages that support it (each a verified quote located to a page,
-- sheet, row and column, or image), the facts those passages state and the
-- interpretations drawn from them, what is missing, what conflicts, and a status:
-- MISSING, INCOMPLETE, CONTRADICTORY, POTENTIALLY_SUFFICIENT or UNKNOWN.
--
-- A run is a proposal for a person and never a test conclusion. It is pinned to the
-- plan's approved revision, a hash of the approved attributes, and each file's content
-- hash, so a later change to any of them marks the run stale. Runs are append-only.

CREATE TABLE evidence_mapping_runs (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    plan_revision integer NOT NULL,
    attributes_sha256 text NOT NULL,
    requested_by uuid NOT NULL,
    source text NOT NULL,
    note text NOT NULL DEFAULT '',
    files jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_mapping_runs_source CHECK (
        source IN ('MODEL', 'RULES', 'FALLBACK', 'FAILED')
    ),
    CONSTRAINT evidence_mapping_runs_hash CHECK (attributes_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_mapping_runs_note CHECK (char_length(note) <= 500),
    CONSTRAINT evidence_mapping_runs_files CHECK (jsonb_typeof(files) = 'array'),
    CONSTRAINT evidence_mapping_runs_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_mapping_runs_control_fk
        FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_mapping_runs_requester_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_mapping_runs_control_idx
    ON evidence_mapping_runs (engagement_control_id, created_at DESC);

CREATE TABLE evidence_mappings (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    run_id uuid NOT NULL REFERENCES evidence_mapping_runs (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    attribute_index integer NOT NULL,
    attribute_text text NOT NULL,
    status text NOT NULL,
    required text NOT NULL DEFAULT '',
    candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
    "references" jsonb NOT NULL DEFAULT '[]'::jsonb,
    facts jsonb NOT NULL DEFAULT '[]'::jsonb,
    inferences jsonb NOT NULL DEFAULT '[]'::jsonb,
    missing jsonb NOT NULL DEFAULT '[]'::jsonb,
    conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
    note text NOT NULL DEFAULT '',
    source text NOT NULL,
    model_call_id uuid REFERENCES model_calls (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_mappings_status CHECK (
        status IN ('MISSING', 'INCOMPLETE', 'CONTRADICTORY', 'POTENTIALLY_SUFFICIENT', 'UNKNOWN')
    ),
    CONSTRAINT evidence_mappings_source CHECK (
        source IN ('MODEL', 'RULES', 'FALLBACK', 'FAILED')
    ),
    CONSTRAINT evidence_mappings_index CHECK (attribute_index BETWEEN 0 AND 199),
    CONSTRAINT evidence_mappings_lists CHECK (
        jsonb_typeof(candidates) = 'array' AND jsonb_typeof("references") = 'array'
        AND jsonb_typeof(facts) = 'array' AND jsonb_typeof(inferences) = 'array'
        AND jsonb_typeof(missing) = 'array' AND jsonb_typeof(conflicts) = 'array'
    ),
    CONSTRAINT evidence_mappings_note CHECK (char_length(note) <= 1000),
    CONSTRAINT evidence_mappings_run_attribute_key UNIQUE (run_id, attribute_index)
);

CREATE INDEX evidence_mappings_run_idx ON evidence_mappings (run_id, attribute_index);

CREATE FUNCTION prevent_evidence_mapping_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'evidence mappings are immutable';
END;
$$;

CREATE TRIGGER evidence_mapping_runs_immutable
BEFORE UPDATE OR DELETE ON evidence_mapping_runs
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mapping_mutation();

CREATE TRIGGER evidence_mappings_immutable
BEFORE UPDATE OR DELETE ON evidence_mappings
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mapping_mutation();
