import type { EvidenceAnalysis, EvidenceReview } from "./analysis-model.ts";
import type { ActivityItem } from "./control-workspace-model.ts";
import type { ChangeNotice } from "./evidence-change-model.ts";
import type { RegisterApplication, RegisterFile } from "./evidence-model.ts";
import type { RequestDetails } from "./request-details-model.ts";
import type { TestRound } from "./round-model.ts";
import type { SheetNotice, TestSheet } from "./sheet-model.ts";
import type { Workpaper, WorkpaperNotice } from "./workpaper-model.ts";

export type ControlFiles = {
  files: RegisterFile[];
  /** The applications the open control covers. */
  applications: RegisterApplication[];
  analyses: EvidenceAnalysis[];
  reviews: EvidenceReview[];
};

import type { ControlContext } from "./control-context-model.ts";
import { type ControlJourney, parseJourney } from "./control-journey-model.ts";
import type { EvidencePlan } from "./evidence-plan-model.ts";
import type { Automation } from "./execution-model.ts";
import type { NextSteps } from "./home-model.ts";
import type { ImpactAssessment } from "./impact-model.ts";
import type { Queue as WorkQueue } from "./queue-model.ts";
import type { ControlReview, ReviewNotice } from "./review-model.ts";
import type { Signoff } from "./signoff-model.ts";
import type { TestBasis } from "./test-basis-model.ts";
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

/**
 * The phases the project plan opens: the work under way (in progress, at risk, or with
 * overdue tasks), or, when nothing is under way, the next phase to start. The rest stay
 * closed so the plan opens on what matters now; each one still opens on request.
 */
export function openPhases(phases: Phase[]): Set<string> {
  const active = phases.filter(
    (phase) =>
      phase.status === "IN_PROGRESS" ||
      phase.status === "AT_RISK" ||
      phase.overdue > 0,
  );
  if (active.length > 0) {
    return new Set(active.map((phase) => phase.key));
  }
  const next = phases.find((phase) => phase.status === "NOT_STARTED");
  return new Set(next === undefined ? [] : [next.key]);
}

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
  /** The testing phase it serves: DESIGN, INTERIM, ROLLFORWARD, RETEST, REMEDIATION. */
  phase: string | null;
  version: number;
  recipient?: string;
  /** Drafted at kickoff, before the control's evidence was planned. */
  kickoff?: boolean;
  /** The latest approval asked to send it, and its decision. */
  approvalId?: string | null;
  /** FAILED: approved, but the send was refused, so nothing went out. */
  approvalDecision?:
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "FAILED"
    | "RESEND"
    | null;
  approvalReason?: string | null;
  approvalDecidedBy?: string | null;
  /** PERSON: written by a person and sent directly; AGENT: approved by a person first. */
  draftedBy?: "AGENT" | "PERSON";
  /** The person reading may decide its open approval (the API enforces the same). */
  viewerCanDecide?: boolean;
};

export type WaitingOn = "TEAM" | "OWNER" | "AGENT" | "NONE";

/** A control's one stage in the work (workspace.progress_of), in order. The stages add
 * up to the controls in scope. */
export const PROGRESS = [
  "PLAN_TO_APPROVE",
  "TO_REQUEST",
  "AWAITING_EVIDENCE",
  "EVIDENCE_RECEIVED",
  "READY_FOR_TESTING",
  "AGENT_TESTING",
  "RESULTS_TO_CONFIRM",
  "TESTING_REOPENED",
  "AWAITING_REVIEW",
  "REVIEW_NOTES",
  "CONCLUDED",
] as const;
export type Progress = (typeof PROGRESS)[number];

export const PROGRESS_LABELS: Record<Progress, string> = {
  PLAN_TO_APPROVE: "Test plan to approve",
  TO_REQUEST: "Not yet requested",
  AWAITING_EVIDENCE: "Awaiting evidence",
  EVIDENCE_RECEIVED: "Evidence received",
  READY_FOR_TESTING: "Ready for testing",
  AGENT_TESTING: "Agent testing",
  RESULTS_TO_CONFIRM: "Results to confirm",
  TESTING_REOPENED: "Testing reopened",
  AWAITING_REVIEW: "Awaiting review",
  REVIEW_NOTES: "Review notes",
  CONCLUDED: "Concluded",
};

