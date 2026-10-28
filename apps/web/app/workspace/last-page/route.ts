import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { lastPageTarget } from "../../../src/last-page-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** Keeps the page the person is on as their last (LastPageRecorder). Called in the
 * background; nothing depends on its answer. */
export async function POST(request: Request) {
  let path: string | null = null;
  try {
    path = lastPageTarget((await request.json()) as unknown);
  } catch {
    path = null;
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (path === null || session === undefined) {
    return new NextResponse(null, { status: 204 });
  }
  try {
    await fetch(`${apiBaseUrl()}/me/last-page`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `aw_session=${session}`,
      },
      body: JSON.stringify({ path }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Remembering the page is a convenience: a failure changes nothing on the page.
  }
  return new NextResponse(null, { status: 204 });
}
