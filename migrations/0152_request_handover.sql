-- A request handed over while email sending is off (12 November 2026;
-- docs/control-workflow-plan.md, B1g; the product owner: with email off, an approved
-- request is handed over, on the record).
--
-- With live email off, approving a request left the approval standing and nothing sent,
-- while the screens could read as if the request were with the owner. The approval now
-- records a hand-over: pbc_requests.handed_over_at / handed_over_by keep when and who (the
-- person who approved or sent it), and handed_over_approval_id the approval it was handed
-- over on, which is the approval of the wording that left. All set or all null. Nothing
-- here says a message was sent: a request is sent only by its delivered message
-- (outbound_message_id).
--
-- A request that is a draft again is not with anybody: its hand-over is cleared by
-- trigger, on every path that returns it to draft (a person takes it back to reword it,
-- its last file is withdrawn), so the next approval is of the new wording and records its
-- own hand-over. The audit trail keeps each hand-over (pbc.handed_over).
--
-- Additive: three nullable columns, one constraint, one trigger. No backfill: nothing is
-- invented as handed over.
--
-- Rollback: DROP TRIGGER pbc_requests_draft_not_handed_over ON pbc_requests;
-- DROP FUNCTION clear_handover_of_draft(); ALTER TABLE pbc_requests DROP CONSTRAINT
-- pbc_requests_handed_over, DROP COLUMN handed_over_approval_id, DROP COLUMN
-- handed_over_by, DROP COLUMN handed_over_at; and delete the '0152_request_handover' row
-- from schema_migrations.

ALTER TABLE pbc_requests
    ADD COLUMN handed_over_at timestamptz,
    ADD COLUMN handed_over_by uuid REFERENCES users (id),
    ADD COLUMN handed_over_approval_id uuid REFERENCES approvals (id),
    ADD CONSTRAINT pbc_requests_handed_over CHECK (
        (handed_over_at IS NULL) = (handed_over_by IS NULL)
        AND (handed_over_at IS NULL) = (handed_over_approval_id IS NULL)
    );

CREATE FUNCTION clear_handover_of_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'DRAFT' AND OLD.status IS DISTINCT FROM 'DRAFT' THEN
        NEW.handed_over_at := NULL;
        NEW.handed_over_by := NULL;
        NEW.handed_over_approval_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER pbc_requests_draft_not_handed_over
    BEFORE UPDATE OF status ON pbc_requests
    FOR EACH ROW EXECUTE FUNCTION clear_handover_of_draft();
