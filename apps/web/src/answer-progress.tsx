import { UiIcon } from "./ui-icon";

/** How many of the questions shown have an answer, as a line and a bar. */
export function AnswerProgress({
  answered,
  total,
}: {
  answered: number;
  total: number;
}) {
  const share = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <div className="pl-progress">
      <div className="pl-progress-line">
        <span>
          <strong>{answered}</strong> of {total} answered
        </span>
        {answered === total && total > 0 ? (
          <span className="pl-progress-done">
            <UiIcon name="check" size={12} />
            All answered
          </span>
        ) : null}
      </div>
      <div
        className="pl-progress-bar"
        role="progressbar"
        aria-label="Questions answered"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
      >
        <span style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}
