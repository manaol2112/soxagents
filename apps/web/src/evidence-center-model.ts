/**
 * The engagement's evidence command center (GET …/evidence-requests): every request on
 * one list, filtered, sorted, and paged by the API; the figures and saved views; and the
 * changes the page makes to one request or many, each checked here before it reaches
 * the API, which checks again. The list's state lives in the address, so a link or a
 * refresh shows the same requests.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const TOKEN = /^[A-Za-z0-9_.@ +/&()-]{1,200}$/;
const TYPE_KEY = /^[A-Z][A-Z_]{1,39}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SECRET =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

export const MAX_BULK = 500;
export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const SORTS = [
  "title",
  "control",
  "system",
  "phase",
  "type",
  "owner",
  "stage",
  "due",
  "agent",
] as const;
export type Sort = (typeof SORTS)[number];

export const KPIS = [
  "needs_assignment",
  "awaiting_approval",
  "awaiting_client",
  "received",
  "needs_review",
  "overdue",
  "completed",
] as const;
export type Kpi = (typeof KPIS)[number];

export const KPI_LABELS: Record<Kpi, string> = {
  needs_assignment: "Needs assignment",
  awaiting_approval: "Awaiting approval",
  awaiting_client: "Awaiting client",
  received: "Evidence received",
  needs_review: "Needs review",
  overdue: "Overdue",
  completed: "Completed",
};

export type Stage =
  | "DRAFT"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "SENT"
  | "AWAITING_EVIDENCE"
  | "EVIDENCE_RECEIVED"
  | "UNDER_REVIEW"
  | "COMPLETED"
  | "CHANGES_REQUESTED"
  | "PARTIALLY_RECEIVED"
  | "CLARIFICATION_NEEDED"
  | "REJECTED"
  | "CANCELLED";

export const STAGE_TONES: Record<Stage, string> = {
  DRAFT: "neutral",
  READY_FOR_REVIEW: "info",
  APPROVED: "info",
  SENT: "info",
  AWAITING_EVIDENCE: "info",
  EVIDENCE_RECEIVED: "warning",
  UNDER_REVIEW: "warning",
  COMPLETED: "success",
  CHANGES_REQUESTED: "warning",
  PARTIALLY_RECEIVED: "warning",
  CLARIFICATION_NEEDED: "warning",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

export const PHASE_LABELS: Record<string, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
  RETEST: "Retest",
  REMEDIATION: "Remediation",
  NONE: "No phase",
};

export type CenterRow = {
  id: string;
  reference: string;
  title: string;
  controlId: string | null;
  controlRef: string;
  controlTitle: string;
  systems: string[];
  phase: string | null;
  type: string;
  typeLabel: string;
  typeUncertain: boolean;
  recipient: string;
  recipientName: string;
  ccCount: number;
  status: string;
  stage: Stage;
  stageLabel: string;
  overdue: boolean;
  escalated: boolean;
  clarification: boolean;
  held: boolean;
  /** Why it waits, when held: "Awaiting plan approval", "Awaiting attributes". */
  heldReason: string;
  /** The test plan's approved attributes its items evidence, by code (internal). */
  supports: string[];
  dueAt: string;
  priority: "NORMAL" | "HIGH" | "URGENT";
  agent:
    | "DRAFTING"
    | "TYPE_TO_CONFIRM"
    | "READY_FOR_REVIEW"
    | "READING"
    | "NONE";
  agentLabel: string;
  draftedBy: "AGENT" | "PERSON";
  files: number;
  version: number;
  approvalId: string | null;
  approvalDecision:
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "FAILED"
    | "RESEND"
    | null;
  approvalReason: string | null;
  approvalDecidedBy: string | null;
  viewerCanDecide: boolean;
  kickoff: boolean;
};

export type Facet = { key: string; label: string; count: number };
export type SavedView = {
  id: string;
  name: string;
  builtIn: boolean;
  filters: Record<string, unknown>;
};
export type ControlOption = {
  id: string;
  ref: string;
  title: string;
  systems: string[];
};
export type TypeOption = { key: string; label: string; purpose: string };

