/**
 * The evidence register: every stored file, where it came from, the control it is filed
 * to, and what the agents made of it. Also the upload plan for a folder or files, and the
 * writes the register makes. The API is the source of truth; this only shapes it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_UPLOAD_BYTES = 25_000_000;
const SYSTEM_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export type FileState = "READING" | "NEEDS_MATCH" | "FILED" | "NOT_LINKED";
export type FiledBy = "AGENT" | "PERSON" | "EMAIL";

export type RegisterApplication = { id: string; name: string };

export type RegisterControl = {
  id: string;
  controlRef: string;
  /** The instance's application (Milestone 8.5); "" when the control has none. */
  application: string;
  /** The units it operates in, when split by them (Release 1); "" otherwise. */
  units: string;
  title: string;
  area: string;
  /** The applications the control covers, each tested on its own. */
  applications: RegisterApplication[];
};

export type RegisterSuggestion = {
  controlId: string;
  controlRef: string;
  title: string;
  reason: string;
};

export type RegisterFile = {
  id: string;
  fileName: string;
  folderPath: string;
  source: "UPLOAD" | "MAILBOX";
  sizeBytes: number;
  createdAt: string;
  addedBy: string;
  batchId: string | null;
  state: FileState;
  filedBy: FiledBy | null;
  confidence: number | null;
  matchReason: string;
  suggestions: RegisterSuggestion[];
  filingVersion: number | null;
  control: RegisterControl | null;
  request: { id: string; status: string; providedDirectly: boolean } | null;
  analysisId: string | null;
  readStatus: string | null;
  kind: string | null;
  kindLabel: string | null;
  kindConfirmed: boolean;
  summary: string;
  reviewStatus: string | null;
  reviewProposed: string | null;
  reviewDecision: string | null;
  /** Which of its control's applications the file shows: ONE, ALL, UNKNOWN, or SOME
   * (several a person named, in namedApplications). */
  application: RegisterApplication | null;
  applicationScope: "ONE" | "SOME" | "ALL" | "UNKNOWN" | null;
  namedApplications: RegisterApplication[];
  applicationBy: "AGENT" | "PERSON" | null;
};

/** A file a person withdrew. Its custody record stays; it is not evidence any more. */
export type WithdrawnFile = {
  id: string;
  fileName: string;
  folderPath: string;
  source: "UPLOAD" | "MAILBOX";
  sizeBytes: number;
  createdAt: string;
  addedBy: string;
  reason: string;
  withdrawnBy: string;
  withdrawnAt: string;
  /** The file that took its place. A replaced file is not restored. */
  replacedBy: string | null;
  replacedByName: string | null;
  control: RegisterControl | null;
};

export type EvidenceRegister = {
  files: RegisterFile[];
  controls: RegisterControl[];
  withdrawn: WithdrawnFile[];
};

function parseWithdrawn(value: unknown): WithdrawnFile | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.file_name !== "string"
  ) {
    return null;
  }
  const replacedBy =
    typeof value.replaced_by === "string" && UUID.test(value.replaced_by)
      ? value.replaced_by
      : null;
  return {
    id: value.id,
    fileName: value.file_name,
    folderPath: str(value.folder_path),
    source: value.source === "MAILBOX" ? "MAILBOX" : "UPLOAD",
    sizeBytes: typeof value.size_bytes === "number" ? value.size_bytes : 0,
    createdAt: str(value.created_at),
    addedBy: str(value.added_by),
    reason: str(value.reason),
    withdrawnBy: str(value.withdrawn_by),
    withdrawnAt: str(value.withdrawn_at),
    replacedBy,
    replacedByName:
      replacedBy === null ? null : optional(value.replaced_by_name),
    control: parseControl(value.control),
  };
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const optional = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** "ITGC-AC-01 · Oracle": the control and the application its instance tests, then the
 * units it operates in when split by them ("RTR-02 · Acme UK Ltd"). */
export function controlLabel(control: {
  controlRef: string;
  application: string;
  units?: string;
}): string {
  return [control.controlRef, control.application, control.units ?? ""]
    .filter((part) => part !== "")
    .join(" · ");
}

