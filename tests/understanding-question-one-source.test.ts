import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  agentQuestions,
  PREPARING_QUESTION,
  questionState,
  type SetupIssue,
} from "../apps/web/src/control-setup-model.ts";
import {
  chatEnd,
  checkingLine,
  parseReview,
  questionIssues,
  REVIEW_UNREAD,
  readReview,
} from "../apps/web/src/understanding-chat-model.ts";

// Product owner, 18 November 2026, on ITGC-AC-03: the specialist review's question showed as
// "Answer with the planner", and the planner's conversation said "Every point is on record."
// without asking it. Cause: the pane read the question from the page's list of issues, read
// at another time than the review's needs; that list still held the question as being worded,
// so the inline interview was skipped. Now the need carries its question (NeedBody.issue) and
// the pane and the conversation ask it from that one source.

const REVIEWED = [
  {
    key: "s1",
    question: "Who signs off the review of the owner's own access?",
    why: "Names who signs the review of the owner's own access.",
    usual: "IT Security Manager",
    basis: "TYPICAL",
    answers: [
      {
        label: "IT Security Manager",
        says: "The IT Security Manager signs off the review of the owner's own access.",
        next: "",
      },
      {
        label: "System administrator",
        says: "The System administrator signs off the review of the owner's own access.",
        next: "",
      },
    ],
  },
];

const issue = (over: Partial<SetupIssue> = {}): SetupIssue => ({
  id: "q-own-access",
  origin: "ATTRIBUTES",
  kind: "MISSING",
  topic: "Reviewer of the owner's own access",
  detail: "Who signs off the review of the owner's own access?",
  why: "Names who signs the review of the owner's own access.",
  quotes: [],
  status: "OPEN",
  version: 2,
  question: "Who signs off the review of the owner's own access?",
  suggestions: [
    "The System administrator signs off the review of the owner's own access.",
  ],
  proposal:
    "The IT Security Manager signs off the review of the owner's own access.",
  proposalBasis: "TYPICAL",
  raisedBy: "AGENT",
  wordingReviewed: true,
  wordingPending: false,
  interview: REVIEWED,
  fromReview: true,
  blocks: "The A2 criterion cannot be written without naming that reviewer.",
  ...over,
});

const need = (carried: Record<string, unknown> | null) => ({
  key: "q-own-access",
  kind: "QUESTION",
  label: "Reviewer of the owner's own access",
  question: "Who signs off the review of the owner's own access?",
  value: "",
  options: [],
  why: "",
  status: "MISSING",
  source: "AGENT",
  needed_for: ["EVIDENCE", "ATTRIBUTES"],
  ...(carried === null ? {} : { issue: carried }),
});

const raw = {
  id: "q-own-access",
  origin: "ATTRIBUTES",
  kind: "MISSING",
  topic: "Reviewer of the owner's own access",
  detail: "Who signs off the review of the owner's own access?",
  why: "Names who signs the review of the owner's own access.",
  resolve: "",
  quotes: [],
  raised_by: "AGENT",
  status: "OPEN",
  resolution_note: "",
  version: 2,
  question: "Who signs off the review of the owner's own access?",
  suggestions: [
    "The System administrator signs off the review of the owner's own access.",
  ],
  proposal:
    "The IT Security Manager signs off the review of the owner's own access.",
  proposal_basis: "TYPICAL",
  wording_reviewed: true,
  wording_pending: false,
  interview: REVIEWED,
  from_review: true,
  review_round: 1,
  blocks: "The A2 criterion cannot be written without naming that reviewer.",
};

const body = (needs: unknown[]) => ({
  control_ref: "ITGC-AC-03",
  system: "BlackLine",
  other_systems: [],
  statement: [],
  needs,
  evidence: { ready: true, missing: [] },
  attributes: { ready: true, missing: [] },
});

const review = (needs: unknown[]) => parseReview(body(needs));

