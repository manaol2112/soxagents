"use client";

import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import type { ControlRequest } from "./engagement-model";
import type { RequestStage } from "./evidence-flow";
import { RequestUpload } from "./evidence-intake";
import type { EvidencePlan } from "./evidence-plan-model";
import { Problem, usePlanAction } from "./evidence-plan-view";
import { formatDate } from "./format";
import {
  type Attachment,
  addressProblem,
  attachmentHref,
  BASIS_LABELS,
  type Check,
  CONTACT_ROLES,
  type Contact,
  composeWording,
  type DraftItemFields,
  dueHint,
  EMPTY_ITEM,
  formatBytes,
  hasClientActivity,
  initialsOf,
  itemNecessity,
  LIFECYCLE_LABELS,
  LIFECYCLE_PATH,
  type LifecycleStage,
  lifecycleOf,
  MAX_COPIED,
  MAX_REFERENCE_BYTES,
  matchContacts,
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  parseSources,
  type RequestDetails,
  requestIntro,
  SOURCE_LABELS,
  type SourceFile,
  type SourceWorkpaper,
  type WordingDraft,
  wordingDraft,
} from "./request-details-model";
import {
  MAX_DESCRIPTION,
  type RequestDetail,
  reviewProblem,
} from "./request-review-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };
type Run = (label: string, fields: Record<string, unknown>) => Promise<boolean>;

const PHASE_WORDS: Record<string, string> = {
  DESIGN: "Design",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
  RETEST: "Retest",
  REMEDIATION: "Remediation",
};

const CATEGORY_WORDS: Record<string, string> = {
  CONFIGURATION: "Configuration",
  POPULATION: "Population",
  SAMPLE: "Sample",
  PROCESS_DOCUMENTATION: "Process documentation",
  CONTROL_EXECUTION: "Control execution",
  REPORT_RELIABILITY: "Report reliability",
  CHANGE_HISTORY: "Change history",
  OTHER: "Other",
};

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function useReviewAction(ids: Ids, requestId: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/request-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          request_id: requestId,
          ...fields,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    setBusy("");
    const message = reviewProblem(status, detail);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  return {
    run,
    busy,
    pending: pending || busy !== "",
    problem,
    refresh: () => startTransition(() => router.refresh()),
    fail: setProblem,
  };
}

/**
 * One evidence request opened on its control: what the client is asked for, who it goes
 * to and who is copied, when it is due, the reference material behind it, where it
 * stands, and the next action that is the person's to take. The audit team's planning
 * is kept apart from what the client sees. Opened by its address, so a link or a
 * refresh lands on it.
 */
