/**
 * Master test plans (milestones A to C): the engagement's planning review queue
 * (GET …/planning-review) and one control's plan in four sections
 * (GET …/controls/{id}/master-plan): its understanding, procedures, attributes, and
 * required evidence, linked by code. The actions a reviewer or preparer takes are checked
 * here before they reach the API, which checks again. Nothing here decides whether a plan
 * may be approved: the API says what holds it.
 */

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
  state: PlanningState;
  revision: number;
  approvedRevision: number | null;
  revisedSinceApproval: boolean;
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
};

export type Queue = {
  total: number;
  counts: Record<PlanningState, number>;
  controls: QueueRow[];
  nextControlId: string | null;
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
export type Blocker = {
  kind: "CLARIFICATION" | "DECISION";
  detail: string;
  blocks: boolean;
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
    classifications: string[];
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
};

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
    })),
    nextControlId: strOrNull(value.next_control_id),
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
      classifications: strings(control.classifications),
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
  };
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
export function filterQueue(
  rows: QueueRow[],
  states: readonly PlanningState[],
  search: string,
): QueueRow[] {
  const words = search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (states.length === 0 || states.includes(row.state)) &&
      (words === "" ||
        `${row.controlRef} ${row.title} ${row.application}`
          .toLowerCase()
          .includes(words)),
  );
}

// Addresses

export function planningHref(
  organizationId: string,
  projectId: string,
  options: {
    control?: string | null;
    tab?: Tab | null;
    filter?: string | null;
    view?: "plans" | "phases" | null;
  } = {},
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
    section: "planning",
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
  if (options.view === "phases") {
    params.set("view", "phases");
  }
  return `/?${params.toString()}`;
}

export function parseTab(value: string | null): Tab {
  return oneOf(value, TABS, "understanding");
}

// Actions

export type PlanningIntent =
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
  if (intent === "replan") {
    return ok(`${base}/evidence-plans/replan`, {}, "POST", true);
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
      return at !== null && clean(comment, 0, 4000)
        ? ok(`${control}/evidence-plan/approve`, { version: at, comment })
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
