/**
 * The understanding is asked once (docs/control-workflow-plan.md, B1j; product owner, 16
 * November 2026, on ITGC-CM-06: "Keeps going back and forth to the control understanding and
 * attributes ... This could be a never ending loop"). Approved prototype: brief-proto/loop.png,
 * with "On the attribute" for a gap an agent finds later.
 *
 * - Control Understanding is one pass: once the required answers are in, the agents check what
 *   else they need, and their questions join the same course.
 * - It is complete once: from then on the Attributes step never sends the person back.
 * - A later gap is the agent's assumption on the attribute it bears on, confirmed or changed
 *   there; an attribute keeps its earlier criteria.
 *
 * Pure: the words and the decisions the screens draw, from the records the page holds.
 */

import type {
  Assumption,
  Attribute,
  CriteriaVersion,
  QuestionPass,
  QuestionReview,
  ReviewNotRun,
  ReviewRequest,
} from "./control-context-model.ts";

/** Control Understanding while the question pass runs. */
export const CHECKING_LINE = "Checking what else the agents need…";
/** The same, as the workflow node's short status (a node holds 28 characters). */
export const CHECKING_STATUS = "Checking what else is needed";
/** A question the pass added, in the same course. */
export const ADDED_FOR_ATTRIBUTES = "Added by the agents · for the attributes";
/** A question the IT audit specialist's review asked (B1k), in the same course. */
export const FROM_REVIEW = "From the review · for the attributes";
/** Under the completed understanding. */
export const ONCE_COMPLETE_NOTE =
  "Once complete, no agent reopens this step. You can still change an answer here yourself.";
/** The Attributes step before the understanding is complete (no warning, no link back). */
export const DRAFTED_ONCE_COMPLETE =
  "The attributes are drafted once the understanding is complete.";

const TIME = (timeZone: string | undefined) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
const DAY = (timeZone: string | undefined) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(timeZone === undefined ? {} : { timeZone }),
  });

/** "Nov 16, 4:12 PM"; "" where the value is not a time. */
export function whenWords(value: string, timeZone?: string): string {
  const at = value === "" ? Number.NaN : Date.parse(value);
  return Number.isNaN(at) ? "" : TIME(timeZone).format(at);
}

/** "Nov 16"; "" where the value is not a time. */
export function dayWords(value: string, timeZone?: string): string {
  const at = value === "" ? Number.NaN : Date.parse(value);
  return Number.isNaN(at) ? "" : DAY(timeZone).format(at);
}

/** The workflow node's status once the understanding is complete. */
export function completeStatus(completedAt: string, timeZone?: string): string {
  const when = whenWords(completedAt, timeZone);
  return when === "" ? "Complete" : `Complete · ${when}`;
}

/** The completed understanding's line in Control Understanding. */
export function completeLine(completedAt: string, timeZone?: string): string {
  const when = whenWords(completedAt, timeZone);
  return when === ""
    ? "Understanding complete"
    : `Understanding complete · ${when}`;
}

/** The Attributes step's footer once the understanding is complete: the one quiet way back. */
export function basedOnLine(when: string): string {
  return when === ""
    ? "the completed understanding"
    : `the understanding of ${when}`;
}

/** A question the agents added for the attributes (the question pass's): their own, on the
 * attributes or their sources. A question the rules raise is not one. */
export function addedForAttributes(issue: {
  raisedBy?: string;
  origin: string;
}): boolean {
  return (
    issue.raisedBy === "AGENT" &&
    (issue.origin === "ATTRIBUTES" || issue.origin === "SOURCES")
  );
}

/** The questions still open in Control Understanding once it is complete: only the rules'
 * (a frequency conflict, "Changed after testing"), which no agent raises after completion.
 * They show in Control Understanding with their own count and never hold the attributes. */
export function rulesOpen(
  issues: ReadonlyArray<{ status: string; raisedBy?: string }>,
): number {
  return issues.filter(
    (issue) => issue.status === "OPEN" && issue.raisedBy === "RULES",
  ).length;
}

/** The understanding's facts the steps read (B1j); absent on a body from before it. B1k adds
 * the specialist's latest review of the questions asked. */
