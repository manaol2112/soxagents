const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SECRET =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

const CLOSED_EVIDENCE = new Set(["RECEIVED", "CLOSED", "CANCELLED"]);
const LATE_EVIDENCE = new Set(["OVERDUE", "ESCALATED"]);
const ACTIVE_TASKS = new Set([
  "READY",
  "QUEUED",
  "RUNNING",
  "WAITING",
  "BLOCKED",
]);
const DECIDERS = new Set(["OWNER", "ADMIN", "PROJECT_MANAGER"]);

export type EvidenceRequest = {
  id: string;
  controlRef: string;
  recipient: string;
  dueAt: string;
  description: string;
  status: string;
  attachmentCount: number;
  version: number;
};

export type OutboundRecord = {
  id: string;
  requestId: string;
  approvalId: string;
  reference: string;
  status: string;
  deliveryConfirmed: boolean;
  errorCode: string;
  updatedAt: string;
};

export type MailboxMode = "test" | "live" | "unavailable";

export type DeliveryTone = "positive" | "neutral" | "risk";

export type ApprovalItem = {
  id: string;
  actionId: string;
  targetResource: string;
  risk: string;
  decision: string;
  decisionReason: string | null;
  executionStatus: string;
  expiresAt: string;
  requestingUserId: string;
  requestedByAgent: boolean;
  parameters: Array<[string, string]>;
};

export type ApprovalState = "pending" | "expired" | "approved" | "rejected";

export type DecisionNotice =
  | "decided"
  | "invalid"
  | "self"
  | "expired"
  | "closed"
  | "denied"
  | "unavailable";

export type EvidenceNotice =
  | "saved"
  | "invalid"
  | "inactive"
  | "duplicate"
  | "denied"
  | "unavailable"
  | "submitted"
  | "sent"
  | "failed"
  | "uncertain"
  | "recipient"
  | "changed"
  | "awaiting";

export type WorkflowState = {
  userId: string | null;
  evidence: EvidenceRequest[] | null;
  approvals: ApprovalItem[] | null;
  outbound: OutboundRecord[] | null;
  mailboxMode: MailboxMode | null;
  activeAgents: number | null;
  decisionNotice: DecisionNotice | null;
  evidenceNotice: EvidenceNotice | null;
  operationKey: string;
};

export const EMPTY_WORKFLOW: WorkflowState = {
  userId: null,
  evidence: null,
  approvals: null,
  outbound: null,
  mailboxMode: null,
  activeAgents: null,
  decisionNotice: null,
  evidenceNotice: null,
  operationKey: "",
};

export const EVIDENCE_STAGES: ReadonlyArray<{
  id: string;
  label: string;
  statuses: readonly string[];
}> = [
  { id: "draft", label: "Draft", statuses: ["DRAFT"] },
  {
    id: "approval",
    label: "Awaiting approval",
    statuses: ["APPROVAL_PENDING"],
  },
  {
    id: "requested",
    label: "Requested",
    statuses: ["SENT", "WAITING_FOR_RESPONSE"],
  },
  {
    id: "late",
    label: "Overdue or escalated",
    statuses: ["OVERDUE", "ESCALATED"],
  },
  {
    id: "received",
    label: "Received",
    statuses: ["PARTIALLY_RECEIVED", "RECEIVED"],
  },
  { id: "closed", label: "Closed", statuses: ["CLOSED", "CANCELLED"] },
];

const ACTION_LABELS: Record<string, string> = {
  "file.read": "Read a file",
  "task.create": "Create a task",
  "mail.draft": "Draft an email",
  "mail.pbc": "Send an evidence request",
  "mail.reminder": "Send a reminder",
  "mail.external": "Email an external recipient",
  "attachment.retrieve": "Retrieve an attachment",
  "workpaper.update": "Update a workpaper",
  "permission.modify": "Change a member's role",
  "report.finalize": "Finalize a report",
};

