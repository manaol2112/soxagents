-- Trial Management and Synthetic Demo Experience, Step 3: the per-firm demo record, the
-- demo marker on an engagement, and the trial's allowances leaving demo work out.
--
-- A demo engagement is the firm's own copy of a synthetic client (Northstar Technologies,
-- from Step 4), made for it by the server's demo initialization and nothing else: the
-- marker is set only inside that initialization (the transaction carries a setting the
-- route puts there) and never changes afterwards, so a name, a forged request body, or an
-- edit cannot turn a real engagement into a demo one, or a demo one into a real one. A
-- firm has at most one active demo engagement, whatever arrives together.
--
-- The demo record (organization_demos) is the firm's one demo lifecycle: not initialized,
-- initializing, ready, failed (retried from the same record), archived (a reset, Step 6;
-- at most three). Each person's answer to the first-login invitation is kept, so it is
-- asked once and can be changed later from the account menu.
--
-- Demo work is outside the trial's allowances (the owner's decision of 28 October 2026):
-- a demo engagement, its systems, controls and evidence files count for nothing here.

CREATE TYPE demo_state AS ENUM (
    'NOT_INITIALIZED', 'INITIALIZING', 'READY', 'FAILED', 'ARCHIVED'
);

ALTER TABLE projects ADD COLUMN demo boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX projects_one_active_demo
    ON projects (organization_id)
    WHERE demo AND deleted_at IS NULL AND status <> 'ARCHIVED';

CREATE FUNCTION guard_project_demo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.demo IS DISTINCT FROM OLD.demo THEN
            RAISE EXCEPTION 'an engagement''s demo marker never changes'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.demo
       AND coalesce(current_setting('aw.demo_initialization', true), '')
           <> NEW.organization_id::text THEN
        RAISE EXCEPTION 'a demo engagement is made only by demo initialization'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_demo_guard
    BEFORE INSERT OR UPDATE OF demo ON projects
    FOR EACH ROW
    EXECUTE FUNCTION guard_project_demo();

CREATE TABLE organization_demos (
    organization_id uuid PRIMARY KEY,
    state demo_state NOT NULL DEFAULT 'NOT_INITIALIZED',
    -- The versioned dataset it was made from (demo_datasets.py), '' until it is.
    dataset_key text NOT NULL DEFAULT '',
    project_id uuid,
    attempts integer NOT NULL DEFAULT 0,
    resets integer NOT NULL DEFAULT 0,
    failure text NOT NULL DEFAULT '',
    requested_by uuid,
    started_at timestamptz,
    ready_at timestamptz,
    failed_at timestamptz,
    archived_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organization_demos_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT organization_demos_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT organization_demos_requester_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT organization_demos_ready_has_project
        CHECK (state <> 'READY' OR project_id IS NOT NULL),
    CONSTRAINT organization_demos_counts
        CHECK (attempts >= 0 AND resets BETWEEN 0 AND 3 AND version >= 1),
    CONSTRAINT organization_demos_failure_length CHECK (char_length(failure) <= 500),
    CONSTRAINT organization_demos_dataset_key
        CHECK (dataset_key = '' OR dataset_key ~ '^[a-z0-9-]+/[0-9]+$')
);

CREATE TRIGGER organization_demos_updated_at
    BEFORE UPDATE ON organization_demos
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- The record points only at the firm's own demo engagement.
CREATE FUNCTION guard_demo_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.project_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM projects
        WHERE id = NEW.project_id AND organization_id = NEW.organization_id AND demo
    ) THEN
        RAISE EXCEPTION 'a demo record names a demo engagement of its own firm'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organization_demos_guard
    BEFORE INSERT OR UPDATE OF project_id ON organization_demos
    FOR EACH ROW
    EXECUTE FUNCTION guard_demo_record();

CREATE TABLE demo_invitation_responses (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    response text NOT NULL,
    responded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, user_id),
    CONSTRAINT demo_invitation_responses_response
        CHECK (response IN ('ACCEPTED', 'DISMISSED')),
    CONSTRAINT demo_invitation_responses_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT demo_invitation_responses_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- The trial's allowances leave demo work out (migration 0127 for the rest of each rule).

CREATE OR REPLACE FUNCTION enforce_trial_engagements()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
BEGIN
    IF NEW.demo THEN
        RETURN NEW;
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL OR sub.limit_engagements IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO used FROM projects
    WHERE organization_id = NEW.organization_id AND deleted_at IS NULL AND NOT demo;
    IF used >= sub.limit_engagements THEN
        PERFORM trial_limit_refused('engagements', used, sub.limit_engagements);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION is_demo_project(project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce((SELECT demo FROM projects WHERE id = project), false);
$$;

CREATE OR REPLACE FUNCTION enforce_trial_systems()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
BEGIN
    IF is_demo_project(NEW.project_id) THEN
        RETURN NEW;
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL OR sub.limit_systems IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO used
    FROM engagement_applications a
    JOIN projects p ON p.id = a.project_id
    WHERE a.organization_id = NEW.organization_id AND p.deleted_at IS NULL AND NOT p.demo;
    IF used >= sub.limit_systems THEN
        PERFORM trial_limit_refused('systems', used, sub.limit_systems);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_trial_controls()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
BEGIN
    IF is_demo_project(NEW.project_id) THEN
        RETURN NEW;
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL OR sub.limit_controls IS NULL THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM engagement_controls
        WHERE project_id = NEW.project_id AND control_ref = NEW.control_ref
    ) THEN
        RETURN NEW;
    END IF;
    SELECT count(DISTINCT control_ref) INTO used
    FROM engagement_controls WHERE project_id = NEW.project_id;
    IF used >= sub.limit_controls THEN
        PERFORM trial_limit_refused('controls', used, sub.limit_controls);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_trial_uploads()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
    used_bytes bigint;
BEGIN
    -- Evidence also arrives without a session (the client's portal, the mailbox): an
    -- inactive subscription takes no more of it, for a demo engagement too.
    IF NOT subscription_writable(NEW.organization_id) THEN
        PERFORM trial_limit_refused('subscription', 0, 0);
    END IF;
    IF is_demo_project(NEW.project_id) THEN
        RETURN NEW;
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*), coalesce(sum(f.size_bytes), 0) INTO used, used_bytes
    FROM evidence_files f
    JOIN projects p ON p.id = f.project_id
    WHERE f.organization_id = NEW.organization_id AND NOT p.demo;
    IF sub.limit_uploads IS NOT NULL AND used >= sub.limit_uploads THEN
        PERFORM trial_limit_refused('uploads', used, sub.limit_uploads);
    END IF;
    IF sub.limit_upload_bytes IS NOT NULL AND used_bytes + NEW.size_bytes > sub.limit_upload_bytes THEN
        PERFORM trial_limit_refused('storage', used_bytes + NEW.size_bytes, sub.limit_upload_bytes);
    END IF;
    RETURN NEW;
END;
$$;
