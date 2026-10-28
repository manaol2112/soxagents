import type { Client } from "./client-model.ts";
import type { Completion } from "./engagement-lifecycle.ts";
import type { ProjectNoticeCode } from "./project-form.ts";
import { canonicalQuery, parseSection, type SectionId } from "./routes.ts";

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
  /** What the engagements page shows on a card; "" or null when not set. */
  clientName: string;
  kind: string;
  periodEnd: string | null;
  ownerName: string;
  controls: number;
  openDeficiencies: number;
  /** The firm's client it belongs to, for "New engagement for" this client. */
  clientId: string | null;
  /** Where the work stands, for the card: agent tasks by status, evidence past due by
   * the metrics rulebook, the next milestone not done, and the last activity. */
  progress: ProjectProgress[];
  overdueRequests: number;
  nextMilestone: { name: string; due: string } | null;
  missedMilestones: number;
  lastActivityAt: string | null;
  /** The engagement team's names, the lead first. */
  team: string[];
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
  /** Where it stands on completion; loaded on the Engagements page only. */
  completion: Completion | null;
  /** The engagement's profile, for the edit form (Milestone 8.15). */
  clientId: string | null;
  clientName: string;
  periodEnd: string | null;
  /** Launched: the client and the period end no longer change. */
  launched: boolean;
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

export type ProjectNotice = ProjectNoticeCode;

const PROJECT_NOTICES: ReadonlySet<string> = new Set<ProjectNoticeCode>([
  "saved",
  "completed-done",
  "reopened",
  "deleted",
  "invalid",
  "conflict",
  "slug",
  "status",
  "launch",
  "archived",
  "completed",
  "open-work",
  "launched",
  "setup-running",
  "work-on-record",
  "reason",
  "delete-name",
  "locked",
  "rollforward",
  "client-renamed",
  "client-exists",
  "client-changed",
  "denied",
  "unavailable",
]);

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
      /** The firm's clients, for the engagement form (Milestone 8.18). */
      clients: Client[];
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

/** Whether the shell says to sign in. Never while the page is still loading: a member
 * moving between pages is not signed out, so the loading shell shows placeholders. */
export function showsSignInPrompt(model: ShellModel): boolean {
  return model.status !== "ready" && model.status !== "loading";
}

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
  clients?: Client[];
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
  // The engagement asked for; otherwise one still in use (never an archived one while
  // another is open), the same choice projectIdInList makes for the page's data.
  const selectedProject =
    projects.find((item) => item.id === snapshot.requestedProjectId) ??
    projects.find((item) => item.status !== "ARCHIVED") ??
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
    clients: snapshot.clients ?? [],
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

/**
 * The engagements the switcher offers: the ones still in use, and the one open now even
 * when it is archived, so its name stays in place. Archived engagements are found on the
 * Engagements page, as the recent list already leaves them out (recentOf).
 */
export function switcherProjects(
  projects: readonly Project[],
  selectedId: string | null,
): Project[] {
  return projects.filter(
    (project) => project.status !== "ARCHIVED" || project.id === selectedId,
  );
}

/**
 * What the engagement switcher shows for each engagement: the client, then the name.
 * Two engagements can share a name, so the client comes first; when both still match,
 * the period end tells them apart.
 */
