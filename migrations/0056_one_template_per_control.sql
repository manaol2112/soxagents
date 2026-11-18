-- A control documents design, interim testing, and the roll-forward in one workbook, so
-- it refers to one template instead of a design and an effectiveness one. Existing
-- controls take the standard template for their area.

ALTER TABLE engagement_controls ADD COLUMN template_key text NOT NULL DEFAULT '';

UPDATE engagement_controls
SET template_key = CASE
    WHEN domain IN ('ACCESS', 'CHANGE', 'OPERATIONS') THEN 'itgc'
    WHEN domain = 'ITAC' THEN 'itac'
    WHEN domain = 'IPE' THEN 'key-report'
    ELSE 'business'
END;

ALTER TABLE engagement_controls
    ALTER COLUMN template_key DROP DEFAULT,
    ADD CONSTRAINT engagement_controls_template CHECK (char_length(template_key) BETWEEN 1 AND 60),
    DROP COLUMN design_template_key,
    DROP COLUMN effectiveness_template_key;
