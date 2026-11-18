-- The last workspace page each person opened (decided by the product owner on 28 October
-- 2026: "the system remembers the last page the user browsed", on the account, so it
-- follows the person from one computer to another). One row per person, replaced as they
-- move; opening the workspace without an address returns them there. The page is kept
-- as its address within the workspace, with the firm and engagement it belongs to, so
-- access is checked again before anyone is sent back to it.
--
-- Rollback: drop the table user_last_pages; delete the '0124_last_pages' row from
-- schema_migrations.

CREATE TABLE user_last_pages (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    project_id uuid REFERENCES projects (id) ON DELETE CASCADE,
    path text NOT NULL,
    visited_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT user_last_pages_path CHECK (
        char_length(path) BETWEEN 3 AND 2000 AND left(path, 2) = '/?'
    )
);
