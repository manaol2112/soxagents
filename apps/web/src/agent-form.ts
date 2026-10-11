const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

export type AgentWrite =
  | { error: "invalid" | "secret" }
  | {
      organizationId: string;
      agentId: string | null;
      method: "POST" | "PATCH";
      path: string;
      body: Record<string, unknown>;
    };

export function agentWrite(fields: Record<string, string>): AgentWrite {
  const organizationId = fields.organization_id ?? "";
  const agentKey = (fields.agent_key ?? "").trim();
  const name = (fields.name ?? "").trim();
  const role = (fields.role ?? "").trim();
  const description = (fields.description ?? "").trim();
  const modelConfigRef = (fields.model_config_ref ?? "").trim();
  const inputSchema = parseSchema(fields.input_schema ?? "");
  const outputSchema = parseSchema(fields.output_schema ?? "");
  const tools = parseTools(fields.allowed_tool_ids ?? "");
  const iterations = parseLimit(fields.max_iterations ?? "", 100);
  const timeBudget = parseLimit(fields.time_budget_seconds ?? "", 86400);
  if (
    !UUID.test(organizationId) ||
    !KEY.test(agentKey) ||
    agentKey.length > 80 ||
    name === "" ||
    name.length > 200 ||
    role === "" ||
    role.length > 120 ||
    description.length > 4000 ||
    !MODEL.test(modelConfigRef) ||
    inputSchema === null ||
    outputSchema === null ||
    tools === null ||
    iterations === null ||
    timeBudget === null
  ) {
    return { error: "invalid" };
  }
  const body = {
    agent_key: agentKey,
    name,
    role,
    description,
    input_schema: inputSchema,
    output_schema: outputSchema,
    allowed_tool_ids: tools,
    model_config_ref: modelConfigRef,
    max_iterations: iterations,
    time_budget_seconds: timeBudget,
  };
  if (
    containsSecret(body) ||
    containsSecret(description) ||
    containsSecret(modelConfigRef)
  ) {
    return { error: "secret" };
  }
  if ((fields.intent ?? "") === "create") {
    const status = fields.status === "DISABLED" ? "DISABLED" : "ACTIVE";
    return {
      organizationId,
      agentId: null,
      method: "POST",
      path: `/organizations/${organizationId}/agents`,
      body: { ...body, status },
    };
  }
  const agentId = fields.agent_id ?? "";
  const version = fields.version ?? "";
  if (!UUID.test(agentId) || !/^[1-9]\d*$/.test(version)) {
    return { error: "invalid" };
  }
  const status = statusForIntent(fields.intent ?? "", fields.status ?? "");
  if (status === null) {
    return { error: "invalid" };
  }
  return {
    organizationId,
    agentId,
    method: "PATCH",
    path: `/organizations/${organizationId}/agents/${agentId}`,
    body: { ...body, status, version: Number(version) },
  };
}

export function noticeForStatus(status: number, detail: string): string {
  if (status === 200 || status === 201) {
    return "saved";
  }
  if (status === 409 && detail === "agent key is already in use") {
    return "key";
  }
  if (
    status === 409 &&
    detail === "standard agents are managed by the platform"
  ) {
    return "locked";
  }
  if (
    status === 409 &&
    detail === "agent key is reserved for the standard workforce"
  ) {
    return "reserved";
  }
  if (status === 409 && detail === "agent changed") {
    return "conflict";
  }
  if (status === 409 && detail === "agent status cannot change that way") {
    return "status";
  }
  if (status === 403 || status === 401) {
    return "denied";
  }
  if (status === 422 && detail.includes("secret")) {
    return "secret";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

function statusForIntent(
  intent: string,
  status: string,
): "ACTIVE" | "DISABLED" | null {
  if (intent === "disable") {
    return "DISABLED";
  }
  if (intent === "enable") {
    return "ACTIVE";
  }
  if (intent === "update" && (status === "ACTIVE" || status === "DISABLED")) {
    return status;
  }
  return null;
}

function parseSchema(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    if (JSON.stringify(parsed).length > 16000) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseTools(value: string): string[] | null {
  const tools = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (tools.length > 32 || new Set(tools).size !== tools.length) {
    return null;
  }
  for (const tool of tools) {
    if (tool.length > 80 || !TOOL.test(tool)) {
      return null;
    }
  }
  return tools;
}

function parseLimit(value: string, maximum: number): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  if (parsed > maximum) {
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
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([key, item]) => {
      const normalized = key.toLowerCase().replaceAll("-", "_");
      if (
        [
          "api_key",
          "apikey",
          "secret",
          "password",
          "passwd",
          "token",
          "access_token",
          "refresh_token",
          "client_secret",
          "private_key",
          "access_key",
          "secret_key",
          "authorization",
          "credential",
          "credentials",
        ].includes(normalized) &&
        typeof item === "string" &&
        ![
          "string",
          "number",
          "integer",
          "boolean",
          "object",
          "array",
          "null",
        ].includes(item)
      ) {
        return true;
      }
      return containsSecret(item);
    });
  }
  return false;
}
