-- The master test plan (decided by the product owner). A control's evidence plan becomes
-- its master test plan: the understanding of the control, its test procedures, its test
-- attributes, and the evidence each needs, approved by a person as one version.
--
-- 1. Every approval is bound to a stored, hashed copy of the plan (plan_versions) and kept
--    as an immutable decision (plan_decisions). A reviewer approves or requests changes.
-- 2. The plan's content has a revision. Any material change to an approved plan (its
--    procedures, the control's approved attributes, the links between them and the
--    evidence) sends it back for review: the database refuses an approved plan whose
--    approved revision is not its current one.
-- 3. Approving the plan approves the control's attributes with it (decided by the product
--    owner): an attribute is tested only once a plan version holding it is approved.
-- 4. Every plan approved before this migration is reviewed again (decided by the product
--    owner): approvals are withdrawn, and kept in the audit trail.
--
-- Rollback: drop the triggers and functions below, the tables plan_decisions,
-- plan_versions, evidence_requirement_procedures, evidence_requirement_attributes,
-- plan_procedure_attributes, plan_procedures, and the columns added here; restore the
-- evidence_plans constraints from 0062; delete the '0079_master_test_plans' row from
-- schema_migrations. Withdrawn approvals are not restored (see the audit trail).

-- 1. The plan's revision, its review state, and the agent's proposed revision

ALTER TABLE evidence_plans
    -- The plan's content revision: one more for every transaction that changes it.
    ADD COLUMN revision integer NOT NULL DEFAULT 1,
    -- The transaction that last revised it, so one change is one revision.
    ADD COLUMN revised_txid bigint DEFAULT txid_current(),
    -- The revision a person last approved.
    ADD COLUMN approved_revision integer,
    -- A preparer submitted this revision for review.
    ADD COLUMN submitted_by uuid REFERENCES users (id),
    ADD COLUMN submitted_at timestamptz,
    ADD COLUMN submitted_note text NOT NULL DEFAULT '',
    -- The planner's later understanding and phase plan for an approved plan: proposed to
    -- the reviewer, never applied on its own.
    ADD COLUMN pending_revision jsonb,
    DROP CONSTRAINT evidence_plans_status,
    ADD CONSTRAINT evidence_plans_status CHECK (
        status IN ('PROPOSED', 'APPROVED', 'CHANGES_PROPOSED', 'CHANGES_REQUESTED')
    ),
    DROP CONSTRAINT evidence_plans_approved,
    ADD CONSTRAINT evidence_plans_approved CHECK (
        status NOT IN ('APPROVED', 'CHANGES_PROPOSED') OR approved_at IS NOT NULL
    ),
    ADD CONSTRAINT evidence_plans_revision CHECK (revision >= 1),
    ADD CONSTRAINT evidence_plans_submitted CHECK (
        (submitted_by IS NULL) = (submitted_at IS NULL)
    ),
    ADD CONSTRAINT evidence_plans_submitted_note CHECK (char_length(submitted_note) <= 2000),
    ADD CONSTRAINT evidence_plans_pending_revision CHECK (
        pending_revision IS NULL OR jsonb_typeof(pending_revision) = 'object'
    );

-- 2. Every approval is withdrawn: each plan is reviewed again as a master test plan.

INSERT INTO audit_events (
    organization_id, project_id, actor_user_id, action, target_type, target_id, payload
)
SELECT organization_id, project_id, NULL, 'evidence_plan.approval_withdrawn', 'evidence_plan',
       id,
       jsonb_build_object(
           'previous_status', status,
           'approved_by', approved_by,
           'approved_at', approved_at,
           'reason', 'Master test plans (migration 0079): every plan is reviewed again, '
                     'with its procedures, attributes, and evidence, as one version.'
       )
FROM evidence_plans
WHERE status <> 'PROPOSED';

UPDATE evidence_plans
SET status = 'PROPOSED', approved_by = NULL, approved_at = NULL, version = version + 1
WHERE status <> 'PROPOSED';

