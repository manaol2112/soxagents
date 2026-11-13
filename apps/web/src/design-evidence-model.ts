/**
 * The D&I Evidence step once its requests are drafted (product owner, 12 November 2026:
 * "This view is again so heavy and a lot of duplicates labels and purpose. Just simplify
 * this where the user can easily edit the request, add another evidence request, and can
 * easily upload any evidence that was received. Still keep the option to send out the
 * request to the process owners."). The step stays the one list it was before its
 * requests were drafted (design-requests-model): one row per request, each with the
 * attributes it addresses, where it stands, and the evidence that came back for it. No
 * detail pane, no tabs, no numbering and no progress meter.
 *
 * Pure. The server decides what was sent, what arrived, what the reader proposes and what
 * a person accepted; this module reads what it sent and words it. Nothing reads as sent,
 * with the owner or accepted on the page's own guess, and a field the server did not send
 * falls back to the cautious reading.
 */

import { attributeLetter } from "./control-context-model.ts";
import { itemKind } from "./design-release-model.ts";
import {
  type AssuranceCounts,
  type AssuranceRow,
  assuranceCounts,
  assurancePill,
  assuranceRow,
  assuranceSentence,
  attributeCoverage,
  DESIGN_ONLY,
  type EvidenceAssurance,
  keyedOf,
  SAME_INSTANCE,
} from "./evidence-assurance-model.ts";
import type { PlanRequirement } from "./evidence-plan-model.ts";
import { formatBytes, formatDate } from "./format.ts";
import type { IconName } from "./icon-name.ts";

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const named = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

// What the server sends (the seam)

/** How a request reached the process owner: by email, or handed over by a person where
 * live email is off in this environment (nothing was emailed). */
export type Delivery = {
  mode: "EMAIL" | "HANDED_OVER";
  at: string | null;
  by: string | null;
};

export type Seam = {
  /** A requirement: its evidence was uploaded before its request was sent, so it is
   * left out of what is sent. */
  inHand: boolean;
  /** A request: how it went to the owner, or null when it has not (or was not said). */
  delivery: Delivery | null;
  /** A request: whether live email is on here; null when the server did not say. */
  liveEmail: boolean | null;
};

/**
 * The one place the step's new server fields are read: `in_hand` on a requirement, and
 * `delivery` ({mode, at, by}) and `live_email` on the request it travels in. Each falls
 * back to the cautious reading when it is missing or of the wrong type: not in hand, not
 * delivered, and email neither known on nor off. The plan's and the control's own parsers
 * call it, so a renamed field changes here only.
 */
export function readSeam(value: unknown): Seam {
  const item = isRecord(value) ? value : {};
  const delivery = isRecord(item.delivery) ? item.delivery : null;
  const mode =
    delivery?.mode === "EMAIL" || delivery?.mode === "HANDED_OVER"
      ? delivery.mode
      : null;
  return {
    inHand: item.in_hand === true,
    delivery:
      delivery === null || mode === null
        ? null
        : { mode, at: named(delivery.at), by: named(delivery.by) },
    liveEmail: typeof item.live_email === "boolean" ? item.live_email : null,
  };
}

// The list

export type Requirement = Pick<
  PlanRequirement,
  | "id"
  | "phase"
  | "title"
  | "description"
  | "categories"
  | "necessity"
  | "state"
  | "pendingChange"
  | "version"
  | "requestId"
  | "files"
  | "assessment"
  | "sufficiencyNote"
  | "sufficiencyBy"
  | "waiveReason"
  | "periodLabel"
  | "attributeIds"
  | "procedureIds"
  | "acceptedBy"
  | "acceptedAt"
> & { inHand?: boolean };

/** The request (PBC request) rows travel in. `delivery` is how it reached its owner:
 * null when the server says it did not, absent when the server did not say (an answer
 * without the field), in which case only its status is known. */
export type Carrier = {
  id: string;
  kind: string;
  status: string;
  dueAt: string;
  recipient?: string;
  delivery?: Delivery | null;
  /** What it is called (a follow-up's title says what it follows up). */
  title?: string;
  /** The latest approval asked to send it: PENDING, APPROVED, REJECTED, EXPIRED, FAILED
   * (approved, the send refused), RESEND; null or absent when none. */
  approval?: string | null;
};

/** A request of the D&I phase as the evidence plan lists it (`phases[].requests[]`). */
export type PlanRequest = {
  id: string;
  status: string;
  recipient?: string;
  dueAt?: string;
  delivery?: Delivery | null;
};

/**
 * The requests of the D&I phase: the plan's own list (its status, recipient, due date and
 * delivery, read with the rows they carry, so the two never disagree), with the kind the
 * control's list gives each (evidence, samples, follow-up), and what the plan does not
 * say filled from there. A request only the control lists is kept, after the plan's.
 */
export function carriersOf(
  planned: readonly PlanRequest[],
  listed: readonly Carrier[],
): Carrier[] {
  const known = new Map(listed.map((request) => [request.id, request]));
  const seen = new Set(planned.map((request) => request.id));
  return [
    ...planned.map((request): Carrier => {
      const other = known.get(request.id);
      const delivery =
        request.delivery !== undefined ? request.delivery : other?.delivery;
      return {
        id: request.id,
        kind: other?.kind ?? "EVIDENCE",
        status: request.status,
        dueAt: request.dueAt || other?.dueAt || "",
        recipient: request.recipient || other?.recipient || "",
        ...(delivery !== undefined ? { delivery } : {}),
        ...(other?.title !== undefined ? { title: other.title } : {}),
        ...(other?.approval !== undefined ? { approval: other.approval } : {}),
      };
    }),
    ...listed.filter((request) => !seen.has(request.id)),
  ];
}

/** What the server answers when evidence in hand changed a request as it was being
 * approved or submitted (outbound.IN_HAND_CHANGED, IN_HAND_ALL): shown as they are, and
 * the plan is read again, since the rows now travel in other requests. */
export const IN_HAND_REFUSALS: readonly string[] = [
  "Evidence for part of this request is already in hand, so the request was updated to ask only for the rest. Review it again before approving.",
  "Evidence for every item of this request is already in hand, so nothing needs sending.",
];

/** Whether a refusal means the requests changed under the person: read them again. */
export function rereadsRequests(detail: string): boolean {
  const said = detail.split(/\s+/).join(" ").trim();
  return (
    IN_HAND_REFUSALS.includes(said) ||
    said === "this item is not one the request asks for" ||
    said === "This item is not one the request asks for."
  );
}

type Approved = { id: string; text: string; sourceKind: string };

export type EvidenceInput = {
  /** The plan's requirements; only the DESIGN ones are read. */
  requirements: readonly Requirement[];
  /** The approved attributes, in their order: the letters follow it. */
  approved: readonly Approved[];
  /** The control's requests of the D&I phase (its evidence request and any follow-up). */
  requests: readonly Carrier[];
  /** The process owner, as the control records them; the role where it is known. */
  owner: { name: string; role: string };
  /** Approved attributes a person decided are not evidenced at D&I, with why. */
  exceptions: ReadonlyArray<{
    attributeId: string;
    reason: string;
    recordedBy: string;
    recordedAt: string | null;
  }>;
  /** Whether live email is on in this environment (the plan's `live_email`); null when
   * the server did not say. */
  liveEmail: boolean | null;
  /** The plan's procedures each requirement serves, from the test plan; null when it
   * was not read. Used only for a requirement that does not carry its own. */
  procedures: Readonly<Record<string, readonly string[]>> | null;
  /** The window the design evidence covers, where a request names none of its own. */
  period: string;
  /** The time now, in milliseconds: how long a request has been overdue. */
  now: number;
  /** What the assurance chain says of the control's D&I requests
   * (docs/evidence-assurance.md); null when the read failed or did not parse. Required,
   * so no caller falls back by leaving it out: null fails closed, and the coverage is
   * then not known (no attribute evidenced from a D&I request). */
  assurance: EvidenceAssurance | null;
};

/** Where a row stands. The first eight are the list's vocabulary (product owner, 12
 * November 2026); the rest are states the plan can hold that none of the eight says
 * truthfully. Never "Accepted" alone: before the requests are drafted that means the
 * request itself was accepted. */
