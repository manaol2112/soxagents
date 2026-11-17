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
  type Assumption,
  contextProblem,
  type QuestionPass,
  type QuestionReview,
  type UnifiedRow,
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

/** Where the review stands, as Control Understanding draws it. */
export type ReviewView =
  | { state: "none" }
  | { state: "checking" }
  | { state: "failed"; failure: string }
  | { state: "ready"; review: QuestionReview; settled: boolean };

/**
 * What the review's place shows:
 * - failed: the pass says FAILED: one line with the failure sentence, and two choices;
 * - checking: the specialist is reading (the pass CHECKING, or the latest review PENDING
 *   before completion);
 * - ready: the latest review's paragraph; settled once it has nothing left to ask (no
 *   question of its waits), when it reads as "Reviewed <when>: …";
 * - none: no review (a body from before B1k, or none ran).
 */
export function reviewView(
  pass: QuestionPass | null,
  review: QuestionReview | null | undefined,
  completed = false,
): ReviewView {
  if (pass === "FAILED") {
    const said = review?.status === "FAILED" ? review.failure.trim() : "";
    return { state: "failed", failure: said === "" ? FAILURE_FALLBACK : said };
  }
  if (pass === "CHECKING" || (!completed && review?.status === "PENDING")) {
    return { state: "checking" };
  }
  if (review?.status === "READY") {
    return { state: "ready", review, settled: review.openQuestions === 0 };
  }
  return { state: "none" };
}

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

/** The attributes the specialist did not review, in one quiet line; null for none. */
export function notReviewedLine(codes: readonly string[]): string | null {
  const named = codes.map((code) => code.trim()).filter((code) => code !== "");
  if (named.length === 0) {
    return null;
  }
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return named.length === 1
    ? `Attribute ${list} was not reviewed; the agent states its assumptions on it.`
    : `Attributes ${list} were not reviewed; the agent states its assumptions on them.`;
}

/** Whether "Review again" is offered: a person's request, once the understanding is
 * complete and no review is running. */
export function offersReviewAgain(
  completedAt: string | null,
  pass: QuestionPass | null,
  canAct: boolean,
): boolean {
  return canAct && completedAt !== null && pass !== "CHECKING";
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

/** The questions closed as not known: those the page has (status NOT_KNOWN) and those this
 * visit closed before the page's data caught up. */
export function notKnownKeys(
  issues: ReadonlyArray<{ id: string; status: string }>,
  closed: ReadonlySet<string>,
): Set<string> {
  const keys = new Set(closed);
  for (const issue of issues) {
    if (issue.status === "NOT_KNOWN") {
      keys.add(issue.id);
    }
  }
  return keys;
}

/** A course's review without the questions left as not known: never an answer, so never on
 * record, never asked again in this visit. */
export function withoutNotKnown<
  R extends { needs: ReadonlyArray<{ key: string; kind: string }> },
>(review: R, keys: ReadonlySet<string>): R {
  if (keys.size === 0) {
    return review;
  }
  return {
    ...review,
    needs: review.needs.filter(
      (need) => !(need.kind === "QUESTION" && keys.has(need.key)),
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

/** The open assumptions not confirmed that an acceptance of these rows takes with it: never a
 * conflict, which holds its attribute instead. */
export function unconfirmedWith(rows: readonly UnifiedRow[]): number {
  return rows.reduce(
    (sum, row) =>
      sum +
      (row.item.assumptions ?? []).filter(
        (item) => item.status === "OPEN" && item.kind !== "CONFLICT",
      ).length,
    0,
  );
}

/** "Accept all N"'s words: the count it accepts, what it leaves out, and the assumptions not
 * confirmed that go with it. */
export function acceptAllWords(
  accepted: readonly UnifiedRow[],
  heldOut: number,
): { label: string; leftOut: string; includes: string } {
  const unconfirmed = unconfirmedWith(accepted);
  return {
    label: `Accept all ${accepted.length}`,
    leftOut:
      heldOut <= 0
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
