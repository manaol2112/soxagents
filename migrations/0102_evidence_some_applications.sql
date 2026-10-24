-- Evidence that applies to some of a control's applications (by the product owner's
-- decision, 22 Oct 2026).
--
-- A policy or procedure often governs several systems, not always all of them. When a
-- person adds one on an item, they say which systems it applies to: all of them (ALL),
-- one (ONE), or several (SOME, listed in engagement_application_ids). Only a person sets
-- SOME; the evidence coordinator suggests ONE, ALL, or UNKNOWN as before (migration 0035).
--
-- A file a person added on an item and tagged for other systems too serves the same item
-- on each of those systems' instances of the control, so the policy is added once.

ALTER TABLE evidence_file_applications
    ADD COLUMN engagement_application_ids uuid[] NOT NULL DEFAULT '{}',
    DROP CONSTRAINT evidence_file_applications_scope,
    ADD CONSTRAINT evidence_file_applications_scope
        CHECK (scope IN ('ONE', 'SOME', 'ALL', 'UNKNOWN')),
    ADD CONSTRAINT evidence_file_applications_some CHECK (
        (scope = 'SOME') = (cardinality(engagement_application_ids) >= 2)
        AND (scope = 'SOME' OR cardinality(engagement_application_ids) = 0)
    ),
    ADD CONSTRAINT evidence_file_applications_some_by_person CHECK (
        scope <> 'SOME' OR tagged_by = 'PERSON'
    );
