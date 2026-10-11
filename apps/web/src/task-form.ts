const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$/;
const SECRET =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const CREATE_STATUSES = ["DRAFT", "READY"] as const;

export type TaskWrite =
  | { error: "invalid" }
  | {
      organizationId: string;
      projectId: string;
      taskId: string | null;
      method: "POST" | "PATCH";
      path: string;
      body: Record<string, unknown>;
    };

export function taskWrite(
  fields: Record<string, string>,
  dependsOn: string[],
): TaskWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const title = (fields.title ?? "").trim();
  const description = (fields.description ?? "").trim();
  const priority = fields.priority ?? "";
  const blocker = (fields.blocker ?? "").trim();
  const escalation = (fields.escalation ?? "").trim();
  const cancellationReason = (fields.cancellation_reason ?? "").trim();
  const deadline = optionalDate(fields.deadline ?? "");
  const artifacts = parseArtifacts(fields.artifact_refs ?? "");
  const retries = parseRetries(fields.max_retries ?? "0");
  const assignee = optionalId(fields.assignee_user_id ?? "");
  const agent = optionalId(fields.agent_instance_id ?? "");
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    title === "" ||
    title.length > 200 ||
    description.length > 4000 ||
    !PRIORITIES.includes(priority as (typeof PRIORITIES)[number]) ||
    blocker.length > 2000 ||
    escalation.length > 2000 ||
    cancellationReason.length > 2000 ||
    deadline === "invalid" ||
    artifacts === null ||
    retries === null ||
    assignee === "invalid" ||
    agent === "invalid" ||
    dependsOn.some((item) => !UUID.test(item)) ||
    new Set(dependsOn).size !== dependsOn.length ||
    containsSecret([
      title,
      description,
      blocker,
      escalation,
      cancellationReason,
      artifacts,
    ])
  ) {
    return { error: "invalid" };
  }
  const body = {
    title,
    description,
    priority,
    deadline,
    assignee_user_id: assignee,
    agent_instance_id: agent,
    blocker,
    escalation,
    cancellation_reason: cancellationReason,
    max_retries: retries,
    artifact_refs: artifacts,
    depends_on_task_ids: dependsOn,
  };
  const base = `/organizations/${organizationId}/projects/${projectId}/tasks`;
  if ((fields.intent ?? "") === "create") {
    const status = fields.status === "" ? "DRAFT" : (fields.status ?? "DRAFT");
    if (!CREATE_STATUSES.includes(status as (typeof CREATE_STATUSES)[number])) {
      return { error: "invalid" };
    }
    return {
      organizationId,
      projectId,
      taskId: null,
      method: "POST",
      path: base,
      body: { ...body, status },
    };
  }
  const taskId = fields.task_id ?? "";
  const version = fields.version ?? "";
  if (
    !UUID.test(taskId) ||
    !/^[1-9]\d*$/.test(version) ||
    dependsOn.includes(taskId)
  ) {
    return { error: "invalid" };
  }
  const operation = operationForIntent(fields.intent ?? "");
  if (operation === null) {
    return { error: "invalid" };
  }
  if (operation === "cancel" && cancellationReason === "") {
    return { error: "invalid" };
  }
  if (operation === "save" && fields.status === "BLOCKED" && blocker === "") {
    return { error: "invalid" };
  }
  const status =
    operation === "save" ? (fields.status ?? "") : (fields.status ?? "DRAFT");
  if (operation === "save" && status === "") {
    return { error: "invalid" };
  }
  return {
    organizationId,
    projectId,
    taskId,
    method: "PATCH",
    path: `${base}/${taskId}`,
    body: { ...body, status, version: Number(version), operation },
  };
}

export function noticeForStatus(status: number, detail: string): string {
  if (status === 200 || status === 201) {
    return "saved";
  }
  if (status === 409 && detail === "task changed") {
    return "conflict";
  }
  if (status === 409 && detail === "task dependency is not allowed") {
    return "dependency";
  }
  if (status === 409 && detail === "task cannot be assigned to that agent") {
    return "agent";
  }
  if (status === 409 && detail === "task has no retries remaining") {
    return "retry";
  }
  if (status === 409) {
    return "status";
  }
  if (status === 403 || status === 401) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

function operationForIntent(
  intent: string,
): "save" | "cancel" | "reactivate" | "retry" | null {
  if (intent === "update") {
    return "save";
  }
  if (intent === "cancel" || intent === "reactivate" || intent === "retry") {
    return intent;
  }
  return null;
}

function optionalDate(value: string): string | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (!DATE.test(trimmed)) {
    return "invalid";
  }
  return `${trimmed}T00:00:00Z`;
}

function optionalId(value: string): string | null | "invalid" {
  if (value === "") {
    return null;
  }
  return UUID.test(value) ? value : "invalid";
}

function parseArtifacts(value: string): string[] | null {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (items.length > 20 || new Set(items).size !== items.length) {
    return null;
  }
  for (const item of items) {
    if (!ARTIFACT.test(item)) {
      return null;
    }
  }
  return items;
}

function parseRetries(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  if (parsed > 20) {
    return null;
  }
  return parsed;
}

function containsSecret(value: unknown): boolean {
  if (typeof value === "string") {
    return SECRET.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSecret(item));
  }
  return false;
}
