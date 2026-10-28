import type { Design } from "./control-context-model.ts";
import type { EngagementPhase } from "./engagement-lifecycle.ts";
import { formatDate } from "./format.ts";
import type { Policy, PriorYearReference } from "./references-model.ts";
import type { StandardMatches } from "./standard-matches-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The first day of the twelve months that end on `end`.
 * A year ending 31 December starts 1 January that year. A year ending
 * 31 March starts 1 April the year before. `end` is YYYY-MM-DD. */
export function periodStartFor(end: string): string | null {
  if (!DATE.test(end)) {
    return null;
  }
  const year = Number(end.slice(0, 4));
  const month = Number(end.slice(5, 7));
  const day = Number(end.slice(8, 10));
  const endUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    endUtc.getUTCFullYear() !== year ||
    endUtc.getUTCMonth() !== month - 1 ||
    endUtc.getUTCDate() !== day
  ) {
    return null;
  }
  const dayAfter = new Date(endUtc);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const start = new Date(
    Date.UTC(
      dayAfter.getUTCFullYear() - 1,
      dayAfter.getUTCMonth(),
      dayAfter.getUTCDate(),
    ),
  );
  const monthText = String(start.getUTCMonth() + 1).padStart(2, "0");
  const dayText = String(start.getUTCDate()).padStart(2, "0");
  return `${start.getUTCFullYear()}-${monthText}-${dayText}`;
}
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SECRET =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

export const SETUP_STEPS = [
  {
    id: "overview",
    title: "Overview",
    detail: "Where setup stands",
    readiness: [],
  },
  {
    id: "profile",
    title: "Engagement profile",
    detail: "Client, period, and scope",
    readiness: ["scope"],
  },
  {
    id: "team",
    title: "Team",
    detail: "Who leads, prepares, and reviews",
    readiness: ["team"],
  },
  {
    id: "controls",
    title: "Controls and systems",
    detail: "The RCM and the systems it runs on",
    readiness: ["rcm"],
  },
  {
    id: "workpapers",
    title: "Workpaper templates",
    detail: "How testing is documented",
    readiness: ["workpapers"],
  },
  {
    id: "launch",
    title: "Launch",
    detail: "Check the plan, start the agents",
    readiness: [],
  },
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number]["id"];

/** The steps a link may still name from before the redesign. */
const LEGACY_STEPS: Record<string, SetupStep> = {
  scope: "profile",
  rcm: "controls",
  workpapers: "workpapers",
  // Evidence requests left setup: a person approves each plan, then they are drafted.
  pbc: "launch",
  requests: "launch",
  start: "launch",
};

export function parseStep(value: string | null): SetupStep {
  if (value !== null && value in LEGACY_STEPS) {
    return LEGACY_STEPS[value] as SetupStep;
  }
  return SETUP_STEPS.find((step) => step.id === value)?.id ?? "overview";
}

/** The step a setup link opens. Without one, a launched engagement opens on the launch
 * step, where the work stands; one still being set up opens on the overview. */
export function landingStep(value: string | null, started: boolean): SetupStep {
  if ((value === null || value === "") && started) {
    return "launch";
  }
  return parseStep(value);
}

/** The steps a person works through, in order: everything but the overview and launch. */
export const WORK_STEPS: readonly SetupStep[] = [
  "profile",
  "team",
  "controls",
  "workpapers",
];

export const ENGAGEMENT_TYPES: ReadonlyArray<{
  id: "SOX_ITGC" | "SOX_FULL" | "IT_AUDIT";
  label: string;
  detail: string;
}> = [
  {
    id: "SOX_FULL",
    label: "SOX: IT and business process",
    detail:
      "IT general controls plus the business cycles, application controls, and key reports. The default.",
  },
  {
    id: "SOX_ITGC",
    label: "SOX: IT general controls only",
    detail:
      "Logical access, change management, and IT operations over the systems that support financial reporting.",
  },
  {
    id: "IT_AUDIT",
    label: "IT audit (non-SOX)",
    detail:
      "An IT audit outside SOX: the same controls, testing, and workpapers, reported on their own.",
  },
];

export type EngagementType = (typeof ENGAGEMENT_TYPES)[number]["id"];

export function engagementTypeLabel(value: string): string {
  return ENGAGEMENT_TYPES.find((type) => type.id === value)?.label ?? value;
}

/** How the engagement is run. Every one requires an independent reviewer. */
export const METHODOLOGIES: ReadonlyArray<{
  id: "EXTERNAL_ICFR" | "MANAGEMENT_404" | "INTERNAL_AUDIT";
  label: string;
  detail: string;
}> = [
  {
    id: "EXTERNAL_ICFR",
    label: "External audit of ICFR",
    detail: "PCAOB AS 2201, integrated with the financial statement audit.",
  },
  {
    id: "MANAGEMENT_404",
    label: "Management's SOX 404 testing",
    detail: "Testing that supports management's assessment of ICFR.",
  },
  {
    id: "INTERNAL_AUDIT",
    label: "Internal audit or IT audit",
    detail: "An internal audit function's own testing.",
  },
];

export function methodologyLabel(value: string | null): string {
  return (
    METHODOLOGIES.find((item) => item.id === value)?.label ?? "Not chosen yet"
  );
}

/** Where the period disagrees with the engagement's own words, and whether a person
 * confirmed it as recorded. Nothing changes a date on its own. */