/** Who a control's next step belongs to (workspace.step_of). */
export type Actor =
  | "PREPARER"
  | "APPROVER"
  | "REVIEWER"
  | "CLIENT"
  | "AGENT"
  | "NONE";

/** A testing phase's evidence requests: how many, and how many are in. */
export type PhaseEvidence = {
  phase: string;
  requests: number;
  received: number;
  drafted: number;
  out: number;
  late: number;
};

export const REVIEW_LEFT = [
  "REPERFORMING",
  "REPERFORM",
  "DECIDE",
  "ADDRESS",
  "CLEAR",
  "SIGN",
  "SIGNED",
] as const;
export type ReviewLeft = (typeof REVIEW_LEFT)[number];

export const SHEET_LEFT = [
  "EVIDENCE",
  "TESTING",
  "DECIDE",
  "SIGN_OFF",
  "PLACE",
  "DEFICIENCY",
] as const;
export type SheetLeft = (typeof SHEET_LEFT)[number];

export type StepState = "done" | "active" | "todo" | "issue";

const LIFECYCLE_STEPS: ReadonlyArray<
  [keyof ControlRow["stages"] | "conclusion", string]
> = [
  ["walkthrough", "Design"],
  ["evidence", "Evidence"],
  ["test", "Interim"],
  ["review", "Review"],
  ["conclusion", "Conclusion"],
];

/** Where a control is in its lifecycle, one state per step. */
export function lifecycle(
  control: ControlRow,
): Array<{ key: string; label: string; state: StepState }> {
  return LIFECYCLE_STEPS.map(([key, label]) => ({
    key,
    label,
    state: stepState(control, key),
  }));
}

function stepState(control: ControlRow, step: string): StepState {
  if (step === "conclusion") {
    return control.conclusion === "EFFECTIVE"
      ? "done"
      : control.conclusion === "EXCEPTION"
        ? "issue"
        : "todo";
  }
  if (step === "review" && control.reviewLeft !== null) {
    return control.reviewLeft === "SIGNED" ? "done" : "active";
  }
  const value = control.stages[step as keyof ControlRow["stages"]];
  if (value === "SUCCEEDED" || value === "RECEIVED") {
    return "done";
  }
  if (value === "FAILED" || value === "OVERDUE" || value === "BLOCKED") {
    return "issue";
  }
  if (
    [
      "RUNNING",
      "QUEUED",
      "WAITING",
      "REVIEW",
      "REQUESTED",
      "PARTIAL",
      "DRAFTED",
    ].includes(value)
  ) {
    return "active";
  }
  return "todo";
}

