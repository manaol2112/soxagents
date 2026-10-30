-- Trial Management and Synthetic Demo Experience, Step 5: where each trial member stands
-- in the guided tour of the firm's demo engagement.
--
-- One row per member and firm: the stage reached, whether the tour is not started, in
-- progress, skipped or completed, and the demo engagement the progress belongs to. The
-- engagement is always a demo one (the trigger refuses any other), so a tour can never be
-- recorded against a real engagement; when the firm's demo is rebuilt the row names the
-- old engagement, and the API treats it as stale and starts the member afresh.

CREATE TABLE demo_tour_progress (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    stage text NOT NULL,
    status text NOT NULL DEFAULT 'NOT_STARTED',
    started_at timestamptz,
    completed_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, user_id),
    CONSTRAINT demo_tour_progress_status
        CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'SKIPPED', 'COMPLETED')),
    CONSTRAINT demo_tour_progress_stage CHECK (stage ~ '^[a-z][a-z-]{1,39}$'),
    CONSTRAINT demo_tour_progress_version CHECK (version >= 1),
    CONSTRAINT demo_tour_progress_completed
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
    CONSTRAINT demo_tour_progress_organization_fk
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT demo_tour_progress_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT demo_tour_progress_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER demo_tour_progress_updated_at
    BEFORE UPDATE ON demo_tour_progress
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Tour progress belongs to a demo engagement only.
CREATE FUNCTION guard_demo_tour_progress()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT is_demo_project(NEW.project_id) THEN
        RAISE EXCEPTION 'tour progress belongs to a demo engagement only'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER demo_tour_progress_guard
    BEFORE INSERT OR UPDATE OF project_id ON demo_tour_progress
    FOR EACH ROW
    EXECUTE FUNCTION guard_demo_tour_progress();
