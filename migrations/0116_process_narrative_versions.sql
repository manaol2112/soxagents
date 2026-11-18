-- Every version of a control's process narrative (decided by the product owner on 26 October
-- 2026). Each map the agent or the reviewed rules build, each save, adoption and approval
-- keeps its narrative and steps, who made it and when, so an earlier narrative can be read
-- again. The current one stays in process_understandings; this is its history, appended to
-- and never rewritten. A step may now name the control's attributes evaluated at it (their
-- codes, inside the steps' JSON): no column changes for that.

CREATE TABLE process_understanding_versions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL
        REFERENCES engagement_controls (id) ON DELETE CASCADE,
    -- The understanding's version once this change was made.
    version integer NOT NULL,
    -- BUILT: drafted as the current map; PROPOSED: drafted beside the team's map;
    -- SAVED: a person's draft; CONFIRMED: approved by a person; ADOPTED: a proposal taken.
    kind text NOT NULL,
    built_by text NOT NULL,
    summary text NOT NULL DEFAULT '',
    steps jsonb NOT NULL DEFAULT '[]'::jsonb,
    actor_user_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT process_understanding_versions_kind
        CHECK (kind IN ('BUILT', 'PROPOSED', 'SAVED', 'CONFIRMED', 'ADOPTED'))
);

CREATE INDEX process_understanding_versions_control_idx
    ON process_understanding_versions (engagement_control_id, created_at DESC);
