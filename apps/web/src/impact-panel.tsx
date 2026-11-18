"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDate } from "./format";
import {
  adviceWords,
  IMPACT_STATUS_LABEL,
  type ImpactAssessment,
  impactProblem,
  resultsWords,
  revisionWords,
} from "./impact-model";
import { UiIcon } from "./ui-icon";

/**
 * The control's plan-revision impact assessments (W3): what was signed off, under which
 * revision, what the agent recommends and why, and the reviewer's decision. Only a
 * reviewer who did not sign the testing sees the decision form; everyone sees the
 * state. Links open the testing and the review the assessment is about.
 */
export function ImpactPanel({
  assessments,
  ids,
  hrefs,
}: {
  assessments: ImpactAssessment[];
  ids: { organizationId: string; projectId: string; controlId: string };
  hrefs: { test: string; review: string };
}) {
  if (assessments.length === 0) {
    return null;
  }
  const pending = assessments.filter((item) => item.status === "PENDING");
  return (
    <section className="card cw-impact" aria-labelledby="cw-impact-title">
      <header className="card-header">
        <div>
          <h2 id="cw-impact-title">
            Plan revision: impact on signed-off results
          </h2>
          <p className="card-desc">
            {pending.length > 0
              ? "The test plan changed after results were signed off. Nothing relies on them until the engagement's reviewer decides whether they stand or the testing is re-performed."
              : "Each decision on results signed off under an earlier plan revision, as the reviewer recorded it."}
          </p>
        </div>
      </header>
      <ul className="cw-impact-list">
        {assessments.map((item) => (
          <Assessment key={item.id} item={item} ids={ids} hrefs={hrefs} />
        ))}
      </ul>
    </section>
  );
}

function Assessment({
  item,
  ids,
  hrefs,
}: {
  item: ImpactAssessment;
  ids: { organizationId: string; projectId: string; controlId: string };
  hrefs: { test: string; review: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<"VALID" | "REPERFORM" | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const advice = adviceWords(item);
  async function decide() {
    if (decision === null) {
      return;
    }
    setBusy(true);
    setProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/impact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          assessment_id: item.id,
          version: item.version,
          decision,
          rationale,
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
    setBusy(false);
    const message = impactProblem(status, detail);
    setProblem(message);
    if (message === null) {
      startTransition(() => router.refresh());
    }
  }
  return (
    <li className={`cw-impact-item is-${item.status.toLowerCase()}`}>
      <div className="cw-impact-head">
        <span
          className={`pill ${item.status === "PENDING" ? "tone-warning" : item.status === "VALID" ? "tone-success" : "tone-neutral"}`}
        >
          {IMPACT_STATUS_LABEL[item.status]}
        </span>
        <span className="cw-impact-what">
          {resultsWords(item)}
          {item.signedAt !== "" ? ` on ${formatDate(item.signedAt)}` : ""},{" "}
          {revisionWords(item)}.
        </span>
      </div>
      <p className="cw-impact-advice">
        <UiIcon name="sparkles" size={13} />
        <span>
          <strong>{advice.headline}</strong>
          {advice.because !== "" ? ` because ${advice.because}` : ""}
          {item.recommendation.changes.length > 0 ? (
            <>
              {" "}
              It compared the two revisions item by item:{" "}
              {item.recommendation.changes
                .slice(0, 6)
                .map(
                  (change) =>
                    `${change.section.toLowerCase()} ${change.code} ${change.change.toLowerCase()}`,
                )
                .join("; ")}
              {item.recommendation.changes.length > 6 ? "; …" : ""}.
            </>
          ) : null}
          <em className="cw-impact-human">
            {" "}
            A human reviewer makes the decision.
          </em>
        </span>
      </p>
      <p className="cw-impact-links">
        <a href={hrefs.test}>Open the testing</a>
        <a href={hrefs.review}>Open the review</a>
      </p>
      {item.status !== "PENDING" && item.decidedBy !== null ? (
        <p className="cw-impact-decided">
          Decided{" "}
          {item.status === "VALID"
            ? "that the results stand"
            : "re-performance"}{" "}
          by {item.decidedBy}
          {item.decidedAt !== null ? ` on ${formatDate(item.decidedAt)}` : ""}
          {item.rationale !== "" ? `: ${item.rationale}` : ""}
        </p>
      ) : null}
      {item.status === "PENDING" ? (
        item.viewerCanDecide ? (
          <form
            className="cw-impact-form"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void decide();
            }}
          >
            <fieldset>
              <legend>Your decision as the independent reviewer</legend>
              <label>
                <input
                  type="radio"
                  name={`decision-${item.id}`}
                  value="VALID"
                  checked={decision === "VALID"}
                  onChange={() => setDecision("VALID")}
                />
                The results stand under the revised plan (VALID)
              </label>
              <label>
                <input
                  type="radio"
                  name={`decision-${item.id}`}
                  value="REPERFORM"
                  checked={decision === "REPERFORM"}
                  onChange={() => setDecision("REPERFORM")}
                />
                Re-perform the testing (REPERFORM): the sheet and its review
                reopen
              </label>
            </fieldset>
            <label className="cw-impact-rationale">
              Rationale
              <textarea
                rows={2}
                maxLength={2000}
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                placeholder="Why the results stand, or why they must be re-performed"
              />
            </label>
            {problem !== null ? (
              <p className="cw-impact-problem" role="alert">
                {problem}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn"
              disabled={
                busy ||
                pending ||
                decision === null ||
                rationale.trim().length < 3
              }
            >
              {busy ? "Recording…" : "Record the decision"}
            </button>
          </form>
        ) : (
          <p className="cw-impact-waits">
            Waits on the engagement's independent reviewer. The person who
            signed the testing off never decides its assessment.
          </p>
        )
      ) : null}
    </li>
  );
}
