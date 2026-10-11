import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { noticeForStatus, projectWrite } from "../../../src/project-form";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = projectWrite(fields);
  if ("error" in write) {
    return redirectNotice(
      request,
      fields.organization_id ?? "",
      null,
      "invalid",
    );
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let projectId = write.projectId;
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
      signal: AbortSignal.timeout(3000),
    });
    status = response.status;
    if (response.status === 200 || response.status === 201) {
      const payload = (await response.json()) as { id?: unknown };
      if (typeof payload.id === "string") {
        projectId = payload.id;
      }
    } else {
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
  if (
    fields.intent === "create" &&
    (status === 200 || status === 201) &&
    projectId !== null &&
    projectId !== ""
  ) {
    // A new engagement goes straight into guided setup.
    const setup = new URL("/", request.url);
    setup.searchParams.set("section", "setup");
    setup.searchParams.set("organization", write.organizationId);
    setup.searchParams.set("project", projectId);
    setup.searchParams.set("step", "scope");
    return NextResponse.redirect(setup, 303);
  }
  return redirectNotice(
    request,
    write.organizationId,
    projectId,
    noticeForStatus(status, detail),
  );
}

function redirectNotice(
  request: Request,
  organizationId: string,
  projectId: string | null,
  notice: string,
) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("section", "projects");
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== null && projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
