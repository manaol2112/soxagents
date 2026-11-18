"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DEMO_COPY, type DemoOutcome, demoOutcome } from "./demo-model";
import { RecordDialog } from "./record-dialog";
import { UiIcon } from "./ui-icon";

const POINTS: ReadonlyArray<{
  icon: "flow" | "agents" | "wand";
  text: string;
}> = [
  {
    icon: "flow",
    text: "Planning, evidence requests, testing, independent review and reporting, end to end.",
  },
  {
    icon: "agents",
    text: "Specialized agents prepare the work; people approve every sensitive action.",
  },
  { icon: "wand", text: "Realistic synthetic data. No setup required." },
];

/**
 * The first-login invitation to the synthetic demo (Step 3). It opens over the page a
 * trial member lands on, once: "Explore demo" asks the server to start the firm's demo
 * and opens it when ready; "Start my own engagement" keeps the answer and continues the
 * firm's own onboarding; closing keeps the answer too. The account menu offers the demo
 * again while the trial runs (reopened), without asking the server to remember anything.
 */
export function DemoInvitation({
  organizationId,
  reopened,
  firstEngagement,
  createHref,
  closeHref,
}: {
  organizationId: string;
  reopened: boolean;
  /** No engagement yet: declining goes straight to the engagement form. */
  firstEngagement: boolean;
  createHref: string;
  closeHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"explore" | "decline" | null>(null);
  const [outcome, setOutcome] = useState<DemoOutcome | null>(null);
  const [, startTransition] = useTransition();

  const post = async (
    intent: "initialize" | "dismiss",
  ): Promise<{ status: number; body: unknown }> => {
    try {
      const response = await fetch("/workspace/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization_id: organizationId, intent }),
      });
      return (await response.json()) as { status: number; body: unknown };
    } catch {
      return { status: 0, body: null };
    }
  };

  const explore = async () => {
    if (busy !== null) {
      return;
    }
    setBusy("explore");
    setOutcome(null);
    const answer = await post("initialize");
    const result = demoOutcome(answer.status, answer.body, organizationId);
    setOutcome(result);
    if (result.kind === "ready") {
      // The demo opens only once the server confirms it exists.
      startTransition(() => router.push(result.href));
      return;
    }
    setBusy(null);
  };

  const decline = async (next: "create" | "stay") => {
    if (busy !== null) {
      return;
    }
    setBusy("decline");
    if (!reopened) {
      await post("dismiss");
    }
    startTransition(() => {
      if (next === "create" && firstEngagement) {
        router.push(createHref);
      } else {
        router.replace(closeHref, { scroll: false });
        router.refresh();
      }
    });
  };

  const preparing = outcome?.kind === "preparing";
  return (
    <RecordDialog
      className="demo-dialog"
      eyebrow={DEMO_COPY.eyebrow}
      title={DEMO_COPY.title}
      closeHref={closeHref}
      onClose={() => void decline("stay")}
    >
      <div className="demo-invite" aria-busy={busy !== null}>
        {preparing ? (
          <div className="demo-preparing" role="status">
            <span className="demo-preparing-icon">
              <UiIcon name="clock" size={20} />
            </span>
            <div>
              <strong>{DEMO_COPY.preparingTitle}</strong>
              <p>{DEMO_COPY.preparing}</p>
            </div>
          </div>
        ) : (
          <>
            <p className="demo-lead">{DEMO_COPY.lead}</p>
            <ul className="demo-points">
              {POINTS.map((point) => (
                <li key={point.icon}>
                  <span className="demo-point-icon">
                    <UiIcon name={point.icon} size={16} />
                  </span>
                  <span>{point.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {outcome !== null && outcome.kind !== "ready" && !preparing ? (
          <p className={`demo-outcome is-${outcome.kind}`} role="alert">
            <UiIcon name="info" size={15} />
            <span>{outcome.words}</span>
          </p>
        ) : null}
        <div className="demo-actions">
          {preparing ? null : (
            <button
              type="button"
              className="btn"
              onClick={() => void explore()}
              disabled={busy !== null}
            >
              {busy === "explore" ? "Preparing the demo…" : DEMO_COPY.explore}
              <UiIcon name="arrow" size={15} />
            </button>
          )}
          <button
            type="button"
            className={preparing ? "btn" : "btn btn-secondary"}
            onClick={() => void decline("create")}
            disabled={busy !== null}
          >
            {DEMO_COPY.own}
            {preparing ? <UiIcon name="arrow" size={15} /> : null}
          </button>
        </div>
        <p className="demo-note">
          <UiIcon name="shield" size={14} />
          <span>{DEMO_COPY.note}</span>
        </p>
      </div>
    </RecordDialog>
  );
}