function parseControl(value: unknown): RegisterControl | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id)
  ) {
    return null;
  }
  return {
    id: value.id,
    controlRef: str(value.control_ref),
    application: str(value.application),
    units: str(value.units),
    title: str(value.title),
    area: str(value.area),
    applications: (Array.isArray(value.applications) ? value.applications : [])
      .filter(isRecord)
      .filter((app) => typeof app.id === "string" && UUID.test(app.id))
      .map((app) => ({ id: str(app.id), name: str(app.name) })),
  };
}

const STATES = new Set<FileState>([
  "READING",
  "NEEDS_MATCH",
  "FILED",
  "NOT_LINKED",
]);
const FILERS = new Set<FiledBy>(["AGENT", "PERSON", "EMAIL"]);

export function parseRegister(value: unknown): EvidenceRegister | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.controls)
  ) {
    return null;
  }
  const files: RegisterFile[] = [];
  for (const item of value.files) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      typeof item.file_name !== "string" ||
      typeof item.size_bytes !== "number" ||
      !STATES.has(item.state as FileState)
    ) {
      return null;
    }
    const request = isRecord(item.request) ? item.request : null;
    files.push({
      id: item.id,
      fileName: item.file_name,
      folderPath: str(item.folder_path),
      source: item.source === "UPLOAD" ? "UPLOAD" : "MAILBOX",
      sizeBytes: item.size_bytes,
      createdAt: str(item.created_at),
      addedBy: str(item.added_by),
      batchId: optional(item.batch_id),
      state: item.state as FileState,
      filedBy: FILERS.has(item.filed_by as FiledBy)
        ? (item.filed_by as FiledBy)
        : null,
      confidence: typeof item.confidence === "number" ? item.confidence : null,
      matchReason: str(item.match_reason),
      suggestions: (Array.isArray(item.suggestions) ? item.suggestions : [])
        .filter(isRecord)
        .filter(
          (entry) =>
            typeof entry.control_id === "string" && UUID.test(entry.control_id),
        )
        .map((entry) => ({
          controlId: str(entry.control_id),
          controlRef: str(entry.control_ref),
          title: str(entry.title),
          reason: str(entry.reason),
        })),
      filingVersion:
        typeof item.filing_version === "number" ? item.filing_version : null,
      control: parseControl(item.control),
      request:
        request !== null && typeof request.id === "string"
          ? {
              id: request.id,
              status: str(request.status),
              providedDirectly: request.provided_directly === true,
            }
          : null,
      analysisId: optional(item.analysis_id),
      readStatus: optional(item.read_status),
      kind: optional(item.kind),
      kindLabel: optional(item.kind_label),
      kindConfirmed: item.kind_confirmed === true,
      summary: str(item.summary),
      reviewStatus: optional(item.review_status),
      reviewProposed: optional(item.review_proposed),
      reviewDecision: optional(item.review_decision),
      application:
        isRecord(item.application) && typeof item.application.id === "string"
          ? { id: item.application.id, name: str(item.application.name) }
          : null,
      applicationScope:
        item.application_scope === "ONE" ||
        item.application_scope === "SOME" ||
        item.application_scope === "ALL" ||
        item.application_scope === "UNKNOWN"
          ? item.application_scope
          : null,
      namedApplications: (Array.isArray(item.applications)
        ? item.applications
        : []
      )
        .filter(isRecord)
        .filter((entry) => typeof entry.id === "string")
        .map((entry) => ({ id: str(entry.id), name: str(entry.name) })),
      applicationBy:
        item.application_by === "AGENT" || item.application_by === "PERSON"
          ? item.application_by
          : null,
    });
  }
  const controls = value.controls
    .map(parseControl)
    .filter((item): item is RegisterControl => item !== null);
  const withdrawn = (Array.isArray(value.withdrawn) ? value.withdrawn : [])
    .map(parseWithdrawn)
    .filter((item): item is WithdrawnFile => item !== null);
  return { files, controls, withdrawn };
}

// The view

export type EvidenceTab = "files" | "requests" | "mailbox";
export type FileQueue =
  | "needs_match"
  | "agent"
  | "reading"
  | "email"
  | "withdrawn";
