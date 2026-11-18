-- Walkthrough answers (decided by the product owner on 11 November 2026;
-- docs/control-workflow-plan.md, B1c).
--
-- Control Understanding asked only the values a control's statement names. The walkthrough
-- question bank (walkthrough_questions.py, in code) adds what a senior IT auditor asks in a
-- walkthrough: how the control starts, who approves, how it is performed and segregated,
-- what records it leaves, how the population is produced, and what changed in the period.
-- This table holds the answers, one row per control and question; the question itself (its
-- wording, kind, options, whether it is required) comes from the bank in code, so an answer
-- is only stored here, never interpreted.
--
-- An answer is CONFIRMED when a person gave it (source PERSON), or PROPOSED when the
-- engagement planner read it from walkthrough notes (source AGENT, with the exact words of
-- the notes in source_quote) or it comes from the prior year (PRIOR_YEAR). A proposal never
-- replaces a confirmed answer, and only confirmed answers count for the Control
-- Understanding gate. An optional question may be confirmed as not applicable, with no value.
--
-- Additive only: a new table. No backfill: no control has walkthrough answers today.
--
-- Rollback: DROP TABLE control_walkthrough_answers; and delete the
-- '0147_walkthrough_answers' row from schema_migrations.

CREATE TABLE control_walkthrough_answers (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    question_key text NOT NULL,
    value text NOT NULL DEFAULT '',
    not_applicable boolean NOT NULL DEFAULT false,
    status text NOT NULL,
    source text NOT NULL,
    source_quote text NOT NULL DEFAULT '',
    answered_by uuid,
    answered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_walkthrough_answers_key CHECK (question_key ~ '^wt-[a-z0-9-]{2,60}$'),
    CONSTRAINT control_walkthrough_answers_value CHECK (char_length(value) <= 1000),
    CONSTRAINT control_walkthrough_answers_quote CHECK (char_length(source_quote) <= 500),
    CONSTRAINT control_walkthrough_answers_status CHECK (status IN ('PROPOSED', 'CONFIRMED')),
    CONSTRAINT control_walkthrough_answers_source
        CHECK (source IN ('PERSON', 'AGENT', 'PRIOR_YEAR')),
    -- Not applicable has no value; any other answer has one.
    CONSTRAINT control_walkthrough_answers_not_applicable CHECK (not_applicable = (value = '')),
    -- Only a person marks a question not applicable.
    CONSTRAINT control_walkthrough_answers_not_applicable_confirmed
        CHECK (NOT not_applicable OR status = 'CONFIRMED'),
    -- A confirmed answer names the person who gave it.
    CONSTRAINT control_walkthrough_answers_confirmed_by
        CHECK (status = 'PROPOSED' OR answered_by IS NOT NULL),
    CONSTRAINT control_walkthrough_answers_version CHECK (version >= 1),
    CONSTRAINT control_walkthrough_answers_one_per_question
        UNIQUE (engagement_control_id, question_key),
    CONSTRAINT control_walkthrough_answers_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_walkthrough_answers_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT control_walkthrough_answers_answered_fk
        FOREIGN KEY (answered_by) REFERENCES users (id)
);

CREATE INDEX control_walkthrough_answers_control_idx
    ON control_walkthrough_answers (engagement_control_id);

-- The Control Understanding gate reads every confirmed answer of an engagement at once.
CREATE INDEX control_walkthrough_answers_project_idx
    ON control_walkthrough_answers (project_id, status);

CREATE TRIGGER control_walkthrough_answers_updated_at
    BEFORE UPDATE ON control_walkthrough_answers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
