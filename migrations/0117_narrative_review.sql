-- The process narrative, drafted and reviewed in the background (decided by the product
-- owner on 26 October 2026). The narrative is written in fixed sections, each naming the
-- control's attributes it covers; a reviewer agent checks every draft and fixes it, up to
-- two rounds; a fact only the client can give becomes a question the walkthrough asks, kept
-- on the control's issues with its suggested answers; and a narrative is approved after a
-- clean review, or with a person's written reason.

-- The narrative's sections: [{key, heading, text, attributes}], for the current map, the
-- proposal beside it, and each kept version. The summary stays the sections' plain text.
ALTER TABLE process_understandings
    ADD COLUMN sections jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN proposed_sections jsonb,
    ADD CONSTRAINT process_understandings_sections CHECK (jsonb_typeof(sections) = 'array');

ALTER TABLE process_understanding_versions
    ADD COLUMN sections jsonb NOT NULL DEFAULT '[]'::jsonb;

-- A question the drafter or the reviewer needs the client to answer, and the answers the
-- records suggest. Answering resolves the issue; the answer is its resolution note.
ALTER TABLE control_context_issues
    ADD COLUMN question text NOT NULL DEFAULT '',
    ADD COLUMN suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT control_context_issues_question CHECK (
        char_length(question) <= 400 AND jsonb_typeof(suggestions) = 'array'
    );

-- One background run per control: drafting then reviewing, or reviewing alone. The last
-- review is kept with the narrative version it reviewed, so an edit after it shows.
CREATE TABLE process_narrative_runs (
    engagement_control_id uuid PRIMARY KEY
        REFERENCES engagement_controls (id) ON DELETE CASCADE,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    mode text NOT NULL DEFAULT 'DRAFT',
    run_status text NOT NULL DEFAULT 'IDLE',
    stage text NOT NULL DEFAULT '',
    round integer NOT NULL DEFAULT 0,
    run_attempts integer NOT NULL DEFAULT 0,
    run_lease_until timestamptz,
    run_note text NOT NULL DEFAULT '',
    requested_by uuid,
    -- {passed, rounds, reviewer, coverage: [{code, sections, steps}], findings: [text]}
    review jsonb,
    reviewed_version integer,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT process_narrative_runs_mode CHECK (mode IN ('DRAFT', 'REVIEW')),
    CONSTRAINT process_narrative_runs_status CHECK (
        run_status IN ('IDLE', 'PENDING', 'WORKING', 'FAILED')
    ),
    CONSTRAINT process_narrative_runs_stage CHECK (stage IN ('', 'DRAFTING', 'REVIEWING'))
);

CREATE INDEX process_narrative_runs_open_idx
    ON process_narrative_runs (run_status) WHERE run_status IN ('PENDING', 'WORKING');
