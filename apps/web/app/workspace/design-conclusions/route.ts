import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import {
  designConclusionNoticeFor,
  designConclusionWrite,
} from "../../../src/design-conclusion-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reviewer's sign-off or reopening of a control's D&I conclusion, back to its step. The
 * page shows success only once the API confirms it. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = designConclusionWrite(fields);
  let notice = "dc-invalid";
  if (!("error" in write)) {
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
      status = response.status;
      if (status === 409) {
        const body: unknown = await response.json().catch(() => null);
        detail =
          typeof body === "object" &&
          body !== null &&
          "detail" in body &&
          typeof body.detail === "string"
            ? body.detail
            : "";
      }
    } catch {
      status = 0;
    }
    notice = designConclusionNoticeFor(write.intent, status, detail);
  }
  // The panel saves in the background and refreshes in place.
  if (request.headers.get("x-dc-fetch") === "1") {
    return NextResponse.json({ notice });
  }
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "controls");
  for (const [field, param] of [
    ["organization_id", "organization"],
    ["project_id", "project"],
    ["control_id", "control"],
  ] as const) {
    const value = fields[field] ?? "";
    if (UUID.test(value)) {
      destination.searchParams.set(param, value);
    }
  }
  destination.searchParams.set("step", "designconclusion");
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
