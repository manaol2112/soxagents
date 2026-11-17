import { forwardPoint } from "../../../../../src/design-points-route";

/** A consideration of a point withdrawn (docs/design-workpaper.md, section 3.9), as JSON:
 * see forwardPoint. */
export async function POST(request: Request) {
  return forwardPoint("withdraw", request);
}
