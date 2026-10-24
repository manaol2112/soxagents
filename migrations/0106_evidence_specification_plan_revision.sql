-- Release 2a: a specification records the plan revision it was computed from (decided by
-- the product owner, 24 October 2026; docs/release-2a.md).
--
-- Requests are generated and approved only from specifications computed against the
-- current, approved revision of their plan (consolidation.require_fresh); anything else
-- fails safely. Specifications computed before this migration have no revision and are
-- stale until the next analysis.
--
-- Rollback: ALTER TABLE evidence_specifications DROP COLUMN plan_revision; delete the
-- '0106_evidence_specification_plan_revision' row from schema_migrations.

ALTER TABLE evidence_specifications ADD COLUMN plan_revision integer;
ALTER TABLE evidence_specifications ADD CONSTRAINT evidence_specifications_plan_revision
    CHECK (plan_revision IS NULL OR plan_revision >= 0);
