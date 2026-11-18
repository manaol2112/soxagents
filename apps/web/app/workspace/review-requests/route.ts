import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { waitingPath } from "../../../src/review-request-model";

/**
 * Home's "Waiting for your review" (docs/design-workpaper.md, section 3.8): one read of
 * the viewer's standing review requests with the person's own session, answered as JSON
 * with the API's status, never a redirect. Nothing is written; the session is never
 * logged or returned.
 */
export async function GET(request: Request) {
  const path = waitingPath(new URL(request.url).searchParams);
  if (path === null) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
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
      signal: AbortSignal.timeout(15000),
    });
    status = response.ok ? 200 : response.status;
    const body = (await response.json()) as unknown;
    result = status === 200 ? body : null;
  } catch {
    status = status === 200 ? 502 : status;
    result = null;
  }
  return NextResponse.json({ status, detail: "", result });
}
