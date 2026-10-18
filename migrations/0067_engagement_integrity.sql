-- Engagement integrity (Milestone 8.13).
--
-- One lifecycle: a draft becomes active only by launching it, which records the kickoff
-- (engagement_settings.kicked_off_at) in the same transaction. An archived engagement is
-- closed and does not reopen. The database refuses either change made any other way.
--
-- A system or a control ID is the same one however it is cased: "SAP ERP" and "sap erp"
-- are one system, "ITGC-AC-01" and "itgc-ac-01" one control on a system.

CREATE FUNCTION guard_project_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
        RAISE EXCEPTION 'an archived engagement does not reopen'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status IN ('ACTIVE', 'PAUSED') AND NOT EXISTS (
        SELECT 1 FROM engagement_settings
        WHERE project_id = NEW.id AND kicked_off_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'a draft engagement becomes active only by launching it'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_lifecycle
    BEFORE UPDATE OF status ON projects
    FOR EACH ROW
    EXECUTE FUNCTION guard_project_lifecycle();

CREATE UNIQUE INDEX engagement_applications_name_folded
    ON engagement_applications (project_id, lower(btrim(name)));

CREATE UNIQUE INDEX engagement_controls_ref_app_folded
    ON engagement_controls (project_id, upper(control_ref), engagement_application_id)
    WHERE engagement_application_id IS NOT NULL;
CREATE UNIQUE INDEX engagement_controls_ref_none_folded
    ON engagement_controls (project_id, upper(control_ref))
    WHERE engagement_application_id IS NULL;