export function actionLabel(actionId: string): string {
  return ACTION_LABELS[actionId] ?? actionId;
}

export function canDecide(role: string): boolean {
  return DECIDERS.has(role);
}

export function canRequestEvidence(role: string): boolean {
  return role !== "REVIEWER";
}

export function parseEvidence(value: unknown): EvidenceRequest[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: EvidenceRequest[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.control_ref !== "string" ||
      typeof item.recipient !== "string" ||
      typeof item.due_at !== "string" ||
      typeof item.evidence_description !== "string" ||
      typeof item.status !== "string" ||
      !Array.isArray(item.attachment_refs) ||
      typeof item.version !== "number"
    ) {
      return null;
    }
    items.push({
      id: item.id,
      controlRef: item.control_ref,
      recipient: item.recipient,
      dueAt: item.due_at,
      description: item.evidence_description,
      status: item.status,
      attachmentCount: item.attachment_refs.length,
      version: item.version,
    });
  }
  return items;
}

export function parseOutbound(value: unknown): OutboundRecord[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: OutboundRecord[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.pbc_request_id !== "string" ||
      typeof item.approval_id !== "string" ||
      typeof item.reference !== "string" ||
      typeof item.status !== "string" ||
      typeof item.delivery_confirmed !== "boolean" ||
      typeof item.error_code !== "string" ||
      typeof item.updated_at !== "string"
    ) {
      return null;
    }
    items.push({
      id: item.id,
      requestId: item.pbc_request_id,
      approvalId: item.approval_id,
      reference: item.reference,
      status: item.status,
      deliveryConfirmed: item.delivery_confirmed,
      errorCode: item.error_code,
      updatedAt: item.updated_at,
    });
  }
  return items;
}

export function parseMailboxMode(value: unknown): MailboxMode | null {
  if (!isRecord(value) || typeof value.provider !== "string") {
    return null;
  }
  if (value.provider === "unavailable") {
    return "unavailable";
  }
  return value.live_email_enabled === true ? "live" : "test";
}

export function approvalRequestId(item: ApprovalItem): string | null {
  if (item.actionId !== "mail.pbc") {
    return null;
  }
  const reference =
    item.parameters.find(([key]) => key === "request_ref")?.[1] ?? "";
  const match = /^pbc\/([0-9a-f-]{36})\//i.exec(reference);
  return match !== null && UUID.test(match[1] ?? "")
    ? (match[1] ?? null)
    : null;
}

export function latestOutbound(
  records: readonly OutboundRecord[],
  requestId: string,
): OutboundRecord | null {
  let latest: OutboundRecord | null = null;
  for (const record of records) {
    if (
      record.requestId === requestId &&
      (latest === null || record.updatedAt > latest.updatedAt)
    ) {
      latest = record;
    }
  }
  return latest;
}

export function readyToSend(
  approvals: readonly ApprovalItem[],
  outbound: readonly OutboundRecord[],
  requestId: string,
  now: number,
): ApprovalItem | null {
  const used = new Set(outbound.map((record) => record.approvalId));
  return (
    approvals.find(
      (item) =>
        approvalRequestId(item) === requestId &&
        approvalState(item, now) === "approved" &&
        item.executionStatus === "NOT_STARTED" &&
        Date.parse(item.expiresAt) > now &&
        !used.has(item.id),
    ) ?? null
  );
}

export function awaitingDecision(
  approvals: readonly ApprovalItem[],
  requestId: string,
  now: number,
): boolean {
  return approvals.some(
    (item) =>
      approvalRequestId(item) === requestId &&
      approvalState(item, now) === "pending",
  );
}

