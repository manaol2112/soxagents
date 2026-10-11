import { cookies } from "next/headers";

import {
  agentIdInList,
  chosenOrganizationId,
  deriveShell,
  parseAssignableMembers,
  parseProjectDetail,
  projectIdInList,
  type ShellModel,
} from "./shell-model";

const SESSION_TOKEN = /^[A-Za-z0-9_-]+$/;

export type WorkspaceRequest = {
  organizationId: string | null;
  projectId: string | null;
  agentId: string | null;
  taskId: string | null;
  section: string | null;
  notice: string | null;
};

export async function loadWorkspace(
  request: WorkspaceRequest,
): Promise<ShellModel> {
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const me = await apiGet("/auth/me", session);
  const organizations = await apiGet("/organizations", session);
  const organizationId = chosenOrganizationId(
    organizations.body,
    request.organizationId,
  );
  const projects =
    organizationId === null
      ? { status: 200, body: [] }
      : await apiGet(`/organizations/${organizationId}/projects`, session);
  const visibleProjectId = projectIdInList(projects.body, request.projectId);
  const agents = await loadAgents(
    session,
    organizationId,
    request.section,
    request.agentId,
  );
  const taskWork = await loadTaskManagement(
    session,
    organizationId,
    request.section,
    visibleProjectId,
    request.taskId,
  );
  const management = await loadProjectManagement(
    session,
    organizationId,
    request.section,
    projects.body,
    visibleProjectId,
  );
  if (management === "error") {
    return deriveShell({
      meStatus: me.status,
      me: me.body,
      organizationsStatus: organizations.status,
      organizations: organizations.body,
      projectsStatus: 0,
      projects: null,
      requestedOrganizationId: organizationId,
      requestedProjectId: visibleProjectId,
      requestedSection: request.section,
      notifications: "empty",
      canManageProjects: false,
      members: [],
      projectDetail: null,
      notice: request.notice,
      agentsStatus: agents.status,
      agents: agents.body,
      requestedAgentId: request.agentId,
      agentDetail: agents.detail,
      tasksStatus: taskWork.status,
      tasks: taskWork.body,
      requestedTaskId: request.taskId,
      taskDetail: taskWork.detail,
      canManageTasks: taskWork.canManage,
      taskAssignees: taskWork.assignees,
      agentInstances: taskWork.instances,
    });
  }
  return deriveShell({
    meStatus: me.status,
    me: me.body,
    organizationsStatus: organizations.status,
    organizations: organizations.body,
    projectsStatus: projects.status,
    projects: projects.body,
    requestedOrganizationId: organizationId,
    requestedProjectId: visibleProjectId,
    requestedSection: request.section,
    notifications: "empty",
    canManageProjects: management.canManageProjects,
    members: management.members,
    projectDetail: management.projectDetail,
    notice: request.notice,
    agentsStatus: agents.status,
    agents: agents.body,
    requestedAgentId: request.agentId,
    agentDetail: agents.detail,
    tasksStatus: taskWork.status,
    tasks: taskWork.body,
    requestedTaskId: request.taskId,
    taskDetail: taskWork.detail,
    canManageTasks: taskWork.canManage,
    taskAssignees: taskWork.assignees,
    agentInstances: taskWork.instances,
  });
}

