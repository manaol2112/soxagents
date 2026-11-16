import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STEPS,
  type WorkflowInput,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";
import {
  designConclusionWrite,
  parseDesignConclusion,
} from "../apps/web/src/design-conclusion-model.ts";
import {
  preparedDetail,
  signOffRefusal,
} from "../apps/web/src/preparer-signoff-model.ts";
import {
  countWords,
  firstName,
  inReviewLine,
  inReviewStatus,
  lastReturnOf,
  mayManageRequest,
  notesWords,
  parseWaitingReviews,
  preparerPressOf,
  preparerRowMayAct,
  REVIEW_ROUTES,
  remindedLine,
  reminderWords,
  remindRequest,
  remindWaitMinutes,
  returnedLine,
  returnedNext,
  returnRequest,
  reviewerDetail,
  reviewerRequest,
  reviewersOf,
  reviewFlowOf,
  reviewRefusal,
  reviewRequestOf,
  reviewRereads,
  reviewSide,
  reviewWrite,
  STEP_DRAFT,
  STEP_OUT_OF_DATE,
  STEP_RETURNED,
  sendHint,
  sendRequest,
  sentToYouLine,
  signedOffStatus,
  signOffStage,
  startingReviewer,
  waitingCountLabel,
  waitingCountOf,
  waitingHref,
  waitingLine,
  waitingPath,
  waitingWords,
} from "../apps/web/src/review-request-model.ts";
import { panelFrame } from "../apps/web/src/step-panel-model.ts";

// One D&I step: the preparer sends the design workpaper for review, the reviewer signs in
// section 7 (product owner, 16 November 2026, docs/design-workpaper.md section 3.8:
// "When the user signs-off he/she has the option to send the workpaper for review to
// another team member"). The page reads the D&I conclusion's body for the request, the
// last return and the reviewers; it never offers what the server does not, never reads
// an unknown conclusion as effective, and validates every write before the API sees it.
// Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = { organizationId: uuid(1), projectId: uuid(2), controlId: uuid(3) };
const RILEY = { id: uuid(20), name: "Riley Park" };
const DANA = { id: uuid(21), name: "Dana Lee" };
const request = {
  id: uuid(30),
  reviewer: RILEY,
  sent_by: DANA,
  sent_at: "2026-11-16T14:10:00Z",
  message: "The walkthrough is complete; please look at attribute B.",
  reminded_at: null,
  version: 7,
};
const day = (at: string) => at.slice(0, 10);

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    control_id: ids.controlId,
    status: "TO_SIGN",
    proposed: "EFFECTIVE",
    workpaper: {
      id: uuid(4),
      status: "PREPARED",
      prepared_by: "Dana Lee",
      prepared_version: 7,
    },
    deficiencies: [],
    signed: null,
    out_of_date: [],
    blocking: [],
    viewer_is_reviewer: true,
    viewer_prepared: false,
    independence_required: true,
    can_sign: true,
    history: [],
    proposed_conclusion: "EFFECTIVE",
    choice: {
      id: uuid(40),
      kind: "EFFECTIVE",
      basis: null,
      reason: "",
      proposed_kind: "EFFECTIVE",
      recorded_by: "Dana Lee",
      recorded_at: "2026-11-16T10:00:00Z",
      workpaper_version: 6,
    },
    review_request: request,
    last_return: null,
    reviewers: [
      {
        id: RILEY.id,
        name: RILEY.name,
        role: "Reviewer",
        waiting: 3,
        offered: true,
        why_not: "",
      },
      {
        id: uuid(22),
        name: "Morgan Shah",
        role: "Lead",
        waiting: 0,
        offered: true,
        why_not: "",
      },
      {
        id: DANA.id,
        name: DANA.name,
        waiting: 0,
        offered: false,
        why_not: "Cannot review their own workpaper",
      },
    ],
    default_reviewer_id: RILEY.id,
    ...over,
  };
}

