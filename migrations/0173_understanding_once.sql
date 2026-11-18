-- The understanding is asked once; after it, the agents never send the person back
-- (docs/control-workflow-plan.md, B1j; agreed by the product owner on 16 November 2026 after a
-- prototype, with "On the attribute" for a gap an agent finds once the understanding is
-- finished).
--
-- 1. engagement_controls.understanding_completed_at: when the control's Control
--    Understanding was completed (the question pass ran and nothing in it was open, with no
--    agent run pending). Null until then. No backfill: a control is completed the next time
--    its understanding is found complete after a question pass, with no run pending. Once set
--    it is never cleared and never moved (the guard below): from then on no agent writes an
--    open question on the control.
--
-- 2. evidence_plans:
--      questions_checked_at  when the attribute agent's question pass last began (the
--                            ATTRIBUTES stage of an attribute run whose agent answered): it
--                            read every value and walkthrough answer confirmed before it;
--      run_codes             the attribute codes a queued run may change ('{}': any it may
--                            write), for the one update a changed assumption starts;
--      run_cause             what the run follows, as the history of the criteria it writes
--                            says it ("" when nothing in particular).
--
-- 3. control_attributes: who or what wrote the criteria as they read now, when, and why
--    (criteria_written_at, criteria_written_by, criteria_writer, criteria_cause). Written by
--    the trigger below only, from the session settings the server sets around the write
--    (app.criteria_by: the person; app.criteria_writer: the agent; app.criteria_cause: the
--    matter of the answer or assumption it follows). Null or "" for criteria written before
--    this migration.
--
-- 4. attribute_criteria_versions: every earlier version of an attribute's criteria. Every
--    UPDATE of control_attributes that changes condition, pass_criteria, fail_criteria,
--    judgment_required or criteria_origin keeps the criteria it replaces (when there were
--    any), whoever made the change: an agent, a person, the demo, the rules. A version is
--    written only by that trigger and never changed. It is removed only with its attribute
--    or its control, which happens only while an engagement is set up (a control taken off
--    the scope, an RCM loaded again, a draft that never launched deleted): a delete of its
--    own is refused. While app.criteria_only names attribute codes (the one update a changed
--    assumption starts), the trigger also refuses a change to the criteria of any other
--    attribute.
--
-- 5. attribute_assumptions: what an agent assumed where it found a fact missing, unclear or
--    contradicted once the understanding was completed, stated on the attributes it bears on
--    (attribute_codes; none: the set as a whole), instead of a question that would send the
--    person back. Written once, by the agent (its model call), OPEN; decided once:
--      CONFIRMED                a person said "That's right" (a confirmed fact);
--      CHANGED                  a person gave the fact in their own words (answer, 10 to
--                               1,000 characters), which starts one update of the
--                               attributes it names;
--      ACCEPTED_WITH_ATTRIBUTE  a person accepted an attribute it names while it was open:
--                               accepted with the attribute, never the person's own answer;
--      SUPERSEDED               nothing it names stands any more (decided_by null).
--    One per matter on a control (its words lower-cased, everything but letters and digits
--    read as one space), whatever its status: a matter is never assumed twice. Never
--    deleted. An archived engagement's are read-only (migration 0136).
--
-- Additive: four columns on engagement_controls and evidence_plans, four on
-- control_attributes, two tables, their guard functions and triggers. No existing row is
-- changed, and no existing function or trigger is replaced.
--
-- Rollback: DROP TRIGGER control_attributes_criteria_versions ON control_attributes;
-- DROP TRIGGER engagement_controls_understanding_completed ON engagement_controls;
-- DROP TABLE attribute_criteria_versions, attribute_assumptions; DROP FUNCTION
-- record_attribute_criteria_version(), guard_attribute_criteria_version_insert(),
-- refuse_attribute_criteria_version_change(), guard_attribute_assumption_insert(),
-- guard_attribute_assumption_update(), prevent_attribute_assumption_deletion(),
-- keep_understanding_completed(); ALTER TABLE control_attributes DROP COLUMN
-- criteria_written_at, DROP COLUMN criteria_written_by, DROP COLUMN criteria_writer, DROP
-- COLUMN criteria_cause; ALTER TABLE evidence_plans DROP COLUMN questions_checked_at, DROP
-- COLUMN run_codes, DROP COLUMN run_cause; ALTER TABLE engagement_controls DROP COLUMN
-- understanding_completed_at; delete the audit events whose action starts with
-- 'attribute_assumption.' only if the firm's retention allows it (they are otherwise kept:
-- they name no table); delete the '0173_understanding_once' row from schema_migrations. A
-- rollback loses the earlier criteria, the assumptions and the people's answers to them (the
-- audit events keep each decision), and every control's understanding reads as not
-- completed again, so the agents may ask on it once more.

