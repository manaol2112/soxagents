export const SECTIONS = [
  "console",
  "overview",
  "projects",
  "agents",
  "tasks",
  "evidence",
  "approvals",
  "setup",
  "controls",
  "plan",
  "timeline",
  "deficiencies",
] as const;

export type SectionId = (typeof SECTIONS)[number];

export type SessionUser = {
  id: string;
  email: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type AssignableMember = {
  id: string;
  displayName: string;
};

export type ProjectProgress = {
  status: string;
  count: number;
};

export type ProjectActivity = {
  action: string;
  occurredAt: string;
  actorName: string;
};

export type ProjectDetail = {
  id: string;
  name: string;
  slug: string;
  scope: string;
  ownerUserId: string;
  ownerName: string;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  version: number;
  progress: ProjectProgress[];
  activity: ProjectActivity[];
};

export type AgentSource = "custom" | "standard";

export type AgentSummary = {
  id: string;
  agentKey: string;
  name: string;
  role: string;
  status: string;
  source: AgentSource;
};

export type AgentDetail = {
  id: string;
  agentKey: string;
  name: string;
  role: string;
  description: string;
  revision: number;
  inputSchema: string;
  outputSchema: string;
  allowedToolIds: string[];
  modelConfigRef: string;
  maxIterations: number;
  timeBudgetSeconds: number;
  status: string;
  version: number;
  source: AgentSource;
};

export type ProjectNotice =
  | "saved"
  | "invalid"
  | "conflict"
  | "slug"
  | "status"
  | "denied"
  | "unavailable";

export type AgentNotice =
  | "saved"
  | "invalid"
  | "conflict"
  | "key"
  | "status"
  | "denied"
  | "unavailable"
  | "secret"
  | "locked"
  | "reserved"
  | "ocr-saved"
  | "ocr-changed";

export type TaskSummary = {
  id: string;
  title: string;
  status: string;
  priority: string;
  deadline: string | null;
  assigneeName: string | null;
};

export type TaskActivity = {
  action: string;
  occurredAt: string;
  actorName: string;
};

export type TaskDetail = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  deadline: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  agentInstanceId: string | null;
  retryCount: number;
  maxRetries: number;
  blocker: string;
  escalation: string;
  cancellationReason: string;
  artifactRefs: string[];
  version: number;
  dependsOn: string[];
  activity: TaskActivity[];
};

export type AgentInstanceChoice = {
  id: string;
  name: string;
  definitionStatus: string;
  status: string;
};

export type TaskNotice =
  | "saved"
  | "invalid"
  | "conflict"
  | "status"
  | "denied"
  | "unavailable"
  | "dependency"
  | "agent"
  | "retry";

export type ShellModel =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error" }
  | { status: "empty"; email: string }
  | {
      status: "ready";
      email: string;
      organizations: Organization[];
      organization: Organization;
      projects: Project[];
      selectedProject: Project | null;
      section: SectionId;
      notifications: "empty" | "unavailable";
      canManageProjects: boolean;
      members: AssignableMember[];
      projectDetail: ProjectDetail | null;
      notice: ProjectNotice | null;
      canManageAgents: boolean;
      agents: AgentSummary[];
      selectedAgent: AgentSummary | null;
      agentDetail: AgentDetail | null;
      agentNotice: AgentNotice | null;
      canManageTasks: boolean;
      tasks: TaskSummary[];
      selectedTask: TaskSummary | null;
      taskDetail: TaskDetail | null;
      taskAssignees: AssignableMember[];
      agentInstances: AgentInstanceChoice[];
      taskNotice: TaskNotice | null;
    };

export type WorkspaceSnapshot = {
  meStatus: number;
  me: unknown;
  organizationsStatus: number;
  organizations: unknown;
  projectsStatus: number;
  projects: unknown;
  requestedOrganizationId: string | null;
  requestedProjectId: string | null;
  requestedSection: string | null;
  notifications: "empty" | "unavailable";
  canManageProjects: boolean;
  members: AssignableMember[];
  projectDetail: ProjectDetail | null;
  notice: string | null;
  agentsStatus: number;
  agents: unknown;
  requestedAgentId: string | null;
  agentDetail: unknown;
  tasksStatus: number;
  tasks: unknown;
  requestedTaskId: string | null;
  taskDetail: unknown;
  canManageTasks: boolean;
  taskAssignees: unknown;
  agentInstances: unknown;
};

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  PROJECT_MANAGER: "Project manager",
  REVIEWER: "Reviewer",
  CONTRIBUTOR: "Contributor",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "Member";
}