export type PeriodCheck = {
  conflicts: Array<{
    kind: string;
    message: string;
    blocking: boolean;
    /** For a name that points at another year: the period end in that year, and the name
     * with the period's year; null where they do not apply. */
    periodEndFix: string | null;
    nameFix: string | null;
    /** For a scope or fiscal year label naming another year: the same words in the
     * period's year; null where they do not apply. */
    scopeFix: string | null;
    fiscalYearFix: string | null;
  }>;
  /** What a confirmation is for: any change to the name, scope, or dates asks again. */
  basis: string;
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

/** The disagreements that hold launch, or that a running engagement should settle. */
/** One correction the period check offers: what it changes, and its button's words. */
export type PeriodCorrection = {
  to: "period_end" | "name" | "scope" | "fiscal_year";
  label: string;
};

/** The corrections for the open conflicts, the words before the period: the scope or
 * fiscal year label follows the recorded period, and a name that points at another year
 * can move either way (decided by the product owner on 27 October 2026: correct the
 * conflict; confirming the period as recorded is the exception). */
export function periodCorrections(
  period: PeriodCheck | null,
  periodEnd: string | null,
): PeriodCorrection[] {
  if (period === null || period.confirmed) {
    return [];
  }
  const open = period.conflicts.filter((conflict) => conflict.blocking);
  const corrections: PeriodCorrection[] = [];
  const scope = open.find((conflict) => conflict.scopeFix !== null);
  if (scope !== undefined) {
    corrections.push({
      to: "scope",
      label:
        scope.kind === "SCOPE_YEAR" || periodEnd === null
          ? `Update the scope to fiscal year ${(periodEnd ?? "").slice(0, 4)}`
          : `Update the scope to ${formatDate(periodEnd)}`,
    });
  }
  const label = open.find((conflict) => conflict.fiscalYearFix !== null);
  if (label?.fiscalYearFix != null) {
    corrections.push({
      to: "fiscal_year",
      label: `Set the fiscal year to ${label.fiscalYearFix}`,
    });
  }
  const name = open.find((conflict) => conflict.kind === "NAME_YEAR");
  if (name?.periodEndFix != null) {
    corrections.push({
      to: "period_end",
      label: `Set the period end to ${formatDate(name.periodEndFix)}`,
    });
  }
  if (name?.nameFix != null) {
    corrections.push({ to: "name", label: `Rename to ${name.nameFix}` });
  }
  return corrections;
}

export function openConflicts(period: PeriodCheck | null): string[] {
  if (period === null || period.confirmed) {
    return [];
  }
  return period.conflicts
    .filter((conflict) => conflict.blocking)
    .map((conflict) => conflict.message);
}

export const FREQUENCIES: ReadonlyArray<[string, string]> = [
  ["ANNUAL", "Annual"],
  ["QUARTERLY", "Quarterly"],
  ["MONTHLY", "Monthly"],
  ["WEEKLY", "Weekly"],
  ["DAILY", "Daily"],
  ["RECURRING", "Multiple times a day"],
  ["EVENT_DRIVEN", "As events occur"],
];

export const NATURES: ReadonlyArray<[string, string]> = [
  ["MANUAL", "Manual"],
  ["IT_DEPENDENT_MANUAL", "IT-dependent manual"],
  ["AUTOMATED", "Automated"],
];

/**
 * The RCM's three kinds of control, each a set of standard areas. IT controls are
 * the IT general controls and automated application controls. Key reports are the
 * reports and other information produced by the entity that controls rely on.
 */
export const CONTROL_CATEGORIES = [
  {
    id: "it",
    label: "IT controls",
    detail: "IT general controls and application controls",
    domains: [
      ["ACCESS", "Logical access"],
      ["CHANGE", "Change management"],
      ["OPERATIONS", "IT operations"],
      ["ITAC", "Application controls (ITAC)"],
    ],
  },
  {
    id: "business",
    label: "Business process controls",
    detail: "Entity-level controls and the business cycles",
    domains: [
      ["ENTITY", "Entity-level controls"],
      ["ORDER_TO_CASH", "Order to cash / revenue"],
      ["PROCURE_TO_PAY", "Procure to pay / purchasing"],
      ["RECORD_TO_REPORT", "Record to report / financial close"],
      ["TREASURY", "Treasury and cash"],
      ["HIRE_TO_RETIRE", "Hire to retire / payroll"],
      ["INVENTORY", "Inventory and cost of sales"],
      ["FIXED_ASSETS", "Fixed assets and leases"],
      ["TAX", "Tax"],
      ["OTHER_BUSINESS", "Other business process"],
    ],
  },
  {
    id: "reports",
    label: "Key reports",
    detail: "Reports and IPE that controls rely on",
    domains: [["IPE", "Key reports and IPE"]],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  detail: string;
  domains: ReadonlyArray<readonly [string, string]>;
}>;

export type ControlCategory = (typeof CONTROL_CATEGORIES)[number]["id"];

/** Area options grouped the same way as the RCM. */
export const DOMAIN_GROUPS: ReadonlyArray<{
  label: string;
  domains: ReadonlyArray<readonly [string, string]>;
}> = CONTROL_CATEGORIES;

export const DOMAINS: ReadonlyArray<readonly [string, string]> =
  DOMAIN_GROUPS.flatMap((group) => group.domains);

export function categoryOf(domain: string): ControlCategory {
  return (
    CONTROL_CATEGORIES.find((category) =>
      category.domains.some(([key]) => key === domain),
    )?.id ?? "business"
  );
}

/** The tab to show: the one asked for, else the selected control's, else the first with controls. */
export function pickCategory(
  requested: string | null,
  controls: ReadonlyArray<{ id: string; domain: string }>,
  selected: string | null,
): ControlCategory {
  const asked = CONTROL_CATEGORIES.find(
    (category) => category.id === requested,
  );
  if (asked !== undefined) {
    return asked.id;
  }
  const control = controls.find((item) => item.id === selected);
  if (control !== undefined) {
    return categoryOf(control.domain);
  }
  const first = controls[0];
  return (
    CONTROL_CATEGORIES.find((category) =>
      controls.some((item) => categoryOf(item.domain) === category.id),
    )?.id ?? (first === undefined ? "it" : categoryOf(first.domain))
  );
}

export const ITGC_DOMAINS = ["ACCESS", "CHANGE", "OPERATIONS"] as const;

/** The standard tester for each area. A person can choose another per control. */
export const TESTERS: ReadonlyArray<[string, string]> = [
  ["itgc-access-tester", "ITGC tester: access"],
  ["itgc-change-tester", "ITGC tester: change management"],
  ["itgc-operations-tester", "ITGC tester: IT operations"],
  ["business-process-tester", "Business process controls tester"],
];

export function domainTester(domain: string): string {
  if (domain === "ACCESS") {
    return "itgc-access-tester";
  }
  if (domain === "CHANGE") {
    return "itgc-change-tester";
  }
  if (domain === "OPERATIONS") {
    return "itgc-operations-tester";
  }
  return "business-process-tester";
}

export type SetupControl = {
  id: string;
  controlRef: string;
  domain: string;
  title: string;
  risk: string;
  activity: string;
  frequency: string;
  nature: string;
  keyControl: boolean;
  included: boolean;
  ownerName: string;
  ownerEmail: string;
  /** Every application the control's instances cover (one row each, Milestone 8.5). */
  applicationIds: string[];
  applicationId: string | null;
  applicationName: string;
  /** The process the team named for it, when it is not one of the standard cycles. */
  processId: string | null;
  testAttributes: string[];
  pbcItems: string[];
  /** The workbook template (design, interim, and roll-forward tabs) the control uses. */
  templateKey: string;
  agentKey: string;
  sampleSize: number;
  version: number;
  source: string;
  domainLabel: string;
  frequencyLabel: string;
  natureLabel: string;
  customFields: Array<{ label: string; value: string }>;
  /** An approved sample or a test sheet rests on how it is defined (Milestone 8.13). */
  tested: boolean;
};

/** The setup shows one row per control ID: its instances (one per application)
 * collapsed into the first, carrying every application the family covers. */
export function families(controls: readonly SetupControl[]): SetupControl[] {
  const seen = new Map<string, SetupControl>();
  for (const control of controls) {
    const first = seen.get(control.controlRef);
    if (first === undefined) {
      seen.set(control.controlRef, {
        ...control,
        applicationIds: [...control.applicationIds],
      });
      continue;
    }
    first.applicationIds = [
      ...new Set([...first.applicationIds, ...control.applicationIds]),
    ];
    // In scope when any system's copy is, not only the first one listed.
    first.included = first.included || control.included;
  }
  return [...seen.values()];
}

export type PlanItem = {
  key: string;
  kind: string;
  title: string;
  agentKey: string;
  controlRef: string | null;
  dependsOn: string[];
};

/** What the planner suggested for the setup, for a person to accept or edit. */
export type SetupDraft = {
  status: "IDLE" | "PENDING" | "WORKING";
  drafting: boolean;
  note: string;
  source: "NONE" | "RULES" | "AGENT";
  scopeText: string;
  periodEnd: string | null;
  dueDays: number | null;
  followUpDays: number | null;
  maxFollowUps: number | null;
  reasons: Record<string, string>;
  draftedAt: string | null;
  version: number;
};

export type OwnerSuggestion = {
  ownerName: string;
  ownerEmail: string;
  controlRefs: string[];
  pattern: string;
};

export type Onboarding = {
  projectId: string;
  projectName: string;
  projectStatus: string;
  clientName: string;
  engagementType: string;
  /** The frameworks chosen when it was created (migration 0108); null when none were. */
  frameworks: string[] | null;
  scope: string;
  periodEnd: string | null;
  periodStart: string | null;
  fiscalYear: string;
  /** EXTERNAL_ICFR, MANAGEMENT_404, or INTERNAL_AUDIT; null until chosen. */
  methodology: string | null;
  reportingObjectives: string;
  period: PeriodCheck | null;
  coordinatorName: string;
  coordinatorEmail: string;
  clientDomains: string[];
  dueDays: number;
  followUpDays: number;
  maxFollowUps: number;
  templatesConfirmed: boolean;
  started: boolean;
  /** When a person reviewed and finalized the scope (SP6): the work starts then. */
  scopeFinalizedAt: string | null;
  applications: SetupSystem[];
  /** Business processes the team named, beside the standard cycles. */
  processes: SetupProcess[];
  /** Common systems not yet in scope, to pick instead of typing. */
  knownSystems: Array<{ name: string; layer: string; category: string }>;
  team: Array<{
    userId: string;
    name: string;
    email: string;
    role: string;
    organizationRole: string;
    /** Signed in with this address at least once. The role applies either way. */
    validated: boolean;
    /** A welcome email is written and waits for email sending to be turned on. */
    welcomeHeld: boolean;
  }>;
  /** The firm's own email domains; invitations go only to these. */
  firmDomains: string[];
  /** False only in development: anyone on the team may act as the reviewer. */
  independenceRequired: boolean;
  candidates: Array<{
    userId: string;
    name: string;
    email: string;
    organizationRole: string;
  }>;
  controls: SetupControl[];
  templates: SetupTemplate[];
  agents: Array<{
    agentKey: string;
    name: string;
    active: boolean;
    staffed: boolean;
  }>;
  readiness: Array<{
    step: string;
    title: string;
    complete: boolean;
    issues: string[];
    advisories: string[];
  }>;
  ready: boolean;
  plan: {
    id: string;
    status: string;
    fingerprint: string;
    items: PlanItem[];
    createdTasks: number;
    createdRequests: number;
  } | null;
  /** Until launch: the work launching will create, from the setup as it stands. */
  planPreview: { items: PlanItem[]; fingerprint: string } | null;
  rcmSource: "NONE" | "LIBRARY" | "UPLOAD";
  rcmFileName: string;
  openImportId: string | null;
  setupDraft: SetupDraft | null;
  ownerSuggestions: OwnerSuggestion[];
  library: Array<{ domain: string; controls: number; loaded: number }>;
  /** Business process controls the library offers and not loaded yet. */
  processOffers: OtherControl[];
  drafting: {
    total: number;
    pending: number;
    drafted: number;
    byModel: number;
    failed: number;
  };
  /** Once launched: where the work stands now. */
  launch: LaunchSummary | null;
};

/** Where a launched engagement's work stands, counted from its records. */
export type LaunchSummary = {
  launchedAt: string;
  launchedBy: string;
  controls: number;
  plansApproved: number;
  plansProposed: number;
  plansWorking: number;
  plansMissing: number;
  /** Drafted before their control's plan was approved; they wait for the plan. */
  requestsHeld: number;
  requestsDraft: number;
  requestsAwaitingApproval: number;
  requestsWithClient: number;
  requestsReceived: number;
  tasksTotal: number;
  tasksDone: number;
  tasksActive: number;
  tasksAttention: number;
};

/** One thing the team does next on a launched engagement, from its counts. */
export type LaunchNext = {
  key: string;
  title: string;
  detail: string;
  /** The page it is done on. */
  target: "controls" | "evidence" | "tasks" | "overview";
  /** ACTION: the team acts; WAITING: an agent is working; DONE: nothing waits. */
  tone: "ACTION" | "WAITING" | "DONE";
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function parseLaunch(value: unknown): LaunchSummary | null {
  if (!isRecord(value) || typeof value.launched_at !== "string") {
    return null;
  }
  const n = (key: string) => {
    const item = Number(value[key] ?? 0);
    return Number.isFinite(item) && item > 0 ? Math.floor(item) : 0;
  };
  return {
    launchedAt: value.launched_at,
    launchedBy: str(value.launched_by),
    controls: n("controls"),
    plansApproved: n("plans_approved"),
    plansProposed: n("plans_proposed"),
    plansWorking: n("plans_working"),
    plansMissing: n("plans_missing"),
    requestsHeld: n("requests_held"),
    requestsDraft: n("requests_draft"),
    requestsAwaitingApproval: n("requests_awaiting_approval"),
    requestsWithClient: n("requests_with_client"),
    requestsReceived: n("requests_received"),
    tasksTotal: n("tasks_total"),
    tasksDone: n("tasks_done"),
    tasksActive: n("tasks_active"),
    tasksAttention: n("tasks_attention"),
  };
}

/** What the team does next, most pressing first. Evidence is requested only from an
 * approved plan, so planning comes before requests. */
export function launchNextSteps(launch: LaunchSummary): LaunchNext[] {
  const steps: LaunchNext[] = [];
  if (launch.plansProposed > 0) {
    steps.push({
      key: "plans",
      title: `Approve ${plural(launch.plansProposed, "evidence plan")}`,
      detail:
        "Evidence is requested once a reviewer approves the control's test plan, with its attributes.",
      target: "controls",
      tone: "ACTION",
    });
  }
  if (launch.plansMissing > 0) {
    steps.push({
      key: "unplanned",
      title: `Plan the evidence for ${plural(launch.plansMissing, "control")}`,
      detail:
        "These controls have no evidence plan, so nothing is requested for them.",
      target: "controls",
      tone: "ACTION",
    });
  }
  if (launch.requestsAwaitingApproval > 0) {
    steps.push({
      key: "approve",
      title: `Approve ${plural(launch.requestsAwaitingApproval, "evidence request")}`,
      detail:
        "Each request is sent to the client only after an approver confirms it.",
      target: "evidence",
      tone: "ACTION",
    });
  }
  if (launch.requestsDraft > 0) {
    steps.push({
      key: "drafts",
      title: `Review ${plural(launch.requestsDraft, "drafted request")}`,
      detail:
        "Check the wording and the recipient, then submit each for approval.",
      target: "evidence",
      tone: "ACTION",
    });
  }
  if (launch.tasksAttention > 0) {
    steps.push({
      key: "tasks",
      title: `${plural(launch.tasksAttention, "agent task")} ${launch.tasksAttention === 1 ? "needs" : "need"} attention`,
      detail:
        "Blocked or failed tasks wait for a person before the work continues.",
      target: "tasks",
      tone: "ACTION",
    });
  }
  if (launch.plansWorking > 0) {
    steps.push({
      key: "planner",
      title: `The planner is refining ${plural(launch.plansWorking, "evidence plan")}`,
      detail: "Its proposals are added for approval as they are ready.",
      target: "controls",
      tone: "WAITING",
    });
  }
  if (steps.length === 0) {
    steps.push({
      key: "clear",
      title: "Nothing waits for the team",
      detail: "The agents are working. Follow their progress on the dashboard.",
      target: "overview",
      tone: "DONE",
    });
  }
  return steps;
}

/** The fields a client column can be matched to, plus keeping or dropping it. */
export const COLUMN_CHOICES = [
  "control_ref",
  "title",
  "activity",
  "risk",
  "domain",
  "frequency",
  "nature",
  "key_control",
  "owner_name",
  "owner_email",
  "applications",
  "test_attributes",
  "pbc_items",
  "custom",
  "ignore",
] as const;

export const VALUE_FIELDS = ["domain", "frequency", "nature"] as const;
export type ValueField = (typeof VALUE_FIELDS)[number];

export const VALUE_OPTIONS: Record<
  ValueField,
  ReadonlyArray<readonly [string, string]>
> = {
  domain: DOMAINS,
  frequency: FREQUENCIES,
  nature: NATURES,
};

export const LAYERS: ReadonlyArray<[string, string]> = [
  ["APPLICATION", "Application"],
  ["DATABASE", "Database"],
  ["OPERATING_SYSTEM", "Operating system"],
  ["INFRASTRUCTURE", "Infrastructure"],
  ["TOOL", "Tool"],
];

export type SystemProposal = {
  key: string;
  name: string;
  layer: string;
  aliases: string[];
  controlRefs: string[];
  controls: number;
  evidence: string;
  foundIn: "column" | "text" | "both";
  included: boolean;
};

export type RcmSystems = {
  status: "PENDING" | "SCANNING" | "READY" | "FAILED";
  source: "MODEL" | "RULES" | "FALLBACK" | null;
  note: string;
  version: number;
  proposals: SystemProposal[];
};

function parseSystems(value: unknown): RcmSystems {
  const item = isRecord(value) ? value : {};
  const status = (["PENDING", "SCANNING", "READY", "FAILED"] as const).find(
    (entry) => entry === item.status,
  );
  return {
    status: status ?? "PENDING",
    source:
      item.source === "MODEL" ||
      item.source === "RULES" ||
      item.source === "FALLBACK"
        ? item.source
        : null,
    note: str(item.note),
    version: Number(item.version ?? 1),
    proposals: records(item.proposals).map((entry) => ({
      key: str(entry.key),
      name: str(entry.name),
      layer: str(entry.layer),
      aliases: strings(entry.aliases),
      controlRefs: strings(entry.control_refs),
      controls: Number(entry.controls ?? 0),
      evidence: str(entry.evidence),
      foundIn:
        entry.found_in === "text" || entry.found_in === "both"
          ? entry.found_in
          : "column",
      included: entry.included !== false,
    })),
  };
}

export type RcmImport = {
  id: string;
  status: string;
  fileName: string;
  fileKind: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string;
  version: number;
  sheets: Array<{ index: number; name: string; rows: number }>;
  sheetIndex: number;
  headerRow: number;
  dataRows: number;
  columns: Array<{
    index: number;
    header: string;
    samples: string[];
    field: string;
    suggested: string;
  }>;
  fields: Array<{ key: string; label: string; required: boolean }>;
  values: Record<
    ValueField,
    Array<{
      value: string;
      count: number;
      mapped: string | null;
      suggested: string | null;
      reason: string;
      mappedBy: "MODEL" | "RULES" | "FALLBACK" | null;
      alternative: string | null;
      alternativeReason: string;
    }>
  >;
  terms: {
    status: "PENDING" | "WORKING" | "READY" | "FAILED";
    mode: "FILL" | "REMAP";
    source: "MODEL" | "RULES" | "FALLBACK" | null;
    note: string;
    modelAvailable: boolean;
  };
  preview: {
    importable: number;
    skipped: Array<{ row: number; reason: string }>;
    skippedCount: number;
    warnings: string[];
    problems: string[];
    controls: Array<{
      row: number;
      controlRef: string;
      title: string;
      domain: string;
      domainLabel: string;
      frequency: string;
      frequencyLabel: string;
      nature: string;
      natureLabel: string;
      keyControl: boolean;
      ownerName: string;
      ownerEmail: string;
      applications: string[];
      customFields: number;
    }>;
    newApplications: string[];
  };
  systems: RcmSystems;
  ready: boolean;
  replaces: number;
};

export type PreviewSection = {
  title: string;
  kind: string;
  guidance: string;
  fields: Array<{ label: string; value: string }>;
  columns: string[];
  rows: string[][];
};

export type WorkpaperPreview = {
  reference: string;
  title: string;
  templateTitle: string;
  templateVersion: number;
  kind: string;
  purpose: string;
  tabs: Array<{
    key: string;
    title: string;
    period: string;
    reference: string;
    sections: PreviewSection[];
  }>;
};

/** A section of a template tab, as the editor shapes it. */
export type TemplateSection = {
  title: string;
  kind: string;
  guidance: string;
  columns: string[];
  rows: string[][];
};

export type TemplateTab = {
  key: string;
  title: string;
  period: string;
  sections: TemplateSection[];
};

export type SetupTemplate = {
  key: string;
  title: string;
  /** ITGC, ITAC, BUSINESS, or KEY_REPORT: the kind of control it documents. */
  kind: string;
  purpose: string;
  tabs: TemplateTab[];
  /** STANDARD, or FIRM for one the firm uploaded or customised for this engagement. */
  source: string;
  fileName: string;
  templateId: string;
  /** The standard template a customised one started from. */
  baseKey: string;
  version: number;
};

export const TEMPLATE_KINDS = [
  {
    id: "ITGC",
    label: "IT general controls",
    one: "IT general control",
    detail:
      "Access, change, and operations controls over the in-scope systems.",
  },
  {
    id: "ITAC",
    label: "Application controls",
    one: "application control",
    detail: "Automated controls configured in an application.",
  },
  {
    id: "BUSINESS",
    label: "Business process controls",
    one: "business process control",
    detail: "Manual and IT-dependent controls in the business cycles.",
  },
  {
    id: "KEY_REPORT",
    label: "Key reports",
    one: "key report",
    detail: "Reports the controls rely on: information produced by the entity.",
  },
] as const;

export const PERIOD_LABELS: Record<string, string> = {
  design: "Design",
  interim: "Interim testing",
  rollforward: "Roll-forward",
};

export const SECTION_KINDS = [
  ["fields", "Header fields"],
  ["guidance", "Narrative with guidance"],
  ["matrix", "Testing matrix (one row per sample, one column per attribute)"],
  ["table", "Table"],
  ["signoff", "Sign-off"],
] as const;

/** The kind of workpaper a control's area calls for. */
export function kindForDomain(domain: string): string {
  if ((ITGC_DOMAINS as readonly string[]).includes(domain)) {
    return "ITGC";
  }
  if (domain === "ITAC") {
    return "ITAC";
  }
  if (domain === "IPE") {
    return "KEY_REPORT";
  }
  return "BUSINESS";
}

const TEMPLATE_LIMITS = {
  tabs: 6,
  sections: 24,
  columns: 20,
  rows: 30,
  title: 200,
  guidance: 1000,
};

/**
 * A template as the editor saves it, checked before it goes to the API: titles present
 * and short, kinds and periods known, and nothing secret-looking in the text.
 */
export function parseTemplateDraft(value: unknown): {
  title: string;
  tabs: Array<{
    title: string;
    period: string;
    sections: TemplateSection[];
  }>;
} | null {
  if (!isRecord(value) || typeof value.title !== "string") {
    return null;
  }
  const title = value.title.trim();
  if (
    title === "" ||
    title.length > TEMPLATE_LIMITS.title ||
    SECRET.test(title)
  ) {
    return null;
  }
  const tabs = Array.isArray(value.tabs) ? value.tabs : [];
  if (tabs.length === 0 || tabs.length > TEMPLATE_LIMITS.tabs) {
    return null;
  }
  const result: Array<{
    title: string;
    period: string;
    sections: TemplateSection[];
  }> = [];
  for (const tab of tabs) {
    if (!isRecord(tab) || typeof tab.title !== "string") {
      return null;
    }
    const tabTitle = tab.title.trim();
    const period = str(tab.period);
    if (
      tabTitle === "" ||
      tabTitle.length > TEMPLATE_LIMITS.title ||
      PERIOD_LABELS[period] === undefined
    ) {
      return null;
    }
    const sections = Array.isArray(tab.sections) ? tab.sections : [];
    if (sections.length === 0 || sections.length > TEMPLATE_LIMITS.sections) {
      return null;
    }
    const kept: TemplateSection[] = [];
    for (const section of sections) {
      if (!isRecord(section) || typeof section.title !== "string") {
        return null;
      }
      const sectionTitle = section.title.trim();
      const kind = str(section.kind);
      const guidance = str(section.guidance).trim();
      const columns = strings(section.columns)
        .map((column) => column.trim())
        .filter((column) => column !== "");
      const rows = Array.isArray(section.rows)
        ? section.rows.map(strings).filter((row) => row.some((c) => c !== ""))
        : [];
      if (
        sectionTitle === "" ||
        sectionTitle.length > TEMPLATE_LIMITS.title ||
        !SECTION_KINDS.some(([id]) => id === kind) ||
        guidance.length > TEMPLATE_LIMITS.guidance ||
        columns.length > TEMPLATE_LIMITS.columns ||
        rows.length > TEMPLATE_LIMITS.rows ||
        SECRET.test(`${sectionTitle} ${guidance} ${columns.join(" ")}`) ||
        ((kind === "table" || kind === "matrix") &&
          columns.length === 0 &&
          kind === "table")
      ) {
        return null;
      }
      kept.push({
        title: sectionTitle,
        kind,
        guidance,
        columns: kind === "table" || kind === "matrix" ? columns : [],
        rows:
          kind === "table"
            ? rows.map((row) => row.slice(0, columns.length))
            : [],
      });
    }
    result.push({ title: tabTitle, period, sections: kept });
  }
  return { title, tabs: result };
}

export function parsePeriod(value: unknown): PeriodCheck | null {
  if (!isRecord(value) || typeof value.basis !== "string") {
    return null;
  }
  return {
    conflicts: records(value.conflicts)
      .filter((item) => typeof item.message === "string")
      .map((item) => ({
        kind: str(item.kind),
        message: str(item.message),
        blocking: item.blocking === true,
        periodEndFix:
          typeof item.period_end_fix === "string" ? item.period_end_fix : null,
        nameFix:
          typeof item.name_fix === "string" && item.name_fix !== ""
            ? item.name_fix
            : null,
        scopeFix:
          typeof item.scope_fix === "string" && item.scope_fix !== ""
            ? item.scope_fix
            : null,
        fiscalYearFix:
          typeof item.fiscal_year_fix === "string" &&
          item.fiscal_year_fix !== ""
            ? item.fiscal_year_fix
            : null,
      })),
    basis: value.basis,
    confirmed: value.confirmed === true,
    confirmedBy:
      typeof value.confirmed_by === "string" ? value.confirmed_by : null,
    confirmedAt:
      typeof value.confirmed_at === "string" ? value.confirmed_at : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function parseOnboarding(value: unknown): Onboarding | null {
  if (
    !isRecord(value) ||
    typeof value.project_id !== "string" ||
    !isRecord(value.settings) ||
    !Array.isArray(value.controls) ||
    !Array.isArray(value.readiness) ||
    typeof value.ready !== "boolean"
  ) {
    return null;
  }
  const settings = value.settings;
  const plan = isRecord(value.plan) ? value.plan : null;
  return {
    projectId: value.project_id,
    projectName: str(value.project_name),
    projectStatus: str(value.project_status),
    clientName: str(settings.client_name),
    engagementType: str(settings.engagement_type) || "SOX_ITGC",
    frameworks: Array.isArray(settings.frameworks)
      ? strings(settings.frameworks)
      : null,
    scope: str(value.scope),
    periodEnd:
      typeof settings.period_end === "string" ? settings.period_end : null,
    periodStart:
      typeof settings.period_start === "string" ? settings.period_start : null,
    fiscalYear: str(settings.fiscal_year),
    methodology:
      typeof settings.methodology === "string" ? settings.methodology : null,
    reportingObjectives: str(settings.reporting_objectives),
    period: parsePeriod(value.period),
    setupDraft: parseSetupDraft(value.setup_draft),
    ownerSuggestions: records(value.owner_suggestions)
      .filter((item) => typeof item.owner_email === "string")
      .map((item) => ({
        ownerName: str(item.owner_name),
        ownerEmail: str(item.owner_email),
        controlRefs: strings(item.control_refs),
        pattern: str(item.pattern),
      })),
    coordinatorName: str(settings.client_coordinator_name),
    coordinatorEmail: str(settings.client_coordinator_email),
    clientDomains: strings(settings.client_domains),
    dueDays: Number(settings.pbc_due_days ?? 10),
    followUpDays: Number(settings.pbc_follow_up_days ?? 3),
    maxFollowUps: Number(settings.pbc_max_follow_ups ?? 2),
    templatesConfirmed: typeof settings.templates_confirmed_at === "string",
    started: value.started === true,
    scopeFinalizedAt:
      typeof settings.scope_finalized_at === "string"
        ? settings.scope_finalized_at
        : null,
    drafting: {
      total: Number((isRecord(value.drafting) ? value.drafting.total : 0) ?? 0),
      pending: Number(
        (isRecord(value.drafting) ? value.drafting.pending : 0) ?? 0,
      ),
      drafted: Number(
        (isRecord(value.drafting) ? value.drafting.drafted : 0) ?? 0,
      ),
      byModel: Number(
        (isRecord(value.drafting) ? value.drafting.by_model : 0) ?? 0,
      ),
      failed: Number(
        (isRecord(value.drafting) ? value.drafting.failed : 0) ?? 0,
      ),
    },
    launch: parseLaunch(value.launch),
    applications: records(value.applications).map(parseSystem),
    processes: records(value.processes)
      .filter((item) => typeof item.id === "string")
      .map((item) => ({
        id: str(item.id),
        name: str(item.name),
        domain: str(item.domain),
        domainLabel: str(item.domain_label),
        version: Number(item.version ?? 1),
        controlsInScope: Number(item.controls_in_scope ?? 0),
        systemIds: strings(item.system_ids),
        primarySystemId:
          typeof item.primary_system_id === "string"
            ? item.primary_system_id
            : null,
        description: str(item.description),
        owner: str(item.owner),
        controlAreas: Array.isArray(item.control_areas)
          ? item.control_areas.filter(isArea)
          : null,
        controlAreasSuggested: parseAreaSuggestions(
          item.control_areas_suggested,
        ),
        controlAreasDecidedAt:
          typeof item.control_areas_decided_at === "string"
            ? item.control_areas_decided_at
            : null,
      })),
    knownSystems: records(value.known_systems)
      .filter((item) => typeof item.name === "string")
      .map((item) => ({
        name: str(item.name),
        layer: str(item.layer) || "APPLICATION",
        category: str(item.category),
      })),
    team: records(value.team).map((item) => ({
      userId: str(item.user_id),
      name: str(item.display_name),
      email: str(item.email),
      role: str(item.engagement_role),
      organizationRole: str(item.organization_role),
      validated: item.validated !== false,
      welcomeHeld: item.welcome_held === true,
    })),
    firmDomains: strings(value.firm_domains),
    independenceRequired: value.independence_required !== false,
    candidates: records(value.candidates).map((item) => ({
      userId: str(item.user_id),
      name: str(item.display_name),
      email: str(item.email),
      organizationRole: str(item.organization_role),
    })),
    controls: records(value.controls).map((item) => ({
      id: str(item.id),
      controlRef: str(item.control_ref),
      domain: str(item.domain),
      title: str(item.title),
      risk: str(item.risk),
      activity: str(item.activity),
      frequency: str(item.frequency),
      nature: str(item.nature),
      keyControl: item.key_control === true,
      included: item.included === true,
      ownerName: str(item.owner_name),
      ownerEmail: str(item.owner_email),
      applicationIds: strings(item.application_ids),
      applicationId:
        typeof item.application_id === "string" ? item.application_id : null,
      applicationName: str(item.application_name),
      processId: typeof item.process_id === "string" ? item.process_id : null,
      testAttributes: strings(item.test_attributes),
      pbcItems: strings(item.pbc_items),
      templateKey: str(item.template_key),
      agentKey: str(item.agent_key),
      sampleSize: Number(item.sample_size ?? 0),
      version: Number(item.version ?? 1),
      source: str(item.source),
      domainLabel: str(item.domain_label),
      frequencyLabel: str(item.frequency_label),
      natureLabel: str(item.nature_label),
      customFields: records(item.custom_fields).map((field) => ({
        label: str(field.label),
        value: str(field.value),
      })),
      tested: item.tested === true,
    })),
    templates: records(value.templates).map((item) => ({
      key: str(item.key),
      title: str(item.title),
      kind: str(item.kind),
      purpose: str(item.purpose),
      tabs: records(item.tabs).map(parseTemplateTab),
      source: str(item.source) || "STANDARD",
      fileName: str(item.file_name),
      templateId: str(item.template_id),
      baseKey: str(item.base_key),
      version: Number(item.version ?? 1),
    })),
    agents: records(value.agents).map((item) => ({
      agentKey: str(item.agent_key),
      name: str(item.name),
      active: item.active === true,
      staffed: item.staffed === true,
    })),
    readiness: records(value.readiness).map((item) => ({
      step: str(item.step),
      title: str(item.title),
      complete: item.complete === true,
      issues: strings(item.issues),
      advisories: strings(item.advisories),
    })),
    ready: value.ready,
    plan:
      plan === null
        ? null
        : {
            id: str(plan.id),
            status: str(plan.status),
            fingerprint: str(plan.fingerprint),
            items: records(plan.items).map(parsePlanItem),
            createdTasks: Number(plan.created_tasks ?? 0),
            createdRequests: Number(plan.created_requests ?? 0),
          },
    planPreview: isRecord(value.plan_preview)
      ? {
          items: records(value.plan_preview.items).map(parsePlanItem),
          fingerprint: str(value.plan_preview.fingerprint),
        }
      : null,
    rcmSource:
      value.rcm_source === "LIBRARY" || value.rcm_source === "UPLOAD"
        ? value.rcm_source
        : "NONE",
    rcmFileName: str(value.rcm_file_name),
    library: records(value.library).map((item) => ({
      domain: str(item.domain),
      controls: Number(item.controls ?? 0),
      loaded: Number(item.loaded ?? 0),
    })),
    processOffers: records(value.process_offers).map((item) => ({
      libraryKey: str(item.library_key),
      controlRef: str(item.control_ref),
      title: str(item.title),
      domain: str(item.domain),
      controlId: null,
    })),
    openImportId:
      typeof value.open_import_id === "string" &&
      UUID.test(value.open_import_id)
        ? value.open_import_id
        : null,
  };
}

export function parseImport(value: unknown): RcmImport | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Array.isArray(value.columns) ||
    !isRecord(value.values) ||
    !isRecord(value.preview)
  ) {
    return null;
  }
  const values = value.values;
  const preview = value.preview;
  const choices = (key: ValueField) =>
    records(values[key]).map((item) => ({
      value: str(item.value),
      count: Number(item.count ?? 0),
      mapped: typeof item.mapped === "string" ? item.mapped : null,
      suggested: typeof item.suggested === "string" ? item.suggested : null,
      reason: str(item.reason),
      alternative:
        typeof item.alternative === "string" ? item.alternative : null,
      alternativeReason: str(item.alternative_reason),
      mappedBy:
        item.mapped_by === "MODEL"
          ? ("MODEL" as const)
          : item.mapped_by === "RULES"
            ? ("RULES" as const)
            : item.mapped_by === "FALLBACK"
              ? ("FALLBACK" as const)
              : null,
    }));
  const terms = isRecord(value.terms) ? value.terms : {};
  return {
    id: value.id,
    status: str(value.status),
    fileName: str(value.file_name),
    fileKind: str(value.file_kind),
    sizeBytes: Number(value.size_bytes ?? 0),
    createdAt: str(value.created_at),
    uploadedBy: str(value.uploaded_by),
    version: Number(value.version ?? 1),
    sheets: records(value.sheets).map((item) => ({
      index: Number(item.index ?? 0),
      name: str(item.name),
      rows: Number(item.rows ?? 0),
    })),
    sheetIndex: Number(value.sheet_index ?? 0),
    headerRow: Number(value.header_row ?? 1),
    dataRows: Number(value.data_rows ?? 0),
    columns: records(value.columns).map((item) => ({
      index: Number(item.index ?? 0),
      header: str(item.header),
      samples: strings(item.samples),
      field: str(item.field),
      suggested: str(item.suggested),
    })),
    fields: records(value.fields).map((item) => ({
      key: str(item.key),
      label: str(item.label),
      required: item.required === true,
    })),
    values: {
      domain: choices("domain"),
      frequency: choices("frequency"),
      nature: choices("nature"),
    },
    preview: {
      importable: Number(preview.importable ?? 0),
      skipped: records(preview.skipped).map((item) => ({
        row: Number(item.row ?? 0),
        reason: str(item.reason),
      })),
      skippedCount: Number(preview.skipped_count ?? 0),
      warnings: strings(preview.warnings),
      problems: strings(preview.problems),
      controls: records(preview.controls).map((item) => ({
        row: Number(item.row ?? 0),
        controlRef: str(item.control_ref),
        title: str(item.title),
        domain: str(item.domain),
        domainLabel: str(item.domain_label),
        frequency: str(item.frequency),
        frequencyLabel: str(item.frequency_label),
        nature: str(item.nature),
        natureLabel: str(item.nature_label),
        keyControl: item.key_control === true,
        ownerName: str(item.owner_name),
        ownerEmail: str(item.owner_email),
        applications: strings(item.applications),
        customFields: Number(item.custom_fields ?? 0),
      })),
      newApplications: strings(preview.new_applications),
    },
    systems: parseSystems(value.systems),
    terms: {
      status:
        (["PENDING", "WORKING", "READY", "FAILED"] as const).find(
          (entry) => entry === terms.status,
        ) ?? "READY",
      mode: terms.mode === "REMAP" ? "REMAP" : "FILL",
      source:
        terms.source === "MODEL" ||
        terms.source === "RULES" ||
        terms.source === "FALLBACK"
          ? terms.source
          : null,
      note: str(terms.note),
      modelAvailable: terms.model_available === true,
    },
    ready: value.ready === true,
    replaces: Number(value.replaces ?? 0),
  };
}

function parseTemplateTab(item: Record<string, unknown>): TemplateTab {
  return {
    key: str(item.key),
    title: str(item.title),
    period: str(item.period),
    sections: records(item.sections).map((section) => ({
      title: str(section.title),
      kind: str(section.kind),
      guidance: str(section.guidance),
      columns: strings(section.columns),
      rows: Array.isArray(section.rows) ? section.rows.map(strings) : [],
    })),
  };
}

function parsePreviewSection(section: Record<string, unknown>): PreviewSection {
  return {
    title: str(section.title),
    kind: str(section.kind),
    guidance: str(section.guidance),
    fields: records(section.fields).map((field) => ({
      label: str(field.label),
      value: str(field.value),
    })),
    columns: strings(section.columns),
    rows: Array.isArray(section.rows) ? section.rows.map(strings) : [],
  };
}

export function parsePreview(value: unknown): WorkpaperPreview | null {
  if (
    !isRecord(value) ||
    typeof value.reference !== "string" ||
    !Array.isArray(value.tabs)
  ) {
    return null;
  }
  return {
    reference: value.reference,
    title: str(value.title),
    templateTitle: str(value.template_title),
    templateVersion: Number(value.template_version ?? 1),
    kind: str(value.kind),
    purpose: str(value.purpose),
    tabs: records(value.tabs).map((tab) => ({
      key: str(tab.key),
      title: str(tab.title),
      period: str(tab.period),
      reference: str(tab.reference),
      sections: records(tab.sections).map(parsePreviewSection),
    })),
  };
}

function parsePlanItem(item: Record<string, unknown>): PlanItem {
  return {
    key: str(item.key),
    kind: str(item.kind),
    title: str(item.title),
    agentKey: str(item.agent_key),
    controlRef: typeof item.control_ref === "string" ? item.control_ref : null,
    dependsOn: strings(item.depends_on),
  };
}

/** Setup progress: completed steps out of the five that need input. */
function parseSetupDraft(value: unknown): SetupDraft | null {
  if (!isRecord(value)) {
    return null;
  }
  const status =
    value.status === "PENDING" || value.status === "WORKING"
      ? value.status
      : "IDLE";
  const number = (item: unknown): number | null =>
    typeof item === "number" && Number.isFinite(item) ? item : null;
  const reasons: Record<string, string> = {};
  if (isRecord(value.reasons)) {
    for (const [key, reason] of Object.entries(value.reasons)) {
      if (typeof reason === "string" && reason !== "") {
        reasons[key] = reason;
      }
    }
  }
  return {
    status,
    drafting: status !== "IDLE",
    note: str(value.note),
    source:
      value.source === "AGENT" || value.source === "RULES"
        ? value.source
        : "NONE",
    scopeText: str(value.scope_text),
    periodEnd: typeof value.period_end === "string" ? value.period_end : null,
    dueDays: number(value.pbc_due_days),
    followUpDays: number(value.pbc_follow_up_days),
    maxFollowUps: number(value.pbc_max_follow_ups),
    reasons,
    draftedAt: typeof value.drafted_at === "string" ? value.drafted_at : null,
    version: number(value.version) ?? 1,
  };
}

export type StepReadiness = {
  complete: boolean;
  issues: string[];
  advisories: string[];
};

/** A step's readiness, from the API's items it is made of. */
export function stepReadiness(
  onboarding: Onboarding,
  step: SetupStep,
): StepReadiness {
  if (step === "launch") {
    return { complete: onboarding.started, issues: [], advisories: [] };
  }
  const keys: readonly string[] =
    SETUP_STEPS.find((item) => item.id === step)?.readiness ?? [];
  const items = onboarding.readiness.filter((item) => keys.includes(item.step));
  if (items.length === 0) {
    return { complete: false, issues: [], advisories: [] };
  }
  return {
    complete: items.every((item) => item.complete),
    issues: items.flatMap((item) => item.issues),
    advisories: items.flatMap((item) => item.advisories),
  };
}

/** What the setup rail says under a step. After launch, open items are still open;
 * they are no longer setup that was never finished. */
export function stepStatusLabel(
  onboarding: Onboarding,
  step: SetupStep,
  phase: EngagementPhase,
): string {
  if (step === "launch") {
    if (phase === "closed") {
      return "Archived";
    }
    if (phase === "completed") {
      return "Completed";
    }
    if (phase === "paused") {
      return "Paused";
    }
    if (onboarding.started) {
      return "Running";
    }
    return onboarding.ready ? "Ready to launch" : "Not ready";
  }
  if (step === "overview") {
    return onboarding.started ? "Where the work stands" : "Where setup stands";
  }
  const state = stepReadiness(onboarding, step);
  if (state.complete) {
    return "Ready";
  }
  if (state.issues.length > 0) {
    return onboarding.started
      ? `${state.issues.length} open`
      : `${state.issues.length} to do`;
  }
  return SETUP_STEPS.find((item) => item.id === step)?.detail ?? "";
}

export type SetupAttention = {
  step: SetupStep;
  title: string;
  detail: string;
};

/** Setup steps that still have open points after the engagement is running. */
export function setupAttention(onboarding: Onboarding): SetupAttention[] {
  return WORK_STEPS.flatMap((step) => {
    const state = stepReadiness(onboarding, step);
    if (state.complete || state.issues.length === 0) {
      return [];
    }
    const name = SETUP_STEPS.find((item) => item.id === step)?.title ?? step;
    const first = state.issues[0] ?? "";
    const more = state.issues.length - 1;
    return [
      {
        step,
        title:
          state.issues.length === 1
            ? name
            : `${name}: ${state.issues.length} open`,
        detail: more > 0 ? `${first} And ${more} more.` : first,
      },
    ];
  });
}

export type ReportLine = {
  /** The step that fixes it; null for what follows from the rest (the agents). */
  step: SetupStep | null;
  title: string;
  message: string;
};

/** The launch readiness report: what holds launch, and what is worth knowing first. */
export function launchReport(onboarding: Onboarding): {
  blocking: ReportLine[];
  warnings: ReportLine[];
} {
  const blocking: ReportLine[] = [];
  const warnings: ReportLine[] = [];
  for (const item of onboarding.readiness) {
    const step =
      SETUP_STEPS.find((entry) =>
        (entry.readiness as readonly string[]).includes(item.step),
      )?.id ?? null;
    const title =
      step === null
        ? item.title
        : (SETUP_STEPS.find((entry) => entry.id === step)?.title ?? item.title);
    for (const message of item.issues) {
      blocking.push({ step, title, message });
    }
    for (const message of item.advisories) {
      warnings.push({ step, title, message });
    }
  }
  return { blocking, warnings };
}

export function setupProgress(onboarding: Onboarding): {
  done: number;
  total: number;
  /** The first step with something to do, or null when all are ready. */
  next: SetupStep | null;
} {
  const states = WORK_STEPS.map((step) => [
    step,
    stepReadiness(onboarding, step).complete,
  ]) as Array<[SetupStep, boolean]>;
  return {
    done: states.filter(([, complete]) => complete).length,
    total: states.length,
    next: states.find(([, complete]) => !complete)?.[0] ?? null,
  };
}

/** The draft's suggestion for a field, when it differs from what is set. */
export function pendingSuggestions(onboarding: Onboarding): {
  scope: boolean;
  periodEnd: boolean;
  cadence: boolean;
} {
  const draft = onboarding.setupDraft;
  if (draft === null || draft.drafting || draft.source === "NONE") {
    return { scope: false, periodEnd: false, cadence: false };
  }
  return {
    scope: draft.scopeText !== "" && draft.scopeText !== onboarding.scope,
    // A draft made before the dates were set can end before the period now starts;
    // that is no suggestion to take (the API refuses it too).
    periodEnd:
      draft.periodEnd !== null &&
      draft.periodEnd !== onboarding.periodEnd &&
      (onboarding.periodStart === null ||
        draft.periodEnd > onboarding.periodStart),
    cadence:
      draft.dueDays !== null &&
      (draft.dueDays !== onboarding.dueDays ||
        draft.followUpDays !== onboarding.followUpDays ||
        draft.maxFollowUps !== onboarding.maxFollowUps),
  };
}

export type SetupNotice =
  | "setup-created"
  | "setup-saved"
  | "setup-drafting"
  | "setup-accepted"
  | "setup-invalid"
  | "setup-changed"
  | "setup-period-order"
  | "setup-started"
  | "setup-incomplete"
  | "setup-denied"
  | "setup-unavailable"
  | "setup-launched"
  | "setup-rcm-uploaded"
  | "setup-rcm-unreadable"
  | "setup-rcm-large"
  | "setup-rcm-incomplete"
  | "setup-rcm-imported"
  | "invite-sent"
  | "invite-email"
  | "invite-domain"
  | "invite-disposable"
  | "invite-no-mail"
  | "invite-unchecked"
  | "invite-no-domains"
  | "invite-limit"
  | "invite-disabled"
  | "domain-saved"
  | "domain-invalid"
  | "domain-public"
  | "domain-no-mail"
  | "domain-disposable"
  | "setup-needs-system"
  | "system-needs-facts"
  | "setup-template-uploaded"
  | "setup-template-unreadable"
  | "setup-template-customized"
  | "setup-template-saved"
  | "setup-control-exists"
  | "setup-control-in-scope"
  | "setup-process-exists"
  | "setup-process-in-use"
  | "setup-already-launched"
  | "setup-launch-slow"
  | "setup-slow"
  | "setup-archived"
  | "setup-completed"
  | "setup-system-exists"
  | "setup-control-tested"
  | "setup-needs-reason"
  | "setup-last-reviewer"
  | "setup-period-changed"
  | "setup-period-confirmed"
  | "welcomes-sent"
  | "live-email-off";

const NOTICES: readonly SetupNotice[] = [
  "setup-created",
  "welcomes-sent",
  "live-email-off",
  "setup-saved",
  "setup-drafting",
  "setup-accepted",
  "setup-invalid",
  "setup-changed",
  "setup-period-order",
  "setup-started",
  "setup-incomplete",
  "setup-denied",
  "setup-unavailable",
  "setup-launched",
  "setup-rcm-uploaded",
  "setup-rcm-unreadable",
  "setup-rcm-large",
  "setup-rcm-incomplete",
  "setup-rcm-imported",
  "invite-sent",
  "invite-email",
  "invite-domain",
  "invite-disposable",
  "invite-no-mail",
  "invite-unchecked",
  "invite-no-domains",
  "invite-limit",
  "invite-disabled",
  "domain-saved",
  "domain-invalid",
  "domain-public",
  "domain-no-mail",
  "domain-disposable",
  "setup-needs-system",
  "system-needs-facts",
  "setup-template-uploaded",
  "setup-template-unreadable",
  "setup-template-customized",
  "setup-template-saved",
  "setup-control-exists",
  "setup-control-in-scope",
  "setup-process-exists",
  "setup-process-in-use",
  "setup-already-launched",
  "setup-launch-slow",
  "setup-slow",
  "setup-archived",
  "setup-completed",
  "setup-system-exists",
  "setup-control-tested",
  "setup-needs-reason",
  "setup-last-reviewer",
  "setup-period-changed",
  "setup-period-confirmed",
];

export type SystemRecommendation = {
  id: string;
  kind: "INCLUDE" | "EXCLUDE" | "ADD_SOC_REVIEW" | "MAP_CUEC" | "CUEC_GAP";
  controlId: string | null;
  /** A library control the recommendation adds for this system. */
  libraryKey: string | null;
  controlRef: string;
  controlTitle: string;
  cuec: string;
  reason: string;
  /** The CUECs that call for it: CUEC-1, CUEC-3. */
  cuecRefs: string[];
  status: "PROPOSED" | "ACCEPTED" | "DISMISSED";
};

export type SystemCuec = {
  ref: string;
  text: string;
  controlId: string | null;
  controlRef: string | null;
  /** Answered by a control already in scope for the system. */
  inScope: boolean;
};

/** A business process the team named, based on the standard cycle it is closest to. */
export type SetupProcess = {
  id: string;
  name: string;
  domain: string;
  domainLabel: string;
  version: number;
  controlsInScope: number;
  /** The systems it runs on (migration 0109), the primary one first. */
  systemIds: string[];
  primarySystemId: string | null;
  /** SP3 (migration 0110): what it is and who owns it, and its control areas. */
  description: string;
  owner: string;
  controlAreas: ControlArea[] | null;
  controlAreasSuggested: AreaSuggestions | null;
  controlAreasDecidedAt: string | null;
};

/** The systems in scope: one taken out of scope is kept on record, listed apart. */
export function inScopeSystems(onboarding: Onboarding): SetupSystem[] {
  return onboarding.applications.filter(
    (system) => (system.outOfScope ?? null) === null,
  );
}

/** The standard business cycles a named process can be based on. */
export const PROCESS_CYCLES: ReadonlyArray<readonly [string, string]> =
  CONTROL_CATEGORIES.find((category) => category.id === "business")?.domains ??
  [];

export type OtherControl = {
  libraryKey: string;
  controlRef: string;
  title: string;
  /** ACCESS, CHANGE, OPERATIONS, ITAC, or IPE. */
  domain: string;
  /** The system's instance, when it is loaded for it but out of scope. */
  controlId: string | null;
};

export type SetupSystem = {
  id: string;
  name: string;
  description: string;
  layer: string;
  /** SAAS, VENDOR_HOSTED, ON_PREMISES, or null when not known yet. */
  hosting: string | null;
  socExpected: boolean | null;
  factsSource: "NONE" | "RULES" | "AGENT" | "PERSON";
  factsReason: string;
  factsConfirmed: boolean;
  version: number;
  review: {
    status: "IDLE" | "PENDING" | "WORKING";
    /** FALLBACK: the reviewed rules stood in for a model call that failed. */
    source: "NONE" | "RULES" | "AGENT" | "FALLBACK";
    summary: string;
    coverage: string;
    cuecs: SystemCuec[];
    note: string;
  } | null;
  recommendations: SystemRecommendation[];
  /** How many controls are in scope for the system now. */
  controlsInScope: number;
  /** Library controls not in scope for it and not recommended: the team may add them. */
  otherControls: OtherControl[];
  /** Milestone 8.10: what the system is for, and who owns it. */
  purpose: string;
  processes: string;
  owner: string;
  /** The system's code in the client's control references, when a person set one. */
  refCode: string;
  /** The agent's assessment beside the team's decisions, once the system has a review. */
  assessment: SystemAssessment | null;
  /** SOC reports uploaded for the system, with the CUECs read from them. */
  socReports: SocReport[];
  /** The Systems & Processes workflow (SP2, migration 0109). */
  environment: string | null;
  integrationIds: string[];
  processIds: string[];
  /** The control areas a person approved; null until one decides. */
  controlAreas: ControlArea[] | null;
  /** The agent's suggestion as it was shown when the areas were decided. */
  controlAreasSuggested: AreaSuggestions | null;
  controlAreasDecidedAt: string | null;
  /** Taken out of scope after launch (migration 0114), kept on record; null in scope. */
  outOfScope?: { at: string; reason: string } | null;
};

export type ControlArea = "ITGC" | "ITAC" | "IPE" | "BUSINESS";

/** The control areas a system's controls fall in, in the library's order. */
export const CONTROL_AREAS: ReadonlyArray<{
  id: ControlArea;
  label: string;
  detail: string;
}> = [
  {
    id: "ITGC",
    label: "IT general controls",
    detail: "Access, change, and operations controls",
  },
  {
    id: "ITAC",
    label: "Application controls",
    detail: "Automated controls within the application",
  },
  {
    id: "IPE",
    label: "Key reports (IPE)",
    detail: "Financial and operational reports",
  },
  {
    id: "BUSINESS",
    label: "Business process controls",
    detail: "Manual and IT-dependent controls",
  },
];

export type AreaSuggestion = {
  area: ControlArea;
  suggested: boolean;
  /** How many of the firm's library controls the area holds for the system. */
  controls: number;
  reason: string;
};

/** The setup agent's suggested areas: its rules over the documented facts and the
 * firm's standard library (source RULES); no model is called. */
export type AreaSuggestions = {
  source: string;
  libraryVersion: number;
  areas: AreaSuggestion[];
};

export const ENVIRONMENTS: ReadonlyArray<[string, string]> = [
  ["PRODUCTION", "Production"],
  ["NON_PRODUCTION", "Non-production"],
  ["BOTH", "Production and non-production"],
];

/** A new system starts as production, where the controls in scope run (decided by the
 * product owner on 27 October 2026); the person changes it when it is not. */
export const DEFAULT_ENVIRONMENT = "PRODUCTION";

function isArea(value: unknown): value is ControlArea {
  return CONTROL_AREAS.some((area) => area.id === value);
}

/** The agent's suggested areas as the API answers them; null when it does not. */
export function parseAreaSuggestions(value: unknown): AreaSuggestions | null {
  if (!isRecord(value) || !Array.isArray(value.areas)) {
    return null;
  }
  const areas = records(value.areas)
    .filter((item) => isArea(item.area))
    .map((item) => ({
      area: item.area as ControlArea,
      suggested: item.suggested === true,
      controls: Number(item.controls ?? 0),
      reason: str(item.reason),
    }));
  return {
    source: str(value.source) || "RULES",
    libraryVersion: Number(value.library_version ?? 0),
    areas,
  };
}

export type Applicability =
  | "RECOMMENDED"
  | "POTENTIAL"
  | "NOT_RECOMMENDED"
  | "JUDGMENT";
export const APPLICABILITY_LABELS: Record<Applicability, string> = {
  RECOMMENDED: "Recommended",
  POTENTIAL: "Potentially applicable",
  NOT_RECOMMENDED: "Not recommended",
  JUDGMENT: "Needs your judgment",
};
export type SocStatus = "RELEVANT" | "NOT_IDENTIFIED" | "UNDETERMINED";
export const SOC_STATUS_LABELS: Record<SocStatus, string> = {
  RELEVANT: "Relevant",
  NOT_IDENTIFIED: "Not currently identified as relevant",
  UNDETERMINED: "Undetermined: further assessment required",
};
export type CueStatus =
  | "ADDRESSED"
  | "PARTIAL"
  | "UNADDRESSED"
  | "NOT_ASSESSED";
export const CUE_STATUS_LABELS: Record<CueStatus, string> = {
  ADDRESSED: "Mapped to a control in scope",
  PARTIAL: "Partly mapped",
  UNADDRESSED: "No control in scope",
  NOT_ASSESSED: "Not yet assessed",
};

/** One control that could apply to a system: the agent's recommendation beside the
 * person's decision. */
export type Candidate = {
  controlRef: string;
  libraryKey: string | null;
  title: string;
  domain: string;
  description: string;
  controlId: string | null;
  inScope: boolean;
  status: Applicability | null;
  source: string;
  rationale: string;
  support: string;
  missing: string;
  confidence: string | null;
  decision: "SELECTED" | "NOT_SELECTED" | null;
  decisionNote: string;
  decidedBy: string | null;
  /** Where it comes from: the system's own control, the client's controls on other
   * systems adapted to it, or the library. */
  origin: CandidateOrigin;
  /** For a control adapted from the client's controls on other systems: their
   * references, and the standard whose wording it takes. */
  adaptedFrom: string[];
  follows: string;
};

export type CandidateOrigin = "SYSTEM" | "RCM" | "LIBRARY";

const MINOR_WORDS = new Set(["and", "of", "the", "for", "a", "an", "to", "on"]);

/** The system's code in control references, suggested from its name, as the API suggests
 * it (adapted_controls.suggested_code): an acronym it starts with (SAP S/4HANA: SAP), the
 * initials of several words (Active Directory: AD), or the start of one word (WOR). */
export function suggestedCode(name: string): string {
  const words = (
    name.replace(/\([^)]*\)/g, " ").match(/[A-Za-z0-9]+/g) ?? []
  ).filter((word) => !MINOR_WORDS.has(word.toLowerCase()));
  const [first] = words;
  if (first === undefined) {
    return "SYS";
  }
  if (first.length >= 2 && /^[A-Z]+$/.test(first)) {
    return first.slice(0, 8);
  }
  if (words.length === 1) {
    return (
      first
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 3) || "SYS"
    );
  }
  const initials = words
    .filter((word) => /^[A-Za-z]/.test(word))
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return initials.length >= 2
    ? initials.slice(0, 8)
    : first.toUpperCase().slice(0, 3);
}

/** The wizard's candidates in the order a person reads them: the system's own controls,
 * the client's controls from its RCM, then the standard library. Empty parts are left
 * out. */
export function candidateSections(
  candidates: readonly Candidate[],
  system: string,
): Array<{
  origin: CandidateOrigin;
  label: string;
  note: string;
  items: Candidate[];
}> {
  const parts: Array<[CandidateOrigin, string, string]> = [
    ["SYSTEM", `On ${system || "this system"}`, ""],
    [
      "RCM",
      "From the client's RCM",
      `The client's controls on its other systems. One with references naming their system is adapted to ${system || "this system"}: it takes this system's reference and the standard's wording, and the client confirms it.`,
    ],
    ["LIBRARY", "Standard library", ""],
  ];
  return parts
    .map(([origin, label, note]) => ({
      origin,
      label,
      note,
      items: candidates.filter((item) => item.origin === origin),
    }))
    .filter((part) => part.items.length > 0);
}

/**
 * The areas of a system's candidate controls, in the order given, with how many of each
 * are chosen: how the wizard shows where the controls are and moves between them. A
 * control listed under more than one source counts once.
 */
export function candidateAreas(
  candidates: readonly Candidate[],
  selected: Readonly<Record<string, boolean>> | null,
  order: readonly string[],
): Array<{ domain: string; total: number; chosen: number }> {
  const refs = new Map<string, Set<string>>();
  for (const item of candidates) {
    refs.set(
      item.domain,
      (refs.get(item.domain) ?? new Set()).add(item.controlRef),
    );
  }
  const known = [
    ...order,
    ...[...refs.keys()].filter((key) => !order.includes(key)),
  ];
  return known
    .filter((domain) => refs.has(domain))
    .map((domain) => {
      const area = [...(refs.get(domain) ?? [])];
      return {
        domain,
        total: area.length,
        chosen: area.filter((ref) => selected?.[ref] === true).length,
      };
    });
}

/** The selection with every one of these controls chosen, or none of them. */
export function chooseAll(
  selected: Readonly<Record<string, boolean>> | null,
  items: readonly Candidate[],
  value: boolean,
): Record<string, boolean> {
  return {
    ...(selected ?? {}),
    ...Object.fromEntries(items.map((item) => [item.controlRef, value])),
  };
}

export type SystemAssessment = {
  status: "IDLE" | "PENDING" | "WORKING";
  /** FALLBACK: the reviewed rules stood in for a model call that failed. */
  source: "NONE" | "RULES" | "AGENT" | "FALLBACK";
  reviewedAt: string | null;
  summary: string;
  note: string;
  socStatus: SocStatus | null;
  socAvailability: "STATED_AVAILABLE" | "NOT_FOUND" | "NOT_RESEARCHED";
  socProvider: string;
  socBasis: string;
  socSources: Array<{ url: string; title: string }>;
  assumptions: string[];
  questions: string[];
  candidates: Candidate[];
  decided: boolean;
  /** The system's code in the client's control references (ITGC-AD-02): set by a person,
   * or suggested from its name. */
  refCode: string;
};

export type SocCuec = {
  id: string;
  ref: string;
  text: string;
  quote: string;
  page: number | null;
  status: CueStatus;
  controls: Array<{ controlRef: string; rationale: string; inScope: boolean }>;
  limitations: string;
};

export type SocReport = {
  id: string;
  fileName: string;
  status: "READING" | "READ" | "FAILED";
  note: string;
  reportKind: string;
  serviceOrganization: string;
  reportType: string;
  periodStart: string | null;
  periodEnd: string | null;
  opinion: string;
  opinionPage: number | null;
  scope: string;
  exceptions: Array<{ text: string; page: number | null }>;
  cuecs: SocCuec[];
};

export const HOSTING_LABELS: Record<string, string> = {
  SAAS: "SaaS",
  VENDOR_HOSTED: "Vendor-hosted",
  ON_PREMISES: "On-premises",
};

/** Where a system's scoping stands, for its row in the systems list. */
export function systemStatus(
  system: SetupSystem,
): "reviewing" | "to-decide" | "no-controls" | "scoped" {
  const assessment = system.assessment;
  if (
    assessment !== null &&
    (assessment.status === "PENDING" || assessment.status === "WORKING")
  ) {
    return "reviewing";
  }
  // The agent recommended, and the team has not yet saved a selection.
  if (
    assessment !== null &&
    assessment.source !== "NONE" &&
    !assessment.decided
  ) {
    return "to-decide";
  }
  // Nothing would be tested for a system with no control in scope.
  return system.controlsInScope > 0 ? "scoped" : "no-controls";
}

/**
 * The wizard's starting selection: the team's saved decision, else what is in scope.
 * A recommendation is never selected for the team. A system just added in the wizard
 * (`added`) starts with nothing selected but what was decided: its copies of the
 * standards take their scope from another system's when added, and that is not a choice
 * anyone made for this one.
 */
export function initialSelection(
  candidates: readonly Candidate[],
  added = false,
): Record<string, boolean> {
  return Object.fromEntries(
    candidates.map((item) => [
      item.controlRef,
      item.decision !== null
        ? item.decision === "SELECTED"
        : added
          ? false
          : item.inScope,
    ]),
  );
}

/** The controls a selection leaves out although the agent recommended them: each needs
 * a reason before the selection is saved. */
export function needsReason(
  candidates: readonly Candidate[],
  selected: Readonly<Record<string, boolean>>,
  notes: Readonly<Record<string, string>>,
): string[] {
  return candidates
    .filter(
      (item) =>
        item.status === "RECOMMENDED" &&
        selected[item.controlRef] !== true &&
        (notes[item.controlRef] ?? "").trim() === "",
    )
    .map((item) => item.controlRef);
}

export type WizardWrite =
  | { error: "invalid" }
  | {
      method: "GET" | "POST" | "PATCH" | "PUT";
      path: string;
      body: unknown;
      /** How long to wait for the API, in ms, when longer than usual. */
      timeout?: number;
    };

const DETAIL_LIMITS: Record<string, number> = {
  description: 500,
  purpose: 1000,
  processes: 500,
  owner: 200,
};

const HOSTINGS = ["SAAS", "VENDOR_HOSTED", "ON_PREMISES"];

/** A system as the Add system wizard documents it, checked; null when anything is off. */
export function systemDraftBody(
  fields: Record<string, unknown>,
): Record<string, unknown> | null {
  const name = str(fields.name).trim();
  const layer = str(fields.layer);
  if (
    name === "" ||
    name.length > 120 ||
    SECRET.test(name) ||
    !LAYERS.some(([key]) => key === layer)
  ) {
    return null;
  }
  const body: Record<string, unknown> = { name, layer };
  for (const [key, limit] of Object.entries(DETAIL_LIMITS)) {
    const value = str(fields[key]).trim();
    if (value.length > limit || SECRET.test(value)) {
      return null;
    }
    body[key] = value;
  }
  const environment = str(fields.environment);
  if (environment !== "") {
    if (!ENVIRONMENTS.some(([key]) => key === environment)) {
      return null;
    }
    body.environment = environment;
  }
  const hosting = str(fields.hosting);
  if (hosting !== "") {
    if (!HOSTINGS.includes(hosting)) {
      return null;
    }
    body.hosting = hosting;
  }
  for (const key of ["integration_ids", "process_ids"]) {
    const ids = fields[key] ?? [];
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      !ids.every((id) => typeof id === "string" && UUID.test(id))
    ) {
      return null;
    }
    body[key] = ids;
  }
  return body;
}

