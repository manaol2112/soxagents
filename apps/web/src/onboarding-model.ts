const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SECRET =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

export const SETUP_STEPS = [
  {
    id: "scope",
    title: "Scope and period",
    detail: "What the audit covers and when",
  },
  { id: "team", title: "Team and access", detail: "Who works on it" },
  {
    id: "rcm",
    title: "Risk and control matrix",
    detail: "Controls and systems in scope",
  },
  {
    id: "workpapers",
    title: "Workpaper templates",
    detail: "How testing is documented",
  },
  { id: "pbc", title: "PBC plan", detail: "How evidence is requested" },
  { id: "start", title: "Review and start", detail: "Hand off to the agents" },
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number]["id"];

export function parseStep(value: string | null): SetupStep {
  return SETUP_STEPS.find((step) => step.id === value)?.id ?? "scope";
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
  applicationIds: string[];
  testAttributes: string[];
  pbcItems: string[];
  designTemplate: string;
  effectivenessTemplate: string;
  agentKey: string;
  sampleSize: number;
  version: number;
  source: string;
  domainLabel: string;
  frequencyLabel: string;
  natureLabel: string;
  customFields: Array<{ label: string; value: string }>;
};

export type PlanItem = {
  key: string;
  kind: string;
  title: string;
  agentKey: string;
  controlRef: string | null;
  dependsOn: string[];
};

export type Onboarding = {
  projectId: string;
  projectName: string;
  projectStatus: string;
  scope: string;
  periodEnd: string | null;
  coordinatorName: string;
  coordinatorEmail: string;
  clientDomains: string[];
  dueDays: number;
  followUpDays: number;
  maxFollowUps: number;
  templatesConfirmed: boolean;
  started: boolean;
  applications: Array<{
    id: string;
    name: string;
    description: string;
    layer: string;
  }>;
  team: Array<{
    userId: string;
    name: string;
    email: string;
    role: string;
    organizationRole: string;
  }>;
  candidates: Array<{
    userId: string;
    name: string;
    email: string;
    organizationRole: string;
  }>;
  controls: SetupControl[];
  templates: Array<{
    key: string;
    title: string;
    stage: string;
    purpose: string;
    sections: string[];
  }>;
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
  rcmSource: "NONE" | "LIBRARY" | "UPLOAD";
  rcmFileName: string;
  openImportId: string | null;
  library: Array<{ domain: string; controls: number; loaded: number }>;
  drafting: {
    total: number;
    pending: number;
    drafted: number;
    byModel: number;
    failed: number;
  };
};

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
  source: "MODEL" | "RULES" | null;
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
      item.source === "MODEL" || item.source === "RULES" ? item.source : null,
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
      mappedBy: "MODEL" | "RULES" | null;
      alternative: string | null;
      alternativeReason: string;
    }>
  >;
  terms: {
    status: "PENDING" | "WORKING" | "READY" | "FAILED";
    mode: "FILL" | "REMAP";
    source: "MODEL" | "RULES" | null;
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

export type WorkpaperPreview = {
  reference: string;
  title: string;
  templateTitle: string;
  templateVersion: number;
  stage: string;
  purpose: string;
  sections: Array<{
    title: string;
    kind: string;
    guidance: string;
    fields: Array<{ label: string; value: string }>;
    columns: string[];
    rows: string[][];
  }>;
};

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
    scope: str(value.scope),
    periodEnd:
      typeof settings.period_end === "string" ? settings.period_end : null,
    coordinatorName: str(settings.client_coordinator_name),
    coordinatorEmail: str(settings.client_coordinator_email),
    clientDomains: strings(settings.client_domains),
    dueDays: Number(settings.pbc_due_days ?? 10),
    followUpDays: Number(settings.pbc_follow_up_days ?? 3),
    maxFollowUps: Number(settings.pbc_max_follow_ups ?? 2),
    templatesConfirmed: typeof settings.templates_confirmed_at === "string",
    started: value.started === true,
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
    applications: records(value.applications).map((item) => ({
      id: str(item.id),
      name: str(item.name),
      description: str(item.description),
      layer: str(item.layer) || "APPLICATION",
    })),
    team: records(value.team).map((item) => ({
      userId: str(item.user_id),
      name: str(item.display_name),
      email: str(item.email),
      role: str(item.engagement_role),
      organizationRole: str(item.organization_role),
    })),
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
      testAttributes: strings(item.test_attributes),
      pbcItems: strings(item.pbc_items),
      designTemplate: str(item.design_template_key),
      effectivenessTemplate: str(item.effectiveness_template_key),
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
    })),
    templates: records(value.templates).map((item) => ({
      key: str(item.key),
      title: str(item.title),
      stage: str(item.stage),
      purpose: str(item.purpose),
      sections: strings(item.section_titles),
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
            items: records(plan.items).map((item) => ({
              key: str(item.key),
              kind: str(item.kind),
              title: str(item.title),
              agentKey: str(item.agent_key),
              controlRef:
                typeof item.control_ref === "string" ? item.control_ref : null,
              dependsOn: strings(item.depends_on),
            })),
            createdTasks: Number(plan.created_tasks ?? 0),
            createdRequests: Number(plan.created_requests ?? 0),
          },
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
        terms.source === "MODEL" || terms.source === "RULES"
          ? terms.source
          : null,
      note: str(terms.note),
      modelAvailable: terms.model_available === true,
    },
    ready: value.ready === true,
    replaces: Number(value.replaces ?? 0),
  };
}

