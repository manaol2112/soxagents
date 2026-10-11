import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canManageAgents,
  canManageProjects,
  chosenOrganizationId,
  deriveShell,
  type Organization,
  type Project,
  statusChoices,
  taskStatusChoices,
  type WorkspaceSnapshot,
  workspaceHref,
} from "../apps/web/src/shell-model.ts";

const organization: Organization = {
  id: "11111111-1111-7111-8111-111111111111",
  name: "Acme",
  slug: "acme",
  role: "OWNER",
};

const other: Organization = {
  id: "22222222-2222-7222-8222-222222222222",
  name: "Beta",
  slug: "beta",
  role: "REVIEWER",
};

const project: Project = {
  id: "33333333-3333-7333-8333-333333333333",
  name: "SOX 2026",
  slug: "sox-2026",
  status: "ACTIVE",
};

function snapshot(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    meStatus: 200,
    me: { id: "user-1", email: "owner@example.com" },
    organizationsStatus: 200,
    organizations: [organization, other],
    projectsStatus: 200,
    projects: [project],
    requestedOrganizationId: organization.id,
    requestedProjectId: project.id,
    requestedSection: "overview",
    notifications: "empty",
    canManageProjects: false,
    members: [],
    projectDetail: null,
    notice: null,
    agentsStatus: 200,
    agents: [],
    requestedAgentId: null,
    agentDetail: null,
    tasksStatus: 200,
    tasks: [],
    requestedTaskId: null,
    taskDetail: null,
    canManageTasks: false,
    taskAssignees: [],
    agentInstances: [],
    ...overrides,
  };
}

describe("workspace shell", () => {
  it("asks an anonymous caller to sign in", () => {
    assert.equal(
      deriveShell(snapshot({ meStatus: 401, me: null })).status,
      "denied",
    );
  });

  it("treats a failed workspace load as unavailable", () => {
    assert.equal(
      deriveShell(snapshot({ meStatus: 0, me: null })).status,
      "error",
    );
    assert.equal(
      deriveShell(snapshot({ organizationsStatus: 503, organizations: null }))
        .status,
      "error",
    );
  });

  it("shows an empty state when the caller has no organization", () => {
    const model = deriveShell(snapshot({ organizations: [] }));
    assert.deepEqual(model, { status: "empty", email: "owner@example.com" });
  });

  it("ignores an organization or project the caller cannot access", () => {
    const model = deriveShell(
      snapshot({
        requestedOrganizationId: "99999999-9999-7999-8999-999999999999",
        requestedProjectId: "88888888-8888-7888-8888-888888888888",
        requestedSection: "billing",
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status !== "ready") {
      return;
    }
    assert.equal(model.organization.id, organization.id);
    assert.equal(model.selectedProject?.id, project.id);
    // An unknown section falls back to the engagement's home, the agent console.
    assert.equal(model.section, "console");
  });

  it("keeps a requested organization that is in the membership list", () => {
    const chosen = chosenOrganizationId([organization, other], other.id);
    assert.equal(chosen, other.id);
    const model = deriveShell(
      snapshot({
        requestedOrganizationId: other.id,
        requestedSection: "tasks",
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status !== "ready") {
      return;
    }
    assert.equal(model.organization.id, other.id);
    assert.equal(model.section, "tasks");
    assert.equal(
      workspaceHref("projects", other.id, project.id),
      `/?organization=${other.id}&project=${project.id}&section=projects`,
    );
  });

  it("offers only legal project status changes", () => {
    assert.deepEqual(statusChoices("ACTIVE"), ["ACTIVE", "PAUSED", "ARCHIVED"]);
    assert.deepEqual(statusChoices("ARCHIVED"), ["ARCHIVED"]);
    assert.deepEqual(taskStatusChoices("CANCELLED"), ["CANCELLED"]);
    assert.equal(taskStatusChoices("RUNNING").includes("DRAFT"), false);
    assert.equal(canManageProjects("PROJECT_MANAGER"), true);
    assert.equal(canManageProjects("REVIEWER"), false);
    assert.equal(canManageAgents("OWNER"), true);
    assert.equal(canManageAgents("ADMIN"), true);
    assert.equal(canManageAgents("PROJECT_MANAGER"), false);
    assert.equal(canManageAgents("CONTRIBUTOR"), false);
  });

  it("shows an agent that belongs to the organization", () => {
    const agent = {
      id: "44444444-4444-7444-8444-444444444444",
      agent_key: "evidence-request",
      name: "Evidence request",
      role: "Requests population files",
      status: "ACTIVE",
    };
    const model = deriveShell(
      snapshot({
        requestedSection: "agents",
        requestedAgentId: agent.id,
        agents: [agent],
        agentDetail: {
          ...agent,
          description: "Asks for the listed evidence.",
          revision: 1,
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          allowed_tool_ids: ["mail.draft"],
          model_config_ref: "audit-model",
          max_iterations: 4,
          time_budget_seconds: 600,
          version: 1,
        },
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status !== "ready") {
      return;
    }
    assert.equal(model.selectedAgent?.name, "Evidence request");
    assert.equal(model.canManageAgents, true);
    assert.equal(model.agentDetail?.revision, 1);
    const hidden = deriveShell(
      snapshot({
        requestedSection: "agents",
        requestedAgentId: "55555555-5555-7555-8555-555555555555",
        agents: [agent],
      }),
    );
    if (hidden.status === "ready") {
      assert.equal(hidden.selectedAgent, null);
    }
  });

  it("keeps project tasks on the overview", () => {
    const model = deriveShell(
      snapshot({
        requestedSection: "overview",
        tasks: [
          {
            id: "44444444-4444-7444-8444-444444444444",
            title: "Collect population",
            status: "BLOCKED",
            priority: "HIGH",
            deadline: "2026-12-01T00:00:00Z",
            assignee_name: null,
          },
        ],
      }),
    );
    assert.equal(model.status, "ready");
    if (model.status === "ready") {
      assert.equal(model.tasks[0]?.status, "BLOCKED");
      assert.equal(model.taskDetail, null);
    }
  });

  it("can show that notifications are unavailable", () => {
    const model = deriveShell(snapshot({ notifications: "unavailable" }));
    assert.equal(model.status, "ready");
    if (model.status === "ready") {
      assert.equal(model.notifications, "unavailable");
    }
  });
});
