import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { answersInPlace } from "../../../src/evidence-change-model";
import {
  filingNoticeFor,
  filingNoticeParam,
  filingWrite,
} from "../../../src/evidence-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** A person files an uploaded file to a control, moves it, or takes it off. A form that
 * asks for JSON (InPlaceForm) gets the notice back, with the server's own sentence when
 * it refused and the page to come back to, so a refusal is said in the form (E1: a move
 * something relies on is refused with its reason); otherwise the page is reloaded. */
export async function POST(request: Request) {
  const inPlace = answersInPlace(request.headers.get("accept"));
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = filingWrite(fields);
  if ("error" in write) {
    return inPlace
      ? NextResponse.json({ status: 422, detail: "", location: null })
      : back(request, fields, filingNoticeParam("invalid"));
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
      method: "POST",
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    status = response.status;
    detail = await refusalOf(response);
  } catch {
    status = 0;
  }
  const notice = filingNoticeParam(
    filingNoticeFor(status, write.body.control_id === null),
  );
  if (!inPlace) {
    return back(request, fields, notice);
  }
  const landing = destinationOf(request, fields, notice);
  return NextResponse.json({
    status,
    detail,
    location: `${landing.pathname}${landing.search}`,
  });
}

/** The API's sentence for a refusal (409), or "". */
async function refusalOf(response: Response): Promise<string> {
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
  notice: string,
) {
  return NextResponse.redirect(destinationOf(request, fields, notice), 303);
}

function destinationOf(
  request: Request,
  fields: Record<string, string>,
  notice: string,
): URL {
  const destination = browserUrl("/", request);
  destination.searchParams.set("section", "evidence");
  for (const [field, param] of [
    ["organization_id", "organization"],
    ["project_id", "project"],
    ["tab", "tab"],
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
  return destination;
}
