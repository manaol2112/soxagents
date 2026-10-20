-- Historical review coverage assessments (workflow integrity W3 follow-up, decided by
-- the product owner). A signed review stands only for the sheet version and workpaper
-- versions it recorded; where coverage is unknown (a review signed before coverage was
-- recorded) or the work changed since, a qualified independent reviewer may assess and
-- document that the historical review covers the current versions, or that a review is
-- required, without re-performing the testing. The original review and its sign-off
-- record are untouched; each assessment is kept as made (no update, no delete).
--
-- Rollback: drop the table and the trigger function, and delete the
-- '0092_review_coverage_assessments' row from schema_migrations.

CREATE TABLE review_coverage_assessments (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    control_review_id uuid NOT NULL REFERENCES control_reviews (id) ON DELETE RESTRICT,
    engagement_control_id uuid NOT NULL,
    test_round_id uuid REFERENCES test_rounds (id) ON DELETE RESTRICT,
    -- The versions the assessment is about: the sheet's, and each prepared workpaper's
    -- by stage, as they stood when the reviewer decided.
    sheet_version integer NOT NULL,
    workpaper_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
    decision text NOT NULL,
    rationale text NOT NULL,
    decided_by uuid NOT NULL REFERENCES users (id),
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT review_coverage_decision CHECK (decision IN ('COVERS', 'REQUIRES_REVIEW')),
    CONSTRAINT review_coverage_rationale CHECK (char_length(rationale) BETWEEN 3 AND 2000),
    CONSTRAINT review_coverage_versions CHECK (jsonb_typeof(workpaper_versions) = 'object')
);

CREATE INDEX review_coverage_review_idx
    ON review_coverage_assessments (control_review_id, decided_at DESC);

CREATE OR REPLACE FUNCTION review_coverage_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'a coverage assessment is never changed or deleted';
END;
$$;

CREATE TRIGGER review_coverage_keep BEFORE UPDATE OR DELETE ON review_coverage_assessments
    FOR EACH ROW EXECUTE FUNCTION review_coverage_immutable();
