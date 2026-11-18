-- Systems added before the scoping review existed get one too. Each is queued for the
-- scoping agent, on behalf of its engagement's owner, and the worker picks them up when
-- it starts. Started engagements are left as they are.

INSERT INTO system_reviews (application_id, organization_id, project_id, requested_by)
SELECT a.id, a.organization_id, a.project_id, p.owner_user_id
FROM engagement_applications AS a
JOIN projects AS p ON p.id = a.project_id AND p.organization_id = a.organization_id
JOIN engagement_settings AS s ON s.project_id = a.project_id
WHERE s.kicked_off_at IS NULL
  AND p.owner_user_id IS NOT NULL
ON CONFLICT (application_id) DO NOTHING;
