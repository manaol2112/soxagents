-- Pre-launch hardening, Step 7: a stored object no record names may be removed.
--
-- The mock store keeps objects in mock_objects, guarded since migration 0071 so that an
-- object, once stored, never changes and is never removed, except an export past its
-- retention. Every evidence path stores the bytes before it inserts the row that names
-- them, so a row the database refuses (an allowance, a constraint) leaves an object
-- behind; the path now removes it again (storage_sweep.discard), and housekeeping sweeps
-- what a dead process left. The guard allows exactly that: a delete of an object that no
-- evidence file, request attachment or governing document names. A referenced object is
-- still immutable and undeletable.

CREATE OR REPLACE FUNCTION guard_stored_object()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'a stored object never changes'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.object_key LIKE 'exports/%' THEN
        RETURN OLD;
    END IF;
    IF EXISTS (SELECT 1 FROM public.evidence_files WHERE object_key = OLD.object_key)
       OR EXISTS (SELECT 1 FROM public.request_attachments WHERE object_key = OLD.object_key)
       OR EXISTS (SELECT 1 FROM public.source_documents WHERE object_key = OLD.object_key) THEN
        RAISE EXCEPTION 'a stored object a record names is never removed'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END;
$$;
