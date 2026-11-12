/**
 * The D&I requests list (product owner, 12 November 2026: "Why do I need to have the
 * release button? Simplify the workflow. After the attributes approval, list down the
 * evidences so that I can add, modify or update, or delete. Similar to how I do in the
 * attributes."). Once the attributes are settled the D&I Evidence step shows one list: the
 * plan's live DESIGN requirements. The agent proposes, a person accepts ("Agent proposes,
 * the human approves"), and each request shows the approved attributes it addresses ("to
 * make sure I get coverage"). When every request is accepted and every approved attribute
 * is addressed, or has a recorded reason, the server releases the phase and drafts the
 * requests: there is no release card, no Release button and no early release ("I don't
 * want a separate D&I release."). A list that settles while the planner is still at work
 * is released by the server when the planner finishes; the page only waits.
 *
 * Pure. The server decides what is accepted, what is covered and when the list is settled
 * (evidence_plans and phase_release); this module reads what it sent, words it, and checks
 * a person's action before it is sent. Nothing an agent wrote reads as accepted, and a
 * field the server did not send falls back to the cautious reading.
 */

import { attributeLetter } from "./control-context-model.ts";
import { itemKind } from "./design-release-model.ts";
import type { PlanRequirement } from "./evidence-plan-model.ts";
import type { IconName } from "./icon-name.ts";

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const named = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;
const idList = (value: unknown): string[] => [
  ...new Set(
    (Array.isArray(value) ? value : []).filter(
      (item): item is string => typeof item === "string" && item !== "",
    ),
  ),
];

// What the server sends

/** What a requirement carries for the list, beside the plan's own fields. */
export type RequestAcceptance = {
  /** The attributes it addresses (its links in evidence_requirement_attributes). */
  attributeIds: string[];
  /** A person owns it: they accepted the agent's proposal, or added or edited it. */
  accepted: boolean;
  /** Who accepted it, by display name, and when. */
  acceptedBy: string | null;
  acceptedAt: string | null;
  /** The server's word that it waits for a person (live, DESIGN, and not accepted or
   * carrying a pending change); null when the server did not say. */
  toAccept: boolean | null;
  /** A person changed the agent's wording. */
  personEdited: boolean;
  /** The plan's procedures it serves, which a change to its attributes keeps; null when
   * the plan body did not say (the test plan's own record is read then). */
  procedureIds: string[] | null;
};

/** A requirement's acceptance, from the plan body. Anything missing or of the wrong type
 * reads as not accepted: an item is never shown as accepted on the page's own guess. */
export function parseRequestAcceptance(item: Raw): RequestAcceptance {
  return {
    attributeIds: idList(item.attribute_ids),
    accepted: item.accepted === true,
    acceptedBy: named(item.accepted_by),
    acceptedAt: named(item.accepted_at),
    toAccept: typeof item.to_accept === "boolean" ? item.to_accept : null,
    personEdited: item.person_edited === true,
    procedureIds: Array.isArray(item.procedure_ids)
      ? idList(item.procedure_ids)
      : null,
  };
}

/** An approved attribute a person decided is not evidenced at D&I, with why. */
export type CoverageException = {
  attributeId: string;
  reason: string;
  recordedBy: string;
  recordedAt: string | null;
};

/** The plan's summary of its D&I requests (`design_requests`). */
export type DesignRequestsState = {
  /** Every request is accepted and every approved attribute addressed or excepted. */
  settled: boolean;
  /** The D&I phase is released: the requests are drafted, or being drafted. */
  released: boolean;
  toAccept: number;
  /** Approved attributes with no live D&I request and no recorded reason. */
  uncovered: string[];
  exceptions: CoverageException[];
  /** What the list still waits for, in the server's sentence. */
  waitingFor: string;
  /** The planner's run is pending or working; null when the server did not say. */
  working: boolean | null;
  /** The phase is released and its requests are being drafted; null when not said. */
  drafting: boolean | null;
};

/** The plan's `design_requests`, or null when the server did not send it. */
export function parseDesignRequests(
  value: unknown,
): DesignRequestsState | null {
  if (!isRecord(value)) {
    return null;
  }
  const count = value.to_accept;
  return {
    settled: value.settled === true,
    released: value.released === true,
    toAccept:
      typeof count === "number" && Number.isInteger(count) && count > 0
        ? count
        : 0,
    uncovered: idList(value.uncovered),
    exceptions: (Array.isArray(value.exceptions) ? value.exceptions : [])
      .filter(isRecord)
      .filter(
        (item) =>
          typeof item.attribute_id === "string" && item.attribute_id !== "",
      )
      .map((item) => ({
        attributeId: str(item.attribute_id),
        reason: str(item.reason),
        recordedBy: str(item.recorded_by),
        recordedAt: named(item.recorded_at),
      })),
    waitingFor: str(value.waiting_for),
    working: typeof value.working === "boolean" ? value.working : null,
    drafting: typeof value.drafting === "boolean" ? value.drafting : null,
  };
}

