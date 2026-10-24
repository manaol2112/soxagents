import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { MAX_UPLOAD_BYTES, uploadTarget } from "../../../src/evidence-model";
import { apiBaseUrl, sessionToken } from "../../../src/load-workspace";

/** One file from the evidence drop zone, passed to the API as its raw bytes. */
export async function POST(request: Request) {
  const target = uploadTarget(new URL(request.url).searchParams);
  if ("error" in target) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const content = await request.arrayBuffer();
  if (content.byteLength === 0 || content.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "invalid" }, { status: 422 });
  }
  const headers = new Headers({
    "content-type":
      request.headers.get("content-type") ?? "application/octet-stream",
  });
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  if (session !== undefined) {
    headers.set("cookie", `aw_session=${session}`);
  }
  try {
    const response = await fetch(
      `${apiBaseUrl()}${target.path}?${target.query}`,
      {
        method: "POST",
        headers,
        body: content,
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      },
    );
    if (response.status !== 200) {
      // The API's own reason for a refusal (a plain sentence it wrote), so the person
      // knows what to do; nothing else of the answer is passed on.
      const refused = (await response.json().catch(() => ({}))) as {
        detail?: unknown;
      };
      return NextResponse.json(
        {
          error: response.status === 422 ? "invalid" : "refused",
          detail:
            response.status === 409 && typeof refused.detail === "string"
              ? refused.detail.slice(0, 200)
              : null,
        },
        { status: response.status },
      );
    }
    const body = (await response.json()) as Record<string, unknown>;
    return NextResponse.json({
      file_id: typeof body.file_id === "string" ? body.file_id : null,
      duplicate: body.duplicate === true,
    });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
