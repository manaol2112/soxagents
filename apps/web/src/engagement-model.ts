import type { ControlTest, TestNotice } from "./testing-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*\S{8,}|password\s*[:=]\s*(?=\S*[0-9])(?=\S*[A-Za-z])\S{6,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/i;

export const PHASE_LABELS: Record<string, string> = {
  PLANNING: "Planning and scoping",
  WALKTHROUGHS: "Walkthroughs and design",
  EVIDENCE: "Evidence collection",
  INTERIM_TESTING: "Interim testing",
  REMEDIATION: "Remediation retesting",
  ROLLFORWARD: "Roll-forward and year-end testing",
  REPORTING: "Deficiency evaluation and reporting",
};

export const STAGES: ReadonlyArray<[string, string]> = [
  ["NOT_PLANNED", "Not planned"],
  ["PLANNED", "Planned"],
  ["EVIDENCE_REQUESTED", "Evidence requested"],
  ["WALKTHROUGH", "Walkthrough"],
  ["EVIDENCE_RECEIVED", "Evidence received"],
  ["TESTING", "Testing"],
  ["IN_REVIEW", "In review"],
  ["CONCLUDED", "Concluded"],
];

export const SEVERITIES: ReadonlyArray<[string, string]> = [
  ["CONTROL_DEFICIENCY", "Control deficiency"],
  ["SIGNIFICANT_DEFICIENCY", "Significant deficiency"],
  ["MATERIAL_WEAKNESS", "Material weakness"],
];

export const DEFICIENCY_STATUSES: ReadonlyArray<[string, string]> = [
  ["OPEN", "Open"],
  ["REMEDIATION_IN_PROGRESS", "Remediation in progress"],
  ["READY_FOR_RETEST", "Ready for retest"],
  ["REMEDIATED", "Remediated"],
  ["CLOSED", "Closed"],
];

export const LIKELIHOODS: ReadonlyArray<[string, string]> = [
  ["REMOTE", "Remote"],
  ["REASONABLY_POSSIBLE", "Reasonably possible"],
  ["PROBABLE", "Probable"],
];

export const MAGNITUDES: ReadonlyArray<[string, string]> = [
  ["INCONSEQUENTIAL", "Inconsequential"],
  ["MORE_THAN_INCONSEQUENTIAL", "More than inconsequential"],
  ["MATERIAL", "Material"],
];

export const CATEGORIES: ReadonlyArray<[string, string]> = [
  ["it", "IT controls"],
  ["business", "Business process controls"],
  ["reports", "Key reports"],
];

export type Phase = {
  key: string;
  name: string;
  plannedStart: string;
  plannedEnd: string;
  version: number;
  tasks: number;
  done: number;
  overdue: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "DONE" | "AT_RISK";
};

export type Milestone = {
  key: string;
  name: string;
  phaseKey: string;
  dueDate: string;
  completedAt: string | null;
  version: number;
  status: "DONE" | "UPCOMING" | "DUE_SOON" | "MISSED";
};

export type PlanTask = {
  id: string;
  title: string;
  status: string;
  phaseKey: string | null;
  kind: string | null;
  controlId: string | null;
  controlRef: string | null;
  agent: string | null;
  assignee: string | null;
  deadline: string | null;
  waitingOn: number;
};

export type Plan = {
  started: boolean;
  kickoff: string | null;
  periodEnd: string | null;
  scheduleMissing: boolean;
  phases: Phase[];
  milestones: Milestone[];
  tasks: PlanTask[];
};

export type ControlRequest = {
  id: string;
  kind: "EVIDENCE" | "SAMPLES" | "FOLLOW_UP";
  title: string;
  status: string;
  dueAt: string;
};

export type WaitingOn = "TEAM" | "OWNER" | "AGENT" | "NONE";

