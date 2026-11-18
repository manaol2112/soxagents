-- Trial Management and Synthetic Demo Experience, Step 4A: the SEEDED provenance.
--
-- A demo engagement carries outputs that were prepared with the dataset, not produced by
-- a model, the rules or a fallback at the time a person looks at them. Such an output
-- says SEEDED where its provenance is kept, so it is never taken for a fresh model result
-- (MODEL), for the deterministic rules (RULES), for the degraded path taken when a model
-- was unavailable (FALLBACK), or for a failure (FAILED). Those four keep their meanings;
-- every row that exists today keeps its value. Only the CHECK constraints widen, in the
-- style of migration 0094, on the tables where a prepared output can stand.
--
-- Step 4A introduces the value and writes none of it yet: the Northstar dataset's own
-- analyses are read by the real extraction and classified by the rules (RULES). Step 4B
-- uses SEEDED for the prepared reviews, test results, mappings and drafts of the demo.

ALTER TABLE test_items DROP CONSTRAINT test_items_source;
ALTER TABLE test_items ADD CONSTRAINT test_items_source CHECK (
    source IS NULL OR source IN ('MODEL', 'REVIEW', 'RULES', 'FAILED', 'SEEDED')
);

ALTER TABLE evidence_analyses DROP CONSTRAINT evidence_analyses_source;
ALTER TABLE evidence_analyses ADD CONSTRAINT evidence_analyses_source CHECK (
    source IS NULL OR source IN ('MODEL', 'RULES', 'FALLBACK', 'FAILED', 'SEEDED')
);

ALTER TABLE pbc_drafts DROP CONSTRAINT pbc_drafts_source;
ALTER TABLE pbc_drafts ADD CONSTRAINT pbc_drafts_source CHECK (
    source IS NULL OR source IN ('MODEL', 'RULES', 'FALLBACK', 'SEEDED')
);

ALTER TABLE control_reviews DROP CONSTRAINT control_reviews_source;
ALTER TABLE control_reviews ADD CONSTRAINT control_reviews_source CHECK (
    reperform_source IS NULL OR reperform_source IN ('MODEL', 'RULES', 'FALLBACK', 'SEEDED')
);

ALTER TABLE evidence_plans DROP CONSTRAINT evidence_plans_source;
ALTER TABLE evidence_plans ADD CONSTRAINT evidence_plans_source CHECK (
    source IN ('MODEL', 'RULES', 'FALLBACK', 'SEEDED')
);

ALTER TABLE evidence_plan_runs DROP CONSTRAINT evidence_plan_runs_source;
ALTER TABLE evidence_plan_runs ADD CONSTRAINT evidence_plan_runs_source CHECK (
    source IN ('MODEL', 'RULES', 'FALLBACK', 'SEEDED')
);

ALTER TABLE evidence_matches DROP CONSTRAINT evidence_matches_source;
ALTER TABLE evidence_matches ADD CONSTRAINT evidence_matches_source CHECK (
    source IS NULL OR source IN ('RULES', 'MODEL', 'FAILED', 'SEEDED')
);

ALTER TABLE evidence_mapping_runs DROP CONSTRAINT evidence_mapping_runs_source;
ALTER TABLE evidence_mapping_runs ADD CONSTRAINT evidence_mapping_runs_source CHECK (
    source IN ('MODEL', 'RULES', 'FALLBACK', 'FAILED', 'SEEDED')
);

ALTER TABLE evidence_mappings DROP CONSTRAINT evidence_mappings_source;
ALTER TABLE evidence_mappings ADD CONSTRAINT evidence_mappings_source CHECK (
    source IN ('MODEL', 'RULES', 'FALLBACK', 'FAILED', 'SEEDED')
);

ALTER TABLE workpaper_versions DROP CONSTRAINT workpaper_versions_source;
ALTER TABLE workpaper_versions ADD CONSTRAINT workpaper_versions_source CHECK (
    source IN ('AGENT', 'PERSON', 'RECORDS', 'FALLBACK', 'SEEDED')
);
