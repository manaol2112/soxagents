/**
 * The standard library as the Library page reads it (standard library, milestone L1): one
 * entry per standard control, its procedures, attributes, evidence, design statement, and
 * sources as the API publishes them from the code, and the firm's methodology review of
 * each. Nothing here decides anything: the status words, the grouping, the filters, and
 * the addresses.
 */

export const LIBRARY_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "SUPERSEDED",
  "RETIRED",
] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

/** What a reviewer may record; superseded is read from an approval's version. */
export type StoredStatus = Exclude<LibraryStatus, "SUPERSEDED">;

export const STATUS_LABELS: Record<LibraryStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending methodology review",
  APPROVED: "Approved",
  SUPERSEDED: "Superseded",
  RETIRED: "Retired",
};

export const STATUS_SHORT: Record<LibraryStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  SUPERSEDED: "Superseded",
  RETIRED: "Retired",
};

export const STATUS_TONES: Record<LibraryStatus, string> = {
  DRAFT: "tone-neutral",
  PENDING_REVIEW: "tone-warning",
  APPROVED: "tone-success",
  SUPERSEDED: "tone-warning",
  RETIRED: "tone-neutral",
};

export const CATEGORIES = [
  "ITGC",
  "ITAC",
  "KEY_REPORT",
  "BUSINESS",
  "ENTITY",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ITGC: "IT general controls",
  ITAC: "Application controls",
  KEY_REPORT: "Key reports and IPE",
  BUSINESS: "Business process controls",
  ENTITY: "Entity-level controls",
};

export const PHASE_LABELS: Record<string, string> = {
  DESIGN: "Design and implementation",
  OPERATING: "Operating effectiveness",
  ROLLFORWARD: "Roll-forward",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "High",
  MODERATE: "Moderate",
  LOW: "Low: needs confirmation",
  NOT_ESTABLISHED: "Not established",
};

export const REQUEST_KINDS = ["CHANGE", "NEW", "RETIRE"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  CHANGE: "Change",
  NEW: "New standard control",
  RETIRE: "Retire",
};

export const LIBRARY_TABS = [
  "procedures",
  "attributes",
  "evidence",
  "design",
  "usage",
] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];
export const TAB_LABELS: Record<LibraryTab, string> = {
  procedures: "Procedures",
  attributes: "Attributes",
  evidence: "Evidence",
  design: "Design",
  usage: "Usage",
};

export type EntryRow = {
  libraryKey: string;
  controlRef: string;
  title: string;
  category: Category;
  domain: string;
  domainLabel: string;
  nature: string;
  frequency: string;
  controlType: string;
  objective: string;
  procedures: number;
  attributesTested: number;
  attributesProposed: number;
  evidence: number;
  status: LibraryStatus;
  approvedVersion: number | null;
  decidedAt: string | null;
  usageEngagements: number;
  usageControls: number;
  openRequests: number;
};

export type ChangeRequest = {
  id: string;
  libraryKey: string | null;
  kind: RequestKind;
  title: string;
  detail: string;
  status: "OPEN" | "ACCEPTED" | "DECLINED";
  submittedBy: string;
  submittedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string;
};

export type LibraryIndex = {
  libraryVersion: number;
  categories: Array<{ key: Category; label: string; entries: number }>;
  counts: Partial<Record<LibraryStatus, number>>;
  entries: EntryRow[];
  newRequests: ChangeRequest[];
};

/** One numbered step of a version 4 procedure. */
export type Step = {
  action: string;
  /** Keys of the evidence suite items the step uses. */
  evidence: string[];
  record: string;
  exception: string;
};

export type Procedure = {
  key: string;
  phase: string;
  objective: string;
  action: string;
  evidence: string[];
  attributes: string[];
  limitation: string;
  steps: Step[];
};

/** One item of a version 4 standard evidence suite. */
export type EvidenceItem = {
  key: string;
  name: string;
  form: string;
  provider: string;
  phases: string[];
  purpose: string;
  period: string;
  contents: string[];
  completeness: string;
  notAcceptable: string;
  alternatives: string[];
  attributes: string[];
};

