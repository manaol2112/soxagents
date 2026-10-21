/**
 * A control's context, as the control record shows it: its classification, its
 * attributes (approved, proposed, and their history), its process understanding where it
 * depends on one, its supporting documents, the open issues, and its readiness.
 *
 * Attributes belong to the control; documents support it; evidence is judged in testing.
 * None of it needs a process narrative.
 */

export const CLASSIFICATIONS = [
  ["ITGC", "IT general control"],
  ["AUTOMATED_APPLICATION", "Automated application control"],
  ["IT_DEPENDENT_MANUAL", "IT-dependent manual control"],
  ["BUSINESS_PROCESS", "Business process control"],
  ["ENTITY_LEVEL", "Entity-level control"],
  ["KEY_REPORT", "Key report"],
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number][0];

export const DOCUMENT_KINDS = [
  ["NARRATIVE", "Process narrative"],
  ["POLICY", "Policy"],
  ["PROCEDURE", "Procedure or SOP"],
  ["FLOWCHART", "Flowchart"],
  ["WALKTHROUGH", "Walkthrough notes"],
  ["SYSTEM", "System documentation"],
  ["PRIOR_YEAR", "Prior-year workpaper"],
  ["OTHER", "Other"],
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number][0];

export type ReadinessState =
  | "READY"
  | "NEEDS_INFORMATION"
  | "PLAN_NOT_APPROVED"
  | "PROCESS_UNDERSTANDING_INCOMPLETE"
  | "EVIDENCE_PENDING"
  | "CONFLICT_REQUIRES_REVIEW"
  | "IMPACT_PENDING"
  | "READY_FOR_REVIEW"
  | "CONCLUDED";

export const READINESS_STATES: readonly ReadinessState[] = [
  "READY",
  "NEEDS_INFORMATION",
  "PLAN_NOT_APPROVED",
  "PROCESS_UNDERSTANDING_INCOMPLETE",
  "EVIDENCE_PENDING",
  "CONFLICT_REQUIRES_REVIEW",
  "IMPACT_PENDING",
  "READY_FOR_REVIEW",
  "CONCLUDED",
];

/** The states that stop testing: samples cannot be approved and the tester waits. */
export const BLOCKING_STATES: readonly ReadinessState[] = [
  "NEEDS_INFORMATION",
  "PLAN_NOT_APPROVED",
  "PROCESS_UNDERSTANDING_INCOMPLETE",
  "CONFLICT_REQUIRES_REVIEW",
];

export const STATE_LABELS: Record<ReadinessState, string> = {
  READY: "Ready to test",
  NEEDS_INFORMATION: "Needs information",
  PLAN_NOT_APPROVED: "Test plan awaiting approval",
  PROCESS_UNDERSTANDING_INCOMPLETE: "Process understanding incomplete",
  EVIDENCE_PENDING: "Evidence pending",
  CONFLICT_REQUIRES_REVIEW: "Conflict to review",
  IMPACT_PENDING: "Impact assessment pending",
  READY_FOR_REVIEW: "Ready for review",
  CONCLUDED: "Concluded",
};

export const STATE_TONES: Record<ReadinessState, string> = {
  READY: "tone-success",
  NEEDS_INFORMATION: "tone-danger",
  PLAN_NOT_APPROVED: "tone-warning",
  PROCESS_UNDERSTANDING_INCOMPLETE: "tone-warning",
  EVIDENCE_PENDING: "tone-info",
  CONFLICT_REQUIRES_REVIEW: "tone-danger",
  IMPACT_PENDING: "tone-warning",
  READY_FOR_REVIEW: "tone-info",
  CONCLUDED: "tone-success",
};

export type CheckStatus =
  | "OK"
  | "BLOCKED"
  | "WARN"
  | "PENDING"
  | "NOT_APPLICABLE";
