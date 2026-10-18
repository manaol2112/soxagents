-- A system with no SOC 1 report now gets the controls that apply to its kind recommended,
-- chosen by the scoping agent, instead of every general control; the rest of the library
-- is offered to add. Those systems are reviewed again for engagements not yet started.

UPDATE system_reviews AS r
SET review_status = 'PENDING', attempts = 0, version = r.version + 1
FROM engagement_applications AS a, engagement_settings AS s
WHERE a.id = r.application_id
  AND s.project_id = r.project_id
  AND s.kicked_off_at IS NULL
  AND r.review_status = 'IDLE'
  AND a.soc_expected IS NOT TRUE;
