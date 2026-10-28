/**
 * The Controls page (decided by the product owner on 26 October 2026, from the "Controls"
 * reference): every control selected for a system or process, with where its plan and
 * testing stand, filtered, grouped, and paged in the page. Nothing here decides a state:
 * each row reads what the records already say (the journey, the plan, the test sheet).
 */

import { FREQUENCY_LABELS } from "./control-context-model.ts";
import { CONTROL_CATEGORIES } from "./onboarding-model.ts";

export type PlanStatus = "DRAFT" | "PENDING" | "APPROVED";
export type TestingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "EXCEPTIONS";
export type ControlType = "ITGC" | "ITAC" | "IPE" | "BUSINESS";
export type StepKey = "PLAN" | "REQUEST" | "TEST" | "CONCLUDE" | "REVIEW";
export type StepState = "done" | "now" | "todo";

export type PageRow = {
  id: string;
  ref: string;
  title: string;
  description: string;
  key: boolean;
  included: boolean;
  system: string;
  systemId: string | null;
  process: string;
  /** The process a filter names: a named process's id, else the cycle or area. */
  processKey: string;
  area: string;
  type: ControlType;
  frequency: string;
  source: string;
  plan: PlanStatus;
  testing: TestingStatus;
  owner: string;
  attention: boolean;
  /** The step the control is on (DONE once reviewed), for the status panel. */
  step: StepKey | "DONE";
  phaseLabels: Partial<Record<StepKey, string>>;
};

export const PLAN_LABEL: Record<PlanStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Plan to approve",
  APPROVED: "Approved",
};

/** The filter's words for a plan status (the reference's "Pending approval"). */
export const PLAN_FILTER_LABEL: Record<PlanStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Pending approval",
  APPROVED: "Approved",
};

export const TESTING_LABEL: Record<TestingStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  EXCEPTIONS: "With exceptions",
};

export const TYPE_LABEL: Record<ControlType, string> = {
  ITGC: "ITGC",
  ITAC: "ITAC",
  IPE: "IPE",
  BUSINESS: "Business",
};

/** The filter's words for a control type. */
export const TYPE_FILTER_LABEL: Record<ControlType | "KEY", string> = {
  ITGC: "IT General Control (ITGC)",
  KEY: "Key Control",
  ITAC: "Application Control",
  IPE: "Key report (IPE)",
  BUSINESS: "Business Process Control",
};

export const SOURCE_LABEL: Record<string, string> = {
  LIBRARY: "Library",
  UPLOAD: "RCM",
  AGENT: "Agent",
  MANUAL: "Client",
};

const ITGC = ["ACCESS", "CHANGE", "OPERATIONS"];

export function typeOf(domain: string): ControlType {
  if (ITGC.includes(domain)) {
    return "ITGC";
  }
  if (domain === "ITAC") {
    return "ITAC";
  }
  if (domain === "IPE") {
    return "IPE";
  }
  return "BUSINESS";
}

/** A plan waits for a person's approval, is approved, or is not drawn up yet. */
export function planOf(row: {
  evidencePlan?: string;
  progress: string;
}): PlanStatus {
  if (row.evidencePlan === "PROPOSED" || row.progress === "PLAN_TO_APPROVE") {
    return "PENDING";
  }
  return row.evidencePlan === "PLANNED" ? "APPROVED" : "DRAFT";
}

/** Testing has not started, is under way, is signed off, or found exceptions. */
export function testingOf(row: {
  exceptions: boolean;
  sheetStatus: "OPEN" | "SIGNED_OFF" | null;
  testingRunning: boolean;
  progress: string;
}): TestingStatus {
  if (row.exceptions) {
    return "EXCEPTIONS";
  }
  if (row.sheetStatus === "SIGNED_OFF" || row.progress === "CONCLUDED") {
    return "COMPLETED";
  }
  if (
    row.sheetStatus === "OPEN" ||
    row.testingRunning ||
    ["AGENT_TESTING", "RESULTS_TO_CONFIRM", "TESTING_REOPENED"].includes(
      row.progress,
    )
  ) {
    return "IN_PROGRESS";
  }
  return "NOT_STARTED";
}

export const STEPS: ReadonlyArray<{
  key: StepKey;
  label: string;
  action: string;
  link: string;
}> = [
  { key: "PLAN", label: "Plan", action: "Review plan", link: "plan" },
  {
    key: "REQUEST",
    label: "Evidence",
    action: "Request evidence",
    link: "request",
  },
  { key: "TEST", label: "Testing", action: "Start testing", link: "test" },
  {
    key: "CONCLUDE",
    label: "Conclusion",
    action: "Conclude",
    link: "conclude",
  },
  { key: "REVIEW", label: "Review", action: "Request review", link: "review" },
];

