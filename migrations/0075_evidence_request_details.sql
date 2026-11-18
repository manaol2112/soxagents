-- Evidence request details: an explicit request type, a short title, a priority, people
-- copied on the request, the engagement's own contacts, and reference attachments with
-- an explicit visibility. Existing requests keep working: every new column has a default
-- or is optional, and a request's type is worked out from its records until a person
-- confirms it.

-- 1. Request types, as data rather than code, so a firm can extend them.
CREATE TABLE evidence_request_types (
    request_type text PRIMARY KEY,
    label text NOT NULL,
    purpose text NOT NULL,
    sort_order integer NOT NULL,
    CONSTRAINT evidence_request_types_key CHECK (request_type ~ '^[A-Z][A-Z_]{1,39}$'),
    CONSTRAINT evidence_request_types_label CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
    CONSTRAINT evidence_request_types_purpose CHECK (
        char_length(btrim(purpose)) BETWEEN 1 AND 300
    )
);

INSERT INTO evidence_request_types (request_type, label, purpose, sort_order) VALUES
    ('POPULATION', 'Population',
     'The complete population for sampling or completeness testing.', 10),
    ('SAMPLE_EVIDENCE', 'Sample evidence',
     'Supporting evidence for selected transactions or occurrences.', 20),
    ('SAMPLE_OF_ONE', 'Sample of one',
     'One completed instance, to support a walkthrough or the design assessment.', 30),
    ('CONFIGURATION', 'Configuration',
     'System settings or configuration evidence.', 40),
    ('POLICY_PROCEDURE', 'Policy / procedure',
     'The documented control procedure.', 50),
    ('PROCESS_NARRATIVE', 'Process narrative',
     'A narrative or confirmation of how the process operates.', 60),
    ('SYSTEM_REPORT', 'System report / IPE',
     'Reports and the information needed to assess their reliability.', 70),
    ('ACCESS_LISTING', 'Access listing',
     'User access populations or permissions.', 80),
    ('RECONCILIATION', 'Reconciliation',
     'Completed reconciliation evidence.', 90),
    ('APPROVAL_EVIDENCE', 'Approval evidence',
     'Approval or review documentation.', 100),
    ('EXCEPTION_EVIDENCE', 'Exception evidence',
     'Support for the investigation and resolution of exceptions.', 110),
    ('OTHER', 'Other',
     'Other clearly defined evidence.', 120);

-- 2. The request itself.
ALTER TABLE pbc_requests
    ADD COLUMN request_type text REFERENCES evidence_request_types (request_type),
    -- Who set the type: the reviewed rules, the agent, or a person.
    ADD COLUMN request_type_basis text NOT NULL DEFAULT 'RULES',
    ADD COLUMN request_type_confirmed boolean NOT NULL DEFAULT false,
    -- A short title for lists and headers; the full wording stays in evidence_description.
    ADD COLUMN title text NOT NULL DEFAULT '',
    ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL',
    -- People copied on the request, besides its recipient.
    ADD COLUMN cc_recipients text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT pbc_requests_type_basis CHECK (
        request_type_basis IN ('RULES', 'AGENT', 'PERSON')
    ),
    ADD CONSTRAINT pbc_requests_title CHECK (char_length(title) <= 160),
    ADD CONSTRAINT pbc_requests_priority CHECK (priority IN ('NORMAL', 'HIGH', 'URGENT')),
    ADD CONSTRAINT pbc_requests_cc CHECK (cardinality(cc_recipients) <= 10);

-- 3. The engagement's own contacts, added from a request: people at the client who
-- receive or are copied on evidence requests.
CREATE TABLE engagement_contacts (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role text NOT NULL DEFAULT '',
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT engagement_contacts_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT engagement_contacts_email CHECK (
        char_length(email) BETWEEN 3 AND 254 AND email = lower(email)
    ),
    CONSTRAINT engagement_contacts_role CHECK (char_length(role) <= 120),
    CONSTRAINT engagement_contacts_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX engagement_contacts_one_email ON engagement_contacts (project_id, email);

-- 4. Reference material attached to a request: uploaded, one of the engagement's files,
-- or a prior-year workpaper of the same client. Internal to the audit team unless a
-- person who may approve requests shares it with the recipient.
CREATE TABLE request_attachments (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    pbc_request_id uuid NOT NULL REFERENCES pbc_requests (id) ON DELETE RESTRICT,
    source text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    size_bytes integer NOT NULL,
    object_key text NOT NULL,
    content_sha256 text NOT NULL,
    evidence_file_id uuid REFERENCES evidence_files (id) ON DELETE RESTRICT,
    prior_project_id uuid REFERENCES projects (id) ON DELETE RESTRICT,
    prior_workpaper_id uuid REFERENCES workpapers (id) ON DELETE RESTRICT,
    -- The year it comes from, for a prior-year workpaper ("FY2026").
    source_year text NOT NULL DEFAULT '',
    visibility text NOT NULL DEFAULT 'INTERNAL',
    shared_by uuid REFERENCES users (id),
    shared_at timestamptz,
    added_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    removed_by uuid REFERENCES users (id),
    removed_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT request_attachments_source CHECK (
        source IN ('UPLOAD', 'ENGAGEMENT_FILE', 'PRIOR_YEAR_WORKPAPER')
    ),
    CONSTRAINT request_attachments_name CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 255),
    CONSTRAINT request_attachments_type CHECK (char_length(content_type) BETWEEN 1 AND 120),
    CONSTRAINT request_attachments_size CHECK (size_bytes BETWEEN 0 AND 26214400),
    CONSTRAINT request_attachments_sha CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT request_attachments_key CHECK (object_key ~ '^evidence/[0-9a-f-]{36}$'),
    CONSTRAINT request_attachments_year CHECK (char_length(source_year) <= 20),
    CONSTRAINT request_attachments_origin CHECK (
        (source = 'ENGAGEMENT_FILE') = (evidence_file_id IS NOT NULL)
        AND (source = 'PRIOR_YEAR_WORKPAPER')
            = (prior_workpaper_id IS NOT NULL AND prior_project_id IS NOT NULL)
    ),
    CONSTRAINT request_attachments_visibility CHECK (visibility IN ('INTERNAL', 'SHARED')),
    CONSTRAINT request_attachments_shared CHECK (
        (visibility = 'SHARED') = (shared_by IS NOT NULL AND shared_at IS NOT NULL)
    ),
    CONSTRAINT request_attachments_removed CHECK (
        (removed_by IS NULL) = (removed_at IS NULL)
    ),
    CONSTRAINT request_attachments_version CHECK (version >= 1),
    CONSTRAINT request_attachments_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX request_attachments_request ON request_attachments (pbc_request_id)
    WHERE removed_at IS NULL;