/** What the D&I phase waits on (phase_release.PhaseStatus.waiting_on): the understanding,
 * the attributes, REQUESTS to accept, or EVIDENCE when an approved attribute is addressed
 * by no request and has no recorded reason. */
export const DESIGN_WAITS = [
  "UNDERSTANDING",
  "ATTRIBUTES",
  "REQUESTS",
  "EVIDENCE",
] as const;
export type DesignWait = "" | (typeof DESIGN_WAITS)[number];

export function waitingOnOf(value: unknown): DesignWait {
  return DESIGN_WAITS.find((item) => item === value) ?? "";
}

// The list

export type RequestState = "UPDATING" | "TO_ACCEPT" | "ACCEPTED";

/** The chip each state shows, as the attributes list words its own. */
export const REQUEST_CHIPS: Record<
  RequestState,
  { label: string; tone: "ai" | "success" }
> = {
  UPDATING: { label: "Updating…", tone: "ai" },
  TO_ACCEPT: { label: "To accept", tone: "ai" },
  ACCEPTED: { label: "Accepted", tone: "success" },
};

/** Who wrote the request as it reads now. The plan records that a person added or edited
 * it, not which person is looking, so the line names the team. */
export type RequestOrigin = "AGENT" | "ADDED" | "EDITED";

export const REQUEST_ORIGINS: Record<RequestOrigin, string> = {
  AGENT: "Proposed by the agent",
  ADDED: "Added by the team",
  EDITED: "Edited by the team",
};

/** What the planner proposes on a row, for a person to decide: a change to a request a
 * person already accepted (it never overwrites one, so the change waits until a person
 * accepts it or keeps theirs), its removal, or the request itself as a new one (add),
 * which is no part of the plan until a person accepts it. */
export type RequestChange = {
  add: boolean;
  remove: boolean;
  /** The proposed title and description, or "" where they would not change. */
  title: string;
  description: string;
  summary: string;
  /** What the row says of it while closed, in place of who wrote the request. */
  line: string;
};

export type RequestRow = {
  id: string;
  version: number;
  title: string;
  description: string;
  /** What the evidence shows (the plan's objective for it). */
  shows: string;
  kind: string;
  icon: IconName;
  /** The kind, and Optional when it is. */
  line: string;
  origin: RequestOrigin;
  originLine: string;
  /** The approved attributes it addresses, in the attributes' order: letters and ids. */
  letters: string[];
  attributeIds: string[];
  /** What a screen reader hears for the chips: "addresses attributes A and C". */
  addresses: string;
  state: RequestState;
  change: RequestChange | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  /** The plan's procedures it serves, which a change to its attributes keeps; null when
   * the test plan could not be read, so its links cannot be changed from here. */
  procedureIds: string[] | null;
};

export type AcceptItem = { requirement_id: string; version: number };

export type CoverageState = "COVERED" | "EXCEPTION" | "UNCOVERED";

export type CoverageChip = {
  attributeId: string;
  letter: string;
  text: string;
  state: CoverageState;
  /** How many requests address it. */
  requests: number;
  /** The chip in words: the mark and the colour never replace them. */
  label: string;
};

/** An approved attribute no request addresses: the one exception the list raises. */
export type UncoveredLine = {
  attributeId: string;
  letter: string;
  text: string;
  line: string;
  /** A request the agent proposes, not accepted yet, would address it: accepting that
   * request comes first, so no reason is recorded for the attribute meanwhile. */
  proposed: boolean;
};

export type ExceptionLine = CoverageException & {
  letter: string;
  text: string;
};

export type HistoryRow = {
  id: string;
  version: number;
  title: string;
  kind: string;
};

export type RequestAttribute = {
  id: string;
  letter: string;
  text: string;
  source: string;
};

/** Where the list stands, as the step's header pill says it. */
export type RequestsHeader = {
  tone: "attention" | "active" | "idle";
  status: string;
  /** The step's one line where the list's records word it and its standing alone cannot:
   * what the server says an accepted list still waits for, or that drafting starts when
   * the planner finishes. "" where the standing's own words say it. */
  line: string;
};

