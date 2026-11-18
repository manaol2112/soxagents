-- Completing and deleting engagements (Milestone 8.14).
--
-- Completed: an active or paused engagement whose work is done is completed. It is read
-- only. An owner or admin can reopen it with a reason; each reopening is kept. It can be
-- archived from there.
--
-- Deleted: a draft that never launched can be deleted by an owner or admin. Its setup is
-- removed. The row stays as a hidden placeholder so the audit trail, which never changes,
-- still points at something; it holds no setup and does not change again.
--
-- The migration runner applies pending migrations in one transaction, and a new enum
-- value cannot be used in the transaction that adds it. So every rule that names
-- COMPLETED lives in the trigger functions, which run only after the commit.

ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TABLE projects
    ADD COLUMN completed_at timestamptz,
    ADD COLUMN completed_by uuid REFERENCES users (id),
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by uuid REFERENCES users (id),
    ADD CONSTRAINT projects_completed_by CHECK ((completed_at IS NULL) = (completed_by IS NULL)),
    ADD CONSTRAINT projects_deleted_by CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

CREATE TABLE engagement_reopenings (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    reason text NOT NULL,
    reopened_by uuid NOT NULL REFERENCES users (id),
    -- When the engagement had been completed, for the record of what was reopened.
    completed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_reopenings_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
    CONSTRAINT engagement_reopenings_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX engagement_reopenings_project ON engagement_reopenings (project_id, created_at);

CREATE FUNCTION engagement_reopenings_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'a reopening is kept as it was' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER engagement_reopenings_immutable
    BEFORE UPDATE OR DELETE ON engagement_reopenings
    FOR EACH ROW
    EXECUTE FUNCTION engagement_reopenings_immutable();

-- The lifecycle of migration 0067, with completion.
CREATE OR REPLACE FUNCTION guard_project_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;
    IF OLD.status::text = 'ARCHIVED' THEN
        RAISE EXCEPTION 'an archived engagement does not reopen'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status::text = 'DRAFT' AND NEW.status::text IN ('ACTIVE', 'PAUSED') AND NOT EXISTS (
        SELECT 1 FROM engagement_settings
        WHERE project_id = NEW.id AND kicked_off_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'a draft engagement becomes active only by launching it'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status::text = 'COMPLETED' AND (
        OLD.status::text NOT IN ('ACTIVE', 'PAUSED') OR NEW.completed_at IS NULL
    ) THEN
        RAISE EXCEPTION 'only a running engagement is completed, and its completion is recorded'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status::text = 'COMPLETED' AND NEW.status::text NOT IN ('ACTIVE', 'ARCHIVED') THEN
        RAISE EXCEPTION 'a completed engagement is reopened or archived'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status::text = 'COMPLETED' AND NEW.status::text = 'ACTIVE' AND NOT EXISTS (
        SELECT 1 FROM engagement_reopenings
        WHERE project_id = NEW.id AND completed_at = OLD.completed_at
    ) THEN
        RAISE EXCEPTION 'a completed engagement is reopened with a reason'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- A deleted engagement does not change again; only a draft that never launched is
-- deleted, and it keeps no scope text.
CREATE FUNCTION guard_project_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'a deleted engagement does not change'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.deleted_at IS NOT NULL THEN
        IF OLD.status::text NOT IN ('DRAFT', 'ARCHIVED') OR NEW.status <> OLD.status THEN
            RAISE EXCEPTION 'only a draft that never launched is deleted'
                USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (
            SELECT 1 FROM engagement_settings
            WHERE project_id = NEW.id AND kicked_off_at IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'a launched engagement is not deleted'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.scope <> '' THEN
            RAISE EXCEPTION 'a deleted engagement keeps no scope'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_deletion
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION guard_project_deletion();

CREATE INDEX projects_live ON projects (organization_id) WHERE deleted_at IS NULL;
