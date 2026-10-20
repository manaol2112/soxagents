/**
 * The evidence owner's secure upload page (Milestone 8.12): what the API says about a
 * link and a verified session, parsed and checked before anything is shown. Everything
 * here is for someone outside the firm, so it is plain and names no internal states.
 */

export const PORTAL_COOKIE = "aw_portal";
export const MAX_UPLOAD = 25_000_000;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LinkState = "ACTIVE" | "CLOSED" | "REVOKED";

export type LinkStatus = {
  state: LinkState;
  engagement: string;
  firm: string;
  maskedEmail: string;
};

export type PortalFile = {
  fileName: string;
  sizeBytes: number;
  addedAt: string;
};

/** Reference material the audit team shared with the recipient for one request. */
export type PortalReference = {
  id: string;
  fileName: string;
  sizeBytes: number;
};

/** Where a request stands for the owner, derived by the API from its records. A file
 * arriving never completes anything: only the audit team's review does. */
export type OwnerStatus =
  | "AWAITING"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "MORE_NEEDED"
  | "COMPLETED";

export const OWNER_STATUSES: readonly OwnerStatus[] = [
  "AWAITING",
  "IN_PROGRESS",
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_NEEDED",
  "COMPLETED",
];

export const OWNER_STATUS_LABELS: Record<OwnerStatus, string> = {
  AWAITING: "Awaiting your response",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  MORE_NEEDED: "More information requested",
  COMPLETED: "Completed",
};

export type ItemState =
  | "NOT_STARTED"
  | "UPLOADED"
  | "UNDER_REVIEW"
  | "MORE_NEEDED"
  | "ACCEPTED";

/** One thing the request asks for (a numbered item of its wording). */
export type PortalDeliverable = {
  number: number;
  title: string;
  detail: string;
  period: string;
  include: string[];
  format: string;
  show: string;
  completeness: string;
  /** What may serve instead. */
  alternatives: string[];
  state: ItemState;
  stateLabel: string;
  files: PortalFile[];
};

export type PortalQuestion = {
  key: string;
  text: string;
  answer: string;
  answeredAt: string | null;
};

export type PortalMessage = {
  id: string;
  author: "YOU" | "AUDIT_TEAM";
  authorName: string;
  body: string;
  createdAt: string;
};

export type PortalRequest = {
  id: string;
  reference: string;
  control: string;
  description: string;
  dueAt: string;
  status: string;
  openUntil: string;
  files: PortalFile[];
  references: PortalReference[];
  title: string;
  typeLabel: string;
  summary: string;
  /** False: free wording a person wrote, shown as written, with one upload. */
  structured: boolean;
  period: string;
  deliverables: PortalDeliverable[];
  /** Files sent before uploads named their item. */
  earlierFiles: PortalFile[];
  questions: PortalQuestion[];
  messages: PortalMessage[];
  submittedAt: string | null;
  ownerStatus: OwnerStatus;
  ownerStatusLabel: string;
  /** Still taking files, answers and messages. */
  open: boolean;
};

export type PortalCounts = Record<OwnerStatus, number> & { total: number };

export type Portal = {
  engagement: string;
  firm: string;
  email: string;
  sessionExpiresAt: string;
  requests: PortalRequest[];
  counts: PortalCounts;
  periodStart: string | null;
  periodEnd: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function validToken(value: string): boolean {
  return TOKEN.test(value);
}

export function validRequestId(value: string): boolean {
  return UUID.test(value);
}

export function parseLinkStatus(value: unknown): LinkStatus | null {
  if (!isRecord(value)) {
    return null;
  }
  const state = value.state;
  const engagement = text(value.engagement);
  const firm = text(value.firm);
  const maskedEmail = text(value.masked_email);
  if (
    (state !== "ACTIVE" && state !== "CLOSED" && state !== "REVOKED") ||
    engagement === null ||
    firm === null ||
    maskedEmail === null
  ) {
    return null;
  }
  return { state, engagement, firm, maskedEmail };
}

function parseFile(value: unknown): PortalFile | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileName = text(value.file_name);
  const addedAt = text(value.added_at);
  if (
    fileName === null ||
    addedAt === null ||
    typeof value.size_bytes !== "number"
  ) {
    return null;
  }
  return { fileName, sizeBytes: value.size_bytes, addedAt };
}

