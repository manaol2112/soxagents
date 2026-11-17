-- The audit events of one record, read by the record (reliability audit, 17 November 2026).
--
-- audit_events had indexes only by organization and by project, each in time order. The
-- readers that ask what happened to one record (a request's last receipt by link, whether
-- a draft request was touched, whether its assignment changed, a task's history, a
-- control's activity) filter on target_type and target_id, so each read scanned every
-- event of the engagement, and the receipt reader every event of every engagement. The
-- table only grows.
--
-- One index on (target_type, target_id, occurred_at DESC): the record's events, newest
-- first, as the readers order them.
--
-- Additive: one index. No table, row, constraint or function is changed. IF NOT EXISTS so
-- an index built by hand ahead of this migration is kept. The build takes a lock that
-- holds writes to audit_events while it runs (a migration runs in a transaction, so the
-- index cannot be built concurrently here).
--
-- Rollback: DROP INDEX IF EXISTS audit_events_target_idx; delete the
-- '0172_audit_event_targets' row from schema_migrations.

CREATE INDEX IF NOT EXISTS audit_events_target_idx
    ON audit_events (target_type, target_id, occurred_at DESC);
