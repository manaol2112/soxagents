-- System applicability wizard (Milestone 8.10).
--
-- Adding a system opens a wizard: the system's details, its controls (chosen by hand or
-- recommended by the agent), a SOC 1 assessment, and the CUECs of an uploaded SOC 1
-- report. This migration adds what the wizard records:
--
-- - The system's details: its business purpose, the processes it supports, its owner.
-- - The agent's SOC 1 assessment on the system's review: Relevant, Not identified as
--   relevant, or Undetermined, with its basis and the sources a web search returned.
-- - system_control_assessments: per system and control, the agent's recommendation
--   (Recommended, Potentially applicable, Not recommended, Needs judgment) beside the
--   person's decision, so the two stay distinguishable.
-- - soc_reports and soc_cuecs: an uploaded SOC 1 report, the facts read from it, and
--   each CUEC with the page its wording was found on; soc_cuec_controls maps a CUEC to
--   one or more controls.
--
-- It also deletes what earlier reviews guessed rather than read (product owner, 8.10):
-- the generic CUECs on each review, the recommendations made from them or from an
-- assumed SOC report, and hosting and SOC facts no person confirmed. Controls already in
-- scope are not changed, and facts a person confirmed are kept.
--
-- Rollback: drop the new tables and columns, and delete the '0065_system_applicability'
-- row from schema_migrations. The deleted guesses are not restored; the audit log keeps
-- the decisions made on them.

ALTER TABLE engagement_applications
    ADD COLUMN purpose text NOT NULL DEFAULT '',
    ADD COLUMN processes text NOT NULL DEFAULT '',
    ADD COLUMN owner text NOT NULL DEFAULT '',
    ADD CONSTRAINT engagement_applications_details CHECK (
        char_length(purpose) <= 1000 AND char_length(processes) <= 500
        AND char_length(owner) <= 200
    );

ALTER TABLE system_reviews
    ADD COLUMN soc_status text,
    -- Whether the vendor states it issues a SOC 1 report, as a web search showed.
    ADD COLUMN soc_availability text NOT NULL DEFAULT 'NOT_RESEARCHED',
    ADD COLUMN soc_provider text NOT NULL DEFAULT '',
    ADD COLUMN soc_basis text NOT NULL DEFAULT '',
    ADD COLUMN soc_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT system_reviews_soc_status CHECK (
        soc_status IS NULL OR soc_status IN ('RELEVANT', 'NOT_IDENTIFIED', 'UNDETERMINED')
    ),
    ADD CONSTRAINT system_reviews_soc_availability CHECK (
        soc_availability IN ('STATED_AVAILABLE', 'NOT_FOUND', 'NOT_RESEARCHED')
    ),
    ADD CONSTRAINT system_reviews_soc_text CHECK (
        char_length(soc_provider) <= 200 AND char_length(soc_basis) <= 1500
    ),
    ADD CONSTRAINT system_reviews_lists CHECK (
        jsonb_typeof(soc_sources) = 'array' AND jsonb_typeof(assumptions) = 'array'
        AND jsonb_typeof(questions) = 'array'
    );

