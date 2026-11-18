-- Release 2a: evidence specifications and consolidation analyses (decided by the product
-- owner, 24 October 2026; docs/release-2a.md).
--
-- 1. evidence_specifications: for each evidence requirement, what artifact would satisfy
--    it, in the evidence catalog's terms (evidence_catalog.py): its kind, scope, period,
--    distinguishing parameters, personal data, and whether it is a sample item, with a
--    fingerprint of everything that decides whether two requirements could share one
--    artifact. Derived from the requirement and its plan; recomputed when an analysis
--    runs, never edited by a person. A requirement's own row is unchanged.
-- 2. evidence_consolidation_analyses: an immutable record of each read-only analysis of an
--    engagement: what delivery grouping and artifact sharing would do, for review.
--
-- Nothing here changes how requests, files, receipts, sufficiency, approvals, or testing
-- behave.
--
-- Rollback: DROP TABLE evidence_consolidation_analyses; DROP TABLE
-- evidence_specifications; delete the '0105_evidence_specifications' row from
-- schema_migrations.

CREATE TABLE evidence_specifications (
    requirement_id uuid PRIMARY KEY REFERENCES evidence_requirements (id) ON DELETE CASCADE,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    catalog_version integer NOT NULL,
    -- NULL: outside the catalog, never shared.
    kind text,
    spec jsonb NOT NULL,
    spec_hash text NOT NULL,
    -- The requirement's version the specification was computed from.
    requirement_version integer NOT NULL,
    computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_specifications_catalog CHECK (catalog_version >= 1),
    CONSTRAINT evidence_specifications_kind CHECK (
        kind IS NULL OR kind IN (
            'POLICY_DOCUMENT', 'HR_LEAVERS', 'HR_TRANSFERS', 'DEPLOYMENT_LOG',
            'CHANGE_RIGHTS', 'DAY_CALENDAR', 'CONTROL_SPECIFIC'
        )
    ),
    CONSTRAINT evidence_specifications_spec CHECK (jsonb_typeof(spec) = 'object'),
    CONSTRAINT evidence_specifications_hash CHECK (spec_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_specifications_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_specifications_hash_idx
    ON evidence_specifications (project_id, spec_hash);

CREATE TABLE evidence_consolidation_analyses (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    catalog_version integer NOT NULL,
    summary jsonb NOT NULL,
    detail jsonb NOT NULL,
    run_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    run_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT evidence_consolidation_analyses_catalog CHECK (catalog_version >= 1),
    CONSTRAINT evidence_consolidation_analyses_summary CHECK (jsonb_typeof(summary) = 'object'),
    CONSTRAINT evidence_consolidation_analyses_detail CHECK (jsonb_typeof(detail) = 'object'),
    CONSTRAINT evidence_consolidation_analyses_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_consolidation_analyses_project_idx
    ON evidence_consolidation_analyses (project_id, run_at DESC);

CREATE TRIGGER evidence_consolidation_analyses_immutable
    BEFORE UPDATE OR DELETE ON evidence_consolidation_analyses
    FOR EACH ROW EXECUTE FUNCTION reject_plan_record_change();
