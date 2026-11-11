-- The firm's testing methodology, versioned (decided by the product owner on 8 November 2026):
-- one methodology per firm, in numbered versions. Version 1 is the platform's default, today's
-- rules, labelled as not approved by the firm. An Owner or Admin proposes a new version and a
-- different Owner or Admin approves it; no one approves their own change. Each engagement
-- keeps the version it launched on, and moving a running engagement to another version is a
-- recorded decision with a reason. Each test sheet and round records the version that sized it.
--
-- A version's rules never change once written: a change is a new version.
--
-- Rollback: ALTER TABLE test_rounds DROP COLUMN methodology_version_id; ALTER TABLE
-- control_tests DROP COLUMN methodology_version_id; ALTER TABLE projects DROP COLUMN
-- methodology_version_id; DROP TABLE methodology_versions; DROP FUNCTION
-- methodology_versions_frozen(), projects_methodology_tenant(); delete the
-- '0142_testing_methodology' row from schema_migrations.

CREATE TABLE methodology_versions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    number integer NOT NULL,
    status text NOT NULL,
    rules jsonb NOT NULL,
    -- Why the firm changed it, and the methodology document it rests on.
    rationale text NOT NULL DEFAULT '',
    based_on uuid REFERENCES methodology_versions (id) ON DELETE RESTRICT,
    proposed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    proposed_at timestamptz,
    decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    decided_at timestamptz,
    decision_note text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT methodology_versions_number UNIQUE (organization_id, number),
    CONSTRAINT methodology_versions_number_positive CHECK (number >= 1),
    CONSTRAINT methodology_versions_status CHECK (
        status IN ('PLATFORM_DEFAULT', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')
    ),
    CONSTRAINT methodology_versions_rules CHECK (jsonb_typeof(rules) = 'object'),
    CONSTRAINT methodology_versions_text CHECK (
        char_length(rationale) <= 2000 AND char_length(decision_note) <= 1000
    ),
    -- The default is the platform's, proposed by no one; every other version was proposed.
    CONSTRAINT methodology_versions_proposed CHECK (
        (status = 'PLATFORM_DEFAULT') = (proposed_by IS NULL)
        AND (proposed_by IS NULL) = (proposed_at IS NULL)
    ),
    -- Approved, rejected, and withdrawn versions say who decided and when.
    CONSTRAINT methodology_versions_decided CHECK (
        (status IN ('APPROVED', 'REJECTED', 'WITHDRAWN'))
            = (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
    CONSTRAINT methodology_versions_version_positive CHECK (version >= 1)
);

-- One default and one proposal waiting at a time, per firm.
CREATE UNIQUE INDEX methodology_versions_one_default
    ON methodology_versions (organization_id) WHERE status = 'PLATFORM_DEFAULT';
CREATE UNIQUE INDEX methodology_versions_one_pending
    ON methodology_versions (organization_id) WHERE status = 'PENDING';

-- The rules a version was written with stay as written, and a decided version stays decided.
CREATE FUNCTION methodology_versions_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.rules IS DISTINCT FROM OLD.rules OR NEW.number <> OLD.number
       OR NEW.organization_id <> OLD.organization_id THEN
        RAISE EXCEPTION 'a methodology version''s rules cannot change'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'PENDING' AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'a decided methodology version cannot change'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER methodology_versions_frozen
    BEFORE UPDATE ON methodology_versions
    FOR EACH ROW EXECUTE FUNCTION methodology_versions_frozen();

ALTER TABLE projects
    ADD COLUMN methodology_version_id uuid REFERENCES methodology_versions (id) ON DELETE RESTRICT;
ALTER TABLE control_tests
    ADD COLUMN methodology_version_id uuid REFERENCES methodology_versions (id) ON DELETE RESTRICT;
ALTER TABLE test_rounds
    ADD COLUMN methodology_version_id uuid REFERENCES methodology_versions (id) ON DELETE RESTRICT;

-- An engagement follows its own firm's methodology, never another's.
CREATE FUNCTION projects_methodology_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.methodology_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM methodology_versions v
        WHERE v.id = NEW.methodology_version_id AND v.organization_id = NEW.organization_id
          AND v.status IN ('PLATFORM_DEFAULT', 'APPROVED')
    ) THEN
        RAISE EXCEPTION 'an engagement follows an approved version of its own firm''s methodology'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_methodology_tenant
    BEFORE INSERT OR UPDATE OF methodology_version_id ON projects
    FOR EACH ROW EXECUTE FUNCTION projects_methodology_tenant();
