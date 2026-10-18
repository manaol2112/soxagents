/**
 * A control's evidence plan, as the control record shows it: for each testing phase
 * (design, interim, roll-forward) whether it applies and why, its objectives and
 * procedures, and the evidence it needs, each item with its category, its reason, and
 * where it stands.
 *
 * The states come from the API (evidence_plans.py); this module only reads them, groups
 * them, and checks a person's actions before they are sent. Received is never accepted,
 * and an empty list of requests never reads as done.
 */

export const PHASES = ["DESIGN", "INTERIM", "ROLLFORWARD"] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  DESIGN: "Design effectiveness",
  INTERIM: "Interim operating effectiveness",
  ROLLFORWARD: "Roll-forward operating effectiveness",
};

export const PHASE_SHORT: Record<Phase, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
};

export const CATEGORIES = [
  ["CONFIGURATION", "Configuration"],
  ["POPULATION", "Population"],
  ["SAMPLE", "Sample"],
  ["PROCESS_DOCUMENTATION", "Process documentation"],
  ["CONTROL_EXECUTION", "Control execution"],
  ["REPORT_RELIABILITY", "Report and data reliability"],
  ["CHANGE_HISTORY", "Change history"],
  ["OTHER", "Other supporting evidence"],
] as const;
export type Category = (typeof CATEGORIES)[number][0];
const CATEGORY_KEYS = CATEGORIES.map(([key]) => key);
export const CATEGORY_LABELS = Object.fromEntries(CATEGORIES) as Record<
  Category,
  string
>;

export type Applicability =
  | "APPLICABLE"
  | "CONDITIONAL"
  | "NOT_APPLICABLE"
  | "PENDING";

export const APPLICABILITY_LABELS: Record<Applicability, string> = {
  APPLICABLE: "Applicable",
  CONDITIONAL: "Conditionally applicable",
  NOT_APPLICABLE: "Not applicable",
  PENDING: "Pending determination",
};

export const PHASE_STATES = [
  "NOT_PLANNED",
  "NOT_APPLICABLE",
  "AWAITING_CLARIFICATION",
  "CONDITIONAL",
  "NOT_GENERATED",
  "NOT_SENT",
  "OUTSTANDING",
  "RECEIVED_NOT_VALIDATED",
  "AWAITING_DEPENDENCY",
  "EVIDENCE_ACCEPTED",
  "COMPLETE",
] as const;
export type PhaseState = (typeof PHASE_STATES)[number];

/** What each phase state means, in one line, so no state reads as another. */
export const PHASE_STATE_EXPLAINED: Record<PhaseState, string> = {
  NOT_PLANNED:
    "The evidence for this phase has not been planned yet. Plan it to see what it needs.",
  NOT_APPLICABLE:
    "No evidence is requested because this phase does not apply, for the reason below.",
  AWAITING_CLARIFICATION: "Requests wait until the question below is answered.",
  CONDITIONAL:
    "The evidence is planned. Its requests go out when the condition below is met.",
  NOT_GENERATED:
    "The phase applies, but some of its evidence has not been requested yet.",
  NOT_SENT:
    "Its requests are drafted or wait for approval. Nothing has gone to the owner yet.",
  OUTSTANDING: "Requested evidence has not all arrived, or needs a follow-up.",
  RECEIVED_NOT_VALIDATED:
    "Evidence arrived and waits for a person to judge whether it is sufficient.",
  AWAITING_DEPENDENCY:
    "What is in hand is accepted; the rest waits on an earlier step, such as selecting the sample.",
  EVIDENCE_ACCEPTED:
    "The evidence is accepted as sufficient. The phase is complete once its testing is.",
  COMPLETE: "The phase's testing is signed off.",
};

/** A phase state in a word or two, for the step notes on the control record. */
export const PHASE_STATE_SHORT: Record<PhaseState, string> = {
  NOT_PLANNED: "Not planned",
  NOT_APPLICABLE: "Not applicable",
  AWAITING_CLARIFICATION: "Question open",
  CONDITIONAL: "Conditional",
  NOT_GENERATED: "Not requested",
  NOT_SENT: "Drafted, not sent",
  OUTSTANDING: "Outstanding",
  RECEIVED_NOT_VALIDATED: "To validate",
  AWAITING_DEPENDENCY: "Waiting",
  EVIDENCE_ACCEPTED: "Accepted",
  COMPLETE: "Complete",
};

