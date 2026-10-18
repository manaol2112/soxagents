import { cookies } from "next/headers";
import {
  parseAnalyses,
  parseEvidenceSettings,
  parseReviews,
} from "./analysis-model";
import { parseInbox } from "./console-model";
import { parseDrafts } from "./draft-model";
import { parseChangeNotice } from "./evidence-change-model";
import { parseFilingNotice, parseRegister } from "./evidence-model";
import { apiGet, sessionToken } from "./load-workspace";
import { parseRecipientLinks } from "./portal-model";
import type { ShellModel } from "./shell-model";
import {
  countActiveAgents,
  EMPTY_WORKFLOW,
  parseApprovals,
  parseDecisionNotice,
  parseEvidence,
  parseEvidenceContacts,
  parseEvidenceFiles,
  parseEvidenceNotice,
  parseFollowUps,
  parseInbound,
  parseMailboxMode,
  parseOutbound,
  parseWorkforce,
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
  const tracksEvidence =
    base !== null && (section === "overview" || section === "evidence");
  const workforcePath =
    section === "agents"
      ? `/organizations/${organizationId}/standard-workforce${project === null ? "" : `?project_id=${project.id}`}`
      : null;
  const [
    me,
    approvals,
    evidence,
    agents,
    outbound,
    mailbox,
    inbound,
    workforce,
    followUps,
    evidenceFiles,
    drafts,
    analyses,
    evidenceSettings,
    reviews,
    register,
    contacts,
    portalLinks,
    inbox,
  ] = await Promise.all([
    apiGet("/auth/me", session),
    base === null ? null : apiGet(`${base}/approvals`, session),
    tracksEvidence ? apiGet(`${base}/pbc-requests`, session) : null,
    section === "overview"
      ? apiGet(`/organizations/${organizationId}/agents`, session)
      : null,
    tracksDelivery ? apiGet(`${base}/outbound-messages`, session) : null,
    apiGet("/mailbox/configuration", session),
    tracksEvidence ? apiGet(`${base}/inbound-messages`, session) : null,
    workforcePath === null ? null : apiGet(workforcePath, session),
    tracksEvidence ? apiGet(`${base}/follow-ups`, session) : null,
    tracksEvidence ? apiGet(`${base}/evidence-files`, session) : null,
    tracksEvidence ? apiGet(`${base}/pbc-drafts`, session) : null,
    tracksEvidence ? apiGet(`${base}/evidence-analyses`, session) : null,
    section === "agents"
      ? apiGet(`/organizations/${organizationId}/evidence-settings`, session)
      : null,
    tracksEvidence ? apiGet(`${base}/evidence-reviews`, session) : null,
    base !== null && section === "evidence"
      ? apiGet(`${base}/evidence-register`, session)
      : null,
    base !== null && section === "evidence"
      ? apiGet(`${base}/onboarding/evidence-contacts`, session)
      : null,
    base !== null && section === "evidence"
      ? apiGet(`${base}/evidence-portal/links`, session)
      : null,
    base !== null && section === "overview"
      ? apiGet(`${base}/console/inbox`, session)
      : null,
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
    followUps:
      followUps !== null && followUps.status === 200
        ? parseFollowUps(followUps.body)
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
    drafts:
      drafts !== null && drafts.status === 200
        ? parseDrafts(drafts.body)
        : null,
    operationKey: `evidence-${crypto.randomUUID()}`,
    inbound:
      inbound !== null && inbound.status === 200
        ? parseInbound(inbound.body)
        : null,
    evidenceFiles:
      evidenceFiles !== null && evidenceFiles.status === 200
        ? parseEvidenceFiles(evidenceFiles.body)
        : null,
    evidenceRegister:
      register !== null && register.status === 200
        ? parseRegister(register.body)
        : null,
    filingNotice: section === "evidence" ? parseFilingNotice(notice) : null,
    changeNotice: section === "evidence" ? parseChangeNotice(notice) : null,
    evidenceAnalyses:
      analyses !== null && analyses.status === 200
        ? parseAnalyses(analyses.body)
        : null,
    evidenceReviews:
      reviews !== null && reviews.status === 200
        ? parseReviews(reviews.body)
        : null,
    evidenceSettings:
      evidenceSettings !== null && evidenceSettings.status === 200
        ? parseEvidenceSettings(evidenceSettings.body)
        : null,
    evidenceContacts:
      contacts !== null && contacts.status === 200
        ? parseEvidenceContacts(contacts.body)
        : null,
    portalLinks:
      portalLinks !== null && portalLinks.status === 200
        ? parseRecipientLinks(portalLinks.body)
        : null,
    inbox:
      inbox !== null && inbox.status === 200 ? parseInbox(inbox.body) : null,
    workforce:
      workforce !== null && workforce.status === 200
        ? parseWorkforce(workforce.body)
        : null,
  };
}
