-- Agent first-pass review of screenshots (Milestone 7.4).
--
-- For a screenshot or a scanned page, the evidence coordinator checks the evidence
-- (legibility, system and environment, date and period, signs of editing, and whether
-- it applies to the control) and tests it against the control's test attributes. The
-- proposed conclusion is derived from those results in code, not taken from the model.
-- A person signs it off or overrides it with a reason. The review never changes a
-- request, and a drafted follow-up goes out only after the usual approval.

CREATE TABLE evidence_reviews (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    evidence_analysis_id uuid NOT NULL,
    evidence_file_id uuid NOT NULL,
    pbc_request_id uuid,
    engagement_control_id uuid,
    -- READY: the agent reviewed the images. NEEDS_PERSON: it could not, and says why.
    status text NOT NULL,
    source text,
    checks jsonb NOT NULL DEFAULT '[]'::jsonb,
    attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
    proposed text NOT NULL,
    feedback text NOT NULL DEFAULT '',
    follow_up_request_id uuid,
    model_call_id uuid,
    note text NOT NULL DEFAULT '',
    decision text,
    conclusion text,
    decision_note text NOT NULL DEFAULT '',
    decided_by uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT evidence_reviews_status CHECK (status IN ('READY', 'NEEDS_PERSON')),
    CONSTRAINT evidence_reviews_source CHECK (source IS NULL OR source = 'MODEL'),
    CONSTRAINT evidence_reviews_ready CHECK ((status = 'READY') = (source IS NOT NULL)),
    CONSTRAINT evidence_reviews_lists CHECK (
        jsonb_typeof(checks) = 'array' AND jsonb_typeof(attributes) = 'array'
    ),
    CONSTRAINT evidence_reviews_proposed CHECK (
        proposed IN ('NO_EXCEPTION', 'EXCEPTION', 'CANNOT_CONCLUDE')
    ),
    CONSTRAINT evidence_reviews_text CHECK (
        char_length(feedback) <= 1500 AND char_length(note) <= 300
        AND char_length(decision_note) <= 1000
    ),
    CONSTRAINT evidence_reviews_decision CHECK (
        decision IS NULL OR decision IN ('ACCEPTED', 'OVERRIDDEN')
    ),
    CONSTRAINT evidence_reviews_conclusion CHECK (
        conclusion IS NULL OR conclusion IN ('NO_EXCEPTION', 'EXCEPTION', 'CANNOT_CONCLUDE')
    ),
    CONSTRAINT evidence_reviews_signed CHECK (
        (decision IS NULL) = (conclusion IS NULL)
        AND (decision IS NULL) = (decided_by IS NULL)
        AND (decision IS NULL) = (decided_at IS NULL)
    ),
    -- Overriding the agent needs a reason. Accepting keeps its conclusion.
    CONSTRAINT evidence_reviews_override CHECK (
        decision IS DISTINCT FROM 'OVERRIDDEN' OR char_length(btrim(decision_note)) >= 3
    ),
    CONSTRAINT evidence_reviews_accept CHECK (
        decision IS DISTINCT FROM 'ACCEPTED' OR conclusion = proposed
    ),
    CONSTRAINT evidence_reviews_version CHECK (version >= 1),
    CONSTRAINT evidence_reviews_one_per_analysis UNIQUE (evidence_analysis_id),
    CONSTRAINT evidence_reviews_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_reviews_analysis_fk
        FOREIGN KEY (evidence_analysis_id) REFERENCES evidence_analyses (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_reviews_file_fk
        FOREIGN KEY (evidence_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_reviews_request_fk
        FOREIGN KEY (pbc_request_id) REFERENCES pbc_requests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_reviews_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_reviews_follow_up_fk
        FOREIGN KEY (follow_up_request_id) REFERENCES pbc_requests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_reviews_model_call_fk
        FOREIGN KEY (model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_reviews_decider_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_reviews_project_idx ON evidence_reviews (project_id, created_at);