export const PHASE_STATE_TONES: Record<PhaseState, string> = {
  NOT_PLANNED: "",
  NOT_APPLICABLE: "",
  AWAITING_CLARIFICATION: "tone-warning",
  CONDITIONAL: "",
  NOT_GENERATED: "tone-warning",
  NOT_SENT: "",
  OUTSTANDING: "tone-info",
  RECEIVED_NOT_VALIDATED: "tone-warning",
  AWAITING_DEPENDENCY: "tone-info",
  EVIDENCE_ACCEPTED: "tone-info",
  COMPLETE: "tone-success",
};

export const REQUIREMENT_STATES = [
  "NOT_GENERATED",
  "AWAITING_DEPENDENCY",
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVAL_PENDING",
  "SENT",
  "OVERDUE",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "INSUFFICIENT",
  "FOLLOW_UP_REQUIRED",
  "CANCELLED",
  "NOT_APPLICABLE",
  "REMOVED",
] as const;
export type RequirementState = (typeof REQUIREMENT_STATES)[number];

export const REQUIREMENT_STATE_LABELS: Record<RequirementState, string> = {
  NOT_GENERATED: "Not requested yet",
  AWAITING_DEPENDENCY: "Waits for an earlier item",
  DRAFT: "Being drafted",
  READY_FOR_REVIEW: "Ready for review",
  APPROVAL_PENDING: "Awaiting approval to send",
  SENT: "Awaiting evidence",
  OVERDUE: "Overdue",
  PARTIALLY_RECEIVED: "Partly received",
  RECEIVED: "Received, not reviewed",
  UNDER_REVIEW: "Under review",
  ACCEPTED: "Accepted",
  INSUFFICIENT: "Insufficient",
  FOLLOW_UP_REQUIRED: "Follow-up required",
  CANCELLED: "Request cancelled",
  NOT_APPLICABLE: "Not applicable",
  REMOVED: "Removed",
};

/** The plan is proposed, or has proposed changes, and waits for a person's approval. */
export function planAwaitsApproval(
  plan: { status: string } | null | undefined,
): boolean {
  return (
    plan !== null &&
    plan !== undefined &&
    (plan.status === "PROPOSED" ||
      plan.status === "CHANGES_PROPOSED" ||
      plan.status === "CHANGES_REQUESTED")
  );
}

// States before anything goes to the owner: while the plan waits for approval, these
// read as part of the proposal, never as a request's progress.
const BEFORE_SENDING: ReadonlySet<string> = new Set([
  "NOT_GENERATED",
  "AWAITING_DEPENDENCY",
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVAL_PENDING",
]);

/** The status a requirement shows: "Proposed" while its plan waits for approval. */
export function requirementStatus(
  state: RequirementState,
  awaiting: boolean,
): { label: string; tone: string; title: string } {
  if (awaiting && BEFORE_SENDING.has(state)) {
    return {
      label: "Proposed",
      tone: "",
      title:
        "In the proposed plan. Nothing is requested until the plan is approved.",
    };
  }
  return {
    label: REQUIREMENT_STATE_LABELS[state],
    tone: REQUIREMENT_STATE_TONES[state],
    title: "",
  };
}

export const REQUIREMENT_STATE_TONES: Record<RequirementState, string> = {
  NOT_GENERATED: "tone-warning",
  AWAITING_DEPENDENCY: "",
  DRAFT: "",
  READY_FOR_REVIEW: "",
  APPROVAL_PENDING: "tone-info",
  SENT: "tone-info",
  OVERDUE: "tone-danger",
  PARTIALLY_RECEIVED: "tone-warning",
  RECEIVED: "tone-warning",
  UNDER_REVIEW: "tone-info",
  ACCEPTED: "tone-success",
  INSUFFICIENT: "tone-danger",
  FOLLOW_UP_REQUIRED: "tone-danger",
  CANCELLED: "",
  NOT_APPLICABLE: "",
  REMOVED: "",
};

/** The states in which what arrived can be judged: something was received. */
export const JUDGEABLE: readonly RequirementState[] = [
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "INSUFFICIENT",
  "FOLLOW_UP_REQUIRED",
];

export type Necessity = "REQUIRED" | "CONDITIONAL" | "OPTIONAL";
export const NECESSITY_LABELS: Record<Necessity, string> = {
  REQUIRED: "Required",
  CONDITIONAL: "If it applies",
  OPTIONAL: "Optional",
};

export const POPULATION_LABELS: Record<string, string> = {
  CONTROL_EXECUTIONS: "Population of control executions",
  TRANSACTIONS: "Population of transactions the control acts on",
  ITEMS_REVIEWED: "Items reviewed within each selected execution",
};

