-- What an approved evidence request email was rendered with (13 November 2026; the
-- independent review of the email redesign, request_email.py).
--
-- From request template version 3 (a group's version 2), the email names things that
-- other records hold: the control's name, a line describing it, its system, and the
-- recipient's name. The send renders the message again and refuses anything but the
-- approved content, so a contact added or a control renamed after the approval made an
-- approved message unsendable, and the preview of a request awaiting its send showed
-- text nobody approved.
--
-- approved_message_facts keeps, for each approval of a message (a request, a reminder,
-- or a group's lead approval), the facts its text was rendered with, per request in it.
-- Every later render for that approval (the send, a resumed send, the hand-over, the
-- preview while it awaits its send, and a message carried over to a new approval) reads
-- them from here, never from the live records. A row is written once and never changed.
--
-- Additive: one table. An approval from before this migration has no row and renders as
-- it did (versions 2 and 1 read none of these facts).
--
-- Rollback: DROP TABLE approved_message_facts; DROP FUNCTION
-- guard_approved_message_facts(); delete the '0157_approved_message_facts' row from
-- schema_migrations. Only before any version 3 message is approved: its approval could
-- no longer be rendered as approved.

CREATE TABLE approved_message_facts (
    approval_id uuid PRIMARY KEY REFERENCES approvals (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    -- {"<request id>": {"control_title", "control_line", "system", "recipient_name"}}
    facts jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT approved_message_facts_object CHECK (jsonb_typeof(facts) = 'object'),
    CONSTRAINT approved_message_facts_size CHECK (pg_column_size(facts) <= 65536),
    CONSTRAINT approved_message_facts_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION guard_approved_message_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'what an approved message was rendered with cannot be changed';
END;
$$;

CREATE TRIGGER approved_message_facts_immutable
BEFORE UPDATE OR DELETE ON approved_message_facts
FOR EACH ROW EXECUTE FUNCTION guard_approved_message_facts();

-- An archived engagement's records are read-only (migration 0136).
CREATE TRIGGER approved_message_facts_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON approved_message_facts
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
