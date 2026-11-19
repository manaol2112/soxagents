import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import { returnStep } from "../../../src/control-workflow-model";
import {
  answersInPlace,
  type ChangeNotice,
  changeLanding,
  changeNoticeFor,
  changeWrite,
} from "../../../src/evidence-change-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** A person withdraws an evidence file, with a reason or none, or restores a withdrawn
 * one, with a reason. A form that asks for JSON gets the notice back, with the server's
 * own sentence when it refused (`detail`) and the page to come back to (`location`, the
 * one a reload would land on), to show where the person acted without a reload;
 * otherwise the page is reloaded with the notice. */
export async function POST(request: Request) {
  const inPlace = answersInPlace(request.headers.get("accept"));
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = changeWrite(fields);
  if ("error" in write) {
    return inPlace
      ? NextResponse.json({ notice: "invalid", detail: "", location: null })
      : back(request, fields, "invalid");
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let notice: ChangeNotice = "unavailable";
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
    detail = await detailOf(response);
    notice = changeNoticeFor(write.intent, response.status, detail);
  } catch {
    notice = "unavailable";
  }
  if (!inPlace) {
    return back(request, fields, notice);
  }
  // Where a reload would have landed, as a path on this app: a page that cannot show the
  // confirmation where the person acted (its row is gone) comes back to it in place.
  const landing = destinationOf(request, fields, notice);
  return NextResponse.json({
    notice,
    detail,
    location: `${landing.pathname}${landing.search}`,
  });
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
  return NextResponse.redirect(destinationOf(request, fields, notice), 303);
}

/** The page a change comes back to, with its notice (evidence-change-model.changeLanding),
 * on the address the browser asked for. */
function destinationOf(
  request: Request,
  fields: Record<string, string>,
  notice: ChangeNotice,
): URL {
  const landing = new URLSearchParams(
    changeLanding(fields, notice, returnStep(fields.step)).slice(2),
  );
  const destination = browserUrl("/", request);
  for (const [key, value] of landing) {
    destination.searchParams.set(key, value);
  }
  return destination;
}