-- Only now can the invariant hold for every row: an approved plan's approved revision is
-- its current revision.
ALTER TABLE evidence_plans
    ADD CONSTRAINT evidence_plans_approved_revision CHECK (
        status NOT IN ('APPROVED', 'CHANGES_PROPOSED')
        OR (approved_by IS NOT NULL AND approved_revision = revision)
    );

-- 3. Test procedures

CREATE TABLE plan_procedures (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_id uuid NOT NULL REFERENCES evidence_plans (id) ON DELETE RESTRICT,
    engagement_control_id uuid NOT NULL,
    phase text NOT NULL,
    -- Stable across runs: the phase and a hash of the wording the planner wrote.
    procedure_key text NOT NULL,
    -- What a person reads and cites: D1 for design, I1 for interim, R1 for roll-forward.
    code text NOT NULL,
    position integer NOT NULL DEFAULT 0,
    text text NOT NULL,
    -- How it is performed, where stated: inquiry, observation, inspection, reperformance,
    -- recalculation, comparison, or a walkthrough.
    method text,
    origin text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    person_edited boolean NOT NULL DEFAULT false,
    removed_reason text NOT NULL DEFAULT '',
    created_by uuid REFERENCES users (id),
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT plan_procedures_phase CHECK (phase IN ('DESIGN', 'INTERIM', 'ROLLFORWARD')),
    CONSTRAINT plan_procedures_key CHECK (procedure_key ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
    CONSTRAINT plan_procedures_code CHECK (code ~ '^[DIR][0-9]{1,3}$'),
    CONSTRAINT plan_procedures_text CHECK (char_length(btrim(text)) BETWEEN 3 AND 1000),
    CONSTRAINT plan_procedures_method CHECK (
        method IS NULL OR method IN (
            'INQUIRY', 'OBSERVATION', 'INSPECTION', 'REPERFORMANCE', 'RECALCULATION',
            'COMPARISON', 'WALKTHROUGH'
        )
    ),
    CONSTRAINT plan_procedures_origin CHECK (origin IN ('AGENT', 'RULES', 'PERSON', 'LIBRARY')),
    CONSTRAINT plan_procedures_status CHECK (status IN ('ACTIVE', 'REMOVED')),
    CONSTRAINT plan_procedures_removed CHECK (
        (status = 'REMOVED') OR char_length(removed_reason) = 0
    ),
    CONSTRAINT plan_procedures_removed_reason CHECK (char_length(removed_reason) <= 500),
    CONSTRAINT plan_procedures_version CHECK (version >= 1),
    CONSTRAINT plan_procedures_one_key UNIQUE (plan_id, phase, procedure_key),
    CONSTRAINT plan_procedures_one_code UNIQUE (plan_id, code),
    CONSTRAINT plan_procedures_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT plan_procedures_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX plan_procedures_plan_idx ON plan_procedures (plan_id, phase, position);

CREATE TRIGGER plan_procedures_updated_at
    BEFORE UPDATE ON plan_procedures
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The procedures each plan already lists, carried over as rows, in their order.
INSERT INTO plan_procedures (
    organization_id, project_id, plan_id, engagement_control_id, phase, procedure_key,
    code, position, text, origin
)
SELECT organization_id, project_id, plan_id, engagement_control_id, phase,
       lower(phase) || '-' || left(md5(normal), 12),
       left(phase, 1) || row_number() OVER (PARTITION BY plan_id, phase ORDER BY first),
       (row_number() OVER (PARTITION BY plan_id, phase ORDER BY first)) - 1,
       left(wording, 1000), origin
FROM (
    SELECT ph.organization_id, ph.project_id, ph.plan_id, ph.engagement_control_id, ph.phase,
           lower(regexp_replace(btrim(t.value), '\s+', ' ', 'g')) AS normal,
           min(regexp_replace(btrim(t.value), '\s+', ' ', 'g')) AS wording,
           min(t.ordinality) AS first,
           CASE WHEN p.source = 'MODEL' THEN 'AGENT' ELSE 'RULES' END AS origin
    FROM evidence_plan_phases ph
    JOIN evidence_plans p ON p.id = ph.plan_id
    CROSS JOIN LATERAL jsonb_array_elements_text(ph.procedures)
        WITH ORDINALITY AS t(value, ordinality)
    WHERE char_length(btrim(t.value)) >= 3
    GROUP BY ph.organization_id, ph.project_id, ph.plan_id, ph.engagement_control_id,
             ph.phase, p.source, lower(regexp_replace(btrim(t.value), '\s+', ' ', 'g'))
) listed;

-- 4. What a test attribute is judged by. Empty where the library's definition says it
--    (read from definition_registry by its definition_key) or nothing does yet.

ALTER TABLE control_attributes
    -- What a person reads and cites: A1, A2, ... per control. A rewording keeps its code.
    ADD COLUMN code text,
    -- The control objective or risk the attribute addresses.
    ADD COLUMN objective text NOT NULL DEFAULT '',
    -- The exact condition tested.
    ADD COLUMN condition text NOT NULL DEFAULT '',
    ADD COLUMN pass_criteria text NOT NULL DEFAULT '',
    ADD COLUMN fail_criteria text NOT NULL DEFAULT '',
    -- Null: not yet determined.
    ADD COLUMN judgment_required boolean,
    ADD COLUMN automatable boolean,
    -- The phases in which it is tested; empty: every applicable phase.
    ADD COLUMN phases text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT control_attributes_code CHECK (code IS NULL OR code ~ '^A[0-9]{1,3}$'),
    ADD CONSTRAINT control_attributes_criteria CHECK (
        char_length(objective) <= 500 AND char_length(condition) <= 1000
        AND char_length(pass_criteria) <= 1000 AND char_length(fail_criteria) <= 1000
    ),
    ADD CONSTRAINT control_attributes_phases CHECK (
        phases <@ ARRAY['DESIGN', 'INTERIM', 'ROLLFORWARD']::text[]
    );

-- Codes for the attributes on record, in the order they were written; a rewording takes
-- the code of the attribute it replaced.
WITH RECURSIVE roots AS (
    SELECT id, id AS root FROM control_attributes WHERE replaces_id IS NULL
    UNION ALL
    SELECT a.id, r.root FROM control_attributes a JOIN roots r ON a.replaces_id = r.id
),
numbered AS (
    SELECT a.id AS root, 'A' || row_number() OVER (
               PARTITION BY a.engagement_control_id ORDER BY a.created_at, a.position, a.id
           ) AS code
    FROM control_attributes a WHERE a.replaces_id IS NULL
)
UPDATE control_attributes a SET code = n.code
FROM roots r JOIN numbered n ON n.root = r.root
WHERE a.id = r.id;

CREATE UNIQUE INDEX control_attributes_approved_code
    ON control_attributes (engagement_control_id, code) WHERE status = 'APPROVED';

CREATE FUNCTION assign_attribute_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.code IS NULL AND NEW.replaces_id IS NOT NULL THEN
        SELECT code INTO NEW.code FROM control_attributes WHERE id = NEW.replaces_id;
    END IF;
    IF NEW.code IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('attribute-code:' || NEW.engagement_control_id));
        SELECT 'A' || (coalesce(max(substring(code FROM 2)::integer), 0) + 1) INTO NEW.code
        FROM control_attributes
        WHERE engagement_control_id = NEW.engagement_control_id AND code ~ '^A[0-9]+$';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER control_attributes_code
    BEFORE INSERT ON control_attributes
    FOR EACH ROW EXECUTE FUNCTION assign_attribute_code();

-- Codes for the evidence requirements: E1, E2, ... per control, in the order planned.
ALTER TABLE evidence_requirements
    ADD COLUMN code text,
    ADD CONSTRAINT evidence_requirements_code CHECK (code IS NULL OR code ~ '^E[0-9]{1,3}$');

UPDATE evidence_requirements q SET code = n.code
FROM (
    SELECT id, 'E' || row_number() OVER (
               PARTITION BY engagement_control_id
               ORDER BY array_position(ARRAY['DESIGN', 'INTERIM', 'ROLLFORWARD'], phase),
                        created_at, requirement_key
           ) AS code
    FROM evidence_requirements
) n
WHERE q.id = n.id;

ALTER TABLE evidence_requirements ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX evidence_requirements_one_code
    ON evidence_requirements (engagement_control_id, code);

CREATE FUNCTION assign_requirement_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.code IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('requirement-code:' || NEW.engagement_control_id));
        SELECT 'E' || (coalesce(max(substring(code FROM 2)::integer), 0) + 1) INTO NEW.code
        FROM evidence_requirements WHERE engagement_control_id = NEW.engagement_control_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_requirements_code
    BEFORE INSERT ON evidence_requirements
    FOR EACH ROW EXECUTE FUNCTION assign_requirement_code();

