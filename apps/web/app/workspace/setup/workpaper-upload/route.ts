import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";
import {
  templateUploadNoticeFor,
  templateUploadTarget,
} from "../../../../src/onboarding-model";

/** A firm's workpaper template, uploaded from the Workpaper templates step for one kind
 * of control: a whole workbook, or one of its tabs. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const file = form.get("content");
  const target = templateUploadTarget(
    fields,
    file instanceof File ? { name: file.name, size: file.size } : null,
  );
  if (target === null || !(file instanceof File)) {
    return redirect(request, fields, "setup-template-unreadable");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  try {
    const headers = new Headers({
      "content-type": "application/octet-stream",
    });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${target.path}`, {
      method: "POST",
      headers,
      body: new Uint8Array(await file.arrayBuffer()),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    status = response.status;
  } catch {
    status = 0;
  }
  return redirect(request, fields, templateUploadNoticeFor(status));
}

function redirect(
  request: Request,
  fields: Record<string, string>,
  notice: string,
) {
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "setup");
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  destination.searchParams.set("step", "workpapers");
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
