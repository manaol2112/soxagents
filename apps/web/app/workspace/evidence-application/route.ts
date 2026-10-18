import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { applicationWrite } from "../../../src/evidence-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A person sets which application a file shows; back to where they set it. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = applicationWrite(fields);
  let status = 0;
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
  if (UUID.test(control)) {
    destination.searchParams.set("tab", "evidence");
  }
  destination.searchParams.set(
    "notice",
    status === 200
      ? "filing-filed"
      : status === 409
        ? "filing-stale"
        : "filing-invalid",
  );
  return NextResponse.redirect(destination, 303);
}
