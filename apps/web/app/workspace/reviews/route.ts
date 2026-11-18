import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { reviewNoticeFor, reviewWrite } from "../../../src/review-model";

/** A decision on a control's independent review, back to the control's Review tab. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = reviewWrite(fields);
  if ("error" in write) {
    return redirect(request, fields, "review-invalid");
  }
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
  } catch {
    status = 0;
  }
  return redirect(request, fields, reviewNoticeFor(write.intent, status));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEPS = new Set(["plan", "request", "test", "conclude", "review"]);

/** The guided step the form was posted from, when the page was one; a value we name
 * ourselves, never the referer's text, reaches the redirect. */
function guidedStep(referer: string | null): string | null {
  if (referer === null) {
    return null;
  }
  try {
    const url = new URL(referer);
    const step = (url.searchParams.get("step") ?? "").toLowerCase();
    if (url.searchParams.get("tab") === null && STEPS.has(step)) {
      return step;
    }
  } catch {
    return null;
  }
  return null;
}

function redirect(
  request: Request,
  fields: Record<string, string>,
  notice: string,
) {
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
  // Back to where the form was: the guided Review step when the page was a step
  // (the referer carries `step` and no `tab`), else the classic Review tab.
  const step = guidedStep(request.headers.get("referer"));
  if (step !== null) {
    destination.searchParams.set("step", step);
  } else {
    destination.searchParams.set("tab", "review");
  }
  destination.searchParams.set("notice", notice);
  destination.hash = "control-review";
  return NextResponse.redirect(destination, 303);
}
