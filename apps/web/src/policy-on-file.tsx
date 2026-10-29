"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  decisionProblem,
  documentLine,
  kindLabel,
  NO_POLICY_EVIDENCE,
  type PolicyEvidence,
  type PolicyProposal,
  parsePolicyEvidence,
  policiesHref,
} from "./policy-evidence-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

// While the agent reads, the proposals are asked for again now and then, for two minutes.
const POLL_MS = 5000;
const POLL_LIMIT = 24;

/**
 * The policies on file the agent proposes for a control's items, read once for the
 * control; again only while the agent is still reading, and after a decision.
 */
export function usePolicyEvidence(ids: Ids): {
  evidence: PolicyEvidence;
  reload: () => void;
} {
  const [evidence, setEvidence] = useState<PolicyEvidence>(NO_POLICY_EVIDENCE);
  const asked = useRef(0);
  // A newer read wins: an older answer arriving late is dropped.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const turn = ++latest.current;
    try {
      const response = await fetch(
        `/workspace/policy-evidence?${new URLSearchParams({
          organization: ids.organizationId,
          project: ids.projectId,
          control: ids.controlId,
        }).toString()}`,
      );
      const answer = (await response.json()) as { result?: unknown };
      const parsed = parsePolicyEvidence(answer.result);
      if (parsed !== null && turn === latest.current) {
        setEvidence(parsed);
      }
    } catch {
      // A proposal is a convenience: without it the item is as it was.
    }
  }, [ids.organizationId, ids.projectId, ids.controlId]);

  useEffect(() => {
    asked.current = 0;
    setEvidence(NO_POLICY_EVIDENCE);
    void load();
  }, [load]);

  useEffect(() => {
    if (!evidence.checking || asked.current >= POLL_LIMIT) {
      return;
    }
    const timer = window.setTimeout(() => {
      asked.current += 1;
      void load();
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [evidence, load]);

  return { evidence, reload: () => void load() };
}

/**
 * The policy on file the agent relates to this item, as the product owner's reference
 * (28 October 2026): the document, the passage that bears on the item, and the decision.
 * Add evidence files the document on the item, as an upload would (decided by the product
 * owner the same day); Not relevant dismisses it; Review mapping opens the test-plan
 * mapping. Nothing is evidence until a person adds it, and the item shows it only once the
 * server confirms. Why the agent related it opens on request.
 */
export function PolicyOnFile({
  ids,
  proposal,
  canAct,
  onDecided,
  onMapping,
}: {
  ids: Ids;
  proposal: PolicyProposal;
  canAct: boolean;
  onDecided: () => void;
  onMapping: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const href = policiesHref(ids, proposal.documentId);

  async function decide(decision: "accept" | "dismiss") {
    setBusy(decision);
    setProblem(null);
    try {
      const response = await fetch("/workspace/policy-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          proposal_id: proposal.id,
          decision,
        }),
      });
      const answer = (await response.json()) as {
        status?: number;
        detail?: string;
      };
      if (answer.status !== 200) {
        setProblem(decisionProblem(answer.status ?? 0, answer.detail ?? ""));
        setBusy(null);
        return;
      }
      onDecided();
      if (decision === "accept") {
        // The item's new file and status come from the server.
        router.refresh();
      }
    } catch {
      setProblem(decisionProblem(0, ""));
    }
    setBusy(null);
  }

  return (
    <section className="pm" aria-label="Related policy on file">
      <header className="pm-head">
        <h4>Related {kindLabel(proposal.kind).toLowerCase()} on file</h4>
        <a className="text-link is-plain" href={href}>
          View document
          <UiIcon name="arrow" size={14} />
        </a>
      </header>
      <div className="pm-doc">
        <span className="pm-doc-icon" aria-hidden="true">
          <UiIcon name="file" size={20} />
        </span>
        <span className="pm-doc-text">
          <strong>{proposal.title}</strong>
          <small>{documentLine(proposal)}</small>
        </span>
        {proposal.usable ? (
          <span className="pm-state is-ready">
            <span className="pm-tick" aria-hidden="true">
              <UiIcon name="check" size={11} />
            </span>
            Reference available
          </span>
        ) : (
          <span className="pm-state is-needed">
            <UiIcon name="info" size={15} />
            File needed
          </span>
        )}
      </div>
      {proposal.quote !== "" ? (
        <>
          <h4 className="pm-sub">Relevant excerpt</h4>
          <blockquote className="pm-quote">“{proposal.quote}”</blockquote>
        </>
      ) : null}
      <p className="pm-note">
        This {kindLabel(proposal.kind).toLowerCase()} may support the request;
        reviewer confirmation is required.
      </p>
      {proposal.reason !== "" ? (
        <details className="pm-why">
          <summary>Why the agent related it</summary>
          <p>{proposal.reason}</p>
        </details>
      ) : null}
      {problem !== null ? (
        <p className="pm-error" role="alert">
          {problem}
        </p>
      ) : null}
      <footer className="pm-foot">
        <p>
          <UiIcon name="info" size={16} />
          {proposal.usable
            ? "Nothing is filed until you add it; the evidence is then reviewed."
            : "Replace it with its file on Systems & Processes to add it as evidence."}
        </p>
        {canAct ? (
          <span className="pm-actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy !== null}
              onClick={() => void decide("dismiss")}
            >
              Not relevant
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={onMapping}
            >
              Review mapping
            </button>
            {proposal.usable ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide("accept")}
              >
                {busy === "accept" ? (
                  <span className="spinner small" aria-hidden="true" />
                ) : null}
                Add evidence
                <UiIcon name="arrow" size={15} />
              </button>
            ) : (
              <a className="btn" href={href}>
                Replace file
                <UiIcon name="arrow" size={15} />
              </a>
            )}
          </span>
        ) : null}
      </footer>
    </section>
  );
}

/** While the agent reads the policies on file for an item that asks for one. */
export function CheckingPolicies() {
  return (
    <p className="pf-checking" aria-live="polite">
      <span className="spinner small" aria-hidden="true" />
      Checking the policies on file for this item…
    </p>
  );
}
