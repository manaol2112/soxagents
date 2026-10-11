/** The agent console: the conversation, proposed steps, and what waits on the person. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConsoleAction = {
  id: string;
  position: number;
  tool: string;
  label: string;
  risk: "ROUTINE" | "CONFIRM";
  summary: string;
  status: "PROPOSED" | "DONE" | "FAILED" | "CANCELLED";
  error: string;
  decidedBy: string | null;
};

export type ConsoleMessage = {
  id: string;
  role: "USER" | "AGENT";
  content: string;
  status: "PENDING" | "WORKING" | "DONE" | "FAILED";
  note: string;
  createdAt: string;
  actions: ConsoleAction[];
};

export type ConsoleThread = {
  id: string | null;
  title: string;
  messages: ConsoleMessage[];
  modelConfigured: boolean;
};

export type ThreadSummary = {
  id: string;
  title: string;
  messages: number;
  updatedAt: string;
};

export type WaitingItem = {
  kind: string;
  title: string;
  detail: string;
  controlRef: string | null;
  link: string;
};

export type ActivityItem = {
  agent: string;
  action: string;
  detail: string;
  at: string;
};

export type ConsoleInbox = {
  waiting: WaitingItem[];
  activity: ActivityItem[];
};

export type ConsoleState = {
  thread: ConsoleThread | null;
  threads: ThreadSummary[];
  inbox: ConsoleInbox | null;
  notice: ConsoleNotice | null;
};

export const EMPTY_CONSOLE: ConsoleState = {
  thread: null,
  threads: [],
  inbox: null,
  notice: null,
};

export function parseThreads(value: unknown): ThreadSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isRecord)
    .filter((item) => typeof item.id === "string" && UUID.test(item.id))
    .map((item) => ({
      id: str(item.id),
      title: str(item.title) || "New conversation",
      messages: typeof item.messages === "number" ? item.messages : 0,
      updatedAt: str(item.updated_at),
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.find((option) => option === value) ?? fallback;
}

export function parseThread(value: unknown): ConsoleThread | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return null;
  }
  const messages: ConsoleMessage[] = [];
  for (const item of value.messages) {
    if (!isRecord(item) || typeof item.id !== "string" || !UUID.test(item.id)) {
      return null;
    }
    const actions: ConsoleAction[] = [];
    for (const action of Array.isArray(item.actions) ? item.actions : []) {
      if (!isRecord(action) || typeof action.id !== "string") {
        continue;
      }
      actions.push({
        id: action.id,
        position: typeof action.position === "number" ? action.position : 0,
        tool: str(action.tool),
        label: str(action.label),
        risk: oneOf(action.risk, ["ROUTINE", "CONFIRM"] as const, "CONFIRM"),
        summary: str(action.summary),
        status: oneOf(
          action.status,
          ["PROPOSED", "DONE", "FAILED", "CANCELLED"] as const,
          "PROPOSED",
        ),
        error: str(action.error),
        decidedBy:
          typeof action.decided_by_name === "string"
            ? action.decided_by_name
            : null,
      });
    }
    messages.push({
      id: item.id,
      role: oneOf(item.role, ["USER", "AGENT"] as const, "AGENT"),
      content: str(item.content),
      status: oneOf(
        item.status,
        ["PENDING", "WORKING", "DONE", "FAILED"] as const,
        "DONE",
      ),
      note: str(item.note),
      createdAt: str(item.created_at),
      actions,
    });
  }
  return {
    id: typeof value.id === "string" && UUID.test(value.id) ? value.id : null,
    title: str(value.title),
    messages,
    modelConfigured: value.model_configured === true,
  };
}

export function parseInbox(value: unknown): ConsoleInbox | null {
  if (!isRecord(value)) {
    return null;
  }
  const waiting = (Array.isArray(value.waiting) ? value.waiting : [])
    .filter(isRecord)
    .map((item) => ({
      kind: str(item.kind),
      title: str(item.title),
      detail: str(item.detail),
      controlRef:
        typeof item.control_ref === "string" ? item.control_ref : null,
      link: str(item.link),
    }));
  const activity = (Array.isArray(value.activity) ? value.activity : [])
    .filter(isRecord)
    .map((item) => ({
      agent: str(item.agent),
      action: str(item.action),
      detail: str(item.detail),
      at: str(item.at),
    }));
  return { waiting, activity };
}

/** True while an agent is still answering, so the page keeps refreshing. */
export function agentWorking(thread: ConsoleThread | null): boolean {
  return (thread?.messages ?? []).some(
    (message) => message.status === "PENDING" || message.status === "WORKING",
  );
}

