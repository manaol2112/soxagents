import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { decisionNoticeFor, decisionWrite } from "../../../src/workflow-model";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = decisionWrite(fields);
  if ("error" in write) {
    return redirectNotice(request, fields, "invalid");
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
      signal: AbortSignal.timeout(3000),
    });
    status = response.status;
    if (status !== 200) {
      const payload = (await response.json().catch(() => null)) as {
        detail?: unknown;
      } | null;
      if (payload !== null && typeof payload.detail === "string") {
        detail = payload.detail;
      }
    }
  } catch {
    status = 0;
  }
  return redirectNotice(request, fields, decisionNoticeFor(status, detail));
}

function redirectNotice(
  request: Request,
  fields: Record<string, string>,
  notice: string,
) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("section", "approvals");
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