export type RequestsList = {
  /** "3 requests", over the list. */
  title: string;
  rows: RequestRow[];
  /** What Accept all sends: every row that waits, at the version shown. */
  accept: AcceptItem[];
  coverage: CoverageChip[];
  coverageLine: string;
  uncovered: UncoveredLine[];
  exceptions: ExceptionLine[];
  history: HistoryRow[];
  attributes: RequestAttribute[];
  /** Where the attributes came from, in a few words ("the control library"). */
  sources: string;
  header: RequestsHeader;
  /** The planner is at work, or the requests are being drafted: every action is off. */
  working: boolean;
  /** Every request is accepted and every attribute addressed, and the requests are not
   * drafted yet: nothing is asked of the person. The server releases the phase itself,
   * when the planner finishes if it is still at work; the page waits and reads again. */
  settled: boolean;
  /** What an empty list says. */
  empty: string;
};

export type RequestsView =
  | { mode: "hidden" }
  | { mode: "waiting"; on: "UNDERSTANDING" | "ATTRIBUTES"; line: string }
  | ({ mode: "list" | "drafting" } & RequestsList);

type Requirement = Pick<
  PlanRequirement,
  | "id"
  | "phase"
  | "title"
  | "description"
  | "objective"
  | "categories"
  | "necessity"
  | "state"
  | "origin"
  | "pendingChange"
  | "version"
  | "requestId"
> &
  RequestAcceptance;

type Approved = { id: string; text: string; sourceKind: string };

export type RequestsInput = {
  /** The D&I phase for this control (phase_release), or null when it was not read. */
  status: {
    step: string;
    waitingOn: DesignWait;
    waitingFor: string;
    releasedAt: string | null;
  } | null;
  /** The approved attributes, in their order: the letters follow it. */
  approved: readonly Approved[];
  /** The plan's requirements; only the DESIGN ones are read. */
  requirements: readonly Requirement[];
  /** The plan's `design_requests`, or null when it was not sent. */
  summary: DesignRequestsState | null;
  /** The planner is at work on the control's plan, as the test plan's own state reads:
   * used only where the plan's summary does not say (`design_requests.working`). */
  working: boolean;
  /** The plan's procedures each requirement serves, by its id, from the test plan; null
   * when it was not read. Used only for a requirement that does not carry its own
   * (`procedure_ids`). */
  procedures: Readonly<Record<string, readonly string[]>> | null;
  /** The time now, in milliseconds: how long ago the release was, where the plan's
   * summary does not say whether the requests are being drafted. */
  now: number;
};

const GONE = ["CANCELLED", "REMOVED", "NOT_APPLICABLE"];
const NOT_DRAFTED = ["NOT_GENERATED", "AWAITING_DEPENDENCY"];

/** Where the server does not say whether the requests are being drafted: how long
 * after the release the step says so. Past it the evidence workspace shows what is there,
 * so a draft that never comes is not waited on. */
export const DRAFTING_WINDOW_MS = 2 * 60 * 1000;

/** How far ahead of this clock a release's time may read and still be the release just
 * made: the server's clock and the page's are not the same clock. */
export const CLOCK_SKEW_MS = 30 * 1000;

export const WORKING_LINES = {
  planning: "The planner is preparing the requests against the attributes",
  drafting: "Drafting the requests",
  settled: "Drafting starts when the planner finishes",
} as const;

/** What an accepted list says while nothing is at work on it and the server gives no
 * sentence of its own: the server drafts it; nothing is asked of the person. */
export const SETTLED_LINE =
  "The requests are accepted and every attribute is addressed. They are drafted next, and each is approved before it goes to the client.";

/** Why a request the agent proposes cannot be edited, re-linked or excepted yet: the
 * server refuses each with this sentence until a person accepts the request. */
export const ACCEPT_FIRST = "Accept the request first.";

/** How often the list is read again while the planner works or the requests are drafted,
 * and for how long: past it the page stops asking on its own and says so, with a way to
 * check again. Nothing is re-enabled on a guess. */
export const POLL_EVERY_MS = 3000;
export const POLL_LIMIT_MS = 10 * 60 * 1000;

/** Whether the list has been read again for as long as it is, with the work still on. */
export function pollingOver(elapsedMs: number): boolean {
  return elapsedMs >= POLL_LIMIT_MS;
}

export const STALLED_LINE =
  "This is taking longer than expected, so the list has stopped checking by itself.";

/** The header's words. One source: the step's node, its pill and its decision row read
 * the same state (requestsStanding). */
