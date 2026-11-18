import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The text read from a spreadsheet or document, for its preview. */
export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await context.params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organization") ?? "";
  const projectId = url.searchParams.get("project") ?? "";
  if (
    !UUID.test(fileId) ||
    !UUID.test(organizationId) ||
    !UUID.test(projectId)
  ) {
    return NextResponse.json({ error: "invalid" }, { status: 404 });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/evidence-files/${fileId}/reading`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) {
      return NextResponse.json(
        { error: "unavailable" },
        { status: response.status },
      );
    }
    const body = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(
      {
        text: typeof body.text === "string" ? body.text : "",
        truncated: body.truncated === true,
        status: typeof body.status === "string" ? body.status : null,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
