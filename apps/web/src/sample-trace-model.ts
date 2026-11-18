/**
 * The sample of one, traced across a design item's files (product owner, 31 October
 * 2026; services/api/ai_workforce_api/sample_traces.py). The agent proposes the sample
 * from the evidence, a person confirms it or picks another, and each file says what it
 * shows for the sample instead of the reader's per-file coverage. Pure: read from the API's
 * answer and checked before anything is sent.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TraceStatus = "NO_LISTING" | "CHOOSE" | "PROPOSED" | "CONFIRMED";
export type TraceRole = "EVENT" | "REMOVAL" | "ACTIVITY" | "OPENED" | "CLOSED";
export type TraceFileState =
  | "FOUND"
  | "SEVERAL"
  | "NOT_FOUND"
  | "NAMED"
  | "NOT_NAMED"
  | "GENERAL"
  | "READING"
  | "UNREADABLE";

export type TraceDate = {
  label: string;
  date: string;
  role: TraceRole;
  days: number | null;
  over: boolean;
};

export type TraceFile = {
  fileId: string;
  fileName: string;
  system: string;
  listing: boolean;
  state: TraceFileState;
  rowNumber: number | null;
  summary: string;
  dates: TraceDate[];
};

export type TraceSubject = {
  label: string;
  fileId: string;
  fileName: string;
  rowNumber: number;
  origin: "PROPOSED" | "PICKED" | "CONFIRMED";
  confirmedBy: string;
  confirmedAt: string | null;
};

export type TraceCandidate = {
  label: string;
  fileId: string;
  fileName: string;
  rowNumber: number;
  reason: string;
};

export type TraceObservation = {
  kind: "LATE" | "NOT_TRACED" | "ACTIVITY";
  fileId: string;
  title: string;
  question: string;
  recorded: boolean;
};

export type Trace = {
  status: TraceStatus;
  noun: string;
  subject: TraceSubject | null;
  reasons: string[];
  candidates: TraceCandidate[];
  listings: Array<{ fileId: string; fileName: string; rows: number }>;
  files: TraceFile[];
  event: { label: string; date: string; fileName: string } | null;
  limitDays: number | null;
  observations: TraceObservation[];
  ready: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function id(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function count(value: unknown, low = 0): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= low
    ? value
    : null;
}

const STATUSES: TraceStatus[] = [
  "NO_LISTING",
  "CHOOSE",
  "PROPOSED",
  "CONFIRMED",
];
const ROLES: TraceRole[] = ["EVENT", "REMOVAL", "ACTIVITY", "OPENED", "CLOSED"];
const STATES: TraceFileState[] = [
  "FOUND",
  "SEVERAL",
  "NOT_FOUND",
  "NAMED",
  "NOT_NAMED",
  "GENERAL",
  "READING",
  "UNREADABLE",
];
const KINDS = ["LATE", "NOT_TRACED", "ACTIVITY"] as const;
const ORIGINS = ["PROPOSED", "PICKED", "CONFIRMED"] as const;

function list<T>(value: unknown, read: (entry: unknown) => T | null): T[] {
  return Array.isArray(value)
    ? value.map(read).filter((entry): entry is T => entry !== null)
    : [];
}

/** The API's trace, kept only where every part is what the API promises. */
export function parseTrace(value: unknown): Trace | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = STATUSES.find((each) => each === value.status);
  if (status === undefined) {
    return null;
  }
  const subjectOf = (entry: unknown): TraceSubject | null => {
    if (!isRecord(entry)) {
      return null;
    }
    const fileId = id(entry.file_id);
    const rowNumber = count(entry.row_number, 1);
    const origin = ORIGINS.find((each) => each === entry.origin);
    if (fileId === null || rowNumber === null || origin === undefined) {
      return null;
    }
    return {
      label: text(entry.label),
      fileId,
      fileName: text(entry.file_name),
      rowNumber,
      origin,
      confirmedBy: text(entry.confirmed_by),
      confirmedAt:
        typeof entry.confirmed_at === "string" ? entry.confirmed_at : null,
    };
  };
  const dateOf = (entry: unknown): TraceDate | null => {
    if (!isRecord(entry)) {
      return null;
    }
    const role = ROLES.find((each) => each === entry.role);
    if (role === undefined || typeof entry.date !== "string") {
      return null;
    }
    return {
      label: text(entry.label),
      date: entry.date,
      role,
      days: typeof entry.days === "number" ? entry.days : null,
      over: entry.over === true,
    };
  };
  const fileOf = (entry: unknown): TraceFile | null => {
    if (!isRecord(entry)) {
      return null;
    }
    const fileId = id(entry.file_id);
    const state = STATES.find((each) => each === entry.state);
    if (fileId === null || state === undefined) {
      return null;
    }
    return {
      fileId,
      fileName: text(entry.file_name),
      system: text(entry.system),
      listing: entry.listing === true,
      state,
      rowNumber: count(entry.row_number, 1),
      summary: text(entry.summary),
      dates: list(entry.dates, dateOf),
    };
  };
  const event = isRecord(value.event) ? value.event : null;
  return {
    status,
    noun: text(value.noun) || "record",
    subject: subjectOf(value.subject),
    reasons: list(value.reasons, (entry) =>
      typeof entry === "string" ? entry : null,
    ),
    candidates: list(value.candidates, (entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const fileId = id(entry.file_id);
      const rowNumber = count(entry.row_number, 1);
      return fileId === null || rowNumber === null
        ? null
        : {
            label: text(entry.label),
            fileId,
            fileName: text(entry.file_name),
            rowNumber,
            reason: text(entry.reason),
          };
    }),
    listings: list(value.listings, (entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const fileId = id(entry.file_id);
      const rows = count(entry.rows);
      return fileId === null || rows === null
        ? null
        : { fileId, fileName: text(entry.file_name), rows };
    }),
    files: list(value.files, fileOf),
    event:
      event !== null && typeof event.date === "string"
        ? {
            label: text(event.label),
            date: event.date,
            fileName: text(event.file_name),
          }
        : null,
    limitDays: count(value.limit_days),
    observations: list(value.observations, (entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const kind = KINDS.find((each) => each === entry.kind);
      const fileId = id(entry.file_id);
      return kind === undefined || fileId === null
        ? null
        : {
            kind,
            fileId,
            title: text(entry.title),
            question: text(entry.question),
            recorded: entry.recorded === true,
          };
    }),
    ready: value.ready === true,
  };
}

