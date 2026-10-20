/**
 * Where a control's evidence stands in the workflow, and what a person does next, from
 * the records alone: the evidence plan, each request, and its approval. One derivation
 * that the control's Overview, its header, and its Evidence tab all read, so they never
 * disagree. The API decides who may do what; this only says it.
 *
 * Planning comes first. A request drafted at kickoff, before the control's evidence was
 * planned, is held until the evidence is planned and a person settles it against the
 * plan (evidence_plans.reconcile); it is not reviewed or submitted around the plan.
 */

import type { ControlRequest, ControlRow } from "./engagement-model.ts";
import type { EvidencePlan } from "./evidence-plan-model.ts";
import type { EvidenceView } from "./evidence-workspace-model.ts";

export type RequestStage =
  | "DRAFTED"
  | "RETURNED"
  | "HELD"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "APPROVAL_EXPIRED"
  | "SEND_FAILED"
  | "SEND_AGAIN"
  | "WITH_OWNER"
  | "OVERDUE"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

/** Who moves a request on from each stage. */
export type StageOwner = "PREPARER" | "APPROVER" | "CLIENT" | "NONE";

export const REQUEST_STAGES: Record<
  RequestStage,
  { label: string; owner: StageOwner; tone: "plain" | "info" | "warn" | "done" }
> = {
  DRAFTED: {
    label: "Drafted, for review",
    owner: "PREPARER",
    tone: "plain",
  },
  RETURNED: {
    label: "Returned for revision",
    owner: "PREPARER",
    tone: "warn",
  },
  HELD: {
    label: "Held for planning",
    owner: "PREPARER",
    tone: "warn",
  },
  AWAITING_APPROVAL: {
    label: "Awaiting approval",
    owner: "APPROVER",
    tone: "info",
  },
  APPROVED: { label: "Approved, not sent", owner: "PREPARER", tone: "info" },
  APPROVAL_EXPIRED: {
    label: "Approval expired",
    owner: "PREPARER",
    tone: "warn",
  },
  SEND_FAILED: {
    label: "Not sent: submit again",
    owner: "PREPARER",
    tone: "warn",
  },
  SEND_AGAIN: {
    label: "Approved, not sent",
    owner: "PREPARER",
    tone: "warn",
  },
  WITH_OWNER: { label: "Awaiting evidence", owner: "CLIENT", tone: "info" },
  OVERDUE: { label: "Overdue with the owner", owner: "CLIENT", tone: "warn" },
  RECEIVED: { label: "Received", owner: "NONE", tone: "done" },
  CLOSED: { label: "Closed", owner: "NONE", tone: "done" },
  CANCELLED: { label: "Cancelled", owner: "NONE", tone: "plain" },
};

/** A kickoff draft waits for planning and a person's decision before anything else. */
export function heldForPlanning(
  request: ControlRequest,
  control: Pick<ControlRow, "evidencePlan" | "reconcile">,
): boolean {
  // A request drafted from a plan no person has approved waits for the approval
  // (evidence_plans: the planning gate); a kickoff draft waits for the plan and then
  // for a person to reconcile it.
  if (
    control.evidencePlan === "PROPOSED" &&
    (request.status === "DRAFT" || request.status === "APPROVAL_PENDING")
  ) {
    return true;
  }
  return (
    request.kickoff === true &&
    request.status === "DRAFT" &&
    (control.evidencePlan === "NONE" || control.reconcile === true)
  );
}

export function requestStage(
  request: ControlRequest,
  control: Pick<ControlRow, "evidencePlan" | "reconcile"> = {},
): RequestStage {
  switch (request.status) {
    case "CANCELLED":
      return "CANCELLED";
    case "CLOSED":
      return "CLOSED";
    case "RECEIVED":
      return "RECEIVED";
    case "OVERDUE":
    case "ESCALATED":
      return "OVERDUE";
    case "DRAFT":
      return heldForPlanning(request, control)
        ? "HELD"
        : request.approvalDecision === "REJECTED"
          ? "RETURNED"
          : "DRAFTED";
    case "APPROVAL_PENDING":
      if (heldForPlanning(request, control)) {
        return "HELD";
      }
      return request.approvalDecision === "APPROVED"
        ? "APPROVED"
        : request.approvalDecision === "EXPIRED"
          ? "APPROVAL_EXPIRED"
          : request.approvalDecision === "FAILED"
            ? "SEND_FAILED"
            : request.approvalDecision === "RESEND"
              ? "SEND_AGAIN"
              : "AWAITING_APPROVAL";
    default:
      // SENT, WAITING_FOR_RESPONSE, PARTIALLY_RECEIVED: the owner has it.
      return "WITH_OWNER";
  }
}

/** Where a link opens on the Evidence tab: a view, and the record to open in it. */
export type EvidenceTarget = { view: EvidenceView; request?: string };

/** Where work is done when it is not on the control's Evidence tab: the evidence plan is
 * reviewed and approved with the rest of the test plan, on the Test plans page. */
export type ActionPage = "test-plan";

export type EvidenceActionKind =
  | "approve_plan"
  | "plan"
  | "reconcile"
  | "revise"
  | "review"
  | "approve"
  | "await"
  | "send"
  | "resubmit"
  | "judge";

