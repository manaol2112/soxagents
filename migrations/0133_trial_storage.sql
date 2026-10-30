-- Trial Management and Synthetic Demo Experience, Step 6: every stored document counts
-- against the trial's storage allowance, not only evidence files.
--
-- The trial's storage allowance (organization_subscriptions.limit_upload_bytes) was
-- enforced on evidence_files alone (migrations 0127 and 0128). Three other paths keep a
-- member's bytes: a request's attachments (request_attachments, up to 25 MB each), the
-- firm's governing documents (source_documents with an object_key) and uploaded workpaper
-- templates (workpaper_templates.content). They now count towards the same allowance,
-- with the same rule: the firm's stored bytes, demo engagements left out, may not pass
-- the limit. The count allowance (limit_uploads) stays what it was: evidence files.

CREATE FUNCTION trial_stored_bytes(firm uuid)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce((
        SELECT sum(f.size_bytes) FROM evidence_files f
        JOIN projects p ON p.id = f.project_id
        WHERE f.organization_id = firm AND NOT p.demo
    ), 0)
    + coalesce((
        SELECT sum(a.size_bytes) FROM request_attachments a
        JOIN projects p ON p.id = a.project_id
        WHERE a.organization_id = firm AND NOT p.demo AND a.evidence_file_id IS NULL
    ), 0)
    + coalesce((
        SELECT sum(d.size_bytes) FROM source_documents d
        LEFT JOIN projects p ON p.id = d.project_id
        WHERE d.organization_id = firm AND d.object_key IS NOT NULL
          AND coalesce(p.demo, false) = false
    ), 0)
    + coalesce((
        SELECT sum(octet_length(t.content)) FROM workpaper_templates t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.organization_id = firm AND t.content IS NOT NULL
          AND coalesce(p.demo, false) = false
    ), 0);
$$;

CREATE OR REPLACE FUNCTION enforce_trial_uploads()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used bigint;
    used_bytes bigint;
BEGIN
    -- Evidence also arrives without a session (the client's portal, the mailbox): an
    -- inactive subscription takes no more of it, for a demo engagement too.
    IF NOT subscription_writable(NEW.organization_id) THEN
        PERFORM trial_limit_refused('subscription', 0, 0);
    END IF;
    IF is_demo_project(NEW.project_id) THEN
        RETURN NEW;
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT count(*) INTO used
    FROM evidence_files f
    JOIN projects p ON p.id = f.project_id
    WHERE f.organization_id = NEW.organization_id AND NOT p.demo;
    IF sub.limit_uploads IS NOT NULL AND used >= sub.limit_uploads THEN
        PERFORM trial_limit_refused('uploads', used, sub.limit_uploads);
    END IF;
    used_bytes := trial_stored_bytes(NEW.organization_id);
    IF sub.limit_upload_bytes IS NOT NULL AND used_bytes + NEW.size_bytes > sub.limit_upload_bytes THEN
        PERFORM trial_limit_refused('storage', used_bytes + NEW.size_bytes, sub.limit_upload_bytes);
    END IF;
    RETURN NEW;
END;
$$;

-- The same storage rule for the other documents a member stores.
CREATE FUNCTION enforce_trial_storage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    sub organization_subscriptions;
    used_bytes bigint;
    added bigint;
BEGIN
    -- One branch per table: a field is named only on the table that has it.
    IF TG_TABLE_NAME = 'workpaper_templates' THEN
        added := coalesce(octet_length(NEW.content), 0);
    ELSIF TG_TABLE_NAME = 'request_attachments' THEN
        IF NEW.evidence_file_id IS NOT NULL THEN
            -- A link to an evidence file already counted stores nothing new.
            RETURN NEW;
        END IF;
        added := coalesce(NEW.size_bytes, 0);
    ELSE
        IF NEW.object_key IS NULL THEN
            RETURN NEW;
        END IF;
        added := coalesce(NEW.size_bytes, 0);
    END IF;
    IF added <= 0 OR (NEW.project_id IS NOT NULL AND is_demo_project(NEW.project_id)) THEN
        RETURN NEW;
    END IF;
    sub := trial_subscription(NEW.organization_id);
    IF sub.organization_id IS NULL OR sub.limit_upload_bytes IS NULL THEN
        RETURN NEW;
    END IF;
    used_bytes := trial_stored_bytes(NEW.organization_id);
    IF used_bytes + added > sub.limit_upload_bytes THEN
        PERFORM trial_limit_refused('storage', used_bytes + added, sub.limit_upload_bytes);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER request_attachments_trial_storage
    BEFORE INSERT ON request_attachments
    FOR EACH ROW
    EXECUTE FUNCTION enforce_trial_storage();

CREATE TRIGGER source_documents_trial_storage
    BEFORE INSERT OR UPDATE OF object_key, size_bytes ON source_documents
    FOR EACH ROW
    EXECUTE FUNCTION enforce_trial_storage();

CREATE TRIGGER workpaper_templates_trial_storage
    BEFORE INSERT OR UPDATE OF content ON workpaper_templates
    FOR EACH ROW
    EXECUTE FUNCTION enforce_trial_storage();
