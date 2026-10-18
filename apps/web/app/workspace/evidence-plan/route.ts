import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { planWrite } from "../../../src/evidence-plan-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** The control record's evidence plan actions: plan again, approve, decide a phase,
 * judge or waive an item, decide a proposed change, record a control change. Called in
 * the background; answers as JSON. */
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
  const write = planWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", plan: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let plan: unknown = null;
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
      signal: AbortSignal.timeout(write.slow ? 180000 : 15000),
    });
    status = response.status;
    const body = (await response.json()) as unknown;
    if (status === 200) {
      plan = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value : "";
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail, plan });
}
