import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { wizardWrite } from "../../../src/onboarding-model";

/** The system wizard's calls: create a system, its details, the agent's suggested
 * details, the magic wand, the saved selection, and removing a SOC report. Called in the background; answers as JSON with
 * the setup snapshot, so the wizard keeps its own state while the page refreshes. */
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
  const write = wizardWrite(fields);
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", onboarding: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let onboarding: unknown = null;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: write.method,
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(write.timeout ?? 30000),
    });
    status = response.status;
    const body = (await response.json()) as unknown;
    if (status === 200) {
      onboarding = body;
    } else if (typeof body === "object" && body !== null && "detail" in body) {
      const value = (body as { detail?: unknown }).detail;
      detail = typeof value === "string" ? value : "";
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail, onboarding });
}
