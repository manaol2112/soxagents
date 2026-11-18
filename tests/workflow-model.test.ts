import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvalRequestId,
  approvalState,
  auditPhase,
  awaitingDecision,
  canDecide,
  canRequestEvidence,
  canRetryDelivery,
  countActiveAgents,
  decisionNoticeFor,
  decisionWrite,
  deliveryLabel,
  evidenceNoticeFor,
  evidenceWrite,
  inboundNoticeFor,
  inboundWrite,
  isLateEvidence,
  latestOutbound,
  outboundNoticeFor,
  outboundWrite,
  parseApprovals,
  parseDecisionNotice,
  parseEvidence,
  parseEvidenceNotice,
  parseInbound,
  parseMailboxMode,
  parseOutbound,
  parseWorkforce,
  pendingApprovals,
  readyToSend,
} from "../apps/web/src/workflow-model.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const projectId = "22222222-2222-7222-8222-222222222222";
const approvalId = "33333333-3333-7333-8333-333333333333";
const now = Date.parse("2026-10-10T12:00:00Z");

function approval(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: approvalId,
    requesting_user_id: "44444444-4444-7444-8444-444444444444",
    requesting_agent_id: "55555555-5555-7555-8555-555555555555",
    action_id: "mail.pbc",
    parameters: {
      request_ref: "pbc/population",
      recipient: "owner@example.com",
    },
    target_resource: "pbc/population",
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

function evidence(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "66666666-6666-7666-8666-666666666666",
    control_ref: "ITGC-AC-01",
    recipient: "owner@example.com",
    due_at: "2026-11-01T23:59:00Z",
    evidence_description: "User access listing.",
    status: "WAITING_FOR_RESPONSE",
    attachment_refs: [],
    version: 1,
    ...extra,
  };
}

function evidenceFields(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    organization_id: organizationId,
    project_id: projectId,
    operation_key: "evidence-0f8b5d7e-2c1a-4b3e-9d6f-1a2b3c4d5e6f",
    control_ref: "ITGC-AC-01",
    recipient: "owner@example.com",
    due_date: "2026-11-01",
    evidence_description: "User access listing as of period end.",
    follow_up_after_days: "3",
    ...extra,
  };
}