const LIBRARY_KEY = /^[a-z][a-z0-9-]{0,60}$/;

/** The system or the process controls are selected for, as the API's query. */
function scopeTarget(
  fields: Record<string, unknown>,
): { system_id: string } | { process_id: string } | null {
  const system = str(fields.system_id);
  const process = str(fields.target_process_id);
  if ((system === "") === (process === "")) {
    return null;
  }
  if (system !== "") {
    return UUID.test(system) ? { system_id: system } : null;
  }
  return UUID.test(process) ? { process_id: process } : null;
}

/** A business process as the Add process wizard documents it, checked; null when
 * anything is off. */
export function processDraftBody(
  fields: Record<string, unknown>,
): Record<string, unknown> | null {
  const name = str(fields.name).trim();
  const domain = str(fields.domain);
  if (
    name === "" ||
    name.length > 120 ||
    SECRET.test(name) ||
    !PROCESS_CYCLES.some(([key]) => key === domain)
  ) {
    return null;
  }
  const description = str(fields.description).trim();
  const owner = str(fields.owner).trim();
  if (
    description.length > 500 ||
    owner.length > 200 ||
    SECRET.test(description) ||
    SECRET.test(owner)
  ) {
    return null;
  }
  const ids = fields.system_ids ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 50 ||
    !ids.every((id) => typeof id === "string" && UUID.test(id))
  ) {
    return null;
  }
  const primary = str(fields.primary_system_id);
  if (primary !== "" && !ids.includes(primary)) {
    return null;
  }
  return {
    name,
    domain,
    description,
    owner,
    system_ids: ids,
    ...(primary === "" ? {} : { primary_system_id: primary }),
  };
}

