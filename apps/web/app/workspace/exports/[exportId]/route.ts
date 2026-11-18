import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiBaseUrl, sessionToken } from "../../../../src/load-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TYPES: Record<string, string> = {
  xlsx: XLSX,
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * A file the agent made from the engagement's records (Milestone 8.20). The API checks
 * that the person can see the engagement and that the file is still kept; a link that
 * fails says why in words, not as an error code.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ exportId: string }> },
) {
  const { exportId } = await params;
  const url = new URL(request.url);
  const organization = url.searchParams.get("organization") ?? "";
  const project = url.searchParams.get("project") ?? "";
  if (!UUID.test(organization) || !UUID.test(project) || !UUID.test(exportId)) {
    return page(400, "This download link is not valid.");
  }
  const headers = new Headers();
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}/organizations/${organization}/projects/${project}/exports/${exportId}`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(60000) },
    );
    if (response.status === 410) {
      return page(
        410,
        "This file has expired: files are kept for 30 days. Ask the agent to make it again.",
      );
    }
    if (response.status === 401) {
      return page(401, "Sign in to download this file.");
    }
    if (response.status !== 200) {
      return page(
        response.status === 404 ? 404 : 503,
        response.status === 404
          ? "This file is not available to you."
          : "The file could not be fetched just now. Try again in a moment.",
      );
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const extension =
      /\.(xlsx|csv|pdf|docx)"?$/.exec(disposition)?.[1] ?? "xlsx";
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "content-type": TYPES[extension] ?? XLSX,
        "content-disposition":
          disposition !== ""
            ? disposition
            : 'attachment; filename="export.xlsx"',
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return page(
      503,
      "The file could not be fetched just now. Try again in a moment.",
    );
  }
}

function page(status: number, message: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Download</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#f4f5f8;color:#111827;font:15px/1.5 system-ui,sans-serif}main{max-width:28rem;padding:1.5rem;text-align:center}a{color:#2f4ac0}</style></head><body><main><p>${message}</p><p><a href="/">Back to the workspace</a></p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
