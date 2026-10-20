import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AssistantInput,
  assistantBrief,
} from "../apps/web/src/assistant-model.ts";
import {
  type ControlRequest,
  type ControlRow,
  parseControls,
  parseDashboard,
} from "../apps/web/src/engagement-model.ts";
import {
  evidenceActions,
  evidenceHref,
  primaryAction,
  requestStage,
  waitingWords,
} from "../apps/web/src/evidence-flow.ts";
import { parsePlan, planWrite } from "../apps/web/src/evidence-plan-model.ts";
import {
  parseRequestDetail,
  reviewProblem,
  reviewWrite,
} from "../apps/web/src/request-review-model.ts";

const ORG = "11111111-1111-7111-8111-111111111111";
const PROJECT = "22222222-2222-7222-8222-222222222222";
const CONTROL = "33333333-3333-7333-8333-333333333333";
const R1 = "44444444-4444-7444-8444-444444444441";
const R2 = "44444444-4444-7444-8444-444444444442";
const APPROVAL = "55555555-5555-7555-8555-555555555555";

function request(overrides: Partial<ControlRequest>): ControlRequest {
  return {
    id: R1,
    kind: "EVIDENCE",
    title: "Evidence for ITAC-SF-03",
    status: "DRAFT",
    dueAt: "2026-10-30T23:59:00Z",
    phase: "INTERIM",
    version: 1,
    recipient: "owner@client.example",
    kickoff: false,
    approvalId: null,
    approvalDecision: null,
    approvalReason: null,
    approvalDecidedBy: null,
    viewerCanDecide: false,
    ...overrides,
  };
}

function row(overrides: Partial<ControlRow>): ControlRow {
  return {
    ...(parseControls([
      { id: CONTROL, control_ref: "ITAC-SF-03", included: true },
    ])?.[0] as ControlRow),
    ...overrides,
  };
}

const planned = parsePlan({
  control_id: CONTROL,
  status: "PROPOSED",
  phases: [],
});

