import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plan every in-scope control of a running engagement that has no evidence plan, with
 * the reviewed rules; kickoff drafts wait for a person. Answers as JSON. */
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
  const organizationId = String(fields.organization_id ?? "");
  const projectId = String(fields.project_id ?? "");
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return NextResponse.json({ status: 422 });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/evidence-plans/plan-missing`,
      {
        method: "POST",
        headers,
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      planned?: unknown;
      requested?: unknown;
      remaining?: unknown;
      failed?: unknown;
    } | null;
    return NextResponse.json({
      status: response.status,
      planned: typeof payload?.planned === "number" ? payload.planned : 0,
      requested: typeof payload?.requested === "number" ? payload.requested : 0,
      remaining: typeof payload?.remaining === "number" ? payload.remaining : 0,
      failed: Array.isArray(payload?.failed) ? payload.failed.length : 0,
    });
  } catch (error) {
    return NextResponse.json({
      status: error instanceof Error && error.name === "TimeoutError" ? -1 : 0,
    });
  }
}