export const REQUESTS_STATUS = {
  planning: "Being planned",
  updating: "Being updated",
  empty: "No requests yet",
  accepted: "Requests accepted",
  toAccept: "Requests to accept",
  uncovered: "Attributes not addressed",
} as const;

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

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function originOf(item: Pick<Requirement, "origin" | "personEdited">) {
  return item.origin === "PERSON"
    ? "ADDED"
    : item.personEdited
      ? "EDITED"
      : "AGENT";
}

function changeOf(item: Requirement): RequestChange | null {
  const change = item.pendingChange;
  if (change === null) {
    return null;
  }
  if (change.add) {
    return {
      add: true,
      remove: false,
      title: "",
      description: "",
      summary: "The agent proposes this request.",
      line: "Agent proposes this request",
    };
  }
  if (change.remove) {
    return {
      add: false,
      remove: true,
      title: "",
      description: "",
      summary: "The agent proposes removing this request.",
      line: "Agent proposes removing it",
    };
  }
  const title =
    change.title.trim() !== "" && change.title !== item.title
      ? change.title
      : "";
  const description =
    change.description.trim() !== "" && change.description !== item.description
      ? change.description
      : "";
  return {
    add: false,
    remove: false,
    title,
    description,
    summary:
      title !== "" || description !== ""
        ? "The agent proposes new wording for this request."
        : "The agent proposes a change to what this request must show.",
    line: "Agent proposes a change",
  };
}

/** Accepted only on the server's word, with no change waiting: never on a guess. */
function stateOf(item: Requirement, working: boolean): RequestState {
  if (item.accepted && item.pendingChange === null && item.toAccept !== true) {
    return "ACCEPTED";
  }
  return working ? "UPDATING" : "TO_ACCEPT";
}

/** A request the planner proposes as a new one, which no person has accepted. */
function isProposed(item: Pick<Requirement, "pendingChange">): boolean {
  return item.pendingChange?.add === true;
}

/** A D&I request the list shows: part of the plan (not removed, cancelled or waived), or
 * proposed by the planner as a new one, however the plan holds it until it is accepted. */
function isLive(
  item: Pick<Requirement, "phase" | "state" | "pendingChange">,
): boolean {
  return (
    item.phase === "DESIGN" &&
    (!GONE.includes(item.state) ||
      (item.state === "REMOVED" && isProposed(item)))
  );
}

/** Whether the release is recent and none of its requests is drafted yet: the page's
 * own reading, where the server does not say (`design_requests.drafting`). */
function isDrafting(
  live: readonly Requirement[],
  releasedAt: string | null,
  now: number,
): boolean {
  const at = releasedAt === null ? Number.NaN : Date.parse(releasedAt);
  return (
    live.length > 0 &&
    live.every(
      (item) => item.requestId === null && NOT_DRAFTED.includes(item.state),
    ) &&
    !Number.isNaN(at) &&
    now - at > -CLOCK_SKEW_MS &&
    now - at < DRAFTING_WINDOW_MS
  );
}

/** What the D&I Evidence step shows before its requests are drafted: nothing of its own
 * (hidden: the evidence workspace takes over), one line while an earlier step holds it,
 * the list, or the list at rest while the requests are drafted. */
