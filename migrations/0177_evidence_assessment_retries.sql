-- A check whose queueing failed is recorded and tried again (E1 evidence reliance, 18
-- November 2026; the product owner: "Approve 0177", "Keep the reading, record it").
--
-- When a file's reading ends (and when it is withdrawn, replaced, restored or its kind
-- confirmed, or a wizard batch lands), the checks of the controls the file is in force on
-- are brought in step in a savepoint of the same transaction
-- (evidence_assurance.queue_for_file). A failure there (a deadlock, say) was caught and
-- only logged: the reading was kept, but the check was never queued, and only the
-- start-up backfill found a request with no check at all. A request whose check stayed
-- current on an outdated basis was never tried again.
--
-- evidence_assessment_retries: one row per control whose checks could not be brought in
-- step, written in the transaction that asked (after its savepoint was rolled back), with
-- the error's class only (never its message, which could carry data) and how many tries
-- failed. Each failure is also on the audit trail (evidence_assessment.queue_failed). The
-- worker tries the control again after every reading and every check it runs, and at
-- start-up (evidence_assurance.retry_failed); any later bringing in step of the whole
-- control removes the row (evidence_assessment.requeued). After RETRY_LIMIT (5) failed
-- tries the control is no longer tried on its own: its out-of-date requests say so, and a
-- person's change or a run started again brings it in step.
--
-- Holds the audit's own bookkeeping, so an archived engagement's rows are read-only
-- (as 0136, 0150).
--
-- Additive: one table, one trigger. No existing row changes.
--
-- Rollback: DROP TABLE evidence_assessment_retries; delete the
-- '0177_evidence_assessment_retries' row from schema_migrations; roll back the
-- evidence_assurance change that writes and reads it with it.

CREATE TABLE evidence_assessment_retries (
    engagement_control_id uuid PRIMARY KEY
        REFERENCES engagement_controls (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    -- The failure's class name, as Python names it (DeadlockDetected, say).
    error text NOT NULL,
    attempts integer NOT NULL DEFAULT 1,
    failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_assessment_retries_error CHECK (error ~ '^[A-Za-z_][A-Za-z0-9_]{0,99}$'),
    CONSTRAINT evidence_assessment_retries_attempts CHECK (attempts BETWEEN 1 AND 1000),
    CONSTRAINT evidence_assessment_retries_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_assessment_retries_project_idx
    ON evidence_assessment_retries (project_id, attempts);

-- An archived engagement's records are read-only (migration 0136).
CREATE TRIGGER evidence_assessment_retries_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_assessment_retries
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
