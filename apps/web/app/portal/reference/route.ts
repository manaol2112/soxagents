import { NextResponse } from "next/server";

import { apiBaseUrl } from "../../../src/load-workspace";
import { portalSession } from "../../../src/portal-api";
import { validRequestId } from "../../../src/portal-model";

/** A reference file the audit team shared on one of the recipient's open requests, for
 * the verified session in the cookie. Anything else is not found. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestId = params.get("request") ?? "";
  const referenceId = params.get("reference") ?? "";
  if (!validRequestId(requestId) || !validRequestId(referenceId)) {
    return new NextResponse(null, { status: 404 });
  }
  const session = await portalSession();
  if (session === undefined) {
    return new NextResponse(null, { status: 401 });
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}/public/evidence-portal/session/requests/${requestId}/references/${referenceId}`,
      {
        headers: { "x-portal-session": session },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition":
          response.headers.get("content-disposition") ??
          'attachment; filename="reference"',
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
