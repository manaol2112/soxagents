-- Demo requests from the public landing page. No session is needed to leave one, so
-- the table keeps only what the form asks for, with lengths capped, and where it came
-- from, so a flood from one place can be throttled.

CREATE TABLE demo_requests (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    name text NOT NULL,
    email text NOT NULL,
    firm text NOT NULL DEFAULT '',
    message text NOT NULL DEFAULT '',
    source_ip text NOT NULL DEFAULT '',
    user_agent text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT demo_requests_name CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT demo_requests_email CHECK (char_length(email) BETWEEN 3 AND 200),
    CONSTRAINT demo_requests_firm CHECK (char_length(firm) <= 200),
    CONSTRAINT demo_requests_message CHECK (char_length(message) <= 2000),
    CONSTRAINT demo_requests_source CHECK (
        char_length(source_ip) <= 64 AND char_length(user_agent) <= 300
    )
);

CREATE INDEX demo_requests_created_idx ON demo_requests (created_at);
CREATE INDEX demo_requests_email_idx ON demo_requests (lower(email), created_at);