/** Whether an item asks for one instance walked through: a design item asking for the
 * control's execution or a sample (request_details.SAMPLE_OF_ONE). */
export function tracesSample(item: {
  phase: string;
  categories: readonly string[];
}): boolean {
  return (
    item.phase === "DESIGN" &&
    item.categories.some(
      (category) => category === "CONTROL_EXECUTION" || category === "SAMPLE",
    )
  );
}

/** The subject's name without its ID, for the file lines: "Farah Navarro". */
export function shortLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "") || label;
}

/** What a file's line says once the trace has a sample, in place of the reader's
 * per-file coverage; null when the trace says nothing of the file. */
export function traceFileNote(
  trace: Trace | null,
  fileId: string,
): string | null {
  if (trace === null || trace.subject === null) {
    return null;
  }
  const entry = trace.files.find((file) => file.fileId === fileId);
  if (entry === undefined) {
    return null;
  }
  const who = shortLabel(trace.subject.label);
  switch (entry.state) {
    case "FOUND":
      return `traces ${who}, row ${entry.rowNumber ?? "?"}`;
    case "NAMED":
      return `names ${who}`;
    case "NOT_FOUND":
      return `no row for ${who}`;
    case "SEVERAL":
      return `several rows match ${who}`;
    case "NOT_NAMED":
      return `does not name ${who}`;
    default:
      return null;
  }
}

/** Business days against the event, as the trace's date line says them. */
export function daysWords(days: number | null): string {
  if (days === null) {
    return "";
  }
  if (days === 0) {
    return "same day";
  }
  const size = Math.abs(days);
  return `${size} business day${size === 1 ? "" : "s"} ${days > 0 ? "after" : "before"}`;
}

/** What the trace asks of the person, in one line. */
export function traceHeading(trace: Trace): string {
  switch (trace.status) {
    case "PROPOSED":
      return "Sample identified from the evidence";
    case "CONFIRMED":
      return trace.ready ? "Sample traced end to end" : "Sample trace";
    case "CHOOSE":
      return `Which ${trace.noun === "record" ? "item" : trace.noun} is the sample?`;
    default:
      return "Sample trace";
  }
}

export type TraceWrite =
  | { ok: true; path: string; body: Record<string, unknown> }
  | { ok: false };

/** The API call that records the sample a person settles on, checked before it is sent. */
export function traceWrite(fields: Record<string, unknown>): TraceWrite {
  const organization = id(fields.organization_id);
  const project = id(fields.project_id);
  const control = id(fields.control_id);
  const requirement = id(fields.requirement_id);
  const file = id(fields.file_id);
  const row = count(fields.row_number, 1);
  if (
    organization === null ||
    project === null ||
    control === null ||
    requirement === null ||
    file === null ||
    row === null ||
    row > 1_000_000
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    path: tracePath(organization, project, control, requirement),
    body: {
      file_id: file,
      row_number: row,
      proposed: fields.proposed === true,
    },
  };
}

/** The API path of an item's trace, or null when an id is not one. */
export function traceReadPath(params: URLSearchParams): string | null {
  const organization = id(params.get("organization"));
  const project = id(params.get("project"));
  const control = id(params.get("control"));
  const requirement = id(params.get("requirement"));
  if (
    organization === null ||
    project === null ||
    control === null ||
    requirement === null
  ) {
    return null;
  }
  return tracePath(organization, project, control, requirement);
}

function tracePath(
  organization: string,
  project: string,
  control: string,
  requirement: string,
): string {
  return `/organizations/${organization}/projects/${project}/controls/${control}/evidence-requirements/${requirement}/sample-trace`;
}

/** A trace problem the person can act on, from the API's status. */
export function traceProblem(status: number, detail: string): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    return detail.startsWith("the proposal changed")
      ? "The evidence changed since the sample was proposed. Review the sample again."
      : detail !== ""
        ? `${detail[0]?.toUpperCase() ?? ""}${detail.slice(1)}.`
        : "The sample could not be recorded.";
  }
  if (status === 403) {
    return "Only a member of the engagement team can confirm the sample.";
  }
  return "The trace could not be loaded. Try again.";
}
