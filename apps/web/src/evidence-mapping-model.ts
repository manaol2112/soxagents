/**
 * The evidence-to-attribute mapping of a control (Milestone 3b): the latest run as the
 * API records it. Every reference is a passage the file holds, located by the API to a
 * page, a sheet, a row and a column, or a cell; nothing here derives a status or a
 * location. A run is a proposal for a person, never a test conclusion.
 */

/** The five evidence statuses, and NOT_MAPPED: the model call did not complete, which
 * says nothing about the evidence (M3b closure). */
export type MappingStatus =
  | "MISSING"
  | "INCOMPLETE"
  | "CONTRADICTORY"
  | "POTENTIALLY_SUFFICIENT"
  | "UNKNOWN"
  | "NOT_MAPPED";

export type MappingReference = {
  fileId: string;
  fileName: string;
  quote: string;
  location: string;
  page: number | null;
  sheet: string | null;
  row: number | null;
  column: string | null;
  cell: string | null;
};

export type MappingFact = { text: string; reference: number | null };

/** A passage kept apart for a person to review, never support (M3d closure): it asserts
 * something without the record of it, gives instructions to its reader, or claims to speak
 * for the audit, a reviewer, an approver or a system. */
export type ConcernKind =
  | "INSTRUCTION"
  | "IMPERSONATION"
  | "AUDIT_CLAIM"
  | "UNCORROBORATED";

export type MappingConcern = {
  kind: ConcernKind;
  reason: string;
  fileName: string;
  quote: string;
  location: string;
};

export const CONCERN_KIND_LABELS: Record<ConcernKind, string> = {
  INSTRUCTION: "Instruction to the reader",
  IMPERSONATION: "Claims to speak for someone",
  AUDIT_CLAIM: "Claim about the audit",
  UNCORROBORATED: "Needs corroboration",
};

const CONCERN_KINDS: ReadonlyArray<ConcernKind> = [
  "INSTRUCTION",
  "IMPERSONATION",
  "AUDIT_CLAIM",
  "UNCORROBORATED",
];
export type MappingConflict = { text: string; references: number[] };

export type AttributeMapping = {
  index: number;
  attribute: string;
  status: MappingStatus;
  required: string;
  candidates: Array<{ fileName: string; readable: boolean; kind: string }>;
  references: MappingReference[];
  facts: MappingFact[];
  inferences: string[];
  missing: string[];
  conflicts: MappingConflict[];
  concerns: MappingConcern[];
  note: string;
  source: string;
};

export type EvidenceMappingRun = {
  id: string;
  controlId: string;
  planRevision: number;
  createdAt: string;
  requestedBy: string;
  source: string;
  note: string;
  files: Array<{
    fileId: string;
    fileName: string;
    readable: boolean;
    kind: string;
  }>;
  mappings: AttributeMapping[];
  stale: boolean;
  staleReasons: string[];
};

export const MAPPING_STATUS_LABELS: Record<MappingStatus, string> = {
  MISSING: "Missing",
  INCOMPLETE: "Incomplete",
  CONTRADICTORY: "Contradictory",
  POTENTIALLY_SUFFICIENT: "Potentially sufficient",
  UNKNOWN: "Unknown",
  NOT_MAPPED: "Not mapped (the model call failed)",
};

export const MAPPING_STATUS_TONES: Record<
  MappingStatus,
  "neutral" | "warning" | "danger" | "success" | "info"
> = {
  MISSING: "danger",
  INCOMPLETE: "warning",
  CONTRADICTORY: "danger",
  POTENTIALLY_SUFFICIENT: "success",
  UNKNOWN: "neutral",
  NOT_MAPPED: "warning",
};

