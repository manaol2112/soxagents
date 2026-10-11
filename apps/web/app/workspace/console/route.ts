import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { consoleNoticeFor, consoleWrite } from "../../../src/console-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = consoleWrite(fields);
  if ("error" in write) {
    return redirect(request, fields, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let thread = fields.thread_id ?? "";
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: "POST",
      headers,
      body: write.body === null ? null : JSON.stringify(write.body),
      cache: "no-store",
      // Confirming several steps can take a while: each runs through its own checks.
      signal: AbortSignal.timeout(60000),
    });
    status = response.status;
    if (
      status === 200 &&
      (write.intent === "ask" || write.intent === "new-thread")
    ) {
      const payload = (await response.json().catch(() => null)) as {
        id?: unknown;
      } | null;
      if (payload !== null && typeof payload.id === "string") {
        thread = payload.id;
      }
    }
  } catch {
    status = 0;
  }
  return redirect(
    request,
    { ...fields, thread_id: thread },
    consoleNoticeFor(write.intent, status),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redirect(
  request: Request,
  fields: Record<string, string>,
  notice: string,
) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("section", "console");
  for (const [field, param] of [
    ["organization_id", "organization"],
    ["project_id", "project"],
    ["thread_id", "thread"],
  ] as const) {
    const value = fields[field] ?? "";
    if (UUID.test(value)) {
      destination.searchParams.set(param, value);
    }
  }
  if (notice !== "sent" && notice !== "new") {
    destination.searchParams.set("notice", notice);
  }
  destination.hash = "latest";
  return NextResponse.redirect(destination, 303);
}