export function chosenOrganizationId(
  value: unknown,
  requested: string | null,
): string | null {
  const organizations = parseOrganizations(value);
  if (organizations === null || organizations.length === 0) {
    return null;
  }
  return (
    (organizations.find((item) => item.id === requested) ?? organizations[0])
      ?.id ?? null
  );
}

export function deriveShell(snapshot: WorkspaceSnapshot): ShellModel {
  if (isDenied(snapshot.meStatus)) {
    return { status: "denied" };
  }
  const user = parseUser(snapshot.me);
  if (!isOk(snapshot.meStatus) || user === null) {
    return { status: "error" };
  }
  if (isDenied(snapshot.organizationsStatus)) {
    return { status: "denied" };
  }
  const organizations = parseOrganizations(snapshot.organizations);
  if (!isOk(snapshot.organizationsStatus) || organizations === null) {
    return { status: "error" };
  }
  if (organizations.length === 0) {
    return { status: "empty", email: user.email };
  }
  const organization =
    organizations.find(
      (item) => item.id === snapshot.requestedOrganizationId,
    ) ?? organizations[0];
  if (organization === undefined) {
    return { status: "error" };
  }
  if (isDenied(snapshot.projectsStatus)) {
    return { status: "denied" };
  }
  const projects = parseProjects(snapshot.projects);
  if (!isOk(snapshot.projectsStatus) || projects === null) {
    return { status: "error" };
  }
  const selectedProject =
    projects.find((item) => item.id === snapshot.requestedProjectId) ??
    projects[0] ??
    null;
  const requested = parseSection(snapshot.requestedSection);
  // The console works inside an engagement. Without one, the firm overview opens.
  const section =
    requested === "console" && selectedProject === null
      ? "overview"
      : requested;
  const agents = loadAgents(section, snapshot);
  if (agents === "denied") {
    return { status: "denied" };
  }
  if (agents === "error") {
    return { status: "error" };
  }
  const tasks = loadTasks(section, selectedProject !== null, snapshot);
  if (tasks === "denied") {
    return { status: "denied" };
  }
  if (tasks === "error") {
    return { status: "error" };
  }
  return {
    status: "ready",
    email: user.email,
    organizations,
    organization,
    projects,
    selectedProject,
    section,
    notifications: snapshot.notifications,
    canManageProjects: snapshot.canManageProjects,
    members: snapshot.members,
    projectDetail:
      snapshot.projectDetail !== null &&
      selectedProject !== null &&
      snapshot.projectDetail.id === selectedProject.id
        ? snapshot.projectDetail
        : null,
    notice: section === "projects" ? parseNotice(snapshot.notice) : null,
    canManageAgents: canManageAgents(organization.role),
    agents: agents.agents,
    selectedAgent: agents.selectedAgent,
    agentDetail: agents.agentDetail,
    agentNotice:
      section === "agents" ? parseAgentNotice(snapshot.notice) : null,
    canManageTasks: snapshot.canManageTasks,
    tasks: tasks.tasks,
    selectedTask: tasks.selectedTask,
    taskDetail: tasks.taskDetail,
    taskAssignees: tasks.assignees,
    agentInstances: tasks.instances,
    taskNotice: section === "tasks" ? parseTaskNotice(snapshot.notice) : null,
  };
}

export function statusChoices(current: string): string[] {
  if (current === "DRAFT") {
    return ["DRAFT", "ACTIVE", "ARCHIVED"];
  }
  if (current === "ACTIVE") {
    return ["ACTIVE", "PAUSED", "ARCHIVED"];
  }
  if (current === "PAUSED") {
    return ["PAUSED", "ACTIVE", "ARCHIVED"];
  }
  if (current === "ARCHIVED") {
    return ["ARCHIVED"];
  }
  return [];
}

export function canManageProjects(role: string): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "PROJECT_MANAGER";
}

