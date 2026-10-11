import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { setupNoticeFor, setupWrite } from "../../../src/onboarding-model";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  const multi: Record<string, string[]> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") {
      continue;
    }
    fields[key] = value;
    multi[key] = [...(multi[key] ?? []), value];
  }
  const write = setupWrite(fields, multi);
  if ("error" in write) {
    return redirect(request, fields, fields.step ?? "scope", "setup-invalid");
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
      method: write.method,
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(
        write.intent === "approve" || write.intent.startsWith("rcm-")
          ? 15000
          : 5000,
      ),
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
  return redirect(
    request,
    fields,
    write.step,
    setupNoticeFor(write.intent, status, detail),
  );
}

function redirect(
  request: Request,
  fields: Record<string, string>,
  step: string,
  notice: string,
) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("section", "setup");
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  destination.searchParams.set("step", step);
  const control = fields.return_control ?? "";
  if (notice !== "setup-saved" && control !== "") {
    destination.searchParams.set("control", control);
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
