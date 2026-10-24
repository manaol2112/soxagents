/**
 * Master test plans (milestones A to C): the engagement's planning review queue
 * (GET …/planning-review) and one control's plan in four sections
 * (GET …/controls/{id}/master-plan): its understanding, procedures, attributes, and
 * required evidence, linked by code. The actions a reviewer or preparer takes are checked
 * here before they reach the API, which checks again. Nothing here decides whether a plan
 * may be approved: the API says what holds it.
 */

import {
  groupApproveBody,
  implementationName,
  UNIT_KINDS,
} from "./shared-plans-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET =
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S|sk-[A-Za-z0-9]{10,}/i;

export const PLANNING_STATES = [
  "NOT_STARTED",
  "ANALYZING",
  "NEEDS_CLARIFICATION",
  "DRAFT_READY",
  "PENDING_REVIEW",
  "APPROVED",
  "CHANGES_REQUESTED",
] as const;
export type PlanningState = (typeof PLANNING_STATES)[number];

export const STATE_LABELS: Record<PlanningState, string> = {
  NOT_STARTED: "Not started",
  ANALYZING: "Analyzing",
  NEEDS_CLARIFICATION: "Needs clarification",
  DRAFT_READY: "Draft ready",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
};

export const STATE_TONES: Record<PlanningState, string> = {
  NOT_STARTED: "tone-neutral",
  ANALYZING: "tone-ai",
  NEEDS_CLARIFICATION: "tone-warning",
  DRAFT_READY: "tone-info",
  PENDING_REVIEW: "tone-info",
  APPROVED: "tone-success",
  CHANGES_REQUESTED: "tone-danger",
};

/** The queue's figures, in the order a reviewer reads them. */
export const QUEUE_FIGURES: ReadonlyArray<{
  states: readonly PlanningState[];
  label: string;
  /** What the figure means for the reviewer. */
  detail: string;
}> = [
  {
    states: ["PENDING_REVIEW", "DRAFT_READY"],
    label: "Ready for review",
    detail: "Nothing open to settle first",
  },
  {
    states: ["NEEDS_CLARIFICATION"],
    label: "Needs clarification",
    detail: "Questions open; still reviewable",
  },
  {
    states: ["CHANGES_REQUESTED"],
    label: "Changes requested",
    detail: "Returned to the preparer",
  },
  {
    states: ["APPROVED"],
    label: "Approved",
    detail: "Requests and testing may proceed",
  },
  {
    states: ["ANALYZING", "NOT_STARTED"],
    label: "Being planned",
    detail: "Planner drafting, or not planned",
  },
];

export const TABS = [
  "understanding",
  "procedures",
  "attributes",
  "evidence",
] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABELS: Record<Tab, string> = {
  understanding: "Understanding",
  procedures: "Procedures",
  attributes: "Attributes",
  evidence: "Evidence",
};

/** Short labels for the control's own facts. The API still sends the long field names. */
export const FACT_TITLES: Record<string, string> = {
  OBJECTIVE: "Objective",
  RISK: "Risk",
  DESCRIPTION: "How it operates",
  DEPENDENCIES: "Relies on",
  NATURE: "Nature",
  TYPE: "Type",
  FREQUENCY: "Frequency",
  PERFORMER: "Performed by",
  REVIEWER: "Reviewed by",
  SYSTEM: "System",
  POPULATION: "Population",
  ASSERTIONS: "IT risk",
};

export function factTitle(field: string, fallback: string): string {
  return FACT_TITLES[field] ?? fallback;
}

/** Library statements leave client values in [brackets] until the team records them. */
export function statementParts(
  text: string,
): { text: string; placeholder: boolean; at: number }[] {
  const parts = text.split(/(\[[^\]\n]{1,80}\])/).filter((part) => part !== "");
  if (parts.length === 0) {
    return [{ text: "", placeholder: false, at: 0 }];
  }
  let at = 0;
  return parts.map((part) => {
    const item = {
      text: part,
      placeholder: part.startsWith("[") && part.endsWith("]"),
      at,
    };
    at += part.length;
    return item;
  });
}

export const PHASES = ["DESIGN", "INTERIM", "ROLLFORWARD"] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABELS: Record<Phase, string> = {
  DESIGN: "Design and implementation",
  INTERIM: "Interim operating effectiveness",
  ROLLFORWARD: "Roll-forward",
};
export const PHASE_SHORT: Record<Phase, string> = {
  DESIGN: "D&I",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
};

export const METHODS = [
  "INQUIRY",
  "OBSERVATION",
  "INSPECTION",
  "REPERFORMANCE",
  "RECALCULATION",
  "COMPARISON",
  "WALKTHROUGH",
] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABELS: Record<Method, string> = {
  INQUIRY: "Inquiry",
  OBSERVATION: "Observation",
  INSPECTION: "Inspection",
  REPERFORMANCE: "Reperformance",
  RECALCULATION: "Recalculation",
  COMPARISON: "Comparison",
  WALKTHROUGH: "Walkthrough",
};

export const BASIS_LABELS: Record<string, string> = {
  SOURCE: "From the records",
  PROPOSED: "Proposed",
  JUDGMENT: "Judgment",
  ASSUMPTION: "Assumption",
  MISSING: "Missing",
};
export const BASIS_TONES: Record<string, string> = {
  SOURCE: "tone-success",
  PROPOSED: "tone-ai",
  JUDGMENT: "tone-neutral",
  ASSUMPTION: "tone-warning",
  MISSING: "tone-danger",
};

/** Who wrote an item, as the reviewer reads it. */
export function originLabel(origin: string, personEdited = false): string {
  if (origin === "PERSON" || personEdited) {
    return personEdited && origin !== "PERSON"
      ? "Edited by a person"
      : "Added by a person";
  }
  if (origin === "AGENT") {
    return "Planner agent";
  }
  if (origin === "LIBRARY") {
    return "Library";
  }
  return "Standard rules";
}

/** Whether an item is the agents' and no person has changed it: shown as a proposal. */
export function isAgentWork(origin: string, personEdited = false): boolean {
  return origin !== "PERSON" && !personEdited;
}

export const CRITERIA_LABELS: Record<string, string> = {
  PLAN: "Stated by a person",
  AGENT: "Proposed by the planner agent",
  LIBRARY: "From the library definition",
  NONE: "Not stated",
};

// Types

export type QueueRow = {
  controlId: string;
  controlRef: string;
  title: string;
  application: string;
  /** The units it operates in, when split by them (Release 1); "" otherwise. */
  units: string;
  state: PlanningState;
  revision: number;
  approvedRevision: number | null;
  revisedSinceApproval: boolean;
  /** Approved before and changed since: what changed, in short. */
  changesSinceApproval: string[];
  clarifications: number;
  decisions: number;
  findings: number;
  submittedBy: string | null;
  lastDecision: "APPROVED" | "CHANGES_REQUESTED" | null;
  lastDecisionBy: string | null;
  lastDecisionAt: string | null;
  lastComment: string;
  version: number;
  approvable: boolean;
  heldBy: string;
  /** The team's process for the control, or its standard area. */
  process: string;
  category: ControlCategory;
  keyControl: boolean;
  nature: string;
  frequency: string;
  testBasis: string;
  /** The client values the plan asks for, answerable from the queue. */
  openValues: OpenValue[];
  /** The questions that are not client values: reviewed on the plan itself. */
  otherQuestions: number;
};

export const CONTROL_CATEGORIES = [
  "ITGC",
  "ITAC",
  "KEY_REPORT",
  "BUSINESS",
  "ENTITY",
] as const;
export type ControlCategory = (typeof CONTROL_CATEGORIES)[number];
export const CATEGORY_WORDS: Record<ControlCategory, string> = {
  ITGC: "IT general control",
  ITAC: "Application control",
  KEY_REPORT: "Key report",
  BUSINESS: "Business process control",
  ENTITY: "Entity-level control",
};

export type Queue = {
  total: number;
  counts: Record<PlanningState, number>;
  controls: QueueRow[];
  nextControlId: string | null;
  /** May record the client values the plans ask for (task.update). */
  viewerCanAnswer: boolean;
  viewerCanDecide: boolean;
};

export type Fact = {
  field: string;
  label: string;
  value: string;
  basis: string;
  source: string;
  quote: string;
  question: string;
};

export type PlanPhase = {
  phase: Phase;
  label: string;
  applicability: string;
  rationale: string;
  condition: string;
  openQuestion: string;
  objectives: string[];
  periodStart: string | null;
  periodEnd: string | null;
  origin: string;
};

export type Procedure = {
  id: string;
  code: string;
  phase: Phase;
  text: string;
  method: Method | null;
  origin: string;
  personEdited: boolean;
  attributeIds: string[];
  attributeCodes: string[];
  evidenceCodes: string[];
  version: number;
  /** The standard's procedure this row follows, when the standard has steps. */
  standardKey: string;
};

export type Attribute = {
  id: string;
  code: string;
  text: string;
  basis: string;
  source: string;
  quote: string;
  objective: string;
  condition: string;
  passCriteria: string;
  failCriteria: string;
  criteriaSource: "PLAN" | "AGENT" | "LIBRARY" | "NONE";
  judgmentRequired: boolean | null;
  automatable: boolean | null;
  phases: Phase[];
  procedureCodes: string[];
  evidenceCodes: string[];
  version: number;
};

