-- A policy or procedure on file proposed as evidence for a request's item (decided by the
-- product owner on 28 October 2026).
--
-- 1. The original file of a policy or procedure is kept from now on, like any evidence
--    file, so it can be filed as evidence. One uploaded before keeps only its text: it is
--    replaced with its file once to be used as evidence.
-- 2. An agent reads the engagement's policies and procedures against the items of its
--    requests that ask for one, for the controls each document applies to
--    (control_context.applies_to), and proposes a document only where it fits, with its
--    reason and a quote from it. One run per engagement, queued again when a document is
--    added, replaced or scoped, or when a request asks for such an item.
-- 3. A person decides each proposal. Accepted, the document's file is filed on the item as
--    a person's upload would be (evidence_intake._store_upload), and is read and reviewed
--    as any evidence is. Dismissed, it is not proposed for that item again.

ALTER TABLE source_documents
    ADD COLUMN object_key text,
    ADD COLUMN content_type text NOT NULL DEFAULT '',
    ADD COLUMN size_bytes integer,
    ADD CONSTRAINT source_documents_object_key CHECK (
        object_key IS NULL OR object_key ~ '^documents/[0-9a-f-]{36}$'
    ),
    ADD CONSTRAINT source_documents_file CHECK (
        (object_key IS NULL AND size_bytes IS NULL)
        OR (object_key IS NOT NULL AND size_bytes BETWEEN 1 AND 25000000
            AND char_length(content_type) BETWEEN 1 AND 100)
    );

CREATE TABLE policy_evidence_runs (
    project_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    requested_by uuid,
    run_status text NOT NULL DEFAULT 'PENDING',
    run_attempts integer NOT NULL DEFAULT 0,
    -- Asked again while a run was working: it goes once more when it finishes.
    again boolean NOT NULL DEFAULT false,
    run_lease_until timestamptz,
    run_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT policy_evidence_runs_status CHECK (
        run_status IN ('PENDING', 'WORKING', 'IDLE', 'FAILED')
    ),
    CONSTRAINT policy_evidence_runs_note CHECK (char_length(run_note) <= 300),
    CONSTRAINT policy_evidence_runs_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

CREATE INDEX policy_evidence_runs_open_idx
    ON policy_evidence_runs (run_status) WHERE run_status IN ('PENDING', 'WORKING');

CREATE TABLE policy_evidence_proposals (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    document_id uuid NOT NULL REFERENCES source_documents (id) ON DELETE CASCADE,
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE CASCADE,
    engagement_control_id uuid NOT NULL REFERENCES engagement_controls (id) ON DELETE CASCADE,
    -- PROPOSED: the agent proposes it. NOT_FIT: the agent read it and it does not fit, kept so
    -- the same pair is not read again. A person accepts or dismisses a proposal.
    status text NOT NULL,
    reason text NOT NULL DEFAULT '',
    quote text NOT NULL DEFAULT '',
    evidence_file_id uuid REFERENCES evidence_files (id) ON DELETE RESTRICT,
    decided_by uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (document_id, requirement_id),
    CONSTRAINT policy_evidence_proposals_status CHECK (
        status IN ('PROPOSED', 'NOT_FIT', 'ACCEPTED', 'DISMISSED')
    ),
    CONSTRAINT policy_evidence_proposals_text CHECK (
        char_length(reason) <= 600 AND char_length(quote) <= 600
    ),
    CONSTRAINT policy_evidence_proposals_decided CHECK (
        (status IN ('ACCEPTED', 'DISMISSED')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
    CONSTRAINT policy_evidence_proposals_filed CHECK (
        (status = 'ACCEPTED') = (evidence_file_id IS NOT NULL)
    ),
    CONSTRAINT policy_evidence_proposals_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

CREATE INDEX policy_evidence_proposals_control_idx
    ON policy_evidence_proposals (engagement_control_id, status);
