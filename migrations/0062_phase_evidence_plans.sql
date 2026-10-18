-- Phase-aware evidence planning.
--
-- Before this, an evidence request belonged to a control and nothing else: kickoff drafted
-- one request per control that mixed design evidence (a walkthrough, the policy) with the
-- interim population, sample requests and roll-forward requests followed later, and no
-- record said which testing phase a request served, why each item was asked for, or
-- whether a phase was needed at all. The control page showed every request under interim
-- testing.
--
-- This migration:
--
-- 1. records the testing phase each request serves (design, interim, roll-forward, and
--    the retest and remediation requests that already existed), backfilled from the
--    records that created each request;
-- 2. adds an evidence plan per control: the planner's understanding of the control, and
--    one row per testing phase (design, interim, roll-forward) with its applicability
--    (applicable, conditional, not applicable, pending a decision), the reason, the
--    objectives, the procedures, and the period it covers;
-- 3. adds evidence requirements: each item the plan needs, with its phase, its evidence
--    categories, the objective and attributes it supports, why it is needed, its period,
--    what it depends on, the request that carries it, and, separately from receipt,
--    whether a person found it sufficient;
-- 4. keeps every planning run (the agent's or the rules' recommendation as validated)
--    unchanged, so the plan's history can be audited;
-- 5. records changes to a control during the period (configuration, process, people,
--    systems, introduced, replaced, discontinued) that the roll-forward plan must address.
--
-- Nothing is deleted or rewritten except the new phase column's backfill.
--
-- Rollback (only before any new rows matter):
--   DROP TABLE control_changes, evidence_requirements, evidence_plan_phases,
--              evidence_plan_runs, evidence_plans;
--   DROP FUNCTION evidence_plan_runs_frozen();
--   ALTER TABLE pbc_requests DROP COLUMN testing_phase;
--   and delete the '0062_phase_evidence_plans' row from schema_migrations.

-- 1. The phase a request serves

ALTER TABLE pbc_requests ADD COLUMN testing_phase text;
ALTER TABLE pbc_requests ADD CONSTRAINT pbc_requests_testing_phase CHECK (
    testing_phase IS NULL
    OR testing_phase IN ('DESIGN', 'INTERIM', 'ROLLFORWARD', 'RETEST', 'REMEDIATION')
);

-- A round's own request, and its sample request, serve that round.
UPDATE pbc_requests r SET testing_phase = t.kind
FROM test_rounds t
WHERE t.request_id = r.id AND r.testing_phase IS NULL;

UPDATE pbc_requests r SET testing_phase = t.kind
FROM control_tests c JOIN test_rounds t ON t.id = c.test_round_id
WHERE c.sample_request_id = r.id AND r.testing_phase IS NULL;

UPDATE pbc_requests r SET testing_phase = 'REMEDIATION'
FROM deficiencies d
WHERE d.remediation_request_id = r.id AND r.testing_phase IS NULL;

-- Everything else on a control was interim evidence: the kickoff request (population
-- and walkthrough), interim sample requests, and follow-ups on what was sent for them.
UPDATE pbc_requests SET testing_phase = 'INTERIM'
WHERE testing_phase IS NULL AND engagement_control_id IS NOT NULL;

CREATE INDEX pbc_requests_control_phase_idx
    ON pbc_requests (project_id, engagement_control_id, testing_phase)
    WHERE engagement_control_id IS NOT NULL;

-- 2. Evidence plans

