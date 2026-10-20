-- Acceptance follow-ups (after Milestone 1).
--
-- 1. A tester run that stops after its retries leaves a note on the sheet: what stopped
--    and that a person starts it again. An agent execution failure is then told apart
--    from a testing failure (exceptions in the results), which the results carry.
-- 2. A roll-forward or retest round records its testing basis explicitly when it is
--    opened: the approved plan revision, the control's approved attributes and the
--    interim procedures it carries forward. The basis is shown before the round's
--    samples are approved and must be confirmed again when the plan changes after it
--    was set; a round never silently inherits the interim's plan.

ALTER TABLE test_sheets
    ADD COLUMN run_note text NOT NULL DEFAULT '',
    ADD CONSTRAINT test_sheets_run_note CHECK (char_length(run_note) <= 500);

ALTER TABLE test_rounds
    ADD COLUMN basis jsonb,
    ADD COLUMN basis_confirmed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN basis_confirmed_at timestamptz;

-- Rounds opened before this migration get their basis from the plan as approved now,
-- marked as backfilled so the record says so.
UPDATE test_rounds r
SET basis = jsonb_build_object(
        'plan_revision', p.approved_revision,
        'attributes', coalesce(c.test_attributes, '[]'::jsonb),
        'procedures', coalesce(
            (SELECT ph.procedures FROM evidence_plan_phases ph
             WHERE ph.plan_id = p.id AND ph.phase = 'INTERIM'),
            '[]'::jsonb),
        'source', 'CONTROL_APPROVED_SET',
        'stamped_at', to_jsonb(clock_timestamp()),
        'backfilled', true)
FROM engagement_controls c
LEFT JOIN evidence_plans p ON p.engagement_control_id = c.id
WHERE r.engagement_control_id = c.id AND r.basis IS NULL;
