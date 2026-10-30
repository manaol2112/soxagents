import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The demo invitation's answers (Step 3), forwarded as the person and answered as JSON:
 * "initialize" asks the API to start the firm's demo (the API decides eligibility, who
 * may, and whether one exists already); "dismiss" keeps the person's answer. The dialog
 * reads the status and body (demo-model.ts).
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
  const organizationId =
    typeof fields.organization_id === "string" ? fields.organization_id : "";
  const intent = fields.intent;
  const expected = fields.expected_resets;
  if (
    !UUID.test(organizationId) ||
    (intent !== "initialize" && intent !== "dismiss" && intent !== "reset") ||
    (intent === "reset" &&
      !(
        typeof expected === "number" &&
        Number.isInteger(expected) &&
        expected >= 0
      ))
  ) {
    return NextResponse.json({ status: 422, body: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const headers = new Headers({ "content-type": "application/json" });
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  const forwarded = callerAddress(request);
  if (forwarded !== null) {
    headers.set("x-forwarded-for", forwarded);
  }
  const path =
    intent === "initialize"
      ? `/organizations/${organizationId}/demo/initialize`
      : intent === "reset"
        ? `/organizations/${organizationId}/demo/reset`
        : `/organizations/${organizationId}/demo/invitation`;
  const init: RequestInit = {
    method: "POST",
    headers,
    cache: "no-store",
    // Building the demo engagement takes longer than an ordinary write.
    signal: AbortSignal.timeout(intent === "dismiss" ? 8000 : 60000),
  };
  if (intent === "dismiss") {
    init.body = JSON.stringify({ response: "DISMISSED" });
  } else if (intent === "reset") {
    init.body = JSON.stringify({ expected_resets: expected });
  }
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, init);
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