export type CenterList = {
  rows: CenterRow[];
  matching: { id: string; version: number }[];
  total: number;
  page: number;
  size: number;
  kpis: Record<Kpi | "total", number>;
  facets: Record<"stage" | "phase" | "type" | "owner" | "system", Facet[]>;
  views: SavedView[];
  controls: ControlOption[];
  types: TypeOption[];
  /** What generating requests would do: controls to plan, controls to request. */
  unplanned: number;
  unrequested: number;
  canAct: boolean;
  canApprove: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const STAGES = new Set<string>(Object.keys(STAGE_TONES));

function parseRow(value: Record<string, unknown>): CenterRow | null {
  if (!UUID.test(str(value.id)) || !STAGES.has(str(value.stage))) {
    return null;
  }
  const decision = str(value.approval_decision);
  const agent = str(value.agent);
  const priority = str(value.priority);
  return {
    id: str(value.id),
    reference: str(value.reference),
    title: str(value.title) || "Evidence request",
    controlId: UUID.test(str(value.control_id)) ? str(value.control_id) : null,
    controlRef: str(value.control_ref),
    controlTitle: str(value.control_title),
    systems: strings(value.systems),
    phase: typeof value.phase === "string" ? value.phase : null,
    type: str(value.request_type),
    typeLabel: str(value.type_label),
    typeUncertain: value.type_uncertain === true,
    recipient: str(value.recipient),
    recipientName: str(value.recipient_name),
    ccCount: num(value.cc_count),
    status: str(value.status),
    stage: str(value.stage) as Stage,
    stageLabel: str(value.stage_label),
    overdue: value.overdue === true,
    escalated: value.escalated === true,
    clarification: value.clarification === true,
    held: value.held === true,
    heldReason:
      str(value.held_reason) ||
      (value.held === true ? "Held for planning" : ""),
    supports: Array.isArray(value.supports)
      ? value.supports.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    dueAt: str(value.due_at),
    priority:
      priority === "HIGH" || priority === "URGENT" ? priority : "NORMAL",
    agent:
      agent === "DRAFTING" ||
      agent === "TYPE_TO_CONFIRM" ||
      agent === "READY_FOR_REVIEW" ||
      agent === "READING"
        ? agent
        : "NONE",
    agentLabel: str(value.agent_label),
    draftedBy: value.drafted_by === "AGENT" ? "AGENT" : "PERSON",
    files: num(value.files),
    version: num(value.version) || 1,
    approvalId: UUID.test(str(value.approval_id))
      ? str(value.approval_id)
      : null,
    approvalDecision:
      decision === "PENDING" ||
      decision === "APPROVED" ||
      decision === "REJECTED" ||
      decision === "EXPIRED" ||
      decision === "FAILED" ||
      decision === "RESEND"
        ? decision
        : null,
    approvalReason:
      typeof value.approval_reason === "string" ? value.approval_reason : null,
    approvalDecidedBy:
      typeof value.approval_decided_by === "string"
        ? value.approval_decided_by
        : null,
    viewerCanDecide: value.viewer_can_decide === true,
    kickoff: value.kickoff === true,
  };
}

const facets = (value: unknown): Facet[] =>
  records(value).map((item) => ({
    key: str(item.key),
    label: str(item.label),
    count: num(item.count),
  }));

/** The API's list, or null when it is not well formed. */
export function parseCenterList(value: unknown): CenterList | null {
  if (!isRecord(value) || !Array.isArray(value.rows) || !isRecord(value.kpis)) {
    return null;
  }
  const kpis = value.kpis;
  const facetBody = isRecord(value.facets) ? value.facets : {};
  return {
    rows: records(value.rows)
      .map(parseRow)
      .filter((row): row is CenterRow => row !== null),
    matching: records(value.matching)
      .filter((item) => UUID.test(str(item.id)))
      .map((item) => ({ id: str(item.id), version: num(item.version) || 1 })),
    total: num(value.total),
    page: num(value.page) || 1,
    size: num(value.size) || 50,
    kpis: {
      total: num(kpis.total),
      ...Object.fromEntries(KPIS.map((key) => [key, num(kpis[key])])),
    } as Record<Kpi | "total", number>,
    facets: {
      stage: facets(facetBody.stage),
      phase: facets(facetBody.phase),
      type: facets(facetBody.type),
      owner: facets(facetBody.owner),
      system: facets(facetBody.system),
    },
    views: records(value.views).map((item) => ({
      id: str(item.id),
      name: str(item.name),
      builtIn: item.built_in === true,
      filters: isRecord(item.filters) ? item.filters : {},
    })),
    controls: records(value.controls)
      .filter((item) => UUID.test(str(item.id)))
      .map((item) => ({
        id: str(item.id),
        ref: str(item.control_ref),
        title: str(item.title),
        systems: strings(item.systems),
      })),
    types: records(value.types)
      .filter((item) => TYPE_KEY.test(str(item.request_type)))
      .map((item) => ({
        key: str(item.request_type),
        label: str(item.label),
        purpose: str(item.purpose),
      })),
    unplanned: num(value.unplanned),
    unrequested: num(value.unrequested),
    canAct: value.can_act === true,
    canApprove: value.can_approve === true,
  };
}

// The list's state, in the page's address. Request list parameters carry an "r" so they
// never collide with the Evidence Library's file search.

export type CenterQuery = {
  q: string;
  stage: string[];
  phase: string[];
  type: string[];
  owner: string[];
  system: string[];
  kpi: Kpi | null;
  view: string;
  sort: Sort;
  dir: "asc" | "desc";
  page: number;
  size: number;
  /** The request open in the side panel. */
  request: string | null;
  /** The new request panel is open. */
  creating: boolean;
};

export const DEFAULT_QUERY: CenterQuery = {
  q: "",
  stage: [],
  phase: [],
  type: [],
  owner: [],
  system: [],
  kpi: null,
  view: "all",
  sort: "stage",
  dir: "asc",
  page: 1,
  size: 50,
  request: null,
  creating: false,
};

const list = (value: string | null): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => TOKEN.test(item))
    .slice(0, 50);