export function deliveryLabel(
  record: OutboundRecord,
  mode: MailboxMode | null,
): { label: string; tone: DeliveryTone } {
  if (record.status === "DELIVERED" && record.deliveryConfirmed) {
    return { label: "Delivered", tone: "positive" };
  }
  if (record.status === "ACCEPTED" || record.status === "SENT") {
    return mode === "live"
      ? {
          label:
            record.status === "SENT"
              ? "Sent · delivery not confirmed"
              : "Accepted · delivery not confirmed",
          tone: "neutral",
        }
      : { label: "Test mailbox only", tone: "neutral" };
  }
  if (record.status === "BOUNCED") {
    return { label: "Bounced", tone: "risk" };
  }
  if (record.status === "FAILED") {
    return {
      label:
        record.errorCode === "live_email_disabled"
          ? "Not sent · live email is off"
          : "Not sent",
      tone: "risk",
    };
  }
  if (record.status === "UNKNOWN") {
    return { label: "Outcome unknown", tone: "risk" };
  }
  return { label: "Sending", tone: "neutral" };
}

export function canRetryDelivery(record: OutboundRecord): boolean {
  return record.status === "UNKNOWN" || record.status === "PENDING";
}

export function parseApprovals(value: unknown): ApprovalItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: ApprovalItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.action_id !== "string" ||
      typeof item.target_resource !== "string" ||
      typeof item.risk !== "string" ||
      typeof item.decision !== "string" ||
      typeof item.execution_status !== "string" ||
      typeof item.expires_at !== "string" ||
      typeof item.requesting_user_id !== "string" ||
      !isRecord(item.parameters)
    ) {
      return null;
    }
    const parameters: Array<[string, string]> = [];
    for (const [key, entry] of Object.entries(item.parameters)) {
      if (typeof entry !== "string") {
        return null;
      }
      parameters.push([key, entry]);
    }
    items.push({
      id: item.id,
      actionId: item.action_id,
      targetResource: item.target_resource,
      risk: item.risk,
      decision: item.decision,
      decisionReason:
        typeof item.decision_reason === "string" ? item.decision_reason : null,
      executionStatus: item.execution_status,
      expiresAt: item.expires_at,
      requestingUserId: item.requesting_user_id,
      requestedByAgent: typeof item.requesting_agent_id === "string",
      parameters: parameters.sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    });
  }
  return items;
}

export function countActiveAgents(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((item) => isRecord(item) && item.status === "ACTIVE")
    .length;
}

export function approvalState(item: ApprovalItem, now: number): ApprovalState {
  if (item.decision === "APPROVED") {
    return "approved";
  }
  if (item.decision === "REJECTED") {
    return "rejected";
  }
  if (item.decision === "PENDING" && Date.parse(item.expiresAt) > now) {
    return "pending";
  }
  return "expired";
}

export function pendingApprovals(
  items: readonly ApprovalItem[],
  now: number,
): ApprovalItem[] {
  return items.filter((item) => approvalState(item, now) === "pending");
}

export function isOutstandingEvidence(item: { status: string }): boolean {
  return !CLOSED_EVIDENCE.has(item.status);
}

export function isLateEvidence(item: EvidenceRequest, now: number): boolean {
  if (LATE_EVIDENCE.has(item.status)) {
    return true;
  }
  return isOutstandingEvidence(item) && Date.parse(item.dueAt) < now;
}

export type AttentionItem = {
  kind: "approval" | "blocked" | "evidence" | "review";
  id: string;
  title: string;
  detail: string;
};