export function requestsView(input: RequestsInput): RequestsView {
  const { status } = input;
  if (status === null) {
    return { mode: "hidden" };
  }
  const design = input.requirements.filter((item) => item.phase === "DESIGN");
  const live = design.filter(isLive);
  // The server says whether the planner is at work and whether the requests are being
  // drafted; where it does not, the test plan's state and the release's time are read.
  const planning = input.summary?.working ?? input.working;
  const drafting =
    input.summary?.drafting ??
    (status.step === "RELEASED" &&
      isDrafting(live, status.releasedAt, input.now));
  if (!drafting && status.step !== "READY" && status.step !== "WAITING") {
    return { mode: "hidden" };
  }
  if (!drafting && status.waitingOn === "UNDERSTANDING") {
    return {
      mode: "waiting",
      on: "UNDERSTANDING",
      line: "The requests are planned from the understanding. They are listed here once Control Understanding is complete.",
    };
  }
  if (!drafting && status.waitingOn === "ATTRIBUTES") {
    return {
      mode: "waiting",
      on: "ATTRIBUTES",
      line: "Each request addresses the control's attributes. They are listed here once the attributes are settled.",
    };
  }
  const working = drafting || planning;
  const attributes: RequestAttribute[] = input.approved.map((item, at) => ({
    id: item.id,
    letter: attributeLetter(at),
    text: item.text,
    source: SOURCE_SHORT[item.sourceKind] ?? "Team",
  }));
  const rows: RequestRow[] = live.map((item) => {
    const addressed = attributes.filter((each) =>
      item.attributeIds.includes(each.id),
    );
    const letters = addressed.map((each) => each.letter);
    const { kind, icon } = itemKind(item.categories);
    const origin = originOf(item);
    return {
      id: item.id,
      version: item.version,
      title: item.title,
      description: item.description,
      shows: item.objective,
      kind,
      icon,
      line: item.necessity === "OPTIONAL" ? `${kind} · Optional` : kind,
      origin,
      originLine: REQUEST_ORIGINS[origin],
      letters,
      attributeIds: addressed.map((each) => each.id),
      addresses:
        letters.length === 0
          ? "addresses no attribute"
          : `addresses attribute${letters.length === 1 ? "" : "s"} ${listed(letters)}`,
      // While the requests are drafted nothing is being rewritten: each reads as it stands.
      state: stateOf(item, planning && !drafting),
      change: changeOf(item),
      acceptedBy: item.acceptedBy,
      acceptedAt: item.acceptedAt,
      procedureIds:
        item.procedureIds ??
        (input.procedures === null
          ? null
          : [...(input.procedures[item.id] ?? [])]),
    };
  });
  const accept: AcceptItem[] = rows
    .filter((row) => row.state === "TO_ACCEPT")
    .map((row) => ({ requirement_id: row.id, version: row.version }));
  // Coverage. The server's list of uncovered attributes decides; an attribute the page
  // sees no request for and no reason on is never shown as addressed either.
  const reasons = new Map(
    (input.summary?.exceptions ?? []).map((item) => [item.attributeId, item]),
  );
  const flagged = new Set(input.summary?.uncovered ?? []);
  const coverage: CoverageChip[] = attributes.map((item) => {
    // A request the agent proposes addresses nothing until a person accepts it.
    const requests = rows.filter(
      (row) => row.change?.add !== true && row.attributeIds.includes(item.id),
    ).length;
    const state: CoverageState =
      flagged.has(item.id) || (requests === 0 && !reasons.has(item.id))
        ? "UNCOVERED"
        : requests > 0
          ? "COVERED"
          : "EXCEPTION";
    return {
      attributeId: item.id,
      letter: item.letter,
      text: item.text,
      state,
      requests,
      label:
        state === "COVERED"
          ? `Attribute ${item.letter}: addressed by ${plural(requests, "request")}`
          : state === "EXCEPTION"
            ? `Attribute ${item.letter}: not evidenced at D&I, with a recorded reason`
            : `Attribute ${item.letter}: not addressed by any request`,
    };
  });
  // With no request at all, the list's one exception is that it is empty: the chips
  // still show each attribute as not addressed, without a line for every one of them.
  const uncovered: UncoveredLine[] = (rows.length === 0 ? [] : coverage)
    .filter((item) => item.state === "UNCOVERED")
    .map((item) => ({
      attributeId: item.attributeId,
      letter: item.letter,
      text: item.text,
      line: `Attribute ${item.letter} is not addressed by any request`,
      proposed: rows.some(
        (row) =>
          row.change?.add === true &&
          row.attributeIds.includes(item.attributeId),
      ),
    }));
  const exceptions: ExceptionLine[] = attributes.flatMap((item) => {
    const reason = reasons.get(item.id);
    return reason === undefined
      ? []
      : [{ ...reason, letter: item.letter, text: item.text }];
  });
  const covered = coverage.filter((item) => item.state === "COVERED").length;
  const excepted = coverage.filter((item) => item.state === "EXCEPTION").length;
  const coverageLine =
    attributes.length === 0
      ? "No approved attributes"
      : `${covered} of ${plural(attributes.length, "attribute")} addressed${excepted > 0 ? `, ${excepted} with a recorded reason` : ""}`;
  // Settled as the page reads it: every request accepted by a person, every approved
  // attribute addressed or excepted. Nothing is asked of the person then, whether or not
  // the planner is still at work: the server releases the phase itself.
  const settled =
    !drafting &&
    rows.length > 0 &&
    rows.every((row) => row.state === "ACCEPTED") &&
    uncovered.length === 0;
  // What the server says the list waits for, in its own sentence.
  const sentence = input.summary?.waitingFor || status.waitingFor;
  // Every row that waits is one a person already accepted, with no change proposed: the
  // server asks for the acceptance again (the person whose acceptance stood no longer
  // may accept), and says so in its sentence.
  const again =
    accept.length > 0 &&
    accept.every((each) =>
      live.some(
        (item) =>
          item.id === each.requirement_id &&
          item.accepted &&
          item.pendingChange === null,
      ),
    );
  const header: RequestsHeader = drafting
    ? { tone: "active", status: REQUESTS_STATUS.accepted, line: "" }
    : settled
      ? planning
        ? {
            // The server releases it when the planner finishes: said only while the
            // planner is at work.
            tone: "active",
            status: REQUESTS_STATUS.accepted,
            line: `${WORKING_LINES.settled}. Each request is approved before it goes to the client.`,
          }
        : // At rest: the server is about to release it, or says what it waits for.
          { tone: "idle", status: REQUESTS_STATUS.accepted, line: sentence }
      : planning
        ? {
            tone: "active",
            status:
              rows.length === 0
                ? REQUESTS_STATUS.planning
                : REQUESTS_STATUS.updating,
            line: "",
          }
        : rows.length === 0
          ? { tone: "attention", status: REQUESTS_STATUS.empty, line: "" }
          : accept.length > 0
            ? {
                tone: "attention",
                status: `${accept.length} to accept`,
                line: again ? sentence : "",
              }
            : {
                tone: "attention",
                status:
                  uncovered.length === 1
                    ? `Attribute ${uncovered[0]?.letter ?? ""} is not addressed`
                    : `${uncovered.length} attributes not addressed`,
                line: "",
              };
  return {
    mode: drafting ? "drafting" : "list",
    title:
      rows.length === 0 ? "No requests yet" : plural(rows.length, "request"),
    rows,
    accept,
    coverage,
    coverageLine,
    uncovered,
    exceptions,
    history: design
      .filter((item) => item.state === "REMOVED" && !isProposed(item))
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
    header,
    working,
    settled,
    empty: planning
      ? "The planner is preparing the requests."
      : "No D&I request is planned yet. Add one, then choose the attributes it addresses.",
  };
}

