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
  type NotReviewedItem,
  PROCEED_REASON_MIN,
  type QuestionPass,
  type QuestionReview,
  type ReviewNotRun,
  type ReviewPoint,
  type ReviewRequest,
  type SupportItem,
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
/** While the review is held on attributes it did not review (owner decision, 18 November
 * 2026): the workflow node's status (a node holds 28 characters), the end of the course's
 * title, its choice, and the reason to proceed. */
export const REVIEW_HELD_STATUS = "Attributes not reviewed";
export const REVIEW_HELD = "The review is not complete";
export const REVIEW_HELD_CHOICE =
  "Run the review again, or proceed without it and record the reason.";
export const REVIEW_HELD_NO_RUN =
  "The review has run twice and cannot run again. Proceed without it and record the reason.";
export const PROCEED_REASON_LABEL = "Reason for proceeding without the review";
/** What the reason needs, said before anything is typed (design review, 19 November 2026:
 * Proceed was disabled at 0 characters with only a count under the field). */
const PROCEED_REASON_NEEDS = `Give the reason (at least ${PROCEED_REASON_MIN} characters) to proceed.`;
export const PROCEED_REASON_HINT = `${PROCEED_REASON_NEEDS} Recorded in the audit trail with the attributes not reviewed.`;
/** The same hint where no attribute not reviewed is named on the screen. */
export const PROCEED_REASON_HINT_PLAIN = `${PROCEED_REASON_NEEDS} Recorded in the audit trail.`;
/** The workflow node once a person proceeded without the review of some (28 characters at
 * most). */
// "Without the full review" (design review, 19 November 2026; old "Completed without review"):
// the panel title's words within the node's 28 characters.
export const PROCEEDED_STATUS = "Without the full review";
/** The end of the course while the questions the agents raised are having their wording
 * checked: the same count as the header's (screenshot pass, 19 November 2026). */
export function preparingTitle(count: number): string {
  return count === 1 ? "Preparing the question…" : "Preparing the questions…";
}
/** After a challenge the server refused because the review changed: it is read again. */
export const CHALLENGE_REREAD =
  "The review was updated in the meantime. Check the point before challenging it.";
export const PROCEED_HELD_SENT =
  "Completed without the review of these attributes. The reason is recorded in the audit trail.";
export const RUN_AGAIN_SENT = "Running the review again…";

// What each established point rests on, and a person's challenge of it (owner decision, 18
// November 2026, "Show the support").
export const SUPPORT_TITLE = "What the review rests on";
export const CHALLENGE_ACTION = "Challenge";
export const CHALLENGE_NEED_LABEL = "Fact to ask again";
export const CHALLENGE_NOTE_LABEL = "What does not hold (optional)";
export const CHALLENGE_NOTE_HINT =
  "The point is asked again in the questions below; the understanding is completed once it is answered.";
export const CHALLENGE_SEND = "Ask again";
export const CHALLENGE_SENT =
  "Challenged. The understanding is completed once the new question is answered.";
/** A challenged point's state, as one line (design review, 19 November 2026): while its
 * question is still being worded it is not in the questions yet. */
export const CHALLENGE_PREPARING =
  "Challenged: a new question is being prepared.";
export const CHALLENGE_OPEN = "Challenged: asked again in the questions.";
export const CHALLENGE_ANSWERED = "Challenged and answered.";

/** What a challenged point says of its question; null when it is not challenged. */
export function challengeLine(state: ReviewPoint["challenge"]): string | null {
  return state === "PREPARING"
    ? CHALLENGE_PREPARING
    : state === "OPEN"
      ? CHALLENGE_OPEN
      : state === "ANSWERED"
        ? CHALLENGE_ANSWERED
        : null;
}
export const OPEN_DOCUMENT = "View the documents";
export const OPEN_NARRATIVE = "View the process narrative";
const SUPPORT_KIND_WORDS: Record<SupportItem["kind"], string> = {
  WALKTHROUGH: "Walkthrough answer",
  VALUE: "Statement value",
  QUESTION: "Answered question",
  DOCUMENT: "Document",
  NARRATIVE: "Process narrative",
};

/** One thing a point rests on, in three parts: what kind it is (the small label), what it
 * is (the question asked, the value's label, the document's title; "" for the narrative),
 * and what it says (the answer, the value, or the passage in quotation marks). */
