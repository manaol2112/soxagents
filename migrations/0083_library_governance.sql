-- Standard library governance (standard library, milestone L1). The library's content stays
-- in code (definition_registry.py, the statements, controls.py), version-controlled and
-- checked by tests; a firm records, per standard control, where its methodology review
-- stands and who approved it, and anyone in the firm may submit a change for review.
-- Decided by the product owner: code remains the source of truth; these tables hold the
-- status, the decisions, and the requests. A standard control with no row is pending
-- methodology review: the published definitions are a reviewer's draft until one approves
-- them. Deciding a change never edits the library; an accepted change is applied in code
-- and arrives with the next library version.
--
-- Rollback: drop the tables library_change_requests and library_entries and delete the
-- '0083_library_governance' row from schema_migrations.

CREATE TABLE library_entries (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
    library_key text NOT NULL,
    status text NOT NULL,
    -- The library version the status was decided on.
    library_version integer NOT NULL,
    note text NOT NULL DEFAULT '',
    decided_by uuid NOT NULL REFERENCES users (id),
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- The last approval, kept when the entry later moves on; an approval of an older
    -- library version reads as superseded.
    approved_by uuid REFERENCES users (id),
    approved_at timestamptz,
    approved_version integer,
    CONSTRAINT library_entries_key CHECK (library_key ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
    CONSTRAINT library_entries_status CHECK (
        status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'RETIRED')
    ),
    CONSTRAINT library_entries_note CHECK (char_length(note) <= 1000),
    CONSTRAINT library_entries_approval CHECK (
        status <> 'APPROVED'
        OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_version IS NOT NULL)
    ),
    CONSTRAINT library_entries_one UNIQUE (organization_id, library_key)
);

CREATE TABLE library_change_requests (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
    -- Null for a proposed new standard control.
    library_key text,
    kind text NOT NULL,
    title text NOT NULL,
    detail text NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    submitted_by uuid NOT NULL REFERENCES users (id),
    submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    decided_by uuid REFERENCES users (id),
    decided_at timestamptz,
    decision_note text NOT NULL DEFAULT '',
    CONSTRAINT library_change_requests_key CHECK (
        library_key IS NULL OR library_key ~ '^[a-z0-9][a-z0-9-]{1,59}$'
    ),
    CONSTRAINT library_change_requests_kind CHECK (kind IN ('CHANGE', 'NEW', 'RETIRE')),
    CONSTRAINT library_change_requests_key_for_kind CHECK ((kind = 'NEW') = (library_key IS NULL)),
    CONSTRAINT library_change_requests_title CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
    CONSTRAINT library_change_requests_detail CHECK (
        char_length(btrim(detail)) BETWEEN 20 AND 4000
    ),
    CONSTRAINT library_change_requests_status CHECK (status IN ('OPEN', 'ACCEPTED', 'DECLINED')),
    CONSTRAINT library_change_requests_decision CHECK (
        (status = 'OPEN') = (decided_by IS NULL AND decided_at IS NULL)
    ),
    CONSTRAINT library_change_requests_decision_note CHECK (char_length(decision_note) <= 1000)
);

CREATE INDEX library_change_requests_org_idx
    ON library_change_requests (organization_id, status, submitted_at);
