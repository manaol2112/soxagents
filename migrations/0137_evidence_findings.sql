-- Evidence findings (docs/evidence-intelligence.md, increment 2; decided by the product
-- owner on 30 October 2026).
--
-- What the agents found wanting in a control's evidence, as records a person disposes
-- of: the reader's gaps and the items a file does not cover, the deterministic checks on
-- the read text (placeholders, an unestablished version or effective date, dates outside
-- the phase's window), and the mapping's missing records, conflicts and concerns. Each
-- finding names where it comes from (the file, its analysis, the mapping run), what it
-- concerns (a requirement, an attribute), the passage that supports it when a record
-- located one, the question proposed for the control owner, and its status. A finding is
-- a proposal; the person accepts, edits, dismisses, sends, resolves. It is pinned to the
-- plan revision and the file's hash, and marked stale when either changes.
--
-- evidence_finding_events is the finding's history, append-only: every proposal,
-- decision, send, reply, reassessment and stale mark, with who did it and what it points
-- at. Nothing closes a finding without a person: an agent or the system only proposes
-- (ANSWERED).
--
-- Rollback: DROP TABLE evidence_finding_events; DROP TABLE evidence_findings; delete the
-- '0137_evidence_findings' row from schema_migrations.

CREATE TABLE evidence_findings (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    evidence_file_id uuid REFERENCES evidence_files (id) ON DELETE RESTRICT,
    analysis_id uuid REFERENCES evidence_analyses (id) ON DELETE RESTRICT,
    mapping_run_id uuid REFERENCES evidence_mapping_runs (id) ON DELETE RESTRICT,
    requirement_id uuid REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    pbc_request_id uuid REFERENCES pbc_requests (id) ON DELETE RESTRICT,
    attribute_index integer,
    -- The approved attribute itself (control_attributes) and its code, resolved when the
    -- finding is recorded; the index is the mapping's position, kept for the record.
    attribute_id uuid REFERENCES control_attributes (id) ON DELETE RESTRICT,
    attribute_code text NOT NULL DEFAULT '',
    source text NOT NULL,
    kind text NOT NULL,
    -- The same finding from the same record is never recorded twice.
    fingerprint text NOT NULL,
    title text NOT NULL,
    observation text NOT NULL DEFAULT '',
    question text NOT NULL DEFAULT '',
    expected text NOT NULL DEFAULT '',
    citation jsonb,
    plan_revision integer,
    file_sha256 text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'PROPOSED',
    stale boolean NOT NULL DEFAULT false,
    stale_reason text NOT NULL DEFAULT '',
    sent_message_id uuid REFERENCES request_messages (id) ON DELETE RESTRICT,
    answered_by_message_id uuid REFERENCES request_messages (id) ON DELETE RESTRICT,
    answered_by_file_id uuid REFERENCES evidence_files (id) ON DELETE RESTRICT,
    decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    decided_at timestamptz,
    decision_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT evidence_findings_source CHECK (source IN ('READER', 'RULES', 'MAPPING')),
    CONSTRAINT evidence_findings_kind CHECK (
        kind IN (
            'GAP', 'PARTIAL', 'NOT_COVERED', 'PLACEHOLDER', 'VERSION', 'PERIOD',
            'MISSING', 'CONFLICT', 'CONCERN'
        )
    ),
    CONSTRAINT evidence_findings_status CHECK (
        status IN (
            'PROPOSED', 'ACCEPTED', 'DISMISSED', 'SENT', 'ANSWERED', 'RESOLVED',
            'CLARIFICATION_ACCEPTED', 'MORE_NEEDED', 'NOT_APPLICABLE', 'ESCALATED'
        )
    ),
    CONSTRAINT evidence_findings_fingerprint CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_findings_text CHECK (
        char_length(btrim(title)) BETWEEN 3 AND 200
        AND char_length(observation) <= 1000
        AND char_length(question) <= 1000
        AND char_length(expected) <= 300
        AND char_length(attribute_code) <= 20
        AND char_length(stale_reason) <= 300
        AND char_length(decision_note) <= 1000
    ),
    CONSTRAINT evidence_findings_citation CHECK (
        citation IS NULL OR jsonb_typeof(citation) = 'object'
    ),
    CONSTRAINT evidence_findings_hash CHECK (file_sha256 = '' OR file_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_findings_origin CHECK (
        (source = 'MAPPING') = (mapping_run_id IS NOT NULL)
        AND (source <> 'MAPPING') = (analysis_id IS NOT NULL)
    ),
    -- A sent finding names its message; a person's decision names who made it.
    CONSTRAINT evidence_findings_sent CHECK (status <> 'SENT' OR sent_message_id IS NOT NULL),
    CONSTRAINT evidence_findings_decided CHECK (
        (decided_by IS NULL) = (decided_at IS NULL)
        AND (status IN ('PROPOSED', 'ANSWERED') OR decided_by IS NOT NULL)
    ),
    CONSTRAINT evidence_findings_version CHECK (version >= 1),
    CONSTRAINT evidence_findings_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_findings_control_fk
        FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_findings_once UNIQUE (engagement_control_id, fingerprint)
);

CREATE INDEX evidence_findings_control_idx
    ON evidence_findings (engagement_control_id, status, created_at DESC);
CREATE INDEX evidence_findings_file_idx ON evidence_findings (evidence_file_id);
CREATE INDEX evidence_findings_request_idx ON evidence_findings (pbc_request_id);

CREATE TRIGGER evidence_findings_touch
BEFORE UPDATE ON evidence_findings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE evidence_finding_events (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    finding_id uuid NOT NULL REFERENCES evidence_findings (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    event text NOT NULL,
    actor_kind text NOT NULL,
    actor_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
    status_before text NOT NULL,
    status_after text NOT NULL,
    note text NOT NULL DEFAULT '',
    question text NOT NULL DEFAULT '',
    -- What the event points at: {message_id}, {file_id}, {analysis_id}, {plan_revision}.
    points_at jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_finding_events_event CHECK (
        event IN (
            'PROPOSED', 'ACCEPTED', 'EDITED', 'DISMISSED', 'SENT', 'REPLIED', 'REASSESSED',
            'RESOLVED', 'CLARIFICATION_ACCEPTED', 'MORE_NEEDED', 'NOT_APPLICABLE',
            'ESCALATED', 'STALE', 'REOPENED'
        )
    ),
    CONSTRAINT evidence_finding_events_actor CHECK (
        actor_kind IN ('PERSON', 'AGENT', 'SYSTEM')
        AND (actor_kind <> 'PERSON' OR actor_user_id IS NOT NULL)
    ),
    CONSTRAINT evidence_finding_events_text CHECK (
        char_length(note) <= 1000 AND char_length(question) <= 1000
    ),
    CONSTRAINT evidence_finding_events_points CHECK (jsonb_typeof(points_at) = 'object'),
    CONSTRAINT evidence_finding_events_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_finding_events_finding_idx
    ON evidence_finding_events (finding_id, created_at);

CREATE FUNCTION prevent_evidence_finding_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'evidence finding history is never changed';
END;
$$;

CREATE TRIGGER evidence_finding_events_immutable
BEFORE UPDATE OR DELETE ON evidence_finding_events
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_finding_event_mutation();

-- Findings are not deleted: a dismissed one stays on record with its history.
CREATE FUNCTION prevent_evidence_finding_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'an evidence finding is dismissed, never deleted';
END;
$$;

CREATE TRIGGER evidence_findings_kept
BEFORE DELETE ON evidence_findings
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_finding_deletion();

-- An archived engagement's findings are read-only (migration 0136).
CREATE TRIGGER evidence_findings_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_findings
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

CREATE TRIGGER evidence_finding_events_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_finding_events
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