export type Block =
  | { kind: "paragraph"; parts: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };
export type Inline = { text: string; strong: boolean };

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** The agent's reply as paragraphs, lists, and tables. Bold is the only inline markup kept. */
export function blocks(content: string): Block[] {
  const result: Block[] = [];
  let list: Inline[][] | null = null;
  let table: string[][] | null = null;
  const flush = () => {
    if (list !== null) {
      result.push({ kind: "list", items: list });
      list = null;
    }
    if (table !== null) {
      const [header = [], ...rows] = table.filter(
        (row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell)),
      );
      result.push({
        kind: "table",
        header: header.map(inline),
        rows: rows.map((row) => row.map(inline)),
      });
      table = null;
    }
  };
  for (const raw of content.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (list !== null) {
        result.push({ kind: "list", items: list });
        list = null;
      }
      table ??= [];
      table.push(cells(line));
      continue;
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet !== null) {
      if (table !== null) {
        flush();
      }
      list ??= [];
      list.push(inline(bullet[1] ?? ""));
      continue;
    }
    flush();
    if (line.trim() === "") {
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    result.push({
      kind: "paragraph",
      parts:
        heading !== null
          ? [{ text: heading[1] ?? "", strong: true }]
          : inline(line),
    });
  }
  flush();
  return result;
}

function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), strong: false });
    }
    parts.push({ text: match[1] ?? "", strong: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), strong: false });
  }
  return parts.map((part) => ({ ...part, text: part.text.replace(/`/g, "") }));
}

export type ConsoleIntent =
  | "ask"
  | "confirm"
  | "confirm-all"
  | "cancel"
  | "new-thread";

export type ConsoleWrite =
  | { error: "invalid" }
  | {
      intent: ConsoleIntent;
      path: string;
      body: Record<string, unknown> | null;
    };

export function consoleWrite(fields: Record<string, string>): ConsoleWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/console`;
  const intent = fields.intent ?? "";
  if (intent === "ask") {
    const text = (fields.text ?? "").trim();
    if (text === "" || text.length > 4000) {
      return { error: "invalid" };
    }
    const thread = fields.thread_id ?? "";
    return {
      intent,
      path: `${base}/messages`,
      body: UUID.test(thread) ? { text, thread_id: thread } : { text },
    };
  }
  if (intent === "new-thread") {
    return { intent, path: `${base}/threads`, body: null };
  }
  if (intent === "confirm-all") {
    const message = fields.message_id ?? "";
    return UUID.test(message)
      ? { intent, path: `${base}/messages/${message}/confirm`, body: null }
      : { error: "invalid" };
  }
  if (intent === "confirm" || intent === "cancel") {
    const action = fields.action_id ?? "";
    return UUID.test(action)
      ? { intent, path: `${base}/actions/${action}/${intent}`, body: null }
      : { error: "invalid" };
  }
  return { error: "invalid" };
}

export type ConsoleNotice =
  | "sent"
  | "busy"
  | "confirmed"
  | "cancelled"
  | "stale"
  | "denied"
  | "invalid"
  | "unavailable"
  | "new";

export const CONSOLE_NOTICES: Record<ConsoleNotice, string> = {
  sent: "",
  busy: "The agent is still working on your last message. Wait for its answer, then ask again.",
  confirmed: "Done. Each step ran as you, through the usual checks.",
  cancelled: "Step cancelled. Nothing ran.",
  stale: "That step is no longer waiting for confirmation.",
  denied: "That is not available to you.",
  invalid: "Type a message first.",
  unavailable: "The console could not reach the agents. Try again.",
  new: "",
};

export function consoleNoticeFor(
  intent: ConsoleIntent,
  status: number,
): ConsoleNotice {
  if (status === 200) {
    return intent === "ask"
      ? "sent"
      : intent === "cancel"
        ? "cancelled"
        : intent === "new-thread"
          ? "new"
          : "confirmed";
  }
  if (status === 409) {
    return intent === "ask" ? "busy" : "stale";
  }
  if (status === 403 || status === 404) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

export function parseConsoleNotice(value: string | null): ConsoleNotice | null {
  return (
    (Object.keys(CONSOLE_NOTICES) as ConsoleNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}

export const SUGGESTIONS = [
  "What needs my attention today?",
  "Which evidence requests are still drafts? Submit them for approval.",
  "Summarize the evidence we have for ITGC-AC-01 and any gaps.",
  "What is overdue, and who is it waiting on?",
  "Are there samples waiting for my approval?",
];