export type Blocker = { detail: string; why: string; resolve: string };
export type ReadinessCheck = {
  key: "plan" | "criteria" | "process" | "evidence" | "scope" | "conflicts";
  title: string;
  status: CheckStatus;
  summary: string;
  blockers: Blocker[];
};
export type Readiness = {
  state: ReadinessState;
  label: string;
  processRequired: boolean;
  checks: ReadinessCheck[];
};

export type Attribute = {
  id: string;
  position: number;
  text: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "RETIRED" | "SUPERSEDED";
  basis: "DOCUMENTED" | "INFERRED";
  sourceKind: "LIBRARY" | "RCM" | "MANUAL" | "AGENT" | "DOCUMENT";
  sourceDocumentId: string | null;
  sourceTitle: string;
  sourceQuote: string;
  note: string;
  proposal: "ADD" | "CHANGE" | "RETIRE" | null;
  replacesId: string | null;
  decidedBy: string | null;
  version: number;
  /** How the attribute is tested, for a library version 3 attribute. */
  definition: AttributeDefinition | null;
};

export type Confidence = "HIGH" | "MODERATE" | "LOW" | "NOT_ESTABLISHED";
export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  HIGH: "High confidence",
  MODERATE: "Moderate confidence",
  LOW: "Low confidence",
  NOT_ESTABLISHED: "Not established",
};

export type AttributeDefinition = {
  key: string;
  confidence: Confidence;
  condition: string;
  why: string;
  evidence: string[];
  extract: string[];
  compare: string;
  passes: string;
  fails: string;
  insufficient: string;
  review: string;
  notInfer: string;
  basis: string[];
  question: string;
  blocks: boolean;
};

export type Procedure = {
  key: string;
  phase: "DESIGN" | "OPERATING" | "ROLLFORWARD";
  objective: string;
  action: string;
  evidence: string[];
  attributes: string[];
  limitation: string;
};

export const PROCEDURE_PHASES: Record<Procedure["phase"], string> = {
  DESIGN: "Design",
  OPERATING: "Operating effectiveness",
  ROLLFORWARD: "Roll-forward",
};

/** How a library control is tested under version 3. */
export type Testing = {
  version: number;
  objective: string;
  controlType: string;
  population: string;
  sampling: string;
  procedures: Procedure[];
  designConfirmation: string;
  assumptions: string[];
  questions: string[];
  notApplicable: string[];
};

export type LibraryChange = {
  change: "KEEP" | "REWORD" | "ADD" | "PROPOSE" | "RETIRE";
  key: string;
  text: string;
  was: string;
  reason: string;
  confidence: string;
};

/** What adopting the current library version would change on an older copy. */
export type LibraryUpdate = {
  libraryVersion: number;
  currentVersion: number;
  items: LibraryChange[];
  note: string;
  /** Changes to the control's own description (title, activity, risk, frequency, nature). */
  fields: Array<{ field: string; was: string; now: string }>;
  /** Controls split out of this one, added when it is adopted. */
  splits: Array<{ controlRef: string; title: string; reason: string }>;
};

/** A value only the client knows, filled at setup (milestone 8.9). */
export type DesignSlot = {
  key: string;
  label: string;
  kind: string;
  why: string;
  example: string;
  blocks: boolean;
  value: string;
  automatic: boolean;
  filledBy: string | null;
  version: number;
  /** The answers usually given, to choose from (slot_options.py). */
  options: string[];
  /** The value as a question to the client (slot_questions.py). */
  question: string;
  /** How to answer it, for whoever fills it in (slot_questions.hint_for). */
  hint: string;
};

/** The control's design, as its documentation states it, with the client's values. */
export type Design = {
  text: string;
  risk: string;
  itRisk: string;
  principle: string;
  assertions: string[];
  controlType: string;
  nature: string;
  frequency: string;
  operator: string;
  reviewer: string;
  owner: string;
  authority: string;
  judgment: string;
  judgmentNote: string;
  precision: string;
  investigation: string;
  information: Array<{
    name: string;
    kind: string;
    elements: string[];
    ipe: string;
  }>;
  itgcs: string[];
  evidence: string;
  appliesWhen: string;
  slots: DesignSlot[];
  missing: string[];
};

