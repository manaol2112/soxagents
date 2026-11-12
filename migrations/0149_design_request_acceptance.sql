-- The D&I requests list: acceptance per request, coverage of the attributes, and a release
-- that follows the last acceptance (decided by the product owner on 12 November 2026;
-- docs/control-workflow-plan.md, B1e "The D&I requests list").
--
-- Until now a person released the D&I evidence with a button, once Control Understanding
-- was complete and the attributes were settled (0145, B1a). The product owner: "Why do I
-- need to have the release button? Simplify the workflow. After the attributes approval,
-- list down the evidences so that I can add, modify or update, or delete. Similar to how I
-- do in the attributes." and "Agent proposes, the human approves. For each request, I want
-- to show which specific attributes it is addressing to make sure I get coverage."
--
-- 1. evidence_requirements.accepted_by / accepted_at: the person who owns the request as it
--    stands, and when. A request the agent proposed is not accepted until a person accepts
--    it; a request a person adds, edits, restores or links to attributes is accepted by that
--    act. The planner never overwrites an accepted D&I request: its later change or removal
--    arrives as the request's pending_change (0062), for a person to accept or reject.
--    Both set or both null.
--
-- 2. design_coverage_exceptions: every approved attribute is addressed by at least one live
--    D&I request, or a person records why it is not evidenced at D&I. One row per control
--    and attribute, with the reason (20 to 500 characters) and who recorded it. Clearing an
--    exception deletes the row; both acts are on the audit trail with the reason. Holds the
--    audit's own record, so an archived engagement's are read-only (as 0136).
--
-- 3. phase_releases.automatic: the D&I release recorded by the server in the request of the
--    person whose acceptance (or other change) completed the list. It names that person,
--    and is never early. A release a person made through the release route is not automatic.
--
-- Backfill: the D&I requests of a control whose D&I phase is already released were released
-- by a person, so they are accepted by the releaser at the release time. Not a request
-- removed from the plan, nor an addition the planner proposed after the release and nobody
-- accepted (pending_change.add), nor any request made after the release, whoever made it:
-- none of them was released. A release with no releaser on record
-- (0145 recorded some for requests already under way) accepts nothing: nobody is invented.
-- An archived engagement's records are left as they are (0136 refuses the write). Nothing
-- else changes: no release is added or removed.
--
-- Rollback: DROP TABLE design_coverage_exceptions; ALTER TABLE phase_releases DROP
-- CONSTRAINT phase_releases_automatic, DROP COLUMN automatic; ALTER TABLE
-- evidence_requirements DROP CONSTRAINT evidence_requirements_accepted, DROP COLUMN
-- accepted_by, DROP COLUMN accepted_at; and delete the '0149_design_request_acceptance' row
-- from schema_migrations. The acceptances are lost with the columns (the audit trail keeps
-- evidence_requirement.accepted), and D&I releases made automatically stay released.

-- 1. Acceptance of a request

ALTER TABLE evidence_requirements
    ADD COLUMN accepted_by uuid REFERENCES users (id),
    ADD COLUMN accepted_at timestamptz,
    ADD CONSTRAINT evidence_requirements_accepted CHECK (
        (accepted_by IS NULL) = (accepted_at IS NULL)
    );

-- 2. Why an approved attribute is not evidenced at D&I

CREATE TABLE design_coverage_exceptions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    attribute_id uuid NOT NULL REFERENCES control_attributes (id) ON DELETE RESTRICT,
    reason text NOT NULL,
    -- Always a person: an agent never excuses an attribute from the D&I evidence.
    recorded_by uuid NOT NULL REFERENCES users (id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT design_coverage_exceptions_reason CHECK (
        char_length(btrim(reason)) >= 20 AND char_length(reason) <= 500
    ),
    CONSTRAINT design_coverage_exceptions_one UNIQUE (engagement_control_id, attribute_id),
    CONSTRAINT design_coverage_exceptions_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_coverage_exceptions_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- The phase board reads an engagement's exceptions at once.
CREATE INDEX design_coverage_exceptions_project_idx
    ON design_coverage_exceptions (project_id);

CREATE TRIGGER design_coverage_exceptions_updated_at
    BEFORE UPDATE ON design_coverage_exceptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER design_coverage_exceptions_archived_guard
    BEFORE INSERT OR UPDATE OR DELETE ON design_coverage_exceptions
    FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

-- 3. A release recorded with the acceptance that completed the list

ALTER TABLE phase_releases
    ADD COLUMN automatic boolean NOT NULL DEFAULT false,
    -- Only the D&I release is automatic; it is never early, and it names the person whose
    -- request completed the list.
    ADD CONSTRAINT phase_releases_automatic CHECK (
        NOT automatic OR (phase = 'DESIGN' AND NOT early AND released_by IS NOT NULL)
    );

-- Backfill: what a person released is accepted by that person, at the release.

UPDATE evidence_requirements q
SET accepted_by = r.released_by, accepted_at = r.released_at
FROM phase_releases r, projects p
WHERE r.engagement_control_id = q.engagement_control_id
  AND r.phase = 'DESIGN'
  AND r.released_by IS NOT NULL
  AND p.id = q.project_id
  AND NOT (p.status::text = 'ARCHIVED' AND p.deleted_at IS NULL)
  AND q.phase = 'DESIGN'
  AND q.status <> 'REMOVED'
  AND NOT coalesce((q.pending_change ->> 'add')::boolean, false)
  -- Only what the release covered: a request made after it was not released by anyone.
  AND q.created_at <= r.released_at
  AND q.accepted_at IS NULL;
