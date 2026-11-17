-- Redraft a section a person has edited (docs/design-workpaper.md, section 3.11; approved by
-- the product owner on 16 November 2026 after a prototype: "Okay build it after the
-- reorder").
--
-- "Draft again" never replaces a section a person saved. Instead, the person asks the agent
-- to redraft one text section from its editor: one registered agent run drafts that section
-- and proposes the text beside the person's own. Nothing in the workpaper changes: the
-- proposal is the agent's, and only the person's own save of the section makes a version.
-- workpaper_section_proposals keeps one row per request:
--
--   workpaper_id, section_key   the workpaper and the section asked for;
--   based_on       the workpaper version (current_version) it was drafted from, 1 or later;
--   requested_by, requested_at  who asked and when;
--   status         PENDING while the agent drafts, then READY or FAILED, once;
--   text, citations, words, removed_note   the agent's draft (READY only): the text cleaned
--                  and its citations checked against their files as a draft's are, how many
--                  words it has, and the sentence that says how many quotations whose words
--                  were not found were removed (section 3.10), or '';
--   failure        one plain sentence (FAILED only);
--   ready_at, failed_at   when it became READY or FAILED;
--   run_id         the agent run's job id (model_calls.job_id), once it ran;
--   ended_*        a proposal is never deleted and never rewritten. It ends once: USED (the
--                  person saved the section from it), KEPT_MINE (the person kept their own
--                  text) or SUPERSEDED (a newer request, or a version of the section saved
--                  on another basis).
--
-- One proposal stands (ended_at IS NULL) per workpaper, section and person who asked. It is
-- recorded, in its workpaper's own engagement, while the workpaper is a draft (the insert
-- guard). An archived engagement's proposals are read-only (migration 0136).
--
-- Additive: one table, its three guard functions and four triggers. No existing table, row
-- or function is changed.
--
-- Rollback: DROP TABLE workpaper_section_proposals; DROP FUNCTION
-- guard_workpaper_section_proposal_insert(), guard_workpaper_section_proposal_update(),
-- prevent_workpaper_section_proposal_deletion(); delete the audit events whose action starts
-- with 'workpaper.redraft' only if the firm's retention allows it (they are otherwise kept:
-- they name no table); delete the '0170_workpaper_section_proposals' row from
-- schema_migrations. A rollback loses the proposals: a section saved from one keeps its
-- version, its note ("From the agent's draft of ...") and its audit event, which names the
-- proposal's id.