export type ControlRow = {
  id: string;
  controlRef: string;
  title: string;
  activity: string;
  category: string;
  domain: string;
  area: string;
  frequency: string;
  frequencyLabel: string;
  nature: string;
  natureLabel: string;
  keyControl: boolean;
  included: boolean;
  ownerName: string;
  ownerEmail: string;
  systems: string[];
  sampleSize: number;
  stage: string;
  stages: {
    walkthrough: string;
    evidence: string;
    test: string;
    review: string;
  };
  evidenceRequests: number;
  evidenceReceived: number;
  deficiencies: number;
  worstSeverity: string | null;
  conclusion: "NOT_CONCLUDED" | "EFFECTIVE" | "EXCEPTION";
  risk: string;
  testAttributes: string[];
  pbcItems: string[];
  testStatus: string | null;
  nextStep: string;
  waitingOn: WaitingOn;
  overdue: boolean;
  requests: ControlRequest[];
};

export type Deficiency = {
  id: string;
  reference: string;
  controlId: string | null;
  controlRef: string | null;
  title: string;
  condition: string;
  criteria: string;
  cause: string;
  effect: string;
  type: string;
  likelihood: string;
  magnitude: string;
  severity: string;
  suggestedSeverity: string;
  compensating: string;
  status: string;
  remediationOwner: string;
  remediationPlan: string;
  remediationDue: string | null;
  retestResult: string;
  retestedAt: string | null;
  source: string;
  pending: {
    kind: "SEVERITY" | "CLOSE";
    severity: string | null;
    reason: string;
    requestedAt: string;
  } | null;
  identifiedBy: string;
  identifiedAt: string;
  closedAt: string | null;
  version: number;
  canDecide: boolean;
};

export type Dashboard = {
  started: boolean;
  controls: {
    inScope: number;
    key: number;
    concluded: number;
    effective: number;
    exceptions: number;
    samples: number;
    byCategory: Record<string, Record<string, number>>;
    byStage: Record<string, number>;
  };
  evidence: {
    total: number;
    draft: number;
    outstanding: number;
    received: number;
    overdue: number;
  };
  deficiencies: {
    open: number;
    bySeverity: Record<string, number>;
    awaitingApproval: number;
    remediationOverdue: number;
  };
  schedule: {
    phases: Phase[];
    nextMilestones: Milestone[];
    atRisk: number;
    missedMilestones: number;
    scheduleMissing: boolean;
    periodEnd: string | null;
  };
  work: {
    total: number;
    done: number;
    waiting: number;
    byAgent: Record<string, number>;
  };
};

export type EngagementNotice =
  | "saved"
  | "invalid"
  | "changed"
  | "denied"
  | "unavailable"
  | "logged"
  | "requested"
  | "decided";

const NOTICES: readonly EngagementNotice[] = [
  "saved",
  "invalid",
  "changed",
  "denied",
  "unavailable",
  "logged",
  "requested",
  "decided",
];

export type EngagementState = {
  tests: ControlTest[] | null;
  testNotice: TestNotice | null;
  plan: Plan | null;
  controls: ControlRow[] | null;
  deficiencies: Deficiency[] | null;
  dashboard: Dashboard | null;
  notice: EngagementNotice | null;
  filters: {
    category: string | null;
    stage: string | null;
    query: string;
    control: string | null;
    deficiency: string | null;
    queue: Queue | null;
    tab: string | null;
    group: Grouping;
  };
};

