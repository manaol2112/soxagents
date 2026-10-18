import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { analysisNoticeFor, analysisWrite } from "../../../src/analysis-model";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = analysisWrite(fields);
  if ("error" in write) {
    const section = fields.intent === "ocr-engine" ? "agents" : "evidence";
    return redirect(request, fields, section, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: write.method,
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    status = response.status;
  } catch {
    status = 0;
  }
  return redirect(
    request,
    fields,
    write.section,
    analysisNoticeFor(write.intent, status),
  );
}

function redirect(
  request: Request,
  fields: Record<string, string>,
  section: string,
  notice: string,
) {
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", section);
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  // Back to the same tab and open file the form was sent from.
  for (const key of ["tab", "file", "queue", "q", "group", "control"]) {
    const value = fields[`keep_${key}`] ?? "";
    if (value !== "" && value.length <= 120) {
      destination.searchParams.set(key, value);
    }
  }
  // Sent from a control's record: back to that control.
  if (fields.keep_section === "controls" && section === "evidence") {
    destination.searchParams.set("section", "controls");
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
