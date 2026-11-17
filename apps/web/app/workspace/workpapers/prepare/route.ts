import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";
import { signOffWrite } from "../../../../src/preparer-signoff-model";

/** The preparer's sign-off of a workpaper, and its reopening, from section 7
 * (docs/design-workpaper.md, section 3.7): the existing prepare and reopen of the API,
 * called in the background. It answers as JSON with the API's status (any 2xx said as
 * 200; 0 where it could not be reached) and the API's own sentence for a refusal, and
 * never redirects. The API decides who may sign and what the sign-off needs. */
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
  const write = signOffWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "" });
  }
  const token = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (token !== undefined) {
      headers.set("cookie", `aw_session=${token}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    status = response.ok ? 200 : response.status;
    if (status !== 200) {
      const body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null && "detail" in body) {
        const value = (body as { detail?: unknown }).detail;
        detail =
          typeof value === "string"
            ? value.split(/\s+/).filter(Boolean).join(" ").slice(0, 300)
            : "";
      }
    }
  } catch {
    // The API was not reached, or its refusal was not JSON: the status says which.
  }
  return NextResponse.json({ status, detail });
}