/** A file serving a requirement: through the request that carries it, or linked to it by
 * a person (with why). What the reader found applies only to a file on the request. */
export type RequirementFile = {
  fileId: string;
  name: string;
  via: "REQUEST" | "LINK";
  linkId: string | null;
  linkedBy: string | null;
  reason: string;
  linkVersion: number | null;
  readStatus: string | null;
  /** Who read it: the model, or the keyword rules (which match kinds, not detail). */
  readBy: "MODEL" | "RULES" | null;
  kind: string | null;
  kindConfirmed: boolean;
  coverage: "COVERED" | "PARTIAL" | "NOT_COVERED" | null;
  note: string;
  period: string;
  gaps: string[];
};

/** The evidence reader's proposal for a requirement. A proposal only: a person accepts. */
export type Assessment = {
  proposal: "SUFFICIENT" | "FOLLOW_UP" | "INSUFFICIENT" | "NONE";
  reason: string;
  followUps: string[];
};

export const PROPOSAL_LABELS: Record<Assessment["proposal"], string> = {
  SUFFICIENT: "Looks sufficient",
  FOLLOW_UP: "Needs a follow-up",
  INSUFFICIENT: "Looks insufficient",
  NONE: "No view yet",
};

export type PlanRequirement = {
  id: string;
  phase: Phase;
  key: string;
  title: string;
  description: string;
  categories: Category[];
  objective: string;
  attributes: string[];
  rationale: string;
  necessity: Necessity;
  periodLabel: string;
  populationKind: string | null;
  sampleSelection: string;
  dependsOnTitle: string | null;
  status: string;
  state: RequirementState;
  stateLabel: string;
  requestId: string | null;
  requestReference: string | null;
  requestRecipient: string | null;
  sufficiencyNote: string;
  sufficiencyBy: string | null;
  waiveReason: string;
  origin: string;
  pendingChange: { remove: boolean; title: string; description: string } | null;
  needsReview: boolean;
  coverageNote: string;
  version: number;
  files: RequirementFile[];
  assessment: Assessment;
};

export type PlanPhase = {
  phase: Phase;
  label: string;
  applicability: Applicability | null;
  rationale: string;
  condition: string;
  openQuestion: string;
  objectives: string[];
  procedures: string[];
  periodStart: string | null;
  periodEnd: string | null;
  origin: string | null;
  decidedBy: string | null;
  state: PhaseState;
  stateLabel: string;
  testingComplete: boolean;
  requirements: PlanRequirement[];
  requests: Array<{ id: string; reference: string; status: string }>;
  version: number;
};

export type EvidencePlan = {
  controlId: string;
  status:
    | "NOT_PLANNED"
    | "PROPOSED"
    | "APPROVED"
    | "CHANGES_PROPOSED"
    | "CHANGES_REQUESTED";
  /** The master test plan's content revision, and the one a person last approved. */
  revision: number;
  approvedRevision: number | null;
  /** The planner proposed a revised understanding and procedures for the reviewer. */
  pendingRevision: boolean;
  source: string | null;
  provisional: boolean;
  note: string;
  summary: string;
  controlType: string;
  missingInformation: string[];
  assumptions: string[];
  exceptions: string[];
  approvalsRequired: string[];
  processNeeded: boolean;
  processReason: string;
  generatedAt: string | null;
  approvedBy: string | null;
  /** It took effect on its own: nothing in it needed a person's judgment. */
  approvedAutomatically: boolean;
  /** What needs a person's judgment before it takes effect; empty when nothing does. */
  attention: string[];
  pendingChanges: number;
  needsReview: number;
  phases: PlanPhase[];
  changes: Array<{
    id: string;
    effectiveOn: string;
    kind: string;
    description: string;
  }>;
  runs: Array<{
    createdAt: string;
    source: string;
    note: string;
    added: number;
    updated: number;
    flagged: number;
    removed: number;
  }>;
  version: number;
  /** A request drafted at kickoff, before the plan, that a person settles against it. */
  reconcile: {
    requestId: string;
    requestVersion: number;
    /** The plan's design and interim items it holds up (0 before planning). */
    waitingItems: number;
  } | null;
};

export const PLAN_STATUS_LABELS: Record<EvidencePlan["status"], string> = {
  NOT_PLANNED: "Not planned",
  PROPOSED: "Proposed, not approved",
  APPROVED: "Approved",
  CHANGES_PROPOSED: "Changes proposed",
  CHANGES_REQUESTED: "Changes requested",
};

