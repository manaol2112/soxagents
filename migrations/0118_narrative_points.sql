-- The narrative's points to confirm, and its run's progress (decided by the product owner
-- on 26 October 2026). The agents no longer ask piecemeal: for each fact the narrative still
-- needs they state their best understanding from the sources, and the walkthrough shows a
-- round's points together, to confirm at once or correct. One round, then the narrative is
-- finished with what is known; a later point is asked only where an answer contradicts the
-- records, and a topic is never asked twice.

-- A point: the statement to confirm (empty when the sources suggest none, and the question
-- is asked open), the narrative section and the attribute codes it serves, the round it was
-- raised in, and whether it is a missing fact or a contradiction.
ALTER TABLE control_context_issues
    ADD COLUMN proposal text NOT NULL DEFAULT '',
    ADD COLUMN narrative_section text NOT NULL DEFAULT '',
    ADD COLUMN attribute_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN point_round integer NOT NULL DEFAULT 0,
    ADD COLUMN point_kind text NOT NULL DEFAULT '',
    ADD CONSTRAINT control_context_issues_point CHECK (
        char_length(proposal) <= 400
        AND narrative_section IN (
            '', 'PURPOSE', 'INITIATION', 'APPROVAL', 'EXECUTION', 'RECORDING', 'EXCEPTIONS',
            'MONITORING'
        )
        AND jsonb_typeof(attribute_codes) = 'array'
        AND point_round >= 0
        AND point_kind IN ('', 'MISSING', 'CONTRADICTION')
    );

-- The run's progress, shown while the agents work: the stage and when it began, when the
-- run began, and what it is working from ({answers, documents, attributes, points}).
ALTER TABLE process_narrative_runs
    DROP CONSTRAINT process_narrative_runs_stage,
    ADD CONSTRAINT process_narrative_runs_stage CHECK (
        stage IN ('', 'PREPARING', 'DRAFTING', 'REVIEWING', 'CHECKING')
    ),
    ADD COLUMN started_at timestamptz,
    ADD COLUMN stage_at timestamptz,
    ADD COLUMN progress jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT process_narrative_runs_progress CHECK (jsonb_typeof(progress) = 'object');
