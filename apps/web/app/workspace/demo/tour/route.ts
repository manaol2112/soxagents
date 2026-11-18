import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE = /^[a-z][a-z-]{1,39}$/;
const STATUSES = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "SKIPPED",
  "COMPLETED",
]);

/**
 * The guided tour's progress (Step 5), forwarded as the person and answered as JSON:
 * GET reads where they stand and the records the stages open; PUT moves them (start,
 * reach a stage, skip, finish). The API decides eligibility and membership; the page
 * reads the status and body (demo-tour-model.ts).
 */
export async function GET(request: Request) {
  const organizationId =
    new URL(request.url).searchParams.get("organization") ?? "";
  if (!UUID.test(organizationId)) {
    return NextResponse.json({ status: 422, body: null });
  }
  return forward(request, organizationId, { method: "GET" });
}

export async function PUT(request: Request) {
  let fields: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      fields = body as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const organizationId =
    typeof fields.organization_id === "string" ? fields.organization_id : "";
  const stage = typeof fields.stage === "string" ? fields.stage : "";
  const status = typeof fields.status === "string" ? fields.status : "";
  if (
    !UUID.test(organizationId) ||
    !STAGE.test(stage) ||
    !STATUSES.has(status)
  ) {
    return NextResponse.json({ status: 422, body: null });
  }
  return forward(request, organizationId, {
    method: "PUT",
    body: JSON.stringify({ stage, status }),
  });
}

async function forward(
  request: Request,
  organizationId: string,
  init: RequestInit,
) {
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const headers = new Headers({ "content-type": "application/json" });
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  const forwarded = callerAddress(request);
  if (forwarded !== null) {
    headers.set("x-forwarded-for", forwarded);
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/demo/tour`,
      {
        ...init,
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    const body = (await response.json().catch(() => null)) as unknown;
    return NextResponse.json({ status: response.status, body });
  } catch {
    return NextResponse.json({ status: 0, body: null });
  }
}

/** The browser's address as the front proxy reported it, for the API's throttles. */
function callerAddress(request: Request): string | null {
  const forwarded =
    request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  if (forwarded === null) {
    return null;
  }
  const first = forwarded.split(",")[0]?.trim() ?? "";
  return /^[0-9a-f.:]{3,64}$/i.test(first) ? first : null;
}
