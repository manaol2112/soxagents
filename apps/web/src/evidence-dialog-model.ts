/**
 * The evidence dialog (product owner, 31 October 2026): adding evidence to a control's
 * item, or reviewing a file already added, in one dialog. The file is read and classified
 * by the evidence reader; the dialog says what it found and suggests what to do with it:
 * a population is confirmed and sampled (in an operating phase), or a walkthrough
 * instance is picked from it (in design), or it is linked to interim testing too.
 *
 * Pure: what the dialog shows and what it may send are decided here, and tested. Nothing
 * is decided for the person: every action is the person's, and the server checks it.
 */

import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KINDS,
  type EvidenceKind,
} from "./analysis-model.ts";
import type { NavItem, NavPhase } from "./evidence-intelligence-model.ts";
import type { Phase } from "./evidence-plan-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_SAMPLE = 200;

// --- Steps ---------------------------------------------------------------------------

export type DialogStep = "upload" | "classify" | "preview" | "route";
export type StepState = "done" | "current" | "todo";

export type ReadState = "none" | "reading" | "ready" | "failed";

/** The four steps with where the open file stands: added, read, reviewed, routed. */
export function stepsOf(input: {
  phase: Phase | null;
  fileOpen: boolean;
  read: ReadState;
  routed: boolean;
}): Array<{
  step: DialogStep;
  label: string;
  detail: string;
  state: StepState;
}> {
  const reached: DialogStep = !input.fileOpen
    ? "upload"
    : input.read === "reading" || input.read === "none"
      ? "classify"
      : input.routed
        ? "route"
        : "preview";
  const order: DialogStep[] = ["upload", "classify", "preview", "route"];
  const at = order.indexOf(reached);
  const detail: Record<DialogStep, string> = {
    upload: "Add your file",
    classify: "The agent identifies the evidence type",
    preview: "Review and confirm",
    route:
      input.phase === "DESIGN"
        ? "Use in testing or keep in D&I"
        : "Confirm and choose samples",
  };
  const label: Record<DialogStep, string> = {
    upload: "Upload",
    classify: "Classify",
    preview: "Preview",
    route: "Route",
  };
  return order.map((step, index) => ({
    step,
    label: label[step],
    detail: detail[step],
    state:
      index < at || (input.routed && index === at)
        ? "done"
        : index === at
          ? "current"
          : "todo",
  }));
}

// --- What the reader found, and what to do next -----------------------------------

export type SuggestionAction =
  | "confirm-population"
  | "pick-one"
  | "route-interim"
  | "keep-design"
  | "upload-instance"
  | "accept-population"
  | "choose-samples"
  | "approve-samples"
  | "confirm-kind"
  | "change-kind";

export type Suggestion = {
  title: string;
  question: string;
  actions: Array<{ action: SuggestionAction; label: string; primary: boolean }>;
};

export type SuggestionInput = {
  read: ReadState;
  /** The type the reader found, or a person confirmed. */
  kind: EvidenceKind | null;
  confirmed: boolean;
  /** The phase of the item the file is on. */
  phase: Phase;
  itemTitle: string;
  /** Whether the file reads as a table (a workbook or CSV). */
  table: boolean;
  /** An interim item for the population, to link the file to. */
  interimPopulation: boolean;
  /** The population item's file was accepted as complete and accurate by a person. */
  populationAccepted: boolean;
  /** The samples drawn from this file, when there are any. */
  samples: { status: "PROPOSED" | "APPROVED"; count: number } | null;
  /** The walkthrough instance picked from this file, when there is one. */
  instance: { key: string; rowNumber: number } | null;
  /** The file is already linked to the interim population item. */
  linkedToInterim: boolean;
};

export function kindLabel(kind: EvidenceKind | null): string {
  return kind === null ? "Not classified yet" : EVIDENCE_KIND_LABELS[kind];
}

