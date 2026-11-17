/**
 * Control Understanding ends with a review by an IT audit specialist (docs/control-workflow-
 * plan.md, B1k, hardened by B1l; product owner, 16 November 2026: "When I say it audit
 * specialist, i meant an agent that reviews all the questions asked. Its good to keep the
 * review ... in a narrarive format"; "any follow up needed are all asked at the end if those
 * are flagged?"; and to the hardening: "Okay please proceed."). Approved prototype:
 * brief-proto/ureview2.png.
 *
 * - Under "The understanding" comes "Review of the questions asked · IT audit specialist": a
 *   short paragraph, the matters it does not yet establish marked quietly in its text.
 * - Its questions join the same course, "From the review · for the attributes", each with the
 *   criterion or request it blocks as its reason line.
 * - Every question offers "Not known yet, proceed": closed as the person's not known, never as
 *   an answer; the matter becomes an assumption on the attributes.
 * - A review that could not run never blocks: Run again, or Proceed without it.
 * - On the Attributes step, a conflict holds its attribute until a person decides it, and
 *   "Accept all" says what it leaves out and how many assumptions go with it unconfirmed.
 *
 * Pure: the words and the decisions the screens draw, from the records the page holds.
 */

import {
  type AskedFact,
  type Assumption,
  type Attribute,
  attributeLetter,
  contextProblem,
  type QuestionPass,
  type QuestionReview,
  type ReviewNotRun,
  type ReviewRequest,
  type UnifiedRow,
  unifiedState,
} from "./control-context-model.ts";
import { FROM_REVIEW, whenWords } from "./understanding-once-model.ts";

export { FROM_REVIEW };

export const REVIEW_TITLE = "Review of the questions asked";
export const REVIEW_BY = "IT audit specialist";
/** The third action on every question in Control Understanding (B1l point 1). */
export const NOT_KNOWN_ACTION = "Not known yet, proceed";
export const NOT_KNOWN_LABEL = "What is known so far (optional)";
export const NOT_KNOWN_RECORD = "Proceed without an answer";
export const NOT_KNOWN_HINT =
  "The question is closed as not known yet, never as an answer. The agents state an assumption on the attributes it bears on, for you to confirm there.";
export const NOT_KNOWN_DONE = "Left as not known yet.";
/** While the specialist reads. */
export const REVIEW_CHECKING = "Checking what else the agents need…";
export const REVIEW_FAILED = "The review could not run";
/** The workflow node's status (a node holds 28 characters). */
export const REVIEW_FAILED_STATUS = "The review could not run";
export const RUN_AGAIN = "Run again";
export const PROCEED_WITHOUT = "Proceed without it";
export const REVIEW_AGAIN = "Review again";
export const REVIEW_AGAIN_SENT =
  "Review requested. What it finds is stated on the attributes as assumptions, never as new questions here.";
export const PROCEED_SENT =
  "Completed by the rules, without the review. Any gap the agents find is stated on the attributes as an assumption.";
const FAILURE_FALLBACK = "The specialist's answer could not be used.";
/** Without a model (B1k): the review is not run, and says so in one line. */
export const REVIEW_NOT_RUN =
  "The specialist's review was not run: no model is configured. The understanding follows the rules.";
/** A control completed with no review (proceeded without it, by the rules, or accepted
 * before B1k): one quiet line, with a person's request to run it. */
export const REVIEW_NONE = "The questions were not reviewed by the specialist.";
export const RUN_REVIEW = "Run the review";
/** A read a person asked for after completion that could not run: the last good review
 * stays shown above this line. */
export const REVIEW_AGAIN_FAILED = "The review requested could not run";

/** The server's sentence for a review that could not run for want of a model. */
const NO_MODEL = /no model is configured/i;

/** Where the review stands, as Control Understanding draws it. */
export type ReviewView =
  | { state: "none" }
  | { state: "notRun" }
  | { state: "unreviewed"; failure: string | null }
  | { state: "checking"; last: QuestionReview | null }
  | { state: "failed"; failure: string }
  | {
      state: "ready";
      review: QuestionReview;
      settled: boolean;
      /** A later read a person asked for could not run: its sentence; null for none. */
      againFailed: string | null;
    };

