-- The preparer concludes; the agent proposes (docs/design-workpaper.md, section 3.6; decided
-- by the product owner on 15 November 2026: "Agent should propose but user should finalize
-- the conclusion").
--
-- Until now the records proposed the D&I verdict and the reviewer signed exactly it. Now the
-- records and the agent propose, the preparer chooses one of five conclusions on the draft
-- design workpaper, and the reviewer signs the preparer's choice.
--
-- design_conclusion_choices keeps one row per conclusion a preparer records for a control:
--
--   kind           EFFECTIVE, EXCEPTIONS_NOTED, NOT_EFFECTIVE, NO_INSTANCE or NOT_CONCLUDED;
--   basis          DESIGN, IMPLEMENTATION or BOTH, for NOT_EFFECTIVE only (always given);
--   reason         the person's own, 10 to 1,000 characters: always for EXCEPTIONS_NOTED,
--                  NOT_EFFECTIVE and NO_INSTANCE, and for EFFECTIVE or NOT_CONCLUDED where
--                  it differs from the proposal; '' where none is needed and none was given;
--   proposed_kind  the proposal when it was recorded;
--   workpaper_*    the design workpaper and its current version then;
--   ended_*        a choice is never deleted and never rewritten. It ends once, as REPLACED
--                  (the preparer recorded the next one).
--
-- One choice stands (ended_at IS NULL) per control.
--
-- design_conclusions gains what the reviewer signed: conclusion (the kind), its basis and
-- reason, and the choice it was. verdict stays the two values every reader uses (the OE
-- gate, the phase progress, the journey): NOT_EFFECTIVE for NOT_EFFECTIVE, EFFECTIVE for
-- EFFECTIVE, EXCEPTIONS_NOTED and NO_INSTANCE. NOT_CONCLUDED is never signed.
--
-- Additive: one table, its two guard functions and the archived guard; four columns on
-- design_conclusions. One backfill: every existing sign-off is given conclusion = verdict
-- (each was signed as the records' verdict, before a preparer could choose; its basis,
-- reason and choice stay null, unknown). The backfill runs before the guard of migration
-- 0143 learns the new columns: that guard compares only the columns it names, so it allows
-- this one write and still refuses any change of what a sign-off recorded. The guard is then
-- replaced by the same function with the four new columns added to what never changes:
-- nothing it refused before is allowed now.
--
-- Rollback: restore design_conclusions_immutable() as migration 0143 created it; ALTER TABLE
-- design_conclusions DROP COLUMN choice_id, DROP COLUMN conclusion_reason, DROP COLUMN
-- conclusion_basis, DROP COLUMN conclusion (their constraints go with them); DROP TABLE
-- design_conclusion_choices; DROP FUNCTION guard_design_conclusion_choice_update(),
-- prevent_design_conclusion_choice_deletion(); delete the audit events whose action is
-- 'design_conclusion.chosen' only if the firm's retention allows it (they are otherwise
-- kept: they name no table); delete the '0165_design_conclusion_choices' row from
-- schema_migrations. A rollback loses the preparers' choices and the conclusion kinds of
-- the sign-offs made since; each sign-off's two-value verdict stays.

