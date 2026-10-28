import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { contextWrite, versionsPath } from "../../../src/control-context-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** The control record's context actions: attributes, process understanding, documents,
 * issues, classification, and reviews. Called in the background; answers as JSON. */
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
  const write = contextWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", context: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let context: unknown = null;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: write.method,
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(write.slow ? 180000 : 15000),
    });
    status = response.status;
    const body = (await response.json()) as unknown;
    if (status === 200) {
      context = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value : "";
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail, context });
}

/** A control's process narrative versions (0116), read when the Versions tab opens. The API
 * decides who may read them. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const path = versionsPath({
    organization_id: query.get("organization_id") ?? "",
    project_id: query.get("project_id") ?? "",
    control_id: query.get("control_id") ?? "",
  });
  if (path === null || query.get("intent") !== "process-versions") {
    return NextResponse.json({ status: 422, detail: "", versions: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    return NextResponse.json({
      status: response.status,
      detail: "",
      versions: response.status === 200 ? body : null,
    });
  } catch {
    return NextResponse.json({ status: 0, detail: "", versions: null });
  }
}
