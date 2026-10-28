/**
 * The control's evidence as the requests it travels in (product owner, 27 October 2026):
 * a numbered list of requests, each with its phase, where it stands, the items it carries,
 * the attributes they support, and how much has been provided; and, for one request, its
 * items, attributes, procedures, guidance, and activity.
 *
 * A phase asks for what one request carries: design, its documents and one walkthrough; an
 * operating phase, the full list first, then (once the list is in and samples are selected)
 * one request for the selected samples. Requests are read from the plan's items; this module
 * only groups, counts, and filters them. Received is never accepted.
 */

import type { ActivityItem } from "./control-workspace-model.ts";
import type {
  EvidencePlan,
  Phase,
  PlanPhase,
  PlanRequirement,
  RequirementState,
} from "./evidence-plan-model.ts";
import { planAwaitsApproval } from "./evidence-plan-model.ts";
import type { RequestRow } from "./evidence-workspace-model.ts";
import type { MasterPlan } from "./planning-model.ts";

export const REQUEST_PHASES: readonly Phase[] = [
  "DESIGN",
  "INTERIM",
  "ROLLFORWARD",
];

export const REQUEST_PHASE_LABELS: Record<Phase, string> = {
  DESIGN: "Design & Implementation",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
};

/** Where one item stands, as the request list says it. */
export type ItemStatus =
  | "NOT_REQUESTED"
  | "WAITING"
  | "MISSING"
  | "PROVIDED"
  | "IN_REVIEW"
  | "ACCEPTED"
  | "FOLLOW_UP"
  | "NOT_APPLICABLE";

export const ITEM_STATUS: Record<ItemStatus, { label: string; tone: string }> =
  {
    NOT_REQUESTED: { label: "Not requested", tone: "is-idle" },
    WAITING: { label: "Waits for the list", tone: "is-idle" },
    MISSING: { label: "Missing", tone: "is-warn" },
    PROVIDED: { label: "Provided", tone: "is-info" },
    IN_REVIEW: { label: "In review", tone: "is-info" },
    ACCEPTED: { label: "Accepted", tone: "is-done" },
    FOLLOW_UP: { label: "Follow-up", tone: "is-danger" },
    NOT_APPLICABLE: { label: "Not applicable", tone: "is-idle" },
  };

export function itemStatus(state: RequirementState): ItemStatus {
  switch (state) {
    case "AWAITING_DEPENDENCY":
      return "WAITING";
    case "SENT":
    case "OVERDUE":
      return "MISSING";
    case "PARTIALLY_RECEIVED":
    case "RECEIVED":
      return "PROVIDED";
    case "UNDER_REVIEW":
      return "IN_REVIEW";
    case "ACCEPTED":
      return "ACCEPTED";
    case "INSUFFICIENT":
    case "FOLLOW_UP_REQUIRED":
      return "FOLLOW_UP";
    case "NOT_APPLICABLE":
      return "NOT_APPLICABLE";
    default:
      return "NOT_REQUESTED";
  }
}

/** Something arrived for the item (judged or not). */
const ARRIVED: ReadonlySet<ItemStatus> = new Set([
  "PROVIDED",
  "IN_REVIEW",
  "ACCEPTED",
  "FOLLOW_UP",
]);

/** Where one request stands. */
export type RequestStatus =
  | "PROPOSED"
  | "NOT_REQUESTED"
  | "WAITING"
  | "DRAFTING"
  | "AWAITING_EVIDENCE"
  | "OVERDUE"
  | "IN_PROGRESS"
  | "NEEDS_REVIEW"
  | "COMPLETE"
  | "NOT_APPLICABLE";

export const REQUEST_STATUS: Record<
  RequestStatus,
  { label: string; tone: string }
> = {
  PROPOSED: { label: "Proposed", tone: "is-idle" },
  NOT_REQUESTED: { label: "Not requested", tone: "is-idle" },
  WAITING: { label: "Waits for the list", tone: "is-idle" },
  DRAFTING: { label: "Drafting", tone: "is-info" },
  AWAITING_EVIDENCE: { label: "Awaiting evidence", tone: "is-info" },
  OVERDUE: { label: "Overdue", tone: "is-danger" },
  IN_PROGRESS: { label: "In progress", tone: "is-info" },
  NEEDS_REVIEW: { label: "Needs review", tone: "is-warn" },
  COMPLETE: { label: "Complete", tone: "is-done" },
  NOT_APPLICABLE: { label: "Not applicable", tone: "is-idle" },
};

