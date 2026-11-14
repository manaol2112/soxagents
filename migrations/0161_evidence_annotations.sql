-- Evidence annotations (docs/evidence-annotations.md; asked for by the product owner on
-- 14 November 2026: "the AI agent annotates the basis why the specific evidence satisfy the
-- requirements of the control and the specific attribute. This annotations would be
-- reviewed by the user and can be adjusted as needed").
--
-- evidence_annotations keeps one row per annotation of a file on a D&I request: the passage
-- (its exact words, its page and, where the file has positions, its boxes as fractions of
-- the page), what it shows in one sentence, the attributes it bears on, and who reviewed
-- it. The agent's are proposed in code from a finished engine 2 check (migration 0160) of
-- the request, in the transaction that saves the run, with no model call of their own; a
-- person's are added by that person. An annotation is model-derived text until a person
-- reviews it: it is shown, never sent anywhere, never a finding, and it decides nothing.
--
--   origin    AGENT (proposed from a run, which it names) or PERSON (added by a person);
--   status    PROPOSED and SUPERSEDED are the agent's alone; CONFIRMED, EDITED and REMOVED
--             are a person's decision, with who and when;
--   kept      the agent's own sentence stays beside the person's wording (agent_statement);
--             a removed annotation stays on record; no annotation is ever deleted.
--
-- What a person reviewed is never changed by a run: the guard below refuses to supersede,
-- or put back to proposed, an annotation a person confirmed, edited, added or removed, and
-- refuses any change to one that was removed or superseded. Who an annotation belongs to
-- (the firm, the engagement, the control, the request, the file, its origin, its run, its
-- kind, the agent's own sentence) never changes.
--
-- evidence_word_boxes keeps, for an image file, the words the local OCR engine reads with
-- their positions in the image's own pixels, one row per page. The image never leaves the
-- machine for it, whatever the firm's OCR choice for reading. Written once per file (a
-- stored file never changes): nothing of the file's stored text or its hash changes, and
-- no file is read again for its text.
--
-- Additive: two tables, two guard functions, one written-once function. No existing row
-- or table is changed.
--
-- Rollback: DROP TABLE evidence_annotations; DROP TABLE evidence_word_boxes; DROP FUNCTION
-- guard_evidence_annotation_update(), prevent_evidence_annotation_deletion(),
-- keep_evidence_word_boxes(); delete the audit events whose action starts with
-- 'evidence_annotation' only if the firm's retention allows it (they are otherwise kept:
-- they name no table); delete the '0161_evidence_annotations' row from schema_migrations.
-- A run saved since keeps its proposals in its review (review -> 'annotations'), which the
-- earlier code ignores.