export type EvidenceView = {
  tab: EvidenceTab;
  queue: FileQueue | null;
  query: string;
  group: "list" | "control";
  /** The file open in the side panel. */
  file: string | null;
};

export const DEFAULT_EVIDENCE_VIEW: EvidenceView = {
  tab: "requests",
  queue: null,
  query: "",
  group: "list",
  file: null,
};

export const FILE_QUEUES: ReadonlyArray<[FileQueue | null, string]> = [
  [null, "All files"],
  ["needs_match", "Needs a match"],
  ["agent", "Filed by agent"],
  ["reading", "Being read"],
  ["email", "From email"],
  ["withdrawn", "Withdrawn"],
];

export function parseEvidenceView(params: {
  tab: string | null;
  queue: string | null;
  q: string | null;
  group: string | null;
  file: string | null;
}): EvidenceView {
  // Requests is the default view; the Evidence Library is "files", the Client Portal is
  // "mailbox" (the names stay, so older links still open the same view).
  const tab: EvidenceTab =
    params.tab === "files" || params.tab === "mailbox"
      ? params.tab
      : "requests";
  const queue = FILE_QUEUES.find(
    ([key]) => key !== null && key === params.queue,
  );
  return {
    tab,
    queue: queue === undefined ? null : queue[0],
    query: (params.q ?? "").trim().slice(0, 120),
    group: params.group === "control" ? "control" : "list",
    file: params.file !== null && UUID.test(params.file) ? params.file : null,
  };
}

export function inFileQueue(
  file: RegisterFile,
  queue: FileQueue | null,
): boolean {
  switch (queue) {
    case null:
      return true;
    case "needs_match":
      return file.state === "NEEDS_MATCH" || file.state === "NOT_LINKED";
    case "agent":
      return file.state === "FILED" && file.filedBy === "AGENT";
    case "reading":
      return file.state === "READING" || isReading(file);
    case "email":
      return file.source === "MAILBOX";
    case "withdrawn":
      // Withdrawn files are listed apart, never with the evidence.
      return false;
  }
}

