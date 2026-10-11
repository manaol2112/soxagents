import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return new NextResponse(null, { status: 404 });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/evidence-files/${fileId}/content`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition":
          response.headers.get("content-disposition") ??
          'attachment; filename="evidence"',
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
