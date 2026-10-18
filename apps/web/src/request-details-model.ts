/**
 * An evidence request's details (GET …/pbc-requests/{id}/details): its type, title,
 * client-facing checklist, the audit team's planning kept apart from it, who it goes to
 * and who is copied, reference materials, and the checks run before approval and
 * sending. Also the lifecycle stage the page shows, derived from the request's records,
 * and the writes the panel makes, each checked here before it reaches the API, which
 * checks again.
 */

import {
  parseRequestDetail,
  type RequestDetail,
} from "./request-review-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const TYPE_KEY = /^[A-Z][A-Z_]{1,39}$/;
const SECRET =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

export const MAX_COPIED = 10;
export const MAX_REFERENCE_BYTES = 25_000_000;

export type Priority = "NORMAL" | "HIGH" | "URGENT";
export const PRIORITIES: Priority[] = ["NORMAL", "HIGH", "URGENT"];
export const PRIORITY_LABELS: Record<Priority, string> = {
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export type RequestTypeOption = { key: string; label: string; purpose: string };

export type RequestTypeState = {
  key: string;
  label: string;
  basis: "RULES" | "AGENT" | "PERSON";
  confirmed: boolean;
  /** The records do not settle it: a recommendation to confirm before approval. */
  uncertain: boolean;
  reason: string;
};

export type ChecklistItem = {
  number: number;
  title: string;
  detail: string;
  period: string;
  include: string[];
  format: string;
  show: string;
  completeness: string;
  type: string | null;
};

export type Contact = {
  name: string;
  email: string;
  role: string;
  source: "OWNER" | "COORDINATOR" | "CONTACT" | "RECIPIENT";
};

export type AttachmentSource =
  | "UPLOAD"
  | "ENGAGEMENT_FILE"
  | "PRIOR_YEAR_WORKPAPER";

export type Attachment = {
  id: string;
  source: AttachmentSource;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sourceYear: string;
  visibility: "INTERNAL" | "SHARED";
  previewable: boolean;
  addedBy: string;
  addedAt: string;
  sharedBy: string | null;
  version: number;
};

export type Check = { key: string; label: string; ok: boolean; detail: string };

export type PlanningRequirement = {
  title: string;
  categories: string[];
  objective: string;
  rationale: string;
  necessity: string;
  status: string;
  sufficiency: string;
};

export type RequestDetails = {
  request: RequestDetail;
  reference: string;
  title: string;
  titleSet: boolean;
  control: { id: string; ref: string; title: string; ownerName: string } | null;
  type: RequestTypeState;
  types: RequestTypeOption[];
  content: {
    summary: string;
    items: ChecklistItem[];
    questions: string[];
    structured: boolean;
  };
  planning: {
    requirements: PlanningRequirement[];
    assumptions: string[];
    draftedBy: "MODEL" | "RULES" | "PERSON";
    drafting: boolean;
  };
  attachments: Attachment[];
  contacts: Contact[];
  suggested: Contact | null;
  domains: string[];
  checks: Check[];
  ready: boolean;
  clarification: boolean;
  assignable: boolean;
  canEdit: boolean;
  canShare: boolean;
  /** What the control owner gave through the portal, or null before anything arrived. */
  client: ClientRecord | null;
  /** The test plan's approved attributes its items evidence (internal, never sent). */
  supports: Array<{ code: string; text: string; items: string[] }>;
};

export type ClientMessage = {
  id: string;
  author: "OWNER" | "TEAM";
  authorName: string;
  body: string;
  createdAt: string;
};

export type ClientRecord = {
  answers: { question: string; answer: string; answeredAt: string }[];
  messages: ClientMessage[];
  submittedAt: string | null;
  submissionNote: string;
  /** The owner's messages no one on the team has seen yet. */
  unseen: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

function parseContact(value: unknown): Contact | null {
  if (!isRecord(value) || !EMAIL.test(str(value.email))) {
    return null;
  }
  const source = str(value.source);
  return {
    name: str(value.name) || str(value.email),
    email: str(value.email),
    role: str(value.role),
    source:
      source === "OWNER" ||
      source === "COORDINATOR" ||
      source === "CONTACT" ||
      source === "RECIPIENT"
        ? source
        : "RECIPIENT",
  };
}

/** The engagement's contacts (GET …/engagement-contacts). */
export function parseContacts(value: unknown): Contact[] {
  return records(value)
    .map(parseContact)
    .filter((item): item is Contact => item !== null);
}

export function parseAttachment(value: unknown): Attachment | null {
  if (!isRecord(value) || !UUID.test(str(value.id))) {
    return null;
  }
  const source = str(value.source);
  return {
    id: str(value.id),
    source:
      source === "ENGAGEMENT_FILE" || source === "PRIOR_YEAR_WORKPAPER"
        ? source
        : "UPLOAD",
    fileName: str(value.file_name) || "Reference",
    contentType: str(value.content_type),
    sizeBytes: typeof value.size_bytes === "number" ? value.size_bytes : 0,
    sourceYear: str(value.source_year),
    visibility: value.visibility === "SHARED" ? "SHARED" : "INTERNAL",
    previewable: value.previewable === true,
    addedBy: str(value.added_by),
    addedAt: str(value.added_at),
    sharedBy: typeof value.shared_by === "string" ? value.shared_by : null,
    version: typeof value.version === "number" ? value.version : 1,
  };
}

/** The API's details, or null when they are not well formed. */
export function parseRequestDetails(value: unknown): RequestDetails | null {
  if (!isRecord(value)) {
    return null;
  }
  const request = parseRequestDetail(value.request);
  const type = isRecord(value.type) ? value.type : null;
  const content = isRecord(value.content) ? value.content : null;
  const planning = isRecord(value.planning) ? value.planning : null;
  if (request === null || type === null || content === null) {
    return null;
  }
  const control = isRecord(value.control) ? value.control : null;
  const basis = str(type.basis);
  const drafted = str(planning?.drafted_by);
  return {
    request,
    reference: str(value.reference),
    title: str(value.title) || "Evidence request",
    titleSet: value.title_set === true,
    control:
      control !== null && UUID.test(str(control.id))
        ? {
            id: str(control.id),
            ref: str(control.control_ref),
            title: str(control.title),
            ownerName: str(control.owner_name),
          }
        : null,
    type: {
      key: TYPE_KEY.test(str(type.request_type))
        ? str(type.request_type)
        : "OTHER",
      label: str(type.label) || "Other",
      basis: basis === "AGENT" || basis === "PERSON" ? basis : "RULES",
      confirmed: type.confirmed === true,
      uncertain: type.uncertain === true,
      reason: str(type.reason),
    },
    types: records(value.types)
      .filter((item) => TYPE_KEY.test(str(item.request_type)))
      .map((item) => ({
        key: str(item.request_type),
        label: str(item.label),
        purpose: str(item.purpose),
      })),
    content: {
      summary: str(content.summary),
      items: records(content.items).map((item, index) => ({
        number: typeof item.number === "number" ? item.number : index + 1,
        title: str(item.title),
        detail: str(item.detail),
        period: str(item.period),
        include: strings(item.include),
        format: str(item.format),
        show: str(item.show),
        completeness: str(item.completeness),
        type: typeof item.request_type === "string" ? item.request_type : null,
      })),
      questions: strings(content.questions),
      structured: content.structured === true,
    },
    planning: {
      requirements: records(planning?.requirements).map((item) => ({
        title: str(item.title),
        categories: strings(item.categories),
        objective: str(item.objective),
        rationale: str(item.rationale),
        necessity: str(item.necessity),
        status: str(item.status),
        sufficiency: str(item.sufficiency),
      })),
      assumptions: strings(planning?.assumptions),
      draftedBy:
        drafted === "MODEL" || drafted === "RULES" ? drafted : "PERSON",
      drafting: planning?.drafting === true,
    },
    attachments: records(value.attachments)
      .map(parseAttachment)
      .filter((item): item is Attachment => item !== null),
    contacts: records(value.contacts)
      .map(parseContact)
      .filter((item): item is Contact => item !== null),
    suggested: parseContact(value.suggested),
    domains: strings(value.domains),
    checks: records(value.checks).map((item) => ({
      key: str(item.key),
      label: str(item.label),
      ok: item.ok === true,
      detail: str(item.detail),
    })),
    ready: value.ready === true,
    clarification: value.clarification === true,
    assignable: value.assignable === true,
    canEdit: value.can_edit === true,
    canShare: value.can_share === true,
    client: parseClient(value.client),
    supports: records(value.supports).map((item) => ({
      code: str(item.code),
      text: str(item.text),
      items: strings(item.items),
    })),
  };
}

function parseClient(value: unknown): ClientRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    answers: records(value.answers)
      .filter((item) => str(item.answer) !== "")
      .map((item) => ({
        question: str(item.question),
        answer: str(item.answer),
        answeredAt: str(item.answered_at),
      })),
    messages: records(value.messages)
      .filter(
        (item) =>
          UUID.test(str(item.id)) &&
          (item.author === "YOU" || item.author === "AUDIT_TEAM"),
      )
      .map((item) => ({
        id: str(item.id),
        // The API names authors from the owner's side: YOU is the owner.
        author: item.author === "YOU" ? ("OWNER" as const) : ("TEAM" as const),
        authorName: str(item.author_name),
        body: str(item.body),
        createdAt: str(item.created_at),
      })),
    submittedAt: str(value.submitted_at) || null,
    submissionNote: str(value.submission_note),
    unseen: typeof value.unseen === "number" ? value.unseen : 0,
  };
}