/** What the server says besides the review (B1k/B1l): a read a person asked for after
 * completion, why none could run, and the last READY review this visit saw (a body that
 * carries only the newest row would hide it). */
export type ReviewExtra = {
  request?: ReviewRequest | null;
  notRun?: ReviewNotRun | null;
  last?: QuestionReview | null;
};

/**
 * What the review's place shows:
 * - failed: before completion, the pass says FAILED: one line with the failure sentence, and
 *   two choices (the course's last screen);
 * - checking: the specialist is reading: the pass CHECKING, or a read PENDING, before or
 *   after completion ("Review again"). The last good review stays shown meanwhile;
 * - ready: the last READY review's paragraph; settled once it has nothing left to ask, when it
 *   reads as "Reviewed <when>: …"; a later read a person asked for that could not run is said
 *   under it, with Run again;
 * - notRun: no model is configured: one quiet line (B1k "Without a model");
 * - unreviewed: complete with no review (proceeded, by the rules, accepted before B1k), or
 *   the only read failed after completion: one quiet line, and a person may ask for one;
 * - none: nothing to say (a body from before B1k, or before any read).
 */
export function reviewView(
  pass: QuestionPass | null,
  review: QuestionReview | null | undefined,
  completed = false,
  extra: ReviewExtra = {},
): ReviewView {
  const request = extra.request ?? null;
  const shown =
    review?.status === "READY"
      ? review
      : extra.last?.status === "READY"
        ? extra.last
        : null;
  if (!completed && pass === "FAILED") {
    const said = review?.status === "FAILED" ? review.failure.trim() : "";
    return { state: "failed", failure: said === "" ? FAILURE_FALLBACK : said };
  }
  if (
    pass === "CHECKING" ||
    review?.status === "PENDING" ||
    request?.status === "PENDING"
  ) {
    return { state: "checking", last: shown };
  }
  const failedRead =
    request?.status === "FAILED"
      ? request.failure
      : review?.status === "FAILED" || pass === "FAILED"
        ? (review?.failure ?? "")
        : null;
  const noModel =
    extra.notRun === "NO_MODEL" ||
    (failedRead !== null && NO_MODEL.test(failedRead));
  if (shown !== null) {
    return {
      state: "ready",
      review: shown,
      settled: shown.openQuestions === 0,
      againFailed:
        failedRead === null || !completed
          ? null
          : failedRead.trim() === ""
            ? FAILURE_FALLBACK
            : failedRead.trim(),
    };
  }
  if (noModel) {
    return { state: "notRun" };
  }
  if (completed) {
    return {
      state: "unreviewed",
      failure:
        failedRead === null
          ? null
          : failedRead.trim() === ""
            ? FAILURE_FALLBACK
            : failedRead.trim(),
    };
  }
  return { state: "none" };
}

/** The last READY review this visit has seen, kept so that a body carrying only a newer read
 * in flight or failed never hides it; a newer READY one replaces it. */
export function lastReady(
  held: QuestionReview | null,
  review: QuestionReview | null | undefined,
): QuestionReview | null {
  return review?.status === "READY" ? review : held;
}

/** Whether the page asks the server to queue a review that is due (B1l point 1, no dead end):
 * the course reads as "Checking…" before completion with no read live (the pass is not
 * CHECKING and no read is PENDING). The request is explicit and idempotent, never a write in
 * the page's GET. */
export function ensuresReview(
  end: string,
  pass: QuestionPass | null,
  review: QuestionReview | null | undefined,
  canAct: boolean,
): boolean {
  return (
    canAct &&
    end === "checking" &&
    pass !== "CHECKING" &&
    review?.status !== "PENDING"
  );
}

/** How often, at most, the page asks again while it still reads as checking with nothing
 * live: once on arriving, then every 30 seconds. */