/** The list's state from the page's parameters; anything malformed is left out. */
export function parseCenterQuery(
  get: (name: string) => string | null,
): CenterQuery {
  const sort = get("rsort");
  const kpi = get("rkpi");
  const size = Number(get("rsize"));
  const page = Number(get("rpage"));
  const view = get("rview") ?? "";
  const request = get("request");
  return {
    q: (get("rq") ?? "").trim().slice(0, 200),
    stage: list(get("rstage")),
    phase: list(get("rphase")),
    type: list(get("rtype")),
    owner: list(get("rowner")),
    system: list(get("rsystem")),
    kpi: KPIS.includes(kpi as Kpi) ? (kpi as Kpi) : null,
    view: /^[a-z]{2,12}$/.test(view) || UUID.test(view) ? view : "all",
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : "stage",
    dir: get("rdir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    size: PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number]) ? size : 50,
    request: request !== null && UUID.test(request) ? request : null,
    creating: get("rnew") === "1",
  };
}

/** The API's query string for the list. */
export function apiQuery(query: CenterQuery): string {
  const params = new URLSearchParams();
  if (query.q !== "") params.set("q", query.q);
  for (const name of ["stage", "phase", "type", "owner", "system"] as const) {
    if (query[name].length > 0) params.set(name, query[name].join(","));
  }
  if (query.kpi !== null) params.set("kpi", query.kpi);
  params.set("view", query.view);
  params.set("sort", query.sort);
  params.set("dir", query.dir);
  params.set("page", String(query.page));
  params.set("size", String(query.size));
  return params.toString();
}

/** The page's address for the list with some of its state changed. A change of filters
 * goes back to the first page. */
export function centerHref(
  ids: { organizationId: string; projectId: string },
  query: CenterQuery,
  patch: Partial<CenterQuery>,
): string {
  const next = { ...query, ...patch };
  const filtering = Object.keys(patch).some(
    (key) =>
      !["page", "size", "request", "creating", "sort", "dir"].includes(key),
  );
  if (filtering && patch.page === undefined) {
    next.page = 1;
  }
  const params = new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
    section: "evidence",
  });
  if (next.q !== "") params.set("rq", next.q);
  for (const [name, key] of [
    ["stage", "rstage"],
    ["phase", "rphase"],
    ["type", "rtype"],
    ["owner", "rowner"],
    ["system", "rsystem"],
  ] as const) {
    if (next[name].length > 0) params.set(key, next[name].join(","));
  }
  if (next.kpi !== null) params.set("rkpi", next.kpi);
  if (next.view !== "all") params.set("rview", next.view);
  if (next.sort !== "stage") params.set("rsort", next.sort);
  if (next.dir !== "asc") params.set("rdir", next.dir);
  if (next.page !== 1) params.set("rpage", String(next.page));
  if (next.size !== 50) params.set("rsize", String(next.size));
  if (next.request !== null) params.set("request", next.request);
  if (next.creating) params.set("rnew", "1");
  return `/?${params.toString()}`;
}

/** Whether any filter narrows the list (the view and figure included). */
export function filtered(query: CenterQuery): boolean {
  return (
    query.q !== "" ||
    query.stage.length > 0 ||
    query.phase.length > 0 ||
    query.type.length > 0 ||
    query.owner.length > 0 ||
    query.system.length > 0 ||
    query.kpi !== null ||
    query.view !== "all"
  );
}

