import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import {
  filingNoticeFor,
  filingNoticeParam,
  filingWrite,
} from "../../../src/evidence-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** A person files an uploaded file to a control, moves it, or takes it off. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = filingWrite(fields);
  if ("error" in write) {
    return back(request, fields, filingNoticeParam("invalid"));
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
  return back(
    request,
    fields,
    filingNoticeParam(filingNoticeFor(status, write.body.control_id === null)),
  );
}

function back(
  request: Request,
  fields: Record<string, string>,
  notice: string,
) {
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "evidence");
  for (const [field, param] of [
    ["organization_id", "organization"],
    ["project_id", "project"],
    ["queue", "queue"],
    ["q", "q"],
    ["group", "group"],
    ["file", "file"],
  ] as const) {
    const value = fields[field] ?? "";
    if (value !== "") {
      destination.searchParams.set(param, value);
    }
  }
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
