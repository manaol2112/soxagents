-- Milestone 3b closure: an attribute whose model call did not complete (cut off,
-- malformed, timed out, refused, cancelled, over budget) is NOT_MAPPED, an execution
-- failure, never one of the five statuses that describe the evidence.

ALTER TABLE evidence_mappings DROP CONSTRAINT evidence_mappings_status;
ALTER TABLE evidence_mappings ADD CONSTRAINT evidence_mappings_status CHECK (
    status IN (
        'MISSING', 'INCOMPLETE', 'CONTRADICTORY', 'POTENTIALLY_SUFFICIENT', 'UNKNOWN',
        'NOT_MAPPED'
    )
);
ALTER TABLE evidence_mappings ADD CONSTRAINT evidence_mappings_failure CHECK (
    (status = 'NOT_MAPPED') = (source = 'FAILED')
);
