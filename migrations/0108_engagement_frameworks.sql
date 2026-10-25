-- The frameworks an engagement covers, chosen when it is created (decided by the product
-- owner, 24 October 2026): any mix of the standard library's categories. Setup's Controls
-- step opens with the areas of these frameworks selected; the controls themselves are
-- still loaded there, once the in-scope systems are known. NULL is an engagement created
-- before this choice existed, or one that made none: setup keeps its usual selection.
--
-- Rollback: ALTER TABLE engagement_settings DROP COLUMN frameworks; delete the
-- '0108_engagement_frameworks' row from schema_migrations.

ALTER TABLE engagement_settings ADD COLUMN frameworks text[];
ALTER TABLE engagement_settings ADD CONSTRAINT engagement_settings_frameworks
    CHECK (
        frameworks IS NULL
        OR (
            cardinality(frameworks) BETWEEN 1 AND 5
            AND frameworks <@ ARRAY['ITGC', 'ITAC', 'KEY_REPORT', 'BUSINESS', 'ENTITY']::text[]
        )
    );