CREATE TABLE evidence_word_boxes (
    evidence_file_id uuid NOT NULL REFERENCES evidence_files (id) ON DELETE RESTRICT,
    page integer NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    -- The page as the words are placed on it, in pixels (the image upright).
    width integer NOT NULL,
    height integer NOT NULL,
    -- [[text, x, y, w, h], ...] in reading order, in pixels of that page.
    words jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- What read them (the local engine and its languages), never a model.
    engine text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (evidence_file_id, page),
    CONSTRAINT evidence_word_boxes_page CHECK (page BETWEEN 1 AND 300),
    CONSTRAINT evidence_word_boxes_size CHECK (
        width BETWEEN 1 AND 100000 AND height BETWEEN 1 AND 100000
    ),
    CONSTRAINT evidence_word_boxes_words CHECK (
        jsonb_typeof(words) = 'array' AND pg_column_size(words) <= 1048576
    ),
    CONSTRAINT evidence_word_boxes_engine CHECK (char_length(btrim(engine)) BETWEEN 1 AND 80),
    CONSTRAINT evidence_word_boxes_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_word_boxes_project_idx ON evidence_word_boxes (project_id);

-- Written once: a stored file never changes, so neither do the words read from it.
CREATE FUNCTION keep_evidence_word_boxes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'the words read from an evidence file are written once';
END;
$$;

CREATE TRIGGER evidence_word_boxes_kept
BEFORE UPDATE OR DELETE ON evidence_word_boxes
FOR EACH ROW EXECUTE FUNCTION keep_evidence_word_boxes();

-- An archived engagement is read-only (migration 0136): no positions are made for it.
CREATE TRIGGER evidence_word_boxes_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_word_boxes
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

CREATE TABLE evidence_annotations (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    requirement_id uuid NOT NULL REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    evidence_file_id uuid NOT NULL REFERENCES evidence_files (id) ON DELETE RESTRICT,
    -- The run that proposed it; null for a person's own.
    assessment_id uuid REFERENCES evidence_assessments (id) ON DELETE RESTRICT,
    kind text NOT NULL,
    -- A short name for the legend, written in code.
    label text NOT NULL,
    -- What the passage shows, as it stands now; and the agent's own sentence, kept ('' for
    -- a person's own).
    statement text NOT NULL,
    agent_statement text NOT NULL DEFAULT '',
    -- The file's exact words the annotation rests on ('' where a person's box covers none).
    quote text NOT NULL DEFAULT '',
    -- The approved attributes it bears on (control_attributes ids), checked where written.
    attribute_ids uuid[] NOT NULL DEFAULT '{}',
    page integer NOT NULL DEFAULT 1,
    -- [[x, y, w, h], ...], one box per line, as fractions of the page; [] with no position.
    rects jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The sentence of the comparison made in code that uses a fact read from the passage.
    check_sentence text NOT NULL DEFAULT '',
    origin text NOT NULL,
    status text NOT NULL,
    -- Where the passage starts in the file's stored text, for the reading order of a file
    -- with no positions; 0 for a person's own.
    position integer NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 1,
    created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_annotations_kind CHECK (
        kind IN ('SHOWS', 'IDENTIFIES', 'SOURCE', 'EXCEPTION')
    ),
    CONSTRAINT evidence_annotations_origin CHECK (origin IN ('AGENT', 'PERSON')),
    CONSTRAINT evidence_annotations_status CHECK (
        status IN ('PROPOSED', 'CONFIRMED', 'EDITED', 'REMOVED', 'SUPERSEDED')
    ),
    -- The agent's rest on a run and have no author; a person's have an author and no run,
    -- and are never proposed or superseded.
    CONSTRAINT evidence_annotations_author CHECK (
        (origin = 'AGENT') = (assessment_id IS NOT NULL)
        AND (origin = 'PERSON') = (created_by IS NOT NULL)
        AND (origin = 'AGENT' OR status NOT IN ('PROPOSED', 'SUPERSEDED'))
        AND (origin = 'AGENT' OR agent_statement = '')
    ),
    -- A person's decision names who made it and when; what no person decided names nobody.
    CONSTRAINT evidence_annotations_decided CHECK (
        (decided_by IS NULL) = (decided_at IS NULL)
        AND (status IN ('PROPOSED', 'SUPERSEDED')) = (decided_by IS NULL)
    ),
    CONSTRAINT evidence_annotations_text CHECK (
        char_length(btrim(label)) BETWEEN 1 AND 60
        AND char_length(btrim(statement)) BETWEEN 1 AND 400
        AND char_length(agent_statement) <= 400
        AND char_length(quote) <= 400
        AND char_length(check_sentence) <= 400
    ),
    CONSTRAINT evidence_annotations_attributes CHECK (cardinality(attribute_ids) <= 30),
    CONSTRAINT evidence_annotations_page CHECK (page BETWEEN 1 AND 10000),
    CONSTRAINT evidence_annotations_rects CHECK (
        jsonb_typeof(rects) = 'array' AND jsonb_array_length(rects) <= 8
        AND pg_column_size(rects) <= 4096
    ),
    CONSTRAINT evidence_annotations_position CHECK (position >= 0),
    CONSTRAINT evidence_annotations_version CHECK (version >= 1),
    CONSTRAINT evidence_annotations_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_annotations_control_fk
        FOREIGN KEY (engagement_control_id) REFERENCES engagement_controls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- The list of one file on one request, and what a run looks up when it proposes.
CREATE INDEX evidence_annotations_file_idx
    ON evidence_annotations (requirement_id, evidence_file_id, status);
CREATE INDEX evidence_annotations_control_idx
    ON evidence_annotations (engagement_control_id, created_at DESC);
CREATE INDEX evidence_annotations_evidence_idx ON evidence_annotations (evidence_file_id);
CREATE INDEX evidence_annotations_assessment_idx
    ON evidence_annotations (assessment_id) WHERE assessment_id IS NOT NULL;

CREATE TRIGGER evidence_annotations_touch
BEFORE UPDATE ON evidence_annotations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What a person reviewed is never changed by a run, and what was removed or superseded is
-- never changed at all.
CREATE FUNCTION guard_evidence_annotation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.status IN ('REMOVED', 'SUPERSEDED') THEN
        RAISE EXCEPTION 'a removed or superseded evidence annotation is never changed';
    END IF;
    IF NEW.status IN ('PROPOSED', 'SUPERSEDED') AND OLD.status <> 'PROPOSED' THEN
        RAISE EXCEPTION 'a reviewed evidence annotation is never superseded or proposed again';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.requirement_id IS DISTINCT FROM OLD.requirement_id
        OR NEW.evidence_file_id IS DISTINCT FROM OLD.evidence_file_id
        OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.origin IS DISTINCT FROM OLD.origin
        OR NEW.agent_statement IS DISTINCT FROM OLD.agent_statement
        OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'what an evidence annotation belongs to never changes';
    END IF;
    IF NEW.version < OLD.version THEN
        RAISE EXCEPTION 'an evidence annotation''s version never goes back';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_annotations_guard
BEFORE UPDATE ON evidence_annotations
FOR EACH ROW EXECUTE FUNCTION guard_evidence_annotation_update();

CREATE FUNCTION prevent_evidence_annotation_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'an evidence annotation is removed or superseded, never deleted';
END;
$$;

CREATE TRIGGER evidence_annotations_kept
BEFORE DELETE ON evidence_annotations
FOR EACH ROW EXECUTE FUNCTION prevent_evidence_annotation_deletion();

-- An archived engagement's annotations are read-only (migration 0136).
CREATE TRIGGER evidence_annotations_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_annotations
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