CREATE TABLE evidence_plans (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    -- PROPOSED until a person approves it; CHANGES_PROPOSED when a later run would change
    -- an approved plan, until a person reviews the changes.
    status text NOT NULL DEFAULT 'PROPOSED',
    source text NOT NULL,
    -- True when critical information was missing and the plan rests on assumptions.
    provisional boolean NOT NULL DEFAULT false,
    -- The control understanding, classification, risks and attributes, missing
    -- information, assumptions, exceptions, and approvals the planner identified.
    understanding jsonb NOT NULL,
    note text NOT NULL DEFAULT '',
    -- A hash of the facts the plan was made from, so a rerun can say nothing changed.
    fingerprint text NOT NULL DEFAULT '',
    model_call_id uuid,
    generated_by uuid,
    generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    approved_by uuid,
    approved_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_plans_status CHECK (
        status IN ('PROPOSED', 'APPROVED', 'CHANGES_PROPOSED')
    ),
    CONSTRAINT evidence_plans_source CHECK (source IN ('MODEL', 'RULES')),
    CONSTRAINT evidence_plans_approved CHECK (
        status = 'PROPOSED' OR approved_at IS NOT NULL
    ),
    CONSTRAINT evidence_plans_understanding CHECK (jsonb_typeof(understanding) = 'object'),
    CONSTRAINT evidence_plans_note CHECK (char_length(note) <= 500),
    CONSTRAINT evidence_plans_version CHECK (version >= 1),
    CONSTRAINT evidence_plans_one_per_control UNIQUE (project_id, engagement_control_id),
    CONSTRAINT evidence_plans_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_plans_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_plans_generated_fk
        FOREIGN KEY (generated_by) REFERENCES users (id),
    CONSTRAINT evidence_plans_approved_fk
        FOREIGN KEY (approved_by) REFERENCES users (id)
);

CREATE TRIGGER evidence_plans_updated_at
    BEFORE UPDATE ON evidence_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every planning run, as validated, with what it changed. Never updated or deleted.
CREATE TABLE evidence_plan_runs (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_id uuid NOT NULL REFERENCES evidence_plans (id) ON DELETE RESTRICT,
    source text NOT NULL,
    model_call_id uuid,
    output jsonb NOT NULL,
    -- {added, updated, flagged, removed, kept}: requirement keys by what happened.
    changes jsonb NOT NULL DEFAULT '{}'::jsonb,
    note text NOT NULL DEFAULT '',
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_plan_runs_source CHECK (source IN ('MODEL', 'RULES')),
    CONSTRAINT evidence_plan_runs_output CHECK (jsonb_typeof(output) = 'object'),
    CONSTRAINT evidence_plan_runs_note CHECK (char_length(note) <= 500)
);

CREATE INDEX evidence_plan_runs_plan_idx ON evidence_plan_runs (plan_id, created_at);

CREATE FUNCTION evidence_plan_runs_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'evidence plan runs are immutable';
END;
$$;

CREATE TRIGGER evidence_plan_runs_immutable
    BEFORE UPDATE OR DELETE ON evidence_plan_runs
    FOR EACH ROW EXECUTE FUNCTION evidence_plan_runs_frozen();

