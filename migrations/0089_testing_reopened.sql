-- Testing reopened (workflow integrity W1, decided by the product owner): when a signed-off
-- test sheet is opened again, the sheet itself records why, by whom, when, and from what
-- (a review note that must be fixed, a plan-revision impact assessment, or a person), so
-- the register can read "Testing reopened" with the reason. Until now the reason lived
-- only in the audit log (testing.reopened). Sign-off clears the current reason; the audit
-- log keeps every past one.
--
-- Rollback: drop the five columns and the constraint, and delete the
-- '0089_testing_reopened' row from schema_migrations.

ALTER TABLE test_sheets
    ADD COLUMN reopened_at timestamptz,
    ADD COLUMN reopened_by uuid REFERENCES users (id),
    ADD COLUMN reopen_reason text NOT NULL DEFAULT '',
    ADD COLUMN reopened_from text,
    ADD COLUMN reopened_from_id uuid;

ALTER TABLE test_sheets ADD CONSTRAINT test_sheets_reopened_from CHECK (
    reopened_from IS NULL OR reopened_from IN ('REVIEW_NOTE', 'IMPACT_ASSESSMENT', 'PERSON')
);

ALTER TABLE test_sheets ADD CONSTRAINT test_sheets_reopened_together CHECK (
    (reopened_at IS NULL) = (reopened_from IS NULL)
);

ALTER TABLE test_sheets ADD CONSTRAINT test_sheets_reopen_reason CHECK (
    char_length(reopen_reason) <= 500
);