export function attentionQueue(input: {
  tasks: ReadonlyArray<{ id: string; title: string; status: string }>;
  evidence: readonly EvidenceRequest[];
  approvals: readonly ApprovalItem[];
  now: number;
}): AttentionItem[] {
  const approvals = pendingApprovals(input.approvals, input.now).map(
    (item): AttentionItem => ({
      kind: "approval",
      id: item.id,
      title: actionLabel(item.actionId),
      detail: `${item.requestedByAgent ? "Requested by an agent" : "Requested by a person"} · ${item.targetResource}`,
    }),
  );
  const blocked = input.tasks
    .filter((task) => task.status === "BLOCKED")
    .map(
      (task): AttentionItem => ({
        kind: "blocked",
        id: task.id,
        title: task.title,
        detail: "Blocked until someone clears it",
      }),
    );
  const late = input.evidence
    .filter((item) => isLateEvidence(item, input.now))
    .map(
      (item): AttentionItem => ({
        kind: "evidence",
        id: item.id,
        title: item.controlRef,
        detail: `Evidence past due from ${item.recipient}`,
      }),
    );
  const review = input.tasks
    .filter((task) => task.status === "REVIEW")
    .map(
      (task): AttentionItem => ({
        kind: "review",
        id: task.id,
        title: task.title,
        detail: "Ready for independent review",
      }),
    );
  return [...approvals, ...blocked, ...late, ...review];
}

export type AuditPhase = 0 | 1 | 2 | 3 | 4;

export function auditPhase(
  tasks: ReadonlyArray<{ status: string }>,
  evidence: ReadonlyArray<{ status: string }> = [],
): AuditPhase {
  if (tasks.length === 0 && evidence.length === 0) {
    return 0;
  }
  if (tasks.some((task) => task.status === "REVIEW")) {
    return 3;
  }
  if (tasks.some((task) => ACTIVE_TASKS.has(task.status))) {
    return 2;
  }
  if (
    tasks.length > 0 &&
    tasks.every((task) => task.status === "SUCCEEDED") &&
    !evidence.some(isOutstandingEvidence)
  ) {
    return 4;
  }
  return 1;
}

export function relativeTime(target: string, now: number): string {
  const minutes = Math.round((Date.parse(target) - now) / 60000);
  const span = Math.abs(minutes);
  const text =
    span < 60
      ? `${span} min`
      : span < 48 * 60
        ? `${Math.round(span / 60)} h`
        : `${Math.round(span / 1440)} days`;
  return minutes >= 0 ? `in ${text}` : `${text} ago`;
}

export type EvidenceWrite =
  | { error: "invalid" }
  | {
      organizationId: string;
      projectId: string;
      path: string;
      body: Record<string, unknown>;
    };

export function evidenceWrite(fields: Record<string, string>): EvidenceWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const operationKey = fields.operation_key ?? "";
  const controlRef = (fields.control_ref ?? "").trim();
  const recipient = (fields.recipient ?? "").trim();
  const dueDate = (fields.due_date ?? "").trim();
  const description = (fields.evidence_description ?? "").trim();
  const followUp = fields.follow_up_after_days ?? "3";
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !KEY.test(operationKey) ||
    !REFERENCE.test(controlRef) ||
    !EMAIL.test(recipient) ||
    !DATE.test(dueDate) ||
    Number.isNaN(Date.parse(`${dueDate}T23:59:00Z`)) ||
    description === "" ||
    description.length > 4000 ||
    !/^\d{1,2}$/.test(followUp) ||
    Number(followUp) < 1 ||
    Number(followUp) > 30 ||
    [controlRef, recipient, description].some((text) => SECRET.test(text))
  ) {
    return { error: "invalid" };
  }
  return {
    organizationId,
    projectId,
    path: `/organizations/${organizationId}/projects/${projectId}/pbc-requests`,
    body: {
      operation_key: operationKey,
      control_ref: controlRef,
      recipient,
      due_at: `${dueDate}T23:59:00Z`,
      evidence_description: description,
      follow_up_after_days: Number(followUp),
    },
  };
}