export function RequestReview({
  ids,
  request,
  details,
  stage,
  control,
  plan,
  planned,
  canAct,
  canApprove,
  closeHref,
  controlHref,
  inDialog = false,
  side = null,
}: {
  ids: Ids;
  request: ControlRequest;
  details: RequestDetails | null;
  stage: RequestStage;
  control: { ref: string; title: string; system: string };
  plan: EvidencePlan | null;
  /** The control's evidence is planned. */
  planned: boolean;
  /** May prepare and submit requests (task.update). */
  canAct: boolean;
  /** May approve outbound requests (project.update): the reviewer of an agent's draft
   * approves it directly; the API checks again. */
  canApprove: boolean;
  closeHref: string;
  /** Opened away from its control (the engagement's Evidence page): planning and
   * reconciling happen on the control, so the panel links there. */
  controlHref?: string | undefined;
  /** Shown in a dialog that already names the request and closes it. */
  inDialog?: boolean;
  /** Shown in the dialog's status panel: delivery and reminders, from the page. */
  side?: ReactNode;
}) {
  const id = useId();
  const review = useReviewAction(ids, request.id);
  const planAction = usePlanAction(ids);
  const [editing, setEditing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [decision, setDecision] = useState<"" | "APPROVED" | "REJECTED">("");
  const [reason, setReason] = useState("");
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [why, setWhy] = useState("");
  const detail = details?.request ?? null;
  const draft = stage === "DRAFTED" || stage === "RETURNED";
  const editable = (canAct || canApprove) && draft;
  // Only the evidence coordinator's draft is approved by its reviewer directly; a
  // person's request goes to someone else for approval.
  const approver = canApprove && (detail?.draftedBy ?? "AGENT") === "AGENT";
  // A person wrote it, not the agent: it is sent directly, without a second approval.
  const written = detail?.draftedBy === "PERSON";
  const busy = review.pending || planAction.pending;
  const status = detail?.status ?? request.status;
  const life = lifecycleOf({
    status,
    approvalDecision: request.approvalDecision ?? null,
    agentDrafted: detail?.draftedBy === "AGENT",
    // Ready for review once its wording is drafted and the planning gate lets it go.
    wordingReady:
      (details?.checks.find((check) => check.key === "instructions")?.ok ??
        true) &&
      !(details?.checks.some((check) => check.key === "planning") ?? false),
    clarification: details?.clarification ?? false,
    requirements: details?.planning.requirements ?? [],
  });
  const phase = PHASE_WORDS[detail?.testingPhase ?? request.phase ?? ""] ?? "";
  const unsent = status === "DRAFT" || status === "APPROVAL_PENDING";
  const failing = details?.checks.filter((check) => !check.ok) ?? [];
  const submitBlocked = failing.some((check) => check.key !== "type");
  const typeLabels = Object.fromEntries(
    (details?.types ?? []).map((item) => [item.key, item.label]),
  );
  const heading = details?.title || request.title || "Evidence request";
  const eyebrow = [
    details?.reference || "Evidence request",
    heading.includes(control.title)
      ? control.ref
      : `${control.ref} ${control.title}`,
    control.system,
  ].filter((part) => part !== "");
  const itemCount = details?.content.structured
    ? details.content.items.length
    : 0;
  const headPart = (
    <>
      <header className="rr-head">
        <div className="rr-head-main">
          {inDialog ? null : (
            <>
              <p className="rr-eyebrow">{eyebrow.join(" · ")}</p>
              <h3 id={`${id}-title`}>{heading}</h3>
            </>
          )}
          <ul className="rr-badges" aria-label="Request attributes">
            {details !== null ? (
              <li>
                <span
                  className={`rr-badge rr-type${details.type.uncertain ? " is-warn" : ""}`}
                  title={details.type.reason}
                >
                  {details.type.uncertain
                    ? `Recommended: ${details.type.label}`
                    : details.type.label}
                </span>
              </li>
            ) : null}
            {phase !== "" ? (
              <li>
                <span className="rr-badge">{phase} phase</span>
              </li>
            ) : null}
            {detail !== null && detail.priority !== "NORMAL" ? (
              <li>
                <span
                  className={`rr-badge is-${detail.priority.toLowerCase()}`}
                >
                  {PRIORITY_LABELS[detail.priority]} priority
                </span>
              </li>
            ) : null}
            {itemCount > 0 ? (
              <li>
                <span className="rr-badge">
                  {itemCount} item{itemCount === 1 ? "" : "s"}
                </span>
              </li>
            ) : null}
            <li>
              <span className="rr-badge">
                Due {formatDate(detail?.dueAt || request.dueAt)}
              </span>
            </li>
            {status === "OVERDUE" ? (
              <li>
                <span className="rr-badge is-urgent">Overdue</span>
              </li>
            ) : null}
          </ul>
        </div>
        {inDialog ? null : (
          <span className={`rr-stage is-${life.tone}`}>{life.label}</span>
        )}
        {inDialog ? null : (
          <a
            className="rr-close"
            href={closeHref}
            aria-label="Close the request"
          >
            <UiIcon name="x" size={15} />
          </a>
        )}
      </header>

      <LifecycleTrack stage={life} />
    </>
  );
  const calloutPart = (
    <>
      {stage === "RETURNED" && request.approvalReason ? (
        <p className="rr-callout is-warn">
          <UiIcon name="risk" size={14} />
          <span>
            <strong>Changes requested.</strong> {request.approvalReason}
          </span>
        </p>
      ) : null}

      {details?.clarification ? (
        <p className="rr-callout is-warn">
          <UiIcon name="mail" size={14} />
          <span>
            <strong>Clarification needed.</strong> The recipient replied to this
            request. Review the reply in the Inbox.
          </span>
        </p>
      ) : null}

      {stage === "HELD" ? (
        <div className="rr-callout is-warn rr-hold">
          <UiIcon name="risk" size={14} />
          <div>
            <p>
              <strong>Drafted before planning.</strong>{" "}
              {plan?.status === "PROPOSED"
                ? "The evidence coordinator drafted this request from a plan that has not been approved. Approve the control's evidence plan to release it for review."
                : controlHref !== undefined
                  ? "This request waits for the control's evidence plan. Plan, approve, or reconcile it on the control before it is reviewed."
                  : planned
                    ? `The evidence plan now includes ${plan?.reconcile?.waitingItems ?? 0} item${plan?.reconcile?.waitingItems === 1 ? "" : "s"} in the design and interim phases. Choose whether the planned requests replace this draft or the draft is retained for those items. No change is made until a choice is recorded.`
                    : "This request was drafted at kickoff, before the evidence for this control was planned. Plan the evidence first, then choose whether the planned requests replace this draft."}
            </p>
            {controlHref !== undefined ? (
              <a className="btn btn-sm btn-secondary" href={controlHref}>
                Open the control
              </a>
            ) : null}
            {controlHref === undefined &&
            canAct &&
            plan?.status === "PROPOSED" ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  planAction.run("approve", {
                    intent: "approve",
                    version: plan.version,
                  })
                }
              >
                {planAction.busy === "approve"
                  ? "Approving…"
                  : "Approve the evidence plan"}
              </button>
            ) : null}
            {controlHref === undefined && canAct && !planned ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  planAction.run("generate", { intent: "generate" })
                }
              >
                <UiIcon name="sparkles" size={13} />
                {planAction.busy === "generate"
                  ? "Planning…"
                  : "Plan the evidence"}
              </button>
            ) : null}
            {controlHref === undefined &&
            canAct &&
            planned &&
            plan?.reconcile ? (
              <div className="rr-choices">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    planAction.run("keep", {
                      intent: "reconcile",
                      action: "KEEP",
                      request_version: plan.reconcile?.requestVersion,
                    })
                  }
                >
                  {planAction.busy === "keep"
                    ? "Retaining…"
                    : "Retain this draft for the planned items"}
                </button>
                {replacing ? (
                  <div className="rr-reason">
                    <label htmlFor={`${id}-why`}>
                      Reason for replacement (recorded in the audit trail)
                    </label>
                    <textarea
                      id={`${id}-why`}
                      rows={2}
                      maxLength={500}
                      value={why}
                      onChange={(event) => setWhy(event.target.value)}
                    />
                    <div className="rr-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy || why.trim().length < 3}
                        onClick={() =>
                          planAction.run("replace", {
                            intent: "reconcile",
                            action: "REPLACE",
                            request_version: plan.reconcile?.requestVersion,
                            reason: why,
                          })
                        }
                      >
                        {planAction.busy === "replace"
                          ? "Replacing…"
                          : "Replace with planned requests"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setReplacing(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    disabled={busy}
                    onClick={() => setReplacing(true)}
                  >
                    Replace with planned requests…
                  </button>
                )}
              </div>
            ) : null}
            <Problem text={planAction.problem} />
          </div>
        </div>
      ) : null}
    </>
  );
  const mainPart = (
    <>
      {details === null ? (
        <p className="form-hint">
          The request details could not be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          {details.canEdit &&
          status !== "CANCELLED" &&
          status !== "CLOSED" &&
          (details.type.uncertain || classifying) ? (
            <TypeReview
              key={`${detail?.version}-${details.type.key}`}
              id={id}
              details={details}
              busy={busy}
              run={review.run}
              onDone={() => setClassifying(false)}
              onCancel={
                details.type.uncertain ? null : () => setClassifying(false)
              }
            />
          ) : null}

          <section className="rr-section" aria-labelledby={`${id}-ask`}>
            <div className="rr-section-head">
              <h4 id={`${id}-ask`}>Request to the client</h4>
              {editable && !editing && detail !== null ? (
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  <UiIcon name="compose" size={13} />
                  Edit request
                </button>
              ) : null}
            </div>
            {editing && detail !== null ? (
              <EditWording
                id={id}
                detail={detail}
                details={details}
                busy={busy}
                onCancel={() => setEditing(false)}
                onSave={async (fields) => {
                  if (await review.run("save", { intent: "save", ...fields })) {
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <ClientContent details={details} typeLabels={typeLabels} />
            )}
          </section>

          <ClientResponses
            id={id}
            details={details}
            busy={busy}
            run={review.run}
          />

          <References
            id={id}
            ids={ids}
            details={details}
            busy={busy}
            run={review.run}
            refresh={review.refresh}
            fail={review.fail}
          />

          <Planning
            details={details}
            typeLabels={typeLabels}
            onChangeType={
              details.canEdit && !details.type.uncertain && !classifying
                ? () => setClassifying(true)
                : null
            }
          />
        </>
      )}
    </>
  );
  const actionPart = (
    <>
      {!editing ? (
        <footer className="rr-foot" aria-busy={busy}>
          {editable && approver ? (
            // The agent drafted it, so the agent asked: its reviewer approves it.
            <div className="rr-decide">
              <div className="rr-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || detail === null || failing.length > 0}
                  onClick={() =>
                    review.run("approve", {
                      intent: "approve",
                      version: detail?.version ?? request.version,
                      reason: note.trim() || "Reviewed and approved.",
                    })
                  }
                >
                  <UiIcon name="check" size={13} />
                  {review.busy === "approve" ? "Approving…" : "Approve"}
                </button>
                {!noting ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => setNoting(true)}
                  >
                    <UiIcon name="plus" size={13} />
                    Add approval note
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => review.run("redraft", { intent: "redraft" })}
                >
                  <UiIcon name="sparkles" size={13} />
                  {review.busy === "redraft"
                    ? "Requesting…"
                    : "Request a redraft"}
                </button>
              </div>
              {noting ? (
                <div className="rr-reason">
                  <label htmlFor={`${id}-note`}>Approval note</label>
                  <textarea
                    id={`${id}-note`}
                    rows={2}
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : editable && written ? (
            // A person wrote it: it goes straight to the recipient.
            <div className="rr-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || detail === null || submitBlocked}
                onClick={() =>
                  review.run("send-direct", {
                    intent: "send-direct",
                    version: detail?.version ?? request.version,
                  })
                }
              >
                <UiIcon name="mail" size={13} />
                {review.busy === "send-direct"
                  ? "Sending…"
                  : "Send to the recipient"}
              </button>
              <p className="rr-note">
                Written by a person, so it goes without a second approval.
              </p>
            </div>
          ) : editable ? (
            <div className="rr-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || detail === null || submitBlocked}
                onClick={() =>
                  review.run("submit", {
                    intent: "submit",
                    version: detail?.version ?? request.version,
                  })
                }
              >
                {review.busy === "submit"
                  ? "Submitting…"
                  : "Submit for approval"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => review.run("redraft", { intent: "redraft" })}
              >
                <UiIcon name="sparkles" size={13} />
                {review.busy === "redraft"
                  ? "Requesting…"
                  : "Request a redraft"}
              </button>
            </div>
          ) : stage === "AWAITING_APPROVAL" && request.viewerCanDecide ? (
            <div className="rr-decide">
              <div className="rr-actions">
                <button
                  type="button"
                  className={
                    decision === "APPROVED" ? "btn" : "btn btn-secondary"
                  }
                  aria-pressed={decision === "APPROVED"}
                  onClick={() => {
                    setDecision("APPROVED");
                    setReason(
                      (current) =>
                        current ||
                        "Reviewed: complete and addressed correctly.",
                    );
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={
                    decision === "REJECTED"
                      ? "btn btn-danger"
                      : "btn btn-secondary"
                  }
                  aria-pressed={decision === "REJECTED"}
                  onClick={() => {
                    setDecision("REJECTED");
                    setReason("");
                  }}
                >
                  Request changes
                </button>
              </div>
              {decision !== "" ? (
                <div className="rr-reason">
                  <label htmlFor={`${id}-reason`}>
                    {decision === "APPROVED"
                      ? "Approval note"
                      : "Changes requested"}
                  </label>
                  <textarea
                    id={`${id}-reason`}
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <div className="rr-actions">
                    <button
                      type="button"
                      className={
                        decision === "APPROVED" ? "btn" : "btn btn-danger"
                      }
                      disabled={
                        busy ||
                        reason.trim().length < (decision === "REJECTED" ? 3 : 1)
                      }
                      onClick={() =>
                        review.run("decide", {
                          intent: "decide",
                          approval_id: request.approvalId,
                          decision,
                          reason,
                        })
                      }
                    >
                      {review.busy === "decide"
                        ? "Recording…"
                        : decision === "APPROVED"
                          ? "Approve the request"
                          : "Return for changes"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : stage === "AWAITING_APPROVAL" && written && canAct ? (
            // Submitted for approval before a person's request went directly.
            <div className="rr-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  review.run("send-direct", {
                    intent: "send-direct",
                    version: detail?.version ?? request.version,
                  })
                }
              >
                <UiIcon name="mail" size={13} />
                {review.busy === "send-direct" ? "Sending…" : "Send now"}
              </button>
              <p className="rr-note">
                Written by a person, so it needs no second approval.
              </p>
            </div>
          ) : stage === "AWAITING_APPROVAL" ? (
            <p className="rr-note">
              Awaiting approval by an authorized approver other than the
              submitter.
            </p>
          ) : stage === "APPROVED" && canAct ? (
            <div className="rr-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  review.run("send", {
                    intent: "send",
                    approval_id: request.approvalId,
                  })
                }
              >
                <UiIcon name="mail" size={13} />
                {review.busy === "send" ? "Sending…" : "Send to the recipient"}
              </button>
              {request.approvalDecidedBy ? (
                <p className="rr-note">
                  Approved by {request.approvalDecidedBy}.
                </p>
              ) : null}
            </div>
          ) : stage === "SEND_AGAIN" && canAct ? (
            <div className="rr-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => review.run("resend", { intent: "resend" })}
              >
                <UiIcon name="mail" size={13} />
                {review.busy === "resend" ? "Sending…" : "Send again"}
              </button>
              <p className="rr-note">
                Approved
                {request.approvalDecidedBy
                  ? ` by ${request.approvalDecidedBy}`
                  : ""}
                . Nothing went out because email sending was off; the approval
                carries over.
              </p>
            </div>
          ) : (stage === "APPROVAL_EXPIRED" || stage === "SEND_FAILED") &&
            canAct ? (
            <div className="rr-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  review.run("submit", {
                    intent: "submit",
                    version: detail?.version ?? request.version,
                  })
                }
              >
                Submit again
              </button>
            </div>
          ) : null}
          <Problem text={review.problem} />
        </footer>
      ) : null}
    </>
  );
  const sidePart = (
    <aside className="rr-side" aria-label="Status and actions">
      <section
        className={`rr-panel${inDialog ? "" : " rr-panel-actions"}`}
        aria-label={inDialog ? "Status" : "Actions"}
      >
        <p className="rr-panel-title">{inDialog ? "Status" : "Actions"}</p>
        {inDialog ? (
          <p className={`rr-stage is-${life.tone}`}>{life.label}</p>
        ) : null}
        {side}
        {actionPart}
      </section>
      {canAct && status !== "CANCELLED" && status !== "CLOSED" ? (
        // Evidence the audit team already holds, such as what was obtained during the
        // walkthrough: filed to this request. An unsent request is then recorded as
        // received directly and is not sent (evidence_receipts.apply_receipt).
        <section
          className="rr-panel rr-evidence"
          aria-labelledby={`${id}-files`}
        >
          <p className="rr-panel-title" id={`${id}-files`}>
            {unsent ? "Evidence already obtained" : "Add evidence"}
          </p>
          <p className="rr-panel-note">
            {unsent
              ? "Obtained during the walkthrough or otherwise in hand? Upload it here. The request is recorded as received from the audit team and is not sent to the client."
              : "Upload files received outside the portal. They are filed to this request."}
          </p>
          <RequestUpload
            organizationId={ids.organizationId}
            projectId={ids.projectId}
            requestId={request.id}
            label={heading}
            variant="panel"
          />
        </section>
      ) : null}
      {details !== null &&
      unsent &&
      stage !== "HELD" &&
      details.checks.some((check) => !check.ok) ? (
        // Only what blocks approval or sending: a request that passes shows its next
        // action, not a confirmation.
        <section className="rr-panel">
          <Readiness
            checks={details.checks}
            approved={request.approvalDecision === "APPROVED"}
          />
        </section>
      ) : null}
      {details !== null ? (
        <section className="rr-panel">
          <Assignment
            key={detail?.version}
            id={id}
            details={details}
            busy={busy}
            run={review.run}
          />
        </section>
      ) : null}
    </aside>
  );
  if (inDialog) {
    // The record dialog: the page names the request, so only the summary band shows.
    return (
      <section
        className="rr is-in-dialog"
        aria-label="Request details"
        id={`request-${request.id}`}
      >
        <div className="rr-top">{headPart}</div>
        <div className="rr-layout">
          <div className="rr-main">
            {calloutPart}
            {mainPart}
          </div>
          {sidePart}
        </div>
      </section>
    );
  }
  return (
    <section
      className="rr is-inline"
      aria-labelledby={`${id}-title`}
      id={`request-${request.id}`}
    >
      {headPart}
      <div className="rr-layout">
        <div className="rr-main">
          {calloutPart}
          {mainPart}
        </div>
        {sidePart}
      </div>
    </section>
  );
}

/** What the control owner gave through the evidence portal: their answers to the
 * request's questions, their submission, and the messages on the request, with a reply
 * that emails the owner a fresh link. Opening it marks the owner's messages seen. */
function ClientResponses({
  id,
  details,
  busy,
  run,
}: {
  id: string;
  details: RequestDetails;
  busy: boolean;
  run: (label: string, fields: Record<string, unknown>) => Promise<boolean>;
}) {
  const client = details.client;
  const [reply, setReply] = useState("");
  const unseen = client?.unseen ?? 0;
  const marked = useRef(false);
  useEffect(() => {
    if (unseen > 0 && !marked.current) {
      marked.current = true;
      void run("seen", { intent: "seen" });
    }
  }, [unseen, run]);
  const sent = details.request.status !== "DRAFT";
  if (!sent && !hasClientActivity(client)) {
    return null;
  }
  return (
    <section
      className="rr-section rr-responses"
      aria-labelledby={`${id}-client`}
    >
      <div className="rr-section-head">
        <h4 id={`${id}-client`}>Client responses</h4>
        {client?.submittedAt ? (
          <span className="pill pill-dot tone-success">
            Submitted {formatDate(client.submittedAt)}
          </span>
        ) : null}
      </div>
      {client?.submissionNote ? (
        <p className="rr-client-note">
          <strong>Note with the submission:</strong> {client.submissionNote}
        </p>
      ) : null}
      {client !== null && client.answers.length > 0 ? (
        <dl className="rr-client-answers">
          {client.answers.map((item) => (
            <div key={item.question}>
              <dt>{item.question}</dt>
              <dd>{item.answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {client !== null && client.messages.length > 0 ? (
        <ol className="rr-thread">
          {client.messages.map((message) => (
            <li
              key={message.id}
              className={message.author === "OWNER" ? "is-owner" : "is-team"}
            >
              <p className="rr-thread-meta">
                <strong>
                  {message.author === "OWNER"
                    ? message.authorName
                    : `${message.authorName} (audit team)`}
                </strong>
                <span>{formatDate(message.createdAt)}</span>
              </p>
              <p className="rr-thread-body">{message.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="form-hint">
          No messages on this request yet. The owner can write from the evidence
          portal.
        </p>
      )}
      {sent && details.request.status !== "CANCELLED" ? (
        <form
          className="rr-client-reply"
          autoComplete="off"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await run("message", { intent: "message", body: reply })) {
              setReply("");
            }
          }}
        >
          <label htmlFor={`${id}-reply`} className="sr-only">
            Reply to the owner
          </label>
          <textarea
            id={`${id}-reply`}
            rows={3}
            maxLength={4000}
            placeholder="Reply to the owner. They are emailed a secure link to read it."
            value={reply}
            disabled={busy}
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="rr-actions">
            <button
              type="submit"
              className="btn btn-sm"
              disabled={busy || reply.trim() === ""}
            >
              <UiIcon name="mail" size={13} />
              Send reply
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** Where the request is on its way from draft to completed. */
function LifecycleTrack({ stage }: { stage: LifecycleStage }) {
  if (stage.step === null) {
    return null;
  }
  const current = stage.step;
  return (
    <ol className="rr-track" aria-label="Request lifecycle">
      {LIFECYCLE_PATH.map((key, index) => {
        const state =
          index < current ? "done" : index === current ? "current" : "next";
        const label = index === current ? stage.label : LIFECYCLE_LABELS[key];
        return (
          <li
            key={key}
            className={`is-${state}${index === current ? ` is-${stage.tone}` : ""}`}
            aria-current={index === current ? "step" : undefined}
          >
            <span className="rr-track-dot" aria-hidden="true" />
            <span className="rr-track-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The checks run before approval and sending, shown only while one fails: what still
 * needs attention. */
function Readiness({
  checks,
  approved,
}: {
  checks: Check[];
  /** Approved and not yet sent: the checks run again when it is sent. */
  approved: boolean;
}) {
  const failing = checks.filter((check) => !check.ok);
  return (
    <section className="rr-ready" aria-label="Checks before approval">
      <p className="rr-ready-head">
        <UiIcon name="risk" size={14} />
        {`${failing.length} item${failing.length === 1 ? "" : "s"} to resolve before ${approved ? "sending" : "approval"}`}
      </p>
      <ul className="rr-ready-list">
        {failing.map((check) => (
          <li key={check.key}>
            <strong>{check.label}:</strong> {check.detail}
          </li>
        ))}
      </ul>
      <details className="rr-ready-all">
        <summary>View all checks</summary>
        <ul>
          {checks.map((check) => (
            <li key={check.key} className={check.ok ? "is-ok" : "is-bad"}>
              <UiIcon name={check.ok ? "check" : "x"} size={12} />
              <span>
                <strong>{check.label}</strong> {check.detail}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Confirm or change the request's type, and optionally its title. */
function TypeReview({
  id,
  details,
  busy,
  run,
  onDone,
  onCancel,
}: {
  id: string;
  details: RequestDetails;
  busy: boolean;
  run: Run;
  onDone: () => void;
  onCancel: (() => void) | null;
}) {
  const [type, setType] = useState(details.type.key);
  const [title, setTitle] = useState(details.titleSet ? details.title : "");
  const purpose = details.types.find((item) => item.key === type)?.purpose;
  return (
    <section
      className={`rr-classify${details.type.uncertain ? " is-warn" : ""}`}
      aria-label="Request type"
    >
      {details.type.uncertain ? (
        <p className="rr-classify-head">
          <UiIcon name="risk" size={14} />
          <span>
            <strong>Confirm the request type.</strong> {details.type.reason}
          </span>
        </p>
      ) : null}
      <div className="rr-classify-row">
        <label htmlFor={`${id}-type`}>
          Request type
          <select
            id={`${id}-type`}
            value={type}
            disabled={busy}
            onChange={(event) => setType(event.target.value)}
          >
            {details.types.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-title-input`}>
          Title
          <input
            id={`${id}-title-input`}
            type="text"
            maxLength={160}
            placeholder={details.title}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="rr-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => {
              if (
                await run("classify", {
                  intent: "classify",
                  version: details.request.version,
                  request_type: type,
                  title,
                })
              ) {
                onDone();
              }
            }}
          >
            Confirm type
          </button>
          {onCancel !== null ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      {purpose ? <p className="rr-classify-purpose">{purpose}</p> : null}
    </section>
  );
}

/** Who the request goes to, who is copied, when it is due, and its priority. Each
 * change is saved as it is made; an approved request goes back for approval. */
function Assignment({
  id,
  details,
  busy,
  run,
}: {
  id: string;
  details: RequestDetails;
  busy: boolean;
  run: Run;
}) {
  const detail = details.request;
  const [recipient, setRecipient] = useState(detail.recipient);
  const [cc, setCc] = useState<string[]>(detail.ccRecipients);
  const [due, setDue] = useState(detail.dueAt.slice(0, 10));
  const [priority, setPriority] = useState<Priority>(detail.priority);
  const [adding, setAdding] = useState(false);
  // Choosing another recipient: the search replaces the person until one is picked.
  const [changing, setChanging] = useState(false);
  const [creating, setCreating] = useState<null | {
    target: "to" | "cc";
    email: string;
  }>(null);
  const [saved, setSaved] = useState(false);
  const editable = details.assignable && details.canEdit;
  const approved = detail.status === "APPROVAL_PENDING";
  const check = (key: string) =>
    details.checks.find((item) => item.key === key) ?? null;
  const byEmail = new Map(
    details.contacts.map((contact) => [contact.email.toLowerCase(), contact]),
  );
  async function save(next: {
    recipient?: string;
    cc?: string[];
    due?: string;
    priority?: Priority;
  }) {
    const values = {
      recipient: next.recipient ?? recipient,
      cc: next.cc ?? cc,
      due: next.due ?? due,
      priority: next.priority ?? priority,
    };
    setRecipient(values.recipient);
    setCc(values.cc);
    setDue(values.due);
    setPriority(values.priority);
    setSaved(false);
    const ok = await run("assign", {
      intent: "assign",
      version: detail.version,
      recipient: values.recipient,
      cc: values.cc,
      due_on: values.due,
      priority: values.priority,
    });
    if (ok) {
      setSaved(true);
    } else {
      setRecipient(detail.recipient);
      setCc(detail.ccRecipients);
      setDue(detail.dueAt.slice(0, 10));
      setPriority(detail.priority);
    }
  }
  const recipientCheck = check("recipient");
  const ccCheck = check("cc");
  const dueCheck = check("due");
  const today = new Date().toISOString().slice(0, 10);
  const suggested = details.suggested;
  return (
    <section className="rr-section rr-assign" aria-labelledby={`${id}-who`}>
      <div className="rr-section-head">
        <h4 id={`${id}-who`}>Recipients and timing</h4>
        <span className="rr-saved" role="status">
          {busy && !saved ? "" : saved ? "Saved" : ""}
        </span>
      </div>
      {editable && approved ? (
        <p className="rr-inline-note">
          Changes to recipients or the due date return the request for approval.
        </p>
      ) : null}
      <div className="rr-props">
        <div className="rr-prop">
          <span className="rr-prop-label" id={`${id}-to-label`}>
            To
          </span>
          <div className="rr-prop-value">
            {recipient !== "" && !changing ? (
              editable ? (
                // The person is the control: choosing them opens the search.
                <button
                  type="button"
                  className="rr-person-button"
                  disabled={busy}
                  aria-label={`Change the recipient, ${byEmail.get(recipient.toLowerCase())?.name ?? recipient}`}
                  onClick={() => setChanging(true)}
                >
                  <Person
                    contact={byEmail.get(recipient.toLowerCase()) ?? null}
                    email={recipient}
                  />
                  <span className="rr-person-edit" aria-hidden="true">
                    <UiIcon name="compose" size={13} />
                  </span>
                </button>
              ) : (
                <div className="rr-person-row">
                  <Person
                    contact={byEmail.get(recipient.toLowerCase()) ?? null}
                    email={recipient}
                  />
                </div>
              )
            ) : editable ? (
              <>
                <ContactSearch
                  id={`${id}-to`}
                  labelledBy={`${id}-to-label`}
                  contacts={details.contacts}
                  exclude={[recipient, ...cc]}
                  domains={details.domains}
                  placeholder="Search contacts or type an email"
                  disabled={busy}
                  focus={changing}
                  onPick={(email) => {
                    setChanging(false);
                    save({ recipient: email });
                  }}
                  onCreate={(email) => {
                    setChanging(false);
                    setCreating({ target: "to", email });
                  }}
                  onClose={
                    recipient !== "" ? () => setChanging(false) : undefined
                  }
                />
                {recipient === "" && suggested !== null ? (
                  <button
                    type="button"
                    className="rr-suggest"
                    disabled={busy}
                    onClick={() => save({ recipient: suggested.email })}
                  >
                    <span>Suggested</span>
                    <strong>{suggested.name}</strong>
                    <span>{suggested.role}</span>
                  </button>
                ) : null}
              </>
            ) : (
              <span className="rr-prop-empty">No recipient assigned</span>
            )}
            {recipientCheck !== null &&
            !recipientCheck.ok &&
            recipient !== "" ? (
              <p className="rr-field-error">{recipientCheck.detail}</p>
            ) : null}
            {recipient === "" && editable ? (
              <p className="rr-field-error">A recipient is required.</p>
            ) : null}
          </div>
        </div>

        <div className="rr-prop">
          <span className="rr-prop-label" id={`${id}-cc-label`}>
            Cc
          </span>
          <div className="rr-prop-value">
            {cc.length > 0 ? (
              <ul className="rr-cc" aria-labelledby={`${id}-cc-label`}>
                {cc.map((email) => {
                  const contact = byEmail.get(email.toLowerCase()) ?? null;
                  return (
                    <li key={email}>
                      <Person contact={contact} email={email} compact />
                      {editable ? (
                        <button
                          type="button"
                          className="rr-cc-x"
                          disabled={busy}
                          aria-label={`Remove ${contact?.name ?? email}`}
                          onClick={() =>
                            save({ cc: cc.filter((item) => item !== email) })
                          }
                        >
                          <UiIcon name="x" size={11} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {adding ? (
              <ContactSearch
                id={`${id}-cc`}
                labelledBy={`${id}-cc-label`}
                contacts={details.contacts}
                exclude={[recipient, ...cc]}
                domains={details.domains}
                placeholder="Search contacts or type an email"
                disabled={busy}
                focus
                onPick={(email) => {
                  setAdding(false);
                  save({ cc: [...cc, email] });
                }}
                onCreate={(email) => {
                  setAdding(false);
                  setCreating({ target: "cc", email });
                }}
                onClose={() => setAdding(false)}
              />
            ) : editable && cc.length < MAX_COPIED ? (
              <button
                type="button"
                className="rr-prop-add"
                disabled={busy}
                onClick={() => setAdding(true)}
              >
                <UiIcon name="plus" size={12} />
                {cc.length === 0 ? "Add people" : "Add"}
              </button>
            ) : cc.length === 0 ? (
              <span className="rr-prop-empty">None</span>
            ) : null}
            {ccCheck !== null && !ccCheck.ok ? (
              <p className="rr-field-error">{ccCheck.detail}</p>
            ) : null}
          </div>
        </div>

        <div className="rr-prop">
          <label className="rr-prop-label" htmlFor={`${id}-due`}>
            Due
          </label>
          <div className="rr-prop-value">
            {editable ? (
              <div className="rr-due">
                <input
                  id={`${id}-due`}
                  type="date"
                  className="rr-prop-input"
                  min={today}
                  value={due}
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today) {
                      save({ due: value });
                    } else {
                      setDue(value);
                    }
                  }}
                />
                <span className="rr-due-hint">{dueHint(due, today)}</span>
              </div>
            ) : (
              <span className="rr-prop-text">
                {formatDate(detail.dueAt)}
                <span className="rr-due-hint">
                  {dueHint(detail.dueAt.slice(0, 10), today)}
                </span>
              </span>
            )}
            {dueCheck?.ok === false ? (
              <p className="rr-field-error">{dueCheck.detail}</p>
            ) : null}
          </div>
        </div>

        <div className="rr-prop">
          <label className="rr-prop-label" htmlFor={`${id}-priority`}>
            Priority
          </label>
          <div className="rr-prop-value">
            {editable ? (
              <select
                id={`${id}-priority`}
                className={`rr-prop-input rr-priority is-${priority.toLowerCase()}`}
                value={priority}
                disabled={busy}
                onChange={(event) =>
                  save({ priority: event.target.value as Priority })
                }
              >
                {PRIORITIES.map((item) => (
                  <option key={item} value={item}>
                    {PRIORITY_LABELS[item]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rr-prop-text">{PRIORITY_LABELS[priority]}</span>
            )}
          </div>
        </div>
      </div>

      {creating !== null ? (
        <NewContact
          id={id}
          email={creating.email}
          domains={details.domains}
          busy={busy}
          onCancel={() => setCreating(null)}
          onSave={async (contact) => {
            const added = await run("contact", {
              intent: "contact",
              ...contact,
            });
            if (!added) {
              return;
            }
            const target = creating.target;
            setCreating(null);
            await save(
              target === "to"
                ? { recipient: contact.email }
                : { cc: [...cc, contact.email] },
            );
          }}
        />
      ) : null}
    </section>
  );
}

/** A person on the request: their initials, name, and role and address beneath; or, in a
 * list of people copied, the initials and name only, the rest on hover. */
function Person({
  contact,
  email,
  compact = false,
}: {
  contact: Contact | null;
  email: string;
  compact?: boolean;
}) {
  const name = contact?.name || email;
  const role =
    contact !== null ? contact.role || CONTACT_ROLES[contact.source] : "";
  return (
    <span
      className={`rr-person${compact ? " is-compact" : ""}`}
      title={[name, role, email].filter((part) => part !== "").join(" · ")}
    >
      <span className="rr-avatar" aria-hidden="true">
        {initialsOf(contact?.name ?? "", email)}
      </span>
      <span className="rr-person-text">
        <strong>{name}</strong>
        {compact ? null : (
          <span>
            {role !== "" ? `${role} · ` : ""}
            {email}
          </span>
        )}
      </span>
    </span>
  );
}

/** A search over the engagement's contacts, as a combobox: type to filter, arrows to
 * move, Enter to choose. A new address can be typed, or added as a new contact. */
export function ContactSearch({
  id,
  labelledBy,
  contacts,
  exclude,
  domains,
  placeholder,
  disabled,
  focus = false,
  onPick,
  onCreate,
  onClose,
}: {
  id: string;
  labelledBy: string;
  contacts: Contact[];
  exclude: string[];
  domains: string[];
  placeholder: string;
  disabled: boolean;
  focus?: boolean;
  onPick: (email: string) => void;
  onCreate: (email: string) => void;
  onClose?: (() => void) | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (focus) {
      input.current?.focus();
    }
  }, [focus]);
  const matches = matchContacts(contacts, query, exclude).slice(0, 8);
  const typed = query.trim().toLowerCase();
  const fresh =
    EMAIL.test(typed) && !contacts.some((item) => item.email === typed)
      ? typed
      : null;
  const options = [
    ...matches.map((contact) => ({ kind: "contact" as const, contact })),
    ...(fresh !== null ? [{ kind: "new" as const, email: fresh }] : []),
  ];
  function choose(index: number) {
    const option = options[index];
    if (option === undefined) {
      return;
    }
    if (option.kind === "contact") {
      onPick(option.contact.email);
      setQuery("");
      setOpen(false);
      return;
    }
    const wrong = addressProblem(option.email, domains);
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    onCreate(option.email);
    setQuery("");
    setOpen(false);
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      setOpen(false);
      onClose?.();
    }
  }
  const listId = `${id}-list`;
  return (
    <div className="rr-combo">
      <div className="rr-combo-box">
        <UiIcon name="search" size={13} />
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          aria-labelledby={labelledBy}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && options.length > 0 ? `${listId}-${active}` : undefined
          }
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
            setProblem(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={keys}
        />
        {onClose !== undefined ? (
          <button
            type="button"
            className="rr-chip-x"
            aria-label="Close"
            onClick={onClose}
          >
            <UiIcon name="x" size={12} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="rr-combo-pop">
          <div id={listId} role="listbox" aria-labelledby={labelledBy}>
            {options.map((option, index) => (
              <div
                key={option.kind === "contact" ? option.contact.email : "new"}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                className={`rr-option${index === active ? " is-active" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(index);
                }}
                onKeyDown={() => undefined}
              >
                {option.kind === "contact" ? (
                  <>
                    <strong>{option.contact.name}</strong>
                    <span>
                      {option.contact.email} ·{" "}
                      {option.contact.role ||
                        CONTACT_ROLES[option.contact.source]}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>Add {option.email}</strong>
                    <span>Save as a new engagement contact</span>
                  </>
                )}
              </div>
            ))}
            {options.length === 0 ? (
              <p className="rr-combo-empty">No matching contacts.</p>
            ) : null}
          </div>
          <button
            type="button"
            className="rr-combo-new"
            onMouseDown={(event) => {
              event.preventDefault();
              onCreate(fresh ?? "");
              setOpen(false);
            }}
          >
            <UiIcon name="plus" size={12} />
            New contact
          </button>
        </div>
      ) : null}
      {problem !== null ? <p className="rr-field-error">{problem}</p> : null}
    </div>
  );
}

/** A person at the client, added inline and saved to the engagement's contacts. */
function NewContact({
  id,
  email,
  domains,
  busy,
  onCancel,
  onSave,
}: {
  id: string;
  email: string;
  domains: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (contact: { name: string; email: string; role: string }) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState(email);
  const [role, setRole] = useState("");
  const wrong = address.trim() === "" ? null : addressProblem(address, domains);
  return (
    <fieldset className="rr-contact">
      <legend>New contact</legend>
      <div className="rr-contact-row">
        <label htmlFor={`${id}-cname`}>
          Name
          <input
            id={`${id}-cname`}
            type="text"
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label htmlFor={`${id}-cemail`}>
          Email
          <input
            id={`${id}-cemail`}
            type="email"
            maxLength={254}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <label htmlFor={`${id}-crole`}>
          Role (optional)
          <input
            id={`${id}-crole`}
            type="text"
            maxLength={120}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
        </label>
      </div>
      {wrong !== null ? <p className="rr-field-error">{wrong}</p> : null}
      <div className="rr-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={
            busy ||
            name.trim() === "" ||
            address.trim() === "" ||
            wrong !== null
          }
          onClick={() =>
            onSave({
              name: name.trim(),
              email: address.trim().toLowerCase(),
              role: role.trim(),
            })
          }
        >
          Save and assign
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

/** What the client sees: the opening, a numbered checklist, questions, and how to
 * submit. */
function ClientContent({
  details,
  typeLabels,
}: {
  details: RequestDetails;
  typeLabels: Record<string, string>;
}) {
  const { content } = details;
  const shared = details.attachments.filter(
    (item) => item.visibility === "SHARED",
  ).length;
  const intro = requestIntro(content.summary, details.title);
  return (
    <div className="rr-client rr-doc">
      {content.structured ? (
        <>
          {intro !== "" ? <p className="rr-summary">{intro}</p> : null}
          <ol className="rr-checklist" aria-label="Items requested">
            {content.items.map((item) => {
              const named = itemNecessity(item.title);
              const label = item.type !== null ? typeLabels[item.type] : "";
              return (
                <li key={`${item.number}-${item.title}`}>
                  <div className="rr-item-head">
                    <span className="rr-item-no" aria-hidden="true">
                      {item.number}
                    </span>
                    <strong>
                      <span className="sr-only">Item {item.number}: </span>
                      {named.title}
                    </strong>
                    {named.necessity !== "REQUIRED" ? (
                      <span className="rr-tag is-soft">
                        {named.necessity === "OPTIONAL"
                          ? "If available"
                          : "If applicable"}
                      </span>
                    ) : null}
                    {label ? <span className="rr-tag">{label}</span> : null}
                  </div>
                  {item.detail !== "" ? (
                    <p className="rr-item-detail">{item.detail}</p>
                  ) : null}
                  <ItemFacts item={item} />
                </li>
              );
            })}
          </ol>
          {content.questions.length > 0 ? (
            <div className="rr-doc-block">
              <h5>Questions for the recipient</h5>
              <ul className="rr-questions">
                {content.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rr-text">{details.request.description}</div>
      )}
      <div className="rr-doc-foot">
        {content.closing !== "" ? <p>{content.closing}</p> : null}
        <p className="rr-submit">
          <UiIcon name="shield" size={13} />
          <span>
            Files are uploaded through the secure link in the request email,
            opened with a one-time code sent to the recipient. Files sent as
            email attachments are not accepted as evidence.
            {shared > 0
              ? ` ${shared} reference file${shared === 1 ? " is" : "s are"} available on the same page.`
              : ""}
          </span>
        </p>
      </div>
    </div>
  );
}

/** One item's parts as the client reads them, each on its own labelled row. */
function ItemFacts({
  item,
}: {
  item: RequestDetails["content"]["items"][number];
}) {
  const rows: Array<{ label: string; value: string | string[] }> = [
    { label: "Period", value: item.period },
    { label: "Include", value: item.include },
    { label: "Format", value: item.format },
    { label: "Should show", value: item.show },
    { label: "Completeness", value: item.completeness },
    { label: "If not available", value: item.alternatives },
  ];
  const shown = rows.filter((row) => row.value.length > 0);
  if (shown.length === 0) {
    return null;
  }
  return (
    <dl className="rr-item-meta">
      {shown.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>
            {Array.isArray(row.value) ? (
              row.value.length === 1 ? (
                row.value[0]
              ) : (
                <ul className="rr-bullets">
                  {row.value.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              )
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Reference material behind the request: uploaded, one of the engagement's files, or
 * the same client's prior-year workpaper. Internal to the audit team unless someone who
 * may approve requests shares it with the recipient. */
function References({
  id,
  ids,
  details,
  busy,
  run,
  refresh,
  fail,
}: {
  id: string;
  ids: Ids;
  details: RequestDetails;
  busy: boolean;
  run: Run;
  refresh: () => void;
  fail: (message: string | null) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState<"" | "files" | "workpapers">("");
  const [sources, setSources] = useState<{
    files: SourceFile[];
    workpapers: SourceWorkpaper[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const requestId = details.request.id;
  const closed =
    details.request.status === "CANCELLED" ||
    details.request.status === "CLOSED";
  const canAdd = details.canEdit && !closed;
  async function load(kind: "files" | "workpapers") {
    setPicking(kind);
    setFilter("");
    if (sources !== null) {
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        organization: ids.organizationId,
        project: ids.projectId,
        request: requestId,
        mode: "sources",
      });
      const response = await fetch(`/workspace/request-attachment?${params}`);
      setSources(parseSources(await response.json()));
    } catch {
      setSources({ files: [], workpapers: [] });
    }
    setLoading(false);
  }
  async function upload(chosen: File) {
    if (chosen.size === 0 || chosen.size > MAX_REFERENCE_BYTES) {
      fail("Choose a file up to 25 MB.");
      return;
    }
    setUploading(true);
    fail(null);
    const params = new URLSearchParams({
      organization: ids.organizationId,
      project: ids.projectId,
      request: requestId,
      name: chosen.name,
    });
    let status = 0;
    let detail = "";
    try {
      const response = await fetch(`/workspace/request-attachment?${params}`, {
        method: "POST",
        headers: {
          "content-type": chosen.type || "application/octet-stream",
        },
        body: chosen,
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    setUploading(false);
    const message = reviewProblem(status, detail);
    fail(message);
    if (message === null) {
      refresh();
    }
  }
  const words = filter.trim().toLowerCase();
  const files = (sources?.files ?? []).filter((item) =>
    item.fileName.toLowerCase().includes(words),
  );
  return (
    <section className="rr-section" aria-labelledby={`${id}-refs`}>
      <div className="rr-section-head">
        <h4 id={`${id}-refs`}>
          Reference materials
          {details.attachments.length > 0 ? (
            <span className="rr-count">{details.attachments.length}</span>
          ) : null}
        </h4>
        {canAdd ? (
          <div className="rr-ref-add">
            <input
              ref={file}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (chosen !== undefined) {
                  void upload(chosen);
                }
              }}
            />
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={busy || uploading}
              onClick={() => file.current?.click()}
            >
              <UiIcon name="upload" size={13} />
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              aria-expanded={picking === "files"}
              disabled={busy}
              onClick={() =>
                picking === "files" ? setPicking("") : load("files")
              }
            >
              <UiIcon name="file" size={13} />
              Engagement file
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              aria-expanded={picking === "workpapers"}
              disabled={busy}
              onClick={() =>
                picking === "workpapers" ? setPicking("") : load("workpapers")
              }
            >
              <UiIcon name="layers" size={13} />
              Prior-year workpaper
            </button>
          </div>
        ) : null}
      </div>

      {picking !== "" ? (
        <div className="rr-picker">
          {loading ? (
            <p className="rr-none">Loading…</p>
          ) : picking === "files" ? (
            <>
              <input
                type="search"
                className="rr-picker-filter"
                placeholder="Filter engagement files"
                aria-label="Filter engagement files"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              {files.length === 0 ? (
                <p className="rr-none">No engagement files are available.</p>
              ) : (
                <ul>
                  {files.slice(0, 50).map((item) => (
                    <li key={item.id}>
                      <span className="rr-picker-name">
                        <strong>{item.fileName}</strong>
                        <span>
                          {formatBytes(item.sizeBytes)} · Added{" "}
                          {formatDate(item.addedAt)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await run("link", {
                              intent: "link",
                              source: "ENGAGEMENT_FILE",
                              id: item.id,
                            })
                          ) {
                            setPicking("");
                            setSources(null);
                          }
                        }}
                      >
                        Attach
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (sources?.workpapers ?? []).length === 0 ? (
            <p className="rr-none">
              No prior-year workpaper is available for this control from the
              client's earlier engagements.
            </p>
          ) : (
            <ul>
              {(sources?.workpapers ?? []).map((item) => (
                <li key={item.id}>
                  <span className="rr-picker-name">
                    <strong>
                      {item.year ? `${item.year} · ` : ""}
                      {item.reference}
                    </strong>
                    <span>
                      {item.engagement} ·{" "}
                      {item.stage === "DESIGN"
                        ? "Design workpaper"
                        : "Operating effectiveness workpaper"}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await run("link", {
                          intent: "link",
                          source: "PRIOR_YEAR_WORKPAPER",
                          id: item.id,
                        })
                      ) {
                        setPicking("");
                        setSources(null);
                      }
                    }}
                  >
                    Attach
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {details.attachments.length === 0 ? (
        <p className="rr-none">No reference materials attached.</p>
      ) : (
        <ul className="rr-refs">
          {details.attachments.map((item) => (
            <ReferenceRow
              key={item.id}
              ids={ids}
              requestId={requestId}
              item={item}
              busy={busy}
              canEdit={details.canEdit && !closed}
              canShare={details.canShare && !closed}
              confirming={sharing === item.id}
              onConfirm={(value) => setSharing(value ? item.id : null)}
              run={run}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReferenceRow({
  ids,
  requestId,
  item,
  busy,
  canEdit,
  canShare,
  confirming,
  onConfirm,
  run,
}: {
  ids: Ids;
  requestId: string;
  item: Attachment;
  busy: boolean;
  canEdit: boolean;
  canShare: boolean;
  confirming: boolean;
  onConfirm: (value: boolean) => void;
  run: Run;
}) {
  const shared = item.visibility === "SHARED";
  return (
    <li className="rr-ref">
      <UiIcon name="file" size={15} />
      <div className="rr-ref-main">
        <a
          className="rr-ref-name"
          href={attachmentHref(ids, requestId, item.id, "content")}
        >
          {item.fileName}
        </a>
        <span className="rr-ref-meta">
          {SOURCE_LABELS[item.source]}
          {item.sourceYear ? ` · ${item.sourceYear}` : ""} ·{" "}
          {formatBytes(item.sizeBytes)} · Added by {item.addedBy}
        </span>
        {confirming ? (
          <div className="rr-ref-confirm">
            <p>
              Share with the recipient? The file will be available on the
              recipient's secure upload page for this request.
            </p>
            <div className="rr-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={async () => {
                  if (
                    await run("share", {
                      intent: "share",
                      attachment_id: item.id,
                      version: item.version,
                      visibility: "SHARED",
                    })
                  ) {
                    onConfirm(false);
                  }
                }}
              >
                Share
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => onConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <span className={`rr-badge${shared ? " is-shared" : ""}`}>
        {shared ? "Shared with recipient" : "Internal only"}
      </span>
      <div className="rr-ref-actions">
        {item.previewable ? (
          <a
            className="btn btn-sm btn-ghost"
            href={attachmentHref(ids, requestId, item.id, "preview")}
            target="_blank"
            rel="noopener noreferrer"
          >
            Preview
          </a>
        ) : null}
        <a
          className="btn btn-sm btn-ghost"
          href={attachmentHref(ids, requestId, item.id, "content")}
        >
          Download
        </a>
        {canShare && !confirming ? (
          shared ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() =>
                run("share", {
                  intent: "share",
                  attachment_id: item.id,
                  version: item.version,
                  visibility: "INTERNAL",
                })
              }
            >
              Make internal
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => onConfirm(true)}
            >
              Share
            </button>
          )
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost rr-danger"
            disabled={busy}
            onClick={() =>
              run("remove", {
                intent: "remove",
                attachment_id: item.id,
                version: item.version,
              })
            }
          >
            Remove
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** For the audit team only: how the request was classified, why each item is asked
 * for, and the drafter's assumptions. Never part of what the client receives. */
function Planning({
  details,
  typeLabels,
  onChangeType,
}: {
  details: RequestDetails;
  typeLabels: Record<string, string>;
  onChangeType: (() => void) | null;
}) {
  const { planning, type } = details;
  return (
    <details className="rr-planning">
      <summary>
        Audit planning and agent analysis
        <span className="rr-internal">Internal</span>
      </summary>
      <dl className="rr-planning-facts">
        <div>
          <dt>Request type</dt>
          <dd>
            {type.label} · {type.reason || BASIS_LABELS[type.basis]}
            {onChangeType !== null ? (
              <>
                {" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={onChangeType}
                >
                  Change type or title
                </button>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Drafted by</dt>
          <dd>
            {planning.draftedBy === "MODEL"
              ? "Evidence coordinator"
              : planning.draftedBy === "RULES"
                ? "Evidence coordinator (standard wording)"
                : "Audit team"}
            {planning.drafting ? " · Drafting in progress" : ""}
          </dd>
        </div>
      </dl>
      {details.supports.length > 0 ? (
        <>
          <h5>Test plan attributes this request evidences</h5>
          <ul className="rr-carries">
            {details.supports.map((item) => (
              <li key={item.code}>
                <strong>
                  {item.code} {item.text}
                </strong>
                {item.items.length > 0 ? (
                  <span>Evidence: {item.items.join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {planning.requirements.length > 0 ? (
        <>
          <h5>Planned evidence covered by this request</h5>
          <ul className="rr-carries">
            {planning.requirements.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>
                  {item.categories
                    .map((category) => CATEGORY_WORDS[category] ?? category)
                    .join(", ")}
                  {item.necessity === "REQUIRED" ? " · Required" : ""}
                  {item.sufficiency !== "" &&
                  item.sufficiency !== "NOT_REVIEWED"
                    ? ` · ${item.sufficiency.charAt(0)}${item.sufficiency.slice(1).toLowerCase().replaceAll("_", " ")}`
                    : ""}
                </span>
                {item.objective !== "" ? (
                  <span>Objective: {item.objective}</span>
                ) : null}
                {item.rationale !== "" ? (
                  <span>Rationale: {item.rationale}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="rr-none">Not linked to an item in the evidence plan.</p>
      )}
      {planning.assumptions.length > 0 ? (
        <>
          <h5>Drafting assumptions</h5>
          <ul className="rr-questions">
            {planning.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
      {details.content.items.some((item) => item.type !== null) ? (
        <p className="rr-none">
          Item types:{" "}
          {details.content.items
            .map(
              (item) =>
                `${item.number}. ${item.type !== null ? (typeLabels[item.type] ?? item.type) : "Unclassified"}`,
            )
            .join("; ")}
        </p>
      ) : null}
    </details>
  );
}

/** The request as the audit team edits it: the opening, then each item in its own fields,
 * written back in the format the client's checklist is read from. Wording without items,
 * or a person's choice, is edited as plain text. */
function EditWording({
  id,
  detail,
  details,
  busy,
  onCancel,
  onSave,
}: {
  id: string;
  detail: RequestDetail;
  details: RequestDetails;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: Record<string, unknown>) => void;
}) {
  const [plain, setPlain] = useState(!details.content.structured);
  const [draft, setDraft] = useState<WordingDraft>(() => wordingDraft(details));
  const [description, setDescription] = useState(detail.description);
  const text = plain ? description : composeWording(draft);
  const titled = draft.items.filter((item) => item.title.trim() !== "").length;
  const tooLong = text.length > MAX_DESCRIPTION;
  const setItem = (index: number, change: Partial<DraftItemFields>) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, at) =>
        at === index ? { ...item, ...change } : item,
      ),
    }));
  const moveItem = (index: number, by: -1 | 1) =>
    setDraft((current) => {
      const items = [...current.items];
      const [moved] = items.splice(index, 1);
      if (moved !== undefined) {
        items.splice(index + by, 0, moved);
      }
      return { ...current, items };
    });
  return (
    <div className="rr-edit">
      <div className="rr-edit-mode">
        <span>
          {plain
            ? "Editing the wording as plain text."
            : "Edit the opening and each item. The client receives them as a numbered checklist."}
        </span>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            if (plain) {
              setPlain(false);
            } else {
              setDescription(composeWording(draft));
              setPlain(true);
            }
          }}
          disabled={plain && !details.content.structured}
          hidden={plain && !details.content.structured}
        >
          {plain ? "Edit item by item" : "Edit as plain text"}
        </button>
      </div>
      {plain ? (
        <label htmlFor={`${id}-desc`}>
          Wording sent to the client
          <textarea
            id={`${id}-desc`}
            rows={14}
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      ) : (
        <>
          <label htmlFor={`${id}-intro`}>
            Opening
            <textarea
              id={`${id}-intro`}
              rows={2}
              value={draft.intro}
              onChange={(event) =>
                setDraft({ ...draft, intro: event.target.value })
              }
            />
          </label>
          <ol className="rr-edit-items">
            {draft.items.map((item, index) => (
              // Items have no identity beyond their place in the list while edited.
              // biome-ignore lint/suspicious/noArrayIndexKey: the position is the item's identity here.
              <li key={index} className="rr-edit-item">
                <div className="rr-edit-item-head">
                  <span className="rr-item-no" aria-hidden="true">
                    {index + 1}
                  </span>
                  <label
                    htmlFor={`${id}-item-${index}-title`}
                    className="rr-edit-title"
                  >
                    <span className="sr-only">Item {index + 1} title</span>
                    <textarea
                      id={`${id}-item-${index}-title`}
                      rows={1}
                      maxLength={220}
                      placeholder="What to provide"
                      value={item.title}
                      onChange={(event) =>
                        setItem(index, {
                          // A title is one line in the request; a pasted break is a space.
                          title: event.target.value.replace(/\s*\n\s*/g, " "),
                        })
                      }
                    />
                  </label>
                  <div className="rr-edit-item-tools">
                    <button
                      type="button"
                      className="rr-icon-button"
                      aria-label={`Move item ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => moveItem(index, -1)}
                    >
                      <UiIcon name="arrowUp" size={13} />
                    </button>
                    <button
                      type="button"
                      className="rr-icon-button"
                      aria-label={`Move item ${index + 1} down`}
                      disabled={index === draft.items.length - 1}
                      onClick={() => moveItem(index, 1)}
                    >
                      <UiIcon name="arrowDown" size={13} />
                    </button>
                    <button
                      type="button"
                      className="rr-icon-button is-danger"
                      aria-label={`Remove item ${index + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: draft.items.filter((_, at) => at !== index),
                        })
                      }
                    >
                      <UiIcon name="x" size={13} />
                    </button>
                  </div>
                </div>
                <div className="rr-edit-grid">
                  <label htmlFor={`${id}-item-${index}-period`}>
                    Period
                    <input
                      id={`${id}-item-${index}-period`}
                      type="text"
                      maxLength={200}
                      value={item.period}
                      onChange={(event) =>
                        setItem(index, { period: event.target.value })
                      }
                    />
                  </label>
                  <label htmlFor={`${id}-item-${index}-include`}>
                    Include <small>One per line</small>
                    <textarea
                      id={`${id}-item-${index}-include`}
                      rows={Math.max(2, item.include.split("\n").length)}
                      value={item.include}
                      onChange={(event) =>
                        setItem(index, { include: event.target.value })
                      }
                    />
                  </label>
                </div>
                <details
                  className="rr-edit-more"
                  open={
                    item.detail !== "" ||
                    item.format !== "" ||
                    item.show !== "" ||
                    item.completeness !== "" ||
                    item.alternatives !== ""
                  }
                >
                  <summary>Note, format, and alternatives</summary>
                  <div className="rr-edit-grid">
                    <label htmlFor={`${id}-item-${index}-detail`}>
                      Note to the client
                      <textarea
                        id={`${id}-item-${index}-detail`}
                        rows={2}
                        value={item.detail}
                        onChange={(event) =>
                          setItem(index, { detail: event.target.value })
                        }
                      />
                    </label>
                    <label htmlFor={`${id}-item-${index}-format`}>
                      Format
                      <input
                        id={`${id}-item-${index}-format`}
                        type="text"
                        maxLength={160}
                        value={item.format}
                        onChange={(event) =>
                          setItem(index, { format: event.target.value })
                        }
                      />
                    </label>
                    <label htmlFor={`${id}-item-${index}-show`}>
                      Should show
                      <input
                        id={`${id}-item-${index}-show`}
                        type="text"
                        maxLength={400}
                        value={item.show}
                        onChange={(event) =>
                          setItem(index, { show: event.target.value })
                        }
                      />
                    </label>
                    <label htmlFor={`${id}-item-${index}-completeness`}>
                      Completeness
                      <input
                        id={`${id}-item-${index}-completeness`}
                        type="text"
                        maxLength={500}
                        value={item.completeness}
                        onChange={(event) =>
                          setItem(index, { completeness: event.target.value })
                        }
                      />
                    </label>
                    <label htmlFor={`${id}-item-${index}-alternatives`}>
                      If not available <small>One per line</small>
                      <textarea
                        id={`${id}-item-${index}-alternatives`}
                        rows={2}
                        value={item.alternatives}
                        onChange={(event) =>
                          setItem(index, { alternatives: event.target.value })
                        }
                      />
                    </label>
                  </div>
                </details>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn btn-secondary btn-sm rr-edit-add"
            onClick={() =>
              setDraft({ ...draft, items: [...draft.items, { ...EMPTY_ITEM }] })
            }
          >
            <UiIcon name="plus" size={13} />
            Add an item
          </button>
          <label htmlFor={`${id}-questions`}>
            Questions for the recipient <small>One per line, optional</small>
            <textarea
              id={`${id}-questions`}
              rows={2}
              value={draft.questions}
              onChange={(event) =>
                setDraft({ ...draft, questions: event.target.value })
              }
            />
          </label>
        </>
      )}
      {!plain && titled === 0 ? (
        <p className="rr-field-error">The request needs at least one item.</p>
      ) : null}
      {tooLong ? (
        <p className="rr-field-error">
          The wording is longer than a request can hold.
        </p>
      ) : null}
      <div className="rr-actions">
        <button
          type="button"
          className="btn"
          disabled={
            busy || text.trim() === "" || tooLong || (!plain && titled === 0)
          }
          onClick={() =>
            onSave({
              version: detail.version,
              description: text,
              recipient: detail.recipient,
              due_date: detail.dueAt.slice(0, 10),
              control_ref: detail.controlRef,
              attachment_refs: detail.attachmentRefs,
              follow_up_after_days: detail.followUpDays,
              max_follow_ups: detail.maxFollowUps,
            })
          }
        >
          Save changes
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