CREATE TABLE design_conclusion_choices (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    workpaper_id uuid NOT NULL REFERENCES workpapers (id) ON DELETE RESTRICT,
    -- The design workpaper's current version when the choice was recorded.
    workpaper_version integer NOT NULL,
    kind text NOT NULL,
    basis text,
    reason text NOT NULL DEFAULT '',
    proposed_kind text NOT NULL,
    recorded_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ended_at timestamptz,
    ended_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ended_as text,
    CONSTRAINT design_conclusion_choices_kind CHECK (
        kind IN ('EFFECTIVE', 'EXCEPTIONS_NOTED', 'NOT_EFFECTIVE', 'NO_INSTANCE', 'NOT_CONCLUDED')
    ),
    CONSTRAINT design_conclusion_choices_proposed_kind CHECK (
        proposed_kind IN (
            'EFFECTIVE', 'EXCEPTIONS_NOTED', 'NOT_EFFECTIVE', 'NO_INSTANCE', 'NOT_CONCLUDED'
        )
    ),
    -- A basis is given exactly for NOT_EFFECTIVE.
    CONSTRAINT design_conclusion_choices_basis CHECK (
        (basis IS NULL OR basis IN ('DESIGN', 'IMPLEMENTATION', 'BOTH'))
        AND (kind = 'NOT_EFFECTIVE') = (basis IS NOT NULL)
    ),
    -- A reason is 10 to 1,000 characters where one is given. It is needed always for
    -- EXCEPTIONS_NOTED, NOT_EFFECTIVE and NO_INSTANCE, and for EFFECTIVE or NOT_CONCLUDED
    -- where the choice differs from the proposal.
    CONSTRAINT design_conclusion_choices_reason CHECK (
        char_length(reason) <= 1000
        AND (reason = '' OR char_length(btrim(reason)) >= 10)
        AND (
            (kind IN ('EFFECTIVE', 'NOT_CONCLUDED') AND kind = proposed_kind)
            OR char_length(btrim(reason)) >= 10
        )
    ),
    CONSTRAINT design_conclusion_choices_version CHECK (workpaper_version >= 1),
    -- Ended once, by the person who recorded the next choice; what stands names no ending.
    CONSTRAINT design_conclusion_choices_ended_as CHECK (
        ended_as IS NULL OR ended_as = 'REPLACED'
    ),
    CONSTRAINT design_conclusion_choices_ended CHECK (
        (ended_at IS NULL) = (ended_as IS NULL)
        AND (ended_at IS NULL) = (ended_by IS NULL)
        AND (ended_at IS NULL OR ended_at >= recorded_at)
    ),
    -- What a sign-off names is a choice of its own control.
    CONSTRAINT design_conclusion_choices_control_key UNIQUE (id, engagement_control_id),
    CONSTRAINT design_conclusion_choices_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_conclusion_choices_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One standing choice per control.
CREATE UNIQUE INDEX design_conclusion_choices_standing
    ON design_conclusion_choices (project_id, engagement_control_id) WHERE ended_at IS NULL;
-- The history of a control's choices, newest first.
CREATE INDEX design_conclusion_choices_control_idx
    ON design_conclusion_choices (project_id, engagement_control_id, recorded_at DESC);
CREATE INDEX design_conclusion_choices_workpaper_idx
    ON design_conclusion_choices (workpaper_id);

-- A choice is written once. The only change it ever takes is its ending: the three ended_*
-- columns, set once.
CREATE FUNCTION guard_design_conclusion_choice_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'an ended D&I conclusion choice is never changed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.workpaper_id IS DISTINCT FROM OLD.workpaper_id
        OR NEW.workpaper_version IS DISTINCT FROM OLD.workpaper_version
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.basis IS DISTINCT FROM OLD.basis
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.proposed_kind IS DISTINCT FROM OLD.proposed_kind
        OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
        OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
    THEN
        RAISE EXCEPTION 'what a D&I conclusion choice records never changes';
    END IF;
    IF NEW.ended_at IS NULL THEN
        RAISE EXCEPTION 'a D&I conclusion choice changes only by ending';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER design_conclusion_choices_guard
BEFORE UPDATE ON design_conclusion_choices
FOR EACH ROW EXECUTE FUNCTION guard_design_conclusion_choice_update();

CREATE FUNCTION prevent_design_conclusion_choice_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a D&I conclusion choice is ended, never deleted';
END;
$$;

CREATE TRIGGER design_conclusion_choices_kept
BEFORE DELETE ON design_conclusion_choices
FOR EACH ROW EXECUTE FUNCTION prevent_design_conclusion_choice_deletion();

-- An archived engagement's choices are read-only (migration 0136).
CREATE TRIGGER design_conclusion_choices_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON design_conclusion_choices
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();

-- What the reviewer signed: the preparer's conclusion, its basis and reason, and the choice.
-- Null basis, reason and choice on a sign-off made before this migration (unknown).
ALTER TABLE design_conclusions
    ADD COLUMN conclusion text,
    ADD COLUMN conclusion_basis text,
    ADD COLUMN conclusion_reason text,
    ADD COLUMN choice_id uuid;

-- The one backfill: each existing sign-off concluded the records' verdict.
UPDATE design_conclusions SET conclusion = verdict WHERE conclusion IS NULL;

ALTER TABLE design_conclusions
    ALTER COLUMN conclusion SET NOT NULL,
    ADD CONSTRAINT design_conclusions_conclusion CHECK (
        conclusion IN ('EFFECTIVE', 'EXCEPTIONS_NOTED', 'NOT_EFFECTIVE', 'NO_INSTANCE')
    ),
    -- The OE-facing verdict is the two-value mapping of the conclusion.
    ADD CONSTRAINT design_conclusions_verdict_of_conclusion CHECK (
        (conclusion = 'NOT_EFFECTIVE') = (verdict = 'NOT_EFFECTIVE')
    ),
    -- Signed from a choice: its basis exactly for NOT_EFFECTIVE, and its reason. Signed
    -- before choices were recorded: neither is known.
    ADD CONSTRAINT design_conclusions_conclusion_basis CHECK (
        (conclusion_basis IS NULL OR conclusion_basis IN ('DESIGN', 'IMPLEMENTATION', 'BOTH'))
        AND (
            CASE
                WHEN choice_id IS NULL THEN conclusion_basis IS NULL AND conclusion_reason IS NULL
                ELSE (conclusion = 'NOT_EFFECTIVE') = (conclusion_basis IS NOT NULL)
                     AND conclusion_reason IS NOT NULL
            END
        )
    ),
    ADD CONSTRAINT design_conclusions_conclusion_reason CHECK (
        conclusion_reason IS NULL OR char_length(conclusion_reason) <= 1000
    ),
    ADD CONSTRAINT design_conclusions_choice_fk
        FOREIGN KEY (choice_id, engagement_control_id)
        REFERENCES design_conclusion_choices (id, engagement_control_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX design_conclusions_choice_idx ON design_conclusions (choice_id)
    WHERE choice_id IS NOT NULL;

-- The guard of migration 0143, with the four new columns among what never changes once a
-- sign-off is recorded. Everything else is as 0143 wrote it.
CREATE OR REPLACE FUNCTION design_conclusions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a D&I conclusion is never deleted';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
       OR NEW.workpaper_id IS DISTINCT FROM OLD.workpaper_id
       OR NEW.workpaper_version IS DISTINCT FROM OLD.workpaper_version
       OR NEW.verdict IS DISTINCT FROM OLD.verdict
       OR NEW.deficiencies IS DISTINCT FROM OLD.deficiencies
       OR NEW.signed_by IS DISTINCT FROM OLD.signed_by
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.signoff_note IS DISTINCT FROM OLD.signoff_note
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.conclusion IS DISTINCT FROM OLD.conclusion
       OR NEW.conclusion_basis IS DISTINCT FROM OLD.conclusion_basis
       OR NEW.conclusion_reason IS DISTINCT FROM OLD.conclusion_reason
       OR NEW.choice_id IS DISTINCT FROM OLD.choice_id THEN
        RAISE EXCEPTION 'a recorded D&I conclusion is never changed';
    END IF;
    IF OLD.reopened_at IS NOT NULL AND (
        NEW.reopened_at IS DISTINCT FROM OLD.reopened_at
        OR NEW.reopened_by IS DISTINCT FROM OLD.reopened_by
        OR NEW.reopen_reason IS DISTINCT FROM OLD.reopen_reason
        OR NEW.reopened_from IS DISTINCT FROM OLD.reopened_from
    ) THEN
        RAISE EXCEPTION 'a D&I conclusion is reopened once; its reopening is never changed';
    END IF;
    RETURN NEW;
END;
$$;