CREATE TABLE workpaper_section_proposals (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    workpaper_id uuid NOT NULL,
    section_key text NOT NULL,
    based_on integer NOT NULL,
    requested_by uuid NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    status text NOT NULL DEFAULT 'PENDING',
    text text NOT NULL DEFAULT '',
    citations jsonb NOT NULL DEFAULT '[]'::jsonb,
    words integer NOT NULL DEFAULT 0,
    removed_note text NOT NULL DEFAULT '',
    failure text NOT NULL DEFAULT '',
    ready_at timestamptz,
    failed_at timestamptz,
    run_id uuid,
    ended_at timestamptz,
    ended_by uuid,
    ended_as text,
    CONSTRAINT workpaper_section_proposals_section CHECK (
        char_length(section_key) BETWEEN 1 AND 60
    ),
    CONSTRAINT workpaper_section_proposals_based_on CHECK (based_on >= 1),
    CONSTRAINT workpaper_section_proposals_status CHECK (
        status IN ('PENDING', 'READY', 'FAILED')
    ),
    -- Within a text section's limits (12,000 characters; the citation check keeps 40).
    CONSTRAINT workpaper_section_proposals_lengths CHECK (
        char_length(text) <= 12000
        AND char_length(removed_note) <= 500
        AND char_length(failure) <= 500
        AND words BETWEEN 0 AND 12000
        -- The length is read only of an array (a scalar has none: refused, not an error).
        AND CASE
            WHEN jsonb_typeof(citations) = 'array' THEN jsonb_array_length(citations) <= 40
            ELSE false
        END
    ),
    -- What each status holds: nothing yet while PENDING; a text and when while READY; one
    -- sentence and when while FAILED.
    CONSTRAINT workpaper_section_proposals_shape CHECK (
        CASE status
            WHEN 'PENDING' THEN
                text = '' AND citations = '[]'::jsonb AND words = 0 AND removed_note = ''
                AND failure = '' AND ready_at IS NULL AND failed_at IS NULL
            WHEN 'READY' THEN
                char_length(btrim(text)) >= 1 AND failure = '' AND ready_at IS NOT NULL
                AND failed_at IS NULL AND ready_at >= requested_at
            WHEN 'FAILED' THEN
                text = '' AND citations = '[]'::jsonb AND words = 0 AND removed_note = ''
                AND char_length(btrim(failure)) >= 1 AND ready_at IS NULL
                AND failed_at IS NOT NULL AND failed_at >= requested_at
            ELSE false
        END
    ),
    CONSTRAINT workpaper_section_proposals_ended_as CHECK (
        ended_as IS NULL OR ended_as IN ('USED', 'KEPT_MINE', 'SUPERSEDED')
    ),
    -- Ended once, by a person, at or after it was asked for; what stands names no ending.
    -- Only a READY proposal is used.
    CONSTRAINT workpaper_section_proposals_ended CHECK (
        (ended_at IS NULL) = (ended_as IS NULL)
        AND (ended_at IS NULL) = (ended_by IS NULL)
        AND (ended_at IS NULL OR ended_at >= requested_at)
        AND (ended_as IS DISTINCT FROM 'USED' OR status = 'READY')
    ),
    CONSTRAINT workpaper_section_proposals_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_section_proposals_workpaper_fk
        FOREIGN KEY (workpaper_id) REFERENCES workpapers (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_section_proposals_requested_by_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_section_proposals_ended_by_fk
        FOREIGN KEY (ended_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One standing proposal per workpaper, section and person who asked.
CREATE UNIQUE INDEX workpaper_section_proposals_standing
    ON workpaper_section_proposals (workpaper_id, section_key, requested_by)
    WHERE ended_at IS NULL;
-- The proposals the agent still has to draft (resumed after a restart).
CREATE INDEX workpaper_section_proposals_pending_idx
    ON workpaper_section_proposals (requested_at)
    WHERE status = 'PENDING' AND ended_at IS NULL;
CREATE INDEX workpaper_section_proposals_project_idx
    ON workpaper_section_proposals (project_id, requested_at DESC);

-- A proposal is recorded standing and PENDING, with nothing drafted yet, in its workpaper's
-- own engagement, while the workpaper is a draft. (A workpaper that does not exist is
-- refused by the foreign key.)
CREATE FUNCTION guard_workpaper_section_proposal_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    paper record;
BEGIN
    SELECT w.organization_id, w.project_id, w.status
    INTO paper
    FROM public.workpapers AS w
    WHERE w.id = NEW.workpaper_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF paper.organization_id IS DISTINCT FROM NEW.organization_id
        OR paper.project_id IS DISTINCT FROM NEW.project_id
    THEN
        RAISE EXCEPTION 'a section proposal is recorded in its workpaper''s engagement';
    END IF;
    IF paper.status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'a section proposal is asked for while the workpaper is a draft';
    END IF;
    IF NEW.status IS DISTINCT FROM 'PENDING' OR NEW.run_id IS NOT NULL
        OR NEW.ended_at IS NOT NULL OR NEW.ended_by IS NOT NULL OR NEW.ended_as IS NOT NULL
    THEN
        RAISE EXCEPTION 'a section proposal is recorded standing, before the agent drafts it';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER workpaper_section_proposals_recorded
BEFORE INSERT ON workpaper_section_proposals
FOR EACH ROW EXECUTE FUNCTION guard_workpaper_section_proposal_insert();

-- What a proposal records is written once: what was asked never changes; the agent's result
-- (status, text, citations, words, removed_note, failure, ready_at, failed_at, run_id) is
-- set once, when it leaves PENDING; and it ends once (the three ended_* columns, set
-- together). The two are separate steps, and an ended proposal is never changed.
CREATE FUNCTION guard_workpaper_section_proposal_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    finishing boolean;
    ending boolean;
BEGIN
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'an ended section proposal is never changed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.workpaper_id IS DISTINCT FROM OLD.workpaper_id
        OR NEW.section_key IS DISTINCT FROM OLD.section_key
        OR NEW.based_on IS DISTINCT FROM OLD.based_on
        OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
        OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    THEN
        RAISE EXCEPTION 'what a section proposal was asked for never changes';
    END IF;
    finishing := NEW.status IS DISTINCT FROM OLD.status
        OR NEW.text IS DISTINCT FROM OLD.text
        OR NEW.citations IS DISTINCT FROM OLD.citations
        OR NEW.words IS DISTINCT FROM OLD.words
        OR NEW.removed_note IS DISTINCT FROM OLD.removed_note
        OR NEW.failure IS DISTINCT FROM OLD.failure
        OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
        OR NEW.failed_at IS DISTINCT FROM OLD.failed_at
        OR NEW.run_id IS DISTINCT FROM OLD.run_id;
    ending := NEW.ended_at IS NOT NULL;
    IF finishing AND ending THEN
        RAISE EXCEPTION 'a section proposal is finished and ended in separate steps';
    END IF;
    IF finishing AND (OLD.status IS DISTINCT FROM 'PENDING' OR NEW.status = 'PENDING') THEN
        RAISE EXCEPTION 'the agent''s draft of a section is set once, when it leaves PENDING';
    END IF;
    IF NOT finishing AND NOT ending THEN
        RAISE EXCEPTION 'a section proposal changes only by finishing or by ending';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER workpaper_section_proposals_guard
BEFORE UPDATE ON workpaper_section_proposals
FOR EACH ROW EXECUTE FUNCTION guard_workpaper_section_proposal_update();

CREATE FUNCTION prevent_workpaper_section_proposal_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a section proposal is ended, never deleted';
END;
$$;

CREATE TRIGGER workpaper_section_proposals_kept
BEFORE DELETE ON workpaper_section_proposals
FOR EACH ROW EXECUTE FUNCTION prevent_workpaper_section_proposal_deletion();

-- An archived engagement's proposals are read-only (migration 0136). This trigger fires
-- before the guards above (triggers of one event fire in name order), so a write there is
-- refused as archived.
CREATE TRIGGER workpaper_section_proposals_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON workpaper_section_proposals
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
