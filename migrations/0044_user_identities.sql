-- One user can sign in through more than one identity provider (Microsoft Entra ID and
-- Google), so the provider subject moves out of users into its own table. A subject is
-- unique within its issuer, and a user holds at most one identity per issuer. Existing
-- subjects all came from Entra, and the old column goes away so there is one record.

CREATE TABLE user_identities (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT user_identities_issuer_subject_key UNIQUE (issuer, subject),
    CONSTRAINT user_identities_user_issuer_key UNIQUE (user_id, issuer),
    CONSTRAINT user_identities_issuer CHECK (issuer IN ('entra', 'google')),
    CONSTRAINT user_identities_subject_not_blank CHECK (length(btrim(subject)) > 0),
    CONSTRAINT user_identities_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

INSERT INTO user_identities (user_id, issuer, subject)
SELECT id, 'entra', oidc_subject
FROM users
WHERE oidc_subject IS NOT NULL;

ALTER TABLE users DROP COLUMN oidc_subject;
