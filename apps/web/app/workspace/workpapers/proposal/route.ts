import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { sessionToken } from "../../../../src/load-workspace";
import { proposalCall } from "../../../../src/proposal-route";
import { proposalPath } from "../../../../src/section-redraft-model";

/** The caller's own proposal for a section (docs/design-workpaper.md, section 3.11), or
 * null: one call of the API with the person's session, answered as JSON with the API's
 * status, its sentence for a refusal and the proposal, never a redirect. The API returns
 * only the caller's own; proposalPath refuses here what is not three ids and a key. */
export async function GET(request: Request) {
  const path = proposalPath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({ status: 422, detail: "", proposal: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  return NextResponse.json(await proposalCall(session, "GET", path));
}
