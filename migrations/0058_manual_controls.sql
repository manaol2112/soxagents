-- A control the team writes itself, when neither the library nor the client's RCM has
-- it: a business process control, a key report, or a control for one system.

ALTER TABLE engagement_controls DROP CONSTRAINT engagement_controls_source;
ALTER TABLE engagement_controls ADD CONSTRAINT engagement_controls_source CHECK (
    source IN ('LIBRARY', 'UPLOAD', 'AGENT', 'MANUAL')
);