export const CONTROL_TYPE_LABELS: Record<string, string> = {
  CONFIGURATION: "Configured (system-enforced) control",
  POPULATION: "Control tested over its population",
  MANAGEMENT_REVIEW: "Management review",
  REPORT: "Key report",
};

export const CHANGE_KINDS = [
  ["CONFIGURATION", "Configuration changed"],
  ["PROCESS", "Process changed"],
  ["PERSONNEL", "Performer or reviewer changed"],
  ["SYSTEM", "System changed"],
  ["INTRODUCED", "Control introduced"],
  ["REPLACED", "Control replaced"],
  ["DISCONTINUED", "Control discontinued"],
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number][0];
const CHANGE_KEYS = CHANGE_KINDS.map(([key]) => key);

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const records = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter(
    (item): item is string => typeof item === "string",
  );
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((item) => item === value) ?? fallback;
}

function parseRequirement(item: Raw): PlanRequirement {
  const change = isRecord(item.pending_change) ? item.pending_change : null;
  const state = oneOf(item.state, REQUIREMENT_STATES, "NOT_GENERATED");
  return {
    id: str(item.id),
    phase: oneOf(item.phase, PHASES, "DESIGN"),
    key: str(item.key),
    title: str(item.title),
    description: str(item.description),
    categories: strings(item.categories).filter((c): c is Category =>
      CATEGORY_KEYS.some((key) => key === c),
    ),
    objective: str(item.objective),
    attributes: strings(item.attributes),
    rationale: str(item.rationale),
    necessity: oneOf(
      item.necessity,
      ["REQUIRED", "CONDITIONAL", "OPTIONAL"] as const,
      "REQUIRED",
    ),
    periodLabel: str(item.period_label),
    populationKind: strOrNull(item.population_kind),
    sampleSelection: str(item.sample_selection),
    dependsOnTitle: strOrNull(item.depends_on_title),
    status: str(item.status),
    state,
    stateLabel: str(item.state_label) || REQUIREMENT_STATE_LABELS[state],
    requestId: strOrNull(item.request_id),
    requestReference: strOrNull(item.request_reference),
    requestRecipient: strOrNull(item.request_recipient),
    sufficiencyNote: str(item.sufficiency_note),
    sufficiencyBy: strOrNull(item.sufficiency_by),
    waiveReason: str(item.waive_reason),
    origin: str(item.origin),
    pendingChange:
      change === null
        ? null
        : {
            remove: change.remove === true,
            title: str(change.title),
            description: str(change.description),
          },
    needsReview: item.needs_review === true,
    coverageNote: str(item.coverage_note),
    version: num(item.version),
    files: records(item.files).map(parseRequirementFile),
    assessment: parseAssessment(item.assessment),
  };
}

function parseRequirementFile(item: Raw): RequirementFile {
  const coverage = item.coverage;
  return {
    fileId: str(item.file_id),
    name: str(item.name),
    via: item.via === "LINK" ? "LINK" : "REQUEST",
    linkId: strOrNull(item.link_id),
    linkedBy: strOrNull(item.linked_by),
    reason: str(item.reason),
    linkVersion:
      typeof item.link_version === "number" ? item.link_version : null,
    readStatus: strOrNull(item.read_status),
    readBy:
      item.read_by === "MODEL" || item.read_by === "RULES"
        ? item.read_by
        : null,
    kind: strOrNull(item.kind),
    kindConfirmed: item.kind_confirmed === true,
    coverage:
      coverage === "COVERED" ||
      coverage === "PARTIAL" ||
      coverage === "NOT_COVERED"
        ? coverage
        : null,
    note: str(item.note),
    period: str(item.period),
    gaps: strings(item.gaps),
  };
}

function parseAssessment(value: unknown): Assessment {
  if (!isRecord(value)) {
    return { proposal: "NONE", reason: "", followUps: [] };
  }
  return {
    proposal: oneOf(
      value.proposal,
      ["SUFFICIENT", "FOLLOW_UP", "INSUFFICIENT", "NONE"] as const,
      "NONE",
    ),
    reason: str(value.reason),
    followUps: strings(value.follow_ups),
  };
}