describe("evidence flow", () => {
  it("names each request's stage from its status and approval", () => {
    assert.equal(requestStage(request({})), "DRAFTED");
    assert.equal(
      requestStage(request({ approvalDecision: "REJECTED" })),
      "RETURNED",
    );
    assert.equal(
      requestStage(
        request({ status: "APPROVAL_PENDING", approvalDecision: "PENDING" }),
      ),
      "AWAITING_APPROVAL",
    );
    assert.equal(
      requestStage(
        request({ status: "APPROVAL_PENDING", approvalDecision: "APPROVED" }),
      ),
      "APPROVED",
    );
    assert.equal(
      requestStage(
        request({ status: "APPROVAL_PENDING", approvalDecision: "EXPIRED" }),
      ),
      "APPROVAL_EXPIRED",
    );
    // A person's own request is sent by them, without a second approval.
    const written = evidenceActions({
      control: row({
        requests: [
          request({ draftedBy: "PERSON", recipient: "owner@client.example" }),
        ],
      }),
      plan: planned,
      canAct: true,
      canApprove: true,
      proposals: 0,
    }).find((action) => action.kind === "review");
    assert.equal(written?.title, "Send the request");
    assert.match(written?.detail ?? "", /without a second approval/);
    // Approved, and refused only because email was off: sent again on that approval.
    const again = request({
      status: "APPROVAL_PENDING",
      approvalDecision: "RESEND",
    });
    assert.equal(requestStage(again), "SEND_AGAIN");
    const sendAgain = evidenceActions({
      control: row({ requests: [again] }),
      plan: planned,
      canAct: true,
      proposals: 0,
    }).find((action) => action.kind === "send");
    assert.match(sendAgain?.detail ?? "", /its approval carries over/);
    // Approved, but the send was refused: nothing went out, so it is submitted again.
    const failed = request({
      status: "APPROVAL_PENDING",
      approvalDecision: "FAILED",
    });
    assert.equal(requestStage(failed), "SEND_FAILED");
    const resubmit = evidenceActions({
      control: row({ requests: [failed] }),
      plan: planned,
      canAct: true,
      proposals: 0,
    }).find((action) => action.kind === "resubmit");
    assert.equal(resubmit?.title, "Submit the request again");
    assert.match(
      resubmit?.detail ?? "",
      /sending was refused, so nothing went out/,
    );
    // A drafted request is never taken for a sent one, nor a sent one for evidence.
    assert.equal(requestStage(request({ status: "SENT" })), "WITH_OWNER");
    assert.equal(requestStage(request({ status: "RECEIVED" })), "RECEIVED");
    assert.equal(
      requestStage(request({ kickoff: true }), { evidencePlan: "NONE" }),
      "HELD",
    );
    assert.equal(
      requestStage(request({ kickoff: true }), { evidencePlan: "PLANNED" }),
      "DRAFTED",
    );
  });

  it("Scenario A: a drafted request opens itself, with its review", () => {
    const actions = evidenceActions({
      control: row({ requests: [request({})] }),
      plan: planned,
      canAct: true,
      proposals: 0,
    });
    assert.deepEqual(
      actions.map((a) => [a.kind, a.target]),
      [["review", { view: "requests", request: R1 }]],
    );
    assert.deepEqual(
      primaryAction(actions)?.label,
      "Review drafted request (1)",
    );
  });

  it("Scenario B: a control with no plan says to plan first", () => {
    const actions = evidenceActions({
      control: row({ evidencePlan: "NONE", requests: [] }),
      plan: parsePlan({
        control_id: CONTROL,
        status: "NOT_PLANNED",
        phases: [],
      }),
      canAct: true,
      proposals: 0,
    });
    assert.deepEqual(
      actions.map((a) => a.kind),
      ["plan"],
    );
    assert.equal(primaryAction(actions)?.label, "Plan the evidence");
  });

  it("Scenario C: a kickoff draft is held for planning, then settled, never reviewed around the plan", () => {
    const kickoff = request({ kickoff: true });
    const before = evidenceActions({
      control: row({ evidencePlan: "NONE", requests: [kickoff] }),
      plan: parsePlan({
        control_id: CONTROL,
        status: "NOT_PLANNED",
        phases: [],
        reconcile: { request_id: R1, request_version: 1, waiting_items: 0 },
      }),
      canAct: true,
      proposals: 0,
    });
    assert.deepEqual(
      before.map((a) => a.kind),
      ["plan"],
    );
    assert.match(before[0]?.detail ?? "", /drafted at kickoff/);
    const after = evidenceActions({
      control: row({ reconcile: true, requests: [kickoff] }),
      plan: parsePlan({
        control_id: CONTROL,
        status: "PROPOSED",
        phases: [],
        reconcile: { request_id: R1, request_version: 1, waiting_items: 7 },
      }),
      canAct: true,
      proposals: 0,
    });
    assert.deepEqual(
      after.map((a) => [a.kind, a.target.request]),
      [["reconcile", R1]],
    );
    assert.match(
      after[0]?.detail ?? "",
      /7 planned items depend on this decision/,
    );
  });

  it("Scenario D: each request has its own action, opening that record", () => {
    const actions = evidenceActions({
      control: row({
        requests: [
          request({ id: R1, phase: "DESIGN" }),
          request({ id: R2, phase: "INTERIM", version: 3 }),
        ],
      }),
      plan: planned,
      canAct: true,
      proposals: 0,
    });
    assert.deepEqual(
      actions.map((a) => a.target.request),
      [R1, R2],
    );
    assert.equal(primaryAction(actions)?.label, "Review drafted requests (2)");
    // The Overview lists both, each opening its own request.
    const brief = assistantBrief({
      control: row({}),
      context: null,
      test: null,
      sheet: null,
      review: null,
      tasks: [],
      filesRead: 0,
      evidence: actions,
    } satisfies AssistantInput);
    assert.deepEqual(
      brief.actions.map((a) => a.target?.request),
      [R1, R2],
    );
  });

  it("Scenario E and H: approval belongs to someone who may decide; the rest wait", () => {
    const pending = request({
      status: "APPROVAL_PENDING",
      approvalId: APPROVAL,
      approvalDecision: "PENDING",
    });
    const waiting = evidenceActions({
      control: row({ requests: [pending] }),
      plan: planned,
      canAct: true,
      proposals: 0,
    });
    assert.deepEqual(
      waiting.map((a) => [a.kind, a.mine]),
      [["await", false]],
    );
    assert.equal(primaryAction(waiting), null);
    assert.equal(
      waitingWords(waiting),
      "Awaiting approval; no other action is required",
    );
    const mine = evidenceActions({
      control: row({ requests: [{ ...pending, viewerCanDecide: true }] }),
      plan: planned,
      canAct: false,
      proposals: 0,
    });
    assert.deepEqual(
      mine.map((a) => [a.kind, a.mine]),
      [["approve", true]],
    );
    // Never "nothing waits" while an approval is the reader's to give.
    assert.equal(waitingWords(mine), "1 item requires your attention");
    const approved = evidenceActions({
      control: row({
        requests: [{ ...pending, approvalDecision: "APPROVED" }],
      }),
      plan: planned,
      canAct: true,
      proposals: 0,
    });
    assert.deepEqual(
      approved.map((a) => a.kind),
      ["send"],
    );
    const returned = evidenceActions({
      control: row({
        requests: [
          request({
            approvalDecision: "REJECTED",
            approvalReason: "Ask for the approver's name.",
            approvalDecidedBy: "Rev Iewer",
          }),
        ],
      }),
      plan: planned,
      canAct: true,
      proposals: 0,
    });
    assert.equal(returned[0]?.kind, "revise");
    assert.match(
      returned[0]?.detail ?? "",
      /returned for revision by Rev Iewer: Ask for the approver's name/,
    );
  });

  it("puts work in flight before new drafts: an approval waiting on the reader comes first", () => {
    const actions = evidenceActions({
      control: row({
        requests: [
          request({ id: R1, phase: "DESIGN" }),
          request({
            id: R2,
            status: "APPROVAL_PENDING",
            approvalId: APPROVAL,
            approvalDecision: "PENDING",
            viewerCanDecide: true,
          }),
        ],
      }),
      plan: planned,
      canAct: true,
      proposals: 0,
    });
    assert.deepEqual(
      actions.map((a) => [a.kind, a.target.request]),
      [
        ["approve", R2],
        ["review", R1],
      ],
    );
    assert.equal(primaryAction(actions)?.label, "Approve request (1)");
  });

  it("links to a record by its address, so a refresh lands on it (Scenario G)", () => {
    assert.equal(
      evidenceHref("/?section=controls&control=c1&tab=evidence", {
        view: "requests",
        request: R1,
      }),
      `/?section=controls&control=c1&tab=evidence&ev=requests&request=${R1}`,
    );
    assert.equal(
      evidenceHref("/?tab=evidence#top", { view: "plan" }),
      "/?tab=evidence&ev=plan#top",
    );
  });

  it("reads the plan's kickoff draft and the dashboard's unplanned controls", () => {
    assert.deepEqual(
      parsePlan({
        control_id: CONTROL,
        status: "PROPOSED",
        reconcile: { request_id: R1, request_version: 2, waiting_items: 4 },
      })?.reconcile,
      { requestId: R1, requestVersion: 2, waitingItems: 4 },
    );
    assert.equal(planned?.reconcile, null);
    assert.equal(
      parseDashboard({ controls: {}, unplanned_controls: 80 })
        ?.unplannedControls,
      80,
    );
    const parsed = parseControls([
      {
        id: CONTROL,
        included: true,
        evidence_plan: "NONE",
        reconcile: false,
        requests: [
          {
            id: R1,
            kind: "EVIDENCE",
            status: "APPROVAL_PENDING",
            kickoff: true,
            approval_id: APPROVAL,
            approval_decision: "PENDING",
            viewer_can_decide: true,
          },
        ],
      },
    ])?.[0];
    assert.equal(parsed?.evidencePlan, "NONE");
    assert.equal(parsed?.requests[0]?.approvalDecision, "PENDING");
    assert.equal(parsed?.requests[0]?.viewerCanDecide, true);
    assert.equal(parsed?.requests[0]?.kickoff, true);
  });

  it("settles a kickoff draft only with a reason to replace it", () => {
    const base = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
      intent: "reconcile",
      request_version: 1,
    };
    const keep = planWrite({ ...base, action: "KEEP" });
    assert.ok(!("error" in keep));
    assert.equal(
      "error" in keep ? "" : keep.path,
      `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-plan/reconcile`,
    );
    assert.deepEqual(planWrite({ ...base, action: "REPLACE", reason: "" }), {
      error: "invalid",
    });
    assert.ok(
      !(
        "error" in
        planWrite({
          ...base,
          action: "REPLACE",
          reason: "The plan asks better.",
        })
      ),
    );
    assert.deepEqual(planWrite({ ...base, action: "DELETE" }), {
      error: "invalid",
    });
  });
});

