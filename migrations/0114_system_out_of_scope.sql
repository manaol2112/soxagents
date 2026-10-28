-- A system taken out of scope after launch (decided by the product owner on 25 October
-- 2026). Its controls already leave scope and their open work is cancelled; the system
-- stays on record for what was tested. It is now marked, with who took it out, when, and
-- why, so the page lists it apart and leaves it out of the scope's counts, and a person
-- can bring it back.

ALTER TABLE engagement_applications
    ADD COLUMN out_of_scope_at timestamptz,
    ADD COLUMN out_of_scope_by uuid,
    ADD COLUMN out_of_scope_reason text NOT NULL DEFAULT '',
    ADD CONSTRAINT engagement_applications_out_of_scope CHECK (
        (out_of_scope_at IS NULL) = (out_of_scope_by IS NULL)
        AND char_length(out_of_scope_reason) <= 1000
    );
