import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { batchWrite } from "../../../src/controls-batch-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** The Controls register's batch actions: submit drafted requests for approval, and set
 * the owner of chosen controls. Called in the background; answers as JSON. */
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
  const write = batchWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, result: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
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
      signal: AbortSignal.timeout(120000),
    });
    status = response.status;
    if (status === 200) {
      result = (await response.json()) as unknown;
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, result });
}