/** The API call for one step of the system wizard, checked before it is sent. */
export function wizardWrite(fields: Record<string, unknown>): WizardWrite {
  const organizationId = str(fields.organization_id);
  const projectId = str(fields.project_id);
  const systemId = str(fields.system_id);
  const intent = str(fields.intent);
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/onboarding`;
  // The Add business process wizard (SP3): the same, for a process.
  if (intent === "process-areas" || intent === "process-add") {
    const body = processDraftBody(fields);
    if (body === null) {
      return { error: "invalid" };
    }
    if (intent === "process-areas") {
      return { method: "POST", path: `${base}/processes/areas`, body };
    }
    const approved = fields.approved_areas;
    if (
      !Array.isArray(approved) ||
      approved.length > CONTROL_AREAS.length ||
      !approved.every(isArea)
    ) {
      return { error: "invalid" };
    }
    return {
      method: "POST",
      path: `${base}/processes/setup`,
      body: { ...body, approved_areas: [...new Set(approved)] },
    };
  }
  // Selecting controls (SP4): what can be selected for a system or a process, then the
  // selection; and Review and finalize (SP6) with the counts the person reviewed.
  if (intent === "scope-options" || intent === "scope-select") {
    const target = scopeTarget(fields);
    if (target === null) {
      return { error: "invalid" };
    }
    if (intent === "scope-options") {
      return {
        method: "GET",
        path: `${base}/scope/options?${new URLSearchParams(target).toString()}`,
        body: null,
      };
    }
    const keys = fields.library_keys;
    if (
      !Array.isArray(keys) ||
      keys.length === 0 ||
      keys.length > 150 ||
      !keys.every((key) => typeof key === "string" && LIBRARY_KEY.test(key))
    ) {
      return { error: "invalid" };
    }
    return {
      method: "POST",
      path: `${base}/scope/select`,
      body: { ...target, library_keys: [...new Set(keys)] },
    };
  }
  if (intent === "scope-finalize") {
    const counts = ["systems", "processes", "controls"].map((key) =>
      Number(fields[key]),
    );
    if (
      !counts.every((count) => Number.isInteger(count) && count >= 0) ||
      (counts[2] ?? 0) < 1
    ) {
      return { error: "invalid" };
    }
    return {
      method: "POST",
      path: `${base}/scope/finalize`,
      body: {
        systems: counts[0],
        processes: counts[1],
        controls: counts[2],
      },
    };
  }
  // The Add system wizard (SP2): the agent's suggested areas, then the system added in
  // one call with the areas a person approved.
  if (intent === "areas" || intent === "add") {
    const body = systemDraftBody(fields);
    if (body === null) {
      return { error: "invalid" };
    }
    if (intent === "areas") {
      return { method: "POST", path: `${base}/systems/areas`, body };
    }
    const approved = fields.approved_areas;
    if (
      !Array.isArray(approved) ||
      approved.length > CONTROL_AREAS.length ||
      !approved.every(isArea)
    ) {
      return { error: "invalid" };
    }
    return {
      method: "POST",
      path: `${base}/systems`,
      body: { ...body, approved_areas: [...new Set(approved)] },
    };
  }
  if (intent === "create") {
    const name = str(fields.name).trim();
    const layer = str(fields.layer);
    if (
      name === "" ||
      name.length > 120 ||
      SECRET.test(name) ||
      !LAYERS.some(([key]) => key === layer)
    ) {
      return { error: "invalid" };
    }
    return {
      method: "POST",
      path: `${base}/applications/known`,
      body: { names: [], custom: [{ name, layer }] },
    };
  }
  if (intent === "known") {
    const name = str(fields.name).trim();
    return name === "" || name.length > 120
      ? { error: "invalid" }
      : {
          method: "POST",
          path: `${base}/applications/known`,
          body: { names: [name] },
        };
  }
  if (intent === "suggest") {
    // The agent's suggested details; the system need not be in scope yet.
    const name = str(fields.name).trim();
    const layer = str(fields.layer);
    if (
      name === "" ||
      name.length > 120 ||
      SECRET.test(name) ||
      (layer !== "" && !LAYERS.some(([key]) => key === layer)) ||
      (systemId !== "" && !UUID.test(systemId))
    ) {
      return { error: "invalid" };
    }
    return {
      method: "POST",
      path: `${base}/systems/suggest`,
      body: {
        name,
        ...(layer === "" ? {} : { layer }),
        ...(systemId === "" ? {} : { system_id: systemId }),
      },
      timeout: 60000,
    };
  }
  if (!UUID.test(systemId)) {
    return { error: "invalid" };
  }
  const system = `${base}/systems/${systemId}`;
  if (intent === "details") {
    const body: Record<string, string> = {};
    for (const [key, limit] of Object.entries(DETAIL_LIMITS)) {
      const value = str(fields[key]).trim();
      if (value.length > limit || SECRET.test(value)) {
        return { error: "invalid" };
      }
      body[key] = value;
    }
    // The system's code in control references: sent when given; empty goes back to the
    // suggestion from its name.
    if (typeof fields.ref_code === "string") {
      const code = fields.ref_code.trim().toUpperCase();
      if (code !== "" && !/^[A-Z][A-Z0-9]{0,7}$/.test(code)) {
        return { error: "invalid" };
      }
      body.ref_code = code;
    }
    return { method: "PATCH", path: `${system}/details`, body };
  }
  if (intent === "assess") {
    return { method: "POST", path: `${system}/review`, body: {} };
  }
  if (intent === "remove") {
    return {
      method: "POST",
      path: `${base}/applications/${systemId}/remove`,
      body: {},
    };
  }
  if (intent === "save") {
    const selections = (
      Array.isArray(fields.selections) ? fields.selections : []
    )
      .filter(isRecord)
      .map((item) => ({
        control_ref: str(item.control_ref).trim(),
        selected: item.selected === true,
        note: str(item.note).trim(),
      }));
    if (
      selections.length === 0 ||
      selections.length > 120 ||
      selections.some(
        (item) =>
          item.control_ref === "" ||
          item.control_ref.length > 60 ||
          item.note.length > 500 ||
          SECRET.test(item.note),
      )
    ) {
      return { error: "invalid" };
    }
    return {
      method: "PUT",
      path: `${system}/applicability`,
      body: { selections },
    };
  }
  if (intent === "soc-remove") {
    const reportId = str(fields.report_id);
    return UUID.test(reportId)
      ? {
          method: "POST",
          path: `${base}/systems/soc-reports/${reportId}/remove`,
          body: {},
        }
      : { error: "invalid" };
  }
  return { error: "invalid" };
}

export type DetailField =
  | "layer"
  | "description"
  | "purpose"
  | "processes"
  | "owner";
export type SuggestionBasis = "RECORDS" | "PRODUCT" | "CATALOGUE";

/** The agent's suggested details for a system. Never saved until a person saves them. */
export type DetailSuggestion = {
  layer: string | null;
  description: string;
  purpose: string;
  processes: string;
  owner: string;
  basis: Partial<Record<DetailField, SuggestionBasis>>;
  /** MODEL: the agent answered; RULES: only the catalogue and the records were used;
   * FALLBACK: the agent failed and the catalogue and records were used instead. */
  source: "MODEL" | "RULES" | "FALLBACK";
  note: string;
};

const BASES: ReadonlyArray<SuggestionBasis> = [
  "RECORDS",
  "PRODUCT",
  "CATALOGUE",
];
const DETAIL_FIELDS: ReadonlyArray<DetailField> = [
  "layer",
  "description",
  "purpose",
  "processes",
  "owner",
];

/** The suggestion as the API answered it, or null when it does not fit. */
export function parseSuggestion(value: unknown): DetailSuggestion | null {
  if (!isRecord(value)) {
    return null;
  }
  const layer = str(value.layer);
  const basis: Partial<Record<DetailField, SuggestionBasis>> = {};
  const given = isRecord(value.basis) ? value.basis : {};
  for (const field of DETAIL_FIELDS) {
    const item = str(given[field]);
    if ((BASES as ReadonlyArray<string>).includes(item)) {
      basis[field] = item as SuggestionBasis;
    }
  }
  return {
    layer: LAYERS.some(([key]) => key === layer) ? layer : null,
    description: str(value.description).slice(0, DETAIL_LIMITS.description),
    purpose: str(value.purpose).slice(0, DETAIL_LIMITS.purpose),
    processes: str(value.processes).slice(0, DETAIL_LIMITS.processes),
    owner: str(value.owner).slice(0, DETAIL_LIMITS.owner),
    basis,
    source: value.source === "MODEL" ? "MODEL" : "RULES",
    note: str(value.note),
  };
}

type DetailValues = {
  layer: string;
  description: string;
  purpose: string;
  processes: string;
  owner: string;
};

/** Fill the fields a person left empty with the suggestion; never overwrite what they
 * wrote. The kind changes only when the person has not chosen it. Returns the fields
 * filled. */
export function applySuggestion<T extends DetailValues>(
  details: T,
  suggestion: DetailSuggestion,
  layerChosen: boolean,
): { details: T; filled: DetailField[] } {
  const next = { ...details };
  const filled: DetailField[] = [];
  if (
    !layerChosen &&
    suggestion.layer !== null &&
    suggestion.basis.layer !== undefined &&
    suggestion.layer !== details.layer
  ) {
    next.layer = suggestion.layer;
    filled.push("layer");
  }
  for (const field of [
    "description",
    "purpose",
    "processes",
    "owner",
  ] as const) {
    if (details[field].trim() === "" && suggestion[field].trim() !== "") {
      next[field] = suggestion[field];
      filled.push(field);
    }
  }
  return { details: next, filled };
}

/** Where a suggested value came from, as the wizard says it. */
export function basisLabel(basis: SuggestionBasis | undefined): string {
  if (basis === "RECORDS") {
    return "Suggested from the engagement's records";
  }
  if (basis === "CATALOGUE") {
    return "Suggested from the reviewed system catalogue";
  }
  return "Suggested from what is known of the product";
}

/** The line shown once the agent has answered. */
export function suggestionSummary(
  suggestion: DetailSuggestion,
  filled: number,
): string {
  const done =
    filled === 0
      ? "No empty fields could be filled."
      : `${filled} ${filled === 1 ? "field was" : "fields were"} filled. Review each suggestion before saving.`;
  return suggestion.note === "" ? done : `${done} ${suggestion.note}`;
}

/** What to tell the team when a wizard call did not succeed. */
export function wizardProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  const known: Record<string, string> = {
    "say why a recommended control is not selected":
      "Say why each recommended control you leave out is not selected.",
    "unknown control": "A control changed. Refresh and try again.",
    "system changed": "This system changed. Refresh and try again.",
    "a detail cannot hold a credential":
      "A detail cannot hold a password or key.",
    "a note cannot hold a credential": "A note cannot hold a password or key.",
    "the report has no readable text; upload a text PDF rather than a scan":
      "The report has no readable text. Upload a text PDF rather than a scan.",
    "file is larger than 25 MB": "The report is larger than 25 MB.",
    "system is already in scope":
      "That system is already in scope. Open it from the list instead.",
    "engagement is archived":
      "This engagement is archived, so its systems cannot change.",
  };
  if (detail in known) {
    return known[detail] ?? null;
  }
  if (status === 403 || status === 404) {
    return "Your role cannot change this engagement's systems.";
  }
  if (status === 409) {
    return "This changed while you were working. Refresh and try again.";
  }
  if (status === 422) {
    return "Check the entries: each needs to fit its length and hold no credential.";
  }
  return "That could not be saved. Try again; your selections are kept.";
}

/**
 * A system's name as compared for duplicates, as the API compares it: case and spacing
 * aside, so "SAP ERP" and " sap  erp" are one system (Milestone 8.13).
 */
export function systemNameKey(name: string): string {
  return name.trim().split(/\s+/).join(" ").toLowerCase();
}

/** The system in scope with this name, however it is written, if there is one. */
export function systemNamed<T extends { name: string }>(
  systems: readonly T[],
  name: string,
): T | undefined {
  const key = systemNameKey(name);
  return systems.find((system) => systemNameKey(system.name) === key);
}

/** Known systems by layer, in the order the picker shows them. */

const KINDS: ReadonlyArray<SystemRecommendation["kind"]> = [
  "INCLUDE",
  "EXCLUDE",
  "ADD_SOC_REVIEW",
  "MAP_CUEC",
  "CUEC_GAP",
];

function parseSystem(item: Record<string, unknown>): SetupSystem {
  const review = isRecord(item.review) ? item.review : null;
  const status = review !== null ? str(review.status) : "";
  const source = review !== null ? str(review.source) : "";
  const factsSource = str(item.facts_source);
  return {
    id: str(item.id),
    name: str(item.name),
    description: str(item.description),
    layer: str(item.layer) || "APPLICATION",
    hosting: typeof item.hosting === "string" ? item.hosting : null,
    socExpected:
      typeof item.soc_expected === "boolean" ? item.soc_expected : null,
    factsSource:
      factsSource === "RULES" ||
      factsSource === "AGENT" ||
      factsSource === "PERSON"
        ? factsSource
        : "NONE",
    factsReason: str(item.facts_reason),
    factsConfirmed: item.facts_confirmed === true,
    version: typeof item.version === "number" ? item.version : 1,
    review:
      review === null
        ? null
        : {
            status:
              status === "PENDING" || status === "WORKING" ? status : "IDLE",
            source:
              source === "RULES" || source === "AGENT" || source === "FALLBACK"
                ? source
                : "NONE",
            summary: str(review.summary),
            coverage: str(review.coverage),
            cuecs: records(review.cuecs).map((cuec, index) => ({
              ref: str(cuec.ref) || `CUEC-${index + 1}`,
              text: str(cuec.text),
              controlId:
                typeof cuec.control_id === "string" ? cuec.control_id : null,
              controlRef:
                typeof cuec.control_ref === "string" ? cuec.control_ref : null,
              inScope: cuec.in_scope === true,
            })),
            note: str(review.note),
          },
    controlsInScope:
      typeof item.controls_in_scope === "number" ? item.controls_in_scope : 0,
    otherControls: records(item.other_controls).map((control) => ({
      libraryKey: str(control.library_key),
      controlRef: str(control.control_ref),
      title: str(control.title),
      domain: str(control.domain),
      controlId:
        typeof control.control_id === "string" ? control.control_id : null,
    })),
    purpose: str(item.purpose),
    processes: str(item.processes),
    owner: str(item.owner),
    refCode: str(item.ref_code),
    assessment: parseAssessment(item.assessment),
    socReports: records(item.soc_reports).map(parseSocReport),
    environment: typeof item.environment === "string" ? item.environment : null,
    integrationIds: strings(item.integration_ids),
    processIds: strings(item.process_ids),
    controlAreas: Array.isArray(item.control_areas)
      ? item.control_areas.filter(isArea)
      : null,
    controlAreasSuggested: parseAreaSuggestions(item.control_areas_suggested),
    controlAreasDecidedAt:
      typeof item.control_areas_decided_at === "string"
        ? item.control_areas_decided_at
        : null,
    outOfScope:
      typeof item.out_of_scope_at === "string"
        ? {
            at: item.out_of_scope_at,
            reason:
              typeof item.out_of_scope_reason === "string"
                ? item.out_of_scope_reason
                : "",
          }
        : null,
    recommendations: records(item.recommendations)
      .filter((rec) => KINDS.some((kind) => kind === rec.kind))
      .map((rec) => ({
        id: str(rec.id),
        kind: rec.kind as SystemRecommendation["kind"],
        controlId: typeof rec.control_id === "string" ? rec.control_id : null,
        libraryKey:
          typeof rec.library_key === "string" ? rec.library_key : null,
        controlRef: str(rec.control_ref),
        controlTitle: str(rec.control_title),
        cuec: str(rec.cuec),
        reason: str(rec.reason),
        cuecRefs: strings(rec.cuec_refs),
        status:
          rec.status === "ACCEPTED" || rec.status === "DISMISSED"
            ? rec.status
            : "PROPOSED",
      })),
  };
}

const APPLICABILITY = Object.keys(APPLICABILITY_LABELS) as Applicability[];
const pick = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null => allowed.find((item) => item === value) ?? null;
const pageOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

function parseAssessment(value: unknown): SystemAssessment | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    status: pick(value.status, ["PENDING", "WORKING"] as const) ?? "IDLE",
    source:
      pick(value.source, ["RULES", "AGENT", "FALLBACK"] as const) ?? "NONE",
    reviewedAt:
      typeof value.reviewed_at === "string" ? value.reviewed_at : null,
    summary: str(value.summary),
    note: str(value.note),
    socStatus: pick(value.soc_status, [
      "RELEVANT",
      "NOT_IDENTIFIED",
      "UNDETERMINED",
    ] as const),
    socAvailability:
      pick(value.soc_availability, [
        "STATED_AVAILABLE",
        "NOT_FOUND",
      ] as const) ?? "NOT_RESEARCHED",
    socProvider: str(value.soc_provider),
    socBasis: str(value.soc_basis),
    socSources: records(value.soc_sources)
      .map((item) => ({ url: str(item.url), title: str(item.title) }))
      .filter((item) => /^https?:\/\//.test(item.url)),
    assumptions: strings(value.assumptions),
    questions: strings(value.questions),
    candidates: records(value.candidates).map((item) => ({
      controlRef: str(item.control_ref),
      libraryKey:
        typeof item.library_key === "string" ? item.library_key : null,
      title: str(item.title),
      domain: str(item.domain),
      description: str(item.description),
      controlId: typeof item.control_id === "string" ? item.control_id : null,
      inScope: item.in_scope === true,
      status: pick(item.status, APPLICABILITY),
      source: str(item.source),
      rationale: str(item.rationale),
      support: str(item.support),
      missing: str(item.missing),
      confidence: typeof item.confidence === "string" ? item.confidence : null,
      decision: pick(item.decision, ["SELECTED", "NOT_SELECTED"] as const),
      decisionNote: str(item.decision_note),
      decidedBy: typeof item.decided_by === "string" ? item.decided_by : null,
      origin:
        pick(item.origin, ["RCM", "LIBRARY"] as const) ??
        ("SYSTEM" as CandidateOrigin),
      adaptedFrom: strings(item.adapted_from),
      follows: str(item.follows),
    })),
    decided: value.decided === true,
    refCode: str(value.ref_code),
  };
}

function parseSocReport(item: Record<string, unknown>): SocReport {
  return {
    id: str(item.id),
    fileName: str(item.file_name),
    status: pick(item.status, ["READ", "FAILED"] as const) ?? "READING",
    note: str(item.note),
    reportKind: str(item.report_kind) || "SOC1",
    serviceOrganization: str(item.service_organization),
    reportType: str(item.report_type),
    periodStart:
      typeof item.period_start === "string" ? item.period_start : null,
    periodEnd: typeof item.period_end === "string" ? item.period_end : null,
    opinion: str(item.opinion),
    opinionPage: pageOf(item.opinion_page),
    scope: str(item.scope),
    exceptions: records(item.exceptions).map((entry) => ({
      text: str(entry.text),
      page: pageOf(entry.page),
    })),
    cuecs: records(item.cuecs).map((cuec) => ({
      id: str(cuec.id),
      ref: str(cuec.ref),
      text: str(cuec.text),
      quote: str(cuec.quote),
      page: pageOf(cuec.page),
      status:
        pick(cuec.status, ["ADDRESSED", "PARTIAL", "UNADDRESSED"] as const) ??
        "NOT_ASSESSED",
      controls: records(cuec.controls).map((control) => ({
        controlRef: str(control.control_ref),
        rationale: str(control.rationale),
        inScope: control.in_scope === true,
      })),
      limitations: str(cuec.limitations),
    })),
  };
}

/** Known systems by layer, in the order the picker shows them. */
export function knownSystemGroups(
  systems: ReadonlyArray<{ name: string; layer: string }>,
): Array<{ layer: string; label: string; names: string[] }> {
  return LAYERS.map(([layer, label]) => ({
    layer,
    label,
    names: systems
      .filter((system) => system.layer === layer)
      .map((system) => system.name),
  })).filter((group) => group.names.length > 0);
}

/** The known systems a search and a kind leave showing; "ALL" is every kind. */
export function filterSystems<T extends { name: string; layer: string }>(
  systems: readonly T[],
  query: string,
  layer: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return systems.filter(
    (system) =>
      (layer === "ALL" || system.layer === layer) &&
      words.every((word) => system.name.toLowerCase().includes(word)),
  );
}

/** What the search offers to add as a custom system, or null when the name is taken. */
export function customCandidate(
  query: string,
  taken: readonly string[],
): string | null {
  const name = query.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 120 || SECRET.test(name)) {
    return null;
  }
  const lower = name.toLowerCase();
  return taken.some((item) => item.toLowerCase() === lower) ? null : name;
}

/** Each person on the team once, however many roles they hold. */
export function teamPeople<T extends { userId: string }>(
  team: readonly T[],
): T[] {
  const seen = new Set<string>();
  return team.filter((member) => {
    if (seen.has(member.userId)) {
      return false;
    }
    seen.add(member.userId);
    return true;
  });
}

export function parseSetupNotice(value: string | null): SetupNotice | null {
  return NOTICES.find((notice) => notice === value) ?? null;
}

export function setupNoticeFor(
  intent: string,
  status: number,
  detail: string,
): SetupNotice {
  // No answer in time (status -1): the work may well have finished, so never say it failed.
  if (status === -1) {
    return intent === "launch" || intent === "approve"
      ? "setup-launch-slow"
      : "setup-slow";
  }
  if (
    intent.endsWith("-domain") &&
    detail === "email domain does not accept mail"
  ) {
    return "domain-no-mail";
  }
  if (intent.endsWith("-domain") && detail === "email domain is disposable") {
    return "domain-disposable";
  }
  const refused = INVITE_REFUSALS[detail];
  if (
    refused !== undefined &&
    (intent === "invite-member" || intent.endsWith("-domain"))
  ) {
    return refused;
  }
  if (status === 200 && intent === "invite-member") {
    return "invite-sent";
  }
  if (status === 200 && intent === "send-welcomes") {
    return "welcomes-sent";
  }
  if (status === 409 && detail === "live email is off") {
    return "live-email-off";
  }
  if (status === 200 && intent.endsWith("-domain")) {
    return "domain-saved";
  }
  if (status === 200 && intent === "period-confirm") {
    return "setup-period-confirmed";
  }
  if (status === 409 && detail.startsWith("say why")) {
    return "setup-needs-reason";
  }
  if (status === 409 && detail === "name another reviewer first") {
    return "setup-last-reviewer";
  }
  if (
    status === 409 &&
    (detail === "the period changed" || detail === "nothing to confirm")
  ) {
    return "setup-period-changed";
  }
  if (status === 200) {
    return intent === "approve" || intent === "launch"
      ? "setup-launched"
      : intent === "rcm-import"
        ? "setup-rcm-imported"
        : intent === "suggest"
          ? "setup-drafting"
          : intent === "accept-suggestions"
            ? "setup-accepted"
            : intent === "workpaper-template-customize"
              ? "setup-template-customized"
              : intent === "workpaper-template-save"
                ? "setup-template-saved"
                : "setup-saved";
  }
  if (status === 409 && detail === "mapping is incomplete") {
    return "setup-rcm-incomplete";
  }
  if (status === 409 && detail === "control ID exists") {
    return "setup-control-exists";
  }
  if (
    status === 409 &&
    detail.startsWith("this system already has it in scope as")
  ) {
    return "setup-control-in-scope";
  }
  if (status === 409 && detail === "process exists") {
    return "setup-process-exists";
  }
  if (status === 409 && detail === "process has controls") {
    return "setup-process-in-use";
  }
  if (status === 409 && detail === "confirm how the system is run first") {
    return "system-needs-facts";
  }
  if (status === 409 && detail === "add an in-scope system first") {
    return "setup-needs-system";
  }
  if (status === 409 && detail === "engagement has started") {
    // A second launch (another tab, a double press) finds the first one done.
    return intent === "launch" || intent === "approve"
      ? "setup-already-launched"
      : "setup-started";
  }
  if (
    status === 409 &&
    (detail === "engagement is archived" ||
      detail === "engagement is not active: it is archived and read-only")
  ) {
    return "setup-archived";
  }
  if (
    status === 409 &&
    (detail === "engagement is completed" ||
      detail === "engagement is not active: it is completed and read-only")
  ) {
    return "setup-completed";
  }
  if (status === 409 && detail === "system is already in scope") {
    return "setup-system-exists";
  }
  if (status === 409 && detail === "control has testing on record") {
    return "setup-control-tested";
  }
  if (status === 409 && detail === "setup is not complete") {
    return "setup-incomplete";
  }
  if (
    status === 409 &&
    detail === "the suggested period end is not after the period start"
  ) {
    return "setup-period-order";
  }
  if (status === 409) {
    return "setup-changed";
  }
  if (status === 401 || status === 403) {
    return "setup-denied";
  }
  if (status === 422) {
    return "setup-invalid";
  }
  return "setup-unavailable";
}

// The API's stable reasons for refusing an invitation or a firm domain.
const INVITE_REFUSALS: Record<string, SetupNotice> = {
  "email is not valid": "invite-email",
  "name is not valid": "setup-invalid",
  "email domain is not the firm's": "invite-domain",
  "email domain is disposable": "invite-disposable",
  "email domain does not accept mail": "invite-no-mail",
  "email domain could not be checked": "invite-unchecked",
  "firm has no email domains": "invite-no-domains",
  "invitation limit reached": "invite-limit",
  "person is disabled": "invite-disabled",
  "domain is not valid": "domain-invalid",
  "domain is a public mail service": "domain-public",
};

/** An email address the API will consider; the API makes every other check. */
export function inviteEmail(value: string): string | null {
  const email = value.trim();
  if (email.length > 254 || !INVITE_EMAIL.test(email) || email.includes("..")) {
    return null;
  }
  return email;
}

const INVITE_EMAIL =
  /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const DOMAIN_NAME =
  /^@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** The notice after a client RCM upload. */
export function rcmUploadNoticeFor(status: number): SetupNotice {
  if (status === 200) {
    return "setup-rcm-uploaded";
  }
  if (status === 413) {
    return "setup-rcm-large";
  }
  if (status === 422) {
    return "setup-rcm-unreadable";
  }
  if (status === 409) {
    return "setup-started";
  }
  if (status === 401 || status === 403) {
    return "setup-denied";
  }
  return "setup-unavailable";
}

export const RCM_MAX_BYTES = 5_000_000;

export function templateUploadNoticeFor(status: number): SetupNotice {
  if (status === 200) {
    return "setup-template-uploaded";
  }
  if (status === 413 || status === 422) {
    return "setup-template-unreadable";
  }
  if (status === 409) {
    return "setup-started";
  }
  if (status === 401 || status === 403) {
    return "setup-denied";
  }
  return "setup-unavailable";
}

/** Checks a firm's workpaper template before its bytes go to the API. */
export function templateUploadTarget(
  fields: Record<string, string>,
  file: { name: string; size: number } | null,
): { path: string; fileName: string } | null {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const kind = fields.kind ?? "";
  const part = fields.part ?? "whole";
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !TEMPLATE_KINDS.some((item) => item.id === kind) ||
    (part !== "whole" && PERIOD_LABELS[part] === undefined) ||
    file === null ||
    file.size === 0 ||
    file.size > RCM_MAX_BYTES
  ) {
    return null;
  }
  const fileName = (file.name.split(/[\\/]/).pop() ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  if (!/\.(docx|xlsx|xlsm)$/i.test(fileName)) {
    return null;
  }
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/onboarding/workpaper-templates?file_name=${encodeURIComponent(fileName)}&kind=${kind}&part=${part}`,
    fileName,
  };
}