describe("the body's review (section 3.8)", () => {
  it("reads the request, the reviewers and the default, and keeps a body from before 3.8 as it was", () => {
    const parsed = parseDesignConclusion(body());
    assert.ok(parsed !== null);
    assert.equal(parsed.reviewFlow, true);
    assert.deepEqual(parsed.reviewRequest, {
      id: uuid(30),
      reviewer: RILEY,
      sentBy: DANA,
      sentAt: "2026-11-16T14:10:00Z",
      message: "The walkthrough is complete; please look at attribute B.",
      remindedAt: null,
      version: 7,
    });
    assert.equal(parsed.defaultReviewerId, RILEY.id);
    assert.deepEqual(
      parsed.reviewers.map((item) => [item.name, item.offered, item.waiting]),
      [
        ["Riley Park", true, 3],
        ["Morgan Shah", true, 0],
        ["Dana Lee", false, 0],
      ],
    );
    // No review fields: the flow from before 3.8, nothing invented.
    const before = { ...body() };
    delete before.review_request;
    delete before.reviewers;
    delete before.last_return;
    delete before.default_reviewer_id;
    const old = parseDesignConclusion(before);
    assert.ok(old !== null);
    assert.equal(old.reviewFlow, false);
    assert.equal(old.reviewRequest, null);
    assert.deepEqual(old.reviewers, []);
    assert.equal(old.defaultReviewerId, null);
    // A request that stands as null is still 3.8's.
    assert.equal(reviewFlowOf(body({ review_request: null })), true);
  });

  it("never reads what it cannot: no id, no reviewer, a duplicate, an offer not made", () => {
    assert.equal(reviewRequestOf({ ...request, id: "x" }), null);
    assert.equal(
      reviewRequestOf({ ...request, reviewer: { name: "R" } }),
      null,
    );
    assert.equal(reviewRequestOf(null), null);
    assert.equal(
      reviewRequestOf({ ...request, reminded_at: "2026-11-16T15:00:00Z" })
        ?.remindedAt,
      "2026-11-16T15:00:00Z",
    );
    // A name the server does not give is never an id.
    assert.equal(
      reviewRequestOf({ ...request, reviewer: { id: RILEY.id } })?.reviewer
        .name,
      "A team member",
    );
    const listed = reviewersOf([
      { id: RILEY.id, name: "Riley Park", offered: true },
      { id: RILEY.id, name: "Riley again", offered: true },
      { id: uuid(23), name: "Sam", waiting: -2 },
      { id: "no", name: "Nobody", offered: true },
      "text",
    ]);
    assert.deepEqual(
      listed.map((item) => [item.name, item.offered, item.waiting]),
      [
        ["Riley Park", true, 0],
        // Offered only where the server says so.
        ["Sam", false, 0],
      ],
    );
    assert.equal(reviewersOf("x").length, 0);
    assert.deepEqual(
      lastReturnOf({
        by: RILEY,
        at: "2026-11-17T09:00:00Z",
        reason: "  Say why B is not needed.  ",
      }),
      {
        by: RILEY,
        at: "2026-11-17T09:00:00Z",
        reason: "Say why B is not needed.",
      },
    );
    assert.equal(lastReturnOf({ by: { name: "R" }, reason: "x" }), null);
  });

  it("starts on the server's default only where it is offered, else on nobody", () => {
    const reviewers = reviewersOf(body().reviewers);
    assert.equal(startingReviewer(reviewers, RILEY.id), RILEY.id);
    assert.equal(startingReviewer(reviewers, DANA.id), null);
    assert.equal(startingReviewer(reviewers, null), null);
    assert.equal(startingReviewer(reviewers, uuid(99)), null);
  });
});

