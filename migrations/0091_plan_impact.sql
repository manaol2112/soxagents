-- Sign-off history and plan-revision impact assessments (workflow integrity W3, decided
-- by the product owner).
--
-- 1. test_sheet_signoffs: every sign-off of a test sheet, kept as it was made: who, when,
--    the conclusion, the sheet's version, the plan revision the results were tested
--    under. Reopening the sheet marks the row once (reopened_*); nothing else on it ever
--    changes, and no row is deleted (enforced by trigger). Until now the sheet row lost
--    its sign-off when reopened and only the audit log kept it.
-- 2. control_review_signoffs: the same for independent reviews, with what they covered.
-- 3. plan_impact_assessments: when the approved test plan changes after results were
--    signed off (or the revision they were tested under is unknown), one assessment per
--    sign-off and revision. The agent may recommend, with its rationale; only an
--    independent reviewer decides VALID or REPERFORM, and nothing is valid by default.
--
-- Backfill: a sign-off row for every sheet and review signed off today (their plan
-- revision stays unknown where it was never stamped: an assessment, never assumed
-- valid). Assessments themselves are created by the application (plan_impact.detect).
--
-- Rollback: drop the three tables and the two trigger functions, and delete the
-- '0091_plan_impact' row from schema_migrations.

CREATE TABLE test_sheet_signoffs (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    test_sheet_id uuid NOT NULL REFERENCES test_sheets (id) ON DELETE RESTRICT,
    engagement_control_id uuid NOT NULL,
    test_round_id uuid REFERENCES test_rounds (id) ON DELETE RESTRICT,
    sheet_version integer NOT NULL,
    conclusion text NOT NULL,
    signed_by uuid NOT NULL REFERENCES users (id),
    signed_at timestamptz NOT NULL,
    signoff_note text NOT NULL DEFAULT '',
    plan_revision integer,
    -- Set once, when the sheet is opened again; the sign-off itself is never changed.
    reopened_at timestamptz,
    reopened_by uuid REFERENCES users (id),
    reopen_reason text NOT NULL DEFAULT '',
    reopened_from text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT test_sheet_signoffs_reopened_from CHECK (
        reopened_from IS NULL
        OR reopened_from IN ('REVIEW_NOTE', 'IMPACT_ASSESSMENT', 'PERSON')
    ),
    CONSTRAINT test_sheet_signoffs_reopened_together CHECK (
        (reopened_at IS NULL) = (reopened_from IS NULL)
    )
);

CREATE INDEX test_sheet_signoffs_sheet_idx ON test_sheet_signoffs (test_sheet_id, signed_at DESC);
CREATE INDEX test_sheet_signoffs_project_idx ON test_sheet_signoffs (project_id, engagement_control_id);

CREATE TABLE control_review_signoffs (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    control_review_id uuid NOT NULL REFERENCES control_reviews (id) ON DELETE RESTRICT,
    engagement_control_id uuid NOT NULL,
    test_round_id uuid REFERENCES test_rounds (id) ON DELETE RESTRICT,
    review_version integer NOT NULL,
    signed_by uuid NOT NULL REFERENCES users (id),
    signed_at timestamptz NOT NULL,
    signoff_note text NOT NULL DEFAULT '',
    coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
    reopened_at timestamptz,
    reopened_by uuid REFERENCES users (id),
    reopen_reason text NOT NULL DEFAULT '',
    reopened_from text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_review_signoffs_reopened_from CHECK (
        reopened_from IS NULL
        OR reopened_from IN ('REVIEW_NOTE', 'IMPACT_ASSESSMENT', 'PERSON', 'LATER_WORK')
    ),
    CONSTRAINT control_review_signoffs_reopened_together CHECK (
        (reopened_at IS NULL) = (reopened_from IS NULL)
    )
);

CREATE INDEX control_review_signoffs_review_idx
    ON control_review_signoffs (control_review_id, signed_at DESC);

