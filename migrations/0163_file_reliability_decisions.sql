-- A person's decision on a file's reliability (docs/evidence-assurance.md, section 10.14,
-- part B; asked for by the product owner on 14 November 2026: "Okay build both").
--
-- The check proposes; a person concludes. Where the current, finished check of a D&I
-- request leaves a file's reliability not established (a source prepared by a person or
-- not shown, a report that does not show its source, run date or parameters, or shows
-- them in part), file_reliability_decisions keeps one row per decision a person records
-- on that file for that request:
--
--   kind        ESTABLISHED_ON_REVIEW (the person established the report's completeness
--               and accuracy another way, and says what was relied on: always given) or
--               NOT_RELIED_ON (the conclusion does not depend on this file);
--   reason      the person's own, always;
--   assessment  the run that was current when it was recorded;
--   ended_*     a decision is never deleted and never rewritten. It ends once, as
--               REPLACED (a person recorded another), REOPENED (a person, with a reason)
--               or FILE_GONE (the file is no longer in force on the request: withdrawn,
--               replaced, unlinked). ended_by is null where the file's going ended it. A
--               later check never ends a decision: the file's content is unchanged.
--
-- One row stands (ended_at IS NULL) per request and file. Nothing here changes what a
-- check found: no run, review, finding, follow-up, annotation or acceptance is written by
-- a decision, and no existing table or row is changed by this migration.
--
-- Additive: one table, two guard functions.
--
-- Rollback: DROP TABLE file_reliability_decisions; DROP FUNCTION
-- guard_file_reliability_decision_update(), prevent_file_reliability_decision_deletion();
-- delete the audit events whose action starts with 'evidence.file_reliability' only if the
-- firm's retention allows it (they are otherwise kept: they name no table); delete the
-- '0163_file_reliability_decisions' row from schema_migrations.

CREATE TABLE file_reliability_decisions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    evidence_file_id uuid NOT NULL REFERENCES evidence_files (id) ON DELETE RESTRICT,
    kind text NOT NULL,
    reason text NOT NULL,
    -- What the person relied on to establish the file's reliability, for
    -- ESTABLISHED_ON_REVIEW; '' for NOT_RELIED_ON.
    relied_on text NOT NULL DEFAULT '',
    -- The run that was current when it was recorded.
    assessment_id uuid NOT NULL REFERENCES evidence_assessments (id) ON DELETE RESTRICT,
    recorded_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ended_at timestamptz,
    -- Null where the file's going ended it.
    ended_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ended_as text,
    ended_reason text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT file_reliability_decisions_kind CHECK (
        kind IN ('ESTABLISHED_ON_REVIEW', 'NOT_RELIED_ON')
    ),
    CONSTRAINT file_reliability_decisions_reason CHECK (
        char_length(btrim(reason)) >= 10 AND char_length(reason) <= 1000
    ),
    -- Established on review always says what was relied on; not relied on says nothing.
    CONSTRAINT file_reliability_decisions_relied_on CHECK (
        char_length(relied_on) <= 600
        AND (
            (kind = 'ESTABLISHED_ON_REVIEW' AND char_length(btrim(relied_on)) >= 10)
            OR (kind = 'NOT_RELIED_ON' AND relied_on = '')
        )
    ),
    CONSTRAINT file_reliability_decisions_ended_as CHECK (
        ended_as IS NULL OR ended_as IN ('REPLACED', 'REOPENED', 'FILE_GONE')
    ),
    -- Ended once, with how; what stands names no ending.
    CONSTRAINT file_reliability_decisions_ended CHECK (
        (ended_at IS NULL) = (ended_as IS NULL)
        AND (ended_at IS NOT NULL OR (ended_by IS NULL AND ended_reason = ''))
        AND (ended_at IS NULL OR ended_at >= recorded_at)
    ),
    -- A person replaces and reopens; the file's going names nobody.
    CONSTRAINT file_reliability_decisions_ended_by CHECK (
        ended_as IS NULL
        OR (ended_as IN ('REPLACED', 'REOPENED') AND ended_by IS NOT NULL)
        OR (ended_as = 'FILE_GONE' AND ended_by IS NULL)
    ),
    -- A reopening always gives its reason.
    CONSTRAINT file_reliability_decisions_ended_reason CHECK (
        char_length(ended_reason) <= 1000
        AND (ended_as IS DISTINCT FROM 'REOPENED' OR char_length(btrim(ended_reason)) >= 10)
    ),
    CONSTRAINT file_reliability_decisions_version CHECK (version >= 1),
    CONSTRAINT file_reliability_decisions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT file_reliability_decisions_control_fk
        FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One standing decision per request and file.
CREATE UNIQUE INDEX file_reliability_decisions_standing
    ON file_reliability_decisions (requirement_id, evidence_file_id) WHERE ended_at IS NULL;
-- What stands on a control (the D&I list and the workpaper read it once per control).
CREATE INDEX file_reliability_decisions_control_standing_idx
    ON file_reliability_decisions (engagement_control_id) WHERE ended_at IS NULL;
-- The history of a request's files, newest first.
CREATE INDEX file_reliability_decisions_history_idx
    ON file_reliability_decisions (
        engagement_control_id, requirement_id, evidence_file_id, ended_at DESC
    )
    WHERE ended_at IS NOT NULL;
CREATE INDEX file_reliability_decisions_file_idx
    ON file_reliability_decisions (evidence_file_id);
CREATE INDEX file_reliability_decisions_assessment_idx
    ON file_reliability_decisions (assessment_id);
CREATE INDEX file_reliability_decisions_project_idx ON file_reliability_decisions (project_id);

-- A decision is written once. The only change it ever takes is its ending: the four
-- ended_* columns, set once, with its version moved on.
CREATE FUNCTION guard_file_reliability_decision_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'an ended file reliability decision is never changed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.requirement_id IS DISTINCT FROM OLD.requirement_id
        OR NEW.evidence_file_id IS DISTINCT FROM OLD.evidence_file_id
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.relied_on IS DISTINCT FROM OLD.relied_on
        OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
        OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
        OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
    THEN
        RAISE EXCEPTION 'what a file reliability decision records never changes';
    END IF;
    IF NEW.ended_at IS NULL THEN
        RAISE EXCEPTION 'a file reliability decision changes only by ending';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'a file reliability decision''s version moves on by one when it ends';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER file_reliability_decisions_guard
BEFORE UPDATE ON file_reliability_decisions
FOR EACH ROW EXECUTE FUNCTION guard_file_reliability_decision_update();

CREATE FUNCTION prevent_file_reliability_decision_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a file reliability decision is ended, never deleted';
END;
$$;

CREATE TRIGGER file_reliability_decisions_kept
BEFORE DELETE ON file_reliability_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_file_reliability_decision_deletion();

-- An archived engagement's decisions are read-only (migration 0136).
CREATE TRIGGER file_reliability_decisions_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON file_reliability_decisions
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
