-- The D&I requests list, after its independent review (12 November 2026;
-- docs/control-workflow-plan.md, B1e "After the independent review").
--
-- 1. The list's last decision. The D&I release rests on the last decision a person made on
--    the control's requests list (accepting, adding, rewording, linking, removing, waiving
--    or restoring a request, deciding a proposed change, recording or clearing a coverage
--    exception). evidence_plans.design_decided_by / design_decided_at keep who made it and
--    when, so that whenever the list becomes settled (their own request, another person's
--    save that reaches the control, the end of a planner or narrative run) the release is
--    attributed to that person, never to whoever happened to trigger it. Both set or both
--    null. No backfill: a list accepted before this has no such decision on record, and
--    waits for a person to accept it (nobody is invented as its decider).
--
-- 2. When a plan run was queued. evidence_plans.run_queued_at is set by trigger whenever
--    run_status becomes PENDING, whoever queues it, so a run that has waited longer than
--    the worker's bound reads as stopped, with what a person does next, instead of as
--    working for ever. Runs waiting now are given the bound from now.
--
-- 3. A removed request is not accepted. Acceptance belongs to a request in the list: when
--    a request leaves the plan (a person removes it, a removal the planner proposed is
--    accepted, a phase is decided not applicable, a run drops a proposal nobody accepted)
--    its accepted_by / accepted_at are cleared by trigger, on every path, so a request
--    planned again later is the agent's proposal to accept, not somebody's acceptance of
--    words they never saw.
--
-- Additive: three nullable columns and two triggers.
--
-- Rollback: DROP TRIGGER evidence_requirements_removed_unaccepted ON evidence_requirements;
-- DROP FUNCTION unaccept_removed_requirement(); DROP TRIGGER evidence_plans_run_queued ON
-- evidence_plans; DROP FUNCTION stamp_plan_run_queued(); ALTER TABLE evidence_plans DROP
-- CONSTRAINT evidence_plans_design_decided, DROP COLUMN design_decided_by, DROP COLUMN
-- design_decided_at, DROP COLUMN run_queued_at; and delete the
-- '0150_design_list_decisions' row from schema_migrations.

ALTER TABLE evidence_plans
    ADD COLUMN design_decided_by uuid REFERENCES users (id),
    ADD COLUMN design_decided_at timestamptz,
    ADD COLUMN run_queued_at timestamptz,
    ADD CONSTRAINT evidence_plans_design_decided CHECK (
        (design_decided_by IS NULL) = (design_decided_at IS NULL)
    );

CREATE FUNCTION stamp_plan_run_queued() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.run_status = 'PENDING'
       AND (TG_OP = 'INSERT' OR OLD.run_status IS DISTINCT FROM 'PENDING') THEN
        NEW.run_queued_at := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_plans_run_queued
    BEFORE INSERT OR UPDATE OF run_status ON evidence_plans
    FOR EACH ROW EXECUTE FUNCTION stamp_plan_run_queued();

-- Runs waiting now: the bound counts from now (an archived engagement's plans are left).
UPDATE evidence_plans p
SET run_queued_at = clock_timestamp()
FROM projects j
WHERE j.id = p.project_id
  AND NOT (j.status::text = 'ARCHIVED' AND j.deleted_at IS NULL)
  AND p.run_status = 'PENDING';

CREATE FUNCTION unaccept_removed_requirement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'REMOVED' AND OLD.status IS DISTINCT FROM 'REMOVED' THEN
        NEW.accepted_by := NULL;
        NEW.accepted_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_requirements_removed_unaccepted
    BEFORE UPDATE OF status ON evidence_requirements
    FOR EACH ROW EXECUTE FUNCTION unaccept_removed_requirement();

-- Requests already removed, accepted by the 0149 backfill or since: not accepted.
UPDATE evidence_requirements q
SET accepted_by = NULL, accepted_at = NULL
FROM projects j
WHERE j.id = q.project_id
  AND NOT (j.status::text = 'ARCHIVED' AND j.deleted_at IS NULL)
  AND q.status = 'REMOVED'
  AND q.accepted_at IS NOT NULL;
