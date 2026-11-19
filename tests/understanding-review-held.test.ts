import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  contextWrite,
  PROCEED_REASON_MAX,
  parseContext,
  parseReviewHeld,
  proceedReasonProblem,
  QUESTION_PASSES,
} from "../apps/web/src/control-context-model.ts";
import {
  offersAttributes,
  readsAgain,
  understandingEnd,
} from "../apps/web/src/understanding-once-model.ts";
import * as words from "../apps/web/src/understanding-specialist-model.ts";

// Owner decision, 18 November 2026 ("Completion waits for a person"): a review that is read
// but left attributes not reviewed holds the understanding (question_pass HELD) until a
// person runs it again or proceeds without it with a reason. The same two choices as a
// review that could not run, said as such; one story on the screen (the header, the lede,
// the review's own line and the choice agree); nothing shows as done before the server says.

const read = (path: string) =>
  readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");
const review = read("src/understanding-review.tsx");
const specialist = read("src/understanding-specialist.tsx");
const workflow = read("src/control-workflow-model.ts");

/** The body of a top-level function or component in `source`, up to the next one. */
function component(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, name);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

const IDS = {
  organization_id: "018f0000-0000-7000-8000-000000000001",
  project_id: "018f0000-0000-7000-8000-000000000002",
  control_id: "018f0000-0000-7000-8000-000000000003",
};

describe("The API's held review, read strictly", () => {
  it("knows the HELD pass and reads what is held", () => {
    assert.ok(QUESTION_PASSES.includes("HELD"));
    assert.deepEqual(
      parseReviewHeld({ not_reviewed: ["A2", 3, "APPROVER"], run_again: true }),
      { notReviewed: ["A2", "APPROVER"], runAgain: true },
    );
    assert.equal(parseReviewHeld(null), null);
    assert.equal(parseReviewHeld({ run_again: true }), null);
    assert.equal(
      parseReviewHeld({ not_reviewed: [], run_again: "yes" })?.runAgain,
      false,
    );
    const context = parseContext({
      control_id: IDS.control_id,
      attributes: { approved: [], proposed: [], history: [] },
      issues: [],
      documents: [],
      question_pass: "HELD",
      review_held: { not_reviewed: ["A1"], run_again: false },
    });
    assert.equal(context?.questionPass, "HELD");
    assert.deepEqual(context?.reviewHeld, {
      notReviewed: ["A1"],
      runAgain: false,
    });
  });

  it("sends the reason to proceed, and refuses one the API would refuse", () => {
    const write = contextWrite({
      ...IDS,
      intent: "review-proceed",
      reason: "  The owner confirmed the approver in writing.  ",
    });
    assert.ok(!("error" in write));
    assert.deepEqual(write.body, {
      reason: "The owner confirmed the approver in writing.",
    });
    // After a review that could not run, the reason may be empty, as before.
    const empty = contextWrite({ ...IDS, intent: "review-proceed" });
    assert.ok(!("error" in empty));
    assert.deepEqual(empty.body, { reason: "" });
    for (const reason of [
      "x".repeat(PROCEED_REASON_MAX + 1),
      "api_key=sk-abcdefghijklmnopqrstuvwx",
    ]) {
      assert.ok(
        "error" in contextWrite({ ...IDS, intent: "review-proceed", reason }),
      );
    }
    assert.equal(
      proceedReasonProblem("  ok "),
      "Give a reason of at least 3 characters.",
    );
    assert.equal(proceedReasonProblem("The owner said so."), null);
  });
});

