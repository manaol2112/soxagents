export const PAGE_SIZE = 6;

export const TASK_STATUSES = [
  "DRAFT",
  "READY",
  "QUEUED",
  "RUNNING",
  "WAITING",
  "BLOCKED",
  "REVIEW",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

const CLOSED = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export type DirectoryQuery = {
  taskStatus: string | null;
  taskPriority: string | null;
  taskPage: number;
  agentStatus: string | null;
  agentPage: number;
};

export const EMPTY_DIRECTORY: DirectoryQuery = {
  taskStatus: null,
  taskPriority: null,
  taskPage: 1,
  agentStatus: null,
  agentPage: 1,
};

export type Page<T> = {
  page: number;
  pages: number;
  total: number;
  items: T[];
};

export function parseDirectoryQuery(
  params: Record<string, string | string[] | undefined>,
): DirectoryQuery {
  return {
    taskStatus: choice(first(params.taskStatus), TASK_STATUSES),
    taskPriority: choice(first(params.taskPriority), PRIORITIES),
    taskPage: pageNumber(first(params.taskPage)),
    agentStatus: choice(first(params.agentStatus), ["ACTIVE", "DISABLED"]),
    agentPage: pageNumber(first(params.agentPage)),
  };
}

export function filterTasks<T extends { status: string; priority: string }>(
  tasks: T[],
  query: Pick<DirectoryQuery, "taskStatus" | "taskPriority">,
): T[] {
  return tasks.filter((task) => {
    if (query.taskStatus !== null && task.status !== query.taskStatus) {
      return false;
    }
    if (query.taskPriority !== null && task.priority !== query.taskPriority) {
      return false;
    }
    return true;
  });
}

export function filterAgents<T extends { status: string }>(
  agents: T[],
  status: string | null,
): T[] {
  if (status === null) {
    return agents;
  }
  return agents.filter((agent) => agent.status === status);
}

export function paginate<T>(
  items: T[],
  page: number,
  size = PAGE_SIZE,
): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(page, 1), pages);
  const start = (current - 1) * size;
  return {
    page: current,
    pages,
    total: items.length,
    items: items.slice(start, start + size),
  };
}

export function blockedTasks<T extends { status: string }>(tasks: T[]): T[] {
  return tasks.filter((task) => task.status === "BLOCKED");
}

export function upcomingDeadlines<
  T extends { status: string; deadline: string | null },
>(tasks: T[]): T[] {
  return tasks
    .filter((task) => task.deadline !== null && !CLOSED.has(task.status))
    .slice()
    .sort((left, right) =>
      String(left.deadline).localeCompare(String(right.deadline)),
    )
    .slice(0, 5);
}

export function directoryHref(input: {
  section: string;
  organizationId: string;
  projectId: string | null;
  agentId?: string | null;
  taskId?: string | null;
  taskStatus?: string | null;
  taskPriority?: string | null;
  taskPage?: number;
  agentStatus?: string | null;
  agentPage?: number;
}): string {
  const params = new URLSearchParams();
  params.set("organization", input.organizationId);
  if (input.projectId !== null && input.projectId !== "") {
    params.set("project", input.projectId);
  }
  // The console is the default page, so only it can leave the section out.
  if (input.section !== "console") {
    params.set("section", input.section);
  }
  if (input.agentId) {
    params.set("agent", input.agentId);
  }
  if (input.taskId) {
    params.set("task", input.taskId);
  }
  if (input.taskStatus) {
    params.set("taskStatus", input.taskStatus);
  }
  if (input.taskPriority) {
    params.set("taskPriority", input.taskPriority);
  }
  if ((input.taskPage ?? 1) > 1) {
    params.set("taskPage", String(input.taskPage));
  }
  if (input.agentStatus) {
    params.set("agentStatus", input.agentStatus);
  }
  if ((input.agentPage ?? 1) > 1) {
    params.set("agentPage", String(input.agentPage));
  }
  return `/?${params.toString()}`;
}

function first(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string" && value[0] !== "") {
    return value[0];
  }
  return null;
}

function choice(
  value: string | null,
  allowed: readonly string[],
): string | null {
  if (value !== null && allowed.includes(value)) {
    return value;
  }
  return null;
}

function pageNumber(value: string | null): number {
  if (value === null || !/^[1-9]\d*$/.test(value)) {
    return 1;
  }
  return Number(value);
}