describe("where the sign-off stands, and who the viewer is to it", () => {
  const parsedRequest = reviewRequestOf(request);
  const back = lastReturnOf({
    by: RILEY,
    at: "2026-11-17",
    reason: "Say why.",
  });
  it("is one of the prototype's five states, or prepared with no request", () => {
    assert.equal(
      signOffStage({
        paperStatus: "DRAFT",
        signedOff: false,
        request: null,
        lastReturn: null,
      }),
      "unsigned",
    );
    assert.equal(
      signOffStage({
        paperStatus: "PREPARED",
        signedOff: false,
        request: parsedRequest,
        lastReturn: null,
      }),
      "sent",
    );
    assert.equal(
      signOffStage({
        paperStatus: "DRAFT",
        signedOff: false,
        request: null,
        lastReturn: back,
      }),
      "returned",
    );
    assert.equal(
      signOffStage({
        paperStatus: "PREPARED",
        signedOff: true,
        request: null,
        lastReturn: back,
      }),
      "signed",
    );
    // Prepared before 3.8, or by the existing prepare: the reviewer may still sign it.
    assert.equal(
      signOffStage({
        paperStatus: "PREPARED",
        signedOff: false,
        request: null,
        lastReturn: null,
      }),
      "prepared",
    );
  });

  it("only the reviewer the request names signs or returns it", () => {
    assert.ok(parsedRequest !== null);
    const facts = {
      request: parsedRequest,
      viewerPrepared: false,
      viewerIsReviewer: true,
      canSign: false,
    };
    assert.equal(reviewSide({ ...facts, viewerId: RILEY.id }), "reviewer");
    // Another reviewer is told who it is with, even where the server would let them sign.
    assert.equal(
      reviewSide({ ...facts, viewerId: uuid(22), canSign: true }),
      "other_reviewer",
    );
    assert.equal(
      reviewSide({ ...facts, viewerId: DANA.id, viewerIsReviewer: false }),
      "preparer",
    );
    assert.equal(
      reviewSide({ ...facts, viewerId: uuid(50), viewerIsReviewer: false }),
      "reader",
    );
    // Who is reading is not known: the server's `can_sign` names the reviewer.
    assert.equal(
      reviewSide({ ...facts, viewerId: null, canSign: true }),
      "reviewer",
    );
    assert.equal(reviewSide({ ...facts, viewerId: null }), "other_reviewer");
  });
});

describe("the words", () => {
  const parsedRequest = reviewRequestOf(request);
  it("say who, when and how many, as the prototype does", () => {
    assert.ok(parsedRequest !== null);
    assert.equal(firstName("Riley Park"), "Riley");
    assert.equal(waitingWords(0), "");
    assert.equal(waitingWords(1), "1 workpaper waiting");
    assert.equal(waitingWords(3), "3 workpapers waiting");
    const [riley, , dana] = reviewersOf(body().reviewers);
    assert.ok(riley !== undefined && dana !== undefined);
    assert.equal(reviewerDetail(riley), "Reviewer · 3 workpapers waiting");
    assert.equal(reviewerDetail(dana), "Cannot review their own workpaper");
    assert.equal(
      reviewerDetail({ ...dana, whyNot: "" }),
      "Not offered for this workpaper",
    );
    assert.equal(
      inReviewLine(parsedRequest, day),
      "with Riley Park · sent 2026-11-16",
    );
    assert.equal(sentToYouLine(parsedRequest, day), "sent to you 2026-11-16");
    assert.equal(sendHint("Riley Park"), "Riley gets it in their review list");
    assert.equal(sendHint(null), "Choose who reviews it");
    const back = lastReturnOf({ by: RILEY, at: "2026-11-17", reason: "x" });
    assert.ok(back !== null);
    assert.equal(
      returnedLine(back, day),
      "returned by Riley Park · 2026-11-17",
    );
    assert.equal(
      returnedNext("Riley Park"),
      "The workpaper is a draft again. Fix it, then sign and send again; Riley stays the reviewer.",
    );
    assert.equal(notesWords(0, 0), "none");
    assert.equal(notesWords(2, 0), "2 open · 0 urgent");
    assert.equal(countWords(0), "none");
    assert.equal(countWords(2), "2 logged");
    assert.equal(
      preparedDetail("Robert John Manaol", "Nov 16", 7),
      "by Robert John Manaol · Nov 16 · version 7",
    );
  });

  it("reminds at most once an hour, and says when the next may be sent", () => {
    assert.ok(parsedRequest !== null);
    const at = Date.parse("2026-11-16T15:00:00Z");
    assert.equal(remindWaitMinutes(parsedRequest, at), 0);
    const reminded = { ...parsedRequest, remindedAt: "2026-11-16T15:00:00Z" };
    assert.equal(remindWaitMinutes(reminded, at + 20 * 60000), 40);
    assert.equal(remindWaitMinutes(reminded, at + 60 * 60000), 0);
    assert.equal(
      remindedLine(reminded, at + 59 * 60000, day),
      "Reminded 2026-11-16 · the next in 1 minute",
    );
    assert.equal(remindedLine(parsedRequest, at, day), "");
  });

  it("says each refusal in the server's sentence, and an answer in doubt as may not have been taken", () => {
    assert.equal(reviewRefusal("send", 200, ""), "");
    assert.equal(
      reviewRefusal(
        "send",
        409,
        "you prepared this workpaper; choose another reviewer.",
      ),
      "Not signed or sent: you prepared this workpaper; choose another reviewer.",
    );
    assert.equal(
      reviewRefusal("return", 403, "only the reviewer it is with returns it"),
      "Not returned: only the reviewer it is with returns it.",
    );
    assert.match(reviewRefusal("remind", 429, ""), /less than an hour ago/);
    assert.match(reviewRefusal("return", 422, ""), /10 to 1000 characters/);
    assert.match(reviewRefusal("reviewer", 401, ""), /session has ended/);
    for (const status of [0, 500, 502]) {
      for (const intent of ["send", "reviewer", "remind", "return"] as const) {
        const said = reviewRefusal(intent, status, "");
        assert.match(said, /may not have been/, `${intent} ${status}`);
        assert.doesNotMatch(
          said,
          /^Not (signed|returned)/,
          `${intent} ${status}`,
        );
      }
    }
    for (const status of [409, 0, 500]) {
      assert.equal(reviewRereads(status), true, String(status));
    }
    for (const status of [200, 401, 403, 422, 429]) {
      assert.equal(reviewRereads(status), false, String(status));
    }
    // "Sign and send for review" is one transaction: the preparer's row says the review's
    // refusal.
    assert.equal(
      signOffRefusal("send", 409, "choose a reviewer"),
      "Not signed or sent: choose a reviewer.",
    );
  });
});

