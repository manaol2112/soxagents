-- Policies and procedures, and prior-year references, on the Systems & Processes page
-- (decided by the product owner on 25 October 2026).
--
-- 1. A policy or procedure governs any number of systems and processes. Every control
--    under them can cite it, as if linked to it, unless a person takes it off one control.
-- 2. A prior-year reference (workpapers, the prior RCM) is matched by the agent to this
--    year's controls; a person confirms each match. For a confirmed match the agent
--    proposes client-specific answers, prior-year exceptions to address, the prior test
--    approach, and design changes. Each proposal waits for a person. Prior-year work is
--    a reference, never evidence that a control operated this year.

-- 1. What a governing document applies to

CREATE TABLE source_document_systems (
    document_id uuid NOT NULL REFERENCES source_documents (id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    engagement_application_id uuid NOT NULL,
    linked_by uuid,
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (document_id, engagement_application_id),
    CONSTRAINT source_document_systems_application_fk
        FOREIGN KEY (project_id, engagement_application_id)
        REFERENCES engagement_applications (project_id, id) ON DELETE CASCADE
);

CREATE INDEX source_document_systems_application_idx
    ON source_document_systems (engagement_application_id);

CREATE TABLE source_document_processes (
    document_id uuid NOT NULL REFERENCES source_documents (id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    process_id uuid NOT NULL REFERENCES engagement_processes (id) ON DELETE CASCADE,
    linked_by uuid,
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (document_id, process_id)
);

CREATE INDEX source_document_processes_process_idx ON source_document_processes (process_id);

-- A control a governing document does not apply to, though its system or process is
-- governed by it: a person took it off that one control.
CREATE TABLE source_document_exclusions (
    document_id uuid NOT NULL REFERENCES source_documents (id) ON DELETE CASCADE,
    engagement_control_id uuid NOT NULL REFERENCES engagement_controls (id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    excluded_by uuid,
    excluded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (document_id, engagement_control_id)
);

-- 2. Prior-year references

-- The agent's run over one prior-year document: matching, then analysis of each match.
CREATE TABLE prior_year_runs (
    document_id uuid PRIMARY KEY REFERENCES source_documents (id) ON DELETE CASCADE,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    requested_by uuid,
    run_status text NOT NULL DEFAULT 'PENDING',
    run_attempts integer NOT NULL DEFAULT 0,
    run_lease_until timestamptz,
    run_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT prior_year_runs_status CHECK (
        run_status IN ('PENDING', 'WORKING', 'IDLE', 'FAILED')
    ),
    CONSTRAINT prior_year_runs_note CHECK (char_length(run_note) <= 300),
    CONSTRAINT prior_year_runs_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

CREATE INDEX prior_year_runs_open_idx
    ON prior_year_runs (run_status) WHERE run_status IN ('PENDING', 'WORKING');

-- A control the prior-year document covers, and this year's control it is matched to.
CREATE TABLE prior_year_matches (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    document_id uuid NOT NULL REFERENCES source_documents (id) ON DELETE CASCADE,
    -- The control as the prior year named it, and the part of the document about it.
    prior_ref text NOT NULL DEFAULT '',
    prior_title text NOT NULL DEFAULT '',
    excerpt text NOT NULL DEFAULT '',
    engagement_control_id uuid REFERENCES engagement_controls (id) ON DELETE CASCADE,
    -- REFERENCE: the same control reference; DESCRIPTION: the agent matched what the
    -- control does; PERSON: a person assigned it; NONE: not matched.
    basis text NOT NULL,
    status text NOT NULL DEFAULT 'PROPOSED',
    analysis_status text NOT NULL DEFAULT 'PENDING',
    decided_by uuid,
    decided_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT prior_year_matches_basis CHECK (
        basis IN ('REFERENCE', 'DESCRIPTION', 'PERSON', 'NONE')
    ),
    CONSTRAINT prior_year_matches_status CHECK (
        status IN ('PROPOSED', 'CONFIRMED', 'REJECTED', 'UNMATCHED', 'DISMISSED')
    ),
    CONSTRAINT prior_year_matches_analysis CHECK (
        analysis_status IN ('PENDING', 'DONE', 'SKIPPED')
    ),
    -- A match names a control; an item no control matches names none.
    CONSTRAINT prior_year_matches_control CHECK (
        (engagement_control_id IS NULL) = (status IN ('UNMATCHED', 'DISMISSED'))
    ),
    CONSTRAINT prior_year_matches_text CHECK (
        char_length(prior_ref) <= 80 AND char_length(prior_title) <= 200
        AND char_length(excerpt) <= 4000
    ),
    CONSTRAINT prior_year_matches_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

CREATE UNIQUE INDEX prior_year_matches_control_idx
    ON prior_year_matches (document_id, engagement_control_id)
    WHERE engagement_control_id IS NOT NULL;
CREATE INDEX prior_year_matches_project_idx ON prior_year_matches (project_id, document_id);

-- What the agent proposes for this year's control from a match. Each waits for a person.
CREATE TABLE prior_year_proposals (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    match_id uuid NOT NULL REFERENCES prior_year_matches (id) ON DELETE CASCADE,
    engagement_control_id uuid NOT NULL REFERENCES engagement_controls (id) ON DELETE CASCADE,
    kind text NOT NULL,
    -- ANSWER: the client-specific question it answers, and the answer.
    slot_key text NOT NULL DEFAULT '',
    value text NOT NULL DEFAULT '',
    title text NOT NULL,
    detail text NOT NULL DEFAULT '',
    -- The words of the prior-year document it rests on, found in its text.
    quote text NOT NULL,
    status text NOT NULL DEFAULT 'PROPOSED',
    -- A design change accepted is raised as an issue on the control.
    issue_id uuid REFERENCES control_context_issues (id) ON DELETE SET NULL,
    decided_by uuid,
    decided_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT prior_year_proposals_kind CHECK (
        kind IN ('ANSWER', 'EXCEPTION', 'APPROACH', 'DESIGN_CHANGE')
    ),
    CONSTRAINT prior_year_proposals_status CHECK (
        status IN ('PROPOSED', 'ACCEPTED', 'DISMISSED')
    ),
    CONSTRAINT prior_year_proposals_answer CHECK (
        (kind = 'ANSWER') = (slot_key <> '' AND value <> '')
    ),
    CONSTRAINT prior_year_proposals_text CHECK (
        char_length(btrim(title)) BETWEEN 1 AND 200 AND char_length(detail) <= 1000
        AND char_length(value) <= 300 AND char_length(btrim(quote)) BETWEEN 1 AND 600
    ),
    CONSTRAINT prior_year_proposals_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

CREATE INDEX prior_year_proposals_control_idx
    ON prior_year_proposals (engagement_control_id, status);
CREATE INDEX prior_year_proposals_match_idx ON prior_year_proposals (match_id);
