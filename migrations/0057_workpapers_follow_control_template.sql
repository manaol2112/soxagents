-- A workpaper record opened before one-template-per-control still names a design or
-- effectiveness template that no longer exists. It follows its control's template now,
-- as every record does from here on (the drafting reads the control's template).

UPDATE workpapers w
SET template_key = c.template_key
FROM engagement_controls c
WHERE c.id = w.engagement_control_id AND w.template_key <> c.template_key;
