-- The engagement workspace: the project plan by phase, the timeline's milestones, the
-- link from each kickoff task to its phase and control, and the deficiency register.

CREATE TABLE engagement_phases (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    phase_key text NOT NULL,
    name text NOT NULL,
    position integer NOT NULL,
    planned_start date NOT NULL,
    planned_end date NOT NULL,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_phases_key CHECK (
        phase_key IN (
            'PLANNING', 'WALKTHROUGHS', 'EVIDENCE', 'INTERIM_TESTING', 'ROLLFORWARD',
            'REMEDIATION', 'REPORTING'
        )
    ),
    CONSTRAINT engagement_phases_dates CHECK (planned_start <= planned_end),
    CONSTRAINT engagement_phases_name CHECK (char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT engagement_phases_unique UNIQUE (project_id, phase_key),
    CONSTRAINT engagement_phases_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE engagement_milestones (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    milestone_key text NOT NULL,
    name text NOT NULL,
    phase_key text NOT NULL,
    position integer NOT NULL,
    due_date date NOT NULL,
    completed_at timestamptz,
    completed_by uuid,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_milestones_key CHECK (char_length(milestone_key) BETWEEN 1 AND 40),
    CONSTRAINT engagement_milestones_name CHECK (char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT engagement_milestones_completed CHECK (
        (completed_at IS NULL) = (completed_by IS NULL)
    ),
    CONSTRAINT engagement_milestones_unique UNIQUE (project_id, milestone_key),
    CONSTRAINT engagement_milestones_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT engagement_milestones_completer_fk
        FOREIGN KEY (completed_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- A kickoff task knows its phase, its control, and what kind of work it is.
ALTER TABLE tasks
    ADD COLUMN phase_key text,
    ADD COLUMN plan_kind text,
    ADD COLUMN engagement_control_id uuid,
    ADD CONSTRAINT tasks_plan_kind CHECK (
        plan_kind IS NULL OR plan_kind IN ('walkthrough', 'evidence', 'test', 'review', 'report')
    ),
    ADD CONSTRAINT tasks_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX tasks_control_idx ON tasks (project_id, engagement_control_id)
    WHERE engagement_control_id IS NOT NULL;

-- Kickoff tasks created before this migration: their phase, kind, and control come from
-- the approved plan, which recorded each task's title, kind, and control.
UPDATE tasks t
SET plan_kind = item->>'kind',
    phase_key = CASE item->>'kind'
        WHEN 'walkthrough' THEN 'WALKTHROUGHS'
        WHEN 'evidence' THEN 'EVIDENCE'
        WHEN 'report' THEN 'REPORTING'
        ELSE 'INTERIM_TESTING'
    END,
    engagement_control_id = NULLIF(item->>'control_id', '')::uuid
FROM engagement_plans p, jsonb_array_elements(p.items) AS item
WHERE p.project_id = t.project_id AND p.status = 'APPROVED'
  AND t.title = item->>'title' AND t.plan_kind IS NULL;

CREATE TABLE deficiencies (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    reference text NOT NULL,
    engagement_control_id uuid,
    title text NOT NULL,
    condition text NOT NULL DEFAULT '',
    criteria text NOT NULL DEFAULT '',
    cause text NOT NULL DEFAULT '',
    effect text NOT NULL DEFAULT '',
    deficiency_type text NOT NULL,
    likelihood text NOT NULL DEFAULT 'REASONABLY_POSSIBLE',
    magnitude text NOT NULL DEFAULT 'MORE_THAN_INCONSEQUENTIAL',
    severity text NOT NULL DEFAULT 'CONTROL_DEFICIENCY',
    compensating_controls text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'OPEN',
    remediation_owner text NOT NULL DEFAULT '',
    remediation_plan text NOT NULL DEFAULT '',
    remediation_due date,
    retest_result text NOT NULL DEFAULT 'NOT_STARTED',
    retested_at date,
    source text NOT NULL DEFAULT 'MANUAL',
    pending_change jsonb,
    identified_by uuid NOT NULL,
    identified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    closed_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT deficiencies_reference CHECK (reference ~ '^D-[0-9]{3,5}$'),
    CONSTRAINT deficiencies_reference_unique UNIQUE (project_id, reference),
    CONSTRAINT deficiencies_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT deficiencies_text CHECK (
        char_length(condition) <= 4000 AND char_length(criteria) <= 4000
        AND char_length(cause) <= 4000 AND char_length(effect) <= 4000
        AND char_length(compensating_controls) <= 4000
        AND char_length(remediation_plan) <= 4000
        AND char_length(remediation_owner) <= 200
    ),
    CONSTRAINT deficiencies_type CHECK (deficiency_type IN ('DESIGN', 'OPERATING')),
    CONSTRAINT deficiencies_likelihood CHECK (
        likelihood IN ('REMOTE', 'REASONABLY_POSSIBLE', 'PROBABLE')
    ),
    CONSTRAINT deficiencies_magnitude CHECK (
        magnitude IN ('INCONSEQUENTIAL', 'MORE_THAN_INCONSEQUENTIAL', 'MATERIAL')
    ),
    CONSTRAINT deficiencies_severity CHECK (
        severity IN ('CONTROL_DEFICIENCY', 'SIGNIFICANT_DEFICIENCY', 'MATERIAL_WEAKNESS')
    ),
    CONSTRAINT deficiencies_status CHECK (
        status IN ('OPEN', 'REMEDIATION_IN_PROGRESS', 'READY_FOR_RETEST', 'REMEDIATED', 'CLOSED')
    ),
    CONSTRAINT deficiencies_retest CHECK (
        retest_result IN ('NOT_STARTED', 'PASSED', 'FAILED')
    ),
    CONSTRAINT deficiencies_source CHECK (source IN ('MANUAL', 'TESTING')),
    CONSTRAINT deficiencies_closed CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CONSTRAINT deficiencies_pending CHECK (
        pending_change IS NULL OR jsonb_typeof(pending_change) = 'object'
    ),
    CONSTRAINT deficiencies_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT deficiencies_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT deficiencies_identifier_fk
        FOREIGN KEY (identified_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX deficiencies_project_idx ON deficiencies (project_id, status);
