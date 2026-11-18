import { forwardReview } from "../../../../src/review-request-route";

/** The D&I review's "return" (docs/design-workpaper.md, section 3.8), as JSON: see
 * forwardReview. */
export async function POST(request: Request) {
  return forwardReview("return", request);
}
