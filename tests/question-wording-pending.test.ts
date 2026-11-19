import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ContextIssue } from "../apps/web/src/control-context-model.ts";
import {
  agentQuestions,
  type SetupIssue,
} from "../apps/web/src/control-setup-model.ts";
import {
  checkingLine,
  parseReview,
} from "../apps/web/src/understanding-chat-model.ts";

// Product owner, 14 November 2026: "The questions being raised by the agent are not very
// clear and not easy to understand." ITGC-AC-02's planner raised a two-part question with
// paragraphs for answers at 06:39:51; the reviewer agent rewrote it into three one-click steps
// at 06:40:20, and the screen showed the draft in between. A draft the reviewer is still
// checking (wording_pending, from the server) is never shown; the screen says one is coming.

const issue = (over: Partial<SetupIssue>): SetupIssue => ({
  id: "i1",
  origin: "ATTRIBUTES",
  kind: "MISSING",
  topic: "Termination date source for contractor and non-employee leavers",
  detail: "The sources do not say which record gives their termination date.",
  why: "The test needs their leaving date.",
  quotes: [],
  status: "OPEN",
  version: 1,
  question:
    "Which record gives the leaving date for contractor and other non-employee leavers, and are their accounts disabled in Workday?",
  suggestions: [],
  proposal: "The sponsor's ticket gives the leaving date for each contractor.",
  proposalBasis: "TYPICAL",
  raisedBy: "AGENT",
  wordingReviewed: false,
  ...over,
});

describe("an agent's question the reviewer agent is still checking", () => {
  it("is not asked until it is checked", () => {
    assert.deepEqual(agentQuestions([issue({ wordingPending: true })]), []);
    const [shown] = agentQuestions([
      issue({ wordingPending: false, wordingReviewed: true }),
    ]);
    assert.equal(shown?.unchecked, false);
  });

  it("one the reviewer could not clear is shown, said to be unchecked", () => {
    const [shown] = agentQuestions([issue({ wordingPending: false })]);
    assert.equal(shown?.unchecked, true);
  });

  it("an answer given in this visit stays shown, whatever the records say", () => {
    const [shown] = agentQuestions([issue({ wordingPending: true })], {
      i1: "Sponsor's ticket",
    });
    assert.equal(shown?.source, "RECORDED");
  });

  // Rewritten for B1j (16 November 2026; docs/control-workflow-plan.md):
  // - Old expectation: the Attributes step's banner (openAttributeQuestionsLine) left out a
  //   question whose wording was still being checked, and named the others.
  // - New expectation: the Attributes step names no agent question at all, checked or not: the
  //   banner that sent the person back to Control Understanding is gone, so a draft the
  //   reviewer agent is still checking is never shown there either.
  // - Methodology: the draft wording stays unseen until reviewed (14 November 2026), and the
  //   understanding is asked once, in Control Understanding.
  it("is not named on the Attributes step either", () => {
    const pending: Pick<
      ContextIssue,
      "origin" | "status" | "topic" | "raisedBy" | "wordingPending"
    > = {
      origin: "ATTRIBUTES",
      status: "OPEN",
      topic: "Termination date source",
      raisedBy: "AGENT",
      wordingPending: true,
    };
    // Still left out of the course until checked.
    assert.deepEqual(
      agentQuestions([{ ...issue({}), ...pending, id: "i2" }]),
      [],
    );
    const panel = readFileSync(
      new URL("../apps/web/src/control-context-view.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(panel, /openAttributeQuestionsLine|OpenQuestionsNote/);
    assert.doesNotMatch(panel, new RegExp(pending.topic));
  });

  it("Control Understanding says one is coming, and reads again until it is", () => {
    const body = {
      control_ref: "ITGC-AC-02",
      system: "Workday",
      other_systems: [],
      statement: [{ text: "HR records each termination.", key: null }],
      needs: [],
      evidence: { ready: false, missing: [] },
      attributes: { ready: true, missing: [] },
      attributes_approved: 4,
      attributes_proposed: 0,
      questions_checking: 1,
    };
    assert.equal(parseReview(body)?.questionsChecking, 1);
    assert.equal(
      parseReview({ ...body, questions_checking: -2 })?.questionsChecking,
      0,
    );
    assert.equal(
      parseReview({ ...body, questions_checking: undefined })
        ?.questionsChecking,
      0,
    );
    // Reworded 18 November 2026 (design review). Old: "It appears here once it reads
    // clearly." New: when the check is complete.
    assert.equal(
      checkingLine(1),
      "The reviewer agent is checking the wording of a new question. It will appear here when the check is complete.",
    );
    assert.match(
      checkingLine(2),
      /^The reviewer agent is checking .* 2 new questions\./,
    );
    const view = readFileSync(
      new URL("../apps/web/src/understanding-review.tsx", import.meta.url),
      "utf8",
    );
    // 18 November 2026 (design review): the line is said in the header's live region, and
    // shown below the progress until the understanding is complete (then in its lede).
    assert.match(view, /checkingNow > 0\s*\?\s*checkingLine\(checkingNow\)/);
    assert.match(view, /checkingNow > 0 && !complete \?/);
    assert.match(
      view,
      /window\.setTimeout\(\(\) => \{\s*void read\(\);\s*\}, 4000\)/,
    );
  });
});
