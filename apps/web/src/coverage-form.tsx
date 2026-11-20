import {
  type ControlReview,
  mayAssessCoverage,
  REVIEW_COVERAGE_ANCHOR,
} from "./review-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/**
 * A qualified reviewer documents whether a signed review covers the current testing
 * version and workpapers (review_coverage_assessments, W3 follow-up), without
 * re-performing: COVERS, or REQUIRES_REVIEW. Shown on a signed review when its coverage
 * is in question; the API refuses the preparer and anyone but the reviewer again.
 */
export function CoverageForm({
  review,
  ids,
  gap,
  held = "",
  canAct,
}: {
  review: ControlReview;
  ids: Ids;
  /** Why coverage is in question, in the journey's words; "" when it is not. */
  gap: string;
  /** What holds the signed review that a coverage assessment does not clear, in the
   * journey's words; "" when nothing does. Said, never offered a coverage decision. */
  held?: string;
  canAct: boolean;
}) {
  if (review.status !== "SIGNED_OFF") {
    return null;
  }
  const covered = review.coverage?.sheet_version;
  const may = mayAssessCoverage(review, canAct);
  // A reason a coverage assessment does not clear comes first (review-model.reviewHoldOf):
  // reopening clears a gap with it, so the form is offered only where it clears what holds
  // the review (design review, 19 November 2026).
  const offered = gap !== "" && held === "";
  const reason = held !== "" ? held : gap;
  return (
    <section
      className="cw-coverage"
      aria-labelledby={`cw-coverage-${review.id}`}
    >
      <h3 id={`cw-coverage-${review.id}`}>Review coverage</h3>
      <p className="cw-coverage-state">
        {typeof covered === "number"
          ? `Signed off against testing version ${covered}.`
          : "The version this review covered was not recorded."}
        {reason !== "" ? ` ${reason}.` : " Nothing has changed since."}
      </p>
      {held !== "" ? (
        <p className="cw-coverage-waits">
          The reviewer reopens the review and signs it again on the current
          records.
        </p>
      ) : null}
      {offered ? (
        may ? (
          <form
            id={REVIEW_COVERAGE_ANCHOR}
            method="post"
            action="/workspace/reviews"
            autoComplete="off"
            className="cw-coverage-form"
          >
            <input
              type="hidden"
              name="organization_id"
              value={ids.organizationId}
            />
            <input type="hidden" name="project_id" value={ids.projectId} />
            <input type="hidden" name="control_id" value={ids.controlId} />
            <input type="hidden" name="review_id" value={review.id} />
            <input type="hidden" name="version" value={review.version} />
            <input type="hidden" name="intent" value="coverage" />
            <fieldset>
              <legend>
                Does the signed review cover the current versions?
              </legend>
              <label>
                <input
                  type="radio"
                  name="decision"
                  value="COVERS"
                  required
                  data-arrive
                />
                It covers them (COVERS): record why, without re-performing
              </label>
              <label>
                <input type="radio" name="decision" value="REQUIRES_REVIEW" />
                It does not: a review of the changed work is required
              </label>
            </fieldset>
            <label className="cw-coverage-reason">
              Rationale
              <textarea
                name="reason"
                rows={2}
                minLength={3}
                maxLength={500}
                required
                placeholder="What changed, and why the signed review does or does not cover it"
              />
            </label>
            <button type="submit" className="btn btn-secondary">
              Record the coverage assessment
              <UiIcon name="arrow" size={14} />
            </button>
          </form>
        ) : (
          <p className="cw-coverage-waits">
            A reviewer who did not prepare this work documents whether the
            signed review covers it, or a new review is performed.
          </p>
        )
      ) : null}
    </section>
  );
}
