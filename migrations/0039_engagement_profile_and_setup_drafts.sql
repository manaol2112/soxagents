-- Engagement profile and agent-drafted setup (Milestone 8.3c).
--
-- An engagement names its client and its kind at creation, so the team and the agents
-- know what they are setting up. The engagement planner then drafts the setup for the
-- team: a scope narrative, the period end, and the evidence-request cadence, each with
-- a one-line reason. A person accepts or edits every suggestion; nothing is applied
-- until they do. One draft per engagement, redrawn on request, never after kickoff.

ALTER TABLE engagement_settings
    ADD COLUMN client_name text NOT NULL DEFAULT '',
    ADD COLUMN engagement_type text NOT NULL DEFAULT 'SOX_ITGC',
    ADD CONSTRAINT engagement_settings_client_name CHECK (char_length(client_name) <= 200),
    ADD CONSTRAINT engagement_settings_type CHECK (
        engagement_type IN ('SOX_ITGC', 'SOX_FULL', 'IT_AUDIT')
    );

CREATE TABLE setup_drafts (
    project_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    -- The planner's run: IDLE, or PENDING and WORKING while it drafts.
    draft_status text NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    draft_note text NOT NULL DEFAULT '',
    requested_by uuid NOT NULL,
    -- The suggestions. Empty or null until the first draft lands.
    scope_text text NOT NULL DEFAULT '',
    period_end date,
    pbc_due_days integer,
    pbc_follow_up_days integer,
    pbc_max_follow_ups integer,
    -- One reason per suggestion, keyed by field.
    reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- AGENT when Claude drafted it, RULES when the reviewed rules did, NONE before any.
    source text NOT NULL DEFAULT 'NONE',
    drafted_at timestamptz,
    model_call_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT setup_drafts_status CHECK (draft_status IN ('IDLE', 'PENDING', 'WORKING')),
    CONSTRAINT setup_drafts_attempts CHECK (attempts BETWEEN 0 AND 50),
    CONSTRAINT setup_drafts_note CHECK (char_length(draft_note) <= 500),
    CONSTRAINT setup_drafts_scope CHECK (char_length(scope_text) <= 4000),
    CONSTRAINT setup_drafts_cadence CHECK (
        (pbc_due_days IS NULL OR pbc_due_days BETWEEN 1 AND 90)
        AND (pbc_follow_up_days IS NULL OR pbc_follow_up_days BETWEEN 1 AND 30)
        AND (pbc_max_follow_ups IS NULL OR pbc_max_follow_ups BETWEEN 0 AND 10)
    ),
    CONSTRAINT setup_drafts_reasons CHECK (jsonb_typeof(reasons) = 'object'),
    CONSTRAINT setup_drafts_source CHECK (source IN ('NONE', 'RULES', 'AGENT')),
    CONSTRAINT setup_drafts_version CHECK (version >= 1),
    CONSTRAINT setup_drafts_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT setup_drafts_requester_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX setup_drafts_open_idx ON setup_drafts (draft_status, lease_until)
    WHERE draft_status IN ('PENDING', 'WORKING');

CREATE TRIGGER setup_drafts_updated_at
    BEFORE UPDATE ON setup_drafts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