/** A saved view's filters as the list's state. */
export function viewQuery(view: SavedView): Partial<CenterQuery> {
  const filters = view.filters;
  const kpi = str(filters.kpi);
  return {
    view: view.builtIn ? view.id : view.id,
    q: str(filters.q),
    stage: strings(filters.stage),
    phase: strings(filters.phase),
    type: strings(filters.type),
    owner: strings(filters.owner),
    system: strings(filters.system),
    kpi: KPIS.includes(kpi as Kpi) ? (kpi as Kpi) : null,
  };
}

// Writes.

export type BulkAction =
  | "ASSIGN"
  | "DUE"
  | "PRIORITY"
  | "APPROVE"
  | "APPROVE_SEND"
  | "SUBMIT"
  | "RETURN";

export const BULK_LABELS: Record<BulkAction, string> = {
  ASSIGN: "Assign owner",
  DUE: "Change due date",
  PRIORITY: "Set priority",
  APPROVE: "Approve",
  APPROVE_SEND: "Approve and send",
  SUBMIT: "Submit for approval",
  RETURN: "Return for changes",
};

export type CenterIntent =
  | "bulk"
  | "contact"
  | "view-save"
  | "view-remove"
  | "create"
  | "request-planned";

export type CenterWrite =
  | { error: "invalid" }
  | { intent: CenterIntent; path: string; body: Record<string, unknown> };

type Fields = Record<string, unknown>;
const text = (fields: Fields, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string).trim() : "";

function items(value: unknown): { id: string; version: number }[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK) {
    return null;
  }
  const found: { id: string; version: number }[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = str(item.id);
    const version = Number(item.version);
    if (
      !UUID.test(id) ||
      seen.has(id) ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      return null;
    }
    seen.add(id);
    found.push({ id, version });
  }
  return found;
}

