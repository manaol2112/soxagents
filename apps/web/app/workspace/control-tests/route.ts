import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { testNoticeFor, testWrite } from "../../../src/testing-model";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = testWrite(fields);
  if ("error" in write) {
    return redirect(request, fields, "test-invalid");
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
      signal: AbortSignal.timeout(10000),
    });
    status = response.status;
  } catch {
    status = 0;
  }
  return redirect(request, fields, testNoticeFor(write.intent, status));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redirect(
  request: Request,
  fields: Record<string, string>,
  notice: string,
) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("section", "controls");
  for (const [field, param] of [
    ["organization_id", "organization"],
    ["project_id", "project"],
    ["control_id", "control"],
  ] as const) {
    const value = fields[field] ?? "";
    if (UUID.test(value)) {
      destination.searchParams.set(param, value);
    }
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