export function canManageAgents(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const TASK_STATUS_CHOICES: Record<string, string[]> = {
  DRAFT: ["DRAFT", "READY", "CANCELLED"],
  READY: ["READY", "QUEUED", "DRAFT", "BLOCKED", "CANCELLED"],
  QUEUED: ["QUEUED", "RUNNING", "READY", "CANCELLED"],
  RUNNING: [
    "RUNNING",
    "WAITING",
    "BLOCKED",
    "REVIEW",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ],
  WAITING: ["WAITING", "RUNNING", "BLOCKED", "CANCELLED"],
  BLOCKED: ["BLOCKED", "READY", "CANCELLED"],
  REVIEW: ["REVIEW", "SUCCEEDED", "FAILED", "READY", "CANCELLED"],
  SUCCEEDED: ["SUCCEEDED"],
  FAILED: ["FAILED", "CANCELLED"],
  CANCELLED: ["CANCELLED"],
};

export function taskStatusChoices(current: string): string[] {
  return TASK_STATUS_CHOICES[current] ?? [];
}

export function workspaceHref(
  section: SectionId,
  organizationId: string,
  projectId: string | null,
  agentId: string | null = null,
  taskId: string | null = null,
): string {
  const params = new URLSearchParams();
  params.set("organization", organizationId);
  if (projectId !== null) {
    params.set("project", projectId);
  }
  if (agentId !== null) {
    params.set("agent", agentId);
  }
  if (taskId !== null) {
    params.set("task", taskId);
  }
  if (section !== "overview") {
    params.set("section", section);
  }
  return `/?${params.toString()}`;
}

function loadAgents(
  section: SectionId,
  snapshot: WorkspaceSnapshot,
):
  | {
      agents: AgentSummary[];
      selectedAgent: AgentSummary | null;
      agentDetail: AgentDetail | null;
    }
  | "denied"
  | "error" {
  if (section !== "agents") {
    return { agents: [], selectedAgent: null, agentDetail: null };
  }
  if (isDenied(snapshot.agentsStatus)) {
    return "denied";
  }
  const agents = parseAgents(snapshot.agents);
  if (!isOk(snapshot.agentsStatus) || agents === null) {
    return "error";
  }
  const selectedAgent =
    agents.find((item) => item.id === snapshot.requestedAgentId) ?? null;
  if (selectedAgent === null) {
    return { agents, selectedAgent: null, agentDetail: null };
  }
  const agentDetail = parseAgentDetail(snapshot.agentDetail);
  if (agentDetail === null || agentDetail.id !== selectedAgent.id) {
    return "error";
  }
  return { agents, selectedAgent, agentDetail };
}

function isOk(status: number): boolean {
  return status === 200;
}

function isDenied(status: number): boolean {
  return status === 401 || status === 403;
}

function parseUser(value: unknown): SessionUser | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = value.id;
  const email = value.email;
  if (
    typeof id !== "string" ||
    typeof email !== "string" ||
    !email.includes("@")
  ) {
    return null;
  }
  return { id, email };
}

function parseOrganizations(value: unknown): Organization[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const organizations: Organization[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const id = item.id;
    const name = item.name;
    const slug = item.slug;
    const role = item.role;
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof slug !== "string" ||
      typeof role !== "string"
    ) {
      return null;
    }
    organizations.push({ id, name, slug, role });
  }
  return organizations;
}

function parseProjects(value: unknown): Project[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const projects: Project[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const id = item.id;
    const name = item.name;
    const slug = item.slug;
    const status = item.status;
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof slug !== "string" ||
      typeof status !== "string"
    ) {
      return null;
    }
    projects.push({ id, name, slug, status });
  }
  return projects;
}

function loadTasks(
  section: SectionId,
  projectSelected: boolean,
  snapshot: WorkspaceSnapshot,
):
  | {
      tasks: TaskSummary[];
      selectedTask: TaskSummary | null;
      taskDetail: TaskDetail | null;
      assignees: AssignableMember[];
      instances: AgentInstanceChoice[];
    }
  | "denied"
  | "error" {
  if ((section !== "tasks" && section !== "overview") || !projectSelected) {
    return {
      tasks: [],
      selectedTask: null,
      taskDetail: null,
      assignees: [],
      instances: [],
    };
  }
  if (isDenied(snapshot.tasksStatus)) {
    return "denied";
  }
  const tasks = parseTasks(snapshot.tasks);
  if (!isOk(snapshot.tasksStatus) || tasks === null) {
    return "error";
  }
  if (section === "overview") {
    return {
      tasks,
      selectedTask: null,
      taskDetail: null,
      assignees: [],
      instances: [],
    };
  }
  const instances = parseInstances(snapshot.agentInstances);
  if (instances === null) {
    return "error";
  }
  let assignees: AssignableMember[] = [];
  if (snapshot.canManageTasks) {
    const parsed = parseAssignableMembers(snapshot.taskAssignees);
    if (parsed === null) {
      return "error";
    }
    assignees = parsed;
  }
  const selectedTask =
    tasks.find((item) => item.id === snapshot.requestedTaskId) ?? null;
  if (selectedTask === null) {
    return {
      tasks,
      selectedTask: null,
      taskDetail: null,
      assignees,
      instances,
    };
  }
  const taskDetail = parseTaskDetail(snapshot.taskDetail);
  if (taskDetail === null || taskDetail.id !== selectedTask.id) {
    return "error";
  }
  return { tasks, selectedTask, taskDetail, assignees, instances };
}

