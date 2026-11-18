-- Reviewing a vendor's SOC 1 report is an entity-level control, covered with the ELCs.
--
-- The scoping agent no longer recommends a SOC report review for each system. The ones
-- still waiting for a decision are withdrawn; decided ones stay on record.

DELETE FROM system_recommendations
WHERE kind = 'ADD_SOC_REVIEW' AND status = 'PROPOSED';