export type Evidence = {
  id: string;
  code: string;
  phase: Phase;
  title: string;
  description: string;
  categories: string[];
  objective: string;
  necessity: string;
  periodLabel: string;
  status: string;
  origin: string;
  personEdited: boolean;
  attributeIds: string[];
  attributeCodes: string[];
  procedureIds: string[];
  procedureCodes: string[];
  unmatched: string[];
  version: number;
};

export type Finding = { kind: string; code: string; detail: string };
/** Where a blocker is resolved (master_plans.BlockerResolve). */
export const BLOCKER_RESOLVES = [
  "WAIT",
  "REVISION",
  "LIBRARY",
  "CONTROL",
  "ATTRIBUTES",
  "PROCESS",
  "EVIDENCE_CHANGES",
  "FACTS",
  "VALUES",
  "PHASES",
  "UNDERSTANDING",
] as const;
export type BlockerResolve = (typeof BLOCKER_RESOLVES)[number];

export type Blocker = {
  kind: "CLARIFICATION" | "DECISION";
  detail: string;
  blocks: boolean;
  resolve: BlockerResolve;
  /** The standard a LIBRARY clarification is about, for the link to it. */
  target: string;
};
export type Decision = {
  decision: "APPROVED" | "CHANGES_REQUESTED";
  revision: number;
  comment: string;
  decidedBy: string;
  decidedAt: string;
  contentHash: string;
  findings: number;
};

export type MasterPlan = {
  controlId: string;
  planId: string | null;
  control: {
    controlRef: string;
    title: string;
    description: string;
    risk: string;
    frequency: string;
    nature: string;
    area: string;
    keyControl: boolean;
    application: string;
    units: string;
    classifications: string[];
    /** Where the control came from, what its plan is built from, and the standard it
     * follows with the firm's review of it (milestone L2). */
    source: string;
    testBasis: string;
    libraryKey: string;
    libraryRef: string;
    libraryStatus: string;
  };
  state: PlanningState;
  status: string | null;
  runStatus: string;
  revision: number;
  approvedRevision: number | null;
  revisedSinceApproval: boolean;
  version: number;
  summary: string;
  assumptions: string[];
  exceptions: string[];
  facts: Fact[];
  provisional: boolean;
  phases: PlanPhase[];
  procedures: Procedure[];
  attributes: Attribute[];
  evidence: Evidence[];
  findings: Finding[];
  blockers: Blocker[];
  decisions: Decision[];
  submitted: { by: string; at: string; note: string } | null;
  pendingRevision: boolean;
  contentHash: string | null;
  viewerCanDecide: boolean;
  /** The client values the review asks for, answerable before approving. */
  openValues: OpenValue[];
  /** Whether the viewer may enter those values from the plan, as on the queue. */
  viewerCanAnswer: boolean;
  /** Client values filled since the plan was approved; they keep its approval. */
  filledSinceApproval: FilledValue[];
  /** For a client's control whose RCM gives no test attributes: the standard it
   * matches, to follow as a customized standard and take its attributes. */
  suggestedStandard: SuggestedStandard | null;
  /** Approved before and changed since: what changed from the version approved. */
  changesSinceApproval: ChangeItem[];
};

export type ChangeItem = {
  section: string;
  code: string;
  change: "ADDED" | "REMOVED" | "CHANGED";
  detail: string;
};

/** What changed since a plan's approval, in a few words: one change as it is, several
 * counted by kind (procedures, attributes, evidence) with the control's own fields named;
 * a plan whose only change is client values filled in says so. */