/** The row that starts open: the first that waits on a person. */
export function firstToAccept(rows: readonly RequestRow[]): string | null {
  return rows.find((row) => row.state === "TO_ACCEPT")?.id ?? null;
}

/** A request's attributes with one more: what "Add to a request" saves. */
export function withAttribute(
  row: Pick<RequestRow, "attributeIds">,
  attributeId: string,
): string[] {
  return [...new Set([...row.attributeIds, attributeId])];
}

// The step's node, pill and decision row

/** Where the list stands, read back from the header's own words: the workflow passes a
 * step's status and tone only, so the panel's decision row is worded from them. */
export type RequestsStanding =
  | "PLANNING"
  | "DRAFTING"
  | "EMPTY"
  | "TO_ACCEPT"
  | "UNCOVERED"
  | "SETTLED";

export function requestsStanding(
  status: string,
  tone: string,
): RequestsStanding | null {
  if (
    status === REQUESTS_STATUS.planning ||
    status === REQUESTS_STATUS.updating
  ) {
    return "PLANNING";
  }
  if (status === REQUESTS_STATUS.accepted) {
    // Agents at work on an accepted list (its requests being drafted, or the planner
    // finishing before they are) read as work in progress; accepted, with nothing at
    // work, reads at rest.
    return tone === "active" ? "DRAFTING" : "SETTLED";
  }
  if (status === REQUESTS_STATUS.empty) {
    return "EMPTY";
  }
  if (status === REQUESTS_STATUS.toAccept || /^\d+ to accept$/.test(status)) {
    return "TO_ACCEPT";
  }
  if (
    status === REQUESTS_STATUS.uncovered ||
    /^Attribute [A-Z]{1,2} is not addressed$/.test(status) ||
    /^\d+ attributes not addressed$/.test(status)
  ) {
    return "UNCOVERED";
  }
  return null;
}

/** The list's header where the plan was not read: the phase's own state decides, in the
 * same words. Null when the phase does not wait on the list. */
export function requestsFallback(
  step: string,
  waitingOn: DesignWait | undefined,
): RequestsHeader | null {
  if (step === "READY") {
    return { tone: "idle", status: REQUESTS_STATUS.accepted, line: "" };
  }
  if (step !== "WAITING") {
    return null;
  }
  return {
    tone: "attention",
    status:
      waitingOn === "EVIDENCE"
        ? REQUESTS_STATUS.uncovered
        : REQUESTS_STATUS.toAccept,
    line: "",
  };
}

/** What the D&I Evidence panel asks of the person, or says in one quiet line, for the
 * list's state; null for a status that is not the list's. No action of its own: the list
 * below holds the one primary action (Accept all), so the step never shows two. And
 * never a release: a settled list is the server's to release (product owner, 12 November
 * 2026: "I don't want a separate D&I release."), so the panel only says it is waiting.
 * `line` is the list's own sentence for the state (RequestsHeader.line), where it has
 * one: what the server says an accepted list waits for, never a guess that the planner
 * is at work. */