const STATUSES: ReadonlyArray<MappingStatus> = [
  "MISSING",
  "INCOMPLETE",
  "CONTRADICTORY",
  "POTENTIALLY_SUFFICIENT",
  "UNKNOWN",
  "NOT_MAPPED",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

function parseReference(value: unknown): MappingReference | null {
  if (!isRecord(value) || typeof value.file_id !== "string") {
    return null;
  }
  return {
    fileId: value.file_id,
    fileName: str(value.file_name),
    quote: str(value.quote),
    location: str(value.location),
    page: num(value.page),
    sheet: typeof value.sheet === "string" ? value.sheet : null,
    row: num(value.row),
    column: typeof value.column === "string" ? value.column : null,
    cell: typeof value.cell === "string" ? value.cell : null,
  };
}

function parseConcern(value: unknown): MappingConcern | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = CONCERN_KINDS.find((k) => k === value.kind);
  if (kind === undefined || str(value.quote) === "") {
    return null;
  }
  return {
    kind,
    reason: str(value.reason),
    fileName: str(value.file_name),
    quote: str(value.quote),
    location: str(value.location),
  };
}

function parseMapping(value: unknown): AttributeMapping | null {
  if (!isRecord(value) || typeof value.attribute_index !== "number") {
    return null;
  }
  const status = STATUSES.find((s) => s === value.status);
  if (status === undefined) {
    return null;
  }
  return {
    index: value.attribute_index,
    attribute: str(value.attribute_text),
    status,
    required: str(value.required),
    candidates: (Array.isArray(value.candidates) ? value.candidates : [])
      .filter(isRecord)
      .map((c) => ({
        fileName: str(c.file_name),
        readable: c.readable === true,
        kind: str(c.kind),
      })),
    references: (Array.isArray(value.references) ? value.references : [])
      .map(parseReference)
      .filter((r): r is MappingReference => r !== null),
    facts: (Array.isArray(value.facts) ? value.facts : [])
      .filter(isRecord)
      .map((f) => ({ text: str(f.text), reference: num(f.reference) })),
    inferences: strings(value.inferences),
    missing: strings(value.missing),
    conflicts: (Array.isArray(value.conflicts) ? value.conflicts : [])
      .filter(isRecord)
      .map((c) => ({
        text: str(c.text),
        references: Array.isArray(c.references)
          ? c.references.filter((n): n is number => typeof n === "number")
          : [],
      })),
    concerns: (Array.isArray(value.concerns) ? value.concerns : [])
      .map(parseConcern)
      .filter((c): c is MappingConcern => c !== null),
    note: str(value.note),
    source: str(value.source),
  };
}

/** The latest run, or null when none exists or the body is not one. */
export function parseEvidenceMapping(
  value: unknown,
): EvidenceMappingRun | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  return {
    id: value.id,
    controlId: str(value.control_id),
    planRevision: num(value.plan_revision) ?? 0,
    createdAt: str(value.created_at),
    requestedBy: str(value.requested_by),
    source: str(value.source),
    note: str(value.note),
    files: (Array.isArray(value.files) ? value.files : [])
      .filter(isRecord)
      .map((f) => ({
        fileId: str(f.file_id),
        fileName: str(f.file_name),
        readable: f.readable === true,
        kind: str(f.kind),
      })),
    mappings: (Array.isArray(value.mappings) ? value.mappings : [])
      .map(parseMapping)
      .filter((m): m is AttributeMapping => m !== null)
      .sort((a, b) => a.index - b.index),
    stale: value.stale === true,
    staleReasons: strings(value.stale_reasons),
  };
}

/** One line per run for the step: how many attributes stand where. */
export function mappingSummary(run: EvidenceMappingRun): string {
  const counts = new Map<MappingStatus, number>();
  for (const mapping of run.mappings) {
    counts.set(mapping.status, (counts.get(mapping.status) ?? 0) + 1);
  }
  const parts = STATUSES.filter((s) => counts.has(s)).map(
    (s) => `${counts.get(s)} ${MAPPING_STATUS_LABELS[s].toLowerCase()}`,
  );
  const concerns = run.mappings.reduce((n, m) => n + m.concerns.length, 0);
  if (concerns > 0) {
    parts.push(
      `${concerns} ${concerns === 1 ? "passage" : "passages"} for review`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "No attributes mapped";
}
