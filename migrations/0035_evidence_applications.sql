-- Evidence by application (Milestone 8.2, by the product owner's decision).
--
-- A control often covers several applications (a password control over AD, the database,
-- the ERP, Linux, and AWS). Each evidence file is tagged with the application it shows,
-- so the control's evidence and its testing are kept per application: AD can pass while
-- the database fails. The evidence coordinator suggests the tag when it reads the file;
-- a person can change it.
--
-- scope: ONE (the file shows one application), ALL (it applies to every application of
-- the control, such as a policy), UNKNOWN (the coordinator could not tell).

CREATE TABLE evidence_file_applications (
    evidence_file_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    scope text NOT NULL,
    engagement_application_id uuid,
    tagged_by text NOT NULL,
    decided_by uuid,
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT evidence_file_applications_scope CHECK (scope IN ('ONE', 'ALL', 'UNKNOWN')),
    CONSTRAINT evidence_file_applications_one CHECK (
        (scope = 'ONE') = (engagement_application_id IS NOT NULL)
    ),
    CONSTRAINT evidence_file_applications_by CHECK (
        (tagged_by = 'AGENT' AND decided_by IS NULL)
        OR (tagged_by = 'PERSON' AND decided_by IS NOT NULL)
    ),
    CONSTRAINT evidence_file_applications_reason CHECK (char_length(reason) <= 300),
    CONSTRAINT evidence_file_applications_version CHECK (version >= 1),
    CONSTRAINT evidence_file_applications_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_file_applications_file_fk
        FOREIGN KEY (evidence_file_id) REFERENCES evidence_files (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_file_applications_application_fk
        FOREIGN KEY (project_id, engagement_application_id)
        REFERENCES engagement_applications (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_file_applications_person_fk
        FOREIGN KEY (decided_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER evidence_file_applications_updated_at
    BEFORE UPDATE ON evidence_file_applications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A test item can stand for one application: a control tested once over several
-- applications is tested once per application.
ALTER TABLE test_items ADD COLUMN engagement_application_id uuid;
ALTER TABLE test_items ADD CONSTRAINT test_items_application_fk
    FOREIGN KEY (engagement_application_id) REFERENCES engagement_applications (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
