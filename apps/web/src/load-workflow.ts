import { cookies } from "next/headers";

import { apiGet, sessionToken } from "./load-workspace";
import type { ShellModel } from "./shell-model";
import {
  countActiveAgents,
  EMPTY_WORKFLOW,
  parseApprovals,
  parseDecisionNotice,
  parseEvidence,
  parseEvidenceNotice,
  parseMailboxMode,
  parseOutbound,
  type WorkflowState,
} from "./workflow-model";

export async function loadWorkflow(
  model: ShellModel,
  notice: string | null,
): Promise<WorkflowState> {
  if (model.status !== "ready") {
    return EMPTY_WORKFLOW;
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const section = model.section;
  const organizationId = model.organization.id;
  const project = model.selectedProject;
  const base =
    project === null
      ? null
      : `/organizations/${organizationId}/projects/${project.id}`;
  const tracksDelivery =
    base !== null && (section === "evidence" || section === "approvals");
  const [me, approvals, evidence, agents, outbound, mailbox] =
    await Promise.all([
      apiGet("/auth/me", session),
      base === null ? null : apiGet(`${base}/approvals`, session),
      base !== null && (section === "overview" || section === "evidence")
        ? apiGet(`${base}/pbc-requests`, session)
        : null,
      section === "overview"
        ? apiGet(`/organizations/${organizationId}/agents`, session)
        : null,
      tracksDelivery ? apiGet(`${base}/outbound-messages`, session) : null,
      tracksDelivery ? apiGet("/mailbox/configuration", session) : null,
    ]);
  const userId =
    me.status === 200 &&
    typeof me.body === "object" &&
    me.body !== null &&
    "id" in me.body &&
    typeof me.body.id === "string"
      ? me.body.id
      : null;
  return {
    userId,
    approvals:
      approvals !== null && approvals.status === 200
        ? parseApprovals(approvals.body)
        : null,
    evidence:
      evidence !== null && evidence.status === 200
        ? parseEvidence(evidence.body)
        : null,
    outbound:
      outbound !== null && outbound.status === 200
        ? parseOutbound(outbound.body)
        : null,
    mailboxMode:
      mailbox !== null && mailbox.status === 200
        ? parseMailboxMode(mailbox.body)
        : null,
    activeAgents:
      agents !== null && agents.status === 200
        ? countActiveAgents(agents.body)
        : null,
    decisionNotice:
      section === "approvals" ? parseDecisionNotice(notice) : null,
    evidenceNotice: section === "evidence" ? parseEvidenceNotice(notice) : null,
    operationKey: `evidence-${crypto.randomUUID()}`,
  };
}