function parseRequest(value: unknown): PortalRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = text(value.id);
  const reference = text(value.reference);
  const control = text(value.control);
  const description = text(value.description);
  const dueAt = text(value.due_at);
  const status = text(value.status);
  const openUntil = text(value.open_until);
  if (
    id === null ||
    !validRequestId(id) ||
    reference === null ||
    control === null ||
    description === null ||
    dueAt === null ||
    status === null ||
    openUntil === null ||
    !Array.isArray(value.files)
  ) {
    return null;
  }
  const files = value.files.map(parseFile);
  if (files.some((file) => file === null)) {
    return null;
  }
  const deliverables = list(value.deliverables).map(parseDeliverable);
  const questions = list(value.questions).map(parseQuestion);
  const messages = list(value.messages).map(parseMessage);
  const earlier = list(value.earlier_files).map(parseFile);
  if (
    deliverables.some((item) => item === null) ||
    questions.some((item) => item === null) ||
    messages.some((item) => item === null) ||
    earlier.some((item) => item === null)
  ) {
    return null;
  }
  const sent = files as PortalFile[];
  const ownerStatus = isOwnerStatus(value.owner_status)
    ? value.owner_status
    : sent.length > 0
      ? "IN_PROGRESS"
      : "AWAITING";
  return {
    id,
    reference,
    control,
    description,
    dueAt,
    status,
    openUntil,
    files: sent,
    references: list(value.references)
      .map(parseReference)
      .filter((item): item is PortalReference => item !== null),
    title: text(value.title) || firstLine(description) || control,
    typeLabel: text(value.type_label) ?? "",
    summary: text(value.summary) ?? "",
    structured: value.structured === true,
    period: text(value.period) ?? "",
    // An answer from before deliverables existed: the request as one deliverable.
    deliverables:
      deliverables.length > 0
        ? (deliverables as PortalDeliverable[])
        : [wholeRequest(description, sent)],
    earlierFiles: earlier as PortalFile[],
    questions: questions as PortalQuestion[],
    messages: messages as PortalMessage[],
    submittedAt: text(value.submitted_at),
    ownerStatus,
    ownerStatusLabel:
      text(value.owner_status_label) || OWNER_STATUS_LABELS[ownerStatus],
    open: value.open !== false,
  };
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstLine(value: string): string {
  return (
    value
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim()
      .slice(0, 160) ?? ""
  );
}

function isOwnerStatus(value: unknown): value is OwnerStatus {
  return (
    typeof value === "string" &&
    (OWNER_STATUSES as readonly string[]).includes(value)
  );
}

const ITEM_STATES: readonly ItemState[] = [
  "NOT_STARTED",
  "UPLOADED",
  "UNDER_REVIEW",
  "MORE_NEEDED",
  "ACCEPTED",
];

function wholeRequest(description: string, files: PortalFile[]) {
  return {
    number: 1,
    title: firstLine(description),
    detail: "",
    period: "",
    include: [],
    format: "",
    show: "",
    completeness: "",
    alternatives: [],
    state: files.length > 0 ? "UPLOADED" : "NOT_STARTED",
    stateLabel: files.length > 0 ? "Uploaded" : "Not started",
    files,
  } satisfies PortalDeliverable;
}