describe("workflow model", () => {
  it("parses approvals and treats a lapsed pending approval as expired", () => {
    const parsed = parseApprovals([
      approval(),
      approval({ id: "a", expires_at: "2026-10-10T11:00:00Z" }),
      approval({ id: "b", decision: "APPROVED", requesting_agent_id: null }),
    ]);
    assert.ok(parsed !== null);
    assert.equal(parsed[0]?.requestedByAgent, true);
    assert.equal(parsed[2]?.requestedByAgent, false);
    assert.deepEqual(
      parsed[0]?.parameters.map(([key]) => key),
      ["recipient", "request_ref"],
    );
    assert.deepEqual(
      parsed.map((item) => approvalState(item, now)),
      ["pending", "expired", "approved"],
    );
    assert.equal(pendingApprovals(parsed, now).length, 1);
    assert.equal(parseApprovals([approval({ parameters: { a: 1 } })]), null);
    assert.equal(parseApprovals({}), null);
  });

  it("parses evidence and flags late requests", () => {
    const parsed = parseEvidence([
      evidence(),
      evidence({ id: "late", due_at: "2026-10-01T00:00:00Z" }),
      evidence({
        id: "done",
        status: "RECEIVED",
        due_at: "2026-10-01T00:00:00Z",
      }),
      evidence({ id: "esc", status: "ESCALATED" }),
    ]);
    assert.ok(parsed !== null);
    assert.deepEqual(
      parsed.map((item) => isLateEvidence(item, now)),
      [false, true, false, true],
    );
    assert.equal(parseEvidence([evidence({ attachment_refs: "x" })]), null);
  });

  it("maps work, evidence, and decisions onto the audit lifecycle", () => {
    assert.equal(auditPhase([]), 0);
    assert.equal(auditPhase([{ status: "DRAFT" }]), 1);
    assert.equal(auditPhase([], [{ status: "WAITING_FOR_RESPONSE" }]), 1);
    assert.equal(auditPhase([{ status: "RUNNING" }]), 2);
    assert.equal(auditPhase([{ status: "RUNNING" }, { status: "REVIEW" }]), 3);
    assert.equal(
      auditPhase([{ status: "RUNNING" }], [{ status: "WAITING_FOR_RESPONSE" }]),
      2,
    );
    assert.equal(auditPhase([{ status: "SUCCEEDED" }]), 4);
    assert.equal(
      auditPhase([{ status: "SUCCEEDED" }], [{ status: "SENT" }]),
      1,
    );
    assert.equal(auditPhase([], [{ status: "CLOSED" }]), 1);
  });

  it("counts only active agents", () => {
    assert.equal(
      countActiveAgents([{ status: "ACTIVE" }, { status: "DISABLED" }, null]),
      1,
    );
    assert.equal(countActiveAgents(null), null);
  });

  it("builds an evidence draft and rejects bad or secret input", () => {
    const write = evidenceWrite(evidenceFields());
    assert.ok(!("error" in write));
    assert.equal(
      write.path,
      `/organizations/${organizationId}/projects/${projectId}/pbc-requests`,
    );
    assert.equal(write.body.due_at, "2026-11-01T23:59:00Z");
    assert.equal(write.body.follow_up_after_days, 3);
    assert.equal("status" in write.body, false);
    for (const extra of [
      { recipient: "not-an-email" },
      { due_date: "11/01/2026" },
      { control_ref: "bad ref" },
      { evidence_description: "  " },
      { follow_up_after_days: "31" },
      { operation_key: "" },
      { project_id: "nope" },
      { evidence_description: "password: hunter2" },
    ]) {
      assert.deepEqual(evidenceWrite(evidenceFields(extra)), {
        error: "invalid",
      });
    }
    assert.equal(evidenceNoticeFor(200, ""), "saved");
    assert.equal(evidenceNoticeFor(409, "project is not active"), "inactive");
    assert.equal(
      evidenceNoticeFor(409, "pbc key is already in use"),
      "duplicate",
    );
    assert.equal(evidenceNoticeFor(403, "not allowed"), "denied");
    assert.equal(evidenceNoticeFor(0, ""), "unavailable");
  });

  it("requires a reason for a decision and maps the API outcome", () => {
    const fields = {
      organization_id: organizationId,
      project_id: projectId,
      approval_id: approvalId,
      decision: "APPROVED",
      reason: "  Matches the agreed request list. ",
    };
    const write = decisionWrite(fields);
    assert.ok(!("error" in write));
    assert.equal(
      write.path,
      `/organizations/${organizationId}/projects/${projectId}/approvals/${approvalId}/decision`,
    );
    assert.deepEqual(write.body, {
      decision: "APPROVED",
      reason: "Matches the agreed request list.",
    });
    for (const extra of [
      { reason: " " },
      { decision: "EXPIRED" },
      { approval_id: "x" },
      { reason: "token=abc api_key: x" },
    ]) {
      assert.deepEqual(decisionWrite({ ...fields, ...extra }), {
        error: "invalid",
      });
    }
    assert.equal(decisionNoticeFor(200, ""), "decided");
    assert.equal(decisionNoticeFor(409, "requester cannot approve"), "self");
    assert.equal(decisionNoticeFor(409, "approval has expired"), "expired");
    assert.equal(decisionNoticeFor(409, "approval is closed"), "closed");
    assert.equal(decisionNoticeFor(403, "not allowed"), "denied");
    assert.equal(parseDecisionNotice("decided"), "decided");
    assert.equal(parseDecisionNotice("<script>"), null);
  });

  it("lets only managers decide and keeps reviewers read-only for evidence", () => {
    assert.equal(canDecide("OWNER"), true);
    assert.equal(canDecide("PROJECT_MANAGER"), true);
    assert.equal(canDecide("CONTRIBUTOR"), false);
    assert.equal(canDecide("REVIEWER"), false);
    assert.equal(canRequestEvidence("CONTRIBUTOR"), true);
    assert.equal(canRequestEvidence("REVIEWER"), false);
  });
});