export const TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: "Preventive",
  DETECTIVE: "Detective",
};
export const NATURE_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  AUTOMATED: "Automated",
  IT_DEPENDENT_MANUAL: "IT-dependent manual",
};
export const FREQUENCY_LABELS: Record<string, string> = {
  ANNUAL: "Annual",
  QUARTERLY: "Quarterly",
  MONTHLY: "Monthly",
  WEEKLY: "Weekly",
  DAILY: "Daily",
  RECURRING: "Each transaction",
  EVENT_DRIVEN: "Each occurrence",
};

export type ContextIssue = {
  id: string;
  origin: "ATTRIBUTES" | "PROCESS" | "SOURCES";
  kind: "MISSING" | "AMBIGUOUS" | "CONFLICT";
  topic: string;
  detail: string;
  why: string;
  resolve: string;
  quotes: Array<{ source: string; title: string; quote: string }>;
  raisedBy: "AGENT" | "RULES";
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolutionNote: string;
  version: number;
};

export type SupportingDocument = {
  id: string;
  kind: DocumentKind;
  title: string;
  fileName: string;
  origin: "UPLOAD" | "WRITTEN" | "AGENT";
  characters: number;
  excerpt: string;
  createdBy: string | null;
  controlIds: string[];
  reviewed: boolean;
};

export type StepBasis = "DOCUMENTED" | "INFERRED" | "TEAM";
export type ProcessStep = {
  key: string;
  description: string;
  actor: string;
  system: string;
  controlPoint: boolean;
  basis: StepBasis;
  source: string;
  sourceTitle: string;
  quote: string;
};

export type Understanding = {
  status: "NONE" | "DRAFT" | "CONFIRMED";
  summary: string;
  steps: ProcessStep[];
  builtBy: "PERSON" | "AGENT" | "RULES" | "LEGACY" | "FALLBACK";
  proposedSummary: string;
  proposedSteps: ProcessStep[] | null;
  proposedNote: string;
  confirmedBy: string | null;
  version: number;
};

export type ControlContext = {
  controlId: string;
  classifications: Classification[];
  derivedClassifications: Classification[];
  classificationsOverridden: boolean;
  processRequired: boolean;
  readiness: Readiness | null;
  approved: Attribute[];
  proposed: Attribute[];
  history: Attribute[];
  issues: ContextIssue[];
  documents: SupportingDocument[];
  understanding: Understanding;
  testing: Testing | null;
  libraryUpdate: LibraryUpdate | null;
  design: Design | null;
  note: string;
};

export const BASIS_LABELS: Record<StepBasis, string> = {
  DOCUMENTED: "Documented",
  INFERRED: "Inferred",
  TEAM: "From the team",
};

export const SOURCE_LABELS: Record<Attribute["sourceKind"], string> = {
  LIBRARY: "Control library",
  RCM: "Client RCM",
  MANUAL: "Written by the team",
  AGENT: "Agent",
  DOCUMENT: "Supporting document",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET =
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S|sk-[A-Za-z0-9]{10,}/i;

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const records = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((item) => item === value) ?? fallback;
}

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter(
    (item): item is string => typeof item === "string",
  );

function parseDefinition(value: unknown): AttributeDefinition | null {
  if (!isRecord(value) || typeof value.key !== "string") {
    return null;
  }
  return {
    key: value.key,
    confidence: oneOf(
      value.confidence,
      ["HIGH", "MODERATE", "LOW", "NOT_ESTABLISHED"] as const,
      "NOT_ESTABLISHED",
    ),
    condition: str(value.condition),
    why: str(value.why),
    evidence: strings(value.evidence),
    extract: strings(value.extract),
    compare: str(value.compare),
    passes: str(value.passes),
    fails: str(value.fails),
    insufficient: str(value.insufficient),
    review: str(value.review),
    notInfer: str(value.not_infer),
    basis: strings(value.basis),
    question: str(value.question),
    blocks: value.blocks === true,
  };
}

