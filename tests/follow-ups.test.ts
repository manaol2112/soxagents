import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canFollowUpNow,
  followUpNoticeFor,
  followUpWrite,
  latestOutbound,
  parseApprovals,
  parseEvidenceNotice,
  parseFollowUps,
  parseOutbound,
  reminderStep,
  remindersSent,
  supersededSend,
} from "../apps/web/src/workflow-model.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const projectId = "22222222-2222-7222-8222-222222222222";
const requestId = "66666666-6666-7666-8666-666666666666";
const followUpId = "88888888-8888-7888-8888-888888888888";
const approvalId = "99999999-9999-7999-8999-999999999999";
const now = Date.parse("2026-10-10T12:00:00Z");

function followUp(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: followUpId,
    pbc_request_id: requestId,
    sequence: 1,
    status: "DUE",
    due_at: "2026-10-09T09:00:00Z",
    approval_id: null,
    outbound_id: null,
    closed_at: null,
    reason: "",
    created_at: "2026-10-09T09:00:00Z",
    updated_at: "2026-10-09T09:00:00Z",
    version: 1,
    ...extra,
  };
}

function reminderApproval(extra: Record<string, unknown> = {}) {
  return {
    id: approvalId,
    requesting_user_id: "44444444-4444-7444-8444-444444444444",
    requesting_agent_id: null,
    action_id: "mail.reminder",
    parameters: {
      recipient: "owner@example.com",
      request_ref: `pbc/${requestId}/pbc-reminder-v1/${followUpId}/0123456789abcdef`,
      subject: "[PBC-66666666] Reminder: Evidence request: ITGC-AC-01",
    },
    target_resource: `pbc/${requestId}/pbc-reminder-v1/${followUpId}/0123456789abcdef`,
    risk: "MODERATE",
    payload_hash: "abc",
    approver_user_id: null,
    decision: "PENDING",
    decision_reason: null,
    execution_status: "NOT_STARTED",
    expires_at: "2026-10-11T12:00:00Z",
    ...extra,
  };
}

function record(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "77777777-7777-7777-8777-777777777777",
    pbc_request_id: requestId,
    approval_id: approvalId,
    kind: "reminder",
    follow_up_id: followUpId,
    reference: "PBC-66666666",
    status: "ACCEPTED",
    delivery_confirmed: false,
    error_code: "",
    updated_at: "2026-10-10T11:00:00Z",
    ...extra,
  };
}

function step(followUps: unknown[], approvals: unknown[], outbound: unknown[]) {
  return reminderStep({
    followUps: parseFollowUps(followUps) ?? [],
    approvals: parseApprovals(approvals) ?? [],
    outbound: parseOutbound(outbound) ?? [],
    requestId,
    now,
  });
}