/** Checks an upload before its bytes go to the API. The name is only a label. */
export function rcmUploadTarget(
  fields: Record<string, string>,
  file: { name: string; size: number } | null,
): { path: string; fileName: string } | null {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    file === null ||
    file.size === 0 ||
    file.size > RCM_MAX_BYTES
  ) {
    return null;
  }
  const fileName = (file.name.split(/[\\/]/).pop() ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  if (!/\.(csv|xlsx|xlsm|txt)$/i.test(fileName)) {
    return null;
  }
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/onboarding/rcm/uploads?file_name=${encodeURIComponent(fileName)}`,
    fileName,
  };
}

export type SetupWrite =
  | { error: "invalid" }
  | {
      intent: string;
      step: SetupStep;
      method: "POST" | "PATCH" | "PUT";
      path: string;
      body: Record<string, unknown>;
    };

/** Turn one setup form into one API call. Every value is checked before it is sent. */
const TEAM_ROLES = ["LEAD", "PREPARER", "REVIEWER"];

/**
 * The roles a person is given in one step: the first as their role, any others as
 * additional roles (development only; the API refuses them while reviewer independence
 * is required). Null when none is chosen or one is not a role.
 */
export function teamRoles(
  fields: Record<string, string>,
  multi: Record<string, string[]>,
): { engagement_role: string; additional_roles?: string[] } | null {
  const chosen = [
    ...new Set(
      multi.engagement_role ??
        (fields.engagement_role ? [fields.engagement_role] : []),
    ),
  ];
  const [first, ...rest] = chosen;
  if (
    first === undefined ||
    chosen.some((role) => !TEAM_ROLES.includes(role))
  ) {
    return null;
  }
  return rest.length === 0
    ? { engagement_role: first }
    : { engagement_role: first, additional_roles: rest };
}

export function setupWrite(
  fields: Record<string, string>,
  multi: Record<string, string[]> = {},
): SetupWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const intent = fields.intent ?? "";
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/onboarding`;
  const text = (name: string, max: number): string | null => {
    const value = (fields[name] ?? "").trim();
    return value.length > max || SECRET.test(value) ? null : value;
  };
  const integer = (name: string, min: number, max: number): number | null => {
    const raw = fields[name] ?? "";
    if (!/^\d{1,3}$/.test(raw)) {
      return null;
    }
    const value = Number(raw);
    return value < min || value > max ? null : value;
  };
  if (intent === "profile") {
    const client = text("client_name", 200);
    const type = fields.engagement_type ?? "";
    const period = (fields.period_end ?? "").trim();
    const start = (fields.period_start ?? "").trim();
    const methodology = fields.methodology ?? "";
    // Left off the form: kept as they are.
    const fiscal = "fiscal_year" in fields ? text("fiscal_year", 20) : "";
    const objectives =
      "reporting_objectives" in fields
        ? text("reporting_objectives", 2000)
        : "";
    // The profile step's one Save carries the scope too, written with the profile.
    const scope = "scope" in fields ? text("scope", 4000) : "";
    if (
      client === null ||
      fiscal === null ||
      objectives === null ||
      scope === null ||
      !ENGAGEMENT_TYPES.some((item) => item.id === type) ||
      (period !== "" && !DATE.test(period)) ||
      (start !== "" && !DATE.test(start)) ||
      (start !== "" && period !== "" && start >= period) ||
      (methodology !== "" &&
        !METHODOLOGIES.some((item) => item.id === methodology))
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "profile",
      method: "PATCH",
      path: `${base}/profile`,
      body: {
        client_name: client,
        engagement_type: type,
        ...("period_end" in fields
          ? { period_end: period === "" ? null : period }
          : {}),
        ...("period_start" in fields
          ? { period_start: start === "" ? null : start }
          : {}),
        ...(methodology === "" ? {} : { methodology }),
        ...("fiscal_year" in fields ? { fiscal_year: fiscal } : {}),
        ...("reporting_objectives" in fields
          ? { reporting_objectives: objectives }
          : {}),
        ...("scope" in fields ? { scope } : {}),
      },
    };
  }
  if (intent === "period-align") {
    // Correct where the period and the engagement's words disagree, from the conflict
    // itself: the period end, the name, the scope, or the fiscal year label.
    const basis = fields.basis ?? "";
    const to = fields.to ?? "";
    if (
      !/^[0-9a-f]{32}$/.test(basis) ||
      !["period_end", "name", "scope", "fiscal_year"].includes(to)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: parseStep(fields.step ?? "profile"),
      method: "POST",
      path: `${base}/period/align`,
      body: { basis, to },
    };
  }
  if (intent === "period-confirm") {
    const basis = fields.basis ?? "";
    if (!/^[0-9a-f]{32}$/.test(basis)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: parseStep(fields.step ?? "profile"),
      method: "POST",
      path: `${base}/period/confirm`,
      body: { basis },
    };
  }
  if (intent === "suggest") {
    const step = parseStep(fields.step ?? null);
    return {
      intent,
      step,
      method: "POST",
      path: `${base}/suggestions/draft`,
      body: {},
    };
  }
  if (intent === "accept-suggestions") {
    const version = integer("draft_version", 1, 999);
    const chosen = (multi.field ?? []).filter(
      (item): item is "scope" | "period_end" | "cadence" =>
        item === "scope" || item === "period_end" || item === "cadence",
    );
    if (version === null || chosen.length === 0) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: parseStep(fields.step ?? null),
      method: "POST",
      path: `${base}/suggestions/accept`,
      body: { version, fields: [...new Set(chosen)] },
    };
  }
  if (intent === "scope") {
    const scope = text("scope", 4000);
    const period = (fields.period_end ?? "").trim();
    if (scope === null || (period !== "" && !DATE.test(period))) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "profile",
      method: "PATCH",
      path: `${base}/scope`,
      body: { scope, period_end: period === "" ? null : period },
    };
  }
  if (intent === "process-new") {
    const name = text("name", 120);
    const domain = fields.domain ?? "";
    if (
      name === null ||
      name === "" ||
      !PROCESS_CYCLES.some(([key]) => key === domain)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/processes`,
      body: { name, domain },
    };
  }
  if (intent === "process-remove") {
    const processId = fields.process_id ?? "";
    if (!UUID.test(processId)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/processes/${processId}/remove`,
      body: {},
    };
  }
  if (intent === "add-application") {
    const name = text("name", 120);
    const description = text("description", 500);
    if (name === null || name === "" || description === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/applications`,
      body: { name, description },
    };
  }
  if (intent === "add-known-systems") {
    const names = [
      ...new Set((multi.systems ?? []).map((name) => name.trim())),
    ];
    // Custom systems come as pairs: custom_name[i] with custom_layer[i].
    const customNames = multi.custom_name ?? [];
    const customLayers = multi.custom_layer ?? [];
    const custom = customNames.map((name, index) => ({
      name: name.replace(/\s+/g, " ").trim(),
      layer: customLayers[index] ?? "",
    }));
    if (
      names.length + custom.length === 0 ||
      names.length > 60 ||
      custom.length > 20 ||
      customNames.length !== customLayers.length ||
      names.some((name) => name === "" || name.length > 120) ||
      custom.some(
        (item) =>
          item.name === "" ||
          item.name.length > 120 ||
          SECRET.test(item.name) ||
          !LAYERS.some(([key]) => key === item.layer),
      )
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/applications/known`,
      body: { names, custom },
    };
  }
  if (intent === "restore-application") {
    const id = fields.application_id ?? "";
    if (!UUID.test(id)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/applications/${id}/restore`,
      body: {},
    };
  }
  if (intent === "remove-application") {
    const id = fields.application_id ?? "";
    const reason = text("reason", 500);
    if (!UUID.test(id) || reason === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/applications/${id}/remove`,
      body: reason === "" ? {} : { reason },
    };
  }
  if (intent === "add-member") {
    const userId = fields.user_id ?? "";
    const roles = teamRoles(fields, multi);
    if (!UUID.test(userId) || roles === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "team",
      method: "POST",
      path: `${base}/team`,
      body: { user_id: userId, ...roles },
    };
  }
  if (intent === "invite-member") {
    const email = inviteEmail(fields.email ?? "");
    const name = text("display_name", 120);
    const roles = teamRoles(fields, multi);
    if (
      email === null ||
      name === null ||
      /[<>@\r\n]/.test(name) ||
      roles === null
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "team",
      method: "POST",
      path: `${base}/team/invite`,
      body: { email, display_name: name, ...roles },
    };
  }
  if (
    intent === "system-facts" ||
    intent === "system-review" ||
    intent === "system-decide" ||
    intent === "system-add-control" ||
    intent === "system-remove-control"
  ) {
    const systemId = fields.system_id ?? "";
    if (!UUID.test(systemId)) {
      return { error: "invalid" };
    }
    const path = `${base}/systems/${systemId}`;
    if (intent === "system-remove-control") {
      const controlId = fields.control_id ?? "";
      const reason = text("reason", 500);
      if (!UUID.test(controlId) || reason === null) {
        return { error: "invalid" };
      }
      return {
        intent,
        step: "controls",
        method: "POST",
        path: `${path}/controls/remove`,
        body: {
          control_id: controlId,
          ...(reason === "" ? {} : { reason }),
        },
      };
    }
    if (intent === "system-add-control") {
      const libraryKey = fields.library_key ?? "";
      const controlId = fields.control_id ?? "";
      if (controlId !== "" && UUID.test(controlId)) {
        return {
          intent,
          step: "controls",
          method: "POST",
          path: `${path}/controls/add`,
          body: { control_id: controlId },
        };
      }
      if (controlId !== "" || !/^[a-z][a-z0-9-]{0,60}$/.test(libraryKey)) {
        return { error: "invalid" };
      }
      return {
        intent,
        step: "controls",
        method: "POST",
        path: `${path}/controls/add`,
        body: { library_key: libraryKey },
      };
    }
    if (intent === "system-review") {
      return {
        intent,
        step: "controls",
        method: "POST",
        path: `${path}/review`,
        body: {},
      };
    }
    if (intent === "system-facts") {
      const hosting = fields.hosting ?? "";
      const soc = fields.soc_expected ?? "";
      const version = Number(fields.version ?? "");
      if (
        !["", "SAAS", "VENDOR_HOSTED", "ON_PREMISES"].includes(hosting) ||
        !["", "yes", "no"].includes(soc) ||
        !Number.isInteger(version) ||
        version < 1
      ) {
        return { error: "invalid" };
      }
      return {
        intent,
        step: "controls",
        method: "PATCH",
        path: `${path}/facts`,
        body: {
          version,
          hosting: hosting === "" ? null : hosting,
          soc_expected: soc === "" ? null : soc === "yes",
        },
      };
    }
    const ids = [...new Set(multi.recommendation ?? [])];
    const action = fields.action ?? "";
    if (
      ids.length === 0 ||
      ids.length > 60 ||
      !ids.every((id) => UUID.test(id)) ||
      (action !== "ACCEPT" && action !== "DISMISS" && action !== "KEEP")
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${path}/recommendations/decide`,
      body: { ids, action },
    };
  }
  if (intent === "control-scope") {
    const id = fields.control_id ?? "";
    const included = fields.included ?? "";
    if (!UUID.test(id) || (included !== "true" && included !== "false")) {
      return { error: "invalid" };
    }
    const reason = text("reason", 500);
    if (reason === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/controls/${id}/scope`,
      body: {
        included: included === "true",
        ...(reason === "" ? {} : { reason }),
      },
    };
  }
  if (intent === "control-new") {
    const ref = (fields.control_ref ?? "").trim();
    const title = text("title", 200);
    const risk = text("risk", 1000);
    const activity = (fields.activity ?? "").trim();
    // The area comes as a domain, or as one pick from the standard cycles and the
    // processes the team named ("domain:KEY" or "process:ID"); a named process fixes
    // the area on the server.
    let domain = fields.domain ?? "";
    let processId = fields.process_id ?? "";
    const pick = fields.process ?? "";
    if (pick.startsWith("process:")) {
      processId = pick.slice("process:".length);
      domain = "";
    } else if (pick.startsWith("domain:")) {
      domain = pick.slice("domain:".length);
      processId = "";
    }
    const lines = (name: string): string[] =>
      (fields[name] ?? "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .slice(0, 12);
    const attributes = lines("test_attributes");
    const pbc = lines("pbc_items");
    const applicationId = fields.application_id ?? "";
    const systemBound = domain !== "" && kindForDomain(domain) !== "BUSINESS";
    if (
      !/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/.test(ref) ||
      title === null ||
      title === "" ||
      risk === null ||
      activity === "" ||
      activity.length > 4000 ||
      SECRET.test(activity) ||
      (processId === ""
        ? !DOMAINS.some(([key]) => key === domain)
        : !UUID.test(processId) || domain !== "") ||
      !FREQUENCIES.some(([key]) => key === fields.frequency) ||
      !NATURES.some(([key]) => key === fields.nature) ||
      attributes.length === 0 ||
      [...attributes, ...pbc].some(
        (line) => line.length > 300 || SECRET.test(line),
      ) ||
      (systemBound && !UUID.test(applicationId)) ||
      (!systemBound && applicationId !== "" && !UUID.test(applicationId))
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/controls/new`,
      body: {
        control_ref: ref,
        title,
        risk,
        activity,
        domain,
        frequency: fields.frequency,
        nature: fields.nature,
        key_control: fields.key_control === "on",
        test_attributes: attributes,
        pbc_items: pbc,
        application_id: systemBound ? applicationId : null,
        process_id: processId === "" ? null : processId,
      },
    };
  }
  if (intent === "process-add-control") {
    const libraryKey = fields.library_key ?? "";
    if (!/^[a-z][a-z0-9-]{0,60}$/.test(libraryKey)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/controls/add`,
      body: { library_key: libraryKey },
    };
  }
  if (intent === "add-domain" || intent === "remove-domain") {
    const domain = (fields.domain ?? "").trim();
    if (domain.length > 253 || !DOMAIN_NAME.test(domain)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "team",
      method: "POST",
      path: `/organizations/${organizationId}/email-domains${intent === "remove-domain" ? "/remove" : ""}`,
      body: { domain },
    };
  }
  if (intent === "send-welcomes") {
    return {
      intent,
      step: "team",
      method: "POST",
      path: `${base}/team/welcomes/send`,
      body: {},
    };
  }
  if (intent === "remove-member") {
    const userId = fields.user_id ?? "";
    const role = fields.engagement_role ?? "";
    if (
      !UUID.test(userId) ||
      (role !== "" && !["LEAD", "PREPARER", "REVIEWER"].includes(role))
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "team",
      method: "POST",
      path: `${base}/team/${userId}/remove`,
      // The role taken away; the API removes the person if it was their only one.
      body: role === "" ? {} : { engagement_role: role },
    };
  }
  if (intent === "load-library") {
    const domains = multi.domains ?? [...ITGC_DOMAINS];
    if (
      domains.length === 0 ||
      domains.length > 20 ||
      !domains.every((item) => DOMAINS.some(([key]) => key === item))
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/controls/load-library`,
      body: { domains: [...new Set(domains)] },
    };
  }
  if (intent === "bulk-owner") {
    const domain = fields.domain ?? "";
    const name = text("owner_name", 200);
    const email = (fields.owner_email ?? "").trim().toLowerCase();
    if (
      !DOMAINS.some(([key]) => key === domain) ||
      name === null ||
      name === "" ||
      !EMAIL.test(email)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/controls/owner`,
      body: {
        domain,
        owner_name: name,
        owner_email: email,
        only_missing: fields.only_missing !== "false",
      },
    };
  }
  if (intent === "control") {
    const id = fields.control_id ?? "";
    const version = integer("version", 1, 999);
    const name = text("owner_name", 200);
    const email = (fields.owner_email ?? "").trim().toLowerCase();
    const applications = multi.application_ids ?? [];
    if (
      !UUID.test(id) ||
      version === null ||
      name === null ||
      (email !== "" && !EMAIL.test(email)) ||
      !FREQUENCIES.some(([key]) => key === fields.frequency) ||
      !NATURES.some(([key]) => key === fields.nature) ||
      !applications.every((item) => UUID.test(item)) ||
      (fields.domain !== undefined &&
        !DOMAINS.some(([key]) => key === fields.domain)) ||
      (fields.agent_key !== undefined &&
        fields.agent_key !== "" &&
        !TESTERS.some(([key]) => key === fields.agent_key))
    ) {
      return { error: "invalid" };
    }
    const area: Record<string, string> = {};
    if (fields.domain !== undefined) {
      area.domain = fields.domain;
    }
    if (fields.agent_key !== undefined && fields.agent_key !== "") {
      area.agent_key = fields.agent_key;
    }
    return {
      intent,
      step: "controls",
      method: "PATCH",
      path: `${base}/controls/${id}`,
      body: {
        version,
        included: fields.included === "on",
        key_control: fields.key_control === "on",
        owner_name: name,
        owner_email: email,
        frequency: fields.frequency,
        nature: fields.nature,
        application_ids: applications,
        template_key: fields.template_key ?? "",
        // Said only on the form of a control with testing on record.
        acknowledge_testing: fields.acknowledge_testing === "on",
        // Why, when it leaves a running engagement with work on record.
        ...((fields.reason ?? "").trim() === "" ||
        (fields.reason ?? "").length > 500 ||
        SECRET.test(fields.reason ?? "")
          ? {}
          : { reason: (fields.reason ?? "").trim() }),
        ...area,
      },
    };
  }
  if (intent === "rcm-remap-terms") {
    const importId = fields.import_id ?? "";
    if (!UUID.test(importId)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/rcm/uploads/${importId}/terms/remap`,
      body: {},
    };
  }
  if (intent === "rcm-systems" || intent === "rcm-rescan") {
    const importId = fields.import_id ?? "";
    if (!UUID.test(importId)) {
      return { error: "invalid" };
    }
    const path = `${base}/rcm/uploads/${importId}/systems`;
    if (intent === "rcm-rescan") {
      return {
        intent,
        step: "controls",
        method: "POST",
        path: `${path}/rescan`,
        body: {},
      };
    }
    const version = integer("systems_version", 1, 999);
    const choices = systemChoices(fields);
    if (version === null || choices === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "PATCH",
      path,
      body: { systems_version: version, choices },
    };
  }
  if (
    intent === "rcm-layout" ||
    intent === "rcm-mapping" ||
    intent === "rcm-import" ||
    intent === "rcm-discard"
  ) {
    const importId = fields.import_id ?? "";
    const version = integer("version", 1, 999);
    if (
      !UUID.test(importId) ||
      (intent !== "rcm-discard" && version === null)
    ) {
      return { error: "invalid" };
    }
    const path = `${base}/rcm/uploads/${importId}`;
    if (intent === "rcm-discard") {
      return {
        intent,
        step: "controls",
        method: "POST",
        path: `${path}/discard`,
        body: {},
      };
    }
    if (intent === "rcm-import") {
      const mode = fields.mode ?? "REPLACE";
      if (mode !== "REPLACE" && mode !== "ADD") {
        return { error: "invalid" };
      }
      return {
        intent,
        step: "controls",
        method: "POST",
        path: `${path}/import`,
        body: { version, mode },
      };
    }
    if (intent === "rcm-layout") {
      const sheet = integer("sheet_index", 0, 50);
      const header = integer("header_row", 1, 100);
      if (sheet === null || header === null) {
        return { error: "invalid" };
      }
      return {
        intent,
        step: "controls",
        method: "PATCH",
        path: `${path}/layout`,
        body: { version, sheet_index: sheet, header_row: header },
      };
    }
    const mapping = columnMapping(fields);
    const values = valueMapping(fields);
    if (mapping === null || values === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "PATCH",
      path: `${path}/mapping`,
      body: { version, column_fields: mapping, values },
    };
  }
  if (intent === "owner-emails") {
    const entries: Array<{ owner_name: string; owner_email: string }> = [];
    for (let index = 0; index < 200; index += 1) {
      const name = fields[`owner_name_${index}`];
      if (name === undefined) {
        break;
      }
      const email = (fields[`owner_email_${index}`] ?? "").trim().toLowerCase();
      const trimmed = name.trim();
      if (
        trimmed === "" ||
        trimmed.length > 200 ||
        (email !== "" && !EMAIL.test(email))
      ) {
        return { error: "invalid" };
      }
      if (email !== "") {
        entries.push({ owner_name: trimmed, owner_email: email });
      }
    }
    if (entries.length === 0) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "controls",
      method: "POST",
      path: `${base}/controls/owner-emails`,
      body: { entries },
    };
  }
  if (
    intent === "workpaper-template-apply" ||
    intent === "workpaper-template-remove"
  ) {
    const templateId = fields.template_id ?? "";
    if (!UUID.test(templateId)) {
      return { error: "invalid" };
    }
    const action = intent === "workpaper-template-apply" ? "apply" : "remove";
    return {
      intent,
      step: "workpapers",
      method: "POST",
      path: `${base}/workpaper-templates/${templateId}/${action}`,
      body: {},
    };
  }
  if (intent === "workpaper-template-customize") {
    const baseKey = fields.base_key ?? "";
    if (!/^[a-z][a-z0-9-]{0,59}$/.test(baseKey)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "workpapers",
      method: "POST",
      path: `${base}/workpaper-templates/customize`,
      body: { base_key: baseKey },
    };
  }
  if (intent === "workpaper-template-save") {
    const templateId = fields.template_id ?? "";
    const version = Number(fields.version ?? "");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(fields.template ?? "");
    } catch {
      parsed = null;
    }
    const draft = parseTemplateDraft(parsed);
    if (
      !UUID.test(templateId) ||
      !Number.isInteger(version) ||
      version < 1 ||
      draft === null
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "workpapers",
      method: "PUT",
      path: `${base}/workpaper-templates/${templateId}`,
      body: { title: draft.title, tabs: draft.tabs, version },
    };
  }
  if (intent === "confirm-templates") {
    return {
      intent,
      step: "workpapers",
      method: "POST",
      path: `${base}/templates/confirm`,
      body: {},
    };
  }
  if (intent === "pbc") {
    // Setup's request plan is the cadence; the client contacts live in Evidence.
    const due = integer("pbc_due_days", 1, 90);
    const followUp = integer("pbc_follow_up_days", 1, 30);
    const max = integer("pbc_max_follow_ups", 0, 10);
    if (due === null || followUp === null || max === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "launch",
      method: "PATCH",
      path: `${base}/pbc`,
      body: {
        pbc_due_days: due,
        pbc_follow_up_days: followUp,
        pbc_max_follow_ups: max,
      },
    };
  }
  if (intent === "evidence-contacts") {
    const name = text("client_coordinator_name", 200);
    const email = (fields.client_coordinator_email ?? "").trim().toLowerCase();
    const domains = (fields.client_domains ?? "")
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item !== "");
    if (
      name === null ||
      (email !== "" && !EMAIL.test(email)) ||
      domains.length > 10
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "launch",
      method: "PATCH",
      path: `${base}/evidence-contacts`,
      body: {
        client_coordinator_name: name,
        client_coordinator_email: email,
        client_domains: domains,
      },
    };
  }
  if (intent === "propose") {
    return {
      intent,
      step: "launch",
      method: "POST",
      path: `${base}/plan`,
      body: {},
    };
  }
  if (intent === "launch") {
    const fingerprint = fields.fingerprint ?? "";
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "launch",
      method: "POST",
      path: `${base}/plan/launch`,
      body: { fingerprint },
    };
  }
  if (intent === "approve") {
    const planId = fields.plan_id ?? "";
    const fingerprint = fields.fingerprint ?? "";
    if (!UUID.test(planId) || !/^[0-9a-f]{64}$/.test(fingerprint)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "launch",
      method: "POST",
      path: `${base}/plan/${planId}/approve`,
      body: { fingerprint },
    };
  }
  return { error: "invalid" };
}

function systemChoices(fields: Record<string, string>): Array<{
  key: string;
  name: string;
  layer: string;
  included: boolean;
}> | null {
  const choices: Array<{
    key: string;
    name: string;
    layer: string;
    included: boolean;
  }> = [];
  for (let index = 0; index < 100; index += 1) {
    const key = fields[`system_key_${index}`];
    if (key === undefined) {
      break;
    }
    const name = (fields[`system_name_${index}`] ?? "").trim();
    const layer = fields[`system_layer_${index}`] ?? "";
    if (
      !/^[a-z0-9][a-z0-9-]{0,80}$/.test(key) ||
      name === "" ||
      name.length > 120 ||
      /[<>]|https?:\/\/|www\./i.test(name) ||
      SECRET.test(name) ||
      !LAYERS.some(([value]) => value === layer)
    ) {
      return null;
    }
    choices.push({
      key,
      name,
      layer,
      included: fields[`system_included_${index}`] === "on",
    });
  }
  return choices;
}

function columnMapping(fields: Record<string, string>): string[] | null {
  const mapping: string[] = [];
  for (let index = 0; index < 81; index += 1) {
    const choice = fields[`column_${index}`];
    if (choice === undefined) {
      break;
    }
    if (!COLUMN_CHOICES.some((item) => item === choice)) {
      return null;
    }
    mapping.push(choice);
  }
  const named = mapping.filter(
    (item) => item !== "custom" && item !== "ignore",
  );
  // Each field goes to one column, except the area: a category and a process column.
  const repeated = named.some(
    (item) =>
      named.filter((other) => other === item).length >
      (item === "domain" ? 2 : 1),
  );
  if (mapping.length === 0 || mapping.length > 80 || repeated) {
    return null;
  }
  return mapping;
}

function valueMapping(
  fields: Record<string, string>,
): Array<{ field: ValueField; value: string; mapped: string }> | null {
  const values: Array<{ field: ValueField; value: string; mapped: string }> =
    [];
  for (let index = 0; index < 600; index += 1) {
    const field = fields[`value_field_${index}`];
    if (field === undefined) {
      break;
    }
    const raw = fields[`value_raw_${index}`] ?? "";
    const mapped = fields[`value_mapped_${index}`] ?? "";
    const known = VALUE_FIELDS.find((item) => item === field);
    if (
      known === undefined ||
      raw.length > 120 ||
      (mapped !== "" && !VALUE_OPTIONS[known].some(([key]) => key === mapped))
    ) {
      return null;
    }
    values.push({ field: known, value: raw, mapped });
  }
  return values;
}

export type SetupState = {
  onboarding: Onboarding | null;
  step: SetupStep;
  category: string | null;
  control: string | null;
  /** The control a workpaper template is previewed with. Not the one being edited. */
  sample: string | null;
  template: string | null;
  preview: WorkpaperPreview | null;
  /** The firm template open in the editor. */
  edit?: string | null;
  rcmImport: RcmImport | null;
  notice: SetupNotice | null;
  /** The system open in the Controls step's systems panel. */
  system?: string | null;
  /** The open control's statement and client values (milestone 8.9). */
  design?: Design | null;
  /** The tab of the Controls setup an address names. */
  pane?: string | null;
  /** The Controls tab's filter to one system or process (`for=system:<id>`). */
  controlsFor?: string | null;
  /** Policies, procedures, narratives and diagrams (0112), for Systems & Processes. */
  policies?: Policy[];
  /** The prior-year references, on Systems & Processes' References tab. */
  priorYear?: PriorYearReference[];
  /** The client's controls that match a firm standard, for one grouped decision. */
  standardMatches?: StandardMatches | null;
};

export const EMPTY_SETUP: SetupState = {
  onboarding: null,
  step: "overview",
  category: null,
  control: null,
  sample: null,
  template: null,
  preview: null,
  rcmImport: null,
  notice: null,
};
/** Keys for lists of client text, which can repeat. A repeat gets its occurrence number. */
export function uniqueKeys<T>(
  items: T[],
  name: (item: T) => string,
): Array<[string, T]> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = name(item);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return [count === 1 ? base : `${base}#${count}`, item];
  });
}