/** The record's main button: the tab where the next step is done. */
export function recordAction(
  control: ControlRow,
): { label: string; tab: DetailTab } | null {
  if (!control.included || control.conclusion !== "NOT_CONCLUDED") {
    return null;
  }
  if (control.reviewLeft !== null && control.reviewLeft !== "SIGNED") {
    return { label: "Open the review", tab: "review" };
  }
  if (control.testStatus === "PROPOSED") {
    return { label: "Review samples", tab: "testing" };
  }
  if (control.sheetStatus === "SIGNED_OFF" && control.sheetLeft === null) {
    return { label: "Prepare the workpaper", tab: "testing" };
  }
  if (control.sheetLeft !== null && control.sheetLeft !== "EVIDENCE") {
    return { label: "Open the test sheet", tab: "testing" };
  }
  if (
    control.testStatus === null &&
    control.waitingOn === "TEAM" &&
    control.nextStep === "Confirm the population"
  ) {
    return { label: "Confirm the population", tab: "testing" };
  }
  if (control.nextStep.startsWith("Settle the attributes")) {
    // Operating evidence follows the attributes (the planning gate).
    return { label: "Settle the attributes", tab: "design" };
  }
  return { label: "Open evidence requests", tab: "evidence" };
}

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
  /** The one application this instance tests (Milestone 8.5), and "ID · application". */
  applicationId: string | null;
  applicationName: string;
  label: string;
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
  /** The test sheet (8.2): OPEN or SIGNED_OFF, and what it needs next. */
  sheetStatus: "OPEN" | "SIGNED_OFF" | null;
  /** Whether the control can be tested, and the first thing in the way (readiness). */
  readinessState: string;
  readinessLabel: string;
  readinessBlocker: string;
  /** The conclusion is final: every required phase and round tested and reviewed
   * (control_journey.finality). Only then does the control count as complete. */
  final?: boolean;
  notFinalBecause?: string[];
  /** Why a signed-off sheet was opened again, while it is open; "" otherwise. */
  reopenReason?: string;
  /** Where the control is in Plan → Request → Test → Conclude → Review, each phase's
   * state and readiness, and what is outstanding (control_journey.py). */
  journey?: ControlJourney | null;
  sheetLeft: SheetLeft | null;
  /** The independent review (9.1): OPEN or SIGNED_OFF, and what it waits for. */
  reviewStatus: "OPEN" | "SIGNED_OFF" | null;
  reviewLeft: ReviewLeft | null;
  /** Per application the control covers: its evidence files and its test result. */
  byApplication: Record<
    string,
    { files: number; result: "PASS" | "EXCEPTION" | "OPEN" | null }
  >;
  nextStep: string;
  waitingOn: WaitingOn;
  overdue: boolean;
  requests: ControlRequest[];
  /** The tester agent is testing (queued or working) now. */
  testingRunning: boolean;
  /** The interim population is not yet accepted, so samples cannot be approved. */
  populationPending: boolean;
  /** Its stage in the work, who the next step belongs to, and whether that is the person
   * viewing (the API applies their role, the reviewer rules, and any assignment). */
  progress: Progress;
  actor: Actor;
  yours: boolean;
  /** Who the control's open work is assigned to, by name; [] when no one. */
  assignees: string[];
  /** The next step is submitting a drafted request, done together, not per control. */
  drafted: boolean;
  /** An exception in its testing or an open deficiency. */
  exceptions: boolean;
  evidencePhases: PhaseEvidence[];
  /** Its application's layer and hosting (the system record), for the neutral icon. */
  applicationLayer: string | null;
  applicationHosting: string | null;
  /** What its agents are doing, from their run records (workspace.agent_runs). */
  agents: AgentRuns;
  /** PROPOSED: planned, waiting for a person's approval; nothing is requested before
   * then. NONE: a running engagement's control launched before evidence planning existed. */
  evidencePlan?: "PLANNED" | "PROPOSED" | "NONE";
  /** Its attributes are settled: operating evidence is requested only then. */
  attributesSettled?: boolean;
  /** A kickoff draft holds plan items until a person settles it. */
  reconcile?: boolean;
};

export type RunState = "IDLE" | "QUEUED" | "RUNNING";

export type AgentRuns = {
  reading: number;
  readFailed: number;
  testing: RunState;
  drafting: RunState;
  reviewing: RunState;
  stopped: Array<"drafting" | "reviewing">;
};

const runState = (value: unknown): RunState =>
  value === "QUEUED" || value === "RUNNING" ? value : "IDLE";