function parseDeliverable(value: unknown): PortalDeliverable | null {
  if (
    !isRecord(value) ||
    typeof value.number !== "number" ||
    !Number.isInteger(value.number) ||
    value.number < 1 ||
    value.number > 50 ||
    typeof value.title !== "string" ||
    typeof value.state !== "string" ||
    !(ITEM_STATES as readonly string[]).includes(value.state) ||
    !Array.isArray(value.files)
  ) {
    return null;
  }
  const files = value.files.map(parseFile);
  if (files.some((file) => file === null)) {
    return null;
  }
  return {
    number: value.number,
    title: value.title,
    detail: text(value.detail) ?? "",
    period: text(value.period) ?? "",
    include: list(value.include).filter(
      (item): item is string => typeof item === "string",
    ),
    format: text(value.format) ?? "",
    show: text(value.show) ?? "",
    completeness: text(value.completeness) ?? "",
    alternatives: list(value.alternatives).filter(
      (item): item is string => typeof item === "string",
    ),
    state: value.state as ItemState,
    stateLabel: text(value.state_label) ?? "",
    files: files as PortalFile[],
  };
}

const QUESTION_KEY = /^[0-9a-f]{16}$/;

function parseQuestion(value: unknown): PortalQuestion | null {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    !QUESTION_KEY.test(value.key) ||
    typeof value.text !== "string"
  ) {
    return null;
  }
  return {
    key: value.key,
    text: value.text,
    answer: text(value.answer) ?? "",
    answeredAt: text(value.answered_at),
  };
}

export function parseMessage(value: unknown): PortalMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    (value.author !== "YOU" && value.author !== "AUDIT_TEAM") ||
    typeof value.body !== "string" ||
    typeof value.created_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    author: value.author,
    authorName: text(value.author_name) ?? "",
    body: value.body,
    createdAt: value.created_at,
  };
}

function parseReference(value: unknown): PortalReference | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.file_name !== "string" ||
    typeof value.size_bytes !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    fileName: value.file_name,
    sizeBytes: value.size_bytes,
  };
}

/** The page's own route for a shared reference; the session cookie goes with it. */
export function referenceHref(requestId: string, referenceId: string): string {
  const params = new URLSearchParams({
    request: requestId,
    reference: referenceId,
  });
  return `/portal/reference?${params.toString()}`;
}

export function parsePortal(value: unknown): Portal | null {
  if (!isRecord(value) || !Array.isArray(value.requests)) {
    return null;
  }
  const engagement = text(value.engagement);
  const firm = text(value.firm);
  const email = text(value.email);
  const sessionExpiresAt = text(value.session_expires_at);
  if (
    engagement === null ||
    firm === null ||
    email === null ||
    sessionExpiresAt === null
  ) {
    return null;
  }
  const requests = value.requests.map(parseRequest);
  if (requests.some((item) => item === null)) {
    return null;
  }
  const found = requests as PortalRequest[];
  return {
    engagement,
    firm,
    email,
    sessionExpiresAt,
    requests: found,
    // Counted here from the requests read, so the numbers always match the list.
    counts: countRequests(found),
    periodStart: text(value.period_start),
    periodEnd: text(value.period_end),
  };
}