function parseTaskNotice(value: string | null): TaskNotice | null {
  if (
    value === "saved" ||
    value === "invalid" ||
    value === "conflict" ||
    value === "status" ||
    value === "denied" ||
    value === "unavailable" ||
    value === "dependency" ||
    value === "agent" ||
    value === "retry"
  ) {
    return value;
  }
  return null;
}

function parseAgentNotice(value: string | null): AgentNotice | null {
  if (
    value === "saved" ||
    value === "invalid" ||
    value === "conflict" ||
    value === "key" ||
    value === "status" ||
    value === "denied" ||
    value === "unavailable" ||
    value === "secret" ||
    value === "locked" ||
    value === "reserved" ||
    value === "ocr-saved" ||
    value === "ocr-changed"
  ) {
    return value;
  }
  return null;
}

function parseNotice(value: string | null): ProjectNotice | null {
  if (
    value === "saved" ||
    value === "invalid" ||
    value === "conflict" ||
    value === "slug" ||
    value === "status" ||
    value === "denied" ||
    value === "unavailable"
  ) {
    return value;
  }
  return null;
}

export function parseTasks(value: unknown): TaskSummary[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const tasks: TaskSummary[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.status !== "string" ||
      typeof item.priority !== "string" ||
      !isNullableString(item.deadline) ||
      !isNullableString(item.assignee_name)
    ) {
      return null;
    }
    tasks.push({
      id: item.id,
      title: item.title,
      status: item.status,
      priority: item.priority,
      deadline: item.deadline,
      assigneeName: item.assignee_name,
    });
  }
  return tasks;
}

export function parseTaskDetail(value: unknown): TaskDetail | null {
  if (!isRecord(value) || !Array.isArray(value.depends_on)) {
    return null;
  }
  const dependsOn: string[] = [];
  for (const item of value.depends_on) {
    if (!isRecord(item) || typeof item.id !== "string") {
      return null;
    }
    dependsOn.push(item.id);
  }
  const activity = parseTaskActivity(value.activity);
  const artifactRefs = stringList(value.artifact_refs);
  if (
    activity === null ||
    artifactRefs === null ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    typeof value.status !== "string" ||
    typeof value.priority !== "string" ||
    !isNullableString(value.deadline) ||
    !isNullableString(value.assignee_user_id) ||
    !isNullableString(value.assignee_name) ||
    !isNullableString(value.agent_instance_id) ||
    typeof value.retry_count !== "number" ||
    typeof value.max_retries !== "number" ||
    !isNullableString(value.blocker) ||
    !isNullableString(value.escalation) ||
    !isNullableString(value.cancellation_reason) ||
    typeof value.version !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    status: value.status,
    priority: value.priority,
    deadline: value.deadline === null ? null : value.deadline.slice(0, 10),
    assigneeUserId: value.assignee_user_id,
    assigneeName: value.assignee_name,
    agentInstanceId: value.agent_instance_id,
    retryCount: value.retry_count,
    maxRetries: value.max_retries,
    blocker: value.blocker ?? "",
    escalation: value.escalation ?? "",
    cancellationReason: value.cancellation_reason ?? "",
    artifactRefs,
    version: value.version,
    dependsOn,
    activity,
  };
}

function parseTaskActivity(value: unknown): TaskActivity[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const activity: TaskActivity[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.action !== "string" ||
      typeof item.occurred_at !== "string" ||
      typeof item.actor_name !== "string"
    ) {
      return null;
    }
    activity.push({
      action: item.action,
      occurredAt: item.occurred_at,
      actorName: item.actor_name,
    });
  }
  return activity;
}

function parseInstances(value: unknown): AgentInstanceChoice[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const instances: AgentInstanceChoice[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.definition_status !== "string" ||
      typeof item.status !== "string"
    ) {
      return null;
    }
    instances.push({
      id: item.id,
      name: item.name,
      definitionStatus: item.definition_status,
      status: item.status,
    });
  }
  return instances;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    items.push(item);
  }
  return items;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function agentIdInList(
  value: unknown,
  requested: string | null,
): string | null {
  if (requested === null || !Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (isRecord(item) && item.id === requested) {
      return requested;
    }
  }
  return null;
}