export type Deficiency = {
  id: string;
  reference: string;
  controlId: string | null;
  controlRef: string | null;
  /** The control instance, "ID · application", when the control is per application. */
  controlLabel: string | null;
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
  /** The date the fix took effect; a retest samples only from then on. */
  remediatedOn: string | null;
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
  /** The independent review across the engagement (9.2). */
  review: {
    inScope: number;
    notStarted: number;
    reperforming: number;
    toDecide: number;
    toAddress: number;
    toClear: number;
    toSign: number;
    signedOff: number;
    openNotes: number;
    complete: boolean;
  };
  /** Where the period disagrees with the engagement's name or scope, unconfirmed. */
  periodConflicts: string[];
  /** In-scope controls with no evidence plan (launched before evidence planning). */
  unplannedControls: number;
  /** Planned controls whose design or interim evidence was never requested. */
  unrequestedControls: number;
  /** Drafted requests with no one to send them to: no owner email, no coordinator. */
  unaddressedRequests: number;
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
  /** The evidence request opened on the control (?request=), with its details. */
  focusRequest?: RequestDetails | null;
  /** The open control's activity, from the audit trail (controls/{id}/activity). */
  activity: ActivityItem[] | null;
  tests: ControlTest[] | null;
  testNotice: TestNotice | null;
  sheets: TestSheet[] | null;
  /** Roll-forward and remediation retests, for every control. */
  rounds: TestRound[] | null;
  sheetNotice: SheetNotice | null;
  /** An open control's evidence files, with what the agents read and reviewed. */
  files: ControlFiles | null;
  /** A file on the open control withdrawn or replaced, or why it could not be. */
  changeNotice: ChangeNotice | null;
  /** The open control's workpapers, and the version a person chose to look at. */
  workpapers: Workpaper[] | null;
  workpaperNotice: WorkpaperNotice | null;
  workpaperViewing: { id: string; version: number } | null;
  /** The independent reviews (9.1), for every control. */
  reviews: ControlReview[] | null;
  reviewNotice: ReviewNotice | null;
  /** The open control's context: attributes, documents, process understanding, readiness. */
  context: ControlContext | null;
  /** The open control's evidence plan: each phase, its evidence, and where it stands. */
  evidencePlan: EvidencePlan | null;
  /** The open control's test basis and candidate standards (milestone L2). */
  testBasis?: TestBasis | null;
  plan: Plan | null;
  controls: ControlRow[] | null;
  deficiencies: Deficiency[] | null;
  dashboard: Dashboard | null;
  /** The open control's sign-offs on record (receipts), oldest first. */
  signoffs?: Signoff[] | null;
  /** The engagement's plan-revision impact assessments (plan_impact.py), read when a
   * control is open. */
  impact?: ImpactAssessment[] | null;
  /** Whether an agent worker will pick up queued runs (M1d); null when unknown. */
  automation?: Automation | null;
  /** The engagement's one queue of work (M2a); null when not loaded. */
  work?: WorkQueue | null;
  /** The engagement's journey and what waits on the team (next_steps.py), for Home. */
  nextSteps?: NextSteps | null;
  notice: EngagementNotice | null;
  filters: {
    category: string | null;
    /** Lifecycle stages to show; empty for all. The other lists work the same way. */
    stage: string[];
    query: string;
    control: string | null;
    deficiency: string | null;
    queue: Queue | null;
    tab: string | null;
    /** The guided workspace's step (?step=), when a link names one. */
    step: string | null;
    /** The queue's filter on Home (?filter=bucket:MINE,stage:REVIEW,phase:RETEST). */
    workFilter?: string | null;
    /** The Evidence tab's view (?ev=) and the request opened in it (?request=). */
    evidenceView?: string | null;
    request?: string | null;
    group: Grouping;
    /** The register's order: control ID, stage in the work, what needs attention, owner,
     * application, or the next evidence due date. */
    sort: "control" | "stage" | "attention" | "owner" | "application" | "due";
    /** The register as application groups (the everyday view) or one table. */
    layout: "applications" | "table";
    /** Application names; "" for controls that run on no system. */
    application: string[];
    area: string[];
    /** Owner names or emails; "" for controls that go to the PBC coordinator. */
    owner: string[];
    keyOnly: boolean;
  };
};

