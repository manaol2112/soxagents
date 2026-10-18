import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import {
  type ChangeNotice,
  changeNoticeFor,
  changeNoticeParam,
  changeReturn,
  changeWrite,
} from "../../../src/evidence-change-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** A person withdraws an evidence file, with a reason, or restores a withdrawn one. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = changeWrite(fields);
  if ("error" in write) {
    return back(request, fields, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let notice: ChangeNotice = "unavailable";
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
    notice = changeNoticeFor(
      write.intent,
      response.status,
      await detailOf(response),
    );
  } catch {
    notice = "unavailable";
  }
  return back(request, fields, notice);
}

async function detailOf(response: Response): Promise<string> {
  if (response.status !== 409) {
    return "";
  }
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : "";
  } catch {
    return "";
  }
}

function back(
  request: Request,
  fields: Record<string, string>,
  notice: ChangeNotice,
) {
  const destination = browserUrl("/", request);
  const organization = fields.organization_id ?? "";
  const project = fields.project_id ?? "";
  if (/^[0-9a-f-]{36}$/i.test(organization)) {
    destination.searchParams.set("organization", organization);
  }
  if (/^[0-9a-f-]{36}$/i.test(project)) {
    destination.searchParams.set("project", project);
  }
  const target = changeReturn(fields);
  if (target.to === "control") {
    destination.searchParams.set("section", "controls");
    destination.searchParams.set("control", target.control);
    destination.searchParams.set("tab", "evidence");
  } else {
    destination.searchParams.set("section", "evidence");
    for (const [key, value] of Object.entries(target.keep)) {
      destination.searchParams.set(key, value);
    }
    if (target.file !== null && notice !== "withdrawn") {
      destination.searchParams.set("file", target.file);
    }
  }
  destination.searchParams.set("notice", changeNoticeParam(notice));
  return NextResponse.redirect(destination, 303);
}
