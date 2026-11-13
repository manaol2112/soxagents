-- The evidence assurance chain (docs/evidence-assurance.md; asked for and approved by the
-- product owner on 12 November 2026).
--
-- The files in force on a DESIGN-phase requirement are checked together against the
-- control's approved attributes by two independent readings (the control's tester, then
-- the independent reviewer, who sees nothing of the first answer) and by rules in code,
-- before a person sees any of it as fact. One request is often answered by several files
-- (a ticket shows the approval, a change log shows the grant), so a run reads all of a
-- requirement's files together: judged alone, each would raise an issue that is not real.
-- evidence_assessments keeps one row per run:
--
--   identity  the firm, the engagement, the control, the requirement and its phase;
--   basis     what the run read, as hashes and ids: every in-force file of the requirement
--             (its id, content hash, the hash of its stored text, its kind, and the gate's
--             code where the file was held and left out), the control's facts, the
--             attributes as assessed (each id, letter, wording and criteria), the
--             attributes the requirement links, the lens, both prompt versions, and one
--             hash over all of it;
--   state     PENDING, WORKING, HELD, READY or FAILED; the stage reached; the lease and
--             the attempts as evidence_analyses has them; the gate's code and sentence
--             when the whole run is held; why it failed when it did;
--   answers   the two checked answers (never the raw model output), each with its model
--             call;
--   outcome   per attribute: the verdict, the agreed result, the passages with their file
--             and location, what is absent, and both views when the readings do not agree;
--   stale     when and why the run went out of date.
--
-- A finished run (HELD, READY, FAILED) is never changed, except to be marked out of date,
-- once; an out-of-date run is never changed again; a run is never deleted. A run still
-- queued may be brought up to date in place (a second file arriving before the worker
-- took it), so files that arrive together are read once. There is one current (not
-- out-of-date) run per requirement, so the same basis is never run twice: asking again
-- finds the run on record. A run made by copying an earlier run of the same basis names
-- it (reused_from_id) and made no model call.
--
-- evidence_findings gains the source ASSURANCE (a shortfall both readings agree on), the
-- kinds NOT_MET, PARTLY_MET, CONTRADICTED and NOT_ADDRESSED, and the run it rests on
-- (assessment_id). Each finding still rests on exactly one origin.
--
-- Rollback: delete the ASSURANCE findings' events and the findings (the immutability
-- triggers disabled for it); ALTER TABLE evidence_findings DROP CONSTRAINT
-- evidence_findings_origin, DROP CONSTRAINT evidence_findings_source, DROP CONSTRAINT
-- evidence_findings_kind, DROP COLUMN assessment_id, then restore the three constraints
-- of migration 0139; DROP TABLE evidence_assessments; DROP FUNCTION
-- guard_evidence_assessment_update(), prevent_evidence_assessment_deletion(); delete the
-- '0155_evidence_assessments' row from schema_migrations.