export type Once = {
  completedAt: string | null;
  questionPass: QuestionPass | null;
  review?: QuestionReview | null;
  /** A read a person asked for after completion, while it runs or once it could not run. */
  request?: ReviewRequest | null;
  /** Why no review could run (no model). */
  notRun?: ReviewNotRun | null;
  /** The server says a read is due and none is queued (ContextBody.review_due): the page
   * follows it up. */
  reviewDue?: boolean;
  /** The approved attributes in the Attributes step's order, so the review names them by
   * letter. */
  approved?: readonly ApprovedRef[];
};

/** An approved attribute as the review's lines name it: by its letter, from its place. */
export type ApprovedRef = Pick<Attribute, "id" | "code" | "definition">;

/**
 * What Control Understanding's last screen shows.
 * - complete: recorded complete; the attributes come next ("Go to the attributes").
 * - checking: the agents are checking what else they need; the course stays open, and their
 *   questions join it. Also while the gates read understood and the completion is not yet
 *   recorded, so "Go to the attributes" is never offered before it is.
 * - failed: the specialist's review could not be used (B1l point 7): Run again, or Proceed
 *   without it; nothing waits on it.
 * - understood: a body from before B1j says nothing of the pass: as before.
 * - open: points are still open.
 */
export type EndState =
  | "complete"
  | "checking"
  | "failed"
  | "understood"
  | "open";

export function understandingEnd(once: Once, understood: boolean): EndState {
  if (once.completedAt !== null) {
    return "complete";
  }
  if (once.questionPass === "CHECKING") {
    return "checking";
  }
  if (once.questionPass === "FAILED") {
    return "failed";
  }
  if (!understood) {
    return "open";
  }
  return once.questionPass === null ? "understood" : "checking";
}

/** Whether Control Understanding offers the way on to the attributes: only once complete (a
 * body from before B1j: as before, whenever the gates read understood). */
export function offersAttributes(once: Once): boolean {
  return once.completedAt !== null || once.questionPass === null;
}

/** Whether the screens read the pass again on their own: while it runs, and while the
 * completion is still to be recorded. */
export function readsAgain(once: Once, understood: boolean): boolean {
  return understandingEnd(once, understood) === "checking";
}

// The assumption on the attribute ("On the attribute").

export const ASSUMED_LEAD = "The agent assumed:";

/** The open ones, which wait on a person. */
export function openAssumptions(
  items: readonly Assumption[] | undefined,
): Assumption[] {
  return (items ?? []).filter((item) => item.status === "OPEN");
}

/** The decided ones, each as one quiet line. */
export function decidedAssumptions(
  items: readonly Assumption[] | undefined,
): Assumption[] {
  return (items ?? []).filter((item) => item.status !== "OPEN");
}

/** An assumption accepted with its attribute is not yet anyone's answer (B1l point 6): it is
 * a D&I point, and stays decidable on the attribute, with the same two choices. */
export const ACCEPTED_UNCONFIRMED =
  "Accepted with the attribute, not confirmed:";
/** Said before a change to an assumption already accepted with its attribute: the accepted
 * criteria never silently rest on an assumption a person said is wrong. */
export const CHANGE_REOPENS =
  "The attribute's criteria were accepted with this assumption: changing it ends their acceptance, and the agents re-tailor them from your words for you to accept again.";

/** The ones a person may still decide on the attribute: open, or accepted with the
 * attribute and not confirmed (the D&I point links here, B1l point 6). */
export function decidableAssumptions(
  items: readonly Assumption[] | undefined,
): Assumption[] {
  return (items ?? []).filter(
    (item) =>
      item.status === "OPEN" || item.status === "ACCEPTED_WITH_ATTRIBUTE",
  );
}

/** The ones settled for good, each as one quiet line. */
export function settledAssumptions(
  items: readonly Assumption[] | undefined,
): Assumption[] {
  return (items ?? []).filter(
    (item) =>
      item.status !== "OPEN" && item.status !== "ACCEPTED_WITH_ATTRIBUTE",
  );
}

/**
 * A decided assumption as one quiet line. A person's decision names the person; accepting
 * the attribute while it was open is never worded as anyone's confirmation; one a later run
 * replaced says so. Null for an open one.
 */