/** Whether the owner has given anything through the portal yet. */
export function hasClientActivity(client: ClientRecord | null): boolean {
  return (
    client !== null &&
    (client.answers.length > 0 ||
      client.messages.length > 0 ||
      client.submittedAt !== null)
  );
}

// The lifecycle, derived from the records: the request's status, its latest approval,
// an owner reply waiting for the team, and how its evidence was judged.

export type Lifecycle =
  | "DRAFT"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "AWAITING_EVIDENCE"
  | "EVIDENCE_RECEIVED"
  | "UNDER_REVIEW"
  | "COMPLETED"
  | "CHANGES_REQUESTED"
  | "PARTIALLY_RECEIVED"
  | "CLARIFICATION_NEEDED"
  | "REJECTED"
  | "CANCELLED";

/** The main path, in order. The other stages sit at a step of it. */
export const LIFECYCLE_PATH: Lifecycle[] = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "AWAITING_EVIDENCE",
  "EVIDENCE_RECEIVED",
  "UNDER_REVIEW",
  "COMPLETED",
];

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  DRAFT: "Draft",
  READY_FOR_REVIEW: "Ready for review",
  APPROVED: "Approved",
  AWAITING_EVIDENCE: "Awaiting evidence",
  EVIDENCE_RECEIVED: "Evidence received",
  UNDER_REVIEW: "Under review",
  COMPLETED: "Completed",
  CHANGES_REQUESTED: "Changes requested",
  PARTIALLY_RECEIVED: "Partially received",
  CLARIFICATION_NEEDED: "Clarification needed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const STEP_OF: Record<Lifecycle, Lifecycle | null> = {
  DRAFT: "DRAFT",
  READY_FOR_REVIEW: "READY_FOR_REVIEW",
  APPROVED: "APPROVED",
  AWAITING_EVIDENCE: "AWAITING_EVIDENCE",
  EVIDENCE_RECEIVED: "EVIDENCE_RECEIVED",
  UNDER_REVIEW: "UNDER_REVIEW",
  COMPLETED: "COMPLETED",
  CHANGES_REQUESTED: "DRAFT",
  PARTIALLY_RECEIVED: "EVIDENCE_RECEIVED",
  CLARIFICATION_NEEDED: "AWAITING_EVIDENCE",
  REJECTED: "READY_FOR_REVIEW",
  CANCELLED: null,
};

