-- Control Understanding ends with a review of the questions asked by an IT audit specialist,
-- before the attributes, and the hardening of B1j and B1k (docs/control-workflow-plan.md,
-- B1k and B1l; the product owner, 16 November 2026: "When I say it audit specialist, i meant
-- an agent that reviews all the questions asked. Its good to keep the review ... in a
-- narrarive format", and, to the hardening list, "Okay please proceed.").
--
-- 1. understanding_reviews: each read of the questions asked on a control by the specialist
--    (the independent-reviewer agent, prompt understanding-review/1). Written once, PENDING,
--    when the read is queued; ended once, READY (its narrative, the words it marks as not yet
--    established, the attributes it did not review, its verdicts, how many questions it asked
--    and how many it left as assumptions) or FAILED (one sentence). Never changed after,
--    never deleted, read-only once the engagement is archived. One PENDING per control.
--      round      1, the review; 2, the one follow-up read on the review's own answers;
--      cause      UNDERSTANDING (the rules queued it), RUN_AGAIN (a person, after a read
--                 that could not be used) or REVIEW_AGAIN (a person, after completion: its
--                 findings are assumptions, never questions);
--      inputs_sha256  the SHA-256 of what it was given, for the record.
--
-- 2. control_context_issues:
--      from_review, review_id, review_round   a question the specialist asked, in which read;
--      asks_code, asks_fact     what it asks: the attribute (its code, or its definition key
--                               for a control not tailored yet; null for a control with no
--                               attributes) and the kind of fact (PERFORMER, APPROVER, SYSTEM,
--                               RECORD, TIMING, POPULATION, EXCEPTION, OTHER);
--      asks_parent_id           for a follow-up of an earlier question, that question;
--      asks_parent_key          for a follow-up of a walkthrough answer, its question's key;
--      blocks                   the attribute criterion or evidence request that cannot be
--                               written without the fact, one sentence;
--      status NOT_KNOWN, with not_known_by, not_known_at, not_known_note: a person's "Not known
--                               yet, proceed": closed, never an answer.
--    A question on a key already asked on the control, in any status, can never be inserted
--    again: one per (control, attribute, fact), one follow-up per earlier question and one per
--    walkthrough answer. And the guarantee of B1l point 8: once a control's understanding is
--    completed, an OPEN question raised by an agent is refused (agent_question_once_completed).
--
-- 2b. understanding_not_known: a person's "Not known yet, proceed" on a required walkthrough
--    question or a client value of the statement (B1l point 1: every question in Control
--    Understanding offers it). Who, when and an optional note; never an answer and never a
--    fact: no agent reads it as one. It closes the question for the gates (the review is due,
--    the understanding may complete) while no answer is given. An answer or a value given
--    later supersedes it (superseded_at, set once: the only change it ever takes), and the
--    question may be left as not known again only after that. Never deleted; read-only once
--    archived. One standing per control and question.
--
-- 3. attribute_assumptions:
--      kind NOT_KNOWN           what a question a person left as not known bears on;
--      source_issue_id          that question (an agent's or the review's);
--      source_not_known_id      or that walkthrough question or value (section 2b);
--      asks_code, asks_fact     the key of a question the specialist did not ask (beyond the
--                               seven asked, or after its second read), so it is assumed once;
--      accepted_by, accepted_at who had accepted it with its attribute, kept when a person
--                               then confirms or changes it (the D&I workpaper's point), or
--                               when a NOT_KNOWN one is superseded by the answer given since.
--    One per matter (as before) for the agents' other assumptions, one per key, and one per
--    question left as not known. An assumption accepted with its attribute may still be
--    confirmed or changed, once; a NOT_KNOWN one ends SUPERSEDED once its question is
--    answered.
--
-- 3b. attribute_criteria_versions: an accepted attribute's criteria are kept as a version
--    also when only their acceptance ends (a person changed an assumption they rested on),
--    with who had accepted them; the current row keeps who wrote them and carries the cause.
--
-- 4. design_point_considerations: a point of kind ASSUMPTION (design-workpaper.md 3.9) may be
--    considered.
--
-- 5. evidence_plans.run_stage QUESTIONS: the plan run is reading the questions asked (the
--    specialist's review), before any attribute is drafted.
--
-- 6. Controls already past this stage are complete (B1l point 2; the product owner's
--    decision, 16 November 2026, after the review of B1k: completed by a backfill, not
--    lazily). Every control whose attributes are accepted (the rule of
--    control_context.attributes_accepted: approved attributes, none proposed, and every
--    approved one's criteria accepted by a person or written by one) gets
--    understanding_completed_at = the time of its last acceptance, with one audit record
--    each (control.understanding_completed, by ATTRIBUTES_ACCEPTED, backfilled). Archived
--    engagements are left as they are (read-only). A control with an OPEN conflict
--    assumption does not count as accepted (B1l point 6: a conflict holds acceptance). Once
--    set it is never cleared (0172's guard): a lapse of acceptance later never un-completes
--    it.
--
-- Additive except where a CHECK constraint, the assumptions' matter index and their guard
-- functions are replaced by wider ones, and the backfill of section 6 (which only sets a
-- null understanding_completed_at).
--
-- Rollback: DROP TRIGGER control_context_issues_once_completed ON control_context_issues;
-- DROP TRIGGER control_context_issues_review_kept ON control_context_issues; DROP TABLE
-- understanding_reviews (after dropping control_context_issues.review_id); DROP FUNCTION
-- refuse_agent_question_once_completed(), guard_context_issue_review(),
-- guard_understanding_review_insert(), guard_understanding_review_update(),
-- prevent_understanding_review_deletion(); ALTER TABLE control_context_issues DROP the columns
-- of section 2 and restore control_context_issues_status without NOT_KNOWN (after setting such
-- rows back to OPEN); DROP the indexes of sections 2 and 3, restore the 0172 matter index, the
-- 0172 kind CHECK and guard functions of attribute_assumptions and DROP its columns of section
-- 3 (rows of kind NOT_KNOWN must be removed first, which the 0172 guard refuses: a rollback
-- needs the guard dropped while it runs); restore design_point_considerations_kind and
-- evidence_plans_run_stage as 0169 and 0148 have them; DROP TABLE understanding_not_known
-- (after dropping attribute_assumptions.source_not_known_id) and its guard functions
-- guard_understanding_not_known_update() and prevent_understanding_not_known_deletion();
-- restore 0172's record_attribute_criteria_version() and its trigger's WHEN clause (section
-- 3b);
-- the backfill of section 6 is not undone (a completion is never cleared: 0172's guard), and
-- its audit records say which were backfilled (payload backfilled true); delete the
-- '0174_understanding_review' row from schema_migrations. A rollback loses the specialist's
-- reviews, which questions it asked and why, and every "not known yet".

-- 1. The specialist's reviews

CREATE TABLE understanding_reviews (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    round smallint NOT NULL,
    cause text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    narrative text NOT NULL DEFAULT '',
    marked jsonb NOT NULL DEFAULT '[]'::jsonb,
    not_reviewed jsonb NOT NULL DEFAULT '[]'::jsonb,
    verdicts jsonb NOT NULL DEFAULT '[]'::jsonb,
    asked integer NOT NULL DEFAULT 0,
    assumed integer NOT NULL DEFAULT 0,
    inputs_sha256 text NOT NULL DEFAULT '',
    model_call_id uuid,
    requested_by uuid,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    failure text NOT NULL DEFAULT '',
    CONSTRAINT understanding_reviews_round CHECK (round IN (1, 2)),
    CONSTRAINT understanding_reviews_cause CHECK (
        cause IN ('UNDERSTANDING', 'RUN_AGAIN', 'REVIEW_AGAIN')
    ),
    CONSTRAINT understanding_reviews_status CHECK (status IN ('PENDING', 'READY', 'FAILED')),
    CONSTRAINT understanding_reviews_text CHECK (
        char_length(narrative) <= 1500 AND char_length(failure) <= 300
    ),
    CONSTRAINT understanding_reviews_lists CHECK (
        jsonb_typeof(marked) = 'array' AND jsonb_array_length(marked) <= 12
        AND jsonb_typeof(not_reviewed) = 'array' AND jsonb_array_length(not_reviewed) <= 24
        AND jsonb_typeof(verdicts) = 'array' AND jsonb_array_length(verdicts) <= 24
    ),
    CONSTRAINT understanding_reviews_counts CHECK (asked BETWEEN 0 AND 24 AND assumed >= 0),
    CONSTRAINT understanding_reviews_inputs CHECK (inputs_sha256 ~ '^([0-9a-f]{64})?$'),
    -- What each status holds: nothing while PENDING; the review once READY; one sentence once
    -- FAILED, and nothing else.
    CONSTRAINT understanding_reviews_shape CHECK (
        CASE status
            WHEN 'PENDING' THEN finished_at IS NULL AND narrative = '' AND failure = ''
                AND marked = '[]'::jsonb AND not_reviewed = '[]'::jsonb
                AND verdicts = '[]'::jsonb AND asked = 0 AND assumed = 0
            WHEN 'READY' THEN finished_at IS NOT NULL AND failure = ''
                AND char_length(btrim(narrative)) >= 1
            ELSE finished_at IS NOT NULL AND char_length(btrim(failure)) >= 1
                AND narrative = '' AND marked = '[]'::jsonb AND asked = 0
        END
        AND (finished_at IS NULL OR finished_at >= requested_at)
    ),
    CONSTRAINT understanding_reviews_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT understanding_reviews_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT understanding_reviews_model_call_fk
        FOREIGN KEY (model_call_id) REFERENCES model_calls (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT understanding_reviews_requested_by_fk
        FOREIGN KEY (requested_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One read waits or works on a control at a time.
CREATE UNIQUE INDEX understanding_reviews_one_pending
    ON understanding_reviews (engagement_control_id) WHERE status = 'PENDING';
-- A control's reviews, newest first.
CREATE INDEX understanding_reviews_control_idx
    ON understanding_reviews (project_id, engagement_control_id, requested_at DESC);

-- Written PENDING, with nothing finished.
CREATE FUNCTION guard_understanding_review_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'PENDING' OR NEW.finished_at IS NOT NULL
        OR NEW.model_call_id IS NOT NULL
    THEN
        RAISE EXCEPTION 'a review of the questions asked is recorded waiting, before it reads';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER understanding_reviews_recorded
BEFORE INSERT ON understanding_reviews
FOR EACH ROW EXECUTE FUNCTION guard_understanding_review_insert();

-- What a review was asked for never changes; it ends once (READY or FAILED), and an ended
-- review is never changed.
CREATE FUNCTION guard_understanding_review_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'an ended review of the questions asked is never changed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.round IS DISTINCT FROM OLD.round
        OR NEW.cause IS DISTINCT FROM OLD.cause
        OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
        OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    THEN
        RAISE EXCEPTION 'what a review of the questions asked was asked for never changes';
    END IF;
    IF NEW.status = 'PENDING' THEN
        RAISE EXCEPTION 'a review of the questions asked changes only by ending, once';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER understanding_reviews_guard
BEFORE UPDATE ON understanding_reviews
FOR EACH ROW EXECUTE FUNCTION guard_understanding_review_update();

CREATE FUNCTION prevent_understanding_review_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a review of the questions asked is kept, never deleted';
END;
$$;

CREATE TRIGGER understanding_reviews_kept
BEFORE DELETE ON understanding_reviews
FOR EACH ROW EXECUTE FUNCTION prevent_understanding_review_deletion();

-- An archived engagement's reviews are read-only (migration 0136). This trigger fires before
-- the guards above (triggers of one event fire in name order), so a write there is refused
-- as archived.
CREATE TRIGGER understanding_reviews_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON understanding_reviews
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

-- 2. The specialist's questions, "Not known yet", and asked once by key

ALTER TABLE control_context_issues
    ADD COLUMN from_review boolean NOT NULL DEFAULT false,
    ADD COLUMN review_id uuid REFERENCES understanding_reviews (id) ON DELETE RESTRICT,
    ADD COLUMN review_round smallint,
    ADD COLUMN asks_code text,
    ADD COLUMN asks_fact text,
    ADD COLUMN asks_parent_id uuid REFERENCES control_context_issues (id) ON DELETE RESTRICT,
    ADD COLUMN asks_parent_key text NOT NULL DEFAULT '',
    ADD COLUMN blocks text NOT NULL DEFAULT '',
    ADD COLUMN not_known_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN not_known_at timestamptz,
    ADD COLUMN not_known_note text NOT NULL DEFAULT '',
    DROP CONSTRAINT control_context_issues_status,
    ADD CONSTRAINT control_context_issues_status CHECK (
        status IN ('OPEN', 'RESOLVED', 'DISMISSED', 'SUPERSEDED', 'NOT_KNOWN')
    ),
    ADD CONSTRAINT control_context_issues_from_review CHECK (
        (from_review = (review_id IS NOT NULL))
        AND (from_review = (review_round IS NOT NULL))
        AND (review_round IS NULL OR review_round IN (1, 2))
        AND (NOT from_review OR raised_by = 'AGENT')
    ),
    ADD CONSTRAINT control_context_issues_asks CHECK (
        (asks_fact IS NULL OR asks_fact IN (
            'PERFORMER', 'APPROVER', 'SYSTEM', 'RECORD', 'TIMING', 'POPULATION', 'EXCEPTION',
            'OTHER'))
        AND (asks_code IS NULL OR char_length(asks_code) BETWEEN 1 AND 80)
        AND char_length(asks_parent_key) <= 80
        AND char_length(blocks) <= 300
        AND (asks_parent_id IS NULL OR asks_parent_key = '')
    ),
    -- Not known yet: a person, when, and a note of at most 500 characters, for NOT_KNOWN only.
    ADD CONSTRAINT control_context_issues_not_known CHECK (
        (status = 'NOT_KNOWN') = (not_known_at IS NOT NULL)
        AND (not_known_at IS NULL) = (not_known_by IS NULL)
        AND char_length(not_known_note) <= 500
        AND (status = 'NOT_KNOWN' OR not_known_note = '')
    );

-- Asked once, by key, in any status: one question per (control, attribute, kind of fact);
-- one follow-up per earlier question; one follow-up per walkthrough answer.
CREATE UNIQUE INDEX control_context_issues_asked_key
    ON control_context_issues (engagement_control_id, coalesce(asks_code, ''), asks_fact)
    WHERE asks_fact IS NOT NULL AND asks_parent_id IS NULL AND asks_parent_key = '';
CREATE UNIQUE INDEX control_context_issues_one_follow_up
    ON control_context_issues (asks_parent_id) WHERE asks_parent_id IS NOT NULL;
CREATE UNIQUE INDEX control_context_issues_one_follow_up_of_answer
    ON control_context_issues (engagement_control_id, asks_parent_key)
    WHERE asks_parent_key <> '';
-- A review's questions.
CREATE INDEX control_context_issues_review_idx
    ON control_context_issues (review_id) WHERE review_id IS NOT NULL;

-- What a question asks, and who left it as not known, never change once written; a question
-- left as not known stays so.
CREATE FUNCTION guard_context_issue_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.from_review IS DISTINCT FROM OLD.from_review
        OR NEW.review_id IS DISTINCT FROM OLD.review_id
        OR NEW.review_round IS DISTINCT FROM OLD.review_round
        OR NEW.asks_code IS DISTINCT FROM OLD.asks_code
        OR NEW.asks_fact IS DISTINCT FROM OLD.asks_fact
        OR NEW.asks_parent_id IS DISTINCT FROM OLD.asks_parent_id
        OR NEW.asks_parent_key IS DISTINCT FROM OLD.asks_parent_key
        OR NEW.blocks IS DISTINCT FROM OLD.blocks
    THEN
        RAISE EXCEPTION 'what a question asks never changes';
    END IF;
    IF OLD.status = 'NOT_KNOWN' AND (
        NEW.status IS DISTINCT FROM OLD.status
        OR NEW.not_known_by IS DISTINCT FROM OLD.not_known_by
        OR NEW.not_known_at IS DISTINCT FROM OLD.not_known_at
        OR NEW.not_known_note IS DISTINCT FROM OLD.not_known_note)
    THEN
        RAISE EXCEPTION 'a question left as not known stays so';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER control_context_issues_review_kept
BEFORE UPDATE ON control_context_issues
FOR EACH ROW EXECUTE FUNCTION guard_context_issue_review();

-- The guarantee is in the database (B1l point 8): once a control's understanding is
-- completed, no agent asks on it. An agent's question written OPEN, or put back to OPEN, is
-- refused; the rules' questions ("Changed after testing", a frequency conflict) are not.
CREATE FUNCTION refuse_agent_question_once_completed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.raised_by = 'AGENT' AND NEW.status = 'OPEN'
        AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'OPEN')
        AND EXISTS (
            SELECT 1 FROM public.engagement_controls c
            WHERE c.id = NEW.engagement_control_id
              AND c.understanding_completed_at IS NOT NULL)
    THEN
        RAISE EXCEPTION 'the control''s understanding is completed: no agent asks on it';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER control_context_issues_once_completed
BEFORE INSERT OR UPDATE OF status ON control_context_issues
FOR EACH ROW EXECUTE FUNCTION refuse_agent_question_once_completed();

-- 2b. Not known yet, on a walkthrough question or a value of the statement

CREATE TABLE understanding_not_known (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    subject text NOT NULL,
    subject_key text NOT NULL,
    noted_by uuid NOT NULL,
    noted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    note text NOT NULL DEFAULT '',
    -- When an answer or a value given later superseded it; null while it stands.
    superseded_at timestamptz,
    CONSTRAINT understanding_not_known_subject CHECK (subject IN ('WALKTHROUGH', 'VALUE')),
    -- A walkthrough question's key (migration 0147) or a statement slot's (migration 0064).
    CONSTRAINT understanding_not_known_key CHECK (
        (subject = 'WALKTHROUGH' AND subject_key ~ '^wt-[a-z0-9-]{2,60}$')
        OR (subject = 'VALUE' AND subject_key ~ '^[a-z][a-z0-9-]{1,40}$')
    ),
    CONSTRAINT understanding_not_known_note CHECK (char_length(note) <= 500),
    CONSTRAINT understanding_not_known_superseded CHECK (
        superseded_at IS NULL OR superseded_at >= noted_at
    ),
    CONSTRAINT understanding_not_known_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT understanding_not_known_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT understanding_not_known_by_fk
        FOREIGN KEY (noted_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One standing per control and question; a superseded one stays beside it.
CREATE UNIQUE INDEX understanding_not_known_once
    ON understanding_not_known (engagement_control_id, subject, subject_key)
    WHERE superseded_at IS NULL;
CREATE INDEX understanding_not_known_project_idx
    ON understanding_not_known (project_id, engagement_control_id);

-- Kept as written: the only change is its superseding, once, by an answer given since.
CREATE FUNCTION guard_understanding_not_known_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
        OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.subject IS DISTINCT FROM OLD.subject
        OR NEW.subject_key IS DISTINCT FROM OLD.subject_key
        OR NEW.noted_by IS DISTINCT FROM OLD.noted_by
        OR NEW.noted_at IS DISTINCT FROM OLD.noted_at
        OR NEW.note IS DISTINCT FROM OLD.note
    THEN
        RAISE EXCEPTION 'a person''s not known yet is kept as written';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER understanding_not_known_guard
BEFORE UPDATE ON understanding_not_known
FOR EACH ROW EXECUTE FUNCTION guard_understanding_not_known_update();

CREATE FUNCTION prevent_understanding_not_known_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a person''s not known yet is kept, never deleted';
END;
$$;

CREATE TRIGGER understanding_not_known_kept
BEFORE DELETE ON understanding_not_known
FOR EACH ROW EXECUTE FUNCTION prevent_understanding_not_known_deletion();

CREATE TRIGGER understanding_not_known_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON understanding_not_known
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

-- 3. Assumptions: not known yet, by key, and settled after acceptance

ALTER TABLE attribute_assumptions
    ADD COLUMN source_issue_id uuid REFERENCES control_context_issues (id) ON DELETE RESTRICT,
    ADD COLUMN source_not_known_id uuid
        REFERENCES understanding_not_known (id) ON DELETE RESTRICT,
    ADD COLUMN asks_code text,
    ADD COLUMN asks_fact text,
    ADD COLUMN accepted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN accepted_at timestamptz,
    DROP CONSTRAINT attribute_assumptions_kind,
    ADD CONSTRAINT attribute_assumptions_kind CHECK (
        kind IN ('MISSING', 'AMBIGUOUS', 'CONFLICT', 'NOT_KNOWN')
    ),
    ADD CONSTRAINT attribute_assumptions_asks CHECK (
        (asks_fact IS NULL OR asks_fact IN (
            'PERFORMER', 'APPROVER', 'SYSTEM', 'RECORD', 'TIMING', 'POPULATION', 'EXCEPTION',
            'OTHER'))
        AND (asks_code IS NULL OR char_length(asks_code) BETWEEN 1 AND 80)
        -- A not known yet comes from one question: an issue, or a walkthrough question or
        -- value (section 2b); nothing else is of that kind.
        AND ((kind = 'NOT_KNOWN')
             = (source_issue_id IS NOT NULL OR source_not_known_id IS NOT NULL))
        AND (source_issue_id IS NULL OR source_not_known_id IS NULL)
    ),
    -- Who had accepted it with its attribute, once a person confirmed or changed it since.
    ADD CONSTRAINT attribute_assumptions_accepted CHECK (
        (accepted_at IS NULL) = (accepted_by IS NULL)
        AND (accepted_at IS NULL OR status IN ('CONFIRMED', 'CHANGED')
             OR (status = 'SUPERSEDED' AND kind = 'NOT_KNOWN'))
    );

-- In place of 0172's one per matter: one per matter for the agents' other assumptions, one
-- per key (the attribute and the kind of fact) for a question the specialist did not ask, and
-- one per question left as not known.
DROP INDEX attribute_assumptions_matter_once;
CREATE UNIQUE INDEX attribute_assumptions_matter_once
    ON attribute_assumptions (
        engagement_control_id, (btrim(regexp_replace(lower(matter), '[^a-z0-9]+', ' ', 'g')))
    )
    WHERE source_issue_id IS NULL AND source_not_known_id IS NULL AND asks_fact IS NULL;
CREATE UNIQUE INDEX attribute_assumptions_key_once
    ON attribute_assumptions (engagement_control_id, coalesce(asks_code, ''), asks_fact)
    WHERE asks_fact IS NOT NULL AND source_issue_id IS NULL AND source_not_known_id IS NULL;
CREATE UNIQUE INDEX attribute_assumptions_not_known_once
    ON attribute_assumptions (source_issue_id) WHERE source_issue_id IS NOT NULL;
CREATE UNIQUE INDEX attribute_assumptions_not_known_answer_once
    ON attribute_assumptions (source_not_known_id) WHERE source_not_known_id IS NOT NULL;

-- Written OPEN, with nothing decided or accepted, at version 1.
CREATE OR REPLACE FUNCTION guard_attribute_assumption_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'OPEN' OR NEW.version IS DISTINCT FROM 1
        OR NEW.decided_at IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.answer <> ''
        OR NEW.accepted_at IS NOT NULL OR NEW.accepted_by IS NOT NULL
    THEN
        RAISE EXCEPTION 'an assumption is recorded open, before anyone decides it';
    END IF;
    RETURN NEW;
END;
$$;

-- What an assumption records never changes; it is decided once (its version moved by one).
-- One accepted with its attribute is still settled once more, by a person confirming or
-- changing it (the D&I workpaper's point, design-workpaper.md 3.9), or, for a NOT_KNOWN one,
-- by the answer to its question given since (SUPERSEDED, by no person): who had accepted it,
-- and when, are kept beside the new decision. Any other decided one is never changed.
CREATE OR REPLACE FUNCTION guard_attribute_assumption_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.status = 'ACCEPTED_WITH_ATTRIBUTE' THEN
        IF NOT (NEW.status IN ('CONFIRMED', 'CHANGED')
                OR (NEW.status = 'SUPERSEDED' AND OLD.kind = 'NOT_KNOWN'))
            OR NEW.accepted_by IS DISTINCT FROM OLD.decided_by
            OR NEW.accepted_at IS DISTINCT FROM OLD.decided_at
        THEN
            RAISE EXCEPTION
                'an assumption accepted with its attribute is settled only by confirming or changing it';
        END IF;
    ELSIF OLD.status IS DISTINCT FROM 'OPEN' THEN
        RAISE EXCEPTION 'a decided assumption is never changed';
    ELSIF NEW.accepted_at IS NOT NULL OR NEW.accepted_by IS NOT NULL THEN
        RAISE EXCEPTION 'an assumption is accepted with its attribute by its decision only';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.matter IS DISTINCT FROM OLD.matter
        OR NEW.assumed IS DISTINCT FROM OLD.assumed
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.attribute_codes IS DISTINCT FROM OLD.attribute_codes
        OR NEW.raised_by_agent IS DISTINCT FROM OLD.raised_by_agent
        OR NEW.model_call_id IS DISTINCT FROM OLD.model_call_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.source_issue_id IS DISTINCT FROM OLD.source_issue_id
        OR NEW.source_not_known_id IS DISTINCT FROM OLD.source_not_known_id
        OR NEW.asks_code IS DISTINCT FROM OLD.asks_code
        OR NEW.asks_fact IS DISTINCT FROM OLD.asks_fact
    THEN
        RAISE EXCEPTION 'what an assumption records never changes';
    END IF;
    IF NEW.status = 'OPEN' OR NEW.version IS DISTINCT FROM OLD.version + 1 THEN
        RAISE EXCEPTION 'an assumption changes only by being decided, once';
    END IF;
    RETURN NEW;
END;
$$;

-- 3b. An accepted attribute's criteria are kept when only their acceptance ends

-- As 0172's, and also when only the acceptance ends (a person changed an assumption the
-- accepted criteria rested on; attribute_assumptions.change): the accepted criteria are kept
-- as a version with who had accepted them. Nobody wrote new words then, so the current row
-- keeps who wrote them and when, and takes only the cause ("Reopened: <matter>").
CREATE OR REPLACE FUNCTION record_attribute_criteria_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    named text := coalesce(current_setting('app.criteria_only', true), '');
    person text := coalesce(current_setting('app.criteria_by', true), '');
    cause text := coalesce(current_setting('app.criteria_cause', true), '');
    had boolean;
    rewritten boolean;
BEGIN
    rewritten := (OLD.condition, OLD.pass_criteria, OLD.fail_criteria, OLD.judgment_required,
                  OLD.criteria_origin)
        IS DISTINCT FROM
        (NEW.condition, NEW.pass_criteria, NEW.fail_criteria, NEW.judgment_required,
         NEW.criteria_origin);
    IF named <> '' AND NOT (coalesce(OLD.code, '') = ANY (string_to_array(named, ','))) THEN
        RAISE EXCEPTION 'this update may change only the criteria of the attributes it names';
    END IF;
    had := OLD.condition <> '' OR OLD.pass_criteria <> '' OR OLD.fail_criteria <> ''
        OR OLD.judgment_required IS TRUE;
    IF had THEN
        INSERT INTO public.attribute_criteria_versions (
            organization_id, project_id, engagement_control_id, attribute_id, version,
            condition, pass_criteria, fail_criteria, judgment_required, criteria_origin,
            accepted_by, accepted_at, written_at, written_by, writer, cause
        )
        VALUES (
            OLD.organization_id, OLD.project_id, OLD.engagement_control_id, OLD.id,
            (SELECT coalesce(max(v.version), 0) + 1 FROM public.attribute_criteria_versions v
             WHERE v.attribute_id = OLD.id),
            OLD.condition, OLD.pass_criteria, OLD.fail_criteria, OLD.judgment_required,
            OLD.criteria_origin, OLD.criteria_accepted_by, OLD.criteria_accepted_at,
            coalesce(OLD.criteria_written_at, OLD.updated_at), OLD.criteria_written_by,
            OLD.criteria_writer, OLD.criteria_cause
        );
    END IF;
    IF NOT rewritten THEN
        NEW.criteria_cause := CASE WHEN cause <> '' THEN left(cause, 300)
                                   ELSE OLD.criteria_cause END;
        RETURN NEW;
    END IF;
    NEW.criteria_written_at := clock_timestamp();
    NEW.criteria_written_by := CASE
        WHEN person ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN person::uuid
    END;
    NEW.criteria_writer := left(coalesce(current_setting('app.criteria_writer', true), ''), 60);
    NEW.criteria_cause := left(cause, 300);
    RETURN NEW;
END;
$$;

DROP TRIGGER control_attributes_criteria_versions ON control_attributes;
CREATE TRIGGER control_attributes_criteria_versions
BEFORE UPDATE ON control_attributes
FOR EACH ROW
WHEN (
    (OLD.condition, OLD.pass_criteria, OLD.fail_criteria, OLD.judgment_required,
     OLD.criteria_origin)
    IS DISTINCT FROM
    (NEW.condition, NEW.pass_criteria, NEW.fail_criteria, NEW.judgment_required,
     NEW.criteria_origin)
    -- Only the acceptance ended, by itself (not by a change of the objective or of what is
    -- automatable, which clears it too: migration 0122).
    OR (OLD.criteria_accepted_at IS NOT NULL AND NEW.criteria_accepted_at IS NULL
        AND (OLD.objective, OLD.automatable) IS NOT DISTINCT FROM (NEW.objective, NEW.automatable))
)
EXECUTE FUNCTION record_attribute_criteria_version();

-- 4. An assumption accepted with its attribute is a point of the D&I workpaper

ALTER TABLE design_point_considerations
    DROP CONSTRAINT design_point_considerations_kind,
    ADD CONSTRAINT design_point_considerations_kind CHECK (
        point_kind IN (
            'STALE', 'FINDING', 'NOT_CONCLUDED', 'NOT_RELIED', 'CONFLICT', 'HELD',
            'COMPLETENESS', 'FOLLOW_UP', 'ASSUMPTION'
        )
    );

-- 5. The plan run reading the questions asked

ALTER TABLE evidence_plans
    DROP CONSTRAINT evidence_plans_run_stage,
    ADD CONSTRAINT evidence_plans_run_stage CHECK (
        run_stage IN ('', 'ATTRIBUTES', 'CRITERIA', 'REVIEW', 'QUESTIONS')
    );

-- 6. Controls already past this stage are complete (B1l point 2)

WITH accepted AS (
    SELECT c.id, c.organization_id, c.project_id,
           (SELECT coalesce(max(a.criteria_accepted_at), max(a.decided_at), max(a.updated_at))
            FROM control_attributes a
            WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED') AS at
    FROM engagement_controls c
    JOIN projects j ON j.id = c.project_id
    WHERE c.understanding_completed_at IS NULL
      AND j.status <> 'ARCHIVED'
      AND EXISTS (SELECT 1 FROM control_attributes a
                  WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED')
      AND NOT EXISTS (SELECT 1 FROM control_attributes a
                      WHERE a.engagement_control_id = c.id AND a.status = 'PROPOSED')
      AND NOT EXISTS (SELECT 1 FROM control_attributes a
                      WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED'
                        AND a.criteria_accepted_at IS NULL
                        AND a.criteria_origin IS DISTINCT FROM 'PERSON')
      AND NOT EXISTS (SELECT 1 FROM attribute_assumptions s
                      WHERE s.engagement_control_id = c.id AND s.status = 'OPEN'
                        AND s.kind = 'CONFLICT')
),
completed AS (
    UPDATE engagement_controls c
    SET understanding_completed_at = coalesce(accepted.at, clock_timestamp())
    FROM accepted
    WHERE c.id = accepted.id
    RETURNING c.id, c.organization_id, c.project_id
)
INSERT INTO audit_events (
    organization_id, project_id, actor_user_id, action, target_type, target_id, payload
)
SELECT organization_id, project_id, NULL, 'control.understanding_completed',
       'engagement_control', id, '{"by": "ATTRIBUTES_ACCEPTED", "backfilled": true}'::jsonb
FROM completed;
