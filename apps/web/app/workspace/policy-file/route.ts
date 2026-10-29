import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A policy or procedure's original file (governing_documents.py): a PDF or image shown,
 * sandboxed; anything else downloaded. The API decides who may. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const [organization, project, document] = [
    url.searchParams.get("organization") ?? "",
    url.searchParams.get("project") ?? "",
    url.searchParams.get("document") ?? "",
  ];
  if (![organization, project, document].every((v) => UUID.test(v))) {
    return new NextResponse(null, { status: 404 });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  try {
    const headers = new Headers();
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organization}/projects/${project}/policies/${document}/file`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }
    const passed = new Headers({
      "content-type":
        response.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition":
        response.headers.get("content-disposition") ??
        'attachment; filename="document"',
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
    const policy = response.headers.get("content-security-policy");
    if (policy !== null) {
      passed.set("content-security-policy", policy);
    }
    return new NextResponse(await response.arrayBuffer(), { headers: passed });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