export function parsePlan(value: unknown): EvidencePlan | null {
  if (!isRecord(value) || typeof value.control_id !== "string") {
    return null;
  }
  const understanding = isRecord(value.understanding)
    ? value.understanding
    : {};
  const byPhase = new Map(
    records(value.phases).map((phase) => [phase.phase, phase] as const),
  );
  return {
    controlId: value.control_id,
    status: oneOf(
      value.status,
      [
        "NOT_PLANNED",
        "PROPOSED",
        "APPROVED",
        "CHANGES_PROPOSED",
        "CHANGES_REQUESTED",
      ] as const,
      "NOT_PLANNED",
    ),
    revision: num(value.revision),
    approvedRevision:
      typeof value.approved_revision === "number"
        ? value.approved_revision
        : null,
    pendingRevision: value.pending_revision === true,
    source: strOrNull(value.source),
    provisional: value.provisional === true,
    note: str(value.note),
    summary: str(understanding.summary),
    controlType: str(understanding.control_type),
    missingInformation: strings(understanding.missing_information),
    assumptions: strings(understanding.assumptions),
    exceptions: strings(understanding.exceptions),
    approvalsRequired: strings(understanding.approvals_required),
    processNeeded: understanding.process_understanding_needed === true,
    processReason: str(understanding.process_understanding_reason),
    generatedAt: strOrNull(value.generated_at),
    approvedBy: strOrNull(value.approved_by),
    approvedAutomatically: value.approved_automatically === true,
    attention: Array.isArray(value.attention)
      ? value.attention.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    pendingChanges: num(value.pending_changes),
    needsReview: num(value.needs_review),
    // Always all three phases, in order, even when the API sent fewer.
    phases: PHASES.map((key) => {
      const phase = byPhase.get(key) ?? {};
      const state = oneOf(phase.state, PHASE_STATES, "NOT_PLANNED");
      return {
        phase: key,
        label: str(phase.label) || PHASE_LABELS[key],
        applicability:
          phase.applicability === null || phase.applicability === undefined
            ? null
            : oneOf(
                phase.applicability,
                [
                  "APPLICABLE",
                  "CONDITIONAL",
                  "NOT_APPLICABLE",
                  "PENDING",
                ] as const,
                "PENDING",
              ),
        rationale: str(phase.rationale),
        condition: str(phase.condition),
        openQuestion: str(phase.open_question),
        objectives: strings(phase.objectives),
        procedures: strings(phase.procedures),
        periodStart: strOrNull(phase.period_start),
        periodEnd: strOrNull(phase.period_end),
        origin: strOrNull(phase.origin),
        decidedBy: strOrNull(phase.decided_by),
        state,
        stateLabel: str(phase.state_label) || state,
        testingComplete: phase.testing_complete === true,
        requirements: records(phase.requirements).map(parseRequirement),
        requests: records(phase.requests).map((request) => ({
          id: str(request.id),
          reference: str(request.reference),
          status: str(request.status),
        })),
        version: num(phase.version),
      };
    }),
    changes: records(value.changes).map((change) => ({
      id: str(change.id),
      effectiveOn: str(change.effective_on),
      kind: str(change.kind),
      description: str(change.description),
    })),
    runs: records(value.runs).map((run) => {
      const changes = isRecord(run.changes) ? run.changes : {};
      const count = (key: string) => strings(changes[key]).length;
      return {
        createdAt: str(run.created_at),
        source: str(run.source),
        note: str(run.note),
        added: count("added"),
        updated: count("updated"),
        flagged: count("flagged"),
        removed: count("removed"),
      };
    }),
    version: num(value.version),
    reconcile:
      isRecord(value.reconcile) &&
      typeof value.reconcile.request_id === "string"
        ? {
            requestId: value.reconcile.request_id,
            requestVersion: num(value.reconcile.request_version),
            waitingItems: num(value.reconcile.waiting_items),
          }
        : null,
  };
}

/** The requirements a phase shows: what is still part of the plan. Items removed by a
 * later run are left out; items a person waived stay, with the reason. */
export function shownRequirements(phase: PlanPhase): PlanRequirement[] {
  return phase.requirements.filter((item) => item.state !== "REMOVED");
}

/** A phase's requirements grouped by their first evidence category, in category order. */
export function groupByCategory(
  requirements: PlanRequirement[],
): Array<{ category: Category; label: string; items: PlanRequirement[] }> {
  return CATEGORIES.map(([category, label]) => ({
    category,
    label,
    items: requirements.filter((item) => item.categories[0] === category),
  })).filter((group) => group.items.length > 0);
}

export type RequirementFilter = {
  phase: Phase | "";
  category: Category | "";
  state: RequirementState | "";
  owner: string;
};

