import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attentionQueue,
  followUpNoticeFor,
  followUpWrite,
  latestOutbound,
  parseApprovals,
  parseEvidence,
  parseEvidenceNotice,
  parseFollowUps,
  parseOutbound,
  reminderStep,
  remindersSent,
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

  it("puts due reminders in the decision queue", () => {
    const queue = attentionQueue({
      tasks: [],
      evidence:
        parseEvidence([
          {
            id: requestId,
            control_ref: "ITGC-AC-01",
            recipient: "owner@example.com",
            due_at: "2026-11-01T23:59:00Z",
            evidence_description: "User access listing.",
            status: "WAITING_FOR_RESPONSE",
            attachment_refs: [],
            version: 2,
          },
        ]) ?? [],
      approvals: [],
      now,
      followUps:
        parseFollowUps([
          followUp(),
          followUp({
            id: "88888888-8888-7888-8888-888888888889",
            status: "SENT",
            closed_at: "2026-10-09T10:00:00Z",
            approval_id: approvalId,
            outbound_id: approvalId,
          }),
        ]) ?? [],
    });
    assert.deepEqual(
      queue.map((item) => [item.kind, item.title]),
      [["reminder", "ITGC-AC-01"]],
    );
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
