-- The confirmed Control Understanding is the authority (decided by the product owner on
-- 12 November 2026; docs/control-workflow-plan.md, B1e: "shouldn't the attribute just follow
-- what control understanding says so I won't get any conflict like this?"; "Newer answer
-- wins.").
--
-- Where the RCM record, a library attribute's wording, an approved attribute or an older
-- confirmed answer differs from the confirmed understanding, the attribute agent follows the
-- understanding and raises no issue. What it followed and what it set aside is kept on the
-- attribute the record explains, a proposal or an approved attribute whose criteria the agent
-- made specific:
--
--   understanding_basis  the fact followed (its kind, what it says, when it was confirmed),
--                        each thing set aside (an older answer with its date, the RCM record,
--                        the library wording, the approved attribute), one plain sentence,
--                        the agent and the model call it came from, and a mark of the
--                        wording and criteria it explains, so the record is never shown for
--                        words that changed after it. Agent output: never a person's
--                        decision, and it approves nothing.
--
-- Nothing is deleted or rewritten: the older answer keeps its row, and an open question the
-- rules settle is closed by the agent's next run as SUPERSEDED with its reason in the
-- existing resolution_note (no schema change for that).
--
-- Additive only: one nullable column. No backfill: no attribute has such a record today.
--
-- Rollback: ALTER TABLE control_attributes DROP COLUMN understanding_basis; and delete the
-- '0150_understanding_basis' row from schema_migrations.

ALTER TABLE control_attributes
    ADD COLUMN understanding_basis jsonb,
    ADD CONSTRAINT control_attributes_understanding_basis CHECK (
        understanding_basis IS NULL OR jsonb_typeof(understanding_basis) = 'object'
    );
