"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { ConfirmAction } from "./confirm-action";
import {
  DEMO_CLIENT,
  type DemoSummary,
  demoHref,
  resetOutcome,
} from "./demo-model";
import { UiIcon } from "./ui-icon";

export const RESET_COPY = {
  title: "Reset your demo workspace?",
  consequence: `This will create a fresh copy of the ${DEMO_CLIENT} audit engagement. Your current demo will be archived, including any work you've completed in it. Your personal engagements and trial usage will not be affected.`,
  confirm: "Reset Demo",
  cancel: "Cancel",
} as const;

/**
 * The demo workspace card on the demo engagement's settings (Step 6): the resets left,
 * and the Reset Demo action behind the application's confirmation dialog. The server
 * archives the current demo, builds the replacement and counts the reset only once the
 * replacement is ready; the page moves to the new demo when the server confirms it.
 */
export function DemoResetCard({
  organizationId,
  demo,
}: {
  organizationId: string;
  demo: DemoSummary;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !demo.canReset) {
      return;
    }
    setBusy(true);
    setProblem(null);
    let answer: { status: number; body: unknown };
    try {
      const response = await fetch("/workspace/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          intent: "reset",
          expected_resets: demo.resets,
        }),
      });
      answer = (await response.json()) as { status: number; body: unknown };
    } catch {
      answer = { status: 0, body: null };
    }
    const outcome = resetOutcome(answer.status, answer.body);
    if (outcome.kind === "ready") {
      startTransition(() => {
        router.push(demoHref(organizationId, outcome.projectId));
        router.refresh();
      });
      return;
    }
    setProblem(outcome.words);
    setBusy(false);
  };

  const left = demo.resetsLeft;
  return (
    <section
      className="card demo-reset-card"
      aria-labelledby="demo-reset-title"
    >
      <div className="demo-reset-head">
        <span className="demo-point-icon">
          <UiIcon name="sparkles" size={16} />
        </span>
        <div>
          <h2 id="demo-reset-title">Demo workspace</h2>
          <p>
            A synthetic engagement for {DEMO_CLIENT}. Resetting it archives this
            copy, with everything done in it, and prepares a fresh one with the
            guided tour ready to start again.
          </p>
        </div>
      </div>
      <dl className="demo-reset-facts">
        <div>
          <dt>Resets left</dt>
          <dd>
            {left} of 3
            {demo.resets > 0
              ? ` · ${demo.resets} ${demo.resets === 1 ? "reset" : "resets"} made`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Trial usage</dt>
          <dd>Not affected by a reset</dd>
        </div>
      </dl>
      {problem !== null ? (
        <p className="demo-outcome is-failed" role="alert">
          <UiIcon name="info" size={15} />
          <span>{problem}</span>
        </p>
      ) : null}
      {demo.canReset ? (
        <form
          className="demo-reset-form"
          autoComplete="off"
          onSubmit={(event) => void submit(event)}
          aria-busy={busy}
        >
          <ConfirmAction
            label={busy ? "Preparing the new demo…" : "Reset demo"}
            intent="reset-demo"
            title={RESET_COPY.title}
            consequence={`${RESET_COPY.consequence} Resets left after this one: ${Math.max(0, left - 1)} of 3.`}
            confirmLabel={RESET_COPY.confirm}
            className="btn-secondary"
            tone="neutral"
          />
        </form>
      ) : (
        <p className="form-hint">
          {left === 0
            ? "The trial's three demo resets are used. The demo stays open to explore."
            : demo.state !== "READY"
              ? "The demo is not ready to reset right now."
              : "Only a member who can create engagements may reset the demo, while the trial runs."}
        </p>
      )}
    </section>
  );
}