export function changesSummary(changes: readonly string[]): string {
  if (changes.length === 0) {
    return "Only client values filled in";
  }
  if (changes.length === 1) {
    return changes[0] ?? "";
  }
  const kinds: Array<[string, string, string]> = [
    ["Procedure", "procedure", "procedures"],
    ["Attribute", "attribute", "attributes"],
    ["Evidence", "evidence item", "evidence items"],
  ];
  const parts: string[] = [];
  for (const [prefix, one, many] of kinds) {
    const count = changes.filter((item) =>
      item.startsWith(`${prefix} `),
    ).length;
    if (count > 0) {
      parts.push(`${count} ${count === 1 ? one : many}`);
    }
  }
  for (const item of changes) {
    if (!kinds.some(([prefix]) => item.startsWith(`${prefix} `))) {
      parts.push(item.replace(/\s+(changed|revised)$/, "").toLowerCase());
    }
  }
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Changes since approval, one line per part of the plan: what happened and to which
 * items ("added D3, D4 · removed D1"); the control's own changes as said. */
export type ChangeGroup = {
  label: string;
  parts: Array<{ what: string; codes: string[] }>;
};

const CHANGE_SECTIONS: Array<[string, string, string]> = [
  ["CONTROL", "The control", ""],
  ["UNDERSTANDING", "Understanding", ""],
  ["PHASE", "Phases", ""],
  ["PROCEDURE", "Procedures", "Procedure"],
  ["ATTRIBUTE", "Attributes", "Attribute"],
  ["EVIDENCE", "Evidence", "Evidence"],
];

export function groupChanges(items: readonly ChangeItem[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  for (const [section, label, name] of CHANGE_SECTIONS) {
    const mine = items.filter((item) => item.section === section);
    if (mine.length === 0) {
      continue;
    }
    const parts: ChangeGroup["parts"] = [];
    for (const item of mine) {
      const prefix = `${name} ${item.code} `;
      const coded = name !== "" && item.detail.startsWith(prefix);
      const what = coded ? item.detail.slice(prefix.length) : item.detail;
      const part = coded
        ? parts.find((entry) => entry.what === what)
        : undefined;
      if (part !== undefined) {
        part.codes.push(item.code);
      } else {
        parts.push({ what, codes: coded ? [item.code] : [] });
      }
    }
    groups.push({ label, parts });
  }
  return groups;
}

/** The last decision as the queue shows it: an approval the plan has changed since names
 * the revision it approved, so it does not read as the plan's current state. */
export function decisionWords(
  row: Pick<
    QueueRow,
    "lastDecision" | "revisedSinceApproval" | "approvedRevision"
  >,
): string {
  if (row.lastDecision === "CHANGES_REQUESTED") {
    return "Changes requested";
  }
  return row.revisedSinceApproval && row.approvedRevision !== null
    ? `Approved revision ${row.approvedRevision}`
    : "Approved";
}

export type SuggestedStandard = {
  libraryKey: string;
  controlRef: string;
  title: string;
  status: "STRONG" | "PARTIAL";
  rationale: string;
};

/** The facts the team states for a client's own control (master_plans.STATEABLE_FACTS),
 * in the order the Describe dialog asks them. */
export const STATEABLE_FACTS = [
  "TYPE",
  "PERFORMER",
  "REVIEWER",
  "ASSERTIONS",
  "OBJECTIVE",
  "POPULATION",
  "DEPENDENCIES",
] as const;
export type StateableFact = (typeof STATEABLE_FACTS)[number];

/** The assertions a business process control may address (control_statements). */
export const ASSERTION_CHOICES = [
  "Existence or occurrence",
  "Completeness",
  "Valuation or allocation",
  "Rights and obligations",
  "Presentation and disclosure",
] as const;

const IT_AREAS = new Set(["ACCESS", "CHANGE", "OPERATIONS", "ITAC", "IPE"]);

// Each fact the Describe dialog asks, as one question, whether the plan is missing it or
// the planner proposed it (the proposal is filled in below the question).
const DESCRIBE_QUESTIONS: Record<StateableFact, string> = {
  TYPE: "Does the control prevent the error, or detect it after the fact?",
  PERFORMER: "Who performs the control at the client?",
  REVIEWER: "Who reviews or approves the control's operation, if anyone?",
  ASSERTIONS:
    "Which financial statement assertions or IT risks does the control address?",
  OBJECTIVE: "What is the control meant to achieve?",
  POPULATION:
    "What population of instances or transactions does the control cover?",
  DEPENDENCIES:
    "Which reports, interfaces, or configurations does the control rely on?",
};

export type DescribeQuestion = {
  field: StateableFact;
  label: string;
  question: string;
  /** How it is answered: a choice of two, words, the assertions, or a few sentences. */
  input: "type" | "text" | "assertions" | "long";
  /** The planner's proposal to confirm, or "" for a fact the plan is missing. */
  proposal: string;
};

/**
 * What the Describe dialog asks of a client's own control: each fact the plan is missing
 * that the team states (the blockers resolved by FACTS), then each the planner proposed,
 * to confirm. Empty for a control whose facts all stand.
 */
export function describeQuestions(plan: MasterPlan): DescribeQuestion[] {
  const asked = new Set(
    plan.blockers
      .filter((item) => item.resolve === "FACTS")
      .map((item) => item.detail.split(":")[0] ?? ""),
  );
  const questions: DescribeQuestion[] = [];
  for (const field of STATEABLE_FACTS) {
    const fact = plan.facts.find((item) => item.field === field);
    if (fact === undefined) {
      continue;
    }
    const missing = fact.basis === "MISSING" && asked.has(fact.label);
    const proposed = fact.basis === "PROPOSED" || fact.basis === "ASSUMPTION";
    if (!missing && !proposed) {
      continue;
    }
    const input =
      field === "TYPE"
        ? "type"
        : field === "ASSERTIONS"
          ? IT_AREAS.has(plan.control.area)
            ? "text"
            : "assertions"
          : field === "PERFORMER" || field === "REVIEWER"
            ? "text"
            : "long";
    questions.push({
      field,
      label: fact.label,
      question: DESCRIBE_QUESTIONS[field],
      input,
      proposal: missing ? "" : fact.value,
    });
  }
  return questions;
}

export type FilledValue = {
  key: string;
  label: string;
  value: string;
  filledBy: string;
  filledAt: string;
};

/** What was filled into an approved plan since, in one line for its header. */
export function filledLine(values: readonly FilledValue[]): string {
  if (values.length === 0) {
    return "";
  }
  const parts = values.map(
    (item) =>
      `${item.label}: ${item.value}` +
      (item.filledBy !== "" ? ` (${item.filledBy})` : ""),
  );
  return `Client ${values.length === 1 ? "value" : "values"} filled since approval: ${parts.join("; ")}`;
}

/** A client value the plan asks for (control_design.open_values): the slot, what it is,
 * why it matters, an example, and whether testing waits for it. */
export type OpenValue = {
  key: string;
  label: string;
  why: string;
  example: string;
  blocks: boolean;
  /** The answers usually given, to choose from (slot_options.py). */
  options: string[];
  /** The value as a question to the client (slot_questions.py). */
  question: string;
  /** How to answer it, for whoever fills it in (slot_questions.hint_for). */
  hint: string;
};

/** The hint in an empty answer field: a usual answer is offered under it, so the field
 * asks for the client's own; else the library's example. */
export function answerPlaceholder(value: {
  options: readonly string[];
  example: string;
}): string {
  if (value.options.length > 0) {
    return "Type the client's answer";
  }
  return value.example !== "" ? `For example: ${value.example}` : "";
}

/** How a value is asked: its question, else its name. */
export function questionText(value: {
  question: string;
  label: string;
}): string {
  if (value.question.trim() !== "") {
    return value.question;
  }
  return `${value.label.charAt(0).toUpperCase()}${value.label.slice(1)}`;
}

/** The answers a reviewer gives while approving: only the values filled in, trimmed. */
export function answeredValues(
  asked: readonly OpenValue[],
  answers: Record<string, string>,
): Record<string, string> {
  const keys = new Set(asked.map((item) => item.key));
  return Object.fromEntries(
    Object.entries(answers)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([key, value]) => keys.has(key) && value !== ""),
  );
}

// Parsing

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const phaseOf = (value: unknown): Phase => oneOf(value, PHASES, "DESIGN");
const phasesOf = (value: unknown): Phase[] =>
  strings(value).filter((item): item is Phase =>
    (PHASES as readonly string[]).includes(item),
  );

/** The state of a plan as the API reports it. An unknown one is never read as approved. */
function stateOf(value: unknown): PlanningState {
  return oneOf(value, PLANNING_STATES, "NEEDS_CLARIFICATION");
}

export function parseQueue(value: unknown): Queue | null {
  if (!isRecord(value) || !Array.isArray(value.controls)) {
    return null;
  }
  const counts = Object.fromEntries(
    PLANNING_STATES.map((state) => [
      state,
      isRecord(value.counts) ? num(value.counts[state]) : 0,
    ]),
  ) as Record<PlanningState, number>;
  return {
    total: num(value.total),
    counts,
    controls: records(value.controls).map((row) => ({
      controlId: str(row.control_id),
      controlRef: str(row.control_ref),
      title: str(row.title),
      application: str(row.application),
      units: str(row.units),
      state: stateOf(row.state),
      revision: num(row.revision),
      approvedRevision:
        typeof row.approved_revision === "number"
          ? row.approved_revision
          : null,
      revisedSinceApproval: row.revised_since_approval === true,
      clarifications: num(row.clarifications),
      decisions: num(row.decisions),
      findings: num(row.findings),
      submittedBy: strOrNull(row.submitted_by),
      lastDecision:
        row.last_decision === "APPROVED" ||
        row.last_decision === "CHANGES_REQUESTED"
          ? row.last_decision
          : null,
      lastDecisionBy: strOrNull(row.last_decision_by),
      lastDecisionAt: strOrNull(row.last_decision_at),
      lastComment: str(row.last_comment),
      version: num(row.version),
      approvable: row.approvable === true,
      heldBy: str(row.held_by),
      process: str(row.process),
      category: oneOf(row.category, CONTROL_CATEGORIES, "BUSINESS"),
      keyControl: row.key_control === true,
      nature: str(row.nature),
      frequency: str(row.frequency),
      testBasis: str(row.test_basis),
      openValues: parseOpenValues(row.open_values),
      otherQuestions: num(row.other_questions),
      changesSinceApproval: (Array.isArray(row.changes_since_approval)
        ? row.changes_since_approval
        : []
      ).filter((item): item is string => typeof item === "string"),
    })),
    nextControlId: strOrNull(value.next_control_id),
    viewerCanAnswer: value.viewer_can_answer === true,
    viewerCanDecide: value.viewer_can_decide === true,
  };
}

export function parseMasterPlan(value: unknown): MasterPlan | null {
  if (!isRecord(value) || typeof value.control_id !== "string") {
    return null;
  }
  const control = isRecord(value.control) ? value.control : {};
  const understanding = isRecord(value.understanding)
    ? value.understanding
    : {};
  return {
    controlId: value.control_id,
    planId: strOrNull(value.plan_id),
    control: {
      controlRef: str(control.control_ref),
      title: str(control.title),
      description: str(control.description),
      risk: str(control.risk),
      frequency: str(control.frequency),
      nature: str(control.nature),
      area: str(control.area),
      keyControl: control.key_control === true,
      application: str(control.application),
      units: str(control.units),
      classifications: strings(control.classifications),
      source: str(control.source),
      testBasis: str(control.test_basis),
      libraryKey: str(control.library_key),
      libraryRef: str(control.library_ref),
      libraryStatus: str(control.library_status),
    },
    state: stateOf(value.state),
    status: strOrNull(value.status),
    runStatus: str(value.run_status),
    revision: num(value.revision),
    approvedRevision:
      typeof value.approved_revision === "number"
        ? value.approved_revision
        : null,
    revisedSinceApproval: value.revised_since_approval === true,
    version: num(value.version),
    summary: str(understanding.summary),
    assumptions: strings(understanding.assumptions),
    exceptions: strings(understanding.exceptions),
    facts: records(value.facts).map((item) => ({
      field: str(item.field),
      label: str(item.label),
      value: str(item.value),
      basis: str(item.basis),
      source: str(item.source),
      quote: str(item.quote),
      question: str(item.question),
    })),
    provisional: value.provisional === true,
    phases: records(value.phases).map((item) => ({
      phase: phaseOf(item.phase),
      label: str(item.label),
      applicability: str(item.applicability),
      rationale: str(item.rationale),
      condition: str(item.condition),
      openQuestion: str(item.open_question),
      objectives: strings(item.objectives),
      periodStart: strOrNull(item.period_start),
      periodEnd: strOrNull(item.period_end),
      origin: str(item.origin),
    })),
    procedures: records(value.procedures).map((item) => ({
      id: str(item.id),
      code: str(item.code),
      phase: phaseOf(item.phase),
      text: str(item.text),
      method: (METHODS as readonly string[]).includes(str(item.method))
        ? (str(item.method) as Method)
        : null,
      origin: str(item.origin),
      personEdited: item.person_edited === true,
      attributeIds: strings(item.attribute_ids),
      attributeCodes: strings(item.attribute_codes),
      evidenceCodes: strings(item.evidence_codes),
      version: num(item.version),
      standardKey: str(item.standard_key),
    })),
    attributes: records(value.attributes).map((item) => ({
      id: str(item.id),
      code: str(item.code),
      text: str(item.text),
      basis: str(item.basis),
      source: str(item.source),
      quote: str(item.quote),
      objective: str(item.objective),
      condition: str(item.condition),
      passCriteria: str(item.pass_criteria),
      failCriteria: str(item.fail_criteria),
      criteriaSource: oneOf(
        item.criteria_source,
        ["PLAN", "AGENT", "LIBRARY", "NONE"] as const,
        "NONE",
      ),
      judgmentRequired: bool(item.judgment_required),
      automatable: bool(item.automatable),
      phases: phasesOf(item.phases),
      procedureCodes: strings(item.procedure_codes),
      evidenceCodes: strings(item.evidence_codes),
      version: num(item.version),
    })),
    evidence: records(value.evidence).map((item) => ({
      id: str(item.id),
      code: str(item.code),
      phase: phaseOf(item.phase),
      title: str(item.title),
      description: str(item.description),
      categories: strings(item.categories),
      objective: str(item.objective),
      necessity: str(item.necessity),
      periodLabel: str(item.period_label),
      status: str(item.status),
      origin: str(item.origin),
      personEdited: item.person_edited === true,
      attributeIds: strings(item.attribute_ids),
      attributeCodes: strings(item.attribute_codes),
      procedureIds: strings(item.procedure_ids),
      procedureCodes: strings(item.procedure_codes),
      unmatched: strings(item.unmatched),
      version: num(item.version),
    })),
    findings: records(value.findings).map((item) => ({
      kind: str(item.kind),
      code: str(item.code),
      detail: str(item.detail),
    })),
    blockers: records(value.blockers).map((item) => ({
      kind: item.kind === "DECISION" ? "DECISION" : "CLARIFICATION",
      detail: str(item.detail),
      blocks: item.blocks === true,
      resolve: oneOf(item.resolve, BLOCKER_RESOLVES, "UNDERSTANDING"),
      target: str(item.target),
    })),
    decisions: records(value.decisions).map((item) => ({
      decision:
        item.decision === "CHANGES_REQUESTED"
          ? "CHANGES_REQUESTED"
          : "APPROVED",
      revision: num(item.revision),
      comment: str(item.comment),
      decidedBy: str(item.decided_by),
      decidedAt: str(item.decided_at),
      contentHash: str(item.content_hash),
      findings: num(item.findings),
    })),
    submitted: isRecord(value.submitted)
      ? {
          by: str(value.submitted.by),
          at: str(value.submitted.at),
          note: str(value.submitted.note),
        }
      : null,
    pendingRevision: isRecord(value.pending_revision),
    contentHash: strOrNull(value.content_hash),
    viewerCanDecide: value.viewer_can_decide === true,
    openValues: parseOpenValues(value.open_values),
    viewerCanAnswer: value.viewer_can_answer === true,
    filledSinceApproval: (Array.isArray(value.filled_since_approval)
      ? value.filled_since_approval
      : []
    )
      .filter(isRecord)
      .map((item) => ({
        key: str(item.key),
        label: str(item.label),
        value: str(item.value),
        filledBy: str(item.filled_by),
        filledAt: str(item.filled_at),
      })),
    suggestedStandard: isRecord(value.suggested_standard)
      ? {
          libraryKey: str(value.suggested_standard.library_key),
          controlRef: str(value.suggested_standard.control_ref),
          title: str(value.suggested_standard.title),
          status:
            value.suggested_standard.status === "STRONG" ? "STRONG" : "PARTIAL",
          rationale: str(value.suggested_standard.rationale),
        }
      : null,
    changesSinceApproval: (Array.isArray(value.changes_since_approval)
      ? value.changes_since_approval
      : []
    )
      .filter(isRecord)
      .map((item) => ({
        section: str(item.section),
        code: str(item.code),
        change: oneOf(item.change, ["ADDED", "REMOVED", "CHANGED"], "CHANGED"),
        detail: str(item.detail),
      })),
  };
}

const SLOT_KEY = /^[a-z][a-z0-9-]{1,40}$/;

function parseOpenValues(value: unknown): OpenValue[] {
  return records(value)
    .filter((item) => SLOT_KEY.test(str(item.key)))
    .map((item) => ({
      key: str(item.key),
      label: str(item.label),
      why: str(item.why),
      example: str(item.example),
      blocks: item.blocks === true,
      options: strings(item.options).slice(0, 6),
      question: str(item.question),
      hint: str(item.hint),
    }));
}

/** One question across the plans shown: a client value, asked once per system, with
 * every control on that system that asks for it. One answer fills them all. */
export type ValueQuestion = OpenValue & {
  /** The system it is asked for; "" for controls on no system. */
  system: string;
  controls: Array<{ id: string; ref: string; title: string }>;
};

/** The client values one plan asks for, as the answer dialog asks them. */
export function planQuestions(plan: MasterPlan): ValueQuestion[] {
  return plan.openValues.map((item) => ({
    ...item,
    system: plan.control.application,
    controls: [
      {
        id: plan.controlId,
        ref: plan.control.controlRef,
        title: plan.control.title,
      },
    ],
  }));
}

const wording = (text: string): string =>
  text
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

/** The open value a placeholder in the plan's text stands for: the text in brackets is
 * the value's label (the statement shows a value not recorded yet that way). */
export function openValueFor(
  values: readonly OpenValue[],
  placeholder: string,
): OpenValue | undefined {
  const wanted = wording(placeholder);
  return values.find((item) => wording(item.label) === wanted);
}

/** The open value a missing fact waits for: the first placeholder in it that one stands
 * for. */
export function missingValueOf(
  fact: Pick<Fact, "basis" | "value">,
  values: readonly OpenValue[],
): OpenValue | undefined {
  if (fact.basis !== "MISSING") {
    return undefined;
  }
  for (const part of statementParts(fact.value)) {
    const found = part.placeholder
      ? openValueFor(values, part.text)
      : undefined;
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** The client values the given plans ask for, one question per system (and units, for a
 * control split by them: each entity answers for itself) and value, the systems and then
 * the values in order. */
export function valueQuestions(rows: readonly QueueRow[]): ValueQuestion[] {
  const found = new Map<string, ValueQuestion>();
  for (const row of rows) {
    const where = implementationName(row.application, row.units);
    for (const item of row.openValues) {
      const id = `${where}\u0000${item.key}`;
      const question = found.get(id) ?? {
        ...item,
        system: where,
        controls: [],
      };
      question.blocks = question.blocks || item.blocks;
      question.controls.push({
        id: row.controlId,
        ref: row.controlRef,
        title: row.title,
      });
      found.set(id, question);
    }
  }
  return [...found.values()].sort(
    (a, b) =>
      (a.system || "~").localeCompare(b.system || "~") ||
      Number(b.blocks) - Number(a.blocks) ||
      a.label.localeCompare(b.label),
  );
}

/** The answers given, as the values each control is filled with (one call). */
export function valuesItems(
  questions: readonly ValueQuestion[],
  answers: Record<string, string>,
  idOf: (question: ValueQuestion) => string,
): Array<{ control_id: string; values: Record<string, string> }> {
  const byControl = new Map<string, Record<string, string>>();
  for (const question of questions) {
    const answer = (answers[idOf(question)] ?? "").trim();
    if (answer === "") {
      continue;
    }
    for (const control of question.controls) {
      const values = byControl.get(control.id) ?? {};
      values[question.key] = answer;
      byControl.set(control.id, values);
    }
  }
  return [...byControl.entries()].map(([control_id, values]) => ({
    control_id,
    values,
  }));
}

// Reading a plan

/** The codes an item links to, across the sections: a procedure's attributes and
 * evidence, an attribute's procedures and evidence, a requirement's attributes and
 * procedures. Empty for an unknown code. */
export function related(plan: MasterPlan, code: string): Set<string> {
  const found = new Set<string>();
  const add = (codes: string[]) => {
    for (const item of codes) {
      found.add(item);
    }
  };
  const procedure = plan.procedures.find((item) => item.code === code);
  if (procedure !== undefined) {
    add(procedure.attributeCodes);
    add(procedure.evidenceCodes);
  }
  const attribute = plan.attributes.find((item) => item.code === code);
  if (attribute !== undefined) {
    add(attribute.procedureCodes);
    add(attribute.evidenceCodes);
  }
  const evidence = plan.evidence.find((item) => item.code === code);
  if (evidence !== undefined) {
    add(evidence.attributeCodes);
    add(evidence.procedureCodes);
  }
  return found;
}

/** Which section a code belongs to: A attributes, E evidence, D/I/R procedures. */
export function tabOfCode(code: string): Tab | null {
  if (/^A\d+$/.test(code)) {
    return "attributes";
  }
  if (/^E\d+$/.test(code)) {
    return "evidence";
  }
  if (/^[DIR]\d+$/.test(code)) {
    return "procedures";
  }
  return null;
}

/** Findings by the code of the item they are about. */
/** What resolves a finding, and the control that does it on the plan: the row's link
 * editor, its criteria, planning the control again with the rules, or the control's own
 * record (its attributes, or the test basis on its Design tab). */
export type FindingAction =
  | "links"
  | "criteria"
  | "replan"
  | "procedures"
  | "evidence"
  | "attributes"
  | "basis"
  | null;

export type FindingFix = { hint: string; action: FindingAction; label: string };

export function findingFix(kind: string, approved: boolean): FindingFix {
  const fix = (hint: string, action: FindingAction, label: string) => ({
    hint,
    action,
    label,
  });
  switch (kind) {
    case "ATTRIBUTE_WITHOUT_PROCEDURE":
      return approved
        ? fix(
            "Link it from the procedure that tests it; the plan then goes back for approval.",
            "procedures",
            "Open the procedures",
          )
        : fix(
            "Planning the control again with the rules links it, or link it from the procedure that tests it.",
            "replan",
            "Plan again with the rules",
          );
    case "ATTRIBUTE_WITHOUT_EVIDENCE":
      return approved
        ? fix(
            "Link it from the evidence that supports it; the plan then goes back for approval.",
            "evidence",
            "Open the evidence",
          )
        : fix(
            "Planning the control again with the rules links it, or link it from the evidence that supports it.",
            "replan",
            "Plan again with the rules",
          );
    case "PROCEDURE_WITHOUT_ATTRIBUTE":
      return fix(
        "Link the attributes this procedure tests.",
        "links",
        "Edit links",
      );
    case "EVIDENCE_WITHOUT_ATTRIBUTE":
      return fix(
        "Link the attributes this evidence supports.",
        "links",
        "Edit links",
      );
    case "UNMATCHED_ATTRIBUTE":
      return fix(
        "Link the attribute it supports in its place.",
        "links",
        "Edit links",
      );
    case "ATTRIBUTE_WITHOUT_CRITERIA":
      return fix(
        "State when it passes and when it fails, or mark it as needing professional judgment.",
        "criteria",
        "Add criteria",
      );
    case "ATTRIBUTE_NOT_DOCUMENTED":
      return fix(
        "Confirm it with the control owner and record where it is stated.",
        "attributes",
        "Open the control's attributes",
      );
    case "DEVIATES_FROM_STANDARD":
      return fix(
        "Keep the standard's wording, or choose a customized standard as the test basis.",
        "basis",
        "Change the test basis",
      );
    default:
      return fix("", null, "");
  }
}

export function findingsByCode(plan: MasterPlan): Map<string, Finding[]> {
  const found = new Map<string, Finding[]>();
  for (const item of plan.findings) {
    found.set(item.code, [...(found.get(item.code) ?? []), item]);
  }
  return found;
}

/** How many items each section holds, and how many need a look (findings, or missing
 * facts in the understanding). */
export function tabCounts(
  plan: MasterPlan,
): Record<Tab, { items: number; attention: number }> {
  const flagged = findingsByCode(plan);
  const attention = (codes: string[]) =>
    codes.filter((code) => flagged.has(code)).length;
  return {
    understanding: {
      items: plan.facts.length,
      attention: plan.facts.filter((fact) => fact.basis === "MISSING").length,
    },
    procedures: {
      items: plan.procedures.length,
      attention: attention(plan.procedures.map((item) => item.code)),
    },
    attributes: {
      items: plan.attributes.length,
      attention: attention(plan.attributes.map((item) => item.code)),
    },
    evidence: {
      items: plan.evidence.length,
      attention: attention(plan.evidence.map((item) => item.code)),
    },
  };
}

/** What stops approval right now, if anything: the first blocker that holds it. */
export function approvalHeldBy(plan: MasterPlan): string | null {
  if (plan.planId === null) {
    return "The control has no test plan yet.";
  }
  return plan.blockers.find((item) => item.blocks)?.detail ?? null;
}

/** The control's place in the queue: the previous and next controls, and the next one
 * that waits for a reviewer after it. */
export function neighbours(
  queue: Queue | null,
  controlId: string,
): {
  previous: string | null;
  next: string | null;
  nextPending: string | null;
  index: number;
} {
  const rows = queue?.controls ?? [];
  const index = rows.findIndex((row) => row.controlId === controlId);
  const waiting = new Set<PlanningState>([
    "PENDING_REVIEW",
    "DRAFT_READY",
    "NEEDS_CLARIFICATION",
  ]);
  const after =
    index < 0 ? rows : [...rows.slice(index + 1), ...rows.slice(0, index)];
  return {
    previous: index > 0 ? (rows[index - 1]?.controlId ?? null) : null,
    next:
      index >= 0 && index < rows.length - 1
        ? (rows[index + 1]?.controlId ?? null)
        : null,
    nextPending: after.find((row) => waiting.has(row.state))?.controlId ?? null,
    index,
  };
}

/** The queue rows shown under a filter of states (all when none). */
/**
 * The queue's filters beyond the state: each is one value, or "" for any. A control on no
 * system (a business process or entity-level control) matches the system "None".
 */
export const QUEUE_FILTERS = [
  "system",
  "process",
  "category",
  "key",
  "nature",
  "frequency",
  "basis",
] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];
export type QueueFilters = Record<QueueFilter, string>;
export const NO_FILTERS: QueueFilters = {
  system: "",
  process: "",
  category: "",
  key: "",
  nature: "",
  frequency: "",
  basis: "",
};
export const FILTER_LABELS: Record<QueueFilter, string> = {
  system: "System",
  process: "Process",
  category: "Control type",
  key: "Key control",
  nature: "Nature",
  frequency: "Frequency",
  basis: "Test basis",
};
export const NO_SYSTEM = "None";

const BASIS_WORDS: Record<string, string> = {
  STANDARD: "Standard",
  CUSTOM: "Customized standard",
  CLIENT: "Client's procedures",
};

/** A row's value for a filter: what the filter compares and what the option shows. */
function filterValue(row: QueueRow, filter: QueueFilter): string {
  switch (filter) {
    case "system":
      return row.application || NO_SYSTEM;
    case "process":
      return row.process;
    case "category":
      return row.category;
    case "key":
      return row.keyControl ? "KEY" : "NON_KEY";
    case "nature":
      return row.nature;
    case "frequency":
      return row.frequency;
    case "basis":
      return row.testBasis;
  }
}

/** How an option reads. */
export function filterOptionLabel(filter: QueueFilter, value: string): string {
  switch (filter) {
    case "category":
      return CATEGORY_WORDS[value as ControlCategory] ?? value;
    case "key":
      return value === "KEY" ? "Key controls" : "Non-key controls";
    case "nature":
      return NATURE_LABELS[value] ?? value;
    case "frequency":
      return FREQUENCY_LABELS[value] ?? value;
    case "basis":
      return BASIS_WORDS[value] ?? value;
    default:
      return value;
  }
}

/**
 * Each filter's options, from the rows themselves, with how many controls each matches
 * given the other filters applied (so a choice never leads to an empty list it could not
 * show). A filter with fewer than two values across the queue is left out.
 */
export function filterOptions(
  rows: readonly QueueRow[],
  filters: QueueFilters,
): Array<{
  filter: QueueFilter;
  options: Array<{ value: string; label: string; count: number }>;
}> {
  const found: Array<{
    filter: QueueFilter;
    options: Array<{ value: string; label: string; count: number }>;
  }> = [];
  for (const filter of QUEUE_FILTERS) {
    const every = new Set(rows.map((row) => filterValue(row, filter)));
    every.delete("");
    if (every.size < 2) {
      continue;
    }
    const others = { ...filters, [filter]: "" };
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (matches(row, others)) {
        const value = filterValue(row, filter);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    const options = [...every]
      .map((value) => ({
        value,
        label: filterOptionLabel(filter, value),
        count: counts.get(value) ?? 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    found.push({ filter, options });
  }
  return found;
}

function matches(row: QueueRow, filters: QueueFilters): boolean {
  return QUEUE_FILTERS.every(
    (filter) =>
      filters[filter] === "" || filterValue(row, filter) === filters[filter],
  );
}

/** How many of the filters are set. */
export function activeFilters(filters: QueueFilters): QueueFilter[] {
  return QUEUE_FILTERS.filter((filter) => filters[filter] !== "");
}

export function filterQueue(
  rows: QueueRow[],
  states: readonly PlanningState[],
  search: string,
  filters: QueueFilters = NO_FILTERS,
): QueueRow[] {
  const words = search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (states.length === 0 || states.includes(row.state)) &&
      matches(row, filters) &&
      (words === "" ||
        `${row.controlRef} ${row.title} ${row.application} ${row.units} ${row.process}`
          .toLowerCase()
          .includes(words)),
  );
}

// Addresses

/** The standard's procedure on the Library, at its numbered steps. */
export function standardStepsHref(
  organizationId: string,
  projectId: string,
  libraryKey: string,
  procedureKey: string,
): string {
  const base = libraryHref(organizationId, projectId, {
    control: libraryKey,
    tab: "procedures",
  });
  return `${base}#lb-proc-${procedureKey}`;
}

export function planningHref(
  organizationId: string,
  projectId: string,
  options: {
    control?: string | null;
    tab?: Tab | null;
    filter?: string | null;
    /** phases: release by phase; each: every plan on its own (the review queue); none:
     * the plans by control (shared plans, the default). */
    view?: "plans" | "phases" | "each" | null;
    /** The destination the link stays in: the legacy Test plans page, or the Testing
     * destination's Plans and Phases views (M2b). */
    section?: "planning" | "testing" | null | undefined;
  } = {},
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    section: options.section ?? "testing",
  });
  if (options.control) {
    params.set("control", options.control);
  }
  if (options.tab && options.tab !== "understanding") {
    params.set("tab", options.tab);
  }
  if (options.filter) {
    params.set("filter", options.filter);
  }
  if (options.view === "phases" || options.view === "each") {
    params.set("view", options.view);
  }
  return `/?${params.toString()}`;
}

export function parseTab(value: string | null): Tab {
  return oneOf(value, TABS, "understanding");
}

// Actions

export type PlanningIntent =
  | "approve-family"
  | "scope-unit-add"
  | "coverage"
  | "split"
  | "values-many"
  | "approve"
  | "request-changes"
  | "submit"
  | "revision"
  | "procedure-add"
  | "procedure-edit"
  | "procedure-remove"
  | "procedure-links"
  | "evidence-edit"
  | "evidence-links"
  | "criteria"
  | "batch-approve"
  | "replan"
  | "replan-control"
  | "facts"
  | "use-standard"
  | "phase-release"
  | "phase-release-batch";

export type PlanningWrite =
  | { error: "invalid" }
  | {
      intent: PlanningIntent;
      method: "POST" | "PUT";
      path: string;
      body: Record<string, unknown>;
      /** Planning again runs the planner over every control: it gets longer. */
      slow: boolean;
    };

type Fields = Record<string, unknown>;
const text = (fields: Fields, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string).trim() : "";
const versionOf = (fields: Fields): number | null => {
  const value = Number(fields.version);
  return Number.isInteger(value) && value >= 1 ? value : null;
};
const ids = (fields: Fields, name: string): string[] | null => {
  const value = fields[name];
  if (!Array.isArray(value) || value.length > 30) {
    return null;
  }
  return value.every((item) => typeof item === "string" && UUID.test(item))
    ? [...new Set(value as string[])]
    : null;
};
const clean = (value: string, min: number, max: number): boolean =>
  value.length >= min && value.length <= max && !SECRET.test(value);

/** The API call for one action, checked before it is sent. */
export function planningWrite(fields: Fields): PlanningWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const intent = text(fields, "intent") as PlanningIntent;
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}`;
  const ok = (
    path: string,
    body: Record<string, unknown> = {},
    method: "POST" | "PUT" = "POST",
    slow = false,
  ): PlanningWrite => ({ intent, method, path, body, slow });
  if (intent === "values-many") {
    // Client values for several controls at once (context_routes.set_many_values).
    const items = Array.isArray(fields.items) ? fields.items : [];
    if (items.length === 0 || items.length > 300) {
      return { error: "invalid" };
    }
    const checked: Array<{
      control_id: string;
      values: Record<string, string>;
    }> = [];
    for (const item of items) {
      if (
        !isRecord(item) ||
        typeof item.control_id !== "string" ||
        !UUID.test(item.control_id) ||
        !isRecord(item.values)
      ) {
        return { error: "invalid" };
      }
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(item.values)) {
        if (
          !SLOT_KEY.test(key) ||
          typeof value !== "string" ||
          !clean(value.trim(), 1, 300)
        ) {
          return { error: "invalid" };
        }
        values[key] = value.trim();
      }
      if (Object.keys(values).length === 0 || Object.keys(values).length > 40) {
        return { error: "invalid" };
      }
      checked.push({ control_id: item.control_id, values });
    }
    return ok(`${base}/control-values`, { items: checked }, "PUT");
  }
  if (intent === "replan") {
    return ok(`${base}/evidence-plans/replan`, {}, "POST", true);
  }
  if (intent === "facts") {
    // Facts the team states for a client's own control (master_plans.state_facts).
    const control = text(fields, "control_id");
    const given = isRecord(fields.facts) ? fields.facts : {};
    const facts: Record<string, string> = {};
    for (const [key, value] of Object.entries(given)) {
      if (
        !STATEABLE_FACTS.includes(key as StateableFact) ||
        typeof value !== "string" ||
        value.length > 600
      ) {
        return { error: "invalid" };
      }
      facts[key] = value;
    }
    return UUID.test(control) && Object.keys(facts).length > 0
      ? ok(`${base}/controls/${control}/master-plan/facts`, { facts }, "PUT")
      : { error: "invalid" };
  }
  if (intent === "use-standard") {
    // Follow the standard a client's control matches as a customized standard: its
    // attributes are proposed for the control (library_matching.decide_basis).
    const control = text(fields, "control_id");
    const key = text(fields, "library_key");
    return UUID.test(control) && /^[a-z0-9][a-z0-9-]{1,59}$/.test(key)
      ? ok(
          `${base}/controls/${control}/test-basis`,
          { basis: "CUSTOM", library_key: key, note: "" },
          "PUT",
          true,
        )
      : { error: "invalid" };
  }
  if (intent === "replan-control") {
    const control = text(fields, "control_id");
    return UUID.test(control)
      ? ok(`${base}/controls/${control}/master-plan/replan`, {}, "POST", true)
      : { error: "invalid" };
  }
  if (intent === "phase-release-batch") {
    const phase = text(fields, "phase");
    const reason = text(fields, "reason");
    const listed = Array.isArray(fields.control_ids) ? fields.control_ids : [];
    const controls = listed.filter(
      (item): item is string => typeof item === "string" && UUID.test(item),
    );
    return (phase === "INTERIM" || phase === "ROLLFORWARD") &&
      controls.length > 0 &&
      controls.length <= 200 &&
      controls.length === listed.length &&
      clean(reason, 0, 1000)
      ? ok(`${base}/phases/release`, {
          phase,
          control_ids: [...new Set(controls)],
          reason,
        })
      : { error: "invalid" };
  }
  if (intent === "approve-family") {
    // One decision for every implementation whose plan is the control's shared plan
    // (shared_plans.approve_group); the API checks it against what was shown.
    const body = groupApproveBody(fields);
    return body === null
      ? { error: "invalid" }
      : ok(`${base}/planning-review/families/approve`, body);
  }
  if (intent === "scope-unit-add") {
    const kind = text(fields, "kind");
    const name = text(fields, "name").trim();
    return (UNIT_KINDS as readonly string[]).includes(kind) &&
      clean(name, 1, 200)
      ? ok(`${base}/scope-units`, { kind, name })
      : { error: "invalid" };
  }
  if (intent === "coverage" || intent === "split") {
    const control = text(fields, "control_id");
    const listed = Array.isArray(fields.unit_ids) ? fields.unit_ids : [];
    const units = listed.filter(
      (item): item is string => typeof item === "string" && UUID.test(item),
    );
    if (!UUID.test(control) || units.length !== listed.length) {
      return { error: "invalid" };
    }
    if (intent === "coverage") {
      return units.length <= 200
        ? ok(`${base}/controls/${control}/coverage`, {
            unit_ids: [...new Set(units)],
          })
        : { error: "invalid" };
    }
    const reason = text(fields, "reason").trim();
    return units.length >= 2 && units.length <= 50 && clean(reason, 10, 1000)
      ? ok(
          `${base}/controls/${control}/split`,
          { unit_ids: [...new Set(units)], reason },
          "POST",
          true,
        )
      : { error: "invalid" };
  }
  if (intent === "batch-approve") {
    const items = Array.isArray(fields.items) ? fields.items : [];
    const comment = text(fields, "comment");
    const checked = items.filter(
      (item): item is { control_id: string; version: number } =>
        isRecord(item) &&
        typeof item.control_id === "string" &&
        UUID.test(item.control_id) &&
        Number.isInteger(item.version) &&
        Number(item.version) >= 1,
    );
    return checked.length === 0 ||
      checked.length !== items.length ||
      checked.length > 100 ||
      !clean(comment, 0, 4000)
      ? { error: "invalid" }
      : ok(`${base}/planning-review/approve`, {
          items: checked.map((item) => ({
            control_id: item.control_id,
            version: item.version,
          })),
          comment,
        });
  }
  const controlId = text(fields, "control_id");
  if (!UUID.test(controlId)) {
    return { error: "invalid" };
  }
  const control = `${base}/controls/${controlId}`;
  const at = versionOf(fields);
  switch (intent) {
    case "phase-release": {
      const phase = text(fields, "phase");
      const reason = text(fields, "reason");
      return (phase === "INTERIM" || phase === "ROLLFORWARD") &&
        clean(reason, 0, 1000)
        ? ok(`${control}/phases/${phase}/release`, { reason })
        : { error: "invalid" };
    }
    case "approve": {
      const comment = text(fields, "comment");
      // Client values answered with the approval (control_design.set_values).
      const raw = isRecord(fields.values) ? fields.values : {};
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (
          !SLOT_KEY.test(key) ||
          typeof value !== "string" ||
          !clean(value.trim(), 1, 300)
        ) {
          return { error: "invalid" };
        }
        values[key] = value.trim();
      }
      if (Object.keys(values).length > 40) {
        return { error: "invalid" };
      }
      return at !== null && clean(comment, 0, 4000)
        ? ok(`${control}/evidence-plan/approve`, {
            version: at,
            comment,
            ...(Object.keys(values).length > 0
              ? { values, everywhere: fields.everywhere === true }
              : {}),
          })
        : { error: "invalid" };
    }
    case "request-changes": {
      const comment = text(fields, "comment");
      return at !== null && clean(comment, 10, 4000)
        ? ok(`${control}/evidence-plan/request-changes`, {
            version: at,
            comment,
          })
        : { error: "invalid" };
    }
    case "submit": {
      const note = text(fields, "note");
      return at !== null && clean(note, 0, 2000)
        ? ok(`${control}/evidence-plan/submit`, { version: at, note })
        : { error: "invalid" };
    }
    case "revision": {
      const decision = text(fields, "decision");
      return at !== null && (decision === "ACCEPT" || decision === "DISMISS")
        ? ok(`${control}/evidence-plan/pending-revision`, {
            version: at,
            decision,
          })
        : { error: "invalid" };
    }
    case "procedure-add": {
      const phase = text(fields, "phase");
      const body = text(fields, "text");
      const method = text(fields, "method");
      const attributes = ids(fields, "attribute_ids") ?? null;
      return (PHASES as readonly string[]).includes(phase) &&
        clean(body, 10, 1000) &&
        (method === "" || (METHODS as readonly string[]).includes(method)) &&
        attributes !== null
        ? ok(`${control}/master-plan/procedures`, {
            phase,
            text: body,
            method: method === "" ? null : method,
            attribute_ids: attributes,
          })
        : { error: "invalid" };
    }
    case "procedure-edit": {
      const procedureId = text(fields, "procedure_id");
      const body = text(fields, "text");
      const method = text(fields, "method");
      return UUID.test(procedureId) &&
        at !== null &&
        clean(body, 10, 1000) &&
        (method === "" || (METHODS as readonly string[]).includes(method))
        ? ok(`${control}/master-plan/procedures/${procedureId}`, {
            version: at,
            text: body,
            method: method === "" ? null : method,
          })
        : { error: "invalid" };
    }
    case "procedure-remove": {
      const procedureId = text(fields, "procedure_id");
      const reason = text(fields, "reason");
      return UUID.test(procedureId) && at !== null && clean(reason, 10, 500)
        ? ok(`${control}/master-plan/procedures/${procedureId}/remove`, {
            version: at,
            reason,
          })
        : { error: "invalid" };
    }
    case "procedure-links": {
      const procedureId = text(fields, "procedure_id");
      const attributes = ids(fields, "attribute_ids");
      return UUID.test(procedureId) && attributes !== null
        ? ok(
            `${control}/master-plan/procedures/${procedureId}/attributes`,
            { attribute_ids: attributes },
            "PUT",
          )
        : { error: "invalid" };
    }
    case "evidence-edit": {
      const requirementId = text(fields, "requirement_id");
      const title = text(fields, "title");
      const description = text(fields, "description");
      return UUID.test(requirementId) &&
        at !== null &&
        clean(title, 3, 200) &&
        clean(description, 10, 1500)
        ? ok(`${control}/evidence-requirements/${requirementId}/edit`, {
            version: at,
            title,
            description,
          })
        : { error: "invalid" };
    }
    case "evidence-links": {
      const requirementId = text(fields, "requirement_id");
      const attributes = ids(fields, "attribute_ids");
      const procedures = ids(fields, "procedure_ids");
      return UUID.test(requirementId) &&
        attributes !== null &&
        procedures !== null
        ? ok(
            `${control}/master-plan/evidence/${requirementId}/links`,
            { attribute_ids: attributes, procedure_ids: procedures },
            "PUT",
          )
        : { error: "invalid" };
    }
    case "criteria": {
      const attributeId = text(fields, "attribute_id");
      const values = [
        "objective",
        "condition",
        "pass_criteria",
        "fail_criteria",
      ].map((name) => text(fields, name));
      const judgment = fields.judgment_required;
      const automatable = fields.automatable;
      const phases = Array.isArray(fields.phases)
        ? fields.phases.filter(
            (item): item is string =>
              typeof item === "string" &&
              (PHASES as readonly string[]).includes(item),
          )
        : [];
      const limits = [500, 1000, 1000, 1000];
      return UUID.test(attributeId) &&
        at !== null &&
        values.every((value, index) =>
          clean(value, 0, limits[index] ?? 1000),
        ) &&
        (judgment === null || typeof judgment === "boolean") &&
        (automatable === null || typeof automatable === "boolean")
        ? ok(`${control}/master-plan/attributes/${attributeId}/criteria`, {
            version: at,
            objective: values[0],
            condition: values[1],
            pass_criteria: values[2],
            fail_criteria: values[3],
            judgment_required: judgment,
            automatable,
            phases,
          })
        : { error: "invalid" };
    }
    default:
      return { error: "invalid" };
  }
}

/** What went wrong, in words a person can act on. The API's own sentences (what holds
 * an approval) are shown as they are. */
export function planningProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    const known: Record<string, string> = {
      "the plan changed":
        "The plan changed since this page loaded. Refresh to see the current version.",
      "the procedure changed":
        "The procedure changed since this page loaded. Refresh and try again.",
      "the requirement changed":
        "This evidence item changed since the page loaded. Refresh and try again.",
      "the request carrying it has gone for approval":
        "This item is already on a request that has gone for approval, so its wording is locked.",
      "the attribute changed":
        "The attribute changed since this page loaded. Refresh and try again.",
      "settle the control's attributes first":
        "Decide the proposed attributes and settle any open question about them first.",
      "changes are already requested":
        "Changes were already requested on this plan.",
      "link only the control's approved attributes":
        "Only the control's approved attributes can be linked.",
      "link only the plan's own procedures":
        "Only this plan's procedures can be linked.",
      "the plan already has this procedure":
        "The plan already has this procedure.",
      "the control is out of scope": "The control is out of scope.",
      "the engagement is not running": "The engagement is not running.",
      "no revision is waiting":
        "The planner's proposed revision was already decided. Refresh to see the plan.",
    };
    if (known[detail] !== undefined) {
      return known[detail];
    }
    return /^[A-Z0-9].*\.$/.test(detail)
      ? detail
      : "This changed while you were working. Refresh and try again.";
  }
  if (status === 403) {
    return "Your role cannot make this decision. A project manager, admin, or owner approves test plans.";
  }
  if (status === 404) {
    return "This plan is not available to you.";
  }
  if (status === 422) {
    return detail === "the text must not contain credentials"
      ? "The text must not contain credentials."
      : "Check the entry: a comment or reason needs at least ten characters, within the length limits, and no credential.";
  }
  return "That could not be saved. Try again.";
}

/** A short line for a decision in the history. */
export function decisionLine(decision: Decision): string {
  const what =
    decision.decision === "APPROVED" ? "Approved" : "Changes requested";
  return `${what} revision ${decision.revision} · ${decision.decidedBy}`;
}

// Phase-based release (milestone E)

export const PHASE_STEPS = [
  "NOT_APPLICABLE",
  "AWAITING_PLAN",
  "WAITING",
  "READY",
  "RELEASED",
  "COMPLETE",
] as const;
export type PhaseStep = (typeof PHASE_STEPS)[number];

export const STEP_TONES: Record<PhaseStep, string> = {
  NOT_APPLICABLE: "tone-neutral",
  AWAITING_PLAN: "tone-neutral",
  WAITING: "tone-neutral",
  READY: "tone-warning",
  RELEASED: "tone-info",
  COMPLETE: "tone-success",
};

export type PhaseStatus = {
  phase: Phase;
  label: string;
  applicability: string | null;
  complete: boolean;
  step: PhaseStep;
  stepLabel: string;
  releasedBy: string | null;
  releasedAt: string | null;
  early: boolean;
  reason: string;
  waitingFor: string;
};

export type ControlPhases = {
  controlId: string;
  controlRef: string;
  title: string;
  application: string;
  units: string;
  planStatus: string | null;
  phases: PhaseStatus[];
};

export type PhaseProgress = {
  controls: ControlPhases[];
  ready: { INTERIM: number; ROLLFORWARD: number };
  released: { INTERIM: number; ROLLFORWARD: number };
  recommendation: string;
  viewerCanRelease: boolean;
};

function parseControlPhases(value: Json): ControlPhases {
  return {
    controlId: str(value.control_id),
    controlRef: str(value.control_ref),
    title: str(value.title),
    application: str(value.application),
    units: str(value.units),
    planStatus: strOrNull(value.plan_status),
    phases: records(value.phases).map((item) => {
      const step = oneOf(item.step, PHASE_STEPS, "WAITING");
      return {
        phase: phaseOf(item.phase),
        label: str(item.label),
        applicability: strOrNull(item.applicability),
        complete: item.complete === true,
        step,
        stepLabel: str(item.step_label) || step,
        releasedBy: strOrNull(item.released_by),
        releasedAt: strOrNull(item.released_at),
        early: item.early === true,
        reason: str(item.reason),
        waitingFor: str(item.waiting_for),
      };
    }),
  };
}

export function parsePhaseProgress(value: unknown): PhaseProgress | null {
  if (!isRecord(value) || !Array.isArray(value.controls)) {
    return null;
  }
  const count = (group: unknown, phase: string) =>
    isRecord(group) ? num(group[phase]) : 0;
  return {
    controls: records(value.controls).map(parseControlPhases),
    ready: {
      INTERIM: count(value.ready, "INTERIM"),
      ROLLFORWARD: count(value.ready, "ROLLFORWARD"),
    },
    released: {
      INTERIM: count(value.released, "INTERIM"),
      ROLLFORWARD: count(value.released, "ROLLFORWARD"),
    },
    recommendation: str(value.recommendation),
    viewerCanRelease: value.viewer_can_release === true,
  };
}

/** A control's phase, or null. */
export function phaseStatus(
  row: ControlPhases | undefined,
  phase: Phase,
): PhaseStatus | null {
  return row?.phases.find((item) => item.phase === phase) ?? null;
}

/** Whether releasing the phase now is early: anything but ready needs a reason. */
export function releaseIsEarly(status: PhaseStatus): boolean {
  return status.step !== "READY";
}

/** Whether the phase can be released at all now: it applies, the plan is approved, and it
 * is not released or complete yet. */
export function releasable(status: PhaseStatus | null): boolean {
  return (
    status !== null &&
    status.phase !== "DESIGN" &&
    (status.step === "READY" || status.step === "WAITING")
  );
}

/** The phase a reviewer releases next: the first, in the audit's order, that can be
 * released now. Null when none can. */
export function nextRelease(
  phases: readonly PhaseStatus[],
): PhaseStatus | null {
  return phases.find((status) => releasable(status)) ?? null;
}

/** Where a phase stands, in a few plain words, under its segment. */
export function phaseNote(status: PhaseStatus): string {
  if (status.step === "RELEASED" || status.step === "COMPLETE") {
    return `${status.stepLabel}${status.early ? " early" : ""}`;
  }
  if (status.step === "WAITING" && status.waitingFor !== "") {
    return status.waitingFor;
  }
  return status.stepLabel;
}

// What holds approval, as work to do

const HOLD_WORDS: Record<BlockerResolve, { title: string; action: string }> = {
  WAIT: { title: "The planner is still drafting this plan", action: "" },
  REVISION: {
    title: "Accept or dismiss the planner's revision",
    action: "",
  },
  LIBRARY: {
    title: "The standard this plan follows awaits methodology review",
    action: "Open the standard",
  },
  CONTROL: {
    title: "Complete the control's description and frequency",
    action: "Open the control",
  },
  ATTRIBUTES: {
    title: "Settle the control's attributes",
    action: "Open the attributes",
  },
  PROCESS: {
    title: "Confirm how the process runs",
    action: "Open the process",
  },
  EVIDENCE_CHANGES: {
    title: "Decide the proposed changes to the evidence",
    action: "Review the changes",
  },
  FACTS: {
    title: "Describe the control",
    action: "Describe the control",
  },
  VALUES: {
    title: "Record the client's values",
    action: "Record the values",
  },
  PHASES: {
    title: "Decide which test phases apply",
    action: "Open the planning basis",
  },
  UNDERSTANDING: {
    title: "Check what the plan assumes",
    action: "Read the understanding",
  },
};

export type HoldGroup = {
  resolve: BlockerResolve;
  /** Approval is refused until it is resolved. */
  blocks: boolean;
  title: string;
  /** The button's words; "" where the work is done elsewhere on this page or waits. */
  action: string;
  items: string[];
  /** The standard the group is about (resolve LIBRARY). */
  target: string;
};

/**
 * What stands in the way of approving the plan, as work: the blockers gathered by where
 * each is resolved, what holds approval first, each with what to do and where. The
 * reviewer reads one line of work per place instead of every finding.
 */
export function holdGroups(blockers: readonly Blocker[]): HoldGroup[] {
  const groups: HoldGroup[] = [];
  for (const blocks of [true, false]) {
    for (const resolve of BLOCKER_RESOLVES) {
      const matching = blockers.filter(
        (item) => item.blocks === blocks && item.resolve === resolve,
      );
      if (matching.length > 0) {
        groups.push({
          resolve,
          blocks,
          ...HOLD_WORDS[resolve],
          items: matching.map((item) => item.detail),
          target: matching[0]?.target ?? "",
        });
      }
    }
  }
  return groups;
}

/**
 * Where a hold is resolved, on the control's record: the part of its Test plan tab that
 * holds the decision, or its evidence. Null for what is done on the review itself (the
 * revision, the understanding) or waits on the planner.
 */
export function holdHref(
  ids: { organizationId: string; projectId: string },
  controlId: string,
  resolve: BlockerResolve,
  target = "",
): string | null {
  const record = (tab: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({
      organization: ids.organizationId,
      project: ids.projectId,
      section: "controls",
      control: controlId,
      tab,
      ...extra,
    });
    return `/?${params.toString()}`;
  };
  switch (resolve) {
    case "CONTROL":
      return record("design");
    case "ATTRIBUTES":
      return `${record("design")}#step-definition-and-attributes`;
    case "PROCESS":
      return `${record("design")}#step-process-understanding`;
    case "VALUES":
      return `${record("design")}#step-control-statement`;
    case "PHASES":
      return record("evidence", { ev: "plan" });
    case "EVIDENCE_CHANGES":
      return record("evidence", { ev: "requirements" });
    case "LIBRARY":
      return target === ""
        ? null
        : libraryHref(ids.organizationId, ids.projectId, { control: target });
    default:
      return null;
  }
}