function parseTesting(value: unknown): Testing | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    version: num(value.version),
    objective: str(value.objective),
    controlType: str(value.control_type),
    population: str(value.population),
    sampling: str(value.sampling),
    procedures: records(value.procedures).map((item) => ({
      key: str(item.key),
      phase: oneOf(
        item.phase,
        ["DESIGN", "OPERATING", "ROLLFORWARD"] as const,
        "OPERATING",
      ),
      objective: str(item.objective),
      action: str(item.action),
      evidence: strings(item.evidence),
      attributes: strings(item.attributes),
      limitation: str(item.limitation),
    })),
    designConfirmation: str(value.design_confirmation),
    assumptions: strings(value.assumptions),
    questions: strings(value.questions),
    notApplicable: strings(value.not_applicable),
  };
}

function parseUpdate(value: unknown): LibraryUpdate | null {
  if (!isRecord(value) || value.available !== true) {
    return null;
  }
  return {
    libraryVersion: num(value.library_version),
    currentVersion: num(value.current_version),
    items: records(value.items).map((item) => ({
      change: oneOf(
        item.change,
        ["KEEP", "REWORD", "ADD", "PROPOSE", "RETIRE"] as const,
        "KEEP",
      ),
      key: str(item.key),
      text: str(item.text),
      was: str(item.was),
      reason: str(item.reason),
      confidence: str(item.confidence),
    })),
    note: str(value.note),
    fields: records(value.fields).map((item) => ({
      field: str(item.field),
      was: str(item.was),
      now: str(item.now),
    })),
    splits: records(value.splits).map((item) => ({
      controlRef: str(item.control_ref),
      title: str(item.title),
      reason: str(item.reason),
    })),
  };
}

function parseDesign(value: unknown): Design | null {
  if (!isRecord(value) || typeof value.text !== "string") {
    return null;
  }
  return {
    text: value.text,
    risk: str(value.risk),
    itRisk: str(value.it_risk),
    principle: str(value.principle),
    assertions: strings(value.assertions),
    controlType: str(value.control_type),
    nature: str(value.nature),
    frequency: str(value.frequency),
    operator: str(value.operator),
    reviewer: str(value.reviewer),
    owner: str(value.owner),
    authority: str(value.authority),
    judgment: str(value.judgment),
    judgmentNote: str(value.judgment_note),
    precision: str(value.precision),
    investigation: str(value.investigation),
    information: records(value.information).map((item) => ({
      name: str(item.name),
      kind: str(item.kind),
      elements: strings(item.elements),
      ipe: str(item.ipe),
    })),
    itgcs: strings(value.itgcs),
    evidence: str(value.evidence),
    appliesWhen: str(value.applies_when),
    slots: records(value.slots)
      .filter((item) => typeof item.key === "string")
      .map((item) => ({
        key: str(item.key),
        label: str(item.label),
        kind: str(item.kind),
        why: str(item.why),
        example: str(item.example),
        blocks: item.blocks === true,
        value: str(item.value),
        automatic: item.automatic === true,
        filledBy: typeof item.filled_by === "string" ? item.filled_by : null,
        version: num(item.version),
        options: strings(item.options).slice(0, 6),
        question: str(item.question),
        hint: str(item.hint),
      })),
    missing: strings(value.missing),
  };
}

const CLASSIFICATION_KEYS = CLASSIFICATIONS.map(([key]) => key);
const DOCUMENT_KEYS = DOCUMENT_KINDS.map(([key]) => key);

