-- Each agent's question as a short interview (decided by the product owner on 4 November 2026:
-- "the same workflow as how turbotax does it"): one plain question on each screen, answers of a
-- few words, and the next question chosen by the answer. Each answer carries the full sentence
-- it means, which is what is recorded. [] until the reviewer agent writes it.
ALTER TABLE control_context_issues
    ADD COLUMN interview jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT control_context_issues_interview CHECK (jsonb_typeof(interview) = 'array');

-- What 0140 marked as checked was a reworded sentence, with no interview: open ones get theirs.
UPDATE control_context_issues SET wording_reviewed = false
WHERE status = 'OPEN' AND wording_reviewed;
