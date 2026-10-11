-- Staffing an engagement adds each agent definition once. Repeating it adds nothing.

ALTER TABLE agent_instances
    ADD CONSTRAINT agent_instances_project_definition_key
    UNIQUE (project_id, agent_definition_id);
