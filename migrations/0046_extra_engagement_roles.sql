-- More than one engagement role for one person, for development only.
--
-- project_memberships keeps each person's main role. While REVIEW_INDEPENDENCE_REQUIRED
-- is false, a person can also hold other roles on the same engagement (lead and
-- reviewer, say); those extra roles live here. With independence required, the API
-- ignores this table, so a real engagement keeps one role per person.

CREATE TABLE project_member_roles (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    engagement_role text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT project_member_roles_key UNIQUE (project_id, user_id, engagement_role),
    CONSTRAINT project_member_roles_role CHECK (
        engagement_role IN ('LEAD', 'PREPARER', 'REVIEWER')
    ),
    -- Removing someone from the team removes their extra roles with them.
    CONSTRAINT project_member_roles_member_fk
        FOREIGN KEY (project_id, user_id) REFERENCES project_memberships (project_id, user_id)
        ON DELETE CASCADE ON UPDATE RESTRICT
);
