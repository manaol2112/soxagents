import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { redraftNoticeFor, redraftTarget } from "../../../../src/draft-model";
import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const target = redraftTarget(fields);
  if (target === null) {
    return redirect(request, fields, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${target.path}`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
  } catch {
    status = 0;
  }
  return redirect(request, fields, redraftNoticeFor(status));
}

function redirect(
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
