CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash),
    CONSTRAINT auth_sessions_expires_after_create CHECK (expires_at > created_at),
    CONSTRAINT auth_sessions_version_positive CHECK (version >= 1),
    CONSTRAINT auth_sessions_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE oidc_login_attempts (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    state_hash text NOT NULL,
    flow jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT oidc_login_attempts_state_hash_key UNIQUE (state_hash),
    CONSTRAINT oidc_login_attempts_flow_object CHECK (jsonb_typeof(flow) = 'object'),
    CONSTRAINT oidc_login_attempts_expires_after_create CHECK (expires_at > created_at)
);

CREATE TRIGGER auth_sessions_set_updated_at
BEFORE UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);
CREATE INDEX oidc_login_attempts_expires_idx ON oidc_login_attempts (expires_at);
