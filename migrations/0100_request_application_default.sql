-- A file uploaded to a request takes the application of the request's control instance
-- when the evidence coordinator could not tell which application the file shows (by the
-- product owner's decision, 22 Oct 2026). Each instance of a control is for one
-- application, so its request is too; testing already placed such a file on that
-- instance (testing_engine.place_by_application), and the tag now says the same.
--
-- Earlier files the coordinator left UNKNOWN on an instance's request take that
-- application now. A person's tag, a file tagged with one application or all of them,
-- and a file on a control that is not one application's instance are left as they are.

UPDATE evidence_file_applications AS t
SET scope = 'ONE',
    engagement_application_id = c.engagement_application_id,
    reason = left('Uploaded to the request for ' || a.name || '.', 300),
    version = t.version + 1
FROM evidence_file_links AS l
JOIN pbc_requests AS r
  ON r.id = l.pbc_request_id AND r.project_id = l.project_id
JOIN engagement_controls AS c
  ON c.id = r.engagement_control_id AND c.project_id = r.project_id
JOIN engagement_applications AS a
  ON a.id = c.engagement_application_id AND a.project_id = c.project_id
WHERE l.evidence_file_id = t.evidence_file_id
  AND l.project_id = t.project_id
  AND t.tagged_by = 'AGENT'
  AND t.scope = 'UNKNOWN';
