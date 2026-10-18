-- Control statements (Milestone 8.9, library version 3).
--
-- A library control's statement (statement_registry.py) names what only the client knows:
-- a threshold, a deadline, a role, a report. Each is a slot the team fills at setup. This
-- table holds the values, one row per control and slot; the slot itself (its label, kind,
-- and whether testing waits for it) comes from the control's statement in code, so a value
-- is only stored, never interpreted here.
--
-- Additive only: a new table. Controls without a statement have no rows.
--
-- Rollback: DROP TABLE control_parameters; and delete the '0064_control_parameters' row
-- from schema_migrations.

CREATE TABLE control_parameters (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    slot_key text NOT NULL,
    value text NOT NULL DEFAULT '',
    filled_by uuid,
    filled_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_parameters_key CHECK (slot_key ~ '^[a-z][a-z0-9-]{1,40}$'),
    CONSTRAINT control_parameters_value CHECK (char_length(value) <= 300),
    -- A value is present exactly when someone filled it; clearing it clears both.
    CONSTRAINT control_parameters_filled CHECK ((value = '') = (filled_at IS NULL)),
    CONSTRAINT control_parameters_version CHECK (version >= 1),
    CONSTRAINT control_parameters_one_per_slot UNIQUE (engagement_control_id, slot_key),
    CONSTRAINT control_parameters_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT control_parameters_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT control_parameters_filled_fk
        FOREIGN KEY (filled_by) REFERENCES users (id)
);

CREATE INDEX control_parameters_project_idx ON control_parameters (project_id, slot_key);

CREATE TRIGGER control_parameters_updated_at
    BEFORE UPDATE ON control_parameters
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
