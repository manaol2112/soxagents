-- A system added to an engagement built from the client's RCM is scoped from the library
-- and from the client's own controls on other systems, adapted to it (decided by the
-- product owner). An adapted control takes a reference in the client's scheme for its
-- system and the wording of the standard it matches; the client confirms it.
--
-- 1. engagement_applications.ref_code: the system's code in the client's control
--    references (ITGC-AD-02 for Active Directory). Suggested from its name until a person
--    sets it.
-- 2. engagement_controls.adapted_from: the client's controls on other systems a control
--    was adapted from, by reference; empty for every other control.
--
-- Rollback: drop the two columns and their constraints, and delete the
-- '0087_adapted_controls' row from schema_migrations.

ALTER TABLE engagement_applications
    ADD COLUMN ref_code text,
    ADD CONSTRAINT engagement_applications_ref_code CHECK (
        ref_code IS NULL OR ref_code ~ '^[A-Z][A-Z0-9]{0,7}$'
    );

ALTER TABLE engagement_controls
    ADD COLUMN adapted_from text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD CONSTRAINT engagement_controls_adapted_from CHECK (cardinality(adapted_from) <= 20);
