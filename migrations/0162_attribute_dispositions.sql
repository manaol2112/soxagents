-- Tickmarks: a person's disposition of an attribute (docs/evidence-assurance.md, section
-- 10.13; asked for by the product owner on 14 November 2026: "The user should be able to
-- close this by providing ... additional evidence, add a tickmark, or link an existing
-- evidence", and "it's okay for the evidence to be missing ... I dont want those to be
-- blocker").
--
-- The check proposes; a person concludes. attribute_dispositions keeps one row per
-- disposition a person records for one attribute on one D&I request whose check is
-- finished and current:
--
--   kind        SHOWN_ON_REVIEW (the evidence shows it and the check did not find it; it
--               rests on an annotation a person made, confirmed or edited), NOT_APPLICABLE,
--               NOT_AVAILABLE (may say what was relied on instead) or EXCEPTION (closes
--               nothing: the attribute keeps waiting);
--   reason      the person's own, always;
--   assessment  the run that was current when it was recorded;
--   ended_*     a disposition is never deleted and never rewritten. It ends once, as
--               REPLACED (the person recorded another), REOPENED (a person, with a
--               reason), SUPERSEDED_BY_CHECK (a later check found the attribute supported),
--               OVERTAKEN_BY_CHECK (a later check found the records contradict it) or
--               ANNOTATION_GONE (the annotation it rests on was removed, or its file is no
--               longer in force on the request). ended_by is null where a check ended it.
--
-- One row stands (ended_at IS NULL) per request and attribute. Nothing here changes what a
-- check found: no run, finding, follow-up, annotation or acceptance is written by a
-- disposition, and no existing table or row is changed by this migration.
--
-- Additive: one table, two guard functions.
--
-- Rollback: DROP TABLE attribute_dispositions; DROP FUNCTION
-- guard_attribute_disposition_update(), prevent_attribute_disposition_deletion(); delete
-- the audit events whose action starts with 'evidence.attribute_disposition' only if the
-- firm's retention allows it (they are otherwise kept: they name no table); delete the
-- '0162_attribute_dispositions' row from schema_migrations.

CREATE TABLE attribute_dispositions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    attribute_id uuid NOT NULL REFERENCES control_attributes (id) ON DELETE RESTRICT,
    kind text NOT NULL,
    reason text NOT NULL,
    -- What was relied on instead, for NOT_AVAILABLE; '' otherwise.
    relied_on text NOT NULL DEFAULT '',
    -- The person's annotation it rests on; null unless SHOWN_ON_REVIEW.
    annotation_id uuid REFERENCES evidence_annotations (id) ON DELETE RESTRICT,
    -- The run that was current when it was recorded.
    assessment_id uuid NOT NULL REFERENCES evidence_assessments (id) ON DELETE RESTRICT,
    recorded_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ended_at timestamptz,
    -- Null where a check ended it.
    ended_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ended_as text,
    ended_reason text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT attribute_dispositions_kind CHECK (
        kind IN ('SHOWN_ON_REVIEW', 'NOT_APPLICABLE', 'NOT_AVAILABLE', 'EXCEPTION')
    ),
    CONSTRAINT attribute_dispositions_reason CHECK (
        char_length(btrim(reason)) >= 10 AND char_length(reason) <= 1000
    ),
    CONSTRAINT attribute_dispositions_relied_on CHECK (
        char_length(relied_on) <= 600 AND (kind = 'NOT_AVAILABLE' OR relied_on = '')
    ),
    -- "Shown, on my review" always rests on an annotation; no other kind names one.
    CONSTRAINT attribute_dispositions_annotation CHECK (
        (kind = 'SHOWN_ON_REVIEW') = (annotation_id IS NOT NULL)
    ),
    CONSTRAINT attribute_dispositions_ended_as CHECK (
        ended_as IS NULL OR ended_as IN (
            'REPLACED', 'REOPENED', 'SUPERSEDED_BY_CHECK', 'OVERTAKEN_BY_CHECK',
            'ANNOTATION_GONE'
        )
    ),
    -- Ended once, with how; what stands names no ending.
    CONSTRAINT attribute_dispositions_ended CHECK (
        (ended_at IS NULL) = (ended_as IS NULL)
        AND (ended_at IS NOT NULL OR (ended_by IS NULL AND ended_reason = ''))
        AND (ended_at IS NULL OR ended_at >= recorded_at)
    ),
    -- A person replaces and reopens; a check that ends one names nobody. A reopening
    -- always gives its reason.
    CONSTRAINT attribute_dispositions_ended_by CHECK (
        ended_as IS NULL
        OR (ended_as IN ('REPLACED', 'REOPENED') AND ended_by IS NOT NULL)
        OR (ended_as IN ('SUPERSEDED_BY_CHECK', 'OVERTAKEN_BY_CHECK') AND ended_by IS NULL)
        OR ended_as = 'ANNOTATION_GONE'
    ),
    CONSTRAINT attribute_dispositions_ended_reason CHECK (
        char_length(ended_reason) <= 1000
        AND (ended_as IS DISTINCT FROM 'REOPENED' OR char_length(btrim(ended_reason)) >= 10)
    ),
    CONSTRAINT attribute_dispositions_version CHECK (version >= 1),
    CONSTRAINT attribute_dispositions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT attribute_dispositions_control_fk
        FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One standing disposition per request and attribute.
