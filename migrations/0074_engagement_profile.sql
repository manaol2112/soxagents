-- The engagement profile, completed.
--
-- 1. The audit period has a start as well as an end, the client's fiscal year is named in
--    its own words ("FY2027"), the audit methodology is chosen (it decides that reviewer
--    independence is required; only the development override switches that off), and the
--    reporting objectives are written down.
-- 2. When the period end disagrees with the engagement's name, its scope narrative, or its
--    fiscal year, a person confirms the period as recorded, or corrects it. The
--    confirmation keeps who, when, and what it was checked against (a fingerprint of the
--    name, scope, period, and fiscal year), so any later change to them asks again.
--    Nothing here changes a date on its own.

ALTER TABLE engagement_settings
    ADD COLUMN period_start date,
    ADD COLUMN fiscal_year text NOT NULL DEFAULT '',
    ADD COLUMN methodology text,
    ADD COLUMN reporting_objectives text NOT NULL DEFAULT '',
    ADD COLUMN period_confirmed_at timestamptz,
    ADD COLUMN period_confirmed_by uuid REFERENCES users (id),
    ADD COLUMN period_confirmed_basis text NOT NULL DEFAULT '',
    ADD CONSTRAINT engagement_settings_period_order CHECK (
        period_start IS NULL OR period_end IS NULL OR period_start < period_end
    ),
    ADD CONSTRAINT engagement_settings_fiscal_year CHECK (char_length(fiscal_year) <= 20),
    ADD CONSTRAINT engagement_settings_methodology CHECK (
        methodology IS NULL OR methodology IN ('EXTERNAL_ICFR', 'MANAGEMENT_404', 'INTERNAL_AUDIT')
    ),
    ADD CONSTRAINT engagement_settings_objectives CHECK (char_length(reporting_objectives) <= 2000),
    ADD CONSTRAINT engagement_settings_period_confirmed CHECK (
        (period_confirmed_at IS NULL) = (period_confirmed_by IS NULL)
        AND (period_confirmed_at IS NULL) = (period_confirmed_basis = '')
        AND char_length(period_confirmed_basis) <= 64
    );