export const FORM_LABELS: Record<string, string> = {
  SYSTEM_REPORT: "System report",
  SYSTEM_LOG: "System log",
  SYSTEM_SCREEN: "System screen",
  CONFIGURATION: "Configuration",
  TICKET: "Ticket",
  DOCUMENT: "Document",
  POLICY: "Policy",
  CORRESPONDENCE: "Correspondence",
  OBSERVATION: "Observation",
  THIRD_PARTY_REPORT: "Third-party report",
};

export const PURPOSE_LABELS: Record<string, string> = {
  DESIGN: "Design",
  POPULATION: "Population",
  COMPLETENESS: "Completeness",
  ATTRIBUTE: "Attribute evidence",
  CONTEXT: "Context",
};

export type Attribute = {
  key: string;
  text: string;
  confidence: string;
  tested: boolean;
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
  assumptions: string[];
  question: string;
  blocks: boolean;
  /** Keys of the evidence suite items the attribute is judged from (version 4). */
  evidenceKeys: string[];
};

export type Statement = {
  text: string;
  risk: string;
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
  slots: Array<{
    key: string;
    label: string;
    kind: string;
    why: string;
    example: string;
    blocks: boolean;
  }>;
  itRisk: string;
  principle: string;
  appliesWhen: string;
};

export type Governance = {
  status: LibraryStatus;
  storedStatus: StoredStatus | null;
  libraryVersion: number;
  note: string;
  decidedBy: string | null;
  decidedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedVersion: number | null;
  canDecide: boolean;
};

export type LibraryEntry = {
  row: EntryRow;
  risk: string;
  activity: string;
  performer: string;
  reviewer: string;
  trigger: string;
  population: string;
  sampling: string;
  designConfirmation: string;
  assumptions: string[];
  questions: string[];
  notApplicable: string[];
  procedures: Procedure[];
  attributes: Attribute[];
  retired: Array<{ text: string; reason: string; replacedBy: string }>;
  evidence: string[];
  evidenceSuite: EvidenceItem[];
  definitionVersion: number;
  statement: Statement | null;
  sources: Array<{ ref: string; title: string; kind: string; says: string }>;
  governance: Governance;
  usage: Array<{
    projectId: string;
    projectName: string;
    projectStatus: string;
    controls: number;
  }>;
  changeRequests: ChangeRequest[];
};

// Parsing

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const numOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((item) => item === value) ?? fallback;
}

function parseRow(value: Json): EntryRow {
  return {
    libraryKey: str(value.library_key),
    controlRef: str(value.control_ref),
    title: str(value.title),
    category: oneOf(value.category, CATEGORIES, "BUSINESS"),
    domain: str(value.domain),
    domainLabel: str(value.domain_label),
    nature: str(value.nature),
    frequency: str(value.frequency),
    controlType: str(value.control_type),
    objective: str(value.objective),
    procedures: num(value.procedures),
    attributesTested: num(value.attributes_tested),
    attributesProposed: num(value.attributes_proposed),
    evidence: num(value.evidence),
    status: oneOf(value.status, LIBRARY_STATUSES, "PENDING_REVIEW"),
    approvedVersion: numOrNull(value.approved_version),
    decidedAt: strOrNull(value.decided_at),
    usageEngagements: num(value.usage_engagements),
    usageControls: num(value.usage_controls),
    openRequests: num(value.open_requests),
  };
}

function parseRequest(value: Json): ChangeRequest {
  return {
    id: str(value.id),
    libraryKey: strOrNull(value.library_key),
    kind: oneOf(value.kind, REQUEST_KINDS, "CHANGE"),
    title: str(value.title),
    detail: str(value.detail),
    status: oneOf(
      value.status,
      ["OPEN", "ACCEPTED", "DECLINED"] as const,
      "OPEN",
    ),
    submittedBy: str(value.submitted_by),
    submittedAt: str(value.submitted_at),
    decidedBy: strOrNull(value.decided_by),
    decidedAt: strOrNull(value.decided_at),
    decisionNote: str(value.decision_note),
  };
}

