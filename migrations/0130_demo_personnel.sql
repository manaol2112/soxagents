-- Trial Management and Synthetic Demo Experience, Step 4B: the demo's personnel, and the
-- SEEDED origin for prepared test criteria.
--
-- A firm's synthetic demo engagement has an audit team of its own: fictional people
-- (an engagement lead, an independent reviewer, a tester) whose names sign the prepared
-- plans, tests and reviews, so that the audit's own rules, reviewer independence above
-- all, hold on the demo as they hold everywhere. They are identities in name only:
--
-- - made only by demo initialization (the transaction carries aw.demo_initialization),
--   and only for that firm; the marker never changes;
-- - never able to sign in: no identity may be linked to them and no session may be
--   opened for them, whatever the login method;
-- - members of their own firm alone, on its demo engagements alone, and outside the
--   trial's member allowance (they are not the firm's people);
-- - never offered to a real engagement as a team member or an owner.
--
-- The application lists them with the demo engagement's team and nowhere else. Nothing
-- of a real person changes: every row that exists today has no demo marker.

ALTER TABLE users ADD COLUMN demo_organization_id uuid;
ALTER TABLE users
    ADD CONSTRAINT users_demo_organization_fk
        FOREIGN KEY (demo_organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
-- A demo identity has no login identity, ever: user_identities refuses one below.

CREATE INDEX users_demo_organization ON users (demo_organization_id)
    WHERE demo_organization_id IS NOT NULL;

CREATE FUNCTION is_demo_user(person uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce((SELECT demo_organization_id IS NOT NULL FROM users WHERE id = person), false);
$$;

CREATE FUNCTION guard_demo_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.demo_organization_id IS DISTINCT FROM OLD.demo_organization_id THEN
            RAISE EXCEPTION 'a demo identity''s marker never changes'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.demo_organization_id IS NOT NULL
       AND coalesce(current_setting('aw.demo_initialization', true), '')
           <> NEW.demo_organization_id::text THEN
        RAISE EXCEPTION 'a demo identity is made only by demo initialization'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_demo_guard
    BEFORE INSERT OR UPDATE OF demo_organization_id ON users
    FOR EACH ROW
    EXECUTE FUNCTION guard_demo_user();

-- No session and no login identity for a demo identity, by any path.
CREATE FUNCTION refuse_demo_sign_in()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF is_demo_user(NEW.user_id) THEN
        RAISE EXCEPTION 'a demo identity never signs in'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER auth_sessions_no_demo
    BEFORE INSERT ON auth_sessions
    FOR EACH ROW
    EXECUTE FUNCTION refuse_demo_sign_in();

CREATE TRIGGER user_identities_no_demo
    BEFORE INSERT OR UPDATE OF user_id ON user_identities
    FOR EACH ROW
    EXECUTE FUNCTION refuse_demo_sign_in();

-- A demo identity belongs to its own firm only, and joins its demo engagements only.
CREATE FUNCTION guard_demo_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    demo_firm uuid;
BEGIN
    SELECT demo_organization_id INTO demo_firm FROM users WHERE id = NEW.user_id;
    IF demo_firm IS NOT NULL AND demo_firm <> NEW.organization_id THEN
        RAISE EXCEPTION 'a demo identity belongs to its own firm only'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_demo_guard
    BEFORE INSERT OR UPDATE OF organization_id, user_id ON memberships
    FOR EACH ROW
    EXECUTE FUNCTION guard_demo_membership();

CREATE FUNCTION guard_demo_project_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF is_demo_user(NEW.user_id) AND NOT is_demo_project(NEW.project_id) THEN
        RAISE EXCEPTION 'a demo identity joins demo engagements only'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER project_memberships_demo_guard
    BEFORE INSERT OR UPDATE OF project_id, user_id ON project_memberships
    FOR EACH ROW
    EXECUTE FUNCTION guard_demo_project_membership();

-- The trial's member allowance counts the firm's people, not the demo's.
CREATE OR REPLACE FUNCTION enforce_trial_members()
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
    IF is_demo_user(NEW.user_id) THEN
        RETURN NEW;
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL OR sub.limit_members IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO used FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = NEW.organization_id AND m.status = 'ACTIVE'
      AND u.demo_organization_id IS NULL
      AND (TG_OP = 'INSERT' OR m.id <> NEW.id);
    IF used >= sub.limit_members THEN
        PERFORM trial_limit_refused('members', used, sub.limit_members);
    END IF;
    RETURN NEW;
END;
$$;

-- Prepared test criteria (Step 4B) say where they came from, as prepared outputs do.
ALTER TABLE control_attributes DROP CONSTRAINT control_attributes_criteria_origin;
ALTER TABLE control_attributes ADD CONSTRAINT control_attributes_criteria_origin CHECK (
    criteria_origin IS NULL OR criteria_origin IN ('PERSON', 'AGENT', 'SEEDED')
);
ALTER TABLE control_attributes DROP CONSTRAINT control_attributes_criteria_accepted;
ALTER TABLE control_attributes ADD CONSTRAINT control_attributes_criteria_accepted CHECK (
    (criteria_accepted_by IS NULL) = (criteria_accepted_at IS NULL)
    AND (criteria_accepted_by IS NULL OR criteria_origin IN ('AGENT', 'SEEDED'))
);