/** A section to land on after a setup form posts, such as one system's recommendations. */
export function returnAnchor(value: string | undefined): string | null {
  return value !== undefined && /^[a-z]+-[0-9a-f-]{36}$/i.test(value)
    ? value
    : null;
}

/** Where one CUEC stands for its system, with the recommendation that answers it. */
export type CuecRow = {
  cuec: SystemCuec;
  state:
    | "in-scope"
    | "recommended"
    | "not-added"
    | "out-of-scope"
    | "gap"
    | "gap-recorded";
  /** The recommendation behind the state, if any. */
  recommendation: SystemRecommendation | null;
  /** Show the recommendation's reason and decision here: the first CUEC it cites. */
  decideHere: boolean;
  /** The CUEC whose row carries the decision, when this row shares it. */
  sharedWith: string | null;
};

/**
 * The CUEC table: each CUEC with its control as it stands now and any recommendation
 * that answers it. Decisions show on the CUEC they belong to, so there is no separate
 * list of decided recommendations.
 */
export function cuecRows(system: SetupSystem): CuecRow[] {
  const cuecs = system.review?.cuecs ?? [];
  const refs = new Set(cuecs.map((cuec) => cuec.ref));
  const firstRef = new Map<string, string>();
  for (const item of system.recommendations) {
    const first = item.cuecRefs.find((ref) => refs.has(ref));
    if (first !== undefined && CUEC_KINDS.has(item.kind)) {
      firstRef.set(item.id, first);
    }
  }
  return cuecs.map((cuec) => {
    const citing = system.recommendations.filter(
      (item) => CUEC_KINDS.has(item.kind) && item.cuecRefs.includes(cuec.ref),
    );
    const recommendation =
      citing.find((item) => item.status === "PROPOSED") ??
      citing.at(-1) ??
      null;
    const first =
      recommendation === null ? undefined : firstRef.get(recommendation.id);
    const decideHere = recommendation !== null && first === cuec.ref;
    const sharedWith =
      recommendation !== null &&
      recommendation.status === "PROPOSED" &&
      first !== undefined &&
      first !== cuec.ref
        ? first
        : null;
    return {
      cuec,
      state: cuecState(cuec, recommendation),
      recommendation,
      decideHere: decideHere && !cuec.inScope,
      sharedWith: cuec.inScope ? null : sharedWith,
    };
  });
}