const requestId = "66666666-6666-7666-8666-666666666666";

function outbound(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "77777777-7777-7777-8777-777777777777",
    pbc_request_id: requestId,
    approval_id: approvalId,
    reference: "PBC-66666666",
    status: "ACCEPTED",
    delivery_confirmed: false,
    error_code: "",
    updated_at: "2026-10-10T11:00:00Z",
    ...extra,
  };
}

function pbcApproval(extra: Record<string, unknown> = {}) {
  return approval({
    parameters: {
      recipient: "owner@example.com",
      request_ref: `pbc/${requestId}/pbc-request-v1/0123456789abcdef`,
      subject: "[PBC-66666666] Evidence request: ITGC-AC-01",
    },
    ...extra,
  });
}

describe("outbound evidence requests", () => {
  it("parses delivery records and the mailbox mode", () => {
    const parsed = parseOutbound([outbound()]);
    assert.equal(parsed?.[0]?.requestId, requestId);
    assert.equal(parsed?.[0]?.deliveryConfirmed, false);
    assert.equal(
      parseOutbound([outbound({ delivery_confirmed: "yes" })]),
      null,
    );
    assert.equal(parseOutbound({}), null);
    assert.equal(
      parseMailboxMode({ provider: "mock", live_email_enabled: false }),
      "test",
    );
    assert.equal(
      parseMailboxMode({ provider: "unavailable", live_email_enabled: false }),
      "unavailable",
    );
    assert.equal(parseMailboxMode(null), null);
    assert.equal(parseEvidence([evidence({ version: "1" })]), null);
  });

  it("links an approval to its evidence request only through the template reference", () => {
    const [linked] = parseApprovals([pbcApproval()]) ?? [];
    const [loose] = parseApprovals([approval()]) ?? [];
    const [other] =
      parseApprovals([pbcApproval({ action_id: "mail.external" })]) ?? [];
    assert.ok(
      linked !== undefined && loose !== undefined && other !== undefined,
    );
    assert.equal(approvalRequestId(linked), requestId);
    assert.equal(approvalRequestId(loose), null);
    assert.equal(approvalRequestId(other), null);
  });

  it("offers send only for an approved, unused, unexpired approval", () => {
    const approved = parseApprovals([
      pbcApproval({ decision: "APPROVED", approver_user_id: approvalId }),
    ]);
    const pending = parseApprovals([pbcApproval()]);
    assert.ok(approved !== null && pending !== null);
    assert.equal(readyToSend(approved, [], requestId, now)?.id, approvalId);
    const used = parseOutbound([outbound()]) ?? [];
    assert.equal(readyToSend(approved, used, requestId, now), null);
    const late = Date.parse("2026-10-12T00:00:00Z");
    assert.equal(readyToSend(approved, [], requestId, late), null);
    assert.equal(readyToSend(pending, [], requestId, now), null);
    assert.equal(awaitingDecision(pending, requestId, now), true);
    assert.equal(awaitingDecision(approved, requestId, now), false);
  });

  it("never reports delivery until the provider confirms it", () => {
    const [accepted] = parseOutbound([outbound()]) ?? [];
    const [delivered] =
      parseOutbound([
        outbound({ status: "DELIVERED", delivery_confirmed: true }),
      ]) ?? [];
    const [disabled] =
      parseOutbound([
        outbound({ status: "FAILED", error_code: "live_email_disabled" }),
      ]) ?? [];
    const [unknown] =
      parseOutbound([outbound({ status: "UNKNOWN", error_code: "timeout" })]) ??
      [];
    assert.ok(
      accepted !== undefined &&
        delivered !== undefined &&
        disabled !== undefined &&
        unknown !== undefined,
    );
    assert.equal(
      deliveryLabel(accepted, "live").label,
      "Accepted · delivery not confirmed",
    );
    assert.equal(deliveryLabel(accepted, "test").label, "Test mailbox only");
    assert.equal(deliveryLabel(delivered, "live").label, "Delivered");
    assert.equal(deliveryLabel(disabled, "test").tone, "risk");
    assert.equal(deliveryLabel(unknown, "test").label, "Outcome unknown");
    assert.equal(canRetryDelivery(unknown), true);
    assert.equal(canRetryDelivery(accepted), false);
    const newer = { ...unknown, updatedAt: "2026-10-10T11:30:00Z" };
    assert.equal(
      latestOutbound([accepted, newer], requestId)?.status,
      "UNKNOWN",
    );
    assert.equal(latestOutbound([accepted], approvalId), null);
  });

  it("validates outbound form posts and maps the API outcome", () => {
    const base = {
      organization_id: organizationId,
      project_id: projectId,
      request_id: requestId,
    };
    const submit = outboundWrite({ ...base, intent: "submit", version: "3" });
    assert.ok(!("error" in submit));
    assert.equal(
      submit.path.endsWith(`/pbc-requests/${requestId}/submit`),
      true,
    );
    assert.deepEqual(submit.body, { version: 3 });
    const send = outboundWrite({
      ...base,
      intent: "send",
      approval_id: approvalId,
    });
    assert.ok(!("error" in send));
    assert.deepEqual(send.body, { approval_id: approvalId });
    assert.deepEqual(outboundWrite({ ...base, intent: "send" }), {
      error: "invalid",
    });
    assert.deepEqual(
      outboundWrite({ ...base, intent: "submit", version: "0" }),
      { error: "invalid" },
    );
    assert.deepEqual(
      outboundWrite({
        ...base,
        request_id: "../admin",
        intent: "submit",
        version: "1",
      }),
      { error: "invalid" },
    );
    assert.equal(outboundNoticeFor("submit", 200, "", ""), "submitted");
    assert.equal(outboundNoticeFor("send", 200, "", "ACCEPTED"), "sent");
    assert.equal(outboundNoticeFor("send", 200, "", "FAILED"), "failed");
    assert.equal(outboundNoticeFor("send", 200, "", "UNKNOWN"), "uncertain");
    assert.equal(
      outboundNoticeFor("submit", 409, "recipient is not allowed", ""),
      "recipient",
    );
    assert.equal(
      outboundNoticeFor("send", 409, "approval does not match", ""),
      "changed",
    );
    assert.equal(
      outboundNoticeFor("send", 409, "approval is not approved", ""),
      "awaiting",
    );
    assert.equal(outboundNoticeFor("send", 0, "", ""), "unavailable");
    assert.equal(parseEvidenceNotice("uncertain"), "uncertain");
  });
});

