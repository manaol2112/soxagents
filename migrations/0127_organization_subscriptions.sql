-- Subscriptions and the free trial (Trial Management and Synthetic Demo Experience, Step 2;
-- the product owner's decisions of 28 October 2026).
--
-- Every firm has one subscription row. A firm that signs itself up starts a 7-day trial
-- (fail closed: the row is created by a trigger, so no path can make a firm without one);
-- the firms that existed before this migration are backfilled explicitly as INTERNAL with
-- no limits, never as new trials. The trial's limits live on the row, set from the
-- deployment's settings when the trial starts, so one deployment can change them and one
-- firm can later be given more; NULL is no limit.
--
-- The trial's resource limits are enforced here, in BEFORE INSERT triggers, because
-- systems, controls, members and evidence files are each written by several code paths
-- (cloning onto a system, scope reconciliation, splits, roll-forward, the portal, the
-- mailbox). The limit is checked under a lock on the firm's subscription row, so two
-- requests arriving together cannot both pass. A refusal raises SQLSTATE AW402, which the
-- API answers as 402 with the resource named. Paid and internal firms are never counted.
--
-- The AI allowance is a ledger (model_call_reservations): the worst case of a call is
-- reserved before dispatch and settled to what it cost; a reservation that was never
-- settled stays counted at its worst case, so a crash never under-counts. The ledger is
-- never deleted and a settled row never changes again.

CREATE TYPE subscription_status AS ENUM (
    'TRIAL', 'TRIAL_EXPIRED', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED'
);

CREATE TABLE organization_subscriptions (
    organization_id uuid PRIMARY KEY,
    status subscription_status NOT NULL DEFAULT 'TRIAL',
    -- TRIAL: the free trial. PAID: a billed subscription (billing is a later milestone).
    -- INTERNAL: the platform's own and pre-existing firms, with no limits.
    plan_type text NOT NULL DEFAULT 'TRIAL',
    trial_started_at timestamptz,
    trial_expires_at timestamptz,
    -- Set once when the trial starts: this firm has had its trial and never gets another.
    trial_consumed_at timestamptz,
    subscription_started_at timestamptz,
    subscription_expires_at timestamptz,
    billing_customer_id text,
    billing_subscription_id text,
    -- The trial's allowances; NULL is no limit. The defaults are the owner's approved
    -- trial (1 engagement, 1 system, 5 controls, 1 user, 10 evidence files, 250 MB).
    limit_engagements integer DEFAULT 1,
    limit_systems integer DEFAULT 1,
    limit_controls integer DEFAULT 5,
    limit_members integer DEFAULT 1,
    limit_uploads integer DEFAULT 10,
    limit_upload_bytes bigint DEFAULT 250000000,
    -- The AI allowance for the whole trial: $5, 20 agent runs, one at a time, 10 minutes
    -- each. Cumulative, never renewed.
    ai_budget_micros bigint DEFAULT 5000000,
    ai_run_limit integer DEFAULT 20,
    ai_concurrent_runs integer DEFAULT 1,
    ai_run_seconds integer DEFAULT 600,
    status_reason text NOT NULL DEFAULT '',
    updated_by uuid,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organization_subscriptions_plan CHECK (plan_type IN ('TRIAL', 'PAID', 'INTERNAL')),
    CONSTRAINT organization_subscriptions_trial_dates CHECK (
        status NOT IN ('TRIAL', 'TRIAL_EXPIRED')
        OR (trial_started_at IS NOT NULL AND trial_expires_at > trial_started_at)
    ),
    CONSTRAINT organization_subscriptions_limits CHECK (
        coalesce(limit_engagements, 0) >= 0 AND coalesce(limit_systems, 0) >= 0
        AND coalesce(limit_controls, 0) >= 0 AND coalesce(limit_members, 0) >= 0
        AND coalesce(limit_uploads, 0) >= 0 AND coalesce(limit_upload_bytes, 0) >= 0
        AND coalesce(ai_budget_micros, 0) >= 0 AND coalesce(ai_run_limit, 0) >= 0
        AND coalesce(ai_concurrent_runs, 0) >= 0 AND coalesce(ai_run_seconds, 0) >= 0
    ),
    CONSTRAINT organization_subscriptions_version CHECK (version >= 1),
    CONSTRAINT organization_subscriptions_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT organization_subscriptions_actor_fk
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER organization_subscriptions_updated_at
    BEFORE UPDATE ON organization_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- A trial starts once. Its start never moves; its end moves only by a recorded decision.
CREATE FUNCTION guard_subscription_trial()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.trial_started_at IS NOT NULL AND NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at THEN
        RAISE EXCEPTION 'a trial does not start again' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.trial_consumed_at IS NOT NULL AND NEW.trial_consumed_at IS DISTINCT FROM OLD.trial_consumed_at THEN
        RAISE EXCEPTION 'a trial is consumed once' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.trial_expires_at IS DISTINCT FROM OLD.trial_expires_at
       AND OLD.trial_expires_at IS NOT NULL
       AND (btrim(NEW.status_reason) = '' OR NEW.updated_by IS NULL) THEN
        RAISE EXCEPTION 'a trial end changes only by a recorded decision'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organization_subscriptions_trial
    BEFORE UPDATE ON organization_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION guard_subscription_trial();

-- The subscription as it stands now: a trial past its end is TRIAL_EXPIRED whatever the
-- row says, computed from the server's clock. NULL when the firm has no row.
CREATE FUNCTION subscription_state(firm uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN s.status = 'TRIAL' AND s.trial_expires_at <= clock_timestamp() THEN 'TRIAL_EXPIRED'
        ELSE s.status::text
    END
    FROM organization_subscriptions s
    WHERE s.organization_id = firm
$$;

-- Whether the firm's members may change its records. An unknown firm may not.
CREATE FUNCTION subscription_writable(firm uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(subscription_state(firm) IN ('TRIAL', 'ACTIVE', 'PAST_DUE'), false)
$$;

-- Every new firm starts a trial unless the code that creates it says otherwise in the
-- same transaction (sign-up sets the deployment's trial length and limits; the preview
-- workspace is INTERNAL).
CREATE FUNCTION start_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    moment timestamptz := clock_timestamp();
BEGIN
    INSERT INTO organization_subscriptions (
        organization_id, status, plan_type, trial_started_at, trial_expires_at, trial_consumed_at
    )
    VALUES (NEW.id, 'TRIAL', 'TRIAL', moment, moment + interval '7 days', moment)
    ON CONFLICT (organization_id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- The firms that exist today are not new trials: they keep working without limits.
INSERT INTO organization_subscriptions (
    organization_id, status, plan_type, status_reason,
    limit_engagements, limit_systems, limit_controls, limit_members, limit_uploads,
    limit_upload_bytes, ai_budget_micros, ai_run_limit, ai_concurrent_runs, ai_run_seconds
)
SELECT id, 'ACTIVE', 'INTERNAL', 'existing firm at migration 0127: no trial',
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
FROM organizations;

INSERT INTO audit_events (organization_id, action, target_type, target_id, payload)
SELECT id, 'subscription.backfill', 'organization', id,
       jsonb_build_object('status', 'ACTIVE', 'plan_type', 'INTERNAL', 'migration', '0127')
FROM organizations;

CREATE TRIGGER organizations_subscription
    AFTER INSERT ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION start_subscription();

-- The trial's limits. Each trigger locks the firm's subscription row, counts what the
-- firm has, and refuses the row that would pass the limit. SQLSTATE AW402 is the API's
-- signal; the message names the resource and the detail carries used and allowed.
CREATE FUNCTION trial_limit_refused(resource text, used bigint, allowed bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'trial limit reached: %', resource
        USING ERRCODE = 'AW402', DETAIL = format('%s of %s', used, allowed);
END;
$$;

-- The firm's subscription row, locked, when the firm is on a trial; NULL for every other
-- firm (read without a lock first, so paid firms never queue on it). A firm without a row
-- is refused: no subscription means no allowance.
CREATE FUNCTION trial_subscription(firm uuid)
RETURNS organization_subscriptions
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
BEGIN
    SELECT * INTO sub FROM organization_subscriptions WHERE organization_id = firm;
    IF NOT FOUND THEN
        PERFORM trial_limit_refused('subscription', 0, 0);
    END IF;
    IF sub.plan_type <> 'TRIAL' THEN
        RETURN NULL;
    END IF;
    SELECT * INTO sub FROM organization_subscriptions WHERE organization_id = firm FOR UPDATE;
    RETURN sub;
END;
$$;

CREATE FUNCTION enforce_trial_engagements()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
BEGIN
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL OR sub.limit_engagements IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO used FROM projects
    WHERE organization_id = NEW.organization_id AND deleted_at IS NULL;
    IF used >= sub.limit_engagements THEN
        PERFORM trial_limit_refused('engagements', used, sub.limit_engagements);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_trial_limit
    BEFORE INSERT ON projects
    FOR EACH ROW
    EXECUTE FUNCTION enforce_trial_engagements();

CREATE FUNCTION enforce_trial_systems()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
BEGIN
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL OR sub.limit_systems IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO used
    FROM engagement_applications a
    JOIN projects p ON p.id = a.project_id
    WHERE a.organization_id = NEW.organization_id AND p.deleted_at IS NULL;
    IF used >= sub.limit_systems THEN
        PERFORM trial_limit_refused('systems', used, sub.limit_systems);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_applications_trial_limit
    BEFORE INSERT ON engagement_applications
    FOR EACH ROW
    EXECUTE FUNCTION enforce_trial_systems();

-- Controls are counted by family (distinct control_ref) within the engagement: the
-- instance of a control already in the engagement, cloned onto a system or split, is
-- not another control.
CREATE FUNCTION enforce_trial_controls()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
BEGIN
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

CREATE TRIGGER engagement_controls_trial_limit
    BEFORE INSERT ON engagement_controls
    FOR EACH ROW
    EXECUTE FUNCTION enforce_trial_controls();

CREATE FUNCTION enforce_trial_members()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
BEGIN
    IF NEW.status <> 'ACTIVE' OR (TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE') THEN
        RETURN NEW;
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL OR sub.limit_members IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO used FROM memberships
    WHERE organization_id = NEW.organization_id AND status = 'ACTIVE'
      AND (TG_OP = 'INSERT' OR id <> NEW.id);
    IF used >= sub.limit_members THEN
        PERFORM trial_limit_refused('members', used, sub.limit_members);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_trial_limit
    BEFORE INSERT OR UPDATE OF status ON memberships
    FOR EACH ROW
    EXECUTE FUNCTION enforce_trial_members();

CREATE FUNCTION enforce_trial_uploads()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
    used_bytes bigint;
BEGIN
    -- Evidence also arrives without a session (the client's portal, the mailbox): an
    -- inactive subscription takes no more of it.
    IF NOT subscription_writable(NEW.organization_id) THEN
        PERFORM trial_limit_refused('subscription', 0, 0);
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*), coalesce(sum(size_bytes), 0) INTO used, used_bytes
    FROM evidence_files WHERE organization_id = NEW.organization_id;
    IF sub.limit_uploads IS NOT NULL AND used >= sub.limit_uploads THEN
        PERFORM trial_limit_refused('uploads', used, sub.limit_uploads);
    END IF;
    IF sub.limit_upload_bytes IS NOT NULL AND used_bytes + NEW.size_bytes > sub.limit_upload_bytes THEN
        PERFORM trial_limit_refused('storage', used_bytes + NEW.size_bytes, sub.limit_upload_bytes);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_files_trial_limit
    BEFORE INSERT ON evidence_files
    FOR EACH ROW
    EXECUTE FUNCTION enforce_trial_uploads();

-- The AI allowance ledger. One row per model call a trial firm asks for: the worst case
-- reserved before dispatch, settled to the cost afterwards. The firm's spend is the sum
-- of settled costs plus every open reservation at its worst case.
CREATE TABLE model_call_reservations (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid,
    job_id uuid NOT NULL,
    agent_key text NOT NULL,
    estimate_micros bigint NOT NULL,
    settled_micros bigint,
    model_call_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    released_at timestamptz,
    CONSTRAINT model_call_reservations_estimate CHECK (estimate_micros >= 0),
    CONSTRAINT model_call_reservations_settled CHECK (settled_micros IS NULL OR settled_micros >= 0),
    CONSTRAINT model_call_reservations_release CHECK (
        (released_at IS NULL) = (settled_micros IS NULL)
    ),
    CONSTRAINT model_call_reservations_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT model_call_reservations_call_fk
        FOREIGN KEY (model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX model_call_reservations_firm
    ON model_call_reservations (organization_id, created_at);

CREATE INDEX model_call_reservations_jobs
    ON model_call_reservations (organization_id, job_id);

-- A reservation is settled once and never deleted: usage history is kept.
CREATE FUNCTION guard_model_call_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'model call reservations are never deleted'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.released_at IS NOT NULL THEN
        RAISE EXCEPTION 'a settled reservation does not change'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.organization_id <> OLD.organization_id OR NEW.job_id <> OLD.job_id
       OR NEW.estimate_micros <> OLD.estimate_micros OR NEW.created_at <> OLD.created_at
       OR NEW.agent_key <> OLD.agent_key OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'a reservation only settles' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER model_call_reservations_guard
    BEFORE UPDATE OR DELETE ON model_call_reservations
    FOR EACH ROW
    EXECUTE FUNCTION guard_model_call_reservation();
