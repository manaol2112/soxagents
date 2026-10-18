-- Engagement reports (Milestone 8.21).
--
-- Besides record exports (8.20), the agent console makes reports from the same records:
-- the engagement status report, the pending evidence tracker, the control testing
-- summary, the exceptions and remediation report, and the executive summary, as PDF or
-- Word. They are stored, kept, downloaded, and audited exactly as exports are.

ALTER TABLE engagement_exports DROP CONSTRAINT engagement_exports_dataset;
ALTER TABLE engagement_exports ADD CONSTRAINT engagement_exports_dataset CHECK (
    dataset IN (
        'evidence_requests', 'controls', 'exceptions', 'review_items',
        'status_report', 'evidence_tracker', 'control_summary', 'exceptions_report',
        'executive_summary'
    )
);

ALTER TABLE engagement_exports DROP CONSTRAINT engagement_exports_format;
ALTER TABLE engagement_exports ADD CONSTRAINT engagement_exports_format CHECK (
    file_format IN ('xlsx', 'csv', 'pdf', 'docx')
);

-- A report the agent wrote a narrative for keeps it, so the file can be traced to what
-- was AI-written and what came from the records.
ALTER TABLE engagement_exports ADD COLUMN narrative text NOT NULL DEFAULT '';
ALTER TABLE engagement_exports ADD CONSTRAINT engagement_exports_narrative CHECK (
    char_length(narrative) <= 4000
);