export const EMPTY_ENGAGEMENT: EngagementState = {
  activity: null,
  tests: null,
  testNotice: null,
  sheets: null,
  rounds: null,
  sheetNotice: null,
  files: null,
  changeNotice: null,
  workpapers: null,
  workpaperNotice: null,
  workpaperViewing: null,
  reviews: null,
  reviewNotice: null,
  context: null,
  evidencePlan: null,
  plan: null,
  controls: null,
  deficiencies: null,
  dashboard: null,
  signoffs: null,
  impact: null,
  notice: null,
  filters: {
    category: null,
    stage: [],
    query: "",
    control: null,
    deficiency: null,
    queue: null,
    tab: null,
    step: null,
    group: "application",
    sort: "control",
    layout: "applications",
    application: [],
    area: [],
    owner: [],
    keyOnly: false,
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
      applicationId: maybe(item.application_id),
      applicationName: str(item.application_name),
      label: str(item.label) || str(item.control_ref),
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
      sheetStatus:
        item.sheet_status === "OPEN" || item.sheet_status === "SIGNED_OFF"
          ? item.sheet_status
          : null,
      sheetLeft: SHEET_LEFT.find((left) => left === item.sheet_left) ?? null,
      readinessState: str(item.readiness_state) || "READY",
      readinessLabel: str(item.readiness_label),
      final: item.final === true,
      notFinalBecause: (Array.isArray(item.not_final) ? item.not_final : [])
        .map((reason) => (isRecord(reason) ? str(reason.text) : ""))
        .filter((text) => text !== ""),
      reopenReason: str(item.reopen_reason),
      journey: parseJourney(item.journey),
      readinessBlocker: str(item.readiness_blocker),
      reviewStatus:
        item.review_status === "OPEN" || item.review_status === "SIGNED_OFF"
          ? item.review_status
          : null,
      reviewLeft: REVIEW_LEFT.find((left) => left === item.review_left) ?? null,
      byApplication: Object.fromEntries(
        Object.entries(
          typeof item.by_application === "object" &&
            item.by_application !== null &&
            !Array.isArray(item.by_application)
            ? (item.by_application as Record<string, unknown>)
            : {},
        ).map(([name, value]) => {
          const entry =
            typeof value === "object" && value !== null
              ? (value as Record<string, unknown>)
              : {};
          const result =
            entry.result === "PASS" ||
            entry.result === "EXCEPTION" ||
            entry.result === "OPEN"
              ? entry.result
              : null;
          return [
            name,
            {
              files: typeof entry.files === "number" ? entry.files : 0,
              result,
            },
          ];
        }),
      ),
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
        phase: typeof request.phase === "string" ? request.phase : null,
        version: typeof request.version === "number" ? request.version : 1,
        recipient: str(request.recipient),
        kickoff: request.kickoff === true,
        approvalId:
          typeof request.approval_id === "string" ? request.approval_id : null,
        approvalDecision:
          (
            [
              "PENDING",
              "APPROVED",
              "REJECTED",
              "EXPIRED",
              "FAILED",
              "RESEND",
            ] as const
          ).find((decision) => decision === request.approval_decision) ?? null,
        draftedBy: request.drafted_by === "PERSON" ? "PERSON" : "AGENT",
        approvalReason:
          typeof request.approval_reason === "string"
            ? request.approval_reason
            : null,
        approvalDecidedBy:
          typeof request.approval_decided_by === "string"
            ? request.approval_decided_by
            : null,
        viewerCanDecide: request.viewer_can_decide === true,
      })),
      testingRunning: item.testing_running === true,
      populationPending: item.population_pending === true,
      progress: oneOf(item.progress, PROGRESS, "TO_REQUEST"),
      actor: oneOf(
        item.actor,
        [
          "PREPARER",
          "APPROVER",
          "REVIEWER",
          "CLIENT",
          "AGENT",
          "NONE",
        ] as const,
        "NONE",
      ),
      yours: item.yours === true,
      assignees: strings(item.assignees),
      drafted: item.drafted === true,
      exceptions: item.exceptions === true,
      evidencePhases: records(item.evidence_phases).map((phase) => ({
        phase: str(phase.phase),
        requests: typeof phase.requests === "number" ? phase.requests : 0,
        received: typeof phase.received === "number" ? phase.received : 0,
        drafted: typeof phase.drafted === "number" ? phase.drafted : 0,
        out: typeof phase.out === "number" ? phase.out : 0,
        late: typeof phase.late === "number" ? phase.late : 0,
      })),
      applicationLayer:
        typeof item.application_layer === "string"
          ? item.application_layer
          : null,
      applicationHosting:
        typeof item.application_hosting === "string"
          ? item.application_hosting
          : null,
      agents: parseAgentRuns(item.agents),
      evidencePlan:
        item.evidence_plan === "NONE" || item.evidence_plan === "PROPOSED"
          ? item.evidence_plan
          : "PLANNED",
      attributesSettled: item.attributes_settled !== false,
      reconcile: item.reconcile === true,
    };
  });
}