/** What the agent found in the file and what the person may do with it. */
export function suggestionFor(input: SuggestionInput): Suggestion {
  if (input.read === "none" || input.read === "reading") {
    return {
      title: "Classifying the evidence",
      question:
        "The agent is reading the file to find what it is and what it shows. This takes a few seconds.",
      actions: [],
    };
  }
  if (input.read === "failed") {
    return {
      title: "The file could not be read",
      question:
        "Open Details to see why, or read it again. A person can still review it from the preview.",
      actions: [],
    };
  }
  const population = input.kind === "population" && input.table;
  if (population && input.phase === "DESIGN") {
    if (input.instance !== null) {
      return {
        title: `Walkthrough instance selected: ${input.instance.key || `row ${input.instance.rowNumber}`}`,
        question:
          "Upload the evidence for this instance (its request, approval and grant). The agent reads it against the walkthrough.",
        actions: [
          {
            action: "upload-instance",
            label: "Upload its evidence",
            primary: true,
          },
          {
            action: "pick-one",
            label: "Pick another instance",
            primary: false,
          },
        ],
      };
    }
    return {
      title:
        "This looks like a population file uploaded in Design & Implementation.",
      question:
        "Would you like to select a sample of one for the walkthrough, or route it to interim testing?",
      actions: [
        ...(input.confirmed
          ? []
          : [
              {
                action: "confirm-population" as const,
                label: "Confirm as population",
                primary: true,
              },
            ]),
        {
          action: "pick-one",
          label: "Pick sample of one",
          primary: input.confirmed,
        },
        ...(input.interimPopulation && !input.linkedToInterim
          ? [
              {
                action: "route-interim" as const,
                label: "Use in interim testing",
                primary: false,
              },
            ]
          : []),
        { action: "keep-design", label: "Keep in D&I", primary: false },
      ],
    };
  }
  if (population) {
    // A population a person accepted, or whose samples exist, needs no confirmation of
    // its type first: what was decided stands, and the next step follows from it.
    if (
      !input.confirmed &&
      !input.populationAccepted &&
      input.samples === null
    ) {
      return {
        title: "This looks like a population file.",
        question:
          "Confirm it, then choose how many samples the agent selects for testing.",
        actions: [
          {
            action: "confirm-population",
            label: "Confirm as population",
            primary: true,
          },
          {
            action: "change-kind",
            label: "It is something else",
            primary: false,
          },
        ],
      };
    }
    if (input.samples?.status === "APPROVED") {
      return {
        title: `Samples approved (${input.samples.count})`,
        question:
          "The selected samples are requested and tested from here. Open the Test step to follow them.",
        actions: [],
      };
    }
    if (!input.populationAccepted) {
      return {
        title: "Population confirmed",
        question:
          "Accept it as complete and accurate for the period before samples are drawn from it. Check the population checks first.",
        actions: [
          {
            action: "accept-population",
            label: "Accept as complete and accurate",
            primary: true,
          },
        ],
      };
    }
    return {
      title:
        input.samples === null
          ? "Choose how many samples to select"
          : `Samples proposed (${input.samples.count})`,
      question:
        input.samples === null
          ? "The agent draws them at random from the population, reproducibly, and a person approves them."
          : "Review the proposed samples, draw again with another size, or approve them.",
      actions:
        input.samples === null
          ? [
              {
                action: "choose-samples",
                label: "Select samples",
                primary: true,
              },
            ]
          : [
              {
                action: "approve-samples",
                label: "Approve samples",
                primary: true,
              },
              { action: "choose-samples", label: "Draw again", primary: false },
            ],
    };
  }
  return {
    title: `This looks like ${input.kind === null ? "evidence of another kind" : KIND_PHRASE[input.kind]}.`,
    question: `It is read against "${input.itemTitle}". Confirm the type, or change it if the agent is wrong.`,
    actions: input.confirmed
      ? [{ action: "change-kind", label: "Change the type", primary: false }]
      : [
          { action: "confirm-kind", label: "Confirm the type", primary: true },
          { action: "change-kind", label: "Change the type", primary: false },
        ],
  };
}

/** What each type reads as in a sentence ("This looks like ..."). */
const KIND_PHRASE: Record<EvidenceKind, string> = {
  population: "a population or listing",
  walkthrough: "walkthrough evidence",
  design: "design evidence",
  configuration: "a configuration or settings record",
  change_history: "a change history or audit log",
  report: "a key report or query",
  policy: "a policy or procedure",
  sample: "evidence for one sample, such as a ticket or an approval",
  other: "evidence of another kind",
};

/** The reader's reason as a person reads it. Readings from before 31 October 2026 could
 * end mid-word (cut at the limit) or name a field of the reader's message in brackets, such
 * as "(excerpt_is_cut is false)": the bracket goes, and the text ends at its last full
 * sentence. */
