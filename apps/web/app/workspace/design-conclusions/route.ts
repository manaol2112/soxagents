import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import {
  designConclusionNoticeFor,
  designConclusionWrite,
} from "../../../src/design-conclusion-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** The refusals whose `detail` is the server's sentence for the person. */
const REFUSED: ReadonlySet<number> = new Set([403, 409]);

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
  let detail = "";
  if (!("error" in write)) {
    const session = sessionToken((await cookies()).get("aw_session")?.value);
    let status = 0;
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
      // The server's own sentence for a refusal (docs/design-workpaper.md section 3.6:
      // "the preparer's conclusion changed; read it again", "you recorded this
      // conclusion; another reviewer must sign it off"): the panel shows it at once.
      // Read as text only, bounded; a validation list (422) is not a sentence.
      if (REFUSED.has(status)) {
        const body: unknown = await response.json().catch(() => null);
        detail =
          typeof body === "object" &&
          body !== null &&
          "detail" in body &&
          typeof body.detail === "string"
            ? body.detail.replace(/\s+/g, " ").trim().slice(0, 300)
            : "";
      }
    } catch {
      status = 0;
    }
    notice = designConclusionNoticeFor(write.intent, status, detail);
  }
  // The panel saves in the background and refreshes in place; it shows the server's
  // sentence for a refusal (`detail`, "" where there is none).
  if (request.headers.get("x-dc-fetch") === "1") {
    return NextResponse.json({ notice, detail });
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
