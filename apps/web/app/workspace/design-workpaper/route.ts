import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { designWorkpaperPath } from "../../../src/design-workpaper-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/**
 * The D&I workpaper as its three views read it (docs/design-workpaper.md, section 2): one
 * read of the API with the person's session, answered as JSON with the API's status. The
 * API decides who may read it. Nothing is written, queued or sent, and the session is
 * never logged or returned.
 */
export async function GET(request: Request) {
  const path = designWorkpaperPath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let result: unknown = null;
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    status = response.ok ? 200 : response.status;
    const body = (await response.json()) as unknown;
    if (status === 200) {
      result = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value : "";
    }
  } catch {
    // The API did not answer, or not in JSON: never a 200 without the workpaper. The
    // views say what to do (design-workpaper-model.ts, loadProblem).
    status = status === 200 ? 502 : status;
    result = null;
  }
  return NextResponse.json({ status, detail, result });
}
