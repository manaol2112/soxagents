import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";
import { sectionWrite } from "../../../../src/section-edit-model";

/** A section of a workpaper saved where it is edited (docs/design-workpaper.md, section
 * 3.2): the existing section edit of the API, called in the background. It answers as
 * JSON with the API's status (any 2xx said as 200; 0 where the API could not be reached)
 * and the API's own sentence for a refusal, and never redirects. sectionWrite refuses
 * here what is not three ids, a section key, a version and a text or rows within the
 * limits; the API decides who may edit and what it takes. */
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
  const write = sectionWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "" });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
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
      signal: AbortSignal.timeout(15000),
    });
    status = response.ok ? 200 : response.status;
    if (status !== 200) {
      const body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null && "detail" in body) {
        const value = (body as { detail?: unknown }).detail;
        detail = typeof value === "string" ? value.slice(0, 300) : "";
      }
    }
  } catch {
    // The API was not reached, or its refusal was not JSON: the status says which.
  }
  return NextResponse.json({ status, detail });
}