export type ChipState =
  | "TO_SEND"
  | "IN_HAND"
  | "WITH_OWNER"
  | "OVERDUE"
  | "READING"
  | "TO_REVIEW"
  | "FOLLOW_UP"
  | "FOLLOW_UP_HANDED"
  | "ACCEPTED"
  | "HANDED_OVER"
  | "FOLLOW_UP_TO_SEND"
  | "INSUFFICIENT"
  | "NO_FILE"
  | "TO_ACCEPT"
  | "NOT_APPLICABLE"
  | "CANCELLED";

export type ChipTone =
  | "ai"
  | "neutral"
  | "info"
  | "danger"
  | "warning"
  | "success";

export const EVIDENCE_CHIPS: Record<
  ChipState,
  { label: string; tone: ChipTone }
> = {
  TO_SEND: { label: "To send", tone: "ai" },
  IN_HAND: { label: "In hand", tone: "neutral" },
  WITH_OWNER: { label: "With owner", tone: "info" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  READING: { label: "Reading…", tone: "ai" },
  TO_REVIEW: { label: "To review", tone: "ai" },
  FOLLOW_UP: { label: "Follow-up sent", tone: "warning" },
  // Email was off when the follow-up was approved: handed over, never sent.
  FOLLOW_UP_HANDED: { label: "Follow-up handed over", tone: "warning" },
  ACCEPTED: { label: "Evidence accepted", tone: "success" },
  // Live email is off: the request was handed over by a person, never emailed.
  HANDED_OVER: { label: "Handed over", tone: "info" },
  // A person asked for a follow-up, and no follow-up request has gone out.
  FOLLOW_UP_TO_SEND: { label: "Follow-up to send", tone: "warning" },
  INSUFFICIENT: { label: "Insufficient", tone: "danger" },
  // Its request is marked received, yet no file serves this row.
  NO_FILE: { label: "No file yet", tone: "warning" },
  // The planner proposes a change to it: the pre-release list's own word.
  TO_ACCEPT: { label: "To accept", tone: "ai" },
  NOT_APPLICABLE: { label: "Not applicable", tone: "neutral" },
  CANCELLED: { label: "Request cancelled", tone: "neutral" },
};

/** What the agent's reading of a row's files says, in the agent's tone. */
export type Reading = {
  /** "Agent proposes: sufficient." or, once a person decided, "Agent proposed: …". */
  lead: string;
  text: string;
  followUps: string[];
};

export type EvidenceRow = {
  id: string;
  version: number;
  title: string;
  description: string;
  kind: string;
  icon: IconName;
  categories: string[];
  /** The kind and the evidence fact: "Policy or procedure · No file yet". */
  sub: string;
  letters: string[];
  attributeIds: string[];
  /** What a screen reader hears for the letters. */
  addresses: string;
  state: ChipState;
  chip: { label: string; tone: ChipTone };
  files: number;
  reading: number;
  /** It left the draft: its wording is no longer edited and it is not deleted. */
  sent: boolean;
  /** Why it takes no more evidence, or null while it can. */
  uploadBlocked: string | null;
  /** A person can accept what arrived: something was received and a file serves it. */
  canAccept: boolean;
  /** Something arrived, so a person can judge it: a follow-up, or insufficient. */
  judgeable: boolean;
  /** A person decided it (accepted, insufficient, follow-up): the decision can reopen. */
  decided: boolean;
  /** The row waits on a person now: a file to review, or a proposed change. */
  waits: boolean;
  agent: Reading | null;
  /** What the reader proposes for it: SUFFICIENT, FOLLOW_UP, INSUFFICIENT, or NONE. */
  proposal: string;
  /** A person's note on their decision, with who decided where it is known. */
  note: string;
  /** The window it covers. */
  period: string;
  /** The planner proposes a change to it. */
  change: { remove: boolean; title: string; description: string } | null;
  /** The plan's procedures it serves; null when the test plan could not be read. */
  procedureIds: string[] | null;
  /** Out of the count: not applicable, or its request cancelled. */
  aside: boolean;
  /** Its evidence was uploaded before its request was sent (the server's word). */
  inHand: boolean;
  /** The request it travels in; null while none is drafted for it. */
  requestId: string | null;
  /** How its request went out; null when it has not, or the server did not say. */
  delivery: Delivery | null;
  /** The plan's own state for the requirement. */
  planState: string;
  /** What the assurance chain says of the row's files: each file's check and, once one
   * is finished, each attribute's state. Null where the chain has no entry for them. */
  assurance: AssuranceRow | null;
};

export type EvidenceStanding =
  | "EMPTY"
  | "SEND"
  | "AWAITING_APPROVAL"
  | "APPROVED_UNSENT"
  | "SEND_FAILED"
  | "NOT_DRAFTED"
  | "CHANGES"
  | "READING"
  | "REVIEW"
  | "FOLLOW_UP"
  | "INSUFFICIENT"
  | "WITH_OWNER"
  | "DONE";

/** The step's header, as the workflow reads it: the node, the drawer's pill, the one
 * decision line and the agent's line all come from here, so they never disagree. */
export type EvidenceHeader = {
  standing: EvidenceStanding;
  tone: "done" | "active" | "attention" | "blocked" | "idle";
  /** The pill: "2 requests to send". */
  status: string;
  need: {
    kind: "act" | "agent" | "wait" | "done";
    title: string;
    detail: string;
  };
  agent: { did: string; found: string[] };
};

export type DeliveryLine = {
  /** The request the line is about: what Change and Preview open. Null when none. */
  requestId: string | null;
  to: string;
  role: string;
  /** "Due Nov 26, 2026", or "" where no date is set. */
  due: string;
  status: string;
  tone: "neutral" | "success" | "danger" | "info";
  /** The recipient and the due date can still be changed. */
  canChange: boolean;
  /** It reached its owner: by email, handed over, or (where the server did not say
   * how) no longer a draft. */
  out: boolean;
  /** Nothing goes anywhere for these rows (evidence in hand, or set aside): the line
   * names no recipient. */
  quiet: boolean;
  /** What the person does next on the request itself, where it is approved and nothing
   * went out ("Send", "Try again", "Hand over", "Submit again"): it opens the request,
   * which holds the action the server allows. Null where there is none. */
  action: string | null;
  /** What opening the request is called here: never "the email" for a draft or a
   * hand-over. "" where there is no request to open. */
  preview: string;
  /** Approved and not out, or the send failed: what the step's line says of it. */
  pending: "APPROVED" | "FAILED" | "AWAITING" | null;
};

/** The coverage line where the checks against the attributes could not be read. */
export const COVERAGE_UNREAD =
  "The checks against the attributes could not be read. Refresh to try again.";

/** The rows that travel in one request, under that request's delivery line. */
export type RequestGroup = {
  /** The request's id, or "none" for rows no request is drafted for. */
  key: string;
  line: DeliveryLine;
  rowIds: string[];
  /** A request no row travels in (a follow-up, a samples request): what it is, by its
   * kind and title. "" for a group with rows. */
  label: string;
};

export type ExceptionLine = {
  attributeId: string;
  letter: string;
  text: string;
  reason: string;
  recordedBy: string;
  recordedAt: string | null;
};

export type HistoryRow = {
  id: string;
  version: number;
  title: string;
  kind: string;
};

export type CoverageState =
  | "EVIDENCED"
  // Accepted, and its check supports it with the documented design alone: D&I needs
  // the implementation shown too.
  | "DESIGN_ONLY"
  // Accepted requests show some of its elements from an instance's records, not all.
  | "PARTLY"
  | "REQUESTED"
  | "EXCEPTED"
  | "UNCOVERED";

export type CoverageChip = {
  attributeId: string;
  letter: string;
  text: string;
  state: CoverageState;
  /** The chip in words: the mark and the colour never replace them. */
  label: string;
  /** The recorded reason, where it is not evidenced at D&I; "" otherwise. */
  reason: string;
  /** The elements no accepted request shows from an instance's records yet, by their
   * text; empty where none was read or all are shown. */
  missing: string[];
  /** Accepted on a request the chain checked, and its check shows nothing of it. */
  unsupported: boolean;
  /** Evidenced, and shown across this many accepted requests (2 or more: combined, to
   * be checked for the same instance); 1 where one request shows it; 0 otherwise. */
  across: number;
};

export type EvidenceAttribute = {
  id: string;
  letter: string;
  text: string;
  source: string;
};

export type EvidenceList = {
  /** "Requests · 2" */
  title: string;
  rows: EvidenceRow[];
  header: EvidenceHeader;
  /** The rows by the request they travel in, each under its delivery line: what waits
   * to be sent first, then what the owner has, then what is complete, then evidence in
   * hand. One group is the usual case. */
  groups: RequestGroup[];
  send: {
    /** A request is drafted and waits to be sent: the bar shows its primary action. */
    show: boolean;
    /** Live email is off here: approving hands the requests over; nothing is emailed. */
    handover: boolean;
    label: string;
  };
  coverage: CoverageChip[];
  coverageLine: string;
  /** The checks could not be read: no attribute is shown as evidenced from a D&I
   * request, and the coverage line says so. */
  coverageUnread: boolean;
  /** Attributes not evidenced at D&I, each with the recorded reason. */
  exceptions: ExceptionLine[];
  /** Deleted requests, each restorable: part of the record. */
  history: HistoryRow[];
  attributes: EvidenceAttribute[];
  sources: string;
  /** The Activity fold's one line. */
  activityLine: string;
  /** The row that starts open: the first that waits on a person. */
  open: string | null;
};

const BEFORE_SENDING: readonly string[] = [
  "NOT_GENERATED",
  "AWAITING_DEPENDENCY",
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVAL_PENDING",
];
const ARRIVED: readonly string[] = [
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "UNDER_REVIEW",
];
const JUDGEABLE: readonly string[] = [
  ...ARRIVED,
  "ACCEPTED",
  "INSUFFICIENT",
  "FOLLOW_UP_REQUIRED",
];
const DECIDED: readonly string[] = [
  "ACCEPTED",
  "INSUFFICIENT",
  "FOLLOW_UP_REQUIRED",
];
const NOT_OUT: readonly string[] = ["DRAFT", "APPROVAL_PENDING", "CANCELLED"];
const LATE: readonly string[] = ["OVERDUE", "ESCALATED"];

const SOURCE_WORDS: Record<string, string> = {
  LIBRARY: "the control library",
  RCM: "the client's RCM",
  MANUAL: "the team",
  AGENT: "the agent, approved by the team",
  DOCUMENT: "supporting documents, approved by the team",
};

const SOURCE_SHORT: Record<string, string> = {
  LIBRARY: "Library",
  RCM: "Client RCM",
  MANUAL: "Team",
  AGENT: "Agent · approved",
  DOCUMENT: "Document · approved",
};

const PROPOSAL_WORDS: Record<string, string> = {
  SUFFICIENT: "sufficient",
  FOLLOW_UP: "a follow-up",
  INSUFFICIENT: "insufficient",
};

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Letters as a person says them: "A to D" for a run of three or more in the attributes'
 * order, else "A and C". `all` is every letter, in order. */
export function lettersSpan(
  letters: readonly string[],
  all: readonly string[],
): string {
  if (letters.length >= 3) {
    const at = letters.map((letter) => all.indexOf(letter));
    const run = at.every(
      (place, index) => place >= 0 && place === (at[0] ?? 0) + index,
    );
    if (run) {
      return `${letters[0]} to ${letters[letters.length - 1]}`;
    }
  }
  return listed(letters);
}

const isReading = (file: { readStatus: string | null }) =>
  file.readStatus === "PENDING" || file.readStatus === "WORKING";

function timeOf(value: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T23:59:59Z`)
    : Date.parse(value);
}

/** How many whole days past its due date a request is; 0 when it is not, or has none. */
export function daysOverdue(dueAt: string, now: number): number {
  const due = timeOf(dueAt);
  if (Number.isNaN(due) || now <= due) {
    return 0;
  }
  return Math.max(1, Math.ceil((now - due) / (24 * 60 * 60 * 1000)));
}

const endsCleanly = (text: string) => {
  const trimmed = text.trim();
  return trimmed === "" || /[.!?)"'…]$/.test(trimmed) ? trimmed : `${trimmed}…`;
};

/** The D&I requests the list shows: live ones, then those set aside (not applicable, or
 * their request cancelled), which a person can restore. A removed one is the history's. */
function shown(item: Pick<Requirement, "phase" | "state">): boolean {
  return item.phase === "DESIGN" && item.state !== "REMOVED";
}

function stateOf(
  item: Requirement,
  carrier: Carrier | null,
  followUp: Carrier | null,
  now: number,
): ChipState {
  const files = item.files.length;
  const delivered = carrier?.delivery ?? null;
  // A request handed over while email is off stays awaiting approval on the server:
  // what went out is read from its delivery, never from the status alone.
  const unsent = BEFORE_SENDING.includes(item.state) && delivered === null;
  if (item.state === "NOT_APPLICABLE") {
    return "NOT_APPLICABLE";
  }
  if (item.state === "CANCELLED") {
    return "CANCELLED";
  }
  if (item.pendingChange !== null) {
    return "TO_ACCEPT";
  }
  if (item.state === "ACCEPTED") {
    return "ACCEPTED";
  }
  if (item.files.some(isReading)) {
    return "READING";
  }
  if (item.state === "INSUFFICIENT") {
    return "INSUFFICIENT";
  }
  if (item.state === "FOLLOW_UP_REQUIRED") {
    return followUp === null
      ? "FOLLOW_UP_TO_SEND"
      : followUp.delivery?.mode === "HANDED_OVER"
        ? "FOLLOW_UP_HANDED"
        : "FOLLOW_UP";
  }
  // Evidence uploaded before its request went out: said so, on the server's word only.
  if (item.inHand === true && delivered === null) {
    return "IN_HAND";
  }
  const owner = (): ChipState =>
    item.state === "OVERDUE" ||
    (carrier !== null &&
      (LATE.includes(carrier.status) || daysOverdue(carrier.dueAt, now) > 0) &&
      (delivered !== null || !NOT_OUT.includes(carrier.status)))
      ? "OVERDUE"
      : delivered?.mode === "HANDED_OVER"
        ? "HANDED_OVER"
        : "WITH_OWNER";
  if (ARRIVED.includes(item.state)) {
    if (files > 0) {
      return "TO_REVIEW";
    }
    // Its request is marked received, but nothing serves this row. Where the server
    // says the request went out, the owner still has it; where it does not, the page
    // does not claim it was sent.
    return delivered !== null ? owner() : "NO_FILE";
  }
  if (unsent) {
    return "TO_SEND";
  }
  return owner();
}

function readingOf(item: Requirement, decided: boolean): Reading | null {
  const word = PROPOSAL_WORDS[item.assessment.proposal];
  if (item.files.length === 0 || word === undefined) {
    return null;
  }
  return {
    lead: `${decided ? "Agent proposed" : "Agent proposes"}: ${word}.`,
    text: endsCleanly(item.assessment.reason),
    followUps: item.assessment.followUps,
  };
}

function factOf(
  item: Requirement,
  state: ChipState,
  assured: AssuranceRow | null,
): string {
  const files = item.files.length;
  const count = plural(files, "file");
  const by = item.sufficiencyBy ?? "";
  if (state === "NOT_APPLICABLE") {
    return item.waiveReason !== ""
      ? `Not applicable: ${item.waiveReason}`
      : "Not applicable";
  }
  if (files === 0) {
    return "No file yet";
  }
  const reading = item.files.filter(isReading).length;
  if (reading > 0) {
    return `${count} · Agent is reading`;
  }
  if (item.state === "ACCEPTED") {
    return `${count} · Accepted${by !== "" ? ` by ${by}` : ""}`;
  }
  if (item.state === "INSUFFICIENT") {
    return `${count} · Marked insufficient${by !== "" ? ` by ${by}` : ""}`;
  }
  if (item.state === "FOLLOW_UP_REQUIRED") {
    return `${count} · Follow-up asked${by !== "" ? ` by ${by}` : ""}`;
  }
  // The chain's check says where the files stand; the single reading's own proposal is
  // the row's only where the chain has no entry for them.
  if (assured !== null) {
    return `${count} · ${assured.fact}`;
  }
  const word = PROPOSAL_WORDS[item.assessment.proposal];
  return word === undefined ? count : `${count} · Agent: ${word}`;
}

function deliveryOf(
  carrier: Carrier | null,
  owner: EvidenceInput["owner"],
  complete: boolean,
  now: number,
  /** Live email is off here: what goes out is a hand-over. */
  handover = false,
): DeliveryLine {
  const to = owner.name.trim() || carrier?.recipient?.trim() || "";
  const base = {
    requestId: carrier?.id ?? null,
    to: to === "" ? "No recipient yet" : to,
    role: owner.name.trim() === "" ? "" : owner.role.trim(),
    due:
      carrier !== null && carrier.dueAt !== ""
        ? `Due ${formatDate(carrier.dueAt)}`
        : "",
  };
  if (carrier === null) {
    return {
      ...base,
      status: "Not drafted yet",
      tone: "neutral",
      canChange: false,
      out: false,
      quiet: false,
      action: null,
      preview: "",
      pending: null,
    };
  }
  const delivered = carrier.delivery ?? null;
  // Sent or handed over on the server's word. Where it did not say (no delivery field
  // at all), a request that left the draft reads as sent, without a date. Where it says
  // there was none, nothing is claimed, whatever the status.
  const out =
    delivered !== null ||
    (carrier.delivery === undefined && !NOT_OUT.includes(carrier.status));
  if (!out) {
    // Approved is not sent: an approval a person may not send on, or one whose send was
    // refused, says so, with the action the request itself holds. With email off the
    // approval of a person who may not send records no hand-over either.
    const approval =
      carrier.status === "APPROVAL_PENDING" ? (carrier.approval ?? null) : null;
    const standing: Pick<DeliveryLine, "status" | "action" | "pending"> =
      approval === "APPROVED" || approval === "RESEND"
        ? {
            status: handover
              ? "Approved, not handed over"
              : "Approved, not sent",
            action: handover
              ? "Hand over"
              : approval === "RESEND"
                ? "Send again"
                : "Send",
            pending: "APPROVED",
          }
        : approval === "FAILED"
          ? {
              status: handover ? "Approved, not handed over" : "Send failed",
              action: handover ? "Hand over" : "Try again",
              pending: handover ? "APPROVED" : "FAILED",
            }
          : approval === "EXPIRED"
            ? {
                status: "Approval expired",
                action: "Submit again",
                pending: "AWAITING",
              }
            : carrier.status === "APPROVAL_PENDING"
              ? {
                  status: "Awaiting approval",
                  action: null,
                  pending: "AWAITING",
                }
              : {
                  status:
                    carrier.status === "CANCELLED"
                      ? "Cancelled"
                      : carrier.status === "DRAFT" &&
                          carrier.approval === "REJECTED"
                        ? "Returned for changes"
                        : "Not sent",
                  action: null,
                  pending: null,
                };
    return {
      ...base,
      ...standing,
      tone: standing.status === "Send failed" ? "danger" : "neutral",
      canChange:
        carrier.status === "DRAFT" || carrier.status === "APPROVAL_PENDING",
      out: false,
      quiet: false,
      preview: "Preview the request",
    };
  }
  const preview =
    delivered?.mode === "HANDED_OVER"
      ? "The request as handed over"
      : delivered?.mode === "EMAIL"
        ? "Preview the email"
        : "Preview the request";
  // Out: by email, handed over, or (where the server did not say how) no longer a draft.
  const when = delivered?.at != null ? ` ${formatDate(delivered.at)}` : "";
  const how =
    delivered === null
      ? "Sent"
      : delivered.mode === "HANDED_OVER"
        ? `Handed over${when}${delivered.by !== null ? ` by ${delivered.by}` : ""}`
        : `Sent${when}`;
  const late = complete ? 0 : daysOverdue(carrier.dueAt, now);
  if (late > 0 || (!complete && LATE.includes(carrier.status))) {
    return {
      ...base,
      status:
        late > 0
          ? `${how} · Overdue by ${plural(late, "day")}`
          : `${how} · Overdue`,
      tone: "danger",
      canChange: true,
      out: true,
      quiet: false,
      action: null,
      preview,
      pending: null,
    };
  }
  return {
    ...base,
    status: complete ? `${how} · complete` : how,
    tone: delivered?.mode === "HANDED_OVER" ? "info" : "success",
    canChange: !complete,
    out: true,
    quiet: false,
    action: null,
    preview,
    pending: null,
  };
}

/** What the D&I Evidence step shows once its requests are drafted. */
export function evidenceList(input: EvidenceInput): EvidenceList {
  const handover = input.liveEmail === false;
  const design = input.requirements.filter(shown);
  const attributes: EvidenceAttribute[] = input.approved.map((item, at) => ({
    id: item.id,
    letter: attributeLetter(at),
    text: item.text,
    source: SOURCE_SHORT[item.sourceKind] ?? "Team",
  }));
  const allLetters = attributes.map((item) => item.letter);
  const carrierOf = (item: Requirement) =>
    input.requests.find((request) => request.id === item.requestId) ?? null;
  const followUp =
    input.requests.find(
      (request) =>
        request.kind === "FOLLOW_UP" &&
        // Out on the server's word; where it did not say how, by its status.
        (request.delivery != null ||
          (request.delivery === undefined &&
            !NOT_OUT.includes(request.status))),
    ) ?? null;

  const keyed = keyedOf(input.assurance);
  const rows: EvidenceRow[] = design.map((item) => {
    const carrier = carrierOf(item);
    const state = stateOf(item, carrier, followUp, input.now);
    const addressed = attributes.filter((each) =>
      item.attributeIds.includes(each.id),
    );
    const letters = addressed.map((each) => each.letter);
    const { kind, icon } = itemKind(item.categories);
    const files = item.files.length;
    const reading = item.files.filter(isReading).length;
    const decided = DECIDED.includes(item.state);
    const judgeable = JUDGEABLE.includes(item.state);
    const aside = state === "NOT_APPLICABLE" || state === "CANCELLED";
    const canAccept =
      judgeable && files > 0 && item.state !== "ACCEPTED" && reading === 0;
    const who = item.sufficiencyBy ?? "";
    const assured =
      input.assurance == null
        ? null
        : assuranceRow({
            requirementId: item.id,
            files: item.files.map((file) => ({
              id: file.fileId,
              name: file.name,
            })),
            assurance: input.assurance,
            attributes,
            span: (some) => lettersSpan(some, allLetters),
            keyed,
          });
    // Where the chain has an entry for the request, its two readings stand in for the
    // reader's single one: the reader's proposal and its follow-up points were never
    // checked by a second reading, so they are not put to the person.
    const single = assured === null;
    return {
      id: item.id,
      version: item.version,
      title: item.title,
      description: item.description,
      kind,
      icon,
      categories: [...item.categories],
      sub: `${item.necessity === "OPTIONAL" ? `${kind} · Optional` : kind} · ${factOf(item, state, assured)}`,
      letters,
      attributeIds: addressed.map((each) => each.id),
      addresses:
        letters.length === 0
          ? "addresses no attribute"
          : `addresses attribute${letters.length === 1 ? "" : "s"} ${listed(letters)}`,
      state,
      chip: EVIDENCE_CHIPS[state],
      files,
      reading,
      sent:
        (carrier?.delivery != null || !BEFORE_SENDING.includes(item.state)) &&
        item.inHand !== true,
      uploadBlocked:
        item.state === "ACCEPTED"
          ? "Its evidence is accepted. Reopen the decision to add more."
          : state === "NOT_APPLICABLE"
            ? "It is marked not applicable. Restore it first."
            : state === "CANCELLED"
              ? "Its request was cancelled."
              : item.requestId === null
                ? "It is not drafted yet, so there is no request to file evidence to."
                : null,
      canAccept,
      judgeable,
      decided,
      waits:
        item.pendingChange !== null ||
        (canAccept && !decided && ARRIVED.includes(item.state)),
      agent: single ? readingOf(item, decided) : null,
      proposal:
        single &&
        files > 0 &&
        PROPOSAL_WORDS[item.assessment.proposal] !== undefined
          ? item.assessment.proposal
          : "NONE",
      note:
        item.sufficiencyNote === ""
          ? ""
          : `${decided || who !== "" ? "" : "Decision reopened: "}${item.sufficiencyNote}${who !== "" ? ` (${who})` : ""}`,
      period: item.periodLabel || input.period,
      change:
        item.pendingChange === null
          ? null
          : {
              remove: item.pendingChange.remove,
              title: item.pendingChange.title,
              description: item.pendingChange.description,
            },
      procedureIds:
        item.procedureIds ??
        (input.procedures === null
          ? null
          : [...(input.procedures[item.id] ?? [])]),
      aside,
      inHand: item.inHand === true,
      requestId: item.requestId,
      delivery: carrier?.delivery ?? null,
      planState: item.state,
      assurance: assured,
    };
  });
  const live = rows.filter((row) => !row.aside);

  // The rows by the request they travel in. Evidence in hand splits a request (the rows
  // in hand stay on it, the rest move to a new draft), and a follow-up is a request of
  // its own, so several are normal; one is the usual case.
  const keys = [...new Set(rows.map((row) => row.requestId ?? "none"))];
  const groups: RequestGroup[] = keys
    .map((key) => {
      const members = rows.filter((row) => (row.requestId ?? "none") === key);
      const active = members.filter((row) => !row.aside);
      const carrier =
        input.requests.find((request) => request.id === key) ?? null;
      const done =
        active.length > 0 && active.every((row) => row.state === "ACCEPTED");
      const inHand =
        carrier?.delivery == null &&
        active.length > 0 &&
        active.every((row) => row.inHand);
      const still = {
        requestId: carrier?.id ?? null,
        to: "",
        role: "",
        due: "",
        tone: "neutral" as const,
        canChange: false,
        out: false,
        quiet: true,
        action: null,
        preview: "",
        pending: null,
      };
      const line: DeliveryLine =
        active.length === 0
          ? { ...still, status: "Set aside" }
          : inHand
            ? {
                ...still,
                status: done
                  ? "In hand · complete"
                  : "In hand · nothing to send",
              }
            : deliveryOf(carrier, input.owner, done, input.now, handover);
      const rank =
        active.length === 0 ? 4 : inHand ? 3 : !line.out ? 0 : done ? 2 : 1;
      return {
        key,
        line,
        rowIds: members.map((row) => row.id),
        label: "",
        rank,
      };
    })
    // Every other request of the phase has its place too (a follow-up, a samples
    // request, one a split emptied): a line with no rows under it, in the same order.
    // Not a cancelled one: it asks for nothing and went nowhere.
    .concat(
      input.requests
        .filter(
          (request) =>
            !keys.includes(request.id) && request.status !== "CANCELLED",
        )
        .map((request) => {
          const done =
            request.status === "RECEIVED" || request.status === "CLOSED";
          const line = deliveryOf(
            request,
            input.owner,
            done,
            input.now,
            handover,
          );
          const what =
            request.kind === "FOLLOW_UP"
              ? "Follow-up request"
              : request.kind === "SAMPLES"
                ? "Samples request"
                : "Request";
          const title = (request.title ?? "").trim();
          return {
            key: request.id,
            line,
            rowIds: [] as string[],
            label: title === "" ? what : `${what} · ${title}`,
            rank: !line.out ? 0 : done ? 2 : 1,
          };
        }),
    )
    .sort((a, b) => a.rank - b.rank)
    .map(({ key, line, rowIds, label }) => ({ key, line, rowIds, label }));
  // The request the owner has now (the step's one waiting line names it), else the
  // first that went out, else the first there is.
  const WAITS: readonly ChipState[] = [
    "WITH_OWNER",
    "HANDED_OVER",
    "OVERDUE",
    "NO_FILE",
  ];
  const lead =
    groups.find(
      (group) =>
        group.line.out &&
        group.rowIds.some((id) =>
          live.some((row) => row.id === id && WAITS.includes(row.state)),
        ),
    ) ??
    groups.find((group) => group.line.out) ??
    groups.find((group) => !group.line.quiet) ??
    null;
  const main =
    input.requests.find((request) => request.id === lead?.key) ?? null;
  const delivery =
    lead?.line ?? deliveryOf(null, input.owner, false, input.now, handover);

  // Coverage: outline where a request addresses the attribute, green with a check once
  // the evidence of one such request is accepted. Where the assurance chain checked a
  // row's files, accepting it evidences the attributes both readings support with the
  // records of an instance, and no other (docs/evidence-assurance.md, section 3): D&I
  // needs the design and its implementation, so support by a policy's word alone is
  // "design documented, implementation not yet shown"; the agents' support alone is
  // only ready to accept, and an acceptance alone does not evidence what the check did
  // not support.
  // An attribute is evidenced only when every one of its elements is shown from the
  // records of an instance by some accepted request, the elements combined across the
  // control's requests by key (attributeCoverage). A row the chain has no entry for
  // evidences what it addresses once accepted, as before the chain.
  const checked = (accepting: (row: EvidenceRow) => boolean) =>
    live.flatMap((row) =>
      row.assurance === null
        ? []
        : [{ accepted: accepting(row), facts: row.assurance.elementFacts }],
    );
  const settled = checked((row) => row.state === "ACCEPTED");
  // Fail closed: where the checks could not be read, no D&I request evidences anything
  // and the coverage says it is not known. The rows-without-an-entry path is for a read
  // that succeeded.
  const unread = input.assurance == null && live.length > 0;
  const legacy = (
    attributeId: string,
    accepting: (row: EvidenceRow) => boolean,
  ) =>
    !unread &&
    live.some(
      (row) =>
        row.assurance === null &&
        accepting(row) &&
        row.attributeIds.includes(attributeId),
    );
  const reasonOf = new Map(
    input.exceptions.map((item) => [item.attributeId, item]),
  );
  const excepted = new Set(reasonOf.keys());
  const coverage: CoverageChip[] = attributes.map((item) => {
    const addressing = live.filter((row) => row.attributeIds.includes(item.id));
    const found = attributeCoverage(item.id, settled);
    // Accepted on a row the chain checked, and its check shows nothing of it.
    const unsupported =
      (found.state === "NONE" || found.state === "UNKNOWN") &&
      live.some(
        (row) =>
          row.state === "ACCEPTED" &&
          row.assurance !== null &&
          row.attributeIds.includes(item.id),
      );
    const state: CoverageState =
      legacy(item.id, (row) => row.state === "ACCEPTED") ||
      found.state === "EVIDENCED"
        ? "EVIDENCED"
        : found.state === "DESIGN_ONLY"
          ? "DESIGN_ONLY"
          : found.state === "PARTLY"
            ? "PARTLY"
            : addressing.length > 0
              ? "REQUESTED"
              : excepted.has(item.id)
                ? "EXCEPTED"
                : "UNCOVERED";
    const missing = state === "EVIDENCED" ? [] : found.missing;
    const accepted = addressing.some((row) => row.state === "ACCEPTED");
    // Combined from two or more requests: never plain "evidence accepted".
    const across =
      state !== "EVIDENCED"
        ? 0
        : found.state === "EVIDENCED"
          ? found.across
          : 1;
    return {
      attributeId: item.id,
      letter: item.letter,
      text: item.text,
      state,
      label:
        state === "EVIDENCED"
          ? across >= 2
            ? `Attribute ${item.letter}: shown across ${across} requests`
            : `Attribute ${item.letter}: evidence accepted`
          : unread && accepted
            ? `Attribute ${item.letter}: evidence accepted; its check could not be read`
            : state === "DESIGN_ONLY"
              ? `Attribute ${item.letter}: ${DESIGN_ONLY}`
              : state === "PARTLY"
                ? `Attribute ${item.letter}: shown in part${missing.length > 0 ? `; still not shown: ${missing.join("; ")}` : ""}`
                : state === "REQUESTED"
                  ? unsupported
                    ? `Attribute ${item.letter}: evidence accepted, and its check does not show the attribute supported`
                    : `Attribute ${item.letter}: requested, no evidence accepted yet`
                  : state === "EXCEPTED"
                    ? `Attribute ${item.letter}: not evidenced at D&I, with a recorded reason`
                    : `Attribute ${item.letter}: not addressed by any request`,
      reason: state === "EXCEPTED" ? (reasonOf.get(item.id)?.reason ?? "") : "",
      // Which elements are still not shown, by their text, once a check has read them.
      missing: state === "REQUESTED" && !unsupported ? [] : missing,
      unsupported: state === "REQUESTED" && unsupported,
      across,
    };
  });
  const exceptions: ExceptionLine[] = attributes.flatMap((item) => {
    const reason = reasonOf.get(item.id);
    return reason === undefined
      ? []
      : [{ ...reason, letter: item.letter, text: item.text }];
  });
  const evidenced = coverage.filter((chip) => chip.state === "EVIDENCED");
  const gaps = coverage.filter((chip) => chip.state === "UNCOVERED");
  const reasons = coverage.filter((chip) => chip.state === "EXCEPTED");
  const designed = coverage.filter((chip) => chip.state === "DESIGN_ONLY");
  const inPart = coverage.filter((chip) => chip.state === "PARTLY");
  const review = live.filter((row) => row.canAccept && !row.decided);
  // What accepting the files that wait would add to the coverage.
  const waits = (row: EvidenceRow) =>
    row.state === "ACCEPTED" || review.includes(row);
  const wouldCover = attributes
    .filter(
      (item) =>
        !unread &&
        !evidenced.some((chip) => chip.attributeId === item.id) &&
        (legacy(item.id, (row) => review.includes(row)) ||
          attributeCoverage(item.id, checked(waits)).state === "EVIDENCED"),
    )
    .map((item) => item.letter);
  const bare = coverage
    .filter((chip) => chip.unsupported)
    .map((chip) => chip.letter);
  const reviewFiles = review.reduce((sum, row) => sum + row.files, 0);
  const combined = evidenced.filter((chip) => chip.across >= 2);
  const coverageLine =
    attributes.length === 0
      ? "No approved attributes"
      : unread
        ? COVERAGE_UNREAD
        : [
            evidenced.length === 0 &&
            gaps.length === 0 &&
            reasons.length === 0 &&
            wouldCover.length === 0 &&
            bare.length === 0 &&
            designed.length === 0 &&
            inPart.length === 0
              ? "Every attribute is requested · none evidenced yet"
              : `${evidenced.length} of ${plural(attributes.length, "attribute")} evidenced`,
            combined.length > 0
              ? combined
                  .map(
                    (chip) =>
                      `${chip.letter} shown across ${chip.across} requests`,
                  )
                  .join(" · ")
              : "",
            wouldCover.length > 0
              ? `accepting ${reviewFiles === 1 ? "this file" : "these files"} covers ${lettersSpan(wouldCover, allLetters)}`
              : "",
            inPart.length > 0
              ? `${lettersSpan(
                  inPart.map((chip) => chip.letter),
                  allLetters,
                )} shown in part`
              : "",
            designed.length > 0
              ? `${lettersSpan(
                  designed.map((chip) => chip.letter),
                  allLetters,
                )} ${DESIGN_ONLY}`
              : "",
            bare.length > 0
              ? `${lettersSpan(bare, allLetters)} accepted without support from the check`
              : "",
            reasons.length > 0
              ? `${lettersSpan(
                  reasons.map((chip) => chip.letter),
                  allLetters,
                )} not evidenced at D&I, with a recorded reason`
              : "",
            gaps.length > 0
              ? `${lettersSpan(
                  gaps.map((chip) => chip.letter),
                  allLetters,
                )} not addressed by any request`
              : "",
          ]
            .filter((part) => part !== "")
            .join(" · ");

  // Beside Accept: a request that, accepted, evidences an attribute only together with
  // other requests is said so, with the one check the person makes.
  const sameInstance = new Map<string, string>();
  for (const row of review) {
    if (row.assurance === null || unread) {
      continue;
    }
    const joined = attributes
      .filter((item) =>
        row.assurance?.elementFacts.some(
          (fact) =>
            fact.attributeId === item.id && fact.implementation.length > 0,
        ),
      )
      .map((item) => ({
        item,
        found: attributeCoverage(
          item.id,
          checked((each) => each.state === "ACCEPTED" || each === row),
        ),
      }))
      .filter(({ found }) => found.state === "EVIDENCED" && found.across >= 2);
    if (joined.length > 0) {
      const counts = new Set(joined.map(({ found }) => found.across));
      const [only] = [...counts];
      sameInstance.set(
        row.id,
        `Accepting this request shows ${lettersSpan(
          joined.map(({ item }) => item.letter),
          allLetters,
        )} across ${counts.size === 1 && only !== undefined ? `${only} requests` : "several requests"}. ${SAME_INSTANCE}`,
      );
    }
  }

  // A request of the phase is drafted and waits for a person to approve and send it.
  const drafted = input.requests.some((request) => request.status === "DRAFT");
  const header = headerOf({
    live,
    review,
    reviewFiles,
    main,
    // What the requests of the rows that wait to be sent wait for themselves: a send
    // that failed first, then an approval nobody sent on, then an approval.
    approval:
      (["FAILED", "APPROVED", "AWAITING"] as const).find((pending) =>
        groups.some(
          (group) =>
            group.line.pending === pending &&
            group.rowIds.some((id) =>
              live.some((row) => row.id === id && row.state === "TO_SEND"),
            ),
        ),
      ) ?? null,
    followUp,
    owner: delivery.to,
    handover,
    attributes: attributes.length,
    now: input.now,
    drafted,
    assured:
      input.assurance == null || input.assurance.requests.length === 0
        ? null
        : assuranceCounts(input.assurance),
  });

  const received = live.reduce((sum, row) => sum + row.files, 0);
  const accepted = live.filter((row) => row.state === "ACCEPTED").length;
  const out = delivery.out;
  const requested = design
    .filter((item) => item.acceptedBy !== null && item.acceptedAt !== null)
    .sort((a, b) => (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? ""))[0];
  const activityLine = out
    ? [
        delivery.status.split(" · ")[0] ?? "",
        received > 0 ? `${plural(received, "file")} received` : "",
        accepted > 0 ? `${accepted} accepted` : "",
      ]
        .filter((part) => part !== "")
        .join(" · ")
    : requested !== undefined
      ? `Requests accepted by ${requested.acceptedBy}, ${formatDate(requested.acceptedAt ?? "")}`
      : "Nothing sent yet";

  return {
    title: `Requests · ${live.length}`,
    rows: rows.map((row) => {
      const note = sameInstance.get(row.id);
      return note === undefined || row.assurance === null
        ? row
        : {
            ...row,
            assurance: {
              ...row.assurance,
              acceptNote: `${row.assurance.acceptNote} ${note}`,
            },
          };
    }),
    header,
    groups,
    send: {
      show: drafted,
      handover,
      label: handover ? "Approve and mark as handed over" : "Approve and send",
    },
    coverage,
    coverageLine,
    coverageUnread: unread,
    exceptions,
    history: input.requirements
      .filter(
        (item) =>
          item.phase === "DESIGN" &&
          item.state === "REMOVED" &&
          item.pendingChange?.add !== true,
      )
      .map((item) => ({
        id: item.id,
        version: item.version,
        title: item.title,
        kind: itemKind(item.categories).kind,
      })),
    attributes,
    sources: listed([
      ...new Set(
        input.approved.map(
          (item) => SOURCE_WORDS[item.sourceKind] ?? "the team",
        ),
      ),
    ]),
    activityLine,
    open: rows.find((row) => row.waits)?.id ?? null,
  };
}

function headerOf(facts: {
  live: readonly EvidenceRow[];
  review: readonly EvidenceRow[];
  reviewFiles: number;
  main: Carrier | null;
  approval: "APPROVED" | "FAILED" | "AWAITING" | null;
  followUp: Carrier | null;
  owner: string;
  handover: boolean;
  attributes: number;
  now: number;
  /** A request of the phase is drafted and waits to be approved and sent. */
  drafted: boolean;
  /** What the assurance chain's checks need of the person; null where it has none. */
  assured: AssuranceCounts | null;
}): EvidenceHeader {
  const { live, review, reviewFiles, main, owner, handover } = facts;
  const count = (state: ChipState) =>
    live.filter((row) => row.state === state).length;
  const toSend = count("TO_SEND");
  const changes = count("TO_ACCEPT");
  const reading = live.reduce((sum, row) => sum + row.reading, 0);
  const followSent = count("FOLLOW_UP") + count("FOLLOW_UP_HANDED");
  const followToSend = count("FOLLOW_UP_TO_SEND");
  const insufficient = count("INSUFFICIENT");
  const accepted = count("ACCEPTED");
  const overdue = count("OVERDUE");
  const waiting =
    count("WITH_OWNER") + count("HANDED_OVER") + overdue + count("NO_FILE");
  const read = live.filter((row) => row.agent !== null);
  const readFiles = read.reduce((sum, row) => sum + row.files, 0);
  const proposals = (["SUFFICIENT", "FOLLOW_UP", "INSUFFICIENT"] as const)
    .map((key) => ({
      word: PROPOSAL_WORDS[key] ?? "",
      n: read.filter((row) => row.proposal === key).length,
    }))
    .filter((item) => item.n > 0);
  const drafted = `Drafted ${plural(live.length, "request")} from the control's understanding and its attributes.`;
  const found = [
    facts.attributes > 0
      ? `${plural(live.length, "request")} against ${plural(facts.attributes, "approved attribute")}.`
      : `${plural(live.length, "request")}.`,
    ...read.map((row) =>
      `${row.title}: ${row.agent?.lead ?? ""} ${row.agent?.text ?? ""}`.trim(),
    ),
    // What the two readings agree each checked row shows, and what they left open.
    ...live
      .filter((row) => row.assurance !== null && row.assurance.spoken !== "")
      .map((row) => `${row.title}: ${row.assurance?.spoken ?? ""}.`),
  ];
  const due = main !== null && main.dueAt !== "" ? formatDate(main.dueAt) : "";
  const at = main?.delivery?.at != null ? formatDate(main.delivery.at) : "";

  if (live.length === 0) {
    return {
      standing: "EMPTY",
      tone: "attention",
      status: "No requests",
      need: {
        kind: "act",
        title: "Add a request.",
        detail:
          "No D&I request is on the list. Add what to request, and choose the attributes it addresses.",
      },
      agent: { did: "No D&I request is drafted.", found: [] },
    };
  }
  if (toSend > 0 && facts.drafted) {
    return {
      standing: "SEND",
      tone: "attention",
      status: `${plural(toSend, "request")} to send`,
      need: {
        kind: "act",
        title: handover
          ? `Approve and hand over ${plural(toSend, "request")}.`
          : `Approve and send ${plural(toSend, "request")}.`,
        detail: `${
          handover
            ? "Email sending is off here, so nothing is emailed: approving records the requests as handed over to the process owner."
            : "Nothing reaches the process owner until you approve."
        } ${
          review.length > 0
            ? `${plural(reviewFiles, "file")} in hand ${reviewFiles === 1 ? "waits" : "wait"} for your review on ${reviewFiles === 1 ? "its row" : "their rows"}.`
            : "Evidence already in hand? Upload it on its row."
        }`,
      },
      agent: { did: drafted, found },
    };
  }
  if (toSend > 0 && facts.approval === "APPROVED") {
    return {
      standing: "APPROVED_UNSENT",
      tone: "attention",
      status: handover
        ? `${toSend} approved, not handed over`
        : `${toSend} approved, not sent`,
      need: {
        kind: "act",
        title: handover
          ? `Hand over ${plural(toSend, "approved request")}.`
          : `Send ${plural(toSend, "approved request")}.`,
        detail: handover
          ? "The requests are approved and no hand-over is recorded: email sending is off, so nothing is emailed. A person who may send completes the hand-over from the request's line."
          : "The requests are approved and nothing has gone out. A person who may send sends them from the request's line.",
      },
      agent: { did: drafted, found },
    };
  }
  if (toSend > 0 && facts.approval === "FAILED") {
    return {
      standing: "SEND_FAILED",
      tone: "attention",
      status: "Send failed",
      need: {
        kind: "act",
        title: "The send failed.",
        detail:
          "The requests are approved, the send was refused, and nothing went out. Try again from the request's line.",
      },
      agent: { did: drafted, found },
    };
  }
  if (toSend > 0) {
    return facts.approval === "AWAITING"
      ? {
          standing: "AWAITING_APPROVAL",
          tone: "active",
          status: `${toSend} awaiting approval`,
          need: {
            kind: "wait",
            title: "Awaiting approval",
            detail:
              "The requests are submitted for approval. Nothing reaches the process owner until they are approved.",
          },
          agent: { did: drafted, found },
        }
      : {
          standing: "NOT_DRAFTED",
          tone: "idle",
          status: `${toSend} not drafted yet`,
          need: {
            kind: "wait",
            title: "Not drafted yet",
            detail: `${plural(toSend, "request")} ${toSend === 1 ? "is" : "are"} not drafted yet. Nothing is sent until you approve it.`,
          },
          agent: { did: drafted, found },
        };
  }
  if (changes > 0) {
    return {
      standing: "CHANGES",
      tone: "attention",
      status: `${plural(changes, "change")} to decide`,
      need: {
        kind: "act",
        title: `Decide ${plural(changes, "proposed change")}.`,
        detail:
          "The agent proposes a change to a request. It stays as it is until you accept the change on its row.",
      },
      agent: { did: "Proposes a change to the requests.", found },
    };
  }
  if (review.length > 0) {
    const one = reviewFiles === 1;
    const proposed = review
      .map((row) => PROPOSAL_WORDS[row.proposal] ?? "")
      .filter((word) => word !== "");
    const tally = (["SUFFICIENT", "FOLLOW_UP", "INSUFFICIENT"] as const)
      .map((key) => ({
        word: PROPOSAL_WORDS[key] ?? "",
        n: review.filter((row) => row.proposal === key).length,
      }))
      .filter((item) => item.n > 0);
    const says =
      proposed.length === 0
        ? `The agent read ${one ? "it" : "them"} and proposes nothing: judge ${one ? "it" : "them"} yourself.`
        : `The agent read ${one ? "it" : "them"} and proposes: ${
            new Set(proposed).size === 1
              ? (proposed[0] ?? "")
              : tally.map((item) => `${item.n} ${item.word}`).join(", ")
          }.`;
    // The chain's checks: what they need of the person, counted from its summary. The
    // reader's own proposal is said only for a file the chain has no entry for.
    const checks =
      facts.assured === null ? "" : assuranceSentence(facts.assured);
    const pill = facts.assured === null ? "" : assurancePill(facts.assured);
    const readings =
      checks === "" ? says : proposed.length > 0 ? `${says} ${checks}` : checks;
    return {
      standing: "REVIEW",
      tone: "attention",
      status: `${plural(reviewFiles, "file")} to review${pill !== "" ? ` · ${pill}` : ""}`,
      need: {
        kind: "act",
        title: `Review ${plural(reviewFiles, "file")}.`,
        detail: `${readings} Nothing is accepted until you accept it.`,
      },
      agent: {
        did:
          proposals.length === 0
            ? `Read ${plural(readFiles || reviewFiles, "file")}.`
            : `Read ${plural(readFiles, "file")}: ${proposals
                .map((item) => `${item.n} ${item.word}`)
                .join(", ")}.`,
        found,
      },
    };
  }
  if (reading > 0) {
    return {
      standing: "READING",
      tone: "active",
      status: `Reading ${plural(reading, "file")}`,
      need: {
        kind: "agent",
        title: `Reading ${plural(reading, "file")}`,
        detail: `The agent is reading ${plural(reading, "file")}. ${reading === 1 ? "It shows" : "They show"} here to review when it is done.`,
      },
      agent: { did: `Reading ${plural(reading, "file")}.`, found },
    };
  }
  if (followSent + followToSend > 0) {
    const open = followSent + followToSend;
    const when =
      facts.followUp?.delivery?.at != null
        ? ` ${formatDate(facts.followUp.delivery.at)}`
        : "";
    const handed = facts.followUp?.delivery?.mode === "HANDED_OVER";
    const by =
      handed && facts.followUp?.delivery?.by != null
        ? ` by ${facts.followUp.delivery.by}`
        : "";
    return {
      standing: "FOLLOW_UP",
      tone: followSent > 0 ? "active" : "attention",
      status: `${open} follow-up open`,
      need:
        followSent > 0
          ? {
              kind: "wait",
              title: handed ? "Follow-up handed over" : "Follow-up sent",
              // A hand-over is never "sent": email was off, so nothing was.
              detail: handed
                ? `Follow-up handed over${when}${by}. Waiting on ${owner}.`
                : `Follow-up sent${when}. Waiting on ${owner}.`,
            }
          : {
              kind: "act",
              title: `Send ${plural(open, "follow-up")}.`,
              detail: facts.drafted
                ? `A follow-up request is drafted. Nothing reaches ${owner} until you approve and send it.`
                : `A follow-up is recorded on ${open === 1 ? "its row" : "their rows"}, and nothing has gone to ${owner} for it yet. Send it from the Evidence center, or upload what you receive on its row.`,
            },
      agent: { did: "Reads each file as it arrives.", found },
    };
  }
  if (insufficient > 0) {
    return {
      standing: "INSUFFICIENT",
      tone: "blocked",
      status: `${insufficient} insufficient`,
      need: {
        kind: "act",
        title: `${plural(insufficient, "request")} marked insufficient.`,
        detail:
          "Upload new evidence on its row, ask a follow-up, or reopen the decision.",
      },
      agent: { did: "Reads each file as it arrives.", found },
    };
  }
  if (waiting > 0) {
    const handed = main?.delivery?.mode === "HANDED_OVER";
    const late =
      overdue > 0 && main !== null ? daysOverdue(main.dueAt, facts.now) : 0;
    return {
      standing: "WITH_OWNER",
      tone: overdue > 0 ? "attention" : "active",
      status:
        overdue > 0
          ? `${overdue} overdue`
          : handed
            ? `${waiting} handed over`
            : `${waiting} with the owner`,
      need: {
        kind: "wait",
        title:
          overdue > 0 ? "Overdue" : handed ? "Handed over" : "With the owner",
        detail: `${
          handed
            ? `Handed over to ${owner}${at !== "" ? ` on ${at}` : ""}`
            : `With ${owner}${at !== "" ? ` since ${at}` : ""}`
        }${due !== "" ? `, due ${due}` : ""}${
          late > 0 ? ` (overdue by ${plural(late, "day")})` : ""
        }. Upload what you receive on its row.`,
      },
      agent: { did: "Reads each file as it arrives.", found },
    };
  }
  if (accepted === live.length) {
    const files = live.reduce((sum, row) => sum + row.files, 0);
    return {
      standing: "DONE",
      tone: "done",
      status: `${accepted} of ${live.length} accepted`,
      need: {
        kind: "done",
        title: `${accepted} of ${live.length} accepted`,
        detail: "",
      },
      agent: {
        did: `Read ${plural(files, "file")}; ${files === 1 ? "" : "all "}accepted by a person.`,
        found,
      },
    };
  }
  // Rows in hand only: evidence uploaded before anything was sent, none of it read yet.
  return {
    standing: "WITH_OWNER",
    tone: "active",
    status: `${live.length - accepted} in hand`,
    need: {
      kind: "wait",
      title: "In hand",
      detail:
        "The evidence for these requests is in hand. It shows here to review once it is read.",
    },
    agent: { did: "Reads each file as it arrives.", found },
  };
}

/** Where the step stands when the list was not read: nothing of its own to say. */
export type EvidenceWorkflowHeader = Pick<
  EvidenceHeader,
  "tone" | "status" | "need" | "agent"
>;

/** How a request reached its owner, in words: "Handed over Nov 12, 2026 by Dana",
 * "Sent Nov 12, 2026". Null when it did not, or the server did not say. */
export function deliveryLabel(
  delivery: Delivery | null | undefined,
): string | null {
  if (delivery == null) {
    return null;
  }
  const when = delivery.at !== null ? ` ${formatDate(delivery.at)}` : "";
  return delivery.mode === "HANDED_OVER"
    ? `Handed over${when}${delivery.by !== null ? ` by ${delivery.by}` : ""}`
    : `Sent${when}`;
}

/** The message the review pane hands the list when the requests changed under it (evidence
 * in hand): the pane closes and the list shows the server's sentence. */
export const REQUESTS_CHANGED_EVENT = "design-evidence:requests-changed";

// A file on a row

/** A file's one line under its name: when it came, its size, who uploaded it, and how it
 * serves the row when not through its request. Each part only where it is known. */
export function fileMeta(
  held:
    | { createdAt?: string; sizeBytes?: number; addedBy?: string }
    | undefined,
  file: { via: string; linkedBy: string | null; sharedFrom: string | null },
): string {
  return [
    held?.createdAt ? formatDate(held.createdAt) : "",
    held?.sizeBytes != null ? formatBytes(held.sizeBytes) : "",
    file.via === "LINK"
      ? `linked by ${file.linkedBy ?? "a person"}`
      : file.via === "SHARED"
        ? `shared from ${file.sharedFrom ?? "another system"}`
        : held?.addedBy
          ? `uploaded by ${held.addedBy}`
          : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The control's evidence and approval activity, newest first: the Activity fold. */
export function evidenceActivity<T extends { at: string; category: string }>(
  activity: readonly T[] | null,
  limit = 20,
): T[] {
  return (activity ?? [])
    .filter(
      (item) => item.category === "evidence" || item.category === "approval",
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

// The row's menu

export type MenuKey =
  | "edit"
  | "attributes"
  | "upload"
  | "policy"
  | "held"
  | "follow-up"
  | "insufficient"
  | "waive"
  | "restore"
  | "reopen"
  | "delete";

export type MenuEntry = {
  key: MenuKey;
  label: string;
  /** Why it is not available now; the item shows it and stays off. */
  unavailable: string | null;
  danger?: boolean;
};

export const NOTHING_RECEIVED =
  "Nothing has been received for it yet. Available once a file arrives.";

/** Why a row's wording is no longer edited and it is not deleted: it left the draft. The
 * date and the way it went are said only on the server's word. */
export function sentReason(delivery: Delivery | null, state: string): string {
  const next = "Ask a follow-up instead.";
  if (delivery !== null) {
    const when = delivery.at !== null ? ` ${formatDate(delivery.at)}` : "";
    return `Already ${delivery.mode === "HANDED_OVER" ? "handed over" : "sent"}${when}. ${next}`;
  }
  return state === "SENT" || state === "OVERDUE"
    ? `Already sent. ${next}`
    : `It is no longer a draft. ${next}`;
}

/**
 * A row's menu, in the list's order: Edit · Change attributes · Upload a file · Use a
 * policy on file · Use a file the control holds · Ask a follow-up · Mark insufficient ·
 * Mark not applicable · Reopen decision · Delete. Every item is always listed; one that
 * cannot be used now says why. After sending, Edit and Delete are off.
 */
export function rowMenu(
  row: EvidenceRow,
  facts: {
    /** Policies on file that apply to the control. */
    policies: number;
    /** Files the control holds that do not serve the row yet. */
    held: number;
    /** The control's approved attributes. */
    attributes: number;
  },
): MenuEntry[] {
  const gone = row.aside
    ? row.uploadBlocked
    : row.sent
      ? sentReason(row.delivery, row.planState)
      : null;
  const proposed =
    row.change !== null ? "Decide the proposed change first." : null;
  const waived = row.state === "NOT_APPLICABLE";
  return [
    { key: "edit", label: "Edit", unavailable: gone ?? proposed },
    {
      key: "attributes",
      label: "Change attributes",
      unavailable:
        proposed ??
        (row.procedureIds === null
          ? "The test plan could not be read. Refresh the page."
          : facts.attributes === 0
            ? "The control has no approved attributes."
            : null),
    },
    { key: "upload", label: "Upload a file", unavailable: row.uploadBlocked },
    {
      key: "policy",
      label: "Use a policy on file",
      unavailable:
        row.uploadBlocked ??
        (facts.policies === 0
          ? "No policy or procedure on file applies to this control."
          : null),
    },
    {
      key: "held",
      label: "Use a file the control holds",
      unavailable:
        waived || row.state === "CANCELLED"
          ? row.uploadBlocked
          : facts.held === 0
            ? "The control holds no other file yet."
            : null,
    },
    {
      key: "follow-up",
      label: "Ask a follow-up",
      unavailable: row.judgeable ? null : NOTHING_RECEIVED,
    },
    {
      key: "insufficient",
      label: "Mark insufficient",
      unavailable: row.judgeable ? null : NOTHING_RECEIVED,
    },
    waived
      ? { key: "restore", label: "Restore", unavailable: null }
      : {
          key: "waive",
          label: "Mark not applicable",
          unavailable:
            row.state === "CANCELLED" ? "Its request was cancelled." : proposed,
        },
    {
      key: "reopen",
      label: "Reopen decision",
      unavailable: row.decided ? null : "No decision is recorded on it yet.",
    },
    { key: "delete", label: "Delete", danger: true, unavailable: gone },
  ];
}
