import type { ControlJourney } from "./control-journey-model.ts";
import type { ControlReview } from "./review-model.ts";
import type { TestSheet } from "./sheet-model.ts";

/** The sheet the step is about: the round's when the journey is at a roll-forward or
 * retest, else the control's own. */
export function sheetForStep(
  sheets: readonly TestSheet[],
  rounds: readonly { id: string; kind: string; sheetId: string | null }[],
  journey: ControlJourney | null,
): TestSheet | null {
  const phase = journey?.stepPhase ?? null;
  if (phase === "ROLLFORWARD" || phase === "RETEST") {
    const round = rounds.find((item) => item.kind === phase);
    const found = sheets.find(
      (sheet) => round !== undefined && sheet.id === round.sheetId,
    );
    if (found !== undefined) {
      return found;
    }
  }
  return sheets.find((sheet) => (sheet.testRoundId ?? null) === null) ?? null;
}

/** The review the step is about: the round's review when the journey is at a round with
 * one, else the control's own; without one, a round's review still open (the step's
 * work), else the latest round review on record. */
export function reviewForStep(
  reviews: readonly ControlReview[],
  journey: ControlJourney | null,
): ControlReview | null {
  const phase = journey?.stepPhase ?? null;
  if (phase === "ROLLFORWARD" || phase === "RETEST") {
    const found = reviews.find((review) => review.roundKind === phase);
    if (found !== undefined) {
      return found;
    }
  }
  return (
    reviews.find((review) => (review.testRoundId ?? null) === null) ??
    reviews.find((review) => review.status === "OPEN") ??
    reviews[reviews.length - 1] ??
    null
  );
}