describe("follow-up reminders", () => {
  it("parses reminders strictly", () => {
    const [parsed] = parseFollowUps([followUp()]) ?? [];
    assert.equal(parsed?.requestId, requestId);
    assert.equal(parsed?.status, "DUE");
    assert.equal(parseFollowUps([followUp({ status: "LOST" })]), null);
    assert.equal(parseFollowUps([followUp({ sequence: "1" })]), null);
    assert.equal(parseFollowUps({}), null);
  });

  it("keeps reminders out of the request's own delivery status", () => {
    const records = parseOutbound([
      record({
        kind: "request",
        follow_up_id: null,
        updated_at: "2026-10-01T09:00:00Z",
      }),
      record({ id: "77777777-7777-7777-8777-777777777778" }),
    ]);
    assert.equal(records?.[1]?.kind, "reminder");
    assert.equal(records?.[1]?.followUpId, followUpId);
    assert.equal(latestOutbound(records ?? [], requestId)?.kind, "request");
    const legacy = parseOutbound([
      record({ kind: undefined, follow_up_id: undefined }),
    ]);
    assert.equal(legacy?.[0]?.kind, "request");
    assert.equal(parseOutbound([record({ kind: "blast" })]), null);
  });

  it("walks a reminder from due to approval to send", () => {
    assert.equal(step([followUp()], [], [])?.kind, "prepare");
    const pending = followUp({
      status: "APPROVAL_PENDING",
      approval_id: approvalId,
    });
    assert.equal(step([pending], [reminderApproval()], [])?.kind, "awaiting");
    const approved = step(
      [pending],
      [
        reminderApproval({
          decision: "APPROVED",
          approver_user_id: organizationId,
        }),
      ],
      [],
    );
    assert.deepEqual(
      approved?.kind === "send" ? approved.approvalId : null,
      approvalId,
    );
    assert.equal(
      step([pending], [reminderApproval({ decision: "REJECTED" })], [])?.kind,
      "settling",
    );
    assert.equal(
      step(
        [pending],
        [],
        [record({ status: "UNKNOWN", error_code: "timeout" })],
      )?.kind,
      "retry",
    );
    const sent = followUp({
      status: "SENT",
      approval_id: approvalId,
      closed_at: "2026-10-10T11:00:00Z",
    });
    assert.equal(step([sent], [], []), null);
    assert.equal(remindersSent(parseFollowUps([sent]) ?? [], requestId), 1);
  });

  it("builds reminder writes only from valid ids", () => {
    const fields = {
      organization_id: organizationId,
      project_id: projectId,
      request_id: requestId,
      follow_up_id: followUpId,
    };
    const base = `/organizations/${organizationId}/projects/${projectId}/pbc-requests/${requestId}/follow-ups/${followUpId}`;
    assert.deepEqual(followUpWrite({ ...fields, intent: "submit" }), {
      intent: "submit",
      organizationId,
      projectId,
      path: `${base}/submit`,
      body: {},
    });
    const skip = followUpWrite({ ...fields, intent: "skip", version: "3" });
    assert.ok(!("error" in skip) && skip.path === `${base}/skip`);
    assert.deepEqual(!("error" in skip) ? skip.body : null, { version: 3 });
    const send = followUpWrite({
      ...fields,
      intent: "send",
      approval_id: approvalId,
    });
    assert.ok(!("error" in send) && send.path === `${base}/send`);
    assert.deepEqual(
      followUpWrite({ ...fields, intent: "skip", version: "0" }),
      { error: "invalid" },
    );
    assert.deepEqual(
      followUpWrite({ ...fields, intent: "send", approval_id: "x" }),
      { error: "invalid" },
    );
    assert.deepEqual(
      followUpWrite({ ...fields, follow_up_id: "../x", intent: "submit" }),
      { error: "invalid" },
    );
    assert.deepEqual(followUpWrite({ ...fields, intent: "delete" }), {
      error: "invalid",
    });
  });

  it("maps API outcomes to reminder notices", () => {
    assert.equal(
      followUpNoticeFor("submit", 200, "", ""),
      "reminder-submitted",
    );
    assert.equal(followUpNoticeFor("skip", 200, "", ""), "reminder-skipped");
    assert.equal(
      followUpNoticeFor("send", 200, "", "ACCEPTED"),
      "reminder-sent",
    );
    assert.equal(
      followUpNoticeFor("send", 200, "", "FAILED"),
      "reminder-failed",
    );
    assert.equal(followUpNoticeFor("send", 200, "", "UNKNOWN"), "uncertain");
    assert.equal(
      followUpNoticeFor("send", 409, "approval is not approved", ""),
      "awaiting",
    );
    assert.equal(
      followUpNoticeFor("submit", 409, "request is not open", ""),
      "reminder-closed",
    );
    assert.equal(
      followUpNoticeFor("submit", 409, "recipient is not allowed", ""),
      "recipient",
    );
    assert.equal(followUpNoticeFor("submit", 403, "", ""), "denied");
    assert.equal(followUpNoticeFor("submit", 404, "", ""), "invalid");
    assert.equal(followUpNoticeFor("submit", 0, "", ""), "unavailable");
    assert.equal(parseEvidenceNotice("reminder-sent"), "reminder-sent");
  });
});