async function loadTaskManagement(
  session: string | undefined,
  organizationId: string | null,
  section: string | null,
  projectId: string | null,
  requestedTaskId: string | null,
): Promise<{
  status: number;
  body: unknown;
  detail: unknown;
  canManage: boolean;
  assignees: unknown;
  instances: unknown;
}> {
  if (
    organizationId === null ||
    projectId === null ||
    (section !== "tasks" && section !== "overview")
  ) {
    return {
      status: 200,
      body: [],
      detail: null,
      canManage: false,
      assignees: [],
      instances: [],
    };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}`;
  const listed = await apiGet(`${base}/tasks`, session);
  if (section === "overview") {
    return {
      status: listed.status,
      body: listed.body,
      detail: null,
      canManage: false,
      assignees: [],
      instances: [],
    };
  }
  if (listed.status !== 200) {
    return {
      status: listed.status,
      body: listed.body,
      detail: null,
      canManage: false,
      assignees: [],
      instances: [],
    };
  }
  const assignees = await apiGet(`${base}/task-assignees`, session);
  if (assignees.status !== 200 && assignees.status !== 403) {
    return {
      status: 0,
      body: null,
      detail: null,
      canManage: false,
      assignees: [],
      instances: [],
    };
  }
  const instances = await apiGet(`${base}/agent-instances`, session);
  if (instances.status !== 200) {
    return {
      status: 0,
      body: null,
      detail: null,
      canManage: false,
      assignees: [],
      instances: [],
    };
  }
  const taskId = taskIdInList(listed.body, requestedTaskId);
  if (taskId === null) {
    return {
      status: 200,
      body: listed.body,
      detail: null,
      canManage: assignees.status === 200,
      assignees: assignees.body,
      instances: instances.body,
    };
  }
  const detail = await apiGet(`${base}/tasks/${taskId}`, session);
  if (detail.status !== 200) {
    return {
      status: 0,
      body: null,
      detail: null,
      canManage: false,
      assignees: [],
      instances: [],
    };
  }
  return {
    status: 200,
    body: listed.body,
    detail: detail.body,
    canManage: assignees.status === 200,
    assignees: assignees.body,
    instances: instances.body,
  };
}

function taskIdInList(value: unknown, requested: string | null): string | null {
  if (requested === null || !Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      item.id === requested
    ) {
      return requested;
    }
  }
  return null;
}

async function loadAgents(
  session: string | undefined,
  organizationId: string | null,
  section: string | null,
  requestedAgentId: string | null,
): Promise<{ status: number; body: unknown; detail: unknown }> {
  if (organizationId === null || section !== "agents") {
    return { status: 200, body: [], detail: null };
  }
  const listed = await apiGet(
    `/organizations/${organizationId}/agents`,
    session,
  );
  if (listed.status !== 200) {
    return { status: listed.status, body: listed.body, detail: null };
  }
  const agentId = agentIdInList(listed.body, requestedAgentId);
  if (agentId === null) {
    return { status: 200, body: listed.body, detail: null };
  }
  const detail = await apiGet(
    `/organizations/${organizationId}/agents/${agentId}`,
    session,
  );
  if (detail.status !== 200) {
    return { status: 0, body: null, detail: null };
  }
  return { status: 200, body: listed.body, detail: detail.body };
}

async function loadProjectManagement(
  session: string | undefined,
  organizationId: string | null,
  section: string | null,
  projectsBody: unknown,
  requestedProjectId: string | null,
): Promise<
  | {
      canManageProjects: boolean;
      members: ReturnType<typeof parseAssignableMembers> & object;
      projectDetail: ReturnType<typeof parseProjectDetail>;
    }
  | "error"
> {
  if (
    organizationId === null ||
    (section !== "projects" && section !== "overview")
  ) {
    return { canManageProjects: false, members: [], projectDetail: null };
  }
  if (section === "overview") {
    const overviewProjectId = projectIdInList(projectsBody, requestedProjectId);
    if (overviewProjectId === null) {
      return { canManageProjects: false, members: [], projectDetail: null };
    }
    const overviewDetail = await apiGet(
      `/organizations/${organizationId}/projects/${overviewProjectId}`,
      session,
    );
    if (overviewDetail.status !== 200) {
      return "error";
    }
    const overviewProject = parseProjectDetail(overviewDetail.body);
    if (overviewProject === null) {
      return "error";
    }
    return {
      canManageProjects: false,
      members: [],
      projectDetail: overviewProject,
    };
  }
  const membersResponse = await apiGet(
    `/organizations/${organizationId}/assignable-members`,
    session,
  );
  let canManageProjects = false;
  let members: NonNullable<ReturnType<typeof parseAssignableMembers>> = [];
  if (membersResponse.status === 200) {
    const parsed = parseAssignableMembers(membersResponse.body);
    if (parsed === null) {
      return "error";
    }
    canManageProjects = true;
    members = parsed;
  } else if (membersResponse.status !== 403) {
    return "error";
  }
  const projectId = projectIdInList(projectsBody, requestedProjectId);
  if (projectId === null) {
    return { canManageProjects, members, projectDetail: null };
  }
  const detailResponse = await apiGet(
    `/organizations/${organizationId}/projects/${projectId}`,
    session,
  );
  if (detailResponse.status !== 200) {
    return "error";
  }
  const projectDetail = parseProjectDetail(detailResponse.body);
  if (projectDetail === null) {
    return "error";
  }
  return { canManageProjects, members, projectDetail };
}

export function apiBaseUrl(): string {
  const configured = process.env.API_BASE_URL?.trim() ?? "";
  if (configured !== "") {
    return configured.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8000";
}

export function sessionToken(value: string | undefined): string | undefined {
  if (value === undefined || !SESSION_TOKEN.test(value)) {
    return undefined;
  }
  return value;
}

export async function apiGet(
  path: string,
  session: string | undefined,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers();
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (response.status !== 200) {
      return { status: response.status, body: null };
    }
    return { status: 200, body: (await response.json()) as unknown };
  } catch {
    return { status: 0, body: null };
  }
}
