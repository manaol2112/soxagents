-- Release 2b-1: grouped evidence requests (decided by the product owner, Option 1;
-- docs/release-2b.md).
--
-- A grouped request wraps the per-control requests one person receives for one phase:
-- one approval action, one email, one reminder workflow. The per-control requests stay
-- authoritative for requirements, receipts, and testing, and each is approved through the
-- existing approval engine. Until a person approves it, a group is only a proposal
-- computed from untouched agent drafts (evidence_groups.py) and is not stored; these
-- tables hold what was approved and what happened to it.
--
-- 1. evidence_request_groups: one approved group, its lead request (whose approval the
--    single outbound message is recorded against), and its delivery status: APPROVED
--    (awaiting the provider), SENT, or NOT_SENT (refused or expired; its requests return
--    to draft). Only the status moves, and only forward.
-- 2. evidence_request_group_members: the requests in it, each with its own approval and
--    the request version that approval left it at. Frozen; a request is in at most one
--    group that is still in effect, and leaves it only when the group is not sent.
-- 3. evidence_group_approvals: the immutable record of exactly what was approved: the
--    members, their requirements with their specification fingerprints, versions and plan
--    revisions, the recipient, the people copied, the subject, and the content digest.
--
-- Nothing here changes a request that is not in a group.
--
-- Rollback: DROP TABLE evidence_group_approvals; DROP TABLE evidence_request_group_members;
-- DROP TABLE evidence_request_groups; DROP FUNCTION guard_evidence_request_group();
-- DROP FUNCTION guard_evidence_request_group_member(); delete the
-- '0107_evidence_request_groups' row from schema_migrations. Only before any group is
-- sent: a sent group is part of the audit trail.

CREATE TABLE evidence_request_groups (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'APPROVED',
    lead_request_id uuid NOT NULL REFERENCES pbc_requests (id) ON DELETE RESTRICT,
    lead_approval_id uuid NOT NULL REFERENCES approvals (id) ON DELETE RESTRICT,
    recipient text NOT NULL,
    testing_phase text,
    reason text NOT NULL DEFAULT '',
    approved_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    sent_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT evidence_request_groups_status CHECK (status IN ('APPROVED', 'SENT', 'NOT_SENT')),
    CONSTRAINT evidence_request_groups_reason CHECK (
        (status = 'NOT_SENT' AND reason IN (
            'delivery_failed', 'approval_expired', 'changed_since_approval'
        ))
        OR (status <> 'NOT_SENT' AND reason = '')
    ),
    CONSTRAINT evidence_request_groups_sent CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
    CONSTRAINT evidence_request_groups_recipient CHECK (char_length(recipient) BETWEEN 3 AND 200),
    CONSTRAINT evidence_request_groups_version CHECK (version >= 1),
    CONSTRAINT evidence_request_groups_approval_key UNIQUE (lead_approval_id),
    CONSTRAINT evidence_request_groups_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX evidence_request_groups_project_idx
    ON evidence_request_groups (project_id, status);

CREATE FUNCTION guard_evidence_request_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'evidence request groups cannot be deleted';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.lead_request_id IS DISTINCT FROM OLD.lead_request_id
        OR NEW.lead_approval_id IS DISTINCT FROM OLD.lead_approval_id
        OR NEW.recipient IS DISTINCT FROM OLD.recipient
        OR NEW.testing_phase IS DISTINCT FROM OLD.testing_phase
        OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    THEN
        RAISE EXCEPTION 'an approved evidence request group is immutable';
    END IF;
    IF OLD.status <> 'APPROVED' OR NEW.status NOT IN ('SENT', 'NOT_SENT') THEN
        RAISE EXCEPTION 'evidence request group status moves only from approved';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'evidence request group update is invalid';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_request_groups_guard
    BEFORE UPDATE OR DELETE ON evidence_request_groups
    FOR EACH ROW EXECUTE FUNCTION guard_evidence_request_group();

CREATE TABLE evidence_request_group_members (
    group_id uuid NOT NULL REFERENCES evidence_request_groups (id) ON DELETE RESTRICT,
    pbc_request_id uuid NOT NULL REFERENCES pbc_requests (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    position integer NOT NULL,
    approval_id uuid NOT NULL REFERENCES approvals (id) ON DELETE RESTRICT,
    -- The request's version once its approval moved it to awaiting sending.
    request_version integer NOT NULL,
    released_at timestamptz,
    PRIMARY KEY (group_id, pbc_request_id),
    CONSTRAINT evidence_request_group_members_position CHECK (position >= 1),
    CONSTRAINT evidence_request_group_members_version CHECK (request_version >= 1),
    CONSTRAINT evidence_request_group_members_approval_key UNIQUE (approval_id),
    CONSTRAINT evidence_request_group_members_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- A request is in at most one group still in effect.
CREATE UNIQUE INDEX evidence_request_group_members_request_key
    ON evidence_request_group_members (pbc_request_id) WHERE released_at IS NULL;

CREATE FUNCTION guard_evidence_request_group_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'evidence request group members cannot be deleted';
    END IF;
    IF NEW.group_id IS DISTINCT FROM OLD.group_id
        OR NEW.pbc_request_id IS DISTINCT FROM OLD.pbc_request_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.position IS DISTINCT FROM OLD.position
        OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
        OR NEW.request_version IS DISTINCT FROM OLD.request_version
        OR OLD.released_at IS NOT NULL
        OR NEW.released_at IS NULL
    THEN
        RAISE EXCEPTION 'evidence request group membership is frozen';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_request_group_members_guard
    BEFORE UPDATE OR DELETE ON evidence_request_group_members
    FOR EACH ROW EXECUTE FUNCTION guard_evidence_request_group_member();

CREATE TABLE evidence_group_approvals (
    group_id uuid PRIMARY KEY REFERENCES evidence_request_groups (id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    approved_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    decision_reason text NOT NULL,
    recipient text NOT NULL,
    cc jsonb NOT NULL,
    subject text NOT NULL,
    content_sha256 text NOT NULL,
    template_id text NOT NULL,
    template_version integer NOT NULL,
    sensitivity text NOT NULL,
    -- Each member: request, version, approval, control, due date, and its requirements
    -- with their versions, specification fingerprints, and plan revisions.
    members jsonb NOT NULL,
    CONSTRAINT evidence_group_approvals_reason CHECK (
        char_length(btrim(decision_reason)) BETWEEN 1 AND 500
    ),
    CONSTRAINT evidence_group_approvals_cc CHECK (jsonb_typeof(cc) = 'array'),
    CONSTRAINT evidence_group_approvals_subject CHECK (char_length(subject) BETWEEN 1 AND 200),
    CONSTRAINT evidence_group_approvals_content CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_group_approvals_sensitivity CHECK (sensitivity IN ('STANDARD', 'PERSONAL')),
    CONSTRAINT evidence_group_approvals_members CHECK (
        jsonb_typeof(members) = 'array' AND jsonb_array_length(members) >= 2
    ),
    CONSTRAINT evidence_group_approvals_project_fk
        FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER evidence_group_approvals_immutable
    BEFORE UPDATE OR DELETE ON evidence_group_approvals
    FOR EACH ROW EXECUTE FUNCTION reject_plan_record_change();