describe("a reminder asked for now", () => {
  const ORG_ID = "01a13253-ec1a-7604-8944-a06dd7633ce0";
  const PROJECT_ID = "01a1327d-b92a-7bd1-b34b-845a8d89c879";
  const REQUEST_ID = "01a14cee-0a97-711a-a949-6cce92e257fd";

  it("asks the API to write one and submit it for approval", () => {
    const write = followUpWrite({
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      request_id: REQUEST_ID,
      intent: "now",
    });
    assert.ok(!("error" in write));
    assert.equal(
      write.path,
      `/organizations/${ORG_ID}/projects/${PROJECT_ID}/pbc-requests/${REQUEST_ID}/follow-ups/now`,
    );
    // Sent in one step; held, still approved, while email sending is off.
    assert.equal(
      followUpNoticeFor("now", 200, "", "ACCEPTED"),
      "reminder-sent",
    );
    assert.equal(followUpNoticeFor("now", 200, "", ""), "reminder-held");
    assert.equal(
      followUpNoticeFor("remind", 200, "", "ACCEPTED"),
      "reminder-sent",
    );
    // A due reminder is sent in one step too.
    const FOLLOW_UP_ID = "01a14cee-0000-7000-8000-0000000000f1";
    const remind = followUpWrite({
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      request_id: REQUEST_ID,
      follow_up_id: FOLLOW_UP_ID,
      intent: "remind",
    });
    assert.ok(!("error" in remind));
    assert.match(
      remind.path,
      new RegExp(`/follow-ups/${FOLLOW_UP_ID}/remind$`),
    );
    assert.equal(
      followUpNoticeFor("now", 409, "a reminder already awaits approval", ""),
      "reminder-open",
    );
    // Other intents still need the reminder they act on.
    assert.deepEqual(
      followUpWrite({
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        request_id: REQUEST_ID,
        intent: "submit",
      }),
      { error: "invalid" },
    );
  });

  it("is offered only while the request is with the recipient and none is open", () => {
    assert.equal(canFollowUpNow("SENT", false), true);
    assert.equal(canFollowUpNow("OVERDUE", false), true);
    assert.equal(canFollowUpNow("SENT", true), false);
    assert.equal(canFollowUpNow("DRAFT", false), false);
    assert.equal(canFollowUpNow("RECEIVED", false), false);
  });

  it("treats a refused send as history once the request is submitted again", () => {
    const failed = {
      id: "01a14cee-0000-7000-8000-000000000001",
      requestId: REQUEST_ID,
      approvalId: "01a14cee-0000-7000-8000-0000000000a1",
      kind: "request" as const,
      followUpId: null,
      reference: "PBC-92E257FD",
      status: "FAILED",
      deliveryConfirmed: false,
      errorCode: "live_email_disabled",
      updatedAt: "2026-10-18T03:50:46Z",
    };
    const approval = (id: string, executionStatus: string) => ({
      id,
      actionId: "mail.pbc",
      targetResource: "",
      risk: "HIGH",
      decision: "PENDING",
      decisionReason: null,
      executionStatus,
      expiresAt: "2026-10-25T00:00:00Z",
      requestingUserId: "01a14cee-0000-7000-8000-0000000000b1",
      requestedByAgent: false,
      parameters: [
        ["request_ref", `pbc/${REQUEST_ID}/pbc-request-v1/abc`],
      ] as Array<[string, string]>,
    });
    assert.equal(
      supersededSend(failed, [approval(failed.approvalId, "REFUSED")]),
      false,
    );
    assert.equal(
      supersededSend(failed, [
        approval(failed.approvalId, "REFUSED"),
        approval("01a14cee-0000-7000-8000-0000000000a2", "NOT_STARTED"),
      ]),
      true,
    );
  });
});
