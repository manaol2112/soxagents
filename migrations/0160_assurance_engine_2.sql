-- The evidence assurance chain, engine 2 (14 November 2026; docs/evidence-assurance.md,
-- section 10): sufficiency grounded in the approved control understanding, comparisons made
-- in code, follow-ups, considerations, two dimensions and a proposed outcome.
--
-- Forward only. engine_version says which engine a run was recorded under. Every run on
-- record is engine 1 and stays as it is: it is compared with what is in force as engine 1
-- reads it (its gate, its hash inputs, its prompt versions), so this migration and the
-- release with it mark no run out of date, queue nothing, read no evidence again, reopen
-- no finding and ask for no decision again. New runs are engine 2.
--
-- context_sha256 is the hash of the control's context an engine 2 run was given (its
-- design, the confirmed understanding, what the request asked for); '' for engine 1.
-- review is the engine 2 run's result beyond the attributes (the proposed outcome and its
-- explanation, completeness, the files' relevance and reliability, follow-ups,
-- considerations); null for engine 1 and for a run that has not finished.
--
-- Additive: three columns. No row is changed.
--
-- Rollback: ALTER TABLE evidence_assessments DROP COLUMN review, DROP COLUMN
-- context_sha256, DROP COLUMN engine_version; delete the '0160_assurance_engine_2' row from
-- schema_migrations. Only before any engine 2 run is recorded: its result could no longer
-- be read as recorded.

ALTER TABLE evidence_assessments
    ADD COLUMN engine_version integer NOT NULL DEFAULT 1,
    ADD COLUMN context_sha256 text NOT NULL DEFAULT '',
    ADD COLUMN review jsonb,
    ADD CONSTRAINT evidence_assessments_engine CHECK (engine_version IN (1, 2)),
    ADD CONSTRAINT evidence_assessments_review CHECK (
        review IS NULL OR (jsonb_typeof(review) = 'object' AND engine_version = 2)
    ),
    ADD CONSTRAINT evidence_assessments_review_size CHECK (
        review IS NULL OR pg_column_size(review) <= 262144
    );
