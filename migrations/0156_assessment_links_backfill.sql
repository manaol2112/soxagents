-- The evidence assurance chain after its second independent review (12 November 2026;
-- docs/evidence-assurance.md).
--
-- 1. What other requests ask for. A run's basis now names the attributes another DESIGN
--    requirement of the control links too (elsewhere_attribute_ids): where one does, part
--    of an attribute shown by this request is partial support (the rest may be that
--    request's evidence); where none does, what is not shown is an issue. A change in
--    those links puts the run out of date.
-- 2. The start-up backfill's memory (evidence_assessment_backfill): for each DESIGN
--    requirement the backfill tried, the basis it tried it at, so a later pass does not
--    try a requirement again until what it would read has changed (a request whose files
--    are still being read, for instance). Bookkeeping only: it decides nothing.
--
-- Additive: one defaulted column and one table. Runs recorded before this migration have
-- no such links on record, so their basis no longer matches and they read as out of date
-- (as the prompt versions' change makes them anyway).
--
-- Rollback: DROP TABLE evidence_assessment_backfill; ALTER TABLE evidence_assessments
-- DROP COLUMN elsewhere_attribute_ids; delete the '0156_assessment_links_backfill' row from
-- schema_migrations.

ALTER TABLE evidence_assessments
    ADD COLUMN elsewhere_attribute_ids uuid[] NOT NULL DEFAULT '{}';

CREATE TABLE evidence_assessment_backfill (
    requirement_id uuid PRIMARY KEY REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    basis_sha256 text NOT NULL,
    tried_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_assessment_backfill_basis CHECK (basis_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_assessment_backfill_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- An archived engagement's records are read-only (migration 0136).
CREATE TRIGGER evidence_assessment_backfill_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_assessment_backfill
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