describe("the writes", () => {
  it("sends what the contract names, and nothing else", () => {
    const send = reviewWrite(
      "send",
      sendRequest(ids, 7, RILEY.id, " Please look at B. "),
    );
    assert.deepEqual(send, {
      intent: "send",
      path: `/organizations/${uuid(1)}/projects/${uuid(2)}/design-conclusions/${uuid(3)}/send-for-review`,
      body: {
        workpaper_version: 7,
        reviewer_id: RILEY.id,
        message: "Please look at B.",
        prepare_note: "",
      },
    });
    assert.deepEqual(
      reviewWrite("reviewer", reviewerRequest(ids, uuid(30), uuid(22))),
      {
        intent: "reviewer",
        path: `/organizations/${uuid(1)}/projects/${uuid(2)}/design-conclusions/${uuid(3)}/review-request/reviewer`,
        body: { request_id: uuid(30), reviewer_id: uuid(22) },
      },
    );
    assert.deepEqual(reviewWrite("remind", remindRequest(ids, uuid(30))), {
      intent: "remind",
      path: `/organizations/${uuid(1)}/projects/${uuid(2)}/design-conclusions/${uuid(3)}/review-request/remind`,
      body: { request_id: uuid(30) },
    });
    assert.deepEqual(
      reviewWrite(
        "return",
        returnRequest(ids, uuid(30), "Say why B is not needed here."),
      ),
      {
        intent: "return",
        path: `/organizations/${uuid(1)}/projects/${uuid(2)}/design-conclusions/${uuid(3)}/return`,
        body: { request_id: uuid(30), reason: "Say why B is not needed here." },
      },
    );
    // A field the page adds is never forwarded.
    const extra = reviewWrite("remind", {
      ...remindRequest(ids, uuid(30)),
      reviewer_id: uuid(9),
    });
    assert.ok(!("error" in extra));
    assert.deepEqual(extra.body, { request_id: uuid(30) });
    assert.deepEqual(Object.keys(REVIEW_ROUTES).sort(), [
      "remind",
      "return",
      "reviewer",
      "send",
    ]);
  });

  it("refuses what the contract would", () => {
    const bad: Array<
      [Parameters<typeof reviewWrite>[0], Record<string, unknown>]
    > = [
      ["send", {}],
      ["send", { ...sendRequest(ids, 7, RILEY.id, ""), organization_id: "x" }],
      ["send", sendRequest(ids, 0, RILEY.id, "")],
      [
        "send",
        { ...sendRequest(ids, 7, RILEY.id, ""), workpaper_version: "7" },
      ],
      ["send", sendRequest(ids, 7, "riley", "")],
      ["send", sendRequest(ids, 7, RILEY.id, "x".repeat(1001))],
      ["send", sendRequest(ids, 7, RILEY.id, "the password: hunter2")],
      ["send", { ...sendRequest(ids, 7, RILEY.id, ""), message: 5 }],
      ["reviewer", reviewerRequest(ids, uuid(30), "x")],
      ["reviewer", reviewerRequest(ids, "x", uuid(22))],
      ["remind", remindRequest(ids, "")],
      ["return", returnRequest(ids, uuid(30), "too short")],
      ["return", returnRequest(ids, uuid(30), "x".repeat(1001))],
      ["return", returnRequest(ids, uuid(30), "the api_key is abc123 here")],
      [
        "return",
        { ...returnRequest(ids, uuid(30), "A good reason."), request_id: null },
      ],
    ];
    for (const [intent, fields] of bad) {
      assert.ok(
        "error" in reviewWrite(intent, fields),
        `${intent} ${JSON.stringify(fields).slice(0, 80)}`,
      );
    }
    // A message of exactly 1,000 characters and a reason of exactly 10 are taken.
    assert.ok(
      !(
        "error" in
        reviewWrite("send", sendRequest(ids, 7, RILEY.id, "x".repeat(1000)))
      ),
    );
    assert.ok(
      !(
        "error" in
        reviewWrite("return", returnRequest(ids, uuid(30), "x".repeat(10)))
      ),
    );
  });

  it("signs off with the request it ends, where one stands", () => {
    const fields = {
      organization_id: uuid(1),
      project_id: uuid(2),
      control_id: uuid(3),
      intent: "sign",
      conclusion: "EFFECTIVE",
      choice_id: uuid(40),
      workpaper_version: "7",
      note: "",
    };
    const without = designConclusionWrite(fields);
    assert.ok(!("error" in without));
    assert.equal("request_id" in without.body, false);
    const withRequest = designConclusionWrite({
      ...fields,
      request_id: uuid(30),
    });
    assert.ok(!("error" in withRequest));
    assert.equal(withRequest.body.request_id, uuid(30));
    assert.ok("error" in designConclusionWrite({ ...fields, request_id: "x" }));
  });
});

