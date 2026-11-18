-- A system the client runs, with no SOC 1 report, has its own general controls
-- recommended: access, change, and operations. Reviews of those systems that finished
-- before this ran again, for engagements not yet started, so the team can choose them.

UPDATE system_reviews AS r
SET review_status = 'PENDING', attempts = 0, version = r.version + 1
FROM engagement_applications AS a, engagement_settings AS s
WHERE a.id = r.application_id
  AND s.project_id = r.project_id
  AND s.kicked_off_at IS NULL
  AND r.review_status = 'IDLE'
  AND a.soc_expected IS NOT TRUE;