function parseAttribute(item: Raw): Attribute {
  return {
    id: str(item.id),
    position: num(item.position),
    text: str(item.text),
    status: oneOf(
      item.status,
      ["PROPOSED", "APPROVED", "REJECTED", "RETIRED", "SUPERSEDED"] as const,
      "APPROVED",
    ),
    basis: oneOf(item.basis, ["DOCUMENTED", "INFERRED"] as const, "INFERRED"),
    sourceKind: oneOf(
      item.source_kind,
      ["LIBRARY", "RCM", "MANUAL", "AGENT", "DOCUMENT"] as const,
      "MANUAL",
    ),
    sourceDocumentId:
      typeof item.source_document_id === "string"
        ? item.source_document_id
        : null,
    sourceTitle: str(item.source_title),
    sourceQuote: str(item.source_quote),
    note: str(item.note),
    proposal:
      item.proposal === "ADD" ||
      item.proposal === "CHANGE" ||
      item.proposal === "RETIRE"
        ? item.proposal
        : null,
    replacesId: typeof item.replaces_id === "string" ? item.replaces_id : null,
    decidedBy: typeof item.decided_by === "string" ? item.decided_by : null,
    version: num(item.version),
    definition: parseDefinition(item.definition),
  };
}

function parseStep(item: Raw): ProcessStep {
  return {
    key: str(item.key),
    description: str(item.description),
    actor: str(item.actor),
    system: str(item.system),
    controlPoint: item.control_point === true,
    basis: oneOf(
      item.basis,
      ["DOCUMENTED", "INFERRED", "TEAM"] as const,
      "TEAM",
    ),
    source: str(item.source),
    sourceTitle: str(item.source_title),
    quote: str(item.quote),
  };
}

function parseReadiness(value: unknown): Readiness | null {
  if (!isRecord(value)) {
    return null;
  }
  const state = oneOf(value.state, READINESS_STATES, "READY");
  return {
    state,
    label: str(value.label) || STATE_LABELS[state],
    processRequired: value.process_required === true,
    checks: records(value.checks).map((check) => ({
      key: oneOf(
        check.key,
        [
          "plan",
          "criteria",
          "process",
          "evidence",
          "scope",
          "conflicts",
        ] as const,
        "criteria",
      ),
      title: str(check.title),
      status: oneOf(
        check.status,
        ["OK", "BLOCKED", "WARN", "PENDING", "NOT_APPLICABLE"] as const,
        "PENDING",
      ),
      summary: str(check.summary),
      blockers: records(check.blockers).map((item) => ({
        detail: str(item.detail),
        why: str(item.why),
        resolve: str(item.resolve),
      })),
    })),
  };
}

