import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { evidenceFileNoticeFor } from "../../../src/workflow-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 25_000_000;

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const attachmentId = fields.attachment_id ?? "";
  const file = form.get("content");
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(attachmentId) ||
    !(file instanceof File) ||
    file.size > MAX_BYTES
  ) {
    return redirectNotice(request, fields, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  try {
    const headers = new Headers({
      "content-type": "application/octet-stream",
    });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/mailbox-attachments/${attachmentId}/content`,
      {
        method: "POST",
        headers,
        body: new Uint8Array(await file.arrayBuffer()),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    status = response.status;
    const payload = (await response.json().catch(() => null)) as {
      detail?: unknown;
    } | null;
    if (payload !== null && typeof payload.detail === "string") {
      detail = payload.detail;
    }
  } catch {
    status = 0;
  }
  return redirectNotice(request, fields, evidenceFileNoticeFor(status, detail));
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