describe("Home: Waiting for your review", () => {
  it("reads the viewer's requests, flat or nested, and never an unknown conclusion", () => {
    // The body as design_review_requests.MineBody sends it: `{count, requests}`, each
    // request naming its control flat as `control_ref` and `control_title`.
    const mine = {
      count: 3,
      requests: [
        {
          id: uuid(30),
          control_id: uuid(3),
          control_ref: "ITGC-AC-01",
          control_title: "User Access Provisioning",
          stage: "DESIGN",
          sent_by: DANA,
          sent_at: "2026-11-16T14:10:00Z",
          message: "",
          reminded_at: null,
          version: 7,
          conclusion: "EFFECTIVE",
          conclusion_words: "Effective",
          urgent_notes: 0,
        },
        {
          id: uuid(31),
          control: {
            id: uuid(5),
            reference: "ITGC-CM-04",
            title: "Change approval",
          },
          sent_by: DANA,
          sent_at: "2026-11-14",
          conclusion: "SOMETHING_NEW",
          urgent_notes: 1,
        },
        { id: uuid(32), control_id: "x" },
        { id: "x", control_id: uuid(3) },
      ],
    };
    const items = parseWaitingReviews(mine);
    assert.ok(items !== null);
    assert.equal(items.length, 2);
    const [first, second] = items;
    assert.ok(first !== undefined && second !== undefined);
    // The control reference and title the server sends, for the line and for Open.
    assert.equal(first.reference, "ITGC-AC-01");
    assert.equal(first.title, "User Access Provisioning");
    assert.equal(first.remindedAt, null);
    // The count in the navigation is the server's total, not the lines carried.
    assert.equal(waitingCountOf(mine), 3);
    assert.equal(waitingCountOf({ requests: [] }), 0);
    assert.equal(waitingCountOf([{ id: uuid(30), control_id: uuid(3) }]), 1);
    assert.equal(waitingCountOf({ count: -1 }), null);
    assert.equal(waitingCountOf("x"), null);
    assert.equal(waitingCountLabel(2), "2 waiting for your review");
    assert.equal(
      waitingLine(first, day),
      "from Dana Lee · 2026-11-16 · Effective",
    );
    assert.equal(second.conclusion, "");
    assert.equal(second.reference, "ITGC-CM-04");
    // Urgent notes in place of the conclusion: they hold the sign-off.
    assert.equal(
      waitingLine(second, day),
      "from Dana Lee · 2026-11-14 · 1 urgent note",
    );
    assert.equal(parseWaitingReviews([]) !== null, true);
    assert.equal(parseWaitingReviews("x"), null);
    // Straight to section 7 of the control's D&I Assessment.
    assert.equal(
      waitingHref(first, uuid(1), uuid(2)),
      `/?organization=${uuid(1)}&project=${uuid(2)}&section=controls&control=${uuid(3)}&step=designassessment#di-conclusion`,
    );
    assert.equal(
      waitingPath(
        new URLSearchParams({ organization_id: uuid(1), project_id: uuid(2) }),
      ),
      `/organizations/${uuid(1)}/projects/${uuid(2)}/review-requests/mine`,
    );
    assert.equal(
      waitingPath(new URLSearchParams({ organization_id: uuid(1) })),
      null,
    );
    assert.equal(
      waitingPath(
        new URLSearchParams({ organization_id: "../x", project_id: uuid(2) }),
      ),
      null,
    );
  });
});

