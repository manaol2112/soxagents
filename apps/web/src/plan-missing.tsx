"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { UiIcon } from "./ui-icon";

/** Plans the engagement's unplanned controls, and drafts the requests planned evidence
 * never got, on a person's word; then shows the result. */
export function PlanMissingButton({
  organizationId,
  projectId,
  unplanned,
  unrequested,
  title,
}: {
  organizationId: string;
  projectId: string;
  unplanned: number;
  unrequested: number;
  /** The button's own words; the planned work is then its tooltip. */
  title?: string;
}) {
  const count = unplanned + unrequested;
  const work =
    unplanned > 0 && unrequested === 0
      ? `Plan the evidence for ${count} control${count === 1 ? "" : "s"}`
      : unplanned === 0
        ? `Draft the requests for ${count} control${count === 1 ? "" : "s"}`
        : `Plan and request evidence for ${count} control${count === 1 ? "" : "s"}`;
  const label = title ?? work;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  async function run() {
    setBusy(true);
    setOutcome("");
    let message = "The request could not be completed. Please try again.";
    try {
      const response = await fetch("/workspace/plan-missing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          project_id: projectId,
        }),
      });
      const body = (await response.json()) as {
        status?: number;
        planned?: number;
        requested?: number;
        remaining?: number;
        failed?: number;
      };
      if (body.status === 200) {
        message = `${(body.planned ?? 0) > 0 ? `Planned ${body.planned} control${body.planned === 1 ? "" : "s"}. ` : ""}${(body.requested ?? 0) > 0 ? `Drafted the requests for ${body.requested} control${body.requested === 1 ? "" : "s"}.` : ""}${
          (body.remaining ?? 0) > 0
            ? ` ${body.remaining} remaining; run again to continue.`
            : ""
        }${(body.failed ?? 0) > 0 ? ` ${body.failed} could not be done.` : ""}`;
      } else if (body.status === -1) {
        message =
          "Processing is taking longer than expected and continues in the background. Refresh shortly to see the updated count.";
      } else if (body.status === 403) {
        message = "Your role does not permit planning evidence.";
      }
    } catch {
      // The message above stands.
    }
    setBusy(false);
    setOutcome(message);
    startTransition(() => router.refresh());
  }
  return (
    <span className="plan-missing">
      <button
        type="button"
        className="btn btn-sm"
        title={title === undefined ? undefined : work}
        disabled={busy || pending}
        onClick={run}
      >
        <UiIcon name="sparkles" size={13} />
        {busy ? "Working…" : label}
      </button>
      {outcome !== "" ? (
        <small role="status" aria-live="polite">
          {outcome}
        </small>
      ) : null}
    </span>
  );
}