export type LifecycleInput = {
  status: string;
  /** The latest send approval's decision, if any. */
  approvalDecision: string | null;
  /** Drafted by the evidence coordinator for a control, not written by a person. */
  agentDrafted: boolean;
  /** Its wording is drafted (not the placeholder written while it is drafted). */
  wordingReady: boolean;
  clarification: boolean;
  requirements: { status: string; sufficiency: string }[];
};

export type LifecycleStage = {
  key: Lifecycle;
  label: string;
  tone: "neutral" | "info" | "warn" | "done" | "danger";
  /** Its place on the main path (0-7), or null when it left the path (cancelled). */
  step: number | null;
};

export function lifecycleOf(input: LifecycleInput): LifecycleStage {
  const key = lifecycleKey(input);
  const step = STEP_OF[key];
  return {
    key,
    label: LIFECYCLE_LABELS[key],
    tone:
      key === "COMPLETED"
        ? "done"
        : key === "REJECTED" || key === "CANCELLED"
          ? "danger"
          : key === "CHANGES_REQUESTED" ||
              key === "CLARIFICATION_NEEDED" ||
              key === "PARTIALLY_RECEIVED"
            ? "warn"
            : key === "DRAFT"
              ? "neutral"
              : "info",
    step: step === null ? null : LIFECYCLE_PATH.indexOf(step),
  };
}