const inboundId = "44444444-4444-7444-8444-444444444444";
const replyRequestId = "55555555-5555-7555-8555-555555555555";

function reply(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: inboundId,
    pbc_request_id: replyRequestId,
    suggested_pbc_request_id: null,
    request_reference: "PBC-55555555",
    match_status: "MATCHED",
    match_method: "thread",
    unmatched_reason: "",
    review_state: "NEEDS_REVIEW",
    untrusted: true,
    sender: "owner@client.example",
    subject: "RE: Evidence request",
    body_text: "<b>not markup</b>",
    body_truncated: false,
    content_redacted: false,
    attachments: [
      {
        id: "77777777-7777-7777-8777-777777777777",
        file_name: "listing.csv",
        content_type: "text/csv",
        size_bytes: 2048,
        content_sha256: null,
      },
    ],
    received_at: "2026-10-10T11:00:00Z",
    triage_reason: "",
    triaged_at: null,
    reviewed_at: null,
    version: 1,
    ...extra,
  };
}

describe("inbound replies", () => {
  it("parses replies only when the API marks them untrusted", () => {
    const [parsed] = parseInbound([reply()]) ?? [];
    assert.equal(parsed?.requestId, replyRequestId);
    assert.equal(parsed?.bodyText, "<b>not markup</b>");
    assert.deepEqual(parsed?.attachments, [
      {
        id: "77777777-7777-7777-8777-777777777777",
        fileName: "listing.csv",
        contentType: "text/csv",
        sizeBytes: 2048,
      },
    ]);
    assert.equal(parseInbound([reply({ untrusted: false })]), null);
    assert.equal(parseInbound([reply({ untrusted: undefined })]), null);
    assert.equal(parseInbound([reply({ match_status: "AUTO" })]), null);
    assert.equal(parseInbound([reply({ attachments: [{}] })]), null);
    assert.equal(parseInbound({}), null);
  });

  it("builds triage and review writes from form fields", () => {
    const fields = {
      organization_id: organizationId,
      project_id: projectId,
      inbound_id: inboundId,
      version: "2",
    };
    assert.deepEqual(inboundWrite({ ...fields, intent: "review" }), {
      organizationId,
      projectId,
      intent: "review",
      path: `/organizations/${organizationId}/projects/${projectId}/inbound-messages/${inboundId}/review`,
      body: { version: 2 },
    });
    const assign = inboundWrite({
      ...fields,
      intent: "assign",
      reason: " Owner's delegate ",
      pbc_request_id: replyRequestId,
    });
    assert.ok(!("error" in assign));
    assert.deepEqual(assign.body, {
      version: 2,
      reason: "Owner's delegate",
      pbc_request_id: replyRequestId,
    });
    for (const bad of [
      { ...fields, intent: "assign", reason: "x" },
      { ...fields, intent: "dismiss", reason: "" },
      { ...fields, intent: "dismiss", reason: "password: hunter2" },
      { ...fields, intent: "delete", reason: "x" },
      { ...fields, intent: "review", version: "0" },
      { ...fields, intent: "review", inbound_id: "../approvals" },
    ]) {
      assert.deepEqual(inboundWrite(bad), { error: "invalid" });
    }
  });

  it("maps API results to notices", () => {
    assert.equal(inboundNoticeFor("assign", 200), "reply-assigned");
    assert.equal(inboundNoticeFor("dismiss", 200), "reply-dismissed");
    assert.equal(inboundNoticeFor("review", 200), "reply-reviewed");
    assert.equal(inboundNoticeFor("review", 409), "reply-changed");
    assert.equal(inboundNoticeFor("assign", 403), "denied");
    assert.equal(inboundNoticeFor("assign", 0), "unavailable");
    assert.equal(parseEvidenceNotice("reply-reviewed"), "reply-reviewed");
  });
});

describe("standard workforce", () => {
  const worker = {
    agent_key: "itgc-access-tester",
    name: "ITGC tester: access",
    role: "Tests logical access controls",
    description: "Tests user provisioning.",
    allowed_tool_ids: ["file.read", "workpaper.update"],
    model_tier: "standard",
    installed: true,
    definition_id: "88888888-8888-7888-8888-888888888888",
    definition_status: "ACTIVE",
    staffed: true,
  };

  it("parses the roster and rejects malformed workers", () => {
    const parsed = parseWorkforce({ roster_version: 1, workers: [worker] });
    assert.equal(parsed?.workers[0]?.tools.length, 2);
    assert.equal(parsed?.workers[0]?.staffed, true);
    assert.equal(parsed?.workers[0]?.definitionStatus, "ACTIVE");
    assert.equal(
      parseWorkforce({
        roster_version: 1,
        workers: [{ ...worker, staffed: "yes" }],
      }),
      null,
    );
    assert.equal(
      parseWorkforce({
        roster_version: 1,
        workers: [{ ...worker, allowed_tool_ids: [1] }],
      }),
      null,
    );
    assert.equal(parseWorkforce({ workers: [] }), null);
  });
});