export function parseLibraryIndex(value: unknown): LibraryIndex | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return null;
  }
  const counts: Partial<Record<LibraryStatus, number>> = {};
  if (isRecord(value.counts)) {
    for (const status of LIBRARY_STATUSES) {
      const count = value.counts[status];
      if (typeof count === "number") {
        counts[status] = count;
      }
    }
  }
  return {
    libraryVersion: num(value.library_version),
    categories: records(value.categories).map((item) => ({
      key: oneOf(item.key, CATEGORIES, "BUSINESS"),
      label: str(item.label),
      entries: num(item.entries),
    })),
    counts,
    entries: records(value.entries).map(parseRow),
    newRequests: records(value.new_requests).map(parseRequest),
  };
}

function parseStatement(value: unknown): Statement | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    text: str(value.text),
    risk: str(value.risk),
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
    slots: records(value.slots).map((item) => ({
      key: str(item.key),
      label: str(item.label),
      kind: str(item.kind),
      why: str(item.why),
      example: str(item.example),
      blocks: item.blocks === true,
    })),
    itRisk: str(value.it_risk),
    principle: str(value.principle),
    appliesWhen: str(value.applies_when),
  };
}

export function parseLibraryEntry(value: unknown): LibraryEntry | null {
  if (!isRecord(value) || !isRecord(value.row) || !isRecord(value.governance)) {
    return null;
  }
  const governance = value.governance;
  const stored = governance.stored_status;
  return {
    row: parseRow(value.row),
    risk: str(value.risk),
    activity: str(value.activity),
    performer: str(value.performer),
    reviewer: str(value.reviewer),
    trigger: str(value.trigger),
    population: str(value.population),
    sampling: str(value.sampling),
    designConfirmation: str(value.design_confirmation),
    assumptions: strings(value.assumptions),
    questions: strings(value.questions),
    notApplicable: strings(value.not_applicable),
    procedures: records(value.procedures).map((item) => ({
      key: str(item.key),
      phase: str(item.phase),
      objective: str(item.objective),
      action: str(item.action),
      evidence: strings(item.evidence),
      attributes: strings(item.attributes),
      limitation: str(item.limitation),
      steps: records(item.steps).map((step) => ({
        action: str(step.action),
        evidence: strings(step.evidence),
        record: str(step.record),
        exception: str(step.exception),
      })),
    })),
    attributes: records(value.attributes).map((item) => ({
      key: str(item.key),
      text: str(item.text),
      confidence: str(item.confidence),
      tested: item.tested === true,
      condition: str(item.condition),
      why: str(item.why),
      evidence: strings(item.evidence),
      extract: strings(item.extract),
      compare: str(item.compare),
      passes: str(item.passes),
      fails: str(item.fails),
      insufficient: str(item.insufficient),
      review: str(item.review),
      notInfer: str(item.not_infer),
      basis: strings(item.basis),
      assumptions: strings(item.assumptions),
      question: str(item.question),
      blocks: item.blocks === true,
      evidenceKeys: strings(item.evidence_keys),
    })),
    retired: records(value.retired).map((item) => ({
      text: str(item.text),
      reason: str(item.reason),
      replacedBy: str(item.replaced_by),
    })),
    evidence: strings(value.evidence),
    evidenceSuite: records(value.evidence_suite).map((item) => ({
      key: str(item.key),
      name: str(item.name),
      form: str(item.form),
      provider: str(item.provider),
      phases: strings(item.phases),
      purpose: str(item.purpose),
      period: str(item.period),
      contents: strings(item.contents),
      completeness: str(item.completeness),
      notAcceptable: str(item.not_acceptable),
      alternatives: strings(item.alternatives),
      attributes: strings(item.attributes),
    })),
    definitionVersion: num(value.definition_version),
    statement: parseStatement(value.statement),
    sources: records(value.sources).map((item) => ({
      ref: str(item.ref),
      title: str(item.title),
      kind: str(item.kind),
      says: str(item.says),
    })),
    governance: {
      status: oneOf(governance.status, LIBRARY_STATUSES, "PENDING_REVIEW"),
      storedStatus:
        stored === "DRAFT" ||
        stored === "PENDING_REVIEW" ||
        stored === "APPROVED" ||
        stored === "RETIRED"
          ? stored
          : null,
      libraryVersion: num(governance.library_version),
      note: str(governance.note),
      decidedBy: strOrNull(governance.decided_by),
      decidedAt: strOrNull(governance.decided_at),
      approvedBy: strOrNull(governance.approved_by),
      approvedAt: strOrNull(governance.approved_at),
      approvedVersion: numOrNull(governance.approved_version),
      canDecide: governance.can_decide === true,
    },
    usage: records(value.usage).map((item) => ({
      projectId: str(item.project_id),
      projectName: str(item.project_name),
      projectStatus: str(item.project_status),
      controls: num(item.controls),
    })),
    changeRequests: records(value.change_requests).map(parseRequest),
  };
}

