import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { detailsRequest } from "../../../src/control-details-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { FREQUENCIES, NATURES } from "../../../src/onboarding-model";

const FREQUENCY_KEYS = FREQUENCIES.map(([key]) => key);
const NATURE_KEYS = NATURES.map(([key]) => key);

/** A control's RCM details, read and completed from step 01 of its workflow (10 November
 * 2026). Called in the background; answers as JSON. The API decides who may record them. */
async function forward(fields: Record<string, unknown>) {
  const call = detailsRequest(fields, FREQUENCY_KEYS, NATURE_KEYS);
  if ("error" in call) {
    return NextResponse.json({ status: 422, detail: "", body: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const headers = new Headers();
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  if (call.body !== null) {
    headers.set("content-type", "application/json");
  }
  let status = 0;
  let detail = "";
  let body: unknown = null;
  try {
    const response = await fetch(`${apiBaseUrl()}${call.path}`, {
      method: call.method,
      headers,
      body: call.body === null ? null : JSON.stringify(call.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    status = response.status;
    const answer = (await response.json().catch(() => null)) as unknown;
    if (status === 200) {
      body = answer;
    } else if (
      typeof answer === "object" &&
      answer !== null &&
      "detail" in answer
    ) {
      const value = (answer as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value : "";
    }
  } catch {
    // No answer in time: status stays 0, and the page says so.
  }
  return NextResponse.json({ status, detail, body });
}

export async function PUT(request: Request) {
  let fields: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      fields = parsed as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  return forward({ ...fields, intent: "save" });
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return forward({
    intent: "read",
    organization_id: query.get("organization_id") ?? "",
    project_id: query.get("project_id") ?? "",
    control_id: query.get("control_id") ?? "",
  });
}