export function countRequests(requests: PortalRequest[]): PortalCounts {
  const counts = {
    total: requests.length,
    AWAITING: 0,
    IN_PROGRESS: 0,
    SUBMITTED: 0,
    UNDER_REVIEW: 0,
    MORE_NEEDED: 0,
    COMPLETED: 0,
  };
  for (const request of requests) {
    counts[request.ownerStatus] += 1;
  }
  return counts;
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const OWNER_STATUS_TONES: Record<OwnerStatus, Tone> = {
  AWAITING: "warning",
  IN_PROGRESS: "info",
  SUBMITTED: "info",
  UNDER_REVIEW: "neutral",
  MORE_NEEDED: "danger",
  COMPLETED: "success",
};

export const ITEM_STATE_TONES: Record<ItemState, Tone> = {
  NOT_STARTED: "neutral",
  UPLOADED: "info",
  UNDER_REVIEW: "neutral",
  MORE_NEEDED: "danger",
  ACCEPTED: "success",
};

/** What the owner is told about a request: never the audit team's internal status. */
export function requestState(request: PortalRequest): {
  label: string;
  tone: "neutral" | "success" | "warning";
} {
  if (request.status === "RECEIVED") {
    return { label: "Received, thank you", tone: "success" };
  }
  if (request.status === "PARTIALLY_RECEIVED") {
    return { label: "Partly received", tone: "neutral" };
  }
  // Files arrived but the audit team has not read them yet.
  if (request.files.length > 0) {
    return { label: "Files sent, being checked", tone: "neutral" };
  }
  if (request.status === "OVERDUE" || request.status === "ESCALATED") {
    return { label: "Past due", tone: "warning" };
  }
  return { label: "Waiting for your files", tone: "neutral" };
}

/** A file the browser offers, checked before it is sent: present and within 25 MB. */
export function uploadProblem(size: number): string | null {
  if (size <= 0) {
    return "This file is empty.";
  }
  if (size > MAX_UPLOAD) {
    return "This file is larger than 25 MB. Split it, or contact the audit team.";
  }
  return null;
}

/** The API's answer, in words for someone outside the firm. Null when it worked. */
export function portalProblem(status: number, detail = ""): string | null {
  if (status >= 200 && status < 300) {
    return null;
  }
  if (status === 404) {
    return "This link is not valid. Use the link in the most recent email from the audit team.";
  }
  if (status === 401) {
    return "Enter the code from the email first.";
  }
  if (status === 429) {
    return "Too many codes were asked for. Try again in an hour.";
  }
  if (status === 409 && detail !== "") {
    return `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`;
  }
  return "Something went wrong. Try again in a moment.";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The team's side: who holds links on the engagement, and the writes on them.

export type RecipientLink = {
  recipient: string;
  activeLinks: number;
  revokedLinks: number;
  lastOpenedAt: string | null;
  lastUploadAt: string | null;
  openRequests: number;
};

export function parseRecipientLinks(value: unknown): RecipientLink[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const links: RecipientLink[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.recipient !== "string" ||
      typeof item.active_links !== "number" ||
      typeof item.revoked_links !== "number" ||
      typeof item.open_requests !== "number"
    ) {
      return null;
    }
    links.push({
      recipient: item.recipient,
      activeLinks: item.active_links,
      revokedLinks: item.revoked_links,
      lastOpenedAt: text(item.last_opened_at),
      lastUploadAt: text(item.last_upload_at),
      openRequests: item.open_requests,
    });
  }
  return links;
}

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}$/;

export type PortalWrite =
  | { error: "invalid" }
  | { intent: "revoke" | "preview"; path: string; body: { recipient: string } };

/** A team write on an owner's links: revoke them, or open a local preview link. */
export function portalWrite(fields: Record<string, string>): PortalWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const recipient = (fields.recipient ?? "").trim().toLowerCase();
  const intent = fields.intent;
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !EMAIL.test(recipient) ||
    (intent !== "revoke" && intent !== "preview")
  ) {
    return { error: "invalid" };
  }
  const action = intent === "revoke" ? "revoke" : "preview-link";
  return {
    intent,
    path: `/organizations/${organizationId}/projects/${projectId}/evidence-portal/${action}`,
    body: { recipient },
  };
}

// The owner's working space: the list, its filters, and the writes on one request.

export type SortKey = "due-soonest" | "due-latest" | "title";

/** The summary filter: one status, or the submitted group (submitted or under review). */
export type StatusFilter = "ALL" | OwnerStatus;

export type ListQuery = {
  search: string;
  status: StatusFilter;
  type: string;
  sort: SortKey;
};

export const EMPTY_QUERY: ListQuery = {
  search: "",
  status: "ALL",
  type: "",
  sort: "due-soonest",
};

