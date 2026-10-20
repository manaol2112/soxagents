-- Independent review of testing rounds (workflow integrity W2, decided by the product
-- owner). Until now one review per control (control_reviews_one_per_control) covered the
-- interim testing; a roll-forward, retest or remediation round signed off afterwards had
-- no review of its own, and an earlier review was read as covering it. From here:
--
-- 1. A review may belong to one round (test_round_id). The control keeps one review of
--    its own (test_round_id IS NULL); each round has at most one.
-- 2. A review records what it covered when it signed off (coverage): the sheet and its
--    version, the round, each workpaper and its version. A prior review stays valid for
--    what it covered and never covers later work.
--
-- Existing reviews are backfilled with the sheet version they already recorded and the
-- workpaper versions prepared before they signed. Rounds signed before this migration get
-- no review retroactively: they read as "independent review outstanding" until a reviewer
-- signs one (owner's decision 3).
--
-- Rollback: drop the two partial unique indexes, restore the UNIQUE constraint
-- control_reviews_one_per_control (project_id, engagement_control_id), drop the two
-- columns, and delete the '0090_round_reviews' row from schema_migrations.

ALTER TABLE control_reviews
    ADD COLUMN test_round_id uuid REFERENCES test_rounds (id) ON DELETE RESTRICT,
    ADD COLUMN coverage jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE control_reviews DROP CONSTRAINT control_reviews_one_per_control;

CREATE UNIQUE INDEX control_reviews_one_per_control
    ON control_reviews (project_id, engagement_control_id)
    WHERE test_round_id IS NULL;

CREATE UNIQUE INDEX control_reviews_one_per_round
    ON control_reviews (test_round_id)
    WHERE test_round_id IS NOT NULL;

ALTER TABLE control_reviews ADD CONSTRAINT control_reviews_coverage CHECK (
    jsonb_typeof(coverage) = 'object'
);

-- What each signed review covered, from the records it had: the control's interim sheet
-- at the version the re-performance read, and the workpapers prepared before it signed.
UPDATE control_reviews r
SET coverage = jsonb_build_object(
        'sheet_id', s.id,
        'sheet_version', coalesce(r.sheet_version_reviewed, s.version),
        'test_round_id', NULL,
        'workpapers', coalesce((
            SELECT jsonb_agg(jsonb_build_object('id', w.id, 'stage', w.stage,
                                                'version', w.prepared_version)
                             ORDER BY w.stage)
            FROM workpapers w
            WHERE w.engagement_control_id = r.engagement_control_id
              AND w.status = 'PREPARED' AND w.prepared_at <= r.signed_at
        ), '[]'::jsonb),
        'backfilled', true
    )
FROM test_sheets s
WHERE r.status = 'SIGNED_OFF' AND r.test_round_id IS NULL
  AND s.engagement_control_id = r.engagement_control_id AND s.test_round_id IS NULL;
