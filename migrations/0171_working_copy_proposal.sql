-- A working copy names the agent's draft its text came from (docs/design-workpaper.md,
-- sections 3.4 and 3.11; the product owner's rule of 16 November 2026: agent output is
-- never recorded as a person's).
--
-- "Use the draft" puts the agent's proposed text into the section's editor, kept as the
-- person's working copy until they save. Where they left without saving and came back,
-- the working copy held only the text, so the save that followed recorded the agent's
-- text as a plain person's edit, with no "From the agent's draft of <when>" and no
-- proposal named in its audit event.
--
-- A text section's working copy may now also hold "proposal_id": the id of the person's
-- own proposal (workpaper_section_proposals) the text came from, as a string in the
-- canonical form of a uuid. The server checks it when the copy is kept (the person's own
-- READY proposal for that section, not ended KEPT_MINE or USED) and again when the
-- section is saved. A table's rows never carry one (the agent drafts text only), and
-- nothing else is allowed beside the text or the rows, as before. A json value cannot
-- refer to a row, so there is no foreign key: a working copy is not a record of the
-- audit, and the proposal it names is never deleted (migration 0170).
--
-- workpaper_section_drafts_content is replaced by the same rule with the one key added.
-- Every content it allowed before is allowed now, so every existing row passes the check
-- the new constraint makes; nothing it refused before is allowed now except a text with a
-- uuid-shaped "proposal_id". No row is written.
--
-- Rollback: delete the working copies that name a proposal (DELETE FROM
-- workpaper_section_drafts WHERE content ? 'proposal_id', a person's unfinished typing,
-- not a record of the audit), or strip the key (UPDATE ... SET content = content -
-- 'proposal_id'); restore workpaper_section_drafts_content as migration 0164 created it;
-- delete the '0171_working_copy_proposal' row from schema_migrations.

ALTER TABLE workpaper_section_drafts
    DROP CONSTRAINT workpaper_section_drafts_content,
    -- Exactly one of a text or a table's rows, a text with at most the proposal it came
    -- from, and nothing else, within the limits a save has (12,000 characters; 300 rows).
    -- Each test is reached only where the one before it holds, so content of another
    -- shape is refused, never an error of its own.
    ADD CONSTRAINT workpaper_section_drafts_content CHECK (
        CASE
            WHEN jsonb_typeof(content) <> 'object' THEN false
            WHEN content ? 'text' AND (content - 'text'::text) - 'proposal_id'::text = '{}'::jsonb
                THEN
                CASE
                    WHEN jsonb_typeof(content -> 'text') <> 'string' THEN false
                    WHEN char_length(content ->> 'text') > 12000 THEN false
                    WHEN NOT content ? 'proposal_id' THEN true
                    WHEN jsonb_typeof(content -> 'proposal_id') <> 'string' THEN false
                    ELSE (content ->> 'proposal_id')
                        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                END
            WHEN content ? 'rows' AND content - 'rows'::text = '{}'::jsonb THEN
                CASE
                    WHEN jsonb_typeof(content -> 'rows') = 'array'
                        THEN jsonb_array_length(content -> 'rows') <= 300
                    ELSE false
                END
            ELSE false
        END
    );