export const ENSURE_EVERY_MS = 30000;
/** Said when the server did not take that request: the review can still be asked for. */
export const ENSURE_REFUSED = "The review has not started yet.";

/** The narrative in parts, the marked matters marked: each marked part once, at its first
 * place in the text that does not overlap an earlier mark. Nothing is marked that the
 * narrative does not say word for word. */
export function markedParts(
  narrative: string,
  marked: readonly string[],
): Array<{ text: string; marked: boolean }> {
  const spans: Array<[number, number]> = [];
  for (const part of marked) {
    if (part === "") {
      continue;
    }
    let from = 0;
    for (;;) {
      const at = narrative.indexOf(part, from);
      if (at < 0) {
        break;
      }
      const end = at + part.length;
      if (spans.every(([a, b]) => end <= a || at >= b)) {
        spans.push([at, end]);
        break;
      }
      from = at + 1;
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const parts: Array<{ text: string; marked: boolean }> = [];
  let at = 0;
  for (const [start, end] of spans) {
    if (start > at) {
      parts.push({ text: narrative.slice(at, start), marked: false });
    }
    parts.push({ text: narrative.slice(start, end), marked: true });
    at = end;
  }
  if (at < narrative.length) {
    parts.push({ text: narrative.slice(at), marked: false });
  }
  return parts;
}

/** "Reviewed Nov 16, 4:20 PM: " before a settled review's paragraph; "Reviewed: " where its
 * time is not given. */
export function reviewedLead(
  reviewedAt: string | null,
  timeZone?: string,
): string {
  const when = whenWords(reviewedAt ?? "", timeZone);
  return when === "" ? "Reviewed: " : `Reviewed ${when}: `;
}

/** A kind of fact as the review names it for a control with no attributes yet. */
const FACT_WORDS: Record<AskedFact, string> = {
  PERFORMER: "who performs it",
  APPROVER: "who approves it",
  SYSTEM: "the system",
  RECORD: "the record that shows it",
  TIMING: "the timing",
  POPULATION: "the population",
  EXCEPTION: "how exceptions are handled",
  OTHER: "other matters",
};

function listed(items: readonly string[]): string {
  return items.length === 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The attributes the specialist did not review, in one quiet line, named by the letters the
 * Attributes step shows (B1l point 5); null for none. The server names a unit by the
 * attribute's code ("A2"), by its library definition key, or, for a control with no
 * attributes yet, by the kind of fact: each is read back to a letter, or to the fact's
 * words. One the page cannot place is counted, never shown as a code.
 */
export function notReviewedLine(
  codes: readonly string[],
  approved: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">> = [],
): string | null {
  const named = codes.map((code) => code.trim()).filter((code) => code !== "");
  if (named.length === 0) {
    return null;
  }
  const letters: string[] = [];
  const facts: string[] = [];
  let unplaced = 0;
  for (const code of named) {
    const at = approved.findIndex(
      (item) =>
        item.id === code ||
        (item.code !== undefined && item.code !== "" && item.code === code) ||
        item.definition?.key === code,
    );
    const fact = (Object.keys(FACT_WORDS) as AskedFact[]).find(
      (each) => each === code,
    );
    if (at >= 0) {
      const letter = attributeLetter(at);
      if (!letters.includes(letter)) {
        letters.push(letter);
      }
    } else if (fact !== undefined && approved.length === 0) {
      facts.push(FACT_WORDS[fact]);
    } else {
      unplaced += 1;
    }
  }
  const parts: string[] = [];
  if (letters.length > 0) {
    parts.push(
      letters.length === 1
        ? `Attribute ${letters[0]} was not reviewed; the agent states its assumptions on it.`
        : `Attributes ${listed(letters)} were not reviewed; the agent states its assumptions on them.`,
    );
  }
  if (facts.length > 0) {
    parts.push(
      `Not reviewed: ${listed(facts)}; the agent states its assumptions on the attributes.`,
    );
  }
  if (unplaced > 0) {
    parts.push(
      unplaced === 1
        ? `${letters.length > 0 ? "One more attribute" : "One attribute"} was not reviewed; the agent states its assumptions on it.`
        : `${unplaced} ${letters.length > 0 ? "more " : ""}attributes were not reviewed; the agent states its assumptions on them.`,
    );
  }
  return parts.join(" ");
}

/** Whether "Review again" is offered: a person's request, once the understanding is
 * complete and no review is running; never without a model. After a read that could not
 * run, it stays offered (as "Run again"). */
export function offersReviewAgain(
  completedAt: string | null,
  pass: QuestionPass | null,
  canAct: boolean,
  view?: ReviewView,
): boolean {
  return (
    canAct &&
    completedAt !== null &&
    pass !== "CHECKING" &&
    view?.state !== "checking" &&
    view?.state !== "notRun"
  );
}

/** The words of the request after completion: "Run again" after a read that could not run,
 * "Run the review" where none ran, "Review again" otherwise. */
export function reviewAgainWords(view: ReviewView): string {
  if (view.state === "ready") {
    return view.againFailed !== null ? RUN_AGAIN : REVIEW_AGAIN;
  }
  if (view.state === "unreviewed") {
    return view.failure !== null ? RUN_AGAIN : RUN_REVIEW;
  }
  return REVIEW_AGAIN;
}

/** A question the specialist's review asked. */
export function fromReview(
  issue: { fromReview?: boolean } | undefined,
): boolean {
  return issue?.fromReview === true;
}

/** A question's reason line: what cannot be written without the fact; "" for none. */
export function blocksLine(issue: { blocks?: string } | undefined): string {
  return (issue?.blocks ?? "").trim();
}

/** Whether a question offers "Not known yet, proceed": every question a person is asked that
 * the server holds as waiting, for someone who may act. */
export function offersNotKnown(
  issue: { status: string } | undefined,
  canAct: boolean,
): boolean {
  return canAct && issue?.status === "OPEN";
}

/** What a person leaves as not known yet (B1l point 1, and the product owner, 16 November
 * 2026: required walkthrough questions and statement values too): an agent's or the review's
 * question at the version read, a walkthrough question or a statement value by its key. */
export type NotKnownTarget =
  | { kind: "issue"; id: string; version: number }
  | { kind: "walkthrough"; key: string }
  | { kind: "value"; key: string };

/** The kinds of course question a person may leave as not known yet. */
const NOT_KNOWN_KINDS = ["QUESTION", "ANSWER", "WALKTHROUGH"] as const;

/** What "Not known yet, proceed" on a course step closes, or null where it is not offered:
 * an OPEN question of the agents or the review; a statement value or a walkthrough question
 * not yet on record. Only for someone who may act. */
export function notKnownTarget(
  need: { key: string; kind: string; status: string },
  issue: { id: string; status: string; version: number } | undefined,
  canAct: boolean,
): NotKnownTarget | null {
  if (!canAct) {
    return null;
  }
  if (need.kind === "QUESTION") {
    return issue !== undefined && offersNotKnown(issue, canAct)
      ? { kind: "issue", id: issue.id, version: issue.version }
      : null;
  }
  if (need.status === "CONFIRMED") {
    return null;
  }
  return need.kind === "ANSWER"
    ? { kind: "value", key: need.key }
    : need.kind === "WALKTHROUGH"
      ? { kind: "walkthrough", key: need.key }
      : null;
}

/** The key a target closes in the course: the question's id, or the value's or walkthrough
 * question's key. */
export function targetKey(target: NotKnownTarget): string {
  return target.kind === "issue" ? target.id : target.key;
}

/** The questions closed as not known: those the page has (an issue with status NOT_KNOWN, a
 * value or walkthrough question the review lists as not known) and those this visit closed
 * before the page's data caught up. */
export function notKnownKeys(
  issues: ReadonlyArray<{ id: string; status: string }>,
  closed: ReadonlySet<string>,
  listed: ReadonlyArray<{ key: string }> = [],
): Set<string> {
  const keys = new Set(closed);
  for (const issue of issues) {
    if (issue.status === "NOT_KNOWN") {
      keys.add(issue.id);
    }
  }
  for (const item of listed) {
    keys.add(item.key);
  }
  return keys;
}

/** A course's review without the questions left as not known: never an answer, so never on
 * record, never asked again in this visit. A question, a statement value or a walkthrough
 * question (B1l point 1); never a document, the process or the sign-in settings. */
export function withoutNotKnown<
  R extends { needs: ReadonlyArray<{ key: string; kind: string }> },
>(review: R, keys: ReadonlySet<string>): R {
  if (keys.size === 0) {
    return review;
  }
  return {
    ...review,
    needs: review.needs.filter(
      (need) =>
        !(
          NOT_KNOWN_KINDS.some((kind) => kind === need.kind) &&
          keys.has(need.key)
        ),
    ),
  };
}

/** What the understanding is ready for while the review could not run (B1l point 7): the
 * attributes wait on the person's choice, Run again or Proceed without it, whatever the gates
 * read. */
export function heldByFailedReview<
  T extends { key: "attributes" | "evidence"; ready: boolean; note: string },
>(lines: readonly T[], failed: boolean): T[] {
  return lines.map((line) =>
    failed && line.key === "attributes"
      ? { ...line, ready: false, note: "Review to run or skip" }
      : line,
  );
}

/** The course as the header counts it: a question left as not known is neither confirmed nor
 * still to answer, so it leaves the count. */
export function courseWithout<
  C extends { plan: readonly string[]; carried: readonly string[] },
>(course: C, keys: ReadonlySet<string>): C {
  if (keys.size === 0) {
    return course;
  }
  return {
    ...course,
    plan: course.plan.filter((key) => !keys.has(key)),
    carried: course.carried.filter((key) => !keys.has(key)),
  };
}

// The Attributes step: conflicts and Accept all (B1l point 6).

export const CONFLICT_LEAD = "A conflict to decide";
export const CONFLICT_STANDS = "The confirmed understanding stands";
export const NOT_KNOWN_LEAD = "Left as not known in Control Understanding:";
export const ASSUMED_LEAD_TEXT = "The agent assumed:";

/** How an open assumption is led, by its kind. */
export function assumptionLead(kind: Assumption["kind"] | undefined): string {
  return kind === "CONFLICT"
    ? `${CONFLICT_LEAD}:`
    : kind === "NOT_KNOWN"
      ? NOT_KNOWN_LEAD
      : ASSUMED_LEAD_TEXT;
}

/** The confirming choice's words, by kind: for a conflict, the confirmed understanding
 * stands. */
export function confirmWords(kind: Assumption["kind"] | undefined): string {
  return kind === "CONFLICT" ? CONFLICT_STANDS : "That's right";
}

/**
 * The open assumptions not confirmed that an acceptance of these rows takes with it, each
 * once (the server lists one under every attribute it names): never a conflict, which holds
 * its attribute instead. When the acceptance leaves nothing else to accept (`rest`: the rows
 * still to accept or without criteria, beyond these), the server also accepts the set's open
 * assumptions with it (B1l point 6): those are counted too.
 */
export function unconfirmedWith(
  rows: readonly UnifiedRow[],
  set: {
    assumptions?: readonly Assumption[];
    /** Every row not yet accepted, these included: the set is accepted with these only
     * when they are all of them. */
    remaining?: readonly UnifiedRow[];
  } = {},
): number {
  const ids = new Set<string>();
  const waiting = (item: Assumption) =>
    item.status === "OPEN" && item.kind !== "CONFLICT";
  for (const row of rows) {
    for (const item of row.item.assumptions ?? []) {
      if (waiting(item)) {
        ids.add(item.id);
      }
    }
  }
  const accepting = new Set(rows.map((row) => row.item.id));
  const coversAll =
    rows.length > 0 &&
    set.remaining !== undefined &&
    set.remaining.every((row) => accepting.has(row.item.id));
  if (coversAll) {
    for (const item of set.assumptions ?? []) {
      if (waiting(item)) {
        ids.add(item.id);
      }
    }
  }
  return ids.size;
}

/** Every row not yet accepted: what must all be accepted for the set to be. */
export function notYetAccepted(rows: readonly UnifiedRow[]): UnifiedRow[] {
  return rows.filter((row) => unifiedState(row, false) !== "ACCEPTED");
}

/** "Accept all N"'s words: the count it accepts, what it leaves out, and the assumptions not
 * confirmed that go with it (the set's too, when it accepts everything still to accept). A
 * conflict on the set holds all of them, and says so. */
export function acceptAllWords(
  accepted: readonly UnifiedRow[],
  heldOut: number,
  set: {
    assumptions?: readonly Assumption[];
    remaining?: readonly UnifiedRow[];
    held?: boolean;
  } = {},
): { label: string; leftOut: string; includes: string } {
  const unconfirmed = unconfirmedWith(accepted, set);
  return {
    label: `Accept all ${accepted.length}`,
    leftOut:
      set.held === true && heldOut > 0
        ? `${heldOut === 1 ? "1 held" : `All ${heldOut} held`}: a conflict on the attributes as a set to decide`
        : heldOut <= 0
          ? ""
          : heldOut === 1
            ? "1 left out: a conflict to decide"
            : `${heldOut} left out: conflicts to decide`,
    includes:
      unconfirmed <= 0
        ? ""
        : unconfirmed === 1
          ? "includes 1 assumption not confirmed"
          : `includes ${unconfirmed} assumptions not confirmed`,
  };
}

/** One acceptance's words with it, joined for the line under the bar; "" for nothing. */
export function acceptAllNote(words: {
  leftOut: string;
  includes: string;
}): string {
  return [words.leftOut, words.includes]
    .filter((part) => part !== "")
    .join(" · ");
}

// The writes' answers.

/** A person's request of the review: run it (again), or proceed without a failed one. */
export type ReviewIntent = "review-run" | "review-proceed";

/** The write that leaves a target as not known yet, and its fields. */
export function notKnownWrite(
  target: NotKnownTarget,
  note: string,
): {
  intent: "issue-not-known" | "walkthrough-not-known" | "value-not-known";
  fields: Record<string, unknown>;
} {
  return target.kind === "issue"
    ? {
        intent: "issue-not-known",
        fields: { issue_id: target.id, version: target.version, note },
      }
    : {
        intent:
          target.kind === "walkthrough"
            ? "walkthrough-not-known"
            : "value-not-known",
        fields: { key: target.key, note },
      };
}

/** The server's sentence when it reads as one plain sentence, else null. */
function sentenceOf(detail: string): string | null {
  const said = detail.replace(/\s+/g, " ").trim();
  return /^[A-Z][^\n]{4,240}\.$/.test(said) ? said : null;
}

/** Why a review request was not taken, or null once the server confirmed it: 202 for a
 * review it accepted to run, 200 for a proceed it recorded. */
export function reviewProblem(
  intent: ReviewIntent,
  status: number,
  detail = "",
): string | null {
  if (
    intent === "review-run" ? status === 202 || status === 200 : status === 200
  ) {
    return null;
  }
  if (status === 409) {
    return (
      sentenceOf(detail) ??
      (intent === "review-run"
        ? "The review is already running, or the understanding changed. Refresh and try again."
        : "The review is no longer failed, or the understanding changed. Refresh and try again.")
    );
  }
  return contextProblem(status === 202 ? 500 : status, detail);
}

/** Why a question could not be left as not known, or null once the server recorded it. */
export function notKnownProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    return (
      sentenceOf(detail) ??
      "The question changed while you were working. Refresh and try again."
    );
  }
  if (status === 422) {
    return "Keep the note to 500 characters, with no password or key.";
  }
  return contextProblem(status, detail);
}
