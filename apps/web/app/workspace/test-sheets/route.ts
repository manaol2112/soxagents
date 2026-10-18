import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { sheetNoticeFor, sheetWrite } from "../../../src/sheet-model";

/** A decision on a control's test sheet, back to the control's Testing tab. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = sheetWrite(fields);
  if ("error" in write) {
    return redirect(request, fields, "sheet-invalid");
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
  return redirect(request, fields, sheetNoticeFor(write.intent, status));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  destination.searchParams.set("tab", "testing");
  destination.searchParams.set("notice", notice);
  destination.hash = "test-sheet";
  return NextResponse.redirect(destination, 303);
}