export const NO_FILTER: RequirementFilter = {
  phase: "",
  category: "",
  state: "",
  owner: "",
};

/** Every requirement of the control, across phases, narrowed by the chosen filters. */
export function filterRequirements(
  plan: EvidencePlan,
  filter: RequirementFilter,
): PlanRequirement[] {
  return plan.phases
    .flatMap((phase) => shownRequirements(phase))
    .filter(
      (item) =>
        (filter.phase === "" || item.phase === filter.phase) &&
        (filter.category === "" || item.categories.includes(filter.category)) &&
        (filter.state === "" || item.state === filter.state) &&
        (filter.owner === "" || item.requestRecipient === filter.owner),
    );
}

/** The owners the consolidated view can filter by: whoever received a request. */
export function owners(plan: EvidencePlan): string[] {
  return [
    ...new Set(
      plan.phases
        .flatMap((phase) => phase.requirements)
        .map((item) => item.requestRecipient)
        .filter((item): item is string => item !== null && item !== ""),
    ),
  ].sort();
}

/** How a phase's plan reads as a step on the control record: done only when its
 * evidence is accepted or its testing complete; a question to answer needs attention. */
export function stepStateOf(
  state: PhaseState,
): "todo" | "active" | "done" | "issue" {
  switch (state) {
    case "COMPLETE":
    case "EVIDENCE_ACCEPTED":
      return "done";
    case "AWAITING_CLARIFICATION":
      return "issue";
    case "NOT_GENERATED":
    case "NOT_SENT":
    case "OUTSTANDING":
    case "RECEIVED_NOT_VALIDATED":
    case "AWAITING_DEPENDENCY":
      return "active";
    default:
      return "todo";
  }
}

/** A control's requests that serve one phase. A request from before phases were
 * recorded counts as interim, where the platform used to list it. */
export function requestsOfPhase<T extends { phase: string | null }>(
  requests: T[],
  phase: Phase,
): T[] {
  return requests.filter((request) => (request.phase ?? "INTERIM") === phase);
}

/** How far a phase's requests have come back: receipt only, never sufficiency, which the
 * plan's items show. */
export function requestProgress(requests: Array<{ status: string }>): {
  state: "todo" | "active" | "done";
  note: string;
} {
  const live = requests.filter((request) => request.status !== "CANCELLED");
  const received = live.filter(
    (request) => request.status === "RECEIVED" || request.status === "CLOSED",
  ).length;
  if (live.length === 0) {
    return { state: "todo", note: "No requests yet" };
  }
  return {
    state: received === live.length ? "done" : "active",
    note: `${received} of ${live.length} received`,
  };
}

/** The population items a person must accept before samples can be approved, as the
 * API's gate counts them (evidence_plans.population_gate): the population and any
 * required support for it, not waived. */
export function populationWaiting(
  plan: EvidencePlan | null,
  phase: "INTERIM" | "ROLLFORWARD",
): PlanRequirement[] {
  const found = plan?.phases.find((item) => item.phase === phase);
  if (found === undefined || found.applicability !== "APPLICABLE") {
    return [];
  }
  return found.requirements.filter(
    (item) =>
      item.dependsOnTitle === null &&
      item.state !== "NOT_APPLICABLE" &&
      item.state !== "REMOVED" &&
      item.state !== "ACCEPTED" &&
      (item.categories.includes("POPULATION") ||
        (item.categories.includes("REPORT_RELIABILITY") &&
          item.necessity === "REQUIRED")),
  );
}

/** The phase a control record tab shows. */
export function phaseOfTab(tab: string): Phase | null {
  return tab === "design"
    ? "DESIGN"
    : tab === "interim"
      ? "INTERIM"
      : tab === "rollforward"
        ? "ROLLFORWARD"
        : null;
}

// Actions

export type PlanIntent =
  | "generate"
  | "approve"
  | "phase"
  | "sufficiency"
  | "waive"
  | "restore"
  | "change"
  | "control-change"
  | "link"
  | "unlink"
  | "reconcile"
  | "request-changes"
  | "submit"
  | "revision";