export function parseContext(value: unknown): ControlContext | null {
  if (!isRecord(value) || typeof value.control_id !== "string") {
    return null;
  }
  const attributes = isRecord(value.attributes) ? value.attributes : {};
  const understanding = isRecord(value.understanding)
    ? value.understanding
    : {};
  const classes = (raw: unknown): Classification[] =>
    (Array.isArray(raw) ? raw : []).filter((item): item is Classification =>
      CLASSIFICATION_KEYS.some((key) => key === item),
    );
  return {
    controlId: value.control_id,
    classifications: classes(value.classifications),
    derivedClassifications: classes(value.derived_classifications),
    classificationsOverridden: value.classifications_overridden === true,
    processRequired: value.process_required === true,
    readiness: parseReadiness(value.readiness),
    approved: records(attributes.approved).map(parseAttribute),
    proposed: records(attributes.proposed).map(parseAttribute),
    history: records(attributes.history).map(parseAttribute),
    issues: records(value.issues).map((item) => ({
      id: str(item.id),
      origin: oneOf(
        item.origin,
        ["ATTRIBUTES", "PROCESS", "SOURCES"] as const,
        "SOURCES",
      ),
      kind: oneOf(
        item.kind,
        ["MISSING", "AMBIGUOUS", "CONFLICT"] as const,
        "AMBIGUOUS",
      ),
      topic: str(item.topic),
      detail: str(item.detail),
      why: str(item.why),
      resolve: str(item.resolve),
      quotes: records(item.quotes).map((quote) => ({
        source: str(quote.source),
        title: str(quote.title),
        quote: str(quote.quote),
      })),
      raisedBy: item.raised_by === "AGENT" ? "AGENT" : "RULES",
      status: oneOf(
        item.status,
        ["OPEN", "RESOLVED", "DISMISSED"] as const,
        "OPEN",
      ),
      resolutionNote: str(item.resolution_note),
      version: num(item.version),
    })),
    documents: records(value.documents).map((item) => ({
      id: str(item.id),
      kind: oneOf(item.kind, DOCUMENT_KEYS, "OTHER"),
      title: str(item.title),
      fileName: str(item.file_name),
      origin: oneOf(
        item.origin,
        ["UPLOAD", "WRITTEN", "AGENT"] as const,
        "WRITTEN",
      ),
      characters: num(item.characters),
      excerpt: str(item.excerpt),
      createdBy: typeof item.created_by === "string" ? item.created_by : null,
      controlIds: (Array.isArray(item.control_ids)
        ? item.control_ids
        : []
      ).filter((id): id is string => typeof id === "string"),
      reviewed: item.reviewed === true,
    })),
    understanding: {
      status: oneOf(
        understanding.status,
        ["NONE", "DRAFT", "CONFIRMED"] as const,
        "NONE",
      ),
      summary: str(understanding.summary),
      steps: records(understanding.steps).map(parseStep),
      builtBy: oneOf(
        understanding.built_by,
        ["PERSON", "AGENT", "RULES", "LEGACY", "FALLBACK"] as const,
        "PERSON",
      ),
      proposedSummary: str(understanding.proposed_summary),
      proposedSteps: Array.isArray(understanding.proposed_steps)
        ? records(understanding.proposed_steps).map(parseStep)
        : null,
      proposedNote: str(understanding.proposed_note),
      confirmedBy:
        typeof understanding.confirmed_by === "string"
          ? understanding.confirmed_by
          : null,
      version: num(understanding.version),
    },
    testing: parseTesting(value.testing),
    libraryUpdate: parseUpdate(value.library_update),
    design: parseDesign(value.design),
    note: str(value.note),
  };
}

export type ContextIntent =
  | "classify"
  | "attribute-add"
  | "attribute-edit"
  | "attribute-retire"
  | "attribute-decide"
  | "attributes-generate"
  | "library-adopt"
  | "values-set"
  | "process-save"
  | "process-build"
  | "process-adopt"
  | "review"
  | "issue-resolve"
  | "document-write"
  | "document-link"
  | "document-unlink";

export type ContextWrite =
  | { error: "invalid" }
  | {
      intent: ContextIntent;
      method: "POST" | "PUT" | "PATCH";
      path: string;
      body: Record<string, unknown>;
      /** Calls that wait for the agent get longer to answer. */
      slow: boolean;
    };

type Fields = Record<string, unknown>;
const text = (fields: Fields, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string).trim() : "";
const version = (fields: Fields): number | null => {
  const value = Number(fields.version);
  return Number.isInteger(value) && value >= 0 ? value : null;
};
const ids = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter(
    (item): item is string => typeof item === "string" && UUID.test(item),
  );