export function requestsNeed(
  status: string,
  tone: string,
  line = "",
): {
  kind: "act" | "agent" | "wait";
  title: string;
  detail: string;
} | null {
  switch (requestsStanding(status, tone)) {
    case "PLANNING":
      return {
        kind: "agent",
        title: status,
        detail: `${WORKING_LINES.planning}. They show here to accept when it is done.`,
      };
    case "DRAFTING":
      return {
        kind: "agent",
        title: status,
        detail:
          line ||
          `${WORKING_LINES.drafting}. Each one is approved before it goes to the client.`,
      };
    case "EMPTY":
      return {
        kind: "act",
        title: "Add the D&I requests",
        detail:
          "No D&I request is planned yet. Add what to request, and choose the attributes each request addresses.",
      };
    case "TO_ACCEPT":
      return {
        kind: "act",
        title: "Accept the D&I requests",
        detail:
          line ||
          "The agent proposes what to request and the attributes each request addresses. Accept each one, or change it. Once all are accepted and every attribute is addressed, the requests are drafted; each is still approved before it is sent.",
      };
    case "UNCOVERED":
      return {
        kind: "act",
        title: status,
        detail:
          "Add it to a request, or record why it is not evidenced at D&I. The requests are drafted once every approved attribute is addressed.",
      };
    case "SETTLED":
      // Nothing is at work and nothing is asked: the server's sentence, or that the
      // requests are drafted next. Never that the planner is finishing: that is said
      // only while the server says the planner is at work (the standing is DRAFTING then).
      return { kind: "wait", title: status, detail: line || SETTLED_LINE };
    default:
      return null;
  }
}

// Forms

/** The kinds of D&I evidence a person may add, the walkthrough instance first. */
export const ADD_KINDS: ReadonlyArray<{ category: string; label: string }> = [
  { category: "CONTROL_EXECUTION", label: "Walkthrough instance" },
  { category: "PROCESS_DOCUMENTATION", label: "Policy or procedure" },
  { category: "CONFIGURATION", label: "Configuration" },
  { category: "REPORT_RELIABILITY", label: "Report" },
  { category: "OTHER", label: "Supporting evidence" },
];

/** The lengths the plan's routes take (planning-model's evidence-add and evidence-edit):
 * an edit's description may run longer than a new request's. */
export const REQUEST_LIMITS = {
  title: { min: 3, max: 200 },
  description: { min: 10, max: 1500, editMax: 3000 },
  shows: { min: 10, max: 500 },
} as const;

/** Whether a new request or an edit can be sent: each text within its lengths. A new
 * request also says what it shows; an edit changes the title and the description only. */
export function requestReady(
  fields: { title: string; description: string; shows?: string },
  mode: "add" | "edit",
): boolean {
  const within = (text: string, min: number, max: number) =>
    text.trim().length >= min && text.trim().length <= max;
  return (
    within(fields.title, REQUEST_LIMITS.title.min, REQUEST_LIMITS.title.max) &&
    within(
      fields.description,
      REQUEST_LIMITS.description.min,
      mode === "add"
        ? REQUEST_LIMITS.description.max
        : REQUEST_LIMITS.description.editMax,
    ) &&
    (mode === "edit" ||
      within(
        fields.shows ?? "",
        REQUEST_LIMITS.shows.min,
        REQUEST_LIMITS.shows.max,
      ))
  );
}

/** The reason an attribute is not evidenced at D&I: long enough to stand on its own. */
export const EXCEPTION_REASON_MIN = 20;
export const EXCEPTION_REASON_MAX = 500;

export function reasonCheck(reason: string): {
  left: number;
  hint: string;
  enabled: boolean;
} {
  const length = reason.trim().length;
  const left = Math.max(0, EXCEPTION_REASON_MIN - length);
  return {
    left,
    hint:
      left > 0
        ? `Recorded with your name. At least ${left} more character${left === 1 ? "" : "s"}.`
        : "Recorded with your name.",
    enabled: left === 0 && length <= EXCEPTION_REASON_MAX,
  };
}

// Actions

export type RequestsIntent =
  | "requests-accept"
  | "exception-record"
  | "exception-clear";