import { FREQUENCY_LABELS, NATURE_LABELS } from "./control-context-model.ts";
import { libraryHref } from "./library-model.ts";

/** What the plan is built from, for the review's header: the standard it follows, the
 * standard tailored, or the client's own procedures. */
export function basisWords(control: MasterPlan["control"]): string {
  if (control.testBasis === "CLIENT") {
    return control.source === "LIBRARY"
      ? "Client's procedures"
      : "Client's own procedures";
  }
  const standard = control.libraryRef !== "" ? ` ${control.libraryRef}` : "";
  return control.testBasis === "CUSTOM"
    ? `Customized standard${standard}`
    : `Standard${standard}`;
}

/** The same question open for other systems: one value, asked of each system's controls,
 * answered once and used for all where the answer is the same. */
export function otherSystems(
  question: ValueQuestion,
  all: readonly ValueQuestion[],
): ValueQuestion[] {
  return all.filter(
    (item) => item.key === question.key && item.system !== question.system,
  );
}

/** What a save covers: the questions shown, and any other question given an answer (one
 * copied from a question shown, for another system the filters hide). */
export function questionsToSave(
  shown: readonly ValueQuestion[],
  all: readonly ValueQuestion[],
  answers: Record<string, string>,
  idOf: (question: ValueQuestion) => string,
): ValueQuestion[] {
  const ids = new Set(shown.map(idOf));
  return [
    ...shown,
    ...all.filter(
      (item) =>
        !ids.has(idOf(item)) && (answers[idOf(item)] ?? "").trim() !== "",
    ),
  ];
}

