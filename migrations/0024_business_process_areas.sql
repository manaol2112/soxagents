-- Business process areas. An engagement control can belong to an IT general control
-- area, application controls, key reports, entity-level controls, or a business cycle.
-- The list matches DOMAIN_LABELS in services/api/ai_workforce_api/controls.py.

ALTER TABLE engagement_controls DROP CONSTRAINT engagement_controls_domain;
ALTER TABLE engagement_controls ADD CONSTRAINT engagement_controls_domain CHECK (
    domain IN (
        'ACCESS', 'CHANGE', 'OPERATIONS', 'ITAC', 'IPE', 'ENTITY', 'ORDER_TO_CASH',
        'PROCURE_TO_PAY', 'RECORD_TO_REPORT', 'TREASURY', 'HIRE_TO_RETIRE', 'INVENTORY',
        'FIXED_ASSETS', 'TAX', 'OTHER_BUSINESS'
    )
);
