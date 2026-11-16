-- Workpaper review notes (docs/workpaper-review.md, sections 1 to 5; asked for by the
-- product owner on 15 November 2026: "each field can have its own review note, each words
-- and letters can also be highlighted and highlighted words can have its review note as
-- well ... Review notes should also have criticality type, Status, Resolution Owner").
--
-- A person raises a review note on a workpaper: on one of its fields, on highlighted words
-- inside a field, or on the workpaper as a whole. workpaper_review_notes keeps one row per
-- note:
--
--   number             1, 2, ... per workpaper;
--   anchor_kind        FIELD, TEXT (highlighted words) or WORKPAPER;
--   field              the field's key, an opaque string of letters, digits, dots and
--                      hyphens (section 3); '' for WORKPAPER;
--   quote, prefix,     for TEXT: the highlighted characters (1 to 500) exactly as they
--   suffix, occurrence were, up to 60 characters before and after them, and which match of
--                      the quote in the field it was, from 0. '' and 0 otherwise;
--   workpaper_version  the version of the workpaper the note was raised on;
--   text               the person's own, 10 to 2,000 characters;
--   criticality        URGENT, NORMAL or FOLLOW_UP;
--   status             OPEN, RESPONDED, CLEARED or DISMISSED;
--   owner_id           the resolution owner;
--   raised_*           who raised it and when;
--   cleared_*          set together, exactly while the status is CLEARED;
--   dismissed_*        set together, with the reason (10 to 500), exactly while DISMISSED;
--   version            a counter that moves on by one with each change.
--
-- workpaper_review_note_events keeps one row per thing that happened to a note (RAISED,
-- REPLIED, RESPONDED, CLEARED, REOPENED, DISMISSED, CRITICALITY, OWNER): who (by), when
-- (at), the reply or the reason (text; '' where none) and what changed (data: {from, to}).
-- It is written once: never changed, never deleted. The thread on screen is these rows.
--
-- A note is a record of the review. It is never deleted, and what it records never
-- changes: only its status, criticality, owner, the cleared_* and dismissed_* columns and
-- its version do, and its status only along OPEN -> RESPONDED, OPEN or RESPONDED ->
-- CLEARED or DISMISSED, and RESPONDED, CLEARED or DISMISSED -> OPEN. Reopening empties the
-- cleared_* and dismissed_* columns; who cleared or dismissed it before stays in its
-- events. A note is raised OPEN, at version 1, in its workpaper's own engagement, on a
-- version the workpaper has. An archived engagement's notes and their events are
-- read-only (migration 0136).
--
-- These are separate from review_notes (migration 0042, the control review at the end of
-- testing), which is not changed. Nothing here is the agent's: every column that names a
-- person names a user.
--
-- Additive: two tables, four functions and six triggers on them. No existing table, row or
-- function is changed.
--
-- Rollback: DROP TABLE workpaper_review_note_events; DROP TABLE workpaper_review_notes;
-- DROP FUNCTION guard_workpaper_review_note_insert(), guard_workpaper_review_note_update(),
-- prevent_workpaper_review_note_deletion(), prevent_workpaper_review_note_event_change();
-- delete the audit events whose action starts with 'workpaper_review_note.' only if the
-- firm's retention allows it (they are otherwise kept: they name no table); delete the
-- '0166_workpaper_review_notes' row from schema_migrations. A rollback loses the notes
-- and their threads; the D&I sign-off is then held by no note.

CREATE TABLE workpaper_review_notes (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    workpaper_id uuid NOT NULL,
    number integer NOT NULL,
    anchor_kind text NOT NULL,
    field text NOT NULL DEFAULT '',
    -- The highlighted characters exactly as they were: never trimmed or collapsed.
    quote text NOT NULL DEFAULT '',
    prefix text NOT NULL DEFAULT '',
    suffix text NOT NULL DEFAULT '',
    occurrence integer NOT NULL DEFAULT 0,
    -- The workpaper version the note was raised on.
    workpaper_version integer NOT NULL,
    text text NOT NULL,
    criticality text NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    owner_id uuid NOT NULL,
    raised_by uuid NOT NULL,
    raised_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    cleared_by uuid,
    cleared_at timestamptz,
    dismissed_by uuid,
    dismissed_at timestamptz,
    dismiss_reason text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT workpaper_review_notes_number CHECK (number >= 1),
    CONSTRAINT workpaper_review_notes_anchor_kind CHECK (
        anchor_kind IN ('FIELD', 'TEXT', 'WORKPAPER')
    ),
    CONSTRAINT workpaper_review_notes_field CHECK (
        field = '' OR field ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,119}$'
    ),
    CONSTRAINT workpaper_review_notes_around CHECK (
        char_length(prefix) <= 60 AND char_length(suffix) <= 60
    ),
    CONSTRAINT workpaper_review_notes_occurrence CHECK (occurrence >= 0),
    -- Highlighted words name their field and the words; a field names itself and no
    -- words; the workpaper as a whole names neither.
    CONSTRAINT workpaper_review_notes_anchor CHECK (
        CASE anchor_kind
            WHEN 'TEXT' THEN field <> '' AND char_length(quote) BETWEEN 1 AND 500
            WHEN 'FIELD' THEN
                field <> '' AND quote = '' AND prefix = '' AND suffix = '' AND occurrence = 0
            ELSE field = '' AND quote = '' AND prefix = '' AND suffix = '' AND occurrence = 0
        END
    ),
    CONSTRAINT workpaper_review_notes_workpaper_version CHECK (workpaper_version >= 1),
    CONSTRAINT workpaper_review_notes_text CHECK (
        char_length(btrim(text)) >= 10 AND char_length(text) <= 2000
    ),
    CONSTRAINT workpaper_review_notes_criticality CHECK (
        criticality IN ('URGENT', 'NORMAL', 'FOLLOW_UP')
    ),
    CONSTRAINT workpaper_review_notes_status CHECK (
        status IN ('OPEN', 'RESPONDED', 'CLEARED', 'DISMISSED')
    ),
    -- Who cleared it and when, together, exactly while it is cleared.
    CONSTRAINT workpaper_review_notes_cleared CHECK (
        (cleared_by IS NULL) = (cleared_at IS NULL)
        AND (status = 'CLEARED') = (cleared_at IS NOT NULL)
        AND (cleared_at IS NULL OR cleared_at >= raised_at)
    ),
    -- Who dismissed it, when and why, together, exactly while it is dismissed.
    CONSTRAINT workpaper_review_notes_dismissed CHECK (
        (dismissed_by IS NULL) = (dismissed_at IS NULL)
        AND (status = 'DISMISSED') = (dismissed_at IS NOT NULL)
        AND (dismissed_at IS NULL OR dismissed_at >= raised_at)
        AND CASE
            WHEN status = 'DISMISSED' THEN
                char_length(btrim(dismiss_reason)) >= 10 AND char_length(dismiss_reason) <= 500
            ELSE dismiss_reason = ''
        END
    ),
    CONSTRAINT workpaper_review_notes_version CHECK (version >= 1),
    CONSTRAINT workpaper_review_notes_number_key UNIQUE (workpaper_id, number),
    -- What an event names is a note of its own engagement.
    CONSTRAINT workpaper_review_notes_project_key UNIQUE (id, project_id, organization_id),
    CONSTRAINT workpaper_review_notes_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_review_notes_workpaper_fk
        FOREIGN KEY (workpaper_id) REFERENCES workpapers (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_review_notes_owner_fk
        FOREIGN KEY (owner_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_review_notes_raised_by_fk
        FOREIGN KEY (raised_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_review_notes_cleared_by_fk
        FOREIGN KEY (cleared_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_review_notes_dismissed_by_fk
        FOREIGN KEY (dismissed_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- A workpaper's notes in their order are read by the unique key (workpaper_id, number).
-- What holds a sign-off: the urgent notes of a workpaper that are open or responded to.
CREATE INDEX workpaper_review_notes_urgent_idx
    ON workpaper_review_notes (workpaper_id)
    WHERE criticality = 'URGENT' AND status IN ('OPEN', 'RESPONDED');
CREATE INDEX workpaper_review_notes_project_idx ON workpaper_review_notes (project_id);

CREATE TABLE workpaper_review_note_events (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    note_id uuid NOT NULL,
    kind text NOT NULL,
    by uuid NOT NULL,
    at timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- The reply, or the reason; '' where the event has none.
    text text NOT NULL DEFAULT '',
    -- What changed: {"from": ..., "to": ...}; {} where nothing did.
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT workpaper_review_note_events_kind CHECK (
        kind IN (
            'RAISED', 'REPLIED', 'RESPONDED', 'CLEARED', 'REOPENED', 'DISMISSED',
            'CRITICALITY', 'OWNER'
        )
    ),
    -- A reply, a response and a reopening say something (1 to 2,000); a dismissal gives
    -- its reason (10 to 500); the others say nothing (the note's own text is the note's).
    CONSTRAINT workpaper_review_note_events_text CHECK (
        CASE
            WHEN kind IN ('REPLIED', 'RESPONDED', 'REOPENED') THEN
                char_length(btrim(text)) >= 1 AND char_length(text) <= 2000
            WHEN kind = 'DISMISSED' THEN
                char_length(btrim(text)) >= 10 AND char_length(text) <= 500
            ELSE text = ''
        END
    ),
    CONSTRAINT workpaper_review_note_events_data CHECK (
        jsonb_typeof(data) = 'object' AND char_length(data::text) <= 1000
    ),
    CONSTRAINT workpaper_review_note_events_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_review_note_events_note_fk
        FOREIGN KEY (note_id, project_id, organization_id)
        REFERENCES workpaper_review_notes (id, project_id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_review_note_events_by_fk
        FOREIGN KEY (by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- A note's thread, oldest first.
CREATE INDEX workpaper_review_note_events_note_idx
    ON workpaper_review_note_events (note_id, at, id);
CREATE INDEX workpaper_review_note_events_project_idx
    ON workpaper_review_note_events (project_id);

-- A note is raised open, at version 1, in its workpaper's own engagement, on a version
-- the workpaper has. (A workpaper that does not exist is refused by the foreign key.)
CREATE FUNCTION guard_workpaper_review_note_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    paper record;
BEGIN
    SELECT w.organization_id, w.project_id, w.current_version INTO paper
    FROM public.workpapers AS w
    WHERE w.id = NEW.workpaper_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF paper.organization_id IS DISTINCT FROM NEW.organization_id
        OR paper.project_id IS DISTINCT FROM NEW.project_id
    THEN
        RAISE EXCEPTION 'a workpaper review note belongs to its workpaper''s engagement';
    END IF;
    IF NEW.workpaper_version > paper.current_version THEN
        RAISE EXCEPTION 'a workpaper review note is raised on a version the workpaper has';
    END IF;
    IF NEW.status <> 'OPEN' OR NEW.version <> 1 THEN
        RAISE EXCEPTION 'a workpaper review note is raised open, at version 1';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER workpaper_review_notes_raised
BEFORE INSERT ON workpaper_review_notes
FOR EACH ROW EXECUTE FUNCTION guard_workpaper_review_note_insert();

-- What a note records never changes. Only its status, criticality, owner, the cleared_*
-- and dismissed_* columns and its version do; the version moves on by one each time, and
-- the status only along the transitions a note has.
CREATE FUNCTION guard_workpaper_review_note_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.workpaper_id IS DISTINCT FROM OLD.workpaper_id
        OR NEW.number IS DISTINCT FROM OLD.number
        OR NEW.anchor_kind IS DISTINCT FROM OLD.anchor_kind
        OR NEW.field IS DISTINCT FROM OLD.field
        OR NEW.quote IS DISTINCT FROM OLD.quote
        OR NEW.prefix IS DISTINCT FROM OLD.prefix
        OR NEW.suffix IS DISTINCT FROM OLD.suffix
        OR NEW.occurrence IS DISTINCT FROM OLD.occurrence
        OR NEW.workpaper_version IS DISTINCT FROM OLD.workpaper_version
        OR NEW.text IS DISTINCT FROM OLD.text
        OR NEW.raised_by IS DISTINCT FROM OLD.raised_by
        OR NEW.raised_at IS DISTINCT FROM OLD.raised_at
    THEN
        RAISE EXCEPTION 'what a workpaper review note records never changes';
    END IF;
    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
        RAISE EXCEPTION 'a workpaper review note''s version moves on by one with each change';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'OPEN' AND NEW.status IN ('RESPONDED', 'CLEARED', 'DISMISSED'))
        OR (OLD.status = 'RESPONDED' AND NEW.status IN ('OPEN', 'CLEARED', 'DISMISSED'))
        OR (OLD.status IN ('CLEARED', 'DISMISSED') AND NEW.status = 'OPEN')
    ) THEN
        RAISE EXCEPTION 'a workpaper review note does not go from % to %',
            OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER workpaper_review_notes_guard
BEFORE UPDATE ON workpaper_review_notes
FOR EACH ROW EXECUTE FUNCTION guard_workpaper_review_note_update();

CREATE FUNCTION prevent_workpaper_review_note_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a workpaper review note is cleared or dismissed, never deleted';
END;
$$;

CREATE TRIGGER workpaper_review_notes_kept
BEFORE DELETE ON workpaper_review_notes
FOR EACH ROW EXECUTE FUNCTION prevent_workpaper_review_note_deletion();

-- An event is written once.
CREATE FUNCTION prevent_workpaper_review_note_event_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a workpaper review note event is written once: never changed or deleted';
END;
$$;

CREATE TRIGGER workpaper_review_note_events_kept
BEFORE UPDATE OR DELETE ON workpaper_review_note_events
FOR EACH ROW EXECUTE FUNCTION prevent_workpaper_review_note_event_change();

-- An archived engagement's notes and their events are read-only (migration 0136). These
-- triggers fire before the guards above (triggers of one event fire in name order), so a
-- write there is refused as archived.
CREATE TRIGGER workpaper_review_notes_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON workpaper_review_notes
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

CREATE TRIGGER workpaper_review_note_events_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON workpaper_review_note_events
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