export function decidedLine(
  item: Pick<
    Assumption,
    "status" | "assumed" | "answer" | "decidedBy" | "decidedAt"
  > & { kind?: Assumption["kind"] },
  timeZone?: string,
): string | null {
  const who = item.decidedBy?.name.trim() || "a person";
  switch (item.status) {
    case "OPEN":
      return null;
    case "CONFIRMED": {
      const day = dayWords(item.decidedAt ?? "", timeZone);
      // A conflict decided for the confirmed understanding (B1l): never worded as the
      // conflicting source being confirmed.
      if (item.kind === "CONFLICT") {
        // The decision as the person took it, naming no fact they did not choose (the
        // record names only the decision; the product owner, after the review of B1k).
        return `Decided by ${who}${day === "" ? "" : `, ${day}`}: the confirmed understanding stands.`;
      }
      return `Confirmed by ${who}${day === "" ? "" : `, ${day}`}: ${item.assumed}`;
    }
    case "CHANGED":
      return `Changed by ${who}: ${item.answer}`;
    case "ACCEPTED_WITH_ATTRIBUTE":
      return `Accepted with the attribute: ${item.assumed}`;
    case "SUPERSEDED":
      return `Replaced by a later run: ${item.assumed}`;
  }
}

/** The box's count under a changed assumption. */
export function characterCount(value: string, most: number): string {
  return `${value.trim().length.toLocaleString("en-US")} of ${most.toLocaleString("en-US")} characters`;
}

/** Where an attribute's criteria last changed from an answer or an assumption; null when
 * they did not. */
export function updatedFromLine(matter: string | undefined): string | null {
  const said = (matter ?? "").trim();
  if (said === "") {
    return null;
  }
  // A person's change of an assumption ended the criteria's acceptance (the server's cause
  // "Reopened: <matter>", attribute_assumptions.reopened_cause): to accept again.
  const reopened = /^Reopened:\s*(.+)$/.exec(said);
  if (reopened !== null) {
    return `Reopened for acceptance: you changed the assumption on ${reopened[1]}`;
  }
  return `Updated from your answer on ${said}`;
}

/** The fold over an attribute's earlier criteria; null when none is kept. */
export function previousCriteriaLabel(
  count: number | undefined,
): string | null {
  return count === undefined || count <= 0
    ? null
    : `Previous criteria (${count})`;
}

const WRITER_WORDS: Record<CriteriaVersion["writtenBy"]["kind"], string> = {
  PERSON: "Written by",
  AGENT: "Tailored by",
  SEEDED: "Seeded by",
  RULES: "Set by",
};
const WRITER_FALLBACK: Record<CriteriaVersion["writtenBy"]["kind"], string> = {
  PERSON: "a person",
  AGENT: "the agent",
  SEEDED: "the demo data",
  RULES: "the rules",
};

/** Who wrote an earlier version, when, and why: an agent's is never worded as a person's. */
export function versionLine(
  version: Pick<CriteriaVersion, "writtenBy" | "writtenAt" | "cause">,
  timeZone?: string,
): string {
  const { kind, name } = version.writtenBy;
  const by = `${WRITER_WORDS[kind]} ${name.trim() || WRITER_FALLBACK[kind]}`;
  const when = whenWords(version.writtenAt, timeZone);
  const cause = version.cause.trim();
  return [by, when, cause].filter((part) => part !== "").join(" · ");
}

/** What the understanding is ready for (B1j): once complete, the attributes are, whatever a
 * question the rules raised since holds for the D&I evidence, which reads the understanding as
 * before; while the agents check what else they need, the attributes are not ready yet. */
export function readyOnceComplete<
  T extends { key: "attributes" | "evidence"; ready: boolean; note: string },
>(
  lines: readonly T[],
  complete: boolean,
  proposed: number,
  checking = false,
): T[] {
  return lines.map((line) =>
    line.key !== "attributes"
      ? line
      : complete && !line.ready
        ? {
            ...line,
            ready: true,
            note: proposed > 0 ? `${proposed} to decide` : "Ready",
          }
        : !complete && checking
          ? { ...line, ready: false, note: "Checking" }
          : line,
  );
}

/** The chip on a question in the course: the specialist review's, the pass's for the
 * attributes, the rules', or the agents' otherwise. */
export function raisedChip(
  issue:
    | { raisedBy?: string; origin: string; fromReview?: boolean }
    | undefined,
): string {
  // The specialist's review asked it (B1k), whatever its origin.
  if (issue?.fromReview === true) {
    return FROM_REVIEW;
  }
  if (issue !== undefined && addedForAttributes(issue)) {
    return ADDED_FOR_ATTRIBUTES;
  }
  return issue?.raisedBy === "RULES"
    ? "Raised by the rules"
    : "Raised by the agents";
}
