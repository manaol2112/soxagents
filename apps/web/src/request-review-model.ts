/**
 * One evidence request under review on its control: the request as stored, and the
 * calls a person makes on it (edit, submit, ask the drafter again, approve or return,
 * send), each checked here before it reaches the API, which checks again.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SECRET =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i;

export const MAX_DESCRIPTION = 80_000;

/** The request as stored (GET …/pbc-requests/{id}). */
export type RequestDetail = {
  id: string;
  status: string;
  recipient: string;
  dueAt: string;
  description: string;
  controlRef: string;
  version: number;
  attachmentRefs: string[];
  followUpDays: number;
  maxFollowUps: number;
  /** People copied on the email besides the recipient (migration 0075). */
  ccRecipients: string[];
  priority: "NORMAL" | "HIGH" | "URGENT";
  testingPhase: string | null;
  /** The control it asks evidence for. */
  engagementControlId: string | null;
  /** Who drafted it: the evidence coordinator or a person (migration 0076). */
  draftedBy: "AGENT" | "PERSON";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRequestDetail(value: unknown): RequestDetail | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string" ||
    typeof value.evidence_description !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    status: value.status,
    recipient: typeof value.recipient === "string" ? value.recipient : "",
    dueAt: typeof value.due_at === "string" ? value.due_at : "",
    description: value.evidence_description,
    controlRef: typeof value.control_ref === "string" ? value.control_ref : "",
    version: typeof value.version === "number" ? value.version : 1,
    attachmentRefs: Array.isArray(value.attachment_refs)
      ? value.attachment_refs.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    followUpDays:
      typeof value.follow_up_after_days === "number"
        ? value.follow_up_after_days
        : 3,
    maxFollowUps:
      typeof value.max_follow_ups === "number" ? value.max_follow_ups : 2,
    ccRecipients: Array.isArray(value.cc_recipients)
      ? value.cc_recipients.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    priority:
      value.priority === "HIGH" || value.priority === "URGENT"
        ? value.priority
        : "NORMAL",
    testingPhase:
      typeof value.testing_phase === "string" ? value.testing_phase : null,
    engagementControlId:
      typeof value.engagement_control_id === "string"
        ? value.engagement_control_id
        : null,
    draftedBy: value.drafted_by === "AGENT" ? "AGENT" : "PERSON",
  };
}

export type ReviewIntent =
  | "save"
  | "submit"
  | "approve"
  | "redraft"
  | "decide"
  | "send"
  | "resend"
  | "send-direct";

export type ReviewWrite =
  | { error: "invalid" }
  | { intent: ReviewIntent; path: string; body: Record<string, unknown> };

