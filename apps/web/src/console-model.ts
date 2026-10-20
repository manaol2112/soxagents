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
  /** The file an export step made, once it is stored (Milestone 8.20). */
  file: ConsoleFile | null;
};

export type ConsoleFile = {
  id: string;
  projectId: string;
  fileName: string;
  fileFormat: "xlsx" | "csv" | "pdf" | "docx";
  /** What the file holds: records (8.20) or a report (8.21). */
  dataset: string;
  rows: number;
  asOf: string;
  expires: string;
  filters: Record<string, unknown>;
};

const FILE_FORMATS: readonly ConsoleFile["fileFormat"][] = [
  "xlsx",
  "csv",
  "pdf",
  "docx",
];
const FILE_TOOLS = new Set(["export_records", "generate_report"]);
/** The reports the agent makes (8.21), by the name the file card shows. */
export const REPORT_TITLES: Record<string, string> = {
  status_report: "Engagement status report",
  evidence_tracker: "Pending evidence tracker",
  control_summary: "Control testing summary",
  exceptions_report: "Exceptions and remediation report",
  executive_summary: "Executive summary",
};

/** The file an export step returned, only when it is whole: anything else shows no link. */
export function parseConsoleFile(
  tool: string,
  result: unknown,
): ConsoleFile | null {
  if (!FILE_TOOLS.has(tool) || !isRecord(result) || !isRecord(result.export)) {
    return null;
  }
  const file = result.export;
  if (
    typeof file.id !== "string" ||
    !UUID.test(file.id) ||
    typeof file.project_id !== "string" ||
    !UUID.test(file.project_id) ||
    typeof file.file_name !== "string" ||
    file.file_name === "" ||
    !FILE_FORMATS.includes(file.file_format as ConsoleFile["fileFormat"]) ||
    typeof file.rows !== "number"
  ) {
    return null;
  }
  return {
    id: file.id,
    projectId: file.project_id,
    fileName: file.file_name,
    fileFormat: file.file_format as ConsoleFile["fileFormat"],
    dataset: str(file.dataset),
    rows: file.rows,
    asOf: str(file.as_of),
    expires: str(file.expires),
    filters: isRecord(file.filters) ? file.filters : {},
  };
}

/** Where a file downloads: through the workspace, which checks the person can see it. */
export function fileHref(file: ConsoleFile, organizationId: string): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: file.projectId,
  });
  return `/workspace/exports/${file.id}?${params.toString()}`;
}

/** How a file's filters read: "phase INTERIM, overdue only". */
export function filtersLine(filters: Record<string, unknown>): string {
  if (typeof filters.scope === "string") {
    return filters.scope;
  }
  const parts = Object.entries(filters)
    .filter(([, value]) => value !== null && value !== "" && value !== false)
    .map(([key, value]) => {
      const name = key.replaceAll("_", " ");
      if (value === true) {
        return name;
      }
      return `${name} ${Array.isArray(value) ? value.join(" or ") : String(value)}`;
    });
  return parts.length === 0 ? "all records" : parts.join(", ");
}

export type ConsoleMessage = {
  id: string;
  role: "USER" | "AGENT";
  content: string;
  status: "PENDING" | "WORKING" | "DONE" | "FAILED";
  note: string;
  createdAt: string;
  actions: ConsoleAction[];
  /** The thread's latest settled answer, which the person can ask for again. */
  canRetry: boolean;
  /** Checked quotes from evidence files, shown where the answer says [^n]. */
  citations: Citation[];
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
  /** The control record to open, and its tab, when the item is about one control. */
  controlId: string | null;
  tab: string | null;
};

const WAITING_SECTIONS: Record<string, string> = {
  approvals: "approvals",
  controls: "controls",
  evidence: "evidence",
  mailbox: "evidence",
  plan: "plan",
};
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The record's tabs (engagement-model DETAIL_TABS), and the names older links used.
const TABS = new Set([
  "overview",
  "design",
  "evidence",
  "testing",
  "findings",
  "review",
  "activity",
  "interim",
  "rollforward",
]);

/** Where a waiting item leads: the control record when it is about one control,
 * otherwise the page that holds it. */