export const EMPTY_ENGAGEMENT: EngagementState = {
  tests: null,
  testNotice: null,
  plan: null,
  controls: null,
  deficiencies: null,
  dashboard: null,
  notice: null,
  filters: {
    category: null,
    stage: null,
    query: "",
    control: null,
    deficiency: null,
    queue: null,
    tab: null,
    group: "area",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function maybe(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function counts(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      result[key] = num(item);
    }
  }
  return result;
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.find((option) => option === value) ?? fallback;
}

function parsePhase(item: Record<string, unknown>): Phase {
  return {
    key: str(item.key),
    name: str(item.name) || (PHASE_LABELS[str(item.key)] ?? str(item.key)),
    plannedStart: str(item.planned_start),
    plannedEnd: str(item.planned_end),
    version: num(item.version) || 1,
    tasks: num(item.tasks),
    done: num(item.done),
    overdue: num(item.overdue),
    status: oneOf(
      item.status,
      ["NOT_STARTED", "IN_PROGRESS", "DONE", "AT_RISK"] as const,
      "NOT_STARTED",
    ),
  };
}

function parseMilestone(item: Record<string, unknown>): Milestone {
  return {
    key: str(item.key),
    name: str(item.name),
    phaseKey: str(item.phase_key),
    dueDate: str(item.due_date),
    completedAt: maybe(item.completed_at),
    version: num(item.version) || 1,
    status: oneOf(
      item.status,
      ["DONE", "UPCOMING", "DUE_SOON", "MISSED"] as const,
      "UPCOMING",
    ),
  };
}

export function parsePlan(value: unknown): Plan | null {
  if (!isRecord(value) || !Array.isArray(value.phases)) {
    return null;
  }
  return {
    started: value.started === true,
    kickoff: maybe(value.kickoff),
    periodEnd: maybe(value.period_end),
    scheduleMissing: value.schedule_missing === true,
    phases: records(value.phases).map(parsePhase),
    milestones: records(value.milestones).map(parseMilestone),
    tasks: records(value.tasks).map((item) => ({
      id: str(item.id),
      title: str(item.title),
      status: str(item.status),
      phaseKey: maybe(item.phase_key),
      kind: maybe(item.plan_kind),
      controlId: maybe(item.control_id),
      controlRef: maybe(item.control_ref),
      agent: maybe(item.agent),
      assignee: maybe(item.assignee),
      deadline: maybe(item.deadline),
      waitingOn: num(item.waiting_on),
    })),
  };
}

export function parseControls(value: unknown): ControlRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return records(value).map((item) => {
    const stages = isRecord(item.stages) ? item.stages : {};
    return {
      id: str(item.id),
      controlRef: str(item.control_ref),
      title: str(item.title),
      activity: str(item.activity),
      category: str(item.category),
      domain: str(item.domain),
      area: str(item.area),
      frequency: str(item.frequency),
      frequencyLabel: str(item.frequency_label),
      nature: str(item.nature),
      natureLabel: str(item.nature_label),
      keyControl: item.key_control === true,
      included: item.included === true,
      ownerName: str(item.owner_name),
      ownerEmail: str(item.owner_email),
      systems: strings(item.systems),
      sampleSize: num(item.sample_size),
      stage: str(item.stage),
      stages: {
        walkthrough: str(stages.walkthrough) || "NONE",
        evidence: str(stages.evidence) || "NONE",
        test: str(stages.test) || "NONE",
        review: str(stages.review) || "NONE",
      },
      evidenceRequests: num(item.evidence_requests),
      evidenceReceived: num(item.evidence_received),
      deficiencies: num(item.deficiencies),
      worstSeverity: maybe(item.worst_severity),
      conclusion: oneOf(
        item.conclusion,
        ["NOT_CONCLUDED", "EFFECTIVE", "EXCEPTION"] as const,
        "NOT_CONCLUDED",
      ),
      risk: str(item.risk),
      testAttributes: strings(item.test_attributes),
      pbcItems: strings(item.pbc_items),
      testStatus: maybe(item.test_status),
      nextStep: str(item.next_step),
      waitingOn: oneOf(
        item.waiting_on,
        ["TEAM", "OWNER", "AGENT", "NONE"] as const,
        "NONE",
      ),
      overdue: item.overdue === true,
      requests: records(item.requests).map((request) => ({
        id: str(request.id),
        kind: oneOf(
          request.kind,
          ["EVIDENCE", "SAMPLES", "FOLLOW_UP"] as const,
          "EVIDENCE",
        ),
        title: str(request.title),
        status: str(request.status),
        dueAt: str(request.due_at),
      })),
    };
  });
}

export const QUEUES = [
  "team",
  "owner",
  "overdue",
  "findings",
  "concluded",
] as const;
export type Queue = (typeof QUEUES)[number];

export function inQueue(control: ControlRow, queue: Queue | null): boolean {
  switch (queue) {
    case null:
      return true;
    case "team":
      return control.waitingOn === "TEAM";
    case "owner":
      return control.waitingOn === "OWNER";
    case "overdue":
      return control.overdue;
    case "findings":
      return control.deficiencies > 0;
    case "concluded":
      return control.conclusion !== "NOT_CONCLUDED";
  }
}