/** The API call for one action on a control's context, checked before it is sent. */
export function contextWrite(fields: Fields): ContextWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const controlId = text(fields, "control_id");
  const intent = text(fields, "intent") as ContextIntent;
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const project = `/organizations/${organizationId}/projects/${projectId}`;
  const control = `${project}/controls/${controlId}`;
  const needsControl = !intent.startsWith("document-");
  if (needsControl && !UUID.test(controlId)) {
    return { error: "invalid" };
  }
  const ok = (
    method: "POST" | "PUT" | "PATCH",
    path: string,
    body: Record<string, unknown> = {},
    slow = false,
  ): ContextWrite => ({ intent, method, path, body, slow });
  const attributeId = text(fields, "attribute_id");
  const wording = text(fields, "text");
  const clean = (value: string) =>
    value !== "" && value.length <= 300 && !SECRET.test(value);
  switch (intent) {
    case "classify": {
      const chosen = (
        Array.isArray(fields.classifications) ? fields.classifications : []
      ).filter(
        (item): item is Classification =>
          typeof item === "string" &&
          CLASSIFICATION_KEYS.some((key) => key === item),
      );
      return ok("PUT", `${control}/classifications`, {
        classifications: chosen.length > 0 ? chosen : null,
      });
    }
    case "attribute-add":
      return clean(wording)
        ? ok("POST", `${control}/attributes`, { text: wording })
        : { error: "invalid" };
    case "attribute-edit": {
      const at = version(fields);
      return clean(wording) && UUID.test(attributeId) && at !== null && at >= 1
        ? ok("PATCH", `${control}/attributes/${attributeId}`, {
            text: wording,
            version: at,
          })
        : { error: "invalid" };
    }
    case "attribute-retire": {
      const at = version(fields);
      return UUID.test(attributeId) && at !== null && at >= 1
        ? ok("POST", `${control}/attributes/${attributeId}/retire`, {
            version: at,
          })
        : { error: "invalid" };
    }
    case "attribute-decide": {
      const at = version(fields);
      const decision = text(fields, "decision");
      if (
        !UUID.test(attributeId) ||
        at === null ||
        at < 1 ||
        (decision !== "APPROVE" && decision !== "REJECT") ||
        (wording !== "" && !clean(wording))
      ) {
        return { error: "invalid" };
      }
      return ok("POST", `${control}/attributes/${attributeId}/decide`, {
        decision,
        version: at,
        ...(wording !== "" ? { text: wording } : {}),
      });
    }
    case "attributes-generate":
      return ok("POST", `${control}/attributes/generate`, {}, true);
    case "library-adopt":
      return ok("POST", `${control}/library-update/adopt`);
    case "values-set": {
      const raw = isRecord(fields.values) ? fields.values : {};
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (!/^[a-z][a-z0-9-]{1,40}$/.test(key) || typeof value !== "string") {
          return { error: "invalid" };
        }
        const trimmed = value.trim();
        if (trimmed.length > 300 || SECRET.test(trimmed)) {
          return { error: "invalid" };
        }
        values[key] = trimmed;
      }
      if (Object.keys(values).length === 0 || Object.keys(values).length > 40) {
        return { error: "invalid" };
      }
      return ok("PUT", `${control}/values`, {
        values,
        everywhere: fields.everywhere === true || fields.everywhere === "true",
      });
    }
    case "process-build":
      return ok("POST", `${control}/process/build`, {}, true);
    case "review":
      return ok("POST", `${control}/review`, {}, true);
    case "process-adopt": {
      const at = version(fields);
      return at !== null && at >= 1
        ? ok("POST", `${control}/process/adopt`, { version: at })
        : { error: "invalid" };
    }
    case "process-save": {
      const at = version(fields);
      const steps = (Array.isArray(fields.steps) ? fields.steps : [])
        .filter(isRecord)
        .map((step) => ({
          description: str(step.description).trim().slice(0, 400),
          actor: str(step.actor).trim().slice(0, 120),
          system: str(step.system).trim().slice(0, 120),
          control_point: step.controlPoint === true,
          basis: oneOf(
            step.basis,
            ["DOCUMENTED", "INFERRED", "TEAM"] as const,
            "TEAM",
          ),
          source: str(step.source).slice(0, 60),
          quote: str(step.quote).slice(0, 200),
        }))
        .filter((step) => step.description !== "");
      const summary = text(fields, "summary");
      if (
        at === null ||
        steps.length > 15 ||
        summary.length > 20000 ||
        SECRET.test(summary) ||
        steps.some((step) => SECRET.test(step.description))
      ) {
        return { error: "invalid" };
      }
      return ok("PUT", `${control}/process`, {
        summary,
        steps,
        version: at,
        confirm: fields.confirm === true || fields.confirm === "true",
      });
    }
    case "issue-resolve": {
      const at = version(fields);
      const issueId = text(fields, "issue_id");
      const status = text(fields, "status");
      const note = text(fields, "note");
      return UUID.test(issueId) &&
        at !== null &&
        at >= 1 &&
        (status === "RESOLVED" || status === "DISMISSED") &&
        note !== "" &&
        note.length <= 1000
        ? ok("POST", `${control}/issues/${issueId}/resolve`, {
            status,
            note,
            version: at,
          })
        : { error: "invalid" };
    }
    case "document-write": {
      const kind = text(fields, "kind");
      const title = text(fields, "title");
      const body = text(fields, "body");
      const controls = ids(fields.control_ids);
      if (
        !DOCUMENT_KEYS.some((key) => key === kind) ||
        title === "" ||
        title.length > 200 ||
        body === "" ||
        body.length > 100_000 ||
        SECRET.test(body)
      ) {
        return { error: "invalid" };
      }
      return ok("POST", `${project}/source-documents`, {
        kind,
        title,
        text: body,
        control_ids: controls,
      });
    }
    case "document-link": {
      const documentId = text(fields, "document_id");
      const controls = ids(fields.control_ids);
      return UUID.test(documentId) && controls.length > 0
        ? ok("POST", `${project}/source-documents/${documentId}/links`, {
            control_ids: controls,
          })
        : { error: "invalid" };
    }
    case "document-unlink": {
      const documentId = text(fields, "document_id");
      return UUID.test(documentId) && UUID.test(controlId)
        ? ok("POST", `${project}/source-documents/${documentId}/unlink`, {
            control_id: controlId,
          })
        : { error: "invalid" };
    }
    default:
      return { error: "invalid" };
  }
}