export type PlanWrite =
  | { error: "invalid" }
  | {
      intent: PlanIntent;
      path: string;
      body: Record<string, unknown>;
      /** Planning may wait for the agent, so it gets longer to answer. */
      slow: boolean;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SECRET =
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S|sk-[A-Za-z0-9]{10,}/i;
type Fields = Record<string, unknown>;
const text = (fields: Fields, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string).trim() : "";
const version = (fields: Fields): number | null => {
  const value = Number(fields.version);
  return Number.isInteger(value) && value >= 1 ? value : null;
};
const clean = (value: string, min: number, max: number) =>
  value.length >= min && value.length <= max && !SECRET.test(value);

/** The API call for one action on a control's evidence plan, checked before it is sent. */
export function planWrite(fields: Fields): PlanWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const controlId = text(fields, "control_id");
  const intent = text(fields, "intent") as PlanIntent;
  if (![organizationId, projectId, controlId].every((id) => UUID.test(id))) {
    return { error: "invalid" };
  }
  const control = `/organizations/${organizationId}/projects/${projectId}/controls/${controlId}`;
  const requirementId = text(fields, "requirement_id");
  const requirement = `${control}/evidence-requirements/${requirementId}`;
  const at = version(fields);
  const ok = (
    path: string,
    body: Record<string, unknown> = {},
    slow = false,
  ): PlanWrite => ({ intent, path, body, slow });
  switch (intent) {
    case "generate":
      return ok(`${control}/evidence-plan/generate`, {}, true);
    case "approve":
      return at === null
        ? { error: "invalid" }
        : ok(`${control}/evidence-plan/approve`, { version: at });
    case "phase": {
      const phase = text(fields, "phase");
      const applicability = text(fields, "applicability");
      const rationale = text(fields, "rationale");
      const condition = text(fields, "condition");
      const question = text(fields, "open_question");
      if (
        !PHASES.some((key) => key === phase) ||
        !["APPLICABLE", "CONDITIONAL", "NOT_APPLICABLE", "PENDING"].includes(
          applicability,
        ) ||
        at === null ||
        !clean(rationale, applicability === "NOT_APPLICABLE" ? 30 : 10, 1500) ||
        (applicability === "CONDITIONAL" && !clean(condition, 3, 500)) ||
        (applicability === "PENDING" && !clean(question, 3, 500))
      ) {
        return { error: "invalid" };
      }
      return ok(`${control}/evidence-plan/phases/${phase}`, {
        applicability,
        rationale,
        condition,
        open_question: question,
        version: at,
      });
    }
    case "sufficiency": {
      const sufficiency = text(fields, "sufficiency");
      const note = text(fields, "note");
      const needsNote =
        sufficiency === "INSUFFICIENT" || sufficiency === "FOLLOW_UP_REQUIRED";
      if (
        !UUID.test(requirementId) ||
        at === null ||
        ![
          "NOT_REVIEWED",
          "UNDER_REVIEW",
          "ACCEPTED",
          "INSUFFICIENT",
          "FOLLOW_UP_REQUIRED",
        ].includes(sufficiency) ||
        (needsNote && !clean(note, 3, 1000)) ||
        note.length > 1000 ||
        SECRET.test(note)
      ) {
        return { error: "invalid" };
      }
      return ok(`${requirement}/sufficiency`, {
        sufficiency,
        note,
        version: at,
      });
    }
    case "waive": {
      const reason = text(fields, "reason");
      return UUID.test(requirementId) && at !== null && clean(reason, 10, 1000)
        ? ok(`${requirement}/waive`, { reason, version: at })
        : { error: "invalid" };
    }
    case "restore":
      return UUID.test(requirementId) && at !== null
        ? ok(`${requirement}/restore`, { version: at })
        : { error: "invalid" };
    case "change": {
      const decision = text(fields, "decision");
      return UUID.test(requirementId) &&
        at !== null &&
        (decision === "ACCEPT" || decision === "DISMISS")
        ? ok(`${requirement}/change`, { decision, version: at })
        : { error: "invalid" };
    }
    case "link": {
      const fileId = text(fields, "file_id");
      const reason = text(fields, "reason");
      return UUID.test(requirementId) &&
        UUID.test(fileId) &&
        at !== null &&
        clean(reason, 3, 500) &&
        !SECRET.test(reason)
        ? ok(`${requirement}/files`, { file_id: fileId, reason, version: at })
        : { error: "invalid" };
    }
    case "request-changes": {
      // The reviewer returns the plan with what to change (project.update).
      const comment = text(fields, "comment");
      return at !== null && clean(comment, 10, 4000)
        ? ok(`${control}/evidence-plan/request-changes`, {
            version: at,
            comment,
          })
        : { error: "invalid" };
    }
    case "submit": {
      // A preparer submits the current revision for review.
      const note = text(fields, "note");
      return at !== null && note.length <= 2000 && !SECRET.test(note)
        ? ok(`${control}/evidence-plan/submit`, { version: at, note })
        : { error: "invalid" };
    }
    case "revision": {
      // The planner's revised understanding and procedures: accepted or dismissed.
      const decision = text(fields, "decision");
      return at !== null && (decision === "ACCEPT" || decision === "DISMISS")
        ? ok(`${control}/evidence-plan/pending-revision`, {
            version: at,
            decision,
          })
        : { error: "invalid" };
    }
    case "reconcile": {
      // The kickoff draft: replaced by the plan's requests (with why), or kept for them.
      const action = text(fields, "action");
      const reason = text(fields, "reason");
      const requestVersion = Number(fields.request_version);
      return (action === "REPLACE" || action === "KEEP") &&
        Number.isInteger(requestVersion) &&
        requestVersion >= 1 &&
        reason.length <= 500 &&
        !SECRET.test(reason) &&
        (action === "KEEP" || reason.length >= 3)
        ? ok(
            `${control}/evidence-plan/reconcile`,
            { action, request_version: requestVersion, reason },
            true,
          )
        : { error: "invalid" };
    }
    case "unlink": {
      const linkId = text(fields, "link_id");
      const reason = text(fields, "reason");
      return UUID.test(requirementId) &&
        UUID.test(linkId) &&
        at !== null &&
        clean(reason, 3, 500) &&
        !SECRET.test(reason)
        ? ok(`${requirement}/files/${linkId}/remove`, { reason, version: at })
        : { error: "invalid" };
    }
    case "control-change": {
      const effectiveOn = text(fields, "effective_on");
      const kind = text(fields, "kind");
      const description = text(fields, "description");
      return DATE.test(effectiveOn) &&
        CHANGE_KEYS.some((key) => key === kind) &&
        clean(description, 3, 1000)
        ? ok(
            `${control}/control-changes`,
            { effective_on: effectiveOn, kind, description },
            true,
          )
        : { error: "invalid" };
    }
    default:
      return { error: "invalid" };
  }
}