export function evidenceNoticeFor(
  status: number,
  detail: string,
): EvidenceNotice {
  if (status === 200 || status === 201) {
    return "saved";
  }
  if (status === 409 && detail === "project is not active") {
    return "inactive";
  }
  if (status === 409) {
    return "duplicate";
  }
  if (status === 401 || status === 403) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

export type DecisionWrite =
  | { error: "invalid" }
  | {
      organizationId: string;
      projectId: string;
      path: string;
      body: { decision: "APPROVED" | "REJECTED"; reason: string };
    };

export function decisionWrite(fields: Record<string, string>): DecisionWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const approvalId = fields.approval_id ?? "";
  const decision = fields.decision ?? "";
  const reason = (fields.reason ?? "").trim();
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(approvalId) ||
    (decision !== "APPROVED" && decision !== "REJECTED") ||
    reason === "" ||
    reason.length > 500 ||
    SECRET.test(reason)
  ) {
    return { error: "invalid" };
  }
  return {
    organizationId,
    projectId,
    path: `/organizations/${organizationId}/projects/${projectId}/approvals/${approvalId}/decision`,
    body: { decision, reason },
  };
}

export function decisionNoticeFor(
  status: number,
  detail: string,
): DecisionNotice {
  if (status === 200) {
    return "decided";
  }
  if (status === 409 && detail === "requester cannot approve") {
    return "self";
  }
  if (status === 409 && detail === "approval has expired") {
    return "expired";
  }
  if (status === 409) {
    return "closed";
  }
  if (status === 401 || status === 403) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

export function parseDecisionNotice(
  value: string | null,
): DecisionNotice | null {
  const notices: readonly DecisionNotice[] = [
    "decided",
    "invalid",
    "self",
    "expired",
    "closed",
    "denied",
    "unavailable",
  ];
  return notices.find((notice) => notice === value) ?? null;
}

export function parseEvidenceNotice(
  value: string | null,
): EvidenceNotice | null {
  const notices: readonly EvidenceNotice[] = [
    "saved",
    "invalid",
    "inactive",
    "duplicate",
    "denied",
    "unavailable",
    "submitted",
    "sent",
    "failed",
    "uncertain",
    "recipient",
    "changed",
    "awaiting",
  ];
  return notices.find((notice) => notice === value) ?? null;
}

export type OutboundWrite =
  | { error: "invalid" }
  | {
      intent: "submit" | "send";
      organizationId: string;
      projectId: string;
      path: string;
      body: Record<string, unknown>;
    };

export function outboundWrite(fields: Record<string, string>): OutboundWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const requestId = fields.request_id ?? "";
  const intent = fields.intent ?? "";
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(requestId)
  ) {
    return { error: "invalid" };
  }
  const base = `/organizations/${organizationId}/projects/${projectId}/pbc-requests/${requestId}`;
  if (intent === "submit") {
    const version = fields.version ?? "";
    if (!/^\d{1,9}$/.test(version) || Number(version) < 1) {
      return { error: "invalid" };
    }
    return {
      intent,
      organizationId,
      projectId,
      path: `${base}/submit`,
      body: { version: Number(version) },
    };
  }
  const approvalId = fields.approval_id ?? "";
  if (intent !== "send" || !UUID.test(approvalId)) {
    return { error: "invalid" };
  }
  return {
    intent,
    organizationId,
    projectId,
    path: `${base}/send`,
    body: { approval_id: approvalId },
  };
}

export function outboundNoticeFor(
  intent: "submit" | "send",
  status: number,
  detail: string,
  deliveryStatus: string,
): EvidenceNotice {
  if (status === 200) {
    if (intent === "submit") {
      return "submitted";
    }
    if (["ACCEPTED", "SENT", "DELIVERED"].includes(deliveryStatus)) {
      return "sent";
    }
    return deliveryStatus === "FAILED" ? "failed" : "uncertain";
  }
  if (status === 409 && detail === "recipient is not allowed") {
    return "recipient";
  }
  if (
    status === 409 &&
    (detail === "approval does not match" || detail === "pbc request changed")
  ) {
    return "changed";
  }
  if (status === 409 && detail === "action is not allowed") {
    return "inactive";
  }
  if (status === 409) {
    return "awaiting";
  }
  if (status === 401 || status === 403) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
