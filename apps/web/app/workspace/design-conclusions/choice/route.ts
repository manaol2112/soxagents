import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { choiceWrite } from "../../../../src/design-conclusion-model";
import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";

/**
 * The preparer records the D&I conclusion (docs/design-workpaper.md, section 3.6): the
 * API's choice route, called in the background from section 6 of the D&I workpaper with
 * the person's own session. It answers as JSON, never a redirect: the API's status (any
 * 2xx said as 200; 0 where the API could not be reached), its own sentence for a refusal,
 * and on 200 the D&I conclusion's body it answered with. choiceWrite refuses here what is
 * not three ids, one of the five conclusions, a basis of "Not effective", a reason within
 * its limit and a `replaces` that is an id or null; the API decides who may record it and
 * whether the records allow it. The session is never logged or returned.
 */
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
  const write = choiceWrite(fields);
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
    const body = (await response.json()) as unknown;
    if (status === 200) {
      result = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value.slice(0, 400) : "";
    }
  } catch {
    // The API was not reached, or did not answer in JSON: never a 200 without the body.
    status = status === 200 ? 502 : status;
    result = null;
  }
  return NextResponse.json({ status, detail, result });
}
