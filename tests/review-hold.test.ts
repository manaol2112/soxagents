import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type WorkflowInput,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";
import {
  REVIEW_COVERAGE_ANCHOR,
  REVIEW_OUTSTANDING,
  REVIEW_REOPEN_ANCHOR,
  type ReviewHold,
  reviewHoldOf,
} from "../apps/web/src/review-model.ts";
import { quietLineOf } from "../apps/web/src/step-frame-model.ts";
import { panelFrame } from "../apps/web/src/step-panel-model.ts";

// E3 design review (19 November 2026), fix first: a signed review whose conclusion moved
// since it signed read "Signed off", "Done" and "Nothing is needed from you here." beside
// "Conclusion differs from the one the review signed: review outstanding". The Review
// step's state is derived from the typed reasons that hold the review, not from its status
// alone; a coverage gap at the control's own review reads the same way.

const CHANGED =
  "Conclusion differs from the one the review signed: review outstanding";
const GAP = "Testing changed since the review covered it: review outstanding";

// A control whose own review is signed off (the rest only as far as the review step needs).
function signed(reviewHold: ReviewHold | null): WorkflowInput {
  return {
    details: [{ label: "Description", filled: true }],
    setup: [
      {
        key: "answers",
        done: true,
        optional: false,
        mine: false,
        summary: "Answered",
      },
    ],
    attributes: { approved: 2, proposed: 0 },
    plan: { exists: true, approved: true, pendingReview: false },
    requirements: [
      { phase: "DESIGN", state: "ACCEPTED" },
      { phase: "INTERIM", state: "ACCEPTED" },
    ],
    sheet: {
      method: "SAMPLE",
      status: "SIGNED_OFF",
      items: 5,
      tested: 5,
      exceptions: 0,
      running: false,
      decided: true,
      reference: null,
    },
    rounds: [],
    findings: [],
    reviewStatus: "SIGNED_OFF",
    reviewHold,
    conclusion: "EFFECTIVE",
    proposedConclusion: "EFFECTIVE",
    designPaper: { status: "PREPARED", drafting: false },
    designConclusion: {
      status: "SIGNED_OFF",
      proposed: "EFFECTIVE",
      signed: "EFFECTIVE",
    },
    effectivenessPaper: { status: "PREPARED", drafting: false },
    busy: new Set(),
  };
}

const reviewStep = (input: WorkflowInput) => {
  const steps = workflowOf(input);
  const step = steps.find((item) => item.key === "review");
  assert.ok(step);
  return { step, frame: panelFrame("review", steps, "EFFECTIVE") };
};

const viewer = {
  viewerIsReviewer: true,
  viewerPrepared: false,
  independenceRequired: true,
};

describe("a signed review a typed reason holds", () => {
  it("is done only while nothing holds it", () => {
    const { step, frame } = reviewStep(signed(null));
    assert.equal(step.tone, "done");
    assert.equal(step.status, "Signed off");
    assert.equal(frame.need.kind, "done");
  });

  for (const clears of ["reopen", "coverage"] as const) {
    for (const viewerActs of [true, false]) {
      it(`never reads as done (${clears}, ${viewerActs ? "the reviewer" : "anyone else"})`, () => {
        const reason = clears === "reopen" ? CHANGED : GAP;
        const { step, frame } = reviewStep(
          signed({ reason, clears, viewerActs }),
        );
        assert.equal(step.tone, "attention");
        assert.equal(step.status, REVIEW_OUTSTANDING);
        assert.notEqual(frame.need.kind, "done");
        assert.notEqual(
          quietLineOf(frame.need)?.text,
          "Nothing is needed from you here.",
        );
        // The reason is said where the person reads the step: the decision row's title,
        // or the quiet line.
        const said = quietLineOf(frame.need)?.text ?? `${frame.need.title}`;
        assert.ok(said.includes(reason), said);
      });
    }
  }

  it("asks the reviewer to reopen the review, landing on its reopen form", () => {
    const { frame } = reviewStep(
      signed({ reason: CHANGED, clears: "reopen", viewerActs: true }),
    );
    assert.equal(frame.need.kind, "act");
    assert.equal(frame.need.title, CHANGED);
    assert.deepEqual(frame.need.action, {
      label: "Reopen the review",
      anchor: REVIEW_REOPEN_ANCHOR,
    });
    assert.doesNotMatch(frame.need.detail, /coverage assessment/i);
  });

  it("asks the reviewer to record coverage for a coverage gap, landing on its form", () => {
    const { frame } = reviewStep(
      signed({ reason: GAP, clears: "coverage", viewerActs: true }),
    );
    assert.equal(frame.need.kind, "act");
    assert.equal(frame.need.title, GAP);
    assert.deepEqual(frame.need.action, {
      label: "Record coverage",
      anchor: REVIEW_COVERAGE_ANCHOR,
    });
  });

  it("tells anyone else it waits on the reviewer, with no action", () => {
    const { frame } = reviewStep(
      signed({ reason: CHANGED, clears: "reopen", viewerActs: false }),
    );
    assert.equal(frame.need.kind, "wait");
    assert.equal(frame.need.title, REVIEW_OUTSTANDING);
    assert.equal(frame.need.action, undefined);
    assert.equal(
      quietLineOf(frame.need)?.text,
      `${CHANGED}. The reviewer reopens the review and signs it again on the current records.`,
    );
  });
});

describe("the hold on the control's own signed review", () => {
  const base = {
    signed: true,
    held: "",
    gap: "",
    review: viewer,
    canAct: true,
  };

  it("is none for a review not signed, or one nothing holds", () => {
    assert.equal(reviewHoldOf({ ...base, signed: false, held: CHANGED }), null);
    assert.equal(reviewHoldOf(base), null);
  });

  it("is cleared by reopening where a coverage assessment cannot clear it, first", () => {
    assert.deepEqual(reviewHoldOf({ ...base, held: CHANGED, gap: GAP }), {
      reason: CHANGED,
      clears: "reopen",
      viewerActs: true,
    });
  });

  it("is cleared by a coverage assessment for a gap alone", () => {
    assert.deepEqual(reviewHoldOf({ ...base, gap: GAP }), {
      reason: GAP,
      clears: "coverage",
      viewerActs: true,
    });
  });

  it("is the viewer's to act on only as the forms allow", () => {
    // Not the reviewer, or no write access: neither form is offered.
    for (const hold of [
      reviewHoldOf({
        ...base,
        held: CHANGED,
        review: { ...viewer, viewerIsReviewer: false },
      }),
      reviewHoldOf({ ...base, held: CHANGED, canAct: false }),
      reviewHoldOf({ ...base, held: CHANGED, review: null }),
      // The preparer may not assess coverage where independence is required.
      reviewHoldOf({
        ...base,
        gap: GAP,
        review: { ...viewer, viewerPrepared: true },
      }),
    ]) {
      assert.equal(hold?.viewerActs, false);
    }
  });
});
