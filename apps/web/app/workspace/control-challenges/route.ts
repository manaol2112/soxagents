import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The AI assistant's common challenges for a control (control_challenges.py): drafted by
 * the planning agent on request, never saved. Answers as JSON with the API's status. */
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
  const ids = ["organization_id", "project_id", "control_id"].map((key) =>
    typeof fields[key] === "string" ? (fields[key] as string) : "",
  );
  if (!ids.every((id) => UUID.test(id))) {
    return NextResponse.json({ status: 422, answer: null });
  }
  const [organizationId, projectId, controlId] = ids;
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let answer: unknown = null;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/controls/${controlId}/challenges`,
      {
        method: "POST",
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      },
    );
    status = response.status;
    answer = status === 200 ? ((await response.json()) as unknown) : null;
  } catch {
    status = 0;
  }
  return NextResponse.json({ status, answer });
}
