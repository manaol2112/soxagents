import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { outboundNoticeFor, outboundWrite } from "../../../src/workflow-model";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = outboundWrite(fields);
  if ("error" in write) {
    return redirectNotice(request, fields, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let delivery = "";
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
      signal: AbortSignal.timeout(write.intent === "send" ? 8000 : 3000),
    });
    status = response.status;
    const payload = (await response.json().catch(() => null)) as {
      detail?: unknown;
      status?: unknown;
    } | null;
    if (payload !== null && typeof payload.detail === "string") {
      detail = payload.detail;
    }
    if (payload !== null && typeof payload.status === "string") {
      delivery = payload.status;
    }
  } catch {
    status = 0;
  }
  return redirectNotice(
    request,
    fields,
    outboundNoticeFor(write.intent, status, detail, delivery),
  );
}

function redirectNotice(
  request: Request,
  fields: Record<string, string>,
  notice: string,
) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("section", "evidence");
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