-- 1. When the understanding was completed

ALTER TABLE engagement_controls ADD COLUMN understanding_completed_at timestamptz;

-- Set once, never cleared and never moved.
CREATE FUNCTION keep_understanding_completed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.understanding_completed_at IS NOT NULL
        AND NEW.understanding_completed_at IS DISTINCT FROM OLD.understanding_completed_at
    THEN
        RAISE EXCEPTION 'a control''s completed understanding is never reopened';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_controls_understanding_completed
BEFORE UPDATE OF understanding_completed_at ON engagement_controls
FOR EACH ROW EXECUTE FUNCTION keep_understanding_completed();

-- 2. The question pass and the one update a changed assumption starts

ALTER TABLE evidence_plans
    ADD COLUMN questions_checked_at timestamptz,
    ADD COLUMN run_codes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN run_cause text NOT NULL DEFAULT '',
    ADD CONSTRAINT evidence_plans_run_codes CHECK (
        cardinality(run_codes) <= 12
        AND array_to_string(run_codes, ',') ~ '^(A[0-9]{1,3}(,A[0-9]{1,3})*)?$'
    ),
    ADD CONSTRAINT evidence_plans_run_cause CHECK (char_length(run_cause) <= 300);

-- 3. Who or what wrote the criteria as they read now

ALTER TABLE control_attributes
    ADD COLUMN criteria_written_at timestamptz,
    ADD COLUMN criteria_written_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN criteria_writer text NOT NULL DEFAULT '',
    ADD COLUMN criteria_cause text NOT NULL DEFAULT '',
    ADD CONSTRAINT control_attributes_criteria_writer CHECK (
        char_length(criteria_writer) <= 60 AND char_length(criteria_cause) <= 300
    );

-- 4. Every earlier version of an attribute's criteria

CREATE TABLE attribute_criteria_versions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    attribute_id uuid NOT NULL REFERENCES control_attributes (id) ON DELETE CASCADE,
    -- 1 for the first criteria the attribute had, then in the order they were replaced.
    version integer NOT NULL,
    condition text NOT NULL,
    pass_criteria text NOT NULL,
    fail_criteria text NOT NULL,
    judgment_required boolean,
    criteria_origin text,
    -- Who had accepted them, when they were replaced while accepted.
    accepted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    accepted_at timestamptz,
    -- When they were written (for criteria written before this migration, when their
    -- attribute last changed before they were replaced), by whom or what, and why.
    written_at timestamptz NOT NULL,
    written_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    writer text NOT NULL DEFAULT '',
    cause text NOT NULL DEFAULT '',
    replaced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT attribute_criteria_versions_version CHECK (version >= 1),
    CONSTRAINT attribute_criteria_versions_one UNIQUE (attribute_id, version),
    CONSTRAINT attribute_criteria_versions_lengths CHECK (
        char_length(condition) <= 2000 AND char_length(pass_criteria) <= 2000
        AND char_length(fail_criteria) <= 2000 AND char_length(writer) <= 60
        AND char_length(cause) <= 300
    ),
    CONSTRAINT attribute_criteria_versions_origin CHECK (
        criteria_origin IS NULL OR criteria_origin IN ('PERSON', 'AGENT', 'SEEDED')
    ),
    CONSTRAINT attribute_criteria_versions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT attribute_criteria_versions_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT
);

-- An attribute's earlier criteria, newest first.
CREATE INDEX attribute_criteria_versions_attribute_idx
    ON attribute_criteria_versions (attribute_id, version DESC);
CREATE INDEX attribute_criteria_versions_control_idx
    ON attribute_criteria_versions (project_id, engagement_control_id, replaced_at DESC);

-- A version is written only by the trigger on control_attributes below, never directly.
CREATE FUNCTION guard_attribute_criteria_version_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'an attribute''s earlier criteria are kept only when they change';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER attribute_criteria_versions_recorded
BEFORE INSERT ON attribute_criteria_versions
FOR EACH ROW EXECUTE FUNCTION guard_attribute_criteria_version_insert();