function lifecycleKey(input: LifecycleInput): Lifecycle {
  const decision = input.approvalDecision;
  switch (input.status) {
    case "CANCELLED":
      return decision === "REJECTED" ? "REJECTED" : "CANCELLED";
    case "DRAFT":
      if (decision === "REJECTED") {
        return "CHANGES_REQUESTED";
      }
      return input.agentDrafted && input.wordingReady
        ? "READY_FOR_REVIEW"
        : "DRAFT";
    case "APPROVAL_PENDING":
      return decision === "APPROVED" ? "APPROVED" : "READY_FOR_REVIEW";
    // Sent is awaiting evidence: once a request goes out, its evidence is awaited.
    case "SENT":
    case "WAITING_FOR_RESPONSE":
    case "OVERDUE":
    case "ESCALATED":
      return input.clarification ? "CLARIFICATION_NEEDED" : "AWAITING_EVIDENCE";
    case "PARTIALLY_RECEIVED":
      return input.clarification
        ? "CLARIFICATION_NEEDED"
        : "PARTIALLY_RECEIVED";
    case "RECEIVED": {
      const judged = input.requirements.filter(
        (item) => item.status !== "WAIVED",
      );
      const settled = (item: { status: string; sufficiency: string }) =>
        item.status === "WAIVED" || item.sufficiency === "SUFFICIENT";
      if (input.requirements.length > 0 && input.requirements.every(settled)) {
        return "COMPLETED";
      }
      return judged.some((item) => item.sufficiency !== "NOT_REVIEWED")
        ? "UNDER_REVIEW"
        : "EVIDENCE_RECEIVED";
    }
    case "CLOSED":
      return "COMPLETED";
    default:
      return "DRAFT";
  }
}

// Labels.

export const SOURCE_LABELS: Record<AttachmentSource, string> = {
  UPLOAD: "Uploaded",
  ENGAGEMENT_FILE: "Engagement file",
  PRIOR_YEAR_WORKPAPER: "Prior-year workpaper",
};

export const CONTACT_ROLES: Record<Contact["source"], string> = {
  OWNER: "Control owner",
  COORDINATOR: "Evidence coordinator",
  CONTACT: "Client contact",
  RECIPIENT: "Previous recipient",
};