export const MAX_UPLOAD = 5 * 1024 * 1024;

/** Where an uploaded supporting document goes, when it can be sent. */
export function documentUploadTarget(
  fields: Record<string, string>,
  controlIds: string[],
  file: { name: string; size: number } | null,
): { path: string } | null {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const kind = fields.kind ?? "";
  if (
    file === null ||
    file.size === 0 ||
    file.size > MAX_UPLOAD ||
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !DOCUMENT_KEYS.some((key) => key === kind)
  ) {
    return null;
  }
  const params = new URLSearchParams({
    kind,
    title: (fields.title ?? "").trim().slice(0, 200) || file.name.slice(0, 200),
    file_name: file.name.slice(0, 200),
  });
  for (const id of controlIds.filter((item) => UUID.test(item))) {
    params.append("control_id", id);
  }
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/source-documents/upload?${params.toString()}`,
  };
}

/** What to tell the team when a call did not succeed. */
export function contextProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    const known: Record<string, string> = {
      "attribute exists": "That attribute is already on the control.",
      "a control keeps at least one attribute":
        "A control keeps at least one attribute. Add its replacement first.",
      "mark the step where the control operates":
        "Mark the step where the control operates before confirming.",
      "add the process steps before confirming":
        "Add the process steps before confirming.",
      "there is no proposed map": "There is no proposed map to adopt.",
      "a value cannot hold a credential":
        "A value cannot hold a password or key.",
      "unknown value": "That value is not part of this control's statement.",
      "no library update for this control":
        "This control is already on the current library version.",
      "the control changed":
        "This control changed while you were working. Refresh and try again.",
    };
    return (
      known[detail] ??
      "This changed while you were working. Refresh and try again."
    );
  }
  if (status === 403 || status === 404) {
    return "Your role cannot change this control.";
  }
  if (status === 413) {
    return "That file is larger than 5 MB. Upload a shorter document, or paste the text.";
  }
  if (status === 422) {
    return "Check the entry: it needs some text, within the length limits, and no credential.";
  }
  return "That could not be saved. Try again.";
}

/** Whether a register row should show its readiness: only when it stops testing. */
export function showsReadiness(state: string): boolean {
  return BLOCKING_STATES.some((item) => item === state);
}
