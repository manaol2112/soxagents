import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authRequest } from "../../../src/authentication-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** The authentication control's settings (10 November 2026): read, saved setting by setting,
 * and read from the governing policy. Called in the background; answers as JSON. The API
 * decides who may do each, and which settings are asked and required. */
async function forward(fields: Record<string, unknown>) {
  const call = authRequest(fields);
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
      // The policy is read by a model; the rest are quick.
      signal: AbortSignal.timeout(
        call.path.endsWith("/read-policy") ? 100000 : 15000,
      ),
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

async function fieldsOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // An empty or unreadable body is refused by the check.
  }
  return {};
}

export async function PUT(request: Request) {
  return forward({ ...(await fieldsOf(request)), intent: "save" });
}

export async function POST(request: Request) {
  return forward({ ...(await fieldsOf(request)), intent: "read-policy" });
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