-- Never changed. Never deleted on its own: only with its attribute or its control (a
-- cascade, from inside the foreign key's own trigger), while an engagement is set up.
CREATE FUNCTION refuse_attribute_criteria_version_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'an attribute''s earlier criteria are kept as they were';
END;
$$;

CREATE TRIGGER attribute_criteria_versions_kept
BEFORE UPDATE OR DELETE ON attribute_criteria_versions
FOR EACH ROW EXECUTE FUNCTION refuse_attribute_criteria_version_change();

-- An archived engagement's are read-only (migration 0136). This trigger fires before the
-- guards above (triggers of one event fire in name order), so a write there is refused as
-- archived.
CREATE TRIGGER attribute_criteria_versions_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON attribute_criteria_versions
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

-- Every change to an attribute's criteria keeps the criteria it replaces, and stamps who or
-- what wrote the new ones, when and why (from the session settings the server sets around
-- the write; none set: unknown, ""). It fires after control_attributes_criteria_acceptance
-- (name order), which clears an acceptance the change ends; the version keeps who had
-- accepted the replaced criteria.
CREATE FUNCTION record_attribute_criteria_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    named text := coalesce(current_setting('app.criteria_only', true), '');
    person text := coalesce(current_setting('app.criteria_by', true), '');
    had boolean;
BEGIN
    IF named <> '' AND NOT (coalesce(OLD.code, '') = ANY (string_to_array(named, ','))) THEN
        RAISE EXCEPTION 'this update may change only the criteria of the attributes it names';
    END IF;
    had := OLD.condition <> '' OR OLD.pass_criteria <> '' OR OLD.fail_criteria <> ''
        OR OLD.judgment_required IS TRUE;
    IF had THEN
        INSERT INTO public.attribute_criteria_versions (
            organization_id, project_id, engagement_control_id, attribute_id, version,
            condition, pass_criteria, fail_criteria, judgment_required, criteria_origin,
            accepted_by, accepted_at, written_at, written_by, writer, cause
        )
        VALUES (
            OLD.organization_id, OLD.project_id, OLD.engagement_control_id, OLD.id,
            (SELECT coalesce(max(v.version), 0) + 1 FROM public.attribute_criteria_versions v
             WHERE v.attribute_id = OLD.id),
            OLD.condition, OLD.pass_criteria, OLD.fail_criteria, OLD.judgment_required,
            OLD.criteria_origin, OLD.criteria_accepted_by, OLD.criteria_accepted_at,
            coalesce(OLD.criteria_written_at, OLD.updated_at), OLD.criteria_written_by,
            OLD.criteria_writer, OLD.criteria_cause
        );
    END IF;
    NEW.criteria_written_at := clock_timestamp();
    NEW.criteria_written_by := CASE
        WHEN person ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN person::uuid
    END;
    NEW.criteria_writer := left(coalesce(current_setting('app.criteria_writer', true), ''), 60);
    NEW.criteria_cause := left(coalesce(current_setting('app.criteria_cause', true), ''), 300);
    RETURN NEW;
END;
$$;

CREATE TRIGGER control_attributes_criteria_versions
BEFORE UPDATE ON control_attributes
FOR EACH ROW
WHEN (
    (OLD.condition, OLD.pass_criteria, OLD.fail_criteria, OLD.judgment_required,
     OLD.criteria_origin)
    IS DISTINCT FROM
    (NEW.condition, NEW.pass_criteria, NEW.fail_criteria, NEW.judgment_required,
     NEW.criteria_origin)
)
EXECUTE FUNCTION record_attribute_criteria_version();

-- 5. What an agent assumed once the understanding was completed

CREATE TABLE attribute_assumptions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    -- What it is about, in a few words, and the assumption, one sentence.
    matter text NOT NULL,
    assumed text NOT NULL,
    -- MISSING, AMBIGUOUS or CONFLICT: what the agent found.
    kind text NOT NULL,
    -- The codes of the attributes it bears on (A1, A3); none: the set as a whole.
    attribute_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The agent that stated it, and its model call.
    raised_by_agent text NOT NULL,
    model_call_id uuid,
    status text NOT NULL DEFAULT 'OPEN',
    -- The person's own words, for CHANGED only.
    answer text NOT NULL DEFAULT '',
    decided_by uuid,
    decided_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT attribute_assumptions_matter CHECK (
        char_length(btrim(matter)) >= 1 AND char_length(matter) <= 300
    ),
    CONSTRAINT attribute_assumptions_assumed CHECK (
        char_length(btrim(assumed)) >= 1 AND char_length(assumed) <= 500
    ),
    CONSTRAINT attribute_assumptions_kind CHECK (kind IN ('MISSING', 'AMBIGUOUS', 'CONFLICT')),
    CONSTRAINT attribute_assumptions_agent CHECK (
        char_length(btrim(raised_by_agent)) >= 1 AND char_length(raised_by_agent) <= 60
    ),
    -- An array of at most twelve attribute codes. Each test is reached only where the one
    -- before it holds, so another shape is refused, never an error of its own.
    CONSTRAINT attribute_assumptions_codes CHECK (
        CASE
            WHEN jsonb_typeof(attribute_codes) <> 'array' THEN false
            WHEN jsonb_array_length(attribute_codes) > 12 THEN false
            ELSE NOT jsonb_path_exists(
                attribute_codes,
                '$[*] ? (@.type() != "string" || !(@ like_regex "^A[0-9]{1,3}$"))'
            )
        END
    ),
    CONSTRAINT attribute_assumptions_status CHECK (
        status IN ('OPEN', 'CONFIRMED', 'CHANGED', 'ACCEPTED_WITH_ATTRIBUTE', 'SUPERSEDED')
    ),
    CONSTRAINT attribute_assumptions_version CHECK (version >= 1),
    -- What each status holds: nothing decided while OPEN; a person, and when, for a
    -- confirmation, a change (with the person's own words) or an acceptance; no person when
    -- nothing it names stands any more.
    CONSTRAINT attribute_assumptions_decided CHECK (
        CASE status
            WHEN 'OPEN' THEN decided_at IS NULL AND decided_by IS NULL AND answer = ''
            WHEN 'CHANGED' THEN
                decided_at IS NOT NULL AND decided_by IS NOT NULL
                AND char_length(btrim(answer)) >= 10 AND char_length(answer) <= 1000
            WHEN 'SUPERSEDED' THEN decided_at IS NOT NULL AND decided_by IS NULL AND answer = ''
            ELSE decided_at IS NOT NULL AND decided_by IS NOT NULL AND answer = ''
        END
        AND (decided_at IS NULL OR decided_at >= created_at)
    ),
    CONSTRAINT attribute_assumptions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT attribute_assumptions_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT attribute_assumptions_model_call_fk
        FOREIGN KEY (model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT attribute_assumptions_decided_by_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- A matter is assumed once on a control, whatever became of it.
CREATE UNIQUE INDEX attribute_assumptions_matter_once
    ON attribute_assumptions (
        engagement_control_id, (btrim(regexp_replace(lower(matter), '[^a-z0-9]+', ' ', 'g')))
    );
-- A control's assumptions, newest first.
CREATE INDEX attribute_assumptions_control_idx
    ON attribute_assumptions (project_id, engagement_control_id, created_at DESC);

-- Written OPEN, with nothing decided, at version 1.
CREATE FUNCTION guard_attribute_assumption_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'OPEN' OR NEW.version IS DISTINCT FROM 1
        OR NEW.decided_at IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.answer <> ''
    THEN
        RAISE EXCEPTION 'an assumption is recorded open, before anyone decides it';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER attribute_assumptions_recorded
BEFORE INSERT ON attribute_assumptions
FOR EACH ROW EXECUTE FUNCTION guard_attribute_assumption_insert();

-- What an assumption records never changes; it is decided once (status, answer, decided_by,
-- decided_at, its version moved by one), and a decided one is never changed.
CREATE FUNCTION guard_attribute_assumption_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM 'OPEN' THEN
        RAISE EXCEPTION 'a decided assumption is never changed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.matter IS DISTINCT FROM OLD.matter
        OR NEW.assumed IS DISTINCT FROM OLD.assumed
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.attribute_codes IS DISTINCT FROM OLD.attribute_codes
        OR NEW.raised_by_agent IS DISTINCT FROM OLD.raised_by_agent
        OR NEW.model_call_id IS DISTINCT FROM OLD.model_call_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'what an assumption records never changes';
    END IF;
    IF NEW.status = 'OPEN' OR NEW.version IS DISTINCT FROM OLD.version + 1 THEN
        RAISE EXCEPTION 'an assumption changes only by being decided, once';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER attribute_assumptions_guard
BEFORE UPDATE ON attribute_assumptions
FOR EACH ROW EXECUTE FUNCTION guard_attribute_assumption_update();

CREATE FUNCTION prevent_attribute_assumption_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'an assumption is decided, never deleted';
END;
$$;

CREATE TRIGGER attribute_assumptions_kept
BEFORE DELETE ON attribute_assumptions
FOR EACH ROW EXECUTE FUNCTION prevent_attribute_assumption_deletion();

-- An archived engagement's assumptions are read-only (migration 0136). This trigger fires
-- before the guards above (triggers of one event fire in name order), so a write there is
-- refused as archived.
CREATE TRIGGER attribute_assumptions_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON attribute_assumptions
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
