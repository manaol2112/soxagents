-- A field note keeps the field's text as the person saw it (docs/workpaper-review.md,
-- section 3; review of migration 0166, 16 November 2026).
--
-- A note on a field names the field by its key. Some keys are a place in a list
-- (procedures.2, matters.3, reports.2.3): once the workpaper is drafted again, or a
-- procedure is added before it, the same key names other text, and the note's marker and
-- card sit beside it with nothing to say so. A note on highlighted words keeps the words,
-- so the page can say they are gone; a note on a field kept nothing.
--
-- workpaper_review_notes gains field_text: for a FIELD note, the field's text when the note
-- was raised, as the page sent it (less only control and invisible characters, as a
-- highlight's words are kept), at most 12,000 characters (a workpaper section's text at
-- most). Null where the page sent none, and on every note raised before this migration:
-- not recorded, never guessed. '' is a field that was empty. Never on a TEXT or WORKPAPER
-- note. The page compares it with the field's text now and says where the field changed
-- since the note was raised.
--
-- What a note records never changes: the guard of migration 0166 is replaced by the same
-- function with field_text among what never changes. Nothing it refused before is allowed
-- now.
--
-- Additive: one nullable column and its constraint; no row is written (adding a column
-- fires no update trigger, and every existing note keeps null).
--
-- Rollback: restore guard_workpaper_review_note_update() as migration 0166 created it;
-- ALTER TABLE workpaper_review_notes DROP COLUMN field_text (its constraint goes with it);
-- delete the '0167_review_note_field_text' row from schema_migrations. A rollback loses the
-- recorded field texts; the notes and their threads stay.

ALTER TABLE workpaper_review_notes ADD COLUMN field_text text;

ALTER TABLE workpaper_review_notes
    ADD CONSTRAINT workpaper_review_notes_field_text CHECK (
        field_text IS NULL
        OR (anchor_kind = 'FIELD' AND char_length(field_text) <= 12000)
    );

-- The guard of migration 0166, with field_text among what never changes. Everything else
-- is as 0166 wrote it.
CREATE OR REPLACE FUNCTION guard_workpaper_review_note_update()
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
        OR NEW.field_text IS DISTINCT FROM OLD.field_text
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
