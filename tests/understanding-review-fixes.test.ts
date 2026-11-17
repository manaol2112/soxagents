import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  acceptItems,
  CONFLICT_HOLDS,
  contextProblem,
  contextWrite,
  criteriaToAccept,
  holdWords,
  parseAssumption,
  parseContext,
  parseQuestionReview,
  parseReviewRequest,
  SET_CONFLICT_HOLDS,
  unifiedRows,
} from "../apps/web/src/control-context-model.ts";
import {
  attributeAnchor,
  attributeFromHash,
  settleHref,
} from "../apps/web/src/design-points-model.ts";
import { parseReview } from "../apps/web/src/understanding-chat-model.ts";
import {
  ACCEPTED_UNCONFIRMED,
  CHANGE_REOPENS,
  decidableAssumptions,
  decidedLine,
  settledAssumptions,
} from "../apps/web/src/understanding-once-model.ts";
import {
  acceptAllNote,
  acceptAllWords,
  ENSURE_EVERY_MS,
  ensuresReview,
  lastReady,
  notKnownKeys,
  notKnownTarget,
  notKnownWrite,
  notYetAccepted,
  offersReviewAgain,
  REVIEW_AGAIN,
  REVIEW_NONE,
  REVIEW_NOT_RUN,
  RUN_AGAIN,
  RUN_REVIEW,
  reviewAgainWords,
  reviewView,
  targetKey,
  unconfirmedWith,
  withoutNotKnown,
} from "../apps/web/src/understanding-specialist-model.ts";

