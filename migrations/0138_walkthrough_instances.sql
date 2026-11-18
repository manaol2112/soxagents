-- The walkthrough instance an auditor picks from a population for a design item (decided
-- by the product owner on 31 October 2026: "If the file is uploaded in D&I section but
-- looks like a population, the agent should ask the user if he/she wants to pick a sample
-- of one from the list"; the auditor picks the row and uploads that instance's evidence).
--
-- One row per pick: the design item it is for, the population file and its hash at the
-- time, the row (its number, key and values as read), and the person. A later pick for the
-- same item supersedes the earlier one, which stays on record with who replaced it and
-- when; nothing else of a pick ever changes, and a pick is never deleted.
--
-- Rollback: DROP TABLE walkthrough_instances; DROP FUNCTION
-- guard_walkthrough_instance_change(); delete the '0138_walkthrough_instances' row from
-- schema_migrations.

CREATE TABLE walkthrough_instances (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    population_file_id uuid NOT NULL REFERENCES evidence_files (id) ON DELETE RESTRICT,
    population_sha256 text NOT NULL,
    row_number integer NOT NULL,
    key_column text NOT NULL DEFAULT '',
    key_value text NOT NULL DEFAULT '',
    columns jsonb NOT NULL,
    row_values jsonb NOT NULL,
    note text NOT NULL DEFAULT '',
    selected_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    superseded_at timestamptz,
    superseded_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT walkthrough_instances_row CHECK (row_number >= 1),
    CONSTRAINT walkthrough_instances_hash CHECK (population_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT walkthrough_instances_values CHECK (
        jsonb_typeof(columns) = 'array' AND jsonb_typeof(row_values) = 'array'
    ),
    CONSTRAINT walkthrough_instances_text CHECK (
        char_length(key_column) <= 200 AND char_length(key_value) <= 500
        AND char_length(note) <= 500
    ),
    CONSTRAINT walkthrough_instances_superseded CHECK (
        (superseded_at IS NULL) = (superseded_by IS NULL)
    ),
    CONSTRAINT walkthrough_instances_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT walkthrough_instances_control_fk
        FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One current pick per design item.
CREATE UNIQUE INDEX walkthrough_instances_current
    ON walkthrough_instances (requirement_id) WHERE superseded_at IS NULL;
CREATE INDEX walkthrough_instances_control_idx
    ON walkthrough_instances (engagement_control_id, created_at DESC);

-- A pick is never deleted, and only its supersession is ever recorded on it, once.
CREATE FUNCTION guard_walkthrough_instance_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a walkthrough instance is superseded, never deleted';
    END IF;
    IF OLD.superseded_at IS NOT NULL
       OR NEW.superseded_at IS NULL
       OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by')
          IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by') THEN
        RAISE EXCEPTION 'a walkthrough instance is only ever superseded';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER walkthrough_instances_kept
BEFORE UPDATE OR DELETE ON walkthrough_instances
FOR EACH ROW EXECUTE FUNCTION guard_walkthrough_instance_change();

-- An archived engagement's picks are read-only (migration 0136).
CREATE TRIGGER walkthrough_instances_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON walkthrough_instances
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
