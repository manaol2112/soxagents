-- A deficiency rating belongs to its deficiency's engagement (bug hunt, 9 November 2026).
--
-- Migration 0144 tied each rating to its deficiency by id only, and left its organization and
-- project unchecked, unlike its neighbours (design_conclusions, 0143; phase_releases, 0145).
-- A rating could then name an engagement other than its deficiency's, and the engagement-
-- scoped reads would place it there. These keys hold the rating to the deficiency's project,
-- and the project to its organization, as the other engagement tables do.
--
-- deficiencies gains the (project_id, id) key the composite reference needs; id is already
-- unique, so the key holds for every existing row. Ratings are written only by
-- control_conclusions.rate, from the deficiency's own engagement, so existing rows satisfy
-- the new keys; if one did not, this migration fails and changes nothing.
--
-- Rollback: ALTER TABLE deficiency_ratings DROP CONSTRAINT deficiency_ratings_deficiency_fk,
-- DROP CONSTRAINT deficiency_ratings_project_fk; ALTER TABLE deficiencies DROP CONSTRAINT
-- deficiencies_scope_key; delete the '0146_deficiency_rating_scope' row from
-- schema_migrations.

ALTER TABLE deficiencies ADD CONSTRAINT deficiencies_scope_key UNIQUE (project_id, id);

ALTER TABLE deficiency_ratings
    ADD CONSTRAINT deficiency_ratings_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT deficiency_ratings_deficiency_fk
        FOREIGN KEY (project_id, deficiency_id) REFERENCES deficiencies (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
