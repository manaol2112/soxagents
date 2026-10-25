import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
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
      // A close-out or an edit returns to its engagement; a new one has none yet.
      fields.intent === "create"
        ? null
        : /^[0-9a-f-]{36}$/i.test(fields.project_id ?? "")
          ? (fields.project_id ?? null)
          : null,
      "invalid",
      fields.intent === "create",
      fields.intent === "details",
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
    // The planner drafts the setup in the background; the overview shows it when ready.
    try {
      const headers = new Headers({ "content-type": "application/json" });
      if (session !== undefined) {
        headers.set("cookie", `aw_session=${session}`);
      }
      await fetch(
        `${apiBaseUrl()}/organizations/${write.organizationId}/projects/${projectId}/onboarding/suggestions/draft`,
        {
          method: "POST",
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        },
      );
    } catch {
      // The overview offers to ask again.
    }
    // A new engagement goes straight into guided setup.
    const setup = browserUrl("/", request);
    setup.searchParams.set("section", "setup");
    setup.searchParams.set("organization", write.organizationId);
    setup.searchParams.set("project", projectId);
    setup.searchParams.set("step", "overview");
    // The setup agent greets the new engagement on the first step it opens.
    setup.searchParams.set("notice", "setup-created");
    return NextResponse.redirect(setup, 303);
  }
  const notice = noticeForStatus(status, detail, fields.intent ?? "");
  return redirectNotice(
    request,
    write.organizationId,
    // A deleted engagement is gone: the list opens without it.
    notice === "deleted" ? null : projectId,
    notice,
    fields.intent === "create",
    fields.intent === "details" && notice !== "saved",
  );
}

function redirectNotice(
  request: Request,
  organizationId: string,
  projectId: string | null,
  notice: string,
  creating = false,
  editing = false,
) {
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "projects");
  if (creating) {
    destination.searchParams.set("create", "engagement");
  }
  if (editing) {
    destination.searchParams.set("edit", "engagement");
  }
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== null && projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