// The fixes of the independent review of B1k and B1l (docs/control-workflow-plan.md; product
// owner, 16 November 2026), web side: one regression test per finding. Synthetic data only.

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
const CONTROL = "01a13300-0000-7000-8000-000000000002";
const ATTR_A = "01a13300-0000-7000-8000-00000000000a";
const ATTR_B = "01a13300-0000-7000-8000-00000000000b";
const ATTR_C = "01a13300-0000-7000-8000-00000000000c";
const IDS = { organization_id: ORG, project_id: PROJECT, control_id: CONTROL };
const BASE = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}`;
const DONE_AT = "2026-11-16T16:20:00Z";

const review = (over: Record<string, unknown> = {}) =>
  parseQuestionReview({
    id: "01a13300-0000-7000-8000-0000000000f1",
    status: "READY",
    round: 2,
    narrative:
      "The questions answered now establish what the attributes and the evidence depend on.",
    marked: [],
    not_reviewed: [],
    open_questions: 0,
    reviewed_at: DONE_AT,
    failure: "",
    ...over,
  });
const READY = review();
const PENDING = review({
  id: "01a13300-0000-7000-8000-0000000000f2",
  status: "PENDING",
  narrative: "",
});
const FAILED = review({
  id: "01a13300-0000-7000-8000-0000000000f3",
  status: "FAILED",
  narrative: "",
  failure: "The specialist's answer could not be used.",
});

const assumption = (over: Record<string, unknown> = {}) => ({
  id: "01a13300-0000-7000-8000-0000000000a1",
  matter: "patch to change record link",
  assumed: "A patch is linked to its change record by patch and host.",
  status: "OPEN",
  answer: "",
  decided_by: null,
  decided_at: null,
  attribute_codes: ["A1"],
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

describe("Review again keeps the last good review shown, polls, and can be asked again", () => {
  it("reads a read in flight after completion as checking, the last READY review kept (old body: newest row only)", () => {
    // Finding (loop/model): reviewView("DONE", PENDING, true) was "none".
    const view = reviewView("DONE", PENDING, true, { last: READY });
    assert.deepEqual(view, { state: "checking", last: READY });
    // The section polls while checking after completion.
    assert.equal(view.state === "checking", true);
  });

  it("reads the server's fixed shape: the READY review, and the request beside it", () => {
    const request = parseReviewRequest({ status: "PENDING", failure: "" });
    assert.deepEqual(reviewView("DONE", READY, true, { request }), {
      state: "checking",
      last: READY,
    });
    const failed = parseReviewRequest({
      status: "FAILED",
      failure: "The specialist's answer could not be used.",
    });
    const view = reviewView("DONE", READY, true, { request: failed });
    assert.equal(view.state, "ready");
    assert.equal(
      view.state === "ready" && view.againFailed,
      "The specialist's answer could not be used.",
    );
    // Run again stays offered after a failed request.
    assert.equal(offersReviewAgain(DONE_AT, "DONE", true, view), true);
    assert.equal(reviewAgainWords(view), RUN_AGAIN);
    assert.equal(parseReviewRequest({ status: "READY" }), null);
    assert.equal(parseReviewRequest(null), null);
    assert.equal(
      parseReviewRequest({ status: "PENDING", failure: "x" })?.failure,
      "",
    );
  });

  it("keeps the last good paragraph after a failed read on a body that sends only the newest row", () => {
    const kept = lastReady(lastReady(null, READY), FAILED);
    assert.equal(kept, READY);
    const view = reviewView("DONE", FAILED, true, { last: kept });
    assert.equal(view.state, "ready");
    assert.equal(view.state === "ready" && view.review, READY);
    assert.notEqual(view.state === "ready" && view.againFailed, null);
    // A newer READY replaces the kept one.
    const newer = review({ id: "01a13300-0000-7000-8000-0000000000f4" });
    assert.equal(lastReady(READY, newer), newer);
  });

  it("offers a review on a control completed without one, worded as such, and never while it runs", () => {
    const none = reviewView("DONE", null, true);
    assert.deepEqual(none, { state: "unreviewed", failure: null });
    assert.equal(offersReviewAgain(DONE_AT, "DONE", true, none), true);
    assert.equal(reviewAgainWords(none), RUN_REVIEW);
    assert.equal(
      REVIEW_NONE,
      "The questions were not reviewed by the specialist.",
    );
    const failedOnly = reviewView("DONE", FAILED, true);
    assert.equal(failedOnly.state, "unreviewed");
    assert.equal(reviewAgainWords(failedOnly), RUN_AGAIN);
    const checking = reviewView("DONE", PENDING, true);
    assert.equal(offersReviewAgain(DONE_AT, "DONE", true, checking), false);
    assert.equal(
      reviewAgainWords(reviewView("DONE", READY, true)),
      REVIEW_AGAIN,
    );
    // Before completion a failed review is the course's two choices, as before.
    assert.equal(reviewView("FAILED", FAILED, false).state, "failed");
  });
});

describe("without a model, one quiet line says the review was not run", () => {
  it("reads review_not_run, and a review that failed for want of a model, as not run", () => {
    const context = parseContext({
      control_id: CONTROL,
      review_not_run: "NO_MODEL",
      understanding_completed_at: DONE_AT,
    });
    assert.equal(context?.reviewNotRun, "NO_MODEL");
    assert.equal(parseContext({ control_id: CONTROL })?.reviewNotRun, null);
    const view = reviewView("DONE", null, true, { notRun: "NO_MODEL" });
    assert.deepEqual(view, { state: "notRun" });
    assert.equal(offersReviewAgain(DONE_AT, "DONE", true, view), false);
    const said = review({
      status: "FAILED",
      narrative: "",
      failure: "The review could not run: no model is configured.",
    });
    assert.deepEqual(reviewView("DONE", said, true), { state: "notRun" });
    assert.match(REVIEW_NOT_RUN, /not run: no model is configured/);
  });
});

describe("a due review is never left unqueued by the page", () => {
  it("asks the server, explicitly, only while the course checks with no read live", () => {
    assert.equal(ensuresReview("checking", "WAITING", null, true), true);
    assert.equal(ensuresReview("checking", "DONE", READY, true), true);
    assert.equal(ensuresReview("checking", "CHECKING", null, true), false);
    assert.equal(ensuresReview("checking", "WAITING", PENDING, true), false);
    assert.equal(ensuresReview("complete", "DONE", null, true), false);
    assert.equal(ensuresReview("checking", "WAITING", null, false), false);
    assert.equal(ENSURE_EVERY_MS, 30000);
  });

  it("is a POST to its own idempotent route, never a write in a GET", () => {
    const write = contextWrite({ ...IDS, intent: "review-ensure" });
    assert.ok(!("error" in write));
    assert.equal(!("error" in write) && write.method, "POST");
    assert.equal(
      !("error" in write) && write.path,
      `${BASE}/understanding/review/ensure`,
    );
    const route = readFileSync(
      new URL(
        "../apps/web/app/workspace/control-context/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const get = route.slice(route.indexOf("export async function GET"));
    assert.doesNotMatch(get, /contextWrite/);
  });
});

describe("Not known yet on walkthrough questions and statement values", () => {
  const issue = {
    id: "01a13300-0000-7000-8000-0000000000e1",
    status: "OPEN",
    version: 3,
  };

  it("is offered on every course question not on record, and nothing else", () => {
    assert.deepEqual(
      notKnownTarget(
        { key: issue.id, kind: "QUESTION", status: "MISSING" },
        issue,
        true,
      ),
      { kind: "issue", id: issue.id, version: 3 },
    );
    assert.equal(
      notKnownTarget(
        { key: issue.id, kind: "QUESTION", status: "MISSING" },
        { ...issue, status: "RESOLVED" },
        true,
      ),
      null,
    );
    assert.deepEqual(
      notKnownTarget(
        { key: "change-tool", kind: "ANSWER", status: "MISSING" },
        undefined,
        true,
      ),
      { kind: "value", key: "change-tool" },
    );
    assert.deepEqual(
      notKnownTarget(
        {
          key: "wt-ac07-removal-record",
          kind: "WALKTHROUGH",
          status: "PROPOSED",
        },
        undefined,
        true,
      ),
      { kind: "walkthrough", key: "wt-ac07-removal-record" },
    );
    assert.equal(
      notKnownTarget(
        { key: "change-tool", kind: "ANSWER", status: "CONFIRMED" },
        undefined,
        true,
      ),
      null,
    );
    assert.equal(
      notKnownTarget(
        { key: "policy", kind: "DOCUMENT", status: "MISSING" },
        undefined,
        true,
      ),
      null,
    );
    assert.equal(
      notKnownTarget(
        { key: "change-tool", kind: "ANSWER", status: "MISSING" },
        undefined,
        false,
      ),
      null,
    );
    assert.equal(
      targetKey({ kind: "value", key: "change-tool" }),
      "change-tool",
    );
  });

  it("is sent to its own route with the optional note, never as an answer", () => {
    const wt = notKnownWrite(
      { kind: "walkthrough", key: "wt-ac07-removal-record" },
      "Asked of the access team.",
    );
    assert.equal(wt.intent, "walkthrough-not-known");
    const sent = contextWrite({ ...IDS, intent: wt.intent, ...wt.fields });
    assert.ok(!("error" in sent));
    assert.equal(
      !("error" in sent) && sent.path,
      `${BASE}/walkthrough-answers/wt-ac07-removal-record/not-known`,
    );
    assert.deepEqual(!("error" in sent) && sent.body, {
      note: "Asked of the access team.",
    });
    const value = notKnownWrite({ kind: "value", key: "change-tool" }, "");
    const sentValue = contextWrite({
      ...IDS,
      intent: value.intent,
      ...value.fields,
    });
    assert.equal(
      !("error" in sentValue) && sentValue.path,
      `${BASE}/values/change-tool/not-known`,
    );
    // The issue's write is as before, at the version read.
    assert.deepEqual(
      notKnownWrite({ kind: "issue", id: issue.id, version: 3 }, "n"),
      {
        intent: "issue-not-known",
        fields: { issue_id: issue.id, version: 3, note: "n" },
      },
    );
    // A key that is not one, or a note with a secret, is never sent.
    for (const fields of [
      { intent: "walkthrough-not-known", key: "../values" },
      { intent: "walkthrough-not-known", key: "change-tool" },
      { intent: "value-not-known", key: "wt-ac07-x/../y" },
      {
        intent: "value-not-known",
        key: "change-tool",
        note: "password: hunter2",
      },
      { intent: "value-not-known", key: "change-tool", note: "x".repeat(501) },
    ]) {
      assert.ok("error" in contextWrite({ ...IDS, ...fields }), fields.key);
    }
  });

  it("keeps a not-known value or walkthrough question out of the course and on record as the person's", () => {
    const body = {
      control_ref: "ITGC-AC-07",
      statement: [],
      needs: [
        {
          key: "wt-ac07-removal-record",
          kind: "WALKTHROUGH",
          status: "NOT_KNOWN",
          source: "NONE",
          question:
            "Does the system record the date each role was removed from a user, and who removed it?",
          not_known_note: "Asked of the access team.",
          topic: "RECORDS",
          answer_kind: "YES_NO",
        },
        {
          key: "access-tool",
          kind: "ANSWER",
          status: "NOT_KNOWN",
          source: "NONE",
          label: "Access request tool",
        },
        {
          key: "owner",
          kind: "ANSWER",
          status: "MISSING",
          source: "NONE",
          label: "Owner",
        },
      ],
    };
    const parsed = parseReview(body);
    assert.ok(parsed !== null);
    assert.deepEqual(
      parsed.needs.map((need) => need.key),
      ["owner"],
    );
    assert.deepEqual(parsed.notKnown, [
      {
        key: "wt-ac07-removal-record",
        kind: "WALKTHROUGH",
        question:
          "Does the system record the date each role was removed from a user, and who removed it?",
        note: "Asked of the access team.",
      },
      {
        key: "access-tool",
        kind: "ANSWER",
        question: "Access request tool",
        note: "",
      },
    ]);
    const keys = notKnownKeys([], new Set(), parsed.notKnown);
    assert.deepEqual([...keys].sort(), [
      "access-tool",
      "wt-ac07-removal-record",
    ]);
    // Closed this visit before the read says so: it leaves the course at once.
    const now = withoutNotKnown(parsed, new Set(["owner"]));
    assert.deepEqual(now.needs, []);
  });
});

describe("an assumption accepted with its attribute is confirmed or changed there", () => {
  const accepted = parseAssumption(
    assumption({ status: "ACCEPTED_WITH_ATTRIBUTE" }),
  );
  const confirmed = parseAssumption(
    assumption({
      id: "01a13300-0000-7000-8000-0000000000a2",
      status: "CONFIRMED",
      decided_by: { id: ORG, name: "Dana Lee" },
      decided_at: DONE_AT,
    }),
  );

  it("is still decidable, worded as accepted and not confirmed, and changing it says it re-opens the criteria", () => {
    assert.ok(accepted !== null && confirmed !== null);
    assert.deepEqual(
      decidableAssumptions([accepted, confirmed]).map((item) => item.status),
      ["ACCEPTED_WITH_ATTRIBUTE"],
    );
    assert.deepEqual(
      settledAssumptions([accepted, confirmed]).map((item) => item.status),
      ["CONFIRMED"],
    );
    assert.equal(
      ACCEPTED_UNCONFIRMED,
      "Accepted with the attribute, not confirmed:",
    );
    assert.match(CHANGE_REOPENS, /re-opens them for acceptance/);
    const source = readFileSync(
      new URL("../apps/web/src/attribute-assumptions.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /const open = decidableAssumptions\(items\);/);
    assert.match(source, /\{accepted \? ` \$\{CHANGE_REOPENS\}` : ""\}/);
  });

  it("links the D&I point to the attribute's own row", () => {
    assert.equal(
      settleHref(
        "ASSUMPTION",
        { evidenceHref: "/e", attributesHref: "/c?step=attributes" },
        { at: "ATTRIBUTE", attributeId: ATTR_A },
      ),
      `/c?step=attributes#${attributeAnchor(ATTR_A)}`,
    );
    // A point on the set links to the step.
    assert.equal(
      settleHref(
        "ASSUMPTION",
        { evidenceHref: "/e", attributesHref: "/c?step=attributes" },
        { at: "REQUEST", requirementId: null },
      ),
      "/c?step=attributes",
    );
    assert.equal(attributeFromHash(`#attribute-${ATTR_A}`), ATTR_A);
    assert.equal(attributeFromHash("#attribute-"), null);
    assert.equal(attributeFromHash("#step-x"), null);
  });
});

