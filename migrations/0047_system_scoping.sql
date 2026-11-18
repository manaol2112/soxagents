-- Scoping each in-scope system, with the agent's help.
--
-- A system records how it is hosted and whether a SOC 1 report is expected for it. The
-- scoping agent proposes both for systems it knows; a person confirms them. For each
-- system the agent then reviews the scoping: whether the vendor's SOC report is likely
-- to cover change management and operations, the complementary user entity controls
-- (CUECs) the report usually places on the client, and the control changes that follow.
-- Until a SOC report is read (a later milestone) every review is a first guess and says
-- so. Nothing changes the scope until a person accepts a recommendation.

ALTER TABLE engagement_applications
    ADD COLUMN hosting text,
    ADD COLUMN soc_expected boolean,
    ADD COLUMN facts_source text NOT NULL DEFAULT 'NONE',
    ADD COLUMN facts_reason text NOT NULL DEFAULT '',
    ADD COLUMN facts_confirmed boolean NOT NULL DEFAULT false,
    ADD COLUMN version integer NOT NULL DEFAULT 1,
    ADD CONSTRAINT engagement_applications_hosting CHECK (
        hosting IS NULL OR hosting IN ('SAAS', 'VENDOR_HOSTED', 'ON_PREMISES')
    ),
    ADD CONSTRAINT engagement_applications_facts_source CHECK (
        facts_source IN ('NONE', 'RULES', 'AGENT', 'PERSON')
    ),
    ADD CONSTRAINT engagement_applications_facts_reason CHECK (char_length(facts_reason) <= 500),
    ADD CONSTRAINT engagement_applications_version CHECK (version >= 1);

-- A control the scoping review adds, such as the SOC report review, is the agent's.
ALTER TABLE engagement_controls DROP CONSTRAINT engagement_controls_source;
ALTER TABLE engagement_controls ADD CONSTRAINT engagement_controls_source CHECK (
    source IN ('LIBRARY', 'UPLOAD', 'AGENT')
);

CREATE TABLE system_reviews (
    application_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    -- The agent's run: IDLE, or PENDING and WORKING while it reviews.
    review_status text NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    note text NOT NULL DEFAULT '',
    requested_by uuid NOT NULL,
    -- AGENT when Claude reviewed it, RULES when the reviewed rules did, NONE before any.
    source text NOT NULL DEFAULT 'NONE',
    -- KNOWLEDGE: a first guess from what is known of the vendor. A read SOC report later.
    basis text NOT NULL DEFAULT 'KNOWLEDGE',
    summary text NOT NULL DEFAULT '',
    -- What the vendor's SOC report is expected to cover, in a sentence.
    coverage text NOT NULL DEFAULT '',
    -- The CUECs the report usually carries: [{"text": ..., "control_id": ... | null}].
    cuecs jsonb NOT NULL DEFAULT '[]'::jsonb,
    reviewed_at timestamptz,
    model_call_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT system_reviews_status CHECK (review_status IN ('IDLE', 'PENDING', 'WORKING')),
    CONSTRAINT system_reviews_attempts CHECK (attempts BETWEEN 0 AND 50),
    CONSTRAINT system_reviews_source CHECK (source IN ('NONE', 'RULES', 'AGENT')),
    CONSTRAINT system_reviews_basis CHECK (basis IN ('KNOWLEDGE')),
    CONSTRAINT system_reviews_text CHECK (
        char_length(note) <= 500
        AND char_length(summary) <= 1500
        AND char_length(coverage) <= 1000
    ),
    CONSTRAINT system_reviews_cuecs CHECK (jsonb_typeof(cuecs) = 'array'),
    CONSTRAINT system_reviews_version CHECK (version >= 1),
    CONSTRAINT system_reviews_application_fk
        FOREIGN KEY (project_id, application_id)
        REFERENCES engagement_applications (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT system_reviews_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT system_reviews_requester_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX system_reviews_open_idx ON system_reviews (review_status, lease_until)
    WHERE review_status IN ('PENDING', 'WORKING');

CREATE TRIGGER system_reviews_updated_at
    BEFORE UPDATE ON system_reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What the review proposes for one system. A person accepts or dismisses each one.
--   EXCLUDE         take a control instance out of scope: the SOC report covers it
--   ADD_SOC_REVIEW  add a control to review the vendor's SOC report for this system
--   MAP_CUEC        a CUEC the client must operate, answered by an existing control
--   CUEC_GAP        a CUEC no control in scope answers yet
CREATE TABLE system_recommendations (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    application_id uuid NOT NULL,
    kind text NOT NULL,
    control_id uuid,
    cuec text NOT NULL DEFAULT '',
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'PROPOSED',
    decided_by uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT system_recommendations_kind CHECK (
        kind IN ('EXCLUDE', 'ADD_SOC_REVIEW', 'MAP_CUEC', 'CUEC_GAP')
    ),
    CONSTRAINT system_recommendations_status CHECK (
        status IN ('PROPOSED', 'ACCEPTED', 'DISMISSED')
    ),
    CONSTRAINT system_recommendations_text CHECK (
        char_length(cuec) <= 500 AND char_length(reason) BETWEEN 1 AND 600
    ),
    CONSTRAINT system_recommendations_control CHECK (
        (kind IN ('EXCLUDE', 'MAP_CUEC')) = (control_id IS NOT NULL)
    ),
    CONSTRAINT system_recommendations_decided CHECK (
        (status = 'PROPOSED') = (decided_at IS NULL)
    ),
    CONSTRAINT system_recommendations_application_fk
        FOREIGN KEY (project_id, application_id)
        REFERENCES engagement_applications (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT system_recommendations_control_fk
        FOREIGN KEY (project_id, control_id) REFERENCES engagement_controls (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT system_recommendations_decider_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX system_recommendations_application_idx
    ON system_recommendations (application_id, status);