describe("request review", () => {
  const ids = { organization_id: ORG, project_id: PROJECT, request_id: R1 };
  const project = `/organizations/${ORG}/projects/${PROJECT}`;

  it("builds each action's call and refuses a bad one", () => {
    assert.deepEqual(reviewWrite({ ...ids, intent: "submit", version: 2 }), {
      intent: "submit",
      path: `${project}/pbc-requests/${R1}/submit`,
      body: { version: 2 },
    });
    assert.deepEqual(
      reviewWrite({
        ...ids,
        intent: "decide",
        approval_id: APPROVAL,
        decision: "REJECTED",
        reason: "Ask for the approver's name.",
      }),
      {
        intent: "decide",
        path: `${project}/approvals/${APPROVAL}/decision`,
        body: { decision: "REJECTED", reason: "Ask for the approver's name." },
      },
    );
    // Returning for revision needs a reason; approving needs a note.
    assert.deepEqual(
      reviewWrite({
        ...ids,
        intent: "decide",
        approval_id: APPROVAL,
        decision: "REJECTED",
        reason: "",
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      reviewWrite({ ...ids, intent: "send", approval_id: APPROVAL }),
      {
        intent: "send",
        path: `${project}/pbc-requests/${R1}/send`,
        body: { approval_id: APPROVAL },
      },
    );
    const save = reviewWrite({
      ...ids,
      intent: "save",
      version: 3,
      description: "  - Ticket for each new user  ",
      recipient: "Owner@Client.example",
      due_date: "2026-11-02",
      control_ref: "ITAC-SF-03",
      attachment_refs: [],
      follow_up_after_days: 3,
      max_follow_ups: 2,
    });
    assert.ok(!("error" in save));
    const body = "error" in save ? {} : save.body;
    assert.equal(body.evidence_description, "- Ticket for each new user");
    assert.equal(body.recipient, "owner@client.example");
    assert.equal(body.due_at, "2026-11-02T23:59:00+00:00");
    assert.equal(body.status, "DRAFT");
    for (const bad of [
      { description: "" },
      { recipient: "not-an-email" },
      { due_date: "02/11/2026" },
      { description: "password: hunter2" },
    ]) {
      assert.deepEqual(
        reviewWrite({
          ...ids,
          intent: "save",
          version: 3,
          description: "x",
          recipient: "o@client.example",
          due_date: "2026-11-02",
          control_ref: "ITAC-SF-03",
          follow_up_after_days: 3,
          max_follow_ups: 2,
          ...bad,
        }),
        { error: "invalid" },
      );
    }
    assert.deepEqual(
      reviewWrite({ ...ids, request_id: "../x", intent: "submit", version: 1 }),
      {
        error: "invalid",
      },
    );
  });

  it("says what went wrong in words", () => {
    assert.equal(reviewProblem(200, ""), null);
    assert.match(
      reviewProblem(409, "requester cannot approve") ?? "",
      /cannot be approved by their submitter/,
    );
    assert.match(
      reviewProblem(409, "plan the evidence first") ?? "",
      /Plan the evidence first/,
    );
    assert.match(reviewProblem(403, "") ?? "", /does not permit/);
  });

  it("reads a request whole", () => {
    const detail = parseRequestDetail({
      id: R1,
      status: "DRAFT",
      recipient: "o@client.example",
      due_at: "2026-11-02T23:59:00Z",
      evidence_description: "- A\n- B",
      control_ref: "ITAC-SF-03",
      version: 4,
      attachment_refs: [],
      follow_up_after_days: 3,
      max_follow_ups: 2,
    });
    assert.equal(detail?.description, "- A\n- B");
    assert.equal(detail?.version, 4);
    assert.equal(parseRequestDetail({ id: R1 }), null);
  });
});

describe("evidence summary and approval", () => {
  it("counts an approved request apart from one awaiting approval", async () => {
    const { evidenceSummary } = await import(
      "../apps/web/src/evidence-workspace-model.ts"
    );
    const summary = evidenceSummary(
      null,
      [
        request({
          id: R1,
          status: "APPROVAL_PENDING",
          approvalDecision: "APPROVED",
        }),
        request({
          id: R2,
          status: "APPROVAL_PENDING",
          approvalDecision: "PENDING",
        }),
      ],
      null,
    );
    assert.equal(summary.requests.approval, 1);
    assert.equal(summary.requests.approved, 1);
  });
});

describe("settling a kickoff draft, in words", () => {
  it("says what to set when there is no one to send the plan's requests to", async () => {
    const { planProblem } = await import(
      "../apps/web/src/evidence-plan-model.ts"
    );
    assert.match(
      planProblem(
        409,
        "set the evidence coordinator or the owner's email first",
      ) ?? "",
      /evidence coordinator/,
    );
  });
});

describe("requests with no one to send them to", () => {
  it("says so on the dashboard, on the action, and when submitting", () => {
    const dashboard = parseDashboard({
      controls: {},
      unrequested_controls: 80,
      unaddressed_requests: 160,
    });
    assert.equal(dashboard?.unrequestedControls, 80);
    assert.equal(dashboard?.unaddressedRequests, 160);
    const actions = evidenceActions({
      control: row({ requests: [request({ recipient: "" })] }),
      plan: planned,
      canAct: true,
      proposals: 0,
    });
    assert.match(actions[0]?.detail ?? "", /has no recipient/);
    assert.match(
      reviewProblem(409, "set who the request goes to first") ?? "",
      /Assign the evidence coordinator/,
    );
  });
});

describe("the Evidence page's request list", () => {
  it("knows each request's control, to open it for review there", async () => {
    const { parseEvidence } = await import("../apps/web/src/workflow-model.ts");
    const [first, second] =
      parseEvidence([
        {
          id: R1,
          control_ref: "ITGC-AC-01",
          recipient: "",
          due_at: "2026-10-27T23:59:00Z",
          evidence_description: "- A",
          status: "DRAFT",
          attachment_refs: [],
          version: 1,
          engagement_control_id: CONTROL,
        },
        {
          id: R2,
          control_ref: "ADHOC",
          recipient: "o@client.example",
          due_at: "2026-10-27T23:59:00Z",
          evidence_description: "- B",
          status: "DRAFT",
          attachment_refs: [],
          version: 1,
        },
      ]) ?? [];
    assert.equal(first?.controlId, CONTROL);
    assert.equal(second?.controlId, null);
  });
});

describe("the reviewer approves the agent's draft", () => {
  it("offers approval to someone who may approve, and submission to the rest", () => {
    const draft = row({ requests: [request({})] });
    const approver = evidenceActions({
      control: draft,
      plan: planned,
      canAct: false,
      canApprove: true,
      proposals: 0,
    });
    assert.equal(approver[0]?.title, "Review and approve the drafted request");
    assert.equal(approver[0]?.mine, true);
    assert.match(approver[0]?.detail ?? "", /approve it for sending/);
    const preparer = evidenceActions({
      control: draft,
      plan: planned,
      canAct: true,
      proposals: 0,
    });
    assert.equal(preparer[0]?.title, "Review the drafted request");
    assert.match(preparer[0]?.detail ?? "", /submit it for approval/);
  });

  it("builds the approve call with the reviewer's note", () => {
    const ids = { organization_id: ORG, project_id: PROJECT, request_id: R1 };
    assert.deepEqual(reviewWrite({ ...ids, intent: "approve", version: 3 }), {
      intent: "approve",
      path: `/organizations/${ORG}/projects/${PROJECT}/pbc-requests/${R1}/approve`,
      body: { version: 3, reason: "Reviewed and approved." },
    });
    assert.deepEqual(
      reviewWrite({
        ...ids,
        intent: "approve",
        version: 3,
        reason: "password: x",
      }),
      { error: "invalid" },
    );
    assert.match(
      reviewProblem(409, "only an agent's draft is approved by its reviewer") ??
        "",
      /requires approval by another authorized person/,
    );
  });
});

describe("the planning gate", () => {
  it("reads a proposed plan and whether the attributes are settled", () => {
    const [parsed] =
      parseControls([
        {
          id: CONTROL,
          control_ref: "ITAC-SF-03",
          included: true,
          evidence_plan: "PROPOSED",
          attributes_settled: false,
        },
      ]) ?? [];
    assert.equal(parsed?.evidencePlan, "PROPOSED");
    assert.equal(parsed?.attributesSettled, false);
  });

  it("asks for the plan's approval first, and holds what was drafted before it", () => {
    const control = row({
      evidencePlan: "PROPOSED",
      requests: [request({}), request({ id: R2, status: "APPROVAL_PENDING" })],
    });
    assert.equal(
      requestStage(control.requests[0] as ControlRequest, control),
      "HELD",
    );
    assert.equal(
      requestStage(control.requests[1] as ControlRequest, control),
      "HELD",
    );
    const actions = evidenceActions({
      control,
      plan: null,
      canAct: true,
      canApprove: true,
      proposals: 0,
    });
    // The action approves the plan, opening its items; it never plans again.
    assert.equal(primaryAction(actions)?.action.kind, "approve_plan");
    assert.equal(primaryAction(actions)?.label, "Approve plan");
    assert.equal(
      primaryAction(actions)?.action.title,
      "Review and approve the evidence plan",
    );
    assert.deepEqual(primaryAction(actions)?.action.target, {
      view: "requirements",
    });
    // It is done with the test plan, on the Test plans page, not on the Evidence tab.
    assert.equal(primaryAction(actions)?.action.page, "test-plan");
    // A plan with open points says what they are. Approval is still required.
    const judged = evidenceActions({
      control,
      plan: parsePlan({
        control_id: CONTROL,
        status: "PROPOSED",
        phases: [],
        attention: [
          "Interim operating effectiveness: Is it monthly or quarterly?",
          "Missing: the population source",
        ],
      }),
      canAct: true,
      canApprove: true,
      proposals: 0,
    });
    assert.equal(
      primaryAction(judged)?.action.title,
      "The evidence plan needs your judgment",
    );
    assert.match(
      primaryAction(judged)?.action.detail ?? "",
      /left 2 points for you:.*monthly or quarterly\? \(and 1 more/,
    );
    // Nothing held is offered for review or approval.
    assert.equal(
      actions.some((item) => item.kind === "review" || item.kind === "approve"),
      false,
    );
    // Once approved, the same draft is a draft to review.
    const approved = row({ ...control, evidencePlan: "PLANNED" });
    assert.equal(
      requestStage(approved.requests[0] as ControlRequest, approved),
      "DRAFTED",
    );
  });

  it("says why a request waits, in words", () => {
    assert.equal(
      reviewProblem(409, "approve the evidence plan first"),
      "Approve the control's evidence plan first. Requests are released once it is approved.",
    );
    assert.equal(
      reviewProblem(409, "settle the control's attributes first"),
      "Settle the control's attributes first. Operating evidence follows them.",
    );
  });
});
