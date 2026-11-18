-- Pre-launch hardening, Step 7: an archived engagement is read-only in the database.
--
-- The closed-engagement middleware refuses HTTP writes to a COMPLETED or ARCHIVED
-- engagement; a background job finishing late, or a deploy-time routine, could still
-- write its rows. This trigger refuses any insert, update or delete of an engagement
-- record whose project is ARCHIVED. It sits only on the tables that hold the audit's own
-- records (evidence, requests, plans, tests, rounds, reviews, workpapers, deficiencies,
-- scope, documents), never on the ones that must keep moving for an archived engagement:
-- the audit trail, model calls and their reservations, exports and their purge, the
-- console, a person's last page, the demo's tour progress, agent job claims and tasks.
-- COMPLETED engagements keep their lifecycle (they may reopen); only ARCHIVED is final.
-- The demo reset archives the old engagement and then writes only to the new one.
-- An archived draft that never launched may still be deleted (engagement_close): the
-- project row is marked deleted first, and only then are its setup rows purged, so a
-- deleted engagement's rows are outside the guard.

CREATE FUNCTION refuse_archived_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    project uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        project := OLD.project_id;
    ELSE
        project := NEW.project_id;
    END IF;
    IF project IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.projects
        WHERE id = project AND status = 'ARCHIVED' AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'the engagement is archived and read-only'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    guarded text[] := ARRAY[
        'engagement_applications', 'engagement_processes', 'engagement_controls',
        'engagement_contacts', 'engagement_settings', 'engagement_milestones',
        'engagement_phases', 'control_tests', 'control_attributes', 'control_narratives',
        'evidence_plans', 'evidence_requirements', 'evidence_requirement_files',
        'pbc_requests', 'pbc_drafts', 'request_attachments', 'request_answers',
        'request_messages', 'evidence_files', 'evidence_matches', 'evidence_analyses',
        'evidence_reviews', 'test_rounds', 'test_sheets', 'test_sheet_signoffs',
        'workpapers', 'control_reviews', 'review_notes', 'control_review_signoffs',
        'review_coverage_assessments', 'deficiencies', 'source_documents',
        'workpaper_templates', 'phase_releases', 'plan_versions', 'plan_decisions'
    ];
    name text;
BEGIN
    FOREACH name IN ARRAY guarded LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = name AND column_name = 'project_id'
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I '
                'FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes()',
                name || '_archived_guard', name
            );
        END IF;
    END LOOP;
END;
$$;