function parseAgentRuns(value: unknown): AgentRuns {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    reading: typeof raw.reading === "number" ? raw.reading : 0,
    readFailed: typeof raw.read_failed === "number" ? raw.read_failed : 0,
    testing: runState(raw.testing),
    drafting: runState(raw.drafting),
    reviewing: runState(raw.reviewing),
    stopped: Array.isArray(raw.stopped)
      ? raw.stopped.filter(
          (item): item is "drafting" | "reviewing" =>
            item === "drafting" || item === "reviewing",
        )
      : [],
  };
}

/** Where a control stands overall, in one of four states that add up to the controls in
 * scope: completed (its review signed off), blocked (something stops it that a person
 * must clear), not started (no evidence asked for yet), or in progress. Read from the
 * API's stage, readiness, due dates, and agent runs; nothing is estimated. */
export type OverallState =
  | "completed"
  | "blocked"
  | "in_progress"
  | "not_started";

const BLOCKING_READINESS = new Set([
  "NEEDS_INFORMATION",
  "PLAN_NOT_APPROVED",
  "PROCESS_UNDERSTANDING_INCOMPLETE",
  "CONFLICT_REQUIRES_REVIEW",
]);

/** An agent's work on the control stopped and a person starts it again: the tester gave
 * up with items untested, a draft or a re-performance did not finish, or a file could not
 * be read. */
export function agentStopped(control: ControlRow): boolean {
  return (
    control.agents.stopped.length > 0 ||
    control.agents.readFailed > 0 ||
    (control.sheetStatus === "OPEN" &&
      control.sheetLeft === "TESTING" &&
      !control.testingRunning)
  );
}

/** An agent is working on the control now, or its work is queued. */
export function agentActive(control: ControlRow): boolean {
  const { agents } = control;
  return (
    agents.reading > 0 ||
    agents.testing !== "IDLE" ||
    agents.drafting !== "IDLE" ||
    agents.reviewing !== "IDLE" ||
    control.testingRunning
  );
}

/** What stops the control, in words; empty when nothing does. */
export function blockersOf(control: ControlRow): string[] {
  if (control.progress === "CONCLUDED") {
    return [];
  }
  const found: string[] = [];
  if (BLOCKING_READINESS.has(control.readinessState)) {
    found.push(control.readinessLabel || "Not ready for testing");
  }
  if (agentStopped(control)) {
    found.push("Agent work stopped");
  }
  if (control.overdue) {
    found.push("Evidence overdue");
  }
  return found;
}

export function overallState(control: ControlRow): OverallState {
  if (control.progress === "CONCLUDED") {
    return "completed";
  }
  if (blockersOf(control).length > 0) {
    return "blocked";
  }
  return control.progress === "TO_REQUEST" ||
    control.progress === "PLAN_TO_APPROVE"
    ? "not_started"
    : "in_progress";
}

export const QUEUES = [
  "team",
  "progress",
  "blocked",
  "notstarted",
  "evidence",
  "agents",
  "stopped",
  "owner",
  "overdue",
  "review",
  "findings",
  "concluded",
] as const;
export type Queue = (typeof QUEUES)[number];

