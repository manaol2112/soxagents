-- Drafted evidence requests. After kickoff the evidence coordinator drafts each PBC
-- request from its control: the population (or configuration) and the walkthrough and
-- design evidence. A draft only rewrites a request that is still a draft, and every
-- request still needs a person's approval before it is sent.

CREATE TABLE pbc_drafts (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    pbc_request_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    source text,
    content jsonb,
    model_call_id uuid,
    note text NOT NULL DEFAULT '',
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT pbc_drafts_status CHECK (
        status IN ('PENDING', 'DRAFTING', 'DRAFTED', 'FAILED', 'SKIPPED')
    ),
    CONSTRAINT pbc_drafts_source CHECK (source IS NULL OR source IN ('MODEL', 'RULES')),
    CONSTRAINT pbc_drafts_drafted CHECK (
        (status = 'DRAFTED') = (source IS NOT NULL AND content IS NOT NULL)
    ),
    CONSTRAINT pbc_drafts_content CHECK (content IS NULL OR jsonb_typeof(content) = 'object'),
    CONSTRAINT pbc_drafts_note CHECK (char_length(note) <= 200),
    CONSTRAINT pbc_drafts_attempts CHECK (attempts BETWEEN 0 AND 20),
    CONSTRAINT pbc_drafts_version CHECK (version >= 1),
    CONSTRAINT pbc_drafts_one_per_request UNIQUE (pbc_request_id),
    CONSTRAINT pbc_drafts_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_drafts_request_fk
        FOREIGN KEY (pbc_request_id) REFERENCES pbc_requests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_drafts_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_drafts_requester_fk
        FOREIGN KEY (requested_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT pbc_drafts_model_call_fk
        FOREIGN KEY (model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX pbc_drafts_open_idx ON pbc_drafts (status, lease_until)
    WHERE status IN ('PENDING', 'DRAFTING');
CREATE INDEX pbc_drafts_project_idx ON pbc_drafts (project_id);
