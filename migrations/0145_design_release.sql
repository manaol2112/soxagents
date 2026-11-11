-- D&I evidence with its own approval (decided by the product owner on 8 November 2026;
-- docs/control-workflow-plan.md, B1).
--
-- Until now the Design phase's evidence followed the test plan's approval: its requests were
-- issued once the whole plan was approved, and any revision of the plan, for an operating
-- phase as much as for design, held them again. D&I evidence is now requested after Control
-- Understanding, with its own release: a person (Owner, Admin or Project Manager) releases
-- the Design phase's evidence items for the control. The test plan's approval gates only the
-- operating phases (interim and roll-forward). Each request still needs its own approval to
-- be sent; releasing never sends anything.
--
-- The release is a phase_releases row with phase DESIGN, like the interim and roll-forward
-- releases (migration 0081). It is recommended once Control Understanding is complete; a
-- person may release it before then, with the reason recorded.
--
-- Backfill: a control whose test plan a person has approved had its D&I evidence released by
-- that approval, and a control whose Design requests already went out is under way. Both are
-- recorded as released, so nothing in flight is held. The plan's approver is named where the
-- plan records one.
--
-- Rollback: DELETE FROM phase_releases WHERE phase = 'DESIGN' (the immutability trigger must
-- be disabled for it); restore the phase check to ('INTERIM', 'ROLLFORWARD'); delete the
-- '0145_design_release' row from schema_migrations.

ALTER TABLE phase_releases DROP CONSTRAINT phase_releases_phase;
ALTER TABLE phase_releases ADD CONSTRAINT phase_releases_phase
    CHECK (phase IN ('DESIGN', 'INTERIM', 'ROLLFORWARD'));

INSERT INTO phase_releases (
    organization_id, project_id, engagement_control_id, phase, reason, plan_revision,
    released_by, released_at
)
SELECT p.organization_id, p.project_id, p.engagement_control_id, 'DESIGN',
       'Released with the test plan''s approval, before D&I evidence had its own release '
       || '(migration 0145).',
       p.approved_revision, p.approved_by, coalesce(p.approved_at, p.created_at)
FROM evidence_plans p
WHERE p.approved_by IS NOT NULL OR p.status IN ('APPROVED', 'CHANGES_PROPOSED')
ON CONFLICT DO NOTHING;

INSERT INTO phase_releases (
    organization_id, project_id, engagement_control_id, phase, reason, released_at
)
SELECT DISTINCT ON (r.engagement_control_id)
       r.organization_id, r.project_id, r.engagement_control_id, 'DESIGN',
       'Under way before D&I evidence had its own release (migration 0145).', r.created_at
FROM pbc_requests r
WHERE r.engagement_control_id IS NOT NULL
  AND r.testing_phase = 'DESIGN'
  AND r.status NOT IN ('DRAFT', 'APPROVAL_PENDING', 'CANCELLED')
ORDER BY r.engagement_control_id, r.created_at
ON CONFLICT DO NOTHING;
