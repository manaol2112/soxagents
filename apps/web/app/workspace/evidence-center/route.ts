import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { centerWrite } from "../../../src/evidence-center-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function forwarded(json: boolean): Promise<Headers> {
  const headers = new Headers();
  if (json) {
    headers.set("content-type", "application/json");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  return headers;
}

/** A change from the evidence command center: one request or many, a saved view, a new
 * request, or the planned evidence of a control. Called in the background; answers as
 * JSON with the API's status and body. The API decides who may do each. */
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
  const write = centerWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", body: null });
  }
  try {
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: "POST",
      headers: await forwarded(true),
      body: JSON.stringify(write.body),
      cache: "no-store",
      // Many requests at once take a while: each is its own transaction.
      signal: AbortSignal.timeout(write.intent === "bulk" ? 120000 : 15000),
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const detail =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { detail?: unknown }).detail === "string"
        ? (payload as { detail: string }).detail
        : "";
    return NextResponse.json({
      status: response.status,
      detail: response.status === 200 ? "" : detail,
      body: response.status === 200 || response.status === 201 ? payload : null,
    });
  } catch {
    return NextResponse.json({ status: 503, detail: "", body: null });
  }
}

/** The filtered list as a spreadsheet. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const organizationId = params.get("organization") ?? "";
  const projectId = params.get("project") ?? "";
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return new NextResponse(null, { status: 404 });
  }
  params.delete("organization");
  params.delete("project");
  params.delete("page");
  params.delete("size");
  try {
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/evidence-requests.csv?${params.toString()}`,
      {
        headers: await forwarded(false),
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="evidence-requests.csv"',
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