describe("D&I Assessment's status on the workflow (section 3.8)", () => {
  const base: WorkflowInput = {
    details: [{ label: "Description", filled: true }],
    setup: [],
    attributes: { approved: 2, proposed: 0 },
    plan: { exists: true, approved: true, pendingReview: false },
    requirements: [{ phase: "DESIGN", state: "ACCEPTED" }],
    designRelease: { step: "RELEASED" },
    sheet: null,
    rounds: [],
    findings: [],
    reviewStatus: "",
    conclusion: "NOT_CONCLUDED",
    proposedConclusion: null,
    designPaper: { status: "DRAFT", drafting: false },
    designConclusion: {
      status: "NOT_READY",
      proposed: null,
      signed: null,
      inReviewWith: null,
      returned: false,
    },
    effectivenessPaper: null,
    busy: new Set(),
  };
  const at = (over: Partial<WorkflowInput>) => {
    const step = workflowOf({ ...base, ...over }).find(
      (item) => item.key === "designassessment",
    );
    assert.ok(step !== undefined);
    return `${step.tone}|${step.status}`;
  };
  it("reads Draft · Prepared, in review with <name> · Returned · Signed off · out of date", () => {
    assert.equal(
      STEPS.some((step) => step.key === ("designconclusion" as never)),
      false,
    );
    assert.equal(at({}), `attention|${STEP_DRAFT}`);
    assert.equal(
      at({
        designConclusion: {
          status: "NOT_READY",
          proposed: null,
          signed: null,
          returned: true,
        },
      }),
      `attention|${STEP_RETURNED}`,
    );
    assert.equal(
      at({
        designPaper: { status: "PREPARED", drafting: false },
        designConclusion: {
          status: "TO_SIGN",
          proposed: "EFFECTIVE",
          signed: null,
          inReviewWith: "Riley Park",
        },
      }),
      `attention|${inReviewStatus("Riley Park")}`,
    );
    assert.equal(
      inReviewStatus("Riley Park"),
      "Prepared, in review with Riley Park",
    );
    assert.equal(
      at({
        designPaper: { status: "PREPARED", drafting: false },
        designConclusion: {
          status: "SIGNED_OFF",
          proposed: "EFFECTIVE",
          signed: "EFFECTIVE",
          named: { standing: "EXCEPTIONS_NOTED", proposed: "EXCEPTIONS_NOTED" },
          inReviewWith: null,
        },
      }),
      `done|${signedOffStatus("Exceptions noted")}`,
    );
    for (const paper of ["DRAFT", "PREPARED"] as const) {
      assert.equal(
        at({
          designPaper: { status: paper, drafting: false },
          designConclusion: {
            status: "OUT_OF_DATE",
            proposed: "EFFECTIVE",
            signed: "EFFECTIVE",
            inReviewWith: "Riley Park",
          },
        }),
        `attention|${STEP_OUT_OF_DATE}`,
        paper,
      );
    }
    // OE still waits for the reviewer's sign-off: in review is not signed.
    const inReview = workflowOf({
      ...base,
      designPaper: { status: "PREPARED", drafting: false },
      designConclusion: {
        status: "TO_SIGN",
        proposed: "EFFECTIVE",
        signed: null,
        inReviewWith: "Riley Park",
      },
    });
    assert.equal(
      inReview.find((step) => step.key === "oeevidence")?.status,
      "Waiting on D&I conclusion",
    );
    // Prepared, the step asks for the reviewer's sign-off; a draft, for the workpaper.
    assert.equal(
      panelFrame("designassessment", inReview, null).need.title,
      "Sign off the D&I conclusion",
    );
    assert.equal(
      panelFrame("designassessment", workflowOf(base), null).need.title,
      "Prepare the design workpaper",
    );
  });
});

