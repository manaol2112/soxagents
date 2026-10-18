import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { detailsWrite } from "../../../src/request-details-model";
import { reviewWrite } from "../../../src/request-review-model";

// The request details changes (request-details-model.ts); the rest are review actions.
const DETAILS = new Set([
  "assign",
  "classify",
  "contact",
  "link",
  "remove",
  "share",
  "message",
  "seen",
]);

/** An action on one evidence request from its control's review panel: edit the draft,
 * assign who it goes to, confirm its type, attach or share reference materials, submit
 * it, ask the drafter again, approve or return it, send it. Called in the background;
 * answers as JSON. The API decides who may do each. */
export async function POST(request: Request) {
  let fields: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      fields = body as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const write = DETAILS.has(String(fields.intent))
    ? detailsWrite(fields)
    : reviewWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "" });
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
      signal: AbortSignal.timeout(
        write.intent === "send" ||
          write.intent === "resend" ||
          write.intent === "send-direct"
          ? 15000
          : 8000,
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
  return NextResponse.json({ status, detail });
}
