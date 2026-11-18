-- The sample of one, traced across an item's files (decided by the product owner on
-- 31 October 2026: "it should be smart enough to recognize that this is for that employee.
-- If not, it should ask who is the user that is selected as sample").
--
-- The agent proposes the instance from the evidence (a ticket that names the person found
-- in the population), and a person confirms it or picks another: the confirmation is a
-- walkthrough instance like a pick, with where the proposal came from. What the trace
-- observes once confirmed (a removal later than the policy allows, a file with no record
-- of the instance, activity after the event) becomes a finding a person disposes of, as
-- the reader's and the mapping's do.
--
-- Rollback: ALTER TABLE evidence_findings DROP CONSTRAINT evidence_findings_origin, DROP
-- CONSTRAINT evidence_findings_source, DROP CONSTRAINT evidence_findings_kind, DROP COLUMN
-- walkthrough_instance_id, then restore the three constraints of migration 0137 (after
-- deleting any TRACE findings and their events); ALTER TABLE walkthrough_instances DROP
-- COLUMN origin, DROP COLUMN named_in_file_id, DROP COLUMN named_in_sha256, DROP COLUMN
-- reasons; delete the '0139_sample_traces' row from schema_migrations.

ALTER TABLE walkthrough_instances
    ADD COLUMN origin text NOT NULL DEFAULT 'PICKED',
    -- The file that named the instance when a person confirmed the agent's proposal, and
    -- its hash at the time.
    ADD COLUMN named_in_file_id uuid REFERENCES evidence_files (id) ON DELETE RESTRICT,
    ADD COLUMN named_in_sha256 text NOT NULL DEFAULT '',
    -- The agent's reasons, as shown to the person who confirmed them.
    ADD COLUMN reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT walkthrough_instances_origin CHECK (origin IN ('PICKED', 'CONFIRMED')),
    ADD CONSTRAINT walkthrough_instances_named CHECK (
        (named_in_file_id IS NULL) = (named_in_sha256 = '')
        AND (named_in_sha256 = '' OR named_in_sha256 ~ '^[0-9a-f]{64}$')
    ),
    ADD CONSTRAINT walkthrough_instances_reasons CHECK (
        jsonb_typeof(reasons) = 'array' AND jsonb_array_length(reasons) <= 8
    );

ALTER TABLE evidence_findings
    ADD COLUMN walkthrough_instance_id uuid
        REFERENCES walkthrough_instances (id) ON DELETE RESTRICT;

ALTER TABLE evidence_findings DROP CONSTRAINT evidence_findings_source;
ALTER TABLE evidence_findings ADD CONSTRAINT evidence_findings_source
    CHECK (source IN ('READER', 'RULES', 'MAPPING', 'TRACE'));

ALTER TABLE evidence_findings DROP CONSTRAINT evidence_findings_kind;
ALTER TABLE evidence_findings ADD CONSTRAINT evidence_findings_kind CHECK (
    kind IN (
        'GAP', 'PARTIAL', 'NOT_COVERED', 'PLACEHOLDER', 'VERSION', 'PERIOD',
        'MISSING', 'CONFLICT', 'CONCERN', 'LATE', 'NOT_TRACED', 'ACTIVITY'
    )
);

-- Each finding rests on exactly one origin: a reading, a mapping run, or a trace.
ALTER TABLE evidence_findings DROP CONSTRAINT evidence_findings_origin;
ALTER TABLE evidence_findings ADD CONSTRAINT evidence_findings_origin CHECK (
    (source = 'MAPPING') = (mapping_run_id IS NOT NULL)
    AND (source IN ('READER', 'RULES')) = (analysis_id IS NOT NULL)
    AND (source = 'TRACE') = (walkthrough_instance_id IS NOT NULL)
);

CREATE INDEX evidence_findings_instance_idx
    ON evidence_findings (walkthrough_instance_id) WHERE walkthrough_instance_id IS NOT NULL;
