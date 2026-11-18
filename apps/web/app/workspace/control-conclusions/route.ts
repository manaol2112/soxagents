import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { browserUrl } from "../../../src/browser-url";
import {
  conclusionNoticeFor,
  parseControlConclusion,
  rateWrite,
} from "../../../src/control-conclusion-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEVERE = new Set(["SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS"]);

/** A person's rating of a deficiency's severity, back to the Control Conclusion step. The
 * page shows success only once the API confirms it. */
export async function POST(request: Request) {
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const write = rateWrite(fields);
  let notice = "cc-invalid";
  if (!("error" in write)) {
    const session = sessionToken((await cookies()).get("aw_session")?.value);
    let status = 0;
    let pending = false;
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
        signal: AbortSignal.timeout(15000),
      });
      status = response.status;
      // A severe rating waits for the reviewer when it changes the severity.
      pending =
        status === 200 && SEVERE.has(String(write.body.severity ?? ""))
          ? await response
              .json()
              .then(
                (body: unknown) =>
                  parseControlConclusion(body)?.deficiencies.find(
                    (item) => item.id === fields.deficiency_id,
                  )?.pending != null,
              )
              .catch(() => false)
          : false;
    } catch {
      status = 0;
    }
    notice = conclusionNoticeFor(status, pending);
  }
  if (request.headers.get("x-cc-fetch") === "1") {
    return NextResponse.json({ notice });
  }
  const destination = browserUrl("/", request);
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
  destination.searchParams.set("step", "conclusion");
  destination.searchParams.set("notice", notice);
  return NextResponse.redirect(destination, 303);
}