/** The API call for one change, checked before it is sent. */
export function centerWrite(fields: Fields): CenterWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const project = `/organizations/${organizationId}/projects/${projectId}`;
  const intent = text(fields, "intent") as CenterIntent;
  switch (intent) {
    case "bulk": {
      const action = text(fields, "action") as BulkAction;
      const chosen = items(fields.items);
      if (!(action in BULK_LABELS) || chosen === null) {
        return { error: "invalid" };
      }
      const body: Record<string, unknown> = {
        action,
        items: chosen,
        preview: fields.preview === true,
      };
      if (action === "ASSIGN") {
        const recipient = text(fields, "recipient").toLowerCase();
        if (!EMAIL.test(recipient)) return { error: "invalid" };
        body.recipient = recipient;
      }
      if (action === "DUE") {
        const due = text(fields, "due_on");
        if (!DATE.test(due)) return { error: "invalid" };
        body.due_on = due;
      }
      if (action === "PRIORITY") {
        const priority = text(fields, "priority");
        if (!["NORMAL", "HIGH", "URGENT"].includes(priority)) {
          return { error: "invalid" };
        }
        body.priority = priority;
      }
      if (
        action === "APPROVE" ||
        action === "APPROVE_SEND" ||
        action === "RETURN"
      ) {
        const reason = text(fields, "reason");
        if (reason.length > 500 || SECRET.test(reason))
          return { error: "invalid" };
        if (action === "RETURN" && reason.length < 3)
          return { error: "invalid" };
        body.reason = reason;
      }
      return { intent, path: `${project}/evidence-requests/bulk`, body };
    }
    case "contact": {
      // A new engagement contact, added from a request's owner in the list (the same
      // call and checks as the request's own panel, request-details-model).
      const name = text(fields, "name");
      const email = text(fields, "email").toLowerCase();
      const role = text(fields, "role");
      return name === "" ||
        name.length > 200 ||
        role.length > 120 ||
        !EMAIL.test(email) ||
        SECRET.test(`${name} ${role}`)
        ? { error: "invalid" }
        : {
            intent,
            path: `${project}/engagement-contacts`,
            body: { name, email, role },
          };
    }
    case "view-save": {
      const name = text(fields, "name");
      const filters = isRecord(fields.filters) ? fields.filters : null;
      if (
        name === "" ||
        name.length > 60 ||
        filters === null ||
        SECRET.test(name)
      ) {
        return { error: "invalid" };
      }
      return {
        intent,
        path: `${project}/evidence-views`,
        body: { name, filters },
      };
    }
    case "view-remove": {
      const viewId = text(fields, "view_id");
      return UUID.test(viewId)
        ? {
            intent,
            path: `${project}/evidence-views/${viewId}/remove`,
            body: {},
          }
        : { error: "invalid" };
    }
    case "request-planned": {
      const controlId = text(fields, "control_id");
      return UUID.test(controlId)
        ? {
            intent,
            path: `${project}/controls/${controlId}/evidence-plan/request-planned`,
            body: {},
          }
        : { error: "invalid" };
    }
    case "create": {
      const controlId = text(fields, "control_id");
      const controlRef = text(fields, "control_ref");
      const description =
        typeof fields.description === "string" ? fields.description.trim() : "";
      const title = text(fields, "title");
      const recipient = text(fields, "recipient").toLowerCase();
      const cc = strings(fields.cc)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const due = text(fields, "due_on");
      const phase = text(fields, "phase");
      const type = text(fields, "request_type");
      const priority = text(fields, "priority") || "NORMAL";
      const key = text(fields, "operation_key");
      const days = Number(fields.follow_up_after_days ?? 3);
      const most = Number(fields.max_follow_ups ?? 2);
      if (
        !UUID.test(controlId) ||
        controlRef === "" ||
        !KEY.test(key) ||
        description.length < 10 ||
        description.length > 80_000 ||
        title.length > 160 ||
        SECRET.test(`${description} ${title}`) ||
        (recipient !== "" && !EMAIL.test(recipient)) ||
        cc.length > 10 ||
        cc.some((item) => !EMAIL.test(item) || item === recipient) ||
        new Set(cc).size !== cc.length ||
        !DATE.test(due) ||
        !["DESIGN", "INTERIM", "ROLLFORWARD"].includes(phase) ||
        (type !== "" && !TYPE_KEY.test(type)) ||
        !["NORMAL", "HIGH", "URGENT"].includes(priority) ||
        !Number.isInteger(days) ||
        days < 1 ||
        days > 30 ||
        !Number.isInteger(most) ||
        most < 0 ||
        most > 10
      ) {
        return { error: "invalid" };
      }
      return {
        intent,
        path: `${project}/pbc-requests`,
        body: {
          operation_key: key,
          control_ref: controlRef,
          engagement_control_id: controlId,
          recipient,
          cc_recipients: cc,
          due_at: `${due}T23:59:00+00:00`,
          evidence_description: description,
          testing_phase: phase,
          request_type: type === "" ? null : type,
          title,
          priority,
          follow_up_after_days: days,
          max_follow_ups: most,
        },
      };
    }
    default:
      return { error: "invalid" };
  }
}

/** The page's own route for the filtered list as a spreadsheet. */
export function exportHref(
  ids: { organizationId: string; projectId: string },
  query: CenterQuery,
): string {
  const params = new URLSearchParams(apiQuery(query));
  params.set("organization", ids.organizationId);
  params.set("project", ids.projectId);
  return `/workspace/evidence-center?${params.toString()}`;
}

export type BulkOutcome = {
  id: string;
  reference: string;
  title: string;
  ok: boolean;
  detail: string;
};

/**
 * What a change to many requests did, in one line. Approve and send says how many went
 * out, and how many were approved but not sent (the approval stands; the reason is listed
 * with each), apart from those that could not change at all.
 */
export function bulkSummary(
  action: BulkAction,
  result: { done: number; refused: number; outcomes: BulkOutcome[] },
): string {
  const n = (count: number) => `${count} request${count === 1 ? "" : "s"}`;
  if (action === "APPROVE_SEND") {
    const held = result.outcomes.filter(
      (item) => !item.ok && item.detail.startsWith("Approved"),
    ).length;
    const refused = result.refused - held;
    return [
      `${n(result.done)} approved and sent`,
      held > 0 ? `${held} approved but not sent` : "",
      refused > 0 ? `${refused} could not change` : "",
    ]
      .filter((part) => part !== "")
      .join("; ")
      .concat(".");
  }
  return `${n(result.done)} updated${result.refused > 0 ? `; ${result.refused} could not change` : ""}.`;
}

export function parseBulkResult(
  value: unknown,
): { done: number; refused: number; outcomes: BulkOutcome[] } | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    done: num(value.done),
    refused: num(value.refused),
    outcomes: records(value.outcomes).map((item) => ({
      id: str(item.id),
      reference: str(item.reference),
      title: str(item.title),
      ok: item.ok === true,
      detail: str(item.detail),
    })),
  };
}
