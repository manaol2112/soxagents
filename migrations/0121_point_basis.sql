-- Every narrative point arrives with a statement to confirm (decided by the product owner on
-- 27 October 2026: "Agent should always be able to provide a suggestion based on the nature
-- of the controls"). Where the documents and answers say nothing, the agents state how a
-- control of this kind usually runs; the point records which, so the person confirming it
-- knows whether the statement comes from the client's own records or is the usual practice.
-- '' for a point raised before this, or one still asked open.
ALTER TABLE control_context_issues
    ADD COLUMN proposal_basis text NOT NULL DEFAULT '',
    ADD CONSTRAINT control_context_issues_proposal_basis CHECK (
        proposal_basis IN ('', 'SOURCES', 'TYPICAL')
    );
