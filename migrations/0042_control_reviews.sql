-- Milestone 9.1: independent review of a control instance.
--
-- One review per control instance, opened when its effectiveness workpaper is prepared.
-- The independent reviewer agent re-performs the testing in the background and proposes
-- review notes; a team member with the reviewer role decides them, adds their own, and
-- signs the review off once every note is cleared. A note that requires a change reopens
-- the test sheet or the workpaper, the preparer responds, and the reviewer clears it.

CREATE TABLE control_reviews (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    opened_by uuid NOT NULL,
    -- The agent's re-performance: IDLE, or PENDING and WORKING while it runs.
    reperform_status text NOT NULL DEFAULT 'PENDING',
    reperform_requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    reperform_started_at timestamptz,
    reperformed_at timestamptz,
    reperform_source text,
    reperform_note text NOT NULL DEFAULT '',
    reperform_call_id uuid,
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    -- The test sheet version the agent last re-performed.
    sheet_version_reviewed integer,
    signed_by uuid,
    signed_at timestamptz,
    signoff_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT control_reviews_status CHECK (status IN ('OPEN', 'SIGNED_OFF')),
    CONSTRAINT control_reviews_reperform CHECK (
        reperform_status IN ('IDLE', 'PENDING', 'WORKING')
    ),
    CONSTRAINT control_reviews_source CHECK (
        reperform_source IS NULL OR reperform_source IN ('MODEL', 'RULES')
    ),
    CONSTRAINT control_reviews_attempts CHECK (attempts BETWEEN 0 AND 50),
    CONSTRAINT control_reviews_note CHECK (char_length(reperform_note) <= 500),
    CONSTRAINT control_reviews_signoff CHECK (char_length(signoff_note) <= 1000),
    CONSTRAINT control_reviews_signed CHECK (
        (status = 'SIGNED_OFF') = (signed_by IS NOT NULL AND signed_at IS NOT NULL)
    ),
    CONSTRAINT control_reviews_version CHECK (version >= 1),
    CONSTRAINT control_reviews_one_per_control UNIQUE (project_id, engagement_control_id),
    CONSTRAINT control_reviews_scope_key UNIQUE (project_id, id),
    CONSTRAINT control_reviews_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_reviews_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_reviews_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_reviews_opened_by_fk
        FOREIGN KEY (opened_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_reviews_signed_by_fk
        FOREIGN KEY (signed_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_reviews_call_fk
        FOREIGN KEY (reperform_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX control_reviews_project_idx ON control_reviews (project_id, status);
CREATE INDEX control_reviews_reperform_idx ON control_reviews (reperform_status, lease_until)
    WHERE reperform_status IN ('PENDING', 'WORKING');

CREATE TRIGGER control_reviews_updated_at
    BEFORE UPDATE ON control_reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A review note: what the reviewer (the agent, or a person) wants changed or confirmed.
-- An agent's note is PROPOSED until a reviewer accepts it (OPEN) or dismisses it; a
-- person's note is OPEN at once. The preparer's answer makes it RESPONDED; the reviewer
-- clears it, or returns it to OPEN. A proposal the agent made before re-performing again
-- is WITHDRAWN.
CREATE TABLE review_notes (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    control_review_id uuid NOT NULL,
    number integer NOT NULL,
    target_kind text NOT NULL,
    -- What the note is about: {item_id, index, workpaper_id, section, deficiency_id},
    -- and, for the agent's re-performance, its result and checked citations.
    target jsonb NOT NULL DEFAULT '{}'::jsonb,
    text text NOT NULL,
    severity text NOT NULL,
    status text NOT NULL,
    raised_by text NOT NULL,
    raised_by_user uuid,
    raised_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    decided_by uuid,
    decided_at timestamptz,
    decision_reason text NOT NULL DEFAULT '',
    response text NOT NULL DEFAULT '',
    responded_by uuid,
    responded_at timestamptz,
    cleared_by uuid,
    cleared_at timestamptz,
    clear_reason text NOT NULL DEFAULT '',
    -- What accepting the note reopened: ["SHEET", "WORKPAPER:<id>"], or why it could not.
    reopened jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT review_notes_number CHECK (number >= 1),
    CONSTRAINT review_notes_target_kind CHECK (
        target_kind IN ('RESULT', 'SAMPLE', 'WORKPAPER', 'DEFICIENCY', 'GENERAL')
    ),
    CONSTRAINT review_notes_target CHECK (jsonb_typeof(target) = 'object'),
    CONSTRAINT review_notes_text CHECK (char_length(text) BETWEEN 1 AND 2000),
    CONSTRAINT review_notes_severity CHECK (
        severity IN ('MUST_FIX', 'SHOULD_FIX', 'OBSERVATION')
    ),
    CONSTRAINT review_notes_status CHECK (
        status IN ('PROPOSED', 'OPEN', 'RESPONDED', 'CLEARED', 'DISMISSED', 'WITHDRAWN')
    ),
    CONSTRAINT review_notes_raised_by CHECK (raised_by IN ('AGENT', 'PERSON')),
    CONSTRAINT review_notes_person CHECK (raised_by <> 'PERSON' OR raised_by_user IS NOT NULL),
    CONSTRAINT review_notes_lengths CHECK (
        char_length(decision_reason) <= 500 AND char_length(response) <= 2000
        AND char_length(clear_reason) <= 500
    ),
    CONSTRAINT review_notes_reopened CHECK (jsonb_typeof(reopened) = 'array'),
    CONSTRAINT review_notes_version CHECK (version >= 1),
    CONSTRAINT review_notes_number_key UNIQUE (control_review_id, number),
    CONSTRAINT review_notes_review_fk
        FOREIGN KEY (project_id, control_review_id) REFERENCES control_reviews (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT review_notes_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT review_notes_raised_by_fk
        FOREIGN KEY (raised_by_user) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT review_notes_decided_by_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT review_notes_responded_by_fk
        FOREIGN KEY (responded_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT review_notes_cleared_by_fk
        FOREIGN KEY (cleared_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX review_notes_review_idx ON review_notes (control_review_id, status);

CREATE TRIGGER review_notes_updated_at
    BEFORE UPDATE ON review_notes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
