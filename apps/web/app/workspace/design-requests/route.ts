import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requestsWrite } from "../../../src/design-requests-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** The D&I requests list's own actions (12 November 2026): accept the requests shown, and
 * record or clear why an approved attribute is not evidenced at D&I. Called in the
 * background; answers as JSON, with the evidence plan as the API returns it. The API
 * decides who may act and whether the list is settled. */
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
  const write = requestsWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", plan: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let plan: unknown = null;
  try {
    const headers = new Headers();
    if (write.body !== null) {
      headers.set("content-type", "application/json");
    }
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: write.method,
      headers,
      ...(write.body !== null ? { body: JSON.stringify(write.body) } : {}),
      cache: "no-store",
      // Accepting the last request releases the phase in the same call.
      signal: AbortSignal.timeout(30000),
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
