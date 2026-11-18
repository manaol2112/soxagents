import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { sessionToken } from "../../../../src/load-workspace";
import { proposalCall } from "../../../../src/proposal-route";
import { redraftWrite } from "../../../../src/section-redraft-model";

/** "Redraft with the agent" (docs/design-workpaper.md, section 3.11): asks the API for
 * the agent's proposal for one section, called in the background. It answers as JSON
 * with the API's status (its 202 said as 200), the API's own sentence for a refusal, and
 * the proposal (PENDING); it never redirects. redraftWrite refuses here what is not three
 * ids, a section key and the workpaper's version; the API decides who may ask and starts
 * the run. Nothing in the workpaper changes. */
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
  const write = redraftWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", proposal: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  return NextResponse.json(
    await proposalCall(session, "POST", write.path, write.body),
  );
}