export function parsePreview(value: unknown): WorkpaperPreview | null {
  if (
    !isRecord(value) ||
    typeof value.reference !== "string" ||
    !Array.isArray(value.sections)
  ) {
    return null;
  }
  return {
    reference: value.reference,
    title: str(value.title),
    templateTitle: str(value.template_title),
    templateVersion: Number(value.template_version ?? 1),
    stage: str(value.stage),
    purpose: str(value.purpose),
    sections: records(value.sections).map((section) => ({
      title: str(section.title),
      kind: str(section.kind),
      guidance: str(section.guidance),
      fields: records(section.fields).map((field) => ({
        label: str(field.label),
        value: str(field.value),
      })),
      columns: strings(section.columns),
      rows: Array.isArray(section.rows) ? section.rows.map(strings) : [],
    })),
  };
}

/** Setup progress: completed steps out of the five that need input. */
export function setupProgress(onboarding: Onboarding): {
  done: number;
  total: number;
} {
  const steps = onboarding.readiness.filter((item) => item.step !== "agents");
  return {
    done: steps.filter((item) => item.complete).length,
    total: steps.length,
  };
}

export type SetupNotice =
  | "setup-saved"
  | "setup-invalid"
  | "setup-changed"
  | "setup-started"
  | "setup-incomplete"
  | "setup-denied"
  | "setup-unavailable"
  | "setup-launched"
  | "setup-rcm-uploaded"
  | "setup-rcm-unreadable"
  | "setup-rcm-large"
  | "setup-rcm-incomplete"
  | "setup-rcm-imported";

const NOTICES: readonly SetupNotice[] = [
  "setup-saved",
  "setup-invalid",
  "setup-changed",
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
];

export function parseSetupNotice(value: string | null): SetupNotice | null {
  return NOTICES.find((notice) => notice === value) ?? null;
}

export function setupNoticeFor(
  intent: string,
  status: number,
  detail: string,
): SetupNotice {
  if (status === 200) {
    return intent === "approve"
      ? "setup-launched"
      : intent === "rcm-import"
        ? "setup-rcm-imported"
        : "setup-saved";
  }
  if (status === 409 && detail === "mapping is incomplete") {
    return "setup-rcm-incomplete";
  }
  if (status === 409 && detail === "engagement has started") {
    return "setup-started";
  }
  if (status === 409 && detail === "setup is not complete") {
    return "setup-incomplete";
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
      method: "POST" | "PATCH";
      path: string;
      body: Record<string, unknown>;
    };

/** Turn one setup form into one API call. Every value is checked before it is sent. */
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
  if (intent === "scope") {
    const scope = text("scope", 4000);
    const period = (fields.period_end ?? "").trim();
    if (scope === null || (period !== "" && !DATE.test(period))) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "scope",
      method: "PATCH",
      path: `${base}/scope`,
      body: { scope, period_end: period === "" ? null : period },
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
      step: "rcm",
      method: "POST",
      path: `${base}/applications`,
      body: { name, description },
    };
  }
  if (intent === "remove-application") {
    const id = fields.application_id ?? "";
    if (!UUID.test(id)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "rcm",
      method: "POST",
      path: `${base}/applications/${id}/remove`,
      body: {},
    };
  }
  if (intent === "add-member") {
    const userId = fields.user_id ?? "";
    const role = fields.engagement_role ?? "";
    if (
      !UUID.test(userId) ||
      !["LEAD", "PREPARER", "REVIEWER"].includes(role)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "team",
      method: "POST",
      path: `${base}/team`,
      body: { user_id: userId, engagement_role: role },
    };
  }
  if (intent === "remove-member") {
    const userId = fields.user_id ?? "";
    if (!UUID.test(userId)) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "team",
      method: "POST",
      path: `${base}/team/${userId}/remove`,
      body: {},
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
      step: "rcm",
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
      step: "rcm",
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
      step: "rcm",
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
        design_template_key: fields.design_template_key ?? "",
        effectiveness_template_key: fields.effectiveness_template_key ?? "",
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
      step: "rcm",
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
        step: "rcm",
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
      step: "rcm",
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
        step: "rcm",
        method: "POST",
        path: `${path}/discard`,
        body: {},
      };
    }
    if (intent === "rcm-import") {
      return {
        intent,
        step: "rcm",
        method: "POST",
        path: `${path}/import`,
        body: { version },
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
        step: "rcm",
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
      step: "rcm",
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
      step: "rcm",
      method: "POST",
      path: `${base}/controls/owner-emails`,
      body: { entries },
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
    const name = text("client_coordinator_name", 200);
    const email = (fields.client_coordinator_email ?? "").trim().toLowerCase();
    const domains = (fields.client_domains ?? "")
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item !== "");
    const due = integer("pbc_due_days", 1, 90);
    const followUp = integer("pbc_follow_up_days", 1, 30);
    const max = integer("pbc_max_follow_ups", 0, 10);
    if (
      name === null ||
      (email !== "" && !EMAIL.test(email)) ||
      domains.length > 10 ||
      due === null ||
      followUp === null ||
      max === null
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      step: "pbc",
      method: "PATCH",
      path: `${base}/pbc`,
      body: {
        client_coordinator_name: name,
        client_coordinator_email: email,
        client_domains: domains,
        pbc_due_days: due,
        pbc_follow_up_days: followUp,
        pbc_max_follow_ups: max,
      },
    };
  }
  if (intent === "propose") {
    return {
      intent,
      step: "start",
      method: "POST",
      path: `${base}/plan`,
      body: {},
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
      step: "start",
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
  if (
    mapping.length === 0 ||
    mapping.length > 80 ||
    new Set(named).size !== named.length
  ) {
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
  template: string | null;
  preview: WorkpaperPreview | null;
  rcmImport: RcmImport | null;
  notice: SetupNotice | null;
};

export const EMPTY_SETUP: SetupState = {
  onboarding: null,
  step: "scope",
  category: null,
  control: null,
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
