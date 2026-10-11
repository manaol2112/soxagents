-- The agent console (Milestone 8.1b).
--
-- A person talks to the engagement's agents in a thread. Each agent turn is answered
-- in the background: the agent reads the engagement's records through registered read
-- tools, runs routine tools at once, and proposes the rest as steps. A step runs only
-- when the person confirms it, as that person, through the same service code as the
-- pages. The thread is a conversation, not the system of record: every effect lands in
-- the engagement's own tables and audit trail.

CREATE TABLE console_threads (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT console_threads_title CHECK (char_length(title) <= 200),
    CONSTRAINT console_threads_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT console_threads_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX console_threads_user_idx ON console_threads (project_id, user_id, updated_at);

CREATE TABLE console_messages (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    thread_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL DEFAULT '',
    -- The provider-neutral turn the agent saw and said, so the thread can continue.
    transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'DONE',
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT console_messages_role CHECK (role IN ('USER', 'AGENT')),
    CONSTRAINT console_messages_status CHECK (status IN ('PENDING', 'WORKING', 'DONE', 'FAILED')),
    CONSTRAINT console_messages_user_done CHECK (role = 'AGENT' OR status = 'DONE'),
    CONSTRAINT console_messages_text CHECK (
        char_length(content) <= 20000 AND char_length(note) <= 300
    ),
    CONSTRAINT console_messages_transcript CHECK (jsonb_typeof(transcript) = 'array'),
    CONSTRAINT console_messages_attempts CHECK (attempts BETWEEN 0 AND 20),
    CONSTRAINT console_messages_thread_fk
        FOREIGN KEY (thread_id) REFERENCES console_threads (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX console_messages_thread_idx ON console_messages (thread_id, created_at);
CREATE INDEX console_messages_open_idx ON console_messages (status, lease_until)
    WHERE status IN ('PENDING', 'WORKING');

CREATE TABLE console_actions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    message_id uuid NOT NULL,
    position integer NOT NULL,
    tool text NOT NULL,
    risk text NOT NULL,
    arguments jsonb NOT NULL,
    summary text NOT NULL,
    status text NOT NULL,
    result jsonb,
    error text NOT NULL DEFAULT '',
    decided_by uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT console_actions_risk CHECK (risk IN ('ROUTINE', 'CONFIRM')),
    CONSTRAINT console_actions_status CHECK (
        status IN ('PROPOSED', 'DONE', 'FAILED', 'CANCELLED')
    ),
    -- A routine step ran when the agent called it. A confirmed step names its person.
    CONSTRAINT console_actions_decided CHECK (
        risk = 'ROUTINE' OR status = 'PROPOSED' OR decided_by IS NOT NULL
    ),
    CONSTRAINT console_actions_arguments CHECK (jsonb_typeof(arguments) = 'object'),
    CONSTRAINT console_actions_text CHECK (
        char_length(tool) BETWEEN 1 AND 60 AND char_length(summary) BETWEEN 1 AND 500
        AND char_length(error) <= 500
    ),
    CONSTRAINT console_actions_position_key UNIQUE (message_id, position),
    CONSTRAINT console_actions_message_fk
        FOREIGN KEY (message_id) REFERENCES console_messages (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT console_actions_person_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);
