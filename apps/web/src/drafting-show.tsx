"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UiIcon } from "./ui-icon";

export type DraftingCounts = {
  total: number;
  pending: number;
  drafted: number;
  byModel: number;
  failed: number;
};

/**
 * The evidence coordinator drafting the kickoff requests, shown as it happens: request
 * cards stacking into a tray, a ring that fills, and the control being drafted. It
 * refreshes the counts every few seconds until every request is drafted.
 */
export function DraftingShow({
  drafting,
  controls,
}: {
  drafting: DraftingCounts;
  /** The controls being drafted, "ITGC-AC-01 New user access is approved". */
  controls: string[];
}) {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const working = drafting.pending > 0;
  const done = drafting.drafted + drafting.failed;
  const share = drafting.total === 0 ? 0 : done / drafting.total;

  useEffect(() => {
    if (!working) {
      return;
    }
    // A new card every 1.4 s; fresh counts every 3 s, for as long as drafting runs.
    const cards = window.setInterval(() => setTick((n) => n + 1), 1400);
    const counts = window.setInterval(() => router.refresh(), 3000);
    return () => {
      window.clearInterval(cards);
      window.clearInterval(counts);
    };
  }, [working, router]);

  if (drafting.total === 0) {
    return null;
  }
  const current =
    controls.length === 0
      ? ""
      : (controls[(drafting.drafted + tick) % controls.length] ?? "");
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className={`drafting-show ${working ? "is-working" : "is-done"}`}
      aria-live="polite"
    >
      <div className="drafting-stage" aria-hidden="true">
        <svg className="drafting-ring" viewBox="0 0 80 80" role="presentation">
          <circle className="drafting-ring-track" cx="40" cy="40" r={radius} />
          <circle
            className="drafting-ring-fill"
            cx="40"
            cy="40"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - share)}
          />
        </svg>
        <span className="drafting-ring-label">
          {working ? (
            `${Math.round(share * 100)}%`
          ) : (
            <UiIcon name="check" size={22} />
          )}
        </span>
        <div className="drafting-cards">
          {working ? (
            <span key={tick} className="drafting-card is-flying">
              <span />
              <span />
              <span />
            </span>
          ) : null}
          <span className="drafting-card is-stacked is-low" />
          <span className="drafting-card is-stacked is-mid" />
          <span className="drafting-card is-stacked is-top" />
          <span className="drafting-tray" />
        </div>
      </div>
      <div className="drafting-copy">
        <strong>
          {working
            ? `Drafting evidence requests: ${drafting.drafted} of ${drafting.total}`
            : `All ${drafting.drafted} evidence requests drafted`}
        </strong>
        {working && current !== "" ? (
          <small key={current} className="drafting-current">
            <UiIcon name="sparkles" size={12} /> Writing the request for{" "}
            {current}
          </small>
        ) : working ? (
          <small>
            The evidence coordinator writes each request from its control.
          </small>
        ) : (
          <small>
            Each one waits as a draft. Nothing is sent until an approver
            confirms it.
          </small>
        )}
        <small className="drafting-meta">
          {working ? "A few seconds each, several at a time. " : ""}
          {drafting.byModel > 0
            ? `${drafting.byModel} written by an agent`
            : ""}
          {drafting.byModel > 0 && drafting.failed > 0 ? " · " : ""}
          {drafting.failed > 0 ? `${drafting.failed} need a redraft` : ""}
        </small>
      </div>
    </div>
  );
}
