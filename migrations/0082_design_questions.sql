-- Design questions that quoted the library's own versions. Authentication settings are
-- the configuration, so that question is settled. The others are restated as what the
-- reviewer actually confirms. Decided by the product owner.
--
-- Rollback: these rows are not restored. Delete the '0082_design_questions' row from
-- schema_migrations.

UPDATE control_context_issues AS issue
SET status = 'RESOLVED',
    resolution_note = $note$Authentication settings are the control. They are tested as a configuration: each configured value against the security policy, and the change history for the period. An annual review of the settings, if the client also performs one, is a separate control.$note$,
    resolved_at = clock_timestamp(),
    version = issue.version + 1,
    updated_at = clock_timestamp()
FROM engagement_controls AS control
WHERE issue.engagement_control_id = control.id
  AND issue.status = 'OPEN'
  AND issue.topic = 'Control design to confirm'
  AND control.library_key = 'access-authentication';

UPDATE control_context_issues AS issue
SET detail = $detail$This control is the quarterly review of who has privileged access, done by someone who does not hold that access. Granting privileged access is a different control. Confirm that the client relies on this review, which layers are in scope (application, database, and operating system), and how the client defines privileged access.$detail$,
    version = issue.version + 1,
    updated_at = clock_timestamp()
FROM engagement_controls AS control
WHERE issue.engagement_control_id = control.id
  AND issue.status = 'OPEN'
  AND issue.topic = 'Control design to confirm'
  AND control.library_key = 'access-privileged'
  AND issue.detail LIKE 'Version %';

UPDATE control_context_issues AS issue
SET detail = $detail$This control is the quarterly review of who can deploy changes to production. The restriction on deployment access is set through user access. Confirm that the client performs this quarterly review.$detail$,
    version = issue.version + 1,
    updated_at = clock_timestamp()
FROM engagement_controls AS control
WHERE issue.engagement_control_id = control.id
  AND issue.status = 'OPEN'
  AND issue.topic = 'Control design to confirm'
  AND control.library_key = 'change-segregation'
  AND issue.detail LIKE 'Version %';
