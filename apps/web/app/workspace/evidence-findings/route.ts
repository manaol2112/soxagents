import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { findingsWrite } from "../../../src/evidence-findings-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** A person's decision on an evidence finding, or the follow-up they send to the control
 * owner (docs/evidence-intelligence.md, increment 2). Called in the background; answers
 * as JSON with the control's findings as the API returns them. */
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
  const write = findingsWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", result: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let result: unknown = null;
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
      signal: AbortSignal.timeout(30000),
    });
    status = response.status;
    const body = (await response.json()) as unknown;
    if (status === 200) {
      result = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value : "";
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail, result });
}
