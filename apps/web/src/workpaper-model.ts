/**
 * A control's workpapers (Milestone 8.3): the sections the records and the agent filled,
 * the versions, and the preparer's sign-off. The API keeps every version; this shapes
 * them for the page and builds the writes.
 */

import type { Citation } from "./console-model.ts";
import {
  type CancelState,
  parseCancelState,
  parseRunState,
  type RunState,
} from "./run-state.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password\s*[:=]|private[_-]?key)/i;

export type WorkpaperSection = {
  key: string;
  title: string;
  kind: "fields" | "text" | "table";
  guidance: string;
  fields: Array<{ label: string; value: string }>;
  text: string;
  citations: Citation[];
  columns: string[];
  rows: string[][];
  /** FALLBACK: the agent failed and the records' plain words stand in. */
  source: "RECORDS" | "AGENT" | "PERSON" | "FALLBACK";
  /** The template tab the section is on; empty for a workpaper drafted before tabs. */
  tab: string;
  period: string;
};

export type WorkpaperTab = {
  key: string;
  title: string;
  period: string;
  reference: string;
};

export type WorkpaperVersion = {
  number: number;
  source: string;
  createdBy: string | null;
  createdAt: string;
  note: string;
};

export type Workpaper = {
  id: string;
  controlId: string;
  stage: "DESIGN" | "EFFECTIVENESS";
  status: "DRAFT" | "PREPARED";
  drafting: boolean;
  draftState: RunState;
  draftNote: string;
  cancelState?: CancelState;
  currentVersion: number;
  shownVersion: number;
  reference: string;
  title: string;
  templateTitle: string;
  purpose: string;
  kind: string;
  tabs: WorkpaperTab[];
  sections: WorkpaperSection[];
  versions: WorkpaperVersion[];
  preparedBy: string | null;
  preparedAt: string | null;
  preparedVersion: number | null;
  version: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** A section's checked sources, as the console stores them. */
function parseCitations(value: unknown): Citation[] {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .filter(
      (item) =>
        typeof item.number === "number" &&
        typeof item.evidence_file_id === "string" &&
        UUID.test(item.evidence_file_id),
    )
    .map((item) => ({
      number: num(item.number),
      fileId: str(item.evidence_file_id),
      fileName: str(item.file_name),
      quote: str(item.quote),
      before: str(item.before),
      after: str(item.after),
      location: str(item.location),
    }));
}

function parseSection(value: unknown): WorkpaperSection | null {
  if (!isRecord(value) || typeof value.key !== "string") {
    return null;
  }
  const kind =
    value.kind === "fields" || value.kind === "text" ? value.kind : "table";
  return {
    key: value.key,
    title: str(value.title),
    kind,
    guidance: str(value.guidance),
    fields: (Array.isArray(value.fields) ? value.fields : [])
      .filter(isRecord)
      .map((field) => ({ label: str(field.label), value: str(field.value) })),
    text: str(value.text),
    citations: parseCitations(value.citations),
    columns: (Array.isArray(value.columns) ? value.columns : []).map(str),
    rows: (Array.isArray(value.rows) ? value.rows : [])
      .filter(Array.isArray)
      .map((row) => (row as unknown[]).map(str)),
    source:
      value.source === "AGENT" ||
      value.source === "PERSON" ||
      value.source === "FALLBACK"
        ? value.source
        : "RECORDS",
    tab: str(value.tab),
    period: str(value.period),
  };
}

function parseTab(value: unknown): WorkpaperTab | null {
  if (!isRecord(value) || typeof value.key !== "string" || value.key === "") {
    return null;
  }
  return {
    key: value.key,
    title: str(value.title),
    period: str(value.period),
    reference: str(value.reference),
  };
}

/**
 * The tabs a workpaper shows: the template's, or one tab for a workpaper drafted before
 * tabs, holding every section.
 */
export function workpaperTabs(
  paper: Pick<Workpaper, "tabs" | "sections" | "stage" | "reference">,
): Array<WorkpaperTab & { sections: WorkpaperSection[] }> {
  if (paper.tabs.length === 0) {
    return [
      {
        key: paper.stage.toLowerCase(),
        title: STAGE_LABELS[paper.stage],
        period: paper.stage === "DESIGN" ? "design" : "interim",
        reference: paper.reference,
        sections: paper.sections,
      },
    ];
  }
  return paper.tabs.map((tab) => ({
    ...tab,
    sections: paper.sections.filter((section) => section.tab === tab.key),
  }));
}

export function parseWorkpapers(value: unknown): Workpaper[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const papers: Workpaper[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !UUID.test(raw.id)) {
      return null;
    }
    const content = isRecord(raw.content) ? raw.content : null;
    papers.push({
      id: raw.id,
      controlId: str(raw.control_id),
      stage: raw.stage === "DESIGN" ? "DESIGN" : "EFFECTIVENESS",
      status: raw.status === "PREPARED" ? "PREPARED" : "DRAFT",
      drafting: raw.drafting === true,
      draftState: parseRunState(raw.draft_state, raw.drafting === true),
      draftNote: str(raw.draft_note),
      cancelState: parseCancelState(raw.cancel_state),
      currentVersion: num(raw.current_version),
      shownVersion: num(raw.shown_version),
      reference: str(content?.reference),
      title: str(content?.title),
      templateTitle: str(content?.template_title),
      purpose: str(content?.purpose),
      kind: str(content?.kind),
      tabs: (Array.isArray(content?.tabs) ? content.tabs : [])
        .map(parseTab)
        .filter((item): item is WorkpaperTab => item !== null),
      sections: (Array.isArray(content?.sections) ? content.sections : [])
        .map(parseSection)
        .filter((item): item is WorkpaperSection => item !== null),
      versions: (Array.isArray(raw.versions) ? raw.versions : [])
        .filter(isRecord)
        .map((item) => ({
          number: num(item.number),
          source: str(item.source),
          createdBy:
            typeof item.created_by === "string" ? item.created_by : null,
          createdAt: str(item.created_at),
          note: str(item.note),
        })),
      preparedBy: typeof raw.prepared_by === "string" ? raw.prepared_by : null,
      preparedAt: typeof raw.prepared_at === "string" ? raw.prepared_at : null,
      preparedVersion:
        typeof raw.prepared_version === "number" ? raw.prepared_version : null,
      version: num(raw.version),
    });
  }
  return papers;
}

