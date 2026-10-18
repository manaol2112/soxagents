-- Roll-forward and remediation retests (Milestone 8.4).
--
-- Interim testing is a control's first round, kept as before: its test plan and sheet
-- have no round. Once interim testing is signed off effective, a roll-forward round
-- covers the rest of the period: the owner confirms nothing changed and provides the
-- population for the remaining period, and the tester tests an update sample. Once a
-- deficiency is ready for retest, a retest round tests a sample drawn only from after
-- the fix took effect, once the control has operated long enough. Each round owns its
-- evidence request, its task, its test plan, and its test sheet.

CREATE TABLE test_rounds (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    kind text NOT NULL,
    number integer NOT NULL DEFAULT 1,
    -- REQUESTED until the tester opens its sheet, TESTING until it is signed off.
    status text NOT NULL DEFAULT 'REQUESTED',
    method text NOT NULL,
    -- The instances the round samples from, and the first day testing may start.
    window_start date NOT NULL,
    window_end date NOT NULL,
    test_from date NOT NULL,
    sample_size integer NOT NULL,
    deficiency_id uuid,
    request_id uuid,
    task_id uuid,
    conclusion text,
    cancel_reason text NOT NULL DEFAULT '',
    requested_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT test_rounds_kind CHECK (kind IN ('ROLLFORWARD', 'RETEST')),
    CONSTRAINT test_rounds_status CHECK (
        status IN ('REQUESTED', 'TESTING', 'SIGNED_OFF', 'CANCELLED')
    ),
    CONSTRAINT test_rounds_method CHECK (method IN ('SAMPLE', 'TEST_OF_ONE')),
    CONSTRAINT test_rounds_window CHECK (
        window_start <= window_end AND window_start <= test_from
    ),
    CONSTRAINT test_rounds_size CHECK (sample_size BETWEEN 1 AND 200),
    CONSTRAINT test_rounds_number CHECK (number >= 1),
    CONSTRAINT test_rounds_retest CHECK ((kind = 'RETEST') = (deficiency_id IS NOT NULL)),
    CONSTRAINT test_rounds_conclusion CHECK (
        (status = 'SIGNED_OFF') = (conclusion IS NOT NULL)
        AND (conclusion IS NULL OR conclusion IN ('EFFECTIVE', 'NOT_EFFECTIVE'))
    ),
    CONSTRAINT test_rounds_cancel CHECK (char_length(cancel_reason) <= 500),
    CONSTRAINT test_rounds_key UNIQUE (project_id, engagement_control_id, kind, number),
    CONSTRAINT test_rounds_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_rounds_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_rounds_deficiency_fk
        FOREIGN KEY (deficiency_id) REFERENCES deficiencies (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_rounds_request_fk
        FOREIGN KEY (request_id) REFERENCES pbc_requests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_rounds_task_fk
        FOREIGN KEY (task_id) REFERENCES tasks (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT test_rounds_requester_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One round of each kind in flight per control.
CREATE UNIQUE INDEX test_rounds_one_open
    ON test_rounds (project_id, engagement_control_id, kind)
    WHERE status IN ('REQUESTED', 'TESTING');
CREATE INDEX test_rounds_request_idx ON test_rounds (request_id) WHERE request_id IS NOT NULL;

CREATE TRIGGER test_rounds_updated_at
    BEFORE UPDATE ON test_rounds
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A plan and a sheet belong to a round, or to interim testing when they have none.
ALTER TABLE control_tests
    ADD COLUMN test_round_id uuid,
    -- The last instance date the population covered, so roll-forward starts after it.
    ADD COLUMN covered_to date,
    ADD CONSTRAINT control_tests_round_fk
        FOREIGN KEY (test_round_id) REFERENCES test_rounds (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    DROP CONSTRAINT control_tests_one_per_control;
CREATE UNIQUE INDEX control_tests_interim_once
    ON control_tests (project_id, engagement_control_id) WHERE test_round_id IS NULL;
CREATE UNIQUE INDEX control_tests_round_once
    ON control_tests (test_round_id) WHERE test_round_id IS NOT NULL;

ALTER TABLE test_sheets
    ADD COLUMN test_round_id uuid,
    ADD CONSTRAINT test_sheets_round_fk
        FOREIGN KEY (test_round_id) REFERENCES test_rounds (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    DROP CONSTRAINT test_sheets_one_per_control;
CREATE UNIQUE INDEX test_sheets_interim_once
    ON test_sheets (project_id, engagement_control_id) WHERE test_round_id IS NULL;
CREATE UNIQUE INDEX test_sheets_round_once
    ON test_sheets (test_round_id) WHERE test_round_id IS NOT NULL;

-- The remediation request to the owner, and the date the fix took effect.
ALTER TABLE deficiencies
    ADD COLUMN remediated_on date,
    ADD COLUMN remediation_request_id uuid,
    ADD CONSTRAINT deficiencies_remediation_request_fk
        FOREIGN KEY (remediation_request_id) REFERENCES pbc_requests (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE tasks DROP CONSTRAINT tasks_plan_kind;
ALTER TABLE tasks ADD CONSTRAINT tasks_plan_kind CHECK (
    plan_kind IS NULL OR plan_kind IN (
        'walkthrough', 'evidence', 'test', 'review', 'report',
        'rollforward', 'remediation', 'retest'
    )
);
