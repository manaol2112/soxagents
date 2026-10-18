-- Inviting people to the firm by email.
--
-- organization_email_domains lists the firm's own mail domains. An invitation can only
-- go to an address on one of them, which keeps an account from being used to email
-- strangers. invitations records who invited whom, with which roles, and the welcome
-- email written for them. Live email is off, so a welcome email is HELD until a later
-- milestone configures sending; nothing here sends mail.

CREATE TABLE organization_email_domains (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    domain citext NOT NULL,
    added_by uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organization_email_domains_key UNIQUE (organization_id, domain),
    CONSTRAINT organization_email_domains_format CHECK (
        char_length(domain::text) BETWEEN 3 AND 253
        AND domain::text ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    ),
    CONSTRAINT organization_email_domains_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT organization_email_domains_added_by_fk
        FOREIGN KEY (added_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE invitations (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    email citext NOT NULL,
    invited_by uuid NOT NULL,
    organization_role membership_role NOT NULL,
    engagement_role text NOT NULL,
    welcome_subject text NOT NULL,
    welcome_body text NOT NULL,
    welcome_status text NOT NULL DEFAULT 'HELD',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT invitations_engagement_role CHECK (
        engagement_role IN ('LEAD', 'PREPARER', 'REVIEWER')
    ),
    CONSTRAINT invitations_organization_role CHECK (
        organization_role IN ('PROJECT_MANAGER', 'REVIEWER', 'CONTRIBUTOR')
    ),
    CONSTRAINT invitations_welcome_status CHECK (welcome_status IN ('HELD', 'SENT')),
    CONSTRAINT invitations_welcome_text CHECK (
        char_length(welcome_subject) BETWEEN 1 AND 200 AND char_length(welcome_body) <= 4000
    ),
    CONSTRAINT invitations_email CHECK (char_length(email::text) BETWEEN 3 AND 254),
    CONSTRAINT invitations_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT invitations_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT invitations_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT invitations_invited_by_fk
        FOREIGN KEY (invited_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- The rate limit counts one inviter's invitations over the last hour.
CREATE INDEX invitations_inviter_idx ON invitations (invited_by, created_at);
CREATE INDEX invitations_user_idx ON invitations (organization_id, user_id, created_at);

-- Start each firm with its owners' work domains. Personal mailboxes say nothing about
-- the firm, so they are left out; an owner adds domains in the team step.
INSERT INTO organization_email_domains (organization_id, domain, added_by)
SELECT DISTINCT ON (m.organization_id, lower(split_part(u.email::text, '@', 2)))
    m.organization_id, lower(split_part(u.email::text, '@', 2)), u.id
FROM memberships AS m
JOIN users AS u ON u.id = m.user_id
WHERE m.role = 'OWNER'
  AND m.status = 'ACTIVE'
  AND lower(split_part(u.email::text, '@', 2)) ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  AND lower(split_part(u.email::text, '@', 2)) NOT IN (
      'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
      'yahoo.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
      'protonmail.com', 'pm.me', 'gmx.com', 'mail.com', 'example.com'
  )
ORDER BY m.organization_id, lower(split_part(u.email::text, '@', 2)), m.created_at;
