import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptAllRows,
  acceptItems,
  CONFLICT_HOLDS,
  contextProblem,
  contextWrite,
  criteriaToAccept,
  heldRow,
  NOT_KNOWN_NOTE_MAX,
  notKnownNoteProblem,
  parseAssumption,
  parseContext,
  parseQuestionReview,
  unifiedRows,
} from "../apps/web/src/control-context-model.ts";
import {
  type WorkflowInput,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";
import {
  POINT_KINDS,
  pointsOf,
  SETTLE_ACTIONS,
  SETTLE_WHERE,
  SETTLE_WORDS,
  settleHref,
  settleWhere,
} from "../apps/web/src/design-points-model.ts";
import {
  ADDED_FOR_ATTRIBUTES,
  decidedLine,
  offersAttributes,
  raisedChip,
  readsAgain,
  understandingEnd,
} from "../apps/web/src/understanding-once-model.ts";
import {
  acceptAllNote,
  acceptAllWords,
  askedAttributeChip,
  assumptionLead,
  assumptionText,
  blocksLine,
  CONFLICT_STANDS,
  changePrompt,
  changeWords,
  confirmWords,
  courseWithout,
  FAILURE_FALLBACK,
  FROM_REVIEW,
  fromReview,
  heldByFailedReview,
  markedParts,
  NOT_KNOWN_ACTION,
  NOT_KNOWN_LEAD,
  notKnownKeys,
  notKnownProblem,
  notReviewedLine,
  offersNotKnown,
  offersReviewAgain,
  REVIEW_BY,
  REVIEW_CHECKING,
  REVIEW_FAILED,
  REVIEW_FAILED_STATUS,
  REVIEW_TITLE,
  reviewChoiceLine,
  reviewedLead,
  reviewProblem,
  reviewView,
  unconfirmedWith,
  withoutNotKnown,
} from "../apps/web/src/understanding-specialist-model.ts";

// B1k and B1l (docs/control-workflow-plan.md; product owner, 16 November 2026): "When I say it
// audit specialist, i meant an agent that reviews all the questions asked. Its good to keep the
// review ... in a narrarive format"; "any follow up needed are all asked at the end if those
// are flagged?"; and to the hardening: "Okay please proceed." Approved prototype
// brief-proto/ureview2.png. Synthetic data only.

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const CONTROL = "01a13300-0000-7000-8000-000000000002";
const ISSUE = "01a13300-0000-7000-8000-0000000000e1";
const PARENT = "01a13300-0000-7000-8000-0000000000e0";
const REVIEW = "01a13300-0000-7000-8000-0000000000f1";
const ATTR_A = "01a13300-0000-7000-8000-00000000000a";
const ATTR_C = "01a13300-0000-7000-8000-00000000000c";
const ATTR_D = "01a13300-0000-7000-8000-00000000000d";
const IDS = { organization_id: ORG, project_id: PROJECT, control_id: CONTROL };
const BASE = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}`;
const REVIEWED = "2026-11-16T16:20:00Z";

const NARRATIVE =
  "The fourteen questions answered establish how a patch is raised, tested and approved. They do not yet establish who applies patches to production, or how each patch in the history is linked to its change record, and attributes A, C and D depend on each of them. These are asked now.";

const ready = {
  id: REVIEW,
  status: "READY",
  round: 1,
  narrative: NARRATIVE,
  marked: [
    "who applies patches to production",
    "how each patch in the history is linked to its change record",
    "a matter the narrative does not say",
  ],
  not_reviewed: ["B"],
  open_questions: 2,
  reviewed_at: REVIEWED,
  failure: "",
};

const assumption = (over: Record<string, unknown> = {}) => ({
  id: "01a13300-0000-7000-8000-0000000000a1",
  matter: "patch to change record link",
  assumed: "A patch is linked to its change record by patch and host.",
  status: "OPEN",
  answer: "",
  decided_by: null,
  decided_at: null,
  attribute_codes: ["A"],
  version: 1,
  ...over,
});

const toAccept = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "APPROVED",
  version: 2,
  condition: "Each patch in the period",
  pass_criteria: "Approved before it was applied",
  fail_criteria: "Applied without approval",
  criteria_origin: "AGENT",
  ...over,
});

describe("the context's B1k and B1l fields, read strictly", () => {
  it("reads the review, the failed pass, the review's questions, the kinds and the held attribute", () => {
    const context = parseContext({
      control_id: CONTROL,
      question_pass: "FAILED",
      review: ready,
      issues: [
        {
          id: ISSUE,
          origin: "ATTRIBUTES",
          kind: "MISSING",
          topic: "Who applies patches",
          raised_by: "AGENT",
          status: "OPEN",
          version: 1,
          question: "Who applies patches to production?",
          from_review: true,
          review_round: 2,
          asks: {
            attribute_code: "D",
            fact: "PERFORMER",
            parent_issue_id: PARENT,
          },
          blocks:
            "Attribute D tests that the approver is not the administrator who applied the patch.",
        },
        {
          id: PARENT,
          topic: "Emergency patches",
          raised_by: "AGENT",
          status: "NOT_KNOWN",
          version: 2,
        },
      ],
      attributes: {
        approved: [
          toAccept(ATTR_A, {
            held_by_conflict: true,
            assumptions: [
              assumption({ kind: "CONFLICT" }),
              assumption({
                id: "01a13300-0000-7000-8000-0000000000a3",
                kind: "NOT_KNOWN",
              }),
            ],
          }),
        ],
      },
    });
    assert.equal(context?.questionPass, "FAILED");
    assert.equal(context?.questionReview?.status, "READY");
    assert.equal(context?.questionReview?.round, 1);
    assert.equal(context?.questionReview?.narrative, NARRATIVE);
    // A marked part the narrative does not hold word for word is never marked.
    assert.deepEqual(context?.questionReview?.marked, ready.marked.slice(0, 2));
    assert.deepEqual(context?.questionReview?.notReviewed, ["B"]);
    assert.equal(context?.questionReview?.openQuestions, 2);
    assert.equal(context?.questionReview?.reviewedAt, REVIEWED);
    const [asked, parent] = context?.issues ?? [];
    assert.equal(asked?.fromReview, true);
    assert.equal(asked?.reviewRound, 2);
    assert.deepEqual(asked?.asks, {
      attributeCode: "D",
      fact: "PERFORMER",
      parentIssueId: PARENT,
    });
    assert.match(asked?.blocks ?? "", /^Attribute D tests/);
    // Not known is its own status: never read as OPEN, never as an answer.
    assert.equal(parent?.status, "NOT_KNOWN");
    const [held] = context?.approved ?? [];
    assert.equal(held?.heldByConflict, true);
    assert.deepEqual(
      held?.assumptions?.map((item) => item.kind),
      ["CONFLICT", "NOT_KNOWN"],
    );
  });

  it("reads a body from before B1k as saying nothing of it", () => {
    const context = parseContext({
      control_id: CONTROL,
      question_pass: "DONE",
      issues: [{ id: ISSUE, status: "OPEN", raised_by: "AGENT", version: 1 }],
      attributes: {
        approved: [toAccept(ATTR_A, { assumptions: [assumption()] })],
      },
    });
    assert.equal(context?.questionReview, null);
    const [issue] = context?.issues ?? [];
    assert.equal(issue?.fromReview, false);
    assert.equal(issue?.reviewRound, null);
    assert.deepEqual(issue?.asks, {
      attributeCode: null,
      fact: null,
      parentIssueId: null,
    });
    assert.equal(issue?.blocks, "");
    assert.equal(context?.approved[0]?.heldByConflict, false);
    assert.equal(context?.approved[0]?.assumptions?.[0]?.kind, "ASSUMPTION");
  });

  it("never reads an unknown kind, fact, round or a question not from the review as one", () => {
    assert.equal(parseAssumption(assumption({ kind: "GUESS" })), null);
    const context = parseContext({
      control_id: CONTROL,
      issues: [
        {
          id: ISSUE,
          status: "OPEN",
          version: 1,
          from_review: "yes",
          review_round: 2,
          asks: {
            attribute_code: "D; drop",
            fact: "WHO",
            parent_issue_id: "x",
          },
          blocks: "x".repeat(401),
        },
      ],
    });
    const [issue] = context?.issues ?? [];
    assert.equal(issue?.fromReview, false);
    assert.equal(issue?.reviewRound, null);
    assert.deepEqual(issue?.asks, {
      attributeCode: null,
      fact: null,
      parentIssueId: null,
    });
    assert.equal(issue?.blocks, "");
  });
});

describe("the review, read strictly", () => {
  it("is null when its id, status or round is not one this page knows", () => {
    assert.equal(parseQuestionReview(null), null);
    assert.equal(parseQuestionReview({ ...ready, status: "DONE" }), null);
    assert.equal(parseQuestionReview({ ...ready, round: 3 }), null);
    assert.equal(parseQuestionReview({ ...ready, id: "" }), null);
    // READY with no paragraph is not shown as reviewed.
    assert.equal(parseQuestionReview({ ...ready, narrative: "  " }), null);
  });

  it("shows a paragraph only when READY, only whole, and a failure only when FAILED", () => {
    const pending = parseQuestionReview({
      ...ready,
      status: "PENDING",
      failure: "Should not show.",
    });
    assert.equal(pending?.narrative, "");
    assert.deepEqual(pending?.marked, []);
    assert.equal(pending?.failure, "");
    const failed = parseQuestionReview({
      ...ready,
      status: "FAILED",
      failure: "The specialist's answer did not have the required shape.",
    });
    assert.equal(failed?.narrative, "");
    assert.equal(
      failed?.failure,
      "The specialist's answer did not have the required shape.",
    );
    // A paragraph well over the 150 words the server allows is not cut into shape: not shown.
    const long = Array.from({ length: 200 }, () => "word").join(" ");
    assert.equal(parseQuestionReview({ ...ready, narrative: long }), null);
    assert.equal(
      parseQuestionReview({ ...ready, open_questions: -1 })?.openQuestions,
      0,
    );
    assert.equal(
      parseQuestionReview({ ...ready, reviewed_at: "soon" })?.reviewedAt,
      null,
    );
  });
});

describe("the review's place in Control Understanding", () => {
  const review = parseQuestionReview(ready);
  const settled = parseQuestionReview({ ...ready, open_questions: 0 });

  it("names the specialist and the review as the prototype does", () => {
    assert.equal(REVIEW_TITLE, "Review of the questions asked");
    assert.equal(REVIEW_BY, "IT audit specialist");
    assert.equal(FROM_REVIEW, "From the review · for the attributes");
    assert.equal(REVIEW_CHECKING, "Checking what else the agents need…");
    assert.equal(REVIEW_FAILED, "The review could not run");
  });

  it("is checking while the specialist reads, failed when its answer could not be used", () => {
    // Rewritten (B1l review fixes, 16 November 2026: the last good review is kept shown
    // while a read runs). Old: { state: "checking" }. New: the same, with `last`, the READY
    // review still shown (null where there is none).
    assert.deepEqual(reviewView("CHECKING", review), {
      state: "checking",
      last: review,
    });
    assert.deepEqual(
      reviewView(
        "WAITING",
        parseQuestionReview({ ...ready, status: "PENDING" }),
      ),
      { state: "checking", last: null },
    );
    assert.deepEqual(
      reviewView(
        "FAILED",
        parseQuestionReview({
          ...ready,
          status: "FAILED",
          failure: "The specialist's answer could not be used.",
        }),
      ),
      {
        state: "failed",
        failure: "The specialist's answer could not be used.",
      },
    );
    // A failed pass with no sentence of its own still says one. Rewritten (final design
    // review, 19 November 2026, N3). Old: "The specialist's answer could not be used.". New:
    // the server's sentence for that kind, without its lead.
    assert.equal(
      (reviewView("FAILED", null) as { failure: string }).failure,
      "The IT audit specialist's review could not be completed.",
    );
    assert.deepEqual(reviewView(null, null), { state: "none" });
  });

  it("shows the paragraph with its matters marked, then 'Reviewed <when>: …' once nothing is left", () => {
    const shown = reviewView("DONE", review);
    assert.equal(shown.state, "ready");
    assert.equal(shown.state === "ready" && shown.settled, false);
    const done = reviewView("DONE", settled, true);
    assert.equal(done.state === "ready" && done.settled, true);
    assert.equal(reviewedLead(REVIEWED, "UTC"), "Reviewed Nov 16, 4:20 PM: ");
    assert.equal(reviewedLead(null), "Reviewed: ");
  });

  it("marks each matter once, in the narrative's order, and nothing the narrative does not say", () => {
    const parts = markedParts(NARRATIVE, [
      "how each patch in the history is linked to its change record",
      "who applies patches to production",
      "who applies patches",
      "not in the text",
    ]);
    assert.equal(parts.map((part) => part.text).join(""), NARRATIVE);
    assert.deepEqual(
      parts.filter((part) => part.marked).map((part) => part.text),
      [
        "who applies patches to production",
        "how each patch in the history is linked to its change record",
      ],
    );
    assert.deepEqual(markedParts("Plain.", []), [
      { text: "Plain.", marked: false },
    ]);
  });

  it("names the attributes not reviewed in one quiet line", () => {
    // Rewritten (B1l review fixes, 16 November 2026: the line named attributes by a key the
    // page does not use, "Attribute A2" or "Attribute cm06-approved"). Old: the codes were
    // shown as given (["B"] read "Attribute B ..."). New: each code, library definition key
    // or id is read back to the letter the Attributes step shows; one the page cannot place
    // is counted, never shown as a code.
    const approved = [
      { id: "a-1", code: "A1", definition: null },
      { id: "a-2", code: "A2", definition: null },
      { id: "a-3", code: "", definition: { key: "cm06-approved" } as never },
      { id: "a-4", code: "A4", definition: null },
      { id: "a-5", code: "A5", definition: null },
    ];
    assert.equal(notReviewedLine([], approved), null);
    assert.equal(
      notReviewedLine(["A2"], approved),
      "Attribute B was not reviewed; the agent states its assumptions on it.",
    );
    assert.equal(
      notReviewedLine(["A2", "cm06-approved", "A5"], approved),
      "Attributes B, C and E were not reviewed; the agent states its assumptions on them.",
    );
    assert.equal(
      notReviewedLine(["A9"], approved),
      "One attribute was not reviewed; the agent states its assumptions on it.",
    );
    assert.equal(
      notReviewedLine(["A1", "A9", "zz"], approved),
      "Attribute A was not reviewed; the agent states its assumptions on it. 2 more attributes were not reviewed; the agent states its assumptions on them.",
    );
    // A control with no attributes yet: the review's units are kinds of fact.
    assert.equal(
      notReviewedLine(["PERFORMER", "APPROVER"]),
      "Not reviewed: who performs it and who approves it; the agent states its assumptions on the attributes.",
    );
    // Never a code on screen.
    assert.doesNotMatch(
      notReviewedLine(["A2", "cm06-approved", "A9"], approved) ?? "",
      /A2|A9|cm06/,
    );
  });

  it("offers Review again only to a person who may act, once complete, and not while it runs", () => {
    assert.equal(offersReviewAgain(REVIEWED, "DONE", true), true);
    assert.equal(offersReviewAgain(REVIEWED, "CHECKING", true), false);
    assert.equal(offersReviewAgain(null, "DONE", true), false);
    assert.equal(offersReviewAgain(REVIEWED, "DONE", false), false);
  });

  it("labels the review's questions in the same course, with what they block", () => {
    const fromTheReview = {
      raisedBy: "AGENT",
      origin: "PROCESS",
      fromReview: true,
      blocks: " Attribute D tests that the approver is not the administrator. ",
    };
    assert.equal(raisedChip(fromTheReview), FROM_REVIEW);
    assert.equal(fromReview(fromTheReview), true);
    assert.equal(
      blocksLine(fromTheReview),
      "Attribute D tests that the approver is not the administrator.",
    );
    // B1j's labels are as they were for other questions.
    assert.equal(
      raisedChip({ raisedBy: "AGENT", origin: "ATTRIBUTES" }),
      ADDED_FOR_ATTRIBUTES,
    );
    assert.equal(
      raisedChip({ raisedBy: "RULES", origin: "SOURCES" }),
      "Raised by the rules",
    );
    assert.equal(blocksLine(undefined), "");
  });
});

describe("Not known yet, proceed", () => {
  it("is offered on every question waiting on a person, to someone who may act", () => {
    assert.equal(NOT_KNOWN_ACTION, "Not known yet, proceed");
    assert.equal(offersNotKnown({ status: "OPEN" }, true), true);
    assert.equal(offersNotKnown({ status: "OPEN" }, false), false);
    assert.equal(offersNotKnown({ status: "NOT_KNOWN" }, true), false);
    assert.equal(offersNotKnown({ status: "RESOLVED" }, true), false);
    assert.equal(offersNotKnown(undefined, true), false);
  });

  it("is sent with an optional note of up to 500 characters, at the version read", () => {
    const write = contextWrite({
      ...IDS,
      intent: "issue-not-known",
      issue_id: ISSUE,
      version: 3,
      note: "  The vendor is to confirm.  ",
    });
    assert.deepEqual(write, {
      intent: "issue-not-known",
      method: "POST",
      path: `${BASE}/issues/${ISSUE}/not-known`,
      body: { note: "The vendor is to confirm.", version: 3 },
      slow: false,
    });
    // No note is fine.
    assert.deepEqual(
      (
        contextWrite({
          ...IDS,
          intent: "issue-not-known",
          issue_id: ISSUE,
          version: 1,
        }) as { body: unknown }
      ).body,
      { note: "", version: 1 },
    );
    for (const bad of [
      { note: "x".repeat(NOT_KNOWN_NOTE_MAX + 1), version: 1 },
      { note: "password=hunter2hunter2", version: 1 },
      { note: "", version: 0 },
      { note: "", version: 1, issue_id: "not-an-id" },
    ]) {
      assert.deepEqual(
        contextWrite({
          ...IDS,
          intent: "issue-not-known",
          issue_id: ISSUE,
          ...bad,
        }),
        { error: "invalid" },
        JSON.stringify(bad).slice(0, 60),
      );
    }
    assert.equal(notKnownNoteProblem(""), null);
    assert.match(notKnownNoteProblem("x".repeat(501)) ?? "", /500/);
  });

  it("is done only once the server records it, and says the server's sentence otherwise", () => {
    assert.equal(notKnownProblem(200), null);
    assert.equal(
      notKnownProblem(409, "The question was answered meanwhile."),
      "The question was answered meanwhile.",
    );
    assert.equal(
      notKnownProblem(409, "issue changed"),
      "The question changed while you were working. Refresh and try again.",
    );
    assert.match(notKnownProblem(422) ?? "", /500 characters/);
    assert.equal(notKnownProblem(0), contextProblem(0));
  });

  it("leaves the course and is never on record, for this visit and for the page's data", () => {
    const keys = notKnownKeys(
      [
        { id: "q-1", status: "NOT_KNOWN" },
        { id: "q-2", status: "OPEN" },
      ],
      new Set(["q-3"]),
    );
    assert.deepEqual([...keys].sort(), ["q-1", "q-3"]);
    const review = {
      needs: [
        { key: "q-1", kind: "QUESTION" },
        { key: "q-2", kind: "QUESTION" },
        { key: "q-3", kind: "QUESTION" },
        // Rewritten (B1l review fixes, product owner 16 November 2026: "Not known yet,
        // proceed" covers required walkthrough questions and statement values as well).
        // Old: only a question was ever closed so, and a value keyed the same was kept.
        // New: a value or a walkthrough question closed so leaves too; a document, the
        // process or the sign-in settings are never closed so.
        { key: "q-3", kind: "ANSWER" },
        { key: "q-3", kind: "DOCUMENT" },
      ],
      controlRef: "ITGC-CM-06",
    };
    const left = withoutNotKnown(review, keys);
    assert.deepEqual(left.needs, [
      { key: "q-2", kind: "QUESTION" },
      { key: "q-3", kind: "DOCUMENT" },
    ]);
    assert.equal(left.controlRef, "ITGC-CM-06");
    assert.equal(withoutNotKnown(review, new Set()), review);
  });

  it("is neither confirmed nor still to answer in the header's count", () => {
    const course = {
      plan: ["q-1", "q-2", "@carried"],
      carried: ["q-1", "v-1"],
      at: 0,
    };
    assert.deepEqual(courseWithout(course, new Set(["q-1"])), {
      plan: ["q-2", "@carried"],
      carried: ["v-1"],
      at: 0,
    });
    assert.equal(courseWithout(course, new Set()), course);
  });
});

describe("a review that could not run never blocks", () => {
  it("routes Run again and Proceed without it, each a person's request", () => {
    assert.deepEqual(contextWrite({ ...IDS, intent: "review-run" }), {
      intent: "review-run",
      method: "POST",
      path: `${BASE}/understanding/review/run`,
      body: {},
      slow: false,
    });
    // Rewritten 18 November 2026 (owner decision, "Completion waits for a person"). Old:
    // body {}. New: the person's reason, needed to proceed past attributes the review did
    // not review and empty after a review that could not run (tests/understanding-review-
    // held.test.ts).
    assert.deepEqual(contextWrite({ ...IDS, intent: "review-proceed" }), {
      intent: "review-proceed",
      method: "POST",
      path: `${BASE}/understanding/review/proceed`,
      body: { reason: "" },
      slow: false,
    });
  });

  it("takes 202 as a review accepted to run, and 200 as a proceed recorded", () => {
    assert.equal(reviewProblem("review-run", 202), null);
    assert.equal(reviewProblem("review-proceed", 200), null);
    assert.notEqual(reviewProblem("review-proceed", 202), null);
    assert.equal(
      reviewProblem("review-run", 409, "A review is already running."),
      "A review is already running.",
    );
    assert.match(
      reviewProblem("review-proceed", 409) ?? "",
      /no longer failed/,
    );
    assert.equal(reviewProblem("review-run", 403), contextProblem(403));
  });

  it("reads the course's end as failed, with no way on and no reading again", () => {
    const once = { completedAt: null, questionPass: "FAILED" as const };
    assert.equal(understandingEnd(once, true), "failed");
    assert.equal(understandingEnd(once, false), "failed");
    assert.equal(readsAgain(once, true), false);
    assert.equal(offersAttributes(once), false);
    // Complete wins, as B1j decided.
    assert.equal(
      understandingEnd({ completedAt: REVIEWED, questionPass: "FAILED" }, true),
      "complete",
    );
  });

  it("holds the attributes' readiness line until the person chooses", () => {
    const lines = [
      {
        key: "attributes" as const,
        ready: true,
        note: "Ready",
        text: "Attributes",
      },
      { key: "evidence" as const, ready: false, note: "After", text: "D&I" },
    ];
    assert.deepEqual(heldByFailedReview(lines, true), [
      // Rewritten (design review, 19 November 2026). Old: "Review to run or skip".
      { ...lines[0], ready: false, note: "Review to run again, or proceed" },
      lines[1],
    ]);
    assert.deepEqual(heldByFailedReview(lines, false), lines);
  });

  it("says so on the workflow node, and the attributes still wait", () => {
    const input: WorkflowInput = {
      details: ["Description", "Objective", "Frequency", "Owner", "Risk"].map(
        (label) => ({ label, filled: true }),
      ),
      setup: [
        {
          key: "answers",
          done: true,
          optional: false,
          mine: true,
          summary: "All 14 answered",
        },
      ],
      attributes: { approved: 4, proposed: 0, untailored: 0 },
      understanding: { completedAt: null, questionPass: "FAILED" },
      plan: { exists: false, approved: false, pendingReview: false },
      requirements: [],
      sheet: null,
      rounds: [],
      findings: [],
      reviewStatus: "",
      conclusion: "NOT_CONCLUDED",
      proposedConclusion: null,
      designPaper: null,
      designConclusion: null,
      effectivenessPaper: null,
      busy: new Set(),
    };
    const steps = workflowOf(input);
    const understanding = steps.find((item) => item.key === "understanding");
    assert.deepEqual(
      [understanding?.tone, understanding?.status],
      ["attention", REVIEW_FAILED_STATUS],
    );
    assert.ok(REVIEW_FAILED_STATUS.length <= 28);
    assert.equal(
      steps.find((item) => item.key === "attributes")?.status,
      "Waiting on understanding",
    );
  });
});

describe("the Attributes step: a conflict holds its attribute, and Accept all says what it does", () => {
  const context = parseContext({
    control_id: CONTROL,
    attributes: {
      approved: [
        toAccept(ATTR_A, {
          held_by_conflict: true,
          assumptions: [assumption({ kind: "CONFLICT" })],
        }),
        toAccept(ATTR_C, {
          assumptions: [
            assumption({ id: "01a13300-0000-7000-8000-0000000000c1" }),
            assumption({
              id: "01a13300-0000-7000-8000-0000000000c2",
              kind: "NOT_KNOWN",
            }),
          ],
        }),
        toAccept(ATTR_D, {
          assumptions: [
            assumption({ id: "01a13300-0000-7000-8000-0000000000d1" }),
            assumption({
              id: "01a13300-0000-7000-8000-0000000000d2",
              status: "CONFIRMED",
              decided_by: { id: PARENT, name: "Dana Lee" },
              decided_at: REVIEWED,
            }),
          ],
        }),
      ],
    },
  });
  assert.ok(context !== null);
  const rows = unifiedRows(context);

  it("leaves a held attribute out of Accept all, and out of what any acceptance sends", () => {
    assert.deepEqual(
      rows.map((row) => heldRow(row)),
      [true, false, false],
    );
    assert.deepEqual(
      acceptAllRows(rows).map((row) => row.item.id),
      [ATTR_C, ATTR_D],
    );
    assert.deepEqual(acceptItems(rows), [
      { attribute_id: ATTR_C, version: 2 },
      { attribute_id: ATTR_D, version: 2 },
    ]);
    // Accepting the held row alone sends nothing.
    assert.deepEqual(acceptItems(rows.slice(0, 1)), []);
    assert.deepEqual(
      criteriaToAccept(context).map((item) => item.id),
      [ATTR_C, ATTR_D],
    );
    // A rewording of a held attribute is held too.
    assert.equal(
      heldRow({
        item: { ...context.approved[1], heldByConflict: false } as never,
        target: context.approved[0] ?? null,
      }),
      true,
    );
  });

  it("says what it leaves out and how many assumptions go with it unconfirmed", () => {
    const accepted = acceptAllRows(rows);
    // C has two open (an assumption and a not known), D one open and one confirmed.
    assert.equal(unconfirmedWith(accepted), 3);
    const words = acceptAllWords(accepted, rows.length - accepted.length);
    // Rewritten 19 November 2026 (owner-approved Review attributes prototype). Old: "Accept
    // all 2" / "Accept all 1" with "includes N assumption(s) not confirmed". New: "Accept
    // all" before any row is reviewed, "Accept remaining n" after, and "N unconfirmed
    // assumption(s)" said beside it; what it leaves out is said as before (B1l point 6).
    assert.deepEqual(words, {
      label: "Accept all",
      leftOut: "1 left out: a conflict to decide",
      includes: "3 unconfirmed assumptions",
    });
    assert.equal(
      acceptAllNote(words),
      "1 left out: a conflict to decide · 3 unconfirmed assumptions",
    );
    assert.deepEqual(acceptAllWords(accepted.slice(1), 2, { reviewed: 1 }), {
      label: "Accept remaining 1",
      leftOut: "2 left out: conflicts to decide",
      includes: "1 unconfirmed assumption",
    });
    assert.equal(acceptAllNote(acceptAllWords([], 0)), "");
  });

  it("refuses a held attribute in the server's words, and reads each kind as itself", () => {
    assert.equal(
      CONFLICT_HOLDS,
      "A conflict on this attribute is to be decided first.",
    );
    assert.equal(contextProblem(409, CONFLICT_HOLDS), CONFLICT_HOLDS);
    assert.equal(assumptionLead("CONFLICT"), "A conflict to decide:");
    assert.equal(
      assumptionLead("NOT_KNOWN"),
      "Left as not known in Control Understanding:",
    );
    assert.equal(NOT_KNOWN_LEAD, "Left as not known in Control Understanding:");
    assert.equal(assumptionLead("ASSUMPTION"), "The agent assumed:");
    assert.equal(confirmWords("CONFLICT"), CONFLICT_STANDS);
    assert.equal(CONFLICT_STANDS, "The confirmed understanding stands");
    assert.equal(confirmWords("NOT_KNOWN"), "That's right");
  });

  it("never offers a fact not yet known as an assumption to confirm", () => {
    // Design review, 19 November 2026: "The agent assumed: Who leads ... is not yet known."
    // with "That's right". A fact no agent could propose asks for the answer.
    assert.equal(assumptionLead("UNKNOWN"), "Not yet known:");
    assert.equal(confirmWords("UNKNOWN"), "Leave unanswered");
    assert.equal(changeWords("UNKNOWN"), "Add the answer");
    assert.equal(changeWords("ASSUMPTION"), "Change…");
    assert.equal(
      decidedLine({
        kind: "UNKNOWN",
        status: "CONFIRMED",
        assumed: "Who leads each investigation is not yet known.",
        answer: "",
        decidedBy: { id: "p1", name: "Dana Reyes" },
        decidedAt: null,
      }),
      "Left unanswered by Dana Reyes: Who leads each investigation is not yet known.",
    );
  });

  it("words a decided conflict as the person's decision, never as the source confirmed", () => {
    const decided = {
      status: "CONFIRMED" as const,
      assumed: "The change log shows the grant date, against the walkthrough.",
      answer: "",
      decidedBy: { id: PARENT, name: "Dana Lee" },
      decidedAt: REVIEWED,
    };
    assert.equal(
      decidedLine({ ...decided, kind: "CONFLICT" }, "UTC"),
      "Decided by Dana Lee, Nov 16: the confirmed understanding stands.",
    );
    assert.equal(
      decidedLine({ ...decided, kind: "ASSUMPTION" }, "UTC"),
      `Confirmed by Dana Lee, Nov 16: ${decided.assumed}`,
    );
  });
});

describe("the D&I workpaper's ASSUMPTION point", () => {
  it("is a kind of its own, settled on its attribute or by a consideration", () => {
    assert.ok((POINT_KINDS as readonly string[]).includes("ASSUMPTION"));
    assert.ok((SETTLE_ACTIONS as readonly string[]).includes("ASSUMPTION"));
    const [point] = pointsOf(
      [
        {
          key: "a".repeat(32),
          kind: "ASSUMPTION",
          text: "The agent assumed: a patch is linked by patch and host. It was accepted with attribute A, not confirmed.",
          place: { at: "ATTRIBUTE", attribute_id: ATTR_A },
          settle: ["ASSUMPTION", "CONSIDER"],
          considered: null,
        },
      ],
      new Set(),
    );
    assert.equal(point?.kind, "ASSUMPTION");
    assert.deepEqual(point?.place, { at: "ATTRIBUTE", attributeId: ATTR_A });
    assert.deepEqual(point?.settle, ["ASSUMPTION", "CONSIDER"]);
  });

  it("links to the Attributes step to confirm or change it; the others stay in D&I Evidence", () => {
    assert.equal(SETTLE_WORDS.ASSUMPTION, "Confirm or change the assumption");
    const links = {
      evidenceHref: "/c?step=designevidence",
      attributesHref: "/c?step=attributes",
    };
    assert.equal(settleHref("ASSUMPTION", links), "/c?step=attributes");
    assert.equal(settleHref("TICKMARK", links), "/c?step=designevidence");
    assert.equal(
      settleHref("ASSUMPTION", { evidenceHref: "/c?step=designevidence" }),
      null,
    );
    assert.equal(settleWhere("ASSUMPTION"), "in the attributes step");
    assert.equal(settleWhere("RERUN"), SETTLE_WHERE);
  });
});

// Re-shoot r8, 19 November 2026.
describe("the words after the re-shoot", () => {
  it("says a fact not yet known once, as its question", () => {
    const item = {
      kind: "UNKNOWN" as const,
      assumed:
        "Who leads each investigation of inappropriate access is not yet known.",
      matter: "Investigation owner",
    };
    assert.equal(
      assumptionText(item),
      "who leads each investigation of inappropriate access.",
    );
    assert.equal(
      changePrompt(item),
      "Who leads each investigation of inappropriate access?",
    );
    // Any other kind reads as recorded, and its box asks on its matter.
    const assumed = {
      kind: "ASSUMPTION" as const,
      assumed: "The IT manager leads it.",
      matter: "Investigation owner",
    };
    assert.equal(assumptionText(assumed), "The IT manager leads it.");
    assert.equal(
      changePrompt(assumed),
      "What is the case on Investigation owner?",
    );
    assert.equal(
      assumptionText({
        kind: "UNKNOWN",
        assumed: "IT owns it is not yet known.",
      }),
      "IT owns it.",
    );
  });

  it("gives the next step the end of the course's state and choice", () => {
    assert.equal(
      reviewChoiceLine({
        failed: false,
        held: "The review is held on attribute B.",
        runAgain: true,
      }),
      "The review is held on attribute B: run it again, or proceed without it and record the reason.",
    );
    assert.equal(
      reviewChoiceLine({ failed: true, held: "", runAgain: true }),
      "The review of the questions asked could not run: run it again, or proceed without it and record the reason.",
    );
    assert.match(
      reviewChoiceLine({
        failed: false,
        held: "The review is held on attribute B.",
        runAgain: false,
      }),
      /^The review is held on attribute B\. It has run twice and cannot run again: proceed without it and record the reason\.$/,
    );
  });
});

// Final design review, 19 November 2026.
describe("the final review's words", () => {
  it("names the attribute a review question asks about by the page's letter (N2)", () => {
    const approved = [{ code: "A1" }, { code: "A2" }, { code: "A6" }];
    assert.equal(askedAttributeChip("A6", approved), "Attribute C");
    assert.equal(askedAttributeChip("A9", approved), null);
    assert.equal(askedAttributeChip(null, approved), null);
  });

  it("says a failed review in the current words when none is given (N3)", () => {
    assert.equal(
      FAILURE_FALLBACK,
      "The IT audit specialist's review could not be completed.",
    );
    assert.deepEqual(
      reviewView("FAILED", {
        status: "FAILED",
        failure: "",
      } as never),
      { state: "failed", failure: FAILURE_FALLBACK },
    );
  });
});