describe("The confirmed understanding stands names the fact it upholds, never the agent's text", () => {
  it("reads upholds on a decided conflict only, and words the decision with it", () => {
    const decided = parseAssumption(
      assumption({
        kind: "CONFLICT",
        status: "CONFIRMED",
        assumed:
          "The policy says the CAB approves; the walkthrough says the IT manager approves.",
        decided_by: { id: ORG, name: "Dana Lee" },
        decided_at: DONE_AT,
        upholds: "The IT manager approves each patch.",
      }),
    );
    assert.ok(decided !== null);
    assert.equal(decided.upholds, "The IT manager approves each patch.");
    const line = decidedLine(decided, "UTC") ?? "";
    assert.equal(
      line,
      "Decided by Dana Lee, Nov 16: the confirmed understanding stands (The IT manager approves each patch).",
    );
    assert.doesNotMatch(line, /CAB/);
    const plain = parseAssumption(
      assumption({ upholds: "anything", status: "OPEN" }),
    );
    assert.equal(plain?.upholds, "");
  });
});

describe("Accept all counts each unconfirmed assumption once, the set's too", () => {
  const shared = assumption({
    id: "01a13300-0000-7000-8000-0000000000b1",
    attribute_codes: ["A1", "A2"],
  });
  const context = parseContext({
    control_id: CONTROL,
    understanding_completed_at: DONE_AT,
    set_assumptions: [
      assumption({
        id: "01a13300-0000-7000-8000-0000000000b2",
        attribute_codes: [],
      }),
    ],
    attributes: {
      approved: [
        toAccept(ATTR_A, { code: "A1", assumptions: [shared] }),
        toAccept(ATTR_B, { code: "A2", assumptions: [shared] }),
      ],
    },
  });
  assert.ok(context !== null);
  const rows = unifiedRows(context);

  it("counts one assumption named on two attributes once", () => {
    // Finding: unconfirmedWith summed per row, so 2.
    assert.equal(unconfirmedWith(rows), 1);
  });

  it("adds the set's open assumptions when the acceptance leaves nothing else to accept", () => {
    const set = {
      assumptions: context.setAssumptions ?? [],
      remaining: notYetAccepted(rows),
    };
    assert.equal(unconfirmedWith(rows, set), 2);
    // Accepting one row leaves the other, so the set is not accepted with it.
    assert.equal(unconfirmedWith(rows.slice(0, 1), set), 1);
    assert.deepEqual(acceptAllWords(rows, 0, set), {
      label: "Accept all 2",
      leftOut: "",
      includes: "includes 2 assumptions not confirmed",
    });
  });

  it("reads the attribute's code, never shown, for the review's lines", () => {
    assert.deepEqual(
      context.approved.map((item) => item.code),
      ["A1", "A2"],
    );
    const odd = parseContext({
      control_id: CONTROL,
      attributes: { approved: [toAccept(ATTR_A, { code: "<b>" })] },
    });
    assert.equal(odd?.approved[0]?.code, "");
  });
});