describe("independent review of 3.8 (16 November 2026)", () => {
  it("shows the reviewer the preparer's reminder: on the Home line and in section 7", () => {
    const items = parseWaitingReviews({
      count: 2,
      requests: [
        {
          id: uuid(30),
          control_id: uuid(3),
          control_ref: "ITGC-AC-01",
          control_title: "User Access Provisioning",
          sent_by: DANA,
          sent_at: "2026-11-16T14:10:00Z",
          reminded_at: "2026-11-17T09:00:00Z",
          conclusion: "EFFECTIVE",
          urgent_notes: 0,
        },
        {
          id: uuid(31),
          control_id: uuid(5),
          control_ref: "ITGC-CM-04",
          control_title: "Change approval",
          sent_by: DANA,
          sent_at: "2026-11-14T08:00:00Z",
          reminded_at: "2026-11-15T08:00:00Z",
          conclusion: "EFFECTIVE",
          urgent_notes: 2,
        },
      ],
    });
    assert.ok(items !== null);
    const [first, second] = items;
    assert.ok(first !== undefined && second !== undefined);
    assert.equal(first.remindedAt, "2026-11-17T09:00:00Z");
    assert.equal(
      waitingLine(first, day),
      "from Dana Lee · 2026-11-16 · Effective · Reminded 2026-11-17",
    );
    assert.equal(
      waitingLine(second, day),
      "from Dana Lee · 2026-11-14 · 2 urgent notes · Reminded 2026-11-15",
    );
    assert.equal(reminderWords(null, day), "");
    // Section 7, the reviewer's own view: beside "sent to you".
    const parsed = parseDesignConclusion(
      body({
        review_request: { ...request, reminded_at: "2026-11-17T09:00:00Z" },
      }),
    );
    assert.ok(parsed !== null && parsed.reviewRequest !== null);
    assert.equal(
      sentToYouLine(parsed.reviewRequest, day),
      "sent to you 2026-11-16 · Reminded 2026-11-17",
    );
  });

  it("offers Sign and send for review on a draft to a viewer the server counts as a reviewer", () => {
    // A draft: nobody prepared it (`prepared_by` is null, so `viewer_prepared` is false
    // for everyone), and with independence off every member is a reviewer.
    const draft = parseDesignConclusion(
      body({
        workpaper: {
          id: uuid(4),
          status: "DRAFT",
          prepared_by: null,
          prepared_version: null,
        },
        status: "NOT_READY",
        review_request: null,
        viewer_is_reviewer: true,
        viewer_prepared: false,
        independence_required: false,
        can_sign: false,
      }),
    );
    assert.ok(draft !== null);
    const facts = {
      preparerMayAct: true,
      reviewFlow: draft.reviewFlow,
      viewerIsReviewer: draft.viewerIsReviewer,
      viewerPrepared: draft.viewerPrepared,
    };
    assert.equal(preparerRowMayAct({ ...facts, paperStatus: "DRAFT" }), true);
    // Prepared: a reviewer who did not prepare it is not offered "Reopen to change".
    assert.equal(
      preparerRowMayAct({ ...facts, paperStatus: "PREPARED" }),
      false,
    );
    assert.equal(
      preparerRowMayAct({
        ...facts,
        paperStatus: "PREPARED",
        viewerPrepared: true,
      }),
      true,
    );
    // The server's `can_edit` still decides.
    assert.equal(
      preparerRowMayAct({
        ...facts,
        paperStatus: "DRAFT",
        preparerMayAct: false,
      }),
      false,
    );
  });

  it("prepares nothing where the D&I conclusion could not be read", () => {
    assert.equal(preparerPressOf(null), "unread");
    const parsed = parseDesignConclusion(body());
    assert.ok(parsed !== null);
    assert.equal(preparerPressOf(parsed), "send");
    const before = { ...body() };
    delete before.review_request;
    delete before.reviewers;
    delete before.last_return;
    delete before.default_reviewer_id;
    const old = parseDesignConclusion(before);
    assert.ok(old !== null);
    // The existing prepare only for a body that was read and is from before 3.8.
    assert.equal(preparerPressOf(old), "prepare");
  });

  it("names the reviewer from the session, not from can_sign, while a hold keeps them from signing", () => {
    // An urgent note holds the sign-off: the server makes `can_sign` false for the
    // reviewer the request names. The review notes' route has not answered.
    const held = parseDesignConclusion(
      body({ can_sign: false, blocking: ["An urgent review note is open."] }),
      RILEY.id,
    );
    assert.ok(held !== null && held.reviewRequest !== null);
    assert.equal(held.viewerId, RILEY.id);
    assert.equal(
      reviewSide({
        request: held.reviewRequest,
        viewerId: held.viewerId,
        viewerPrepared: held.viewerPrepared,
        viewerIsReviewer: held.viewerIsReviewer,
        canSign: held.canSign,
      }),
      "reviewer",
    );
    // The body's own `viewer_id` comes first; an id that is not one is never read.
    assert.equal(
      parseDesignConclusion(body({ viewer_id: uuid(22) }), RILEY.id)?.viewerId,
      uuid(22),
    );
    assert.equal(parseDesignConclusion(body(), "not-an-id")?.viewerId, null);
    assert.equal(parseDesignConclusion(body())?.viewerId, null);
  });

  it("offers Change reviewer and Remind only to the sender, the preparer or a lead", () => {
    const parsed = parseDesignConclusion(body());
    assert.ok(parsed !== null && parsed.reviewRequest !== null);
    const facts = {
      request: parsed.reviewRequest,
      viewerId: DANA.id,
      viewerPrepared: false,
      canManage: null,
      canAct: true,
    };
    // The person who sent it.
    assert.equal(mayManageRequest(facts), true);
    // The preparer.
    assert.equal(
      mayManageRequest({ ...facts, viewerId: uuid(50), viewerPrepared: true }),
      true,
    );
    // Another reviewer, or a reader with the preparer's role: refused by the server.
    assert.equal(mayManageRequest({ ...facts, viewerId: uuid(22) }), false);
    assert.equal(mayManageRequest({ ...facts, viewerId: null }), false);
    // The server's own word, where the body carries it: a lead.
    assert.equal(
      mayManageRequest({ ...facts, viewerId: uuid(22), canManage: true }),
      true,
    );
    assert.equal(mayManageRequest({ ...facts, canManage: false }), false);
    // Never to a viewer who may not act (the engagement closed, the role).
    assert.equal(
      mayManageRequest({ ...facts, canManage: true, canAct: false }),
      false,
    );
    assert.equal(
      parseDesignConclusion(body({ can_manage_request: true }))
        ?.canManageRequest,
      true,
    );
    assert.equal(parseDesignConclusion(body())?.canManageRequest, null);
  });
});
