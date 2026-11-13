import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { assuranceWrite } from "../../../src/evidence-assurance-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** "Check again" on a D&I evidence file whose check failed or is out of date
 * (docs/evidence-assurance.md, section 6). Called in the background; answers as JSON
 * with the API's status, and the page reads the checks again once it is 200. The API
 * decides who may run it and refuses while a check is at work. */
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
  const write = assuranceWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "" });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: "POST",
      headers,
      cache: "no-store",
      // The run is queued and worked in the background: the call itself is short.
      signal: AbortSignal.timeout(30000),
    });
    // The contract names no success code: any 2xx is the server's confirmation.
    status = response.ok ? 200 : response.status;
    if (status !== 200) {
      const body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null && "detail" in body) {
        const value = (body as { detail?: unknown }).detail;
        detail = typeof value === "string" ? value : "";
      }
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail });
}