describe("an agents' question in Control Understanding, from one source", () => {
  it("is asked in place from the question its need carries, as its reviewed interview", () => {
    const [read] = review([need(raw)])?.needs ?? [];
    assert.ok(read !== undefined);
    const asking = questionState(read);
    assert.equal(asking.state, "inline");
    if (asking.state !== "inline") {
      return;
    }
    assert.equal(asking.issue.version, 2);
    assert.deepEqual(asking.row.steps, REVIEWED);
    assert.equal(asking.row.issue?.id, "q-own-access");
  });

  it("whatever the page's own list of issues says: the need alone decides", () => {
    // The ITGC-AC-03 state: the page's list still held the question as being worded.
    const stalePage = [issue({ wordingPending: true, wordingReviewed: false })];
    assert.deepEqual(agentQuestions(stalePage), []);
    const [read] = review([need(raw)])?.needs ?? [];
    assert.ok(read !== undefined);
    assert.equal(questionState(read).state, "inline");
  });

  it("says it is being prepared while its question is not ready, never another screen", () => {
    const [bare] = review([need(null)])?.needs ?? [];
    assert.ok(bare !== undefined);
    assert.equal(questionState(bare).state, "preparing");
    const [pending] =
      review([need({ ...raw, wording_pending: true, wording_reviewed: false })])
        ?.needs ?? [];
    assert.ok(pending !== undefined);
    assert.equal(questionState(pending).state, "preparing");
    assert.match(PREPARING_QUESTION, /^Preparing the question\./);
  });

  it("the pane never hands a question to the planner, and reads it from the need", () => {
    const view = readFileSync(
      new URL("../apps/web/src/understanding-review.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(!view.includes("Answer with the planner"));
    assert.ok(!view.includes("The planner asks it as a short interview"));
    assert.match(view, /questionState\(need\)/);
    assert.ok(
      !/issues\.(find|filter)\(\(issue\) => issue\.id === need\.key/.test(view),
    );
    assert.match(view, /<PreparingQuestion/);
  });
});

describe("the planner's conversation", () => {
  it("asks the agents' questions the review's needs carry, the same records", () => {
    const found = review([need(raw)]);
    assert.ok(found !== null);
    const asked = questionIssues(found);
    assert.deepEqual(
      asked.map((item) => [item.id, item.status]),
      [["q-own-access", "OPEN"]],
    );
    assert.equal(agentQuestions(asked)[0]?.steps?.length, 1);
    // Answered meanwhile: gone from the next read, kept settled for the summary, never asked
    // again.
    const later = questionIssues(review([]) ?? found, asked);
    assert.deepEqual(
      later.map((item) => [item.id, item.status]),
      [["q-own-access", "RESOLVED"]],
    );
    assert.deepEqual(agentQuestions(later), []);
    assert.equal(
      agentQuestions(later, { "q-own-access": "The IT Security Manager." })
        .length,
      1,
    );
  });

  it('says "Every point is on record." only once the review was read with nothing left', () => {
    assert.equal(chatEnd(false, null), "Reading the points on record…");
    assert.equal(chatEnd(false, { checking: 2 }), checkingLine(2));
    assert.equal(chatEnd(false, { checking: 0 }), "Every point is on record.");
    assert.equal(
      chatEnd(true, null),
      "Recorded. The understanding is confirmed.",
    );
    const chat = readFileSync(
      new URL("../apps/web/src/control-setup.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(!chat.includes('"Every point is on record."'));
    assert.match(chat, /chatEnd\(finished, asked\)/);
    assert.match(chat, /questionIssues\(found/);
    assert.match(chat, /intent: "review"/);
  });

  it("says the review could not be read, with Try again, never reading forever", () => {
    // Review finding N3 (18 November 2026): the read ignored a failed response and swallowed
    // errors, so a failure left "Reading the points on record…" on screen for good.
    assert.equal(readReview(false, null), null);
    assert.equal(
      readReview(true, { status: 503, detail: "", body: null }),
      null,
    );
    assert.equal(readReview(true, { status: 0, detail: "", body: null }), null);
    assert.equal(readReview(true, null), null);
    assert.equal(
      readReview(true, { status: 200, body: "not the review" }),
      null,
    );
    assert.deepEqual(
      readReview(true, { status: 200, detail: "", body: body([need(raw)]) }),
      review([need(raw)]),
    );
    const chat = readFileSync(
      new URL("../apps/web/src/control-setup.tsx", import.meta.url),
      "utf8",
    );
    const effect = chat.slice(
      chat.indexOf('intent: "review"'),
      chat.indexOf("const offer = conversation === null"),
    );
    assert.ok(effect.length > 0);
    assert.match(effect, /readReview\(response\.ok/);
    assert.ok(!effect.includes(".catch(() => undefined)"));
    assert.match(effect, /setReadFailed\(true\)/);
    assert.match(effect, /if \(!alive\)/);
    assert.match(chat, /\{REVIEW_UNREAD\}/);
    assert.match(chat, /setRereads\(\(count\) => count \+ 1\)/);
    assert.equal(REVIEW_UNREAD, "The points on record could not be read.");
  });
});
