-- Working copies of a workpaper's sections (docs/design-workpaper.md, section 3.4; asked
-- for by the product owner on 16 November 2026: "I want to automatically save the updates
-- that the user has typed in or edited").
--
-- What a person types into a section's editor is kept automatically as a working copy; a
-- version is added to the workpaper's history only when the person saves.
-- workpaper_section_drafts keeps one row per workpaper, section and person:
--
--   based_on    the workpaper version the working copy was started from (1 or later);
--   content     the body a save would send: {"text": "..."} for a text section, or
--               {"rows": [["...", ...], ...]} for a table. Exactly one of the two;
--   updated_at  when it was last kept.
--
-- Unlike the tables that hold the audit's records, this one is deliberately mutable and
-- deletable. A working copy is a person's unfinished typing, not a record of the audit:
-- it is replaced as they type, and deleted when they save the section, discard it, or the
-- workpaper is prepared. It is never read by the views, the export, the agents or another
-- person, and it is not in the audit trail (the save that follows is, as before). So it
-- has no guard against updates or deletions, it goes with its workpaper and with its
-- person (ON DELETE CASCADE), and nothing else refers to it.
--
-- An archived engagement is read-only (migration 0136), working copies included: none is
-- kept, replaced or discarded there.
--
-- Additive: one table, two indexes, two triggers on it (existing functions). No existing
-- table, row or function is changed.
--
-- Rollback: DROP TABLE workpaper_section_drafts; delete the
-- '0164_workpaper_section_drafts' row from schema_migrations. Nothing else names the
-- table, and no audit event is written for a working copy.

CREATE TABLE workpaper_section_drafts (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    workpaper_id uuid NOT NULL,
    -- The section's key in the workpaper's content (workpaper_fill.Section.key).
    section_key text NOT NULL,
    user_id uuid NOT NULL,
    -- The workpaper version the person started from.
    based_on integer NOT NULL,
    content jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT workpaper_section_drafts_section CHECK (
        char_length(section_key) BETWEEN 1 AND 60
    ),
    CONSTRAINT workpaper_section_drafts_based_on CHECK (based_on >= 1),
    -- Exactly one of a text or a table's rows, and nothing else, within the limits a save
    -- has (12,000 characters; 300 rows). Each test is reached only where the one before
    -- it holds, so content of another shape is refused, never an error of its own.
    CONSTRAINT workpaper_section_drafts_content CHECK (
        CASE
            WHEN jsonb_typeof(content) <> 'object' THEN false
            WHEN content ? 'text' AND content - 'text'::text = '{}'::jsonb THEN
                CASE
                    WHEN jsonb_typeof(content -> 'text') = 'string'
                        THEN char_length(content ->> 'text') <= 12000
                    ELSE false
                END
            WHEN content ? 'rows' AND content - 'rows'::text = '{}'::jsonb THEN
                CASE
                    WHEN jsonb_typeof(content -> 'rows') = 'array'
                        THEN jsonb_array_length(content -> 'rows') <= 300
                    ELSE false
                END
            ELSE false
        END
    ),
    -- One working copy per workpaper, section and person.
    CONSTRAINT workpaper_section_drafts_one UNIQUE (workpaper_id, section_key, user_id),
    CONSTRAINT workpaper_section_drafts_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT workpaper_section_drafts_workpaper_fk
        FOREIGN KEY (workpaper_id) REFERENCES workpapers (id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT workpaper_section_drafts_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE ON UPDATE RESTRICT
);

-- A person's working copies (the unique key leads with the workpaper).
CREATE INDEX workpaper_section_drafts_user_idx ON workpaper_section_drafts (user_id);
CREATE INDEX workpaper_section_drafts_project_idx ON workpaper_section_drafts (project_id);

CREATE TRIGGER workpaper_section_drafts_updated_at
BEFORE UPDATE ON workpaper_section_drafts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An archived engagement's working copies are read-only (migration 0136).
CREATE TRIGGER workpaper_section_drafts_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON workpaper_section_drafts
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
