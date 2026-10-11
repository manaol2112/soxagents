import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  engagementNoticeFor,
  engagementWrite,
} from "../../../src/engagement-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = engagementWrite(fields);
  const section =
    "error" in write
      ? fields.section === "timeline"
        ? "timeline"
        : fields.section === "plan"
          ? "plan"
          : "deficiencies"
      : write.section;
  if ("error" in write) {
    return redirect(request, fields, section, "invalid", null);
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let created: string | null = null;
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
      signal: AbortSignal.timeout(8000),
    });
    status = response.status;
    if (status === 200 && write.intent === "deficiency-create") {
      const payload = (await response.json().catch(() => null)) as {
        id?: unknown;
      } | null;
      if (
        payload !== null &&
        typeof payload.id === "string" &&
        UUID.test(payload.id)
      ) {
        created = payload.id;
      }
    }
  } catch {
    status = 0;
  }
  const keep =
    created ??
    (UUID.test(fields.deficiency_id ?? "")
      ? (fields.deficiency_id ?? null)
      : null);
  return redirect(
    request,
    fields,
    section,
    engagementNoticeFor(write.intent, status),
    keep,
  );
}

function redirect(
  request: Request,
  fields: Record<string, string>,
  section: string,
  notice: string,
  deficiency: string | null,
) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("section", section);
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  if (organizationId !== "") {
    destination.searchParams.set("organization", organizationId);
  }
  if (projectId !== "") {
    destination.searchParams.set("project", projectId);
  }
  if (deficiency !== null && section === "deficiencies") {
    destination.searchParams.set("deficiency", deficiency);
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
