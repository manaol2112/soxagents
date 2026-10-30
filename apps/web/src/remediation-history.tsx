import type { Deficiency, EngagementState } from "./engagement-model";
import {
  type RemediationHistory,
  remediationHistory,
  type TestComparison,
} from "./remediation-model";
import { UiIcon } from "./ui-icon";

const RESULT_WORDS: Record<TestComparison["result"], string> = {
  EFFECTIVE: "Effective",
  NOT_EFFECTIVE: "Not effective",
  NOT_CONCLUDED: "Not concluded",
};

function Comparison({ side }: { side: TestComparison }) {
  const tone =
    side.result === "EFFECTIVE"
      ? "positive"
      : side.result === "NOT_EFFECTIVE"
        ? "risk"
        : "neutral";
  return (
    <div>
      <h4>
        <span className={`pill pill-dot tone-${tone}`}>
          {RESULT_WORDS[side.result]}
        </span>
        {side.label}
      </h4>
      <dl>
        <dt>Items tested</dt>
        <dd>{side.items}</dd>
        <dt>Exceptions</dt>
        <dd>{side.exceptions}</dd>
        <dt>Signed off</dt>
        <dd>
          {side.signedBy === null
            ? "Not yet"
            : `${side.signedBy}${side.signedAt ? `, ${side.signedAt.slice(0, 10)}` : ""}`}
        </dd>
        <dt>Independent review</dt>
        <dd>{side.reviewed ? "Signed off" : "Not signed off"}</dd>
      </dl>
      {side.href !== null ? (
        <p className="form-hint">
          <a className="text-link" href={side.href}>
            Open the test sheet
          </a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * A deficiency's remediation history (Step 5): the lifecycle from the original failed
 * test to the closed deficiency as a track, and the original test beside the retest.
 * Every step reads from the records; the original exceptions stay on record.
 */
export function RemediationHistoryCard({
  item,
  engagement,
  organizationId,
  projectId,
}: {
  item: Deficiency;
  engagement: EngagementState;
  organizationId: string;
  projectId: string;
}) {
  const history: RemediationHistory = remediationHistory(
    item,
    {
      sheets: engagement.sheets,
      rounds: engagement.rounds,
      reviews: engagement.reviews,
    },
    { organizationId, projectId },
  );
  return (
    <section
      className="rem-card stack"
      aria-labelledby={`rem-history-${item.id}`}
    >
      <h3 id={`rem-history-${item.id}`} className="card-subtitle">
        Remediation history
      </h3>
      <ol className="rem-history">
        {history.steps.map((step) => (
          <li key={step.key} className={`is-${step.state}`}>
            <span className="rem-dot" aria-hidden="true">
              <UiIcon
                name={
                  step.state === "failed"
                    ? "risk"
                    : step.state === "done"
                      ? "check"
                      : "clock"
                }
                size={12}
              />
            </span>
            <div className="rem-body">
              <strong>
                {step.title}
                <span className="sr-only">
                  {step.state === "failed"
                    ? " (exception)"
                    : step.state === "done"
                      ? " (done)"
                      : " (pending)"}
                </span>
              </strong>
              <span>{step.detail}</span>{" "}
              {step.href !== null && step.state !== "pending" ? (
                <a className="text-link" href={step.href}>
                  View
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {history.original !== null || history.retest !== null ? (
        <>
          <h3 className="card-subtitle">Original test and retest</h3>
          <div className="rem-compare">
            {history.original !== null ? (
              <Comparison side={history.original} />
            ) : null}
            {history.retest !== null ? (
              <Comparison side={history.retest} />
            ) : (
              <div>
                <h4>Retest</h4>
                <p className="form-hint">
                  No retest round is open for this deficiency yet.
                </p>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
