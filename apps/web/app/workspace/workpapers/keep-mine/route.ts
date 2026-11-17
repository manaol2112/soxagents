import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { sessionToken } from "../../../../src/load-workspace";
import { proposalCall } from "../../../../src/proposal-route";
import { keepMineWrite } from "../../../../src/section-redraft-model";

/** "Keep mine" (docs/design-workpaper.md, section 3.11): ends the caller's proposal for a
 * section, one call of the API with the person's session, answered as JSON with the API's
 * status and its sentence for a refusal, never a redirect. The page takes the proposal
 * away only once this answers 200. keepMineWrite refuses here what is not three ids, a
 * key and the proposal's id. */
export async function POST(request: Request) {
  let fields: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      fields = body as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const write = keepMineWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", proposal: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  return NextResponse.json(
    await proposalCall(session, "POST", write.path, write.body),
  );
}