CREATE TABLE system_control_assessments (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    application_id uuid NOT NULL,
    -- The control as the library or the client's RCM names it.
    control_ref text NOT NULL,
    library_key text,
    -- The agent's recommendation, or null for a control a person chose with none.
    status text,
    source text NOT NULL DEFAULT 'NONE',
    rationale text NOT NULL DEFAULT '',
    support text NOT NULL DEFAULT '',
    missing text NOT NULL DEFAULT '',
    confidence text,
    -- The person's decision on it, when they saved the selection.
    decision text,
    decision_note text NOT NULL DEFAULT '',
    decided_by uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT system_control_assessments_status CHECK (
        status IS NULL OR status IN ('RECOMMENDED', 'POTENTIAL', 'NOT_RECOMMENDED', 'JUDGMENT')
    ),
    CONSTRAINT system_control_assessments_source CHECK (source IN ('NONE', 'RULES', 'AGENT')),
    CONSTRAINT system_control_assessments_confidence CHECK (
        confidence IS NULL OR confidence IN ('HIGH', 'MODERATE', 'LOW')
    ),
    CONSTRAINT system_control_assessments_decision CHECK (
        decision IS NULL OR decision IN ('SELECTED', 'NOT_SELECTED')
    ),
    CONSTRAINT system_control_assessments_decided CHECK (
        (decision IS NULL) = (decided_at IS NULL)
    ),
    CONSTRAINT system_control_assessments_text CHECK (
        char_length(control_ref) BETWEEN 1 AND 60 AND char_length(rationale) <= 600
        AND char_length(support) <= 600 AND char_length(missing) <= 400
        AND char_length(decision_note) <= 500
    ),
    CONSTRAINT system_control_assessments_one UNIQUE (application_id, control_ref),
    CONSTRAINT system_control_assessments_application_fk
        FOREIGN KEY (project_id, application_id)
        REFERENCES engagement_applications (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT system_control_assessments_decider_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
);

CREATE TRIGGER system_control_assessments_updated_at
    BEFORE UPDATE ON system_control_assessments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE soc_reports (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    application_id uuid NOT NULL,
    file_name text NOT NULL,
    -- The text read from the file, page by page ("[Page n]" markers), for the agent.
    text text NOT NULL,
    -- READING until the agent has read it; READ; or FAILED with a note.
    status text NOT NULL DEFAULT 'READING',
    note text NOT NULL DEFAULT '',
    -- SOC1, or SOC2 / OTHER: a SOC 2 report is not a substitute for a SOC 1 report.
    report_kind text NOT NULL DEFAULT 'SOC1',
    service_organization text NOT NULL DEFAULT '',
    report_type text NOT NULL DEFAULT 'UNKNOWN',
    period_start date,
    period_end date,
    opinion text NOT NULL DEFAULT 'UNKNOWN',
    opinion_page integer,
    scope text NOT NULL DEFAULT '',
    -- [{"text": ..., "page": n | null}], each found in the report's text.
    control_objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
    exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
    subservice jsonb NOT NULL DEFAULT '[]'::jsonb,
    model_call_id uuid,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT soc_reports_status CHECK (status IN ('READING', 'READ', 'FAILED')),
    CONSTRAINT soc_reports_kind CHECK (report_kind IN ('SOC1', 'SOC2', 'OTHER')),
    CONSTRAINT soc_reports_type CHECK (report_type IN ('TYPE_1', 'TYPE_2', 'UNKNOWN')),
    CONSTRAINT soc_reports_opinion CHECK (
        opinion IN ('UNQUALIFIED', 'QUALIFIED', 'ADVERSE', 'DISCLAIMER', 'UNKNOWN')
    ),
    CONSTRAINT soc_reports_text CHECK (
        char_length(file_name) BETWEEN 1 AND 200 AND char_length(text) <= 400000
        AND char_length(note) <= 500 AND char_length(service_organization) <= 200
        AND char_length(scope) <= 2000
    ),
    CONSTRAINT soc_reports_lists CHECK (
        jsonb_typeof(control_objectives) = 'array' AND jsonb_typeof(exceptions) = 'array'
        AND jsonb_typeof(subservice) = 'array'
    ),
    CONSTRAINT soc_reports_scope_key UNIQUE (project_id, id),
    CONSTRAINT soc_reports_application_fk
        FOREIGN KEY (project_id, application_id)
        REFERENCES engagement_applications (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT soc_reports_creator_fk FOREIGN KEY (created_by) REFERENCES users (id)
);

CREATE TRIGGER soc_reports_updated_at
    BEFORE UPDATE ON soc_reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE soc_cuecs (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    soc_report_id uuid NOT NULL,
    position integer NOT NULL,
    -- The report's own reference for it, when it has one.
    ref text NOT NULL DEFAULT '',
    -- The CUEC as the report states it, faithfully summarized where long.
    text text NOT NULL,
    -- Words copied from the report, found in its text; page is where they were found.
    quote text NOT NULL,
    page integer,
    -- How the mapped controls stand against it, not whether it is implemented.
    status text NOT NULL DEFAULT 'NOT_ASSESSED',
    rationale text NOT NULL DEFAULT '',
    limitations text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT soc_cuecs_status CHECK (
        status IN ('ADDRESSED', 'PARTIAL', 'UNADDRESSED', 'NOT_ASSESSED')
    ),
    CONSTRAINT soc_cuecs_text CHECK (
        char_length(ref) <= 40 AND char_length(btrim(text)) BETWEEN 1 AND 600
        AND char_length(btrim(quote)) BETWEEN 1 AND 400 AND char_length(rationale) <= 600
        AND char_length(limitations) <= 400
    ),
    CONSTRAINT soc_cuecs_report_fk
        FOREIGN KEY (project_id, soc_report_id) REFERENCES soc_reports (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE INDEX soc_cuecs_report_idx ON soc_cuecs (soc_report_id, position);

CREATE TABLE soc_cuec_controls (
    cuec_id uuid NOT NULL REFERENCES soc_cuecs (id) ON DELETE CASCADE,
    control_ref text NOT NULL,
    library_key text,
    rationale text NOT NULL DEFAULT '',
    PRIMARY KEY (cuec_id, control_ref),
    CONSTRAINT soc_cuec_controls_text CHECK (
        char_length(control_ref) BETWEEN 1 AND 60 AND char_length(rationale) <= 400
    )
);

-- What earlier reviews guessed rather than read.
UPDATE system_reviews SET cuecs = '[]'::jsonb, coverage = '', version = version + 1;
DELETE FROM system_recommendations
WHERE kind IN ('EXCLUDE', 'MAP_CUEC', 'CUEC_GAP', 'ADD_SOC_REVIEW')
   OR jsonb_array_length(cuec_refs) > 0;
UPDATE engagement_applications
SET hosting = NULL, soc_expected = NULL, facts_source = 'NONE', facts_reason = '',
    version = version + 1
WHERE facts_source <> 'PERSON';