CREATE TABLE evidence_assessments (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    phase text NOT NULL DEFAULT 'DESIGN',
    -- The person whose action asked for the run: who added a file, confirmed its kind,
    -- changed the attributes or the links, or ran it again.
    requested_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- The basis. files: every file in force on the requirement when the run was recorded,
    -- [{file_id, file_name, sha256, text_sha256, kind, truncated, held}], where held is
    -- null for a file the readings include and {code, reason} for one the gate left out.
    files jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The files the readings include, in the order the prompt numbers them.
    file_ids uuid[] NOT NULL DEFAULT '{}',
    control_sha256 text NOT NULL,
    attributes_sha256 text NOT NULL,
    attribute_ids uuid[] NOT NULL DEFAULT '{}',
    linked_attribute_ids uuid[] NOT NULL DEFAULT '{}',
    lens text NOT NULL,
    assessor_prompt_version text NOT NULL,
    reviewer_prompt_version text NOT NULL,
    basis_sha256 text NOT NULL,
    -- The state.
    status text NOT NULL DEFAULT 'PENDING',
    stage text NOT NULL DEFAULT 'GATE',
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    held_code text,
    held_reason text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '',
    read_in_part boolean NOT NULL DEFAULT false,
    -- The two checked answers and the agents that gave them.
    assessor_agent text NOT NULL DEFAULT '',
    assessor_opinion jsonb,
    assessor_call_id uuid REFERENCES model_calls (id) ON DELETE RESTRICT,
    reviewer_opinion jsonb,
    reviewer_call_id uuid REFERENCES model_calls (id) ON DELETE RESTRICT,
    outcome jsonb NOT NULL DEFAULT '[]'::jsonb,
    reused_from_id uuid REFERENCES evidence_assessments (id) ON DELETE RESTRICT,
    stale_at timestamptz,
    stale_reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    CONSTRAINT evidence_assessments_phase CHECK (phase = 'DESIGN'),
    CONSTRAINT evidence_assessments_status CHECK (
        status IN ('PENDING', 'WORKING', 'HELD', 'READY', 'FAILED')
    ),
    CONSTRAINT evidence_assessments_stage CHECK (
        stage IN ('GATE', 'ASSESS', 'VERIFY', 'COMPARE', 'DONE')
    ),
    CONSTRAINT evidence_assessments_lens CHECK (lens IN ('DESIGN_DOCUMENT', 'INSTANCE_RECORD')),
    CONSTRAINT evidence_assessments_attempts CHECK (attempts BETWEEN 0 AND 20),
    CONSTRAINT evidence_assessments_hashes CHECK (
        control_sha256 ~ '^[0-9a-f]{64}$' AND attributes_sha256 ~ '^[0-9a-f]{64}$'
        AND basis_sha256 ~ '^[0-9a-f]{64}$'
    ),
    -- A run reads at least one file of its requirement; one the gate holds whole reads none.
    CONSTRAINT evidence_assessments_files CHECK (
        jsonb_typeof(files) = 'array' AND jsonb_array_length(files) >= 1
        AND cardinality(file_ids) <= jsonb_array_length(files)
    ),
    CONSTRAINT evidence_assessments_held CHECK (
        (status = 'HELD') = (held_code IS NOT NULL)
        AND (held_code IS NULL OR held_code IN (
            'CUSTODY', 'UNREADABLE', 'KIND_UNSURE', 'POPULATION', 'NO_ATTRIBUTES', 'TOO_LARGE'
        ))
        AND (held_code IS NULL OR char_length(btrim(held_reason)) >= 3)
        AND (status <> 'HELD' OR stage = 'GATE')
    ),
    -- A reviewed run carries both checked answers and is at its last stage; nothing else
    -- carries an outcome.
    CONSTRAINT evidence_assessments_ready CHECK (
        (status = 'READY') = (stage = 'DONE')
        AND (status <> 'READY' OR (
            assessor_opinion IS NOT NULL AND reviewer_opinion IS NOT NULL
            AND cardinality(file_ids) >= 1
        ))
        AND (status = 'READY' OR outcome = '[]'::jsonb)
    ),
    CONSTRAINT evidence_assessments_finished CHECK (
        (status IN ('HELD', 'READY', 'FAILED')) = (finished_at IS NOT NULL)
    ),
    CONSTRAINT evidence_assessments_json CHECK (
        jsonb_typeof(outcome) = 'array'
        AND (assessor_opinion IS NULL OR jsonb_typeof(assessor_opinion) = 'object')
        AND (reviewer_opinion IS NULL OR jsonb_typeof(reviewer_opinion) = 'object')
    ),
    CONSTRAINT evidence_assessments_text CHECK (
        char_length(held_reason) <= 300 AND char_length(note) <= 300
        AND char_length(stale_reason) <= 300 AND char_length(assessor_agent) <= 120
        AND char_length(assessor_prompt_version) BETWEEN 1 AND 80
        AND char_length(reviewer_prompt_version) BETWEEN 1 AND 80
    ),
    CONSTRAINT evidence_assessments_stale CHECK (
        (stale_at IS NULL) = (stale_reason = '')
    ),
    CONSTRAINT evidence_assessments_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_assessments_control_fk
        FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One current run per requirement: the same basis is never run twice.
CREATE UNIQUE INDEX evidence_assessments_current
    ON evidence_assessments (requirement_id) WHERE stale_at IS NULL;
CREATE INDEX evidence_assessments_control_idx
    ON evidence_assessments (engagement_control_id, created_at DESC);
CREATE INDEX evidence_assessments_open_idx ON evidence_assessments (status, lease_until)
    WHERE status IN ('PENDING', 'WORKING') AND stale_at IS NULL;
CREATE INDEX evidence_assessments_basis_idx
    ON evidence_assessments (requirement_id, basis_sha256);
CREATE INDEX evidence_assessments_files_idx ON evidence_assessments USING gin (files jsonb_path_ops);

CREATE TRIGGER evidence_assessments_touch
BEFORE UPDATE ON evidence_assessments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A finished run is only ever marked out of date, once; an out-of-date run is never
-- changed. (A run still queued or working may be marked out of date too: its worker then
-- finds nothing to save.)
CREATE FUNCTION guard_evidence_assessment_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.stale_at IS NOT NULL THEN
        RAISE EXCEPTION 'an out-of-date evidence assessment is never changed';
    END IF;
    IF OLD.status IN ('HELD', 'READY', 'FAILED') AND (
        NEW.stale_at IS NULL
        OR (to_jsonb(NEW) - 'stale_at' - 'stale_reason' - 'updated_at')
           IS DISTINCT FROM (to_jsonb(OLD) - 'stale_at' - 'stale_reason' - 'updated_at')
    ) THEN
        RAISE EXCEPTION 'a finished evidence assessment is only marked out of date';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_assessments_guard
BEFORE UPDATE ON evidence_assessments
FOR EACH ROW EXECUTE FUNCTION guard_evidence_assessment_update();

CREATE FUNCTION prevent_evidence_assessment_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'an evidence assessment is marked out of date, never deleted';
END;
$$;

CREATE TRIGGER evidence_assessments_kept
BEFORE DELETE ON evidence_assessments
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_assessment_deletion();

-- An archived engagement's assessments are read-only (migration 0136).
CREATE TRIGGER evidence_assessments_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_assessments
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

-- Findings from the chain: a shortfall both readings agree on, resting on its run.
ALTER TABLE evidence_findings
    ADD COLUMN assessment_id uuid REFERENCES evidence_assessments (id) ON DELETE RESTRICT;

ALTER TABLE evidence_findings DROP CONSTRAINT evidence_findings_source;
ALTER TABLE evidence_findings ADD CONSTRAINT evidence_findings_source
    CHECK (source IN ('READER', 'RULES', 'MAPPING', 'TRACE', 'ASSURANCE'));

ALTER TABLE evidence_findings DROP CONSTRAINT evidence_findings_kind;
ALTER TABLE evidence_findings ADD CONSTRAINT evidence_findings_kind CHECK (
    kind IN (
        'GAP', 'PARTIAL', 'NOT_COVERED', 'PLACEHOLDER', 'VERSION', 'PERIOD',
        'MISSING', 'CONFLICT', 'CONCERN', 'LATE', 'NOT_TRACED', 'ACTIVITY',
        'NOT_MET', 'PARTLY_MET', 'CONTRADICTED', 'NOT_ADDRESSED'
    )
);

-- Each finding rests on exactly one origin: a reading, a mapping run, a trace, or an
-- assurance run. The chain's kinds are the chain's alone.
ALTER TABLE evidence_findings DROP CONSTRAINT evidence_findings_origin;
ALTER TABLE evidence_findings ADD CONSTRAINT evidence_findings_origin CHECK (
    (source = 'MAPPING') = (mapping_run_id IS NOT NULL)
    AND (source IN ('READER', 'RULES')) = (analysis_id IS NOT NULL)
    AND (source = 'TRACE') = (walkthrough_instance_id IS NOT NULL)
    AND (source = 'ASSURANCE') = (assessment_id IS NOT NULL)
    AND (source = 'ASSURANCE')
        = (kind IN ('NOT_MET', 'PARTLY_MET', 'CONTRADICTED', 'NOT_ADDRESSED'))
);

CREATE INDEX evidence_findings_assessment_idx
    ON evidence_findings (assessment_id) WHERE assessment_id IS NOT NULL;