export function inQueue(control: ControlRow, queue: Queue | null): boolean {
  switch (queue) {
    case null:
      return true;
    case "team":
      // Only what the person viewing can do now, as the API works it out.
      return control.yours;
    case "progress":
      return overallState(control) === "in_progress";
    case "blocked":
      return overallState(control) === "blocked";
    case "notstarted":
      return overallState(control) === "not_started";
    case "evidence":
      return control.progress === "AWAITING_EVIDENCE";
    case "agents":
      return agentActive(control);
    case "stopped":
      return agentStopped(control);
    case "owner":
      return control.waitingOn === "OWNER";
    case "overdue":
      return control.overdue;
    case "review":
      // Under independent review: the reviewer's turn, or notes to answer.
      return (
        control.progress === "AWAITING_REVIEW" ||
        control.progress === "REVIEW_NOTES"
      );
    case "findings":
      return control.exceptions;
    case "concluded":
      return control.conclusion !== "NOT_CONCLUDED";
  }
}

/** The record's tabs: an overview, then the control and its design, its evidence, its
 * testing (interim and roll-forward), its findings, its review and conclusion, and its
 * activity (control-workspace-model.ts). */
export const DETAIL_TABS = [
  "overview",
  "design",
  "evidence",
  "testing",
  "findings",
  "review",
  "activity",
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/** Where a link from before the phases lands. */
const LEGACY_TABS: Record<string, DetailTab> = {
  interim: "testing",
  rollforward: "testing",
  workpapers: "testing",
  work: "overview",
};

/** The phase a control is in, from its stage: where the next step is done. */
/**
 * Whether the drafting agent has anything to write from: an evidence file of the control
 * that has been read, or its interim testing signed off. Until then the API fills the
 * records only and the Draft button waits.
 */
export function hasDraftInput(
  control: Pick<ControlRow, "sheetStatus">,
  files: ControlFiles | null,
): boolean {
  if (control.sheetStatus === "SIGNED_OFF" || files === null) {
    return control.sheetStatus === "SIGNED_OFF";
  }
  // The analyses are the engagement's; the files are the control's.
  const mine = new Set(files.files.map((file) => file.id));
  return files.analyses.some(
    (analysis) => analysis.status === "READY" && mine.has(analysis.fileId),
  );
}

export function phaseOf(control: ControlRow): DetailTab {
  if (control.reviewLeft !== null || control.stage === "CONCLUDED") {
    return "review";
  }
  if (
    control.testStatus !== null ||
    control.sheetStatus !== null ||
    control.evidenceRequests > 0 ||
    control.stage === "EVIDENCE_REQUESTED" ||
    control.stage === "EVIDENCE_RECEIVED" ||
    control.stage === "TESTING"
  ) {
    return "testing";
  }
  if (control.stage === "WALKTHROUGH") {
    return "design";
  }
  return "overview";
}

/** The tab to open: the asked-for one (old names included), else the control's phase. */
export function detailTab(
  control: ControlRow,
  asked: string | null,
): DetailTab {
  const found = DETAIL_TABS.find((tab) => tab === asked);
  if (found !== undefined) {
    return found;
  }
  if (asked !== null && LEGACY_TABS[asked] !== undefined) {
    return LEGACY_TABS[asked];
  }
  // Opening a control lands on its overview; the assistant and the next step point to
  // the phase that needs work (phaseOf).
  void control;
  return "overview";
}

export const GROUPINGS = ["area", "application"] as const;
export type Grouping = (typeof GROUPINGS)[number];

export type ControlGroup = {
  area: string;
  controls: ControlRow[];
  /** Under "By application": the control areas inside the application. */
  areas: Array<{ area: string; controls: ControlRow[] }>;
};

/** Controls grouped by the application each instance tests, with the areas inside.
 * A control over several applications is one instance under each. */
/** The group for controls that belong to a process, not a system. */
export const NO_APPLICATION = "Process and entity-level controls";

export function byApplication(controls: readonly ControlRow[]): ControlGroup[] {
  const groups = new Map<string, ControlRow[]>();
  const none: ControlRow[] = [];
  for (const control of controls) {
    if (control.applicationName === "") {
      none.push(control);
      continue;
    }
    groups.set(control.applicationName, [
      ...(groups.get(control.applicationName) ?? []),
      control,
    ]);
  }
  const named = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, items]) => ({ area, controls: items, areas: byArea(items) }));
  return none.length > 0
    ? [...named, { area: NO_APPLICATION, controls: none, areas: byArea(none) }]
    : named;
}