export type EvidenceAction = {
  /** Stable for the same piece of work. */
  key: string;
  kind: EvidenceActionKind;
  title: string;
  detail: string;
  target: EvidenceTarget;
  /** Done on another page, not on the Evidence tab. */
  page?: ActionPage;
  /** The person reading can do it (their rights; the API checks again). */
  mine: boolean;
};

// Planning first; then work already in flight (returned to its preparer, waiting for an
// approver, approved and not sent), before starting on new drafts.
const ORDER: EvidenceActionKind[] = [
  "approve_plan",
  "plan",
  "reconcile",
  "revise",
  "approve",
  "send",
  "resubmit",
  "review",
  "judge",
  "await",
];

const PHASE_WORDS: Record<string, string> = {
  DESIGN: "design",
  INTERIM: "interim",
  ROLLFORWARD: "roll-forward",
  RETEST: "retest",
  REMEDIATION: "remediation",
};

function about(request: ControlRequest): string {
  const phase = PHASE_WORDS[request.phase ?? ""] ?? "";
  return `${phase !== "" ? `The ${phase} request` : "The request"}${request.recipient ? ` to ${request.recipient}` : ""}`;
}

/** What a person does next on the control's evidence, most pressing first: one item per
 * record, so each opens the record it is about. */
export function evidenceActions(input: {
  control: Pick<
    ControlRow,
    "id" | "requests" | "evidencePlan" | "reconcile" | "included"
  >;
  plan: EvidencePlan | null;
  /** May prepare and submit requests (task.update). */
  canAct: boolean;
  /** May approve outbound requests (project.update): approves an agent's draft itself. */
  canApprove?: boolean;
  /** Reader proposals waiting for a person's judgment. */
  proposals: number;
}): EvidenceAction[] {
  const { control, plan } = input;
  const canApprove = input.canApprove === true;
  // Approving an agent's draft is part of reviewing it.
  const canAct = input.canAct || canApprove;
  if (control.included === false) {
    return [];
  }
  const actions: EvidenceAction[] = [];
  const live = control.requests.filter(
    (request) => request.status !== "CANCELLED",
  );
  const kickoff = live.find(
    (request) => request.kickoff === true && heldForPlanning(request, control),
  );
  if (control.evidencePlan === "PROPOSED") {
    actions.push({
      key: `plan-${control.id}-approve`,
      kind: "approve_plan",
      title:
        plan !== null && plan.attention.length > 0
          ? "The evidence plan needs your judgment"
          : "Review and approve the evidence plan",
      detail:
        plan !== null && plan.attention.length > 0
          ? `The planner left ${plan.attention.length === 1 ? "one point" : `${plan.attention.length} points`} for you: ${plan.attention[0]}${plan.attention.length > 1 ? ` (and ${plan.attention.length - 1} more, listed on the test plan)` : ""}. Resolve ${plan.attention.length === 1 ? "it" : "them"}, then approve the plan. Nothing is requested before you approve it.`
          : "The evidence planner proposed what each testing phase needs. Check the planned items on the test plan, mark any that do not apply, then approve. Approving the plan approves its attributes with it. Nothing is requested before approval; the requests are drafted then, and each still needs an approver before it is sent.",
      target: { view: "requirements" },
      page: "test-plan",
      mine: canAct,
    });
  } else if (control.evidencePlan === "NONE") {
    actions.push({
      key: `plan-${control.id}`,
      kind: "plan",
      title: "Plan the evidence",
      detail:
        kickoff !== undefined
          ? "A request was drafted at kickoff, before the evidence for this control was planned. Plan the evidence first; the kickoff draft is then either replaced by the planned requests or retained."
          : "The evidence planner determines what each testing phase requires and why. Requests are drafted from the plan.",
      target: { view: "plan" },
      mine: canAct,
    });
  } else if (
    kickoff !== undefined &&
    plan !== null &&
    plan.reconcile !== null &&
    plan.reconcile.waitingItems > 0
  ) {
    actions.push({
      key: `reconcile-${kickoff.id}-${kickoff.version}`,
      kind: "reconcile",
      title: "Reconcile the kickoff draft with the evidence plan",
      detail: `This request predates the evidence plan. ${plan.reconcile.waitingItems} planned item${plan.reconcile.waitingItems === 1 ? " depends" : "s depend"} on this decision: replace the draft with the planned requests, or retain it for those items.`,
      target: { view: "requests", request: kickoff.id },
      mine: canAct,
    });
  }
  for (const request of live) {
    const stage = requestStage(request, control);
    const target: EvidenceTarget = { view: "requests", request: request.id };
    const base = { target, key: `${stage}-${request.id}-${request.version}` };
    if (stage === "RETURNED") {
      actions.push({
        ...base,
        kind: "revise",
        title: "Revise the returned request",
        detail: `${about(request)} was returned for revision${request.approvalDecidedBy ? ` by ${request.approvalDecidedBy}` : ""}: ${request.approvalReason ?? "see the approver's comments"}.`,
        mine: canAct,
      });
    } else if (stage === "DRAFTED" && request.draftedBy === "PERSON") {
      actions.push({
        ...base,
        kind: "review",
        title: "Send the request",
        detail:
          request.recipient === ""
            ? `${about(request)} has no recipient yet. Open it to choose who it goes to.`
            : `${about(request)} was written by a person, so it goes to the recipient without a second approval. Open it to send.`,
        mine: canAct,
      });
    } else if (stage === "DRAFTED") {
      actions.push({
        ...base,
        kind: "review",
        title: canApprove
          ? "Review and approve the drafted request"
          : "Review the drafted request",
        detail:
          request.recipient === ""
            ? `${about(request)} has been drafted but has no recipient. Open it to assign a recipient before approval.`
            : canApprove
              ? `${about(request)} has been drafted. Review it, edit if required, and approve it for sending.`
              : `${about(request)} has been drafted. Review it and submit it for approval.`,
        mine: canAct,
      });
    } else if (stage === "AWAITING_APPROVAL") {
      const decides = request.viewerCanDecide === true;
      actions.push({
        ...base,
        kind: decides ? "approve" : "await",
        title: decides ? "Approve the request" : "Awaiting approval",
        detail: decides
          ? `${about(request)} is awaiting your approval. Approve it, or return it for revision with comments.`
          : `${about(request)} has been submitted and is awaiting an authorized approver.`,
        mine: decides,
      });
    } else if (stage === "APPROVED") {
      actions.push({
        ...base,
        kind: "send",
        title: "Send the approved request",
        detail: `${about(request)} is approved and ready to send.`,
        mine: canAct,
      });
    } else if (stage === "APPROVAL_EXPIRED") {
      actions.push({
        ...base,
        kind: "resubmit",
        title: "Submit the request again",
        detail: `${about(request)} was not decided before its approval request expired. Resubmit it for approval.`,
        mine: canAct,
      });
    } else if (stage === "SEND_AGAIN") {
      actions.push({
        ...base,
        kind: "send",
        title: "Send the approved request",
        detail: `${about(request)} was approved, and nothing went out because email sending was off. Send it now: its approval carries over.`,
        mine: canAct,
      });
    } else if (stage === "SEND_FAILED") {
      actions.push({
        ...base,
        kind: "resubmit",
        title: "Submit the request again",
        detail: `${about(request)} was approved, but sending was refused, so nothing went out (for example, email sending was off at the time). Submit it again for approval, then send it.`,
        mine: canAct,
      });
    }
  }
  if (input.proposals > 0) {
    actions.push({
      key: `judge-${control.id}-${input.proposals}`,
      kind: "judge",
      title: "Assess the evidence received",
      detail: `${input.proposals} item${input.proposals === 1 ? " has" : "s have"} been received and read. Review the evidence reader's assessment and record a conclusion.`,
      target: { view: "requirements" },
      mine: canAct,
    });
  }
  return actions.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

const KIND_LABELS: Record<EvidenceActionKind, [string, string]> = {
  approve_plan: ["Approve plan", "Approve plan"],
  plan: ["Plan the evidence", "Plan the evidence"],
  reconcile: ["Reconcile the kickoff draft", "Reconcile the kickoff drafts"],
  revise: ["Revise returned request", "Revise returned requests"],
  review: ["Review drafted request", "Review drafted requests"],
  approve: ["Approve request", "Approve requests"],
  send: ["Send approved request", "Send approved requests"],
  resubmit: ["Resubmit request", "Resubmit requests"],
  judge: ["Assess received item", "Assess received items"],
  await: ["Awaiting approval", "Awaiting approval"],
};

/** The one button the Evidence tab leads with: the first thing the person can do, with
 * how many of its kind there are, opening the first of them. */
export function primaryAction(
  actions: readonly EvidenceAction[],
): { label: string; action: EvidenceAction } | null {
  const first = actions.find((action) => action.mine);
  if (first === undefined) {
    return null;
  }
  const same = actions.filter(
    (action) => action.mine && action.kind === first.kind,
  ).length;
  const [one, many] = KIND_LABELS[first.kind];
  return {
    label:
      first.kind === "plan" ||
      first.kind === "approve_plan" ||
      first.kind === "reconcile"
        ? one
        : `${same === 1 ? one : many} (${same})`,
    action: first,
  };
}

/** The Evidence tab's address for a target, from the tab's own address. */
export function evidenceHref(tabHref: string, target: EvidenceTarget): string {
  const [path, hash] = tabHref.split("#");
  const join = path?.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ ev: target.view });
  if (target.request !== undefined) {
    params.set("request", target.request);
  }
  return `${path ?? ""}${join}${params.toString()}${hash !== undefined ? `#${hash}` : ""}`;
}

/** What waits for a person, in words, for the agents panel. */
export function waitingWords(actions: readonly EvidenceAction[]): string {
  const mine = actions.filter((action) => action.mine).length;
  return mine === 0
    ? actions.some((action) => action.kind === "await")
      ? "Awaiting approval; no other action is required"
      : "No evidence actions require your attention"
    : `${mine} ${mine === 1 ? "item requires" : "items require"} your attention`;
}