/** Each step's state: done before the step the control is on, now on it, to do after. */
export function stepStates(step: StepKey | "DONE"): Record<StepKey, StepState> {
  const at =
    step === "DONE"
      ? STEPS.length
      : STEPS.findIndex((item) => item.key === step);
  return Object.fromEntries(
    STEPS.map((item, index) => [
      item.key,
      index < at ? "done" : index === at ? "now" : "todo",
    ]),
  ) as Record<StepKey, StepState>;
}

export function initials(name: string): string {
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export type Filters = {
  query: string;
  systems: string[];
  processes: string[];
  types: Array<ControlType | "KEY">;
  scope: Array<"IN" | "OUT">;
  plan: PlanStatus[];
  testing: TestingStatus[];
  owner: string;
};

export const NO_FILTERS: Filters = {
  query: "",
  systems: [],
  processes: [],
  types: [],
  scope: ["IN"],
  plan: [],
  testing: [],
  owner: "",
};

/** Rows that pass every filter; an empty list in a filter lets every value through. */
export function filterRows(
  rows: readonly PageRow[],
  filters: Filters,
): PageRow[] {
  const words = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.scope.length === 0 ||
        filters.scope.includes(row.included ? "IN" : "OUT")) &&
      (filters.systems.length === 0 || filters.systems.includes(row.system)) &&
      (filters.processes.length === 0 ||
        filters.processes.includes(row.processKey)) &&
      (filters.types.length === 0 ||
        filters.types.some((type) =>
          type === "KEY" ? row.key : row.type === type,
        )) &&
      (filters.plan.length === 0 || filters.plan.includes(row.plan)) &&
      (filters.testing.length === 0 || filters.testing.includes(row.testing)) &&
      (filters.owner === "" || row.owner === filters.owner) &&
      (words === "" ||
        `${row.ref} ${row.title} ${row.description} ${row.system} ${row.process}`
          .toLowerCase()
          .includes(words)),
  );
}

/** How many rows each value holds, among the rows the scope filter keeps. */
export function counts(rows: readonly PageRow[], scope: Filters["scope"]) {
  const kept = rows.filter(
    (row) => scope.length === 0 || scope.includes(row.included ? "IN" : "OUT"),
  );
  const tally = <K extends string>(pick: (row: PageRow) => K[]) => {
    const found: Record<string, number> = {};
    for (const row of kept) {
      for (const key of pick(row)) {
        found[key] = (found[key] ?? 0) + 1;
      }
    }
    return found;
  };
  return {
    systems: tally((row) => (row.system === "" ? [] : [row.system])),
    processes: tally((row) => [row.processKey]),
    types: tally((row) => (row.key ? [row.type, "KEY"] : [row.type])),
    plan: tally((row) => [row.plan]),
    testing: tally((row) => [row.testing]),
    scope: {
      IN: rows.filter((row) => row.included).length,
      OUT: rows.filter((row) => !row.included).length,
    },
  };
}

/** The tiles above the filters. */
export function tiles(rows: readonly PageRow[]) {
  const inScope = rows.filter((row) => row.included);
  return {
    inScope: inScope.length,
    outOfScope: rows.length - inScope.length,
    planToApprove: inScope.filter((row) => row.plan === "PENDING").length,
    testingInProgress: inScope.filter((row) => row.testing === "IN_PROGRESS")
      .length,
    testingComplete: inScope.filter((row) => row.testing === "COMPLETED")
      .length,
    needsAttention: inScope.filter((row) => row.attention).length,
  };
}

export type ViewBy = "control" | "system" | "process";

/** The rows in groups for the table, by system or process; one group for "control". */
export function groupRows(
  rows: readonly PageRow[],
  by: ViewBy,
): Array<{ key: string; label: string; rows: PageRow[] }> {
  if (by === "control") {
    return [{ key: "all", label: "", rows: [...rows] }];
  }
  const groups = new Map<string, PageRow[]>();
  for (const row of rows) {
    const label = (by === "system" ? row.system : row.process) || "No system";
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, items]) => ({ key: label, label, rows: items }));
}

export function pageOf<T>(rows: readonly T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((at - 1) * size, at * size), page: at, pages };
}

