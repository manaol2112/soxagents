import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { noticeForStatus, taskWrite } from "../../../src/task-form";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  const dependsOn: string[] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") {
      continue;
    }
    if (key === "depends_on") {
      dependsOn.push(value);
    } else {
      fields[key] = value;
    }
  }
  const write = taskWrite(fields, dependsOn);
  if ("error" in write) {
    return redirectNotice(request, fields, fields.task_id ?? "", "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let taskId = write.taskId ?? "";
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
        taskId = payload.id;
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
  return redirectNotice(
    request,
    fields,
    taskId,
    noticeForStatus(status, detail),
  );
}

function redirectNotice(
  request: Request,
  fields: Record<string, string>,
  taskId: string,
  notice: string,
) {
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "tasks");
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  if (taskId !== "") {
    destination.searchParams.set("task", taskId);
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
