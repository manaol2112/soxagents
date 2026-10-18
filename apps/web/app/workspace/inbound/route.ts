import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { inboundNoticeFor, inboundWrite } from "../../../src/workflow-model";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = inboundWrite(fields);
  if ("error" in write) {
    return redirectNotice(request, fields, "invalid");
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
      signal: AbortSignal.timeout(3000),
    });
    status = response.status;
  } catch {
    status = 0;
  }
  return redirectNotice(
    request,
    fields,
    inboundNoticeFor(write.intent, status),
  );
}

function redirectNotice(
  request: Request,
  fields: Record<string, string>,
  notice: string,
) {
  const destination = browserUrl("/", request);
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
  destination.searchParams.set("tab", "mailbox");
  destination.hash = "replies";
  return NextResponse.redirect(destination, 303);
}