export const STAGE_LABELS: Record<Workpaper["stage"], string> = {
  DESIGN: "Design and walkthrough",
  EFFECTIVENESS: "Operating effectiveness",
};

export const SOURCE_LABELS: Record<string, string> = {
  AGENT: "Drafted by the agent",
  PERSON: "Written by a person",
  RECORDS: "From the records",
};

/** A table as text to edit: one row per line, cells separated by " | ". */
export function rowsToText(rows: readonly string[][]): string {
  return rows.map((row) => row.join(" | ")).join("\n");
}

export function textToRows(text: string, width: number): string[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, 300)
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return [...cells, ...Array(width).fill("")].slice(0, width);
    });
}

export type WorkpaperIntent = "draft" | "edit" | "prepare" | "reopen";

export type WorkpaperWrite =
  | { error: "invalid" }
  | {
      intent: WorkpaperIntent;
      path: string;
      body: Record<string, unknown>;
      controlId: string;
    };

export function workpaperWrite(fields: Record<string, string>): WorkpaperWrite {
  const organization = fields.organization_id ?? "";
  const project = fields.project_id ?? "";
  const control = fields.control_id ?? "";
  const intent = fields.intent ?? "";
  if (!UUID.test(organization) || !UUID.test(project) || !UUID.test(control)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organization}/projects/${project}/workpapers`;
  if (intent === "draft") {
    return {
      intent,
      path: `${base}/draft`,
      body: { control_id: control },
      controlId: control,
    };
  }
  const paper = fields.workpaper_id ?? "";
  const version = Number(fields.version ?? "");
  if (!UUID.test(paper) || !Number.isInteger(version) || version < 1) {
    return { error: "invalid" };
  }
  if (intent === "edit") {
    const key = fields.section ?? "";
    const kind = fields.kind ?? "";
    const value = fields.value ?? "";
    if (
      !/^[a-z0-9-]{1,60}$/.test(key) ||
      value.length > 12_000 ||
      CREDENTIAL.test(value)
    ) {
      return { error: "invalid" };
    }
    const width = Number(fields.width ?? "0");
    const body =
      kind === "text"
        ? { based_on: version, text: value }
        : kind === "table" &&
            Number.isInteger(width) &&
            width >= 1 &&
            width <= 20
          ? { based_on: version, rows: textToRows(value, width) }
          : null;
    if (body === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/${paper}/sections/${key}`,
      body,
      controlId: control,
    };
  }
  if (intent === "prepare") {
    const note = (fields.note ?? "").trim();
    if (note.length > 500 || CREDENTIAL.test(note)) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/${paper}/prepare`,
      body: { version, note },
      controlId: control,
    };
  }
  if (intent === "reopen") {
    const reason = (fields.reason ?? "").trim();
    if (reason.length < 3 || reason.length > 500 || CREDENTIAL.test(reason)) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/${paper}/reopen`,
      body: { version, reason },
      controlId: control,
    };
  }
  return { error: "invalid" };
}

export type WorkpaperNotice =
  | "wp-drafting"
  | "wp-saved"
  | "wp-prepared"
  | "wp-reopened"
  | "wp-blocked"
  | "wp-denied"
  | "wp-invalid"
  | "wp-unavailable";

export const WORKPAPER_NOTICES: Record<WorkpaperNotice, string> = {
  "wp-drafting":
    "The agent is drafting the workpapers from the records and the evidence. Sections a person wrote stay as they are.",
  "wp-saved": "Section saved as a new version.",
  "wp-prepared": "Workpaper prepared. It is frozen until someone reopens it.",
  "wp-reopened": "Workpaper reopened for changes.",
  "wp-blocked":
    "That could not be done: the workpaper changed, is being drafted, is prepared, or its testing is not signed off yet.",
  "wp-denied": "Your role cannot change this workpaper.",
  "wp-invalid":
    "Check the section and try again. A reason is needed to reopen.",
  "wp-unavailable": "That could not be saved. Try again.",
};

const DONE: Record<WorkpaperIntent, WorkpaperNotice> = {
  draft: "wp-drafting",
  edit: "wp-saved",
  prepare: "wp-prepared",
  reopen: "wp-reopened",
};

export function workpaperNoticeFor(
  intent: WorkpaperIntent,
  status: number,
): WorkpaperNotice {
  if (status === 200) {
    return DONE[intent];
  }
  if (status === 409) {
    return "wp-blocked";
  }
  if (status === 403 || status === 404) {
    return "wp-denied";
  }
  if (status === 422) {
    return "wp-invalid";
  }
  return "wp-unavailable";
}

export function parseWorkpaperNotice(
  value: string | null,
): WorkpaperNotice | null {
  return (
    (Object.keys(WORKPAPER_NOTICES) as WorkpaperNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}
