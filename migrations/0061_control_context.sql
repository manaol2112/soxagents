-- Control context: attributes owned by controls, supporting documents, process
-- understanding, and the issues that keep a control from being tested.
--
-- Before this, a control's test attributes were a plain list on the control
-- (engagement_controls.test_attributes) with no identity, provenance, or history, and the
-- process narrative (0060) was one free text per control that gated testing for every
-- kind of control. This migration:
--
-- 1. lets the team classify a control beyond what its area and nature imply;
-- 2. stores supporting documents (narratives, policies, procedures, walkthroughs, ...)
--    once per engagement and links each to any number of controls;
-- 3. gives every attribute an identity, a status (proposed, approved, rejected, retired,
--    superseded), a basis (documented or inferred), and a source reference, kept in step
--    with the control's attribute list by a trigger so every existing writer and reader
--    of that list keeps working;
-- 4. records each control's process understanding as a structured map whose steps say
--    whether they are documented or inferred;
-- 5. records missing, ambiguous, or conflicting context as issues a person resolves;
-- 6. lets a test sheet say why its testing waits.
--
-- Nothing is deleted. The 0060 narratives stay as they are; each one with text is copied
-- into a supporting document linked to its control, and each into a process
-- understanding with the same status, so a narrative confirmed before still counts.
--
-- Rollback (only before any new rows matter; the 0060 narratives are untouched):
--   DROP TRIGGER engagement_controls_sync_attributes ON engagement_controls;
--   DROP FUNCTION sync_control_attributes();
--   DROP TABLE control_context_issues, process_understandings, control_attributes,
--              source_document_controls, source_documents;
--   ALTER TABLE engagement_controls DROP COLUMN classifications;
--   ALTER TABLE test_sheets DROP COLUMN waiting_note;
--   and delete the '0061_control_context' row from schema_migrations.

-- 1. Classification

ALTER TABLE engagement_controls ADD COLUMN classifications text[];
ALTER TABLE engagement_controls ADD CONSTRAINT engagement_controls_classifications CHECK (
    classifications IS NULL
    OR (
        cardinality(classifications) BETWEEN 1 AND 6
        AND classifications <@ ARRAY[
            'ITGC', 'AUTOMATED_APPLICATION', 'IT_DEPENDENT_MANUAL', 'BUSINESS_PROCESS',
            'ENTITY_LEVEL', 'KEY_REPORT'
        ]::text[]
    )
);

-- 2. Supporting documents