/** The status filter's groups. */
export const STATUS_FILTERS = [
  ["all", "All statuses"],
  ["not-requested", "Not requested"],
  ["in-progress", "In progress"],
  ["needs-review", "Needs review"],
  ["complete", "Complete"],
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number][0];

const STATUS_GROUP: Record<RequestStatus, StatusFilter> = {
  PROPOSED: "not-requested",
  NOT_REQUESTED: "not-requested",
  WAITING: "not-requested",
  DRAFTING: "not-requested",
  AWAITING_EVIDENCE: "in-progress",
  OVERDUE: "in-progress",
  IN_PROGRESS: "in-progress",
  NEEDS_REVIEW: "needs-review",
  COMPLETE: "complete",
  NOT_APPLICABLE: "complete",
};

/** The usual form of an item, by what it is (guidance for the owner, not a rule). */
const FORMATS: Record<string, string> = {
  POPULATION: "Excel or CSV export from the system",
  SAMPLE: "Records, tickets, or screenshots for each selected item",
  CONFIGURATION: "Screenshot or export of the setting",
  CHANGE_HISTORY: "Change log or audit trail export",
  PROCESS_DOCUMENTATION: "PDF or Word document",
  CONTROL_EXECUTION: "Ticket, email, or system record",
  REPORT_RELIABILITY: "Report output with its parameters",
  OTHER: "Any readable file",
};

export type RequestItem = {
  item: PlanRequirement;
  /** The plan's code for it (E1, E2), when the test plan holds it. */
  code: string;
  status: ItemStatus;
  format: string;
  /** The window it covers. */
  population: string;
  attributeCodes: string[];
  procedureCodes: string[];
};

export type EvidenceRequest = {
  /** Stable within the control: the phase and its part. */
  key: string;
  number: number;
  phase: Phase;
  /** MAIN: what the phase asks first; SAMPLES: what the selected samples need. */
  part: "MAIN" | "SAMPLES";
  title: string;
  description: string;
  items: RequestItem[];
  status: RequestStatus;
  /** Applicable items, and how many of them have something provided. */
  total: number;
  provided: number;
  attributeCodes: string[];
  procedureCodes: string[];
  /** The request it went out on, once drafted. */
  request: RequestRow | null;
  recipient: string;
};

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].filter((value) => value !== "");
}