export const BASIS_LABELS: Record<RequestTypeState["basis"], string> = {
  RULES: "Classified from the evidence plan",
  AGENT: "Classified by the evidence coordinator",
  PERSON: "Confirmed by the audit team",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Contacts matching what was typed, by name, email, or role. */
export function matchContacts(
  contacts: Contact[],
  query: string,
  exclude: string[],
): Contact[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const skip = new Set(exclude.map((item) => item.toLowerCase()));
  return contacts.filter(
    (contact) =>
      !skip.has(contact.email.toLowerCase()) &&
      words.every((word) =>
        `${contact.name} ${contact.email} ${contact.role}`
          .toLowerCase()
          .includes(word),
      ),
  );
}

/** Why an address cannot be used, in the API's words, or null. The API checks again. */
export function addressProblem(
  address: string,
  domains: string[],
): string | null {
  const clean = address.trim().toLowerCase();
  if (!EMAIL.test(clean)) {
    return `${clean || "The address"} is not a valid email address.`;
  }
  const domain = clean.split("@")[1] ?? "";
  if (domains.length > 0 && !domains.includes(domain)) {
    return `${clean} is outside the client's email domains (${domains.join(", ")}).`;
  }
  return null;
}

// Writes.

export type DetailsIntent =
  | "assign"
  | "classify"
  | "contact"
  | "link"
  | "remove"
  | "share"
  | "message"
  | "seen";

export type DetailsWrite =
  | { error: "invalid" }
  | { intent: DetailsIntent; path: string; body: Record<string, unknown> };

type Fields = Record<string, unknown>;
const text = (fields: Fields, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string).trim() : "";
const version = (fields: Fields): number | null => {
  const value = Number(fields.version);
  return Number.isInteger(value) && value >= 1 && value <= 1_000_000
    ? value
    : null;
};

/** The API call for one change on the request's details, checked before it is sent. */
export function detailsWrite(fields: Fields): DetailsWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const requestId = text(fields, "request_id");
  if (![organizationId, projectId, requestId].every((id) => UUID.test(id))) {
    return { error: "invalid" };
  }
  const project = `/organizations/${organizationId}/projects/${projectId}`;
  const request = `${project}/pbc-requests/${requestId}`;
  const current = version(fields);
  const intent = text(fields, "intent") as DetailsIntent;
  switch (intent) {
    case "assign": {
      const recipient = text(fields, "recipient").toLowerCase();
      const cc = (Array.isArray(fields.cc) ? fields.cc : [])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const due = text(fields, "due_on");
      const priority = text(fields, "priority");
      if (
        current === null ||
        (recipient !== "" && !EMAIL.test(recipient)) ||
        cc.length > MAX_COPIED ||
        cc.some((item) => !EMAIL.test(item)) ||
        !DATE.test(due) ||
        !PRIORITIES.includes(priority as Priority)
      ) {
        return { error: "invalid" };
      }
      return {
        intent,
        path: `${request}/assignment`,
        body: { version: current, recipient, cc, due_on: due, priority },
      };
    }
    case "classify": {
      const type = text(fields, "request_type");
      const title = text(fields, "title");
      return current === null ||
        !TYPE_KEY.test(type) ||
        title.length > 160 ||
        SECRET.test(title)
        ? { error: "invalid" }
        : {
            intent,
            path: `${request}/classification`,
            body: { version: current, request_type: type, title },
          };
    }
    case "contact": {
      const name = text(fields, "name");
      const email = text(fields, "email").toLowerCase();
      const role = text(fields, "role");
      return name === "" ||
        name.length > 200 ||
        role.length > 120 ||
        !EMAIL.test(email) ||
        SECRET.test(`${name} ${role}`)
        ? { error: "invalid" }
        : {
            intent,
            path: `${project}/engagement-contacts`,
            body: { name, email, role },
          };
    }
    case "link": {
      const source = text(fields, "source");
      const id = text(fields, "id");
      return (source === "ENGAGEMENT_FILE" ||
        source === "PRIOR_YEAR_WORKPAPER") &&
        UUID.test(id)
        ? {
            intent,
            path: `${request}/attachments/link`,
            body: { source, id },
          }
        : { error: "invalid" };
    }
    case "remove":
    case "share": {
      const attachmentId = text(fields, "attachment_id");
      const visibility = text(fields, "visibility");
      if (current === null || !UUID.test(attachmentId)) {
        return { error: "invalid" };
      }
      const path = `${request}/attachments/${attachmentId}`;
      if (intent === "remove") {
        return { intent, path: `${path}/remove`, body: { version: current } };
      }
      return visibility === "SHARED" || visibility === "INTERNAL"
        ? {
            intent,
            path: `${path}/visibility`,
            body: { version: current, visibility },
          }
        : { error: "invalid" };
    }
    case "message": {
      // The audit team writes to the request's owner; the owner is emailed a link.
      const body = typeof fields.body === "string" ? fields.body.trim() : "";
      return body === "" || body.length > 4000 || SECRET.test(body)
        ? { error: "invalid" }
        : { intent, path: `${request}/messages`, body: { body } };
    }
    case "seen":
      return { intent, path: `${request}/messages/seen`, body: {} };
    default:
      return { error: "invalid" };
  }
}