export function parseLibraryTab(value: string | null): LibraryTab {
  return oneOf(value, LIBRARY_TABS, "procedures");
}

// The list

export type LibraryFilter = {
  category: Category | null;
  status: LibraryStatus | null;
  query: string;
};

export function parseCategory(value: string | null): Category | null {
  return CATEGORIES.find((item) => item === value) ?? null;
}

export function parseStatus(value: string | null): LibraryStatus | null {
  return LIBRARY_STATUSES.find((item) => item === value) ?? null;
}

/** The entries a category, a status, and a search keep. The search reads the control's
 * ID, title, area, and objective. */
export function filterEntries(
  entries: readonly EntryRow[],
  filter: LibraryFilter,
): EntryRow[] {
  const words = filter.query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (filter.category === null || entry.category === filter.category) &&
      (filter.status === null || entry.status === filter.status) &&
      (words === "" ||
        `${entry.controlRef} ${entry.title} ${entry.domainLabel} ${entry.objective}`
          .toLowerCase()
          .includes(words)),
  );
}

/** The entries by area, in the library's order. */
export function groupByDomain(
  entries: readonly EntryRow[],
): Array<{ domain: string; label: string; entries: EntryRow[] }> {
  const groups: Array<{ domain: string; label: string; entries: EntryRow[] }> =
    [];
  for (const entry of entries) {
    const found = groups.find((group) => group.domain === entry.domain);
    if (found !== undefined) {
      found.entries.push(entry);
    } else {
      groups.push({
        domain: entry.domain,
        label: entry.domainLabel,
        entries: [entry],
      });
    }
  }
  return groups;
}

/**
 * The short references a person reads, in place of the definition's internal keys:
 * procedures numbered within their phase (D1 design, O1 operating effectiveness, R1
 * roll-forward), attributes A1, A2 in the order the page lists them (tested, then
 * proposed), and evidence E1, E2 in the suite's order. The keys stay the anchors.
 */
export type References = {
  procedure: (key: string) => string;
  attribute: (key: string) => string;
  evidence: (key: string) => string;
};

const PHASE_PREFIX: Record<string, string> = {
  DESIGN: "D",
  OPERATING: "O",
  ROLLFORWARD: "R",
};

export function referencesFor(
  entry: Pick<LibraryEntry, "procedures" | "attributes" | "evidenceSuite">,
): References {
  const procedures = new Map<string, string>();
  const counts: Record<string, number> = {};
  for (const item of entry.procedures) {
    const prefix = PHASE_PREFIX[item.phase] ?? "P";
    counts[prefix] = (counts[prefix] ?? 0) + 1;
    procedures.set(item.key, `${prefix}${counts[prefix]}`);
  }
  const ordered = [
    ...entry.attributes.filter((item) => item.tested),
    ...entry.attributes.filter((item) => !item.tested),
  ];
  const attributes = new Map(
    ordered.map((item, index) => [item.key, `A${index + 1}`]),
  );
  const evidence = new Map(
    entry.evidenceSuite.map((item, index) => [item.key, `E${index + 1}`]),
  );
  const read = (map: Map<string, string>) => (key: string) =>
    map.get(key) ?? key;
  return {
    procedure: read(procedures),
    attribute: read(attributes),
    evidence: read(evidence),
  };
}