function day(value: string | null): string {
  if (value === null || value === "") {
    return "";
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

/** The phase's window, as the item card shows it. */
export function phaseWindow(phase: PlanPhase): string {
  const start = day(phase.periodStart);
  const end = day(phase.periodEnd);
  return start !== "" && end !== ""
    ? `${start} – ${end}`
    : end !== ""
      ? `As at ${end}`
      : "";
}

function requestStatus(
  items: RequestItem[],
  request: RequestRow | null,
  proposed: boolean,
): RequestStatus {
  const live = items.filter((i) => i.status !== "NOT_APPLICABLE");
  if (live.length === 0) {
    return "NOT_APPLICABLE";
  }
  if (proposed && live.every((i) => i.status === "NOT_REQUESTED")) {
    return "PROPOSED";
  }
  if (live.every((i) => i.status === "ACCEPTED")) {
    return "COMPLETE";
  }
  if (live.some((i) => i.status === "PROVIDED" || i.status === "FOLLOW_UP")) {
    return "NEEDS_REVIEW";
  }
  if (live.some((i) => ARRIVED.has(i.status))) {
    return "IN_PROGRESS";
  }
  if (live.some((i) => i.item.state === "OVERDUE")) {
    return "OVERDUE";
  }
  if (live.some((i) => i.status === "MISSING")) {
    return "AWAITING_EVIDENCE";
  }
  if (live.every((i) => i.status === "WAITING")) {
    return "WAITING";
  }
  return request !== null ? "DRAFTING" : "NOT_REQUESTED";
}

function titleOf(phase: Phase, part: "MAIN" | "SAMPLES", items: RequestItem[]) {
  const first = items[0]?.item.title ?? "";
  if (part === "MAIN" && phase === "DESIGN" && items.length > 1) {
    return "How the control is designed and works";
  }
  return first;
}

/** The control's requests, in the order they are asked for. */
export function evidenceRequests(
  plan: EvidencePlan | null,
  requests: readonly RequestRow[],
  master: MasterPlan | null,
): EvidenceRequest[] {
  if (plan === null || plan.status === "NOT_PLANNED") {
    return [];
  }
  const proposed = planAwaitsApproval(plan);
  const coded = new Map((master?.evidence ?? []).map((e) => [e.id, e]));
  const found: EvidenceRequest[] = [];
  for (const phaseKey of REQUEST_PHASES) {
    const phase = plan.phases.find((p) => p.phase === phaseKey);
    if (phase === undefined || phase.applicability === "NOT_APPLICABLE") {
      continue;
    }
    const window = phaseWindow(phase);
    const items = phase.requirements
      .filter((q) => q.state !== "REMOVED")
      .map((q): RequestItem => {
        const plan = coded.get(q.id);
        return {
          item: q,
          code: plan?.code ?? "",
          status: itemStatus(q.state),
          format: FORMATS[q.categories[0] ?? "OTHER"] ?? FORMATS.OTHER ?? "",
          population: q.periodLabel || window,
          attributeCodes: plan?.attributeCodes ?? [],
          procedureCodes: plan?.procedureCodes ?? [],
        };
      });
    const parts: Array<["MAIN" | "SAMPLES", RequestItem[]]> = [
      ["MAIN", items.filter((i) => i.item.dependsOnTitle === null)],
      ["SAMPLES", items.filter((i) => i.item.dependsOnTitle !== null)],
    ];
    for (const [part, set] of parts) {
      if (set.length === 0) {
        continue;
      }
      const requestId = set.find((i) => i.item.requestId !== null)?.item
        .requestId;
      const request =
        requests.find((row) => row.id === requestId) ??
        (part === "MAIN"
          ? null
          : (requests.find(
              (row) => row.kind === "SAMPLES" && row.phase === phaseKey,
            ) ?? null));
      const live = set.filter((i) => i.status !== "NOT_APPLICABLE");
      found.push({
        key: `${phaseKey}-${part}`,
        number: found.length + 1,
        phase: phaseKey,
        part,
        title: titleOf(phaseKey, part, set),
        description:
          set[0]?.item.objective || set[0]?.item.rationale || phase.rationale,
        items: set,
        status: requestStatus(set, request, proposed),
        total: live.length,
        provided: live.filter((i) => ARRIVED.has(i.status)).length,
        attributeCodes: unique(set.flatMap((i) => i.attributeCodes)),
        procedureCodes: unique(set.flatMap((i) => i.procedureCodes)),
        request,
        recipient:
          request?.recipient ??
          set.find((i) => i.item.requestRecipient)?.item.requestRecipient ??
          "",
      });
    }
  }
  return found;
}

/** "2 of 3 provided (67%)", and the share for the bar. */
export function progressOf(
  request: Pick<EvidenceRequest, "total" | "provided">,
): {
  line: string;
  share: number;
} {
  const share =
    request.total === 0
      ? 0
      : Math.round((request.provided / request.total) * 100);
  return {
    line: `${request.provided} of ${request.total} provided (${share}%)`,
    share,
  };
}

export type RequestFilter = {
  phase: "all" | Phase;
  status: StatusFilter;
  assignee: string;
  search: string;
};

export const NO_FILTER: RequestFilter = {
  phase: "all",
  status: "all",
  assignee: "all",
  search: "",
};

/** The people the requests go to, for the assignee filter. */
export function assignees(requests: readonly EvidenceRequest[]): string[] {
  return unique(requests.map((r) => r.recipient)).sort((a, b) =>
    a.localeCompare(b),
  );
}

export const UNASSIGNED = "unassigned";

export function filterRequests(
  requests: readonly EvidenceRequest[],
  filter: RequestFilter,
): EvidenceRequest[] {
  const words = filter.search.trim().toLowerCase();
  return requests.filter(
    (r) =>
      (filter.phase === "all" || r.phase === filter.phase) &&
      (filter.status === "all" || STATUS_GROUP[r.status] === filter.status) &&
      (filter.assignee === "all" ||
        (filter.assignee === UNASSIGNED
          ? r.recipient === ""
          : r.recipient === filter.assignee)) &&
      (words === "" ||
        [r.title, r.description, ...r.items.map((i) => i.item.title)]
          .join(" ")
          .toLowerCase()
          .includes(words)),
  );
}

/** "These evidence items support 2 attributes across 2 procedures." */
export function mappingLine(request: EvidenceRequest): string {
  const a = request.attributeCodes.length;
  const p = request.procedureCodes.length;
  if (a === 0 && p === 0) {
    return "These evidence items are not linked to an attribute or procedure yet.";
  }
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  return `These evidence items support ${plural(a, "attribute")} across ${plural(p, "procedure")}.`;
}

/** A standard's wording read into its parts (evidence_planning.suite_wording); null for
 * any other wording. */
export type Wording = {
  lead: string;
  include: string[];
  completeness: string;
  notSufficient: string;
  alternatives: string[];
};

const LABELS = [
  "Include",
  "Completeness",
  "Not sufficient",
  "If not available",
];

export function wordingOf(description: string): Wording | null {
  const text = description.split(/\s+/).join(" ");
  const parts = text.split(
    /\s(Include|Completeness|Not sufficient|If not available): /,
  );
  if (parts.length < 3 || parts[1] !== "Include") {
    return null;
  }
  const found: Record<string, string> = {};
  for (let index = 1; index + 1 < parts.length; index += 2) {
    const label = parts[index] ?? "";
    if (LABELS.includes(label)) {
      found[label] = (parts[index + 1] ?? "").trim();
    }
  }
  const listed = (value: string | undefined) =>
    (value ?? "")
      .replace(/\.$/, "")
      .split(";")
      .map((part) => part.trim().replace(/\.$/, ""))
      .filter((part) => part !== "");
  return {
    lead: (parts[0] ?? "").trim().replace(/\.$/, ""),
    include: listed(found.Include),
    completeness: found.Completeness ?? "",
    notSufficient: found["Not sufficient"] ?? "",
    alternatives: listed(found["If not available"]),
  };
}

/** The item's description as one short line for its card: a standard's wording leads
 * with what it covers; any other wording is shown as written. */
export function itemSummary(description: string): string {
  const wording = wordingOf(description);
  if (wording === null) {
    return description;
  }
  const shown = wording.include.slice(0, 4).join(", ");
  const more =
    wording.include.length > 4
      ? `, and ${wording.include.length - 4} more`
      : "";
  return `${wording.lead}. Showing ${shown.charAt(0).toLowerCase()}${shown.slice(1)}${more}.`;
}

export type AttributeCoverage = {
  code: string;
  text: string;
  /** The items that support it, by phase. */
  byPhase: Record<Phase, RequestItem[]>;
  covered: boolean;
};

/** Each attribute of the test plan, and the evidence items that support it in each
 * phase. An attribute is covered when every operating phase the plan requests has an
 * item for it. */
export function attributeCoverage(
  requests: readonly EvidenceRequest[],
  master: MasterPlan | null,
): AttributeCoverage[] {
  const items = requests.flatMap((r) => r.items);
  const operating = unique(
    requests.filter((r) => r.phase !== "DESIGN").map((r) => r.phase),
  ) as Phase[];
  return (master?.attributes ?? []).map((attribute) => {
    const byPhase: Record<Phase, RequestItem[]> = {
      DESIGN: [],
      INTERIM: [],
      ROLLFORWARD: [],
    };
    for (const item of items) {
      if (item.attributeCodes.includes(attribute.code)) {
        byPhase[item.item.phase].push(item);
      }
    }
    return {
      code: attribute.code,
      text: attribute.text,
      byPhase,
      covered:
        operating.length > 0 && operating.every((p) => byPhase[p].length > 0),
    };
  });
}

export type ProcedureCoverage = {
  code: string;
  phase: Phase;
  text: string;
  items: RequestItem[];
};

/** Each procedure of the test plan, and the evidence items it is performed on. */
export function procedureCoverage(
  requests: readonly EvidenceRequest[],
  master: MasterPlan | null,
): ProcedureCoverage[] {
  const items = requests.flatMap((r) => r.items);
  return (master?.procedures ?? []).map((procedure) => ({
    code: procedure.code,
    phase: procedure.phase,
    text: procedure.text,
    items: items.filter((i) => i.procedureCodes.includes(procedure.code)),
  }));
}

/** The control's evidence activity that concerns the request: what names its reference
 * or one of its items, newest first; the control's evidence activity when nothing does. */
export function requestActivity(
  request: EvidenceRequest,
  activity: readonly ActivityItem[] | null,
): ActivityItem[] {
  const all = (activity ?? []).filter(
    (a) => a.category === "evidence" || a.category === "approval",
  );
  const names = [
    request.request?.title ?? "",
    ...request.items.map((i) => i.item.title),
    ...request.items.map((i) => i.item.requestReference ?? ""),
  ]
    .filter((name) => name.length > 3)
    .map((name) => name.toLowerCase());
  const about = all.filter((a) =>
    names.some((name) => `${a.title} ${a.detail}`.toLowerCase().includes(name)),
  );
  return [...(about.length > 0 ? about : all)]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);
}
