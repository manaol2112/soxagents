-- The preparer sends the D&I workpaper for review (docs/design-workpaper.md, section 3.8;
-- decided by the product owner on 16 November 2026: "When the user signs-off he/she has the
-- option to send the workpaper for review to another team member", then "Looks good to me").
--
-- "Sign and send for review" prepares the design workpaper and, in the same transaction,
-- names the reviewer who is to sign its D&I conclusion. design_review_requests keeps one row
-- per request sent:
--
--   engagement_control_id, workpaper_id   the control and its design workpaper;
--   workpaper_version   the version prepared (workpapers.prepared_version then);
--   reviewer_id         the reviewer it is sent to;
--   sent_by, sent_at    who sent it and when;
--   message             the sender's own, at most 1,000 characters, '' where none;
--   reminded_at         the last reminder (an in-app notice to the reviewer; at most once an
--                       hour, decided in code): the one column that may change, and only
--                       forward, while the request stands;
--   ended_*             a request is never deleted and never rewritten. It ends once:
--                       SIGNED with the reviewer's sign-off; RETURNED to the preparer with
--                       the reviewer's reason (10 to 1,000 characters); REASSIGNED when
--                       another reviewer is chosen; REOPENED when the workpaper is reopened
--                       (with the reopening's reason, where one was given); SUPERSEDED when
--                       the workpaper is prepared again.
--
-- One request stands (ended_at IS NULL) per control. A request is sent, in its control's own
-- engagement, for the control's design workpaper while it is prepared at that version (the
-- insert guard). An archived engagement's requests are read-only (migration 0136).
--
-- Additive: one table, its three guard functions and four triggers. No existing table, row
-- or function is changed.
--
-- Rollback: DROP TABLE design_review_requests; DROP FUNCTION
-- guard_design_review_request_insert(), guard_design_review_request_update(),
-- prevent_design_review_request_deletion(); delete the audit events whose action starts
-- with 'design_review_request.' only if the firm's retention allows it (they are otherwise
-- kept: they name no table); delete the '0168_design_review_requests' row from
-- schema_migrations. A rollback loses who each D&I workpaper was sent to and the returns'
-- reasons; the preparations and the sign-offs stay, and any reviewer may sign again.

