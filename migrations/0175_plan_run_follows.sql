-- A plan run's follow-on runs are bounded on their own, and a follow-on run is a new run with
-- its own attempts (docs/control-workflow-plan.md, B1k and B1l point 7; the end-to-end check
-- of the second fix round, 16 November 2026).
--
-- Before, a run whose end queued the same plan again (what fell due while it worked:
-- evidence_plans.queue_for_understanding with requeue) kept its run_attempts, and the claim
-- requires run_attempts < 3. A chain of follow-on runs could therefore leave a PENDING plan
-- nobody could claim, read as "Checking..." on the page with neither Run again nor Proceed.
--
-- evidence_plans.run_follows: how many follow-on runs the current chain has made. A requeue
-- starts its attempts again and adds one; any other queue (a launch, a person's Run again, a
-- save) sets it back to 0. A requeue is refused at PLAN_RUN_FOLLOWS (3, so a chain makes at
-- most 4 runs, as the durable workflow's PLAN_FOLLOWS turns), and the read still due ends
-- FAILED with its sentence (understanding_review.follow_or_fail).
ALTER TABLE evidence_plans
    ADD COLUMN run_follows integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT evidence_plans_run_follows CHECK (run_follows BETWEEN 0 AND 50);
