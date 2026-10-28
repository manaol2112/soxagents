-- Notifications to the firm's own support address (decided by the product owner on 27
-- October 2026: every demo request and every new sign-up emails
-- support@auditworkforce.ai). Each is recorded in the same transaction as the event
-- that causes it and sent after the visitor has their answer. It is marked sent only
-- once the mail server accepts it, so a failure stays held for the next attempt, and
-- one event never has two notifications.
--
-- Rollback: drop the table support_notifications; delete the
-- '0123_support_notifications' row from schema_migrations.

CREATE TABLE support_notifications (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    kind text NOT NULL,
    subject_id uuid NOT NULL,
    recipient text NOT NULL,
    reply_to text NOT NULL DEFAULT '',
    subject text NOT NULL,
    body text NOT NULL,
    status text NOT NULL DEFAULT 'HELD',
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    claimed_at timestamptz,
    sent_at timestamptz,
    CONSTRAINT support_notifications_kind CHECK (kind IN ('DEMO_REQUEST', 'SIGN_UP')),
    CONSTRAINT support_notifications_status CHECK (status IN ('HELD', 'SENDING', 'SENT')),
    CONSTRAINT support_notifications_sent CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
    CONSTRAINT support_notifications_claimed CHECK (
        status <> 'SENDING' OR claimed_at IS NOT NULL
    ),
    CONSTRAINT support_notifications_sizes CHECK (
        char_length(recipient) BETWEEN 3 AND 200
        AND char_length(reply_to) <= 200
        AND char_length(subject) BETWEEN 1 AND 200
        AND char_length(body) BETWEEN 1 AND 6000
    ),
    CONSTRAINT support_notifications_once UNIQUE (kind, subject_id)
);

CREATE INDEX support_notifications_waiting_idx
    ON support_notifications (created_at)
    WHERE status <> 'SENT';