CREATE TABLE design_review_requests (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    engagement_control_id uuid NOT NULL,
    workpaper_id uuid NOT NULL,
    -- The design workpaper's prepared version when the request was sent.
    workpaper_version integer NOT NULL,
    reviewer_id uuid NOT NULL,
    sent_by uuid NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    message text NOT NULL DEFAULT '',
    reminded_at timestamptz,
    ended_at timestamptz,
    ended_by uuid,
    ended_as text,
    ended_reason text NOT NULL DEFAULT '',
    CONSTRAINT design_review_requests_version CHECK (workpaper_version >= 1),
    CONSTRAINT design_review_requests_message CHECK (char_length(message) <= 1000),
    CONSTRAINT design_review_requests_reminded CHECK (
        reminded_at IS NULL OR reminded_at >= sent_at
    ),
    CONSTRAINT design_review_requests_ended_as CHECK (
        ended_as IS NULL
        OR ended_as IN ('SIGNED', 'RETURNED', 'REASSIGNED', 'REOPENED', 'SUPERSEDED')
    ),
    -- Ended once, by a person, at or after it was sent; what stands names no ending.
    CONSTRAINT design_review_requests_ended CHECK (
        (ended_at IS NULL) = (ended_as IS NULL)
        AND (ended_at IS NULL) = (ended_by IS NULL)
        AND (ended_at IS NULL OR ended_at >= sent_at)
    ),
    -- A return gives the reviewer's reason (10 to 1,000); a reopening may carry its own (at
    -- most 1,000); the other endings, and a request that stands, carry none.
    CONSTRAINT design_review_requests_ended_reason CHECK (
        CASE
            WHEN ended_as = 'RETURNED' THEN
                char_length(btrim(ended_reason)) >= 10 AND char_length(ended_reason) <= 1000
            WHEN ended_as = 'REOPENED' THEN char_length(ended_reason) <= 1000
            ELSE ended_reason = ''
        END
    ),
    CONSTRAINT design_review_requests_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_review_requests_control_fk
        FOREIGN KEY (project_id, engagement_control_id)
        REFERENCES engagement_controls (project_id, id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_review_requests_workpaper_fk
        FOREIGN KEY (workpaper_id) REFERENCES workpapers (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_review_requests_reviewer_fk
        FOREIGN KEY (reviewer_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_review_requests_sent_by_fk
        FOREIGN KEY (sent_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT design_review_requests_ended_by_fk
        FOREIGN KEY (ended_by) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- One standing request per control.
CREATE UNIQUE INDEX design_review_requests_standing
    ON design_review_requests (project_id, engagement_control_id) WHERE ended_at IS NULL;
-- What waits for a reviewer (Home, and the count beside each name in the picker).
CREATE INDEX design_review_requests_waiting_idx
    ON design_review_requests (project_id, reviewer_id) WHERE ended_at IS NULL;
-- The reviewer a person last sent to on the engagement (the picker's default), and a
-- control's last return.
CREATE INDEX design_review_requests_sender_idx
    ON design_review_requests (project_id, sent_by, sent_at DESC);
CREATE INDEX design_review_requests_control_idx
    ON design_review_requests (project_id, engagement_control_id, sent_at DESC);
CREATE INDEX design_review_requests_workpaper_idx ON design_review_requests (workpaper_id);

-- A request is sent standing, never reminded yet, in its control's own engagement, for the
-- control's design workpaper while it is prepared at the version named. (A workpaper that
-- does not exist is refused by the foreign key.)
CREATE FUNCTION guard_design_review_request_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    paper record;
BEGIN
    SELECT w.organization_id, w.project_id, w.engagement_control_id, w.stage, w.status,
           w.prepared_version
    INTO paper
    FROM public.workpapers AS w
    WHERE w.id = NEW.workpaper_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF paper.organization_id IS DISTINCT FROM NEW.organization_id
        OR paper.project_id IS DISTINCT FROM NEW.project_id
        OR paper.engagement_control_id IS DISTINCT FROM NEW.engagement_control_id
        OR paper.stage IS DISTINCT FROM 'DESIGN'
    THEN
        RAISE EXCEPTION 'a D&I review request names its control''s design workpaper';
    END IF;
    IF paper.status IS DISTINCT FROM 'PREPARED'
        OR paper.prepared_version IS DISTINCT FROM NEW.workpaper_version
    THEN
        RAISE EXCEPTION 'a D&I review request is sent for the prepared version';
    END IF;
    IF NEW.ended_at IS NOT NULL OR NEW.ended_by IS NOT NULL OR NEW.ended_as IS NOT NULL
        OR NEW.ended_reason <> '' OR NEW.reminded_at IS NOT NULL
    THEN
        RAISE EXCEPTION 'a D&I review request is sent standing, not yet reminded';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER design_review_requests_sent
BEFORE INSERT ON design_review_requests
FOR EACH ROW EXECUTE FUNCTION guard_design_review_request_insert();

-- What a request records never changes. While it stands, only reminded_at moves, and only
-- forward; it ends once (the four ended_* columns, set together), and an ended request is
-- never changed.
CREATE FUNCTION guard_design_review_request_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'an ended D&I review request is never changed';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.engagement_control_id IS DISTINCT FROM OLD.engagement_control_id
        OR NEW.workpaper_id IS DISTINCT FROM OLD.workpaper_id
        OR NEW.workpaper_version IS DISTINCT FROM OLD.workpaper_version
        OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
        OR NEW.sent_by IS DISTINCT FROM OLD.sent_by
        OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
        OR NEW.message IS DISTINCT FROM OLD.message
    THEN
        RAISE EXCEPTION 'what a D&I review request records never changes';
    END IF;
    IF NEW.reminded_at IS DISTINCT FROM OLD.reminded_at AND (
        NEW.reminded_at IS NULL
        OR (OLD.reminded_at IS NOT NULL AND NEW.reminded_at <= OLD.reminded_at)
    ) THEN
        RAISE EXCEPTION 'a D&I review request''s reminder only moves forward';
    END IF;
    IF NEW.ended_at IS NOT NULL AND NEW.reminded_at IS DISTINCT FROM OLD.reminded_at THEN
        RAISE EXCEPTION 'a D&I review request is reminded or ended, not both at once';
    END IF;
    IF NEW.ended_at IS NULL AND NEW.reminded_at IS NOT DISTINCT FROM OLD.reminded_at THEN
        RAISE EXCEPTION 'a D&I review request changes only by a reminder or by ending';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER design_review_requests_guard
BEFORE UPDATE ON design_review_requests
FOR EACH ROW EXECUTE FUNCTION guard_design_review_request_update();

CREATE FUNCTION prevent_design_review_request_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'a D&I review request is ended, never deleted';
END;
$$;

CREATE TRIGGER design_review_requests_kept
BEFORE DELETE ON design_review_requests
FOR EACH ROW EXECUTE FUNCTION prevent_design_review_request_deletion();

-- An archived engagement's requests are read-only (migration 0136). This trigger fires
-- before the guards above (triggers of one event fire in name order), so a write there is
-- refused as archived.
CREATE TRIGGER design_review_requests_archived_guard
BEFORE INSERT OR UPDATE OR DELETE ON design_review_requests
FOR EACH ROW EXECUTE FUNCTION refuse_archived_writes();