CREATE FUNCTION assign_procedure_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.code IS NULL OR NEW.code = '' THEN
        PERFORM pg_advisory_xact_lock(hashtext('procedure-code:' || NEW.plan_id));
        SELECT left(NEW.phase, 1) || (coalesce(max(substring(code FROM 2)::integer), 0) + 1)
        INTO NEW.code
        FROM plan_procedures WHERE plan_id = NEW.plan_id AND phase = NEW.phase;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER plan_procedures_code
    BEFORE INSERT ON plan_procedures
    FOR EACH ROW EXECUTE FUNCTION assign_procedure_code();

-- 5. Traceability by identity: procedure to attribute, requirement to attribute and to
--    procedure. Many to many. A link's origin says who made it.

CREATE TABLE plan_procedure_attributes (
    procedure_id uuid NOT NULL REFERENCES plan_procedures (id) ON DELETE RESTRICT,
    attribute_id uuid NOT NULL REFERENCES control_attributes (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    origin text NOT NULL,
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (procedure_id, attribute_id),
    CONSTRAINT plan_procedure_attributes_origin CHECK (
        origin IN ('AGENT', 'RULES', 'PERSON', 'LIBRARY')
    ),
    CONSTRAINT plan_procedure_attributes_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX plan_procedure_attributes_attribute_idx
    ON plan_procedure_attributes (attribute_id);

CREATE TABLE evidence_requirement_attributes (
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    attribute_id uuid NOT NULL REFERENCES control_attributes (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    origin text NOT NULL,
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (requirement_id, attribute_id),
    CONSTRAINT evidence_requirement_attributes_origin CHECK (
        origin IN ('AGENT', 'RULES', 'PERSON', 'LIBRARY')
    ),
    CONSTRAINT evidence_requirement_attributes_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_requirement_attributes_attribute_idx
    ON evidence_requirement_attributes (attribute_id);

CREATE TABLE evidence_requirement_procedures (
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    procedure_id uuid NOT NULL REFERENCES plan_procedures (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    origin text NOT NULL,
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (requirement_id, procedure_id),
    CONSTRAINT evidence_requirement_procedures_origin CHECK (
        origin IN ('AGENT', 'RULES', 'PERSON', 'LIBRARY')
    ),
    CONSTRAINT evidence_requirement_procedures_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_requirement_procedures_procedure_idx
    ON evidence_requirement_procedures (procedure_id);

-- A requirement named the attributes it supports by their wording: linked to the
-- control's approved attribute with that wording, ignoring case and spacing. Wording that
-- matches no approved attribute stays unlinked, for the reviewer to see.
INSERT INTO evidence_requirement_attributes (
    requirement_id, attribute_id, organization_id, project_id, engagement_control_id, origin
)
SELECT DISTINCT q.id, a.id, q.organization_id, q.project_id, q.engagement_control_id,
       CASE q.origin WHEN 'AGENT' THEN 'AGENT' WHEN 'PERSON' THEN 'PERSON' ELSE 'RULES' END
FROM evidence_requirements q
CROSS JOIN LATERAL jsonb_array_elements_text(q.attributes) AS t(value)
JOIN control_attributes a
  ON a.engagement_control_id = q.engagement_control_id AND a.status = 'APPROVED'
 AND lower(regexp_replace(btrim(a.text), '\s+', ' ', 'g'))
     = lower(regexp_replace(btrim(t.value), '\s+', ' ', 'g'));

-- 6. Plan versions and decisions. Never updated or deleted.

CREATE TABLE plan_versions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_id uuid NOT NULL REFERENCES evidence_plans (id) ON DELETE RESTRICT,
    engagement_control_id uuid NOT NULL,
    revision integer NOT NULL,
    -- The four sections as the reviewer saw them: understanding, procedures, attributes,
    -- evidence, with the links between them.
    content jsonb NOT NULL,
    content_hash text NOT NULL,
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT plan_versions_content CHECK (jsonb_typeof(content) = 'object'),
    CONSTRAINT plan_versions_hash CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT plan_versions_revision CHECK (revision >= 1),
    CONSTRAINT plan_versions_one_revision UNIQUE (plan_id, revision),
    CONSTRAINT plan_versions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE plan_decisions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_id uuid NOT NULL REFERENCES evidence_plans (id) ON DELETE RESTRICT,
    plan_version_id uuid NOT NULL REFERENCES plan_versions (id) ON DELETE RESTRICT,
    engagement_control_id uuid NOT NULL,
    revision integer NOT NULL,
    decision text NOT NULL,
    comment text NOT NULL DEFAULT '',
    -- The traceability findings open when the decision was made, as the reviewer saw them.
    findings jsonb NOT NULL DEFAULT '[]'::jsonb,
    content_hash text NOT NULL,
    decided_by uuid NOT NULL REFERENCES users (id),
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT plan_decisions_decision CHECK (decision IN ('APPROVED', 'CHANGES_REQUESTED')),
    CONSTRAINT plan_decisions_comment CHECK (
        char_length(comment) <= 4000
        AND (decision <> 'CHANGES_REQUESTED' OR char_length(btrim(comment)) >= 10)
    ),
    CONSTRAINT plan_decisions_findings CHECK (jsonb_typeof(findings) = 'array'),
    CONSTRAINT plan_decisions_hash CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT plan_decisions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX plan_decisions_plan_idx ON plan_decisions (plan_id, decided_at DESC);

CREATE FUNCTION reject_plan_record_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER plan_versions_immutable
    BEFORE UPDATE OR DELETE ON plan_versions
    FOR EACH ROW EXECUTE FUNCTION reject_plan_record_change();

CREATE TRIGGER plan_decisions_immutable
    BEFORE UPDATE OR DELETE ON plan_decisions
    FOR EACH ROW EXECUTE FUNCTION reject_plan_record_change();

-- 7. The plan revision downstream work was made under, so work made under an earlier
--    revision is shown as such once the plan is revised.

ALTER TABLE pbc_requests ADD COLUMN plan_revision integer;
ALTER TABLE test_sheets ADD COLUMN plan_revision integer;

-- A test sheet records the approved plan revision it was opened under, whichever path
-- opened it.
CREATE FUNCTION test_sheets_plan_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.plan_revision IS NULL THEN
        SELECT approved_revision INTO NEW.plan_revision
        FROM evidence_plans WHERE engagement_control_id = NEW.engagement_control_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER test_sheets_plan_revision
    BEFORE INSERT ON test_sheets
    FOR EACH ROW EXECUTE FUNCTION test_sheets_plan_revision();

-- 8. A material change revises the plan and sends an approved plan back for review.

CREATE FUNCTION revise_evidence_plan(target uuid) RETURNS void
LANGUAGE sql AS $$
    UPDATE evidence_plans
    SET revision = CASE WHEN revised_txid = txid_current() THEN revision ELSE revision + 1 END,
        version = CASE WHEN revised_txid = txid_current() THEN version ELSE version + 1 END,
        revised_txid = txid_current(),
        status = 'PROPOSED',
        submitted_by = NULL,
        submitted_at = NULL,
        submitted_note = ''
    WHERE id = target;
$$;

CREATE FUNCTION revise_plan_of_control(control uuid) RETURNS void
LANGUAGE sql AS $$
    SELECT revise_evidence_plan(p.id) FROM evidence_plans p WHERE p.engagement_control_id = control;
$$;

-- The control's approved attributes are part of the plan. A proposal is not, until it is
-- decided; reordering is not a change.
CREATE FUNCTION control_attributes_revise_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'APPROVED' THEN
            PERFORM revise_plan_of_control(NEW.engagement_control_id);
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.status = 'APPROVED' THEN
            PERFORM revise_plan_of_control(OLD.engagement_control_id);
        END IF;
    ELSIF (OLD.status = 'APPROVED' OR NEW.status = 'APPROVED')
          AND (OLD.status, OLD.text, OLD.objective, OLD.condition, OLD.pass_criteria,
               OLD.fail_criteria, OLD.judgment_required, OLD.automatable, OLD.phases)
              IS DISTINCT FROM
              (NEW.status, NEW.text, NEW.objective, NEW.condition, NEW.pass_criteria,
               NEW.fail_criteria, NEW.judgment_required, NEW.automatable, NEW.phases) THEN
        PERFORM revise_plan_of_control(NEW.engagement_control_id);
    END IF;
    -- A rewording that takes effect keeps the links of the wording it replaces.
    IF TG_OP <> 'DELETE' AND NEW.status = 'APPROVED' AND NEW.replaces_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.status <> 'APPROVED') THEN
        INSERT INTO plan_procedure_attributes (
            procedure_id, attribute_id, organization_id, project_id, engagement_control_id,
            origin, created_by
        )
        SELECT procedure_id, NEW.id, organization_id, project_id, engagement_control_id,
               origin, created_by
        FROM plan_procedure_attributes WHERE attribute_id = NEW.replaces_id
        ON CONFLICT DO NOTHING;
        INSERT INTO evidence_requirement_attributes (
            requirement_id, attribute_id, organization_id, project_id, engagement_control_id,
            origin, created_by
        )
        SELECT requirement_id, NEW.id, organization_id, project_id, engagement_control_id,
               origin, created_by
        FROM evidence_requirement_attributes WHERE attribute_id = NEW.replaces_id
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER control_attributes_revise_plan
    AFTER INSERT OR UPDATE OR DELETE ON control_attributes
    FOR EACH ROW EXECUTE FUNCTION control_attributes_revise_plan();

-- The control's own facts are the plan's understanding: a change to what the control is
-- revises its plan. Its owner, scope, and bookkeeping are not part of the plan.
CREATE FUNCTION engagement_controls_revise_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.title, OLD.risk, OLD.activity, OLD.frequency, OLD.nature, OLD.domain,
        OLD.key_control, OLD.engagement_application_id, OLD.classifications)
       IS DISTINCT FROM
       (NEW.title, NEW.risk, NEW.activity, NEW.frequency, NEW.nature, NEW.domain,
        NEW.key_control, NEW.engagement_application_id, NEW.classifications) THEN
        PERFORM revise_plan_of_control(NEW.id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER engagement_controls_revise_plan
    AFTER UPDATE ON engagement_controls
    FOR EACH ROW EXECUTE FUNCTION engagement_controls_revise_plan();

CREATE FUNCTION plan_procedures_revise_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.text, OLD.phase, OLD.method, OLD.status)
                            IS NOT DISTINCT FROM (NEW.text, NEW.phase, NEW.method, NEW.status) THEN
        RETURN NULL;
    END IF;
    PERFORM revise_evidence_plan(CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END);
    RETURN NULL;
END;
$$;

CREATE TRIGGER plan_procedures_revise_plan
    AFTER INSERT OR UPDATE OR DELETE ON plan_procedures
    FOR EACH ROW EXECUTE FUNCTION plan_procedures_revise_plan();

CREATE FUNCTION plan_links_revise_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM revise_plan_of_control(
        CASE WHEN TG_OP = 'DELETE' THEN OLD.engagement_control_id ELSE NEW.engagement_control_id END
    );
    RETURN NULL;
END;
$$;

CREATE TRIGGER plan_procedure_attributes_revise_plan
    AFTER INSERT OR DELETE ON plan_procedure_attributes
    FOR EACH ROW EXECUTE FUNCTION plan_links_revise_plan();

CREATE TRIGGER evidence_requirement_attributes_revise_plan
    AFTER INSERT OR DELETE ON evidence_requirement_attributes
    FOR EACH ROW EXECUTE FUNCTION plan_links_revise_plan();

CREATE TRIGGER evidence_requirement_procedures_revise_plan
    AFTER INSERT OR DELETE ON evidence_requirement_procedures
    FOR EACH ROW EXECUTE FUNCTION plan_links_revise_plan();
