import { forwardPoint } from "../../../../../src/design-points-route";

/** A point of the D&I workpaper considered, with a reason (docs/design-workpaper.md,
 * section 3.9), as JSON: see forwardPoint. */
export async function POST(request: Request) {
  return forwardPoint("consider", request);
}
