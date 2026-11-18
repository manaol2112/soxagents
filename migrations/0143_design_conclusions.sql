-- The D&I conclusion, signed by a reviewer (decided by the product owner on 8 November 2026:
-- "OE can't start if design is failing"; docs/control-workflow-plan.md, B2).
--
-- Until now the design and implementation (D&I) result was only the design workpaper being
-- prepared, with no reviewer step before operating effectiveness. A D&I conclusion is now a
-- sign-off of its own: a team member with the reviewer role, who did not prepare the design
-- workpaper, confirms the verdict the records support (effective, or not effective on a design
-- deficiency) for the workpaper at the version it was prepared at.
--
-- Each sign-off is kept as it was made. Opening it again (by a reviewer with a reason, or
-- because the design workpaper was reopened) marks the row once; nothing else on it ever
-- changes, and no row is deleted (enforced by trigger). At most one sign-off stands per
-- control at a time.
--
-- No backfill: no control has a D&I sign-off today.
--
-- Rollback: DROP TABLE design_conclusions; DROP FUNCTION design_conclusions_immutable();
-- delete the '0143_design_conclusions' row from schema_migrations.

CREATE TABLE design_conclusions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    workpaper_id uuid NOT NULL REFERENCES workpapers (id) ON DELETE RESTRICT,
    -- The design workpaper's prepared version the reviewer concluded on.
    workpaper_version integer NOT NULL,
    verdict text NOT NULL,
    -- The design deficiencies the verdict rests on: [{id, reference, status}].
    deficiencies jsonb NOT NULL DEFAULT '[]'::jsonb,
    signed_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    signed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    signoff_note text NOT NULL DEFAULT '',
    -- Set once, when the conclusion is opened again; the sign-off itself is never changed.
    reopened_at timestamptz,
    reopened_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    reopen_reason text NOT NULL DEFAULT '',
    reopened_from text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT design_conclusions_verdict CHECK (verdict IN ('EFFECTIVE', 'NOT_EFFECTIVE')),
    CONSTRAINT design_conclusions_version CHECK (workpaper_version >= 1),
    CONSTRAINT design_conclusions_deficiencies CHECK (jsonb_typeof(deficiencies) = 'array'),
    CONSTRAINT design_conclusions_note CHECK (char_length(signoff_note) <= 1000),
    CONSTRAINT design_conclusions_reason CHECK (char_length(reopen_reason) <= 500),
    CONSTRAINT design_conclusions_reopened_from CHECK (
        reopened_from IS NULL OR reopened_from IN ('PERSON', 'WORKPAPER', 'SUPERSEDED')
    ),
    CONSTRAINT design_conclusions_reopened_together CHECK (
        (reopened_at IS NULL) = (reopened_from IS NULL)
    ),
    CONSTRAINT design_conclusions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_conclusions_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One standing D&I conclusion per control.
CREATE UNIQUE INDEX design_conclusions_standing
    ON design_conclusions (project_id, engagement_control_id)
    WHERE reopened_at IS NULL;

CREATE INDEX design_conclusions_control_idx
    ON design_conclusions (project_id, engagement_control_id, signed_at DESC);

-- A recorded sign-off is never deleted, and only its reopening is ever written, once.
CREATE FUNCTION design_conclusions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a D&I conclusion is never deleted';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
       OR NEW.workpaper_id IS DISTINCT FROM OLD.workpaper_id
       OR NEW.workpaper_version IS DISTINCT FROM OLD.workpaper_version
       OR NEW.verdict IS DISTINCT FROM OLD.verdict
       OR NEW.deficiencies IS DISTINCT FROM OLD.deficiencies
       OR NEW.signed_by IS DISTINCT FROM OLD.signed_by
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.signoff_note IS DISTINCT FROM OLD.signoff_note
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'a recorded D&I conclusion is never changed';
    END IF;
    IF OLD.reopened_at IS NOT NULL AND (
        NEW.reopened_at IS DISTINCT FROM OLD.reopened_at
        OR NEW.reopened_by IS DISTINCT FROM OLD.reopened_by
        OR NEW.reopen_reason IS DISTINCT FROM OLD.reopen_reason
        OR NEW.reopened_from IS DISTINCT FROM OLD.reopened_from
    ) THEN
        RAISE EXCEPTION 'a D&I conclusion is reopened once; its reopening is never changed';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER design_conclusions_keep BEFORE UPDATE OR DELETE ON design_conclusions
    FOR EACH ROW EXECUTE FUNCTION design_conclusions_immutable();
