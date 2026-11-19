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
  pointsOf,
  settleHref,
} from "../apps/web/src/design-points-model.ts";
import { parseReview } from "../apps/web/src/understanding-chat-model.ts";
import {
  ACCEPTED_UNCONFIRMED,
  CHANGE_REOPENS,
  decidableAssumptions,
  decidedLine,
  settledAssumptions,
  updatedFromLine,
} from "../apps/web/src/understanding-once-model.ts";
import {
  acceptAllNote,
  acceptAllWords,
  FOLLOW_EVERY_MS,
  followsReview,
  lastReady,
  notKnownKeys,
  notKnownTarget,
  notKnownWrite,
  notReviewedLine,
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
  // Rewritten in the second fix round of B1k (16 November 2026). Old: ensuresReview(end,
  // pass, review, canAct) worked out the page's own condition ("checking" with no read
  // PENDING), which also posted while a plan run was queued, and the write went to
  // .../understanding/review/ensure, which the API never had (every call a 404). New: the page
  // follows the API's own review_due, and posts to the route the API implements,
  // .../understanding/review/follow (pinned on both sides by control-understanding.json).
  it("asks the server, explicitly, only while the server says a read is due", () => {
    assert.equal(followsReview(true, null, true), true);
    assert.equal(followsReview(false, null, true), false);
    assert.equal(followsReview(undefined, null, true), false);
    assert.equal(followsReview(true, DONE_AT, true), false);
    assert.equal(followsReview(true, null, false), false);
    assert.equal(FOLLOW_EVERY_MS, 30000);
    assert.equal(
      parseContext({ control_id: CONTROL, review_due: true })?.reviewDue,
      true,
    );
    assert.equal(parseContext({ control_id: CONTROL })?.reviewDue, false);
  });

  it("is a POST to its own idempotent route, never a write in a GET", () => {
    const write = contextWrite({ ...IDS, intent: "review-follow" });
    assert.ok(!("error" in write));
    assert.equal(!("error" in write) && write.method, "POST");
    assert.equal(
      !("error" in write) && write.path,
      `${BASE}/understanding/review/follow`,
    );
    assert.ok("error" in contextWrite({ ...IDS, intent: "review-ensure" }));
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
    // Rewritten in the second fix round of B1k. Old: POST .../walkthrough-answers/{key}/
    // not-known and .../values/{key}/not-known with {note}, routes the API never had. New:
    // the API's one route, POST .../understanding/not-known with {subject, key, note}.
    assert.equal(
      !("error" in sent) && sent.path,
      `${BASE}/understanding/not-known`,
    );
    assert.deepEqual(!("error" in sent) && sent.body, {
      subject: "WALKTHROUGH",
      key: "wt-ac07-removal-record",
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
      `${BASE}/understanding/not-known`,
    );
    assert.deepEqual(!("error" in sentValue) && sentValue.body, {
      subject: "VALUE",
      key: "change-tool",
      note: "",
    });
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
    // Rewritten in the second fix round of B1k (decided for it: the person's change ends the
    // criteria's acceptance, and the limited update re-tailors them). Old: /re-opens them for
    // acceptance/, by a proposed change the update could not re-tailor. New: the acceptance
    // ends, and the agents re-tailor them for the person to accept again.
    assert.match(CHANGE_REOPENS, /ends their acceptance/);
    assert.match(CHANGE_REOPENS, /re-tailor them from your words/);
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

describe("The confirmed understanding stands names no fact the person did not choose", () => {
  // Rewritten in the second fix round of B1k (decided for it: the record names only the
  // decision). Old: the page read AssumptionBody.upholds, a string the API never sent, and
  // worded "the confirmed understanding stands (The IT manager approves each patch)." New:
  // no upholds is read, and the line is the decision alone.
  it("words the decision alone, never the agent's account of the conflict", () => {
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
    assert.ok(!("upholds" in decided));
    const line = decidedLine(decided, "UTC") ?? "";
    assert.equal(
      line,
      "Decided by Dana Lee, Nov 16: the confirmed understanding stands.",
    );
    assert.doesNotMatch(line, /CAB|IT manager/);
    const plain = parseAssumption(
      assumption({ upholds: "anything", status: "OPEN" }),
    );
    assert.ok(plain !== null && !("upholds" in plain));
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
    // Rewritten 19 November 2026 (owner-approved Review attributes prototype; the count is
    // still said beside the button, B1l point 6). Old: "Accept all 2" with "includes 2
    // assumptions not confirmed". New: "Accept all" with "2 unconfirmed assumptions".
    assert.deepEqual(acceptAllWords(rows, 0, set), {
      label: "Accept all",
      leftOut: "",
      includes: "2 unconfirmed assumptions",
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
    // Rewritten in the second fix round of B1k. Old: the flag was read at the top of the
    // context (set_held_by_conflict), where the API never sends it. New: it is read where
    // the API sends it, on the attributes (AttributesBody.set_held_by_conflict).
    const flagged = parseContext({
      control_id: CONTROL,
      attributes: { approved: [toAccept(ATTR_A)], set_held_by_conflict: true },
    });
    assert.equal(flagged?.approved[0]?.heldBySet, true);
    const topLevel = parseContext({
      control_id: CONTROL,
      set_held_by_conflict: true,
      attributes: { approved: [toAccept(ATTR_A)] },
    });
    assert.equal(topLevel?.approved[0]?.heldBySet, undefined);
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

describe("The second fix round of B1k, the web's part", () => {
  it("names a not-reviewed attribute by the API's own item, its id", () => {
    const approved = [
      { id: ATTR_A, code: "", definition: null },
      { id: ATTR_B, code: "", definition: null },
    ];
    // Old: mapped only by an AttributeBody.code the API did not send, so "A2" was unplaced.
    assert.equal(
      notReviewedLine(["A2"], approved),
      "One attribute was not reviewed; the agent states its assumptions on it.",
    );
    assert.equal(
      notReviewedLine(["A2"], approved, [
        {
          key: "A2",
          kind: "ATTRIBUTE",
          attributeId: ATTR_B,
          code: "A2",
          text: "Tested.",
        },
      ]),
      "Attribute B was not reviewed; the agent states its assumptions on it.",
    );
  });

  it("offers Not known yet on the sign-in settings, as their value", () => {
    assert.deepEqual(
      notKnownTarget(
        { key: "auth-settings", kind: "AUTH", status: "MISSING" },
        undefined,
        true,
      ),
      { kind: "value", key: "auth-settings" },
    );
    const page = readFileSync(
      new URL("../apps/web/src/understanding-review.tsx", import.meta.url),
      "utf8",
    );
    const auth = page.slice(page.indexOf('if (need.kind === "AUTH") {'));
    assert.match(auth.slice(0, 2400), /<NotKnownPanel/);
  });

  it("falls back to review/run when the follow-up is refused", () => {
    const page = readFileSync(
      new URL("../apps/web/src/understanding-review.tsx", import.meta.url),
      "utf8",
    );
    const fallback = page.slice(page.indexOf("{FOLLOW_REFUSED}"));
    assert.match(fallback.slice(0, 400), /onClick=\{\(\) => void runNow\(\)\}/);
    assert.match(page, /const taken = await runReview\(ids\);/);
    const write = contextWrite({ ...IDS, intent: "review-run" });
    assert.equal(
      !("error" in write) && write.path,
      `${BASE}/understanding/review/run`,
    );
  });

  it("says a reopened acceptance as the person's change, never as their answer", () => {
    assert.equal(
      updatedFromLine("Reopened: Patch approver"),
      "Reopened for acceptance: you changed the assumption on Patch approver",
    );
    assert.equal(
      updatedFromLine("Patch approver"),
      "Updated from your answer on Patch approver",
    );
  });

  it("offers no Considered on a conflict point: only deciding it settles it", () => {
    const [conflict, other] = pointsOf(
      [
        {
          key: "a".repeat(32),
          kind: "ASSUMPTION",
          text: "A conflict is not decided: the two disagree.",
          place: { at: "ATTRIBUTE", attribute_id: ATTR_A },
          settle: ["ASSUMPTION"],
        },
        {
          key: "b".repeat(32),
          kind: "ASSUMPTION",
          text: "The agent assumed: the ticket records it.",
          place: { at: "ATTRIBUTE", attribute_id: ATTR_A },
          settle: ["ASSUMPTION", "CONSIDER"],
        },
      ],
      new Set(),
    );
    assert.deepEqual(conflict?.settle, ["ASSUMPTION"]);
    assert.deepEqual(other?.settle, ["ASSUMPTION", "CONSIDER"]);
    const view = readFileSync(
      new URL("../apps/web/src/design-points.tsx", import.meta.url),
      "utf8",
    );
    assert.match(view, /point\.settle\.includes\("CONSIDER"\) \? \(/);
  });
});
