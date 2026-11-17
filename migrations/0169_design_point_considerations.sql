-- No "Matters for the reviewer": each point is settled where it belongs (docs/design-workpaper.md,
-- section 3.9; decided by the product owner on 16 November 2026: "Okay proceed" to the
-- prototype, and, asked how a point with no action of its own is cleared, "Considered, with
-- reason").
--
-- A point of the D&I workpaper (a check out of date, an open finding, an attribute not
-- concluded, and so on) is assembled on each read and settled either by its own action,
-- after which it is no longer assembled, or by a person's consideration with a reason.
-- design_point_considerations keeps one row per consideration recorded:
--
--   engagement_control_id, workpaper_id   the control and its design workpaper;
--   point_key        32 lowercase hexadecimal characters: the point's key (the SHA-256 of
--                    its kind and of what it is about), the same on every read while the
--                    point is the same;
--   point_kind       the point's kind;
--   point_text       the point's sentence when it was considered, at most 2,000 characters;
--   reason           the person's own, 10 to 1,000 characters;
--   considered_by, considered_at   who considered it and when;
--   ended_*          a consideration is never deleted and never rewritten. It ends once, as
--                    WITHDRAWN by a person.
--
-- One consideration stands (ended_at IS NULL) per workpaper and point key. A consideration
-- is recorded, in its control's own engagement, on the control's design workpaper while it
-- is a draft (the insert guard). An archived engagement's considerations are read-only
-- (migration 0136).
--
-- Additive: one table, its three guard functions and four triggers. No existing table, row
-- or function is changed.
--
-- Rollback: DROP TABLE design_point_considerations; DROP FUNCTION
-- guard_design_point_consideration_insert(), guard_design_point_consideration_update(),
-- prevent_design_point_consideration_deletion(); delete the audit events whose action
-- starts with 'design_point.' only if the firm's retention allows it (they are otherwise
-- kept: they name no table); delete the '0169_design_point_considerations' row from
-- schema_migrations. A rollback loses the considerations and their reasons: every point is
-- then unsettled again, and a design workpaper that has one is prepared only once it is
-- settled by its own action or considered again.

CREATE TABLE design_point_considerations (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    workpaper_id uuid NOT NULL,
    point_key text NOT NULL,
    point_kind text NOT NULL,
    point_text text NOT NULL,
    reason text NOT NULL,
    considered_by uuid NOT NULL,
    considered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ended_at timestamptz,
    ended_by uuid,
    ended_as text,
    CONSTRAINT design_point_considerations_key CHECK (point_key ~ '^[0-9a-f]{32}$'),
    CONSTRAINT design_point_considerations_kind CHECK (
        point_kind IN (
            'STALE', 'FINDING', 'NOT_CONCLUDED', 'NOT_RELIED', 'CONFLICT', 'HELD',
            'COMPLETENESS', 'FOLLOW_UP'
        )
    ),
    CONSTRAINT design_point_considerations_text CHECK (
        char_length(btrim(point_text)) >= 1 AND char_length(point_text) <= 2000
    ),
    CONSTRAINT design_point_considerations_reason CHECK (
        char_length(btrim(reason)) >= 10 AND char_length(reason) <= 1000
    ),
    CONSTRAINT design_point_considerations_ended_as CHECK (
        ended_as IS NULL OR ended_as = 'WITHDRAWN'
    ),
    -- Ended once, by a person, at or after it was recorded; what stands names no ending.
    CONSTRAINT design_point_considerations_ended CHECK (
        (ended_at IS NULL) = (ended_as IS NULL)
        AND (ended_at IS NULL) = (ended_by IS NULL)
        AND (ended_at IS NULL OR ended_at >= considered_at)
    ),
    CONSTRAINT design_point_considerations_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_point_considerations_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_point_considerations_workpaper_fk
        FOREIGN KEY (workpaper_id) REFERENCES workpapers (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_point_considerations_considered_by_fk
        FOREIGN KEY (considered_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_point_considerations_ended_by_fk
        FOREIGN KEY (ended_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One standing consideration per workpaper and point.
CREATE UNIQUE INDEX design_point_considerations_standing
    ON design_point_considerations (workpaper_id, point_key) WHERE ended_at IS NULL;
-- A control's considerations, newest first (the history and the audit trail).
CREATE INDEX design_point_considerations_control_idx
    ON design_point_considerations (project_id, engagement_control_id, considered_at DESC);

-- A consideration is recorded standing, in its control's own engagement, on the control's
-- design workpaper while it is a draft. (A workpaper that does not exist is refused by the
-- foreign key.)
CREATE FUNCTION guard_design_point_consideration_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    paper record;
BEGIN
    SELECT w.organization_id, w.project_id, w.engagement_control_id, w.stage, w.status
    INTO paper
    FROM public.workpapers AS w
    WHERE w.id = NEW.workpaper_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF paper.organization_id IS DISTINCT FROM NEW.organization_id
        OR paper.project_id IS DISTINCT FROM NEW.project_id
        OR paper.engagement_control_id IS DISTINCT FROM NEW.engagement_control_id
        OR paper.stage IS DISTINCT FROM 'DESIGN'
    THEN
        RAISE EXCEPTION 'a D&I point is considered on its control''s design workpaper';
    END IF;
    IF paper.status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'a D&I point is considered while the design workpaper is a draft';
    END IF;
    IF NEW.ended_at IS NOT NULL OR NEW.ended_by IS NOT NULL OR NEW.ended_as IS NOT NULL THEN
        RAISE EXCEPTION 'a D&I point''s consideration is recorded standing';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER design_point_considerations_recorded
BEFORE INSERT ON design_point_considerations
FOR EACH ROW EXECUTE FUNCTION guard_design_point_consideration_insert();

-- What a consideration records never changes. It ends once (the three ended_* columns, set
-- together), and an ended consideration is never changed.
CREATE FUNCTION guard_design_point_consideration_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'an ended D&I point consideration is never changed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.workpaper_id IS DISTINCT FROM OLD.workpaper_id
        OR NEW.point_key IS DISTINCT FROM OLD.point_key
        OR NEW.point_kind IS DISTINCT FROM OLD.point_kind
        OR NEW.point_text IS DISTINCT FROM OLD.point_text
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.considered_by IS DISTINCT FROM OLD.considered_by
        OR NEW.considered_at IS DISTINCT FROM OLD.considered_at
    THEN
        RAISE EXCEPTION 'what a D&I point consideration records never changes';
    END IF;
    IF NEW.ended_at IS NULL THEN
        RAISE EXCEPTION 'a D&I point consideration changes only by ending';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER design_point_considerations_guard
BEFORE UPDATE ON design_point_considerations
FOR EACH ROW EXECUTE FUNCTION guard_design_point_consideration_update();

CREATE FUNCTION prevent_design_point_consideration_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a D&I point consideration is ended, never deleted';
END;
$$;

CREATE TRIGGER design_point_considerations_kept
BEFORE DELETE ON design_point_considerations
FOR EACH ROW EXECUTE FUNCTION prevent_design_point_consideration_deletion();

-- An archived engagement's considerations are read-only (migration 0136). This trigger
-- fires before the guards above (triggers of one event fire in name order), so a write
-- there is refused as archived.
CREATE TRIGGER design_point_considerations_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON design_point_considerations
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