export const DETAIL_TABS = [
  "overview",
  "evidence",
  "testing",
  "findings",
  "work",
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/** The tab to open: the asked-for one, or Testing when samples wait for approval. */
export function detailTab(
  control: ControlRow,
  asked: string | null,
): DetailTab {
  const found = DETAIL_TABS.find((tab) => tab === asked);
  if (found !== undefined) {
    return found;
  }
  return control.testStatus === "PROPOSED" ? "testing" : "overview";
}

export const GROUPINGS = ["area", "application"] as const;
export type Grouping = (typeof GROUPINGS)[number];

/** Controls grouped by in-scope application. A control on several appears under each. */
export function byApplication(
  controls: readonly ControlRow[],
): Array<{ area: string; controls: ControlRow[] }> {
  const groups = new Map<string, ControlRow[]>();
  const none: ControlRow[] = [];
  for (const control of controls) {
    if (control.systems.length === 0) {
      none.push(control);
    }
    for (const system of control.systems) {
      groups.set(system, [...(groups.get(system) ?? []), control]);
    }
  }
  const named = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, items]) => ({ area, controls: items }));
  return none.length > 0
    ? [...named, { area: "No application", controls: none }]
    : named;
}

/** Controls grouped by process area, in register order. */
export function byArea(
  controls: readonly ControlRow[],
): Array<{ area: string; controls: ControlRow[] }> {
  const groups = new Map<string, ControlRow[]>();
  for (const control of controls) {
    const area = control.area || "Other";
    groups.set(area, [...(groups.get(area) ?? []), control]);
  }
  return [...groups.entries()].map(([area, items]) => ({
    area,
    controls: items,
  }));
}

export function parseDeficiencies(value: unknown): Deficiency[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return records(value).map((item) => {
    const pending = isRecord(item.pending_change) ? item.pending_change : null;
    return {
      id: str(item.id),
      reference: str(item.reference),
      controlId: maybe(item.control_id),
      controlRef: maybe(item.control_ref),
      title: str(item.title),
      condition: str(item.condition),
      criteria: str(item.criteria),
      cause: str(item.cause),
      effect: str(item.effect),
      type: str(item.deficiency_type),
      likelihood: str(item.likelihood),
      magnitude: str(item.magnitude),
      severity: str(item.severity),
      suggestedSeverity: str(item.suggested_severity),
      compensating: str(item.compensating_controls),
      status: str(item.status),
      remediationOwner: str(item.remediation_owner),
      remediationPlan: str(item.remediation_plan),
      remediationDue: maybe(item.remediation_due),
      retestResult: str(item.retest_result),
      retestedAt: maybe(item.retested_at),
      source: str(item.source),
      pending:
        pending === null
          ? null
          : {
              kind: pending.kind === "CLOSE" ? "CLOSE" : "SEVERITY",
              severity: maybe(pending.severity),
              reason: str(pending.reason),
              requestedAt: str(pending.requested_at),
            },
      identifiedBy: str(item.identified_by),
      identifiedAt: str(item.identified_at),
      closedAt: maybe(item.closed_at),
      version: num(item.version) || 1,
      canDecide: item.can_decide === true,
    };
  });
}

export function parseDashboard(value: unknown): Dashboard | null {
  if (!isRecord(value) || !isRecord(value.controls)) {
    return null;
  }
  const controls = value.controls;
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const deficiencies = isRecord(value.deficiencies) ? value.deficiencies : {};
  const schedule = isRecord(value.schedule) ? value.schedule : {};
  const work = isRecord(value.work) ? value.work : {};
  const byCategory: Record<string, Record<string, number>> = {};
  if (isRecord(controls.by_category)) {
    for (const [key, item] of Object.entries(controls.by_category)) {
      byCategory[key] = counts(item);
    }
  }
  return {
    started: value.started === true,
    controls: {
      inScope: num(controls.in_scope),
      key: num(controls.key),
      concluded: num(controls.concluded),
      effective: num(controls.effective),
      exceptions: num(controls.exceptions),
      samples: num(controls.samples),
      byCategory,
      byStage: counts(controls.by_stage),
    },
    evidence: {
      total: num(evidence.total),
      draft: num(evidence.draft),
      outstanding: num(evidence.outstanding),
      received: num(evidence.received),
      overdue: num(evidence.overdue),
    },
    deficiencies: {
      open: num(deficiencies.open),
      bySeverity: counts(deficiencies.by_severity),
      awaitingApproval: num(deficiencies.awaiting_approval),
      remediationOverdue: num(deficiencies.remediation_overdue),
    },
    schedule: {
      phases: records(schedule.phases).map(parsePhase),
      nextMilestones: records(schedule.next_milestones).map(parseMilestone),
      atRisk: num(schedule.at_risk),
      missedMilestones: num(schedule.missed_milestones),
      scheduleMissing: schedule.schedule_missing === true,
      periodEnd: maybe(schedule.period_end),
    },
    work: {
      total: num(work.total),
      done: num(work.done),
      waiting: num(work.waiting),
      byAgent: counts(work.by_agent),
    },
  };
}

