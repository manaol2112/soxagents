-- A person's rating of a deficiency's severity (decided by the product owner on 8 November
-- 2026; docs/control-workflow-plan.md, B3: "the agent proposes, a person rates").
--
-- The Control Conclusion step proposes the control's conclusion from the D&I verdict, the OE
-- results and the open deficiencies. Each deficiency's severity (control deficiency,
-- significant deficiency, material weakness) is set by a person, with the agent's suggestion
-- shown beside it. Until now a deficiency's severity was only its default or a requested
-- change; nothing recorded that a person had weighed it.
--
-- Each rating is kept as it was made, with the person's rationale and the suggestion they saw.
-- A deficiency is rated while its latest rating names its current severity and no severity
-- change waits for the reviewer. A rating of significant deficiency or material weakness still
-- goes to the reviewer through the existing change request (deficiencies.pending_change); it
-- holds once the reviewer approves it. Rows are never changed or deleted (enforced by trigger).
--
-- No backfill: no deficiency has been rated through this step.
--
-- Rollback: DROP TABLE deficiency_ratings; DROP FUNCTION deficiency_ratings_immutable();
-- delete the '0144_deficiency_ratings' row from schema_migrations.

CREATE TABLE deficiency_ratings (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    deficiency_id uuid NOT NULL REFERENCES deficiencies (id) ON DELETE RESTRICT,
    severity text NOT NULL,
    -- The agent's suggestion the person saw when rating, if it had one.
    suggested_severity text,
    rationale text NOT NULL,
    rated_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    rated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT deficiency_ratings_severity CHECK (
        severity IN ('CONTROL_DEFICIENCY', 'SIGNIFICANT_DEFICIENCY', 'MATERIAL_WEAKNESS')
    ),
    CONSTRAINT deficiency_ratings_suggested CHECK (
        suggested_severity IS NULL OR suggested_severity IN (
            'CONTROL_DEFICIENCY', 'SIGNIFICANT_DEFICIENCY', 'MATERIAL_WEAKNESS'
        )
    ),
    CONSTRAINT deficiency_ratings_rationale CHECK (
        char_length(btrim(rationale)) BETWEEN 10 AND 1000
    )
);

CREATE INDEX deficiency_ratings_latest ON deficiency_ratings (deficiency_id, rated_at DESC);

CREATE FUNCTION deficiency_ratings_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a deficiency rating is never deleted';
    END IF;
    RAISE EXCEPTION 'a recorded deficiency rating is never changed';
END;
$$;

CREATE TRIGGER deficiency_ratings_immutable
BEFORE UPDATE OR DELETE ON deficiency_ratings
FOR EACH ROW EXECUTE FUNCTION deficiency_ratings_immutable();