const CUEC_KINDS = new Set<SystemRecommendation["kind"]>([
  "INCLUDE",
  "CUEC_GAP",
]);

function cuecState(
  cuec: SystemCuec,
  recommendation: SystemRecommendation | null,
): CuecRow["state"] {
  if (cuec.inScope) {
    return "in-scope";
  }
  if (recommendation?.kind === "INCLUDE") {
    if (recommendation.status === "PROPOSED") {
      return "recommended";
    }
    return recommendation.status === "DISMISSED" ? "not-added" : "out-of-scope";
  }
  if (recommendation?.kind === "CUEC_GAP") {
    return recommendation.status === "ACCEPTED" ? "gap-recorded" : "gap";
  }
  return cuec.controlRef === null ? "gap" : "out-of-scope";
}

/** Open recommendations no CUEC row carries, such as relying on the SOC report. */
export function otherRecommendations(
  system: SetupSystem,
): SystemRecommendation[] {
  const refs = new Set((system.review?.cuecs ?? []).map((cuec) => cuec.ref));
  // Only what waits for a decision: a decided one already shows in the controls. A SOC 1
  // report review is an entity-level control, so earlier ones are not shown.
  return system.recommendations.filter(
    (item) =>
      item.status === "PROPOSED" &&
      item.kind !== "ADD_SOC_REVIEW" &&
      (!CUEC_KINDS.has(item.kind) ||
        !item.cuecRefs.some((ref) => refs.has(ref))),
  );
}