export function parseEngagementNotice(
  value: string | null,
): EngagementNotice | null {
  return NOTICES.find((notice) => notice === value) ?? null;
}

export function engagementNoticeFor(
  intent: string,
  status: number,
): EngagementNotice {
  if (status === 200) {
    if (intent === "deficiency-create") {
      return "logged";
    }
    if (intent === "deficiency-change") {
      return "requested";
    }
    if (intent === "deficiency-decide") {
      return "decided";
    }
    return "saved";
  }
  if (status === 409) {
    return "changed";
  }
  if (status === 401 || status === 403) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

export type EngagementWrite =
  | { error: "invalid" }
  | {
      intent: string;
      section: "plan" | "timeline" | "deficiencies" | "controls";
      method: "POST" | "PATCH";
      path: string;
      body: Record<string, unknown>;
    };

/** Turn one form into one API call. Every value is checked before it is sent. */
export function engagementWrite(
  fields: Record<string, string>,
): EngagementWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const intent = fields.intent ?? "";
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}`;
  const back = fields.section === "timeline" ? "timeline" : "plan";
  const version = (): number | null => {
    const raw = fields.version ?? "";
    return /^\d{1,6}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : null;
  };
  const text = (name: string, max: number): string | null => {
    const value = (fields[name] ?? "").trim();
    return value.length > max || CREDENTIAL.test(value) ? null : value;
  };
  if (intent === "create-schedule") {
    return {
      intent,
      section: back,
      method: "POST",
      path: `${base}/workspace/schedule`,
      body: {},
    };
  }
  if (intent === "phase") {
    const key = fields.phase_key ?? "";
    const start = fields.planned_start ?? "";
    const end = fields.planned_end ?? "";
    const v = version();
    if (
      PHASE_LABELS[key] === undefined ||
      !DATE.test(start) ||
      !DATE.test(end) ||
      start > end ||
      v === null
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      section: back,
      method: "PATCH",
      path: `${base}/workspace/phases/${key}`,
      body: { version: v, planned_start: start, planned_end: end },
    };
  }
  if (intent === "milestone") {
    const key = fields.milestone_key ?? "";
    const due = fields.due_date ?? "";
    const v = version();
    if (!/^[A-Z_]{1,40}$/.test(key) || !DATE.test(due) || v === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      section: back,
      method: "PATCH",
      path: `${base}/workspace/milestones/${key}`,
      body: { version: v, due_date: due, completed: fields.completed === "on" },
    };
  }
  if (intent === "deficiency-create" || intent === "deficiency-update") {
    const control = fields.control_id ?? "";
    const due = fields.remediation_due ?? "";
    const values = {
      title: text("title", 200),
      condition: text("condition", 4000),
      criteria: text("criteria", 4000),
      cause: text("cause", 4000),
      effect: text("effect", 4000),
      compensating_controls: text("compensating_controls", 4000),
      remediation_owner: text("remediation_owner", 200),
      remediation_plan: text("remediation_plan", 4000),
    };
    if (
      Object.values(values).some((value) => value === null) ||
      values.title === "" ||
      (control !== "" && !UUID.test(control)) ||
      (due !== "" && !DATE.test(due)) ||
      !["DESIGN", "OPERATING"].includes(fields.deficiency_type ?? "") ||
      !LIKELIHOODS.some(([key]) => key === fields.likelihood) ||
      !MAGNITUDES.some(([key]) => key === fields.magnitude)
    ) {
      return { error: "invalid" };
    }
    const body: Record<string, unknown> = {
      ...values,
      deficiency_type: fields.deficiency_type,
      likelihood: fields.likelihood,
      magnitude: fields.magnitude,
      remediation_due: due === "" ? null : due,
    };
    if (intent === "deficiency-create") {
      if (!SEVERITIES.some(([key]) => key === fields.severity)) {
        return { error: "invalid" };
      }
      return {
        intent,
        section: "deficiencies",
        method: "POST",
        path: `${base}/deficiencies`,
        body: {
          ...body,
          severity: fields.severity,
          control_id: control === "" ? null : control,
        },
      };
    }
    const id = fields.deficiency_id ?? "";
    const v = version();
    if (!UUID.test(id) || v === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      section: "deficiencies",
      method: "PATCH",
      path: `${base}/deficiencies/${id}`,
      body: { ...body, version: v },
    };
  }
  if (
    intent === "deficiency-progress" ||
    intent === "deficiency-change" ||
    intent === "deficiency-decide"
  ) {
    const id = fields.deficiency_id ?? "";
    const v = version();
    if (!UUID.test(id) || v === null) {
      return { error: "invalid" };
    }
    const path = `${base}/deficiencies/${id}`;
    if (intent === "deficiency-progress") {
      const status = fields.status ?? "";
      const retest = fields.retest_result ?? "";
      if (
        !["", "OPEN", "REMEDIATION_IN_PROGRESS", "READY_FOR_RETEST"].includes(
          status,
        ) ||
        !["", "PASSED", "FAILED"].includes(retest) ||
        (status === "") === (retest === "")
      ) {
        return { error: "invalid" };
      }
      return {
        intent,
        section: "deficiencies",
        method: "POST",
        path: `${path}/progress`,
        body:
          status !== ""
            ? { version: v, status }
            : { version: v, retest_result: retest },
      };
    }
    const reason = text("reason", 1000);
    if (reason === null) {
      return { error: "invalid" };
    }
    if (intent === "deficiency-change") {
      const kind = fields.kind ?? "";
      const severity = fields.severity ?? "";
      if (
        !["SEVERITY", "CLOSE"].includes(kind) ||
        reason === "" ||
        (kind === "SEVERITY" && !SEVERITIES.some(([key]) => key === severity))
      ) {
        return { error: "invalid" };
      }
      return {
        intent,
        section: "deficiencies",
        method: "POST",
        path: `${path}/changes`,
        body: {
          version: v,
          kind,
          reason,
          ...(kind === "SEVERITY" ? { severity } : {}),
        },
      };
    }
    if (!["approve", "reject"].includes(fields.decision ?? "")) {
      return { error: "invalid" };
    }
    return {
      intent,
      section: "deficiencies",
      method: "POST",
      path: `${path}/changes/decide`,
      body: { version: v, approve: fields.decision === "approve", reason },
    };
  }
  return { error: "invalid" };
}

/** Filter the controls register the way the toolbar asks. */
export function filterControls(
  controls: ControlRow[],
  filters: EngagementState["filters"],
): ControlRow[] {
  const query = filters.query.trim().toLowerCase();
  return controls.filter(
    (control) =>
      (filters.category === null || control.category === filters.category) &&
      (filters.stage === null || control.stage === filters.stage) &&
      inQueue(control, filters.queue) &&
      (query === "" ||
        [
          control.controlRef,
          control.title,
          control.area,
          control.ownerName,
          ...control.systems,
        ].some((value) => value.toLowerCase().includes(query))),
  );
}

/** Where a date falls on the timeline, from 0 to 100. */
export function timelinePercent(
  value: string,
  start: string,
  end: string,
): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  const at = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((at - from) / (to - from)) * 100));
}

/** The months a timeline spans, for its scale. */
export function timelineMonths(
  start: string,
  end: string,
): Array<{ label: string; year: string | null; at: number }> {
  const months: Array<{ label: string; year: string | null; at: number }> = [];
  const first = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(first.getTime())) {
    return months;
  }
  const cursor = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1),
  );
  const last = Date.parse(`${end}T00:00:00Z`);
  while (cursor.getTime() < last && months.length < 48) {
    const iso = cursor.toISOString().slice(0, 10);
    months.push({
      label: cursor.toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      year: cursor.getUTCMonth() === 0 ? String(cursor.getUTCFullYear()) : null,
      at: timelinePercent(iso, start, end),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