export type RequestsWrite =
  | { error: "invalid" }
  | {
      intent: RequestsIntent;
      method: "POST" | "PUT" | "DELETE";
      path: string;
      /** Null for a call that sends none (clearing a reason). */
      body: Record<string, unknown> | null;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET =
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S|sk-[A-Za-z0-9]{10,}/i;
type Fields = Record<string, unknown>;
const text = (fields: Fields, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string).trim() : "";

/** The most requests one acceptance covers. */
export const ACCEPT_MAX = 100;

/** The API call for one action on the D&I requests list, checked before it is sent. */
export function requestsWrite(fields: Fields): RequestsWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const controlId = text(fields, "control_id");
  const intent = text(fields, "intent");
  if (![organizationId, projectId, controlId].every((id) => UUID.test(id))) {
    return { error: "invalid" };
  }
  const control = `/organizations/${organizationId}/projects/${projectId}/controls/${controlId}`;
  switch (intent) {
    case "requests-accept": {
      // One decision per request, one call for the set, all or none: each at the version
      // the person saw, so a request changed meanwhile is never accepted unseen.
      const raw = Array.isArray(fields.items) ? fields.items : [];
      const items = raw.flatMap((item): AcceptItem[] => {
        if (!isRecord(item)) {
          return [];
        }
        const at = Number(item.version);
        return typeof item.requirement_id === "string" &&
          UUID.test(item.requirement_id) &&
          Number.isInteger(at) &&
          at >= 1
          ? [{ requirement_id: item.requirement_id, version: at }]
          : [];
      });
      const distinct = new Set(items.map((item) => item.requirement_id));
      return items.length > 0 &&
        items.length === raw.length &&
        items.length <= ACCEPT_MAX &&
        distinct.size === items.length
        ? {
            intent,
            method: "POST",
            path: `${control}/design-requests/accept`,
            body: { items },
          }
        : { error: "invalid" };
    }
    case "exception-record": {
      const attributeId = text(fields, "attribute_id");
      const reason = text(fields, "reason");
      return UUID.test(attributeId) &&
        reason.length >= EXCEPTION_REASON_MIN &&
        reason.length <= EXCEPTION_REASON_MAX &&
        !SECRET.test(reason)
        ? {
            intent,
            method: "PUT",
            path: `${control}/design-coverage/${attributeId}/exception`,
            body: { reason },
          }
        : { error: "invalid" };
    }
    case "exception-clear": {
      const attributeId = text(fields, "attribute_id");
      return UUID.test(attributeId)
        ? {
            intent,
            method: "DELETE",
            path: `${control}/design-coverage/${attributeId}/exception`,
            body: null,
          }
        : { error: "invalid" };
    }
    default:
      return { error: "invalid" };
  }
}

/** What a person reads when the list changed under them: nothing was saved, and the list
 * is read again so they decide on what is there now. */
export const LIST_CHANGED =
  "The list changed while you were working, so nothing was saved. It is refreshed below: check it and try again.";

/** What a person reads when no answer came back, or the server failed: whether it was
 * saved is not known, so nothing is claimed either way and the list is read again. */
export const NOT_CONFIRMED =
  "That could not be confirmed. The list is refreshed below: check it, and try again if it did not change.";

/** Whether the list is read again after an answer that was not a success: it changed
 * under the person (409), or what happened is not known (no answer, a server failure). */
export function readsAgain(status: number): boolean {
  return status === 409 || status === 0 || status >= 500;
}

/** What a person reads when an action on the list did not go through, or null when it
 * did. A refusal the server words for people is shown as it is. */
export function requestsProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    const known: Record<string, string> = {
      "it has already been requested from the client; waive it instead":
        "This request has already gone to the client, so it cannot be deleted.",
      "the request carrying it has gone for approval":
        "This request has gone for approval, so its wording is locked.",
      "link only the control's approved attributes":
        "Only the control's approved attributes can be chosen. The list is refreshed below.",
      "the control is out of scope": "The control is out of scope.",
      "the engagement is not running": "The engagement is not running.",
    };
    if (known[detail] !== undefined) {
      return known[detail];
    }
    return /^[A-Z0-9].*\.$/.test(detail) ? detail : LIST_CHANGED;
  }
  if (status === 403 || status === 404) {
    return "Your role cannot change this control's requests.";
  }
  if (status === 422) {
    if (detail === "the text must not contain credentials") {
      return "The text must not contain credentials.";
    }
    // The list's routes say what is wrong in a sentence: shown as it is.
    return /^[A-Z0-9].*\.$/.test(detail)
      ? detail
      : "Check the entry: each text needs to be long enough to stand on its own, within the length limits, and hold no credential.";
  }
  return readsAgain(status)
    ? NOT_CONFIRMED
    : "That could not be saved. Try again.";
}
