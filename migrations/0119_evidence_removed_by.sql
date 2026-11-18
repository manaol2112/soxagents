-- A person removes evidence from a control's test plan (decided by the product owner on 26
-- October 2026: "users can add modify or delete the evidence listed in there"). The item is
-- kept, marked removed with who removed it and when, so the trail stays and it can be
-- restored; and an agent's later run never brings back what a person removed.
ALTER TABLE evidence_requirements
    ADD COLUMN removed_by uuid REFERENCES users (id),
    ADD COLUMN removed_at timestamptz,
    ADD CONSTRAINT evidence_requirements_removed_by CHECK (
        (removed_by IS NULL) = (removed_at IS NULL)
        AND (removed_by IS NULL OR status = 'REMOVED')
    );