/** The request types present, for the type filter: only types the owner has. */
export function requestTypes(requests: PortalRequest[]): string[] {
  return [
    ...new Set(requests.map((item) => item.typeLabel).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
}

export function filterRequests(
  requests: PortalRequest[],
  query: ListQuery,
): PortalRequest[] {
  const words = query.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = requests.filter((item) => {
    if (query.status !== "ALL" && item.ownerStatus !== query.status) {
      return false;
    }
    if (query.type !== "" && item.typeLabel !== query.type) {
      return false;
    }
    const haystack = [
      item.title,
      item.reference,
      item.control,
      item.typeLabel,
      ...item.deliverables.map((entry) => entry.title),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const due = (item: PortalRequest) => Date.parse(item.dueAt) || 0;
  return found.sort((a, b) => {
    if (query.sort === "title") {
      return a.title.localeCompare(b.title);
    }
    const order =
      query.sort === "due-latest" ? due(b) - due(a) : due(a) - due(b);
    return order !== 0 ? order : a.reference.localeCompare(b.reference);
  });
}

/** How many of the request's items have at least one file. */
export function itemsProgress(request: PortalRequest): {
  done: number;
  total: number;
} {
  return {
    done: request.deliverables.filter((item) => item.files.length > 0).length,
    total: request.deliverables.length,
  };
}

/** Past its due date and still waiting on the owner. */
export function isOverdue(request: PortalRequest, now = Date.now()): boolean {
  return (
    request.open &&
    request.ownerStatus !== "COMPLETED" &&
    request.submittedAt === null &&
    Date.parse(request.dueAt) < now
  );
}

/** Whether the owner can submit now, and which items are still without a file. */
export function submitCheck(request: PortalRequest): {
  ready: boolean;
  missing: string[];
  problem: string | null;
} {
  const missing = request.deliverables
    .filter((item) => item.files.length === 0)
    .map((item) => item.title);
  if (!request.open) {
    return { ready: false, missing, problem: "This request is closed." };
  }
  if (missing.length === request.deliverables.length) {
    return {
      ready: false,
      missing,
      problem: "Upload at least one file before submitting.",
    };
  }
  return { ready: true, missing, problem: null };
}

/** The address of one request's view, kept in the page's query string. */
export function requestHref(
  pathname: string,
  requestId: string | null,
): string {
  return requestId === null ? pathname : `${pathname}?request=${requestId}`;
}

export function selectedRequest(search: string): string | null {
  const id = new URLSearchParams(search).get("request");
  return id !== null && UUID.test(id) ? id : null;
}

export const MAX_TEXT = 4000;

export type WorkspaceWrite =
  | { error: string }
  | { path: string; body: Record<string, unknown> };

/** One of the owner's writes on a request, checked before it is sent. */
export function workspaceWrite(
  intent: "answers" | "messages" | "submit",
  requestId: string,
  fields: Record<string, unknown>,
): WorkspaceWrite {
  if (!UUID.test(requestId)) {
    return { error: "invalid" };
  }
  const path = `/session/requests/${requestId}/${intent}`;
  if (intent === "messages") {
    const body = typeof fields.body === "string" ? fields.body.trim() : "";
    if (body === "" || body.length > MAX_TEXT) {
      return { error: "Write a message of up to 4,000 characters." };
    }
    return { path, body: { body } };
  }
  if (intent === "answers") {
    const answers = Array.isArray(fields.answers) ? fields.answers : [];
    const clean: { key: string; answer: string }[] = [];
    for (const item of answers) {
      if (
        !isRecord(item) ||
        typeof item.key !== "string" ||
        !QUESTION_KEY.test(item.key) ||
        typeof item.answer !== "string" ||
        item.answer.length > MAX_TEXT
      ) {
        return { error: "invalid" };
      }
      clean.push({ key: item.key, answer: item.answer });
    }
    if (clean.length === 0 || clean.length > 30) {
      return { error: "invalid" };
    }
    return { path, body: { answers: clean } };
  }
  const note = typeof fields.note === "string" ? fields.note.trim() : "";
  if (note.length > 2000) {
    return { error: "Keep the note to 2,000 characters." };
  }
  return {
    path,
    body: { note, confirm_incomplete: fields.confirm_incomplete === true },
  };
}

/** The item an upload is for: a whole number from 1 to 50, or none. */
export function uploadItem(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const item = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(item) && item >= 1 && item <= 50 ? item : "invalid";
}
