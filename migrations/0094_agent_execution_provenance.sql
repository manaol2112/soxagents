-- Milestone 3a: real agent execution.
--
-- 1. Every model call keeps what it was: the model identity, the tier, the agent, the
--    prompt's version and hash, the answer's hash, the record worked on, the job and
--    attempt, how long it took and, when it failed, the error class (never the key).
--    The prompt and answer themselves are kept apart, encrypted with the firm's
--    provenance key, readable only through the audited content route, and removed at
--    their expiry; the hashes stay.
-- 2. A result says who produced it: MODEL (the model's checked answer), RULES (the
--    reviewed rules, by design: no model is configured or the rules are the method),
--    FALLBACK (the model failed and the rules produced a separate result; the failed
--    call is linked), FAILED (the model failed and nothing stands in for it; a person
--    decides). A model failure is never hidden behind a rules result.
-- 3. A person can cancel a queued or running agent job; the job stops at its next check
--    and the record says who cancelled it and when.
-- 4. A call refused before dispatch because a budget is exhausted is recorded as such.

ALTER TABLE model_calls
    ADD COLUMN model_name text NOT NULL DEFAULT '',
    ADD COLUMN tier text,
    ADD COLUMN agent_key text,
    ADD COLUMN prompt_version text,
    ADD COLUMN prompt_sha256 text,
    ADD COLUMN output_sha256 text,
    ADD COLUMN target_type text,
    ADD COLUMN target_id uuid,
    ADD COLUMN job_id uuid,
    ADD COLUMN attempt integer NOT NULL DEFAULT 1,
    ADD COLUMN duration_ms integer,
    ADD COLUMN error text NOT NULL DEFAULT '',
    ADD COLUMN actor_agent_instance_id uuid,
    ADD CONSTRAINT model_calls_tier CHECK (tier IS NULL OR tier IN ('FAST', 'BALANCED', 'DEEP')),
    ADD CONSTRAINT model_calls_attempt CHECK (attempt BETWEEN 1 AND 20),
    ADD CONSTRAINT model_calls_duration CHECK (duration_ms IS NULL OR duration_ms >= 0),
    ADD CONSTRAINT model_calls_error CHECK (char_length(error) <= 500),
    ADD CONSTRAINT model_calls_hashes CHECK (
        (prompt_sha256 IS NULL OR prompt_sha256 ~ '^[0-9a-f]{64}$')
        AND (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$')
    ),
    ADD CONSTRAINT model_calls_agent_actor_fk
        FOREIGN KEY (actor_agent_instance_id, project_id, organization_id)
        REFERENCES agent_instances (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE model_calls DROP CONSTRAINT model_calls_status;
ALTER TABLE model_calls ADD CONSTRAINT model_calls_status CHECK (
    status IN (
        'SUCCEEDED', 'MALFORMED', 'TIMEOUT', 'CANCELLED', 'RATE_LIMITED', 'MODEL_ERROR',
        'BUDGET_EXCEEDED'
    )
);

CREATE INDEX model_calls_project_month_idx ON model_calls (project_id, created_at);
CREATE INDEX model_calls_job_idx ON model_calls (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX model_calls_target_idx ON model_calls (target_type, target_id)
    WHERE target_id IS NOT NULL;

-- The prompt and the answer, encrypted. One row per call at most; nothing updates it,
-- and it can be deleted only once expired (the retention the firm configured).
CREATE TABLE model_call_contents (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    model_call_id uuid NOT NULL,
    key_id text NOT NULL,
    nonce bytea NOT NULL,
    ciphertext bytea NOT NULL,
    prompt_chars integer NOT NULL,
    output_chars integer NOT NULL,
    image_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT model_call_contents_call_key UNIQUE (model_call_id),
    CONSTRAINT model_call_contents_key_not_blank CHECK (length(btrim(key_id)) > 0),
    CONSTRAINT model_call_contents_nonce CHECK (octet_length(nonce) = 12),
    CONSTRAINT model_call_contents_counts CHECK (
        prompt_chars >= 0 AND output_chars >= 0 AND image_count >= 0
    ),
    CONSTRAINT model_call_contents_expiry CHECK (expires_at > created_at),
    CONSTRAINT model_call_contents_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT model_call_contents_call_fk
        FOREIGN KEY (model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX model_call_contents_expiry_idx ON model_call_contents (expires_at);

CREATE FUNCTION protect_model_call_contents()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'model_call_contents are immutable';
    END IF;
    IF OLD.expires_at > clock_timestamp() THEN
        RAISE EXCEPTION 'model_call_contents are removed only once expired';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER model_call_contents_protect
BEFORE UPDATE OR DELETE ON model_call_contents
FOR EACH ROW EXECUTE FUNCTION protect_model_call_contents();

-- Who produced a result: MODEL, RULES, FALLBACK (rules after a model failure), FAILED
-- (a model failure with nothing in its place).
ALTER TABLE test_items DROP CONSTRAINT test_items_source;
ALTER TABLE test_items ADD CONSTRAINT test_items_source CHECK (
    source IS NULL OR source IN ('MODEL', 'REVIEW', 'RULES', 'FAILED')
);

ALTER TABLE evidence_analyses DROP CONSTRAINT evidence_analyses_source;
ALTER TABLE evidence_analyses ADD CONSTRAINT evidence_analyses_source CHECK (
    source IS NULL OR source IN ('MODEL', 'RULES', 'FALLBACK', 'FAILED')
);

ALTER TABLE pbc_drafts DROP CONSTRAINT pbc_drafts_source;
ALTER TABLE pbc_drafts ADD CONSTRAINT pbc_drafts_source CHECK (
    source IS NULL OR source IN ('MODEL', 'RULES', 'FALLBACK')
);

ALTER TABLE control_reviews DROP CONSTRAINT control_reviews_source;
ALTER TABLE control_reviews ADD CONSTRAINT control_reviews_source CHECK (
    reperform_source IS NULL OR reperform_source IN ('MODEL', 'RULES', 'FALLBACK')
);

ALTER TABLE evidence_plans DROP CONSTRAINT evidence_plans_source;
ALTER TABLE evidence_plans ADD CONSTRAINT evidence_plans_source CHECK (
    source IN ('MODEL', 'RULES', 'FALLBACK')
);

ALTER TABLE evidence_plan_runs DROP CONSTRAINT evidence_plan_runs_source;
ALTER TABLE evidence_plan_runs ADD CONSTRAINT evidence_plan_runs_source CHECK (
    source IN ('MODEL', 'RULES', 'FALLBACK')
);

ALTER TABLE workpaper_versions DROP CONSTRAINT workpaper_versions_source;
ALTER TABLE workpaper_versions ADD CONSTRAINT workpaper_versions_source CHECK (
    source IN ('AGENT', 'PERSON', 'RECORDS', 'FALLBACK')
);

ALTER TABLE evidence_matches DROP CONSTRAINT evidence_matches_source;
ALTER TABLE evidence_matches ADD CONSTRAINT evidence_matches_source CHECK (
    source IS NULL OR source IN ('RULES', 'MODEL', 'FAILED')
);

ALTER TABLE setup_drafts DROP CONSTRAINT setup_drafts_source;
ALTER TABLE setup_drafts ADD CONSTRAINT setup_drafts_source CHECK (
    source IN ('NONE', 'RULES', 'AGENT', 'FALLBACK')
);

ALTER TABLE system_reviews DROP CONSTRAINT system_reviews_source;
ALTER TABLE system_reviews ADD CONSTRAINT system_reviews_source CHECK (
    source IN ('NONE', 'RULES', 'AGENT', 'FALLBACK')
);

ALTER TABLE system_control_assessments DROP CONSTRAINT system_control_assessments_source;
ALTER TABLE system_control_assessments ADD CONSTRAINT system_control_assessments_source CHECK (
    source IN ('NONE', 'RULES', 'AGENT', 'FALLBACK')
);

ALTER TABLE rcm_imports DROP CONSTRAINT rcm_imports_systems_source;
ALTER TABLE rcm_imports ADD CONSTRAINT rcm_imports_systems_source CHECK (
    systems_source IS NULL OR systems_source IN ('MODEL', 'RULES', 'FALLBACK')
);

ALTER TABLE process_understandings DROP CONSTRAINT process_understandings_built;
ALTER TABLE process_understandings ADD CONSTRAINT process_understandings_built CHECK (
    built_by IN ('PERSON', 'AGENT', 'RULES', 'LEGACY', 'FALLBACK')
);

ALTER TABLE library_match_runs DROP CONSTRAINT library_match_runs_by;
ALTER TABLE library_match_runs ADD CONSTRAINT library_match_runs_by CHECK (
    decided_by IN ('RULES', 'MODEL', 'FALLBACK')
);

ALTER TABLE rcm_imports DROP CONSTRAINT rcm_imports_terms_source;
ALTER TABLE rcm_imports ADD CONSTRAINT rcm_imports_terms_source CHECK (
    terms_source IS NULL OR terms_source IN ('MODEL', 'RULES', 'FALLBACK')
);

-- Cancellation of a queued or running agent job: asked by a person, carried out by the
-- job at its next check (or at once when nothing has claimed the job yet).
ALTER TABLE test_sheets
    ADD COLUMN cancel_requested_at timestamptz,
    ADD COLUMN cancel_requested_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN cancelled_at timestamptz;

ALTER TABLE control_reviews
    ADD COLUMN cancel_requested_at timestamptz,
    ADD COLUMN cancel_requested_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN cancelled_at timestamptz;

ALTER TABLE evidence_analyses
    ADD COLUMN cancel_requested_at timestamptz,
    ADD COLUMN cancel_requested_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN cancelled_at timestamptz;

ALTER TABLE workpapers
    ADD COLUMN cancel_requested_at timestamptz,
    ADD COLUMN cancel_requested_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN cancelled_at timestamptz;