CREATE TABLE source_documents (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    file_name text NOT NULL DEFAULT '',
    file_sha256 text NOT NULL DEFAULT '',
    -- The document's text as read (an uploaded file itself is not kept).
    text text NOT NULL,
    origin text NOT NULL,
    created_by uuid,
    -- The 0060 narrative this document was copied from, so the copy is made once.
    legacy_narrative_id uuid UNIQUE,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT source_documents_kind CHECK (
        kind IN (
            'NARRATIVE', 'POLICY', 'PROCEDURE', 'FLOWCHART', 'WALKTHROUGH', 'SYSTEM',
            'PRIOR_YEAR', 'OTHER'
        )
    ),
    CONSTRAINT source_documents_origin CHECK (origin IN ('UPLOAD', 'WRITTEN', 'AGENT')),
    CONSTRAINT source_documents_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT source_documents_text CHECK (char_length(text) BETWEEN 1 AND 100000),
    CONSTRAINT source_documents_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

CREATE INDEX source_documents_project_idx ON source_documents (project_id, created_at);

CREATE TABLE source_document_controls (
    document_id uuid NOT NULL REFERENCES source_documents (id) ON DELETE CASCADE,
    engagement_control_id uuid NOT NULL REFERENCES engagement_controls (id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    linked_by uuid,
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- When the agent last reviewed this document against this control.
    reviewed_at timestamptz,
    PRIMARY KEY (document_id, engagement_control_id)
);

CREATE INDEX source_document_controls_control_idx
    ON source_document_controls (engagement_control_id);

-- 3. Attributes

CREATE TABLE control_attributes (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL REFERENCES engagement_controls (id) ON DELETE CASCADE,
    position integer NOT NULL DEFAULT 0,
    text text NOT NULL,
    status text NOT NULL,
    basis text NOT NULL DEFAULT 'DOCUMENTED',
    source_kind text NOT NULL,
    source_document_id uuid REFERENCES source_documents (id) ON DELETE SET NULL,
    source_quote text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '',
    -- For a proposal: what it would do to the approved set.
    proposal text,
    replaces_id uuid REFERENCES control_attributes (id),
    created_by uuid,
    decided_by uuid,
    decided_at timestamptz,
    model_call_id uuid,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_attributes_text CHECK (char_length(btrim(text)) BETWEEN 1 AND 300),
    CONSTRAINT control_attributes_status CHECK (
        status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'RETIRED', 'SUPERSEDED')
    ),
    CONSTRAINT control_attributes_basis CHECK (basis IN ('DOCUMENTED', 'INFERRED')),
    CONSTRAINT control_attributes_source CHECK (
        source_kind IN ('LIBRARY', 'RCM', 'MANUAL', 'AGENT', 'DOCUMENT')
    ),
    CONSTRAINT control_attributes_proposal CHECK (
        proposal IS NULL OR proposal IN ('ADD', 'CHANGE', 'RETIRE')
    ),
    CONSTRAINT control_attributes_quote CHECK (char_length(source_quote) <= 500),
    CONSTRAINT control_attributes_note CHECK (char_length(note) <= 500)
);

-- One approved attribute per wording on a control: no duplicates.
CREATE UNIQUE INDEX control_attributes_approved_text
    ON control_attributes (engagement_control_id, md5(text)) WHERE status = 'APPROVED';
CREATE INDEX control_attributes_control_idx
    ON control_attributes (engagement_control_id, status, position);

-- Every control's current list, as approved attributes from the control's own source.
INSERT INTO control_attributes (
    organization_id, project_id, engagement_control_id, position, text, status, basis,
    source_kind, decided_at
)
SELECT DISTINCT ON (c.id, md5(t.value))
       c.organization_id, c.project_id, c.id, (t.ordinality - 1)::integer, t.value,
       'APPROVED', 'DOCUMENTED',
       CASE c.source WHEN 'LIBRARY' THEN 'LIBRARY' WHEN 'UPLOAD' THEN 'RCM'
                     WHEN 'AGENT' THEN 'AGENT' ELSE 'MANUAL' END,
       c.created_at
FROM engagement_controls c
CROSS JOIN LATERAL jsonb_array_elements_text(c.test_attributes) WITH ORDINALITY AS t(value, ordinality)
WHERE char_length(btrim(t.value)) BETWEEN 1 AND 300
  AND NOT EXISTS (
      SELECT 1 FROM control_attributes a
      WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED' AND a.text = t.value
  )
ORDER BY c.id, md5(t.value), t.ordinality;

-- The list on the control stays the one every module reads. Whoever writes it (setup,
-- an RCM import, the library, the control editor, or the attribute service), the
-- approved attributes follow: a wording no longer listed is retired (kept, not deleted),
-- a new wording becomes an approved attribute from the control's own source, and the
-- positions follow the list.
CREATE FUNCTION sync_control_attributes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    item record;
    origin text;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.test_attributes IS NOT DISTINCT FROM OLD.test_attributes THEN
        RETURN NEW;
    END IF;
    origin := CASE NEW.source WHEN 'LIBRARY' THEN 'LIBRARY' WHEN 'UPLOAD' THEN 'RCM'
                              WHEN 'AGENT' THEN 'AGENT' ELSE 'MANUAL' END;
    UPDATE control_attributes a
    SET status = 'RETIRED', version = a.version + 1, updated_at = clock_timestamp(),
        note = CASE WHEN a.note = '' THEN 'Removed from the control''s attributes.'
                    ELSE a.note END
    WHERE a.engagement_control_id = NEW.id AND a.status = 'APPROVED'
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(NEW.test_attributes) AS t(value)
          WHERE t.value = a.text
      );
    FOR item IN
        SELECT t.value, (t.ordinality - 1)::integer AS position
        FROM jsonb_array_elements_text(NEW.test_attributes) WITH ORDINALITY AS t(value, ordinality)
        WHERE char_length(btrim(t.value)) BETWEEN 1 AND 300
    LOOP
        UPDATE control_attributes
        SET position = item.position
        WHERE engagement_control_id = NEW.id AND status = 'APPROVED' AND text = item.value;
        IF NOT FOUND THEN
            INSERT INTO control_attributes (
                organization_id, project_id, engagement_control_id, position, text, status,
                basis, source_kind, decided_at
            )
            VALUES (
                NEW.organization_id, NEW.project_id, NEW.id, item.position, item.value,
                'APPROVED', 'DOCUMENTED', origin, clock_timestamp()
            );
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_controls_sync_attributes
    AFTER INSERT OR UPDATE OF test_attributes ON engagement_controls
    FOR EACH ROW EXECUTE FUNCTION sync_control_attributes();