/** What a person reads when an action on the plan did not go through. */
export function planProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    const known: Record<string, string> = {
      "nothing has been received for this requirement yet":
        "Nothing has arrived for this item yet, so it cannot be judged.",
      "missing evidence is not a reason a phase does not apply":
        "Missing evidence is not a reason a phase does not apply. Leave it applicable and follow up, or give the scope or methodology reason.",
      "missing evidence is not a reason a requirement does not apply":
        "Missing evidence is not a reason an item does not apply. Follow it up instead.",
      "decide the proposed changes first":
        "Accept or dismiss the proposed changes before approving the plan.",
      "the control is out of scope": "The control is out of scope.",
      "the control has no evidence plan yet":
        "Plan the evidence for this control first.",
      "the file is not one of this control's evidence files":
        "Only a file this control already holds can serve its items.",
      "the file already serves it through its request":
        "That file already serves this item through its request.",
      "the file already serves it": "That file already serves this item.",
      "the requirement is not open":
        "This item is not open: it was marked not applicable or removed.",
      "set the evidence coordinator or the owner's email first":
        "No recipient is available for the planned requests. Assign the evidence coordinator or a control owner email first, or retain this draft.",
      "nothing waits on the kickoff draft":
        "No planned items depend on this draft. Refresh to see the current status.",
      "there is no kickoff draft to reconcile":
        "This draft has already been reconciled. Refresh to see the current status.",
      "the request changed":
        "The request was updated since the page loaded. Refresh and try again.",
      "settle the control's attributes first":
        "Decide the proposed attributes and settle any open question about them before approving the plan.",
      "changes are already requested":
        "Changes were already requested on this plan.",
      "no revision is waiting":
        "The planner's proposed revision was already decided. Refresh to see the plan.",
    };
    // What holds an approval is written for people (master_plans.py): shown as is.
    if (known[detail] === undefined && /^[A-Z0-9].*.$/.test(detail)) {
      return detail;
    }
    return (
      known[detail] ??
      "This changed while you were working. Refresh and try again."
    );
  }
  if (status === 403 || status === 404) {
    return "Your role cannot change this control's plan.";
  }
  if (status === 422) {
    return detail === "the change is after period end"
      ? "The change is dated after the period end."
      : "Check the entry: it needs a reason long enough to stand on its own, within the length limits, and no credential.";
  }
  return "That could not be saved. Try again.";
}
