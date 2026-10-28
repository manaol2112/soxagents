-- Removing and replacing a policy, a procedure, or a prior-year reference (decided by the
-- product owner on 25 October 2026). A removed document stops applying to every control and
-- leaves the lists, but stays on record with who removed it and when, so what the agents
-- quoted from it stays traceable. A replaced one is removed and names the version that
-- took its place.

ALTER TABLE source_documents
    ADD COLUMN removed_at timestamptz,
    ADD COLUMN removed_by uuid,
    ADD COLUMN replaced_by uuid REFERENCES source_documents (id),
    ADD CONSTRAINT source_documents_replaced CHECK (replaced_by IS NULL OR removed_at IS NOT NULL);

CREATE INDEX source_documents_current_idx
    ON source_documents (project_id, kind) WHERE removed_at IS NULL;
