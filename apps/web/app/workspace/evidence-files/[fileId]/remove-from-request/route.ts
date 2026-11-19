import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { removeWrite } from "../../../../../src/evidence-impact-model";
import { apiBaseUrl, sessionToken } from "../../../../../src/load-workspace";

/** "Remove from this request" (E1): the file comes off one evidence item and, through
 * its filing, off that item's request; it is never withdrawn. Forwarded as the person,
 * answered as `{ status, detail, via }`; the API decides who may and what relies on it. */
export async function POST(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await context.params;
  let fields: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      fields = body as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const write = removeWrite({ ...fields, file_id: fileId });
  if ("error" in write) {
    return NextResponse.json({ status: 422, detail: "", via: null });
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  let status = 0;
  let detail = "";
  let via: string | null = null;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) {
      headers.set("cookie", `aw_session=${session}`);
    }
    const response = await fetch(`${apiBaseUrl()}${write.path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(write.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    status = response.status;
    const body = (await response.json()) as unknown;
    if (typeof body === "object" && body !== null) {
      const record = body as { detail?: unknown; via?: unknown };
      if (status === 200) {
        via =
          record.via === "LINK" || record.via === "FILING" ? record.via : null;
      } else if (typeof record.detail === "string") {
        detail = record.detail;
      }
    }
  } catch {
    status = status === 0 ? 0 : status;
  }
  return NextResponse.json({ status, detail, via });
}