export function readableReason(text: string): string {
  const plain = text
    .replace(/\s*\([^()]*\b[a-z]+_[a-z_]+\b[^()]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (plain === "" || /[.!?…]["')\]]?$/.test(plain)) {
    return plain;
  }
  const end = Math.max(
    plain.lastIndexOf(". "),
    plain.lastIndexOf("! "),
    plain.lastIndexOf("? "),
  );
  return end > 0 ? plain.slice(0, end + 1) : `${plain}…`;
}

// --- Sample sizes ---------------------------------------------------------------------

/** The sizes offered (the product owner's choice: free, as in the reference): one, a
 * small and a larger sample, and the test plan's own size beside them when it differs. */
export function sizeChoices(
  planSize: number | null,
): Array<{ size: number; label: string; plan: boolean }> {
  const base = [
    { size: 1, label: "Sample of one", plan: false },
    { size: 5, label: "Small sample", plan: false },
    { size: 10, label: "Larger sample", plan: false },
  ];
  if (planSize === null || planSize < 1) {
    return base;
  }
  const marked = base.map((choice) =>
    choice.size === planSize ? { ...choice, plan: true } : choice,
  );
  return marked.some((choice) => choice.plan)
    ? marked
    : [...marked, { size: planSize, label: "Test plan", plan: true }];
}

/** A size typed by the person, when it is a whole number the server takes. */
export function sampleSize(text: string): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= 1 && value <= MAX_SAMPLE
    ? value
    : null;
}

// --- Items ------------------------------------------------------------------------------

/** The design item a walkthrough instance is for: the one asking for an executed
 * instance (a sample or the control's execution), else the item the file was added to. */
export function walkthroughItemOf(
  phases: readonly NavPhase[],
  fallback: NavItem | null,
): NavItem | null {
  const design = phases.find((entry) => entry.phase === "DESIGN")?.items ?? [];
  return (
    design.find((item) =>
      item.requirement.categories.some(
        (category) => category === "SAMPLE" || category === "CONTROL_EXECUTION",
      ),
    ) ??
    (fallback !== null && fallback.requirement.phase === "DESIGN"
      ? fallback
      : null)
  );
}

/** The interim item that asks for the population, to link a design population to. */
export function interimPopulationOf(
  phases: readonly NavPhase[],
): NavItem | null {
  const interim =
    phases.find((entry) => entry.phase === "INTERIM")?.items ?? [];
  return (
    interim.find((item) =>
      item.requirement.categories.includes("POPULATION"),
    ) ?? null
  );
}

/** The items a person can add evidence to, by phase, for the dialog's choice. */
export function addableItems(
  phases: readonly NavPhase[],
): Array<{ phase: Phase; label: string; items: NavItem[] }> {
  return phases
    .map((entry) => ({
      phase: entry.phase,
      label: entry.label,
      items: entry.items.filter((item) => item.requirement.requestId !== null),
    }))
    .filter((entry) => entry.items.length > 0);
}

// --- What the dialog sends ----------------------------------------------------------

export type DialogWrite =
  | { ok: true; path: string; body: Record<string, unknown> }
  | { ok: false; problem: string };

function int(value: unknown, low: number, high: number): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= low && number <= high
    ? number
    : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/** The API call for one of the dialog's actions, checked before it is sent. The plan's
 * own actions (accepting the population, linking a file) go through the plan's route. */
export function dialogWrite(fields: Record<string, unknown>): DialogWrite {
  const organization = id(fields.organization_id);
  const project = id(fields.project_id);
  if (organization === null || project === null) {
    return { ok: false, problem: "invalid" };
  }
  const base = `/organizations/${organization}/projects/${project}`;
  switch (fields.intent) {
    case "confirm-kind": {
      const analysis = id(fields.analysis_id);
      const version = int(fields.version, 1, 1_000_000);
      const kind = EVIDENCE_KINDS.find((each) => each === fields.kind);
      if (analysis === null || version === null || kind === undefined) {
        return { ok: false, problem: "invalid" };
      }
      return {
        ok: true,
        path: `${base}/evidence-analyses/${analysis}/confirm`,
        body: { version, kind },
      };
    }
    case "propose-samples": {
      const file = id(fields.file_id);
      const size = int(fields.sample_size, 1, MAX_SAMPLE);
      if (file === null || size === null) {
        return { ok: false, problem: "invalid" };
      }
      return {
        ok: true,
        path: `${base}/control-tests/propose`,
        body: { evidence_file_id: file, sample_size: size },
      };
    }
    case "approve-samples": {
      const test = id(fields.test_id);
      const version = int(fields.version, 1, 1_000_000);
      if (test === null || version === null) {
        return { ok: false, problem: "invalid" };
      }
      return {
        ok: true,
        path: `${base}/control-tests/${test}/approve`,
        body: { version },
      };
    }
    case "pick-instance": {
      const control = id(fields.control_id);
      const requirement = id(fields.requirement_id);
      const file = id(fields.file_id);
      const row = int(fields.row_number, 1, 1_000_000);
      const note =
        typeof fields.note === "string" ? fields.note.slice(0, 500) : "";
      if (
        control === null ||
        requirement === null ||
        file === null ||
        row === null
      ) {
        return { ok: false, problem: "invalid" };
      }
      return {
        ok: true,
        path: `${base}/controls/${control}/evidence-requirements/${requirement}/walkthrough-instance`,
        body: { file_id: file, row_number: row, note },
      };
    }
    default:
      return { ok: false, problem: "invalid" };
  }
}

/** The API path for a page of a population's rows, checked. */
export function tablePath(params: URLSearchParams): string | null {
  const organization = id(params.get("organization"));
  const project = id(params.get("project"));
  const file = id(params.get("file"));
  const offset = int(params.get("offset") ?? "0", 0, 1_000_000);
  const limit = int(params.get("limit") ?? "50", 1, 200);
  const search = (params.get("search") ?? "").slice(0, 100);
  if (
    organization === null ||
    project === null ||
    file === null ||
    offset === null ||
    limit === null
  ) {
    return null;
  }
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (search.trim() !== "") {
    query.set("search", search);
  }
  return `/organizations/${organization}/projects/${project}/evidence-files/${file}/table?${query}`;
}

// --- Reading the API's answers --------------------------------------------------------

export type PopulationPage = {
  columns: string[];
  rows: Array<{ rowNumber: number; values: string[] }>;
  total: number;
  matched: number;
  offset: number;
  keyColumn: string | null;
  dateColumn: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((each) => typeof each === "string")
    ? (value as string[])
    : null;
}

export function parsePopulationPage(value: unknown): PopulationPage | null {
  if (!isRecord(value)) {
    return null;
  }
  const columns = strings(value.columns);
  const total = int(value.total, 0, 10_000_000);
  const matched = int(value.matched, 0, 10_000_000);
  const offset = int(value.offset, 0, 10_000_000);
  if (
    columns === null ||
    total === null ||
    matched === null ||
    offset === null
  ) {
    return null;
  }
  const rows: PopulationPage["rows"] = [];
  for (const row of Array.isArray(value.rows) ? value.rows : []) {
    if (!isRecord(row)) {
      return null;
    }
    const number = int(row.row_number, 1, 10_000_000);
    const values = strings(row.values);
    if (number === null || values === null) {
      return null;
    }
    rows.push({ rowNumber: number, values });
  }
  return {
    columns,
    rows,
    total,
    matched,
    offset,
    keyColumn: typeof value.key_column === "string" ? value.key_column : null,
    dateColumn:
      typeof value.date_column === "string" ? value.date_column : null,
  };
}

export type WalkthroughInstance = {
  id: string;
  requirementId: string;
  fileId: string;
  fileName: string;
  rowNumber: number;
  keyColumn: string;
  keyValue: string;
  columns: string[];
  values: string[];
  note: string;
  selectedBy: string;
  createdAt: string;
  current: boolean;
};

export function parseInstances(value: unknown): WalkthroughInstance[] | null {
  if (!isRecord(value) || !Array.isArray(value.instances)) {
    return null;
  }
  const found: WalkthroughInstance[] = [];
  for (const item of value.instances) {
    if (!isRecord(item)) {
      return null;
    }
    const identity = id(item.id);
    const requirement = id(item.requirement_id);
    const file = id(item.population_file_id);
    const row = int(item.row_number, 1, 10_000_000);
    const columns = strings(item.columns);
    const values = strings(item.values);
    if (
      identity === null ||
      requirement === null ||
      file === null ||
      row === null ||
      columns === null ||
      values === null
    ) {
      return null;
    }
    found.push({
      id: identity,
      requirementId: requirement,
      fileId: file,
      fileName: typeof item.file_name === "string" ? item.file_name : "",
      rowNumber: row,
      keyColumn: typeof item.key_column === "string" ? item.key_column : "",
      keyValue: typeof item.key_value === "string" ? item.key_value : "",
      columns,
      values,
      note: typeof item.note === "string" ? item.note : "",
      selectedBy:
        typeof item.selected_by_name === "string" ? item.selected_by_name : "",
      createdAt: typeof item.created_at === "string" ? item.created_at : "",
      current: item.superseded_at === null || item.superseded_at === undefined,
    });
  }
  return found;
}

/** The current instance picked from a file, for the design item it is for. */
export function instanceFor(
  instances: readonly WalkthroughInstance[] | null,
  fileId: string,
): WalkthroughInstance | null {
  return (
    (instances ?? []).find(
      (instance) => instance.current && instance.fileId === fileId,
    ) ?? null
  );
}