export function filterWithdrawn(
  files: readonly WithdrawnFile[],
  query: string,
): WithdrawnFile[] {
  const words = query.toLowerCase().split(/s+/).filter(Boolean);
  return files.filter((file) => {
    const haystack = [
      file.fileName,
      file.folderPath,
      file.control?.controlRef ?? "",
      file.reason,
      file.withdrawnBy,
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function isReading(file: RegisterFile): boolean {
  return file.readStatus === "PENDING" || file.readStatus === "WORKING";
}

export function filterFiles(
  files: readonly RegisterFile[],
  view: Pick<EvidenceView, "queue" | "query">,
): RegisterFile[] {
  const words = view.query.toLowerCase().split(/\s+/).filter(Boolean);
  return files.filter((file) => {
    if (!inFileQueue(file, view.queue)) {
      return false;
    }
    if (words.length === 0) {
      return true;
    }
    const haystack = [
      file.fileName,
      file.folderPath,
      file.control?.controlRef ?? "",
      file.control?.title ?? "",
      file.kindLabel ?? "",
      file.addedBy,
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export type FileGroup = {
  key: string;
  label: string;
  detail: string;
  files: RegisterFile[];
};

/** Files by control, in control order. Unfiled files come first: they need a person. */
export function byControl(files: readonly RegisterFile[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const file of files) {
    const key = file.control?.id ?? "unfiled";
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.files.push(file);
      continue;
    }
    groups.set(key, {
      key,
      label:
        file.control === null
          ? "Not filed to a control"
          : `${file.control.controlRef} · ${file.control.title}`,
      detail: file.control?.area ?? "",
      files: [file],
    });
  }
  return [...groups.values()].sort((left, right) =>
    left.key === "unfiled"
      ? -1
      : right.key === "unfiled"
        ? 1
        : left.label.localeCompare(right.label),
  );
}

export function fileCounts(files: readonly RegisterFile[]): {
  total: number;
  needsMatch: number;
  filedByAgent: number;
  reading: number;
} {
  return {
    total: files.length,
    needsMatch: files.filter((file) => inFileQueue(file, "needs_match")).length,
    filedByAgent: files.filter((file) => inFileQueue(file, "agent")).length,
    reading: files.filter((file) => inFileQueue(file, "reading")).length,
  };
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  APPROVAL_PENDING: { label: "Awaiting approval", tone: "info" },
  SENT: { label: "Requested", tone: "info" },
  WAITING_FOR_RESPONSE: { label: "Requested", tone: "info" },
  PARTIALLY_RECEIVED: { label: "Partly received", tone: "warning" },
  RECEIVED: { label: "Received", tone: "success" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  ESCALATED: { label: "Escalated", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

/** What the agents made of the file, as one status for the table. */
export function agentStatus(file: RegisterFile): { label: string; tone: Tone } {
  if (file.state === "READING" || isReading(file)) {
    return { label: "Reading", tone: "info" };
  }
  if (file.readStatus === "FAILED") {
    return { label: "Not read", tone: "danger" };
  }
  if (file.reviewStatus !== null) {
    if (file.reviewDecision !== null) {
      return { label: "Review signed off", tone: "success" };
    }
    if (file.reviewStatus === "NEEDS_PERSON") {
      return { label: "Needs a reviewer", tone: "warning" };
    }
    return file.reviewProposed === "EXCEPTION"
      ? { label: "Exception proposed", tone: "danger" }
      : { label: "Reviewed · to sign off", tone: "info" };
  }
  return {
    label: file.kindConfirmed ? "Kind confirmed" : "Read",
    tone: "neutral",
  };
}

export function filedLabel(file: RegisterFile): string {
  switch (file.filedBy) {
    case "AGENT":
      return file.confidence === null
        ? "Filed by agent"
        : `Filed by agent · ${Math.round(file.confidence * 100)}%`;
    case "PERSON":
      return "Filed by a person";
    case "EMAIL":
      return "From the request's reply";
    default:
      return "";
  }
}

/** Why evidence cannot be added here, or null when it can. */
export function uploadBlocked(
  projectStatus: string,
  role: string,
): string | null {
  if (role === "REVIEWER") {
    return "Your role can view evidence. It cannot add it.";
  }
  switch (projectStatus) {
    case "ACTIVE":
      return null;
    case "ARCHIVED":
      return "This engagement is archived, so no new evidence can be added. Its evidence stays readable. Archived engagements are closed for good; open an active engagement to add evidence.";
    case "PAUSED":
      return "This engagement is paused, so no new evidence can be added. Resume it under Engagements to add evidence.";
    case "COMPLETED":
      return "This engagement is completed, so no new evidence can be added. Its evidence stays readable. An owner or admin can reopen it under Engagements.";
    default:
      return "This engagement has not launched yet. Finish setup and launch it to add evidence.";
  }
}

/** A file's application, in words: the one it shows, all of them, or not known. */
export function applicationLabel(file: RegisterFile): string {
  if (file.applicationScope === "ALL") {
    return "All applications";
  }
  if (file.applicationScope === "ONE" && file.application !== null) {
    return file.application.name;
  }
  if (file.applicationScope === "SOME") {
    return file.namedApplications.map((app) => app.name).join(", ");
  }
  return file.applicationScope === "UNKNOWN" ? "Application not known" : "";
}

export type ApplicationGroup = {
  key: string;
  label: string;
  files: RegisterFile[];
};

/**
 * A control's files by the application they show, in the control's own order. Files for
 * every application are their own group, and files whose application is not known
 * come first: they need a person.
 *
 * A control instance tests one application (Milestone 8.5): only that application is a
 * group. A file here that shows a sibling application is listed apart, as the evidence
 * of that application's instance.
 */
export function byApplicationOf(
  files: readonly RegisterFile[],
  family: readonly RegisterApplication[],
  instance = "",
): ApplicationGroup[] {
  const mineOnly = family.filter((app) => app.name === instance);
  const applications = mineOnly.length > 0 ? mineOnly : family;
  const elsewhere =
    mineOnly.length > 0
      ? files.filter(
          (file) =>
            file.applicationScope === "ONE" &&
            file.application !== null &&
            file.application.name !== instance,
        )
      : [];
  const unknown = files.filter(
    (file) =>
      file.applicationScope === "UNKNOWN" ||
      (file.applicationScope === null && applications.length > 1),
  );
  const groups: ApplicationGroup[] = [];
  if (unknown.length > 0) {
    groups.push({
      key: "unknown",
      label: "Application not known",
      files: unknown,
    });
  }
  for (const app of applications) {
    const mine = files.filter(
      (file) =>
        (file.applicationScope === "ONE" && file.application?.id === app.id) ||
        (file.applicationScope === "SOME" &&
          file.namedApplications.some((named) => named.id === app.id)),
    );
    if (mine.length > 0 || applications.length > 1) {
      groups.push({ key: app.id, label: app.name, files: mine });
    }
  }
  const all = files.filter((file) => file.applicationScope === "ALL");
  if (all.length > 0) {
    groups.push({ key: "all", label: "All applications", files: all });
  }
  if (elsewhere.length > 0) {
    groups.push({
      key: "elsewhere",
      label: "Shows another application",
      files: elsewhere,
    });
  }
  // A control with one application, or none, keeps any untagged file visible.
  const shown = new Set(
    groups.flatMap((group) => group.files.map((file) => file.id)),
  );
  const rest = files.filter((file) => !shown.has(file.id));
  if (rest.length > 0) {
    groups.push({
      key: "rest",
      label: applications[0]?.name ?? "Evidence",
      files: rest,
    });
  }
  return groups;
}

export type ApplicationWrite =
  | { error: "invalid" }
  | {
      path: string;
      body: { scope: "ONE" | "ALL"; application_id: string | null };
    };

export function applicationWrite(
  fields: Record<string, string>,
): ApplicationWrite {
  const organization = fields.organization_id ?? "";
  const project = fields.project_id ?? "";
  const file = fields.file_id ?? "";
  const choice = fields.application ?? "";
  if (
    !UUID.test(organization) ||
    !UUID.test(project) ||
    !UUID.test(file) ||
    (choice !== "ALL" && !UUID.test(choice))
  ) {
    return { error: "invalid" };
  }
  return {
    path: `/organizations/${organization}/projects/${project}/evidence-files/${file}/application`,
    body:
      choice === "ALL"
        ? { scope: "ALL", application_id: null }
        : { scope: "ONE", application_id: choice },
  };
}

// Uploading

export type PlannedUpload = {
  index: number;
  name: string;
  folder: string;
  size: number;
};

export type UploadPlan = {
  accepted: PlannedUpload[];
  skipped: Array<{ name: string; reason: string }>;
};

/** Which files to send. A path is "Folder/Sub/file.xlsx", as a folder picker gives it. */
export function planUploads(
  entries: ReadonlyArray<{ path: string; size: number }>,
): UploadPlan {
  const accepted: PlannedUpload[] = [];
  const skipped: UploadPlan["skipped"] = [];
  entries.forEach((entry, index) => {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    const name = parts.pop() ?? "";
    const folder = parts
      .filter((part) => part !== "." && part !== "..")
      .join("/");
    const lowered = name.toLowerCase();
    if (
      name === "" ||
      SYSTEM_FILES.has(lowered) ||
      lowered.startsWith("~$") ||
      lowered.startsWith("._") ||
      parts.some((part) => part.startsWith("."))
    ) {
      skipped.push({ name: name || entry.path, reason: "System file" });
    } else if (entry.size === 0) {
      skipped.push({ name, reason: "Empty file" });
    } else if (entry.size > MAX_UPLOAD_BYTES) {
      skipped.push({ name, reason: "Larger than 25 MB" });
    } else if (name.length > 200 || folder.length > 500) {
      skipped.push({ name, reason: "Name or folder is too long" });
    } else {
      accepted.push({ index, name, folder, size: entry.size });
    }
  });
  return { accepted, skipped };
}

export type UploadTarget =
  | { error: "invalid" }
  | { path: string; query: string };

/** The API call for one uploaded file, from the live upload route's query. */
/** What an upload says about the systems a file applies to: ALL, or the ticked ones
 * (in the order ticked); null while none is ticked. */
export function systemsAnswer(
  all: boolean,
  ticked: readonly string[],
): string | null {
  if (all) {
    return "ALL";
  }
  const unique = [...new Set(ticked)];
  return unique.length === 0 ? null : unique.join(",");
}

export function uploadTarget(params: URLSearchParams): UploadTarget {
  const organization = params.get("organization") ?? "";
  const project = params.get("project") ?? "";
  const batch = params.get("batch") ?? "";
  const name = params.get("name") ?? "";
  const folder = params.get("path") ?? "";
  const request = params.get("request") ?? "";
  // An item of the request the file is added for; only with its request.
  const requirement = params.get("requirement") ?? "";
  // The applications a person says it applies to: ALL, or application ids.
  const applications = params.get("applications") ?? "";
  if (
    (request !== "" && !UUID.test(request)) ||
    (requirement !== "" && (request === "" || !UUID.test(requirement))) ||
    (applications !== "" &&
      (request === "" ||
        (applications !== "ALL" &&
          !applications
            .split(",")
            .every((part, index) => index < 50 && UUID.test(part))))) ||
    !UUID.test(organization) ||
    !UUID.test(project) ||
    !UUID.test(batch) ||
    name === "" ||
    name.length > 200 ||
    folder.length > 500
  ) {
    return { error: "invalid" };
  }
  const query = new URLSearchParams({ batch_id: batch, name, path: folder });
  if (request !== "") {
    // Added on a request: filed to it, not matched.
    query.set("request_id", request);
  }
  if (requirement !== "") {
    // Added on one item of the request: for that item only.
    query.set("requirement_id", requirement);
  }
  if (applications !== "") {
    query.set("applications", applications);
  }
  return {
    path: `/organizations/${organization}/projects/${project}/evidence-uploads`,
    query: query.toString(),
  };
}

export type FilingWrite =
  | { error: "invalid" }
  | {
      path: string;
      body: { version: number; control_id: string | null };
    };

export function filingWrite(fields: Record<string, string>): FilingWrite {
  const organization = fields.organization_id ?? "";
  const project = fields.project_id ?? "";
  const file = fields.file_id ?? "";
  const version = Number(fields.version ?? "");
  const control = fields.control_id ?? "";
  if (
    !UUID.test(organization) ||
    !UUID.test(project) ||
    !UUID.test(file) ||
    !Number.isInteger(version) ||
    version < 1 ||
    (control !== "" && control !== "none" && !UUID.test(control))
  ) {
    return { error: "invalid" };
  }
  return {
    path: `/organizations/${organization}/projects/${project}/evidence-files/${file}/filing`,
    body: {
      version,
      control_id: control === "" || control === "none" ? null : control,
    },
  };
}

export type FilingNotice =
  | "filed"
  | "unfiled"
  | "stale"
  | "denied"
  | "invalid"
  | "unavailable";

export const FILING_NOTICES: Record<FilingNotice, string> = {
  filed:
    "Filed. The agent reads it again against its control and updates the request.",
  unfiled: "Taken off its control. It waits in Needs a match.",
  stale: "That file changed or is still being read. Refresh and try again.",
  denied: "That is not available to you.",
  invalid: "Choose a control first.",
  unavailable: "The evidence register could not be reached. Try again.",
};

export function filingNoticeFor(
  status: number,
  unfiled: boolean,
): FilingNotice {
  if (status === 200) {
    return unfiled ? "unfiled" : "filed";
  }
  if (status === 409) {
    return "stale";
  }
  if (status === 403 || status === 404) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

/** Filing notices travel as "filing-<notice>", apart from the page's other notices. */
export function filingNoticeParam(notice: FilingNotice): string {
  return `filing-${notice}`;
}

export function parseFilingNotice(value: string | null): FilingNotice | null {
  return (
    (Object.keys(FILING_NOTICES) as FilingNotice[]).find(
      (notice) => value === filingNoticeParam(notice),
    ) ?? null
  );
}