export function waitingHref(
  item: WaitingItem,
  organizationId: string,
  projectId: string | null,
): string {
  const params = new URLSearchParams({ organization: organizationId });
  if (projectId !== null) {
    params.set("project", projectId);
  }
  if (item.controlId !== null && UUID_SHAPE.test(item.controlId)) {
    params.set("section", "controls");
    params.set("control", item.controlId);
    if (item.tab !== null && TABS.has(item.tab)) {
      params.set("tab", item.tab);
    }
    return `/?${params.toString()}`;
  }
  params.set("section", WAITING_SECTIONS[item.link] ?? "console");
  if (item.link === "mailbox") {
    params.set("tab", "mailbox");
  }
  if (item.kind === "contacts" && item.link === "evidence") {
    // Requests without a recipient: the evidence coordinator is assigned there.
    params.set("tab", "requests");
    return `/?${params.toString()}#contacts-title`;
  }
  return `/?${params.toString()}`;
}

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
        file: parseConsoleFile(str(action.tool), action.result),
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
      canRetry: item.can_retry === true,
      citations: parseCitations(item.citations),
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
      controlId: typeof item.control_id === "string" ? item.control_id : null,
      tab: typeof item.tab === "string" ? item.tab : null,
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

export type ListItem = {
  parts: Inline[];
  /** Indented items under this one. */
  children?: { ordered: boolean; items: Inline[][] };
};
export type Block =
  | { kind: "paragraph"; parts: Inline[] }
  | { kind: "heading"; level: 2 | 3 | 4; parts: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "code"; text: string }
  | { kind: "quote"; parts: Inline[] }
  | { kind: "rule" };
export type Inline = {
  text: string;
  strong: boolean;
  em?: boolean;
  code?: boolean;
  /** A link the answer gives, already checked (safeHref). */
  href?: string;
  cite?: number;
};

export type Citation = {
  number: number;
  fileId: string;
  fileName: string;
  quote: string;
  before: string;
  after: string;
  location: string;
};

/** An answer's citations as passages to mark in the evidence preview. */
export function previewCitations(citations: readonly Citation[]): Array<{
  fileId: string;
  fileName: string;
  quote: string;
  found: boolean;
  location: string;
  page: number | null;
  box: null;
  label: string;
}> {
  return citations.map((citation) => {
    const page = /^Page (\d+)/.exec(citation.location);
    return {
      fileId: citation.fileId,
      fileName: citation.fileName,
      quote: citation.quote,
      found: true,
      location: citation.location,
      page: page === null ? null : Number(page[1]),
      box: null,
      label: `[${citation.number}]`,
    };
  });
}

/** The distinct files an answer cites, in the order they are first cited. */
export function citedFiles(
  citations: readonly Citation[],
): Array<{ id: string; fileName: string }> {
  const seen = new Map<string, string>();
  for (const citation of citations) {
    if (!seen.has(citation.fileId)) {
      seen.set(citation.fileId, citation.fileName);
    }
  }
  return [...seen.entries()].map(([id, fileName]) => ({ id, fileName }));
}