-- 4. Process understanding

CREATE TABLE process_understandings (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL UNIQUE
        REFERENCES engagement_controls (id) ON DELETE CASCADE,
    summary text NOT NULL DEFAULT '',
    -- [{key, description, actor, system, control_point, basis, source, quote}]
    steps jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'DRAFT',
    built_by text NOT NULL DEFAULT 'PERSON',
    -- The agent's latest map, kept beside the team's until a person adopts it.
    proposed_summary text NOT NULL DEFAULT '',
    proposed_steps jsonb,
    proposed_note text NOT NULL DEFAULT '',
    proposed_at timestamptz,
    model_call_id uuid,
    confirmed_by uuid,
    confirmed_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT process_understandings_status CHECK (status IN ('DRAFT', 'CONFIRMED')),
    CONSTRAINT process_understandings_confirmed CHECK (
        (status = 'CONFIRMED') = (confirmed_at IS NOT NULL)
    ),
    CONSTRAINT process_understandings_built CHECK (
        built_by IN ('PERSON', 'AGENT', 'RULES', 'LEGACY')
    ),
    CONSTRAINT process_understandings_steps CHECK (
        jsonb_typeof(steps) = 'array'
        AND (proposed_steps IS NULL OR jsonb_typeof(proposed_steps) = 'array')
    ),
    CONSTRAINT process_understandings_summary CHECK (
        char_length(summary) <= 20000 AND char_length(proposed_summary) <= 20000
    ),
    CONSTRAINT process_understandings_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);

-- 5. Issues

CREATE TABLE control_context_issues (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL REFERENCES engagement_controls (id) ON DELETE CASCADE,
    -- What the issue is about: the control's criteria, its process, or its sources.
    origin text NOT NULL,
    kind text NOT NULL,
    topic text NOT NULL,
    detail text NOT NULL,
    why text NOT NULL DEFAULT '',
    resolve text NOT NULL DEFAULT '',
    -- [{document_id or "control", title, quote}], each checked against the source.
    quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The same issue raised again is the same row, not another.
    fingerprint text NOT NULL,
    raised_by text NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    resolution_note text NOT NULL DEFAULT '',
    resolved_by uuid,
    resolved_at timestamptz,
    model_call_id uuid,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT control_context_issues_origin CHECK (
        origin IN ('ATTRIBUTES', 'PROCESS', 'SOURCES')
    ),
    CONSTRAINT control_context_issues_kind CHECK (kind IN ('MISSING', 'AMBIGUOUS', 'CONFLICT')),
    CONSTRAINT control_context_issues_raised CHECK (raised_by IN ('AGENT', 'RULES')),
    CONSTRAINT control_context_issues_status CHECK (
        status IN ('OPEN', 'RESOLVED', 'DISMISSED', 'SUPERSEDED')
    ),
    CONSTRAINT control_context_issues_resolution CHECK (
        status NOT IN ('RESOLVED', 'DISMISSED')
        OR (resolved_at IS NOT NULL AND char_length(btrim(resolution_note)) > 0)
    ),
    CONSTRAINT control_context_issues_text CHECK (
        char_length(topic) BETWEEN 1 AND 120 AND char_length(detail) BETWEEN 1 AND 600
        AND char_length(why) <= 400 AND char_length(resolve) <= 400
        AND char_length(resolution_note) <= 1000
    ),
    CONSTRAINT control_context_issues_quotes CHECK (jsonb_typeof(quotes) = 'array')
);

