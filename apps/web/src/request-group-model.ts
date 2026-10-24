// One request to one person for several controls (Release 2b): what the reviewer sees in
// its side panel, read from the API.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["PROPOSED", "APPROVED", "SENT", "NOT_SENT"]);

export type GroupStatus = "PROPOSED" | "APPROVED" | "SENT" | "NOT_SENT";

/** An item's status once sent: Missing, Provided, Verified (the reader's proposal), or
 * Accepted (a person's). */
export type ItemState = "MISSING" | "PROVIDED" | "VERIFIED" | "ACCEPTED";
const ITEM_STATES = new Set(["MISSING", "PROVIDED", "VERIFIED", "ACCEPTED"]);

export type ItemStatus = {
  title: string;
  status: ItemState;
  label: string;
  /** What is still needed, when a person found what came short. */
  note: string;
};

export type GroupMember = {
  id: string;
  reference: string;
  controlId: string | null;
  controlRef: string;
  controlTitle: string;
  systems: string[];
  title: string;
  items: string[];
  dueAt: string;
  /** Shown only where it differs from the request's own due date. */
  dueDiffers: boolean;
  status: string;
  stage: string;
  stageLabel: string;
  version: number;
  /** What stops it being approved, in words; null when it is ready. */
  problem: string | null;
  /** Once sent: each item with its status. */
  statuses: ItemStatus[];
};

export type GroupView = {
  id: string;
  reference: string;
  status: GroupStatus;
  title: string;
  phase: string | null;
  recipient: string;
  recipientName: string;
  cc: string[];
  dueAt: string;
  itemCount: number;
  personalData: boolean;
  members: GroupMember[];
  /** Drafts a person changed, for the same person and phase, that may be included. */
  optional: GroupMember[];
  subject: string;
  body: string;
  ready: boolean;
  approvedBy: string;
  approvedAt: string | null;
  sentAt: string | null;
  /** The one email's delivery: "", PENDING, ACCEPTED, UNKNOWN, or FAILED. */
  delivery: string;
  /** Why it was not sent, in words. */
  reason: string;
  leadRequestId: string;
  canApprove: boolean;
  notice: string;
  /** Once sent: the client's progress and a person's acceptance. */
  itemsTotal: number;
  itemsProvided: number;
  itemsAccepted: number;
  readyForTesting: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

function parseMember(value: Record<string, unknown>): GroupMember | null {
  if (!UUID.test(str(value.id))) {
    return null;
  }
  return {
    id: str(value.id),
    reference: str(value.reference),
    controlId: UUID.test(str(value.control_id)) ? str(value.control_id) : null,
    controlRef: str(value.control_ref),
    controlTitle: str(value.control_title),
    systems: strings(value.systems),
    title: str(value.title),
    items: strings(value.items),
    dueAt: str(value.due_at),
    dueDiffers: value.due_differs === true,
    status: str(value.status),
    stage: str(value.stage),
    stageLabel: str(value.stage_label),
    version: num(value.version) || 1,
    problem: typeof value.problem === "string" ? value.problem : null,
    statuses: records(value.statuses)
      .filter((item) => ITEM_STATES.has(str(item.status)))
      .map((item) => ({
        title: str(item.title),
        status: str(item.status) as ItemState,
        label: str(item.label),
        note: str(item.note),
      })),
  };
}

const members = (value: unknown): GroupMember[] =>
  records(value)
    .map(parseMember)
    .filter((item): item is GroupMember => item !== null);

/** The API's review of one group, or null when it is not well formed. */
export function parseGroupView(value: unknown): GroupView | null {
  if (
    !isRecord(value) ||
    !UUID.test(str(value.id)) ||
    !STATUSES.has(str(value.status)) ||
    !UUID.test(str(value.lead_request_id))
  ) {
    return null;
  }
  const found = members(value.members);
  if (found.length < 2) {
    return null;
  }
  return {
    id: str(value.id),
    reference: str(value.reference),
    status: str(value.status) as GroupStatus,
    title: str(value.title) || `Evidence for ${found.length} controls`,
    phase: typeof value.phase === "string" ? value.phase : null,
    recipient: str(value.recipient),
    recipientName: str(value.recipient_name),
    cc: strings(value.cc),
    dueAt: str(value.due_at),
    itemCount: num(value.item_count),
    personalData: value.personal_data === true,
    members: found,
    optional: members(value.optional),
    subject: str(value.subject),
    body: str(value.body),
    ready: value.ready === true,
    approvedBy: str(value.approved_by),
    approvedAt:
      typeof value.approved_at === "string" ? value.approved_at : null,
    sentAt: typeof value.sent_at === "string" ? value.sent_at : null,
    delivery: str(value.delivery),
    reason: str(value.reason),
    leadRequestId: str(value.lead_request_id),
    canApprove: value.can_approve === true,
    notice: str(value.notice),
    itemsTotal: num(value.items_total),
    itemsProvided: num(value.items_provided),
    itemsAccepted: num(value.items_accepted),
    readyForTesting: value.ready_for_testing === true,
  };
}

/** What is approved: the group's requests, and any changed draft the person included,
 * at the versions the person saw. */
export function seenMembers(
  view: GroupView,
  included: ReadonlySet<string>,
): { id: string; version: number }[] {
  return [
    ...view.members,
    ...view.optional.filter((item) => included.has(item.id)),
  ].map((item) => ({ id: item.id, version: item.version }));
}

/** Why Approve and send is not available yet, in words; null when it is. */
export function approveBlocker(
  view: GroupView,
  included: ReadonlySet<string>,
): string | null {
  if (!view.canApprove) {
    return "Your role does not permit approving requests.";
  }
  if (view.notice !== "") {
    return view.notice;
  }
  const blocking = [
    ...view.members,
    ...view.optional.filter((item) => included.has(item.id)),
  ].filter((item) => item.problem !== null);
  if (blocking.length > 0) {
    return blocking.length === 1
      ? `${blocking[0]?.controlRef}: ${blocking[0]?.problem}`
      : `${blocking.length} controls need attention first.`;
  }
  return view.ready ? null : "This request is not ready to send.";
}

/** A sent control's progress, from its items: ready for testing when a person accepted
 * every one, else how many the client provided; its stage when no items are known. */
export function memberProgress(member: GroupMember): string {
  const items = member.statuses;
  if (items.length === 0) {
    return member.stageLabel;
  }
  if (items.every((item) => item.status === "ACCEPTED")) {
    return "Ready for testing";
  }
  const provided = items.filter((item) => item.status !== "MISSING").length;
  return `${provided} of ${items.length} provided`;
}

/** The status line under the title, in words. */
export function groupStatusLine(view: GroupView): string {
  switch (view.status) {
    case "PROPOSED":
      return view.ready ? "Ready for review" : "Needs attention";
    case "APPROVED":
      return view.delivery === "UNKNOWN"
        ? "Approved; delivery not yet confirmed"
        : "Approved; not yet sent";
    case "SENT":
      return view.readyForTesting ? "Ready for testing" : "Sent";
    default:
      return "Not sent";
  }
}
