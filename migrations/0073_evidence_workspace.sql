-- The evidence workspace.
--
-- 1. A request keeps its full wording. The drafter used to clip each planned item and drop
--    whole items to fit 3,400 characters; a request now holds every planned item, whole.
--    An email that cannot carry the full wording sends a summary with the secure link to
--    the full request (outbound.py), so nothing is cut without saying so.
-- 2. A received file can serve a requirement other than the ones its request carries: the
--    design walkthrough's file for an interim requirement, one file for two phases. A file
--    serves the requirements of its own request without a row here; a row links it to any
--    other requirement of the same control, with who linked it, when, and why. A withdrawn
--    file stops serving every requirement at once, as it leaves its request: readers join
--    through evidence_file_links.

ALTER TABLE pbc_requests DROP CONSTRAINT pbc_requests_description;
ALTER TABLE pbc_requests ADD CONSTRAINT pbc_requests_description CHECK (
    char_length(evidence_description) BETWEEN 1 AND 80000
);

CREATE TABLE evidence_requirement_files (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    evidence_file_id uuid NOT NULL REFERENCES evidence_files (id) ON DELETE RESTRICT,
    -- LINKED: the file serves the requirement. PROPOSED: an agent suggests it, and a person
    -- decides. REMOVED: unlinked, kept for the record.
    status text NOT NULL,
    origin text NOT NULL,
    reason text NOT NULL,
    linked_by uuid REFERENCES users (id),
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    removed_by uuid REFERENCES users (id),
    removed_at timestamptz,
    removed_reason text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT evidence_requirement_files_status CHECK (
        status IN ('PROPOSED', 'LINKED', 'REMOVED')
    ),
    CONSTRAINT evidence_requirement_files_origin CHECK (origin IN ('PERSON', 'AGENT')),
    CONSTRAINT evidence_requirement_files_reason CHECK (
        char_length(btrim(reason)) BETWEEN 3 AND 500
        AND char_length(removed_reason) <= 500
    ),
    -- A person's link names them; a removal names who removed it and why.
    CONSTRAINT evidence_requirement_files_linked CHECK (
        origin <> 'PERSON' OR linked_by IS NOT NULL
    ),
    CONSTRAINT evidence_requirement_files_removed CHECK (
        (status = 'REMOVED') = (removed_at IS NOT NULL)
        AND (status <> 'REMOVED' OR (
            removed_by IS NOT NULL AND char_length(btrim(removed_reason)) >= 3
        ))
    ),
    CONSTRAINT evidence_requirement_files_version CHECK (version >= 1),
    CONSTRAINT evidence_requirement_files_one UNIQUE (requirement_id, evidence_file_id),
    CONSTRAINT evidence_requirement_files_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_requirement_files_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_requirement_files_control_idx
    ON evidence_requirement_files (engagement_control_id, status);
CREATE INDEX evidence_requirement_files_file_idx
    ON evidence_requirement_files (evidence_file_id);