export function projectLabels(
  projects: readonly Project[],
): Map<string, string> {
  const base = (project: Project) =>
    project.clientName.trim() === ""
      ? project.name
      : `${project.clientName.trim()} · ${project.name}`;
  const seen = new Map<string, number>();
  for (const project of projects) {
    const label = base(project).toLowerCase();
    seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  return new Map(
    projects.map((project) => {
      const label = base(project);
      if ((seen.get(label.toLowerCase()) ?? 0) < 2) {
        return [project.id, label];
      }
      const period =
        project.periodEnd === null
          ? "no period end"
          : `period end ${project.periodEnd}`;
      return [project.id, `${label} (${period})`];
    }),
  );
}

export {
  DESTINATIONS,
  destinationHref,
  parseReportTab,
  parseSection,
  parseSettingsTab,
  REPORT_TAB_LABELS,
  REPORT_TABS,
  type ReportTab,
  type Route,
  resolveRoute,
  SECTIONS,
  SETTINGS_FIRM_FROM,
  SETTINGS_TAB_LABELS,
  SETTINGS_TABS,
  type SectionId,
  type SettingsTab,
} from "./routes.ts";

/** The sections that open once the engagement has launched. Before that, setup is the work. */
export const LAUNCHED_SECTIONS: readonly SectionId[] = [
  "console",
  "overview",
  "controls",
  "register",
  "planning",
  "testing",
  "review",
  "plan",
  "timeline",
  "evidence",
  "deficiencies",
  "approvals",
  "reports",
];

/** A launched engagement with no controls yet: Controls is where they are set up
 * (decided by the product owner), with the setup's own steps. */
export function controlsToSetUp(
  project: { status: string; controls: number } | null,
): boolean {
  return (
    project !== null &&
    project.status !== "DRAFT" &&
    project.status !== "ARCHIVED" &&
    project.status !== "COMPLETED" &&
    project.controls === 0
  );
}

/** The menu before the firm's first engagement: Home, which starts one, and the firm's
 * own pages. The engagement's pages have nothing to show yet (decided by the product
 * owner on 27 October 2026). */
const BEFORE_FIRST_ENGAGEMENT: readonly SectionId[] = [
  "overview",
  "projects",
  "library",
];

/** Whether the menu lists a section, given whether an engagement is open. */
export function shownInMenu(
  section: SectionId,
  engagementOpen: boolean,
): boolean {
  return engagementOpen || BEFORE_FIRST_ENGAGEMENT.includes(section);
}

/** Home with nothing in scope has nothing to show yet: a launched engagement without
 * controls opens on Systems & Processes, where the systems, processes and controls are
 * added (decided by the product owner on 27 October 2026). Null when Home stays. */
export function homePlacement(
  section: SectionId,
  organizationId: string,
  project: (Pick<Project, "id"> & { status: string; controls: number }) | null,
): string | null {
  if (section !== "overview" || project === null || !controlsToSetUp(project)) {
    return null;
  }
  return workspaceHref("controls", organizationId, project.id);
}

/** A draft engagement has not launched: its controls, evidence, plan, and approvals wait. */
export function lockedBeforeLaunch(
  section: SectionId,
  project: Pick<Project, "status"> | null,
): boolean {
  return (
    project !== null &&
    project.status === "DRAFT" &&
    LAUNCHED_SECTIONS.includes(section)
  );
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
  // Home is the default page, so only it can leave the section out.
  if (section !== "overview") {
    params.set("section", section);
  }
  return `/?${canonicalQuery(params).toString()}`;
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
    projects.push({
      id,
      name,
      slug,
      status,
      clientName: typeof item.client_name === "string" ? item.client_name : "",
      kind:
        typeof item.engagement_type === "string" ? item.engagement_type : "",
      periodEnd: typeof item.period_end === "string" ? item.period_end : null,
      ownerName: typeof item.owner_name === "string" ? item.owner_name : "",
      controls: typeof item.controls === "number" ? item.controls : 0,
      openDeficiencies:
        typeof item.open_deficiencies === "number" ? item.open_deficiencies : 0,
      clientId: typeof item.client_id === "string" ? item.client_id : null,
      progress: Array.isArray(item.progress)
        ? item.progress.flatMap((entry) =>
            isRecord(entry) &&
            typeof entry.status === "string" &&
            typeof entry.count === "number"
              ? [{ status: entry.status, count: entry.count }]
              : [],
          )
        : [],
      overdueRequests:
        typeof item.overdue_requests === "number" ? item.overdue_requests : 0,
      nextMilestone:
        isRecord(item.next_milestone) &&
        typeof item.next_milestone.name === "string" &&
        typeof item.next_milestone.due === "string"
          ? { name: item.next_milestone.name, due: item.next_milestone.due }
          : null,
      missedMilestones:
        typeof item.missed_milestones === "number" ? item.missed_milestones : 0,
      lastActivityAt:
        typeof item.last_activity_at === "string"
          ? item.last_activity_at
          : null,
      team: Array.isArray(item.team)
        ? item.team.filter(
            (entry): entry is string =>
              typeof entry === "string" && entry !== "",
          )
        : [],
    });
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
  return value !== null && PROJECT_NOTICES.has(value)
    ? (value as ProjectNotice)
    : null;
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
  // None asked for (or not in the list): the first still in use, so an archived
  // engagement never opens by default; the first only when every one is archived.
  const open = value.find(
    (item) => isRecord(item) && item.status !== "ARCHIVED",
  );
  const first = open ?? value[0];
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
    completion: null,
    clientId: typeof value.client_id === "string" ? value.client_id : null,
    clientName: typeof value.client_name === "string" ? value.client_name : "",
    periodEnd: typeof value.period_end === "string" ? value.period_end : null,
    launched: value.launched === true,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