describe("Control Understanding while the review is held", () => {
  const held = { completedAt: null, questionPass: "HELD" as const };

  it("ends the course on the choice, never on the way to the attributes", () => {
    assert.equal(understandingEnd(held, true), "held");
    assert.equal(understandingEnd(held, false), "held");
    assert.equal(offersAttributes(held), false);
    assert.equal(readsAgain(held, true), false);
  });

  it("says what was not reviewed, and only that, while it waits on a person", () => {
    const approved = [
      { id: "a1", code: "A1", definition: null },
      { id: "a2", code: "A2", definition: null },
    ];
    assert.equal(
      words.notReviewedLine(["A2"], approved, [], true),
      "Attribute B was not reviewed.",
    );
    assert.equal(
      words.notReviewedLine(["A1", "A2"], approved, [], true),
      "Attributes A and B were not reviewed.",
    );
    assert.equal(
      words.notReviewedLine(["PERFORMER"], [], [], true),
      "Not reviewed: who performs it.",
    );
    // Once complete (or failed), as before: the agent states its assumptions on it.
    assert.equal(
      words.notReviewedLine(["A2"], approved),
      "Attribute B was not reviewed; the agent states its assumptions on it.",
    );
  });

  it("keeps its words short, plain and in the product's voice", () => {
    assert.ok(words.REVIEW_HELD_STATUS.length <= 28);
    for (const text of [
      words.REVIEW_HELD,
      words.REVIEW_HELD_CHOICE,
      words.REVIEW_HELD_NO_RUN,
      words.PROCEED_REASON_LABEL,
      words.PROCEED_REASON_HINT,
      words.PROCEED_HELD_SENT,
    ]) {
      assert.doesNotMatch(text, /\b(I|we|my|our)\b/);
      assert.doesNotMatch(text, /!/);
    }
  });

  it("tells one story: the header, the lede, the review's line and the choice agree", () => {
    // Never "understood" while held.
    assert.match(
      review,
      /end !== "checking" &&\s*end !== "failed" &&\s*end !== "held"\)/,
    );
    // Rewritten (design review, 19 November 2026: the same choice said three times). Old:
    // the lede read the held line and the choice, as the end of the course did. New: the
    // lede states only the state (heldLede: "The review is held on attribute B."), and the
    // choice that ends the course reads the held line and the choice.
    assert.match(
      review,
      /end === "held" \? \(\s*`\$\{draftedFrom\(groups, interview\)\}\. \$\{heldLede\(\s*once\.review\?\.notReviewed \?\? once\.held\?\.notReviewed \?\? \[\],/,
    );
    assert.doesNotMatch(review, /REVIEW_HELD_CHOICE|REVIEW_HELD_NO_RUN/);
    assert.equal(
      words.heldLede(["A2"], [
        { id: "a1", code: "A1", definition: null },
        { id: "a2", code: "A2", definition: null },
      ] as never),
      "The review is held on attribute B.",
    );
    assert.match(
      review,
      /held=\{\s*end === "held" \? \{ line: heldLine, runAgain: heldRunAgain \} : null\s*\}/,
    );
    assert.match(
      review,
      /notReviewedLine\(\s*once\.review\?\.notReviewed \?\? once\.held\?\.notReviewed \?\? \[\],\s*once\.approved \?\? \[\],\s*once\.review\?\.notReviewedItems \?\? \[\],\s*true,\s*\)/,
    );
    // The review's own line drops "the agent states its assumptions" while held.
    const section = component(specialist, "QuestionReviewSection");
    assert.match(section, /pass === "HELD" && completedAt === null/);
    // The attributes are held as for a failed review.
    assert.match(review, /end === "failed" \|\| end === "held",\s*\)/);
    // The workflow node says it, in attention.
    assert.match(
      workflow,
      /questionPass === "HELD"\) \{\s*return \{ tone: "attention", status: REVIEW_HELD_STATUS \};/,
    );
  });

  it("offers the two choices as for a failed review, with a reason, done only once the server says", () => {
    const choice = component(specialist, "ReviewFailed");
    // The same component and the same buttons.
    assert.match(choice, /\{held === null \? REVIEW_FAILED : REVIEW_HELD\}/);
    assert.match(choice, /PROCEED_WITHOUT/);
    assert.match(choice, /RUN_AGAIN\}/);
    // Run again only while a read is left in the budget.
    // Rewritten (re-shoot r10, 19 November 2026: one source with the next step's action).
    // Old: `held === null || held.runAgain` inline. New: the same rule, runsAgain.
    assert.match(choice, /const runAgain = runsAgain\(held\);/);
    assert.equal(words.runsAgain(null), true);
    assert.equal(words.runsAgain({ runAgain: false }), false);
    assert.match(choice, /\{runAgain \? \(/);
    // The reason: labelled, counted, said where it goes, and needed before proceeding.
    assert.match(
      choice,
      /<label htmlFor=\{`\$\{uid\}-reason`\}>\{PROCEED_REASON_LABEL\}<\/label>/,
    );
    assert.match(choice, /maxLength=\{PROCEED_REASON_MAX\}/);
    assert.match(
      choice,
      /hint=\{\s*held !== null \? PROCEED_REASON_HINT : PROCEED_REASON_HINT_PLAIN\s*\}/,
    );
    assert.match(
      choice,
      /disabled=\{sending !== null \|\| done \|\| reasonProblem !== null\}/,
    );
    assert.match(choice, /\{ reason: reason\.trim\(\) \}/);
    // Pending while it is sent, the success only once the server confirms it.
    assert.match(choice, /"Proceeding…"/);
    assert.match(
      choice,
      /const problem = reviewProblem\(intent, answer\.status, answer\.detail\);/,
    );
    assert.match(choice, /\? PROCEED_HELD_SENT\s*: PROCEED_SENT/);
  });
});