-- A recorded sign-off is never deleted, and only its reopening is ever written, once.
CREATE OR REPLACE FUNCTION signoff_history_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'sign-off history is never deleted (%)', TG_TABLE_NAME;
    END IF;
    IF NEW.signed_by IS DISTINCT FROM OLD.signed_by
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.signoff_note IS DISTINCT FROM OLD.signoff_note
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
       OR NEW.test_round_id IS DISTINCT FROM OLD.test_round_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'a recorded sign-off is never changed (%)', TG_TABLE_NAME;
    END IF;
    IF OLD.reopened_at IS NOT NULL AND (
        NEW.reopened_at IS DISTINCT FROM OLD.reopened_at
        OR NEW.reopened_by IS DISTINCT FROM OLD.reopened_by
        OR NEW.reopen_reason IS DISTINCT FROM OLD.reopen_reason
        OR NEW.reopened_from IS DISTINCT FROM OLD.reopened_from
    ) THEN
        RAISE EXCEPTION 'a sign-off is reopened once; its reopening is never changed (%)',
            TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION test_sheet_signoffs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW.test_sheet_id IS DISTINCT FROM OLD.test_sheet_id
        OR NEW.sheet_version IS DISTINCT FROM OLD.sheet_version
        OR NEW.conclusion IS DISTINCT FROM OLD.conclusion
        OR NEW.plan_revision IS DISTINCT FROM OLD.plan_revision
    ) THEN
        RAISE EXCEPTION 'a recorded sign-off is never changed (test_sheet_signoffs)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION control_review_signoffs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW.control_review_id IS DISTINCT FROM OLD.control_review_id
        OR NEW.review_version IS DISTINCT FROM OLD.review_version
        OR NEW.coverage IS DISTINCT FROM OLD.coverage
    ) THEN
        RAISE EXCEPTION 'a recorded sign-off is never changed (control_review_signoffs)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER test_sheet_signoffs_keep BEFORE UPDATE OR DELETE ON test_sheet_signoffs
    FOR EACH ROW EXECUTE FUNCTION signoff_history_immutable();
CREATE TRIGGER test_sheet_signoffs_keep_fields BEFORE UPDATE ON test_sheet_signoffs
    FOR EACH ROW EXECUTE FUNCTION test_sheet_signoffs_immutable();
CREATE TRIGGER control_review_signoffs_keep BEFORE UPDATE OR DELETE ON control_review_signoffs
    FOR EACH ROW EXECUTE FUNCTION signoff_history_immutable();
CREATE TRIGGER control_review_signoffs_keep_fields BEFORE UPDATE ON control_review_signoffs
    FOR EACH ROW EXECUTE FUNCTION control_review_signoffs_immutable();

CREATE TABLE plan_impact_assessments (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    test_sheet_id uuid NOT NULL REFERENCES test_sheets (id) ON DELETE RESTRICT,
    test_round_id uuid REFERENCES test_rounds (id) ON DELETE RESTRICT,
    signoff_id uuid NOT NULL REFERENCES test_sheet_signoffs (id) ON DELETE RESTRICT,
    -- The plan revision the results were tested under; NULL when it was never recorded.
    from_revision integer,
    -- The plan revision the results are assessed against.
    to_revision integer NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    -- The agent's recommendation with its rationale, never a decision:
    -- {"decision": "VALID" | "REPERFORM" | null, "rationale": "...", "changes": [...],
    --  "by": "RULES", "at": "..."}.
    recommendation jsonb NOT NULL DEFAULT '{}'::jsonb,
    decided_by uuid REFERENCES users (id),
    decided_at timestamptz,
    rationale text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT plan_impact_status CHECK (
        status IN ('PENDING', 'VALID', 'REPERFORM', 'SUPERSEDED')
    ),
    CONSTRAINT plan_impact_decided CHECK (
        (status IN ('VALID', 'REPERFORM')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
    CONSTRAINT plan_impact_rationale CHECK (
        status NOT IN ('VALID', 'REPERFORM') OR char_length(rationale) >= 3
    ),
    CONSTRAINT plan_impact_one_per_revision UNIQUE (signoff_id, to_revision)
);

CREATE INDEX plan_impact_project_idx ON plan_impact_assessments (project_id, status);

-- The sign-offs recorded today, as they stand on the sheets and reviews.
INSERT INTO test_sheet_signoffs (
    organization_id, project_id, test_sheet_id, engagement_control_id, test_round_id,
    sheet_version, conclusion, signed_by, signed_at, signoff_note, plan_revision
)
SELECT organization_id, project_id, id, engagement_control_id, test_round_id, version,
       conclusion, signed_by, signed_at, signoff_note, plan_revision
FROM test_sheets
WHERE status = 'SIGNED_OFF' AND signed_by IS NOT NULL AND signed_at IS NOT NULL
  AND conclusion IS NOT NULL;

INSERT INTO control_review_signoffs (
    organization_id, project_id, control_review_id, engagement_control_id, test_round_id,
    review_version, signed_by, signed_at, signoff_note, coverage
)
SELECT organization_id, project_id, id, engagement_control_id, test_round_id, version,
       signed_by, signed_at, signoff_note, coverage
FROM control_reviews
WHERE status = 'SIGNED_OFF' AND signed_by IS NOT NULL AND signed_at IS NOT NULL;