export function parseCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    )
    .filter(
      (item) =>
        typeof item.number === "number" &&
        typeof item.evidence_file_id === "string" &&
        UUID.test(item.evidence_file_id),
    )
    .map((item) => ({
      number: item.number as number,
      fileId: item.evidence_file_id as string,
      fileName: str(item.file_name),
      quote: str(item.quote),
      before: str(item.before),
      after: str(item.after),
      location: str(item.location),
    }));
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** The agent's reply as headings, paragraphs, lists, tables, code, quotes, and rules. */
export function blocks(content: string): Block[] {
  const result: Block[] = [];
  let list: Extract<Block, { kind: "list" }> | null = null;
  let table: string[][] | null = null;
  let code: string[] | null = null;
  let quote: string[] | null = null;
  const flush = () => {
    if (list !== null) {
      result.push(list);
      list = null;
    }
    if (table !== null) {
      const [header = [], ...rows] = table.filter(
        (row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell)),
      );
      result.push({
        kind: "table",
        header: header.map((cell) => inline(cell)),
        rows: rows.map((row) => row.map((cell) => inline(cell))),
      });
      table = null;
    }
    if (quote !== null) {
      result.push({ kind: "quote", parts: inline(quote.join(" ")) });
      quote = null;
    }
  };
  for (const raw of content.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    // A fenced code block keeps its lines exactly as written.
    if (code !== null) {
      if (/^\s*```/.test(line)) {
        result.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      code = [];
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (list !== null || quote !== null) {
        const pending: string[][] | null = table;
        table = null;
        flush();
        table = pending;
      }
      table ??= [];
      table.push(cells(line));
      continue;
    }
    const item = /^(\s*)(?:([-*•])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
    if (item !== null) {
      if (table !== null || quote !== null) {
        flush();
      }
      const nested = (item[1] ?? "").length >= 2;
      const ordered = item[3] !== undefined;
      const parts = inline(item[4] ?? "");
      const open = list as Extract<Block, { kind: "list" }> | null;
      const parent = open?.items.at(-1);
      if (nested && open !== null && parent !== undefined) {
        // An indented item belongs to the item above it.
        parent.children ??= { ordered, items: [] };
        parent.children.items.push(parts);
        continue;
      }
      if (open !== null && open.ordered !== ordered) {
        flush();
      }
      list ??= {
        kind: "list",
        ordered,
        start: ordered ? Number(item[3]) : 1,
        items: [],
      };
      list.items.push({ parts });
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted !== null) {
      if (list !== null || table !== null) {
        flush();
      }
      quote ??= [];
      quote.push(quoted[1] ?? "");
      continue;
    }
    flush();
    if (line.trim() === "") {
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      result.push({ kind: "rule" });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const depth = (heading[1] ?? "").length;
      result.push({
        kind: "heading",
        level: depth <= 2 ? 2 : depth === 3 ? 3 : 4,
        parts: inline((heading[2] ?? "").replace(/\s+#+\s*$/, "")),
      });
      continue;
    }
    result.push({ kind: "paragraph", parts: inline(line) });
  }
  if (code !== null) {
    // Still being written: show what there is of it.
    result.push({ kind: "code", text: (code as string[]).join("\n") });
  }
  flush();
  return result;
}

/**
 * An answer without its markup: for the clipboard ("- " and "1." items, tab-separated table
 * rows, so it pastes into a document or a sheet) or for reading aloud (whole sentences).
 */
export function plainText(content: string, use: "copy" | "speech"): string {
  const words = (parts: Inline[]) =>
    parts
      .map((part) =>
        part.cite === undefined
          ? part.text
          : use === "copy"
            ? `[${part.cite}]`
            : "",
      )
      .join("")
      .replace(/\s+([.,;:])/g, "$1");
  const sentence = (text: string) =>
    use === "speech" && !/[.!?:]$/.test(text) ? `${text}.` : text;
  const items = (
    ordered: boolean,
    start: number,
    entries: Inline[][],
    indent: string,
  ) =>
    entries.map((parts, index) =>
      use === "copy"
        ? `${indent}${ordered ? `${start + index}.` : "-"} ${words(parts)}`
        : sentence(words(parts)),
    );
  const out: string[] = [];
  for (const block of blocks(content)) {
    if (block.kind === "paragraph" || block.kind === "heading") {
      out.push(sentence(words(block.parts)));
    } else if (block.kind === "quote") {
      out.push(
        use === "copy"
          ? `> ${words(block.parts)}`
          : sentence(words(block.parts)),
      );
    } else if (block.kind === "code") {
      out.push(block.text);
    } else if (block.kind === "rule") {
      if (use === "copy") {
        out.push("---");
      }
    } else if (block.kind === "list") {
      const lines: string[] = [];
      block.items.forEach((item, index) => {
        lines.push(
          ...items(block.ordered, block.start + index, [item.parts], ""),
        );
        if (item.children !== undefined) {
          lines.push(
            ...items(item.children.ordered, 1, item.children.items, "  "),
          );
        }
      });
      out.push(lines.join(use === "copy" ? "\n" : " "));
    } else {
      const rows = [block.header, ...block.rows].map((row) => row.map(words));
      out.push(
        use === "copy"
          ? rows.map((row) => row.join("\t")).join("\n")
          : block.rows
              .map((row) =>
                sentence(
                  row
                    .map(words)
                    .map((cell, index) => {
                      const label = words(block.header[index] ?? []);
                      return label === "" ? cell : `${label}: ${cell}`;
                    })
                    .join(", "),
                ),
              )
              .join(" "),
      );
    }
  }
  return out.join(use === "copy" ? "\n\n" : " ");
}

/** Where a link in an answer may lead: the web, or a page of this app. Nothing else. */
export function safeHref(target: string): string | null {
  const value = target.trim();
  if (/^https?:\/\/[^\s]+$/i.test(value)) {
    return value;
  }
  if (/^\/(?!\/)[^\s]*$/.test(value)) {
    return value;
  }
  return null;
}

// Code first, so nothing inside it is read as markup; then citations, links, bold, italics.
const INLINE =
  /`([^`]+)`|\[\^(\d{1,2})\]|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|(?<![\w])_(?![\s_])(.+?)(?<![\s_])_(?![\w])/g;

function inline(
  text: string,
  style: Omit<Inline, "text"> = { strong: false },
): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  const plain = (value: string) => {
    if (value !== "") {
      parts.push({ ...style, text: value });
    }
  };
  for (const match of text.matchAll(INLINE)) {
    plain(text.slice(last, match.index));
    const [, code, cite, label, href, strong, em, underscored] = match;
    if (code !== undefined) {
      parts.push({ ...style, text: code, code: true });
    } else if (cite !== undefined) {
      // A checked citation, [^n], renders as a source chip.
      parts.push({ text: "", strong: false, cite: Number(cite) });
    } else if (label !== undefined && href !== undefined) {
      const safe = safeHref(href);
      parts.push(
        ...inline(label, safe === null ? style : { ...style, href: safe }),
      );
    } else if (strong !== undefined) {
      parts.push(...inline(strong, { ...style, strong: true }));
    } else {
      parts.push(...inline(em ?? underscored ?? "", { ...style, em: true }));
    }
    last = match.index + match[0].length;
  }
  plain(text.slice(last));
  return parts;
}

export type ConsoleIntent =
  | "ask"
  | "confirm"
  | "confirm-all"
  | "cancel"
  | "retry"
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
  if (intent === "confirm-all" || intent === "retry") {
    const message = fields.message_id ?? "";
    const verb = intent === "retry" ? "retry" : "confirm";
    return UUID.test(message)
      ? { intent, path: `${base}/messages/${message}/${verb}`, body: null }
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
  | "settled"
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
  settled:
    "Only the latest answer can be retried, once the agent has finished.",
  new: "",
};

export function consoleNoticeFor(
  intent: ConsoleIntent,
  status: number,
): ConsoleNotice {
  if (status === 200) {
    return intent === "ask" || intent === "retry"
      ? "sent"
      : intent === "cancel"
        ? "cancelled"
        : intent === "new-thread"
          ? "new"
          : "confirmed";
  }
  if (status === 409) {
    return intent === "ask" ? "busy" : intent === "retry" ? "settled" : "stale";
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

/** The person's conversations by when they last moved, newest first, by their own calendar. */
export function threadGroups<T extends { updatedAt: string }>(
  threads: readonly T[],
  now: Date,
): Array<{ label: string; threads: T[] }> {
  const day = (value: Date) =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) /
    86_400_000;
  const today = day(now);
  const labels = [
    "Today",
    "Yesterday",
    "Previous 7 days",
    "Previous 30 days",
    "Older",
  ];
  const groups = labels.map((label) => ({ label, threads: [] as T[] }));
  for (const thread of threads) {
    const at = new Date(thread.updatedAt);
    const ago = Number.isNaN(at.getTime())
      ? Number.POSITIVE_INFINITY
      : today - day(at);
    const index =
      ago <= 0 ? 0 : ago === 1 ? 1 : ago <= 7 ? 2 : ago <= 30 ? 3 : 4;
    groups[index]?.threads.push(thread);
  }
  return groups.filter((group) => group.threads.length > 0);
}

/** A greeting for the hour of the person's own day. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) {
    return "Good morning";
  }
  if (hour >= 12 && hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

/**
 * An answer still being written, ready to show: a table row that is not finished waits
 * for its end, and bold or code that is open is closed, so the words show styled as they
 * arrive instead of as markup.
 */
export function writtenSoFar(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  if ((trimmed.match(/^\s*```/gm) ?? []).length % 2 === 1) {
    // Inside a code block, nothing is markup.
    return trimmed;
  }
  let shown = trimmed
    .replace(/(^|\n)[ \t]*\|[^\n]*$/, (row, start: string) =>
      /\|\s*$/.test(row) && row.trim().length > 1 ? row : start,
    )
    .replace(/\s+$/, "");
  const outside = shown.replace(/`[^`\n]*`/g, "");
  if ((outside.match(/`/g) ?? []).length % 2 === 1) {
    shown += "`";
  } else if ((outside.match(/\*\*/g) ?? []).length % 2 === 1) {
    shown += "**";
  }
  return shown;
}

/** What became of a settled step, and who decided it. */
export function stepOutcome(action: {
  status: ConsoleAction["status"];
  decidedBy: string | null;
}): string {
  const by = action.decidedBy;
  switch (action.status) {
    case "DONE":
      return by === null ? "Done" : `Approved by ${by}`;
    case "CANCELLED":
      return by === null ? "Skipped" : `Skipped by ${by}`;
    case "FAILED":
      return by === null
        ? "Did not run"
        : `Approved by ${by}, but it did not run`;
    default:
      return "Waiting for you";
  }
}
