-- The evidence portal as the control owner's working space (decided by the product owner):
-- each upload can serve one deliverable (a planned requirement), the owner answers the
-- audit team's questions, the owner and the team write to each other on a request, and the
-- owner says when they have submitted what they have. Uploads still reach the audit team
-- the moment they arrive; submitting only records that the owner is done.

-- A file the owner uploaded for one deliverable is linked to it by the owner. An owner is
-- not a user: such a link names no person, and its reason says it came from the portal.
ALTER TABLE evidence_requirement_files
    DROP CONSTRAINT evidence_requirement_files_origin,
    ADD CONSTRAINT evidence_requirement_files_origin
        CHECK (origin IN ('PERSON', 'AGENT', 'OWNER'));

-- Which of the request's numbered items an owner's upload was for (its deliverable), so
-- the portal groups files by item even where no planned requirement matches the item.
ALTER TABLE evidence_matches
    ADD COLUMN owner_item integer,
    ADD CONSTRAINT evidence_matches_owner_item CHECK (owner_item BETWEEN 1 AND 50);

-- The owner submitted what they have (they may submit again after adding more).
ALTER TABLE pbc_requests
    ADD COLUMN owner_submitted_at timestamptz,
    ADD COLUMN owner_submission_note text NOT NULL DEFAULT '',
    ADD CONSTRAINT pbc_requests_owner_submission_note
        CHECK (char_length(owner_submission_note) <= 2000);

-- The owner's answer to one of the request's questions, by the question's key (a hash of
-- its wording, so an answer stays with the question it answers). Replaced when the owner
-- edits it; every change is audited.
CREATE TABLE request_answers (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    pbc_request_id uuid NOT NULL REFERENCES pbc_requests (id) ON DELETE RESTRICT,
    question_key text NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    answered_by_email text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT request_answers_key CHECK (question_key ~ '^[0-9a-f]{16}$'),
    CONSTRAINT request_answers_text CHECK (
        char_length(btrim(question)) BETWEEN 1 AND 1000
        AND char_length(btrim(answer)) BETWEEN 1 AND 4000
        AND char_length(answered_by_email) BETWEEN 3 AND 320
    ),
    CONSTRAINT request_answers_version CHECK (version >= 1),
    CONSTRAINT request_answers_one UNIQUE (pbc_request_id, question_key),
    CONSTRAINT request_answers_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- A message on one request, from the owner (through the portal) or the audit team. A
-- message is a record: it is never changed or deleted, except that the team marks an
-- owner's message seen.
CREATE TABLE request_messages (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    pbc_request_id uuid NOT NULL REFERENCES pbc_requests (id) ON DELETE RESTRICT,
    author_kind text NOT NULL,
    author_email text NOT NULL DEFAULT '',
    author_user_id uuid REFERENCES users (id),
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    seen_by_team_at timestamptz,
    CONSTRAINT request_messages_kind CHECK (author_kind IN ('OWNER', 'TEAM')),
    CONSTRAINT request_messages_author CHECK (
        (author_kind = 'OWNER' AND char_length(author_email) BETWEEN 3 AND 320
            AND author_user_id IS NULL)
        OR (author_kind = 'TEAM' AND author_user_id IS NOT NULL AND author_email = '')
    ),
    CONSTRAINT request_messages_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
    CONSTRAINT request_messages_seen CHECK (author_kind = 'OWNER' OR seen_by_team_at IS NULL),
    CONSTRAINT request_messages_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX request_messages_request_idx ON request_messages (pbc_request_id, created_at);
CREATE INDEX request_messages_unseen_idx
    ON request_messages (project_id) WHERE author_kind = 'OWNER' AND seen_by_team_at IS NULL;

CREATE FUNCTION prevent_request_message_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'request messages are immutable';
    END IF;
    IF OLD.seen_by_team_at IS NULL
        AND NEW.seen_by_team_at IS NOT NULL
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
        AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
        AND NEW.pbc_request_id IS NOT DISTINCT FROM OLD.pbc_request_id
        AND NEW.author_kind IS NOT DISTINCT FROM OLD.author_kind
        AND NEW.author_email IS NOT DISTINCT FROM OLD.author_email
        AND NEW.author_user_id IS NOT DISTINCT FROM OLD.author_user_id
        AND NEW.body IS NOT DISTINCT FROM OLD.body
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'request messages are immutable';
END;
$$;

CREATE TRIGGER request_messages_immutable
BEFORE UPDATE OR DELETE ON request_messages
FOR EACH ROW EXECUTE FUNCTION prevent_request_message_change();