export function supportLine(item: SupportItem): {
  kind: string;
  label: string;
  said: string;
} {
  const quoted = item.kind === "DOCUMENT" || item.kind === "NARRATIVE";
  return {
    kind: SUPPORT_KIND_WORDS[item.kind],
    label: item.kind === "NARRATIVE" ? "" : item.label,
    said: item.said === "" ? "" : quoted ? `“${item.said}”` : item.said,
  };
}

/** A point named as the Attributes step names it: "Attribute B" by its place, or a kind of
 * fact in words for a control with no attributes yet, or its own wording. */
export function pointName(
  point: Pick<ReviewPoint, "key" | "kind" | "attributeId" | "code" | "text">,
  approved: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">> = [],
): string {
  if (point.kind === "FACT") {
    const fact = (Object.keys(FACT_WORDS) as AskedFact[]).find(
      (each) => each === point.key,
    );
    const words = fact === undefined ? point.text : FACT_WORDS[fact];
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  }
  const at = approved.findIndex(
    (item) =>
      (point.attributeId !== null && item.id === point.attributeId) ||
      (point.code !== null &&
        item.code !== undefined &&
        item.code !== "" &&
        item.code === point.code) ||
      item.definition?.key === point.key,
  );
  return at >= 0 ? `Attribute ${attributeLetter(at)}` : point.text;
}

/** A kind of fact in words, capitalised, as a choice reads it ("Who approves it"). */
export function factWords(fact: string): string {
  const known = (Object.keys(FACT_WORDS) as AskedFact[]).find(
    (each) => each === fact,
  );
  const words = known === undefined ? fact : FACT_WORDS[known];
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** Whether a person may challenge a point now: before completion, not challenged yet, and
 * with a need it rests on to ask again. */
export function offersChallenge(
  point: Pick<ReviewPoint, "challenge" | "needs">,
  canAct: boolean,
  completed: boolean,
): boolean {
  return (
    canAct && !completed && point.challenge === "" && point.needs.length > 0
  );
}

/** Why a challenge was not taken, or null once the server confirmed it (200). */
export function challengeProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    return (
      sentenceOf(detail) ??
      "The review changed while you were working. Refresh and try again."
    );
  }
  if (status === 422) {
    return "Keep the note to 500 characters, with no password or key.";
  }
  return contextProblem(status, detail);
}
export const PROCEED_WITHOUT = "Proceed without it";
export const REVIEW_AGAIN = "Review again";
export const REVIEW_AGAIN_SENT =
  "Review requested. What it finds is stated on the attributes as assumptions, never as new questions here.";
export const PROCEED_SENT =
  "Completed by the rules, without the review. Any gap the agents find is stated on the attributes as an assumption.";
// The sentence when a failed read gives none (final design review, 19 November 2026, N3): the
// server's FAILED_SENTENCE without its lead, as failureDetail shows it.
export const FAILURE_FALLBACK =
  "The IT audit specialist's review could not be completed.";
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

/** Whether the page asks the server to follow up a review that is due (B1l point 1, no dead
 * end): the server says so (ContextBody.review_due: a read is due by the rules and none is
 * queued or at work, no agent run at work on the control), for someone who may act. The
 * request (POST .../understanding/review/follow) is explicit and idempotent, never a write in
 * the page's GET; the server queues the read, or ends it as one that could not run, so the
 * page then offers Run again and Proceed without it. Rewritten after the second review of
 * B1k: before, the page worked out its own condition, which also posted while a run was
 * queued. */
export function followsReview(
  due: boolean | undefined,
  completedAt: string | null,
  canAct: boolean,
): boolean {
  return canAct && completedAt === null && due === true;
}

/** How often, at most, the page asks again while the server still says a read is due: once
 * on arriving, then every 30 seconds. */
export const FOLLOW_EVERY_MS = 30000;
/** Said when the server did not take that request: the review can still be asked for, with
 * "Run the review" (POST .../understanding/review/run). */
export const FOLLOW_REFUSED = "The review has not started yet.";

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
/** Where each unit not reviewed sits as the page names it: an approved attribute by its
 * letter, a kind of fact (on a control with no attributes) by its words, or counted when the
 * page cannot place it. The one placing every line about units not reviewed reads. Pure. */