/** Controls grouped by process area, in register order. */
export function byArea(controls: readonly ControlRow[]): ControlGroup[] {
  const groups = new Map<string, ControlRow[]>();
  for (const control of controls) {
    const area = control.area || "Other";
    groups.set(area, [...(groups.get(area) ?? []), control]);
  }
  return [...groups.entries()].map(([area, items]) => ({
    area,
    controls: items,
    areas: [],
  }));
}

/** How a control instance is named everywhere: its ID, then its application. */
export function instanceLabel(
  controlRef: string | null,
  application: string,
): string | null {
  if (controlRef === null) {
    return null;
  }
  return application === "" ? controlRef : `${controlRef} · ${application}`;
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
      controlLabel: instanceLabel(
        maybe(item.control_ref),
        str(item.application_name),
      ),
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
      remediatedOn: maybe(item.remediated_on),
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
  const review = isRecord(value.review) ? value.review : {};
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
    review: {
      inScope: num(review.in_scope),
      notStarted: num(review.not_started),
      reperforming: num(review.reperforming),
      toDecide: num(review.to_decide),
      toAddress: num(review.to_address),
      toClear: num(review.to_clear),
      toSign: num(review.to_sign),
      signedOff: num(review.signed_off),
      openNotes: num(review.open_notes),
      complete: review.complete === true,
    },
    periodConflicts: strings(value.period_conflicts),
    unplannedControls: num(value.unplanned_controls),
    unrequestedControls: num(value.unrequested_controls),
    unaddressedRequests: num(value.unaddressed_requests),
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
      const fixed = (fields.remediated_on ?? "").trim();
      if (
        (status === "READY_FOR_RETEST" && !/^\d{4}-\d{2}-\d{2}$/.test(fixed)) ||
        (status !== "READY_FOR_RETEST" && fixed !== "")
      ) {
        return { error: "invalid" };
      }
      return {
        intent,
        section: "deficiencies",
        method: "POST",
        path: `${path}/progress`,
        body:
          status === "READY_FOR_RETEST"
            ? { version: v, status, remediated_on: fixed }
            : status !== ""
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
      listed(filters.stage, control.progress) &&
      listed(filters.application, control.applicationName) &&
      listed(filters.area, control.area) &&
      listed(filters.owner, ownerKey(control)) &&
      (!filters.keyOnly || control.keyControl) &&
      inQueue(control, filters.queue) &&
      (query === "" ||
        [
          control.controlRef,
          control.title,
          control.area,
          control.ownerName,
          control.ownerEmail,
          control.applicationName,
          ...control.systems,
        ].some((value) => value.toLowerCase().includes(query))),
  );
}

/** A multi-value filter: nothing chosen means everything. */
function listed(chosen: readonly string[], value: string): boolean {
  return chosen.length === 0 || chosen.includes(value);
}

/** The value a control's owner filters by: the name, else the email, else "". */
export function ownerKey(
  control: Pick<ControlRow, "ownerName" | "ownerEmail">,
): string {
  return control.ownerName || control.ownerEmail;
}

/** The register's filter choices, from the controls in scope: every application
 * (with "" for controls on no system), area, and owner, each in order. */
export function filterOptions(controls: readonly ControlRow[]): {
  applications: string[];
  areas: string[];
  owners: string[];
} {
  const sorted = (values: Iterable<string>) =>
    [...new Set(values)].sort((a, b) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
    );
  return {
    applications: sorted(controls.map((control) => control.applicationName)),
    areas: [...new Set(controls.map((control) => control.area))],
    owners: sorted(controls.map(ownerKey)),
  };
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
