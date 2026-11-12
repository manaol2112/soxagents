import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";
import { chatRequest } from "../../../src/understanding-chat-model";

/** The Control Understanding conversation's requests (9 November 2026): a reply read by the
 * engagement planner, the same control on other systems, and the answers copied there; and
 * the walkthrough's answers, a topic's at once (11 November 2026). Called in the background;
 * answers as JSON. Each request is checked first (chatRequest); the API decides who may do
 * each. */
async function forward(fields: Record<string, unknown>) {
  const call = chatRequest(fields);
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
      // A reply or notes are read by a model; the rest are quick.
      signal: AbortSignal.timeout(
        call.path.endsWith("/notes")
          ? 100000
          : call.path.endsWith("/interpret")
            ? 45000
            : 15000,
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

export async function POST(request: Request) {
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
  return forward(fields);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  // The reads: the understanding to review, or the same control on other systems. The
  // review also says which other system's answers it starts from (`from`: a control id or
  // "none"), checked by chatRequest.
  return forward({
    intent: query.get("intent") === "review" ? "review" : "targets",
    organization_id: query.get("organization_id") ?? "",
    project_id: query.get("project_id") ?? "",
    control_id: query.get("control_id") ?? "",
    from: query.get("from") ?? "",
  });
}
