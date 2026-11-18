import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { type PointIntent, pointWrite } from "./design-points-model";
import { apiBaseUrl, sessionToken } from "./load-workspace";

/**
 * One write on a point of the D&I workpaper (docs/design-workpaper.md, section 3.9:
 * consider it with a reason, or withdraw the consideration), called in the background from
 * the point's place with the person's own session. It answers as JSON, never a redirect:
 * the API's status (any 2xx said as 200; 0 where the API could not be reached), its own
 * sentence for a refusal, and on 200 the body it answered with. pointWrite refuses here
 * what is not three ids, a key and the contract's own fields; the API decides who may do
 * it and whether the point is still the one read. The session is never logged or returned.
 */
export async function forwardPoint(
  intent: PointIntent,
  request: Request,
): Promise<NextResponse> {
  let fields: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      fields = body as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const write = pointWrite(intent, fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let result: unknown = null;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    status = response.ok ? 200 : response.status;
    const body = (await response.json().catch(() => null)) as unknown;
    if (status === 200) {
      result = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      // The server's sentence, read as text only and bounded; a validation list (422) is
      // not a sentence.
      const value = (body as { detail?: unknown }).detail;
      detail =
        typeof value === "string"
          ? value.replace(/\s+/g, " ").trim().slice(0, 400)
          : "";
    }
  } catch {
    // The API was not reached, or did not answer: never a 200 without its answer.
    status = status === 200 ? 502 : status;
    result = null;
  }
  return NextResponse.json({ status, detail, result });
}
