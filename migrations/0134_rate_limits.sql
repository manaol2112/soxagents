-- Pre-launch hardening, Step 7: request throttles and trial identities.
--
-- rate_limit_hits counts requests in fixed windows per scope and key (a network address,
-- a firm, an identity), with one atomic upsert per request, so requests arriving together
-- are counted together and none slips past the limit. Thresholds live in the settings
-- (rate_limit.py), never here. Windows older than a day are removed by housekeeping.
--
-- trial_identities records the normalised email identity behind each self-service trial,
-- so a second trial under the same identity (an alias of the same mailbox) is held for
-- review rather than granted another allowance. The hash is of the normalised address;
-- the address itself is not stored here.

CREATE TABLE rate_limit_hits (
    scope text NOT NULL,
    key text NOT NULL,
    window_start timestamptz NOT NULL,
    hits integer NOT NULL DEFAULT 1,
    PRIMARY KEY (scope, key, window_start),
    CONSTRAINT rate_limit_hits_scope CHECK (scope ~ '^[a-z][a-z_.-]{1,59}$'),
    CONSTRAINT rate_limit_hits_key CHECK (char_length(key) BETWEEN 1 AND 200),
    CONSTRAINT rate_limit_hits_count CHECK (hits >= 1)
);

CREATE INDEX rate_limit_hits_window ON rate_limit_hits (window_start);

CREATE TABLE trial_identities (
    identity_hash text PRIMARY KEY,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT trial_identities_hash CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT trial_identities_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT trial_identities_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);
