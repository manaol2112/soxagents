-- When a file's filing landed where it is (E1 evidence reliance, found on the real screen,
-- 18 November 2026; approved by the product owner).
--
-- A file counts as accepted with an evidence item when it served the item at the
-- acceptance (evidence_reliance._accepted), and as part of a signed D&I conclusion when it
-- served a design item at the sign-off (_concluded). Both read "served at the time" as the
-- file's own created_at. A file moved off its control and filed back after the acceptance
-- keeps its created_at (the move rewrites the same evidence_matches row), so it was read
-- as part of a decision it was never part of, and its Replace and Withdraw were refused.
-- Nothing recorded when the current filing landed.
--
-- 1. evidence_matches.filed_at: when the row's current filing landed. Maintained only by
--    the trigger below, so every writer keeps it (the agent's filing, a person's filing,
--    move or removal from a request, the evidence wizard's placement, a replacement's
--    filing, the demo seed): set to clock_timestamp() when the row becomes FILED, when a
--    FILED row's control or request changes, or when the one item it is filed for changes
--    to another item; NULL when the row is not FILED. Any other write keeps it, a write of
--    the column itself included. Naming one item of the request it was filed for, or every
--    item again, keeps it: the file served that item throughout (the request's other items
--    are over-protected, never under-protected).
--
-- 2. Backfill: an existing FILED row's filing is read from when its file was stored (the
--    time every acceptance read before), so no record loses a protection it had: a file
--    filed again after an acceptance before this migration stays held. An archived
--    engagement's records are left as they are (0136 refuses the write); the reader takes
--    a FILED row with no time as part of every acceptance, as it does an acceptance with no
--    time. The backfill runs before the trigger exists.
--
-- Additive: one nullable column, one function and one trigger. No row's status, control,
-- request or item changes. The backfill moves the updated_at of each FILED row
-- (set_updated_at), as any backfill of the table does.
--
-- Rollback: DROP TRIGGER evidence_matches_filed_at ON evidence_matches; DROP FUNCTION
-- set_evidence_filed_at(); ALTER TABLE evidence_matches DROP COLUMN filed_at; delete the
-- '0176_evidence_filing_time' row from schema_migrations; roll back the evidence_reliance
-- change that reads the column with it.

ALTER TABLE evidence_matches ADD COLUMN filed_at timestamptz;

-- 2. Backfill, before the trigger: from when the file was stored.
UPDATE evidence_matches m
SET filed_at = f.created_at
FROM evidence_files f, projects p
WHERE m.status = 'FILED'
  AND f.id = m.evidence_file_id
  AND p.id = m.project_id
  AND NOT (p.status::text = 'ARCHIVED' AND p.deleted_at IS NULL);

-- 1. The trigger that keeps it.
CREATE FUNCTION set_evidence_filed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.status <> 'FILED' THEN
        NEW.filed_at := NULL;
    ELSIF TG_OP = 'INSERT' THEN
        NEW.filed_at := clock_timestamp();
    ELSIF OLD.status <> 'FILED'
       OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
       OR NEW.pbc_request_id IS DISTINCT FROM OLD.pbc_request_id
       OR (OLD.requirement_id IS NOT NULL AND NEW.requirement_id IS NOT NULL
           AND NEW.requirement_id <> OLD.requirement_id) THEN
        NEW.filed_at := clock_timestamp();
    ELSE
        NEW.filed_at := OLD.filed_at;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_matches_filed_at
    BEFORE INSERT OR UPDATE ON evidence_matches
    FOR EACH ROW EXECUTE FUNCTION set_evidence_filed_at();