export function parseAgents(value: unknown): AgentSummary[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const agents: AgentSummary[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.agent_key !== "string" ||
      typeof item.name !== "string" ||
      typeof item.role !== "string" ||
      typeof item.status !== "string"
    ) {
      return null;
    }
    agents.push({
      id: item.id,
      agentKey: item.agent_key,
      name: item.name,
      role: item.role,
      status: item.status,
      source: item.source === "standard" ? "standard" : "custom",
    });
  }
  return agents;
}

export function parseAgentDetail(value: unknown): AgentDetail | null {
  if (!isRecord(value) || !Array.isArray(value.allowed_tool_ids)) {
    return null;
  }
  const tools: string[] = [];
  for (const item of value.allowed_tool_ids) {
    if (typeof item !== "string") {
      return null;
    }
    tools.push(item);
  }
  if (
    typeof value.id !== "string" ||
    typeof value.agent_key !== "string" ||
    typeof value.name !== "string" ||
    typeof value.role !== "string" ||
    typeof value.description !== "string" ||
    typeof value.revision !== "number" ||
    !isJsonObject(value.input_schema) ||
    !isJsonObject(value.output_schema) ||
    typeof value.model_config_ref !== "string" ||
    typeof value.max_iterations !== "number" ||
    typeof value.time_budget_seconds !== "number" ||
    typeof value.status !== "string" ||
    typeof value.version !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    agentKey: value.agent_key,
    name: value.name,
    role: value.role,
    description: value.description,
    revision: value.revision,
    inputSchema: JSON.stringify(value.input_schema, null, 2),
    outputSchema: JSON.stringify(value.output_schema, null, 2),
    allowedToolIds: tools,
    modelConfigRef: value.model_config_ref,
    maxIterations: value.max_iterations,
    timeBudgetSeconds: value.time_budget_seconds,
    status: value.status,
    version: value.version,
    source: value.source === "standard" ? "standard" : "custom",
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

export function projectIdInList(
  value: unknown,
  requested: string | null,
): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (requested !== null) {
    for (const item of value) {
      if (isRecord(item) && item.id === requested) {
        return requested;
      }
    }
  }
  const first = value[0];
  if (isRecord(first) && typeof first.id === "string") {
    return first.id;
  }
  return null;
}

export function parseAssignableMembers(
  value: unknown,
): AssignableMember[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const members: AssignableMember[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.display_name !== "string"
    ) {
      return null;
    }
    members.push({ id: item.id, displayName: item.display_name });
  }
  return members;
}

export function parseProjectDetail(value: unknown): ProjectDetail | null {
  if (!isRecord(value)) {
    return null;
  }
  const progress = parseProgress(value.progress);
  const activity = parseActivity(value.activity);
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.slug !== "string" ||
    typeof value.scope !== "string" ||
    typeof value.owner_user_id !== "string" ||
    typeof value.owner_name !== "string" ||
    typeof value.status !== "string" ||
    typeof value.version !== "number" ||
    !isDateText(value.starts_on) ||
    !isDateText(value.ends_on) ||
    progress === null ||
    activity === null
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    scope: value.scope,
    ownerUserId: value.owner_user_id,
    ownerName: value.owner_name,
    status: value.status,
    startsOn: value.starts_on,
    endsOn: value.ends_on,
    version: value.version,
    progress,
    activity,
  };
}

function parseProgress(value: unknown): ProjectProgress[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const progress: ProjectProgress[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.status !== "string" ||
      typeof item.count !== "number"
    ) {
      return null;
    }
    progress.push({ status: item.status, count: item.count });
  }
  return progress;
}

function parseActivity(value: unknown): ProjectActivity[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const activity: ProjectActivity[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.action !== "string" ||
      typeof item.occurred_at !== "string" ||
      typeof item.actor_name !== "string"
    ) {
      return null;
    }
    activity.push({
      action: item.action,
      occurredAt: item.occurred_at,
      actorName: item.actor_name,
    });
  }
  return activity;
}

function isDateText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseSection(value: string | null): SectionId {
  if (
    value === "projects" ||
    value === "agents" ||
    value === "tasks" ||
    value === "evidence" ||
    value === "approvals" ||
    value === "setup" ||
    value === "controls" ||
    value === "plan" ||
    value === "timeline" ||
    value === "deficiencies" ||
    value === "overview" ||
    value === "console"
  ) {
    return value;
  }
  // An engagement opens on the agent console.
  return "console";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