/** A plan's one next step in the queue, in a few words. */
export type NextStep = {
  kind: "held" | "answer" | "decide" | "review" | "ready" | "none";
  label: string;
  /** The whole of what holds approval, for the step's hover text. */
  detail: string;
};

const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** What holds a plan, as a short action of a few words (the whole reason stays in the
 * step's detail). The reasons are master_plans.blockers_of's. */
export function heldStep(reason: string): string {
  const text = reason.trim();
  const count = (pattern: RegExp, one: string, many: string): string | null => {
    const found = pattern.exec(text);
    if (found === null) {
      return null;
    }
    const n = Number(found[1]);
    return `${n} ${n === 1 ? one : many}`;
  };
  const attributes = count(
    /^(\d+) proposed attributes? waits?/i,
    "attribute",
    "attributes",
  );
  if (attributes !== null) {
    return `Decide ${attributes}`;
  }
  const changes = count(
    /^(\d+) proposed changes? to the evidence/i,
    "evidence change",
    "evidence changes",
  );
  if (changes !== null) {
    return `Decide ${changes}`;
  }
  const known: Array<[RegExp, string]> = [
    [/planner is still drafting/i, "Planner drafting"],
    [/planner proposed a revised/i, "Review planner's revision"],
    [/^control design to confirm/i, "Confirm control design"],
    [/no description of what is done/i, "Describe the control"],
    [/frequency is not set/i, "Set the frequency"],
    [/no test attributes/i, "Add test attributes"],
  ];
  const match = known.find(([pattern]) => pattern.test(text));
  if (match !== undefined) {
    return match[1];
  }
  // Another issue: its own heading when it is short, else a plain word for it.
  const heading = (text.split(":")[0] ?? text).trim().replace(/\.$/, "");
  return heading.length <= 32 ? heading : "Resolve open issue";
}

/**
 * The step a plan waits for, most pressing first: what holds its approval, then the
 * client values to answer, the proposals to decide, the rest to review; else it is ready
 * to approve. Whatever the step leaves open is listed as counts.
 */
export function nextStepOf(row: QueueRow): NextStep {
  const step = (
    kind: NextStep["kind"],
    label: string,
    detail = "",
  ): NextStep => ({
    kind,
    label,
    detail,
  });
  if (row.state === "APPROVED") {
    return step("none", "Nothing open");
  }
  if (row.heldBy !== "") {
    return step("held", heldStep(row.heldBy), row.heldBy);
  }
  const values = row.openValues.length;
  if (values > 0) {
    return step(
      "answer",
      `Answer ${counted(values, "client value", "client values")}`,
    );
  }
  if (row.decisions > 0) {
    return step(
      "decide",
      `Decide ${counted(row.decisions, "proposal", "proposals")}`,
    );
  }
  const items = row.otherQuestions + row.findings;
  if (items > 0) {
    return step(
      "review",
      `Review ${counted(items, "open item", "open items")}`,
    );
  }
  if (row.state === "ANALYZING" || row.state === "NOT_STARTED") {
    return step("none", "Being planned");
  }
  return step(
    "ready",
    row.revisedSinceApproval ? "Re-approve the changes" : "Ready to approve",
  );
}
