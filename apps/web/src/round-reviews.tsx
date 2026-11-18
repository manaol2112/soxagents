import { CoverageForm } from "./coverage-form";
import type { Automation } from "./execution-model";
import type { ControlReview, ReviewNotice } from "./review-model";
import { openNotes } from "./review-model";
import { ReviewTab } from "./review-view";
import type { TestRound } from "./round-model";
import type { TestSheet } from "./sheet-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

const LEFT_WORDS: Record<string, string> = {
  OPEN: "Open",
  SIGNED_OFF: "Signed off",
};

/**
 * Each testing round's own independent review (W2), one line each, with its state and
 * what it covered; opening a line shows the full review (the agent's re-performance, the
 * notes, the reviewer's sign-off) and, once signed, its coverage. The control's own
 * review is not repeated here.
 */
export function RoundReviews({
  reviews,
  rounds,
  sheets,
  notice,
  ids,
  canAct,
  gaps,
  automation = null,
}: {
  reviews: ControlReview[];
  rounds: readonly TestRound[];
  sheets: readonly TestSheet[] | null;
  notice: ReviewNotice | null;
  ids: Ids;
  canAct: boolean;
  /** Coverage gaps the journey reports, by round phase word ("roll-forward", "retest"). */
  gaps: Record<string, string>;
  automation?: Automation | null;
}) {
  if (reviews.length === 0) {
    return null;
  }
  return (
    <section
      className="cw-round-reviews"
      aria-labelledby="cw-round-reviews-title"
    >
      <h2 id="cw-round-reviews-title">Reviews of the testing rounds</h2>
      <p className="cw-round-reviews-note">
        A round signed off after the control's review has a review of its own; a
        prior review never covers later work.
      </p>
      {reviews.map((review) => {
        const round =
          rounds.find((item) => item.id === review.testRoundId) ?? null;
        const sheet =
          round === null
            ? null
            : ((sheets ?? []).find((item) => item.id === round.sheetId) ??
              null);
        const word = review.roundKind === "RETEST" ? "retest" : "roll-forward";
        const open = openNotes(review).length;
        const covered = review.coverage?.sheet_version;
        return (
          <details key={review.id} className="cw-round-review">
            <summary>
              <span className="cw-round-review-name">
                <UiIcon
                  name={review.roundKind === "RETEST" ? "retry" : "arrow"}
                  size={13}
                />
                {word.charAt(0).toUpperCase() + word.slice(1)} round
                {round !== null ? ` ${round.number}` : ""}
              </span>
              <span
                className={`pill ${review.status === "SIGNED_OFF" ? "tone-success" : "tone-warning"}`}
              >
                {LEFT_WORDS[review.status] ?? review.status}
              </span>
              <span className="cw-round-review-state">
                {review.status === "SIGNED_OFF"
                  ? `Signed off${review.signedBy !== null ? ` by ${review.signedBy}` : ""}${typeof covered === "number" ? `, covering testing version ${covered}` : ""}`
                  : review.blocking.length > 0
                    ? `Before sign-off: ${review.blocking[0]}`
                    : open > 0
                      ? `${open} open note${open === 1 ? "" : "s"}`
                      : "Ready to sign off"}
              </span>
            </summary>
            <div className="cw-round-review-body">
              <ReviewTab
                review={review}
                sheet={sheet}
                notice={notice}
                ids={ids}
                canAct={canAct}
                automation={automation}
              />
              <CoverageForm
                review={review}
                ids={ids}
                gap={gaps[word] ?? ""}
                canAct={canAct}
              />
            </div>
          </details>
        );
      })}
    </section>
  );
}
