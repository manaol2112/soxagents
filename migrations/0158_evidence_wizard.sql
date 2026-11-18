-- The D&I evidence wizard (docs/evidence-wizard.md; asked for and decided by the product
-- owner on 13 November 2026).
--
-- Several files dropped on a control's D&I list are read and sorted into the control's
-- D&I items. Code decides each placement from the reader's proposal: a file is filed on
-- the item it fits when the reader is sure, waits for a person when it is not, and is
-- kept in the control's files when it covers no item. A person can move any file.
--
-- evidence_batches: one row per wizard session (its id is the uploads' batch id),
--   recorded in the transaction of the session's first upload (never before it): the
--   firm, the engagement, the control whose D&I items the files are sorted into, the
--   phase (DESIGN), the item chosen when the wizard was opened from a row, who and when.
--   A batch keeps its control and its item: it is never deleted, and only when it last
--   landed changes (landed_at: when its readings had all ended and its placements'
--   receipts and checks were applied, so the start-up backstop finds a batch that ended
--   without landing).
--
-- evidence_batch_duplicates: a file the engagement held already, dropped again in a later
--   session of the same control. It is listed in that session too, with the placement it
--   has; nothing is stored twice. Never changed or deleted.
--
-- evidence_placements: where each file was placed, append-only. One row per decision: the
--   file, the session it was decided in (the file's own, or one it was dropped in again),
--   the item it is filed on (requirement_id, or none) and every item it is placed on
--   (requirement_ids: more than one for a file that covers several items in full), the
--   status (PLACED, NEEDS_PERSON, NOT_DESIGN), who decided (AGENT or PERSON, with the
--   person), the reader's confidence, the reason, the ranked suggestions, the reading it
--   rests on, and when. A move is a new row that supersedes the earlier one
--   (supersedes_id, the next version of the file's placement); a row is never changed or
--   deleted, so every earlier placement is kept.
--
-- evidence_analyses gains when the reading started and ended (started_at, finished_at),
-- so the wizard shows each file's reading as it happens from the server's records.
--
-- Rollback: DROP TABLE evidence_placements; DROP TABLE evidence_batch_duplicates; DROP
-- TABLE evidence_batches; DROP FUNCTION check_evidence_placement(),
-- keep_evidence_placement(), check_evidence_batch(), keep_evidence_batch(),
-- check_evidence_batch_duplicate(), keep_evidence_batch_duplicate(); ALTER TABLE
-- evidence_analyses DROP COLUMN started_at, DROP COLUMN finished_at; delete the
-- '0158_evidence_wizard' row from schema_migrations. Before any wizard upload only: a
-- wizard file's placement on an item is otherwise recorded nowhere else.

CREATE TABLE evidence_batches (
    -- The batch id the session's uploads carry (evidence_files.upload_batch_id).
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    phase text NOT NULL DEFAULT 'DESIGN',
    -- The item chosen when the wizard was opened from a row: its files go to that item.
    requirement_id uuid REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- When the batch last landed: its readings had all ended, and its placements'
    -- receipts and checks were applied. Null until it first lands.
    landed_at timestamptz,
    CONSTRAINT evidence_batches_phase CHECK (phase = 'DESIGN'),
    CONSTRAINT evidence_batches_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_batches_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_batches_control_idx
    ON evidence_batches (engagement_control_id, created_at DESC);

-- A batch's item is a D&I requirement of its control.
CREATE FUNCTION check_evidence_batch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.requirement_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.evidence_requirements q
        WHERE q.id = NEW.requirement_id AND q.engagement_control_id = NEW.engagement_control_id
          AND q.project_id = NEW.project_id AND q.phase = 'DESIGN'
    ) THEN
        RAISE EXCEPTION 'a batch''s item is a D&I requirement of its control'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_batches_checked
BEFORE INSERT ON evidence_batches
FOR EACH ROW EXECUTE FUNCTION check_evidence_batch();

-- A batch keeps its control and its item: it is never deleted, and only the time it last
-- landed changes, never backwards.
CREATE FUNCTION keep_evidence_batch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'an evidence batch is never deleted';
    END IF;
    IF (to_jsonb(NEW) - 'landed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'landed_at')
       OR NEW.landed_at IS NULL
       OR (OLD.landed_at IS NOT NULL AND NEW.landed_at < OLD.landed_at) THEN
        RAISE EXCEPTION 'an evidence batch only records when it last landed';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_batches_kept
BEFORE UPDATE OR DELETE ON evidence_batches
FOR EACH ROW EXECUTE FUNCTION keep_evidence_batch();

-- An archived engagement's batches are read-only (migration 0136).
CREATE TRIGGER evidence_batches_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_batches
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

CREATE TABLE evidence_batch_duplicates (
    batch_id uuid NOT NULL REFERENCES evidence_batches (id) ON DELETE RESTRICT,
    evidence_file_id uuid NOT NULL REFERENCES evidence_files (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    added_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_batch_duplicates_key PRIMARY KEY (batch_id, evidence_file_id),
    CONSTRAINT evidence_batch_duplicates_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_batch_duplicates_file_idx
    ON evidence_batch_duplicates (evidence_file_id);

-- A duplicate is a file of the batch's engagement uploaded in another session.
CREATE FUNCTION check_evidence_batch_duplicate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.evidence_files f
        JOIN public.evidence_batches b ON b.id = NEW.batch_id
        WHERE f.id = NEW.evidence_file_id AND f.project_id = b.project_id
          AND b.project_id = NEW.project_id
          AND f.upload_batch_id IS DISTINCT FROM b.id
    ) THEN
        RAISE EXCEPTION 'a duplicate is a file of the engagement from another session'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_batch_duplicates_checked
BEFORE INSERT ON evidence_batch_duplicates
FOR EACH ROW EXECUTE FUNCTION check_evidence_batch_duplicate();

CREATE FUNCTION keep_evidence_batch_duplicate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a file dropped again in a session is never changed or deleted';
END;
$$;

CREATE TRIGGER evidence_batch_duplicates_kept
BEFORE UPDATE OR DELETE ON evidence_batch_duplicates
FOR EACH ROW EXECUTE FUNCTION keep_evidence_batch_duplicate();

-- An archived engagement's records are read-only (migration 0136).
CREATE TRIGGER evidence_batch_duplicates_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_batch_duplicates
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

CREATE TABLE evidence_placements (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    -- The session the decision was made in: the file's own, or one it was dropped in again.
    batch_id uuid NOT NULL REFERENCES evidence_batches (id) ON DELETE RESTRICT,
    evidence_file_id uuid NOT NULL REFERENCES evidence_files (id) ON DELETE RESTRICT,
    -- The file's placement history: version 1 first, each later one superseding the one
    -- before it. The current placement is the file's latest version.
    version integer NOT NULL,
    supersedes_id uuid REFERENCES evidence_placements (id) ON DELETE RESTRICT,
    status text NOT NULL,
    method text NOT NULL,
    -- The item the file is filed on first (its request's filing, or its link), and every
    -- item it is placed on, that one first. None unless PLACED.
    requirement_id uuid REFERENCES evidence_requirements (id) ON DELETE RESTRICT,
    requirement_ids uuid[] NOT NULL DEFAULT '{}',
    -- The reader's confidence in what the file is (high, medium, low), once it was read.
    confidence text,
    reason text NOT NULL,
    -- The items a person should consider, ranked: [{requirement_id, title, reason}].
    suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The reading the placement rests on (none for a file placed when it was added).
    analysis_id uuid REFERENCES evidence_analyses (id) ON DELETE RESTRICT,
    -- A person's placement names them; the agent's names no one.
    decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_placements_version CHECK (
        version >= 1 AND (version = 1) = (supersedes_id IS NULL)
    ),
    CONSTRAINT evidence_placements_status CHECK (
        status IN ('PLACED', 'NEEDS_PERSON', 'NOT_DESIGN')
    ),
    CONSTRAINT evidence_placements_method CHECK (method IN ('AGENT', 'PERSON')),
    CONSTRAINT evidence_placements_decided CHECK ((method = 'PERSON') = (decided_by IS NOT NULL)),
    CONSTRAINT evidence_placements_items CHECK (
        (status = 'PLACED') = (requirement_id IS NOT NULL)
        AND (status = 'PLACED') = (cardinality(requirement_ids) >= 1)
        AND (requirement_id IS NULL OR requirement_ids[1] = requirement_id)
        AND cardinality(requirement_ids) <= 14
    ),
    CONSTRAINT evidence_placements_confidence CHECK (
        confidence IS NULL OR confidence IN ('high', 'medium', 'low')
    ),
    CONSTRAINT evidence_placements_text CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
    CONSTRAINT evidence_placements_suggestions CHECK (
        jsonb_typeof(suggestions) = 'array' AND jsonb_array_length(suggestions) <= 14
        AND pg_column_size(suggestions) <= 16384
    ),
    CONSTRAINT evidence_placements_file_version UNIQUE (evidence_file_id, version),
    -- A placement is superseded once: the file's history is one line.
    CONSTRAINT evidence_placements_supersedes_once UNIQUE (supersedes_id),
    CONSTRAINT evidence_placements_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT evidence_placements_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_placements_batch_idx
    ON evidence_placements (batch_id, evidence_file_id, version DESC);
CREATE INDEX evidence_placements_control_idx
    ON evidence_placements (engagement_control_id, created_at DESC);

-- What a placement names is checked where it is written: a file of the session it was
-- decided in (its own, or one it was dropped in again), whose control it is; D&I items of
-- that control, each once; and, for a later version, the file's version before it.
CREATE FUNCTION check_evidence_placement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    earlier_file uuid;
    earlier_version integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.evidence_files f
        JOIN public.evidence_batches b ON b.id = NEW.batch_id
        WHERE f.id = NEW.evidence_file_id AND b.project_id = NEW.project_id
          AND b.engagement_control_id = NEW.engagement_control_id
          AND (f.upload_batch_id = b.id OR EXISTS (
              SELECT 1 FROM public.evidence_batch_duplicates d
              WHERE d.batch_id = b.id AND d.evidence_file_id = f.id
          ))
    ) THEN
        RAISE EXCEPTION 'a placement names a file of its session and control'
            USING ERRCODE = 'check_violation';
    END IF;
    IF cardinality(NEW.requirement_ids) <> (
        SELECT count(DISTINCT item) FROM unnest(NEW.requirement_ids) AS item
    ) OR EXISTS (
        SELECT 1 FROM unnest(NEW.requirement_ids) AS item
        WHERE NOT EXISTS (
            SELECT 1 FROM public.evidence_requirements q
            WHERE q.id = item AND q.engagement_control_id = NEW.engagement_control_id
              AND q.phase = 'DESIGN'
        )
    ) THEN
        RAISE EXCEPTION 'a placement names D&I items of its control, each once'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.supersedes_id IS NOT NULL THEN
        SELECT evidence_file_id, version INTO earlier_file, earlier_version
        FROM public.evidence_placements WHERE id = NEW.supersedes_id;
        IF earlier_file IS DISTINCT FROM NEW.evidence_file_id
           OR earlier_version IS DISTINCT FROM NEW.version - 1 THEN
            RAISE EXCEPTION 'a placement supersedes the file''s version before it'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_placements_checked
BEFORE INSERT ON evidence_placements
FOR EACH ROW EXECUTE FUNCTION check_evidence_placement();

-- Append-only: a placement is superseded by a later one, never changed or deleted.
CREATE FUNCTION keep_evidence_placement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'an evidence placement is superseded, never changed or deleted';
END;
$$;

CREATE TRIGGER evidence_placements_kept
BEFORE UPDATE OR DELETE ON evidence_placements
FOR EACH ROW EXECUTE FUNCTION keep_evidence_placement();

-- An archived engagement's placements are read-only (migration 0136).
CREATE TRIGGER evidence_placements_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON evidence_placements
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

-- When the file's current reading started and ended.
ALTER TABLE evidence_analyses
    ADD COLUMN started_at timestamptz,
    ADD COLUMN finished_at timestamptz;
