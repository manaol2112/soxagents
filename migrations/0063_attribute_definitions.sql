-- Testing definitions (Milestone 8.8, library version 3).
--
-- A library control's attributes now have testing definitions in code
-- (definition_registry.py): the condition, evidence, decision rules, source, and
-- confidence the tester works from. An attribute record names the definition it follows,
-- so the link survives a person rewording it (for example filling in "[the number of days
-- in the access policy]" when they approve a proposed attribute).
--
-- Additive only: a nullable column. Existing attributes keep working; an attribute without
-- a key is matched to its definition by wording, or has none (a client's own control).
--
-- Rollback: ALTER TABLE control_attributes DROP COLUMN definition_key; and delete the
-- '0063_attribute_definitions' row from schema_migrations.

ALTER TABLE control_attributes ADD COLUMN definition_key text;
ALTER TABLE control_attributes ADD CONSTRAINT control_attributes_definition_key CHECK (
    definition_key IS NULL OR definition_key ~ '^[a-z0-9][a-z0-9-]{1,59}$'
);
