-- Unified planning, Release 1: implementations and shared control plans (decided by the
-- product owner, 23 October 2026; docs/unified-planning-r1.md).
--
-- 1. Where a control operates. Until now a control row was one per control and system, or
--    one with no system. A control may also operate separately per legal entity, location,
--    department or operating unit, shared-service centre, or process; all optional. A
--    control's units say where it OPERATES (each combination is a separate implementation,
--    split only by a person's decision) or what it merely COVERS (a central control over
--    several entities stays one implementation). implementation_key, kept by the database,
--    is the system and the operating units; one row per control and implementation
--    replaces one per control and system. Every existing row's key is its system or
--    nothing, so nothing that exists changes.
-- 2. MANAGEMENT_REVIEW joins the control classifications, which already overlap.
-- 3. Group decisions. A reviewer approves a control's shared plan once for every
--    implementation whose plan is the same: plan_group_decisions records what was
--    presented, immutable, and each implementation still gets its own plan_decisions row
--    (its own fingerprinted version), which names its group decision, the shared plan's
--    fingerprint, and its scope.
--
-- Rollback: drop the triggers and functions below; DROP TABLE plan_group_decisions after
-- dropping the plan_decisions columns group_decision_id, shared_hash and scope; drop
-- engagement_control_scopes and engagement_scope_units; recreate the four 0041 and two 0067 unique
-- indexes and drop engagement_controls.implementation_key (refused if two rows then share
-- a control and system, which only a split made after this migration can cause); restore
-- the 0061 classifications constraint; delete the
-- '0104_implementations_and_shared_plans' row from schema_migrations.

-- 1. Scope units and a control's units

CREATE TABLE engagement_scope_units (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_scope_units_kind CHECK (
        kind IN ('ENTITY', 'LOCATION', 'DEPARTMENT', 'SERVICE_CENTER', 'PROCESS')
    ),
    CONSTRAINT engagement_scope_units_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT engagement_scope_units_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT engagement_scope_units_project_id_unique UNIQUE (project_id, id)
);

CREATE UNIQUE INDEX engagement_scope_units_name_unique
    ON engagement_scope_units (project_id, kind, lower(btrim(name)));

CREATE TABLE engagement_control_scopes (
    engagement_control_id uuid NOT NULL REFERENCES engagement_controls (id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    role text NOT NULL,
    decided_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (engagement_control_id, unit_id),
    CONSTRAINT engagement_control_scopes_role CHECK (role IN ('OPERATES', 'COVERS')),
    CONSTRAINT engagement_control_scopes_unit_fk
        FOREIGN KEY (project_id, unit_id) REFERENCES engagement_scope_units (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX engagement_control_scopes_unit_idx ON engagement_control_scopes (unit_id);

-- 2. The implementation key

ALTER TABLE engagement_controls ADD COLUMN implementation_key text NOT NULL DEFAULT '';
UPDATE engagement_controls SET implementation_key = coalesce(engagement_application_id::text, '');

CREATE FUNCTION implementation_key_of(control uuid, application uuid) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT coalesce(application::text, '')
           || coalesce(':' || string_agg(unit_id::text, ',' ORDER BY unit_id), '')
    FROM engagement_control_scopes
    WHERE engagement_control_id = control AND role = 'OPERATES'
$$;

-- A new row takes its system as its key unless it names one (a split names its units).
CREATE FUNCTION engagement_controls_implementation_key() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.implementation_key = '' THEN
            NEW.implementation_key := coalesce(NEW.engagement_application_id::text, '');
        END IF;
    ELSIF NEW.engagement_application_id IS DISTINCT FROM OLD.engagement_application_id THEN
        NEW.implementation_key := implementation_key_of(NEW.id, NEW.engagement_application_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_controls_implementation_key
    BEFORE INSERT OR UPDATE OF engagement_application_id ON engagement_controls
    FOR EACH ROW EXECUTE FUNCTION engagement_controls_implementation_key();

CREATE FUNCTION engagement_control_scopes_key() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    affected uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.engagement_control_id
                          ELSE NEW.engagement_control_id END;
BEGIN
    UPDATE engagement_controls
    SET implementation_key = implementation_key_of(id, engagement_application_id)
    WHERE id = affected
      AND implementation_key IS DISTINCT FROM implementation_key_of(id, engagement_application_id);
    RETURN NULL;
END;
$$;

CREATE TRIGGER engagement_control_scopes_key
    AFTER INSERT OR UPDATE OR DELETE ON engagement_control_scopes
    FOR EACH ROW EXECUTE FUNCTION engagement_control_scopes_key();

-- One row per control and implementation (was: per control and system).
DROP INDEX engagement_controls_ref_app_unique;
DROP INDEX engagement_controls_ref_none_unique;
DROP INDEX engagement_controls_key_app_unique;
DROP INDEX engagement_controls_key_none_unique;
CREATE UNIQUE INDEX engagement_controls_ref_implementation_unique
    ON engagement_controls (project_id, control_ref, implementation_key);
CREATE UNIQUE INDEX engagement_controls_key_implementation_unique
    ON engagement_controls (project_id, library_key, implementation_key);
-- The same, whatever the case of the reference (0067).
DROP INDEX engagement_controls_ref_app_folded;
DROP INDEX engagement_controls_ref_none_folded;
CREATE UNIQUE INDEX engagement_controls_ref_implementation_folded
    ON engagement_controls (project_id, upper(control_ref), implementation_key);

-- 3. Management review controls

ALTER TABLE engagement_controls DROP CONSTRAINT engagement_controls_classifications;
ALTER TABLE engagement_controls ADD CONSTRAINT engagement_controls_classifications CHECK (
    classifications IS NULL
    OR (
        cardinality(classifications) BETWEEN 1 AND 7
        AND classifications <@ ARRAY[
            'ITGC', 'AUTOMATED_APPLICATION', 'IT_DEPENDENT_MANUAL', 'BUSINESS_PROCESS',
            'ENTITY_LEVEL', 'KEY_REPORT', 'MANAGEMENT_REVIEW'
        ]::text[]
    )
);

-- 4. Group decisions

CREATE TABLE plan_group_decisions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    control_ref text NOT NULL,
    shared_hash text NOT NULL,
    presented jsonb NOT NULL,
    presented_hash text NOT NULL,
    comment text NOT NULL DEFAULT '',
    decided_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT plan_group_decisions_shared CHECK (shared_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT plan_group_decisions_presented CHECK (jsonb_typeof(presented) = 'object'),
    CONSTRAINT plan_group_decisions_presented_hash CHECK (presented_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT plan_group_decisions_comment CHECK (char_length(comment) <= 4000),
    CONSTRAINT plan_group_decisions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX plan_group_decisions_control_idx
    ON plan_group_decisions (project_id, control_ref, decided_at DESC);

CREATE TRIGGER plan_group_decisions_immutable
    BEFORE UPDATE OR DELETE ON plan_group_decisions
    FOR EACH ROW EXECUTE FUNCTION reject_plan_record_change();

ALTER TABLE plan_decisions
    ADD COLUMN group_decision_id uuid REFERENCES plan_group_decisions (id) ON DELETE RESTRICT,
    ADD COLUMN shared_hash text,
    ADD COLUMN scope jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT plan_decisions_shared CHECK (
        shared_hash IS NULL OR shared_hash ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT plan_decisions_scope CHECK (jsonb_typeof(scope) = 'object'),
    ADD CONSTRAINT plan_decisions_group_shared CHECK (
        group_decision_id IS NULL OR shared_hash IS NOT NULL
    );
