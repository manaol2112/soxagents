-- Phase-based release (master test plans, milestone E). Every phase's evidence is planned
-- and drafted in advance; a person releases each operating phase for a control before its
-- requests can be approved or sent. Decided by the product owner: interim is released once
-- design and implementation testing is complete (the design workpaper prepared), and the
-- roll-forward once interim testing is (its sheet signed off), or where interim does not
-- apply, once design is; a reviewer may release a phase earlier for one control, with the
-- reason recorded. Design needs no release: its requests follow the plan's approval.
--
-- Rollback: drop the table phase_releases and delete the '0081_phase_releases' row from
-- schema_migrations.

CREATE TABLE phase_releases (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    phase text NOT NULL,
    -- Released before the earlier phase was complete: a reviewer's decision, with why.
    early boolean NOT NULL DEFAULT false,
    reason text NOT NULL DEFAULT '',
    -- The test plan revision the release was made under.
    plan_revision integer,
    -- Null only for the releases this migration records for phases already under way.
    released_by uuid REFERENCES users (id),
    released_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT phase_releases_phase CHECK (phase IN ('INTERIM', 'ROLLFORWARD')),
    CONSTRAINT phase_releases_reason CHECK (
        char_length(reason) <= 1000 AND (NOT early OR char_length(btrim(reason)) >= 20)
    ),
    CONSTRAINT phase_releases_one UNIQUE (engagement_control_id, phase),
    CONSTRAINT phase_releases_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT phase_releases_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX phase_releases_project_idx ON phase_releases (project_id, phase);

CREATE TRIGGER phase_releases_immutable
    BEFORE UPDATE OR DELETE ON phase_releases
    FOR EACH ROW EXECUTE FUNCTION reject_plan_record_change();

-- A phase whose requests already went to the client, or whose testing started, is under
-- way: it is recorded as released, so nothing in flight is held.
INSERT INTO phase_releases (
    organization_id, project_id, engagement_control_id, phase, reason, released_at
)
SELECT DISTINCT ON (r.engagement_control_id, r.testing_phase)
       r.organization_id, r.project_id, r.engagement_control_id, r.testing_phase,
       'Under way before phases were released (migration 0081).', r.created_at
FROM pbc_requests r
WHERE r.engagement_control_id IS NOT NULL
  AND r.testing_phase IN ('INTERIM', 'ROLLFORWARD')
  AND r.status NOT IN ('DRAFT', 'APPROVAL_PENDING', 'CANCELLED')
ORDER BY r.engagement_control_id, r.testing_phase, r.created_at
ON CONFLICT DO NOTHING;

INSERT INTO phase_releases (
    organization_id, project_id, engagement_control_id, phase, reason, released_at
)
SELECT s.organization_id, s.project_id, s.engagement_control_id, 'INTERIM',
       'Under way before phases were released (migration 0081).', s.created_at
FROM test_sheets s
WHERE s.test_round_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO phase_releases (
    organization_id, project_id, engagement_control_id, phase, reason, released_at
)
SELECT DISTINCT ON (t.engagement_control_id)
       t.organization_id, t.project_id, t.engagement_control_id, 'ROLLFORWARD',
       'Under way before phases were released (migration 0081).', t.created_at
FROM test_rounds t
WHERE t.kind = 'ROLLFORWARD' AND t.status <> 'CANCELLED'
ORDER BY t.engagement_control_id, t.created_at
ON CONFLICT DO NOTHING;