describe("a conflict that names no attribute holds the whole set, and says so", () => {
  const held = parseContext({
    control_id: CONTROL,
    understanding_completed_at: DONE_AT,
    set_assumptions: [
      assumption({
        id: "01a13300-0000-7000-8000-0000000000c1",
        kind: "CONFLICT",
        attribute_codes: [],
      }),
    ],
    attributes: {
      approved: [toAccept(ATTR_A), toAccept(ATTR_B)],
      proposed: [
        {
          id: ATTR_C,
          status: "PROPOSED",
          proposal: "ADD",
          version: 1,
          text: "A new attribute",
        },
      ],
    },
  });
  assert.ok(held !== null);

  it("holds every attribute, sends nothing, and gives the set's reason", () => {
    assert.equal(held.setHeldByConflict, true);
    assert.ok(held.approved.every((item) => item.heldByConflict === true));
    assert.ok(held.proposed.every((item) => item.heldBySet === true));
    const rows = unifiedRows(held);
    assert.deepEqual(acceptItems(rows), []);
    assert.deepEqual(criteriaToAccept(held), []);
    assert.equal(holdWords(held.approved[0] ?? {}), SET_CONFLICT_HOLDS);
    assert.equal(holdWords({}), CONFLICT_HOLDS);
    assert.equal(contextProblem(409, SET_CONFLICT_HOLDS), SET_CONFLICT_HOLDS);
    const words = acceptAllWords([], 3, { held: true });
    assert.equal(
      acceptAllNote(words),
      "All 3 held: a conflict on the attributes as a set to decide",
    );
  });

  it("is read from the server's flag too, and a decided conflict holds nothing", () => {
    const flagged = parseContext({
      control_id: CONTROL,
      set_held_by_conflict: true,
      attributes: { approved: [toAccept(ATTR_A)] },
    });
    assert.equal(flagged?.approved[0]?.heldBySet, true);
    const decided = parseContext({
      control_id: CONTROL,
      set_assumptions: [
        assumption({
          kind: "CONFLICT",
          status: "CONFIRMED",
          attribute_codes: [],
          decided_by: { id: ORG, name: "Dana Lee" },
          decided_at: DONE_AT,
        }),
      ],
      attributes: { approved: [toAccept(ATTR_A)] },
    });
    assert.equal(decided?.setHeldByConflict, false);
    assert.equal(decided?.approved[0]?.heldByConflict, false);
  });
});
