import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { returnStep } from "../../../src/control-workflow-model";
import { answersInPlace } from "../../../src/evidence-change-model";
import {
  applicationNoticeFor,
  applicationWrite,
  filingNoticeParam,
} from "../../../src/evidence-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A person sets which application a file shows; back to where they set it. A form
 * that asks for JSON (InPlaceForm) gets the outcome back, with the server's own sentence
 * when it refused (E1: "the file's applications cannot be changed: ..." where a sibling
 * instance relies on the file) and the page to come back to; otherwise the page reloads. */
export async function POST(request: Request) {
  const inPlace = answersInPlace(request.headers.get("accept"));
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = applicationWrite(fields);
  let status = 0;
  let detail = "";
  if (!("error" in write)) {
    const session = sessionToken((await cookies()).get("aw_session")?.value);
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
        signal: AbortSignal.timeout(10000),
      });
      status = response.status;
      if (status === 409) {
        try {
          const body = (await response.json()) as { detail?: unknown };
          detail = typeof body.detail === "string" ? body.detail : "";
        } catch {
          detail = "";
        }
      }
    } catch {
      status = 0;
    }
  }
  const destination = browserUrl("/", request);
  const control = fields.control_id ?? "";
  destination.searchParams.set(
    "section",
    UUID.test(control) ? "controls" : "evidence",
  );
  for (const [field, param] of [
    ["organization_id", "organization"],
    ["project_id", "project"],
    ["control_id", "control"],
    ["file_id", "file"],
  ] as const) {
    const value = fields[field] ?? "";
    if (UUID.test(value) && !(param === "file" && UUID.test(control))) {
      destination.searchParams.set(param, value);
    }
  }
  if (!UUID.test(control)) {
    // Back to the Evidence page's own view: the Library tab, its queue, search and
    // grouping (18 November 2026: a change there landed on Requests).
    for (const key of ["tab", "queue", "q", "group"] as const) {
      const value = (fields[key] ?? "").slice(0, 120);
      if (value !== "") {
        destination.searchParams.set(key, value);
      }
    }
  }
  if (UUID.test(control)) {
    // Back to the step the file was set on: D&I Evidence or OE Evidence.
    const step = returnStep(fields.step);
    if (step !== null) {
      destination.searchParams.set("step", step);
    } else {
      destination.searchParams.set("tab", "evidence");
    }
  }
  destination.searchParams.set(
    "notice",
    filingNoticeParam(applicationNoticeFor("error" in write ? null : status)),
  );
  if (inPlace) {
    return NextResponse.json({
      status: "error" in write ? 422 : status,
      detail,
      location: `${destination.pathname}${destination.search}`,
    });
  }
  return NextResponse.redirect(destination, 303);
}
