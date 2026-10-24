"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";

import { PHASE_LABELS } from "./evidence-center-model";
import { formatDate } from "./format";
import { RecordDialog } from "./record-dialog";
import {
  approveBlocker,
  type GroupMember,
  type GroupView,
  groupStatusLine,
  seenMembers,
} from "./request-group-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

const TONES: Record<GroupView["status"], string> = {
  PROPOSED: "info",
  APPROVED: "info",
  SENT: "success",
  NOT_SENT: "warning",
};

async function post(
  ids: Ids,
  fields: Record<string, unknown>,
): Promise<{ status: number; detail: string }> {
  try {
    const response = await fetch("/workspace/evidence-center", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        ...fields,
      }),
    });
    const body = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
    };
    return {
      status: typeof body.status === "number" ? body.status : 0,
      detail: typeof body.detail === "string" ? body.detail : "",
    };
  } catch {
    return { status: 0, detail: "" };
  }
}

/**
 * One request to one person for several controls: who it goes to and by when, every
 * control and item in it, what stops it, and the email itself, with one action that
 * approves and sends it. The status changes only once the server confirms it.
 */
export function GroupPanel({
  ids,
  view,
  closeHref,
  memberHref,
  side = null,
}: {
  ids: Ids;
  view: GroupView;
  closeHref: string;
  memberHref: (requestId: string) => string;
  /** The sent request's reminders, rendered by the page. */
  side?: ReactNode;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "send" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  // A second press while the first is on its way does nothing.
  const inFlight = useRef(false);
  const blocker = approveBlocker(view, included);
  const phase =
    view.phase === null ? "" : (PHASE_LABELS[view.phase] ?? view.phase);
  const working = busy !== null || pending;

  const run = async (kind: "approve" | "send") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setProblem(null);
    const answer = await post(
      ids,
      kind === "approve"
        ? {
            intent: "group-approve-send",
            group_id: view.id,
            members: seenMembers(view, included),
          }
        : { intent: "group-send", group_id: view.id },
    );
    inFlight.current = false;
    setBusy(null);
    if (answer.status !== 200) {
      setProblem(
        answer.detail ||
          (answer.status === 403
            ? "Your role does not permit this."
            : "The request could not be sent. Try again."),
      );
    }
    startTransition(() => router.refresh());
  };

  const callout =
    problem !== null ? (
      <p className="rr-callout is-warn" role="alert">
        <UiIcon name="info" size={14} />
        <span>{problem}</span>
      </p>
    ) : view.status === "NOT_SENT" ? (
      <p className="rr-callout is-warn" role="status">
        <UiIcon name="info" size={14} />
        <span>
          Not sent. {view.reason} Its requests are back in draft, to review and
          approve again.
        </span>
      </p>
    ) : view.notice !== "" ? (
      <p className="rr-callout is-warn" role="status">
        <UiIcon name="info" size={14} />
        <span>{view.notice}</span>
      </p>
    ) : null;

  return (
    <RecordDialog
      eyebrow={[view.reference, phase]
        .filter((part) => part !== "")
        .join(" · ")}
      title={view.title}
      closeHref={closeHref}
    >
      <div className="ec-dialog-body">
        <section className="rr is-in-dialog gp" aria-label="Request details">
          <div className="rr-layout">
            <div className="rr-main" aria-busy={working}>
              {callout}
              <section
                className="rr-section"
                aria-labelledby={`${id}-controls`}
              >
                <div className="rr-section-head">
                  <h4 id={`${id}-controls`}>
                    Controls{" "}
                    <span className="rr-count">{view.members.length}</span>
                  </h4>
                </div>
                <ul className="gp-members">
                  {view.members.map((member) => (
                    <Member
                      key={member.id}
                      member={member}
                      href={memberHref(member.id)}
                      showStage={view.status === "SENT"}
                    />
                  ))}
                </ul>
              </section>
              {view.status === "PROPOSED" && view.optional.length > 0 ? (
                <section className="rr-section" aria-labelledby={`${id}-more`}>
                  <div className="rr-section-head">
                    <h4 id={`${id}-more`}>Also for this person</h4>
                  </div>
                  <p className="rr-note">
                    Edited after drafting. Include a request to send it with
                    these.
                  </p>
                  <ul className="gp-members">
                    {view.optional.map((member) => (
                      <li key={member.id} className="gp-member gp-optional">
                        <label className="gp-include">
                          <input
                            type="checkbox"
                            checked={included.has(member.id)}
                            disabled={working}
                            onChange={(event) => {
                              const next = new Set(included);
                              if (event.target.checked) next.add(member.id);
                              else next.delete(member.id);
                              setIncluded(next);
                            }}
                          />
                          <span className="mono">{member.controlRef}</span>
                          <span className="gp-name">
                            {member.controlTitle || member.title}
                          </span>
                        </label>
                        {member.problem !== null ? (
                          <p className="rr-field-error">{member.problem}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {view.body !== "" ? (
                <section className="rr-section">
                  <details className="gp-email">
                    <summary>Email preview</summary>
                    <p className="gp-subject">{view.subject}</p>
                    <pre className="gp-body">{view.body}</pre>
                  </details>
                </section>
              ) : null}
            </div>
            <aside className="rr-side" aria-label="Status and actions">
              <section className="rr-panel">
                <p className="rr-panel-title">Status</p>
                <span
                  className={`pill pill-dot tone-${TONES[view.status]} gp-status`}
                >
                  {groupStatusLine(view)}
                </span>
                <dl className="gp-facts">
                  <dt>To</dt>
                  <dd>
                    {view.recipientName !== "" ? (
                      <>
                        {view.recipientName}
                        <span className="gp-sub">{view.recipient}</span>
                      </>
                    ) : (
                      view.recipient
                    )}
                    {view.cc.length > 0 ? (
                      <span className="gp-sub">
                        Copied: {view.cc.join(", ")}
                      </span>
                    ) : null}
                  </dd>
                  <dt>Due</dt>
                  <dd>{formatDate(view.dueAt)}</dd>
                  <dt>Items</dt>
                  <dd>
                    {view.itemCount} across {view.members.length} controls
                  </dd>
                  {view.sentAt !== null ? (
                    <>
                      <dt>Sent</dt>
                      <dd>{formatDate(view.sentAt)}</dd>
                    </>
                  ) : view.approvedAt !== null && view.status === "APPROVED" ? (
                    <>
                      <dt>Approved</dt>
                      <dd>
                        {formatDate(view.approvedAt)}
                        {view.approvedBy !== "" ? (
                          <span className="gp-sub">by {view.approvedBy}</span>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                </dl>
                {view.personalData ? (
                  <p className="rr-note">
                    Includes personal data, so it is sent on its own.
                  </p>
                ) : null}
                {view.status === "PROPOSED" ? (
                  <footer className="rr-foot" aria-busy={working}>
                    <div className="rr-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={working || blocker !== null}
                        onClick={() => void run("approve")}
                      >
                        <UiIcon name="mail" size={13} />
                        {busy === "approve"
                          ? "Approving and sending…"
                          : "Approve and send"}
                      </button>
                    </div>
                    {blocker !== null ? (
                      <p className="rr-note">{blocker}</p>
                    ) : (
                      <p className="rr-note">
                        Approves each control's request and sends one email.
                      </p>
                    )}
                  </footer>
                ) : null}
                {view.status === "APPROVED" && view.canApprove ? (
                  <footer className="rr-foot" aria-busy={working}>
                    <div className="rr-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={working}
                        onClick={() => void run("send")}
                      >
                        <UiIcon name="mail" size={13} />
                        {busy === "send" ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </footer>
                ) : null}
              </section>
              {view.status === "SENT" && side !== null ? (
                <section className="rr-panel">{side}</section>
              ) : null}
            </aside>
          </div>
        </section>
      </div>
    </RecordDialog>
  );
}

function Member({
  member,
  href,
  showStage,
}: {
  member: GroupMember;
  href: string;
  showStage: boolean;
}) {
  return (
    <li className="gp-member">
      <div className="gp-member-head">
        <span className="mono gp-ref">{member.controlRef}</span>
        <a className="gp-name" href={href} title="Open this control's request">
          {member.controlTitle || member.title}
        </a>
        {showStage ? (
          <span className="gp-stage">{member.stageLabel}</span>
        ) : member.dueDiffers ? (
          <span className="gp-stage">Due {formatDate(member.dueAt)}</span>
        ) : null}
      </div>
      {member.systems.length > 0 ? (
        <p className="gp-sub">{member.systems.join(", ")}</p>
      ) : null}
      {member.items.length > 0 ? (
        <ul className="gp-items">
          {member.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {member.problem !== null ? (
        <p className="rr-field-error">{member.problem}</p>
      ) : null}
    </li>
  );
}