export function placeNotReviewed(
  codes: readonly string[],
  approved: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">> = [],
  items: ReadonlyArray<NotReviewedItem> = [],
): { letters: string[]; facts: string[]; unplaced: number } {
  // The server's own naming first (ReviewBody.not_reviewed_items): an approved attribute by
  // its id, so its letter is placed whatever its code; the unit key otherwise.
  const byKey = new Map(items.map((item) => [item.key, item]));
  const named = codes
    .map((code) => code.trim())
    .filter((code) => code !== "")
    .map((code) => byKey.get(code)?.attributeId ?? code);
  if (named.length === 0) {
    return { letters: [], facts: [], unplaced: 0 };
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
  return { letters, facts, unplaced };
}

/** The units not reviewed, named for a sentence ("attribute B", "attributes A and B", "who
 * approves it", "1 attribute"); null for none. Pure. */
export function notReviewedNames(
  codes: readonly string[],
  approved: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">> = [],
  items: ReadonlyArray<NotReviewedItem> = [],
): string | null {
  const { letters, facts, unplaced } = placeNotReviewed(codes, approved, items);
  const parts = [
    ...(letters.length === 0
      ? []
      : [
          `${letters.length === 1 ? "attribute" : "attributes"} ${listed(letters)}`,
        ]),
    ...facts,
    ...(unplaced === 0
      ? []
      : [`${unplaced} ${unplaced === 1 ? "attribute" : "attributes"}`]),
  ];
  return parts.length === 0 ? null : listed(parts);
}

/** After a person proceeded without the review of some units (ContextBody.review_proceeded):
 * the one sentence the header's lede, the review's line, the end of the course's status line
 * and the workflow say it with. Null when nothing was left not reviewed. Pure. */
export function proceededLine(
  proceeded: { notReviewed: string[] },
  approved: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">> = [],
  items: ReadonlyArray<NotReviewedItem> = [],
): string | null {
  const names = notReviewedNames(proceeded.notReviewed, approved, items);
  return names === null ? null : `Completed without the review of ${names}.`;
}

/** Where the lede and the review's line point to the reason, said once at the end of the
 * course (q_ui4, 19 November 2026: it was repeated three times). */
export const PROCEEDED_REASON_THERE =
  "The reason is recorded with the completion.";

/** The reason a person recorded, who and when: said once, at the end of the course, in the
 * body's weight. Null when none was recorded. Pure. */
export function proceededReason(
  proceeded: { by: string; at: string; reason: string },
  timeZone?: string,
): string | null {
  const reason = proceeded.reason.replace(/[.!?]+$/, "");
  if (reason === "") {
    return null;
  }
  const when = whenWords(proceeded.at, timeZone);
  const who = [proceeded.by, when].filter((part) => part !== "").join(", ");
  return `Reason recorded${who === "" ? "" : ` by ${who}`}: “${reason}”.`;
}

/** A validation line under a field: its count, the problem when there is one, then the hint;
 * one full stop between each, never two (screenshot pass, 19 November 2026: "at least 3
 * characters.."). Pure. */
export function hintParts(
  count: string,
  problem: string | null,
  hint: string,
): { count: string; problem: string | null; hint: string } {
  return {
    count,
    problem: problem === null ? null : problem.replace(/[.\s]+$/, ""),
    hint,
  };
}

/** A failure sentence under the title that already says the review could not run: the
 * reason alone, never the title again ("The review could not run: it stopped before it
 * finished." under "The review could not run"). Pure. */
export function failureDetail(failure: string): string {
  const rest = failure.replace(/^The review could not run:\s*/i, "").trim();
  return rest === ""
    ? failure
    : `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}

export function notReviewedLine(
  codes: readonly string[],
  approved: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">> = [],
  items: ReadonlyArray<NotReviewedItem> = [],
  /** The understanding waits on a person for them (the pass is HELD): the line says only
   * what was not reviewed, as the choice that follows says what happens next. */
  held = false,
): string | null {
  const { letters, facts, unplaced } = placeNotReviewed(codes, approved, items);
  if (letters.length + facts.length + unplaced === 0) {
    return null;
  }
  const parts: string[] = [];
  const onIt = held ? "." : "; the agent states its assumptions on it.";
  const onThem = held ? "." : "; the agent states its assumptions on them.";
  if (letters.length > 0) {
    parts.push(
      letters.length === 1
        ? `Attribute ${letters[0]} was not reviewed${onIt}`
        : `Attributes ${listed(letters)} were not reviewed${onThem}`,
    );
  }
  if (facts.length > 0) {
    parts.push(
      `Not reviewed: ${listed(facts)}${held ? "." : "; the agent states its assumptions on the attributes."}`,
    );
  }
  if (unplaced > 0) {
    parts.push(
      unplaced === 1
        ? `${letters.length > 0 ? "One more attribute" : "One attribute"} was not reviewed${onIt}`
        : `${unplaced} ${letters.length > 0 ? "more " : ""}attributes were not reviewed${onThem}`,
    );
  }
  return parts.join(" ");
}

/** The chip naming the attribute a review question asks about ("Attribute B"), by the
 * page's letter: the same order the server letters the challenge question by
 * (understanding_review.letters_of: the approved attributes by position). Null for a
 * question on no attribute, or one no longer approved (final design review, 19 November
 * 2026, N2: "What shows the items it covers for this attribute?" named none). */
export function askedAttributeChip(
  code: string | null | undefined,
  approved: ReadonlyArray<Pick<Attribute, "code">>,
): string | null {
  if (code === null || code === undefined || code === "") {
    return null;
  }
  const at = approved.findIndex((item) => item.code === code);
  return at < 0 ? null : `Attribute ${attributeLetter(at)}`;
}

/** The lede while the review is held (design review, 19 November 2026: the lede, the end
 * card and the review's line said the same choice three times): only the state, "The review
 * is held on attribute B."; the end of the course carries the choice. */
export function heldLede(
  codes: readonly string[],
  approved: ReadonlyArray<Pick<Attribute, "id" | "code" | "definition">> = [],
  items: ReadonlyArray<NotReviewedItem> = [],
): string {
  const { letters, facts, unplaced } = placeNotReviewed(codes, approved, items);
  const names = [
    ...(letters.length === 0
      ? []
      : [
          letters.length === 1
            ? `attribute ${letters[0]}`
            : `attributes ${listed(letters)}`,
        ]),
    ...facts,
    ...(unplaced === 0
      ? []
      : [
          `${unplaced} ${letters.length > 0 ? "more " : ""}${unplaced === 1 ? "attribute" : "attributes"}`,
        ]),
  ];
  return names.length === 0
    ? "The review is held."
    : `The review is held on ${listed(names)}.`;
}

/** The next step's line while the review waits on a person's choice (re-shoot r8, 19
 * November 2026: the card said to confirm proposed answers while the choice was Run again or
 * Proceed): the same state the end of the course shows (heldLede, or a review that could not
 * run) and the choice it offers. */
export function reviewChoiceLine(state: {
  failed: boolean;
  /** heldLede's sentence for a held review. */
  held: string;
  runAgain: boolean;
}): string {
  const said = state.failed
    ? REVIEW_FAILED_LEDE
    : state.held || "The review is held.";
  return state.runAgain
    ? `${said.replace(/\.$/, "")}: run it again, or proceed without it and record the reason.`
    : `${said} It has run twice and cannot run again: proceed without it and record the reason.`;
}

/** The next step's title and button while the review waits on that choice, and where it
 * opens: the end of the course that offers Run again and Proceed (ReviewFailed). */
export const REVIEW_CHOICE_ACTION = "Run again or proceed";

/** Whether the end of the course offers Run again: always after a review that could not run
 * (`held` null), and while a held one has a read left. One source for the end card's
 * buttons and the next step's action (re-shoot r10, 19 November 2026: H2 can only proceed,
 * and its card said "Run again or proceed"). */
export function runsAgain(held: { runAgain: boolean } | null): boolean {
  return held === null || held.runAgain;
}

/** The next step's action for that choice, as the end card offers it. */
export function reviewChoiceAction(runAgain: boolean): string {
  return runAgain ? REVIEW_CHOICE_ACTION : PROCEED_WITHOUT;
}
export const REVIEW_CHOICE_ANCHOR = "ur-review-choice";

/** The lede once the review could not run: only the state, as the end card carries the
 * choice. */
export const REVIEW_FAILED_LEDE =
  "The review of the questions asked could not run.";

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
const NOT_KNOWN_KINDS = ["QUESTION", "ANSWER", "AUTH", "WALKTHROUGH"] as const;

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
  // The sign-in settings (AUTH) are one value of the statement, composed setting by
  // setting: left as not known as that value.
  return need.kind === "ANSWER" || need.kind === "AUTH"
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
 * record, never asked again in this visit. A question, a statement value (the sign-in
 * settings among them) or a walkthrough question (B1l point 1); never a document or the
 * process. */
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

/** The attributes line while the review waits on a person's choice. */
export const REVIEW_TO_DECIDE = "Review to run again, or proceed";

/** What the understanding is ready for while the review could not run (B1l point 7): the
 * attributes wait on the person's choice, Run again or Proceed without it, whatever the gates
 * read. */
export function heldByFailedReview<
  T extends { key: "attributes" | "evidence"; ready: boolean; note: string },
>(lines: readonly T[], failed: boolean): T[] {
  return lines.map((line) =>
    failed && line.key === "attributes"
      ? { ...line, ready: false, note: REVIEW_TO_DECIDE }
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
/** A fact no agent could propose (UNKNOWN): never "The agent assumed:" with "That's right"
 * (design review, 19 November 2026). */
export const UNKNOWN_LEAD = "Not yet known:";
export const UNKNOWN_ADD = "Add the answer";
// Not "Leave open": "open" names a question still to answer (the words' rule, tests).
export const UNKNOWN_LEAVE = "Leave unanswered";

/** How an open assumption is led, by its kind. */
export function assumptionLead(kind: Assumption["kind"] | undefined): string {
  return kind === "CONFLICT"
    ? `${CONFLICT_LEAD}:`
    : kind === "NOT_KNOWN"
      ? NOT_KNOWN_LEAD
      : kind === "UNKNOWN"
        ? UNKNOWN_LEAD
        : ASSUMED_LEAD_TEXT;
}

/** The confirming choice's words, by kind: for a conflict, the confirmed understanding
 * stands; for a fact not yet known, the person leaves it open (recorded as their decision,
 * never as a confirmed fact of an answer). */
export function confirmWords(kind: Assumption["kind"] | undefined): string {
  return kind === "CONFLICT"
    ? CONFLICT_STANDS
    : kind === "UNKNOWN"
      ? UNKNOWN_LEAVE
      : "That's right";
}

/** How the server records a fact no agent could propose (attribute_assumptions.NOT_YET_KNOWN):
 * the question it asked, as a statement. */
export const NOT_YET_KNOWN = " is not yet known.";

/** The question a fact not yet known asked ("Who leads each investigation?"), from what the
 * server recorded ("Who leads each investigation is not yet known."); null for any other. */
export function unknownQuestion(assumed: string): string | null {
  const said = assumed.trim();
  if (!said.endsWith(NOT_YET_KNOWN)) {
    return null;
  }
  const asked = said.slice(0, -NOT_YET_KNOWN.length).trim();
  return asked === "" ? null : `${asked}?`;
}

/** What an open assumption says after its lead (re-shoot r8, 19 November 2026: "Not yet
 * known: Who leads ... is not yet known." said it twice): for a fact not yet known, the
 * question as a noun phrase ("who leads each investigation."); otherwise as recorded. */
export function assumptionText(
  item: Pick<Assumption, "kind" | "assumed">,
): string {
  const asked = item.kind === "UNKNOWN" ? unknownQuestion(item.assumed) : null;
  if (asked === null) {
    return item.assumed;
  }
  const phrase = asked.slice(0, -1);
  // An acronym that opens it keeps its case ("IT ..."); a word is lowered.
  const lowered = /^[A-Z][a-z]/.test(phrase)
    ? `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`
    : phrase;
  return `${lowered}.`;
}

/** The label over the answer box: the question itself for a fact not yet known (re-shoot
 * r8: "What is the case on Investigation owner?"), else the matter's. */
export function changePrompt(
  item: Pick<Assumption, "kind" | "assumed" | "matter">,
): string {
  const asked = item.kind === "UNKNOWN" ? unknownQuestion(item.assumed) : null;
  if (asked !== null) {
    return asked;
  }
  const matter = item.matter.trim();
  return matter === "" ? "What is the case?" : `What is the case on ${matter}?`;
}

/** The changing choice's words, by kind: a fact not yet known is answered, not changed. */
export function changeWords(kind: Assumption["kind"] | undefined): string {
  return kind === "UNKNOWN" ? UNKNOWN_ADD : "Change…";
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
/** A person's challenge of an established point. */
export type ChallengeIntent = "review-challenge";
/** The page's own follow-up of a read due by the rules (followsReview). */
export type FollowIntent = "review-follow";

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