/** The evidence suite by phase, in the audit's order; an item used in several phases is
 * listed under each. */
export function suiteByPhase(
  items: readonly EvidenceItem[],
): Array<{ phase: string; label: string; items: EvidenceItem[] }> {
  return ["DESIGN", "OPERATING", "ROLLFORWARD"]
    .map((phase) => ({
      phase,
      label: PHASE_LABELS[phase] ?? phase,
      items: items.filter((item) => item.phases.includes(phase)),
    }))
    .filter((group) => group.items.length > 0);
}

/** The suite item names a step refers to, in the step's order. */
export function stepEvidence(
  step: Step,
  suite: readonly EvidenceItem[],
): Array<{ key: string; name: string }> {
  return step.evidence.map((key) => ({
    key,
    name: suite.find((item) => item.key === key)?.name ?? key,
  }));
}

/** The procedures by phase, in the audit's order. */
export function proceduresByPhase(
  procedures: readonly Procedure[],
): Array<{ phase: string; label: string; items: Procedure[] }> {
  return ["DESIGN", "OPERATING", "ROLLFORWARD"]
    .map((phase) => ({
      phase,
      label: PHASE_LABELS[phase] ?? phase,
      items: procedures.filter((item) => item.phase === phase),
    }))
    .filter((group) => group.items.length > 0);
}

// Decisions

export type StatusAction = {
  status: StoredStatus;
  label: string;
  /** The one decision the page leads with. */
  primary: boolean;
  /** A note is required: the decision needs its reason on the record. */
  needsNote: boolean;
};

/**
 * What a methodology reviewer may record next, from where the entry stands. Approving
 * a superseded entry approves the current library version.
 */
export function statusActions(current: LibraryStatus): StatusAction[] {
  switch (current) {
    case "PENDING_REVIEW":
      return [
        {
          status: "APPROVED",
          label: "Approve",
          primary: true,
          needsNote: false,
        },
        {
          status: "DRAFT",
          label: "Send back to draft",
          primary: false,
          needsNote: true,
        },
        { status: "RETIRED", label: "Retire", primary: false, needsNote: true },
      ];
    case "DRAFT":
      return [
        {
          status: "PENDING_REVIEW",
          label: "Submit for review",
          primary: true,
          needsNote: false,
        },
        { status: "RETIRED", label: "Retire", primary: false, needsNote: true },
      ];
    case "APPROVED":
      return [
        {
          status: "PENDING_REVIEW",
          label: "Withdraw approval",
          primary: false,
          needsNote: true,
        },
        { status: "RETIRED", label: "Retire", primary: false, needsNote: true },
      ];
    case "SUPERSEDED":
      return [
        {
          status: "APPROVED",
          label: "Approve this version",
          primary: true,
          needsNote: false,
        },
        {
          status: "PENDING_REVIEW",
          label: "Withdraw approval",
          primary: false,
          needsNote: true,
        },
        { status: "RETIRED", label: "Retire", primary: false, needsNote: true },
      ];
    case "RETIRED":
      return [
        {
          status: "PENDING_REVIEW",
          label: "Reinstate for review",
          primary: true,
          needsNote: true,
        },
      ];
  }
}