/** The page's own route for one attachment's content or preview. */
export function attachmentHref(
  ids: { organizationId: string; projectId: string },
  requestId: string,
  attachmentId: string,
  mode: "content" | "preview",
): string {
  const params = new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
    request: requestId,
    attachment: attachmentId,
    mode,
  });
  return `/workspace/request-attachment?${params.toString()}`;
}

export type AttachmentTarget =
  | { error: "invalid" }
  | { path: string; mode: "content" | "preview" | "upload" | "sources" };

/** The API path for the attachment route's query, or an error when it is not well
 * formed. */
export function attachmentTarget(
  params: URLSearchParams,
  method: "GET" | "POST",
): AttachmentTarget {
  const organizationId = params.get("organization") ?? "";
  const projectId = params.get("project") ?? "";
  const requestId = params.get("request") ?? "";
  if (![organizationId, projectId, requestId].every((id) => UUID.test(id))) {
    return { error: "invalid" };
  }
  const request = `/organizations/${organizationId}/projects/${projectId}/pbc-requests/${requestId}`;
  if (method === "POST") {
    const name = (params.get("name") ?? "").trim();
    return name === "" || name.length > 200 || /[\\/]/.test(name)
      ? { error: "invalid" }
      : {
          path: `${request}/attachments?name=${encodeURIComponent(name)}`,
          mode: "upload",
        };
  }
  const mode = params.get("mode") ?? "";
  if (mode === "sources") {
    return { path: `${request}/attachment-sources`, mode };
  }
  const attachmentId = params.get("attachment") ?? "";
  if (!UUID.test(attachmentId) || (mode !== "content" && mode !== "preview")) {
    return { error: "invalid" };
  }
  return { path: `${request}/attachments/${attachmentId}/${mode}`, mode };
}

export type SourceFile = {
  id: string;
  fileName: string;
  sizeBytes: number;
  addedAt: string;
};
export type SourceWorkpaper = {
  id: string;
  engagement: string;
  year: string;
  reference: string;
  stage: string;
};

/** What can be attached (GET …/attachment-sources). */
export function parseSources(
  value: unknown,
): { files: SourceFile[]; workpapers: SourceWorkpaper[] } | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    files: records(value.files)
      .filter((item) => UUID.test(str(item.id)))
      .map((item) => ({
        id: str(item.id),
        fileName: str(item.file_name),
        sizeBytes: typeof item.size_bytes === "number" ? item.size_bytes : 0,
        addedAt: str(item.added_at),
      })),
    workpapers: records(value.workpapers)
      .filter((item) => UUID.test(str(item.id)))
      .map((item) => ({
        id: str(item.id),
        engagement: str(item.engagement),
        year: str(item.year),
        reference: str(item.reference),
        stage: str(item.stage),
      })),
  };
}