/** The controls out of scope because the vendor runs them and its SOC 1 report covers
 * them, each of which a person can keep in scope. */
export function reliedOnSoc(system: SetupSystem): SystemRecommendation[] {
  return system.recommendations
    .filter((item) => item.kind === "EXCLUDE" && item.status === "ACCEPTED")
    .sort((a, b) => a.controlRef.localeCompare(b.controlRef));
}

/** The open recommended controls no CUEC row carries, for their "Add all to scope". */
export function addableOthers(items: SystemRecommendation[]): string[] {
  return items
    .filter((item) => item.kind === "INCLUDE" && item.status === "PROPOSED")
    .map((item) => item.id);
}

/** The open recommended controls on a system's CUEC rows, for "Add all to scope". */
export function addableControls(rows: CuecRow[]): string[] {
  const ids = rows.flatMap((row) =>
    row.decideHere &&
    row.recommendation !== null &&
    row.recommendation.kind === "INCLUDE" &&
    row.recommendation.status === "PROPOSED"
      ? [row.recommendation.id]
      : [],
  );
  return [...new Set(ids)];
}

/** What to tell the person when a setup form saved in the background did not save. */
// What a setup action answers when it worked: none of these is a problem to show.
const SETUP_SUCCESS: ReadonlySet<string> = new Set([
  "setup-saved",
  "setup-launched",
  "setup-drafting",
  "setup-accepted",
  "setup-rcm-uploaded",
  "setup-rcm-imported",
  "setup-template-uploaded",
  "setup-template-customized",
  "setup-template-saved",
  "invite-sent",
  "domain-saved",
  "welcomes-sent",
]);

export function setupProblem(notice: string): string | null {
  if (SETUP_SUCCESS.has(notice)) {
    return null;
  }
  if (notice === "system-needs-facts") {
    return "Confirm how the system is run first.";
  }
  if (notice === "setup-changed") {
    return "This changed since the page loaded. It now shows the latest.";
  }
  if (notice === "setup-period-order") {
    return "The planner's period end falls on or before the period start, so it was not applied. Set the dates in the engagement profile.";
  }
  if (notice === "setup-slow") {
    return "That took longer than expected and may have been saved. Refresh to see the latest.";
  }
  if (notice === "setup-denied") {
    return "Your role cannot change this engagement's setup.";
  }
  if (notice === "setup-control-exists") {
    return "A control with that ID is already in this engagement.";
  }
  if (notice === "setup-control-in-scope") {
    return "That control is already in scope for this system under another ID.";
  }
  if (notice === "setup-process-exists") {
    return "A process with that name is already in this engagement.";
  }
  if (notice === "setup-process-in-use") {
    return "That process has controls, so it stays. Take its controls out of scope instead.";
  }
  if (notice === "setup-archived") {
    return "This engagement is archived, so nothing in it can change.";
  }
  if (notice === "setup-completed") {
    return "This engagement is completed, so nothing in it can change until it is reopened.";
  }
  if (notice === "setup-system-exists") {
    return "That system is already in scope. Open it from the list instead.";
  }
  if (notice === "live-email-off") {
    return "Email sending is off, so the welcome emails still wait.";
  }
  if (notice === "setup-control-tested") {
    return "This control has testing on record. Confirm the change to go ahead.";
  }
  if (notice === "setup-invalid") {
    return "Check the choices and try again.";
  }
  return "That could not be saved. Try again.";
}

/** A system's controls in scope now, one per control, in reference order. */
export function systemControls(
  controls: readonly SetupControl[],
  systemId: string,
): SetupControl[] {
  return controls
    .filter((control) => control.applicationId === systemId && control.included)
    .sort((a, b) => a.controlRef.localeCompare(b.controlRef));
}

export type ProcessRow = {
  /** The standard cycle, or the cycle a named process is based on. */
  domain: string;
  /** The named process this row is, or null for a standard cycle. */
  processId: string | null;
  label: string;
  inScope: SetupControl[];
  outOfScope: SetupControl[];
  /** The library's starter controls for the process, not loaded yet. */
  offers: OtherControl[];
};

const byRef = (a: { controlRef: string }, b: { controlRef: string }) =>
  a.controlRef.localeCompare(b.controlRef);

/**
 * The business processes, each with its controls in and out of scope: the standard
 * cycles that have any control or offer, then every process the team named (with or
 * without controls, so it can be filled or removed).
 */
export function processRows(onboarding: Onboarding): ProcessRow[] {
  const business = CONTROL_CATEGORIES.find((item) => item.id === "business");
  const controls = families(onboarding.controls).filter(
    (control) => categoryOf(control.domain) === "business",
  );
  const cycles = (business?.domains ?? []).flatMap(([domain, label]) => {
    const mine = controls
      .filter(
        (control) => control.domain === domain && control.processId === null,
      )
      .sort(byRef);
    const offers = onboarding.processOffers
      .filter((offer) => offer.domain === domain)
      .sort(byRef);
    if (mine.length === 0 && offers.length === 0) {
      return [];
    }
    return [
      {
        domain,
        processId: null,
        label,
        inScope: mine.filter((control) => control.included),
        outOfScope: mine.filter((control) => !control.included),
        offers,
      },
    ];
  });
  const named = (onboarding.processes ?? []).map((process) => {
    const mine = controls
      .filter((control) => control.processId === process.id)
      .sort(byRef);
    return {
      domain: process.domain,
      processId: process.id,
      label: process.name,
      inScope: mine.filter((control) => control.included),
      outOfScope: mine.filter((control) => !control.included),
      offers: [],
    };
  });
  return [...cycles, ...named];
}

export type ReportInstance = { control: SetupControl; systemName: string };

export type ReportRow = {
  controlRef: string;
  title: string;
  /** One instance: opened in the editor, and copied for another system. */
  control: SetupControl;
  inScope: ReportInstance[];
  outOfScope: ReportInstance[];
  /** In-scope systems the report has no instance for yet. */
  uncovered: SetupSystem[];
};

/** The key reports, each with the systems it is tested for. */
export function reportRows(onboarding: Onboarding): ReportRow[] {
  const reports = onboarding.controls.filter(
    (control) => categoryOf(control.domain) === "reports",
  );
  const names = new Map(
    onboarding.applications.map((system) => [system.id, system.name]),
  );
  const refs = [...new Set(reports.map((control) => control.controlRef))].sort(
    (a, b) => a.localeCompare(b),
  );
  return refs.flatMap((ref) => {
    const instances = reports.filter((control) => control.controlRef === ref);
    const first = instances[0];
    if (first === undefined) {
      return [];
    }
    const placed = instances.flatMap((control) =>
      control.applicationId === null
        ? []
        : [
            {
              control,
              systemName: names.get(control.applicationId) ?? "",
            },
          ],
    );
    const covered = new Set(instances.map((control) => control.applicationId));
    return [
      {
        controlRef: ref,
        title: first.title,
        control: first,
        inScope: placed.filter((item) => item.control.included),
        outOfScope: placed.filter((item) => !item.control.included),
        uncovered: onboarding.applications.filter(
          (system) => !covered.has(system.id),
        ),
      },
    ];
  });
}

/** The library's IT controls a person can add for one system, by area: those not in scope
 * for it and not waiting as one of the agent's recommendations. Key reports are offered
 * on their own card (reportOffers). */
export const SYSTEM_OFFER_AREAS: ReadonlyArray<{
  domain: string;
  label: string;
}> = [
  { domain: "ACCESS", label: "Logical access" },
  { domain: "CHANGE", label: "Change management" },
  { domain: "OPERATIONS", label: "IT operations" },
  { domain: "ITAC", label: "Application controls" },
];

export function systemOffers(
  system: Pick<SetupSystem, "otherControls">,
): Array<{ domain: string; label: string; offers: OtherControl[] }> {
  return SYSTEM_OFFER_AREAS.map((area) => ({
    ...area,
    offers: system.otherControls
      .filter((offer) => offer.domain === area.domain)
      .sort(byRef),
  })).filter((area) => area.offers.length > 0);
}

export type OfferFilter = {
  /** Words that must all appear in the control's ID or title, in any case. */
  query: string;
  /** One area (ACCESS, CHANGE, …), or every area. */
  domain: string | null;
  /** Only the system's own controls taken out of scope, offered back. */
  removed: boolean;
};

/** A system's library offers narrowed by a search and filters, its areas kept in order
 * and an area with nothing left dropped. */
export function filterOffers(
  areas: ReadonlyArray<{
    domain: string;
    label: string;
    offers: OtherControl[];
  }>,
  filter: OfferFilter,
): Array<{ domain: string; label: string; offers: OtherControl[] }> {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return areas
    .filter((area) => filter.domain === null || area.domain === filter.domain)
    .map((area) => ({
      ...area,
      offers: area.offers.filter((offer) => {
        if (filter.removed && offer.controlId === null) {
          return false;
        }
        const text = `${offer.controlRef} ${offer.title}`.toLowerCase();
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((area) => area.offers.length > 0);
}

/** Key reports in the library not loaded for any system, once each. */
export function reportOffers(onboarding: Onboarding): OtherControl[] {
  const loaded = new Set(
    onboarding.controls.map((control) => control.controlRef.toUpperCase()),
  );
  const seen = new Map<string, OtherControl>();
  for (const system of onboarding.applications) {
    for (const offer of system.otherControls) {
      if (
        offer.domain === "IPE" &&
        !loaded.has(offer.controlRef.toUpperCase()) &&
        !seen.has(offer.libraryKey)
      ) {
        seen.set(offer.libraryKey, { ...offer, controlId: null });
      }
    }
  }
  return [...seen.values()].sort(byRef);
}

/** The controls a template preview can switch between, one per control ID, in order. */
export function previewChoices(
  controls: readonly { id: string; controlRef: string; title: string }[],
  hrefFor: (controlId: string) => string,
): { id: string; label: string; href: string }[] {
  const seen = new Set<string>();
  const choices: { id: string; label: string; href: string }[] = [];
  for (const control of controls) {
    if (seen.has(control.id)) {
      continue;
    }
    seen.add(control.id);
    choices.push({
      id: control.id,
      label: `${control.controlRef} ${control.title}`.trim(),
      href: hrefFor(control.id),
    });
  }
  return choices;
}

/** A system's SOC 1 standing, for the list of SOC 1 reports to address: every system
 * the agent found relevant or could not decide, or that has a report uploaded. */
export type SocOverview = {
  systemId: string;
  name: string;
  status: SocStatus | null;
  provider: string;
  availability: SystemAssessment["socAvailability"];
  sources: Array<{ url: string; title: string }>;
  /** Reports read, and the CUECs in them that no control in scope answers. */
  reports: number;
  unaddressed: string[];
  cuecs: number;
};

export function socOverview(onboarding: Onboarding): SocOverview[] {
  return onboarding.applications
    .filter(
      (system) =>
        system.socReports.length > 0 ||
        system.assessment?.socStatus === "RELEVANT" ||
        system.assessment?.socStatus === "UNDETERMINED",
    )
    .map((system) => {
      const read = system.socReports.filter(
        (report) => report.status === "READ",
      );
      const cuecs = read.flatMap((report) => report.cuecs);
      return {
        systemId: system.id,
        name: system.name,
        status: system.assessment?.socStatus ?? null,
        provider: system.assessment?.socProvider ?? "",
        availability: system.assessment?.socAvailability ?? "NOT_RESEARCHED",
        sources: system.assessment?.socSources ?? [],
        reports: read.length,
        unaddressed: cuecs
          .filter((cuec) => cuec.status === "UNADDRESSED")
          .map((cuec) => cuec.ref || cuec.text.slice(0, 40)),
        cuecs: cuecs.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The areas whose controls run on a system: one copy per in-scope system (milestone 8.5). */
export const SYSTEM_DOMAINS = ["ACCESS", "CHANGE", "OPERATIONS", "ITAC", "IPE"];

/** Whether a control counts on the Controls step. A system control with no system (kept
 * when its last system was removed, to come back with the next one) is not tested, so it
 * is not counted. */
export function counted(control: SetupControl): boolean {
  return (
    !SYSTEM_DOMAINS.includes(control.domain) || control.applicationId !== null
  );
}

/** The Controls step's counts for one category, per system: each system's copy of a
 * control is tested on its own, so a system removed leaves the counts. */
export function scopeCounts(
  controls: readonly SetupControl[],
  category: ControlCategory,
): {
  inScope: number;
  total: number;
  ids: number;
  key: number;
  samples: number;
} {
  const rows = controls.filter(
    (control) => categoryOf(control.domain) === category && counted(control),
  );
  const included = rows.filter((control) => control.included);
  return {
    inScope: included.length,
    total: rows.length,
    ids: new Set(rows.map((control) => control.controlRef)).size,
    key: included.filter((control) => control.keyControl).length,
    samples: included.reduce((sum, control) => sum + control.sampleSize, 0),
  };
}

export const MAX_SOC_REPORT = 25 * 1024 * 1024;

/** Where an uploaded SOC report goes, when it can be sent. */
export function socUploadTarget(
  fields: Record<string, string>,
  file: { name: string; size: number } | null,
): { path: string } | null {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const systemId = fields.system_id ?? "";
  if (
    file === null ||
    file.size === 0 ||
    file.size > MAX_SOC_REPORT ||
    ![organizationId, projectId, systemId].every((id) => UUID.test(id))
  ) {
    return null;
  }
  const params = new URLSearchParams({ file_name: file.name.slice(0, 200) });
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/onboarding/systems/${systemId}/soc-reports/upload?${params.toString()}`,
  };
}
