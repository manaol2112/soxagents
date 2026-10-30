"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import {
  attributeLabel,
  changesOf,
  composeFollowUp,
  DECISION_LABELS,
  DECISIONS_NEEDING_NOTE,
  decisionsFor,
  type EvidenceFinding,
  FINDING_KIND_LABELS,
  FINDING_SOURCE_LABELS,
  FINDING_STATUS_LABELS,
  FINDING_STATUS_TONES,
  type FindingDecision,
  findingsProblem,
  latestNote,
  SENDABLE_STATUSES,
} from "./evidence-findings-model";
import type { EvidenceCitation } from "./evidence-preview-model";
import { formatDate } from "./format";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** One call to the findings route; refreshes the page's data when it succeeds. */
export function useFindingsAction(ids: Ids) {
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
      const response = await fetch("/workspace/evidence-findings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
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
    const message = findingsProblem(status, detail);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  return { run, busy, pending: pending || busy !== "", problem };
}

const KIND_ICON: Record<EvidenceFinding["kind"], IconName> = {
  GAP: "help",
  PARTIAL: "info",
  NOT_COVERED: "x",
  PLACEHOLDER: "compose",
  VERSION: "calendar",
  PERIOD: "clock",
  MISSING: "search",
  CONFLICT: "risk",
  CONCERN: "shield",
};

function toneOf(
  finding: EvidenceFinding,
): "warning" | "danger" | "success" | "neutral" {
  if (
    finding.status === "RESOLVED" ||
    finding.status === "CLARIFICATION_ACCEPTED"
  ) {
    return "success";
  }
  if (finding.status === "DISMISSED" || finding.status === "NOT_APPLICABLE") {
    return "neutral";
  }
  return finding.kind === "CONFLICT" ||
    finding.kind === "CONCERN" ||
    finding.kind === "NOT_COVERED" ||
    finding.status === "ESCALATED"
    ? "danger"
    : "warning";
}

function whereOf(citation: EvidenceCitation): string {
  if (citation.location !== "") {
    return citation.location;
  }
  return citation.page !== null ? `Page ${citation.page}` : "In the file";
}

/**
 * The findings on record for a file (increment 2): each with its status, what it rests
 * on, the question proposed, and the decisions its status allows. A person accepts,
 * edits, dismisses, resolves; the findings ticked go into the follow-up below.
 */
export function FindingRecords({
  findings,
  canAct,
  action,
  picked,
  onPick,
  onShow,
  focused,
}: {
  findings: EvidenceFinding[];
  canAct: boolean;
  action: ReturnType<typeof useFindingsAction>;
  picked: Set<string>;
  onPick: (id: string, on: boolean) => void;
  onShow: (citation: EvidenceCitation | null) => void;
  focused: EvidenceCitation | null;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const changes = changesOf(findings);
  const moved = [
    changes.answered > 0 ? `${changes.answered} answered` : "",
    changes.proposed > 0 ? `${changes.proposed} proposed` : "",
    changes.sent > 0 ? `${changes.sent} with the owner` : "",
    changes.stale > 0 ? `${changes.stale} out of date` : "",
    changes.closed > 0 ? `${changes.closed} closed` : "",
  ].filter((part) => part !== "");
  return (
    <>
      {moved.length > 0 ? (
        <p className="ei-changes" role="status">
          <UiIcon name="activity" size={13} />
          {moved.join(" · ")}
        </p>
      ) : null}
      <ul className="ei-findings">
        {findings.map((finding) => {
          const isOpen = opened === finding.id;
          const here =
            finding.citation !== null && focused === finding.citation;
          const note = latestNote(finding);
          return (
            <li
              key={finding.id}
              className={`is-${toneOf(finding)}${isOpen ? " is-open" : ""}${here ? " is-here" : ""}${finding.stale ? " is-stale" : ""}`}
            >
              <div className="ei-finding">
                <button
                  type="button"
                  className="ei-finding-main"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpened(isOpen ? null : finding.id);
                    onShow(finding.citation);
                  }}
                >
                  <span className="ei-finding-mark" aria-hidden="true">
                    <UiIcon name={KIND_ICON[finding.kind]} size={14} />
                  </span>
                  <span className="ei-finding-text">
                    <strong>{finding.title}</strong>
                    <small>{finding.observation}</small>
                    {note !== "" ? (
                      <em className="ei-finding-note">{note}</em>
                    ) : null}
                  </span>
                  <span className="ei-finding-side">
                    <span
                      className={`pill ${FINDING_STATUS_TONES[finding.status]}`}
                    >
                      {FINDING_STATUS_LABELS[finding.status]}
                    </span>
                    {finding.citation !== null ? (
                      <span className="ei-where">
                        <UiIcon name="search" size={11} />
                        {whereOf(finding.citation)}
                      </span>
                    ) : (
                      <span className="ei-where is-none">
                        Not located in the file
                      </span>
                    )}
                  </span>
                </button>
                {canAct && SENDABLE_STATUSES.includes(finding.status) ? (
                  <label className="ei-pick">
                    <input
                      type="checkbox"
                      checked={picked.has(finding.id)}
                      onChange={(event) =>
                        onPick(finding.id, event.target.checked)
                      }
                    />
                    <span className="sr-only">Include in the follow-up</span>
                  </label>
                ) : null}
              </div>
              {isOpen ? (
                <FindingDetail
                  finding={finding}
                  canAct={canAct}
                  action={action}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function FindingDetail({
  finding,
  canAct,
  action,
}: {
  finding: EvidenceFinding;
  canAct: boolean;
  action: ReturnType<typeof useFindingsAction>;
}) {
  const id = useId();
  const [deciding, setDeciding] = useState<FindingDecision | null>(null);
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState(finding.question);
  const [history, setHistory] = useState(false);
  const decisions = canAct ? decisionsFor(finding.status) : [];
  const decide = async (decision: FindingDecision) => {
    const ok = await action.run(`finding-${finding.id}`, {
      intent: "decide",
      finding_id: finding.id,
      decision,
      note,
      question: decision === "EDIT" ? question : "",
      version: finding.version,
    });
    if (ok) {
      setDeciding(null);
      setNote("");
    }
  };
  return (
    <div className="ei-finding-more">
      {finding.question !== "" && deciding !== "EDIT" ? (
        <p className="ei-finding-question">
          <strong>Proposed question:</strong> {finding.question}
          {finding.expected !== "" ? (
            <small>Would settle it: {finding.expected}</small>
          ) : null}
        </p>
      ) : null}
      <p className="ei-finding-source">
        {FINDING_SOURCE_LABELS[finding.source]} ·{" "}
        {FINDING_KIND_LABELS[finding.kind]}
        {finding.requirementTitle !== ""
          ? ` · ${finding.requirementTitle}`
          : ""}
        {attributeLabel(finding) !== "" ? ` · ${attributeLabel(finding)}` : ""}
        {finding.planRevision !== null
          ? ` · plan revision ${finding.planRevision}`
          : ""}
      </p>
      {finding.citation !== null ? (
        <blockquote>“{finding.citation.quote}”</blockquote>
      ) : null}
      {finding.decisionNote !== "" ? (
        <p className="ei-finding-decision">
          {finding.decidedBy ?? "A person"}
          {finding.decidedAt !== null
            ? `, ${formatDate(finding.decidedAt)}`
            : ""}
          : {finding.decisionNote}
        </p>
      ) : null}
      {deciding === null ? (
        decisions.length > 0 ? (
          <div className="ei-decide-buttons">
            {decisions.map((decision) => (
              <button
                key={decision}
                type="button"
                // Accepting and resolving lead; editing and the rest stay quiet.
                className={
                  decision === "ACCEPT" ||
                  decision === "RESOLVE" ||
                  decision === "REOPEN"
                    ? "btn btn-sm"
                    : "btn-ghost btn-sm"
                }
                disabled={action.pending}
                onClick={() => {
                  if (
                    decision === "EDIT" ||
                    DECISIONS_NEEDING_NOTE.includes(decision) ||
                    decision === "RESOLVE" ||
                    decision === "DISMISS"
                  ) {
                    setDeciding(decision);
                    setQuestion(finding.question);
                  } else {
                    void decide(decision);
                  }
                }}
              >
                {DECISION_LABELS[decision]}
              </button>
            ))}
          </div>
        ) : null
      ) : (
        <form
          className="ei-decide-form"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void decide(deciding);
          }}
        >
          {deciding === "EDIT" ? (
            <label htmlFor={`${id}-question`}>
              <span>The question to ask the control owner</span>
              <textarea
                id={`${id}-question`}
                value={question}
                maxLength={1000}
                rows={3}
                required
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>
          ) : (
            <label htmlFor={`${id}-note`}>
              <span>
                {DECISION_LABELS[deciding]}
                {DECISIONS_NEEDING_NOTE.includes(deciding)
                  ? ": why, in a sentence"
                  : ": a note (optional)"}
              </span>
              <textarea
                id={`${id}-note`}
                value={note}
                maxLength={1000}
                rows={2}
                required={DECISIONS_NEEDING_NOTE.includes(deciding)}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          )}
          <div className="ei-decide-buttons">
            <button
              type="submit"
              className="btn btn-sm"
              disabled={action.pending}
            >
              {deciding === "EDIT" ? "Save the question" : "Record"}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setDeciding(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {action.problem !== null && action.busy === "" ? (
        <p className="cc-problem" role="alert">
          {action.problem}
        </p>
      ) : null}
      {finding.events.length > 1 ? (
        <button
          type="button"
          className="ei-history-toggle"
          aria-expanded={history}
          onClick={() => setHistory((value) => !value)}
        >
          {history ? "Hide the history" : `History (${finding.events.length})`}
        </button>
      ) : null}
      {history ? (
        <ol className="ei-history">
          {finding.events.map((event) => (
            <li key={`${event.createdAt}-${event.event}-${event.actorKind}`}>
              <span>{formatDate(event.createdAt)}</span>
              <strong>{event.event.toLowerCase().replace(/_/g, " ")}</strong>
              {event.actorKind === "PERSON"
                ? ` by ${event.actor ?? "a person"}`
                : event.actorKind === "AGENT"
                  ? " by the agent"
                  : ""}
              {event.note !== "" ? `: ${event.note}` : ""}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * The follow-up a person sends to the control owner from the findings ticked: the
 * message starts from their questions, the person reviews it and confirms, and it goes
 * on the request's thread (the owner is emailed a fresh link). Nothing is sent until
 * the server confirms.
 */
export function FollowUpComposer({
  findings,
  requestId,
  controlRef,
  controlTitle,
  action,
  onSent,
}: {
  findings: EvidenceFinding[];
  requestId: string;
  controlRef: string;
  controlTitle: string;
  action: ReturnType<typeof useFindingsAction>;
  onSent: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  if (findings.length === 0 && sent === null) {
    return null;
  }
  return (
    <section
      className="ei-followup"
      aria-label="Follow-up to the control owner"
    >
      {sent !== null ? (
        <p className="ei-followup-sent" role="status">
          <UiIcon name="check" size={14} />
          Sent to the control owner: {sent} question{sent === 1 ? "" : "s"} on
          the request's thread.
        </p>
      ) : null}
      {findings.length > 0 && !open ? (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setText(composeFollowUp(findings, controlRef, controlTitle));
            setReviewed(false);
            setOpen(true);
          }}
        >
          <UiIcon name="mail" size={14} />
          Prepare a follow-up ({findings.length})
        </button>
      ) : null}
      {open ? (
        <form
          className="ei-followup-form"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reviewed) {
              return;
            }
            void action
              .run("follow-up", {
                intent: "follow-up",
                request_id: requestId,
                finding_ids: findings.map((finding) => finding.id),
                body: text,
              })
              .then((ok) => {
                if (ok) {
                  setSent(findings.length);
                  setOpen(false);
                  onSent();
                }
              });
          }}
        >
          <label htmlFor={`${id}-text`}>
            <span>The message to the control owner</span>
            <textarea
              id={`${id}-text`}
              value={text}
              maxLength={4000}
              rows={8}
              required
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="ei-followup-confirm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            <span>
              I have reviewed this message. It goes to the control owner on the
              request, who is emailed a link.
            </span>
          </label>
          <div className="ei-decide-buttons">
            <button
              type="submit"
              className="btn btn-sm"
              disabled={!reviewed || action.pending || text.trim() === ""}
            >
              <UiIcon name="mail" size={14} />
              Send to the owner
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
          {action.problem !== null ? (
            <p className="cc-problem" role="alert">
              {action.problem}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
