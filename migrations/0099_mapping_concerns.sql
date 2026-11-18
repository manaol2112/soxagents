-- Milestone 3d closure: passages of the evidence the mapping keeps apart for a person to
-- review, never as support. A passage that only asserts something was done or is in order
-- (a representation, a remark, a status label, a claim of prior testing), or that gives
-- instructions to its reader or claims to speak for the audit, a reviewer, an approver or
-- a system, is a concern: its verified quote, where it is, its kind and why. Concerns are
-- never references, never facts, and never count towards the attribute's status.
--
-- Earlier mappings have none: the column defaults to an empty list, and the mappings stay
-- immutable (0096).

ALTER TABLE evidence_mappings
    ADD COLUMN concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT evidence_mappings_concerns_list CHECK (jsonb_typeof(concerns) = 'array');