CREATE TABLE evidence_plan_phases (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_id uuid NOT NULL REFERENCES evidence_plans (id) ON DELETE RESTRICT,
    engagement_control_id uuid NOT NULL,
    phase text NOT NULL,
    applicability text NOT NULL,
    rationale text NOT NULL,
    -- For a conditional phase: what must happen before its requests are issued.
    condition text NOT NULL DEFAULT '',
    -- For a phase pending determination: the question that must be resolved.
    open_question text NOT NULL DEFAULT '',
    objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
    procedures jsonb NOT NULL DEFAULT '[]'::jsonb,
    period_start date,
    period_end date,
    as_of date,
    -- Who decided the applicability: the agent, the rules, or a person. A person's
    -- decision is kept when the plan is generated again.
    origin text NOT NULL,
    decided_by uuid REFERENCES users (id),
    decided_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_plan_phases_phase CHECK (phase IN ('DESIGN', 'INTERIM', 'ROLLFORWARD')),
    CONSTRAINT evidence_plan_phases_applicability CHECK (
        applicability IN ('APPLICABLE', 'CONDITIONAL', 'NOT_APPLICABLE', 'PENDING')
    ),
    CONSTRAINT evidence_plan_phases_origin CHECK (origin IN ('AGENT', 'RULES', 'PERSON')),
    CONSTRAINT evidence_plan_phases_rationale CHECK (
        char_length(btrim(rationale)) BETWEEN 10 AND 1500
    ),
    CONSTRAINT evidence_plan_phases_condition CHECK (
        char_length(condition) <= 500
        AND (applicability <> 'CONDITIONAL' OR char_length(btrim(condition)) > 0)
    ),
    CONSTRAINT evidence_plan_phases_question CHECK (
        char_length(open_question) <= 500
        AND (applicability <> 'PENDING' OR char_length(btrim(open_question)) > 0)
    ),
    CONSTRAINT evidence_plan_phases_lists CHECK (
        jsonb_typeof(objectives) = 'array' AND jsonb_typeof(procedures) = 'array'
    ),
    CONSTRAINT evidence_plan_phases_period CHECK (
        period_start IS NULL OR period_end IS NULL OR period_start <= period_end
    ),
    CONSTRAINT evidence_plan_phases_person CHECK (
        origin <> 'PERSON' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
    CONSTRAINT evidence_plan_phases_one UNIQUE (plan_id, phase)
);

CREATE TRIGGER evidence_plan_phases_updated_at
    BEFORE UPDATE ON evidence_plan_phases
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Evidence requirements

CREATE TABLE evidence_requirements (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_id uuid NOT NULL REFERENCES evidence_plans (id) ON DELETE RESTRICT,
    engagement_control_id uuid NOT NULL,
    phase text NOT NULL,
    -- Stable across runs: the same control, phase, and key is the same requirement.
    requirement_key text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    categories text[] NOT NULL,
    objective text NOT NULL,
    attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
    risk text NOT NULL DEFAULT '',
    rationale text NOT NULL,
    necessity text NOT NULL,
    period_label text NOT NULL DEFAULT '',
    period_start date,
    period_end date,
    as_of date,
    -- For a population: whether it lists control executions, the transactions the
    -- control acts on, or the items reviewed within one execution.
    population_kind text,
    -- For a sample: how the audit team selects it.
    sample_selection text NOT NULL DEFAULT '',
    -- Another requirement of the same control and phase this one waits for.
    depends_on text,
    status text NOT NULL,
    pbc_request_id uuid REFERENCES pbc_requests (id) ON DELETE RESTRICT,
    -- Whether what was received is enough. Separate from receipt: a file arriving never
    -- makes a requirement sufficient.
    sufficiency text NOT NULL DEFAULT 'NOT_REVIEWED',
    sufficiency_note text NOT NULL DEFAULT '',
    sufficiency_by uuid REFERENCES users (id),
    sufficiency_at timestamptz,
    waive_reason text NOT NULL DEFAULT '',
    waived_by uuid REFERENCES users (id),
    waived_at timestamptz,
    origin text NOT NULL,
    -- A person changed the wording: a rerun keeps it.
    person_edited boolean NOT NULL DEFAULT false,
    -- A rerun's change to a requirement that was already issued or approved, for a
    -- person to accept or dismiss. Never applied silently.
    pending_change jsonb,
    -- Added or changed after the plan was approved: a person should look at it.
    needs_review boolean NOT NULL DEFAULT false,
    -- How the request that carries this requirement came to carry it.
    coverage_note text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_requirements_phase CHECK (phase IN ('DESIGN', 'INTERIM', 'ROLLFORWARD')),
    CONSTRAINT evidence_requirements_key CHECK (requirement_key ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
    CONSTRAINT evidence_requirements_text CHECK (
        char_length(btrim(title)) BETWEEN 3 AND 200
        AND char_length(btrim(description)) BETWEEN 10 AND 1500
        AND char_length(btrim(objective)) BETWEEN 3 AND 500
        AND char_length(btrim(rationale)) BETWEEN 10 AND 1000
        AND char_length(risk) <= 1000
        AND char_length(period_label) <= 200
        AND char_length(sample_selection) <= 600
        AND char_length(coverage_note) <= 300
    ),
    CONSTRAINT evidence_requirements_categories CHECK (
        cardinality(categories) BETWEEN 1 AND 3
        AND categories <@ ARRAY[
            'CONFIGURATION', 'POPULATION', 'SAMPLE', 'PROCESS_DOCUMENTATION',
            'CONTROL_EXECUTION', 'REPORT_RELIABILITY', 'CHANGE_HISTORY', 'OTHER'
        ]::text[]
    ),
    CONSTRAINT evidence_requirements_attributes CHECK (jsonb_typeof(attributes) = 'array'),
    CONSTRAINT evidence_requirements_necessity CHECK (
        necessity IN ('REQUIRED', 'CONDITIONAL', 'OPTIONAL')
    ),
    CONSTRAINT evidence_requirements_population CHECK (
        population_kind IS NULL
        OR population_kind IN ('CONTROL_EXECUTIONS', 'TRANSACTIONS', 'ITEMS_REVIEWED')
    ),
    CONSTRAINT evidence_requirements_period CHECK (
        period_start IS NULL OR period_end IS NULL OR period_start <= period_end
    ),
    CONSTRAINT evidence_requirements_status CHECK (
        status IN ('PLANNED', 'AWAITING_DEPENDENCY', 'REQUESTED', 'WAIVED', 'REMOVED')
    ),
    CONSTRAINT evidence_requirements_requested CHECK (
        status <> 'REQUESTED' OR pbc_request_id IS NOT NULL
    ),
    CONSTRAINT evidence_requirements_waived CHECK (
        (status = 'WAIVED') = (char_length(btrim(waive_reason)) > 0)
        AND (status <> 'WAIVED' OR (waived_by IS NOT NULL AND waived_at IS NOT NULL))
    ),
    CONSTRAINT evidence_requirements_sufficiency CHECK (
        sufficiency IN (
            'NOT_REVIEWED', 'UNDER_REVIEW', 'ACCEPTED', 'INSUFFICIENT', 'FOLLOW_UP_REQUIRED'
        )
        AND (sufficiency = 'NOT_REVIEWED' OR sufficiency_by IS NOT NULL)
        AND (
            sufficiency NOT IN ('INSUFFICIENT', 'FOLLOW_UP_REQUIRED')
            OR char_length(btrim(sufficiency_note)) > 0
        )
        AND char_length(sufficiency_note) <= 1000
    ),
    CONSTRAINT evidence_requirements_origin CHECK (origin IN ('AGENT', 'RULES', 'PERSON')),
    CONSTRAINT evidence_requirements_change CHECK (
        pending_change IS NULL OR jsonb_typeof(pending_change) = 'object'
    ),
    CONSTRAINT evidence_requirements_version CHECK (version >= 1),
    CONSTRAINT evidence_requirements_one UNIQUE (engagement_control_id, phase, requirement_key),
    CONSTRAINT evidence_requirements_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_requirements_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_requirements_plan_idx ON evidence_requirements (plan_id, phase);
CREATE INDEX evidence_requirements_request_idx
    ON evidence_requirements (pbc_request_id) WHERE pbc_request_id IS NOT NULL;

CREATE TRIGGER evidence_requirements_updated_at
    BEFORE UPDATE ON evidence_requirements
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. Changes to a control during the period

CREATE TABLE control_changes (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    effective_on date NOT NULL,
    kind text NOT NULL,
    description text NOT NULL,
    recorded_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_changes_kind CHECK (
        kind IN (
            'CONFIGURATION', 'PROCESS', 'PERSONNEL', 'SYSTEM', 'INTRODUCED', 'REPLACED',
            'DISCONTINUED'
        )
    ),
    CONSTRAINT control_changes_description CHECK (
        char_length(btrim(description)) BETWEEN 3 AND 1000
    ),
    CONSTRAINT control_changes_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_changes_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX control_changes_control_idx
    ON control_changes (engagement_control_id, effective_on);