/** The rows as a CSV file, with each cell quoted as needed. */
export function toCsv(rows: readonly PageRow[]): string {
  const cell = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const head = [
    "Control",
    "Title",
    "System",
    "Process",
    "Type",
    "Key",
    "Frequency",
    "Source",
    "Scope status",
    "Plan status",
    "Testing status",
    "Owner",
  ];
  return [
    head.join(","),
    ...rows.map((row) =>
      [
        row.ref,
        row.title,
        row.system,
        row.process,
        TYPE_LABEL[row.type],
        row.key ? "Yes" : "No",
        row.frequency,
        SOURCE_LABEL[row.source] ?? row.source,
        row.included ? "In scope" : "Out of scope",
        PLAN_LABEL[row.plan],
        TESTING_LABEL[row.testing],
        row.owner,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}

const STEP_OF: Record<string, StepKey | "DONE"> = {
  PLAN_TO_APPROVE: "PLAN",
  TO_REQUEST: "REQUEST",
  AWAITING_EVIDENCE: "REQUEST",
  EVIDENCE_RECEIVED: "TEST",
  READY_FOR_TESTING: "TEST",
  AGENT_TESTING: "TEST",
  RESULTS_TO_CONFIRM: "TEST",
  TESTING_REOPENED: "TEST",
  AWAITING_REVIEW: "REVIEW",
  REVIEW_NOTES: "REVIEW",
  CONCLUDED: "DONE",
};

const CONCLUSION_LABEL: Record<string, string> = {
  EFFECTIVE: "Effective",
  EXCEPTION: "Exception",
};

/** What the scope says of a control (onboarding's control). */
export type ScopeFacts = {
  id: string;
  controlRef: string;
  title: string;
  activity: string;
  domain: string;
  domainLabel: string;
  frequency: string;
  keyControl: boolean;
  included: boolean;
  applicationId: string | null;
  applicationName: string;
  processId: string | null;
  frequencyLabel: string;
  ownerName: string;
  source: string;
};

/** Where the work on a control stands (the engagement's control row), once launched. */
export type WorkFacts = {
  progress: string;
  evidencePlan?: string;
  sheetStatus: "OPEN" | "SIGNED_OFF" | null;
  testingRunning: boolean;
  exceptions: boolean;
  overdue: boolean;
  evidenceRequests: number;
  evidenceReceived: number;
  conclusion: string;
  reviewStatus: "OPEN" | "SIGNED_OFF" | null;
  assignees: string[];
  journey?: { step: string } | null;
};

const AREA_LABEL: Record<string, string> = Object.fromEntries(
  CONTROL_CATEGORIES.flatMap(
    (category): ReadonlyArray<readonly [string, string]> => category.domains,
  ),
);

/** A page row from the scope and, when the work has started, where it stands. The
 * area's and the frequency's names come from their codes when the scope leaves them out. */
export function toPageRow(
  scope: ScopeFacts,
  work: WorkFacts | null,
  processName: string,
): PageRow {
  const area = scope.domainLabel || AREA_LABEL[scope.domain] || scope.domain;
  const plan: PlanStatus = work === null ? "DRAFT" : planOf(work);
  const testing: TestingStatus =
    work === null ? "NOT_STARTED" : testingOf(work);
  const journey = work?.journey?.step;
  const step: StepKey | "DONE" =
    journey !== undefined &&
    (journey === "DONE" || STEPS.some((item) => item.key === journey))
      ? (journey as StepKey | "DONE")
      : work === null
        ? "PLAN"
        : (STEP_OF[work.progress] ?? "PLAN");
  const phaseLabels: Partial<Record<StepKey, string>> = {
    PLAN:
      plan === "PENDING"
        ? "Test plan awaiting approval"
        : plan === "APPROVED"
          ? "Test plan approved"
          : "No test plan yet",
    REQUEST:
      work === null || work.evidenceRequests === 0
        ? "No evidence requests yet"
        : `${work.evidenceReceived} of ${work.evidenceRequests} received`,
    TEST: TESTING_LABEL[testing],
    CONCLUDE: CONCLUSION_LABEL[work?.conclusion ?? ""] ?? "Not concluded",
    REVIEW:
      work?.reviewStatus === "SIGNED_OFF"
        ? "Reviewed"
        : work?.reviewStatus === "OPEN"
          ? "In review"
          : "Not started",
  };
  return {
    id: scope.id,
    ref: scope.controlRef,
    title: scope.title,
    description: scope.activity,
    key: scope.keyControl,
    included: scope.included,
    system: scope.applicationName,
    systemId: scope.applicationId,
    process: processName || area,
    processKey: scope.processId ?? scope.domain,
    area,
    type: typeOf(scope.domain),
    frequency: scope.frequencyLabel || FREQUENCY_LABELS[scope.frequency] || "",
    source: scope.source,
    plan,
    testing,
    owner: scope.ownerName || work?.assignees[0] || "",
    attention: work !== null && (work.exceptions || work.overdue),
    step,
    phaseLabels,
  };
}
