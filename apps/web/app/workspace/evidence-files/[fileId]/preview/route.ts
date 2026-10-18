import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOWN = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** A PDF or image to show in the preview. The API checks the bytes; this keeps it shown. */
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
      `${apiBaseUrl()}/organizations/${organizationId}/projects/${projectId}/evidence-files/${fileId}/preview`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(15000) },
    );
    const media = (response.headers.get("content-type") ?? "").split(";")[0];
    if (!response.ok || media === undefined || !SHOWN.has(media)) {
      return new NextResponse(null, {
        status: response.ok ? 415 : response.status,
      });
    }
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "content-type": media,
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; img-src data:",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
