-- An independent agent checks how each question an agent puts to a person is written before
-- it is presented (decided by the product owner on 4 November 2026: "I want an agent reviewing
-- these questions and make sure these are presented correctly"). True once that agent's
-- wording passed the deterministic checks; a question it could not clear stays false, so the
-- screen can say its wording was not checked.
ALTER TABLE control_context_issues
    ADD COLUMN wording_reviewed boolean NOT NULL DEFAULT false;