/** Owners and admins decide the firm's methodology, as its other settings. */
export function canGovern(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Whether a standard control can be approved with others from the list: one pending
 * review, or one whose approval an update superseded. A draft is still being written and a
 * retired one is out of the library, so each is decided on its own page. */
export function approvable(entry: Pick<EntryRow, "status">): boolean {
  return entry.status === "PENDING_REVIEW" || entry.status === "SUPERSEDED";
}

// Addresses

export function libraryHref(
  organizationId: string,
  projectId: string | null,
  options: {
    control?: string | null;
    tab?: LibraryTab | null;
    category?: Category | null;
    status?: LibraryStatus | null;
    query?: string | null;
  } = {},
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    section: "library",
  });
  if (projectId !== null && projectId !== "") {
    params.set("project", projectId);
  }
  if (options.control) {
    params.set("control", options.control);
  }
  if (options.tab && options.tab !== "procedures") {
    params.set("tab", options.tab);
  }
  if (options.category) {
    params.set("category", options.category);
  }
  if (options.status) {
    params.set("status", options.status);
  }
  if (options.query) {
    params.set("q", options.query);
  }
  return `/?${params.toString()}`;
}

// Writes

export type LibraryIntent = "status" | "status-many" | "request" | "decide";

export type LibraryWrite =
  | { error: "invalid" }
  | {
      intent: LibraryIntent;
      method: "POST" | "PUT";
      path: string;
      body: Record<string, unknown>;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9][a-z0-9-]{1,59}$/;

const text = (fields: Record<string, unknown>, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string) : "";

/** The API call a form on the Library page makes, from its fields; invalid when the
 * fields do not name a real decision. */
export function libraryWrite(fields: Record<string, unknown>): LibraryWrite {
  const organizationId = text(fields, "organization_id");
  if (!UUID.test(organizationId)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/library`;
  const intent = text(fields, "intent");
  if (intent === "status") {
    const key = text(fields, "library_key");
    const status = text(fields, "status");
    if (!KEY.test(key) || !LIBRARY_STATUSES.includes(status as LibraryStatus)) {
      return { error: "invalid" };
    }
    return {
      intent,
      method: "PUT",
      path: `${base}/${key}/status`,
      body: { status, note: text(fields, "note") },
    };
  }
  if (intent === "status-many") {
    const keys = Array.isArray(fields.library_keys) ? fields.library_keys : [];
    const status = text(fields, "status");
    if (
      keys.length === 0 ||
      keys.length > 200 ||
      !keys.every((key) => typeof key === "string" && KEY.test(key)) ||
      !LIBRARY_STATUSES.includes(status as LibraryStatus)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      method: "PUT",
      path: `${base}/status`,
      body: { library_keys: keys, status, note: text(fields, "note") },
    };
  }
  if (intent === "request") {
    const kind = text(fields, "kind");
    const key = text(fields, "library_key");
    if (!REQUEST_KINDS.includes(kind as RequestKind)) {
      return { error: "invalid" };
    }
    if (kind !== "NEW" && !KEY.test(key)) {
      return { error: "invalid" };
    }
    return {
      intent,
      method: "POST",
      path: `${base}/change-requests`,
      body: {
        library_key: kind === "NEW" ? null : key,
        kind,
        title: text(fields, "title"),
        detail: text(fields, "detail"),
      },
    };
  }
  if (intent === "decide") {
    const id = text(fields, "request_id");
    const decision = text(fields, "decision");
    if (
      !UUID.test(id) ||
      (decision !== "ACCEPTED" && decision !== "DECLINED")
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      method: "PUT",
      path: `${base}/change-requests/${id}`,
      body: { decision, note: text(fields, "note") },
    };
  }
  return { error: "invalid" };
}

/** What a failed call tells the person; null when it succeeded. */
export function libraryProblem(status: number, detail: string): string | null {
  if (status === 200 || status === 201) {
    return null;
  }
  if (status === 0) {
    return "The library could not be reached. Try again.";
  }
  if (status === 403) {
    return "Only an owner or admin decides the library's methodology.";
  }
  if (status === 404) {
    return "That standard control is not in the library.";
  }
  if (status === 409 && detail !== "") {
    return detail.charAt(0).toUpperCase() + detail.slice(1);
  }
  if (status === 422) {
    return "Check the fields: a title needs 3 characters and the detail 20.";
  }
  return "That could not be saved.";
}
