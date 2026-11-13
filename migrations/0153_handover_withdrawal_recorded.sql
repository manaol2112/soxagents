-- A hand-over never ends without a record (12 November 2026; docs/control-workflow-plan.md,
-- B1g "After the independent review").
--
-- Migration 0152 clears a request's hand-over when the request returns to draft, on every
-- path. The review found that only one of those paths said so on the audit trail: the
-- others (its evidence withdrawn, the email it travelled in not sent, an approval of it
-- rejected) erased who had handed it over, and when, with no trace.
--
-- The application now records `pbc.handover_withdrawn`, with the actor and the reason, in
-- the transaction that returns the request to draft (pbc.record_handover_withdrawn), and
-- this trigger makes that impossible to bypass: at commit, a request that was handed over
-- and returned to draft in the transaction must have that audit event, written in the
-- same transaction. Deferred, so the application may write the event before or after the
-- update. A path that records nothing fails, and the hand-over stands.
--
-- Additive: one function and one constraint trigger. No data is changed.
--
-- Rollback: DROP TRIGGER pbc_requests_handover_withdrawal_recorded ON pbc_requests;
-- DROP FUNCTION require_handover_withdrawal_recorded(); and delete the
-- '0153_handover_withdrawal_recorded' row from schema_migrations.

CREATE FUNCTION require_handover_withdrawal_recorded() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM audit_events e
        WHERE e.action = 'pbc.handover_withdrawn'
          AND e.target_type = 'pbc_request'
          AND e.target_id = NEW.id
          AND e.occurred_at >= transaction_timestamp()
    ) THEN
        RAISE EXCEPTION 'a hand-over ends only with its withdrawal on record (request %)', NEW.id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pbc_requests_handover_withdrawal_recorded
    AFTER UPDATE OF status ON pbc_requests
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (
        NEW.status = 'DRAFT'
        AND OLD.status IS DISTINCT FROM 'DRAFT'
        AND OLD.handed_over_at IS NOT NULL
    )
    EXECUTE FUNCTION require_handover_withdrawal_recorded();