CREATE INDEX control_context_issues_control_idx
    ON control_context_issues (engagement_control_id, status);
CREATE INDEX control_context_issues_fingerprint_idx
    ON control_context_issues (engagement_control_id, fingerprint);

-- 6. Why testing waits

ALTER TABLE test_sheets ADD COLUMN waiting_note text NOT NULL DEFAULT '';
ALTER TABLE test_sheets ADD CONSTRAINT test_sheets_waiting_note CHECK (
    char_length(waiting_note) <= 500
);

-- 7. The 0060 narratives, carried over

-- A control removed before launch (an RCM replaced) takes its legacy narrative row with
-- it; the narrative's text lives on as a supporting document.
ALTER TABLE control_narratives DROP CONSTRAINT control_narratives_control_fk;
ALTER TABLE control_narratives ADD CONSTRAINT control_narratives_control_fk
    FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id) ON DELETE CASCADE;

INSERT INTO source_documents (
    organization_id, project_id, kind, title, file_name, file_sha256, text, origin,
    created_by, legacy_narrative_id, created_at
)
SELECT n.organization_id, n.project_id, 'NARRATIVE',
       left('Process narrative · ' || c.control_ref, 200), n.file_name, n.file_sha256,
       left(n.text, 100000),
       CASE n.source WHEN 'UPLOAD' THEN 'UPLOAD' WHEN 'AGENT' THEN 'AGENT'
                     WHEN 'LIBRARY' THEN 'AGENT' ELSE 'WRITTEN' END,
       n.confirmed_by, n.id, n.created_at
FROM control_narratives n
JOIN engagement_controls c ON c.id = n.engagement_control_id
WHERE n.text <> ''
ON CONFLICT (legacy_narrative_id) DO NOTHING;

INSERT INTO source_document_controls (
    document_id, engagement_control_id, project_id, linked_by, linked_at, reviewed_at
)
SELECT d.id, n.engagement_control_id, n.project_id, n.confirmed_by, n.created_at,
       n.updated_at
FROM control_narratives n
JOIN source_documents d ON d.legacy_narrative_id = n.id
ON CONFLICT DO NOTHING;

-- The narrative becomes the control's process understanding with the same status: its
-- text as the summary, and one documented step for the control itself.
INSERT INTO process_understandings (
    organization_id, project_id, engagement_control_id, summary, steps, status, built_by,
    confirmed_by, confirmed_at, created_at
)
SELECT n.organization_id, n.project_id, n.engagement_control_id, left(n.text, 20000),
       jsonb_build_array(jsonb_build_object(
           'key', 's1',
           'description', left(coalesce(nullif(btrim(c.activity), ''), c.title), 400),
           'actor', left(c.owner_name, 120),
           'system', '',
           'control_point', true,
           'basis', 'DOCUMENTED',
           'source', d.id::text,
           'quote', ''
       )),
       CASE WHEN n.status = 'CONFIRMED' THEN 'CONFIRMED' ELSE 'DRAFT' END,
       'LEGACY',
       CASE WHEN n.status = 'CONFIRMED' THEN n.confirmed_by END,
       CASE WHEN n.status = 'CONFIRMED' THEN n.confirmed_at END,
       n.created_at
FROM control_narratives n
JOIN engagement_controls c ON c.id = n.engagement_control_id
JOIN source_documents d ON d.legacy_narrative_id = n.id
WHERE n.text <> ''
ON CONFLICT (engagement_control_id) DO NOTHING;

COMMENT ON TABLE control_narratives IS
    'Legacy (0060). Carried into source_documents and process_understandings by 0061; '
    'kept, no longer written.';