CREATE UNIQUE INDEX attribute_dispositions_standing
    ON attribute_dispositions (requirement_id, attribute_id) WHERE ended_at IS NULL;
-- What stands on a control (the D&I list and the workpaper read it once per control).
CREATE INDEX attribute_dispositions_control_standing_idx
    ON attribute_dispositions (engagement_control_id) WHERE ended_at IS NULL;
-- The history of a request's attributes, newest first.
CREATE INDEX attribute_dispositions_history_idx
    ON attribute_dispositions (engagement_control_id, requirement_id, attribute_id, ended_at DESC)
    WHERE ended_at IS NOT NULL;
-- What rests on an annotation, looked up when the annotation is removed or changed.
CREATE INDEX attribute_dispositions_annotation_idx
    ON attribute_dispositions (annotation_id) WHERE annotation_id IS NOT NULL;
CREATE INDEX attribute_dispositions_assessment_idx ON attribute_dispositions (assessment_id);
CREATE INDEX attribute_dispositions_attribute_idx ON attribute_dispositions (attribute_id);
CREATE INDEX attribute_dispositions_project_idx ON attribute_dispositions (project_id);

-- A disposition is written once. The only change it ever takes is its ending: the four
-- ended_* columns, set once, with its version moved on.
CREATE FUNCTION guard_attribute_disposition_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'an ended attribute disposition is never changed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.requirement_id IS DISTINCT FROM OLD.requirement_id
        OR NEW.attribute_id IS DISTINCT FROM OLD.attribute_id
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.relied_on IS DISTINCT FROM OLD.relied_on
        OR NEW.annotation_id IS DISTINCT FROM OLD.annotation_id
        OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
        OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
        OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
    THEN
        RAISE EXCEPTION 'what an attribute disposition records never changes';
    END IF;
    IF NEW.ended_at IS NULL THEN
        RAISE EXCEPTION 'an attribute disposition changes only by ending';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'an attribute disposition''s version moves on by one when it ends';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER attribute_dispositions_guard
BEFORE UPDATE ON attribute_dispositions
FOR EACH ROW EXECUTE FUNCTION guard_attribute_disposition_update();

CREATE FUNCTION prevent_attribute_disposition_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'an attribute disposition is ended, never deleted';
END;
$$;

CREATE TRIGGER attribute_dispositions_kept
BEFORE DELETE ON attribute_dispositions
FOR EACH ROW EXECUTE FUNCTION prevent_attribute_disposition_deletion();

-- An archived engagement's dispositions are read-only (migration 0136).
CREATE TRIGGER attribute_dispositions_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON attribute_dispositions
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