type Fields = Record<string, unknown>;
const text = (fields: Fields, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string).trim() : "";
const whole = (fields: Fields, name: string, min: number, max: number) => {
  const value = Number(fields[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
};

/** The API call for one action on a request, checked before it is sent. */
export function reviewWrite(fields: Fields): ReviewWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const requestId = text(fields, "request_id");
  const intent = text(fields, "intent") as ReviewIntent;
  if (![organizationId, projectId, requestId].every((id) => UUID.test(id))) {
    return { error: "invalid" };
  }
  const project = `/organizations/${organizationId}/projects/${projectId}`;
  const request = `${project}/pbc-requests/${requestId}`;
  const version = whole(fields, "version", 1, 1_000_000);
  switch (intent) {
    case "submit":
      return version === null
        ? { error: "invalid" }
        : { intent, path: `${request}/submit`, body: { version } };
    case "approve": {
      // The reviewer approves the agent's draft as it stands (outbound._approve_draft).
      const note = text(fields, "reason") || "Reviewed and approved.";
      return version === null || note.length > 500 || SECRET.test(note)
        ? { error: "invalid" }
        : {
            intent,
            path: `${request}/approve`,
            body: { version, reason: note },
          };
    }
    case "redraft":
      return { intent, path: `${request}/redraft`, body: {} };
    case "send-direct":
      // A request a person wrote goes straight to its recipient.
      return version === null
        ? { error: "invalid" }
        : { intent, path: `${request}/send-direct`, body: { version } };
    case "resend":
      // Sent again on the approval it had: nothing went out because email was off.
      return { intent, path: `${request}/resend`, body: {} };
    case "send": {
      const approvalId = text(fields, "approval_id");
      return UUID.test(approvalId)
        ? { intent, path: `${request}/send`, body: { approval_id: approvalId } }
        : { error: "invalid" };
    }
    case "decide": {
      const approvalId = text(fields, "approval_id");
      const decision = text(fields, "decision");
      const reason = text(fields, "reason");
      return UUID.test(approvalId) &&
        (decision === "APPROVED" || decision === "REJECTED") &&
        reason.length >= (decision === "REJECTED" ? 3 : 1) &&
        reason.length <= 500 &&
        !SECRET.test(reason)
        ? {
            intent,
            path: `${project}/approvals/${approvalId}/decision`,
            body: { decision, reason },
          }
        : { error: "invalid" };
    }
    case "save": {
      // Only a draft is edited; the API keeps the rest of the request as it was.
      const description =
        typeof fields.description === "string" ? fields.description.trim() : "";
      const recipient = text(fields, "recipient").toLowerCase();
      const due = text(fields, "due_date");
      const controlRef = text(fields, "control_ref");
      const days = whole(fields, "follow_up_after_days", 1, 30);
      const most = whole(fields, "max_follow_ups", 0, 10);
      const refs = Array.isArray(fields.attachment_refs)
        ? fields.attachment_refs.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      if (
        version === null ||
        description === "" ||
        description.length > MAX_DESCRIPTION ||
        SECRET.test(description) ||
        (recipient !== "" && !EMAIL.test(recipient)) ||
        !DATE.test(due) ||
        controlRef === "" ||
        days === null ||
        most === null ||
        refs.length > 20
      ) {
        return { error: "invalid" };
      }
      return {
        intent,
        path: request,
        body: {
          version,
          status: "DRAFT",
          recipient,
          due_at: `${due}T23:59:00+00:00`,
          evidence_description: description,
          control_ref: controlRef,
          attachment_refs: refs,
          follow_up_after_days: days,
          max_follow_ups: most,
          outbound_message_id: null,
          thread_id: null,
          cancellation_reason: "",
        },
      };
    }
    default:
      return { error: "invalid" };
  }
}

/** What to tell the person when a call did not go through, or null when it did. */
export function reviewProblem(status: number, detail: string): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 403) {
    return "Your role does not permit this action.";
  }
  if (status === 409) {
    const known: Record<string, string> = {
      "requester cannot approve":
        "Requests cannot be approved by their submitter. An authorized approver other than the submitter must decide it.",
      "approval is already decided":
        "A decision has already been recorded. The page shows the current status.",
      "pbc request changed":
        "The request was updated since the page loaded. The latest version is now shown.",
      "request is already sent": "This request has already been sent.",
      "request is no longer a draft":
        "The request is no longer a draft and cannot be redrafted.",
      "plan the evidence first":
        "Plan the evidence first. This request was drafted before evidence planning.",
      "settle the kickoff draft against the plan first":
        "Reconcile this kickoff draft with the evidence plan first.",
      "another person submitted this request":
        "Another person submitted this request for approval. They can send it, or an approver can approve it.",
      "the agent's draft is reviewed and approved first":
        "The evidence coordinator drafted this request, so a person reviews and approves it first.",
      "this request needs approval":
        "This message changed, or was refused for another reason, so it needs a new approval. Submit it again.",
      "live email is off":
        "Email sending is off, so nothing was sent. The approval still stands: send again once email sending is on.",
      "recipient is not allowed":
        "This recipient is not permitted for outbound email in this environment.",
      "only an agent's draft is approved by its reviewer":
        "This request was prepared manually and requires approval by another authorized person. Submit it for approval.",
      "request is not a draft":
        "The request is no longer a draft. The page shows the current status.",
      "the evidence coordinator is not set up":
        "The evidence coordinator is not active for this firm. Submit the request for approval instead.",
      "approve the evidence plan first":
        "Approve the control's evidence plan first. Requests are released once it is approved.",
      "settle the control's attributes first":
        "Settle the control's attributes first. Operating evidence follows them.",
      "set who the request goes to first":
        "No recipient is assigned. Assign the evidence coordinator on the Evidence page, or set the recipient when editing the request.",
    };
    // The request details checks (request_details.py) answer in sentences written
    // for people: shown as they are.
    if (known[detail] === undefined && /^[A-Z][^\n]{2,300}\.$/.test(detail)) {
      return detail;
    }
    return (
      known[detail] ??
      "The action could not be completed in the request's current state."
    );
  }
  if (status === 422) {
    return "Review the information entered and try again.";
  }
  return "The action could not be completed. Please try again.";
}
