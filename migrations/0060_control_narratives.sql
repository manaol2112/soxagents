-- The process design narrative of a control: how the process runs and where the control
-- sits in it, written by the team, uploaded from the client's documentation, or drafted
-- by the agent from common practice and then customised. One per control; testing does
-- not start until it is confirmed.

CREATE TABLE control_narratives (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    text text NOT NULL DEFAULT '',
    -- Who wrote the text as it stands: a person, an uploaded document, the agent, or
    -- the reviewed library of common narratives.
    source text NOT NULL DEFAULT 'PERSON',
    file_name text NOT NULL DEFAULT '',
    file_sha256 text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'DRAFT',
    -- The latest recommendation, kept beside the text so it can be taken up again.
    suggestion text NOT NULL DEFAULT '',
    suggestion_source text NOT NULL DEFAULT 'NONE',
    suggestion_note text NOT NULL DEFAULT '',
    suggestion_call_id uuid,
    confirmed_by uuid,
    confirmed_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_narratives_control UNIQUE (engagement_control_id),
    CONSTRAINT control_narratives_text CHECK (char_length(text) <= 20000),
    CONSTRAINT control_narratives_suggestion CHECK (char_length(suggestion) <= 20000),
    CONSTRAINT control_narratives_source CHECK (
        source IN ('PERSON', 'UPLOAD', 'AGENT', 'LIBRARY')
    ),
    CONSTRAINT control_narratives_suggestion_source CHECK (
        suggestion_source IN ('NONE', 'AGENT', 'LIBRARY')
    ),
    CONSTRAINT control_narratives_status CHECK (status IN ('DRAFT', 'CONFIRMED')),
    CONSTRAINT control_narratives_confirmed CHECK (
        (status = 'CONFIRMED') = (confirmed_at IS NOT NULL)
    ),
    CONSTRAINT control_narratives_control_fk
        FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id),
    CONSTRAINT control_narratives_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

CREATE INDEX control_narratives_project_idx ON control_narratives (project_id, status);
